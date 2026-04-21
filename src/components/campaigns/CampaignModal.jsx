import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { X, Plus, Zap, Loader2, Database } from "lucide-react";

const LOCATIONS = [
  { value: "MONTREAL", label: "Montréal", query: "Montréal, QC" },
  { value: "QUEBEC_CITY", label: "Québec", query: "Québec, QC" },
  { value: "CANADA", label: "Canada", query: "Canada" },
];

const MAX_DISPLAYED_SECTORS = 12;

export default function CampaignModal({ open, onClose, onSave }) {
  const [form, setForm] = useState({
    name: "", targetCount: 50, industrySectors: [], companySize: "ALL",
    locationMode: "CITY", locationQuery: "Montréal, QC", locationKey: "MONTREAL", keywords: [],
    customSector: "", kbOnlyMode: false,
  });
  const [kwInput, setKwInput] = useState("");
  const [saving, setSaving] = useState(false);

  // Dynamic sector stats from KB
  const [sectorStats, setSectorStats] = useState([]);
  const [loadingSectors, setLoadingSectors] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestionsRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setLoadingSectors(true);
    base44.functions.invoke("getKbSectorStats", {}).then(res => {
      setSectorStats(res.data?.sectors || []);
    }).catch(() => {}).finally(() => setLoadingSectors(false));
  }, [open]);

  // Close suggestions on outside click
  useEffect(() => {
    const handler = (e) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const topSectors = sectorStats.slice(0, MAX_DISPLAYED_SECTORS);
  const topSectorNames = new Set(topSectors.map(s => s.name));
  const extraSectors = sectorStats.filter(s => !topSectorNames.has(s.name));

  // Filter suggestions for autocomplete
  const customVal = form.customSector.toLowerCase().trim();
  const filteredSuggestions = customVal.length > 0
    ? extraSectors.filter(s => s.name.toLowerCase().includes(customVal))
    : extraSectors;

  const toggleSector = (s) => {
    setForm(f => ({
      ...f,
      industrySectors: f.industrySectors.includes(s)
        ? f.industrySectors.filter(x => x !== s)
        : [...f.industrySectors, s],
    }));
  };

  const addKeyword = () => {
    const kw = kwInput.trim();
    if (kw && !form.keywords.includes(kw)) setForm(f => ({ ...f, keywords: [...f.keywords, kw] }));
    setKwInput("");
  };

  const selectSuggestion = (name) => {
    if (!form.industrySectors.includes(name)) {
      setForm(f => ({ ...f, industrySectors: [...f.industrySectors, name], customSector: "" }));
    }
    setShowSuggestions(false);
  };

  const handleSave = async (launch = false) => {
    if (!form.name || !form.locationQuery) return;
    setSaving(true);
    const sectors = [...form.industrySectors];
    if (form.customSector.trim() && !sectors.includes(form.customSector.trim())) {
      sectors.push(form.customSector.trim());
    }
    const payload = { ...form, industrySectors: sectors };
    delete payload.customSector;
    
    await onSave(payload, launch);
    
    setSaving(false);
    onClose();
    setForm({
      name: "", targetCount: 50, industrySectors: [], companySize: "ALL",
      locationMode: "CITY", locationQuery: "Montréal, QC", locationKey: "MONTREAL", keywords: [],
      customSector: "", kbOnlyMode: false,
    });
  };

  const selectedLocation = LOCATIONS.find(l => l.value === form.locationKey);
  const allSectors = [...form.industrySectors, ...(form.customSector.trim() ? [form.customSector.trim()] : [])];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nouvelle campagne de prospection</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Name */}
          <div>
            <Label>Nom de la campagne *</Label>
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Ex: Assurances QC Automne 2026" className="mt-1" />
          </div>

          {/* Location */}
          <div>
            <Label className="mb-2 block">Localisation *</Label>
            <div className="flex gap-2">
              {LOCATIONS.map(loc => (
                <button
                  key={loc.value}
                  type="button"
                  onClick={() => setForm(f => ({
                    ...f,
                    locationKey: loc.value,
                    locationQuery: loc.query,
                    locationMode: loc.value === "CANADA" ? "COUNTRY" : "CITY"
                  }))}
                  className={`flex-1 py-2.5 px-3 rounded-lg border text-sm font-medium transition-colors ${
                    form.locationKey === loc.value
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-slate-600 border-slate-200 hover:border-blue-300"
                  }`}
                >
                  {loc.label}
                </button>
              ))}
            </div>
          </div>

          {/* Sectors (dynamic from KB) */}
          <div>
            <Label className="mb-2 block">
              Secteur d'activité <span className="text-slate-400 font-normal text-xs">(optionnel — tous secteurs si aucun sélectionné)</span>
            </Label>
            {loadingSectors ? (
              <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Chargement des secteurs…
              </div>
            ) : (
              <TooltipProvider delayDuration={300}>
                <div className="flex flex-wrap gap-2 mb-2">
                  {topSectors.map(s => (
                    <Tooltip key={s.name}>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => toggleSector(s.name)}
                          className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                            form.industrySectors.includes(s.name)
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-white text-slate-600 border-slate-200 hover:border-blue-300"
                          }`}
                        >
                          {s.name} <span className={`ml-0.5 ${form.industrySectors.includes(s.name) ? "text-blue-200" : "text-slate-400"}`}>({s.count})</span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">
                        {s.count} entreprises dans la base de connaissances
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </TooltipProvider>
            )}

            {/* Custom sector with autocomplete */}
            <div className="relative mt-2" ref={suggestionsRef}>
              <div className="flex gap-2">
              <Input
                value={form.customSector}
                onChange={e => {
                  setForm(f => ({ ...f, customSector: e.target.value }));
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    const val = form.customSector.trim();
                    if (val && !form.industrySectors.includes(val)) {
                      selectSuggestion(val);
                    }
                  }
                }}
                placeholder="Secteur libre (ex: agroalimentaire, médias…)"
                className="text-sm"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const val = form.customSector.trim();
                  if (val && !form.industrySectors.includes(val)) {
                    selectSuggestion(val);
                  }
                }}
              >
                <Plus className="w-4 h-4" />
              </Button>
              </div>
              {showSuggestions && filteredSuggestions.length > 0 && (
                <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                  {filteredSuggestions.map(s => (
                    <button
                      key={s.name}
                      onClick={() => selectSuggestion(s.name)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center justify-between"
                    >
                      <span>{s.name}</span>
                      <span className="text-xs text-slate-400">{s.count}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Objectif prospects</Label>
              <Select value={String(form.targetCount)} onValueChange={v => setForm(f => ({ ...f, targetCount: Number(v) }))}>
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
              <Select value={form.companySize} onValueChange={v => setForm(f => ({ ...f, companySize: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Toutes tailles</SelectItem>
                  <SelectItem value="SMALL">Petite (1-50)</SelectItem>
                  <SelectItem value="MID">Moyenne (50-500)</SelectItem>
                  <SelectItem value="LARGE">Grande (500+)</SelectItem>
                  <SelectItem value="ENTERPRISE">Entreprise (1000+)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* KB Only Mode */}
          <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-100 rounded-lg">
            <Checkbox
              id="kbOnly"
              checked={form.kbOnlyMode}
              onCheckedChange={(checked) => setForm(f => ({ ...f, kbOnlyMode: checked === true }))}
              className="mt-0.5"
            />
            <label htmlFor="kbOnly" className="cursor-pointer">
              <div className="text-sm font-medium text-blue-800 flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5" />
                Recherche rapide (base de connaissances uniquement)
              </div>
              <p className="text-xs text-blue-600 mt-0.5">
                N'utilise que la KB interne — plus rapide, sans appels web. Idéal si la KB couvre bien le secteur ciblé.
              </p>
            </label>
          </div>

          {/* Keywords */}
          <div>
            <Label>Mots-clés additionnels</Label>
            <div className="flex gap-2 mt-1">
              <Input value={kwInput} onChange={e => setKwInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addKeyword()}
                placeholder="Ex: conférence annuelle, gala" />
              <Button type="button" variant="outline" size="sm" onClick={addKeyword}><Plus className="w-4 h-4" /></Button>
            </div>
            {form.keywords.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {form.keywords.map(k => (
                  <span key={k} className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 rounded text-xs">
                    {k}
                    <button onClick={() => setForm(f => ({ ...f, keywords: f.keywords.filter(x => x !== k) }))}><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Criteria recap */}
          {form.name && (
            <div className="bg-slate-50 rounded-xl border p-3 text-xs text-slate-600 space-y-1">
              <div className="font-semibold text-slate-700 mb-1">Récapitulatif</div>
              <div>📍 <strong>Lieu :</strong> {selectedLocation?.label || form.locationQuery}</div>
              {allSectors.length > 0 && <div>🏢 <strong>Secteur :</strong> {allSectors.join(", ")}</div>}
              {form.keywords.length > 0 && <div>🔑 <strong>Mots-clés :</strong> {form.keywords.join(", ")}</div>}
              <div>🎯 <strong>Objectif :</strong> {form.targetCount} prospects</div>
              {form.kbOnlyMode && (
                <div className="flex items-center gap-1 text-blue-600">
                  <Database className="w-3 h-3" /> <strong>Mode KB uniquement</strong>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button variant="outline" onClick={() => handleSave(false)} disabled={saving || !form.name || !form.locationQuery}>
            {saving ? "Création..." : "Brouillon"}
          </Button>
          <Button onClick={() => handleSave(true)} disabled={saving || !form.name || !form.locationQuery} className="bg-blue-600 hover:bg-blue-700">
            {saving ? "Lancement..." : "Créer et lancer →"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}