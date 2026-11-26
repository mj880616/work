// NOTE-보기3가지 → S68-38(명진 11/23 08:12·08:23, Obsidian Canvas 참고): 노트 [보드] 보기(옛 이름 포스트잇) — 생각 지도.
// 이 모듈은 보드 칸 하나만 그린다(한 화면 영역 = 한 그리는 곳). 노트 목록·저장·메뉴는 basket-notes.js, 보드 고르기는 note-boards.js가 맡는다.
// - 판: 끝없이 넓은 캔버스처럼 한 손가락(마우스) 빈 곳 끌기 = 판 이동, 두 손가락 벌리기·오므리기·Ctrl+휠 = 확대·축소(손가락 가운데 기준),
//   휠 = 판 이동, [－][＋]·[전체](모든 카드가 보이게). 보기 자리·배율은 이번 접속 화면 메모리만(보드마다 따로, 저장 값 아님). 기기 저장 없음.
// - 카드: 제목 한 줄만 보이는 작은 칸(note-board-model.mjs CARD_W×CARD_H, 폴더 색). 누름 = 노트 열기(basket-notes.js 노트 줄과 같은 data-note-row 단추).
//   끌기(폰은 바로 끌기·꾹 누른 뒤 끌기 둘 다) = 자리 옮기기 → onMove(id, next, before)(저장은 부르는 쪽). 꾹 누름·끌기·키보드 초점 = 고르기:
//   고른 카드(PC는 마우스를 올린 카드도)에만 작은 ×(보드에서 빼기, 이름 붙은 보드)·⋯(노트 메뉴)와 네 변의 손잡이가 보인다.
//   PC 우클릭은 그 카드를 고른 뒤 공용 context-menu.js가 ⋯를 누른다.
// - 연결선: 손잡이(상·하·좌·우)를 끌어 다른 카드에 놓으면 화살표(놓은 곳에 가까운 변). 기본 곡선·실선·끝에 화살촉. 선을 누르면 작은 메뉴
//   [실선|점선] [직선으로] [→|↔|없음] [뒤집기] [글자] [삭제]. 카드를 옮기면 선이 따라온다. 선 계산은 note-board-links-model.mjs,
//   저장은 부르는 쪽(onLinkAdd·onLinkChange·onLinkRemove → note-board-links-data.js, 서버 표 app_note_board_links).
//   S68-38c(명진 11/23 08:32): 새 선은 직선. 선 위 아무 곳을 누른 채 끌면 그 점을 지나는 곡선(끄는 동안 바로 보임, 판 이동보다 먼저),
//   거의 일직선으로 되돌리면 직선. 짧게 누르면 선 메뉴(끌기/누르기는 움직인 거리로 구분). 지나는 점은 두 끝점 기준 상대 위치로 저장(카드를 옮겨도 따라옴).
// - 생각 지도 상자(S69-82, 명진 11/24 23:51 "전체를 브레인 스토밍 마인드맵 하게", 설계 docs/design/note-board-mindmap.md — 옛 S68-38c 글 상자를 바꿈):
//   그 보드에만 있는 짧은 글(노트가 아님, 서버 표 app_note_board_texts). [+ 주제]·빈 곳 두 번 누르기(PC 더블클릭) = 혼자 선 상자(뿌리).
//   상자 누름 = 고르기, 고른 상자를 다시 누름·두 번 누름·F2·Space = 그 자리 글 고치기(가로 글, 글 길이만큼 폭, 최대 폭에서만 줄바꿈).
//   고른 채 Tab = 하위 가지, Enter = 형제 가지(뿌리는 하위), Delete = 지우기(되돌리기가 있으니 묻지 않음, K1), 화살표 = 옆 상자로.
//   글 고치는 중 Enter = 저장, Shift+Enter = 줄바꿈, Tab = 저장하고 하위 가지, Esc = 취소. 폰은 고른 상자 위 작은 막대의 [+ 하위]·[+ 형제].
//   가지 자리는 늘 자동 배치(note-board-mindmap-model.mjs layoutMindmap — 겹치지 않는 나무, 뿌리 가지는 왼·오른 양쪽), 가지 선은 자동.
//   끌기 = 그 가지째 옮기기: 다른 상자 가운데에 놓으면 그 아래 가지로, 위·아래 끝에 놓으면 그 앞·뒤 형제로, 빈 곳에 놓으면 떼어 혼자 선 상자로
//   (뿌리는 나무째 옮김). 가지가 있는 상자의 동그라미(−/개수) = 접기·펼치기.
//   고른 상자 위 작은 막대: [색](노트 색 8가지·기본) [모양] [가−][가+] [+ 하위] [+ 형제] [삭제].
//   네 변 손잡이로 노트 카드·상자 아무것이나 잇는다(놓을 곳 강조·가까이 놓아도 붙음, 빈 곳에 놓으면 그 자리 새 상자 + 선).
//   저장은 부르는 쪽(onTextAdd·onTextChange·onTextsChange·onTextRemove → note-board-links-data.js). 생각 지도 칸 적용 전(mapReady 거짓)에는
//   혼자 선 상자만(가지·꾸미기는 '준비 중' 알림).
// S69-88(명진 11/25 02:46~02:48 "입력창 자체를 자유자재로 크기 조절 … 높이 폭 모두", "이동도 자유롭고 파워포인트처럼",
//   "노트를 붙였는데 노트 내용, 링크는 유지하더라도 텍스트는 다르게"): 파워포인트 글 상자처럼.
// - 고른 상자·카드에 크기 손잡이 8개(네 모서리 = 폭·높이 함께, 네 변 가운데 = 그 방향만, 왼쪽·위쪽은 반대편 고정 — note-board-frame-model.mjs).
//   끄는 동안 바로 따라오고 놓으면 저장(상자: w·h, 카드: 보드 안 카드 자리 metadata.boards[보드].w·h). 글 쓰는 중에도 손잡이가 된다.
//   잇기 손잡이(동그라미)는 변 바깥으로 더 떨어뜨려, 변 위의 크기 손잡이(작은 네모)와 누르는 범위가 겹치지 않는다.
// - 자유 이동: 가지 상자도 빈 곳에 끌어 놓으면 그 자리에 선다(pinned — 자동 배치가 덮어쓰지 않음, 가지 선은 따라감). 다른 상자 위에 놓으면 지금처럼 그 아래 가지.
//   막대 [더 보기] 줄의 [자동 배치로]·[크기 자동]·[가지 떼기]로 되돌린다. 끄는 동안 다른 칸 가장자리·가운데와 맞으면 가는 맞춤선(살짝 붙음).
//   화살표 = 1px, Shift+화살표 = 10px(PC, 상자·카드). 상자에서 옆 상자로 가기는 Alt+화살표. 사각형으로 상자·카드를 함께 고르면 함께 옮긴다.
// - 카드 글자: 보드에 보일 글자(별명, 카드 자리 정보의 label)가 있으면 그 글자, 없으면 노트 제목. 누르면 그 노트가 그대로 열린다.
// - 화면 밖 카드·선·상자·가지 선은 그리지 않는다(S71-52: 보이는 영역이 그린 영역 밖으로 나갈 때만 다시 고름) — 주제·선 수천 개도 가볍게.
// - S71-52 판은 끝이 없다: 모든 자리는 ±1,000,000(note-board-coord.mjs, 음수 포함).
// - PC 왼쪽 노트 목록에서 끌어 온 노트(드래그 자료 형식 NOTE_DRAG)를 판에 놓으면 onDrop(id, 판 좌표, places).
// S69-33(명진 11/24 "보드에서 드래그 해서 노트 선택 가능하게" · "+ - 누르면 현재 몇 %" · "보드 전체 화면 보기"):
// - 여러 장 고르기: PC 마우스로 빈 곳을 끌면 사각형(공용 marquee-select.js) — 닿은 카드를 고른다(Ctrl·Shift와 함께면 더하기).
//   Shift·Ctrl(맥 ⌘)+클릭 = 한 장 더하기·빼기. 폰은 카드를 꾹 눌러 하나 고른 뒤 다른 카드를 꾹 누르면 함께 고르기, 그 뒤 짧게 누르기 = 더하기·빼기.
//   고른 카드는 테두리 강조, 하나를 끌면 함께 옮기고, Delete·위 [보드에서 빼기](이름 붙은 보드)로 함께 빼며, Esc·빈 곳 누르기·[✕]로 푼다.
//   고른 상태는 이 판 화면 메모리 하나(multi)만(저장 없음).
// - 판 이동: PC 마우스는 빈 곳 끌기가 고르기가 되었으므로 Space를 누른 채 끌기·가운데 단추 끌기·휠(그대로)로 옮긴다. 손가락은 한 손가락 끌기 그대로.
// - 확대 비율: 도구 줄 [－] [100% ▾] [＋] — 가운데 글자는 지금 배율(정수 %, 늘 갱신), 누르면 80~120% 목록(공용 zoom-pct.js).
//   [맞추기](옛 이름 [전체]) = 카드가 모두 보이게, 단 FIT_MIN보다 작게는 줄이지 않는다(note-board-model.mjs fitView).
// - 전체 화면: 도구 줄 끝 [전체 화면] = 보드 칸(부르는 쪽이 준 fullHost)만 창 가득(앱 메뉴·머리 줄·보기 탭·보드 칸 줄은 덮임). PC는 브라우저 전체 화면도 함께(되는 곳만).
//   [전체 화면 끝내기]·Esc·뒤로가기로 원래대로. 왼쪽 노트 목록이 있는 보드는 [노트 목록]으로 옆에 펼친다. 상태는 저장하지 않는다.
// S69-91 ①(명진 11/25 03:01 "파워포인트 처럼 도형 삽입 선 삽입 등 꾸밈 입력 자유롭게", 03:03 "배경 없는 텍스트도 추가 … 선 위에 놓기 등 자유롭게"):
// - 도구 줄 [글자](배경·테두리 없는 글) · [도형▾](사각형·둥근 사각형·타원·마름모·삼각형·화살표) · [선▾](직선·화살표 선·꺾은선·곡선).
//   글자·도형은 상자와 같은 부품(고르기·손잡이 8개 크기·자유 이동·맞춤선)을 쓰되 늘 혼자 선 칸(가지 자동 배치·옮겨 붙이기에 끼지 않음).
//   끌 때 맞춤선에만 살짝 붙고(Alt를 누른 채 끌면 붙지 않음) 선·도형에 밀려나지 않는다. 글자는 선·도형 위 어디에나 겹쳐 놓는다(겹침 순서 = 막대 […]의 [앞으로]·[뒤로]).
// - 넣은 선은 양 끝이 판 위 점이다. 선을 누르면(메뉴와 함께) 양 끝 동그라미가 보이고, 끌어 옮긴다. 끝을 상자·도형·카드에 놓으면 지금 잇기처럼
//   그 끝에 붙어 따라다닌다(같은 연결선 표, 끝이 노트·글 상자·점 중 하나). 양 끝이 점인 선은 몸통을 끌면 통째로 옮긴다(그 밖의 선은 지금처럼 곡선).
// - 꾸미기: 고른 칸 막대 [채우기]·[테두리](색·없음·두께·점선)·[글자](굵게·정렬·색)·[모양]·[…](앞으로·뒤로·복제·투명도). 선 메뉴는 모양(직선·꺾은선·곡선)·색·두께.
//   색은 테마 변수 색판 번호(note-board-decor-model.mjs PALETTE)로만 저장한다. 꾸미기 칸 적용 전(decorReady 거짓)에는 글자·도형·새 꾸미기 단추를 숨긴다.
// S71-53 NOTE-관계선(사용자 결정 2026-11-26 19:58 "서로의 관계성을 잇고", 21:10~21:11 "관계망 형성이 되어야해"): 가지와 다른 '관계선'(연결선 표의 kind 'relation').
// - 만들기: PC는 칸 연결점 동그라미를 Alt를 누른 채 끌어 다른 칸에 놓기, 또는 칸 메뉴(우클릭·⋯) [관계 잇기] → 다른 칸 누르기(멀면 [찾기]로 글자 찾아 고르기).
//   폰은 칸 ⋯(카드)·막대 [더 보기](상자·글자·도형) [관계 잇기] → 다른 칸 누르기. 이을 칸을 고르는 동안 판 위 한 줄 '… 이을 칸을 누르세요 · [찾기] · ✕'(Esc·뒤로가기 = 그만).
//   글자·도형·상자·노트 카드·사진 카드·파일 카드 어느 것끼리나(가지 나무에 끼지 않음). 기본 모양 = 점선·부드러운 곡선·방향 없음(작은 화살표는 선 메뉴 [한쪽]·[양쪽]).
// - 이름: 관계선을 두 번 누르기 = 이름 고르기(자주 쓴 이름 목록 + [직접 쓰기] + [이름 삭제]), 선 메뉴 [이름 붙이기]도 같다. 이름은 선 가운데 글자(label).
// - 따라가기: 관계선 한쪽 끝 근처를 누르면(반대쪽 끝이 화면 밖일 때) 그 상대 칸으로 화면을 옮기고 잠깐 강조. 선 메뉴 [… 로 가기]·칸 메뉴 [관계 n개] 목록도 같다.
// - 멀리 보기(배율 0.5 미만, data-nb-small): 관계선은 흐리게, 고른 칸에 붙은 관계선만 진하게(nb-rel-on).
// - 접힌 가지 안 칸에 붙은 관계선은 접힌 칸 끝으로 모여 보인다(gatherEnd). 칸을 지우면 그 관계선도 함께 지워지고 [되돌리기]로 함께 돌아온다(지우기 길 그대로).
// - 관계선 칸이 없는 서버(적용 전, relationReady 거짓): [관계 잇기]를 보이지 않고 Alt 끌기는 '준비 중' 한 줄(일반 선으로 저장하지 않음).
// S71-56 NOTE-보드 표·파일 칸(사용자 결정 2026-11-26 21:11 "첨부한 파일 도 다 뻗을 수 있었으면", "표도 넣을 수 있고 모든 것에서"): 칸 종류 둘(note-board-cell-model.mjs).
// - 표: 도구 줄 [도형▾] 줄의 [표] = 3×3 빈 표. 다른 칸처럼 고르기·끌기·크기 손잡이·가지·관계선·접기·찾기·내보내기에 들어간다.
//   고른 표를 다시 누름(두 번 누름)·F2·Space = 누른 칸(없으면 첫 칸) 글쓰기. 글 쓰는 동안 Tab = 다음 칸(마지막 칸이면 줄 더하기), Shift+Tab = 앞 칸,
//   Enter = 저장하고 끝, Shift+Enter = 칸 안 줄바꿈, Esc = 고친 것 버리고 끝, 다른 칸 누르기 = 그 칸으로. 표를 고른 채(글 쓰기 전) Tab = 하위 가지(다른 칸과 같음).
//   막대 [표 ⋯](우클릭 메뉴도) = 줄 더하기·줄 빼기·칸 더하기·칸 빼기(마지막으로 누른 칸 자리, 없으면 끝). 칸 글은 그릴 때 늘 글자로만(escape).
// - 파일: [도형▾] 줄의 [파일] = 자료실 자료·노트 첨부 고르기 창(onFilePick, 부르는 쪽) → 고른 것마다 파일 칸(종류 아이콘·이름·종류·크기 한 줄).
//   PC는 자료실 줄을 판 빈 곳에 끌어 놓아도 파일 칸(주제 위에 놓으면 지금처럼 재료). 고른 파일 칸을 다시 누름·두 번 누름·F2·Space·막대 [열기] = 보드 위
//   옆 칸(폰은 아래 판)에서 미리보기(onFileOpen — 부르는 쪽의 재료 보기 칸 재사용). 파일 원본은 드라이브 그대로, 칸은 가리키는 번호만.
// - 표·파일 칸이 없는 서버(적용 전, cellsReady 거짓): [표]·[파일]은 '준비 중' 한 줄(canCells), 끌어 놓은 자료실 줄은 지금처럼 받지 않는다.
import { multiTouchActive, onMultiTouch } from './photo-grid-size.js';
import { LONG_MS, SLOP } from './reorder-drag.js';
import { askText, askConfirm, notify } from './small-notice.js';
import { confirmDelete } from './select-keys.js'; // K1 지우기 한 규칙(I-6)
import { openRowMenu, appMenuPoint, ROW_MENU_ICON } from './row-menu.js';
import { swatchHtml, setSwatchOn } from './color-swatch.mjs';
import { iconSvg } from './tree-icons.js';
import { chipsOf, shorten, dropMaterial, KIND_NAMES as MATERIAL_KIND_NAMES, NOTE_REF_DRAG, DOC_REF_DRAG } from './note-board-material-model.mjs'; // S71-54 주제 재료 칩
import { slotLoading, slotImg, slotFailed } from './img-slot.js';
import { unionBounds } from './note-board-export-model.mjs';
import { clampCoord } from './note-board-coord.mjs';
import { miniLayout, fromMini, toMini, farOf, FAR_DEPTH, FIND_SHOW, focusIds, ancestorsOf } from './note-board-view-model.mjs';
import { bottomInset, keepInside } from './anchored-popup.js';
import { layoutBoard, topZ, movedTo, stepZoom, zoomAt, toBoard, fitView, visibleArea, rectsMeet, cardRect, folderTone, clampZoom, centerOn, FIT_MIN, CARD_W, CARD_H } from './note-board-model.mjs';
import { bindMarquee } from './marquee-select.js';
import { bindZoomPct } from './zoom-pct.js';
import { linkGeometry, dragPath, linkBox, nearestSide, rectOf, flipPatch, validateLabel, hasLink, endId, endFields, bendOf, bendPatch, isBent, isStraight, validateText,
  LABEL_MAX, LINK_LIMIT, TEXT_MAX, TEXT_LIMIT, SIDES, ENDS_NAMES } from './note-board-links-model.mjs';
import { depthOf, buildTree, descendants, childrenOf, canAttach, layoutMindmap, branchPath, branchTone, dropTarget, nearestRect, ordAt, neighbor, lighterSide, stepFont,
  NODE_COLORS, NODE_SHAPES, SHAPE_NAMES, FONT_DEFAULT, ROOT_FONT, FONT_MIN, FONT_MAX, cardNode, CARD_KIND } from './note-board-mindmap-model.mjs';
import { bandOf, reachOf, inside, distTo, pickHover, HOVER_LEAVE_MS } from './hover-band.mjs';
import { pastedText, pastePlace, nextPastePlace } from './note-board-paste-model.mjs';
import { HANDLES, HANDLE_NAMES, FRAME_LIMITS, SNAP_PX, resizeRect, snapMove, arrowStep, sizePatch } from './note-board-frame-model.mjs';
import { cardLabel, placeFields } from './note-board-model.mjs';
import { isPointEnd, pointRect, endPatch, SHAPE_NAMES as LINE_SHAPE_NAMES } from './note-board-links-model.mjs';
import { isRelation, relationSpec, linkedEither, relationNames, relationsOf, gatherEnd, findCells, followSide, DIR_MARK, RELATION_ENDS, RELATION_ENDS_NAMES } from './note-board-relation-model.mjs';
import { isCellKind, tableText, tableTitle, tableSize, setCell, stepCell, addRow, removeRow, addCol, removeCol, fitsBytes, cleanCell, tableSpec, fileSpec, fileType, FILE_TYPE_NAMES, sizeText,
  CELL_MAX, ROWS_MAX, COLS_MAX, TABLE_W, FILE_W } from './note-board-cell-model.mjs'; // S71-56 표·파일 칸
import { isFree, SHAPE_KINDS, SHAPE_KIND_NAMES, PALETTE, NONE, STROKE_WIDTHS, ALPHAS, ALIGNS, ALIGN_NAMES, LINE_KINDS, LINE_KIND_NAMES,
  colorVar, lineVar, decorStyle, shapeSvgPoints, zFront, zBack, zIndexes, duplicateSpec, newShapeSpec, newLineSpec } from './note-board-decor-model.mjs';

// 잠긴 폴더 노트 카드(S69 보드잠금가림): 제목·내용 대신 자물쇠 모양만(글자는 화면 읽기용 '잠김').
const LOCK_ICON = `<span class="nb-lock-ico" aria-hidden="true">${iconSvg('lock', {size: 16})}</span>`;
const EDGE = 36, EDGE_STEP = 14, DRAFT = '__draft', DETACH_MIN = 36;
// 크기 손잡이 8개(보이는 점은 작은 네모, 누르는 범위는 손가락 크기 — basket.css .nb-rz). 고른 상자·카드에만 보인다.
const resizeHtml = () => HANDLES.map(k => `<span class="nb-rz nb-rz-${k}" data-nb-resize="${k}" aria-hidden="true" title="크기 (${HANDLE_NAMES[k]})"></span>`).join('');
export const NOTE_DRAG = 'application/x-kptu-note';
// S71-54: 노트·자료를 주제 위에 놓아 재료로 잇는 끌기 종류(note-board-material-model.mjs 한 곳 — 자료실도 같은 값).
export { NOTE_REF_DRAG, DOC_REF_DRAG };
const MAT_ICON = {note:'doc', doc:'clip', link:'link'};
let uid = 0;

// moreIcon: 노트 줄과 같은 ⋯ 그림(basket-notes.js의 것을 받아 같은 메뉴 단추 모양을 쓴다).
export const BOARD_ZOOMS = Object.freeze([80, 90, 100, 110, 120]);
const IMAGE_ICON = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false"><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="5.5" cy="6.2" r="1.2" fill="currentColor"/><path d="M2.5 12l3.6-3.4 2.4 2.2 2.2-2 3 3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>'; // S70-32 ② [이미지]
const FULL_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const FULL_OFF_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M6 2.5V6H2.5M13.5 6H10V2.5M10 13.5V10h3.5M2.5 10H6v3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
// 선택한 상자 위 작은 막대(S69-82). [색]·[모양]은 누르면 아래 한 줄이 펼쳐진다. data-nb-map 단추는 생각 지도 칸이 있을 때만.
// 단추는 공용 6가지(icon-btn·ds-chip), 색 칸은 공용 색 칸(color-swatch.mjs — 노트 색 8가지 + 기본).
const barBtn = (attrs, text, title = '') => `<button type="button" class="icon-btn nb-bar-btn" ${attrs}${title ? ` title="${title}"` : ''}>${text}</button>`;
// 색판 칸(채우기·테두리·글자 색 줄): 번호 하나 = 테마 변수 색 하나. 'none'이면 [없음] 칸도.
const paletteHtml = (attr, {none = false, line = false} = {}) => PALETTE.map(c => swatchHtml({color:line ? lineVar(c.n) : colorVar(c.n), label:c.name, role:'radio', attrs:{[attr]:c.n, title:c.name}})).join('')
  + (none ? swatchHtml({color:'', label:'없음', text:'⊘', role:'radio', attrs:{[attr]:NONE, title:'없음'}}) : '')
  + swatchHtml({color:'', label:'기본', text:'×', role:'radio', attrs:{[attr]:'', title:'기본'}});
const barHtml = () => `<div class="nb-node-bar" data-nb-bar role="toolbar" aria-label="선택한 상자" hidden><div class="nb-bar-main">`
  + barBtn('data-nb-map data-nb-bar-open="tone" aria-expanded="false"', '색')
  + barBtn('data-nb-decor data-nb-bar-open="stroke" aria-expanded="false"', '테두리')
  + barBtn('data-nb-decor data-nb-bar-open="ink" aria-expanded="false"', '글자')
  + barBtn('data-nb-map data-nb-bar-open="shape" aria-expanded="false"', '모양')
  + barBtn('data-nb-map data-nb-font="-1" aria-label="글자 작게"', '가−', '글자 작게')
  + barBtn('data-nb-map data-nb-font="1" aria-label="글자 크게"', '가+', '글자 크게')
  + barBtn('data-nb-map data-nb-bar-child', '+ 하위', '하위 가지 (Tab)')
  + barBtn('data-nb-map data-nb-bar-sibling', '+ 형제', '형제 가지 (Enter)')
  + barBtn('data-nb-bar-open="table" aria-expanded="false"', '표 ⋯', '줄·칸 더하기·빼기') // S71-56
  + barBtn('data-nb-file-open', '열기', '파일 열기 (F2)') // S71-56
  + barBtn('data-nb-bar-edit', '수정', '글 수정 (F2)')
  + barBtn('data-nb-bar-del', '삭제', '삭제 (Delete)')
  + barBtn('data-nb-bar-open="more" aria-expanded="false" aria-label="더 보기"', '…', '앞으로 · 뒤로 · 복제 · 투명도 · 자동 배치로 · 크기 자동 · 가지 떼기 · 노트로 만들기 · 관계 잇기 · 재료 잇기 · 이 가지만 보기') // 메뉴가 아니라 아래 한 줄 펼치기(…)
  + `</div><div class="nb-bar-row" data-nb-bar-row="more" role="group" aria-label="더 많은 동작" hidden>`
  + `<button type="button" class="ds-chip" data-nb-decor data-nb-z="1">앞으로</button><button type="button" class="ds-chip" data-nb-decor data-nb-z="-1">뒤로</button><button type="button" class="ds-chip" data-nb-decor data-nb-dup>복제</button>`
  + ALPHAS.map(a => `<button type="button" class="ds-chip" data-nb-decor data-nb-alpha="${a}" aria-pressed="false" aria-label="투명도 ${a}%">${a}%</button>`).join('')
  + `<button type="button" class="ds-chip" data-nb-auto>자동 배치로</button><button type="button" class="ds-chip" data-nb-autosize>크기 자동</button><button type="button" class="ds-chip" data-nb-detach>가지 떼기</button><button type="button" class="ds-chip" data-nb-to-note>노트로 만들기</button><button type="button" class="ds-chip" data-nb-relate>관계 잇기</button><button type="button" class="ds-chip" data-nb-relations>관계</button><button type="button" class="ds-chip" data-nb-material>재료 잇기</button><button type="button" class="ds-chip" data-nb-focus>이 가지만 보기</button>`
  + `</div><div class="nb-bar-row" data-nb-bar-row="table" role="group" aria-label="표 줄·칸" hidden>`
  + `<button type="button" class="ds-chip" data-nb-tbl="row+">줄 더하기</button><button type="button" class="ds-chip" data-nb-tbl="row-">줄 빼기</button><button type="button" class="ds-chip" data-nb-tbl="col+">칸 더하기</button><button type="button" class="ds-chip" data-nb-tbl="col-">칸 빼기</button>`
  + `</div><div class="nb-bar-row" data-nb-bar-row="tone" role="radiogroup" aria-label="채우기 색" hidden>`
  + NODE_COLORS.map(c => swatchHtml({color:`var(--ds-note-paper-${c.n})`, label:c.name, role:'radio', attrs:{'data-nb-tone':c.n, title:c.name}})).join('')
  + `<span data-nb-decor class="nb-bar-more-tones">${[8, 9].map(n => swatchHtml({color:colorVar(n), label:PALETTE[n].name, role:'radio', attrs:{'data-nb-tone':n, title:PALETTE[n].name}})).join('')}${swatchHtml({color:'', label:'채우기 없음', text:'⊘', role:'radio', attrs:{'data-nb-tone':NONE, title:'채우기 없음'}})}</span>`
  + swatchHtml({color:'', label:'기본 (색 없음)', text:'×', role:'radio', attrs:{'data-nb-tone':'', title:'기본 (색 없음)'}})
  + `</div><div class="nb-bar-row" data-nb-bar-row="stroke" role="group" aria-label="테두리" hidden>`
  + paletteHtml('data-nb-stroke', {none:true, line:true})
  + STROKE_WIDTHS.map(w => `<button type="button" class="ds-chip" data-nb-sw="${w}" aria-pressed="false" aria-label="테두리 두께 ${w}">${w}px</button>`).join('')
  + `<button type="button" class="ds-chip" data-nb-dash aria-pressed="false">점선</button>`
  + `</div><div class="nb-bar-row" data-nb-bar-row="ink" role="group" aria-label="글자 꾸미기" hidden>`
  + `<button type="button" class="ds-chip" data-nb-bold aria-pressed="false">굵게</button>`
  + ALIGNS.map(a => `<button type="button" class="ds-chip" data-nb-align="${a}" aria-pressed="false" aria-label="${ALIGN_NAMES[a]} 정렬">${ALIGN_NAMES[a]}</button>`).join('')
  + paletteHtml('data-nb-ink', {line:true})
  + `</div><div class="nb-bar-row" data-nb-bar-row="shape" role="group" aria-label="모양" hidden>`
  + NODE_SHAPES.map(k => `<button type="button" class="ds-chip" data-nb-shape="${k}" data-nb-shape-for="topic" aria-pressed="false">${SHAPE_NAMES[k]}</button>`).join('')
  + SHAPE_KINDS.map(k => `<button type="button" class="ds-chip" data-nb-shape="${k}" data-nb-shape-for="shape" aria-pressed="false">${SHAPE_KIND_NAMES[k]}</button>`).join('')
  + `</div></div>`;
// 도구 줄 [도형▾]·[선▾]을 누르면 펼쳐지는 한 줄(판 오른쪽 위 도구 줄 바로 아래).
const insertHtml = () => `<div class="nb-insert" data-nb-insert="shape" role="group" aria-label="도형·표·파일 넣기" hidden>${SHAPE_KINDS.map(k => `<button type="button" class="ds-chip" data-nb-add-shape="${k}">${SHAPE_KIND_NAMES[k]}</button>`).join('')}`
  + `<span class="nb-insert-sep" aria-hidden="true"></span><button type="button" class="ds-chip" data-nb-add-table>표</button><button type="button" class="ds-chip" data-nb-add-file>파일</button></div>`
  + `<div class="nb-insert" data-nb-insert="line" role="group" aria-label="선 넣기" hidden>${LINE_KINDS.map(k => `<button type="button" class="ds-chip" data-nb-add-line="${k}">${LINE_KIND_NAMES[k]}</button>`).join('')}</div>`;
// S71-52 ② 보기 기능 칸: 이 가지만 보는 중 줄([전체 보기]) · 찾은 주제 목록(맨 위 '노트에서 찾기'가 보드에서 맞춘 주제) · 미니맵(오른쪽 아래, 접기 가능).
const MAP_ICON = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false"><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="7.5" y="7" width="4.5" height="4" rx=".8" fill="currentColor"/></svg>';
const viewExtrasHtml = () => `<div class="nb-focusbar nb-vx" data-nb-focusbar role="status" hidden><span class="nb-focusbar-text">이 가지만 보는 중</span><button type="button" class="icon-btn nb-focus-all" data-nb-focus-all>전체 보기</button></div>`
  + `<div class="nb-finds nb-vx" data-nb-finds role="group" aria-label="보드에서 찾은 주제" hidden><p class="nb-finds-head" data-nb-finds-head></p><div class="nb-finds-list" data-nb-finds-list></div></div>`
  + `<div class="nb-mini nb-vx" data-nb-mini><button type="button" class="icon-btn nb-mini-toggle" data-nb-mini-toggle aria-expanded="false" aria-label="미니맵" title="미니맵">${MAP_ICON}</button>`
  + `<div class="nb-mini-body" data-nb-mini-body hidden><canvas class="nb-mini-canvas" data-nb-mini-canvas width="168" height="112" role="img" aria-label="보드 전체 미니맵 — 누르거나 끌면 그 자리로"></canvas><div class="nb-mini-view" data-nb-mini-view aria-hidden="true"></div></div></div>`;
