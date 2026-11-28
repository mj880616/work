import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {jsStrings} from './ui-words.mjs';
// HOME-입력종류업데이트글자잊지말기(S62-15, 명진 11/15 17:09 "업데이트, 할일 입력창에 업데이트를 잊지말기로 하란 소리야 / 거기로 가는 거잖아"):
// 홈 빠른 입력칸 종류 글자만 '업데이트' → '잊지 말기'. 동작·저장 자리·오른쪽 [잊지 말기 n] 칩·잊지 말기 목록 안 출처 꼬리표·코드 이름은 그대로.
const strings = f => jsStrings(readFileSync(f, 'utf8')).map(s => s.text);

// QUICK-입력정리(2026-11-28 사용자 결정 '홈 막대 통째로 없앰', '잊지 말기는 입력한 자체를 없애'): 홈 빠른 입력칸(종류 버튼·펼친 목록·두 칸)째 지웠다.
test("남은 빠른 입력칸(할 일·노트)에는 '업데이트'·'잊지 말기' 종류 글자가 없다", () => {
  const list = strings('app/home-quick.js');
  assert.deepEqual(list.filter(t => t.includes('업데이트') || t.includes('잊지 말기')), []);
  const src = readFileSync('app/home-quick.js', 'utf8');
  assert.doesNotMatch(src, /data-quick-mode=|kind-update|toBasket|basketOnly/);
});

test("같은 곳으로 가는 글자: 큰 쓰기 창 안내·폰 앱 공유 창도 '잊지 말기', [+ 추가] 목록에는 '잊지 말기' 없음", () => {
  const win = readFileSync('app/update-window.js', 'utf8');
  assert.match(win, /placeholder:'남길 것을 입력하세요'/);
  assert.match(win, /placeholder:'잊지 말기에 남길 것'/);
  assert.doesNotMatch(readFileSync('app/topbar-actions.js', 'utf8'), /\['update','잊지 말기'\]/);
  const manifest = readFileSync('android-app/app/src/main/AndroidManifest.xml', 'utf8');
  assert.equal((manifest.match(/android:label="WORK ON\+ 잊지 말기로 보내기"/g) || []).length, 2);
  assert.doesNotMatch(manifest, /android:label="노동조합\+ 업데이트로 보내기"/);
});
