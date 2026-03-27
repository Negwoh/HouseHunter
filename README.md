# House Hunter

House Hunter is now a modular, installable web app for planning a day of open homes.

Current capabilities:

- add properties through a modal app flow instead of an inline form
- track the day as a timed driving itinerary
- click into a stop for timing, checklist, notes, and source links
- refresh device location for live distance-to-next estimates
- check into a property and see how long you can stay before leaving
- save likes, dislikes, and follow-up notes per property
- install the app as a lightweight PWA

## Running it

This workspace does not have a Node toolchain installed, so the app is intentionally buildless.

1. Open [index.html](./index.html) in a browser.
2. Use `Add Property` or `Load Example Day`.
3. Allow location access if you want live distance estimates.
4. If your browser supports it, install the app from the browser menu as a PWA.

## Project structure

- `index.html`: app shell, planner layout, and add-property dialog
- `styles.css`: full app styling
- `app/main.js`: app bootstrapping, events, state updates
- `app/render.js`: summary, itinerary, and details rendering
- `app/planner.js`: timing, distance, and route calculations
- `app/storage.js`: local persistence
- `app/data.js`: example open-home data
- `manifest.webmanifest`: install metadata
- `sw.js`: offline asset caching

## Data model

Each property stores:

- address and suburb
- open-home start and end times
- bedroom, bathroom, and parking counts
- latitude and longitude
- price estimate
- listing URL and source metadata
- notes
- checklist items
- visit status: `upcoming`, `current`, or `done`

The app persists the day plan in `localStorage`.

## Current limitations

- It does not fetch live listing data from `realestate.co.nz` yet.
- Travel time is estimated from straight-line distance with a fixed driving speed.
- There is no backend, auth layer, or multi-user sync yet.

## Next production integrations

The next external services to wire in are:

1. A maps provider for geocoding and real route ETAs.
2. A property ingestion layer for listing details and price signals.
3. A backend for saved plans, syncing, and collaboration.
