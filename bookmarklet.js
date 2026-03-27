/*
  House Hunter bookmarklet source.
  Replace APP_URL if your deployed URL changes, then minify or wrap it as a bookmarklet.
*/
(function () {
  const APP_URL = "https://negwoh.github.io/HouseHunter/";

  function getJsonLd() {
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    for (const script of scripts) {
      try {
        const parsed = JSON.parse(script.textContent.trim());
        if (Array.isArray(parsed)) {
          const found = parsed.find((entry) => entry && (entry.address || entry["@type"] === "House" || entry["@type"] === "Residence"));
          if (found) {
            return found;
          }
        }
        if (parsed && (parsed.address || parsed["@type"] === "House" || parsed["@type"] === "Residence")) {
          return parsed;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  function meta(name) {
    const node = document.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
    return node ? node.getAttribute("content") || "" : "";
  }

  function textContent() {
    return (document.body ? document.body.innerText : document.documentElement.innerText || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function extractNumber(text, regex) {
    const match = text.match(regex);
    return match ? Number(match[1]) : 0;
  }

  function normalizeTime(value) {
    const match = String(value || "").trim().match(/(\d{1,2}):(\d{2})\s?(AM|PM)/i);
    if (!match) {
      return "";
    }
    let hours = Number(match[1]);
    const minutes = match[2];
    const period = match[3].toUpperCase();
    if (period === "PM" && hours !== 12) {
      hours += 12;
    }
    if (period === "AM" && hours === 12) {
      hours = 0;
    }
    return `${String(hours).padStart(2, "0")}:${minutes}`;
  }

  function openHomeWindow(text) {
    const match = text.match(/Open homes?\s*(?:.+?)?(\d{1,2}:\d{2}\s?(?:AM|PM))\s*-\s*(\d{1,2}:\d{2}\s?(?:AM|PM))/i);
    return {
      openStart: match ? normalizeTime(match[1]) : "",
      openEnd: match ? normalizeTime(match[2]) : ""
    };
  }

  function pickAddress(jsonLd, pageTitle) {
    if (jsonLd && jsonLd.address) {
      if (typeof jsonLd.address === "string") {
        return jsonLd.address;
      }
      return [
        jsonLd.address.streetAddress,
        jsonLd.address.addressLocality,
        jsonLd.address.addressRegion
      ].filter(Boolean).join(", ");
    }
    return pageTitle
      .replace(/\s+\|\s+Realestate\.co\.nz.*$/i, "")
      .replace(/\s+-\s+realestate\.co\.nz.*$/i, "")
      .trim();
  }

  function encodeBase64Url(input) {
    const bytes = new TextEncoder().encode(input);
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll(/=+$/g, "");
  }

  function getListingLinks() {
    const seen = new Set();
    return Array.from(document.querySelectorAll("a[href]"))
      .map((anchor) => {
        try {
          const url = new URL(anchor.href, window.location.href);
          if (!/realestate\.co\.nz$/i.test(url.hostname) || !/\/\d{6,}/.test(url.pathname)) {
            return null;
          }
          const cleanUrl = `${url.origin}${url.pathname}`;
          if (seen.has(cleanUrl)) {
            return null;
          }
          seen.add(cleanUrl);
          const title = (anchor.textContent || anchor.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
          return {
            listingUrl: cleanUrl,
            title
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  function openHouseHunter(params) {
    const search = new URLSearchParams(params);
    window.open(`${APP_URL}?${search.toString()}`, "_blank", "noopener,noreferrer");
  }

  const jsonLd = getJsonLd();
  const text = textContent();
  const title = document.title || meta("og:title") || "";
  const description = meta("description") || meta("og:description") || "";
  const currentUrl = new URL(window.location.href);
  const likelySingleListing = Boolean(
    (jsonLd && jsonLd.address) ||
    /\/\d{6,}/.test(currentUrl.pathname) ||
    /Open homes?/i.test(text) ||
    /(\d+)\s+bed/i.test(text)
  );

  if (!likelySingleListing) {
    const listings = getListingLinks();
    if (listings.length) {
      openHouseHunter({
        prefill_list: encodeBase64Url(JSON.stringify({ listings }))
      });
      return;
    }
  }

  const address = pickAddress(jsonLd, title);
  const suburb = address.split(",").map((part) => part.trim()).filter(Boolean)[1] || "";
  const windowData = openHomeWindow(text);
  const lat = Number(
    (document.documentElement.innerHTML.match(/"latitude"\s*:\s*"?(?<value>-?\d+\.\d+)/i) || {}).groups?.value || ""
  );
  const lng = Number(
    (document.documentElement.innerHTML.match(/"longitude"\s*:\s*"?(?<value>-?\d+\.\d+)/i) || {}).groups?.value || ""
  );

  const property = {
    address,
    suburb,
    openStart: windowData.openStart,
    openEnd: windowData.openEnd,
    beds: extractNumber(text, /(\d+)\s+bed/i),
    baths: extractNumber(text, /(\d+)\s+bath/i),
    parking: extractNumber(text, /(\d+)\s+(car|park|garage)/i),
    lat: Number.isFinite(lat) ? lat : "",
    lng: Number.isFinite(lng) ? lng : "",
    priceEstimate: (text.match(/(\$\s?[\d,.]+(?:\s?-\s?\$\s?[\d,.]+)?(?:\s?[mMkK])?)/) || [])[1] || "",
    listingUrl: window.location.href,
    notes: description,
    checklist: [
      "Confirm open home time",
      "Check listing details against the property in person",
      "Review downloaded documents"
    ]
  };

  openHouseHunter({
    prefill: encodeBase64Url(JSON.stringify(property))
  });
})();
