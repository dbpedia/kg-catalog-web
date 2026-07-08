(function () {
  const SPARQL_DATABUS_ENDPOINT = "https://databus.dbpedia.org/sparql";
  const SPARQL_MOSS_ENDPOINT = "https://moss.dev.dbpedia.link/sparql";
  const DOMAINS = [
    "Cross-domain",
    "Geography & Environment",
    "Government & Public Sector",
    "Life Sciences & Health",
    "Economy, Industry & Infrastructure",
    "Publications, Education & Research",
    "Media, Culture & Entertainment",
    "Linguistics, Social & Digital Knowledge Systems"
  ];

  const SPARQL_CATALOG_QUERY = `PREFIX databus: <https://dataid.dbpedia.org/databus#>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX dcat: <http://www.w3.org/ns/dcat#>

SELECT ?kg ?kgTitle ?lastModified ?license
WHERE {
  {
    SELECT ?kg (MAX(?modified) AS ?lastModified)
    WHERE {
      ?kg databus:account <https://databus.dbpedia.org/knowledge-graph-catalog> .

      ?version databus:group ?kg ;
               dct:modified ?modified .
    }
    GROUP BY ?kg
  }

  ?kg dct:title ?kgTitle .

  ?version databus:group ?kg ;
           dct:modified ?lastModified ;
           dct:license ?license .

}
GROUP BY ?kg ?kgTitle ?license ?lastModified
ORDER BY DESC(?kgTitle)`;

  const SPARQL_MOSS_METADATA_QUERY = `PREFIX databus: <https://dataid.dbpedia.org/databus#>
PREFIX dcat: <http://www.w3.org/ns/dcat#>
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
PREFIX dcterms: <http://purl.org/dc/terms/>

select ?kgDatabusUri ?size ?domain where {
  ?kgDatabusUri a databus:Group ;
    dcat:byteSize ?size ;
    dcterms:subject ?domain .
}`;

  function e(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function extractLastSegment(value) {
    const text = String(value || "").replace(/\/+$/, "");
    const hashIndex = text.lastIndexOf("#");
    const slashIndex = text.lastIndexOf("/");
    const index = Math.max(hashIndex, slashIndex);
    return index >= 0 ? text.slice(index + 1) : text;
  }

  function labelizeId(id) {
    if (!id) return "Unknown KG";
    if (/^[a-z]{2,5}$/i.test(id)) return id.toUpperCase();
    return id
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (match) => match.toUpperCase());
  }

  function labelizeDomain(value) {
    const segment = extractLastSegment(value);
    if (segment.toLowerCase() === "cross-domain") return "Cross-domain";
    const label = labelizeId(segment);
    return DOMAINS.includes(label) ? label : label;
  }

  function parseSizeBytes(value) {
    const size = Number(value);
    return Number.isFinite(size) ? size : 0;
  }

  function getFilters() {
    return {
      domain: document.getElementById("domain").value,
      sort: document.getElementById("sort").value
    };
  }

  function applyFilters(data, filters) {
    let list = data.slice();

    if (filters.domain) {
      list = list.filter((item) => item.domains.includes(filters.domain));
    }

    if (filters.sort === "size") {
      list.sort((a, b) => b.sizeBytes - a.sizeBytes);
    } else if (filters.sort === "recent") {
      list.sort((a, b) => KGUtils.daysSince(a.lastUpdated) - KGUtils.daysSince(b.lastUpdated));
    } else {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }

    return list;
  }

  function renderCatalog(list) {
    const root = document.getElementById("catalog-list");
    const count = document.getElementById("result-count");

    count.textContent = list.length + " graphs";

    if (!list.length) {
      root.innerHTML = '<div class="card" style="padding:1rem;">No graphs match your filters.</div>';
      return;
    }

    root.innerHTML = list
      .map((item) => {
        const domainLabel = item.domainLabel || "Domain not specified";
        const licenseInfo = KGUtils.formatLicenseInfo(item.license);
        const licenseHtml = licenseInfo.href
          ? '<a href="' + e(licenseInfo.href) + '" target="_blank" rel="noopener">' + e(licenseInfo.label) + "</a>"
          : e(licenseInfo.label);

        return (
          '<article class="kg-card card">' +
          '<span class="domain-tag" style="background:' +
          e(KGUtils.colorForDomain(item.domain)) +
          '">' +
          e(domainLabel) +
          "</span>" +
          "<h3>" +
          e(item.name) +
          "</h3>" +
          "<p>Latest dump size: <strong>" +
          e(KGUtils.formatBytes(item.sizeBytes)) +
          "</strong></p>" +
          '<p class="meta">Updated ' +
          e(KGUtils.formatRelative(item.lastUpdated)) +
          " • License: " +
          licenseHtml +
          "</p>" +
          '<a class="btn secondary" href="kg.html?id=' +
          encodeURIComponent(item.id) +
          '">Open profile</a>' +
          "</article>"
        );
      })
      .join("");
  }

  function syncWithQueryParams() {
    const params = new URLSearchParams(window.location.search);
    const sort = params.get("sort");
    const domain = params.get("domain");
    if (sort === "size") document.getElementById("sort").value = "size";
    if (sort === "updated") document.getElementById("sort").value = "recent";
    if (domain && DOMAINS.includes(domain)) document.getElementById("domain").value = domain;
  }

  async function fetchSparql(endpoint, query) {
    const url = new URL(endpoint);
    url.searchParams.set("query", query);
    url.searchParams.set("format", "json");

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/sparql-results+json"
      }
    });

    if (!response.ok) throw new Error("SPARQL request failed: " + response.status);
    const payload = await response.json();
    return payload && payload.results && payload.results.bindings ? payload.results.bindings : [];
  }

  async function loadMossMetadataMap() {
    try {
      const rows = await fetchSparql(SPARQL_MOSS_ENDPOINT, SPARQL_MOSS_METADATA_QUERY);
      return rows.reduce((acc, row) => {
        const kgUri = row.kgDatabusUri && row.kgDatabusUri.value ? row.kgDatabusUri.value : "";
        const id = extractLastSegment(kgUri);
        const domain = labelizeDomain(row.domain && row.domain.value ? row.domain.value : "");
        const sizeBytes = parseSizeBytes(row.size && row.size.value ? row.size.value : "");
        if (!id) return acc;
        if (!acc[id]) {
          acc[id] = {
            domains: [],
            sizeBytes: 0
          };
        }
        if (domain && !acc[id].domains.includes(domain)) acc[id].domains.push(domain);
        acc[id].sizeBytes = Math.max(acc[id].sizeBytes, sizeBytes);
        return acc;
      }, {});
    } catch (error) {
      console.error("Could not load KG size and domain metadata from Moss:", error);
      return {};
    }
  }

  async function loadCatalogData() {
    try {
      const [rows, mossMetadataById] = await Promise.all([
        fetchSparql(SPARQL_DATABUS_ENDPOINT, SPARQL_CATALOG_QUERY),
        loadMossMetadataMap()
      ]);

      return rows
        .map((row) => {
          const kgUri = row.kg && row.kg.value ? row.kg.value : "";
          const id = extractLastSegment(kgUri);
          if (!id) return null;

          const mossMetadata = mossMetadataById[id] || { domains: [], sizeBytes: 0 };
          const domains = mossMetadata.domains || [];
          return {
            id,
            name: row.kgTitle && row.kgTitle.value ? row.kgTitle.value : labelizeId(id),
            lastUpdated: row.lastModified && row.lastModified.value ? row.lastModified.value : "",
            license: row.license && row.license.value ? row.license.value : "",
            sizeBytes: mossMetadata.sizeBytes || 0,
            kgUri,
            domains,
            domain: domains[0] || "",
            domainLabel: domains.join(", ")
          };
        })
        .filter(Boolean);
    } catch (error) {
      console.error("Could not load browse catalog data from Databus:", error);
      return [];
    }
  }

  document.addEventListener("DOMContentLoaded", async function () {
    const root = document.getElementById("catalog-list");
    root.innerHTML = '<div class="card" style="padding:1rem;">Loading catalog...</div>';
    syncWithQueryParams();

    const data = await loadCatalogData();

    const run = function () {
      const filtered = applyFilters(data, getFilters());
      renderCatalog(filtered);
    };

    ["domain", "sort"].forEach((id) => {
      document.getElementById(id).addEventListener("input", run);
      document.getElementById(id).addEventListener("change", run);
    });

    run();
  });
})();
