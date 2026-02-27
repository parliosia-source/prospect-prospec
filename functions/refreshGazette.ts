import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { addDays, format } from 'npm:date-fns@3';

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");
const BRAVE_KEY = Deno.env.get("BRAVE_API_KEY");

async function braveSearch(query, count = 5) {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&freshness=pw&country=ca&search_lang=fr`;
  const res = await fetch(url, { headers: { "Accept": "application/json", "X-Subscription-Token": BRAVE_KEY } });
  const data = await res.json();
  return data.web?.results || [];
}

async function callOpenAI(prompt) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Tu génères des items pour une gazette de prospection B2B. Entreprises ciblées: organisateurs d'événements corporatifs au Québec. Sortie JSON strict uniquement." },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
    })
  });
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return Response.json({ error: "Forbidden: Admin access required" }, { status: 403 });

  const today = format(new Date(), "yyyy-MM-dd");
  const lookahead = format(addDays(new Date(), 90), "yyyy-MM-dd");

  // Load API costs
  let apiCosts = {
    "Brave Search": { unitCost: 0.001, unitType: "query" },
    "OpenAI_Short": { unitCost: 0.002, unitType: "call" },
  };
  const settingsArr = await base44.asServiceRole.entities.AppSettings.filter({ settingsId: "global" }).catch(() => []);
  if (settingsArr[0]?.apiCosts) apiCosts = { ...apiCosts, ...settingsArr[0].apiCosts };

  async function logApiUsage(apiName, status, unitsUsed = 1) {
    await base44.asServiceRole.entities.ApiUsageLog.create({
      timestamp: new Date().toISOString(),
      apiName,
      functionName: "refreshGazette",
      cost: (apiCosts[apiName]?.unitCost || 0) * unitsUsed,
      unitsUsed,
      unitType: apiCosts[apiName]?.unitType || "call",
      ownerUserId: user.email,
      status,
    }).catch(() => {});
  }

  // Search for upcoming events in Quebec
  const queries = [
    "conférence annuelle Québec Montréal 2025 2026 inscription",
    "congrès colloque AGA Québec Montréal 2025 2026",
    "gala cérémonie événement corporatif Québec 2025",
  ];

  const searchResults = await Promise.allSettled(queries.map(q => braveSearch(q, 5)));
  const allResults = [];
  let braveSuccessCount = 0;
  for (const r of searchResults) {
    if (r.status === "fulfilled") {
      allResults.push(...r.value.map(r => ({ title: r.title, url: r.url, snippet: r.snippet })));
      braveSuccessCount++;
    }
  }
  logApiUsage("Brave Search", "SUCCESS", braveSuccessCount || queries.length);

  if (allResults.length === 0) {
    return Response.json({ success: true, created: 0, reason: "No search results" });
  }

  // Log + Ask OpenAI to extract gazette items
  logApiUsage("OpenAI_Short", "SUCCESS");
  const extracted = await callOpenAI(`Voici des résultats de recherche web sur les événements et nouvelles du secteur corporatif au Québec.

${allResults.slice(0, 15).map((r, i) => `${i+1}. ${r.title}\n   URL: ${r.url}\n   Snippet: ${r.snippet}`).join("\n\n")}

Génère une liste d'items de gazette pertinents pour une équipe de vente qui prospecte des entreprises organisant des événements corporatifs.

Réponds en JSON: {
  "items": [{
    "title": string,
    "summary": string (1-2 phrases, FR-CA, concis),
    "category": "EVENT|NEWS|OPPORTUNITY",
    "sourceUrl": string|null,
    "eventDate": string|null (format YYYY-MM-DD si détectable),
    "relatedDomain": string|null,
    "cta": string|null (court, ex: "Identifier l'organisateur" ou "Contacter avant l'événement")
  }]
}`);

  let created = 0;
  for (const item of (extracted.items || []).slice(0, 8)) {
    if (!item.title) continue;
    await base44.entities.Gazette.create({
      publishDate: today,
      title: item.title,
      summary: item.summary,
      category: item.category || "NEWS",
      sourceUrl: item.sourceUrl,
      eventDate: item.eventDate,
      relatedDomain: item.relatedDomain,
      status: "ACTIVE",
      cta: item.cta,
    });
    created++;
  }

  // Archive old items (> 7 days) — run in parallel
  const oldItems = await base44.entities.Gazette.filter({ status: "ACTIVE" }, "-publishDate", 100);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const toArchive = oldItems.filter(item => item.publishDate && new Date(item.publishDate) < cutoff);
  await Promise.all(toArchive.map(item => base44.entities.Gazette.update(item.id, { status: "ARCHIVED" })));

  return Response.json({ success: true, created });
});