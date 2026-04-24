import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ─── Résolution du tenant ─────────────────────────────────────────────────────
async function resolveTenant(base44: any, payload: any, campaign: any): Promise<any> {
  const tenantId =
    payload.tenantId ||
    campaign?.tenantId ||
    "sync-default";

  try {
    const results = await base44.asServiceRole.entities.TenantSettings.filter(
      { tenantId, isActive: true }, "-created_date", 1
    );
    if (results?.length > 0) return results[0];
  } catch (_) { /* fallback */ }

  try {
    const fallback = await base44.asServiceRole.entities.TenantSettings.filter(
      { settingsId: "global" }, "-created_date", 1
    );
    if (fallback?.length > 0) return fallback[0];
  } catch (_) { /* ignore */ }

  // Valeurs par défaut si tout échoue
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

// ─── Résolution des géographies depuis tenant + campagne ──────────────────────
function resolveGeographies(tenant: any, campaign: any): string[] {
  // La campagne a priorité (locationQuery explicite)
  if (campaign?.locationQuery) return [campaign.locationQuery];
  // Sinon, targetGeographies du tenant
  if (tenant.targetGeographies?.length > 0) return tenant.targetGeographies;
  // Fallback
  if (tenant.defaultCity) return [`${tenant.defaultCity}, ${tenant.defaultCountry || "CA"}`];
  return ["Canada"];
}

// ─── Construction des requêtes de recherche ───────────────────────────────────
function buildSearchQueries(tenant: any, campaign: any, geographies: string[]): string[] {
  const queries: string[] = [];

  // Mots-clés : priorité à la campagne, puis tenant, puis vide
  const baseKeywords: string[] = [
    ...(campaign?.keywords || []),
    ...(tenant.searchKeywords || []),
  ];
  const sectors: string[] = campaign?.industrySectors || [];
  const excluded: string[] = [
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
          queries.push(`${sector} ${baseKeywords.slice(0,2).join(" ")} ${geo}${exclusionStr}`);
        } else {
          queries.push(`${sector} entreprises ${geo}${exclusionStr}`);
        }
      }
    } else if (baseKeywords.length > 0) {
      queries.push(`${baseKeywords.slice(0,3).join(" ")} ${geo}${exclusionStr}`);
    } else {
      // Fallback générique — utiliser le profil ICP si disponible
      const profileHint = tenant.industryProfile
        ? tenant.industryProfile.split(" ").slice(0, 4).join(" ")
        : "entreprises";
      queries.push(`${profileHint} ${geo}`);
    }
  }

  return queries.slice(0, 10);
}

// ─── Scoring configurable ─────────────────────────────────────────────────────
function scoreProspect(prospect: any, tenant: any, campaign: any): number {
  const scoringMode = tenant.scoringMode || "RULES";
  const weights = tenant.scoringWeights || {};

  if (scoringMode === "AI") {
    // En mode AI, on retourne un score neutre — l'IA calculera plus tard via analyzeProspect
    return 50;
  }

  // Mode RULES — scoring paramétrable
  let score = 0;

  // Poids configurables avec fallbacks
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

  // Géographie
  const locationStr = JSON.stringify(prospect.location || {}).toLowerCase();
  const geoMatch = geographies.some(g => locationStr.includes(g.toLowerCase().split(",")[0].trim().toLowerCase()));
  if (geoMatch) score += wGeo;

  // Secteur
  const prospectSectors = (prospect.industrySectors || []).map((s: string) => s.toLowerCase());
  const sectorMatch = sectors.some(s => prospectSectors.includes(s.toLowerCase()));
  if (sectorMatch) score += wSector;

  // Mots-clés
  const companyStr = `${prospect.companyName || ""} ${prospect.serpSnippet || ""}`.toLowerCase();
  const kwMatch = keywords.some(k => companyStr.includes(k.toLowerCase()));
  if (kwMatch) score += wKeyword;

  // Domaine valide
  if (prospect.domain && !prospect.domain.includes("linkedin") && !prospect.domain.includes("facebook")) {
    score += wDomain;
  }

  // eventFit (conservé pour rétrocompatibilité)
  const eventFit = prospect.eventFitScore || 0;
  score += Math.round((eventFit / 100) * wEventFit);

  return Math.min(100, Math.max(0, score));
}

