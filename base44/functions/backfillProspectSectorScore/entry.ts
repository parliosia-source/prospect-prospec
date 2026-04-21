import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

async function writeWithRetry(base44, id, data, label) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await base44.asServiceRole.entities.Prospect.update(id, data);
      return true;
    } catch (e) {
      const isRL = e.status === 429 || (e.message || "").includes("Rate limit");
      if (isRL && attempt < 5) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 2000 + 500));
      } else {
        console.error(`[${label}] Failed ${id}: ${e.message}`);
        return false;
      }
    }
  }
  return false;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return Response.json({ error: "Forbidden: Admin only" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const dryRun = body.dryRun === true;
  const offset = body.offset || 0;
  const chunkSize = body.chunkSize || 400;

  let updated = 0, skipped = 0, failed = 0;
  const samples = [];

  const batch = await base44.asServiceRole.entities.Prospect
    .filter({}, "-created_date", chunkSize, offset)
    .catch(() => []);

  for (const p of batch) {
    if (typeof p.sectorScore === "number") { skipped++; continue; }
    if (typeof p.relevanceScore !== "number") { skipped++; continue; }

    if (samples.length < 5) samples.push({ companyName: p.companyName, relevanceScore: p.relevanceScore });

    if (!dryRun) {
      const ok = await writeWithRetry(base44, p.id, { sectorScore: p.relevanceScore }, "backfillProspectSectorScore");
      if (ok) updated++; else failed++;
      await new Promise(r => setTimeout(r, 350));
    } else {
      updated++;
    }
  }

  return Response.json({
    success: true, dryRun, offset, chunkSize,
    recordsInChunk: batch.length, updated, skipped, failed, samples,
    nextOffset: batch.length === chunkSize ? offset + chunkSize : null,
    done: batch.length < chunkSize,
  });
});