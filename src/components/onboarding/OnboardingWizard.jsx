import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Zap, ChevronRight, Check } from "lucide-react";

const STEPS = [
  { id: 1, label: "Votre entreprise" },
  { id: 2, label: "Votre marché" },
  { id: 3, label: "Prospection" },
];

export default function OnboardingWizard({ onComplete }) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    companyName: "",
    serviceOffering: "",
    targetMarket: "",
    defaultCity: "",
    defaultCountry: "CA",
    defaultLanguage: "FR_CA",
    messageTone: "PROFESSIONNEL",
    industryProfile: "",
    targetGeographies: "",
    searchKeywords: "",
    excludedKeywords: "",
    fitThresholdDefault: "",
    senderTitle: "",
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleFinish = async () => {
    setSaving(true);
    const geographies = form.targetGeographies.split("\n").map(s => s.trim()).filter(Boolean);
    const searchKws = form.searchKeywords.split(",").map(s => s.trim()).filter(Boolean);
    const excludedKws = form.excludedKeywords.split(",").map(s => s.trim()).filter(Boolean);

    const payload = {
      settingsId: "global",
      tenantId: "sync-default",
      companyName: form.companyName,
      serviceOffering: form.serviceOffering,
      targetMarket: form.targetMarket,
      defaultCity: form.defaultCity,
      defaultCountry: form.defaultCountry,
      defaultLanguage: form.defaultLanguage,
      messageTone: form.messageTone,
      senderTitle: form.senderTitle,
      industryProfile: form.industryProfile,
      targetGeographies: geographies,
      searchKeywords: searchKws,
      excludedKeywords: excludedKws,
      fitThresholdDefault: form.fitThresholdDefault ? Number(form.fitThresholdDefault) : null,
      isActive: true,
      scoringMode: "RULES",
    };

    const existing = await base44.entities.TenantSettings.filter({ settingsId: "global" });
    if (existing.length > 0) {
      await base44.entities.TenantSettings.update(existing[0].id, payload);
    } else {
      await base44.entities.TenantSettings.create(payload);
    }
    setSaving(false);
    onComplete();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-slate-800">Configuration initiale</span>
          </div>
          {/* Steps */}
          <div className="flex items-center gap-2">
            {STEPS.map((s, i) => (
              <div key={s.id} className="flex items-center gap-2 flex-1">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                  step > s.id ? "bg-green-500 text-white" : step === s.id ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-400"
                }`}>
                  {step > s.id ? <Check className="w-3.5 h-3.5" /> : s.id}
                </div>
                <span className={`text-xs font-medium truncate ${step === s.id ? "text-slate-800" : "text-slate-400"}`}>{s.label}</span>
                {i < STEPS.length - 1 && <div className="flex-1 h-px bg-slate-200 mx-1" />}
              </div>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4 min-h-[280px]">
          {step === 1 && (
            <>
              <div>
                <Label className="text-sm font-medium">Nom de l'entreprise *</Label>
                <Input value={form.companyName} onChange={e => set("companyName", e.target.value)}
                  placeholder="Ex: Acme Solutions Inc." className="mt-1" />
              </div>
              <div>
                <Label className="text-sm font-medium">Ce que vous vendez</Label>
                <p className="text-xs text-slate-400 mb-1">Décrivez votre offre en une phrase</p>
                <Input value={form.serviceOffering} onChange={e => set("serviceOffering", e.target.value)}
                  placeholder="Ex: Logiciel de gestion RH pour PME" className="mt-1" />
              </div>
              <div>
                <Label className="text-sm font-medium">Titre de l'expéditeur</Label>
                <p className="text-xs text-slate-400 mb-1">Utilisé dans les messages générés</p>
                <Input value={form.senderTitle} onChange={e => set("senderTitle", e.target.value)}
                  placeholder="Ex: Directeur Développement des affaires" className="mt-1" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm font-medium">Ton des messages</Label>
                  <Select value={form.messageTone} onValueChange={v => set("messageTone", v)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PROFESSIONNEL">Professionnel</SelectItem>
                      <SelectItem value="CHALEUREUX">Chaleureux</SelectItem>
                      <SelectItem value="DIRECT">Direct</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-sm font-medium">Langue</Label>
                  <Select value={form.defaultLanguage} onValueChange={v => set("defaultLanguage", v)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FR_CA">Français (CA)</SelectItem>
                      <SelectItem value="EN_CA">Anglais (CA)</SelectItem>
                      <SelectItem value="EN_US">Anglais (US)</SelectItem>
                      <SelectItem value="FR_FR">Français (FR)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div>
                <Label className="text-sm font-medium">Votre client idéal (ICP)</Label>
                <p className="text-xs text-slate-400 mb-1">Décrivez le profil type de vos prospects</p>
                <Textarea value={form.targetMarket} onChange={e => set("targetMarket", e.target.value)}
                  placeholder="Ex: PME de 50-500 employés dans les secteurs RH et finance, qui organisent des événements internes…"
                  className="mt-1 h-24 text-sm" />
              </div>
              <div>
                <Label className="text-sm font-medium">Profil sectoriel</Label>
                <p className="text-xs text-slate-400 mb-1">Industries ou secteurs prioritaires</p>
                <Input value={form.industryProfile} onChange={e => set("industryProfile", e.target.value)}
                  placeholder="Ex: Finance, Assurance, Technologies, Immobilier" className="mt-1" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm font-medium">Ville principale</Label>
                  <Input value={form.defaultCity} onChange={e => set("defaultCity", e.target.value)}
                    placeholder="Ex: Montréal" className="mt-1" />
                </div>
                <div>
                  <Label className="text-sm font-medium">Pays</Label>
                  <Select value={form.defaultCountry} onValueChange={v => set("defaultCountry", v)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CA">Canada</SelectItem>
                      <SelectItem value="US">États-Unis</SelectItem>
                      <SelectItem value="FR">France</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-sm font-medium">Zones géographiques cibles</Label>
                <p className="text-xs text-slate-400 mb-1">Une par ligne</p>
                <Textarea value={form.targetGeographies} onChange={e => set("targetGeographies", e.target.value)}
                  placeholder={"Montréal, QC\nToronto, ON\nVancouver, BC"}
                  className="mt-1 h-20 text-sm font-mono" />
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div>
                <Label className="text-sm font-medium">Mots-clés de recherche</Label>
                <p className="text-xs text-slate-400 mb-1">Séparés par des virgules — utilisés dans les recherches web</p>
                <Input value={form.searchKeywords} onChange={e => set("searchKeywords", e.target.value)}
                  placeholder="Ex: événement corporatif, conférence annuelle, gala" className="mt-1" />
              </div>
              <div>
                <Label className="text-sm font-medium">Mots-clés à exclure</Label>
                <p className="text-xs text-slate-400 mb-1">Prospects à ignorer automatiquement</p>
                <Input value={form.excludedKeywords} onChange={e => set("excludedKeywords", e.target.value)}
                  placeholder="Ex: gouvernement, université, hôpital" className="mt-1" />
              </div>
              <div>
                <Label className="text-sm font-medium">Seuil de pertinence minimum</Label>
                <p className="text-xs text-slate-400 mb-1">Score minimum pour inclure un prospect (0 = aucun filtre, 60 = recommandé)</p>
                <Input type="number" value={form.fitThresholdDefault} onChange={e => set("fitThresholdDefault", e.target.value)}
                  placeholder="0" className="mt-1 w-28" />
              </div>
              <div className="mt-3 p-3 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-700">
                ✓ Vous pourrez modifier tous ces réglages à tout moment dans <strong>Admin → Configuration</strong>.
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => step > 1 ? setStep(s => s - 1) : null}
            className={`text-slate-500 ${step === 1 ? "invisible" : ""}`}>
            ← Retour
          </Button>
          <div className="flex gap-2">
            {step < 3 ? (
              <Button onClick={() => setStep(s => s + 1)} className="bg-blue-600 hover:bg-blue-700 gap-1.5"
                disabled={step === 1 && !form.companyName.trim()}>
                Suivant <ChevronRight className="w-4 h-4" />
              </Button>
            ) : (
              <Button onClick={handleFinish} disabled={saving} className="bg-green-600 hover:bg-green-700 gap-1.5">
                {saving ? "Enregistrement…" : "Terminer la configuration ✓"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}