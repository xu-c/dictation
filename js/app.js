// ========== State ==========
const state = {
  words: [],
  currentIndex: -1,
  isPlaying: false,
  isPaused: false,
  repeatCount: 2,
  rate: 0.5, // slider multiplier, actual TTS rate = rate * 0.6
  volume: 1.0,
  interval: 16,
  wordVisible: false,
  startPrompt: false,
  manualMode: false,
  customDelimiters: [], // user-added custom delimiters
  preferBrowserTTS: false, // user preference, default server-first
  currentEngine: null, // 'server'|'browser' — set on first speak, updated on fallback
  wakeLock: null,
  utterance: null,
  currentAudio: null, // Active Audio element for server TTS (used to abort)
  playTimeout: null,
  playTimeoutId: null, // Additional timeout id for keepAliveSleep interval
  manualResolve: null, // resolve function for manual confirm
};

// ========== DOM Elements ==========
const $ = (id) => document.getElementById(id);

const dom = {
  wordInput: $('wordInput'),
  delimiterChips: $('delimiterChips'),
  customDelimiterInput: $('customDelimiterInput'),
  addCustomDelimiter: $('addCustomDelimiter'),
  parseBtn: $('parseBtn'),
  wordPreview: $('wordPreview'),
  wordCount: $('wordCount'),
  wordList: $('wordList'),
  rateSlider: $('rateSlider'),
  rateValue: $('rateValue'),
  volumeSlider: $('volumeSlider'),
  volumeValue: $('volumeValue'),
  intervalSlider: $('intervalSlider'),
  intervalValue: $('intervalValue'),
  currentWord: $('currentWord'),
  toggleWordBtn: $('toggleWordBtn'),
  progressFill: $('progressFill'),
  progressText: $('progressText'),
  prevBtn: $('prevBtn'),
  playBtn: $('playBtn'),
  stopBtn: $('stopBtn'),
  nextBtn: $('nextBtn'),
  statusText: $('statusText'),
  wakeLockStatus: $('wakeLockStatus'),
  wordlistName: $('wordlistName'),
  saveWordlist: $('saveWordlist'),
  loadWordlist: $('loadWordlist'),
  deleteWordlist: $('deleteWordlist'),
  shuffleBtn: $('shuffleBtn'),
  listToggle: $('listToggle'),
  wordListPreview: $('wordListPreview'),
  fullWordList: $('fullWordList'),
  themeToggle: $('themeToggle'),
  startPromptToggle: $('startPromptToggle'),
  manualModeToggle: $('manualModeToggle'),
  preferBrowserToggle: $('preferBrowserToggle'),
};

// ========== Theme ==========
function initTheme() {
  const saved = localStorage.getItem('dictation-theme');
  if (saved) {
    document.documentElement.setAttribute('data-theme', saved);
  } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
  updateThemeIcon();
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('dictation-theme', next);
  updateThemeIcon();
}

function updateThemeIcon() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  dom.themeToggle.textContent = isDark ? '☀️' : '🌙';
}

// ========== Word Parsing ==========
function getSelectedDelimiters() {
  const checked = dom.delimiterChips.querySelectorAll('input:checked');
  return Array.from(checked).map(cb => cb.value);
}

