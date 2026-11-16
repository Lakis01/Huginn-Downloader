'use strict';

/* Watch-page segmented pill plus right-click context URL tracking
   for the Firefox WebExtension content script. */

(function () {
  const GROUP_SELECTOR = '[data-ytdl-controls]';
  const PLAYLIST_CARD_SELECTOR = [
    'ytd-playlist-renderer',
    'ytd-grid-playlist-renderer',
    'ytd-compact-playlist-renderer',
  ].join(', ');
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
    'ytd-playlist-renderer',
    'ytd-grid-playlist-renderer',
    'ytd-compact-playlist-renderer',
    'ytd-radio-renderer',
    'ytd-compact-radio-renderer',
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
  let lastPointerDownAt = 0;
  let refreshTimer = null;
  let activePromptUrl = null;

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

  function currentPlaylistId() {
    const loc = pageLocation();
    try {
      const url = new URL(loc.href);
      const list = url.searchParams.get('list');
      if (list && list.trim()) return list.trim();
    } catch (_error) {
      if (loc.search) {
        try {
          const list = new URLSearchParams(loc.search).get('list');
          if (list && list.trim()) return list.trim();
        } catch (_inner) {
          return null;
        }
      }
    }
    return null;
  }

  function formatPlaylistItemsSpec(indices) {
    const unique = Array.from(
      new Set(indices.filter((n) => Number.isInteger(n) && n >= 1)),
    ).sort((a, b) => a - b);
    if (!unique.length) return '';
    const ranges = [];
    let start = unique[0];
    let end = unique[0];
    for (let i = 1; i < unique.length; i += 1) {
      if (unique[i] === end + 1) {
        end = unique[i];
      } else {
        ranges.push(start === end ? String(start) : `${start}-${end}`);
        start = unique[i];
        end = unique[i];
      }
    }
    ranges.push(start === end ? String(start) : `${start}-${end}`);
    return ranges.join(',');
  }

  function parsePlaylistItemsSpec(spec, maxIndex) {
    const trimmed = typeof spec === 'string' ? spec.trim() : '';
    if (!trimmed) {
      const all = new Set();
      for (let i = 1; i <= maxIndex; i += 1) all.add(i);
      return { valid: true, all: true, indices: all, normalized: '' };
    }
    const rawParts = trimmed.split(',');
    const normalizedParts = [];
    const indices = new Set();
    for (const rawPart of rawParts) {
      const token = rawPart.trim().replace(/\s*([-:])\s*/g, '$1');
      if (!token) return { valid: false, all: false, indices: new Set(), normalized: '' };
      let match = token.match(/^(-?\d+)$/);
      if (match) {
        let idx = Number.parseInt(match[1], 10);
        if (idx === 0) return { valid: false, all: false, indices: new Set(), normalized: '' };
        if (idx < 0 && maxIndex > 0) idx = maxIndex + 1 + idx;
        if (idx >= 1 && (maxIndex <= 0 || idx <= maxIndex)) indices.add(idx);
        normalizedParts.push(token);
        continue;
      }
      match = token.match(/^(\d+)-(\d+)$/);
      if (match) {
        const a = Number.parseInt(match[1], 10);
        const b = Number.parseInt(match[2], 10);
        if (a < 1 || b < a) return { valid: false, all: false, indices: new Set(), normalized: '' };
        const upper = maxIndex > 0 ? Math.min(b, maxIndex) : b;
        for (let i = a; i <= upper; i += 1) indices.add(i);
        normalizedParts.push(token);
        continue;
      }
      match = token.match(/^(-?\d+)?:(-?\d+)?(?::(-?\d+))?$/);
      if (match && /\d/.test(token)) {
        const rawStart = match[1] !== undefined ? Number.parseInt(match[1], 10) : null;
        const rawStop = match[2] !== undefined ? Number.parseInt(match[2], 10) : null;
        const step = match[3] !== undefined ? Number.parseInt(match[3], 10) : 1;
        if (step === 0 || rawStart === 0 || rawStop === 0) {
          return { valid: false, all: false, indices: new Set(), normalized: '' };
        }
        if (maxIndex > 0) {
          let start = rawStart === null ? (step > 0 ? 1 : maxIndex) : rawStart;
          let stop = rawStop === null ? (step > 0 ? maxIndex : 1) : rawStop;
          if (start < 0) start = maxIndex + 1 + start;
          if (stop < 0) stop = maxIndex + 1 + stop;
          for (
            let i = start;
            step > 0 ? i <= stop : i >= stop;
            i += step
          ) {
            if (i >= 1 && i <= maxIndex) indices.add(i);
          }
        }
        normalizedParts.push(token);
        continue;
      }
      return { valid: false, all: false, indices: new Set(), normalized: '' };
    }
    return { valid: true, all: false, indices, normalized: normalizedParts.join(',') };
  }

  function triggerDownload(mode, options) {
    const api = ext();
    if (!api || !api.runtime) return;
    const message = {
      type: 'ytdl-trigger-download',
      mode,
      url: pageLocation().href,
    };
    if (options && typeof options.playlist === 'boolean') {
      message.playlist = options.playlist;
    }
    if (options && typeof options.playlistItems === 'string' && options.playlistItems.trim()) {
      message.playlistItems = options.playlistItems.trim();
    }
    try {
      const result = api.runtime.sendMessage(message);
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch (_error) {
      // Background may be unreachable; the menu path still applies.
    }
  }

  function markLaunching(button) {
    if (!button) return;
    button.setAttribute('data-launching', 'true');
    const reset = () => button.removeAttribute('data-launching');
    if (typeof setTimeout === 'function') setTimeout(reset, 900);
    else reset();
  }

  function closePlaylistPrompt() {
    activePromptUrl = null;
    for (const dialog of document.querySelectorAll('[data-ytdl-playlist-dialog]')) {
      dialog.remove();
    }
    for (const check of document.querySelectorAll('[data-ytdl-side-check]')) {
      check.remove();
    }
  }

  function stopInteractivePropagation(event) {
    if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
  }

  function collectPlaylistPanelItems() {
    const renderers = Array.from(document.querySelectorAll('ytd-playlist-panel-video-renderer'));
    const items = [];
    renderers.forEach((renderer, idx) => {
      let itemIndex = idx + 1;
      for (const link of renderer.querySelectorAll('a')) {
        const rawHref = link.getAttribute ? link.getAttribute('href') : link.href;
        if (!rawHref) continue;
        try {
          const url = new URL(rawHref, pageLocation().href);
          const parsedIdx = Number.parseInt(url.searchParams.get('index') || '', 10);
          if (Number.isInteger(parsedIdx) && parsedIdx > 0) {
            itemIndex = parsedIdx;
            break;
          }
        } catch (_error) {
          continue;
        }
      }
      const titleEl = renderer.querySelector('#video-title');
      const rawTitle = titleEl
        ? (titleEl.getAttribute && titleEl.getAttribute('title')) || titleEl.textContent || ''
        : '';
      const title = rawTitle.trim() || `Track ${itemIndex}`;
      items.push({ renderer, itemIndex, title });
    });
    return items;
  }

  function openPlaylistPrompt(triggerButton, mode) {
    const existing = document.querySelector('[data-ytdl-playlist-dialog]');
    if (existing && existing.getAttribute('data-ytdl-dialog-mode') === mode) {
      closePlaylistPrompt();
      return;
    }
    closePlaylistPrompt();

    const metadata = document.querySelector('ytd-watch-metadata');
    const topRow = metadata && metadata.querySelector('#top-row');
    if (!metadata || !topRow) {
      markLaunching(triggerButton);
      triggerDownload(mode);
      return;
    }

    activePromptUrl = pageLocation().href;
    const panelItems = collectPlaylistPanelItems();
    const maxIndex = panelItems.reduce((acc, item) => Math.max(acc, item.itemIndex), 0);
    const allIndices = Array.from(new Set(panelItems.map((item) => item.itemIndex))).sort((a, b) => a - b);

    const sideCheckboxes = [];
    const dialogCheckboxes = [];
    let emptySelection = false;

    const dialog = document.createElement('div');
    dialog.setAttribute('data-ytdl-playlist-dialog', 'true');
    dialog.setAttribute('data-ytdl-dialog-mode', mode);
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Playlist download options');

    const header = document.createElement('div');
    header.setAttribute('data-ytdl-dialog-header', 'true');
    const heading = document.createElement('span');
    heading.setAttribute('data-ytdl-dialog-title', 'true');
    heading.textContent = `Download ${mode}: this video or playlist?`;
    const closeBtn = document.createElement('button');
    closeBtn.setAttribute('type', 'button');
    closeBtn.setAttribute('data-ytdl-dialog-close', 'true');
    closeBtn.textContent = 'Cancel';
    closeBtn.addEventListener('click', closePlaylistPrompt);
    header.appendChild(heading);
    header.appendChild(closeBtn);
    dialog.appendChild(header);

    const actionsRow = document.createElement('div');
    actionsRow.setAttribute('data-ytdl-dialog-actions', 'true');

    const singleBtn = document.createElement('button');
    singleBtn.setAttribute('type', 'button');
    singleBtn.setAttribute('data-ytdl-scope', 'single');
    singleBtn.textContent = 'This video only';

    const playlistBtn = document.createElement('button');
    playlistBtn.setAttribute('type', 'button');
    playlistBtn.setAttribute('data-ytdl-scope', 'playlist');
    playlistBtn.textContent = 'Download playlist';

    actionsRow.appendChild(singleBtn);
    actionsRow.appendChild(playlistBtn);
    dialog.appendChild(actionsRow);

    const itemsRow = document.createElement('div');
    itemsRow.setAttribute('data-ytdl-items-row', 'true');
    const itemsLabel = document.createElement('label');
    itemsLabel.setAttribute('data-ytdl-items-label', 'true');
    itemsLabel.textContent = 'Playlist items (yt-dlp syntax):';
    const itemsInput = document.createElement('input');
    itemsInput.setAttribute('type', 'text');
    itemsInput.setAttribute('data-ytdl-playlist-items', 'true');
    itemsInput.setAttribute('placeholder', 'All items, or e.g. 1-5, 8, 10-12');
    itemsInput.setAttribute('aria-label', 'Playlist items specification');
    itemsInput.value = '';

    const selectAllBtn = document.createElement('button');
    selectAllBtn.setAttribute('type', 'button');
    selectAllBtn.setAttribute('data-ytdl-select', 'all');
    selectAllBtn.textContent = 'Select all';

    const selectNoneBtn = document.createElement('button');
    selectNoneBtn.setAttribute('type', 'button');
    selectNoneBtn.setAttribute('data-ytdl-select', 'none');
    selectNoneBtn.textContent = 'Select none';

    itemsRow.appendChild(itemsLabel);
    itemsRow.appendChild(itemsInput);
    itemsRow.appendChild(selectAllBtn);
    itemsRow.appendChild(selectNoneBtn);
    dialog.appendChild(itemsRow);

    const errorNote = document.createElement('p');
    errorNote.setAttribute('data-ytdl-playlist-error', 'true');
    errorNote.setAttribute('hidden', '');
    errorNote.hidden = true;
    dialog.appendChild(errorNote);

    const hideError = () => {
      errorNote.textContent = '';
      errorNote.hidden = true;
      errorNote.setAttribute('hidden', '');
    };
    const showError = (text) => {
      errorNote.textContent = text;
      errorNote.hidden = false;
      errorNote.removeAttribute('hidden');
    };

    const syncInputFromCheckboxes = () => {
      const checkedIndices = [];
      const seen = new Set();
      for (const box of sideCheckboxes.length ? sideCheckboxes : dialogCheckboxes) {
        const idx = Number.parseInt(box.getAttribute('data-ytdl-item-index') || '', 10);
        if (box.checked && Number.isInteger(idx) && !seen.has(idx)) {
          seen.add(idx);
          checkedIndices.push(idx);
        }
      }
      hideError();
      if (checkedIndices.length === 0) {
        emptySelection = true;
        itemsInput.value = '';
      } else if (checkedIndices.length === allIndices.length) {
        emptySelection = false;
        itemsInput.value = '';
      } else {
        emptySelection = false;
        itemsInput.value = formatPlaylistItemsSpec(checkedIndices);
      }
    };

    const setIndexChecked = (targetIdx, isChecked) => {
      for (const box of [...sideCheckboxes, ...dialogCheckboxes]) {
        const idx = Number.parseInt(box.getAttribute('data-ytdl-item-index') || '', 10);
        if (idx === targetIdx) box.checked = isChecked;
      }
    };

    const listEl = document.createElement('div');
    listEl.setAttribute('data-ytdl-playlist-list', 'true');
    const seenDialogIndices = new Set();

    for (const item of panelItems) {
      const sideLabel = document.createElement('label');
      sideLabel.setAttribute('data-ytdl-side-check', 'true');
      sideLabel.setAttribute('title', `Include item ${item.itemIndex} in playlist download`);
      const sideCheckbox = document.createElement('input');
      sideCheckbox.setAttribute('type', 'checkbox');
      sideCheckbox.setAttribute('data-ytdl-side-checkbox', 'true');
      sideCheckbox.setAttribute('data-ytdl-item-index', String(item.itemIndex));
      sideCheckbox.setAttribute('aria-label', `Include playlist item ${item.itemIndex}`);
      sideCheckbox.checked = true;
      for (const evtName of ['click', 'pointerdown', 'mousedown']) {
        sideLabel.addEventListener(evtName, stopInteractivePropagation);
        sideCheckbox.addEventListener(evtName, stopInteractivePropagation);
      }
      sideCheckbox.addEventListener('change', () => {
        setIndexChecked(item.itemIndex, Boolean(sideCheckbox.checked));
        syncInputFromCheckboxes();
      });
      sideLabel.appendChild(sideCheckbox);
      item.renderer.insertBefore(sideLabel, item.renderer.children[0] || null);
      sideCheckboxes.push(sideCheckbox);

      if (!seenDialogIndices.has(item.itemIndex)) {
        seenDialogIndices.add(item.itemIndex);
        const dialogLabel = document.createElement('label');
        dialogLabel.setAttribute('data-ytdl-dialog-item', 'true');
        const dialogCheckbox = document.createElement('input');
        dialogCheckbox.setAttribute('type', 'checkbox');
        dialogCheckbox.setAttribute('data-ytdl-dialog-checkbox', 'true');
        dialogCheckbox.setAttribute('data-ytdl-item-index', String(item.itemIndex));
        dialogCheckbox.checked = true;
        dialogCheckbox.addEventListener('change', () => {
          setIndexChecked(item.itemIndex, Boolean(dialogCheckbox.checked));
          syncInputFromCheckboxes();
        });
        const itemText = document.createElement('span');
        itemText.textContent = `${item.itemIndex}. ${item.title}`;
        dialogLabel.appendChild(dialogCheckbox);
        dialogLabel.appendChild(itemText);
        listEl.appendChild(dialogLabel);
        dialogCheckboxes.push(dialogCheckbox);
      }
    }

    if (panelItems.length > 0) {
      dialog.appendChild(listEl);
    }

    itemsInput.addEventListener('input', () => {
      emptySelection = false;
      const parsed = parsePlaylistItemsSpec(itemsInput.value, maxIndex);
      if (!parsed.valid) return;
      hideError();
      for (const box of [...sideCheckboxes, ...dialogCheckboxes]) {
        const idx = Number.parseInt(box.getAttribute('data-ytdl-item-index') || '', 10);
        box.checked = parsed.all || parsed.indices.has(idx);
      }
    });

    selectAllBtn.addEventListener('click', () => {
      emptySelection = false;
      hideError();
      for (const box of [...sideCheckboxes, ...dialogCheckboxes]) box.checked = true;
      itemsInput.value = '';
    });

    selectNoneBtn.addEventListener('click', () => {
      emptySelection = true;
      hideError();
      for (const box of [...sideCheckboxes, ...dialogCheckboxes]) box.checked = false;
      itemsInput.value = '';
    });

    singleBtn.addEventListener('click', () => {
      markLaunching(triggerButton);
      triggerDownload(mode, { playlist: false });
      closePlaylistPrompt();
    });

    playlistBtn.addEventListener('click', () => {
      const parsed = parsePlaylistItemsSpec(itemsInput.value, maxIndex);
      if (!parsed.valid) {
        showError('Invalid yt-dlp playlist syntax. Examples: 1-5, 8, 1:5:2, -3::1');
        return;
      }
      if (!itemsInput.value.trim() && emptySelection && panelItems.length > 0) {
        showError('Select at least one playlist item or enter a yt-dlp range.');
        return;
      }
      markLaunching(triggerButton);
      triggerDownload(mode, {
        playlist: true,
        playlistItems: parsed.normalized || undefined,
      });
      closePlaylistPrompt();
    });

    metadata.insertBefore(dialog, topRow.nextSibling || null);
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
        if ((action.mode === 'audio' || action.mode === 'video') && currentPlaylistId()) {
          openPlaylistPrompt(button, action.mode);
          return;
        }
        markLaunching(button);
        triggerDownload(action.mode);
      });
      group.appendChild(button);
    }
    return group;
  }

  function removeGroups() {
    closePlaylistPrompt();
    for (const group of document.querySelectorAll(GROUP_SELECTOR)) group.remove();
  }

  function syncControls() {
    if (!isWatchRoute()) {
      removeGroups();
      return;
    }
    if (activePromptUrl && activePromptUrl !== pageLocation().href) {
      closePlaylistPrompt();
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
        if (isYouTube && url.pathname === '/playlist' && url.searchParams.get('list')) {
          return url.href;
        }
      } catch (_error) {
        continue;
      }
    }
    if (card.matches && card.matches(PLAYLIST_CARD_SELECTOR)) {
      for (const link of links) {
        const rawHref = link.getAttribute ? link.getAttribute('href') : link.href;
        if (!rawHref) continue;
        try {
          const url = new URL(rawHref, pageLocation().href);
          const host = url.hostname || '';
          const isYouTube = host === 'youtube.com' || host.endsWith('.youtube.com');
          const listId = url.searchParams.get('list');
          if (isYouTube && url.pathname === '/watch' && listId) {
            return `${url.origin}/playlist?list=${encodeURIComponent(listId)}`;
          }
        } catch (_error) {
          continue;
        }
      }
    }
    for (const link of links) {
      const rawHref = link.getAttribute ? link.getAttribute('href') : link.href;
      if (!rawHref) continue;
      try {
        const url = new URL(rawHref, pageLocation().href);
        const host = url.hostname || '';
        const isYouTube = host === 'youtube.com' || host.endsWith('.youtube.com');
        if (
          isYouTube &&
          (url.pathname === '/watch' ||
            url.pathname.startsWith('/shorts/') ||
            url.pathname === '/playlist')
        ) {
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

  function handlePointerDown(event) {
    if (!event || event.button !== 2) return;
    // Start of a new right-click gesture: record even when unmatched
    // so a bare link or empty space resets any prior gesture's URL.
    const href = captureContextHref(event);
    const now = nowMs();
    lastPointerUrl = href;
    lastPointerAt = now;
    lastPointerDownAt = now;
    lastContextUrl = href;
  }

  function handleMouseDown(event) {
    if (!event || event.button !== 2) return;
    const href = captureContextHref(event);
    const now = nowMs();
    if (href === null && lastPointerUrl && now - lastPointerDownAt < 80) {
      // The preview vanished between pointerdown and mousedown for
      // this same gesture: keep the pointerdown URL instead of wiping it.
      lastContextUrl = lastPointerUrl;
      return;
    }
    lastPointerUrl = href;
    lastPointerAt = now;
    lastContextUrl = href;
  }

  function handleContextMenu(event) {
    let href = captureContextHref(event);
    if (href === null && nowMs() - lastPointerAt < 500) {
      // YouTube may tear down or morph the hover-autoplay preview
      // between pointerdown and contextmenu: reuse this gesture's
      // pointerdown URL (null when the gesture started on empty
      // space or a non-card link, so nothing stale can leak).
      href = lastPointerUrl;
    }
    lastContextUrl = href;
    lastPointerUrl = null;
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
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('mousedown', handleMouseDown, true);
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
