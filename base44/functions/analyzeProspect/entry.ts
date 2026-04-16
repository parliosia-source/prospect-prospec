import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const GEMINI_KEY      = Deno.env.get("GEMINI_API_KEY");
const BROWSERLESS_KEY = Deno.env.get("BROWSERLESS_API_KEY");
const HUNTER_KEY      = Deno.env.get("HUNTER_API_KEY");
const BRAVE_KEY       = Deno.env.get("BRAVE_API_KEY");
const SERPAPI_KEY     = Deno.env.get("SERPAPI_API_KEY");
const OPENAI_KEY      = Deno.env.get("OPENAI_API_KEY");

// ── Utility ───────────────────────────────────────────────────────────────────
function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textDensity(html) {
  const text = stripHtml(html);
  return { text, len: text.length, ratio: html.length > 0 ? text.length / html.length : 0 };
}

// ── Fetch with timeout ────────────────────────────────────────────────────────
async function fetchWithTimeout(url, opts = {}, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ── Standard HTML fetch ───────────────────────────────────────────────────────
async function fetchHtml(url) {
  try {
    const res = await fetchWithTimeout(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SyncProspectBot/2.0)" }
    });
    if (!res.ok) return null;
    return await res.text();
  } catch (_) { return null; }
}

// ── Browserless render fallback ───────────────────────────────────────────────
async function browserlessRender(url) {
  if (!BROWSERLESS_KEY) return null;
  try {
    const res = await fetchWithTimeout(
      `https://chrome.browserless.io/content?token=${BROWSERLESS_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, gotoOptions: { waitUntil: "networkidle2", timeout: 10000 } }),
      },
      15000
    );
    if (!res.ok) return null;
    return await res.text();
  } catch (_) { return null; }
}

// ── Smart page fetch: standard first, fallback Browserless ────────────────────
async function smartFetch(url) {
  const html = await fetchHtml(url);
  if (html) {
    const { text, len, ratio } = textDensity(html);
    if (len >= 4000 && ratio >= 0.05) return { text: text.slice(0, 12000), source: "standard", url };
    const rendered = await browserlessRender(url);
    if (rendered) {
      const r = textDensity(rendered);
      if (r.len > len) return { text: r.text.slice(0, 12000), source: "browserless", url };
    }
    return { text: text.slice(0, 12000), source: "standard_thin", url };
  }
  const rendered = await browserlessRender(url);
  if (rendered) {
    const r = textDensity(rendered);
    return { text: r.text.slice(0, 12000), source: "browserless", url };
  }
  return null;
}

// ── Crawl multiple pages — parallel with hard cap ────────────────────────────
const SUBPAGES = [
  "", "/about", "/a-propos", "/team", "/equipe", "/notre-equipe",
  "/leadership", "/management", "/contact", "/nous-joindre",
  "/qui-sommes-nous", "/en/about", "/en/team", "/direction", "/gouvernance"
];

async function crawlSite(domain) {
  const base = `https://${domain}`;
  const results = await Promise.allSettled(
    SUBPAGES.map(path => smartFetch(base + path))
  );
  const pages = results
    .filter(r => r.status === "fulfilled" && r.value && r.value.text.length > 200)
    .map(r => r.value);
  return { pages, scannedCount: SUBPAGES.length };
}

// ── Gemini call ───────────────────────────────────────────────────────────────
async function callGemini(prompt) {
  if (!GEMINI_KEY) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;
  try {
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
      })
    }, 30000);
    if (!res.ok) {
      console.error(`[GEMINI] ${res.status}: ${await res.text().catch(() => "")}`);
      return null;
    }
    const data = await res.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.error("[GEMINI] parse error:", e.message);
    return null;
  }
}

// ── OpenAI call ───────────────────────────────────────────────────────────────
async function callOpenAI(messages) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini", messages, response_format: { type: "json_object" } })
  });
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

