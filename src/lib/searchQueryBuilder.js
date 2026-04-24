/**
 * searchQueryBuilder.js
 * Normalise les champs structurés d'une campagne en requêtes Brave de haute qualité.
 * Utilisé par prospectSearchEngine + prévisualisation dans CampaignModal.
 */

// ─── Presets géographiques ──────────────────────────────────────────────────
export const GEO_PRESETS = [
  { label: "Montréal, QC", country: "Canada", region: "Québec", city: "Montréal", lang: "fr" },
  { label: "Québec (ville), QC", country: "Canada", region: "Québec", city: "Québec", lang: "fr" },
  { label: "Toronto, ON", country: "Canada", region: "Ontario", city: "Toronto", lang: "en" },
  { label: "Vancouver, BC", country: "Canada", region: "Colombie-Britannique", city: "Vancouver", lang: "en" },
  { label: "Ottawa, ON", country: "Canada", region: "Ontario", city: "Ottawa", lang: "en" },
  { label: "Calgary, AB", country: "Canada", region: "Alberta", city: "Calgary", lang: "en" },
  { label: "Paris, Île-de-France", country: "France", region: "Île-de-France", city: "Paris", lang: "fr" },
  { label: "Lyon, Auvergne-Rhône-Alpes", country: "France", region: "Auvergne-Rhône-Alpes", city: "Lyon", lang: "fr" },
  { label: "Marseille, PACA", country: "France", region: "Provence-Alpes-Côte d'Azur", city: "Marseille", lang: "fr" },
  { label: "Bordeaux, Nouvelle-Aquitaine", country: "France", region: "Nouvelle-Aquitaine", city: "Bordeaux", lang: "fr" },
  { label: "Bruxelles, Belgique", country: "Belgique", region: "Bruxelles", city: "Bruxelles", lang: "fr" },
  { label: "Genève, Suisse", country: "Suisse", region: "Genève", city: "Genève", lang: "fr" },
  { label: "Lausanne, Suisse", country: "Suisse", region: "Vaud", city: "Lausanne", lang: "fr" },
  { label: "Zurich, Suisse", country: "Suisse", region: "Zurich", city: "Zurich", lang: "de" },
];

