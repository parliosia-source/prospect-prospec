import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const BRAVE_KEY = Deno.env.get("BRAVE_API_KEY");
const SERP_KEY = Deno.env.get("SERPAPI_API_KEY");

// ── Text normalizers ──────────────────────────────────────────────────────────
function normSector(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .replace(/\s*&\s*/g, " et ").replace(/\s+/g, " ").trim();
}
function normText(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
}

// Robust list parser
function parseArr(v) {
  if (Array.isArray(v)) return v;
  if (!v || String(v).trim() === "" || String(v).toLowerCase() === "nan") return [];
  const s = String(v).trim();
  if (s.startsWith("[")) { try { return JSON.parse(s).map(x => String(x).trim()).filter(Boolean); } catch(_) {} }
  return s.split(",").map(x => x.trim()).filter(Boolean);
}

// ── Sector scoring rules ──────────────────────────────────────────────────────
// Each sector has: strongSignals (boost), exclusions (hard reject / heavy penalty)
const SECTOR_SCORING_RULES = {
  "Finance & Assurance": {
    strongSignals: [
      "banque","caisse","credit union","institution financiere","desjardins",
      "assurance","insurance","courtier","broker","mutuelle","mga","underwriting","reassurance",
      "investissement","gestion d actifs","asset management","capital","fonds","fonds de placement","pe","vc","private equity","venture capital",
      "paiement","payment","psp","acquiring","merchant services","fintech",
      "bourse","valeurs mobilieres","securities","fiducie","trust","mortgage","hypotheque",
      "actuariat","actuarial","souscription",
    ],
    exclusions: [
      "fondation","foundation","hopital","chu","cusm","chum","hospital","centre hospitalier",
      "universite","cegep","college","ecole","campus",
      "festival","tourisme","tourism",
      "ville de","municipalite","arrondissement","gouvernement","ministere","ciusss","cisss",
    ],
  },
  "Immobilier": {
    strongSignals: [
      "immobilier","real estate","promoteur","developpeur immobilier","constructeur","courtier immobilier",
      "gestion immobiliere","property management","reit","fonds immobilier","condo","logement",
      "hypotheque","mortgage","financement immobilier",
    ],
    exclusions: ["hopital","universite","fondation","gouvernement","municipalite"],
  },
  "Droit & Comptabilite": {
    strongSignals: [
      "avocat","cabinet d avocats","law firm","barreau","notaire","huissier",
      "comptable","cpa","audit","fiscalite","conformite","cabinet comptable",
      "juridique","litige","contentieux","restructuration",
    ],
    exclusions: ["hopital","universite","fondation","gouvernement"],
  },
  "Transport & Logistique": {
    strongSignals: [
      "transport","logistique","livraison","cargo","fret","entrepot","courrier",
      "distribution","supply chain","camionnage","expediteur","freight","3pl","4pl",
      "transitaire","douane","maritime","aerien","ferroviaire",
    ],
    exclusions: ["hopital","universite","fondation","gouvernement"],
  },
  "Technologie": {
    strongSignals: [
      "logiciel","software","saas","cloud","informatique","it","intelligence artificielle","ia","ai",
      "cybersecurite","donnees","data","developpement","startup tech","plateforme numerique",
      "erp","crm","devops","infrastructure","api","mobile app","solution numerique",
    ],
    exclusions: ["hopital","universite","fondation","gouvernement","municipalite"],
  },
  "Santé & Pharma": {
    strongSignals: [
      "hopital","hospital","clinique","clinic","sante","health","pharma","pharmaceutique",
      "medical","medecin","diagnostic","therapie","laboratoire","pharmacie","biotechnologie",
      "biotech","recherche clinique","soins","infirmier","chirurgie","radiologie","imagerie",
      "dentaire","optometrie","physiotherapie","ergotherapie",
    ],
    exclusions: [],
  },
  "Gouvernement & Public": {
    strongSignals: [
      "gouvernement","government","ministere","ministry","municipalite","municipality",
      "ville de","city of","province","federal","agence gouvernementale","fonction publique",
      "service public","public service","ciusss","cisss","arrondissement","prefet","depute",
    ],
    exclusions: [],
  },
  "Éducation & Formation": {
    strongSignals: [
      "universite","university","college","cegep","ecole","school","formation","training",
      "enseignement","education","academique","campus","pedagogie","apprentissage","diplome",
      "programme d etudes","recherche universitaire","faculte","professeur",
    ],
    exclusions: [],
  },
  "Associations & OBNL": {
    strongSignals: [
      "association","obnl","npo","organisme","charitable","benevole","ong","syndicat",
      "communautaire","ordre professionnel","fondation","federation","regroupement",
      "chambre de commerce","conseil","cooperative","mutuelle",
    ],
    exclusions: [],
  },
  "Industrie & Manufacture": {
    strongSignals: [
      "usine","manufacture","fabrication","production","industrie","acier","chimie","mecanique",
      "automatisation","assemblage","machinerie","ingenierie","engineering","plasturgie",
      "metallurgie","agroalimentaire","emballage","transformation",
    ],
    exclusions: [],
  },
  "Commerce de détail": {
    strongSignals: [
      "commerce","retail","magasin","boutique","vente","detaillant","e-commerce","ecommerce",
      "mode","fashion","alimentation","franchise","supermarche","epicerie","quincaillerie",
      "centre commercial","distribution","grossiste",
    ],
    exclusions: [],
  },
};

