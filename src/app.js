const state = {
  feeds: [],
  episodes: [],
  audioCtx: null,
  masterGain: null,
  noiseGain: null,
  snippetGain: null,
  dryGain: null,
  reverbGain: null,
  lowpass: null,
  convolver: null,
  noiseSource: null,
  noiseSourceGain: null,
  customNoiseBuffer: null,
  noiseBuffers: new Map(),
  selectedNoise: 'wires',
  topUpdatedAt: null,
  buffers: new Map(),
  failureCounts: new Map(),
  isPlaying: false,
  snippetTimeoutId: null,
  timerIntervalId: null,
  endTime: null,
  diagnostics: {
    snippetAttempts: 0,
    snippetSuccesses: 0,
    lastSnippetMessage: 'Waiting to start.',
    nextSnippetAt: null,
    proxyNote: '',
  },
};

const STORAGE_KEY = 'podcastNoiseUserFeeds';
const TOP_STORAGE_KEY = 'podcastNoiseTopFeeds';
const FEED_LIMIT = 50;

const TOP_GENRES = {
  arts: '1301',
  business: '1321',
  music: '1310',
};

const NOISE_PROFILES = [
  { id: 'wires', label: 'Wires', audio: '/src/assets/wires.ogg', art: '/src/assets/wires.jpg' },  
  { id: 'pool', label: 'Pool', audio: '/src/assets/pool.ogg', art: '/src/assets/pool.png' },
  { id: 'rain', label: 'Rain', audio: '/src/assets/rain.ogg', art: '/src/assets/rain.png' },
  { id: 'waves', label: 'Waves', audio: '/src/assets/waves.ogg', art: '/src/assets/waves.png' },
  { id: 'sepia', label: 'Sepia', audio: '/src/assets/sepia.ogg', art: '/src/assets/sepia.png' },
];

const GHOST_COLORS = [
  'rgba(226, 232, 240, 0.72)',
  'rgba(209, 213, 219, 0.68)',
  'rgba(186, 196, 210, 0.66)',
  'rgba(148, 163, 184, 0.62)',
  'rgba(161, 174, 196, 0.64)',
];

const elements = {
  loadTop: document.getElementById('loadTop'),
  loadTopUk: document.getElementById('loadTopUk'),
  loadTopArts: document.getElementById('loadTopArts'),
  loadTopBusiness: document.getElementById('loadTopBusiness'),
  loadTopMusic: document.getElementById('loadTopMusic'),
  feedStatus: document.getElementById('feedStatus'),
  addFeedBtn: document.getElementById('addFeed'),
  feedUrlInput: document.getElementById('feedUrl'),
  addStatus: document.getElementById('addStatus'),
  feedList: document.getElementById('feedList'),
  togglePlay: document.getElementById('togglePlay'),
  playStatus: document.getElementById('playStatus'),
  noiseLevel: document.getElementById('noiseLevel'),
  snippetLevel: document.getElementById('snippetLevel'),
  minGap: document.getElementById('minGap'),
  maxGap: document.getElementById('maxGap'),
  minLength: document.getElementById('minLength'),
  maxLength: document.getElementById('maxLength'),
  tone: document.getElementById('tone'),
  reverbMix: document.getElementById('reverbMix'),
  sleepMinutes: document.getElementById('sleepMinutes'),
  timerDisplay: document.getElementById('timerDisplay'),
  heroTimer: document.getElementById('heroTimer'),
  episodeSummary: document.getElementById('episodeSummary'),
  snippetStatus: document.getElementById('snippetStatus'),
  nextSnippet: document.getElementById('nextSnippet'),
  noiseStatus: document.getElementById('noiseStatus'),
  noiseUrl: document.getElementById('noiseUrl'),
  setNoiseUrl: document.getElementById('setNoiseUrl'),
  noiseFile: document.getElementById('noiseFile'),
  setNoiseFile: document.getElementById('setNoiseFile'),
  resetNoise: document.getElementById('resetNoise'),
  noiseLabel: document.getElementById('noiseLabel'),
  soundscapeGrid: document.getElementById('soundscapeGrid'),
  ghostContainer: document.getElementById('ghostContainer'),
  topUpdatedAt: document.getElementById('topUpdatedAt'),
  heroPlayToggle: document.getElementById('heroPlayToggle'),
  scrollControls: document.getElementById('scrollControls'),
  cycleBackground: document.getElementById('cycleBackground'),
  heroBgLayers: [
    document.getElementById('heroBgA'),
    document.getElementById('heroBgB'),
  ].filter(Boolean),
  controlsAnchor: document.getElementById('controls'),
  feedListContainer: document.getElementById('feedListContainer'),
  toggleFeedList: document.getElementById('toggleFeedList'),
};

const uiState = {
  feedListCollapsed: true,
  isStartingPlayback: false,
};

const heroBackgroundState = {
  images: [],
  activeLayer: 0,
  currentIndex: 0,
  isTransitioning: false,
  pendingIndex: null,
  intervalId: null,
};

const BACKGROUND_ROTATION_MS = 3 * 60 * 1000;

function pruneTitle(rawTitle) {
  if (!rawTitle) return rawTitle;
  let title = String(rawTitle).trim();
  title = title.replace(/^[^:]*:\s*/, '');
  title = title.replace(/\bepisode\b/gi, '');
  title = title.replace(/\d+/g, '');
  title = title.replace(/[–—-]+/g, ' ');
  title = title.replace(/\s{2,}/g, ' ').trim();
  return title || rawTitle.trim();
}

