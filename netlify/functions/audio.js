const fetch =
  global.fetch ||
  ((...args) => import('node-fetch').then(({ default: f }) => f(...args)));

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: 'OK' };
  }

  const url = event.queryStringParameters?.url;
  if (!url) {
    return { statusCode: 400, headers: corsHeaders, body: 'Missing url parameter' };
  }

  try {
    const upstream = await fetch(url, {
      headers: {
        // Some podcast hosts require a UA; keep it minimal but explicit.
        'User-Agent': 'sleepcast-podcast-noise/1.0',
      },
    });

    if (!upstream.ok) {
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
        'Cache-Control': 'public, max-age=3600',
      },
      isBase64Encoded: true,
      body: base64,
    };
  } catch (err) {
    console.error('audio proxy error', err);
    return { statusCode: 502, headers: corsHeaders, body: `Proxy fetch failed: ${err.message}` };
  }
};
