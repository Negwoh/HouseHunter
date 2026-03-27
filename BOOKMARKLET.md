# House Hunter Bookmarklet

Source bookmarklet script: [bookmarklet.js](./bookmarklet.js)
Minified source: [bookmarklet.min.js](./bookmarklet.min.js)
Ready-to-paste bookmarklet URL: [bookmarklet.url.txt](./bookmarklet.url.txt)

## What it does

When run on public `realestate.co.nz` pages, the bookmarklet now supports two modes:

- single listing page:
  it extracts a best-effort property draft and opens House Hunter with the add-property dialog prefilled
- list/search/results page:
  it collects multiple listing URLs from the page and opens House Hunter with a batch import payload
- saved properties page:
  it now treats this as a dedicated multi-import flow, retries while the page finishes loading, then hands the collected listing URLs to House Hunter in one batch

House Hunter then imports that list through the existing listing import endpoint.

## Configure it

The deployed app URL is defined at the top of `bookmarklet.js`:

`const APP_URL = "https://negwoh.github.io/HouseHunter/";`

If your deploy URL changes, update that value.

## Creating the bookmarklet

1. Open `bookmarklet.url.txt`
2. Copy the single `javascript:` line
3. Create a browser bookmark
4. Paste that line into the bookmark URL/location field

## Notes

- This bookmarklet only uses public page content.
- It does not rely on private auth tokens or session APIs.
- Single listing pages open a draft for review, including best-effort extraction for beds, baths, parking, section size, and coordinates.
- List/search/saved-properties pages try to import multiple listings into the route automatically.
- Batch import depends on the House Hunter worker being deployed, because House Hunter now prefers the worker batch endpoint before falling back to one-by-one imports.
