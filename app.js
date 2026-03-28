const STORAGE_KEY = "house-hunter-day-plan-v2";
const HOME_STORAGE_KEY = "house-hunter-home-v1";
const HOUSE_HUNTER_CONFIG = window.HOUSE_HUNTER_CONFIG || {};
const IMPORT_ENDPOINT = HOUSE_HUNTER_CONFIG.importEndpoint || "";
const BATCH_IMPORT_ENDPOINT = HOUSE_HUNTER_CONFIG.batchImportEndpoint || (IMPORT_ENDPOINT ? IMPORT_ENDPOINT.replace(/\/import$/, "/batch-import") : "");
const ETA_ENDPOINT = HOUSE_HUNTER_CONFIG.etaEndpoint || (IMPORT_ENDPOINT ? IMPORT_ENDPOINT.replace(/\/import$/, "/eta") : "");
const GEOCODE_ENDPOINT = HOUSE_HUNTER_CONFIG.geocodeEndpoint || (IMPORT_ENDPOINT ? IMPORT_ENDPOINT.replace(/\/import$/, "/geocode") : "");
const BROADBAND_ENDPOINT = HOUSE_HUNTER_CONFIG.broadbandEndpoint || (IMPORT_ENDPOINT ? IMPORT_ENDPOINT.replace(/\/import$/, "/broadband") : "");
const LOCATION_REFRESH_SECONDS = Math.max(5, Number(HOUSE_HUNTER_CONFIG.locationRefreshSeconds) || 10);
const MOBILE_LAYOUT_QUERY = "(max-width: 1180px)";

const DRIVING_SPEED_KMH = 38;

const state = {
  properties: loadProperties(),
  selectedPropertyId: null,
  currentLocation: null,
  homeLocation: loadHomeLocation(),
  statusMessage: "Open the day planner and start building your route.",
  routeCache: {},
  pendingRouteRequests: new Set(),
  broadbandCache: {},
  pendingBroadbandRequests: new Set(),
  homeSearchResults: [],
  locationRefreshTimer: null
};

const refs = {
  sidebar: document.querySelector("#sidebar"),
  openSidebarButton: document.querySelector("#open-sidebar"),
  closeSidebarButton: document.querySelector("#close-sidebar"),
  drawerBackdrop: document.querySelector("#drawer-backdrop"),
  timeline: document.querySelector("#timeline"),
  propertyDetails: document.querySelector("#property-details"),
  propertyForm: document.querySelector("#property-form"),
  propertyDialog: document.querySelector("#property-dialog"),
  addPropertyButton: document.querySelector("#open-property-dialog"),
  closeDialogButton: document.querySelector("#close-property-dialog"),
  importListingButton: document.querySelector("#import-listing"),
  importUrlInput: document.querySelector("#import-url"),
  importStatus: document.querySelector("#import-status"),
  homeForm: document.querySelector("#home-form"),
  homeAddressInput: document.querySelector("#home-address"),
  homeSearchButton: document.querySelector("#search-home-address"),
  homeSearchResults: document.querySelector("#home-search-results"),
  homeLatInput: document.querySelector("#home-lat"),
  homeLngInput: document.querySelector("#home-lng"),
  homeStatus: document.querySelector("#home-status"),
  clearHomeButton: document.querySelector("#clear-home"),
  exportPlanButton: document.querySelector("#export-plan"),
  importPlanButton: document.querySelector("#import-plan"),
  importPlanFileInput: document.querySelector("#import-plan-file"),
  clearAllButton: document.querySelector("#clear-all"),
  refreshLocationButton: document.querySelector("#refresh-location"),
  locationStatus: document.querySelector("#location-status"),
  locationRefreshInterval: document.querySelector("#location-refresh-interval"),
  appStatus: document.querySelector("#app-status"),
  daySummaryTitle: document.querySelector("#day-summary-title"),
  daySummaryCopy: document.querySelector("#day-summary-copy"),
  totalHomes: document.querySelector("#stat-total-homes"),
  totalTravel: document.querySelector("#stat-total-travel"),
  nextLeave: document.querySelector("#stat-next-leave"),
  currentTime: document.querySelector("#stat-current-time"),
  windowLeft: document.querySelector("#stat-window-left"),
  completedHomes: document.querySelector("#stat-completed"),
  timelineTemplate: document.querySelector("#timeline-item-template")
};

if (!state.selectedPropertyId && state.properties[0]) {
  state.selectedPropertyId = state.properties[0].id;
}

bindEvents();
hydrateHomeForm();
consumeIncomingPayloads();
renderApp();
updateLocationStatus("Location not checked yet.");
updateAppStatus(state.statusMessage);
registerServiceWorker();
window.setInterval(renderCurrentTime, 30000);
renderCurrentTime();
hydrateLocationRefreshUI();
startLocationAutoRefresh();

