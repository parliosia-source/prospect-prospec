import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── kbTier inference rules ─────────────────────────────────────────────────
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

async function writeWithRetry(base44, id, data, label) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await base44.asServiceRole.entities.KBEntityV3.update(id, data);
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
  // offset = starting record index, chunkSize = how many to process per call
  const offset = body.offset || 0;
  const chunkSize = body.chunkSize || 400;

  let total = 0, updated = 0, skipped = 0, failed = 0;
  const tierCounts = { VERIFIED: 0, PROBABLE: 0, UNVERIFIED: 0, EXCLUDED: 0 };
  const samples = [];

  // Fetch one chunk at the given offset
  const batch = await base44.asServiceRole.entities.KBEntityV3
    .filter({}, "-created_date", chunkSize, offset)
    .catch(() => []);

  total = batch.length;

  for (const kb of batch) {
    // Skip if already set to a non-default value
    if (kb.kbTier && kb.kbTier !== "PROBABLE") {
      skipped++;
      tierCounts[kb.kbTier] = (tierCounts[kb.kbTier] || 0) + 1;
      continue;
    }

    const newTier = inferKbTier(kb);
    tierCounts[newTier] = (tierCounts[newTier] || 0) + 1;

    if (samples.length < 5) {
      samples.push({ id: kb.id, name: kb.name, sourceOrigin: kb.sourceOrigin, confidenceScore: kb.confidenceScore, kbTierAfter: newTier });
    }

    if (!dryRun) {
      const ok = await writeWithRetry(base44, kb.id, { kbTier: newTier }, "backfillKbTier");
      if (ok) updated++; else failed++;
      await new Promise(r => setTimeout(r, 350));
    } else {
      updated++;
    }
  }

  return Response.json({
    success: true,
    dryRun,
    offset,
    chunkSize,
    recordsInChunk: total,
    updated,
    skipped,
    failed,
    tierCounts,
    samples,
    nextOffset: total === chunkSize ? offset + chunkSize : null,
    done: total < chunkSize,
  });
});