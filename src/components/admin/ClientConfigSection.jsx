import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, Save, ChevronDown, ChevronUp } from "lucide-react";

function FieldRow({ label, hint, children }) {
  return (
    <div>
      <Label className="text-sm font-medium text-slate-700">{label}</Label>
      {hint && <p className="text-xs text-slate-400 mb-1">{hint}</p>}
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Section({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white rounded-xl border">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-left"
      >
        <span className="font-semibold text-slate-800 text-sm">{title}</span>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>
      {open && <div className="px-5 pb-5 space-y-4 border-t pt-4">{children}</div>}
    </div>
  );
}

export default function ClientConfigSection() {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const data = await base44.entities.TenantSettings.filter({ settingsId: "global" });
    if (data.length > 0) {
      const t = data[0];
      setForm({
        ...t,
        _targetGeographiesText: (t.targetGeographies || []).join("\n"),
        _searchKeywordsText: (t.searchKeywords || []).join(", "),
        _excludedKeywordsText: (t.excludedKeywords || []).join(", "),
        _scoringWeightsText: t.scoringWeights ? JSON.stringify(t.scoringWeights, null, 2) : "",
      });
    } else {
      setForm({
        settingsId: "global",
        tenantId: "sync-default",
        companyName: "",
        companyTagline: "",
        serviceOffering: "",
        targetMarket: "",
        industryProfile: "",
        defaultCity: "",
        defaultCountry: "CA",
        defaultLanguage: "FR_CA",
        messageTone: "PROFESSIONNEL",
        senderTitle: "",
        targetGeographies: [],
        searchKeywords: [],
        excludedKeywords: [],
        fitThresholdDefault: null,
        scoringMode: "RULES",
        scoringWeights: null,
        botUserAgent: "ProspectBot/1.0",
        isActive: true,
        _targetGeographiesText: "",
        _searchKeywordsText: "",
        _excludedKeywordsText: "",
        _scoringWeightsText: "",
      });
    }
  };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    const payload = {
      ...form,
      targetGeographies: form._targetGeographiesText.split("\n").map(s => s.trim()).filter(Boolean),
      searchKeywords: form._searchKeywordsText.split(",").map(s => s.trim()).filter(Boolean),
      excludedKeywords: form._excludedKeywordsText.split(",").map(s => s.trim()).filter(Boolean),
      fitThresholdDefault: form.fitThresholdDefault !== "" && form.fitThresholdDefault != null ? Number(form.fitThresholdDefault) : null,
    };
    // Clean internal UI fields
    delete payload._targetGeographiesText;
    delete payload._searchKeywordsText;
    delete payload._excludedKeywordsText;
    delete payload._scoringWeightsText;

    if (form._scoringWeightsText) {
      try { payload.scoringWeights = JSON.parse(form._scoringWeightsText); } catch (_) {}
    }

    if (form.id) {
      await base44.entities.TenantSettings.update(form.id, payload);
    } else {
      const created = await base44.entities.TenantSettings.create(payload);
      setForm(f => ({ ...f, id: created.id }));
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  if (!form) return <div className="text-center py-10 text-slate-400 text-sm">Chargement…</div>;

  return (
    <div className="space-y-4 max-w-2xl">

      {/* A. Profil entreprise */}
      <Section title="A. Profil entreprise">
        <FieldRow label="Nom de l'entreprise" hint="Affiché dans les messages et l'interface">
          <Input value={form.companyName || ""} onChange={e => set("companyName", e.target.value)} placeholder="Acme Solutions Inc." />
        </FieldRow>
        <FieldRow label="Tagline" hint="Courte accroche optionnelle">
          <Input value={form.companyTagline || ""} onChange={e => set("companyTagline", e.target.value)} placeholder="Ex: Votre partenaire en développement des affaires" />
        </FieldRow>
        <FieldRow label="Ce que vous vendez" hint="Décrivez votre offre en une phrase">
          <Input value={form.serviceOffering || ""} onChange={e => set("serviceOffering", e.target.value)} placeholder="Ex: Logiciel de gestion RH pour PME" />
        </FieldRow>
        <FieldRow label="Votre client idéal" hint="Décrivez le profil type de vos prospects">
          <Textarea value={form.targetMarket || ""} onChange={e => set("targetMarket", e.target.value)}
            className="h-20 text-sm" placeholder="Ex: PME 50-500 employés dans les secteurs RH et finance…" />
        </FieldRow>
        <FieldRow label="Profil sectoriel" hint="Industries ou secteurs prioritaires ciblés">
          <Textarea value={form.industryProfile || ""} onChange={e => set("industryProfile", e.target.value)}
            className="h-16 text-sm" placeholder="Ex: Finance, Assurance, Technologies, Immobilier" />
        </FieldRow>
      </Section>

      {/* B. Localisation et langue */}
      <Section title="B. Localisation et langue">
        <div className="grid grid-cols-2 gap-4">
          <FieldRow label="Ville principale">
            <Input value={form.defaultCity || ""} onChange={e => set("defaultCity", e.target.value)} placeholder="Ex: Montréal" />
          </FieldRow>
          <FieldRow label="Pays">
            <Select value={form.defaultCountry || "CA"} onValueChange={v => set("defaultCountry", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="CA">Canada</SelectItem>
                <SelectItem value="US">États-Unis</SelectItem>
                <SelectItem value="FR">France</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>
        </div>
        <FieldRow label="Langue par défaut">
          <Select value={form.defaultLanguage || "FR_CA"} onValueChange={v => set("defaultLanguage", v)}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="FR_CA">Français (Canada)</SelectItem>
              <SelectItem value="EN_CA">Anglais (Canada)</SelectItem>
              <SelectItem value="EN_US">Anglais (États-Unis)</SelectItem>
              <SelectItem value="FR_FR">Français (France)</SelectItem>
            </SelectContent>
          </Select>
        </FieldRow>
        <FieldRow label="Zones géographiques cibles" hint="Une zone par ligne — utilisées comme point de départ des recherches">
          <Textarea value={form._targetGeographiesText || ""} onChange={e => set("_targetGeographiesText", e.target.value)}
            className="h-24 text-sm font-mono" placeholder={"Montréal, QC\nToronto, ON\nVancouver, BC"} />
        </FieldRow>
      </Section>

      {/* C. Prospection */}
      <Section title="C. Prospection">
        <FieldRow label="Mots-clés de recherche" hint="Séparés par virgule — injectés dans les requêtes web">
          <Input value={form._searchKeywordsText || ""} onChange={e => set("_searchKeywordsText", e.target.value)}
            placeholder="Ex: événement corporatif, conférence annuelle" />
        </FieldRow>
        <FieldRow label="Mots-clés à exclure" hint="Prospects contenant ces termes seront ignorés">
          <Input value={form._excludedKeywordsText || ""} onChange={e => set("_excludedKeywordsText", e.target.value)}
            placeholder="Ex: gouvernement, université, hôpital" />
        </FieldRow>
        <FieldRow label="Seuil de pertinence minimum" hint="Score minimum pour inclure un prospect (0 = aucun filtre)">
          <Input type="number" value={form.fitThresholdDefault ?? ""} onChange={e => set("fitThresholdDefault", e.target.value)}
            className="w-28" placeholder="0" />
        </FieldRow>
      </Section>

      {/* D. Messages IA */}
      <Section title="D. Messages IA">
        <FieldRow label="Titre de l'expéditeur" hint="Utilisé dans les messages générés par IA">
          <Input value={form.senderTitle || ""} onChange={e => set("senderTitle", e.target.value)}
            placeholder="Ex: Directeur Développement des affaires" />
        </FieldRow>
        <FieldRow label="Ton des messages">
          <Select value={form.messageTone || "PROFESSIONNEL"} onValueChange={v => set("messageTone", v)}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="PROFESSIONNEL">Professionnel</SelectItem>
              <SelectItem value="CHALEUREUX">Chaleureux</SelectItem>
              <SelectItem value="DIRECT">Direct</SelectItem>
            </SelectContent>
          </Select>
        </FieldRow>
      </Section>

      {/* E. Avancé */}
      <Section title="E. Avancé" defaultOpen={false}>
        <FieldRow label="Mode de scoring">
          <Select value={form.scoringMode || "RULES"} onValueChange={v => set("scoringMode", v)}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="RULES">Par règles (recommandé)</SelectItem>
              <SelectItem value="AI">IA générique</SelectItem>
            </SelectContent>
          </Select>
        </FieldRow>
        <FieldRow label="Poids de scoring personnalisés" hint="JSON optionnel — laissez vide pour utiliser les poids par défaut">
          <Textarea value={form._scoringWeightsText || ""} onChange={e => set("_scoringWeightsText", e.target.value)}
            className="h-24 text-xs font-mono" placeholder={'{\n  "geo": 30,\n  "sector": 25,\n  "keyword": 20\n}'} />
        </FieldRow>
        <FieldRow label="User-Agent du bot" hint="Identifiant envoyé lors du crawling">
          <Input value={form.botUserAgent || ""} onChange={e => set("botUserAgent", e.target.value)}
            placeholder="ProspectBot/1.0" className="font-mono text-sm" />
        </FieldRow>
      </Section>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700 gap-2">
          {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Enregistrer la configuration
        </Button>
        {saved && <span className="text-sm text-green-600 font-medium">✓ Enregistré</span>}
      </div>
    </div>
  );
}