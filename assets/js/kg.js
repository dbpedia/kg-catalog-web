(function () {
  const SPARQL_MOSS_ENDPOINT = "https://moss.dev.dbpedia.link/sparql";
  const SPARQL_DATABUS_ENDPOINT = "https://databus.dbpedia.org/sparql";

  const SPARQL_MOSS_QUERY = `PREFIX databus: <https://dataid.dbpedia.org/databus#>
PREFIX dcat: <http://www.w3.org/ns/dcat#>
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
PREFIX dcterms: <http://purl.org/dc/terms/>
PREFIX schema: <https://schema.org/>
PREFIX void: <http://rdfs.org/ns/void#>

SELECT ?kgDatabusUri ?size ?homepage ?domain ?keyword ?sparqlEndpoint ?maintainerName ?maintainerMbox
WHERE {
  ?kgDatabusUri a databus:Group ;
    dcat:byteSize ?size ;
    foaf:homepage ?homepage ;
    dcterms:subject ?domain .

  OPTIONAL { ?kgDatabusUri schema:keywords ?keyword . }
  OPTIONAL { ?kgDatabusUri void:sparqlEndpoint ?sparqlEndpoint . }
  OPTIONAL {
    ?kgDatabusUri schema:maintainer ?maintainer .
    ?maintainer foaf:name ?maintainerName .
    OPTIONAL { ?maintainer foaf:mbox ?maintainerMbox . }
  }
}`;

  const SPARQL_METADATA_QUERY = `PREFIX dcat: <http://www.w3.org/ns/dcat#>
PREFIX databus: <https://dataid.dbpedia.org/databus#>
PREFIX dct: <http://purl.org/dc/terms/>

SELECT ?kg ?kgTitle ?kgDescription ?lastModified (SAMPLE(?license) AS ?license)
WHERE {
  {
    SELECT ?kg ?kgDescription (MAX(?modified) AS ?lastModified)
    WHERE {
      ?kg databus:account <https://databus.dbpedia.org/knowledge-graph-catalog> .
      OPTIONAL {
        ?kg dct:description ?kgDescription .
      }
      ?version databus:group ?kg ;
               dct:modified ?modified .
    }
    GROUP BY ?kg ?kgDescription
  }

  ?kg dct:title ?kgTitle .

  OPTIONAL {
    ?version databus:group ?kg ;
             dct:license ?license .
  }
}
GROUP BY ?kg ?kgTitle ?kgDescription ?lastModified
ORDER BY DESC(?lastModified)`;

  function e(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function sanitizeHref(href) {
    const raw = String(href || "").trim();
    if (!raw) return "";
    try {
      const parsed = new URL(raw, window.location.origin);
      const protocol = parsed.protocol.toLowerCase();
      if (protocol === "http:" || protocol === "https:" || protocol === "mailto:") return parsed.href;
      return "";
    } catch {
      return "";
    }
  }

  function renderMarkdown(text) {
    const source = String(text || "").trim();
    if (!source) return "";

    function parseTableRow(line) {
      const trimmed = String(line || "").trim();
      if (!trimmed.includes("|")) return [];
      let content = trimmed;
      if (content.startsWith("|")) content = content.slice(1);
      if (content.endsWith("|")) content = content.slice(0, -1);
      return content.split("|").map(function (cell) {
        return cell.trim();
      });
    }

    function isTableSeparator(line) {
      const cells = parseTableRow(line);
      if (!cells.length) return false;
      return cells.every(function (cell) {
        return /^:?-{3,}:?$/.test(cell.replace(/\s+/g, ""));
      });
    }

    function renderInline(inlineText) {
      const links = [];
      const withLinkTokens = inlineText.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, label, href) {
        const token = "@@LINK" + links.length + "@@";
        links.push({ label: String(label || ""), href: sanitizeHref(href) });
        return token;
      });

      let html = e(withLinkTokens);
      html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
      html = html.replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>");
      html = html.replace(/__([\s\S]+?)__/g, "<strong>$1</strong>");
      html = html.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
      html = html.replace(/_([^_\n]+)_/g, "<em>$1</em>");

      links.forEach(function (link, index) {
        const token = "@@LINK" + index + "@@";
        const rendered = link.href
          ? '<a target="_blank" rel="noopener" href="' + e(link.href) + '">' + e(link.label) + "</a>"
          : e(link.label);
        html = html.replace(token, rendered);
      });

      html = html.replace(/\n/g, "<br>");

      return html;
    }

    const blocks = source.split(/\n\s*\n/);
    return blocks
      .map(function (block) {
        const trimmed = block.trim();
        if (!trimmed) return "";

        const lines = trimmed.split(/\n+/);
        const isTable =
          lines.length >= 2 &&
          lines[0].includes("|") &&
          isTableSeparator(lines[1]);
        const isBulletList = lines.every(function (line) {
          return /^\s*[-*]\s+/.test(line);
        });

        if (isTable) {
          const headerCells = parseTableRow(lines[0]);
          const bodyRows = lines.slice(2).filter(function (line) {
            return line.trim();
          });

          const thead =
            "<thead><tr>" +
            headerCells
              .map(function (cell) {
                return "<th>" + renderInline(cell) + "</th>";
              })
              .join("") +
            "</tr></thead>";

          const tbody =
            "<tbody>" +
            bodyRows
              .map(function (rowLine) {
                const cells = parseTableRow(rowLine);
                return (
                  "<tr>" +
                  cells
                    .map(function (cell) {
                      return "<td>" + renderInline(cell) + "</td>";
                    })
                    .join("") +
                  "</tr>"
                );
              })
              .join("") +
            "</tbody>";

          return '<div class="md-table-wrap"><table class="md-table">' + thead + tbody + "</table></div>";
        }

        if (isBulletList) {
          const items = lines
            .map(function (line) {
              return line.replace(/^\s*[-*]\s+/, "").trim();
            })
            .filter(Boolean)
            .map(function (line) {
              return "<li>" + renderInline(line) + "</li>";
            })
            .join("");
          return items ? "<ul>" + items + "</ul>" : "";
        }

        return "<p>" + renderInline(lines.join("\n")) + "</p>";
      })
      .join("");
  }

  function parseSizeBytes(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
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
      .replace(/\b\w/g, (m) => m.toUpperCase());
  }

  function labelizeDomain(value) {
    const segment = extractLastSegment(value);
    if (segment.toLowerCase() === "cross-domain") return "Cross-domain";
    return labelizeId(segment);
  }

  function byId(data, id) {
    return data.find((item) => item.id === id);
  }

  function renderLoading() {
    const root = document.getElementById("kg-root");
    root.innerHTML = '<section class="card detail"><h1>Loading profile...</h1><p class="lead">Fetching live data from Moss and Databus.</p></section>';
  }

  function renderNotFound(id) {
    const root = document.getElementById("kg-root");
    root.innerHTML =
      '<section class="card detail"><h1>Knowledge graph not found</h1><p class="lead">No KG with id <strong>' +
      e(id || "") +
      '</strong> was found in the live catalog data.</p><a class="btn primary" href="catalog.html">Go to browse</a></section>';
  }

  function renderKG(item, all) {
    document.title = item.name + " | KG Catalog";
    const root = document.getElementById("kg-root");
    const related = all
      .filter((x) => x.domain === item.domain && x.id !== item.id)
      .sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0))
      .slice(0, 4);

    const lastUpdatedText = item.lastUpdated
      ? e(KGUtils.formatDateTime(item.lastUpdated)) + " (" + e(KGUtils.formatRelative(item.lastUpdated)) + ")"
      : "n/a";

    const licenseInfo = KGUtils.formatLicenseInfo(item.license);
    const licenseText = licenseInfo.href
      ? '<a target="_blank" rel="noopener" href="' + e(licenseInfo.href) + '">' + e(licenseInfo.label) + "</a>"
      : e(licenseInfo.label);

    const homepageButton = item.homepage
      ? '<a class="btn primary" target="_blank" rel="noopener" href="' + e(item.homepage) + '">Homepage</a>'
      : "";
    const sparqlButton = item.sparqlEndpoint
      ? '<a class="btn secondary" target="_blank" rel="noopener" href="' + e(item.sparqlEndpoint) + '">SPARQL endpoint</a>'
      : "";
    const keywordsText = item.keywords && item.keywords.length
      ? item.keywords.map((kw) => e(kw)).join(", ")
      : "n/a";
    const maintainersText = item.maintainers && item.maintainers.length
      ? item.maintainers
          .map((maintainer) => {
            const name = e(maintainer.name || "Unknown maintainer");
            const email = String(maintainer.email || "").trim();
            if (!email) return name;

            const href = /^mailto:/i.test(email) ? email : "mailto:" + email;
            const label = email.replace(/^mailto:/i, "");
            return name + ' (<a target="_blank" rel="noopener" href="' + e(href) + '">' + e(label) + "</a>)";
          })
          .join(", ")
      : "n/a";

    const descriptionHtml = renderMarkdown(item.description || "No description provided in Databus metadata.");

    root.innerHTML =
      '<section class="kg-grid">' +
      '<article class="card detail">' +
      '<span class="domain-tag" style="background:' +
      e(KGUtils.colorForDomain(item.domain)) +
      '">' +
      e(item.domain) +
      "</span>" +
      '<h1 style="margin-top:.6rem;">' +
      e(item.name) +
      "</h1>" +
      '<div class="lead">' +
      descriptionHtml +
      "</div>" +
      '<p class="meta"><strong>Keywords:</strong> ' +
      keywordsText +
      "</p>" +
      '<div class="btn-row">' +
      homepageButton +
      sparqlButton +
      "</div>" +
      '<div class="kv">' +
      "<div>Latest dump size</div><div>" +
      e(KGUtils.formatBytes(item.sizeBytes || 0)) +
      "</div>" +
      "<div>Last update</div><div>" +
      lastUpdatedText +
      "</div>" +
      "<div>License</div><div>" +
      licenseText +
      "</div>" +
      "<div>Maintainer(s)</div><div>" +
      maintainersText +
      "</div>" +
      "<div>Databus page</div><div><a target=\"_blank\" rel=\"noopener\" href=\"" +
      e(item.kgDatabusUri || "") +
      "\">" +
      e(item.kgDatabusUri || "n/a") +
      "</a></div>" +
      "</div>" +
      "</article>" +
      '<aside class="card detail">' +
      "<h2>Related graphs</h2>" +
      '<p class="meta">Same domain: ' +
      e(item.domain) +
      "</p>" +
      '<ul class="list">' +
      related
        .map((r) => {
          return (
            '<li class="list-item">' +
            '<div class="rank">•</div>' +
            '<div><a class="name" href="kg.html?id=' +
            encodeURIComponent(r.id) +
            '">' +
            e(r.name) +
            '</a><div class="meta">Last updated: ' +
            e(r.lastUpdated ? KGUtils.formatRelative(r.lastUpdated) : "n/a") +
            "</div></div>" +
            '<div class="value">' +
            e(KGUtils.formatBytes(r.sizeBytes || 0)) +
            "</div>" +
            "</li>"
          );
        })
        .join("") +
      "</ul>" +
      '<div style="margin-top:0.7rem;"><a class="btn secondary" href="catalog.html?sort=size">Browse all</a></div>' +
      "</aside>" +
      "</section>";
  }

  async function loadCatalogData() {
    const url = new URL(SPARQL_MOSS_ENDPOINT);
    url.searchParams.set("query", SPARQL_MOSS_QUERY);
    url.searchParams.set("format", "json");

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/sparql-results+json" }
    });
    if (!response.ok) throw new Error("Moss request failed: " + response.status);

    const payload = await response.json();
    const rows = payload?.results?.bindings || [];
    const grouped = new Map();

    rows.forEach((row) => {
      const kgDatabusUri = row.kgDatabusUri?.value || "";
      const id = extractLastSegment(kgDatabusUri);
      if (!id) return;

      const domain = labelizeDomain(row.domain?.value || "");
      const existing = grouped.get(id) || {
        id,
        name: labelizeId(id),
        domain,
        homepage: row.homepage?.value || "",
        sparqlEndpoint: row.sparqlEndpoint?.value || "",
        keywords: [],
        maintainers: [],
        sizeBytes: parseSizeBytes(row.size?.value),
        description: "",
        lastUpdated: "",
        license: "",
        kgDatabusUri
      };

      if (!grouped.has(id)) {
        grouped.set(id, existing);
      }

      existing.sizeBytes = Math.max(existing.sizeBytes, parseSizeBytes(row.size?.value));
      if (!existing.homepage && row.homepage?.value) existing.homepage = row.homepage.value;
      if (!existing.sparqlEndpoint && row.sparqlEndpoint?.value) existing.sparqlEndpoint = row.sparqlEndpoint.value;

      const keyword = String(row.keyword?.value || "").trim();
      if (keyword && !existing.keywords.includes(keyword)) existing.keywords.push(keyword);

      const maintainerName = String(row.maintainerName?.value || "").trim();
      const maintainerMbox = String(row.maintainerMbox?.value || "").trim();
      if (maintainerName) {
        const key = maintainerName.toLowerCase() + "|" + maintainerMbox.toLowerCase();
        const exists = existing.maintainers.some((m) => (m.name.toLowerCase() + "|" + m.email.toLowerCase()) === key);
        if (!exists) {
          existing.maintainers.push({
            name: maintainerName,
            email: maintainerMbox
          });
        }
      }
    });

    return Array.from(grouped.values());
  }

  async function loadKgMetadataMap() {
    const url = new URL(SPARQL_DATABUS_ENDPOINT);
    url.searchParams.set("query", SPARQL_METADATA_QUERY);
    url.searchParams.set("format", "json");

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/sparql-results+json" }
    });
    if (!response.ok) throw new Error("Databus request failed: " + response.status);

    const payload = await response.json();
    const rows = payload?.results?.bindings || [];

    return rows.reduce((acc, row) => {
      const kgUri = row.kg?.value || "";
      const id = extractLastSegment(kgUri);
      if (!id) return acc;

      acc[id] = {
        name: row.kgTitle?.value || labelizeId(id),
        description: row.kgDescription?.value || "",
        lastUpdated: row.lastModified?.value || "",
        license: row.license?.value || ""
      };
      return acc;
    }, {});
  }

  document.addEventListener("DOMContentLoaded", async function () {
    const params = new URLSearchParams(window.location.search);
    const id = (params.get("id") || "").trim();
    if (!id) {
      renderNotFound(id);
      return;
    }

    renderLoading();

    try {
      const [catalog, metadataById] = await Promise.all([loadCatalogData(), loadKgMetadataMap()]);
      const merged = catalog.map((item) => {
        const metadata = metadataById[item.id] || {};
        return {
          ...item,
          name: metadata.name || item.name,
          description: metadata.description || item.description,
          lastUpdated: metadata.lastUpdated || item.lastUpdated,
          license: metadata.license || item.license
        };
      });

      const item = byId(merged, id);
      if (!item) {
        renderNotFound(id);
        return;
      }

      renderKG(item, merged);
    } catch (error) {
      console.error("Could not load KG profile data:", error);
      renderNotFound(id);
    }
  });
})();