function setNoiseLabel(text) {
  if (elements.noiseLabel) {
    elements.noiseLabel.textContent = `Noise: ${text}`;
  }
}

function setHeroTimer(text) {
  if (!elements.heroTimer) return;
  if (text) {
    elements.heroTimer.textContent = text;
    elements.heroTimer.style.display = 'inline-flex';
  } else {
    elements.heroTimer.textContent = '';
    elements.heroTimer.style.display = 'none';
  }
}

function formatRemainingTime(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (v) => String(v).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function preloadImage(src) {
  const img = new Image();
  img.src = src;
}

async function loadHeroBackgrounds() {
  const images = new Set();
  const addIfValid = (src) => {
    if (src && typeof src === 'string') {
      images.add(src);
    }
  };

  const discoverViaApi = async () => {
    try {
      const resp = await fetch('/api/backgrounds', { cache: 'no-cache' });
      if (!resp.ok) return false;
      const data = await resp.json();
      (data?.images || []).forEach(addIfValid);
      return true;
    } catch (err) {
      console.error('Unable to fetch hero backgrounds from API', err);
      return false;
    }
  };

  const discoverViaDirectoryListing = async () => {
    try {
      const resp = await fetch('/src/assets/backgrounds/', { cache: 'no-cache' });
      if (!resp.ok) return false;
      const contentType = resp.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) return false;
      const html = await resp.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const anchors = Array.from(doc.querySelectorAll('a[href]'));
      anchors
        .map((a) => a.getAttribute('href'))
        .filter((href) => /\.(jpg|jpeg|png|webp)$/i.test(href))
        .map((href) => (href.startsWith('/') ? href : `/src/assets/backgrounds/${href.replace(/^\.\//, '')}`))
        .forEach(addIfValid);
      return images.size > 0;
    } catch (err) {
      console.error('Unable to parse hero backgrounds directory listing', err);
      return false;
    }
  };

  const loaded = await discoverViaApi();
  if (!loaded) {
    await discoverViaDirectoryListing();
  }

  heroBackgroundState.images = Array.from(images);
  if (!heroBackgroundState.images.length) {
    console.warn('No hero backgrounds found in /src/assets/backgrounds.');
  }
  heroBackgroundState.images.forEach(preloadImage);
}

function setHeroBackground(index, immediate = false) {
  if (!heroBackgroundState.images.length || elements.heroBgLayers.length < 2) return;

  const total = heroBackgroundState.images.length;
  const targetIndex = ((index % total) + total) % total;

  if (heroBackgroundState.isTransitioning && !immediate) {
    heroBackgroundState.pendingIndex = targetIndex;
    return;
  }

  const nextLayerIndex = 1 - heroBackgroundState.activeLayer;
  const nextLayer = elements.heroBgLayers[nextLayerIndex];
  const currentLayer = elements.heroBgLayers[heroBackgroundState.activeLayer];
  const src = heroBackgroundState.images[targetIndex];

  heroBackgroundState.isTransitioning = !immediate;
  nextLayer.style.backgroundImage = `url('${src}')`;

  if (immediate) {
    nextLayer.classList.add('visible');
    currentLayer.classList.remove('visible');
    heroBackgroundState.activeLayer = nextLayerIndex;
    heroBackgroundState.currentIndex = targetIndex;
    heroBackgroundState.isTransitioning = false;
    heroBackgroundState.pendingIndex = null;
    return;
  }

  requestAnimationFrame(() => {
    nextLayer.classList.add('visible');
    currentLayer.classList.remove('visible');
    setTimeout(() => {
      heroBackgroundState.activeLayer = nextLayerIndex;
      heroBackgroundState.currentIndex = targetIndex;
      heroBackgroundState.isTransitioning = false;
      if (heroBackgroundState.pendingIndex !== null) {
        const pending = heroBackgroundState.pendingIndex;
        heroBackgroundState.pendingIndex = null;
        setHeroBackground(pending);
      }
    }, 1700);
  });
}

function cycleHeroBackground(manual = false) {
  if (!heroBackgroundState.images.length) return;
  const nextIndex = (heroBackgroundState.currentIndex + 1) % heroBackgroundState.images.length;
  setHeroBackground(nextIndex);
  if (manual) restartHeroBackgroundInterval();
}

function restartHeroBackgroundInterval() {
  if (heroBackgroundState.intervalId) clearInterval(heroBackgroundState.intervalId);
  if (heroBackgroundState.images.length < 2) return;
  heroBackgroundState.intervalId = setInterval(() => cycleHeroBackground(false), BACKGROUND_ROTATION_MS);
}

async function initHeroBackgrounds() {
  await loadHeroBackgrounds();
  if (!heroBackgroundState.images.length || !elements.heroBgLayers.length) return;

  const first = heroBackgroundState.images[0];
  elements.heroBgLayers.forEach((layer, index) => {
    layer.style.backgroundImage = `url('${first}')`;
    layer.classList.toggle('visible', index === 0);
  });
  heroBackgroundState.activeLayer = 0;
  heroBackgroundState.currentIndex = 0;
  heroBackgroundState.pendingIndex = null;
  heroBackgroundState.isTransitioning = false;
  restartHeroBackgroundInterval();
}

