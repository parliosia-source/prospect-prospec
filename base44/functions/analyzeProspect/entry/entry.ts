import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// TODO IT2/IT3: lire botUserAgent depuis TenantSettings
const BOT_USER_AGENT = "ProspectBot/2.0";

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPageContent(url: string): Promise<string> {
  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        "User-Agent": BOT_USER_AGENT,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "fr-CA,fr;q=0.9,en;q=0.8",
      },
    }, 12000);
    if (!res.ok) return "";
    const html = await res.text();
    // Strip tags, compress whitespace
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 8000);
  } catch (_) {
    return "";
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const payload = await req.json();
    const { prospectId, website, companyName, tenantId } = payload;

    if (!prospectId && !website) {
      return Response.json({ error: "prospectId ou website requis" }, { status: 400 });
    }

    // Charger AppSettings pour config API
    let appSettings: any = {};
    try {
      const settingsArr = await base44.asServiceRole.entities.AppSettings.filter({ settingsId: "global" }, "-created_date", 1);
      if (settingsArr && settingsArr.length > 0) appSettings = settingsArr[0];
    } catch (_) { /* non-blocking */ }

    // Charger le prospect si prospectId fourni
    let prospect: any = payload.prospect || null;
    if (!prospect && prospectId) {
      try {
        prospect = await base44.asServiceRole.entities.Prospect.get(prospectId);
      } catch (_) { /* ignore */ }
    }

    const targetWebsite = website || prospect?.website || "";
    const targetCompany = companyName || prospect?.companyName || "";

    if (!targetWebsite) {
      return Response.json({ error: "website introuvable" }, { status: 400 });
    }

    // Fetcher le contenu de la page
    const pageContent = await fetchPageContent(targetWebsite);

    // Analyse via Gemini ou OpenAI
    const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY");
    const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");

    let analysisResult: any = null;

    const analysisPrompt = `Analyse ce contenu web pour l'entreprise "${targetCompany}" (${targetWebsite}).

Contenu :
${pageContent || "(page inaccessible)"}

Retourne un JSON strictement valide avec :
{
  "industry": "secteur principal",
  "entityType": "type d'organisation (entreprise, OBNL, gouvernement, etc.)",
  "opportunities": [{"type": "string", "description": "string"}],
  "painPoints": [{"type": "string", "description": "string"}],
  "eventTypes": ["types d'événements si applicable"],
  "recommendedApproach": "approche recommandée en 1-2 phrases",
  "relevanceReasons": ["raison 1", "raison 2"],
  "eventFitScore": 0,
  "sectorScore": 0,
  "segment": "HOT|STANDARD",
  "analysisConfidence": 0.0
}`;

    if (GEMINI_KEY) {
      try {
        const geminiRes = await fetchWithTimeout(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: analysisPrompt }] }],
              generationConfig: { responseMimeType: "application/json", maxOutputTokens: 1024 },
            }),
          },
          25000
        );
        if (geminiRes.ok) {
          const gd = await geminiRes.json();
          const raw = gd.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
          analysisResult = JSON.parse(raw);
        }
      } catch (_) { /* fallback to OpenAI */ }
    }

    if (!analysisResult && OPENAI_KEY) {
      const oRes = await fetchWithTimeout(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            response_format: { type: "json_object" },
            messages: [{ role: "user", content: analysisPrompt }],
            max_tokens: 1024,
          }),
        },
        25000
      );
      if (oRes.ok) {
        const od = await oRes.json();
        const raw = od.choices?.[0]?.message?.content || "{}";
        analysisResult = JSON.parse(raw);
      }
    }

    if (!analysisResult) {
      return Response.json({ error: "Analyse impossible — toutes les APIs ont échoué" }, { status: 500 });
    }

    // Mettre à jour le prospect si prospectId fourni
    if (prospectId) {
      const updatePayload: any = {
        status: "ANALYSÉ",
        industry: analysisResult.industry,
        entityType: analysisResult.entityType,
        opportunities: analysisResult.opportunities || [],
        painPoints: analysisResult.painPoints || [],
        eventTypes: analysisResult.eventTypes || [],
        recommendedApproach: analysisResult.recommendedApproach || "",
        relevanceReasons: analysisResult.relevanceReasons || [],
        eventFitScore: analysisResult.eventFitScore || 0,
        sectorScore: analysisResult.sectorScore || 0,
        segment: analysisResult.segment || "STANDARD",
        analysisRaw: analysisResult,
      };
      if (tenantId) updatePayload.tenantId = tenantId;
      await base44.asServiceRole.entities.Prospect.update(prospectId, updatePayload);
    }

    return Response.json({ analysis: analysisResult, prospectId });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});