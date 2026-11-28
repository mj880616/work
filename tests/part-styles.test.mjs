// S67-41 공용 부품 꾸밈 보장(명진 11/20 20:40 "이런 경우가 잦네 / 꾸밈 못불러오는"):
// 공용 부품의 모양 파일은 부품이 스스로 붙인다(app/part-styles.js 표 하나 + view-loader.js style() 하나). 화면 모양 목록(routeStyles)에
// 그 파일이 없는 화면에서 부품을 처음 열어도 꾸밈 없이 그려지지 않게 하는 규칙을 지킨다.
// 1) 표의 부품마다: 모듈이 part-styles.js를 부르고 자기 이름으로 기다린다. 첫 화면 준비 사슬 밖 부품은 모듈 맨 위 `await partStyles('이름')`,
//    사슬 안 부품은 여는 함수가 partStylesReady로 보고 기다린다(맨 위에서 기다리면 첫 화면이 늦어진다).
// 2) 표의 모양 파일은 모두 있다. 표 밖에 따로 모양 파일을 붙이는 손 코드(link 만들기)를 표의 부품이 다시 갖지 않는다.
// 3) 표의 모양 파일에만 있는 이름표(class)를 그리는 모듈은 그 부품이거나, 그 부품을 정적 import하거나, 아래 KNOWN(그 화면 목록에 그 파일이 있음)이다.
//    새 모듈이 부품 모양만 빌려 쓰면 여기서 걸린다 → 표에 넣거나 부품을 import한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, existsSync} from 'node:fs';
import {PART_STYLES, partStyles, partStylesReady} from '../app/part-styles.js';

