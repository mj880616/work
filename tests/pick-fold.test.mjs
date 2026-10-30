// UI-고른것접기(PROFILE-담당사업장접기): 긴 체크 목록 공용 부품(app/pick-fold.mjs)과 '다시 생기지 않게' 검사.
// 앱 안에서 항목마다 체크 칸을 그리는 목록은 이 부품을 쓰거나, 아래 SHORT_OR_OTHER 표에 이유와 함께 적혀 있어야 한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chosung, pickMatch, pickFoldHtml} from '../app/pick-fold.mjs';

test('초성: 한글 음절은 첫 자음, 나머지는 그대로', () => {
  assert.equal(chosung('철도노조'), 'ㅊㄷㄴㅈ');
  assert.equal(chosung('까치 KTX'), 'ㄲㅊ KTX');
  assert.equal(chosung(''), '');
});

test('찾기: 글자·초성·섞어 쓰기, 띄어쓰기·대소문자 무시', () => {
  for (const q of ['철도', 'ㅊㄷ', '철ㄷ', 'ㅈㄱㅊ', '노동 조합', '']) assert.ok(pickMatch('전국철도노동조합', q), q);
  for (const q of ['가스', 'ㅎㄱ', '도철', 'ㄷㅊ']) assert.ok(!pickMatch('전국철도노동조합', q), q);
  assert.ok(pickMatch('KORAIL 노조', 'korail'));
  assert.ok(pickMatch('한국가스공사노조', 'ㄱㅅ'));
});

test('모양: 제목이 있으면 접힌 한 줄로 시작, 그 외는 접혀 있고 찾기 칸이 목록보다 먼저', () => {
  const html = pickFoldHtml({key: 'k', title: '담당조직 현황', count: 1, picked: '<i>A</i>', others: [{label: '철도', items: [{name: '전국철도노동조합', html: '<b>B</b>'}]}, {label: '', items: [{name: '한국가스공사노조', html: '<b>C</b>'}]}]});
  assert.match(html, /^<details class="pick-fold" data-pick-fold data-pick-key="k"><summary/);
  assert.doesNotMatch(html, /<details[^>]* open/);
  assert.match(html, /담당조직 현황<\/span> <span class="pick-n" data-pick-count>1</);
  assert.match(html, /그 외 <span class="pick-n">2</);
  assert.ok(html.indexOf('data-pick-search') < html.indexOf('pick-others-list'));
  assert.equal((html.match(/pick-group-name/g) || []).length, 1);
});

test('모양: 상태를 이어 그리면 펼침·찾기 글이 남고, 맞지 않는 줄·묶음은 가린다', () => {
  const html = pickFoldHtml({key: 'k', title: 't', picked: '', others: [{label: '철도', items: [{name: '전국철도노동조합', html: 'B'}]}, {label: '', items: [{name: '한국가스공사노조', html: 'C'}]}], state: {open: true, othersOpen: true, query: 'ㄱㅅ'}});
  assert.match(html, /data-pick-fold data-pick-key="k" open>/);
  assert.match(html, /data-pick-others open>/);
  assert.match(html, /value="ㄱㅅ"/);
  assert.match(html, /data-pick-name="전국철도노동조합" hidden>/);
  assert.match(html, /data-pick-name="한국가스공사노조">/);
  assert.match(html, /<div class="pick-group" data-pick-group hidden>/);
  assert.match(html, /고른 것 없음/);
  assert.match(html, /data-pick-empty hidden>/);
});

test('모양: 제목이 없으면 접는 줄 없이 고른 것 + 그 외, 그 외가 비면 그 칸도 없다', () => {
  const html = pickFoldHtml({key: 'council', picked: 'A', others: []});
  assert.match(html, /^<div class="pick-fold-plain" data-pick-key="council">/);
  assert.doesNotMatch(html, /data-pick-others|data-pick-fold/);
  assert.match(pickFoldHtml({key: 'x', others: [{items: [{name: '<a>', html: ''}]}]}), /data-pick-name="&lt;a&gt;"/);
});

// ---- 다시 생기지 않게: 항목마다 체크 칸을 그리는 곳 전수 ----
const APP = fileURLToPath(new URL('../app/', import.meta.url));
const SKIP = /(^|\/)(hwp-lab|editor-lib|pdf-lib|markdown-lib|legacy)\//;
const USES = /from '\.\/pick-fold\.mjs'|import\('\.\/pick-fold\.mjs'\)/;
// 공용 부품을 쓰지 않아도 되는 체크 칸: 파일 → 이유. 새 긴 체크 목록은 여기에 적지 말고 pick-fold.mjs를 쓴다.
const SHORT_OR_OTHER = {
  'google-tasks.js': '할 일 연결 고르기: 사업영역 나무(들여쓰기 순서) + 내 담당조직만 — 나무 모양은 따로 검토(PR 본문 범위 밖 발견)',
  'ledger-browse.js': '기록 종류 칩(정해진 몇 개)',
  'library-upload.js': '자료 여러 개 고르기 모드: 목록 자체에서 고르는 것이라 고르기 목록이 아님',
  'markdown-render.mjs': '글 안 할 일 표시(읽기 전용)',
  'suborganizations.js': '일정의 관련 담당조직은 내 담당만(짧음), 담당자 고르기는 사람 몇 명',
  'task-row-view.js': '할 일 완료 체크',
  'team.js': '표시할 Google 캘린더(몇 개)',
};
const walk = dir => readdirSync(dir).flatMap(name => { const p = join(dir, name); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = walk(APP).map(p => relative(APP, p).split('\\').join('/')).filter(f => /\.(m?js)$/.test(f) && !SKIP.test(f));
const perItemCheckbox = src => [...src.matchAll(/<input\b[^<>]*?>/g)].some(m => m[0].includes('checkbox') && m[0].includes('${'));

test('항목마다 체크 칸을 그리는 목록은 공용 부품을 쓰거나 이유가 적혀 있다', () => {
  const found = files.filter(f => perItemCheckbox(readFileSync(join(APP, f), 'utf8')));
  const bad = found.filter(f => !SHORT_OR_OTHER[f] && !USES.test(readFileSync(join(APP, f), 'utf8')));
  assert.deepEqual(bad, [], `긴 체크 목록은 pick-fold.mjs(고른 것 + 접힌 그 외, 맨 위 찾기)로 그린다: ${bad.join(', ')}`);
  const stale = Object.keys(SHORT_OR_OTHER).filter(f => !found.includes(f));
  assert.deepEqual(stale, [], '체크 칸이 없어진 파일은 표에서 지운다');
});

// 기기 저장을 쓰지 않는 것은 browser-storage-audit가 앱 전체에서 본다.
test('담당 사업장·협의회·사업단 소속은 공용 부품으로 그린다', () => {
  const profile = readFileSync(join(APP, 'profile-settings.js'), 'utf8');
  assert.match(profile, USES);
  assert.match(profile, /pickFoldHtml\(\{key:'ws',title:'담당조직 현황'/);
  const wd = readFileSync(join(APP, 'workplace-detail.js'), 'utf8');
  assert.match(wd, USES);
  assert.match(wd, /function wdRenderAffChoices\([^\n]*pickFoldHtml\(/);
});
