// S49-9 PHOTO-메뉴항목통일 · UI-업데이트로보내기 · PHOTO-보낸뒤선택풀기(요청함 11/03 17:04·17:06·17:07):
// 사진을 부르는 메뉴의 이름·순서는 공용 목록(app/photo-menu-items.mjs) 하나에서 읽고, 옛 이름('정리함에 넣기'·'업데이트로'·'일기로')은 남지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PHOTO_ACT_TEXT, PHOTO_ACT_SHORT, SEND_ROWS, SEND_NOTE, PHOTO_MENUS, PHOTO_BAR_MENUS, diaryDoneText, basketDoneText, shortDay, releaseAfter} from '../app/photo-menu-items.mjs';
import {shareRows, SHARE_ROW_TEXT, SHARE_NOTE} from '../app/share-menu.js';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('이름은 하나: 업데이트로 보내기 · 일기에 넣기, 좁은 칸 앞부분은 같은 이름의 앞', () => {
  assert.equal(PHOTO_ACT_TEXT.basket, '업데이트로 보내기');
  assert.equal(PHOTO_ACT_TEXT.diary, '일기에 넣기');
  for (const id of Object.keys(PHOTO_ACT_SHORT)) assert.ok(PHOTO_ACT_TEXT[id].startsWith(PHOTO_ACT_SHORT[id]), id);
  assert.deepEqual(SEND_ROWS, ['diary', 'basket']);
  assert.equal(SEND_NOTE.basketDone, '업데이트로 보냈어요');
  // 공유 메뉴 글자는 공용 목록 그대로.
  for (const id of Object.keys(SHARE_ROW_TEXT)) assert.equal(SHARE_ROW_TEXT[id], PHOTO_ACT_TEXT[id], id);
  assert.equal(SHARE_NOTE.basketDone, SEND_NOTE.basketDone);
});

test('공유 메뉴 줄 순서 = 항목 표(viewerShare), 보내기 두 줄 순서는 어느 메뉴든 같다', () => {
  assert.deepEqual(shareRows({native:true, diary:true}), PHOTO_MENUS.viewerShare);
  assert.deepEqual(shareRows({count:2, native:true, diary:true}), PHOTO_MENUS.viewerShare.filter(id => id !== 'copy'));
  assert.deepEqual(shareRows({video:true, native:true, diary:true}), ['download', 'native']);
  for (const menu of Object.values(PHOTO_MENUS)) if (menu.some(id => SEND_ROWS.includes(id))) assert.deepEqual(menu.filter(id => SEND_ROWS.includes(id)), SEND_ROWS);
  for (const menu of Object.values(PHOTO_BAR_MENUS)) for (const items of Object.values(menu)) if (items.some(id => SEND_ROWS.includes(id))) assert.deepEqual(items.filter(id => SEND_ROWS.includes(id)), SEND_ROWS);
});

test('알림 한 줄: 11.3 일기에 넣었어요 / 업데이트로 보냈어요', () => {
  assert.equal(shortDay('2026-11-03'), '11.3');
  assert.equal(diaryDoneText(['2026-11-03']), '11.3 일기에 넣었어요');
  assert.equal(diaryDoneText(['2026-11-02', '2026-11-03']), '11.2 · 11.3 일기에 넣었어요');
  assert.equal(basketDoneText(1), '업데이트로 보냈어요');
  assert.equal(basketDoneText(2), '업데이트로 보냈어요(2장)');
  assert.equal(basketDoneText(2, 3), '업데이트로 보냈어요(2장, 1장은 받지 못함)');
});

test('보낸 뒤 고르기 풀기 규칙: 보내기·옮기기는 성공하면 풀고, 실패·별표·받기는 고른 채', () => {
  for (const act of ['diary', 'basket', 'move', 'album', 'delete']) { assert.equal(releaseAfter(act, true), true, act); assert.equal(releaseAfter(act, false), false, act); }
  for (const act of ['star', 'download', 'share']) assert.equal(releaseAfter(act, true), false, act);
});

