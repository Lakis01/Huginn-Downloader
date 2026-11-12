'use strict';

/* Watch-page segmented pill plus right-click context URL tracking
   for the Firefox WebExtension content script. */

(function () {
  const GROUP_SELECTOR = '[data-ytdl-controls]';
  const CARD_SELECTOR = [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-rich-grid-media',
    'ytd-reel-item-renderer',
    'ytd-reel-video-renderer',
    'yt-lockup-view-model',
    'ytd-playlist-video-renderer',
    'ytd-playlist-panel-video-renderer',
    'ytmusic-two-row-item-renderer',
    'ytmusic-responsive-list-item-renderer',
    'ytd-video-preview',
    '#video-preview',
  ].join(', ');

  const MODES = [
    { mode: 'audio', label: 'Audio', aria: 'Download audio', icon: 'audio' },
    { mode: 'video', label: 'Video', aria: 'Download video', icon: 'video' },
    { mode: 'cut', label: 'Cut', aria: 'Cut audio', icon: 'cut' },
  ];

  const ICON_PATHS = {
    audio: [
      'M3 9v6h4l5 4V5L7 9H3Z',
      'M16 9a5 5 0 0 1 0 6',
      'M18.5 6.5a9 9 0 0 1 0 11',
    ],
    video: [
      'M4 6.5h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z',
      'm16 10 6-3v10l-6-3',
    ],
    cut: [
      'M6 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
      'M6 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
      'm8.2 8.2 11.6 11.6',
      'm14.5 9.5 5.3-5.3',
      'm8.2 15.8 3-3',
    ],
  };

  let lastContextUrl = null;
  let lastPointerUrl = null;
  let lastPointerAt = 0;
  let refreshTimer = null;

  function ext() {
    if (typeof browser !== 'undefined' && browser) return browser;
    if (typeof chrome !== 'undefined' && chrome) return chrome;
    return null;
  }

  function pageLocation() {
    if (typeof window !== 'undefined' && window.location) return window.location;
    return location;
  }

  function isWatchRoute() {
    const loc = pageLocation();
    const host = loc.hostname || '';
    const path = loc.pathname || '';
    const isYouTube = host === 'youtube.com' || host.endsWith('.youtube.com');
    return (
      isYouTube &&
      (path === '/watch' || path.startsWith('/shorts/') || path.startsWith('/live/'))
    );
  }

  function makeIcon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    for (const pathData of ICON_PATHS[name] || []) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', pathData);
      svg.appendChild(path);
    }
    return svg;
  }

  function triggerDownload(mode) {
    const api = ext();
    if (!api || !api.runtime) return;
    try {
      const result = api.runtime.sendMessage({
        type: 'ytdl-trigger-download',
        mode,
        url: pageLocation().href,
      });
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch (_error) {
      // Background may be unreachable; the menu path still applies.
    }
  }

  function makeGroup() {
    const group = document.createElement('div');
    group.setAttribute('data-ytdl-controls', 'true');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'yt-dlp actions');
    for (const action of MODES) {
      const button = document.createElement('button');
      button.setAttribute('type', 'button');
      button.setAttribute('data-ytdl-mode', action.mode);
      button.setAttribute('aria-label', action.aria);
      button.setAttribute('title', action.aria);
      button.appendChild(makeIcon(action.icon));
      const label = document.createElement('span');
      label.textContent = action.label;
      button.appendChild(label);
      button.addEventListener('click', () => {
        button.setAttribute('data-launching', 'true');
        triggerDownload(action.mode);
        const reset = () => button.removeAttribute('data-launching');
        if (typeof setTimeout === 'function') setTimeout(reset, 900);
        else reset();
      });
      group.appendChild(button);
    }
    return group;
  }

  function removeGroups() {
    for (const group of document.querySelectorAll(GROUP_SELECTOR)) group.remove();
  }

  function syncControls() {
    if (!isWatchRoute()) {
      removeGroups();
      return;
    }
    const metadata = document.querySelector('ytd-watch-metadata');
    const topRow = metadata && metadata.querySelector('#top-row');
    const owner = topRow && topRow.querySelector('#owner');
    const actions = topRow && topRow.querySelector('#actions');
    if (!topRow || !owner || !actions) return;
    const groups = Array.from(document.querySelectorAll(GROUP_SELECTOR));
    const mounted = groups.find((group) => group.parentNode === topRow);
    for (const group of groups) {
      if (group !== mounted) group.remove();
    }
    if (mounted) {
      const children = Array.from(topRow.children);
      if (children[children.indexOf(mounted) + 1] !== actions) {
        topRow.insertBefore(mounted, actions);
      }
      return;
    }
    topRow.insertBefore(makeGroup(), actions);
  }

  function cardLinkHref(card) {
    const links = card.querySelectorAll('a');
    for (const link of links) {
      const rawHref = link.getAttribute ? link.getAttribute('href') : link.href;
      if (!rawHref) continue;
      try {
        const url = new URL(rawHref, pageLocation().href);
        const host = url.hostname || '';
        const isYouTube = host === 'youtube.com' || host.endsWith('.youtube.com');
        if (isYouTube && (url.pathname === '/watch' || url.pathname.startsWith('/shorts/'))) {
          return url.href;
        }
      } catch (_error) {
        continue;
      }
    }
    return null;
  }

  function captureContextHref(event) {
    // No card match means no context URL (null): the background then
    // falls back to the menu linkUrl/pageUrl targets instead of the
    // current page, so right-clicking a bare YouTube link never
    // downloads the page behind it.
    let href = null;
    const cards = [];
    const addCardFor = (element) => {
      const card = element && element.closest ? element.closest(CARD_SELECTOR) : null;
      if (card && !cards.includes(card)) cards.push(card);
    };
    if (event && typeof document.elementsFromPoint === 'function') {
      try {
        for (const element of document.elementsFromPoint(event.clientX, event.clientY)) {
          addCardFor(element);
        }
      } catch (_error) {
        // Hit-testing is best-effort; fall back to the event target.
      }
    }
    if (event) addCardFor(event.target);
    for (const card of cards) {
      const found = cardLinkHref(card);
      if (found) {
        href = found;
        break;
      }
    }
    lastContextUrl = href;
    return href;
  }

  function nowMs() {
    try {
      if (typeof Date !== 'undefined' && typeof Date.now === 'function') return Date.now();
    } catch (_error) {
      // Fall through to zero when clocks are unavailable.
    }
    return 0;
  }

  function handlePress(event) {
    if (!event || event.button !== 2) return;
    const found = captureContextHref(event);
    if (found) {
      lastPointerUrl = found;
      lastPointerAt = nowMs();
    }
  }

  function handleContextMenu(event) {
    const found = captureContextHref(event);
    if (found) return;
    // YouTube may tear down or morph the hover-autoplay preview
    // between pointerdown and contextmenu: keep a just-captured
    // right-button URL for 500ms instead of clearing it.
    if (lastPointerUrl && nowMs() - lastPointerAt < 500) {
      lastContextUrl = lastPointerUrl;
    }
  }

  function handleRuntimeMessage(message, _sender, sendResponse) {
    if (message && message.type === 'ytdl-get-context-url') {
      if (typeof sendResponse === 'function') sendResponse({ url: lastContextUrl });
      return true;
    }
    return undefined;
  }

  function scheduleSync() {
    if (refreshTimer !== null && typeof clearTimeout === 'function') clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      syncControls();
    }, 80);
  }

  function main() {
    syncControls();
    document.addEventListener('yt-navigate-finish', syncControls);
    document.addEventListener('yt-page-data-updated', syncControls);
    document.addEventListener('pointerdown', handlePress, true);
    document.addEventListener('mousedown', handlePress, true);
    document.addEventListener('contextmenu', handleContextMenu, true);
    const api = ext();
    if (api && api.runtime && api.runtime.onMessage) {
      api.runtime.onMessage.addListener(handleRuntimeMessage);
    }
    if (typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(scheduleSync);
      if (document.documentElement) {
        observer.observe(document.documentElement, { childList: true, subtree: true });
      }
    }
  }

  main();
})();
