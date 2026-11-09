import test from 'node:test';
import assert from 'node:assert/strict';
import {FILES_TWO_KEY, twoLayout, twoOn, twoValue, paneSide, sendLabel, paneDest, otherStart, FILES_TWO_DEFAULT} from '../app/files-panes-model.mjs';
import {validValue, parsePrefs, applyChanges, createViewPrefs} from '../app/view-prefs.js';
// S49-30 FILES-통합 2-③ 두 칸(명진 결정 H-2): 켬 계산·막대 글자·받을 곳(반대 칸), 서버 칸 files_two 모양.
test('기본: 폴드 펼침은 두 칸, PC는 한 칸 · 서버 값이 있으면 그 값', () => {
  assert.equal(FILES_TWO_KEY, 'files_two');
  assert.deepEqual({...FILES_TWO_DEFAULT}, {fold: false, wide: false, narrow: false}); // S50-33: 폴드도 PC처럼 한 칸이 기본 · S51-20 ②: 폰도 기본 한 칸
  assert.equal(twoLayout(false), 'fold'); assert.equal(twoLayout(true), 'wide');
  assert.equal(twoOn(undefined, 'fold'), false); assert.equal(twoOn(undefined, 'wide'), false);
  assert.equal(twoOn({fold: false}, 'fold'), false); assert.equal(twoOn({wide: true}, 'wide'), true);
  assert.equal(twoOn({fold: 'yes'}, 'fold'), false, '모양이 틀리면 기본'); assert.equal(twoOn({fold: true}, 'fold'), true);
  assert.equal(twoOn([], 'wide'), false); assert.equal(twoOn({wide: true}, 'phone'), false);
});
test('켬 바꾸기는 이 폭 칸만 바꾸고 다른 폭 칸은 아는 값만 남긴다', () => {
  assert.deepEqual(twoValue(undefined, 'wide', true), {wide: true});
  assert.deepEqual(twoValue({fold: false}, 'wide', true), {fold: false, wide: true});
  assert.deepEqual(twoValue({fold: 'x', wide: true}, 'fold', false), {fold: false, wide: true});
});
test('막대 글자: 왼쪽 칸은 → 오른쪽에, 오른쪽 칸은 ← 왼쪽에', () => {
  assert.equal(paneSide(0), '왼쪽'); assert.equal(paneSide(1), '오른쪽');
  assert.equal(sendLabel(0, 'copy'), '→ 오른쪽에 복사'); assert.equal(sendLabel(0, 'move'), '→ 옮기기');
  assert.equal(sendLabel(1, 'copy'), '← 왼쪽에 복사'); assert.equal(sendLabel(1, 'move'), '← 옮기기');
});
test('받을 곳 = 폴더를 연 칸만(찾는 중·묶음·빈 칸은 없음) · 오른쪽 칸 첫 위치는 다른 저장소 맨 위', () => {
  assert.deepEqual(paneDest({where: {source: 'od', parent: 'OD!1'}, query: ''}), {source: 'od', parent: 'OD!1'});
  assert.deepEqual(paneDest({where: {source: 'gd'}, query: ''}), {source: 'gd', parent: null});
  assert.equal(paneDest({where: {source: 'od', parent: null}, query: '찾기'}), null);
  assert.equal(paneDest({where: {shelf: 'starred'}, query: ''}), null);
  assert.equal(paneDest({where: null}), null);
  assert.deepEqual(otherStart({source: 'od', parent: 'x'}, ['od', 'gd']), {source: 'gd', parent: null});
  assert.deepEqual(otherStart({shelf: 'starred'}, ['od', 'gd']), {source: 'od', parent: null});
  assert.deepEqual(otherStart({source: 'od'}, ['od']), {source: 'od', parent: null});
  assert.equal(otherStart(null, []), null);
});
test('view_prefs files_two: 기기 칸 app·phone·pc, 안은 fold·wide 참·거짓만(DB 검사와 같은 모양) · 한 칸씩 쓰기', () => {
  for (const v of [{}, {pc: {}}, {pc: {fold: false}}, {app: {fold: true, wide: false}, phone: {wide: true}, pc: {wide: true}}]) assert.equal(validValue('files_two', v), true, JSON.stringify(v));
  for (const v of [null, [], 'pc', {tablet: {fold: true}}, {pc: true}, {pc: {fold: 1}}, {pc: {phone: true}}, {pc: {fold: true, x: false}}]) assert.equal(validValue('files_two', v), false, JSON.stringify(v));
  assert.deepEqual(parsePrefs({files_two: {pc: {wide: true}, app: {bad: 1}}}), {files_two: {pc: {wide: true}}});
  assert.deepEqual(applyChanges({files_two: {app: {fold: false}}, files_sources: {pc: {od: true}}}, {'files_two.pc': {wide: true}}),
    {files_two: {app: {fold: false}, pc: {wide: true}}, files_sources: {pc: {od: true}}});
  assert.deepEqual(applyChanges({files_two: {pc: {wide: true}}}, {'files_two.pc': null}), {});
  const prefs = createViewPrefs({runtime: () => null, storage: () => null});
  assert.equal(prefs.getFilesTwo('pc'), undefined);
  assert.equal(prefs.get('files_two'), undefined, '기기 칸 객체는 get으로 통째로 읽지 않는다');
});

