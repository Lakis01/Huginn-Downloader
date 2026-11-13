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

let lastDeps = null;

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

function presetKeyFor(downloadDir) {
  if (downloadDir === null || downloadDir === undefined || downloadDir === '') return 'keep';
  for (const [key, preset] of Object.entries(PRESETS)) {
    if (key !== 'keep' && preset === downloadDir) return key;
  }
  return 'custom';
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

function renderConnected(response) {
  setVisible(true);
  lastDeps = response.deps || null;
  $('statusText').textContent = `Connected (companion ${response.version || 'unknown'})`;
  const config = response.config || {};
  $('autoTag').checked = config.auto_tag !== false;
  $('rsgain').checked = config.rsgain === true;
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
  const deps = response.deps || {};
  const missing = Object.entries(deps)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  $('depsLine').textContent = missing.length
    ? `Missing tools: ${missing.join(', ')}`
    : 'Tools ready: yt-dlp, ffmpeg, rsgain.';
  renderUpdateNote(response.yt_dlp_status);
}

function renderDisconnected() {
  setVisible(false);
  $('statusText').textContent = 'Companion not connected';
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
  $('copyBtn').addEventListener('click', copyInstallCommand);
  $('retryBtn').addEventListener('click', refresh);

  refresh();
}

document.addEventListener('DOMContentLoaded', main);
