import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { campaignId, deleteProspects } = await req.json();
  if (!campaignId) return Response.json({ error: "campaignId requis" }, { status: 400 });

  const campaigns = await base44.asServiceRole.entities.Campaign.filter({ id: campaignId });
  const campaign = campaigns[0];
  if (!campaign) return Response.json({ error: "Campagne introuvable" }, { status: 404 });

  if (campaign.ownerUserId !== user.email && campaign.created_by !== user.email && user.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (campaign.status === "RUNNING") {
    return Response.json({ error: "Arrêtez d'abord la campagne avant de la supprimer." }, { status: 400 });
  }

  if (deleteProspects) {
    const prospects = await base44.asServiceRole.entities.Prospect.filter({ campaignId }, "-created_date", 500);

    // Delete contacts and messages linked to prospects
    for (const prospect of prospects) {
      try {
        const [contacts, messages] = await Promise.all([
          base44.asServiceRole.entities.Contact.filter({ prospectId: prospect.id }),
          base44.asServiceRole.entities.Message.filter({ prospectId: prospect.id }),
        ]);
        await Promise.allSettled([
          ...contacts.map(c => base44.asServiceRole.entities.Contact.delete(c.id)),
          ...messages.map(m => base44.asServiceRole.entities.Message.delete(m.id)),
        ]);
      } catch (_) {}
    }

    // Delete prospects in chunks of 20
    for (let i = 0; i < prospects.length; i += 20) {
      const chunk = prospects.slice(i, i + 20);
      await Promise.allSettled(chunk.map(p => base44.asServiceRole.entities.Prospect.delete(p.id)));
    }
  }

  await base44.asServiceRole.entities.Campaign.delete(campaignId);

  try {
    await base44.entities.ActivityLog.create({
      ownerUserId: user.email,
      actionType: "DELETE_CAMPAIGN",
      entityType: "Campaign",
      entityId: campaignId,
      payload: { campaignName: campaign.name, status: campaign.status, deleteProspects },
      status: "SUCCESS"
    });
  } catch (_) {}

  return Response.json({ success: true });
});