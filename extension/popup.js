'use strict';

/* Settings popup: ping the native companion, edit config when
   connected, and show one-line setup when disconnected. */

const HOST_ID = 'firefox_youtube_downloader';
const INSTALL_CMD = './install.sh --install';

const PRESETS = {
  keep: null,
  music: '~/Music/Youtube Downloads',
  downloads: '~/Downloads/Youtube',
};
const VIDEO_PRESETS = {
  keep: null,
  videos: '~/Videos/Youtube Downloads',
  downloads: '~/Downloads/Youtube',
};

let lastDeps = null;
let ytdlpNetworkCheckAttempted = false;

function getExtensionVersion(fallback) {
  const api = ext();
  try {
    if (api && api.runtime && typeof api.runtime.getManifest === 'function') {
      const manifest = api.runtime.getManifest();
      if (manifest && typeof manifest.version === 'string' && manifest.version) {
        return manifest.version;
      }
    }
  } catch (_error) {
    // Fall back when runtime.getManifest is unavailable in test mocks.
  }
  return fallback || null;
}

function ext() {
  if (typeof browser !== 'undefined' && browser) return browser;
  if (typeof chrome !== 'undefined' && chrome) return chrome;
  return null;
}

function $(id) {
  return document.getElementById(id);
}

function queryParam(name) {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch (_error) {
    return null;
  }
}

function setVisible(connected) {
  $('connectedView').hidden = !connected;
  $('setupView').hidden = connected;
  if ($('modeSwitch')) $('modeSwitch').hidden = !connected;
}

function setState(el, state) {
  if (el && typeof el.setAttribute === 'function') el.setAttribute('data-state', state);
}

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function setTitle(el, title) {
  if (!el || typeof el.setAttribute !== 'function') return;
  if (title) el.setAttribute('title', title);
  else if (typeof el.removeAttribute === 'function') el.removeAttribute('title');
}

