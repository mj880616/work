// UI-자료실파일모양(S69-85 ②, 사용자 11/25 "파일 인터페이스로 자료실도 바꿔" · 'ㅇ' 확정): 자료실 목록을 파일 목록 모양으로.
// 화면 실측은 tests/app-e2e/library-files-look.spec.mjs. 여기서는 순수 부분(위치 줄 끝 [드라이브 ↗])과 모양 규칙 한 곳을 본다. 값은 모두 가짜.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathLinkHtml, driveLineHtml } from '../app/library-drive-line.js';

const read = f => readFileSync(new URL(`../app/${f}`, import.meta.url), 'utf8');
const noComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '');
const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PLACE = { url: 'https://drive.google.com/drive/folders/libraryFolder0001', path: ['가상 앱', '자료실'], pairs: { fa: 'pairFolder000001' } };

test('주소 줄 하나(살릴 것 7): 폴더 안 위치 줄 끝 [드라이브 ↗]은 그 폴더의 짝 드라이브 폴더, 새 창·noopener', () => {
  const h = pathLinkHtml(PLACE, esc, { folderId: 'fa', trail: ['가상 사업'] });
  assert.match(h, /^<a class="lu-drive-open lu-drive-here" href="https:\/\/drive\.google\.com\/drive\/folders\/pairFolder000001" target="_blank" rel="noopener noreferrer"/);
  assert.match(h, />드라이브 ↗<\/a>$/);
  assert.match(h, /aria-label="구글 드라이브에서 가상 앱 › 자료실 › 가상 사업 열기"/);
  // 짝이 없으면 자료실 폴더로, 상태 글은 작게 뒤에.
  assert.match(pathLinkHtml(PLACE, esc, { folderId: 'none', trail: ['x'] }, '드라이브 정리 대기'), /folders\/libraryFolder0001".*<span class="lu-drive-note lu-drive-here" role="status">드라이브 정리 대기<\/span>$/);
  // 저장 위치가 없거나 주소가 드라이브가 아니면 그리지 않는다.
  assert.equal(pathLinkHtml(null, esc, {}), '');
  assert.equal(pathLinkHtml({ ...PLACE, url: 'https://example.org/x' }, esc, {}), '');
  // 맨 위(폴더 밖)는 지금처럼 저장 위치 한 줄.
  assert.match(driveLineHtml(PLACE, esc, {}), /구글 드라이브 · 가상 앱 › 자료실/);
  const line = read('library-drive-line.js');
  assert.match(line, /const html = nav \? '' : driveLineHtml\(place, esc, here, note\);/);
});

test('고르기 표시: 큰 네모 칸 없이 파일과 같은 고른 줄(옅은 강조 바탕 + 왼쪽 세로줄), 네모 칸은 보이지 않게 줄 위에', () => {
  const css = noComments(read('library-upload.css')), files = noComments(read('files.css'));
  // 왼쪽 세로줄은 앱 공용 선택 표시 값(--kptu-shadow-select, 자료실 CSS는 그림자 값을 바로 쓰지 않는 규칙) — 바탕은 [파일]과 같은 옅은 강조색.
  const lu = css.match(/:is\(\.lu-row\.lu-picked,\.lu-node-picked\)\{([^}]*)\}/)[1];
  assert.equal(lu, 'background:var(--kptu-primary-soft);box-shadow:var(--kptu-shadow-select)');
  assert.match(files, /\.fx-row\.fx-picked \{ background:var\(--kptu-primary-soft\);/);
  assert.match(css, /#documentList \.lu-pick:not\(\.photo-pick\)\{position:absolute;inset:0;[^}]*opacity:0;/);
  assert.doesNotMatch(css, /\.lu-row\.lu-row-picking\{[^}]*padding-left:28px/, '네모 칸 자리 여백 없음');
  assert.match(css, /\.lu-folder-picked\{background:var\(--kptu-primary-soft\);box-shadow:var\(--kptu-shadow-select\)\}/);
  const js = read('library-upload.js');
  assert.match(js, /c\.closest\('\.lu-row'\)\?\.classList\.toggle\('lu-picked',c\.checked\)/);
  assert.match(js, /c\.parentElement\?\.classList\.toggle\('lu-node-picked',c\.checked\)/);
  // '— 접힌 n개 포함'은 개수 옆 작은 흐린 글씨(글은 그대로).
  assert.match(js, /<small class=\\?"kptu-sb-note\\?"> — \$\{luEsc\(rest\.join\(' — '\)\)\}<\/small>/);
});
