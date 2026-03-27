export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: buildCorsHeaders(request, env) });
    }

    if (url.pathname === "/eta") {
      return handleEta(request, env, url);
    }

    if (url.pathname === "/geocode") {
      return handleGeocode(request, env, url);
    }

    if (url.pathname === "/batch-import") {
      return handleBatchImport(request, env);
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
      const property = await parseListing(html, listingUrl, env);
      return json({ property }, 200, request, env);
    } catch (error) {
      return json({ error: error.message || "Failed to import listing." }, 500, request, env);
    }
  }
};

async function handleBatchImport(request, env) {
  if (request.method !== "POST") {
    return json({ error: "Use POST for batch import." }, 405, request, env);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400, request, env);
  }

  const urls = Array.isArray(payload?.urls) ? payload.urls : [];
  const normalizedUrls = [...new Set(urls.map((value) => String(value || "").trim()).filter(Boolean))];

  if (!normalizedUrls.length) {
    return json({ error: "Missing urls array." }, 400, request, env);
  }

  const results = [];

  for (const listingUrl of normalizedUrls.slice(0, 50)) {
    if (!isAllowedListingUrl(listingUrl)) {
      results.push({
        url: listingUrl,
        ok: false,
        error: "Only realestate.co.nz URLs are allowed."
      });
      continue;
    }

    try {
      const property = await importListingFromUrl(listingUrl, env);
      results.push({
        url: listingUrl,
        ok: true,
        property
      });
    } catch (error) {
      results.push({
        url: listingUrl,
        ok: false,
        error: error.message || "Failed to import listing."
      });
    }
  }

  return json({ results }, 200, request, env);
}

async function handleEta(request, env, url) {
  if (!env.GOOGLE_MAPS_API_KEY) {
    return json({ error: "GOOGLE_MAPS_API_KEY is not configured." }, 500, request, env);
  }

  const origin = readLatLng(url, "oLat", "oLng");
  const destination = readLatLng(url, "dLat", "dLng");

  if (!origin || !destination) {
    return json({ error: "Missing or invalid coordinates." }, 400, request, env);
  }

  try {
    const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": env.GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.localizedValues.duration,routes.localizedValues.distance"
      },
      body: JSON.stringify({
        origin: { location: { latLng: origin } },
        destination: { location: { latLng: destination } },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
        departureTime: new Date().toISOString()
      })
    });

    const payload = await response.json();
    if (!response.ok) {
      return json({ error: payload.error?.message || "Google Routes API request failed." }, 502, request, env);
    }

    const firstRoute = payload.routes && payload.routes[0];
    if (!firstRoute) {
      return json({ error: "No route returned." }, 502, request, env);
    }

    const durationSeconds = parseDurationSeconds(firstRoute.duration);
    const durationMinutes = Math.max(1, Math.round(durationSeconds / 60));
    const distanceMeters = Number(firstRoute.distanceMeters || 0);

    return json({
      route: {
        durationMinutes,
        durationLabel: firstRoute.localizedValues?.duration?.text || `${durationMinutes} min`,
        distanceMeters,
        distanceLabel: firstRoute.localizedValues?.distance?.text || `${(distanceMeters / 1000).toFixed(1)} km`
      }
    }, 200, request, env);
  } catch (error) {
    return json({ error: error.message || "ETA lookup failed." }, 500, request, env);
  }
}

async function handleGeocode(request, env, url) {
  if (!env.GOOGLE_MAPS_API_KEY) {
    return json({ error: "GOOGLE_MAPS_API_KEY is not configured." }, 500, request, env);
  }

  const address = String(url.searchParams.get("address") || "").trim();
  const limit = Math.min(10, Math.max(1, Number(url.searchParams.get("limit")) || 5));

  if (!address) {
    return json({ error: "Missing address parameter." }, 400, request, env);
  }

  try {
    const matches = await geocodeAddress(address, env, limit);
    return json({ matches }, 200, request, env);
  } catch (error) {
    return json({ error: error.message || "Address lookup failed." }, 500, request, env);
  }
}

