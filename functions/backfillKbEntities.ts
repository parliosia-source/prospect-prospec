import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// ── Text helpers ───────────────────────────────────────────────────────────────
function normText(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
}
function normSector(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .replace(/\s*&\s*/g, " et ").replace(/\s+/g, " ").trim();
}
function parseArr(v) {
  if (Array.isArray(v)) return v;
  if (!v || String(v).trim() === "" || String(v).toLowerCase() === "nan") return [];
  const s = String(v).trim();
  if (s.startsWith("[")) { try { return JSON.parse(s).map(x => String(x).trim()).filter(Boolean); } catch(_) {} }
  return s.split(",").map(x => x.trim()).filter(Boolean);
}

// ── ALL 11 SECTOR SCORING RULES — FR/EN/QC ────────────────────────────────────
const SECTOR_SCORING_RULES = {
  "Finance & Assurance": {
    strongSignals: [
      "banque","caisse","caisse populaire","caisse desjardins","desjardins","credit union","credit populaire",
      "institution financiere","institution de depot","societe de fiducie","fiducie","trust",
      "assurance","assureur","assurances","insurance","insurtech","mga","underwriting","reassurance","souscription",
      "courtier en assurance","cabinet d assurance","courtier d assurance",
      "investissement","gestion d actifs","asset management","gestionnaire de fonds","gestion de portefeuille",
      "fonds","fonds commun","fonds de placement","fonds d investissement","fonds de pension","fonds de dotation",
      "capital","capital de risque","capital-risque","capital investissement","private equity","vc","venture capital",
      "pe firm","fonds de couverture","hedge fund","family office","bureau de gestion",
      "paiement","payment","psp","acquiring","processeur de paiement","merchant services","transfert de fonds",
      "fintech","regtech","wealthtech","insurtech","cryptomonnaie","actifs numeriques",
      "bourse","marche financier","valeurs mobilieres","securities","courtage","courtier en valeurs",
      "planificateur financier","conseiller financier","analyste financier","gestionnaire de risque",
      "actuariat","actuariel","modele actuariel",
      "hypotheque","pret hypothecaire","mortgage","financement hypothecaire","financement immobilier",
      "carte de credit","pret","credit","microcredit","financement",
    ],
    exclusions: [
      "fondation","hopital","chu","cusm","chum","hospital","centre hospitalier","soins de sante",
      "universite","cegep","college","ecole","campus","etablissement scolaire",
      "festival","tourisme","tourism","evenement","spectacle","event organizer","site evenementiel",
      "ville de","municipalite","arrondissement","gouvernement","ministere","ciusss","cisss","agence gouvernementale",
      "organisme sans but lucratif","obnl","npo","bienfaisance","bénévolat",
    ],
  },

  "Santé & Pharma": {
    strongSignals: [
      "sante","health","soins de sante","healthcare","hopital","hospital","centre hospitalier",
      "chu","cusm","chum","chsld","clsc","clinique","clinique medicale","groupe medical",
      "medecin","doctor","physician","specialiste","omnipraticien","chirurgien",
      "pharmacie","pharmacien","pharmacien proprietaire","pharmacie independante","banniere pharmacie",
      "pharma","pharmaceutical","laboratoire pharmaceutique","biopharmaceutique","biotechnologie",
      "medtech","dispositif medical","equipement medical","appareillage medical",
      "diagnostic","imagerie","radiologie","analyse medicale","laboratoire d analyse",
      "therapeutique","therapie","physiotherapie","ergotherapie","orthophonie","psychologie","psychiatrie",
      "dentaire","dentiste","orthodontiste","cabinet dentaire",
      "optique","optometrie","optometriste",
      "veterinaire","clinique veterinaire",
      "soins a domicile","soin infirmier","infirmier","infirmiere","aide soignant",
      "sante mentale","bien-etre","wellness","rehabilitation",
    ],
    exclusions: [
      "fondation philanthropique","fondation culturelle","fondation artistique",
      "universite non medicale","ecole primaire","ecole secondaire",
      "ville de","municipalite","gouvernement","ministere",
    ],
  },

  "Technologie": {
    strongSignals: [
      "logiciel","software","saas","paas","iaas","cloud computing","nuage informatique",
      "informatique","tic","technologie de l information",
      "intelligence artificielle","machine learning","apprentissage automatique","deep learning",
      "cybersecurite","securite informatique","securite de l information","soc","siem","pentest",
      "big data","analytique avancee","base de donnees","entrepot de donnees","data lake","data science",
      "developpement logiciel","developpement web","developpement mobile","application mobile","app mobile",
      "startup tech","incubateur tech","accelerateur tech",
      "erp","crm","progiciel","solution logicielle",
      "devops","integration continue","ci/cd",
      "api","microservice","architecture logicielle","plateforme numerique",
      "infrastructure it","serveur","hebergement","datacenter","centre de donnees",
      "robotique logicielle","rpa","iot","internet des objets","systeme embarque",
      "realite virtuelle","realite augmentee","jeu video","gaming",
      "blockchain","web3",
    ],
    exclusions: [
      "hopital","clinique medicale","pharmacie",
      "fondation","organisme de bienfaisance","organisme communautaire",
      "ville de","municipalite","gouvernement","ministere","organisme public",
      "cegep","ecole primaire","ecole secondaire","universite",
      "securite privee","gardiennage","surveillance","agent de securite",
      "chambre de commerce","association sectorielle",
    ],
  },

  "Gouvernement & Public": {
    strongSignals: [
      "gouvernement","government","federal","provincial","municipal",
      "ville de","arrondissement","municipalite","municipalites","administration municipale",
      "ministere","secretariat","cabinet","direction generale","sous-ministere",
      "agence gouvernementale","societe d etat","organisme public","organisme para-public",
      "assemblee nationale","parlement","senat","chambre des communes",
      "commission","tribunal administratif","regie","autorite","conseil",
      "ciusss","cisss","csss","cssmi","direction de sante publique","sante publique",
      "police","surete","gendarmerie","force de l ordre","securite publique",
      "pompier","service d incendie","protection civile",
      "transport en commun","stm","rtl","exo","societe de transport",
      "hydro-quebec","gaz metro","enr","societe energie",
      "port","aeroport","autorité aéroportuaire",
    ],
    exclusions: [
      "fondation privee","entreprise privee","startup","cabinet conseil prive",
      "banque","assurance","fintech",
    ],
  },

  "Éducation & Formation": {
    strongSignals: [
      "universite","university","ecole polytechnique","polytechnique","hec","uqam","mcgill","concordia","udem","uqtr","uqac","uqo",
      "cegep","college","ecole collegiale","enseignement superieur",
      "ecole primaire","ecole secondaire","ecole prive","ecole publique","commission scolaire","centre de services scolaire",
      "formation professionnelle","formation continue","formation en ligne","e-learning","mooc",
      "centre de formation","organisme de formation","ecole de metier","institut de formation",
      "edtech","technologie educative","plateforme educative",
      "formation entreprise","formation corporative","coaching professionnel","certification","accreditation",
      "apprentissage","alternance","stage","internship","conge de formation",
      "bibliotheque","musee educatif","planetarium","science pour enfants",
    ],
    exclusions: [
      "hopital","clinique","pharmacie",
      "ville de","municipalite","gouvernement",
      "banque","assurance","fintech",
    ],
  },

  "Associations & OBNL": {
    strongSignals: [
      "association professionnelle","association sectorielle","association patronale",
      "obnl","npo","organisme sans but lucratif","organisme a but non lucratif","but non lucratif",
      "fondation philanthropique","fondation caritative","fondation communautaire",
      "organisme de bienfaisance","bienfaisance","charitable",
      "syndicat professionnel","syndicat ouvrier","centrale syndicale","csn","ftq","csd",
      "ordre professionnel","chambre de commerce","chambre d industrie",
      "ong","organisation non gouvernementale","ngo",
      "organisme communautaire","centre communautaire","maison des jeunes","maison de la famille",
      "federation sportive","federation sectorielle",
      "conseil des arts","organisme culturel",
    ],
    exclusions: [
      "hopital","clinique medicale","pharmacie",
      "banque commerciale","assurance","fintech",
      "ville de","gouvernement","municipalite","ministere",
      "logiciel","software","saas","developpement web",
      "usine","manufacture","fabrication",
    ],
  },

  "Immobilier": {
    strongSignals: [
      "immobilier","immeuble","real estate","realty",
      "promoteur immobilier","developpeur immobilier","developpeur de projets","constructeur immobilier",
      "courtier immobilier","courtage immobilier","agence immobiliere","agent immobilier",
      "gestion immobiliere","property management","gestionnaire immobilier","gestionnaire d immeubles",
      "fonds immobilier","reit","fiducie de placement immobilier",
      "condo","condominium","copropriete","appartement","logement","residentiel","locatif",
      "commercial","bureau","espace commercial","centre commercial","local commercial",
      "industriel","entrepot industriel","parc industriel","batiment industriel",
      "terrain","foncier","subdivision","lotissement","amenagement",
      "construction","entrepreneur general","sous-traitant construction","renovation","restauration batiment",
      "architecture","architecte","firma architecture","design architectural",
      "ingenierie de structure","ingenierie civile","genie civil",
      "inspection batiment","estimateur","evaluateur agréé","evaluation immobiliere",
      "hypotheque","courtier hypothecaire","mortgage","financement immobilier",
      "location","bail commercial","bail residentiel","property leasing",
    ],
    exclusions: [
      "hopital","universite","fondation","gouvernement","municipalite",
    ],
  },

  "Droit & Comptabilité": {
    strongSignals: [
      "avocat","avocats","cabinet d avocats","law firm","cabinet juridique","etude legale","droit",
      "barreau","barreau du quebec","juriste","conseiller juridique","juriste d entreprise",
      "notaire","chambre des notaires","etude notariale","notariat",
      "huissier","processus judiciaire","litige","contentieux","arbitrage","mediation",
      "comptable","comptabilite","cpa","expert-comptable","cabinet comptable","cabinet cpa",
      "audit","verification comptable","vérificateur","auditeur",
      "fiscalite","fiscaliste","planification fiscale","optimisation fiscale","impot","taxe",
      "conformite","compliance","risque reglementaire","lutte anti-blanchiment","lam","lcb-ft",
      "restructuration","insolvabilite","faillite","syndic","redressement",
      "propriete intellectuelle","brevet","marque de commerce","droit d auteur","copyright","trademark",
      "droit du travail","relations de travail","droit de l emploi","contrat de travail",
      "droit commercial","droit des affaires","droit des societes","fusion acquisition","m&a",
      "gouvernance","secretariat corporatif","conformite corporative",
    ],
    exclusions: [
      "hopital","universite","fondation","gouvernement","ministere",
    ],
  },

  "Industrie & Manufacture": {
    strongSignals: [
      "industrie","industriel","manufacture","fabrication","production","usine","atelier de fabrication",
      "sous-traitant industriel","equipementier","fournisseur industriel","chaine de valeur",
      "acier","siderurgie","aluminium","metallurgie","forgeage","estampage","fonderie",
      "chimie","chimique","petrochimie","plastique","caoutchouc","composite","materiau avance",
      "mecanique","usinage","precision","micromecanique","mecatronique","hydraulique","pneumatique",
      "automatisation industrielle","robotique industrielle","systeme de vision","commande numerique","cnc",
      "assemblage","montage","integration de systemes","oem",
      "aerospatiale","aerospace","defense","nautique","naval",
      "bois","scierie","papier","pate a papier","forestier","meuble",
      "agroalimentaire","alimentation","transformation alimentaire","abattoir","laiterie","boulangerie","brasserie",
      "textile","vetement","confection","emballage",
      "impression","imprimerie","serigraphie",
      "genie industriel","ingenierie de procedes","amelioration continue","lean","six sigma",
    ],
    exclusions: [
      "hopital","universite","fondation","gouvernement","municipalite",
    ],
  },

  "Commerce de détail": {
    strongSignals: [
      "commerce de detail","commerce","retail","magasin","boutique","detaillant","enseigne",
      "vente au detail","vente directe","point de vente","pdv",
      "epicerie","supermarche","alimentation","depanneur","marche d alimentation","epicerie fine",
      "pharmacie de detail","para-pharmacie","soin de beaute",
      "mode","vetement","chaussure","accessoire","bijouterie","maroquinerie",
      "meuble","decoration","articles pour la maison","electromenager","electronique grand public",
      "sport","articles de sport","plein air","equipement sportif",
      "librairie","papeterie","jouet","jeu","cadeau","souvenirs",
      "franchise","franchiseur","franchisee","reseau de franchise","systeme de franchise",
      "e-commerce","commerce en ligne","boutique en ligne","marketplace","plateforme de vente",
      "restauration","restaurant","cafe","bar","traiteur","livraison de repas","fast food","brasserie",
      "beaute","coiffure","salon","spa","esthetique",
      "automobile","concessionnaire","piece auto","garage",
      "animaux","animalerie","soin animaux",
    ],
    exclusions: [
      "hopital","universite","fondation","gouvernement","municipalite",
      "grossiste exclusivement","distributeur b2b exclusivement",
    ],
  },

  "Transport & Logistique": {
    strongSignals: [
      "transport","transporteur","transporteur routier","camionnage","transport lourd","transport leger",
      "logistique","operateur logistique","gestionnaire logistique","3pl","4pl","5pl",
      "livraison","messagerie","courrier","colis","last mile","dernier kilometre",
      "cargo","fret","freight","air cargo","fret aerien","ocean freight","fret maritime",
      "entrepot","entreposage","stockage","distribution","centre de distribution","plateforme logistique",
      "supply chain","chaine d approvisionnement","approvisionnement","gestion des stocks",
      "transitaire","courtier en douane","douane","dedouanement","commerce international",
      "maritime","navire","armateur","port","agent maritime",
      "aerien","compagnie aerienne","fret aerien","handling","agent de fret",
      "ferroviaire","rail","chemin de fer","wagon",
      "transport en commun","bus","autobus","autocars","navette","covoiturage",
      "flotte","gestion de flotte","localisation vehicule","telematics",
      "demenagement","demenageur","transport de meubles",
      "alimentation en vrac","transport de matieres dangereuses","tmvd",
    ],
    exclusions: [
      "hopital","universite","fondation","gouvernement","ministere",
    ],
  },
};

