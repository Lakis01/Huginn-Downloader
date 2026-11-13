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
    if (match[0] === '\u2014' || match[0] === '\u2013') continue;
    assert.fail(`${rel} must be ASCII-only except em/en dashes, found ${JSON.stringify(match[0])}`);
  }
}

// --- manifest.json ---
function testManifest() {
  const raw = readFile('extension/manifest.json');
  const manifest = JSON.parse(raw);
  assert.equal(manifest.manifest_version, 2);
  assert.equal(manifest.browser_specific_settings.gecko.id, 'firefox-youtube-downloader@lakis01.github.io');
  assert.equal(manifest.browser_specific_settings.gecko.strict_min_version, '115.0');
  assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions, { required: ['none'] });
  assert.equal(manifest.version, '2.2.0', 'manifest version is 2.2.0');
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
  assert.ok(src.includes('lastPointerDownAt'), 'pointerdown gesture timestamp tracked');
  assert.ok(/<\s*80/.test(src), 'mousedown keeps pointerdown URL within the same-gesture window');
  assert.ok(/<\s*500/.test(src), 'contextmenu reuses the gesture pointerdown URL briefly');
  assert.ok(src.includes('ytd-video-preview'), 'inline preview card selector');
  assert.ok(src.includes('#video-preview'), 'preview container id selector');
  assert.ok(src.includes('yt-lockup-view-model'), 'lockup selector');
  for (const sel of ['ytd-rich-item-renderer', 'ytd-video-renderer', 'ytd-grid-video-renderer', 'ytd-compact-video-renderer', 'ytd-rich-grid-media', 'ytd-reel-item-renderer', 'ytd-reel-video-renderer', 'ytd-playlist-video-renderer', 'ytd-playlist-panel-video-renderer', 'ytmusic-two-row-item-renderer', 'ytmusic-responsive-list-item-renderer']) {
    assert.ok(src.includes(sel), `card selector ${sel}`);
  }
  assert.ok(src.includes('data-launching'), 'launching state');
  assert.ok(src.includes('viewBox') && src.includes('stroke-width'), 'inline SVG icons');
  assert.ok(src.includes("data-ytdl-ext"), 'marks extension group with data-ytdl-ext');
  assert.ok(src.includes("setAttribute('data-ytdl-ext'") || src.includes('setAttribute("data-ytdl-ext"'), 'makeGroup sets data-ytdl-ext');
  assert.ok(src.includes('ytdl-controls-style'), 'removes legacy Tampermonkey style element');
  assert.ok(src.includes("getElementById('ytdl-controls-style')") || src.includes('getElementById("ytdl-controls-style")'), 'looks up legacy style by id');
  assert.ok(src.includes("getAttribute('data-ytdl-ext')") || src.includes('getAttribute("data-ytdl-ext")'), 'detects non-extension groups');
  assert.ok(src.includes("querySelector('a')") || src.includes('querySelector("a")'), 'detects legacy anchor groups');
  assert.ok(src.includes("querySelector('button')") || src.includes('querySelector("button")'), 'distinguishes button groups');
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

function testContentTampermonkeyCleanup() {
  const fx = createContentFixture();
  const topRow = fx.document.querySelector('ytd-watch-metadata').querySelector('#top-row');
  const extGroups = topRow.querySelectorAll('[data-ytdl-controls]');
  assert.equal(extGroups.length, 1, 'one extension pill mounted');
  assert.equal(extGroups[0].getAttribute('data-ytdl-ext'), 'true', 'extension group carries data-ytdl-ext');
  const style = fx.document.createElement('style');
  style.setAttribute('id', 'ytdl-controls-style');
  fx.document.head.appendChild(style);
  assert.ok(fx.document.getElementById('ytdl-controls-style'), 'legacy style present before sync');
  const legacy = fx.document.createElement('div');
  legacy.setAttribute('data-ytdl-controls', 'true');
  for (let i = 0; i < 2; i += 1) {
    const link = fx.document.createElement('a');
    link.setAttribute('href', 'https://www.youtube.com/watch?v=legacy' + i);
    link.textContent = 'Legacy ' + i;
    legacy.appendChild(link);
  }
  topRow.appendChild(legacy);
  assert.equal(topRow.querySelectorAll('[data-ytdl-controls]').length, 2, 'legacy anchor group blocks alongside extension pill');
  topRow.dispatchEvent({ type: 'yt-navigate-finish', target: topRow, bubbles: true });
  assert.equal(fx.document.getElementById('ytdl-controls-style'), null, 'legacy style removed by syncControls');
  const remaining = topRow.querySelectorAll('[data-ytdl-controls]');
  assert.equal(remaining.length, 1, 'legacy anchor group removed, single extension pill remains');
  assert.equal(remaining[0].getAttribute('data-ytdl-ext'), 'true', 'remaining group is the extension pill');
  assert.equal(remaining[0].querySelectorAll('button').length, 3, 'extension pill keeps segmented buttons');
}

