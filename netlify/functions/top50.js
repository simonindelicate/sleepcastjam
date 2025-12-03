const fetch =
  global.fetch ||
  ((...args) => import('node-fetch').then(({ default: f }) => f(...args)));

// Helpful for local development when upstream endpoints are unreachable
const FALLBACK_FEEDS = [
  { title: 'The Daily', feedUrl: 'https://feeds.simplecast.com/54nAGcIl' },
  { title: 'Stuff You Should Know', feedUrl: 'https://feeds.megaphone.fm/stuffyoushouldknow' },
  { title: 'Radiolab', feedUrl: 'https://feeds.wnyc.org/radiolab' },
  { title: '99% Invisible', feedUrl: 'https://feeds.simplecast.com/BqbsxVfO' },
  { title: 'This American Life', feedUrl: 'https://feeds.thisamericanlife.org/talpodcast' },
];

// Map Apple genre IDs to the closest gpodder tag that offers a toplist endpoint.
const GPODDER_TAGS = {
  '1301': 'arts',
  '1321': 'business',
  '1310': 'music',
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function fetchWithTimeout(url, timeoutMs = 7000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, {
    signal: controller.signal,
    headers: {
      // Apple sometimes returns 503 unless a UA is provided; keep it simple but explicit.
      'User-Agent': 'sleepcast-podcast-noise/1.0',
    },
  }).finally(() => clearTimeout(timeoutId));
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  const params = event.queryStringParameters || {};
  const country = /^[a-z]{2}$/i.test(params.country || '')
    ? params.country.toLowerCase()
    : 'us';
  const genre = params.genre && /^\d+$/.test(params.genre) ? params.genre : '';

  // gpodder provides free toplist endpoints by tag and country; use those when a
  // genre is specified and fall back to the general toplist when not.
  const limit = 50;
  const genreTag = genre ? GPODDER_TAGS[genre] : '';
  const gpodderUrl = genreTag
    ? `https://gpodder.net/api/2/tag/${genreTag}/${limit}.json`
    : `https://gpodder.net/toplist/${limit}.json`;

  let reason = '';
  try {
    const response = await fetchWithTimeout(gpodderUrl, 6000);
    if (!response.ok) {
      reason = `Failed to fetch ${gpodderUrl}: ${response.status}`;
      throw new Error(reason);
    }

    const entries = (await response.json()) || [];
    const feeds = entries
      .map((entry) => ({
        title: entry.title || entry.subtitle || 'Podcast',
        feedUrl: entry.url,
      }))
      .filter((entry) => Boolean(entry.feedUrl))
      .slice(0, 50);

    if (feeds.length) {
      return {
        statusCode: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(feeds),
      };
    }

    reason = 'No feeds resolved';
  } catch (error) {
    reason = error?.message || 'Unknown failure';
    console.error('top50 error', error);
  }

  // Always fall back to the static list when the chart endpoint fails to respond or
  // returns an empty payload, but include the reason so local callers can see the
  // precise upstream failure that occurred.
  return {
    statusCode: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      feeds: FALLBACK_FEEDS,
        warning:
          'Using fallback list because the chart API was unreachable, returned an error, or had no results. ' +
          `Reason: ${reason || 'unknown'}`,
    }),
  };
};
