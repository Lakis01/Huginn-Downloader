const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const userscriptPath = path.join(__dirname, '..', 'firefox', 'youtube-ytdlp-buttons.user.js');
assert.ok(fs.existsSync(userscriptPath), 'the YouTube buttons userscript must exist');

class FixtureEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.target = options.target || null;
    this.clientX = options.clientX || 0;
    this.clientY = options.clientY || 0;
    this.bubbles = Boolean(options.bubbles);
    this.defaultPrevented = false;
  }

  preventDefault() {
    this.defaultPrevented = true;
  }
}

class FixtureText {
  constructor(value) {
    this.nodeType = 3;
    this.textContent = String(value);
    this.parentNode = null;
  }
}

class FixtureElement {
  constructor(tagName) {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.childNodes = [];
    this.parentNode = null;
    this.listeners = new Map();
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  get id() {
    return this.getAttribute('id') || '';
  }

  set id(value) {
    this.setAttribute('id', value);
  }

  get className() {
    return this.getAttribute('class') || '';
  }

  set className(value) {
    this.setAttribute('class', value);
  }

  get href() {
    return this.getAttribute('href') || '';
  }

  set href(value) {
    this.setAttribute('href', value);
  }

  get textContent() {
    return this.childNodes.map((child) => child.textContent || '').join('');
  }

  set textContent(value) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    if (String(value)) this.appendChild(new FixtureText(value));
  }