function renderSoundscapes() {
  if (!elements.soundscapeGrid) return;
  elements.soundscapeGrid.innerHTML = '';
  NOISE_PROFILES.forEach((profile) => {
    const btn = document.createElement('button');
    btn.className = `soundscape${state.selectedNoise === profile.id ? ' active' : ''}`;
    btn.style.backgroundImage = `linear-gradient(180deg, rgba(0,0,0,0.1), rgba(0,0,0,0.5)), url('${profile.art}')`;
    btn.type = 'button';
    const label = document.createElement('span');
    label.textContent = profile.label;
    btn.appendChild(label);
    btn.addEventListener('click', () => selectSoundscape(profile.id));
    elements.soundscapeGrid.appendChild(btn);
  });
}

function loadUserFeeds() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        parsed.forEach((feed) => {
          state.feeds.push({ ...feed, title: pruneTitle(feed.title) || feed.feedUrl, userAdded: true });
        });
      }
    }
  } catch (err) {
    console.error('Failed to load saved feeds', err);
  }
}

function saveUserFeeds() {
  const userFeeds = state.feeds.filter((f) => f.userAdded).map(({ title, feedUrl }) => ({ title, feedUrl }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(userFeeds));
}

function loadTopFeedCache() {
  try {
    const raw = localStorage.getItem(TOP_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.feeds)) return null;
    return { feeds: parsed.feeds, updatedAt: parsed.updatedAt || null };
  } catch (err) {
    console.error('Failed to load cached top feeds', err);
    return null;
  }
}

function saveTopFeedCache(feeds) {
  try {
    localStorage.setItem(
      TOP_STORAGE_KEY,
      JSON.stringify({ feeds, updatedAt: new Date().toISOString() }),
    );
  } catch (err) {
    console.error('Failed to store cached top feeds', err);
  }
}

function renderFeeds() {
  elements.feedList.innerHTML = '';
  state.feeds.forEach((feed, index) => {
    const li = document.createElement('li');
    const info = document.createElement('div');
    info.textContent = pruneTitle(feed.title) || feed.feedUrl;
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = feed.userAdded ? 'User' : 'Top';
    info.appendChild(badge);
    li.appendChild(info);

    if (feed.userAdded) {
      const removeBtn = document.createElement('button');
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        state.feeds.splice(index, 1);
        state.episodes = state.episodes.filter((ep) => ep.feedUrl !== feed.feedUrl);
        saveUserFeeds();
        renderFeeds();
      });
      li.appendChild(removeBtn);
    }
    elements.feedList.appendChild(li);
  });

  updateEpisodeSummary();
}

function setFeedListVisibility(collapsed) {
  uiState.feedListCollapsed = collapsed;
  if (elements.feedListContainer) {
    elements.feedListContainer.style.display = collapsed ? 'none' : 'block';
  }
  if (elements.toggleFeedList) {
    elements.toggleFeedList.textContent = collapsed ? 'Show Feeds' : 'Hide Feeds';
  }
}

function updateTopUpdatedAt(dateString) {
  state.topUpdatedAt = dateString || null;
  if (elements.topUpdatedAt) {
    elements.topUpdatedAt.textContent = dateString
      ? `Top podcasts updated ${new Date(dateString).toLocaleString()}`
      : 'Top podcasts not loaded yet.';
  }
  if (elements.loadTop) {
    elements.loadTop.textContent = dateString ? 'Refresh Top Podcasts' : 'Load Top Podcasts';
  }
}

function updatePlayStatus(message) {
  elements.playStatus.textContent = message;
}

function syncPlayButtons(isPlaying) {
  const startLabel = isPlaying ? 'Stop' : 'Start';
  elements.togglePlay.textContent = startLabel;
  if (elements.heroPlayToggle) {
    elements.heroPlayToggle.textContent = isPlaying ? 'Stop' : 'Play';
  }
  document.body.classList.toggle('is-playing', isPlaying);
}

function setPlaybackLoading(isLoading) {
  [elements.heroPlayToggle, elements.togglePlay].forEach((btn) => {
    if (!btn) return;
    btn.classList.toggle('is-loading', isLoading);
    btn.disabled = isLoading;
  });
}

function updateEpisodeSummary() {
  const total = state.episodes.length;
  const user = state.episodes.filter((ep) => ep.userAdded).length;
  const top = total - user;
  if (elements.episodeSummary) {
    elements.episodeSummary.textContent = total
      ? `Episodes ready: ${total} (Your feeds: ${user}, Top feeds: ${top}).`
      : 'No episodes loaded yet. Add a feed or load the Top list.';
  }
}

function updateSnippetStatus(extra = '') {
  const { snippetAttempts, snippetSuccesses, lastSnippetMessage, nextSnippetAt, proxyNote } = state.diagnostics;
  if (elements.snippetStatus) {
    const proxy = proxyNote ? ` Proxy: ${proxyNote}` : '';
    const status = `Snippets tried: ${snippetAttempts}, played: ${snippetSuccesses}. ${lastSnippetMessage}${proxy}`;
    elements.snippetStatus.textContent = status + (extra ? ` ${extra}` : '');
  }
  if (elements.nextSnippet) {
    if (state.isPlaying && nextSnippetAt) {
      const secs = Math.max(0, Math.round((nextSnippetAt - Date.now()) / 1000));
      const { minGap, maxGap } = getSnippetConfig();
      elements.nextSnippet.textContent = `Next snippet in ~${secs}s (gap range ${minGap}-${maxGap}s).`;
    } else {
      elements.nextSnippet.textContent = '';
    }
  }
}