// ── Brave / SERP helpers ──────────────────────────────────────────────────────
async function braveQuery(query, count = 8) {
  if (!BRAVE_KEY) return [];
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&country=ca&search_lang=fr&extra_snippets=true`;
    const res = await fetchWithTimeout(url, {
      headers: { "Accept": "application/json", "X-Subscription-Token": BRAVE_KEY }
    }, 8000);
    if (!res.ok) return [];
    const data = await res.json();
    return data.web?.results || [];
  } catch (_) { return []; }
}

async function serpQuery(query, count = 8) {
  if (!SERPAPI_KEY) return [];
  try {
    const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&num=${count}&api_key=${SERPAPI_KEY}`;
    const res = await fetchWithTimeout(url, {}, 8000);
    const data = await res.json();
    return data.organic_results || [];
  } catch (_) { return []; }
}

// ── Gemini contact extraction from crawled site text ─────────────────────────
async function extractContactsGemini(companyName, domain, crawledText) {
  const prompt = `Tu es un expert en recherche de contacts B2B pour une entreprise de production audiovisuelle événementielle à Montréal.

ENTREPRISE CIBLE: ${companyName}
DOMAINE: ${domain}

TEXTE EXTRAIT DU SITE WEB:
${crawledText.slice(0, 15000)}

OBJECTIF: Identifier les décideurs pertinents pour des services événementiels B2B (audiovisuel, conférences, galas, assemblées).

RÔLES PRIORITAIRES (par ordre):
1. Marketing / Communications
2. Événements / Events
3. RH / Ressources Humaines
4. VP / Direction générale
5. Développement des affaires
6. Expérience client / Brand

RÈGLES STRICTES:
- N'invente AUCUN nom, titre ou email. Utilise UNIQUEMENT ce qui est dans le texte.
- Pour chaque contact, indique "verified": true uniquement si le nom complet est présent dans le texte.
- Si seulement un titre/rôle est trouvé (sans nom), inclus-le quand même avec name: "" et verified: false.

Extrais TOUS les contacts trouvés dans le texte. Pour chaque contact, fournis:
- name: nom complet tel que trouvé dans le texte (ou "" si absent)
- title: titre/poste exact tel que trouvé
- linkedin_url: URL LinkedIn si trouvée dans le texte (sinon "")
- email: email si trouvé dans le texte (sinon "")
- role_category: une des catégories prioritaires ci-dessus
- confidence_score: 0-100 (basé sur la qualité des données trouvées, pas sur une supposition)
- verified: true si nom complet trouvé dans le texte, false sinon

Réponds en JSON strict:
{"contacts": [...]}

Si aucun contact n'est trouvé dans le texte, retourne {"contacts": []}.`;

  return await callGemini(prompt);
}