// Numeric dotted-version compare: -1 when a < b, 0 when equal, 1 when a > b.
function compareVersions(a, b) {
  const pa = String(a).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const pb = String(b).split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

// Last known component state, so a late live yt-dlp check can re-derive
// the overall health pill without another ping.
const statusModel = {
  connected: null,
  companionVersion: null,
  deps: null,
  ytdlp: null,
};

function renderHealth() {
  const pill = $('healthPill');
  if (statusModel.connected === null) {
    setState(pill, 'pending');
    setText('statusText', 'Checking...');
    setTitle(pill, 'Contacting the local companion');
    return;
  }
  if (!statusModel.connected) {
    setState(pill, 'bad');
    setText('statusText', 'Not connected');
    setTitle(pill, 'The local companion did not answer');
    return;
  }
  const issues = [];
  const deps = statusModel.deps || {};
  const missing = [];
  if (deps.yt_dlp === false) missing.push('yt-dlp');
  if (deps.ffmpeg === false) missing.push('FFmpeg');
  if (missing.length) issues.push({ label: 'Missing tools', detail: `Not found: ${missing.join(', ')}` });
  const ytdlp = statusModel.ytdlp;
  if (ytdlp && ytdlp.outdated) issues.push({ label: 'Update yt-dlp', detail: 'A newer yt-dlp release is available' });
  const extensionVersion = getExtensionVersion(null);
  if (extensionVersion && statusModel.companionVersion &&
      compareVersions(extensionVersion, statusModel.companionVersion) !== 0) {
    issues.push({ label: 'Version mismatch', detail: 'Extension and companion versions differ' });
  }
  if (issues.length) {
    setState(pill, 'warn');
    setText('statusText', issues[0].label);
    setTitle(pill, issues.map((issue) => issue.detail).join('; '));
  } else {
    setState(pill, 'ok');
    setText('statusText', 'Ready');
    setTitle(pill, 'Companion connected, tools found, yt-dlp current');
  }
}

function renderComponents() {
  const extensionVersion = getExtensionVersion(null);
  setText('extensionVersionText', extensionVersion || 'unknown');
  const extensionCell = $('extensionCell');
  const companionCell = $('companionCell');

  if (statusModel.connected === null) {
    setState(companionCell, 'pending');
    setText('companionStateText', 'Checking');
    setState(extensionCell, 'neutral');
    setText('extensionStateText', 'Installed');
    setTitle(extensionCell, '');
    return;
  }
  if (!statusModel.connected) {
    setState(companionCell, 'bad');
    setText('companionVersionText', '\u2013');
    setText('companionStateText', 'Not found');
    setState(extensionCell, 'neutral');
    setText('extensionStateText', 'Installed');
    setTitle(extensionCell, '');
    return;
  }

  const companionVersion = statusModel.companionVersion;
  setState(companionCell, 'ok');
  setText('companionVersionText', companionVersion || 'unknown');
  setText('companionStateText', 'Connected');

  if (!extensionVersion || !companionVersion) {
    setState(extensionCell, 'neutral');
    setText('extensionStateText', 'Installed');
    setTitle(extensionCell, '');
    return;
  }
  const order = compareVersions(extensionVersion, companionVersion);
  if (order === 0) {
    setState(extensionCell, 'ok');
    setText('extensionStateText', 'In sync');
    setTitle(extensionCell, '');
  } else {
    setState(extensionCell, 'warn');
    setText('extensionStateText', order > 0 ? 'Companion older' : 'Extension older');
    setTitle(
      extensionCell,
      order > 0
        ? 'Update the companion (re-run the installer or upgrade the package).'
        : 'Update the browser extension to match the companion.',
    );
  }
}

function renderDeps(deps) {
  const row = $('depsLine');
  if (!row) return;
  if (!deps) {
    row.hidden = true;
    return;
  }
  row.hidden = false;
  const tools = [
    ['depFfmpeg', 'ffmpeg', 'FFmpeg', 'bad', 'FFmpeg missing', 'Required for merging, conversion and cover art'],
    ['depRsgain', 'rsgain', 'rsgain', 'off', 'rsgain not installed', 'Optional: only needed for ReplayGain'],
  ];
  for (const [id, key, label, missingState, missingLabel, missingTitle] of tools) {
    const el = $(id);
    if (!el) continue;
    if (deps[key] === true) {
      setState(el, 'ok');
      el.textContent = label;
      setTitle(el, `${label} found`);
    } else if (deps[key] === false) {
      setState(el, missingState);
      el.textContent = missingLabel;
      setTitle(el, missingTitle);
    } else {
      setState(el, 'pending');
      el.textContent = label;
      setTitle(el, '');
    }
  }
}

function expandHome(value) {
  if (value === null || value === undefined) return null;
  if (value.startsWith('~/')) return value;
  return value;
}

function presetKeyFor(downloadDir, presets = PRESETS) {
  if (downloadDir === null || downloadDir === undefined || downloadDir === '') return 'keep';
  for (const [key, preset] of Object.entries(presets)) {
    if (key !== 'keep' && preset === downloadDir) return key;
  }
  return 'custom';
}

function applyUiMode(mode) {
  const normalized = mode === 'advanced' ? 'advanced' : 'simple';
  const panel = document.querySelector('.panel');
  if (panel) panel.setAttribute('data-ui-mode', normalized);

  const simpleBtn = $('uiModeSimple');
  const advancedBtn = $('uiModeAdvanced');
  if (simpleBtn) {
    simpleBtn.classList.toggle('is-active', normalized === 'simple');
    simpleBtn.setAttribute('aria-pressed', normalized === 'simple' ? 'true' : 'false');
  }
  if (advancedBtn) {
    advancedBtn.classList.toggle('is-active', normalized === 'advanced');
    advancedBtn.setAttribute('aria-pressed', normalized === 'advanced' ? 'true' : 'false');
  }

  for (const el of document.querySelectorAll('[data-advanced-only="true"]')) {
    el.hidden = normalized !== 'advanced';
  }
}

function notifyExtensionConfig(config) {
  const api = ext();
  if (!api || !api.runtime || typeof api.runtime.sendMessage !== 'function') return;
  try {
    const res = api.runtime.sendMessage({
      type: 'ytdl-config-updated',
      config: {
        ui_mode: config && config.ui_mode === 'advanced' ? 'advanced' : 'simple',
        show_cut_button: Boolean(config && config.show_cut_button),
      },
    });
    if (res && typeof res.catch === 'function') res.catch(() => {});
  } catch (_error) {
    // Background may not be listening during isolated popup tests.
  }
}

function updateDownloadPresets(response) {
  const directories = response.user_download_directories || {};
  for (const [key, value] of Object.entries(directories)) {
    if (typeof value !== 'string' || !value) continue;
    if (key === 'music' || key === 'downloads') PRESETS[key] = value;
    if (key === 'videos' || key === 'downloads') VIDEO_PRESETS[key] = value;
  }
  const labels = [
    ['downloadFolder', 'music', PRESETS.music],
    ['downloadFolder', 'downloads', PRESETS.downloads],
    ['videoDownloadFolder', 'videos', VIDEO_PRESETS.videos],
    ['videoDownloadFolder', 'downloads', VIDEO_PRESETS.downloads],
  ];
  for (const [selectId, value, label] of labels) {
    const select = $(selectId);
    if (!select || !select.options) continue;
    const option = Array.from(select.options).find((item) => item.value === value);
    if (option) option.textContent = label;
  }
}

const VIDEO_CODEC_LABELS = {
  auto: 'best compression (AV1 > VP9 > H.265 > H.264)',
  av1: 'AV1',
  vp9: 'VP9',
  h265: 'H.265 / HEVC',
  h264: 'H.264 / AVC',
  vp8: 'VP8',
};

function updateVideoQualityNote() {
  const note = $('videoQualityNote');
  if (!note) return;
  const qEl = $('videoQuality');
  const cEl = $('videoCodec');
  const quality = qEl && qEl.value ? qEl.value : 'best';
  const codec = cEl && cEl.value ? cEl.value : 'auto';
  const codecLabel = VIDEO_CODEC_LABELS[codec] || VIDEO_CODEC_LABELS.auto;
  if (quality === 'best') {
    note.textContent = codec === 'auto'
      ? `Picks highest resolution available, preferring ${codecLabel}.`
      : `Picks highest resolution available, preferring ${codecLabel} within that resolution.`;
  } else {
    note.textContent = codec === 'auto'
      ? `Prefers ${codecLabel} up to ${quality}p; streams above ${quality}p are excluded.`
      : `Prefers ${codecLabel} up to ${quality}p; streams above ${quality}p override codec preference.`;
  }
}

function updateFormatNote() {
  const note = $('formatNote');
  if (!note) return;
  const select = $('audioFormat');
  const value = select && select.value ? select.value : 'best';
  if (value === 'mp3') {
    note.textContent = 'Converts YouTube\u0027s audio stream to MP3 via FFmpeg (V0 VBR recommended).';
  } else if (value === 'opus') {
    note.textContent = 'Forces the Opus container, keeping YouTube\u0027s native Opus stream without re-encoding when possible.';
  } else if (value === 'm4a') {
    note.textContent = 'Downloads the native M4A / AAC stream when available, otherwise converts via FFmpeg.';
  } else if (value === 'ogg') {
    note.textContent = 'Converts YouTube\u0027s audio stream to Ogg Vorbis via FFmpeg.';
  } else if (value === 'flac') {
    note.textContent = 'Converts YouTube\u0027s audio stream to FLAC via FFmpeg (lossless container, larger files).';
  } else {
    note.textContent = 'Downloads YouTube\u0027s native Opus or M4A stream directly without lossy re-encoding.';
  }
}

function updateMp3Row() {
  const row = $('mp3QualityRow');
  if (!row) return;
  const select = $('audioFormat');
  row.hidden = !select || select.value !== 'mp3';
}

function updateVideoFolderRow() {
  const row = $('videoFolderRow');
  if (!row) return;
  const enabled = $('videoFolderEnabled');
  row.hidden = !enabled || !enabled.checked;
}

function updateLongAudioRow() {
  const row = $('longAudioRow');
  if (!row) return;
  const enabled = $('longAudioEnabled');
  row.hidden = !enabled || !enabled.checked;
}

function pushConfig() {
  const audioEl = $('audioFormat');
  const qualityEl = $('mp3Quality');
  const channelEl = $('channelMode');
  const minutesEl = $('longAudioMinutes');
  const minutesValue = minutesEl ? Number(minutesEl.value) : 30;
  const longAudioMinutes = Number.isInteger(minutesValue) && minutesValue > 0
    ? minutesValue
    : 30;
  if (minutesEl) minutesEl.value = String(longAudioMinutes);
  saveConfig({
    audio_format: audioEl && audioEl.value ? audioEl.value : 'best',
    mp3_quality: qualityEl && qualityEl.value ? qualityEl.value : 'V0',
    channel_mode: channelEl && channelEl.value ? channelEl.value : 'stereo',
    embed_thumbnail: $('embedThumbnail') ? $('embedThumbnail').checked : true,
    thumbnail_jpg: $('thumbnailJpg') ? $('thumbnailJpg').checked : false,
    verbose_output: $('verboseOutput') ? $('verboseOutput').checked : false,
    long_audio_enabled: $('longAudioEnabled') ? $('longAudioEnabled').checked : false,
    long_audio_minutes: longAudioMinutes,
    long_audio_dir: $('longAudioDir') && $('longAudioDir').value.trim() ? $('longAudioDir').value.trim() : '~/Podcasts',
  });
}

function renderUpdateNote(status) {
  statusModel.ytdlp = status || null;
  const cell = $('ytdlpVersionLine');
  const versionText = $('ytdlpVersionText');
  const versionBadge = $('ytdlpVersionBadge');
  if (status && status.installed) {
    if (versionText) versionText.textContent = status.installed;
    if (status.outdated) {
      setState(cell, 'warn');
      if (versionBadge) versionBadge.textContent = 'Update available';
      setTitle(cell, status.latest
        ? `Installed ${status.installed}, latest ${status.latest}`
        : `Installed ${status.installed}${typeof status.age_days === 'number' ? `, ${status.age_days} days old` : ''}`);
    } else {
      setState(cell, 'ok');
      if (versionBadge) versionBadge.textContent = 'Up to date';
      setTitle(cell, status.latest
        ? `Latest release ${status.latest}`
        : 'Recent release (latest version not checked online)');
    }
  } else {
    if (versionText) versionText.textContent = '\u2013';
    const missing = statusModel.deps && statusModel.deps.yt_dlp === false;
    if (statusModel.connected === null) {
      setState(cell, 'pending');
      if (versionBadge) versionBadge.textContent = 'Checking';
    } else if (missing) {
      setState(cell, 'bad');
      if (versionBadge) versionBadge.textContent = 'Not found';
    } else {
      setState(cell, 'neutral');
      if (versionBadge) versionBadge.textContent = statusModel.connected ? 'Unknown' : 'Needs companion';
    }
    setTitle(cell, '');
  }
  renderHealth();

  const note = $('ytdlpUpdateNote');
  if (!note) return;
  if (!status || !status.outdated) {
    note.hidden = true;
    return;
  }
  note.hidden = false;
  const installed = status.installed || 'unknown';
  const latest = status.latest;
  const age = status.age_days;
  const hint = status.update_hint || 'yt-dlp -U';
  let summary;
  if (latest) {
    summary = `yt-dlp ${latest} is available (installed ${installed}). Update with:`;
  } else if (typeof age === 'number') {
    summary = `Installed yt-dlp ${installed} is ${age} days old. Update with:`;
  } else {
    summary = `Installed yt-dlp ${installed} is out of date. Update with:`;
  }
  const textEl = $('ytdlpUpdateText');
  if (textEl) textEl.textContent = summary;
  else note.textContent = `${summary} ${hint}`;
  const hintEl = $('ytdlpUpdateHint');
  if (hintEl) hintEl.textContent = hint;
}

function updateThreadsControl(response) {
  const select = $('postprocessThreads');
  if (!select) return;
  const detected = Number(response && response.cpu_threads) ||
    (typeof navigator !== 'undefined' && Number(navigator.hardwareConcurrency)) ||
    4;
  const cpuThreads = Math.max(1, Math.floor(detected));
  const recommended = Number(response && response.recommended_threads) ||
    (cpuThreads <= 2 ? 1 : cpuThreads - 2);
  if (select.options) {
    const options = Array.from(select.options);
    const autoOpt = options.find((item) => item.value === '0');
    if (autoOpt) {
      autoOpt.textContent = `Auto (${recommended} of ${cpuThreads} threads, max - 2)`;
    }
  }
  const config = (response && response.config) || {};
  const configured = Number(config.postprocess_threads);
  select.value = Number.isInteger(configured) && configured > 0 ? String(configured) : '0';
  const threadsNote = $('threadsNote');
  if (threadsNote) {
    const active = Number.isInteger(configured) && configured > 0 ? configured : recommended;
    threadsNote.textContent =
      `Using ${active} thread${active === 1 ? '' : 's'} (${cpuThreads} CPU threads detected) for parallel cover art, metadata, and ReplayGain inside one terminal.`;
  }
}

async function refreshLiveYtdlpUpdate() {
  if (ytdlpNetworkCheckAttempted) return;
  ytdlpNetworkCheckAttempted = true;
  const api = ext();
  if (!api || !api.runtime || typeof api.runtime.sendNativeMessage !== 'function') return;
  try {
    const resp = await api.runtime.sendNativeMessage(HOST_ID, { action: 'check_ytdlp_update' });
    if (resp && resp.ok && resp.yt_dlp_status) renderUpdateNote(resp.yt_dlp_status);
  } catch (_error) {
    // Offline or host older than check_ytdlp_update; keep cached/local status.
  }
}

function renderConnected(response) {
  setVisible(true);
  updateDownloadPresets(response);
  lastDeps = response.deps || null;
  statusModel.connected = true;
  statusModel.companionVersion = response.version || null;
  statusModel.deps = response.deps || null;
  renderComponents();
  renderDeps(statusModel.deps);
  const config = response.config || {};
  applyUiMode(config.ui_mode);
  notifyExtensionConfig(config);

  $('autoTag').checked = config.auto_tag !== false;
  $('rsgain').checked = config.rsgain === true;
  if ($('verboseOutput')) $('verboseOutput').checked = config.verbose_output === true;
  if ($('showCutButton')) $('showCutButton').checked = config.show_cut_button === true;
  if ($('audioFormat')) $('audioFormat').value = config.audio_format || 'best';
  if ($('mp3Quality')) $('mp3Quality').value = config.mp3_quality || 'V0';
  if ($('videoQuality')) $('videoQuality').value = config.video_quality || 'best';
  if ($('videoCodec')) $('videoCodec').value = config.video_codec || 'auto';
  if ($('channelMode')) {
    $('channelMode').value = config.channel_mode || 'stereo';
  }
  if ($('embedThumbnail')) $('embedThumbnail').checked = config.embed_thumbnail !== false;
  if ($('thumbnailJpg')) $('thumbnailJpg').checked = config.thumbnail_jpg === true;
  if ($('videoFolderEnabled')) $('videoFolderEnabled').checked = config.video_dir_enabled === true;
  if ($('longAudioEnabled')) $('longAudioEnabled').checked = config.long_audio_enabled === true;
  if ($('longAudioMinutes')) $('longAudioMinutes').value = String(config.long_audio_minutes || 30);
  if ($('longAudioDir')) $('longAudioDir').value = config.long_audio_dir || '~/Podcasts';
  updateMp3Row();
  updateFormatNote();
  updateVideoQualityNote();
  updateVideoFolderRow();
  updateLongAudioRow();
  updateThreadsControl(response);
  const missingNote = $('rsgainMissingNote');
  if (missingNote) {
    if (lastDeps && lastDeps.rsgain === true) missingNote.hidden = true;
    else if (lastDeps && lastDeps.rsgain === false && config.rsgain !== true) missingNote.hidden = true;
  }

  const key = presetKeyFor(config.download_dir);
  if ($('downloadFolder')) $('downloadFolder').value = key;
  $('customDir').hidden = key !== 'custom';
  if (key === 'custom') $('customDir').value = config.download_dir || '';

  const effective = response.effective_download_dir;
  $('effectiveDir').textContent = effective
    ? `Saving to ${effective}${response.ytdlp_config_exists ? '' : ' (yt-dlp config not found, using app default)'}`
    : 'Download folder follows your yt-dlp config.';
  const videoKey = presetKeyFor(config.video_download_dir, VIDEO_PRESETS);
  if ($('videoDownloadFolder')) $('videoDownloadFolder').value = videoKey;
  $('customVideoDir').hidden = videoKey !== 'custom';
  if (videoKey === 'custom') $('customVideoDir').value = config.video_download_dir || '';
  const effectiveVideo = response.effective_video_download_dir;
  $('effectiveVideoDir').textContent = effectiveVideo
    ? `Saving videos to ${effectiveVideo}${response.ytdlp_config_exists && config.video_download_dir == null ? '' : ' (project video folder)'}`
    : 'Video folder follows your yt-dlp config.';
  renderUpdateNote(response.yt_dlp_status);
  if (response.yt_dlp_status && response.yt_dlp_status.installed && !response.yt_dlp_status.latest) {
    refreshLiveYtdlpUpdate();
  }
}

function renderDisconnected() {
  setVisible(false);
  statusModel.connected = false;
  statusModel.companionVersion = null;
  statusModel.deps = null;
  renderComponents();
  renderDeps(null);
  if ($('installCmd')) $('installCmd').textContent = INSTALL_CMD;
  renderUpdateNote(null);
}

function renderChecking() {
  statusModel.connected = null;
  renderComponents();
  renderUpdateNote(statusModel.ytdlp);
}

async function refresh() {
  const api = ext();
  renderChecking();
  if (!api) {
    renderDisconnected();
    return;
  }
  try {
    const response = await api.runtime.sendNativeMessage(HOST_ID, { action: 'ping' });
    if (response && response.ok) renderConnected(response);
    else renderDisconnected();
  } catch (_error) {
    renderDisconnected();
  }
}

async function saveConfig(patch) {
  const api = ext();
  if (!api) return;
  try {
    const response = await api.runtime.sendNativeMessage(HOST_ID, {
      action: 'set_config',
      config: patch,
    });
    if (response && response.ok) renderConnected(response);
  } catch (_error) {
    renderDisconnected();
  }
}

function currentFolderValue() {
  const select = $('downloadFolder');
  const key = select && select.value ? select.value : 'keep';
  if (key === 'custom') {
    const custom = $('customDir').value.trim();
    return custom || null;
  }
  return expandHome(PRESETS[key] !== undefined ? PRESETS[key] : null);
}

function currentVideoFolderValue() {
  const select = $('videoDownloadFolder');
  const key = select && select.value ? select.value : 'keep';
  if (key === 'custom') {
    const custom = $('customVideoDir').value.trim();
    return custom || null;
  }
  return expandHome(VIDEO_PRESETS[key] !== undefined ? VIDEO_PRESETS[key] : null);
}

async function copyText(text, onDone) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    onDone(true);
  } catch (_error) {
    onDone(false);
  }
}