function displayGhost(title) {
  if (!elements.ghostContainer || !title) return;
  const ghost = document.createElement('div');
  ghost.className = 'ghost';
  ghost.textContent = pruneTitle(title) || title;
  const padding = 12;
  const x = padding + Math.random() * (100 - padding * 2);
  const y = padding + Math.random() * (100 - padding * 2);
  const size = 18 + Math.random() * 34;
  const color = GHOST_COLORS[Math.floor(Math.random() * GHOST_COLORS.length)];
  ghost.style.left = `${x}%`;
  ghost.style.top = `${y}%`;
  ghost.style.fontSize = `${size}px`;
  ghost.style.color = color;
  ghost.style.textShadow = `0 0 28px ${color.replace('0.', '0.35')}`;
  ghost.style.animationDuration = `${10 + Math.random() * 6}s`;
  elements.ghostContainer.appendChild(ghost);
  setTimeout(() => ghost.remove(), 16000);
}

function weightedRandomEpisode() {
  if (!state.episodes.length) return null;
  const weighted = [];
  state.episodes.forEach((ep) => {
    const weight = ep.userAdded ? 2 : 1;
    for (let i = 0; i < weight; i += 1) {
      weighted.push(ep);
    }
  });
  const choice = weighted[Math.floor(Math.random() * weighted.length)];
  return choice;
}

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function proxiedAudioUrl(url) {
  const encoded = encodeURIComponent(url);
  return `/api/audio?url=${encoded}`;
}

function getNumberInput(el, fallback, minValue = -Infinity, maxValue = Infinity) {
  const parsed = parseFloat(el?.value);
  if (Number.isFinite(parsed)) {
    return Math.min(Math.max(parsed, minValue), maxValue);
  }
  return fallback;
}

function getSnippetConfig() {
  let minGap = getNumberInput(elements.minGap, 6, 1, 30);
  let maxGap = getNumberInput(elements.maxGap, 18, 1, 30);
  if (maxGap < minGap) maxGap = minGap;

  let minLength = getNumberInput(elements.minLength, 18, 4, 60);
  let maxLength = getNumberInput(elements.maxLength, 26, 4, 60);
  if (maxLength < minLength) maxLength = minLength;

  const tone = getNumberInput(elements.tone, 2200, 400, 4000);
  const reverbMix = getNumberInput(elements.reverbMix, 0.55, 0, 1);

  return { minGap, maxGap, minLength, maxLength, tone, reverbMix };
}

