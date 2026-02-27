import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    let allEntities = [];
    let page = 0;
    const pageSize = 500;
    
    while (true) {
      const batch = await base44.asServiceRole.entities.KBEntityV3.list(
        '-updated_date', pageSize, page * pageSize
      ).catch(() => []);
      if (!batch || batch.length === 0) break;
      allEntities = allEntities.concat(batch);
      if (batch.length < pageSize) break;
      page++;
    }

    const total = allEntities.length;

    const countByEntityType = {};
    allEntities.forEach(e => {
      const type = e.entityType || 'UNKNOWN';
      countByEntityType[type] = (countByEntityType[type] || 0) + 1;
    });

    const withSectors = allEntities.filter(e => Array.isArray(e.industrySectors) && e.industrySectors.length > 0).length;
    const withoutSectors = total - withSectors;

    const countByIndustrySector = {};
    allEntities.forEach(e => {
      if (Array.isArray(e.industrySectors)) {
        e.industrySectors.forEach(sector => {
          countByIndustrySector[sector] = (countByIndustrySector[sector] || 0) + 1;
        });
      }
    });

    const countByLocationCity = {};
    allEntities.forEach(e => {
      if (e.hqLocation) {
        const city = e.hqLocation.split(',')[0]?.trim();
        if (city) countByLocationCity[city] = (countByLocationCity[city] || 0) + 1;
      }
    });

    const sortedLocations = Object.entries(countByLocationCity)
      .sort((a, b) => b[1] - a[1]).slice(0, 20)
      .reduce((acc, [city, count]) => { acc[city] = count; return acc; }, {});

    // ── NEW: Cross-tab Sector × Region ─────────────────────────────────────
    const countBySectorAndRegion = {};
    const regionsSet = new Set();
    const sectorsSet = new Set();

    allEntities.forEach(e => {
      const region = e.geoScope || e.hqRegion || "UNKNOWN";
      const sectors = Array.isArray(e.industrySectors) && e.industrySectors.length > 0
        ? e.industrySectors
        : ["Non classé"];

      regionsSet.add(region);
      for (const sector of sectors) {
        sectorsSet.add(sector);
        if (!countBySectorAndRegion[sector]) countBySectorAndRegion[sector] = {};
        countBySectorAndRegion[sector][region] = (countBySectorAndRegion[sector][region] || 0) + 1;
      }
    });

    const regionsPresent = [...regionsSet].sort();
    const sectorsPresent = [...sectorsSet].sort();

    const result = {
      totalKBEntities: total,
      countByEntityType,
      countWithIndustrySectors: withSectors,
      countMissingIndustrySectors: withoutSectors,
      countByIndustrySector: Object.fromEntries(
        Object.entries(countByIndustrySector).sort((a, b) => b[1] - a[1])
      ),
      countByLocationCity: sortedLocations,
      countBySectorAndRegion,
      regionsPresent,
      sectorsPresent,
      fetchedPages: page + 1,
      pageSize,
    };

    return Response.json(result);
  } catch (error) {
    console.error('getKbStats error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});