import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// ── Text helpers ───────────────────────────────────────────────────────────────
function normText(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
}
function normSector(s) {
  return normText(s).replace(/\s*&\s*/g, " et ").replace(/\s+/g, " ");
}
function parseArr(v) {
  if (Array.isArray(v)) return v;
  if (!v || String(v).trim() === "" || String(v).toLowerCase() === "nan") return [];
  const s = String(v).trim();
  if (s.startsWith("[")) { try { return JSON.parse(s).map(x => String(x).trim()).filter(Boolean); } catch (_) {} }
  return s.split(",").map(x => x.trim()).filter(Boolean);
}

// ── Geo helpers ───────────────────────────────────────────────────────────────
const MTL_CITIES = new Set([
  "montreal","laval","longueuil","brossard","terrebonne","repentigny","boucherville",
  "dorval","pointe-claire","kirkland","beaconsfield","saint-lambert","westmount",
  "mont-royal","cote-saint-luc","verdun","anjou","outremont","pierrefonds","lasalle",
  "saint-laurent","saint-jerome","blainville","boisbriand","mascouche","mirabel",
  "la-prairie","chateauguay","candiac","laprairie","saint-jean-sur-richelieu",
  "vaudreuil-dorion","les-coteaux","sainte-catherine","sainte-julie","varennes",
  "montreal-est","montreal-nord","montreal-ouest","lachine","rosemont","villeray",
  "hochelaga","riviere-des-prairies","saint-leonard","ahuntsic","mtl",
]);

function resolveGeo(e) {
  const cityNorm = normText(e.hqCity || "");
  const provNorm = normText(e.hqProvince || "");
  const isQC = provNorm === "qc" || provNorm === "quebec" || provNorm === "québec";
  const currentGeoScope = e.geoScope || "UNKNOWN";
  const currentHqRegion = e.hqRegion || "UNKNOWN";

  // Compute what geoScope should be
  let derivedGeoScope = null;
  let derivedHqRegion = null;
  let uncertain = false;

  if (isQC && cityNorm) {
    const isMTL = MTL_CITIES.has(cityNorm) || [...MTL_CITIES].some(mc => cityNorm.startsWith(mc));
    derivedGeoScope = isMTL ? "MTL_CMM" : "QC_OTHER";
    derivedHqRegion = isMTL ? "MTL" : "QC_OTHER";
  } else if (isQC) {
    // QC province but no city
    derivedGeoScope = "QC_OTHER";
    derivedHqRegion = "QC_OTHER";
    uncertain = true;
  } else if (cityNorm && MTL_CITIES.has(cityNorm)) {
    derivedGeoScope = "MTL_CMM";
    derivedHqRegion = "MTL";
  } else {
    const domain = normText(e.domain || "");
    if (domain.endsWith(".qc.ca")) {
      derivedGeoScope = "QC_OTHER";
      derivedHqRegion = "QC_OTHER";
      uncertain = true;
    }
  }

  if (!derivedGeoScope) return null; // Cannot infer

  // Only update if current value is missing/UNKNOWN or would be upgraded
  const needsUpdate = (currentGeoScope === "UNKNOWN" || !currentGeoScope) ||
                      (currentHqRegion === "UNKNOWN" || !currentHqRegion);
  if (!needsUpdate) return null;

  return { hqRegion: derivedHqRegion, geoScope: derivedGeoScope, uncertain };
}

