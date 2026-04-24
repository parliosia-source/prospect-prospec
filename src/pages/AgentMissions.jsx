import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Bot, ChevronRight, RefreshCw, Clock, AlertCircle, CheckCircle2, Loader2, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

const STATUS_CONFIG = {
  PENDING: { label: "En attente", color: "bg-slate-100 text-slate-600", icon: Circle },
  RUNNING: { label: "En cours", color: "bg-blue-100 text-blue-700", icon: Loader2, spin: true },
  COMPLETED: { label: "Terminée", color: "bg-green-100 text-green-700", icon: CheckCircle2 },
  FAILED: { label: "Échouée", color: "bg-red-100 text-red-700", icon: AlertCircle },
};

function MissionStatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.PENDING;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      <Icon className={`w-3 h-3 ${cfg.spin ? "animate-spin" : ""}`} />
      {cfg.label}
    </span>
  );
}

export default function AgentMissions() {
  const [user, setUser] = useState(null);
  const [missions, setMissions] = useState([]);
  const [campaigns, setCampaigns] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState(null);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  useEffect(() => {
    if (user === null) return;
    loadAll();
  }, [user]);

  const loadAll = async () => {
    const filter = user?.role === "admin" ? {} : { ownerUserId: user?.email };
    const [missionsData] = await Promise.all([
      base44.entities.AgentMission.filter(filter, "-created_date", 100),
    ]);
    setMissions(missionsData);

    // Load linked campaigns
    const campaignIds = [...new Set(missionsData.map(m => m.campaignId).filter(Boolean))];
    if (campaignIds.length > 0) {
      const campData = await Promise.all(
        campaignIds.map(id => base44.entities.Campaign.filter({ id }, "-created_date", 1).then(r => r[0]).catch(() => null))
      );
      const campMap = {};
      campData.forEach(c => { if (c) campMap[c.id] = c; });
      setCampaigns(campMap);
    }
    setIsLoading(false);
  };

  const updateStatus = async (missionId, status) => {
    setUpdatingId(missionId);
    await base44.entities.AgentMission.update(missionId, {
      status,
      ...(status === "RUNNING" ? { startedAt: new Date().toISOString() } : {}),
      ...(status === "FAILED" ? { errorMessage: "Marqué comme échoué manuellement (debug)" } : {}),
    });
    await loadAll();
    setUpdatingId(null);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Bot className="w-5 h-5 text-purple-500" />
            <h1 className="text-2xl font-bold text-slate-900">Missions Superagent</h1>
          </div>
          <p className="text-sm text-slate-500">Suivi des missions destinées aux Superagents Base44 externes (/superagent), créées par les campagnes en mode Superagent autonome</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadAll} className="gap-2">
          <RefreshCw className="w-3.5 h-3.5" /> Actualiser
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-24 bg-slate-100 rounded-xl animate-pulse" />)}
        </div>
      ) : missions.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border-2 border-dashed border-slate-200">
          <div className="w-12 h-12 bg-purple-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Bot className="w-6 h-6 text-purple-400" />
          </div>
          <p className="text-slate-700 font-semibold mb-1">Aucune mission Superagent</p>
          <p className="text-sm text-slate-400 mt-1 max-w-xs mx-auto">
            Les missions apparaissent ici lorsqu'une campagne est lancée en mode <strong>Superagent autonome</strong>.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {missions.map(mission => {
            const camp = campaigns[mission.campaignId];
            const isUpdating = updatingId === mission.id;
            return (
              <div key={mission.id} className="bg-white rounded-xl border shadow-sm hover:shadow-md transition-shadow">
                <div className="px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <MissionStatusBadge status={mission.status} />
                        {camp && (
                          <Link
                            to={createPageUrl("CampaignDetail") + "?id=" + mission.campaignId}
                            className="text-xs text-blue-600 hover:underline bg-blue-50 px-2 py-0.5 rounded-full"
                          >
                            Campagne : {camp.name}
                          </Link>
                        )}
                      </div>

                      <p className="text-sm text-slate-700 font-medium line-clamp-2 mt-1">
                        {mission.brief || "Brief non spécifié"}
                      </p>

                      <div className="flex items-center gap-4 mt-2 text-xs text-slate-400 flex-wrap">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          Créée le {mission.created_date
                            ? format(new Date(mission.created_date), "d MMM yyyy à HH:mm", { locale: fr })
                            : "—"}
                        </span>
                        {mission.updated_date && (
                          <span>Mise à jour : {format(new Date(mission.updated_date), "d MMM à HH:mm", { locale: fr })}</span>
                        )}
                        {camp?.targetCount && (
                          <span>🎯 {camp.targetCount} prospects demandés</span>
                        )}
                        {camp?.countProspects > 0 && (
                          <span className="text-green-600">✓ {camp.countProspects} trouvés</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {user?.role === "admin" && (
                        <>
                          {mission.status !== "RUNNING" && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isUpdating}
                              onClick={() => updateStatus(mission.id, "RUNNING")}
                              className="text-xs h-7 text-blue-600 border-blue-200 hover:bg-blue-50"
                            >
                              {isUpdating ? <Loader2 className="w-3 h-3 animate-spin" /> : "→ Running"}
                            </Button>
                          )}
                          {mission.status !== "FAILED" && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isUpdating}
                              onClick={() => updateStatus(mission.id, "FAILED")}
                              className="text-xs h-7 text-red-600 border-red-200 hover:bg-red-50"
                            >
                              {isUpdating ? <Loader2 className="w-3 h-3 animate-spin" /> : "→ Failed"}
                            </Button>
                          )}
                        </>
                      )}
                      <Link
                        to={createPageUrl("AgentMissionDetail") + "?id=" + mission.id}
                        className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-blue-600 border border-slate-200 hover:border-blue-300 px-2.5 py-1.5 rounded-lg transition-colors"
                      >
                        Voir détail <ChevronRight className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}