'use strict';

/* Watch-page segmented pill plus right-click context URL tracking
   for the WebExtension content script. */

(function () {
  const GROUP_SELECTOR = '[data-ytdl-controls]';
  const PLAYLIST_CARD_SELECTOR = [
    'ytd-playlist-renderer',
    'ytd-grid-playlist-renderer',
    'ytd-compact-playlist-renderer',
  ].join(', ');
  const PREVIEW_CARD_SELECTOR = [
    'ytd-video-preview',
    '#video-preview',
  ].join(', ');
  const PLAYLIST_ITEM_SELECTOR = [
    'ytd-playlist-panel-video-renderer',
    'ytd-playlist-video-renderer',
  ].join(', ');
  const PLAYLIST_HEADER_SELECTOR = [
    'ytd-playlist-header-renderer',
    'yt-page-header-view-model',
    '#page-header',
  ].join(', ');
  const CARD_SELECTORS = [
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
  ];
  const CARD_SELECTOR = CARD_SELECTORS.join(', ');
  const CARD_NON_PREVIEW_SELECTORS = CARD_SELECTORS.filter(
    (sel) => sel !== 'ytd-video-preview' && sel !== '#video-preview',
  );

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
  let lastContextInfo = null;
  let lastPointerUrl = null;
  let lastPointerInfo = null;
  let lastPointerAt = 0;
  let lastPointerDownAt = 0;
  let lastHoveredCard = null;
  let refreshTimer = null;
  let lastSyncedUrl = null;
  let activePromptUrl = null;
  let uiMode = 'simple';
  let showCutButton = true;
  const PENDING_SELECT_KEY = 'ytdl_pending_playlist_select';

  const CHANNEL_PATH_RE =
    /^\/(?:@[^/]+|(?:channel|c|user)\/[^/]+)(?:\/(?:videos|shorts|streams|releases|playlists|featured))?\/?$/i;
  const CHANNEL_BASE_RE =
    /^(\/(?:@[^/]+|(?:channel|c|user)\/[^/]+))(?:\/([^/?#]+))?\/?$/i;
  const DURATION_ONLY_RE = /^\d+(?::\d+)+$/;

  function ext() {
    if (typeof browser !== 'undefined' && browser) return browser;
    if (typeof chrome !== 'undefined' && chrome) return chrome;
    return null;
  }

  function pageLocation() {
    if (typeof window !== 'undefined' && window.location) return window.location;
    return location;
  }

  function isYouTubeLocation() {
    const loc = pageLocation();
    const host = loc.hostname || '';
    return host === 'youtube.com' || host.endsWith('.youtube.com');
  }

  function isWatchRoute() {
    const loc = pageLocation();
    const path = loc.pathname || '';
    return (
      isYouTubeLocation() &&
      (path === '/watch' || path.startsWith('/shorts/') || path.startsWith('/live/'))
    );
  }

  function isChannelRoute() {
    const loc = pageLocation();
    const path = loc.pathname || '';
    return isYouTubeLocation() && CHANNEL_PATH_RE.test(path);
  }

  function isPlaylistRoute() {
    const loc = pageLocation();
    const path = loc.pathname || '';
    return isYouTubeLocation() && path === '/playlist' && Boolean(currentPlaylistId());
  }

  function channelVideosRedirectUrl() {
    if (!isChannelRoute()) return null;
    const loc = pageLocation();
    const match = (loc.pathname || '').match(CHANNEL_BASE_RE);
    if (!match) return null;
    const tab = (match[2] || '').toLowerCase();
    if (tab === 'videos' || tab === 'shorts' || tab === 'streams') return null;
    const origin = loc.origin || 'https://www.youtube.com';
    return `${origin}${match[1]}/videos`;
  }

  function isHiddenRenderer(el) {
    if (!el) return true;
    if (el.hidden === true) return true;
    if (el.closest && el.closest('[hidden]')) return true;
    return false;
  }

  function queryVisibleAll(selector) {
    return Array.from(document.querySelectorAll(selector)).filter((el) => !isHiddenRenderer(el));
  }

  function queryVisibleFirst(selector) {
    const all = queryVisibleAll(selector);
    return all.length > 0 ? all[0] : null;
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
    dispatchOrPromptAdvancedDownload(mode, pageLocation().href, options);
  }

  function markLaunching(button) {
    if (!button) return;
    button.setAttribute('data-launching', 'true');
    const reset = () => button.removeAttribute('data-launching');
    if (typeof setTimeout === 'function') setTimeout(reset, 900);
    else reset();
  }

  function setCutButtonsHidden(isHidden) {
    const effectiveHidden = Boolean(isHidden) || !showCutButton;
    for (const cutBtn of document.querySelectorAll('[data-ytdl-mode="cut"]')) {
      cutBtn.hidden = effectiveHidden;
      if (effectiveHidden) {
        cutBtn.setAttribute('hidden', '');
      } else {
        cutBtn.removeAttribute('hidden');
      }
    }
  }

  function closePlaylistPrompt() {
    activePromptUrl = null;
    setCutButtonsHidden(false);
    for (const dialog of document.querySelectorAll('[data-ytdl-playlist-dialog]')) {
      dialog.remove();
    }
    for (const bar of document.querySelectorAll('[data-ytdl-panel-bar]')) {
      bar.remove();
    }
    for (const check of document.querySelectorAll('[data-ytdl-side-check]')) {
      check.remove();
    }
  }

  function stopInteractivePropagation(event) {
    if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
  }

  function extractRendererTitle(renderer, fallbackIndex) {
    const titleEl = renderer.querySelector('#video-title');
    if (titleEl) {
      const text = (titleEl.getAttribute && titleEl.getAttribute('title')) || titleEl.textContent || '';
      if (text.trim()) return text.trim();
    }
    for (const link of renderer.querySelectorAll('a')) {
      const candidates = [
        link.getAttribute ? link.getAttribute('title') : '',
        link.getAttribute ? link.getAttribute('aria-label') : '',
        link.textContent || '',
      ];
      for (const candidate of candidates) {
        const trimmed = (candidate || '').trim();
        if (!trimmed) continue;
        if (DURATION_ONLY_RE.test(trimmed)) continue;
        if (/^now playing$/i.test(trimmed)) continue;
        return trimmed;
      }
    }
    return `Track ${fallbackIndex}`;
  }

  function hasMediaLink(renderer) {
    for (const link of renderer.querySelectorAll('a')) {
      const rawHref = link.getAttribute ? link.getAttribute('href') : link.href;
      if (!rawHref) continue;
      try {
        const url = new URL(rawHref, pageLocation().href);
        if (url.pathname === '/watch' || url.pathname.startsWith('/shorts/') || url.pathname === '/playlist') {
          return true;
        }
      } catch (_error) {
        continue;
      }
    }
    return false;
  }

  function isExcludedPlaylistNode(el) {
    if (!el || !el.closest) return false;
    return Boolean(
      el.closest('yt-page-header-renderer') ||
      el.closest('yt-page-header-view-model') ||
      el.closest('ytd-playlist-header-renderer') ||
      el.closest('ytd-miniplayer') ||
      el.closest('[data-ytdl-playlist-dialog]'),
    );
  }

  function queryVisibleInRoot(root, selector) {
    const scope = root || document;
    return Array.from(scope.querySelectorAll(selector)).filter((el) => !isHiddenRenderer(el));
  }

  function collectPlaylistPanelItems() {
    let sourceKind = 'playlist-panel';
    let renderers = [];
    if (isChannelRoute()) {
      sourceKind = 'channel-grid';
      for (const selector of [
        'ytd-rich-item-renderer',
        'ytd-grid-video-renderer',
        'ytd-video-renderer',
        'yt-lockup-view-model',
      ]) {
        const candidates = queryVisibleAll(selector).filter(
          (el) => !isExcludedPlaylistNode(el) && hasMediaLink(el),
        );
        if (candidates.length > 0) {
          renderers = candidates;
          break;
        }
      }
    } else if (isPlaylistRoute()) {
      const browseRoot = queryVisibleFirst('ytd-browse');
      sourceKind = 'playlist-list';
      renderers = queryVisibleInRoot(browseRoot, 'ytd-playlist-video-renderer');
      if (renderers.length === 0) {
        sourceKind = 'playlist-lockup';
        for (const selector of [
          'yt-lockup-view-model',
          'ytd-rich-item-renderer',
          'ytd-grid-video-renderer',
          'ytd-video-renderer',
        ]) {
          const candidates = queryVisibleInRoot(browseRoot, selector).filter(
            (el) => !isExcludedPlaylistNode(el) && hasMediaLink(el),
          );
          if (candidates.length > 0) {
            renderers = candidates;
            break;
          }
        }
      }
      if (renderers.length === 0) {
        sourceKind = 'playlist-panel';
        renderers = queryVisibleAll('ytd-playlist-panel-video-renderer');
      }
    } else {
      renderers = queryVisibleAll('ytd-playlist-panel-video-renderer');
      if (renderers.length === 0) {
        sourceKind = 'playlist-list';
        renderers = queryVisibleAll('ytd-playlist-video-renderer');
      }
    }
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
      const title = extractRendererTitle(renderer, itemIndex);
      items.push({
        renderer,
        itemIndex,
        title,
        isGridCard: sourceKind === 'channel-grid' || sourceKind === 'playlist-lockup',
      });
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

    const metadata = queryVisibleFirst('ytd-watch-metadata');
    const topRow = metadata && metadata.querySelector('#top-row');
    const panelItems = collectPlaylistPanelItems();
    const canAttachWatchDialog = Boolean(isWatchRoute() && metadata && topRow);
    if (!canAttachWatchDialog && panelItems.length === 0) {
      if (isChannelRoute() || isPlaylistRoute()) {
        writePendingPlaylistSelect(mode, currentPlaylistId(), { channelVideos: isChannelRoute() });
      } else {
        markLaunching(triggerButton);
        triggerDownload(mode);
        return;
      }
    }

    activePromptUrl = pageLocation().href;
    setCutButtonsHidden(true);

    const maxIndex = panelItems.reduce((acc, item) => Math.max(acc, item.itemIndex), 0);
    const allIndices = Array.from(new Set(panelItems.map((item) => item.itemIndex))).sort((a, b) => a - b);

    const sideCheckboxes = [];
    const dialogCheckboxes = [];
    const detailsToggleButtons = [];
    let detailsExpanded = false;
    let emptySelection = false;
    let panelBar = null;
    let panelDownloadBtn = null;
    let footerSubmitBtn = null;

    const dialog = document.createElement('div');
    dialog.setAttribute('data-ytdl-playlist-dialog', 'true');
    dialog.setAttribute('data-ytdl-dialog-mode', mode);
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Playlist download options');

    const header = document.createElement('div');
    header.setAttribute('data-ytdl-dialog-header', 'true');
    const heading = document.createElement('span');
    heading.setAttribute('data-ytdl-dialog-title', 'true');
    if (isChannelRoute()) {
      heading.textContent = `Download channel ${mode}: select videos`;
    } else if (isPlaylistRoute()) {
      heading.textContent = `Download playlist ${mode}: select items`;
    } else {
      heading.textContent = `Download ${mode}: this video or playlist?`;
    }
    const closeBtn = document.createElement('button');
    closeBtn.setAttribute('type', 'button');
    closeBtn.setAttribute('data-ytdl-dialog-close', 'true');
    closeBtn.textContent = 'Cancel';
    closeBtn.addEventListener('click', () => {
      clearPendingPlaylistSelect();
      closePlaylistPrompt();
    });
    header.appendChild(heading);
    header.appendChild(closeBtn);
    dialog.appendChild(header);

    if (panelItems.length === 0 && (isChannelRoute() || isPlaylistRoute())) {
      const waitNote = document.createElement('p');
      waitNote.setAttribute('data-ytdl-wait-note', 'true');
      waitNote.textContent = isChannelRoute()
        ? 'Loading channel video checkboxes... You can also enter a yt-dlp range below or click Download channel.'
        : 'Loading playlist item checkboxes... You can also enter a yt-dlp range below or click Download playlist.';
      dialog.appendChild(waitNote);
    }

    const actionsRow = document.createElement('div');
    actionsRow.setAttribute('data-ytdl-dialog-actions', 'true');

    const singleBtn = document.createElement('button');
    singleBtn.setAttribute('type', 'button');
    singleBtn.setAttribute('data-ytdl-scope', 'single');
    singleBtn.textContent = 'This video only';

    const playlistBtn = document.createElement('button');
    playlistBtn.setAttribute('type', 'button');
    playlistBtn.setAttribute('data-ytdl-scope', 'playlist');

    const dialogDetailsBtn = document.createElement('button');
    dialogDetailsBtn.setAttribute('type', 'button');
    dialogDetailsBtn.setAttribute('data-ytdl-details-toggle', 'true');
    dialogDetailsBtn.setAttribute('aria-expanded', 'false');
    dialogDetailsBtn.setAttribute('data-expanded', 'false');
    dialogDetailsBtn.textContent = 'Range & list';
    detailsToggleButtons.push(dialogDetailsBtn);

    if (canAttachWatchDialog && isWatchRoute()) {
      actionsRow.appendChild(singleBtn);
    }
    actionsRow.appendChild(playlistBtn);
    actionsRow.appendChild(dialogDetailsBtn);
    dialog.appendChild(actionsRow);

    const detailsEl = document.createElement('div');
    detailsEl.setAttribute('data-ytdl-playlist-details', 'true');
    detailsEl.setAttribute('hidden', '');
    detailsEl.hidden = true;

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
    selectNoneBtn.textContent = 'Deselect all';

    itemsRow.appendChild(itemsLabel);
    itemsRow.appendChild(itemsInput);
    itemsRow.appendChild(selectAllBtn);
    itemsRow.appendChild(selectNoneBtn);
    detailsEl.appendChild(itemsRow);
    dialog.appendChild(detailsEl);

    const errorNote = document.createElement('p');
    errorNote.setAttribute('data-ytdl-playlist-error', 'true');
    errorNote.setAttribute('hidden', '');
    errorNote.hidden = true;
    dialog.appendChild(errorNote);

    const toggleDetails = () => {
      detailsExpanded = !detailsExpanded;
      detailsEl.hidden = !detailsExpanded;
      if (detailsExpanded) {
        detailsEl.removeAttribute('hidden');
      } else {
        detailsEl.setAttribute('hidden', '');
      }
      for (const btn of detailsToggleButtons) {
        btn.setAttribute('aria-expanded', detailsExpanded ? 'true' : 'false');
        btn.setAttribute('data-expanded', detailsExpanded ? 'true' : 'false');
      }
    };
    dialogDetailsBtn.addEventListener('click', toggleDetails);

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

    const getCheckedCount = () => {
      const boxes = sideCheckboxes.length ? sideCheckboxes : dialogCheckboxes;
      const seen = new Set();
      for (const box of boxes) {
        const idx = Number.parseInt(box.getAttribute('data-ytdl-item-index') || '', 10);
        if (box.checked && Number.isInteger(idx)) seen.add(idx);
      }
      return seen.size;
    };

    const updateDownloadButtonLabels = () => {
      const modeLabel = mode === 'audio' ? 'audio' : 'video';
      const totalCount = allIndices.length;
      const checkedCount = getCheckedCount();
      let labelText;
      if (totalCount === 0) {
        if (itemsInput.value.trim()) {
          labelText = `Download selected (${modeLabel})`;
        } else if (isChannelRoute()) {
          labelText = `Download channel (${modeLabel})`;
        } else {
          labelText = `Download playlist (${modeLabel})`;
        }
      } else if (checkedCount === totalCount) {
        labelText = `Download all ${totalCount} (${modeLabel})`;
      } else if (checkedCount > 0) {
        labelText = `Download ${checkedCount} selected (${modeLabel})`;
      } else {
        labelText = `Select items (${modeLabel})`;
      }
      playlistBtn.textContent = labelText;
      if (footerSubmitBtn) footerSubmitBtn.textContent = labelText;
      if (panelDownloadBtn) panelDownloadBtn.textContent = labelText;
    };

    const syncLabelCheckedAttrs = () => {
      for (const box of [...sideCheckboxes, ...dialogCheckboxes]) {
        if (box.parentNode && typeof box.parentNode.setAttribute === 'function') {
          box.parentNode.setAttribute('data-checked', box.checked ? 'true' : 'false');
        }
      }
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
      syncLabelCheckedAttrs();
      updateDownloadButtonLabels();
    };

    const setIndexChecked = (targetIdx, isChecked) => {
      for (const box of [...sideCheckboxes, ...dialogCheckboxes]) {
        const idx = Number.parseInt(box.getAttribute('data-ytdl-item-index') || '', 10);
        if (idx === targetIdx) box.checked = isChecked;
      }
      syncLabelCheckedAttrs();
    };

    const handleSelectAll = () => {
      emptySelection = false;
      hideError();
      for (const box of [...sideCheckboxes, ...dialogCheckboxes]) box.checked = true;
      itemsInput.value = '';
      syncLabelCheckedAttrs();
      updateDownloadButtonLabels();
    };

    const handleDeselectAll = () => {
      emptySelection = true;
      hideError();
      for (const box of [...sideCheckboxes, ...dialogCheckboxes]) box.checked = false;
      itemsInput.value = '';
      syncLabelCheckedAttrs();
      updateDownloadButtonLabels();
    };

    const handlePlaylistSubmit = () => {
      const parsed = parsePlaylistItemsSpec(itemsInput.value, maxIndex);
      if (!parsed.valid) {
        if (!detailsExpanded) toggleDetails();
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
    };

    const listEl = document.createElement('div');
    listEl.setAttribute('data-ytdl-playlist-list', 'true');
    const seenDialogIndices = new Set();

    if (panelItems.length > 0 && panelItems[0].renderer && panelItems[0].renderer.parentNode) {
      panelBar = document.createElement('div');
      panelBar.setAttribute('data-ytdl-panel-bar', 'true');
      for (const evtName of ['click', 'pointerdown', 'mousedown']) {
        panelBar.addEventListener(evtName, stopInteractivePropagation);
      }

      const panelTop = document.createElement('div');
      panelTop.setAttribute('data-ytdl-panel-top', 'true');

      const panelTitle = document.createElement('span');
      panelTitle.setAttribute('data-ytdl-panel-title', 'true');
      panelTitle.textContent = `Huginn batch (${mode})`;

      const panelActions = document.createElement('div');
      panelActions.setAttribute('data-ytdl-panel-actions', 'true');

      const panelSelectAllBtn = document.createElement('button');
      panelSelectAllBtn.setAttribute('type', 'button');
      panelSelectAllBtn.setAttribute('data-ytdl-panel-select', 'all');
      panelSelectAllBtn.textContent = 'Select all';
      panelSelectAllBtn.addEventListener('click', (evt) => {
        stopInteractivePropagation(evt);
        handleSelectAll();
      });

      const panelDeselectAllBtn = document.createElement('button');
      panelDeselectAllBtn.setAttribute('type', 'button');
      panelDeselectAllBtn.setAttribute('data-ytdl-panel-select', 'none');
      panelDeselectAllBtn.textContent = 'Deselect all';
      panelDeselectAllBtn.addEventListener('click', (evt) => {
        stopInteractivePropagation(evt);
        handleDeselectAll();
      });

      const panelDetailsBtn = document.createElement('button');
      panelDetailsBtn.setAttribute('type', 'button');
      panelDetailsBtn.setAttribute('data-ytdl-details-toggle', 'true');
      panelDetailsBtn.setAttribute('aria-expanded', 'false');
      panelDetailsBtn.setAttribute('data-expanded', 'false');
      panelDetailsBtn.textContent = 'Range & list';
      panelDetailsBtn.addEventListener('click', (evt) => {
        stopInteractivePropagation(evt);
        toggleDetails();
      });
      detailsToggleButtons.push(panelDetailsBtn);

      panelDownloadBtn = document.createElement('button');
      panelDownloadBtn.setAttribute('type', 'button');
      panelDownloadBtn.setAttribute('data-ytdl-panel-download', 'true');
      panelDownloadBtn.addEventListener('click', (evt) => {
        stopInteractivePropagation(evt);
        handlePlaylistSubmit();
      });

      const panelCloseBtn = document.createElement('button');
      panelCloseBtn.setAttribute('type', 'button');
      panelCloseBtn.setAttribute('data-ytdl-panel-close', 'true');
      panelCloseBtn.textContent = 'Cancel';
      panelCloseBtn.addEventListener('click', (evt) => {
        stopInteractivePropagation(evt);
        clearPendingPlaylistSelect();
        closePlaylistPrompt();
      });

      panelActions.appendChild(panelSelectAllBtn);
      panelActions.appendChild(panelDeselectAllBtn);
      panelActions.appendChild(panelDetailsBtn);
      panelActions.appendChild(panelDownloadBtn);
      panelActions.appendChild(panelCloseBtn);

      panelTop.appendChild(panelTitle);
      panelTop.appendChild(panelActions);
      panelBar.appendChild(panelTop);

      const firstParent = panelItems[0].renderer.parentNode;
      if (
        firstParent.parentNode &&
        (firstParent.tagName === 'YTD-RICH-GRID-ROW' ||
          (firstParent.parentNode.id === 'contents' && firstParent.id !== 'contents'))
      ) {
        firstParent.parentNode.insertBefore(panelBar, firstParent);
      } else {
        firstParent.insertBefore(panelBar, panelItems[0].renderer);
      }
    }

    for (const item of panelItems) {
      const sideLabel = document.createElement('label');
      sideLabel.setAttribute('data-ytdl-side-check', 'true');
      sideLabel.setAttribute('data-checked', 'true');
      if (item.isGridCard) sideLabel.setAttribute('data-ytdl-channel-check', 'true');
      sideLabel.setAttribute('title', `Include item ${item.itemIndex} in batch download`);
      const sideCheckbox = document.createElement('input');
      sideCheckbox.setAttribute('type', 'checkbox');
      sideCheckbox.setAttribute('data-ytdl-side-checkbox', 'true');
      sideCheckbox.setAttribute('data-ytdl-item-index', String(item.itemIndex));
      sideCheckbox.setAttribute('aria-label', `Include item ${item.itemIndex}`);
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
      if (item.isGridCard) {
        const badgeText = document.createElement('span');
        badgeText.textContent = `#${item.itemIndex}`;
        sideLabel.appendChild(badgeText);
      }
      item.renderer.insertBefore(sideLabel, item.renderer.children[0] || null);
      sideCheckboxes.push(sideCheckbox);

      if (!seenDialogIndices.has(item.itemIndex)) {
        seenDialogIndices.add(item.itemIndex);
        const dialogLabel = document.createElement('label');
        dialogLabel.setAttribute('data-ytdl-dialog-item', 'true');
        dialogLabel.setAttribute('data-checked', 'true');
        dialogLabel.setAttribute('title', `${item.itemIndex}. ${item.title}`);
        const dialogCheckbox = document.createElement('input');
        dialogCheckbox.setAttribute('type', 'checkbox');
        dialogCheckbox.setAttribute('data-ytdl-dialog-checkbox', 'true');
        dialogCheckbox.setAttribute('data-ytdl-item-index', String(item.itemIndex));
        dialogCheckbox.checked = true;
        dialogCheckbox.addEventListener('change', () => {
          setIndexChecked(item.itemIndex, Boolean(dialogCheckbox.checked));
          syncInputFromCheckboxes();
        });
        const itemNum = document.createElement('span');
        itemNum.setAttribute('data-ytdl-item-num', 'true');
        itemNum.textContent = `#${item.itemIndex}`;
        const itemText = document.createElement('span');
        itemText.setAttribute('data-ytdl-item-title', 'true');
        itemText.textContent = item.title;
        dialogLabel.appendChild(dialogCheckbox);
        dialogLabel.appendChild(itemNum);
        dialogLabel.appendChild(itemText);
        listEl.appendChild(dialogLabel);
        dialogCheckboxes.push(dialogCheckbox);
      }
    }

    if (panelItems.length > 0) {
      detailsEl.appendChild(listEl);
      const footer = document.createElement('div');
      footer.setAttribute('data-ytdl-dialog-footer', 'true');
      footerSubmitBtn = document.createElement('button');
      footerSubmitBtn.setAttribute('type', 'button');
      footerSubmitBtn.setAttribute('data-ytdl-scope', 'playlist-submit');
      footerSubmitBtn.addEventListener('click', handlePlaylistSubmit);
      footer.appendChild(footerSubmitBtn);
      detailsEl.appendChild(footer);
    }

    itemsInput.addEventListener('input', () => {
      emptySelection = false;
      const parsed = parsePlaylistItemsSpec(itemsInput.value, maxIndex);
      if (!parsed.valid) {
        updateDownloadButtonLabels();
        return;
      }
      hideError();
      for (const box of [...sideCheckboxes, ...dialogCheckboxes]) {
        const idx = Number.parseInt(box.getAttribute('data-ytdl-item-index') || '', 10);
        box.checked = parsed.all || parsed.indices.has(idx);
      }
      syncLabelCheckedAttrs();
      updateDownloadButtonLabels();
    });

    selectAllBtn.addEventListener('click', handleSelectAll);
    selectNoneBtn.addEventListener('click', handleDeselectAll);

    singleBtn.addEventListener('click', () => {
      markLaunching(triggerButton);
      triggerDownload(mode, { playlist: false });
      closePlaylistPrompt();
    });

    playlistBtn.addEventListener('click', handlePlaylistSubmit);

    updateDownloadButtonLabels();

    if (canAttachWatchDialog) {
      metadata.insertBefore(dialog, topRow.nextSibling || null);
    } else if (panelBar) {
      dialog.setAttribute('data-ytdl-dialog-embedded', 'true');
      header.hidden = true;
      header.setAttribute('hidden', '');
      actionsRow.hidden = true;
      actionsRow.setAttribute('hidden', '');
      panelBar.appendChild(dialog);
    } else {
      dialog.setAttribute('data-ytdl-dialog-floating', 'true');
      const host = document.body || document.documentElement;
      if (host) host.appendChild(dialog);
    }
  }

  function makeGroup(options) {
    const includeCut = !options || options.includeCut !== false;
    const actionModes = includeCut ? MODES : MODES.filter((item) => item.mode !== 'cut');
    const group = document.createElement('div');
    group.setAttribute('data-ytdl-controls', 'true');
    if (!includeCut) {
      group.setAttribute('data-ytdl-batch-controls', 'true');
    }
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'yt-dlp actions');
    for (const action of actionModes) {
      const button = document.createElement('button');
      button.setAttribute('type', 'button');
      button.setAttribute('data-ytdl-mode', action.mode);
      button.setAttribute('aria-label', action.aria);
      button.setAttribute('title', action.aria);
      if (action.mode === 'cut' && !showCutButton) {
        button.hidden = true;
        button.setAttribute('hidden', '');
      }
      button.appendChild(makeIcon(action.icon));
      const label = document.createElement('span');
      label.textContent = action.label;
      button.appendChild(label);
      button.addEventListener('click', () => {
        if (
          (action.mode === 'audio' || action.mode === 'video') &&
          (currentPlaylistId() || isChannelRoute() || isPlaylistRoute())
        ) {
          const videosUrl = channelVideosRedirectUrl();
          if (videosUrl) {
            writePendingPlaylistSelect(action.mode, null, { channelVideos: true });
            pageLocation().href = videosUrl;
            return;
          }
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

  function findTriggerButton(mode) {
    const controls = document.querySelector(GROUP_SELECTOR);
    if (!controls) return null;
    for (const btn of controls.querySelectorAll('button')) {
      if (btn.getAttribute && btn.getAttribute('data-ytdl-mode') === mode) return btn;
    }
    return null;
  }

  function hasPendingPlaylistSelect() {
    try {
      if (typeof sessionStorage === 'undefined' || !sessionStorage) return false;
      return Boolean(sessionStorage.getItem(PENDING_SELECT_KEY));
    } catch (_error) {
      return false;
    }
  }

  function clearPendingPlaylistSelect() {
    try {
      if (typeof sessionStorage !== 'undefined' && sessionStorage) {
        sessionStorage.removeItem(PENDING_SELECT_KEY);
      }
    } catch (_error) {
      // Ignore storage failures.
    }
  }

  function writePendingPlaylistSelect(mode, playlistId, options) {
    try {
      if (typeof sessionStorage === 'undefined' || !sessionStorage) return;
      sessionStorage.setItem(
        PENDING_SELECT_KEY,
        JSON.stringify({
          mode,
          playlistId: playlistId || null,
          channelVideos: Boolean(options && options.channelVideos),
          createdAt: nowMs(),
        }),
      );
    } catch (_error) {
      // sessionStorage may be restricted in isolated environments.
    }
  }

  function maybeResumePendingPlaylistSelect() {
    const existingDialog = document.querySelector('[data-ytdl-playlist-dialog]');
    if (
      existingDialog &&
      existingDialog.querySelector('[data-ytdl-dialog-item]') &&
      document.querySelectorAll('[data-ytdl-side-check]').length > 0
    ) {
      return;
    }
    try {
      if (typeof sessionStorage === 'undefined' || !sessionStorage) return;
      const raw = sessionStorage.getItem(PENDING_SELECT_KEY);
      if (!raw) return;
      const pending = JSON.parse(raw);
      if (!pending || (pending.mode !== 'audio' && pending.mode !== 'video')) {
        sessionStorage.removeItem(PENDING_SELECT_KEY);
        return;
      }
      const now = nowMs();
      if (pending.createdAt > 0 && now > 0 && now - pending.createdAt > 30000) {
        sessionStorage.removeItem(PENDING_SELECT_KEY);
        return;
      }
      const curList = currentPlaylistId();
      if (pending.playlistId && curList !== pending.playlistId) return;
      if (pending.channelVideos && !isChannelRoute()) return;
      if (collectPlaylistPanelItems().length === 0) return;
      sessionStorage.removeItem(PENDING_SELECT_KEY);
      if (existingDialog) closePlaylistPrompt();
      openPlaylistPrompt(findTriggerButton(pending.mode), pending.mode);
    } catch (_error) {
      // Ignore storage parsing failures.
    }
  }

  function removeGroups(preserveActivePrompt) {
    if (!preserveActivePrompt) closePlaylistPrompt();
    for (const group of document.querySelectorAll(GROUP_SELECTOR)) group.remove();
  }

  function findBatchControlsHost() {
    return (
      queryVisibleFirst('yt-flexible-actions-view-model') ||
      queryVisibleFirst('ytd-playlist-header-renderer') ||
      queryVisibleFirst('yt-page-header-view-model') ||
      queryVisibleFirst('#page-header') ||
      queryVisibleFirst('#tabs-inner-container') ||
      queryVisibleFirst('ytd-rich-grid-renderer')
    );
  }

  function areControlsMountedForRoute() {
    if (isWatchRoute()) {
      const metadata = queryVisibleFirst('ytd-watch-metadata');
      const topRow = metadata && metadata.querySelector('#top-row');
      return Boolean(topRow && topRow.querySelector(GROUP_SELECTOR));
    }
    if (isChannelRoute() || isPlaylistRoute()) {
      const host = findBatchControlsHost();
      return Boolean(host && host.querySelector('[data-ytdl-batch-controls]'));
    }
    return !document.querySelector(GROUP_SELECTOR);
  }

  function syncControls() {
    const currentHref = pageLocation().href;
    if (activePromptUrl && activePromptUrl !== currentHref) {
      closePlaylistPrompt();
    }
    if (isWatchRoute()) {
      const metadata = queryVisibleFirst('ytd-watch-metadata');
      const topRow = metadata && metadata.querySelector('#top-row');
      const owner = topRow && topRow.querySelector('#owner');
      const actions = topRow && topRow.querySelector('#actions');
      if (!topRow || !owner || !actions) {
        maybeResumePendingPlaylistSelect();
        return;
      }
      const groups = Array.from(document.querySelectorAll(GROUP_SELECTOR));
      const mounted = groups.find(
        (group) => group.parentNode === topRow && !group.hasAttribute('data-ytdl-batch-controls'),
      );
      for (const group of groups) {
        if (group !== mounted) group.remove();
      }
      if (mounted) {
        const children = Array.from(topRow.children);
        if (children[children.indexOf(mounted) + 1] !== actions) {
          topRow.insertBefore(mounted, actions);
        }
        setCutButtonsHidden(Boolean(document.querySelector('[data-ytdl-playlist-dialog]')));
        lastSyncedUrl = currentHref;
        maybeResumePendingPlaylistSelect();
        return;
      }
      topRow.insertBefore(makeGroup({ includeCut: true }), actions);
      lastSyncedUrl = currentHref;
      maybeResumePendingPlaylistSelect();
      return;
    }

    if (isChannelRoute() || isPlaylistRoute()) {
      const host = findBatchControlsHost();
      if (host) {
        const groups = Array.from(document.querySelectorAll(GROUP_SELECTOR));
        const mounted = groups.find(
          (group) => group.parentNode === host && group.hasAttribute('data-ytdl-batch-controls'),
        );
        for (const group of groups) {
          if (group !== mounted) group.remove();
        }
        if (!mounted) {
          const group = makeGroup({ includeCut: false });
          if (
            host.matches &&
            (host.matches('ytd-rich-grid-renderer') || host.matches('#tabs-inner-container'))
          ) {
            host.insertBefore(group, host.children[0] || null);
          } else {
            host.appendChild(group);
          }
        }
        lastSyncedUrl = currentHref;
      }
      maybeResumePendingPlaylistSelect();
      return;
    }

    const keepPrompt = Boolean(activePromptUrl && activePromptUrl === currentHref);
    removeGroups(keepPrompt);
    lastSyncedUrl = currentHref;
    maybeResumePendingPlaylistSelect();
  }

  function extractWatchVideoId(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const url = new URL(value, pageLocation().href);
      if (url.pathname === '/watch') {
        const videoId = url.searchParams.get('v');
        return videoId && videoId.trim() ? videoId.trim() : null;
      }
    } catch (_error) {
      return null;
    }
    return null;
  }

  function stripPlaylistParams(rawUrl) {
    if (typeof rawUrl !== 'string' || !rawUrl) return rawUrl;
    try {
      const url = new URL(rawUrl, pageLocation().href);
      url.searchParams.delete('list');
      url.searchParams.delete('index');
      url.searchParams.delete('start_radio');
      return url.href;
    } catch (_error) {
      return rawUrl;
    }
  }

  function isPreviewCard(card) {
    return Boolean(card && card.matches && card.matches(PREVIEW_CARD_SELECTOR));
  }

  function inspectCardContext(card) {
    const links = card.querySelectorAll('a');
    let explicitPlaylistUrl = null;
    let explicitListId = null;
    let watchWithListUrl = null;
    let watchListId = null;
    let watchUrl = null;
    let shortsUrl = null;
    let origin = null;

    for (const link of links) {
      const rawHref = link.getAttribute ? link.getAttribute('href') : link.href;
      if (!rawHref) continue;
      try {
        const url = new URL(rawHref, pageLocation().href);
        const host = url.hostname || '';
        const isYouTube = host === 'youtube.com' || host.endsWith('.youtube.com');
        if (!isYouTube) continue;
        if (!origin) origin = url.origin;
        const rawList = url.searchParams.get('list');
        const listId = rawList ? rawList.trim() : '';
        if (url.pathname === '/playlist' && listId && !explicitPlaylistUrl) {
          explicitPlaylistUrl = url.href;
          explicitListId = listId;
        } else if (url.pathname === '/watch') {
          if (!watchUrl) watchUrl = url.href;
          if (listId && !watchWithListUrl) {
            watchWithListUrl = url.href;
            watchListId = listId;
          }
        } else if (url.pathname.startsWith('/shorts/') && !shortsUrl) {
          shortsUrl = url.href;
        }
      } catch (_error) {
        continue;
      }
    }

    const inPlaylistContainer = Boolean(
      isPlaylistRoute() ||
      (card.matches && card.matches(PLAYLIST_ITEM_SELECTOR)) ||
      (card.closest &&
        card.closest('ytd-playlist-panel-renderer, ytd-playlist-video-list-renderer, ytmusic-playlist-shelf-renderer')),
    );
    const isPlaylistCard = Boolean(card.matches && card.matches(PLAYLIST_CARD_SELECTOR));
    if (inPlaylistContainer && !isPlaylistCard && !isExcludedPlaylistNode(card) && !explicitPlaylistUrl) {
      const rawTrackUrl = watchWithListUrl || watchUrl || shortsUrl || null;
      const trackUrl = rawTrackUrl ? stripPlaylistParams(rawTrackUrl) : null;
      return trackUrl
        ? {
            url: trackUrl,
            isPlaylist: false,
            playlistId: null,
            playlistUrl: null,
            topVideoUrl: trackUrl,
            singleItem: true,
          }
        : null;
    }

    if (explicitPlaylistUrl) {
      return {
        url: explicitPlaylistUrl,
        isPlaylist: true,
        playlistId: explicitListId,
        playlistUrl: explicitPlaylistUrl,
        topVideoUrl: watchWithListUrl || watchUrl || null,
      };
    }

    if (card.matches && card.matches(PLAYLIST_CARD_SELECTOR) && watchWithListUrl && watchListId) {
      const playlistUrl = `${origin || 'https://www.youtube.com'}/playlist?list=${encodeURIComponent(watchListId)}`;
      return {
        url: playlistUrl,
        isPlaylist: true,
        playlistId: watchListId,
        playlistUrl,
        topVideoUrl: watchWithListUrl,
      };
    }

    if (watchWithListUrl && watchListId) {
      const isMix = watchListId.startsWith('RD');
      const canonicalPlaylistUrl = isMix
        ? watchWithListUrl
        : `${origin || 'https://www.youtube.com'}/playlist?list=${encodeURIComponent(watchListId)}`;
      return {
        url: isPreviewCard(card) ? watchWithListUrl : canonicalPlaylistUrl,
        isPlaylist: true,
        playlistId: watchListId,
        playlistUrl: canonicalPlaylistUrl,
        topVideoUrl: watchWithListUrl,
      };
    }

    const singleUrl = watchUrl || shortsUrl;
    if (singleUrl) {
      return {
        url: singleUrl,
        isPlaylist: false,
        playlistId: null,
        playlistUrl: null,
        topVideoUrl: singleUrl,
      };
    }
    return null;
  }

  function findCardsUnderCoordinates(clientX, clientY) {
    if (typeof clientX !== 'number' || typeof clientY !== 'number') return [];
    const matched = [];
    for (const selector of CARD_NON_PREVIEW_SELECTORS) {
      for (const el of document.querySelectorAll(selector)) {
        if (matched.includes(el) || typeof el.getBoundingClientRect !== 'function') continue;
        try {
          const rect = el.getBoundingClientRect();
          if (
            rect &&
            rect.width > 0 &&
            rect.height > 0 &&
            clientX >= rect.left - 16 &&
            clientX <= rect.right + 16 &&
            clientY >= rect.top - 16 &&
            clientY <= rect.bottom + 16
          ) {
            matched.push(el);
          }
        } catch (_error) {
          continue;
        }
      }
    }
    return matched;
  }

  function captureContextInfo(event) {
    // No card match means no context URL (null): the background then
    // falls back to the menu linkUrl/pageUrl targets instead of the
    // current page, so right-clicking a bare YouTube link never
    // downloads the page behind it.
    let info = null;
    const cards = [];
    const addCard = (card) => {
      if (card && !cards.includes(card)) cards.push(card);
    };
    const addCardFor = (element) => {
      const card = element && element.closest ? element.closest(CARD_SELECTOR) : null;
      addCard(card);
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

    if (event) {
      for (const rectCard of findCardsUnderCoordinates(event.clientX, event.clientY)) {
        addCard(rectCard);
      }
    }

    if (
      lastHoveredCard &&
      lastHoveredCard.parentNode &&
      (cards.length === 0 || cards.some(isPreviewCard))
    ) {
      addCard(lastHoveredCard);
    }

    const inspected = [];
    for (const card of cards) {
      const found = inspectCardContext(card);
      if (found && found.url) inspected.push({ card, info: found });
    }

    if (inspected.length > 0) {
      const first = inspected[0];
      const playlistEntry = inspected.find(
        (entry) => !isPreviewCard(entry.card) && entry.info.isPlaylist,
      );
      const singleItemEntry = isPreviewCard(first.card)
        ? inspected.find((entry) => !isPreviewCard(entry.card) && entry.info.singleItem)
        : null;
      if (singleItemEntry) {
        info = singleItemEntry.info;
      } else if (playlistEntry && (isPreviewCard(first.card) || !first.info.isPlaylist)) {
        info = {
          ...playlistEntry.info,
          topVideoUrl: playlistEntry.info.topVideoUrl || first.info.topVideoUrl || first.info.url,
        };
      } else {
        info = first.info;
      }
    }

    if (!info && isPlaylistRoute() && event && event.target && event.target.closest) {
      const headerEl = event.target.closest(PLAYLIST_HEADER_SELECTOR);
      const listId = currentPlaylistId();
      if (headerEl && listId) {
        info = {
          url: pageLocation().href,
          isPlaylist: true,
          playlistId: listId,
          playlistUrl: pageLocation().href,
          topVideoUrl: null,
        };
      }
    }

    lastContextInfo = info;
    lastContextUrl = info ? info.url : null;
    return info;
  }

  function nowMs() {
    try {
      if (typeof Date !== 'undefined' && typeof Date.now === 'function') return Date.now();
    } catch (_error) {
      // Fall through to zero when clocks are unavailable.
    }
    return 0;
  }

  function closeContextModal() {
    for (const modal of document.querySelectorAll('[data-ytdl-context-modal]')) {
      modal.remove();
    }
  }

  function closeFormatModal() {
    for (const modal of document.querySelectorAll('[data-ytdl-format-modal]')) {
      modal.remove();
    }
  }

  function makeEl(tag, attrs, text) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value !== undefined && value !== null) el.setAttribute(key, String(value));
      }
    }
    if (text !== undefined && text !== null) el.textContent = String(text);
    return el;
  }

  function formatBytes(bytes) {
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '';
    const units = ['B', 'KiB', 'MiB', 'GiB'];
    let value = bytes;
    let idx = 0;
    while (value >= 1024 && idx < units.length - 1) {
      value /= 1024;
      idx += 1;
    }
    return `${value >= 10 || idx === 0 ? Math.round(value) : value.toFixed(1)} ${units[idx]}`;
  }

  function extractPlaylistIdFromUrl(value) {
    if (typeof value !== 'string' || !value) return null;
    try {
      const parsed = new URL(value, pageLocation().href);
      const list = parsed.searchParams.get('list');
      return list && list.trim() ? list.trim() : null;
    } catch (_error) {
      return null;
    }
  }

  function dispatchTriggerDownload(mode, url, options) {
    const api = ext();
    if (!api || !api.runtime) return;
    const message = {
      type: 'ytdl-trigger-download',
      mode,
      url: url || pageLocation().href,
    };
    if (options && typeof options.playlist === 'boolean') {
      message.playlist = options.playlist;
    }
    if (options && typeof options.playlistItems === 'string' && options.playlistItems.trim()) {
      message.playlistItems = options.playlistItems.trim();
    }
    if (options && typeof options.fallbacks !== 'undefined') {
      message.fallbacks = options.fallbacks;
    }
    if (options) {
      const passthroughKeys = [
        'formatSelector', 'convertFormat', 'convertBitrate',
        'convertSampleRate', 'convertChannels', 'convertBitDepth', 'videoContainer',
      ];
      for (const key of passthroughKeys) {
        if (options[key] !== undefined && options[key] !== null && options[key] !== '') {
          message[key] = options[key];
        }
      }
    }
    try {
      const result = api.runtime.sendMessage(message);
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch (_error) {
      // Background may be unreachable.
    }
  }

  function dispatchOrPromptAdvancedDownload(mode, url, options) {
    if (uiMode === 'advanced' && (mode === 'audio' || mode === 'video')) {
      openAdvancedFormatModal({
        mode,
        url: url || pageLocation().href,
        fallbacks: options && options.fallbacks ? options.fallbacks : [],
        playlist: options && typeof options.playlist === 'boolean' ? options.playlist : undefined,
        playlistItems: options && options.playlistItems ? options.playlistItems : undefined,
      });
      return;
    }
    dispatchTriggerDownload(mode, url, options);
  }

  function openAdvancedFormatModal(request) {
    closeFormatModal();
    const host = document.body || document.documentElement;
    if (!host) return false;

    const mode = request && request.mode === 'video' ? 'video' : 'audio';
    const targetUrl = (request && request.url) || pageLocation().href;
    const fallbacks = (request && request.fallbacks) || [];

    const modal = makeEl('div', {
      'data-ytdl-format-modal': 'true',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': `Advanced ${mode} format selector`,
    });
    const card = makeEl('div', { 'data-ytdl-format-card': 'true' });

    const header = makeEl('div', { 'data-ytdl-format-header': 'true' });
    const title = makeEl(
      'h2',
      { 'data-ytdl-format-title': 'true' },
      mode === 'audio' ? 'Advanced Audio Format & Pipeline' : 'Advanced Video Stream & Container',
    );
    const closeBtn = makeEl('button', { type: 'button', 'data-ytdl-format-close': 'true' }, 'Cancel');
    closeBtn.addEventListener('click', closeFormatModal);
    header.appendChild(title);
    header.appendChild(closeBtn);
    card.appendChild(header);

    const statusLine = makeEl(
      'p',
      { 'data-ytdl-format-status': 'true' },
      'Inspecting available streams via yt-dlp...',
    );
    card.appendChild(statusLine);

    const body = makeEl('div', { 'data-ytdl-format-body': 'true' });
    card.appendChild(body);

    const selectorInput = makeEl('input', {
      type: 'text',
      'data-ytdl-fmt-custom': 'true',
      'aria-label': 'yt-dlp format selector expression',
      value: mode === 'audio' ? 'bestaudio/best' : 'bestvideo+bestaudio/best',
    });

    let activeAudioTab = 'direct';
    let selectedAudioStream = 'bestaudio/best';
    let selectedVideoStream = 'bestvideo';
    let selectedAudioPair = 'bestaudio';
    let cachedFormats = [];

    let convSourceSel = null;
    let convFmtSel = null;
    let convBitrateSel = null;
    let convBitrateWrap = null;
    let convBitDepthSel = null;
    let convBitDepthWrap = null;
    let convSampleRateSel = null;
    let convChannelsSel = null;
    let convPreview = null;
    let vidAudioSel = null;
    let vidContainerSel = null;

    const BITRATE_OPTIONS = {
      mp3: [
        ['V0', 'V0 (~245 kbps VBR - Recommended)'],
        ['320k', '320 kbps CBR'],
        ['V2', 'V2 (~190 kbps VBR)'],
        ['256k', '256 kbps CBR'],
        ['192k', '192 kbps CBR'],
        ['V5', 'V5 (~130 kbps VBR)'],
        ['128k', '128 kbps CBR'],
      ],
      ogg: [
        ['V0', 'V0 (~192 kbps VBR - Recommended)'],
        ['256k', '256 kbps'],
        ['192k', '192 kbps'],
        ['160k', '160 kbps'],
        ['128k', '128 kbps'],
      ],
      opus: [
        ['160k', '160 kbps (Recommended)'],
        ['256k', '256 kbps'],
        ['192k', '192 kbps'],
        ['128k', '128 kbps'],
        ['96k', '96 kbps'],
        ['64k', '64 kbps'],
      ],
      m4a: [
        ['256k', '256 kbps AAC (Recommended)'],
        ['320k', '320 kbps AAC'],
        ['192k', '192 kbps AAC'],
        ['160k', '160 kbps AAC'],
        ['128k', '128 kbps AAC'],
      ],
      ac3: [
        ['384k', '384 kbps AC3'],
        ['448k', '448 kbps AC3'],
        ['640k', '640 kbps AC3'],
        ['256k', '256 kbps AC3'],
        ['192k', '192 kbps AC3'],
      ],
    };

    function updateVideoSelectorExpression() {
      const foundVideo = cachedFormats.find((f) => f.format_id === selectedVideoStream);
      const isCombined = Boolean(foundVideo && foundVideo.kind === 'combined');
      if (selectedAudioPair === 'none') {
        selectorInput.value = selectedVideoStream;
      } else if (isCombined && selectedAudioPair === 'bestaudio') {
        selectorInput.value = selectedVideoStream;
      } else {
        selectorInput.value = `${selectedVideoStream}+${selectedAudioPair}/best`;
      }
    }

    function updateConvertControls() {
      if (!convFmtSel) return;
      const fmt = convFmtSel.value;
      const bitrates = BITRATE_OPTIONS[fmt];
      if (convBitrateWrap && convBitrateSel) {
        convBitrateWrap.hidden = !bitrates;
        if (bitrates) {
          const prev = convBitrateSel.value;
          convBitrateSel.textContent = '';
          for (const [val, label] of bitrates) {
            const opt = makeEl('option', { value: val }, label);
            convBitrateSel.appendChild(opt);
          }
          convBitrateSel.value = bitrates.some(([val]) => val === prev) ? prev : bitrates[0][0];
        }
      }
      const supportsBitDepth = fmt === 'flac' || fmt === 'wav' || fmt === 'alac' || fmt === 'aiff';
      if (convBitDepthWrap && convBitDepthSel) {
        convBitDepthWrap.hidden = !supportsBitDepth;
        if (supportsBitDepth) {
          const prevBd = convBitDepthSel.value;
          convBitDepthSel.textContent = '';
          convBitDepthSel.appendChild(makeEl('option', { value: '16' }, '16-bit'));
          convBitDepthSel.appendChild(makeEl('option', { value: '24' }, '24-bit'));
          if (fmt === 'wav' || fmt === 'aiff') {
            convBitDepthSel.appendChild(makeEl('option', { value: '32f' }, '32-bit float'));
          }
          convBitDepthSel.value =
            prevBd && Array.from(convBitDepthSel.options).some((o) => o.value === prevBd)
              ? prevBd
              : '16';
        }
      }
      if (convPreview) {
        const src = (convSourceSel && convSourceSel.value) || 'bestaudio/best';
        const parts = [`yt-dlp -f ${src} && ffmpeg`];
        parts.push(`format=${fmt}`);
        if (bitrates && convBitrateSel && convBitrateSel.value) parts.push(`q=${convBitrateSel.value}`);
        if (supportsBitDepth && convBitDepthSel && convBitDepthSel.value) {
          parts.push(`depth=${convBitDepthSel.value}`);
        }
        if (convSampleRateSel && convSampleRateSel.value) parts.push(`ar=${convSampleRateSel.value}Hz`);
        if (convChannelsSel && convChannelsSel.value) parts.push(`ac=${convChannelsSel.value}`);
        convPreview.textContent = parts.join(' ');
      }
    }

    function renderAudioBody(formats) {
      body.textContent = '';
      const tabRow = makeEl('div', { 'data-ytdl-fmt-tabs': 'true' });
      const directBtn = makeEl('button', {
        type: 'button',
        'data-ytdl-fmt-tab': 'direct',
        'data-active': activeAudioTab === 'direct' ? 'true' : 'false',
      }, 'Direct stream (yt-dlp -f)');
      const convBtn = makeEl('button', {
        type: 'button',
        'data-ytdl-fmt-tab': 'convert',
        'data-active': activeAudioTab === 'convert' ? 'true' : 'false',
      }, 'Convert / Custom FFmpeg');
      tabRow.appendChild(directBtn);
      tabRow.appendChild(convBtn);
      body.appendChild(tabRow);

      const directPane = makeEl('div', { 'data-ytdl-fmt-pane': 'direct' });
      const convertPane = makeEl('div', { 'data-ytdl-fmt-pane': 'convert' });
      directPane.hidden = activeAudioTab !== 'direct';
      convertPane.hidden = activeAudioTab !== 'convert';

      const syncTabUI = () => {
        directBtn.setAttribute('data-active', activeAudioTab === 'direct' ? 'true' : 'false');
        convBtn.setAttribute('data-active', activeAudioTab === 'convert' ? 'true' : 'false');
        directPane.hidden = activeAudioTab !== 'direct';
        convertPane.hidden = activeAudioTab !== 'convert';
      };
      directBtn.addEventListener('click', () => {
        activeAudioTab = 'direct';
        syncTabUI();
      });
      convBtn.addEventListener('click', () => {
        activeAudioTab = 'convert';
        syncTabUI();
        updateConvertControls();
      });

      const list = makeEl('div', { 'data-ytdl-fmt-list': 'audio' });
      const audioStreams = formats
        .filter((f) => f.kind === 'audio_only')
        .sort((a, b) => (Number(b.abr || b.tbr || 0) - Number(a.abr || a.tbr || 0)));
      const combinedStreams = formats.filter((f) => f.kind === 'combined');
      const entries = [
        {
          format_id: 'bestaudio/best',
          ext: 'native',
          acodec: 'best available',
          abr: null,
          asr: null,
          audio_channels: null,
          filesize: null,
          format_note: 'Direct pass-through',
          kind: 'audio_only',
        },
        ...audioStreams,
        ...combinedStreams,
      ];
      for (const fmt of entries) {
        const row = makeEl('label', { 'data-ytdl-fmt-row': 'true' });
        const radio = makeEl('input', {
          type: 'radio',
          name: 'ytdl-audio-stream',
          value: fmt.format_id,
        });
        radio.checked = selectedAudioStream === fmt.format_id;
        radio.addEventListener('change', () => {
          selectedAudioStream = fmt.format_id;
          selectorInput.value = fmt.format_id;
        });
        const badge = makeEl('span', { 'data-ytdl-fmt-id': 'true' }, fmt.format_id);
        const metaParts = [fmt.ext ? fmt.ext.toUpperCase() : '', fmt.acodec && fmt.acodec !== 'none' ? fmt.acodec : ''];
        if (fmt.abr || fmt.tbr) metaParts.push(`${Math.round(fmt.abr || fmt.tbr)} kbps`);
        if (fmt.asr) metaParts.push(`${(fmt.asr / 1000).toFixed(1).replace(/\.0$/, '')} kHz`);
        if (fmt.audio_channels) metaParts.push(`${fmt.audio_channels}ch`);
        const sizeText = formatBytes(fmt.filesize);
        if (sizeText) metaParts.push(sizeText);
        if (fmt.format_note) metaParts.push(fmt.format_note);
        if (fmt.kind === 'combined') metaParts.push('(muxed stream - extracts audio)');
        const details = makeEl(
          'span',
          { 'data-ytdl-fmt-details': 'true' },
          metaParts.filter(Boolean).join(' | '),
        );
        row.appendChild(radio);
        row.appendChild(badge);
        row.appendChild(details);
        list.appendChild(row);
      }
      directPane.appendChild(list);

      const selWrap = makeEl('div', { 'data-ytdl-fmt-field': 'true' });
      selWrap.appendChild(makeEl('label', null, 'yt-dlp -f expression:'));
      selWrap.appendChild(selectorInput);
      directPane.appendChild(selWrap);

      const srcWrap = makeEl('div', { 'data-ytdl-fmt-field': 'true' });
      srcWrap.appendChild(makeEl('label', null, 'Source stream (for FFmpeg input):'));
      convSourceSel = makeEl('select', { 'data-ytdl-conv-source': 'true' });
      convSourceSel.appendChild(makeEl('option', { value: 'bestaudio/best' }, 'bestaudio/best (Recommended)'));
      for (const fmt of audioStreams) {
        const label = `${fmt.format_id} (${fmt.ext}, ${fmt.acodec}${fmt.abr ? ` ${Math.round(fmt.abr)}k` : ''})`;
        convSourceSel.appendChild(makeEl('option', { value: fmt.format_id }, label));
      }
      convSourceSel.value = 'bestaudio/best';
      convSourceSel.addEventListener('change', updateConvertControls);
      srcWrap.appendChild(convSourceSel);
      convertPane.appendChild(srcWrap);

      const fmtWrap = makeEl('div', { 'data-ytdl-fmt-field': 'true' });
      fmtWrap.appendChild(makeEl('label', null, 'Target audio format:'));
      convFmtSel = makeEl('select', { 'data-ytdl-conv-format': 'true' });
      for (const [val, label] of [
        ['mp3', 'MP3 (libmp3lame)'],
        ['flac', 'FLAC (Lossless)'],
        ['wav', 'WAV (Uncompressed PCM)'],
        ['alac', 'ALAC (Apple Lossless M4A)'],
        ['aiff', 'AIFF (Uncompressed PCM)'],
        ['opus', 'Opus (libopus)'],
        ['m4a', 'M4A / AAC'],
        ['ogg', 'Ogg Vorbis'],
        ['ac3', 'AC3 (Dolby Digital)'],
      ]) {
        convFmtSel.appendChild(makeEl('option', { value: val }, label));
      }
      convFmtSel.value = 'mp3';
      convFmtSel.addEventListener('change', updateConvertControls);
      fmtWrap.appendChild(convFmtSel);
      convertPane.appendChild(fmtWrap);

      convBitrateWrap = makeEl('div', { 'data-ytdl-fmt-field': 'true' });
      convBitrateWrap.appendChild(makeEl('label', null, 'Bitrate / quality:'));
      convBitrateSel = makeEl('select', { 'data-ytdl-conv-bitrate': 'true' });
      convBitrateSel.addEventListener('change', updateConvertControls);
      convBitrateWrap.appendChild(convBitrateSel);
      convertPane.appendChild(convBitrateWrap);

      convBitDepthWrap = makeEl('div', { 'data-ytdl-fmt-field': 'true' });
      convBitDepthWrap.appendChild(makeEl('label', null, 'Sample bit depth:'));
      convBitDepthSel = makeEl('select', { 'data-ytdl-conv-bitdepth': 'true' });
      convBitDepthSel.addEventListener('change', updateConvertControls);
      convBitDepthWrap.appendChild(convBitDepthSel);
      convertPane.appendChild(convBitDepthWrap);

      const srWrap = makeEl('div', { 'data-ytdl-fmt-field': 'true' });
      srWrap.appendChild(makeEl('label', null, 'Sample rate:'));
      convSampleRateSel = makeEl('select', { 'data-ytdl-conv-samplerate': 'true' });
      for (const [val, label] of [
        ['', 'Keep native sample rate'],
        ['48000', '48 kHz'],
        ['44100', '44.1 kHz (CD)'],
        ['96000', '96 kHz (Hi-Res)'],
      ]) {
        convSampleRateSel.appendChild(makeEl('option', { value: val }, label));
      }
      convSampleRateSel.value = '';
      convSampleRateSel.addEventListener('change', updateConvertControls);
      srWrap.appendChild(convSampleRateSel);
      convertPane.appendChild(srWrap);

      const chWrap = makeEl('div', { 'data-ytdl-fmt-field': 'true' });
      chWrap.appendChild(makeEl('label', null, 'Channels:'));
      convChannelsSel = makeEl('select', { 'data-ytdl-conv-channels': 'true' });
      for (const [val, label] of [
        ['', 'Use configured channel setting'],
        ['2', 'Stereo (2 channels)'],
        ['1', 'Mono (1 channel)'],
      ]) {
        convChannelsSel.appendChild(makeEl('option', { value: val }, label));
      }
      convChannelsSel.value = '';
      convChannelsSel.addEventListener('change', updateConvertControls);
      chWrap.appendChild(convChannelsSel);
      convertPane.appendChild(chWrap);

      convPreview = makeEl('code', { 'data-ytdl-fmt-preview': 'true' }, '');
      convertPane.appendChild(convPreview);

      body.appendChild(directPane);
      body.appendChild(convertPane);
      updateConvertControls();
    }

    function renderVideoBody(formats) {
      body.textContent = '';
      const videoStreams = formats
        .filter((f) => f.kind === 'video_only' || f.kind === 'combined')
        .sort((a, b) => {
          const hDiff = Number(b.height || 0) - Number(a.height || 0);
          if (hDiff !== 0) return hDiff;
          const fDiff = Number(b.fps || 0) - Number(a.fps || 0);
          if (fDiff !== 0) return fDiff;
          return Number(b.vbr || b.tbr || 0) - Number(a.vbr || a.tbr || 0);
        });
      const audioStreams = formats
        .filter((f) => f.kind === 'audio_only')
        .sort((a, b) => Number(b.abr || b.tbr || 0) - Number(a.abr || a.tbr || 0));

      const list = makeEl('div', { 'data-ytdl-fmt-list': 'video' });
      const entries = [
        {
          format_id: 'bestvideo',
          ext: 'auto',
          resolution: 'Best available',
          fps: null,
          vcodec: 'auto',
          acodec: 'none',
          vbr: null,
          tbr: null,
          filesize: null,
          dynamic_range: '',
          format_note: 'Highest quality stream',
          kind: 'video_only',
        },
        ...videoStreams,
      ];
      for (const fmt of entries) {
        const row = makeEl('label', { 'data-ytdl-fmt-row': 'true' });
        const radio = makeEl('input', {
          type: 'radio',
          name: 'ytdl-video-stream',
          value: fmt.format_id,
        });
        radio.checked = selectedVideoStream === fmt.format_id;
        radio.addEventListener('change', () => {
          selectedVideoStream = fmt.format_id;
          updateVideoSelectorExpression();
        });
        const badge = makeEl('span', { 'data-ytdl-fmt-id': 'true' }, fmt.format_id);
        const parts = [fmt.resolution || '', fmt.fps ? `${fmt.fps}fps` : '', fmt.ext ? fmt.ext.toUpperCase() : ''];
        if (fmt.vcodec && fmt.vcodec !== 'none') parts.push(fmt.vcodec);
        if (fmt.dynamic_range && fmt.dynamic_range !== 'SDR') parts.push(fmt.dynamic_range);
        if (fmt.vbr || fmt.tbr) parts.push(`${Math.round(fmt.vbr || fmt.tbr)} kbps`);
        const sizeText = formatBytes(fmt.filesize);
        if (sizeText) parts.push(sizeText);
        if (fmt.kind === 'combined') parts.push('(video+audio)');
        if (fmt.format_note) parts.push(fmt.format_note);
        const details = makeEl(
          'span',
          { 'data-ytdl-fmt-details': 'true' },
          parts.filter(Boolean).join(' | '),
        );
        row.appendChild(radio);
        row.appendChild(badge);
        row.appendChild(details);
        list.appendChild(row);
      }
      body.appendChild(list);

      const audioPairWrap = makeEl('div', { 'data-ytdl-fmt-field': 'true' });
      audioPairWrap.appendChild(makeEl('label', null, 'Audio track to pair:'));
      vidAudioSel = makeEl('select', { 'data-ytdl-vid-audio': 'true' });
      vidAudioSel.appendChild(makeEl('option', { value: 'bestaudio' }, 'bestaudio (Recommended)'));
      for (const fmt of audioStreams) {
        const label = `${fmt.format_id} (${fmt.ext}, ${fmt.acodec}${fmt.abr ? ` ${Math.round(fmt.abr)}k` : ''})`;
        vidAudioSel.appendChild(makeEl('option', { value: fmt.format_id }, label));
      }
      vidAudioSel.appendChild(makeEl('option', { value: 'none' }, 'None (video only)'));
      vidAudioSel.value = selectedAudioPair;
      vidAudioSel.addEventListener('change', () => {
        selectedAudioPair = vidAudioSel.value;
        updateVideoSelectorExpression();
      });
      audioPairWrap.appendChild(vidAudioSel);
      body.appendChild(audioPairWrap);

      const containerWrap = makeEl('div', { 'data-ytdl-fmt-field': 'true' });
      containerWrap.appendChild(makeEl('label', null, 'Output container:'));
      vidContainerSel = makeEl('select', { 'data-ytdl-vid-container': 'true' });
      for (const [val, label] of [
        ['mkv', 'MKV (Recommended, keeps all codecs)'],
        ['mp4', 'MP4'],
        ['webm', 'WebM'],
      ]) {
        vidContainerSel.appendChild(makeEl('option', { value: val }, label));
      }
      vidContainerSel.value = 'mkv';
      containerWrap.appendChild(vidContainerSel);
      body.appendChild(containerWrap);

      const selWrap = makeEl('div', { 'data-ytdl-fmt-field': 'true' });
      selWrap.appendChild(makeEl('label', null, 'yt-dlp -f expression:'));
      selWrap.appendChild(selectorInput);
      body.appendChild(selWrap);
    }

    const renderBody = (formats) => {
      cachedFormats = Array.isArray(formats) ? formats : [];
      if (mode === 'audio') renderAudioBody(cachedFormats);
      else renderVideoBody(cachedFormats);
    };

    renderBody([]);

    const footer = makeEl('div', { 'data-ytdl-format-footer': 'true' });
    const downloadBtn = makeEl('button', { type: 'button', 'data-ytdl-fmt-submit': 'true' }, 'Download');
    downloadBtn.addEventListener('click', () => {
      const options = {
        fallbacks,
        playlist: request && typeof request.playlist === 'boolean' ? request.playlist : undefined,
        playlistItems: request && request.playlistItems ? request.playlistItems : undefined,
      };
      if (mode === 'audio') {
        if (activeAudioTab === 'convert' && convFmtSel) {
          options.formatSelector = (convSourceSel && convSourceSel.value) || 'bestaudio/best';
          options.convertFormat = convFmtSel.value;
          if (convBitrateWrap && !convBitrateWrap.hidden && convBitrateSel && convBitrateSel.value) {
            options.convertBitrate = convBitrateSel.value;
          }
          if (convBitDepthWrap && !convBitDepthWrap.hidden && convBitDepthSel && convBitDepthSel.value) {
            options.convertBitDepth = convBitDepthSel.value;
          }
          if (convSampleRateSel && convSampleRateSel.value) {
            options.convertSampleRate = Number.parseInt(convSampleRateSel.value, 10);
          }
          if (convChannelsSel && convChannelsSel.value) {
            options.convertChannels = Number.parseInt(convChannelsSel.value, 10);
          }
        } else {
          const expr = selectorInput.value.trim();
          if (expr && expr !== 'bestaudio/best') options.formatSelector = expr;
        }
      } else {
        const expr = selectorInput.value.trim();
        if (expr && expr !== 'bestvideo+bestaudio/best') options.formatSelector = expr;
        if (vidContainerSel && vidContainerSel.value) {
          options.videoContainer = vidContainerSel.value;
        }
      }
      closeFormatModal();
      dispatchTriggerDownload(mode, targetUrl, options);
    });
    footer.appendChild(downloadBtn);
    card.appendChild(footer);

    modal.appendChild(card);
    modal.addEventListener('click', (evt) => {
      if (evt && evt.target === modal) closeFormatModal();
    });
    host.appendChild(modal);

    const api = ext();
    if (api && api.runtime && typeof api.runtime.sendMessage === 'function') {
      try {
        Promise.resolve(api.runtime.sendMessage({
          type: 'ytdl-list-formats',
          url: targetUrl,
          fallbacks,
        })).then((resp) => {
          if (!modal.parentNode) return;
          if (resp && resp.ok && Array.isArray(resp.formats)) {
            statusLine.textContent = resp.title
              ? `${resp.title} (${resp.formats.length} streams found)`
              : `${resp.formats.length} streams found`;
            renderBody(resp.formats);
          } else {
            statusLine.textContent =
              (resp && resp.error)
                ? `Could not list formats (${resp.error}). You can still choose a custom yt-dlp -f selector or FFmpeg conversion below.`
                : 'Could not list formats. You can still choose a custom yt-dlp -f selector or FFmpeg conversion below.';
          }
        }, () => {
          if (modal.parentNode) {
            statusLine.textContent = 'Format inspection failed. You can still use a custom selector or FFmpeg pipeline.';
          }
        });
      } catch (_error) {
        statusLine.textContent = 'Format inspection unavailable. Use default or custom selector below.';
      }
    }
    return true;
  }

  function resolveGraphicalSelectUrl(message) {
    const playlistId = message && message.playlistId ? String(message.playlistId).trim() : '';
    const playlistUrl = message && message.playlistUrl ? String(message.playlistUrl).trim() : '';
    if (playlistId && !playlistId.startsWith('RD')) {
      if (playlistUrl) {
        try {
          const parsed = new URL(playlistUrl, pageLocation().href);
          if (parsed.pathname === '/playlist') return parsed.href;
          return `${parsed.origin}/playlist?list=${encodeURIComponent(playlistId)}`;
        } catch (_error) {
          // Fall back to constructing canonical playlist URL below.
        }
      }
      const origin = pageLocation().origin || 'https://www.youtube.com';
      return `${origin}/playlist?list=${encodeURIComponent(playlistId)}`;
    }
    if (playlistUrl) return playlistUrl;
    const topVideoUrl = message && message.topVideoUrl ? String(message.topVideoUrl) : '';
    if (topVideoUrl && extractWatchVideoId(topVideoUrl)) {
      try {
        const parsed = new URL(topVideoUrl, pageLocation().href);
        if (playlistId && !parsed.searchParams.get('list')) {
          parsed.searchParams.set('list', playlistId);
        }
        return parsed.href;
      } catch (_error) {
        // Fall back to message.url below.
      }
    }
    if (message && message.url) return message.url;
    return null;
  }

  function openContextPlaylistModal(message) {
    closeContextModal();
    const host = document.body || document.documentElement;
    if (!host) return false;

    const mode = message && message.mode === 'video' ? 'video' : 'audio';
    const playlistUrl = (message && (message.playlistUrl || message.url)) || pageLocation().href;
    const topVideoUrl = (message && message.topVideoUrl) || null;
    const playlistId = (message && message.playlistId) || null;

    const modal = document.createElement('div');
    modal.setAttribute('data-ytdl-context-modal', 'true');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Playlist download options');

    const card = document.createElement('div');
    card.setAttribute('data-ytdl-context-card', 'true');

    const title = document.createElement('h2');
    title.setAttribute('data-ytdl-context-title', 'true');
    title.textContent = `Playlist detected (${mode})`;

    const subtitle = document.createElement('p');
    subtitle.setAttribute('data-ytdl-context-desc', 'true');
    subtitle.textContent = playlistId
      ? `Playlist ${playlistId}: choose whether to download the entire playlist, only the top song, or select items graphically.`
      : 'Choose whether to download the entire playlist, only the top song, or select items graphically.';

    const actions = document.createElement('div');
    actions.setAttribute('data-ytdl-context-actions', 'true');

    const allBtn = document.createElement('button');
    allBtn.setAttribute('type', 'button');
    allBtn.setAttribute('data-ytdl-context-action', 'all');
    allBtn.textContent = 'Download entire playlist';
    allBtn.addEventListener('click', () => {
      closeContextModal();
      dispatchOrPromptAdvancedDownload(mode, playlistUrl, { playlist: true });
    });

    const topBtn = document.createElement('button');
    topBtn.setAttribute('type', 'button');
    topBtn.setAttribute('data-ytdl-context-action', 'top');
    topBtn.textContent = 'Download top song only';
    topBtn.addEventListener('click', () => {
      closeContextModal();
      if (topVideoUrl && extractWatchVideoId(topVideoUrl)) {
        dispatchOrPromptAdvancedDownload(mode, topVideoUrl, { playlist: false });
      } else {
        dispatchOrPromptAdvancedDownload(mode, playlistUrl, { playlist: true, playlistItems: '1' });
      }
    });

    const selectBtn = document.createElement('button');
    selectBtn.setAttribute('type', 'button');
    selectBtn.setAttribute('data-ytdl-context-action', 'select');
    selectBtn.textContent = 'Select items graphically';
    selectBtn.addEventListener('click', () => {
      closeContextModal();
      const samePlaylist = Boolean(
        playlistId &&
        currentPlaylistId() === playlistId &&
        (isPlaylistRoute() || isWatchRoute()),
      );
      const itemsOnPage = samePlaylist ? collectPlaylistPanelItems() : [];
      if (samePlaylist && itemsOnPage.length > 0) {
        openPlaylistPrompt(findTriggerButton(mode), mode);
        return;
      }
      if (samePlaylist) {
        openPlaylistPrompt(findTriggerButton(mode), mode);
        return;
      }
      const targetUrl = resolveGraphicalSelectUrl(message);
      if (targetUrl && /^https?:\/\//i.test(targetUrl)) {
        writePendingPlaylistSelect(mode, playlistId || extractPlaylistIdFromUrl(targetUrl));
        pageLocation().href = targetUrl;
      }
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.setAttribute('type', 'button');
    cancelBtn.setAttribute('data-ytdl-context-action', 'cancel');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', closeContextModal);

    actions.appendChild(allBtn);
    actions.appendChild(topBtn);
    actions.appendChild(selectBtn);
    actions.appendChild(cancelBtn);

    card.appendChild(title);
    card.appendChild(subtitle);
    card.appendChild(actions);
    modal.appendChild(card);

    modal.addEventListener('click', (evt) => {
      if (evt && evt.target === modal) closeContextModal();
    });

    host.appendChild(modal);
    return true;
  }

  function applyStateUpdate(cfg) {
    if (!cfg || typeof cfg !== 'object') return;
    if (typeof cfg.ui_mode === 'string') {
      uiMode = cfg.ui_mode === 'advanced' ? 'advanced' : 'simple';
    }
    if (typeof cfg.show_cut_button === 'boolean') {
      showCutButton = cfg.show_cut_button;
      setCutButtonsHidden(Boolean(document.querySelector('[data-ytdl-playlist-dialog]')));
    }
  }

  function syncExtensionState() {
    const api = ext();
    if (
      !api ||
      !api.runtime ||
      typeof api.runtime.sendMessage !== 'function' ||
      typeof api.runtime.getURL !== 'function'
    ) {
      return;
    }
    try {
      const result = api.runtime.sendMessage({ type: 'ytdl-get-extension-state' });
      if (result && typeof result.then === 'function') {
        result.then(applyStateUpdate, () => {});
      }
    } catch (_error) {
      // Background may be unavailable.
    }
  }

  function handlePointerOver(event) {
    const target = event && event.target;
    if (!target || !target.closest) return;
    const card = target.closest(CARD_SELECTOR);
    if (card && !isPreviewCard(card)) {
      lastHoveredCard = card;
    }
  }

  function handlePointerDown(event) {
    if (!event || event.button !== 2) return;
    // Start of a new right-click gesture: record even when unmatched
    // so a bare link or empty space resets any prior gesture's URL.
    const info = captureContextInfo(event);
    const now = nowMs();
    lastPointerInfo = info;
    lastPointerUrl = info ? info.url : null;
    lastPointerAt = now;
    lastPointerDownAt = now;
    lastContextInfo = info;
    lastContextUrl = lastPointerUrl;
  }

  function handleMouseDown(event) {
    if (!event || event.button !== 2) return;
    const info = captureContextInfo(event);
    const now = nowMs();
    if ((!info || (!info.isPlaylist && !info.singleItem)) && lastPointerInfo && now - lastPointerDownAt < 80) {
      if (lastPointerInfo.isPlaylist || !info) {
        const merged =
          lastPointerInfo.isPlaylist && info && info.topVideoUrl && !lastPointerInfo.topVideoUrl
            ? { ...lastPointerInfo, topVideoUrl: info.topVideoUrl }
            : lastPointerInfo;
        lastContextInfo = merged;
        lastContextUrl = merged.url;
        return;
      }
    }
    lastPointerInfo = info;
    lastPointerUrl = info ? info.url : null;
    lastPointerAt = now;
    lastContextInfo = info;
    lastContextUrl = lastPointerUrl;
  }

  function handleContextMenu(event) {
    let info = captureContextInfo(event);
    if ((!info || (!info.isPlaylist && !info.singleItem)) && lastPointerInfo && nowMs() - lastPointerAt < 500) {
      if (lastPointerInfo.isPlaylist || !info) {
        info =
          lastPointerInfo.isPlaylist && info && info.topVideoUrl && !lastPointerInfo.topVideoUrl
            ? { ...lastPointerInfo, topVideoUrl: info.topVideoUrl }
            : lastPointerInfo;
      }
    }
    lastContextInfo = info;
    lastContextUrl = info ? info.url : null;
    lastPointerInfo = null;
    lastPointerUrl = null;
  }

  function handleRuntimeMessage(message, _sender, sendResponse) {
    if (message && message.type === 'ytdl-get-context-url') {
      if (typeof sendResponse === 'function') {
        if (lastContextInfo && lastContextInfo.isPlaylist) {
          sendResponse({
            url: lastContextInfo.url,
            isPlaylist: true,
            playlistId: lastContextInfo.playlistId || null,
            playlistUrl: lastContextInfo.playlistUrl || lastContextInfo.url,
            topVideoUrl: lastContextInfo.topVideoUrl || null,
            singleItem: false,
          });
        } else {
          sendResponse({
            url: lastContextUrl,
            isPlaylist: false,
            singleItem: Boolean(lastContextInfo && lastContextInfo.singleItem),
          });
        }
      }
      return true;
    }
    if (message && message.type === 'ytdl-prompt-playlist-choice') {
      const shown = openContextPlaylistModal(message);
      if (typeof sendResponse === 'function') sendResponse({ shown });
      return true;
    }
    if (message && message.type === 'ytdl-prompt-advanced-format') {
      uiMode = 'advanced';
      const shown = openAdvancedFormatModal({
        mode: message.mode,
        url: message.url,
        fallbacks: message.fallbacks || [],
        playlist: typeof message.playlist === 'boolean' ? message.playlist : undefined,
        playlistItems: message.playlistItems || undefined,
      });
      if (typeof sendResponse === 'function') sendResponse({ shown });
      return true;
    }
    if (message && message.type === 'ytdl-config-updated') {
      applyStateUpdate(message.config);
      if (typeof sendResponse === 'function') sendResponse({ ok: true });
      return true;
    }
    return undefined;
  }

  function handleKeyDown(event) {
    if (event && event.key === 'Escape') {
      closeContextModal();
      closeFormatModal();
    }
  }

  function scheduleSync() {
    if (refreshTimer !== null) return;
    if (
      lastSyncedUrl === pageLocation().href &&
      !hasPendingPlaylistSelect() &&
      areControlsMountedForRoute()
    ) {
      return;
    }
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      syncControls();
    }, 80);
  }

  function main() {
    removeGroups(false);
    syncExtensionState();
    syncControls();
    document.addEventListener('yt-navigate-finish', syncControls);
    document.addEventListener('yt-page-data-updated', syncControls);
    document.addEventListener('pointerover', handlePointerOver, true);
    document.addEventListener('mouseover', handlePointerOver, true);
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('mousedown', handleMouseDown, true);
    document.addEventListener('contextmenu', handleContextMenu, true);
    document.addEventListener('keydown', handleKeyDown, true);
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