// ── MTL cities ─────────────────────────────────────────────────────────────────
const MTL_CITIES = new Set([
  "montreal","laval","longueuil","brossard","terrebonne","repentigny","boucherville",
  "dorval","pointe-claire","kirkland","beaconsfield","saint-lambert","westmount",
  "mont-royal","cote-saint-luc","verdun","anjou","outremont","pierrefonds","lasalle",
  "saint-laurent","saint-jerome","blainville","boisbriand","mascouche","mirabel",
  "la-prairie","chateauguay","candiac","laprairie","saint-jean-sur-richelieu",
  "vaudreuil-dorion","les-coteaux","sainte-catherine","sainte-julie","varennes",
  "montreal-est","montreal-nord","montreal-ouest","lachine","rosemont","villeray",
  "hochelaga","riviere-des-prairies","saint-leonard","ahuntsic",
]);

function resolveGeoScope(e) {
  // Already resolved
  if (e.geoScope && e.geoScope !== "UNKNOWN") return { geoScope: e.geoScope, hqRegion: e.hqRegion, uncertain: false };

  const cityNorm = normText(e.hqCity || "");
  const provNorm = normText(e.hqProvince || "");
  const countryNorm = normText(e.hqCountry || "CA");

  const isMTL = MTL_CITIES.has(cityNorm) || [...MTL_CITIES].some(mc => cityNorm.includes(mc));
  const isQC = provNorm === "qc" || provNorm === "quebec";
  const isCA = countryNorm === "ca" || countryNorm === "canada" || countryNorm === "";

  if (isMTL) return { geoScope: "MTL_CMM", hqRegion: "MTL", uncertain: false };
  if (isQC) return { geoScope: "QC_OTHER", hqRegion: "QC_OTHER", uncertain: false };
  if (isCA && cityNorm) return { geoScope: "CANADA_OTHER", hqRegion: "OUTSIDE_QC", uncertain: false };
  if (isCA) return { geoScope: "MTL_CMM", hqRegion: "MTL", uncertain: true }; // CA but no city → assume MTL (uncertain)
  return { geoScope: "UNKNOWN", hqRegion: "UNKNOWN", uncertain: true };
}

