import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {lineCount, pickedToggles} from '../app/chip-rows-model.mjs';

// UI-칩줄두줄(2026-10-31 명진 결정): 앱 전체 칩 줄 = 줄바꿈 두 줄 + [더보기 ▾], 옆으로 미는 칩 줄 없음. 실제 화면 폭 확인은 CI E2E(412·PC).
const app = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');
const read = f => readFileSync(join(app, f), 'utf8');
const noComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '');

test('lineCount: 위 끝이 앞 줄 아래 끝보다 위면 같은 줄(가운데 맞춤 높이 차이 포함)', () => {
  assert.equal(lineCount([]), 0);
  assert.equal(lineCount([{top: 0, bottom: 26}, {top: 0, bottom: 26}]), 1);
  assert.equal(lineCount([{top: 0, bottom: 30}, {top: 2, bottom: 28}, {top: 34, bottom: 60}]), 2);
  assert.equal(lineCount([{top: 0, bottom: 26}, {top: 30, bottom: 56}, {top: 60, bottom: 86}]), 3);
  assert.equal(lineCount([null, {top: NaN, bottom: 1}, {top: 0, bottom: 26}]), 1);
});

test('pickedToggles: 켠 칩과 끈 칩 중 적은 쪽이 고른 칩, 모두 켜거나 끄면 없음', () => {
  const names = ['기타', '주간보고', '공문', '회의'];
  assert.deepEqual([...pickedToggles(names, new Set())], []);
  assert.deepEqual([...pickedToggles(names, new Set(names))], []);
  assert.deepEqual([...pickedToggles(names, new Set(['회의']))], ['회의']);
  assert.deepEqual([...pickedToggles(names, new Set(['기타', '주간보고', '회의']))], ['공문']);
});

// 화면 없이 줄바꿈을 흉내 내는 작은 가짜 칸: 칩 폭·칸 폭만으로 왼쪽부터 놓고 넘치면 다음 줄(높이 26, 칸 사이 4).
class El {
  constructor(width = 50) { this.width = width; this.dataset = {}; this.attrs = new Map(); this.hidden = false; this.textContent = ''; this.parent = null; this.listeners = {}; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); if (k === 'data-chip-cut') this.dataset.chipCut = ''; }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  hasAttribute(k) { return this.attrs.has(k); }
  removeAttribute(k) { this.attrs.delete(k); if (k === 'data-chip-cut') delete this.dataset.chipCut; }
  addEventListener(t, f) { this.listeners[t] = f; }
  contains(x) { return x === this; }
  shown() { return !this.hidden && !this.attrs.has('data-chip-cut'); }
  getClientRects() { return this.shown() ? [1] : []; }
  getBoundingClientRect() { return this.parent.place(this); }
  click() { this.listeners.click?.({stopPropagation() {}}); }
}
class Host extends El {
  constructor(width, widths) { super(width); this.children = []; this.isConnected = true; this.clientWidth = width; widths.forEach(w => this.append(new El(w))); }
  append(el) { this.children = this.children.filter(c => c !== el); this.children.push(el); el.parent = this; }
  get lastElementChild() { return this.children.at(-1); }
  querySelector() { return this.children.find(c => c.dataset.chipRowsMore !== undefined) || null; }
  place(target) {
    let x = 0, top = 0;
    for (const c of this.children) {
      if (!c.shown()) continue;
      const w = c === this.lastElementChild && c.dataset.chipRowsMore !== undefined ? 40 : c.width;
      if (x > 0 && x + 4 + w > this.width) { x = 0; top += 30; }
      const left = x ? x + 4 : 0; x = left + w;
      if (c === target) return {top, bottom: top + 26, left, right: x};
    }
    return {top: 0, bottom: 0};
  }
}
globalThis.document = {createElement: () => new El(40), activeElement: null};
const {fitChipRows} = await import('../app/chip-rows.js');
const rows = host => lineCount(host.children.filter(c => c.shown()).map(c => c.getBoundingClientRect()));

test('fitChipRows: 두 줄에 들면 [더보기] 없이 전부, 넘치면 두 줄 + [더보기], 펼치면 전부, 접으면 다시 두 줄', () => {
  const fits = new Host(200, [50, 50, 50, 50, 50, 50]);
  fitChipRows(fits);
  assert.equal(fits.lastElementChild.hidden, true);
  assert.equal(fits.children.filter(c => c.dataset.chipCut !== undefined).length, 0);

  const many = new Host(200, Array(12).fill(50));
  fitChipRows(many);
  const more = many.lastElementChild;
  assert.equal(more.hidden, false); assert.equal(more.textContent, '더보기 ▾'); assert.equal(more.getAttribute('aria-expanded'), 'false');
  assert.ok(rows(many) <= 2);
  assert.ok(many.children.some(c => c.dataset.chipCut !== undefined));
  more.click();
  assert.equal(more.textContent, '접기 ▴'); assert.ok(rows(many) > 2);
  assert.equal(many.children.filter(c => c.dataset.chipCut !== undefined).length, 0);
  more.click();
  assert.equal(more.textContent, '더보기 ▾'); assert.ok(rows(many) <= 2);
});

