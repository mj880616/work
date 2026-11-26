import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {targets, jsStrings, htmlStrings} from './ui-words.mjs';
// S71-78 UPD-확인할것(2026-11-27 사용자 "폰에서 볼 것 pc에서 / 이상하지 않아?"): 업데이트 기록 checks 칸 이름표는 '확인할 것'.
// 데이터(json의 checks 키)와 옛 업데이트 기록(app/release-notes/)은 그대로. 주석·코드 이름은 세지 않는다(tests/ui-words.mjs의 글자 꺼내기).
const count = (f, src, word) => (/\.(html|xml)$/.test(f) ? htmlStrings(src) : jsStrings(src)).filter(({text}) => text.includes(word)).map(({line}) => `${f}:${line}`);

test("화면 글자 '폰에서 볼 것' → '확인할 것': 앱·폰 앱 화면 글자에 '폰에서 볼 것' 0곳", () => {
  const found = targets().filter(f => !f.startsWith('app/release-notes/')).flatMap(f => count(f, readFileSync(f, 'utf8'), '폰에서 볼 것'));
  assert.deepEqual(found, [], "업데이트 기록 checks 칸 이름표는 '확인할 것'(docs/design/ui-words.md)");
});

test("업데이트 기록 줄 이름표·보내기 창 선택 칸이 '확인할 것'", () => {
  const ui = readFileSync('app/release-notes-ui.js', 'utf8');
  assert.match(ui, /el\('span','rn-check-label','확인할 것'\)/);
  assert.match(ui, /"'확인할 것' 줄도 같이 보내기"/);
});
