// CALL-손고치기 (화면 단계): 사용자 값 덧씌우기·패치 규칙(app/feed-model.mjs), 데이터 호출(app/feed-data.js), 화면 파일의 정적 규칙(app/call-feed.js).
// 이름·내용은 모두 지어낸 것이다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readCallEdits, editCall} from '../app/feed-data.js';
import {applyCallEdit, cleanEditVals, isEdited, splitPerson, joinPerson, cleanTitleInput, cleanPointLines, samePoints, undoPatch, patchKeys, editErrorText, EDIT_ERRORS, EDIT_DONE, EDIT_LEDGER_NOTE, callWho, callTopic} from '../app/feed-model.mjs';

const WS = '10000000-0000-4000-8000-000000000001', ID = '60000000-0000-4000-8000-000000000009', ORG = '30000000-0000-4000-8000-0000000000c1';
const ai = {id:ID, title:'예시지부 · 홍길동 · 일정 조정', counterpart:'예시지부 홍길동 팀장', organization_id:ORG, points:['[확정] 화요일로 변경', '자료 전달']};
function fakeRt(handler) {
  const calls = [];
  return {calls, context:{read:() => ({user:{id:'u'}, workspace:{id:WS}})}, api:async (path, opt = {}) => { calls.push({path, ...opt}); return handler(path, opt); }};
}
const failWith = (status, message) => fakeRt(() => { throw Object.assign(new Error(message), {status}); });

test('덧씌우기: 사용자 값이 있는 칸만 바뀌고 AI 원래 값은 줄에 남는다', () => {
  const r = applyCallEdit(ai, {title:'손 제목', points:['손 줄']});
  assert.equal(r.title, '손 제목'); assert.deepEqual(r.points, ['손 줄']);
  assert.equal(r.counterpart, ai.counterpart); assert.equal(r.organization_id, ORG);
  assert.deepEqual(r.edited, {title:true, counterpart:false, organization_id:false, points:true});
  assert.equal(r._ai.title, ai.title); assert.equal(isEdited(r), true);
  assert.equal(isEdited(applyCallEdit(ai, {})), false);
});

test('덧씌우기: 이미 덧씌운 줄에 다시 넣어도 같고, 칸을 지우면 AI 값으로 돌아간다', () => {
  const r = applyCallEdit(ai, {title:'손 제목'});
  assert.deepEqual(applyCallEdit(r, {title:'손 제목'}), r);
  const back = applyCallEdit(r, {});
  assert.equal(back.title, ai.title); assert.equal(isEdited(back), false);
});

test('덧씌우기: 조직을 비운 사용자 값(null)과 빈 상대 표기는 사용자 값이다', () => {
  const r = applyCallEdit(ai, {organization_id:null, counterpart:''});
  assert.equal(r.organization_id, null); assert.equal(r.counterpart, '');
  assert.deepEqual(r.edited, {title:false, counterpart:true, organization_id:true, points:false});
});

test('덧씌우기: 모양이 틀린 사용자 값은 버리고 AI 값을 쓴다', () => {
  assert.deepEqual(cleanEditVals({title:'  ', points:[1], organization_id:'x', counterpart:5, extra:1}), {});
  assert.deepEqual(cleanEditVals(null), {}); assert.deepEqual(cleanEditVals([]), {});
  const r = applyCallEdit(ai, {title:'  ', points:'가'});
  assert.equal(r.title, ai.title); assert.deepEqual(r.points, ai.points);
});

test('고친 제목은 그대로, AI 제목은 조직·사람 머리를 뗀 주제로 보인다(callTopic 규칙은 AI 제목에만)', () => {
  const org = {name:'예시지부', aliases:[]};
  assert.equal(callTopic(ai.title, {organization:org, counterpart:ai.counterpart}), '일정 조정');
  const edited = applyCallEdit(ai, {title:'예시지부 · 손으로 쓴 제목'});
  assert.equal(edited.edited.title, true); assert.equal(edited.title, '예시지부 · 손으로 쓴 제목');
});

test('이름·직함: 첫 띄어쓰기까지가 이름, 나머지가 직함. 합치면 한 칸', () => {
  assert.deepEqual(splitPerson('홍길동 대표 이사'), {name:'홍길동', role:'대표 이사'});
  assert.deepEqual(splitPerson('홍길동'), {name:'홍길동', role:''});
  assert.deepEqual(splitPerson(''), {name:'', role:''});
  assert.equal(joinPerson(' 홍길동 ', '팀장\n'), '홍길동 팀장');
  assert.equal(joinPerson('', ''), '');
  const who = callWho({organization:{name:'예시지부', aliases:[]}, counterpart:'예시지부 홍길동 팀장'});
  assert.deepEqual(splitPerson(who.person), {name:'홍길동', role:'팀장'});
});

test('입력 정리: 제목은 줄바꿈 없이 80자, 핵심내용은 빈 줄 빼고 150자·8줄', () => {
  assert.equal(cleanTitleInput('  가\n나\t다  '), '가 나 다');
  assert.equal([...cleanTitleInput('가'.repeat(100))].length, 80);
  assert.deepEqual(cleanPointLines(['  ', '가', '', '나\n다']), ['가', '나 다']);
  assert.equal(cleanPointLines(Array(12).fill('가')).length, 8);
  assert.equal([...cleanPointLines(['가'.repeat(200)])[0]].length, 150);
  assert.equal(samePoints(['가'], ['가']), true); assert.equal(samePoints(['가'], ['나']), false); assert.equal(samePoints(null, []), true);
});

