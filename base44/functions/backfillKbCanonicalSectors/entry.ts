import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SECTOR_CANONICAL_MAP = {
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
  "immobilier": "Immobilier",
  "real estate": "Immobilier",
  "construction": "Immobilier",
  "promoteur immobilier": "Immobilier",
  "gestion immobiliere": "Immobilier",
  "droit": "Droit & Comptabilité",
  "droit & comptabilite": "Droit & Comptabilité",
  "comptabilite": "Droit & Comptabilité",
  "juridique": "Droit & Comptabilité",
  "law": "Droit & Comptabilité",
  "legal": "Droit & Comptabilité",
  "accounting": "Droit & Comptabilité",
  "notaire": "Droit & Comptabilité",
  "transport": "Transport & Logistique",
  "transport & logistique": "Transport & Logistique",
  "logistique": "Transport & Logistique",
  "logistics": "Transport & Logistique",
  "supply chain": "Transport & Logistique",
  "distribution": "Transport & Logistique",
  "technologie": "Technologie",
  "technology": "Technologie",
  "informatique": "Technologie",
  "saas": "Technologie",
  "logiciel": "Technologie",
  "software": "Technologie",
  "numerique": "Technologie",
  "digital": "Technologie",
  "intelligence artificielle": "Technologie",
  "cybersecurite": "Technologie",
  "sante": "Santé & Pharma",
  "sante & pharma": "Santé & Pharma",
  "health": "Santé & Pharma",
  "pharma": "Santé & Pharma",
  "pharmaceutique": "Santé & Pharma",
  "medical": "Santé & Pharma",
  "biotech": "Santé & Pharma",
  "biotechnologie": "Santé & Pharma",
  "hopital": "Santé & Pharma",
  "gouvernement": "Gouvernement & Public",
  "gouvernement & public": "Gouvernement & Public",
  "government": "Gouvernement & Public",
  "municipal": "Gouvernement & Public",
  "municipalite": "Gouvernement & Public",
  "ministere": "Gouvernement & Public",
  "education": "Éducation & Formation",
  "education & formation": "Éducation & Formation",
  "formation": "Éducation & Formation",
  "enseignement": "Éducation & Formation",
  "universite": "Éducation & Formation",
  "university": "Éducation & Formation",
  "college": "Éducation & Formation",
  "cegep": "Éducation & Formation",
  "association": "Associations & OBNL",
  "associations & obnl": "Associations & OBNL",
  "obnl": "Associations & OBNL",
  "npo": "Associations & OBNL",
  "organisme": "Associations & OBNL",
  "fondation": "Associations & OBNL",
  "syndicat": "Associations & OBNL",
  "chambre de commerce": "Associations & OBNL",
  "ordre professionnel": "Associations & OBNL",
  "federation": "Associations & OBNL",
  "industrie": "Industrie & Manufacture",
  "industrie & manufacture": "Industrie & Manufacture",
  "manufacture": "Industrie & Manufacture",
  "fabrication": "Industrie & Manufacture",
  "manufacturing": "Industrie & Manufacture",
  "agroalimentaire": "Industrie & Manufacture",
  "chimie": "Industrie & Manufacture",
  "commerce de detail": "Commerce de détail",
  "retail": "Commerce de détail",
  "commerce": "Commerce de détail",
  "detaillant": "Commerce de détail",
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
    if (SECTOR_CANONICAL_MAP[normRaw]) {
      canonical.add(SECTOR_CANONICAL_MAP[normRaw]);
    }
    // No fallback — raw values that don't match stay in industrySectors/themes
  }
  return [...canonical];
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

  let updated = 0, skipped = 0, failed = 0;
  const samples = [];

  const batch = await base44.asServiceRole.entities.KBEntityV3
    .filter({}, "-created_date", chunkSize, offset)
    .catch(() => []);

  for (const kb of batch) {
    if (Array.isArray(kb.canonicalSectors) && kb.canonicalSectors.length > 0) {
      skipped++;
      continue;
    }

    const sourceSectors = [
      ...(Array.isArray(kb.industrySectors) ? kb.industrySectors : []),
      ...(Array.isArray(kb.themes) ? kb.themes : []),
      kb.industryLabel,
      kb.primaryTheme,
    ].filter(Boolean);

    const canonical = mapToCanonical(sourceSectors);

    if (samples.length < 5) {
      samples.push({ name: kb.name, sourceSectors: sourceSectors.slice(0, 3), canonicalSectors: canonical });
    }

    if (!dryRun) {
      const ok = await writeWithRetry(base44, kb.id, { canonicalSectors: canonical }, "backfillKbCanonicalSectors");
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