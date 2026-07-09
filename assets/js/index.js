(function () {
  const SPARQL_ENDPOINT = "https://moss.dev.dbpedia.link/sparql";
  const SPARQL_DATABUS_ENDPOINT = "https://databus.dbpedia.org/sparql";
  const SPARQL_QUERY = `PREFIX databus: <https://dataid.dbpedia.org/databus#>
PREFIX dcat: <http://www.w3.org/ns/dcat#>
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
PREFIX dcterms: <http://purl.org/dc/terms/>

select ?kgDatabusUri ?size ?homepage ?domain where {
  ?kgDatabusUri a databus:Group ;
    dcat:byteSize ?size ;
    foaf:homepage ?homepage ;
    dcterms:subject ?domain .
}`;

  const SPARQL_LARGEST_QUERY = `PREFIX databus: <https://dataid.dbpedia.org/databus#>
PREFIX dcat: <http://www.w3.org/ns/dcat#>

SELECT ?kg ?size WHERE {
  ?kg a databus:Group ;
      dcat:byteSize ?size .
}
ORDER BY DESC(xsd:integer(?size))
LIMIT 5`;

  const SPARQL_LATEST_QUERY = `PREFIX dcat: <http://www.w3.org/ns/dcat#>
PREFIX databus: <https://dataid.dbpedia.org/databus#>
PREFIX dct: <http://purl.org/dc/terms/>

SELECT ?kg ?kgTitle (MAX(?modified) AS ?lastModified)
WHERE {
    ?kg databus:account <https://databus.dbpedia.org/knowledge-graph-catalog> .
    ?kg dct:title ?kgTitle .
    ?version databus:group ?kg .
    ?version dct:modified ?modified .
}
GROUP BY ?kg ?kgTitle
ORDER BY DESC(?lastModified)
LIMIT 5`;

  const SPARQL_UPDATED_30D_QUERY = `PREFIX databus: <https://dataid.dbpedia.org/databus#>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

SELECT (COUNT(DISTINCT ?kg) AS ?updatedKGs)
WHERE {
    ?kg databus:account <https://databus.dbpedia.org/knowledge-graph-catalog> .
    ?version databus:group ?kg ;
             dct:modified ?modified .

    FILTER(?modified >= NOW() - "P30D"^^xsd:dayTimeDuration)
}`;

  const SPARQL_TOTAL_SIZE_QUERY = `PREFIX databus: <https://dataid.dbpedia.org/databus#>
PREFIX dcat: <http://www.w3.org/ns/dcat#>

SELECT (SUM(?size) AS ?totalBytes)
WHERE {
  {
    SELECT DISTINCT ?distribution ?size
    WHERE {
      ?group databus:account <https://databus.dbpedia.org/knowledge-graph-catalog> .

      ?artifact databus:group ?group .

      ?artifactVersion databus:artifact ?artifact ;
                       dcat:distribution ?distribution .

      ?distribution dcat:byteSize ?size .
    }
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

  function extractLastSegment(value) {
    const text = String(value || "").replace(/\/+$/, "");
    const hashIndex = text.lastIndexOf("#");
    const slashIndex = text.lastIndexOf("/");
    const index = Math.max(hashIndex, slashIndex);
    return index >= 0 ? text.slice(index + 1) : text;
  }

  function labelizeId(id) {
    if (!id) return "Unknown KG";
    if (/^[a-z]{2,5}$/.test(id)) return id.toUpperCase();
    return id
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (match) => match.toUpperCase());
  }

  function labelizeDomain(value) {
    const segment = extractLastSegment(value);
    if (segment.toLowerCase() === "cross-domain") return "Cross-domain";
    return labelizeId(segment);
  }

  function parseSizeBytes(value) {
    const size = Number(value);
    return Number.isFinite(size) ? size : 0;
  }

  function extractKgId(uri) {
    return extractLastSegment(uri);
  }

  function firstSentence(text) {
    const value = String(text || "").trim();
    if (!value) return "";
    const match = value.match(/^[\s\S]*?[.!?](?=\s|$)/);
    return (match ? match[0] : value).trim();
  }

  function normalizeCatalogRows(rows) {
    const grouped = new Map();

    rows.forEach((row) => {
      const kgDatabusUri = row.kgDatabusUri?.value || "";
      const id = extractKgId(kgDatabusUri);
      if (!id) return;

      const domain = labelizeDomain(row.domain?.value || "");
      const existing = grouped.get(id) || {
        id,
        name: labelizeId(id),
        domain,
        homepage: row.homepage?.value || "",
        sizeBytes: parseSizeBytes(row.size?.value),
        description: "",
        lastUpdated: "",
        license: "",
        status: "",
        maintainer: "",
        sparql: "",
        domains: [domain],
        kgDatabusUri,
        sourceDomainUri: row.domain?.value || ""
      };

      if (!grouped.has(id)) {
        grouped.set(id, existing);
        return;
      }

      existing.sizeBytes = Math.max(existing.sizeBytes, parseSizeBytes(row.size?.value));
      if (!existing.homepage && row.homepage?.value) existing.homepage = row.homepage.value;
      if (!existing.sourceDomainUri && row.domain?.value) existing.sourceDomainUri = row.domain.value;
      if (!existing.domains.includes(domain)) existing.domains.push(domain);
    });

    return Array.from(grouped.values()).map((item) => ({
      ...item,
      domain: item.domains[0] || item.domain,
      domainLabel: item.domains.join(", ")
    }));
  }

  async function loadCatalogData() {
    try {
      const url = new URL(SPARQL_ENDPOINT);
      url.searchParams.set("query", SPARQL_QUERY);
      url.searchParams.set("format", "json");

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/sparql-results+json"
        }
      });

      if (!response.ok) throw new Error("SPARQL request failed: " + response.status);
      const payload = await response.json();
      const rows = payload?.results?.bindings || [];
      return normalizeCatalogRows(rows);
    } catch (error) {
      console.error("Could not load live catalog data from Moss:", error);
      return [];
    }
  }

  async function loadLargestCatalogData() {
    try {
      const url = new URL(SPARQL_ENDPOINT);
      url.searchParams.set("query", SPARQL_LARGEST_QUERY);
      url.searchParams.set("format", "json");

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/sparql-results+json"
        }
      });

      if (!response.ok) throw new Error("SPARQL request failed: " + response.status);
      const payload = await response.json();
      const rows = payload?.results?.bindings || [];

      return rows
        .map((row) => {
          const groupUri = row.kg?.value || "";
          const id = extractKgId(groupUri);
          if (!id) return null;

          return {
            id,
            sizeBytes: parseSizeBytes(row.size?.value),
            groupUri
          };
        })
        .filter(Boolean);
    } catch (error) {
      console.error("Could not load largest KG rankings from Moss:", error);
      return [];
    }
  }

  async function loadLatestCatalogData() {
    try {
      const url = new URL(SPARQL_DATABUS_ENDPOINT);
      url.searchParams.set("query", SPARQL_LATEST_QUERY);
      url.searchParams.set("format", "json");

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/sparql-results+json"
        }
      });

      if (!response.ok) throw new Error("SPARQL request failed: " + response.status);
      const payload = await response.json();
      const rows = payload?.results?.bindings || [];

      return rows
        .map((row) => {
          const groupUri = row.kg?.value || "";
          const id = extractKgId(groupUri);
          if (!id) return null;

          return {
            id,
            name: row.kgTitle?.value || labelizeId(id),
            lastUpdated: row.lastModified?.value || "",
            groupUri,
            status: "",
            domain: "",
            homepage: ""
          };
        })
        .filter(Boolean);
    } catch (error) {
      console.error("Could not load latest KG updates from Databus:", error);
      return [];
    }
  }

  async function loadUpdatedKGCount() {
    try {
      const url = new URL(SPARQL_DATABUS_ENDPOINT);
      url.searchParams.set("query", SPARQL_UPDATED_30D_QUERY);
      url.searchParams.set("format", "json");

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/sparql-results+json"
        }
      });

      if (!response.ok) throw new Error("SPARQL request failed: " + response.status);
      const payload = await response.json();
      const row = payload?.results?.bindings?.[0];
      return parseSizeBytes(row?.updatedKGs?.value);
    } catch (error) {
      console.error("Could not load 30-day KG update count from Databus:", error);
      return 0;
    }
  }

  async function loadTotalPublishedBytes() {
    try {
      const url = new URL(SPARQL_DATABUS_ENDPOINT);
      url.searchParams.set("query", SPARQL_TOTAL_SIZE_QUERY);
      url.searchParams.set("format", "json");

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/sparql-results+json"
        }
      });

      if (!response.ok) throw new Error("SPARQL request failed: " + response.status);
      const payload = await response.json();
      const row = payload?.results?.bindings?.[0];
      return parseSizeBytes(row?.totalBytes?.value);
    } catch (error) {
      console.error("Could not load total published KG Catalog data size from Databus:", error);
      return 0;
    }
  }

  async function loadKgMetadataMap() {
    try {
      const url = new URL(SPARQL_DATABUS_ENDPOINT);
      url.searchParams.set("query", SPARQL_METADATA_QUERY);
      url.searchParams.set("format", "json");

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/sparql-results+json"
        }
      });

      if (!response.ok) throw new Error("SPARQL request failed: " + response.status);
      const payload = await response.json();
      const rows = payload?.results?.bindings || [];

      return rows.reduce((acc, row) => {
        const kgUri = row.kg?.value || "";
        const id = extractKgId(kgUri);
        if (!id) return acc;

        acc[id] = {
          name: row.kgTitle?.value || labelizeId(id),
          description: row.kgDescription?.value || "",
          lastUpdated: row.lastModified?.value || "",
          license: row.license?.value || ""
        };
        return acc;
      }, {});
    } catch (error) {
      console.error("Could not load KG metadata from Databus:", error);
      return {};
    }
  }

  function createTotalSizeCounter() {
    const statTotalSize = document.getElementById("statTotalSize");
    if (!statTotalSize) return null;

    const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      return {
        setTarget(totalPublishedBytes) {
          statTotalSize.textContent = KGUtils.formatBytes(totalPublishedBytes || 0);
        }
      };
    }

    let current = 1000 * 1000 * 1000;
    let start = current;
    let target = 1000 * 1000 * 1000 * 1000;
    let duration = 3000;
    let startedAt = performance.now();
    let frameId = null;

    function tick(now) {
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased = progress * progress;
      current = start + (target - start) * eased;
      statTotalSize.textContent = KGUtils.formatBytes(current);

      if (progress < 1) {
        frameId = window.requestAnimationFrame(tick);
      } else {
        statTotalSize.textContent = KGUtils.formatBytes(target);
      }
    }

    statTotalSize.textContent = KGUtils.formatBytes(current);
    frameId = window.requestAnimationFrame(tick);

    return {
      setTarget(totalPublishedBytes) {
        const nextTarget = Number(totalPublishedBytes || 0);
        if (!Number.isFinite(nextTarget) || nextTarget <= 1) {
          statTotalSize.textContent = KGUtils.formatBytes(nextTarget);
          return;
        }

        if (frameId) window.cancelAnimationFrame(frameId);
        start = current;
        target = nextTarget;
        duration = 500;
        startedAt = performance.now();
        frameId = window.requestAnimationFrame(tick);
      }
    };
  }

  function renderStats(data, updatedCount) {
    const countsByDomain = data.reduce((acc, item) => {
      acc[item.domain] = (acc[item.domain] || 0) + 1;
      return acc;
    }, {});
    const topDomain = Object.entries(countsByDomain).sort((a, b) => b[1] - a[1])[0] || ["-", 0];
    const statGraphs = document.getElementById("statGraphs");
    const statUpdated30 = document.getElementById("statUpdated30");
    const statTopDomain = document.getElementById("statTopDomain");

    if (!statGraphs || !statUpdated30 || !statTopDomain) return;

    statGraphs.textContent = KGUtils.formatNumber(data.length);
    statUpdated30.textContent = KGUtils.formatNumber(updatedCount || 0);
    statTopDomain.textContent = topDomain[0] + " (" + topDomain[1] + " KGs)";
  }

  function renderLargest(data) {
    const root = document.getElementById("largest-list");
    const sorted = data.slice().sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0)).slice(0, 5);
    if (!sorted.length) {
      root.innerHTML = '<li class="list-item"><div class="meta">No KG data returned from Databus.</div></li>';
      return;
    }
    root.innerHTML = sorted
      .map((item, i) => {
        return (
          '<li class="list-item">' +
          '<div class="rank">#' +
          (i + 1) +
          "</div>" +
          '<div><a class="name" href="kg.html?id=' +
          encodeURIComponent(item.id) +
          '">' +
          item.name +
          '</a><div class="meta">' +
          (item.domainLabel || item.domain || "Unknown domain") +
          "</div></div>" +
          '<div class="value">' +
          KGUtils.formatBytes(item.sizeBytes || 0) +
          "</div>" +
          "</li>"
        );
      })
      .join("");
  }

  function renderLatest(data) {
    const root = document.getElementById("latest-list");
    const withDates = data.filter((item) => item.lastUpdated);
    if (!withDates.length) {
      root.innerHTML = '<li class="list-item"><div class="meta">No update dates are available from the Databus query.</div></li>';
      return;
    }
    const sorted = withDates.sort((a, b) => KGUtils.daysSince(a.lastUpdated) - KGUtils.daysSince(b.lastUpdated)).slice(0, 5);
    root.innerHTML = sorted
      .map((item, i) => {
        return (
          '<li class="list-item">' +
          '<div class="rank">#' +
          (i + 1) +
          '</div>' +
          '<div><a class="name" href="kg.html?id=' +
          encodeURIComponent(item.id) +
          '">' +
          item.name +
          '</a><div class="meta">' +
          (item.domainLabel || item.domain || "Unknown domain") +
          "</div></div>" +
          '<div class="value">' +
          KGUtils.formatRelative(item.lastUpdated) +
          "</div>" +
          "</li>"
        );
      })
      .join("");
  }

  function renderViz(data) {
    if (!window.d3) return;

    const card = document.querySelector(".graph-card");
    const svg = window.d3.select("#graph");
    const tooltip = document.getElementById("tooltip");
    const panel = document.getElementById("panel");

    if (!card || !tooltip || !panel) return;

    if (!data.length) {
      svg.selectAll("*").remove();
      svg.append("text")
        .attr("x", "50%")
        .attr("y", "50%")
        .attr("text-anchor", "middle")
        .attr("fill", "#5b6472")
        .style("font-size", "14px")
        .text("No KG data returned from Moss.");
      return;
    }

    const domains = Array.from(new Set(data.map((item) => item.domain)));
    const vizData = data;
    let rootPreviewLabelIds = new Set();
    const hierarchyData = {
      name: "root",
      children: domains.map((domain) => ({
        name: domain,
        children: vizData.filter((item) => item.domain === domain)
      }))
    };
    const domainCounts = data.reduce((acc, item) => {
      acc[item.domain] = (acc[item.domain] || 0) + 1;
      return acc;
    }, {});
    const countValues = Object.values(domainCounts);
    const minCount = countValues.length ? Math.min.apply(null, countValues) : 0;
    const maxCount = countValues.length ? Math.max.apply(null, countValues) : 0;

    function domainLabelSize(domain) {
      const count = domainCounts[domain] || 1;
      if (minCount === maxCount) return 13;
      const ratio = (count - minCount) / (maxCount - minCount);
      return 11 + ratio * 7;
    }

    function circleWeight(item) {
      return item ? 1 : 0;
    }

    function size() {
      return [card.clientWidth, card.clientHeight];
    }

    let dims = size();
    let W = dims[0];
    let H = dims[1];
    const VIEW_PADDING_FACTOR = 1.04;

    function pack() {
      return window.d3
        .pack()
        .size([W, H])
        .padding((d) => (d.depth === 1 ? 6 : 2))(
          window.d3
            .hierarchy(hierarchyData)
            .sum((d) => circleWeight(d))
            .sort((a, b) => b.value - a.value)
        );
    }

    function buildRootPreviewLabelIds(packedRoot) {
      const ids = new Set();
      (packedRoot.children || []).forEach((domainNode) => {
        const leaves = (domainNode.children || []).filter((leaf) => !leaf.children && leaf.data && leaf.data.id);
        if (!leaves.length) return;

        const outerLeaves = leaves.filter((leaf) => {
          const dist = Math.hypot(leaf.x - domainNode.x, leaf.y - domainNode.y);
          return dist >= domainNode.r * 0.68;
        });

        const candidates = outerLeaves.length ? outerLeaves : leaves;

        candidates.sort((a, b) => {
          const aDist = Math.hypot(a.x - domainNode.x, a.y - domainNode.y);
          const bDist = Math.hypot(b.x - domainNode.x, b.y - domainNode.y);
          return bDist - aDist;
        });

        ids.add(candidates[0].data.id);
      });
      return ids;
    }

    let root = pack();
    rootPreviewLabelIds = buildRootPreviewLabelIds(root);
    let focus = root;
    let view;

    function showAtRootPreview(d) {
      return d.depth === 2 && rootPreviewLabelIds.has(d.data.id);
    }

    function labelVisibleForFocus(d, focusNode) {
      return d.parent === focusNode;
    }

    function kgLabelSizeForFocus(d, focusNode) {
      const px = focusNode === root
        ? Math.max(6, Math.min(8, d.r * 0.2))
        : Math.max(12, Math.min(18, d.r * 0.5));
      return px + "px";
    }

    function labelFontSizeForFocus(d, focusNode) {
      if (d.depth === 1) return domainLabelSize(d.data.name) + "px";
      if (d.depth === 2) return kgLabelSizeForFocus(d, focusNode);
      return "10px";
    }

    function labelOpacityForFocus(d, focusNode) {
      if (!labelVisibleForFocus(d, focusNode)) return 0;
      return 1;
    }

    function viewTarget(node) {
      return [node.x, node.y, node.r * 2 * VIEW_PADDING_FACTOR];
    }

    svg.selectAll("*").remove();
    svg.attr("viewBox", "-" + W / 2 + " -" + H / 2 + " " + W + " " + H).on("click", function (event) {
      if (focus !== root) zoom(event, root);
    });

    const gNode = svg.append("g");
    const node = gNode
      .selectAll("circle")
      .data(root.descendants().slice(1))
      .join("circle")
      .attr("fill", (d) => {
        if (d.children) return KGUtils.colorForDomain(d.data.name) + "20";
        return KGUtils.colorForDomain(d.data.domain) + "88";
      })
      .attr("stroke", (d) => {
        if (d.children) return KGUtils.colorForDomain(d.data.name);
        return "#ffffff";
      })
      .attr("stroke-width", (d) => (d.children ? 1.4 : 2))
      .style("cursor", (d) => (d.children ? "zoom-in" : "pointer"))
      .on("mouseenter", function (e, d) {
        window.d3.select(e.currentTarget).attr("stroke", d.children ? KGUtils.colorForDomain(d.data.name) : "#1a2333");
        if (d.children) {
          tooltip.innerHTML = "<b>" + d.data.name + "</b>" + d.children.length + " graphs";
        } else {
          tooltip.innerHTML =
            "<b>" +
            d.data.name +
            "</b>" +
            d.data.domain +
            " · " +
            KGUtils.formatBytes(d.data.sizeBytes || 0) +
            " dump size";
        }
        tooltip.style.opacity = 1;
        moveTip(e);
      })
      .on("mousemove", moveTip)
      .on("mouseleave", function () {
        tooltip.style.opacity = 0;
      })
      .on("click", function (event, d) {
        event.stopPropagation();
        if (d.children) {
          if (focus !== d) zoom(event, d);
        } else if (!d.data.isFiller) {
          openPanel(d.data);
        }
      });

    const label = svg
      .append("g")
      .attr("text-anchor", "middle")
      .attr("pointer-events", "none")
      .selectAll("text")
      .data(root.descendants())
      .join("text")
      .attr("class", "node-label")
      .style("font-size", (d) => labelFontSizeForFocus(d, root))
      .style("font-weight", (d) => (d.depth === 1 ? 700 : 600))
      .style("fill", (d) => (d.depth === 1 ? KGUtils.colorForDomain(d.data.name) : "#fff"))
      .style("fill-opacity", (d) => labelOpacityForFocus(d, root))
      .style("display", (d) => (labelVisibleForFocus(d, root) ? "inline" : "none"))
      .text((d) => {
        if (d.children) return d.data.name;
        return d.data.name;
      });

    function moveTip(e) {
      const rect = card.getBoundingClientRect();
      tooltip.style.left = e.clientX - rect.left + "px";
      tooltip.style.top = e.clientY - rect.top + "px";
    }

    function zoomTo(v) {
      const k = Math.min(W, H) / v[2];
      view = v;
      label.attr("transform", (d) => "translate(" + (d.x - v[0]) * k + "," + (d.y - v[1]) * k + ")");
      node.attr("transform", (d) => "translate(" + (d.x - v[0]) * k + "," + (d.y - v[1]) * k + ")");
      node.attr("r", (d) => d.r * k);
    }

    function zoom(event, d) {
      focus = d;

      const transition = svg
        .transition()
        .duration(700)
        .tween("zoom", function () {
          const i = window.d3.interpolateZoom(view, viewTarget(focus));
          return function (t) {
            zoomTo(i(t));
          };
        });

      label
        .filter(function (ld) {
          return labelVisibleForFocus(ld, focus) || this.style.display === "inline";
        })
        .transition(transition)
        .style("font-size", (ld) => labelFontSizeForFocus(ld, focus))
        .style("fill-opacity", (ld) => labelOpacityForFocus(ld, focus))
        .on("start", function (ld) {
          if (labelVisibleForFocus(ld, focus)) this.style.display = "inline";
        })
        .on("end", function (ld) {
          if (!labelVisibleForFocus(ld, focus)) this.style.display = "none";
        });
    }

    function openPanel(kg) {
      const tag = document.getElementById("pTag");
      tag.textContent = kg.domain;
      tag.style.background = KGUtils.colorForDomain(kg.domain) + "22";
      tag.style.color = KGUtils.colorForDomain(kg.domain);

      document.getElementById("pName").textContent = kg.name;
      document.getElementById("pDesc").textContent = firstSentence(kg.description) || "Description not provided in the Databus query.";
      document.getElementById("pTriples").textContent = KGUtils.formatBytes(kg.sizeBytes || 0);
      document.getElementById("pUpdated").textContent = KGUtils.formatDateTime(kg.lastUpdated);

      const licenseEl = document.getElementById("pLicense");
      const licenseInfo = KGUtils.formatLicenseInfo(kg.license);
      licenseEl.textContent = "";
      if (licenseInfo.href) {
        const a = document.createElement("a");
        a.href = licenseInfo.href;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = licenseInfo.label;
        licenseEl.appendChild(a);
      } else {
        licenseEl.textContent = licenseInfo.label;
      }

      document.getElementById("pHomepage").href = kg.homepage || "#";
      document.getElementById("pProfile").href = "kg.html?id=" + encodeURIComponent(kg.id);
      panel.classList.add("open");
    }

    const close = document.getElementById("panelClose");
    if (close) {
      close.onclick = function () {
        panel.classList.remove("open");
      };
    }

    zoomTo(viewTarget(root));

    window.addEventListener("resize", function () {
      dims = size();
      W = dims[0];
      H = dims[1];
      svg.attr("viewBox", "-" + W / 2 + " -" + H / 2 + " " + W + " " + H);
      root = pack();
      rootPreviewLabelIds = buildRootPreviewLabelIds(root);
      zoomTo(focus === root ? viewTarget(root) : view);
    });
  }

  document.addEventListener("DOMContentLoaded", async function () {
    const totalSizeCounter = createTotalSizeCounter();
    const totalSizePromise = loadTotalPublishedBytes();
    totalSizePromise.then((totalPublishedBytes) => {
      if (totalSizeCounter) totalSizeCounter.setTarget(totalPublishedBytes);
    });

    const [data, largestData, latestData, updatedCount, metadataById] = await Promise.all([
      loadCatalogData(),
      loadLargestCatalogData(),
      loadLatestCatalogData(),
      loadUpdatedKGCount(),
      loadKgMetadataMap()
    ]);
    const enrichedCatalogData = data.map((item) => {
      const metadata = metadataById[item.id] || {};
      return {
        ...item,
        name: metadata.name || item.name,
        description: metadata.description || item.description,
        lastUpdated: metadata.lastUpdated || item.lastUpdated,
        license: metadata.license || item.license
      };
    });
    const domainById = enrichedCatalogData.reduce((acc, item) => {
      if (!acc[item.id]) {
        acc[item.id] = {
          domain: item.domain,
          domainLabel: item.domainLabel || item.domain
        };
      }
      return acc;
    }, {});
    const catalogById = enrichedCatalogData.reduce((acc, item) => {
      if (!acc[item.id]) {
        acc[item.id] = item;
      }
      return acc;
    }, {});
    const enrichedLargestData = largestData.map((item) => {
      const catalogItem = catalogById[item.id] || {};
      return {
        ...item,
        name: catalogItem.name || item.name || labelizeId(item.id),
        domain: catalogItem.domain || item.domain || "",
        domainLabel: catalogItem.domainLabel || item.domainLabel || catalogItem.domain || item.domain || ""
      };
    });
    const enrichedLatestData = latestData.map((item) => {
      const mossDomain = domainById[item.id] || {};
      return {
        ...item,
        domain: mossDomain.domain || item.domain,
        domainLabel: mossDomain.domainLabel || item.domainLabel || mossDomain.domain || item.domain
      };
    });
    renderStats(enrichedCatalogData, updatedCount);
    renderLargest(enrichedLargestData.length ? enrichedLargestData : enrichedCatalogData);
    renderLatest(enrichedLatestData);
    renderViz(enrichedCatalogData);
  });
})();