// fullHost(): 전체 화면으로 키울 칸(없으면 판 칸 자신). hasSide(): 지금 왼쪽 노트 목록이 있나(전체 화면 안 [노트 목록] 단추). onRemove(ids): 고른 카드 함께 빼기(이름 붙은 보드).
export function mountNoteBoard(box, {esc, cardText, moreIcon, onMenu = () => {}, onBackgroundMenu = null, onMove = () => {}, onDrop = null, onRemove = null, fullHost = () => null, hasSide = () => false,
  onLinkAdd = () => {}, onLinkChange = () => {}, onLinkRemove = () => {}, onTextAdd = () => null, onTextChange = () => {}, onTextsChange = () => {}, onTextRemove = () => {}, onRemoveItems = null,
  onTextToNote = null, canText = () => true, mapReady = () => true, canMap = () => true, frameReady = () => true, decorReady = () => true, canDecor = () => true, branchReady = () => true, canBranch = () => true, linesReady = () => true, canLines = () => true,
  relationReady = () => false, canRelation = () => false, allLinks = null,
  cellsReady = () => false, canCells = () => false, fileInfoOf = () => null, onFilePick = null, onFileOpen = null,
  materialReady = () => false, materialsOf = () => [], onMaterialPick = null, onMaterialOpen = null, onMaterialRemove = null, onMaterialDrop = null, toast = () => {}, onImages = null, photoUrl = null, onPhotoView = null, miniOpen = () => null, onMiniOpen = () => {}}) {
  const mark = `nb${++uid}`;
  box.innerHTML = `<div class="nb-selbar" data-nb-selbar role="toolbar" aria-label="선택한 카드" hidden><span data-nb-sel-count></span><button type="button" class="icon-btn" data-nb-sel-remove>보드에서 빼기</button><button type="button" class="icon-btn nb-sel-x" data-nb-sel-clear aria-label="선택 해제" title="선택 해제 (Esc)">✕</button></div><div class="nb-selbar nb-relbar" data-nb-relbar role="toolbar" aria-label="관계 잇기" hidden><span class="nb-relbar-msg" data-nb-rel-msg></span><button type="button" class="icon-btn" data-nb-rel-find>찾기</button><button type="button" class="icon-btn nb-sel-x" data-nb-rel-cancel aria-label="관계 잇기 그만" title="그만 (Esc)">✕</button></div><div class="nb-tools" role="group" aria-label="보드 도구"><button type="button" class="icon-btn nb-side-btn" data-nb-side-toggle aria-pressed="false" hidden>노트 목록</button><button type="button" class="icon-btn nb-add-text" data-nb-add-text title="상자 더하기">+ 상자</button><button type="button" class="icon-btn nb-add-text" data-nb-add-label title="글자 넣기 (배경 없는 글)">글자</button><button type="button" class="icon-btn nb-add-text" data-nb-insert-open="shape" aria-expanded="false" title="도형 넣기">도형▾</button><button type="button" class="icon-btn nb-add-text" data-nb-insert-open="line" aria-expanded="false" title="선 넣기">선▾</button>${onImages ? '<button type="button" class="icon-btn nb-img-btn" data-nb-add-image aria-label="이미지 넣기" title="이미지 넣기">' + IMAGE_ICON + '</button>' : ''}<button type="button" class="icon-btn" data-nb-zoom="-1" aria-label="작게">－</button><button type="button" class="icon-btn nb-pct" data-nb-zoom-pct data-zoom-pct-key="board">100%</button><button type="button" class="icon-btn" data-nb-zoom="1" aria-label="크게">＋</button><button type="button" class="icon-btn nb-fit" data-nb-fit aria-label="맞추기 — 카드가 모두 보이게" title="맞추기 — 카드가 모두 보이게">맞추기</button><button type="button" class="icon-btn nb-full-btn" data-nb-full aria-pressed="false" aria-label="전체 화면" title="전체 화면">${FULL_ICON}</button></div>${insertHtml()}${onImages ? '<input type="file" accept="image/*" multiple hidden data-nb-image-input tabindex="-1" aria-hidden="true">' : ''}<div class="nb-scroll" data-nb-scroll><div class="nb-board" data-nb-board role="group" aria-label="노트 보드"><svg class="nb-links" data-nb-links width="1" height="1" focusable="false"><defs><marker id="${mark}-a" class="nb-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z"/></marker><marker id="${mark}-s" class="nb-arrow nb-arrow-sel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z"/></marker><marker id="${mark}-r" class="nb-arrow nb-arrow-rel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z"/></marker></defs><g class="nb-branches" data-nb-branches></g><g data-nb-lines></g><path class="nb-temp" data-nb-temp d="" hidden/><g class="nb-guides" data-nb-guides></g></svg><div class="nb-texts" data-nb-texts></div><div class="nb-cards" data-nb-cards></div></div><p class="nb-empty" data-nb-empty hidden></p>${barHtml()}</div>${viewExtrasHtml()}`;
  const empty = box.querySelector('[data-nb-empty]'), scroll = box.querySelector('[data-nb-scroll]'), board = box.querySelector('[data-nb-board]');
  const cardsBox = box.querySelector('[data-nb-cards]'), textsBox = box.querySelector('[data-nb-texts]'), linesBox = box.querySelector('[data-nb-lines]'), temp = box.querySelector('[data-nb-temp]');
  const branchesBox = box.querySelector('[data-nb-branches]'), bar = box.querySelector('[data-nb-bar]'), guidesBox = box.querySelector('[data-nb-guides]');
  // S71-52 ② 보기 기능 칸
  const focusBar = box.querySelector('[data-nb-focusbar]');
  const findsBox = box.querySelector('[data-nb-finds]'), findsHead = box.querySelector('[data-nb-finds-head]'), findsList = box.querySelector('[data-nb-finds-list]');
  const mini = box.querySelector('[data-nb-mini]'), miniBody = box.querySelector('[data-nb-mini-body]'), miniCanvas = box.querySelector('[data-nb-mini-canvas]'), miniView = box.querySelector('[data-nb-mini-view]');
  const miniToggle = box.querySelector('[data-nb-mini-toggle]');
  let miniMap = null, miniFrame = 0, miniDrag = null;
  const views = new Map(); // 보드마다 보던 자리(이번 접속만)
  let view = {x:0, y:0, z:1}, key = null, frame = 0;
  let places = new Map(), shown = [], byId = new Map(), infoOf = new Map(), links = [], linkOn = new Set(), needFit = false;
  const cardEls = new Map(), lineEls = new Map(), textEls = new Map(), textSize = new Map(), htmlOf = new Map();
  // S71-52 NOTE-큰생각지도: 상자도 보이는 자리(+여유)만 붙인다. textOn = 그릴 상자(접힌 가지 밖) 전부, wantHtml = 그 모양, 크기는 textSize에 모양과 함께 기억.
  // drawn = 상자·가지 선을 마지막으로 붙인 판 영역(여유 포함) — 보이는 영역이 그 밖으로 나갈 때만 다시 고른다(옮기는 동안 다시 그리기 최소).
  let textOn = new Set(), wantHtml = new Map(), wantNode = new Map(), drawn = null, linksAt = new Map();
  // lift = 가지째 끄는 동안 끄는 상자들을 담는 칸 하나(그 칸만 translate로 옮김 — 상자 수백 개의 자리를 매번 고쳐 쓰지 않게).
  // allOn = 내보내기 동안 모든 칸·선을 붙여 둠(다음 화면 이동 때 풀림).
  let lift = null, allOn = false;
  // S71-52 ②: 이 가지만 보기(보드마다 이번 접속 화면 메모리 — 저장 없음), 찾은 주제(맨 위 찾기).
  let focusRoot = null, focusSet = null, finds = null;
  const focusOf = new Map();
  const ALL = {x:-4000000, y:-4000000, w:8000000, h:8000000};
  let texts = [], textById = new Map(), tdrag = null, textSel = null, editing = null, bend = null, lastTap = null, afterClick = null, bendEnded = false;
  let tree = buildTree([]), lay = {rects:new Map(), hidden:new Set()}, draft = null, barOpen = null; // 생각 지도: 나무·자동 배치·새로 쓰는 상자·막대에서 펼친 줄
  let rz = null, nudge = null, lend = null, lmove = null, ddrag = null; // S70-03: 새로 쓰는 칸 둘레 끌기 // S69-91: 선 끝 끌기·양 끝이 점인 선 통째로 옮기기 // 크기 손잡이 끌기·화살표로 옮기는 중(0.5초 멈추면 저장)
  let drag = null, pan = null, pinch = null, wire = null, selected = null, lineSel = null, menu = null, suppressUntil = 0, linesQuietUntil = 0, keyTimer = null, opts = {};
  const touches = new Map();
  // S71-49: pasteAt = PC에서 빈 곳을 왼쪽 클릭한 자리(그 보드, 판 좌표) — Ctrl+V가 거기 붙인다. lastPointer = 판을 마지막으로 누른 손(폰 손가락이면 글자 붙여넣기는 그대로 안 함).
  // photoTap = 사진 카드를 누를 때 그 카드가 이미 골라져 있었나(폰: 고른 사진을 한 번 더 누르면 크게 보기).
  let pasteAt = null, lastPointer = '', photoTap = null;
  // S71-53: relPick = [관계 잇기]로 이을 칸을 고르는 중({from}), lastLineTap = 관계선 두 번 누르기(이름) 판정, linkById = 선 id → 선.
  let relPick = null, lastLineTap = null, linkById = new Map();
  let multi = new Set(), spaceDown = false, blankDown = null, full = null; // 여러 장 고르기(이번 화면만)·Space 누름·마우스 빈 곳 누름·전체 화면
  const size = () => ({w:scroll.clientWidth, h:scroll.clientHeight});
  const tKey = id => `t:${id}`;

  // ---- S69-91 도구 줄 [도형▾]·[선▾] 펼친 줄(하나만 열림, 판을 누르거나 고르면 닫힘) ----
  let insertOpen = null;
  function paintInsert() {
    box.querySelectorAll('[data-nb-insert]').forEach(r => { r.hidden = r.dataset.nbInsert !== insertOpen; });
    box.querySelectorAll('[data-nb-insert-open]').forEach(b => b.setAttribute('aria-expanded', String(b.dataset.nbInsertOpen === insertOpen)));
  }
  const toggleInsert = k => { if (insertOpen !== k && !(k === 'line' ? canLines() : mapReady() && decorReady() ? true : canDecor())) return; insertOpen = insertOpen === k ? null : k; paintInsert(); box.querySelector(`[data-nb-insert="${k}"] button`)?.focus({preventScroll:true}); };
  const closeInsert = () => { if (insertOpen) { insertOpen = null; paintInsert(); } };
  // [글자]·[도형▾]·[선▾]은 [+ 상자]처럼 늘 보인다(읽기 답이 늦게 와도 도구 줄 모양이 바뀌지 않게). 꾸미기·선 칸이 아직 없는 서버면 누를 때 '준비 중' 한 줄.
  function paintTools() { if (opts.pickActive) closeInsert(); }
  // ---- 판 보기 ----
  function paintView() {
    board.style.transform = `translate(${Math.round(view.x * 100) / 100}px,${Math.round(view.y * 100) / 100}px) scale(${view.z})`;
    box.querySelectorAll('[data-nb-zoom]').forEach(b => { b.disabled = stepZoom(view.z, Number(b.dataset.nbZoom)) === view.z; });
    pct.paint();
    box.dataset.nbZoomNow = String(Math.round(view.z * 1000) / 1000);
    box.toggleAttribute('data-nb-small', view.z < 0.5);
    paintFar();
    if (key) views.set(key, view);
    placeBar();
    paintMiniView();
  }
  // ---- S71-52 ② 멀리 보기: 아주 작게 줄이면(FAR_Z 아래) 큰 가지(맨 위 FAR_DEPTH단계)만 글자, 나머지는 흐린 막대(CSS .nb[data-nb-far]).
  // 큰 가지 글자는 화면에서 읽히는 크기로 키운다 — 배율이 한 계단(15%) 넘게 바뀔 때만 값을 고쳐 모양 다시 계산을 줄인다.
  let farStep = null;
  function paintFar() {
    const far = farOf(view.z);
    box.toggleAttribute('data-nb-far', far.on);
    if (far.on && far.step !== farStep) { farStep = far.step; textsBox.style.setProperty('--nb-far-s', String(far.scale)); }
    if (!far.on && farStep !== null) { farStep = null; textsBox.style.removeProperty('--nb-far-s'); swapLight(); }
  }
  // 멀리 보기에서 돌아오면 가벼운 모양으로 붙인 상자를 제 모양(손잡이 포함)으로.
  function swapLight() { for (const [id, el] of [...textEls]) if (el._nbLight && editing?.el !== el) { el.remove(); textEls.delete(id); htmlOf.delete(id); attachText(id); } }
  function setView(next) { allOn = false; delete box.dataset.nbExport; endMatExport(); view = {x:next.x, y:next.y, z:clampZoom(next.z)}; paintView(); queue(); }
  function endMatExport() { if (!matExport) return; matExport = false; renderTexts(); }
  // ---- S71-52: 가지째 끌기 칸(lift) ----
  function liftDrag() {
    if (lift || !tdrag) return;
    lift = document.createElement('div'); lift.className = 'nb-lift';
    textsBox.append(lift);
    for (const id of tdrag.ids) { const el = textEls.get(id); if (el && el !== editing?.el) { lift.append(el); placeEl(id, el); } }
  }
  function moveLift(dx, dy) { if (lift) lift.style.transform = `translate(${dx}px,${dy}px)`; }
  function dropLift() {
    if (!lift) return;
    const l = lift; lift = null;
    for (const el of [...l.children]) { textsBox.append(el); const id = el.dataset.nbText; if (id) placeEl(id, el); }
    l.remove();
  }
  // S71-52: 화면 이동은 queue()(그린 영역 밖으로 나갈 때만 붙이기·떼기), 칸·선이 바뀐 뒤는 queue(true)(다시 고르기).
  let queueForce = false;
  const queue = (force = false) => { queueForce ||= force; if (!frame) frame = requestAnimationFrame(() => { frame = 0; const f = queueForce; queueForce = false; sync(f); }); };
  function fitBoard() {
    const {w, h} = size(), rects = [...shown.filter(n => isShown(n.id)).map(n => cardRect(places.get(n.id))), ...lay.rects.values()];
    needFit = !w || !h; // 아직 화면에 안 보이면(크기 0) 보일 때 맞춘다
    setView(fitView(rects, w, h, 24, 1, FIT_MIN));
  }
  // 비율 글자(가운데) → 80~120% 목록. 고르면 화면 가운데를 그대로 둔 채 그 배율.
  const zoomTo = z => { const {w, h} = size(); setView(zoomAt(view, z, w / 2, h / 2)); };
  const pct = bindZoomPct(box.querySelector('[data-nb-zoom-pct]'), {levels:BOARD_ZOOMS, now:() => view.z * 100, choose:v => zoomTo(v / 100), label:'보드 비율'});
  function zoomBy(dir, at = null) {
    const {w, h} = size(), p = at || {x:w / 2, y:h / 2};
    setView(zoomAt(view, stepZoom(view.z, dir), p.x, p.y));
  }

  // ---- 그리기 ----
  const isShown = id => !opts.visible || opts.visible.has(id);
  const cardHtml = (note, p, info) => {
    const sel = selected === note.id, alias = !info.locked && p.label ? p.label : '', shown = alias || info.title;
    const size = `${p.w ? `;width:${p.w}px` : ''}${p.h ? `;height:${p.h}px` : ''}`, tip = alias ? `${alias} · 노트: ${info.title}` : info.title;
    return `<div class="nb-card${info.photo && !info.locked ? ' nb-card-photo' : ''}${info.picked ? ' nb-picked' : ''}${sel ? ' nb-sel' : ''}${multi.has(note.id) ? ' nb-multi' : ''}${focusSet?.has(note.id) ? ' nb-in-focus' : ''}${info.locked ? ' nb-locked' : ''}"${info.locked ? ' data-nb-locked' : ''}${alias ? ' data-nb-alias' : ''}${p.w || p.h ? ' data-nb-sized' : ''} data-nb-card="${esc(note.id)}" data-tone="${folderTone(info.folderId)}"${info.color ? ` data-fc="${info.color}"` : ''} style="left:${p.x}px;top:${p.y}px;z-index:${p.z + 1}${size}"><button type="button" class="nb-open" data-note-row="${esc(note.id)}"${opts.pickActive ? ` aria-pressed="${!!info.picked}"` : ''} aria-roledescription="노트 카드" title="${esc(tip)}"${alias ? ` aria-description="${esc(`보드에 보일 글자 — 노트: ${info.title}`)}"` : ''}>${info.locked ? `<span class="nb-title nb-lock">${LOCK_ICON}<span class="a11y-only">${esc(info.title)}</span></span>` : info.photo ? `<span class="nb-photo" data-nb-photo="${esc(info.photo.drive_file_id)}"></span><span class="a11y-only">${esc(shown)}</span>` : `<span class="nb-title">${esc(shown)}</span>`}</button>${opts.removable ? `<button type="button" class="nb-x" data-nb-remove="${esc(note.id)}" aria-label="${esc(shown)} 보드에서 빼기" title="보드에서 빼기">×</button>` : ''}<button type="button" class="basket-row-more nb-more" data-note-row-more="${esc(note.id)}" aria-label="${esc(shown)} 메뉴" aria-haspopup="true" aria-expanded="false" aria-controls="noteDocMenu">${moreIcon}</button>${opts.pickActive ? '' : SIDES.map(s => `<span class="nb-h nb-h-${s}" data-nb-handle="${s}" aria-hidden="true"></span>`).join('') + resizeHtml()}</div>`;
  };
  function addCard(id) {
    const note = byId.get(id), p = places.get(id), info = infoOf.get(id); if (!note || !p || !info) return;
    cardsBox.insertAdjacentHTML('beforeend', cardHtml(note, p, info));
    const el = cardsBox.lastElementChild;
    // 폰 브라우저는 누른 곳 근처의 '누를 수 있는' 요소로 손가락을 옮겨 잡는다(터치 보정). 손잡이도 누를 수 있는 요소로 알려 카드 열기 단추에 빼앗기지 않게.
    el.querySelectorAll('[data-nb-handle],[data-nb-resize]').forEach(h => h.addEventListener('click', stopClick));
    cardEls.set(id, el);
    if (info.photo && !info.locked && photoUrl) fillPhoto(el.querySelector('[data-nb-photo]'), note.id, info.photo.drive_file_id);
  }
  // S70-32 ②: 사진 칸 — owner 사진 보기(basket-files?action=photo)로 받아 공용 그림 칸(img-slot.js) 규칙으로 보인다. 못 받으면 작은 ↻.
  function fillPhoto(place, noteId, fileId) {
    if (!place) return;
    const load = () => {
      slotLoading(place);
      Promise.resolve(photoUrl(noteId, fileId)).then(url => {
        if (!place.isConnected) return;
        const img = document.createElement('img'); img.className = 'nb-photo-img'; img.alt = ''; img.decoding = 'async'; img.draggable = false;
        slotImg(place, img, url, {retry:() => { img.remove(); load(); }});
      }, () => { if (place.isConnected) slotFailed(place, load); });
    };
    load();
  }
  // S69-91: 선 끝 칸 — 노트 카드·상자, 또는 판 위 점(크기 0인 칸). 끝을 끄는 중이면 그 자리.
  const lineEndRect = (l, side) => {
    if (lend?.id === l.id && lend.side === side && lend.now) return lend.target ? rectFor(lend.target) : {x:lend.now.x, y:lend.now.y, w:0, h:0};
    if (lmove?.id === l.id && lmove.moved) return {x:l[`${side}_x`] + lmove.dx, y:l[`${side}_y`] + lmove.dy, w:0, h:0};
    return isPointEnd(l, side) ? pointRect(l, side) : rectFor(endOf(l, side));
  };
  // S71-53: 관계선 끝이 접힌 가지 안 칸이면 그 칸을 덮은 접힌 칸으로 모은다(다른 선은 지금처럼 숨김).
  const endOf = (l, side) => { const id = endId(l, side); return id && isRelation(l) && lay.hidden.has(id) ? gatherEnd(id, tree.parentOf, lay.hidden) : id; };
  const lineOn = l => ['from', 'to'].every(side => isPointEnd(l, side) || hasEnd(endOf(l, side))) && (!isRelation(l) || endOf(l, 'from') !== endOf(l, 'to'));
  const relFocus = () => selected || textSel;
  const relOn = l => { const f = relFocus(); return !!f && isRelation(l) && [endId(l, 'from'), endId(l, 'to'), endOf(l, 'from'), endOf(l, 'to')].includes(f); };
  const endTitle = id => !id ? '점' : (infoOf.get(id) ? cardLabel(infoOf.get(id).locked ? null : places.get(id), infoOf.get(id).title) : '') || (textById.has(id) ? `${{table:'표', file:'파일'}[textById.get(id).kind] || '상자'} ${[...textOfCell(textById.get(id))].slice(0, 20).join('')}` : '');
  const lineLabel = l => (isRelation(l) ? `관계선 ${endTitle(endId(l, 'from'))} ${l.ends === 'both' ? '↔' : l.ends === 'none' ? '—' : '→'} ${endTitle(endId(l, 'to'))}${l.label ? ` · ${l.label}` : ''}`
    : `${endTitle(endId(l, 'from'))} ${l.ends === 'both' ? '↔' : l.ends === 'none' ? '—' : '→'} ${endTitle(endId(l, 'to'))} 연결선`);
  const short = (v, n = 20) => [...String(v || '').replace(/\s+/g, ' ').trim()].slice(0, n).join('');
  function lineMarkup(l, g, sel) {
    const arrow = `url(#${mark}-${sel ? 's' : isRelation(l) ? 'r' : 'a'})`, start = l.ends === 'both' ? arrow : 'none', end = l.ends === 'none' ? 'none' : arrow;
    const label = l.label ? `<text class="nb-label" x="${Math.round(g.mid.x)}" y="${Math.round(g.mid.y)}" text-anchor="middle" dominant-baseline="central">${esc(l.label)}</text>` : '';
    // S69-91: 선 색(색판 번호)·두께는 그 선의 style 변수. 고른 선은 양 끝 동그라미(끌어 옮기기·상자에 붙이기, 선 끝 칸이 있는 서버만).
    const look = [l.color != null ? `--nb-line-c:${lineVar(l.color)}` : '', l.width ? `--nb-line-w:${l.width}px` : ''].filter(Boolean).join(';');
    const free = isPointEnd(l, 'from') && isPointEnd(l, 'to') && !isBent(l);
    const grips = sel && !l.pending && linesReady() ? ['from', 'to'].map(side => { const p = side === 'from' ? g.from : g.to; return `<circle class="nb-lend" cx="${Math.round(p.x)}" cy="${Math.round(p.y)}" r="7" data-nb-lend="${side}" data-nb-lend-of="${esc(l.id)}"><title>${side === 'from' ? '시작' : '끝'} 끝 옮기기 · 상자에 놓으면 붙음</title></circle>`; }).join('') : '';
    return `<path class="nb-line${l.dash === 'dashed' ? ' nb-dashed' : ''}"${look ? ` style="${look}"` : ''} d="${g.d}" marker-start="${start}" marker-end="${end}"/>${label}<path class="nb-hit" d="${g.d}" tabindex="0" role="button" aria-label="${esc(lineLabel(l))}" aria-haspopup="dialog" aria-description="${isRelation(l) ? '누르면 메뉴, 두 번 누르면 이름, 끝 근처를 누르면 상대 칸으로' : free ? '누르면 메뉴, 끌면 옮기기' : '누르면 메뉴, 끌면 곡선'}" data-nb-hit="${esc(l.id)}"${free ? ' data-nb-free-line' : ''}/>${grips}`;
  }
  const placeOfNow = id => {
    if (drag?.moving && drag.now) { if (drag.id === id) return drag.now; const g = drag.group?.find(k => k.id === id); if (g?.now) return {...g.place, ...g.now}; }
    if (rz?.kind === 'note' && rz.id === id && rz.now) return rz.now;
    if (tdrag?.moving && tdrag.cards) { const g = tdrag.cards.find(k => k.id === id); if (g) return {...g.place, x:clampCoord(g.place.x + tdrag.dx), y:clampCoord(g.place.y + tdrag.dy)}; }
    return places.get(id);
  };
  // 상자 칸(판 좌표): 자동 배치 자리(끄는 가지면 끄는 만큼 옮긴 자리), 크기는 그린 크기(아직 못 쟀으면 대략).
  function textRect(id) {
    const r = lay.rects.get(id) || (() => { const t = textById.get(id), sz = textSize.get(id); return {x:t?.x || 0, y:t?.y || 0, w:sz?.w || 80, h:sz?.h || 26}; })();
    const o = shiftOf(id);
    return o ? {...r, x:r.x + o.dx, y:r.y + o.dy} : r;
  }
  // 지금 끌거나(tdrag·카드와 함께 끄는 상자) 화살표로 옮기는 중인 상자의 잠깐 어긋남(저장 전, 그리기만).
  function shiftOf(id) {
    if (tdrag?.moving && tdrag.ids.has(id)) return {dx:tdrag.dx, dy:tdrag.dy};
    if (drag?.moving && drag.textIds?.has(id) && drag.now) return {dx:drag.now.x - drag.place.x, dy:drag.now.y - drag.place.y};
    if (nudge?.ids.has(id)) return {dx:nudge.dx, dy:nudge.dy};
    return null;
  }
  // 끝(노트 카드 또는 상자)의 칸. 접힌 가지 안 상자는 끝이 아니다(선도 숨김).
  const rectFor = id => (places.has(id) ? rectOf(placeOfNow(id)) : textRect(id));
  const hasEnd = id => (places.has(id) ? isShown(id) : textById.has(id) && !lay.hidden.has(id));
  function geometry(l) { const b = bend?.moved && bend.id === l.id ? {...l, ...bendPatch(bend.now)} : l; return linkGeometry(lineEndRect(l, 'from'), lineEndRect(l, 'to'), b); }
  function paintLine(l) {
    let g = lineEls.get(l.id);
    if (!g) { g = document.createElementNS('http://www.w3.org/2000/svg', 'g'); g.dataset.nbLine = l.id; linesBox.append(g); lineEls.set(l.id, g); }
    const sel = lineSel === l.id;
    if (g.classList.contains('nb-line-sel') !== sel) g.classList.toggle('nb-line-sel', sel);
    if (g.classList.contains('nb-pending') !== !!l.pending) g.classList.toggle('nb-pending', !!l.pending);
    const rel = isRelation(l), on = rel && relOn(l), gathered = rel && (endOf(l, 'from') !== endId(l, 'from') || endOf(l, 'to') !== endId(l, 'to'));
    if (g.classList.contains('nb-rel') !== rel) g.classList.toggle('nb-rel', rel);
    if (g.classList.contains('nb-rel-on') !== on) g.classList.toggle('nb-rel-on', on);
    if (g.classList.contains('nb-rel-gather') !== gathered) g.classList.toggle('nb-rel-gather', gathered);
    const inFocus = !!focusSet && ['from', 'to'].every(side => isPointEnd(l, side) || focusSet.has(endId(l, side)));
    if (g.classList.contains('nb-in-focus') !== inFocus) g.classList.toggle('nb-in-focus', inFocus);
    // S71-52: 모양이 같으면 그대로, 자리(d·글자 x·y)만 바뀌었으면 그 값만 고친다 — 가지째 끌 때 선 수백 개를 매번 새로 만들지 않게.
    const html = lineMarkup(l, geometry(l), sel);
    if (g._nbHtml === html) return;
    const shape = html.replace(/ (?:d|x|y|cx|cy)="[^"]*"/g, '');
    if (g._nbShape === shape && g.childElementCount) {
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'g'); t.innerHTML = html;
      [...t.children].forEach((src, i) => { const dst = g.children[i]; for (const k of ['d', 'x', 'y', 'cx', 'cy']) { const v = src.getAttribute(k); if (v != null && dst.getAttribute(k) !== v) dst.setAttribute(k, v); } });
    } else g.innerHTML = html;
    g._nbHtml = html; g._nbShape = shape;
  }
  // 보이는 영역의 카드·선만 붙인다(고른 카드·끄는 카드·초점 카드는 늘 붙여 둔다).
  // S71-52: 보이는 영역이 지난 그린 영역(drawn — 화면보다 넉넉히)을 벗어났을 때만(또는 force) 다시 고른다. 붙이고 떼는 일이
  // 화면 전체 규칙(:has)을 다시 계산하게 하므로, 옮기는 동안 프레임마다 붙이고 떼지 않는다.
  function sync(force = false) {
    const redraw = syncTexts(force);
    if (redraw) paintBranches();
    if (!redraw && !force) return;
    const area = drawn || ALL;
    const keep = new Set([selected, drag?.id, wire?.from, document.activeElement?.closest?.('[data-nb-card]')?.dataset.nbCard].filter(Boolean));
    const want = new Set();
    for (const n of shown) {
      if (!isShown(n.id)) continue;
      const p = placeOfNow(n.id); if (p && (keep.has(n.id) || rectsMeet(cardRect(p), area))) want.add(n.id);
    }
    for (const [id, el] of cardEls) if (!want.has(id)) { el.remove(); cardEls.delete(id); }
    for (const id of want) if (!cardEls.has(id)) addCard(id);
    const wantLines = new Set();
    for (const l of links) {
      if (!linkOn.has(l.id)) continue;
      const a = lineEndRect(l, 'from'), b = lineEndRect(l, 'to');
      if (lineSel === l.id || bend?.id === l.id || lend?.id === l.id || lmove?.id === l.id || rectsMeet(linkBox(a, b, isBent(l) ? geometry(l).mid : null), area)) wantLines.add(l.id);
    }
    for (const [id, g] of lineEls) if (!wantLines.has(id)) { g.remove(); lineEls.delete(id); }
    for (const l of links) if (wantLines.has(l.id) && !lineEls.has(l.id)) paintLine(l);
  }
  function repaintLinesOf(id) {
    for (const l of linksAt.get(id) || []) if (lineEls.has(l.id)) paintLine(l); // S71-52: 끝마다 선 목록(indexLinks)으로 — 가지째 끌 때 상자 수 × 선 수로 돌지 않게
    if (places.has(id) && childrenOf(tree, id).length) relayout(); // S71-51: 카드가 움직이면 그 아래 가지도 따라간다
  }
  // ---- 생각 지도 상자 그리기(S71-52: 크기는 가벼운 모양으로 한 번에 재어 기억하고, 붙이는 것은 보이는 자리(+여유)만 — syncTexts) ----
  // 한 번 그리기 = 나무 만들기 → 접힌 가지 밖 상자 붙이기 → 크기 재기 → 자동 배치 → 자리 놓기 → 가지 선 → 막대. 그리는 곳은 여기 하나다.
  const draftNode = () => ({id:DRAFT, board_id:key, body:'', x:draft.x, y:draft.y, parent_id:draft.parent_id, parent_card:!!draft.parent_card, ord:draft.ord, side:draft.side, kind:draft.kind || 'topic', color:draft.color ?? null, shape:draft.shape || (draft.kind === 'label' ? 'plain' : draft.kind === 'shape' ? 'rect' : 'round'), font:draft.font, w:draft.w ?? null, h:draft.h ?? null, collapsed:false, pinned:false, z:draft.z ?? 0, stroke:draft.stroke ?? null, ink:draft.ink ?? null});
  // S71-51: 보드 위 모든 칸이 가지를 뻗는다 — 가지가 붙은 노트 카드(사진 카드 포함)는 나무에 뿌리 칸(cardNode)으로 들어간다(그리기는 카드 쪽).
  // 모든 칸 가지 칸이 없는 서버(적용 전)는 옛 규칙(글자·도형·카드는 가지 없음).
  const isCard = id => !!id && places.has(id);
  const parentFields = pid => ({parent_id:pid ?? null, parent_card:isCard(pid)});
  const cardNodes = list => { const want = new Set(list.filter(t => t.parent_card && t.parent_id).map(t => t.parent_id)); return [...want].filter(id => places.has(id) && isShown(id)).map(id => cardNode(id, placeOfNow(id))); };
  const sizeOfNode = id => (places.has(id) ? (() => { const r = rectOf(placeOfNow(id)); return {w:r.w, h:r.h}; })() : textSize.get(id) || {w:80, h:26});
  const canGrow = t => !!t && (branchReady() || (!isFree(t) && t.kind !== CARD_KIND)); // 이 칸 아래로 가지를 낼 수 있나(서버 칸 기준)
  const nodeList = () => (draft ? [...texts, draftNode()] : texts);
  const nodeInfo = t => { const kids = childrenOf(tree, t.id).length; return {root:!tree.parentOf.has(t.id), kids, count:kids ? descendants(tree, t.id).length : 0}; };
  let zOf = new Map(); // 겹침 순서(z) → 화면 z-index, renderTexts가 매번 다시 센다
  // ---- S71-56 표·파일 칸 그리기(글은 모두 escape) ----
  const tableHtml = t => { const ed = editing?.table && editing.id === t.id ? editing : null, cells = ed ? ed.cells : t.cells || [['']];
    return `<table class="nb-tbl"${ed ? '' : ' aria-hidden="true"'}><tbody>${cells.map((row, r) => `<tr>${row.map((c, k) => `<td data-nb-cell="${r},${k}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`; };
  const fileOf = t => fileInfoOf(t) || {name:'파일', missing:true};
  const fileHtml = t => {
    const f = fileOf(t), type = f.missing ? 'other' : fileType(f.fileName || f.name, f.mime), meta = f.missing ? '찾을 수 없는 파일' : [FILE_TYPE_NAMES[type], sizeText(f.size)].filter(Boolean).join(' · ');
    return `<span class="nb-file-ico" data-type="${type}">${iconSvg(type === 'image' ? 'image' : 'doc', {size:16})}</span><span class="nb-file-name">${esc(f.name || '파일')}</span><small class="nb-file-meta">${esc(meta)}</small>`;
  };
  const cellLabel = t => (t.kind === 'table' ? `표 ${tableSize(t.cells).rows}줄 ${tableSize(t.cells).cols}칸${tableTitle(t.cells) ? `: ${[...tableText(t.cells)].slice(0, 120).join('')}` : ''}`
    : `파일: ${fileOf(t).name || '파일'}`);
  // 찾기·관계 잇기 찾기·이름 줄에 쓰는 칸 글(표는 칸 글 모두, 파일은 이름).
  const textOfCell = t => (!t ? '' : t.kind === 'table' ? tableText(t.cells) : t.kind === 'file' ? (fileOf(t).missing ? '' : fileOf(t).name || '') : t.body || '');
  // light = 크기만 재는 가벼운 모양(손잡이·접기 동그라미 없음 — 둘 다 칸 밖에 떠 있어 크기에 들지 않는다, S71-52).
  // S71-54 주제 재료 칩: 주제 아래 작은 칩(종류 아이콘 + 이름 줄임) 3개까지, 넘으면 '+n'(누르면 이 주제만 모두 — 이번 접속만).
  // 칩 한 번 누름 = 보드 위에서 열어 보기(onMaterialOpen, 링크는 새 탭), 칩 ⋯ = [열기]·[잇기 풀기]. 이름은 부르는 쪽이 지금 이름으로 준다(materialsOf).
  // 칩은 상자 안에 있어 크기 재기·배치에 그대로 들어간다(멀리 보기는 CSS가 숨김). 재료 칸이 없는 서버(적용 전)면 그리지 않는다.
  // 내보내기(PDF·HTML) 동안은 모든 칩을 이름 전체로(⋯·'+n' 없음) — 끝나면(endExport·판 이동) 다시 줄인 칩.
  const matAll = new Set();
  let matExport = false;
  const matsHtml = t => {
    if (t.id === DRAFT || t.pending || !materialReady()) return '';
    const list = materialsOf(t.id) || []; if (!list.length) return '';
    if (matExport) return `<div class="nb-mats nb-mats-out" data-nb-mats>${list.map(m => `<span class="nb-mat" data-kind="${m.kind}">${iconSvg(MAT_ICON[m.kind], {size:12})}<span class="nb-mat-name">${esc(`${MATERIAL_KIND_NAMES[m.kind]} · ${m.name}`)}</span></span>`).join('')}</div>`;
    const all = matAll.has(t.id), {shown, more} = all ? {shown:list, more:0} : chipsOf(list);
    const chip = m => { const what = `${MATERIAL_KIND_NAMES[m.kind]} · ${m.name}`; return `<span class="nb-mat${m.pending ? ' nb-pending' : ''}" data-nb-mat="${esc(m.id)}" data-kind="${m.kind}"><button type="button" class="icon-btn nb-mat-open" data-nb-mat-open="${esc(m.id)}" title="${esc(what)}" aria-label="${esc(`${what} 열기`)}">${iconSvg(MAT_ICON[m.kind], {size:12})}<span class="nb-mat-name">${esc(shorten(m.name))}</span></button><button type="button" class="icon-btn nb-mat-more" data-nb-mat-more="${esc(m.id)}" data-ctx="off" aria-label="${esc(`재료 메뉴: ${m.name}`)}" title="재료 메뉴" aria-haspopup="menu"><span class="more-dots" aria-hidden="true">⋯</span></button></span>`; };
    const tail = more ? `<button type="button" class="icon-btn nb-mat-plus" data-nb-mat-all="${esc(t.id)}" aria-expanded="false" aria-label="재료 ${more}개 더 보기">+${more}</button>`
      : all ? `<button type="button" class="icon-btn nb-mat-plus" data-nb-mat-all="${esc(t.id)}" aria-expanded="true" aria-label="재료 접기">접기</button>` : '';
    return `<div class="nb-mats" data-nb-mats role="group" aria-label="재료 ${list.length}개">${shown.map(chip).join('')}${tail}</div>`;
  };
  const nodeHtml = (t, light = false) => {
    const info = nodeInfo(t), free = isFree(t), cell = isCellKind(t.kind), name = t.kind === 'label' ? '글자' : t.kind === 'shape' ? '도형' : t.kind === 'table' ? '표' : t.kind === 'file' ? '파일' : info.root ? '상자' : '가지', fold = info.kids && !info.root
      ? `<button type="button" class="icon-btn nb-fold" data-nb-fold aria-expanded="${!t.collapsed}" aria-label="${t.collapsed ? `가지 펼치기 (${info.count}개)` : '가지 접기'}" title="${t.collapsed ? '펼치기' : '접기'}"><span class="nb-fold-dot" aria-hidden="true">${t.collapsed ? info.count : '−'}</span></button>` : '';
    // S69-91: 색 번호 0~7은 지금처럼 data-tone(노트 색), -1·8·9와 테두리·투명도·글자 꾸밈은 CSS 변수(decorStyle). 마름모·삼각형·화살표는 칸에 맞춰 늘어나는 그림.
    const tone = Number.isInteger(t.color) && t.color >= 0 && t.color <= 7 ? ` data-tone="${t.color}"` : '';
    const style = [t.w ? `width:${t.w}px` : '', t.h ? `min-height:${t.h}px` : '', `z-index:${zOf.get(t.id) || 1}`, decorStyle(t)].filter(Boolean).join(';');
    const poly = t.kind === 'shape' && shapeSvgPoints(t.shape);
    const art = poly ? `<svg class="nb-shape-art" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false"><polygon points="${poly}" vector-effect="non-scaling-stroke"/></svg>` : '';
    const label = cell ? cellLabel(t) : t.body || (t.kind === 'shape' ? SHAPE_KIND_NAMES[t.shape] || '도형' : '');
    const deep = t.id !== DRAFT && depthOf(tree, t.id) >= FAR_DEPTH; // S71-52 ②: 멀리 볼 때 흐린 막대가 될 칸(큰 가지 아래)
    return `<div class="nb-text${t.pending ? ' nb-pending' : ''}${info.root && !free && !cell ? ' nb-root' : ''}${poly ? ' nb-poly' : ''}" data-nb-text="${esc(t.id)}" data-shape="${t.shape}" data-font="${t.font}" data-kind="${t.kind}"${tone}${t.color === NONE ? ' data-fill-none' : ''}${t.stroke === NONE ? ' data-stroke-none' : ''}${t.dash ? ' data-dash' : ''}${t.bold ? ' data-bold' : ''}${t.pinned ? ' data-pinned' : ''}${t.h ? ' data-h' : ''}${fold ? ' data-fold' : ''}${deep ? ' data-deep' : ` data-far-label="${esc([...label].slice(0, 40).join(''))}"`} style="${style}">${art}<div class="nb-tx" tabindex="0" role="button" aria-roledescription="${name}" aria-label="${esc(label)}"${info.kids ? ` aria-expanded="${!t.collapsed}"` : ''}>${t.kind === 'table' ? tableHtml(t) : t.kind === 'file' ? fileHtml(t) : esc(t.body)}</div>${matsHtml(t)}${light ? '' : fold}${opts.pickActive || light ? '' : SIDES.map(s => `<span class="nb-h nb-h-${s}" data-nb-handle="${s}" aria-hidden="true"></span>`).join('') + resizeHtml()}</div>`;
  };
  function measureText(id) { const el = textEls.get(id); if (el && !el._nbLight) textSize.set(id, {w:el.offsetWidth || 80, h:el.offsetHeight || 26, html:htmlOf.get(id)}); }
  // 자리만 다시(글을 고치는 중 폭이 바뀔 때·끌기가 끝난 뒤): 크기 재기 → 배치 → 자리·가지 선·연결선·막대.
  // 크기를 바꾸는 중인 뿌리·손으로 둔 가지는 반대편 변이 그대로 있게 그 잠깐 자리(왼쪽·위 손잡이)로 배치한다.
  const livePos = id => (rz?.kind === 'text' && rz.id === id && rz.now && rz.ownPlace ? {x:rz.now.x, y:rz.now.y} : null);
  function relayout() {
    for (const id of textEls.keys()) measureText(id);
    lay = layoutMindmap(tree, sizeOfNode, {posOf:id => (places.has(id) ? (({x, y}) => ({x, y}))(placeOfNow(id)) : livePos(id))});
    placeEls();
    syncTexts(true);
    paintBranches();
    repaintTextLines();
    queue(true); // 자리가 바뀌어 화면 안팎이 달라진 선·카드
    placeBar();
    paintDraftLink();
    queueMini();
  }
  // 붙어 있는 선 중 한쪽 끝이 상자인 선만 다시(상자 수 × 선 수로 돌지 않게).
  function indexLinks() {
    linksAt = new Map();
    linkById = new Map(links.map(l => [l.id, l]));
    const put = (id, l) => { if (!id) return; if (!linksAt.has(id)) linksAt.set(id, []); if (!linksAt.get(id).includes(l)) linksAt.get(id).push(l); };
    for (const l of links) for (const side of ['from', 'to']) { put(endId(l, side), l); if (isRelation(l)) put(endOf(l, side), l); } // S71-53: 접힌 칸으로 모인 관계선도 그 칸이 움직이면 따라간다
  }
  // S71-53: 고른 칸이 바뀌면 관계선 진하게(nb-rel-on)만 다시 단다(멀리 볼 때 고른 칸의 관계선만 진하게).
  function paintRelFocus() {
    for (const [id, g] of lineEls) { const l = linkById.get(id); if (!l || !isRelation(l)) continue; const on = relOn(l); if (g.classList.contains('nb-rel-on') !== on) g.classList.toggle('nb-rel-on', on); }
  }
  function repaintTextLines() { for (const l of links) if (lineEls.has(l.id) && (textById.has(endId(l, 'from')) || textById.has(endId(l, 'to')))) paintLine(l); }
  // S70-77: 연결점에서 빈 곳에 놓아 새 상자를 쓰는 동안 — 시작 상자와 새 상자를 잇는 선을 미리 보인다(저장될 선과 같은 모양). 다 쓰면 진짜 선, 취소하면 없음.
  function paintDraftLink() {
    if (wire) return; // 긋는 중에는 끄는 선이 그 자리를 쓴다
    const lf = draft?.linkFrom, a = lf ? rectFor(lf.id) : null, b = lf ? lay.rects.get(DRAFT) : null;
    if (!a || !b) { if (temp.hasAttribute('data-nb-draft-link')) { temp.removeAttribute('data-nb-draft-link'); temp.setAttribute('d', ''); temp.setAttribute('hidden', ''); } return; }
    temp.setAttribute('d', linkGeometry(a, b, {from_side:lf.side}).d); temp.removeAttribute('hidden'); temp.setAttribute('data-nb-draft-link', '');
  }
  // 상자 요소 자리 = 자동 배치 칸(+ 끄는·화살표로 옮기는 중이면 그 만큼).
  function placeEls() { for (const [id, el] of textEls) placeEl(id, el); }
  function placeEl(id, el) {
    if (!lay.rects.has(id)) return;
    const r = lift && el.parentNode === lift ? lay.rects.get(id) : textRect(id); // 끄는 칸 안이면 제자리(옮김은 칸의 translate)
    // S71-52: 같은 값은 다시 쓰지 않는다(쓸 때마다 모양 다시 계산 — 가지째 끌 때 상자 수백 개).
    const left = `${Math.round(r.x)}px`, top = `${Math.round(r.y)}px`, side = String(lay.rects.get(id).side);
    if (el.style.left !== left) el.style.left = left;
    if (el.style.top !== top) el.style.top = top;
    if (el.dataset.side !== side) el.dataset.side = side;
  }
  // ---- S71-52: 상자 붙이기·떼기(보이는 자리만) ----
  // 늘 붙여 두는 상자: 고른 상자·새로 쓰는 상자·고치는 상자·초점 상자·끄는 상자·크기 바꾸는 상자·화살표로 옮기는 상자·선을 긋기 시작한 상자.
  function keepTexts() {
    const focus = document.activeElement?.closest?.('[data-nb-text]')?.dataset.nbText;
    return new Set([textSel, draft ? DRAFT : null, editing?.id, focus, tdrag?.id, rz?.kind === 'text' ? rz.id : null, nudge?.id, wire?.from].filter(Boolean));
  }
  function attachText(id) {
    if (textEls.has(id)) return textEls.get(id);
    const html = wantHtml.get(id); if (!html) return null;
    const host = lift && tdrag?.ids.has(id) ? lift : textsBox;
    // S71-52 ②: 멀리 보기 중에는 손잡이 없는 가벼운 모양으로 붙인다(손잡이는 작게 보일 때 어차피 숨김) — 다시 키우면 swapLight가 제 모양으로 바꾼다.
    const light = farStep !== null && wantNode.has(id) && id !== textSel && editing?.id !== id;
    host.insertAdjacentHTML('beforeend', light ? nodeHtml(wantNode.get(id), true) : html);
    const el = host.lastElementChild; if (light) el._nbLight = true; el.querySelectorAll('[data-nb-handle],[data-nb-resize]').forEach(h => h.addEventListener('click', stopClick));
    textEls.set(id, el); htmlOf.set(id, html);
    el.classList.toggle('nb-sel', id === textSel || (id === DRAFT && !!draft)); el.classList.toggle('nb-multi', multi.has(tKey(id)));
    if (tdrag?.moving && tdrag.ids.has(id)) el.classList.add('nb-dragging');
    if (focusSet?.has(id)) el.classList.add('nb-in-focus');
    if (lay.rects.has(id)) placeEl(id, el);
    return el;
  }
  function detachText(id) { const el = textEls.get(id); if (!el || editing?.el === el || el.contains(document.activeElement)) return; el.remove(); textEls.delete(id); htmlOf.delete(id); }
  // 그릴 영역: 보이는 영역 + 여유(화면 한 장 반쯤). force면 새로 고르고, 아니면 보이는 영역이 지난 영역 밖으로 나갈 때만.
  const containsRect = (a, b) => a && b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;
  function syncTexts(force = false) {
    const {w, h} = size();
    if (!allOn && (!w || !h)) { // 판이 안 보이는 동안(크기 0)은 아무것도 붙이지 않는다 — 보이면 ResizeObserver가 다시 고른다
      if (!force) return false;
      drawn = {x:0, y:0, w:0, h:0};
    } else {
      const tight = visibleArea(view, w, h, 40 / view.z);
      if (!force && containsRect(drawn, tight) && drawn.w) return false;
      drawn = allOn ? ALL : visibleArea(view, w, h, Math.max(w, h, 600) * 0.6 / view.z);
    }
    const keep = keepTexts();
    for (const id of [...textEls.keys()]) if (!textOn.has(id) || (!keep.has(id) && !rectsMeet(textRect(id), drawn))) detachText(id);
    for (const id of textOn) if (!textEls.has(id) && (keep.has(id) || rectsMeet(textRect(id), drawn))) attachText(id);
    return true;
  }
  function renderTexts() {
    const list = nodeList();
    tree = buildTree(branchReady() ? [...list, ...cardNodes(list)] : list, {free:branchReady()});
    zOf = zIndexes(list);
    const hidden = new Set(); for (const n of list) if (n.collapsed) for (const d of descendants(tree, n.id)) hidden.add(d);
    // 그린 모양이 그대로인 상자는 그 요소를 그대로 둔다(저장 답이 와도 초점·마우스 올림·끄는 손이 끊기지 않게). 바뀐 상자만 새로 만든다.
    const want = new Map(list.filter(t => !hidden.has(t.id)).map(t => [t.id, nodeHtml(t)]));
    wantHtml = want; textOn = new Set(want.keys()); wantNode = new Map(list.map(t => [t.id, t]));
    for (const [id, el] of textEls) if (editing?.el !== el && want.get(id) !== htmlOf.get(id)) { el.remove(); textEls.delete(id); htmlOf.delete(id); }
    // S71-52: 크기를 아직 모르는(새로 생겼거나 모양이 바뀐) 상자만 잠깐 붙여 잰다 — 한꺼번에 붙이고 한 번에 잰 뒤, 화면 밖은 relayout이 뗀다.
    // 가벼운 모양(손잡이 없음)을 잠깐 한 칸에 넣어 한 번에 재고 바로 뺀다. 화면에 보일 상자는 relayout(syncTexts)이 제 모양으로 붙인다.
    const fresh = [...want].filter(([id, html]) => !textEls.has(id) && textSize.get(id)?.html !== html);
    if (fresh.length) {
      const nodeOf = new Map(list.map(t => [t.id, t])), m = document.createElement('div');
      m.className = 'nb-measure'; m.setAttribute('aria-hidden', 'true');
      m.innerHTML = fresh.map(([id]) => nodeHtml(nodeOf.get(id), true)).join('');
      textsBox.append(m);
      [...m.children].forEach((el, i) => { const [id, html] = fresh[i]; textSize.set(id, {w:el.offsetWidth || 80, h:el.offsetHeight || 26, html}); });
      m.remove();
    }
    if (focusRoot && !tree.byId.has(focusRoot)) focusRoot = null; // 보던 가지가 지워짐 → 전체 보기
    focusSet = focusRoot ? focusIds(tree, focusRoot) : null;
    for (const [id, el] of textEls) { el.classList.toggle('nb-sel', id === textSel || (id === DRAFT && !!draft)); el.classList.toggle('nb-multi', multi.has(tKey(id))); el.classList.toggle('nb-in-focus', !!focusSet?.has(id)); }
    paintFocusBar();
    for (const id of [...textSize.keys()]) if (!want.has(id)) textSize.delete(id);
    box.dataset.nbTexts = String(want.size); // 그릴 상자 수(화면 밖 포함) — 시험·화면 읽기용
    relayout();
  }
  // 가지 선(부모 → 가지): 자동. 끄는 가지는 끄는 자리로.
  // S71-52: 그릴 영역(drawn)에 닿는 가지 선만 — 선 수천 개도 화면 밖은 만들지 않는다. 선 요소는 가지(아래 칸 id)마다 하나를 두고
  // 모양(d)·색이 바뀐 것만 고쳐 쓴다(끄는 동안 매번 통째로 새로 만들면 수백 개의 모양을 다시 계산한다).
  const branchEls = new Map();
  function paintBranches() {
    const want = new Set();
    for (const [id, r] of lay.rects) {
      const p = tree.parentOf.get(id); if (!p || !lay.rects.has(p) || places.has(id)) continue;
      const a = rectFor(p), b = textRect(id);
      if (drawn && id !== DRAFT && !rectsMeet({x:Math.min(a.x, b.x), y:Math.min(a.y, b.y), w:Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x), h:Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y)}, drawn)) continue;
      want.add(id);
      const tone = branchTone(tree, id), d = branchPath(a, b, r.side), cls = `nb-branch${id === DRAFT ? ' nb-branch-draft' : ''}${focusSet?.has(id) ? ' nb-in-focus' : ''}`;
      let el = branchEls.get(id);
      if (!el) { el = document.createElementNS('http://www.w3.org/2000/svg', 'path'); branchesBox.append(el); branchEls.set(id, el); }
      if (el.getAttribute('class') !== cls) el.setAttribute('class', cls);
      if (el.getAttribute('d') !== d) el.setAttribute('d', d);
      const t = tone != null ? String(tone) : null;
      if (el.getAttribute('data-tone') !== t) { if (t == null) el.removeAttribute('data-tone'); else el.setAttribute('data-tone', t); }
    }
    for (const [id, el] of branchEls) if (!want.has(id)) { el.remove(); branchEls.delete(id); }
  }
  // notes: 이 판의 노트(자리 계산은 전체로), visible: 그릴 노트 id(찾는 중이면 맞는 것만). folderOf(note) → 폴더 id 또는 null.
  // boardKey: 보드 id(보던 자리를 보드마다 기억), links: 이 보드의 선(parseLink 모양).
  // S71-50 NOTE-보드배경색: 이 보드의 바탕색 이름(note-boards-model.mjs BOARD_BGS) 또는 null(기본). 색 값은 CSS(basket.css .nb-scroll[data-nb-bg]) 한 곳.
  // 바탕만 바꾸므로 카드·선을 다시 그리지 않는다(고르는 중 끌기 등이 끊기지 않게). 내보내기는 이 판의 바탕색(exportSnapshot background)을 그대로 쓴다.
  function applyBg(bg) { if (bg) scroll.dataset.nbBg = bg; else delete scroll.dataset.nbBg; }
  function paint({notes, folderOf, colorOfFolder = () => null, visible = null, pickActive = false, isPicked = () => false, placeOf = undefined, removable = false, emptyText = '', boardKey = '', links:list = [], texts:textList = [], bg = null}) {
    applyBg(bg);
    if (drag) cancelDrag();
    if (wire) cancelWire();
    if (lend) cancelLineEnd();
    if (lmove) { lmove = null; dragOn(false); }
    if (tdrag) cancelTextDrag();
    if (bend) cancelBend();
    if (rz) cancelResize();
    flushNudge();
    const first = key !== boardKey;
    if (editing && (first || (!editing.isNew && !textList.some(t => t.id === editing.id)))) endEdit(false);
    if (first) { closeBar(); textSel = null; }
    if (relPick && (first || pickActive)) stopRelation(); // S71-53: 다른 보드·고르기 창이면 관계 잇기 그만
    const focused = document.activeElement?.closest?.('[data-nb-card]')?.dataset.nbCard, focusLine = document.activeElement?.closest?.('[data-nb-hit]')?.dataset.nbHit;
    const focusText = document.activeElement?.closest?.('.nb-tx') ? document.activeElement.closest('[data-nb-text]')?.dataset.nbText : null;
    opts = {visible, pickActive, removable};
    if (first) focusRoot = focusOf.get(boardKey) ?? null; // S71-52 ②: 보드마다 보던 가지(이번 접속만)
    key = boardKey;
    texts = textList; textById = new Map(textList.map(t => [t.id, t]));
    if (textSel && !textById.has(textSel)) textSel = null;
    places = layoutBoard(notes, folderOf, placeOf); shown = notes; byId = new Map(notes.map(n => [n.id, n]));
    infoOf = new Map(notes.map(n => { const fid = folderOf(n); return [n.id, {...cardText(n, fid), folderId:fid, color:fid ? colorOfFolder(fid) : null, picked:isPicked(n.id)}]; }));
    renderTexts(); // S71-51: 카드 아래 가지는 카드 자리로 배치하므로 카드 자리(places) 다음에
    links = list; linkOn = new Set(list.filter(lineOn).map(l => l.id)); indexLinks();
    if (selected && (!places.has(selected) || pickActive)) selected = null;
    if (first || pickActive) multi = new Set(); else multi = new Set([...multi].filter(okMulti));
    if (lineSel && !linkOn.has(lineSel)) closeLineMenu();
    empty.textContent = emptyText; empty.hidden = !emptyText || notes.length > 0 || texts.length > 0;
    for (const el of cardEls.values()) el.remove(); cardEls.clear();
    for (const [id, g] of lineEls) if (first || !linkOn.has(id)) { g.remove(); lineEls.delete(id); }
    for (const l of links) if (lineEls.has(l.id)) paintLine(l);
    if (first) { const saved = views.get(boardKey); if (saved) { view = saved; paintView(); sync(true); } else { paintView(); fitBoard(); sync(true); } }
    else { paintView(); sync(true); }
    paintSel(); paintFullTools(); paintTools();
    if (finds) setFind(finds); // 보드·주제가 바뀌면 찾은 주제도 다시
    if (focused) cardEls.get(focused)?.querySelector('.nb-open')?.focus({preventScroll:true});
    else if (focusLine) lineEls.get(focusLine)?.querySelector('.nb-hit')?.focus({preventScroll:true});
    else if (focusText) textEls.get(focusText)?.querySelector('.nb-tx')?.focus({preventScroll:true});
  }
  // S68-47: 연결선·글 상자만 바뀌었을 때(따로 읽은 답이 늦게 오거나 선·글 상자를 더하고 고친 뒤) 카드는 건드리지 않고 선·글 상자만 다시 그린다.
  // 판 전체 paint()는 끌던 카드를 취소하고 카드를 새로 만들므로, 보드가 뜨자마자 끌기 시작하면 늦게 온 답에 끌기가 끊겼다.
  // 카드 끌기·판 이동·두 손가락·선 긋기는 이어 가고, 바뀐 목록에 기대는 글 상자 끌기만 그만둔다(paint()와 같음).
  // S68-57: 곡선 끌기는 끌던 선이 새 목록에 그대로 있으면 이어 간다 — 다른 선의 저장 답(예: [직선으로])이 끄는 도중에 와도
  // 끌기가 끊기지 않게. 곡선은 움직일 때마다 지금 목록(links)·카드 자리로 다시 계산하므로(followBend) 새 목록으로 이어 가도 된다.
  // 끌던 선이 없어졌거나 아직 저장 중(pending)이면 지금처럼 그만둔다.
  function relink({links:list = [], texts:textList = []}) {
    if (tdrag) cancelTextDrag();
    if (rz?.kind === 'text' && !textList.some(t => t.id === rz.id)) cancelResize();
    if (bend && !list.some(l => l.id === bend.id && !l.pending)) cancelBend();
    if (lend && !list.some(l => l.id === lend.id && !l.pending)) cancelLineEnd();
    if (lmove && !list.some(l => l.id === lmove.id && !l.pending)) { lmove = null; dragOn(false); }
    if (editing && !editing.isNew && !textList.some(t => t.id === editing.id)) endEdit(false);
    texts = textList; textById = new Map(textList.map(t => [t.id, t]));
    if (textSel && !textById.has(textSel)) textSel = null;
    if (wire && !places.has(wire.from) && !textById.has(wire.from)) cancelWire();
    if (relPick && !places.has(relPick.from) && !textById.has(relPick.from)) stopRelation();
    const focusLine = document.activeElement?.closest?.('[data-nb-hit]')?.dataset.nbHit;
    const focusText = document.activeElement?.closest?.('.nb-tx') ? document.activeElement.closest('[data-nb-text]')?.dataset.nbText : null;
    renderTexts();
    if ([...multi].some(k => !okMulti(k))) setMulti(multi);
    links = list; linkOn = new Set(list.filter(lineOn).map(l => l.id)); indexLinks();
    if (lineSel && !linkOn.has(lineSel)) closeLineMenu();
    empty.hidden = !empty.textContent || shown.length > 0 || texts.length > 0;
    // S71-52: 선은 통째로 다시 만들지 않는다 — 없어진 선만 떼고 나머지는 바뀐 것만 고친다(저장 답마다 선 수백 개를 새로 만들지 않게).
    for (const [id, g] of lineEls) if (!linkOn.has(id)) { g.remove(); lineEls.delete(id); }
    for (const l of links) if (lineEls.has(l.id)) paintLine(l);
    sync(true);
    paintTools();
    if (finds) setFind(finds);
    queueMini();
    if (focusLine) lineEls.get(focusLine)?.querySelector('.nb-hit')?.focus({preventScroll:true});
    else if (focusText) textEls.get(focusText)?.querySelector('.nb-tx')?.focus({preventScroll:true});
  }
  // 화면 칸 좌표·판 좌표.
  const local = e => { const r = scroll.getBoundingClientRect(); return {x:e.clientX - r.left, y:e.clientY - r.top}; };
  const pointOf = e => { const p = local(e); return toBoard(view, p.x, p.y); };
  const raise = (card, z) => { card.style.zIndex = String(z + 1); };
  const stopClick = e => { e.preventDefault(); e.stopPropagation(); };
  const dragOn = on => document.documentElement.classList.toggle('nb-drag-on', on);

  // ---- 고르기 ----
  function selectText(id) {
    if (textSel === id) return;
    textEls.get(textSel)?.classList.remove('nb-sel');
    if (textSel !== id) barOpen = null;
    textSel = id; if (id) { select(null, {keepText:true}); (textOn.has(id) ? attachText(id) : null)?.classList.add('nb-sel'); }
    placeBar(); paintRelFocus();
  }
  const focusNode = id => { const el = (textOn.has(id) ? attachText(id) : null)?.querySelector('.nb-tx'); if (el) { el.focus({preventScroll:true}); keepNodeVisible(id); } else selectText(id); }; // S71-52: 화면 밖 상자면 붙인 뒤
  function keepNodeVisible(id) {
    const r = textRect(id), {w, h} = size(), x = r.x * view.z + view.x, y = r.y * view.z + view.y, rw = r.w * view.z, rh = r.h * view.z;
    const dx = x < 12 ? 12 - x : x + rw > w - 12 ? Math.max(12 - x, w - 12 - x - rw) : 0, dy = y < 48 ? 48 - y : y + rh > h - 12 ? Math.max(48 - y, h - 12 - y - rh) : 0;
    if (dx || dy) setView({...view, x:view.x + dx, y:view.y + dy});
  }

  // ---- 고른 상자 위 작은 막대(색·모양·글자 크기·가지 더하기·삭제) ----
  // 상자 칸 + 보이는 연결점 동그라미의 잡는 범위(::after)까지 덮는 화면 사각형.
  function reachRect(el) {
    const r = el.getBoundingClientRect(); let top = r.top, bottom = r.bottom, left = r.left, right = r.right;
    for (const h of el.querySelectorAll('[data-nb-handle]')) {
      if (!h.getClientRects().length) continue;
      const hr = h.getBoundingClientRect(), pad = (parseFloat(getComputedStyle(h, '::after').width) || hr.width) / 2, cx = hr.left + hr.width / 2, cy = hr.top + hr.height / 2;
      top = Math.min(top, cy - pad); bottom = Math.max(bottom, cy + pad); left = Math.min(left, cx - pad); right = Math.max(right, cx + pad);
    }
    return {top, bottom, left, right, width:right - left, height:bottom - top};
  }
  function placeBar() {
    if (!bar) return;
    const el = textSel && textEls.get(textSel), t = textSel && textById.get(textSel);
    const show = !!(el && t && !t.pending && !editing && !(tdrag && tdrag.moving) && !rz && !opts.pickActive && !wire && el.isConnected && multi.size < 2);
    if (!show) { if (!bar.hidden) { bar.hidden = true; barOpen = null; } return; }
    const map = mapReady(), decor = map && decorReady(), free = isFree(t), shapeFor = t.kind === 'shape' ? 'shape' : 'topic';
    bar.querySelectorAll('[data-nb-map]').forEach(b => { b.hidden = !map; });
    bar.querySelectorAll('[data-nb-decor]').forEach(b => { b.hidden = !decor; });
    // 글자는 모양 없음. 도형은 도형 모양, 상자는 상자 모양.
    bar.querySelectorAll('[data-nb-bar-child],[data-nb-bar-sibling]').forEach(b => { b.hidden = !map || !canGrow(t); }); // S71-51: 모든 칸이 가지를 낸다(서버 칸이 있을 때)
    const cell = isCellKind(t.kind); // S71-56: 표 = [표 ⋯]·[수정], 파일 = [열기](모양 없음)
    bar.querySelector('[data-nb-bar-open="shape"]').hidden = !map || t.kind === 'label' || cell || (t.kind === 'shape' && !decor);
    bar.querySelector('[data-nb-bar-open="table"]').hidden = t.kind !== 'table' || !cellsReady();
    bar.querySelector('[data-nb-file-open]').hidden = t.kind !== 'file';
    bar.querySelector('[data-nb-bar-edit]').hidden = t.kind === 'file';
    if ((barOpen === 'table' && t.kind !== 'table') || (barOpen === 'shape' && cell)) barOpen = null;
    bar.querySelectorAll('[data-nb-shape-for]').forEach(b => { b.hidden = b.dataset.nbShapeFor !== shapeFor; });
    if (barOpen === 'shape' && t.kind === 'label') barOpen = null;
    bar.querySelectorAll('[data-nb-tbl]').forEach(b => { const {rows, cols} = tableSize(t.cells); b.disabled = t.kind !== 'table' || (b.dataset.nbTbl === 'row+' && rows >= ROWS_MAX) || (b.dataset.nbTbl === 'col+' && cols >= COLS_MAX) || (b.dataset.nbTbl === 'row-' && rows <= 1) || (b.dataset.nbTbl === 'col-' && cols <= 1); });
    bar.querySelectorAll('[data-nb-bar-row]').forEach(r => { r.hidden = !map || r.dataset.nbBarRow !== barOpen; });
    bar.querySelectorAll('[data-nb-stroke]').forEach(b => setSwatchOn(b, String(t.stroke ?? '') === b.dataset.nbStroke));
    bar.querySelectorAll('[data-nb-ink]').forEach(b => setSwatchOn(b, String(t.ink ?? '') === b.dataset.nbInk));
    bar.querySelectorAll('[data-nb-sw]').forEach(b => b.setAttribute('aria-pressed', String(t.stroke_w === Number(b.dataset.nbSw))));
    bar.querySelectorAll('[data-nb-alpha]').forEach(b => b.setAttribute('aria-pressed', String((t.alpha ?? 100) === Number(b.dataset.nbAlpha))));
    bar.querySelectorAll('[data-nb-align]').forEach(b => b.setAttribute('aria-pressed', String(t.align === b.dataset.nbAlign)));
    bar.querySelector('[data-nb-dash]').setAttribute('aria-pressed', String(!!t.dash));
    bar.querySelector('[data-nb-bold]').setAttribute('aria-pressed', String(!!t.bold));
    bar.querySelectorAll('[data-nb-bar-open]').forEach(b => b.setAttribute('aria-expanded', String(b.dataset.nbBarOpen === barOpen)));
    bar.querySelectorAll('[data-nb-tone]').forEach(b => setSwatchOn(b, String(t.color ?? '') === b.dataset.nbTone));
    bar.querySelectorAll('[data-nb-shape]').forEach(b => b.setAttribute('aria-pressed', String(t.shape === b.dataset.nbShape)));
    bar.querySelector('[data-nb-font="-1"]').disabled = t.font <= FONT_MIN;
    bar.querySelector('[data-nb-font="1"]').disabled = t.font >= FONT_MAX;
    // [더 보기] 줄: 손으로 둔 가지 → [자동 배치로], 손으로 정한 크기 → [크기 자동], 가지 → [가지 떼기]. 해당 없는 것은 빼고, 셋 다 없으면 [더 보기]도 뺀다.
    const branch = tree.parentOf.has(t.id), rels = relationReady() ? relationCount(t.id) : 0, more = {auto:branch && t.pinned && frameReady(), autosize:!!(t.w || t.h), detach:branch, decor, toNote:canNote(t), rel:relationReady(), mat:materialReady() && !!onMaterialPick, focus:childrenOf(tree, t.id).length > 0 && focusRoot !== t.id};
    bar.querySelector('[data-nb-focus]').hidden = !more.focus;
    bar.querySelector('[data-nb-to-note]').hidden = !more.toNote;
    bar.querySelector('[data-nb-relate]').hidden = !more.rel; // S71-53
    bar.querySelector('[data-nb-material]').hidden = !more.mat; // S71-54
    const relBtn = bar.querySelector('[data-nb-relations]'); relBtn.hidden = !rels; if (rels) relBtn.textContent = `관계 ${rels}개`;
    bar.querySelector('[data-nb-auto]').hidden = !more.auto;
    bar.querySelector('[data-nb-autosize]').hidden = !more.autosize;
    bar.querySelector('[data-nb-detach]').hidden = !more.detach;
    bar.querySelector('[data-nb-bar-open="more"]').hidden = !map || !Object.values(more).some(Boolean);
    if (barOpen === 'more' && !Object.values(more).some(Boolean)) { barOpen = null; bar.querySelector('[data-nb-bar-row="more"]').hidden = true; }
    bar.hidden = false;
    // S70-77: 막대는 연결점 동그라미(잡는 범위까지)를 가리지 않게 그 바깥에 선다 — 폰에서 위·아래 동그라미를 막대가 덮어 선을 못 긋던 것.
    const sr = scroll.getBoundingClientRect(), r = reachRect(el), bw = bar.offsetWidth, bh = bar.offsetHeight;
    const left = Math.max(4, Math.min(sr.width - bw - 4, r.left - sr.left + r.width / 2 - bw / 2));
    let top = r.top - sr.top - bh - 4; if (top < 4) top = r.bottom - sr.top + 4;
    bar.style.left = `${Math.round(left)}px`; bar.style.top = `${Math.round(Math.min(top, sr.height - bh - 4))}px`;
  }
  function closeBar() { barOpen = null; if (bar) bar.hidden = true; }
  function barAction(b) {
    const id = textSel, t = id && textById.get(id); if (!t || t.pending) return;
    if (b.dataset.nbBarOpen) { barOpen = barOpen === b.dataset.nbBarOpen ? null : b.dataset.nbBarOpen; placeBar(); return; }
    if (b.hasAttribute('data-nb-bar-del')) { void removeNode(id, b); return; }
    if (b.hasAttribute('data-nb-bar-child')) { addChild(id); return; }
    if (b.hasAttribute('data-nb-bar-sibling')) { addSibling(id); return; }
    if (b.hasAttribute('data-nb-bar-edit')) { startEdit(id); return; }
    if (b.hasAttribute('data-nb-file-open')) { openFile(id); return; } // S71-56
    if (b.dataset.nbTbl) { tableOp(id, b.dataset.nbTbl); return; } // S71-56
    if (b.hasAttribute('data-nb-to-note')) { barOpen = null; textToNote(id); return; }
    if (b.hasAttribute('data-nb-relate')) { barOpen = null; startRelation(id); return; } // S71-53
    if (b.hasAttribute('data-nb-relations')) { openRelations(id, b); return; }
    if (b.hasAttribute('data-nb-material')) { barOpen = null; pickMaterial(id, b); return; } // S71-54
    if (b.hasAttribute('data-nb-focus')) { barOpen = null; focusBranch(id); return; }
    if (!canMap()) return;
    if (b.hasAttribute('data-nb-dup')) { // 복제: 같은 꾸미기·크기, 조금 옆에, 맨 앞(가지는 혼자 선 칸으로)
      const r = lay.rects.get(id), base = r && tree.parentOf.has(id) ? {...t, x:Math.round(r.x), y:Math.round(r.y)} : t;
      if (texts.length >= TEXT_LIMIT) { toast(`상자는 한 보드에 ${TEXT_LIMIT}개까지 만들 수 있어요.`); return; }
      void Promise.resolve(onTextAdd(duplicateSpec(base, texts))).then(saved => { if (saved && textOn.has(saved.id)) { clearMulti(); selectText(saved.id); } });
      return;
    }
    if (b.hasAttribute('data-nb-auto')) { barOpen = null; if (t.pinned) onTextChange(id, {pinned:false}); return; }
    if (b.hasAttribute('data-nb-autosize')) { barOpen = null; if (t.w || t.h) onTextChange(id, {w:null, h:null}); return; }
    if (b.hasAttribute('data-nb-detach')) { // 가지 → 혼자 선 상자(지금 보이는 자리 그대로)
      const r = lay.rects.get(id); barOpen = null; if (!tree.parentOf.has(id) || !r) return;
      onTextChange(id, {parent_id:null, side:null, pinned:false, x:clampCoord(r.x), y:clampCoord(r.y)}); return;
    }
    let patch = null;
    const num = v => (v === '' ? null : Number(v));
    if (b.dataset.nbTone !== undefined) patch = {color:num(b.dataset.nbTone)};
    else if (b.dataset.nbStroke !== undefined) patch = {stroke:num(b.dataset.nbStroke)};
    else if (b.dataset.nbInk !== undefined) patch = {ink:num(b.dataset.nbInk)};
    else if (b.dataset.nbSw) patch = {stroke_w:t.stroke_w === Number(b.dataset.nbSw) ? null : Number(b.dataset.nbSw)};
    else if (b.dataset.nbAlpha) patch = {alpha:Number(b.dataset.nbAlpha) >= 100 ? null : Number(b.dataset.nbAlpha)};
    else if (b.dataset.nbAlign) patch = {align:t.align === b.dataset.nbAlign ? null : b.dataset.nbAlign};
    else if (b.hasAttribute('data-nb-dash')) patch = {dash:!t.dash};
    else if (b.hasAttribute('data-nb-bold')) patch = {bold:!t.bold};
    else if (b.dataset.nbZ) { const z = Number(b.dataset.nbZ) > 0 ? zFront(texts, id) : zBack(texts, id); if (z === null) return; patch = {z}; }
    else if (b.dataset.nbShape) patch = {shape:b.dataset.nbShape};
    else if (b.dataset.nbFont) patch = {font:stepFont(t.font, Number(b.dataset.nbFont))};
    if (!patch || Object.entries(patch).every(([k, v]) => t[k] === v)) return;
    onTextChange(id, patch);
  }
  function select(id, {keepText = false} = {}) {
    if (!keepText && textSel) selectText(null);
    if (selected === id) return;
    const old = selected && cardEls.get(selected); old?.classList.remove('nb-sel');
    selected = id;
    if (id) { if (!cardEls.has(id)) addCard(id); cardEls.get(id)?.classList.add('nb-sel'); }
    paintRelFocus();
  }
  // ---- 여러 장 고르기(S69-33, S69-88: 상자도 — 고른 상태 multi 하나에 카드 id와 't:' + 상자 id) ----
  const selBar = box.querySelector('[data-nb-selbar]');
  const multiCards = () => [...multi].filter(k => !k.startsWith('t:'));
  const multiTexts = () => [...multi].filter(k => k.startsWith('t:')).map(k => k.slice(2));
  const okMulti = k => (k.startsWith('t:') ? textById.has(k.slice(2)) && !textById.get(k.slice(2)).pending && textOn.has(k.slice(2)) : places.has(k) && isShown(k));
  function paintSel() {
    for (const [id, el] of cardEls) el.classList.toggle('nb-multi', multi.has(id));
    for (const [id, el] of textEls) el.classList.toggle('nb-multi', multi.has(tKey(id)));
    selBar.hidden = !multi.size;
    if (multi.size) selBar.querySelector('[data-nb-sel-count]').textContent = `${multi.size}개 선택`;
    selBar.querySelector('[data-nb-sel-remove]').hidden = !opts.removable || !onRemove || !multiCards().length;
  }
  function setMulti(next) {
    multi = new Set([...next].filter(okMulti));
    if (multi.size > 1 && selected && !multi.has(selected)) select(null);
    if (multi.size > 1 && textSel && !multi.has(tKey(textSel))) selectText(null);
    paintSel();
  }
  const toggleMulti = id => { const next = new Set(multi); if (!next.size && selected && selected !== id) next.add(selected); if (next.has(id)) next.delete(id); else next.add(id); setMulti(next); };
  const clearMulti = () => { if (multi.size) setMulti(new Set()); };
  function removeMulti() {
    if (onRemoveItems) { void removeItems(selection()); return; }
    const ids = multiCards(); if (!ids.length || !opts.removable || !onRemove) return;
    multi = new Set(); select(null); paintSel(); onRemove(ids);
  }
  // ---- S70-03 고른 것 지우기(Delete·Backspace·우클릭 [삭제]·고르기 막대): 상자(아래 가지째)·글자·도형·선·카드(보드에서 빼기, 노트는 그대로) ----
  // 지운 뒤 알림 한 줄 + [되돌리기](공용 small-notice — Ctrl+Z도 같은 되돌리기). 서버 저장 길은 부르는 쪽(onRemoveItems) 하나.
  const selection = () => (multi.size ? {cards:multiCards(), texts:multiTexts(), links:[]}
    : {cards:selected ? [selected] : [], texts:textSel ? [textSel] : [], links:lineSel ? [lineSel] : []});
  async function removeItems({cards:cIds = [], texts:tIds = [], links:lIds = []} = {}) {
    if (!onRemoveItems || opts.pickActive) return false;
    const cards = (opts.removable ? cIds : []).filter(id => places.has(id)).map(id => { const {saved:_s, ...place} = places.get(id); return {id, place}; });
    const ts = tIds.filter(id => textById.has(id) && !textById.get(id).pending), ls = lIds.filter(id => links.some(l => l.id === id && !l.pending));
    const n = cards.length + ts.length + ls.length; if (!n) return false;
    if (editing) void endEdit(true);
    if (textSel && ts.includes(textSel)) { textSel = null; closeBar(); }
    if (lineSel && ls.includes(lineSel)) closeLineMenu();
    multi = new Set(); if (selected && cards.some(c => c.id === selected)) select(null); paintSel();
    const undo = await onRemoveItems({cards, texts:ts, links:ls});
    if (!undo) return false;
    const onlyCards = cards.length === n;
    notify(onlyCards ? (n === 1 ? '보드에서 뺐어요' : `보드에서 ${n}개 뺐어요`) : n === 1 ? '삭제했어요' : `${n}개 삭제했어요`,
      {label:onlyCards ? `보드에서 빼기 ${n}개` : `보드에서 삭제 ${n}개`, undo});
    return true;
  }
  // 왼쪽 목록에서 이미 붙은 노트를 누름 → 그 카드가 가운데 오게 옮기고 잠깐 강조(고르기).
  function focusCard(id) {
    const p = places.get(id); if (!p) return false;
    const {w, h} = size(); setView(centerOn(view, cardRect(p), w, h)); sync(true);
    clearMulti(); select(id);
    const el = cardEls.get(id); if (!el) return true;
    el.classList.remove('nb-flash'); void el.offsetWidth; el.classList.add('nb-flash');
    setTimeout(() => el.classList.remove('nb-flash'), 1400);
    el.querySelector('.nb-open')?.focus({preventScroll:true});
    return true;
  }
  // 지금 보이는 판 가운데(판 좌표) — 폰 고르기 창으로 붙일 때 첫 장 자리.
  const centerPoint = () => { const {w, h} = size(); return toBoard(view, w / 2, h / 2); };
  // PC 마우스 빈 곳 끌기 = 사각형 고르기(공용 marquee-select.js). 고른 상태 주인은 위 multi 하나.
  const BLANK_SKIP = '[data-nb-card],[data-nb-text],[data-nb-hit],[data-nb-lend],[data-nb-handle],[data-nb-resize],.nb-insert,.nb-tools,.nb-selbar,.nb-node-bar,input,textarea,[contenteditable]';
  const marquee = bindMarquee(scroll, {
    enabled:() => !opts.pickActive && !spaceDown && !drag && !tdrag && !wire && !rz && !lend && !lmove && !pinch && !editing && !(pan && pan.moved),
    blank:t => !t.closest(BLANK_SKIP),
    items:() => [...cardEls.values(), ...[...textEls].filter(([id]) => id !== DRAFT && !textById.get(id)?.pending).map(([, el]) => el)].filter(el => el.isConnected),
    keyOf:el => el.dataset.nbCard || tKey(el.dataset.nbText),
    begin:additive => { closeLineMenu(); if (!additive) { select(null); selectText(null); } return additive ? [...multi, ...(selected ? [selected] : []), ...(textSel ? [tKey(textSel)] : [])] : []; },
    onChange:set => setMulti(set),
  });

  // ---- 카드 끌기(폰: 바로 끌기·꾹 누른 뒤 끌기 둘 다, 꾹 누르고 떼면 고르기만) ----
  function cancelDrag() {
    if (!drag) return;
    clearTimeout(drag.timer); stopEdge(); paintGuides([]);
    const {card, place, id, group = [], textIds} = drag; drag = null; dragOn(false);
    card.classList.remove('nb-dragging', 'nb-held'); card.style.left = `${place.x}px`; card.style.top = `${place.y}px`; raise(card, place.z);
    repaintLinesOf(id);
    for (const g of group) { const el = cardEls.get(g.id); if (el) { el.classList.remove('nb-dragging'); el.style.left = `${g.place.x}px`; el.style.top = `${g.place.y}px`; } repaintLinesOf(g.id); }
    if (textIds?.size) { for (const t of textIds) textEls.get(t)?.classList.remove('nb-dragging'); placeEls(); paintBranches(); for (const t of textIds) repaintLinesOf(t); }
  }
  // 맞춤선(스마트 가이드): 끄는 칸(판 좌표)을 다른 보이는 칸(카드·상자, skip 빼고) 선에 붙일 만큼과 그 선. 판 배율과 무관하게 화면 SNAP_PX 안.
  function snapFor(rect, skip) {
    const others = [];
    for (const [id] of cardEls) if (!skip.has(id) && places.has(id) && isShown(id)) others.push(rectOf(places.get(id)));
    for (const [id, r] of lay.rects) if (!skip.has(tKey(id)) && id !== DRAFT && textEls.has(id)) others.push(r);
    return snapMove(rect, others, SNAP_PX / view.z);
  }
  // S71-52: 맞춤선은 미리 만든 선 몇 개의 값만 고친다(넣고 빼면 화면 전체 규칙(:has)이 다시 계산돼 큰 보드에서 끄는 동안 끊겼다).
  const guidePool = [];
  function paintGuides(list) {
    while (guidePool.length < list.length) { const l = document.createElementNS('http://www.w3.org/2000/svg', 'line'); l.setAttribute('class', 'nb-guide'); l.setAttribute('visibility', 'hidden'); guidesBox.append(l); guidePool.push(l); }
    guidePool.forEach((l, i) => {
      const g = list[i];
      if (!g) { if (l.getAttribute('visibility') !== 'hidden') l.setAttribute('visibility', 'hidden'); return; }
      for (const k of ['x1', 'y1', 'x2', 'y2']) { const v = String(Math.round(g[k])); if (l.getAttribute(k) !== v) l.setAttribute(k, v); }
      if (l.getAttribute('visibility') === 'hidden') l.removeAttribute('visibility');
    });
  }
  function follow() {
    const p = pointOf(drag.last);
    let nx = clampCoord(drag.place.x + p.x - drag.start.x), ny = clampCoord(drag.place.y + p.y - drag.start.y);
    const s = drag.last.altKey ? {dx:0, dy:0, guides:[]} : snapFor({...rectOf(drag.place), x:nx, y:ny}, drag.skip); // Alt = 맞춤선에 붙지 않음
    nx = clampCoord(nx + s.dx); ny = clampCoord(ny + s.dy); paintGuides(s.guides);
    drag.now = {...drag.place, x:nx, y:ny};
    drag.card.style.left = `${nx}px`; drag.card.style.top = `${ny}px`;
    repaintLinesOf(drag.id);
    for (const g of drag.group || []) {
      const gx = clampCoord(g.place.x + nx - drag.place.x), gy = clampCoord(g.place.y + ny - drag.place.y), el = cardEls.get(g.id);
      g.now = {x:gx, y:gy}; if (el) { el.style.left = `${gx}px`; el.style.top = `${gy}px`; el.classList.add('nb-dragging'); }
      repaintLinesOf(g.id);
    }
    if (drag.textIds?.size) { placeEls(); paintBranches(); for (const t of drag.textIds) { textEls.get(t)?.classList.add('nb-dragging'); repaintLinesOf(t); } }
  }
  function finishDrag(e) {
    const d = drag; stopEdge(); clearTimeout(d.timer);
    if (d.moving) follow();
    drag = null; dragOn(false); paintGuides([]);
    d.card.classList.remove('nb-dragging', 'nb-held');
    for (const g of d.group || []) cardEls.get(g.id)?.classList.remove('nb-dragging');
    for (const t of d.textIds || []) textEls.get(t)?.classList.remove('nb-dragging');
    if (!d.moving) {
      if (d.held) suppressUntil = Date.now() + 600;
      // 폰: 여러 장 고르는 중이면 짧게 누르기 = 더하기·빼기(열지 않음).
      else if (d.touch && multi.size && e.type !== 'pointercancel') { suppressUntil = Date.now() + 600; toggleMulti(d.id); }
      return; // 짧게 누르고 뗌 = 열기(click이 맡는다)
    }
    suppressUntil = Date.now() + 400;
    const dx = d.now.x - d.place.x, dy = d.now.y - d.place.y, top = topZ(places), next = movedTo(d.place, dx, dy, top);
    const before = new Map(places); // 옮기기 전 자리(아직 저장 안 된 칸은 이 자리로 함께 저장)
    places.set(d.id, {...next, saved:true});
    d.card.style.left = `${next.x}px`; d.card.style.top = `${next.y}px`; raise(d.card, next.z);
    repaintLinesOf(d.id);
    // 함께 옮긴 카드들: 같은 만큼, 순서는 그 위로. 먼저 저장하는 한 번(before)에 함께 옮긴 카드의 새 자리를 넣어 옛 자리로 덮어쓰지 않게 한다.
    const moved = (d.group || []).map((g, i) => [g.id, movedTo(g.place, dx, dy, next.z + i)]);
    for (const [gid, gp] of moved) { places.set(gid, {...gp, saved:true}); const el = cardEls.get(gid); if (el) { el.style.left = `${gp.x}px`; el.style.top = `${gp.y}px`; raise(el, gp.z); } repaintLinesOf(gid); }
    for (const [gid, gp] of moved) before.set(gid, {...gp, saved:true});
    onMove(d.id, next, before);
    for (const [gid, gp] of moved) onMove(gid, gp, new Map());
    if (d.textIds?.size) moveTexts(multiTexts(), dx, dy); // 함께 고른 상자도 같은 만큼
  }
  // 상자 옮기기 저장: 뿌리 = 자기 자리, 가지 = 손으로 둔 자리(pinned, 틀 칸이 없는 서버면 건너뜀). 고른 것 안에 위 상자가 함께 있으면 위 상자와 함께 간다.
  // 아래에 손으로 둔 가지가 있으면 그것도 같은 만큼(나무째 옮기기).
  function movePatches(ids, dx, dy) {
    const set = new Set(ids), out = new Map(), clampXY = (x, y) => ({x:clampCoord(x), y:clampCoord(y)});
    const inside = id => { let p = tree.parentOf.get(id); while (p) { if (set.has(p)) return true; p = tree.parentOf.get(p); } return false; };
    for (const id of set) {
      const t = textById.get(id), r = lay.rects.get(id); if (!t || t.pending || !r || inside(id)) continue;
      if (!tree.parentOf.has(id)) out.set(id, clampXY(t.x + dx, t.y + dy));
      else if (frameReady()) out.set(id, {pinned:true, ...clampXY(r.x + dx, r.y + dy)});
      else continue;
      for (const k of descendants(tree, id)) { const kt = textById.get(k); if (kt?.pinned && !out.has(k)) out.set(k, clampXY(kt.x + dx, kt.y + dy)); }
    }
    return [...out].map(([id, patch]) => ({id, patch}));
  }
  function moveTexts(ids, dx, dy) {
    const items = movePatches(ids, dx, dy).filter(({id, patch}) => { const t = textById.get(id); return Object.entries(patch).some(([k, v]) => t[k] !== v); });
    if (!items.length) { relayout(); return; }
    if (items.length === 1) onTextChange(items[0].id, items[0].patch); else onTextsChange(items);
  }

  // ---- 연결선 끌기(손잡이 → 다른 카드·상자) ----
  // S69-82: 놓을 끝을 끄는 동안 강조하고(nb-target), 칸 밖이어도 가까우면(화면 24px) 그 끝에 붙인다. 빈 곳에 놓으면 그 자리 새 상자 + 선.
  function cancelWire() { if (!wire) return; stopEdge(); markTarget(null); wire.grip?.classList.remove('nb-h-on'); wire = null; temp.setAttribute('d', ''); temp.setAttribute('hidden', ''); box.classList.remove('nb-wiring', 'nb-wiring-rel'); dragOn(false); placeBar(); paintDraftLink(); }
  // S70-77: 놓기 전 Esc = 긋기 취소(아무것도 안 생김). 그 뒤 손을 떼도 아무것도 하지 않는다(긋기가 이미 끝남).
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && wire) { e.preventDefault(); e.stopPropagation(); cancelWire(); } }, true);

  // ---- S71-53 관계선: 잇기·고르기·찾기·따라가기·이름 ----
  const endKind = id => (places.has(id) ? 'note' : 'text');
  const isCell = id => !!id && (places.has(id) ? isShown(id) : textById.has(id) && !textById.get(id).pending);
  function addRelation(from, to) {
    if (!isCell(from) || !isCell(to) || from === to) return false;
    if (!relationReady()) { canRelation(); return false; }
    if (linkedEither(links, key, from, to)) { toast('이미 이어져 있어요.'); return false; }
    if (links.length >= LINK_LIMIT) { toast(`연결선은 한 보드에 ${LINK_LIMIT}개까지 그을 수 있어요.`); return false; }
    onLinkAdd(relationSpec(key, {kind:endKind(from), id:from}, {kind:endKind(to), id:to}));
    return true;
  }
  const relationCount = id => relationsOf(links, key, id).length;
  // 칸 하나를 잠깐 강조(노트 카드·상자 같은 모양).
  function flashCell(id) {
    const el = places.has(id) ? cardEls.get(id) : textEls.get(id); if (!el) return;
    el.classList.remove('nb-flash'); void el.offsetWidth; el.classList.add('nb-flash');
    setTimeout(() => el.classList.remove('nb-flash'), 1400);
  }
  // 그 칸이 지금 화면 안에 다 보이나(판 좌표 사각형 ⊂ 보이는 영역).
  function cellSeen(id) {
    if (!id) return true;
    const r = rectFor(id), {w, h} = size(), a = visibleArea(view, w, h, 0);
    return r.x >= a.x && r.y >= a.y && r.x + r.w <= a.x + a.w && r.y + r.h <= a.y + a.h;
  }
  // 상대 칸으로 화면 이동 + 잠깐 강조 + 고르기. 접힌 가지 안 칸이면 그 칸을 덮은 접힌 칸으로.
  function goToCell(id) {
    const at = id && textById.has(id) && lay.hidden.has(id) ? gatherEnd(id, tree.parentOf, lay.hidden) : id;
    if (!isCell(at)) return false;
    const {w, h} = size(); setView(centerOn(view, rectFor(at), w, h)); sync(true);
    closeLineMenu(); clearMulti();
    if (places.has(at)) { select(at); cardEls.get(at)?.querySelector('.nb-open')?.focus({preventScroll:true}); }
    else { attachText(at); selectText(at); textEls.get(at)?.querySelector('.nb-tx')?.focus({preventScroll:true}); }
    flashCell(at);
    return true;
  }
  const relBar = box.querySelector('[data-nb-relbar]');
  function startRelation(id) {
    if (!isCell(id) || opts.pickActive) return false;
    if (!relationReady()) { canRelation(); return false; }
    if (relPick) stopRelation();
    cancelWire(); closeLineMenu(); closeBar(); clearMulti();
    relPick = {from:id, layer:null};
    (places.has(id) ? cardEls.get(id) : textEls.get(id))?.classList.add('nb-rel-from');
    relBar.querySelector('[data-nb-rel-msg]').textContent = `${short(endTitle(id).replace(/^상자 /, ''), 14)} — 이을 칸을 누르세요`;
    relBar.hidden = false; box.classList.add('nb-rel-picking');
    relPick.layer = window.KPTURouter?.layer?.open('note-board-relation', {close:() => { if (relPick) relPick.layer = null; stopRelation(); return true; }}) || null;
    relBar.querySelector('[data-nb-rel-find]').focus({preventScroll:true});
    return true;
  }
  function stopRelation() {
    if (!relPick) return;
    const p = relPick; relPick = null; relBar.hidden = true; box.classList.remove('nb-rel-picking');
    box.querySelectorAll('.nb-rel-from').forEach(el => el.classList.remove('nb-rel-from'));
    p.layer?.close();
  }
  function finishRelation(id) {
    if (!relPick || id === relPick.from) return;
    const from = relPick.from; stopRelation();
    if (addRelation(from, id)) flashCell(id);
  }
  // [찾기]: 글자로 이 보드의 칸을 찾아 고른다(멀리 떨어진·접힌 칸도).
  async function findForRelation(btn) {
    if (!relPick) return;
    const word = await askText(btn, {text:'이을 칸 찾기', placeholder:'칸 글자', max:40});
    if (word == null || !relPick) return;
    const cells = [...texts.filter(t => !t.pending && textOfCell(t).trim()).map(t => ({id:t.id, text:textOfCell(t)})),
      ...shown.filter(n => isShown(n.id) && infoOf.get(n.id) && !infoOf.get(n.id).locked).map(n => ({id:n.id, text:endTitle(n.id)}))];
    const hits = findCells(cells, word, {skip:relPick.from});
    if (!hits.length) { toast('맞는 칸이 없어요.'); return; }
    openRowMenu(btn, {key:'nb-rel-find', label:'이을 칸', items:hits.map(c => ({id:c.id, label:short(c.text, 30)})), run:id => finishRelation(id)});
  }
  // 칸의 관계 목록 → 하나를 누르면 그 상대 칸으로.
  function openRelations(id, el, at = null) {
    const list = relationsOf(links, key, id);
    if (!list.length) { toast('이 칸에 이어진 관계선이 없어요.'); return false; }
    const anchor = el || (places.has(id) ? cardEls.get(id) : textEls.get(id)) || box;
    openRowMenu(anchor, {key:`nb-rels:${id}`, label:`관계 ${list.length}개`, at, items:list.map(r => ({id:r.link.id, label:`${DIR_MARK[r.dir]} ${short(endTitle(r.other).replace(/^상자 /, ''), 24) || '칸'}${r.link.label ? ` · ${r.link.label}` : ''}`})),
      run:lid => { const r = list.find(k => k.link.id === lid); if (r) goToCell(r.other); }});
    return true;
  }
  // 관계선 이름: 자주 쓴 이름 고르기 · 직접 쓰기 · 지우기.
  async function nameRelation(l, x, y) {
    const now = links.find(k => k.id === l.id); if (!now || now.pending) return;
    const anchor = lineEls.get(now.id)?.querySelector('.nb-hit') || scroll;
    const write = async () => {
      const typed = await askText(anchor, {text:`관계 이름 (${LABEL_MAX}자까지, 비우면 없음)`, value:now.label || '', placeholder:'예: 원인', max:LABEL_MAX});
      if (typed === null) return;
      let label; try { label = validateLabel(typed); } catch (err) { toast(err.message); return; }
      if (label !== (now.label ?? null)) onLinkChange(now.id, {label});
    };
    const names = relationNames(allLinks ? allLinks() : links).filter(n => n !== now.label);
    if (!names.length) { await write(); return; }
    openRowMenu(anchor, {key:`nb-rel-name:${now.id}`, label:'관계 이름', at:{x, y}, items:[...names.map((n, i) => ({id:`n${i}`, label:n})), {id:'write', label:'직접 쓰기', sep:true}, now.label && {id:'clear', label:'이름 삭제'}],
      run:item => {
        if (item === 'write') { void write(); return; }
        if (item === 'clear') { onLinkChange(now.id, {label:null}); return; }
        const name = names[Number(String(item).slice(1))]; if (name && name !== now.label) onLinkChange(now.id, {label:name});
      }});
  }
  // 선을 짧게 누름: 관계선이면 두 번 누르기 = 이름, 한쪽 끝 근처(반대쪽 끝이 화면 밖) = 상대 칸으로, 그 밖 = 선 메뉴.
  function lineTap(id, e) {
    const l = links.find(k => k.id === id); if (!l) return;
    if (isRelation(l)) {
      const now = Date.now(), twice = lastLineTap && lastLineTap.id === id && now - lastLineTap.t < 450;
      lastLineTap = twice ? null : {id, t:now};
      // 이름 창은 이 누름 뒤따르는 click·dblclick이 지나간 뒤에 연다(바로 열면 그 click이 '바깥 누름'으로 창을 닫는다).
      if (twice) { closeLineMenu(); const {clientX:x, clientY:y} = e; setTimeout(() => { void nameRelation(l, x, y); }, 0); return; }
      const g = geometry(l), far = followSide(g.from, g.to, pointOf(e), 48 / view.z, side => cellSeen(endOf(l, side)));
      if (far) { lastLineTap = null; goToCell(endId(l, far)); return; }
    }
    openLineMenu(id, e.clientX, e.clientY);
  }
  // 고르는 동안: 칸 누르기 = 그 칸과 잇기(끌기·열기·고르기보다 먼저). 빈 곳 끌기(판 이동)·두 손가락은 그대로.
  box.addEventListener('pointerdown', e => {
    if (!relPick || !(e.target instanceof Element) || e.target.closest('.nb-relbar,.nb-tools')) return;
    const cell = e.target.closest('[data-nb-card],[data-nb-text]'); if (!cell || e.target.closest('.nb-more,.nb-x')) return;
    e.stopPropagation();
  }, true);
  box.addEventListener('click', e => {
    if (!(e.target instanceof Element)) return;
    if (e.target.closest('[data-nb-rel-cancel]')) { e.preventDefault(); stopRelation(); return; }
    if (e.target.closest('[data-nb-rel-find]')) { e.preventDefault(); void findForRelation(e.target.closest('[data-nb-rel-find]')); return; }
    if (!relPick || e.target.closest('.nb-relbar,.nb-tools')) return;
    const cell = e.target.closest('[data-nb-card],[data-nb-text]'); if (!cell || e.target.closest('.nb-more,.nb-x')) return;
    e.preventDefault(); e.stopImmediatePropagation();
    finishRelation(cell.dataset.nbCard || cell.dataset.nbText);
  }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && relPick && !document.querySelector('.kptu-ask')) { e.preventDefault(); e.stopPropagation(); stopRelation(); } }, true);
  function markTarget(id) {
    if (wire?.target === id) return;
    const el = t => (places.has(t) ? cardEls.get(t) : textEls.get(t));
    if (wire?.target) el(wire.target)?.classList.remove('nb-target');
    if (wire) wire.target = id;
    if (id) el(id)?.classList.add('nb-target');
  }
  // 끝이 될 수 있는 칸(보이는 노트 카드·저장된 상자, 자기 빼고).
  function endRects(skip) {
    const out = new Map();
    for (const [id] of cardEls) if (id !== skip && places.has(id) && isShown(id)) out.set(id, rectOf(placeOfNow(id)));
    for (const [id, r] of lay.rects) if (id !== skip && id !== DRAFT && textById.has(id) && !textById.get(id).pending) out.set(id, r);
    return out;
  }
  function followWire() {
    const p = pointOf(wire.last), hit = document.elementFromPoint(wire.last.clientX, wire.last.clientY)?.closest?.('[data-nb-card],[data-nb-text]');
    let target = hit && box.contains(hit) ? (hit.dataset.nbCard || hit.dataset.nbText || null) : null;
    if (target === wire.from || (target && !places.has(target) && (!textById.has(target) || textById.get(target).pending))) target = null;
    if (!target) target = nearestRect(endRects(wire.from), p, new Set(), 24 / view.z);
    markTarget(target);
    temp.setAttribute('d', dragPath(rectFor(wire.from), wire.side, p, wire.origin)); temp.removeAttribute('hidden');
  }
  function finishWire(e) {
    const w = wire; followWire(); const target = wire.target; cancelWire(); suppressUntil = Date.now() + 400;
    const at = pointOf(e);
    if (w.relation) { // S71-53 관계선: 다른 칸 위에 놓았을 때만(빈 곳이면 아무것도 안 만듦)
      if (target) { if (addRelation(w.from, target)) flashCell(target); }
      else if (Math.hypot(e.clientX - w.x, e.clientY - w.y) >= 24) toast('관계선은 다른 칸 위에 놓아 주세요.');
      return;
    }
    if (!target) { // 빈 곳: 그 자리 새 상자, 쓰고 나면 선으로 잇는다(조금만 끌다 놓은 것은 아무것도 안 함)
      if (Math.hypot(e.clientX - w.x, e.clientY - w.y) < 24) return;
      if (links.length >= LINK_LIMIT) { toast(`연결선은 한 보드에 ${LINK_LIMIT}개까지 그을 수 있어요.`); return; }
      newText(at, {linkFrom:{kind:w.kind, id:w.from, side:w.side}});
      return;
    }
    const kind = places.has(target) ? 'note' : 'text';
    if (hasLink(links, key, w.from, target)) { toast('이미 이어져 있어요.'); return; }
    if (links.length >= LINK_LIMIT) { toast(`연결선은 한 보드에 ${LINK_LIMIT}개까지 그을 수 있어요.`); return; }
    onLinkAdd({board_id:key, ...endFields('from', w.kind, w.from), ...endFields('to', kind, target), from_side:w.side, to_side:nearestSide(rectFor(target), at), shape:'line'});
  }

  // ---- 선 가운데 끌어 곡선(조절점 하나, 끄는 동안 바로 보임) ----
  function cancelBend() { if (!bend) return; const b = bend; bend = null; dragOn(false); const l = links.find(k => k.id === b.id); if (l && lineEls.has(l.id)) paintLine(l); }
  function followBend(e) {
    const l = links.find(k => k.id === bend.id); if (!l) { cancelBend(); return; }
    const g = linkGeometry(lineEndRect(l, 'from'), lineEndRect(l, 'to'), {...l, shape:'line', bend_x:null, bend_y:null});
    bend.now = bendOf(g.from, g.to, pointOf(e));
    paintLine(l);
  }
  function finishBend() {
    const b = bend; bend = null; dragOn(false); bendEnded = true; // 끌기 끝에 따라오는 click은 메뉴가 아니다(다음 누름에서 풀림)
    const l = links.find(k => k.id === b.id); if (!l) return;
    const patch = bendPatch(b.now);
    if (Object.entries(patch).every(([k, v]) => l[k] === v)) { if (lineEls.has(l.id)) paintLine(l); return; }
    paintLine({...l, ...patch}); // 서버 답 전에도 그 모양으로
    onLinkChange(l.id, patch);
  }

  // ---- S69-91 선 끝 옮기기(고른 선의 양 끝 동그라미): 상자·도형·카드 위(또는 화면 24px 안)에 놓으면 그 끝에 붙고, 빈 곳이면 그 점 ----
  function startLineEnd(e, grip) {
    const l = links.find(k => k.id === grip.dataset.nbLendOf); if (!l || l.pending || !linesReady()) return;
    e.preventDefault(); e.stopPropagation();
    lend = {id:l.id, side:grip.dataset.nbLend, pointerId:e.pointerId, now:pointOf(e), target:null, moved:false, x:e.clientX, y:e.clientY};
    dragOn(true); box.classList.add('nb-wiring');
    if (menu?.el && !menu.el.hidden) menu.el.style.visibility = 'hidden'; // 끄는 동안 선 메뉴가 놓을 곳을 가리지 않게(놓으면 다시)
    try { scroll.setPointerCapture(e.pointerId); } catch { /* 잡기 실패해도 움직임은 받는다 */ }
  }
  const showMenuAgain = () => { if (menu?.el) { menu.el.style.visibility = ''; if (!menu.el.hidden) placeMenu(); } };
  function markEnd(id) {
    const el = t => (places.has(t) ? cardEls.get(t) : textEls.get(t));
    if (lend.target && lend.target !== id) el(lend.target)?.classList.remove('nb-target');
    lend.target = id; if (id) el(id)?.classList.add('nb-target');
  }
  function followLineEnd(e) {
    const l = links.find(k => k.id === lend.id); if (!l) { cancelLineEnd(); return; }
    const p = pointOf(e), other = endId(l, lend.side === 'from' ? 'to' : 'from');
    lend.moved = lend.moved || Math.hypot(e.clientX - lend.x, e.clientY - lend.y) > 3;
    const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-nb-card],[data-nb-text]');
    let target = hit && box.contains(hit) ? (hit.dataset.nbCard || hit.dataset.nbText || null) : null;
    if (target && (target === other || (!places.has(target) && (!textById.has(target) || textById.get(target).pending)))) target = null;
    if (!target) target = nearestRect(endRects(other), p, new Set(), 24 / view.z);
    if (target === other) target = null;
    lend.now = {x:clampCoord(p.x), y:clampCoord(p.y)}; markEnd(target);
    paintLine(l);
  }
  function cancelLineEnd() {
    if (!lend) return;
    const d = lend; if (d.target) markEnd(null); lend = null; dragOn(false); box.classList.remove('nb-wiring'); showMenuAgain();
    const l = links.find(k => k.id === d.id); if (l && lineEls.has(l.id)) paintLine(l);
  }
  function finishLineEnd(e) {
    followLineEnd(e);
    const d = lend, target = d.target; markEnd(null); lend = null; dragOn(false); box.classList.remove("nb-wiring"); showMenuAgain(); suppressUntil = Date.now() + 300;
    const l = links.find(k => k.id === d.id); if (!l) return;
    if (!d.moved) { if (lineEls.has(l.id)) paintLine(l); return; }
    const side = d.side;
    let patch;
    if (target) {
      const kind = places.has(target) ? 'note' : 'text';
      const ends = {from:side === 'from' ? target : endId(l, 'from'), to:side === 'to' ? target : endId(l, 'to')};
      if (ends.from && ends.to && hasLink(links.filter(k => k.id !== l.id), key, ends.from, ends.to)) { toast('이미 이어져 있어요.'); paintLine(l); return; }
      patch = endPatch(side, kind, target, null); // 변은 비워 둔다 — 두 끝 자리로 마주 보는 변(옮기면 따라 바뀜)
    } else patch = endPatch(side, 'point', d.now);
    if (Object.entries(patch).every(([k, v]) => (l[k] ?? null) === v)) { paintLine(l); return; }
    paintLine({...l, ...patch});
    onLinkChange(l.id, patch);
  }
  // 양 끝이 점인 선: 몸통을 끌면 통째로 옮긴다(놓으면 두 점 저장).
  function followLineMove(e) {
    const l = links.find(k => k.id === lmove.id); if (!l) { lmove = null; return; }
    const p = pointOf(e);
    lmove.dx = Math.round(p.x - lmove.start.x); lmove.dy = Math.round(p.y - lmove.start.y); // S71-52: 판은 음수 쪽으로도 뻗는다(저장 때 범위 안으로)
    paintLine(l);
  }
  function finishLineMove() {
    const m = lmove; lmove = null; dragOn(false); suppressUntil = Date.now() + 300; bendEnded = true;
    const l = links.find(k => k.id === m.id); if (!l) return;
    if (!m.dx && !m.dy) { paintLine(l); return; }
    const patch = {from_x:clampCoord(l.from_x + m.dx), from_y:clampCoord(l.from_y + m.dy), to_x:clampCoord(l.to_x + m.dx), to_y:clampCoord(l.to_y + m.dy)};
    paintLine({...l, ...patch});
    onLinkChange(l.id, patch);
  }

  // ---- 상자: 끌어 옮기기 = 그 가지째(폰: 바로 끌기·꾹 누른 뒤 끌기, 꾹 누르고 떼면 고르기만, 짧게 누르면 고르기·고른 것을 다시 누르면 고치기) ----
  const dropClasses = ['nb-drop-in', 'nb-drop-before', 'nb-drop-after'];
  function markDrop(next) {
    const old = tdrag?.drop;
    if (old && (!next || old.id !== next.id || old.zone !== next.zone)) textEls.get(old.id)?.classList.remove(...dropClasses);
    if (tdrag) tdrag.drop = next;
    if (old && (!next || old.id !== next.id)) cardEls.get(old.id)?.classList.remove('nb-drop-in');
    if (next) (textEls.get(next.id) || cardEls.get(next.id))?.classList.add(`nb-drop-${next.zone}`); // S71-51: 카드 위에 놓을 때도 표시
  }
  function cancelTextDrag() {
    if (!tdrag) return;
    clearTimeout(tdrag.timer); stopEdge(); markDrop(null); paintGuides([]);
    const d = tdrag; tdrag = null; dragOn(false); dropLift();
    for (const id of d.ids) textEls.get(id)?.classList.remove('nb-dragging', 'nb-held');
    d.el.classList.remove('nb-dragging', 'nb-held');
    for (const g of d.cards || []) { const el = cardEls.get(g.id); if (el) { el.classList.remove('nb-dragging'); el.style.left = `${g.place.x}px`; el.style.top = `${g.place.y}px`; } repaintLinesOf(g.id); }
    if (d.moving) relayout();
  }
  function followText() {
    const p = pointOf(tdrag.last);
    let dx = Math.round(p.x - tdrag.start.x), dy = Math.round(p.y - tdrag.start.y);
    // 놓을 곳(생각 지도 칸이 있을 때만, 하나만 끌 때): 끄는 가지 밖의 상자. 놓을 곳이 없으면 맞춤선에 붙인다.
    let hit = null;
    if (mapReady() && !tdrag.cards.length && tdrag.group.length <= 1 && canGrow(textById.get(tdrag.id))) { // 옛 서버: 글자·도형은 가지로 붙지 않는다(자유 칸)
      const all = branchReady();
      const others = new Map([...lay.rects].filter(([id]) => !tdrag.ids.has(id) && id !== DRAFT && !places.has(id) && !textById.get(id)?.pending && (all || !isFree(textById.get(id)))));
      // S71-51: 노트 카드(사진 카드 포함) 위에 놓으면 그 카드 아래 가지로.
      if (all) for (const n of shown) if (isShown(n.id) && places.has(n.id)) others.set(n.id, rectOf(placeOfNow(n.id)));
      hit = dropTarget(others, p, new Set(), id => places.has(id) || !tree.parentOf.has(id));
      if (hit && !places.has(hit.id) && !canAttach(tree, tdrag.id, hit.id)) hit = null;
    }
    markDrop(hit);
    const lead = lay.rects.get(tdrag.id);
    if (!hit && lead && !tdrag.last.altKey) { const s = snapFor({...lead, x:lead.x + dx, y:lead.y + dy}, tdrag.skip); dx += Math.round(s.dx); dy += Math.round(s.dy); paintGuides(s.guides); } // Alt = 맞춤선에 붙지 않음
    else paintGuides([]);
    tdrag.dx = dx; tdrag.dy = dy;
    moveLift(dx, dy);
    placeEls();
    paintBranches();
    for (const id of tdrag.ids) repaintLinesOf(id);
    for (const g of tdrag.cards) { const el = cardEls.get(g.id); if (el) { el.style.left = `${clampCoord(g.place.x + dx)}px`; el.style.top = `${clampCoord(g.place.y + dy)}px`; el.classList.add('nb-dragging'); } repaintLinesOf(g.id); }
  }
  function finishTextDrag(e) {
    const d = tdrag; stopEdge(); clearTimeout(d.timer); dragOn(false);
    if (d.moving) followText();
    const drop = d.drop; markDrop(null); paintGuides([]); tdrag = null; dropLift();
    if (editing?.el === d.el) editing.area?.focus({preventScroll:true});
    for (const id of d.ids) textEls.get(id)?.classList.remove('nb-dragging', 'nb-held');
    for (const g of d.cards || []) cardEls.get(g.id)?.classList.remove('nb-dragging');
    // 짧게 누름 = 고르기, 이미 고른 상자 = 고치기. 입력칸은 뒤따르는 click에서 연다(폰은 손 뗀 뒤 흉내 마우스 누름이 와서, 그 전에 연 입력칸은 초점을 잃는다).
    if (!d.moving) {
      if (d.held) { suppressUntil = Date.now() + 600; return; }
      if (d.cell) lastCell.set(d.id, d.cell); // S71-56: 표에서 누른 칸(줄·칸 더하기 자리·글쓰기 칸)
      if (editing?.id === d.id) { if (editing.table && d.cell) moveCell(d.cell.r, d.cell.c); return; } // 글 쓰는 중 테두리를 짧게 누름 = 그대로 쓰기, 표의 다른 칸 = 그 칸으로
      if (d.touch && multi.size && e.type !== 'pointercancel') { suppressUntil = Date.now() + 600; toggleMulti(tKey(d.id)); return; } // 폰: 여러 개 고르는 중 = 더하기·빼기
      if (d.wasSel) afterClick = {run:() => startEdit(d.id, d.cell)};
      else { clearMulti(); selectText(d.id); if (e.pointerType !== 'mouse') afterClick = {run:() => focusNode(d.id)}; }
      return;
    }
    suppressUntil = Date.now() + 400;
    const id = d.id, t = textById.get(id), r = lay.rects.get(id); if (!t || !r) { relayout(); return; }
    if (drop) { attachTo(id, drop, pointOf(e)); return; }
    // 함께 고른 카드·상자: 같은 만큼(카드는 카드 자리, 상자는 movePatches).
    if (d.cards.length) {
      const top = topZ(places), before = new Map(places);
      const moved = d.cards.map((g, i) => [g.id, movedTo(g.place, d.dx, d.dy, top + i)]);
      for (const [gid, gp] of moved) { places.set(gid, {...gp, saved:true}); before.set(gid, {...gp, saved:true}); const el = cardEls.get(gid); if (el) { el.style.left = `${gp.x}px`; el.style.top = `${gp.y}px`; raise(el, gp.z); } repaintLinesOf(gid); }
      moved.forEach(([gid, gp], i) => onMove(gid, gp, i ? new Map() : before));
    }
    const parent = tree.parentOf.get(id) || null;
    // 가지를 빈 곳에 놓음: 틀 칸이 있으면 그 자리에 선다(손으로 둔 가지, 가지 선은 따라감). 없는 서버(적용 전)는 옛 길 — 조금만 움직였으면 제자리, 아니면 떼어 혼자 선 상자로.
    if (parent && !frameReady() && d.group.length <= 1) {
      if (Math.hypot(d.dx, d.dy) < DETACH_MIN || !canMap()) { relayout(); return; }
      onTextsChange([{id, patch:{parent_id:null, side:null, x:clampCoord(r.x + d.dx), y:clampCoord(r.y + d.dy)}}]);
      return;
    }
    if (parent && !canMap()) { relayout(); return; }
    moveTexts(d.group, d.dx, d.dy);
  }
  // 옮겨 붙이기: in = 그 상자의 마지막 가지, before·after = 그 상자의 앞·뒤 형제. 형제 순서에 틈이 없으면 형제 번호를 다시 매긴다.
  function attachTo(id, drop, at) {
    if (!canMap()) { relayout(); return; }
    const target = textById.get(drop.id) || (isCard(drop.id) ? {id:drop.id, collapsed:false} : null); if (!target) { relayout(); return; }
    const parent = drop.zone === 'in' ? drop.id : tree.parentOf.get(drop.id);
    if (!parent) { relayout(); return; }
    const sibs = childrenOf(tree, parent).filter(k => k.id !== id && k.id !== DRAFT);
    const index = drop.zone === 'in' ? sibs.length : sibs.findIndex(k => k.id === drop.id) + (drop.zone === 'after' ? 1 : 0);
    const {ord, renumber} = ordAt(sibs, index);
    const parentIsRoot = !tree.parentOf.has(parent);
    const side = !parentIsRoot ? null : drop.zone === 'in' ? (at.x < rectFor(parent).x + rectFor(parent).w / 2 ? -1 : 1) : (lay.rects.get(drop.id)?.side || 1);
    const items = renumber.map(n => ({id:n.id, patch:{ord:n.ord}}));
    items.push({id, patch:{...parentFields(parent), ord, side, pinned:false}}); // 붙이면 다시 자동 배치
    if (drop.zone === 'in' && target.collapsed) items.push({id:parent, patch:{collapsed:false}});
    onTextsChange(items);
  }

  // ---- 크기 손잡이(S69-88): 상자·카드 — 끄는 동안 바로 따라오고 놓으면 저장. 왼쪽·위 손잡이는 반대편 변을 고정한다. ----
  function startResize(e, grip) {
    const card = grip.closest('[data-nb-card]'), textEl = card ? null : grip.closest('[data-nb-text]');
    const kind = card ? 'note' : 'text', id = card?.dataset.nbCard || textEl?.dataset.nbText;
    if (!id || opts.pickActive) return;
    if (kind === 'note' ? !places.has(id) : (!textById.has(id) && id !== DRAFT) || textById.get(id)?.pending) return;
    e.preventDefault(); e.stopPropagation(); // 글 쓰는 중이면 입력칸 초점을 그대로 둔다
    closeLineMenu();
    const el = card || textEl, place = kind === 'note' ? places.get(id) : null;
    const start = kind === 'note' ? rectOf(place) : {...textRect(id)};
    // 뿌리·손으로 둔 가지는 자기 자리를 쓰므로 왼쪽·위 손잡이에서 반대편 변을 고정할 수 있다. 자동 배치 가지는 크기만(자리는 배치가 정함).
    const t = textById.get(id), ownPlace = kind === 'text' && !!t && (!tree.parentOf.has(id) || (t.pinned && frameReady()));
    rz = {kind, id, el, place, handle:grip.dataset.nbResize, start, ownPlace, p0:pointOf(e), now:null, pointerId:e.pointerId};
    if (kind === 'note') select(id); else if (id !== DRAFT && editing?.id !== id) selectText(id);
    el.classList.add('nb-resizing'); box.classList.add('nb-sizing'); dragOn(true); placeBar();
    try { scroll.setPointerCapture(e.pointerId); } catch { /* 잡기 실패해도 움직임은 받는다 */ }
  }
  function followResize(e) {
    const p = pointOf(e), next = resizeRect(rz.start, rz.handle, p.x - rz.p0.x, p.y - rz.p0.y, FRAME_LIMITS);
    if (rz.kind === 'note') {
      rz.now = {...rz.place, x:next.x, y:next.y, w:next.w, h:next.h};
      Object.assign(rz.el.style, {left:`${next.x}px`, top:`${next.y}px`, width:`${next.w}px`, height:`${next.h}px`});
      rz.el.toggleAttribute('data-nb-sized', true);
      repaintLinesOf(rz.id);
      return;
    }
    rz.now = next;
    if (/[ew]/.test(rz.handle)) { rz.el.style.width = `${next.w}px`; rz.el.style.maxWidth = 'none'; }
    if (/[ns]/.test(rz.handle)) { rz.el.style.minHeight = `${next.h}px`; rz.el.toggleAttribute('data-h', true); }
    relayout();
  }
  function cancelResize() {
    if (!rz) return;
    const r = rz; rz = null; dragOn(false); box.classList.remove('nb-sizing'); r.el.classList.remove('nb-resizing');
    if (r.kind === 'note') { const p = places.get(r.id) || r.place; Object.assign(r.el.style, {left:`${p.x}px`, top:`${p.y}px`, width:p.w ? `${p.w}px` : '', height:p.h ? `${p.h}px` : ''}); r.el.toggleAttribute('data-nb-sized', !!(p.w || p.h)); repaintLinesOf(r.id); }
    else { const t = textById.get(r.id); r.el.style.width = t?.w ? `${t.w}px` : ''; r.el.style.maxWidth = ''; r.el.style.minHeight = t?.h ? `${t.h}px` : ''; r.el.toggleAttribute('data-h', !!t?.h); relayout(); }
    placeBar();
  }
  function finishResize(e) {
    followResize(e);
    const r = rz; rz = null; dragOn(false); box.classList.remove('nb-sizing'); r.el.classList.remove('nb-resizing'); suppressUntil = Date.now() + 400;
    if (editing?.el === r.el) editing.area?.focus({preventScroll:true});
    const next = r.now;
    if (!next || (next.w === r.start.w && next.h === r.start.h && next.x === r.start.x && next.y === r.start.y)) { // 움직이지 않음 = 그대로
      rz = r; cancelResize(); return;
    }
    if (r.kind === 'note') {
      const old = places.get(r.id) || r.place, size = sizePatch(r.handle, next, old);
      const saved = {...placeFields(old), x:next.x, y:next.y, w:size.w, h:size.h};
      places.set(r.id, {...saved, saved:true});
      onMove(r.id, saved, new Map(places));
      placeBar(); return;
    }
    if (r.id === DRAFT) { const sz = sizePatch(r.handle, next, draft); draft = {...draft, w:sz.w, h:sz.h}; relayout(); return; } // 새로 쓰는 상자: 쓰고 나서 그 크기로 저장(endEdit)
    const t = textById.get(r.id); if (!t) { relayout(); return; }
    const patch = sizePatch(r.handle, next, t);
    if (r.ownPlace && /[nw]/.test(r.handle)) { patch.x = clampCoord(next.x); patch.y = clampCoord(next.y); }
    if (Object.entries(patch).every(([k, v]) => t[k] === v)) { relayout(); placeBar(); return; }
    if (!canMap()) { cancelResizeEl(r, t); return; }
    onTextChange(r.id, patch);
    placeBar();
  }
  function cancelResizeEl(r, t) { r.el.style.width = t.w ? `${t.w}px` : ''; r.el.style.maxWidth = ''; r.el.style.minHeight = t.h ? `${t.h}px` : ''; r.el.toggleAttribute('data-h', !!t.h); relayout(); placeBar(); }

  // ---- 상자: 그 자리 입력칸으로 고치기·새로 쓰기 ----
  // 입력칸은 상자 안 글(.nb-tx, 보이지 않게 두고 폭·높이만 잡음) 위에 겹친다 — 상자 폭이 글 길이만큼 늘고 줄어든다(가로 글, 최대 폭에서만 줄바꿈).
  // 새로 쓰는 상자(draft)는 저장 전까지 나무에만 있는 자리(DRAFT)로 배치되어 형제가 미리 비켜 선다. 비우고 끝내면 만들지 않는다.
  function startEdit(id, at = null) {
    if (opts.pickActive) return;
    const cellT = id !== DRAFT ? textById.get(id) : null; // S71-56: 파일 칸 = 열어 보기, 표 칸 = 칸 글쓰기
    if (cellT?.kind === 'file') { openFile(id); return; }
    if (cellT?.kind === 'table') { if (editing && editing.id !== id) void endEdit(true); if (!editing) startTableEdit(id, at); return; }
    if (editing) void endEdit(true);
    const isNew = id === DRAFT, t = isNew ? null : textById.get(id);
    if (!isNew && (!t || t.pending)) return;
    const el = textEls.get(id) || (textOn.has(id) ? attachText(id) : null); if (!el) return; // S71-52: 화면 밖 상자면 붙인 뒤
    if (!isNew) selectText(id);
    el.classList.add('nb-editing', 'nb-sel');
    const mirror = el.querySelector('.nb-tx'), area = document.createElement('textarea');
    area.className = 'nb-tx-edit'; area.dataset.nbTextEdit = ''; area.maxLength = TEXT_MAX; area.rows = 1; area.spellcheck = false;
    area.setAttribute('aria-label', isNew ? (draft?.parent_id ? '새 가지' : draft?.kind === 'label' ? '새 글자' : '새 상자') : t?.kind === 'shape' ? '도형 안 글 수정' : t?.kind === 'label' ? '글자 수정' : '상자 글 수정'); area.value = t?.body || '';
    el.append(area);
    editing = {id, isNew, el, area, mirror};
    placeBar();
    const grow = () => { mirror.textContent = `${area.value || ' '}​`; relayout(); };
    area.addEventListener('input', grow);
    area.addEventListener('keydown', e => {
      if (e.isComposing || e.keyCode === 229) return; // 한글 조합 중 Enter는 글자 확정
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); void endEdit(false, true); }
      else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); void endEdit(true, true); }
      else if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); void endEdit(true, true).then(saved => { if (saved) addChild(saved.id); }); }
    });
    area.addEventListener('blur', () => { if (editing?.area === area && !(rz && rz.el === el) && !(tdrag && tdrag.el === el) && !ddrag) void endEdit(true); }); // 크기·자리를 바꾸는 손 = 쓰기 그대로
    grow(); area.focus({preventScroll:true}); area.setSelectionRange(area.value.length, area.value.length);
    keepNodeVisible(id);
  }
  // 끝내기. 저장한 상자(새 상자는 서버 답, 고친 상자는 그 상자)를 돌려준다. refocus: 키보드로 끝냈을 때만 그 상자에 초점을 돌려준다.
  async function endEdit(save, refocus = false) {
    const ed = editing; if (!ed) return null; editing = null;
    if (ed.table) return finishTable(ed, save, refocus); // S71-56
    const value = ed.area.value; ed.area.remove(); ed.el.classList.remove('nb-editing');
    let body = null;
    if (save) { try { body = validateText(value); } catch (err) { toast(err.message); body = null; } }
    const shapeEmpty = save && body === null && !value.trim() && textById.get(ed.id)?.kind === 'shape'; // 도형은 글을 비워도 된다(글 없는 도형)
    if (ed.isNew) {
      const d = draft, r = lay.rects.get(DRAFT); draft = null; ed.el.remove(); textEls.delete(DRAFT); htmlOf.delete(DRAFT);
      if (!body || !d) { renderTexts(); if (refocus && d?.parent_id) focusAny(d.parent_id); return null; }
      const place = d.parent_id && r ? {x:clampCoord(r.x), y:clampCoord(r.y)} : {x:d.x, y:d.y};
      const look = Object.fromEntries(['color', 'stroke', 'ink'].filter(k => d[k] != null).map(k => [k, d[k]])); // S71-51: 같은 모양 가지는 꾸미기도 같게
      const map = mapReady() ? {...parentFields(d.parent_id), ord:d.ord, side:d.side, font:d.font, ...(d.w ? {w:d.w} : {}), ...(d.h ? {h:d.h} : {}), ...(d.kind ? {kind:d.kind, shape:d.shape || 'plain', z:d.z ?? 0, ...look} : {})} : {};
      const asked = onTextAdd({board_id:key, body, ...place, ...map});
      renderTexts();
      const saved = await asked;
      if (!saved) return null;
      if (d.linkFrom && textById.has(saved.id)) {
        const linkAsk = onLinkAdd({board_id:key, ...endFields('from', d.linkFrom.kind, d.linkFrom.id), ...endFields('to', 'text', saved.id), from_side:d.linkFrom.side, to_side:null, shape:'line'});
        // S70-77: 연결점에서 끌어 만든 새 상자 = 상자 + 선 한 묶음. 알림 [되돌리기](Ctrl+Z도) 한 번에 둘 다 지운다(상자를 지우면 붙은 선도 함께 — 서버 cascade).
        if (onRemoveItems) notify('새 상자를 이었어요', {label:'새 상자 잇기', undo:async () => {
          await linkAsk;
          const back = await onRemoveItems({texts:[saved.id], links:[], cards:[]});
          return back ? true : {status:'failed', message:'되돌리지 못했어요.'};
        }});
      }
      if (refocus && !editing && textOn.has(saved.id)) focusNode(saved.id);
      return saved;
    }
    const t = textById.get(ed.id);
    ed.mirror.textContent = t?.body || '';
    if (!ed.el.isConnected || !t) { renderTexts(); return null; }
    if (shapeEmpty && t.body) { t.body = ''; ed.mirror.textContent = ''; relayout(); onTextChange(ed.id, {body:''}); }
    else if (body && body !== t.body) {
      t.body = body; ed.mirror.textContent = body; ed.mirror.setAttribute('aria-label', body);
      relayout(); onTextChange(ed.id, {body});
    } else relayout();
    if (refocus) focusNode(ed.id);
    return t;
  }
  // ---- S71-56 표 칸 글쓰기: 쓰는 칸 하나에 입력칸 하나(칸 글 자리 위에 겹침). 고친 표는 끝낼 때 한 번 저장(cells — 서버 표 글 칸). ----
  const lastCell = new Map(); // 표 id → 마지막으로 누르거나 쓴 칸 {r, c}(이번 화면만 — 줄·칸 더하기·빼기 자리)
  const cellOf = (target, el) => { const td = target?.closest?.('[data-nb-cell]'); if (!td || !el?.contains(td)) return null; const [r, c] = td.dataset.nbCell.split(',').map(Number); return Number.isInteger(r) && Number.isInteger(c) ? {r, c} : null; };
  function startTableEdit(id, at = null) {
    const t = textById.get(id); if (!t || t.pending || !t.cells) return;
    if (!cellsReady()) { canCells(); return; }
    const el = textEls.get(id) || (textOn.has(id) ? attachText(id) : null); if (!el) return;
    selectText(id);
    const {rows, cols} = tableSize(t.cells), fit = p => p && p.r >= 0 && p.c >= 0 && p.r < rows && p.c < cols;
    const p = fit(at) ? at : fit(lastCell.get(id)) ? lastCell.get(id) : {r:0, c:0};
    editing = {id, isNew:false, el, table:true, cells:t.cells.map(r => r.slice()), before:JSON.stringify(t.cells), r:p.r, c:p.c, area:null, mirror:null, moving:false};
    el.classList.add('nb-editing', 'nb-sel');
    paintTable();
    placeBar();
    keepNodeVisible(id);
  }
  // 쓰는 표를 지금 칸 글(editing.cells)로 다시 그리고 쓰는 칸에 입력칸을 연다.
  function paintTable() {
    const ed = editing; if (!ed?.table) return;
    ed.moving = true; ed.area?.remove(); ed.moving = false;
    const tx = ed.el.querySelector('.nb-tx'); if (!tx) return;
    tx.innerHTML = tableHtml(textById.get(ed.id) || {id:ed.id});
    const td = tx.querySelector(`[data-nb-cell="${ed.r},${ed.c}"]`); if (!td) return;
    const mirror = document.createElement('span'), area = document.createElement('textarea');
    mirror.className = 'nb-cell-mirror'; mirror.textContent = `${ed.cells[ed.r][ed.c] || ' '}​`;
    area.className = 'nb-tx-edit nb-cell-edit'; area.dataset.nbTextEdit = ''; area.maxLength = CELL_MAX; area.rows = 1; area.spellcheck = false;
    area.setAttribute('aria-label', `표 ${ed.r + 1}줄 ${ed.c + 1}칸`); area.value = ed.cells[ed.r][ed.c];
    td.textContent = ''; td.classList.add('nb-cell-on'); td.append(mirror, area);
    ed.area = area; ed.mirror = mirror; lastCell.set(ed.id, {r:ed.r, c:ed.c});
    area.addEventListener('input', () => { if (editing !== ed) return; ed.cells[ed.r][ed.c] = cleanCell(area.value); mirror.textContent = `${area.value || ' '}​`; relayout(); });
    area.addEventListener('keydown', e => {
      if (e.isComposing || e.keyCode === 229) return; // 한글 조합 중 Enter·Tab은 글자 확정
      if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); const n = stepCell(ed.cells, ed.r, ed.c, e.shiftKey); moveCell(n.r, n.c, !!n.grow); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); void endEdit(false, true); return; }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); void endEdit(true, true); }
    });
    area.addEventListener('blur', () => { if (editing === ed && ed.area === area && !ed.moving && !(rz && rz.el === ed.el) && !(tdrag && tdrag.el === ed.el)) void endEdit(true); });
    relayout();
    area.focus({preventScroll:true}); area.setSelectionRange(area.value.length, area.value.length);
  }
  // 쓰는 칸 옮기기(Tab·다른 칸 누르기). grow = 마지막 칸에서 Tab — 줄을 더한다(한도 안·크기 안일 때만).
  function moveCell(r, c, grow = false) {
    const ed = editing; if (!ed?.table) return;
    if (ed.area) ed.cells[ed.r][ed.c] = cleanCell(ed.area.value);
    if (grow) {
      const next = addRow(ed.cells);
      if (!next || !fitsBytes(next)) { toast(`표는 ${ROWS_MAX}줄까지 만들 수 있어요.`); return; }
      ed.cells = next;
    }
    if (r === ed.r && c === ed.c && !grow) { ed.area?.focus({preventScroll:true}); return; }
    ed.r = r; ed.c = c;
    paintTable();
  }
  // 표 글쓰기 끝: save면 바뀐 칸 글을 한 번 저장(크기 한도를 넘으면 알리고 저장하지 않음), 아니면 그대로. 표는 저장한 글(또는 옛 글)로 다시 그린다.
  function finishTable(ed, save, refocus) {
    ed.moving = true; if (ed.area) { ed.cells[ed.r][ed.c] = cleanCell(ed.area.value); ed.area.remove(); }
    ed.el.classList.remove('nb-editing');
    const t = textById.get(ed.id);
    if (!t || !ed.el.isConnected) { renderTexts(); return null; }
    const next = ed.cells, changed = JSON.stringify(next) !== ed.before;
    if (save && changed && !fitsBytes(next)) { toast('표 글이 너무 많아요. 칸 글을 줄여 주세요.'); save = false; }
    if (save && changed) { t.cells = next; onTextChange(ed.id, {cells:next}); }
    const tx = ed.el.querySelector('.nb-tx'); if (tx) tx.innerHTML = tableHtml(t);
    relayout();
    if (refocus) focusNode(ed.id);
    return t;
  }
  // 표 줄·칸 더하기·빼기(막대 [표 ⋯]·우클릭 메뉴): 마지막으로 누른 칸 자리(없으면 끝). 글이 있는 줄·칸을 빼면 알림 [되돌리기].
  function tableOp(id, op) {
    const t = textById.get(id); if (!t?.cells || t.pending || opts.pickActive) return;
    if (!cellsReady()) { canCells(); return; }
    if (editing?.id === id) void endEdit(true);
    const now = textById.get(id)?.cells || t.cells, at = lastCell.get(id) || null;
    const next = op === 'row+' ? addRow(now, at?.r) : op === 'row-' ? removeRow(now, at?.r) : op === 'col+' ? addCol(now, at?.c) : op === 'col-' ? removeCol(now, at?.c) : null;
    if (!next) { toast(op.endsWith('+') ? `표는 ${ROWS_MAX}줄 ${COLS_MAX}칸까지 만들 수 있어요.` : '하나뿐인 줄·칸은 뺄 수 없어요.'); return; }
    if (!fitsBytes(next)) { toast('표 글이 너무 많아요. 칸 글을 줄여 주세요.'); return; }
    const lost = tableText(now).replace(/[\s|]/g, '') !== tableText(next).replace(/[\s|]/g, '') && op.endsWith('-');
    if (op.endsWith('-')) lastCell.delete(id);
    onTextChange(id, {cells:next});
    if (lost) notify(op === 'row-' ? '줄을 뺐어요' : '칸을 뺐어요', {label:op === 'row-' ? '표 줄 빼기' : '표 칸 빼기', undo:async () => {
      if (!textById.has(id)) return {status:'stale'};
      onTextChange(id, {cells:now}); return true;
    }});
  }
  // 파일 칸 열어 보기(보드 위 옆 칸 — 부르는 쪽).
  function openFile(id) { const t = textById.get(id); if (!t || t.pending || t.kind !== 'file' || opts.pickActive) return; onFileOpen?.(t, textEls.get(id) || box); }
  async function newTable(at) {
    if (!canText() || !canCells()) return;
    if (texts.length >= TEXT_LIMIT) { toast(`상자는 한 보드에 ${TEXT_LIMIT}개까지 만들 수 있어요.`); return; }
    if (editing) void endEdit(true);
    const p = freeSpot({x:at.x - TABLE_W / 2, y:at.y - 45}, TABLE_W, 90); showRect({x:p.x, y:p.y, w:TABLE_W, h:90});
    const saved = await onTextAdd(tableSpec(key, {x:clampCoord(p.x), y:clampCoord(p.y)}, Math.min(100000, topTextZ() + 1)));
    if (saved && textOn.has(saved.id)) { clearMulti(); select(null); selectText(saved.id); }
  }
  // 파일 칸 넣기: 고른 것({kind:'doc'|'att', ref}) 마다 한 칸, at(판 좌표) 근처 겹치지 않는 자리에. 넣은 수를 돌려준다.
  async function addFileCells(list, at) {
    if (!cellsReady()) { canCells(); return 0; }
    if (editing) void endEdit(true);
    let n = 0, last = null, z = topTextZ();
    for (const pick of list || []) {
      if (texts.length >= TEXT_LIMIT) { toast(`상자는 한 보드에 ${TEXT_LIMIT}개까지 만들 수 있어요.`); break; }
      const p = freeSpot({x:at.x - FILE_W / 2, y:at.y - 18}, FILE_W, 40);
      const spec = fileSpec(key, pick, {x:clampCoord(p.x), y:clampCoord(p.y)}, Math.min(100000, ++z)); if (!spec) continue;
      const saved = await onTextAdd(spec); if (saved) { n++; last = saved; }
    }
    if (last && textOn.has(last.id)) { const r = lay.rects.get(last.id); if (r) showRect(r); clearMulti(); select(null); selectText(last.id); }
    return n;
  }
  function pickFiles(anchor) {
    if (!onFilePick || opts.pickActive) return;
    if (!canText() || !canCells()) return;
    if (editing) void endEdit(true);
    const at = viewCenter();
    onFilePick(anchor, list => { void addFileCells(list, at); });
  }
  // 새 상자 쓰기 시작: spec = {parent_id, ord, side} 또는 판 자리 {x, y}(혼자 선 상자), linkFrom = 다 쓰면 그 끝에서 선 긋기.
  function startDraft(spec) {
    if (opts.pickActive) return;
    if (texts.length >= TEXT_LIMIT) { toast(`상자는 한 보드에 ${TEXT_LIMIT}개까지 만들 수 있어요.`); return; }
    if (!canText()) return;
    if (editing) void endEdit(true);
    draft = {x:0, y:0, parent_id:null, ord:0, side:null, font:FONT_DEFAULT, ...spec};
    selectText(null);
    renderTexts();
    const del = textEls.get(DRAFT); del?.classList.add('nb-draft');
    del?.toggleAttribute('data-nb-draft-child', !!draft.parent_id); // 가지 새 칸은 자리를 배치가 정한다(끌 수 없음 — 이동 표시 없음)
    startEdit(DRAFT);
  }
  // 새 상자 자리: 화면 가운데에서 시작해 노트 카드·상자와 겹치지 않는 곳(아래로, 그다음 오른쪽으로 비켜 감).
  function freeSpot(at, w = 140, h = 40) {
    const freeLines = links.filter(l => isPointEnd(l, 'from') && isPointEnd(l, 'to')).map(l => ({x:Math.min(l.from_x, l.to_x), y:Math.min(l.from_y, l.to_y), w:Math.abs(l.to_x - l.from_x), h:Math.abs(l.to_y - l.from_y)}));
    const taken = [...shown.filter(n => isShown(n.id) && places.has(n.id)).map(n => cardRect(places.get(n.id))), ...lay.rects.values(), ...freeLines];
    const free = p => !taken.some(r => p.x < r.x + r.w + 16 && r.x < p.x + w + 16 && p.y < r.y + r.h + 16 && r.y < p.y + h + 16);
    for (let col = 0; col < 6; col++) for (let row = 0; row < 12; row++) {
      const p = {x:at.x + col * (w + 24), y:at.y + row * (h + 12)};
      if (free(p)) return p;
    }
    return at;
  }
  function newText(at, {linkFrom = null} = {}) {
    // S69-88: 새 상자는 가로가 넉넉하게(약 168px) 시작하므로, 누른 곳이 화면 오른쪽 끝 가까이면 화면 안에 들도록 왼쪽으로 당겨 놓는다(판은 그대로).
    const {w} = size(), right = (w - view.x) / view.z - 12 / view.z;
    if (w && at.x + 176 / view.z > right) at = {...at, x:Math.max((-view.x) / view.z + 8 / view.z, right - 176 / view.z)};
    startDraft({x:clampCoord(at.x), y:clampCoord(at.y), font:!linkFrom && mapReady() ? ROOT_FONT : FONT_DEFAULT, linkFrom});
  }
  // S69-91: 글자 넣기 = 배경 없는 새 글(그 자리에서 바로 쓰기), 도형 넣기 = 글 없는 도형(바로 고르기), 선 넣기 = 양 끝이 점인 선(바로 고르기·메뉴).
  // 판 칸 중 실제로 보이는 높이(폰은 아래 입력 줄·탭 줄이 판 아래쪽을 덮는다).
  // 보이는 판 높이: 화면 아래 하단바·전환 줄·자판(bottomInset)과, 폰에서 판 아래쪽을 덮는 노트 입력 줄(.home-quick-entry, 노트 목록 맨 아래)까지 뺀다.
  // (S70-54: 목록 머리 찾기 줄이 없어져 판이 위로 올라오자, 입력 줄에 가린 자리를 '보인다'고 쳐 새 도형이 그 밑에 놓이던 것.)
  const seenBottom = () => { let bottom = window.innerHeight - bottomInset(); const q = scroll.closest('[data-note-list]')?.querySelector('.home-quick-entry'); if (q?.getClientRects().length) { const r = q.getBoundingClientRect(); if (r.height && r.top > scroll.getBoundingClientRect().top) bottom = Math.min(bottom, r.top); } return bottom; };
  const seenSize = () => { const {w, h} = size(), top = scroll.getBoundingClientRect().top; return {w, h:Math.max(80, Math.min(h, seenBottom() - top))}; };
  const viewCenter = () => { const {w, h} = seenSize(); return toBoard(view, w / 2, h / 2); };
  const topTextZ = () => texts.reduce((m, t) => Math.max(m, t.z || 0), 0);
  // 비켜 간 자리가 화면 밖이면 판을 옮겨 그 칸이 보이게(넣자마자 고르고 끌 수 있게).
  function showRect(r) {
    const {w, h} = seenSize(), a = visibleArea(view, w, h, 0);
    if (r.x < a.x + 8 / view.z || r.y < a.y + 48 / view.z || r.x + r.w > a.x + a.w - 8 / view.z || r.y + r.h > a.y + a.h - 8 / view.z) setView(centerOn(view, r, w, h));
  }
  function newLabel(at) {
    if (!mapReady() || !decorReady()) { canDecor(); return; }
    const p = freeSpot({x:at.x - 50, y:at.y - 14}, 100, 28); // 넣는 것은 모두 카드·상자와 겹치지 않는 자리에서 시작(카드 밑에 깔려 못 잡는 일 없게)
    showRect({x:p.x, y:p.y, w:168, h:28});
    startDraft({x:clampCoord(p.x), y:clampCoord(p.y), font:FONT_DEFAULT, kind:'label', z:Math.min(100000, topTextZ() + 1)});
  }
  async function newShape(shape, at) {
    if (!canText() || !canDecor()) return;
    if (texts.length >= TEXT_LIMIT) { toast(`상자는 한 보드에 ${TEXT_LIMIT}개까지 만들 수 있어요.`); return; }
    if (editing) void endEdit(true);
    const p = freeSpot({x:at.x - 60, y:at.y - 40}, 120, 80); showRect({x:p.x, y:p.y, w:120, h:80});
    const saved = await onTextAdd(newShapeSpec(key, shape, {x:p.x + 60, y:p.y + 40}, Math.min(100000, topTextZ() + 1)));
    if (saved && textOn.has(saved.id)) { clearMulti(); select(null); selectText(saved.id); }
  }
  function newLine(kind, at) {
    if (!canLines()) return;
    if (links.length >= LINK_LIMIT) { toast(`연결선은 한 보드에 ${LINK_LIMIT}개까지 그을 수 있어요.`); return; }
    if (editing) void endEdit(true);
    clearMulti(); select(null); selectText(null); // 고른 상자 막대가 새 선을 가리지 않게
    const p = freeSpot({x:at.x - 80, y:at.y - 12}, 160, kind === 'elbow' ? 84 : 24); showRect({x:p.x, y:p.y, w:160, h:kind === 'elbow' ? 84 : 24});
    void Promise.resolve(onLinkAdd(newLineSpec(key, kind, {x:p.x + 80, y:p.y + 12}))).then(saved => { // 넣은 선을 바로 고른다(양 끝 동그라미·선 메뉴)
      if (!saved || !links.some(l => l.id === saved.id)) return;
      const g = geometry(saved), sr = scroll.getBoundingClientRect();
      openLineMenu(saved.id, sr.left + g.mid.x * view.z + view.x, sr.top + g.mid.y * view.z + view.y);
    });
  }
  // S71-51: 새 가지 칸의 모양 — 부모(형제)가 상자·글자·도형이면 같은 종류·모양·꾸미기, 카드(사진 카드)면 기본 상자.
  const kindOf = t => (!t || places.has(t.id) || !isFree(t) ? {} : {kind:t.kind, shape:t.shape, color:t.color, stroke:t.stroke, ink:t.ink, ...(t.kind === 'shape' ? {w:t.w, h:t.h} : {}), z:Math.min(100000, topTextZ() + 1)});
  function addChild(id) {
    if (opts.pickActive) return;
    if (isCard(id)) { // 노트 카드·사진 카드 아래 가지
      if (!branchReady()) { canBranch(); return; }
      if (!canMap()) return;
      const card = cardNode(id, placeOfNow(id)), kids = childrenOf(tree, id), {ord, renumber} = ordAt(kids, kids.length);
      if (renumber.length) onTextsChange(renumber.map(n => ({id:n.id, patch:{ord:n.ord}})));
      const sideTree = tree.byId.has(id) ? tree : buildTree([...nodeList(), card]);
      startDraft({...parentFields(id), ord, side:lighterSide(sideTree, id, sizeOfNode)});
      return;
    }
    const t = textById.get(id); if (!t || t.pending) return;
    if (isFree(t) && !branchReady()) { canBranch(); return; } // 옛 서버: 글자·도형은 가지가 없다
    if (!canMap()) return;
    if (t.collapsed) onTextChange(id, {collapsed:false});
    const kids = childrenOf(tree, id), {ord, renumber} = ordAt(kids, kids.length);
    if (renumber.length) onTextsChange(renumber.map(n => ({id:n.id, patch:{ord:n.ord}})));
    const side = tree.parentOf.has(id) ? null : lighterSide(tree, id, sizeOfNode);
    startDraft({...parentFields(id), ord, side, ...kindOf(t)});
  }
  function addSibling(id) {
    const t = textById.get(id);
    if (isFree(t) && !branchReady()) { startEdit(id); return; } // 옛 서버 — 글자·도형: Enter = 글 고치기
    const parent = tree.parentOf.get(id); if (!parent) { addChild(id); return; }
    if (!t || opts.pickActive) return;
    if (!canMap()) return;
    const sibs = childrenOf(tree, parent), {ord, renumber} = ordAt(sibs, sibs.findIndex(k => k.id === id) + 1);
    if (renumber.length) onTextsChange(renumber.map(n => ({id:n.id, patch:{ord:n.ord}})));
    startDraft({...parentFields(parent), ord, side:lay.rects.get(id)?.side === -1 ? -1 : tree.parentOf.has(parent) ? null : 1, ...kindOf(t)});
  }
  // 초점: 상자면 상자, 카드면 카드 열기 단추.
  const focusAny = id => { if (places.has(id)) cardEls.get(id)?.querySelector('.nb-open')?.focus({preventScroll:true}); else focusNode(id); };
  // 지우기(K1 한 규칙, I-6): 지운 뒤 [되돌리기]가 있으면(onRemoveItems) 아래 가지가 있어도 묻지 않고 바로, 없으면 확인 창. 지운 뒤 초점은 위 상자(없으면 판).
  async function removeNode(id, anchor = null) {
    const t = textById.get(id); if (!t || t.pending || (onRemoveItems && opts.pickActive)) return; // 노트 고르기 중에는 판에서 지우지 않는다(removeItems와 같음)
    const below = descendants(tree, id).filter(k => k !== DRAFT).length;
    const ok = await confirmDelete({undo:!!onRemoveItems, ask:() => {
      const short = [...textOfCell(t).replace(/\s+/g, ' ')].slice(0, 16).join('') || (t.kind === 'table' ? '표' : t.kind === 'file' ? '파일' : '');
      return askConfirm(anchor || textEls.get(id) || box, {text:below ? `'${short}'와 아래 가지 ${below}개를 삭제할까요?` : `'${short}'를 삭제할까요?`, ok:'삭제', danger:true});
    }});
    if (!ok) { focusNode(id); return; }
    const parent = tree.parentOf.get(id);
    if (textSel === id) { textSel = null; closeBar(); }
    if (onRemoveItems) void removeItems({texts:[id]}); else onTextRemove(id); // S70-03: 지운 뒤 [되돌리기]
    if (parent && textOn.has(parent)) focusNode(parent);
  }

  // ---- 가장자리 자동 이동(끄는 손가락이 판 가장자리에 머물면 판이 그쪽으로 밀림) ----
  let edgeFrame = 0;
  function stopEdge() { if (edgeFrame) cancelAnimationFrame(edgeFrame); edgeFrame = 0; }
  function edgeStep(x, y) {
    const r = scroll.getBoundingClientRect();
    return {dx:x < r.left + EDGE ? EDGE_STEP : x > r.right - EDGE ? -EDGE_STEP : 0, dy:y < r.top + EDGE ? EDGE_STEP : y > r.bottom - EDGE ? -EDGE_STEP : 0};
  }
  function edgeLoop() {
    const live = drag?.moving ? drag : tdrag?.moving ? tdrag : wire; if (!live) { edgeFrame = 0; return; }
    const {dx, dy} = edgeStep(live.last.clientX, live.last.clientY);
    if (!dx && !dy) { edgeFrame = 0; return; }
    view = {...view, x:view.x + dx, y:view.y + dy}; paintView(); sync();
    if (drag?.moving) follow(); else if (tdrag?.moving) followText(); else followWire();
    edgeFrame = requestAnimationFrame(edgeLoop);
  }
  const edgeKick = () => { if (!edgeFrame) edgeFrame = requestAnimationFrame(edgeLoop); };

  // ---- 두 손가락(확대·축소 + 이동) ----
  // ---- S70-03 새로 쓰는 칸(뿌리 주제·글자) 둘레 끌기: 글쓰기는 그대로 두고 자리만 옮긴다(저장은 글을 다 쓴 뒤 그 자리로). ----
  function followDraft(e) {
    if (!draft || !ddrag) return;
    const p = pointOf(e), x = clampCoord(ddrag.start.x + p.x - ddrag.p0.x), y = clampCoord(ddrag.start.y + p.y - ddrag.p0.y);
    draft = {...draft, x, y};
    const n = tree.byId.get(DRAFT); if (n) { n.x = x; n.y = y; }
    relayout();
  }
  function endDraftDrag(cancel = false) {
    const d = ddrag; if (!d) return; ddrag = null;
    if (d.moved) {
      dragOn(false); textEls.get(DRAFT)?.classList.remove('nb-dragging'); suppressUntil = Date.now() + 300;
      if (cancel && draft) { draft = {...draft, ...d.start}; const n = tree.byId.get(DRAFT); if (n) Object.assign(n, d.start); relayout(); }
    }
    if (editing?.isNew && document.activeElement !== editing.area) editing.area.focus({preventScroll:true});
  }
  function startPinch() {
    endDraftDrag(true);
    cancelDrag(); cancelWire(); cancelTextDrag(); cancelBend(); cancelResize(); cancelLineEnd(); lmove = null; pan = null;
    const [a, b] = [...touches.values()];
    pinch = {d:Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), mid:{x:(a.x + b.x) / 2, y:(a.y + b.y) / 2}, view:{...view}};
    suppressUntil = linesQuietUntil = Date.now() + 600; dragOn(true);
  }
  function movePinch() {
    const [a, b] = [...touches.values()]; if (!a || !b) return;
    const d = Math.hypot(b.x - a.x, b.y - a.y), mid = {x:(a.x + b.x) / 2, y:(a.y + b.y) / 2};
    const z = clampZoom(pinch.view.z * d / pinch.d), bx = (pinch.mid.x - pinch.view.x) / pinch.view.z, by = (pinch.mid.y - pinch.view.y) / pinch.view.z;
    setView({x:mid.x - bx * z, y:mid.y - by * z, z});
  }

  scroll.addEventListener('pointerdown', e => {
    afterClick = null; bendEnded = false; // 새 누름 = 앞 손짓의 뒷일은 끝
    lastPointer = e.pointerType || '';
    if (insertOpen && !e.target.closest?.('.nb-insert,[data-nb-insert-open]')) closeInsert();
    closeLineMenuIfOutside(e.target);
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, local(e));
      if (touches.size === 2) { startPinch(); return; }
      if (touches.size > 2) return;
    }
    if (!e.isPrimary || multiTouchActive() || pinch) return; // 판 밖 두 번째 손가락(공용 지킴이)·판 안 두 손가락 중에는 끌기·긋기를 시작하지 않는다
    const startPan = () => { pan = {pointerId:e.pointerId, x:e.clientX, y:e.clientY, view:{...view}, moved:false}; try { scroll.setPointerCapture(e.pointerId); } catch { /* 잡기 실패해도 움직임은 받는다 */ } };
    // S69-33: PC 마우스 판 이동 = 가운데 단추 끌기·Space를 누른 채 끌기(카드 위에서도). 빈 곳 왼쪽 끌기는 사각형 고르기.
    if (e.pointerType === 'mouse' && (e.button === 1 || (e.button === 0 && spaceDown)) && !e.target.closest?.('.nb-tools,.nb-selbar,.nb-node-bar,[data-nb-text-edit]')) { e.preventDefault(); startPan(); return; }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const lgrip = e.target.closest?.('[data-nb-lend]');
    if (lgrip) { startLineEnd(e, lgrip); return; } // 고른 선의 끝 동그라미
    const grip = e.target.closest?.('[data-nb-resize]');
    if (grip) { startResize(e, grip); return; } // 크기 손잡이(글 쓰는 중에도)
    // S70-03: 폰은 손가락 닿는 범위가 넓어 둘레 띠를 눌러도 입력칸이 잡힌다 — 새로 쓰는 칸(뿌리·글자)은 입력칸 안에서 끌어도 옮긴다(짧게 누르면 글쓰기 그대로).
    if (e.pointerType === 'touch' && editing?.isNew && draft && !draft.parent_id && !opts.pickActive && e.target.closest?.('[data-nb-text-edit]') === editing.area) {
      ddrag = {pointerId:e.pointerId, x:e.clientX, y:e.clientY, p0:pointOf(e), start:{x:draft.x, y:draft.y}, touch:true, moved:false}; return;
    }
    if (e.target.closest?.('[data-nb-text-edit],[data-nb-fold],[data-nb-mats]')) return; // 입력칸 안·접기 단추·재료 칩(S71-54)은 그대로(click이 맡는다)
    if (e.target.closest?.('.nb-tools,.nb-selbar,.nb-node-bar')) return; // 도구 줄·고른 카드 줄·상자 막대 단추는 그대로(click이 맡는다)
    const handle = e.target.closest?.('[data-nb-handle]');
    if (handle) { // 손잡이 → 연결선 긋기(노트 카드·글 상자)
      const card = handle.closest('[data-nb-card]'), textEl = card ? null : handle.closest('[data-nb-text]');
      const id = card?.dataset.nbCard || textEl?.dataset.nbText, kind = card ? 'note' : 'text';
      if (!id || (kind === 'note' ? !places.has(id) : !textById.has(id) || textById.get(id).pending)) return;
      e.preventDefault(); if (kind === 'note') select(id); else selectText(id);
      // S70-77: 선은 누른 동그라미 가운데에서 시작한다(보이는 곳 = 잡는 곳). 판 좌표로 한 번 재 둔다(끄는 동안 판이 밀려도 그 점).
      const hr = handle.getBoundingClientRect(), origin = pointOf({clientX:hr.left + hr.width / 2, clientY:hr.top + hr.height / 2});
      // S71-53: Alt를 누른 채 끌기 = 관계선(관계선 칸이 없는 서버면 '준비 중' 한 줄 — 일반 선으로 긋지 않음).
      const relation = e.altKey && !e.ctrlKey && !e.metaKey;
      if (relation && !relationReady()) { canRelation(); return; }
      wire = {from:id, kind, side:handle.dataset.nbHandle, origin, grip:handle, pointerId:e.pointerId, x:e.clientX, y:e.clientY, target:null, relation, last:{clientX:e.clientX, clientY:e.clientY}};
      handle.classList.add('nb-h-on');
      box.classList.add('nb-wiring'); box.classList.toggle('nb-wiring-rel', relation); dragOn(true); followWire(); placeBar();
      try { scroll.setPointerCapture(e.pointerId); } catch { /* 잡기 실패해도 움직임은 받는다 */ }
      return;
    }
    const card = e.target.closest?.('[data-nb-card]');
    if (card) {
      if (e.target.closest('.nb-more,.nb-x')) return;
      const id = card.dataset.nbCard, place = places.get(id); if (!place) return;
      if (drag) cancelDrag();
      photoTap = card.classList.contains('nb-card-photo') ? {id, was:selected === id && !multi.size, touch:e.pointerType !== 'mouse'} : null;
      // S69-33: Shift·Ctrl(맥 ⌘)+클릭 = 여러 장 고르기에 더하기·빼기(열지 않음).
      if (e.pointerType === 'mouse' && (e.shiftKey || e.ctrlKey || e.metaKey) && !opts.pickActive) { e.preventDefault(); suppressUntil = Date.now() + 400; toggleMulti(id); return; }
      // 고른 카드 하나를 끌면 고른 카드들이 함께 움직인다(각자 끌기 전 자리에서 같은 만큼).
      const together = multi.has(id) && multi.size > 1;
      const group = together ? multiCards().filter(g => g !== id && places.has(g)).map(g => ({id:g, place:places.get(g)})) : [];
      const textIds = new Set(together ? multiTexts().flatMap(t => [t, ...descendants(tree, t)]).filter(k => textOn.has(k)) : []);
      const skip = new Set([id, ...group.map(g => g.id), ...[...textIds].map(tKey)]);
      drag = {id, card, place, group, textIds, skip, start:pointOf(e), x:e.clientX, y:e.clientY, last:{clientX:e.clientX, clientY:e.clientY}, moving:false, held:false, touch:e.pointerType !== 'mouse', pointerId:e.pointerId, timer:null};
      if (drag.touch) {
        dragOn(true);
        drag.timer = setTimeout(() => { // 폰: 움직이지 않고 꾹 누르면 그 카드를 고른다(손잡이·×·⋯가 보임). 이미 다른 카드를 골라 두었으면 함께 고르기.
          if (!drag || drag.card !== card || drag.moving) return;
          drag.held = true; card.classList.add('nb-held'); raise(card, topZ(places) + 1);
          if (!opts.pickActive && (multi.size || (selected && selected !== id) || textSel)) { const next = new Set(multi); if (selected) next.add(selected); if (textSel) next.add(tKey(textSel)); next.add(id); setMulti(next); }
          else select(id);
          try { navigator.vibrate?.(12); } catch { /* 진동 없음 */ }
        }, LONG_MS);
      }
      return;
    }
    const textEl = e.target.closest?.('[data-nb-text]');
    if (textEl && editing?.el === textEl && editing.isNew) { // S70-03: 새로 쓰는 칸 둘레 — 누르기 = 글쓰기 그대로(입력칸 초점을 잃지 않게), 끌기 = 옮기기(뿌리·글자만)
      e.preventDefault(); closeLineMenu();
      if (draft && !draft.parent_id && !opts.pickActive) {
        ddrag = {pointerId:e.pointerId, x:e.clientX, y:e.clientY, p0:pointOf(e), start:{x:draft.x, y:draft.y}, touch:e.pointerType !== 'mouse', moved:false};
        try { scroll.setPointerCapture(e.pointerId); } catch { /* 잡기 실패해도 움직임은 받는다 */ }
      }
      return;
    }
    if (textEl) { // 상자: 끌기 = 그 가지째 옮기기, 짧게 누름 = 고르기(고른 상자면 고치기)
      const id = textEl.dataset.nbText, t = textById.get(id); if (!t || t.pending || (editing?.el === textEl && editing.isNew)) return;
      if (editing?.el === textEl) e.preventDefault(); // 글 쓰는 중 테두리 끌기 = 옮기기(입력칸 초점은 그대로)
      if (tdrag) cancelTextDrag();
      closeLineMenu();
      // S69-88: 여러 개 고른 중이면 고른 상자·카드를 함께 옮긴다(가지 놓을 곳 찾기는 하나만 끌 때만).
      const together = multi.has(tKey(id)) && multi.size > 1;
      const group = together ? multiTexts().filter(k => textById.has(k) && !textById.get(k).pending) : [id];
      if (!group.includes(id)) group.unshift(id);
      const ids = new Set(group.flatMap(k => [k, ...descendants(tree, k)]).filter(k => textOn.has(k)));
      const cards = together ? multiCards().filter(c => places.has(c)).map(c => ({id:c, place:places.get(c)})) : [];
      const skip = new Set([...[...ids].map(tKey), ...cards.map(c => c.id)]);
      tdrag = {id, el:textEl, ids, group, cards, skip, dx:0, dy:0, drop:null, wasSel:textSel === id, cell:t.kind === 'table' ? cellOf(e.target, textEl) : null, start:pointOf(e), x:e.clientX, y:e.clientY, last:{clientX:e.clientX, clientY:e.clientY}, moving:false, held:false, touch:e.pointerType !== 'mouse', pointerId:e.pointerId, timer:null};
      if (tdrag.touch) {
        dragOn(true);
        tdrag.timer = setTimeout(() => { // 폰: 꾹 누르면 고르기([삭제]·손잡이가 보임)
          if (!tdrag || tdrag.el !== textEl || tdrag.moving) return;
          tdrag.held = true; textEl.classList.add('nb-held');
          // S69-88: 이미 다른 것을 골라 두었으면 함께 고르기(카드와 같은 길), 아니면 이 상자 하나.
          if (!opts.pickActive && (multi.size || selected || (textSel && textSel !== id))) setMulti(new Set([...multi, ...(selected ? [selected] : []), ...(textSel ? [tKey(textSel)] : []), tKey(id)]));
          else selectText(id);
          try { navigator.vibrate?.(12); } catch { /* 진동 없음 */ }
        }, LONG_MS);
      }
      return;
    }
    const hit = e.target.closest?.('[data-nb-hit]');
    if (hit) { // 선: 끌면 곡선(판 이동보다 먼저), 짧게 누르면 메뉴(click이 맡는다)
      const l = links.find(k => k.id === hit.dataset.nbHit);
      if (l && !l.pending && hit.hasAttribute('data-nb-free-line') && linesReady()) lmove = {id:l.id, pointerId:e.pointerId, x:e.clientX, y:e.clientY, start:pointOf(e), touch:e.pointerType !== 'mouse', moved:false, dx:0, dy:0};
      else if (l && !l.pending) bend = {id:l.id, pointerId:e.pointerId, x:e.clientX, y:e.clientY, touch:e.pointerType !== 'mouse', moved:false, now:null};
      return;
    }
    // 빈 곳: 손가락 = 판 이동, 마우스 = 사각형 고르기(marquee-select가 mousedown에서 맡는다) — 끌지 않고 떼면 고르기 풀기.
    if (e.pointerType === 'mouse') { blankDown = {pointerId:e.pointerId}; return; }
    startPan();
  });
  scroll.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) { touches.set(e.pointerId, local(e)); if (pinch) { e.preventDefault(); movePinch(); return; } }
    if (rz && e.pointerId === rz.pointerId) { e.preventDefault(); followResize(e); return; }
    if (ddrag && e.pointerId === ddrag.pointerId) {
      if (!ddrag.moved) {
        if (Math.hypot(e.clientX - ddrag.x, e.clientY - ddrag.y) <= (ddrag.touch ? SLOP : 4)) return;
        ddrag.moved = true; dragOn(true); textEls.get(DRAFT)?.classList.add('nb-dragging');
      }
      e.preventDefault(); followDraft(e); return;
    }
    if (wire && e.pointerId === wire.pointerId) { e.preventDefault(); wire.last = {clientX:e.clientX, clientY:e.clientY}; followWire(); edgeKick(); return; }
    if (lend && e.pointerId === lend.pointerId) { e.preventDefault(); followLineEnd(e); return; }
    if (lmove && e.pointerId === lmove.pointerId) {
      if (!lmove.moved) {
        if (Math.hypot(e.clientX - lmove.x, e.clientY - lmove.y) <= (lmove.touch ? SLOP : 4)) return;
        lmove.moved = true; dragOn(true);
        try { scroll.setPointerCapture(e.pointerId); } catch { /* 잡기 실패해도 움직임은 받는다 */ }
      }
      e.preventDefault(); followLineMove(e); return;
    }
    if (bend && e.pointerId === bend.pointerId) {
      if (!bend.moved) {
        if (Math.hypot(e.clientX - bend.x, e.clientY - bend.y) <= (bend.touch ? SLOP : 4)) return;
        bend.moved = true; dragOn(true); closeLineMenu();
        try { scroll.setPointerCapture(e.pointerId); } catch { /* 잡기 실패해도 움직임은 받는다 */ }
      }
      e.preventDefault(); followBend(e); return;
    }
    if (tdrag && e.pointerId === tdrag.pointerId) {
      tdrag.last = {clientX:e.clientX, clientY:e.clientY, altKey:e.altKey};
      if (!tdrag.moving) {
        if (Math.hypot(e.clientX - tdrag.x, e.clientY - tdrag.y) <= (tdrag.touch ? SLOP : 4)) return;
        tdrag.moving = true; clearTimeout(tdrag.timer); selectText(tdrag.id); placeBar();
        tdrag.el.classList.remove('nb-held');
        for (const id of tdrag.ids) textEls.get(id)?.classList.add('nb-dragging');
        liftDrag();
        try { scroll.setPointerCapture(e.pointerId); } catch { /* 잡기 실패해도 움직임은 받는다 */ }
      }
      e.preventDefault(); followText(); edgeKick(); return;
    }
    if (pan && e.pointerId === pan.pointerId) {
      const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
      if (!pan.moved && Math.hypot(dx, dy) <= (e.pointerType === 'mouse' ? 3 : SLOP)) return;
      if (!pan.moved) { pan.moved = true; dragOn(true); box.classList.add('nb-panning'); }
      e.preventDefault(); setView({...pan.view, x:pan.view.x + dx, y:pan.view.y + dy}); return;
    }
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.last = {clientX:e.clientX, clientY:e.clientY, altKey:e.altKey};
    if (!drag.moving) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) <= (drag.touch ? SLOP : 4)) return;
      drag.moving = true; clearTimeout(drag.timer); select(drag.id);
      drag.card.classList.remove('nb-held'); drag.card.classList.add('nb-dragging'); raise(drag.card, topZ(places) + 1);
      try { drag.card.setPointerCapture(e.pointerId); } catch { /* 잡기 실패해도 움직임은 받는다 */ }
    }
    e.preventDefault(); follow(); edgeKick();
  });
  const up = e => {
    if (e.pointerType === 'touch') {
      touches.delete(e.pointerId);
      if (pinch) { if (touches.size < 2) { pinch = null; if (!touches.size) dragOn(false); } return; }
    }
    if (rz && e.pointerId === rz.pointerId) { if (e.type === 'pointercancel') cancelResize(); else finishResize(e); return; }
    if (ddrag && e.pointerId === ddrag.pointerId) { if (e.type !== 'pointercancel' && ddrag.moved) followDraft(e); endDraftDrag(e.type === 'pointercancel'); return; }
    if (wire && e.pointerId === wire.pointerId) { if (e.type === 'pointercancel') cancelWire(); else finishWire(e); return; }
    if (lend && e.pointerId === lend.pointerId) { if (e.type === 'pointercancel') cancelLineEnd(); else finishLineEnd(e); return; }
    if (lmove && e.pointerId === lmove.pointerId) {
      if (!lmove.moved) { const m = lmove; lmove = null; if (e.type !== 'pointercancel' && Date.now() >= linesQuietUntil) { bendEnded = true; lineTap(m.id, e); } } // 짧게 누름 = 선 메뉴
      else if (e.type === 'pointercancel') { const m = lmove; lmove = null; dragOn(false); const l = links.find(k => k.id === m.id); if (l && lineEls.has(l.id)) paintLine(l); }
      else finishLineMove();
      return;
    }
    if (bend && e.pointerId === bend.pointerId) {
      // 짧게 누름 = 선 메뉴(손 뗄 때 바로 연다 — 폰에서 click이 늦거나 빠지는 경우에도). 뒤따르는 click은 한 번 넘긴다.
      if (!bend.moved) { const b = bend; bend = null; if (e.type !== 'pointercancel' && Date.now() >= linesQuietUntil) { bendEnded = true; lineTap(b.id, e); } }
      else if (e.type === 'pointercancel') cancelBend(); else finishBend();
      return;
    }
    if (tdrag && e.pointerId === tdrag.pointerId) { if (e.type === 'pointercancel') cancelTextDrag(); else { if (tdrag.moving) tdrag.last = {clientX:e.clientX, clientY:e.clientY, altKey:e.altKey}; finishTextDrag(e); } return; } // 손 뗀 자리 그대로(마지막 움직임이 늦어도)
    if (pan && e.pointerId === pan.pointerId) {
      const p = pan; pan = null; dragOn(false); box.classList.remove('nb-panning');
      if (!p.moved && e.type !== 'pointercancel') { // 빈 곳 누름 = 고르기 풀기(쓰던 상자는 저장), 폰에서 빠르게 두 번 = 새 상자
        // S69-82: 쓰던 상자는 여기서 바로 저장한다. 입력칸이 초점을 잃는 것(blur)에만 기대면, 폰이 이 누름을 두 번 누르기 손짓으로 삼켜
        // 흉내 마우스 누름이 오지 않을 때 입력칸이 열린 채 남았다.
        if (editing) { void endEdit(true); lastTap = null; return; }
        select(null); clearMulti(); closeLineMenu();
        const now = Date.now(), here = {x:e.clientX, y:e.clientY};
        if (e.pointerType !== 'mouse' && lastTap && now - lastTap.t < 350 && Math.hypot(here.x - lastTap.x, here.y - lastTap.y) < 24) { lastTap = null; const at = pointOf(e); afterClick = {run:() => newText(at)}; }
        else lastTap = e.pointerType === 'mouse' ? null : {t:now, ...here};
      }
      else suppressUntil = linesQuietUntil = Date.now() + 300;
      return;
    }
    if (blankDown && e.pointerId === blankDown.pointerId) { // 마우스 빈 곳: 사각형을 그리지 않고 떼면 고르기 풀기
      blankDown = null;
      if (!marquee.active && e.type !== 'pointercancel') { if (editing) void endEdit(true); select(null); clearMulti(); closeLineMenu(); if (key) pasteAt = {key, ...pointOf(e)}; }
      return;
    }
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (e.type === 'pointercancel') cancelDrag(); else finishDrag(e);
  };
  scroll.addEventListener('pointerup', up); scroll.addEventListener('pointercancel', up);
  // 터치는 처음 누른 안쪽 요소(제목 글자 등)가 잡고 있다가 끌기 시작에 칸으로 잡기를 옮기면 안쪽 요소에 lostpointercapture가 온다. 칸 자체가 잃었을 때만 끝낸다.
  scroll.addEventListener('lostpointercapture', e => { if (drag && drag.moving && e.pointerId === drag.pointerId && e.target === drag.card) finishDrag(e); });
  // 판 위 touchmove는 브라우저 몫(문서 스크롤·당겨서 새로고침·튕김·옆 넘김)으로 넘기지 않는다(CSS touch-action:none과 함께).
  scroll.addEventListener('touchmove', e => { if (e.cancelable) e.preventDefault(); }, {passive:false});
  // PC: 빈 곳 더블클릭 = 그 자리에 글 상자.
  scroll.addEventListener('dblclick', e => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t || t.closest('[data-nb-card],[data-nb-text],[data-nb-hit],.nb-tools,.nb-node-bar') || lastTap && Date.now() - lastTap.t < 400) return;
    e.preventDefault(); newText(pointOf(e));
  });
  // 휠: 판 이동, Ctrl(맥 ⌘)·트랙패드 벌리기 = 확대·축소(마우스 자리 기준).
  scroll.addEventListener('wheel', e => {
    e.preventDefault(); closeLineMenu();
    if (e.ctrlKey || e.metaKey) { const p = local(e); setView(zoomAt(view, view.z * Math.exp(-e.deltaY * 0.0025), p.x, p.y)); }
    else setView({...view, x:view.x - e.deltaX, y:view.y - e.deltaY});
  }, {passive:false});
  // 마우스를 올린 카드: ×·⋯·손잡이를 보인다(터치는 고르기로만). 기기 hover 판정 대신 실제 마우스 움직임으로.
  // S71-48(B2): 손잡이(연결점 동그라미·⋯·×)는 상자 밖에 떠 있으므로, 보이는 동안은 '상자 + 보이는 손잡이를 둘러싼 띠' 안이면 계속 올린 것으로 본다
  // (상자 테두리만 보던 판정은 동그라미로 가는 틈에서 끊겼다). 띠가 이웃 상자와 겹치면 커서에 가까운 상자 것만, 띠 밖이면 HOVER_LEAVE_MS 뒤 내림. 계산은 hover-band.mjs.
  const HOVER_SEL = '[data-nb-card],[data-nb-text]', HOVER_PARTS = '.nb-h,.nb-more,.nb-x';
  let hoverCard = null, hoverOff = 0;
  const setHover = el => {
    clearTimeout(hoverOff); hoverOff = 0;
    if (el === hoverCard) return;
    hoverCard?.classList.remove('nb-hover'); hoverCard = el; el?.classList.add('nb-hover');
  };
  const leaveHover = () => {
    if (!hoverCard || hoverOff) return;
    hoverOff = setTimeout(() => { hoverOff = 0; hoverCard?.classList.remove('nb-hover'); hoverCard = null; }, HOVER_LEAVE_MS);
  };
  const hoverAt = e => {
    if (!hoverCard?.isConnected) hoverCard = null;
    const direct = e.target instanceof Element ? e.target.closest(HOVER_SEL) : null;
    if (direct || !hoverCard) { if (direct) setHover(direct); else leaveHover(); return; }
    const point = {x:e.clientX, y:e.clientY}, rect = hoverCard.getBoundingClientRect();
    const band = bandOf(rect, [...hoverCard.querySelectorAll(HOVER_PARTS)].map(h => h.getBoundingClientRect()));
    if (!inside(point, band)) { leaveHover(); return; }
    const reach = reachOf(rect, band), others = [];
    for (const el of box.querySelectorAll(HOVER_SEL)) {
      if (el === hoverCard) continue;
      const r = el.getBoundingClientRect();
      if (r.width && distTo(point, r) <= reach) others.push({key:el, rect:r});
    }
    setHover(pickHover({point, current:{key:hoverCard, rect, band}, others}));
  };
  scroll.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && !e.buttons) hoverAt(e); });
  scroll.addEventListener('pointerover', e => { if (e.pointerType === 'mouse') hoverAt(e); });
  scroll.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') leaveHover(); });
  // 끈 뒤·꾹 누른 뒤·두 손가락 뒤의 클릭은 열기가 아니다(×·⋯는 끈 바로 뒤에도 누를 수 있다).
  box.addEventListener('click', e => { if (Date.now() < suppressUntil && e.target.closest?.('[data-nb-card] .nb-open')) { e.preventDefault(); e.stopPropagation(); } }, true);
  // S71-49 [나](사용자 결정 2026-11-26 "나는 보드위에서 이 사진을 보고싶을 뿐"): 사진 카드 누르기는 노트 화면으로 가지 않는다.
  // 한 번 누름 = 그 카드 고르기(옮기기·크기 손잡이), PC 두 번 누름(dblclick)·폰 고른 사진 한 번 더 누름·키보드 Enter = 보드 위 크게 보기(공용 photo-view.js).
  // 노트 화면은 카드 ⋯(우클릭) 메뉴 [수정]으로 간다(메뉴는 그대로). 고르기 중(pickActive)·잠긴 카드는 지금 그대로.
  const photoCardOf = t => { const c = t?.closest?.('[data-nb-card].nb-card-photo'); return c && !c.hasAttribute('data-nb-locked') && infoOf.get(c.dataset.nbCard)?.photo ? c : null; };
  function viewPhoto(card) {
    const id = card.dataset.nbCard, info = infoOf.get(id); if (!info?.photo || info.locked || !onPhotoView) return;
    select(id); onPhotoView(id, info.photo, card.querySelector('.nb-open') || card);
  }
  box.addEventListener('click', e => {
    if (!onPhotoView || opts.pickActive || !e.target.closest?.('.nb-open')) return;
    const card = photoCardOf(e.target); if (!card) return;
    e.preventDefault(); e.stopPropagation();
    const tap = photoTap; photoTap = null;
    if (Date.now() < suppressUntil || e.shiftKey || e.ctrlKey || e.metaKey) return;
    if (e.detail === 0 || (tap?.touch && tap.id === card.dataset.nbCard && tap.was)) { viewPhoto(card); return; }
    clearMulti(); select(card.dataset.nbCard);
  }, true);
  box.addEventListener('dblclick', e => {
    if (!onPhotoView || opts.pickActive || lastPointer === 'touch' || e.target.closest?.('.nb-more,.nb-x,[data-nb-handle],[data-nb-resize]')) return;
    const card = photoCardOf(e.target); if (!card) return;
    e.preventDefault(); viewPhoto(card);
  });
  box.addEventListener('contextmenu', e => { if (drag?.touch || tdrag?.touch || wire || rz || pinch || Date.now() < suppressUntil) { e.preventDefault(); return; } const card = e.target.closest?.('[data-nb-card]'); if (card) select(card.dataset.nbCard); }, true);
  // UI-우클릭전수(2026-11-03): PC에서 빈 판(카드·선·도구 줄 밖)을 우클릭하면 브라우저 메뉴 대신 웹2 메뉴(onBackgroundMenu). 카드 위는 공용 context-menu.js가 카드의 ⋯를 연다.
  box.addEventListener('contextmenu', e => {
    if (!onBackgroundMenu || e.defaultPrevented || e.pointerType === 'touch' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    const t = e.target instanceof Element ? e.target : null;
    if (!t || t.closest('[data-nb-card],[data-nb-text],[data-nb-hit],.nb-tools,input,textarea,select,[contenteditable],a[href]')) return;
    e.preventDefault(); onBackgroundMenu(e.clientX, e.clientY);
  });
  // S70-03 NOTE-보드우클릭: PC에서 상자·글자·도형 오른쪽 클릭 = 그 자리 작은 메뉴(공용 줄 메뉴 row-menu.js — 달력·목록 우클릭과 같은 부품):
  // 수정·+ 하위·+ 형제·색·테두리·글자·모양·글자 크기·삭제(위 막대와 같은 동작). 선 = 선 메뉴(삭제 포함). 여러 개 고른 것 위 = 고른 것 전체 메뉴.
  // 카드 하나는 지금처럼 카드 ⋯ 메뉴(공용 context-menu.js, [보드에서 빼기] 포함). 브라우저 기본 메뉴는 보드 요소 위에서만 막는다(빈 판은 위 판 메뉴).
  box.addEventListener('contextmenu', e => {
    if (e.defaultPrevented || opts.pickActive) return;
    const t = e.target instanceof Element ? e.target : null; if (!t || t.closest('textarea,input')) return;
    const matEl = t.closest('[data-nb-mat]'); // S71-54: 재료 칩 우클릭 = 칩 메뉴
    if (matEl) { const at = appMenuPoint(e, matEl); if (!at) return; e.preventDefault(); e.stopPropagation(); openMaterialMenu(matEl.dataset.nbMat, matEl, at); return; }
    const textEl = t.closest('[data-nb-text]'), hit = textEl ? null : t.closest('[data-nb-hit]'), card = textEl || hit ? null : t.closest('[data-nb-card]');
    const own = textEl || hit || card; if (!own) return;
    const at = appMenuPoint(e, own); if (!at) return;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    const k = textEl ? tKey(textEl.dataset.nbText) : card?.dataset.nbCard;
    if (multi.size > 1 && k && multi.has(k)) { stop(); openMultiMenu(own, at); return; }
    if (hit) { const l = links.find(x => x.id === hit.dataset.nbHit); if (l && !l.pending) { stop(); clearMulti(); select(null); openLineMenu(l.id, at.x, at.y); } return; }
    if (!textEl) return;
    const id = textEl.dataset.nbText, node = textById.get(id); stop();
    if (!node || node.pending || editing?.el === textEl) return;
    closeLineMenu(); clearMulti(); selectText(id); openNodeMenu(id, textEl, at);
  }, true);
  // S70-77 [노트로 만들기]: 글이 있고 아래 가지가 없는 상자 → 그 글(첫 줄 = 제목)로 새 노트, 상자 자리에 그 노트 카드(붙은 선은 카드로 옮겨 붙고,
  // 가지였으면 위 상자와 선으로 잇는다). 저장 길은 부르는 쪽(onTextToNote — 노트 만들기·보드에 붙이기·선 옮기기·상자 지우기) 하나.
  function canNote(t) { return !!onTextToNote && !!t && !t.pending && !!String(t.body || '').trim() && !childrenOf(tree, t.id).length; }
  function textToNote(id) {
    const t = textById.get(id); if (!canNote(t) || opts.pickActive) return;
    if (editing) void endEdit(true);
    const r = lay.rects.get(id), at = r ? {x:r.x + r.w / 2, y:r.y + r.h / 2} : {x:t.x, y:t.y};
    selectText(null); closeBar();
    void onTextToNote({id, body:t.body, at, parent:tree.parentOf.get(id) || null});
  }
  function openNodeMenu(id, el, at) {
    const t = textById.get(id); if (!t) return;
    const map = mapReady(), decor = map && decorReady();
    const tableNow = t.kind === 'table' && cellsReady(); // S71-56: 표 = 줄·칸 더하기·빼기, 파일 = [열기]
    const items = [t.kind === 'file' ? {id:'open-file', label:'열기'} : {id:'edit', label:'수정'},
      tableNow && {id:'tbl-row+', label:'줄 더하기', sep:true}, tableNow && {id:'tbl-row-', label:'줄 빼기'}, tableNow && {id:'tbl-col+', label:'칸 더하기'}, tableNow && {id:'tbl-col-', label:'칸 빼기'},
      map && canGrow(t) && {id:'child', label:'+ 하위', icon:ROW_MENU_ICON.mkdir}, map && canGrow(t) && {id:'sibling', label:'+ 형제', icon:ROW_MENU_ICON.mkdir},
      map && {id:'tone', label:'색', icon:ROW_MENU_ICON.color, popup:true, sep:true}, decor && {id:'stroke', label:'테두리', popup:true}, decor && {id:'ink', label:'글자', popup:true},
      map && t.kind !== 'label' && !isCellKind(t.kind) && (t.kind !== 'shape' || decor) && {id:'shape', label:'모양', popup:true},
      map && {id:'font-1', label:'글자 작게', disabled:t.font <= FONT_MIN}, map && {id:'font1', label:'글자 크게', disabled:t.font >= FONT_MAX},
      canNote(t) && {id:'to-note', label:'노트로 만들기', sep:true},
      relationReady() && {id:'relate', label:'관계 잇기', sep:!canNote(t)}, relationReady() && relationCount(id) && {id:'relations', label:`관계 ${relationCount(id)}개`},
      materialReady() && onMaterialPick && {id:'material', label:'재료 잇기', sep:!canNote(t) && !relationReady()},
      {id:'delete', label:'삭제', last:true}];
    const short = [...textOfCell(t).replace(/\s+/g, ' ')].slice(0, 20).join('');
    const SEL = {edit:'[data-nb-bar-edit]', child:'[data-nb-bar-child]', sibling:'[data-nb-bar-sibling]', tone:'[data-nb-bar-open="tone"]', stroke:'[data-nb-bar-open="stroke"]',
      ink:'[data-nb-bar-open="ink"]', shape:'[data-nb-bar-open="shape"]', 'font-1':'[data-nb-font="-1"]', font1:'[data-nb-font="1"]', 'to-note':'[data-nb-to-note]', delete:'[data-nb-bar-del]'};
    openRowMenu(el, {key:`nb-node:${id}`, label:short || ({shape:'도형', label:'글자', table:'표', file:'파일'}[t.kind] || '상자'), items, at, run:item => {
      if (!textById.has(id)) return;
      if (item === 'open-file') { openFile(id); return; }
      if (String(item).startsWith('tbl-')) { tableOp(id, String(item).slice(4)); return; }
      if (item === 'relate') { startRelation(id); return; }
      if (item === 'relations') { openRelations(id, textEls.get(id) || el, at); return; }
      if (item === 'material') { pickMaterial(id, textEls.get(id) || el); return; }
      if (textSel !== id) selectText(id);
      const b = bar.querySelector(SEL[item]); if (!b) return;
      if (b.dataset.nbBarOpen) { barOpen = null; } // 펼칠 줄은 막대에서 바로 열린 채로(한 번 누름 = 열기)
      barAction(b);
    }});
  }
  // ---- S71-54 주제 재료 ----
  const materialOf = mid => { for (const t of texts) { const m = (materialsOf(t.id) || []).find(x => x.id === mid); if (m) return m; } return null; };
  function pickMaterial(id, anchor) {
    const t = textById.get(id); if (!t || t.pending || opts.pickActive || !onMaterialPick) return;
    if (!materialReady()) return;
    if (editing) void endEdit(true);
    onMaterialPick(id, anchor && anchor.isConnected ? anchor : textEls.get(id) || box);
  }
  function openMaterial(mid, el) { const m = materialOf(mid); if (!m || m.pending || opts.pickActive) return; onMaterialOpen?.(m, el); }
  function openMaterialMenu(mid, el, at) {
    const m = materialOf(mid); if (!m || m.pending) return;
    openRowMenu(el, {key:`nb-mat:${mid}`, label:m.name, at, items:[{id:'open', label:m.kind === 'link' ? '새 탭에서 열기' : '열기'}, {id:'unlink', label:'잇기 풀기', last:true}],
      run:item => { if (item === 'open') openMaterial(mid, el); else if (item === 'unlink') onMaterialRemove?.(m); }});
  }
  function openMultiMenu(el, at) {
    const sel = selection(), n = sel.cards.length + sel.texts.length, onlyCards = !sel.texts.length;
    openRowMenu(el, {key:'nb-multi', label:`${n}개 선택`, at, items:[{id:'clear', label:'선택 해제'}, {id:'delete', label:onlyCards ? `보드에서 빼기 ${n}개` : `${n}개 삭제`, last:true}],
      run:item => { if (item === 'clear') { clearMulti(); select(null); } else if (item === 'delete') removeMulti(); }});
  }
  box.addEventListener('click', e => {
    if (afterClick) { const run = afterClick.run; afterClick = null; run(); return; }
    const z = e.target.closest?.('[data-nb-zoom]'); if (z && !z.disabled) { zoomBy(Number(z.dataset.nbZoom)); return; }
    if (e.target.closest?.('[data-nb-fit]')) { fitBoard(); return; }
    if (e.target.closest?.('[data-nb-full]')) { if (full) exitFull(); else enterFull(); return; }
    if (e.target.closest?.('[data-nb-side-toggle]')) { toggleSide(); return; }
    if (e.target.closest?.('[data-nb-sel-remove]')) { if (onRemoveItems) void removeItems({cards:multiCards()}); else removeMulti(); return; } // [보드에서 빼기] = 고른 카드만
    if (e.target.closest?.('[data-nb-sel-clear]')) { clearMulti(); select(null); return; }
    if (e.target.closest?.('[data-nb-add-text]')) { closeInsert(); const {w, h} = size(); newText(freeSpot(toBoard(view, w / 2 - 60, h / 2 - 18))); return; }
    if (e.target.closest?.('[data-nb-add-label]')) { closeInsert(); newLabel(viewCenter()); return; }
    if (e.target.closest?.('[data-nb-add-image]')) { closeInsert(); box.querySelector('[data-nb-image-input]')?.click(); return; }
    const ins = e.target.closest?.('[data-nb-insert-open]'); if (ins) { toggleInsert(ins.dataset.nbInsertOpen); return; }
    const addShape = e.target.closest?.('[data-nb-add-shape]'); if (addShape) { closeInsert(); void newShape(addShape.dataset.nbAddShape, viewCenter()); return; }
    if (e.target.closest?.('[data-nb-add-table]')) { closeInsert(); void newTable(viewCenter()); return; } // S71-56
    if (e.target.closest?.('[data-nb-add-file]')) { closeInsert(); pickFiles(box.querySelector('[data-nb-insert-open="shape"]') || box); return; } // S71-56
    const addLine = e.target.closest?.('[data-nb-add-line]'); if (addLine) { closeInsert(); newLine(addLine.dataset.nbAddLine, viewCenter()); return; }
    const barBtn = e.target.closest?.('.nb-node-bar button'); if (barBtn) { barAction(barBtn); return; }
    // S71-54 재료 칩: 이름 = 열어 보기, ⋯ = 칩 메뉴, '+n'·[접기] = 이 주제 칩 모두/접기.
    const matOpenBtn = e.target.closest?.('[data-nb-mat-open]'); if (matOpenBtn) { openMaterial(matOpenBtn.dataset.nbMatOpen, matOpenBtn); return; }
    const matMore = e.target.closest?.('[data-nb-mat-more]'); if (matMore) { const r = matMore.getBoundingClientRect(); openMaterialMenu(matMore.dataset.nbMatMore, matMore, {x:r.left, y:r.bottom}); return; }
    const matAllBtn = e.target.closest?.('[data-nb-mat-all]');
    if (matAllBtn) { const tid = matAllBtn.dataset.nbMatAll; if (matAll.has(tid)) matAll.delete(tid); else matAll.add(tid); renderTexts(); textEls.get(tid)?.querySelector('[data-nb-mat-all]')?.focus({preventScroll:true}); return; }
    const fold = e.target.closest?.('[data-nb-fold]');
    if (fold) { const id = fold.closest('[data-nb-text]')?.dataset.nbText, t = textById.get(id); if (t && !t.pending && canMap()) onTextChange(id, {collapsed:!t.collapsed}); return; }
    const hit = e.target.closest?.('[data-nb-hit]'); if (hit && bendEnded) { bendEnded = false; return; }
    if (hit && Date.now() >= linesQuietUntil) openLineMenu(hit.dataset.nbHit, e.clientX, e.clientY);
  });
  // 키보드: 카드에 초점 = 고르기, 화살표로 옮긴다(Shift = 4배, 0.5초 멈추면 저장). 선에 초점 + Enter·Space = 선 메뉴.
  box.addEventListener('focusin', e => {
    const card = e.target.closest?.('[data-nb-card]'); if (card && !opts.pickActive) { select(card.dataset.nbCard); return; }
    const tx = e.target.closest?.('.nb-tx'); if (tx && !opts.pickActive) selectText(tx.closest('[data-nb-text]')?.dataset.nbText || null);
  });
  box.addEventListener('keydown', e => {
    const hit = e.target.closest?.('[data-nb-hit]');
    if (hit && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); const r = hit.getBoundingClientRect(); openLineMenu(hit.dataset.nbHit, r.left + r.width / 2, r.top + r.height / 2); return; }
    const tx = e.target.closest?.('.nb-tx');
    if (tx && !editing && e.altKey && !e.ctrlKey && !e.metaKey && /^Arrow/.test(e.key)) { // Alt+화살표 = 옆 상자로(S69-88: 화살표만 누르면 옮기기)
      const id = tx.closest('[data-nb-text]')?.dataset.nbText; if (!textById.has(id)) return;
      e.preventDefault(); flushNudge(); const next = neighbor(tree, lay.rects, id, e.key); if (next && next !== DRAFT) focusNode(next); return;
    }
    if (tx && !editing && multi.size > 1 && (e.key === 'Delete' || e.key === 'Backspace') && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); e.stopPropagation(); removeMulti(); return; } // S70-03: 여러 개 고른 중이면 고른 것 모두
    if (tx && !editing && !e.altKey && !e.ctrlKey && !e.metaKey) { // 생각 지도 키: Tab 하위 · Enter 형제 · F2·Space 고치기 · Delete 지우기 · 화살표 옮기기(1px, Shift 10px) · Esc 고르기 풀기
      const id = tx.closest('[data-nb-text]')?.dataset.nbText, t = textById.get(id);
      if (!t || t.pending) return;
      const go = {Tab:() => !e.shiftKey && addChild(id), Enter:() => addSibling(id), F2:() => startEdit(id), ' ':() => startEdit(id),
        Delete:() => void removeNode(id), Backspace:() => void removeNode(id), Escape:() => { selectText(null); tx.blur(); }}[e.key];
      if (e.key === 'Tab' && e.shiftKey) return;
      if (go) { e.preventDefault(); e.stopPropagation(); go(); return; }
      const step = arrowStep(e.key, e.shiftKey);
      if (step) { e.preventDefault(); nudgeText(id, step.dx, step.dy); return; }
    }
    // S71-51: 카드(사진 카드 포함)에 초점 + Tab = 그 카드 아래 가지(모든 칸 가지 칸이 있는 서버만 — 없으면 Tab은 다음 칸으로).
    const tabCard = e.key === 'Tab' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && !opts.pickActive && branchReady() && e.target.closest?.('.nb-open')?.closest('[data-nb-card]');
    if (tabCard && places.has(tabCard.dataset.nbCard)) { e.preventDefault(); e.stopPropagation(); addChild(tabCard.dataset.nbCard); return; }
    const step = arrowStep(e.key, e.shiftKey);
    const card = e.target.closest?.('[data-nb-card]'); if (!step || !card || e.altKey || e.ctrlKey || e.metaKey) return;
    const id = card.dataset.nbCard, place = places.get(id); if (!place) return;
    e.preventDefault();
    const before = keyTimer ? null : new Map(places);
    const next = movedTo(place, step.dx, step.dy, place.z === topZ(places) ? place.z - 1 : topZ(places)); // 이미 맨 위면 순서 그대로
    places.set(id, {...next, saved:place.saved}); card.style.left = `${next.x}px`; card.style.top = `${next.y}px`; raise(card, next.z);
    repaintLinesOf(id); keepVisible(next);
    const pending = keyTimer?.before || before; clearTimeout(keyTimer?.id);
    keyTimer = {before:pending, id:setTimeout(() => { const b = keyTimer.before; keyTimer = null; places.set(id, {...places.get(id), saved:true}); onMove(id, places.get(id), b); }, 500)};
  });
  // 화살표로 상자 옮기기(그 가지째 — 아래 가지도 함께 보임). 0.5초 멈추면 저장(뿌리 = 자리, 가지 = 손으로 둔 자리).
  function nudgeText(id, dx, dy) {
    if (tree.parentOf.has(id) && !frameReady()) { toast('가지 자리 옮기기는 아직 서버에 저장할 수 없어요(준비 중).'); return; }
    if (!nudge || nudge.id !== id) { flushNudge(); nudge = {id, ids:new Set([id, ...descendants(tree, id).filter(k => textOn.has(k))]), dx:0, dy:0, timer:0}; }
    nudge.dx += dx; nudge.dy += dy;
    placeEls(); paintBranches(); for (const k of nudge.ids) repaintLinesOf(k); placeBar(); keepNodeVisible(id);
    clearTimeout(nudge.timer); nudge.timer = setTimeout(flushNudge, 500);
  }
  function flushNudge() {
    if (!nudge) return;
    const n = nudge; clearTimeout(n.timer);
    const items = n.dx || n.dy ? movePatches([n.id], n.dx, n.dy) : [];
    nudge = null;
    if (!items.length) { relayout(); return; }
    if (items.length === 1) onTextChange(items[0].id, items[0].patch); else onTextsChange(items);
  }
  // 키보드로 옮긴 카드가 화면 밖으로 나가면 판을 그만큼 민다.
  function keepVisible(p) {
    const {w, h} = size(), x = p.x * view.z + view.x, y = p.y * view.z + view.y, cw = (p.w || CARD_W) * view.z, ch = (p.h || CARD_H) * view.z;
    const dx = x < 8 ? 8 - x : x + cw > w - 8 ? w - 8 - x - cw : 0, dy = y < 8 ? 8 - y : y + ch > h - 8 ? h - 8 - y - ch : 0;
    if (dx || dy) setView({...view, x:view.x + dx, y:view.y + dy});
  }
  // PC: 왼쪽 목록의 노트를 끌어 판에 놓기(브라우저 끌어 놓기). 다른 끌기(파일 등)는 받지 않는다.
  // S70-32 ②: 기기의 사진 파일을 판에 끌어 놓으면 놓은 자리에 이미지(사진 한 장뿐인 노트, note-board-image.js). 사진이 아닌 파일은 넣지 않는다고 알린다.
  const noteDrag = e => !!onDrop && [...(e.dataTransfer?.types || [])].includes(NOTE_DRAG);
  const fileDrag = e => !!onImages && !noteDrag(e) && [...(e.dataTransfer?.types || [])].includes('Files');
  // S71-54: 주제(글 상자) 위에 놓으면 그 주제의 재료로 잇는다 — 노트 목록 줄(NOTE_REF_DRAG)·자료실 줄(DOC_REF_DRAG)·브라우저 주소(http/https).
  // 빈 곳에 놓으면 지금처럼(노트 = 카드, 사진 = 이미지). 재료 칸이 없는 서버(적용 전)면 받지 않는다.
  const matDrag = e => {
    if (!onMaterialDrop || !materialReady() || opts.pickActive) return false;
    const ty = [...(e.dataTransfer?.types || [])];
    return ty.includes(NOTE_REF_DRAG) || ty.includes(DOC_REF_DRAG) || (!ty.includes('Files') && (ty.includes('text/uri-list') || ty.includes('text/plain')));
  };
  const topicAt = e => { const el = document.elementFromPoint?.(e.clientX, e.clientY)?.closest?.('[data-nb-text]'); const id = el?.dataset.nbText; return el && box.contains(el) && id !== DRAFT && textById.has(id) && !textById.get(id).pending ? el : null; };
  let matOver = null;
  const markMatOver = el => { if (matOver === el) return; matOver?.classList.remove('nb-mat-drop'); matOver = el; el?.classList.add('nb-mat-drop'); };
  // S71-56: 자료실 줄(DOC_REF_DRAG)을 주제가 아닌 곳에 놓으면 그 자리에 파일 칸(표·파일 칸이 있는 서버만).
  const docDrag = e => !!onFileOpen && cellsReady() && !opts.pickActive && [...(e.dataTransfer?.types || [])].includes(DOC_REF_DRAG);
  scroll.addEventListener('dragover', e => {
    const over = matDrag(e) ? topicAt(e) : null; markMatOver(over);
    if (over) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; box.classList.remove('nb-drop'); return; }
    if (docDrag(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; box.classList.add('nb-drop'); return; }
    if (!noteDrag(e) && !fileDrag(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; box.classList.add('nb-drop');
  });
  scroll.addEventListener('dragleave', e => { if (!scroll.contains(e.relatedTarget)) { box.classList.remove('nb-drop'); markMatOver(null); } });
  scroll.addEventListener('drop', e => {
    box.classList.remove('nb-drop');
    const over = matDrag(e) ? topicAt(e) : null; markMatOver(null);
    if (over) {
      const got = dropMaterial(e.dataTransfer, {noteType:NOTE_REF_DRAG, docType:DOC_REF_DRAG});
      if (got) { e.preventDefault(); onMaterialDrop(over.dataset.nbText, got); return; }
      if (!noteDrag(e)) { e.preventDefault(); toast('주제에는 노트·자료·http(s) 주소만 이을 수 있어요.'); return; }
    }
    if (docDrag(e)) { const got = dropMaterial(e.dataTransfer, {noteType:NOTE_REF_DRAG, docType:DOC_REF_DRAG}); if (got?.kind === 'doc') { e.preventDefault(); void addFileCells([got], pointOf(e)); return; } }
    if (fileDrag(e)) { e.preventDefault(); if (!opts.pickActive) onImages([...(e.dataTransfer.files || [])], pointOf(e)); return; }
    if (!noteDrag(e)) return;
    e.preventDefault();
    const id = e.dataTransfer.getData(NOTE_DRAG); if (id) onDrop(id, pointOf(e), new Map(places));
  });
  // [이미지] 단추 → 기기 사진 고르기 → 지금 보이는 판 가운데.
  // 붙여넣기(Ctrl+V·길게 눌러 붙여넣기) = 판이 보이고 글 쓰는 칸이 아닐 때만(쓰는 칸 안이면 그 칸에 글자로 — 브라우저 그대로).
  // S71-49 [가]: PC에서 빈 곳을 왼쪽 클릭해 두었으면 그 자리, 아니면(또는 그 자리가 화면 밖이면) 보이는 판 가운데.
  // 사진이 있으면 사진만(사진 카드), 사진이 없고 글자만 있으면 배경 없는 글자 칸 하나(줄바꿈 그대로, TEXT_MAX자까지). 폰 손가락 화면은 사진만(지금 그대로).
  box.querySelector('[data-nb-image-input]')?.addEventListener('change', e => { const files = [...(e.target.files || [])]; e.target.value = ''; if (files.length) onImages(files, viewCenter()); });
  function pastePoint() {
    const at = pasteAt?.key === key ? pastePlace(pasteAt, (() => { const {w, h} = seenSize(); return visibleArea(view, w, h, 0); })()) : null;
    if (!at) return viewCenter();
    pasteAt = {key, ...nextPastePlace(at)}; // 같은 자리에 또 붙이면 조금 비켜서
    return at;
  }
  async function pasteLabel(text, at) {
    const got = pastedText(text); if (!got) return;
    if (!mapReady() || !decorReady()) { canDecor(); return; }
    if (!canText()) return;
    if (texts.length >= TEXT_LIMIT) { toast(`상자는 한 보드에 ${TEXT_LIMIT}개까지 만들 수 있어요.`); return; }
    const saved = await onTextAdd({board_id:key, body:got.body, x:clampCoord(at.x), y:clampCoord(at.y), parent_id:null, ord:0, side:null, font:FONT_DEFAULT, kind:'label', shape:'plain', z:Math.min(100000, topTextZ() + 1)});
    if (!saved) return;
    if (textOn.has(saved.id)) { clearMulti(); select(null); selectText(saved.id); }
    const said = got.cut ? `글자를 붙였어요. 한 칸에 ${TEXT_MAX}자까지라 앞부분만 넣었어요.` : '글자를 붙였어요';
    const undo = async () => {
      if (onRemoveItems) { const back = await onRemoveItems({texts:[saved.id], links:[], cards:[]}); return back ? true : {status:'failed', message:'되돌리지 못했어요.'}; }
      onTextRemove(saved.id); return true;
    };
    notify(said, {label:'글자 붙여넣기', undo});
  }
  if (onImages) document.addEventListener('paste', e => {
    if (!box.isConnected || !box.getClientRects().length || box.closest('[hidden]') || opts.pickActive || typing(e.target) || editing) return;
    if (document.querySelector('dialog[open]') && !box.closest('dialog[open]')) return;
    const files = [...(e.clipboardData?.files || [])].length ? [...e.clipboardData.files] : [...(e.clipboardData?.items || [])].filter(it => it.kind === 'file').map(it => it.getAsFile()).filter(Boolean);
    const pics = files.filter(f => /^image\//.test(f.type || ''));
    if (pics.length) { e.preventDefault(); onImages(pics, pastePoint()); return; }
    if (lastPointer === 'touch' || !key) return;
    const text = e.clipboardData?.getData?.('text/plain') || '';
    if (!pastedText(text)) return;
    e.preventDefault(); void pasteLabel(text, pastePoint());
  });
  // 두 번째 손가락이 판 밖에서 닿아도(공용 지킴이) 카드 끌기·선 긋기를 끈다(판 안 두 손가락은 위 확대·축소).
  onMultiTouch(() => { cancelDrag(); cancelWire(); cancelTextDrag(); cancelBend(); cancelResize(); });
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => { if (needFit && scroll.clientWidth && scroll.clientHeight) fitBoard(); else queue(true); }).observe(scroll);

  // Space를 누른 채 끌기 = 판 이동(PC). 글자 칸 안에서는 그대로 글자.
  const typing = t => !!t?.closest?.('input,textarea,select,[contenteditable]');
  document.addEventListener('keydown', e => { if (e.code === 'Space' && !e.repeat && !typing(e.target) && box.isConnected && box.getClientRects().length && (scroll.matches(':hover') || box.contains(document.activeElement))) { spaceDown = true; box.classList.add('nb-space'); if (!e.target.closest?.('button,a,summary')) e.preventDefault(); } });
  const spaceUp = () => { spaceDown = false; box.classList.remove('nb-space'); };
  document.addEventListener('keyup', e => { if (e.code === 'Space') spaceUp(); });
  window.addEventListener('blur', spaceUp);
  // 판 칸 자체는 스크롤하지 않는다(판 이동은 view 하나). 글 고치는 입력칸의 글자 커서를 보이게 하려고 브라우저가 칸을 스크롤하면
  // 그만큼 판을 옮기고 칸 스크롤은 0으로 되돌린다 — 안 그러면 판 좌표와 손가락 자리가 어긋나 놓을 곳·잇기 끝을 못 찾는다(S69-82).
  scroll.addEventListener('scroll', () => {
    const dx = scroll.scrollLeft, dy = scroll.scrollTop; if (!dx && !dy) return;
    scroll.scrollLeft = 0; scroll.scrollTop = 0; setView({...view, x:view.x - dx, y:view.y - dy});
  });
  // 가운데 단추: 브라우저 자동 스크롤 대신 판 이동.
  scroll.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });

  // ---- 전체 화면(S69-33) ----
  // 보드 칸(fullHost)에 nbw-full을 붙여 창 가득(CSS가 앱 머리 줄·메뉴·하단 탭 위로 덮는다). PC는 되는 곳에서 브라우저 전체 화면도 함께
  // (문서 전체를 전체 화면으로 — 메뉴·확인 창이 그대로 보이게). 뒤로가기는 라우터 한 겹, Esc·[전체 화면 끝내기]도 같은 길. 저장하지 않는다.
  const hostEl = () => fullHost() || box;
  const fullBtn = box.querySelector('[data-nb-full]'), sideBtn = box.querySelector('[data-nb-side-toggle]');
  function paintFullTools() {
    fullBtn.innerHTML = full ? FULL_OFF_ICON : FULL_ICON;
    fullBtn.setAttribute('aria-pressed', String(!!full));
    const label = full ? '전체 화면 끝내기 (Esc)' : '전체 화면'; fullBtn.setAttribute('aria-label', label); fullBtn.title = label;
    const side = !!full && hasSide();
    sideBtn.hidden = !side;
    if (!side && full) full.host.classList.remove('nbw-side-open');
    sideBtn.setAttribute('aria-pressed', String(!!full && full.host.classList.contains('nbw-side-open')));
  }
  function toggleSide() { if (!full) return; full.host.classList.toggle('nbw-side-open'); paintFullTools(); queue(true); }
  const canApi = () => typeof document.documentElement.requestFullscreen === 'function' && document.fullscreenEnabled !== false
    && !window.matchMedia?.('(display-mode: standalone)')?.matches && window.matchMedia?.('(pointer: fine)')?.matches;
  function enterFull() {
    if (full) return;
    const host = hostEl(), center = (() => { const {w, h} = size(); return toBoard(view, w / 2, h / 2); })();
    full = {host, api:false, layer:null, center};
    host.classList.add('nbw-full'); document.documentElement.classList.add('nb-full-on');
    full.layer = window.KPTURouter?.layer?.open('note-board-full', {close:() => { if (full) full.layer = null; exitFull(); return true; }}) || null;
    if (canApi()) { try { const r = document.documentElement.requestFullscreen({navigationUI:'hide'}); full.api = true; r?.catch?.(() => { if (full) full.api = false; }); } catch { full.api = false; } }
    paintFullTools(); keepCenter(center);
    fullBtn.focus({preventScroll:true});
  }
  function exitFull() {
    if (!full) return;
    const f = full, center = (() => { const {w, h} = size(); return toBoard(view, w / 2, h / 2); })(); full = null;
    f.host.classList.remove('nbw-full', 'nbw-side-open'); document.documentElement.classList.remove('nb-full-on');
    if (f.api && document.fullscreenElement) { try { void document.exitFullscreen()?.catch?.(() => {}); } catch { /* 이미 끝남 */ } }
    const layer = f.layer; f.layer = null; layer?.close?.();
    paintFullTools(); keepCenter(center);
    if (box.isConnected) fullBtn.focus({preventScroll:true});
  }
  // 칸 크기가 바뀌어도 보던 가운데가 그대로 가운데에 오게.
  function keepCenter(c) { requestAnimationFrame(() => { const {w, h} = size(); if (!w || !h) return; setView({x:w / 2 - c.x * view.z, y:h / 2 - c.y * view.z, z:view.z}); }); }
  document.addEventListener('fullscreenchange', () => { if (full?.api && !document.fullscreenElement) exitFull(); });
  // 키(판이 보이는 동안, 글자 칸 밖): 열린 메뉴·창이 먼저(그쪽이 막는다).
  // Esc = 여러 장 고른 중이면 고르기 풀기, 아니면 전체 화면 끝내기. Delete(맥 Backspace) = 고른 카드 함께 보드에서 빼기(이름 붙은 보드).
  document.addEventListener('keydown', e => {
    if (e.defaultPrevented || typing(e.target) || !box.isConnected || !box.getClientRects().length || document.querySelector('dialog[open]')) return;
    if (e.key === 'Escape' && (multi.size || full)) { e.preventDefault(); if (multi.size) clearMulti(); else exitFull(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !e.altKey && !e.ctrlKey && !e.metaKey && !editing && !e.target.closest?.('[data-nb-text]')) {
      // S70-03: 고른 것(여러 개·카드 하나·선 하나) 지우기 + [되돌리기]. 글 칸 안에서 쓰는 중이면 위 typing()이 막아 글자만 지운다.
      if (onRemoveItems) {
        if (!(multi.size || selected || lineSel) || (e.target.closest?.('[role="menu"],[role="dialog"],.modal') && !menu?.el.contains(e.target))) return; // 다른 메뉴·창 안의 키는 그쪽 몫
        e.preventDefault(); void removeItems(selection()); return;
      }
      if (multi.size && opts.removable && onRemove) { e.preventDefault(); removeMulti(); }
    }
  });

  // ---- 선 메뉴(작은 창, 누른 자리 옆) ----
  function menuEl() {
    if (menu?.el?.isConnected) return menu.el;
    const el = document.createElement('div');
    el.className = 'nb-link-menu'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', '연결선'); el.hidden = true;
    document.body.append(el);
    el.addEventListener('click', e => { const b = e.target.closest('button'); if (b) lineAction(b); });
    el.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeLineMenu({focus:true}); } });
    menu = {el, id:null, layer:null};
    return el;
  }
  const chip = (attr, value, text, on, label = '') => `<button type="button" class="ds-chip" ${attr}="${value}" aria-pressed="${on}"${label ? ` aria-label="${label}"` : ''}>${text}</button>`;
  function menuHtml(l) {
    if (isRelation(l)) { // S71-53 관계선 메뉴: 방향 · 이름 · 두 끝으로 가기 · 삭제
      const go = side => { const id = endId(l, side); return id ? `<button type="button" class="row-act" data-nb-go="${side}">${esc(short(endTitle(id), 14) || '칸')}(으)로 가기</button>` : ''; };
      return `<div class="nb-lm-row" role="group" aria-label="방향">${RELATION_ENDS.map(k => chip('data-nb-ends', k, k === 'none' ? '없음' : k === 'end' ? '→' : '↔', l.ends === k, `방향 ${RELATION_ENDS_NAMES[k]}`)).join('')}${l.ends === 'end' ? '<button type="button" class="row-act" data-nb-flip>뒤집기</button>' : ''}</div>`
        + `<div class="nb-lm-row" role="group" aria-label="관계 이름"><button type="button" class="row-act" data-nb-rel-name>${l.label ? `이름: ${esc(l.label)}` : '이름 붙이기'}</button></div>`
        + `<div class="nb-lm-row" role="group" aria-label="따라가기">${go('from')}${go('to')}</div>`
        + `<div class="nb-lm-row nb-lm-foot"><button type="button" class="row-act nb-lm-del" data-nb-del>삭제</button></div>`;
    }
    return `<div class="nb-lm-row" role="group" aria-label="선 종류">${chip('data-nb-dash', 'solid', '실선', l.dash === 'solid')}${chip('data-nb-dash', 'dashed', '점선', l.dash === 'dashed')}<button type="button" class="row-act" data-nb-straight${isStraight(l) ? ' disabled' : ''}>직선으로</button></div>`
      + `<div class="nb-lm-row" role="group" aria-label="화살표">${chip('data-nb-ends', 'end', '→', l.ends === 'end', `화살표 ${ENDS_NAMES.end}`)}${chip('data-nb-ends', 'both', '↔', l.ends === 'both', `화살표 ${ENDS_NAMES.both}`)}${chip('data-nb-ends', 'none', '없음', l.ends === 'none', `화살표 ${ENDS_NAMES.none}`)}<button type="button" class="row-act" data-nb-flip>뒤집기</button></div>`
      + (linesReady() ? `<div class="nb-lm-row" role="group" aria-label="선 모양">${['line', 'elbow', 'curve'].map(k => chip('data-nb-lshape', k, LINE_SHAPE_NAMES[k], (k === 'curve' ? l.shape === 'curve' || isBent(l) : l.shape === k && !isBent(l)))).join('')}</div>`
        + `<div class="nb-lm-row" role="group" aria-label="선 색·두께"><button type="button" class="ds-chip" data-nb-lm-tint aria-expanded="${!!menu?.tintOpen}">색</button>${STROKE_WIDTHS.map(w => chip('data-nb-lwidth', w, `${w}px`, l.width === w, `선 두께 ${w}`)).join('')}</div>`
        + (menu?.tintOpen ? `<div class="nb-lm-row" role="radiogroup" aria-label="선 색">${PALETTE.map(c => swatchHtml({color:lineVar(c.n), label:c.name, role:'radio', on:l.color === c.n, attrs:{'data-nb-lcolor':c.n, title:c.name}})).join('')}${swatchHtml({color:'', label:'기본', text:'×', role:'radio', on:l.color == null, attrs:{'data-nb-lcolor':'', title:'기본'}})}</div>` : '') : '')
      + `<div class="nb-lm-row nb-lm-foot"><button type="button" class="row-act" data-nb-label>${l.label ? '글자 수정' : '글자'}</button><button type="button" class="row-act nb-lm-del" data-nb-del>삭제</button></div>`;
  }
  function openLineMenu(id, x, y) {
    const l = links.find(k => k.id === id); if (!l || l.pending) return;
    const el = menuEl(), was = lineSel;
    lineSel = id; if (was && was !== id) { const o = links.find(k => k.id === was); if (o && lineEls.has(was)) paintLine(o); }
    if (lineEls.has(id)) paintLine(l);
    if (menu.id !== id) menu.tintOpen = false;
    menu.id = id; el.innerHTML = menuHtml(l); el.hidden = false; menu.x = x; menu.y = y;
    el.setAttribute('aria-label', isRelation(l) ? '관계선' : '연결선');
    placeMenu();
    if (!menu.layer) menu.layer = window.KPTURouter?.layer?.open('note-board-line', {close:() => { menu.layer = null; closeLineMenu(); return true; }}) || null;
    el.querySelector('button')?.focus({preventScroll:true});
  }
  function placeMenu() {
    const el = menu.el; el.style.left = `${Math.round(menu.x + 8)}px`; el.style.top = `${Math.round(menu.y + 8)}px`; el.style.bottom = 'auto';
    keepInside(el, 8, bottomInset());
    // S69-91: 메뉴가 고른 선의 끝 동그라미를 가리면 누른 자리 위쪽으로(그래도 가리면 왼쪽으로) 옮긴다 — 끝을 바로 끌 수 있게.
    const grips = [...(lineEls.get(menu.id)?.querySelectorAll('[data-nb-lend]') || [])].map(g => g.getBoundingClientRect());
    const covers = () => { const r = el.getBoundingClientRect(); return grips.some(g => g.right > r.left - 4 && g.left < r.right + 4 && g.bottom > r.top - 4 && g.top < r.bottom + 4); };
    if (!grips.length || !covers()) return;
    el.style.top = `${Math.round(menu.y - el.offsetHeight - 16)}px`; keepInside(el, 8, bottomInset());
    if (covers()) { el.style.top = `${Math.round(menu.y + 8)}px`; el.style.left = `${Math.round(menu.x - el.offsetWidth - 16)}px`; keepInside(el, 8, bottomInset()); }
  }
  function closeLineMenu({focus = false} = {}) {
    if (!menu || menu.el.hidden) { if (lineSel) { const was = lineSel; lineSel = null; const o = links.find(k => k.id === was); if (o && lineEls.has(was)) paintLine(o); } return; }
    const id = menu.id, layer = menu.layer; menu.el.hidden = true; menu.id = null; menu.layer = null; layer?.close();
    const was = lineSel; lineSel = null;
    const o = links.find(k => k.id === was); if (o && lineEls.has(was)) paintLine(o);
    if (focus && id) lineEls.get(id)?.querySelector('.nb-hit')?.focus({preventScroll:true});
  }
  function closeLineMenuIfOutside(target) { if (menu && !menu.el.hidden && !menu.el.contains(target)) closeLineMenu(); }
  document.addEventListener('pointerdown', e => { if (menu && !menu.el.hidden && !menu.el.contains(e.target) && !box.contains(e.target) && !e.target.closest?.('.kptu-ask')) closeLineMenu(); }, true);
  async function lineAction(b) {
    const l = links.find(k => k.id === menu?.id); if (!l) { closeLineMenu(); return; }
    if (b.hasAttribute('data-nb-lm-tint')) { menu.tintOpen = !menu.tintOpen; refreshMenu(); return; } // 색 칸은 눌러야 펼침(메뉴를 작게)
    if (b.hasAttribute('data-nb-rel-name')) { const {x, y} = menu; closeLineMenu(); void nameRelation(l, x, y); return; } // S71-53
    if (b.dataset.nbGo) { const id = endId(l, b.dataset.nbGo); closeLineMenu(); goToCell(id); return; }
    let patch = null;
    if (b.hasAttribute('data-nb-straight')) patch = bendPatch(null);
    else if (b.dataset.nbLshape) patch = b.dataset.nbLshape === 'curve' ? (isBent(l) ? null : {shape:'curve', bend_x:null, bend_y:null}) : {shape:b.dataset.nbLshape, bend_x:null, bend_y:null};
    else if (b.dataset.nbLcolor !== undefined) patch = {color:b.dataset.nbLcolor === '' ? null : Number(b.dataset.nbLcolor)};
    else if (b.dataset.nbLwidth) patch = {width:l.width === Number(b.dataset.nbLwidth) ? null : Number(b.dataset.nbLwidth)};
    else if (b.dataset.nbDash) patch = {dash:b.dataset.nbDash};
    else if (b.dataset.nbEnds) patch = {ends:b.dataset.nbEnds};
    else if (b.hasAttribute('data-nb-flip')) {
      if (hasLink(links, key, endId(l, 'to'), endId(l, 'from'))) { toast('반대 방향 선이 이미 있어요.'); return; }
      patch = flipPatch(l);
    } else if (b.hasAttribute('data-nb-label')) {
      const typed = await askText(b, {text:`선 위 글자 (${LABEL_MAX}자까지, 비우면 없음)`, value:l.label || '', max:LABEL_MAX});
      if (typed === null) { b.isConnected && b.focus({preventScroll:true}); return; }
      try { patch = {label:validateLabel(typed)}; } catch (err) { toast(err.message); return; }
      if (patch.label === l.label) return;
    } else if (b.hasAttribute('data-nb-del')) { closeLineMenu(); if (onRemoveItems) void removeItems({links:[l.id]}); else onLinkRemove(l.id); return; }
    if (!patch || Object.entries(patch).every(([k, v]) => l[k] === v)) return;
    onLinkChange(l.id, patch);
  }
  // 선 값이 바뀐 뒤(부르는 쪽이 다시 paint) 메뉴가 열려 있으면 그 값으로 다시 그린다.
  function refreshMenu() {
    if (!menu || menu.el.hidden) return;
    const l = links.find(k => k.id === menu.id);
    if (!l) { closeLineMenu(); return; }
    const focused = document.activeElement && menu.el.contains(document.activeElement) ? [...menu.el.querySelectorAll('button')].indexOf(document.activeElement) : -1;
    menu.el.innerHTML = menuHtml(l); placeMenu();
    // 누른 단추가 막혔으면(예: [직선으로] 뒤) 첫 단추로 — 초점이 창 밖으로 빠지면 Esc로 닫히지 않는다(S69-91: 메뉴가 커져 그 아래 선을 가렸다).
    if (focused >= 0) { const list = [...menu.el.querySelectorAll('button')], b = list[focused]; (b && !b.disabled ? b : list.find(k => !k.disabled))?.focus({preventScroll:true}); }
  }
  // 다시 그린 뒤 열려 있던 선 메뉴: 그 선이 남아 있으면 새 값으로 다시, 없으면 닫는다.
  function keepMenu(id) { if (id && links.some(l => l.id === id)) { lineSel = id; const l = links.find(k => k.id === id); if (lineEls.has(id)) paintLine(l); refreshMenu(); } else closeLineMenu(); }

  // ---- S71-52 ② 이 가지만 보기: 그 주제와 그 아래만 또렷하게, 나머지(다른 주제·카드·선)는 흐리게. 위 줄 [전체 보기]로 돌아온다. ----
  function paintFocusBar() { box.toggleAttribute('data-nb-focus', !!focusSet); focusBar.hidden = !focusSet; }
  function paintFocusAll() {
    for (const [id, el] of textEls) el.classList.toggle('nb-in-focus', !!focusSet?.has(id));
    for (const [id, el] of cardEls) el.classList.toggle('nb-in-focus', !!focusSet?.has(id));
    paintBranches(); for (const l of links) if (lineEls.has(l.id)) paintLine(l);
    paintFocusBar(); queueMini();
  }
  function focusBranch(id) {
    if (!tree.byId.has(id)) return;
    focusRoot = id; focusSet = focusIds(tree, id); if (key) focusOf.set(key, id);
    paintFocusAll();
    const {w, h} = size(), rects = [...focusSet].map(k => (places.has(k) ? rectOf(placeOfNow(k)) : lay.rects.get(k))).filter(Boolean);
    if (w && h && rects.length) setView(fitView(rects, w, h, 48, 1));
    focusBar.querySelector('[data-nb-focus-all]').focus({preventScroll:true});
  }
  function focusAll() {
    if (!focusRoot) return;
    const was = focusRoot; focusRoot = null; focusSet = null; if (key) focusOf.delete(key);
    paintFocusAll();
    (textOn.has(was) ? attachText(was) : null)?.querySelector('.nb-tx')?.focus({preventScroll:true});
  }
  focusBar.addEventListener('click', e => { if (e.target.closest('[data-nb-focus-all]')) focusAll(); });

  // ---- S71-52 ② 보드 안 찾기: 맨 위 '노트에서 찾기'(머리 줄 찾기 하나)가 보드 보기일 때 이 보드의 주제 글도 맞춘다(공용 판정 find-match-model.mjs —
  // 띄어쓰기 무시·초성·오타). 찾은 주제는 판 왼쪽 위 작은 목록, 누르면 그 주제로 화면을 옮기고 잠깐 강조(접힌 가지 안이면 윗가지를 편다). ----
  function setFind(find) {
    finds = find && !find.empty ? find : null;
    if (!finds) { findsBox.hidden = true; findsList.replaceChildren(); return; }
    const hits = [];
    texts.forEach((t, i) => { const tx = textOfCell(t); if (!tx || t.pending) return; const r = finds.test(tx); if (r) hits.push({t, i, score:r.score}); }); // S71-56: 표 칸 글·파일 이름도
    hits.sort((a, b) => b.score - a.score || a.i - b.i);
    findsHead.textContent = hits.length ? `주제 ${hits.length}개` : '맞는 주제 없음';
    findsList.innerHTML = hits.slice(0, FIND_SHOW).map(({t}) => `<button type="button" class="ghost nb-find-row" data-nb-find-go="${esc(t.id)}">${esc([...textOfCell(t).replace(/\s+/g, ' ')].slice(0, 60).join(''))}</button>`).join('')
      + (hits.length > FIND_SHOW ? `<p class="nb-finds-more">외 ${hits.length - FIND_SHOW}개</p>` : '');
    findsBox.hidden = false;
  }
  function goToText(id) {
    if (!textById.has(id)) return;
    if (focusSet && !focusSet.has(id)) focusAll(); // 보던 가지 밖이면 전체 보기로
    const shut = ancestorsOf(tree, id).filter(a => textById.get(a)?.collapsed);
    if (shut.length) onTextsChange(shut.map(a => ({id:a, patch:{collapsed:false}}))); // 화면은 바로 펴진다(저장은 부르는 쪽)
    requestAnimationFrame(() => {
      const r = lay.rects.get(id); if (!r) return;
      const {w, h} = size(); setView(centerOn(view, r, w, h)); sync(true);
      clearMulti(); select(null); selectText(id);
      const el = textOn.has(id) ? attachText(id) : null; if (!el) return;
      el.classList.remove('nb-flash'); void el.offsetWidth; el.classList.add('nb-flash');
      setTimeout(() => el.classList.remove('nb-flash'), 1400);
    });
  }
  findsBox.addEventListener('click', e => { const b = e.target.closest('[data-nb-find-go]'); if (b) goToText(b.dataset.nbFindGo); });
  for (const el of [findsBox, focusBar]) el.addEventListener('pointerdown', e => e.stopPropagation());

  // ---- S71-52 ② 미니맵: 오른쪽 아래 작은 지도(모든 주제·카드), 지금 보이는 자리 네모. 누르거나 끌면 그 자리로. 접기·펴기는 서버 화면 기억
  // (부르는 쪽 miniOpen·onMiniOpen — 기기 종류마다, 기본은 PC 펼침·폰 접힘). ----
  const miniIsOpen = () => { const v = miniOpen(); return v === null || v === undefined ? !window.matchMedia?.('(max-width:760px)')?.matches : !!v; };
  function paintMiniOpen() { const open = miniIsOpen(); miniBody.hidden = !open; miniToggle.setAttribute('aria-expanded', String(open)); miniToggle.title = open ? '미니맵 접기' : '미니맵'; mini.toggleAttribute('data-open', open); if (open) queueMini(); }
  const queueMini = () => { if (!miniFrame) miniFrame = requestAnimationFrame(() => { miniFrame = 0; paintMini(); }); };
  function miniRects() {
    const out = [];
    for (const n of shown) if (isShown(n.id) && places.has(n.id)) out.push({r:rectOf(placeOfNow(n.id)), card:true, id:n.id});
    for (const [id, r] of lay.rects) if (id !== DRAFT && !places.has(id)) out.push({r, root:!tree.parentOf.has(id), id});
    return out;
  }
  function paintMini() {
    if (miniBody.hidden) return;
    const items = miniRects(), W = miniCanvas.width, H = miniCanvas.height, ctx = miniCanvas.getContext?.('2d');
    miniMap = miniLayout(items.map(i => i.r), W, H);
    mini.dataset.nbMiniCount = String(items.length);
    if (ctx) {
      ctx.clearRect(0, 0, W, H);
      if (miniMap) {
        const css = getComputedStyle(mini), ink = css.getPropertyValue('--nb-mini-ink').trim() || css.color, dim = css.getPropertyValue('--nb-mini-dim').trim() || css.color;
        for (const it of items) {
          const m = toMini(miniMap, it.r);
          ctx.fillStyle = it.root || it.card ? ink : dim; ctx.globalAlpha = focusSet && !focusSet.has(it.id) ? 0.3 : 1;
          ctx.fillRect(m.x, m.y, Math.max(1.5, m.w), Math.max(1.5, m.h));
        }
        ctx.globalAlpha = 1;
      }
    }
    paintMiniView();
  }
  function paintMiniView() {
    if (miniBody.hidden || !miniMap) { miniView.hidden = true; return; }
    const {w, h} = size(); if (!w || !h) { miniView.hidden = true; return; }
    const m = toMini(miniMap, visibleArea(view, w, h, 0)), W = miniCanvas.width, H = miniCanvas.height;
    const x0 = Math.max(0, m.x), y0 = Math.max(0, m.y), x1 = Math.min(W, m.x + m.w), y1 = Math.min(H, m.y + m.h);
    miniView.hidden = false;
    miniView.style.left = `${Math.round(x0)}px`; miniView.style.top = `${Math.round(y0)}px`;
    miniView.style.width = `${Math.max(4, Math.round(x1 - x0))}px`; miniView.style.height = `${Math.max(4, Math.round(y1 - y0))}px`;
  }
  function miniGo(e) {
    if (!miniMap) return;
    const r = miniCanvas.getBoundingClientRect(), sx = miniCanvas.width / (r.width || 1), sy = miniCanvas.height / (r.height || 1);
    const p = fromMini(miniMap, (e.clientX - r.left) * sx, (e.clientY - r.top) * sy), {w, h} = size();
    setView({x:w / 2 - p.x * view.z, y:h / 2 - p.y * view.z, z:view.z});
  }
  miniToggle.addEventListener('click', e => { e.stopPropagation(); const next = !miniIsOpen(); onMiniOpen(next); paintMiniOpen(); });
  mini.addEventListener('pointerdown', e => {
    e.stopPropagation();
    if (!e.target.closest('[data-nb-mini-body]')) return;
    e.preventDefault(); miniDrag = e.pointerId; try { miniBody.setPointerCapture(e.pointerId); } catch { /* 잡기 실패해도 누른 자리로는 간다 */ }
    miniGo(e);
  });
  miniBody.addEventListener('pointermove', e => { if (miniDrag === e.pointerId) { e.preventDefault(); miniGo(e); } });
  const miniUp = e => { if (miniDrag === e.pointerId) miniDrag = null; };
  miniBody.addEventListener('pointerup', miniUp); miniBody.addEventListener('pointercancel', miniUp);
  for (const t of ['click', 'dblclick', 'contextmenu', 'wheel']) mini.addEventListener(t, e => e.stopPropagation());
  paintMiniOpen();
  return {
    paint(args) { const id = menu?.id; paint(args); keepMenu(id); },
    setBg: bg => applyBg(bg),
    relink(args) { const id = menu?.id; relink(args); keepMenu(id); },
    isDragging: () => !!(drag?.moving || tdrag?.moving || bend?.moved || wire || pan?.moved || pinch || rz || lend || lmove?.moved),
    places: () => new Map(places),
    view: () => ({...view}),
    focusCard, centerPoint,
    setFind, goToText, focusBranch, focusAll, refreshMini:paintMiniOpen,
    // S70-32 ③ 내보내기: 고르기·막대를 닫고 [맞추기](모든 칸이 보이게)로 그린 뒤, 판(보드 좌표 그대로)과 모든 칸을 감싸는 범위를 돌려준다.
    // 사진 칸은 받는 중이면 잠깐(5초까지) 기다린다. 화면 보기는 내보낸 뒤에도 맞추기 그대로(사용자가 [맞추기]를 누른 것과 같음).
    async exportSnapshot() {
      if (!shown.length && !texts.length && !links.length) return null;
      select(null); closeBar(); closeInsert(); closeLineMenu?.();
      fitBoard();
      if (materialReady() && texts.some(t => (materialsOf(t.id) || []).length)) { matExport = true; renderTexts(); } // S71-54: 재료 이름 전체로(맞추기 뒤 — 판 이동이 이 모양을 끝내므로)
      allOn = true; box.dataset.nbExport = ''; syncTexts(true); paintBranches(); // S71-53: 내보낼 때는 관계선을 흐리게 하지 않는다 // S71-52: 화면 밖 칸·선도 모두 붙여 내보낸다(다음 화면 이동 때 다시 보이는 것만)
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      sync(true);
      for (let i = 0; i < 50 && board.querySelector('[data-nb-photo][data-img-state="loading"]'); i++) await new Promise(r => setTimeout(r, 100));
      const rects = [...board.querySelectorAll('[data-nb-cards] > [data-nb-card], [data-nb-texts] [data-nb-text]')].map(el => ({x:el.offsetLeft, y:el.offsetTop, w:el.offsetWidth, h:el.offsetHeight}));
      for (const g of board.querySelectorAll('[data-nb-lines], [data-nb-branches]')) { try { const b = g.getBBox(); if (b.width || b.height) rects.push({x:b.x, y:b.y, w:b.width, h:b.height}); } catch { /* 그림 없음 */ } }
      const bounds = unionBounds(rects);
      return bounds ? {board, bounds, background:getComputedStyle(scroll).backgroundColor || getComputedStyle(document.body).backgroundColor} : null;
    },
    endExport: () => endMatExport(),
    selected: () => [...multi],
    isFull: () => !!full,
    exitFull: () => exitFull(),
    closeMenu: () => closeLineMenu(),
    // S71-53 관계선: 카드 ⋯ 메뉴(basket-notes.js)에서 [관계 잇기]·[관계 n개]
    startRelation: id => startRelation(id),
    openRelations: id => openRelations(id, cardEls.get(id)?.querySelector('.nb-more') || null),
    relationCount: id => relationCount(id),
    goToCell: id => goToCell(id),
    cardSize: {w:CARD_W, h:CARD_H},
  };
}
