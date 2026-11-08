import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {scan, compare, countFile, jsStrings} from './ui-words.mjs';
// UI-용어통일(2026-11-08 명진 결정 '수정 삭제로 맞추자', 기준표 docs/design/ui-words.md). 재발 방지 시험(App smoke check).

test('기준표 문서가 있고 화면 규칙 문서들이 가리킨다', () => {
  const doc = readFileSync('docs/design/ui-words.md', 'utf8');
  for (const w of ['**수정**', '**삭제**', '**저장**', '**닫기**', '**취소**', '**추가**', '**넣기**', '**되돌리기**', '**되살리기**', '**최신화**', '**선택**', '**보기**', '**열기**', '**보관**', '**숨기기**']) assert.ok(doc.includes(w), w);
  for (const f of ['AGENTS.md', 'app/ARCHITECTURE.md', 'docs/design-decisions.md']) assert.match(readFileSync(f, 'utf8'), /docs\/design\/ui-words\.md/, f);
});

test('검사기: 주석·코드 이름은 빼고 화면 글자만 센다', () => {
  const src = [
    "// 고치기 지우기는 주석이라 안 센다",
    "const editRow = 1; /* 지워 */",
    "btn.textContent = '고치기';",
    "notify(`${n}개를 지웠어요`);",
    "const re = /지워|고쳐/; const ok = '저장';",
    "el.title = \"이름 바꾸기\"; menu('HWP 편집');",
    "const ask = /^(지워|삭제)/.test(text); // ui-words-ok 사람이 쓴 말 알아보기",
    "x = `a${y ? '버리기' : `더보기`}b`;",
  ].join('\n');
  const hits = countFile('a.js', src).map(h => `${h.line}:${h.word}`);
  assert.deepEqual(hits, ['3:고치기', '4:지웠', '8:버리기', '8:더보기']);
  assert.deepEqual(countFile('a.html', '<!-- 지우기 -->\n<button>편집</button>').map(h => h.word), ['편집']);
  assert.ok(jsStrings("a = 1 / 2; b = '골라 주세요'").some(s => s.text === '골라 주세요'), '나눗셈 뒤 따옴표도 읽는다');
});

test('재발 방지: 고치기·편집·지우기·버리기 등 바꾸기로 한 말이 기준표보다 늘지 않는다', () => {
  const baseline = JSON.parse(readFileSync(new URL('./ui-words-baseline.json', import.meta.url), 'utf8'));
  const {grown, reduced} = compare(scan(), baseline);
  if (reduced.length) console.info('UI-용어통일 남은 곳이 줄었어요. tests/ui-words-baseline.json 숫자도 줄여 주세요:\n' + reduced.join('\n'));
  assert.deepEqual(grown, [], '화면 글자는 docs/design/ui-words.md 기준표를 따르세요: 고치기·편집 → 수정, 지우기·버리기 → 삭제(창이면 취소), '
    + '원래대로 → 되돌리기, 다시 불러오기·새로고침 → 최신화·다시, 더보기 → ⋯, 고르기 → 선택. 사람이 쓴 말을 알아보는 패턴처럼 화면 글자가 아니면 같은 줄에 ui-words-ok.');
});
