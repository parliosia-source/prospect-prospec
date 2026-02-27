export default function KbCoverageMatrix({ kbStats }) {
  if (!kbStats?.countBySectorAndRegion || !kbStats?.regionsPresent || !kbStats?.sectorsPresent) {
    return null;
  }

  const { countBySectorAndRegion, regionsPresent, sectorsPresent } = kbStats;

  // Compute totals
  const rowTotals = {};
  const colTotals = {};
  let grandTotal = 0;

  for (const sector of sectorsPresent) {
    rowTotals[sector] = 0;
    for (const region of regionsPresent) {
      const val = countBySectorAndRegion[sector]?.[region] || 0;
      rowTotals[sector] += val;
      colTotals[region] = (colTotals[region] || 0) + val;
      grandTotal += val;
    }
  }

  return (
    <div className="bg-white rounded-xl border p-5">
      <h3 className="font-semibold text-slate-800 mb-3">Couverture KB par Secteur et Région</h3>
      <p className="text-xs text-slate-500 mb-3">
        Matrice croisée : {sectorsPresent.length} secteurs × {regionsPresent.length} régions · Total: {grandTotal} entrées
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-slate-50">
              <th className="text-left px-2 py-2 font-semibold text-slate-600 border sticky left-0 bg-slate-50 min-w-[140px]">
                Secteur
              </th>
              {regionsPresent.map(r => (
                <th key={r} className="text-center px-2 py-2 font-semibold text-slate-600 border min-w-[60px]">
                  {r}
                </th>
              ))}
              <th className="text-center px-2 py-2 font-bold text-slate-800 border bg-slate-100 min-w-[60px]">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {sectorsPresent.map(sector => (
              <tr key={sector} className="hover:bg-blue-50/30">
                <td className="px-2 py-1.5 font-medium text-slate-700 border sticky left-0 bg-white truncate max-w-[180px]">
                  {sector}
                </td>
                {regionsPresent.map(region => {
                  const val = countBySectorAndRegion[sector]?.[region] || 0;
                  return (
                    <td key={region} className={`text-center px-2 py-1.5 border font-mono ${
                      val === 0 ? "text-slate-300" : val >= 50 ? "text-green-700 font-bold bg-green-50" : val >= 10 ? "text-blue-600" : "text-slate-600"
                    }`}>
                      {val || "—"}
                    </td>
                  );
                })}
                <td className="text-center px-2 py-1.5 border font-mono font-bold text-slate-800 bg-slate-50">
                  {rowTotals[sector]}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-100 font-bold">
              <td className="px-2 py-2 border sticky left-0 bg-slate-100 text-slate-800">Total</td>
              {regionsPresent.map(r => (
                <td key={r} className="text-center px-2 py-2 border font-mono text-slate-800">
                  {colTotals[r] || 0}
                </td>
              ))}
              <td className="text-center px-2 py-2 border font-mono text-slate-900 bg-slate-200">
                {grandTotal}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}