function buildAudioGraph() {
  if (!state.audioCtx) {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  const ctx = state.audioCtx;
  state.masterGain = ctx.createGain();
  state.masterGain.gain.value = 0.8;
  state.masterGain.connect(ctx.destination);

  state.noiseGain = ctx.createGain();
  state.noiseGain.gain.value = parseFloat(elements.noiseLevel.value);
  state.noiseGain.connect(state.masterGain);

  state.snippetGain = ctx.createGain();
  state.snippetGain.gain.value = parseFloat(elements.snippetLevel.value);

  state.lowpass = ctx.createBiquadFilter();
  state.lowpass.type = 'lowpass';
  state.lowpass.frequency.value = getSnippetConfig().tone;

  state.convolver = ctx.createConvolver();
  state.convolver.buffer = createImpulseResponse(ctx);

  state.dryGain = ctx.createGain();
  state.reverbGain = ctx.createGain();
  const { reverbMix } = getSnippetConfig();
  state.dryGain.gain.value = 1 - reverbMix;
  state.reverbGain.gain.value = reverbMix;

  state.snippetGain.connect(state.lowpass);
  state.lowpass.connect(state.dryGain);
  state.lowpass.connect(state.convolver);
  state.dryGain.connect(state.masterGain);
  state.convolver.connect(state.reverbGain);
  state.reverbGain.connect(state.masterGain);
}

function createNoiseBuffer(ctx) {
  const duration = 2;
  const channels = 1;
  const sampleRate = ctx.sampleRate;
  const buffer = ctx.createBuffer(channels, duration * sampleRate, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function getNoiseProfile(id) {
  return NOISE_PROFILES.find((profile) => profile.id === id) || NOISE_PROFILES[0];
}

async function ensureNoiseBuffer(id) {
  const profile = getNoiseProfile(id);
  if (!profile) return null;
  if (state.noiseBuffers.has(profile.id)) return state.noiseBuffers.get(profile.id);
  if (!state.audioCtx) buildAudioGraph();
  const resp = await fetch(profile.audio);
  if (!resp.ok) throw new Error('Failed to load noise file');
  const arr = await resp.arrayBuffer();
  const buf = await state.audioCtx.decodeAudioData(arr);
  state.noiseBuffers.set(profile.id, buf);
  return buf;
}

async function selectSoundscape(id) {
  const profile = getNoiseProfile(id);
  state.selectedNoise = profile.id;
  state.customNoiseBuffer = null;
  setNoiseLabel(profile.label);
  if (elements.noiseStatus) elements.noiseStatus.textContent = `Soundscape selected: ${profile.label}`;
  renderSoundscapes();
  try {
    const buffer = await ensureNoiseBuffer(profile.id);
    if (state.isPlaying && buffer) {
      await startNoise(buffer);
    }
  } catch (err) {
    console.error(err);
    if (elements.noiseStatus) elements.noiseStatus.textContent = 'Unable to load soundscape';
  }
}

function createImpulseResponse(ctx) {
  const duration = 1;
  const decay = 1.8;
  const sampleRate = ctx.sampleRate;
  const length = sampleRate * duration;
  const impulse = ctx.createBuffer(2, length, sampleRate);
  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const channelData = impulse.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      const t = i / length;
      channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
  }
  return impulse;
}

function applyToneAndReverb() {
  if (!state.lowpass || !state.dryGain || !state.reverbGain) return;
  const { tone, reverbMix } = getSnippetConfig();
  state.lowpass.frequency.value = tone;
  state.dryGain.gain.value = 1 - reverbMix;
  state.reverbGain.gain.value = reverbMix;
}

async function getActiveNoiseBuffer() {
  if (state.customNoiseBuffer) return state.customNoiseBuffer;
  if (state.selectedNoise) {
    const selectedBuffer = await ensureNoiseBuffer(state.selectedNoise);
    if (selectedBuffer) return selectedBuffer;
  }
  if (!state.audioCtx) buildAudioGraph();
  return createNoiseBuffer(state.audioCtx);
}

async function startNoise(bufferOverride = null) {
  if (!state.audioCtx) buildAudioGraph();
  const ctx = state.audioCtx;
  let buffer = bufferOverride;
  if (!buffer) {
    try {
      buffer = await getActiveNoiseBuffer();
    } catch (err) {
      console.error('Noise load failed', err);
      if (elements.noiseStatus) elements.noiseStatus.textContent = 'Falling back to generated noise';
    }
  }
  if (!buffer) buffer = createNoiseBuffer(ctx);

  const source = ctx.createBufferSource();
  const fader = ctx.createGain();
  fader.gain.value = 0;
  source.buffer = buffer;
  source.loop = true;
  source.connect(fader);
  fader.connect(state.noiseGain);

  const now = ctx.currentTime;
  fader.gain.linearRampToValueAtTime(1, now + 1.5);
  source.start();

  if (state.noiseSourceGain) {
    state.noiseSourceGain.gain.cancelScheduledValues(now);
    state.noiseSourceGain.gain.setValueAtTime(state.noiseSourceGain.gain.value, now);
    state.noiseSourceGain.gain.linearRampToValueAtTime(0, now + 1.5);
    try {
      state.noiseSource.stop(now + 1.6);
    } catch (e) { /* ignore */ }
  }

  state.noiseSource = source;
  state.noiseSourceGain = fader;
}

async function loadCustomNoiseFromUrl(url) {
  if (!state.audioCtx) buildAudioGraph();
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Unable to fetch noise audio');
  const arrayBuf = await resp.arrayBuffer();
  const audioBuf = await state.audioCtx.decodeAudioData(arrayBuf);
  state.customNoiseBuffer = audioBuf;
}

async function loadCustomNoiseFromFile(file) {
  if (!state.audioCtx) buildAudioGraph();
  const arrayBuf = await file.arrayBuffer();
  const audioBuf = await state.audioCtx.decodeAudioData(arrayBuf);
  state.customNoiseBuffer = audioBuf;
}

async function loadAudioBuffer(url) {
  if (state.buffers.has(url)) return state.buffers.get(url);
  const resp = await fetch(proxiedAudioUrl(url));
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    state.diagnostics.proxyNote = '';
    throw new Error(`audio fetch failed (${resp.status}): ${detail.slice(0, 140)}`);
  }
  state.diagnostics.proxyNote = resp.headers.get('x-proxy-note') || '';
  const arrayBuf = await resp.arrayBuffer();
  const audioBuf = await state.audioCtx.decodeAudioData(arrayBuf);
  state.buffers.set(url, audioBuf);
  return audioBuf;
}

async function playOneSnippet() {
  if (!state.isPlaying || !state.episodes.length) return false;
  const episode = weightedRandomEpisode();
  if (!episode) return false;
  state.diagnostics.snippetAttempts += 1;
  try {
    const buffer = await loadAudioBuffer(episode.audioUrl);
    const { minLength, maxLength } = getSnippetConfig();
    const snippetLength = randomBetween(minLength, maxLength);
    const ctx = state.audioCtx;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(state.snippetGain);
    const maxStart = Math.max(buffer.duration - snippetLength, 0);
    const offset = maxStart > 0 ? Math.random() * maxStart : 0;
    source.start(ctx.currentTime, offset, snippetLength);
    state.diagnostics.snippetSuccesses += 1;
    state.diagnostics.lastSnippetMessage = `Playing "${episode.title}"`;
    state.failureCounts.delete(episode.audioUrl);
    displayGhost(episode.title);
    updateSnippetStatus();
    return true;
  } catch (err) {
    console.warn('Snippet failed', err);
    const currentFails = (state.failureCounts.get(episode.audioUrl) || 0) + 1;
    state.failureCounts.set(episode.audioUrl, currentFails);
    if (currentFails >= 3) {
      state.episodes = state.episodes.filter((ep) => ep.audioUrl !== episode.audioUrl);
      state.failureCounts.delete(episode.audioUrl);
      updateEpisodeSummary();
      state.diagnostics.lastSnippetMessage = `Removed failing episode: ${episode.title}`;
    } else {
      state.diagnostics.lastSnippetMessage = `Snippet failed (${currentFails}x): ${err?.message || err}`;
    }
    updateSnippetStatus();
    return false;
  }
}

function scheduleNextSnippet(forcedGapSeconds = null) {
  if (!state.isPlaying) return;
  const { minGap, maxGap } = getSnippetConfig();
  const gapSeconds = forcedGapSeconds ?? randomBetween(minGap, maxGap);
  state.diagnostics.nextSnippetAt = Date.now() + gapSeconds * 1000;
  updateSnippetStatus();
  state.snippetTimeoutId = setTimeout(async () => {
    const success = await playOneSnippet();
    scheduleNextSnippet(success ? null : 1);
  }, gapSeconds * 1000);
}

function stopSnippets() {
  if (state.snippetTimeoutId) {
    clearTimeout(state.snippetTimeoutId);
    state.snippetTimeoutId = null;
  }
}

function stopTimer() {
  if (state.timerIntervalId) {
    clearInterval(state.timerIntervalId);
    state.timerIntervalId = null;
  }
  state.endTime = null;
  elements.timerDisplay.textContent = '';
  setHeroTimer('');
}

async function handleCustomNoiseUrl() {
  const url = elements.noiseUrl.value.trim();
  if (!url) return;
  elements.noiseStatus.textContent = 'Loading custom noise...';
  try {
    await loadCustomNoiseFromUrl(url);
    elements.noiseStatus.textContent = 'Custom noise loaded';
    state.selectedNoise = null;
    setNoiseLabel('Custom');
    renderSoundscapes();
    if (state.isPlaying) await startNoise();
  } catch (err) {
    console.error(err);
    elements.noiseStatus.textContent = 'Failed to load noise URL';
  }
}

async function handleCustomNoiseFile() {
  const file = elements.noiseFile.files[0];
  if (!file) return;
  elements.noiseStatus.textContent = 'Loading file...';
  try {
    await loadCustomNoiseFromFile(file);
    elements.noiseStatus.textContent = 'Custom noise loaded';
    state.selectedNoise = null;
    setNoiseLabel(file.name || 'Custom');
    renderSoundscapes();
    if (state.isPlaying) await startNoise();
  } catch (err) {
    console.error(err);
    elements.noiseStatus.textContent = 'Failed to load noise file';
  }
}

async function resetNoise() {
  state.customNoiseBuffer = null;
  state.selectedNoise = NOISE_PROFILES[0].id;
  setNoiseLabel(getNoiseProfile(state.selectedNoise).label);
  elements.noiseStatus.textContent = `Soundscape selected: ${getNoiseProfile(state.selectedNoise).label}`;
  renderSoundscapes();
  if (state.isPlaying) await startNoise();
}

function startTimer(minutes) {
  if (!minutes) return;
  const end = Date.now() + minutes * 60 * 1000;
  state.endTime = end;
  const initialRemaining = formatRemainingTime(minutes * 60 * 1000);
  const label = `Time remaining: ${initialRemaining}`;
  elements.timerDisplay.textContent = label;
  setHeroTimer(initialRemaining);
  state.timerIntervalId = setInterval(() => {
    const remaining = end - Date.now();
    if (remaining <= 0) {
      stopPlayback(true);
      return;
    }
    const tickRemaining = formatRemainingTime(remaining);
    const tickLabel = `Time remaining: ${tickRemaining}`;
    elements.timerDisplay.textContent = tickLabel;
    setHeroTimer(tickRemaining);
  }, 1000);
}

async function startPlayback() {
  if (state.isPlaying) return;
  if (!state.episodes.length) {
    updatePlayStatus('No episodes loaded');
    return;
  }
  state.diagnostics.snippetAttempts = 0;
  state.diagnostics.snippetSuccesses = 0;
  state.diagnostics.lastSnippetMessage = 'Starting playback...';
  state.diagnostics.nextSnippetAt = null;
  state.diagnostics.proxyNote = '';
  state.failureCounts.clear();
  updateSnippetStatus();
  if (!state.audioCtx) buildAudioGraph();
  const ctx = state.audioCtx;
  applyToneAndReverb();
  await ctx.resume();

  state.masterGain.gain.cancelScheduledValues(ctx.currentTime);
  state.masterGain.gain.setValueAtTime(0, ctx.currentTime);
  state.masterGain.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 1.5);

  state.noiseGain.gain.value = parseFloat(elements.noiseLevel.value);
  state.snippetGain.gain.value = parseFloat(elements.snippetLevel.value);
  await startNoise();
  state.isPlaying = true;
  updatePlayStatus('Playing');
  syncPlayButtons(true);
  const firstSuccess = await playOneSnippet();
  scheduleNextSnippet(firstSuccess ? null : 1);

  const minutes = parseFloat(elements.sleepMinutes.value);
  if (Number.isFinite(minutes) && minutes > 0) {
    startTimer(minutes);
  } else {
    stopTimer();
  }
}