// ─── Catalogue de secteurs ──────────────────────────────────────────────────
export const INDUSTRY_CATALOG = {
  "Agences marketing": {
    subcategories: ["B2B", "B2C", "Digital", "Contenu & SEO", "Performance & Paid", "Influence & Social"],
    queryTemplates: {
      default: ["agence marketing {sub}", "agence acquisition clients", "agence génération leads", "agence marketing digital {sub}"],
      "B2B": ["agence marketing B2B", "agence lead generation B2B", "agence demand generation", "agence inbound marketing B2B"],
      "Digital": ["agence marketing digital", "agence growth hacking", "agence performance marketing"],
      "Contenu & SEO": ["agence SEO", "agence content marketing", "agence rédaction web"],
      "Performance & Paid": ["agence SEA Google Ads", "agence publicité digitale", "agence paid media"],
    },
  },
  "Agences web": {
    subcategories: ["Création de sites", "E-commerce", "Applications web", "UX/UI Design", "Développement sur mesure"],
    queryTemplates: {
      default: ["agence web", "agence création site internet", "agence développement web"],
      "Création de sites": ["agence création site web", "agence webdesign"],
      "E-commerce": ["agence e-commerce", "agence Shopify", "agence PrestaShop"],
      "Applications web": ["agence développement application web", "agence SaaS", "agence React"],
    },
  },
  "Cabinets de conseil": {
    subcategories: ["Stratégie", "Management", "Digital & Transformation", "Finance", "RH", "IT & Systèmes"],
    queryTemplates: {
      default: ["cabinet conseil {sub}", "société conseil management", "cabinet consulting"],
      "Stratégie": ["cabinet conseil stratégie", "cabinet strategy consulting"],
      "Digital & Transformation": ["cabinet transformation digitale", "cabinet conseil digital"],
      "Finance": ["cabinet conseil financier", "cabinet gestion patrimoine"],
    },
  },
  "Immobilier": {
    subcategories: ["Résidentiel", "Commercial", "Investissement", "Gestion locative", "Promotion"],
    queryTemplates: {
      default: ["agence immobilière", "promoteur immobilier", "cabinet immobilier"],
    },
  },
  "Assurance": {
    subcategories: ["Assurance vie", "Assurance entreprise", "Courtage", "Santé & Prévoyance", "IARD"],
    queryTemplates: {
      default: ["cabinet assurance", "courtier assurance", "compagnie assurance", "assureur {sub}"],
    },
  },
  "SaaS B2B": {
    subcategories: ["CRM & Ventes", "RH & Paie", "Comptabilité", "Marketing Automation", "ERP", "Productivité"],
    queryTemplates: {
      default: ["éditeur logiciel SaaS B2B", "startup SaaS", "logiciel entreprise {sub}"],
    },
  },
  "E-commerce": {
    subcategories: ["Mode & Textile", "High-tech", "Alimentation", "Maison & Déco", "Beauté & Santé", "Marketplace"],
    queryTemplates: {
      default: ["boutique en ligne", "e-commerce {sub}", "site vente en ligne", "pure player"],
    },
  },
  "Formation": {
    subcategories: ["Formation professionnelle", "E-learning", "Certification", "Langues", "Coaching", "Université & École"],
    queryTemplates: {
      default: ["organisme formation", "centre formation professionnelle", "école formation {sub}"],
    },
  },
  "Recrutement": {
    subcategories: ["Cadres & Dirigeants", "Tech & IT", "Commerce & Ventes", "Travail temporaire", "RPO"],
    queryTemplates: {
      default: ["cabinet recrutement", "agence emploi", "chasseur de têtes {sub}"],
    },
  },
  "Événementiel": {
    subcategories: ["Agences événementielles", "Venues & Salles", "Traiteur", "Animation", "Congrès & Salons", "Team building"],
    queryTemplates: {
      default: ["agence événementielle", "organisateur événements", "prestataire événementiel {sub}"],
      "Agences événementielles": ["agence événementielle corporate", "agence organisation séminaires", "agence team building"],
      "Venues & Salles": ["salle réception", "venue événements", "lieu séminaire"],
      "Traiteur": ["traiteur événements", "traiteur corporate", "restauration événementielle"],
    },
  },
  "Associations / OBNL": {
    subcategories: ["Culture & Arts", "Santé & Social", "Sport", "Éducation", "Environnement", "Chambres de commerce"],
    queryTemplates: {
      default: ["association loi 1901", "OBNL", "organisme à but non lucratif", "fédération {sub}"],
    },
  },
  "Institutions publiques": {
    subcategories: ["Collectivités territoriales", "Établissements publics", "Ministères", "Chambres consulaires"],
    queryTemplates: {
      default: ["collectivité territoriale", "établissement public", "institution publique {sub}"],
    },
  },
  "Santé": {
    subcategories: ["Cliniques & Hôpitaux", "Cabinets médicaux", "Pharmacies", "Bien-être", "Medtech", "EHPAD"],
    queryTemplates: {
      default: ["établissement santé", "clinique", "groupe médical {sub}"],
    },
  },
  "Industrie": {
    subcategories: ["Agroalimentaire", "Automobile", "Aéronautique", "Chimie", "BTP & Construction", "Énergie", "Luxe & Cosmétique"],
    queryTemplates: {
      default: ["entreprise industrielle {sub}", "groupe industriel", "fabricant {sub}"],
    },
  },
  "Restauration": {
    subcategories: ["Restaurants", "Chaînes & Franchises", "Hôtellerie-restauration", "Dark kitchen", "Traiteur"],
    queryTemplates: {
      default: ["restaurant {sub}", "groupe restauration", "chaîne restauration"],
    },
  },
  "Services professionnels": {
    subcategories: ["Comptabilité & Audit", "Juridique", "Notariat", "Architecture", "Ingénierie", "Traduction"],
    queryTemplates: {
      default: ["cabinet {sub}", "prestataire services professionnels", "bureau études {sub}"],
    },
  },
};

// ─── Domaines exclus par défaut ──────────────────────────────────────────────
export const DEFAULT_EXCLUDED_DOMAINS = [
  "wikipedia.org", "fr.wikipedia.org", "en.wikipedia.org",
  "pagesjaunes.fr", "pagesjaunes.ca", "yellowpages.ca", "yellowpages.com",
  "yelp.com", "yelp.fr",
  "linkedin.com", "facebook.com", "instagram.com", "twitter.com", "tiktok.com",
  "tripadvisor.fr", "tripadvisor.com",
  "leboncoin.fr", "kijiji.ca",
  "annuaire.com", "annuaires.com", "kompass.com",
  "societe.com", "infogreffe.fr",
  "mappy.com", "google.com", "bing.com",
  "lemonde.fr", "lefigaro.fr", "lesechos.fr",
  "reddit.com", "quora.com", "medium.com",
  "linternaute.com", "journaldunet.com",
];

