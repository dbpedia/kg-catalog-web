# DBpedia KG Catalog Web

A static multi-page for a modern, interactive knowledge graph catalog.

## Pages

- `index.html`: landing page with overview statistics, top KGs, latest updates, and bubble visualization.
- `catalog.html`: filterable browsing page for all catalog entries, with domain and sort controls.
- `kg.html?id=<kg-id>`: dedicated profile page for each KG.
- `submit.html`: instructions and checklist for adding a knowledge graph.
- `download.html`: guidance for downloading one KG, one version, or the full catalog.
- `about.html`: background, principles, and roadmap.

## Structure

- `assets/css/styles.css`: shared design system and responsive layout.
- `assets/data/license-abbreviations.json`: abbreviations for the different licenses.
- `assets/js/common.js`: shared utilities and navigation behavior.
- `assets/js/index.js`: landing page rendering logic and live SPARQL-backed overview data.
- `assets/js/catalog.js`: live Databus/Moss catalog loading, domain filtering, and sorting logic.
- `assets/js/kg.js`: KG profile rendering logic and live metadata enrichment.
