import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── Event fit signal vocabulary ────────────────────────────────────────────────
// These terms indicate that an organization likely organizes corporate events
const EVENT_FIT_VOCABULARY = [
  // Event types
  "congrès", "congres", "gala", "assemblée", "assemblee", "conférence", "conference",
  "colloque", "symposium", "séminaire", "seminaire", "formation", "townhall",
  "webdiffusion", "webinar", "webinaire", "hybride", "hybrid", "sommet", "summit",
  "convention", "forum", "réunion annuelle", "reunion annuelle", "aga", "agm",
  "remise de prix", "cérémonie", "ceremonie", "banquet", "soirée", "soiree",
  "inauguration", "lancement", "annual meeting", "kickoff",
  // Organizational signals
  "membres", "member", "adhérents", "adherents", "bénévoles", "benevoles",
  "délégués", "delegues", "actionnaires", "shareholders",
  // Event infrastructure signals
  "commanditaires", "sponsors", "partenaires événements", "partenaires evenements",
  "salle de conférence", "salle de conference", "centre des congrès", "centre des congres",
  // Industry-specific event signals
  "gala annuel", "congrès annuel", "assemblee generale", "assemblée générale",
  "conférence annuelle", "conference annuelle", "journée", "journee",
  "événement corporatif", "evenement corporatif", "corporate event",
  "evening event", "award", "prix d'excellence",
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

  const found = [];
  for (const term of EVENT_FIT_VOCABULARY) {
    const normTerm = normText(term);
    if (blob.includes(normTerm) && !found.includes(term)) {
      found.push(term);
    }
  }
  return found;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return Response.json({ error: "Forbidden: Admin only" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const dryRun = body.dryRun === true;
  const limit = body.limit || 0;

  let page = 0;
  let total = 0, updated = 0, skipped = 0, failed = 0, noSignals = 0;
  const samples = [];

  while (true) {
    const batch = await base44.asServiceRole.entities.KBEntityV3
      .filter({}, "-created_date", 500, page * 500)
      .catch(() => []);
    if (!batch || batch.length === 0) break;

    for (const kb of batch) {
      if (limit > 0 && total >= limit) break;
      total++;

      // Skip if already populated
      if (Array.isArray(kb.eventFitSignals) && kb.eventFitSignals.length > 0) {
        skipped++;
        continue;
      }

      const signals = extractEventFitSignals(kb);

      if (signals.length === 0) { noSignals++; }

      if (samples.length < 10 && signals.length > 0) {
        samples.push({ id: kb.id, name: kb.name, domain: kb.domain, eventFitSignals: signals });
      }

      if (!dryRun) {
        try {
          await base44.asServiceRole.entities.KBEntityV3.update(kb.id, { eventFitSignals: signals });
          updated++;
        } catch (e) {
          console.error(`[backfillKbEventFitSignals] Failed ${kb.id}: ${e.message}`);
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

  return Response.json({ success: true, dryRun, total, updated, skipped, failed, noSignals, samples });
});