// ─── Recherche Brave ──────────────────────────────────────────────────────────
async function searchBrave(query: string, apiKey: string, maxResults = 5): Promise<any[]> {
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
function extractDomain(url: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch (_) { return ""; }
}

// ─── Normalisation prospect ───────────────────────────────────────────────────
function normalizeProspect(result: any, campaignId: string, tenantId: string): any {
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
function deduplicateByDomain(prospects: any[]): any[] {
  const seen = new Set<string>();
  return prospects.filter(p => {
    if (!p.domain || seen.has(p.domain)) return false;
    seen.add(p.domain);
    return true;
  });
}

// ─── Filtre exclusions ────────────────────────────────────────────────────────
async function loadExcludedDomains(base44: any, tenantId: string, campaignId: string): Promise<Set<string>> {
  const excluded = new Set<string>();
  try {
    // Exclusions globales du tenant
    const globalExclusions = await base44.asServiceRole.entities.ExclusionEntry.filter(
      { exclusionType: "GLOBAL", isActive: true }, "-created_date", 500
    );
    for (const e of globalExclusions) {
      if (e.domain) excluded.add(e.domain.toLowerCase());
    }
    // Exclusions spécifiques à la campagne
    const campExclusions = await base44.asServiceRole.entities.ExclusionEntry.filter(
      { campaignId, isActive: true }, "-created_date", 200
    );
    for (const e of campExclusions) {
      if (e.domain) excluded.add(e.domain.toLowerCase());
    }
  } catch (_) { /* non-blocking */ }
  return excluded;
}

// ─── KB top-up ────────────────────────────────────────────────────────────────
async function kbTopUp(base44: any, campaign: any, tenant: any, existingDomains: Set<string>, target: number): Promise<any[]> {
  const sectors = campaign?.industrySectors || [];
  if (sectors.length === 0) return [];

  try {
    const kbEntities = await base44.asServiceRole.entities.KBEntityV3.filter(
      { kbTier: "VERIFIED", isExcluded: false }, "-confidenceScore", 500
    );

    const prospects: any[] = [];
    for (const entity of kbEntities) {
      if (prospects.length >= target) break;
      if (!entity.domain || existingDomains.has(entity.domain)) continue;
      if (entity.isExcluded) continue;

      const entitySectors = entity.industrySectors || [];
      const sectorMatch = sectors.length === 0 || sectors.some(s =>
        entitySectors.some((es: string) => es.toLowerCase().includes(s.toLowerCase()))
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

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const payload = await req.json();
    const { campaignId } = payload;
    if (!campaignId) return Response.json({ error: "campaignId requis" }, { status: 400 });

    // Charger la campagne
    const campaigns = await base44.asServiceRole.entities.Campaign.filter({ id: campaignId }, "-created_date", 1);
    if (!campaigns?.length) return Response.json({ error: "Campagne introuvable" }, { status: 404 });
    const campaign = campaigns[0];

    // Résolution du tenant
    const tenant = await resolveTenant(base44, payload, campaign);

    // AppSettings (coûts API, limites)
    let appSettings: any = {};
    try {
      const s = await base44.asServiceRole.entities.AppSettings.filter({ settingsId: "global" }, "-created_date", 1);
      if (s?.length) appSettings = s[0];
    } catch (_) { /* non-blocking */ }

    const BRAVE_KEY = Deno.env.get("BRAVE_API_KEY");
    if (!BRAVE_KEY) {
      await base44.asServiceRole.entities.Campaign.update(campaignId, { status: "FAILED", errorMessage: "BRAVE_API_KEY manquante" });
      return Response.json({ error: "BRAVE_API_KEY manquante" }, { status: 500 });
    }

    // Seuil de score depuis tenant ou campagne
    const fitThreshold = campaign.eventFitMinScore || tenant.fitThresholdDefault || 0;

    // Mettre à jour le statut
    await base44.asServiceRole.entities.Campaign.update(campaignId, {
      status: "RUNNING",
      progressPct: 5,
      lastRunAt: new Date().toISOString(),
      errorMessage: null,
    });

    const target = campaign.targetCount || 50;
    const geographies = resolveGeographies(tenant, campaign);
    const queries = buildSearchQueries(tenant, campaign, geographies);

    // Charger les exclusions
    const excludedDomains = await loadExcludedDomains(base44, tenant.tenantId, campaignId);

    // Domaines déjà dans cette campagne
    const existingProspects = await base44.asServiceRole.entities.Prospect.filter(
      { campaignId }, "-created_date", 500
    );
    const existingDomains = new Set<string>(existingProspects.map((p: any) => p.domain).filter(Boolean));

    let allProspects: any[] = [];
    const maxBraveRequests = appSettings.braveMaxRequestsPerCampaign || 200;
    let braveRequestCount = 0;

    // ─── Résolution du mode source ────────────────────────────────────────────
    // Rétrocompatibilité: si kbOnlyMode=true et sourceMode absent → KB_ONLY
    const sourceMode = campaign.sourceMode || (campaign.kbOnlyMode ? "KB_ONLY" : "WEB_ENRICHED");

    if (sourceMode === "AGENT") {
      // Mode Agent autonome: on enregistre le brief et on complète immédiatement
      // L'exécution réelle est déléguée à un agent (traitement asynchrone futur)
      await base44.asServiceRole.entities.Campaign.update(campaignId, {
        status: "COMPLETED",
        progressPct: 100,
        lastRunDebugSummary: `sourceMode=AGENT brief="${(campaign.agentBrief || "").slice(0, 80)}"`,
        toolUsage: { sourceMode: "AGENT", agentBriefLength: (campaign.agentBrief || "").length },
      });
      return Response.json({ sourceMode: "AGENT", status: "COMPLETED" });
    }

    if (sourceMode === "KB_ONLY") {
      // Mode Base existante: uniquement KB interne
      const kbResults = await kbTopUp(base44, campaign, tenant, existingDomains, target);
      allProspects = kbResults;
    } else {
      // Mode Recherche web enrichie (WEB_ENRICHED — par défaut)
      for (const query of queries) {
        if (allProspects.length >= target) break;
        if (braveRequestCount >= maxBraveRequests) break;

        const results = await searchBrave(query, BRAVE_KEY, appSettings.braveMaxPagesPerQuery || 5);
        braveRequestCount++;

        for (const result of results) {
          if (allProspects.length >= target * 1.5) break;
          const prospect = normalizeProspect(result, campaignId, tenant.tenantId);
          if (!prospect.domain) continue;
          if (excludedDomains.has(prospect.domain)) continue;
          if (existingDomains.has(prospect.domain)) continue;
          const excludedKws = tenant.excludedKeywords || [];
          const snippetLower = (prospect.serpSnippet + " " + prospect.companyName).toLowerCase();
          if (excludedKws.some((kw) => snippetLower.includes(kw.toLowerCase()))) continue;
          allProspects.push(prospect);
        }

        await base44.asServiceRole.entities.Campaign.update(campaignId, {
          progressPct: Math.min(80, Math.round((allProspects.length / target) * 80)),
        });
      }

      // KB top-up si pas assez de résultats web
      if (allProspects.length < target && (appSettings.enableKbTopUp !== false)) {
        const kbNeeded = target - allProspects.length;
        const allDomainsSoFar = new Set([
          ...Array.from(existingDomains),
          ...allProspects.map(p => p.domain).filter(Boolean),
        ]);
        const kbResults = await kbTopUp(base44, campaign, tenant, allDomainsSoFar, kbNeeded);
        allProspects = [...allProspects, ...kbResults];
      }
    }

    // Déduplication finale
    allProspects = deduplicateByDomain(allProspects).slice(0, target);

    // Scoring
    for (const p of allProspects) {
      p.relevanceScore = scoreProspect(p, tenant, campaign);
    }

    // Filtre seuil si configuré
    const finalProspects = fitThreshold > 0
      ? allProspects.filter(p => p.relevanceScore >= fitThreshold)
      : allProspects;

    // Insertion en base
    let insertedCount = 0;
    for (const prospect of finalProspects) {
      try {
        await base44.asServiceRole.entities.Prospect.create(prospect);
        insertedCount++;
      } catch (_) { /* skip duplicates */ }
    }

    const finalStatus = insertedCount >= target ? "COMPLETED" : insertedCount > 0 ? "DONE_PARTIAL" : "COMPLETED";

    await base44.asServiceRole.entities.Campaign.update(campaignId, {
      status: finalStatus,
      progressPct: 100,
      countProspects: (existingProspects.length || 0) + insertedCount,
      toolUsage: {
        sourceMode,
        braveRequests: braveRequestCount,
        prospectsInserted: insertedCount,
        geographies,
        tenantId: tenant.tenantId,
        scoringMode: tenant.scoringMode || "RULES",
        suggestedNextStep: insertedCount < target ? "RELAX_FILTERS" : null,
      },
      lastRunDebugSummary: `sourceMode=${sourceMode} tenant=${tenant.tenantId} geo=${geographies[0]} queries=${queries.length} brave=${braveRequestCount} inserted=${insertedCount}/${target} scoring=${tenant.scoringMode || "RULES"}`,
    });

    return Response.json({
      inserted: insertedCount,
      total: finalProspects.length,
      geographies,
      tenantId: tenant.tenantId,
      queries: queries.length,
    });
  } catch (error: any) {
    try {
      const base44 = createClientFromRequest(req);
      const payload = await req.clone().json().catch(() => ({}));
      if (payload.campaignId) {
        await base44.asServiceRole.entities.Campaign.update(payload.campaignId, {
          status: "FAILED",
          errorMessage: error.message,
        });
      }
    } catch (_) { /* ignore */ }
    return Response.json({ error: error.message }, { status: 500 });
  }
});