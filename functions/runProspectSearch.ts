import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const BRAVE_KEY = Deno.env.get("BRAVE_API_KEY");
const SERP_KEY = Deno.env.get("SERPAPI_API_KEY");

// ── Sector label normalizer (anti-mismatch: accents, case, &/et) ──────────────
function normSector(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .replace(/\s*&\s*/g, " et ")
    .replace(/\s+/g, " ")
    .trim();
}

// Robust list parser: handles JSON arrays, comma-separated strings, NaN/empty
function parseArr(v) {
  if (Array.isArray(v)) return v;
  if (!v || String(v).trim() === "" || String(v).toLowerCase() === "nan") return [];
  const s = String(v).trim();
  if (s.startsWith("[")) { try { return JSON.parse(s).map(x => String(x).trim()).filter(Boolean); } catch(_) {} }
  return s.split(",").map(x => x.trim()).filter(Boolean);
}

// ── GM city set (normalized, no diacritics) ────────────────────────────────────
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

function normText(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
}

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

// ── Sector synonyms (for web queries) ─────────────────────────────────────────
const SECTOR_SYNONYMS = {
  "Technologie": ["IT","informatique","SaaS","logiciel","software","cloud","IA","AI","numérique","digital","cybersécurité","données","data","développement","startup","tech","infrastructure","DevOps","plateforme","ERP","CRM"],
  "Finance & Assurance": ["banque","bank","assurance","insurance","crédit","placement","investissement","fintech","capital","fonds","courtage"],
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

// ── Result normalizer ──────────────────────────────────────────────────────────
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
  if (requiredSectors.length > 0 && maxScore < 2) return null;

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

// ── Fuzzy sector matching — returns { matchedCanonical, whichMode } ──────────
// matchedCanonical: array of original (canonical) requiredSectors that matched
// whichMode: first mode that triggered the match
function fuzzyMatchSectors(kb, requiredSectors) {
  if (requiredSectors.length === 0) return { matchedCanonical: [], whichMode: null };

  const reqNorm = requiredSectors.map(normSector);

  const kbIndustrySectors = parseArr(kb.industrySectors);
  const kbThemes = parseArr(kb.themes);

  // Check industrySectors
  const normIS = kbIndustrySectors.map(normSector);
  const matchedFromIS = reqNorm.filter(r => normIS.includes(r));
  if (matchedFromIS.length > 0) {
    const canonical = requiredSectors.filter(r => matchedFromIS.includes(normSector(r)));
    return { matchedCanonical: canonical, whichMode: "industrySectors" };
  }

  // Check themes
  const normTh = kbThemes.map(normSector);
  const matchedFromTh = reqNorm.filter(r => normTh.includes(r));
  if (matchedFromTh.length > 0) {
    const canonical = requiredSectors.filter(r => matchedFromTh.includes(normSector(r)));
    return { matchedCanonical: canonical, whichMode: "themes" };
  }

  // Check primaryTheme
  if (reqNorm.includes(normSector(kb.primaryTheme))) {
    const canonical = requiredSectors.filter(r => normSector(r) === normSector(kb.primaryTheme));
    return { matchedCanonical: canonical.length > 0 ? canonical : [kb.primaryTheme], whichMode: "primaryTheme" };
  }

  // Check industryLabel
  if (reqNorm.includes(normSector(kb.industryLabel))) {
    const canonical = requiredSectors.filter(r => normSector(r) === normSector(kb.industryLabel));
    return { matchedCanonical: canonical.length > 0 ? canonical : [kb.industryLabel], whichMode: "industryLabel" };
  }

  return { matchedCanonical: [], whichMode: null };
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

  // ── Match breakdown counters ──────────────────────────────────────────────────
  let matchByIndustrySectorsCount = 0;
  let matchByThemesCount = 0;
  let matchByPrimaryThemeCount = 0;
  let matchByIndustryLabelCount = 0;
  const sampleMatched = [];

  try {
    // ══════════════════════════════════════════════════════════════════════
    // PHASE 1 — KBEntityV2
    // ══════════════════════════════════════════════════════════════════════
    let kbAll = [];
    let page = 0;
    while (Date.now() - START < MAX_MS * 0.4) {
      const batch = await base44.asServiceRole.entities.KBEntityV2.list('-confidenceScore', 500, page * 500).catch(() => []);
      if (!batch || batch.length === 0) break;
      kbAll = kbAll.concat(batch);
      if (batch.length < 500) break;
      page++;
      if (page >= 20) break;
    }
    const kbDomainSet = new Set(kbAll.map(e => (e.domain || "").toLowerCase()));
    console.log(`[KB] loaded=${kbAll.length}`);

    // Geo: determine required geoScope values from campaign locationQuery
    function resolveRequiredGeoScopes() {
      if (isMTL) return ["MTL_CMM"];
      const locNormInner = normText(locQuery);
      if (/\b(qc|qu[eé]bec)\b/.test(locNormInner)) return ["MTL_CMM", "QC_OTHER"];
      return ["MTL_CMM", "QC_OTHER", "CANADA_OTHER"];
    }
    const requiredGeoScopes = resolveRequiredGeoScopes();

    // Filter: region — V3 geoScope first, fallback to hqRegion/hqProvince
    const kbRegionFiltered = kbAll.filter(e => {
      if (!e.domain || !e.website || !e.name) return false;
      if (e.geoScope && e.geoScope !== "UNKNOWN") {
        return requiredGeoScopes.includes(e.geoScope);
      }
      if (isMTL) return ["MTL","GM"].includes(e.hqRegion);
      if (targetProvince) return e.hqProvince === targetProvince || ["MTL","GM","QC_OTHER"].includes(e.hqRegion);
      return true;
    });
    console.log(`[KB] afterRegion=${kbRegionFiltered.length} geoScopes=${requiredGeoScopes.join(",")}`);

    // Filter: sector — fuzzy match using fuzzyMatchSectors, count by mode
    const kbSectorFiltered = kbRegionFiltered.filter(e => {
      if (requiredSectors.length === 0) return true;
      const { whichMode } = fuzzyMatchSectors(e, requiredSectors);
      if (!whichMode) return false;
      if (whichMode === "industrySectors") matchByIndustrySectorsCount++;
      else if (whichMode === "themes") matchByThemesCount++;
      else if (whichMode === "primaryTheme") matchByPrimaryThemeCount++;
      else if (whichMode === "industryLabel") matchByIndustryLabelCount++;
      return true;
    });
    console.log(`[KB] afterSector=${kbSectorFiltered.length} IS=${matchByIndustrySectorsCount} TH=${matchByThemesCount} PT=${matchByPrimaryThemeCount} IL=${matchByIndustryLabelCount}`);

    // ── V3 Ranking ──────────────────────────────────────────────────────────
    const normRequired = requiredSectors.map(normSector);
    function rankScore(e) {
      const signals = parseArr(e.eventSignals);
      const flags = parseArr(e.qualityFlags);
      let score = 0;
      if (requiredSectors.length > 0 && normRequired.includes(normSector(e.primaryTheme))) score += 1000;
      const tc = typeof e.themeConfidence === "number" ? e.themeConfidence : (parseFloat(e.themeConfidence) || 0.55);
      score += tc * 100;
      if (signals.length > 0) score += 10;
      score += (e.confidenceScore || 70) * 0.2;
      const normFlagSectors = flags.map(f => {
        const m = f.match(/^THEME_EXPANDED:(.+):BACKFILL_150$/);
        return m ? normSector(m[1]) : null;
      }).filter(Boolean);
      if (normFlagSectors.some(f => normRequired.includes(f))) { score -= 20; }
      return score;
    }

    kbSectorFiltered.sort((a, b) => rankScore(b) - rankScore(a));

    for (const kb of kbSectorFiltered) {
      if (prospectCount >= targetCount) { stopReason = "TARGET_REACHED"; break; }
      if (Date.now() - START > MAX_MS * 0.45) { stopReason = "TIME_BUDGET_KB"; break; }

      const domNorm = (kb.domain || "").toLowerCase();
      if (existingDomains.has(domNorm)) continue;

      // ── Fuzzy sector mapping for this prospect ──────────────────────────
      const { matchedCanonical, whichMode } = fuzzyMatchSectors(kb, requiredSectors);

      // If matched, use campaign's required sectors as canonical label
      // so the UI always shows "Finance & Assurance" instead of a stale KB label
      const displaySectors = matchedCanonical.length > 0 ? matchedCanonical : [];
      const displayLabel = displaySectors[0] || kb.industryLabel || null;

      // Capture sample for debug (first 5 matched)
      if (sampleMatched.length < 5) {
        sampleMatched.push({
          name: kb.name,
          domain: kb.domain,
          primaryTheme: kb.primaryTheme || null,
          industryLabel: kb.industryLabel || null,
          industrySectors_raw: parseArr(kb.industrySectors),
          themes_raw: parseArr(kb.themes),
          whichModeMatched: whichMode,
          computedScore: rankScore(kb),
          displayLabel,
        });
      }

      await base44.entities.Prospect.create({
        campaignId,
        ownerUserId: campaign.ownerUserId,
        companyName: kb.name,
        website: kb.website || `https://${kb.domain}`,
        domain: domNorm,
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
      });

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
    // PHASE 2 — Brave Search (top-up)
    // ══════════════════════════════════════════════════════════════════════
    if (prospectCount < targetCount && !stopReason) {
      const queries = buildQueries(requiredSectors, locQuery);
      const MAX_BRAVE = 150;

      for (const query of queries) {
        if (prospectCount >= targetCount) { stopReason = "TARGET_REACHED"; break; }
        if (braveRequests >= MAX_BRAVE || braveRL.quotaExceeded) break;
        if (Date.now() - START > MAX_MS * 0.85) { stopReason = "TIME_BUDGET"; break; }

        const { results, rateLimited } = await braveSearch(query, 20);
        braveRequests++;
        if (rateLimited && braveRL.quotaExceeded) { console.log("[BRAVE] quota exceeded — skipping to web fallback"); break; }

        for (const r of results) {
          if (prospectCount >= targetCount) break;
          const norm = normalizeWebResult(r, requiredSectors, isMTL);
          if (!norm || norm.score < 55) continue;
          const domNorm = norm.domain.toLowerCase();
          if (existingDomains.has(domNorm)) continue;

          let kbEntityId = null;
          if (!kbDomainSet.has(domNorm) && norm.score >= 75) {
            try {
              const todayStr = new Date().toISOString().split("T")[0];
              const created = await base44.asServiceRole.entities.KBEntityV2.create({
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
                industrySectors: norm.bestSector ? [norm.bestSector] : requiredSectors.slice(0, 2),
                themes: norm.bestSector ? [norm.bestSector] : requiredSectors.slice(0, 2),
                entityType: "COMPANY",
                tags: [],
                notes: (norm.snippet || "").slice(0, 300),
                keywords: [],
                synonyms: [],
                sectorSynonymsUsed: [],
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
          });

          existingDomains.add(domNorm);
          webAccepted++;
          prospectCount++;
        }
      }
      console.log(`[BRAVE] END braveRequests=${braveRequests} webAccepted=${webAccepted} webTopUpInserted=${webTopUpInserted}`);
    }

    // ══════════════════════════════════════════════════════════════════════
    // PHASE 3 — SerpAPI fallback (only if Brave quota exceeded)
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
          if (!norm || norm.score < 55) continue;
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

    let finalStatus;
    let errorMessage = null;
    if (finalProspectCount >= targetCount) {
      finalStatus = "DONE";
    } else if (finalProspectCount > 0) {
      finalStatus = "DONE_PARTIAL";
      errorMessage = `${finalProspectCount}/${targetCount} prospects trouvés (KB=${kbAccepted}, Brave=${webAccepted}). Relancez pour enrichir.`;
    } else {
      finalStatus = "FAILED";
      errorMessage = "Aucun prospect trouvé. Vérifiez vos critères de secteur et de localisation.";
    }

    const matchedCountBeforeRanking = kbSectorFiltered.length;
    const matchedCountAfterDedupe = kbSectorFiltered.filter(kb => !existingDomains.has((kb.domain || "").toLowerCase())).length;

    const toolUsage = {
      kbLoaded: kbAll.length,
      kbRegionFiltered: kbRegionFiltered.length,
      kbSectorFiltered: kbSectorFiltered.length,
      kbAccepted,
      webAccepted,
      webTopUpInserted,
      braveRequests,
      braveQuotaExceeded: braveRL.quotaExceeded,
      brave429Count: braveRL.count429,
      finalProspectCount,
      matchedCountBeforeRanking,
      matchedCountAfterDedupe,
      selectedCount: kbAccepted + webAccepted,
      // ── Breakdown by match mode ──
      matchByIndustrySectorsCount,
      matchByThemesCount,
      matchByPrimaryThemeCount,
      matchByIndustryLabelCount,
      sampleMatched,
      stopReason: stopReason || (finalStatus === "DONE" ? "TARGET_REACHED" : "PARTIAL"),
      isMTL,
      targetProvince,
    };

    console.log(`[FINAL] status=${finalStatus} kb=${kbAccepted} web=${webAccepted} total=${finalProspectCount}/${targetCount} matchIS=${matchByIndustrySectorsCount} matchTH=${matchByThemesCount} matchPT=${matchByPrimaryThemeCount} matchIL=${matchByIndustryLabelCount}`);

    await base44.entities.Campaign.update(campaignId, {
      status: finalStatus,
      progressPct: 100,
      countProspects: finalProspectCount,
      countAnalyzed: finalProspects.filter(p => ["ANALYSÉ","QUALIFIÉ","REJETÉ","EXPORTÉ"].includes(p.status)).length,
      countQualified: finalProspects.filter(p => p.status === "QUALIFIÉ").length,
      countRejected: finalProspects.filter(p => p.status === "REJETÉ").length,
      errorMessage,
      toolUsage,
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

    return Response.json({ success: true, campaignId, prospectCount: finalProspectCount, kbAccepted, webAccepted, webTopUpInserted, status: finalStatus, toolUsage });

  } catch (error) {
    const errorCode = error.name || "Error";
    const errorMessage = error.message || "Erreur inconnue";
    const errorStack = (error.stack || "").split('\n').slice(0, 5).join('\n');

    console.error(`[ERROR] code=${errorCode} message=${errorMessage}`, errorStack);

    const finalProspectsAfterError = await base44.entities.Prospect.filter({ campaignId }).catch(() => []);
    const finalProspectCountAfterError = finalProspectsAfterError.length;

    const errorStatus = finalProspectCountAfterError > 0 ? "DONE_PARTIAL" : "FAILED";
    const finalErrorMessage = finalProspectCountAfterError > 0
      ? `Partiel: ${finalProspectCountAfterError} prospects trouvés. Erreur: ${errorMessage}`
      : errorMessage;

    await base44.entities.Campaign.update(campaignId, {
      status: errorStatus,
      errorMessage: finalErrorMessage,
      progressPct: 100,
      countProspects: finalProspectCountAfterError,
      toolUsage: {
        kbAccepted, webAccepted, webTopUpInserted,
        matchByIndustrySectorsCount, matchByThemesCount, matchByPrimaryThemeCount, matchByIndustryLabelCount,
        sampleMatched,
        finalProspectCount: finalProspectCountAfterError,
        stopReason: "EXCEPTION",
        errorDetails: { errorCode, message: errorMessage, stack: errorStack },
      },
    }).catch(() => {});

    return Response.json({
      error: finalErrorMessage,
      status: errorStatus,
      kbAccepted,
      prospectCount: finalProspectCountAfterError,
      errorDetails: { errorCode, message: errorMessage },
    }, { status: 500 });
  }
});