function buildDelimiterRegex() {
  const selected = getSelectedDelimiters();
  const all = [...selected, ...state.customDelimiters];
  if (all.length === 0) return /\s+/; // fallback

  const chars = all.map(d => {
    if (d === '\\n' || d === '\n') return '\\n';
    return d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  return new RegExp('[' + chars.join('') + ']+');
}

function parseWords() {
  const text = dom.wordInput.value.trim();
  if (!text) {
    state.words = [];
    updateWordPreview();
    return;
  }

  const delimiter = buildDelimiterRegex();
  const words = text.split(delimiter)
    .map(w => w.trim())
    .filter(w => w.length > 0);

  state.words = words;
  updateWordPreview();
  updateFullWordList();
  saveSettings();
}

function updateWordPreview() {
  if (state.words.length === 0) {
    dom.wordPreview.classList.add('hidden');
    return;
  }

  dom.wordPreview.classList.remove('hidden');
  dom.wordCount.textContent = state.words.length;
  dom.wordList.innerHTML = state.words
    .map(w => `<span class="word-tag">${w}</span>`)
    .join('');
}

function updateFullWordList() {
  dom.fullWordList.innerHTML = state.words
    .map((w, i) => {
      let cls = 'full-word-item';
      if (i === state.currentIndex) cls += ' active';
      if (i < state.currentIndex) cls += ' done';
      return `<span class="${cls}" data-index="${i}">${w}</span>`;
    })
    .join('');
}

// ========== TTS Engine ==========

// Speak via server TTS API
function speakViaServer(text) {
  return new Promise((resolve, reject) => {
    const actualRate = state.rate * 0.6;
    const url = `/api/tts?text=${encodeURIComponent(text)}&rate=${actualRate}`;

    const audio = new Audio();
    audio.volume = state.volume;
    state.currentAudio = audio;

    const abortCheck = setInterval(() => {
      if (!state.isPlaying) {
        audio.pause();
        audio.src = '';
        clearInterval(abortCheck);
        state.currentAudio = null;
        resolve();
      }
    }, 200);

    const cleanup = () => {
      clearInterval(abortCheck);
      state.currentAudio = null;
    };

    audio.onended = () => { cleanup(); resolve(); };
    audio.onerror = () => { cleanup(); reject(new Error('音频播放失败')); };

    audio.src = url;
    audio.play().catch(err => { cleanup(); reject(err); });
  });
}

// Speak via browser speechSynthesis
function speakViaBrowser(text) {
  return new Promise((resolve, reject) => {
    speechSynthesis.cancel();
    speechSynthesis.resume();

    setTimeout(() => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'zh-CN';
      utterance.rate = state.rate * 0.6;
      utterance.volume = state.volume;

      const voices = speechSynthesis.getVoices();
      const zhVoice = voices.find(v => v.lang.startsWith('zh'));
      if (zhVoice) utterance.voice = zhVoice;

      utterance.onend = () => resolve();
      utterance.onerror = (e) => {
        if (e.error === 'canceled') resolve();
        else reject(e);
      };

      state.utterance = utterance;
      speechSynthesis.speak(utterance);
    }, 200);
  });
}

// Main speak: server-first by default, with bidirectional fallback
async function speak(text) {
  // First call: try preferred engine
  if (state.currentEngine === null) {
    const primary = state.preferBrowserTTS ? 'browser' : 'server';
    const secondary = state.preferBrowserTTS ? 'server' : 'browser';
    try {
      await (primary === 'server' ? speakViaServer(text) : speakViaBrowser(text));
      state.currentEngine = primary;
      updateTTSMarker();
      return;
    } catch (e) {
      console.warn(`Primary TTS (${primary}) failed, falling back to ${secondary}:`, e);
      state.currentEngine = secondary;
      updateTTSMarker();
      // Fall through to secondary
    }
  }

  // Use known engine, downgrade on failure
  if (state.currentEngine === 'server') {
    try {
      return await speakViaServer(text);
    } catch (e) {
      console.warn('Server TTS failed, falling back to browser:', e);
      state.currentEngine = 'browser';
      updateTTSMarker();
      return speakViaBrowser(text);
    }
  } else {
    try {
      return await speakViaBrowser(text);
    } catch (e) {
      console.warn('Browser TTS failed, falling back to server:', e);
      state.currentEngine = 'server';
      updateTTSMarker();
      return speakViaServer(text);
    }
  }
}

function updateTTSMarker() {
  const badge = dom.wakeLockStatus;
  if (state.currentEngine === 'server') {
    badge.textContent = '🔊 Edge 语音';
  } else if (state.currentEngine === 'browser') {
    badge.textContent = '🔊 浏览器语音';
  } else {
    badge.textContent = state.preferBrowserTTS ? '🔊 浏览器语音' : '🔊 Edge 语音';
  }
}

function sleep(ms) {
  return new Promise(resolve => {
    state.playTimeout = setTimeout(resolve, ms);
  });
}

// Abort current speech: cancel browser TTS or stop server TTS audio
function abortSpeech() {
  if (state.currentAudio) {
    state.currentAudio.pause();
    state.currentAudio.src = '';
    state.currentAudio = null;
  }
  speechSynthesis.cancel();
}

// Clear any pending interval/manual-confirm timeout
function abortDelay() {
  clearTimeout(state.playTimeout);
  clearInterval(state.playTimeoutId);
  state.playTimeout = null;
  state.playTimeoutId = null;
}

// Keep speechSynthesis awake during long pauses to prevent first-syllable clipping
function keepAliveSleep(ms) {
  // Server TTS uses Audio API, no need to keep speechSynthesis alive
  if (state.currentEngine === 'server') {
    return sleep(ms);
  }

  return new Promise(resolve => {
    const interval = 2000; // poke every 2s
    let elapsed = 0;
    state.playTimeoutId = setInterval(() => {
      elapsed += interval;
      if (elapsed >= ms) {
        clearInterval(state.playTimeoutId);
        state.playTimeoutId = null;
        resolve();
      } else {
        try {
          const poke = new SpeechSynthesisUtterance('');
          poke.volume = 0;
          poke.lang = 'zh-CN';
          speechSynthesis.speak(poke);
        } catch (e) { /* ignore */ }
      }
    }, interval);
    state.playTimeout = setTimeout(() => {
      clearInterval(state.playTimeoutId);
      state.playTimeoutId = null;
      resolve();
    }, ms + 100);
  });
}

// ========== Playback Control ==========

// Wait for user to manually confirm (click or press Space/Enter)
function waitForManualConfirm() {
  return new Promise(resolve => {
    state.manualResolve = resolve;
    dom.statusText.textContent = '等待确认...点击按钮或按空格/→播报下一个';
    dom.nextBtn.classList.add('playing-pulse');
  });
}

function confirmNext() {
  if (state.manualResolve) {
    state.manualResolve();
    state.manualResolve = null;
    dom.nextBtn.classList.remove('playing-pulse');
  }
}

async function playWord(index) {
  if (index < 0 || index >= state.words.length) return;

  state.currentIndex = index;
  const word = state.words[index];

  // Update UI
  dom.currentWord.textContent = state.wordVisible ? word : '●●●';
  dom.statusText.textContent = `正在朗读：第 ${index + 1} 个`;
  updateProgress();
  updateFullWordList();

  // Speak multiple times
  for (let i = 0; i < state.repeatCount; i++) {
    if (!state.isPlaying) return;
    if (state.currentIndex !== index) return; // user skipped away
    while (state.isPaused) {
      await sleep(200);
      if (!state.isPlaying) return;
      if (state.currentIndex !== index) return;
    }
    await speak(word);
    if (state.currentIndex !== index) return; // user skipped mid-speak
    if (i < state.repeatCount - 1) {
      await sleep(2000);
    }
  }
}

async function startPlayback() {
  if (state.words.length === 0) {
    dom.statusText.textContent = '请先输入词汇';
    return;
  }

  if (state.isPaused) {
    resumePlayback();
    return;
  }

  state.isPlaying = true;
  state.isPaused = false;
  dom.playBtn.textContent = '⏸';
  dom.statusText.textContent = '播放中...';
  await requestWakeLock();

  // Warm up speechSynthesis engine to prevent first-word clipping (browser TTS only)
  // Determine which engine will be used first
  if (state.currentEngine === null) {
    state.currentEngine = state.preferBrowserTTS ? 'browser' : 'server';
    updateTTSMarker();
  }

  if (state.currentEngine === 'browser') {
    speechSynthesis.cancel();
    speechSynthesis.resume();
    await new Promise(resolve => {
      setTimeout(() => {
        const warmup = new SpeechSynthesisUtterance('好');
        warmup.volume = 0.01;
        warmup.rate = state.rate * 0.6;
        warmup.lang = 'zh-CN';
        const voices = speechSynthesis.getVoices();
        const zhVoice = voices.find(v => v.lang.startsWith('zh'));
        if (zhVoice) warmup.voice = zhVoice;
        warmup.onend = () => setTimeout(resolve, 500);
        warmup.onerror = () => resolve();
        speechSynthesis.speak(warmup);
      }, 200);
    });
  }

  // Optional start prompt
  if (state.startPrompt) {
    await speak('请开始听写');
    await sleep(500);
  }

  if (!state.isPlaying) return;

  if (state.currentIndex < 0) {
    state.currentIndex = 0;
  }

  while (state.isPlaying && state.currentIndex < state.words.length) {
    const idx = state.currentIndex;
    await playWord(idx);

    if (!state.isPlaying) break;
    if (state.currentIndex >= state.words.length) break;

    // If user skipped away during playWord, skip the interval wait
    if (state.currentIndex !== idx) continue;

    if (state.manualMode) {
      await waitForManualConfirm();
      if (!state.isPlaying) break;
    } else {
      dom.statusText.textContent = `间隔等待... (${idx + 1}/${state.words.length})`;
      await keepAliveSleep(state.interval * 1000);
      if (!state.isPlaying) break;
    }

    // Only auto-advance if user didn't manually change index during interval
    if (state.currentIndex === idx) {
      state.currentIndex++;
    }
  }

  if (state.isPlaying) {
    if (state.startPrompt) {
      dom.statusText.textContent = `间隔等待... (${state.words.length}/${state.words.length})`;
      await keepAliveSleep(state.interval * 1000);
      dom.statusText.textContent = '听写完毕';
      await speak('听写完毕');
    }
    dom.statusText.textContent = '听写完成！';
    stopPlayback();
  }
}

function pausePlayback() {
  state.isPaused = true;
  speechSynthesis.pause();
  dom.playBtn.textContent = '▶';
  dom.statusText.textContent = '已暂停';
}

function resumePlayback() {
  state.isPaused = false;
  speechSynthesis.resume();
  dom.playBtn.textContent = '⏸';
  dom.statusText.textContent = '播放中...';
}

function stopPlayback() {
  state.isPlaying = false;
  state.isPaused = false;
  state.currentIndex = -1;
  abortSpeech();
  abortDelay();
  if (state.manualResolve) {
    state.manualResolve();
    state.manualResolve = null;
  }
  dom.nextBtn.classList.remove('playing-pulse');
  dom.playBtn.textContent = '▶';
  dom.statusText.textContent = '已停止';
  updateProgress();
  updateFullWordList();
  releaseWakeLock();
}

function togglePlay() {
  if (state.isPlaying && !state.isPaused) {
    pausePlayback();
  } else {
    startPlayback();
  }
}

function prevWord() {
  if (state.words.length === 0) return;
  const newIdx = Math.max(0, (state.currentIndex >= 0 ? state.currentIndex : 1) - 1);
  state.currentIndex = newIdx;
  updateCurrentWordDisplay();
  updateProgress();
  updateFullWordList();
  if (state.isPlaying) {
    abortSpeech();
    abortDelay();
    // main while loop picks up the new state.currentIndex
  }
}

function nextWord() {
  if (state.manualMode && state.isPlaying && state.manualResolve) {
    confirmNext();
    return;
  }
  if (state.words.length === 0) return;
  const newIdx = Math.min(state.words.length - 1, state.currentIndex + 1);
  state.currentIndex = newIdx;
  updateCurrentWordDisplay();
  updateProgress();
  updateFullWordList();
  if (state.isPlaying) {
    abortSpeech();
    abortDelay();
    // main while loop picks up the new state.currentIndex
  }
}

function updateCurrentWordDisplay() {
  if (state.currentIndex >= 0 && state.currentIndex < state.words.length) {
    const word = state.words[state.currentIndex];
    dom.currentWord.textContent = state.wordVisible ? word : '●●●';
  } else {
    dom.currentWord.textContent = '●●●';
  }
}

function updateProgress() {
  const total = state.words.length;
  const current = state.currentIndex >= 0 ? state.currentIndex + 1 : 0;
  const pct = total > 0 ? (current / total) * 100 : 0;
  dom.progressFill.style.width = pct + '%';
  dom.progressText.textContent = `${current} / ${total}`;
}

// ========== Wake Lock ==========
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) {
    dom.wakeLockStatus.textContent = '🔓 不支持';
    startAudioFallback();
    return;
  }

  try {
    state.wakeLock = await navigator.wakeLock.request('screen');
    dom.wakeLockStatus.textContent = '🔒 已锁定';
    state.wakeLock.addEventListener('release', () => {
      dom.wakeLockStatus.textContent = '🔓 未锁定';
    });
  } catch (err) {
    dom.wakeLockStatus.textContent = '🔒 失败';
    startAudioFallback();
  }
}

