const state = {
  feeds: [],
  episodes: [],
  audioCtx: null,
  masterGain: null,
  noiseGain: null,
  snippetGain: null,
  lowpass: null,
  convolver: null,
  noiseSource: null,
  buffers: new Map(),
  isPlaying: false,
  snippetTimeoutId: null,
  timerIntervalId: null,
  endTime: null,
};

const STORAGE_KEY = 'podcastNoiseUserFeeds';

const elements = {
  loadTop: document.getElementById('loadTop'),
  feedStatus: document.getElementById('feedStatus'),
  addFeedBtn: document.getElementById('addFeed'),
  feedUrlInput: document.getElementById('feedUrl'),
  addStatus: document.getElementById('addStatus'),
  feedList: document.getElementById('feedList'),
  togglePlay: document.getElementById('togglePlay'),
  playStatus: document.getElementById('playStatus'),
  noiseLevel: document.getElementById('noiseLevel'),
  snippetLevel: document.getElementById('snippetLevel'),
  sleepMinutes: document.getElementById('sleepMinutes'),
  timerDisplay: document.getElementById('timerDisplay'),
};

function loadUserFeeds() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        parsed.forEach((feed) => state.feeds.push({ ...feed, userAdded: true }));
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

function renderFeeds() {
  elements.feedList.innerHTML = '';
  state.feeds.forEach((feed, index) => {
    const li = document.createElement('li');
    const info = document.createElement('div');
    info.textContent = feed.title || feed.feedUrl;
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
}

function updatePlayStatus(message) {
  elements.playStatus.textContent = message;
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
  state.lowpass.frequency.value = 1500;

  state.convolver = ctx.createConvolver();
  state.convolver.buffer = createImpulseResponse(ctx);

  state.snippetGain.connect(state.lowpass);
  state.lowpass.connect(state.convolver);
  state.convolver.connect(state.masterGain);
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

function createImpulseResponse(ctx) {
  const duration = 1.5;
  const decay = 2.5;
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

function startNoise() {
  const ctx = state.audioCtx;
  if (state.noiseSource) {
    try { state.noiseSource.stop(); } catch (e) { /* ignore */ }
  }
  const source = ctx.createBufferSource();
  source.buffer = createNoiseBuffer(ctx);
  source.loop = true;
  source.connect(state.noiseGain);
  source.start();
  state.noiseSource = source;
}

async function loadAudioBuffer(url) {
  if (state.buffers.has(url)) return state.buffers.get(url);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('audio fetch failed');
  const arrayBuf = await resp.arrayBuffer();
  const audioBuf = await state.audioCtx.decodeAudioData(arrayBuf);
  state.buffers.set(url, audioBuf);
  return audioBuf;
}

async function playOneSnippet() {
  if (!state.isPlaying || !state.episodes.length) return;
  const episode = weightedRandomEpisode();
  if (!episode) return;
  try {
    const buffer = await loadAudioBuffer(episode.audioUrl);
    const snippetLength = randomBetween(8, 15);
    const ctx = state.audioCtx;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(state.snippetGain);
    const maxStart = Math.max(buffer.duration - snippetLength, 0);
    const offset = maxStart > 0 ? Math.random() * maxStart : 0;
    source.start(ctx.currentTime, offset, snippetLength);
  } catch (err) {
    console.warn('Snippet failed', err);
  }
}

function scheduleNextSnippet() {
  if (!state.isPlaying) return;
  const gapSeconds = randomBetween(10, 60);
  state.snippetTimeoutId = setTimeout(async () => {
    await playOneSnippet();
    scheduleNextSnippet();
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
}

function startTimer(minutes) {
  if (!minutes) return;
  const end = Date.now() + minutes * 60 * 1000;
  state.endTime = end;
  elements.timerDisplay.textContent = `Time remaining: ${minutes.toFixed(1)} min`;
  state.timerIntervalId = setInterval(() => {
    const remaining = end - Date.now();
    if (remaining <= 0) {
      stopPlayback(true);
      return;
    }
    const mins = remaining / 60000;
    elements.timerDisplay.textContent = `Time remaining: ${mins.toFixed(1)} min`;
  }, 1000);
}

async function startPlayback() {
  if (state.isPlaying) return;
  if (!state.episodes.length) {
    updatePlayStatus('No episodes loaded');
    return;
  }
  if (!state.audioCtx) buildAudioGraph();
  const ctx = state.audioCtx;
  await ctx.resume();

  state.masterGain.gain.cancelScheduledValues(ctx.currentTime);
  state.masterGain.gain.setValueAtTime(0, ctx.currentTime);
  state.masterGain.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 1.5);

  state.noiseGain.gain.value = parseFloat(elements.noiseLevel.value);
  state.snippetGain.gain.value = parseFloat(elements.snippetLevel.value);
  startNoise();
  state.isPlaying = true;
  updatePlayStatus('Playing');
  elements.togglePlay.textContent = 'Stop';
  await playOneSnippet();
  scheduleNextSnippet();

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
  setTimeout(() => {
    elements.togglePlay.textContent = 'Start';
    updatePlayStatus(fromTimer ? 'Timer ended' : 'Stopped');
  }, 2000);
}

function updateEpisodes(feed, parsed) {
  parsed.episodes.forEach((ep) => {
    if (!state.episodes.some((existing) => existing.audioUrl === ep.audioUrl)) {
      state.episodes.push({ ...ep, feedUrl: feed.feedUrl, userAdded: feed.userAdded });
    }
  });
}

async function fetchFeed(feed) {
  try {
    const resp = await fetch(`/api/fetchFeed?url=${encodeURIComponent(feed.feedUrl)}`);
    if (!resp.ok) throw new Error('Feed request failed');
    const parsed = await resp.json();
    const withTitle = { ...feed, title: feed.title || parsed.title };
    const existing = state.feeds.find((f) => f.feedUrl === feed.feedUrl);
    if (!existing) state.feeds.push(withTitle);
    updateEpisodes(withTitle, parsed);
    renderFeeds();
  } catch (err) {
    console.error('Feed load error', err);
    elements.addStatus.textContent = 'Unable to load feed';
  }
}

async function handleAddFeed() {
  const url = elements.feedUrlInput.value.trim();
  if (!url) return;
  elements.addStatus.textContent = 'Loading feed...';
  const feed = { feedUrl: url, title: url, userAdded: true };
  await fetchFeed(feed);
  saveUserFeeds();
  elements.addStatus.textContent = 'Added';
  setTimeout(() => { elements.addStatus.textContent = ''; }, 2000);
  elements.feedUrlInput.value = '';
}

async function handleLoadTop() {
  elements.feedStatus.textContent = 'Fetching top podcasts...';
  try {
    const resp = await fetch('/api/top50');
    if (!resp.ok) throw new Error('Top list failed');
    const feeds = await resp.json();
    const newFeeds = feeds.filter((feed) => !state.feeds.some((f) => f.feedUrl === feed.feedUrl));
    newFeeds.forEach((feed) => state.feeds.push({ ...feed, userAdded: false }));
    renderFeeds();
    for (const feed of newFeeds) {
      await fetchFeed(feed);
    }
    elements.feedStatus.textContent = `Loaded ${newFeeds.length} feeds.`;
  } catch (err) {
    console.error(err);
    elements.feedStatus.textContent = 'Failed to load top podcasts';
  }
}

function attachEvents() {
  elements.addFeedBtn.addEventListener('click', handleAddFeed);
  elements.loadTop.addEventListener('click', handleLoadTop);
  elements.togglePlay.addEventListener('click', () => {
    if (state.isPlaying) {
      stopPlayback();
    } else {
      startPlayback();
    }
  });

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
}

async function init() {
  loadUserFeeds();
  renderFeeds();
  attachEvents();
  if (state.feeds.length) {
    for (const feed of state.feeds) {
      await fetchFeed(feed);
    }
  }
}

init();
