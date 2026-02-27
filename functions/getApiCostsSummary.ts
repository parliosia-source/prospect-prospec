import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (user?.role !== 'admin') {
    return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  // Default to current month
  const now = new Date();
  const year = body.year || now.getUTCFullYear();
  const month = body.month || (now.getUTCMonth() + 1);
  const startDate = `${year}-${String(month).padStart(2, '0')}-01T00:00:00.000Z`;
  const endMonth = month === 12 ? 1 : month + 1;
  const endYear = month === 12 ? year + 1 : year;
  const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01T00:00:00.000Z`;

  // Fetch all logs for the period
  let allLogs = [];
  let page = 0;
  while (true) {
    const batch = await base44.asServiceRole.entities.ApiUsageLog.filter(
      { timestamp: { $gte: startDate, $lt: endDate } },
      '-timestamp', 500, page * 500
    ).catch(() => []);
    if (!batch || batch.length === 0) break;
    allLogs = allLogs.concat(batch);
    if (batch.length < 500) break;
    page++;
    if (page >= 20) break;
  }

  // Aggregate by API
  const byApi = {};
  const byFunction = {};
  let totalCost = 0;
  let totalCalls = 0;

  for (const log of allLogs) {
    const api = log.apiName || "Unknown";
    const fn = log.functionName || "Unknown";
    const cost = log.cost || 0;
    const units = log.unitsUsed || 1;

    totalCost += cost;
    totalCalls++;

    if (!byApi[api]) byApi[api] = { calls: 0, cost: 0, unitType: log.unitType || "call", totalUnits: 0, successCount: 0, failedCount: 0, rateLimitedCount: 0 };
    byApi[api].calls++;
    byApi[api].cost += cost;
    byApi[api].totalUnits += units;
    if (log.status === "SUCCESS") byApi[api].successCount++;
    else if (log.status === "FAILED") byApi[api].failedCount++;
    else if (log.status === "RATE_LIMITED") byApi[api].rateLimitedCount++;

    if (!byFunction[fn]) byFunction[fn] = { calls: 0, cost: 0, apis: {} };
    byFunction[fn].calls++;
    byFunction[fn].cost += cost;
    if (!byFunction[fn].apis[api]) byFunction[fn].apis[api] = { calls: 0, cost: 0 };
    byFunction[fn].apis[api].calls++;
    byFunction[fn].apis[api].cost += cost;
  }

  // Sort by cost desc
  const byApiSorted = Object.entries(byApi)
    .sort((a, b) => b[1].cost - a[1].cost)
    .reduce((acc, [k, v]) => { acc[k] = v; return acc; }, {});

  const byFunctionSorted = Object.entries(byFunction)
    .sort((a, b) => b[1].cost - a[1].cost)
    .reduce((acc, [k, v]) => { acc[k] = v; return acc; }, {});

  return Response.json({
    period: { year, month, startDate, endDate },
    totalCost: Math.round(totalCost * 1000) / 1000,
    totalCalls,
    byApi: byApiSorted,
    byFunction: byFunctionSorted,
  });
});