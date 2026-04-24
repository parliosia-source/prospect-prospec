import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ─────────────────────────────────────────────────────────────────────────────
// runProspectSearch — orchestrateur Campaign
//
// Délègue toute la logique de recherche à prospectSearchEngine.
// Ne gère ici que les transitions de statut Campaign.
// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  let base44;
  let campaignId;

  try {
    base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const payload = await req.json();
    campaignId = payload.campaignId;
    if (!campaignId) return Response.json({ error: "campaignId requis" }, { status: 400 });

    // Charger la campagne
    const campaigns = await base44.asServiceRole.entities.Campaign.filter({ id: campaignId }, "-created_date", 1);
    if (!campaigns?.length) return Response.json({ error: "Campagne introuvable" }, { status: 404 });
    const campaign = campaigns[0];

    // Résoudre le mode source
    const mode = campaign.sourceMode || (campaign.kbOnlyMode ? "KB_ONLY" : "WEB_ENRICHED");

    // Si mode AGENT → créer la mission et passer en WAITING_AGENT
    if (mode === "AGENT") {
      const missionData = {
        campaignId,
        tenantId: campaign.tenantId || "sync-default",
        ownerUserId: campaign.ownerUserId,
        status: "PENDING",
        brief: campaign.agentBrief || `Campagne : ${campaign.name}`,
        missionParams: {
          locationQuery: campaign.locationQuery,
          industrySectors: campaign.industrySectors,
          companySize: campaign.companySize,
          keywords: campaign.keywords,
          targetCount: campaign.targetCount,
        },
      };
      const mission = await base44.asServiceRole.entities.AgentMission.create(missionData);
      await base44.asServiceRole.entities.Campaign.update(campaignId, {
        status: "WAITING_AGENT",
        agentMissionId: mission.id,
        lastRunAt: new Date().toISOString(),
        errorMessage: null,
      });
      return Response.json({ status: "WAITING_AGENT", agentMissionId: mission.id });
    }

    // Passer en RUNNING
    await base44.asServiceRole.entities.Campaign.update(campaignId, {
      status: "RUNNING",
      progressPct: 5,
      lastRunAt: new Date().toISOString(),
      errorMessage: null,
    });

    // Appeler le moteur commun via SDK (invocation interne)
    const engineRes = await base44.asServiceRole.functions.invoke("prospectSearchEngine", {
      campaignId,
      mode,
    });

    const r = engineRes?.data || engineRes || {};
    const prospectsCreated = r.prospectsCreated ?? 0;
    const target = campaign.targetCount || 50;
    const finalStatus = prospectsCreated >= target ? "COMPLETED"
      : prospectsCreated > 0 ? "DONE_PARTIAL"
      : "COMPLETED";

    await base44.asServiceRole.entities.Campaign.update(campaignId, {
      status: finalStatus,
      progressPct: 100,
      countProspects: (r.existingCount || 0) + prospectsCreated,
      toolUsage: r.toolUsage || {},
      lastRunDebugSummary: r.debugSummary || "",
    });

    return Response.json({
      inserted: prospectsCreated,
      total: r.prospectsFound ?? prospectsCreated,
      status: finalStatus,
    });

  } catch (error) {
    try {
      if (campaignId && base44) {
        await base44.asServiceRole.entities.Campaign.update(campaignId, {
          status: "FAILED",
          errorMessage: error.message,
        });
      }
    } catch (_) {}
    return Response.json({ error: error.message }, { status: 500 });
  }
});