// ── Sector scoring — returns array of { sector, score, tier, signals, rejectReason } ──
function scoreSectors(e) {
  const textBlob = normText([
    e.name, e.normalizedName, e.industryLabel, e.primaryTheme,
    ...parseArr(e.industrySectors), ...parseArr(e.themes),
    ...parseArr(e.keywords), ...parseArr(e.synonyms),
    ...parseArr(e.tags), e.notes,
  ].filter(Boolean).join(" "));

  const results = [];

  for (const [sector, rules] of Object.entries(SECTOR_SCORING_RULES)) {
    // Hard exclusions
    let rejectReason = null;
    for (const excl of rules.exclusions) {
      if (textBlob.includes(normText(excl))) { rejectReason = `excl:${excl}`; break; }
    }
    if (rejectReason) { results.push({ sector, score: 0, tier: "REJECTED", signals: [], rejectReason }); continue; }

    // Strong signals
    const matched = rules.strongSignals.filter(sig => textBlob.includes(normText(sig)));
    let score = 0;
    if (matched.length >= 3) score = 85;
    else if (matched.length === 2) score = 75;
    else if (matched.length === 1) score = 60;
    else score = 0; // no signal at all → skip

    if (score === 0) { results.push({ sector, score: 0, tier: "NONE", signals: [], rejectReason: "noSignal" }); continue; }

    // Boost: exact primaryTheme/industryLabel match
    if (normSector(e.primaryTheme) === normSector(sector) || normSector(e.industryLabel) === normSector(sector)) {
      score = Math.min(100, score + 15);
    }
    // Boost: high themeConfidence
    const tc = typeof e.themeConfidence === "number" ? e.themeConfidence : (parseFloat(e.themeConfidence) || 0.55);
    if (tc >= 0.8) score = Math.min(100, score + 5);

    const tier = score >= 70 ? "STRICT" : "EXPANDED";
    results.push({ sector, score, tier, signals: matched.slice(0, 5), rejectReason: null });
  }

  // Only return sectors that actually matched (score > 0, tier != REJECTED/NONE)
  return results
    .filter(r => r.score > 0 && r.tier !== "REJECTED" && r.tier !== "NONE")
    .sort((a, b) => b.score - a.score);
}

