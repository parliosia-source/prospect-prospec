import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// ── Helpers ────────────────────────────────────────────────────────────────────
function normText(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
}

function parseList(v) {
  if (Array.isArray(v)) return v;
  if (!v || String(v).trim() === "" || String(v).toLowerCase() === "nan") return [];
  const s = String(v).trim();
  if (s.startsWith("[")) {
    try { return JSON.parse(s).map(x => String(x).trim()).filter(Boolean); } catch (_) {}
  }
  return s.split(",").map(x => x.trim()).filter(Boolean);
}

function parseNumber(v, fallback) {
  const n = parseFloat(v);
  return isNaN(n) ? fallback : n;
}

// ── RFC-4180 CSV parser ────────────────────────────────────────────────────────
function parseCsv(text) {
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const records = [];
  let i = 0;
  const n = text.length;

  function parseField() {
    if (i >= n || text[i] === "\n") return "";
    if (text[i] === '"') {
      i++;
      let val = "";
      while (i < n) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') { val += '"'; i += 2; }
          else { i++; break; }
        } else { val += text[i++]; }
      }
      return val;
    } else {
      let val = "";
      while (i < n && text[i] !== ',' && text[i] !== '\n') val += text[i++];
      return val;
    }
  }

  function parseRecord() {
    const fields = [];
    while (i < n && text[i] !== '\n') {
      fields.push(parseField());
      if (i < n && text[i] === ',') i++;
    }
    if (i < n && text[i] === '\n') i++;
    return fields;
  }

  const headers = parseRecord().map(h => h.trim());
  while (i < n) {
    if (text[i] === '\n') { i++; continue; }
    const fields = parseRecord();
    if (fields.length === 0 || fields.every(f => !f.trim())) continue;
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (fields[idx] || "").trim(); });
    records.push(obj);
  }
  return records;
}

// ── Build record ───────────────────────────────────────────────────────────────
function buildRecord(row) {
  const domain = (row.domain || "").toLowerCase().replace(/^www\./, "").trim();
  if (!domain || !row.name) return null;

  const VALID_GEO = ["MTL_CMM", "QC_OTHER", "CANADA_OTHER", "UNKNOWN"];
  const VALID_REGION = ["MTL", "QC_OTHER", "OUTSIDE_QC", "UNKNOWN"];
  const VALID_ORIGINS = ["MIGRATION", "MANUAL", "SEED", "WEB", "IMPORT", "KB"];

  const geoScope = VALID_GEO.includes(row.geoScope) ? row.geoScope : "UNKNOWN";
  const hqRegion = VALID_REGION.includes(row.hqRegion) ? row.hqRegion : "UNKNOWN";
  const sourceOriginRaw = row.sourceOrigin || "IMPORT";
  const sourceOrigin = VALID_ORIGINS.includes(sourceOriginRaw) ? sourceOriginRaw : "IMPORT";

  return {
    name: row.name.trim(),
    normalizedName: normText(row.normalizedName || row.name),
    domain,
    website: (row.website || `https://${domain}`).trim(),
    hqCity: row.hqCity || "",
    hqProvince: row.hqProvince || "",
    hqCountry: row.hqCountry || "CA",
    hqRegion,
    geoScope,
    industryLabel: row.industryLabel || "",
    primaryTheme: row.primaryTheme || row.industryLabel || "",
    industrySectors: parseList(row.industrySectors).slice(0, 3),
    themes: parseList(row.themes),
    themeConfidence: parseNumber(row.themeConfidence, 0.7),
    entityType: row.entityType || "COMPANY",
    tags: parseList(row.tags),
    notes: row.notes || "",
    keywords: parseList(row.keywords),
    synonyms: parseList(row.synonyms),
    sectorSynonymsUsed: parseList(row.sectorSynonymsUsed),
    confidenceScore: parseNumber(row.confidenceScore, 70),
    qualityFlags: parseList(row.qualityFlags),
    sourceOrigin,
    sourceUrl: (row.sourceUrl && row.sourceUrl !== "NaN" && row.sourceUrl !== "nan") ? row.sourceUrl : "",
    seedBatchId: row.seedBatchId || "KB_V3_IMPORT",
    lastVerifiedAt: row.lastVerifiedAt || null,
  };
}

