const STORAGE_KEY = "house-hunter-day-plan-v2";
const HOUSE_HUNTER_CONFIG = window.HOUSE_HUNTER_CONFIG || {};
const IMPORT_ENDPOINT = HOUSE_HUNTER_CONFIG.importEndpoint || "";
const ETA_ENDPOINT = HOUSE_HUNTER_CONFIG.etaEndpoint || (IMPORT_ENDPOINT ? IMPORT_ENDPOINT.replace(/\/import$/, "/eta") : "");

const seededProperties = [
  {
    id: crypto.randomUUID(),
    address: "14 Tui Street",
    suburb: "Grey Lynn",
    openStart: "10:30",
    openEnd: "11:00",
    beds: 3,
    baths: 2,
    parking: 1,
    lat: -36.85852,
    lng: 174.73591,
    priceEstimate: "$1.58M - $1.67M",
    listingUrl: "https://www.realestate.co.nz/",
    notes: "Sunny backyard, strong street appeal, confirm building report and school zone.",
    checklist: [
      "Ask for LIM and builder's report",
      "Check natural light in bedrooms",
      "Confirm school zone boundary"
    ],
    sources: [
      { name: "realestate.co.nz", label: "Listing" },
      { name: "House Hunter", label: "Manual estimate" }
    ],
    status: "upcoming",
    checkInTime: null
  },
  {
    id: crypto.randomUUID(),
    address: "7 Rata Road",
    suburb: "Ponsonby",
    openStart: "11:30",
    openEnd: "12:00",
    beds: 2,
    baths: 1,
    parking: 0,
    lat: -36.84795,
    lng: 174.74272,
    priceEstimate: "$1.18M - $1.25M",
    listingUrl: "https://www.realestate.co.nz/",
    notes: "Great location, but road noise is a concern. Ask about body corp and storage.",
    checklist: [
      "Test street noise with windows open",
      "Check body corp docs",
      "Inspect kitchen storage"
    ],
    sources: [
      { name: "realestate.co.nz", label: "Listing" },
      { name: "Council data", label: "Land parcel" }
    ],
    status: "upcoming",
    checkInTime: null
  },
  {
    id: crypto.randomUUID(),
    address: "21 Kowhai Avenue",
    suburb: "Mt Eden",
    openStart: "13:15",
    openEnd: "14:00",
    beds: 4,
    baths: 2,
    parking: 2,
    lat: -36.88457,
    lng: 174.75797,
    priceEstimate: "$1.89M - $2.02M",
    listingUrl: "https://www.realestate.co.nz/",
    notes: "Renovated family home. Check slope, drainage, attic storage, and backyard usability.",
    checklist: [
      "Inspect drainage around retaining walls",
      "Check attic storage access",
      "Review recent renovation quality"
    ],
    sources: [
      { name: "realestate.co.nz", label: "Listing" },
      { name: "House Hunter", label: "Travel plan" }
    ],
    status: "upcoming",
    checkInTime: null
  }
];

const DRIVING_SPEED_KMH = 38;

const state = {
  properties: loadProperties(),
  selectedPropertyId: null,
  currentLocation: null,
  statusMessage: "Open the day planner and start building your route.",
  routeCache: {},
  pendingRouteRequests: new Set()
};

const refs = {
  timeline: document.querySelector("#timeline"),
  propertyDetails: document.querySelector("#property-details"),
  propertyForm: document.querySelector("#property-form"),
  propertyDialog: document.querySelector("#property-dialog"),
  addPropertyButton: document.querySelector("#open-property-dialog"),
  closeDialogButton: document.querySelector("#close-property-dialog"),
  importListingButton: document.querySelector("#import-listing"),
  importUrlInput: document.querySelector("#import-url"),
  importStatus: document.querySelector("#import-status"),
  seedDataButton: document.querySelector("#seed-data"),
  clearAllButton: document.querySelector("#clear-all"),
  refreshLocationButton: document.querySelector("#refresh-location"),
  locationStatus: document.querySelector("#location-status"),
  appStatus: document.querySelector("#app-status"),
  daySummaryTitle: document.querySelector("#day-summary-title"),
  daySummaryCopy: document.querySelector("#day-summary-copy"),
  totalHomes: document.querySelector("#stat-total-homes"),
  totalTravel: document.querySelector("#stat-total-travel"),
  nextLeave: document.querySelector("#stat-next-leave"),
  windowLeft: document.querySelector("#stat-window-left"),
  completedHomes: document.querySelector("#stat-completed"),
  timelineTemplate: document.querySelector("#timeline-item-template")
};

