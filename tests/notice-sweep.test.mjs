// UI-알림창정리 (2026-10-28 명진 요청) · S48-28 (2026-11-02): 브라우저 기본 대화창(alert/confirm/prompt)은 공용 작은 알림·작은 확인창·
// 작은 글 입력창(app/small-notice.js notify/askConfirm/askText)으로 옮겼다. 남은 곳은 아래 예외표뿐이며 개수가 정확히 같아야 한다
// (새로 생기면 실패, 줄이면 예외표도 함께 줄인다).
// 남긴 이유:
//   · 동기 이동 막기 — 뒤로가기(겹 닫기)·새로고침 직전에 '쓰던 내용 버릴까요'를 그 자리에서 예/아니오로 정해야 하는 길.
//     화면 이동(kptu:before-view-change)은 S61-31에서 라우터의 '막고 → 묻고 → 다시 이동' 공용 길(detail.ask)로 옮겼다.
//     겹 닫기(mobile-modal-history)에도 같은 공용 길이 생기면 나머지를 옮긴다. 버튼·Esc로 닫는 길은 이미 작은 확인창이다.
//   · legacy/meeting-detail-patches.js — 어디서도 불러오지 않는 옛 파일(지우기는 범위 밖, 보고만).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const APP = fileURLToPath(new URL('../app/', import.meta.url));
const SKIP = ['hwp-lab/', 'editor-lib/', 'pdf-lib/', 'markdown-lib/'];
const BASELINE = {
  'basket.js': 1,                 // 정리함 상세 겹 뒤로가기 닫기 (동기 이동 막기)
  'basket-notes.js': 1,           // 노트 상세 겹 뒤로가기 닫기 (동기 이동 막기)
  'diary.js': 1,                  // 일기 창 뒤로가기 닫기 (동기 이동 막기)
  'project-system-v3.js': 1,      // confirmDiscard — 새로고침·뒤로가기·창 닫기 (동기 이동 막기)
  'share-pages.js': 1,            // 공유 페이지 편집 겹 뒤로가기 닫기 (동기 이동 막기)
  'workplace-detail.js': 2,       // wdConfirmDiscard — 뒤로가기·새로고침 (동기 이동 막기)
  'legacy/meeting-detail-patches.js': 2, // 불러오는 곳 없는 옛 파일
};
const walk = dir => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
export function countNative(source) {
  const calls = source.match(/(?<![\w.$])(?:window\.|globalThis\.)?(?:alert|confirm|prompt)\(/g) || [];
  const own = source.match(/(?:function|async)\s+(?:alert|confirm|prompt)\(/g) || [];
  return calls.length - own.length;
}

test('브라우저 기본 대화창은 예외표와 정확히 같다', () => {
  const over = [], seen = new Set();
  for (const path of walk(APP)) {
    const rel = relative(APP, path).split('\\').join('/');
    if (!rel.endsWith('.js') || SKIP.some(prefix => rel.startsWith(prefix))) continue;
    const count = countNative(readFileSync(path, 'utf8'));
    if (count) seen.add(rel);
    if (count !== (BASELINE[rel] ?? 0)) over.push(`${rel}: ${count} ≠ ${BASELINE[rel] ?? 0}`);
  }
  for (const rel of Object.keys(BASELINE)) if (!seen.has(rel)) over.push(`${rel}: 0 ≠ ${BASELINE[rel]} (예외표에서 빼기)`);
  assert.deepEqual(over, [], '새 alert/confirm/prompt 대신 app/small-notice.js의 notify/askConfirm/askText를 쓴다');
});

test('세는 규칙: 직접 만든 confirm 함수의 정의 줄은 빼고 센다(그 함수를 부르는 곳은 기준표에 포함)', () => {
  assert.equal(countNative("if(!window.confirm('a'))return;alert('b');"), 2);
  assert.equal(countNative('async function confirm(){} void confirm();'), 1);
  assert.equal(countNative("x.confirm('a');askConfirm(el,{text:'a'})"), 0);
  assert.equal(countNative("window.prompt('a','b');askText(el,{text:'a'})"), 1);
});
