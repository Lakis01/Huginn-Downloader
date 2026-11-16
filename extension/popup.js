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
  const dot = $('statusDot');
  dot.classList.toggle('ok', connected);
  dot.classList.toggle('bad', !connected);
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

function updateLongAudioRow() {
  const row = $('longAudioRow');
  if (!row) return;
  const enabled = $('longAudioEnabled');
  row.hidden = !enabled || !enabled.checked;
}

function renderUpdateNote(status) {
  const versionLine = $('ytdlpVersionLine');
  const versionText = $('ytdlpVersionText');
  const versionBadge = $('ytdlpVersionBadge');
  if (versionLine) {
    if (status && status.installed) {
      versionLine.hidden = false;
      if (versionText) {
        versionText.textContent = status.outdated && status.latest
          ? `yt-dlp ${status.installed} (latest ${status.latest})`
          : `yt-dlp ${status.installed}`;
      }
      if (versionBadge) {
        versionBadge.hidden = false;
        versionBadge.textContent = status.outdated ? 'Outdated' : 'Up to date';
        if (versionBadge.classList) {
          versionBadge.classList.toggle('bad', Boolean(status.outdated));
          versionBadge.classList.toggle('ok', !status.outdated);
        }
      }
    } else {
      versionLine.hidden = true;
      if (versionBadge) versionBadge.hidden = true;
    }
  }

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
    summary = `Installed ${installed}, latest ${latest}.`;
  } else if (typeof age === 'number') {
    summary = `Installed ${installed}, ${age} days old.`;
  } else {
    summary = `Installed ${installed}.`;
  }
  const textEl = $('ytdlpUpdateText');
  if (textEl) textEl.textContent = `yt-dlp is out of date. ${summary}`;
  else note.textContent = `yt-dlp is out of date. ${summary} Update with: ${hint}`;
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
  const companionVersion = response.version || 'unknown';
  const extensionVersion = getExtensionVersion(companionVersion);
  $('statusText').textContent =
    `Connected (extension ${extensionVersion}, companion ${companionVersion})`;
  const config = response.config || {};
  $('autoTag').checked = config.auto_tag !== false;
  $('rsgain').checked = config.rsgain === true;
  if ($('verboseOutput')) $('verboseOutput').checked = config.verbose_output === true;
  if ($('audioFormat')) $('audioFormat').value = config.audio_format || 'best';
  if ($('mp3Quality')) $('mp3Quality').value = config.mp3_quality || 'V0';
  if ($('channelMode')) {
    $('channelMode').value = config.channel_mode || 'stereo';
  }
  if ($('embedThumbnail')) $('embedThumbnail').checked = config.embed_thumbnail !== false;
  if ($('thumbnailJpg')) $('thumbnailJpg').checked = config.thumbnail_jpg === true;
  if ($('longAudioEnabled')) $('longAudioEnabled').checked = config.long_audio_enabled === true;
  if ($('longAudioMinutes')) $('longAudioMinutes').value = String(config.long_audio_minutes || 30);
  if ($('longAudioDir')) $('longAudioDir').value = config.long_audio_dir || '~/Podcasts';
  updateMp3Row();
  updateFormatNote();
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
  const deps = response.deps || {};
  const missing = Object.entries(deps)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  $('depsLine').textContent = missing.length
    ? `Missing tools: ${missing.join(', ')}`
    : 'Tools ready: yt-dlp, ffmpeg, rsgain.';
  renderUpdateNote(response.yt_dlp_status);
  if (response.yt_dlp_status && response.yt_dlp_status.installed && !response.yt_dlp_status.latest) {
    refreshLiveYtdlpUpdate();
  }
}

function renderDisconnected() {
  setVisible(false);
  const extensionVersion = getExtensionVersion(null);
  $('statusText').textContent = extensionVersion
    ? `Companion not connected (extension ${extensionVersion})`
    : 'Companion not connected';
  if ($('installCmd')) $('installCmd').textContent = INSTALL_CMD;
  renderUpdateNote(null);
}

async function refresh() {
  const api = ext();
  $('statusText').textContent = 'Checking companion connection...';
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

async function copyInstallCommand() {
  const note = $('copyNote');
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(INSTALL_CMD);
    } else {
      const area = document.createElement('textarea');
      area.value = INSTALL_CMD;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    note.textContent = 'Copied. Run it in the project folder, then retry.';
  } catch (_error) {
    note.textContent = 'Copy failed. Type the command above by hand.';
  }
}

function main() {
  const view = queryParam('view');
  const onboarding = queryParam('onboarding');
  if (view === 'options') document.querySelector('.panel').setAttribute('data-view', 'options');
  if (onboarding) document.querySelector('.panel').setAttribute('data-view', 'onboarding');
  if (onboarding) renderDisconnected();

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
  for (const id of ['embedThumbnail', 'thumbnailJpg', 'longAudioEnabled']) {
    const el = $(id);
    if (el) {
      el.addEventListener('change', () => {
        if (id === 'longAudioEnabled') updateLongAudioRow();
        pushConfig();
      });
    }
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

  refresh();
}

document.addEventListener('DOMContentLoaded', main);
