'use strict';
// Tests for the Firefox WebExtension (Task 4).
// Static file-content assertions plus light vm fixtures for
// background.js (menu creation + native dispatch) and content.js
// (segmented pill mounting + context URL hit-testing).
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const ICONS = path.join(EXT, 'icons');

function readFile(rel) {
  const full = path.join(ROOT, rel);
  assert.ok(fs.existsSync(full), `${rel} must exist`);
  return fs.readFileSync(full, 'utf8');
}

function assertAsciiNoEmoji(rel, text) {
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u.test(text), `${rel} must not contain emoji`);
  for (const match of text.matchAll(/[\u0080-\uFFFF]/g)) {
    assert.fail(`${rel} must be ASCII-only, found ${JSON.stringify(match[0])}`);
  }
}

// --- manifest.json ---
function testManifest() {
  const raw = readFile('extension/manifest.json');
  const manifest = JSON.parse(raw);
  assert.equal(manifest.manifest_version, 2);
  assert.equal(manifest.browser_specific_settings.gecko.id, 'firefox-youtube-downloader@lakis01.github.io');
  assert.equal(manifest.browser_specific_settings.gecko.strict_min_version, '115.0');
  assert.equal(manifest.version, '2.1.0', 'manifest version is 2.1.0');
  for (const perm of ['nativeMessaging', 'menus', 'activeTab']) {
    assert.ok(manifest.permissions.includes(perm), `permissions include ${perm}`);
  }
  for (const pattern of ['*://*.youtube.com/*', '*://youtube.com/*', '*://*.youtu.be/*', '*://youtu.be/*']) {
    assert.ok(manifest.permissions.includes(pattern), `permissions include ${pattern}`);
  }
  assert.deepEqual(manifest.background, { scripts: ['background.js'], persistent: false });
  assert.ok(manifest.browser_action.default_popup === 'popup.html' || manifest.browser_action.default_popup.endsWith('/popup.html'));
  assert.equal(manifest.options_ui.page, 'popup.html?view=options');
  assert.equal(manifest.options_ui.open_in_tab, false);
  assert.ok(Array.isArray(manifest.content_scripts) && manifest.content_scripts.length >= 1);
  const cs = manifest.content_scripts[0];
  assert.ok(cs.matches.includes('*://*.youtube.com/*'));
  assert.ok(cs.matches.includes('*://youtube.com/*'));
  assert.ok(cs.js.includes('content.js'));
  assert.ok(cs.css.includes('content.css'));
  assert.equal(cs.run_at, 'document_idle');
  assertAsciiNoEmoji('extension/manifest.json', raw);
}

// --- icons ---
function testIcons() {
  for (const name of ['plugin.svg', 'audio.svg', 'video.svg', 'cut.svg']) {
    const raw = readFile(`extension/icons/${name}`);
    assert.ok(raw.includes('<svg'), `${name} has an svg root`);
    assertAsciiNoEmoji(`extension/icons/${name}`, raw);
  }
  const plugin = readFile('extension/icons/plugin.svg');
  assert.match(plugin, /rounded|rx=/i, 'plugin badge is rounded');
  const badgeFills = { 'audio.svg': '#0b6bcb', 'video.svg': '#7c3aed', 'cut.svg': '#b45309' };
  for (const [name, fill] of Object.entries(badgeFills)) {
    const raw = readFile(`extension/icons/${name}`);
    assert.ok(raw.includes('32'), `${name} is sized 32`);
    assert.ok(raw.includes('viewBox'), `${name} has a viewBox`);
    assert.ok(raw.includes('stroke-width'), `${name} uses strokes`);
    assert.ok(raw.includes('<rect'), `${name} has a solid badge rect`);
    assert.ok(raw.toLowerCase().includes(fill), `${name} badge fill is ${fill}`);
    assert.ok(raw.includes('#fff') || raw.includes('#ffffff'), `${name} foreground is white for dark-menu contrast`);
    assert.ok(!raw.includes('prefers-color-scheme'), `${name} needs no media query: badge contrast is theme-independent`);
    assert.ok(!raw.includes('#15141a'), `${name} has no dark-on-dark stroke`);
  }
  assert.ok(!/<text/i.test(readFile('extension/icons/audio.svg')), 'audio icon is drawn paths, not text');
}

