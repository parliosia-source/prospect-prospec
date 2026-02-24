import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== "admin") {
    return Response.json({ error: "Forbidden: Admin only" }, { status: 403 });
  }

  let page = 0;
  let updated = 0;
  let scanned = 0;
  let alreadyOk = 0;
  let noLabel = 0;
  const samples = [];

  while (true) {
    const batch = await base44.asServiceRole.entities.KBEntityV3.list('-updated_date', 500, page * 500).catch(() => []);
    if (!batch || batch.length === 0) break;

    for (const e of batch) {
      scanned++;
      const pt = (e.primaryTheme || "").trim();
      const il = (e.industryLabel || "").trim();

      if (pt) {
        alreadyOk++;
        continue;
      }

      if (!il) {
        noLabel++;
        continue;
      }

      try {
        await base44.asServiceRole.entities.KBEntityV3.update(e.id, {
          primaryTheme: il
        });
        updated++;
        if (samples.length < 10) {
          samples.push({ name: e.name, domain: e.domain, primaryTheme_set: il });
        }
      } catch (err) {
        console.log(`[BACKFILL] ERR ${e.domain}: ${err.message}`);
        if (err.message?.includes("429")) {
          await new Promise(r => setTimeout(r, 5000));
        }
      }
    }

    if (batch.length < 500) break;
    page++;
    if (page >= 20) break;

    // Throttle
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`[BACKFILL] scanned=${scanned} updated=${updated} alreadyOk=${alreadyOk} noLabel=${noLabel}`);

  return Response.json({
    scanned,
    updated,
    alreadyOk,
    noLabel,
    samples
  });
});