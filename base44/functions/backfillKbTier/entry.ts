import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function inferKbTier(kb) {
  if (kb.isExcluded) return "EXCLUDED";
  const score = typeof kb.confidenceScore === "number" ? kb.confidenceScore : (parseFloat(kb.confidenceScore) || 50);
  const hasVerifiedAt = !!kb.lastVerifiedAt;
  const source = (kb.sourceOrigin || "").toUpperCase();
  if (source === "MANUAL" && hasVerifiedAt) return "VERIFIED";
  if (["MIGRATION", "IMPORT"].includes(source) && score >= 80 && hasVerifiedAt) return "VERIFIED";
  if (score >= 85 && hasVerifiedAt) return "VERIFIED";
  if (source === "SEED" && score >= 70) return "PROBABLE";
  if (["MIGRATION", "IMPORT"].includes(source) && score >= 65) return "PROBABLE";
  if (source === "KB" && score >= 65) return "PROBABLE";
  if (source === "WEB") return score >= 75 ? "PROBABLE" : "UNVERIFIED";
  if (score < 50) return "UNVERIFIED";
  return "PROBABLE";
}

async function writeWithRetry(base44, id, data) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await base44.asServiceRole.entities.KBEntityV3.update(id, data);
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

  const batch = await base44.asServiceRole.entities.KBEntityV3
    .filter({}, "-created_date", chunkSize, offset)
    .catch(() => []);

  let processedCount = 0, successCount = 0, errorCount = 0, skippedCount = 0;
  const errorIds = [];
  const tierCounts = { VERIFIED: 0, PROBABLE: 0, UNVERIFIED: 0, EXCLUDED: 0 };

  for (const kb of batch) {
    processedCount++;

    if (kb.kbTier && kb.kbTier !== "PROBABLE") {
      skippedCount++;
      tierCounts[kb.kbTier] = (tierCounts[kb.kbTier] || 0) + 1;
      continue;
    }

    const newTier = inferKbTier(kb);
    tierCounts[newTier] = (tierCounts[newTier] || 0) + 1;

    if (!dryRun) {
      const res = await writeWithRetry(base44, kb.id, { kbTier: newTier });
      if (res.ok) successCount++;
      else { errorCount++; errorIds.push({ id: kb.id, name: kb.name, error: res.error }); }
      await new Promise(r => setTimeout(r, 600));
    } else {
      successCount++;
    }
  }

  const hasMore = batch.length === chunkSize;
  const nextOffsetSuggested = hasMore ? offset + chunkSize : null;

  return Response.json({
    success: true, dryRun, offset, chunkSize,
    processedCount, successCount, errorCount, skippedCount,
    tierCounts, errorIds,
    hasMore, nextOffsetSuggested,
  });
});