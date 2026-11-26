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
  // S68-30(11/23 명진 '고르기 → 선택'): 고르거나·고릅니다·골라도도 센다. '고르게 맞춤'·옛 기록의 '골라져'는 다른 뜻이라 뺀다.
  assert.deepEqual(countFile('b.js', "a = '파일을 고르거나'; b = '종류를 고릅니다'; c = '골라도 돼요'; d = '고르게 맞춤'; e = '골라져 있어요';").map(h => h.word), ['고르', '고릅', '골라']);
  assert.ok(jsStrings("a = 1 / 2; b = '골라 주세요'").some(s => s.text === '골라 주세요'), '나눗셈 뒤 따옴표도 읽는다');
  // S68-34(11/23 명진): 글 저장 단추는 [저장]·[삭제]. 옛 이름(읽을 거리로·읽을 거리에서 빼기·보관 풀기·저장 풀기·저장 취소)은 화면 코드에서 세고, 옛 업데이트 기록에서는 세지 않는다.
  const old = "a = '읽을 거리로'; b = '읽을 거리에서 빼기'; c = '보관 풀기'; d = '저장 풀기'; e = '저장 취소'; f = '저장한 글에서 삭제';";
  assert.deepEqual(countFile('app/x.js', old).map(h => h.word), ['읽을 거리로', '읽을 거리에서 빼기', '보관 풀기', '저장 풀기', '저장 취소']);
  assert.deepEqual(countFile('app/release-notes/20261123-0230-x.json', '{"changes":["읽을 거리로 보내요"]}'), []);
  // S70-62(11/26 명진 "보관은 저장으로 통일"): 글 저장 화면 파일에서는 '보관' 자체를 센다. 다른 화면의 다른 뜻 '보관'(사업영역 보관 등)은 세지 않는다.
  assert.deepEqual(countFile('app/reading.js', "a = '보관한 글'; // 보관 주석").map(h => h.word), ['보관']);
  assert.deepEqual(countFile('app/now-hidden.js', "a = '보관'").map(h => h.word), ['보관']);
  assert.deepEqual(countFile('app/project-system-v3.js', "a = '보관'"), []);
});

test('재발 방지: 고치기·편집·지우기·버리기 등 바꾸기로 한 말이 기준표보다 늘지 않는다', () => {
  const baseline = JSON.parse(readFileSync(new URL('./ui-words-baseline.json', import.meta.url), 'utf8'));
  const {grown, reduced} = compare(scan(), baseline);
  if (reduced.length) console.info('UI-용어통일 남은 곳이 줄었어요. tests/ui-words-baseline.json 숫자도 줄여 주세요:\n' + reduced.join('\n'));
  assert.deepEqual(grown, [], '화면 글자는 docs/design/ui-words.md 기준표를 따르세요: 고치기·편집 → 수정, 지우기·버리기 → 삭제(창이면 취소), '
    + '원래대로 → 되돌리기, 다시 불러오기·새로고침 → 최신화·다시, 더보기 → ⋯, 고르기 → 선택. 사람이 쓴 말을 알아보는 패턴처럼 화면 글자가 아니면 같은 줄에 ui-words-ok.');
});