if (!state.selectedPropertyId && state.properties[0]) {
  state.selectedPropertyId = state.properties[0].id;
}

bindEvents();
consumeIncomingPrefill();
renderApp();
updateLocationStatus("Location not checked yet.");
updateAppStatus(state.statusMessage);
registerServiceWorker();

function bindEvents() {
  refs.propertyForm.addEventListener("submit", handleAddProperty);
  refs.addPropertyButton.addEventListener("click", () => refs.propertyDialog.showModal());
  refs.closeDialogButton.addEventListener("click", () => refs.propertyDialog.close());
  refs.importListingButton.addEventListener("click", handleImportListing);
  refs.propertyDialog.addEventListener("click", (event) => {
    if (event.target === refs.propertyDialog) {
      refs.propertyDialog.close();
    }
  });

  refs.seedDataButton.addEventListener("click", () => {
    state.properties = seededProperties.map((property) => ({ ...property, id: crypto.randomUUID() }));
    state.selectedPropertyId = state.properties[0]?.id ?? null;
    persistProperties(state.properties);
    updateAppStatus("Loaded the example day plan.");
    renderApp();
  });

  refs.clearAllButton.addEventListener("click", () => {
    state.properties = [];
    state.selectedPropertyId = null;
    persistProperties(state.properties);
    updateAppStatus("Cleared the day plan.");
    renderApp();
  });

  refs.refreshLocationButton.addEventListener("click", requestCurrentLocation);
}

function handleAddProperty(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const checklist = String(formData.get("checklist"))
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);

  const listingUrl = String(formData.get("listingUrl")).trim();
  const property = {
    id: crypto.randomUUID(),
    address: String(formData.get("address")).trim(),
    suburb: String(formData.get("suburb")).trim(),
    openStart: String(formData.get("openStart")),
    openEnd: String(formData.get("openEnd")),
    beds: Number(formData.get("beds")) || 0,
    baths: Number(formData.get("baths")) || 0,
    parking: Number(formData.get("parking")) || 0,
    lat: Number(formData.get("lat")),
    lng: Number(formData.get("lng")),
    priceEstimate: String(formData.get("priceEstimate")).trim() || "Estimate not added",
    listingUrl,
    notes: String(formData.get("notes")).trim(),
    checklist,
    sources: buildSources(listingUrl),
    status: "upcoming",
    checkInTime: null
  };

  state.properties.push(property);
  state.properties = getSortedProperties(state.properties);
  state.selectedPropertyId = property.id;
  persistProperties(state.properties);
  refs.propertyForm.reset();
  refs.propertyDialog.close();
  updateAppStatus(`Added ${property.address} to the route.`);
  renderApp();
}

