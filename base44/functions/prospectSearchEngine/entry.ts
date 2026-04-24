import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ─── Tenant resolution ────────────────────────────────────────────────────────
async function resolveTenant(base44, tenantId) {
  const id = tenantId || "sync-default";
  try {
    const results = await base44.asServiceRole.entities.TenantSettings.filter(
      { tenantId: id, isActive: true }, "-created_date", 1
    );
    if (results?.length > 0) return results[0];
  } catch (_) {}
  try {
    const fallback = await base44.asServiceRole.entities.TenantSettings.filter(
      { settingsId: "global" }, "-created_date", 1
    );
    if (fallback?.length > 0) return fallback[0];
  } catch (_) {}
  return {
    tenantId: "sync-default",
    companyName: "Prospect",
    defaultCity: "Montréal",
    defaultCountry: "CA",
    targetGeographies: ["Montréal, QC"],
    searchKeywords: [],
    excludedKeywords: [],
    scoringMode: "RULES",
    scoringWeights: null,
    fitThresholdDefault: null,
    industryProfile: "",
  };
}

// ─── Geography resolution ──────────────────────────────────────────────────────
function resolveGeographies(tenant, campaign) {
  if (campaign?.locationQuery) return [campaign.locationQuery];
  if (tenant.targetGeographies?.length > 0) return tenant.targetGeographies;
  if (tenant.defaultCity) return [`${tenant.defaultCity}, ${tenant.defaultCountry || "CA"}`];
  return ["Canada"];
}

// ─── Query builder ─────────────────────────────────────────────────────────────
function buildSearchQueries(tenant, campaign, geographies) {
  const queries = [];
  const baseKeywords = [
    ...(campaign?.keywords || []),
    ...(tenant.searchKeywords || []),
  ];
  const sectors = campaign?.industrySectors || [];
  const excluded = [
    ...(tenant.excludedKeywords || []),
    ...(campaign?.extraExcludedDomains || []),
  ];
  const exclusionStr = excluded.length > 0
    ? ` -${excluded.slice(0, 3).join(" -")}`
    : "";

  for (const geo of geographies.slice(0, 3)) {
    if (sectors.length > 0) {
      for (const sector of sectors.slice(0, 4)) {
        if (baseKeywords.length > 0) {
          queries.push(`${sector} ${baseKeywords.slice(0, 2).join(" ")} ${geo}${exclusionStr}`);
        } else {
          queries.push(`${sector} entreprises ${geo}${exclusionStr}`);
        }
      }
    } else if (baseKeywords.length > 0) {
      queries.push(`${baseKeywords.slice(0, 3).join(" ")} ${geo}${exclusionStr}`);
    } else {
      const profileHint = tenant.industryProfile
        ? tenant.industryProfile.split(" ").slice(0, 4).join(" ")
        : "entreprises";
      queries.push(`${profileHint} ${geo}`);
    }
  }

  if (campaign?.agentBrief) {
    const briefWords = campaign.agentBrief.split(" ").slice(0, 6).join(" ");
    const geo = geographies[0] || "Canada";
    queries.push(`${briefWords} ${geo}`);
  }

  return queries.slice(0, 10);
}

// ─── Scoring ───────────────────────────────────────────────────────────────────
function scoreProspect(prospect, tenant, campaign) {
  const scoringMode = tenant.scoringMode || "RULES";
  if (scoringMode === "AI") return 50;

  const weights = tenant.scoringWeights || {};
  const wGeo = weights.geo ?? 30;
  const wSector = weights.sector ?? 25;
  const wKeyword = weights.keyword ?? 20;
  const wDomain = weights.domain ?? 15;
  const wEventFit = weights.eventFit ?? 10;

  let score = 0;
  const sectors = campaign?.industrySectors || [];
  const keywords = [
    ...(campaign?.keywords || []),
    ...(tenant.searchKeywords || []),
  ];
  const geographies = resolveGeographies(tenant, campaign);

  const locationStr = JSON.stringify(prospect.location || {}).toLowerCase();
  const geoMatch = geographies.some(g =>
    locationStr.includes(g.toLowerCase().split(",")[0].trim().toLowerCase())
  );
  if (geoMatch) score += wGeo;

  const prospectSectors = (prospect.industrySectors || []).map(s => s.toLowerCase());
  if (sectors.some(s => prospectSectors.includes(s.toLowerCase()))) score += wSector;

  const companyStr = `${prospect.companyName || ""} ${prospect.serpSnippet || ""}`.toLowerCase();
  if (keywords.some(k => companyStr.includes(k.toLowerCase()))) score += wKeyword;

  if (prospect.domain && !prospect.domain.includes("linkedin") && !prospect.domain.includes("facebook")) {
    score += wDomain;
  }

  const eventFit = prospect.eventFitScore || 0;
  score += Math.round((eventFit / 100) * wEventFit);

  return Math.min(100, Math.max(0, score));
}

