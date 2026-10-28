import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSelectMode} from '../app/select-mode.js';
import {folderTrail, folderPathHtml} from '../app/folder-path.mjs';

// NOTE-탐색기 후속 ⑦: 자료실·노트가 같은 선택 상태 부품을 쓴다.
test('select mode: start, toggle, shift range from the anchor, prune, stop', () => {
  const s = createSelectMode({router: () => null});
  assert.equal(s.active, false); assert.equal(s.items, null);
  s.start(['b'], 'b');
  assert.equal(s.active, true); assert.deepEqual([...s.items], ['b']); assert.equal(s.anchor, 'b');
  s.range(['a', 'b', 'c', 'd'], 'd');
  assert.deepEqual([...s.items].sort(), ['b', 'c', 'd']);
  s.toggle(['c']);
  assert.equal(s.has('c'), false); assert.equal(s.anchor, 'c');
  s.toggle(['a', 'b'], {anchor: false});
  assert.deepEqual([...s.items].sort(), ['a', 'b', 'd'], 'a group toggles all on when not all are on');
  s.toggle(['a', 'b'], {anchor: false});
  assert.deepEqual([...s.items], ['d'], 'and all off when all are on');
  assert.equal(s.anchor, 'c');
  assert.equal(s.prune(['a', 'b']), true); assert.equal(s.size, 0);
  assert.equal(s.stop(), true); assert.equal(s.active, false); assert.equal(s.anchor, null);
  assert.equal(s.stop(), false);
});

test('select mode: shift without an anchor picks just that one; setting items null ends it', () => {
  const s = createSelectMode({router: () => null}).start();
  s.range(['a', 'b'], 'b');
  assert.deepEqual([...s.items], ['b']); assert.equal(s.anchor, 'b');
  s.items = new Set(['x']);
  assert.deepEqual([...s.items], ['x']);
  s.items = null;
  assert.equal(s.active, false);
});

test('select mode with a layer: opening once, Back ends it, stop closes the layer', () => {
  const log = []; let close = null;
  const router = () => ({layer: {open: (name, opts) => { log.push('open:' + name); close = opts.close; return {close: () => log.push('close')}; }}});
  let backs = 0;
  const s = createSelectMode({layer: 'basket-note-select', router, onBack: () => backs++});
  s.start(['n:1']); s.start(['n:2']);
  assert.deepEqual(log, ['open:basket-note-select']);
  assert.equal(close(), true);
  assert.equal(s.active, false); assert.equal(backs, 1);
  s.start(['n:3']); s.stop();
  assert.deepEqual(log, ['open:basket-note-select', 'open:basket-note-select', 'close']);
  s.start(); s.stop({fromBack: true});
  assert.equal(log.at(-1), 'open:basket-note-select', 'a Back that already removed the layer does not close it again');
});

test('the library and the note screen use the shared select state, not their own Set', () => {
  const lib = readFileSync('app/library-upload.js', 'utf8'), notes = readFileSync('app/basket-notes.js', 'utf8');
  assert.match(lib, /const luPick=createSelectMode\(\);/);
  assert.doesNotMatch(lib, /\bluSel\b|luPickAnchor/);
  assert.match(notes, /createSelectMode\(\{layer:'basket-note-select'/);
  assert.doesNotMatch(notes, /picked = new Set\(\)|selectLayer/);
});

// NOTE-탐색기 후속 ⑧: 위치 줄 한 부품.
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
test('folder path: trail from the top, loops and broken parents stop', () => {
  const folders = [{id: 'a', parent_id: null, name: '개발'}, {id: 'b', parent_id: 'a', name: 'Web2'}, {id: 'c', parent_id: 'b', name: '<노트>'}, {id: 'x', parent_id: 'y', name: '고리1'}, {id: 'y', parent_id: 'x', name: '고리2'}, {id: 'z', parent_id: 'gone', name: '외톨이'}];
  assert.deepEqual(folderTrail(folders, 'c').map(f => f.id), ['a', 'b', 'c']);
  assert.deepEqual(folderTrail(folders, 'x').map(f => f.id), ['y', 'x']);
  assert.deepEqual(folderTrail(folders, 'z').map(f => f.id), ['z']);
  assert.deepEqual(folderTrail(folders, 'none'), []);
  assert.deepEqual(folderTrail(null, 'a'), []);
  const html = folderPathHtml({rootLabel: '노트', trail: folderTrail(folders, 'c'), attr: 'data-nx-at', esc});
  assert.equal(html, '<button type="button" class="fp-step" data-nx-at="">노트</button><span class="fp-sep" aria-hidden="true">›</span><button type="button" class="fp-step" data-nx-at="a">개발</button><span class="fp-sep" aria-hidden="true">›</span><button type="button" class="fp-step" data-nx-at="b">Web2</button><span class="fp-sep" aria-hidden="true">›</span><span class="fp-here" aria-current="location">&lt;노트&gt;</span>');
});

test('the library and the note screen draw the path with the shared part and one style', () => {
  const lib = readFileSync('app/library-upload.js', 'utf8'), notes = readFileSync('app/basket-notes.js', 'utf8');
  assert.match(lib, /folderPathHtml\(\{rootLabel:'자료실',trail:folderTrail\(luFolders_,luInFolder\),attr:'data-lu-path'/);
  assert.match(notes, /folderPathHtml\(\{rootLabel:'노트', trail:path, attr:'data-nx-at'/);
  assert.match(readFileSync('app/base-ui.css', 'utf8'), /\.fp-path\{display:flex/);
  assert.doesNotMatch(readFileSync('app/library-upload.css', 'utf8'), /\.lu-path/);
  assert.doesNotMatch(readFileSync('app/basket.css', 'utf8'), /\.nx-where/);
});
