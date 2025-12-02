# Sleepcast Jam

## Why you might see 503s when loading the Top 50 list locally

The `/api/top50` function has to reach two Apple endpoints (the Apple Charts RSS/JSON feed and the iTunes lookup API) to translate their chart data into canonical podcast RSS URLs. If those network calls fail, hang, or are blocked (for example, when running `netlify dev` on a machine that cannot reach Apple’s domains), the function can time out and the local dev server will return a `503`.

To keep the UI usable in that scenario, the function now wraps all outbound calls in timeouts and always falls back to a small, hard-coded list of feeds while including a warning that explains the failure reason. You can still add your own feeds, and once your network can reach Apple the live Top 50 list will be returned instead of the fallback.
