import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractDomain(url) {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch (_) { return ""; }
}

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

function deduplicateByDomain(prospects) {
  const seen = new Set();
  return prospects.filter(p => {
    if (!p.domain || seen.has(p.domain)) return false;
    seen.add(p.domain);
    return true;
  });
}

function buildSearchQueries(campaign, tenant) {
  const sectors = campaign.industrySectors || [];
  const keywords = [
    ...(campaign.keywords || []),
    ...(tenant?.searchKeywords || []),
  ];
  const geo = campaign.locationQuery || tenant?.defaultCity || "Canada";
  const excluded = [
    ...(tenant?.excludedKeywords || []),
    ...(campaign.extraExcludedDomains || []),
  ];
  const exclusionStr = excluded.length > 0
    ? ` -${excluded.slice(0, 3).join(" -")}`
    : "";

  const queries = [];
  if (sectors.length > 0) {
    for (const sector of sectors.slice(0, 5)) {
      if (keywords.length > 0) {
        queries.push(`${sector} ${keywords.slice(0, 2).join(" ")} ${geo}${exclusionStr}`);
      } else {
        queries.push(`${sector} entreprises ${geo}${exclusionStr}`);
      }
    }
  } else if (keywords.length > 0) {
    queries.push(`${keywords.slice(0, 3).join(" ")} ${geo}${exclusionStr}`);
  } else {
    const profileHint = tenant?.industryProfile
      ? tenant.industryProfile.split(" ").slice(0, 4).join(" ")
      : "entreprises";
    queries.push(`${profileHint} ${geo}`);
  }

  // Add brief-based query if available
  if (campaign.agentBrief) {
    const briefWords = campaign.agentBrief.split(" ").slice(0, 6).join(" ");
    queries.push(`${briefWords} ${geo}`);
  }

  return queries.slice(0, 10);
}

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

