// WEEKLY-내양식자유변형 ⑤-3b: 화면 절 제목은 '내 양식' profile 제목에서 만든다(코드에 박힌 제목 없음).
// 지어낸 고정 양식(tests/fixtures/weekly-own-form-legacy-shape.json — ⑤-3 전 기본 양식을 글자 그대로 옮김)으로
// 사용자 화면 글자가 지금과 같은지 본다. 다른 두 곳은 화면이 한글 파일 글과 달랐던 곳이고, 이제 파일 글 그대로다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {screenTitles, headNumber, headBare} from '../app/weekly-screen-titles.mjs';
import {profileOf} from '../app/weekly-hwpx/form-profile.mjs';
import {LEGACY_FORM, TITLES} from './fixtures/weekly-screen-titles.mjs';

test('고정 양식 → 화면 제목: ⑤-3b 전 화면 글자와 같다(두 곳은 한글 파일 글 그대로)', () => {
  // ⑤-3b 전 화면에 박혀 있던 글자.
  const before = {requests:'1. 요청사항', ask:'1) 임원 배정 요청', hq:'2) 주요 일정', discuss:'3) 상집 논의 요청', summary:'1) 요약',
    details:'2) 세부 내용 — 회의·활동 결과', sites:'3. 투쟁 사업장 현황', orgSummary:'1) 요약', calendar:'5. 주요 일정',
    atHq:'1. 2) 주요 일정', atDiscuss:'1. 3) 상집 논의 요청', atDetails:'2. 2) 세부 내용'};
  for (const [key, text] of Object.entries(before)) assert.equal(TITLES[key], text, key);
  // 화면이 파일과 달리 쓰던 두 곳: 이제 양식(한글 파일) 글 그대로.
  assert.equal(TITLES.work, '2. 기본․영역․의제 사업'); // 전: '2. 기본·영역·의제 사업'(가운뎃점 모양만 다름)
  assert.equal(TITLES.orgs, '4. 산하조직 현황'); // 전: '4. 산하 조직 현황'(띄어쓰기)
  assert.equal(TITLES.atSites, '3. 2) 투쟁 사업장 현황');
});

test('제목은 양식 글에서 온다 — 양식을 바꾸면 화면 제목도 바뀐다', () => {
  const form = structuredClone(LEGACY_FORM);
  const set = (role, title) => { form.sections.find(s => s.role === role).title = title; };
  set('requestTable', '1) 가상 요청 표'); set('discuss', '3) 가상 논의'); set('struggle', '3. 가상 투쟁'); set('siteTable', '2) 가상 사업장');
  set('requests', 'Ⅰ. 가상 요청');
  const t = screenTitles(profileOf(form));
  assert.equal(t.ask, '1) 가상 요청 표');
  assert.equal(t.discuss, '3) 가상 논의');
  assert.equal(t.sites, '3. 가상 사업장');
  assert.equal(t.atDiscuss, '3) 가상 논의', '큰 항목에 숫자 번호가 없으면 앞 번호 없이');
});

test('profile 이 없으면 null — 기본 제목으로 몰래 그리지 않는다', () => {
  assert.equal(screenTitles(null), null);
  assert.equal(screenTitles(undefined), null);
  assert.equal(headNumber('2) 투쟁 사업장 현황'), '2)');
  assert.equal(headNumber('제목'), '');
  assert.equal(headBare('(1) 회의'), '회의');
});

test('앱 화면 코드에 박힌 절 제목이 없다(REQUEST_TITLES·DISCUSS_TITLE 삭제)', () => {
  const files = ['app/journal-weekly.js', 'app/weekly-discuss.mjs', 'app/weekly-discuss-table.js', 'app/weekly-hq-schedule.js', 'app/weekly-hand-lines.js', 'app/journal-hwpx.js'];
  const code = f => readFileSync(f, 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).map(l => l.replace(/\s\/\/.*$/, '')).join('\n');
  for (const f of files) {
    const src = code(f);
    assert.doesNotMatch(src, /REQUEST_TITLES|DISCUSS_TITLE/, f);
    assert.doesNotMatch(src, /['`](?:1\. 요청사항|[123]\) (?:임원 배정 요청|주요 일정|상집 논의 요청)|2\. 기본·영역·의제 사업|4\. 산하 조직 현황|3\. 투쟁 사업장 현황|5\. 주요 일정)/, f);
  }
});
