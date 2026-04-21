import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const EVENT_FIT_VOCABULARY = [
  "congres", "gala", "assemblee", "conference", "colloque", "symposium",
  "seminaire", "formation", "townhall", "webdiffusion", "webinar", "webinaire",
  "hybride", "hybrid", "sommet", "summit", "convention", "forum",
  "reunion annuelle", "aga", "agm", "remise de prix", "ceremonie", "banquet",
  "soiree", "inauguration", "lancement", "annual meeting", "kickoff",
  "membres", "adherents", "benevoles", "delegues", "actionnaires",
  "commanditaires", "sponsors", "evenement corporatif", "corporate event",
  "journee", "award", "prix d excellence", "gala annuel", "congres annuel",
  "assemblee generale", "conference annuelle",
];

function normText(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
}

function extractEventFitSignals(kb) {
  const blob = normText([
    kb.notes || "",
    ...(Array.isArray(kb.keywords) ? kb.keywords : []),
    ...(Array.isArray(kb.tags) ? kb.tags : []),
    ...(Array.isArray(kb.eventSignals) ? kb.eventSignals : []),
  ].filter(Boolean).join(" "));

  return EVENT_FIT_VOCABULARY.filter(term => blob.includes(normText(term)));
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
  const offset = body.offset || 0;
  const chunkSize = body.chunkSize || 400;

  let updated = 0, skipped = 0, failed = 0, noSignals = 0;
  const samples = [];

  const batch = await base44.asServiceRole.entities.KBEntityV3
    .filter({}, "-created_date", chunkSize, offset)
    .catch(() => []);

  for (const kb of batch) {
    if (Array.isArray(kb.eventFitSignals) && kb.eventFitSignals.length > 0) {
      skipped++;
      continue;
    }

    const signals = extractEventFitSignals(kb);
    if (signals.length === 0) noSignals++;
    else if (samples.length < 5) samples.push({ name: kb.name, eventFitSignals: signals });

    if (!dryRun) {
      const ok = await writeWithRetry(base44, kb.id, { eventFitSignals: signals }, "backfillKbEventFitSignals");
      if (ok) updated++; else failed++;
      await new Promise(r => setTimeout(r, 350));
    } else {
      updated++;
    }
  }

  return Response.json({
    success: true, dryRun, offset, chunkSize,
    recordsInChunk: batch.length, updated, skipped, failed, noSignals, samples,
    nextOffset: batch.length === chunkSize ? offset + chunkSize : null,
    done: batch.length < chunkSize,
  });
});