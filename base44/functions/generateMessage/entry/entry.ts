import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ─── Résolution du tenant (règle GROUPE 3) ───────────────────────────────────
async function resolveTenant(base44: any, payload: any): Promise<any> {
  // 1. tenantId explicite dans le payload
  // 2. tenantId porté par un objet métier dans le payload
  // 3. fallback sync-default
  const tenantId =
    payload.tenantId ||
    payload.campaign?.tenantId ||
    payload.prospect?.tenantId ||
    "sync-default";

  // Tenter de charger par tenantId
  try {
    const results = await base44.asServiceRole.entities.TenantSettings.filter({ tenantId, isActive: true }, "-created_date", 1);
    if (results && results.length > 0) return results[0];
  } catch (_) { /* continue to fallback */ }

  // Fallback sur settingsId = "global"
  try {
    const fallback = await base44.asServiceRole.entities.TenantSettings.filter({ settingsId: "global" }, "-created_date", 1);
    if (fallback && fallback.length > 0) return fallback[0];
  } catch (_) { /* ignore */ }

  // Fallback ultime si la table est vide
  return {
    companyName: "Notre entreprise",
    serviceOffering: "",
    targetMarket: "",
    defaultCity: "",
    defaultLanguage: "FR_CA",
    senderTitle: "Représentant(e)",
    messageTone: "PROFESSIONNEL",
  };
}

// ─── Construction du systemPrompt tenant-aware ────────────────────────────────
function buildSystemPrompt(tenant: any): string {
  const isEnglish = tenant.defaultLanguage === "EN_CA" || tenant.defaultLanguage === "EN_US";
  const tone = tenant.messageTone || "PROFESSIONNEL";

  if (isEnglish) {
    const toneInstruction =
      tone === "CHALEUREUX" ? "warm and personable" :
      tone === "DIRECT" ? "direct and concise" :
      "professional and credible";

    return `You are a business development representative at ${tenant.companyName}, based in ${tenant.defaultCity || "Canada"}.

Company: ${tenant.companyName}
What we do: ${tenant.serviceOffering || "professional services"}
Who we serve: ${tenant.targetMarket || "businesses"}
Your title: ${tenant.senderTitle || "Representative"}

Writing style: ${toneInstruction}. No fluff. No unverifiable claims. Keep it short and conversational.

Rules:
- Write in natural Canadian English
- Soft CTA only (no pressure)
- Do not invent facts about the prospect
- Output strictly valid JSON as instructed`;
  }

  const toneInstruction =
    tone === "CHALEUREUX" ? "chaleureux et humain, sans être familier" :
    tone === "DIRECT" ? "direct et concis, sans formule creuse" :
    "professionnel et crédible";

  return `Tu es un(e) représentant(e) au développement des affaires chez ${tenant.companyName}, basé(e) à ${tenant.defaultCity || "Montréal"}.

Entreprise : ${tenant.companyName}
Ce qu'on fait : ${tenant.serviceOffering || "services professionnels"}
À qui on s'adresse : ${tenant.targetMarket || "entreprises et organisations"}
Ton titre : ${tenant.senderTitle || "Représentant(e)"}

Style d'écriture : ${toneInstruction}. Pas de fioritures. Aucune affirmation non vérifiable. Message court et conversationnel.

Règles :
- Écrire en français canadien naturel (FR-CA)
- CTA soft uniquement (pas de pression)
- Ne pas inventer de faits sur le prospect
- Sortie JSON strictement valide telle que demandée`;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const payload = await req.json();

    // Charger AppSettings pour les coûts API
    let appSettings: any = {};
    try {
      const settingsArr = await base44.asServiceRole.entities.AppSettings.filter({ settingsId: "global" }, "-created_date", 1);
      if (settingsArr && settingsArr.length > 0) appSettings = settingsArr[0];
    } catch (_) { /* non-blocking */ }

    // Résoudre le tenant actif
    const tenant = await resolveTenant(base44, payload);

    const {
      prospect,
      contact,
      channel = "LINKEDIN",
      messageType = "FIRST_MESSAGE",
      senderName,
      customInstructions,
    } = payload;

    if (!prospect) return Response.json({ error: "prospect requis" }, { status: 400 });

    const systemPrompt = buildSystemPrompt(tenant);

    const isEnglish = tenant.defaultLanguage === "EN_CA" || tenant.defaultLanguage === "EN_US";
    const displaySenderTitle = tenant.senderTitle || "Représentant(e)";
    const displayCompany = tenant.companyName;
    const displayCity = tenant.defaultCity || "Montréal";

    const userPrompt = isEnglish
      ? `Generate a ${channel} ${messageType} message for the following prospect.

Prospect: ${prospect.companyName}
Industry: ${prospect.industry || "N/A"}
Location: ${JSON.stringify(prospect.location || {})}
Segment: ${prospect.segment || "STANDARD"}
Opportunities: ${JSON.stringify(prospect.opportunities || [])}
Pain points: ${JSON.stringify(prospect.painPoints || [])}
Recommended approach: ${prospect.recommendedApproach || ""}
Contact: ${contact ? `${contact.fullName || contact.firstName || ""} — ${contact.title || ""}` : "Unknown"}
Sender: ${senderName || "the team"}, ${displaySenderTitle} at ${displayCompany} (${displayCity})
${customInstructions ? `Additional instructions: ${customInstructions}` : ""}

Return strictly valid JSON:
{"subject": "...", "body": "...", "channel": "${channel}", "language": "${tenant.defaultLanguage}"}`
      : `Génère un message ${channel} de type ${messageType} pour le prospect suivant.

Prospect : ${prospect.companyName}
Secteur : ${prospect.industry || "N/A"}
Localisation : ${JSON.stringify(prospect.location || {})}
Segment : ${prospect.segment || "STANDARD"}
Opportunités identifiées : ${JSON.stringify(prospect.opportunities || [])}
Points de douleur : ${JSON.stringify(prospect.painPoints || [])}
Approche recommandée : ${prospect.recommendedApproach || ""}
Contact : ${contact ? `${contact.fullName || contact.firstName || ""} — ${contact.title || ""}` : "Inconnu"}
Expéditeur : ${senderName || "l'équipe"}, ${displaySenderTitle} chez ${displayCompany} (${displayCity})
${customInstructions ? `Instructions supplémentaires : ${customInstructions}` : ""}

Retourne strictement du JSON valide :
{"subject": "...", "body": "...", "channel": "${channel}", "language": "${tenant.defaultLanguage}"}`;

    const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_KEY) return Response.json({ error: "OPENAI_API_KEY manquante" }, { status: 500 });

    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 800,
      }),
    });

    if (!aiRes.ok) {
      const err = await aiRes.text();
      return Response.json({ error: `OpenAI error: ${err}` }, { status: 500 });
    }

    const aiData = await aiRes.json();
    const raw = aiData.choices?.[0]?.message?.content || "{}";

    let parsed: any = {};
    try { parsed = JSON.parse(raw); } catch (_) { parsed = { body: raw }; }

    return Response.json({
      message: parsed,
      tenantId: tenant.tenantId || "sync-default",
      tenantName: tenant.companyName,
    });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});