function stopPlayback(fromTimer = false) {
  if (!state.isPlaying && !fromTimer) return;
  const ctx = state.audioCtx;
  const now = ctx ? ctx.currentTime : 0;
  if (ctx && state.masterGain) {
    state.masterGain.gain.cancelScheduledValues(now);
    state.masterGain.gain.setValueAtTime(state.masterGain.gain.value, now);
    state.masterGain.gain.linearRampToValueAtTime(0, now + 2);
  }
  if (state.noiseSource) {
    try { state.noiseSource.stop(now + 2); } catch (e) { /* ignore */ }
  }
  stopSnippets();
  stopTimer();
  state.isPlaying = false;
  state.diagnostics.nextSnippetAt = null;
  updateSnippetStatus();
  document.body.classList.remove('is-playing');
  setTimeout(() => {
    syncPlayButtons(false);
    updatePlayStatus(fromTimer ? 'Timer ended' : 'Stopped');
  }, 2000);
}

function updateEpisodes(feed, parsed) {
  parsed.episodes.forEach((ep) => {
    if (!state.episodes.some((existing) => existing.audioUrl === ep.audioUrl)) {
      const cleanedTitle = pruneTitle(ep.title);
      state.episodes.push({
        ...ep,
        title: cleanedTitle || ep.title,
        feedUrl: feed.feedUrl,
        userAdded: feed.userAdded,
      });
    }
  });
  updateEpisodeSummary();
}