async function copyInstallCommand() {
  const note = $('copyNote');
  await copyText(INSTALL_CMD, (ok) => {
    note.textContent = ok
      ? 'Copied. Run it in the project folder, then retry.'
      : 'Copy failed. Type the command above by hand.';
  });
}

async function copyUpdateCommand() {
  const button = $('ytdlpUpdateCopy');
  const hint = $('ytdlpUpdateHint');
  const text = hint && hint.textContent ? hint.textContent : 'yt-dlp -U';
  await copyText(text, (ok) => {
    if (!button) return;
    button.textContent = ok ? 'Copied' : 'Copy failed';
    setTimeout(() => {
      button.textContent = 'Copy';
    }, 1600);
  });
}

function main() {
  const view = queryParam('view');
  const onboarding = queryParam('onboarding');
  if (view === 'options') document.querySelector('.panel').setAttribute('data-view', 'options');
  if (onboarding) document.querySelector('.panel').setAttribute('data-view', 'onboarding');
  if (onboarding) renderDisconnected();

  if ($('uiModeSimple')) {
    $('uiModeSimple').addEventListener('click', () => {
      applyUiMode('simple');
      saveConfig({ ui_mode: 'simple' });
    });
  }
  if ($('uiModeAdvanced')) {
    $('uiModeAdvanced').addEventListener('click', () => {
      applyUiMode('advanced');
      saveConfig({ ui_mode: 'advanced' });
    });
  }

  $('autoTag').addEventListener('change', (event) => {
    saveConfig({ auto_tag: event.target.checked });
  });
  $('rsgain').addEventListener('change', (event) => {
    const rsgainEl = event.target;
    const rsgainMissingNoteEl = $('rsgainMissingNote');
    if (rsgainEl.checked && lastDeps && lastDeps.rsgain === false) {
      rsgainEl.checked = false;
      if (rsgainMissingNoteEl) {
        rsgainMissingNoteEl.textContent = 'rsgain is not installed on this system. Install rsgain first (e.g. sudo apt install rsgain, brew install rsgain, or winget install complexlogic.rsgain), then enable ReplayGain.';
        rsgainMissingNoteEl.hidden = false;
      }
      return;
    }
    if (rsgainMissingNoteEl && lastDeps && lastDeps.rsgain === true) rsgainMissingNoteEl.hidden = true;
    saveConfig({ rsgain: rsgainEl.checked });
  });
  if ($('showCutButton')) {
    $('showCutButton').addEventListener('change', (event) => {
      saveConfig({ show_cut_button: event.target.checked });
    });
  }
  if ($('verboseOutput')) {
    $('verboseOutput').addEventListener('change', (event) => {
      saveConfig({ verbose_output: event.target.checked });
    });
  }
  const threadsEl = $('postprocessThreads');
  if (threadsEl) {
    threadsEl.addEventListener('change', () => {
      const value = Number.parseInt(threadsEl.value, 10);
      saveConfig({ postprocess_threads: Number.isInteger(value) && value > 0 ? value : 0 });
    });
  }
  const audioFormatEl = $('audioFormat');
  if (audioFormatEl) {
    audioFormatEl.addEventListener('change', () => {
      updateMp3Row();
      updateFormatNote();
      pushConfig();
    });
  }
  const mp3QualityEl = $('mp3Quality');
  if (mp3QualityEl) {
    mp3QualityEl.addEventListener('change', () => {
      pushConfig();
    });
  }
  const videoQualityEl = $('videoQuality');
  if (videoQualityEl) {
    videoQualityEl.addEventListener('change', () => {
      updateVideoQualityNote();
      saveConfig({ video_quality: videoQualityEl.value || 'best' });
    });
  }
  const videoCodecEl = $('videoCodec');
  if (videoCodecEl) {
    videoCodecEl.addEventListener('change', () => {
      updateVideoQualityNote();
      saveConfig({ video_codec: videoCodecEl.value || 'auto' });
    });
  }
  for (const id of ['embedThumbnail', 'thumbnailJpg', 'longAudioEnabled']) {
    const el = $(id);
    if (el) {
      el.addEventListener('change', () => {
        if (id === 'longAudioEnabled') updateLongAudioRow();
        pushConfig();
      });
    }
  }
  if ($('videoFolderEnabled')) {
    $('videoFolderEnabled').addEventListener('change', (event) => {
      updateVideoFolderRow();
      saveConfig({ video_dir_enabled: event.target.checked });
    });
  }
  const channelModeEl = $('channelMode');
  if (channelModeEl) {
    channelModeEl.addEventListener('change', () => {
      pushConfig();
    });
  }
  if ($('longAudioMinutes')) $('longAudioMinutes').addEventListener('change', () => pushConfig());
  if ($('longAudioDir')) $('longAudioDir').addEventListener('change', () => pushConfig());
  const downloadFolderEl = $('downloadFolder');
  if (downloadFolderEl) {
    downloadFolderEl.addEventListener('change', () => {
      $('customDir').hidden = downloadFolderEl.value !== 'custom';
      if (downloadFolderEl.value !== 'custom') saveConfig({ download_dir: currentFolderValue() });
    });
  }
  $('customDir').addEventListener('change', () => {
    saveConfig({ download_dir: currentFolderValue() });
  });
  const videoFolderEl = $('videoDownloadFolder');
  if (videoFolderEl) {
    videoFolderEl.addEventListener('change', () => {
      $('customVideoDir').hidden = videoFolderEl.value !== 'custom';
      if (videoFolderEl.value !== 'custom') {
        saveConfig({ video_download_dir: currentVideoFolderValue() });
      }
    });
  }
  if ($('customVideoDir')) {
    $('customVideoDir').addEventListener('change', () => {
      saveConfig({ video_download_dir: currentVideoFolderValue() });
    });
  }
  $('copyBtn').addEventListener('click', copyInstallCommand);
  $('retryBtn').addEventListener('click', refresh);
  if ($('ytdlpUpdateCopy')) $('ytdlpUpdateCopy').addEventListener('click', copyUpdateCommand);

  refresh();
}

document.addEventListener('DOMContentLoaded', main);
