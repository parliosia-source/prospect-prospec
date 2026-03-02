# KB Enrichissement Québec 2026 — Nouvelles Entités

## Fichier : `KBEntityV3_new_enrichment_FINAL.csv`

### Résumé

| Métrique | Valeur |
|---|---|
| Entités originales (KB existante) | 2 541 |
| **Nouvelles entités générées** | **1 461** |
| **Total après enrichissement** | **4 002** |
| Taux de croissance | +57% |
| Doublons détectés et supprimés | 0 |

### Distribution par secteur (nouvelles entités)

| Secteur | Nb entités |
|---|---|
| Technologies & IA | 357 |
| Finance & Assurance | 111 |
| Sciences de la Vie & Santé | 102 |
| Médias & Communication | 96 |
| Construction & Ingénierie | 85 |
| Immobilier | 80 |
| Santé & Pharma | 77 |
| Transport & Logistique | 61 |
| Industrie & Manufacture | 53 |
| Alimentaire & Agroalimentaire | 51 |
| Événementiel & Expérientiel | 46 |
| Énergie & Environnement | 27 |
| Autres secteurs | 315 |

### Distribution géographique

| Zone | Nb entités |
|---|---|
| Grand Montréal (MTL_CMM) | 1 284 (88%) |
| Reste du Québec (QC_OTHER) | 177 (12%) |

### Villes représentées

Montréal, Laval, Longueuil, Brossard, Québec City, Sherbrooke, Saint-Laurent, Plateau-Mont-Royal, Rosemont, Westmount, Saint-Hyacinthe, Saint-Jérôme, Trois-Rivières, et plus.

### Format

Le fichier respecte exactement le format `KBEntityV3` avec les colonnes :
`notes, hqCity, keywords, hqCountry, hqProvince, qualityFlags, sourceOrigin, sourceUrl, themes, primaryTheme, confidenceScore, seedBatchId, hqRegion, industrySectorsDerivedReasons, sectorSynonymsUsed, geoScope, lastVerifiedAt, website, entityType, synonyms, themeConfidence, industryLabel, tags, industrySectors, domain, name, normalizedName, id, created_date, updated_date, created_by_id, created_by, is_sample`

### Import

Utiliser la fonction `importKbV3` avec ce fichier pour importer les entités dans la base de connaissances.

```json
{
  "fileUrl": "<URL_DU_FICHIER>",
  "dryRun": false,
  "batchSize": 8,
  "offset": 0,
  "limit": 300
}
```

Pour importer toutes les entités, répéter avec `offset` incrémenté de 300 jusqu'à `isComplete: true`.

### Génération

- **Outil** : GPT-4.1-mini via OpenAI API
- **Date** : 2026-03-01
- **Batch ID** : `KB_QC_ENRICHMENT_2026`
- **Méthode** : Génération en 2 vagues avec déduplication automatique
