import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

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
    // Low content — try Browserless
    const rendered = await browserlessRender(url);
    if (rendered) {
      const r = textDensity(rendered);
      if (r.len > len) return { text: r.text.slice(0, 12000), source: "browserless", url };
    }
    return { text: text.slice(0, 12000), source: "standard_thin", url };
  }
  // Standard failed entirely — try Browserless
  const rendered = await browserlessRender(url);
  if (rendered) {
    const r = textDensity(rendered);
    return { text: r.text.slice(0, 12000), source: "browserless", url };
  }
  return null;
}

// ── Crawl multiple pages ──────────────────────────────────────────────────────
const SUBPAGES = [
  "", "/about", "/a-propos", "/team", "/equipe", "/notre-equipe",
  "/leadership", "/management", "/contact", "/nous-joindre"
];

async function crawlSite(domain) {
  const base = `https://${domain}`;
  const pages = [];
  let scanned = 0;

  for (const path of SUBPAGES) {
    if (scanned >= 10) break;
    const url = base + path;
    scanned++;
    const result = await smartFetch(url);
    if (result && result.text.length > 200) {
      pages.push(result);
    }
  }

  return { pages, scannedCount: scanned };
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
        generationConfig: { responseMimeType: "application/json", temperature: 0.2 }
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

// ── OpenAI fallback for analysis (unchanged from V1) ──────────────────────────
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
async function braveQuery(query, count = 5) {
  if (!BRAVE_KEY) return [];
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&country=ca&search_lang=fr`;
    const res = await fetchWithTimeout(url, {
      headers: { "Accept": "application/json", "X-Subscription-Token": BRAVE_KEY }
    }, 8000);
    if (!res.ok) return [];
    const data = await res.json();
    return data.web?.results || [];
  } catch (_) { return []; }
}

async function serpQuery(query, count = 5) {
  if (!SERPAPI_KEY) return [];
  try {
    const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&num=${count}&api_key=${SERPAPI_KEY}`;
    const res = await fetchWithTimeout(url, {}, 8000);
    const data = await res.json();
    return data.organic_results || [];
  } catch (_) { return []; }
}

// ── Gemini contact extraction ─────────────────────────────────────────────────
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

Extrais TOUS les contacts trouvés dans le texte. Pour chaque contact, fournis:
- name: nom complet
- title: titre/poste exact tel que trouvé
- linkedin_url: URL LinkedIn si trouvée (sinon "")
- email: email si trouvé (sinon "")
- role_category: une des catégories prioritaires ci-dessus
- confidence_score: 0-100 (basé sur la certitude que c'est la bonne personne)

Réponds en JSON strict:
{"contacts": [...]}

Si aucun contact n'est trouvé dans le texte, retourne {"contacts": []}.
N'invente AUCUN nom ou contact.`;

  return await callGemini(prompt);
}

// ── Fallback: Gemini LinkedIn search ──────────────────────────────────────────
async function geminiLinkedInSearch(companyName, domain) {
  const queries = [
    `site:linkedin.com/in "${companyName}" marketing OR communications Montréal`,
    `site:linkedin.com/in "${companyName}" directeur OR VP OR responsable événements`,
    `site:linkedin.com/in "${domain}" marketing OR communications OR événements`,
  ];

  const allResults = [];
  for (const q of queries) {
    let results = await braveQuery(q, 8);
    if (results.length === 0) results = await serpQuery(q, 5);
    for (const r of results) {
      const url = r.url || r.link || "";
      if (url.includes("linkedin.com/in/")) {
        allResults.push({ url, title: r.title || "", snippet: r.description || r.snippet || "" });
      }
    }
    if (allResults.length >= 10) break;
  }

  if (allResults.length === 0) return [];

  // Use Gemini to parse LinkedIn SERP results
  const prompt = `Tu es un expert en identification de contacts B2B.

ENTREPRISE: ${companyName} (${domain})
CONTEXTE: Services événementiels B2B à Montréal.

Voici des résultats de recherche LinkedIn pour cette entreprise:
${allResults.map((r, i) => `${i + 1}. URL: ${r.url}\n   Titre: ${r.title}\n   Extrait: ${r.snippet}`).join("\n\n")}

Pour chaque résultat qui semble être un employé de ${companyName} dans un rôle pertinent (marketing, communications, événements, RH, VP, direction, développement affaires, expérience client, brand), extrais:
- name: nom complet de la personne
- title: son poste/titre
- linkedin_url: l'URL LinkedIn nettoyée
- email: "" (inconnu)
- role_category: catégorie du rôle
- confidence_score: 0-100

Réponds en JSON strict: {"contacts": [...]}
N'inclus QUE les personnes qui travaillent probablement chez ${companyName}. Maximum 5 contacts.`;

  return await callGemini(prompt);
}