async function handleImportListing() {
  const url = refs.importUrlInput.value.trim();

  if (!url) {
    updateImportStatus("Paste a realestate.co.nz listing URL first.", true);
    return;
  }

  if (!IMPORT_ENDPOINT) {
    updateImportStatus("No import endpoint is configured yet. Deploy the worker and set window.HOUSE_HUNTER_CONFIG.importEndpoint.", true);
    return;
  }

  updateImportStatus("Importing listing details...");
  refs.importListingButton.disabled = true;

  try {
    const response = await fetch(`${IMPORT_ENDPOINT}?url=${encodeURIComponent(url)}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Import failed.");
    }

    populateFormFromImport(payload.property, url);
    updateImportStatus("Listing imported. Check the fields before adding it to the day.");
  } catch (error) {
    updateImportStatus(error.message || "Import failed.", true);
  } finally {
    refs.importListingButton.disabled = false;
  }
}

function requestCurrentLocation() {
  if (!navigator.geolocation) {
    updateLocationStatus("Geolocation is not supported in this browser.");
    return;
  }

  updateLocationStatus("Checking device position...");
  navigator.geolocation.getCurrentPosition(
    (position) => {
      state.currentLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        capturedAt: new Date()
      };
      updateLocationStatus("Live position updated. Distance-to-next estimates now use your device location.");
      updateAppStatus("Live position refreshed.");
      renderApp();
    },
    () => updateLocationStatus("Location access was denied or unavailable."),
    {
      enableHighAccuracy: true,
      timeout: 10000
    }
  );
}

function updateLocationStatus(message) {
  refs.locationStatus.textContent = message;
}

function updateAppStatus(message) {
  state.statusMessage = message;
  refs.appStatus.textContent = message;
}

function updateImportStatus(message, isError = false) {
  refs.importStatus.textContent = message;
  refs.importStatus.className = isError ? "danger-text" : "meta-text";
}

function renderApp() {
  state.properties = getSortedProperties(state.properties);
  const properties = buildAugmentedProperties(state.properties, state.currentLocation, state.routeCache);
  const selected = properties.find((property) => property.id === state.selectedPropertyId) ?? properties[0] ?? null;

  renderSummary(properties);
  renderTimeline(properties, selected?.id ?? null);
  renderDetails(selected);
  prefetchBetterEtas(properties);
}

function renderSummary(properties) {
  const totalTravel = properties.reduce((sum, property) => sum + property.travelFromPreviousMinutes, 0);
  const current = properties.find((property) => property.status === "current");
  const next = properties.find((property) => property.status === "upcoming");
  const completed = properties.filter((property) => property.status === "done").length;

  refs.totalHomes.textContent = String(properties.length);
  refs.totalTravel.textContent = `${Math.round(totalTravel)} min`;
  refs.nextLeave.textContent = current ? current.leaveByLabel : next ? next.departureLabel : "-";
  refs.windowLeft.textContent = current ? current.timeRemainingLabel : next ? next.openWindowLabel : "-";
  refs.completedHomes.textContent = String(completed);

  if (current) {
    refs.daySummaryTitle.textContent = `${current.address} is your current stop.`;
    refs.daySummaryCopy.textContent = `You have ${current.timeRemainingLabel.toLowerCase()} before that open home ends${current.nextProperty ? `, and should leave by ${current.leaveByLabel}.` : "."}`;
    return;
  }

  if (next) {
    refs.daySummaryTitle.textContent = `${next.address} is next on the route.`;
    refs.daySummaryCopy.textContent = `Leave by ${next.departureLabel} to reach the next open home around ${next.arrivalLabel}.`;
    return;
  }

  refs.daySummaryTitle.textContent = properties.length ? "All planned viewings are complete." : "Build your open-home route.";
  refs.daySummaryCopy.textContent = properties.length ? "Review saved notes or add more properties to the day plan." : "Add properties manually or load the example day to get started.";
}

function renderTimeline(properties, selectedPropertyId) {
  refs.timeline.replaceChildren();

  if (!properties.length) {
    const empty = document.createElement("div");
    empty.className = "empty-callout";
    empty.innerHTML = `
      <h3>No open homes planned yet</h3>
      <p>Add a property to start building the day.</p>
    `;
    refs.timeline.appendChild(empty);
    return;
  }

  properties.forEach((property) => {
    const fragment = refs.timelineTemplate.content.cloneNode(true);
    const button = fragment.querySelector(".timeline-item-button");
    const title = fragment.querySelector("h3");
    const timelineTime = fragment.querySelector(".timeline-time");
    const timelineWindow = fragment.querySelector(".timeline-window");
    const suburb = fragment.querySelector(".timeline-suburb");
    const statusChip = fragment.querySelector(".timeline-status-chip");
    const metrics = fragment.querySelector(".timeline-metrics");

    button.classList.toggle("selected", property.id === selectedPropertyId);
    button.addEventListener("click", () => {
      state.selectedPropertyId = property.id;
      renderApp();
    });

    title.textContent = property.address;
    timelineTime.textContent = property.openStart;
    timelineWindow.textContent = `${property.openStart} - ${property.openEnd}`;
    suburb.textContent = property.suburb || "Suburb not set";
    statusChip.textContent = property.status;
    statusChip.className = `chip timeline-status-chip ${property.status}`;

    [
      `${property.beds} bd`,
      `${property.baths} ba`,
      `${property.travelFromPreviousMinutes} min drive`,
      property.currentTravelLabel
    ].forEach((text) => {
      const pill = document.createElement("span");
      pill.className = "metric-pill";
      pill.textContent = text;
      metrics.appendChild(pill);
    });

    refs.timeline.appendChild(fragment);
  });
}

function renderDetails(selected) {
  if (!selected) {
    refs.propertyDetails.className = "property-details empty-state";
    refs.propertyDetails.innerHTML = `
      <h2>Select a property</h2>
      <p>Open a stop from the itinerary to review timing, notes, and checklist items.</p>
    `;
    return;
  }

  refs.propertyDetails.className = "property-details";
  const sourcesMarkup = (selected.sources || [])
    .map((source) => `<span class="source-pill">${escapeHtml(source.label)} - ${escapeHtml(source.name)}</span>`)
    .join("");

  const checklistMarkup = (selected.checklist || []).length
    ? `<ul class="detail-list">${selected.checklist.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : `<p class="meta-text">No checklist items yet.</p>`;

  refs.propertyDetails.innerHTML = `
    <div class="detail-title-block">
      <p class="eyebrow">${escapeHtml(selected.suburb || "Open Home")}</p>
      <h2>${escapeHtml(selected.address)}</h2>
      <p>${escapeHtml(selected.priceEstimate)}</p>
    </div>

    <div class="detail-actions">
      <button id="arrive-button" class="primary-button" type="button">${selected.status === "current" ? "Mark As Done" : "Check In Now"}</button>
      <button id="remove-button" class="secondary-button" type="button">Remove Stop</button>
      ${selected.listingUrl ? `<a class="secondary-button link-button" href="${selected.listingUrl}" target="_blank" rel="noreferrer">Open Listing</a>` : ""}
    </div>

    <section class="detail-section">
      <div class="detail-section-header">
        <h3>Timing</h3>
        <span class="chip ${selected.status}">${escapeHtml(selected.status)}</span>
      </div>
      <div class="detail-timing-grid">
        <article><span>Open Window</span><strong>${escapeHtml(selected.openStart)} - ${escapeHtml(selected.openEnd)}</strong></article>
        <article><span>Drive From Previous</span><strong>${selected.travelFromPreviousMinutes} min</strong></article>
        <article><span>Distance From You</span><strong>${escapeHtml(selected.distanceFromCurrentLabel)}</strong></article>
        <article><span>Leave By</span><strong>${escapeHtml(selected.leaveByLabel)}</strong></article>
      </div>
      <p class="${selected.leaveWarningClass}">${escapeHtml(selected.leaveMessage)}</p>
      <p class="meta-text">${escapeHtml(selected.liveEtaDetail)}</p>
    </section>

    <section class="detail-section">
      <h3>Property Snapshot</h3>
      <div class="detail-grid">
        <article><span>Bedrooms</span><strong>${selected.beds}</strong></article>
        <article><span>Bathrooms</span><strong>${selected.baths}</strong></article>
        <article><span>Parking</span><strong>${selected.parking}</strong></article>
        <article><span>Travel Mode</span><strong>Driving</strong></article>
      </div>
    </section>

    <section class="detail-section">
      <h3>Checklist</h3>
      ${checklistMarkup}
    </section>

    <section class="detail-section">
      <h3>Sources</h3>
      <div class="detail-actions">${sourcesMarkup || '<span class="meta-text">No external sources yet.</span>'}</div>
      <p class="meta-text">This app stores listing metadata locally and is ready for a later ingestion layer for live listing data, estimates, and route ETAs.</p>
    </section>

    <section class="detail-section">
      <h3>Notes</h3>
      <form id="notes-form" class="notes-form">
        <label>
          What did you like, dislike, or want to follow up on?
          <textarea id="property-notes-input" name="notes" rows="6" placeholder="Sunny lounge, noisy road, ask about LIM, check insulation.">${escapeHtml(selected.notes || "")}</textarea>
        </label>
        <div class="detail-actions">
          <button class="primary-button" type="submit">Save Notes</button>
          <button id="reset-notes-button" class="secondary-button" type="button">Reset</button>
        </div>
      </form>
    </section>
  `;

  refs.propertyDetails.querySelector("#arrive-button").addEventListener("click", () => toggleArrival(selected.id));
  refs.propertyDetails.querySelector("#remove-button").addEventListener("click", () => removeProperty(selected.id));
  refs.propertyDetails.querySelector("#notes-form").addEventListener("submit", (event) => saveNotes(event, selected.id));
  refs.propertyDetails.querySelector("#reset-notes-button").addEventListener("click", () => {
    refs.propertyDetails.querySelector("#property-notes-input").value = selected.notes || "";
  });
}

function toggleArrival(propertyId) {
  const now = new Date();
  const targetIndex = state.properties.findIndex((property) => property.id === propertyId);
  if (targetIndex === -1) {
    return;
  }

  const currentProperty = state.properties[targetIndex];
  if (currentProperty.status === "current") {
    state.properties[targetIndex] = {
      ...currentProperty,
      status: "done",
      checkInTime: currentProperty.checkInTime ?? now.toISOString()
    };
    updateAppStatus(`Marked ${currentProperty.address} as done.`);
  } else {
    state.properties = state.properties.map((property, index) => {
      if (index < targetIndex && property.status !== "done") {
        return { ...property, status: "done" };
      }
      if (property.id === propertyId) {
        return { ...property, status: "current", checkInTime: now.toISOString() };
      }
      if (index > targetIndex) {
        return { ...property, status: "upcoming", checkInTime: null };
      }
      return property;
    });
    updateAppStatus(`Checked in at ${currentProperty.address}.`);
  }

  persistProperties(state.properties);
  renderApp();
}

function removeProperty(propertyId) {
  const removed = state.properties.find((property) => property.id === propertyId);
  state.properties = state.properties.filter((property) => property.id !== propertyId);
  state.selectedPropertyId = state.properties[0]?.id ?? null;
  persistProperties(state.properties);
  updateAppStatus(removed ? `Removed ${removed.address} from the route.` : "Removed stop.");
  renderApp();
}

function saveNotes(event, propertyId) {
  event.preventDefault();
  const notes = String(new FormData(event.currentTarget).get("notes")).trim();
  state.properties = state.properties.map((property) =>
    property.id === propertyId ? { ...property, notes } : property
  );
  persistProperties(state.properties);
  updateAppStatus("Saved property notes.");
  renderApp();
}

function populateFormFromImport(property, listingUrl) {
  if (!property) {
    return;
  }

  setFormValue("address", property.address || "");
  setFormValue("suburb", property.suburb || "");
  setFormValue("openStart", property.openStart || "");
  setFormValue("openEnd", property.openEnd || "");
  setFormValue("beds", property.beds ?? "");
  setFormValue("baths", property.baths ?? "");
  setFormValue("parking", property.parking ?? "");
  setFormValue("priceEstimate", property.priceEstimate || "");
  setFormValue("listingUrl", listingUrl);
  setFormValue("notes", property.notes || "");
  setFormValue("lat", property.lat ?? "");
  setFormValue("lng", property.lng ?? "");
  setFormValue("checklist", Array.isArray(property.checklist) ? property.checklist.join("\n") : "");
}

function setFormValue(name, value) {
  const element = refs.propertyForm.elements.namedItem(name);
  if (element) {
    element.value = value;
  }
}

function consumeIncomingPrefill() {
  const url = new URL(window.location.href);
  const payload = url.searchParams.get("prefill");

  if (!payload) {
    return;
  }

  try {
    const parsed = JSON.parse(decodeBase64Url(payload));
    populateFormFromImport(parsed, parsed.listingUrl || "");
    refs.importUrlInput.value = parsed.listingUrl || "";
    updateImportStatus("Imported property draft from bookmarklet. Review the fields, then add it to the day.");
    refs.propertyDialog.showModal();
    updateAppStatus("Loaded a property draft from the bookmarklet.");
  } catch {
    updateAppStatus("Could not read the bookmarklet payload.");
  }

  url.searchParams.delete("prefill");
  window.history.replaceState({}, document.title, url.toString());
}

function loadProperties() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistProperties(properties) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(properties));
}

function getSortedProperties(properties) {
  return [...properties].sort((a, b) => a.openStart.localeCompare(b.openStart));
}

function buildSources(listingUrl) {
  if (!listingUrl) {
    return [{ name: "House Hunter", label: "Manual entry" }];
  }

  try {
    const hostname = new URL(listingUrl).hostname.replace("www.", "");
    return [
      { name: hostname, label: "Listing" },
      { name: "House Hunter", label: "Manual entry" }
    ];
  } catch {
    return [{ name: "House Hunter", label: "Manual entry" }];
  }
}

function buildAugmentedProperties(properties, currentLocation, routeCache) {
  const now = new Date();
  const sorted = getSortedProperties(properties);
  const currentIndex = sorted.findIndex((property) => property.status === "current");

  return sorted.map((property, index) => {
    const previousProperty = sorted[index - 1];
    const nextProperty = sorted[index + 1];
    const distanceFromPreviousKm = previousProperty ? haversineKm(previousProperty, property) : 0;
    const previousRoute = previousProperty ? getCachedRoute(previousProperty, property, routeCache) : null;
    const travelFromPreviousMinutes = previousProperty
      ? previousRoute?.durationMinutes ?? estimateTravelMinutes(distanceFromPreviousKm)
      : 0;

    const currentOrigin = currentIndex === -1 || index <= currentIndex ? currentLocation : sorted[currentIndex];
    const distanceFromCurrentKm = currentOrigin ? haversineKm(currentOrigin, property) : null;
    const currentRoute = currentOrigin ? getCachedRoute(currentOrigin, property, routeCache) : null;
    const distanceFromCurrentLabel = currentRoute
      ? currentRoute.distanceLabel
      : distanceFromCurrentKm == null
        ? "Location needed"
        : `${distanceFromCurrentKm.toFixed(1)} km away`;
    const currentTravelLabel = currentRoute
      ? `${currentRoute.durationMinutes} min from you`
      : distanceFromCurrentKm == null
        ? "Location needed"
        : `${distanceFromCurrentKm.toFixed(1)} km away`;

    const openStartDate = combineWithToday(property.openStart);
    const openEndDate = combineWithToday(property.openEnd);
    const nextRoute = nextProperty ? getCachedRoute(property, nextProperty, routeCache) : null;
    const nextTravelMinutes = nextProperty
      ? nextRoute?.durationMinutes ?? estimateTravelMinutes(haversineKm(property, nextProperty))
      : 0;
    const leaveByDate = nextProperty
      ? new Date(combineWithToday(nextProperty.openStart).getTime() - nextTravelMinutes * 60000)
      : openEndDate;

    const departureLabel = formatClockTime(dateToTimeString(new Date(openStartDate.getTime() - travelFromPreviousMinutes * 60000)));
    const arrivalLabel = formatClockTime(property.openStart);
    const timeRemainingMinutes = Math.max(0, Math.round((openEndDate.getTime() - now.getTime()) / 60000));
    const openWindowLabel = `${Math.max(0, Math.round((openEndDate.getTime() - openStartDate.getTime()) / 60000))} min window`;
    const leaveByLabel = formatClockTime(dateToTimeString(leaveByDate));
    const leaveDeltaMinutes = Math.round((leaveByDate.getTime() - now.getTime()) / 60000);

    return {
      ...property,
      previousProperty,
      nextProperty,
      travelFromPreviousMinutes,
      distanceFromCurrentLabel,
      departureLabel,
      arrivalLabel,
      openWindowLabel,
      leaveByLabel,
      timeRemainingLabel: `${timeRemainingMinutes} min left`,
      leaveMessage: buildLeaveMessage(property.status, leaveDeltaMinutes, timeRemainingMinutes, nextProperty),
      leaveWarningClass: leaveDeltaMinutes < 0 ? "danger-text" : leaveDeltaMinutes <= 10 ? "warning-text" : "meta-text",
      currentTravelLabel,
      liveEtaDetail: currentRoute
        ? `Live Google route estimate: ${currentRoute.durationLabel}, ${currentRoute.distanceLabel}.`
        : currentLocation
          ? "Live drive ETA will improve once the Google route service responds."
          : "Refresh live position to see drive ETA from your current location."
    };
  });
}

function prefetchBetterEtas(properties) {
  if (!ETA_ENDPOINT) {
    return;
  }

  const currentIndex = properties.findIndex((property) => property.status === "current");

  properties.forEach((property, index) => {
    const previousProperty = properties[index - 1];
    if (previousProperty) {
      fetchBetterEta(previousProperty, property);
    }

    const currentOrigin = currentIndex === -1 || index <= currentIndex ? state.currentLocation : properties[currentIndex];
    if (currentOrigin) {
      fetchBetterEta(currentOrigin, property);
    }
  });
}

async function fetchBetterEta(origin, destination) {
  if (!origin || !destination) {
    return;
  }

  const key = buildRouteKey(origin, destination);
  if (state.routeCache[key] || state.pendingRouteRequests.has(key)) {
    return;
  }

  state.pendingRouteRequests.add(key);

  try {
    const query = new URLSearchParams({
      oLat: String(origin.lat),
      oLng: String(origin.lng),
      dLat: String(destination.lat),
      dLng: String(destination.lng)
    });

    const response = await fetch(`${ETA_ENDPOINT}?${query.toString()}`);
    const payload = await response.json();

    if (response.ok && payload.route) {
      state.routeCache[key] = payload.route;
      renderApp();
    }
  } catch {
    // Keep straight-line fallback when the live ETA service fails.
  } finally {
    state.pendingRouteRequests.delete(key);
  }
}

function buildRouteKey(origin, destination) {
  return `${roundCoord(origin.lat)},${roundCoord(origin.lng)}:${roundCoord(destination.lat)},${roundCoord(destination.lng)}`;
}

function getCachedRoute(origin, destination, routeCache) {
  return routeCache[buildRouteKey(origin, destination)] || null;
}

function roundCoord(value) {
  return Number(value).toFixed(5);
}

function buildLeaveMessage(status, leaveDeltaMinutes, timeRemainingMinutes, nextProperty) {
  if (status === "current") {
    if (!nextProperty) {
      return `You can stay for another ${timeRemainingMinutes} minutes before this open home ends.`;
    }
    if (leaveDeltaMinutes < 0) {
      return "You should already be heading to the next property to stay on schedule.";
    }
    return `You can stay about ${leaveDeltaMinutes} more minutes before leaving for the next open home.`;
  }

  if (status === "done") {
    return "This stop is marked complete.";
  }

  if (leaveDeltaMinutes < 0) {
    return "The ideal departure time has already passed for this stop.";
  }

  return `Leave in ${leaveDeltaMinutes} minutes to stay on plan.`;
}

function estimateTravelMinutes(distanceKm) {
  return Math.max(1, Math.round((distanceKm / DRIVING_SPEED_KMH) * 60));
}

function haversineKm(a, b) {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLng = toRadians(b.lng - a.lng);
  const haversine =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);

  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function combineWithToday(timeString) {
  const [hours, minutes] = timeString.split(":").map(Number);
  const value = new Date();
  value.setHours(hours, minutes, 0, 0);
  return value;
}

function dateToTimeString(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatClockTime(timeString) {
  const [hours, minutes] = timeString.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const normalizedHour = hours % 12 || 12;
  return `${normalizedHour}:${String(minutes).padStart(2, "0")} ${period}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function registerServiceWorker() {
  const isSupportedProtocol = window.location.protocol === "http:" || window.location.protocol === "https:";
  if ("serviceWorker" in navigator && isSupportedProtocol) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

function decodeBase64Url(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