function makePreviewCard(fx, watchId) {
  const previewWrap = fx.document.createElement('div');
  previewWrap.setAttribute('id', 'video-preview');
  const loader = fx.document.createElement('ytd-video-preview-loader');
  const loaderInner = fx.document.createElement('div');
  const inlinePreview = fx.document.createElement('ytd-video-preview');
  const previewLink = fx.document.createElement('a');
  previewLink.setAttribute('href', `/watch?v=${watchId}`);
  inlinePreview.appendChild(previewLink);
  loaderInner.appendChild(inlinePreview);
  loader.appendChild(loaderInner);
  previewWrap.appendChild(loader);
  fx.document.body.appendChild(previewWrap);
  return { previewWrap, loader, loaderInner, inlinePreview };
}

async function testContentGestureState() {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // A preview-card gesture followed immediately (<500ms) by an
  // empty-space or bare-link gesture must yield null, never the
  // stale preview URL from the prior gesture.
  {
    const fx = createContentFixture();
    const responder = fx.messageListeners[0];
    const query = () => {
      let answered = null;
      responder({ type: 'ytdl-get-context-url' }, {}, (r) => { answered = r; });
      return answered.url;
    };
    const { inlinePreview } = makePreviewCard(fx, 'preview999');
    const empty = fx.document.createElement('div');
    fx.document.body.appendChild(empty);
    const bareLink = fx.document.createElement('a');
    bareLink.setAttribute('href', 'https://www.youtube.com/watch?v=bare999');
    fx.document.body.appendChild(bareLink);
    // Gesture 1: full right-click on the preview card.
    fx.setHitStackArr([inlinePreview]);
    inlinePreview.dispatchEvent({ type: 'pointerdown', target: inlinePreview, bubbles: true, button: 2, clientX: 1, clientY: 2 });
    inlinePreview.dispatchEvent({ type: 'contextmenu', target: inlinePreview, bubbles: true, clientX: 1, clientY: 2 });
    assert.equal(query(), 'https://www.youtube.com/watch?v=preview999', 'preview gesture captures the preview URL');
    // Gesture 2: right-click empty space right after (<500ms).
    fx.setHitStackArr([empty]);
    empty.dispatchEvent({ type: 'pointerdown', target: empty, bubbles: true, button: 2, clientX: 3, clientY: 4 });
    empty.dispatchEvent({ type: 'contextmenu', target: empty, bubbles: true, clientX: 3, clientY: 4 });
    assert.equal(query(), null, 'empty-space gesture after a preview gesture yields null, never the stale preview URL');
    // Gesture 3: preview card again.
    fx.setHitStackArr([inlinePreview]);
    inlinePreview.dispatchEvent({ type: 'pointerdown', target: inlinePreview, bubbles: true, button: 2, clientX: 1, clientY: 2 });
    inlinePreview.dispatchEvent({ type: 'contextmenu', target: inlinePreview, bubbles: true, clientX: 1, clientY: 2 });
    assert.equal(query(), 'https://www.youtube.com/watch?v=preview999', 'preview gesture captures the preview URL again');
    // Gesture 4: right-click a bare non-card link right after (<500ms).
    fx.setHitStackArr([bareLink]);
    bareLink.dispatchEvent({ type: 'pointerdown', target: bareLink, bubbles: true, button: 2, clientX: 5, clientY: 6 });
    bareLink.dispatchEvent({ type: 'contextmenu', target: bareLink, bubbles: true, clientX: 5, clientY: 6 });
    assert.equal(query(), null, 'bare-link gesture after a preview gesture yields null, never the stale preview URL');
  }
  // The preview is torn down between pointerdown and mousedown and no
  // contextmenu ever reaches the document: the pointerdown URL survives.
  {
    const fx = createContentFixture();
    const responder = fx.messageListeners[0];
    const { loaderInner, inlinePreview } = makePreviewCard(fx, 'preview999');
    fx.setHitStackArr([inlinePreview]);
    inlinePreview.dispatchEvent({ type: 'pointerdown', target: inlinePreview, bubbles: true, button: 2, clientX: 7, clientY: 8 });
    inlinePreview.remove();
    await sleep(10);
    fx.setHitStackArr([loaderInner]);
    loaderInner.dispatchEvent({ type: 'mousedown', target: loaderInner, bubbles: true, button: 2, clientX: 7, clientY: 8 });
    let after = null;
    responder({ type: 'ytdl-get-context-url' }, {}, (r) => { after = r; });
    assert.equal(after.url, 'https://www.youtube.com/watch?v=preview999', 'mousedown after preview teardown preserves the pointerdown URL without contextmenu');
  }
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
  assert.ok(html.includes('id="audioFormat"'), 'popup has #audioFormat select');
  assert.ok(html.includes('aria-label="Audio format"'), 'audio format select is labelled');
  assert.ok(html.includes('class="select"'), 'selects use themed .select class');
  assert.ok(html.includes('value="best"') && html.includes('Native Opus / M4A (no conversion \u2014 best quality)'), 'best option verbatim');
  assert.ok(html.includes('value="mp3"') && html.includes('MP3 (FFmpeg conversion for legacy devices)'), 'mp3 option verbatim');
  assert.ok(html.includes('value="m4a"') && html.includes('M4A / AAC (native when available)'), 'm4a option verbatim');
  assert.ok(html.includes('value="ogg"') && html.includes('Ogg Vorbis'), 'ogg option verbatim');
  assert.ok(html.includes('value="flac"') && html.includes('FLAC'), 'flac option verbatim');
  assert.ok(html.includes('id="mp3QualityRow"'), 'popup has #mp3QualityRow');
  assert.ok(html.includes('sub-row'), 'mp3 row uses .sub-row');
  assert.ok(/id="mp3QualityRow"[^>]*hidden/.test(html) || /hidden[^>]*id="mp3QualityRow"/.test(html), 'mp3 row starts hidden');
  assert.ok(html.includes('for="mp3Quality"') && html.includes('MP3 quality'), 'mp3 row has labelled quality control');
  assert.ok(html.includes('id="mp3Quality"') && html.includes('aria-label="MP3 quality"'), 'mp3 quality select is labelled');
  assert.ok(html.includes('value="V0"') && html.includes('V0 (~245 kbps VBR \u2014 Recommended)'), 'V0 option verbatim');
  assert.ok(html.includes('value="320k"') && html.includes('320 kbps CBR (maximum size)'), '320k option verbatim');
  assert.ok(html.includes('value="V2"') && html.includes('V2 (~190 kbps VBR \u2014 balanced)'), 'V2 option verbatim');
  assert.ok(html.includes('value="128k"') && html.includes('128 kbps CBR (compact / speech)'), '128k option verbatim');
  assert.ok(html.includes('id="formatNote"'), 'popup has #formatNote');
  assert.ok(html.includes('id="rsgainMissingNote"'), 'popup has #rsgainMissingNote');
  assert.ok(html.includes('warn-note'), 'missing-rsgain note uses .warn-note');
  assert.ok(/id="rsgainMissingNote"[^>]*hidden/.test(html) || /hidden[^>]*id="rsgainMissingNote"/.test(html), 'rsgain note starts hidden');
  assert.ok(html.indexOf('id="rsgain"') < html.indexOf('id="rsgainMissingNote"'), 'rsgain note sits under the ReplayGain toggle');
  assert.ok(html.indexOf('id="rsgainMissingNote"') < html.indexOf('id="audioFormat"'), 'rsgain note precedes the audio format section');
  assert.ok(css.includes('.select'), 'popup styles themed selects');
  assert.ok(css.includes('var(--input-bg)') && css.includes('var(--fg)') && css.includes('var(--line)') && css.includes('var(--focus)'), 'selects match input theme tokens');
  assert.ok(css.includes('.sub-row'), 'popup styles .sub-row');
  assert.ok(css.includes('.sub-label'), 'popup styles .sub-label');
  assert.ok(css.includes('.warn-note') && css.includes('var(--bad)'), 'warn-note uses danger token');
  assert.ok(js.includes('lastDeps'), 'popup tracks lastDeps from ping/get_config');
  assert.ok(js.includes('rsgainMissingNote'), 'popup drives #rsgainMissingNote');
  assert.ok(js.includes('audioFormat'), 'popup drives #audioFormat');
  assert.ok(js.includes('mp3Quality'), 'popup drives #mp3Quality');
  assert.ok(js.includes('formatNote'), 'popup drives #formatNote');
  assert.ok(js.includes('mp3QualityRow'), 'popup toggles #mp3QualityRow');
  assert.ok(js.includes('audio_format'), 'popup sends audio_format in set_config');
  assert.ok(js.includes('mp3_quality'), 'popup sends mp3_quality in set_config');
  assert.ok(js.includes('pushConfig') || js.includes('audio_format'), 'popup groups audio prefs in pushConfig');
  assert.ok(js.includes('rsgain is not installed'), 'rsgain guard explains the missing binary');
  assert.ok(js.includes('sudo apt install rsgain'), 'rsgain guard shows apt install hint');
  assert.ok(js.includes('brew install rsgain'), 'rsgain guard shows brew hint');
  assert.ok(js.includes('winget install complexlogic.rsgain'), 'rsgain guard shows winget hint');
  assert.ok(js.includes('lastDeps') && js.includes('rsgain') && js.includes('=== false'), 'rsgain guard checks lastDeps.rsgain === false');
}

