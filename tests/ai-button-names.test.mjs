// S59-22 OPS-빠진일2차 4: AI 버튼 이름(명진 11/11 14:55 "제안대로 전부", docs/design/ai-button-names.md).
// 새 이름이 화면 코드에 있고, 옛 이름이 버튼·눌림 이름·안내 글자로 남지 않았으며, 기준표(ui-words.md)에도 올라갔는지 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(root, rel), 'utf8');

test('새 이름이 그 단추 자리에 있다(회의 보고 창 2곳·파일 이름 칸·사업영역 칸·공유 페이지·주간 초안)', () => {
  assert.match(read('app/meeting-round-detail.js'), /id="mrdMakeTodos"[^>]*>할 일 후보 찾기<\/button>/);
  // S61-5 REC-전사삭제(명진 11/13): 회의자료 녹음 ⋯ [녹음 글로 옮기고 요약하기]는 지금은 없다.
  assert.doesNotMatch(read('app/meeting-round-detail.js'), /data-mrd-transcribe/);
  // S61-24 REC-요약단추삭제(명진 11/13): 회의 입력 창 [녹음 요약하기]도 지금은 없다.
  for (const rel of screenFiles()) assert.doesNotMatch(read(rel), />녹음 요약하기<|'녹음 요약하기'/, rel);
  assert.match(read('app/file-rename.js'), /data-fr-ai>이름 추천 받기<\/button>/);
  assert.match(read('app/business-area-fields.js'), /data-biz-area-ai>사업영역 추천<\/button>/);
  const share = read('app/share-pages.js');
  assert.match(share, /dataset:\{spAiDraft:''\}, text:'글 초안 만들기'/);
  assert.match(share, /'aria-label':'사업영역·링크·글 초안 만들기'/);
  assert.match(read('app/share-ai-draft.js'), /<h2 id="shareAiDraftTitle">공유 페이지 글 초안<\/h2>/);
  assert.match(read('app/journal-hwpx.js'), /button\('초안 다시 쓰기', 'hwpxAiAgain'\)/);
});

// 옛 이름은 주석·옛 업데이트 기록(release-notes)에만 남을 수 있다. 화면 코드의 단추·눌림 이름·안내 글자로는 남지 않는다.
const OLD_NAMES = [
  />AI로 후보 찾기</, />전사해서 결과에 넣기</, />AI 이름</, />AI 추천</, />AI 초안</, />AI 초안 다시 쓰기</,
  /text:\s*'AI 초안'/, /button\('AI 초안 다시 쓰기'/, /'AI 이름이 아직/, /'AI 추천을 받지/, /'오늘 AI 추천 횟수/, /'AI 추천은 준비 중/,
  /'공유 페이지 AI 초안/, /aria-label['"]?\s*[:=]\s*['"][^'"]*AI 초안/,
];

function screenFiles() {
  return readdirSync(join(root, 'app')).filter(n => /\.(js|mjs|html)$/.test(n)).map(n => `app/${n}`);
}

test('옛 이름이 화면 코드의 단추·안내 글자로 남지 않았다(주석 제외)', () => {
  const left = [];
  for (const rel of screenFiles()) {
    read(rel).split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      const code = line.replace(/\s\/\/ .*$/, ''); // 줄 끝 주석
      for (const re of OLD_NAMES) if (re.test(code)) left.push(`${rel}:${i + 1} ${re}`);
    });
  }
  assert.deepEqual(left, []);
});

test('기준표 ui-words.md와 제안 표 ai-button-names.md에 새 이름이 올라갔다', () => {
  const words = read('docs/design/ui-words.md'), names = read('docs/design/ai-button-names.md');
  for (const n of ['이름 추천 받기', '사업영역 추천', '할 일 후보 찾기', '글 초안 만들기', '초안 다시 쓰기']) {
    assert.ok(words.includes(n), `ui-words.md: ${n}`);
    assert.ok(names.includes(n), `ai-button-names.md: ${n}`);
  }
  assert.doesNotMatch(names, /\| 제안 \|\s*$/m, '표의 제안 줄이 모두 정리됐다');
});

test('새 이름은 용어 기준표의 바꿀 말(고치기·고르기 등)을 쓰지 않는다', () => {
  for (const n of ['이름 추천 받기', '사업영역 추천', '할 일 후보 찾기', '글 초안 만들기', '초안 다시 쓰기']) {
    assert.doesNotMatch(n, /고치|고르|지우|버리|편집|원래대로|새로고침|더보기/);
  }
});