// ─── Brave search ──────────────────────────────────────────────────────────────
async function searchBrave(query, apiKey, maxResults = 5) {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}&country=CA`;
  const res = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.web?.results || [];
}

// ─── Domain extraction ─────────────────────────────────────────────────────────
function extractDomain(url) {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch (_) { return ""; }
}

// ─── Prospect normalization ────────────────────────────────────────────────────
function normalizeProspect(result, campaignId, tenantId) {
  const domain = extractDomain(result.url || "");
  return {
    campaignId,
    tenantId: tenantId || "sync-default",
    companyName: result.title?.split(" - ")[0]?.split(" | ")[0]?.trim() || result.title || domain,
    website: result.url || `https://${domain}`,
    domain,
    serpSnippet: result.description || "",
    sourceUrl: result.url || "",
    status: "NOUVEAU",
    sourceOrigin: "WEB",
    location: {},
    relevanceScore: 0,
  };
}

// ─── Deduplication ─────────────────────────────────────────────────────────────
function deduplicateByDomain(prospects) {
  const seen = new Set();
  return prospects.filter(p => {
    if (!p.domain || seen.has(p.domain)) return false;
    seen.add(p.domain);
    return true;
  });
}

// ─── Exclusion loader ──────────────────────────────────────────────────────────
async function loadExcludedDomains(base44, campaignId) {
  const excluded = new Set();
  try {
    const global = await base44.asServiceRole.entities.ExclusionEntry.filter(
      { exclusionType: "GLOBAL", isActive: true }, "-created_date", 500
    );
    global.forEach(e => { if (e.domain) excluded.add(e.domain.toLowerCase()); });
    if (campaignId) {
      const campSpecific = await base44.asServiceRole.entities.ExclusionEntry.filter(
        { campaignId, isActive: true }, "-created_date", 200
      );
      campSpecific.forEach(e => { if (e.domain) excluded.add(e.domain.toLowerCase()); });
    }
  } catch (_) {}
  return excluded;
}