test('S51-20 ②: 폰 위·아래 두 칸 — narrow 칸, 칸 이름 위·아래, 고르기 막대 화살표 ↓·↑', async () => {
  const {paneSide, sendLabel} = await import('../app/files-panes-model.mjs');
  assert.equal(twoLayout(false, true), 'narrow'); assert.equal(twoLayout(true, true), 'wide'); assert.equal(twoLayout(false, false), 'fold');
  assert.equal(twoOn(undefined, 'narrow'), false); assert.equal(twoOn({narrow: true}, 'narrow'), true); assert.equal(twoOn({narrow: true}, 'fold'), false);
  assert.deepEqual(twoValue({fold: true}, 'narrow', true), {fold: true, narrow: true});
  assert.equal(paneSide(0, true), '위'); assert.equal(paneSide(1, true), '아래'); assert.equal(paneSide(1), '오른쪽');
  assert.equal(sendLabel(0, 'copy', true), '↓ 아래에 복사'); assert.equal(sendLabel(1, 'copy', true), '↑ 위에 복사');
  assert.equal(sendLabel(0, 'move', true), '↓ 옮기기'); assert.equal(sendLabel(0, 'copy'), '→ 오른쪽에 복사');
});

// S52-07 FILES-칸출처고르기: 칸마다 고른 출처(서버 files_panes.<기기> = [첫 칸, 둘째 칸]).
import {panesSaved, panesValue, paneStart, paneChoices, paneSourceLabel, PANE_SOURCES} from '../app/files-panes-model.mjs';
import {validValue as prefsValid, parsePrefs as prefsParse} from '../app/view-prefs.js';
test('files_panes: 저장값 읽기·고른 뒤 값·첫 위치', () => {
  assert.deepEqual(PANE_SOURCES, ['od', 'gd', 'ph', 'pc']);
  assert.deepEqual(panesSaved(['gd', 'od']), ['gd', 'od']);
  for (const v of [undefined, null, [], ['od'], ['od', 'gd', 'ph'], ['od', 'xx'], 'od', {0: 'od', 1: 'gd'}]) assert.equal(panesSaved(v), null, JSON.stringify(v));
  // 칸 1에서 gd를 고름: 반대 칸은 지금 보이는 출처 → 저장값 → 고른 것.
  assert.deepEqual(panesValue(undefined, 1, 'gd', 'od'), ['od', 'gd']);
  assert.deepEqual(panesValue(['pc', 'ph'], 0, 'gd', ''), ['gd', 'ph']);
  assert.deepEqual(panesValue(undefined, 0, 'od', ''), ['od', 'od']);
  assert.equal(panesValue(undefined, 0, 'dropbox', 'od'), null);
  // 첫 위치: 기억한 출처가 켜져 있으면 그것, 아니면 지금 규칙(칸 0 = 첫 출처, 칸 1 = 왼쪽과 다른 출처).
  assert.deepEqual(paneStart(0, ['gd', 'od'], ['od', 'gd']), {source: 'gd', parent: null});
  assert.deepEqual(paneStart(1, ['gd', 'od'], ['od', 'gd'], {source: 'gd'}), {source: 'od', parent: null});
  assert.deepEqual(paneStart(1, ['gd', 'ph'], ['od', 'gd'], {source: 'od'}), {source: 'gd', parent: null});
  assert.deepEqual(paneStart(0, ['ph', 'od'], ['od', 'gd']), {source: 'od', parent: null});
  assert.deepEqual(paneStart(1, null, ['od', 'gd'], {source: 'od'}), {source: 'gd', parent: null});
  assert.equal(paneStart(0, ['od', 'gd'], []), null);
  assert.equal(paneSourceLabel({source: 'ph'}), '이 폰');
  assert.equal(paneSourceLabel({shelf: 'starred'}), '출처');
});
test('files_panes: 칸 머리 네 줄 — 못 쓰는 출처는 흐리게 + 이유', () => {
  const rows = paneChoices({cur: 'od', on: ['od'], linked: ['od', 'gd'], phone: {usable: false}, pc: {usable: true, ok: false}});
  assert.deepEqual(rows.map(r => [r.src, r.usable, r.why, r.cur]), [['od', true, '', true], ['gd', false, '위 줄에서 끔', false], ['ph', false, '폰 앱에서만', false], ['pc', false, 'PC 앱이 켜졌을 때만', false]]);
  const app = paneChoices({cur: 'ph', on: ['od', 'gd', 'ph'], linked: ['od'], phone: {usable: true, all: true}, pc: {usable: false}});
  assert.deepEqual(app.map(r => [r.src, r.usable, r.why]), [['od', true, ''], ['gd', false, '연결 안 됨'], ['ph', true, ''], ['pc', false, 'PC 브라우저에서만']]);
  assert.equal(paneChoices({phone: {usable: true, all: false}}).find(r => r.src === 'ph').why, '파일 접근 허락 필요');
});
test('files_panes: 화면 쪽 모양 검사는 DB 검사와 같다(기기 종류 app·phone·pc, 길이 2, od·gd·ph·pc)', () => {
  assert.equal(prefsValid('files_panes', {pc: ['od', 'gd'], app: ['ph', 'ph'], phone: ['pc', 'od']}), true);
  for (const v of [{tablet: ['od', 'gd']}, {pc: ['od']}, {pc: ['od', 'gd', 'ph']}, {pc: ['OD', 'gd']}, {pc: 'od'}, [], null]) assert.equal(prefsValid('files_panes', v), false, JSON.stringify(v));
  assert.deepEqual(prefsParse({files_panes: {pc: ['od', 'gd'], app: ['xx', 'od']}}).files_panes, {pc: ['od', 'gd']});
});