test('사진 메뉴들은 공용 목록을 읽고 옛 이름이 남지 않는다(같은 종류 전수)', () => {
  const photos = read('app/photos.js'), menu = read('app/share-menu.js'), strip = read('app/photo-strip.js'), share = read('app/basket-share.js');
  assert.match(photos, /from '\.\/photo-menu-items\.mjs'/);
  assert.match(menu, /from '\.\/photo-menu-items\.mjs'/);
  assert.match(share, /const LABEL = PHOTO_ACT_TEXT\.basket;/);
  for (const [name, src] of [['photos.js', photos], ['share-menu.js', menu], ['basket-share.js', share]]) {
    assert.doesNotMatch(src, /'정리함에 넣기'|'정리함에 넣었어요'|'업데이트로'\)|>일기로<|>업데이트</, name);
  }
  // 크게 보기 [공유]에도 [일기에 넣기]: photos.js가 diary를 주고 photo-strip.js가 공유 메뉴로 넘긴다.
  assert.match(photos, /diary:\(item, trigger\) => sendItemsTo\('diary', \[item\], trigger\)/);
  assert.match(strip, /diary:diary && !item\.video \? \(\) => diary\(item, trigger\) : undefined/);
  // 고른 사진에서 보냈으면 성공 뒤 풀기, 실패면 [다시].
  assert.match(photos, /releaseAfter\(where, true\) && select\.active\) \{ select\.stop\(\); paintSelect\(\); \}/);
  assert.match(photos, /label:SEND_NOTE\.retry/);
  // 폰 공유 창 이름(앱 새 판에 들어감).
  const manifest = read('android-app/app/src/main/AndroidManifest.xml');
  assert.equal((manifest.match(/android:label="웹2 업데이트로 보내기"/g) || []).length, 2);
  assert.doesNotMatch(manifest, /android:label="웹2 정리함"/);
});

