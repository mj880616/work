import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {targets, countFile, jsStrings, htmlStrings} from './ui-words.mjs';
// HOME-주간정리이름주간보고(S62-15, 명진 11/15 "홈화면 주간 정리를 주간 보고 로"): 화면 글자에 '주간 정리'를 쓰지 않는다.
// 주석·코드 이름은 세지 않는다(검사기 tests/ui-words.mjs의 글자 꺼내기를 그대로 쓴다). 업데이트 기록(옛 공개 배포물)은 세지 않는다.
// 남은 자리: 사업 보고 위 주간 칸이 그려지기 전의 자리 표(index.html #bizWeekBox·biz-week-skeleton.mjs) — 그 칸을 고치는 BIZ 작업과 겹쳐
// 이번 PR에서 손대지 않았다(PR 댓글로 보고). 그 작업이 자리 표를 바꾸면 아래 남은 수를 0으로 줄인다.
const LEFT = {'app/index.html': 1, 'app/biz-week-skeleton.mjs': 1};
const WORD = /주간\s?정리/g;
const count = (f, src) => (/\.(html|xml)$/.test(f) ? htmlStrings(src) : jsStrings(src)).reduce((n, {text}) => n + (text.match(WORD) || []).length, 0);

test("화면 글자 '주간 정리' → '주간 보고': 남은 자리가 늘지 않는다", () => {
  const found = {};
  for (const f of targets().filter(f => !f.startsWith('app/release-notes/'))) { const n = count(f, readFileSync(f, 'utf8')); if (n) found[f] = n; }
  const grown = Object.entries(found).filter(([f, n]) => n > (LEFT[f] ?? 0)).map(([f, n]) => `${f}: ${n}`);
  assert.deepEqual(grown, [], "화면 글자는 '주간 보고'(띄어 씀, 메뉴 '사업 보고'·'조직 보고'와 같은 꼴)");
});

test('홈 보기 전환·주간 제목·사업 보고 아래 버튼·한글 파일 안내가 주간 보고', () => {
  const journal = readFileSync('app/journal.js', 'utf8');
  assert.match(journal, /data-journal-mode="week" aria-pressed="false">주간 보고<\/button>/);
  assert.match(journal, /`주간 보고 · \$\{longDay\(list\[0\]\)\}/);
  assert.match(readFileSync('app/weekly-summary-table.js', 'utf8'), /data-bw-journal>주간 보고에서 보기 ›/);
  const hwpx = readFileSync('app/journal-hwpx.js', 'utf8');
  assert.match(hwpx, /\[주간 보고\]의 5\. 주요 일정에서/);
  assert.match(hwpx, /\(\[주간 보고\] 맨 아래 ‘주간보고 기억’/);
  assert.equal(countFile('a.js', "x = '주간 정리';").length, 0, '기존 용어 검사기와는 따로 센다');
});