function scoreProspect(prospect, campaign, tenant) {
  let score = 0;
  const sectors = campaign.industrySectors || [];
  const keywords = [...(campaign.keywords || []), ...(tenant?.searchKeywords || [])];
  const geo = campaign.locationQuery || "";

  const locationStr = JSON.stringify(prospect.location || {}).toLowerCase();
  if (geo && locationStr.includes(geo.toLowerCase().split(",")[0].trim().toLowerCase())) score += 30;

  const prospectSectors = (prospect.industrySectors || []).map(s => s.toLowerCase());
  if (sectors.some(s => prospectSectors.includes(s.toLowerCase()))) score += 25;

  const companyStr = `${prospect.companyName || ""} ${prospect.serpSnippet || ""}`.toLowerCase();
  if (keywords.some(k => companyStr.includes(k.toLowerCase()))) score += 20;

  if (prospect.domain && !prospect.domain.includes("linkedin") && !prospect.domain.includes("facebook")) score += 15;

  return Math.min(100, Math.max(0, score));
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const startedAt = new Date().toISOString();
  let base44;
  let missionId;

  try {
    base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const payload = await req.json();
    missionId = payload.agentMissionId;
    if (!missionId) return Response.json({ error: "agentMissionId requis" }, { status: 400 });

    // 1. Charger la mission
    const missions = await base44.asServiceRole.entities.AgentMission.filter({ id: missionId }, "-created_date", 1);
    if (!missions?.length) return Response.json({ error: "Mission introuvable" }, { status: 404 });
    const mission = missions[0];

    // 2. Vérifier idempotence
    if (mission.status === "COMPLETED") {
      return Response.json({ message: "Mission déjà terminée", status: "COMPLETED" });
    }
    if (mission.status === "RUNNING") {
      return Response.json({ message: "Mission déjà en cours", status: "RUNNING" });
    }

    // 3. Charger la campagne
    const campaigns = await base44.asServiceRole.entities.Campaign.filter({ id: mission.campaignId }, "-created_date", 1);
    if (!campaigns?.length) return Response.json({ error: "Campagne introuvable" }, { status: 404 });
    const campaign = campaigns[0];

    // 4. Passer à RUNNING
    await base44.asServiceRole.entities.AgentMission.update(missionId, {
      status: "RUNNING",
      startedAt,
    });
    await base44.asServiceRole.entities.Campaign.update(campaign.id, {
      status: "RUNNING",
      progressPct: 5,
      lastRunAt: startedAt,
      errorMessage: null,
    });

    // 5. Charger le tenant
    let tenant = null;
    try {
      const tenantId = campaign.tenantId || "sync-default";
      const tenants = await base44.asServiceRole.entities.TenantSettings.filter({ tenantId }, "-created_date", 1);
      if (tenants?.length) tenant = tenants[0];
      else {
        const fallback = await base44.asServiceRole.entities.TenantSettings.filter({ settingsId: "global" }, "-created_date", 1);
        if (fallback?.length) tenant = fallback[0];
      }
    } catch (_) { /* non-blocking */ }

    const BRAVE_KEY = Deno.env.get("BRAVE_API_KEY");
    if (!BRAVE_KEY) throw new Error("BRAVE_API_KEY manquante");

    const target = campaign.targetCount || 50;

    // 6. Charger les prospects existants (dédup idempotente)
    const existingProspects = await base44.asServiceRole.entities.Prospect.filter(
      { campaignId: campaign.id }, "-created_date", 500
    );
    const existingDomains = new Set(existingProspects.map(p => p.domain).filter(Boolean));

    // 7. Charger exclusions
    const excluded = new Set();
    try {
      const excl = await base44.asServiceRole.entities.ExclusionEntry.filter({ exclusionType: "GLOBAL", isActive: true }, "-created_date", 500);
      excl.forEach(e => { if (e.domain) excluded.add(e.domain.toLowerCase()); });
    } catch (_) { /* non-blocking */ }

    // 8. Construire requêtes et lancer la recherche
    const queries = buildSearchQueries(campaign, tenant);
    const rawProspects = [];
    let braveRequests = 0;

    for (const query of queries) {
      if (rawProspects.length >= target * 1.5) break;
      const results = await searchBrave(query, BRAVE_KEY, 5);
      braveRequests++;
      for (const result of results) {
        const p = normalizeProspect(result, campaign.id, campaign.tenantId || "sync-default");
        if (!p.domain) continue;
        if (excluded.has(p.domain)) continue;
        if (existingDomains.has(p.domain)) continue;
        const excludedKws = tenant?.excludedKeywords || [];
        const text = `${p.serpSnippet} ${p.companyName}`.toLowerCase();
        if (excludedKws.some(kw => text.includes(kw.toLowerCase()))) continue;
        rawProspects.push(p);
      }

      // Update progress
      await base44.asServiceRole.entities.Campaign.update(campaign.id, {
        progressPct: Math.min(80, Math.round((rawProspects.length / target) * 80)),
      });
    }

    // 9. Déduplication + scoring
    const deduplicated = deduplicateByDomain(rawProspects).slice(0, target);
    const prospectsFound = deduplicated.length;
    const duplicatesSkipped = rawProspects.length - prospectsFound;

    for (const p of deduplicated) {
      p.relevanceScore = scoreProspect(p, campaign, tenant);
    }

    // 10. Insertion idempotente
    let prospectsCreated = 0;
    for (const prospect of deduplicated) {
      try {
        await base44.asServiceRole.entities.Prospect.create(prospect);
        prospectsCreated++;
      } catch (_) { /* skip duplicates */ }
    }

    const completedAt = new Date().toISOString();
    const sourcesUsed = ["Brave Search"];

    // 11. Mettre à jour mission → COMPLETED
    await base44.asServiceRole.entities.AgentMission.update(missionId, {
      status: "COMPLETED",
      completedAt,
      resultSummary: JSON.stringify({
        prospectsRequested: target,
        prospectsFound,
        prospectsCreated,
        duplicatesSkipped,
        sourcesUsed,
        queriesExecuted: queries.length,
        braveRequests,
        startedAt,
        completedAt,
      }, null, 2),
      errorMessage: null,
    });

    // 12. Mettre à jour campagne → COMPLETED
    const finalStatus = prospectsCreated >= target ? "COMPLETED" : prospectsCreated > 0 ? "DONE_PARTIAL" : "COMPLETED";
    await base44.asServiceRole.entities.Campaign.update(campaign.id, {
      status: finalStatus,
      progressPct: 100,
      countProspects: existingProspects.length + prospectsCreated,
      toolUsage: {
        braveRequests,
        prospectsInserted: prospectsCreated,
        sourcesUsed,
        agentMissionId: missionId,
      },
      lastRunDebugSummary: `agent_mission=${missionId} queries=${queries.length} brave=${braveRequests} found=${prospectsFound} created=${prospectsCreated}/${target}`,
    });

    return Response.json({
      status: "COMPLETED",
      prospectsRequested: target,
      prospectsFound,
      prospectsCreated,
      duplicatesSkipped,
      sourcesUsed,
    });

  } catch (error) {
    // 13. En cas d'erreur
    try {
      if (missionId) {
        await base44.asServiceRole.entities.AgentMission.update(missionId, {
          status: "FAILED",
          errorMessage: error.message,
        });
        // Récupérer la campagne pour la passer en FAILED
        const missions = await base44.asServiceRole.entities.AgentMission.filter({ id: missionId }, "-created_date", 1).catch(() => []);
        if (missions?.[0]?.campaignId) {
          await base44.asServiceRole.entities.Campaign.update(missions[0].campaignId, {
            status: "FAILED",
            errorMessage: error.message,
          });
        }
      }
    } catch (_) { /* ignore */ }
    return Response.json({ error: error.message }, { status: 500 });
  }
});