// LIB-두칸보기 PR-1: 두 칸 틀 공용 키 판정(app/two-pane.js가 [파일]·자료실에서 같이 쓴다).
test('두 칸 키: F6 옮기기 · F5 복사(복사 없는 화면은 가로채지 않음) · Tab은 줄에서만 칸 바꾸기 · 조합키는 그대로', async () => {
  const {paneKeyAction} = await import('../app/files-panes-model.mjs');
  assert.equal(paneKeyAction({key: 'F6'}), 'move');
  assert.equal(paneKeyAction({key: 'F5'}), 'copy');
  assert.equal(paneKeyAction({key: 'F5', copy: false}), null, '자료실: F5는 새로고침 그대로');
  assert.equal(paneKeyAction({key: 'F6', copy: false}), 'move');
  assert.equal(paneKeyAction({key: 'Tab', onRow: true}), 'switch');
  assert.equal(paneKeyAction({key: 'Tab', onRow: false}), null, '단추 사이 Tab 이동은 그대로');
  assert.equal(paneKeyAction({key: 'F6', mod: true}), null);
  assert.equal(paneKeyAction({key: 'Tab', onRow: true, mod: true}), null);
  assert.equal(paneKeyAction({key: 'Enter', onRow: true}), null);
  assert.equal(paneKeyAction(), null);
});
