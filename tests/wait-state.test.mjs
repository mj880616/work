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

// 아직 공용 부품으로 옮기지 않은 기다림 문구(파일별 개수). 늘면 실패, 줄면 낮춘다.
// 2차(저장본 상태 줄·검색·달력·누른 뒤 진행 안내)를 옮긴 뒤 남은 것: 사진 받기 작은 알림·일기·텔레그램·공유 페이지 편집기·노트 편집기,
// 주간보고 복사 글의 '(불러오는 중)'(복사 글이라 유지 검토).
const BASELINE = {
  'basket-notes.js': 1, 'diary.js': 3, 'journal-weekly.js': 1, 'photo-share.js': 1, 'photo-strip.js': 1, 'photos.js': 3, 'share-pages.js': 2,
  'telegram-feed.js': 2,
  // 기다림 표시가 아닌 글자(그대로 둔다, 늘면 실패):
  // - 상태 이름·서버 답 안내: 사진 글자 인식 상태 '읽는 중'(basket.js)·'글자 읽는 중'(basket-manual-link.js, summary-part-unify 시험),
  //   서버 답 '글자 읽는 중이에요. 잠시 뒤 다시 눌러 주세요.'(basket-ai-summary.js)·'챙길 것을 찾는 중이에요…'(todo-radar-data.js),
  //   아직 안 열린 기능을 누를 때 작은 알림(task-inline.js).
  // - 한글 편집기(약 20MB)·한글 파일 열기의 단계 안내(파일 받음·편집기 준비 중, hwp-drive-edit 시험): 수십 초 걸리는 일이라 단계 글자를 둔다.
  'basket.js': 1, 'basket-manual-link.js': 1, 'basket-ai-summary.js': 1, 'todo-radar-data.js': 1, 'task-inline.js': 1,
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

test('민트(.notice) 상자를 안내·기다림에 새로 쓰지 않는다(남은 2곳 밖)', () => {
  const found = [];
  for (const file of walk(APP)) {
    const rel = relative(APP, file).split('\\').join('/');
    if (!/\.(m?js|html)$/.test(rel) || SKIP.some(dir => rel.startsWith(dir))) continue;
    const source = readFileSync(file, 'utf8');
    if (/class(Name)?\s*=\s*\\?["'`]notice\b|classList\.add\(\s*['"]notice['"]/.test(source)) found.push(rel);
  }
  // 남은 2곳(회의 AI 창 안내 글, 프로젝트 지우기 창 안내)은 D-6b 글자 모양 보존 시험(modal-typography)과 함께 다음 묶음에서 바꾼다.
  assert.deepEqual(found, ['project-system-v3.js', 'workflow-ai-v3.js']);
});

test('옮긴 화면은 공용 부품을 쓴다', () => {
  for (const rel of ['journal.js', 'home-read.js', 'home-fill.js', 'telegram-feed.js', 'call-feed.js', 'photos.js', 'diary-list.js', 'ledger-browse.js',
    'google-tasks.js', 'workplace-detail.js', 'quick-links.js', 'reference-bundles.js', 'arsenal.js', 'team.js', 'meeting-round-detail.js', 'calendar-day-items.js', 'basket.js',
    // 2차
    'data-freshness.js', 'global-search.js', 'calendar-list-view.js', 'calendar-interactions-v2.js', 'calendar-plus.js', 'project-system-v3.js',
    'basket-manual-link.js', 'business-area-fields.js', 'home-quick.js', 'meeting-todo-candidates.js', 'workflow-ai-v3.js', 'library-upload.js',
    'workplace-report.js', 'ledger-merge.js', 'todo-radar.js', 'journal-hwpx.js', 'journal-weekly.js']) {
    assert.match(read(rel), /from '\.\/wait-state\.js';/, rel);
  }
  assert.match(read('index.html'), /id="web1BoardDetailStatus" class="w1b-detail-status hidden"><div class="wait" data-wait role="status" aria-label="불러오는 중">/);
});