function makeRoomForUserFeed() {
  const removedFeeds = [];
  if (state.feeds.length < FEED_LIMIT) return removedFeeds;

  const nonUserFeeds = state.feeds.filter((f) => !f.userAdded);
  while (state.feeds.length >= FEED_LIMIT && nonUserFeeds.length) {
    const toRemove = nonUserFeeds.pop();
    const idx = state.feeds.indexOf(toRemove);
    if (idx >= 0) {
      state.feeds.splice(idx, 1);
      removedFeeds.push(toRemove);
    }
  }

  if (removedFeeds.length) {
    const allowedFeedUrls = new Set(state.feeds.map((f) => f.feedUrl));
    state.episodes = state.episodes.filter((ep) => allowedFeedUrls.has(ep.feedUrl));
    renderFeeds();
  }

  return removedFeeds;
}

async function addTopFeeds(feeds) {
  const userFeeds = state.feeds.filter((f) => f.userAdded);
  const userFeedUrls = new Set(userFeeds.map((f) => f.feedUrl));
  const availableSlots = Math.max(0, FEED_LIMIT - userFeeds.length);
  const limitedIncoming = feeds.slice(0, availableSlots);

  const newFeeds = limitedIncoming
    .filter((feed) => !userFeedUrls.has(feed.feedUrl))
    .map((feed) => ({
      ...feed,
      title: pruneTitle(feed.title) || feed.feedUrl,
      userAdded: false,
    }));

  state.feeds.splice(0, state.feeds.length, ...userFeeds);
  const allowedFeedUrls = new Set(userFeedUrls);

  newFeeds.forEach((feed) => {
    state.feeds.push(feed);
    allowedFeedUrls.add(feed.feedUrl);
  });

  state.episodes = state.episodes.filter((ep) => allowedFeedUrls.has(ep.feedUrl));
  renderFeeds();
  for (const feed of newFeeds) {
    await fetchFeed(feed);
  }
  return newFeeds.length;
}

async function fetchFeed(feed) {
  try {
    const resp = await fetch(`/api/fetchFeed?url=${encodeURIComponent(feed.feedUrl)}`);
    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      throw new Error(errBody.message || `Feed request failed (${resp.status})`);
    }
    const parsed = await resp.json();
    const parsedTitle = pruneTitle(parsed.title);
    const withTitle = {
      ...feed,
      title: pruneTitle(feed.title) || parsedTitle || feed.feedUrl,
    };
    const existing = state.feeds.find((f) => f.feedUrl === feed.feedUrl);
    if (!existing) state.feeds.push(withTitle);
    updateEpisodes(withTitle, parsed);
    renderFeeds();
  } catch (err) {
    console.error('Feed load error', err);
    elements.addStatus.textContent = `Unable to load feed: ${err.message}`;
    updateSnippetStatus('No episodes yet – add a working feed.');
  }
}

async function handleAddFeed() {
  const url = elements.feedUrlInput.value.trim();
  if (!url) return;
  const duplicate = state.feeds.find((f) => f.feedUrl === url);
  if (duplicate) {
    elements.addStatus.textContent = 'Feed already added.';
    return;
  }

  const removedFeeds = makeRoomForUserFeed();
  elements.addStatus.textContent = 'Loading feed...';
  const feed = { feedUrl: url, title: url, userAdded: true };
  await fetchFeed(feed);
  saveUserFeeds();
  const removedCount = removedFeeds.length;
  const removalNote = removedCount ? ` (removed ${removedCount} auto feed${removedCount === 1 ? '' : 's'} to make room)` : '';
  elements.addStatus.textContent = `Added${removalNote}`;
  setTimeout(() => { elements.addStatus.textContent = ''; }, 2000);
  elements.feedUrlInput.value = '';
}

async function handleLoadTop(options = {}) {
  const {
    country = 'us',
    genreId = '',
    label = 'Top podcasts',
  } = options;

  const params = new URLSearchParams();
  if (country) params.set('country', country);
  if (genreId) params.set('genre', genreId);
  const query = params.toString();

  elements.feedStatus.textContent = `Fetching ${label}...`;
  try {
    const resp = await fetch(`/api/top50${query ? `?${query}` : ''}`);
    if (!resp.ok) throw new Error('Top list failed');
    const payload = await resp.json();
    const feeds = Array.isArray(payload) ? payload : payload.feeds || [];
    const normalizedFeeds = feeds.map((feed) => ({
      ...feed,
      title: pruneTitle(feed.title) || feed.feedUrl,
    }));
    const warning = Array.isArray(payload) ? null : payload.warning;
    const addedCount = await addTopFeeds(normalizedFeeds);
    saveTopFeedCache(normalizedFeeds);
    updateTopUpdatedAt(new Date().toISOString());
    const warningSuffix = warning ? ` (${warning})` : '';
    const loadedMessage = addedCount
      ? `Loaded ${addedCount} feeds${warningSuffix} (${label}).`
      : `No new feeds found${warningSuffix} (${label}).`;
    elements.feedStatus.textContent = loadedMessage;
  } catch (err) {
    console.error(err);
    elements.feedStatus.textContent = `Failed to load ${label}`;
  }
}

