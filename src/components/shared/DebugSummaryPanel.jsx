import { useState } from "react";
import { ChevronDown, ChevronRight, AlertTriangle, XCircle, CheckCircle2, Info } from "lucide-react";

const WARNING_ICONS = {
  NO_RAW_RESULTS: { icon: XCircle, color: "text-red-500" },
  LOW_RESULTS: { icon: AlertTriangle, color: "text-amber-500" },
  MANY_DUPLICATES: { icon: AlertTriangle, color: "text-orange-500" },
  SOURCE_NOT_CONFIGURED: { icon: XCircle, color: "text-red-600" },
  KB_TOPUP_USED: { icon: Info, color: "text-blue-500" },
};

function Stat({ label, value, highlight }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`text-xs font-mono font-semibold ${highlight ? "text-amber-600" : "text-slate-700"}`}>
        {value ?? "—"}
      </span>
    </div>
  );
}

function WarningLine({ text }) {
  const key = Object.keys(WARNING_ICONS).find(k => text.startsWith(k));
  const cfg = key ? WARNING_ICONS[key] : { icon: Info, color: "text-slate-400" };
  const Icon = cfg.icon;
  const [code, ...rest] = text.split(": ");
  return (
    <div className="flex items-start gap-2 py-1">
      <Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${cfg.color}`} />
      <div className="text-xs">
        <span className="font-semibold text-slate-700">{code}: </span>
        <span className="text-slate-600">{rest.join(": ")}</span>
      </div>
    </div>
  );
}

/**
 * DebugSummaryPanel — affiche l'objet debugInfo du moteur de recherche.
 * Accepte debugInfo (objet structuré) OU rawText (chaîne legacy).
 */
export default function DebugSummaryPanel({ debugInfo, rawText, className = "" }) {
  const [open, setOpen] = useState(false);

  // Nothing to show
  if (!debugInfo && !rawText) return null;

  const hasWarnings = debugInfo?.warnings?.length > 0;
  const hasErrors = debugInfo?.errors?.length > 0;

  return (
    <div className={`rounded-xl border bg-slate-900 overflow-hidden ${className}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-slate-800 transition-colors"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
          <span className="text-xs font-mono text-slate-400">Détails techniques</span>
          {hasErrors && (
            <span className="flex items-center gap-1 text-xs text-red-400 ml-2">
              <XCircle className="w-3 h-3" /> {debugInfo.errors.length} erreur{debugInfo.errors.length > 1 ? "s" : ""}
            </span>
          )}
          {hasWarnings && (
            <span className="flex items-center gap-1 text-xs text-amber-400 ml-1">
              <AlertTriangle className="w-3 h-3" /> {debugInfo.warnings.length} avertissement{debugInfo.warnings.length > 1 ? "s" : ""}
            </span>
          )}
          {!hasWarnings && !hasErrors && debugInfo && (
            <span className="flex items-center gap-1 text-xs text-green-400 ml-2">
              <CheckCircle2 className="w-3 h-3" /> OK
            </span>
          )}
        </div>
        {debugInfo?.durationMs && (
          <span className="text-xs text-slate-500 font-mono">{debugInfo.durationMs}ms</span>
        )}
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-slate-700">
          {/* Structured debugInfo */}
          {debugInfo ? (
            <div className="mt-3 space-y-4">
              {/* Warnings */}
              {(hasWarnings || hasErrors) && (
                <div className="bg-slate-800 rounded-lg p-3">
                  <div className="text-xs font-semibold text-slate-300 mb-2 uppercase tracking-wide">Alertes</div>
                  {debugInfo.errors?.map((e, i) => (
                    <div key={i} className="flex items-start gap-2 py-1">
                      <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
                      <span className="text-xs text-red-300">{e}</span>
                    </div>
                  ))}
                  {debugInfo.warnings?.map((w, i) => <WarningLine key={i} text={w} />)}
                </div>
              )}

              {/* Pipeline stats */}
              <div className="bg-slate-800 rounded-lg p-3">
                <div className="text-xs font-semibold text-slate-300 mb-2 uppercase tracking-wide">Pipeline</div>
                <Stat label="Mode source" value={debugInfo.sourceMode} />
                <Stat label="Demandés" value={debugInfo.requestedCount} />
                <Stat label="Résultats bruts (Brave)" value={debugInfo.rawResultsCount} highlight={debugInfo.rawResultsCount === 0} />
                <Stat label="Exclus / filtrés" value={debugInfo.excludedCount} />
                <Stat label="Doublons supprimés" value={debugInfo.duplicateCount} highlight={debugInfo.duplicateCount > (debugInfo.rawResultsCount * 0.4)} />
                <Stat label="Ajoutés depuis KB" value={debugInfo.kbTopUpCount} />
                <Stat label="Scorés (après filtre seuil)" value={debugInfo.scoredCount} />
                <Stat label="Créés en base" value={debugInfo.createdCount} highlight={debugInfo.createdCount < debugInfo.requestedCount} />
              </div>

              {/* Config */}
              <div className="bg-slate-800 rounded-lg p-3">
                <div className="text-xs font-semibold text-slate-300 mb-2 uppercase tracking-wide">Configuration</div>
                <Stat label="Tenant" value={debugInfo.tenantId} />
                <Stat label="Géographie" value={debugInfo.geographies?.join(", ")} />
                <Stat label="Requêtes Brave" value={`${debugInfo.braveRequests} / ${debugInfo.queriesExecuted} générées`} />
                <Stat label="Scoring" value={debugInfo.scoringMode} />
                <Stat label="Seuil de score" value={debugInfo.fitThreshold > 0 ? debugInfo.fitThreshold : "aucun"} />
                <Stat label="Sources" value={debugInfo.sourcesUsed?.join(", ")} />
                <Stat label="Durée" value={`${debugInfo.durationMs}ms`} />
                <Stat label="Timestamp" value={debugInfo.timestamp} />
              </div>
            </div>
          ) : (
            /* Legacy raw text */
            <div className="mt-3 font-mono text-xs text-slate-300 bg-slate-800 rounded-lg px-3 py-2 whitespace-pre-wrap break-all">
              {rawText}
            </div>
          )}
        </div>
      )}
    </div>
  );
}