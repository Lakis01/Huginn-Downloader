'use strict';

/* Huginn Downloader background script: icon context menu plus
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

function parseYouTubeUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  let candidate = value;
  if (candidate.startsWith('blob:')) candidate = candidate.slice(5);
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    const isYouTube =
      host === 'youtube.com' ||
      host.endsWith('.youtube.com') ||
      host === 'youtu.be' ||
      host.endsWith('.youtu.be');
    return isYouTube ? url : null;
  } catch (_error) {
    return null;
  }
}

function isYouTubeUrl(value) {
  return Boolean(parseYouTubeUrl(value));
}

function extractPlaylistId(value) {
  const url = parseYouTubeUrl(value);
  if (!url) return null;
  const raw = url.searchParams.get('list');
  return raw && raw.trim() ? raw.trim() : null;
}

function isYouTubePlaylistUrl(value) {
  const url = parseYouTubeUrl(value);
  if (!url) return false;
  if (url.pathname === '/playlist') return Boolean(extractPlaylistId(value));
  return Boolean(extractPlaylistId(value));
}

function extractWatchVideoUrl(value) {
  const url = parseYouTubeUrl(value);
  if (!url) return null;
  if (url.pathname === '/watch' && url.searchParams.get('v')) return url.href;
  if (url.pathname.startsWith('/shorts/')) return url.href;
  return null;
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

async function ensureContentScriptLoaded(tabId) {
  const api = ext();
  if (!api || !tabId) return false;
  try {
    if (api.scripting && api.scripting.executeScript) {
      if (api.scripting.insertCSS) {
        await api.scripting.insertCSS({ target: { tabId }, files: ['content.css'] }).catch(() => {});
      }
      await api.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      return true;
    }
    if (api.tabs && api.tabs.executeScript) {
      if (api.tabs.insertCSS) {
        await api.tabs.insertCSS(tabId, { file: 'content.css' }).catch(() => {});
      }
      await api.tabs.executeScript(tabId, { file: 'content.js' });
      return true;
    }
  } catch (_error) {
    return false;
  }
  return false;
}

async function queryContextInfo(tabId, tabUrl) {
  const api = ext();
  if (!api || !tabId) return null;
  const askOnce = async () => {
    const response = await api.tabs.sendMessage(tabId, { type: 'ytdl-get-context-url' });
    if (response && typeof response.url === 'string' && response.url) {
      return {
        url: response.url,
        isPlaylist: Boolean(response.isPlaylist),
        playlistId: typeof response.playlistId === 'string' ? response.playlistId : null,
        playlistUrl: typeof response.playlistUrl === 'string' ? response.playlistUrl : null,
        topVideoUrl: typeof response.topVideoUrl === 'string' ? response.topVideoUrl : null,
      };
    }
    return null;
  };
  try {
    return await askOnce();
  } catch (_error) {
    if (isYouTubeUrl(tabUrl) && (await ensureContentScriptLoaded(tabId))) {
      try {
        return await askOnce();
      } catch (_retryError) {
        return null;
      }
    }
  }
  return null;
}

async function promptPlaylistChoice(tabId, payload, tabUrl) {
  const api = ext();
  if (!api || !tabId) return false;
  const sendOnce = async () => {
    const response = await api.tabs.sendMessage(tabId, {
      type: 'ytdl-prompt-playlist-choice',
      ...payload,
    });
    return Boolean(response && response.shown);
  };
  try {
    return await sendOnce();
  } catch (_error) {
    if (isYouTubeUrl(tabUrl) && (await ensureContentScriptLoaded(tabId))) {
      try {
        return await sendOnce();
      } catch (_retryError) {
        return false;
      }
    }
    return false;
  }
}

async function openOnboarding() {
  const api = ext();
  if (!api) return;
  const url = api.runtime.getURL(ONBOARDING_URL);
  await api.tabs.create({ url });
}

async function sendDownload(mode, primaryUrl, fallbacks, options) {
  const api = ext();
  if (!api) return { ok: false, error: 'extension API unavailable' };
  const candidates = dedupeUrls([primaryUrl, ...(fallbacks || [])]);
  const url = candidates[0] || null;
  const payload = {
    action: 'download',
    mode,
    url,
    fallbacks: candidates.slice(1),
  };
  if (mode !== 'cut' && options && typeof options.playlist === 'boolean') {
    payload.playlist = options.playlist;
  } else if (mode === 'cut' && options && options.playlist === false) {
    payload.playlist = false;
  }
  if (mode !== 'cut' && options && typeof options.playlistItems === 'string' && options.playlistItems.trim()) {
    payload.playlist_items = options.playlistItems.trim();
  }
  try {
    const response = await api.runtime.sendNativeMessage(HOST_ID, payload);
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
  const tabUrl = (tab && tab.url) || info.pageUrl || null;
  const contextInfo = await queryContextInfo(tabId, tabUrl);
  const contextUrl = contextInfo ? contextInfo.url : null;
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

  const playlistId = (contextInfo && contextInfo.playlistId) || extractPlaylistId(primaryUrl);
  const isPlaylistTarget = Boolean((contextInfo && contextInfo.isPlaylist) || isYouTubePlaylistUrl(primaryUrl));
  const playlistUrl =
    (contextInfo && contextInfo.playlistUrl) ||
    (playlistId && !playlistId.startsWith('RD')
      ? `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`
      : primaryUrl);
  const topVideoUrl =
    (contextInfo && contextInfo.topVideoUrl) ||
    extractWatchVideoUrl(info.linkUrl) ||
    extractWatchVideoUrl(primaryUrl) ||
    null;

  if (mode === 'cut' && isPlaylistTarget) {
    await sendDownload(mode, topVideoUrl || primaryUrl, fallbacks, { playlist: false });
    return;
  }

  if ((mode === 'audio' || mode === 'video') && isPlaylistTarget) {
    if (tabId) {
      const shown = await promptPlaylistChoice(
        tabId,
        {
          mode,
          url: primaryUrl,
          playlistUrl,
          topVideoUrl,
          playlistId,
        },
        tabUrl,
      );
      if (shown) return;
    }
    await sendDownload(mode, playlistUrl || primaryUrl, fallbacks, { playlist: true });
    return;
  }

  await sendDownload(mode, primaryUrl, fallbacks);
}

function handlePillMessage(message, _sender, sendResponse) {
  if (!message || message.type !== 'ytdl-trigger-download') return undefined;
  const mode = message.mode;
  if (mode !== 'audio' && mode !== 'video' && mode !== 'cut') return undefined;
  const result = sendDownload(mode, message.url || null, message.fallbacks || [], {
    playlist: mode === 'cut' ? false : message.playlist,
    playlistItems: mode === 'cut' ? undefined : message.playlistItems,
  });
  if (typeof sendResponse === 'function' && (typeof browser === 'undefined' || !browser)) {
    Promise.resolve(result).then(sendResponse, () => sendResponse({ ok: false }));
    return true;
  }
  return result;
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
      title: 'Huginn Downloader',
      contexts: MENU_CONTEXTS.slice(),
      icons: { 16: 'icons/huginn-logo.svg', 32: 'icons/huginn-logo.svg' },
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
  const supportsMenuIcons = Boolean(typeof browser !== 'undefined' && browser && browser.menus);
  for (const item of items) {
    const menuItem = supportsMenuIcons
      ? item
      : (({ icons: _icons, ...rest }) => rest)(item);
    try {
      const created = menus.create(menuItem);
      if (created && typeof created.catch === 'function') {
        await created.catch(async () => {
          // A stale persisted menu can block creation; update instead.
          try {
            if (menus.update) await menus.update(item.id, menuItem);
          } catch (_updateError) {
            // Menu still stands; nothing to repair.
          }
        });
      }
    } catch (_error) {
      try {
        if (menus.update) await menus.update(item.id, menuItem);
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