test('fitChipRows: 고른 칩은 접혀도 보이고, 숨는 칩을 건너 앞쪽에 붙는다', () => {
  const host = new Host(200, Array(12).fill(50));
  const last = host.children[11]; last.setAttribute('aria-checked', 'true');
  fitChipRows(host);
  assert.equal(last.shown(), true);
  assert.ok(rows(host) <= 2);
  assert.ok(host.children.slice(0, 11).some(c => !c.shown()));
  // 숨은 화면(폭 0)은 재지 않고 아무것도 접지 않는다.
  const hidden = new Host(0, Array(12).fill(50)); hidden.clientWidth = 0;
  fitChipRows(hidden);
  assert.equal(hidden.children.filter(c => c.dataset.chipCut !== undefined).length, 0);
});

test('옆으로 미는 칩 줄 코드는 없다: 공용 칩 부품 둘이 chip-rows.js를 쓰고 scroll-edge.js·끝 흐림은 지웠다', () => {
  assert.equal(existsSync(join(app, 'scroll-edge.js')), false);
  for (const f of ['filter-chips.js', 'category-chips.js', 'telegram-feed.js', 'note-boards.js', 'ledger-browse.js']) {
    assert.match(read(f), /import \{[^}]*fitChipRows[^}]*\} from '\.\/chip-rows\.js'/, f);
    assert.doesNotMatch(read(f), /scrollLeft|watchScrollEdges/, f);
  }
  assert.doesNotMatch(noComments(read('ui-standard.css')), /data-scroll-more/);
  assert.doesNotMatch(read('ledger-browse-model.mjs'), /chipFit/);
});

test('칩 줄 CSS는 줄바꿈이고 가로 스크롤이 없다(자료실·담당조직·프로젝트·사업 보고·정리함·텔레그램·노트 보드·사진·원장)', () => {
  const rules = [
    ['filter-chips.css', /\.filter-chips \{([^}]*)\}/],
    ['ui-standard.css', /#appView :is\(#libraryView,#meetingsView,#basketView\) \.filter-chips:not\(\[hidden\]\)\{([^}]*)\}/],
    ['ui-standard.css', /html \.doc-kind-chips:not\(\[hidden\]\)\{([^}]*)\}/],
    ['ui-standard.css', /html \.cc-sub-row:not\(\[hidden\]\)\{([^}]*)\}/],
    ['feed.css', /\.feed-view \.feed-chiprow\{([^}]*)\}/],
    ['basket.css', /\.nbb \{([^}]*)\}/],
    ['photos.css', /#appView #photosView \.photos-chips\{([^}]*)\}/],
    ['ledger-import.css', /#appView #ledgerView \.lb-topics\{([^}]*)\}/],
  ];
  for (const [f, re] of rules) {
    const body = noComments(read(f)).match(re)?.[1];
    assert.ok(body, `${f} ${re}`);
    assert.match(body, /flex-wrap:\s*wrap/, `${f} ${re}`);
    assert.doesNotMatch(body, /overflow(-x)?:\s*auto/, `${f} ${re}`);
  }
  const ui = noComments(read('ui-standard.css'));
  assert.doesNotMatch(ui, /\.basket-place-filter:not\(\[hidden\]\)\{[^}]*overflow-x/);
  const lib = noComments(read('library-upload.css'));
  assert.doesNotMatch(lib, /data-lu-filter-row="(category|group)"\]\{[^}]*overflow-x/);
  // 접힌 칩·[더보기] 모양은 ui-standard.css 한 묶음.
  assert.ok(ui.includes('[data-chip-rows] > [data-chip-cut]{ display:none !important; }'));
  assert.match(ui, /\[data-chip-rows\] > button\.chip-rows-more\{/);
});

test('노트 보기 밀기는 보드 칸 줄(data-nbb)을 더 이상 피하지 않는다(그 줄이 옆으로 밀리지 않으므로)', () => {
  const notes = read('basket-notes.js');
  assert.match(notes, /e\.target\.closest\('\[data-nb-scroll\],\[data-nbb-side\],input,textarea,\[contenteditable\]'\)/);
});
