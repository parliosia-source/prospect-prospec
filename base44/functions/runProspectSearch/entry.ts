import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ─── Résolution du tenant ─────────────────────────────────────────────────────
async function resolveTenant(base44, payload, campaign) {
  const tenantId = payload.tenantId || campaign?.tenantId || "sync-default";

  try {
    const results = await base44.asServiceRole.entities.TenantSettings.filter(
      { tenantId, isActive: true }, "-created_date", 1
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

// ─── Résolution des géographies ───────────────────────────────────────────────
function resolveGeographies(tenant, campaign) {
  if (campaign?.locationQuery) return [campaign.locationQuery];
  if (tenant.targetGeographies?.length > 0) return tenant.targetGeographies;
  if (tenant.defaultCity) return [`${tenant.defaultCity}, ${tenant.defaultCountry || "CA"}`];
  return ["Canada"];
}

// ─── Construction des requêtes de recherche ───────────────────────────────────
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

  return queries.slice(0, 10);
}

// ─── Scoring ─────────────────────────────────────────────────────────────────
function scoreProspect(prospect, tenant, campaign) {
  const scoringMode = tenant.scoringMode || "RULES";
  const weights = tenant.scoringWeights || {};

  if (scoringMode === "AI") return 50;

  let score = 0;
  const wGeo = weights.geo ?? 30;
  const wSector = weights.sector ?? 25;
  const wKeyword = weights.keyword ?? 20;
  const wDomain = weights.domain ?? 15;
  const wEventFit = weights.eventFit ?? 10;

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
  const sectorMatch = sectors.some(s => prospectSectors.includes(s.toLowerCase()));
  if (sectorMatch) score += wSector;

  const companyStr = `${prospect.companyName || ""} ${prospect.serpSnippet || ""}`.toLowerCase();
  const kwMatch = keywords.some(k => companyStr.includes(k.toLowerCase()));
  if (kwMatch) score += wKeyword;

  if (prospect.domain && !prospect.domain.includes("linkedin") && !prospect.domain.includes("facebook")) {
    score += wDomain;
  }

  const eventFit = prospect.eventFitScore || 0;
  score += Math.round((eventFit / 100) * wEventFit);

  return Math.min(100, Math.max(0, score));
}

// ─── Recherche Brave ──────────────────────────────────────────────────────────
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

// ─── Extraction domaine ───────────────────────────────────────────────────────
function extractDomain(url) {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch (_) { return ""; }
}

// ─── Normalisation prospect ───────────────────────────────────────────────────
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

// ─── Déduplication ────────────────────────────────────────────────────────────
function deduplicateByDomain(prospects) {
  const seen = new Set();
  return prospects.filter(p => {
    if (!p.domain || seen.has(p.domain)) return false;
    seen.add(p.domain);
    return true;
  });
}

// ─── Chargement des exclusions ────────────────────────────────────────────────
async function loadExcludedDomains(base44, tenantId, campaignId) {
  const excluded = new Set();
  try {
    const globalExclusions = await base44.asServiceRole.entities.ExclusionEntry.filter(
      { exclusionType: "GLOBAL", isActive: true }, "-created_date", 500
    );
    for (const e of globalExclusions) {
      if (e.domain) excluded.add(e.domain.toLowerCase());
    }
    const campExclusions = await base44.asServiceRole.entities.ExclusionEntry.filter(
      { campaignId, isActive: true }, "-created_date", 200
    );
    for (const e of campExclusions) {
      if (e.domain) excluded.add(e.domain.toLowerCase());
    }
  } catch (_) {}
  return excluded;
}

// ─── KB top-up (réutilisé par KB_ONLY et WEB_ENRICHED) ───────────────────────
async function kbTopUp(base44, campaign, tenant, existingDomains, target, kbTierFilter) {
  const sectors = campaign?.industrySectors || [];

  // Déterminer le tier minimum selon le filtre
  let tierFilter = {};
  if (kbTierFilter === "VERIFIED_ONLY") {
    tierFilter = { kbTier: "VERIFIED" };
  } else if (kbTierFilter === "PROBABLE_AND_ABOVE") {
    // On récupère VERIFIED + PROBABLE
    tierFilter = {};
  }

  try {
    const kbEntities = await base44.asServiceRole.entities.KBEntityV3.filter(
      { isExcluded: false, ...tierFilter }, "-confidenceScore", 1000
    );

    const tierOrder = { VERIFIED: 3, PROBABLE: 2, UNVERIFIED: 1 };
    const minTier = kbTierFilter === "VERIFIED_ONLY" ? 3
      : kbTierFilter === "PROBABLE_AND_ABOVE" ? 2 : 1;

    const prospects = [];
    for (const entity of kbEntities) {
      if (prospects.length >= target) break;
      if (!entity.domain || existingDomains.has(entity.domain)) continue;
      if (entity.isExcluded) continue;
      const tierVal = tierOrder[entity.kbTier] || 1;
      if (tierVal < minTier) continue;

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
        industrySectors: entity.industrySectors || [],
        location: { city: entity.hqCity, province: entity.hqProvince, country: entity.hqCountry },
        relevanceScore: 0,
      });
    }
    return prospects;
  } catch (_) { return []; }
}