// ─── KB top-up ────────────────────────────────────────────────────────────────
async function kbTopUp(base44, campaign, tenant, existingDomains, target) {
  const sectors = campaign?.industrySectors || [];
  if (sectors.length === 0) return [];
  try {
    const kbEntities = await base44.asServiceRole.entities.KBEntityV3.filter(
      { kbTier: "VERIFIED", isExcluded: false }, "-confidenceScore", 500
    );
    const prospects = [];
    for (const entity of kbEntities) {
      if (prospects.length >= target) break;
      if (!entity.domain || existingDomains.has(entity.domain)) continue;
      if (entity.isExcluded) continue;
      const entitySectors = entity.industrySectors || [];
      const sectorMatch = sectors.length === 0 || sectors.some(s =>
        entitySectors.some(es => es.toLowerCase().includes(s.toLowerCase()))
      );
      if (!sectorMatch) continue;
      prospects.push({
        campaignId: campaign.id,
        tenantId: tenant.tenantId || "sync-default",
        companyName: entity.name,
        website: entity.website || `https://${entity.domain}`,
        domain: entity.domain,
        status: "NOUVEAU",
        sourceOrigin: "KB_TOPUP",
        kbEntityId: entity.id,
        kbTier: entity.kbTier || "VERIFIED",
        location: { city: entity.hqCity, province: entity.hqProvince, country: entity.hqCountry },
        relevanceScore: 0,
      });
    }
    return prospects;
  } catch (_) { return []; }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENGINE
// ─────────────────────────────────────────────────────────────────────────────
export async function runSearchEngine(base44, campaign, options = {}) {
  const startMs = Date.now();
  const { mode = "WEB_ENRICHED", onProgress = null } = options;

  const errors = [];
  const warnings = [];

  // API key check
  const BRAVE_KEY = Deno.env.get("BRAVE_API_KEY");
  if (!BRAVE_KEY && mode !== "KB_ONLY") {
    warnings.push("SOURCE_NOT_CONFIGURED: BRAVE_API_KEY manquante");
    if (mode !== "KB_ONLY") throw new Error("BRAVE_API_KEY manquante");
  }

  // AppSettings
  let appSettings = {};
  try {
    const s = await base44.asServiceRole.entities.AppSettings.filter(
      { settingsId: "global" }, "-created_date", 1
    );
    if (s?.length) appSettings = s[0];
  } catch (_) {}

  const tenant = await resolveTenant(base44, campaign.tenantId);
  const target = campaign.targetCount || 50;
  const fitThreshold = campaign.eventFitMinScore || tenant.fitThresholdDefault || 0;
  const excludedDomains = await loadExcludedDomains(base44, campaign.id);

  const existingProspects = await base44.asServiceRole.entities.Prospect.filter(
    { campaignId: campaign.id }, "-created_date", 500
  );
  const existingDomains = new Set(existingProspects.map(p => p.domain).filter(Boolean));

  let allProspects = [];
  let braveRequests = 0;
  let rawResultsCount = 0;
  let excludedCount = 0;
  let kbTopUpCount = 0;
  const geographies = resolveGeographies(tenant, campaign);
  const queries = buildSearchQueries(tenant, campaign, geographies);
  const sourcesUsed = [];

  if (mode === "KB_ONLY") {
    const kbResults = await kbTopUp(base44, campaign, tenant, existingDomains, target);
    kbTopUpCount = kbResults.length;
    allProspects = kbResults;
    sourcesUsed.push("KBEntityV3");
    if (kbResults.length > 0) warnings.push("KB_TOPUP_USED: résultats issus uniquement de la base KB");

  } else {
    const maxBraveRequests = appSettings.braveMaxRequestsPerCampaign || 200;
    const resultsPerQuery = appSettings.braveMaxPagesPerQuery || 5;
    const excludedKws = tenant.excludedKeywords || [];
    let queryNoResultCount = 0;

    for (const query of queries) {
      if (allProspects.length >= target * 1.5) break;
      if (braveRequests >= maxBraveRequests) break;

      const results = await searchBrave(query, BRAVE_KEY, resultsPerQuery);
      braveRequests++;
      rawResultsCount += results.length;

      if (results.length === 0) queryNoResultCount++;

      for (const result of results) {
        const p = normalizeProspect(result, campaign.id, tenant.tenantId);
        if (!p.domain) { excludedCount++; continue; }
        if (excludedDomains.has(p.domain)) { excludedCount++; continue; }
        if (existingDomains.has(p.domain)) { excludedCount++; continue; }
        const text = `${p.serpSnippet} ${p.companyName}`.toLowerCase();
        if (excludedKws.some(kw => text.includes(kw.toLowerCase()))) { excludedCount++; continue; }
        allProspects.push(p);
      }

      if (onProgress) {
        const pct = Math.min(80, Math.round((allProspects.length / target) * 80));
        await onProgress(pct);
      }
    }

    sourcesUsed.push("Brave Search");

    if (queryNoResultCount === queries.length) {
      warnings.push("NO_RAW_RESULTS: Brave n'a retourné aucun résultat pour toutes les requêtes");
    } else if (queryNoResultCount > queries.length / 2) {
      warnings.push(`NO_RAW_RESULTS: ${queryNoResultCount}/${queries.length} requêtes sans résultats`);
    }

    // KB top-up si insuffisant
    if (allProspects.length < target && appSettings.enableKbTopUp !== false) {
      const kbNeeded = target - allProspects.length;
      const allDomainsSoFar = new Set([
        ...existingDomains,
        ...allProspects.map(p => p.domain).filter(Boolean),
      ]);
      const kbResults = await kbTopUp(base44, campaign, tenant, allDomainsSoFar, kbNeeded);
      if (kbResults.length > 0) {
        kbTopUpCount = kbResults.length;
        allProspects = [...allProspects, ...kbResults];
        sourcesUsed.push("KBEntityV3");
        warnings.push(`KB_TOPUP_USED: ${kbTopUpCount} prospects ajoutés depuis la base KB pour compléter`);
      }
    }
  }

  // Dedup
  const beforeDedup = allProspects.length;
  const deduplicated = deduplicateByDomain(allProspects).slice(0, target);
  const prospectsFound = deduplicated.length;
  const duplicateCount = beforeDedup - prospectsFound;

  if (duplicateCount > 0 && beforeDedup > 0 && duplicateCount / beforeDedup > 0.4) {
    warnings.push(`MANY_DUPLICATES: ${duplicateCount}/${beforeDedup} résultats filtrés comme doublons (${Math.round(duplicateCount / beforeDedup * 100)}%)`);
  }

  // Score
  for (const p of deduplicated) {
    p.relevanceScore = scoreProspect(p, tenant, campaign);
  }

  // Filtre par seuil
  const finalProspects = fitThreshold > 0
    ? deduplicated.filter(p => p.relevanceScore >= fitThreshold)
    : deduplicated;

  const scoredCount = finalProspects.length;

  // Insertion idempotente
  let prospectsCreated = 0;
  for (const prospect of finalProspects) {
    try {
      await base44.asServiceRole.entities.Prospect.create(prospect);
      prospectsCreated++;
    } catch (_) {}
  }

  if (prospectsCreated < target) {
    warnings.push(`LOW_RESULTS: ${prospectsCreated}/${target} prospects créés — moins que l'objectif demandé`);
  }

  const durationMs = Date.now() - startMs;

  // ── Structured debug object ──
  const debugInfo = {
    sourceMode: mode,
    tenantId: tenant.tenantId,
    campaignId: campaign.id,
    requestedCount: target,
    rawResultsCount,
    excludedCount,
    duplicateCount,
    kbTopUpCount,
    scoredCount,
    createdCount: prospectsCreated,
    sourcesUsed,
    queriesExecuted: queries.length,
    braveRequests,
    geographies,
    scoringMode: tenant.scoringMode || "RULES",
    fitThreshold,
    errors,
    warnings,
    durationMs,
    timestamp: new Date().toISOString(),
  };

  const toolUsage = {
    braveRequests,
    prospectsInserted: prospectsCreated,
    geographies,
    tenantId: tenant.tenantId,
    scoringMode: tenant.scoringMode || "RULES",
    sourcesUsed,
    suggestedNextStep: prospectsCreated < target ? "RELAX_FILTERS" : null,
  };

  return {
    prospectsFound,
    prospectsCreated,
    duplicatesSkipped: duplicateCount,
    queriesExecuted: queries.length,
    braveRequests,
    sourcesUsed,
    existingCount: existingProspects.length,
    debugInfo,
    // Kept for backward-compat
    debugSummary: `tenant=${tenant.tenantId} geo=${geographies[0]} mode=${mode} queries=${queries.length} brave=${braveRequests} raw=${rawResultsCount} excluded=${excludedCount} found=${prospectsFound} created=${prospectsCreated}/${target} kb=${kbTopUpCount} scoring=${tenant.scoringMode || "RULES"} warnings=${warnings.length} duration=${durationMs}ms`,
    toolUsage,
  };
}

// ─── HTTP handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== "admin") {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const { campaignId, mode } = await req.json();
    if (!campaignId) return Response.json({ error: "campaignId requis" }, { status: 400 });

    const campaigns = await base44.asServiceRole.entities.Campaign.filter({ id: campaignId }, "-created_date", 1);
    if (!campaigns?.length) return Response.json({ error: "Campagne introuvable" }, { status: 404 });

    const result = await runSearchEngine(base44, campaigns[0], { mode: mode || "WEB_ENRICHED" });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});