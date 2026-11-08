// S52-09 UI-요청상자통일(요청함 11/07 10:52, 시안 docs/design/mockups/home-asks-box.html): 홈 '나한테 온 요청'·'잊지 말기'와 정리함 '나한테 온 요청'은
// 공용 부품 하나(app/notice-box.mjs)로 그린다 — 같은 상자·머리 줄·줄·버튼, 색만 다르다. 지어낸 글만 쓴다(DOM 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

globalThis.window ??= {KPTURuntime: null, addEventListener() {}, dispatchEvent() {}};
const nb = await import('../app/notice-box.mjs');
const {forgetCount, forgetLineHtml} = await import('../app/home-summary.js');
const read = rel => readFileSync(new URL('../app/' + rel, import.meta.url), 'utf8');

test('줄: 내용 한 줄 + 아래 작은 줄(왼쪽 글, 오른쪽 [할 일로][일정으로][노트로][이미 함] ×), 글은 글자로만', () => {
  const html = nb.rowHtml({id: 'r1', body: '<b>가짜</b> 요청', meta: 'A방 · 10/6'});
  assert.match(html, /^<li class="nbx-item" data-nbx-row="r1"><p class="nbx-body">&lt;b&gt;가짜&lt;\/b&gt; 요청<\/p><div class="nbx-row2"><span class="nbx-meta">A방 · 10\/6<\/span>/);
  const acts = [...html.matchAll(/data-nbx-act="([a-z]+)"[^>]*>([^<]*)</g)].map(m => [m[1], m[2]]);
  assert.deepEqual(acts, [['task', '할 일로'], ['event', '일정으로'], ['note', '노트로'], ['done', '이미 함'], ['dismissed', '×']]);
  // 버튼은 UI-버튼6가지 부품만: 줄 안 동작은 ③ 글자 버튼, ×는 ⑥ 아이콘.
  assert.equal([...html.matchAll(/class="row-act nbx-act"/g)].length, 4);
  assert.match(html, /class="icon-btn nbx-x" data-nbx-act="dismissed" aria-label="삭제: &lt;b&gt;가짜&lt;\/b&gt; 요청"/);
  assert.equal([...nb.rowHtml({id: 'r', body: 'x', busy: true}).matchAll(/ disabled/g)].length, 5);
});

test('머리 줄: 제목 · 개수(있을 때) · 흐린 글 · [열기 ›], 없으면 한 줄', () => {
  assert.equal(nb.headHtml({title: '나한테 온 요청', count: 2, faint: '· 텔레그램 ·', countAttr: 'data-asks-count', open: {attr: 'data-goto="basket"', label: '정리함 열기 ›'}}),
    '<div class="nbx-head"><span class="nbx-title">나한테 온 요청</span><span class="nbx-n" data-asks-count>2</span><span class="nbx-faint">· 텔레그램 ·</span><button type="button" class="row-act nbx-open" data-goto="basket">정리함 열기 ›</button></div>');
  assert.equal(nb.headHtml({title: '잊지 말기', count: 0, faint: '· 새 제안 없음 ·'}), '<div class="nbx-head is-one"><span class="nbx-title">잊지 말기</span><span class="nbx-faint">· 새 제안 없음 ·</span></div>');
  assert.match(nb.boxHtml({head: '', rows: [], status: '삭제했어요', undo: true}), /<p class="nbx-status" role="status" aria-live="polite">삭제했어요 <button type="button" class="row-act nbx-undo" data-nbx-undo>되돌리기<\/button><\/p>/);
  assert.equal(nb.NB_UNDO_MS, 5000);
});