// ── SECTOR SCORING RULES (exhaustive, 10 UI sectors, FR/EN Québec) ─────────────
// EXCLUSIONS: only hard-reject signals that are unambiguous (e.g. "cegep" in Finance).
// Keep exclusion lists minimal and specific — cross-sector exclusions create false negatives.
const SECTOR_RULES = {
  "Finance & Assurance": {
    strongSignals: [
      "banque","caisse","credit union","institution financiere","desjardins","bnc","rbc","td bank","cibc","bmo","scotiabank",
      "assurance","insurance","courtier en assurance","mutuelle","mga","underwriting","reassurance","souscripteur",
      "investissement","gestion d actifs","asset management","capital risque","fonds de placement","private equity","venture capital",
      "paiement","payment","fintech","neobanque","neobank","services financiers","financial services",
      "bourse","valeurs mobilieres","securities","fiducie","trust","hypotheque","preteur","lender",
      "actuariat","planificateur financier","conseiller financier","industrielle alliance","ia financiere","la capitale","sun life","manulife",
    ],
    // Only exclude entities whose NAME/notes clearly place them outside finance
    exclusions: [
      "hopital","chu","cusm","chum","centre hospitalier",
      "cegep","universite","ecole secondaire","ecole primaire",
      "ville de","municipalite","ministere","ciusss","cisss",
    ],
  },
  "Technologie": {
    strongSignals: [
      "logiciel","software","saas","cloud computing","informatique","intelligence artificielle","ia","machine learning",
      "cybersecurite","developpement web","application mobile","hebergement","devops","infrastructure ti",
      "integateur ti","editeur logiciel","erp","crm","plateforme numerique","solution numerique",
      "blockchain","big data","analytics","business intelligence","rpa","automatisation intelligente",
    ],
    exclusions: [
      "hopital","chu","centre hospitalier",
      "cegep","universite",
      "ville de","ministere",
    ],
  },
  "Santé & Pharma": {
    strongSignals: [
      "sante","health","pharma","pharmaceutique","medicament","clinique","clinic","medecin","docteur",
      "hopital","hospital","chu","chum","cusm","cisss","ciusss","centre hospitalier","soins de sante",
      "diagnostic","therapeutique","biotech","biotechnologie",
      "dentiste","optometrie","physiotherapie","chiro","osteo",
      "infirmier","pharmacie","equipement medical","medical devices",
      "chirurgie","soins longue duree","clsc","gmf","groupe medecin",
    ],
    exclusions: [
      "ville de","ministere",
    ],
  },
  "Gouvernement & Public": {
    strongSignals: [
      "gouvernement","government","municipalite","ville de","arrondissement","ministere",
      "assemblee nationale","parlement","agence gouvernementale","societe d etat","crown corporation",
      "ciusss","cisss","saq","stm","rtc","remq","societe de transport en commun","caisse depot","cdpq",
      "commission scolaire","regie","tribunal","chambre des communes","senat",
    ],
    exclusions: [], // broad sector — no hard exclusions
  },
  "Éducation & Formation": {
    strongSignals: [
      "universite","university","cegep","ecole superieure","grande ecole","formation professionnelle","centre de formation",
      "apprentissage","e-learning","mooc","pedagogie","didactique","enseignant","professeur","educateur",
      "diplome","certificat","mba","maitrise","doctorat","programme d etudes",
      "hec","polytechnique","uqam","udem","mcgill","concordia","ets","ulaval","sherbrooke","uqtr","uqac","inrs",
    ],
    exclusions: [
      "banque","assurance",
    ],
  },
  "Associations & OBNL": {
    strongSignals: [
      "association","obnl","npo","nonprofit","non-profit","fondation","organisme sans but lucratif","charitable",
      "benevole","volunteer","ong","syndicat","federation","regroupement","coalition","collectif",
      "communautaire","ordre professionnel","chambre de commerce","mission sociale","but non lucratif",
      "aide humanitaire","entraide","soutien social","inclusion sociale",
    ],
    exclusions: [], // minimal — foundations can coexist with other sectors
  },
  "Immobilier": {
    strongSignals: [
      "immobilier","real estate","promoteur immobilier","developpeur immobilier","courtier immobilier",
      "gestion immobiliere","property management","reit","fonds immobilier","condo","logement locatif",
      "copropriete","syndic de copropriete","gestionnaire d immeuble","renovation residentielle",
      "construction residentielle","construction commerciale","terrain a vendre","subdivision",
      "hypotheque","financement immobilier","estimation immobiliere","evaluation immobiliere",
      "remax","via capitale","royal lepage","century 21","sutton","proprio direct",
    ],
    exclusions: [
      "hopital","chu","cegep","universite",
    ],
  },
  "Droit & Comptabilité": {
    strongSignals: [
      "avocat","cabinet d avocats","law firm","barreau","notaire","huissier","juriste","conseiller juridique",
      "comptable","cpa","audit","fiscalite","conformite","cabinet comptable","expertise comptable",
      "litige","contentieux","restructuration","insolvabilite","faillite","mediation","arbitrage",
      "droit des affaires","droit corporatif","droit fiscal","droit immobilier","droit du travail",
    ],
    exclusions: [
      "hopital","chu","cegep","universite",
    ],
  },
  "Industrie & Manufacture": {
    strongSignals: [
      "usine","manufacture","fabrication industrielle","production industrielle","acier","aluminium","chimie industrielle",
      "mecanique industrielle","automatisation industrielle","assemblage","machinerie","ingenierie industrielle",
      "aerospatiale","aeronautique","defense","plastique","caoutchouc","emballage","packaging","imprimerie",
      "textile","papier","metallurgie","soudure","fonderie",
      "equipementier","electronique industrielle","semi-conducteur","systemes embarques",
    ],
    exclusions: [
      "hopital","chu","universite","cegep",
    ],
  },
  "Commerce de détail": {
    strongSignals: [
      "commerce de detail","retail","detaillant","magasin","boutique","vente au detail","epicerie","supermarche",
      "franchise","e-commerce","commerce electronique","mode","vetement","chaussure",
      "quincaillerie","bricolage","librairie","pharmacie de detail","depanneur",
      "restaurant","cafe","bar","brasserie","traiteur","livraison repas","fast food","restauration",
    ],
    exclusions: [
      "hopital","chu","universite","cegep","gouvernement","ministere",
    ],
  },
  "Transport & Logistique": {
    strongSignals: [
      "transport de marchandises","logistique","livraison","cargo","fret","entrepot","courrier","distribution",
      "supply chain","camionnage","expediteur","freight","3pl","4pl","transitaire","douane",
      "transport maritime","transport aerien","transport ferroviaire",
      "messagerie","colis","stockage","manutention","chargeur",
      "stm","rtc","remq","societe de transport en commun","autobus","metro","transport en commun",
      "covoiturage","gestion flotte","fleet management",
    ],
    exclusions: [
      "hopital","chu","universite","cegep",
    ],
  },
};