function releaseWakeLock() {
  if (state.wakeLock) {
    state.wakeLock.release();
    state.wakeLock = null;
  }
  stopAudioFallback();
}

// Audio fallback: play silent audio to keep device awake
let fallbackAudio = null;
let fallbackAudioCtx = null;

function startAudioFallback() {
  try {
    fallbackAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = fallbackAudioCtx.createOscillator();
    const gain = fallbackAudioCtx.createGain();
    gain.gain.value = 0; // Silent
    oscillator.connect(gain);
    gain.connect(fallbackAudioCtx.destination);
    oscillator.start();
  } catch (e) {
    // Ignore
  }
}

function stopAudioFallback() {
  if (fallbackAudioCtx) {
    fallbackAudioCtx.close();
    fallbackAudioCtx = null;
  }
}

// Re-acquire wake lock when page becomes visible again
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.isPlaying) {
    requestWakeLock();
  }
});

// ========== Word Visibility ==========
function toggleWordVisibility() {
  state.wordVisible = !state.wordVisible;
  dom.toggleWordBtn.textContent = state.wordVisible ? '隐藏' : '显示';

  if (state.wordVisible) {
    dom.currentWord.classList.remove('word-hidden');
    if (state.currentIndex >= 0 && state.currentIndex < state.words.length) {
      dom.currentWord.textContent = state.words[state.currentIndex];
    }
  } else {
    dom.currentWord.classList.add('word-hidden');
    dom.currentWord.textContent = '●●●';
  }
}

