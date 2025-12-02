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
  customNoiseBuffer: null,
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
  },
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
  minGap: document.getElementById('minGap'),
  maxGap: document.getElementById('maxGap'),
  minLength: document.getElementById('minLength'),
  maxLength: document.getElementById('maxLength'),
  tone: document.getElementById('tone'),
  reverbMix: document.getElementById('reverbMix'),
  sleepMinutes: document.getElementById('sleepMinutes'),
  timerDisplay: document.getElementById('timerDisplay'),
  episodeSummary: document.getElementById('episodeSummary'),
  snippetStatus: document.getElementById('snippetStatus'),
  nextSnippet: document.getElementById('nextSnippet'),
  noiseStatus: document.getElementById('noiseStatus'),
  noiseUrl: document.getElementById('noiseUrl'),
  setNoiseUrl: document.getElementById('setNoiseUrl'),
  noiseFile: document.getElementById('noiseFile'),
  setNoiseFile: document.getElementById('setNoiseFile'),
  resetNoise: document.getElementById('resetNoise'),
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

  updateEpisodeSummary();
}

function updatePlayStatus(message) {
  elements.playStatus.textContent = message;
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
  const { snippetAttempts, snippetSuccesses, lastSnippetMessage, nextSnippetAt } = state.diagnostics;
  if (elements.snippetStatus) {
    const status = `Snippets tried: ${snippetAttempts}, played: ${snippetSuccesses}. ${lastSnippetMessage}`;
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

function startNoise() {
  const ctx = state.audioCtx;
  if (state.noiseSource) {
    try { state.noiseSource.stop(); } catch (e) { /* ignore */ }
  }
  const source = ctx.createBufferSource();
  source.buffer = state.customNoiseBuffer || createNoiseBuffer(ctx);
  source.loop = true;
  source.connect(state.noiseGain);
  source.start();
  state.noiseSource = source;
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
    throw new Error(`audio fetch failed (${resp.status}): ${detail.slice(0, 140)}`);
  }
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
}

async function handleCustomNoiseUrl() {
  const url = elements.noiseUrl.value.trim();
  if (!url) return;
  elements.noiseStatus.textContent = 'Loading custom noise...';
  try {
    await loadCustomNoiseFromUrl(url);
    elements.noiseStatus.textContent = 'Custom noise loaded';
    if (state.isPlaying) startNoise();
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
    if (state.isPlaying) startNoise();
  } catch (err) {
    console.error(err);
    elements.noiseStatus.textContent = 'Failed to load noise file';
  }
}

function resetNoise() {
  state.customNoiseBuffer = null;
  elements.noiseStatus.textContent = 'Using generated noise';
  if (state.isPlaying) startNoise();
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
  state.diagnostics.snippetAttempts = 0;
  state.diagnostics.snippetSuccesses = 0;
  state.diagnostics.lastSnippetMessage = 'Starting playback...';
  state.diagnostics.nextSnippetAt = null;
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
  startNoise();
  state.isPlaying = true;
  updatePlayStatus('Playing');
  elements.togglePlay.textContent = 'Stop';
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
  updateEpisodeSummary();
}

async function fetchFeed(feed) {
  try {
    const resp = await fetch(`/api/fetchFeed?url=${encodeURIComponent(feed.feedUrl)}`);
    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      throw new Error(errBody.message || `Feed request failed (${resp.status})`);
    }
    const parsed = await resp.json();
    const withTitle = { ...feed, title: feed.title || parsed.title };
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
    const payload = await resp.json();
    const feeds = Array.isArray(payload) ? payload : payload.feeds || [];
    const warning = Array.isArray(payload) ? null : payload.warning;
    const newFeeds = feeds.filter((feed) => !state.feeds.some((f) => f.feedUrl === feed.feedUrl));
    newFeeds.forEach((feed) => state.feeds.push({ ...feed, userAdded: false }));
    renderFeeds();
    for (const feed of newFeeds) {
      await fetchFeed(feed);
    }
    const warningSuffix = warning ? ` (${warning})` : '';
    const loadedMessage = newFeeds.length
      ? `Loaded ${newFeeds.length} feeds${warningSuffix}.`
      : `No new feeds found${warningSuffix}.`;
    elements.feedStatus.textContent = loadedMessage;
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
  loadUserFeeds();
  renderFeeds();
  attachEvents();
  if (elements.noiseStatus) {
    elements.noiseStatus.textContent = 'Using generated noise';
  }
  updateEpisodeSummary();
  updateSnippetStatus();
  if (state.feeds.length) {
    for (const feed of state.feeds) {
      await fetchFeed(feed);
    }
  }
}

init();
