import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {jsStrings} from './ui-words.mjs';
// HOME-입력종류업데이트글자잊지말기(S62-15, 사용자 11/15 17:09 "업데이트, 할일 입력창에 업데이트를 잊지말기로 하란 소리야 / 거기로 가는 거잖아"):
// 홈 빠른 입력칸 종류 글자만 '업데이트' → '잊지 말기'. 동작·저장 자리·오른쪽 [잊지 말기 n] 칩·잊지 말기 목록 안 출처 꼬리표·코드 이름은 그대로.
const strings = f => jsStrings(readFileSync(f, 'utf8')).map(s => s.text);

test("홈 빠른 입력칸(폰 [종류 ▾]·펼친 목록·넓은 화면 두 칸·안내) 화면 글자에 '업데이트' 0곳", () => {
  // 남는 한 곳: 파일을 올린 뒤 아래 알림 '업데이트에 사진 n장 올렸어요'(where) — 다른 입력 길(잊지 말기 화면 상세·큰 창 등)과 같은 알림이라 이번 범위 밖.
  assert.deepEqual(strings('app/home-quick.js').filter(t => t.includes('업데이트')), ['업데이트']);
  assert.match(readFileSync('app/home-quick.js', 'utf8'), /const where=basketSave\?'업데이트':/);
  const src = readFileSync('app/home-quick.js', 'utf8');
  assert.match(src, /data-quick-mode="update">잊지 말기</, '넓은 화면 [잊지 말기|할 일]');
  assert.match(src, /const kindName=mode==='task'\?'할 일':'잊지 말기';/, '폰 종류 버튼 [잊지 말기 ▾]');
  assert.match(src, /\{id:'kind-update',label:'잊지 말기'\}/, '펼친 목록 첫 줄');
  assert.match(src, /toBasket\(\)\?'잊지 말기에 남길 것'/, '안내');
  assert.match(src, /data-quick-mode="update"/, '동작(모드 이름)은 그대로');
});

test("같은 곳으로 가는 글자: 큰 쓰기 창 안내·[+ 추가] 목록·폰 앱 공유 창도 '잊지 말기'", () => {
  const win = readFileSync('app/update-window.js', 'utf8');
  assert.match(win, /placeholder:'남길 것을 입력하세요'/);
  assert.match(win, /placeholder:'잊지 말기에 남길 것'/);
  assert.match(readFileSync('app/topbar-actions.js', 'utf8'), /\['update','잊지 말기'\]/);
  const manifest = readFileSync('android-app/app/src/main/AndroidManifest.xml', 'utf8');
  assert.equal((manifest.match(/android:label="WORK ON\+ 잊지 말기로 보내기"/g) || []).length, 2);
  assert.doesNotMatch(manifest, /android:label="노동조합\+ 업데이트로 보내기"/);
});
