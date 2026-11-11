// ==UserScript==
// @name         YouTube yt-dlp controls
// @namespace    https://github.com/gratis01/youtube-downloader
// @version      1.1.0
// @description  Add compact yt-dlp actions to YouTube watch pages.
// @match        https://youtube.com/*
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @match        https://music.youtube.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

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
  ].join(', ');
  const MODES = [
    { mode: 'audio', label: 'Download audio', icon: 'audio' },
    { mode: 'video', label: 'Download video', icon: 'video' },
    { mode: 'cut', label: 'Cut audio', icon: 'cut' },
  ];

  function isWatchRoute() {
    const host = window.location.hostname;
    const path = window.location.pathname;
    const isYouTube = host === 'youtube.com' || host.endsWith('.youtube.com');
    return isYouTube && (
      path === '/watch' ||
      path.startsWith('/shorts/') ||
      path.startsWith('/live/')
    );
  }

  function makeUri(mode) {
    return `yt-dlp://${mode}?url=${encodeURIComponent(window.location.href)}`;
  }

  function addStyles() {
    if (document.getElementById('ytdl-controls-style')) return;

    const style = document.createElement('style');
    style.id = 'ytdl-controls-style';
    style.textContent = `
      [data-ytdl-controls] {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-inline-start: 8px;
        vertical-align: middle;
      }
      [data-ytdl-controls] a {
        box-sizing: border-box;
        display: inline-flex;
        height: 42px;
        min-height: 42px;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 0 16px;
        border: 0;
        border-radius: 21px;
        background: var(--yt-spec-badge-chip-background, #f2f2f2);
        color: var(--yt-spec-text-primary, #0f0f0f);
        font: 500 15px Roboto, Arial, sans-serif;
        line-height: 20px;
        text-decoration: none;
        white-space: nowrap;
      }
      [data-ytdl-controls] a:hover {
        background: var(--yt-spec-10-percent-layer, rgba(0, 0, 0, .1));
      }
      [data-ytdl-controls] a:focus-visible {
        background: var(--yt-spec-10-percent-layer, rgba(0, 0, 0, .1));
        outline: 2px solid currentColor;
        outline-offset: 2px;
      }
      html[dark] [data-ytdl-controls] a {
        background: var(--yt-spec-badge-chip-background, #272727);
        color: var(--yt-spec-text-primary, #f1f1f1);
      }
      html[dark] [data-ytdl-controls] a:hover,
      html[dark] [data-ytdl-controls] a:focus-visible {
        background: var(--yt-spec-10-percent-layer, rgba(255, 255, 255, .1));
      }
      [data-ytdl-controls] svg {
        width: 22px;
        height: 22px;
        flex: 0 0 22px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.8;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
    `;
    document.head.appendChild(style);
  }

  function makeIcon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('fill', 'none');

    const paths = {
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
    }[name];

    for (const pathData of paths) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', pathData);
      svg.appendChild(path);
    }
    return svg;
  }

  function makeGroup() {
    const group = document.createElement('div');
    group.setAttribute('data-ytdl-controls', 'true');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'yt-dlp actions');

    for (const action of MODES) {
      const link = document.createElement('a');
      link.href = makeUri(action.mode);
      link.setAttribute('aria-label', action.label);
      link.setAttribute('title', action.label);
      link.setAttribute('data-ytdl-mode', action.mode);
      link.addEventListener('click', function () {
        // Leave the anchor's default action intact so Firefox can hand the URI
        // to the user's accepted external-application handler.
        link.href = makeUri(action.mode);
      });

      link.appendChild(makeIcon(action.icon));
      const label = document.createElement('span');
      label.textContent = action.label;
      link.appendChild(label);
      group.appendChild(link);
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
      const groupIndex = children.indexOf(mounted);
      if (children[groupIndex + 1] !== actions) topRow.insertBefore(mounted, actions);
      return;
    }

    addStyles();
    topRow.insertBefore(makeGroup(), actions);
  }

  function captureContextHref(event) {
    let href = window.location.href;
    const cards = [];
    const addCardFor = (element) => {
      const card = element && element.closest ? element.closest(CARD_SELECTOR) : null;
      if (card && !cards.includes(card)) cards.push(card);
    };

    if (typeof document.elementsFromPoint === 'function') {
      for (const element of document.elementsFromPoint(event.clientX, event.clientY)) {
        addCardFor(element);
      }
    }
    addCardFor(event.target);

    for (const card of cards) {
      const link = Array.from(card.querySelectorAll('a')).find((candidate) => {
        const rawHref = candidate.getAttribute('href');
        if (!rawHref) return false;

        try {
          const url = new URL(rawHref, window.location.href);
          const isYouTube = url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com');
          return isYouTube && (url.pathname === '/watch' || url.pathname.startsWith('/shorts/'));
        } catch (_error) {
          return false;
        }
      });

      if (link) {
        href = new URL(link.getAttribute('href'), window.location.href).href;
        break;
      }
    }

    window.__ytdlLastContextHref = href;
  }

  function main() {
    addStyles();
    syncControls();

    document.addEventListener('yt-navigate-finish', syncControls);
    document.addEventListener('yt-page-data-updated', syncControls);
    document.addEventListener('contextmenu', captureContextHref, true);

    let refreshTimer = null;
    const observer = new MutationObserver(() => {
      if (refreshTimer !== null) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        syncControls();
      }, 80);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  main();
})();