async function requestStartPlayback() {
  if (uiState.isStartingPlayback) return;
  uiState.isStartingPlayback = true;
  setPlaybackLoading(true);
  try {
    await startPlayback();
  } catch (err) {
    console.error(err);
    updatePlayStatus('Unable to start playback');
  } finally {
    uiState.isStartingPlayback = false;
    setPlaybackLoading(false);
  }
}

function attachEvents() {
  const topLoaders = [
    { el: elements.loadTop, opts: { label: 'US Top 50' } },
    { el: elements.loadTopUk, opts: { country: 'gb', label: 'UK Top 50' } },
    { el: elements.loadTopArts, opts: { genreId: TOP_GENRES.arts, label: 'Arts Top 50' } },
    { el: elements.loadTopBusiness, opts: { genreId: TOP_GENRES.business, label: 'Business Top 50' } },
    { el: elements.loadTopMusic, opts: { genreId: TOP_GENRES.music, label: 'Music Top 50' } },
  ];

  elements.addFeedBtn.addEventListener('click', handleAddFeed);
  topLoaders.forEach(({ el, opts }) => {
    el?.addEventListener('click', () => handleLoadTop(opts));
  });
  elements.togglePlay.addEventListener('click', () => {
    if (state.isPlaying) {
      stopPlayback();
    } else {
      requestStartPlayback();
    }
  });

  if (elements.heroPlayToggle) {
    elements.heroPlayToggle.addEventListener('click', () => {
      if (state.isPlaying) {
        stopPlayback();
      } else {
        requestStartPlayback();
      }
    });
  }

  if (elements.scrollControls && elements.controlsAnchor) {
    elements.scrollControls.addEventListener('click', () => {
      elements.controlsAnchor.scrollIntoView({ behavior: 'smooth' });
    });
  }

  if (elements.cycleBackground) {
    elements.cycleBackground.addEventListener('click', () => cycleHeroBackground(true));
  }

  if (elements.toggleFeedList) {
    elements.toggleFeedList.addEventListener('click', () => {
      setFeedListVisibility(!uiState.feedListCollapsed);
    });
  }

  elements.noiseLevel.addEventListener('input', () => {
    if (state.noiseGain) {
      state.noiseGain.gain.value = parseFloat(elements.noiseLevel.value);
    }
  });

  elements.snippetLevel.addEventListener('input', () => {
    if (state.snippetGain) {
      state.snippetGain.gain.value = parseFloat(elements.snippetLevel.value);
    }
  });

  const toneControls = [elements.tone, elements.reverbMix];
  toneControls.forEach((el) => {
    el?.addEventListener('input', () => {
      applyToneAndReverb();
    });
  });

  [elements.minGap, elements.maxGap, elements.minLength, elements.maxLength].forEach((el) => {
    el?.addEventListener('input', () => updateSnippetStatus());
  });

  elements.setNoiseUrl.addEventListener('click', handleCustomNoiseUrl);
  elements.setNoiseFile.addEventListener('click', handleCustomNoiseFile);
  elements.resetNoise.addEventListener('click', resetNoise);
}

async function init() {
  renderSoundscapes();
  await initHeroBackgrounds();
  setNoiseLabel(getNoiseProfile(state.selectedNoise).label);
  loadUserFeeds();
  const cachedTop = loadTopFeedCache();
  if (cachedTop?.feeds?.length) {
    const availableSlots = Math.max(0, FEED_LIMIT - state.feeds.length);
    cachedTop.feeds.slice(0, availableSlots).forEach((feed) => {
      if (!state.feeds.some((f) => f.feedUrl === feed.feedUrl)) {
        state.feeds.push({
          ...feed,
          title: pruneTitle(feed.title) || feed.feedUrl,
          userAdded: false,
        });
      }
    });
    updateTopUpdatedAt(cachedTop.updatedAt);
  } else {
    updateTopUpdatedAt(null);
  }
  renderFeeds();
  attachEvents();
  syncPlayButtons(false);
  setFeedListVisibility(true);
  if (elements.sleepMinutes && !elements.sleepMinutes.value) {
    elements.sleepMinutes.value = 30;
  }
  if (elements.noiseStatus) {
    elements.noiseStatus.textContent = `Soundscape selected: ${getNoiseProfile(state.selectedNoise).label}`;
  }
  updateEpisodeSummary();
  updateSnippetStatus();
  if (state.feeds.length) {
    for (const feed of state.feeds) {
      await fetchFeed(feed);
    }
  }
  if (cachedTop?.feeds?.length && elements.feedStatus) {
    elements.feedStatus.textContent = 'Loaded cached top podcasts';
  }
  const shouldAutoLoadTop = !cachedTop?.feeds?.length && state.feeds.length === 0;
  if (shouldAutoLoadTop) {
    await handleLoadTop({ label: 'US Top 50' });
  }
  await ensureNoiseBuffer(state.selectedNoise);
}

init();
