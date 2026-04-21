import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { createPageUrl } from "@/utils";
import { PartyPopper, Building2, ExternalLink, MapPin, RefreshCw, Brain } from "lucide-react";

const SOURCE_CONFIG = {
  PARTY_WATCH: { label: "Party Watch", color: "bg-pink-50 text-pink-700 border-pink-100" },
  SALLE_VIP:   { label: "Salle VIP",   color: "bg-purple-50 text-purple-700 border-purple-100" },
};

const STATUS_CONFIG = {
  ACTIF:    { label: "Actif",    color: "bg-green-50 text-green-700" },
  CONTACTÉ: { label: "Contacté", color: "bg-blue-50 text-blue-700" },
  CONVERTI: { label: "Converti", color: "bg-yellow-50 text-yellow-700" },
  IGNORÉ:   { label: "Ignoré",   color: "bg-slate-100 text-slate-400" },
};

export default function Hubz404Block() {
  const [items, setItems]         = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter]       = useState("ALL");

  useEffect(() => { loadItems(); }, []);

  const loadItems = async () => {
    setIsLoading(true);
    try {
      const data = await base44.entities.Hubz404Entry.list("-targetContactMonth", 50);
      setItems(data.filter(i => i.status === "ACTIF"));
    } catch (e) { console.error(e); }
    setIsLoading(false);
  };

  const handleStatusChange = async (item, newStatus) => {
    await base44.entities.Hubz404Entry.update(item.id, { status: newStatus });
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: newStatus } : i));
  };

  const handleAnalyze = async (item) => {
    const prospect = await base44.entities.Prospect.create({
      companyName: item.companyName,
      domain: item.domain,
      website: item.website,
      industry: item.industryLabel,
      status: "NOUVEAU",
      sourceTag: "HUBZ404",
      notes: item.notes,
    });
    window.location.href = createPageUrl("ProspectDetail") + "?id=" + prospect.id;
  };

  const filtered = filter === "ALL" ? items : items.filter(i => i.sourceType === filter);
  const partyCount = items.filter(i => i.sourceType === "PARTY_WATCH").length;
  const salleCount = items.filter(i => i.sourceType === "SALLE_VIP").length;

  return (
    <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PartyPopper className="w-4 h-4 text-pink-500" />
          <span className="font-semibold text-sm text-slate-800">Hubz 404</span>
          <span className="text-xs text-slate-400 font-normal">Événements saisonniers</span>
        </div>
        <button onClick={loadItems} className="text-slate-400 hover:text-slate-600 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-4 pt-3 flex gap-2">
        {[
          { key: "ALL",         label: `Tous (${items.length})` },
          { key: "PARTY_WATCH", label: `🎉 Party (${partyCount})` },
          { key: "SALLE_VIP",   label: `🏛 Salles (${salleCount})` },
        ].map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${
              filter === f.key
                ? "bg-pink-600 text-white border-pink-600"
                : "bg-white text-slate-500 border-slate-200 hover:border-pink-300"
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="p-4 space-y-2">
          {[1,2,3].map(i => <div key={i} className="h-12 bg-slate-100 rounded animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-10 text-center text-slate-400 text-sm px-4">
          <PartyPopper className="w-8 h-8 mx-auto mb-2 text-slate-300" />
          Aucun compte saisonnier actif
        </div>
      ) : (
        <div className="divide-y mt-2">
          {filtered.slice(0, 8).map(item => {
            const src = SOURCE_CONFIG[item.sourceType] || SOURCE_CONFIG.PARTY_WATCH;
            return (
              <div key={item.id} className="px-4 py-3 hover:bg-slate-50 flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <Building2 className="w-4 h-4 text-slate-300 mt-0.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-slate-800 truncate">{item.companyName}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${src.color}`}>
                        {src.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-400 flex-wrap">
                      {item.salleReference && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />{item.salleReference}
                        </span>
                      )}
                      {item.eventType && <span>{item.eventType}</span>}
                      {item.targetContactMonth && (
                        <span className="font-medium text-pink-600">→ Contacter : {item.targetContactMonth}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {item.website && (
                    <a href={item.website} target="_blank" rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="p-1 rounded hover:bg-slate-100 text-slate-300 hover:text-slate-500">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                  <button
                    onClick={() => handleAnalyze(item)}
                    title="Analyser ce compte"
                    className="p-1 rounded hover:bg-purple-50 text-slate-300 hover:text-purple-600 transition-colors"
                  >
                    <Brain className="w-3.5 h-3.5" />
                  </button>
                  <select value={item.status}
                    onChange={e => handleStatusChange(item, e.target.value)}
                    className="text-xs border border-slate-200 rounded px-1.5 py-0.5 text-slate-600 bg-white cursor-pointer">
                    {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                      <option key={k} value={k}>{v.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
          {filtered.length > 8 && (
            <div className="px-4 py-2.5 text-xs text-center text-slate-400">
              +{filtered.length - 8} autres comptes
            </div>
          )}
        </div>
      )}
    </div>
  );
}