import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Sector consolidation map: aliases → canonical name
const SECTOR_CONSOLIDATION = {
  "Technologies & IA": "Technologie",
  "Technologies": "Technologie",
  "Tech": "Technologie",
  "IT": "Technologie",
  "Informatique": "Technologie",
  "Sciences de la Vie & Santé": "Santé & Pharma",
  "Sciences de la vie": "Santé & Pharma",
  "Santé": "Santé & Pharma",
  "Pharma": "Santé & Pharma",
  "Biotechnologie": "Santé & Pharma",
  "Droit & Comptabilite": "Droit & Comptabilité",
  "OBNL": "Associations & OBNL",
  "Associations": "Associations & OBNL",
  "Manufacture": "Industrie & Manufacture",
  "Industrie": "Industrie & Manufacture",
  "Commerce": "Commerce de détail",
  "Retail": "Commerce de détail",
  "Transport": "Transport & Logistique",
  "Logistique": "Transport & Logistique",
  "Finance": "Finance & Assurance",
  "Assurance": "Finance & Assurance",
  "Éducation": "Éducation & Formation",
  "Formation": "Éducation & Formation",
  "Gouvernement": "Gouvernement & Public",
  "Public": "Gouvernement & Public",
};

function canonicalize(sector) {
  if (!sector) return null;
  const trimmed = sector.trim();
  return SECTOR_CONSOLIDATION[trimmed] || trimmed;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // Load all KB entities (just industrySectors field needed)
  const counts = {};
  let page = 0;
  let total = 0;

  while (true) {
    const batch = await base44.asServiceRole.entities.KBEntityV3.list('-created_date', 500, page * 500).catch(() => []);
    if (!batch || batch.length === 0) break;
    
    for (const e of batch) {
      total++;
      const sectors = e.industrySectors || [];
      if (!Array.isArray(sectors) || sectors.length === 0) continue;
      
      const seen = new Set(); // avoid double-counting within same entity
      for (const raw of sectors) {
        const canonical = canonicalize(raw);
        if (!canonical || seen.has(canonical)) continue;
        seen.add(canonical);
        counts[canonical] = (counts[canonical] || 0) + 1;
      }
    }
    
    if (batch.length < 500) break;
    page++;
    if (page >= 20) break;
  }

  // Sort by count descending
  const sorted = Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return Response.json({
    success: true,
    totalEntities: total,
    sectors: sorted,
  });
});