async function importListingFromUrl(listingUrl, env) {
  const response = await fetch(listingUrl, {
    headers: {
      "user-agent": "HouseHunterImportWorker/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Listing fetch failed with status ${response.status}.`);
  }

  const html = await response.text();
  return parseListing(html, listingUrl, env);
}

async function parseListing(html, listingUrl, env) {
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
  const facts = mergePropertyFacts(extractPropertyFactsFromHtmlV3(html), extractPropertyFactsV2(text));
  let coordinates = extractCoordinatesV2(html, jsonLd);
  const priceEstimate = firstNonEmpty(
    extractMarketInsightsPrice(text),
    extractPrice(text),
    extractMeta(html, "og:description"),
    ""
  );

  if (!hasCoordinates(coordinates) && cleanAddress(address) && env.GOOGLE_MAPS_API_KEY) {
    const [match] = await geocodeAddress(cleanAddress(address), env, 1);
    if (match) {
      coordinates = { lat: match.lat, lng: match.lng };
    }
  }

  return {
    address: cleanAddress(address),
    suburb: extractSuburb(address),
    openStart: openWindow.openStart,
    openEnd: openWindow.openEnd,
    beds: facts.beds,
    baths: facts.baths,
    parking: facts.parking,
    sectionSize: facts.sectionSize,
    priceEstimate: priceEstimate || "Imported listing",
    notes: description,
    checklist: [
      "Confirm open home time",
      "Check listing details against the property in person",
      "Review downloaded documents"
    ],
    lat: coordinates.lat,
    lng: coordinates.lng,
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

function extractMarketInsightsPrice(text) {
  const low = extractLabeledAmount(text, "Low");
  const med = extractLabeledAmount(text, "Med");
  const high = extractLabeledAmount(text, "High");
  const parts = [
    low ? `Low ${low}` : "",
    med ? `Med ${med}` : "",
    high ? `High ${high}` : ""
  ].filter(Boolean);

  return parts.length >= 2 ? parts.join(" | ") : "";
}

function extractLabeledAmount(text, label) {
  const pattern = new RegExp(`\\b${label}\\b[^$]{0,40}(\\$\\s?[\\d,.]+(?:\\s?[mMkK])?)`, "i");
  const match = text.match(pattern);
  return match ? match[1].replace(/\s+/g, " ").trim() : "";
}

function extractNumber(text, regex) {
  const match = text.match(regex);
  return match ? Number(match[1]) : 0;
}

function extractPropertyFactsFromHtmlV3(html) {
  return {
    beds: firstMatchingNumberV2(html, [
      /"bedrooms?"\s*:\s*"?(\d+)/i,
      /"numBedrooms?"\s*:\s*"?(\d+)/i,
      /\bbedrooms?\b[^0-9]{0,20}(\d+)\b/i,
      /\b(\d+)\s*(?:bed|bedroom|bedrooms)\b/i
    ]),
    baths: firstMatchingNumberV2(html, [
      /"bathrooms?"\s*:\s*"?(\d+)/i,
      /"numBathrooms?"\s*:\s*"?(\d+)/i,
      /\bbath(?:room)?s?\b[^0-9]{0,20}(\d+)\b/i,
      /\b(\d+)\s*(?:bath|bathroom|bathrooms)\b/i
    ]),
    parking: firstMatchingNumberV2(html, [
      /"parking"\s*:\s*"?(\d+)/i,
      /"garages?"\s*:\s*"?(\d+)/i,
      /\bparking\b[^0-9]{0,20}(\d+)\b/i,
      /\bgarages?\b[^0-9]{0,20}(\d+)\b/i,
      /\b(\d+)\s*(?:car\s*park|carparks?|garage|garages|parking|parks?)\b/i
    ]),
    sectionSize: firstMatchingTextV2(html, [
      /\b(?:land|section|site)\s*(?:area|size)?[^0-9]{0,20}(\d+(?:\.\d+)?)\s*(m2|m\u00b2|sqm|ha)\b/i,
      /"land(?:Area|Size)"\s*:\s*"?(\d+(?:\.\d+)?)\s*(m2|m\u00b2|sqm|ha)\b/i,
      /\b(\d+(?:\.\d+)?)\s*(m2|m\u00b2|sqm|ha)\s*(?:land|section|site)\b/i
    ])
  };
}

function mergePropertyFacts(primary, fallback) {
  return {
    beds: primary.beds || fallback.beds || 0,
    baths: primary.baths || fallback.baths || 0,
    parking: primary.parking || fallback.parking || 0,
    sectionSize: primary.sectionSize || fallback.sectionSize || ""
  };
}

function extractPropertyFactsV2(text) {
  return {
    beds: firstMatchingNumberV2(text, [
      /\b(\d+)\s*(?:bed|bedroom|bedrooms)\b/i,
      /\bbedrooms?\s*:?\s*(\d+)\b/i
    ]),
    baths: firstMatchingNumberV2(text, [
      /\b(\d+)\s*(?:bath|bathroom|bathrooms)\b/i,
      /\bbath(?:room)?s?\s*:?\s*(\d+)\b/i
    ]),
    parking: firstMatchingNumberV2(text, [
      /\b(\d+)\s*(?:car\s*park|carparks?|garage|garages|parking|parks?)\b/i,
      /\b(?:car\s*park|carparks?|garage|garages|parking|parks?)\s*:?\s*(\d+)\b/i
    ]),
    sectionSize: firstMatchingTextV2(text, [
      /\bsection\s*(?:size|area)?\s*:?\s*(\d+(?:\.\d+)?)\s*(m2|m\u00b2|sqm|ha)\b/i,
      /\bland\s*(?:area|size)?\s*:?\s*(\d+(?:\.\d+)?)\s*(m2|m\u00b2|sqm|ha)\b/i,
      /\bsite\s*(?:area|size)?\s*:?\s*(\d+(?:\.\d+)?)\s*(m2|m\u00b2|sqm|ha)\b/i,
      /\b(\d+(?:\.\d+)?)\s*(m2|m\u00b2|sqm|ha)\s*(?:section|land|site)\b/i
    ])
  };
}

function firstMatchingNumberV2(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return Number(match[1]) || 0;
    }
  }
  return 0;
}

function firstMatchingTextV2(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return `${match[1]} ${normalizeAreaUnitV2(match[2])}`;
    }
  }
  return "";
}

