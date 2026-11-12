'use strict';

/* YouTube Downloader background script: icon context menu plus
   watch-page pill relay, both dispatched to the native host. */

const HOST_ID = 'firefox_youtube_downloader';
const ONBOARDING_URL = 'popup.html?onboarding=1';

const MENU_MODES = {
  'ytdl-audio': 'audio',
  'ytdl-video': 'video',
  'ytdl-cut': 'cut',
};

// Broad contexts with no URL patterns: Firefox rejects items blocked by
// URL patterns or missing contexts before onShown ever runs (bare page
// background has no target URL; thumbnails use i.ytimg.com srcUrl and
// previews use blob: srcUrl), so the onShown gate below is the only
// visibility control.
const MENU_CONTEXTS = ['page', 'frame', 'link', 'image', 'video', 'audio'];

// Guards so a second setupMenus() run (via onInstalled) never attaches
// duplicate onClicked/onShown/onMessage listeners or hooks.
let listenersAttached = false;
let installedHooked = false;

function ext() {
  if (typeof browser !== 'undefined' && browser) return browser;
  if (typeof chrome !== 'undefined' && chrome) return chrome;
  return null;
}

function menusApi() {
  const api = ext();
  if (!api) return null;
  return api.menus || api.contextMenus || null;
}

function isYouTubeUrl(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return (
      host === 'youtube.com' ||
      host.endsWith('.youtube.com') ||
      host === 'youtu.be' ||
      host.endsWith('.youtu.be')
    );
  } catch (_error) {
    return false;
  }
}

function dedupeUrls(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (typeof value !== 'string' || !value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

async function queryContextUrl(tabId) {
  const api = ext();
  if (!api || !tabId) return null;
  try {
    const response = await api.tabs.sendMessage(tabId, { type: 'ytdl-get-context-url' });
    if (response && typeof response.url === 'string' && response.url) return response.url;
  } catch (_error) {
    // Content script is not loaded here (for example a non-YouTube
    // page), so fall back to the menu target URLs below.
  }
  return null;
}

async function openOnboarding() {
  const api = ext();
  if (!api) return;
  const url = api.runtime.getURL(ONBOARDING_URL);
  await api.tabs.create({ url });
}

async function sendDownload(mode, primaryUrl, fallbacks) {
  const api = ext();
  if (!api) return { ok: false, error: 'extension API unavailable' };
  const candidates = dedupeUrls([primaryUrl, ...(fallbacks || [])]);
  const url = candidates[0] || null;
  try {
    const response = await api.runtime.sendNativeMessage(HOST_ID, {
      action: 'download',
      mode,
      url,
      fallbacks: candidates.slice(1),
    });
    // A non-OK reply is a download failure from a connected companion,
    // not a missing companion, so it must not open onboarding. Only a
    // rejected sendNativeMessage (companion missing) does that.
    return response || { ok: false, error: 'companion did not respond' };
  } catch (_error) {
    await openOnboarding();
    return { ok: false, error: 'companion missing' };
  }
}

async function handleMenuClick(info, tab) {
  const mode = MENU_MODES[info.menuItemId];
  if (!mode) return;
  const tabId = tab && tab.id;
  const contextUrl = await queryContextUrl(tabId);
  const primaryUrl = contextUrl || info.linkUrl || info.pageUrl || (tab && tab.url) || null;
  const fallbacks = dedupeUrls([info.linkUrl, info.pageUrl, tab && tab.url].filter(Boolean)).filter(
    (candidate) => candidate !== primaryUrl,
  );
  await sendDownload(mode, primaryUrl, fallbacks);
}

function handlePillMessage(message) {
  if (!message || message.type !== 'ytdl-trigger-download') return undefined;
  const mode = message.mode;
  if (mode !== 'audio' && mode !== 'video' && mode !== 'cut') return undefined;
  return sendDownload(mode, message.url || null, message.fallbacks || []);
}

function setupMenus() {
  const menus = menusApi();
  if (!menus) return;
  const items = [
    {
      id: 'ytdl-root',
      title: 'YouTube Downloader',
      contexts: MENU_CONTEXTS.slice(),
      icons: { 16: 'icons/plugin.svg', 32: 'icons/plugin.svg' },
    },
    {
      id: 'ytdl-audio',
      parentId: 'ytdl-root',
      title: 'Audio',
      contexts: MENU_CONTEXTS.slice(),
      icons: { 16: 'icons/audio.svg', 32: 'icons/audio.svg' },
    },
    {
      id: 'ytdl-video',
      parentId: 'ytdl-root',
      title: 'Video',
      contexts: MENU_CONTEXTS.slice(),
      icons: { 16: 'icons/video.svg', 32: 'icons/video.svg' },
    },
    {
      id: 'ytdl-cut',
      parentId: 'ytdl-root',
      title: 'Cut Audio',
      contexts: MENU_CONTEXTS.slice(),
      icons: { 16: 'icons/cut.svg', 32: 'icons/cut.svg' },
    },
  ];
  for (const item of items) {
    try {
      const created = menus.create(item);
      if (created && typeof created.catch === 'function') {
        created.catch(() => {
          // Re-installs may race duplicate creation; the menu still stands.
        });
      }
    } catch (_error) {
      // Re-installs may race duplicate creation; the menu still stands.
    }
  }
  attachListeners(menus);
}

function attachListeners(menus) {
  if (listenersAttached) return;
  listenersAttached = true;
  menus.onClicked.addListener(handleMenuClick);
  if (menus.onShown && typeof menus.onShown.addListener === 'function') {
    menus.onShown.addListener((info) => {
      // Sole visibility gate: YouTube pages, YouTube frames, and
      // YouTube link targets on any site, without duplicating items.
      const visible =
        isYouTubeUrl(info.pageUrl) ||
        isYouTubeUrl(info.frameUrl) ||
        isYouTubeUrl(info.linkUrl);
      try {
        const result = menus.update ? menus.update('ytdl-root', { visible }) : null;
        if (result && typeof result.then === 'function') result.then(() => menus.refresh());
        else if (menus.refresh) menus.refresh();
      } catch (_error) {
        // Menu visibility stays as declared; nothing to repair.
      }
    });
  }
  const api = ext();
  if (api && api.runtime && api.runtime.onMessage) {
    api.runtime.onMessage.addListener(handlePillMessage);
  }
  if (api && api.runtime && api.runtime.onInstalled && !installedHooked) {
    installedHooked = true;
    api.runtime.onInstalled.addListener(setupMenus);
  }
}

setupMenus();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HOST_ID, MENU_MODES, isYouTubeUrl, dedupeUrls };
}