function createPopupFixture(pingResponse) {
  const elements = new Map();
  const nativeCalls = [];
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
  for (const id of ['statusText', 'statusDot', 'connectedView', 'setupView', 'autoTag', 'rsgain', 'rsgainMissingNote', 'audioFormat', 'mp3Quality', 'mp3QualityRow', 'formatNote', 'customDir', 'effectiveDir', 'depsLine', 'installCmd', 'copyBtn', 'retryBtn', 'copyNote', 'ytdlpUpdateNote', 'ytdlpUpdateText', 'ytdlpUpdateHint']) {
    mockEl(id);
  }
  const folderRadios = ['keep', 'music', 'downloads', 'custom'].map((value) => ({
    value,
    checked: false,
    listeners: {},
    addEventListener(type, fn) {
      if (!this.listeners[type]) this.listeners[type] = [];
      this.listeners[type].push(fn);
    },
  }));
  const document = {
    getElementById: (id) => mockEl(id),
    querySelector: (sel) => {
      if (sel === '.panel') return { setAttribute() {}, getAttribute() { return null; } };
      if (sel === 'input[name="folder"]:checked') return folderRadios.find((r) => r.checked) || null;
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel === 'input[name="folder"]') return folderRadios;
      return [];
    },
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
      sendNativeMessage: async (host, msg) => {
        nativeCalls.push({ host, msg });
        if (msg && msg.action === 'set_config') {
          const merged = { ...(pingResponse.config || {}), ...(msg.config || {}) };
          return { ...pingResponse, ok: true, config: merged, deps: pingResponse.deps || {} };
        }
        return pingResponse;
      },
    },
  };
  const context = {
    document, window, browser, chrome: undefined, navigator: {}, console, URLSearchParams, setTimeout, clearTimeout, URL,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(EXT, 'popup.js'), 'utf8'), context, { filename: 'popup.js' });
  return { document, elements, folderRadios, nativeCalls, triggerReady: () => { if (document._domReady) document._domReady(); } };
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

