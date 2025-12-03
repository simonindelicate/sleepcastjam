const fs = require('fs');
const path = require('path');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const VALID_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function getBackgroundFiles() {
  const backgroundsDir = path.join(__dirname, '..', '..', 'src', 'assets', 'backgrounds');
  try {
    const entries = fs.readdirSync(backgroundsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && VALID_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
      .map((entry) => `/src/assets/backgrounds/${entry.name}`)
      .sort((a, b) => a.localeCompare(b));
  } catch (err) {
    console.error('Failed to read backgrounds directory', err);
    return [];
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  const images = getBackgroundFiles();

  return {
    statusCode: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ images }),
  };
};