// ── Scoring interne ───────────────────────────────────────────────────────────
const DECISION_ROLES = /directeur|directrice|vp |vice.pr[eé]|chef|head of|responsable|manager|gestionnaire|charg[eé]|coordonnateur|coordinat/i;
const EVENT_ROLES    = /marketing|communication|événement|event|expérience|brand|relations|rh|ressources humaines|développement des affaires|business develop/i;

function scoreContact(contact, hasTeamPage) {
  let score = contact.confidence_score || 0;
  const title = (contact.title || "").toLowerCase();

  // +40 decision role
  if (DECISION_ROLES.test(title)) score += 40;
  // +20 if relevant event/marketing role
  if (EVENT_ROLES.test(title)) score += 20;
  // +20 linkedin valid
  if (contact.linkedin_url && contact.linkedin_url.includes("linkedin.com/in/")) score += 20;
  // +20 email valid
  if (contact.email && contact.email.includes("@")) score += 20;
  // +10 mention Montréal
  if (/montr[eé]al/i.test(contact.title || "")) score += 10;
  // +10 from official team page
  if (hasTeamPage) score += 10;

  return Math.min(score, 100);
}

// ── Hunter domain search ──────────────────────────────────────────────────────
async function hunterDomainSearch(domain, company) {
  if (!HUNTER_KEY) return { data: { emails: [] } };
  try {
    const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&company=${encodeURIComponent(company || "")}&limit=5&api_key=${HUNTER_KEY}`;
    const res = await fetchWithTimeout(url, {}, 8000);
    return await res.json();
  } catch (_) { return { data: { emails: [] } }; }
}

// ── Save contacts to DB ───────────────────────────────────────────────────────
async function saveContactsV2(base44, prospectId, prospect, contacts) {
  const saved = [];
  const seen = new Set();

  for (const c of contacts) {
    const key = (c.linkedin_url || c.email || c.name || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);

    // Check existing
    const filters = c.email ? { prospectId, email: c.email } : c.linkedin_url ? { prospectId, linkedinUrl: c.linkedin_url } : null;
    if (filters) {
      const existing = await base44.entities.Contact.filter(filters).catch(() => []);
      if (existing.length > 0) continue;
    }

    try {
      const parts = (c.name || "").split(" ");
      const record = await base44.entities.Contact.create({
        prospectId,
        ownerUserId:     prospect.ownerUserId,
        firstName:       parts[0] || "",
        lastName:        parts.slice(1).join(" ") || "",
        fullName:        c.name || "",
        title:           c.title || "",
        email:           c.email || "",
        emailConfidence: c.email ? (c.confidence_score || 50) : 0,
        linkedinUrl:     c.linkedin_url || "",
        hasEmail:        !!(c.email && c.email.includes("@")),
        source:          c.source === "HUNTER" ? "HUNTER" : "SERP",
        contactPageUrl:  c.source_page || "",
      });
      saved.push(record);
    } catch (e) {
      console.error(`[SAVE] Contact error: ${e.message}`);
    }
  }
  return saved;
}

// ── Main handler ──────────────────────────────────────────────────────────────
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

  const logs = [];
  const log = (msg) => { console.log(`[V2] ${msg}`); logs.push(msg); };

  log(`START: ${prospect.companyName} (${prospect.domain})`);

  // ── PHASE 1: Crawl ─────────────────────────────────────────────────────────
  log("Phase 1: Crawling site...");
  const { pages, scannedCount } = await crawlSite(prospect.domain);
  log(`Crawled ${scannedCount} pages, ${pages.length} with content`);

  const hasTeamPage = pages.some(p => /team|equipe|leadership|management|notre-equipe/.test(p.url));
  const crawledText = pages.map(p => `--- PAGE: ${p.url} (${p.source}) ---\n${p.text}`).join("\n\n");

  // ── PHASE 2: Parallel extraction ────────────────────────────────────────────
  log("Phase 2: Parallel extraction (Gemini + Hunter + OpenAI analysis)...");

  const [geminiContacts, hunterResult, analysis] = await Promise.all([
    // Gemini contact extraction from crawled content
    crawledText.length > 500
      ? extractContactsGemini(prospect.companyName, prospect.domain, crawledText)
      : Promise.resolve({ contacts: [] }),

    // Hunter
    hunterDomainSearch(prospect.domain, prospect.companyName),

    // OpenAI analysis (same as V1)
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
  "recommendedApproach": "angle d'approche SYNC en 1-2 phrases",
  "decisionMakerTitles": ["titres des décideurs à cibler"]
}`
      }
    ]),
  ]);

  // Process Hunter contacts
  const hunterContacts = (hunterResult?.data?.emails || [])
    .filter(e => e.confidence >= 40)
    .slice(0, 5)
    .map(e => ({
      name: `${e.first_name || ""} ${e.last_name || ""}`.trim(),
      title: e.position || "",
      email: e.value,
      linkedin_url: e.linkedin || "",
      confidence_score: e.confidence,
      role_category: "unknown",
      source: "HUNTER",
    }));

  log(`Hunter: ${hunterContacts.length} contacts`);
  log(`Gemini website: ${geminiContacts?.contacts?.length || 0} contacts`);

  // ── PHASE 3: Fallback LinkedIn search if no contacts ────────────────────────
  let linkedinContacts = [];
  const websiteContactCount = (geminiContacts?.contacts?.length || 0) + hunterContacts.length;

  if (websiteContactCount === 0) {
    log("Phase 3: No contacts found — launching LinkedIn fallback...");
    const liResult = await geminiLinkedInSearch(prospect.companyName, prospect.domain);
    linkedinContacts = (liResult?.contacts || []).map(c => ({ ...c, source: "linkedin_search" }));
    log(`LinkedIn fallback: ${linkedinContacts.length} contacts`);
  } else {
    log("Phase 3: Skipped — contacts already found");
  }

  // ── PHASE 4: Merge, score, deduplicate ──────────────────────────────────────
  log("Phase 4: Scoring and merging...");

  const allContacts = [
    ...hunterContacts,
    ...(geminiContacts?.contacts || []).map(c => ({ ...c, source: "website_gemini", source_page: pages[0]?.url || "" })),
    ...linkedinContacts,
  ];

  // Score all contacts
  for (const c of allContacts) {
    c.contact_confidence_score = scoreContact(c, hasTeamPage);
  }

  // Sort by score descending
  allContacts.sort((a, b) => (b.contact_confidence_score || 0) - (a.contact_confidence_score || 0));

  // Take top 5
  const topContacts = allContacts.slice(0, 5);
  log(`Final contacts: ${topContacts.length} (from ${allContacts.length} total)`);

  // ── PHASE 5: Save ──────────────────────────────────────────────────────────
  log("Phase 5: Saving...");
  const savedContacts = await saveContactsV2(base44, prospectId, prospect, topContacts);

  // If still no contacts, create stubs from AI titles
  if (savedContacts.length === 0 && analysis.decisionMakerTitles?.length > 0) {
    log("Creating stub contacts from AI-suggested titles...");
    for (const title of analysis.decisionMakerTitles.slice(0, 2)) {
      try {
        await base44.entities.Contact.create({
          prospectId,
          ownerUserId: prospect.ownerUserId,
          title,
          hasEmail: false,
          contactPageUrl: `https://${prospect.domain}/contact`,
          source: "SERP",
        });
        savedContacts.push({ title, stub: true });
      } catch (_) {}
    }
  }

  // Update prospect
  const bestContact = topContacts[0];
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
      v2: true,
      pagesScannedCount: scannedCount,
      pagesWithContent: pages.length,
      hasTeamPage,
      contactSources: {
        hunter: hunterContacts.length,
        geminiWebsite: geminiContacts?.contacts?.length || 0,
        linkedinFallback: linkedinContacts.length,
      },
      bestContact: bestContact ? {
        name: bestContact.name,
        title: bestContact.title,
        linkedin_url: bestContact.linkedin_url,
        email: bestContact.email,
        score: bestContact.contact_confidence_score,
        source: bestContact.source,
      } : null,
    },
    contactPageUrl: pages.find(p => /contact|nous-joindre/.test(p.url))?.url || prospect.contactPageUrl || "",
    analysisError: null,
    analysisErrorAt: null,
  });

  // Activity log
  await base44.entities.ActivityLog.create({
    ownerUserId: user.email,
    actionType: "ANALYZE_PROSPECT_V2",
    entityType: "Prospect",
    entityId: prospectId,
    payload: {
      relevanceScore: analysis.relevanceScore,
      segment: analysis.segment,
      pagesScanned: scannedCount,
      contactsFound: topContacts.length,
      contactsSaved: savedContacts.length,
      sources: { hunter: hunterContacts.length, gemini: geminiContacts?.contacts?.length || 0, linkedin: linkedinContacts.length },
    },
    status: "SUCCESS",
  });

  log(`DONE: score=${analysis.relevanceScore}, contacts=${savedContacts.length}`);

  return Response.json({
    success: true,
    analysis: { relevanceScore: analysis.relevanceScore, segment: analysis.segment },
    contacts: {
      total: savedContacts.length,
      hunter: hunterContacts.length,
      geminiWebsite: geminiContacts?.contacts?.length || 0,
      linkedinFallback: linkedinContacts.length,
    },
    crawl: { pagesScanned: scannedCount, pagesWithContent: pages.length, hasTeamPage },
    logs,
  });
});