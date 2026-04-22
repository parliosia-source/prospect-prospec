import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ─── Résolution du tenant (règle GROUPE 3) ───────────────────────────────────
async function resolveTenant(base44: any, payload: any): Promise<any> {
  const tenantId =
    payload.tenantId ||
    payload.campaign?.tenantId ||
    payload.prospect?.tenantId ||
    "sync-default";

  try {
    const results = await base44.asServiceRole.entities.TenantSettings.filter({ tenantId, isActive: true }, "-created_date", 1);
    if (results && results.length > 0) return results[0];
  } catch (_) { /* continue to fallback */ }

  try {
    const fallback = await base44.asServiceRole.entities.TenantSettings.filter({ settingsId: "global" }, "-created_date", 1);
    if (fallback && fallback.length > 0) return fallback[0];
  } catch (_) { /* ignore */ }

  return {
    companyName: "Notre entreprise",
    serviceOffering: "",
    defaultLanguage: "FR_CA",
    senderTitle: "Représentant(e)",
    messageTone: "PROFESSIONNEL",
    defaultCity: "",
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const payload = await req.json();
    const { originalMessage, userInstructions, senderName, prospect } = payload;

    if (!originalMessage) return Response.json({ error: "originalMessage requis" }, { status: 400 });

    // Résoudre le tenant actif
    const tenant = await resolveTenant(base44, payload);

    const isEnglish = tenant.defaultLanguage === "EN_CA" || tenant.defaultLanguage === "EN_US";
    const tone = tenant.messageTone || "PROFESSIONNEL";

    const toneInstruction = isEnglish
      ? (tone === "CHALEUREUX" ? "warm and personable" : tone === "DIRECT" ? "direct and concise" : "professional and credible")
      : (tone === "CHALEUREUX" ? "chaleureux et humain" : tone === "DIRECT" ? "direct et concis" : "professionnel et crédible");

    const systemPrompt = isEnglish
      ? `You are helping refine a business development message for ${senderName || "a representative"}, ${tenant.senderTitle || "Representative"} at ${tenant.companyName} (${tenant.defaultCity || "Canada"}).

Company: ${tenant.companyName}
What we do: ${tenant.serviceOffering || "professional services"}
Tone: ${toneInstruction}

Apply only the requested changes. Keep what works. Do not reinvent the message.
Output strictly valid JSON: {"subject": "...", "body": "..."}`
      : `Tu aides à affiner un message de prospection pour ${senderName || "un(e) représentant(e)"}, ${tenant.senderTitle || "Représentant(e)"} chez ${tenant.companyName} (${tenant.defaultCity || "Montréal"}).

Entreprise : ${tenant.companyName}
Ce qu'on fait : ${tenant.serviceOffering || "services professionnels"}
Ton : ${toneInstruction}

Applique uniquement les modifications demandées. Conserve ce qui fonctionne. Ne réinvente pas le message.
Retourne strictement du JSON valide : {"subject": "...", "body": "..."}`;

    const userPrompt = isEnglish
      ? `Original message:\n${JSON.stringify(originalMessage)}\n\nRequested changes: ${userInstructions || "Improve clarity and impact"}\n\nReturn the refined message as JSON: {"subject": "...", "body": "..."}`
      : `Message original :\n${JSON.stringify(originalMessage)}\n\nModifications demandées : ${userInstructions || "Améliorer la clarté et l'impact"}\n\nRetourne le message affiné en JSON : {"subject": "...", "body": "..."}`;

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
        temperature: 0.6,
        max_tokens: 600,
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
    });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});