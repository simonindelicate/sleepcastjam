const fetch =
  global.fetch ||
  ((...args) => import('node-fetch').then(({ default: f }) => f(...args)));

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function decodeEntities(text = '') {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractTagContent(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeEntities(match[1].trim()) : null;
}

function isAudioType(type) {
  return type ? type.toLowerCase().includes('audio') : false;
}

function isLikelyAudioUrl(url) {
  return /(\.mp3|\.m4a|\.aac|\.wav|\.ogg)(\?|$)/i.test(url);
}

function parseRss(xml) {
  const channelMatch = xml.match(/<channel[\s\S]*?<\/channel>/i);
  const channelXml = channelMatch ? channelMatch[0] : xml;
  const title = extractTagContent(channelXml, 'title') || 'Podcast feed';

  const items = [];
  const itemRegex = /<item[\s\S]*?<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml))) {
    const itemXml = match[0];
    const titleText = extractTagContent(itemXml, 'title') || 'Episode';
    let audioUrl = null;
    const enclosureMatch = itemXml.match(/<enclosure[^>]*>/i);
    if (enclosureMatch) {
      const enclosure = enclosureMatch[0];
      const urlMatch = enclosure.match(/url="([^"]+)"/i);
      const typeMatch = enclosure.match(/type="([^"]+)"/i);
      if (urlMatch && (!typeMatch || isAudioType(typeMatch[1]))) {
        audioUrl = urlMatch[1];
      }
    }

    if (!audioUrl) {
      const linkMatch = itemXml.match(/<link[^>]*>([^<]+)<\/link>/i);
      if (linkMatch && isLikelyAudioUrl(linkMatch[1])) {
        audioUrl = linkMatch[1];
      }
    }

    if (audioUrl) {
      items.push({
        title: decodeEntities(titleText),
        audioUrl,
      });
    }
  }

  return { title, episodes: items };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  const url = event.queryStringParameters?.url || (event.body && JSON.parse(event.body || '{}').url);
  if (!url || !/^https?:\/\//i.test(url)) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Invalid URL' }),
    };
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'Failed to fetch feed' }),
      };
    }

    const xml = await response.text();
    const parsed = parseRss(xml);

    if (!parsed.episodes.length) {
      return {
        statusCode: 422,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'No playable episodes found' }),
      };
    }

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(parsed),
    };
  } catch (error) {
    console.error('fetchFeed error', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Unable to parse feed' }),
    };
  }
};
