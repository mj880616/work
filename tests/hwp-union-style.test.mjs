import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {pickUnionTemplate,newDocumentFileName,saveLibraryCopy,UNION_TEMPLATE_CATEGORY} from '../app/hwp-drive.js';
// HWP-노조양식: 양식 고르기·새 문서 저장 규칙, 편집기 안 스타일 단축키·버튼(studio-styles.js).

test('the union template is a .hwp in library category 양식; a name hint wins, nothing else is picked', () => {
  const row = (id, title, file_name, category = UNION_TEMPLATE_CATEGORY) => ({id, title, file_name, category});
  assert.equal(pickUnionTemplate([]).chosen, null);
  assert.equal(pickUnionTemplate([row('a', '주간', 'w.hwp', '회의')]).chosen, null);
  assert.equal(pickUnionTemplate([row('a', '주간', 'w.hwpx')]).chosen, null);
  const two = pickUnionTemplate([row('a', '주간보고 틀', 'w.hwp'), row('b', '노조 문서 양식', '2018_x.hwp')]);
  assert.equal(two.chosen.id, 'b');
  assert.equal(two.total, 2);
  assert.equal(pickUnionTemplate([row('a', '주간', 'w.hwp')]).chosen.id, 'a');
});

test('a new document file name keeps the title and drops characters a file name cannot hold', () => {
  assert.equal(newDocumentFileName('11월 상집 회의: 안건/1?'), '11월 상집 회의 안건 1.hwp');
  assert.equal(newDocumentFileName('  '), '새 문서.hwp');
  assert.equal(newDocumentFileName('보고.hwp'), '보고.hwp');
});

test('saving a document started from the template sends only file and title, never the template category', async () => {
  let form;
  const fetcher = async (url, init) => { form = init.body; return {ok: true, status: 200, json: async () => ({ok: true, document: {id: 'new1', title: '내 문서'}})}; };
  const rt = {config: {url: 'https://x.test', key: 'k'}, session: {ensure: async () => true, read: () => ({access_token: 't'})}};
  const target = {kind: 'library', template: true, document: {id: 'tpl', title: '노조 양식', file_name: 'a.hwp', category: UNION_TEMPLATE_CATEGORY, tags: ['노조양식'], project_id: 'p'}};
  const outcome = await saveLibraryCopy(target, new Uint8Array([1, 2, 3]), {rt, fetcher, newTitle: '내 문서'});
  assert.equal(outcome.kind, 'created');
  assert.deepEqual([...form.keys()].sort(), ['file', 'title']);
  assert.equal(form.get('title'), '내 문서');
  assert.equal(form.get('file').name, '내 문서.hwp');
});

// A tiny stand-in for the editor page: the style box, the toolbar track and window key listeners.
function editorPage(names) {
  const listeners = [];
  const changes = [];
  const options = names.map((text, i) => ({value: String(i), textContent: text}));
  const box = {options, value: '0', dispatchEvent(event) { changes.push({type: event.type, value: this.value}); return true; }};
  const made = [];
  const el = (tag) => {
    const node = {tag, children: [], dataset: {}, className: '', listeners: {}, remove() { node.gone = true; },
      append(...kids) { node.children.push(...kids); }, setAttribute() {}, addEventListener(type, fn) { node.listeners[type] = fn; },
      querySelectorAll() { return node.children.filter((c) => c.tag === 'button' && !c.gone); }};
    made.push(node);
    return node;
  };
  const track = el('div');
  const byId = new Map();
  const document = {
    getElementById: (id) => id === 'style-name' ? box : (byId.get(id) || null),
    querySelector: (sel) => sel === '#icon-toolbar .tb-scroll-track' ? track : null,
    createElement: el,
    addEventListener() {},
  };
  const original = track.append.bind(track);
  track.append = (...kids) => { for (const k of kids) if (k.id) byId.set(k.id, k); original(...kids); };
  const window = {addEventListener: (type, fn, capture) => listeners.push({type, fn, capture}), dispatch: null};
  const context = vm.createContext({window, document, Event: class { constructor(type) { this.type = type; } },
    MutationObserver: class { observe() {} }, queueMicrotask: (fn) => fn()});
  vm.runInContext(readFileSync('app/hwp-lab/studio-styles.js', 'utf8'), context);
  const press = (init) => {
    const event = {code: '', key: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, repeat: false, isComposing: false, target: {closest: () => null},
      prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...init};
    for (const l of listeners.filter((x) => x.type === 'keydown')) l.fn(event);
    return event;
  };
  return {press, changes, box, track, listeners};
}
const UNION = ['바탕글', '안건제목', '큰 제목', '중간 제목', '작은 제목', '최하위 제목[강조]', '세부 참고사항', '표내부', '(기타)의결주문', '중간대제목'];