// Compute sectorScore (0–100) for a KB entity against a requested sector
// Returns { score, tier, reasons, rejectReason }
// Simplified: if the entity matches the sector, it's accepted. No strong signal filtering.
function computeSectorScore(kb, sector) {
  const rules = SECTOR_SCORING_RULES[sector];

  // Blob restreint pour exclusions (identité de l'entité seulement)
  const identityBlob = normText([
    kb.name, kb.normalizedName, kb.industryLabel, kb.primaryTheme,
    ...parseArr(kb.industrySectors), ...parseArr(kb.themes),
  ].filter(Boolean).join(" "));

  if (!rules) {
    return { score: 75, tier: "STRICT", reasons: ["no_rules_accepted"], rejectReason: null };
  }

  // ── Exclusions sur identityBlob UNIQUEMENT ──────────────────────────────
  for (const excl of rules.exclusions) {
    const exclNorm = normText(excl);
    if (identityBlob.includes(exclNorm)) {
      return { score: 0, tier: "REJECTED", reasons: [], rejectReason: `matchedExclusion:${excl}` };
    }
  }

  // ── Accepted: sector match is sufficient ────────────────────────────────
  const reasons = ["sectorMatch_accepted"];
  let score = 75;

  // Boost: primaryTheme or industryLabel is an exact match
  const normSec = normSector(sector);
  if (normSector(kb.primaryTheme) === normSec || normSector(kb.industryLabel) === normSec) {
    score = 85;
    reasons.push("primaryTheme_exactMatch");
  }

  return { score, tier: "STRICT", reasons, rejectReason: null };
}

// ── GM city set ────────────────────────────────────────────────────────────────
const GM_CITIES_NORM = new Set([
  "montreal","laval","longueuil","brossard","terrebonne","repentigny","boucherville",
  "dorval","pointe-claire","kirkland","beaconsfield","saint-lambert","westmount",
  "mont-royal","cote-saint-luc","verdun","anjou","outremont","pierrefonds","lasalle",
  "saint-laurent","saint-jerome","blainville","boisbriand","mascouche","mirabel",
  "la-prairie","chateauguay","candiac","laprairie","saint-jean-sur-richelieu",
  "vaudreuil-dorion","les-coteaux","sainte-catherine","sainte-julie","varennes",
  "montreal-est","montreal-nord","montreal-ouest","lachine","rosemont","villeray",
  "hochelaga","riviere-des-prairies","saint-leonard","ahuntsic","mtl","grand montreal",
  "greater montreal","grand-montreal",
]);

function isGmQuery(locationQuery) {
  const norm = normText(locationQuery);
  if (GM_CITIES_NORM.has(norm)) return true;
  for (const token of norm.split(/[\s,]+/)) {
    if (GM_CITIES_NORM.has(token)) return true;
  }
  return false;
}

// ── Province aliases ───────────────────────────────────────────────────────────
const PROVINCE_ALIASES = {
  "QC": ["québec","quebec","qc","montréal","montreal","laval","longueuil","gatineau","sherbrooke"],
  "ON": ["ontario","on","toronto","ottawa","hamilton","london"],
  "BC": ["british columbia","colombie-britannique","bc","vancouver","victoria"],
  "AB": ["alberta","ab","calgary","edmonton"],
};

// ── Sector synonyms (for web search queries) ──────────────────────────────────
const SECTOR_SYNONYMS = {
  "Technologie": ["IT","informatique","SaaS","logiciel","software","cloud","IA","AI","numérique","digital","cybersécurité","données","data","développement","startup","tech","infrastructure","DevOps","plateforme","ERP","CRM"],
  "Finance & Assurance": ["banque","bank","assurance","insurance","crédit","placement","investissement","fintech","capital","fonds","courtage","caisse","gestion d'actifs","paiement"],
  "Santé & Pharma": ["santé","health","pharma","médical","hôpital","clinique","médecin","diagnostic","thérapie","laboratoire","pharmacie"],
  "Gouvernement & Public": ["gouvernement","government","municipalité","ville","province","fédéral","ministère","assemblée","CISSS","CIUSSS","agence gouvernementale"],
  "Éducation & Formation": ["université","collège","école","cégep","formation","training","cours","apprentissage","diplôme"],
  "Associations & OBNL": ["association","OBNL","NPO","fondation","organisme","charitable","bénévole","ONG","syndicat","communautaire","ordre professionnel"],
  "Immobilier": ["immobilier","real estate","propriété","construction","promoteur","logement","bureau","bâtiment","terrain","condo","REIT"],
  "Droit & Comptabilité": ["avocat","droit","law","comptable","comptabilité","notaire","juridique","fiscalité","audit","conformité","CPA"],
  "Industrie & Manufacture": ["usine","manufacture","fabrication","production","industrie","acier","chimie","mécanique","automatisation","assemblage","machinerie","ingénierie"],
  "Commerce de détail": ["commerce","retail","magasin","boutique","vente","détaillant","e-commerce","mode","alimentation","franchise"],
  "Transport & Logistique": ["transport","logistique","livraison","cargo","fret","entrepôt","courrier","distribution","supply chain"],
};

