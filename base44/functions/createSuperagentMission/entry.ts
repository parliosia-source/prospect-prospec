import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CAMPAIGN_STATUS = {
  WAITING_AGENT: "WAITING_AGENT",
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
} as const;

const MISSION_STATUS = {
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
} as const;

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

// ─────────────────────────────────────────────────────────────────────────────
// createSuperagentMission — crée une Campaign + AgentMission dans Prospect+
// Cette fonction doit être déployée dans l'app Prospect+ pour utiliser son SDK natif.
// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  let base44;
  let campaignId: string | undefined;
  let agentMissionId: string | undefined;

  try {
    base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const payload = await req.json().catch(() => ({}));

    const name = String(payload.name || "").trim();
    const targetCount = Number(payload.targetCount || 0);
    const locationQuery = String(payload.locationQuery || "").trim();
    const brief = String(payload.brief || payload.agentBrief || "").trim();
    const industrySectors = normalizeStringArray(payload.industrySectors);
    const keywords = normalizeStringArray(payload.keywords);
    const tenantId = payload.tenantId || "sync-default";
    const autoExecute = Boolean(payload.autoExecute || false);

    if (!name) return badRequest("name requis");
    if (!targetCount || Number.isNaN(targetCount) || targetCount < 1) {
      return badRequest("targetCount requis et doit être supérieur à 0");
    }
    if (!locationQuery) return badRequest("locationQuery requis");
    if (!brief) return badRequest("brief requis");

    const now = new Date().toISOString();

    const campaignData = {
      name,
      status: CAMPAIGN_STATUS.WAITING_AGENT,
      sourceMode: "AGENT",
      targetCount,
      industrySectors,
      locationMode: payload.locationMode || "city",
      locationQuery,
      kbOnlyMode: false,
      agentBrief: brief,
      keywords,
      tenantId,
      ownerUserId: payload.ownerUserId || user.id || user.email,
      progressPct: 0,
      countProspects: 0,
      lastRunAt: now,
      errorMessage: null,
    };

    const campaign = await base44.asServiceRole.entities.Campaign.create(campaignData);
    campaignId = campaign.id;

    const missionParams = {
      targetCount,
      industrySectors,
      locationQuery,
      locationMode: payload.locationMode || "city",
      keywords,
      sourceMode: "AGENT",
      campaignName: name,
      tenantId,
      noAutomaticMessaging: true,
      ...(payload.companySize ? { companySize: payload.companySize } : {}),
      ...(payload.eventFitMinScore !== undefined ? { eventFitMinScore: payload.eventFitMinScore } : {}),
    };

    const missionData = {
      campaignId,
      tenantId,
      ownerUserId: payload.ownerUserId || user.id || user.email,
      status: MISSION_STATUS.PENDING,
      agentName: payload.agentName || "Prospect+ Superagent",
      brief,
      missionParams,
      startedAt: null,
      completedAt: null,
      resultSummary: null,
      errorMessage: null,
    };

    const mission = await base44.asServiceRole.entities.AgentMission.create(missionData);
    agentMissionId = mission.id;

    await base44.asServiceRole.entities.Campaign.update(campaignId, {
      agentMissionId,
      status: CAMPAIGN_STATUS.WAITING_AGENT,
    });

    let executionResult = null;
    if (autoExecute) {
      const res = await base44.asServiceRole.functions.invoke("executeAgentMission", {
        agentMissionId,
      });
      executionResult = res?.data || res || null;
    }

    return Response.json({
      status: autoExecute ? "CREATED_AND_EXECUTED" : MISSION_STATUS.PENDING,
      message: autoExecute ? "Mission Superagent créée et exécutée" : "Mission Superagent créée",
      campaignId,
      agentMissionId,
      autoExecute,
      executionResult,
    });

  } catch (error) {
    // Best-effort cleanup/mark failed if partially created.
    try {
      if (base44 && agentMissionId) {
        await base44.asServiceRole.entities.AgentMission.update(agentMissionId, {
          status: MISSION_STATUS.FAILED,
          errorMessage: error.message,
        });
      }
      if (base44 && campaignId) {
        await base44.asServiceRole.entities.Campaign.update(campaignId, {
          status: CAMPAIGN_STATUS.FAILED,
          errorMessage: error.message,
        });
      }
    } catch (_) {}

    return Response.json({ error: error.message }, { status: 500 });
  }
});
