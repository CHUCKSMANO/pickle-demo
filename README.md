# Pickle — concept demo (web)

An interactive, self-contained concept demo of Pickle, the macOS launcher for
running Android apps on Apple Silicon. This is a static site: plain HTML, CSS,
and JavaScript with no build step and no dependencies.

## Files

- `index.html` — page structure for every demo view
- `styles.css` — layout and theme
- `app.js` — simulated interactions (nav, device, apps, settings)
- `vercel.json` — Vercel static-site configuration

## Run locally

Any static file server works, for example:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` directly in a browser also works.

## Deploy on Vercel

The repository is imported directly from GitHub; Vercel serves it as a static
site with no build.

1. Go to https://vercel.com/new and import `CHUCKSMANO/pickle-demo`.
2. Use these settings:
   - **Framework Preset:** Other
   - **Root Directory:** `./`
   - **Build Command:** off / empty
   - **Output Directory:** off / empty
   - **Install Command:** off
3. Deploy.

`vercel.json` turns on clean URLs (`/` and `/index` instead of `/index.html`)
and keeps URLs without a trailing slash.

Every push to the `main` branch triggers a new production deployment.

## Live URL

_Add the Vercel deployment URL here once the project is imported, e.g._
`https://pickle-demo.example.vercel.app` _(the exact name depends on the Vercel
project name and global availability)._

## Related projects

- `../pickle` — original native SwiftUI/Xcode prototype (reference only)
- `../pickle-electron` — the current Electron + React desktop app
