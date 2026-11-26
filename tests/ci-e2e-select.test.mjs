// OPS-시험줄(S70-39): PR마다 고친 파일과 관련된 화면 시험만 고르는 계산(scripts/ci/e2e-select.mjs)을 본다.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {select, parseChanged, shardsFor, loadRepo, routeStylesOf} from '../scripts/ci/e2e-select.mjs';

const app = new Map([
  ['app/index.html', '<link href="./base-ui.css"><script src="./app.js"></script>'],
  ['app/app.js', "import('./loader-v2.js')"],
  ['app/loader-v2.js', "import('./view-loader.js')"],
  ['app/view-loader.js', "const routes={calendar:'./calendar.js', basket:'./basket.js'}"],
  ['app/base-ui.css', 'body{}'],
  ['app/calendar.js', "import {drag} from './calendar-drag.js'; import './util-core.mjs';"],
  ['app/calendar-drag.js', 'export const drag = 1;'],
  ['app/basket.js', "import './util-core.mjs';"],
  ['app/lonely-thing.js', 'export const x = 1;'],
  ['app/util-core.mjs', 'export const u = 1;'],
  ...Array.from({length: 13}, (_, i) => [`app/user-${i}.js`, "import './hub.mjs';"]),
  ['app/hub.mjs', 'export const h = 1;'],
]);
const tests = new Map([
  ['tests/app-e2e/calendar-month.spec.mjs', "await page.goto('/app/?view=calendar');"],
  ['tests/app-e2e/calendar-drag-move.spec.mjs', "test('drag', () => {});"],
  ['tests/app-e2e/basket.spec.mjs', "import {f} from './helpers/basket-kind.mjs';"],
  ['tests/app-e2e/helpers/basket-kind.mjs', 'export const f = 1;'],
  ['tests/app-e2e/model.spec.mjs', "import {u} from '../../app/util-core.mjs'; page.goto('./calendar-fixture.html')"],
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

// TEST-시험고르기보강(S71-79, #3232 범위 밖 발견사항 ①): 기준표(standard-interactions) 화면 표의 화면 파일은 모두 그 시험을 고른다.
// 노트 화면 본체(basket-notes.js)를 고친 PR에서 노트 줄(D3·W 등)이 있는 기준표 시험이 빠졌다. 같은 종류로 빠져 있던 화면 파일도 함께 본다.
test('실제 저장소: 기준표 화면 표의 화면 파일 전부 → 기준표 시험', () => {
  const {appFiles, testFiles} = loadRepo('.');
  const std = 'tests/app-e2e/standard-interactions.spec.mjs';
  const screens = {
    노트: ['app/basket-notes.js', 'app/basket.css', 'app/note-window.js', 'app/note-board.js'],
    자료실: ['app/library-upload.js', 'app/library-two-pane.js'],
    파일: ['app/files.js', 'app/files.css'],
    사진: ['app/photos.js', 'app/gdrive-photos.js', 'app/phone-photos.js'],
    '브리핑 룸': ['app/brief-room.js', 'app/brief-room.css'],
    '저장한 글': ['app/reading.js', 'app/reading.css'],
    '읽을 거리': ['app/outside-statements.js', 'app/outside-statements.css', 'app/now.css', 'app/news-clipping.js'],
    '할 일': ['app/google-tasks.js', 'app/task-layout.css'],
    '조직 묶음': ['app/suborganizations.js', 'app/organization-order.js'],
    '나무·목록 줄 공용 모양': ['app/folder-tree.css', 'app/list-row.css', 'app/row-swipe.css'],
  };
  for (const [screen, files] of Object.entries(screens)) for (const f of files) {
    assert.ok(appFiles.has(f), `${f} 없음`);
    const sel = select([f], appFiles, testFiles);
    assert.ok(sel.mode === 'full' || sel.specs.includes(std), `${screen} ${f}: ${sel.mode} ${sel.specs.length}개에 기준표 시험 없음`);
  }
});

test('화면 파일이 바로 부르는 파일 → 그 화면 시험, 시험이 주소로 여는 fixture HTML이 부르는 파일 → 그 시험', () => {
  const app2 = new Map([...app,
    ['app/files.js', "import './files-part.mjs';"],
    ['app/files-part.mjs', 'export const p = 1;'],
    ['app/lone-helper.mjs', 'export const h = 1;'],
    ['app/screen-x.js', "import './lone-helper.mjs';"],
    ['app/org-thing.js', 'export const o = 1;'],
  ]);
  const tests2 = new Map([...tests,
    ['tests/app-e2e/standard-interactions.spec.mjs', "await page.goto(`${appOrigin}/tests/app-e2e/org-fixture.html?x=1`);"],
    ['tests/app-e2e/org-fixture.html', '<script type=module src="/app/org-thing.js"></script>'],
    ['tests/app-e2e/screen-x.spec.mjs', "test('x', () => {});"],
  ]);
  const std = 'tests/app-e2e/standard-interactions.spec.mjs';
  // lone-helper.mjs는 화면 파일(files*)이 부르지 않으므로 기준표 시험이 아니고, 이름 규칙으로 screen-x 시험만.
  assert.deepEqual(select(['app/lone-helper.mjs'], app2, tests2).specs, ['tests/app-e2e/screen-x.spec.mjs']);
  // files.js가 바로 부르는 파일은 [파일] 화면 파일과 같이 기준표 시험.
  assert.ok(select(['app/files-part.mjs'], app2, tests2).specs.includes(std));
  // 기준표 시험이 주소로 여는 fixture가 부르는 파일.
  assert.deepEqual(select(['app/org-thing.js'], app2, tests2).specs, [std]);
});

test('화면 모양 파일(view-loader routeStyles의 기준표 화면 줄) → 기준표 시험, 다른 화면 모양 파일은 아님', () => {
  const loader = "const routeStyles={\n  basket:['./shelf.css','./shared.css'],\n  calendar:['./calendar-ui.css'],\n};\nconst routes={}";
  assert.deepEqual(routeStylesOf(loader).get('basket'), ['app/shelf.css', 'app/shared.css']);
  const app3 = new Map([...app, ['app/view-loader.js', loader], ['app/shelf.css', 'a{}'], ['app/shared.css', 'b{}'], ['app/calendar-ui.css', 'c{}']]);
  const tests3 = new Map([...tests, ['tests/app-e2e/standard-interactions.spec.mjs', "test('x', () => {});"], ['tests/app-e2e/calendar-ui.spec.mjs', "test('y', () => {});"]]);
  const std = 'tests/app-e2e/standard-interactions.spec.mjs';
  assert.deepEqual(select(['app/shelf.css'], app3, tests3).specs, [std]);
  assert.deepEqual(select(['app/shared.css'], app3, tests3).specs, [std]);
  assert.deepEqual(select(['app/calendar-ui.css'], app3, tests3).specs, ['tests/app-e2e/calendar-ui.spec.mjs']);
});
