const fetch =
  global.fetch ||
  ((...args) => import('node-fetch').then(({ default: f }) => f(...args)));

const MARKETING_TOOLS_URL =
  'https://rss.applemarketingtools.com/api/v2/us/podcasts/top/100/podcasts.json';
const CLASSIC_ITUNES_URL = 'https://itunes.apple.com/us/rss/toppodcasts/limit=100/genre=1310/json';
const LOOKUP_URL = 'https://itunes.apple.com/lookup';

// Helpful for local development when Apple endpoints are unreachable
const FALLBACK_FEEDS = [
  { title: 'The Daily', feedUrl: 'https://feeds.simplecast.com/54nAGcIl' },
  { title: 'Stuff You Should Know', feedUrl: 'https://feeds.megaphone.fm/stuffyoushouldknow' },
  { title: 'Radiolab', feedUrl: 'https://feeds.wnyc.org/radiolab' },
  { title: '99% Invisible', feedUrl: 'https://feeds.simplecast.com/BqbsxVfO' },
  { title: 'This American Life', feedUrl: 'https://feeds.thisamericanlife.org/talpodcast' },
];

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

function extractIdFromUrl(url) {
  const match = url.match(/\/id(\d+)/);
  return match ? match[1] : null;
}

function normalizeMarketingTools(entries = []) {
  return entries.map((entry) => ({
    id: entry.id,
    title: entry.name || entry.artistName || 'Podcast',
    url: entry.url,
  }));
}

function normalizeClassic(entries = []) {
  return entries.map((entry) => ({
    id: entry?.id?.attributes?.['im:id'],
    title: entry?.['im:name']?.label || entry?.title?.label || 'Podcast',
    url: entry?.id?.label,
  }));
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  let reason = '';
  try {
    const attempts = [
      { url: MARKETING_TOOLS_URL, normalizer: (data) => normalizeMarketingTools(data?.feed?.results) },
      { url: CLASSIC_ITUNES_URL, normalizer: (data) => normalizeClassic(data?.feed?.entry) },
    ];

    for (const attempt of attempts) {
      const response = await fetchWithTimeout(attempt.url, 6000);
      if (!response.ok) {
        reason = `Failed to fetch ${attempt.url}: ${response.status}`;
        continue;
      }

      const data = await response.json();
      const entries = attempt.normalizer(data) || [];
      const topEntries = entries.slice(0, 50);

      const resolved = await Promise.all(
        topEntries.map(async (entry) => {
          const podcastId = entry.id || extractIdFromUrl(entry.url || '');
          if (!podcastId) return null;
          try {
            const lookupResp = await fetchWithTimeout(`${LOOKUP_URL}?id=${podcastId}`, 6000);
            if (!lookupResp.ok) return null;
            const lookup = await lookupResp.json();
            const feedUrl = lookup?.results?.[0]?.feedUrl;
            if (!feedUrl) return null;
            return {
              title: entry.title,
              feedUrl,
            };
          } catch (err) {
            console.error('Lookup error', err);
            return null;
          }
        })
      );

      const feeds = resolved.filter(Boolean);

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
    }
  } catch (error) {
    reason = error?.message || 'Unknown failure';
    console.error('top50 error', error);
  }

  // Always fall back to the static list when the Apple endpoints fail to respond or
  // return an empty payload, but include the reason so local callers can see the
  // precise upstream failure that occurred.
  return {
    statusCode: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      feeds: FALLBACK_FEEDS,
      warning:
        'Using fallback list because the Apple API was unreachable, returned an error, or had no results. ' +
        `Reason: ${reason || 'unknown'}`,
    }),
  };
};
