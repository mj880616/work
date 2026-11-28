// OPS-시험줄(S70-39): PR마다 고친 파일과 관련된 화면 시험만 고르는 계산(scripts/ci/e2e-select.mjs)을 본다.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {select, parseChanged, shardsFor, loadRepo} from '../scripts/ci/e2e-select.mjs';

const app = new Map([
  ['app/index.html', '<link href="./base-ui.css"><script src="./app.js"></script>'],
  ['app/app.js', "import('./loader-v2.js')"],
  ['app/loader-v2.js', "import('./view-loader.js'); await import('./menu-back.js');"],
  ['app/menu-back.js', "import { hold } from './menu-core.js';"],
  ['app/menu-core.js', 'export const hold = 1;'],
  ['app/view-loader.js', "const routes={calendar:'./calendar.js', basket:'./basket.js'}"],
  ['app/base-ui.css', 'body{}'],
  ['app/calendar.js', "import {drag} from './calendar-drag.js'; import './util-core.mjs';"],
  ['app/calendar-drag.js', 'export const drag = 1;'],
  ['app/basket.js', "import './util-core.mjs';"],
  ['app/lonely-thing.js', 'export const x = 1;'],
  ['app/util-core.mjs', 'export const u = 1;'],
  ...Array.from({length: 13}, (_, i) => [`app/user-${i}.js`, "import './hub.mjs';"]),
  ['app/hub.mjs', "import {c} from './hub-core.mjs';\nexport const h = 1; const later = () => import('./lazy-screen.js');"],
  ['app/hub-core.mjs', 'export const c = 1;'],
  ['app/lazy-screen.js', 'export const l = 1;'],
]);
const tests = new Map([
  ['tests/app-e2e/calendar-month.spec.mjs', "await page.goto('/app/?view=calendar');"],
  ['tests/app-e2e/calendar-drag-move.spec.mjs', "test('drag', () => {});"],
  ['tests/app-e2e/basket.spec.mjs', "import {f} from './helpers/basket-kind.mjs';"],
  ['tests/app-e2e/helpers/basket-kind.mjs', 'export const f = 1;'],
  ['tests/app-e2e/model.spec.mjs', "import {u} from '../../app/util-core.mjs'; page.goto('./calendar-fixture.html')"],
  ['tests/app-e2e/menu-core.spec.mjs', "test('menu', () => {});"],
  ['tests/app-e2e/lazy-screen.spec.mjs', "test('lazy', () => {});"],
  ['tests/app-e2e/calendar-fixture.html', '<script type=module src="/app/calendar-drag.js"></script>'],
]);

test('화면 파일 하나 → 그 화면 시험들(이름 규칙 + 그 파일을 부르는 화면의 시험 + 그 파일을 부르는 fixture)', () => {
  const sel = select(['app/calendar-drag.js'], app, tests);
  assert.equal(sel.mode, 'some');
  assert.deepEqual(sel.specs, ['tests/app-e2e/calendar-drag-move.spec.mjs', 'tests/app-e2e/calendar-month.spec.mjs', 'tests/app-e2e/model.spec.mjs']);
  assert.equal(sel.shards, 1);
});

test('공용 부품 → 전체', () => {
  for (const file of ['app/app-router.js', 'app/base-ui.css', 'app/select-mode.js', 'app/folder-tree-ui.mjs', 'app/view-loader.js']) {
    assert.equal(select([file], app, tests).mode, 'full', file);
  }
  // 첫 화면이 바로 부르는 파일, 많은 파일이 바로 부르는 파일도 전체.
  assert.equal(select(['app/base-ui.css'], app, tests).mode, 'full');
  assert.equal(select(['app/hub.mjs'], app, tests).mode, 'full');
});