test('되돌리기 패치: 고치기 전 사용자 값이 있던 칸은 그 값으로, 없던 칸은 reset', () => {
  assert.deepEqual(undoPatch({title:'이전'}, ['title', 'points']), {title:'이전', reset:['points']});
  assert.deepEqual(undoPatch({}, ['title']), {reset:['title']});
  assert.deepEqual(undoPatch({organization_id:null}, ['organization_id']), {organization_id:null});
  assert.deepEqual(undoPatch({}, ['source']), {}, '모르는 칸 이름은 보내지 않는다');
  assert.deepEqual(patchKeys({title:'가', reset:['points', 'counterpart']}), ['title', 'points', 'counterpart']);
});

test('사용자 값 읽기: 작업공간 조건으로 소유자 읽기 전용 표만 읽고 통화 ID별 Map을 돌려준다', async () => {
  const rt = fakeRt(() => [{call_id:ID, vals:{title:'손 제목'}}, {call_id:null, vals:{}}, {call_id:'x', vals:'문자'}]);
  const map = await readCallEdits(rt);
  assert.deepEqual([...map.keys()], [ID]); assert.deepEqual(map.get(ID), {title:'손 제목'});
  assert.ok(rt.calls.every(c => /^\/rest\/v1\/app_call_edits\?workspace_id=eq\./.test(c.path) && !c.method), '읽기만 한다');
  assert.ok(rt.calls.every(c => !/raw_text/.test(c.path)));
});

test('고치기 호출: DB 함수 app_call_edit 하나, 통화 ID와 패치만 보내고 오류는 종류로 나눈다', async () => {
  const ok = fakeRt(() => ({ok:true, id:ID, changed:true, vals:{title:'손 제목'}}));
  assert.deepEqual(await editCall(ID, {title:'손 제목'}, ok), {ok:true, changed:true, vals:{title:'손 제목'}});
  assert.equal(ok.calls[0].path, '/rest/v1/rpc/app_call_edit'); assert.equal(ok.calls[0].method, 'POST');
  assert.deepEqual(ok.calls[0].body, {p_id:ID, p_patch:{title:'손 제목'}});
  assert.equal((await editCall(ID, {}, failWith(400, 'CALL_NOT_FOUND'))).error, 'GONE');
  assert.equal((await editCall(ID, {}, failWith(400, 'CALL_EDIT_TITLE'))).error, 'INVALID');
  assert.equal((await editCall(ID, {}, failWith(400, 'FEED_LINK_SCOPE: x'))).error, 'INVALID');
  assert.equal((await editCall(ID, {}, failWith(404, 'PGRST202 Could not find the function'))).error, 'UNAVAILABLE');
  assert.equal((await editCall(ID, {}, failWith(403, 'permission denied'))).error, 'REFUSED');
  assert.equal((await editCall(ID, {}, failWith(503, 'down'))).error, 'UNKNOWN');
  assert.equal((await editCall(ID, {}, fakeRt(() => ({ok:false})))).error, 'UNKNOWN');
  assert.equal((await editCall(ID, {}, fakeRt(() => ({ok:true})))).error, 'UNKNOWN', 'vals 없는 답은 성공으로 보지 않는다');
});

test('안내 글: 오류 종류마다 한 줄, 원장 알림은 원장을 건드리지 않는다고 말한다', () => {
  for (const code of Object.keys(EDIT_ERRORS)) assert.equal(editErrorText(code), EDIT_ERRORS[code]);
  assert.equal(editErrorText('???'), EDIT_ERRORS.REFUSED);
  assert.equal(EDIT_DONE.title, '제목을 바꿨어요.');
  assert.match(EDIT_LEDGER_NOTE, /원장은 그대로/);
  assert.match(EDIT_LEDGER_NOTE, /수정 요청/);
});

test('화면 파일: 고친 값은 DB 함수로만 쓰고, 브라우저 저장·기존 칸 직접 쓰기·덮어쓰기용 지연 그리기가 없다', () => {
  const src = readFileSync(new URL('../app/call-feed.js', import.meta.url), 'utf8');
  assert.ok(!/localStorage|sessionStorage|indexedDB/.test(src), '저장은 서버뿐');
  assert.ok(!/MutationObserver/.test(src));
  assert.match(src, /editCall\(/); assert.match(src, /readCallEdits\(/);
  assert.ok(!/patchItem\([^)]*(title|points|counterpart)/.test(src), '통화 표의 제목·핵심내용·상대 칸은 직접 쓰지 않는다');
  for (const a of ['data-cf-act="title"', 'data-cf-act="who"', 'data-cf-act="sum"', 'data-cf-sum-open', 'data-cf-who-open']) assert.ok(src.includes(a), a);
  assert.match(src, /e\.key === 'F2'/); assert.match(src, /e\.key === 'Enter'/); assert.match(src, /e\.key === 'Escape'/);
  assert.match(src, /focusout/);
  assert.ok(src.indexOf('data-cf-act="title"') < src.indexOf('data-cf-act="pin"'), '고치기 항목이 메뉴 맨 위');
});

test('업무 · 개인 버튼은 작은 글자 버튼이다(.feed-small 큰 버튼이 아님)', () => {
  const src = readFileSync(new URL('../app/call-feed.js', import.meta.url), 'utf8');
  const decide = src.slice(src.indexOf('const decideHtml'), src.indexOf('function rowHtml'));
  assert.match(decide, /feed-text-btn/); assert.ok(!/feed-small/.test(decide));
  assert.equal((src.match(/decideHtml\(/g) || []).length, 2, '확인할 통화 줄과 상세 위 줄 둘 다 같은 부품');
});

test('CSS: 새 규칙은 토큰만 쓰고 하드코딩 색이 없다', () => {
  const css = readFileSync(new URL('../app/feed.css', import.meta.url), 'utf8');
  const mine = css.slice(css.indexOf('CALL-손고치기'));
  assert.ok(mine.length > 100);
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(mine));
});
