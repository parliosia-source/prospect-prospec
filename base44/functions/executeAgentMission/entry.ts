import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ─────────────────────────────────────────────────────────────────────────────
// executeAgentMission — orchestrateur AgentMission
// Délègue toute la logique de recherche à prospectSearchEngine.
// ─────────────────────────────────────────────────────────────────────────────

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

    // Charger la mission
    const missions = await base44.asServiceRole.entities.AgentMission.filter(
      { id: missionId }, "-created_date", 1
    );
    if (!missions?.length) return Response.json({ error: "Mission introuvable" }, { status: 404 });
    const mission = missions[0];

    // Idempotence
    if (mission.status === "COMPLETED") {
      return Response.json({ message: "Mission déjà terminée", status: "COMPLETED" });
    }
    if (mission.status === "RUNNING") {
      return Response.json({ message: "Mission déjà en cours", status: "RUNNING" });
    }

    // Charger la campagne
    const campaigns = await base44.asServiceRole.entities.Campaign.filter(
      { id: mission.campaignId }, "-created_date", 1
    );
    if (!campaigns?.length) return Response.json({ error: "Campagne introuvable" }, { status: 404 });
    const campaign = campaigns[0];

    // Passer à RUNNING
    await base44.asServiceRole.entities.AgentMission.update(missionId, {
      status: "RUNNING",
      startedAt,
      errorMessage: null,
    });
    await base44.asServiceRole.entities.Campaign.update(campaign.id, {
      status: "RUNNING",
      progressPct: 5,
      lastRunAt: startedAt,
      errorMessage: null,
    });

    // Appeler le moteur commun
    const engineRes = await base44.asServiceRole.functions.invoke("prospectSearchEngine", {
      campaignId: campaign.id,
      mode: "WEB_ENRICHED",
    });

    const r = engineRes?.data || engineRes || {};
    const prospectsCreated = r.prospectsCreated ?? 0;
    const prospectsFound = r.prospectsFound ?? prospectsCreated;
    const duplicatesSkipped = r.duplicatesSkipped ?? 0;
    const target = campaign.targetCount || 50;
    const completedAt = new Date().toISOString();
    const debugInfo = r.debugInfo || null;

    // Mission → COMPLETED avec debugInfo en resultSummary
    await base44.asServiceRole.entities.AgentMission.update(missionId, {
      status: "COMPLETED",
      completedAt,
      errorMessage: null,
      resultSummary: JSON.stringify({
        prospectsRequested: target,
        prospectsFound,
        prospectsCreated,
        duplicatesSkipped,
        sourcesUsed: r.sourcesUsed || ["Brave Search"],
        queriesExecuted: r.queriesExecuted ?? 0,
        braveRequests: r.braveRequests ?? 0,
        startedAt,
        completedAt,
        debugInfo,
      }, null, 2),
    });

    // Campagne → statut final
    const finalStatus = prospectsCreated >= target ? "COMPLETED"
      : prospectsCreated > 0 ? "DONE_PARTIAL"
      : "COMPLETED";

    await base44.asServiceRole.entities.Campaign.update(campaign.id, {
      status: finalStatus,
      progressPct: 100,
      countProspects: (r.existingCount || 0) + prospectsCreated,
      toolUsage: {
        ...(r.toolUsage || {}),
        agentMissionId: missionId,
        debugInfo,
      },
      lastRunDebugSummary: r.debugSummary || `agent_mission=${missionId} created=${prospectsCreated}/${target}`,
    });

    return Response.json({
      status: "COMPLETED",
      prospectsRequested: target,
      prospectsFound,
      prospectsCreated,
      duplicatesSkipped,
      sourcesUsed: r.sourcesUsed || ["Brave Search"],
      debugInfo,
    });

  } catch (error) {
    try {
      if (base44 && missionId) {
        await base44.asServiceRole.entities.AgentMission.update(missionId, {
          status: "FAILED",
          errorMessage: error.message,
        });
        const ms = await base44.asServiceRole.entities.AgentMission.filter(
          { id: missionId }, "-created_date", 1
        ).catch(() => []);
        if (ms?.[0]?.campaignId) {
          await base44.asServiceRole.entities.Campaign.update(ms[0].campaignId, {
            status: "FAILED",
            errorMessage: error.message,
          });
        }
      }
    } catch (_) {}
    return Response.json({ error: error.message }, { status: 500 });
  }
});