import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Send, MessageSquare, CheckCircle2, PhoneCall, XCircle, Clock, RefreshCw, Brain, Star, ThumbsDown, ArrowUpRight, Sparkles } from "lucide-react";

const ACTION_CONFIG = {
  // Lead-level events
  MESSAGE_SENT:        { icon: Send,         color: "text-green-600",  bg: "bg-green-50 border-green-100",   label: "Message envoyé" },
  MESSAGE_GENERATED:   { icon: Brain,        color: "text-blue-500",   bg: "bg-blue-50 border-blue-100",     label: "Message généré" },
  LEAD_REPLIED:        { icon: MessageSquare,color: "text-blue-600",   bg: "bg-blue-50 border-blue-100",     label: "A répondu" },
  LEAD_MEETING:        { icon: PhoneCall,    color: "text-purple-600", bg: "bg-purple-50 border-purple-100", label: "RDV planifié" },
  LEAD_CLOSED_WON:     { icon: CheckCircle2, color: "text-emerald-600",bg: "bg-emerald-50 border-emerald-100",label: "Gagné 🎉" },
  LEAD_CLOSED_LOST:    { icon: XCircle,      color: "text-red-500",    bg: "bg-red-50 border-red-100",       label: "Perdu" },
  LEAD_STATUS_CHANGED: { icon: RefreshCw,    color: "text-slate-500",  bg: "bg-slate-50 border-slate-100",   label: "Statut modifié" },
  // Prospect-level events (shown in lead timeline via prospectId lookup)
  ANALYZE_PROSPECT:    { icon: Brain,        color: "text-indigo-600", bg: "bg-indigo-50 border-indigo-100", label: "Prospect analysé" },
  PROSPECT_QUALIFIED:  { icon: Star,         color: "text-amber-600",  bg: "bg-amber-50 border-amber-100",   label: "Qualifié" },
  PROSPECT_REJECTED:   { icon: ThumbsDown,   color: "text-red-400",    bg: "bg-red-50 border-red-100",       label: "Rejeté" },
  EXPORT_TO_LEAD:      { icon: ArrowUpRight, color: "text-purple-600", bg: "bg-purple-50 border-purple-100", label: "Exporté vers Suivi" },
  ANALYZE_CAMPAIGN_PROSPECTS: { icon: Brain, color: "text-indigo-500", bg: "bg-indigo-50 border-indigo-100", label: "Analyse IA" },
};

const CHANNEL_LABEL = { LINKEDIN: "LinkedIn", EMAIL: "Email", WHATSAPP: "WhatsApp" };
const FOLLOWUP_LABEL = { FOLLOW_UP_J7: "Relance J+7", FOLLOW_UP_J14: "Relance J+14" };

export default function ActivityTimeline({ leadId, prospectId }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!leadId && !prospectId) return;
    setLoading(true);

    const queries = [];
    if (leadId) queries.push(
      base44.entities.ActivityLog.filter({ entityId: leadId, entityType: "Lead" }, "-created_date", 30)
    );
    if (prospectId) queries.push(
      base44.entities.ActivityLog.filter({ entityId: prospectId, entityType: "Prospect" }, "-created_date", 30)
    );

    Promise.all(queries).then(results => {
      const merged = results.flat();
      // Deduplicate by id, sort newest first
      const seen = new Set();
      const deduped = merged.filter(l => { if (seen.has(l.id)) return false; seen.add(l.id); return true; });
      deduped.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
      setLogs(deduped);
    }).finally(() => setLoading(false));
  }, [leadId, prospectId]);

  if (loading) return (
    <div className="space-y-2">
      {[1, 2].map(i => <div key={i} className="h-12 bg-slate-100 rounded-lg animate-pulse" />)}
    </div>
  );

  if (logs.length === 0) return (
    <div className="text-center py-6 text-slate-400 text-sm">
      <Clock className="w-6 h-6 mx-auto mb-2 text-slate-300" />
      Aucune activité enregistrée
    </div>
  );

  return (
    <div className="relative">
      {/* Timeline line */}
      <div className="absolute left-4 top-4 bottom-4 w-px bg-slate-100" />
      <div className="space-y-3">
        {logs.map((log) => {
          const config = ACTION_CONFIG[log.actionType] || { icon: RefreshCw, color: "text-slate-400", bg: "bg-slate-50 border-slate-100", label: log.actionType };
          const Icon = config.icon;
          const p = log.payload || {};

          // Build subtitle line
          const subtitleParts = [];
          if (p.channel) subtitleParts.push(CHANNEL_LABEL[p.channel] || p.channel);
          if (p.activeVersion === "EDITED") subtitleParts.push("✏️ personnalisé");
          if (p.messageCount) subtitleParts.push(`message #${p.messageCount}`);
          if (p.relevanceScore) subtitleParts.push(`score ${p.relevanceScore}`);
          if (p.segment) subtitleParts.push(p.segment === "HOT" ? "🔥 HOT" : "Standard");
          if (p.contactsFound > 0) subtitleParts.push(`${p.contactsFound} contact(s) identifié(s)`);
          if (p.status === "QUALIFIED") subtitleParts.push("→ Qualifié");
          if (p.status === "REJECTED") subtitleParts.push("→ Rejeté");

          return (
            <div key={log.id} className="flex gap-3 pl-1">
              {/* Icon dot */}
              <div className={`relative z-10 flex-shrink-0 w-7 h-7 rounded-full border flex items-center justify-center ${config.bg}`}>
                <Icon className={`w-3.5 h-3.5 ${config.color}`} />
              </div>
              {/* Content */}
              <div className="flex-1 min-w-0 pb-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-slate-800">{config.label}</span>
                    {subtitleParts.map((part, i) => (
                      <span key={i} className="text-xs px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">{part}</span>
                    ))}
                  </div>
                  <span className="text-xs text-slate-400 flex-shrink-0">
                    {format(new Date(log.created_date), "d MMM à HH:mm", { locale: fr })}
                  </span>
                </div>
                {p.bodyPreview && (
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2 italic">"{p.bodyPreview}"</p>
                )}
                {p.nextActionType && p.nextActionDueAt && (
                  <p className="text-xs text-blue-600 mt-0.5">
                    → {FOLLOWUP_LABEL[p.nextActionType] || p.nextActionType} planifiée le {format(new Date(p.nextActionDueAt), "d MMM yyyy", { locale: fr })}
                  </p>
                )}
                {p.note && <p className="text-xs text-slate-500 mt-0.5">{p.note}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}