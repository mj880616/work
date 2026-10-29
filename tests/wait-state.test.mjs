// UI-기다림표시통일(2026-10-29 명진 A안): 기다림·실패·없음 공용 부품(app/wait-state.js) 하나와 재발 방지.
// - 기다림 = 글자 없는 위쪽 가는 줄 + 실제 줄 높이 회색 빈 줄, 0.4초 안에 끝나면 안 보임(base-ui.css .wait).
// - 실패 = 빨간 작은 글자 '불러오지 못했습니다' + 작은 [다시], 없음 = 회색 '없음'.
// - 민트(.notice) 상자는 '완료' 알림에만: 기다림·안내에 쓰지 않는다.
// - 따로 만든 기다림 문구('…불러오는 중…' 등)가 새로 생기면 실패한다. 아직 남은 곳은 아래 기준표에 파일별 개수로 묶어 두고,
//   늘어나거나 새 파일에 생기면 실패한다(줄어들면 기준표를 낮춘다). 남은 곳은 PR 본문 '남은 일' 목록과 같다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {waitHtml, waitInlineHtml, failHtml, emptyHtml, barHtml, WAIT_LABEL, FAIL_TEXT} from '../app/wait-state.js';

const APP = fileURLToPath(new URL('../app/', import.meta.url));
const read = path => readFileSync(join(APP, path), 'utf8');
const text = html => html.replace(/<[^>]*>/g, '');

test('기다림은 글자 없이 가는 줄 + 회색 빈 줄, 화면 읽기에는 불러오는 중으로 알린다', () => {
  const html = waitHtml();
  assert.equal(text(html), '', '보이는 글자 없음');
  assert.match(html, /^<div class="wait" data-wait role="status" aria-label="불러오는 중">/);
  assert.equal(html.match(/class="wait-bar"/g).length, 1);
  assert.equal(html.match(/class="wait-row"/g).length, 3);
  assert.equal(waitHtml({rows: 6}).match(/class="wait-row"/g).length, 6);
  assert.equal(waitHtml({rows: 99}).match(/class="wait-row"/g).length, 8, '너무 많이 그리지 않음');
  assert.equal(waitHtml({rows: 0}).match(/class="wait-row"/g).length, 1);
  assert.match(waitHtml({h: 34}), /style="--wait-h:34px"/, '실제 줄 높이');
  assert.doesNotMatch(waitHtml({h: 'x;color:red'}), /style=/);
  assert.equal(text(waitInlineHtml()), '');
  assert.match(waitInlineHtml(), /aria-label="불러오는 중"/);
  assert.equal(text(barHtml()), '');
  assert.equal(WAIT_LABEL, '불러오는 중');
});

test('실패는 빨간 작은 글자 + 작은 [다시], 없음은 회색 글자', () => {
  assert.equal(FAIL_TEXT, '불러오지 못했습니다');
  assert.equal(failHtml(), '<p class="wait-fail" data-wait-fail role="alert">불러오지 못했습니다</p>');
  assert.equal(failHtml({retry: 'data-x-retry'}), '<p class="wait-fail" data-wait-fail role="alert">불러오지 못했습니다 <button type="button" class="wait-retry" data-x-retry>다시</button></p>');
  assert.doesNotMatch(failHtml({retry: 'onclick=alert(1)'}), /onclick/, '속성 이름만 받는다');
  assert.equal(emptyHtml(), '<p class="wait-empty" data-wait-empty>없음</p>');
  assert.equal(emptyHtml('<b>'), '<p class="wait-empty" data-wait-empty>&lt;b&gt;</p>');
});

