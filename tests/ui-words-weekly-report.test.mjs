import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {targets, countFile, jsStrings, htmlStrings} from './ui-words.mjs';
// HOME-주간정리이름주간보고(S62-15, 사용자 11/15 "홈화면 주간 정리를 주간 보고 로"): 화면 글자에 '주간 정리'를 쓰지 않는다.
// 주석·코드 이름은 세지 않는다(검사기 tests/ui-words.mjs의 글자 꺼내기를 그대로 쓴다). 업데이트 기록(옛 공개 배포물)은 세지 않는다.
// 남은 자리 없음: 자리 표 글자(biz-week-skeleton.mjs)도 S62-21에서 '주간 보고에서 보기 ›'로 맞췄다.
// S67-63(2026-11-20 22:38 사용자 결정, docs/design/allinone-diary-plan.md): WORK ON 기본 얼굴(girok)에서는 다시 '주간 정리'.
// 그 글자는 얼굴 단어표(app/brand/girok-words.mjs) 한 곳에만 있고, 화면 코드는 '주간 보고'를 word()에 넣는다(사용자 화면은 그대로 '주간 보고').
const LEFT = {};
const FACE_TABLE = 'app/brand/girok-words.mjs';
const WORD = /주간\s?정리/g;
const strings = (f, src) => (/\.(html|xml)$/.test(f) ? htmlStrings(src) : jsStrings(src));
const count = (f, src, word = WORD) => strings(f, src).reduce((n, {text}) => n + (text.match(word) || []).length, 0);
// HOME-주간보고띄어쓰기(S62-21, 사용자 11/15 20:17 "화면 글은 모두 띄어 쓰기 '주간 보고'로 통일"): 붙여 쓴 '주간보고'도 화면 글자에 0곳.
// 그대로 두는 것(바꾸면 연결이 끊기거나 밖에 내는 문서): 한글 파일 이름 '주간보고_날짜'(뒤에 _가 붙은 꼴), 자료실 분류 이름
// '주간보고›팀 확정본' 등(document-categories.js — 저장된 분류 이름과 글자로 맞춘다), 한글 양식 안 글(app 밖 양식 파일).
const JOINED = /주간보고(?!_)/g;
const JOINED_KEEP = new Set(['app/document-categories.js']);

test("화면 글자 '주간 정리' → '주간 보고': 남은 자리가 늘지 않는다", () => {
  const found = {};
  for (const f of targets().filter(f => !f.startsWith('app/release-notes/') && f !== FACE_TABLE)) { const n = count(f, readFileSync(f, 'utf8')); if (n) found[f] = n; }
  const grown = Object.entries(found).filter(([f, n]) => n > (LEFT[f] ?? 0)).map(([f, n]) => `${f}: ${n}`);
  assert.deepEqual(grown, [], "화면 글자는 '주간 보고'(띄어 씀, 메뉴 '사업 보고'·'조직 보고'와 같은 꼴)");
});

test('홈 보기 전환·주간 제목·사업 보고 아래 버튼·한글 파일 안내가 주간 보고', () => {
  const journal = readFileSync('app/journal.js', 'utf8');
  assert.match(journal, /data-journal-mode="week" aria-pressed="false">\$\{word\('주간 보고'\)\}<\/button>/);
  assert.match(journal, /`\$\{word\('주간 보고'\)\} · \$\{longDay\(list\[0\]\)\}/);
  assert.match(readFileSync('app/weekly-summary-table.js', 'utf8'), /data-bw-journal>주간 보고에서 보기 ›/);
  const hwpx = readFileSync('app/journal-hwpx.js', 'utf8');
  assert.match(hwpx, /\[주간 보고\]의 \$\{titles\(\)\.calendar\}에서/); // ⑤-3b: 절 이름은 '내 양식' 제목
  assert.match(hwpx, /\(\[주간 보고\] 맨 아래 ‘주간 보고 기억’/);
  assert.equal(countFile('a.js', "x = '주간 정리';").length, 0, '기존 용어 검사기와는 따로 센다');
});

test("화면 글자에 붙여 쓴 '주간보고'가 0곳(한글 파일 이름·자료실 분류 이름은 그대로)", () => {
  const found = [];
  for (const f of targets().filter(f => !f.startsWith('app/release-notes/') && !JOINED_KEEP.has(f))) {
    const n = count(f, readFileSync(f, 'utf8'), JOINED); if (n) found.push(`${f}: ${n}`);
  }
  assert.deepEqual(found, [], "화면 글자는 띄어 쓴 '주간 보고'");
  assert.equal(count('a.js', "x = '이번 주 주간보고';", JOINED), 1, '붙여 쓴 화면 글을 찾는다');
  assert.equal(count('a.js', "// 주간보고 주석\nconst name = `주간보고_${day}.hwpx`;", JOINED), 0, '주석·한글 파일 이름은 세지 않는다');
  assert.match(readFileSync('app/weekly-hwpx/draft.mjs', 'utf8'), /주간보고_/, '한글 파일 이름은 그대로');
  assert.match(readFileSync('app/document-categories.js', 'utf8'), /'주간보고›팀 확정본'/, '자료실 분류 이름은 그대로');
});

test('주간 보고 띄어 쓴 대표 자리: 사업 보고 위 칸 제목·담당조직 기록·자리 표', () => {
  assert.match(readFileSync('app/weekly-summary-table.js', 'utf8'), /`이번 주 \$\{word\('주간 보고'\)\}`:`\$\{weekLabel\(from\)\} \$\{word\('주간 보고'\)\}`/);
  assert.match(readFileSync('app/index.html', 'utf8'), /aria-label="이번 주 주간 보고"/);
<<<<<<< HEAD
  assert.match(readFileSync('app/report-settings.js', 'utf8'), /<h3>\$\{REPORT_CALENDAR_TITLE\}<\/h3>/);
  assert.match(readFileSync('app/profile-words.mjs', 'utf8'), /WEEKLY_WORD = word\('주간 보고', 'weekly'\)/, '프로필 캘린더 칸: 노동조합+·사용자는 주간 보고');
=======
>>>>>>> origin/main
  assert.match(readFileSync('app/workplace-report.js', 'utf8'), /<h4>주간 보고 기록<\/h4>/);
  assert.match(readFileSync('app/biz-week-skeleton.mjs', 'utf8'), />주간 보고에서 보기 ›<\/span>/);
});

test("S67-63: WORK ON 기본 얼굴은 '주간 정리', 노동조합+ 얼굴(사용자)은 '주간 보고' 그대로", async () => {
  const {FACES, wordIn} = await import('../app/brand/faces.mjs');
  for (const text of ['주간 보고', '이번 주 주간 보고', '[하루 | 주간 보고]로 오늘 하루와 이번 주를 바꿔 봐요.']) {
    assert.equal(wordIn(FACES.nojo, text), text);
    assert.equal(wordIn(FACES.girok, text), text.replace('주간 보고', '주간 정리'));
  }
});