// ── Noise / blocked ────────────────────────────────────────────────────────────
const BLOCKED_DOMAINS = new Set([
  "wikipedia.org","fr.wikipedia.org","youtube.com","facebook.com","instagram.com",
  "twitter.com","x.com","linkedin.com","tiktok.com","reddit.com",
  "eventbrite.com","eventbrite.ca","meetup.com","ticketmaster.com","ticketmaster.ca",
  "glassdoor.com","indeed.com","monster.com",
  "lapresse.ca","ledevoir.com","radio-canada.ca","cbc.ca","tvanouvelles.ca",
  "cision.com","newswire.ca","prnewswire.com","globenewswire.com",
  "google.com","bing.com","yelp.com","tripadvisor.com",
  "wordpress.com","wix.com","squarespace.com","medium.com",
  "pagesjaunes.ca","yellowpages.ca","411.ca",
  "crunchbase.com","clutch.co","g2.com","capterra.com",
]);
const BLOCKED_PATHS = /\/blog\/|\/news\/|\/press\/|\/article\/|\/actualite\/|\/careers\/|\/jobs\/|\/events\/|\/agenda\/|\.pdf$/i;
const HARD_EXCL_TITLE = /\b(top \d+|best|directory|ranking|list|annuaire|répertoire|comment|guide complet|how to)\b/i;

const TWO_PART_TLDS = new Set(["qc.ca","co.ca","on.ca","bc.ca","ab.ca","co.uk","org.uk"]);
function getDomain(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const labels = host.split(".");
    if (labels.length >= 3 && TWO_PART_TLDS.has(labels.slice(-2).join("."))) return labels.slice(-3).join(".");
    return labels.slice(-2).join(".");
  } catch { return ""; }
}

const MTL_SNIPPET_RE = /\b(montr[eé]al|laval|longueuil|brossard|terrebonne|repentigny|boucherville|dorval|pointe-claire|westmount|verdun|anjou|outremont|lasalle|saint-laurent|blainville|boisbriand|mirabel|ch[aâ]teauguay|vaudreuil|lachine|ahuntsic|mtl)\b/i;

// ── Brave Search ───────────────────────────────────────────────────────────────
const braveRL = { remaining: -1, reset: -1, count429: 0, quotaExceeded: false };
function parseBraveHeaders(res) {
  const r = parseInt(res.headers.get("X-RateLimit-Remaining") || "-1");
  const t = parseInt(res.headers.get("X-RateLimit-Reset") || "-1");
  if (r !== -1) braveRL.remaining = r;
  if (t !== -1) braveRL.reset = t;
}

async function braveSearch(query, count = 20, offset = 0) {
  if (braveRL.quotaExceeded) return { results: [], rateLimited: true };
  if (braveRL.remaining === 0 && braveRL.reset > 0) await new Promise(r => setTimeout(r, Math.max(braveRL.reset * 1000, 1000)));
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&offset=${offset}&extra_snippets=true&country=ca`;
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, { headers: { "Accept":"application/json","X-Subscription-Token": BRAVE_KEY }, signal: ctrl.signal });
    clearTimeout(timeout);
    parseBraveHeaders(res);
    if (res.status === 402) { braveRL.quotaExceeded = true; return { results: [], rateLimited: true, status: 402 }; }
    if (res.status === 429) { braveRL.count429++; return { results: [], rateLimited: true, status: 429 }; }
    if (!res.ok) return { results: [], rateLimited: false, status: res.status };
    const data = await res.json();
    return { results: data.web?.results || [], rateLimited: false };
  } catch (e) {
    clearTimeout(timeout);
    return { results: [], rateLimited: e.name === "AbortError" };
  }
}

// ── SerpAPI fallback ───────────────────────────────────────────────────────────
async function serpSearch(query) {
  if (!SERP_KEY) return [];
  try {
    const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&location=Montreal,Quebec,Canada&hl=fr&gl=ca&api_key=${SERP_KEY}&num=20`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.organic_results || []).map(r => ({ url: r.link, title: r.title || "", snippet: r.snippet || "" }));
  } catch { return []; }
}