async function testPopupAudioFormatAndRsgainGuard() {
  const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function fire(el, type) {
    const fns = (el.listeners && el.listeners[type]) || [];
    for (const fn of fns) await fn({ target: el });
  }
  // rsgain missing: toggle ON is blocked, note shown, no rsgain:true sent.
  {
    const fx = createPopupFixture({
      ok: true,
      version: '2.2.0',
      config: { auto_tag: true, rsgain: false, audio_format: 'best', mp3_quality: 'V0' },
      deps: { yt_dlp: true, ffmpeg: true, rsgain: false },
      effective_download_dir: '/home/user/Music/Youtube Downloads',
      ytdlp_config_exists: true,
      yt_dlp_status: { outdated: false },
    });
    fx.triggerReady();
    await tick(30);
    assert.equal(fx.elements.get('audioFormat').value, 'best', 'renderConnected populates audioFormat');
    assert.equal(fx.elements.get('mp3Quality').value, 'V0', 'renderConnected populates mp3Quality');
    assert.equal(fx.elements.get('mp3QualityRow').hidden, true, 'mp3 row hidden unless mp3 selected');
    assert.ok(fx.elements.get('formatNote').textContent.includes('native Opus or M4A'), 'best note explains native stream');
    assert.equal(fx.elements.get('rsgainMissingNote').hidden, true, 'missing-rsgain note hidden until toggle attempt');
    const rsgainEl = fx.elements.get('rsgain');
    rsgainEl.checked = true;
    await fire(rsgainEl, 'change');
    await tick(10);
    assert.equal(rsgainEl.checked, false, 'blocked toggle resets to off');
    const note = fx.elements.get('rsgainMissingNote');
    assert.equal(note.hidden, false, 'blocked toggle reveals the missing-rsgain note');
    assert.ok(note.textContent.includes('rsgain is not installed'), 'note explains the missing binary');
    assert.ok(note.textContent.includes('sudo apt install rsgain'), 'note shows apt hint');
    assert.ok(note.textContent.includes('brew install rsgain'), 'note shows brew hint');
    assert.ok(note.textContent.includes('winget install complexlogic.rsgain'), 'note shows winget hint');
    const sentTrue = fx.nativeCalls.some((c) => c.msg && c.msg.action === 'set_config' && c.msg.config && c.msg.config.rsgain === true);
    assert.equal(sentTrue, false, 'no set_config with rsgain:true while rsgain is missing');
  }
  // rsgain present: toggle ON succeeds and the note stays hidden.
  {
    const fx = createPopupFixture({
      ok: true,
      version: '2.2.0',
      config: { auto_tag: true, rsgain: false, audio_format: 'best', mp3_quality: 'V0' },
      deps: { yt_dlp: true, ffmpeg: true, rsgain: true },
      effective_download_dir: '/home/user/Music/Youtube Downloads',
      ytdlp_config_exists: true,
      yt_dlp_status: { outdated: false },
    });
    fx.triggerReady();
    await tick(30);
    assert.equal(fx.elements.get('rsgainMissingNote').hidden, true, 'note hidden when rsgain is available');
    const rsgainEl = fx.elements.get('rsgain');
    rsgainEl.checked = true;
    await fire(rsgainEl, 'change');
    await tick(10);
    const sent = fx.nativeCalls.find((c) => c.msg && c.msg.action === 'set_config' && c.msg.config && c.msg.config.rsgain === true);
    assert.ok(sent, 'set_config sends rsgain:true when the binary is present');
    assert.equal(fx.elements.get('rsgainMissingNote').hidden, true, 'note stays hidden when rsgain is available');
  }
  // audio format: mp3 reveals the quality row; switching away hides it again.
  {
    const fx = createPopupFixture({
      ok: true,
      version: '2.2.0',
      config: { auto_tag: true, rsgain: false, audio_format: 'mp3', mp3_quality: '320k' },
      deps: { yt_dlp: true, ffmpeg: true, rsgain: true },
      effective_download_dir: '/home/user/Music/Youtube Downloads',
      ytdlp_config_exists: true,
      yt_dlp_status: { outdated: false },
    });
    fx.triggerReady();
    await tick(30);
    assert.equal(fx.elements.get('audioFormat').value, 'mp3', 'renderConnected populates mp3');
    assert.equal(fx.elements.get('mp3Quality').value, '320k', 'renderConnected populates mp3 quality');
    assert.equal(fx.elements.get('mp3QualityRow').hidden, false, 'mp3 row visible for mp3');
    assert.ok(fx.elements.get('formatNote').textContent.includes('MP3 via FFmpeg'), 'mp3 note explains conversion');
    fx.nativeCalls.length = 0;
    const audioEl = fx.elements.get('audioFormat');
    audioEl.value = 'flac';
    await fire(audioEl, 'change');
    await tick(10);
    assert.equal(fx.elements.get('mp3QualityRow').hidden, true, 'mp3 row hidden for flac');
    assert.ok(fx.elements.get('formatNote').textContent.length > 10, 'format note updates for flac');
    const last = [...fx.nativeCalls].reverse().find((c) => c.msg && c.msg.action === 'set_config');
    assert.ok(last, 'audio change sends set_config');
    assert.equal(last.msg.config.audio_format, 'flac', 'set_config carries audio_format');
    assert.ok(last.msg.config.mp3_quality, 'set_config carries mp3_quality');
    audioEl.value = 'mp3';
    await fire(audioEl, 'change');
    await tick(10);
    assert.equal(fx.elements.get('mp3QualityRow').hidden, false, 'mp3 row returns for mp3');
    const qEl = fx.elements.get('mp3Quality');
    qEl.value = 'V2';
    await fire(qEl, 'change');
    await tick(10);
    const qLast = [...fx.nativeCalls].reverse().find((c) => c.msg && c.msg.action === 'set_config' && c.msg.config && c.msg.config.mp3_quality === 'V2');
    assert.ok(qLast, 'quality change sends mp3_quality V2');
  }
}

