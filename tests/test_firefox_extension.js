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
  assert.equal(manifest.name, 'Huginn Downloader');
  assert.equal(manifest.homepage_url, 'https://github.com/Lakis01/Huginn-Downloader');
  assert.equal(manifest.browser_specific_settings.gecko.id, 'firefox-youtube-downloader@lakis01.github.io');
  assert.equal(manifest.browser_specific_settings.gecko.strict_min_version, '115.0');
  assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions, { required: ['none'] });
  assert.equal(manifest.version, '2.5.5', 'manifest version is 2.5.5');
  assert.deepEqual(manifest.browser_action.default_icon, {
    16: 'icons/huginn-logo.svg',
    32: 'icons/huginn-logo.svg',
  });
  assert.deepEqual(manifest.icons, {
    16: 'icons/huginn-logo.svg',
    32: 'icons/huginn-logo.svg',
    48: 'icons/huginn-logo.svg',
    96: 'icons/huginn-logo.svg',
  });
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

function testReadmeBrandAndSetupGuidance() {
  const readme = readFile('README.md');
  const normalizedReadme = readme.toLowerCase().replace(/\s+/g, ' ');
  assert.ok(readme.startsWith('# Huginn Downloader'), 'README uses the visible project brand');
  assert.ok(readme.includes('docs/logo/huginn-logo.webp'), 'README displays the transparent WebP logo on GitHub');
  for (const shot of ['docs/screenshots/watch-page-pill.png', 'docs/screenshots/context-menu.png', 'docs/screenshots/toolbar-popup.png']) {
    assert.ok(readme.includes(shot), `README embeds ${shot}`);
    assert.ok(fs.existsSync(path.join(ROOT, shot)), `${shot} exists on disk`);
  }
  assert.ok(!readme.includes('predates the v2.5.1 rebrand'), 'stale pre-rebrand screenshot disclaimer is removed');
  assert.ok(readme.includes('huginn-companion_2.5.5_all.deb'), 'README points Linux package examples to 2.5.5');
  assert.ok(
    normalizedReadme.includes('in parallel') && normalizedReadme.includes('without waiting for'),
    'README explains that multiple downloads can run in parallel without waiting'
  );
  assert.ok(readme.includes('Pin Huginn Downloader to the toolbar'), 'README tells users to pin the extension');
  assert.ok(normalizedReadme.includes('both the firefox extension and the local companion'), 'README explains both parts are required');
  assert.ok(readme.includes('CachyOS') && readme.includes('KDE'), 'README lists CachyOS + KDE testing');
  assert.ok(readme.includes('LMDE 7') && readme.includes('Cinnamon'), 'README lists LMDE 7 + Cinnamon testing');
  assert.ok(readme.includes('Debian 13') && readme.includes('GNOME'), 'README lists Debian 13 + GNOME testing');
  assert.ok(readme.includes('does not grant download rights'), 'README avoids claiming legal immunity');
  assert.ok(readme.includes('scripts/sign-xpi-kwallet.sh'), 'README documents keyring-backed signing');
  assert.ok(readme.includes('KWallet Manager'), 'README documents manual local keyring enrollment');
  assert.ok(readme.includes('AMO_JWT_ISSUER') && readme.includes('AMO_JWT_SECRET'), 'README names the two wallet entries');
  assert.ok(!readme.includes('scripts/setup-amo-credentials-kwallet.sh'), 'README does not ask the setup script to read credentials');
  assert.ok(normalizedReadme.includes('other processes running as the same user'), 'README states the local keyring trust boundary');
}

