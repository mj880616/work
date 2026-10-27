// TG-요약고치기: 고친 요약을 AI 값 위에 입히는 순수 규칙(app/tg-day-model.mjs)과 화면·읽기쓰기 파일의 정적 규칙. 방·아이디·내용은 모두 지어낸 것.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cleanEditVals, editMap, itemTarget, dayTarget, itemSummary, isItemEdited, applyLineEdit, dayEdit, cleanSummaryInput, cleanDayInput, dayPatch,
  sumEditErrorText, linesToText, daySummary, lineText, lineOf, SUMEDIT, SUMEDIT_TEXT} from '../app/tg-day-model.mjs';

const ID = '11111111-2222-4333-8444-555555555555';
const ROW = {id:ID, summary:'가상 AI 요약'};
const parts = [{first_at:'2026-10-24T01:00:00Z', headline:'가상 AI 한 줄', lines:['가상 AI 첫째', '가상 AI 둘째']}];

test('서버가 준 고친 값은 모양이 맞는 칸만 남긴다(빈 한 줄은 "고쳐서 비운 것"이라 남김)', () => {
  assert.deepEqual(cleanEditVals({summary:' 고친\n요약 ', headline:'', lines:['가', ' ', '나'], other:1}), {summary:'고친 요약', headline:'', lines:['가', '나']});
  assert.deepEqual(cleanEditVals({summary:'  ', lines:[1, null]}), {});
  assert.deepEqual(cleanEditVals(null), {}); assert.deepEqual(cleanEditVals([]), {});
});

test('고친 값 표 → Map: 열쇠 모양이 틀리거나 값이 없는 줄은 버린다', () => {
  const m = editMap([{target:itemTarget(ID), vals:{summary:'가'}}, {target:dayTarget('room_a', '2026-10-24'), vals:{lines:['나']}}, {target:'item:x', vals:{summary:'다'}}, {target:itemTarget(ID.replace('1', '2')), vals:{}}, null]);
  assert.deepEqual([...m.keys()], [itemTarget(ID), dayTarget('room_a', '2026-10-24')]);
});

test('소식 한 줄: 고친 값이 있으면 그것, 없으면 AI summary. AI 줄 객체는 건드리지 않는다', () => {
  const edits = editMap([{target:itemTarget(ID), vals:{summary:'손으로 고친 요약함.'}}]);
  assert.equal(itemSummary(ROW, edits), '손으로 고친 요약함.'); assert.equal(isItemEdited(ROW, edits), true);
  assert.equal(itemSummary(ROW, new Map()), '가상 AI 요약'); assert.equal(itemSummary(ROW, null), '가상 AI 요약'); assert.equal(isItemEdited(ROW, null), false);
  assert.equal(ROW.summary, '가상 AI 요약');
});

test('목록 한 줄: 고친 headline을 입히고, 비워서 고친 것은 소식 제목 모음으로 물러난다', () => {
  const line = lineOf({room_key:'room_a', day:'2026-10-24', headline:'가상 AI 한 줄'});
  const edits = editMap([{target:dayTarget('room_a', '2026-10-24'), vals:{headline:'고친 한 줄'}}]);
  assert.equal(lineText(applyLineEdit(line, edits), new Map()), '고친 한 줄');
  assert.equal(lineText(applyLineEdit(line, new Map()), new Map()), '가상 AI 한 줄');
  const cleared = editMap([{target:dayTarget('room_a', '2026-10-24'), vals:{headline:'', lines:['가']}}]);
  assert.equal(applyLineEdit(line, cleared).headline, '');
  assert.equal(line.headline, '가상 AI 한 줄');
});

test('그날 요약: 고친 줄이 AI 줄을 대신하고 edited 표시가 붙는다. 없으면 AI 줄 그대로', () => {
  const plain = daySummary(parts, []);
  assert.deepEqual(plain.lines, ['가상 AI 첫째', '가상 AI 둘째']); assert.equal(plain.edited, false);
  const edits = editMap([{target:dayTarget('room_a', '2026-10-24'), vals:{lines:['고친 1', '고친 2', '고친 3', '고친 4', '고친 5']}}]);
  const sum = daySummary(parts, [], {edit:dayEdit(edits, 'room_a', '2026-10-24')});
  assert.equal(sum.edited, true); assert.equal(sum.kind, 'ai'); assert.deepEqual(sum.shown, ['고친 1', '고친 2', '고친 3', '고친 4']); assert.deepEqual(sum.rest, ['고친 5']);
  assert.equal(dayEdit(edits, 'room_b', '2026-10-24'), null);
  // headline만 고친 날은 줄은 AI 것을 그대로 쓴다
  const onlyHead = daySummary(parts, [], {edit:{headline:'가'}});
  assert.deepEqual(onlyHead.lines, ['가상 AI 첫째', '가상 AI 둘째']);
});

test('입력 검사: 소식 한 줄은 줄바꿈을 띄어쓰기로, 비면 막고 한도를 넘으면 막는다', () => {
  assert.deepEqual(cleanSummaryInput(' 가\n나 '), {ok:true, value:'가 나'});
  assert.deepEqual(cleanSummaryInput('  '), {ok:false, error:'EMPTY'});
  assert.equal(cleanSummaryInput('가'.repeat(SUMEDIT.SUMMARY_MAX)).ok, true);
  assert.deepEqual(cleanSummaryInput('가'.repeat(SUMEDIT.SUMMARY_MAX + 1)), {ok:false, error:'LONG_SUMMARY'});
});

