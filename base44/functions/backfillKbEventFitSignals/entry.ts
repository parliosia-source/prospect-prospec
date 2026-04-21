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

  for (const kb of batch) {
    processedCount++;

    if (Array.isArray(kb.eventFitSignals) && kb.eventFitSignals.length > 0) {
      skippedCount++;
      continue;
    }

    const signals = extractEventFitSignals(kb);

    if (!dryRun) {
      const res = await writeWithRetry(base44, kb.id, { eventFitSignals: signals });
      if (res.ok) successCount++;
      else { errorCount++; errorIds.push({ id: kb.id, name: kb.name, error: res.error }); }
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