const ALL_SECTORS = Object.keys(SECTOR_RULES);

// Build a text blob from the entity for scoring
function buildTextBlob(e) {
  return normText([
    e.name, e.normalizedName, e.industryLabel, e.primaryTheme,
    ...parseArr(e.industrySectors), ...parseArr(e.themes),
    ...parseArr(e.keywords), ...parseArr(e.synonyms),
    ...parseArr(e.tags),
    e.notes,
  ].filter(Boolean).join(" "));
}

// Score a single sector against a text blob
// Returns { score, tier, matchedSignals, rejectReason }
function scoreSector(textBlob, sector) {
  const rules = SECTOR_RULES[sector];
  if (!rules) return { score: 0, tier: "REJECTED", matchedSignals: [], rejectReason: "no_rules" };

  // Hard exclusion check
  for (const excl of rules.exclusions) {
    if (textBlob.includes(normText(excl))) {
      return { score: 0, tier: "REJECTED", matchedSignals: [], rejectReason: `excl:${excl}` };
    }
  }

  // Strong signal matching
  const matchedSignals = rules.strongSignals.filter(sig => textBlob.includes(normText(sig)));
  let score = 0;
  if (matchedSignals.length >= 3) score = 85;
  else if (matchedSignals.length === 2) score = 75;
  else if (matchedSignals.length === 1) score = 60;
  else return { score: 0, tier: "REJECTED", matchedSignals: [], rejectReason: "noSignal" };

  const tier = score >= 70 ? "STRICT" : "EXPANDED";
  return { score, tier, matchedSignals, rejectReason: null };
}

