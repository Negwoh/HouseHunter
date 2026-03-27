# House Hunter

House Hunter is a buildless, installable web app for planning a day of open homes.

Current capabilities:

- add properties through a modal app flow
- track the day as a timed driving itinerary
- click into each stop for timing, checklist, notes, and source links
- refresh device location for live distance-to-next estimates
- check into a property and see how long you can stay before leaving
- save likes, dislikes, and follow-up notes per property
- install the app as a lightweight PWA when hosted over HTTPS

## Running it locally

1. Open `index.html` in a browser for a quick local preview.
2. Use `Add Property` or `Load Example Day`.
3. Allow location access if you want live distance estimates.

For best results, host it over HTTPS rather than opening it from `file://`.

## Deploying with GitHub Pages

This app is set up to work well on GitHub Pages because all assets use relative paths.

1. Push the repository to GitHub.
2. Open the repository settings.
3. Go to `Pages`.
4. Set the source to `Deploy from a branch`.
5. Select `main` and `/ (root)`.
6. Save.

GitHub will publish the app at a URL like:

`https://yourusername.github.io/HouseHunter/`

## Project structure

- `index.html`: app shell, planner layout, and add-property dialog
- `styles.css`: full app styling
- `app.js`: planner logic, rendering, local persistence, and interactions
- `manifest.webmanifest`: install metadata
- `sw.js`: offline asset caching
- `icons/`: app icons

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