// OPS-시험선택구멍(2026-11-27): main을 깨뜨린 회귀(사진 크게 보기 ⋯ 연 직후 Esc, #3145·#3245)의 공용 메뉴 파일
// details-menu-back.js(loader-v2.js가 시작 때 부름)·menu-dismiss.js(공용 부품 anchored-menu.js의 속)를 고쳐도
// 이름이 맞는 시험 몇 개만 돌던 빈틈. 이제 둘 다 전체.
test('앱 시작 때 붙는 파일·공용 부품이 정적 import로 부르는 파일 → 전체', () => {
  const startup = select(['app/menu-back.js'], app, tests);
  assert.equal(startup.mode, 'full');
  assert.match(startup.reasons.at(-1), /앱 시작 때 모든 화면/);
  // 시작 파일의 속: 이름이 같은 시험(menu-core.spec)만 고르지 않고 전체.
  const core = select(['app/menu-core.js'], app, tests);
  assert.equal(core.mode, 'full');
  assert.match(core.reasons.at(-1), /app\/menu-back\.js의 속/);
  // 많이 쓰는 공용 부품(hub.mjs, 13곳)의 속도 전체.
  assert.equal(select(['app/hub-core.mjs'], app, tests).mode, 'full');
  // 공용 부품이 import()·글자로만 부르는 화면은 속이 아니다(그 화면 시험만).
  assert.deepEqual(select(['app/lazy-screen.js'], app, tests).specs, ['tests/app-e2e/lazy-screen.spec.mjs']);
});

test('시험 도구·workflow → 전체', () => {
  for (const file of ['tests/app-e2e/helpers/basket-kind.mjs', '.github/workflows/app-e2e-check.yml', '.github/actions/setup-playwright/action.yml', 'scripts/ci/e2e-shard.mjs', 'scripts/ci/e2e-select.mjs']) {
    const sel = select([file], app, tests);
    assert.equal(sel.mode, 'full', file);
    assert.equal(sel.shards, 24);
  }
});

test('문서만 → 시험 없음', () => {
  const sel = select(['docs/roadmap.md', 'AGENTS.md', 'app/release-notes/20261125-1500-x.json', 'supabase/functions/x/index.ts'], app, tests);
  assert.equal(sel.mode, 'none');
  assert.deepEqual(sel.specs, []);
  assert.equal(sel.shards, 0);
});

test('시험 파일 하나 → 그 파일', () => {
  const sel = select(['tests/app-e2e/basket.spec.mjs'], app, tests);
  assert.equal(sel.mode, 'some');
  assert.deepEqual(sel.specs, ['tests/app-e2e/basket.spec.mjs']);
  // 지운 시험은 돌릴 것이 없다.
  assert.equal(select(['tests/app-e2e/gone.spec.mjs'], app, tests).mode, 'none');
});

test('대응 없음 → 전체', () => {
  assert.equal(select(['app/lonely-thing.js'], app, tests).mode, 'full');
  assert.equal(select(['app/new-file-nobody-uses.js'], app, tests).mode, 'full');
  assert.equal(select(['tests/app-e2e/orphan-fixture.html'], app, tests).mode, 'full');
  // 하나라도 전체면 전체.
  assert.equal(select(['app/calendar-drag.js', 'app/lonely-thing.js'], app, tests).mode, 'full');
});

test('여러 파일은 합친다, 목록은 NUL·줄바꿈 모두 읽는다', () => {
  assert.deepEqual(parseChanged('a\0b\nc\n\0a'), ['a', 'b', 'c']);
  const sel = select(['tests/app-e2e/basket.spec.mjs', 'app/calendar-drag.js', 'docs/x.md'], app, tests);
  assert.equal(sel.specs.length, 4);
  assert.equal(shardsFor({mode: 'some', specs: Array(13).fill('x')}), 3);
  assert.equal(shardsFor({mode: 'some', specs: Array(999).fill('x')}), 24);
});

test('실제 저장소: 공용 부품은 전체, 화면 시험 파일은 그 파일만', () => {
  const {appFiles, testFiles} = loadRepo('.');
  assert.ok(appFiles.has('app/app-router.js'));
  assert.equal(select(['app/app-router.js'], appFiles, testFiles).mode, 'full');
  const spec = [...testFiles.keys()].find(f => f.endsWith('.spec.mjs'));
  assert.deepEqual(select([spec], appFiles, testFiles).specs, [spec]);
  assert.equal(select(['docs/roadmap.md'], appFiles, testFiles).mode, 'none');
});

test('실제 저장소: 공용 메뉴 지킴이를 고치면 전체(사진 크게 보기 ⋯ 시험이 빠지지 않음)', () => {
  const {appFiles, testFiles} = loadRepo('.');
  for (const f of ['app/details-menu-back.js', 'app/menu-dismiss.js']) {
    assert.equal(select([f], appFiles, testFiles).mode, 'full', f);
  }
  // 화면 하나만 쓰는 파일은 여전히 그 화면 시험만(시험 양을 크게 늘리지 않음).
  assert.equal(select(['app/calendar-drag.js'], appFiles, testFiles).mode, 'some');
});