// Classify an entity across all sectors
// Returns { strictSectors, expandedSectors, topRejectReasons, details }
function classifyEntity(e) {
  const textBlob = buildTextBlob(e);
  const strictSectors = [];
  const expandedSectors = [];
  const rejectReasons = {};
  const details = {};

  for (const sector of ALL_SECTORS) {
    const result = scoreSector(textBlob, sector);
    details[sector] = result;
    if (result.tier === "STRICT") strictSectors.push({ sector, score: result.score, signals: result.matchedSignals });
    else if (result.tier === "EXPANDED") expandedSectors.push({ sector, score: result.score, signals: result.matchedSignals });
    else if (result.rejectReason && result.rejectReason !== "noSignal") {
      rejectReasons[result.rejectReason] = (rejectReasons[result.rejectReason] || 0) + 1;
    }
  }

  // Sort by score desc
  strictSectors.sort((a, b) => b.score - a.score);
  expandedSectors.sort((a, b) => b.score - a.score);

  return { strictSectors, expandedSectors, rejectReasons };
}

// Build update payload for an entity
// Rules:
//  - primaryTheme/industryLabel only if there is at least 1 STRICT sector
//  - industrySectors: top 3 STRICT + fill with EXPANDED up to 3
//  - qualityFlags: add SECTOR_STRICT:X or SECTOR_EXPANDED:X tags
function buildUpdate(e, classification, existingSectors) {
  const { strictSectors, expandedSectors } = classification;

  if (strictSectors.length === 0 && expandedSectors.length === 0) return null;

  // Pick top 3 sectors: STRICT first, then EXPANDED
  const chosen = [...strictSectors, ...expandedSectors].slice(0, 3);
  const newIndustrySectors = chosen.map(c => c.sector);

  // primaryTheme only from STRICT
  const newPrimaryTheme = strictSectors.length > 0 ? strictSectors[0].sector : null;
  const newIndustryLabel = newPrimaryTheme;

  // qualityFlags: remove old SECTOR_ flags, add new ones
  const existingFlags = parseArr(e.qualityFlags).filter(f => !f.startsWith("SECTOR_"));
  const newFlags = [
    ...existingFlags,
    ...strictSectors.slice(0, 3).map(c => `SECTOR_STRICT:${c.sector}`),
    ...expandedSectors.slice(0, 3).map(c => `SECTOR_EXPANDED:${c.sector}`),
  ];

  const update = {
    industrySectors: newIndustrySectors,
    themes: newIndustrySectors,
    qualityFlags: newFlags,
  };
  if (newPrimaryTheme) {
    update.primaryTheme = newPrimaryTheme;
    update.industryLabel = newIndustryLabel;
  }

  return update;
}

