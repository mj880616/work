import {test} from 'node:test';
import assert from 'node:assert/strict';
// UI-떠있는저장: the floating [저장] decides from three facts only: the panel's own [저장] button is fully seen above the bars,
// the keyboard class is on the body, and the button is disabled. Clicking it clicks the panel's own button once.
const queue = [], listeners = {};
const classes = new Set();
const make = (name, extra = {}) => ({
  name, dataset: {}, attrs: new Map(), isConnected: true, disabled: false, rect: {top: 0, bottom: 0, height: 0}, clicks: 0, handlers: {},
  setAttribute(key, value) { this.attrs.set(key, String(value)); }, getAttribute(key) { return this.attrs.get(key) ?? null; },
  toggleAttribute(key, force) { if (force) this.attrs.set(key, ''); else this.attrs.delete(key); },
  addEventListener(type, fn) { this.handlers[type] = fn; },
  getBoundingClientRect() { return {top: this.rect.top, bottom: this.rect.bottom}; },
  getClientRects() { return this.rect.height ? [{}] : []; },
  click() { this.clicks++; }, append(node) { this.child = node; }, ...extra,
});
const body = make('body', {classList: {contains: name => classes.has(name)}});
let made = null;
globalThis.document = {body, documentElement: make('html'), createElement: () => (made = make('float')), addEventListener() {}};
globalThis.window = {addEventListener: (type, fn) => { listeners[type] = fn; }, visualViewport: null};
globalThis.requestAnimationFrame = fn => { queue.push(fn); return queue.length; };
const flush = () => { while (queue.length) queue.shift()(); };
const {watchFloatSave, refreshFloatSave} = await import('../app/float-save.js');

const original = make('save', {rect: {top: 900, bottom: 940, height: 40}});
let stop = null;
const shown = () => made.dataset.on === 'true';

test('nothing is drawn while no panel is open', () => {
  stop = watchFloatSave(() => null); flush();
  assert.equal(made, null);
  stop();
});

test('original button below the bars: floating button is shown and inert is off', () => {
  stop = watchFloatSave(() => original); flush();
  made.rect = {top: 760, bottom: 792, height: 32};   // the floating button sits above the tabs: limit = 792 + 8
  refreshFloatSave(); flush();
  assert.equal(shown(), true);
  assert.equal(made.attrs.has('inert'), false);
});

test('original button fully seen: floating button hides (never two at once)', () => {
  original.rect = {top: 600, bottom: 640, height: 40};
  refreshFloatSave(); flush();
  assert.equal(shown(), false);
  assert.equal(made.attrs.has('inert'), true);
});

test('original button half under the bars still counts as hidden', () => {
  original.rect = {top: 780, bottom: 820, height: 40};
  refreshFloatSave(); flush();
  assert.equal(shown(), true);
});

test('keyboard open: floating button is hidden even if the original is out of sight', () => {
  classes.add('kptu-mobile-keyboard'); refreshFloatSave(); flush();
  assert.equal(shown(), false);
  classes.delete('kptu-mobile-keyboard'); refreshFloatSave(); flush();
  assert.equal(shown(), true);
});

test('click runs the original button once; a disabled original is not clicked', () => {
  made.handlers.click(); assert.equal(original.clicks, 1);
  original.disabled = true; refreshFloatSave(); flush();
  assert.equal(made.disabled, true);
  made.handlers.click(); assert.equal(original.clicks, 1);
  original.disabled = false;
});

test('original not drawn (panel closed) or disconnected: floating button hides; stop watching hides it too', () => {
  original.rect = {top: 900, bottom: 940, height: 0}; refreshFloatSave(); flush();
  assert.equal(shown(), false);
  original.rect = {top: 900, bottom: 940, height: 40}; refreshFloatSave(); flush();
  assert.equal(shown(), true);
  original.isConnected = false; refreshFloatSave(); flush();
  assert.equal(shown(), false);
  original.isConnected = true; refreshFloatSave(); flush();
  assert.equal(shown(), true);
  stop(); flush();
  assert.equal(shown(), false);
});
