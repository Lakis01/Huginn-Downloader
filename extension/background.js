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

// No documentUrlPatterns or targetUrlPatterns: Firefox rejects menu items
// blocked by URL patterns before display (bare page background has no
// target URL; hover-autoplay mounts about:blank frames; thumbnails use
// i.ytimg.com srcUrl and previews use blob: srcUrl). Like Play in MPV,
// the menu is always present and the native host validates the URL.
const MENU_CONTEXTS = ['page', 'frame', 'link', 'image', 'video', 'audio', 'selection'];

// Guards so repeated setup runs never attach duplicate listeners.
let listenersAttached = false;
let hooksAttached = false;

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
  let candidate = value;
  if (candidate.startsWith('blob:')) candidate = candidate.slice(5);
  try {
    const url = new URL(candidate);
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

// Plain HTTP(S) check for menu srcUrl targets: blob: and data: preview
// sources are never dispatchable to yt-dlp.
function isHttpUrl(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_error) {
    return false;
  }
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
  // Menu target fallback order: hovered YouTube card, link, usable
  // image/audio/video source, frame, page, then the active tab. A srcUrl
  // is only usable over plain HTTP(S): hover-autoplay previews expose
  // blob: or data: sources that yt-dlp cannot fetch.
  const srcUrl = isHttpUrl(info.srcUrl) ? info.srcUrl : null;
  const primaryUrl =
    contextUrl || info.linkUrl || srcUrl || info.frameUrl || info.pageUrl || (tab && tab.url) || null;
  const fallbacks = dedupeUrls([info.linkUrl, srcUrl, info.frameUrl, info.pageUrl, tab && tab.url].filter(Boolean)).filter(
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

async function setupMenus() {
  const menus = menusApi();
  if (!menus) return;
  try {
    if (menus.removeAll) await menus.removeAll();
  } catch (_error) {
    // Fresh install has nothing to remove; continue to creation.
  }
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
        await created.catch(async () => {
          // A stale persisted menu can block creation; update instead.
          try {
            if (menus.update) await menus.update(item.id, item);
          } catch (_updateError) {
            // Menu still stands; nothing to repair.
          }
        });
      }
    } catch (_error) {
      try {
        if (menus.update) await menus.update(item.id, item);
      } catch (_updateError) {
        // Menu still stands; nothing to repair.
      }
    }
  }
}

function attachListeners() {
  if (listenersAttached) return;
  listenersAttached = true;
  const menus = menusApi();
  if (menus && menus.onClicked) {
    menus.onClicked.addListener(handleMenuClick);
  }
  const api = ext();
  if (api && api.runtime && api.runtime.onMessage) {
    api.runtime.onMessage.addListener(handlePillMessage);
  }
}

function attachHooks() {
  if (hooksAttached) return;
  hooksAttached = true;
  const api = ext();
  if (!api || !api.runtime) return;
  if (api.runtime.onInstalled) {
    api.runtime.onInstalled.addListener(setupMenus);
  }
  if (api.runtime.onStartup) {
    api.runtime.onStartup.addListener(setupMenus);
  }
}

attachListeners();
attachHooks();
setupMenus();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HOST_ID, MENU_MODES, MENU_CONTEXTS, isYouTubeUrl, isHttpUrl, dedupeUrls };
}