// ── Main handler ───────────────────────────────────────────────────────────────
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
  } = body;

  const START = Date.now();
  console.log(`[BACKFILL] START dryRun=${dryRun} offset=${offset} limit=${limit} onlyEmptySectors=${onlyEmptySectors}`);

  // Load all entities via proper pagination (500 per page)
  let allEntities = [];
  let page = 0;
  while (true) {
    const chunk = await base44.asServiceRole.entities.KBEntityV2.list('-created_date', 500, page * 500).catch(() => []);
    if (!chunk || chunk.length === 0) break;
    allEntities = allEntities.concat(chunk);
    if (chunk.length < 500) break;
    page++;
    if (page >= 20) break; // safety cap at 10k
  }
  const batch = allEntities.slice(offset, offset + limit);
  console.log(`[BACKFILL] totalInDB=${allEntities.length} offset=${offset} batchSize=${batch.length}`);

  let sectorized = 0, geoFixed = 0, skipped = 0, errors = 0;
  let mtlCmmCount = 0;
  const sectorDistribution = {};
  const topRejectReasons = {};
  const sampleUpdates = [];
  const uncertainGeo = [];

  for (const e of batch) {
    try {
      const existingSectors = parseArr(e.industrySectors);
      const hasExistingSectors = existingSectors.length > 0 || !!e.industryLabel;

      // Skip if onlyEmptySectors and entity already has sectors
      if (onlyEmptySectors && hasExistingSectors) {
        skipped++;
        // Still count existing geo
        if (e.geoScope === "MTL_CMM") mtlCmmCount++;
        continue;
      }

      const updatePayload = {};

      // ── Geo backfill ──────────────────────────────────────────────────────
      const geoResult = resolveGeo(e);
      if (geoResult) {
        updatePayload.hqRegion = geoResult.hqRegion;
        updatePayload.geoScope = geoResult.geoScope;
        if (geoResult.uncertain) {
          uncertainGeo.push({ name: e.name, domain: e.domain, derivedGeoScope: geoResult.geoScope, reason: "domain_heuristic" });
        }
        geoFixed++;
        if (geoResult.geoScope === "MTL_CMM") mtlCmmCount++;
      } else {
        if (e.geoScope === "MTL_CMM") mtlCmmCount++;
      }

      // ── Sector classification ─────────────────────────────────────────────
      const classification = classifyEntity(e);

      // Aggregate reject reasons
      for (const [reason, count] of Object.entries(classification.rejectReasons)) {
        topRejectReasons[reason] = (topRejectReasons[reason] || 0) + count;
      }

      const sectorUpdate = buildUpdate(e, classification, existingSectors);
      if (sectorUpdate) {
        Object.assign(updatePayload, sectorUpdate);
        sectorized++;

        // Track distribution
        for (const { sector, score } of [...classification.strictSectors, ...classification.expandedSectors].slice(0, 3)) {
          if (!sectorDistribution[sector]) sectorDistribution[sector] = { strict: 0, expanded: 0, total: 0 };
          const tier = score >= 70 ? "strict" : "expanded";
          sectorDistribution[sector][tier]++;
          sectorDistribution[sector].total++;
        }
      }

      // Sample for inspection (first 10 meaningful)
      if (sampleUpdates.length < 10 && (sectorUpdate || geoResult)) {
        sampleUpdates.push({
          name: e.name,
          domain: e.domain,
          oldSectors: existingSectors,
          newSectors: sectorUpdate?.industrySectors || null,
          oldPrimaryTheme: e.primaryTheme || null,
          newPrimaryTheme: sectorUpdate?.primaryTheme || null,
          oldGeoScope: e.geoScope || null,
          newGeoScope: updatePayload.geoScope || null,
          strictSectors: classification.strictSectors.map(c => `${c.sector}(${c.score})`),
          expandedSectors: classification.expandedSectors.map(c => `${c.sector}(${c.score})`),
        });
      }

      // Apply if not dryRun and there's something to update
      if (!dryRun && Object.keys(updatePayload).length > 0) {
        await base44.asServiceRole.entities.KBEntityV2.update(e.id, updatePayload);
      }

    } catch (err) {
      errors++;
      console.log(`[BACKFILL] ERR ${e.domain}: ${err.message}`);
    }
  }

  const elapsed = Date.now() - START;
  console.log(`[BACKFILL] END sectorized=${sectorized} geoFixed=${geoFixed} skipped=${skipped} errors=${errors} elapsed=${elapsed}ms`);

  return Response.json({
    dryRun,
    offset,
    limit,
    onlyEmptySectors,
    totalInDB: allEntities.length,
    batchProcessed: batch.length,
    sectorized,
    geoFixed,
    skipped,
    errors,
    mtlCmmCount,
    sectorDistribution,
    topRejectReasons,
    sampleUpdates,
    uncertainGeo: uncertainGeo.slice(0, 20),
    nextOffset: offset + batch.length,
    isComplete: offset + batch.length >= allEntities.length,
    elapsedMs: elapsed,
  });
});