// --- background.js ---
function testBackgroundStatic() {
  const src = readFile('extension/background.js');
  assertAsciiNoEmoji('extension/background.js', src);
  for (const id of ['ytdl-root', 'ytdl-audio', 'ytdl-video', 'ytdl-cut']) {
    assert.ok(src.includes(`"${id}"`) || src.includes(`'${id}'`), `background creates ${id}`);
  }
  assert.ok(src.includes('YouTube Downloader'), 'root title is YouTube Downloader');
  assert.ok(src.includes('"Audio"') || src.includes("'Audio'"), 'audio title');
  assert.ok(src.includes('"Video"') || src.includes("'Video'"), 'video title');
  assert.ok(src.includes('Cut Audio'), 'cut title');
  assert.ok(src.includes('icons/plugin.svg'), 'root uses plugin icon');
  assert.ok(src.includes('icons/audio.svg'), 'audio item uses audio icon');
  assert.ok(src.includes('icons/video.svg'), 'video item uses video icon');
  assert.ok(src.includes('icons/cut.svg'), 'cut item uses cut icon');
  assert.ok(src.includes('documentUrlPatterns'), 'menu creation declares static documentUrlPatterns');
  assert.ok(src.includes('YT_DOC_PATTERNS') || src.includes('documentUrlPatterns'), 'YouTube document patterns constant');
  for (const pattern of ['*://*.youtube.com/*', '*://youtube.com/*', '*://*.youtu.be/*', '*://youtu.be/*']) {
    assert.ok(src.includes(pattern), `documentUrlPatterns covers ${pattern}`);
  }
  assert.ok(!src.includes('targetUrlPatterns'), 'menu creation omits targetUrlPatterns');
  assert.ok(!src.includes('onShown'), 'no menus.onShown listener (static patterns avoid preview race)');
  assert.ok(src.includes('MENU_CONTEXTS') || src.includes("'selection'"), 'menu contexts include selection');
  assert.ok(src.includes("'video'") && src.includes("'selection'"), 'contexts include video and selection');
  assert.ok(src.includes('onInstalled'), 'setupMenus hooks runtime.onInstalled');
  assert.ok(src.includes('onStartup'), 'setupMenus hooks runtime.onStartup');
  assert.ok(src.includes('blob:'), 'isYouTubeUrl unwraps leading blob: URLs');
  assert.ok(src.includes('ytdl-get-context-url'), 'background queries content script for context URL');
  assert.ok(src.includes('sendNativeMessage'), 'background uses sendNativeMessage');
  assert.ok(src.includes('firefox_youtube_downloader'), 'background uses the native host id');
  assert.ok(src.includes('action') && src.includes('download'), 'background dispatches download action');
  assert.ok(src.includes('fallbacks'), 'background sends fallbacks');
  assert.ok(src.includes('popup.html?onboarding=1'), 'background falls back to onboarding popup');
  assert.ok(src.includes('ytdl-trigger-download'), 'background handles pill trigger messages');
}

function runBackgroundFixture() {
  const src = readFile('extension/background.js');
  const created = [];
  const handlers = { clicked: null, shown: null, message: null, installed: null, startup: null };
  const listenerCounts = { clicked: 0, shown: 0, message: 0, installed: 0, startup: 0 };
  const calls = { nativeMessages: [], tabsCreated: [], sentTabMessages: [], updates: [], refreshes: 0 };
  let nativeShouldReject = false;
  let nativeResponse = { ok: true, launched: true };
  let tabMessageResponse = { url: 'https://www.youtube.com/watch?v=ctx123' };
  const browser = {
    menus: {
      create(item) { created.push(item); return Promise.resolve(item.id); },
      onClicked: { addListener(fn) { handlers.clicked = fn; listenerCounts.clicked += 1; } },
      onShown: { addListener(fn) { handlers.shown = fn; listenerCounts.shown += 1; } },
      refresh() { calls.refreshes += 1; return Promise.resolve(); },
      update(id, props) { calls.updates.push({ id, props }); return Promise.resolve(); },
    },
    tabs: {
      sendMessage(tabId, msg) { calls.sentTabMessages.push({ tabId, msg }); return Promise.resolve(tabMessageResponse); },
      query() { return Promise.resolve([{ id: 7, url: 'https://www.youtube.com/watch?v=tab7' }]); },
      create(opts) { calls.tabsCreated.push(opts); return Promise.resolve(opts); },
    },
    runtime: {
      sendNativeMessage(host, msg) {
        calls.nativeMessages.push({ host, msg });
        if (nativeShouldReject) return Promise.reject(new Error('No such native application'));
        return Promise.resolve(nativeResponse);
      },
      onMessage: { addListener(fn) { handlers.message = fn; listenerCounts.message += 1; } },
      onInstalled: { addListener(fn) { handlers.installed = fn; listenerCounts.installed += 1; } },
      onStartup: { addListener(fn) { handlers.startup = fn; listenerCounts.startup += 1; } },
      getURL(p) { return `moz-extension://fake/${p}`; },
      lastError: undefined,
    },
  };
  const context = { browser, chrome: undefined, console, setTimeout, clearTimeout, URL };
  vm.createContext(context);
  vm.runInContext(src, context, { filename: 'background.js' });
  return {
    created,
    handlers,
    listenerCounts,
    calls,
    fireInstalled() { if (handlers.installed) handlers.installed(); },
    fireStartup() { if (handlers.startup) handlers.startup(); },
    setNativeReject(v) { nativeShouldReject = v; },
    setNativeResponse(v) { nativeResponse = v; },
    setTabMessageResponse(v) { tabMessageResponse = v; },
  };
}

function loadBackgroundExports() {
  const src = readFile('extension/background.js');
  const sandbox = {
    module: { exports: {} },
    browser: undefined,
    chrome: undefined,
    console,
    setTimeout,
    clearTimeout,
    URL,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'background.js' });
  return sandbox.module.exports;
}

