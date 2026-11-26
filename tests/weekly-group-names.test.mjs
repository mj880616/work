// WEEKLY-내양식자유변형 ⑤-3d: 학습 묶음 이름(칸별 '그대로 쓴 비율'·안 내는 제안 이름·환류 정리 재료)은 '내 양식' 제목에서.
// 대조(사용자 조건 — 결과가 지금과 같아야 함): 지어낸 고정 양식(tests/fixtures/weekly-own-form-legacy-shape.json, ⑤-3 전 기본 양식과 같은 모양)으로
// 안 내는 제안 이름·[주간 정리] 절 제목에 쓰던 글은 ⑤-3d 전과 같다. 칸별 비율 묶음 이름은 같은 양식의 절 제목 글(화면 h4와 같은 글)이 된다.
// 양식이 없으면 번호 없는 일반적인 말. 앱 파일과 서버 사본은 바이트까지 같다. 실제 조직·사람 이름은 쓰지 않는다(가짜 견본만).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {groupNames, groupKeyOf, titlesOfForm, GROUP_KEYS, GENERIC} from '../app/weekly-group-names.mjs';
import {sigLabel, cellKeptRates, learnPicks, withPick, sigOf} from '../app/weekly-picks.mjs';
import {screenTitles} from '../app/weekly-screen-titles.mjs';
import {profileOf} from '../app/weekly-hwpx/form-profile.mjs';

const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8');
const LEGACY_FORM = JSON.parse(read('./fixtures/weekly-own-form-legacy-shape.json'));
const LEGACY = groupNames(profileOf(LEGACY_FORM).titles);

test('앱 파일과 서버 사본(_shared)은 바이트까지 같다', () => {
  assert.equal(read('../supabase/functions/_shared/weekly-group-names.mjs'), read('../app/weekly-group-names.mjs'));
});

test('코드에 박힌 양식 제목이 없다(앱·서버 묶음 이름·안내 글)', () => {
  const files = ['../app/weekly-group-names.mjs', '../app/weekly-picks.mjs', '../supabase/functions/ai-assist/weekly-learn.ts',
    '../supabase/functions/ai-assist/schedule-titles.ts', '../supabase/functions/ai-assist/form-names.ts'];
  for (const f of files) {
    const src = read(f).split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n'); // 설명 글(주석)은 빼고 코드만
    assert.doesNotMatch(src, /\d\. (요청사항|사업 요약|세부 내용|투쟁 사업장|산하 ?조직|주요 일정)|임원 배정 요청|상집 논의 요청/, f);
  }
});

test('대조: 지어낸 고정 양식이면 안 내는 제안 이름(어느 칸)은 ⑤-3d 전 글과 같다', () => {
  // ⑤-3d 전 sigLabel 이 코드에 박아 쓰던 글을 그대로 옮겨 적은 기대값.
  const before = {'requests:ask':'1. 1) 임원 배정 요청', 'requests:hq':'1. 2) 주요 일정', 'requests:discuss':'1. 3) 상집 논의 요청',
    calendar:'5. 주요 일정', notes:'참고', details:'2. 2) 세부 내용', 'summary:가상 영역›가상 과제':'가상 영역 › 가상 과제', 'orgs:가상 지부':'가상 지부', 'sites:가상 사업장':'가상 사업장'};
  for (const [cell, where] of Object.entries(before)) assert.equal(sigLabel(sigOf({kind:'material', from:'record', cell}), LEGACY), `칸 후보 · 기록 · ${where}`, cell);
  // 양식이 없으면 번호 없는 일반적인 말.
  assert.equal(sigLabel(sigOf({kind:'line', from:'hand', cell:'requests:ask'})), '보고서 줄 · 손 · 요청 표');
  assert.equal(sigLabel(sigOf({kind:'line', from:'calendar', cell:'calendar'})), '보고서 줄 · 달력 · 주요 일정');
});