// ── Web result normalizer ─────────────────────────────────────────────────────
function normalizeWebResult(r, requiredSectors, isMTL) {
  const url = r.url || "";
  const title = r.title || "";
  const snippet = r.snippet || "";
  if (BLOCKED_PATHS.test(url) || HARD_EXCL_TITLE.test(title)) return null;
  const domain = getDomain(url);
  if (!domain || BLOCKED_DOMAINS.has(domain)) return null;

  const fullText = normText(`${title} ${snippet} ${domain}`);
  if (isMTL && !MTL_SNIPPET_RE.test(`${title} ${snippet} ${url}`)) return null;

  let maxScore = 0;
  let bestSector = null;
  for (const sector of requiredSectors) {
    const syns = SECTOR_SYNONYMS[sector] || [];
    const score = syns.filter(s => fullText.includes(normText(s))).length;
    if (score > maxScore) { maxScore = score; bestSector = sector; }
  }
  if (requiredSectors.length > 0 && maxScore < 1) return null;

  const nameMatch = title.match(/^([A-ZÀ-ÿa-zà-ÿ][^\|–\-]{2,60}?)(?:\s*[-–|]|$)/);
  const companyName = nameMatch ? nameMatch[1].trim() : title.split("|")[0].slice(0, 100).trim();

  let score = 0;
  if (maxScore >= 4) score += 40; else if (maxScore >= 2) score += 25;
  if (isMTL || MTL_SNIPPET_RE.test(`${title} ${snippet}`)) score += 30;
  if (domain.length < 40 && !/directory|pages|annuaire|list|rank|top|blog|news|review/.test(domain)) score += 20;
  if (snippet.length > 80) score += 10;

  return { companyName, website: url, domain, snippet, title, bestSector, score };
}

// ── Brave query builder ────────────────────────────────────────────────────────
const EXCL = '-site:linkedin.com -site:facebook.com -site:glassdoor.com -site:indeed.com -site:eventbrite.com -site:wikipedia.org';
function buildQueries(sectors, loc) {
  const locCity = loc.split(",")[0].trim();
  const queries = [];
  for (const sector of sectors.slice(0, 3)) {
    const syns = (SECTOR_SYNONYMS[sector] || []).slice(0, 5);
    const synStr = syns.slice(0, 3).map(s => `"${s}"`).join(" OR ");
    queries.push(`entreprises "${sector}" ${locCity} ${EXCL}`);
    queries.push(`companies "${sector}" ${locCity} ${EXCL}`);
    if (synStr) queries.push(`(${synStr}) entreprises ${locCity} ${EXCL}`);
  }
  return [...new Set(queries)];
}

// ── Fuzzy sector matching ─────────────────────────────────────────────────────
function fuzzyMatchSectors(kb, requiredSectors) {
  if (requiredSectors.length === 0) return { matchedCanonical: [], whichMode: null };
  const reqNorm = requiredSectors.map(normSector);
  const kbIS = parseArr(kb.industrySectors);
  const kbTh = parseArr(kb.themes);

  const normIS = kbIS.map(normSector);
  const matchedFromIS = reqNorm.filter(r => normIS.includes(r));
  if (matchedFromIS.length > 0) {
    return { matchedCanonical: requiredSectors.filter(r => matchedFromIS.includes(normSector(r))), whichMode: "industrySectors" };
  }

  const normTh = kbTh.map(normSector);
  const matchedFromTh = reqNorm.filter(r => normTh.includes(r));
  if (matchedFromTh.length > 0) {
    return { matchedCanonical: requiredSectors.filter(r => matchedFromTh.includes(normSector(r))), whichMode: "themes" };
  }

  if (reqNorm.includes(normSector(kb.primaryTheme))) {
    const canonical = requiredSectors.filter(r => normSector(r) === normSector(kb.primaryTheme));
    return { matchedCanonical: canonical.length > 0 ? canonical : [kb.primaryTheme], whichMode: "primaryTheme" };
  }

  if (reqNorm.includes(normSector(kb.industryLabel))) {
    const canonical = requiredSectors.filter(r => normSector(r) === normSector(kb.industryLabel));
    return { matchedCanonical: canonical.length > 0 ? canonical : [kb.industryLabel], whichMode: "industryLabel" };
  }

  return { matchedCanonical: [], whichMode: null };
}

// ── Create a Prospect record from a KB entity + scoring context ───────────────
async function createProspectFromKb(base44, campaignId, campaign, kb, displaySectors, displayLabel, tier, sectorScore) {
  const qualityFlags = [`SECTOR_${tier}:${displaySectors[0] || "UNKNOWN"}`];
  await base44.entities.Prospect.create({
    campaignId,
    ownerUserId: campaign.ownerUserId,
    companyName: kb.name,
    website: kb.website || `https://${kb.domain}`,
    domain: (kb.domain || "").toLowerCase(),
    industry: displayLabel,
    industrySectors: displaySectors,
    industryLabel: displayLabel,
    location: { city: kb.hqCity || "", country: kb.hqCountry || "CA" },
    entityType: kb.entityType || "COMPANY",
    status: "NOUVEAU",
    sourceOrigin: "KB_V2",
    kbEntityId: kb.id,
    serpSnippet: kb.notes || "",
    sourceUrl: kb.sourceUrl || "",
    relevanceScore: sectorScore,
    relevanceReasons: [`tier:${tier}`, `sectorScore:${sectorScore}`],
  });
}

