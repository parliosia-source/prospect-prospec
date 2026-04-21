import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── kbTier inference rules ─────────────────────────────────────────────────
// Priority order:
// 1. isExcluded = true → EXCLUDED
// 2. sourceOrigin = MANUAL + lastVerifiedAt recent → VERIFIED
// 3. sourceOrigin = MIGRATION/IMPORT + confidenceScore >= 80 + lastVerifiedAt set → VERIFIED
// 4. sourceOrigin = SEED + confidenceScore >= 70 → PROBABLE
// 5. sourceOrigin = WEB → UNVERIFIED (unless high confidence)
// 6. confidenceScore < 50 → UNVERIFIED
// 7. default → PROBABLE

function inferKbTier(kb) {
  if (kb.isExcluded) return "EXCLUDED";

  const score = typeof kb.confidenceScore === "number" ? kb.confidenceScore : (parseFloat(kb.confidenceScore) || 50);
  const hasVerifiedAt = !!kb.lastVerifiedAt;
  const source = (kb.sourceOrigin || "").toUpperCase();

  // MANUAL entries with verification date → VERIFIED
  if (source === "MANUAL" && hasVerifiedAt) return "VERIFIED";

  // MIGRATION or IMPORT with high score and verification date → VERIFIED
  if (["MIGRATION", "IMPORT"].includes(source) && score >= 80 && hasVerifiedAt) return "VERIFIED";

  // High confidence score with verification → VERIFIED
  if (score >= 85 && hasVerifiedAt) return "VERIFIED";

  // SEED or good IMPORT → PROBABLE
  if (source === "SEED" && score >= 70) return "PROBABLE";
  if (["MIGRATION", "IMPORT"].includes(source) && score >= 65) return "PROBABLE";
  if (source === "KB" && score >= 65) return "PROBABLE";

  // WEB-sourced or low confidence → UNVERIFIED
  if (source === "WEB") return score >= 75 ? "PROBABLE" : "UNVERIFIED";
  if (score < 50) return "UNVERIFIED";

  return "PROBABLE";
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return Response.json({ error: "Forbidden: Admin only" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const dryRun = body.dryRun === true;
  const limit = body.limit || 0; // 0 = all

  let page = 0;
  let total = 0, updated = 0, skipped = 0, failed = 0;
  const tierCounts = { VERIFIED: 0, PROBABLE: 0, UNVERIFIED: 0, EXCLUDED: 0 };
  const samples = [];

  while (true) {
    const batch = await base44.asServiceRole.entities.KBEntityV3
      .filter({}, "-created_date", 500, page * 500)
      .catch(() => []);
    if (!batch || batch.length === 0) break;

    for (const kb of batch) {
      if (limit > 0 && total >= limit) break;
      total++;

      // Skip if already set and not PROBABLE (default)
      if (kb.kbTier && kb.kbTier !== "PROBABLE") {
        skipped++;
        tierCounts[kb.kbTier] = (tierCounts[kb.kbTier] || 0) + 1;
        continue;
      }

      const newTier = inferKbTier(kb);
      tierCounts[newTier] = (tierCounts[newTier] || 0) + 1;

      if (samples.length < 10) {
        samples.push({ id: kb.id, name: kb.name, domain: kb.domain, sourceOrigin: kb.sourceOrigin, confidenceScore: kb.confidenceScore, lastVerifiedAt: kb.lastVerifiedAt, kbTierBefore: kb.kbTier || null, kbTierAfter: newTier });
      }

      if (!dryRun) {
        try {
          await base44.asServiceRole.entities.KBEntityV3.update(kb.id, { kbTier: newTier });
          updated++;
        } catch (e) {
          console.error(`[backfillKbTier] Failed ${kb.id}: ${e.message}`);
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

  return Response.json({
    success: true,
    dryRun,
    total,
    updated,
    skipped,
    failed,
    tierCounts,
    samples,
  });
});