async function testBackgroundBehavior() {
  const { created, handlers, calls } = runBackgroundFixture();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const byId = new Map(created.map((item) => [item.id, item]));
  assert.equal(byId.get('ytdl-root').title, 'YouTube Downloader');
  assert.equal(JSON.stringify(byId.get('ytdl-root').icons), JSON.stringify({ 16: 'icons/plugin.svg', 32: 'icons/plugin.svg' }));
  assert.equal(byId.get('ytdl-audio').parentId, 'ytdl-root');
  assert.equal(byId.get('ytdl-audio').title, 'Audio');
  assert.equal(byId.get('ytdl-video').title, 'Video');
  assert.equal(byId.get('ytdl-cut').title, 'Cut Audio');
  const expectedPatterns = ['*://*.youtube.com/*', '*://youtube.com/*', '*://*.youtu.be/*', '*://youtu.be/*'];
  for (const [id, item] of byId) {
    assert.equal(JSON.stringify(item.documentUrlPatterns), JSON.stringify(expectedPatterns), `${id} declares YouTube documentUrlPatterns`);
    assert.ok(!('targetUrlPatterns' in item), `${id} omits targetUrlPatterns`);
    assert.ok(item.contexts.includes('video'), `${id} contexts include video`);
    assert.ok(item.contexts.includes('selection'), `${id} contexts include selection`);
  }
  assert.ok(handlers.clicked, 'click handler registered synchronously');
  assert.ok(handlers.message, 'runtime message handler registered synchronously');
  assert.equal(handlers.shown, null, 'no onShown listener hiding ytdl-root');
  const { isYouTubeUrl } = loadBackgroundExports();
  assert.equal(isYouTubeUrl('https://www.youtube.com/watch?v=abc123'), true);
  assert.equal(isYouTubeUrl('blob:https://www.youtube.com/ab-cd'), true, 'blob: YouTube URL unwraps to YouTube');
  assert.equal(isYouTubeUrl('https://example.com/'), false);
  await handlers.clicked({ menuItemId: 'ytdl-audio', pageUrl: 'https://www.youtube.com/watch?v=page1' }, { id: 7, url: 'https://www.youtube.com/watch?v=page1' });
  assert.equal(calls.nativeMessages.length, 1);
  assert.equal(calls.nativeMessages[0].host, 'firefox_youtube_downloader');
  assert.equal(calls.nativeMessages[0].msg.action, 'download');
  assert.equal(calls.nativeMessages[0].msg.mode, 'audio');
  assert.ok(Array.isArray(calls.nativeMessages[0].msg.fallbacks), 'download carries fallbacks');
}

async function testBackgroundOnboardingFallback() {
  const { handlers, calls, setNativeReject } = runBackgroundFixture();
  await new Promise((resolve) => setTimeout(resolve, 0));
  setNativeReject(true);
  await handlers.clicked({ menuItemId: 'ytdl-video', pageUrl: 'https://www.youtube.com/watch?v=page9' }, { id: 9, url: 'https://www.youtube.com/watch?v=page9' });
  const opened = calls.tabsCreated.some((opts) => String(opts.url || '').includes('popup.html?onboarding=1'));
  assert.ok(opened, 'missing companion opens the onboarding popup');
}

async function testBackgroundLinkAndPageFallbacks() {
  // No card match: the content script answers null, so the menu
  // linkUrl target must win over the current page.
  {
    const { handlers, calls, setTabMessageResponse } = runBackgroundFixture();
    await new Promise((resolve) => setTimeout(resolve, 0));
    setTabMessageResponse({ url: null });
    await handlers.clicked(
      { menuItemId: 'ytdl-audio', linkUrl: 'https://www.youtube.com/watch?v=link9', pageUrl: 'https://www.youtube.com/watch?v=page9' },
      { id: 9, url: 'https://www.youtube.com/watch?v=page9' },
    );
    assert.equal(calls.nativeMessages[0].msg.url, 'https://www.youtube.com/watch?v=link9', 'non-card YouTube link resolves to info.linkUrl');
  }
  // Empty non-card space: no linkUrl either, so info.pageUrl applies.
  {
    const { handlers, calls, setTabMessageResponse } = runBackgroundFixture();
    await new Promise((resolve) => setTimeout(resolve, 0));
    setTabMessageResponse({ url: null });
    await handlers.clicked(
      { menuItemId: 'ytdl-video', pageUrl: 'https://www.youtube.com/watch?v=page9' },
      { id: 9, url: 'https://www.youtube.com/watch?v=page9' },
    );
    assert.equal(calls.nativeMessages[0].msg.url, 'https://www.youtube.com/watch?v=page9', 'empty non-card space falls back to info.pageUrl');
  }
}

async function testBackgroundErrorResponseSkipsOnboarding() {
  // A returned error from a connected host is a download failure,
  // not a missing companion: no onboarding tab.
  {
    const { handlers, calls, setNativeResponse } = runBackgroundFixture();
    await new Promise((resolve) => setTimeout(resolve, 0));
    setNativeResponse({ ok: false, error: 'no valid YouTube URL was provided' });
    await handlers.clicked({ menuItemId: 'ytdl-audio', pageUrl: 'https://www.youtube.com/watch?v=page1' }, { id: 7, url: 'https://www.youtube.com/watch?v=page1' });
    assert.equal(calls.tabsCreated.length, 0, 'response.ok === false does NOT open onboarding');
  }
  // A rejected sendNativeMessage (companion missing) DOES open onboarding.
  {
    const { handlers, calls, setNativeReject } = runBackgroundFixture();
    await new Promise((resolve) => setTimeout(resolve, 0));
    setNativeReject(true);
    await handlers.clicked({ menuItemId: 'ytdl-audio', pageUrl: 'https://www.youtube.com/watch?v=page1' }, { id: 7, url: 'https://www.youtube.com/watch?v=page1' });
    const opened = calls.tabsCreated.some((opts) => String(opts.url || '').includes('popup.html?onboarding=1'));
    assert.ok(opened, 'rejected sendNativeMessage DOES open onboarding');
  }
}