function bindEvents() {
  refs.openSidebarButton.addEventListener("click", openSidebar);
  refs.closeSidebarButton.addEventListener("click", closeSidebar);
  refs.drawerBackdrop.addEventListener("click", closeSidebar);
  refs.propertyForm.addEventListener("submit", handleAddProperty);
  refs.homeForm.addEventListener("submit", handleSaveHomeLocation);
  refs.homeSearchButton.addEventListener("click", handleSearchHomeAddress);
  refs.homeSearchResults.addEventListener("change", handleSelectHomeAddress);
  refs.clearHomeButton.addEventListener("click", clearHomeLocation);
  refs.exportPlanButton.addEventListener("click", exportPlan);
  refs.importPlanButton.addEventListener("click", () => refs.importPlanFileInput.click());
  refs.importPlanFileInput.addEventListener("change", importPlanFromFile);
  refs.addPropertyButton.addEventListener("click", () => {
    delete refs.propertyForm.dataset.imageUrl;
    refs.propertyDialog.showModal();
  });
  refs.closeDialogButton.addEventListener("click", () => refs.propertyDialog.close());
  refs.importListingButton.addEventListener("click", handleImportListing);
  refs.propertyDialog.addEventListener("click", (event) => {
    if (event.target === refs.propertyDialog) {
      refs.propertyDialog.close();
    }
  });
  refs.propertyDialog.addEventListener("close", () => {
    if (!refs.importUrlInput.value.trim()) {
      delete refs.propertyForm.dataset.imageUrl;
    }
  });

  refs.clearAllButton.addEventListener("click", () => {
    state.properties = [];
    state.selectedPropertyId = null;
    persistProperties(state.properties);
    updateAppStatus("Cleared the day plan.");
    renderApp();
  });

  refs.refreshLocationButton.addEventListener("click", requestCurrentLocation);
  window.matchMedia(MOBILE_LAYOUT_QUERY).addEventListener("change", () => renderApp());
}

function openSidebar() {
  refs.sidebar.classList.remove("drawer-closed");
  refs.sidebar.classList.add("drawer-open");
  refs.sidebar.setAttribute("aria-hidden", "false");
  refs.drawerBackdrop.hidden = false;
  document.body.classList.add("drawer-active");
}

function closeSidebar() {
  refs.sidebar.classList.remove("drawer-open");
  refs.sidebar.classList.add("drawer-closed");
  refs.sidebar.setAttribute("aria-hidden", "true");
  refs.drawerBackdrop.hidden = true;
  document.body.classList.remove("drawer-active");
}

async function handleAddProperty(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const checklist = String(formData.get("checklist"))
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);

  const listingUrl = String(formData.get("listingUrl")).trim();
  const address = String(formData.get("address")).trim();
  const suburb = String(formData.get("suburb")).trim();
  let lat = parseCoordinateValue(formData.get("lat"));
  let lng = parseCoordinateValue(formData.get("lng"));

  if ((!hasCoordinates({ lat, lng })) && address && GEOCODE_ENDPOINT) {
    try {
      const [match] = await lookupAddressCandidates(address, 1);
      if (match) {
        lat = match.lat;
        lng = match.lng;
        setFormValue("lat", lat);
        setFormValue("lng", lng);
      }
    } catch {
      // Fall back to manual entry validation below.
    }
  }

  if (!address) {
    updateAppStatus("Enter an address before adding the property.");
    return;
  }

  if (!hasCoordinates({ lat, lng })) {
    updateAppStatus("Add coordinates or use an address search so routing can work for this property.");
    return;
  }

  const property = {
    id: crypto.randomUUID(),
    address,
    suburb,
    openStart: String(formData.get("openStart")),
    openEnd: String(formData.get("openEnd")),
    beds: Number(formData.get("beds")) || 0,
    baths: Number(formData.get("baths")) || 0,
    parking: Number(formData.get("parking")) || 0,
    sectionSize: String(formData.get("sectionSize")).trim(),
    lat,
    lng,
    imageUrl: String(refs.propertyForm.dataset.imageUrl || "").trim(),
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
  delete refs.propertyForm.dataset.imageUrl;
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

function requestCurrentLocation(options = {}) {
  const silent = Boolean(options.silent);

  if (!navigator.geolocation) {
    if (!silent) {
      updateLocationStatus("Geolocation is not supported in this browser.");
    }
    return;
  }

  if (!silent) {
    updateLocationStatus("Checking device position...");
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      state.currentLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        capturedAt: new Date()
      };
      updateLocationStatus(`Live position updated at ${formatClockTime(dateToTimeString(state.currentLocation.capturedAt))}.`);
      if (!silent) {
        updateAppStatus("Live position refreshed.");
      }
      renderApp();
    },
    () => {
      if (!silent) {
        updateLocationStatus("Location access was denied or unavailable.");
      }
    },
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

function updateHomeStatus(message, isError = false) {
  refs.homeStatus.textContent = message;
  refs.homeStatus.className = isError ? "danger-text" : "meta-text";
}

function hydrateLocationRefreshUI() {
  if (refs.locationRefreshInterval) {
    refs.locationRefreshInterval.textContent = `${LOCATION_REFRESH_SECONDS}s auto`;
  }
}

function startLocationAutoRefresh() {
  if (!navigator.geolocation) {
    return;
  }

  requestCurrentLocation({ silent: true });
  state.locationRefreshTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") {
      requestCurrentLocation({ silent: true });
    }
  }, LOCATION_REFRESH_SECONDS * 1000);
}

function isMobileLayout() {
  return window.matchMedia(MOBILE_LAYOUT_QUERY).matches;
}

function renderApp() {
  state.properties = getSortedProperties(state.properties);
  const routeOrigin = state.currentLocation || state.homeLocation;
  const properties = buildAugmentedProperties(state.properties, routeOrigin, state.routeCache);
  const selected = properties.find((property) => property.id === state.selectedPropertyId) ?? properties[0] ?? null;

  renderSummary(properties);
  renderTimeline(properties, selected?.id ?? null);
  renderDetails(selected);
  ensureBroadbandStatuses(properties);
}