const APP = new URL('../app/', import.meta.url);
const read = file => readFileSync(new URL(file, APP), 'utf8');
const scripts = readdirSync(APP).filter(f => /\.m?js$/.test(f));
const cssFiles = readdirSync(APP).filter(f => f.endsWith('.css'));
const fileOf = name => existsSync(new URL(`${name}.js`, APP)) ? `${name}.js` : `${name}.mjs`;
const staticImports = file => [...read(file).matchAll(/^\s*(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]\.\/([^'"?#]+)['"]/gm)].map(m => m[1]).filter(f => scripts.includes(f));
const chainOf = roots => { const seen = new Set(), q = [...roots]; while (q.length) for (const d of staticImports(q.shift())) if (!seen.has(d)) { seen.add(d); q.push(d); } return seen; };

// 첫 화면 준비 사슬: loader-v2.js가 첫 화면을 띄우기 전(검색 불러오기 앞)에 부르는 모듈과 그 정적 import.
const loaderBeforeReveal = read('loader-v2.js').split("viewLoader.load('search')")[0];
const startRoots = [...loaderBeforeReveal.matchAll(/import\(\s*'\.\/([\w.-]+\.m?js)'\s*\)/g)].map(m => m[1]);
const startChain = new Set([...startRoots, ...chainOf(startRoots)]);
// 화면 모양 목록(view-loader.js routeStyles).
const routeStyles = Object.fromEntries([...read('view-loader.js').matchAll(/^\s+(\w+):\[([^\]]*\.css'[^\]]*)\],?$/gm)].map(m => [m[1], [...m[2].matchAll(/'\.\/([\w-]+\.css)'/g)].map(x => x[1])]));
const OPEN_TIME = new Set(['row-menu']); // 첫 화면 준비 사슬 안 부품: 여는 함수가 기다림
// 화면 목록에 넣지 않고 부품이 뒤늦게(ui-standard.css 뒤) 붙이는 것 — 같은 세기 규칙이 부딪혀 순서가 결과를 정하는 곳(범위 밖 발견, PR 본문).
const LATE = {calendar: ['google-tasks.css']};

test('표의 부품마다 모듈이 자기 이름으로 모양을 기다린다(사슬 밖은 맨 위, 사슬 안은 여는 함수)', () => {
  for (const name of Object.keys(PART_STYLES)) {
    const file = fileOf(name), src = read(file);
    assert.match(src, /import \{[^}]*\bpartStyles\b[^}]*\} from '\.\/part-styles\.js';/, `${file}: part-styles.js를 부르지 않음`);
    if (OPEN_TIME.has(name)) {
      assert.ok(src.includes(`partStylesReady('${name}')`) && src.includes(`partStyles('${name}')`), `${file}: 여는 함수가 기다리지 않음`);
      assert.ok(!src.includes(`\nawait partStyles('${name}');`), `${file}: 첫 화면 사슬 안에서 맨 위 기다림`);
    } else {
      assert.ok(src.includes(`\nawait partStyles('${name}');\n`), `${file}: 모듈 맨 위에서 await partStyles('${name}')이 없음`);
    }
  }
});

test('맨 위에서 기다리는 부품은 첫 화면 준비 사슬에 없다(첫 화면이 모양 파일 받기를 기다리지 않게)', () => {
  assert.ok(startChain.has('topbar-actions.js') && startChain.has('row-menu.js'), '첫 화면 사슬 계산이 틀림');
  for (const name of Object.keys(PART_STYLES)) {
    if (OPEN_TIME.has(name)) continue;
    assert.ok(!startChain.has(fileOf(name)), `${name}: 첫 화면 준비 사슬에 들어감 → OPEN_TIME 방식(여는 함수가 기다림)으로 바꾼다`);
  }
  for (const name of OPEN_TIME) assert.ok(name in PART_STYLES);
});

test('표의 모양 파일은 모두 있고, 번호 없는 경로다', () => {
  for (const [name, list] of Object.entries(PART_STYLES)) {
    assert.ok(list.length, name);
    for (const path of list) {
      assert.match(path, /^\.\/[\w-]+\.css$/, `${name}: ${path}`);
      assert.ok(cssFiles.includes(path.slice(2)), `${name}: ${path} 없음`);
    }
  }
});

test('표의 부품은 따로 link를 만들어 모양을 붙이지 않는다(불러오기는 view-loader.js style() 하나)', () => {
  for (const name of Object.keys(PART_STYLES)) {
    if (name === 'markdown-view') continue; // 바깥 라이브러리(katex-*/) 모양은 그 라이브러리를 받을 때 같이 붙인다(저장소 앱 모양 파일 아님)
    const src = read(fileOf(name));
    assert.doesNotMatch(src, /createElement\(['"]link['"]\)[\s\S]{0,200}stylesheet/, `${name}: 손으로 link를 만듦`);
  }
  const loader = read('view-loader.js');
  assert.match(loader, /window\.KPTUViewLoader=\{[^}]*\bstyle\b/, 'view-loader.js가 style을 내놓지 않음');
  // 부르는 중인 파일은 다 붙을 때까지 기다린다(문서에 이미 있는 link보다 먼저 본다).
  const fn = loader.slice(loader.indexOf('function style('), loader.indexOf('const routeStyles='));
  assert.ok(fn.indexOf('styleFlights.has(href)') < fn.indexOf('if(existing)'), 'style(): 부르는 중 확인이 먼저가 아님');
  const tasks = read('google-tasks.js'), picker = read('area-org-picker.js'), top = read('topbar-actions.js');
  assert.doesNotMatch(tasks, /EDITOR_STYLE|ensureEditorStyle/);
  assert.doesNotMatch(picker, /const STYLES=/);
  assert.doesNotMatch(top, /ROW_MENU_CSS|ensureRowMenuStyle/);
});

// 3) 부품 모양 빌려 쓰기 검사. KNOWN: 표의 모양 파일 이름표를 그리지만 부품을 import하지 않는 모듈과 그 이유.
//    routes가 있으면 그 화면 목록마다 그 모양 파일이 있어야 한다(그 화면에서만 쓰는 모듈).
const KNOWN = {
  'library-upload.css': {
    'library-drop.js': {routes: ['library']}, 'library-html-view.js': {routes: ['library']},
    'library-tree.js': {routes: ['library'], why: '자료실 나무 줄 그리기(다른 화면은 이 파일의 계산 함수만 씀)'},
    'library-two-pane.js': {routes: ['library']},
    'library-drive-line.js': {routes: ['library'], why: '자료실 위 드라이브 저장 위치 한 줄(S69-20)·[앱 폴더 모으기](S69-22) — library-upload.js가 자료실에서만 붙임'},
    // S69-62: 폴더 고르기가 folder-dest-sheet.js로 옮겨 library-move-picker.js(부품)를 더는 import하지 않는 자료실 화면 모듈들.
    'library-folders.js': {routes: ['library']}, 'library-sort.js': {routes: ['library']}, 'library-upload.js': {routes: ['library']},
  },
  'folder-dest-sheet.css': {
    'files.js': {routes: ['files'], why: "S69-62 [파일] '옮길 곳' 창(그리기는 files.js 상태 주인, 모양은 공용 folder-dest-sheet.css)"},
    'folder-dest-sheet.mjs': {why: 'folder-dest-sheet.js(부품)와 files.js가 부르는 창 HTML 한 곳(순수 함수)'},
    'files-trash.js': {routes: ['files'], why: '[파일] 휴지통 창(S69-62) — [파일]에서만 열고, 열 때 partStyles(folder-dest-sheet)로 모양을 스스로 붙인다'},
  },
  'area-org-picker.css': {'choice-sheet.js': {why: 'area-org-picker.js가 넘긴 줄을 그림(그 부품이 모양을 붙임)'}},
  'markdown-view.css': {'markdown-render.mjs': {why: 'markdown-view.js·편집기가 쓰는 글자 바꾸기(그 부품이 모양을 붙임)'}},
  'folder-tree.css': {
    'folder-tree-press.mjs': {why: '나무 줄(folder-tree-ui.mjs)과 함께만 씀'}, 'folder-focus-motion.js': {why: '나무 줄(folder-tree-ui.mjs)과 함께만 씀'},
  },
  'list-edit.css': {'list-edit.mjs': {why: '쓰는 곳은 모두 list-edit.js(부품)도 부름'}},
  'google-tasks.css': {
    'calendar-day-overflow.js': {why: '달력 화면 — 같은 화면이 google-tasks.js(부품)를 부름'},
    'meeting-round-detail.js': {why: '할 일 줄은 google-tasks.js(부품)가 그림'},
  },
  'weekly-org-lines.css': {
    'journal.js': {routes: ['home']}, 'weekly-cols.js': {routes: ['home']},
    'org-dispute-stage-ui.js': {routes: ['team']}, 'week-pick.js': {routes: ['team']},
    'record-day-edit.js': {routes: ['team'], why: '그 밖에는 record-window-view.js(부품) 안에서만 열림'},
  },
  'biz-summary.css': {'biz-week-skeleton.mjs': {why: 'weekly-summary-table.js(부품) 안에서만 씀'}},
  'diary.css': {
    'diary-context.js': {routes: ['diary']}, 'diary-list.js': {routes: ['diary']}, 'od-settings.js': {routes: ['diary', 'photos']},
    'diary-data.js': {why: "'diary' 등은 자료 종류 이름(모양 이름표가 아님)"},
  },
};

const classesOf = css => new Set([...read(css).replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.([a-zA-Z][\w-]*)/g)].map(m => m[1]));
test('표의 모양 파일 이름표를 그리는 모듈은 부품이거나 부품을 import하거나 KNOWN(그 화면 목록에 있음)이다', () => {
  const definedIn = new Map();
  for (const css of cssFiles) for (const c of classesOf(css)) definedIn.set(c, (definedIn.get(c) || 0) + 1);
  const owners = {};
  for (const [name, list] of Object.entries(PART_STYLES)) for (const path of list) (owners[path.slice(2)] ||= new Set()).add(fileOf(name));
  const problems = [];
  for (const [css, own] of Object.entries(owners)) {
    const unique = [...classesOf(css)].filter(c => definedIn.get(c) === 1 && c.length > 4);
    for (const file of scripts) {
      if (own.has(file) || file === 'part-styles.js') continue;
      const src = read(file);
      const used = unique.filter(c => new RegExp(`[\\s"'\`.]${c.replace(/-/g, '\\-')}(?![\\w-])`).test(src));
      if (used.length < 2) continue;
      if ([...chainOf([file])].some(dep => own.has(dep))) continue;
      const known = KNOWN[css]?.[file];
      if (!known) { problems.push(`${file} → ${css} (${used.slice(0, 3).join(' ')})`); continue; }
      for (const route of known.routes || []) assert.ok(routeStyles[route]?.includes(css), `${file}: ${route} 화면 목록에 ${css}가 없음`);
    }
  }
  assert.deepEqual(problems, [], '부품 모양을 빌려 쓰는 새 모듈 — part-styles.js 표에 넣거나 부품을 import한다');
});

// 화면 첫 프로그램(view-loader.js의 화면별 불러오기 함수가 module()로 부르는 모듈)과 그 정적 import 사슬.
function routeModules() {
  const src = read('view-loader.js'), out = {};
  const parts = src.split(/\n(?=async function \w+\(\))/);
  const bodies = {};
  for (const part of parts) { const m = part.match(/^async function (\w+)\(\)/); if (m) bodies[m[1]] = part.split(/\n(?:const |function |\/\/)/)[0]; }
  const map = src.match(/const loaders=\{([^}]*)\}/)[1].split(',').map(x => x.split(':').map(y => y.trim()));
  for (const [route, fn = route] of map) {
    // background(...) 줄은 첫 화면을 보인 뒤 받는 묶음이라 뺀다(그때 부품이 스스로 모양을 붙이고, 화면을 기다리게 하지 않음).
    const body = (bodies[fn || route] || '').split('\n').filter(line => !/^\s*background\(/.test(line)).join('\n');
    // screen()(RULE-한번에그리기: 첫 그림 약속을 기다리는 module())도 같은 첫 프로그램이다.
    const mods = [...body.matchAll(/(?:module|screen)\('\.\/([\w.-]+\.m?js)'/g)].map(m => m[1]);
    if (body.includes('organizationOrder()')) mods.push('organization-order.js');
    if (body.includes('projectCatalog()')) mods.push('project-catalog.js');
    out[route] = mods;
  }
  return out;
}
test('화면마다: 첫 프로그램 사슬에 든 공용 부품의 모양 파일이 그 화면 모양 목록에 있다(첫 화면이 모양 받기를 따로 기다리지 않게)', () => {
  const routes = routeModules();
  assert.ok(routes.brief.includes('brief-room.js') && routes.tasks.includes('google-tasks.js') && !routes.calendar.includes('google-tasks.js'), '화면 첫 프로그램 계산이 틀림');
  const missing = [];
  for (const [route, mods] of Object.entries(routes)) {
    const chain = new Set([...mods, ...chainOf(mods)]);
    for (const [name, list] of Object.entries(PART_STYLES)) {
      if (!chain.has(fileOf(name))) continue;
      for (const path of list) if (!(routeStyles[route] || []).includes(path.slice(2)) && !LATE[route]?.includes(path.slice(2))) missing.push(`${route}: ${path.slice(2)} (${name})`);
    }
  }
  assert.deepEqual(missing, [], 'view-loader.js routeStyles에 더한다(ui-standard.css 앞)');
  for (const list of Object.values(routeStyles)) assert.equal(list.at(-1), 'ui-standard.css', 'ui-standard.css는 맨 끝');
});

test('브리핑 룸(첫 신고 화면): 고르기 창 부품의 모양이 화면 목록에 없어도 부품이 붙인다', () => {
  assert.ok(chainOf(['brief-room.js']).has('library-move-picker.js'));
  assert.deepEqual(PART_STYLES['library-move-picker'], ['./library-upload.css']);
  assert.ok(chainOf(['library-move-picker.js']).has('folder-look.js'));
});

test('시험 환경(Node)에서는 아무 일도 하지 않는다', async () => {
  assert.equal(await partStyles('library-move-picker'), true);
  assert.equal(partStylesReady('library-move-picker'), true);
  assert.equal(await partStyles('없는 이름'), true);
});