// ── Main ───────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== "admin") {
    return Response.json({ error: "Forbidden: Admin only" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const {
    dryRun = true,
    offset = 0,
    limit = 500,
    onlyEmptySectors = true,
    batchSize = 6,
  } = body;

  const START = Date.now();
  console.log(`[BACKFILL] START dryRun=${dryRun} offset=${offset} limit=${limit} onlyEmpty=${onlyEmptySectors}`);

  // ── Load all entities (paginated) ──────────────────────────────────────────
  let allEntities = [];
  let p = 0;
  while (true) {
    const batch = await base44.asServiceRole.entities.KBEntityV2.list('-updated_date', 500, p * 500).catch(() => []);
    if (!batch || batch.length === 0) break;
    allEntities = allEntities.concat(batch);
    if (batch.length < 500) break;
    p++;
    if (p >= 20) break;
  }
  console.log(`[BACKFILL] total loaded=${allEntities.length}`);

  // Filter
  let candidates = allEntities;
  if (onlyEmptySectors) {
    candidates = allEntities.filter(e => {
      const sectors = parseArr(e.industrySectors);
      const themes = parseArr(e.themes);
      // Also catch corrupted data (brackets in values, empty strings, etc.)
      const cleanSectors = sectors.filter(s => s && !s.startsWith("[") && !s.endsWith("]") && s.length > 1);
      const hasBadData = sectors.length > 0 && cleanSectors.length === 0;
      const hasFlags = parseArr(e.qualityFlags).some(f => f.includes("BACKFILL"));
      return hasBadData || (sectors.length === 0 && !e.industryLabel && !e.primaryTheme && themes.length === 0) || hasFlags === false && cleanSectors.length === 0;
    });
  }

  const page = candidates.slice(offset, offset + limit);
  console.log(`[BACKFILL] candidates=${candidates.length} page=${page.length} offset=${offset}`);

  // ── Stats ──────────────────────────────────────────────────────────────────
  let sectorUpdated = 0, geoUpdated = 0, skipped = 0, errors = 0;
  const sectorDist = {};
  const topRejectReasons = {};
  let mtlCmmCount = 0;
  const uncertainGeo = [];
  const sampleUpdates = [];
  const errorList = [];

  for (let i = 0; i < page.length; i += batchSize) {
    const chunk = page.slice(i, i + batchSize);

    for (const e of chunk) {
      try {
        const update = {};
        let changed = false;

        // ── Geo backfill ────────────────────────────────────────────────
        const { geoScope, hqRegion, uncertain } = resolveGeoScope(e);
        const geoChanged = geoScope !== e.geoScope || hqRegion !== e.hqRegion;
        if (geoChanged && geoScope !== "UNKNOWN") {
          update.geoScope = geoScope;
          update.hqRegion = hqRegion;
          if (!e.hqCountry || e.hqCountry === "") update.hqCountry = "CA";
          changed = true;
          geoUpdated++;
          if (uncertain) {
            uncertainGeo.push({ id: e.id, name: e.name, domain: e.domain, geoScope, reason: "no_city_assumed_MTL" });
          }
          if (geoScope === "MTL_CMM") mtlCmmCount++;
        } else if (e.geoScope === "MTL_CMM") {
          mtlCmmCount++;
        }

        // ── Sector scoring ──────────────────────────────────────────────
        const scored = scoreSectors(e);

        if (scored.length === 0) {
          // Track rejection reasons
          for (const [sector, rules] of Object.entries(SECTOR_SCORING_RULES)) {
            const textBlob = normText([e.name, e.industryLabel, e.notes, ...parseArr(e.keywords)].filter(Boolean).join(" "));
            for (const excl of rules.exclusions) {
              if (textBlob.includes(normText(excl))) {
                const k = `excl:${excl}`;
                topRejectReasons[k] = (topRejectReasons[k] || 0) + 1;
                break;
              }
            }
          }
          skipped++;
          if (!changed) continue;
        } else {
          // Best sectors: STRICT first, then EXPANDED, max 3
          const strictSectors = scored.filter(r => r.tier === "STRICT").slice(0, 3);
          const expandedSectors = scored.filter(r => r.tier === "EXPANDED");
          const topSectors = [...strictSectors, ...expandedSectors].slice(0, 3);

          const industrySectors = topSectors.map(r => r.sector);
          const newFlags = topSectors.map(r => `SECTOR_${r.tier}:${r.sector}:BACKFILL`);
          // Merge with existing flags (non-backfill ones)
          const existingFlags = parseArr(e.qualityFlags).filter(f => !f.includes(":BACKFILL"));
          const qualityFlags = [...new Set([...existingFlags, ...newFlags])];

          // primaryTheme/industryLabel: ONLY if at least one STRICT
          let primaryTheme = e.primaryTheme || "";
          let industryLabel = e.industryLabel || "";
          if (strictSectors.length > 0) {
            primaryTheme = strictSectors[0].sector;
            industryLabel = primaryTheme;
          } // else: leave intact (even if empty — no anchoring on weak signals)

          // Update sector distribution stats
          for (const { sector, tier } of topSectors) {
            if (!sectorDist[sector]) sectorDist[sector] = { strict: 0, expanded: 0, total: 0 };
            sectorDist[sector][tier === "STRICT" ? "strict" : "expanded"]++;
            sectorDist[sector].total++;
          }

          update.industrySectors = industrySectors;
          update.themes = industrySectors;
          update.qualityFlags = qualityFlags;
          if (primaryTheme) { update.primaryTheme = primaryTheme; update.industryLabel = industryLabel; }

          sectorUpdated++;
          changed = true;

          if (sampleUpdates.length < 20) {
            sampleUpdates.push({
              name: e.name, domain: e.domain,
              old: { industrySectors: parseArr(e.industrySectors), primaryTheme: e.primaryTheme, geoScope: e.geoScope },
              new: { industrySectors, primaryTheme: update.primaryTheme || null, geoScope: update.geoScope || e.geoScope },
              scored: scored.slice(0, 3).map(r => ({ sector: r.sector, score: r.score, tier: r.tier, signals: r.signals })),
            });
          }
        }

        if (changed && !dryRun) {
          const { id, created_date, updated_date, created_by, ...rest } = e;
          await base44.asServiceRole.entities.KBEntityV2.update(e.id, update);
        }
      } catch (err) {
        errors++;
        errorList.push({ name: e.name, domain: e.domain, error: err.message });
        console.log(`[BACKFILL] ERR ${e.domain}: ${err.message}`);
        if (err.message?.includes("429") || err.message?.includes("Rate limit")) {
          await new Promise(r => setTimeout(r, 8000));
        }
      }
    }

    // Progress log every 5 batches
    if (i % (batchSize * 5) === 0) {
      console.log(`[BACKFILL] progress ${i}/${page.length} sectorUpdated=${sectorUpdated} geoUpdated=${geoUpdated}`);
    }

    if (!dryRun && i + batchSize < page.length) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  const elapsed = Date.now() - START;
  console.log(`[BACKFILL] END sectorUpdated=${sectorUpdated} geoUpdated=${geoUpdated} skipped=${skipped} errors=${errors} elapsed=${elapsed}ms`);

  return Response.json({
    dryRun,
    totalInKB: allEntities.length,
    totalCandidates: candidates.length,
    processedInThisBatch: page.length,
    sectorUpdated,
    geoUpdated,
    skipped,
    errors,
    mtlCmmCount,
    sectorDistribution: sectorDist,
    topRejectReasons: Object.entries(topRejectReasons).sort((a,b) => b[1]-a[1]).slice(0, 20).reduce((acc, [k,v]) => { acc[k]=v; return acc; }, {}),
    uncertainGeoCount: uncertainGeo.length,
    uncertainGeoSamples: uncertainGeo.slice(0, 10),
    sampleUpdates,
    errorList: errorList.slice(0, 10),
    elapsedMs: elapsed,
    nextOffset: offset + page.length,
    isComplete: offset + page.length >= candidates.length,
  });
});