async function testBackgroundStaticMenus() {
  const { created, handlers, listenerCounts, fireInstalled, fireStartup } = runBackgroundFixture();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const expectedContexts = ['page', 'frame', 'link', 'image', 'video', 'audio', 'selection'];
  const expectedPatterns = ['*://*.youtube.com/*', '*://youtube.com/*', '*://*.youtu.be/*', '*://youtu.be/*'];
  assert.equal(created.length, 4, 'four menu items created');
  for (const item of created) {
    assert.equal(JSON.stringify(item.documentUrlPatterns), JSON.stringify(expectedPatterns), `${item.id} declares YouTube documentUrlPatterns`);
    assert.ok(!('targetUrlPatterns' in item), `${item.id} omits targetUrlPatterns`);
    assert.equal(JSON.stringify(item.contexts), JSON.stringify(expectedContexts), `${item.id} declares all seven contexts`);
  }
  assert.equal(handlers.shown, null, 'no onShown listener (static patterns fix preview race)');
  assert.ok(handlers.clicked, 'click handler registered');
  assert.ok(handlers.message, 'pill message handler registered');
  assert.ok(handlers.installed, 'onInstalled hook registered');
  assert.ok(handlers.startup, 'onStartup hook registered');
  // onInstalled/onStartup re-runs setup without duplicating listener registrations.
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  fireInstalled();
  await tick();
  fireInstalled();
  await tick();
  fireStartup();
  await tick();
  assert.equal(JSON.stringify(listenerCounts), JSON.stringify({ clicked: 1, shown: 0, message: 1, installed: 1, startup: 1 }), 'listeners and hooks registered exactly once');
}