// ─── MODE 1: KB_ONLY ──────────────────────────────────────────────────────────
async function runKbOnly(base44, campaign, tenant, existingDomains, target) {
  const kbTierFilter = campaign.kbTierFilter || "ALL";
  const results = await kbTopUp(base44, campaign, tenant, existingDomains, target, kbTierFilter);

  const suggestWebEnrich = results.length < target;
  return {
    prospects: results,
    braveRequestCount: 0,
    suggestWebEnrich,
    message: suggestWebEnrich
      ? `Seulement ${results.length}/${target} prospects trouvés dans la base de connaissances. Passez en mode "Recherche web enrichie" pour compléter.`
      : null,
  };
}

// ─── MODE 2: WEB_ENRICHED ─────────────────────────────────────────────────────
async function runWebEnriched(base44, campaign, tenant, existingDomains, excludedDomains, target, appSettings) {
  const BRAVE_KEY = Deno.env.get("BRAVE_API_KEY");
  if (!BRAVE_KEY) throw new Error("BRAVE_API_KEY manquante — configurez la clé dans les secrets.");

  const geographies = resolveGeographies(tenant, campaign);
  const queries = buildSearchQueries(tenant, campaign, geographies);
  const maxBraveRequests = appSettings.braveMaxRequestsPerCampaign || 200;
  let braveRequestCount = 0;
  let allProspects = [];

  for (const query of queries) {
    if (allProspects.length >= target) break;
    if (braveRequestCount >= maxBraveRequests) break;

    const results = await searchBrave(query, BRAVE_KEY, appSettings.braveMaxPagesPerQuery || 5);
    braveRequestCount++;

    for (const result of results) {
      if (allProspects.length >= target * 1.5) break;
      const prospect = normalizeProspect(result, campaign.id, tenant.tenantId);
      if (!prospect.domain) continue;
      if (excludedDomains.has(prospect.domain)) continue;
      if (existingDomains.has(prospect.domain)) continue;
      const excludedKws = tenant.excludedKeywords || [];
      const snippetLower = (prospect.serpSnippet + " " + prospect.companyName).toLowerCase();
      if (excludedKws.some(kw => snippetLower.includes(kw.toLowerCase()))) continue;
      allProspects.push(prospect);
    }

    // Mise à jour de progression intermédiaire
    await base44.asServiceRole.entities.Campaign.update(campaign.id, {
      progressPct: Math.min(80, Math.round((allProspects.length / target) * 80)),
    });
  }

  // KB top-up si manque
  if (allProspects.length < target && appSettings.enableKbTopUp !== false) {
    const kbNeeded = target - allProspects.length;
    const allDomainsSoFar = new Set([
      ...Array.from(existingDomains),
      ...allProspects.map(p => p.domain).filter(Boolean),
    ]);
    const kbResults = await kbTopUp(base44, campaign, tenant, allDomainsSoFar, kbNeeded, "ALL");
    allProspects = [...allProspects, ...kbResults];
  }

  return { prospects: allProspects, braveRequestCount, geographies, queries };
}