// ── Main handler ───────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== "admin") {
    return Response.json({ error: "Forbidden: Admin only" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { fileUrl, dryRun = false, batchSize = 8, offset = 0, limit = 300 } = body;

  if (!fileUrl) return Response.json({ error: "fileUrl required" }, { status: 400 });

  const START = Date.now();
  console.log(`[IMPORT_V3] START dryRun=${dryRun} offset=${offset} limit=${limit}`);

  // Fetch CSV
  const fileRes = await fetch(fileUrl);
  if (!fileRes.ok) return Response.json({ error: `Cannot fetch file: ${fileRes.status}` }, { status: 400 });
  const rawText = await fileRes.text();

  const allRows = parseCsv(rawText);
  const rows = allRows.slice(offset, offset + limit);
  console.log(`[IMPORT_V3] total=${allRows.length} processing=${rows.length} offset=${offset}`);

  // Load existing KBEntityV3 by domain for upsert
  const byDomain = {};
  const byNameCity = {};
  let page = 0;
  while (true) {
    const batch = await base44.asServiceRole.entities.KBEntityV3.list('-updated_date', 500, page * 500).catch(() => []);
    if (!batch || batch.length === 0) break;
    for (const e of batch) {
      if (e.domain) byDomain[e.domain.toLowerCase().replace(/^www\./, "")] = e;
      if (e.normalizedName && e.hqCity) {
        const k = `${normText(e.normalizedName)}|${normText(e.hqCity)}|${normText(e.entityType || "")}`;
        if (!byNameCity[k]) byNameCity[k] = e;
      }
    }
    if (batch.length < 500) break;
    page++;
    if (page >= 20) break;
  }
  console.log(`[IMPORT_V3] existing: ${Object.keys(byDomain).length} domains indexed`);

  let created = 0, updated = 0, skipped = 0, errors = 0;
  const errorList = [];
  const samples = [];

  // Stats
  const sectorDist = {};
  let mtlCmmCount = 0;
  let withSectors = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);

    for (const row of batch) {
      const record = buildRecord(row);
      if (!record) { skipped++; continue; }

      // Stats
      if (record.geoScope === "MTL_CMM") mtlCmmCount++;
      if (record.industrySectors.length > 0) {
        withSectors++;
        for (const s of record.industrySectors) {
          sectorDist[s] = (sectorDist[s] || 0) + 1;
        }
      }

      // Upsert: domain → normalizedName+hqCity+entityType
      let existing = byDomain[record.domain] || null;
      if (!existing) {
        const nk = `${normText(record.normalizedName)}|${normText(record.hqCity)}|${normText(record.entityType)}`;
        existing = byNameCity[nk] || null;
      }

      try {
        if (!dryRun) {
          if (existing) {
            const { id, created_date, updated_date, created_by, created_by_id, entity_name, app_id, is_sample, is_deleted, deleted_date, environment, ...clean } = record;
            await base44.asServiceRole.entities.KBEntityV3.update(existing.id, clean);
            updated++;
          } else {
            const ent = await base44.asServiceRole.entities.KBEntityV3.create(record);
            byDomain[record.domain] = { id: ent.id, ...record };
            created++;
          }
        } else {
          if (existing) updated++; else created++;
        }

        if (samples.length < 10) {
          samples.push({
            name: record.name, domain: record.domain,
            geoScope: record.geoScope, hqRegion: record.hqRegion,
            industrySectors: record.industrySectors, primaryTheme: record.primaryTheme,
            themeConfidence: record.themeConfidence, confidenceScore: record.confidenceScore,
            action: existing ? "UPDATE" : "CREATE",
          });
        }
      } catch (err) {
        errors++;
        errorList.push({ domain: record.domain, name: record.name, error: err.message });
        console.log(`[IMPORT_V3] ERR ${record.domain}: ${err.message}`);
        if (err.message?.includes("429") || err.message?.includes("Rate limit")) {
          await new Promise(r => setTimeout(r, 8000));
        }
      }
    }

    // Throttle between batches
    if (!dryRun && i + batchSize < rows.length) {
      await new Promise(r => setTimeout(r, 800));
    }

    if (i % (batchSize * 10) === 0) {
      console.log(`[IMPORT_V3] progress ${i + batch.length}/${rows.length} created=${created} updated=${updated} errors=${errors}`);
    }
  }

  const elapsed = Date.now() - START;
  const nextOffset = offset + rows.length;
  const isComplete = nextOffset >= allRows.length;

  console.log(`[IMPORT_V3] END created=${created} updated=${updated} skipped=${skipped} errors=${errors} elapsed=${elapsed}ms isComplete=${isComplete}`);

  return Response.json({
    dryRun, totalRows: allRows.length, processed: rows.length,
    created, updated, skipped, errors,
    withSectors, mtlCmmCount,
    sectorDistribution: sectorDist,
    samples,
    errorList: errorList.slice(0, 20),
    nextOffset,
    isComplete,
    elapsedMs: elapsed,
  });
});