// ── LinkedIn search via web — runs in parallel with multiple queries ──────────
async function linkedInSearch(companyName, domain) {
  // Multiple query angles run in parallel for better recall
  const queries = [
    `site:linkedin.com/in "${companyName}" (directeur OR directrice OR VP OR responsable OR manager OR gestionnaire) (marketing OR communications OR événements OR events)`,
    `site:linkedin.com/in "${companyName}" (marketing OR communications OR événements OR "ressources humaines" OR "développement")`,
    `site:linkedin.com/in "${domain}" (directeur OR VP OR responsable OR manager)`,
    `"${companyName}" linkedin.com/in directeur communications OR "directeur marketing" OR "VP marketing" OR "responsable événements"`,
  ];

  const seen = new Set();
  const allResults = [];

  // Run all queries in parallel
  const batchResults = await Promise.allSettled(
    queries.map(q => braveQuery(q, 8))
  );

  for (const batch of batchResults) {
    if (batch.status !== "fulfilled") continue;
    for (const r of batch.value) {
      const url = (r.url || r.link || "").split("?")[0].replace(/\/$/, "");
      if (!url.includes("linkedin.com/in/")) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      // Use extra_snippets for richer context
      const snippet = [r.description, ...(r.extra_snippets || [])].filter(Boolean).join(" ").slice(0, 300);
      allResults.push({ url, title: r.title || "", snippet });
    }
  }

  // SERP fallback only if Brave returned very little
  if (allResults.length < 3 && SERPAPI_KEY) {
    const serpResults = await serpQuery(
      `site:linkedin.com/in "${companyName}" marketing OR communications OR événements`, 8
    );
    for (const r of serpResults) {
      const url = (r.link || "").split("?")[0].replace(/\/$/, "");
      if (!url.includes("linkedin.com/in/") || seen.has(url)) continue;
      seen.add(url);
      allResults.push({ url, title: r.title || "", snippet: r.snippet || "" });
    }
  }

  if (allResults.length === 0) return [];

  // Parse with Gemini — stricter prompt: must verify affiliation, allow partial names
  const prompt = `Tu es un expert en identification de contacts B2B. Tu dois être PRÉCIS et ne jamais inventer.

ENTREPRISE: ${companyName} (domaine: ${domain})
OBJECTIF: Services événementiels B2B à Montréal — trouver décideurs en marketing, communications, événements, RH, direction.

Voici des résultats de recherche LinkedIn:
${allResults.slice(0, 15).map((r, i) => `${i + 1}. URL: ${r.url}\n   Titre page: ${r.title}\n   Extrait: ${r.snippet}`).join("\n\n")}

RÈGLES:
1. N'inclus QUE les personnes qui travaillent CLAIREMENT chez ${companyName} (le titre ou l'extrait doit le confirmer).
2. Extrais le nom depuis le titre de la page LinkedIn (format habituel: "Prénom Nom - Titre - Entreprise").
3. Si le nom ne peut pas être extrait du texte fourni, met name: "".
4. Le champ "verified" = true uniquement si le nom complet est clairement présent et le lien avec ${companyName} est confirmé.
5. Ne jamais inventer un nom, un email, ou une affiliation.
6. Inclus maximum 5 contacts.

Pour chaque contact pertinent, fournis:
- name: nom extrait du texte (ou "" si impossible à extraire)
- title: poste/titre extrait du texte
- linkedin_url: URL LinkedIn nettoyée (sans paramètres)
- email: "" (toujours vide — non disponible via LinkedIn public)
- role_category: Marketing|Communications|Événements|RH|Direction|Développement
- confidence_score: 0-100
- verified: true si nom ET affiliation ${companyName} sont confirmés dans le texte

Réponds en JSON strict: {"contacts": [...]}`;

  const result = await callGemini(prompt);
  return result?.contacts || [];
}

// ── Scoring interne ───────────────────────────────────────────────────────────
const DECISION_ROLES = /directeur|directrice|vp |vice.pr[eé]|chef|head of|responsable|manager|gestionnaire|charg[eé]|coordonnateur|coordinat/i;
const EVENT_ROLES    = /marketing|communication|événement|event|expérience|brand|relations|rh|ressources humaines|développement des affaires|business develop/i;

function scoreContact(contact, hasTeamPage) {
  let score = contact.confidence_score || 0;
  const title = (contact.title || "").toLowerCase();
  if (DECISION_ROLES.test(title)) score += 35;
  if (EVENT_ROLES.test(title)) score += 20;
  if (contact.linkedin_url && contact.linkedin_url.includes("linkedin.com/in/")) score += 20;
  if (contact.email && contact.email.includes("@")) score += 25;
  if (contact.verified) score += 15;
  if (contact.name && contact.name.trim().split(" ").length >= 2) score += 10; // has first + last name
  if (hasTeamPage) score += 5;
  return Math.min(score, 100);
}