function renderSummary(properties) {
  const totalTravel = properties.reduce((sum, property) => sum + property.travelFromPreviousMinutes, 0);
  const current = properties.find((property) => property.status === "current");
  const next = properties.find((property) => property.status === "upcoming");
  const completed = properties.filter((property) => property.status === "done").length;

  refs.totalHomes.textContent = String(properties.length);
  refs.totalTravel.textContent = `${Math.round(totalTravel)} min`;
  refs.nextLeave.textContent = current ? current.leaveByLabel : next ? next.departureLabel : "-";
  renderCurrentTime();
  refs.windowLeft.textContent = current ? current.timeRemainingLabel : next ? next.openWindowLabel : "-";
  refs.completedHomes.textContent = String(completed);

  if (current) {
    refs.daySummaryTitle.textContent = `${current.displayAddress || current.address} is your current stop.`;
    refs.daySummaryCopy.textContent = current.nextProperty
      ? `You have ${current.timeRemainingLabel.toLowerCase()} before that open home ends, and should leave this stop by ${current.leaveByLabel}.`
      : `You have ${current.timeRemainingLabel.toLowerCase()} before that open home ends.`;
    return;
  }

  if (next) {
    refs.daySummaryTitle.textContent = `${next.displayAddress || next.address} is next on the route.`;
    refs.daySummaryCopy.textContent = `Leave by ${next.departureLabel} to reach the next open home around ${next.arrivalLabel}.`;
    return;
  }

  refs.daySummaryTitle.textContent = properties.length ? "All planned viewings are complete." : "Build your open-home route.";
  refs.daySummaryCopy.textContent = properties.length ? "Review saved notes or add more properties to the day plan." : "Add properties manually or import a saved plan to get started.";
}

function renderCurrentTime() {
  refs.currentTime.textContent = formatClockTime(dateToTimeString(new Date()));
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
    const item = fragment.querySelector(".timeline-item");
    const button = fragment.querySelector(".timeline-item-button");
    const title = fragment.querySelector("h3");
    const timelineTime = fragment.querySelector(".timeline-time");
    const timelineWindow = fragment.querySelector(".timeline-window");
    const suburb = fragment.querySelector(".timeline-suburb");
    const statusChip = fragment.querySelector(".timeline-status-chip");
    const metrics = fragment.querySelector(".timeline-metrics");
    const actions = fragment.querySelector(".timeline-item-actions");
    const backgroundImage = normalizeTimelineImageUrl(property.imageUrl);

    button.classList.toggle("selected", property.id === selectedPropertyId);
    button.classList.toggle("has-image", Boolean(backgroundImage));
    button.style.backgroundImage = backgroundImage
      ? `linear-gradient(180deg, rgba(12, 12, 12, 0.3), rgba(12, 12, 12, 0.68)), url("${backgroundImage}")`
      : "";
    button.addEventListener("click", () => {
      state.selectedPropertyId = property.id;
      renderApp();
    });

    title.textContent = property.displayAddress || property.address;
    timelineTime.textContent = property.openStart;
    timelineWindow.textContent = `${property.openStart} - ${property.openEnd}`;
    suburb.textContent = property.displaySuburb || property.suburb || "Suburb not set";
    statusChip.textContent = property.status;
    statusChip.className = `chip timeline-status-chip ${property.status}`;

    [
      `${property.beds} bd`,
      `${property.baths} ba`,
      property.travelFromPreviousLabel,
      property.currentTravelLabel
    ].forEach((text) => {
      const pill = document.createElement("span");
      pill.className = "metric-pill";
      pill.textContent = text;
      metrics.appendChild(pill);
    });

    if (property.fromPreviousMapUrl) {
      actions.appendChild(buildMapLink("Route Here", property.fromPreviousMapUrl));
    }

    if (property.toNextMapUrl) {
      actions.appendChild(buildMapLink("Route To Next", property.toNextMapUrl));
    }

    if (property.listingUrl) {
      actions.appendChild(buildMapLink("Open Listing", property.listingUrl));
    }

    if (property.broadbandMapUrl) {
      actions.appendChild(buildMapLink(property.broadbandLabel || "Fibre Unknown", property.broadbandMapUrl));
    }

    if (isMobileLayout() && property.id === selectedPropertyId) {
      item.classList.add("has-expanded-details");
      const expanded = document.createElement("div");
      expanded.className = "timeline-expanded";
      populatePropertyDetails(expanded, property);
      item.appendChild(expanded);
    }

    item.classList.toggle("has-actions", actions.childElementCount > 0);
    refs.timeline.appendChild(fragment);
  });
}

function renderDetails(selected) {
  if (isMobileLayout()) {
    refs.propertyDetails.className = "property-details empty-state";
    refs.propertyDetails.innerHTML = "";
    return;
  }

  populatePropertyDetails(refs.propertyDetails, selected);
}

