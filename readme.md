# Sleepcast Jam

## Why you might see 503s when loading the Top 50 list locally

The `/api/top50` function has to reach two Apple endpoints (the Apple Charts RSS/JSON feed and the iTunes lookup API) to translate their chart data into canonical podcast RSS URLs. If those network calls fail, hang, or are blocked (for example, when running `netlify dev` on a machine that cannot reach Apple’s domains), the function can time out and the local dev server will return a `503`.

To keep the UI usable in that scenario, the function now wraps all outbound calls in timeouts and always falls back to a small, hard-coded list of feeds while including a warning that explains the failure reason. You can still add your own feeds, and once your network can reach Apple the live Top 50 list will be returned instead of the fallback.

### What is happening when you see `Failed to fetch top feed: 503`
* Apple’s chart endpoint is returning HTTP 503 to the function (it does this intermittently and more often from some residential networks and VPNs).
* When that happens, the function now returns **HTTP 200** with a small fallback feed list and a `warning` field describing the upstream failure instead of bubbling a 500 back to your browser.
* If you still see a 500 in `netlify dev`, it usually means the call never made it past DNS/connection setup (for example, offline, corporate proxy, or firewall). In that case the error will be logged to the dev console and the function will respond with the fallback payload.

### How to confirm locally
1. Start `netlify dev`.
2. Hit `http://localhost:8888/.netlify/functions/top50` directly in the browser or `curl`.
3. If Apple is reachable you’ll see an array of feeds; if not, you’ll get the fallback JSON with a `warning` explaining why (e.g., `Failed to fetch top feed: 503`). The UI should keep working using that fallback.

## Audio proxy to avoid CORS failures

Podcast audio files are still hosted by the publishers and many do not send permissive CORS headers. The client now pulls every snippet through `/api/audio`, a Netlify Function that re-fetches the file server-side and returns it with `Access-Control-Allow-Origin: *`. If snippet decoding fails because of a blocked request, check the function logs for `audio proxy error` to see the upstream response.

Netlify responses are capped around 6 MB; the proxy intentionally limits downloads to ~2.5 MB (plus base64 overhead) via a `Range` request. You’ll get a `206` response with an `X-Proxy-Note` header when truncation happens, and the UI surfaces that note in the snippet status line.