// PHOTO-아래줄정돈(S49-34, 요청함 11/04 11:40·명진 결정 12:06 'A안'): 아래 줄은 다섯 칸까지. 나머지 기능은 [공유 ▾]·[편집 ▾]·[더보기] 안 글자 항목.
test('아래 줄은 다섯 칸까지: 고르기 줄·크게 보기 줄 모두, 빠진 기능은 ▾·더보기 안에 다 있다', async () => {
  const {PHOTO_ACT_DEF, photoActButton, photoActButtons} = await import('../app/photo-act-bar.mjs');
  const {PHOTO_BAR_MAX, PHOTO_BAR_MENUS, barItemText} = await import('../app/photo-menu-items.mjs');
  assert.equal(PHOTO_BAR_MAX, 5);
  assert.deepEqual([...PHOTO_MENUS.viewBar], ['star', 'share', 'edit', 'delete', 'more']);
  assert.deepEqual([...PHOTO_MENUS.selectBar], ['star', 'share', 'move', 'delete', 'more']);
  for (const key of ['viewBar', 'selectBar']) {
    assert.ok(PHOTO_MENUS[key].length <= PHOTO_BAR_MAX, `${key} 칸 수`);
    for (const id of PHOTO_MENUS[key]) { assert.ok(PHOTO_ACT_DEF[id], id); assert.ok(PHOTO_ACT_TEXT[id], id); }
  }
  // 예전 아래 줄 기능(받기·일기·업데이트·옮기기·앨범·편집·정보수정·정보·되돌리기·이름)이 모두 메뉴 안에 있다.
  const inView = new Set([...Object.values(PHOTO_BAR_MENUS.viewBar).flat(), ...PHOTO_MENUS.viewBar]);
  const inSelect = new Set([...Object.values(PHOTO_BAR_MENUS.selectBar).flat(), ...PHOTO_MENUS.selectBar]);
  for (const id of ['star', 'delete', 'down', 'diary', 'basket', 'move', 'tag', 'untag', 'restore', 'rename', 'edit', 'info', 'detail']) assert.ok(inView.has(id), `크게 보기에 ${id}`);
  for (const id of ['star', 'delete', 'down', 'diary', 'basket', 'move', 'tag', 'untag', 'restore', 'rename', 'info']) assert.ok(inSelect.has(id), `고르기에 ${id}`);
  // 공유 ▾ 안: 크게 보기 = 사진 복사·일기·업데이트·받기·다른 앱, 고르기 = 복사 빼고 같은 순서.
  assert.deepEqual([...PHOTO_BAR_MENUS.viewBar.share], ['copy', 'diary', 'basket', 'down', 'native']);
  assert.deepEqual([...PHOTO_BAR_MENUS.selectBar.share], ['diary', 'basket', 'down', 'native']);
  assert.deepEqual([...PHOTO_BAR_MENUS.viewBar.edit], ['edit', 'info']);
  assert.equal(barItemText('tag'), '앨범에 넣기');
  assert.equal(barItemText('basket'), '업데이트로 보내기');
  // 그리기 코드는 한 곳, 아이콘은 모두 같은 선 아이콘(글자 모양 ✚ ↥ # ↩ 없음), ▾ 칸은 공유·편집만.
  const html = photoActButtons(PHOTO_MENUS.viewBar, id => `data-x="${id}"`);
  for (const id of PHOTO_MENUS.viewBar) assert.equal((html.match(new RegExp(`data-x="${id}"`, 'g')) || []).length, 1, id);
  assert.doesNotMatch(html, /[✚↥↩#−]/);
  assert.equal((html.match(/<svg/g) || []).length, PHOTO_MENUS.viewBar.length);
  assert.equal((html.match(/kptu-act-caret/g) || []).length, 2);
  assert.match(photoActButton('delete', 'data-x'), /class="kptu-act kptu-act-danger"/);
  const photos = read('app/photos.js'), strip = read('app/photo-strip.js');
  assert.ok(read('app/photo-strip.js').includes("const STRIP_BASIC_BAR = Object.freeze(['star', 'share', 'edit', 'delete', 'detail'])") && PHOTO_ACT_DEF.detail, '일기 기본 줄도 다섯 칸'); // 사진 화면이 아닌 곳의 크게 보기
  assert.match(photos, /photoActButtons\(PHOTO_MENUS\.selectBar/);
  assert.match(strip, /photoActButtons\(barIds, barAttr\)/);
  assert.doesNotMatch(strip, /actInner\(/);
  assert.match(read('docs/design-decisions.md'), /PHOTO-아래줄정돈[^\n]*다섯 칸/);
});

// PHOTO-업데이트반응없음(S49-34): 작은 알림(#kptuNotice)이 크게 보기(z-index 1000) 뒤에 깔려 아래 줄 버튼을 눌러도 아무 반응이 없어 보였다.
test('크게 보기가 열려 있으면 작은 알림·되돌리기 알림·확인창이 크게 보기보다 위에 뜬다', () => {
  const css = read('app/diary.css');
  const viewer = Number(/\.diary-viewer\{[^}]*?z-index:(\d+)/.exec(css)?.[1]);
  const over = Number(/body:has\(\[data-diary-viewer\]\) > :is\(([^)]*)\)\{\s*z-index:(\d+)/.exec(css)?.[2]);
  assert.ok(viewer > 0 && over > viewer, `viewer ${viewer} / over ${over}`);
  for (const sel of ['.kptu-ask', '.kptu-notice', '.kptu-undo-notice', '.toast']) assert.match(css, new RegExp(`body:has\\(\\[data-diary-viewer\\]\\) > :is\\([^)]*${sel.replace('.', '\\.')}`), sel);
  assert.equal(SEND_NOTE.basketOpen, '정리함 보기');
});
