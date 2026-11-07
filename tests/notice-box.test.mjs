// S52-09 UI-요청상자통일(요청함 11/07 10:52, 시안 docs/design/mockups/home-asks-box.html): 홈 '나한테 온 요청'·'잊지 말기'와 정리함 '나한테 온 요청'은
// 공용 부품 하나(app/notice-box.mjs)로 그린다 — 같은 상자·머리 줄·줄·버튼, 색만 다르다. 지어낸 글만 쓴다(DOM 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

globalThis.window ??= {KPTURuntime: null, addEventListener() {}, dispatchEvent() {}};
const nb = await import('../app/notice-box.mjs');
const {askMeta, askDraft} = await import('../app/asks-box.js');
const read = rel => readFileSync(new URL('../app/' + rel, import.meta.url), 'utf8');

test('줄: 내용 한 줄 + 아래 작은 줄(왼쪽 글, 오른쪽 [할 일로][일정으로][노트로][이미 함] ×), 글은 글자로만', () => {
  const html = nb.rowHtml({id: 'r1', body: '<b>가짜</b> 요청', meta: 'A방 · 10/6'});
  assert.match(html, /^<li class="nbx-item" data-nbx-row="r1"><p class="nbx-body">&lt;b&gt;가짜&lt;\/b&gt; 요청<\/p><div class="nbx-row2"><span class="nbx-meta">A방 · 10\/6<\/span>/);
  const acts = [...html.matchAll(/data-nbx-act="([a-z]+)"[^>]*>([^<]*)</g)].map(m => [m[1], m[2]]);
  assert.deepEqual(acts, [['task', '할 일로'], ['event', '일정으로'], ['note', '노트로'], ['done', '이미 함'], ['dismissed', '×']]);
  // 버튼은 UI-버튼6가지 부품만: 줄 안 동작은 ③ 글자 버튼, ×는 ⑥ 아이콘.
  assert.equal([...html.matchAll(/class="row-act nbx-act"/g)].length, 4);
  assert.match(html, /class="icon-btn nbx-x" data-nbx-act="dismissed" aria-label="지우기: &lt;b&gt;가짜&lt;\/b&gt; 요청"/);
  assert.equal([...nb.rowHtml({id: 'r', body: 'x', busy: true}).matchAll(/ disabled/g)].length, 5);
});

test('머리 줄: 제목 · 개수(있을 때) · 흐린 글 · [열기 ›], 없으면 한 줄', () => {
  assert.equal(nb.headHtml({title: '나한테 온 요청', count: 2, faint: '· 텔레그램 ·', countAttr: 'data-asks-count', open: {attr: 'data-goto="basket"', label: '정리함 열기 ›'}}),
    '<div class="nbx-head"><span class="nbx-title">나한테 온 요청</span><span class="nbx-n" data-asks-count>2</span><span class="nbx-faint">· 텔레그램 ·</span><button type="button" class="row-act nbx-open" data-goto="basket">정리함 열기 ›</button></div>');
  assert.equal(nb.headHtml({title: '잊지 말기', count: 0, faint: '· 새 제안 없음 ·'}), '<div class="nbx-head is-one"><span class="nbx-title">잊지 말기</span><span class="nbx-faint">· 새 제안 없음 ·</span></div>');
  assert.match(nb.boxHtml({head: '', rows: [], status: '지웠어요', undo: true}), /<p class="nbx-status" role="status" aria-live="polite">지웠어요 <button type="button" class="row-act nbx-undo" data-nbx-undo>되돌리기<\/button><\/p>/);
  assert.equal(nb.NB_UNDO_MS, 5000);
});