test('모양: 0.4초 늦은 표시, 회색 빈 줄은 그림 칸과 같은 색, 실패는 빨강, 민트는 완료에만', () => {
  const css = read('base-ui.css');
  assert.match(css, /\.wait\{[^}]*animation:wait-show 0s linear \.4s both/);
  assert.match(css, /@keyframes wait-show\{from\{visibility:hidden\}to\{visibility:visible\}\}/);
  const gray = 'color-mix(in srgb,var(--kptu-border) 55%,transparent)';
  assert.ok(css.includes(`.wait-row{display:block;height:var(--wait-h,20px);border-radius:4px;background:${gray}}`));
  assert.ok(css.includes(`.img-slot:not([data-img-state="shown"]){background:${gray}}`), '그림 칸 받는 중 회색과 같은 색');
  assert.match(css, /\.wait-fail\{[^}]*color:var\(--kptu-danger\)/);
  assert.match(css, /\.wait-empty\{[^}]*color:var\(--kptu-muted\)/);
  assert.match(css, /\.notice\{[^}]*var\(--kptu-success-soft\)/);
  assert.match(css, /prefers-reduced-motion:reduce\)\{\.wait-bar::after\{animation:none/);
});

test('메뉴 화면 처음 열기: 민트 상자 없이 가는 줄, 실패는 공용 부품, 쉬는 틈에 미리 받기(기기 저장 없음)', () => {
  const loader = read('loader-v2.js'), views = read('view-loader.js');
  assert.doesNotMatch(loader, /기능을 불러오는 중/);
  assert.doesNotMatch(loader, /className='notice'/);
  assert.match(loader, /const wait=await import\('\.\/wait-state\.js'\);\n  await import\('\.\/view-loader\.js'\);/, '화면 파일보다 먼저 부품을 불러온다');
  assert.match(loader, /wait\.barHtml\(\)/);
  assert.match(loader, /wait\.failEl\(/);
  assert.match(loader, /defer\(\(\)=>viewLoader\.warm\?\.\(\),\{timeout:8000\}\);/);
  assert.match(views, /hint\('modulepreload',path\)/);
  assert.match(views, /hint\('prefetch',path,'style'\)/);
  const warmBlock = views.slice(views.indexOf('const warmModules={'), views.indexOf('const warmed=new Set();'));
  assert.ok(warmBlock.length > 100);
  assert.doesNotMatch(warmBlock, /hwp|arsenal/, 'HWP 편집기(약 20MB)·아스날은 미리 받지 않는다');
  assert.match(views, /window\.KPTUViewLoader=\{load,loadAll,prepare,normalize,warm,/);
  // 기기 저장 금지(낱말은 저장소 검사에 걸리지 않게 조각으로 만든다).
  const deviceStore = new RegExp([['local', 'Storage'], ['session', 'Storage'], ['indexed', 'DB'], ['caches', '\\.open']].map(p => p.join('')).join('|'));
  for (const source of [loader, views, read('wait-state.js')]) assert.doesNotMatch(source, deviceStore);
});

// 기다림 문구가 남은 곳(파일별 개수). 2차까지 화면의 기다림 표시는 모두 공용 부품으로 옮겼고, 아래는 기다림 표시가 아닌 글자라 그대로 둔다.
// 늘거나 새 파일에 생기면 실패한다(줄면 낮춘다).
const BASELINE = {
  // - 상태 이름·서버 답 안내: 사진 글자 인식 상태 '읽는 중'(basket.js)·'글자 읽는 중'(basket-manual-link.js, summary-part-unify 시험),
  //   서버 답 '글자 읽는 중이에요. 잠시 뒤 다시 눌러 주세요.'(basket-ai-summary.js)·'챙길 것을 찾는 중이에요…'(todo-radar-data.js),
  //   아직 안 열린 기능을 누를 때 작은 알림(task-inline.js), 편집기가 열리기 전 저장을 누를 때 거절 안내(basket-notes.js).
  'basket.js': 1, 'basket-manual-link.js': 1, 'basket-ai-summary.js': 1, 'todo-radar-data.js': 1, 'task-inline.js': 1, 'basket-notes.js': 1,
  // - 사진 내려받기 작은 알림(장수·한 번에 받는 한도, photos.js): 알림 부품은 글자만 받는다.
  'photos.js': 2,
  // - 주간보고 복사 글의 '(불러오는 중)'(journal-weekly.js, journal-meeting-kinds 시험): 화면이 아니라 붙여 넣을 글이라 글자가 필요하다.
  'journal-weekly.js': 1,
  // - 한글 편집기(약 20MB)·한글 파일 열기의 단계 안내(파일 받음·편집기 준비 중, hwp-drive-edit 시험): 수십 초 걸리는 일이라 단계 글자를 둔다.
  'hwp-lab.js': 7, 'journal-hwpx.js': 4,
};
const SKIP = ['hwp-lab/', 'editor-lib/', 'pdf-lib/', 'markdown-lib/', 'legacy/', 'release-notes/'];
const WAIT_WORDS = /불러오는 중|읽는 중|찾는 중|여는 중|받는 중|확인하는 중|기다리는 중|준비하는 중/g;
const walk = dir => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
// 주석 줄은 세지 않는다.
export function countWait(source) {
  return source.split('\n').filter(line => !/^\s*(\/\/|\/\*|\*)/.test(line)).join('\n')
    .replaceAll('aria-label="불러오는 중"', '').match(WAIT_WORDS)?.length || 0;
}

test('따로 만든 기다림 문구가 새로 생기지 않는다(기준표보다 늘면 실패)', () => {
  const over = [], counts = {};
  for (const file of walk(APP)) {
    const rel = relative(APP, file).split('\\').join('/');
    if (!/\.(m?js|html)$/.test(rel) || SKIP.some(dir => rel.startsWith(dir)) || rel === 'wait-state.js') continue;
    const n = countWait(readFileSync(file, 'utf8'));
    if (!n) continue;
    counts[rel] = n;
    if (n > (BASELINE[rel] || 0)) over.push(`${rel}: ${n}곳(기준 ${BASELINE[rel] || 0}) — 기다림은 wait-state.js(waitHtml·waitInlineHtml·failHtml·emptyHtml)를 쓰세요.`);
  }
  assert.deepEqual(over, []);
  for (const [rel, n] of Object.entries(BASELINE)) assert.ok((counts[rel] || 0) <= n, rel);
});

test('민트(.notice) 상자를 안내·기다림에 쓰지 않는다(완료 알림 부품 밖에는 0곳)', () => {
  const found = [];
  for (const file of walk(APP)) {
    const rel = relative(APP, file).split('\\').join('/');
    if (!/\.(m?js|html)$/.test(rel) || SKIP.some(dir => rel.startsWith(dir))) continue;
    const source = readFileSync(file, 'utf8');
    if (/class(Name)?\s*=\s*\\?["'`]notice\b|classList\.add\(\s*['"]notice['"]/.test(source)) found.push(rel);
  }
  // 2차: 남았던 2곳(회의 AI 창 안내 글, 프로젝트 지우기 창 안내)도 회색 글자(.muted)로 바꿨다(modal-typography D-6b 함께).
  assert.deepEqual(found, []);
});

test('옮긴 화면은 공용 부품을 쓴다', () => {
  for (const rel of ['journal.js', 'home-read.js', 'home-fill.js', 'telegram-feed.js', 'call-feed.js', 'photos.js', 'diary-list.js', 'ledger-browse.js',
    'google-tasks.js', 'workplace-detail.js', 'quick-links.js', 'reference-bundles.js', 'arsenal.js', 'team.js', 'meeting-round-detail.js', 'calendar-day-items.js', 'basket.js',
    // 2차
    'data-freshness.js', 'global-search.js', 'calendar-list-view.js', 'calendar-interactions-v2.js', 'calendar-plus.js', 'project-system-v3.js',
    'basket-manual-link.js', 'business-area-fields.js', 'home-quick.js', 'meeting-todo-candidates.js', 'workflow-ai-v3.js',
    'ledger-merge.js', 'todo-radar.js', 'journal-hwpx.js', 'journal-weekly.js', 'photo-share.js', 'telegram-feed.js', 'share-pages.js', 'diary.js']) {
    assert.match(read(rel), /from '\.\/wait-state\.js';/, rel);
  }
  // 옛 모양 파일(즉시 실행 함수·선언 시험 대상)은 창에 둔 같은 부품(window.KPTUWait)을 쓴다.
  for (const rel of ['library-upload.js', 'workplace-report.js']) assert.match(read(rel), /globalThis\.KPTUWait\?\.waitInlineHtml/, rel);
  assert.match(read('index.html'), /id="web1BoardDetailStatus" class="w1b-detail-status hidden"><div class="wait" data-wait role="status" aria-label="불러오는 중">/);
});

// UI-기다림표시통일 3차(2026-10-29 명진 A안 '없음 = 회색 작은 없음'): 목록·칸이 비었을 때 따로 쓴 글자('사진이 없어요.',
// '~이 없습니다' 등)는 공용 부품(emptyHtml·emptyEl, 기본 '없음')으로 옮겼다. 같은 화면에 빈 칸이 여럿이라 구분이 필요하거나
// 고른 조건 때문에 빈 곳만 부품의 글자 인자로 짧게 남긴다(예 emptyHtml('일정 없음')). 따로 쓴 빈 화면 문구가 새로 생기면 실패한다.
// 아래 기준표는 빈 화면 표시가 아닌 글자라 그대로 둔 곳(파일별 개수). 늘거나 새 파일에 생기면 실패한다(줄면 낮춘다).
const EMPTY_BASELINE = {
  // - 자료 값(빈 목록 아님): 아스날 경기 줄의 '득점 없음'·'공식 기록상 도움 배정 없음'.
  'arsenal.js': 2,
  // - 고르기 칸의 '없음' 값 이름(사업영역 없음·담당조직 없음으로 옮기기, library-bulk.js).
  'library-bulk.js': 2,
  // - 상태 이름: 사진 글자 인식 상태 '글자 없음'(basket.js).
  'basket.js': 1,
  // - 안내 글(빈 목록 아님): 이미 연결된 곳은 고를 수 없다는 안내(basket-manual-link.js).
  'basket-manual-link.js': 1,
  // - 접힌 머리 줄의 상태 글('챙길 것 없음 · 마지막 찾기 hh:mm', todo-radar.js): 제목 역할(aria-labelledby)이라 글자를 둔다.
  'todo-radar.js': 1,
};
// 글이 '…없어요'로 끝나는 곳만 센다(따옴표·태그·${} 앞). 문장 가운데의 '지울 수 없어요' 같은 안내는 세지 않는다.
const NONE_WORDS = '(?:없어요|없습니다|없음|없네요|비어 있어요|비어 있습니다)\\.?(?=[\'"`<$])';
const EMPTY_PATTERNS = [
  // HTML 글 안: 빈 칸 모양 class(empty·muted·faint·note·hint·quiet·none·status) 뒤 글이 '…없어요' 등으로 끝난다.
  new RegExp(`class=\\\\?["'][^"']*(?:empty|muted|faint|note|hint|quiet|none|status)[^"']*\\\\?["'][^>]*>[^<]*?${NONE_WORDS}`, 'g'),
  // 화면마다 만든 빈 칸 함수(empty('…없어요'), showNone('…') 등). 공용 부품 이름은 뺀다.
  new RegExp(`\\b(?!emptyHtml|emptyEl|showEmpty)\\w*(?:empty|Empty)\\w*\\(\\s*['"\`][^'"\`]*${NONE_WORDS}`, 'g'),
  new RegExp(`\\b\\w*(?:empty|Empty)\\w*\\(\\s*['"][\\w-]+['"]\\s*,\\s*['"\`][^'"\`]*${NONE_WORDS}`, 'g'),
  // el('p', 'x-muted', '…없어요'), el('p', {class:'x-empty', text:'…없음'}).
  new RegExp(`\\bel\\([^)]*?['"][\\w -]*(?:empty|muted|faint|note|hint)[\\w -]*['"]\\s*,\\s*['"\`][^'"\`]*${NONE_WORDS}`, 'g'),
  new RegExp(`class\\s*:\\s*['"][\\w -]*(?:empty|muted|faint|note|hint)[\\w -]*['"]\\s*,\\s*text\\s*:\\s*['"\`][^'"\`]*${NONE_WORDS}`, 'g'),
  // 설정 값으로 둔 빈 글자(empty:'…없음'). 부품 기본값과 같은 '없음' 하나는 센다지 않는다.
  new RegExp(`\\b(?:empty|none|emptyText)\\s*:\\s*['"\`][^'"\`]+${NONE_WORDS}`, 'g'),
];
export function countEmpty(source) {
  const code = source.split('\n').filter(line => !/^\s*(\/\/|\/\*|\*)/.test(line)).join('\n');
  return EMPTY_PATTERNS.reduce((n, re) => n + (code.match(re)?.length || 0), 0);
}

test('없음: 그 화면이 찾는 표시(data-*·hidden·id)만 덧붙이고, 다른 속성은 받지 않는다', () => {
  assert.equal(emptyHtml('일정 없음', {attrs: 'data-journal-events-empty'}), '<p class="wait-empty" data-wait-empty data-journal-events-empty>일정 없음</p>');
  assert.equal(emptyHtml('없음', {attrs: 'data-cf-empty="none" hidden'}), '<p class="wait-empty" data-wait-empty data-cf-empty="none" hidden>없음</p>');
  assert.equal(emptyHtml('', {attrs: 'onclick="x()"'}), '<p class="wait-empty" data-wait-empty>없음</p>');
  assert.equal(emptyHtml('x', {attrs: 'data-a="1"><script>'}), '<p class="wait-empty" data-wait-empty>x</p>');
});

test('세는 규칙: 따로 쓴 빈 화면 문구는 세고, 공용 부품은 세지 않는다', () => {
  assert.equal(countEmpty(`box.innerHTML = '<p class="x-muted">사진이 없어요.</p>';`), 1);
  assert.equal(countEmpty(`box.innerHTML = '<div class="empty compact">일정 없음</div>';`), 1);
  assert.equal(countEmpty(`list.append(el('p', 'journal-muted', '없어요.'));`), 1);
  assert.equal(countEmpty(`body.push(el('p', {class:'sp-empty', text:'공유 페이지 없음'}));`), 1);
  assert.equal(countEmpty(`box.innerHTML = emptyHtml('일정 없음'); x = emptyEl(); const n = {empty:'없음'};`), 0);
  assert.equal(countEmpty(`// '<p class="x-muted">사진이 없어요.</p>'`), 0, '주석 줄은 세지 않음');
});

test('따로 쓴 빈 화면 문구가 새로 생기지 않는다(기준표보다 늘면 실패)', () => {
  const over = [], counts = {};
  for (const file of walk(APP)) {
    const rel = relative(APP, file).split('\\').join('/');
    if (!/\.(m?js|html)$/.test(rel) || SKIP.some(dir => rel.startsWith(dir)) || rel === 'wait-state.js') continue;
    const n = countEmpty(readFileSync(file, 'utf8'));
    if (!n) continue;
    counts[rel] = n;
    if (n > (EMPTY_BASELINE[rel] || 0)) over.push(`${rel}: ${n}곳(기준 ${EMPTY_BASELINE[rel] || 0}) — 빈 칸은 wait-state.js emptyHtml·emptyEl('없음')을 쓰세요.`);
  }
  assert.deepEqual(over, []);
  for (const [rel, n] of Object.entries(EMPTY_BASELINE)) assert.equal(counts[rel] || 0, n, `${rel}: 기준표를 낮추세요`);
});

test('3차로 옮긴 화면은 공용 없음 부품을 쓴다', () => {
  for (const rel of ['journal.js', 'journal-weekly.js', 'prep-sheet-view.js', 'project-system-v3.js', 'home-read.js', 'home-extra.js', 'home-fill.js',
    'telegram-feed.js', 'call-feed.js', 'ledger-browse.js', 'org-key-people.js', 'report-views.js', 'diary.js', 'diary-list.js', 'photos.js',
    'workplace-detail.js', 'google-tasks.js', 'team.js', 'meeting-columns.js', 'quick-links.js', 'reference-bundles.js', 'arsenal.js',
    'library-folders.js', 'library-move-picker.js', 'calendar-day-overflow.js', 'calendar-tasks.js', 'calendar-day-items.js', 'choice-sheet.js',
    'pick-fold.mjs', 'home-edit.js', 'journal-hwpx.js', 'meeting-round-detail.js', 'od-settings.js', 'press-draft.js', 'record-sheet.js',
    'report-summary-preview.js', 'task-files.js', 'task-workflow.js', 'todo-radar.js', 'basket-notes.js', 'global-search.js', 'inbox-todos.js', 'share-pages.js']) {
    assert.match(read(rel), /import \{[^}]*\bempty(Html|El)\b[^}]*\} from '\.\/wait-state\.js';/, rel);
  }
  // 옛 모양 파일(즉시 실행 함수)은 창에 둔 같은 부품(window.KPTUWait)을 쓴다.
  for (const rel of ['home-dashboard-v2.js', 'library-upload.js', 'profile-settings.js', 'suborganizations.js', 'task-layout.js', 'web1-board.js', 'workplace-report.js']) {
    assert.match(read(rel), /globalThis\.KPTUWait\?\.emptyHtml\?\.\(/, rel);
  }
});
