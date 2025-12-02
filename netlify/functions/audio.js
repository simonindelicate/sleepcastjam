const fetch =
  global.fetch ||
  ((...args) => import('node-fetch').then(({ default: f }) => f(...args)));

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Netlify hard-limits responses to ~6 MB; keep a large safety margin and
// account for base64 expansion (~33%). This keeps the encoded body well under
// the platform limit while still delivering a meaningful snippet.
const MAX_BYTES = 2_500_000;
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
    let bytesRead = 0;
    let truncated = false;
    const chunks = [];

    if (!upstream.body) {
      throw new Error('No response body');
    }

    for await (const chunk of upstream.body) {
      const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = MAX_BYTES - bytesRead;
      if (remaining <= 0) {
        truncated = true;
        break;
      }

      if (bufferChunk.length > remaining) {
        chunks.push(bufferChunk.subarray(0, remaining));
        bytesRead += remaining;
        truncated = true;
        // Stop reading to avoid exceeding limits.
        if (upstream.body.destroy) upstream.body.destroy();
        break;
      }

      chunks.push(bufferChunk);
      bytesRead += bufferChunk.length;
    }

    const payload = Buffer.concat(chunks);
    const base64 = payload.toString('base64');

    return {
      statusCode: truncated ? 206 : 200,
      headers: {
        ...corsHeaders,
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=1800',
        'Accept-Ranges': 'bytes',
        'X-Proxy-Note': truncated
          ? `Audio truncated to ${bytesRead} bytes to fit Netlify limits`
          : 'Full audio (within limit)',
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