// STAB-파일끌기회귀(S70-80): [파일]·자료실·노트·사진 화면 파일을 고친 PR은 공용 동작 기준표 시험(standard-interactions)과
// 자료실 사각형 고르기 시험을 꼭 함께 돌린다(이름으로는 찾지 못해 빠지던 것).
test('실제 저장소: 화면 파일 → 공용 동작 기준표·사각형 고르기 시험도 함께', () => {
  const {appFiles, testFiles} = loadRepo('.');
  const std = 'tests/app-e2e/standard-interactions.spec.mjs';
  const lib = ['tests/app-e2e/library-marquee-anywhere.spec.mjs', 'tests/app-e2e/library-marquee-select.spec.mjs'];
  for (const f of ['app/files.js', 'app/files.css', 'app/library-upload.js', 'app/note-window.js', 'app/photos.js']) {
    const sel = select([f], appFiles, testFiles);
    assert.ok(sel.mode === 'full' || sel.specs.includes(std), `${f}: ${sel.mode} ${sel.specs.length}`);
  }
  for (const f of ['app/library-upload.js', 'app/marquee-select.js']) {
    const sel = select([f], appFiles, testFiles);
    for (const s of lib) assert.ok(sel.mode === 'full' || sel.specs.includes(s), `${f} → ${s}`);
  }
});

// DESIGN-검증하네스 ③(S73-04): 기준 사진 파일만 고친 PR은 그 시험만(예전에는 '부르는 시험을 못 찾음'으로 전체),
// 화면 CSS를 고친 PR은 기준 사진 시험도 함께.
test('실제 저장소: 기준 사진 → 그 시험, 화면 CSS → 기준 사진 시험도 함께', () => {
  const {appFiles, testFiles} = loadRepo('.');
  const vb = 'tests/app-e2e/visual-baseline.spec.mjs';
  assert.ok(testFiles.has(vb));
  const snap = select([`${vb}-snapshots/home-pc-chromium-linux.png`], appFiles, testFiles);
  assert.equal(snap.mode, 'some');
  assert.deepEqual(snap.specs, [vb]);
  const css = select(['app/calendar-ui.css'], appFiles, testFiles);
  assert.ok(css.mode === 'full' || css.specs.includes(vb), `${css.mode} ${css.specs.length}`);
});

// LAYOUT-폭별검사(사용자 2026-11-28): 폴드 펼침에서 노트 목록이 깨진 회귀(#3239·#3277 뒤)는 노트 화면 CSS만 고친 PR이었다.
// 화면 CSS·폭에 따라 모양을 바꾸는 공용 부품(폭 판정·줄 밀기·목록 줄·폴더 나무)을 고친 PR은 폭별 모양 검사도 함께 돌고,
// 그 시험은 칸이 많아 갈래를 여럿으로 나눈다.
test('실제 저장소: 화면 CSS·폭 공용 부품 → 폭별 모양 검사도 함께(갈래 여럿)', () => {
  const {appFiles, testFiles} = loadRepo('.');
  const wl = 'tests/app-e2e/width-layout.spec.mjs';
  assert.ok(testFiles.has(wl));
  for (const f of ['app/basket-notes.css', 'app/list-row.css', 'app/row-swipe.css', 'app/files.css', 'app/screen-width.mjs', 'app/row-swipe.js', 'app/folder-tree.css']) {
    const sel = select([f], appFiles, testFiles);
    assert.ok(sel.mode === 'full' || sel.specs.includes(wl), `${f}: ${sel.mode} ${sel.specs.join(' ')}`);
    if (sel.mode === 'some') assert.ok(sel.shards >= 8, `${f}: 갈래 ${sel.shards}`);
  }
  // 그 화면 하나만 쓰는 스크립트(모양과 상관없는 계산)는 여전히 그 화면 시험만.
  assert.ok(!select(['app/calendar-drag.js'], appFiles, testFiles).specs.includes(wl));
  // 시험 파일만 고쳐도 갈래를 나눈다.
  assert.ok(select([wl], appFiles, testFiles).shards >= 8);
});
