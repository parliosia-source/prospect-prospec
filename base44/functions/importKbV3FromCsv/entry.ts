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
    try {
      const fixed = s.replace(/'/g, '"');
      return JSON.parse(fixed).map(x => String(x).trim()).filter(Boolean);
    } catch(_) {}
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

    // Skip non-schema fields
    if (key === "is_sample") continue;

    if (["industrySectors", "themes", "keywords", "tags", "synonyms", "sectorSynonymsUsed", "eventSignals", "qualityFlags", "industrySectorsDerivedReasons"].includes(key)) {
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

    // ── Load existing entities for robust deduplication ───────────────────────
    const existing = await base44.asServiceRole.entities.KBEntityV3.list("-updated_date", 5000).catch(() => []);
    const existingDomainMap = new Map(); // domain -> entity
    const existingNameMap = new Map();   // normalizedName -> entity
    for (const e of existing) {
      if (e.domain) existingDomainMap.set(e.domain.toLowerCase(), e);
      if (e.normalizedName) existingNameMap.set(e.normalizedName.toLowerCase(), e);
    }

    let created = 0;
    let updated = 0;
    let skippedDuplicates = 0;
    const duplicates = [];
    const errors = [];
    const samples = [];

    for (const row of dataRows) {
      const record = buildKbRecord(headers, row);
      if (!record.name || !record.domain) {
        errors.push(`Row skipped: missing name or domain`);
        continue;
      }

      const domNorm = record.domain.toLowerCase();
      const nameNorm = (record.normalizedName || normText(record.name)).toLowerCase();
      if (!record.normalizedName) record.normalizedName = nameNorm;

      // ── Dedup check 1: exact domain match (case-insensitive) ─────────────
      const domainMatch = existingDomainMap.get(domNorm);
      if (domainMatch) {
        console.warn(`[DEDUP] Doublon domain: "${record.name}" — domain "${domNorm}" déjà pris par "${domainMatch.name}" (id: ${domainMatch.id})`);
        duplicates.push({ name: record.name, domain: domNorm, reason: "domain", existingName: domainMatch.name, existingId: domainMatch.id });
        skippedDuplicates++;
        continue;
      }

      // ── Dedup check 2: exact normalizedName match ────────────────────────
      const nameMatch = existingNameMap.get(nameNorm);
      if (nameMatch) {
        console.warn(`[DEDUP] Doublon name: "${record.name}" — normalizedName "${nameNorm}" déjà pris par "${nameMatch.name}" (id: ${nameMatch.id})`);
        duplicates.push({ name: record.name, domain: domNorm, reason: "normalizedName", existingName: nameMatch.name, existingId: nameMatch.id });
        skippedDuplicates++;
        continue;
      }

      // ── Insert with retry ────────────────────────────────────────────────
      let success = false;
      for (let attempt = 0; attempt < 5 && !success; attempt++) {
        try {
          await base44.asServiceRole.entities.KBEntityV3.create(record);
          created++;
          // Add to maps to catch duplicates within the same CSV
          existingDomainMap.set(domNorm, { name: record.name, id: "new" });
          existingNameMap.set(nameNorm, { name: record.name, id: "new" });
          success = true;
        } catch (retryErr) {
          const isRateLimit = retryErr.status === 429 || (retryErr.message || "").toLowerCase().includes("rate limit");
          if (!isRateLimit || attempt === 4) {
            errors.push(`${record.name}: ${String(retryErr.message).slice(0, 100)}`);
            break;
          }
          const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
          await new Promise(r => setTimeout(r, delay));
        }
      }

      if (samples.length < 5 && success) {
        samples.push({ name: record.name, domain: record.domain, industryLabel: record.industryLabel, status: "created" });
      }
    }

    return Response.json({
      success: true,
      total: dataRows.length,
      created,
      updated,
      skippedDuplicates,
      errors: errors.length,
      duplicates: duplicates.slice(0, 50),
      samples,
      errorDetails: errors.slice(0, 10),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});