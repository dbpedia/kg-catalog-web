(function () {
  const DOMAIN_COLORS = {
    "Cross-domain": "#2d4b8f",
    "Geography & Environment": "#0f8fa6",
    "Government & Public Sector": "#f08c2e",
    "Life Sciences & Health": "#2d8f57",
    "Economy, Industry & Infrastructure": "#8a5e2c",
    "Publications, Education & Research": "#3e67bf",
    "Media, Culture & Entertainment": "#b85c38",
    "Linguistics, Social & Digital Knowledge Systems": "#6f42c1"
  };

  const DEFAULT_LICENSE_LABELS = {
    "http://purl.oclc.org/net/rdflicense/cc-by3.0": "CC-BY-3.0",
    "http://creativecommons.org/licenses/by/4.0": "CC BY 4.0",
    "https://creativecommons.org/licenses/by/4.0": "CC BY 4.0",
    "http://creativecommons.org/licenses/by-sa/4.0": "CC BY-SA 4.0",
    "https://creativecommons.org/licenses/by-sa/4.0": "CC BY-SA 4.0",
    "http://creativecommons.org/licenses/by-nc/4.0": "CC BY-NC 4.0",
    "https://creativecommons.org/licenses/by-nc/4.0": "CC BY-NC 4.0",
    "http://creativecommons.org/publicdomain/zero/1.0": "CC0 1.0",
    "https://creativecommons.org/publicdomain/zero/1.0": "CC0 1.0",
    "http://opendatacommons.org/licenses/odbl/1.0": "ODbL 1.0",
    "https://opendatacommons.org/licenses/odbl/1.0": "ODbL 1.0",
    "http://opendatacommons.org/licenses/pddl/1.0": "PDDL 1.0",
    "https://opendatacommons.org/licenses/pddl/1.0": "PDDL 1.0"
  };

  const LICENSE_LABELS = Object.create(null);

  function normalizeLicenseKey(value) {
    return String(value || "")
      .trim()
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "")
      .toLowerCase();
  }

  function applyLicenseLabels(labels) {
    Object.entries(labels || {}).forEach(([key, label]) => {
      const normalizedKey = normalizeLicenseKey(key);
      if (!normalizedKey || !label) return;
      LICENSE_LABELS[normalizedKey] = String(label);
    });
  }

  async function loadLicenseLabels() {
    try {
      const response = await fetch("assets/data/license-abbreviations.json", {
        method: "GET",
        headers: { Accept: "application/json" }
      });
      if (!response.ok) throw new Error("License mapping request failed: " + response.status);
      const payload = await response.json();
      applyLicenseLabels(payload);
    } catch (error) {
      console.error("Could not load external license abbreviations:", error);
    }
  }

  applyLicenseLabels(DEFAULT_LICENSE_LABELS);
  loadLicenseLabels();

  function getData() {
    return (window.KGCatalogData || []).slice();
  }

  function formatNumber(num) {
    return Number(num || 0).toLocaleString();
  }

  function formatCompact(num) {
    const n = Number(num || 0);
    if (n >= 1e12) return (n / 1e12).toFixed(1) + "T";
    if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return String(n);
  }

  function formatBytes(bytes) {
    const b = Number(bytes || 0);
    const KB = 1000;
    const MB = KB * 1000;
    const GB = MB * 1000;
    const TB = GB * 1000;

    if (b >= TB) return (b / TB).toFixed(1) + " TB";
    if (b >= GB) return (b / GB).toFixed(1) + " GB";
    if (b >= MB) return (b / MB).toFixed(1) + " MB";
    if (b >= KB) return (b / KB).toFixed(1) + " KB";
    return formatNumber(b) + " B";
  }

  function daysSince(dateText) {
    const t = Date.parse(dateText);
    if (Number.isNaN(t)) return 99999;
    return Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
  }

  function formatRelative(dateText) {
    const timestamp = Date.parse(dateText);
    if (Number.isNaN(timestamp)) return "n/a";

    const hours = Math.max(0, Math.floor((Date.now() - timestamp) / (1000 * 60 * 60)));
    if (hours < 24) return hours + (hours === 1 ? " hour ago" : " hours ago");

    const d = Math.floor(hours / 24);
    if (d === 1) return "1 day ago";
    if (d < 30) return d + " days ago";
    const months = Math.floor(d / 30);
    if (months < 12) return months + " month" + (months > 1 ? "s" : "") + " ago";
    const years = Math.floor(months / 12);
    return years + " year" + (years > 1 ? "s" : "") + " ago";
  }

  function formatDateTime(dateText) {
    const timestamp = Date.parse(dateText);
    if (Number.isNaN(timestamp)) return "n/a";
    const date = new Date(timestamp);
    const text = new Intl.DateTimeFormat("en-GB", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: "UTC"
    }).format(date);
    return text + " UTC";
  }

  function formatLicenseInfo(licenseValue) {
    const raw = String(licenseValue || "").trim();
    if (!raw) return { label: "n/a", href: "" };

    const normalized = normalizeLicenseKey(raw);
    const knownLabel = LICENSE_LABELS[normalized];
    if (knownLabel) return { label: knownLabel, href: raw };

    const ccMatch = normalized.match(/creativecommons\.org\/licenses\/([^/]+)\/([0-9.]+)/);
    if (ccMatch) {
      return {
        label: "CC " + ccMatch[1].toUpperCase().replace(/-/g, " ") + " " + ccMatch[2],
        href: raw
      };
    }

    const rdfLicenseCcMatch = normalized.match(/rdflicense\/cc-([a-z-]+)([0-9.]+)/);
    if (rdfLicenseCcMatch) {
      return {
        label: "CC-" + rdfLicenseCcMatch[1].toUpperCase() + "-" + rdfLicenseCcMatch[2],
        href: raw
      };
    }

    const rdfLicenseCcZeroMatch = normalized.match(/rdflicense\/cc-(?:0|zero)([0-9.]*)/);
    if (rdfLicenseCcZeroMatch) {
      return {
        label: rdfLicenseCcZeroMatch[1] ? "CC0-" + rdfLicenseCcZeroMatch[1] : "CC0",
        href: raw
      };
    }

    const spdxMatch = normalized.match(/spdx\.org\/licenses\/([^/]+?)(?:\.html)?$/);
    if (spdxMatch) {
      return {
        label: spdxMatch[1].toUpperCase(),
        href: raw
      };
    }

    const ccZeroMatch = normalized.match(/creativecommons\.org\/publicdomain\/zero\/([0-9.]+)/);
    if (ccZeroMatch) {
      return {
        label: "CC0 " + ccZeroMatch[1],
        href: raw
      };
    }

    const ccPublicDomainMatch = normalized.match(/creativecommons\.org\/publicdomain\/mark\/([0-9.]+)/);
    if (ccPublicDomainMatch) {
      return {
        label: "PDM " + ccPublicDomainMatch[1],
        href: raw
      };
    }

    if (/^https?:\/\//i.test(raw)) return { label: "License", href: raw };
    return { label: raw, href: "" };
  }

  function colorForDomain(domain) {
    return DOMAIN_COLORS[domain] || "#2d4b8f";
  }

  function setActiveNav() {
    const body = document.body;
    const page = body.getAttribute("data-page");
    if (!page) return;
    document.querySelectorAll(".nav-links a").forEach((a) => {
      a.classList.toggle("active", a.getAttribute("data-page") === page);
    });
  }

  window.KGUtils = {
    DOMAIN_COLORS,
    getData,
    formatNumber,
    formatCompact,
    formatBytes,
    daysSince,
    formatRelative,
    formatDateTime,
    formatLicenseInfo,
    colorForDomain,
    setActiveNav
  };

  document.addEventListener("DOMContentLoaded", function () {
    setActiveNav();
  });
})();
