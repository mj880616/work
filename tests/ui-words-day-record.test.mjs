import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {targets, jsStrings, htmlStrings} from './ui-words.mjs';
// DIARY-이름하루기록(S62-15, 사용자 11/15 "일기는 좀 부담스러울 거 같아" → "나 하루 기록", 사용자 계정 포함): 화면 글자에 '일기'를 쓰지 않는다.
// '업무일지'는 그대로(다른 낱말). 주석·코드 이름(diary)·파일 이름·DB·서버 AI 지시문은 세지 않는다(검사기 tests/ui-words.mjs의 글자 꺼내기).
// 업데이트 기록(옛 공개 배포물)은 세지 않는다.
const count = (f, src) => (/\.(html|xml)$/.test(f) ? htmlStrings(src) : jsStrings(src)).filter(({text}) => text.includes('일기')).map(({line}) => `${f}:${line}`);

test("화면 글자 '일기' → '하루 기록': 앱·폰 앱 화면 글자에 '일기' 0곳", () => {
  const found = targets().filter(f => !f.startsWith('app/release-notes/')).flatMap(f => count(f, readFileSync(f, 'utf8')));
  assert.deepEqual(found, [], "화면 글자는 '하루 기록'(docs/design/ui-words.md). 문장 안에서는 '하루 기록이·을·으로'처럼 받침에 맞춰 쓴다.");
});

test("일정 탭·메뉴·더하기·잊지 말기 보내기·사진 메뉴가 '하루 기록', '업무일지'는 그대로", () => {
  const html = readFileSync('app/index.html', 'utf8');
  assert.match(html, /data-view="diary" href="\.\/\?view=diary">하루 기록<\/a>/);
  assert.equal((html.match(/data-view="diary" aria-pressed="(?:true|false)">하루 기록<\/button>/g) || []).length, 3, '일정 탭 [달력|할 일|하루 기록] 세 화면');
  const top = readFileSync('app/topbar-actions.js', 'utf8');
  assert.match(top, /\['diary','하루 기록'\]/);
  assert.match(readFileSync('app/basket.js', 'utf8'), /data-basket-to-diary>하루 기록으로 보내기</);
  assert.match(readFileSync('app/photo-menu-items.mjs', 'utf8'), /diary: '하루 기록에 넣기'/);
  assert.match(readFileSync('app/diary.js', 'utf8'), />\+ 하루 기록<\/button>/);
  const work = targets().filter(f => /^app\/.*\.(js|mjs|html)$/.test(f)).some(f => readFileSync(f, 'utf8').includes('업무일지'));
  assert.ok(work, "'업무일지'는 바꾸지 않는다");
});