// ─── MODE 3: AGENT ────────────────────────────────────────────────────────────
async function runAgentMode(base44, campaign, tenant, user) {
  const geographies = resolveGeographies(tenant, campaign);
  const sectors = campaign?.industrySectors || [];

  // Construire un brief structuré
  const brief = campaign.agentBrief || [
    `Mission de prospection automatisée.`,
    `Cible : ${campaign.targetCount || 50} entreprises.`,
    `Zone géographique : ${geographies.join(", ")}.`,
    sectors.length > 0 ? `Secteurs : ${sectors.join(", ")}.` : "",
    campaign.keywords?.length > 0 ? `Mots-clés : ${campaign.keywords.join(", ")}.` : "",
    campaign.companySize && campaign.companySize !== "ALL" ? `Taille d'entreprise : ${campaign.companySize}.` : "",
    `Scoring et qualification requis. Générer les messages d'approche.`,
  ].filter(Boolean).join(" ");

  const missionParams = {
    campaignId: campaign.id,
    campaignName: campaign.name,
    targetCount: campaign.targetCount || 50,
    geographies,
    industrySectors: sectors,
    keywords: campaign.keywords || [],
    companySize: campaign.companySize || "ALL",
    locationQuery: campaign.locationQuery,
    tenantId: tenant.tenantId,
    scoringMode: tenant.scoringMode || "RULES",
    sourceMode: "AGENT",
  };

  // Créer la mission agent en base
  const mission = await base44.asServiceRole.entities.AgentMission.create({
    campaignId: campaign.id,
    tenantId: tenant.tenantId,
    ownerUserId: user.email,
    status: "PENDING",
    brief,
    missionParams,
  });

  return { missionId: mission.id, brief };
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const payload = await req.json();
    const { campaignId } = payload;
    if (!campaignId) return Response.json({ error: "campaignId requis" }, { status: 400 });

    const campaigns = await base44.asServiceRole.entities.Campaign.filter({ id: campaignId }, "-created_date", 1);
    if (!campaigns?.length) return Response.json({ error: "Campagne introuvable" }, { status: 404 });
    const campaign = campaigns[0];

    const tenant = await resolveTenant(base44, payload, campaign);

    let appSettings = {};
    try {
      const s = await base44.asServiceRole.entities.AppSettings.filter({ settingsId: "global" }, "-created_date", 1);
      if (s?.length) appSettings = s[0];
    } catch (_) {}

    // Déterminer le sourceMode (rétrocompatibilité kbOnlyMode)
    let sourceMode = campaign.sourceMode || (campaign.kbOnlyMode ? "KB_ONLY" : "WEB_ENRICHED");

    const fitThreshold = campaign.eventFitMinScore || tenant.fitThresholdDefault || 0;

    // Marquer RUNNING
    await base44.asServiceRole.entities.Campaign.update(campaignId, {
      status: "RUNNING",
      progressPct: 5,
      lastRunAt: new Date().toISOString(),
      errorMessage: null,
      sourceMode,
    });

    const target = campaign.targetCount || 50;
    const geographies = resolveGeographies(tenant, campaign);

    // ── MODE AGENT ──────────────────────────────────────────────────────────────
    if (sourceMode === "AGENT") {
      const { missionId, brief } = await runAgentMode(base44, campaign, tenant, user);

      await base44.asServiceRole.entities.Campaign.update(campaignId, {
        status: "COMPLETED",
        progressPct: 100,
        countProspects: 0,
        toolUsage: { sourceMode: "AGENT", missionId },
        lastRunDebugSummary: `sourceMode=AGENT missionId=${missionId} tenant=${tenant.tenantId}`,
        errorMessage: null,
      });

      return Response.json({
        sourceMode: "AGENT",
        missionId,
        brief,
        message: "Mission agent créée. Elle sera exécutée par un Superagent.",
      });
    }

    // Charger exclusions et domaines existants
    const excludedDomains = await loadExcludedDomains(base44, tenant.tenantId, campaignId);
    const existingProspects = await base44.asServiceRole.entities.Prospect.filter(
      { campaignId }, "-created_date", 500
    );
    const existingDomains = new Set(existingProspects.map(p => p.domain).filter(Boolean));

    let allProspects = [];
    let braveRequestCount = 0;
    let queries = [];
    let userMessage = null;
    let suggestWebEnrich = false;

    // ── MODE KB_ONLY ────────────────────────────────────────────────────────────
    if (sourceMode === "KB_ONLY") {
      const result = await runKbOnly(base44, campaign, tenant, existingDomains, target);
      allProspects = result.prospects;
      braveRequestCount = 0;
      suggestWebEnrich = result.suggestWebEnrich;
      userMessage = result.message;

    // ── MODE WEB_ENRICHED ───────────────────────────────────────────────────────
    } else {
      const result = await runWebEnriched(
        base44, campaign, tenant, existingDomains, excludedDomains, target, appSettings
      );
      allProspects = result.prospects;
      braveRequestCount = result.braveRequestCount;
      queries = result.queries || [];
    }

    // Déduplication + scoring
    allProspects = deduplicateByDomain(allProspects).slice(0, target);
    for (const p of allProspects) {
      p.relevanceScore = scoreProspect(p, tenant, campaign);
    }

    // Filtre seuil
    const finalProspects = fitThreshold > 0
      ? allProspects.filter(p => p.relevanceScore >= fitThreshold)
      : allProspects;

    // Insertion
    let insertedCount = 0;
    for (const prospect of finalProspects) {
      try {
        await base44.asServiceRole.entities.Prospect.create(prospect);
        insertedCount++;
      } catch (_) {}
    }

    // Statut final
    let finalStatus;
    if (sourceMode === "KB_ONLY" && insertedCount === 0) {
      finalStatus = "DONE_PARTIAL";
    } else if (insertedCount >= target) {
      finalStatus = "COMPLETED";
    } else if (insertedCount > 0) {
      finalStatus = "DONE_PARTIAL";
    } else {
      finalStatus = "COMPLETED";
    }

    // Message si résultats insuffisants en WEB_ENRICHED
    if (sourceMode === "WEB_ENRICHED" && insertedCount < target) {
      userMessage = `${insertedCount}/${target} prospects trouvés. Essayez d'élargir la zone géographique, réduire les secteurs, ou retirer certains mots-clés.`;
    }

    await base44.asServiceRole.entities.Campaign.update(campaignId, {
      status: finalStatus,
      progressPct: 100,
      countProspects: (existingProspects.length || 0) + insertedCount,
      toolUsage: {
        sourceMode,
        suggestWebEnrich,
        braveRequests: braveRequestCount,
        prospectsInserted: insertedCount,
        geographies,
        tenantId: tenant.tenantId,
        scoringMode: tenant.scoringMode || "RULES",
        suggestedNextStep: suggestWebEnrich ? "SWITCH_TO_WEB_ENRICHED" : insertedCount < target ? "RELAX_FILTERS" : null,
        userMessage,
      },
      lastRunDebugSummary: `sourceMode=${sourceMode} tenant=${tenant.tenantId} geo=${geographies[0]} queries=${queries.length} brave=${braveRequestCount} inserted=${insertedCount}/${target} scoring=${tenant.scoringMode || "RULES"}`,
    });

    return Response.json({
      sourceMode,
      inserted: insertedCount,
      total: finalProspects.length,
      geographies,
      tenantId: tenant.tenantId,
      queries: queries.length,
      message: userMessage,
    });

  } catch (error) {
    try {
      const base44 = createClientFromRequest(req);
      const payload = await req.clone().json().catch(() => ({}));
      if (payload.campaignId) {
        await base44.asServiceRole.entities.Campaign.update(payload.campaignId, {
          status: "FAILED",
          errorMessage: error.message,
        });
      }
    } catch (_) {}
    return Response.json({ error: error.message }, { status: 500 });
  }
});