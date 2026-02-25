import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== "admin") {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }

  const { fileUrl } = await req.json();
  if (!fileUrl) return Response.json({ error: "fileUrl required" }, { status: 400 });

  // Fetch CSV
  const res = await fetch(fileUrl);
  if (!res.ok) return Response.json({ error: `Fetch failed: ${res.statusText}` }, { status: 500 });
  const csv = await res.text();

  // Parse CSV (RFC-4180)
  const rows = [];
  let row = [], cell = "", inQ = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i], n = csv[i + 1];
    if (c === '"') { if (inQ && n === '"') { cell += '"'; i++; } else inQ = !inQ; }
    else if (c === ',' && !inQ) { row.push(cell); cell = ""; }
    else if ((c === '\n' || c === '\r') && !inQ) {
      if (cell || row.length) row.push(cell);
      if (row.length) rows.push(row);
      row = []; cell = "";
      if (c === '\r' && n === '\n') i++;
    } else cell += c;
  }
  if (cell || row.length) row.push(cell);
  if (row.length) rows.push(row);

  if (rows.length < 2) return Response.json({ error: "CSV needs header + data" }, { status: 400 });

  const headers = rows[0].map(h => h.trim());
  const data = rows.slice(1);

  // Find column indices
  const idx = {};
  for (const col of ["name", "website", "domain", "geoScope", "city", "sector"]) {
    idx[col] = headers.indexOf(col);
  }

  // Load existing domains for dedup
  const existing = await base44.asServiceRole.entities.KBEntityV3.list("-created_date", 5000).catch(() => []);
  const existingDomains = new Set(existing.map(e => (e.domain || "").toLowerCase()));

  let inserted = 0, skipped = 0;
  const errors = [];

  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    const name = (r[idx.name] || "").trim();
    const domain = (r[idx.domain] || "").trim().toLowerCase();
    const website = (r[idx.website] || "").trim();
    const geoScope = (r[idx.geoScope] || "").trim();
    const city = (r[idx.city] || "").trim();
    const sector = (r[idx.sector] || "").trim();

    if (!name || !domain) { errors.push(`Row ${i + 2}: missing name or domain`); continue; }

    if (existingDomains.has(domain)) { skipped++; continue; }

    const record = {
      name,
      domain,
      website: website || `https://${domain}`,
      geoScope: geoScope === "MTL" ? "MTL_CMM" : geoScope || "UNKNOWN",
      hqCity: city || "",
      hqProvince: "QC",
      hqCountry: "CA",
      hqRegion: geoScope === "MTL" ? "MTL" : "QC_OTHER",
      industryLabel: sector,
      industrySectors: sector ? [sector] : [],
      primaryTheme: sector,
      themes: sector ? [sector] : [],
      sourceOrigin: "IMPORT",
      confidenceScore: 70,
      normalizedName: name.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim(),
      seedBatchId: "GEMINI_ENRICHMENT_BATCH",
    };

    // Retry with backoff
    let ok = false;
    for (let att = 0; att < 5 && !ok; att++) {
      try {
        await base44.asServiceRole.entities.KBEntityV3.create(record);
        ok = true;
        inserted++;
        existingDomains.add(domain);
      } catch (err) {
        const isRL = err.status === 429 || (err.message || "").includes("Rate limit");
        if (!isRL || att === 4) {
          errors.push(`Row ${i + 2} (${domain}): ${String(err.message).slice(0, 80)}`);
          break;
        }
        await new Promise(r => setTimeout(r, Math.pow(2, att) * 1000 + Math.random() * 500));
      }
    }
  }

  return Response.json({ inserted, skippedDuplicates: skipped, totalRows: data.length, errors: errors.slice(0, 20) });
});