function testSignScript() {
  const sh = readFile('scripts/sign-xpi.sh');
  assertAsciiNoEmoji('scripts/sign-xpi.sh', sh);
  assert.ok(sh.includes('AMO_JWT_ISSUER'), 'sign script checks the AMO issuer');
  assert.ok(sh.includes('AMO_JWT_SECRET'), 'sign script checks the AMO secret');
  assert.ok(sh.includes('-n'), 'sign script validates non-empty credentials');
  assert.ok(!/echo[^\n]*\$.*AMO_JWT/.test(sh), 'sign script never echoes either secret value');
  assert.ok(!/print[^\n]*\$.*AMO_JWT/.test(sh), 'sign script never prints either secret value');
  assert.ok(sh.includes('npx --yes web-ext sign'), 'sign script signs via npx web-ext');
  assert.ok(sh.includes('--source-dir') && sh.includes('extension'), 'sign script points at the extension source dir');
  assert.ok(sh.includes('--artifacts-dir') && sh.includes('web-ext-artifacts'), 'sign script stages signed builds under web-ext-artifacts');
  assert.ok(sh.includes('--channel=unlisted'), 'sign script uses the unlisted channel');
  assert.ok(sh.includes('WEB_EXT_API_KEY') && sh.includes('WEB_EXT_API_SECRET'), 'sign script passes AMO credentials via env vars so npx never logs them');
  assert.ok(sh.includes('python3 -m zipfile -t'), 'sign script validates the signed xpi');
  assert.ok(sh.includes('trap') && sh.includes('.amo-upload-uuid'), 'sign script traps EXIT to remove the uuid artifact');
  assert.ok(sh.includes('firefox-youtube-downloader-signed.xpi'), 'sign script copies the signed artifact to dist');
  const stat = fs.statSync(path.join(ROOT, 'scripts', 'sign-xpi.sh'));
  assert.ok(stat.mode & 0o111, 'sign script is executable');
  const gi = readFile('.gitignore');
  assert.ok(gi.split('\n').some((line) => line.trim() === 'web-ext-artifacts/' || line.trim() === 'web-ext-artifacts'), '.gitignore lists web-ext-artifacts/');
  assert.ok(gi.split('\n').some((line) => line.trim() === 'extension/.amo-upload-uuid'), '.gitignore lists extension/.amo-upload-uuid');
  const os = require('node:os');
  const signed = path.join(ROOT, 'dist', 'firefox-youtube-downloader-signed.xpi');
  const artifactsDir = path.join(ROOT, 'web-ext-artifacts');
  const uuidFile = path.join(ROOT, 'extension', '.amo-upload-uuid');
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sign-xpi-backup-'));
  const backupSigned = path.join(backupDir, 'signed.xpi');
  const backupArtifacts = path.join(backupDir, 'web-ext-artifacts');
  const backupUuid = path.join(backupDir, 'amo-upload-uuid');
  const hadSigned = fs.existsSync(signed);
  const hadArtifacts = fs.existsSync(artifactsDir);
  const hadUuid = fs.existsSync(uuidFile);
  let tmp = null;
  try {
    if (hadSigned) fs.copyFileSync(signed, backupSigned);
    if (hadArtifacts) { fs.cpSync(artifactsDir, backupArtifacts, { recursive: true }); fs.rmSync(artifactsDir, { recursive: true, force: true }); }
    if (hadUuid) fs.copyFileSync(uuidFile, backupUuid);
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sign-xpi-test-'));
    const binDir = path.join(tmp, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const stub = path.join(binDir, 'npx');
    const maker = path.join(tmp, 'make_xpi.py');
    fs.writeFileSync(maker, 'import sys, zipfile\np = sys.argv[1]\nwith zipfile.ZipFile(p, "w", zipfile.ZIP_DEFLATED) as z:\n    z.writestr("manifest.json", "{}")\n');
    const stubLines = [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'art=""',
      'src=""',
      'prev=""',
      'for arg in "$@"; do',
      '  if [ "$prev" = "--artifacts-dir" ]; then art="$arg"; fi',
      '  if [ "$prev" = "--source-dir" ]; then src="$arg"; fi',
      '  prev="$arg"',
      'done',
      'mkdir -p "$art"',
      'if [ -n "$src" ]; then echo stub-uuid > "$src/.amo-upload-uuid"; fi',
    ];
    stubLines.push('python3 "' + maker + '" "$art/stub-signed.xpi"');
    fs.writeFileSync(stub, stubLines.join('\n') + '\n');
    fs.chmodSync(stub, 0o755);
    const env = { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}`, AMO_JWT_ISSUER: 'test-issuer', AMO_JWT_SECRET: 'test-secret' };
    const out = require('node:child_process').execFileSync('bash', [path.join(ROOT, 'scripts', 'sign-xpi.sh')], { cwd: ROOT, env, encoding: 'utf8' });
    assert.ok(out.includes('firefox-youtube-downloader-signed.xpi'), 'sign script prints the signed output path');
    assert.ok(fs.existsSync(signed), 'stubbed sign produces the dist artifact');
    require('node:child_process').execFileSync('python3', ['-m', 'zipfile', '-t', signed], { stdio: 'ignore' });
    assert.ok(!fs.existsSync(uuidFile), 'sign script removes extension/.amo-upload-uuid on exit');
    let failed = false;
    try {
      require('node:child_process').execFileSync('bash', [path.join(ROOT, 'scripts', 'sign-xpi.sh')], { cwd: ROOT, env: { ...process.env, PATH: process.env.PATH, AMO_JWT_ISSUER: '', AMO_JWT_SECRET: '' }, stdio: 'ignore' });
    } catch (_error) {
      failed = true;
    }
    assert.ok(failed, 'sign script fails without AMO credentials');
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(artifactsDir, { recursive: true, force: true });
    fs.rmSync(signed, { force: true });
    fs.rmSync(uuidFile, { force: true });
    if (hadSigned) fs.copyFileSync(backupSigned, signed);
    if (hadArtifacts) fs.cpSync(backupArtifacts, artifactsDir, { recursive: true });
    if (hadUuid) fs.copyFileSync(backupUuid, uuidFile);
    fs.rmSync(backupDir, { recursive: true, force: true });
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
  await testContentGestureState();
  testContentTampermonkeyCleanup();
  testPopup();
  await testPopupUpdateNote();
  await testPopupAudioFormatAndRsgainGuard();
  testSignScript();
  testBuildScript();
  console.log('Firefox extension fixture tests passed');
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