// ========== Custom Delimiter Chips ==========
function addCustomDelimiterChip(value) {
  const label = document.createElement('label');
  label.className = 'delimiter-chip custom-chip';
  label.innerHTML = `<input type="checkbox" value="${value}" checked><span>${value} ✕</span>`;
  label.querySelector('input').addEventListener('change', saveSettings);
  label.querySelector('span').addEventListener('click', (e) => {
    // Click on the ✕ area removes the custom delimiter
    const rect = e.target.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    if (clickX > rect.width * 0.65) {
      state.customDelimiters = state.customDelimiters.filter(d => d !== value);
      label.remove();
      saveSettings();
    }
  });
  dom.delimiterChips.appendChild(label);
}

// ========== Shuffle ==========
function shuffleWords() {
  if (state.words.length === 0) return;

  // Fisher-Yates shuffle
  for (let i = state.words.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [state.words[i], state.words[j]] = [state.words[j], state.words[i]];
  }

  state.currentIndex = -1;
  dom.wordInput.value = state.words.join(' ');
  updateWordPreview();
  updateFullWordList();
  updateProgress();
  dom.statusText.textContent = '已随机排序';
}

// ========== Word List Management (localStorage) ==========
function getWordlists() {
  try {
    return JSON.parse(localStorage.getItem('dictation-wordlists') || '{}');
  } catch {
    return {};
  }
}

