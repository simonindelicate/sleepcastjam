# Sleepcast Jam

Sleepcast Jam layers podcast snippets over curated white-noise loops so you can drift off to voices. Add your own RSS feeds or pull a toplist, pick a soundscape, and let the Web Audio pipeline handle crossfading, EQ, and a sleep timer.

## Stack
- Vanilla HTML/CSS/JS front-end (no build step) served directly from `index.html` and `src/` assets.
- Web Audio API for noise playback, convolution reverb, and snippet mixing.
- Netlify Functions in `netlify/functions/`:
  - `top50` fetches Apple's toplists (via Marketing Tools + classic iTunes RSS) and falls back to a static list if the upstream call fails.
  - `audio` proxies podcast audio to avoid publisher-side CORS limits and caps responses with `Range` requests.
- `node-fetch` for server-side HTTP calls.
- Font Awesome icons and locally bundled background/noise assets.

## What the app does
- Load a toplist (US or UK) or add podcast RSS URLs manually.
- Cache feeds locally so reloads are fast.
- Cycle ambient soundscapes and adjust mix levels, reverb, EQ, and snippet cadence.
- Start/stop playback from either the hero button or the control panel and set a sleep timer.

> Genre-specific toplist buttons are currently disabled until a reliable source is available.

## Getting started
1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Run locally with Netlify Functions**
   ```bash
   npx netlify dev
   ```
   The site and functions will be available at `http://localhost:8888` by default.
3. **Deploy**
   Commit to a Netlify-connected repo or run `npx netlify deploy` with your site configured. The included `netlify.toml` already routes `/api/*` to the functions folder.

## Top 50 toplist behavior
- The UI hits `/api/top50` with optional `country` and `genre` params. The function queries Apple's Marketing Tools and classic iTunes RSS endpoints, then uses the iTunes Lookup API to resolve each podcast's RSS feed URL.
- If both Apple endpoints are unreachable or return empty data, the function responds with a small hard-coded feed list and a `warning` field explaining the upstream issue, so the UI stays usable.

## Audio proxy to avoid CORS failures
Podcast audio files are still hosted by publishers and many do not send permissive CORS headers. The client pulls each snippet through `/api/audio`, a Netlify Function that re-fetches the file server-side and returns it with `Access-Control-Allow-Origin: *`.

Netlify responses are capped around ~6 MB; the proxy intentionally limits downloads to ~2.5 MB (plus base64 overhead) via a `Range` request. You’ll get a `206` response with an `X-Proxy-Note` header when truncation happens, and the UI surfaces that note in the snippet status line.
