// UI-접기꺾쇠(S51-33, 요청함 11/06 23:28 "더보기 화살표 버튼이 이상"): 접기·펼치기 표시는 사이트 공용 꺾쇠 하나(⌃ 펼침·⌄ 접힘),
// '더보기'는 세모 없는 '펼치기 ›' 글자 단추. 세모(▴▸) 글자를 접기 표시로 다시 쓰지 않게 앱 소스 전체를 본다(주석 제외).
// 고르기 창을 여는 버튼 뒤 ▾(UI-펼침표시)는 다른 규칙이라 그대로 둔다. 실제 모양·자리는 tests/app-e2e/recent-box-fold.spec.mjs가 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chevHtml, MORE_LABEL, moreLabel } from '../app/fold-chevron.mjs';

const APP = new URL('../app/', import.meta.url).pathname;
const code = file => fs.readFileSync(path.join(APP, file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .split('\n').map(l => (l.trim().startsWith('//') ? '' : l.replace(/\s\/\/ .*$/, '')));
const appFiles = fs.readdirSync(APP).filter(f => /\.(js|mjs|css|html)$/.test(f));
const hits = (re, allow = []) => appFiles.filter(f => !allow.includes(f)).flatMap(f => code(f).map((l, i) => re.test(l) ? `${f}:${i + 1}` : '').filter(Boolean));

test('공용 꺾쇠 부품: 그림만(읽어 주지 않음), 펼침은 is-open, 더보기 글자에 세모 없음', () => {
  assert.equal(chevHtml(false), '<i class="kptu-chev" aria-hidden="true"></i>');
  assert.equal(chevHtml(true, 'ft-box-caret'), '<i class="kptu-chev is-open ft-box-caret" aria-hidden="true"></i>');
  assert.equal(MORE_LABEL, '펼치기 ›');
  assert.equal(moreLabel(3), '펼치기 3 ›');
  assert.equal(moreLabel(), '펼치기 ›');
});

test('모양 한 곳: ui-standard.css UI-접기꺾쇠 — 선 꺾쇠 그림, 펼침은 180도, 열린 details·aria-expanded 안이면 저절로', () => {
  const css = fs.readFileSync(path.join(APP, 'ui-standard.css'), 'utf8');
  assert.match(css, /--kptu-chev-mask:url\("data:image\/svg\+xml,[^"]*M3 5\.25l4 4 4-4/);
  assert.match(css, /\.kptu-chev\{[^}]*mask:var\(--kptu-chev-mask\)/);
  assert.match(css, /\.kptu-chev\.is-open,\[aria-expanded="true"\] > \.kptu-chev,details\[open\] > summary \.kptu-chev\{ transform:rotate\(180deg\); \}/);
  // 옛 ▸/▾ 접힘 표시 규칙(UI-칸안스크롤하나로 ②)은 이 묶음으로 옮겨 남지 않았다.
  assert.doesNotMatch(css, /summary::before\{content:"\\25B8"/);
});

test('세모 ▴는 접기 표시로 쓰지 않는다(계정 메뉴 열림 표시만 예외)', () => {
  assert.deepEqual(hits(/▴|\\25B4/, ['topbar-actions.js']), []);
});

test('세모 ▸는 접기 표시로 쓰지 않는다(폴더 나무 줄·하위 메뉴·[목록 ▸]만 예외 — 폴더 나무는 FOLDER-세모0 몫)', () => {
  assert.deepEqual(hits(/▸|\\25B8/, ['files.js', 'ledger-browse.js', 'note-boards.js', 'news-clipping.js', 'od-settings.js', 'photos.js']), []);
  // 예외 파일도 접는 칸 머리에는 쓰지 않는다.
  for (const f of ['ledger-browse.js', 'google-tasks.js', 'weekly-org-lines.js', 'diary-list.js']) assert.doesNotMatch(code(f).join('\n'), /(이전 결정|나중|완료|지난주|줄) [^<]{0,8}▸/, f);
});

test('CSS 가상 요소로 세모 접기 표시를 그리지 않는다(고르기 ▾는 field-btn·계정 메뉴·UI-펼침표시만)', () => {
  const bad = hits(/content:\s*['"][^'"]*(▸|▴|\\25B8|\\25B4)/);
  assert.deepEqual(bad, []);
  // 고르기 창을 여는 버튼 뒤 ▾만: 계정 메뉴·field-btn·UI-펼침표시·자료실 [분류 ▾](S51-28).
  const pickers = new Set(['topbar-actions.css', 'ui-standard.css', 'library-upload.css']);
  assert.deepEqual(hits(/content:\s*['"][^'"]*(▾|\\25BE)/, []).map(s => s.split(':')[0]).filter(f => !pickers.has(f)), []);
});

test("'더보기 ▾'·'접기 ▴'·'펼치기 ▾' 같은 세모 붙은 접기 글자 없음", () => {
  assert.deepEqual(hits(/더보기[^'"`<]{0,12}▾|접기 ▴|펼치기 ▾|외 \$\{[^}]+\}줄 \$\{open/), []);
});