function saveWordlist() {
  const name = dom.wordlistName.value.trim();
  if (!name) {
    dom.statusText.textContent = '请输入词表名称';
    return;
  }
  if (state.words.length === 0) {
    dom.statusText.textContent = '没有可保存的词汇';
    return;
  }

  const lists = getWordlists();
  const keys = Object.keys(lists);
  if (!lists[name] && keys.length >= 20) {
    dom.statusText.textContent = '最多保存20个词表，请先删除不需要的';
    return;
  }

  lists[name] = {
    words: [...state.words],
    savedAt: new Date().toISOString(),
  };

  localStorage.setItem('dictation-wordlists', JSON.stringify(lists));
  refreshWordlistDropdown();
  dom.loadWordlist.value = name;
  dom.statusText.textContent = `词表「${name}」已保存`;
}

function loadWordlist(name) {
  if (!name) return;
  const lists = getWordlists();
  const list = lists[name];
  if (!list) return;

  state.words = [...list.words];
  state.currentIndex = -1;
  dom.wordInput.value = state.words.join(' ');
  updateWordPreview();
  updateFullWordList();
  updateProgress();
  dom.statusText.textContent = `已加载词表「${name}」`;
}

function deleteWordlist() {
  const name = dom.loadWordlist.value;
  if (!name) {
    dom.statusText.textContent = '请先选择要删除的词表';
    return;
  }

  const lists = getWordlists();
  delete lists[name];
  localStorage.setItem('dictation-wordlists', JSON.stringify(lists));
  refreshWordlistDropdown();
  dom.statusText.textContent = `词表「${name}」已删除`;
}

