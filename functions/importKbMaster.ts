import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// ── Helpers ────────────────────────────────────────────────────────────────────
function normText(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
}

// Robust list parser: handles JSON arrays, comma-separated strings, NaN/empty
function parseList(v) {
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

// ── MTL cities set ─────────────────────────────────────────────────────────────
const MTL_CITIES = new Set([
  "montreal","laval","longueuil","brossard","terrebonne","repentigny","boucherville",
  "dorval","pointe-claire","kirkland","beaconsfield","saint-lambert","westmount",
  "mont-royal","cote-saint-luc","verdun","anjou","outremont","pierrefonds","lasalle",
  "saint-laurent","saint-jerome","blainville","boisbriand","mascouche","mirabel",
  "la-prairie","chateauguay","candiac","laprairie","saint-jean-sur-richelieu",
  "vaudreuil-dorion","les-coteaux","sainte-catherine","sainte-julie","varennes",
  "montreal-est","montreal-nord","montreal-ouest","lachine","rosemont","villeray",
  "hochelaga","riviere-des-prairies","saint-leonard","ahuntsic","mtl",
]);

// ── Resolve geoScope from existing fields ──────────────────────────────────────
function resolveGeoScope(row, hqRegion) {
  // If CSV has geoScope, trust it
  if (row.geoScope && row.geoScope !== "UNKNOWN" && row.geoScope !== "") return row.geoScope;
  // Infer from hqRegion
  if (hqRegion === "MTL") return "MTL_CMM";
  if (hqRegion === "QC_OTHER") return "QC_OTHER";
  if (hqRegion === "OUTSIDE_QC") return "CANADA_OTHER";
  // Infer from hqCity
  const cityNorm = normText(row.hqCity || "");
  if (MTL_CITIES.has(cityNorm) || [...MTL_CITIES].some(mc => cityNorm.includes(mc))) return "MTL_CMM";
  const provNorm = normText(row.hqProvince || "");
  if (provNorm === "qc" || provNorm === "quebec" || provNorm === "québec") return "QC_OTHER";
  const countryNorm = normText(row.hqCountry || "");
  if (countryNorm === "ca" || countryNorm === "canada") return "CANADA_OTHER";
  return "UNKNOWN";
}

// ── Resolve hqRegion from location fields ─────────────────────────────────────
function resolveHqRegion(row) {
  const known = ["MTL","QC_OTHER","OUTSIDE_QC","UNKNOWN"];
  if (row.hqRegion && known.includes(row.hqRegion)) return row.hqRegion;
  // Map from geoScope
  if (row.geoScope === "MTL_CMM") return "MTL";
  if (row.geoScope === "QC_OTHER") return "QC_OTHER";
  if (row.geoScope === "CANADA_OTHER") return "OUTSIDE_QC";
  // Infer from hqCity
  const cityNorm = normText(row.hqCity || "");
  const provNorm = normText(row.hqProvince || "");
  const isQC = provNorm === "qc" || provNorm === "quebec" || provNorm === "québec";
  if (isQC) {
    const isMTL = MTL_CITIES.has(cityNorm) || [...MTL_CITIES].some(mc => cityNorm.includes(mc));
    return isMTL ? "MTL" : "QC_OTHER";
  }
  const countryNorm = normText(row.hqCountry || "");
  if (countryNorm && countryNorm !== "ca" && countryNorm !== "canada") return "OUTSIDE_QC";
  return "UNKNOWN";
}

// ── Province normalization ─────────────────────────────────────────────────────
function normalizeProvince(hqProvince) {
  const norm = normText(hqProvince || "");
  if (norm === "qc" || norm === "quebec" || norm === "québec") return "QC";
  if (norm === "on" || norm === "ontario") return "ON";
  if (norm === "bc" || norm === "british columbia" || norm === "colombie-britannique") return "BC";
  if (norm === "ab" || norm === "alberta") return "AB";
  if (norm === "ns" || norm === "nova scotia") return "NS";
  if (norm === "nb" || norm === "new brunswick") return "NB";
  if (norm === "mb" || norm === "manitoba") return "MB";
  if (norm === "sk" || norm === "saskatchewan") return "SK";
  return hqProvince || "";
}

// ── Build record from a CSV/JSON row ──────────────────────────────────────────
function buildRecord(row) {
  const domain = (row.domain || "").toLowerCase().replace(/^www\./, "").trim();
  if (!domain || !row.name || !row.website) return null;

  const hqRegion = resolveHqRegion(row);
  const geoScope = resolveGeoScope(row, hqRegion);
  const hqProvince = normalizeProvince(row.hqProvince);

  // industrySectors is the canonical filter field
  const industrySectors = parseList(row.industrySectors);
  const themes = parseList(row.themes);
  const themeEvidence = parseList(row.themeEvidence);
  const eventSignals = parseList(row.eventSignals);
  const qualityFlags = parseList(row.qualityFlags);
  const tags = parseList(row.tags);
  const keywords = parseList(row.keywords);
  const synonyms = parseList(row.synonyms);
  const sectorSynonymsUsed = parseList(row.sectorSynonymsUsed);

  // If industrySectors empty but themes non-empty → use themes (so app always has industrySectors)
  const finalIndustrySectors = industrySectors.length > 0 ? industrySectors : themes;

  // primaryTheme = industryLabel if primaryTheme absent
  const primaryTheme = row.primaryTheme || row.industryLabel || finalIndustrySectors[0] || "";

  // industryLabel must equal primaryTheme for backward compat
  const industryLabel = primaryTheme || row.industryLabel || "";

  const themeConfidence = parseNumber(row.themeConfidence, 0.7);
  const confidenceScore = parseNumber(row.confidenceScore, 75);

  const sourceOriginRaw = row.sourceOrigin || row.source || "IMPORT";
  const VALID_ORIGINS = ["MIGRATION", "MANUAL", "SEED", "WEB", "IMPORT"];
  const sourceOrigin = VALID_ORIGINS.includes(sourceOriginRaw) ? sourceOriginRaw : "IMPORT";

  const VALID_GEO = ["MTL_CMM", "QC_OTHER", "CANADA_OTHER", "UNKNOWN"];
  const finalGeoScope = VALID_GEO.includes(geoScope) ? geoScope : "UNKNOWN";

  return {
    name: row.name.trim(),
    normalizedName: normText(row.normalizedName || row.name),
    domain,
    website: row.website.trim(),
    hqCity: row.hqCity || "",
    hqProvince,
    hqCountry: normText(row.hqCountry || "") === "canada" ? "CA" : (row.hqCountry || "CA"),
    hqRegion,
    geoScope: finalGeoScope,
    industryLabel,
    primaryTheme,
    industrySectors: finalIndustrySectors,
    themes,
    themeConfidence,
    themeEvidence,
    eventSignals,
    entityType: row.entityType || "COMPANY",
    tags,
    notes: row.notes || "",
    keywords,
    synonyms,
    sectorSynonymsUsed,
    confidenceScore,
    qualityFlags,
    sourceOrigin,
    sourceUrl: (row.sourceUrl && row.sourceUrl !== "NaN" && row.sourceUrl !== "nan") ? row.sourceUrl : "",
    seedBatchId: row.seedBatchId || "KB_V3_IMPORT",
    lastVerifiedAt: row.lastVerifiedAt || null,
    migratedFromKbEntityId: row.migratedFromKbEntityId || "",
  };
}

// ── Merge: master data wins, arrays are union'd ───────────────────────────────
function mergeRecords(existing, incoming) {
  const merged = { ...existing };
  const overwrite = (k) => { if (incoming[k] !== undefined && incoming[k] !== "") merged[k] = incoming[k]; };
  const unionArr = (a, b) => [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])])];

  ["name","normalizedName","website","hqCity","hqProvince","hqCountry","entityType",
   "industryLabel","primaryTheme","themeConfidence","geoScope","sourceUrl","seedBatchId","lastVerifiedAt"]
    .forEach(overwrite);

  // hqRegion / geoScope: never downgrade to UNKNOWN
  if (incoming.hqRegion && incoming.hqRegion !== "UNKNOWN") merged.hqRegion = incoming.hqRegion;
  if (incoming.geoScope && incoming.geoScope !== "UNKNOWN") merged.geoScope = incoming.geoScope;

  merged.industrySectors = unionArr(existing.industrySectors, incoming.industrySectors);
  merged.themes = unionArr(existing.themes, incoming.themes);
  merged.tags = unionArr(existing.tags, incoming.tags);
  merged.keywords = unionArr(existing.keywords, incoming.keywords);
  merged.themeEvidence = unionArr(existing.themeEvidence, incoming.themeEvidence);
  merged.eventSignals = unionArr(existing.eventSignals, incoming.eventSignals);
  merged.qualityFlags = [...new Set([...(existing.qualityFlags || []), ...(incoming.qualityFlags || [])])];

  merged.notes = (incoming.notes || "").length > (existing.notes || "").length ? incoming.notes : existing.notes;
  merged.confidenceScore = Math.max(existing.confidenceScore || 70, incoming.confidenceScore || 75);

  return merged;
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