// --- content.css ---
function testContentCss() {
  const css = readFile('extension/content.css');
  assertAsciiNoEmoji('extension/content.css', css);
  assert.ok(css.includes('[data-ytdl-controls]'), 'pill selector present');
  assert.ok(css.includes('40px'), 'pill height is 40px');
  assert.ok(css.includes('20px'), 'pill radius is 20px');
  assert.ok(/\[data-ytdl-controls\][^{]*\{[^}]*height:\s*40px/s.test(css), '[data-ytdl-controls] retains height 40px');
  assert.ok(/\[data-ytdl-controls\][^{]*\{[^}]*margin-top:\s*12px/s.test(css), '[data-ytdl-controls] aligns with margin-top 12px');
  assert.ok(/\[data-ytdl-controls\][^{]*\{[^}]*align-self:\s*center/s.test(css), '[data-ytdl-controls] centers with align-self');
  assert.ok(css.includes('rgba(0, 0, 0, 0.05)') || css.includes('rgba(0,0,0,0.05)') || css.includes('rgba(0, 0, 0, .05)'), 'light pill surface');
  assert.ok(css.includes('#f2f2f2'), 'light fallback #f2f2f2');
  assert.ok(css.includes('rgba(255, 255, 255, 0.1)') || css.includes('rgba(255,255,255,0.1)') || css.includes('rgba(255, 255, 255, .1)'), 'dark pill surface');
  assert.ok(css.includes('#272727'), 'dark fallback #272727');
  assert.ok(css.includes('html[dark]'), 'dark adjustments under html[dark]');
  assert.ok(!css.includes('--yt-spec-badge-chip-background'), 'must not use --yt-spec-badge-chip-background');
  assert.ok(css.includes(':hover'), 'hover state');
  assert.ok(css.includes(':focus-visible'), 'focus-visible ring');
  assert.ok(css.includes('data-launching'), 'launching confirmation state');
  assert.ok(css.includes('500') && css.includes('14px'), '500 14px segment type');
  assert.ok(css.includes('0 16px'), '0 16px button padding');
  assert.ok(/gap:\s*7px/.test(css), '7px icon-label gap');
  assert.ok(css.includes('18px'), '18px dividers');
}

// --- content.js ---
function testContentStatic() {
  const src = readFile('extension/content.js');
  assertAsciiNoEmoji('extension/content.js', src);
  assert.ok(src.includes('[data-ytdl-controls]'), 'mounts the pill group');
  assert.ok(src.includes('#owner'), 'mounts relative to #owner');
  assert.ok(src.includes('#actions'), 'mounts relative to #actions');
  assert.ok(src.includes('ytd-watch-metadata'), 'mounts in watch metadata');
  assert.ok(src.includes('#top-row'), 'mounts in #top-row');
  assert.ok(src.includes('/watch') && src.includes('/shorts/') && src.includes('/live/'), 'watch/shorts/live routes');
  assert.ok(src.includes('<button') || src.includes("createElement('button')") || src.includes('createElement("button")'), 'segments are buttons');
  assert.ok(src.includes('Download audio') && src.includes('Download video') && src.includes('Cut audio'), 'segment labels');
  assert.ok(src.includes('ytdl-trigger-download'), 'pill dispatches trigger messages');
  assert.ok(src.includes('ytdl-get-context-url'), 'answers context URL queries');
  assert.ok(src.includes('elementsFromPoint'), 'hit-testing with elementsFromPoint');
  assert.ok(src.includes('contextmenu'), 'contextmenu capture');
  assert.ok(src.includes('pointerdown'), 'right-button pointerdown capture for preview overlays');
  assert.ok(src.includes('mousedown'), 'right-button mousedown fallback capture');
  assert.ok(/button\s*!==?\s*2/.test(src), 'only right-button presses capture context');
  assert.ok(src.includes('ytd-video-preview'), 'inline preview card selector');
  assert.ok(src.includes('#video-preview'), 'preview container id selector');
  assert.ok(src.includes('yt-lockup-view-model'), 'lockup selector');
  for (const sel of ['ytd-rich-item-renderer', 'ytd-video-renderer', 'ytd-grid-video-renderer', 'ytd-compact-video-renderer', 'ytd-rich-grid-media', 'ytd-reel-item-renderer', 'ytd-reel-video-renderer', 'ytd-playlist-video-renderer', 'ytd-playlist-panel-video-renderer', 'ytmusic-two-row-item-renderer', 'ytmusic-responsive-list-item-renderer']) {
    assert.ok(src.includes(sel), `card selector ${sel}`);
  }
  assert.ok(src.includes('data-launching'), 'launching state');
  assert.ok(src.includes('viewBox') && src.includes('stroke-width'), 'inline SVG icons');
}

// Minimal DOM fixture (mirrors tests/test_youtube_buttons.js) to run content.js.
function createContentFixture() {
  class El {
    constructor(tag) {
      this.nodeType = 1;
      this.tagName = String(tag).toUpperCase();
      this.attributes = new Map();
      this.childNodes = [];
      this.parentNode = null;
      this.listeners = new Map();
      this.style = {};
      this.dataset = {};
    }
    setAttribute(k, v) { this.attributes.set(k, String(v)); }
    getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; }
    hasAttribute(k) { return this.attributes.has(k); }
    removeAttribute(k) { this.attributes.delete(k); }
    get id() { return this.getAttribute('id') || ''; }
    set id(v) { this.setAttribute('id', v); }
    get className() { return this.getAttribute('class') || ''; }
    set className(v) { this.setAttribute('class', v); }
    get href() { return this.getAttribute('href') || ''; }
    set href(v) { this.setAttribute('href', v); }
    get textContent() { return this.childNodes.map((c) => c.textContent || '').join(''); }
    set textContent(v) {
      for (const c of this.childNodes) c.parentNode = null;
      this.childNodes = [];
      if (String(v)) this.appendChild(new Tx(v));
    }
    get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
    appendChild(c) {
      if (c.parentNode) c.parentNode.removeChild(c);
      c.parentNode = this;
      this.childNodes.push(c);
      return c;
    }
    insertBefore(c, ref) {
      if (c.parentNode) c.parentNode.removeChild(c);
      const i = this.childNodes.indexOf(ref);
      c.parentNode = this;
      if (i < 0) this.childNodes.push(c);
      else this.childNodes.splice(i, 0, c);
      return c;
    }
    removeChild(c) {
      const i = this.childNodes.indexOf(c);
      if (i >= 0) { this.childNodes.splice(i, 1); c.parentNode = null; }
      return c;
    }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    addEventListener(t, fn, _o) {
      if (!this.listeners.has(t)) this.listeners.set(t, []);
      this.listeners.get(t).push(fn);
    }
    dispatchEvent(e) {
      if (!e.target) e.target = this;
      let cur = this;
      while (cur) {
        for (const fn of cur.listeners?.get(e.type) || []) fn.call(cur, e);
        if (!e.bubbles) break;
        cur = cur.parentNode;
      }
      return true;
    }
    matches(sel) {
      return sel.split(',').some((cand) => {
        const t = cand.trim();
        if (t.startsWith('#')) return this.id === t.slice(1);
        if (t.startsWith('[')) return this.hasAttribute(t.slice(1, -1));
        return this.tagName === t.toUpperCase();
      });
    }
    closest(sel) {
      for (let cur = this; cur; cur = cur.parentNode) {
        if (cur.matches && sel.split(',').some((cand) => {
          const t = cand.trim();
          if (t.startsWith('#')) return cur.id === t.slice(1);
          if (t.startsWith('[')) return cur.hasAttribute && cur.hasAttribute(t.slice(1, -1));
          return cur.tagName === t.toUpperCase();
        })) return cur;
      }
      return null;
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    querySelectorAll(sel) {
      const out = [];
      const visit = (node) => {
        for (const child of node.children || []) {
          if (matchesSel(child, sel)) out.push(child);
          visit(child);
        }
      };
      visit(this);
      return out;
    }
  }
  class Tx {
    constructor(v) { this.nodeType = 3; this.textContent = String(v); this.parentNode = null; }
  }
  function matchesSel(el, sel) {
    const t = sel.trim();
    if (t.startsWith('#')) return el.id === t.slice(1);
    if (t.startsWith('[')) {
      const m = t.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
      if (!m) return false;
      return m[2] === undefined ? el.hasAttribute(m[1]) : el.getAttribute(m[1]) === m[2];
    }
    return el.tagName === t.toUpperCase();
  }
  let hitStack = [];
  const document = new El('#document');
  document.nodeType = 9;
  document.createElement = (tag) => new El(tag);
  document.createElementNS = (_ns, tag) => new El(tag);
  document.createTextNode = (v) => new Tx(v);
  document.getElementById = (id) => document.querySelector(`#${id}`);
  document.elementsFromPoint = () => hitStack;
  document.documentElement = new El('html');
  document.head = new El('head');
  document.body = new El('body');
  document.documentElement.appendChild(document.head);
  document.documentElement.appendChild(document.body);
  document.appendChild(document.documentElement);
  const location = { href: 'https://www.youtube.com/watch?v=abc123', hostname: 'www.youtube.com', pathname: '/watch', origin: 'https://www.youtube.com' };
  const metadata = document.createElement('ytd-watch-metadata');
  const topRow = document.createElement('div');
  topRow.id = 'top-row';
  const owner = document.createElement('div');
  owner.id = 'owner';
  const actions = document.createElement('div');
  actions.id = 'actions';
  topRow.appendChild(owner);
  topRow.appendChild(actions);
  metadata.appendChild(topRow);
  document.body.appendChild(metadata);
  const sentMessages = [];
  const messageListeners = [];
  const browser = {
    runtime: {
      sendMessage(msg) { sentMessages.push(msg); return Promise.resolve({ ok: true }); },
      onMessage: { addListener(fn) { messageListeners.push(fn); } },
    },
  };
  const context = {
    window: { location },
    document,
    location,
    URL,
    MutationObserver: class { observe() {} },
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout: () => {},
    browser,
    chrome: undefined,
    console,
  };
  context.window.document = document;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(EXT, 'content.js'), 'utf8'), context, { filename: 'content.js' });
  return {
    document, location, sentMessages, messageListeners,
    setHitStack(els) { hitStack = els; },
    setHitStackArr(arr) { hitStack = arr; },
  };
}

function testContentBehavior() {
  const fx = createContentFixture();
  const topRow = fx.document.querySelector('ytd-watch-metadata').querySelector('#top-row');
  const groups = topRow.querySelectorAll('[data-ytdl-controls]');
  assert.equal(groups.length, 1, 'one segmented pill mounted');
  const order = topRow.children.map((c) => c.id || c.getAttribute('data-ytdl-controls'));
  assert.deepEqual(order, ['owner', 'true', 'actions']);
  const buttons = groups[0].querySelectorAll('button');
  assert.equal(buttons.length, 3);
  assert.deepEqual(buttons.map((b) => b.getAttribute('aria-label')), ['Download audio', 'Download video', 'Cut audio']);
  assert.deepEqual(buttons.map((b) => b.textContent.trim()), ['Audio', 'Video', 'Cut']);
  for (const b of buttons) assert.equal(b.getAttribute('type'), 'button');
  buttons[0].dispatchEvent({ type: 'click', target: buttons[0], bubbles: true });
  assert.equal(fx.sentMessages.length, 1);
  assert.equal(fx.sentMessages[0].type, 'ytdl-trigger-download');
  assert.equal(fx.sentMessages[0].mode, 'audio');
  // context URL query round-trip: no contextmenu yet, so no card
  // match is preserved as null (background falls back to link/page).
  assert.ok(fx.messageListeners.length >= 1, 'content answers runtime messages');
  const responder = fx.messageListeners[0];
  let answered = null;
  responder({ type: 'ytdl-get-context-url' }, {}, (r) => { answered = r; });
  assert.ok(answered && 'url' in answered, 'context URL answered');
  assert.equal(answered.url, null, 'no card match is preserved as null');
  // card hit-testing through elementsFromPoint
  const card = fx.document.createElement('yt-lockup-view-model');
  const link = fx.document.createElement('a');
  link.setAttribute('href', '/watch?v=lockup123');
  card.appendChild(link);
  fx.document.body.appendChild(card);
  const preview = fx.document.createElement('div');
  fx.document.body.appendChild(preview);
  fx.setHitStackArr([preview, card]);
  preview.dispatchEvent({ type: 'contextmenu', target: preview, bubbles: true, clientX: 10, clientY: 20 });
  let after = null;
  responder({ type: 'ytdl-get-context-url' }, {}, (r) => { after = r; });
  assert.equal(after.url, 'https://www.youtube.com/watch?v=lockup123');
  // right-clicking a bare YouTube link outside any card: no context
  // URL, so the background resolves info.linkUrl instead of the page.
  const bareLink = fx.document.createElement('a');
  bareLink.setAttribute('href', 'https://www.youtube.com/watch?v=bare999');
  fx.document.body.appendChild(bareLink);
  fx.setHitStackArr([bareLink]);
  bareLink.dispatchEvent({ type: 'contextmenu', target: bareLink, bubbles: true, clientX: 30, clientY: 40 });
  let bare = null;
  responder({ type: 'ytdl-get-context-url' }, {}, (r) => { bare = r; });
  assert.equal(bare.url, null, 'bare non-card link yields no context URL');
  // right-clicking empty non-card space: no context URL either.
  const empty = fx.document.createElement('div');
  fx.document.body.appendChild(empty);
  fx.setHitStackArr([empty]);
  empty.dispatchEvent({ type: 'contextmenu', target: empty, bubbles: true, clientX: 50, clientY: 60 });
  let vacant = null;
  responder({ type: 'ytdl-get-context-url' }, {}, (r) => { vacant = r; });
  assert.equal(vacant.url, null, 'empty non-card space yields no context URL');
  // inline hover-autoplay preview: right-button pointerdown on
  // ytd-video-preview captures even when contextmenu never reaches us.
  const previewWrap = fx.document.createElement('div');
  previewWrap.setAttribute('id', 'video-preview');
  const loader = fx.document.createElement('ytd-video-preview-loader');
  const loaderInner = fx.document.createElement('div');
  const inlinePreview = fx.document.createElement('ytd-video-preview');
  const previewLink = fx.document.createElement('a');
  previewLink.setAttribute('href', '/watch?v=preview999');
  inlinePreview.appendChild(previewLink);
  const inlineControls = fx.document.createElement('yt-inline-player-controls');
  inlinePreview.appendChild(inlineControls);
  loaderInner.appendChild(inlinePreview);
  loader.appendChild(loaderInner);
  previewWrap.appendChild(loader);
  fx.document.body.appendChild(previewWrap);
  fx.setHitStackArr([inlinePreview, inlineControls]);
  inlinePreview.dispatchEvent({ type: 'pointerdown', target: inlinePreview, bubbles: true, button: 2, clientX: 70, clientY: 80 });
  let previewed = null;
  responder({ type: 'ytdl-get-context-url' }, {}, (r) => { previewed = r; });
  assert.equal(previewed.url, 'https://www.youtube.com/watch?v=preview999', 'right-button pointerdown on ytd-video-preview captures card URL without contextmenu');
  // ordinary left-clicks must not overwrite the captured context URL.
  fx.setHitStackArr([empty]);
  empty.dispatchEvent({ type: 'pointerdown', target: empty, bubbles: true, button: 0, clientX: 51, clientY: 61 });
  let kept = null;
  responder({ type: 'ytdl-get-context-url' }, {}, (r) => { kept = r; });
  assert.equal(kept.url, 'https://www.youtube.com/watch?v=preview999', 'left-button pointerdown preserves the right-click context URL');
}

// --- popup ---
function testPopup() {
  const html = readFile('extension/popup.html');
  const css = readFile('extension/popup.css');
  const js = readFile('extension/popup.js');
  assertAsciiNoEmoji('extension/popup.html', html);
  assertAsciiNoEmoji('extension/popup.css', css);
  assertAsciiNoEmoji('extension/popup.js', js);
  assert.ok(!/kicker|eyebrow/i.test(html), 'no kicker or eyebrow labels');
  assert.ok(!/kicker|eyebrow/i.test(js), 'no kicker or eyebrow labels in popup logic');
  assert.ok(html.includes('popup.js') && html.includes('popup.css'), 'popup wires its assets');
  assert.ok(html.includes('data-view') || html.includes('view=options') || js.includes('view=options') || js.includes('onboarding'), 'popup supports options/onboarding views');
  assert.ok(js.includes('sendNativeMessage'), 'popup pings the native host');
  assert.ok(js.includes('firefox_youtube_downloader'), 'popup uses the native host id');
  assert.ok(js.includes('ping'), 'popup queries ping');
  assert.ok(js.includes('set_config') || js.includes('setConfig'), 'popup saves via set_config');
  assert.ok(js.includes('auto_tag') || js.includes('autoTag'), 'automatic tag extraction toggle');
  assert.ok(js.includes('rsgain'), 'rsgain toggle');
  assert.ok(js.includes('download_dir') || js.includes('downloadDir'), 'download folder selection');
  assert.ok(js.includes('install.sh'), 'disconnected state shows the install command');
  assert.ok(js.includes('Retry') || js.includes('retry'), 'retry connection control');
  assert.ok(/copy/i.test(js) || /copy/i.test(html), '1-click copy button');
  assert.ok(css.includes(':focus-visible'), 'themed focus rings');
  assert.ok(css.includes('::selection'), 'themed selection');
  const cardCount = (html.match(/class="card"/g) || []).length;
  assert.ok(cardCount <= 1, 'zero nested cards');
  assert.ok(html.includes('ytdlpUpdateNote'), 'popup has #ytdlpUpdateNote banner element');
  assert.ok(js.includes('ytdlpUpdateNote'), 'popup logic drives #ytdlpUpdateNote');
  assert.ok(js.includes('yt_dlp_status'), 'popup reads yt_dlp_status from ping');
  assert.ok(js.includes('outdated'), 'popup checks outdated flag');
  assert.ok(js.includes('update_hint'), 'popup surfaces the update_hint command');
  assert.ok(js.includes('installed') && (js.includes('latest') || js.includes('age_days')), 'popup shows installed vs latest or age in days');
  assert.ok(css.includes('update-note') || css.includes('ytdlpUpdateNote'), 'popup styles the update note');
  assert.ok(/border:\s*1px\s+solid/.test(css), 'update note uses a uniform 1px solid border');
  assert.ok(!/border-left:\s*[2-9]/.test(css) && !/border-right:\s*[2-9]/.test(css), 'no thick side-border accents');
}

function createPopupFixture(pingResponse) {
  const elements = new Map();
  function mockEl(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        hidden: false,
        checked: false,
        value: '',
        textContent: '',
        dataset: {},
        classList: { toggle() {}, add() {}, remove() {} },
        listeners: {},
        addEventListener(type, fn) {
          if (!this.listeners[type]) this.listeners[type] = [];
          this.listeners[type].push(fn);
        },
        setAttribute() {},
        getAttribute() { return null; },
      });
    }
    return elements.get(id);
  }
  for (const id of ['statusText', 'statusDot', 'connectedView', 'setupView', 'autoTag', 'rsgain', 'customDir', 'effectiveDir', 'depsLine', 'installCmd', 'copyBtn', 'retryBtn', 'copyNote', 'ytdlpUpdateNote', 'ytdlpUpdateText', 'ytdlpUpdateHint']) {
    mockEl(id);
  }
  const document = {
    getElementById: (id) => mockEl(id),
    querySelector: (sel) => {
      if (sel === '.panel') return { setAttribute() {}, getAttribute() { return null; } };
      return null;
    },
    querySelectorAll: () => [],
    createElement: (tag) => mockEl(`created-${tag}-${elements.size}`),
    addEventListener(type, fn) {
      if (type === 'DOMContentLoaded') document._domReady = fn;
    },
    body: { appendChild() {} },
    _domReady: null,
  };
  const window = { location: { search: '' } };
  const browser = {
    runtime: {
      sendNativeMessage: async () => pingResponse,
    },
  };
  const context = {
    document, window, browser, chrome: undefined, navigator: {}, console, URLSearchParams, setTimeout, clearTimeout, URL,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(EXT, 'popup.js'), 'utf8'), context, { filename: 'popup.js' });
  return { document, elements, triggerReady: () => { if (document._domReady) document._domReady(); } };
}