test('대조: 지어낸 고정 양식이면 묶음 이름은 그 양식 절 제목 글 — [주간 정리] 화면 h4와 같은 글', () => {
  const t = screenTitles(profileOf(LEGACY_FORM));
  assert.deepEqual(t.groups, LEGACY);
  assert.deepEqual(Object.fromEntries(GROUP_KEYS.map(k => [k, LEGACY[k]])), {
    requests:t.requests, summary:'2. 요약', details:'2. 세부 내용', sites:t.sites, orgs:t.orgs, calendar:t.calendar, notes:'참고'});
  assert.deepEqual([LEGACY.requests, LEGACY.sites, LEGACY.orgs, LEGACY.calendar], ['1. 요청사항', '3. 투쟁 사업장 현황', '4. 산하조직 현황', '5. 주요 일정']);
  // 서버가 저장된 양식(app_weekly_forms.form)에서 읽는 제목도 같은 이름.
  assert.deepEqual(groupNames(titlesOfForm(JSON.parse(JSON.stringify(LEGACY_FORM)))), LEGACY);
});

test('양식 없음·일부만: 그 자리는 일반적인 말, 숨김·옛 글자 없음', () => {
  const none = groupNames(null);
  for (const k of GROUP_KEYS) assert.equal(none[k], GENERIC[k], k);
  assert.ok(Object.values(none).every(v => !/^\d/.test(v)), 'no form numbers');
  const part = groupNames({calendar:'다) 가상 일정 칸', work:'나. 가상 사업'});
  assert.equal(part.calendar, '다) 가상 일정 칸');
  assert.equal(part.summary, GENERIC.summary); // 작은 항목 제목이 없으면 일반적인 말
  assert.equal(titlesOfForm({sections:[{role:'zzz', title:'x'}]}), null);
  assert.equal(titlesOfForm({sections:[{role:'calendar', title:'가\n나'}]}).calendar, '가 나');
});

test('자유 변형 양식: 제목을 바꾸면 묶음 이름·칸별 비율이 바꾼 글을 따른다', () => {
  const form = {v:1, sections:LEGACY_FORM.sections.map(s => ({...s, title:{requests:'가. 가상 요청', calendar:'마. 가상 다음 일정', work:'나. 가상 사업', summaryTable:'(1) 가상 요약표'}[s.role] ?? s.title}))};
  const names = groupNames(profileOf(form).titles);
  assert.equal(names.requests, '가. 가상 요청');
  assert.equal(names.calendar, '마. 가상 다음 일정');
  assert.equal(names.summary, '가상 요약표'); // 번호 꼴이 다르면(나.) 번호 없이 작은 항목 글만
  let picks = withPick(null, {kind:'material', from:'record', cell:'summary:가›가-1', text:'가상'}, 'take', '2026-11-02T01:00:00.000Z');
  picks = withPick(picks, {kind:'calendar', from:'calendar', cell:'requests:hq', text:'가상 일정'}, 'drop', '2026-11-02T02:00:00.000Z');
  assert.deepEqual(cellKeptRates(picks, names).map(r => [r.key, r.group, r.percent]), [['requests', '가. 가상 요청', 0], ['summary', '가상 요약표', 100]]);
  assert.deepEqual(cellKeptRates(picks).map(r => r.group), [GENERIC.requests, GENERIC.summary]);
  assert.equal(groupKeyOf('orgref:가'), 'orgs');
  // learnPicks 의 안 내는 제안 이름도 받은 이름으로.
  const rows = ['2026-10-19', '2026-10-26', '2026-11-02'].map((w, i) => ({week_start:w,
    picks:withPick(null, {kind:'line', from:'calendar', cell:'calendar', text:`가상 ${i}`}, 'drop', `${w}T01:00:00.000Z`)}));
  assert.deepEqual(learnPicks(rows, {names}).blocked.map(b => b.label), ['보고서 줄 · 달력 · 마. 가상 다음 일정']);
});