function populatePropertyDetails(container, selected) {
  if (!selected) {
    container.className = "property-details empty-state";
    container.innerHTML = `
      <h2>Select a property</h2>
      <p>Open a stop from the itinerary to review timing, notes, and checklist items.</p>
    `;
    return;
  }

  container.className = "property-details";
  const sourcesMarkup = (selected.sources || [])
    .map((source) => `<span class="source-pill">${escapeHtml(source.label)} - ${escapeHtml(source.name)}</span>`)
    .join("");

  const checklistMarkup = (selected.checklist || []).length
    ? `<ul class="detail-list">${selected.checklist.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : `<p class="meta-text">No checklist items yet.</p>`;

  container.innerHTML = `
    <div class="detail-title-block">
      <p class="eyebrow">${escapeHtml(selected.displaySuburb || selected.suburb || "Open Home")}</p>
      <h2>${escapeHtml(selected.displayAddress || selected.address)}</h2>
      <p>${escapeHtml(selected.priceEstimate)}</p>
    </div>

    <div class="detail-actions">
      <button id="arrive-button" class="primary-button" type="button">${selected.status === "current" ? "Mark As Done" : "Check In Now"}</button>
      <button id="remove-button" class="secondary-button" type="button">Remove Stop</button>
      ${selected.listingUrl ? `<a class="secondary-button link-button" href="${selected.listingUrl}" target="_blank" rel="noreferrer">Open Listing</a>` : ""}
      ${selected.broadbandMapUrl ? `<a class="secondary-button link-button" href="${selected.broadbandMapUrl}" target="_blank" rel="noreferrer">${escapeHtml(selected.broadbandLabel || "Fibre Unknown")}</a>` : ""}
      ${selected.fromPreviousMapUrl ? `<a class="secondary-button link-button" href="${selected.fromPreviousMapUrl}" target="_blank" rel="noreferrer">Route Here</a>` : ""}
      ${selected.toNextMapUrl ? `<a class="secondary-button link-button" href="${selected.toNextMapUrl}" target="_blank" rel="noreferrer">Route To Next</a>` : ""}
    </div>

    <section class="detail-section">
      <div class="detail-section-header">
        <h3>Timing</h3>
        <span class="chip ${selected.status}">${escapeHtml(selected.status)}</span>
      </div>
      <div class="detail-timing-grid">
        <article><span>Open Window</span><strong>${escapeHtml(selected.openStart)} - ${escapeHtml(selected.openEnd)}</strong></article>
        <article><span>${escapeHtml(selected.travelFromPreviousTitle)}</span><strong>${escapeHtml(selected.travelFromPreviousValue)}</strong></article>
        <article><span>${escapeHtml(selected.distanceFromCurrentTitle)}</span><strong>${escapeHtml(selected.distanceFromCurrentLabel)}</strong></article>
        <article><span>${escapeHtml(selected.leaveByTitle)}</span><strong>${escapeHtml(selected.leaveByLabel)}</strong></article>
      </div>
      <div class="detail-actions">
        <button id="refresh-live-eta" class="ghost-button" type="button">Refresh Google ETA</button>
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
        <article><span>Section Size</span><strong>${escapeHtml(selected.sectionSize || "-")}</strong></article>
        <article><span>Fibre</span><strong>${escapeHtml(selected.broadbandLabel || "Checking...")}</strong></article>
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

  container.querySelector("#arrive-button").addEventListener("click", () => toggleArrival(selected.id));
  container.querySelector("#remove-button").addEventListener("click", () => removeProperty(selected.id));
  container.querySelector("#refresh-live-eta").addEventListener("click", () => refreshSelectedEtas(selected));
  container.querySelector("#notes-form").addEventListener("submit", (event) => saveNotes(event, selected.id));
  container.querySelector("#reset-notes-button").addEventListener("click", () => {
    container.querySelector("#property-notes-input").value = selected.notes || "";
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

  refs.propertyForm.dataset.imageUrl = String(property.imageUrl || "").trim();
  setFormValue("address", property.address || "");
  setFormValue("suburb", property.suburb || "");
  setFormValue("openStart", property.openStart || "");
  setFormValue("openEnd", property.openEnd || "");
  setFormValue("beds", property.beds ?? "");
  setFormValue("baths", property.baths ?? "");
  setFormValue("parking", property.parking ?? "");
  setFormValue("sectionSize", property.sectionSize || "");
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

async function enrichImportedDraft(property) {
  if (!property?.listingUrl || !IMPORT_ENDPOINT) {
    return property;
  }

  try {
    const response = await fetch(`${IMPORT_ENDPOINT}?url=${encodeURIComponent(property.listingUrl)}`);
    const payload = await response.json();
    if (response.ok && payload.property) {
      return {
        ...property,
        ...payload.property,
        listingUrl: property.listingUrl
      };
    }
  } catch {
    // Keep the bookmarklet payload when the worker is unavailable.
  }

  return property;
}

async function lookupAddressCandidates(address, limit = 5) {
  const response = await fetch(`${GEOCODE_ENDPOINT}?address=${encodeURIComponent(address)}&limit=${limit}`);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Address search failed.");
  }

  return Array.isArray(payload.matches) ? payload.matches : [];
}

async function consumeIncomingPayloads() {
  const url = new URL(window.location.href);
  const payload = url.searchParams.get("prefill");
  const listPayload = url.searchParams.get("prefill_list");
  let changedUrl = false;

  if (payload) {
    try {
      const parsed = await enrichImportedDraft(JSON.parse(decodeBase64Url(payload)));
      populateFormFromImport(parsed, parsed.listingUrl || "");
      refs.importUrlInput.value = parsed.listingUrl || parsed.sourceUrl || "";
      updateImportStatus("Imported property draft from bookmarklet. Review the fields, then add it to the day.");
      refs.propertyDialog.showModal();
      updateAppStatus("Loaded a property draft from the bookmarklet.");
    } catch {
      updateAppStatus("Could not read the bookmarklet payload.");
    }
    url.searchParams.delete("prefill");
    changedUrl = true;
  }

  if (listPayload) {
    try {
      const parsed = JSON.parse(decodeBase64Url(listPayload));
      await importBookmarkletList(parsed.listings || []);
    } catch {
      updateAppStatus("Could not read the bookmarklet list payload.");
    }
    url.searchParams.delete("prefill_list");
    changedUrl = true;
  }

  if (changedUrl) {
    window.history.replaceState({}, document.title, url.toString());
  }
}

function loadProperties() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function loadHomeLocation() {
  try {
    const raw = localStorage.getItem(HOME_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persistProperties(properties) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(properties));
}

function persistHomeLocation(homeLocation) {
  if (!homeLocation) {
    localStorage.removeItem(HOME_STORAGE_KEY);
    return;
  }
  localStorage.setItem(HOME_STORAGE_KEY, JSON.stringify(homeLocation));
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
    const displayLocation = buildDisplayLocation(property.address, property.suburb);
    const previousProperty = sorted[index - 1];
    const nextProperty = sorted[index + 1];
    const previousOrigin = previousProperty || (index === 0 ? state.homeLocation : null);
    const previousOriginLabel = previousProperty ? "Previous Stop" : previousOrigin ? "Starting Location" : "Start";
    const distanceFromPreviousKm = hasCoordinates(previousOrigin) && hasCoordinates(property) ? haversineKm(previousOrigin, property) : null;
    const previousRoute = hasCoordinates(previousOrigin) && hasCoordinates(property) ? getCachedRoute(previousOrigin, property, routeCache) : null;
    const travelFromPreviousMinutes = previousOrigin
      ? previousRoute?.durationMinutes ?? (distanceFromPreviousKm == null ? null : estimateTravelMinutes(distanceFromPreviousKm))
      : 0;

    const currentOrigin = currentIndex === -1 || index <= currentIndex ? currentLocation : sorted[currentIndex];
    const distanceFromCurrentKm = hasCoordinates(currentOrigin) && hasCoordinates(property) ? haversineKm(currentOrigin, property) : null;
    const currentRoute = hasCoordinates(currentOrigin) && hasCoordinates(property) ? getCachedRoute(currentOrigin, property, routeCache) : null;
    const distanceFromCurrentLabel = currentRoute
      ? currentRoute.distanceLabel
      : distanceFromCurrentKm == null
        ? state.homeLocation
          ? "Save or refresh a location"
          : "Location needed"
        : `${distanceFromCurrentKm.toFixed(1)} km away`;
    const currentTravelLabel = currentRoute
      ? `${currentRoute.durationMinutes} min from ${state.currentLocation ? "you" : "start"}`
      : distanceFromCurrentKm == null
        ? state.homeLocation
          ? "Start location needed"
          : "Location needed"
        : `${estimateTravelMinutes(distanceFromCurrentKm)} min from ${state.currentLocation ? "you" : "start"}`;

    const openStartDate = combineWithToday(property.openStart);
    const openEndDate = combineWithToday(property.openEnd);
    const nextRoute = hasCoordinates(property) && hasCoordinates(nextProperty) ? getCachedRoute(property, nextProperty, routeCache) : null;
    const nextTravelMinutes = nextProperty
      ? nextRoute?.durationMinutes ?? (hasCoordinates(property) && hasCoordinates(nextProperty) ? estimateTravelMinutes(haversineKm(property, nextProperty)) : 0)
      : 0;
    const leaveByDate = nextProperty
      ? new Date(combineWithToday(nextProperty.openStart).getTime() - nextTravelMinutes * 60000)
      : openEndDate;

    const computedTravelFromPreviousMinutes = travelFromPreviousMinutes ?? 0;
    const departureLabel = formatClockTime(dateToTimeString(new Date(openStartDate.getTime() - computedTravelFromPreviousMinutes * 60000)));
    const arrivalLabel = formatClockTime(property.openStart);
    const timeRemainingMinutes = Math.max(0, Math.round((openEndDate.getTime() - now.getTime()) / 60000));
    const openWindowLabel = `${Math.max(0, Math.round((openEndDate.getTime() - openStartDate.getTime()) / 60000))} min window`;
    const leaveByLabel = formatClockTime(dateToTimeString(leaveByDate));
    const leaveDeltaMinutes = Math.round((leaveByDate.getTime() - now.getTime()) / 60000);

    return {
      ...property,
      displayAddress: displayLocation.address,
      displaySuburb: displayLocation.suburb,
      previousProperty,
      nextProperty,
      currentOrigin,
      travelFromPreviousMinutes: computedTravelFromPreviousMinutes,
      travelFromPreviousLabel: previousOrigin
        ? travelFromPreviousMinutes == null
          ? `${previousOriginLabel} needed`
          : `${travelFromPreviousMinutes} min drive`
        : "Start here",
      travelFromPreviousTitle: previousOrigin ? `Drive From ${previousOriginLabel}` : "Starting Stop",
      travelFromPreviousValue: previousOrigin
        ? travelFromPreviousMinutes == null
          ? "Coordinates needed"
          : `${travelFromPreviousMinutes} min`
        : "Start here",
      distanceFromCurrentTitle: state.currentLocation ? "Distance From You" : "Distance From Start",
      distanceFromCurrentLabel,
      departureLabel,
      arrivalLabel,
      openWindowLabel,
      leaveByLabel: nextProperty ? leaveByLabel : formatClockTime(property.openEnd),
      leaveByTitle: nextProperty ? "Leave This Stop By" : "Stay Until",
      timeRemainingLabel: `${timeRemainingMinutes} min left`,
      leaveMessage: buildLeaveMessage(property.status, leaveDeltaMinutes, timeRemainingMinutes, nextProperty),
      leaveWarningClass: leaveDeltaMinutes < 0 ? "danger-text" : leaveDeltaMinutes <= 10 ? "warning-text" : "meta-text",
      currentTravelLabel,
      fromPreviousMapUrl: buildGoogleMapsDirectionsUrl(previousOrigin, property),
      toNextMapUrl: buildGoogleMapsDirectionsUrl(property, nextProperty),
      broadbandMapUrl: getBroadbandStatus(property).pageUrl,
      broadbandLabel: getBroadbandStatus(property).label,
      liveEtaDetail: currentRoute
        ? `Live Google route estimate: ${currentRoute.durationLabel}, ${currentRoute.distanceLabel}.`
        : state.currentLocation
          ? "Live drive ETA will improve once the Google route service responds."
          : state.homeLocation
            ? "Saved starting location is being used until you refresh live position."
          : "Refresh live position to see drive ETA from your current location."
    };
  });
}

async function refreshSelectedEtas(property) {
  if (!ETA_ENDPOINT) {
    updateAppStatus("Google ETA is not configured for this app.");
    return;
  }

  const requests = [];

  if (hasCoordinates(property.previousProperty) && hasCoordinates(property)) {
    requests.push(fetchBetterEta(property.previousProperty, property));
  } else if (!property.previousProperty && hasCoordinates(state.homeLocation) && hasCoordinates(property)) {
    requests.push(fetchBetterEta(state.homeLocation, property));
  }

  if (hasCoordinates(property.currentOrigin) && hasCoordinates(property)) {
    requests.push(fetchBetterEta(property.currentOrigin, property));
  }

  if (hasCoordinates(property) && hasCoordinates(property.nextProperty)) {
    requests.push(fetchBetterEta(property, property.nextProperty));
  }

  if (!requests.length) {
    updateAppStatus("This stop needs coordinates before Google ETA can be refreshed.");
    return;
  }

  updateAppStatus("Refreshing Google ETA for this stop...");
  await Promise.allSettled(requests);
  renderApp();
}

async function fetchBetterEta(origin, destination) {
  if (!hasCoordinates(origin) || !hasCoordinates(destination)) {
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

function ensureBroadbandStatuses(properties) {
  if (!BROADBAND_ENDPOINT) {
    return;
  }

  properties.forEach((property) => {
    if (!hasCoordinates(property)) {
      return;
    }

    const key = buildBroadbandKey(property);
    if (state.broadbandCache[key] || state.pendingBroadbandRequests.has(key)) {
      return;
    }

    fetchBroadbandStatus(property);
  });
}

async function fetchBroadbandStatus(property) {
  const key = buildBroadbandKey(property);
  state.pendingBroadbandRequests.add(key);

  try {
    const params = new URLSearchParams({
      lat: String(property.lat),
      lng: String(property.lng)
    });
    const response = await fetch(`${BROADBAND_ENDPOINT}?${params.toString()}`);
    const payload = await response.json();
    if (response.ok && payload.broadband) {
      state.broadbandCache[key] = payload.broadband;
      renderApp();
      return;
    }

    state.broadbandCache[key] = {
      label: "Fibre check unavailable",
      pageUrl: buildBroadbandMapUrl(property)
    };
    renderApp();
  } catch {
    state.broadbandCache[key] = {
      label: "Fibre check unavailable",
      pageUrl: buildBroadbandMapUrl(property)
    };
    renderApp();
  } finally {
    state.pendingBroadbandRequests.delete(key);
  }
}

function buildRouteKey(origin, destination) {
  return `${roundCoord(origin.lat)},${roundCoord(origin.lng)}:${roundCoord(destination.lat)},${roundCoord(destination.lng)}`;
}

function buildBroadbandKey(property) {
  return `${roundCoord(property.lat)},${roundCoord(property.lng)}`;
}

function getCachedRoute(origin, destination, routeCache) {
  return routeCache[buildRouteKey(origin, destination)] || null;
}

function roundCoord(value) {
  return Number(value).toFixed(5);
}

function parseCoordinateValue(value) {
  if (value === "" || value == null) {
    return "";
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : "";
}

function hasCoordinates(value) {
  return Boolean(value) && Number.isFinite(Number(value.lat)) && Number.isFinite(Number(value.lng));
}

function buildGoogleMapsDirectionsUrl(origin, destination) {
  if (!destination || (!hasCoordinates(destination) && !destination.address)) {
    return "";
  }

  const url = new URL("https://www.google.com/maps/dir/");
  const params = url.searchParams;
  params.set("api", "1");
  params.set("travelmode", "driving");
  params.set("destination", buildMapsLocationValue(destination));

  if (origin && (hasCoordinates(origin) || origin.address)) {
    params.set("origin", buildMapsLocationValue(origin));
  }

  return url.toString();
}

function buildBroadbandMapUrl(property) {
  if (!hasCoordinates(property)) {
    return "";
  }

  return `https://broadbandmap.nz/availability/${property.lat}/${property.lng}`;
}

function getBroadbandStatus(property) {
  if (!hasCoordinates(property)) {
    return {
      label: "No location",
      pageUrl: ""
    };
  }

  const fallbackPageUrl = buildBroadbandMapUrl(property);
  const cached = state.broadbandCache[buildBroadbandKey(property)];
  if (cached) {
    return {
      label: cached.label || "Fibre Unknown",
      pageUrl: cached.pageUrl || fallbackPageUrl
    };
  }

  if (state.pendingBroadbandRequests.has(buildBroadbandKey(property))) {
    return {
      label: "Checking fibre...",
      pageUrl: fallbackPageUrl
    };
  }

  return {
    label: "Check fibre",
    pageUrl: fallbackPageUrl
  };
}

function buildMapsLocationValue(value) {
  if (hasCoordinates(value)) {
    return `${value.lat},${value.lng}`;
  }
  return String(value.address || "").trim();
}

function buildMapLink(label, url) {
  const link = document.createElement("a");
  link.className = "secondary-button link-button";
  link.href = url;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = label;
  return link;
}

function buildLeaveMessage(status, leaveDeltaMinutes, timeRemainingMinutes, nextProperty) {
  if (status === "current") {
    if (!nextProperty) {
      return `You can stay for another ${timeRemainingMinutes} minutes before this open home ends.`;
    }
    if (leaveDeltaMinutes < 0) {
      return "You should already be heading to the next property to stay on schedule.";
    }
    return `You can stay about ${leaveDeltaMinutes} more minutes before leaving this stop for the next open home.`;
  }

  if (status === "done") {
    return "This stop is marked complete.";
  }

  if (leaveDeltaMinutes < 0) {
    return "The ideal departure time has already passed for this stop.";
  }

  return nextProperty
    ? `Leave this stop in ${leaveDeltaMinutes} minutes to stay on plan.`
    : "This is the last planned stop, so you can stay until the open home ends.";
}

function buildDisplayLocation(address, suburb) {
  const parts = String(address || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const uniqueParts = [];
  const seen = new Set();
  for (const part of parts) {
    const key = part.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      uniqueParts.push(part);
    }
  }

  const normalizedSuburb = String(suburb || "").trim();
  const street = uniqueParts[0] || String(address || "").trim();

  let displaySuburb = normalizedSuburb;
  if (!displaySuburb) {
    displaySuburb = uniqueParts[1] || "";
  }

  if (displaySuburb) {
    const suburbKey = displaySuburb.toLowerCase();
    const matchingPart = uniqueParts.find((part, index) => index > 0 && part.toLowerCase() === suburbKey);
    displaySuburb = matchingPart || displaySuburb;
  }

  return {
    address: street,
    suburb: displaySuburb
  };
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
    navigator.serviceWorker
      .register("./sw.js", { updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch(() => {});
  }
}

function decodeBase64Url(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function hydrateHomeForm() {
  if (!state.homeLocation) {
    updateHomeStatus("Saved home location will be used before live device location.");
    refs.homeSearchResults.innerHTML = '<option value="">Search for an address to choose a match</option>';
    return;
  }

  refs.homeAddressInput.value = state.homeLocation.address || "";
  refs.homeLatInput.value = state.homeLocation.lat ?? "";
  refs.homeLngInput.value = state.homeLocation.lng ?? "";
  refs.homeSearchResults.innerHTML = '<option value="">Search for an address to choose a match</option>';
  updateHomeStatus(`Using ${state.homeLocation.address || "saved home location"} as the default route start.`);
}

function handleSaveHomeLocation(event) {
  event.preventDefault();

  const address = refs.homeAddressInput.value.trim();
  const lat = parseCoordinateValue(refs.homeLatInput.value);
  const lng = parseCoordinateValue(refs.homeLngInput.value);

  if (!address || !hasCoordinates({ lat, lng })) {
    updateHomeStatus("Search for an address or enter a home address with valid latitude and longitude.", true);
    return;
  }

  state.homeLocation = { address, lat, lng };
  persistHomeLocation(state.homeLocation);
  updateHomeStatus(`Saved ${address} as your starting location.`);
  updateAppStatus("Saved home location.");
  renderApp();
}

function clearHomeLocation() {
  state.homeLocation = null;
  state.homeSearchResults = [];
  persistHomeLocation(null);
  refs.homeForm.reset();
  refs.homeSearchResults.innerHTML = '<option value="">Search for an address to choose a match</option>';
  updateHomeStatus("Cleared saved home location.");
  updateAppStatus("Cleared home location.");
  renderApp();
}

async function handleSearchHomeAddress() {
  const address = refs.homeAddressInput.value.trim();

  if (!address) {
    updateHomeStatus("Enter an address to search.", true);
    return;
  }

  if (!GEOCODE_ENDPOINT) {
    updateHomeStatus("No address search endpoint is configured. Redeploy the worker to enable it.", true);
    return;
  }

  refs.homeSearchButton.disabled = true;
  updateHomeStatus("Searching for address matches...");

  try {
    const matches = await lookupAddressCandidates(address, 5);
    state.homeSearchResults = matches;
    refs.homeSearchResults.innerHTML = '<option value="">Choose an address match</option>';

    matches.forEach((match, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = match.address;
      refs.homeSearchResults.appendChild(option);
    });

    updateHomeStatus(matches.length ? "Choose the closest address match, then save it." : "No address matches found.", !matches.length);
  } catch (error) {
    updateHomeStatus(error.message || "Address search failed.", true);
  } finally {
    refs.homeSearchButton.disabled = false;
  }
}

function handleSelectHomeAddress(event) {
  const index = Number(event.target.value);
  const match = state.homeSearchResults[index];
  if (!match) {
    return;
  }

  refs.homeAddressInput.value = match.address;
  refs.homeLatInput.value = match.lat;
  refs.homeLngInput.value = match.lng;
  updateHomeStatus(`Selected ${match.address}. Save Home to use it as your route start.`);
}

function exportPlan() {
  const payload = {
    exportedAt: new Date().toISOString(),
    version: 1,
    homeLocation: state.homeLocation,
    properties: state.properties
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  anchor.href = url;
  anchor.download = `house-hunter-plan-${date}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  updateAppStatus("Exported the current plan.");
}

async function importPlanFromFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const properties = Array.isArray(payload.properties) ? payload.properties.map(normalizeImportedProperty).filter(Boolean) : [];

    state.properties = getSortedProperties(properties);
    state.selectedPropertyId = state.properties[0]?.id ?? null;
    persistProperties(state.properties);

    if (payload.homeLocation && Number.isFinite(Number(payload.homeLocation.lat)) && Number.isFinite(Number(payload.homeLocation.lng))) {
      state.homeLocation = {
        address: String(payload.homeLocation.address || "").trim(),
        lat: Number(payload.homeLocation.lat),
        lng: Number(payload.homeLocation.lng)
      };
      persistHomeLocation(state.homeLocation);
      hydrateHomeForm();
    }

    updateAppStatus(`Imported ${state.properties.length} properties from file.`);
    renderApp();
  } catch {
    updateAppStatus("Could not import that plan file.");
  } finally {
    refs.importPlanFileInput.value = "";
  }
}

function normalizeImportedProperty(property) {
  if (!property || !property.address) {
    return null;
  }

  return {
    id: property.id || crypto.randomUUID(),
    address: String(property.address || "").trim(),
    suburb: String(property.suburb || "").trim(),
    openStart: String(property.openStart || ""),
    openEnd: String(property.openEnd || ""),
    beds: Number(property.beds) || 0,
    baths: Number(property.baths) || 0,
    parking: Number(property.parking) || 0,
    sectionSize: String(property.sectionSize || "").trim(),
    lat: parseCoordinateValue(property.lat),
    lng: parseCoordinateValue(property.lng),
    imageUrl: String(property.imageUrl || "").trim(),
    priceEstimate: String(property.priceEstimate || "").trim(),
    listingUrl: String(property.listingUrl || "").trim(),
    notes: String(property.notes || "").trim(),
    checklist: Array.isArray(property.checklist) ? property.checklist : [],
    sources: Array.isArray(property.sources) ? property.sources : buildSources(String(property.listingUrl || "").trim()),
    status: ["upcoming", "current", "done"].includes(property.status) ? property.status : "upcoming",
    checkInTime: property.checkInTime || null
  };
}

async function importBookmarkletList(listings) {
  if (!Array.isArray(listings) || !listings.length) {
    updateAppStatus("No listings were found in the bookmarklet payload.");
    return;
  }

  if (!IMPORT_ENDPOINT) {
    updateAppStatus("Batch import needs the listing import endpoint to be configured.");
    return;
  }

  const existingUrls = new Set(
    state.properties.map((property) => property.listingUrl).filter(Boolean)
  );
  const uniqueListings = listings.filter((item) => item && item.listingUrl && !existingUrls.has(item.listingUrl));

  if (!uniqueListings.length) {
    updateAppStatus("All bookmarklet listings are already in the route.");
    return;
  }

  updateAppStatus(`Importing ${uniqueListings.length} listings from the bookmarklet...`);

  let importedProperties = [];

  if (BATCH_IMPORT_ENDPOINT) {
    importedProperties = await importListingBatch(uniqueListings);
  }

  if (!importedProperties.length) {
    importedProperties = [];
    for (const item of uniqueListings) {
      try {
        const imported = await importListingData(item.listingUrl);
        importedProperties.push(buildPropertyFromImport(imported, item.listingUrl, item.title || ""));
      } catch {
        importedProperties.push(buildFallbackImportedProperty(item.listingUrl, item.title || "Imported listing"));
      }
    }
  }

  state.properties.push(...importedProperties);
  state.properties = getSortedProperties(state.properties);
  state.selectedPropertyId = importedProperties[0]?.id ?? state.selectedPropertyId;
  persistProperties(state.properties);
  updateAppStatus(`Imported ${importedProperties.length} listings from the bookmarklet.`);
  renderApp();
}

async function importListingBatch(listings) {
  try {
    const response = await fetch(BATCH_IMPORT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        urls: listings.map((item) => item.listingUrl)
      })
    });
    const payload = await response.json();

    if (!response.ok || !Array.isArray(payload.results)) {
      throw new Error(payload.error || "Batch import failed.");
    }

    const titleByUrl = new Map(listings.map((item) => [item.listingUrl, item.title || "Imported listing"]));

    return payload.results.map((result) => {
      const fallbackTitle = titleByUrl.get(result.url) || "Imported listing";
      if (result.ok && result.property) {
        return buildPropertyFromImport(result.property, result.url, fallbackTitle);
      }
      return buildFallbackImportedProperty(result.url, fallbackTitle);
    });
  } catch {
    return [];
  }
}

async function importListingData(listingUrl) {
  const response = await fetch(`${IMPORT_ENDPOINT}?url=${encodeURIComponent(listingUrl)}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Import failed.");
  }
  return payload.property;
}

function buildPropertyFromImport(property, listingUrl, fallbackTitle = "") {
  return {
    id: crypto.randomUUID(),
    address: String(property.address || fallbackTitle || "Imported listing").trim(),
    suburb: String(property.suburb || "").trim(),
    openStart: String(property.openStart || ""),
    openEnd: String(property.openEnd || ""),
    beds: Number(property.beds) || 0,
    baths: Number(property.baths) || 0,
    parking: Number(property.parking) || 0,
    sectionSize: String(property.sectionSize || "").trim(),
    lat: parseCoordinateValue(property.lat),
    lng: parseCoordinateValue(property.lng),
    imageUrl: String(property.imageUrl || "").trim(),
    priceEstimate: String(property.priceEstimate || "Imported listing").trim(),
    listingUrl,
    notes: String(property.notes || "").trim(),
    checklist: Array.isArray(property.checklist) ? property.checklist : [],
    sources: buildSources(listingUrl),
    status: "upcoming",
    checkInTime: null
  };
}

function buildFallbackImportedProperty(listingUrl, fallbackTitle) {
  return {
    id: crypto.randomUUID(),
    address: fallbackTitle || "Imported listing",
    suburb: "",
    openStart: "",
    openEnd: "",
    beds: 0,
    baths: 0,
    parking: 0,
    sectionSize: "",
    lat: "",
    lng: "",
    imageUrl: "",
    priceEstimate: "Imported listing",
    listingUrl,
    notes: "",
    checklist: [
      "Review listing details manually",
      "Confirm open home time"
    ],
    sources: buildSources(listingUrl),
    status: "upcoming",
    checkInTime: null
  };
}

function normalizeTimelineImageUrl(value) {
  const input = String(value || "").trim();
  if (!input) {
    return "";
  }

  try {
    const url = new URL(input, window.location.href);
    return url.toString().replace(/"/g, "%22");
  } catch {
    return "";
  }
}
