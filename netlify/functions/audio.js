const fetch =
  global.fetch ||
  ((...args) => import('node-fetch').then(({ default: f }) => f(...args)));

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const MAX_BYTES = 8 * 1024 * 1024; // keep responses small to avoid 502s on big episodes
const FETCH_TIMEOUT_MS = 15000;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: 'OK' };
  }

  const url = event.queryStringParameters?.url;
  if (!url) {
    return { statusCode: 400, headers: corsHeaders, body: 'Missing url parameter' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const upstream = await fetch(url, {
      // Limit response size; node-fetch throws if it exceeds `size`.
      size: MAX_BYTES,
      headers: {
        // Some podcast hosts require a UA; keep it minimal but explicit.
        'User-Agent': 'sleepcast-podcast-noise/1.0',
        Accept: 'audio/*;q=0.9,*/*;q=0.5',
        Range: `bytes=0-${MAX_BYTES - 1}`,
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!upstream.ok && upstream.status !== 206) {
      return {
        statusCode: upstream.status,
        headers: corsHeaders,
        body: `Upstream fetch failed: ${upstream.statusText}`,
      };
    }

    const contentType = upstream.headers.get('content-type') || 'audio/mpeg';
    const arrayBuffer = await upstream.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=1800',
        'Accept-Ranges': 'bytes',
      },
      isBase64Encoded: true,
      body: base64,
    };
  } catch (err) {
    clearTimeout(timeout);
    console.error('audio proxy error', err);
    const message = err?.name === 'AbortError' ? 'Proxy fetch timed out or exceeded size limit' : err.message;
    return { statusCode: 502, headers: corsHeaders, body: `Proxy fetch failed: ${message}` };
  }
};
