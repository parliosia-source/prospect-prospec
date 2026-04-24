import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Plus, Database, Globe, Bot, MapPin, ChevronDown, ChevronUp, Sparkles, AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  GEO_PRESETS,
  INDUSTRY_CATALOG,
  buildStructuredQueries,
  computePrecisionScore,
} from "@/lib/searchQueryBuilder";

const SOURCE_MODES = [
  {
    value: "KB_ONLY",
    icon: Database,
    title: "Base existante",
    desc: "Utilise uniquement la base de connaissances interne. Rapide, économique, sans appels web.",
    color: "blue",
  },
  {
    value: "WEB_ENRICHED",
    icon: Globe,
    title: "Recherche web enrichie",
    desc: "Recherche sur le web, enrichit les résultats, applique le scoring et déduplique.",
    color: "green",
  },
  {
    value: "AGENT",
    icon: Bot,
    title: "Superagent autonome",
    desc: "Prépare une mission pour un Superagent Base44 externe à l'app.",
    color: "purple",
  },
];

const RADIUS_OPTIONS = [5, 10, 20, 50, 100, 200];

function PrecisionBadge({ form }) {
  const precision = computePrecisionScore(form);
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${precision.color}`}>
      {precision.label === "Bon" && <CheckCircle2 className="w-3 h-3" />}
      {precision.label !== "Bon" && <AlertTriangle className="w-3 h-3" />}
      Précision : {precision.label}
    </span>
  );
}

const EMPTY_FORM = {
  name: "",
  targetCount: 50,
  companySize: "ALL",
  sourceMode: "WEB_ENRICHED",
  agentBrief: "",
  targetCountry: "",
  targetRegion: "",
  targetCity: "",
  searchRadiusKm: null,
  rawLocationInput: "",
  industryCategory: "",
  industrySubcategory: "",
  rawIndustryInput: "",
  keywords: [],
  extraExcludedDomains: [],
};

export default function CampaignModal({ open, onClose, onSave }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [kwInput, setKwInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [tenantGeos, setTenantGeos] = useState([]);

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));

  useEffect(() => {
    if (!open) return;
    base44.entities.TenantSettings.filter({ settingsId: "global" }).then(tenants => {
      const tenant = tenants[0];
      setTenantGeos(tenant?.targetGeographies || []);
    }).catch(() => {});
  }, [open]);

  const generatedQueries = buildStructuredQueries(form);

  const subcategories = form.industryCategory
    ? (INDUSTRY_CATALOG[form.industryCategory]?.subcategories || [])
    : [];

  const selectGeoPreset = (preset) => {
    setForm(f => ({
      ...f,
      targetCountry: preset.country,
      targetRegion: preset.region,
      targetCity: preset.city,
      rawLocationInput: preset.label,
    }));
  };

  const addKeyword = () => {
    const kw = kwInput.trim();
    if (kw && !form.keywords.includes(kw)) set("keywords", [...form.keywords, kw]);
    setKwInput("");
  };

  const handleSave = async (launch = false) => {
    if (!form.name || (!form.targetCity && !form.targetRegion && !form.targetCountry && !form.rawLocationInput)) return;
    setSaving(true);

    const locationQuery = form.targetCity
      ? `${form.targetCity}${form.targetRegion ? ", " + form.targetRegion : ""}`
      : form.targetRegion || form.targetCountry || form.rawLocationInput;

    const industrySectors = form.industryCategory
      ? [form.industryCategory, ...(form.industrySubcategory ? [form.industrySubcategory] : [])]
      : (form.rawIndustryInput ? [form.rawIndustryInput] : []);

    const payload = {
      name: form.name,
      targetCount: form.targetCount,
      companySize: form.companySize,
      sourceMode: form.sourceMode,
      agentBrief: form.agentBrief,
      locationQuery,
      locationMode: form.targetCity ? "CITY" : form.targetRegion ? "REGION" : "COUNTRY",
      targetCountry: form.targetCountry,
      targetRegion: form.targetRegion,
      targetCity: form.targetCity,
      searchRadiusKm: form.searchRadiusKm,
      rawLocationInput: form.rawLocationInput,
      industrySectors,
      industryCategory: form.industryCategory,
      industrySubcategory: form.industrySubcategory,
      rawIndustryInput: form.rawIndustryInput,
      searchIntent: generatedQueries[0] || "",
      keywords: form.keywords,
      kbOnlyMode: form.sourceMode === "KB_ONLY",
    };

    await onSave(payload, launch);
    setSaving(false);
    onClose();
    setForm(EMPTY_FORM);
    setShowAdvanced(false);
    setKwInput("");
  };

  const hasGeo = form.targetCity || form.targetRegion || form.targetCountry || form.rawLocationInput;
  const canSave = form.name && hasGeo;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>Nouvelle campagne de prospection</DialogTitle>
            {form.name && <PrecisionBadge form={form} />}
          </div>
        </DialogHeader>

        <div className="space-y-6 py-2">

          {/* Nom */}
          <div>
            <Label>Nom de la campagne *</Label>
            <Input
              value={form.name}
              onChange={e => set("name", e.target.value)}
              placeholder="Ex: Agences marketing Montréal Q3 2026"
              className="mt-1"
            />
          </div>

          {/* Localisation structurée */}
          <div>
            <Label className="flex items-center gap-1.5 mb-2">
              <MapPin className="w-3.5 h-3.5 text-slate-400" /> Localisation *
            </Label>

            <div className="mb-3">
              <p className="text-xs text-slate-400 mb-1.5">Sélectionner une zone prédéfinie :</p>
              <div className="flex flex-wrap gap-1.5">
                {GEO_PRESETS.map(preset => {
                  const active = form.targetCity === preset.city && form.targetCountry === preset.country;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => selectGeoPreset(preset)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        active
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-slate-600 border-slate-200 hover:border-blue-300"
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Pays</label>
                <Input value={form.targetCountry} onChange={e => set("targetCountry", e.target.value)} placeholder="Ex: France" className="text-sm" />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Région / Province</label>
                <Input value={form.targetRegion} onChange={e => set("targetRegion", e.target.value)} placeholder="Ex: Île-de-France" className="text-sm" />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Ville</label>
                <Input value={form.targetCity} onChange={e => set("targetCity", e.target.value)} placeholder="Ex: Paris" className="text-sm" />
              </div>
            </div>

            {form.targetCity && (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <label className="text-xs text-slate-500 whitespace-nowrap">Rayon :</label>
                {[null, ...RADIUS_OPTIONS].map(r => (
                  <button
                    key={r ?? "ville"}
                    type="button"
                    onClick={() => set("searchRadiusKm", r)}
                    className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                      form.searchRadiusKm === r
                        ? "bg-slate-700 text-white border-slate-700"
                        : "bg-white text-slate-500 border-slate-200 hover:border-slate-400"
                    }`}
                  >
                    {r ? `${r} km` : "Ville seule"}
                  </button>
                ))}
              </div>
            )}

            {tenantGeos.length > 0 && (
              <div className="mt-2 flex gap-1.5 flex-wrap items-center">
                <span className="text-xs text-slate-400">Zones favorites :</span>
                {tenantGeos.map(geo => (
                  <button
                    key={geo}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, rawLocationInput: geo, targetCity: geo }))}
                    className="text-xs px-2 py-0.5 rounded-full border border-dashed border-slate-300 text-slate-500 hover:border-blue-300 hover:text-blue-600"
                  >
                    {geo}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Secteur structuré */}
          <div>
            <Label className="mb-2 block">Secteur d'activité</Label>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {Object.keys(INDUSTRY_CATALOG).map(cat => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => {
                    set("industryCategory", form.industryCategory === cat ? "" : cat);
                    set("industrySubcategory", "");
                  }}
                  className={`text-xs px-2.5 py-2 rounded-lg border text-left transition-colors leading-tight ${
                    form.industryCategory === cat
                      ? "bg-blue-600 text-white border-blue-600 font-semibold"
                      : "bg-white text-slate-600 border-slate-200 hover:border-blue-300"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {subcategories.length > 0 && (
              <div className="mt-3">
                <label className="text-xs text-slate-500 mb-1.5 block">
                  Sous-catégorie <span className="text-slate-400">(optionnel)</span>
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {subcategories.map(sub => (
                    <button
                      key={sub}
                      type="button"
                      onClick={() => set("industrySubcategory", form.industrySubcategory === sub ? "" : sub)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        form.industrySubcategory === sub
                          ? "bg-blue-100 text-blue-700 border-blue-400 font-semibold"
                          : "bg-white text-slate-600 border-slate-200 hover:border-blue-300"
                      }`}
                    >
                      {sub}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Paramètres */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Objectif prospects</Label>
              <Select value={String(form.targetCount)} onValueChange={v => set("targetCount", Number(v))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="25">25 prospects</SelectItem>
                  <SelectItem value="50">50 prospects</SelectItem>
                  <SelectItem value="100">100 prospects</SelectItem>
                  <SelectItem value="150">150 prospects</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Taille d'entreprise</Label>
              <Select value={form.companySize} onValueChange={v => set("companySize", v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Toutes tailles</SelectItem>
                  <SelectItem value="SMALL">Petite (1–50)</SelectItem>
                  <SelectItem value="MID">Moyenne (50–500)</SelectItem>
                  <SelectItem value="LARGE">Grande (500+)</SelectItem>
                  <SelectItem value="ENTERPRISE">Entreprise (1000+)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Source */}
          <div>
            <Label className="mb-2 block">Source de prospects</Label>
            <div className="grid grid-cols-1 gap-2">
              {SOURCE_MODES.map(({ value, icon: Icon, title, desc, color }) => {
                const active = form.sourceMode === value;
                const colorMap = {
                  blue: { border: "border-blue-500 bg-blue-50", icon: "text-blue-500", title: "text-blue-800" },
                  green: { border: "border-green-500 bg-green-50", icon: "text-green-500", title: "text-green-800" },
                  purple: { border: "border-purple-500 bg-purple-50", icon: "text-purple-500", title: "text-purple-800" },
                };
                const c = colorMap[color];
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => set("sourceMode", value)}
                    className={`flex items-start gap-3 p-3 rounded-xl border-2 text-left transition-all ${
                      active ? c.border : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${active ? c.icon : "text-slate-400"}`} />
                    <div className="flex-1">
                      <div className={`text-sm font-semibold ${active ? c.title : "text-slate-700"}`}>{title}</div>
                      <div className={`text-xs mt-0.5 ${active ? "text-slate-600" : "text-slate-400"}`}>{desc}</div>
                    </div>
                    <div className={`ml-auto flex-shrink-0 w-4 h-4 rounded-full border-2 mt-0.5 ${
                      active ? "bg-current border-current opacity-80" : "border-slate-300"
                    }`} />
                  </button>
                );
              })}
            </div>
            {form.sourceMode === "AGENT" && (
              <div className="mt-3">
                <Label className="text-xs text-slate-600 mb-1 block">Brief de mission pour le Superagent Base44</Label>
                <textarea
                  value={form.agentBrief}
                  onChange={e => set("agentBrief", e.target.value)}
                  rows={3}
                  placeholder="Ex: Trouve 50 PME dans le secteur financier à Toronto, avec un budget événementiel probable."
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300 resize-none"
                />
              </div>
            )}
          </div>

          {/* Mode avancé */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(v => !v)}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors"
            >
              {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              Mode avancé (mots-clés libres, localisation personnalisée)
            </button>

            {showAdvanced && (
              <div className="mt-3 space-y-3 pl-4 border-l-2 border-slate-100">
                <div>
                  <Label className="text-xs">Localisation personnalisée</Label>
                  <Input
                    value={form.rawLocationInput}
                    onChange={e => setForm(f => ({ ...f, rawLocationInput: e.target.value, targetCity: "", targetRegion: "", targetCountry: "" }))}
                    placeholder="Ex: Grand Paris, Suisse romande…"
                    className="mt-1 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs">Secteur libre <span className="text-slate-400">(si aucune catégorie sélectionnée)</span></Label>
                  <Input
                    value={form.rawIndustryInput}
                    onChange={e => set("rawIndustryInput", e.target.value)}
                    placeholder="Ex: agroalimentaire bio, fintech…"
                    className="mt-1 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs">Mots-clés additionnels</Label>
                  <div className="flex gap-2 mt-1">
                    <Input
                      value={kwInput}
                      onChange={e => setKwInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && addKeyword()}
                      placeholder="Ex: gala annuel, séminaire"
                      className="text-sm"
                    />
                    <Button type="button" variant="outline" size="sm" onClick={addKeyword}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                  {form.keywords.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {form.keywords.map(k => (
                        <span key={k} className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 rounded text-xs">
                          {k}
                          <button onClick={() => set("keywords", form.keywords.filter(x => x !== k))}>
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Aperçu requêtes */}
          {generatedQueries.length > 0 && (
            <div className="bg-slate-900 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                <span className="text-xs font-mono text-slate-300">Requêtes générées ({generatedQueries.length})</span>
                {form.name && <PrecisionBadge form={form} />}
              </div>
              <div className="space-y-1">
                {generatedQueries.map((q, i) => (
                  <div key={i} className="font-mono text-xs text-green-300 bg-slate-800 rounded px-2 py-1 truncate" title={q}>
                    {i + 1}. {q}
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-500 mt-2">
                Excluent automatiquement Wikipedia, Pages Jaunes et annuaires génériques.
              </p>
            </div>
          )}

          {/* Récapitulatif */}
          {form.name && hasGeo && (
            <div className="bg-slate-50 rounded-xl border p-3 text-xs text-slate-600 space-y-1">
              <div className="font-semibold text-slate-700 mb-1">Récapitulatif</div>
              {form.targetCity && <div>📍 <strong>Ville :</strong> {form.targetCity}{form.targetRegion ? `, ${form.targetRegion}` : ""}{form.targetCountry ? ` (${form.targetCountry})` : ""}{form.searchRadiusKm ? ` • rayon ${form.searchRadiusKm} km` : ""}</div>}
              {!form.targetCity && form.targetRegion && <div>📍 <strong>Région :</strong> {form.targetRegion}{form.targetCountry ? `, ${form.targetCountry}` : ""}</div>}
              {!form.targetCity && !form.targetRegion && form.targetCountry && <div>📍 <strong>Pays :</strong> {form.targetCountry}</div>}
              {form.industryCategory && <div>🏢 <strong>Secteur :</strong> {form.industryCategory}{form.industrySubcategory ? ` › ${form.industrySubcategory}` : ""}</div>}
              {!form.industryCategory && form.rawIndustryInput && <div>🏢 <strong>Secteur libre :</strong> {form.rawIndustryInput}</div>}
              {form.keywords.length > 0 && <div>🔑 <strong>Mots-clés :</strong> {form.keywords.join(", ")}</div>}
              <div>🎯 <strong>Objectif :</strong> {form.targetCount} prospects</div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button variant="outline" onClick={() => handleSave(false)} disabled={saving || !canSave}>
            {saving ? "Création…" : "Brouillon"}
          </Button>
          <Button onClick={() => handleSave(true)} disabled={saving || !canSave} className="bg-blue-600 hover:bg-blue-700">
            {saving ? "Lancement…" : "Créer et lancer →"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}