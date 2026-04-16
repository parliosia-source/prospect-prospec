import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");

async function callOpenAI(messages) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini", messages, response_format: { type: "json_object" } })
  });
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { prospectId, leadId, channel, templateType, contactId } = await req.json();

  // Load all relevant data in parallel
  const [prospect, contact, templates] = await Promise.all([
    prospectId ? base44.entities.Prospect.filter({ id: prospectId }).then(r => r[0]) : null,
    contactId ? base44.entities.Contact.filter({ id: contactId }).then(r => r[0]) : null,
    base44.entities.MessageTemplate.filter({ templateType, channel, active: true }, "-created_date", 3),
  ]);

  if (prospect && prospect.ownerUserId !== user.email && user.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Load API costs
  let apiCosts = { "OpenAI_Short": { unitCost: 0.002, unitType: "call" } };
  const settingsArr = await base44.asServiceRole.entities.AppSettings.filter({ settingsId: "global" }).catch(() => []);
  if (settingsArr[0]?.apiCosts) apiCosts = { ...apiCosts, ...settingsArr[0].apiCosts };

  // Pick best template
  const segment = prospect?.segment || "STANDARD";
  const template = templates.find(t => t.languageVariant === "FR_CA" && t.segment === segment)
    || templates.find(t => t.languageVariant === "FR_CA")
    || templates[0];

  const senderName = user.full_name || user.email.split("@")[0];

  // ── Contact context ────────────────────────────────────────────────────────
  const contactFullName = [contact?.firstName, contact?.lastName].filter(Boolean).join(" ").trim();
  const hasRealName = contactFullName && contactFullName !== "null" && contactFullName.split(" ").length >= 2;
  const contactFirstName = hasRealName ? contactFullName.split(" ")[0] : "";
  const isStubContact = contact?.isStub || (!hasRealName && !contact?.email);

  // Salutation strategy:
  // - Real name known → use first name
  // - Stub/role-only → address by role naturally ("Bonjour,") — never "Madame/Monsieur"
  // - No contact → generic "Bonjour,"
  const salutation = hasRealName ? contactFirstName : "";

  // ── Prospect context ───────────────────────────────────────────────────────
  const companyName   = prospect?.companyName || "";
  const industry      = prospect?.industry || "";
  const location      = prospect?.location?.city || prospect?.location?.region || "";
  const eventTypes    = (prospect?.eventTypes || []).join(", ");
  const opportunities = (prospect?.opportunities || []).map(o => o.detail ? `${o.label}: ${o.detail}` : o.label).join("\n- ");
  const painPoints    = (prospect?.painPoints || []).map(p => p.label).join(", ");
  const approach      = prospect?.recommendedApproach || "";
  const reasons       = (prospect?.relevanceReasons || []).join("; ");

  // ── Template intent (use as tone/structure guide, not verbatim copy) ────────
  const templateHint = template
    ? `Structure de référence (inspire-toi du ton et de la longueur, adapte le contenu au contexte réel):
---
${template.body.slice(0, 600)}
---`
    : "";

  // ── Message type context ────────────────────────────────────────────────────
  const messageTypeMap = {
    FIRST_MESSAGE: "Premier contact — l'entreprise ne nous connaît pas encore.",
    FOLLOW_UP_J7: "Relance après 7 jours sans réponse au premier message. Rester bref, rappeler l'objet, proposer une autre date.",
    FOLLOW_UP_J14: "Relance finale après 14 jours. Ton plus léger, laisser la porte ouverte."
  };
  const messageTypeNote = messageTypeMap[templateType] || "";

  const systemPrompt = `Tu es ${senderName}, représentant(e) de SYNC Productions à Montréal.
SYNC = partenaire audiovisuel pour événements corporatifs : son, éclairage, captation vidéo, webdiffusion/hybride.
Clients : entreprises et organisations qui organisent leurs propres événements (congrès, AGA, galas, formations, townhalls).

RÈGLES ABSOLUES:
- FR-CA naturel — pas de traduction littérale de l'anglais
- Jamais d'affirmation non vérifiable ("j'ai vu que vous organisez…" sans source)
- Jamais de fluff d'ouverture ("j'espère que vous allez bien", "je me permets de vous contacter")
- CTA soft : proposer 15 minutes ou demander le calendrier événements
- Si le nom du contact est inconnu, commence directement par l'objet sans salutation personnalisée
- Sois spécifique au contexte de l'entreprise — utilise les opportunités et types d'événements fournis
- Longueur : concis mais complet. Maximum 8-10 lignes pour un premier message.
- Sortie JSON strict : { "subject": string|null, "body": string }`;

  const userPrompt = `Génère un message de prospection B2B pour SYNC Productions.

TYPE: ${messageTypeNote}
CANAL: ${channel === "EMAIL" ? "Email (inclure un sujet)" : "LinkedIn (pas de sujet)"}

ENTREPRISE CIBLE:
- Nom: ${companyName}
- Industrie: ${industry}${location ? `\n- Ville: ${location}` : ""}${eventTypes ? `\n- Types d'événements probables: ${eventTypes}` : ""}

CONTACT:
- ${hasRealName ? `Prénom: ${contactFirstName}, Nom complet: ${contactFullName}` : isStubContact ? `Rôle ciblé: ${contact?.title || "Responsable"}` : "Contact inconnu — message générique"}${contact?.title && hasRealName ? `\n- Titre: ${contact.title}` : ""}

ANGLE DE PERSONNALISATION (utilise ces éléments dans le message):
${opportunities ? `- Opportunités identifiées:\n  - ${opportunities}` : ""}${painPoints ? `\n- Points de friction potentiels: ${painPoints}` : ""}${approach ? `\n- Approche recommandée: ${approach}` : ""}${reasons ? `\n- Pourquoi ce prospect est pertinent: ${reasons}` : ""}

${templateHint}

EXPÉDITEUR: ${senderName}
${salutation ? `Utilise "${salutation}" comme prénom dans la salutation.` : "Commence sans salutation personnalisée — directement par le sujet du message."}

NE PAS inventer de faits non listés ci-dessus. Si peu d'éléments de personnalisation sont disponibles, reste sobre et factuel sur SYNC.`;

  const result = await callOpenAI([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ]);

  // Clean up any leftover template variables
  if (result.body) {
    result.body = result.body
      .replace(/\{firstName\}/g, salutation || "")
      .replace(/\{senderName\}/g, senderName)
      .replace(/\{senderTitle\}/g, "Représentant(e) SYNC Productions")
      .replace(/Madame\/Monsieur,?\s*/g, "");
  }

  // Log OpenAI usage
  await base44.asServiceRole.entities.ApiUsageLog.create({
    timestamp: new Date().toISOString(),
    apiName: "OpenAI_Short",
    functionName: "generateMessage",
    cost: apiCosts["OpenAI_Short"]?.unitCost || 0.002,
    unitsUsed: 1,
    unitType: "call",
    prospectId: prospectId || undefined,
    ownerUserId: user.email,
    status: "SUCCESS",
  }).catch(() => {});

  result.generatedBody = result.body;
  result.generatedSubject = result.subject || null;

  return Response.json(result);
});