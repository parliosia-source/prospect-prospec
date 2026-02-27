import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { RefreshCw, DollarSign } from "lucide-react";

export default function ApiCostsSection() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    setLoading(true);
    const { data: result } = await base44.functions.invoke("getApiCostsSummary", {});
    setData(result);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  return (
    <div className="bg-white rounded-xl border p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-green-600" />
          <h3 className="font-semibold text-slate-800">Coûts API — Mois en cours</h3>
        </div>
        <Button size="sm" variant="outline" onClick={loadData} disabled={loading} className="gap-2 text-xs">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Actualiser
        </Button>
      </div>

      {loading && !data && <div className="text-center py-6 text-slate-400">Chargement…</div>}

      {data && (
        <div className="space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-green-50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-green-700">${data.totalCost?.toFixed(3)}</div>
              <div className="text-xs text-slate-500 mt-1">Coût total USD</div>
            </div>
            <div className="bg-blue-50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-blue-600">{data.totalCalls}</div>
              <div className="text-xs text-slate-500 mt-1">Appels API</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 text-center">
              <div className="text-sm font-semibold text-slate-700 mt-1">
                {data.period?.month}/{data.period?.year}
              </div>
              <div className="text-xs text-slate-500 mt-1">Période</div>
            </div>
          </div>

          {/* By API */}
          <div>
            <h4 className="text-sm font-medium text-slate-700 mb-2">Par API</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b">
                    <th className="text-left px-3 py-2 font-semibold text-slate-600">API</th>
                    <th className="text-right px-3 py-2 font-semibold text-slate-600">Appels</th>
                    <th className="text-right px-3 py-2 font-semibold text-slate-600">Unités</th>
                    <th className="text-right px-3 py-2 font-semibold text-slate-600">Coût</th>
                    <th className="text-right px-3 py-2 font-semibold text-slate-600">✓</th>
                    <th className="text-right px-3 py-2 font-semibold text-slate-600">✗</th>
                    <th className="text-right px-3 py-2 font-semibold text-slate-600">⏱</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {Object.entries(data.byApi || {}).map(([api, v]) => (
                    <tr key={api} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-medium text-slate-800">{api}</td>
                      <td className="px-3 py-2 text-right">{v.calls}</td>
                      <td className="px-3 py-2 text-right text-slate-500">{v.totalUnits} {v.unitType}</td>
                      <td className="px-3 py-2 text-right font-mono text-green-700">${v.cost?.toFixed(3)}</td>
                      <td className="px-3 py-2 text-right text-green-600">{v.successCount}</td>
                      <td className="px-3 py-2 text-right text-red-500">{v.failedCount || 0}</td>
                      <td className="px-3 py-2 text-right text-yellow-600">{v.rateLimitedCount || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* By Function */}
          <div>
            <h4 className="text-sm font-medium text-slate-700 mb-2">Par fonction</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b">
                    <th className="text-left px-3 py-2 font-semibold text-slate-600">Fonction</th>
                    <th className="text-right px-3 py-2 font-semibold text-slate-600">Appels</th>
                    <th className="text-right px-3 py-2 font-semibold text-slate-600">Coût</th>
                    <th className="text-left px-3 py-2 font-semibold text-slate-600">APIs utilisées</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {Object.entries(data.byFunction || {}).map(([fn, v]) => (
                    <tr key={fn} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono font-medium text-slate-800">{fn}</td>
                      <td className="px-3 py-2 text-right">{v.calls}</td>
                      <td className="px-3 py-2 text-right font-mono text-green-700">${v.cost?.toFixed(3)}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(v.apis || {}).map(([api, a]) => (
                            <span key={api} className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">
                              {api}: {a.calls}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {data.totalCalls === 0 && (
            <div className="text-center text-sm text-slate-400 py-4">
              Aucun appel API enregistré ce mois-ci.
            </div>
          )}
        </div>
      )}
    </div>
  );
}