function normalizeAreaUnitV2(value) {
  const unit = String(value || "").toLowerCase();
  if (unit === "sqm" || unit === "m2" || unit === "m\u00b2") {
    return "m2";
  }
  return unit;
}

function extractCoordinatesV2(html, jsonLd) {
  const lat = firstCoordinateV2([
    jsonLd && jsonLd.geo && jsonLd.geo.latitude,
    jsonLd && jsonLd.geo && jsonLd.geo.lat,
    extractCoordinateFromPatternV2(html, /"latitude"\s*:\s*"?(?<value>-?\d+\.\d+)/i),
    extractCoordinateFromPatternV2(html, /["']latitude["']\s*[=:]\s*"?(?<value>-?\d+\.\d+)/i),
    extractCoordinateFromPatternV2(html, /["']lat["']\s*[=:]\s*"?(?<value>-?\d+\.\d+)/i),
    extractCoordinateFromPatternV2(html, /\blat(?:itude)?\b["']?\s*:\s*"?(?<value>-?\d+\.\d+)/i)
  ]);

  const lng = firstCoordinateV2([
    jsonLd && jsonLd.geo && (jsonLd.geo.longitude || jsonLd.geo.lng),
    extractCoordinateFromPatternV2(html, /"longitude"\s*:\s*"?(?<value>-?\d+\.\d+)/i),
    extractCoordinateFromPatternV2(html, /["']longitude["']\s*[=:]\s*"?(?<value>-?\d+\.\d+)/i),
    extractCoordinateFromPatternV2(html, /["']lng["']\s*[=:]\s*"?(?<value>-?\d+\.\d+)/i),
    extractCoordinateFromPatternV2(html, /\blng\b["']?\s*:\s*"?(?<value>-?\d+\.\d+)/i),
    extractCoordinateFromPatternV2(html, /\blon(?:gitude)?\b["']?\s*:\s*"?(?<value>-?\d+\.\d+)/i)
  ]);

  return {
    lat: Number.isFinite(lat) ? lat : "",
    lng: Number.isFinite(lng) ? lng : ""
  };
}

function extractCoordinateFromPatternV2(html, regex) {
  const match = html.match(regex);
  return match && match.groups ? Number(match.groups.value) : null;
}

function firstCoordinateV2(values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return null;
}

function extractPropertyFacts(text) {
  return {
    beds: firstMatchingNumber(text, [
      /\b(\d+)\s*(?:bed|bedroom|bedrooms)\b/i
    ]),
    baths: firstMatchingNumber(text, [
      /\b(\d+)\s*(?:bath|bathroom|bathrooms)\b/i
    ]),
    parking: firstMatchingNumber(text, [
      /\b(\d+)\s*(?:car\s*park|carpark|garage|garages|parking|parks)\b/i
    ]),
    sectionSize: firstMatchingText(text, [
      /\bsection\s*(?:size|area)?\s*(\d+(?:\.\d+)?)\s*(m2|m\u00b2|sqm|ha)\b/i,
      /\bland\s*(?:area|size)?\s*(\d+(?:\.\d+)?)\s*(m2|m\u00b2|sqm|ha)\b/i,
      /\b(\d+(?:\.\d+)?)\s*(m2|m\u00b2|sqm|ha)\s*(?:section|land)\b/i
    ])
  };
}

function firstMatchingNumber(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return Number(match[1]) || 0;
    }
  }
  return 0;
}

function firstMatchingText(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return `${match[1]} ${match[2].replace("sqm", "m2")}`.replace("m\u00b2", "m2");
    }
  }
  return "";
}

function extractCoordinates(html, jsonLd) {
  const lat = firstCoordinate([
    jsonLd && jsonLd.geo && jsonLd.geo.latitude,
    extractCoordinateFromPattern(html, /"latitude"\s*:\s*"?(?<value>-?\d+\.\d+)/i),
    extractCoordinateFromPattern(html, /\blat(?:itude)?\b["']?\s*:\s*"?(?<value>-?\d+\.\d+)/i)
  ]);

  const lng = firstCoordinate([
    jsonLd && jsonLd.geo && (jsonLd.geo.longitude || jsonLd.geo.lng),
    extractCoordinateFromPattern(html, /"longitude"\s*:\s*"?(?<value>-?\d+\.\d+)/i),
    extractCoordinateFromPattern(html, /\blng\b["']?\s*:\s*"?(?<value>-?\d+\.\d+)/i),
    extractCoordinateFromPattern(html, /\blon(?:gitude)?\b["']?\s*:\s*"?(?<value>-?\d+\.\d+)/i)
  ]);

  return {
    lat: Number.isFinite(lat) ? lat : "",
    lng: Number.isFinite(lng) ? lng : ""
  };
}

function extractCoordinateFromPattern(html, regex) {
  const match = html.match(regex);
  return match && match.groups ? Number(match.groups.value) : null;
}

function firstCoordinate(values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return null;
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
    if (!(url.hostname === "www.realestate.co.nz" || url.hostname === "realestate.co.nz")) {
      return false;
    }

    return isPropertyListingPath(url.pathname);
  } catch {
    return false;
  }
}

function isPropertyListingPath(pathname) {
  const normalizedPath = String(pathname || "").toLowerCase();
  if (!/\/\d{6,}(?:\/|$)/.test(normalizedPath)) {
    return false;
  }

  return (
    /^\/\d{6,}\/(?:residential|rural|lifestyle|commercial|business)\/(?:sale|sold|rental|rent|lease)\//.test(normalizedPath) ||
    /\/(?:residential|rural|lifestyle|commercial|business)\/(?:sale|sold|rental|rent|lease)\//.test(normalizedPath)
  );
}

function buildCorsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowedOrigin = origin.startsWith(env.ALLOWED_ORIGIN) ? origin : env.ALLOWED_ORIGIN;

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function readLatLng(url, latKey, lngKey) {
  const lat = Number(url.searchParams.get(latKey));
  const lng = Number(url.searchParams.get(lngKey));

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return { latitude: lat, longitude: lng };
}

function hasCoordinates(value) {
  return Boolean(value) && Number.isFinite(Number(value.lat)) && Number.isFinite(Number(value.lng));
}

async function geocodeAddress(address, env, limit = 5) {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("key", env.GOOGLE_MAPS_API_KEY);
  url.searchParams.set("region", "nz");

  const response = await fetch(url.toString());
  const payload = await response.json();

  if (!response.ok || payload.status === "REQUEST_DENIED" || payload.status === "INVALID_REQUEST") {
    throw new Error(payload.error_message || "Google Geocoding API request failed.");
  }

  const results = Array.isArray(payload.results) ? payload.results.slice(0, limit) : [];
  return results.map((result) => ({
    address: result.formatted_address || address,
    lat: Number(result.geometry?.location?.lat),
    lng: Number(result.geometry?.location?.lng),
    placeId: result.place_id || ""
  })).filter((result) => hasCoordinates(result));
}

function parseDurationSeconds(value) {
  const match = String(value || "").match(/(?<seconds>\d+)s$/);
  return match ? Number(match.groups.seconds) : 0;
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
