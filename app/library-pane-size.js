// S69-29 LIB-한칸크기끌기(사용자 11/24 "창 밑으로도 드래그 가능하게 · 정확히는 높이를 · 드래그로 늘릴 수 있게" ·
// "한칸보기에서 왼쪽 목록이랑 오른쪽 폴더 또는 자료 보기 사이 드래그가 안되네"): 자료실 한 칸 탐색기(왼쪽 폴더 나무 | 오른쪽 그 폴더 내용) 카드의 크기 두 가지.
// ① 왼쪽 나무 칸 폭: 두 칸 사이 경계(카드 안 세로 선)를 끈다 — 칸 폭 공용 부품 split-resize.js 그대로(같은 손잡이·두 번 누르기 = 기본·←/→).
//    나무 칸은 카드 흐름(float, S69-28)이라 격자 변수 대신 이 파일이 폭(px)을 --lu-fnav-w에 넣는다(split-resize layout).
// ② 카드 높이: 카드 아래 테두리를 끈다 — 공용 부품 height-resize.js. 정하지 않았으면 S69-28 규칙(카드가 내용만큼 늘어남) 그대로.
//    정하면 카드가 그 높이이고 왼쪽 나무·오른쪽 목록은 각 칸 안에서 굴러간다(library-upload.css data-lu-fixed-h).
// 둘 다 사람별 화면 설정으로 서버에 둔다: view_prefs.col_widths.library = {fnav: 나무 폭 px, h2: 카드 높이 ÷ 2}(PC·폴드 펼침 따로 _f). DB 변경 없음, 기기 저장 없음.
// 상태 주인·그리기는 library-upload.js(luRenderFolderNav)가 부른다. 이 파일은 손잡이와 크기만 맡는다.
import { viewPrefs } from './view-prefs.js';
import { mountSplitResize } from './split-resize.js';
import { mountHeightResize } from './height-resize.js';
import { colDevice, colsFor, withCol } from './col-widths-model.mjs';
import { SPLIT_QUERY } from './screen-width.mjs';

export const LIB_SIZE_SCREEN = 'library', NAV_KEY = 'fnav', HEIGHT_KEY = 'h2';
export const NAV_GAP = 12, NAV_MIN = 160, LIST_MIN = 320, CARD_MIN_H = 240;
const device = () => colDevice(globalThis.innerWidth || 0);
const navOf = card => card.querySelector(':scope > #libraryFolderNav');
const listOf = card => card.querySelector(':scope > #documentList');
// 두 칸이 나눠 쓰는 폭: 카드 안쪽 폭(나무 칸은 카드 왼쪽 여백 자리) − 오른쪽 여백 − 두 칸 사이.
function shared(card) {
  const s = getComputedStyle(card);
  return card.clientWidth - (parseFloat(s.paddingRight) || 0) - NAV_GAP;
}
const clampPx = w => Math.min(800, Math.max(40, Math.round(w)));

/** 카드 크기 손잡이 붙이기(다시 불러도 손잡이는 하나). split = 지금 한 칸 탐색기(왼쪽 나무가 있음). */
export function mountLibraryCardSize(card, { split }) {
  if (!card) return;
  const on = () => !!split() && !!navOf(card) && card.isConnected;
  mountSplitResize({
    container: card, name: 'library_one', label: '폴더 나무와 목록 칸 폭 조절', query: SPLIT_QUERY, active: on,
    columns: [
      { el: () => navOf(card), varName: '--lu-fnav-w', minVar: '--lu-fnav-min', minFallback: NAV_MIN, share: 1, id: 'libraryFolderNav' },
      { el: () => listOf(card), varName: '--lu-list-w', minVar: '--lu-list-min', minFallback: LIST_MIN, share: 3 },
    ],
    layout: {
      width: () => shared(card),
      left: () => card.getBoundingClientRect().left + card.clientLeft,
      // 한 칸 탐색기가 아니면(두 칸·폰·다른 묶기) 폭을 두지 않는다 — CSS 기본값(clamp)과 다른 화면 그대로.
      apply: (s, w) => {
        if (!(on() && w > 0)) { card.style.removeProperty('--lu-fnav-w'); return; }
        card.style.setProperty('--lu-fnav-w', `${Math.round(s[0] * w)}px`);
        // 높이를 정한 카드에서 나무 칸은 카드 위·아래 여백 안에 붙는다(library-upload.css data-lu-fixed-h).
        const cs = getComputedStyle(card); card.style.setProperty('--lu-pad-t', cs.paddingTop); card.style.setProperty('--lu-pad-b', cs.paddingBottom);
      },
    },
    store: {
      read: () => { const px = colsFor(viewPrefs.getCols(LIB_SIZE_SCREEN), [NAV_KEY], device())[NAV_KEY], w = shared(card); return px && w > 0 ? Math.min(0.95, px / w) : null; },
      write: r => { const w = shared(card); viewPrefs.setCols(LIB_SIZE_SCREEN, withCol(viewPrefs.getCols(LIB_SIZE_SCREEN), NAV_KEY, device(), r == null || !(w > 0) ? null : clampPx(r * w))); },
    },
  });
  mountHeightResize({ host: card, name: LIB_SIZE_SCREEN, key: HEIGHT_KEY, varName: '--lu-card-h', attr: 'data-lu-fixed-h', min: CARD_MIN_H, active: on, label: '자료실 창 높이 조절' });
}
