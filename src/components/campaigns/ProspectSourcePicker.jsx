import { Database, Globe, Bot, ChevronRight } from "lucide-react";

const SOURCES = [
  {
    id: "KB_ONLY",
    icon: Database,
    iconColor: "text-blue-500",
    bgColor: "bg-blue-50",
    borderColor: "border-blue-200",
    selectedBg: "bg-blue-600",
    label: "Base existante",
    badge: "Rapide",
    badgeColor: "bg-blue-100 text-blue-700",
    description:
      "Utilise uniquement les données déjà présentes dans la base de connaissances. Mode rapide, économique et fiable si la base couvre bien la cible.",
  },
  {
    id: "WEB_ENRICHED",
    icon: Globe,
    iconColor: "text-emerald-500",
    bgColor: "bg-emerald-50",
    borderColor: "border-emerald-200",
    selectedBg: "bg-emerald-600",
    label: "Recherche web enrichie",
    badge: "Recommandé",
    badgeColor: "bg-emerald-100 text-emerald-700",
    description:
      "Recherche de nouveaux prospects sur le web, enrichit les résultats, applique le scoring, déduplique, puis sauvegarde les meilleurs dans la base.",
  },
  {
    id: "AUTONOMOUS_AGENT",
    icon: Bot,
    iconColor: "text-purple-500",
    bgColor: "bg-purple-50",
    borderColor: "border-purple-200",
    selectedBg: "bg-purple-600",
    label: "Agent autonome",
    badge: "Avancé",
    badgeColor: "bg-purple-100 text-purple-700",
    description:
      "Prépare une mission complète pour un Superagent : recherche, qualification, scoring, enrichissement, génération de messages et préparation de campagne.",
  },
];

export default function ProspectSourcePicker({ value, onChange }) {
  return (
    <div>
      <div className="text-sm font-medium text-slate-700 mb-1">Source de prospects</div>
      <p className="text-xs text-slate-400 mb-3">
        Choisissez comment les prospects seront découverts pour cette campagne.
      </p>
      <div className="space-y-2">
        {SOURCES.map((src) => {
          const Icon = src.icon;
          const isSelected = value === src.id;
          return (
            <button
              key={src.id}
              type="button"
              onClick={() => onChange(src.id)}
              className={`w-full text-left rounded-xl border-2 p-4 transition-all flex items-start gap-3 ${
                isSelected
                  ? `${src.borderColor} ${src.bgColor}`
                  : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              {/* Icon */}
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  isSelected ? src.bgColor : "bg-slate-100"
                }`}
              >
                <Icon className={`w-4.5 h-4.5 ${isSelected ? src.iconColor : "text-slate-400"}`} />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span
                    className={`text-sm font-semibold ${
                      isSelected ? "text-slate-900" : "text-slate-700"
                    }`}
                  >
                    {src.label}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${src.badgeColor}`}>
                    {src.badge}
                  </span>
                </div>
                <p className={`text-xs leading-relaxed ${isSelected ? "text-slate-600" : "text-slate-400"}`}>
                  {src.description}
                </p>
              </div>

              {/* Selected indicator */}
              <div className="flex-shrink-0 mt-1">
                <div
                  className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all ${
                    isSelected
                      ? `${src.selectedBg} border-transparent`
                      : "border-slate-300 bg-white"
                  }`}
                >
                  {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Agent mode notice */}
      {value === "AUTONOMOUS_AGENT" && (
        <div className="mt-3 flex items-start gap-2 p-3 bg-purple-50 border border-purple-100 rounded-lg">
          <Bot className="w-4 h-4 text-purple-500 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-purple-700">
            <strong>Mode Agent :</strong> une mission sera préparée automatiquement. L'agent travaillera
            de façon autonome et vous notifiera lorsque les résultats seront prêts. Les prospects générés
            apparaîtront dans cette campagne.
          </div>
        </div>
      )}
    </div>
  );
}