async function testPopupUpdateNote() {
  {
    const fx = createPopupFixture({
      ok: true,
      version: '2.0.0',
      config: {},
      yt_dlp_status: {
        outdated: true, installed: '2024.01.01', latest: '2025.12.01', age_days: 300, update_hint: 'pipx upgrade yt-dlp',
      },
    });
    fx.triggerReady();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const note = fx.elements.get('ytdlpUpdateNote');
    assert.equal(note.hidden, false, 'update note visible when yt_dlp outdated');
    const combined = `${fx.elements.get('ytdlpUpdateText').textContent} ${fx.elements.get('ytdlpUpdateHint').textContent} ${note.textContent}`;
    assert.ok(combined.includes('2024.01.01'), 'note shows the installed version');
    assert.ok(combined.includes('pipx upgrade yt-dlp'), 'note shows the copyable update_hint');
  }
  {
    const fx = createPopupFixture({
      ok: true,
      version: '2.0.0',
      config: {},
      yt_dlp_status: {
        outdated: false, installed: '2025.12.01', latest: '2025.12.01', age_days: 5, update_hint: 'pipx upgrade yt-dlp',
      },
    });
    fx.triggerReady();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(fx.elements.get('ytdlpUpdateNote').hidden, true, 'update note hidden when yt-dlp is current');
  }
  {
    const fx = createPopupFixture({
      ok: true,
      version: '2.0.0',
      config: {},
      yt_dlp_status: {
        outdated: true, installed: '2023.01.01', latest: null, age_days: 400, update_hint: 'yt-dlp -U',
      },
    });
    fx.triggerReady();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const note = fx.elements.get('ytdlpUpdateNote');
    assert.equal(note.hidden, false, 'update note visible when latest is unknown but stale');
    const combined = `${fx.elements.get('ytdlpUpdateText').textContent} ${fx.elements.get('ytdlpUpdateHint').textContent}`;
    assert.ok(combined.includes('400') || combined.includes('2023.01.01'), 'note shows age in days when latest is null');
  }
}