test('Ctrl+1..0 and Alt+1..0 apply the ten union styles by name through the editor style box', () => {
  const page = editorPage(UNION);
  assert.equal(page.listeners.find((l) => l.type === 'keydown').capture, true);
  UNION.forEach((name, i) => {
    const digit = String((i + 1) % 10);
    for (const mod of [{ctrlKey: true}, {altKey: true}]) {
      page.changes.length = 0;
      const event = page.press({code: `Digit${digit}`, key: digit, ...mod});
      assert.equal(event.prevented && event.stopped, true, `${name} ${Object.keys(mod)}`);
      assert.deepEqual(page.changes, [{type: 'change', value: String(i)}], name);
    }
  });
  assert.equal(page.box.value, '9');
});

test('keys are left alone when the style does not exist, with other modifiers, or in a dialog', () => {
  const plain = editorPage(['바탕글', '제목 1']);
  let event = plain.press({code: 'Digit0', key: '0', ctrlKey: true});
  assert.equal(event.prevented, false);
  assert.equal(plain.changes.length, 0);
  const page = editorPage(UNION);
  for (const init of [{code: 'Digit3', ctrlKey: true, shiftKey: true}, {code: 'Digit3'}, {code: 'Digit3', ctrlKey: true, altKey: true}, {code: 'Digit3', ctrlKey: true, metaKey: true}, {code: 'KeyA', ctrlKey: true}, {code: 'Digit3', ctrlKey: true, repeat: true}, {code: 'Digit3', ctrlKey: true, target: {closest: () => ({})}}]) {
    event = page.press(init);
    assert.equal(event.prevented, false, JSON.stringify(init));
  }
  assert.equal(page.changes.length, 0);
});

test('the style button row appears only for union styles, one button per style found, each applying its style', () => {
  const none = editorPage(['바탕글x']);
  assert.equal(none.track.children.length, 0);
  const page = editorPage(UNION.slice(0, 3));
  const group = page.track.children[0];
  const buttons = group.children.filter((c) => c.tag === 'button');
  assert.equal(buttons.length, 3);
  assert.deepEqual(buttons.map((b) => b.dataset.styleName), ['바탕글', '안건제목', '큰 제목']);
  buttons[2].listeners.click({stopPropagation() {}});
  assert.deepEqual(page.changes, [{type: 'change', value: '2'}]);
  let prevented = false;
  buttons[0].listeners.mousedown({preventDefault() { prevented = true; }});
  assert.equal(prevented, true);
});

test('the editor page loads the style script right after the storage guard; the build script does the same', () => {
  const html = readFileSync('app/hwp-lab/rhwp-0.8.7/studio/index.html', 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(scripts.slice(0, 2), ['../../studio-guard.js', '../../studio-styles.js']);
  assert.match(readFileSync('scripts/hwp-lab/finalize-rhwp-studio.mjs', 'utf8'), /studio-guard\.js"><\/script>\\n\s+<script src="\.\.\/\.\.\/studio-styles\.js">/);
  const source = readFileSync('app/hwp-lab/studio-styles.js', 'utf8');
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|https?:\/\//);
});