// ─── Mots-clés exclus par défaut ────────────────────────────────────────────
export const DEFAULT_EXCLUDED_KEYWORDS = [
  "liste des", "annuaire de", "top 10", "top 50", "meilleur", "meilleurs",
  "comparateur", "comparatif", "forum", "discussion", "avis consommateurs",
  "Wikipedia", "Pages jaunes", "annuaire", "répertoire",
  "blog", "article", "actualité", "news",
];

// ─── Résolution géo ──────────────────────────────────────────────────────────
export function resolveGeoString(campaign) {
  if (campaign.targetCity) return campaign.targetCity;
  if (campaign.targetRegion) return campaign.targetRegion;
  if (campaign.targetCountry) return campaign.targetCountry;
  if (campaign.locationQuery) return campaign.locationQuery;
  return "";
}

// ─── Génération des requêtes structurées ────────────────────────────────────
export function buildStructuredQueries(campaign) {
  const geoStr = resolveGeoString(campaign);
  if (!geoStr) return [];

  const category = campaign.industryCategory;
  const subcategory = campaign.industrySubcategory;
  const extraKeywords = campaign.keywords || [];

  const queries = [];

  if (category && INDUSTRY_CATALOG[category]) {
    const cat = INDUSTRY_CATALOG[category];
    const templates = (subcategory && cat.queryTemplates[subcategory])
      ? cat.queryTemplates[subcategory]
      : (cat.queryTemplates.default || [`${category} ${geoStr}`]);

    for (const tpl of templates.slice(0, 5)) {
      const q = tpl
        .replace("{sub}", subcategory || "")
        .replace("{geo}", geoStr)
        .trim()
        .replace(/\s+/g, " ");
      queries.push(`"${q}" "${geoStr}"`);
    }

    // Variante avec extra keywords
    if (extraKeywords.length > 0) {
      const base = templates[0]
        .replace("{sub}", subcategory || "")
        .replace("{geo}", geoStr)
        .trim();
      queries.push(`"${base}" ${extraKeywords.slice(0, 2).join(" ")} "${geoStr}"`);
    }
  } else if (campaign.rawIndustryInput) {
    // Mode avancé — secteur libre
    queries.push(`"${campaign.rawIndustryInput}" "${geoStr}"`);
    queries.push(`${campaign.rawIndustryInput} entreprise ${geoStr}`);
    if (extraKeywords.length > 0) {
      queries.push(`${campaign.rawIndustryInput} ${extraKeywords.slice(0, 2).join(" ")} ${geoStr}`);
    }
  } else if (extraKeywords.length > 0) {
    queries.push(`${extraKeywords.slice(0, 3).join(" ")} ${geoStr}`);
  } else {
    queries.push(`entreprises ${geoStr}`);
  }

  // Variante rayon si défini
  if (campaign.searchRadiusKm && campaign.targetCity) {
    const radiusLabel = campaign.searchRadiusKm <= 20 ? "centre-ville" : `région de ${campaign.targetCity}`;
    if (queries.length > 0) {
      const firstBase = queries[0].replace(`"${geoStr}"`, `"${radiusLabel}"`);
      if (firstBase !== queries[0]) queries.push(firstBase);
    }
  }

  return queries.slice(0, 10);
}

// ─── Calcul du score de précision (pour UX) ─────────────────────────────────
export function computePrecisionScore(form) {
  let score = 0;
  if (form.targetCity) score += 30;
  else if (form.targetRegion) score += 15;
  else if (form.targetCountry) score += 5;

  if (form.industryCategory) score += 35;
  if (form.industrySubcategory) score += 20;
  if ((form.keywords || []).length > 0) score += 15;

  if (score >= 75) return { label: "Bon", color: "text-green-600 bg-green-50 border-green-200" };
  if (score >= 40) return { label: "Moyen", color: "text-amber-600 bg-amber-50 border-amber-200" };
  return { label: "Faible", color: "text-red-600 bg-red-50 border-red-200" };
}