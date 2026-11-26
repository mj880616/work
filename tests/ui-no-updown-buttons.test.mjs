// S70-04 UI-순서는끌기로(2026-11-25 사용자 "메모 그냥 pc든 폰이든 드래그 해서 위아래로 하면 되는데 위로 아래로 버튼 이거 불편함. 드래그하는걸로 다 통일해줘 또 이런거 있으면"):
// 화면 코드에 순서를 바꾸는 [위로]·[아래로]·↑·↓ 단추 글자가 남지 않는다. 순서 바꾸기는 끌기(PC 마우스·폰 꾹 눌러 끌기, docs/design/standard-interactions.md D6)와
// 키보드 Alt+↑↓로만 한다. 찾는 글자: 따옴표·꺾쇠 사이에 홀로 있는 '위로' '아래로' '↑' '↓'(주석 줄은 뺀다).
// NOT_ORDER = 순서가 아닌 같은 글자(위 폴더로 가기·기호 넣기 등) — 전수 표의 '해당 없음'. TODO = 아직 끌기로 바꾸지 않은 화면(다음 PR들에서 줄여 마지막 PR에서 비운다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const APP = join(ROOT, 'app');
// 파일 → 그 파일에 남아도 되는 글자 수(순서가 아닌 뜻).
export const NOT_ORDER = {
  'app/library-move-picker.js': 2, // '위로' = 옮길 곳 창에서 위 폴더로 가기(순서 아님)
  'app/od-settings.js': 1, // '위로' = 원드라이브 폴더 고르기에서 위 폴더로 가기(순서 아님)
  'app/ed-editor.js': 2, // '↑' '↓' = 기호 넣기 목록의 화살표 글자(단추 아님)
  'app/files-panes-model.mjs': 2, // '↑' '↓' = 폰 위·아래 두 칸 사이 '↑ 위에 복사' 방향 표시(순서 아님)
};
// 아직 바꾸지 않은 화면(S70-04 다음 PR). 바꾸면 여기서 지운다 — 마지막 PR에서 빈 표.
export const TODO = {
  'app/files.js': 2,
  'app/files-tree-menu.mjs': 2,
  'app/reference-bundles.js': 2,
  'app/meeting-name-panel.js': 2,
  'app/quick-links.js': 2,
  'app/weekly-own-form-edit.js': 2,
  'app/project-system-v3.js': 8,
  'app/photos.js': 4,
};
const SKIP_DIR = /(^|\/)(node_modules|vendor|rhwp-[\d.]+|release-notes)(\/|$)/;
function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name), rel = relative(ROOT, p);
    if (SKIP_DIR.test(rel)) continue;
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(m?js|html)$/.test(name) && !/\.min\.js$/.test(name)) out.push(rel);
  }
  return out;
}
const WORD = /(['"`>])\s*(위로|아래로|↑|↓)\s*(['"`<])/g;
export function hits(text) {
  const found = [];
  text.split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    const code = line.replace(/\s\/\/\s.*$/, '');
    for (const m of code.matchAll(WORD)) {
      found.push({ line: i + 1, word: m[2] });
    }
  });
  return found;
}

test('글자 찾기: 따옴표·꺾쇠 사이 홀로 있는 위로·아래로·↑·↓만 센다', () => {
  assert.equal(hits(`b('위로')`).length, 1);
  assert.equal(hits('<button>↓</button>').length, 1);
  assert.equal(hits(`'맨 위로'`).length, 0);
  assert.equal(hits(`// '위로' 주석`).length, 0);
  assert.equal(hits(`x('위 폴더로')`).length, 0);
});

test('화면 코드에 순서용 [위로][아래로]·↑↓ 단추 글자가 없다(해당 없음·남은 화면 표 밖 0개)', () => {
  const bad = [], counts = {};
  for (const rel of files(APP)) {
    const found = hits(readFileSync(join(ROOT, rel), 'utf8'));
    if (!found.length) continue;
    counts[rel] = found.length;
    const allowed = (NOT_ORDER[rel] || 0) + (TODO[rel] || 0);
    if (found.length > allowed) bad.push(`${rel}: ${found.map(f => `${f.line}행 '${f.word}'`).join(', ')} (허용 ${allowed})`);
  }
  assert.deepEqual(bad, [], '순서 바꾸기는 끌기와 Alt+↑↓로만 — 단추를 지우거나(끌기를 먼저 붙이고) 순서가 아니면 NOT_ORDER에 이유와 함께 더한다');
  // 표가 낡지 않게: 표에 적힌 수보다 적게 남았으면 표를 줄인다(바꾼 화면은 TODO에서 지운다).
  const stale = Object.keys({ ...NOT_ORDER, ...TODO }).filter(rel => (counts[rel] || 0) < (NOT_ORDER[rel] || 0) + (TODO[rel] || 0)).map(rel => `${rel}: 남은 ${counts[rel] || 0}`);
  assert.deepEqual(stale, [], '바꾼 화면은 TODO에서 지운다');
});
