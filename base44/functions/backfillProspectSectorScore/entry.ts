import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Simple backfill: sectorScore = relevanceScore for existing prospects
// This initializes the new field without modifying relevanceScore

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return Response.json({ error: "Forbidden: Admin only" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const dryRun = body.dryRun === true;
  const limit = body.limit || 0;

  let page = 0;
  let total = 0, updated = 0, skipped = 0, failed = 0;
  const samples = [];

  while (true) {
    const batch = await base44.asServiceRole.entities.Prospect
      .filter({}, "-created_date", 500, page * 500)
      .catch(() => []);
    if (!batch || batch.length === 0) break;

    for (const p of batch) {
      if (limit > 0 && total >= limit) break;
      total++;

      // Skip if sectorScore already set
      if (typeof p.sectorScore === "number") {
        skipped++;
        continue;
      }

      // Skip if no relevanceScore to copy
      if (typeof p.relevanceScore !== "number") {
        skipped++;
        continue;
      }

      if (samples.length < 10) {
        samples.push({ id: p.id, companyName: p.companyName, relevanceScore: p.relevanceScore, sectorScoreToSet: p.relevanceScore });
      }

      if (!dryRun) {
        try {
          await base44.asServiceRole.entities.Prospect.update(p.id, { sectorScore: p.relevanceScore });
          updated++;
        } catch (e) {
          console.error(`[backfillProspectSectorScore] Failed ${p.id}: ${e.message}`);
          failed++;
        }
      } else {
        updated++;
      }
    }

    if (batch.length < 500) break;
    if (limit > 0 && total >= limit) break;
    page++;
    if (page >= 40) break;
  }

  return Response.json({ success: true, dryRun, total, updated, skipped, failed, samples });
});