// ── Main handler ───────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== "admin") {
    return Response.json({ error: "Forbidden: Admin only" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { fileUrl, dryRun = false, batchSize = 8, offset = 0 } = body;

  if (!fileUrl) return Response.json({ error: "fileUrl required" }, { status: 400 });

  const START = Date.now();
  console.log(`[IMPORT_MASTER] START dryRun=${dryRun} offset=${offset}`);

  // Fetch file — auto-detect JSON vs CSV
  const fileRes = await fetch(fileUrl);
  if (!fileRes.ok) return Response.json({ error: `Cannot fetch file: ${fileRes.status}` }, { status: 400 });
  const rawText = await fileRes.text();

  let allRows;
  const trimmed = rawText.trimStart();
  // Force mode can be set via body param; otherwise auto-detect
  if (body.format === "json" || (trimmed.startsWith("[") && body.format !== "csv")) {
    try {
      allRows = JSON.parse(trimmed);
      if (!Array.isArray(allRows)) return Response.json({ error: "JSON must be an array" }, { status: 400 });
    } catch (e) {
      // Fallback to CSV if JSON parse fails
      allRows = parseCsv(trimmed);
    }
  } else {
    // CSV (default)
    allRows = parseCsv(trimmed);
  }

  const rows = allRows.slice(offset, offset + 9999);
  console.log(`[IMPORT_MASTER] total=${allRows.length} processing=${rows.length} offset=${offset}`);

  // Load existing: index by id, domain, normalizedName+hqCity
  const byId = {};
  const byDomain = {};
  const byNameCity = {};
  let page = 0;
  while (true) {
    const batch = await base44.asServiceRole.entities.KBEntityV2.list('-updated_date', 500, page * 500).catch(() => []);
    if (!batch || batch.length === 0) break;
    for (const e of batch) {
      byId[e.id] = e;
      if (e.domain) byDomain[e.domain.toLowerCase().replace(/^www\./,"")] = e;
      if (e.normalizedName && e.hqCity) {
        const k = `${normText(e.normalizedName)}|${normText(e.hqCity)}`;
        if (!byNameCity[k]) byNameCity[k] = e;
      }
    }
    if (batch.length < 500) break;
    page++;
    if (page >= 20) break;
  }
  console.log(`[IMPORT_MASTER] existing: ${Object.keys(byDomain).length} domains`);

  let created = 0, updated = 0, skipped = 0, errors = 0;
  const errorList = [];
  const samples = [];

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);

    for (const row of batch) {
      const record = buildRecord(row);
      if (!record) { skipped++; continue; }

      try {
        // Upsert priority: id → domain → normalizedName+hqCity
        let existing = null;
        if (row.id && byId[row.id]) {
          existing = byId[row.id];
        } else if (byDomain[record.domain]) {
          existing = byDomain[record.domain];
        } else {
          const nk = `${normText(record.normalizedName)}|${normText(record.hqCity)}`;
          if (byNameCity[nk]) existing = byNameCity[nk];
        }

        if (!dryRun) {
          if (existing) {
            const merged = mergeRecords(existing, record);
            const { id, created_date, updated_date, created_by, created_by_id, entity_name, app_id, is_sample, is_deleted, deleted_date, environment, ...updateData } = merged;
            await base44.asServiceRole.entities.KBEntityV2.update(existing.id, updateData);
            byDomain[record.domain] = { ...existing, ...updateData };
            updated++;
          } else {
            const created_entity = await base44.asServiceRole.entities.KBEntityV2.create(record);
            byId[created_entity.id] = { id: created_entity.id, ...record };
            byDomain[record.domain] = { id: created_entity.id, ...record };
            created++;
          }
        } else {
          if (existing) updated++; else created++;
        }

        if (samples.length < 15) {
          samples.push({
            name: record.name, domain: record.domain,
            hqRegion: record.hqRegion, geoScope: record.geoScope,
            industrySectors: record.industrySectors, primaryTheme: record.primaryTheme,
            themeConfidence: record.themeConfidence,
            action: existing ? "UPDATE" : "CREATE"
          });
        }
      } catch (err) {
        errors++;
        errorList.push({ domain: record.domain, name: record.name, error: err.message });
        console.log(`[IMPORT_MASTER] ERR ${record.domain}: ${err.message}`);
        if (err.message?.includes("429") || err.message?.includes("Rate limit")) {
          await new Promise(r => setTimeout(r, 8000));
        }
      }
    }

    if (!dryRun && i + batchSize < rows.length) {
      await new Promise(r => setTimeout(r, 3500));
    }
    if (i % (batchSize * 10) === 0) {
      console.log(`[IMPORT_MASTER] progress ${i}/${rows.length} created=${created} updated=${updated} errors=${errors}`);
    }
  }

  const elapsed = Date.now() - START;
  console.log(`[IMPORT_MASTER] END created=${created} updated=${updated} skipped=${skipped} errors=${errors} elapsed=${elapsed}ms`);

  return Response.json({
    dryRun, totalRows: allRows.length, processed: rows.length,
    created, updated, skipped, errors, elapsedMs: elapsed,
    samples, errorList: errorList.slice(0, 20),
    isComplete: offset + rows.length >= allRows.length,
  });
});