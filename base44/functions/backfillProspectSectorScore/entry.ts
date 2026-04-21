import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

async function writeWithRetry(base44, id, data) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await base44.asServiceRole.entities.Prospect.update(id, data);
      return { ok: true };
    } catch (e) {
      const isRL = e.status === 429 || (e.message || "").includes("Rate limit");
      if (isRL && attempt < 3) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 3000));
      } else {
        return { ok: false, error: e.message };
      }
    }
  }
  return { ok: false, error: "Max retries" };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const dryRun = body.dryRun === true;
  const offset = body.offset || 0;
  const chunkSize = body.chunkSize || 50;

  const batch = await base44.asServiceRole.entities.Prospect
    .filter({}, "-created_date", chunkSize, offset)
    .catch(() => []);

  let processedCount = 0, successCount = 0, errorCount = 0, skippedCount = 0;
  const errorIds = [];

  for (const p of batch) {
    processedCount++;

    if (typeof p.sectorScore === "number") { skippedCount++; continue; }
    if (typeof p.relevanceScore !== "number") { skippedCount++; continue; }

    if (!dryRun) {
      const res = await writeWithRetry(base44, p.id, { sectorScore: p.relevanceScore });
      if (res.ok) successCount++;
      else { errorCount++; errorIds.push({ id: p.id, name: p.companyName, error: res.error }); }
      await new Promise(r => setTimeout(r, 600));
    } else {
      successCount++;
    }
  }

  const hasMore = batch.length === chunkSize;

  return Response.json({
    success: true, dryRun, offset, chunkSize,
    processedCount, successCount, errorCount, skippedCount,
    errorIds, hasMore,
    nextOffsetSuggested: hasMore ? offset + chunkSize : null,
  });
});