  get children() {
    return this.childNodes.filter((child) => child.nodeType === 1);
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  insertBefore(child, reference) {
    if (child.parentNode) child.parentNode.removeChild(child);
    const index = this.childNodes.indexOf(reference);
    child.parentNode = this;
    if (index < 0) this.childNodes.push(child);
    else this.childNodes.splice(index, 0, child);
    return child;
  }

  removeChild(child) {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) {
      this.childNodes.splice(index, 1);
      child.parentNode = null;
    }
    return child;
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  dispatchEvent(event) {
    if (!event.target) event.target = this;
    let current = this;
    while (current) {
      for (const listener of current.listeners?.get(event.type) || []) listener.call(current, event);
      if (!event.bubbles) break;
      current = current.parentNode;
    }
    return !event.defaultPrevented;
  }

  matches(selector) {
    return selector.split(',').some((candidate) => {
      const tag = candidate.trim().toUpperCase();
      return this.tagName === tag;
    });
  }

  closest(selector) {
    for (let current = this; current; current = current.parentNode) {
      if (current.matches?.(selector)) return current;
    }
    return null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      for (const child of node.children || []) {
        if (matchesSelector(child, selector)) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }
}

function matchesSelector(element, selector) {
  const trimmed = selector.trim();
  if (trimmed.startsWith('#')) return element.id === trimmed.slice(1);
  if (trimmed.startsWith('.')) return element.className.split(/\s+/).includes(trimmed.slice(1));
  const attribute = trimmed.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
  if (attribute) {
    return attribute[2] === undefined
      ? element.hasAttribute(attribute[1])
      : element.getAttribute(attribute[1]) === attribute[2];
  }
  if (trimmed.startsWith('svg')) return element.tagName === 'SVG';
  return element.tagName === trimmed.toUpperCase();
}

class FixtureMutationObserver {
  static instances = [];

  constructor(callback) {
    this.callback = callback;
    FixtureMutationObserver.instances.push(this);
  }

  observe() {}

  trigger() {
    this.callback([{ type: 'childList' }], this);
  }
}

function createFixture() {
  FixtureMutationObserver.instances = [];
  let hitStack = [];
  let lastHitTestPoint = null;
  const document = new FixtureElement('#document');
  document.nodeType = 9;
  document.listeners = new Map();
  document.createElement = (tag) => new FixtureElement(tag);
  document.createElementNS = (_namespace, tag) => new FixtureElement(tag);
  document.createTextNode = (value) => new FixtureText(value);
  document.getElementById = (id) => document.querySelector(`#${id}`);
  document.elementsFromPoint = (x, y) => {
    lastHitTestPoint = { x, y };
    return hitStack;
  };
  document.documentElement = new FixtureElement('html');
  document.head = new FixtureElement('head');
  document.body = new FixtureElement('body');
  document.documentElement.appendChild(document.head);
  document.documentElement.appendChild(document.body);
  document.appendChild(document.documentElement);
  document.querySelector = FixtureElement.prototype.querySelector;
  document.querySelectorAll = FixtureElement.prototype.querySelectorAll;

  const location = {
    href: 'https://www.youtube.com/watch?v=mounted001&list=OLD',
    hostname: 'www.youtube.com',
    pathname: '/watch',
    origin: 'https://www.youtube.com',
  };
  const window = { location };
  const timers = new Map();
  let nextTimerId = 0;
  window.setTimeout = (callback) => {
    const timerId = ++nextTimerId;
    timers.set(timerId, callback);
    return timerId;
  };
  window.clearTimeout = (timerId) => timers.delete(timerId);
  window.addEventListener = document.addEventListener.bind(document);
  window.dispatchEvent = document.dispatchEvent.bind(document);

  const topRow = createTopRow(document);
  document.body.appendChild(topRow.metadata);

  const context = {
    window,
    document,
    location,
    URL,
    MutationObserver: FixtureMutationObserver,
    setTimeout: window.setTimeout,
    clearTimeout: window.clearTimeout,
    console,
  };
  vm.runInNewContext(fs.readFileSync(userscriptPath, 'utf8'), context, { filename: userscriptPath });

  return {
    document,
    location,
    window,
    setHitStack(elements) {
      hitStack = elements;
    },
    lastHitTestPoint: () => lastHitTestPoint,
    topRow: () => document.querySelector('ytd-watch-metadata')?.querySelector('#top-row') || null,
    flushTimers() {
      while (timers.size) {
        const [timerId, callback] = timers.entries().next().value;
        timers.delete(timerId);
        callback();
      }
    },
    triggerMutations() {
      for (const observer of FixtureMutationObserver.instances) observer.trigger();
      this.flushTimers();
    },
  };
}

function createTopRow(document) {
  const metadata = document.createElement('ytd-watch-metadata');
  const topRow = document.createElement('div');
  topRow.id = 'top-row';
  const owner = document.createElement('div');
  owner.id = 'owner';
  const subscribe = document.createElement('button');
  subscribe.id = 'subscribe-button';
  owner.appendChild(subscribe);
  const actions = document.createElement('div');
  actions.id = 'actions';
  topRow.appendChild(owner);
  topRow.appendChild(actions);
  metadata.appendChild(topRow);
  return { metadata, topRow, owner, actions };
}

function controls(topRow) {
  return topRow?.querySelectorAll('[data-ytdl-controls]') || [];
}

function assertButtons(group) {
  const links = group.querySelectorAll('a');
  assert.deepEqual(
    links.map((link) => link.textContent.trim()),
    ['Download audio', 'Download video', 'Cut audio'],
  );
  assert.deepEqual(
    links.map((link) => link.getAttribute('aria-label')),
    ['Download audio', 'Download video', 'Cut audio'],
  );
  for (const link of links) {
    assert.equal(link.getAttribute('tabindex'), null, 'anchors remain keyboard-focusable by default');
    assert.ok(link.querySelector('svg'), `${link.getAttribute('aria-label')} has an inline SVG icon`);
  }
  return links;
}

function testGroupPlacementAccessibilityAndUriLaunch() {
  const fixture = createFixture();
  const topRow = fixture.topRow();
  assert.ok(topRow, 'watch metadata contains the player top row');

  const groups = controls(topRow);
  assert.equal(groups.length, 1, 'one control group is mounted');
  const group = groups[0];
  assert.equal(group.getAttribute('role'), 'group');
  assert.equal(group.getAttribute('aria-label'), 'yt-dlp actions');
  assert.deepEqual(
    topRow.children.map((child) => child.id || child.getAttribute('data-ytdl-controls')),
    ['owner', 'true', 'actions'],
    'the control group sits between Subscribe and Like/Dislike actions',
  );

  const links = assertButtons(group);
  fixture.location.href = 'https://www.youtube.com/watch?v=abc123&list=PL456&index=2';
  const encodedUrl = 'https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dabc123%26list%3DPL456%26index%3D2';
  const expectedUris = [
    `yt-dlp://audio?url=${encodedUrl}`,
    `yt-dlp://video?url=${encodedUrl}`,
    `yt-dlp://cut?url=${encodedUrl}`,
  ];
  for (const [index, link] of links.entries()) {
    const navigates = link.dispatchEvent(new FixtureEvent('click', { bubbles: true }));
    assert.equal(navigates, true, 'the direct click is not cancelled');
    assert.equal(link.href, expectedUris[index], 'the link launches the mode URI for the current watch URL');
  }

  const style = fixture.document.head.querySelector('style')?.textContent || '';
  assert.match(style, /:hover/);
  assert.match(style, /:focus-visible/);
  assert.match(style, /outline:\s*2px solid currentColor/);
  assert.match(style, /height:\s*42px/);
  assert.match(style, /min-height:\s*42px/);
  assert.match(style, /padding:\s*0\s+16px/);
  assert.match(style, /border-radius:\s*21px/);
  assert.match(style, /font:\s*500\s+15px/);
  assert.match(style, /width:\s*22px/);
  assert.match(style, /height:\s*22px/);
  assert.match(style, /flex:\s*0\s+0\s+22px/);
  assert.match(style, /--yt-spec-badge-chip-background,\s*#f2f2f2/i);
  assert.match(style, /--yt-spec-text-primary,\s*#0f0f0f/i);
  assert.match(style, /html\[dark\][^{]*\{[^}]*--yt-spec-badge-chip-background,\s*#272727/is);
  assert.match(style, /html\[dark\][^{]*\{[^}]*--yt-spec-text-primary,\s*#f1f1f1/is);
  assert.match(style, /rgba\(0,\s*0,\s*0,\s*\.1\)/);
  assert.match(style, /rgba\(255,\s*255,\s*255,\s*\.1\)/);
}

function testNavigationAndMutationsDoNotDuplicateAndReattach() {
  const fixture = createFixture();
  let topRow = fixture.topRow();
  const sendNavigationEvent = (type) => fixture.document.dispatchEvent(new FixtureEvent(type));

  assert.equal(controls(topRow).length, 1);
  for (let index = 0; index < 3; index += 1) {
    sendNavigationEvent('yt-navigate-finish');
    sendNavigationEvent('yt-page-data-updated');
    fixture.flushTimers();
    fixture.triggerMutations();
    assert.equal(controls(topRow).length, 1, 'navigation and mutation events do not duplicate the group');
  }

  controls(topRow)[0].remove();
  fixture.triggerMutations();
  assert.equal(controls(topRow).length, 1, 'a DOM re-render reattaches the removed group');

  const oldMetadata = fixture.document.querySelector('ytd-watch-metadata');
  oldMetadata.remove();
  const rerendered = createTopRow(fixture.document);
  fixture.document.body.appendChild(rerendered.metadata);
  fixture.triggerMutations();
  assert.equal(controls(rerendered.topRow).length, 1, 'a replacement player row receives one group');
  topRow = rerendered.topRow;

  fixture.location.pathname = '/results';
  fixture.location.href = 'https://www.youtube.com/results?search_query=music';
  sendNavigationEvent('yt-navigate-finish');
  fixture.flushTimers();
  assert.equal(controls(topRow).length, 0, 'leaving watch routes removes the group');

  fixture.location.pathname = '/shorts/short123';
  fixture.location.href = 'https://www.youtube.com/shorts/short123';
  sendNavigationEvent('yt-page-data-updated');
  fixture.flushTimers();
  assert.equal(controls(topRow).length, 1, 'returning to a watch route mounts the group again');
}

function testContextMenuCapturesHoveredCardOrCurrentPage() {
  const fixture = createFixture();
  const card = fixture.document.createElement('ytd-rich-item-renderer');
  const thumbnail = fixture.document.createElement('div');
  const watchLink = fixture.document.createElement('a');
  watchLink.href = '/watch?v=card123&list=PL789';
  thumbnail.appendChild(watchLink);
  card.appendChild(thumbnail);
  fixture.document.body.appendChild(card);

  thumbnail.dispatchEvent(new FixtureEvent('contextmenu', { bubbles: true }));
  assert.equal(
    fixture.window.__ytdlLastContextHref,
    'https://www.youtube.com/watch?v=card123&list=PL789',
    'right-clicking a card records its own absolute watch link',
  );

  const shortCard = fixture.document.createElement('ytd-video-renderer');
  const shortsLink = fixture.document.createElement('a');
  shortsLink.href = '/shorts/short456';
  shortCard.appendChild(shortsLink);
  fixture.document.body.appendChild(shortCard);
  shortsLink.dispatchEvent(new FixtureEvent('contextmenu', { bubbles: true }));
  assert.equal(fixture.window.__ytdlLastContextHref, 'https://www.youtube.com/shorts/short456');

  const outside = fixture.document.createElement('div');
  fixture.document.body.appendChild(outside);
  outside.dispatchEvent(new FixtureEvent('contextmenu', { bubbles: true }));
  assert.equal(
    fixture.window.__ytdlLastContextHref,
    fixture.location.href,
    'right-click outside a card falls back to the current page URL',
  );
}

function testContextMenuHitTestingFindsLockupUnderVideoPreview() {
  const fixture = createFixture();
  const card = fixture.document.createElement('yt-lockup-view-model');
  const watchLink = fixture.document.createElement('a');
  watchLink.href = '/watch?v=lockup123&list=PLoverlay';
  card.appendChild(watchLink);
  fixture.document.body.appendChild(card);

  const preview = fixture.document.createElement('ytd-video-preview');
  fixture.document.body.appendChild(preview);
  fixture.setHitStack([preview, card]);
  preview.dispatchEvent(new FixtureEvent('contextmenu', {
    bubbles: true,
    clientX: 64,
    clientY: 96,
  }));

  assert.equal(
    fixture.window.__ytdlLastContextHref,
    'https://www.youtube.com/watch?v=lockup123&list=PLoverlay',
    'hit-testing skips a video-preview overlay and selects the underlying lockup recommendation',
  );
  assert.deepEqual(fixture.lastHitTestPoint(), { x: 64, y: 96 });
}

function testContextMenuSupportsPlaylistAndMusicVideoCards() {
  const fixture = createFixture();
  const cardCases = [
    ['ytd-playlist-video-renderer', '/watch?v=playlist123', 'https://www.youtube.com/watch?v=playlist123'],
    ['ytd-playlist-panel-video-renderer', '/shorts/shortPlaylist', 'https://www.youtube.com/shorts/shortPlaylist'],
    ['ytmusic-two-row-item-renderer', '/watch?v=music123', 'https://www.youtube.com/watch?v=music123'],
    ['ytmusic-responsive-list-item-renderer', '/watch?v=musicList123', 'https://www.youtube.com/watch?v=musicList123'],
  ];

  for (const [tagName, href, expectedHref] of cardCases) {
    const card = fixture.document.createElement(tagName);
    const link = fixture.document.createElement('a');
    link.href = href;
    card.appendChild(link);
    fixture.document.body.appendChild(card);
    link.dispatchEvent(new FixtureEvent('contextmenu', { bubbles: true }));

    assert.equal(
      fixture.window.__ytdlLastContextHref,
      expectedHref,
      `${tagName} captures its YouTube video destination`,
    );
  }
}

testContextMenuHitTestingFindsLockupUnderVideoPreview();
testGroupPlacementAccessibilityAndUriLaunch();
testNavigationAndMutationsDoNotDuplicateAndReattach();
testContextMenuCapturesHoveredCardOrCurrentPage();
testContextMenuSupportsPlaylistAndMusicVideoCards();
console.log('YouTube userscript fixture tests passed');
