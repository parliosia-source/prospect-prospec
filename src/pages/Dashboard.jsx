import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { format, startOfDay, endOfDay } from "date-fns";
import { fr } from "date-fns/locale";
import { ChevronRight, Clock, AlertTriangle, Star, Building2, Plus, Settings, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import GazetteBlock from "@/components/dashboard/GazetteBlock";
import PipelineHealth from "@/components/dashboard/PipelineHealth";
import Hubz404Block from "@/components/dashboard/Hubz404Block";
import CampaignModal from "@/components/campaigns/CampaignModal.jsx";
import OnboardingWizard from "@/components/onboarding/OnboardingWizard";

export default function Dashboard() {
  const [user, setUser] = useState(null);
  const [leads, setLeads] = useState([]);
  const [topProspects, setTopProspects] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [hasCampaigns, setHasCampaigns] = useState(true);

  useEffect(() => {
    base44.auth.me().then(setUser);
  }, []);

  useEffect(() => {
    if (!user) return;
    const f = user.role === "admin" ? {} : { ownerUserId: user.email };
    Promise.all([
    base44.entities.Lead.filter(f, "-nextActionDueAt", 100),
    base44.entities.Prospect.filter({ ...f, status: "QUALIFIÉ" }, "-relevanceScore", 10),
    base44.entities.Campaign.filter(f, "-created_date", 1),
    user.role === "admin" ? base44.entities.TenantSettings.filter({ settingsId: "global" }) : Promise.resolve([{ companyName: "ok" }])]
    ).then(([l, p, camps, tenants]) => {
      setLeads(l);
      setTopProspects(p.filter((x) => (x.relevanceScore || 0) >= 75));
      setHasCampaigns(camps.length > 0);
      // Show onboarding if admin and config incomplete
      if (user.role === "admin" && (tenants.length === 0 || !tenants[0]?.companyName)) {
        setShowOnboarding(true);
      }
      setIsLoading(false);
    });
  }, [user]);

  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());
  const activeLeads = leads.filter((l) => l.nextActionStatus === "ACTIVE" && l.nextActionDueAt);
  const todayLeads = activeLeads.filter((l) => new Date(l.nextActionDueAt) >= todayStart && new Date(l.nextActionDueAt) <= todayEnd);
  const overdueLeads = activeLeads.filter((l) => new Date(l.nextActionDueAt) < todayStart);
  const pipelineActive = leads.filter((l) => !["CLOSED_WON", "CLOSED_LOST"].includes(l.status));

  const stats = [
  { label: "À traiter auj.", value: todayLeads.length, cls: "bg-blue-50 border-blue-100 text-blue-700 text-blue-600" },
  { label: "En retard", value: overdueLeads.length, cls: overdueLeads.length > 0 ? "bg-red-50 border-red-100 text-red-700 text-red-600" : "bg-slate-50 border-slate-100 text-slate-700 text-slate-500" },
  { label: "Qualifiés non exportés", value: topProspects.length, cls: "bg-yellow-50 border-yellow-100 text-yellow-700 text-yellow-600" },
  { label: "Leads actifs", value: pipelineActive.length, cls: "bg-green-50 border-green-100 text-green-700 text-green-600" }];


  const actionLabels = { FOLLOW_UP_J7: "Relance J+7", FOLLOW_UP_J14: "Relance J+14", CALL: "Appel", SEND_MESSAGE: "Message", CUSTOM: "Action" };

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      {showOnboarding &&
      <OnboardingWizard onComplete={() => setShowOnboarding(false)} />
      }
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500">{format(new Date(), "EEEE d MMMM yyyy", { locale: fr })}</p>
        </div>
        <Button onClick={() => setShowCampaignModal(true)} className="bg-blue-600 hover:bg-blue-700 gap-2">
          <Plus className="w-4 h-4" /> Nouvelle campagne
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((s) => {
          const [bg, border, val, sub] = s.cls.split(" ");
          return (
            <div key={s.label} className={`rounded-xl p-4 border ${bg} ${border}`}>
              <div className={`text-2xl font-bold ${val}`}>{s.value}</div>
              <div className={`text-xs mt-0.5 ${sub}`}>{s.label}</div>
            </div>);

        })}
      </div>

      {/* Empty state — no campaigns yet */}
      {!isLoading && !hasCampaigns && leads.length === 0 &&
      <div className="bg-white rounded-2xl border-2 border-dashed border-slate-200 p-10 text-center">
          <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Search className="w-6 h-6 text-blue-500" />
          </div>
          <h3 className="font-semibold text-slate-700 mb-1">Créez votre première campagne</h3>
          <p className="text-sm text-slate-400 max-w-xs mx-auto mb-5">
            Lancez une recherche automatique de prospects selon votre marché cible.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button onClick={() => setShowCampaignModal(true)} className="bg-blue-600 hover:bg-blue-700 gap-2">
              <Plus className="w-4 h-4" /> Nouvelle campagne
            </Button>
            {user?.role === "admin" &&
          <Button variant="outline" onClick={() => setShowOnboarding(true)} className="gap-2">
                <Settings className="w-4 h-4" /> Configurer l'app
              </Button>
          }
          </div>
        </div>
      }

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-4">
          <GazetteBlock />

          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-500" />
                <span className="font-semibold text-sm text-slate-800">À traiter aujourd'hui</span>
                {overdueLeads.length > 0 &&
                <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                    {overdueLeads.length} en retard
                  </span>
                }
              </div>
              <Link to={createPageUrl("Pipeline")} className="text-xs text-blue-600 hover:underline">Voir tout le Suivi →</Link>
            </div>

            {isLoading ?
            <div className="p-4 space-y-2">
                {[1, 2, 3].map((i) => <div key={i} className="h-12 bg-slate-100 rounded animate-pulse" />)}
              </div> :
            todayLeads.length === 0 && overdueLeads.length === 0 ?
            <div className="bg-[hsl(var(--input))] text-slate-950 p-8 text-sm text-center">🎉 Aucune action prévue aujourd'hui</div> :

            <div className="divide-y">
                {[...overdueLeads, ...todayLeads].slice(0, 8).map((lead) =>
              <Link key={lead.id} to={createPageUrl("LeadDetail") + "?id=" + lead.id}
              className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 group">
                    <div className="flex items-center gap-3 min-w-0">
                      {overdueLeads.includes(lead) && <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />}
                      <Building2 className="w-4 h-4 text-slate-400 flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-800 truncate">{lead.companyName}</div>
                        <div className="text-xs text-slate-500">{actionLabels[lead.nextActionType] || "Action requise"}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {overdueLeads.includes(lead) &&
                  <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">Retard</span>
                  }
                      <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500" />
                    </div>
                  </Link>
              )}
              </div>
            }
          </div>
        </div>

        <div className="space-y-4">
          <Hubz404Block />
          {topProspects.length > 0 &&
          <div className="bg-white rounded-xl border shadow-sm">
              <div className="px-4 py-3 border-b flex items-center gap-2">
                <Star className="w-4 h-4 text-yellow-500" />
                <span className="font-semibold text-sm text-slate-800">Top Opportunités</span>
              </div>
              <div className="divide-y">
                {topProspects.slice(0, 5).map((p) =>
              <Link key={p.id} to={createPageUrl("ProspectDetail") + "?id=" + p.id}
              className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 group">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-800 truncate">{p.companyName}</div>
                      <div className="text-xs text-slate-400 truncate">{p.industry}</div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs font-bold text-yellow-700 bg-yellow-50 px-1.5 py-0.5 rounded">{p.relevanceScore}</span>
                      <ChevronRight className="w-3 h-3 text-slate-300 group-hover:text-slate-500" />
                    </div>
                  </Link>
              )}
              </div>
            </div>
          }
          <PipelineHealth leads={leads} isLoading={isLoading} />
        </div>
      </div>

      <CampaignModal
        open={showCampaignModal}
        onClose={() => setShowCampaignModal(false)}
        onSave={async (formData, launch) => {
          const camp = await base44.entities.Campaign.create({ ...formData, ownerUserId: user.email, status: "DRAFT" });
          setShowCampaignModal(false);
          if (launch) {
            // Optimistic update: mark RUNNING immediately for instant progress feedback
            await base44.entities.Campaign.update(camp.id, {
              status: "RUNNING",
              progressPct: 5,
              errorMessage: null,
              lastRunAt: new Date().toISOString()
            }).catch(() => {});
            // Fire-and-forget search
            base44.functions.invoke("runProspectSearch", { campaignId: camp.id });
            // Redirect: CampaignDetail will poll immediately since status=RUNNING
            window.location.href = createPageUrl("CampaignDetail") + "?id=" + camp.id;
          }
        }} />
      
    </div>);

}