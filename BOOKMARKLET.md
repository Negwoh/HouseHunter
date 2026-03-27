# House Hunter Bookmarklet

Source bookmarklet script: [bookmarklet.js](./bookmarklet.js)

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

1. Open `bookmarklet.js`
2. Minify it into one line
3. Prefix it with `javascript:`
4. Save it as a browser bookmark

Example wrapper shape:

```text
javascript:(function(){/* minified code here */})();
```

## Notes

- This bookmarklet only uses public page content.
- It does not rely on private auth tokens or session APIs.
- If some fields are missing from the listing page, House Hunter still opens with a partial draft you can edit manually.