function refreshWordlistDropdown() {
  const lists = getWordlists();
  const current = dom.loadWordlist.value;
  dom.loadWordlist.innerHTML = '<option value="">-- 加载词表 --</option>';
  for (const name of Object.keys(lists)) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    dom.loadWordlist.appendChild(opt);
  }
  if (lists[current]) dom.loadWordlist.value = current;
}

// ========== Settings Persistence ==========
function saveSettings() {
  const settings = {
    rate: state.rate,
    volume: state.volume,
    interval: state.interval,
    repeatCount: state.repeatCount,
    startPrompt: state.startPrompt,
    manualMode: state.manualMode,
    preferBrowserTTS: state.preferBrowserTTS,
    delimiters: getSelectedDelimiters(),
    customDelimiters: state.customDelimiters,
  };
  localStorage.setItem('dictation-settings', JSON.stringify(settings));
}

function loadSettings() {
  try {
    const settings = JSON.parse(localStorage.getItem('dictation-settings'));
    if (!settings) return;

    state.rate = settings.rate ?? 0.5;
    state.volume = settings.volume ?? 1.0;
    state.interval = settings.interval ?? 16;
    state.repeatCount = settings.repeatCount ?? 2;
    state.startPrompt = settings.startPrompt ?? false;
    state.manualMode = settings.manualMode ?? false;
    state.preferBrowserTTS = settings.preferBrowserTTS ?? false;

    dom.rateSlider.value = state.rate;
    dom.rateValue.textContent = state.rate.toFixed(1);
    dom.volumeSlider.value = state.volume * 100;
    dom.volumeValue.textContent = Math.round(state.volume * 100);
    dom.intervalSlider.value = state.interval;
    dom.intervalValue.textContent = state.interval;
    dom.startPromptToggle.checked = state.startPrompt;
    dom.manualModeToggle.checked = state.manualMode;
    dom.preferBrowserToggle.checked = state.preferBrowserTTS;
    dom.intervalSlider.disabled = state.manualMode;

    // Restore delimiter chip states
    if (settings.delimiters) {
      dom.delimiterChips.querySelectorAll('input').forEach(cb => {
        cb.checked = settings.delimiters.includes(cb.value);
      });
    }

    // Restore custom delimiters
    if (settings.customDelimiters && settings.customDelimiters.length > 0) {
      state.customDelimiters = settings.customDelimiters;
      state.customDelimiters.forEach(d => addCustomDelimiterChip(d));
    }

    // Update repeat buttons
    document.querySelectorAll('.repeat-btns .btn-sm').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.repeat) === state.repeatCount);
    });

    // Update rate preset buttons
    document.querySelectorAll('.preset-btns .btn-sm').forEach(btn => {
      btn.classList.toggle('active', parseFloat(btn.dataset.rate) === state.rate);
    });
  } catch {
    // Ignore
  }
}

// ========== Collapsible ==========
function toggleListSection() {
  const content = dom.wordListPreview;
  const icon = dom.listToggle.querySelector('.toggle-icon');
  content.classList.toggle('hidden');
  icon.style.transform = content.classList.contains('hidden') ? '' : 'rotate(180deg)';
}

// ========== Keyboard Shortcuts ==========
function handleKeyboard(e) {
  // Don't capture when typing in inputs
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
    return;
  }

  switch (e.code) {
    case 'Space':
      e.preventDefault();
      if (state.manualMode && state.isPlaying && state.manualResolve) {
        confirmNext();
      } else {
        togglePlay();
      }
      break;
    case 'Enter':
      e.preventDefault();
      confirmNext();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      prevWord();
      break;
    case 'ArrowRight':
      e.preventDefault();
      nextWord();
      break;
    case 'KeyS':
      e.preventDefault();
      stopPlayback();
      break;
  }
}

