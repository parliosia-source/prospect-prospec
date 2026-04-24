import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  ArrowLeft, Bot, Clock, CheckCircle2, AlertCircle, Loader2, Circle,
  ExternalLink, RefreshCw, ChevronRight, MapPin, Building2, Target
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

const STATUS_CONFIG = {
  PENDING: { label: "En attente", color: "bg-slate-100 text-slate-600 border-slate-200", icon: Circle },
  RUNNING: { label: "En cours", color: "bg-blue-100 text-blue-700 border-blue-200", icon: Loader2, spin: true },
  COMPLETED: { label: "Terminée", color: "bg-green-100 text-green-700 border-green-200", icon: CheckCircle2 },
  FAILED: { label: "Échouée", color: "bg-red-100 text-red-700 border-red-200", icon: AlertCircle },
};

function Row({ label, value }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-slate-50 last:border-0">
      <span className="text-xs text-slate-400 w-40 flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-slate-700 flex-1">{value}</span>
    </div>
  );
}

export default function AgentMissionDetail() {
  const params = new URLSearchParams(window.location.search);
  const missionId = params.get("id");

  const [user, setUser] = useState(null);
  const [mission, setMission] = useState(null);
  const [campaign, setCampaign] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executeError, setExecuteError] = useState(null);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  useEffect(() => {
    if (!missionId) return;
    loadAll();
  }, [missionId]);

  const loadAll = async () => {
    const [missionData] = await Promise.all([
      base44.entities.AgentMission.filter({ id: missionId }, "-created_date", 1).then(r => r[0]),
    ]);
    setMission(missionData);

    if (missionData?.campaignId) {
      const camp = await base44.entities.Campaign.filter({ id: missionData.campaignId }, "-created_date", 1).then(r => r[0]).catch(() => null);
      setCampaign(camp);
    }
    setIsLoading(false);
  };

  const handleExecute = async () => {
    setIsExecuting(true);
    setExecuteError(null);
    try {
      const res = await base44.functions.invoke("executeAgentMission", { agentMissionId: missionId });
      if (res?.data?.error) setExecuteError(res.data.error);
    } catch (err) {
      setExecuteError(err?.response?.data?.error || err.message || "Erreur inattendue");
    }
    await loadAll();
    setIsExecuting(false);
  };

  const updateStatus = async (status) => {
    setUpdatingId(status);
    await base44.entities.AgentMission.update(missionId, {
      status,
      ...(status === "RUNNING" ? { startedAt: new Date().toISOString() } : {}),
      ...(status === "FAILED" ? { errorMessage: "Marqué comme échoué manuellement (debug)" } : {}),
      ...(status === "COMPLETED" ? { completedAt: new Date().toISOString() } : {}),
    });
    await loadAll();
    setUpdatingId(null);
  };

  if (!missionId) return <div className="p-6 text-slate-500">ID mission manquant</div>;

  if (isLoading) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="h-8 w-48 bg-slate-100 rounded animate-pulse mb-4" />
        <div className="h-64 bg-slate-100 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (!mission) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center">
          <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <p className="text-red-700 font-medium">Mission introuvable</p>
          <Link to={createPageUrl("AgentMissions")} className="mt-3 inline-block">
            <Button variant="outline" size="sm" className="gap-1">
              <ArrowLeft className="w-4 h-4" /> Retour aux missions
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const cfg = STATUS_CONFIG[mission.status] || STATUS_CONFIG.PENDING;
  const Icon = cfg.icon;
  const params2 = mission.missionParams || {};

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      {/* Back */}
      <div className="flex items-center gap-3">
        <Link to={createPageUrl("AgentMissions")} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft className="w-4 h-4" /> Missions agent
        </Link>
        {mission?.campaignId && (
          <Link
            to={createPageUrl("CampaignDetail") + "?id=" + mission.campaignId}
            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
          >
            <ChevronRight className="w-4 h-4" /> Voir la campagne
          </Link>
        )}
      </div>

      {/* Header */}
      <div className="bg-white rounded-xl border shadow-sm p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 bg-purple-50 rounded-xl">
              <Bot className="w-5 h-5 text-purple-500" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${cfg.color}`}>
                  <Icon className={`w-3.5 h-3.5 ${cfg.spin ? "animate-spin" : ""}`} />
                  {cfg.label}
                </span>
                {mission.agentName && (
                  <span className="text-xs text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full">
                    Agent : {mission.agentName}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 flex items-center gap-1 mt-1">
                <Clock className="w-3 h-3" />
                Créée le {mission.created_date ? format(new Date(mission.created_date), "d MMMM yyyy à HH:mm", { locale: fr }) : "—"}
                {mission.completedAt && ` · Terminée le ${format(new Date(mission.completedAt), "d MMM à HH:mm", { locale: fr })}`}
              </p>
            </div>
          </div>

          <div className="flex gap-2 flex-shrink-0 flex-wrap">
            {/* Bouton principal : Exécuter la mission */}
            {(mission.status === "PENDING" || mission.status === "FAILED") && (
              <Button
                onClick={handleExecute}
                disabled={isExecuting}
                className="gap-2 bg-purple-600 hover:bg-purple-700 text-white"
              >
                {isExecuting
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Exécution en cours…</>
                  : <><Bot className="w-4 h-4" /> Exécuter la mission</>}
              </Button>
            )}

            {/* Boutons debug admin */}
            {user?.role === "admin" && (
              <>
                {mission.status !== "RUNNING" && (
                  <Button size="sm" variant="outline" disabled={!!updatingId || isExecuting} onClick={() => updateStatus("RUNNING")} className="text-xs text-blue-600 border-blue-200 hover:bg-blue-50">
                    {updatingId === "RUNNING" ? <Loader2 className="w-3 h-3 animate-spin" /> : "→ Running"}
                  </Button>
                )}
                {mission.status !== "COMPLETED" && (
                  <Button size="sm" variant="outline" disabled={!!updatingId || isExecuting} onClick={() => updateStatus("COMPLETED")} className="text-xs text-green-600 border-green-200 hover:bg-green-50">
                    {updatingId === "COMPLETED" ? <Loader2 className="w-3 h-3 animate-spin" /> : "→ Completed"}
                  </Button>
                )}
                {mission.status !== "FAILED" && (
                  <Button size="sm" variant="outline" disabled={!!updatingId || isExecuting} onClick={() => updateStatus("FAILED")} className="text-xs text-red-600 border-red-200 hover:bg-red-50">
                    {updatingId === "FAILED" ? <Loader2 className="w-3 h-3 animate-spin" /> : "→ Failed"}
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Campagne liée */}
      {campaign && (
        <div className="bg-white rounded-xl border shadow-sm p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-400 mb-0.5">Campagne associée</div>
              <div className="font-semibold text-slate-800">{campaign.name}</div>
              <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 flex-wrap">
                {campaign.locationQuery && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{campaign.locationQuery}</span>}
                {campaign.targetCount && <span className="flex items-center gap-1"><Target className="w-3 h-3" />{campaign.targetCount} prospects demandés</span>}
                {campaign.countProspects > 0 && <span className="text-green-600">✓ {campaign.countProspects} trouvés</span>}
              </div>
            </div>
            <Link
              to={createPageUrl("CampaignDetail") + "?id=" + mission.campaignId}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline border border-blue-200 px-2.5 py-1.5 rounded-lg hover:bg-blue-50"
            >
              Voir campagne <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      )}

      {/* Brief complet */}
      <div className="bg-white rounded-xl border shadow-sm p-5">
        <h2 className="font-semibold text-sm text-slate-800 mb-3 flex items-center gap-2">
          <Bot className="w-4 h-4 text-purple-500" /> Brief de mission
        </h2>
        {mission.brief ? (
          <div className="bg-purple-50 border border-purple-100 rounded-lg px-4 py-3 text-sm text-purple-900 leading-relaxed whitespace-pre-wrap">
            {mission.brief}
          </div>
        ) : (
          <p className="text-sm text-slate-400 italic">Aucun brief disponible.</p>
        )}
      </div>

      {/* Paramètres de campagne */}
      {(campaign || Object.keys(params2).length > 0) && (
        <div className="bg-white rounded-xl border shadow-sm p-5">
          <h2 className="font-semibold text-sm text-slate-800 mb-3 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-slate-500" /> Paramètres & critères de recherche
          </h2>
          <div className="divide-y divide-slate-50">
            <Row label="Localisation" value={campaign?.locationQuery || params2.locationQuery} />
            <Row label="Secteurs" value={campaign?.industrySectors?.join(", ") || params2.industrySectors?.join(", ")} />
            <Row label="Taille entreprise" value={campaign?.companySize || params2.companySize} />
            <Row label="Mots-clés" value={campaign?.keywords?.join(", ") || params2.keywords?.join(", ")} />
            <Row label="Objectif prospects" value={campaign?.targetCount || params2.targetCount} />
            <Row label="Seuil de score" value={campaign?.eventFitMinScore > 0 ? `${campaign.eventFitMinScore}` : null} />
            {Object.entries(params2).filter(([k]) => !["locationQuery", "industrySectors", "companySize", "keywords", "targetCount"].includes(k)).map(([k, v]) => (
              <Row key={k} label={k} value={typeof v === "object" ? JSON.stringify(v) : String(v)} />
            ))}
          </div>
        </div>
      )}

      {/* Erreur d'exécution frontend */}
      {executeError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-medium text-red-700 mb-1">Erreur lors de l'exécution</div>
            <div className="font-mono text-xs text-red-600">{executeError}</div>
          </div>
        </div>
      )}

      {/* Résumé d'exécution */}
      {mission.resultSummary && (() => {
        let parsed = null;
        try { parsed = JSON.parse(mission.resultSummary); } catch (_) { /* raw string */ }
        return (
          <div className="bg-white rounded-xl border shadow-sm p-5">
            <h2 className="font-semibold text-sm text-slate-800 mb-3 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" /> Résumé d'exécution
            </h2>
            {parsed ? (
              <div className="grid grid-cols-2 gap-3 mb-3">
                {[
                  { label: "Prospects demandés", value: parsed.prospectsRequested, color: "text-slate-700" },
                  { label: "Prospects trouvés", value: parsed.prospectsFound, color: "text-blue-700" },
                  { label: "Prospects créés", value: parsed.prospectsCreated, color: "text-green-700" },
                  { label: "Doublons ignorés", value: parsed.duplicatesSkipped, color: "text-slate-500" },
                  { label: "Requêtes exécutées", value: parsed.queriesExecuted, color: "text-slate-500" },
                  { label: "Appels Brave", value: parsed.braveRequests, color: "text-slate-500" },
                ].map(({ label, value, color }) => value !== undefined && (
                  <div key={label} className="bg-slate-50 rounded-lg px-3 py-2">
                    <div className="text-xs text-slate-400">{label}</div>
                    <div className={`text-xl font-bold ${color}`}>{value}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-green-50 border border-green-100 rounded-lg px-4 py-3 text-sm text-green-900 leading-relaxed whitespace-pre-wrap">
                {mission.resultSummary}
              </div>
            )}
            {parsed?.sourcesUsed && (
              <div className="text-xs text-slate-400 mt-1">Sources : {parsed.sourcesUsed.join(", ")}</div>
            )}
          </div>
        );
      })()}

      {/* Erreur si FAILED */}
      {mission.status === "FAILED" && mission.errorMessage && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5">
          <h2 className="font-semibold text-sm text-red-800 mb-2 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-500" /> Erreur d'exécution
          </h2>
          <div className="font-mono text-xs text-red-700 bg-red-100 rounded-lg px-3 py-2 whitespace-pre-wrap break-all">
            {mission.errorMessage}
          </div>
        </div>
      )}

      {/* Timestamps */}
      <div className="bg-white rounded-xl border shadow-sm p-5">
        <h2 className="font-semibold text-sm text-slate-800 mb-3 flex items-center gap-2">
          <Clock className="w-4 h-4 text-slate-400" /> Chronologie
        </h2>
        <div className="divide-y divide-slate-50">
          <Row label="Créée le" value={mission.created_date ? format(new Date(mission.created_date), "d MMMM yyyy à HH:mm:ss", { locale: fr }) : null} />
          <Row label="Démarrée le" value={mission.startedAt ? format(new Date(mission.startedAt), "d MMMM yyyy à HH:mm:ss", { locale: fr }) : "—"} />
          <Row label="Terminée le" value={mission.completedAt ? format(new Date(mission.completedAt), "d MMMM yyyy à HH:mm:ss", { locale: fr }) : "—"} />
          <Row label="Dernière MAJ" value={mission.updated_date ? format(new Date(mission.updated_date), "d MMMM yyyy à HH:mm:ss", { locale: fr }) : null} />
        </div>
      </div>
    </div>
  );
}