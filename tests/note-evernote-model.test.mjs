// S69-97 NOTE-에버노트 ①②③: 화면 없는 규칙. 합성 데이터만.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cleanDoc, GTASK_ID} from '../app/ed-schema.mjs';
import {kstIso, kstDay, quickAlarms, checkAlarm, alarmLabel, noteAlarmAt, alarmPast} from '../app/note-alarm-model.mjs';
import * as templatesModel from '../app/note-templates-model.mjs';
const {TEMPLATE_EMPTY_HINT, checkTemplateName, joinTemplate, templateBody} = templatesModel;

const p = text => ({type: 'paragraph', attrs: {style: 'body2'}, content: [{type: 'text', text}]});
const check = (...items) => ({v: 'ed1', doc: {type: 'doc', content: [{type: 'bullet_list', attrs: {marker: 'check'}, content: items}]}});

test('① 체크칸의 구글 할 일 연결(gtask)은 저장 모양에 남고, 모양이 다르거나 만드는 중 표시는 버린다', () => {
  const d = cleanDoc(check({type: 'list_item', attrs: {checked: true, gtask: 'abc_DEF-123'}, content: [p('가')]},
    {type: 'list_item', attrs: {gtask: 'wait:zz'}, content: [p('나')]}, {type: 'list_item', attrs: {gtask: '<x>'}, content: [p('다')]}));
  const items = d.doc.content[0].content.map(li => li.attrs || null);
  assert.deepEqual(items, [{checked: true, gtask: 'abc_DEF-123'}, null, null]);
  assert.ok(GTASK_ID.test('a'.repeat(200)) && !GTASK_ID.test('a'.repeat(201)));
  // Edge 복사본(phone-push 등이 쓰는 _shared)도 같은 규칙이다.
  const app = readFileSync('app/ed-schema.mjs', 'utf8'), edge = readFileSync('supabase/functions/_shared/ed-schema.mjs', 'utf8');
  assert.equal(edge.split('\n').slice(2).join('\n'), app);
});

test('① google-tasks pick: 내 연결로 할 일 몇 개만 읽고, 쓰기·DB 접근이 없다', () => {
  const src = readFileSync('supabase/functions/google-tasks/index.ts', 'utf8');
  const start = src.indexOf("if(action==='pick')"), end = src.indexOf('\n', start), line = src.slice(start, end);
  assert.ok(start > src.indexOf('const c=await ensureAccess(user.id);'), '내 구글 연결(ensureAccess(user.id)) 뒤에서만');
  assert.match(line, /raw\.length>50/);
  assert.doesNotMatch(line, /'PATCH'|'POST'|'DELETE'|db\.|admin\./);
});

test('② 노트 알림 시각: 서울 시각 → UTC ISO(Z), 빠른 고르기, 검사, 글자', () => {
  assert.equal(kstIso('2026-11-27', '09:00'), '2026-11-27T00:00:00.000Z');
  assert.equal(kstIso('2026-11-27', '24:00'), null);
  // 2026-11-25(수) 서울 10:00
  const now = Date.parse('2026-11-25T01:00:00.000Z');
  assert.equal(kstDay(now), '2026-11-25');
  assert.deepEqual(quickAlarms(now).map(q => [q.key, q.at]), [
    ['tonight', '2026-11-25T09:00:00.000Z'], ['tomorrow', '2026-11-26T00:00:00.000Z'],
    ['friday', '2026-11-27T00:00:00.000Z'], ['monday', '2026-11-30T00:00:00.000Z']]);
  // 금요일 아침 9시 지나면 금요일은 다음 주 금요일. 저녁 6시가 지나면 '오늘 저녁'은 없다.
  const friNight = Date.parse('2026-11-27T10:00:00.000Z'); // 금 19:00
  assert.deepEqual(quickAlarms(friNight).map(q => q.key), ['tomorrow', 'friday', 'monday']);
  assert.equal(quickAlarms(friNight).find(q => q.key === 'friday').at, '2026-12-04T00:00:00.000Z');
  assert.equal(checkAlarm('2026-11-25T00:00:00.000Z', now), '지금보다 뒤의 시각을 선택해 주세요.');
  assert.equal(checkAlarm('2028-01-01T00:00:00.000Z', now), '1년 안의 시각만 선택할 수 있어요.');
  assert.equal(checkAlarm('2026-11-27T00:00:00.000Z', now), '');
  assert.equal(alarmLabel('2026-11-27T00:00:00.000Z', now), '11/27(금) 09:00');
  assert.equal(noteAlarmAt({metadata: {alarm: {at: '2026-11-27T00:00:00.000Z'}}}), '2026-11-27T00:00:00.000Z');
  assert.equal(noteAlarmAt({metadata: {alarm: 'x'}}), null);
  assert.ok(alarmPast('2026-11-25T00:00:00.000Z', now));
});

// 기기 저장 낱말(브라우저 저장 감사가 시험 글자도 세므로 이름을 나눠 쓴다).
const DEVICE_STORE = new RegExp(['local' + 'Storage', 'session' + 'Storage', 'indexed' + 'DB'].join('|'));
test('② 노트 알림은 서버 저장만: 기기 저장 없음, 노트 metadata.alarm 한 칸', () => {
  for (const f of ['app/note-alarm.js', 'app/note-alarm-model.mjs', 'app/note-templates.js', 'app/note-templates-model.mjs', 'app/ed-gtasks.js', 'app/note-gtasks.js'])
    assert.doesNotMatch(readFileSync(f, 'utf8'), DEVICE_STORE, f);
  const data = readFileSync('app/basket-data.js', 'utf8');
  assert.match(data, /export function setNoteAlarm\(note, at, rt = window\.KPTURuntime\) \{\n  return patchNoteMetadata\(/);
});

test('③ 서식: 앱이 미리 넣은 서식 없음(S71-65), 이름 검사, 빈 글이면 그대로·쓴 글 뒤에 붙임, 연결·체크는 따라오지 않음', () => {
  assert.equal('BUILTIN_TEMPLATES' in templatesModel, false);
  for (const f of ['app/note-templates-model.mjs', 'app/note-templates.js', 'app/note-window.js'])
    assert.doesNotMatch(readFileSync(f, 'utf8'), /기본 서식|주간 계획|통화 기록|BUILTIN_TEMPLATES/, f);
  assert.equal(TEMPLATE_EMPTY_HINT, '노트 ⋯ [서식으로 저장]으로 내 서식을 만들어요.');
  assert.equal(checkTemplateName(' '), '서식 이름을 써 주세요.');
  assert.equal(checkTemplateName('가'.repeat(41)), '서식 이름은 40자까지 쓸 수 있어요.');
  assert.equal(checkTemplateName('회의록'), '');
  const linked = check({type: 'list_item', attrs: {checked: true, gtask: 'abc'}, content: [p('할 일')]});
  assert.deepEqual(templateBody({doc: linked}).doc.content[0].content[0].attrs, {});
  const mine = {doc: {v: 'ed1', doc: {type: 'doc', content: [{type: 'heading', attrs: {level: 2}, content: [{type: 'text', text: '누구와'}]}, p('')]}}};
  const empty = {v: 'ed1', doc: {type: 'doc', content: [{type: 'paragraph', content: []}]}};
  assert.deepEqual(joinTemplate(empty, mine).doc.content, mine.doc.doc.content);
  const written = {v: 'ed1', doc: {type: 'doc', content: [p('먼저')]}};
  const joined = joinTemplate(written, mine).doc.content;
  assert.equal(joined[0].content[0].text, '먼저');
  assert.equal(joined.length, 1 + mine.doc.doc.content.length);
});
