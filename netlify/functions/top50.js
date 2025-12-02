const fetch =
  global.fetch ||
  ((...args) => import('node-fetch').then(({ default: f }) => f(...args)));

const TOP_FEED_URL = 'https://rss.itunes.apple.com/api/v1/us/podcasts/top-podcasts/all/100/explicit.json';
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
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeoutId));
}

function extractIdFromUrl(url) {
  const match = url.match(/\/id(\d+)/);
  return match ? match[1] : null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  let reason = '';
  try {
    const response = await fetchWithTimeout(TOP_FEED_URL, 6000);

    if (!response.ok) {
      throw new Error(`Failed to fetch top feed: ${response.status}`);
    }
    const data = await response.json();
    const entries = Array.isArray(data?.feed?.results) ? data.feed.results : [];
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
            title: entry.name || entry.artistName || 'Podcast',
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

    throw new Error('No feeds resolved');
  } catch (error) {
    reason = error?.message || 'Unknown failure';
    console.error('top50 error', error);
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feeds: FALLBACK_FEEDS,
        warning:
          'Using fallback list because the Apple API was unreachable or timed out. ' +
          `Reason: ${reason}`,
      }),
    };
  }
};
