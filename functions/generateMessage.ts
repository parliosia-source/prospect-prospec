import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

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

  // Load data
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

  // Pick template (prefer FR_CA, HOT if segment matches)
  const segment = prospect?.segment || "STANDARD";
  const template = templates.find(t => t.languageVariant === "FR_CA" && t.segment === segment)
    || templates.find(t => t.languageVariant === "FR_CA")
    || templates[0];

  const senderName = user.full_name || user.email.split("@")[0];
  const contactName = [contact?.firstName, contact?.lastName].filter(Boolean).join(" ").trim();
  const firstName = (contactName && contactName !== "null") ? contactName.split(" ")[0] : (contact?.title ? "" : "Madame/Monsieur");

  const systemPrompt = `Tu es ${senderName}, conseiller·ère en production événementielle chez SYNC Productions, basé·e à Montréal. Tu agis comme un partenaire stratégique, pas comme un vendeur. Ton rôle : aider les entreprises à réussir leurs événements corporatifs grâce à une expertise en sonorisation, éclairage, captation vidéo et webdiffusion/hybride.

---
## LANGUE ET TON
- Français québécois d'affaires : professionnel, direct, chaleureux sans être familier.
- Évite les anglicismes lourds (préfère "webdiffusion" à "livestreaming", "captation" à "recording").
- Zéro jargon marketing, zéro superlatif creux ("leader", "solutions innovantes", "clé en main" utilisé seul).
- Chaque phrase doit apporter de l'information ou du contexte. Valorise le temps du lecteur.
- Longueur cible : 80-120 mots pour un email, 40-70 mots pour un message LinkedIn.

---
## UTILISATION DU CONTEXTE — HIÉRARCHIE STRICTE
Tu reçois un bloc de contexte sur le prospect. Utilise-le selon cette priorité :

### Priorité 1 : Opportunités
Si le champ "Opportunités" contient une information concrète (événement à venir, conférence, gala, etc.), le message DOIT pivoter autour de cette information. C'est ton accroche principale. Mentionne l'événement par son nom ou sa nature.

### Priorité 2 : Raisons de pertinence
Si "Opportunités" est vide mais que "Raisons" contient des éléments (ex: "organise régulièrement des conférences", "budget événementiel important"), base ton accroche sur ces raisons.

### Priorité 3 : Industrie + Segment
Si ni "Opportunités" ni "Raisons" ne sont exploitables, utilise l'industrie et le segment pour formuler une accroche sectorielle (ex: pour une firme en tech → "les lancements de produits et événements clients").

### Règle absolue
Ne dis JAMAIS "j'ai vu que vous…", "j'ai remarqué que…" ou toute formulation qui implique une observation personnelle, sauf si tu peux la rattacher à une information explicitement fournie dans le contexte (nom d'événement, fait vérifiable). Préfère des formulations comme "Votre secteur amène souvent…" ou adresse-toi directement au besoin.

---
## STRUCTURE DU MESSAGE
1. **Salutation** : Utilise le prénom du contact si disponible. Sinon son titre (ex: "Bonjour [Titre],"). Si ni le prénom ni le titre ne sont disponibles, utilise "Bonjour," et adresse-toi à "votre équipe événementielle" ou "l'équipe responsable des événements" dans le corps du message.
2. **Accroche (1-2 phrases)** : Montre que le message est pertinent pour EUX. Connecte à l'opportunité, la raison de pertinence ou le secteur selon la hiérarchie ci-dessus. Pas de flatterie générique.
3. **Proposition de valeur (1-2 phrases)** : Connecte une capacité concrète de SYNC à un bénéfice tangible pour le prospect. Exemples de bénéfices : "assurer une expérience impeccable pour vos participants", "amplifier la portée de votre message auprès d'un auditoire à distance", "rehausser la production de vos événements internes". Ne liste pas des services — montre un résultat.
4. **Appel à l'action (CTA) — contextuel** :
   - Si une opportunité ou un événement futur est identifié : "Seriez-vous ouvert·e à un court échange pour voir comment on pourrait vous accompagner sur [événement/besoin] ?"
   - Si l'approche est plus générale (Priorité 2 ou 3) : CTA plus soft → "Avez-vous un calendrier d'événements pour les prochains mois ?" ou "Est-ce qu'un appel de 15 minutes cette semaine ou la prochaine vous conviendrait ?"
   - Pour LinkedIn : le CTA doit être encore plus léger. Une question ouverte suffit.
5. **Signature** : Ne génère PAS de signature. Elle est ajoutée automatiquement.

---
## RÈGLES PAR CANAL
- **email** : Inclus un objet (champ "subject"). L'objet doit être court (≤ 8 mots), spécifique au prospect si possible, sans ponctuation excessive ni majuscules artificielles. Pas d'émojis.
- **linkedin** : Le champ "subject" doit être null. Le message doit être plus court, conversationnel, sans formule de politesse élaborée. Tutoiement acceptable si le ton du secteur s'y prête, mais vouvoiement par défaut.

---
## CAS LIMITES
- Si le nom de l'entreprise est manquant, ne le mentionne pas — formule le message autour du secteur ou du rôle du contact.
- Si presque tout le contexte est vide, rédige un message court et honnête basé sur le secteur d'activité, sans inventer de détails. Mieux vaut un message bref et authentique qu'un message long et générique.
- Ne génère jamais de contenu fictif ou d'hypothèses présentées comme des faits.

---
## FORMAT DE SORTIE
Réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ni après :
{ "subject": string | null, "body": string }`;

  const context = `
Entreprise: ${prospect?.companyName || ""}
Site: ${prospect?.website || ""}
Industrie: ${prospect?.industry || ""}
Localisation: ${JSON.stringify(prospect?.location || {})}
Score pertinence: ${prospect?.relevanceScore || ""}
Segment: ${segment}
Raisons: ${(prospect?.relevanceReasons || []).join("; ")}
Opportunités: ${(prospect?.opportunities || []).map(o => o.label).join("; ")}
Approche recommandée: ${prospect?.recommendedApproach || ""}
Contact: ${firstName || "Responsable"}${contact?.title ? `, ${contact.title}` : ""}${contact?.email ? `, ${contact.email}` : ""}
Canal: ${channel}
Type message: ${templateType}
`;

  const templateContext = template ? `
Template de base à personnaliser (adapte au contexte, ne copie pas mot pour mot):
${template.body}` : "";

  const result = await callOpenAI([
    { role: "system", content: systemPrompt },
    { role: "user", content: `Génère un message personnalisé pour ce prospect.\n\n${context}\n${templateContext}\n\nNom expéditeur: ${senderName}\nPrénom contact: ${firstName || "Responsable"}` }
  ]);

  // Replace template variables
  if (result.body) {
    result.body = result.body
      .replace(/\{firstName\}/g, firstName)
      .replace(/\{senderName\}/g, senderName)
      .replace(/\{senderTitle\}/g, "Représentant(e) SYNC Productions");
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

  // Return both legacy fields + new structured fields
  result.generatedBody = result.body;
  result.generatedSubject = result.subject || null;

  return Response.json(result);
});