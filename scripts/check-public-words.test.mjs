import test from 'node:test';
import assert from 'node:assert/strict';
import {parseList, findWords, addedLines, scanDiff, scanEvent, scanCommits, isAllowedPath, loadAllow} from './check-public-words.mjs';

// 실제 낱말 목록은 비밀값에만 있다. 시험은 지어낸 낱말만 쓴다.
const words = parseList('# 설명 줄\n가상단체\n\nFakeName\n');

test('목록 읽기: 빈 줄·# 줄은 버린다', () => {
  assert.deepEqual(words, ['가상단체', 'FakeName']);
  assert.deepEqual(parseList(''), []);
  assert.deepEqual(parseList(undefined), []);
});

test('낱말 찾기: 위치와 목록 번호만 돌려준다(대소문자 무시)', () => {
  const got = findWords('첫 줄\n가상단체가 왔다 fakename\n끝', words);
  assert.deepEqual(got, [{word: 1, line: 2}, {word: 2, line: 2}]);
  assert.ok(!JSON.stringify(got).includes('가상단체'));
});

const diff = [
  'diff --git a/docs/a.md b/docs/a.md',
  '--- a/docs/a.md',
  '+++ b/docs/a.md',
  '@@ -3,0 +4,2 @@',
  '+괜찮은 줄',
  '+가상단체 결정',
  'diff --git a/old.md b/old.md',
  '--- a/old.md',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-가상단체 지운 줄',
  'diff --git a/allowed/x.ts b/allowed/x.ts',
  '--- a/allowed/x.ts',
  '+++ b/allowed/x.ts',
  '@@ -1 +1 @@',
  '-a',
  '+가상단체',
].join('\n');

test('새로 더한 줄만 본다(지운 줄·지운 파일은 안 봄)', () => {
  const lines = addedLines(diff);
  assert.deepEqual(lines.map(l => [l.path, l.line]), [['docs/a.md', 4], ['docs/a.md', 5], ['allowed/x.ts', 1]]);
});

test('예외 경로는 넘기고 나머지는 위치를 알린다', () => {
  const allow = [{paths: ['allowed/'], reason: '시험'}];
  assert.deepEqual(scanDiff(diff, words, allow), [{path: 'docs/a.md', line: 5, word: 1, file: true}]);
  assert.ok(isAllowedPath('allowed/x.ts', allow));
  assert.ok(!isAllowedPath('allowedx.ts', allow));
});

test('PR 제목·본문도 본다', () => {
  const got = scanEvent({pull_request: {title: 'FakeName 작업', body: '한 줄\n가상단체'}}, words);
  assert.deepEqual(got, [{path: 'PR 제목', line: 1, word: 2}, {path: 'PR 본문', line: 2, word: 1}]);
  assert.deepEqual(scanEvent({}, words), []);
});

test('커밋: 개인 메일 작성자와 메시지 낱말을 잡고 noreply는 통과', () => {
  const mail = ['some', 'one', '@', 'gmail', '.com'].join('');
  const log =
    `aaaaaaaaaaaa\x00${mail}\x00123+x@users.noreply.github.com\x00제목\n\n본문 가상단체\n\x1e\n` +
    `bbbbbbbbbbbb\x00123+x@users.noreply.github.com\x00noreply@github.com\x00괜찮은 제목\n\x1e`;
  const got = scanCommits(log, words);
  assert.deepEqual(got, [
    {path: '커밋 aaaaaaaaa', line: 0, kind: '작성자 메일'},
    {path: '커밋 aaaaaaaaa 메시지', line: 3, word: 1},
  ]);
});

test('예외 목록 파일 모양', () => {
  const allow = loadAllow();
  assert.ok(allow.length > 0);
  for (const e of allow) assert.ok(e.reason.trim());
});