// ── Hunter domain search ──────────────────────────────────────────────────────
async function hunterDomainSearch(domain, company) {
  if (!HUNTER_KEY) return { data: { emails: [] } };
  try {
    const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&company=${encodeURIComponent(company || "")}&limit=10&api_key=${HUNTER_KEY}`;
    const res = await fetchWithTimeout(url, {}, 8000);
    return await res.json();
  } catch (_) { return { data: { emails: [] } }; }
}

// ── Clean and validate a LinkedIn URL ─────────────────────────────────────────
function cleanLinkedInUrl(url) {
  if (!url || !url.includes("linkedin.com/in/")) return "";
  return url.split("?")[0].replace(/\/$/, "").replace(/\/[a-z]{2}_[A-Z]{2}$/, "");
}

// ── Save contacts to DB ───────────────────────────────────────────────────────
async function saveContacts(base44, prospectId, prospect, contacts) {
  const saved = [];
  const seen = new Set();

  for (const c of contacts) {
    // Build a stable dedup key — for title-only stubs, use title
    const key = (cleanLinkedInUrl(c.linkedin_url) || c.email || c.name || c.title || "").toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);

    // Skip duplicates already in DB
    const filters = c.email
      ? { prospectId, email: c.email }
      : cleanLinkedInUrl(c.linkedin_url)
        ? { prospectId, linkedinUrl: cleanLinkedInUrl(c.linkedin_url) }
        : null;
    if (filters) {
      const existing = await base44.entities.Contact.filter(filters).catch(() => []);
      if (existing.length > 0) continue;
    }

    try {
      const cleanLi = cleanLinkedInUrl(c.linkedin_url);
      const parts = (c.name || "").trim().split(/\s+/);
      const hasFullName = parts.length >= 2 && parts[0].length > 1 && parts[1].length > 1;

      const record = await base44.entities.Contact.create({
        prospectId,
        ownerUserId:     prospect.ownerUserId,
        firstName:       hasFullName ? parts[0] : "",
        lastName:        hasFullName ? parts.slice(1).join(" ") : "",
        fullName:        hasFullName ? c.name.trim() : "",
        title:           c.title || "",
        email:           c.email || "",
        emailConfidence: c.email ? Math.max(c.confidence_score || 50, 50) : 0,
        linkedinUrl:     cleanLi,
        hasEmail:        !!(c.email && c.email.includes("@")),
        // "verified" = we have a real name confirmed from source text/page
        // Use source field to distinguish: HUNTER > SERP (real name) > SERP (stub/role-only)
        source:          c.source === "HUNTER" ? "HUNTER" : "SERP",
        contactPageUrl:  c.contact_page_url || "",
        // Store isStub so UI can label it appropriately
        isStub:          !hasFullName && !c.email,
      });
      saved.push(record);
    } catch (e) {
      console.error(`[SAVE] Contact error: ${e.message}`);
    }
  }
  return saved;
}

// ── Main handler ──────────────────────────────────────────────────────────────
const GLOBAL_TIMEOUT_MS = 50000;

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { prospectId } = body;
  if (!prospectId) return Response.json({ error: "prospectId requis" }, { status: 400 });

  const prospects = await base44.entities.Prospect.filter({ id: prospectId });
  const prospect = prospects[0];
  if (!prospect) return Response.json({ error: "Prospect introuvable" }, { status: 404 });
  if (prospect.ownerUserId !== user.email && user.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Load API costs
  let apiCosts = {
    "OpenAI_Short": { unitCost: 0.002, unitType: "call" },
    "Hunter.io": { unitCost: 0.01, unitType: "verification" },
    "Brave Search": { unitCost: 0.001, unitType: "query" },
    "SerpAPI": { unitCost: 0.005, unitType: "query" },
    "Gemini": { unitCost: 0.003, unitType: "call" },
  };
  const settingsArr = await base44.asServiceRole.entities.AppSettings.filter({ settingsId: "global" }).catch(() => []);
  if (settingsArr[0]?.apiCosts) apiCosts = { ...apiCosts, ...settingsArr[0].apiCosts };

  async function logApiUsage(apiName, status, extraFields = {}) {
    await base44.asServiceRole.entities.ApiUsageLog.create({
      timestamp: new Date().toISOString(),
      apiName,
      functionName: "analyzeProspect",
      cost: (apiCosts[apiName]?.unitCost || 0) * (extraFields.unitsUsed || 1),
      unitsUsed: extraFields.unitsUsed || 1,
      unitType: apiCosts[apiName]?.unitType || "call",
      prospectId,
      ownerUserId: user.email,
      status,
      ...extraFields,
    }).catch(() => {});
  }

  const logs = [];
  const log = (msg) => { console.log(`[ANALYZE] ${msg}`); logs.push(msg); };
  log(`START: ${prospect.companyName} (${prospect.domain})`);

  const analysisPromise = runAnalysis(base44, user, prospect, prospectId, logApiUsage, log, logs);
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout after ${GLOBAL_TIMEOUT_MS}ms`)), GLOBAL_TIMEOUT_MS)
  );

  try {
    return await Promise.race([analysisPromise, timeoutPromise]);
  } catch (timeoutErr) {
    console.error(`[ANALYZE] Global timeout for ${prospectId}:`, timeoutErr.message);
    await base44.entities.Prospect.update(prospectId, {
      status: "FAILED_ANALYSIS",
      analysisError: timeoutErr.message,
      analysisErrorAt: new Date().toISOString(),
    }).catch(() => {});
    return Response.json({ error: timeoutErr.message, prospectId }, { status: 408 });
  }
});