test('같은 부품 하나: 정리함 한 목록의 줄과 홈 잊지 말기 한 줄은 notice-box.mjs로 그리고, 따로 줄·버튼을 만들지 않는다', () => {
  // S52-20 ②: 옛 홈 두 상자(asks-box.js·home-family.js)는 삭제했다.
  for (const f of ['home-family.js', 'asks-box.js']) assert.throws(() => read(f), /ENOENT/, f);
  // S52-20: 정리함 안은 상자 없이 한 목록(forget-list.js)이고, 그 줄도 같은 부품(rowHtml) — 따로 줄·버튼 HTML 없음.
  assert.doesNotMatch(read('inbox-todos.js'), /mountAsksBox|asksHost/);
  const fl = read('forget-list.js');
  assert.match(fl, /from '\.\/notice-box\.mjs'/); assert.match(fl, /rowHtml\(\{id: `c:/); assert.match(fl, /rowHtml\(\{id: `f:/); assert.match(fl, /rowHtml\(\{id: `u:/);
  assert.doesNotMatch(fl, /<li class=|class="[^"]*nbx-(act|x|head|item)/, 'forget-list.js: 줄·버튼 HTML은 공용 부품만');
  assert.match(read('basket.js'), /<section class="nbx forget-list" data-nbx-tone="list" data-forget-section[^>]*><ul class="nbx-list" data-basket-rows id="basketRows"><\/ul>/);
  const hs = read('home-summary.js');
  assert.match(hs, /headHtml\(\{title: '잊지 말기', badge: count,/); assert.match(hs, /markBox\(line, 'forget'\)/);
  assert.doesNotMatch(hs, /mountAsksBox|<li |class="[^"]*nbx-(act|x|head|item)/);
  // 모양은 ui-standard.css 한 곳(화면 id 없음), 색만 tone으로. 옛 화면별 규칙·날짜 밑 요약 줄 규칙은 없다.
  const ui = read('ui-standard.css');
  const block = ui.slice(ui.indexOf('/* ===== UI-요청상자통일'), ui.indexOf('/* ===== UI-버튼6가지'));
  assert.match(block, /\.nbx\{ --nbx-ink:var\(--kptu-info\); --nbx-bg:var\(--kptu-info-soft\);/);
  assert.match(block, /\.nbx\[data-nbx-tone="forget"\]\{ --nbx-ink:var\(--kptu-warning\); --nbx-bg:var\(--kptu-warning-soft\); \}/);
  assert.doesNotMatch(block.slice(block.indexOf('*/')), /#\w|button\.[a-z-]+\{[^}]*(height|border|background)/, '화면 id·버튼 모양 선언 없음');
  for (const css of ['journal.css', 'basket.css']) assert.doesNotMatch(read(css), /\.home-family-|\.home-summary|\.nbx-/, css);
});

// S52-20 HOME-잊지말기한목록 ②(시안 docs/design/mockups/forget-one-list.html ①): 홈 [하루] 맨 위는 '잊지 말기' 한 줄 + 빨간 숫자 동그라미만.
test('홈: [하루] 맨 위 잊지 말기 한 줄 + 빨간 숫자(0이면 없음, 놓친 것 글자 없음), 누르면 정리함. 숫자 = 미분류 업데이트 + 처리 전 후보 + 가족 제안', () => {
  const j = read('journal.js');
  assert.doesNotMatch(j, /class="home-summary"|data-home-family|home-family\.js/);
  assert.ok(j.indexOf('data-journal-day>') < j.indexOf('data-home-summary') && j.indexOf('data-home-summary') < j.indexOf('data-journal-schedule'));
  assert.equal(forgetCount({update: 2, todo: 3, family: 1}), 6);
  assert.equal(forgetCount({update: 0, todo: 0}), 0);
  assert.equal(forgetCount({update: null, todo: 1}), null);
  assert.equal(forgetCount({update: 1, todo: 1, family: null}), 2, '가족 기능 없음·못 읽음은 0');
  const four = forgetLineHtml(4);
  assert.match(four, /^<div class="nbx-head"><button type="button" class="row-act nbx-title-btn" data-goto="basket" data-home-forget-open aria-label="잊지 말기 4건. 열기"><span class="nbx-title">잊지 말기<\/span><span class="nbx-badge" data-nbx-badge>4<\/span><\/button><\/div>$/);
  assert.doesNotMatch(four + forgetLineHtml(0), /열기 ›|nbx-open/, '명진 11/07 22:31: 오른쪽 [열기 ›] 없음, 제목을 누르면 열림');
  assert.doesNotMatch(four + forgetLineHtml(0), /놓친|챙길 것|정리 안 된/);
  assert.doesNotMatch(forgetLineHtml(0), /nbx-badge/);
  assert.match(nb.headHtml({title: 'x', badge: 120}), /<span class="nbx-badge" data-nbx-badge>99\+<\/span>/);
  assert.match(forgetLineHtml(1, 2), /<\/button><button type="button" class="row-act nbx-foot-open" data-goto="ledger" data-home-summary-promises[^>]*>내일 약속 2 ›<\/button><\/div>$/);
  // 빨간 바탕 흰 글자(토큰만).
  assert.match(read('ui-standard.css'), /\.nbx-badge\{[^}]*background:var\(--kptu-danger\); color:var\(--kptu-on-primary\);/);
  assert.match(read('my-features.js'), /\/rest\/v1\/rpc\/app_my_features/);
  assert.match(read('family-notes-data.js'), /hasFeature\(rt, 'family'\)/);
});

test('요청·챙길 것 줄 글(한 목록): 방 이름·원래 기록 · 날짜(+ 기한), 할 일·일정 창에는 제목과 출처 메모', async () => {
  const {candidateMeta, candidateDraft} = await import('../app/forget-list.js');
  const c = {summary: '가짜 회의 자료 요청', source_kind: 'telegram', source_day: '2026-10-06', due: null, status: 'open', tg: {room_label: '가상 지부방'}};
  assert.equal(candidateMeta(c), '가상 지부방 · 10/6');
  assert.equal(candidateMeta({...c, tg: null}), '10/6');
  assert.equal(candidateMeta({...c, source_kind: 'basket', tg: null}), '업데이트에서 · 10/6');
  assert.deepEqual(candidateDraft(c), {title: '가짜 회의 자료 요청', memo: '텔레그램 · 가상 지부방 · 10/6'});
  assert.equal([...candidateDraft({summary: '가'.repeat(150)}).title].length, 100);
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