// --- icons ---
function testIcons() {
  assert.ok(!fs.existsSync(path.join(ICONS, 'plugin.svg')), 'simplified plugin.svg is removed');
  for (const name of ['huginn-logo.svg', 'audio.svg', 'video.svg', 'cut.svg']) {
    const raw = readFile(`extension/icons/${name}`);
    assert.ok(raw.includes('<svg'), `${name} has an svg root`);
    assertAsciiNoEmoji(`extension/icons/${name}`, raw);
  }
  const logo = readFile('extension/icons/huginn-logo.svg');
  assert.equal(logo, readFile('docs/logo/huginn-logo.svg'), 'toolbar icon matches docs/logo/huginn-logo.svg');
  assert.match(logo, /<title[^>]*>Huginn Downloader raven<\/title>/, 'toolbar icon is named for the raven brand');
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
function created_items_omit_patterns(src) {
  const lines = src.split('\n').filter((l) => !l.trim().startsWith('//'));
  const code = lines.join('\n');
  return !code.includes('documentUrlPatterns:') && !code.includes('targetUrlPatterns:');
}
function testBackgroundStatic() {
  const src = readFile('extension/background.js');
  assertAsciiNoEmoji('extension/background.js', src);
  for (const id of ['ytdl-root', 'ytdl-audio', 'ytdl-video', 'ytdl-cut']) {
    assert.ok(src.includes(`"${id}"`) || src.includes(`'${id}'`), `background creates ${id}`);
  }
  assert.ok(src.includes('Huginn Downloader'), 'root title is Huginn Downloader');
  assert.ok(src.includes('"Audio"') || src.includes("'Audio'"), 'audio title');
  assert.ok(src.includes('"Video"') || src.includes("'Video'"), 'video title');
  assert.ok(src.includes('Cut Audio'), 'cut title');
  assert.ok(src.includes('icons/huginn-logo.svg'), 'root uses huginn-logo.svg icon');
  assert.ok(src.includes('icons/audio.svg'), 'audio item uses audio icon');
  assert.ok(src.includes('icons/video.svg'), 'video item uses video icon');
  assert.ok(src.includes('icons/cut.svg'), 'cut item uses cut icon');
  assert.ok(src.includes('removeAll'), 'menu setup clears stale persisted menus (always present like Play in MPV)');
  assert.ok(src.includes('removeAll'), 'menu setup clears stale persisted menus before creating');
  assert.ok(created_items_omit_patterns(src), 'menu creation omits URL pattern properties');
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
  const menuOrder = [];
  const handlers = { clicked: null, shown: null, message: null, installed: null, startup: null };
  const listenerCounts = { clicked: 0, shown: 0, message: 0, installed: 0, startup: 0 };
  const calls = { nativeMessages: [], tabsCreated: [], sentTabMessages: [], updates: [], refreshes: 0 };
  let nativeShouldReject = false;
  let nativeResponse = { ok: true, launched: true };
  let tabMessageResponse = { url: 'https://www.youtube.com/watch?v=ctx123' };
  const browser = {
    menus: {
      removeAll() { menuOrder.push('removeAll'); return Promise.resolve(); },
      create(item) { menuOrder.push(`create:${item.id}`); created.push(item); return Promise.resolve(item.id); },
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
    menuOrder,
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
  assert.equal(byId.get('ytdl-root').title, 'Huginn Downloader');
  assert.equal(JSON.stringify(byId.get('ytdl-root').icons), JSON.stringify({ 16: 'icons/huginn-logo.svg', 32: 'icons/huginn-logo.svg' }));
  assert.equal(byId.get('ytdl-audio').parentId, 'ytdl-root');
  assert.equal(byId.get('ytdl-audio').title, 'Audio');
  assert.equal(byId.get('ytdl-video').title, 'Video');
  assert.equal(byId.get('ytdl-cut').title, 'Cut Audio');
  const expectedPatterns = [];
  for (const [id, item] of byId) {
    assert.ok(!('documentUrlPatterns' in item), `${id} omits documentUrlPatterns`);
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
  const expectedPatterns = [];
  assert.equal(created.length, 4, 'four menu items created');
  for (const item of created) {
    assert.ok(!('documentUrlPatterns' in item), `${item.id} omits documentUrlPatterns (always present like Play in MPV)`);
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

async function testBackgroundRemoveAllOrdering() {
  const { created, menuOrder } = runBackgroundFixture();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(menuOrder.length >= 5, 'removeAll plus four creates recorded');
  assert.equal(menuOrder[0], 'removeAll', 'menus.removeAll() completes before any menu creation');
  assert.deepEqual(menuOrder.slice(1, 5), ['create:ytdl-root', 'create:ytdl-audio', 'create:ytdl-video', 'create:ytdl-cut'], 'four menus created sequentially after removal');
  assert.equal(created.length, 4, 'four menu definitions created');
}

async function testBackgroundSrcAndFrameFallbacks() {
  // image srcUrl (plain HTTP(S)) wins over the page URL.
  {
    const { handlers, calls, setTabMessageResponse } = runBackgroundFixture();
    await new Promise((resolve) => setTimeout(resolve, 0));
    setTabMessageResponse({ url: null });
    await handlers.clicked(
      { menuItemId: 'ytdl-video', srcUrl: 'https://i.ytimg.com/vi/src123/hqdefault.jpg', pageUrl: 'https://www.youtube.com/watch?v=page9' },
      { id: 9, url: 'https://www.youtube.com/watch?v=page9' },
    );
    assert.equal(calls.nativeMessages[0].msg.url, 'https://i.ytimg.com/vi/src123/hqdefault.jpg', 'http(s) srcUrl resolves before pageUrl');
  }
  // non-HTTP(S) srcUrl (blob:/data:) is skipped in favor of frameUrl.
  {
    const { handlers, calls, setTabMessageResponse } = runBackgroundFixture();
    await new Promise((resolve) => setTimeout(resolve, 0));
    setTabMessageResponse({ url: null });
    await handlers.clicked(
      { menuItemId: 'ytdl-video', srcUrl: 'blob:https://www.youtube.com/preview-1', frameUrl: 'https://www.youtube.com/embed/frame9', pageUrl: 'https://www.youtube.com/watch?v=page9' },
      { id: 9, url: 'https://www.youtube.com/watch?v=page9' },
    );
    assert.equal(calls.nativeMessages[0].msg.url, 'https://www.youtube.com/embed/frame9', 'non-http srcUrl is skipped for frameUrl');
  }
  // frameUrl applies when no card, link, or usable src target exists.
  {
    const { handlers, calls, setTabMessageResponse } = runBackgroundFixture();
    await new Promise((resolve) => setTimeout(resolve, 0));
    setTabMessageResponse({ url: null });
    await handlers.clicked(
      { menuItemId: 'ytdl-audio', frameUrl: 'https://www.youtube.com/embed/frame7', pageUrl: 'https://www.youtube.com/watch?v=page7' },
      { id: 7, url: 'https://www.youtube.com/watch?v=page7' },
    );
    assert.equal(calls.nativeMessages[0].msg.url, 'https://www.youtube.com/embed/frame7', 'frameUrl falls back before pageUrl');
  }
  // content-card URL still outranks every menu target.
  {
    const { handlers, calls } = runBackgroundFixture();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await handlers.clicked(
      {
        menuItemId: 'ytdl-audio',
        linkUrl: 'https://www.youtube.com/watch?v=link9',
        srcUrl: 'https://i.ytimg.com/vi/src9/hqdefault.jpg',
        frameUrl: 'https://www.youtube.com/embed/frame9',
        pageUrl: 'https://www.youtube.com/watch?v=page9',
      },
      { id: 9, url: 'https://www.youtube.com/watch?v=page9' },
    );
    assert.equal(calls.nativeMessages[0].msg.url, 'https://www.youtube.com/watch?v=ctx123', 'content-card URL outranks link/src/frame/page targets');
  }
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
  assert.ok(!src.includes('data-ytdl-ext'), 'no legacy userscript marker attribute');
  assert.ok(!src.includes('ytdl-controls-style'), 'no legacy userscript style cleanup');
  assert.ok(!src.includes("createElement('a'") && !src.includes('createElement("a"'), 'segments are buttons, not navigating links');
  assert.ok(!src.toLowerCase().includes('userscript'), 'no userscript references in shipping content script');
}

// Minimal DOM fixture to run content.js.
function createContentFixture(options = {}) {
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
  const location = {
    href: options.href || 'https://www.youtube.com/watch?v=abc123',
    hostname: 'www.youtube.com',
    pathname: '/watch',
    origin: 'https://www.youtube.com',
  };
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

function testContentPillMountsOnce() {
  const fx = createContentFixture();
  const topRow = fx.document.querySelector('ytd-watch-metadata').querySelector('#top-row');
  const extGroups = topRow.querySelectorAll('[data-ytdl-controls]');
  assert.equal(extGroups.length, 1, 'one extension pill mounted');
  const duplicate = fx.document.createElement('div');
  duplicate.setAttribute('data-ytdl-controls', 'true');
  topRow.appendChild(duplicate);
  assert.equal(topRow.querySelectorAll('[data-ytdl-controls]').length, 2, 'duplicate group present before sync');
  topRow.dispatchEvent({ type: 'yt-navigate-finish', target: topRow, bubbles: true });
  const remaining = topRow.querySelectorAll('[data-ytdl-controls]');
  assert.equal(remaining.length, 1, 'duplicate groups dedupe to a single extension pill');
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
  assert.ok(html.includes('id="verboseOutput"'), 'popup has a verbose yt-dlp output toggle');
  assert.ok(js.includes('verbose_output'), 'popup persists verbose_output');
  assert.ok(html.includes('Progress and ETA remain visible'), 'toggle explains quiet-mode progress');
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
  const audioOptionsMarkup = html.match(/<select id="audioFormat"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(audioOptionsMarkup, 'audio format options are present');
  const audioOptions = Array.from(audioOptionsMarkup[1].matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g), (match) => [match[1], match[2]]);
  assert.deepEqual(audioOptions, [
    ['best', 'Native (Opus / m4a)'],
    ['mp3', 'MP3'],
    ['m4a', 'M4A / AAC (transcode if not natively available)'],
    ['ogg', 'Ogg Vorbis'],
    ['flac', 'FLAC'],
    ['opus', 'Opus (transcode if not natively available)'],
  ], 'audio format labels clarify native vs transcode behavior');
  assert.ok(html.includes('id="mp3QualityRow"'), 'popup has #mp3QualityRow');
  assert.ok(html.includes('sub-row'), 'mp3 row uses .sub-row');
  assert.ok(/id="mp3QualityRow"[^>]*hidden/.test(html) || /hidden[^>]*id="mp3QualityRow"/.test(html), 'mp3 row starts hidden');
  assert.ok(html.includes('for="mp3Quality"') && html.includes('MP3 quality'), 'mp3 row has labelled quality control');
  assert.ok(html.includes('id="mp3Quality"') && html.includes('aria-label="MP3 quality"'), 'mp3 quality select is labelled');
  assert.ok(html.includes('value="V0"') && html.includes('V0 (~245 kbps VBR \u2014 Recommended)'), 'V0 option verbatim');
  assert.ok(html.includes('value="320k"') && html.includes('320 kbps CBR (maximum size)'), '320k option verbatim');
  assert.ok(html.includes('value="V2"') && html.includes('V2 (~190 kbps VBR \u2014 balanced)'), 'V2 option verbatim');
  assert.ok(html.includes('value="V5"') && html.includes('compact / speech'), 'V5 option verbatim');
  assert.ok(html.includes('id="formatNote"'), 'popup has #formatNote');
  assert.ok(html.includes('id="rsgainMissingNote"'), 'popup has #rsgainMissingNote');
  assert.ok(html.includes('warn-note'), 'missing-rsgain note uses .warn-note');
  assert.ok(/id="rsgainMissingNote"[^>]*hidden/.test(html) || /hidden[^>]*id="rsgainMissingNote"/.test(html), 'rsgain note starts hidden');
  assert.ok(html.indexOf('id="rsgain"') < html.indexOf('id="rsgainMissingNote"'), 'rsgain note sits under the ReplayGain toggle');
  const flowOrder = ['id="audioFormat"', 'id="channelMode"', 'id="autoTag"', 'id="embedThumbnail"', 'id="rsgain"', 'id="downloadFolder"', 'id="longAudioEnabled"'];
  let lastIndex = -1;
  for (const marker of flowOrder) {
    const at = html.indexOf(marker);
    assert.ok(at > lastIndex, `${marker} follows the Operate flow order`);
    lastIndex = at;
  }
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
  assert.ok(js.includes('channel_mode'), 'popup sends channel_mode in set_config');
  assert.ok(!js.includes('mono_audio'), 'popup no longer sends legacy mono_audio');
  assert.ok(html.includes('id="embedThumbnail"'), 'popup has #embedThumbnail toggle');
  assert.ok(html.includes('id="thumbnailJpg"'), 'popup has #thumbnailJpg toggle');
  assert.ok(html.includes('id="channelMode"'), 'popup has #channelMode selector');
  assert.ok(html.includes('aria-label="Channels"'), 'channel selector is labelled');
  assert.ok(html.includes('value="stereo"') && html.includes('Stereo'), 'stereo channel option');
  assert.ok(html.includes('value="ask"') && html.includes('Ask'), 'ask channel option');
  assert.ok(html.includes('value="mono"') && html.includes('Mono'), 'mono channel option');
  assert.ok(!html.includes('id="monoAudio"'), 'legacy mono checkbox replaced by channel selector');
  assert.ok(!html.includes('(on by default)') && !html.includes('(off by default)'), 'no on/off-by-default label suffixes');
  assert.ok(html.includes('id="downloadFolder"'), 'popup has #downloadFolder dropdown');
  assert.ok(html.includes('id="videoDownloadFolder"'), 'popup has a separate #videoDownloadFolder dropdown');
  assert.ok(js.includes('video_download_dir'), 'popup persists a separate video_download_dir');
  assert.ok(html.indexOf('id="downloadFolder"') < html.indexOf('id="longAudioEnabled"'), 'long-audio routing sits underneath the download folder');
  assert.ok(html.includes('id="longAudioEnabled"'), 'popup has #longAudioEnabled toggle');
  assert.ok(html.includes('id="longAudioMinutes"'), 'popup has #longAudioMinutes input');
  assert.ok(html.includes('id="longAudioDir"'), 'popup has #longAudioDir input');
  assert.ok(js.includes('embed_thumbnail'), 'popup sends embed_thumbnail in set_config');
  assert.ok(js.includes('thumbnail_jpg'), 'popup sends thumbnail_jpg in set_config');
  assert.ok(js.includes('channel_mode'), 'popup sends channel_mode in set_config');
  assert.ok(js.includes('long_audio_enabled'), 'popup sends long_audio_enabled in set_config');
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
  for (const id of ['statusText', 'statusDot', 'connectedView', 'setupView', 'autoTag', 'rsgain', 'rsgainMissingNote', 'verboseOutput', 'audioFormat', 'mp3Quality', 'mp3QualityRow', 'formatNote', 'embedThumbnail', 'thumbnailJpg', 'channelMode', 'longAudioEnabled', 'longAudioRow', 'longAudioMinutes', 'longAudioDir', 'downloadFolder', 'customDir', 'effectiveDir', 'videoDownloadFolder', 'customVideoDir', 'effectiveVideoDir', 'depsLine', 'installCmd', 'copyBtn', 'retryBtn', 'copyNote', 'ytdlpUpdateNote', 'ytdlpUpdateText', 'ytdlpUpdateHint']) {
    mockEl(id);
  }
  const document = {
    getElementById: (id) => mockEl(id),
    querySelector: (sel) => {
      if (sel === '.panel') return { setAttribute() {}, getAttribute() { return null; } };
      return null;
    },
    querySelectorAll: (sel) => {
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
  return { document, elements, nativeCalls, triggerReady: () => { if (document._domReady) document._domReady(); } };
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

async function testPopupChannelAndFolder() {
  const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function fire(el, type) {
    const fns = (el.listeners && el.listeners[type]) || [];
    for (const fn of fns) await fn({ target: el });
  }
  const fx = createPopupFixture({
    ok: true,
    version: '2.5.0',
    config: { auto_tag: true, rsgain: false, audio_format: 'best', mp3_quality: 'V0', channel_mode: 'ask', download_dir: '~/Music/Youtube Downloads' },
    deps: { yt_dlp: true, ffmpeg: true, rsgain: true },
    effective_download_dir: '/home/user/Music/Youtube Downloads',
    ytdlp_config_exists: true,
    yt_dlp_status: { outdated: false },
  });
  fx.triggerReady();
  await tick(30);
  assert.equal(fx.elements.get('channelMode').value, 'ask', 'renderConnected populates channelMode');
  assert.equal(fx.elements.get('downloadFolder').value, 'music', 'renderConnected maps download_dir to the music preset');
  assert.equal(fx.elements.get('customDir').hidden, true, 'custom dir hidden for preset folders');
  fx.nativeCalls.length = 0;
  const channelEl = fx.elements.get('channelMode');
  channelEl.value = 'mono';
  await fire(channelEl, 'change');
  await tick(10);
  const channelLast = [...fx.nativeCalls].reverse().find((c) => c.msg && c.msg.action === 'set_config' && c.msg.config && c.msg.config.channel_mode === 'mono');
  assert.ok(channelLast, 'channel change sends set_config with channel_mode mono');
  assert.ok(!('mono_audio' in (channelLast.msg.config || {})), 'channel change never sends legacy mono_audio');
  const folderEl = fx.elements.get('downloadFolder');
  folderEl.value = 'custom';
  await fire(folderEl, 'change');
  await tick(10);
  assert.equal(fx.elements.get('customDir').hidden, false, 'custom dir revealed for custom folder');
  fx.elements.get('customDir').value = '/home/user/Podcasts';
  await fire(fx.elements.get('customDir'), 'change');
  await tick(10);
  const folderLast = [...fx.nativeCalls].reverse().find((c) => c.msg && c.msg.action === 'set_config' && c.msg.config && 'download_dir' in c.msg.config);
  assert.ok(folderLast, 'custom folder change sends set_config with download_dir');
  assert.equal(folderLast.msg.config.download_dir, '/home/user/Podcasts', 'custom download_dir persisted');
}

async function testPopupVideoFolderIsIndependentFromAudioFolder() {
  const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function fire(el, type) {
    const fns = (el.listeners && el.listeners[type]) || [];
    for (const fn of fns) await fn({ target: el });
  }
  const fx = createPopupFixture({
    ok: true,
    version: '2.5.0',
    config: {
      download_dir: '~/Musik/Youtube Downloads',
      video_download_dir: '~/Meine Videos/Youtube Downloads',
      auto_tag: true,
    },
    user_download_directories: {
      music: '~/Musik/Youtube Downloads',
      videos: '~/Meine Videos/Youtube Downloads',
      downloads: '~/Heruntergeladen/Youtube',
    },
    deps: { yt_dlp: true, ffmpeg: true, rsgain: false },
    effective_download_dir: '/home/user/Musik/Youtube Downloads',
    effective_video_download_dir: '/home/user/Meine Videos/Youtube Downloads',
    ytdlp_config_exists: false,
    yt_dlp_status: { outdated: false },
  });
  fx.triggerReady();
  await tick(30);
  assert.equal(fx.elements.get('downloadFolder').value, 'music', 'audio uses the XDG Music preset');
  assert.equal(fx.elements.get('videoDownloadFolder').value, 'videos', 'video uses the XDG Videos preset');
  fx.nativeCalls.length = 0;
  const videoSelect = fx.elements.get('videoDownloadFolder');
  videoSelect.value = 'custom';
  await fire(videoSelect, 'change');
  assert.equal(fx.elements.get('customVideoDir').hidden, false, 'video custom path appears independently');
  fx.elements.get('customVideoDir').value = '/home/user/Archive/Clips';
  await fire(fx.elements.get('customVideoDir'), 'change');
  await tick(10);
  const saved = [...fx.nativeCalls].reverse().find(
    (call) => call.msg && call.msg.action === 'set_config' && call.msg.config && 'video_download_dir' in call.msg.config,
  );
  assert.ok(saved, 'custom video directory is persisted');
  assert.equal(saved.msg.config.video_download_dir, '/home/user/Archive/Clips');
  assert.equal('download_dir' in saved.msg.config, false, 'video change does not overwrite audio directory');
}

async function testPopupVerboseOutputToggleDefaultsOffAndPersists() {
  const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function fire(el, type) {
    const fns = (el.listeners && el.listeners[type]) || [];
    for (const fn of fns) await fn({ target: el });
  }
  const fx = createPopupFixture({
    ok: true,
    version: '2.5.0',
    config: { audio_format: 'best', auto_tag: true, rsgain: false },
    deps: { yt_dlp: true, ffmpeg: true, rsgain: false },
    yt_dlp_status: { outdated: false },
  });
  fx.triggerReady();
  await tick(30);
  const toggle = fx.elements.get('verboseOutput');
  assert.equal(toggle.checked, false, 'quiet output remains the default for old configs');
  toggle.checked = true;
  await fire(toggle, 'change');
  await tick(10);
  const saved = [...fx.nativeCalls].reverse().find(
    (call) => call.msg && call.msg.action === 'set_config' && call.msg.config && 'verbose_output' in call.msg.config,
  );
  assert.ok(saved, 'verbose setting is saved through Native Messaging');
  assert.equal(saved.msg.config.verbose_output, true);
  assert.equal(toggle.checked, true, 'render after save preserves the verbose selection');
}

async function testPopupNormalizesInvalidLongAudioMinutesInBatchedSaves() {
  const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function fire(el, type) {
    const fns = (el.listeners && el.listeners[type]) || [];
    for (const fn of fns) await fn({ target: el });
  }

  for (const invalid of ['0', '-5', 'not-a-number', '1.5']) {
    const fx = createPopupFixture({
      ok: true,
      version: '2.5.0',
      config: { audio_format: 'best', channel_mode: 'stereo', long_audio_minutes: 30 },
      deps: { yt_dlp: true, ffmpeg: true, rsgain: true },
      yt_dlp_status: { outdated: false },
    });
    fx.triggerReady();
    await tick(20);
    fx.nativeCalls.length = 0;
    fx.elements.get('longAudioMinutes').value = invalid;
    fx.elements.get('audioFormat').value = 'flac';
    fx.elements.get('channelMode').value = 'mono';
    fx.elements.get('longAudioEnabled').checked = true;
    await fire(fx.elements.get('audioFormat'), 'change');
    await tick(10);

    const saved = [...fx.nativeCalls].reverse().find(
      (call) => call.msg && call.msg.action === 'set_config'
    );
    assert.ok(saved, `invalid ${invalid} still allows the batch config save`);
    assert.equal(saved.msg.config.long_audio_minutes, 30, `${invalid} is normalized to 30`);
    assert.equal(saved.msg.config.audio_format, 'flac', 'the codec selection is retained');
    assert.equal(saved.msg.config.channel_mode, 'mono', 'the channel selection is retained');
    assert.equal(saved.msg.config.long_audio_enabled, true, 'the toggle is retained');
    assert.equal(fx.elements.get('longAudioMinutes').value, '30', 'the input is corrected');
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
  assert.ok(sh.includes('huginn-signed.xpi'), 'sign script copies the signed artifact to dist');
  const stat = fs.statSync(path.join(ROOT, 'scripts', 'sign-xpi.sh'));
  assert.ok(stat.mode & 0o111, 'sign script is executable');
  const gi = readFile('.gitignore');
  assert.ok(gi.split('\n').some((line) => line.trim() === 'web-ext-artifacts/' || line.trim() === 'web-ext-artifacts'), '.gitignore lists web-ext-artifacts/');
  assert.ok(gi.split('\n').some((line) => line.trim() === 'extension/.amo-upload-uuid'), '.gitignore lists extension/.amo-upload-uuid');
  const os = require('node:os');
  const signed = path.join(ROOT, 'dist', 'huginn-signed.xpi');
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
    assert.ok(out.includes('huginn-signed.xpi'), 'sign script prints the signed output path');
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
  const names = execFileSync('python3', ['-c', 'import sys, zipfile; print("\\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))', archive], { encoding: 'utf8' }).trim().split('\n');
  assert.ok(names.includes('icons/huginn-logo.svg'), 'XPI contains icons/huginn-logo.svg');
  assert.ok(!names.includes('icons/plugin.svg'), 'XPI omits removed icons/plugin.svg');
}

function testContentPlaylistCardsAndWatchPrompt() {
  // Playlist cards extract /playlist?list=... URLs for right-click context downloads.
  {
    const fx = createContentFixture();
    const responder = fx.messageListeners[0];
    const query = () => {
      let answered = null;
      responder({ type: 'ytdl-get-context-url' }, {}, (r) => { answered = r; });
      return answered.url;
    };

    const playlistCard = fx.document.createElement('ytd-playlist-renderer');
    const watchLink = fx.document.createElement('a');
    watchLink.setAttribute('href', '/watch?v=track1&list=PLplaylist123');
    playlistCard.appendChild(watchLink);
    fx.document.body.appendChild(playlistCard);
    fx.setHitStackArr([playlistCard]);
    playlistCard.dispatchEvent({ type: 'contextmenu', target: playlistCard, bubbles: true, clientX: 12, clientY: 14 });
    assert.equal(
      query(),
      'https://www.youtube.com/playlist?list=PLplaylist123',
      'ytd-playlist-renderer card resolves to playlist URL',
    );

    const lockupPlaylist = fx.document.createElement('yt-lockup-view-model');
    const thumbLink = fx.document.createElement('a');
    thumbLink.setAttribute('href', '/watch?v=first9&list=PLlockup456');
    const viewFullLink = fx.document.createElement('a');
    viewFullLink.setAttribute('href', '/playlist?list=PLlockup456');
    lockupPlaylist.appendChild(thumbLink);
    lockupPlaylist.appendChild(viewFullLink);
    fx.document.body.appendChild(lockupPlaylist);
    fx.setHitStackArr([thumbLink, lockupPlaylist]);
    thumbLink.dispatchEvent({ type: 'contextmenu', target: thumbLink, bubbles: true, clientX: 22, clientY: 24 });
    assert.equal(
      query(),
      'https://www.youtube.com/playlist?list=PLlockup456',
      'yt-lockup-view-model playlist card prefers /playlist?list=... link',
    );
  }

  // Non-playlist watch page dispatches immediately without opening a playlist dialog.
  {
    const fx = createContentFixture({ href: 'https://www.youtube.com/watch?v=single123' });
    const buttons = fx.document.querySelector('[data-ytdl-controls]').querySelectorAll('button');
    buttons[0].dispatchEvent({ type: 'click', target: buttons[0], bubbles: true });
    assert.equal(fx.sentMessages.length, 1);
    assert.equal(fx.document.querySelector('[data-ytdl-playlist-dialog]'), null, 'no dialog on non-playlist watch page');
  }

  // Playlist watch page opens prompt, mounts side-panel checkboxes, and syncs two-way with yt-dlp range input.
  {
    const fx = createContentFixture({ href: 'https://www.youtube.com/watch?v=vid2&list=PLabc&index=2' });
    const panel = fx.document.createElement('ytd-playlist-panel-renderer');
    const titles = ['Track One', 'Track Two', 'Track Three', 'Track Four', 'Track Five'];
    titles.forEach((title, idx) => {
      const item = fx.document.createElement('ytd-playlist-panel-video-renderer');
      const link = fx.document.createElement('a');
      link.setAttribute('href', `/watch?v=v${idx + 1}&list=PLabc&index=${idx + 1}`);
      const titleEl = fx.document.createElement('span');
      titleEl.id = 'video-title';
      titleEl.textContent = title;
      link.appendChild(titleEl);
      item.appendChild(link);
      panel.appendChild(item);
    });
    fx.document.body.appendChild(panel);

    const buttons = fx.document.querySelector('[data-ytdl-controls]').querySelectorAll('button');
    // Click Audio -> opens prompt instead of dispatching immediately, and hides Cut.
    buttons[0].dispatchEvent({ type: 'click', target: buttons[0], bubbles: true });
    assert.equal(fx.sentMessages.length, 0, 'playlist watch click prompts before downloading');
    assert.equal(buttons[2].hidden, true, 'Cut button is hidden while playlist selector is open');

    const dialog = fx.document.querySelector('[data-ytdl-playlist-dialog="true"]');
    assert.ok(dialog, 'playlist prompt dialog mounted');
    const panelBar = panel.querySelector('[data-ytdl-panel-bar="true"]');
    assert.ok(panelBar, 'side playlist panel mounts batch control bar');
    const panelDlBtn = panelBar.querySelector('[data-ytdl-panel-download="true"]');
    assert.equal(panelDlBtn.textContent, 'Download all 5 (audio)', 'side panel button shows dynamic item count');
    const sideChecks = fx.document.querySelectorAll('[data-ytdl-side-checkbox="true"]');
    assert.equal(sideChecks.length, 5, 'graphical checkboxes mounted onto side playlist panel items');
    assert.ok(sideChecks.every((box) => box.checked === true), 'all side checkboxes start checked');

    // Panel bar "Deselect all" and "Select all" toggle all checkboxes and label count.
    const panelNoneBtn = panelBar.querySelector('[data-ytdl-panel-select="none"]');
    const panelAllBtn = panelBar.querySelector('[data-ytdl-panel-select="all"]');
    assert.equal(panelNoneBtn.textContent, 'Deselect all');
    assert.equal(panelAllBtn.textContent, 'Select all');
    panelNoneBtn.dispatchEvent({ type: 'click', target: panelNoneBtn, bubbles: true });
    assert.ok(sideChecks.every((box) => box.checked === false), 'Deselect all unchecks all side boxes');
    panelAllBtn.dispatchEvent({ type: 'click', target: panelAllBtn, bubbles: true });
    assert.ok(sideChecks.every((box) => box.checked === true), 'Select all re-checks all side boxes');

    // "This video only" dispatches playlist: false, closes the dialog, and restores Cut.
    const singleBtn = dialog.querySelector('[data-ytdl-scope="single"]');
    singleBtn.dispatchEvent({ type: 'click', target: singleBtn, bubbles: true });
    assert.equal(fx.sentMessages.length, 1);
    assert.equal(fx.sentMessages[0].mode, 'audio');
    assert.equal(fx.sentMessages[0].playlist, false);
    assert.equal(fx.document.querySelector('[data-ytdl-playlist-dialog]'), null, 'dialog closes after single selection');
    assert.equal(fx.document.querySelector('[data-ytdl-panel-bar]'), null, 'side panel toolbar removed on close');
    assert.equal(fx.document.querySelectorAll('[data-ytdl-side-checkbox]').length, 0, 'side checkboxes removed on close');
    assert.equal(buttons[2].hidden, false, 'Cut button is restored when playlist selector closes');

    // Re-open for Video, uncheck item 3 & 5 via side checkboxes -> input becomes "1-2,4".
    buttons[1].dispatchEvent({ type: 'click', target: buttons[1], bubbles: true });
    const dialog2 = fx.document.querySelector('[data-ytdl-playlist-dialog="true"]');
    const sideChecks2 = fx.document.querySelectorAll('[data-ytdl-side-checkbox="true"]');
    const panelDlBtn2 = panel.querySelector('[data-ytdl-panel-download="true"]');
    sideChecks2[2].checked = false;
    sideChecks2[2].dispatchEvent({ type: 'change', target: sideChecks2[2], bubbles: true });
    sideChecks2[4].checked = false;
    sideChecks2[4].dispatchEvent({ type: 'change', target: sideChecks2[4], bubbles: true });

    const itemsInput = dialog2.querySelector('[data-ytdl-playlist-items="true"]');
    assert.equal(itemsInput.value, '1-2,4', 'side checkboxes sync range text in yt-dlp syntax');
    assert.equal(panelDlBtn2.textContent, 'Download 3 selected (video)', 'panel download label reflects checked subset');

    // Typing "1-3, 5" in input syncs back to side checkboxes.
    itemsInput.value = '1-3, 5';
    itemsInput.dispatchEvent({ type: 'input', target: itemsInput, bubbles: true });
    assert.deepEqual(
      sideChecks2.map((b) => Boolean(b.checked)),
      [true, true, true, false, true],
      'yt-dlp range input updates side-panel checkboxes',
    );
    assert.equal(panelDlBtn2.textContent, 'Download 4 selected (video)');

    // Clicking side panel download button dispatches playlist: true and normalized playlistItems.
    panelDlBtn2.dispatchEvent({ type: 'click', target: panelDlBtn2, bubbles: true });
    assert.equal(fx.sentMessages.length, 2);
    assert.equal(fx.sentMessages[1].mode, 'video');
    assert.equal(fx.sentMessages[1].playlist, true);
    assert.equal(fx.sentMessages[1].playlistItems, '1-3,5');
    assert.equal(fx.document.querySelector('[data-ytdl-playlist-dialog]'), null, 'dialog closes after playlist launch');
    assert.equal(buttons[2].hidden, false, 'Cut button is restored after playlist launch');
  }

  // Hover preview over playlist card preserves underlying playlist URL + topVideoUrl and supports choice modal.
  {
    const fx = createContentFixture({ href: 'https://www.youtube.com/watch?v=v1&list=PLabc' });
    const responder = fx.messageListeners[0];
    const panel = fx.document.createElement('ytd-playlist-panel-renderer');
    const panelRow = fx.document.createElement('ytd-playlist-panel-video-renderer');
    const rowLink = fx.document.createElement('a');
    rowLink.setAttribute('href', '/watch?v=v4&list=PLabc&index=4');
    panelRow.appendChild(rowLink);
    panel.appendChild(panelRow);
    fx.document.body.appendChild(panel);

    const previewOverlay = fx.document.createElement('ytd-video-preview');
    const prevLink = fx.document.createElement('a');
    prevLink.setAttribute('href', '/watch?v=toppreview1');
    previewOverlay.appendChild(prevLink);
    const underlyingPlaylist = fx.document.createElement('ytd-playlist-renderer');
    const plLink = fx.document.createElement('a');
    plLink.setAttribute('href', '/playlist?list=PLhover789');
    underlyingPlaylist.appendChild(plLink);
    fx.document.body.appendChild(underlyingPlaylist);
    fx.document.body.appendChild(previewOverlay);

    fx.setHitStackArr([previewOverlay, underlyingPlaylist]);
    previewOverlay.dispatchEvent({ type: 'contextmenu', target: previewOverlay, bubbles: true, clientX: 20, clientY: 25 });
    let ctx = null;
    responder({ type: 'ytdl-get-context-url' }, {}, (r) => { ctx = r; });
    assert.equal(ctx.url, 'https://www.youtube.com/playlist?list=PLhover789');
    assert.equal(ctx.isPlaylist, true);
    assert.equal(ctx.playlistId, 'PLhover789');
    assert.equal(ctx.topVideoUrl, 'https://www.youtube.com/watch?v=toppreview1');

    // Single row inside side panel stays non-playlist single-track target.
    fx.setHitStackArr([panelRow]);
    panelRow.dispatchEvent({ type: 'contextmenu', target: panelRow, bubbles: true, clientX: 22, clientY: 28 });
    let rowCtx = null;
    responder({ type: 'ytdl-get-context-url' }, {}, (r) => { rowCtx = r; });
    assert.equal(rowCtx.url, 'https://www.youtube.com/watch?v=v4&list=PLabc&index=4');
    assert.ok(!rowCtx.isPlaylist, 'individual playlist panel row stays single-track target');

    // Choice modal: "all", "top", and "select" (graphical selection on matching playlist).
    let modalReply = null;
    responder({
      type: 'ytdl-prompt-playlist-choice',
      mode: 'audio',
      url: 'https://www.youtube.com/playlist?list=PLabc',
      playlistUrl: 'https://www.youtube.com/playlist?list=PLabc',
      topVideoUrl: 'https://www.youtube.com/watch?v=topA',
      playlistId: 'PLabc',
    }, {}, (r) => { modalReply = r; });
    assert.equal(modalReply && modalReply.shown, true);
    const modal = fx.document.querySelector('[data-ytdl-context-modal="true"]');
    assert.ok(modal, 'context playlist choice modal rendered');
    const allBtn = modal.querySelector('[data-ytdl-context-action="all"]');
    allBtn.dispatchEvent({ type: 'click', target: allBtn, bubbles: true });
    assert.equal(fx.sentMessages.length, 1);
    assert.equal(fx.sentMessages[0].playlist, true);
    assert.equal(fx.sentMessages[0].url, 'https://www.youtube.com/playlist?list=PLabc');

    responder({
      type: 'ytdl-prompt-playlist-choice',
      mode: 'video',
      url: 'https://www.youtube.com/playlist?list=PLabc',
      playlistUrl: 'https://www.youtube.com/playlist?list=PLabc',
      topVideoUrl: 'https://www.youtube.com/watch?v=topA',
      playlistId: 'PLabc',
    }, {}, () => {});
    const modal2 = fx.document.querySelector('[data-ytdl-context-modal="true"]');
    const topBtn = modal2.querySelector('[data-ytdl-context-action="top"]');
    topBtn.dispatchEvent({ type: 'click', target: topBtn, bubbles: true });
    assert.equal(fx.sentMessages.length, 2);
    assert.equal(fx.sentMessages[1].mode, 'video');
    assert.equal(fx.sentMessages[1].playlist, false);
    assert.equal(fx.sentMessages[1].url, 'https://www.youtube.com/watch?v=topA');

    responder({
      type: 'ytdl-prompt-playlist-choice',
      mode: 'audio',
      url: 'https://www.youtube.com/playlist?list=PLabc',
      playlistUrl: 'https://www.youtube.com/playlist?list=PLabc',
      topVideoUrl: 'https://www.youtube.com/watch?v=v1',
      playlistId: 'PLabc',
    }, {}, () => {});
    const modal3 = fx.document.querySelector('[data-ytdl-context-modal="true"]');
    const selectBtn = modal3.querySelector('[data-ytdl-context-action="select"]');
    selectBtn.dispatchEvent({ type: 'click', target: selectBtn, bubbles: true });
    assert.equal(fx.document.querySelector('[data-ytdl-context-modal]'), null, 'choice modal closes on graphical select');
    assert.ok(fx.document.querySelector('[data-ytdl-playlist-dialog="true"]'), 'graphical playlist dialog opens cleanly');
  }
}

async function testBackgroundPlaylistMessageRelay() {
  const { handlers, calls } = runBackgroundFixture();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await handlers.message({
    type: 'ytdl-trigger-download',
    mode: 'audio',
    url: 'https://www.youtube.com/watch?v=v1&list=PLabc',
    playlist: true,
    playlistItems: '1-3,5',
  });
  assert.equal(calls.nativeMessages.length, 1);
  assert.equal(calls.nativeMessages[0].msg.playlist, true);
  assert.equal(calls.nativeMessages[0].msg.playlist_items, '1-3,5');

  // Batch cut requests are stripped to single-track only.
  await handlers.message({
    type: 'ytdl-trigger-download',
    mode: 'cut',
    url: 'https://www.youtube.com/watch?v=v1&list=PLabc',
    playlist: true,
    playlistItems: '1-3',
  });
  assert.equal(calls.nativeMessages.length, 2);
  assert.equal(calls.nativeMessages[1].msg.mode, 'cut');
  assert.equal(calls.nativeMessages[1].msg.playlist, false);
  assert.equal('playlist_items' in calls.nativeMessages[1].msg, false);
}

async function testBackgroundPlaylistContextPromptAndCutGuard() {
  const { handlers, calls, setTabMessageResponse } = runBackgroundFixture();
  setTabMessageResponse({
    url: 'https://www.youtube.com/playlist?list=PLctx1',
    isPlaylist: true,
    playlistId: 'PLctx1',
    playlistUrl: 'https://www.youtube.com/playlist?list=PLctx1',
    topVideoUrl: 'https://www.youtube.com/watch?v=topctx1&list=PLctx1',
    shown: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  await handlers.clicked(
    { menuItemId: 'ytdl-audio', pageUrl: 'https://www.youtube.com/' },
    { id: 19, url: 'https://www.youtube.com/' },
  );
  assert.equal(calls.nativeMessages.length, 0, 'right-click audio on playlist prompts before downloading');
  assert.equal(calls.sentTabMessages.length, 2);
  assert.equal(calls.sentTabMessages[1].tabId, 19);
  assert.equal(calls.sentTabMessages[1].msg.type, 'ytdl-prompt-playlist-choice');
  assert.equal(calls.sentTabMessages[1].msg.mode, 'audio');
  assert.equal(calls.sentTabMessages[1].msg.playlistId, 'PLctx1');

  await handlers.clicked(
    { menuItemId: 'ytdl-cut', pageUrl: 'https://www.youtube.com/' },
    { id: 19, url: 'https://www.youtube.com/' },
  );
  assert.equal(calls.nativeMessages.length, 1, 'right-click cut on playlist downloads single track directly');
  assert.equal(calls.nativeMessages[0].msg.mode, 'cut');
  assert.equal(calls.nativeMessages[0].msg.url, 'https://www.youtube.com/watch?v=topctx1&list=PLctx1');
  assert.equal(calls.nativeMessages[0].msg.playlist, false);
}

async function testChromiumBuildAndBackground() {
  const buildSh = readFile('scripts/build-chromium.sh');
  assertAsciiNoEmoji('scripts/build-chromium.sh', buildSh);
  execFileSync('bash', [path.join(ROOT, 'scripts', 'build-chromium.sh')], { cwd: ROOT, stdio: 'ignore' });

  const unpackedManifestPath = path.join(ROOT, 'dist', 'huginn-chromium', 'manifest.json');
  const zipPath = path.join(ROOT, 'dist', 'huginn-chromium.zip');
  assert.ok(fs.existsSync(unpackedManifestPath), 'unpacked Chromium manifest.json built');
  assert.ok(fs.existsSync(zipPath), 'Chromium zip archive built');

  const mv3 = JSON.parse(fs.readFileSync(unpackedManifestPath, 'utf8'));
  const ffManifest = JSON.parse(readFile('extension/manifest.json'));
  assert.equal(mv3.manifest_version, 3);
  assert.equal(mv3.version, ffManifest.version);
  assert.deepEqual(mv3.background, { service_worker: 'background.js' });
  assert.ok(mv3.permissions.includes('contextMenus'), 'MV3 uses contextMenus permission');
  assert.ok(mv3.permissions.includes('nativeMessaging'), 'MV3 includes nativeMessaging');
  assert.ok(Array.isArray(mv3.host_permissions) && mv3.host_permissions.includes('*://*.youtube.com/*'));
  assert.equal(mv3.icons['128'], 'icons/huginn-logo-128.png');
  assert.ok(typeof mv3.key === 'string' && mv3.key.length > 100, 'MV3 includes deterministic RSA key');
  const der = Buffer.from(mv3.key, 'base64');
  const hashHex = crypto.createHash('sha256').update(der).digest('hex').slice(0, 32);
  const derivedId = Array.from(hashHex, (c) => String.fromCharCode('a'.charCodeAt(0) + Number.parseInt(c, 16))).join('');
  assert.equal(derivedId, 'hlekndcccbgmhlablldcddddmknkjomg', 'MV3 key yields fixed Chromium extension ID');

  // Re-running build-chromium produces byte-identical zip output.
  const firstHash = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
  execFileSync('bash', [path.join(ROOT, 'scripts', 'build-chromium.sh')], { cwd: ROOT, stdio: 'ignore' });
  const secondHash = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
  assert.equal(secondHash, firstHash, 'Chromium zip build is deterministic');

  // Chromium-only VM fixture (browser undefined, chrome.contextMenus present).
  const src = readFile('extension/background.js');
  const created = [];
  const nativeCalls = [];
  let messageListener = null;
  const chrome = {
    contextMenus: {
      removeAll() { return Promise.resolve(); },
      create(item) { created.push(item); return Promise.resolve(); },
      onClicked: { addListener() {} },
      update() { return Promise.resolve(); },
    },
    tabs: {
      sendMessage() { return Promise.resolve({ url: null }); },
      create() { return Promise.resolve(); },
    },
    runtime: {
      sendNativeMessage(host, msg) {
        nativeCalls.push({ host, msg });
        return Promise.resolve({ ok: true, launched: true });
      },
      onMessage: { addListener(fn) { messageListener = fn; } },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      getURL(p) { return `chrome-extension://hlekndcccbgmhlablldcddddmknkjomg/${p}`; },
    },
  };
  const context = { browser: undefined, chrome, console, setTimeout, clearTimeout, URL };
  vm.createContext(context);
  vm.runInContext(src, context, { filename: 'background.js' });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(created.length, 4, 'Chromium creates four context menu items');
  for (const item of created) {
    assert.equal('icons' in item, false, `Chromium menu item ${item.id} omits Firefox-only icons field`);
  }
  assert.ok(messageListener, 'Chromium registers runtime.onMessage listener');
  const responded = await new Promise((resolve) => {
    const keepChannel = messageListener(
      { type: 'ytdl-trigger-download', mode: 'audio', url: 'https://www.youtube.com/watch?v=cr1' },
      {},
      (reply) => resolve(reply),
    );
    assert.equal(keepChannel, true, 'Chromium sendResponse async path returns true');
  });
  assert.equal(responded.ok, true);
  assert.equal(nativeCalls.length, 1);
}

async function main() {
  testManifest();
  testReadmeBrandAndSetupGuidance();
  testIcons();
  testBackgroundStatic();
  await testBackgroundBehavior();
  await testBackgroundOnboardingFallback();
  await testBackgroundLinkAndPageFallbacks();
  await testBackgroundErrorResponseSkipsOnboarding();
  await testBackgroundStaticMenus();
  await testBackgroundRemoveAllOrdering();
  await testBackgroundSrcAndFrameFallbacks();
  await testBackgroundPlaylistMessageRelay();
  await testBackgroundPlaylistContextPromptAndCutGuard();
  testContentCss();
  testContentStatic();
  testContentBehavior();
  testContentPlaylistCardsAndWatchPrompt();
  await testContentGestureState();
  testContentPillMountsOnce();
  testPopup();
  await testPopupUpdateNote();
  await testPopupAudioFormatAndRsgainGuard();
  await testPopupChannelAndFolder();
  await testPopupVideoFolderIsIndependentFromAudioFolder();
  await testPopupVerboseOutputToggleDefaultsOffAndPersists();
  await testPopupNormalizesInvalidLongAudioMinutesInBatchedSaves();
  testSignScript();
  testBuildScript();
  await testChromiumBuildAndBackground();
  console.log('Firefox extension fixture tests passed');
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
