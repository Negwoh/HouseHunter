# House Hunter Bookmarklet

Source bookmarklet script: [bookmarklet.js](./bookmarklet.js)
Minified source: [bookmarklet.min.js](./bookmarklet.min.js)
Ready-to-paste bookmarklet URL: [bookmarklet.url.txt](./bookmarklet.url.txt)

## What it does

When run on a public `realestate.co.nz` listing page, the bookmarklet:

- reads public listing data from JSON-LD, meta tags, and visible page text
- extracts a best-effort property draft
- opens the deployed House Hunter app with that draft encoded in the URL
- the app opens the add-property dialog with the fields prefilled for review

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
- If some fields are missing from the listing page, House Hunter still opens with a partial draft you can edit manually.
