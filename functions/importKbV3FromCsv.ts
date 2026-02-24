import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// ── Helpers ────────────────────────────────────────────────────────────────────
function normText(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
}

function parseArr(v) {
  if (Array.isArray(v)) return v;
  if (!v || String(v).trim() === "") return [];
  const s = String(v).trim();
  if (s.startsWith("[")) {
    try { return JSON.parse(s).map(x => String(x).trim()).filter(Boolean); }
    catch(_) {}
  }
  return s.split(",").map(x => x.trim()).filter(Boolean);
}

function parseNumber(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

// RFC-4180 CSV parser
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let insideQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];
    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        cell += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === "," && !insideQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !insideQuotes) {
      if (cell || row.length > 0) row.push(cell);
      if (row.length > 0) rows.push(row);
      row = [];
      cell = "";
      if (char === "\r" && nextChar === "\n") i++;
    } else {
      cell += char;
    }
  }
  if (cell || row.length > 0) row.push(cell);
  if (row.length > 0) rows.push(row);
  return rows;
}

// Build KB entity from CSV row
function buildKbRecord(headers, values) {
  const record = {};
  for (let i = 0; i < headers.length; i++) {
    const key = headers[i];
    const val = values[i] || "";
    if (!key) continue;

    if (["industrySectors", "themes", "keywords", "tags", "synonyms", "sectorSynonymsUsed", "eventSignals"].includes(key)) {
      record[key] = parseArr(val);
    } else if (["themeConfidence", "confidenceScore"].includes(key)) {
      record[key] = parseNumber(val);
    } else if (val) {
      record[key] = val;
    }
  }

  // Set defaults
  if (!record.hqCountry) record.hqCountry = "CA";
  if (!record.geoScope) record.geoScope = "UNKNOWN";
  if (!record.hqRegion) record.hqRegion = "UNKNOWN";
  if (!record.sourceOrigin) record.sourceOrigin = "IMPORT";

  return record;
}

// ── Main ────────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();

  if (!user || user.role !== "admin") {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await req.json();
  const { fileUrl } = body;

  if (!fileUrl) {
    return Response.json({ error: "fileUrl required" }, { status: 400 });
  }

  try {
    const res = await fetch(fileUrl);
    if (!res.ok) throw new Error(`Failed to fetch file: ${res.statusText}`);
    const csv = await res.text();

    const rows = parseCSV(csv);
    if (rows.length < 2) throw new Error("CSV must have headers + at least 1 data row");

    const headers = rows[0].map(h => h.trim());
    const dataRows = rows.slice(1);

    // Load existing domains for dedup
    const existing = await base44.asServiceRole.entities.KBEntityV3.list("-updated_date", 5000).catch(() => []);
    const existingDomains = new Set(existing.map(e => (e.domain || "").toLowerCase()));

    let created = 0, updated = 0, skipped = 0;
    const errors = [];
    const samples = [];

    // Batch insert
    const BATCH_SIZE = 50;
    for (let batchIdx = 0; batchIdx < dataRows.length; batchIdx += BATCH_SIZE) {
      const batch = dataRows.slice(batchIdx, batchIdx + BATCH_SIZE);
      const records = batch.map(row => buildKbRecord(headers, row)).filter(r => r.name && r.domain);

      for (const record of records) {
        try {
          const domNorm = (record.domain || "").toLowerCase();

          // Check for existing by domain
          const existing = await base44.asServiceRole.entities.KBEntityV3.filter({ domain: domNorm }).catch(() => []);
          
          if (existing.length > 0) {
            // Update
            await base44.asServiceRole.entities.KBEntityV3.update(existing[0].id, record);
            updated++;
          } else {
            // Create
            await base44.asServiceRole.entities.KBEntityV3.create(record);
            created++;
            existingDomains.add(domNorm);
          }

          if (samples.length < 5) {
            samples.push({ name: record.name, domain: record.domain, industryLabel: record.industryLabel, status: "ok" });
          }
        } catch (err) {
          skipped++;
          errors.push(String(err.message).slice(0, 100));
        }
      }
    }

    return Response.json({
      success: true,
      created,
      updated,
      skipped,
      total: dataRows.length,
      samples,
      errors: errors.slice(0, 10),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});