// --- packaging + gitignore ---
function testBuildScript() {
  const sh = readFile('scripts/build-xpi.sh');
  assertAsciiNoEmoji('scripts/build-xpi.sh', sh);
  assert.ok(sh.includes('zipfile'), 'uses Python zipfile, not the zip CLI');
  assert.ok(sh.includes('firefox-youtube-downloader.xpi'), 'builds the xpi artifact');
  assert.ok(sh.includes('manifest.json'), 'validates manifest at archive root');
  assert.ok(sh.includes('sorted'), 'deterministic sorted entries');
  const stat = fs.statSync(path.join(ROOT, 'scripts', 'build-xpi.sh'));
  assert.ok(stat.mode & 0o111, 'build script is executable');
  const gi = readFile('.gitignore');
  assert.ok(gi.split('\n').some((line) => line.trim() === 'dist/' || line.trim() === 'dist' || line.trim() === '/dist/'), '.gitignore lists dist/');

  const source = path.join(EXT, 'popup.js');
  const archive = path.join(ROOT, 'dist', 'firefox-youtube-downloader.xpi');
  const build = () => execFileSync('bash', [path.join(ROOT, 'scripts', 'build-xpi.sh')], { cwd: ROOT, stdio: 'ignore' });
  const digest = () => crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  const original = fs.statSync(source);
  let firstDigest;
  let touchedDigest;
  try {
    build();
    firstDigest = digest();
    fs.utimesSync(source, original.atimeMs / 1000, (original.mtimeMs + 10000) / 1000);
    build();
    touchedDigest = digest();
  } finally {
    fs.utimesSync(source, original.atimeMs / 1000, original.mtimeMs / 1000);
  }
  assert.equal(touchedDigest, firstDigest, 'XPI bytes are independent of source file mtimes');
}

async function main() {
  testManifest();
  testIcons();
  testBackgroundStatic();
  await testBackgroundBehavior();
  await testBackgroundOnboardingFallback();
  await testBackgroundLinkAndPageFallbacks();
  await testBackgroundErrorResponseSkipsOnboarding();
  await testBackgroundStaticMenus();
  testContentCss();
  testContentStatic();
  testContentBehavior();
  testPopup();
  await testPopupUpdateNote();
  testBuildScript();
  console.log('Firefox extension fixture tests passed');
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
