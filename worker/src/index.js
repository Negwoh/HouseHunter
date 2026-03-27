export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: buildCorsHeaders(request, env) });
    }

    if (url.pathname !== "/import") {
      return json({ error: "Not found." }, 404, request, env);
    }

    const listingUrl = url.searchParams.get("url");
    if (!listingUrl) {
      return json({ error: "Missing url parameter." }, 400, request, env);
    }

    if (!isAllowedListingUrl(listingUrl)) {
      return json({ error: "Only realestate.co.nz URLs are allowed." }, 400, request, env);
    }

    try {
      const response = await fetch(listingUrl, {
        headers: {
          "user-agent": "HouseHunterImportWorker/1.0"
        }
      });

      if (!response.ok) {
        return json({ error: `Listing fetch failed with status ${response.status}.` }, 502, request, env);
      }

      const html = await response.text();
      const property = parseListing(html, listingUrl);
      return json({ property }, 200, request, env);
    } catch (error) {
      return json({ error: error.message || "Failed to import listing." }, 500, request, env);
    }
  }
};

function parseListing(html, listingUrl) {
  const jsonLd = extractJsonLd(html);
  const address = firstNonEmpty(
    jsonLd && jsonLd.address && formatAddress(jsonLd.address),
    extractMeta(html, "og:title"),
    extractTitleAddress(html)
  );

  const description = firstNonEmpty(
    extractMeta(html, "description"),
    jsonLd && jsonLd.description,
    ""
  );

  const text = stripTags(html);
  const openWindow = extractOpenHomeWindow(text);
  const priceEstimate = firstNonEmpty(
    extractPrice(text),
    extractMeta(html, "og:description"),
    ""
  );

  return {
    address: cleanAddress(address),
    suburb: extractSuburb(address),
    openStart: openWindow.openStart,
    openEnd: openWindow.openEnd,
    beds: extractNumber(text, /(\d+)\s+bed/i),
    baths: extractNumber(text, /(\d+)\s+bath/i),
    parking: extractNumber(text, /(\d+)\s+(car|park|garage)/i),
    priceEstimate: priceEstimate || "Imported listing",
    notes: description,
    checklist: [
      "Confirm open home time",
      "Check listing details against the property in person",
      "Review downloaded documents"
    ],
    lat: extractCoordinate(html, /"latitude"\s*:\s*"?(?<value>-?\d+\.\d+)/i),
    lng: extractCoordinate(html, /"longitude"\s*:\s*"?(?<value>-?\d+\.\d+)/i),
    sourceUrl: listingUrl
  };
}

function extractJsonLd(html) {
  const matches = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];

  for (const match of matches) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (Array.isArray(parsed)) {
        const item = parsed.find((entry) => entry && (entry["@type"] === "House" || entry["@type"] === "Residence" || entry.address));
        if (item) {
          return item;
        }
      }
      if (parsed && (parsed["@type"] === "House" || parsed["@type"] === "Residence" || parsed.address)) {
        return parsed;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function extractMeta(html, name) {
  const regex = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`, "i");
  return decodeHtml(regex.exec(html)?.[1] || "");
}

function extractTitleAddress(html) {
  return decodeHtml(html.match(/<title>([^<]+)<\/title>/i)?.[1] || "");
}

function extractOpenHomeWindow(text) {
  const match = text.match(/Open homes?\s*(?:.+?)?(\d{1,2}:\d{2}\s?(?:AM|PM))\s*-\s*(\d{1,2}:\d{2}\s?(?:AM|PM))/i);
  if (!match) {
    return { openStart: "", openEnd: "" };
  }

  return {
    openStart: normalizeTime(match[1]),
    openEnd: normalizeTime(match[2])
  };
}

function extractPrice(text) {
  const match = text.match(/(\$\s?[\d,.]+(?:\s?-\s?\$\s?[\d,.]+)?(?:\s?[mMkK])?)/);
  return match ? match[1].replace(/\s+/g, " ").trim() : "";
}

function extractNumber(text, regex) {
  const match = text.match(regex);
  return match ? Number(match[1]) : 0;
}

function extractCoordinate(html, regex) {
  const match = html.match(regex);
  return match ? Number(match.groups.value) : "";
}

function formatAddress(address) {
  if (!address) {
    return "";
  }

  if (typeof address === "string") {
    return address;
  }

  return [
    address.streetAddress,
    address.addressLocality,
    address.addressRegion
  ].filter(Boolean).join(", ");
}

function cleanAddress(address) {
  return String(address || "")
    .replace(/\s+\|\s+Realestate\.co\.nz.*$/i, "")
    .replace(/\s+-\s+realestate\.co\.nz.*$/i, "")
    .trim();
}

function extractSuburb(address) {
  const parts = String(address || "").split(",").map((part) => part.trim()).filter(Boolean);
  return parts[1] || "";
}

function stripTags(html) {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function decodeHtml(value) {
  return String(value)
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function normalizeTime(value) {
  const match = String(value).trim().match(/(\d{1,2}):(\d{2})\s?(AM|PM)/i);
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

function firstNonEmpty(...values) {
  return values.find((value) => value && String(value).trim()) || "";
}

function isAllowedListingUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname === "www.realestate.co.nz" || url.hostname === "realestate.co.nz";
  } catch {
    return false;
  }
}

function buildCorsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowedOrigin = origin.startsWith(env.ALLOWED_ORIGIN) ? origin : env.ALLOWED_ORIGIN;

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function json(payload, status, request, env) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...buildCorsHeaders(request, env)
    }
  });
}