// ========== Event Bindings ==========
function bindEvents() {
  // Theme
  dom.themeToggle.addEventListener('click', toggleTheme);

  // Parsing
  dom.parseBtn.addEventListener('click', parseWords);

  // Delimiter chips - save on change
  dom.delimiterChips.addEventListener('change', saveSettings);

  // Custom delimiter
  dom.addCustomDelimiter.addEventListener('click', () => {
    const val = dom.customDelimiterInput.value.trim();
    if (val && !state.customDelimiters.includes(val)) {
      state.customDelimiters.push(val);
      addCustomDelimiterChip(val);
      dom.customDelimiterInput.value = '';
      saveSettings();
    }
  });

  // Sliders
  dom.rateSlider.addEventListener('input', () => {
    state.rate = parseFloat(dom.rateSlider.value);
    dom.rateValue.textContent = state.rate.toFixed(1);
    document.querySelectorAll('.preset-btns .btn-sm').forEach(btn => {
      btn.classList.toggle('active', parseFloat(btn.dataset.rate) === state.rate);
    });
    saveSettings();
  });

  dom.volumeSlider.addEventListener('input', () => {
    state.volume = parseInt(dom.volumeSlider.value) / 100;
    dom.volumeValue.textContent = dom.volumeSlider.value;
    saveSettings();
  });

  dom.intervalSlider.addEventListener('input', () => {
    state.interval = parseFloat(dom.intervalSlider.value);
    dom.intervalValue.textContent = state.interval;
    saveSettings();
  });

  // Rate presets
  document.querySelectorAll('.preset-btns .btn-sm').forEach(btn => {
    btn.addEventListener('click', () => {
      const rate = parseFloat(btn.dataset.rate);
      state.rate = rate;
      dom.rateSlider.value = rate;
      dom.rateValue.textContent = rate.toFixed(1);
      document.querySelectorAll('.preset-btns .btn-sm').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      saveSettings();
    });
  });

  // Repeat buttons
  document.querySelectorAll('.repeat-btns .btn-sm').forEach(btn => {
    btn.addEventListener('click', () => {
      state.repeatCount = parseInt(btn.dataset.repeat);
      document.querySelectorAll('.repeat-btns .btn-sm').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      saveSettings();
    });
  });

  // Player controls
  dom.playBtn.addEventListener('click', togglePlay);

  // Toggles
  dom.startPromptToggle.addEventListener('change', () => {
    state.startPrompt = dom.startPromptToggle.checked;
    saveSettings();
  });

  dom.manualModeToggle.addEventListener('change', () => {
    state.manualMode = dom.manualModeToggle.checked;
    dom.intervalSlider.disabled = state.manualMode;
    saveSettings();
  });

  dom.preferBrowserToggle.addEventListener('change', () => {
    state.preferBrowserTTS = dom.preferBrowserToggle.checked;
    // Reset current engine so next speak re-selects
    state.currentEngine = null;
    updateTTSMarker();
    saveSettings();
  });
  dom.stopBtn.addEventListener('click', stopPlayback);
  dom.prevBtn.addEventListener('click', prevWord);
  dom.nextBtn.addEventListener('click', nextWord);
  dom.toggleWordBtn.addEventListener('click', toggleWordVisibility);

  // Word list management
  dom.saveWordlist.addEventListener('click', saveWordlist);
  dom.loadWordlist.addEventListener('change', () => loadWordlist(dom.loadWordlist.value));
  dom.deleteWordlist.addEventListener('click', deleteWordlist);
  dom.shuffleBtn.addEventListener('click', shuffleWords);

  // Collapsible list
  dom.listToggle.addEventListener('click', toggleListSection);

  // Keyboard
  document.addEventListener('keydown', handleKeyboard);

  // Load voices (some browsers load asynchronously)
  if ('speechSynthesis' in window) {
    speechSynthesis.getVoices();
    speechSynthesis.addEventListener('voiceschanged', () => {
      speechSynthesis.getVoices();
    });
  }
}

// ========== Init ==========
function init() {
  initTheme();
  loadSettings();
  refreshWordlistDropdown();
  bindEvents();
  dom.currentWord.classList.add('word-hidden');
}

document.addEventListener('DOMContentLoaded', init);
