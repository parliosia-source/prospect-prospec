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

  const { messageId, tone, length, objective, instructions } = await req.json();
  if (!messageId) return Response.json({ error: "messageId requis" }, { status: 400 });

  const msgList = await base44.entities.Message.filter({ id: messageId });
  const msg = msgList[0];
  if (!msg) return Response.json({ error: "Message introuvable" }, { status: 404 });
  if (msg.ownerUserId !== user.email && user.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Load prospect AND contact in parallel
  const [prospect, contacts] = await Promise.all([
    msg.prospectId ? base44.entities.Prospect.filter({ id: msg.prospectId }).then(r => r[0] || null) : Promise.resolve(null),
    msg.prospectId ? base44.entities.Contact.filter({ prospectId: msg.prospectId }, "-created_date", 5) : Promise.resolve([]),
  ]);

  // Find the most relevant contact (prefer with email, then with LinkedIn, then first)
  const contact = contacts.find(c => c.email) || contacts.find(c => c.linkedinUrl) || contacts[0] || null;

  const baseContent = msg.editedBody || msg.generatedBody || msg.body || "";
  const baseSubject = msg.editedSubject || msg.generatedSubject || msg.subject || "";
  const channel = msg.channel || "LINKEDIN";

  const toneMap = {
    "PROFESSIONNEL": "professionnel et posé",
    "DIRECT": "direct et concis, va droit au but",
    "CHALEUREUX": "chaleureux et accessible, plus relationnel"
  };
  const lengthMap = {
    "COURT": "très court (4-5 lignes maximum)",
    "MOYEN": "moyen (7-9 lignes)"
  };
  const objectiveMap = {
    "CALL_15": "obtenir un appel de 15 minutes",
    "QUALIFY_EVENT": "qualifier les besoins événementiels de l'entreprise",
    "FOLLOWUP_J7": "relancer après 7 jours sans réponse — ton léger, rappel de l'objet, nouvelle proposition"
  };

  const toneLabel   = toneMap[tone]      || "professionnel et posé";
  const lengthLabel = lengthMap[length]  || "moyen (7-9 lignes)";
  const objectiveLabel = objectiveMap[objective] || "obtenir une réponse";

  // Contact context
  const contactFullName = [contact?.firstName, contact?.lastName].filter(Boolean).join(" ").trim();
  const hasRealName = contactFullName && contactFullName !== "null" && contactFullName.split(" ").length >= 2;
  const contactFirstName = hasRealName ? contactFullName.split(" ")[0] : "";

  // Prospect context — include the richest fields for personalization
  const eventTypes    = (prospect?.eventTypes || []).join(", ");
  const opportunities = (prospect?.opportunities || []).map(o => o.label).join(", ");
  const approach      = prospect?.recommendedApproach || "";

  const prospectContext = prospect ? `
Contexte entreprise:
- Entreprise: ${prospect.companyName}${prospect.industry ? `, ${prospect.industry}` : ""}
${eventTypes ? `- Types d'événements probables: ${eventTypes}` : ""}
${opportunities ? `- Opportunités: ${opportunities}` : ""}
${approach ? `- Angle recommandé: ${approach}` : ""}
${hasRealName ? `- Contact: ${contactFirstName} (${contact?.title || ""})` : contact?.title ? `- Rôle ciblé: ${contact.title}` : ""}` : "";

  const senderName = user.full_name || user.email.split("@")[0];

  const result = await callOpenAI([
    {
      role: "system",
      content: `Tu es ${senderName} de SYNC Productions (partenaire audiovisuel événementiel, Montréal).
RÈGLES ABSOLUES:
- FR-CA naturel, jamais de traduction littérale de l'anglais
- Jamais de "j'espère que ce message vous trouve bien" ou équivalent
- Jamais d'affirmations non vérifiables
- CTA soft seulement (15 min, question sur calendrier)
- Tu améliores le message existant — ne l'écrase pas, garde l'intention
- Sortie JSON strict: { "editedSubject": string|null, "editedBody": string, "suggestions": [string, string, string] }`
    },
    {
      role: "user",
      content: `Améliore ce message de prospection.

Ajustements demandés:
- Ton: ${toneLabel}
- Longueur: ${lengthLabel}
- Objectif: ${objectiveLabel}
- Canal: ${channel}${instructions ? `\n- Instructions libres: ${instructions}` : ""}
${prospectContext}

Message à améliorer:
${channel === "EMAIL" && baseSubject ? `Sujet: ${baseSubject}\n\n` : ""}${baseContent}

Retourne:
- editedSubject: sujet amélioré (null si LinkedIn)
- editedBody: corps du message amélioré
- suggestions: 3 bullets courts décrivant les améliorations appliquées`
    }
  ]);

  // Persist edits
  await base44.entities.Message.update(messageId, {
    editedBody:    result.editedBody,
    editedSubject: result.editedSubject || "",
    activeVersion: "EDITED",
    lastEditedAt:  new Date().toISOString(),
    status:        "DRAFT",
  });

  return Response.json({
    editedSubject: result.editedSubject,
    editedBody:    result.editedBody,
    suggestions:   result.suggestions || [],
  });
});