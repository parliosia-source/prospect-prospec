import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── Canonical sector mapping table ────────────────────────────────────────────
// Maps any raw sector variant → canonical sector name
const SECTOR_CANONICAL_MAP = {
  // Finance
  "finance": "Finance & Assurance",
  "finance & assurance": "Finance & Assurance",
  "assurance": "Finance & Assurance",
  "banque": "Finance & Assurance",
  "fintech": "Finance & Assurance",
  "investissement": "Finance & Assurance",
  "services financiers": "Finance & Assurance",
  "financial services": "Finance & Assurance",
  "insurance": "Finance & Assurance",
  "banking": "Finance & Assurance",

  // Immobilier
  "immobilier": "Immobilier",
  "real estate": "Immobilier",
  "construction": "Immobilier",
  "promoteur immobilier": "Immobilier",
  "gestion immobilière": "Immobilier",

  // Droit & Comptabilité
  "droit": "Droit & Comptabilité",
  "droit & comptabilité": "Droit & Comptabilité",
  "comptabilité": "Droit & Comptabilité",
  "juridique": "Droit & Comptabilité",
  "law": "Droit & Comptabilité",
  "legal": "Droit & Comptabilité",
  "accounting": "Droit & Comptabilité",
  "notaire": "Droit & Comptabilité",

  // Transport & Logistique
  "transport": "Transport & Logistique",
  "transport & logistique": "Transport & Logistique",
  "logistique": "Transport & Logistique",
  "logistics": "Transport & Logistique",
  "supply chain": "Transport & Logistique",
  "distribution": "Transport & Logistique",

  // Technologie
  "technologie": "Technologie",
  "technology": "Technologie",
  "tech": "Technologie",
  "informatique": "Technologie",
  "saas": "Technologie",
  "logiciel": "Technologie",
  "software": "Technologie",
  "numérique": "Technologie",
  "digital": "Technologie",
  "it": "Technologie",
  "intelligence artificielle": "Technologie",
  "ai": "Technologie",
  "cybersécurité": "Technologie",

  // Santé & Pharma
  "santé": "Santé & Pharma",
  "santé & pharma": "Santé & Pharma",
  "health": "Santé & Pharma",
  "pharma": "Santé & Pharma",
  "pharmaceutique": "Santé & Pharma",
  "médical": "Santé & Pharma",
  "medical": "Santé & Pharma",
  "biotech": "Santé & Pharma",
  "biotechnologie": "Santé & Pharma",
  "clinique": "Santé & Pharma",
  "hospital": "Santé & Pharma",
  "hôpital": "Santé & Pharma",

  // Gouvernement & Public
  "gouvernement": "Gouvernement & Public",
  "gouvernement & public": "Gouvernement & Public",
  "government": "Gouvernement & Public",
  "public": "Gouvernement & Public",
  "municipal": "Gouvernement & Public",
  "municipalité": "Gouvernement & Public",
  "ministère": "Gouvernement & Public",
  "fédéral": "Gouvernement & Public",
  "provincial": "Gouvernement & Public",

  // Éducation & Formation
  "éducation": "Éducation & Formation",
  "éducation & formation": "Éducation & Formation",
  "education": "Éducation & Formation",
  "formation": "Éducation & Formation",
  "enseignement": "Éducation & Formation",
  "université": "Éducation & Formation",
  "university": "Éducation & Formation",
  "collège": "Éducation & Formation",
  "cégep": "Éducation & Formation",
  "school": "Éducation & Formation",
  "académique": "Éducation & Formation",

  // Associations & OBNL
  "association": "Associations & OBNL",
  "associations & obnl": "Associations & OBNL",
  "obnl": "Associations & OBNL",
  "npo": "Associations & OBNL",
  "organisme": "Associations & OBNL",
  "fondation": "Associations & OBNL",
  "syndicat": "Associations & OBNL",
  "chambre de commerce": "Associations & OBNL",
  "ordre professionnel": "Associations & OBNL",
  "fédération": "Associations & OBNL",

  // Industrie & Manufacture
  "industrie": "Industrie & Manufacture",
  "industrie & manufacture": "Industrie & Manufacture",
  "manufacture": "Industrie & Manufacture",
  "fabrication": "Industrie & Manufacture",
  "manufacturing": "Industrie & Manufacture",
  "agroalimentaire": "Industrie & Manufacture",
  "chimie": "Industrie & Manufacture",
  "engineering": "Industrie & Manufacture",
  "ingénierie": "Industrie & Manufacture",

  // Commerce de détail
  "commerce de détail": "Commerce de détail",
  "retail": "Commerce de détail",
  "commerce": "Commerce de détail",
  "detaillant": "Commerce de détail",
  "détaillant": "Commerce de détail",
  "e-commerce": "Commerce de détail",
};

function normKey(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
}

function mapToCanonical(rawSectors) {
  if (!Array.isArray(rawSectors) || rawSectors.length === 0) return [];
  const canonical = new Set();
  for (const raw of rawSectors) {
    const normRaw = normKey(raw);
    // Direct match only — no partial match to avoid false positives
    if (SECTOR_CANONICAL_MAP[normRaw]) {
      canonical.add(SECTOR_CANONICAL_MAP[normRaw]);
      continue;
    }
    // Check if a canonical key is an exact word boundary match within the raw label
    let matched = false;
    for (const [key, val] of Object.entries(SECTOR_CANONICAL_MAP)) {
      // Only match if the key is at least 6 chars (avoid short spurious matches like "it", "ai")
      if (key.length >= 6 && normRaw === key) {
        canonical.add(val);
        matched = true;
        break;
      }
    }
    // Keep raw as-is if no canonical match — do not guess
    if (!matched) canonical.add(raw);
  }
  return [...canonical];
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
  let total = 0, updated = 0, skipped = 0, failed = 0;
  const samples = [];

  while (true) {
    const batch = await base44.asServiceRole.entities.KBEntityV3
      .filter({}, "-created_date", 500, page * 500)
      .catch(() => []);
    if (!batch || batch.length === 0) break;

    for (const kb of batch) {
      if (limit > 0 && total >= limit) break;
      total++;

      // Skip if canonicalSectors already populated
      if (Array.isArray(kb.canonicalSectors) && kb.canonicalSectors.length > 0) {
        skipped++;
        continue;
      }

      // Build source sectors from all available fields
      const sourceSectors = [
        ...(Array.isArray(kb.industrySectors) ? kb.industrySectors : []),
        ...(Array.isArray(kb.themes) ? kb.themes : []),
        kb.industryLabel,
        kb.primaryTheme,
      ].filter(Boolean);

      const canonical = mapToCanonical(sourceSectors);

      if (samples.length < 10) {
        samples.push({ id: kb.id, name: kb.name, sourceSectors, canonicalSectors: canonical });
      }

      if (!dryRun) {
        try {
          await base44.asServiceRole.entities.KBEntityV3.update(kb.id, { canonicalSectors: canonical });
          updated++;
        } catch (e) {
          console.error(`[backfillKbCanonicalSectors] Failed ${kb.id}: ${e.message}`);
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