// ── Main ───────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { campaignId } = body;
  if (!campaignId) return Response.json({ error: "campaignId required" }, { status: 400 });

  const campaigns = await base44.entities.Campaign.filter({ id: campaignId });
  const campaign = campaigns[0];
  if (!campaign) return Response.json({ error: "Campaign not found" }, { status: 404 });
  if (campaign.ownerUserId !== user.email && user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

  const START = Date.now();
  const MAX_MS = 90 * 1000;

  const locQuery = campaign.locationQuery || "Montréal, QC";
  const requiredSectors = campaign.industrySectors || [];
  const targetCount = campaign.targetCount || 50;
  const campaignKeywords = campaign.keywords || [];
  const campaignKwNorm = campaignKeywords.map(normText).filter(Boolean);
  const locNorm = normText(locQuery);
  const isMTL = isGmQuery(locQuery);
  const wantQC = isMTL || /\b(qc|qu[eé]bec)\b/.test(locNorm);
  let targetProvince = wantQC ? "QC" : null;
  if (!targetProvince) {
    for (const [prov, aliases] of Object.entries(PROVINCE_ALIASES)) {
      if (aliases.some(a => locNorm.includes(a))) { targetProvince = prov; break; }
    }
  }

  const existingProspects = await base44.entities.Prospect.filter({ campaignId }, "-created_date", 2000).catch(() => []);
  const existingDomains = new Set(existingProspects.map(p => (p.domain || "").toLowerCase()));
  let prospectCount = existingProspects.length;

  console.log(`[START] campaignId=${campaignId} target=${targetCount} existing=${prospectCount} isMTL=${isMTL} sectors=${requiredSectors.join(",")}`);

  if (prospectCount >= targetCount) {
    await base44.entities.Campaign.update(campaignId, { status: "DONE", progressPct: 100, countProspects: prospectCount });
    return Response.json({ success: true, campaignId, prospectCount, status: "DONE", skipReason: "ALREADY_AT_TARGET" });
  }

  let kbAccepted = 0, webAccepted = 0, webTopUpInserted = 0, braveRequests = 0;
  let stopReason = null;

  // ── Instrumentation counters ──────────────────────────────────────────────
  let matchByIndustrySectorsCount = 0, matchByThemesCount = 0, matchByPrimaryThemeCount = 0, matchByIndustryLabelCount = 0;
  let strictCount = 0, expandedCount = 0, rejectedCount = 0;
  const topRejectReasons = {};
  const sampleMatched = [];
  const rejectedSamples = [];

  try {
    // ══════════════════════════════════════════════════════════════════════
    // PHASE 1 — KBEntityV2
    // ══════════════════════════════════════════════════════════════════════
    let kbAll = [];
    let page = 0;
    while (Date.now() - START < MAX_MS * 0.4) {
      const batch = await base44.asServiceRole.entities.KBEntityV3.list('-confidenceScore', 500, page * 500).catch(() => []);
      if (!batch || batch.length === 0) break;
      kbAll = kbAll.concat(batch);
      if (batch.length < 500) break;
      page++;
      if (page >= 20) break;
    }
    const kbDomainSet = new Set(kbAll.map(e => (e.domain || "").toLowerCase()));
    console.log(`[KB] loaded=${kbAll.length}`);

    // Geo filter
    function resolveRequiredGeoScopes() {
      if (isMTL) return ["MTL_CMM", "QC_OTHER"];
      if (/\b(qc|qu[eé]bec)\b/.test(normText(locQuery))) return ["MTL_CMM", "QC_OTHER"];
      return ["MTL_CMM", "QC_OTHER", "CANADA_OTHER"];
    }
    const requiredGeoScopes = resolveRequiredGeoScopes();

    const kbRegionFiltered = kbAll.filter(e => {
      if (!e.domain || !e.website || !e.name) return false;
      if (e.geoScope && e.geoScope !== "UNKNOWN") return requiredGeoScopes.includes(e.geoScope);
      if (isMTL) return ["MTL","GM"].includes(e.hqRegion);
      if (targetProvince) return e.hqProvince === targetProvince || ["MTL","GM","QC_OTHER"].includes(e.hqRegion);
      return true;
    });
    console.log(`[KB] afterRegion=${kbRegionFiltered.length}`);

    // Sector filter + score every entity
    // Categorize into STRICT / EXPANDED / REJECTED
    const kbStrict = [];
    const kbExpanded = [];

    for (const e of kbRegionFiltered) {
      if (requiredSectors.length === 0) {
        // No sector filter → score 60 EXPANDED for everyone
        kbExpanded.push({ kb: e, sectorScore: 60, tier: "EXPANDED", reasons: ["noFilter"], whichMode: null });
        continue;
      }

      const { matchedCanonical, whichMode } = fuzzyMatchSectors(e, requiredSectors);
      if (!whichMode) continue; // doesn't match at all

      // Track match mode
      if (whichMode === "industrySectors") matchByIndustrySectorsCount++;
      else if (whichMode === "themes") matchByThemesCount++;
      else if (whichMode === "primaryTheme") matchByPrimaryThemeCount++;
      else if (whichMode === "industryLabel") matchByIndustryLabelCount++;

      // Compute sector score for the first matched sector
      const targetSector = matchedCanonical[0] || requiredSectors[0];
      const { score, tier, reasons, rejectReason } = computeSectorScore(e, targetSector);

      if (tier === "REJECTED") {
        rejectedCount++;
        if (rejectReason) topRejectReasons[rejectReason] = (topRejectReasons[rejectReason] || 0) + 1;
        if (rejectedSamples.length < 15) {
          rejectedSamples.push({
            name: e.name, domain: e.domain,
            industryLabel: e.industryLabel, primaryTheme: e.primaryTheme,
            rejectReason, score,
          });
        }
        continue;
      }

      const entry = { kb: e, matchedCanonical, whichMode, sectorScore: score, tier, reasons };
      if (tier === "STRICT") { strictCount++; kbStrict.push(entry); }
      else { expandedCount++; kbExpanded.push(entry); }
    }

    console.log(`[KB] strict=${strictCount} expanded=${expandedCount} rejected=${rejectedCount}`);

    // ── V3 ranking within each tier ────────────────────────────────────────
    const normRequired = requiredSectors.map(normSector);
    function rankScore(e, sectorScore) {
      let score = sectorScore * 10; // base from sector score
      if (normRequired.includes(normSector(e.primaryTheme))) score += 1000;
      let tcRaw2 = typeof e.themeConfidence === "number" ? e.themeConfidence : (parseFloat(e.themeConfidence) || 55);
      const tcNorm = tcRaw2 > 1 ? tcRaw2 / 100 : tcRaw2;
      score += tcNorm * 100;
      if (parseArr(e.eventSignals).length > 0) score += 10;
      // Keyword boost from campaign keywords
      if (campaignKwNorm.length > 0) {
        const eBlob = normText([e.name, e.normalizedName, ...parseArr(e.keywords), e.notes, ...parseArr(e.tags)].filter(Boolean).join(" "));
        const kwMatches = campaignKwNorm.filter(kw => eBlob.includes(kw)).length;
        score += kwMatches * 200;
      }
      score += (e.confidenceScore || 70) * 0.2;
      return score;
    }

    kbStrict.sort((a, b) => rankScore(b.kb, b.sectorScore) - rankScore(a.kb, a.sectorScore));
    kbExpanded.sort((a, b) => rankScore(b.kb, b.sectorScore) - rankScore(a.kb, a.sectorScore));

    // ── Insert: STRICT first, then EXPANDED ────────────────────────────────
    const orderedKb = [...kbStrict, ...kbExpanded];

    for (const { kb, matchedCanonical, tier, sectorScore, reasons } of orderedKb) {
      if (prospectCount >= targetCount) { stopReason = "TARGET_REACHED"; break; }
      if (Date.now() - START > MAX_MS * 0.45) { stopReason = "TIME_BUDGET_KB"; break; }

      const domNorm = (kb.domain || "").toLowerCase();
      if (existingDomains.has(domNorm)) continue;

      const displaySectors = (matchedCanonical && matchedCanonical.length > 0) ? matchedCanonical : requiredSectors.slice(0, 1);
      const displayLabel = displaySectors[0] || kb.industryLabel || null;

      // Sample for debug (first 5)
      if (sampleMatched.length < 5) {
        sampleMatched.push({
          name: kb.name, domain: kb.domain,
          primaryTheme: kb.primaryTheme || null,
          industryLabel: kb.industryLabel || null,
          industrySectors_raw: parseArr(kb.industrySectors).slice(0, 3),
          themes_raw: parseArr(kb.themes).slice(0, 3),
          whichModeMatched: matchedCanonical ? orderedKb.find(o => o.kb === kb)?.whichMode : null,
          sectorScore,
          tier,
          reasons,
          displayLabel,
        });
      }

      await createProspectFromKb(base44, campaignId, campaign, kb, displaySectors, displayLabel, tier, sectorScore);

      existingDomains.add(domNorm);
      kbAccepted++;
      prospectCount++;

      if (kbAccepted % 20 === 0) {
        await base44.entities.Campaign.update(campaignId, {
          progressPct: Math.min(40, Math.round((kbAccepted / targetCount) * 40)),
          countProspects: prospectCount,
        });
      }
    }
    console.log(`[KB] END kbAccepted=${kbAccepted} total=${prospectCount}`);

    // ══════════════════════════════════════════════════════════════════════
    // PHASE 2 — Brave Search (top-up if needed)
    // ══════════════════════════════════════════════════════════════════════
    if (prospectCount < targetCount && !stopReason) {
      const queries = buildQueries(requiredSectors, locQuery);
      const MAX_BRAVE = 250;

      for (const query of queries) {
        if (prospectCount >= targetCount) { stopReason = "TARGET_REACHED"; break; }
        if (braveRequests >= MAX_BRAVE || braveRL.quotaExceeded) break;
        if (Date.now() - START > MAX_MS * 0.85) { stopReason = "TIME_BUDGET"; break; }

        const { results, rateLimited } = await braveSearch(query, 20);
        braveRequests++;
        if (rateLimited && braveRL.quotaExceeded) { console.log("[BRAVE] quota exceeded"); break; }

        for (const r of results) {
          if (prospectCount >= targetCount) break;
          const norm = normalizeWebResult(r, requiredSectors, isMTL);
          if (!norm || norm.score < 45) continue;
          const domNorm = norm.domain.toLowerCase();
          if (existingDomains.has(domNorm)) continue;

          let kbEntityId = null;
          if (!kbDomainSet.has(domNorm) && norm.score >= 75) {
            try {
              const todayStr = new Date().toISOString().split("T")[0];
              const created = await base44.asServiceRole.entities.KBEntityV3.create({
                name: norm.companyName,
                normalizedName: normText(norm.companyName),
                domain: domNorm,
                website: norm.website,
                hqCity: isMTL ? "Montréal" : "",
                hqProvince: "QC",
                hqCountry: "CA",
                hqRegion: isMTL ? "MTL" : "QC_OTHER",
                geoScope: isMTL ? "MTL_CMM" : "QC_OTHER",
                industryLabel: norm.bestSector || requiredSectors[0] || "",
                primaryTheme: norm.bestSector || requiredSectors[0] || "",
                industrySectors: norm.bestSector ? [norm.bestSector] : requiredSectors.slice(0, 1),
                themes: norm.bestSector ? [norm.bestSector] : requiredSectors.slice(0, 1),
                entityType: "COMPANY",
                tags: [], notes: (norm.snippet || "").slice(0, 300),
                keywords: [], synonyms: [], sectorSynonymsUsed: [],
                confidenceScore: norm.score,
                qualityFlags: ["WEB_TOPUP"],
                sourceOrigin: "WEB",
                sourceUrl: norm.website,
                lastVerifiedAt: todayStr,
              });
              kbDomainSet.add(domNorm);
              kbEntityId = created.id;
              webTopUpInserted++;
            } catch (_) {}
          }

          await base44.entities.Prospect.create({
            campaignId,
            ownerUserId: campaign.ownerUserId,
            companyName: norm.companyName,
            website: norm.website,
            domain: domNorm,
            industry: norm.bestSector || requiredSectors[0] || null,
            industrySectors: norm.bestSector ? [norm.bestSector] : requiredSectors.slice(0, 1),
            industryLabel: norm.bestSector || requiredSectors[0] || null,
            location: isMTL ? { city: "Montréal", country: "CA" } : { country: "CA" },
            entityType: "COMPANY",
            status: "NOUVEAU",
            sourceOrigin: "WEB",
            kbEntityId: kbEntityId || undefined,
            serpSnippet: norm.snippet,
            sourceUrl: norm.website,
            relevanceScore: norm.score,
            relevanceReasons: ["tier:WEB", `webScore:${norm.score}`],
          });

          existingDomains.add(domNorm);
          webAccepted++;
          prospectCount++;
        }
      }
      console.log(`[BRAVE] END braveRequests=${braveRequests} webAccepted=${webAccepted}`);
    }

    // ══════════════════════════════════════════════════════════════════════
    // PHASE 3 — SerpAPI fallback
    // ══════════════════════════════════════════════════════════════════════
    if (prospectCount < targetCount && braveRL.quotaExceeded && SERP_KEY && !stopReason) {
      console.log("[SERP] Starting SerpAPI fallback");
      const serpQueries = buildQueries(requiredSectors, locQuery).slice(0, 5);
      for (const query of serpQueries) {
        if (prospectCount >= targetCount) break;
        if (Date.now() - START > MAX_MS * 0.95) break;
        const results = await serpSearch(query);
        for (const r of results) {
          if (prospectCount >= targetCount) break;
          const norm = normalizeWebResult(r, requiredSectors, isMTL);
          if (!norm || norm.score < 45) continue;
          const domNorm = norm.domain.toLowerCase();
          if (existingDomains.has(domNorm)) continue;

          await base44.entities.Prospect.create({
            campaignId,
            ownerUserId: campaign.ownerUserId,
            companyName: norm.companyName,
            website: norm.website,
            domain: domNorm,
            industry: norm.bestSector || requiredSectors[0] || null,
            industrySectors: norm.bestSector ? [norm.bestSector] : requiredSectors.slice(0, 1),
            industryLabel: norm.bestSector || requiredSectors[0] || null,
            location: isMTL ? { city: "Montréal", country: "CA" } : { country: "CA" },
            entityType: "COMPANY",
            status: "NOUVEAU",
            sourceOrigin: "WEB",
            serpSnippet: norm.snippet,
            sourceUrl: norm.website,
            relevanceScore: norm.score,
          });

          existingDomains.add(domNorm);
          webAccepted++;
          prospectCount++;
        }
      }
      console.log(`[SERP] END webAccepted total=${webAccepted}`);
    }

    // ══════════════════════════════════════════════════════════════════════
    // FINALIZE
    // ══════════════════════════════════════════════════════════════════════
    const finalProspects = await base44.entities.Prospect.filter({ campaignId }).catch(() => []);
    const finalProspectCount = finalProspects.length;

    let finalStatus, errorMessage = null;
    if (finalProspectCount >= targetCount) finalStatus = "DONE";
    else if (finalProspectCount > 0) {
      finalStatus = "DONE_PARTIAL";
      errorMessage = `${finalProspectCount}/${targetCount} prospects trouvés (STRICT=${strictCount}, EXPANDED=${expandedCount}, KB=${kbAccepted}, Brave=${webAccepted}). Relancez pour enrichir.`;
    } else {
      finalStatus = "FAILED";
      errorMessage = "Aucun prospect trouvé. Vérifiez vos critères.";
    }

    const toolUsage = {
      kbLoaded: kbAll.length,
      kbRegionFiltered: kbRegionFiltered.length,
      matchedCountBeforeRanking: kbStrict.length + kbExpanded.length,
      strictCount, expandedCount, rejectedCount,
      kbAccepted, webAccepted, webTopUpInserted,
      braveRequests,
      braveQuotaExceeded: braveRL.quotaExceeded,
      brave429Count: braveRL.count429,
      finalProspectCount,
      selectedCount: kbAccepted + webAccepted,
      matchByIndustrySectorsCount, matchByThemesCount, matchByPrimaryThemeCount, matchByIndustryLabelCount,
      topRejectReasons,
      sampleMatched,
      rejectedSamples,
      stopReason: stopReason || (finalStatus === "DONE" ? "TARGET_REACHED" : "PARTIAL"),
      isMTL, targetProvince,
    };

    console.log(`[FINAL] status=${finalStatus} strict=${strictCount} expanded=${expandedCount} rejected=${rejectedCount} total=${finalProspectCount}/${targetCount}`);

    await base44.entities.Campaign.update(campaignId, {
      status: finalStatus, progressPct: 100,
      countProspects: finalProspectCount,
      countAnalyzed: finalProspects.filter(p => ["ANALYSÉ","QUALIFIÉ","REJETÉ","EXPORTÉ"].includes(p.status)).length,
      countQualified: finalProspects.filter(p => p.status === "QUALIFIÉ").length,
      countRejected: finalProspects.filter(p => p.status === "REJETÉ").length,
      errorMessage, toolUsage,
    });

    await base44.entities.ActivityLog.create({
      ownerUserId: campaign.ownerUserId,
      actionType: "RUN_PROSPECT_SEARCH",
      entityType: "Campaign",
      entityId: campaignId,
      payload: toolUsage,
      status: finalStatus === "FAILED" ? "ERROR" : "SUCCESS",
      errorMessage: finalStatus === "FAILED" ? errorMessage : null,
    }).catch(() => {});

    return Response.json({ success: true, campaignId, prospectCount: finalProspectCount, kbAccepted, webAccepted, status: finalStatus, toolUsage });

  } catch (error) {
    const errorCode = error.name || "Error";
    const errMsg = error.message || "Erreur inconnue";
    const errStack = (error.stack || "").split('\n').slice(0, 5).join('\n');
    console.error(`[ERROR] code=${errorCode} message=${errMsg}`);

    const finalProspectsAfterError = await base44.entities.Prospect.filter({ campaignId }).catch(() => []);
    const finalProspectCountAfterError = finalProspectsAfterError.length;
    const errorStatus = finalProspectCountAfterError > 0 ? "DONE_PARTIAL" : "FAILED";
    const finalErrorMessage = finalProspectCountAfterError > 0
      ? `Partiel: ${finalProspectCountAfterError} prospects trouvés. Erreur: ${errMsg}` : errMsg;

    await base44.entities.Campaign.update(campaignId, {
      status: errorStatus, errorMessage: finalErrorMessage, progressPct: 100,
      countProspects: finalProspectCountAfterError,
      toolUsage: {
        kbAccepted, webAccepted, strictCount, expandedCount, rejectedCount,
        matchByIndustrySectorsCount, matchByThemesCount, matchByPrimaryThemeCount, matchByIndustryLabelCount,
        topRejectReasons, sampleMatched,
        finalProspectCount: finalProspectCountAfterError,
        stopReason: "EXCEPTION",
        errorDetails: { errorCode, message: errMsg, stack: errStack },
      },
    }).catch(() => {});

    return Response.json({
      error: finalErrorMessage, status: errorStatus,
      kbAccepted, prospectCount: finalProspectCountAfterError,
      errorDetails: { errorCode, message: errMsg },
    }, { status: 500 });
  }
});