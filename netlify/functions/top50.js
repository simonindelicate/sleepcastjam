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

function extractIdFromUrl(url) {
  const match = url.match(/\/id(\d+)/);
  return match ? match[1] : null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const response = await fetch(TOP_FEED_URL, { signal: controller.signal });
    clearTimeout(timeoutId);

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
          const lookupResp = await fetch(`${LOOKUP_URL}?id=${podcastId}`);
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
    console.error('top50 error', error);
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feeds: FALLBACK_FEEDS,
        warning: 'Using fallback list because the Apple API was unreachable.',
      }),
    };
  }
};