test('입력 검사: 그날 요약은 한 줄에 요약 한 줄, 빈 줄은 버리고 줄 수·글자 한도를 지킨다', () => {
  assert.deepEqual(cleanDayInput({headline:' 한 줄 ', text:'가\n\n나 \r\n다'}), {ok:true, headline:'한 줄', lines:['가', '나', '다']});
  assert.deepEqual(cleanDayInput({headline:'', text:' \n '}), {ok:false, error:'EMPTY'});
  assert.deepEqual(cleanDayInput({headline:'가'.repeat(SUMEDIT.HEADLINE_MAX + 1), text:'가'}), {ok:false, error:'LONG_HEADLINE'});
  assert.deepEqual(cleanDayInput({text:Array(SUMEDIT.LINES_MAX + 1).fill('가').join('\n')}), {ok:false, error:'MANY'});
  assert.deepEqual(cleanDayInput({text:'가'.repeat(SUMEDIT.LINE_MAX + 1)}), {ok:false, error:'LONG_LINE'});
  assert.equal(cleanDayInput({text:Array(SUMEDIT.LINES_MAX).fill('가'.repeat(SUMEDIT.LINE_MAX)).join('\n')}).ok, true);
});

test('저장할 때는 바뀐 칸만 보낸다. 바뀐 곳이 없으면 아무것도 보내지 않는다', () => {
  const cur = {headline:'가상 AI 한 줄', lines:['가상 AI 첫째', '가상 AI 둘째']};
  assert.deepEqual(dayPatch(cur, {headline:'가상 AI 한 줄', lines:['가상 AI 첫째', '가상 AI 둘째']}), {});
  assert.deepEqual(dayPatch(cur, {headline:'새 한 줄', lines:['가상 AI 첫째', '가상 AI 둘째']}), {headline:'새 한 줄'});
  assert.deepEqual(dayPatch(cur, {headline:'가상 AI 한 줄', lines:['가상 AI 첫째']}), {lines:['가상 AI 첫째']});
  assert.deepEqual(dayPatch(cur, {headline:'', lines:['가']}), {headline:'', lines:['가']});
});

test('거절 이유와 글: 알려진 코드는 각자 글, 모르는 코드는 "저장하지 못했어요"', () => {
  for (const code of ['EMPTY', 'LONG_SUMMARY', 'LONG_HEADLINE', 'MANY', 'LONG_LINE', 'GONE', 'REFUSED', 'UNAVAILABLE', 'UNKNOWN']) assert.ok(sumEditErrorText(code).length > 5, code);
  assert.equal(sumEditErrorText('???'), SUMEDIT_TEXT.REFUSED);
  assert.equal(linesToText(['가', '나']), '가\n나');
});

// ---- 화면·읽기쓰기 파일의 정적 규칙
const screen = readFileSync(new URL('../app/telegram-feed.js', import.meta.url), 'utf8');
const data = readFileSync(new URL('../app/feed-data.js', import.meta.url), 'utf8');
const model = readFileSync(new URL('../app/tg-day-model.mjs', import.meta.url), 'utf8');
const BROWSER_STORE = new RegExp(['local', 'session'].map(w => w + 'Stor' + 'age').concat(['indexed' + 'DB', 'document\\.coo' + 'kie']).join('|'));

test('고친 요약은 서버에만 둔다: 함수 이름 둘, 이 기기에만 남기는 저장 없음, AI 값 칸은 쓰지 않는다', () => {
  assert.match(data, /rest\/v1\/app_feed_summary_edits\?/); assert.match(data, /'app_feed_summary_edit'/);
  for (const [name, text] of [['telegram-feed', screen], ['feed-data', data], ['tg-day-model', model]]) assert.doesNotMatch(text, BROWSER_STORE, name);
  assert.doesNotMatch(data, /method:\s*'(PATCH|DELETE)'[^\n]*app_feed_(items|room_days)/, 'AI 요약 칸을 직접 고치지 않는다');
});

test('화면: 그날 요약 ✎, 줄 메뉴 [요약 고치기], [취소][저장], [AI 원래 요약으로], 고침 표시가 모두 있다', () => {
  for (const mark of ['data-tg-sumedit-day', 'data-tg-act="sumedit">요약 고치기', 'data-tg-se-cancel', 'data-tg-se-save', 'data-tg-se-orig', 'AI 원래 요약으로', 'feed-edited">고침']) assert.ok(screen.includes(mark), mark);
  assert.match(screen, /data-enter-save="\[data-tg-se-save\]"/, 'Ctrl+Enter 저장은 공통 규칙(enter-save.js)으로');
  assert.match(screen, /const editsOn = \(\) => state\.edits instanceof Map;/, '표를 읽지 못하면 고치기 입구를 숨긴다');
  assert.ok(screen.indexOf('data-tg-se-orig') < screen.indexOf('data-tg-se-cancel'), '[AI 원래 요약으로]는 왼쪽, [취소][저장]은 오른쪽(글 순서)');
});

test('고친 요약이 쓰이는 자리: 소식 줄·고정 띠·복사 글·그날 요약·목록 한 줄이 모두 sumOf/dayEdit/lineView를 거친다', () => {
  assert.match(screen, /const tgText = r => summaryCopyText\(\{[^}]*body:\[sumOf\(r\)\]/);
  assert.match(screen, /esc\(sumOf\(pins\[0\]\)/);
  assert.match(screen, /esc\(sumOf\(r\) \|\| r\.title/);
  assert.match(screen, /daySummary\(d\.parts, d\.items, \{partsKnown:d\.parts !== null, edit:dayEdit\(/);
  assert.equal((screen.match(/lineText\(lineView\(l\)/g) || []).length, 2, '평소 목록과 보관함');
  assert.doesNotMatch(screen, /lineText\(l, state\.titles\)/);
});