test('두 상자는 같은 부품 하나: 잊지 말기·나한테 온 요청 모두 notice-box.mjs로 그리고, 따로 줄·버튼을 만들지 않는다', () => {
  for (const f of ['home-family.js', 'asks-box.js']) {
    const src = read(f);
    assert.match(src, /from '\.\/notice-box\.mjs'/, f);
    assert.match(src, /rowHtml\(/, f); assert.match(src, /headHtml\(/, f); assert.match(src, /boxHtml\(/, f); assert.match(src, /markBox\(host, '(ask|forget)'\)/, f);
    assert.doesNotMatch(src, /<li |class="home-family-|data-family-act|data-family-note|class="[^"]*nbx-(act|x|head|item)/, f + ': 줄·버튼 HTML은 공용 부품만');
  }
  // S52-20: 정리함 안은 상자 없이 한 목록(forget-list.js)이고, 그 줄도 같은 부품(rowHtml) — 따로 줄·버튼 HTML 없음.
  assert.doesNotMatch(read('inbox-todos.js'), /mountAsksBox|asksHost/);
  const fl = read('forget-list.js');
  assert.match(fl, /from '\.\/notice-box\.mjs'/); assert.match(fl, /rowHtml\(\{id: `c:/); assert.match(fl, /rowHtml\(\{id: `f:/); assert.match(fl, /rowHtml\(\{id: `u:/);
  assert.doesNotMatch(fl, /<li class=|class="[^"]*nbx-(act|x|head|item)/, 'forget-list.js: 줄·버튼 HTML은 공용 부품만');
  assert.match(read('basket.js'), /<section class="nbx forget-list" data-nbx-tone="list" data-forget-section[^>]*><ul class="nbx-list" data-basket-rows id="basketRows"><\/ul>/);
  assert.match(read('home-summary.js'), /mountAsksBox\(line, \{rt, where: 'home'\}\)/);
  // 모양은 ui-standard.css 한 곳(화면 id 없음), 색만 tone으로. 옛 화면별 규칙·날짜 밑 요약 줄 규칙은 없다.
  const ui = read('ui-standard.css');
  const block = ui.slice(ui.indexOf('/* ===== UI-요청상자통일'), ui.indexOf('/* ===== UI-버튼6가지'));
  assert.match(block, /\.nbx\{ --nbx-ink:var\(--kptu-info\); --nbx-bg:var\(--kptu-info-soft\);/);
  assert.match(block, /\.nbx\[data-nbx-tone="forget"\]\{ --nbx-ink:var\(--kptu-warning\); --nbx-bg:var\(--kptu-warning-soft\); \}/);
  assert.doesNotMatch(block.slice(block.indexOf('*/')), /#\w|button\.[a-z-]+\{[^}]*(height|border|background)/, '화면 id·버튼 모양 선언 없음');
  for (const css of ['journal.css', 'basket.css']) assert.doesNotMatch(read(css), /\.home-family-|\.home-summary|\.nbx-/, css);
});

test('홈: 날짜 밑 옛 요약 줄은 없고, [하루] 카드 맨 위에 요청 상자 → 잊지 말기 상자. 텔레그램 요청은 운영자 기능 telegram일 때만 상자(서버 목록)', () => {
  const j = read('journal.js');
  assert.doesNotMatch(j, /class="home-summary"/);
  assert.ok(j.indexOf('data-journal-day>') < j.indexOf('data-home-summary') && j.indexOf('data-home-summary') < j.indexOf('data-home-family'));
  const s = read('home-summary.js');
  assert.match(s, /hasFeature\(rt, 'telegram'\)/);
  assert.match(s, /todos: on \? parts\.todos : parts\.todos \+ parts\.asks/, '상자가 없으면 요청도 챙길 것 수에 든다');
  assert.match(read('my-features.js'), /\/rest\/v1\/rpc\/app_my_features/);
  assert.match(read('family-notes-data.js'), /hasFeature\(rt, 'family'\)/);
});

test('요청 줄 글: 방 이름 · 날짜(+ 기한), 할 일·일정 창에는 제목과 출처 메모', () => {
  const c = {summary: '가짜 회의 자료 요청', source_day: '2026-10-06', due: null, tg: {room_label: '가상 지부방'}};
  assert.equal(askMeta(c), '가상 지부방 · 10/6');
  assert.equal(askMeta({...c, tg: null}), '텔레그램 · 10/6');
  assert.deepEqual(askDraft(c), {title: '가짜 회의 자료 요청', memo: '텔레그램 · 가상 지부방 · 10/6'});
  assert.equal([...askDraft({summary: '가'.repeat(150)}).title].length, 100);
});

// S52-20 HOME-잊지말기한목록(시안 docs/design/mockups/forget-one-list.html): 출처가 달라도 같은 줄. 다른 점은 출처 꼬리표·업데이트 줄의 [조직][사업]뿐.
test('한 목록 줄: 출처 꼬리표 · 앞에 붙는 [조직][사업] · 처리한 줄의 상태 글 · 누르면 기록을 여는 내용', () => {
  const html = nb.rowHtml({id: 'u:1', body: '<i>가짜</i> 업데이트', meta: '11/7 09:00', src: '업데이트', lead: [['org', '조직'], ['area', '사업']],
    open: {attrs: 'data-basket-row="1"', label: '<i>가짜</i> 업데이트'}, attrs: 'data-basket-row-item="1"', tail: '<button type="button" class="icon-btn">⋯</button>', below: '<div class="nbx-below"></div>'});
  assert.match(html, /^<li class="nbx-item" data-nbx-row="u:1" data-basket-row-item="1"><p class="nbx-body"><button type="button" class="row-act nbx-body-btn" data-basket-row="1">&lt;i&gt;가짜&lt;\/i&gt; 업데이트<\/button><\/p>/);
  assert.match(html, /<span class="nbx-meta"><span class="nbx-src">업데이트<\/span>11\/7 09:00<\/span>/);
  const acts = [...html.matchAll(/data-nbx-act="([a-z]+)"/g)].map(m => m[1]);
  assert.deepEqual(acts, ['org', 'area', 'task', 'event', 'note', 'done', 'dismissed']);
  assert.equal([...html.matchAll(/class="row-act nbx-act nbx-lead"/g)].length, 2);
  assert.match(html, /×<\/button><button type="button" class="icon-btn">⋯<\/button><\/span><\/div><div class="nbx-below"><\/div><\/li>$/);
  // 처리한 줄: 버튼 없이 상태 글.
  const done = nb.rowHtml({id: 'c:2', body: '가짜 요청', src: '텔레그램', done: '할 일로 보냄 · 11.7'});
  assert.doesNotMatch(done, /data-nbx-act/);
  assert.match(done, /<span class="nbx-done">할 일로 보냄 · 11\.7<\/span><\/div><\/li>$/);
  assert.ok(nb.NB_TONES.includes('list'));
});