async function runAnalysis(base44, user, prospect, prospectId, logApiUsage, log, logs) {
  // ── PHASE 1: Crawl + LinkedIn search in parallel ────────────────────────────
  // Run crawl AND LinkedIn search simultaneously — don't wait for crawl to decide on LinkedIn
  log("Phase 1: Crawling site + LinkedIn search in parallel...");

  const [crawlResult, linkedInRaw] = await Promise.all([
    crawlSite(prospect.domain),
    linkedInSearch(prospect.companyName, prospect.domain),
  ]);

  const { pages, scannedCount } = crawlResult;
  log(`Crawled ${scannedCount} paths, ${pages.length} with content`);
  log(`LinkedIn search: ${linkedInRaw.length} candidates`);

  const hasTeamPage = pages.some(p => /team|equipe|leadership|management|notre-equipe|direction|gouvernance/.test(p.url));

  // Build crawled text — annotate each page with its URL for context
  const crawledText = pages.map(p => `--- PAGE: ${p.url} (${p.source}) ---\n${p.text}`).join("\n\n");

  // ── PHASE 2: Parallel extraction ────────────────────────────────────────────
  log("Phase 2: Parallel extraction (Gemini website + Hunter + OpenAI analysis)...");

  const [geminiResult, hunterResult, analysis] = await Promise.all([
    crawledText.length > 500
      ? extractContactsGemini(prospect.companyName, prospect.domain, crawledText)
      : Promise.resolve({ contacts: [] }),
    hunterDomainSearch(prospect.domain, prospect.companyName),
    callOpenAI([
      {
        role: "system",
        content: `Tu es un expert en prospection B2B pour SYNC Productions (Montréal).
SYNC = partenaire audiovisuel événementiel : son, éclairage, captation vidéo, webdiffusion/hybride pour conférences, congrès, assemblées générales, galas, formations internes, townhalls.
ICP : entreprises/organisations qui ORGANISENT leurs propres événements corporatifs.
Ton : professionnel, concis, FR-CA. Tu n'inventes aucun fait. JSON strict uniquement.`
      },
      {
        role: "user",
        content: `Analyse ce prospect pour SYNC Productions:

Entreprise: ${prospect.companyName}
Site: ${prospect.website}
Domaine: ${prospect.domain}
Industrie: ${prospect.industry || "inconnue"}
Localisation: ${JSON.stringify(prospect.location || {})}
Type: ${prospect.entityType || ""}
Snippet: ${prospect.serpSnippet || ""}
Source: ${prospect.sourceOrigin || "WEB"}
Contenu crawlé (résumé): ${crawledText.slice(0, 3000)}

Réponds en JSON:
{
  "relevanceScore": number (0-100),
  "segment": "HOT|STANDARD",
  "relevanceReasons": ["raison 1", "raison 2", "raison 3"],
  "opportunities": [{"label": string, "detail": string}],
  "painPoints": [{"label": string, "detail": string}],
  "eventTypes": ["types d'événements probables"],
  "recommendedApproach": "angle d'approche SYNC en 1-2 phrases concrètes, axé réduction de risque / qualité AV / hybridation",
  "decisionMakerTitles": ["titres des décideurs à cibler"]
}`
      }
    ]),
  ]);

  logApiUsage("OpenAI_Short", "SUCCESS");
  if (geminiResult?.contacts?.length > 0) logApiUsage("Gemini", "SUCCESS");
  if (linkedInRaw.length > 0) logApiUsage("Gemini", "SUCCESS");

  // Process Hunter contacts — raise confidence threshold to 50 for trustworthiness
  const hunterContacts = (hunterResult?.data?.emails || [])
    .filter(e => e.confidence >= 50)
    .slice(0, 5)
    .map(e => ({
      name: `${e.first_name || ""} ${e.last_name || ""}`.trim(),
      title: e.position || "",
      email: e.value,
      linkedin_url: e.linkedin || "",
      confidence_score: e.confidence,
      role_category: "unknown",
      source: "HUNTER",
      verified: !!(e.first_name && e.last_name),
    }));

  logApiUsage("Hunter.io", hunterContacts.length > 0 ? "SUCCESS" : "FAILED", { unitsUsed: Math.max(hunterContacts.length, 1) });
  log(`Hunter: ${hunterContacts.length} contacts (≥50% confidence)`);

  // Website Gemini contacts — attach the specific page URL where each was found
  // The Gemini prompt returns contacts without page attribution, so we map to the most relevant page
  const geminiWebsiteContacts = (geminiResult?.contacts || []).map(c => {
    // Find the best source page: prefer team/contact/leadership pages
    const teamPage = pages.find(p => /team|equipe|leadership|direction|management|gouvernance/.test(p.url));
    const contactPage = pages.find(p => /contact|nous-joindre/.test(p.url));
    const sourcePage = teamPage || contactPage || pages[0];
    return {
      ...c,
      source: "website_gemini",
      contact_page_url: sourcePage?.url || "",
    };
  });
  log(`Gemini website: ${geminiWebsiteContacts.length} contacts`);
  log(`LinkedIn search: ${linkedInRaw.length} contacts parsed`);

  // LinkedIn contacts — already parsed by Gemini above
  const linkedInContacts = linkedInRaw.map(c => ({
    ...c,
    source: "linkedin_search",
    linkedin_url: cleanLinkedInUrl(c.linkedin_url),
  }));

  // ── PHASE 3: Merge, score, deduplicate ──────────────────────────────────────
  log("Phase 3: Scoring and merging all sources...");

  const allContacts = [
    ...hunterContacts,           // highest trust — have real emails
    ...geminiWebsiteContacts,    // crawled from company site
    ...linkedInContacts,         // LinkedIn SERP results
  ];

  for (const c of allContacts) {
    c.contact_confidence_score = scoreContact(c, hasTeamPage);
  }

  allContacts.sort((a, b) => (b.contact_confidence_score || 0) - (a.contact_confidence_score || 0));

  // Take top 5 real contacts, plus up to 2 title-only stubs if we still have < 2 real ones
  const realContacts = allContacts.filter(c => c.name && c.name.trim().split(/\s+/).length >= 2);
  const stubContacts = allContacts.filter(c => !c.name || c.name.trim().split(/\s+/).length < 2);

  let topContacts = realContacts.slice(0, 5);
  // If fewer than 2 real contacts found, append up to 2 stubs so we don't return nothing
  if (topContacts.length < 2) {
    topContacts = [...topContacts, ...stubContacts.slice(0, 2 - topContacts.length)];
  }
  log(`Final: ${topContacts.length} contacts (${realContacts.length} with full name, ${stubContacts.length} role-only)`);

  // ── PHASE 4: Save ──────────────────────────────────────────────────────────
  log("Phase 4: Saving contacts...");
  const savedContacts = await saveContacts(base44, prospectId, prospect, topContacts);

  // If still nothing — create title-only stubs from AI analysis, clearly marked
  if (savedContacts.length === 0 && analysis.decisionMakerTitles?.length > 0) {
    log("No contacts saved — creating role-only stubs from AI titles...");
    const verifiedContactPage = pages.find(p => /contact|nous-joindre/.test(p.url))?.url || "";
    for (const title of analysis.decisionMakerTitles.slice(0, 2)) {
      try {
        await base44.entities.Contact.create({
          prospectId,
          ownerUserId:   prospect.ownerUserId,
          fullName:      "",
          firstName:     "",
          lastName:      "",
          title,
          hasEmail:      false,
          contactPageUrl: verifiedContactPage,
          source:        "SERP",
          isStub:        true,
        });
        savedContacts.push({ title, stub: true });
      } catch (_) {}
    }
  }

  // ── Update prospect ────────────────────────────────────────────────────────
  const bestContact = topContacts.find(c => c.name && c.name.trim().split(/\s+/).length >= 2) || topContacts[0];
  await base44.entities.Prospect.update(prospectId, {
    status:              "ANALYSÉ",
    relevanceScore:      analysis.relevanceScore,
    segment:             analysis.segment,
    relevanceReasons:    analysis.relevanceReasons,
    opportunities:       analysis.opportunities,
    painPoints:          analysis.painPoints,
    eventTypes:          analysis.eventTypes,
    recommendedApproach: analysis.recommendedApproach,
    analysisRaw: {
      ...analysis,
      smartFetchEnabled: true,
      pagesScannedCount: scannedCount,
      pagesWithContent: pages.length,
      hasTeamPage,
      contactSources: {
        hunter: hunterContacts.length,
        geminiWebsite: geminiWebsiteContacts.length,
        linkedInSearch: linkedInContacts.length,
        realContacts: realContacts.length,
        stubContacts: stubContacts.length,
      },
      bestContact: bestContact ? {
        name: bestContact.name,
        title: bestContact.title,
        linkedin_url: bestContact.linkedin_url,
        email: bestContact.email,
        score: bestContact.contact_confidence_score,
        source: bestContact.source,
        verified: bestContact.verified,
      } : null,
    },
    contactPageUrl: pages.find(p => /contact|nous-joindre/.test(p.url))?.url || prospect.contactPageUrl || "",
    analysisError: null,
    analysisErrorAt: null,
  });

  await base44.entities.ActivityLog.create({
    ownerUserId: user.email,
    actionType: "ANALYZE_PROSPECT",
    entityType: "Prospect",
    entityId: prospectId,
    payload: {
      relevanceScore: analysis.relevanceScore,
      segment: analysis.segment,
      pagesScanned: scannedCount,
      contactsFound: topContacts.length,
      contactsSaved: savedContacts.length,
      realContactsFound: realContacts.length,
      sources: { hunter: hunterContacts.length, geminiWebsite: geminiWebsiteContacts.length, linkedIn: linkedInContacts.length },
    },
    status: "SUCCESS",
  }).catch(() => {});

  log(`DONE: score=${analysis.relevanceScore}, contacts=${savedContacts.length} (${realContacts.length} with name)`);

  return Response.json({
    success: true,
    analysis: { relevanceScore: analysis.relevanceScore, segment: analysis.segment },
    contacts: {
      total: savedContacts.length,
      hunter: hunterContacts.length,
      geminiWebsite: geminiWebsiteContacts.length,
      linkedIn: linkedInContacts.length,
      withFullName: realContacts.length,
    },
    crawl: { pagesScanned: scannedCount, pagesWithContent: pages.length, hasTeamPage },
    logs,
  });
}