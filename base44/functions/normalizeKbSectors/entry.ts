import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Normalize a potentially malformed array field:
// - If already a clean array → return as-is
// - If string like "['Immobilier']" or '["Immobilier"]' → parse to array
// - If comma-separated string → split
// - If NaN or empty → return []
function normalizeArrayField(v) {
  if (Array.isArray(v)) {
    // Check if elements are clean strings or contain stringified arrays like "['Immobilier']"
    const cleaned = [];
    for (const item of v) {
      const s = String(item).trim();
      if (!s) continue;
      // Detect stringified arrays inside array elements: "['Immobilier']" or '["Immobilier"]'
      if (s.startsWith("[") && s.endsWith("]")) {
        try {
          const parsed = JSON.parse(s.replace(/'/g, '"'));
          if (Array.isArray(parsed)) { cleaned.push(...parsed.map(x => String(x).trim()).filter(Boolean)); continue; }
        } catch (_) {}
        // Fallback: strip brackets and quotes
        const inner = s.slice(1, -1);
        const parts = inner.split(",").map(x => x.replace(/['"]/g, "").trim()).filter(Boolean);
        cleaned.push(...parts);
        continue;
      }
      cleaned.push(s);
    }
    return cleaned;
  }
  if (!v || String(v).trim() === "" || String(v).toLowerCase() === "nan") return [];
  const s = String(v).trim();

  // Handle Python-style string arrays: "['Immobilier', 'Finance']"
  if (s.startsWith("[")) {
    try {
      // Try standard JSON parse first
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map(x => String(x).trim()).filter(Boolean);
    } catch (_) {}
    // Fallback: Python-style with single quotes
    try {
      const fixed = s.replace(/'/g, '"');
      const parsed = JSON.parse(fixed);
      if (Array.isArray(parsed)) return parsed.map(x => String(x).trim()).filter(Boolean);
    } catch (_) {}
    // Last resort: strip brackets and split
    const inner = s.slice(1, -1);
    return inner.split(",").map(x => x.replace(/['"]/g, "").trim()).filter(Boolean);
  }

  // Comma-separated string
  return s.split(",").map(x => x.trim()).filter(Boolean);
}

function arraysEqual(a, b) {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (user?.role !== 'admin') {
    return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const dryRun = body.dryRun === true;
  const limit = body.limit || 0; // 0 = all

  let scanned = 0;
  let needsFix = 0;
  let updated = 0;
  let errors = 0;
  const samples = [];

  let page = 0;
  const PAGE_SIZE = 500;
  let hasMore = true;

  while (hasMore) {
    const batch = await base44.asServiceRole.entities.KBEntityV3.list('-created_date', PAGE_SIZE, page * PAGE_SIZE).catch(() => []);
    if (!batch || batch.length === 0) break;
    if (batch.length < PAGE_SIZE) hasMore = false;
    page++;

    for (const entity of batch) {
      scanned++;

      const fieldsToUpdate = {};
      let dirty = false;

      // Check industrySectors
      const rawIS = entity.industrySectors;
      const normalizedIS = normalizeArrayField(rawIS);
      if (!Array.isArray(rawIS) || !arraysEqual(rawIS, normalizedIS)) {
        fieldsToUpdate.industrySectors = normalizedIS;
        dirty = true;
      }

      // Check themes
      const rawTh = entity.themes;
      const normalizedTh = normalizeArrayField(rawTh);
      if (!Array.isArray(rawTh) || !arraysEqual(rawTh, normalizedTh)) {
        fieldsToUpdate.themes = normalizedTh;
        dirty = true;
      }

      // Check keywords
      const rawKw = entity.keywords;
      const normalizedKw = normalizeArrayField(rawKw);
      if (!Array.isArray(rawKw) || !arraysEqual(rawKw, normalizedKw)) {
        fieldsToUpdate.keywords = normalizedKw;
        dirty = true;
      }

      // Check tags
      const rawTags = entity.tags;
      const normalizedTags = normalizeArrayField(rawTags);
      if (!Array.isArray(rawTags) || !arraysEqual(rawTags, normalizedTags)) {
        fieldsToUpdate.tags = normalizedTags;
        dirty = true;
      }

      if (!dirty) continue;
      needsFix++;

      if (samples.length < 10) {
        samples.push({
          id: entity.id,
          name: entity.name,
          domain: entity.domain,
          before: {
            industrySectors: rawIS,
            themes: rawTh,
          },
          after: {
            industrySectors: fieldsToUpdate.industrySectors || normalizedIS,
            themes: fieldsToUpdate.themes || normalizedTh,
          },
        });
      }

      if (!dryRun) {
        try {
          await base44.asServiceRole.entities.KBEntityV3.update(entity.id, fieldsToUpdate);
          updated++;
          // Rate limit protection
          if (updated % 50 === 0) {
            await new Promise(r => setTimeout(r, 500));
          }
        } catch (err) {
          errors++;
          console.error(`[normalizeKbSectors] Failed to update ${entity.id}: ${err.message}`);
        }
      }

      if (limit > 0 && needsFix >= limit) { hasMore = false; break; }
    }

    if (page >= 30) break; // safety limit
  }

  return Response.json({
    success: true,
    dryRun,
    scanned,
    needsFix,
    updated: dryRun ? 0 : updated,
    errors,
    samples,
  });
});