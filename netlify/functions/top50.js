const TOP_FEED_URL = 'https://rss.itunes.apple.com/api/v1/us/podcasts/top-podcasts/all/100/explicit.json';
const LOOKUP_URL = 'https://itunes.apple.com/lookup';

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
    const response = await fetch(TOP_FEED_URL);
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

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(feeds),
    };
  } catch (error) {
    console.error('top50 error', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Unable to load top podcasts' }),
    };
  }
};
