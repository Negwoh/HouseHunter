# House Hunter

House Hunter is a buildless, installable web app for planning a day of open homes.

Current capabilities:

- add properties through a modal app flow
- import a `realestate.co.nz` listing URL through a serverless worker
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
- `config.js`: frontend runtime config such as the import endpoint
- `config.example.js`: example config for new deployments
- `manifest.webmanifest`: install metadata
- `sw.js`: offline asset caching
- `icons/`: app icons
- `worker/`: Cloudflare Worker that imports listing data from `realestate.co.nz`

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

- The `realestate.co.nz` import requires the worker to be deployed and configured in `config.js`.
- Travel time is estimated from straight-line distance with a fixed driving speed.
- There is no backend, auth layer, or multi-user sync yet.

## realestate.co.nz import setup

The frontend is ready to import listing URLs, but it needs a worker endpoint.

### 1. Deploy the worker

The repo includes a Cloudflare Worker scaffold in `worker/`.

1. Install Wrangler on a machine with Node available.
2. From the `worker/` directory, deploy with:
   `wrangler deploy`
3. Note the worker URL, for example:
   `https://house-hunter-import.your-subdomain.workers.dev/import`

### 2. Configure the frontend

Edit `config.js` and set:

`window.HOUSE_HUNTER_CONFIG.importEndpoint = "https://your-worker-url/import"`

### 3. Push the frontend again

Once `config.js` points at the worker, the `Import Listing` button in the add-property dialog will try to prefill:

- address
- suburb
- beds
- baths
- parking
- open-home time when detected
- price text
- notes/description
- checklist starter items
- coordinates when they are present in the page markup

## Next production integrations

The next external services to wire in are:

1. A maps provider for geocoding and real route ETAs.
2. A property ingestion layer for listing details and price signals.
3. A backend for saved plans, syncing, and collaboration.
