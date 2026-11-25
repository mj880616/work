import {waitHtml, waitInlineHtml, emptyHtml} from './wait-state.js';
import {holdToast as kptuHoldToast} from './small-notice.js'; // UI-작은알림자리: #toast도 위쪽·2초·올려 두면 멈춤(시계 하나)
import { viewPrefs } from './view-prefs.js';
// SEC-기능PIN잠금 노트 폴더(S67-14): 잠근 폴더(하위 폴더 포함)의 노트는 줄·포스트잇·태그·메모·검색 결과에서 제목·내용 대신 '잠김'. 판정은 feature-lock.js 한 곳.
import * as pinLock from './feature-lock.js';
import { followPane } from './follow-pane.js';
import { mountSplitResize } from './split-resize.js';
import { treeIconHtml, iconSvg } from './tree-icons.js';
import { mountColResize, gripHtml } from './col-resize.js';
import { headCellHtml, nextSort, bindHeadSort, cleanSort, naturalCompare, arrowOf, DESC } from './head-sort.mjs';
import { NOTE_LIST_SORT_KEYS, NOTE_COLS } from './view-prefs.js';
// FOLDER-나무새기준(S51-12): 폴더 나무 줄·상자는 파일·사진·자료실과 같은 공용 부품, 두 손가락은 줄 크기(folder-pinch.js).
import { ftExplorePress, ftBindTreeArrows } from './folder-tree-press.mjs';
import { ftFolderRowHtml, ftMoreRowHtml, ftBoxHtml, ftFocusHtml, ftFocusCount, ftEmptyRowHtml, FT_PREVIEW } from './folder-tree-ui.mjs';
import { riseFromRow, sinkToRow, topOf } from './folder-focus-motion.js';
import { recentFolded, toggleRecentFolded } from './recent-fold.js';
import { fillGestureArea, settleGestureAreas } from './gesture-fill.js';
import { bindEdgeBack } from './edge-back-swipe.js';
import { MORE_LABEL } from './fold-chevron.mjs';
import { bindFolderPinch } from './folder-pinch.js';
import { formatSeoulTime, seoulDateKey } from './meeting-time.js';
// MEMO-노트: the [노트] side of the basket tab. Notes are app_notes rows with kind=note (20261017052234), read and
// written through the existing owner-RLS REST paths in basket-data.js; there is no new save path.
// This module owns everything drawn into its host: list (search, newest change first) → read → edit. The list's own input
// (BASKET-노트입력창: the basket update input, home-quick.js, in its note mode) adds a note; its [크게] opens the shared
// note window (note-window.js, ED③ 노트).
// basket.js owns the [메모 | 노트] switch and decides when this host is shown.
import './enter-save.js'; // UI-엔터저장: shared Enter-to-save rule for the data-enter-save roots below
import { readNoteDocs, readNoteDoc, detachNoteFile, saveNoteDoc, moveToBasket, noteState, validateNoteTitle, validateNoteBody, sortNotes, notePinnedAt, setNotePinned, setNoteFolderRef, setNoteOrder, noteBlockEdit, setNoteBlockEdit } from './basket-data.js';
// NOTE-탐색기(2026-10-28 09:24·10:34·11:01): 폴더 안 폴더(app_note_folders, 100단), 한 줄 노트, 끌어 옮기기·선택 모드·되돌리기.
import { readNoteFolders, createNoteFolder, updateNoteFolder, deleteNoteFolder, setNoteFolderColor } from './note-folders-data.js';
// FOLDER-순서·색 ②(S49-38): 폴더 색·끌기 순서 공용 부품(folder-look-model.mjs 계산, folder-look.js 그림, reorder-drag.js 끌기).
import { mountReorder } from './reorder-drag.js';
import { folderIconHtml, colorChoiceHtml, colorFromButton } from './folder-look.js';
import { colorOf, sortNotesManual, placeAt, stepPlan, noteOrderOf, isSamePlace, NOTE_SORT_NAMES, isNoteSort, folderDropPlan } from './folder-look-model.mjs';
import { noteFolderId, noteFolderIdLegacy, foldersFromNames, noteLineTitle, noteLineDate, treeRows, paneRows, paneHead, folderPath, canMoveFolder, noteFolderErrorText, OUTSIDE, OUTSIDE_NAME, RECENT, RECENT_NAME, recentRows } from './note-tree.mjs';
import { FOLDER_DEPTH_LIMIT } from './folder-limits.mjs';
import { folderSiblings, nextSortOrder, cleanFolderName } from './library-tree.js';
import { openFolderSheet, closeFolderSheet, folderSheetOpen } from './folder-dest-sheet.js'; // S69-62 폴더 고르기 = [파일] '옮길 곳' 창 하나
import { sheetTitle } from './folder-dest-sheet.mjs';
import { folderPathHtml } from './folder-path.mjs';
import { createSelectMode } from './select-mode.js';
import { notify, askConfirm, askText } from './small-notice.js';
import { requestNewsItem } from './news-request.mjs';
import { createNoteNewsMarks, isNewsAt } from './note-news-marks.js';
// S69-27 노트 휴지통: [폴더] 보기 나무 맨 아래 '휴지통 N'(그리기 주인 note-trash.js). 끄는 동안 따라오는 조각은 공용 drag-ghost.js.
import { createNoteTrash, NOTE_TRASH, isTrashAt } from './note-trash.js';
import { ghostText, ghostCountText } from './drag-ghost.js';
// NOTE-노트에서도밑줄(S62-17): 노트 읽기 본문에서도 글을 골라 [밑줄 저장](News·텔레그램 원문과 같은 고른 글 줄·밑줄 부품·같은 서버 표 app_news_highlights, 종류 note).
import { bindSelectZone } from './text-select-bar.js';
import { paintMarks, bindMarks, sourceHighlights, loadHighlights, onHighlights, saveFromSelection, revealMark, highlightById } from './text-highlights.js';
import { deleteNoteOriginal } from './basket-record-delete.js';
import { mountManualLink } from './basket-manual-link.js';
import { renderMarkdownInto, showPlainText, preloadMarkdown } from './markdown-view.js';
import { addVideoBoxes } from './video-embed.mjs';
import { copyText } from './copy-text.js';
import { GOTO_FOLDER_LABEL, flashRow } from './goto-folder.mjs'; // LIB-최근폴더로가기(S61-12): '최근' 노트 줄 메뉴 맨 위 [폴더로 가기]
import { flashDone } from './press-feedback.js'; // UI-눌림느낌: the pressed [복사] turns into '✓' for 1.5s
import { bigWindowOpen } from './big-window-open.js';
import { bindNoteFileDrop, droppedTitle } from './note-file-drop.js';
import { zoomFoldControl, zoomScale, bindZoomKeys, NOTE_ZOOM_EVENT } from './note-zoom.js'; // NOTE-내용확대축소: 노트 글·HTML 첨부 내용만 배율 // NOTE-목록에파일놓기: 목록에 PC 파일을 놓으면 그 파일로 새 노트 창
import { mountLineWidth } from './line-width.js'; // NOTE-글폭: 노트 글 줄 폭 손잡이
// ED③ 노트: the note's body is the new editor (note-body.js); its big window is note-window.js.
import { paintDoc, docCopy, mountEditField, notePhotos, noteFiles, startValue } from './note-body.js';
import { prepareSave } from './ed-window-model.mjs';
import { toPlain } from './ed-text.mjs';
import { mountQuick } from './home-quick.js';
import { driveFileUrl, fileSize, createUploadBatch, uploadNoteFiles, noteFileLine } from './basket-upload.js';
import { setUploadRetry, announceDock } from './upload-progress.js';
import { announceUploaded } from './upload-done.js';
import { fileLine } from './meeting-compact.js';
import { deleteAttachment } from './file-trash.js';
import { pressFile, downloadFile, openInDrive, menuItemsHtml } from './file-actions.js';
import { openPhotoView } from './photo-view.js';
import { attachmentName } from './attachment-name.mjs';
import { markRenameHost, openRenameEditor, applyRenamedNote } from './file-rename.js'; // ATT-이름고치기 · FILE-이름고치기연필먹통: ✎ 대신 ⋯ 안 [이름 수정]
import { paintHtmlAttachments } from './html-frame.js';
import { placeAnchored, followAnchor, clearAnchored, isWide } from './anchored-popup.js';
import { bindRowSwipe, claimedSince, PICK } from './row-swipe.js';
import { notePreview, noteCopyPayload } from './note-preview.mjs';
// NOTE-보기3가지(요청함 10/29 15:05): [폴더|목록|보드](S68-38 옛 이름 포스트잇) 보기. 고른 보기는 서버(view_prefs.note_view, 값 'board' 그대로), 카드 자리는 노트 metadata.boards[보드 id](S69-83: 옛 [전체]의 metadata.board는 읽지 않음).
import { mountNoteBoard } from './note-board.js';
import { createNoteBoardImages } from './note-board-image.js';
import { photoOnlyFile } from './note-board-image-model.mjs';
import { diaryPhotoUrl } from './diary-data.js';
// NOTE-보드여러개(요청함 10/30 05:48): 보드 보기의 [보드…] [+ 새 보드](S69-83 [전체] 없앰). 보드 칸 줄·PC 왼쪽 목록·폰 고르기 창은 note-boards.js.
// S70-21 NOTE-보드탭자리(명진 11/25 "왼쪽은 노트목록이잖아"): 보드 칸 줄은 오른쪽 보드 칸(nbw-main)의 머리 — 판 바로 위, 판과 같은 왼쪽 끝.
//   왼쪽 노트 목록 칸 위에는 아무것도 없다(목록은 '노트 목록' 머리부터). 전체 화면에서도 보드 칸 줄은 판 위에 함께 있다.
import { createNoteBoards } from './note-boards.js';
// S68-38 노트 '보드'(생각 지도): 보드 위 노트 → 노트 연결선(서버 표 app_note_board_links). 읽기·쓰기·화면 모음은 note-board-links-data.js 한 곳.
import { createBoardLinks } from './note-board-links-data.js';
import { onBoard } from './note-boards-model.mjs';
import { folderTone } from './note-board-model.mjs';
import { noteMarkdown } from './note-markdown.mjs';
import { basketNoteOrigin, basketBackHtml } from './basket-note-tasks.js';
// NOTE-읽생기아이디어 1단계: 해시태그(본문 #낱말을 읽어 모음, 따로 저장 없음).
// S69-94 NOTE-메모통일: 노트 아래 '메모'(옛 댓글 — 생각·질문·인용 구분 없앰)와 [메모] 모아 보기(노트·읽을 거리·저장한 글 모든 메모, 줄을 누르면 그 원문 그 메모로).
//   목록은 memo-store.js 하나(서버 표 app_memos), 칸은 memo-thread.js, 원문 열기는 memo-open.js(memo-model.mjs MEMO_OPEN 표).
import { tagGroups, tagsOfNote, tagKey, noteHasTag, addTagToDoc, removeTagFromDoc, removeTagFromTitle, cleanTagInput, TAG_INPUT_HELP } from './note-tags.mjs';
// S67-48 태그 칸: 노트 읽기·고치기의 칩 줄 + [+ 태그] 고르기(원본은 본문 #태그, 저장은 아래 노트 저장 길).
import { tagChipsHtml, createTagPick } from './note-tag-field.js';
import { memoText, memoRows, memoGroupsPresent, keepMemoGroup } from './memo-model.mjs';
import { memosNow, memoState, loadMemos, onMemos, memoExists, resetMemos } from './memo-store.js';
import { createMemoThread, memoRowHtml, memoChipsHtml } from './memo-thread.js';
import { openMemoSource, memoLocked } from './memo-open.js';
// NOTE-달력보기(S67-42): [달력] 보기 — 사업 관리 [달력]과 같은 달력 부품(report-views-model.mjs + rv-* 칸, month-cal.css), 기준은 만든 날.
import { noteCalendarHtml, notesByDay, monthNow, navMonth } from './note-calendar.mjs';
import {fitHeight} from './auto-grow.js'; // UI-줄입력늘어나기
import { SPLIT_QUERY } from './screen-width.mjs'; // FILES-폴드나무목록 ⑦: 노트 폴더 나무 | 목록은 펼친 폴드(600px~)부터 — 공용 판정 한 곳
// NOTE-주소로 가져오기 2단계: 가져오는 중인 노트 줄('○○에서 가져오는 중…')과 열린 노트 맨 위 원문 칸(그리는 곳은 note-import-view.js 한 곳).
import { NOTE_IMPORT_EVENT, isImporting, importIntoNote } from './note-import.js';
import { noteLinkUrl } from './note-import-model.mjs';
// NOTE-게시 ②(docs/design/note-publish.md): 노트 ⋯ [공유 링크 만들기]·[링크 복사]·[게시 멈춤], 읽기 머리 한 줄, [목록] '게시 중' 거르기.
import { createNotePublish } from './note-publish.js';
import { pubMenu, PUB_LABELS, PUB_ON } from './note-publish-model.mjs';
import { paintNoteSource } from './note-import-view.js';
import { busyTitle, noteSource } from './note-import-model.mjs';
import {word} from './brand/brand.mjs';
import {sbActHtml, sbCloseHtml} from './select-bar-model.mjs';
import {fitSelectBar} from './select-bar.js';
// UI-고르기막대(S69-85): 노트 고르기 막대도 공용 모양 — 왼쪽 [✕] 'N개 선택됨', 오른쪽 [전체 선택][폴더로 옮기기][삭제](좁으면 아이콘만 → ⋯).
//   kptu-act는 정리함 기본 단추 모양(ui-standard.css)에서 빼는 표시로 그대로 둔다.
const NX_SEL_BAR = sbCloseHtml('data-nx-sel-close', '선택 끝내기').replace('kptu-sb-close"', 'kptu-sb-close kptu-act nx-sel-close"')
  + '<span class="kptu-sb-count" data-nx-select-count></span><span class="kptu-sb-acts nx-sel-acts">'
  + sbActHtml({attrs: 'data-nx-sel-all', icon: 'all', label: '전체 선택', rank: 30}).replace('kptu-sb-act"', 'kptu-sb-act kptu-act"')
  + sbActHtml({attrs: 'data-nx-sel-move', icon: 'move', label: '폴더로 옮기기', rank: 10}).replace('kptu-sb-act"', 'kptu-sb-act kptu-act"')
  + sbActHtml({attrs: 'data-nx-sel-delete', icon: 'trash', label: '삭제', danger: true}).replace('kptu-sb-danger"', 'kptu-sb-danger kptu-act kptu-act-danger"')
  + '</span>';
// NEWS-클리핑 C2: 기사 메모 노트(metadata.news_item_id) → 기사 id.
const newsItemOf = note => { const m = note?.metadata; const id = m && typeof m === 'object' && !Array.isArray(m) ? m.news_item_id : null; return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null; };

const chipKinds = [['project',word('사업영역')], ['organization',word('담당조직')], ['meeting',word('사업 보고')], ['document','자료실'], ['bundle','참고']];
const day = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '' : formatSeoulTime(d, {year:'numeric', month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'}); };
// UI-바구니상세개편: [복사] on every note row and in the read view (same conversion as the write window's 텔레그램용 복사).
const MORE_ICON = '<span class="more-dots" aria-hidden="true">⋯</span>';
const PIN_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M6 2.5h4M7 2.5v4l-2.5 3h7L9 6.5v-4M8 9.5v4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const LOCKED = '잠김';
const COPY_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 3.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
function showToast(message) {
  const toast = document.querySelector('#toast'); if (!toast) return;
  toast.textContent = message; kptuHoldToast(toast);
}
export function mountNotes(host, {esc, rt = window.KPTURuntime, onOpenChange = () => {}, onMovedToBasket = () => {}}) {
  let linkOpen = false, notes = [], links = [], selected = null, editing = false, busy = false, epoch = 0, query = '', loaded = false, bigWriter = null, pendingOpen = null, pendingFolder = null;
  // BUG-뒤로가기: an openSet note is one router layer, so Back returns to the list at the same scroll.
  let layer = null, listScroll = 0;
  // NOTE-탐색기: folders (app_note_folders rows; before the DB is applied, read-only folders made from the names notes hold),
  // the entered folder (at; null = top), the open folders of the phone tree and the PC left tree (screen memory only; nothing is
  // stored on the device), and the selection (null = not in select mode; keys 'n:<note id>' and 'f:<folder id>').
  // 10/28 17:55 폰 '한 화면씩': at null = 첫 화면 폴더 목록, OUTSIDE = '폴더 없음' 노트, 폴더 id = 그 폴더 화면(겹 하나: 갤럭시 뒤로 = 폴더 목록). PC는 null = '최근'(폴더가 있을 때, NOTE-최근5개; 폴더가 없으면 '폴더 없음'), OUTSIDE = '폴더 없음'.
  let folders = [], foldersReady = false, foldersMissing = false, at = null, openSet = new Set(), folderLayer = null;
  // S69-68 UI-오른쪽목록펼치기: PC·폴드 오른쪽 칸(그 폴더 안 하위 폴더 줄)의 펼침은 왼쪽 나무(openSet)와 따로 — 오른쪽에서 펼쳐도 왼쪽은 그대로, 반대도.
  let paneOpen = new Set();
  // FOLDER-나무새기준(S51-12): 폰 나무에서 'n개 더 보기'를 누른 폴더(OUTSIDE 포함), '최근' 상자 [더보기], 그 폴더만 보기로 가기 전 화면 위치(돌아올 때 그대로).
  // 모두 이번 접속 화면 메모리만(기기에 저장하지 않음).
  let moreSet = new Set(), recentAll = false, treeScroll = null;
  const RECENT_MORE = 15;
  // [태그] 보기에서 고른 태그(key), [메모] 보기에서 고른 출처 묶음('' = 전체). 화면 메모리만. 메모 목록은 memo-store.js.
  let tagSel = [], tagTouched = false, memoGroup = '';
  // NOTE-달력보기: [달력] 보기에서 보는 달·고른 날(''= 오늘 또는 이 달 마지막 노트 날). 화면 메모리만.
  let calMonth = monthNow(), calDay = '';
  // NOTE-게시 ②: 게시 상태(서버 짝 표·페이지 상태, 링크 값은 들고 있지 않음)와 [목록] '게시 중' 거르기(화면 메모리만).
  const notePub = createNotePublish({rt});
  let pubOnly = false;
  // NOTE-탐색기 후속 ⑦: 선택 상태 코드는 자료실과 같은 공용 부품(select-mode.js). 한 겹(basket-note-select)을 열어 폰 뒤로가기가 선택 모드를 끈다.
  const pick = createSelectMode({layer:'basket-note-select', onBack:() => renderList()});
  // NOTE-보기3가지: 지금 보기. 처음은 서버에 기억한 값(없으면 폴더). 이번 접속에서 고른 뒤에는 늦게 온 서버 값으로 덮지 않는다.
  const VIEWS = ['folder', 'list', 'board'];
  // NOTE-읽생기아이디어: [태그]·[메모]는 모아 보기라 서버에 기억하지 않는다(다음에 열면 기억한 세 보기 중 하나). 폰 밀기·전환 단추는 여섯 개 모두.
  // NOTE-달력보기: [달력]도 같다 — 서버 칸 note_view가 받는 값은 폴더·목록·포스트잇 셋뿐이라(DB 검사) 기억하지 않고, 기기에도 저장하지 않는다.
  const ALL_VIEWS = [...VIEWS, 'tag', 'comment', 'calendar'];
  const savedView = () => { const v = viewPrefs.get('note_view'); return VIEWS.includes(v) ? v : 'folder'; };
  let view = savedView(), viewChosen = false, board = null;
  // FOLDER-순서·색 ②: 노트 정렬 기준 changed(고친 날, 기본) | manual(내가 정한 순서, 이때만 노트를 끌어 순서를 바꾼다). 서버 화면 설정 note_sort(기기 저장 없음).
  const savedSort = () => { const v = viewPrefs.get('note_sort'); return isNoteSort(v) ? v : 'changed'; };
  let noteSort = savedSort();
  // ATT-이름고치기: 첨부 이름을 고치면 들고 있는 노트 값을 고치고, 열린 노트의 첨부 줄을 다시 그린다.
  window.addEventListener('kptu:file-renamed', e => {
    const d = e.detail; if (!d?.drive_file_id) return;
    let hit = false;
    for (const n of notes) if (applyRenamedNote(n, d)) hit = true;
    if (selected && !notes.includes(selected) && applyRenamedNote(selected, d)) hit = true;
    if (hit && selected) paintMeta();
  });
  window.addEventListener('kptu:view-prefs-ready', () => {
    const sort = savedSort(); if (sort !== noteSort) { noteSort = sort; if (loaded && !selected) renderList(); }
    else if (view === 'list' && loaded && !selected) renderList(); // ①-2: 서버에 기억한 [목록] 정렬(note_list_sort)이 늦게 와도 그 순서로
    if (viewChosen || view === savedView()) return; view = savedView(); if (loaded && !selected) renderList();
  });
  const scope = () => { const c = rt.context.read(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
  // 오른쪽 칸을 따로 그리는 자리: 'News에서' 두 줄(note-news-marks.js)·휴지통(note-trash.js). 폴더가 아니고 끌어 놓을 곳도 아니다.
  const isPaneAt = v => isNewsAt(v) || isTrashAt(v);
  host.innerHTML = `<div data-note-list><div class="home-quick-placeholder" aria-hidden="true"></div><div class="note-list-head"><label class="note-search"><span class="a11y-only">노트 검색</span><input type="search" data-note-search placeholder="노트 검색" autocomplete="off" enterkeyhint="search"></label><span class="nv-switch ds-seg" role="group" aria-label="노트 보기"><button type="button" class="ds-seg-btn" data-note-view="folder" aria-pressed="true">폴더</button><button type="button" class="ds-seg-btn" data-note-view="list" aria-pressed="false">목록</button><button type="button" class="ds-seg-btn" data-note-view="board" aria-pressed="false">보드</button><button type="button" class="ds-seg-btn" data-note-view="tag" aria-pressed="false">태그</button><button type="button" class="ds-seg-btn" data-note-view="comment" aria-pressed="false">메모</button><button type="button" class="ds-seg-btn" data-note-view="calendar" aria-pressed="false">달력</button></span><span class="a11y-only" data-nx-count aria-live="polite"></span><button type="button" class="basket-icon-button note-folder-more" data-note-folder-more data-ctx="screen" aria-label="노트 목록 메뉴" title="메뉴" aria-haspopup="true" aria-expanded="false" aria-controls="noteDocMenu">${MORE_ICON}</button></div><div class="nx-select-bar kptu-selbar" data-nx-select-bar role="toolbar" aria-label="선택한 노트" hidden>${NX_SEL_BAR}</div><nav class="fp-path nx-where" data-nx-where aria-label="지금 위치" hidden></nav><p class="note-folder-status" data-note-folder-status role="status" hidden></p><div data-note-list-status role="status"></div><button type="button" data-note-retry hidden>다시 시도</button><div class="nx-body" data-nx-body><div class="nx-tree" data-nx-tree data-reorder-list="tree" role="tree" aria-label="노트 폴더" hidden></div><div class="nx-pane"><div class="filter-chips nt-chips" data-nt-chips role="group" hidden></div><div class="nx-here" data-nx-here hidden></div><div class="nx-recent" data-nx-recent data-reorder-list="recent" role="group" aria-label="최근 노트" hidden></div><div class="nnm-found-head" data-nnm-head role="status" hidden></div><div data-note-rows id="noteRows" data-reorder-list="rows" class="nx-rows"></div><div class="nnm" data-nnm hidden></div><div class="nxt" data-nx-trash hidden></div></div></div><div class="nbw" data-note-board-wrap hidden><div class="nbw-body"><div class="nbb-side" data-nbb-side hidden></div><div class="nbw-main" data-nbw-main><div class="nbb" data-nbb role="toolbar" aria-label="보드"></div><div class="nb" data-note-board></div><p class="wait-empty" data-wait-empty data-nbw-none hidden>보드가 없어요. [+ 새 보드]로 만들어 보세요.</p></div></div></div></div><div data-note-detail hidden></div><div id="noteDocMenu" class="basket-more-menu note-pop-menu" role="group" aria-label="노트 메뉴" hidden></div>`;
  // BASKET-노트입력창 (2026-10-22 사용자 결정): notes are added like updates — the same input box at the top of the list on a PC
  // and docked above the tabs on a phone — instead of the old [+ 노트] (phone: floating ⊕).
  const quick = mountQuick({root:host.querySelector('[data-note-list]'), esc, noteOnly:true, view:'basket', idPrefix:'basketNote',
    onSaved:saved => noteAdded(saved, {open:false}), onBig:(text, upload) => openNew(text, upload), onFolder:trigger => openAddPicker(trigger)});
  const list = host.querySelector('[data-note-list]'), detail = host.querySelector('[data-note-detail]'), status = host.querySelector('[data-note-list-status]');
  // NOTE-News밑줄보관보기: [폴더] 보기 맨 아래 'News에서' 밑줄·보관한 글(News와 같은 서버 자료 그대로, 그리기 주인은 note-news-marks.js).
  // STAB-노트폴더끌기시험: 목록을 읽는 동안(marksRun = 그 읽기 번호) 'News에서' 수가 먼저 와도 다시 그리지 않는다 — refresh가 노트·폴더·메모와
  // 같이 기다렸다가 한 번만 그린다(줄이 그려진 뒤 늦게 와서 목록 전체를 두 번 더 갈아 끼우던 것, 막 누르거나 끌기 시작한 줄이 떨어져 나갔다).
  let marksRun = 0;
  const newsMarks = createNoteNewsMarks({head:host.querySelector('[data-nnm-head]'), box:host.querySelector('[data-nnm]'), onChange:() => { if (loaded && !selected && !marksRun) renderList(); },
    // 노트 › 밑줄 줄의 노트 밑줄: 그 노트를 열고 그 자리로(없으면 알림). 노트 글자는 '원문이 바뀌었어요' 판단에만 쓴다.
    openNote:(id, hlId) => { if (!loaded) return; if (!notes.some(n => n.id === id)) { notify('원문 노트를 찾을 수 없어요', {error:true, record:false}); return; } hlReveal = hlId || null; open(id); },
    noteText:id => { if (!loaded) return undefined; const n = notes.find(row => row.id === id); return n ? String(n.raw_text || '') : null; },
    noteHidden:id => pinLock.noteHidden(notes.find(row => row.id === id)),
    memoCount:() => (memoState().ready ? memosNow().length : null)});
  // S69-27 노트 휴지통: 수는 목록을 읽을 때 함께 읽고(refresh), 노트를 지운 뒤에 다시 읽는다. 되돌리면 목록을 다시 읽어 원래 폴더에 다시 보인다.
  // 끄는 중에는 다시 그리지 않는다(잡은 줄이 떨어져 나가지 않게 — 놓은 뒤 옮기기가 어차피 다시 그린다).
  const trashRepaint = () => { if (loaded && view === 'folder' && !dragging) renderList(); };
  const noteTrash = createNoteTrash({box:host.querySelector('[data-nx-trash]'), esc, rt, scope:() => scope(), onChange:trashRepaint, onRestored:() => { void refresh(); }});
  const loadTrash = () => { void noteTrash.load().then(trashRepaint).catch(() => {}); };
  // 노트 읽기 본문의 밑줄(S62-17): 본문을 그린 뒤 이 노트의 밑줄을 노란 띠로 칠한다(칸 글자는 그대로, <mark>만 — text-highlights.js paintMarks).
  // hlReveal: 노트 › 밑줄에서 연 밑줄 — 칠해지면 그 자리로 한 번 옮기고, 노트 글이 바뀌어 자리를 못 찾으면 작은 알림 한 번(밑줄은 지우지 않음).
  let hlReveal = null;
  function noteMarksNow() {
    if (!selected || editing) return;
    const z = detail.querySelector('[data-basket-read-text]');
    if (!z || z.hidden || z.classList.contains('basket-read-empty')) return;
    paintMarks(z, sourceHighlights('note', selected.id));
    if (!hlReveal || !highlightById(hlReveal)) return;
    if (!revealMark(z, hlReveal)) notify('원문이 바뀌었어요 · 밑줄은 노트 › 밑줄에 그대로 있어요', {record:false});
    hlReveal = null;
  }
  const hlSourceNow = () => (selected ? {type:'note', id:selected.id, title:selected.title || '제목 없음', media:'노트', date:selected.updated_at || selected.created_at || null, url:''} : null);
  bindSelectZone(detail, {zone:'[data-basket-read-text]', source:hlSourceNow, onSave:saveFromSelection});
  bindMarks(detail);
  onHighlights(() => noteMarksNow());
  // NOTE-목록에파일놓기(S61-16 ①): PC 파일을 오른쪽 목록(노트 줄 위·빈 자리·포스트잇 보기)에 놓으면 그 파일을 붙인 새 노트 창(⤢와 같은 창).
  // 노트 줄 위에 놓아도 그 노트에 붙이지 않고 새 노트다. 위 입력칸은 제 첨부로 받고, 왼쪽 폴더 나무·보드 목록은 받지 않는다.
  // 끌기는 문서 전체에서 듣는다: 목록이 짧으면 그 아래 빈 자리는 노트 화면 바깥 칸이라, 목록 칸과 같은 열(가로 범위)이고 목록 위끝보다
  // 아래면 받는다. 저장 폴더는 입력칸 [폴더 ▾]와 같은 addTarget().
  bindNoteFileDrop({zone:document, onFiles:files => void openNew('', null, files), target:e => {
    if (!host.isConnected || host.hidden || !host.offsetParent || list.hidden || selected || busy || bigWriter || bigWindowOpen()) return null;
    const t = e.target instanceof Element ? e.target : null;
    if (!t || t.closest('[data-home-quick], [data-nx-tree], [data-nbb-side], [data-nx-select-bar], #noteDocMenu, [data-note-detail], [role="dialog"], nav, header')) return null;
    const board = host.querySelector('[data-note-board-wrap]'), pane = board && !board.hidden ? board : host.querySelector('.nx-pane');
    if (!pane?.offsetParent) return null;
    if (list.contains(t)) {
      const tree = host.querySelector('[data-nx-tree]');
      if (tree && !tree.hidden && tree.offsetParent && e.clientX <= tree.getBoundingClientRect().right) return null;
      return e.clientY >= list.getBoundingClientRect().top ? pane : null;
    }
    // 목록 바깥(목록 아래 빈 자리): 목록 칸과 같은 열이고 목록 칸 위끝보다 아래일 때만.
    const r = pane.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top ? pane : null;
  }});

  // 연결선·글 상자만 바뀌면(늦게 온 읽기 답·더하기·고치기) 카드는 그대로 두고 선·글 상자만 다시 그린다 — 끄는 중인 카드가 끊기지 않게(S68-47).
  const boardLinks = createBoardLinks({rt, scope:() => scope(), toast:showToast, onChange:() => {
    if (!loaded || selected || view !== 'board') return;
    if (!board) { renderList(); return; }
    if (!boards.isNamed()) return;
    const key = boards.current(); board.relink({links:boardLinks.forBoard(key), texts:boardLinks.textsFor(key)});
  }});
  const boards = createNoteBoards({esc, rt, links:boardLinks, wide:window.matchMedia('(min-width:761px)'), bar:host.querySelector('[data-nbb]'), side:host.querySelector('[data-nbb-side]'),
    notes:{get:() => notes, set:fn => { notes = fn(notes); }}, folderOf:note => folderOf(note), folders:() => folders, matches:() => (query ? matches : null),
    rerender:() => { if (loaded && !selected && view === 'board') renderList(); }, toast:showToast, refresh:() => refresh(), scope:() => scope(),
    // UI-우클릭전수(2026-11-03): 포스트잇 왼쪽 노트 목록 우클릭 = 폴더·목록 보기와 같은 노트·폴더 메뉴(보드 메뉴 항목 포함).
    openNoteMenu:(anchor, id, x, y) => { const n = notes.find(row => row.id === id); if (busy || selected || !n) return; window.KPTUContextMenu?.pinAt?.(anchor, x, y); openMenu(anchor, n, 'list'); },
    openFolderMenu:(anchor, id, x, y) => { if (busy || selected) return; window.KPTUContextMenu?.pinAt?.(anchor, x, y); if (id) openMenu(anchor, null, 'folder', null, id); else openMenu(anchor, null, 'head'); },
    // S69 보드목록폴더놓기: 왼쪽 노트 목록의 노트를 폴더 줄에 놓으면 노트 목록 끌어 놓기와 같은 옮기기(moveItems: 저장·되돌리기 알림·목록 다시 그리기).
    moveToFolder:(id, folderId) => moveItems({notes:[id], folders:[]}, folderId),
    // S69-33: 왼쪽 목록 노트 누르기 = 붙이지 않음. 이미 붙은 노트는 판에서 그 카드로, 아니면 노트 열기(노트 줄 누르기와 같은 길).
    focusCard:id => !!board?.focusCard(id), centerPoint:() => board?.centerPoint() || null,
    openNote:id => { if (busy || !notes.some(n => n.id === id)) return; open(id); }});
  const boardImages = createNoteBoardImages({rt, notes:{get:() => notes, set:fn => { notes = fn(notes); }}, boards, toast:showToast,
    rerender:() => { if (loaded && !selected && view === 'board') renderList(); }});
  // S69-94: 열린 노트의 메모 칸(memo-thread.js가 그 칸의 유일한 renderer). 메모 목록(memo-store.js)이 바뀌면 [메모] 보기만 다시 그린다.
  const noteComments = createMemoThread();
  // [폴더] 보기는 '메모' 줄 수 때문에 — 목록을 읽는 중(marksRun)·끄는 중에는 다시 그리지 않는다(STAB-노트폴더끌기시험, refresh가 한 번 그린다).
  onMemos(() => { if (loaded && !selected && !marksRun && !dragging && (view === 'comment' || view === 'folder')) renderList(); });
  // UI-노트고정: pinned notes first, then by last change.
  const sorted = () => sortNotes(notes);
  const chips = note => links.filter(l => l.note_id === note.id && l.status === 'confirmed').map(link => {
    const [kind, label] = chipKinds.find(([key]) => link[key + '_id']) || ['other', '연결'];
    const name = link[kind]?.name || link[kind]?.title || link[kind]?.series_name || '연결 대상 없음';
    return `<span class="basket-chip" data-chip-kind="${esc(kind)}"><span class="basket-chip-dot ui-color-dot" aria-hidden="true"></span><span class="a11y-only">${esc(label)}: </span>${esc(name)}</span>`;
  }).join('');
  // 검색은 제목·본문(해시태그 포함)과 그 노트 메모까지.
  // 잠겨 가려진 노트는 찾기에 걸리지 않는다(내용으로 찾아지면 그 글자가 들어 있다는 것이 드러남).
  const matches = note => !query || !pinLock.noteHidden(note) && `${note.title || ''}\n${note.raw_text || ''}\n${memoText(memosNow(), 'note', note.id)}`.toLowerCase().includes(query);
  const folderOf = note => foldersReady ? noteFolderId(note, folders) : noteFolderIdLegacy(note, folders);
  const folderById = id => folders.find(f => f.id === id) || null;
  const folderName = id => folderById(id)?.name || null;
  // NOTE-최근5개: 폴더가 하나라도 있으면 첫 화면 맨 위에 '최근'(폰: 폴더 목록 위 5줄, PC: 왼쪽 나무 맨 위 항목 = 처음 여는 곳).
  // 폴더가 없으면 노트가 이미 한 목록이라 따로 두지 않는다. 들어간 폴더 id는 at이 폴더일 때만(folderAt).
  const showRecent = () => folders.length > 0;
  const folderAt = () => at && at !== OUTSIDE && folderById(at) ? at : null;
  // S51-18: 폴더 나무 | 목록 두 칸은 공용 판정(600px~ = 펼친 폴드·PC). 앱 틀(위 줄 제목·하단바)의 761px은 따로(toplineWide).
  const wideList = window.matchMedia(SPLIT_QUERY);
  const sortList = list => (noteSort === 'manual' ? sortNotesManual(list, notePinnedAt) : sortNotes(list));
  const isPicked = key => !!pick.has(key);
  // UI-폴더목록한모양(S69-90, 명진 11/25 "모든 폴더 쓰는 ui를 통일"): 고른 줄은 [파일]처럼 바탕 + 왼쪽 세로줄만(줄 앞 체크칸 없음).
  // 고르기 중 줄 어디를 눌러도 고르기·풀기(S10), 화면 읽기는 줄 단추의 aria-pressed로 안다.
  // FOLDER-나무새기준(S51-12): 폴더 줄은 공용 줄(folder-tree-ui.mjs) — 폰 나무·PC 왼쪽 나무·그 폴더만 보기가 같은 모양
  // (맨 위 단계만 구분선·굵은 이름, 하위는 들여쓰기, 이름 + 회색 개수, 오른쪽 ⋯, 펼침은 폴더 그림 열린/닫힌 모양).
  function folderRowHtml(r, {tree = false} = {}) {
    const key = 'f:' + r.id, current = tree && at === r.id;
    // S51-25 FOLDER-PC나무: PC 왼쪽 나무는 줄 = 그 폴더 열기 + 펼침, 아이콘만 = 접기·펼치기(오른쪽은 그대로).
    // S69-27: PC 나무에도 폴더 바로 아래 노트가 보이므로(폰 나무와 같은 treeRows) 하위 폴더나 노트가 있으면 펼칠 것이 있다.
    // UI-폴더이름펼치기(11/24): 폰 그 자리 펼침은 빈 폴더도 펼친 표시(안에 '빈 폴더' 한 줄 — note-tree.mjs treeRows emptyRows).
    const pcTree = tree && !pick.active, kids = r.hasContent !== false || (!pcTree && !!r.open);
    return ftFolderRowHtml({name:r.name, count:r.count, countLabel:`노트 ${r.count}개`, depth:r.depth || 0, open:pcTree ? !!r.open : r.open || current, hasContent:kids,
      toggle:pcTree ? {attrs:{'data-nx-tog':r.id}, label:`${r.name} ${r.open && kids ? '접기' : '펼치기'}`} : null,
      color:r.color, current, picked:isPicked(key), tree, className:'nx-folder', tag:pinLock.folderLocked(r.id) && pinLock.notesHidden() ? LOCKED : '',
      rowAttrs:{'data-nx-folder':r.id, 'data-reorder-id':key}, mainAttrs:{'data-nx-open':r.id, 'aria-pressed':pick.active ? String(isPicked(key)) : undefined},
      more:{attrs:{'data-nx-folder-more':r.id, 'aria-controls':'noteDocMenu'}, label:`${r.name} 폴더 메뉴`, className:'nx-more'}});
  }
  // '폴더 없음'(17:45 ④, 옛 '폴더 밖'): 나무·폴더 목록 맨 아래, 바로 밑에 [+ 새 폴더](폴더 표가 있을 때).
  const outsideHere = () => at === OUTSIDE || (at === null && !showRecent());
  const outsideRowHtml = (r, {tree = false} = {}) => ftFolderRowHtml({name:OUTSIDE_NAME, count:r.count, countLabel:`노트 ${r.count}개`, depth:0, open:!!r.open, hasContent:r.count > 0,
    current:tree && outsideHere(), tree, className:'nx-outside', icon:treeIconHtml('outside', {className:'ft-ico'}),
    rowAttrs:{'data-nx-outside':true, 'data-reorder-id':'o'}, mainAttrs:{'data-nx-open':OUTSIDE},
    // UI-폴더줄크기(S69-99): 폰 첫 화면 '폴더 없음'도 ⋯ 첫 줄 [이 폴더로 들어가기](전의 두 손가락 벌리기 대신). PC 나무는 줄 누르기가 그 칸이라 ⋯ 없음.
    more:tree ? null : {attrs:{'data-nx-folder-more':OUTSIDE, 'aria-controls':'noteDocMenu'}, label:`${OUTSIDE_NAME} 메뉴`, className:'nx-more'}});
  // PC 왼쪽 나무 맨 위 '최근'(누르면 오른쪽에 최근 5개). 끌어 놓을 곳이 아니다(폴더가 아님).
  const recentTreeRowHtml = () => ftFolderRowHtml({name:RECENT_NAME, depth:0, current:at === null, tree:true, hasContent:false, className:'nx-recent-item',
    icon:treeIconHtml('recent', {className:'ft-ico'}), rowAttrs:{'data-nx-recent-item':true}, mainAttrs:{'data-nx-open':RECENT}});
  // 펼친 폴더 안 노트가 FT_PREVIEW개를 넘으면 'n개 더 보기'(누르면 그 폴더 노트 다). 폴더마다 이번 접속 메모리(moreSet)만.
  const moreRowHtml = r => ftMoreRowHtml({rest:r.rest, depth:r.depth, attrs:{'data-nx-more':r.id, 'data-ft-parent':r.id}});
  const newFolderRowHtml = () => canEditFolders() && !pick.active ? '<button type="button" class="nx-new-folder" data-nx-new-top>+ 새 폴더</button>' : '';
  // 끌기(순서·넣기)는 폴더 보기에서만, 찾는 중이 아닐 때(PC 마우스·폰 꾹 누르기 모두).
  // S69-27: 두 칸에서 노트를 읽는 중에도 왼쪽 나무 끌기는 된다(고치는 중에는 안 됨).
  const canReorder = () => view === 'folder' && foldersReady && !query && (!selected || (splitOpen() && !editing));
  // ② one line: title (own → AI title → first line) + 📎 when files + date. No preview, no link chips.
  function noteRowHtml(r) {
    // NOTE-주소로 가져오기: 가져오는 중인 노트 줄은 제목 자리에 '○○에서 가져오는 중…'(이번 접속에서 읽는 동안만. 저장된 제목은 그대로다).
    const note = r.note, hidden = pinLock.noteHidden(note), importing = !hidden && isImporting(note.id), title = hidden ? LOCKED : importing ? busyTitle(noteSource(note)) : noteLineTitle(note), name = [...title].slice(0, 40).join(''), key = 'n:' + note.id;
    // S69-27 PC·폴드 왼쪽 나무 안 노트 줄(side): 좁은 칸이라 제목(+ 고정·첨부 표시)만, 태그·폴더·날짜는 오른쪽 노트 안에서 본다. 지금 연 노트는 표시.
    const side = !!r.side, now = side && selected?.id === note.id;
    return `<div class="basket-row-item note-row-item nx-row nx-note${r.tree ? ' ft-item' : ''}${side ? ' nx-side' : ''}${r.cols ? ' nl-cols' : ''}${now ? ' nx-current' : ''}${isPicked(key) ? ' nx-picked' : ''}"${importing ? ' data-ni-busy' : ''} data-nx-note="${esc(note.id)}"${hidden ? ' data-nx-locked' : ''} data-reorder-id="n:${esc(note.id)}"${r.recent ? ' data-nx-recent-row' : ''}${r.tree && r.parent !== undefined ? ` data-ft-parent="${esc(r.parent ?? '')}"` : ''}${side ? ' role="treeitem"' : ''} style="--nx-indent:${r.indent};--ft-depth:${r.indent}"><button type="button" class="basket-row-more" data-note-row-more="${esc(note.id)}" aria-label="${esc(name)} 메뉴" aria-haspopup="true" aria-expanded="false" aria-controls="noteDocMenu">${MORE_ICON}</button><button type="button" class="basket-row note-row" data-note-row="${esc(note.id)}"${now ? ' aria-current="true"' : ''}${side ? ` title="${esc([...title].slice(0, 80).join(''))}"` : ''}${pick.active ? ` aria-pressed="${isPicked(key)}"` : ''}><b class="basket-title">${notePinnedAt(note) && !hidden ? `<span class="note-pin" data-note-pinned>${PIN_ICON}<span class="a11y-only">고정됨: </span></span>` : ''}<span class="basket-title-text">${esc([...title].slice(0, 80).join(''))}</span></b>${r.cols ? listCellsHtml(r, note, hidden, importing, r.cols) : `${hidden || importing || side ? '' : rowTagsHtml(note)}${r.path && !side ? `<span class="row-tail nx-path"${r.fc ? ` data-fc="${r.fc}"` : r.tone ? ` data-tone="${r.tone}"` : ''}${r.recent ? ' data-nx-recent-folder' : ''}>${r.recent ? '<span class="a11y-only">폴더: </span>' : ''}${esc(r.path)}</span>` : ''}${note.attachments?.length && !hidden ? `<span class="nx-clip" aria-label="첨부 ${note.attachments.length}개">${iconSvg('clip', {size: 12})}</span>` : ''}${side ? '' : `<time datetime="${esc(note.updated_at || '')}" title="수정한 날 ${esc(day(note.updated_at))}">${esc(noteLineDate(note.updated_at))}</time>`}`}</button></div>`;
  }
  // S70-35 NOTE-목록표머리 ①(docs/design/note-list-columns.md): [목록] 보기 줄은 칸마다 자리가 늘 있는 칸(폴더 | 태그 | 수정일 | 첨부) — 빈 값도 빈칸으로 둬서
  // 줄마다 날짜가 세로로 한 줄에 선다. PC·펼친 폴드(600~)는 머리 줄과 같은 그리드, 폰은 제목 한 줄 + 아래 작은 줄(CSS). 폴더 칸은 끝 폴더 이름, 마우스를 올리면 전체 경로.
  // ② '보일 칸'(결정 ⑦가): 켠 칸만 그린다. 칸 차례는 고정(결정 ⑤가) — NOTE_COLS 차례. 제목은 늘 켜짐. 서버 view_prefs.note_cols(없으면 기본 넷).
  const LIST_COLS_DEFAULT = Object.freeze(['folder', 'tags', 'day', 'clip']);
  const LIST_COL_NAMES = {title:'제목', folder:'폴더', tags:'태그', day:'수정일', made:'작성일', clip:'첨부', memo:'메모', chars:'글자 수', pub:'공유'};
  const LIST_COL_WIDTH = {folder:120, tags:140, day:64, made:64, clip:48, memo:44, chars:64, pub:52};
  const listCols = () => { const v = viewPrefs.getNoteCols?.(); return Array.isArray(v) ? NOTE_COLS.filter(k => v.includes(k)) : [...LIST_COLS_DEFAULT]; };
  const sameCols = (a, b) => a.length === b.length && a.every((k, i) => k === b[i]);
  function setListCols(next) {
    const cols = NOTE_COLS.filter(k => next.includes(k));
    viewPrefs.setNoteCols(sameCols(cols, LIST_COLS_DEFAULT) ? null : cols); renderList();
  }
  // 메모 수(노트마다): 그릴 때 한 번 센다. 잠긴 노트는 세지 않는다(빈칸).
  const memoCounts = () => { const out = new Map(); for (const m of memosNow()) if (m.target_type === 'note') out.set(m.target_id, (out.get(m.target_id) || 0) + 1); return out; };
  let paintMemos = null;
  const memoCountOf = (note, counts = paintMemos || memoCounts()) => counts.get(note.id) || 0;
  function listCellsHtml(r, note, hidden, importing, cols = listCols()) {
    const cell = key => {
      if (key === 'folder') {
        const fid = r.path ? folderOf(note) : null, full = fid ? folderPath(folders, fid).map(f => f.name).join(' › ') : '';
        return r.path ? `<span class="row-tail nx-path"${r.fc ? ` data-fc="${r.fc}"` : r.tone ? ` data-tone="${r.tone}"` : ''} title="${esc(full || r.path)}">${esc(r.path)}</span>` : '';
      }
      if (key === 'tags') return hidden || importing ? '' : listTagsHtml(note);
      if (key === 'clip') return note.attachments?.length && !hidden ? `<span class="nx-clip" aria-label="첨부 ${note.attachments.length}개">${iconSvg('clip', {size: 12})}<span class="nl-num" aria-hidden="true">${note.attachments.length}</span></span>` : '';
      if (hidden) return ''; // 잠긴 노트: 폴더·태그·날짜 밖 칸(메모·글자 수·공유)은 빈칸(지금 규칙 그대로 — 내용에서 나오는 값은 보이지 않는다)
      if (key === 'memo') { const n = memoCountOf(note); return n ? `<span aria-label="메모 ${n}개">${n}</span>` : ''; }
      if (key === 'chars') return `<span aria-label="글자 ${[...String(note.raw_text || '')].length}자">${[...String(note.raw_text || '')].length.toLocaleString('ko-KR')}</span>`;
      if (key === 'pub') return notePub.isOn(note.id) ? '<span class="nl-pub">게시 중</span>' : '';
      return '';
    };
    return cols.map(key => key === 'day' || key === 'made'
      ? (at => `<time class="nl-c nl-${key}" data-nl-cell="${key}" datetime="${esc(at || '')}" title="${key === 'day' ? '수정한 날' : '만든 날'} ${esc(day(at))}">${esc(noteLineDate(at))}</time>`)(key === 'day' ? note.updated_at : note.created_at)
      : `<span class="nl-c nl-${key}" data-nl-cell="${key}">${cell(key)}</span>`).join('');
  }
  // 머리 줄(PC·펼친 폴드만, 폰은 CSS가 숨김). 칸 오른쪽 금을 끌면 그 칸 너비(공용 col-resize.js, 서버 view_prefs.col_widths.notes, 화면 종류별). 마지막 칸은 금 없음.
  const LIST_COL_VARS = Object.fromEntries(['title', ...NOTE_COLS].map(k => [k, `--nl-w-${k}`]));
  const listGrid = cols => ['var(--nl-w-title,minmax(0,1fr))', ...cols.map(k => `var(--nl-w-${k},${LIST_COL_WIDTH[k]}px)`)].join(' ');
  // ①-2: 머리 칸 = 공용 head-sort.mjs headCellHtml(누르면 그 칸 정렬, 다시 누르면 반대, ▲/▼·aria-sort). 태그·공유 칸은 정렬하지 않는다. 너비 손잡이는 버튼 밖이라 끌어도 정렬되지 않는다.
  const LIST_HEAD_SORT = {title:'title', folder:'folder', day:'changed', made:'created', clip:'clip', memo:'memo', chars:'chars'};
  const COLS_BTN = `<button type="button" class="icon-btn nl-cols-btn" data-nl-cols-menu aria-label="보일 칸" title="보일 칸" aria-haspopup="true" aria-expanded="false" aria-controls="noteDocMenu">${MORE_ICON}</button>`;
  const listHeadHtml = (cols = listCols()) => { const cur = listSort(), all = [['title', LIST_COL_NAMES.title], ...cols.map(k => [k, LIST_COL_NAMES[k]])]; return `<div class="nl-head" data-nl-head role="row" aria-label="노트 목록 칸">`
    + all.map(([key, label], i) => headCellHtml({key:LIST_HEAD_SORT[key] || key, label, cur, sortable:!!LIST_HEAD_SORT[key], extra:i < all.length - 1 ? gripHtml(key, label) : ''})
      .replace('<span role="columnheader"', `<span data-nl-col="${key}" role="columnheader"`)).join('') + COLS_BTN + '</div>'; };
  // 금 두 번 누르기 = 그 칸 글자 길이에 맞춤: 줄마다 그 칸 안 글자 폭 중 가장 긴 것(잘린 제목·꼬리표는 scrollWidth로).
  const listCellFit = el => [...el.children].filter(c => !c.classList.contains('a11y-only')).reduce((w, c, i) => w + (i ? 6 : 0) + c.scrollWidth, 0);
  function mountListCols(rowsBox) {
    bindHeadSort(rowsBox, key => {
      const again = document.activeElement?.closest?.('[data-head-sort]')?.dataset.headSort === key;
      setListSort(nextSort(listSort(), key, {descFirst:LIST_SORT_DESC_FIRST}));
      // 다시 그린 뒤에도 초점은 그 머리 칸(키보드로 이어서 누를 수 있게).
      if (again) rowsBox.querySelector(`[data-nl-head] [data-head-sort="${key}"]`)?.focus({preventScroll:true});
    });
    mountColResize({host:rowsBox, name:'notes', vars:LIST_COL_VARS, labels:LIST_COL_NAMES,
      fit:key => Math.ceil(Math.max(0, ...[...rowsBox.querySelectorAll(`.nl-cols ${key === 'title' ? '.basket-title' : `[data-nl-cell="${key}"]`}`)].map(listCellFit)))});
  }
  // S70-35 ③ 태그 칸: 태그를 모두 그려 두고(12개까지) 칸 너비에 들어가는 만큼만 보이고 넘치면 +N(fitListTags, 화면 읽기는 '외 N개').
  // 폰(아래 작은 줄)은 지금처럼 앞 두 개 + N. 태그를 누르면 줄 누르기와 같다(노트 열기, 결정 ⑥가) — 줄 단추 안의 글자일 뿐이다.
  const LIST_TAGS_MAX = 12, PHONE_TAGS = 2;
  function listTagsHtml(note) {
    const tags = tagsOfNote(note); if (!tags.length) return '';
    const shown = tags.slice(0, LIST_TAGS_MAX).map(t => `#${esc([...t].slice(0, 12).join(''))}`);
    return `<span class="nx-tags nl-tagset" data-nx-tags data-nl-tags="${tags.length}"><span class="a11y-only">태그: </span>`
      + shown.map(t => `<span class="nl-tag">${t}</span>`).join(' ') + `<span class="nl-more" hidden></span></span>`;
  }
  // 칸 너비에 맞춰 보일 태그 수를 정한다: 먼저 모두 보이게 한 번 읽고(태그마다 폭), 그다음 한 번에 숨긴다(줄마다 읽기·쓰기 섞지 않음).
  const MORE_ROOM = 28, TAG_GAP = 4;
  function fitListTags(box) {
    const sets = [...box.querySelectorAll('.nl-cols .nl-tagset')]; if (!sets.length) return;
    const phone = !wideList.matches;
    for (const set of sets) for (const t of set.querySelectorAll('.nl-tag[hidden]')) t.hidden = false;
    const plan = sets.map(set => {
      const tags = [...set.querySelectorAll('.nl-tag')], total = Number(set.dataset.nlTags) || tags.length;
      if (phone) return {set, tags, keep:Math.min(PHONE_TAGS, tags.length), total};
      const room = set.parentElement.clientWidth, widths = tags.map(t => t.getBoundingClientRect().width);
      let used = 0, keep = 0;
      for (let i = 0; i < widths.length; i++) {
        const next = used + (i ? TAG_GAP : 0) + widths[i], restAfter = total - (i + 1);
        if (next + (restAfter > 0 ? MORE_ROOM : 0) > room) break;
        used = next; keep = i + 1;
      }
      return {set, tags, keep, total};
    });
    for (const {set, tags, keep, total} of plan) {
      tags.forEach((t, i) => { const hide = i >= keep; if (t.hidden !== hide) t.hidden = hide; });
      const more = set.querySelector('.nl-more'), rest = total - keep, text = rest > 0 ? `+${rest}` : '';
      if (more.textContent !== text) { more.textContent = text; if (rest > 0) more.setAttribute('aria-label', `외 ${rest}개`); else more.removeAttribute('aria-label'); }
      if (more.hidden !== !rest) more.hidden = !rest;
    }
  }
  let tagFit = null;
  function watchListTags(box) {
    if (!globalThis.ResizeObserver) return;
    // 태그 칸 너비가 바뀌면(칸 끌기·창 크기) 다시 맞춘다. 머리 줄 태그 칸 하나만 지켜본다(줄마다 지켜보지 않음).
    tagFit ||= new ResizeObserver(() => fitListTags(box));
    tagFit.disconnect();
    const cell = box.querySelector('[data-nl-head] [data-nl-col="tags"]') || box.querySelector('.nl-cols [data-nl-cell="tags"]');
    if (cell) tagFit.observe(cell);
  }
  // S67-48: 노트 줄 오른쪽에 그 노트 태그를 작게(앞 두 개 + 남은 수). 줄 단추 안의 글자일 뿐이다(누르면 노트가 열림). 잠긴 노트는 그리지 않는다.
  function rowTagsHtml(note) {
    const tags = tagsOfNote(note); if (!tags.length) return '';
    const shown = tags.slice(0, 2).map(t => `#${esc([...t].slice(0, 12).join(''))}`).join(' ');
    return `<span class="nx-tags" data-nx-tags><span class="a11y-only">태그: </span>${shown}${tags.length > 2 ? ` +${tags.length - 2}` : ''}</span>`;
  }
  const rowHtml = (r, opts) => r.type === 'folder' ? folderRowHtml(r, opts) : r.type === 'outside' ? outsideRowHtml(r, opts) : r.type === 'more' ? moreRowHtml(r)
    : r.type === 'empty' ? ftEmptyRowHtml({depth:r.depth, attrs:{'data-ft-parent':r.parent}}) : noteRowHtml(r);
  function paintWhere() {
    const nav = host.querySelector('[data-nx-where]'), path = at ? folderPath(folders, at) : [];
    // NOTE-탐색기 후속 ⑧: 자료실과 같은 위치 줄 부품(folder-path.mjs, 모양 base-ui.css .fp-path). 17:45·17:55: 맨 위 폴더는 '개발 · 7' 한 줄로 충분해
    // 위치 줄은 폴더 안 폴더(2단 이상)일 때만 보인다.
    // FOLDER-나무새기준: 폰 '그 폴더만' 보기는 위치를 [‹] 줄 안에 함께 보인다(따로 위치 줄 없음).
    const phoneFocus = !wideList.matches && at !== null;
    // UI-폴더목록한모양(S69-90): 주소 줄은 하나. 넓은 폴더 보기에서는 아래 '이름 · 개수' 줄이 위치 줄을 품는다(이름이 두 번 보이지 않게).
    const deep = path.length >= 2 && !query && !phoneFocus, merged = deep && view === 'folder' && wideList.matches && !isPaneAt(at);
    nav.hidden = !deep || merged;
    nav.innerHTML = deep && !merged ? folderPathHtml({rootLabel:'노트', trail:path, attr:'data-nx-at', esc}) : '';
    // 위에 작게 '개발 · 7'(PC), 폰 폴더 화면은 '← 개발 · 7'. 폰 첫 화면(폴더 목록)·찾는 중에는 없음.
    // S51-24: 폰 '그 폴더만'은 위치·이름·개수가 상자 안(focusBoxHtml)이라 이 줄은 넓은 화면에서만.
    const here = host.querySelector('[data-nx-here]'), wide = wideList.matches, show = view === 'folder' && !query && wide;
    here.hidden = !show;
    if (!show) { here.replaceChildren(); return; }
    const h = isPaneAt(at) ? null : wide && at === null && showRecent() ? {name:RECENT_NAME, count:recentRows({folders, notes, folderOf}).length} : paneHead({folders, notes, folderOf, at});
    if (!h) { here.hidden = true; here.replaceChildren(); return; } // 'News에서'·휴지통 칸은 자기 머리 줄(note-news-marks.js·note-trash.js)
    here.innerHTML = merged
      ? `<nav class="fp-path nx-here-path" aria-label="지금 위치">${folderPathHtml({rootLabel:'노트', trail:path, attr:'data-nx-at', esc})}</nav><span class="nx-here-num"> · ${h.count}</span>`
      : `<span class="nx-here-name">${esc(h.name)}</span><span class="nx-here-num"> · ${h.count}</span>`;
  }
  // S51-24 FOLDER-그폴더만같은모양: 폰 '그 폴더만' = 나무와 같은 상자(folder-tree-ui.mjs ftFocusHtml). 맨 위 작은 회색 위치 줄([‹] 노트 › 위 폴더 ›,
  // 누르면 그 단계 — '노트'는 나무로), 머리 = 열린 폴더 그림 + 굵은 이름 + '폴더 n · 노트 m'. 돌아가기 글자는 없다.
  function focusBoxHtml(body) {
    const f = at !== OUTSIDE ? folderById(at) : null, path = f ? folderPath(folders, at) : [];
    const subs = f ? folders.filter(x => x.parent_id === at).length : 0, own = notes.filter(n => folderOf(n) === (f ? at : null)).length;
    const trail = [{label:'노트', attrs:{'data-nx-at':''}}, ...path.slice(0, -1).map(x => ({label:x.name, attrs:{'data-nx-at':x.id}}))];
    return ftFocusHtml({back:{'data-nx-back':''}, trail, name:f ? f.name : OUTSIDE_NAME, color:f ? colorOf(f) : null, count:ftFocusCount(subs, own, '노트'), body, attrs:{'data-nx-focus':at}});
  }
  // LIB-끄는중막대(S69, 명진 11/24 16:17 — 자료실과 같은 규칙): 고른 노트를 끄는 동안은 막대에 '옮기는 중 N개'와 ✕(선택 끝내기)만.
  // [폴더로 옮기기]·[삭제]·[전체 선택]은 그동안 막대에서 떼어 둔다(숨김 아님 — 이 함수 하나가 떼고 붙임). 끝나면 원래대로.
  let selDragging = false; // 끄는 중인가(showHover가 공용 끌기 부품 표시 re-active로 바꾼다)
  let parkedActs = null; // 끄는 동안 막대에서 떼어 둔 단추(끝나면 제자리)
  function paintSelectBar() { paintSelectBarNow(); fitSelectBar(host.querySelector('[data-nx-select-bar]')); }
  // S70-35: [목록] 머리 줄은 고르기 막대가 떠 있으면 막대 바로 아래에 붙는다(둘이 겹치지 않게 막대 높이를 --nx-bar-h로 넘긴다, 숨으면 0).
  if (globalThis.ResizeObserver) new ResizeObserver(([e]) => { const h = `${Math.ceil(e.target.hidden ? 0 : e.borderBoxSize?.[0]?.blockSize ?? e.target.offsetHeight)}px`; if (list.style.getPropertyValue('--nx-bar-h') !== h) list.style.setProperty('--nx-bar-h', h); }).observe(host.querySelector('[data-nx-select-bar]'));
  function paintSelectBarNow() {
    const bar = host.querySelector('[data-nx-select-bar]');
    bar.hidden = !pick.active;
    const acts = bar.querySelector('.nx-sel-acts'), moving = !!pick.active && selDragging;
    if (acts && moving && !parkedActs) { parkedActs = [...acts.children]; for (const b of parkedActs) b.remove(); }
    else if (acts && !moving && parkedActs) { acts.append(...parkedActs); parkedActs = null; }
    if (pick.active) { host.querySelector('[data-nx-select-count]').textContent = moving ? `옮기는 중 ${pick.size}개` : `${pick.size}개 선택됨`; bar.querySelectorAll('[data-nx-sel-move],[data-nx-sel-delete]').forEach(b => { b.disabled = !pick.size || busy; }); }
    list.classList.toggle('nx-selecting', !!pick.active);
  }

  // NOTE-보기3가지 ③ 목록 보기: 모든 노트를 최근에 고친 순서로 한 줄씩, 오른쪽에 폴더 이름 꼬리표(폴더 색)와 날짜. 찾는 중이면 맞는 노트만.
  const byChange = (a, b) => (Date.parse(b.updated_at || '') || 0) - (Date.parse(a.updated_at || '') || 0) || String(b.id).localeCompare(String(a.id));
  // 목록 한 줄(폴더 색 꼬리표 포함). [목록]·[태그]·[달력] 보기가 같이 쓴다.
  const listRowOf = note => { const fid = folderOf(note), name = fid ? folderName(fid) : null; const fc = fid ? colorOf(folderById(fid)) : null; return {type:'note', note, indent:0, path:name || '', fc, tone:name && !fc ? folderTone(fid) : ''}; };
  // S70-35 NOTE-목록표머리 ①-2(결정 ③가): [목록] 정렬 = 머리 칸 누르기(다시 누르면 반대) 또는 ⋯ 메뉴 '정렬: …'(폰). 상태 주인은 서버 view_prefs.note_list_sort 하나
  // ({key, dir}, 기본 수정일 내림 = 지금 순서). 적용 전(DB 검사가 모를 때)에는 이번 접속만 기억(rejectable). 같은 값이면 수정일 내림, 그다음 id로 줄 세움.
  const LIST_SORT_NAMES = {title:'제목', folder:'폴더', changed:'수정일', created:'작성일', clip:'첨부', memo:'메모', chars:'글자 수'};
  const LIST_SORT_DESC_FIRST = ['changed', 'created', 'clip', 'memo', 'chars'];
  const LIST_SORT_DEFAULT = Object.freeze({key:'changed', dir:DESC});
  const listSort = () => cleanSort(viewPrefs.getNoteListSort?.(), NOTE_LIST_SORT_KEYS) || LIST_SORT_DEFAULT;
  const listSortValue = (note, key) => {
    const hidden = pinLock.noteHidden(note);
    if (key === 'title') return hidden ? LOCKED : noteLineTitle(note);
    if (key === 'folder') { const fid = folderOf(note); return fid ? folderName(fid) || '' : ''; }
    if (key === 'changed') return Date.parse(note.updated_at || '') || 0;
    if (key === 'created') return Date.parse(note.created_at || '') || 0;
    if (key === 'clip') return hidden ? 0 : note.attachments?.length || 0;
    if (key === 'chars') return hidden ? 0 : [...String(note.raw_text || '')].length;
    if (key === 'memo') return hidden ? 0 : memoCountOf(note);
    return 0;
  };
  function byListSort(sort) {
    if (sort.key === 'memo') paintMemos = memoCounts(); // 정렬 동안 메모 수는 한 번만 센다(paintListView가 다 그린 뒤 비운다)
    const sign = sort.dir === DESC ? -1 : 1, text = sort.key === 'title' || sort.key === 'folder';
    return (a, b) => {
      const x = listSortValue(a, sort.key), y = listSortValue(b, sort.key);
      // 폴더 칸 빈칸(폴더 없음)은 방향과 상관없이 맨 아래.
      if (sort.key === 'folder' && !x !== !y) return x ? -1 : 1;
      const c = text ? naturalCompare(x, y) : x - y;
      return c ? c * sign : byChange(a, b);
    };
  }
  function setListSort(next) {
    const cur = listSort(); if (cur.key === next.key && cur.dir === next.dir) return;
    viewPrefs.setNoteListSort(next); renderList();
  }
  const listViewRows = (m, {sort = null} = {}) => notes.filter(n => !m || m(n)).sort(sort ? byListSort(sort) : byChange).map(listRowOf);
  // ④ 보드 카드 글(S68-38): 제목 한 줄만(길면 화면이 말줄임). 본문·폴더 줄은 카드에 없다(누르면 노트 열기).
  function boardText(note) {
    // S69 보드잠금가림: 잠긴 동안 카드는 자물쇠 모양만(제목·내용 없음, 누르면 PIN 창 — open()이 막는다).
    if (pinLock.noteHidden(note)) return {title:LOCKED, locked:true};
    // S70-32 ②: 사진 한 장뿐인 노트는 보드에서 사진 칸(note-board.js가 owner 사진 보기로 받는다).
    return {title:[...noteLineTitle(note)].slice(0, 60).join(''), photo:photoOnlyFile(note)};
  }
  function paintBoard(m) {
    const box = host.querySelector('[data-note-board]');
    board ??= mountNoteBoard(box, {esc, cardText:boardText, moreIcon:MORE_ICON,
      onMove:(id, next) => boards.move(id, next),
      onDrop:(id, point, places) => boards.attach([id], point, places),
      // S69-33: 고른 카드 함께 빼기(이름 붙은 보드), 전체 화면으로 키울 칸 = 보드 칸 전체(보드 칸 줄·왼쪽 목록 포함), 왼쪽 목록이 있나.
      onRemove:ids => { if (!pick.active) boards.detach(ids); },
      fullHost:() => host.querySelector('[data-note-board-wrap]'), hasSide:() => !host.querySelector('[data-nbb-side]').hidden,
      onMenu:(btn, x, y) => { window.KPTUContextMenu?.pinAt?.(btn, x, y); rowMenu(btn); },
      onBackgroundMenu:(x, y) => { if (busy || selected) return; window.KPTUContextMenu?.pinAt?.(box, x, y); openMenu(box, null, 'board'); },
      onLinkAdd:link => boardLinks.add(link), onLinkChange:(id, patch) => { void boardLinks.update(id, patch); }, onLinkRemove:id => { void boardLinks.remove(id); },
      // S68-38c 글 상자 → S69-82 생각 지도 상자(그 보드에만 있는 짧은 글·가지, 서버 표 app_note_board_texts — 노트 목록·검색·폴더·태그와 무관).
      onTextAdd:text => boardLinks.addText(text), onTextChange:(id, patch) => { void boardLinks.updateText(id, patch); }, onTextsChange:list => { void boardLinks.updateTexts(list); },
      onTextRemove:id => { void boardLinks.removeText(id); },
      // S70-03 고른 것 한 번에 지우기(Delete·Backspace·우클릭 [삭제]): 상자(아래 가지째)·선·카드(보드에서 빼기). 되돌리기 함수를 돌려준다(못 하면 null).
      onRemoveItems:async ({texts:textIds = [], links:linkIds = [], cards = []}) => {
        if (pick.active) return null;
        const boardId = boards.current(), noteIds = cards.map(c => c.id);
        const asked = boardLinks.removeMany({textIds, linkIds, noteIds, boardId}); // 화면은 여기서 바로 바뀐다(카드 선도 함께)
        if (noteIds.length) boards.detach(noteIds);
        const snap = await asked; if (!snap) return null;
        return async () => {
          if (boards.current() !== boardId) return {status:'stale'};
          const back = boards.restore(boardId, cards.map(c => [c.id, c.place]));
          const onBoard = nid => !!boards.boardView()?.notes.some(n => n.id === nid);
          const ok = await boardLinks.restore(snap, onBoard);
          return back && ok ? true : {status:'failed', message:'일부는 되돌리지 못했어요.'};
        };
      },
      canText:() => boardLinks.checkTexts(), mapReady:() => boardLinks.mindmapReady(), canMap:() => boardLinks.checkMindmap(), frameReady:() => boardLinks.frameReady(),
      // S69-91 ①: 글자·도형·꾸미기(꾸미기 칸)·선 넣기(선 점 끝 칸) — 칸이 없는 서버면 단추를 빼고, 눌러도 '준비 중' 한 줄.
      decorReady:() => boardLinks.decorReady(), canDecor:() => boardLinks.checkDecor(), linesReady:() => boardLinks.linesReady(), canLines:() => boardLinks.checkLines(), toast:showToast,
      // S70-32 ②: 사진 끌어 놓기·붙여넣기·[이미지] → 사진 정보를 지우고 사진 한 장뿐인 노트로(노트 첨부, owner만) → 놓은 자리에 붙임.
      onImages:(files, point) => { if (!busy) void boardImages.add(files, point); }, photoUrl:(noteId, fileId) => diaryPhotoUrl(noteId, fileId, 'large', {rt})});
    boards.paint();
    // S69-83: [전체]가 없으므로 보드가 하나도 없으면 판(도구 줄 포함) 대신 빈 안내 한 줄 — 보드 칸 줄의 [+ 새 보드]로 만든다.
    const named = boards.boardView(), none = host.querySelector('[data-nbw-none]');
    box.hidden = !named; none.hidden = !!named;
    if (!named) return;
    void boardLinks.load(); // 처음 한 번(작업공간이 바뀌면 다시) — 다 읽으면 onChange로 다시 그린다
    const shown = named.notes, key = boards.current();
    board.paint({notes:shown, folderOf, colorOfFolder:id => colorOf(folderById(id)), visible:m ? new Set(shown.filter(m).map(n => n.id)) : null, pickActive:!!pick.active, isPicked:id => isPicked('n:' + id),
      boardKey:key, links:boardLinks.forBoard(key), texts:boardLinks.textsFor(key), placeOf:named.placeOf, removable:true, emptyText:named.emptyText});
  }
  function paintViewSwitch() {
    host.querySelectorAll('[data-note-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.noteView === view)));
    list.dataset.notesView = view;
    host.querySelector('[data-note-board-wrap]').hidden = view !== 'board';
    host.querySelector('[data-nx-body]').hidden = view === 'board';
  }
  // ① 보기 바꾸기: 서버에 기억(폰·PC 같음). DB 적용 전에는 거절되어 이번 접속만 기억한다(rejectable).
  function setView(next) {
    if (!ALL_VIEWS.includes(next) || next === view) return;
    viewChosen = true; view = next;
    if (view !== 'folder') at = null;
    if (VIEWS.includes(view)) viewPrefs.set('note_view', view, {rejectable:true});
    renderList();
    window.scrollTo({top:0, behavior:'instant'});
  }
  // S69-27 '왼쪽은 목록 오른쪽에는 노트 내용': PC·펼친 폴드(두 칸)의 [폴더] 보기에서 노트를 열면 왼쪽 나무는 그대로 두고 오른쪽 칸 자리에
  // 그 노트(같은 상세 칸 하나 — 읽기·수정·메모 모두 지금 렌더러 그대로)를 둔다. 그 밖(폰·다른 보기)은 지금처럼 목록 대신 노트 한 화면.
  // 상세 칸의 자리·보임은 이 함수 하나가 정한다(renderList·showDetail·close가 부른다).
  const nxBody = host.querySelector('[data-nx-body]'), nxPane = host.querySelector('.nx-pane');
  const splitOpen = () => !!selected && wideList.matches && view === 'folder';
  function placeDetail() {
    const split = splitOpen();
    if (split) { if (detail.parentElement !== nxBody) nxBody.append(detail); }
    else if (detail.parentElement !== host) host.insertBefore(detail, menuEl());
    // 값이 바뀔 때만 쓴다(같은 값을 다시 써도 속성 변화로 잡혀 화면 변화를 지켜보는 곳이 다시 그리게 된다).
    const set = (el, value) => { if (el.hidden !== value) el.hidden = value; };
    set(nxPane, split); set(list, !!selected && !split); set(detail, !selected);
    if (list.classList.contains('nx-reading') !== split) list.classList.toggle('nx-reading', split);
  }
  function renderList() {
    if (view !== 'folder') at = null;
    if (at && at !== OUTSIDE && !isPaneAt(at) && !folderById(at)) at = null;
    placeDetail();
    if (!wideList.matches) syncFolderLayer();
    quick.setFolder(folderName(addTarget()));
    const wide = wideList.matches, tree = host.querySelector('[data-nx-tree]'), rowsBox = host.querySelector('[data-note-rows]'), recentBox = host.querySelector('[data-nx-recent]');
    const m = query ? matches : null;
    list.classList.toggle('nx-wide', wide);
    paintViewSwitch();
    const chipsBox = host.querySelector('[data-nt-chips]');
    chipsBox.hidden = view !== 'tag' && view !== 'comment' && !(view === 'list' && pubChip()); if (chipsBox.hidden) chipsBox.replaceChildren();
    if (view === 'tag' || view === 'comment' || view === 'calendar') {
      tree.hidden = true; tree.replaceChildren(); recentBox.hidden = true; recentBox.replaceChildren();
      if (view === 'tag') paintTagView(chipsBox, rowsBox, m); else if (view === 'comment') paintCommentView(chipsBox, rowsBox); else paintCalendarView(rowsBox, m);
    } else if (view !== 'folder') {
      tree.hidden = true; tree.replaceChildren(); recentBox.hidden = true; recentBox.replaceChildren();
      if (view === 'list') paintListView(chipsBox, rowsBox, m);
      else { rowsBox.replaceChildren(); paintBoard(m); }
    } else if (wide) {
      tree.hidden = false;
      // S69-27(명진 11/24 "폴더 밑에 바로 들어가있는 메모도 목록으로 보여야해 / 왼쪽은 목록 오른쪽에는 노트 내용"): 왼쪽 나무는 폰 나무·보드 왼쪽 목록과
      // 같은 treeRows — 하위 폴더 먼저, 그다음 그 폴더 노트(펼치면 보이고 접으면 숨음, 많으면 처음 FT_PREVIEW개 + 'n개 더 보기'). 노트를 누르면 오른쪽에 그 노트.
      const limit = id => moreSet.has(id ?? OUTSIDE) ? Infinity : FT_PREVIEW;
      // '폴더 없음'은 지금처럼 맨 아래 한 줄(누르면 오른쪽에 그 노트들) — 폴더가 아니라 나무 안에 펼치지 않는다(폰에서 펼쳐 둔 것도 여기서는 닫힌 채).
      const left = treeRows({folders, notes, folderOf, root:null, isOpen:id => id !== OUTSIDE && openSet.has(id), sort:sortList, limit}).filter(r => r.type !== 'outside' && r.parent !== OUTSIDE);
      const outCount = notes.filter(n => folderOf(n) === null).length;
      tree.innerHTML = (showRecent() ? recentTreeRowHtml() : '') + left.map(r => r.type === 'note' ? rowHtml({...r, tree:true, side:true}) : rowHtml(r, {tree:true})).join('') + outsideRowHtml({count:outCount}, {tree:true}) + (pick.active ? '' : newsMarks.navHtml({tree:true, at}) + noteTrash.navHtml({tree:true, at})) + newFolderRowHtml();
      followPane(tree, {top:8, reset:false}); // UI-칸안스크롤하나로: 나무는 화면에 붙어 따라온다(따로 스크롤 없음).
      // NOTE-최근5개: PC 처음(at null)은 오른쪽에 최근 5개(폴더가 있을 때). 찾는 중이면 지금처럼 맞는 노트 전부.
      // S69-68 UI-오른쪽목록펼치기(명진 11/24 20:09 '오른쪽에서든 왼쪽이든 폴더를 클릭하면 폴더가 펼쳐지는거야'): 폴더 안이면 하위 폴더 줄도 그 자리에서 펼친다
      // (폰 나무와 같은 treeRows — 안의 하위 폴더·노트가 들여 보이고, 빈 폴더는 '빈 폴더' 한 줄). 펼침은 paneOpen(왼쪽 나무와 따로).
      const inFolder = !m && folderAt();
      const pc = !m && isPaneAt(at) ? [] : !m && at === null && showRecent() ? recentRows({folders, notes, folderOf})
        : inFolder ? treeRows({folders, notes, folderOf, root:inFolder, isOpen:id => paneOpen.has(id), sort:sortList, emptyRows:true}).map(r => ({...r, tree:true}))
        : paneRows({folders, notes, folderOf, at, matches:m, sort:sortList});
      rowsBox.innerHTML = pc.map(r => rowHtml(r)).join('');
      recentBox.hidden = true; recentBox.replaceChildren();
    } else {
      tree.hidden = true; tree.replaceChildren();
      // FOLDER-나무새기준(S51-12): 폰 첫 화면 = '최근' 상자 + 폴더 상자(폴더를 누르면 그 자리에서 하위 폴더·노트까지 펼침, 노트가 많으면
      // 처음 FT_PREVIEW개 + 'n개 더 보기'). 그 폴더만(at = 그 폴더, 라우터 한 겹)은 ⋯ [이 폴더로 들어가기], [‹]·뒤로 키로 펼친 자리 그대로 돌아온다.
      // 찾는 중이면 지금처럼 맞는 노트 전부, 폴더가 하나도 없으면 바로 노트 한 목록.
      const limit = id => moreSet.has(id ?? OUTSIDE) ? Infinity : FT_PREVIEW;
      let rows;
      if (!m && isPaneAt(at)) rows = [];
      else if (m || !folders.length) rows = paneRows({folders, notes, folderOf, at, matches:m, phone:true, sort:sortList});
      else if (at === OUTSIDE) rows = paneRows({folders, notes, folderOf, at, phone:true, sort:sortList});
      else rows = treeRows({folders, notes, folderOf, root:at, isOpen:id => openSet.has(id), sort:sortList, limit:at === null ? limit : () => Infinity, emptyRows:true}).map(r => ({...r, tree:true}));
      const boxed = !m && folders.length > 0;
      // 얇은 구분 줄은 폴더 목록과 같은 상자 안일 때만(따로 선 상자면 상자 테두리가 이미 나눈다 — 줄 두 겹 없음).
      const news = !m && at === null && !pick.active ? newsMarks.navHtml({sep:boxed}) + noteTrash.navHtml() : '';
      const body = rows.map(r => rowHtml(r)).join('');
      rowsBox.innerHTML = isPaneAt(at) && !m ? '' : boxed ? (at !== null ? focusBoxHtml(body) : ftBoxHtml({body:body + news, label:'노트 폴더'}) + newFolderRowHtml()) : body + (news ? ftBoxHtml({body:news, label:'밑줄·저장한 글'}) : '');
      // NOTE-최근5개 → 나무새기준 ①: 폰 첫 화면 맨 위 '최근' 상자(자료실 '최근 올린 파일'과 같은 상자, [더보기]면 15개).
      const recent = !m && at === null && showRecent() ? recentRows({folders, notes, folderOf, count:recentAll ? RECENT_MORE : undefined}) : [];
      recentBox.hidden = !recent.length;
      const moreBtn = notes.length > recent.length || recentAll ? `<button type="button" class="ft-btn ft-box-more" data-nx-recent-more aria-expanded="${recentAll}">${recentAll ? '접기' : MORE_LABEL}</button>` : '';
      // S51-22: 머리 줄을 누르면 접기(서버 view_prefs.recent_folded, recent-fold.js).
      const shut = recentFolded('notes');
      recentBox.innerHTML = recent.length ? ftBoxHtml({head:RECENT_NAME, tail:moreBtn, collapsible:true, caret:true, open:!shut, toggleAttrs:{'data-nx-recent-fold':''}, body:shut ? '' : recent.map(r => rowHtml(r)).join(''), label:'최근 노트'}) : '';
    }
    newsMarks.paint({at, query, phone:!wideList.matches, notes:query ? notes.filter(matches).length : 0, folderView:view === 'folder'});
    noteTrash.paint({at, query, phone:!wideList.matches, folderView:view === 'folder'});
    paintWhere(); paintSelectBar();
    // UI-칸폭끌기전수(요청함 10/30 10:29): PC [폴더]는 폴더 나무 | 노트 사이 경계를 끌어 폭을 바꾼다(공용 split-resize.js, 기본 30:70·나무 최소 180px).
    // 폭은 서버(view_prefs.split_ratio.notes)에 기억한다. 목록·포스트잇 보기와 폰에서는 경계가 숨는다.
    const nxBody = host.querySelector('[data-nx-body]');
    if (nxBody) mountSplitResize({container:nxBody, name:'notes', label:'노트 폴더와 노트 칸 폭 조절', columns:[
      {el:() => nxBody.querySelector(':scope>[data-nx-tree]'), varName:'--ds-split-list', minVar:'--ds-split-list-min', minFallback:180, share:30},
      {el:() => nxBody.querySelector(':scope>.nx-pane:not([hidden])') || nxBody.querySelector(':scope>[data-note-detail]:not([hidden])'), varName:'--ds-split-detail', minVar:'--ds-split-detail-min', minFallback:360, share:70}],
      query:SPLIT_QUERY, active:() => wideList.matches && view === 'folder' && nxBody.isConnected && !!nxBody.querySelector(':scope>[data-nx-tree]')?.getClientRects().length});
    host.querySelector('[data-nx-count]').textContent = loaded ? `노트 · ${notes.length}` : '';
    if (!loaded) return;
    // UI-일기손질 ⑤: an empty note list stays empty (no guide sentence); only a search with no hit says so.
    const hits = query ? notes.filter(matches).length : notes.length;
    // [태그]·[메모] 보기는 자기 칸이 빈 줄을 말한다(태그 없음·메모 없음).
    status.innerHTML = query && !hits && view !== 'tag' && view !== 'comment' && view !== 'calendar' && !(view === 'folder' && newsMarks.hits(query)) ? emptyHtml('맞는 노트 없음') : '';
    status.toggleAttribute('data-basket-empty', !hits);
  }
  // NOTE-읽생기아이디어 ② [태그]: 위에 태그 칩(노트 수 많은 순), 아래 고른 태그의 노트(목록 보기와 같은 한 줄). 처음은 가장 많은 태그.
  // S67-48: 칩은 눌러 켜고 끈다 — 여러 개를 켜면 그 태그가 모두 붙은 노트만(그리고). 다 끄면 태그가 하나라도 있는 노트 전부. 폴더와 상관없이 모은다.
  // 잠긴 폴더 노트는 풀기 전에는 칩 수에도 줄에도 넣지 않는다.
  // NOTE-게시 ② [목록] 거르기: 게시 중인 노트가 있으면 칩 하나 '게시 중'(누르면 그 노트만, 다시 누르면 전체). 잠겨 가려진 노트는 세지 않는다.
  const pubNotes = () => notes.filter(n => notePub.isOn(n.id) && !pinLock.noteHidden(n));
  const pubChip = () => pubNotes().length > 0;
  function paintListView(chipsBox, rowsBox, m) {
    const on = pubNotes().length;
    if (!on) pubOnly = false;
    if (on) {
      chipsBox.setAttribute('aria-label', '거르기');
      chipsBox.innerHTML = `<button type="button" class="ds-chip nt-chip" data-nt-pub aria-pressed="${pubOnly}">게시 중<span class="nt-num" aria-label="노트 ${on}개">${on}</span></button>`;
    }
    const rows = listViewRows(pubOnly ? n => (!m || m(n)) && notePub.isOn(n.id) && !pinLock.noteHidden(n) : m, {sort:listSort()});
    mountListCols(rowsBox);
    const cols = listCols(); paintMemos = cols.includes('memo') ? memoCounts() : null;
    if (rowsBox.style.getPropertyValue('--nl-grid') !== listGrid(cols)) rowsBox.style.setProperty('--nl-grid', listGrid(cols));
    rowsBox.innerHTML = rows.length ? listHeadHtml(cols) + rows.map(r => rowHtml({...r, cols})).join('') : pubOnly ? emptyHtml('맞는 노트 없음') : '';
    paintMemos = null;
    if (cols.includes('tags')) { fitListTags(rowsBox); watchListTags(rowsBox); } else tagFit?.disconnect();
  }
  // NOTE-게시 ② 읽기 머리 한 줄: 게시 중일 때만 '게시 중 · 링크 복사 · 게시 멈춤'(잠근 폴더 노트는 [링크 복사] 없이).
  function paintPub() {
    const line = detail.querySelector('[data-note-pub-line]'); if (!line || !selected) return;
    const on = notePub.isOn(selected.id), locked = pinLock.noteInLockedFolder(selected);
    const dot = '<span class="note-pub-dot" aria-hidden="true">·</span>';
    line.hidden = !on;
    line.innerHTML = on ? `<span class="note-pub-on">게시 중</span>${locked ? '' : `${dot}<button type="button" class="row-act note-pub-act" data-pub-line="copy">링크 복사</button>`}${dot}<button type="button" class="row-act note-pub-act" data-pub-line="stop">게시 멈춤</button>` : '';
  }
  // NOTE-게시 ③: 게시할 때·게시 중 노트를 저장한 뒤 사진을 받는 사람 쪽에도 맞춘다(뒤에서, 화면을 막지 않음). 못 올린 사진만 한 줄로 알린다.
  function pubPhotos(note) {
    if (!note?.id || !notePub.isOn(note.id)) return;
    const owner = scope();
    notePub.syncPhotos(note).then(r => {
      if (owner === scope() && r?.failed) notify(`사진 ${r.failed}장은 링크에서 보이지 않아요. 노트를 다시 저장하면 다시 올려요.`, {error:true, record:false});
    }, () => { if (owner === scope()) notify('게시한 노트 사진을 맞추지 못했어요. 노트를 다시 저장해 주세요.', {error:true, record:false}); });
  }
  let pubBusy = false;
  async function pubAct(kind, note, anchor) {
    if (pubBusy || !note) return;
    if (kind !== 'stop' && pinLock.noteInLockedFolder(note)) return;
    if (kind === 'stop' && !await askConfirm(anchor, {text:'게시를 멈출까요?', note:'링크를 받은 사람도 더 이상 볼 수 없어요. 다시 게시하면 같은 링크가 다시 열려요.', ok:'게시 멈춤', danger:true})) return;
    pubBusy = true;
    const owner = scope(), fail = (e, text) => notify(e?.status === 401 || e?.code === 'session_required' ? '로그인이 끝났어요. 다시 로그인해 주세요.' : text, {error:true, record:false});
    try {
      if (kind === 'make') {
        await notePub.publish(note);
        const copied = await notePub.copy(note).catch(() => false);
        notify(copied ? '게시했어요 · 링크를 복사했어요' : '게시했어요 · [링크 복사]로 보내세요', {record:false});
        pubPhotos(note);
      } else if (kind === 'copy') {
        const copied = await notePub.copy(note);
        if (copied && anchor?.isConnected) flashDone(anchor);
        notify(copied ? '링크를 복사했어요 · 메신저에 붙여 넣어 보내세요' : '복사하지 못했어요. 다시 눌러 주세요.', {error:!copied, record:false});
      } else {
        await notePub.stop(note);
        notify('게시를 멈췄어요', {record:false});
      }
    } catch (e) {
      fail(e, kind === 'make' ? '게시하지 못했어요. 다시 시도해 주세요.' : kind === 'copy' ? '링크를 복사하지 못했어요.' : '게시를 멈추지 못했어요. 다시 시도해 주세요.');
    } finally {
      pubBusy = false;
      if (kind !== 'copy' && owner === scope()) { if (selected) paintPub(); if (!selected || splitOpen()) renderList(); }
    }
  }
  function paintTagView(chipsBox, rowsBox, m) {
    const groups = tagGroups(notes.filter(n => (!m || m(n)) && !pinLock.noteHidden(n)));
    if (!tagTouched && !tagSel.some(k => groups.some(g => g.key === k))) tagSel = groups[0] ? [groups[0].key] : [];
    const on = tagSel.filter(k => groups.some(g => g.key === k));
    chipsBox.setAttribute('aria-label', '해시태그');
    chipsBox.innerHTML = groups.map(g => `<button type="button" class="nt-chip" data-nt-tag="${esc(g.key)}" aria-pressed="${on.includes(g.key)}">#${esc(g.tag)}<span class="nt-num" aria-label="노트 ${g.count}개">${g.count}</span></button>`).join('')
      + (on.length > 1 ? `<button type="button" class="ds-chip nt-chip nt-clear" data-nt-clear aria-label="선택한 태그 ${on.length}개 선택 해제">선택 해제</button>` : '');
    chipsBox.hidden = !groups.length;
    const pass = note => (!m || m(note)) && !pinLock.noteHidden(note) && (on.length ? on.every(k => noteHasTag(note, k)) : tagsOfNote(note).length > 0);
    const rows = groups.length ? listViewRows(pass) : [];
    rowsBox.innerHTML = rows.length ? rows.map(r => rowHtml(r)).join('') : emptyHtml(!groups.length ? (m ? '맞는 노트 없음' : '태그 없음') : '선택한 태그가 모두 붙은 노트 없음');
  }
  // NOTE-달력보기 [달력]: 만든 날 칸에 그날 노트 수, 날짜를 누르면 아래에 그날 노트 줄(목록 보기와 같은 rowHtml — 잠긴 폴더 노트는 '잠김',
  // 누르면 잠금 풀기 창). 찾는 중이면 맞는 노트만 센다. 고른 날 글자 단추에 초점을 되돌려 키보드로 이어서 고른다.
  function paintCalendarView(rowsBox, m) {
    const keep = rowsBox.contains(document.activeElement) ? document.activeElement : null;
    const focus = keep?.dataset?.ntCalNav ? `[data-nt-cal-nav="${keep.dataset.ntCalNav}"]` : keep?.dataset?.ntCalDay ? '[data-nt-cal-day][aria-pressed="true"]' : '';
    const byDay = notesByDay(notes.filter(n => !m || m(n)));
    rowsBox.innerHTML = noteCalendarHtml({month:calMonth, selectedDay:calDay, todayKey:seoulDateKey(), byDay, noneHtml:emptyHtml(m ? '맞는 노트 없음' : '이날 쓴 노트 없음'),
      rowsHtml:list => list.map(note => rowHtml(listRowOf(note))).join('')});
    if (focus) rowsBox.querySelector(focus)?.focus({preventScroll:true});
  }
  // S69-94 NOTE-메모통일 [메모] 모아 보기(옛 [댓글]): 노트·읽을 거리·저장한 글에 남긴 모든 메모 한 목록(최근 쓴 순), 출처 칩(전체·노트·읽을 거리·저장한 글)으로 거른다.
  // 줄 = 출처 꼬리표 + 메모 글 + 원문 제목(노트는 지금 제목, 그 밖은 남길 때 사본) + 날짜. 누르면 그 원문을 열고 그 메모로 내려가 칠한다(memo-open.js).
  // 원문이 없으면(지운 노트·삭제된 글) 메모는 남고 '원래 기록이 없어요'(링크만 꺼짐). 잠긴 폴더 노트의 메모는 글·제목 대신 '잠김'(누르면 잠금 풀기).
  const noteMemoTitle = m => { const n = notes.find(x => x.id === m.target_id); return n ? noteLineTitle(n) : m.target_title; };
  const noteMemoExists = m => (m.target_type === 'note' ? notes.some(x => x.id === m.target_id) : memoExists(m));
  // S69-95: 텔레그램 메모는 텔레그램 잠금이 걸려 있으면 가린다(누르면 그 자리 잠금 풀기 창 — memo-thread.js data-lock-here).
  const noteMemoHidden = m => (m.target_type === 'note' ? pinLock.noteHidden(notes.find(x => x.id === m.target_id)) : memoLocked(m));
  function paintCommentView(chipsBox, rowsBox) {
    chipsBox.setAttribute('aria-label', '메모 출처');
    chipsBox.hidden = false;
    const st = memoState(), all = memosNow();
    memoGroup = keepMemoGroup(memoGroup, all);
    chipsBox.innerHTML = memoChipsHtml(memoGroupsPresent(all), memoGroup);
    if (!st.loaded) { rowsBox.innerHTML = waitHtml({rows:3, h:40}); return; }
    if (!st.ready) { rowsBox.innerHTML = emptyHtml(st.missing ? '메모는 준비 중이에요.' : '메모를 읽지 못했어요.'); return; }
    const rows = memoRows(all, {group:memoGroup, query, titleOf:noteMemoTitle, hidden:noteMemoHidden});
    rowsBox.innerHTML = rows.length ? `<div class="memo-lines" data-memo-lines>${rows.map(m => memoRowHtml(m, {titleOf:noteMemoTitle, exists:noteMemoExists, hidden:noteMemoHidden})).join('')}</div>`
      : emptyHtml(query ? '맞는 메모 없음' : '메모 없음 · 노트·읽을 거리·저장한 글 아래 [메모 남기기]');
  }
  // [메모] 줄 누르기: 노트 메모는 이 화면에서 그 노트를 열고 그 메모로, 그 밖은 그 원문 화면으로(memo-open.js).
  function openMemoLine(id) {
    const m = memosNow().find(x => x.id === id); if (!m) return;
    if (memoLocked(m)) return; // 잠금 풀기 창은 줄의 data-lock-here가 먼저 띄운다
    if (noteMemoHidden(m)) { pinLock.askNotes(); return; }
    openMemoSource(m, {exists:noteMemoExists, inPlace:o => { if (o.type !== 'note') return false; open(o.id); return true; }});
  }
  // 폭이 바뀌면(폴드 접기·펴기) 두 칸 ↔ 한 화면도 다시 정한다(열린 노트는 그대로).
  wideList.addEventListener?.('change', () => { if (loaded) renderList(); else placeDetail(); });
  const lateSent = new Map(); // BIZ-저장먼저닫기 2차: 목록에 아직 없던 새 노트의 뒤 올리기가 끝남(id → 글을 고쳤는지)
  async function refresh() {
    if (busy) return;
    const run = ++epoch, owner = scope();
    status.innerHTML = waitInlineHtml(); host.querySelector('[data-note-retry]').hidden = true;
    marksRun = run;
    try {
      // S69-27: 휴지통 수도 같이 기다려 한 번만 그린다(늦게 와서 다시 그리면 막 잡은 줄이 떨어져 나간다 — STAB-노트폴더끌기시험과 같은 까닭).
      const [result, fold] = await Promise.all([readNoteDocs(rt), readNoteFolders(rt), loadMemos({force:true}), newsMarks.load(), pinLock.ready(), noteTrash.load().catch(() => {}), notePub.load().catch(() => {})]);
      if (marksRun === run) marksRun = 0;
      if (run !== epoch || owner !== scope()) return;
      notes = result.notes; links = result.links; loaded = true;
      for (const [id, text] of [...lateSent]) if (notes.some(n => n.id === id)) { lateSent.delete(id); void rereadSent(id, text); }
      foldersReady = fold.ready; foldersMissing = !!fold.missing; folders = fold.ready ? fold.folders : foldersFromNames(notes);
      // NAV-새로고침제자리: the folder entered before a reload (?folder=) is entered again once the folders are read.
      if (pendingFolder) { const id = pendingFolder; pendingFolder = null; if (id === OUTSIDE || isPaneAt(id) || folderById(id)) enter(id, {focus:false, picked:false}); else renderList(); } else renderList();
      if (pendingOpen) { const id = pendingOpen; pendingOpen = null; if (notes.some(n => n.id === id)) open(id); }
    } catch {
      if (marksRun === run) marksRun = 0;
      if (run !== epoch || owner !== scope()) return;
      notes = []; links = []; loaded = false; host.querySelector('[data-note-rows]').replaceChildren();
      status.textContent = '노트를 불러오지 못했어요. 다시 시도해 주세요.';
      host.querySelector('[data-note-retry]').hidden = false;
    }
  }

  // UI-상단줄제목: the open note's title goes to the PC top line's place (topbar-actions.js kptu:where-item); null drops it.
  const sendWhere = name => window.dispatchEvent(new CustomEvent('kptu:where-item', {detail:{view:'basket', name, kind:'note'}}));
  // ED③ 노트: the body is the new editor (field, mounted by startEdit); the [마크다운] box is gone (결정 11 가; metadata.markdown is kept).
  let field = null, fieldBase = null;
  const fields = () => ({title: detail.querySelector('[data-note-title-input]')});
  const textDirty = () => { if (!selected || !editing) return false; const f = fields(); return f.title.value !== (selected.title || '') || !!field?.isChanged(); };
  // A note with only HTML hides its empty body box; focus then goes to the HTML area (or, with other files only, the file cards).
  const readFocus = () => { const text = detail.querySelector('[data-basket-read-text]'), views = detail.querySelector('[data-basket-html-views]');
    return !text.hidden ? text : views.childElementCount ? views : detail.querySelector('[data-note-attachments]'); };
  // The message goes to the open note's status line, or to the list's when the action came from a list row.
  const report = text => { if (selected) say(text); else status.textContent = text; };
  const say = text => { const p = detail.querySelector('[data-basket-status]'); if (p) p.textContent = text; };
  const lock = value => { busy = value; detail.querySelectorAll('button,input:not(.md-task),textarea').forEach(el => { el.disabled = value; }); if (!value) manual.controls(); };
  // UI-노트메뉴정리: one ⋯ menu for the list rows and the open note. 고정/고정 풀기 · 수정 · (연결하기 · 바구니로 돌리기) · 삭제,
  // in this order; the list rows leave out the two that need the open note. It opens where it was pressed (anchored-popup.js,
  // PC and phone alike: a small list under the ⋯, kept inside the window) and closes on Esc, outside press, or choosing.
  let menu = null;
  const menuEl = () => host.querySelector('#noteDocMenu');
  // NOTE-탐색기 ③ (11:01 결정): the row menu starts with [선택] (PC right-click opens this same menu; a phone long-press picks the row, S69). In select
  // mode the menu of a picked row is for all picked ones. A folder row has its own menu; the list head ⋯ has [새 폴더]·[선택].
  // UI-모바일노트복사메뉴: on a phone a list row has no [복사] button; [복사] is in its ⋯ menu (PC keeps the button).
  // NOTE-파일붙이기: a file card's ⋯ has [빼기] (the link only; the Drive file stays).
  // FILE-첨부삭제: and [삭제] (off this note and the Drive original to the Drive trash, file-trash.js; [되돌리기] brings both back).
  // FILE-이름고치기연필먹통: and [이름 수정] (the line has no ✎; it opens the same in-place name field as pressing the name twice, file-rename.js).
  const canEditFolders = () => foldersReady;
  const menuItems = (note, from, folderId = null, {goto = false} = {}) => {
    if (from === 'file') return [['data-note-file-rename', '이름 수정'], ['data-note-file-detach', '빼기'], ['data-note-file-delete', '삭제', 'basket-menu-danger']];
    // UI-우클릭전수(2026-11-03): 빈 보드 우클릭 메뉴. 새 노트는 목록 맨 위 입력칸에서 쓴다(입력칸으로 초점).
    if (from === 'board') return [['data-nbb-newnote', '새 노트 쓰기']];
    // ② '보일 칸': 체크 줄(누르면 그 칸 켜기·끄기, 메뉴는 열린 채). 제목은 늘 켜짐이라 없다. 맨 아래 [기본으로].
    if (from === 'cols') { const on = listCols(); return [...NOTE_COLS.map(k => [`data-nl-col-toggle="${k}" role="menuitemcheckbox" aria-checked="${on.includes(k)}"`, `<span class="nl-check" aria-hidden="true">${on.includes(k) ? '✓' : ''}</span>${LIST_COL_NAMES[k]}`]), ['data-nl-cols-reset', '기본으로']]; }
    if (from === 'picked') return [['data-nx-sel-move', `${pick.size}개 — 폴더로 옮기기`], ['data-nx-sel-delete', '삭제', 'basket-menu-danger'], ['data-nx-sel-close', '선택 끝내기']];
    if (from === 'folder' && folderId === OUTSIDE) return [['data-nx-enter', '이 폴더로 들어가기']];
    if (from === 'folder') {
      // SEC-기능PIN잠금: 잠겨 가려진 폴더(하위 포함)는 [열기](PIN)·[잠금 해제]만. 잠그기·풀기는 표 폴더(id가 있는 폴더)만.
      const lockable = canEditFolders() && !!folderById(folderId) && !String(folderId).startsWith('name:');
      const lockItem = lockable ? [pinLock.folderLocked(folderId) ? ['data-nx-lock-folder', '잠금 해제'] : ['data-nx-lock-folder', '잠금']] : [];
      if (pinLock.notesHidden() && pinLock.folderCovered(folderId)) return [['data-nx-lock-open', '열기'], ...(pinLock.folderLocked(folderId) ? lockItem : [])];
      // NOTE-폴더메뉴새노트(11/07): [새 노트](11/24부터 [이 폴더로 들어가기] 다음) — 기존 새 노트 창이 이 폴더가 골라진 채로 열린다(newNoteIn).
      // UI-폴더이름펼치기(명진 11/24 18:09): 폰 폴더 이름 누르기는 그 자리 펼치기·접기만이라, 들어가기는 이 메뉴 첫 줄.
      return [['data-nx-enter', '이 폴더로 들어가기'], ['data-nx-new-note', '새 노트'], ['data-nx-select', '선택'], ...(canEditFolders() ? [['data-nx-new-in', '새 폴더'], ['data-nx-rename', '이름 바꾸기'], ['data-nx-color', '색 선택…'],
        ['data-nx-move-folder', '옮기기…'], ...lockItem, ['data-nx-delete-folder', '폴더 삭제', 'basket-menu-danger']] : [])];
    }
    // PRESS-성명초안삭제(11/09 명진 결정): [성명·보도자료 초안] 메뉴는 기능째 삭제했다(저장해 둔 초안 노트·폴더는 그대로).
    if (from === 'head') return [...(folderAt() ? [['data-nx-new-note', '이 폴더에 새 노트']] : []), ...(canEditFolders() ? [['data-nx-new-in', folderAt() ? '이 폴더에 새 폴더' : '새 폴더']] : []), ['data-nx-select', '선택'], ...(folderAt() ? [['data-nx-up', '위 폴더로']] : []),
      // ①-2: [목록] 보기 정렬(폰은 머리 줄이 없어 여기서만, PC는 머리 칸과 같은 값). 누르면 그 칸, 지금 칸이면 반대로.
      ...(view === 'list' ? [['data-nl-cols-open', '보일 칸…']] : []),
      ...(view === 'list' ? ['title', ...listCols()].filter(k => LIST_HEAD_SORT[k]).map(k => LIST_HEAD_SORT[k]).map(k => { const cur = listSort(), on = cur.key === k; return [`data-nl-sort="${k}"`, `정렬: ${LIST_SORT_NAMES[k]}${on ? ` ${arrowOf(cur.dir)}` : ''}`, on ? 'nl-sort-on' : '']; }) : []),
      ...(view === 'folder' && canEditFolders() ? [['data-nx-sort', noteSort === 'manual' ? `노트 정렬: ${NOTE_SORT_NAMES.changed} 순으로` : `노트 정렬: ${NOTE_SORT_NAMES.manual}로`]] : []),
      // NOTE-이 폴더 삭제(S67-34): 들어간 폴더의 ⋯에도 폴더 ⋯의 [폴더 삭제]와 같은 길(deleteFolder: 안의 노트·폴더는 한 단 위로, [되돌리기]).
      // 맨 위 '노트'·'폴더 없음'에서는 넣지 않는다(folderAt() 없음).
      ...(folderAt() && canEditFolders() && !(pinLock.notesHidden() && pinLock.folderCovered(folderAt())) ? [['data-nx-delete-folder', '이 폴더 삭제', 'basket-menu-danger']] : []),
      ['data-nx-help', '쓰는 법']]; // HELP-메뉴안쓰는법: 화면 ⋯ 맨 아래
    return [
      // LIB-최근폴더로가기(S61-12): '최근' 노트 줄(폰 첫 화면 '최근' 상자·PC 처음 '최근' 목록)이면 맨 위 [폴더로 가기].
      ...(from === 'list' && goto ? [['data-nx-goto-folder', GOTO_FOLDER_LABEL]] : []),
      ...(from === 'list' ? [['data-nx-select', '선택']] : []),
      // 17:45 ③: 줄의 복사 아이콘은 없앴다 — 복사는 PC·폰 모두 이 메뉴(⋯·우클릭·꾹 누르기) 안.
      ...(from === 'list' && noteCopyPayload(note) ? [['data-note-copy', '복사']] : []),
      // S70-04 UI-순서는끌기로: 순서 바꾸기는 끌기(PC 마우스·폰 꾹 눌러 끌기)와 키보드 Alt+↑↓만 — 메뉴 [위로][아래로]는 없앴다.
      // NOTE-보드여러개 ③: 이름 붙은 보드의 칸 메뉴 맨 위 [보드에서 빼기](노트는 그대로).
      ...(from === 'list' && view === 'board' && boards.isNamed() && onBoard(note, boards.current()) ? [['data-nbb-detach', '보드에서 빼기']] : []),
      // S69-88(명진 11/25 02:48 "노트 내용, 링크는 유지하더라도 텍스트는 다르게"): 이 보드에서만 카드에 보일 글자(별명) · 손으로 정한 카드 크기 되돌리기.
      ...(from === 'list' && view === 'board' && boards.isNamed() && onBoard(note, boards.current()) ? [['data-nbb-label', '보드에 보일 글자']] : []),
      ...(from === 'list' && view === 'board' && boards.isNamed() && boards.isSized(note) ? [['data-nbb-autosize', '카드 크기 자동']] : []),
      ...(from === 'list' && view === 'board' && boards.isNamed() && !onBoard(note, boards.current()) ? [['data-nbb-attach', '보드에 붙이기']] : []),
      ['data-note-pin', notePinnedAt(note) ? '고정 풀기' : '고정'], ['data-note-folder-move', '폴더로 옮기기'], ['data-note-edit', '수정'],
      // NOTE-링크원문: 본문(또는 원문 정보)에 https 링크가 있으면 [원문 가져오기] — 이미 쓴 글은 덮지 않고 아래에 붙인다(다시 가져오기도 이것 하나).
      ...(from === 'detail' && noteLinkUrl(note) && !isImporting(note.id) ? [['data-note-import', '원문 가져오기']] : []),
      ...(from === 'detail' ? [['data-basket-link-open', '연결하기'], ['data-note-to-basket', '잊지 말기로 돌리기']] : []),
      // FAMILY-기억알림: 가족 '잊지 말기' 노트만 [줄 정리] — 줄을 고르면 홈 '가족 · 기억할 것' 줄 ⋯와 같은 메뉴(family-remind-menu.js, [과거 기록으로]).
      ...(from === 'detail' && note?.metadata?.family_list === true ? [['data-note-remind-lines', '줄 정리']] : []),
      // NOTE-게시 ②: 잠근 폴더의 노트는 게시를 새로 열지 않는다(이미 게시 중이면 [게시 멈춤]만). 게시 상태를 못 읽었으면 칸을 내지 않는다.
      ...(notePub.isReady() ? pubMenu(notePub.stateOf(note.id), {locked:pinLock.noteInLockedFolder(note)}).map(k => [`data-note-pub-${k}`, PUB_LABELS[k]]) : []),
      ['data-note-to-diary', '하루 기록으로 보내기'], // S48-56: 그날 일기 끝에 글·사진을 더하고 노트는 휴지통(diary-send.js)
      ['data-note-delete', '삭제', 'basket-menu-danger']];
  };
  // FILE-누르면동작: a stored attachment as the shared file shape (file-actions.js).
  const noteFile = (note, fileId) => { const f = (note?.attachments || []).find(x => x.drive_file_id === fileId); return f ? {name: attachmentName(f), mime: f.mime_type, driveId: fileId, noteId: note.id} : null; };
  const fileFail = text => say(text);
  function pressNoteFile(el) {
    const file = noteFile(selected, el.closest('[data-note-file]')?.dataset.noteFile); if (!file) return;
    void pressFile(file, {viewPhoto: () => openPhotoView({row: selected, file: selected.attachments.find(x => x.drive_file_id === file.driveId), trigger: el}), onError: fileFail});
  }
  host.addEventListener('keydown', e => { const el = e.target.closest?.('[data-note-file] .file-line-main'); if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pressNoteFile(el); } });
  function showColorChoice() {
    const el = menuEl(), f = folderById(menu.folderId); if (!f) return;
    el.setAttribute('aria-label', '폴더 색 선택');
    el.innerHTML = colorChoiceHtml(colorOf(f));
    placeAnchored(el, menu.trigger, {maxWidth:220, maxHeight:window.innerHeight});
    (el.querySelector('[aria-pressed="true"]') || el.querySelector('button'))?.focus({preventScroll:true});
  }
  function closeMenu({focus = false} = {}) {
    if (!menu) return null;
    const closed = menu, el = menuEl(); menu = null; closed.stop();
    // The items stay in the (hidden) menu until the next open: basket.js's own click handler runs after this one and must still see the pressed button inside this host.
    el.hidden = true; clearAnchored(el);
    closed.trigger.setAttribute('aria-expanded', 'false');
    if (focus && closed.trigger.isConnected) closed.trigger.focus({preventScroll: true});
    return closed;
  }
  // 메뉴 줄 버튼 글자 한 곳(열 때·'보일 칸' 체크를 바꿔 다시 그릴 때 같이 쓴다).
  const menuButtonsHtml = items => items.map(([attr, label, cls]) => `<button type="button" ${attr}${cls ? ` class="${cls}"` : ''}>${label}</button>`).join('');
  function openMenu(trigger, note, from, fileId = null, folderId = null) {
    if (!note && !['folder', 'head', 'picked', 'board', 'cols'].includes(from)) return;
    if (note && pinLock.noteHidden(note)) { pinLock.askNotes(); return; }
    if (menu?.trigger === trigger) { closeMenu({focus: true}); return; }
    closeMenu();
    const el = menuEl();
    el.setAttribute('aria-label', from === 'folder' || from === 'head' ? '폴더 메뉴' : from === 'board' ? '보드 메뉴' : from === 'file' ? '첨부 파일 메뉴' : from === 'picked' ? '선택한 것 메뉴' : from === 'cols' ? '보일 칸' : '노트 메뉴');
    el.innerHTML = (from === 'file' ? menuItemsHtml(noteFile(note, fileId)) : '') + menuButtonsHtml(menuItems(note, from, folderId, {goto: from === 'list' && view === 'folder' && !!trigger.closest?.('[data-nx-recent-row]')}));
    el.hidden = false;
    // UI-메뉴잘림: 높이를 묶지 않는다(창 높이까지 다 보임, 정말 길 때만 스크롤 + 아래 흐림 — anchored-popup.js).
    const place = () => placeAnchored(el, trigger, {maxWidth: 220, maxHeight: window.innerHeight});
    place();
    menu = {noteId: note?.id ?? null, from, fileId, folderId, trigger, stop: followAnchor(el, trigger, {place, lost: () => closeMenu()})};
    trigger.setAttribute('aria-expanded', 'true');
    el.querySelector('button')?.focus({preventScroll: true});
  }
  const manual = mountManualLink({esc, rt, getNote:() => selected, getLinks:() => links, isBusy:() => busy, setBusy:lock,
    onLinked:linked, onNoteChanged:() => reload(), onModeChange:() => paintMode(), onTaskRecorded:() => {}, sheetId:'noteLinkChoice'});

  async function linked(noteId, targets) {
    for (const target of targets) {
      const key = target.kind === 'project' ? 'project_id' : target.kind === 'reference' ? 'bundle_id' : 'organization_id', named = target.kind === 'reference' ? 'bundle' : target.kind;
      if (!links.some(l => l.note_id === noteId && l[key] === target.target_id && l.status === 'confirmed')) links.push({note_id:noteId, status:'confirmed', [key]:target.target_id, [named]:{name:target.name}});
    }
    renderList(); if (selected?.id === noteId) paintMeta();
    const owner = scope();
    try { const fresh = await readNoteDocs(rt); if (owner !== scope()) return {ok:false, stale:true}; notes = fresh.notes; links = fresh.links; renderList();
      if (selected?.id === noteId) { selected = notes.find(n => n.id === noteId) || selected; paintMeta(); }
      return {ok:true}; }
    catch { return {ok:false}; }
  }
  function paintMeta() {
    if (!selected) return;
    const box = detail.querySelector('[data-note-meta]'), tags = chips(selected);
    const folder = folderName(folderOf(selected));
    // S67-48: #태그 칩(이름 = [태그] 보기로, × = 빼기)과 [+ 태그]. 태그가 없어도 [+ 태그]는 보인다.
    const hash = tagChipsHtml(tagsOfNote(selected), {addOpen:!!readPick?.isOpen()});
    box.innerHTML = `${folder ? `<span class="note-meta-folder" data-note-meta-folder>폴더 ${esc(folder)}</span>` : ''}<span class="note-meta-tags" data-note-meta-tags>${hash}</span>${tags ? `<span class="basket-note-state">${tags}</span>` : `<span class="basket-note-state"><span class="basket-state-text">${esc(noteState(selected, links).status === '확정' ? '분류 완료' : '연결 없음')}</span></span>`}<time>수정한 날 ${esc(day(selected.updated_at))}</time>${newsItemOf(selected) ? '<button type="button" class="note-meta-news" data-note-news>기사로 가기</button>' : ''}`;
    // NEWS-클리핑 C2: 뉴스 클리핑 기사 메모(metadata.news_item_id)인 노트는 [기사로 가기] → 뉴스 클리핑 화면에 그 기사를 연다.
    box.querySelector('[data-note-news]')?.addEventListener('click', () => { if (requestNewsItem(newsItemOf(selected))) window.KPTURouter?.go?.('news', {source:'delegated'}); });
    // UI-일기손질 ⑥: each attachment is the shared file line (meeting-compact.js) with a small [Drive에서 열기] at its end.
    // NOTE-파일붙이기: and a ⋯ after it whose one item, [빼기], takes the file off this note (the Drive file stays).
    // FILE-누르면동작: pressing the line acts by kind (file-actions.js); the small [Drive에서 열기] stays and the ⋯ holds [Drive에서 열기] [내려받기] [빼기].
    const attBox = detail.querySelector('[data-note-attachments]');
    attBox.innerHTML = (selected.attachments || []).map(file => {
      const url = driveFileUrl(file.drive_file_id), name = attachmentName(file);
      const link = url ? `<a class="file-line-link" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="${esc(name)} Drive에서 열기">Drive에서 열기</a>` : '<span class="file-line-state">링크를 확인할 수 없어요.</span>';
      const more = `<button type="button" class="basket-icon-button note-file-more" data-note-file-more="${esc(file.drive_file_id)}" aria-label="${esc(name)} 메뉴" title="메뉴" aria-haspopup="true" aria-expanded="false" aria-controls="noteDocMenu">${MORE_ICON}</button>`;
      return fileLine({name, meta:fileSize(file.size_bytes), cls:'note-file-line', end:link + more, attrs:` data-note-file="${esc(file.drive_file_id)}" data-fr-row`});
    }).join('');
    attBox.querySelectorAll('.file-line-main').forEach(el => { el.setAttribute('role', 'button'); el.tabIndex = 0; });
    // ATT-이름고치기: 이름 글자(두 번 누르기·꾹 누르기)와 ⋯ [이름 수정]으로 그 자리에서 고친다(file-rename.js, ✎는 따로 두지 않는다).
    attBox.querySelectorAll('[data-note-file]').forEach(line => {
      const file = (selected.attachments || []).find(f => f.drive_file_id === line.dataset.noteFile);
      if (file) markRenameHost(line.querySelector('.file-line-main b'), {target:'note', id:selected.id, driveId:file.drive_file_id, name:String(file.file_name || '')});
    });
  }
  // S67-48 태그 칸. 원본은 본문(과 제목)의 #태그 하나 — 따로 저장하는 표를 두지 않는다(같은 자료 두 번 저장 금지).
  // 읽기 화면: 붙이기·빼기가 곧 노트 저장(saveNoteDoc, 읽은 판 updated_at이 그대로일 때만 — 다른 곳에서 바뀌었으면 거절하고 다시 읽음).
  // 고치기 화면: 편집기 글만 바꾼다(저장은 [저장] 그대로). 고르기 칸의 태그 목록은 잠긴 폴더 노트의 태그를 빼고 모은다(잠금 전 태그 이름도 가림).
  let readPick = null, editPick = null, editTagTimer = 0;
  const allTags = () => tagGroups(notes.filter(n => !pinLock.noteHidden(n)));
  const editTags = () => field ? tagsOfNote({title:fields().title?.value || '', raw_text:toPlain(field.getValue())}) : tagsOfNote(selected);
  function makeTagPicks() {
    const addOf = sel => () => detail.querySelector(`${sel} [data-tag-add]`);
    const opts = (sel, have) => ({all:allTags, have, onAdd:tag => changeTags({add:tag}), findTrigger:addOf(sel), onToggle:open => addOf(sel)()?.setAttribute('aria-expanded', String(open))});
    readPick = createTagPick(detail.querySelector('[data-note-tag-pick]'), opts('[data-note-meta-tags]', () => tagsOfNote(selected).map(tagKey)));
    editPick = createTagPick(detail.querySelector('[data-note-edit-tag-pick]'), opts('[data-note-edit-tag-chips]', () => editTags().map(tagKey)));
  }
  function paintEditTags() {
    const box = detail.querySelector('[data-note-edit-tag-chips]'); if (!box || !selected) return;
    box.innerHTML = tagChipsHtml(editTags(), {link:false, addOpen:!!editPick?.isOpen()});
    editPick?.refresh();
  }
  // 바꾸기: {add:태그} 또는 {remove:key}. 되돌림 {ok, message}.
  async function changeTags({add = null, remove = null}) {
    if (!selected || busy) return {ok:false, message:'지금은 태그를 바꿀 수 없어요.'};
    const word = add === null ? null : cleanTagInput(add);
    if (add !== null && !word) return {ok:false, message:TAG_INPUT_HELP};
    const step = (doc, title) => {
      if (word) { if (tagsOfNote({title, raw_text:toPlain(doc)}).some(t => tagKey(t) === tagKey(word))) return null; const next = addTagToDoc(doc, word); return next ? {doc:next, title} : null; }
      const next = removeTagFromDoc(doc, remove), t = removeTagFromTitle(title, remove);
      return next || t !== title ? {doc:next || doc, title:t.trim() ? t : '노트'} : null;
    };
    if (editing) {
      if (!field) return {ok:false, message:'지금은 태그를 바꿀 수 없어요. 잠시 뒤 다시 눌러 주세요.'};
      const f = fields(), next = step(field.getValue(), f.title.value);
      if (next) { field.setValue(next.doc); if (next.title !== f.title.value) { f.title.value = next.title; fitHeight(f.title); } }
      paintEditTags();
      return {ok:true};
    }
    if (filesGoing(selected.id)) return {ok:false, message:'첨부가 다 올라간 뒤 다시 눌러 주세요.'};
    const note = selected, id = note.id, run = ++epoch, owner = scope(); lock(true); say('태그 저장 중…');
    try {
      const next = step(await startValue(note), String(note.title || ''));
      if (run !== epoch || owner !== scope() || selected?.id !== id) return {ok:false, message:'화면이 바뀌어 태그를 저장하지 못했어요.'};
      if (!next) { say(''); return {ok:true}; }
      const prep = prepareSave({value:next.doc, limit:100000});
      if (!prep.ok) { say(prep.message); return {ok:false, message:prep.message}; }
      const saved = await saveNoteDoc(id, {title:next.title, raw_text:prep.text, doc:prep.value, version:note.updated_at}, rt);
      if (run !== epoch || owner !== scope()) return {ok:false, message:'화면이 바뀌어 저장 결과를 확인하지 못했어요.'};
      notes = notes.map(n => n.id === id ? saved : n); renderList(); pubPhotos(saved);
      if (selected?.id === id) { selected = saved; paintRead(); paintMeta(); }
      say(''); readPick?.refresh();
      return {ok:true};
    } catch (error) {
      if (run !== epoch || owner !== scope()) return {ok:false, message:'화면이 바뀌어 저장 결과를 확인하지 못했어요.'};
      const changed = error?.code === 'note_changed', message = changed ? '노트가 그사이 바뀌었어요. 다시 불러온 뒤 붙여 주세요.' : '태그를 저장하지 못했어요. 다시 눌러 주세요.';
      say(message);
      if (changed) { showToast(message); lock(false); void reload(); }
      return {ok:false, message};
    } finally { if (run === epoch) lock(false); else busy = false; }
  }
  // UI-상단줄제목: with the PC top line (761px~) the open note's title is already in the place, so the head has no title line of its
  // own there (the element is not made); below that width it is made, as before.
  const toplineWide = window.matchMedia('(min-width:761px)');
  function syncHeadTitle() {
    const main = detail.querySelector('[data-note-head-main]'); if (!main || !selected) return;
    const has = main.querySelector('[data-note-read-title]');
    if (toplineWide.matches) { has?.remove(); return; }
    if (has) return;
    const h = document.createElement('h3'); h.className = 'note-head-title'; h.dataset.noteReadTitle = ''; h.textContent = selected.title || '노트'; main.prepend(h);
  }
  toplineWide.addEventListener?.('change', syncHeadTitle);
  function paintRead() {
    syncHeadTitle(); paintPub();
    const title = detail.querySelector('[data-note-read-title]'), text = detail.querySelector('[data-basket-read-text]'), raw = selected.raw_text || '';
    if (title) title.textContent = selected.title || '노트';
    sendWhere(selected.title || '제목 없음');
    detail.querySelector('[data-note-telegram]').hidden = !noteCopyPayload(selected);
    const owner = scope(), id = selected.id;
    // BUG-노트HTML표시: .html attachments show in the same sandboxed frames as the memo read view (html-frame.js),
    // under the body text. A note whose only content is HTML has no "no body" sentence.
    const htmlCount = id ? paintHtmlAttachments(detail.querySelector('[data-basket-html-views]'), {noteId:id, attachments:selected.attachments, rt, isCurrent:() => owner === scope() && selected?.id === id}) : 0;
    // NOTE-파일붙이기: a note made of files only (any kind) shows just its file cards, without the "no body" box.
    const files = (selected.attachments || []).length;
    // NOTE-주소로 가져오기: 맨 위 원문 칸(원문 링크·가져오는 중·실패 안내). 가져오는 동안에는 본문 자리('주소만')를 잠시 감춘다(회색 막대가 그 자리).
    const importing = paintNoteSource(detail.querySelector('[data-note-source]'), selected, {rt, say, onChange:saved => {
      if (owner !== scope() || selected?.id !== id) return;
      if (saved?.metadata) applySaved(id, saved);
      if (!editing) paintRead();
    }}).busy;
    text.hidden = importing || (!raw && (htmlCount > 0 || files > 0));
    text.classList.toggle('basket-read-empty', !raw);
    if (!raw) return showPlainText(text, htmlCount || files ? '' : '본문이 없는 노트입니다.');
    // ED③ 노트: a note saved in the new editor reads its saved form (ed-render: headings, tables, colours, photos of this note).
    if (paintDoc(text, selected, {rt, onOpen:(file, el) => openPhotoView({row:selected, file, trigger:el})})) { noteMarksNow(); return; }
    showPlainText(text, raw);
    // NOTE-마크다운선택: a note with 마크다운 off is shown exactly as written (no list, heading or indent made from its lines).
    text.dataset.noteView = noteMarkdown(selected) ? 'markdown' : 'plain';
    // NOTE-유튜브보기: 있는 그대로 보기에서도 글 속 유튜브 주소마다 영상 칸(글 끝에, ▶ 누를 때 재생). 글자는 그대로.
    if (!noteMarkdown(selected)) { addVideoBoxes(text, {whole: true}); noteMarksNow(); return; }
    void renderMarkdownInto(text, raw, {isCurrent: () => owner === scope() && selected?.id === id && !editing, videos: true}).then(() => { if (owner === scope() && selected?.id === id) noteMarksNow(); });
  }
  function paintMode() {
    if (!selected) return;
    detail.querySelector('[data-note-read]').hidden = editing;
    detail.querySelector('[data-note-head-main]').hidden = editing; if (editing) closeMenu();
    // The link form was openSet from the ⋯ menu; when it closes, focus goes back to the ⋯ (there is no [연결하기] button left to find).
    const linking = manual.isOpen(); if (linkOpen && !linking && !editing) detail.querySelector('[data-note-more]')?.focus({preventScroll:true}); linkOpen = linking;
    detail.querySelector('[data-note-editor]').hidden = !editing; detail.querySelector('[data-note-edit-actions]').hidden = !editing;
    (editing ? readPick : editPick)?.close(); if (editing) paintEditTags();
  }
  // UI-돌아가기머리줄: '‹ 노트' (phones only) from the list, '‹ (name)' (every width) when opened from another screen.
  const NOTE_BACK = '<button type="button" class="basket-back note-back" data-note-back aria-label="노트 목록으로"><span aria-hidden="true">‹</span> 노트</button>';
  function showDetail() {
    // UI-기록아이콘: openSet from a project's or organization's record line, the note has no history entry of its own (one back
    // returns to that project or organization, like an update openSet from there) and its head back reads "‹ (name)" (UI-돌아가기머리줄).
    const from = !!selected && !!basketNoteOrigin(selected.id, rt);
    // NAV-PC앞뒤통일: › (or the browser's forward) over this note's entry opens the same note again (reopen).
    const reopenId = selected?.id;
    if (!from) layer ||= window.KPTURouter?.layer?.open('basket-notedoc', {close: () => !busy && close({fromBack:true}), reopen: () => open(reopenId)}) || null;
    // NAV-새로고침제자리: the open note is written on its own entry (?doc=), so a reload reopens it; close drops it first.
    if (layer && selected) window.KPTURouter?.setPlace?.('basket', {doc:selected.id});
    ++epoch; dropField(); editing = false; linkOpen = false; placeDetail(); onOpenChange(true);
    // UI-엔터저장: title Enter / body Ctrl+Enter (PC) save through the shared rule (enter-save.js).
    detail.dataset.enterSave = '[data-note-save]';
    detail.innerHTML = `<div class="basket-detail-head">${basketBackHtml(selected?.id, NOTE_BACK, rt)}<div class="note-head-main" data-note-head-main><button type="button" class="basket-icon-button" data-note-telegram aria-label="복사" title="복사">${COPY_ICON}</button><button type="button" class="basket-icon-button basket-more-trigger" data-note-more data-ctx="area" aria-label="이 노트 메뉴" title="메뉴" aria-haspopup="true" aria-expanded="false" aria-controls="noteDocMenu">${MORE_ICON}</button></div></div><div class="basket-read note-read" data-note-read><p class="note-pub-line" data-note-pub-line hidden></p><div class="ni" data-note-source hidden></div><div class="basket-read-text line-w" data-basket-read-text tabindex="-1" role="region" aria-label="노트 본문"></div><div class="basket-html-views" data-basket-html-views tabindex="-1" role="region" aria-label="HTML 첨부 화면"></div><p class="basket-note-meta" data-note-meta></p><div data-note-tag-pick hidden></div><section class="memo-th" data-note-comments aria-label="메모"></section></div><div class="basket-editor note-editor" data-note-editor hidden><label class="basket-text-label">노트 제목<textarea rows="1" data-note-title-input data-autogrow data-enter-field="single" autocomplete="off" enterkeyhint="done"></textarea></label><div class="note-body-field" data-note-body-field role="group" aria-label="본문"></div><div class="note-edit-tags" data-note-edit-tags role="group" aria-label="태그"><span class="note-meta-tags" data-note-edit-tag-chips></span><div data-note-edit-tag-pick hidden></div></div></div><div data-note-attachments class="note-files" tabindex="-1" role="region" aria-label="첨부 파일"></div><button type="button" data-note-reload hidden>노트 최신화</button><div data-basket-manual hidden></div><div class="basket-actions note-edit-actions save-row save-row-sticky" data-note-edit-actions hidden><button type="button" class="secondary save-row-start" data-note-big-write>큰 창에서 수정</button><button type="button" class="secondary" data-note-cancel>취소</button><button type="button" class="primary" data-note-save>저장</button></div><p data-basket-status role="status"></p>`;
    manual.attach(detail.querySelector('[data-basket-manual]'));
    makeTagPicks();
    // NOTE-내용확대축소(S61-16 ③): 읽기 머리 줄 [−] 100% [+] — 노트 글(--note-zoom)과 HTML 첨부(html-frame.js가 다시 그림)만 바뀐다.
    // NOTE-배율자리(S61-45): 폰 폭은 글 크기 아이콘 한 칸, 누르면 아래로 펼침(제목 자리 확보). 폴드 펼침·PC는 묶음 그대로.
    zoomBox?.destroy(); zoomBox = zoomFoldControl();
    detail.querySelector('[data-note-head-main]').prepend(zoomBox.node);
    // NOTE-글폭(S61-21): 글 줄 기본 폭 한 줄 약 40자 + 글 오른쪽 끝 손잡이(폭은 서버, 일기·쓰기 창과 같은 값). 손잡이는 다시 그려지는 글 칸 밖(읽기 칸)에 둔다.
    lineGrip?.destroy(); lineGrip = mountLineWidth({host:detail.querySelector('[data-note-read]'), target:detail.querySelector('[data-basket-read-text]')});
    paintZoom();
  }
  let zoomBox = null, lineGrip = null;
  const paintZoom = () => { detail.style.setProperty('--note-zoom', String(zoomScale())); lineGrip?.place(); };
  window.addEventListener(NOTE_ZOOM_EVENT, paintZoom);
  // 잠금이 풀리거나 다시 잠기면 목록을 다시 그린다. 열린 노트가 다시 잠긴 폴더에 있으면 닫는다(그 자리에 자료를 남기지 않음).
  // S67-23: 고치던 중(저장 안 한 글이 있음)에 다시 잠기면 버리지 않고 정리함째 잠금 화면 뒤에 숨긴다 — PIN을 풀면 쓰던 그대로 돌아온다.
  // 큰 쓰기 창(화면 위에 뜬 창)이 열려 있으면 숨길 수 없으니 지금처럼 닫는다.
  const holdable = () => editing && !bigWriter && !busy && window.KPTURouter?.current === 'basket' && (textDirty() || manual.hasDraft() || noteComments.hasDraft());
  window.addEventListener('kptu:feature-lock-changed', () => {
    if (!loaded) return;
    if (selected && pinLock.noteHidden(selected)) {
      if (pinLock.held() === 'basket') return;
      if (holdable()) { closeMenu(); pinLock.askNotes({notes:true}, {hold:true}); return; }
      close({focus:false, force:true}); return;
    }
    if (!selected) renderList();
  });
  // 잠금 화면에서 PIN 없이 정리함으로 왔으면(붙들어 둔 노트를 놓음) 잠긴 노트는 닫는다 — 그 자리에 자료를 남기지 않는다.
  window.addEventListener('kptu:view-changed', event => {
    if (event.detail?.view === 'basket' && loaded && selected && pinLock.noteHidden(selected)) close({focus:false, force:true, fromBack:true});
  });
  // PC: 열린 노트 읽기 칸 위에서만 Ctrl+휠·Ctrl+(+ − 0)이 이 배율을 바꾼다(고치는 중에는 브라우저 그대로).
  bindZoomKeys(detail, {active:() => !!selected && !editing && !detail.hidden});
  function open(id, {focus = true} = {}) {
    if (pinLock.noteHidden(notes.find(n => n.id === id))) { pinLock.askNotes(); return; }
    if (!selected) listScroll = window.scrollY;
    selected = notes.find(n => n.id === id); if (!selected) return;
    showDetail();
    paintRead(); paintMeta(); paintMode(); lineGrip?.place();
    void loadHighlights().catch(() => {}); // 노트 밑줄(S62-17) — 읽히면 onHighlights가 칠한다
    noteComments.attach(detail.querySelector('[data-note-comments]'), {type:'note', id:selected.id, title:noteLineTitle(selected)});
    if (splitOpen()) renderList(); // 왼쪽 나무에 지금 연 노트 표시
    if (focus) readFocus().focus();
  }
  // S69-27: 두 칸에서 노트를 연 채 왼쪽 나무의 다른 노트를 누르면 그 노트로 바꾼다(고치던 글이 있으면 먼저 묻는다). 열린 노트가 없으면 그냥 열기.
  async function switchNote(id, anchor) {
    if (!selected) { open(id); return; }
    if (selected.id === id || busy) return;
    if (textDirty() || manual.hasDraft()) {
      const was = selected.id;
      if (!(await askConfirm(anchor, {text:textDirty() ? '수정하던 노트를 저장하지 않고 다른 노트를 열까요?' : '작성 중인 연결 입력을 삭제하고 다른 노트를 열까요?', ok:textDirty() ? '저장 안 함' : '삭제', danger:true})) || busy || selected?.id !== was) return;
    }
    noteComments.detach(); bigWriter?.close({silent:true}); bigWriter = null; closeMenu(); manual.reset();
    open(id);
  }
  // ED③ 노트: the new big window (note-window.js) with a title row, [폴더 ▾], [📎 첨부] and the line shortcuts. It saves a note (createNoteDoc
  // with its saved form) and closes; the saved note then opens here in its read view. Text closed without saving goes back into the input
  // as letters (this tab's memory only, never browser storage).
  // NOTE-목록에파일놓기: dropped = PC files dropped on the list. Then the window has its own file batch (not the input's), the title box
  // starts with the first file's name, and closing without saving leaves nothing behind (the input's letters and files stay as they were).
  async function openNew(text = '', upload = null, dropped = null) {
    if (selected || busy || bigWriter || bigWindowOpen()) return;
    const owner = scope();
    const {openNoteWindow} = await import('./note-window.js');
    if (owner !== scope() || selected || bigWriter) return;
    // NOTE-파일붙이기: the window's [📎 첨부] works on the note input's own files (a saved note empties them).
    bigWriter = openNoteWindow({text, title:'새 노트', rt, upload, dropped, blocks:true, heading:dropped ? droppedTitle(dropped) : '', noteFolder:{label:() => folderName(addTarget()) || OUTSIDE_NAME, get:() => addTarget(), open:trigger => openAddPicker(trigger)}, onClose:({saved, text:value}) => {
      bigWriter = null;
      if (owner !== scope()) return;
      if (!dropped) quick.setText(saved ? '' : value);
      // NOTE-주소로 가져오기: [가져오기]로 만든 노트는 폴더까지 넣은 채 만들어졌고 목록 줄은 아래 syncImported가 올린다(열지 않고 목록에 둔다).
      if (saved?.imported) { quick.focus(); return; }
      if (saved?.kind === 'note') { noteAdded(saved, {open:true}); return; }
      quick.focus();
    }});
    if (bigWriter) bigWriter.paint = () => bigWriter?.paintFolder?.();
  }
  // A new note (input [추가] or the write window) goes into the folder named on the input's [폴더 ▾] (addTarget): the folder chip
  // that is shown, unless another one was picked there; the list is read again.
  // From the write window it then opens; from the input the list stays (like an update added in the basket).
  function noteAdded(saved, {open}) {
    const into = addTarget(), owner = scope();
    if (into) { void putNewNote(saved, into, owner, open); return; }
    if (open) pendingOpen = saved.id;
    void refresh();
  }
  const closeText = () => textDirty() ? '수정하던 노트를 저장하지 않고 목록으로 돌아갈까요?' : manual.hasDraft() ? '작성 중인 연결 입력을 삭제하고 목록으로 돌아갈까요?' : '';
  // S48-28: 화면 안 버튼·Esc로 닫을 때는 공용 작은 확인창으로 묻는다. 기다리는 사이 다른 노트가 열렸거나 작업이 시작됐으면 그대로 둔다.
  async function askClose(anchor) {
    if (!selected) return true;
    const text = closeText(), id = selected.id;
    if (!text) return close();
    if (!(await askConfirm(anchor, {text, ok:textDirty() ? '저장 안 함' : '삭제', danger:true})) || busy || selected?.id !== id) return false;
    return close({force:true});
  }
  // 뒤로가기(겹 닫기)는 라우터가 그 자리에서 답을 받아야 해서 브라우저 기본 확인창을 그대로 쓴다(S48-28 예외).
  function close({focus = true, force = false, fromBack = false} = {}) {
    if (!selected) return true;
    if (!force) { const text = closeText(); if (text && !window.confirm(text)) return false; }
    noteComments.detach(); // 쓰던 메모는 이 화면 메모리에 남아 같은 노트를 다시 열면 그대로 보인다(묻지 않음).
    bigWriter?.close({silent:true}); bigWriter = null; dropField();
    const wasSplit = splitOpen();
    closeMenu(); const id = selected.id; ++epoch; selected = null; editing = false; manual.reset();
    detail.replaceChildren(); placeDetail(); sendWhere(null); onOpenChange(false); renderList();
    if (!fromBack) window.KPTURouter?.setPlace?.('basket', {doc:null});
    const openedLayer = layer; layer = null; if (!fromBack) openedLayer?.close();
    if (window.KPTURouter?.current === 'basket' && !wasSplit) window.scrollTo({top:listScroll, behavior:'instant'}); // 두 칸이면 나무는 그 자리 그대로
    if (focus) ((id ? host.querySelector(`[data-note-row="${CSS.escape(id)}"]`) : null) || host.querySelector('[data-note-search]'))?.focus({preventScroll:true});
    return true;
  }
  // ED③ 노트: [수정] opens the note in the new editor (an old note without doc is converted in memory only; nothing is written by opening).
  // The note's version (updated_at) at that moment is the save's guard: a note changed in another tab or device is refused (note_changed).
  async function startEdit() {
    if (!selected || editing || busy) return;
    editing = true; const f = fields(), id = selected.id, run = epoch; f.title.value = selected.title || ''; say('');
    fieldBase = selected.updated_at;
    paintMode(); fitHeight(f.title); f.title.focus(); // UI-줄입력늘어나기: 긴 제목도 열자마자 전체가 보이게
    const host = detail.querySelector('[data-note-body-field]');
    try {
      // NOTE-제목서식줄고정(S61-16 ②): 제목 칸은 서식 줄과 한 묶음으로 편집기 위 띠에 들어가 위에 붙는다(닫으면 제자리로 돌아온다).
      const made = await mountEditField(host, selected, {photos:photosFor(id), files:filesFor(id), lead:f.title.closest('label'), blocks:blocksFor(id)});
      if (run !== epoch || !editing || selected?.id !== id || !host.isConnected) { made.destroy(); return; }
      field?.destroy(); field = made; paintEditTags();
    } catch { if (run === epoch && editing) say('수정 화면을 열지 못했어요. 다시 눌러 주세요.'); }
  }
  const dropField = () => { field?.destroy(); field = null; fieldBase = null; };
  // NOTE-노션편집 ①(나): '블록 편집'(손잡이 ⋮⋮) 켜기·끄기. 이 노트에서 고른 값(metadata.block_edit)이 먼저, 없으면 내 기본값(view_prefs.note_blocks), 없으면 끔(글쓰기).
  // [블록]을 누르면 이 노트 값과 내 기본값을 함께 기억한다(서버 저장, 기기 저장 없음). 노트 값 쓰기는 고치기가 아니라 updated_at·저장 판은 그대로다.
  const blocksFor = id => ({
    on: noteBlockEdit(selected) ?? (viewPrefs.get('note_blocks') === true),
    onToggle: on => {
      viewPrefs.set('note_blocks', on, {rejectable:true});
      const note = notes.find(n => n.id === id); if (!note) return;
      setNoteBlockEdit(note, on, rt).then(saved => { if (saved?.metadata) applySaved(id, saved); }).catch(() => say('블록 모드 선택을 이 노트에 기억하지 못했어요. 다음에 열면 기본값으로 열려요.'));
    },
  });
  async function finishEdit({force = false, anchor = null} = {}) {
    if (!selected || !editing) return;
    if (!force && textDirty()) {
      const id = selected.id;
      if (!(await askConfirm(anchor, {text:'수정하던 내용을 저장하지 않고 읽기 화면으로 돌아갈까요?', ok:'저장 안 함', danger:true})) || busy || !editing || selected?.id !== id) return;
    }
    bigWriter?.close({silent:true}); bigWriter = null;
    dropField();
    editing = false; if (!force) say(''); paintRead(); paintMode(); readFocus().focus();
  }
  // Photos in the text (사진·링크 넣기): a picture goes up as one of this note's attachments (Drive "노트 첨부", owner only) and is put in
  // as drive:<file id>. The note is read again afterwards so its cards and the editor see the new file.
  // S48-21 [파일]: the same upload for a file card in the text (filesFor).
  const photosFor = id => notePhotos({rt, getNote:() => selected?.id === id ? selected : null, upload:noteUpload(id)});
  const filesFor = id => noteFiles({getNote:() => selected?.id === id ? selected : null, upload:noteUpload(id)});
  function noteUpload(id) {
    return async files => {
      // 이 노트의 첨부가 뒤에서 올라가는 중이면 그 뒤에 선다(서버는 노트가 그사이 바뀌면 올리기를 거절한다 — note_changed).
      await fileQueue.settled(id);
      const note = selected?.id === id ? selected : null; if (!note) throw new Error('노트가 바뀌어 넣지 못했어요.');
      const batch = createUploadBatch(id, note.attachments || []);
      batch.entries = [...files].map(file => ({file, kind:'pending', label:'대기'}));
      await uploadNoteFiles(id, batch, {rt, isCurrent:() => selected?.id === id});
      const row = await readNoteDoc(id, rt);
      if (row && selected?.id === id) {
        // The new file moved the note's version: the edit keeps its guard on that new version (the photo upload is this edit's own change).
        if (fieldBase && Date.parse(row.updated_at) > Date.parse(fieldBase)) fieldBase = row.updated_at;
        notes = notes.map(n => n.id === id ? row : n); selected = row; renderList(); paintMeta();
      }
      return row?.attachments || batch.attachments;
    };
  }
  // [큰 창에서 수정] (NOTE-큰창저장유지): the same edit in the new big window (note-window.js). Its save icon is this view's own save
  // (stay: the window stays and says 저장했어요); ✕ closes it (asking once when something changed after the last save). Closed right
  // after a save, the note shows its read view; otherwise the window's text goes back into the edit field.
  // NOTE-파일붙이기: [📎 첨부] under the text; chosen files go up with this note's id after the text is saved.
  let bigFiles = null;
  const pendingFiles = () => bigFiles ? bigFiles.entries.filter(entry => entry.kind !== 'success').length : 0;
  async function openBigWriter() {
    const id = selected?.id;
    if (!selected || !editing || busy || !field || bigWriter || bigWindowOpen()) return;
    const same = () => editing && selected?.id === id && !!field;
    bigFiles = createUploadBatch(id, selected.attachments || []);
    const {openNoteEditWindow} = await import('./note-window.js');
    if (!same() || bigWriter) return;
    // The window shows the note's title and [폴더 ▾] (the folder now, changeable); a changed title goes with the text save, a changed folder
    // is written after it (setNoteFolder, as [폴더로 옮기기]).
    const folder = windowFolderPick(folderOf(selected));
    // NOTE-노션편집 ①(나): the window starts with the edit field's 블록 편집 state; its [블록] changes both (and is kept as on the field).
    const keep = blocksFor(id);
    const blocks = {on:!!field.editor?.blocksOn?.(), onToggle:on => { field?.editor?.setBlocks?.(on); keep.onToggle(on); }};
    bigWriter = openNoteEditWindow({value:field.getValue(), photos:photosFor(id), files:filesFor(id), title:fields().title.value, folder, blocks,
      attach:{getBatch:() => bigFiles, isBusy:() => busy, going:job => fileQueue.has(id, job.file)},
      save: async (value, text, extra) => {
        if (!same()) return {ok:false, message:'수정 화면이 바뀌어 저장하지 못했어요.'};
        field.setValue(value); fields().title.value = extra.title;
        const result = await save({stay:true});
        if (!result.ok || !same() || extra.folder === undefined || !selected || folderOf(selected) === extra.folder) return result;
        return moveFromWindow(extra.folder, result);
      },
      onClose: ({value, saved} = {}) => {
        bigWriter = null; bigFiles = null; if (!same()) return;
        field.setValue(value);
        if (saved && !textDirty()) finishEdit({force:true}); else field.focus();
      }});
  }
  // The big window's folder change, after its text was saved: the same write as [폴더로 옮기기] (a move does not touch updated_at, so the edit's guard stays).
  async function moveFromWindow(name, result) {
    const note = selected, run = ++epoch, owner = scope(); lock(true);
    try {
      const target = folderById(name), saved = await setNoteFolderRef(note, target, rt);
      if (run !== epoch || owner !== scope()) return {ok:false, message:'화면이 바뀌어 폴더 저장 결과를 확인하지 못했어요.'};
      applySaved(note.id, saved); renderList(); paintMeta();
      return {...result, message:target ? `저장했어요. '${target.name}' 폴더에 있어요.` : `저장했어요. '${OUTSIDE_NAME}'에 있어요.`};
    } catch (error) {
      if (run !== epoch || owner !== scope()) return {ok:false, message:'화면이 바뀌어 폴더 저장 결과를 확인하지 못했어요.'};
      return {ok:false, message:`글은 저장했지만 폴더를 옮기지 못했어요. ${error?.code === 'note_changed' ? error.message : '다시 눌러 주세요.'}`};
    } finally { if (run === epoch) lock(false); else busy = false; }
  }
  // save() resolves {ok:true} or {ok:false, message}; the big window's save icon waits for it (same path as [저장]).
  // stay (the big window): the edit stays open after the save (NOTE-큰창저장유지); the window shows the message.
  // ED③ 노트: title, the letters taken out of the saved form (raw_text, for search·AI·journal) and the saved form (doc) go in one guarded write.
  async function save({stay = false} = {}) {
    if (!selected || !editing || busy) return {ok:false, message:'지금은 저장할 수 없어요.'};
    if (!field) { const message = '수정 화면을 여는 중이에요. 잠시 뒤 다시 눌러 주세요.'; say(message); return {ok:false, message}; }
    const f = fields(), files = stay ? pendingFiles() : 0;
    if (!textDirty() && !files) { if (stay) return {ok:true, message:'저장했어요'}; showToast('저장된 노트입니다.'); finishEdit({force:true}); return {ok:true}; }
    if (!textDirty()) return await saveFiles();
    const prep = prepareSave({value:field.getValue(), limit:100000});
    if (!prep.ok) { say(prep.message); return {ok:false, message:prep.message}; }
    const changes = {title:f.title.value, raw_text:prep.text, doc:prep.value, version:fieldBase};
    try { validateNoteTitle(changes.title); validateNoteBody(changes.raw_text); } catch (error) { say(error.message); return {ok:false, message:error.message}; }
    const id = selected.id, run = ++epoch, owner = scope(); lock(true); say('저장 중…');
    try {
      // 이 노트의 첨부가 뒤에서 올라가는 중이면 글 저장은 그 뒤에 선다: 첨부가 노트의 판(updated_at)을 옮기므로, 먼저 보내면 글 저장도
      // 올리기도 '다른 곳에서 바뀜'으로 잘못 걸린다. 다 올라간 뒤의 판(fieldBase)으로 저장한다.
      if (fileQueue.going(id)) { say('첨부가 다 올라가면 이어서 저장해요…'); await fileQueue.settled(id); if (run !== epoch || owner !== scope()) return {ok:false, message:'화면이 바뀌어 저장 결과를 확인하지 못했어요.'}; changes.version = fieldBase; }
      const note = await saveNoteDoc(id, changes, rt);
      if (run !== epoch || owner !== scope()) return {ok:false, message:'화면이 바뀌어 저장 결과를 확인하지 못했어요.'};
      notes = notes.map(n => n.id === id ? note : n); selected = note; fieldBase = note.updated_at; field.markSaved(); renderList(); paintMeta(); pubPhotos(note);
      if (stay && files) { lock(false); return await saveFiles({textSaved:true}); }
      if (stay) { say(''); return {ok:true, message:'저장했어요'}; }
      finishEdit({force:true}); say(''); showToast('노트를 저장했습니다.');
      return {ok:true};
    } catch (error) {
      if (run !== epoch || owner !== scope()) return {ok:false, message:'화면이 바뀌어 저장 결과를 확인하지 못했어요.'};
      const changed = error?.code === 'note_changed', message = changed ? error.message : '저장하지 못했어요. 다시 눌러 주세요.';
      say(changed ? message : '저장하지 못했어요. 다시 시도해 주세요.');
      if (changed) detail.querySelector('[data-note-reload]').hidden = false;
      return {ok:false, message};
    } finally { if (run === epoch) lock(false); else busy = false; }
  }
  // UX-먼저묻고뒤에처리 3차 (2): the big window's files, after its text (if any) was saved, go up behind the screen by the id of the note
  // they were chosen for. [저장] hands the chosen batch to that note's line (fileQueue, memory only) and the window starts a fresh batch
  // at once: nothing is locked, the window and the note can be closed, another note or screen opened, and files saved meanwhile wait in
  // the same line. Progress is the shared upload line (this window's row while it shows that note, else the line above the bottom bar);
  // the end and a failure are the shared small notice ([다시] sends only what did not go up). Only another account or workspace stops it.
  // BIZ-저장먼저닫기 2차(S59-8): 줄은 basket-upload.js의 노트 줄 하나(새 노트 [저장]도 같은 줄에 선다 — 그 노트를 열면 같은 잠금이 걸린다).
  const fileQueue = noteFileLine;
  function saveFiles({textSaved = false} = {}) {
    if (!selected || busy || !bigFiles) return {ok:false, message:'지금은 저장할 수 없어요.'};
    const id = selected.id, batch = bigFiles;
    if (batch.blocked) return {ok:false, message:batch.blocked.message};
    bigFiles = createUploadBatch(id, batch.attachments); bigWriter?.renderFiles?.();
    sendNoteFiles(id, batch);
    // UX-알림하나로(S59-21): 첨부를 올리는 진행·끝은 창의 올리는 줄·하단바 위 한 줄이 말한다(창 상태 줄에 '올리는 중'을 또 쓰지 않는다).
    return {ok:true, message:textSaved ? '글을 저장했어요' : ''};
  }
  function sendNoteFiles(id, batch) {
    const owner = scope(), here = () => owner === scope();
    const count = () => batch.entries.filter(entry => entry.kind === 'success').length;
    void fileQueue.add(id, batch, async () => {
      if (!here() || !batch.entries.some(entry => entry.kind !== 'success')) return;
      const before = count(), mine = batch.entries.filter(entry => entry.kind !== 'success'), sent = () => mine.filter(entry => entry.kind === 'success').map(entry => entry.file?.name || '');
      const files = mine.map(entry => entry.file); // 끝 알림이 맡는 파일(올라가면 entry.file은 이름·크기만 남는다)
      let error = null;
      try { await uploadNoteFiles(id, batch, {rt, isCurrent:here}); } catch (e) { error = e; }
      if (!here()) return; // 다른 계정·작업공간 화면에는 아무것도 그리지도 알리지도 않는다
      // [다시]: 못 올린 파일만 같은 노트로 다시 줄 세운다. 결과를 알 수 없거나 노트가 바뀐 실패(batch.blocked)는 [다시]를 두지 않는다.
      // 올리는 도우미가 붙여 둔 '줄 밖 [다시]'를 노트를 다시 읽기 전에 바로 바꿔 둔다(읽는 사이에 눌러도 같은 파일을 줄 밖으로 한 번 더 보내지 않게).
      const retry = error && !batch.blocked && batch.entries.some(entry => entry.kind !== 'success') ? () => sendNoteFiles(id, batch) : null;
      if (retry) for (const entry of batch.entries.filter(e => e.kind === 'error')) setUploadRetry(entry.file, retry);
      // The note is read again so the cards and the list show what the server stored, whatever happened to each file.
      let row = null;
      try { row = await readNoteDoc(id, rt); } catch {}
      if (!here()) return;
      if (row) {
        notes = notes.map(n => n.id === id ? row : n); renderList();
        // Another note on the screen is left as it is; only the list row above changes.
        if (selected?.id === id) {
          selected = row;
          // These files moved the note's version: an edit open on it keeps its guard on that new version (the upload is its own change).
          if (fieldBase && Date.parse(row.updated_at) > Date.parse(fieldBase)) fieldBase = row.updated_at;
          if (!editing) paintRead(); paintMeta();
          if (bigFiles?.note_id === id) bigFiles.attachments = row.attachments || [];
        }
      }
      const done = count() - before, left = batch.entries.filter(entry => entry.kind !== 'success').length;
      // UX-알림하나로(S59-21): 끝·실패·[다시 올리기]는 하단바 위 한 줄 하나 — 큰 창이 열려 있어도 창 상태 줄·위쪽 작은 알림으로 또 알리지 않는다
      // (files: 창의 올리는 줄이 이 파일들의 '실패 [다시]'·'✓ 완료'를 따로 그리지 않게).
      if (!error) { announceUploaded({done, names:sent(), where:'노트', files}); return; }
      if (error.code === 'upload_cancelled') { announceDock({text:'업로드를 취소했어요', files}); return; }
      if (done) announceUploaded({done, names:sent(), failed:left, where:'노트', retry, note:error.message || '', files});
      else announceDock({text:`노트 첨부 ${left}개 못 올렸어요`, note:error.message || '', error:true, ms:0, files, actions:retry ? [{label:'다시 업로드', aria:'못 올린 파일 다시 업로드', run:retry}] : []});
    });
  }
  // 올리는 동안에도 잠그는 것: 같은 노트의 빼기·삭제·고정·옮기기. 서버는 올리는 사이 노트가 바뀌면 그 올리기를 거절하므로(updated_at·attachments
  // 맞춤) 다 올라간 뒤에 한다. 닫기·다른 노트·다른 화면·더 붙이기는 잠그지 않는다.
  // BIZ-저장먼저닫기 2차(S59-8): 새 노트의 사진·파일이 뒤에서 다 올라가면(새 노트 큰 창·빠른 입력칸·폰 공유) 그 노트를 다시 읽어 목록 줄과 열린 노트를 맞춘다.
  // 글 속 자리를 맞추느라 글이 바뀌었으면(text) 열린 고치기의 기준 판은 그대로 둔다(그 고치기는 저장할 때 '그사이 바뀌었어요'로 멈춘다 — 덮어쓰지 않는다).
  // 목록을 아직 읽는 중이라(새 노트를 막 더함) 그 노트가 목록에 없으면, 목록 읽기가 끝난 뒤 한 번 더 읽는다(lateSent — 먼저 읽은 목록이 올리기 전 모습일 수 있다).
  async function rereadSent(id, text) {
    const owner = scope();
    let row = null;
    try { row = await readNoteDoc(id, rt); } catch {}
    if (!row || owner !== scope()) return;
    notes = notes.map(n => n.id === id ? row : n); renderList();
    if (selected?.id === id) {
      selected = row;
      if (!text && fieldBase && Date.parse(row.updated_at) > Date.parse(fieldBase)) fieldBase = row.updated_at;
      if (!editing) paintRead(); paintMeta();
      if (bigFiles?.note_id === id) bigFiles.attachments = row.attachments || [];
    }
  }
  window.addEventListener('kptu:note-files-sent', e => {
    const id = e.detail?.id; if (!id) return;
    if (!notes.some(n => n.id === id) && selected?.id !== id) { lateSent.set(id, !!e.detail.text); return; }
    void rereadSent(id, !!e.detail.text);
  });
  const filesGoing = id => { if (!fileQueue.going(id)) return false; report('첨부를 올리는 중이에요. 다 올라간 뒤에 할 수 있어요.'); return true; };
  // NOTE-파일붙이기 [빼기]: the file leaves this note only (detachNoteFile); the Drive file stays where it is.
  async function detachFile(note, fileId) {
    if (!note || busy || filesGoing(note.id)) return;
    const file = (note.attachments || []).find(f => f?.drive_file_id === fileId); if (!file) return;
    const trigger = () => detail.querySelector(`[data-note-file-more="${CSS.escape(fileId)}"]`);
    const yes = await askConfirm(trigger(), {text:`'${attachmentName(file)}' 파일을 이 노트에서 뺄까요?`, note:'Drive의 파일은 그대로 남아요.', ok:'빼기'});
    if (!yes) { trigger()?.focus({preventScroll:true}); return; }
    if (busy || selected?.id !== note.id) return;
    const id = note.id, run = ++epoch, owner = scope(); lock(true); say('');
    try {
      const {row} = await detachNoteFile(id, fileId, rt);
      if (run !== epoch || owner !== scope()) return;
      if (row) { notes = notes.map(n => n.id === id ? row : n); if (selected?.id === id) selected = row; }
      renderList(); if (selected?.id === id) { if (!editing) paintRead(); paintMeta(); }
      showToast('파일을 노트에서 뺐어요. Drive에는 그대로 있어요.');
    } catch (error) {
      if (run !== epoch || owner !== scope()) return;
      say(error?.code === 'note_changed' || error?.code === 'note_missing' ? error.message : '파일을 빼지 못했어요. 다시 시도해 주세요.');
    } finally {
      if (run === epoch) lock(false); else busy = false;
      if (run === epoch && selected?.id === id) (detail.querySelector('[data-note-file-more]') || detail.querySelector('[data-note-attachments]'))?.focus({preventScroll:true});
    }
  }
  // FILE-첨부삭제 [삭제]: one question, then the server takes the file off this note and sends the Drive original to the trash
  // (file-trash.js → document-actions trash-file). The note is read again after it (and after [되돌리기]) and drawn by this screen.
  async function deleteFile(note, fileId) {
    if (!note || busy || filesGoing(note.id)) return;
    const file = (note.attachments || []).find(f => f?.drive_file_id === fileId); if (!file) return;
    const trigger = () => detail.querySelector(`[data-note-file-more="${CSS.escape(fileId)}"]`);
    const id = note.id, owner = scope();
    const reload = async () => {
      if (owner !== scope()) return;
      let row = null; try { row = await readNoteDoc(id, rt); } catch { row = null; }
      if (owner !== scope() || !row) return;
      notes = notes.map(n => n.id === id ? row : n); if (selected?.id === id) selected = row;
      renderList(); if (selected?.id === id) { if (!editing) paintRead(); paintMeta(); }
    };
    say('');
    const result = await deleteAttachment({target:'note', id, driveId:fileId, name:attachmentName(file)}, {rt, anchor:trigger(), onChanged:reload, toast:showToast});
    if (owner !== scope()) return;
    if (result.status === 'cancel') { trigger()?.focus({preventScroll:true}); return; }
    if (result.status === 'failed') say(result.message);
    if (selected?.id === id) (detail.querySelector('[data-note-file-more]') || detail.querySelector('[data-note-attachments]'))?.focus({preventScroll:true});
  }
  async function telegram(note = selected, button = null) {
    // ED③ 노트: a note with doc copies the new editor's 텔레그램 letters (ed-text toTelegram); without, the old conversion.
    const payload = docCopy(note) || noteCopyPayload(note); if (!payload) return;
    const ok = await copyText(payload.text);
    if (ok && button) flashDone(button); // UI-눌림느낌 (an element, or a getter for a button that is looked up after the menu closed)
    showToast(ok ? payload.done : '복사하지 못했어요. 다시 눌러 주세요.');
  }
  // UI-노트고정: [고정]/[고정 풀기] in the note's ⋯. The list puts pinned notes on top.
  async function pin(target = selected) {
    if (!target || editing || busy || filesGoing(target.id)) return;
    const note = target, pinned = !notePinnedAt(note), run = ++epoch, owner = scope(); lock(true); report('');
    try {
      const saved = await setNotePinned(note, pinned, rt);
      if (run !== epoch || owner !== scope()) return;
      notes = notes.map(n => n.id === note.id ? {...n, metadata:saved.metadata, updated_at:saved.updated_at} : n);
      if (selected?.id === note.id) selected = notes.find(n => n.id === note.id) || selected;
      renderList(); if (selected) paintRead();
      showToast(pinned ? '노트를 맨 위에 고정했어요.' : '고정을 풀었어요.');
    } catch (error) {
      if (run !== epoch || owner !== scope()) return;
      report(error?.code === 'note_changed' ? error.message : pinned ? '고정하지 못했어요. 다시 시도해 주세요.' : '고정을 풀지 못했어요. 다시 시도해 주세요.');
    } finally { if (run === epoch) lock(false); else busy = false; }
  }
  // NOTE-링크원문: ⋯ [원문 가져오기] — 노트 위 [가져오기]와 같은 한 길(note-import.js importIntoNote). 끝·실패는 공용 작은 알림과 원문 칸.
  async function importLink(note) {
    const owner = scope(), id = note.id;
    try {
      const saved = await importIntoNote(note, {rt});
      if (owner !== scope()) return;
      if (!saved) { say('가져오지 못했어요. 다시 눌러 주세요.'); return; }
      if (saved?.metadata) applySaved(id, saved);
      if (selected?.id === id && !editing) paintRead();
    } catch { if (owner === scope()) say('가져오지 못했어요. 다시 눌러 주세요.'); }
  }
  // ---- NOTE-탐색기: 폴더 옮기기·새 폴더·이름·지우기·선택 모드·끌어 놓기 ----
  const applySaved = (id, saved) => {
    notes = notes.map(n => n.id === id ? {...n, metadata:saved.metadata, updated_at:saved.updated_at} : n);
    if (selected?.id === id) selected = notes.find(n => n.id === id) || selected;
  };
  // NOTE-주소로 가져오기: 뒤에서 도는 가져오기(note-import.js)가 알리면 그 노트 한 줄만 서버에서 다시 읽어 맞춘다(목록 전체를 다시 읽지 않는다).
  // 새로 만든 노트는 목록에 올리고, 열려 있는 노트면 읽기 화면을 다시 그린다(수정 중이면 건드리지 않는다). 아직 목록을 읽지 않은 화면은 열 때 읽는다.
  async function syncImported(id, phase) {
    if (!loaded || !id) return;
    const owner = scope(), repaint = () => { if (selected?.id === id) { if (!editing) { paintRead(); paintMeta(); } } else if (!selected) renderList(); };
    if (phase === 'start' || phase === 'queued') { repaint(); return; }
    let row = null;
    try { row = await readNoteDoc(id, rt); } catch { repaint(); return; }
    if (owner !== scope() || !loaded) return;
    if (row) notes = notes.some(n => n.id === id) ? notes.map(n => n.id === id ? {...n, ...row} : n) : [row, ...notes];
    if (selected?.id === id) selected = notes.find(n => n.id === id) || selected;
    repaint();
  }
  window.addEventListener(NOTE_IMPORT_EVENT, e => { void syncImported(e.detail?.id, e.detail?.phase); });
  function folderSay(text) { const p = host.querySelector('[data-note-folder-status]'); p.textContent = text; p.hidden = !text; }
  const notReady = () => { folderSay(foldersMissing ? '폴더 정리는 준비 중이에요. 지금은 폴더를 볼 수만 있어요.' : '폴더 목록을 읽지 못했어요. 다시 불러온 뒤 해 주세요.'); };
  // NOTE-추가폴더표시: the folder a NEW note goes into — the entered folder (at), unless another was picked on the input's [폴더 ▾]
  // while in that folder (screen memory only).
  let addPick = null;
  const addTarget = () => {
    if (addPick && addPick.at !== at) addPick = null;
    const id = addPick ? addPick.folder : at;
    return id && folderById(id) ? id : null;
  };
  // S69-62: 폴더 고르기는 [파일] '옮길 곳' 창과 같은 창(folder-dest-sheet.js) — 나무 누르면 펼침·선택, [새 폴더](고른 폴더 안), [여기에 옮기기]로만 옮김.
  // 맨 위 줄 '노트' = 폴더 밖(OUTSIDE_NAME). 새 폴더는 노트 화면 newFolder와 같은 서버 길(createNoteFolder).
  async function newFolderIn(parentId, typed) {
    if (!canEditFolders()) throw new Error('폴더 목록을 읽지 못했어요. 다시 불러온 뒤 해 주세요.');
    if (parentId && folderPath(folders, parentId).length >= FOLDER_DEPTH_LIMIT) throw new Error(`폴더는 ${FOLDER_DEPTH_LIMIT}단까지만 만들 수 있어요.`);
    const name = cleanFolderName(typed); if (!name) throw new Error('폴더 이름은 1~40자로 써 주세요.');
    try {
      const row = await createNoteFolder({name, parent_id:parentId || null, sort_order:nextSortOrder(folderSiblings(folders, {free:true, parentId:parentId || null}))}, rt);
      folders = [...folders, row]; if (parentId) openSet.add(parentId); folderSay(''); renderList();
      return row;
    } catch (error) { throw new Error(noteFolderErrorText(error)); }
  }
  const sheet = ({anchor, title, current, blocked = null, choose = false, onGo}) => openFolderSheet({anchor, title, rootName:'노트', folders:() => folders,
    current:choose ? undefined : current, start:current, blocked, goLabel:choose ? '이 폴더로 정하기' : '여기에 옮기기',
    mkdir:canEditFolders() ? newFolderIn : null, onGo});
  function openMovePicker(anchor, items) {
    if (!canEditFolders()) { notReady(); return; }
    const places = new Set(items.notes.map(n => folderOf(n) || null)), here = !items.folders.length && places.size === 1 ? [...places][0] : undefined;
    const ok = id => items.folders.every(f => canMoveFolder(folders, f, id, FOLDER_DEPTH_LIMIT) && folderById(f)?.parent_id !== id);
    sheet({anchor, title:sheetTitle(items.notes.length + items.folders.length, '옮길 곳'), current:here,
      blocked:items.folders.length ? id => ok(id) ? '' : '자기 안이나 지금 자리로는 옮길 수 없어요' : null,
      onGo:id => moveItems(items, id)});
  }
  // 입력 줄·크게 쓰기 창의 [폴더 ▾]: 새 노트가 들어갈 폴더를 정한다(옮기지 않음).
  function openAddPicker(trigger) {
    if (!foldersReady) { addPick = null; quick.setFolder(null); notReady(); return; }
    sheet({anchor:trigger, title:'노트를 넣을 폴더', current:addTarget(), choose:true, onGo:id => { addPick = {at, folder:id}; quick.setFolder(folderName(addTarget())); bigWriter?.paint?.(); }});
  }
  // NOTE-폴더메뉴새노트: 폴더 ⋯ [새 노트] = 입력 줄 [폴더 ▾]에서 그 폴더를 고른 것과 같게 한 뒤, 입력 줄의 [크게]로 기존 새 노트 창을 연다
  // (쓰던 글·파일도 그대로 넘어감). 저장은 noteAdded → addTarget 그대로 — 새 저장 길 없음.
  function newNoteIn(id) {
    if (!id || !folderById(id)) return;
    addPick = {at, folder:id}; quick.setFolder(folderName(addTarget())); bigWriter?.paint?.();
    host.querySelector('[data-note-list] [data-quick-big]')?.click();
  }
  // The big edit window's [폴더 ▾]: the same folder sheet; the window writes the change after its text save (moveFromWindow).
  function windowFolderPick(initial) {
    let value = initial, watchers = [];
    return {get:() => value, label:() => folderName(value) || OUTSIDE_NAME, watch:fn => watchers.push(fn), close:() => { if (folderSheetOpen()) closeFolderSheet(); },
      open:trigger => { if (!canEditFolders()) { notReady(); return; }
        sheet({anchor:trigger, title:'노트를 넣을 폴더', current:value || null, choose:true, onGo:id => { value = id; watchers.forEach(fn => fn()); }}); }};
  }
  // Notes written before the folder table (no metadata.folder_id) sit in the top folder of the same name. Before that folder is
  // renamed, moved or deleted they get its id, so they stay with it.
  async function adopt(folderId) {
    const f = folderById(folderId); if (!f) return;
    for (const n of notes.filter(x => folderOf(x) === folderId && !(x.metadata && typeof x.metadata.folder_id === 'string'))) {
      applySaved(n.id, await setNoteFolderRef(n, f, rt));
    }
  }
  // Moves notes and folders; one notice with [되돌리기] (Ctrl+Z too, small-notice.js) puts each back where it was.
  async function moveItems(items, targetId, {silent = false} = {}) {
    if (busy || !canEditFolders()) return;
    const target = targetId ? folderById(targetId) : null; if (targetId && !target) return;
    const owner = scope(), run = ++epoch, done = {notes:[], folders:[]}, total = items.notes.length + items.folders.length;
    let failed = 0; busy = true; paintSelectBar();
    try {
      for (const id of items.folders) {
        const f = folderById(id); if (!f || f.parent_id === targetId || !canMoveFolder(folders, id, targetId, FOLDER_DEPTH_LIMIT)) { if (f && f.parent_id !== targetId) failed++; continue; }
        try { if (!f.parent_id) await adopt(id); const row = await updateNoteFolder(id, {parent_id:targetId, sort_order:nextSortOrder(folderSiblings(folders, {free:true, parentId:targetId}))}, rt);
          if (owner !== scope()) return; folders = folders.map(x => x.id === id ? {...x, ...row} : x); done.folders.push({id, from:f.parent_id || null, order:f.sort_order}); if (targetId) openSet.add(targetId); }
        catch (error) { failed++; folderSay(noteFolderErrorText(error)); }
        if (total > 2) folderSay(`옮기는 중 ${done.notes.length + done.folders.length}/${total}`);
      }
      for (const id of items.notes) {
        const note = notes.find(n => n.id === id); if (!note) continue;
        const from = folderOf(note); if (from === targetId) continue;
        try { const saved = await setNoteFolderRef(note, target, rt); if (owner !== scope()) return; applySaved(id, saved); done.notes.push({id, from}); }
        catch { failed++; }
        if (total > 2) folderSay(`옮기는 중 ${done.notes.length + done.folders.length}/${total}`);
      }
    } finally { busy = false; }
    if (run === epoch) folderSay(failed ? `${failed}개는 옮기지 못했어요. 다시 해 주세요.` : '');
    if (pick.active) { if (failed) pick.items = new Set([...pick.items].filter(k => !done.notes.some(d => 'n:' + d.id === k) && !done.folders.some(d => 'f:' + d.id === k))); else pick.items = null; }
    renderList(); if (selected) paintMeta();
    const count = done.notes.length + done.folders.length;
    if (!count || silent) return;
    const where = target ? `${target.name} 폴더` : OUTSIDE_NAME;
    flash(done);
    notify(`옮겼어요 ${count}개 → ${where}`, {label:`폴더 옮기기 ${count}개`, undo:async () => {
      for (const d of done.notes) { const note = notes.find(n => n.id === d.id); if (note) applySaved(d.id, await setNoteFolderRef(note, d.from ? folderById(d.from) : null, rt)); }
      for (const d of done.folders) { const row = await updateNoteFolder(d.id, {parent_id:d.from, sort_order:d.order}, rt); folders = folders.map(x => x.id === d.id ? {...x, ...row} : x); }
      renderList(); return true;
    }});
  }
  const flash = done => requestAnimationFrame(() => { for (const d of done.notes) host.querySelector(`[data-nx-note="${CSS.escape(d.id)}"]`)?.classList.add('nx-flash'); for (const d of done.folders) host.querySelector(`[data-nx-folder="${CSS.escape(d.id)}"]`)?.classList.add('nx-flash'); });
  // S48-28: 폴더 이름은 공용 작은 글 입력창으로 묻는다(누른 곳 근처). 취소 = null.
  const askName = async (text, value = '', anchor = null) => { const typed = await askText(anchor?.isConnected && anchor.getClientRects().length ? anchor : document.activeElement, {text:`${text} (40자까지)`, value, max:40}); if (typed === null) return null; const name = cleanFolderName(typed); if (!name) { folderSay('폴더 이름은 1~40자로 써 주세요.'); return null; } return name; };
  async function newFolder(parentId, {quiet = false, anchor = null} = {}) {
    if (!canEditFolders()) { notReady(); return null; }
    if (parentId && folderPath(folders, parentId).length >= FOLDER_DEPTH_LIMIT) { folderSay(`폴더는 ${FOLDER_DEPTH_LIMIT}단까지만 만들 수 있어요.`); return null; }
    const name = await askName('새 폴더 이름', '', anchor); if (!name || !canEditFolders()) return null;
    try {
      const row = await createNoteFolder({name, parent_id:parentId || null, sort_order:nextSortOrder(folderSiblings(folders, {free:true, parentId:parentId || null}))}, rt);
      folders = [...folders, row]; if (parentId) openSet.add(parentId); folderSay(''); renderList();
      if (!quiet) notify(`'${name}' 폴더를 만들었어요.`);
      return row;
    } catch (error) { folderSay(noteFolderErrorText(error)); return null; }
  }
  async function renameFolder(id) {
    const f = folderById(id); if (!f || busy || !canEditFolders()) return;
    const name = await askName('폴더 이름 바꾸기', f.name); if (!name || name === f.name || busy || !folderById(id)) return;
    busy = true;
    try { if (!f.parent_id) await adopt(id); const row = await updateNoteFolder(id, {name}, rt); folders = folders.map(x => x.id === id ? {...x, ...row} : x); folderSay('');
      notify(`폴더 이름을 '${name}'(으)로 바꿨어요.`, {label:'폴더 이름 바꾸기', undo:async () => { const back = await updateNoteFolder(id, {name:f.name}, rt); folders = folders.map(x => x.id === id ? {...x, ...back} : x); renderList(); return true; }}); }
    catch (error) { folderSay(noteFolderErrorText(error)); }
    finally { busy = false; renderList(); }
  }
  // 폴더 지우기: 안의 노트는 한 단 위로(맨 위였으면 폴더 밖), 안의 폴더는 DB가 한 단 위로. [되돌리기]는 같은 id로 다시 만들어 되돌린다.
  async function deleteFolder(id, trigger) {
    const f = folderById(id); if (!f || busy || !canEditFolders()) return;
    const inside = notes.filter(n => folderOf(n) === id), kids = folders.filter(x => x.parent_id === id);
    const up = f.parent_id ? folderById(f.parent_id) : null;
    if (!await askConfirm(trigger, {text:`'${f.name}' 폴더를 삭제할까요?`, note:`노트 ${inside.length}개·폴더 ${kids.length}개는 ${up ? `'${up.name}'` : `'${OUTSIDE_NAME}'`}으로 가요. 노트는 삭제하지 않아요.`, ok:'삭제', danger:true})) return;
    busy = true; const moved = [];
    try {
      for (const n of inside) { applySaved(n.id, await setNoteFolderRef(n, up, rt)); moved.push(n.id); }
      await deleteNoteFolder(id, rt);
      folders = folders.filter(x => x.id !== id).map(x => x.parent_id === id ? {...x, parent_id:f.parent_id || null} : x);
      // 들어가 있던 폴더를 지웠으면 위 폴더로(enter: 주소 ?folder=도 함께 바뀌어 새로고침해도 없는 폴더를 찾지 않는다).
      if (at === id) enter(f.parent_id || null, {focus:false});
      folderSay('');
      notify(`'${f.name}' 폴더를 삭제했어요.`, {label:'폴더 삭제', undo:async () => {
        const row = await createNoteFolder({id, name:f.name, parent_id:f.parent_id || null, sort_order:f.sort_order}, rt); folders = [...folders, row];
        for (const k of kids) { const back = await updateNoteFolder(k.id, {parent_id:id}, rt); folders = folders.map(x => x.id === k.id ? {...x, ...back} : x); }
        for (const nid of moved) { const note = notes.find(n => n.id === nid); if (note) applySaved(nid, await setNoteFolderRef(note, row, rt)); }
        renderList(); return true;
      }});
    } catch (error) { folderSay(moved.length ? `노트 ${moved.length}개는 옮겼지만 폴더를 삭제하지 못했어요. 다시 해 주세요.` : noteFolderErrorText(error)); }
    finally { busy = false; renderList(); }
  }
  // A new note written while a folder is entered (or picked on [폴더 ▾]) goes into it (one more metadata write after the save).
  async function putNewNote(saved, into, owner, open = true) {
    busy = true;
    try { await setNoteFolderRef(saved, folderById(into), rt); }
    catch { if (owner === scope()) folderSay(`노트는 저장했지만 '${folderName(into) || ''}' 폴더에 넣지 못했어요. 노트 ⋯의 [폴더로 옮기기]로 옮겨 주세요.`); }
    finally { busy = false; }
    if (owner !== scope()) return;
    if (open) pendingOpen = saved.id;
    void refresh();
  }
  // ---- 선택 모드: [선택]으로 켜고(그 줄이 골라짐), 줄을 누르면 고르기·풀기, Esc·뒤로가기·✕로 끝. ----
  function startSelect(key) {
    pick.start(key ? [key] : [], key || null);
    renderList();
  }
  function endSelect({fromBack = false} = {}) {
    if (pick.stop({fromBack})) renderList();
  }
  const togglePick = key => { if (!pick.active) return; pick.toggle([key]); renderList(); };
  const pickedItems = () => ({notes:[...(pick.items || [])].filter(k => k.startsWith('n:')).map(k => k.slice(2)), folders:[...(pick.items || [])].filter(k => k.startsWith('f:')).map(k => k.slice(2))});
  function selectAll() {
    if (!pick.active) return;
    const keys = [...host.querySelectorAll('[data-nx-recent] [data-nx-note], #noteRows [data-nx-note], #noteRows [data-nx-folder]')].map(el => el.dataset.nxNote ? 'n:' + el.dataset.nxNote : 'f:' + el.dataset.nxFolder);
    pick.toggle(keys, {anchor:false});
    renderList();
  }
  async function deletePicked(trigger) {
    const items = pickedItems(); if (!items.notes.length && !items.folders.length) return;
    if (items.folders.length) { folderSay('폴더는 폴더 ⋯의 [폴더 삭제]로 하나씩 삭제해 주세요. 노트만 함께 삭제할 수 있어요.'); return; }
    if (!await askConfirm(trigger, {text:`노트 ${items.notes.length}개를 삭제할까요?`, note:'휴지통으로 가요. 첨부 파일은 Drive에 그대로 남아요.', ok:'삭제', danger:true})) return;
    let ok = 0;
    for (const id of items.notes) {
      let result; busy = true;
      const alive = () => true;
      try { result = await deleteNoteOriginal(id, {rt, trash:true, confirmed:true, isCurrent:alive}); } catch { result = {status:'unknown'}; } finally { busy = false; }
      if (['deleted', 'missing'].includes(result?.status)) { ok++; notes = notes.filter(n => n.id !== id); links = links.filter(l => l.note_id !== id); pick.remove('n:' + id); }
      if (result?.status === 'cancelled') break;
    }
    if (pick.active && !pick.size) endSelect(); else renderList();
    if (ok) loadTrash();
    notify(ok === items.notes.length ? `노트 ${ok}개를 삭제했어요.` : `노트 ${ok}개를 삭제했고 ${items.notes.length - ok}개는 삭제하지 못했어요.`);
  }
  // ---- 끌어 놓기·순서 바꾸기 (S49-38 FOLDER-순서·색 ②, 공용 끌기 부품 reorder-drag.js의 zones 모드) ----
  // 줄 높이 위 25% = 이 줄 앞에 놓기 / 가운데 50% = 이 폴더 안으로 넣기 / 아래 25% = 뒤에 놓기. 선(순서)과 바탕(넣기)은 동시에 나오지 않는다.
  // 폴더를 폴더 줄 위·아래에 놓으면 그 줄의 형제로 순서를 바꾸고(상위가 다르면 상위도 바뀜), 노트는 '내가 정한 순서'일 때만 노트 줄 위·아래에서 순서를 바꾼다.
  // 노트를 폴더 줄에 놓으면 어느 자리여도 그 폴더로 옮긴다(지금과 같음). 고른 것을 끌면 고른 것 모두 옮긴다. 폰은 줄을 꾹 눌러 끌고, 끌지 않고 떼면 ⋯ 메뉴.
  const keyEls = key => key === 'o' ? [...host.querySelectorAll('[data-nx-outside]')]
    : [...host.querySelectorAll(key.startsWith('f:') ? `[data-nx-folder="${CSS.escape(key.slice(2))}"]` : `[data-nx-note="${CSS.escape(key.slice(2))}"]`)];
  const dragItems = key => {
    if (pick.has(key) && pick.size > 1) return pickedItems();
    return key.startsWith('n:') ? {notes:[key.slice(2)], folders:[]} : {notes:[], folders:[key.slice(2)]};
  };
  // 놓을 자리 판정(보이기와 놓기가 같은 함수): {kind:'move'|'reorder-folder'|'reorder-note'|'hint', mark:{keys, inside|line}} 또는 null(놓을 수 없음).
  function dropPlan(dragKey, overKey, zone) {
    const items = dragItems(dragKey), onlyFolder = items.folders.length === 1 && !items.notes.length, onlyNote = items.notes.length === 1 && !items.folders.length;
    if (overKey === 'o') return {kind:'move', target:null, items, mark:{keys:['o'], inside:true}};
    if (overKey.startsWith('f:')) {
      const target = folderById(overKey.slice(2)); if (!target) return null;
      if (zone !== 'inside' && onlyFolder) {
        // LIB-폴더끌어순서(S61-14): 앞·뒤 끼우기 판정은 자료실과 같은 공용 규칙(folder-look-model.mjs folderDropPlan).
        const f = folderById(items.folders[0]); if (!f) return null;
        const p = folderDropPlan({dragId:f.id, targetId:target.id, dragParent:f.parent_id, targetParent:target.parent_id, zone,
          canPlaceIn:parent => canMoveFolder(folders, f.id, parent, FOLDER_DEPTH_LIMIT)});
        if (!p) return null;
        return {kind:'reorder-folder', id:f.id, parent:p.parent, over:p.over, after:p.after, mark:{keys:[overKey], line:p.line}};
      }
      if (items.folders.some(id => !canMoveFolder(folders, id, target.id, FOLDER_DEPTH_LIMIT) || folderById(id)?.parent_id === target.id) && !items.notes.length) return null;
      return {kind:'move', target:target.id, items, mark:{keys:[overKey], inside:true}};
    }
    const over = notes.find(n => n.id === overKey.slice(2)); if (!over) return null;
    const folderId = folderOf(over), here = folderId === null ? 'o' : 'f:' + folderId;
    const mine = onlyNote ? notes.find(n => n.id === items.notes[0]) : null;
    if (mine && folderOf(mine) === folderId) {
      if (noteSort === 'manual' && !notePinnedAt(mine) && !notePinnedAt(over)) return {kind:'reorder-note', id:mine.id, folder:folderId, over:over.id, after:zone === 'after', mark:{keys:[overKey], line:zone}};
      return {kind:'hint', mark:{keys:[]}}; // 같은 폴더 안: 순서는 '내가 정한 순서'에서만
    }
    return {kind:'move', target:folderId, items, mark:{keys:[here], inside:true}};
  }
  const resolveOver = (dragKey, overKey) => {
    if (overKey === 'o') return {ok:true, canInside:true};
    if (keyEls(overKey).some(el => el.hasAttribute('data-nx-recent-row'))) return {ok:false}; // '최근' 줄은 폴더가 섞여 있어 놓을 곳이 아니다
    const items = dragItems(dragKey);
    if (overKey.startsWith('f:')) return {ok:!items.folders.includes(overKey.slice(2)), canInside:true};
    return {ok:!items.notes.includes(overKey.slice(2)), canInside:false};
  };
  let hoverTimer = null, hoverId = null, dragPointer = '', suppressUntil = 0, dragging = false;
  const clearDrop = () => host.querySelectorAll('.nx-drop,.nx-line-before,.nx-line-after,.nx-drop-group').forEach(el => el.classList.remove('nx-drop', 'nx-line-before', 'nx-line-after', 'nx-drop-group'));
  function hoverOpen(target) {
    if (target === hoverId) return; clearTimeout(hoverTimer); hoverId = target;
    // PC 마우스: 끄는 동안 닫힌 왼쪽 나무 폴더 위에 머물면 열림(폰 손가락 끌기는 목록을 다시 그리면 잡은 줄이 사라져 열지 않는다)
    if (target && dragPointer !== 'touch' && !openSet.has(target) && wideList.matches) hoverTimer = setTimeout(() => { if (dragging && hoverId === target) { openSet.add(target); renderList(); } }, 900);
  }
  function showHover(info) {
    clearDrop();
    // 끄는 중 = 공용 끌기 부품이 붙이는 re-active(시작에 붙고 끝에 먼저 떼어짐) — 빈 틈 위에서 놓을 곳이 없을 때도 끄는 중이다.
    const on = host.classList.contains('re-active'); if (on !== selDragging) { selDragging = on; paintSelectBar(); }
    if (!info) { dragging = false; hoverOpen(null); return; }
    dragging = true;
    const plan = dropPlan(info.id, info.over, info.zone);
    hoverOpen(plan?.kind === 'move' ? plan.target : null);
    if (!plan) return;
    const cls = plan.mark.inside ? 'nx-drop' : plan.mark.line === 'before' ? 'nx-line-before' : plan.mark.line === 'after' ? 'nx-line-after' : '';
    if (cls) for (const key of plan.mark.keys) keyEls(key).forEach(el => el.classList.add(cls));
    // UI-펼친폴더안놓기전체(S60-13): 폴더로 넣을 때는 그 폴더 안 노트 줄(묶음)도 옅은 바탕 — 자료실·[파일]과 같은 표시. 판정(dropPlan)은 그대로.
    if (plan.kind === 'move' && plan.mark.inside) for (const n of notes) if ((folderOf(n) ?? null) === (plan.target ?? null)) keyEls('n:' + n.id).forEach(el => el.classList.add('nx-drop-group'));
  }
  const reorderHint = () => notify('노트 순서를 바꾸려면 목록 ⋯ 메뉴에서 정렬을 [내가 정한 순서]로 바꿔 주세요.');
  function handleDrop({id, over, zone}) {
    suppressUntil = Date.now() + 600;
    const plan = dropPlan(id, over, zone); if (!plan) return;
    if (plan.kind === 'move') void moveItems(plan.items, plan.target);
    else if (plan.kind === 'reorder-folder') void reorderFolder(plan);
    else if (plan.kind === 'reorder-note') void reorderNote(plan);
    else if (plan.kind === 'hint') reorderHint();
  }
  // S69 LONGPRESS-선택(2026-11-24 명진): 폰에서 줄을 꾹 눌렀다 움직이지 않고 떼면 선택 모드를 켜고 그 줄을 고른다
  // (이미 선택 모드면 더하기, 풀지 않음 — 공용 규칙 select-mode.js holdPick). 메뉴는 줄 오른쪽 ⋯로만. 움직이면 끌기(끌 수 있는 보기에서).
  const holdKey = key => key.startsWith('n:') || key.startsWith('f:');
  function handleHold(row) {
    suppressUntil = Date.now() + 600;
    const key = row.dataset.reorderId || '';
    if (!holdKey(key) || busy) return;
    if (menu) closeMenu();
    pick.hold([key]);
    renderList();
  }
  const pageScroller = {getBoundingClientRect: () => ({top:0, bottom:window.innerHeight}), scrollBy: (x, y) => window.scrollBy(x, y)};
  host.addEventListener('pointerdown', e => { dragPointer = e.pointerType || ''; }, true);
  // S69-27 끄는 모습 보이기: 끄는 줄의 반투명 조각이 마우스·손가락을 따라온다(제목 한 줄, 여러 개 골랐으면 '노트 3개'). 공용 drag-ghost.js.
  const dragLabel = key => {
    const items = dragItems(key), many = ghostCountText(items.notes.length, items.folders.length);
    if (many) return many;
    if (items.folders.length) return folderName(items.folders[0]) || '폴더';
    const note = notes.find(n => n.id === items.notes[0]);
    return note ? ghostText(pinLock.noteHidden(note) ? LOCKED : noteLineTitle(note)) : '';
  };
  mountReorder(host, {whole:true, altStep:true, onStep:(key, dir) => stepKey(key, dir), zones:{resolve:resolveOver}, onHover:showHover, onDrop:handleDrop, onHold:handleHold, scroller:() => pageScroller, ghost:(el, key) => dragLabel(key),
    canDrag:key => (key.startsWith('n:') || key.startsWith('f:')) && canReorder() && !busy, canHold:key => holdKey(key) && !busy});
  host.addEventListener('contextmenu', e => { if (Date.now() < suppressUntil) e.preventDefault(); }, true);
  host.addEventListener('click', e => { if (Date.now() < suppressUntil && e.target.closest?.('[data-nx-note],[data-nx-folder]') && !e.target.closest('.basket-row-more,.nx-more')) { e.preventDefault(); e.stopPropagation(); } }, true);
  // ---- 순서 쓰기: 폴더(sort_order)·노트(metadata.order). 바꾼 줄만 저장하고, 실패하면 서버에서 다시 읽는다. 알림의 [되돌리기]가 이전 값으로 돌린다. ----
  const folderSibs = parent => folderSiblings(folders, {free:true, parentId:parent || null});
  async function applyFolderOrder(id, parent, changes) {
    if (busy || !canEditFolders() || !changes.length) return;
    const f = folderById(id); if (!f) return;
    const owner = scope(), before = changes.map(c => { const x = folderById(c.id); return {id:c.id, parent_id:x?.parent_id || null, sort_order:x?.sort_order}; });
    busy = true; paintSelectBar();
    try {
      if (!f.parent_id) await adopt(id);
      for (const c of changes) {
        const row = await updateNoteFolder(c.id, c.id === id ? {parent_id:parent || null, sort_order:c.order} : {sort_order:c.order}, rt);
        if (owner !== scope()) return; folders = folders.map(x => x.id === c.id ? {...x, ...row} : x);
      }
      if (parent) openSet.add(parent);
    } catch (error) { folderSay(noteFolderErrorText(error)); busy = false; renderList(); void refresh(); return; }
    finally { busy = false; }
    folderSay(''); renderList(); flash({notes:[], folders:[{id}]});
    notify('폴더 순서를 바꿨어요.', {label:'폴더 순서 바꾸기', undo:async () => {
      for (const d of before) { const row = await updateNoteFolder(d.id, {parent_id:d.parent_id, sort_order:d.sort_order}, rt); folders = folders.map(x => x.id === d.id ? {...x, ...row} : x); }
      renderList(); return true;
    }});
  }
  async function reorderFolder({id, parent, over, after}) {
    const sibs = folderSibs(parent), others = sibs.filter(x => x.id !== id), at = others.findIndex(x => x.id === over) + (after ? 1 : 0);
    const f = folderById(id); if (!f) return;
    if ((f.parent_id || null) === (parent || null) && isSamePlace(sibs, id, at)) return;
    const changes = placeAt(sibs, id, at);
    // 상위가 달라지고 순서 값이 이미 맞아도 옮기는 폴더 줄은 항상 쓴다(placeAt이 옮기는 줄을 포함).
    await applyFolderOrder(id, parent, changes);
  }
  async function stepFolder(id, dir) {
    const f = folderById(id); if (!f) return;
    const changes = stepPlan(folderSibs(f.parent_id), id, dir);
    await applyFolderOrder(id, f.parent_id || null, changes);
  }
  // 노트: 한 폴더 안(고정 노트 제외)에서 보이는 순서
  const manualList = folderId => sortNotesManual(notes.filter(n => folderOf(n) === folderId && !notePinnedAt(n)), notePinnedAt);
  async function applyNoteOrder(changes) {
    if (busy || !changes.length) return;
    const owner = scope(), before = changes.map(c => ({id:c.id, order:noteOrderOf(notes.find(n => n.id === c.id))}));
    busy = true; paintSelectBar(); let failed = 0;
    try {
      for (const c of changes) {
        const note = notes.find(n => n.id === c.id); if (!note) continue;
        try { const saved = await setNoteOrder(note, c.order, rt); if (owner !== scope()) return; applySaved(c.id, saved); } catch { failed++; }
      }
    } finally { busy = false; }
    if (failed) { folderSay('순서를 저장하지 못한 노트가 있어요. 다시 불러올게요.'); renderList(); void refresh(); return; }
    folderSay(''); renderList(); flash({notes:[{id:changes[0].id}], folders:[]});
    notify('노트 순서를 바꿨어요.', {label:'노트 순서 바꾸기', undo:async () => {
      for (const d of before) { const note = notes.find(n => n.id === d.id); if (note) applySaved(d.id, await setNoteOrder(note, d.order, rt)); }
      renderList(); return true;
    }});
  }
  async function reorderNote({id, folder, over, after}) {
    const list = manualList(folder), others = list.filter(n => n.id !== id), at = others.findIndex(n => n.id === over) + (after ? 1 : 0);
    if (isSamePlace(list, id, at)) return;
    await applyNoteOrder(placeAt(list, id, at, noteOrderOf));
  }
  async function stepNote(id, dir) {
    const note = notes.find(n => n.id === id); if (!note) return;
    await applyNoteOrder(stepPlan(manualList(folderOf(note)), id, dir, noteOrderOf));
  }
  // S70-04 UI-순서는끌기로: 키보드 Alt+↑↓(공용 끌기 부품 altStep) = 끌어서 한 칸 옮긴 것과 같다. 폴더는 형제 안 자리,
  // 노트는 '내가 정한 순서'이고 고정이 아닌 노트만(끌기와 같은 조건 — 아니면 끌기와 같은 안내).
  // 다시 그린 뒤에도 초점은 옮긴 줄(같은 칸: 왼쪽 나무 / 오른쪽 목록)에 남아 Alt+↑↓를 이어 누를 수 있다.
  function stepKey(key, dir) {
    if (busy) return;
    const inTree = !!document.activeElement?.closest?.('[data-nx-tree]');
    const refocus = () => {
      const row = keyEls(key).find(el => !!el.closest('[data-nx-tree]') === inTree) || keyEls(key)[0];
      const main = row && [...row.querySelectorAll('button,[tabindex]')].find(b => !b.closest('.basket-row-more,.nx-more'));
      (main || row)?.focus?.({preventScroll:true});
    };
    if (key.startsWith('f:')) { const id = key.slice(2); if (folderById(id) && canEditFolders()) void stepFolder(id, dir).then(refocus); return; }
    if (!key.startsWith('n:')) return;
    const note = notes.find(n => n.id === key.slice(2)); if (!note || view !== 'folder' || query || notePinnedAt(note)) return;
    if (noteSort !== 'manual') { reorderHint(); return; }
    void stepNote(note.id, dir).then(refocus);
  }
  // ---- 폴더 색 (1~8, 기본 = null): 바로 저장, 실패하면 되돌리고 알린다. 같은 폴더를 보이는 곳(나무·꼬리표·포스트잇·고르기 창)이 모두 이 값 하나를 읽는다. ----
  async function applyFolderColor(id, color) {
    const f = folderById(id); if (!f || !canEditFolders() || (colorOf(f) ?? null) === color) return;
    const owner = scope(), was = colorOf(f);
    const paint = value => { folders = folders.map(x => x.id === id ? {...x, color:value} : x); renderList(); };
    paint(color);
    try { await setNoteFolderColor(id, color, rt); }
    catch { if (owner === scope()) { paint(was); notify('폴더 색을 저장하지 못했어요. 잠시 뒤 다시 해 주세요.'); } }
  }
  function setNoteSort(next) {
    if (!isNoteSort(next) || next === noteSort) return;
    noteSort = next; viewPrefs.set('note_sort', next, {rejectable:true}); renderList();
    notify(next === 'manual' ? '노트를 끌어서 순서를 바꿀 수 있어요.' : '노트를 수정한 날 순서로 보여요.');
  }
  // A row's ⋯ (pressed, right-clicked or long-pressed): in select mode a picked row's menu is for all picked ones.
  function rowMenu(b) {
    if (busy || (selected && (!splitOpen() || editing))) return; // 두 칸에서 노트를 읽을 때도 왼쪽 나무 줄 메뉴가 열린다(고칠 때는 아님)
    const noteId = b.dataset.noteRowMore, folderId = b.dataset.nxFolderMore;
    const key = noteId ? 'n:' + noteId : 'f:' + folderId;
    if (pick.active && folderId === OUTSIDE) return;
    if (pick.active) { if (!pick.has(key)) { pick.add(key); renderList(); b = host.querySelector(noteId ? `[data-note-row-more="${CSS.escape(noteId)}"]` : `[data-nx-folder-more="${CSS.escape(folderId)}"]`) || b; } openMenu(b, null, 'picked'); return; }
    if (noteId) openMenu(b, notes.find(n => n.id === noteId), 'list');
    else openMenu(b, null, 'folder', null, folderId);
  }
  async function toBasket() {
    if (!selected || editing || busy || filesGoing(selected.id)) return;
    if (!await askConfirm(host.querySelector('[data-note-to-basket]') || document.activeElement, {text:'이 노트를 잊지 말기 업데이트로 돌릴까요?', note:'제목은 삭제되고 본문·첨부·연결은 그대로 남아요.', ok:'돌리기'})) return;
    if (!selected || editing || busy) return;
    const note = selected, run = ++epoch, owner = scope(); lock(true); say('');
    try {
      await moveToBasket(note, rt);
      if (run !== epoch || owner !== scope()) return;
      notes = notes.filter(n => n.id !== note.id); links = links.filter(l => l.note_id !== note.id);
      busy = false; close({force:true, focus:false}); status.textContent = '잊지 말기로 돌렸어요.'; onMovedToBasket(note.id);
    } catch (error) {
      if (run !== epoch || owner !== scope()) return;
      say(/잊지 말기/.test(error?.message || '') ? error.message : '잊지 말기로 돌리지 못했어요. 다시 시도해 주세요.');
    } finally { if (run === epoch && selected) lock(false); else busy = false; }
  }
  // S48-56 [일기로 보내기]: 날짜를 묻고(기본 = 노트를 만든 날) 그날 일기에 글·사진을 더한 뒤 노트는 휴지통(알림의 [되돌리기]). diary-send.js 한 곳.
  async function toDiary(id, anchor) {
    if (!id || editing || busy || filesGoing(id)) return;
    const fromList = !selected, run = ++epoch, owner = scope(); lock(true); report('');
    const current = () => run === epoch && owner === scope() && (fromList ? !selected : selected?.id === id);
    let result;
    try { const {askSendToDiary} = await import('./diary-send.js'); result = await askSendToDiary(anchor?.isConnected ? anchor : document.activeElement, id, {rt, isCurrent:current}); }
    catch { result = {status:'failed'}; }
    finally { busy = false; }
    if (!current()) return;
    if (result.status === 'sent' && result.trash === 'deleted') {
      notes = notes.filter(n => n.id !== id); links = links.filter(l => l.note_id !== id);
      if (fromList) renderList(); else close({force:true});
      return;
    }
    lock(false);
  }
  // [삭제] from the open note or from a list row: the same confirmation (what goes with it) and the same delete path.
  async function remove(id = selected?.id, {confirmed = false} = {}) {
    if (!id || editing || busy || filesGoing(id)) return;
    // S69-27: 두 칸에서는 노트를 연 채 왼쪽 나무의 다른 노트를 지울 수 있다(그때도 '목록에서 지움').
    const fromList = selected?.id !== id, run = ++epoch, owner = scope(); lock(true); report('');
    const current = () => run === epoch && owner === scope() && window.KPTURouter.current === 'basket' && (fromList ? selected?.id !== id : selected?.id === id);
    let result;
    // NOTE-파일붙이기 (2026-10-22 사용자 결정): deleting a note removes it and its links; its files stay in Drive.
    try { result = await deleteNoteOriginal(id, {rt, isCurrent:current, trash:true, confirmed}); }
    catch { result = {status:'unknown', message:'결과를 확인하지 못했어요. [노트 최신화]로 실제 상태를 확인해 주세요.'}; }
    finally { busy = false; }
    if (!current() || result.status === 'stale') return;
    if (['deleted', 'missing'].includes(result.status)) {
      notes = notes.filter(n => n.id !== id); links = links.filter(l => l.note_id !== id);
      loadTrash(); // 나무 맨 아래 '휴지통 N'
      const message = String(result.message || '').replace('업데이트', '노트');
      if (fromList) { renderList(); if (message) status.textContent = message; host.querySelector('[data-note-search]')?.focus({preventScroll:true}); return; }
      close({force:true}); if (message) status.textContent = message;
      return;
    }
    lock(false);
    if (result.status === 'cancelled') { (fromList ? host.querySelector(`[data-note-row-more="${CSS.escape(id)}"]`) : detail.querySelector('[data-note-more]'))?.focus(); return; }
    report(result.message);
    if (result.status === 'unknown' && !fromList) detail.querySelector('[data-note-reload]').hidden = false;
  }
  async function reload() {
    if (!selected) return;
    const id = selected.id, owner = scope(), run = ++epoch;
    try { const fresh = await readNoteDocs(rt); if (run !== epoch || owner !== scope()) return; notes = fresh.notes; links = fresh.links; renderList();
      if (notes.some(n => n.id === id)) open(id); else close({force:true}); }
    catch { if (run === epoch && owner === scope()) say('노트를 다시 불러오지 못했어요. 다시 시도해 주세요.'); }
  }

  host.addEventListener('input', e => {
    if (e.target.matches('[data-note-search]')) { query = e.target.value.trim().toLowerCase(); renderList(); return; }
    // S67-48: 고치는 중 제목·본문에 #을 직접 써도 아래 태그 칩 줄이 따라온다(잠깐 쉬었다가).
    if (editing && e.target.closest?.('[data-note-editor]') && !e.target.closest('[data-note-edit-tags]')) { clearTimeout(editTagTimer); editTagTimer = setTimeout(paintEditTags, 250); }
  });
  // A menu item acts on the note the menu was openSet for (a list row's note need not be open).
  function menuAction(b, from) {
    if (from.from === 'cols') { if (b.hasAttribute('data-nl-cols-reset')) setListCols([...LIST_COLS_DEFAULT]); return; }
    if (from.from === 'picked') {
      if (b.hasAttribute('data-nx-sel-move')) openMovePicker(from.trigger, pickedItems());
      else if (b.hasAttribute('data-nx-sel-delete')) void deletePicked(from.trigger);
      else if (b.hasAttribute('data-nx-sel-close')) endSelect();
      return;
    }
    if (from.from === 'board') { if (b.hasAttribute('data-nbb-newnote')) { const input = host.querySelector('[data-note-list] textarea[data-quick-input]'); input?.scrollIntoView({block:'nearest'}); input?.focus({preventScroll:true}); } return; }
    if (from.from === 'head' && b.hasAttribute('data-nx-help')) { void import('./help-link.js').then(m => m.openHelp('note')); return; }
    if (from.from === 'folder' || from.from === 'head') {
      const id = from.from === 'folder' ? from.folderId : at === OUTSIDE ? null : at;
      if (b.hasAttribute('data-nx-lock-open')) pinLock.askNotes();
      else if (b.hasAttribute('data-nx-lock-folder')) { const f = folderById(id); if (f) pinLock.askNotes({folder:{id:f.id, name:f.name, locked:!pinLock.folderLocked(f.id)}}); }
      else if (b.hasAttribute('data-nx-select')) startSelect(from.from === 'folder' ? 'f:' + id : null);
      else if (b.hasAttribute('data-nx-new-note')) newNoteIn(id);
      else if (b.hasAttribute('data-nx-enter')) { if (from.from === 'folder' && !wideList.matches && at === null) focusFolder(from.folderId); else enter(from.from === 'folder' ? from.folderId : id); } // 폰 첫 화면 = 돌아올 나무 자리 기억(focusFolder)
      else if (b.hasAttribute('data-nx-up')) enter(folderById(at)?.parent_id || null);
      else if (b.hasAttribute('data-nx-new-in')) void newFolder(id);
      else if (b.hasAttribute('data-nx-rename')) void renameFolder(id);
      else if (b.hasAttribute('data-nx-sort')) setNoteSort(noteSort === 'manual' ? 'changed' : 'manual');
      else if (b.hasAttribute('data-nl-cols-open')) openMenu(from.trigger, null, 'cols');
      else if (b.dataset.nlSort && NOTE_LIST_SORT_KEYS.includes(b.dataset.nlSort)) setListSort(nextSort(listSort(), b.dataset.nlSort, {descFirst:LIST_SORT_DESC_FIRST}));
      else if (b.hasAttribute('data-nx-move-folder')) openMovePicker(from.trigger, {notes:[], folders:[id]});
      else if (b.hasAttribute('data-nx-delete-folder')) void deleteFolder(id, from.trigger);
      return;
    }
    const note = notes.find(n => n.id === from.noteId); if (!note) return;
    if (b.dataset.fileMenu) { const file = noteFile(note, from.fileId); if (file) { if (b.dataset.fileMenu === 'open') openInDrive(file, {onError: fileFail}); else void downloadFile(file, {onError: fileFail}); } return; }
    if (b.hasAttribute('data-note-file-rename')) { const host = detail.querySelector(`[data-note-file="${CSS.escape(from.fileId)}"] [data-fr-host]`); if (host) openRenameEditor(host); }
    else if (b.hasAttribute('data-note-file-detach')) void detachFile(note, from.fileId);
    else if (b.hasAttribute('data-note-file-delete')) void deleteFile(note, from.fileId);
    else if (b.hasAttribute('data-nbb-detach')) boards.detach(note.id);
    else if (b.hasAttribute('data-nbb-label')) void boards.relabel(note, from.trigger);
    else if (b.hasAttribute('data-nbb-autosize')) boards.autosize(note.id);
    else if (b.hasAttribute('data-nbb-attach')) boards.attach([note.id]);
    else if (b.hasAttribute('data-note-copy')) void telegram(note, from.trigger); // UI-눌림느낌: the menu is closed, so the row's ⋯ shows the ✓
    else if (b.hasAttribute('data-note-pin')) void pin(note);
    else if (b.hasAttribute('data-note-pub-make')) void pubAct('make', note, from.trigger);
    else if (b.hasAttribute('data-note-pub-copy')) void pubAct('copy', note, from.trigger);
    else if (b.hasAttribute('data-note-pub-stop')) void pubAct('stop', note, from.trigger);
    else if (b.hasAttribute('data-nx-goto-folder')) gotoFolder(note);
    else if (b.hasAttribute('data-nx-select')) startSelect('n:' + note.id);
    else if (b.hasAttribute('data-note-folder-move')) openMovePicker(from.trigger, {notes:[note.id], folders:[]});
    else if (b.hasAttribute('data-note-edit')) { if (selected?.id !== note.id) open(note.id, {focus:false}); startEdit(); }
    else if (b.hasAttribute('data-basket-link-open')) { const id = selected?.id; void manual.open('link', b).then(message => { if (selected?.id === id) say(message || ''); }); }
    else if (b.hasAttribute('data-note-to-basket')) void toBasket();
    else if (b.hasAttribute('data-note-import')) void importLink(note);
    else if (b.hasAttribute('data-note-remind-lines')) void import('./family-remind-menu.js').then(m => m.openRemindLines(from.trigger, {rt, note,
      onDone: () => { if (!editing && selected?.id === note.id) void reload(); }, onFail: text => say(text)})).catch(() => say('메뉴를 열지 못했어요.'));
    else if (b.hasAttribute('data-note-to-diary')) void toDiary(note.id, from.trigger);
    else if (b.hasAttribute('data-note-delete')) void remove(note.id);
  }
  ftBindTreeArrows(); // LIB-나무접기 ③: PC 나무 ←/→
  // NOTE-달력보기: 사업 관리 달력처럼 칸 전체가 '그날 고르기'(숫자·수·빈 곳 어디든). 숫자 단추는 아래 단추 길이 받는다.
  host.addEventListener('click', e => {
    if (view !== 'calendar' || busy || e.target.closest('button')) return;
    const cell = e.target.closest('[data-nt-cal-cell]'); if (!cell || !host.contains(cell)) return;
    closeMenu(); calDay = cell.dataset.ntCalCell; renderList();
  });
  host.addEventListener('click', e => {
    const line = e.target.closest('[data-note-file] .file-line-main'); if (line && host.contains(line)) { closeMenu(); pressNoteFile(line); return; }
    const b = e.target.closest('button'); if (!b || b.disabled || !host.contains(b)) return;
    if (b.closest('#noteDocMenu')) {
      // 폴더 ⋯ [색 고르기…]: 메뉴를 닫지 않고 같은 자리에 동그라미 8개 + [기본]을 보인다. 하나 고르면 바로 저장하고 닫는다.
      if (b.hasAttribute('data-nx-color') && menu?.from === 'folder') { showColorChoice(); return; }
      if (b.dataset.nlColToggle && menu?.from === 'cols') {
        const key = b.dataset.nlColToggle, on = listCols();
        if (NOTE_COLS.includes(key)) setListCols(on.includes(key) ? on.filter(k => k !== key) : [...on, key]);
        const el = menuEl(); el.innerHTML = menuButtonsHtml(menuItems(null, 'cols'));
        el.querySelector(`[data-nl-col-toggle="${key}"]`)?.focus({preventScroll:true});
        return;
      }
      const picked = colorFromButton(b);
      if (picked !== undefined) { const from = closeMenu({focus:true}); if (from?.folderId && !busy) void applyFolderColor(from.folderId, picked); return; }
      const from = closeMenu({focus:true}); if (from && !busy) menuAction(b, from); return;
    }
    if (b.hasAttribute('data-note-more')) { if (!busy && selected && !editing) openMenu(b, selected, 'detail'); return; }
    if (b.hasAttribute('data-note-file-more')) { if (!busy && selected) openMenu(b, selected, 'file', b.dataset.noteFileMore); return; }
    if (b.hasAttribute('data-nl-cols-menu')) { if (!busy && !selected) openMenu(b, null, 'cols'); return; }
        if (b.hasAttribute('data-note-folder-more')) { if (!busy && (!selected || splitOpen())) openMenu(b, null, pick.active ? 'picked' : 'head'); return; }
    if (b.hasAttribute('data-note-row-more') || b.hasAttribute('data-nx-folder-more')) { rowMenu(b); return; }
    closeMenu();
    if (busy) return;
    // 두 칸에서 노트를 연 채 보기를 바꾸면 노트를 먼저 닫는다(고치던 글이 있으면 묻는다).
    if (b.hasAttribute('data-note-view')) { const next = b.dataset.noteView; if (selected && next !== view) void askClose(b).then(ok => { if (ok) setView(next); }); else setView(next); return; }
    if (b.hasAttribute('data-nb-remove')) { if (!pick.active) boards.detach(b.dataset.nbRemove); return; }
    if (b.hasAttribute('data-note-row')) { if (pick.active) togglePick('n:' + b.dataset.noteRow); else void switchNote(b.dataset.noteRow, b); }
    else if (b.hasAttribute('data-nx-tog')) { const id = b.dataset.nxTog; if (openSet.has(id)) openSet.delete(id); else openSet.add(id); renderList(); host.querySelector(`[data-nx-tog="${CSS.escape(id)}"]`)?.focus({preventScroll:true}); }
    // S69-38 UI-탐색기나무누르기(명진 11/24 '상위폴더를 눌러도 오른쪽에 내용이 보이게 / 모든곳 공통 노트 자료 파일'): PC·폴드 왼쪽 나무 폴더 이름 누르기 =
    // 오른쪽을 그 폴더(하위 폴더 줄 → 그 폴더 노트)로, 접혀 있으면 펼침 — 공용 부품 ftExplorePress(자료실·[파일]·사진 나무와 같은 부품). 아이콘([data-nx-tog])은 펼치기·접기만.
    // S69-94: 폴더 목록 '밑줄' 아래 '메모' 줄 = [메모] 보기(모든 메모 모아 보기).
    else if (b.hasAttribute('data-nx-memos')) { if (splitOpen()) void askClose(b).then(ok => { if (ok) setView('comment'); }); else setView('comment'); }
    else if (b.hasAttribute('data-nx-open')) {
      const id = b.dataset.nxOpen, treeRow = wideList.matches && !pick.active && !!b.closest('[data-nx-tree] .ft-row.ft-has-tog');
      const go = () => { if (treeRow) ftExplorePress(b, () => pressEnter(id)); else pressFolder(id, e); };
      // 두 칸에서 노트를 읽는 중 다른 칸으로 가면 노트를 먼저 닫는다(고치던 글이 있으면 묻는다).
      if (splitOpen()) { void askClose(b).then(ok => { if (ok) go(); }); return; }
      go();
    } // '최근'·'폴더 없음'·선택 모드 줄은 나무 줄이 아니라 지금처럼
    // 위치 줄 맨 앞 '노트'(폰 '그 폴더만' 상자 안)는 [‹]와 같이 펼친 자리 그대로 나무로(S51-24).
    else if (b.hasAttribute('data-nx-at')) { const id = b.dataset.nxAt || null; if (id === null && !wideList.matches && at !== null) up(); else enter(id); }
    else if (b.hasAttribute('data-nx-back')) up();
    else if (b.hasAttribute('data-nx-more')) { moreSet.add(b.dataset.nxMore || OUTSIDE); renderList(); }
    else if (b.hasAttribute('data-nx-recent-more')) { recentAll = !recentAll; renderList(); }
    else if (b.hasAttribute('data-nx-recent-fold')) { toggleRecentFolded('notes'); renderList(); host.querySelector('[data-nx-recent-fold]')?.focus({preventScroll:true}); }
    else if (b.hasAttribute('data-nx-new-top')) void newFolder(null);
    else if (b.hasAttribute('data-nx-sel-move')) openMovePicker(b, pickedItems());
    else if (b.hasAttribute('data-nx-sel-delete')) void deletePicked(b);
    else if (b.hasAttribute('data-nx-sel-all')) selectAll();
    else if (b.hasAttribute('data-nx-sel-close')) endSelect();
    else if (b.hasAttribute('data-note-retry')) void refresh();
    else if (b.hasAttribute('data-note-cancel')) void finishEdit({anchor:b});
    else if (b.hasAttribute('data-note-save')) void save();
    else if (b.hasAttribute('data-note-big-write')) openBigWriter();
    else if (b.hasAttribute('data-note-telegram')) void telegram(selected, b);
    else if (b.hasAttribute('data-note-back')) void askClose(b); // UI-화면정리 C: 폰 노트 읽기·수정의 '‹ 노트'(정리함 상세의 '‹ 정리함'과 같은 모양)
    else if (b.hasAttribute('data-note-reload')) void reload();
    else if (b.hasAttribute('data-tag-add')) (editing ? editPick : readPick)?.toggle();
    else if (b.hasAttribute('data-tag-remove')) { const key = b.dataset.tagRemove; void changeTags({remove:key}).then(r => { if (!r.ok && r.message) say(r.message); (detail.querySelector(editing ? '[data-note-edit-tag-chips] [data-tag-add]' : '[data-note-meta-tags] [data-tag-add]'))?.focus({preventScroll:true}); }); }
    else if (b.hasAttribute('data-nt-tag')) { const key = b.dataset.ntTag; tagSel = tagSel.includes(key) ? tagSel.filter(k => k !== key) : [...tagSel, key]; tagTouched = true; renderList(); }
    else if (b.hasAttribute('data-nt-clear')) { tagSel = []; tagTouched = true; renderList(); }
    else if (b.hasAttribute('data-memo-group')) { memoGroup = b.dataset.memoGroup || ''; renderList(); host.querySelector(`[data-memo-group="${CSS.escape(memoGroup)}"]`)?.focus({preventScroll:true}); }
    else if (b.hasAttribute('data-memo-open')) openMemoLine(b.dataset.memoOpen);
    else if (b.hasAttribute('data-nt-pub')) { pubOnly = !pubOnly; renderList(); host.querySelector('[data-nt-pub]')?.focus({preventScroll:true}); }
    else if (b.dataset.pubLine && selected) void pubAct(b.dataset.pubLine, selected, b);
    else if (b.hasAttribute('data-nt-cal-nav')) { const next = navMonth(calMonth, b.dataset.ntCalNav); calMonth = next.month; calDay = next.day; renderList(); }
    else if (b.hasAttribute('data-nt-cal-day')) { calDay = b.dataset.ntCalDay; renderList(); }
    else if (b.hasAttribute('data-note-tag')) { const key = b.dataset.noteTag; void askClose(b).then(ok => { if (!ok) return; tagSel = [key]; tagTouched = true; if (view === 'tag') renderList(); else setView('tag'); }); }
  });
  // 폴더 줄: 선택 모드면 고르기. 폰은 그 자리 펼치기·접기. PC·폴드 왼쪽 나무의 폴더 줄은 ftExplorePress가 먼저 맡는다(S69-38 UI-탐색기나무누르기).
  // 여기 오는 PC·폴드 줄은 오른쪽 칸 하위 폴더 줄(그 자리 펼치기 — S69-68)·'최근'(오른쪽에 최근 노트)·'폴더 없음'·선택 모드 줄이다.
  function pressFolder(id, e) {
    if (isPaneAt(id)) { if (!pick.active) enter(id); return; } // 'News에서' 두 줄·휴지통: 그 칸(폰은 '그 폴더만'처럼 한 겹)
    // FOLDER-나무새기준 ③: 폰 나무(첫 화면·그 폴더만 보기 모두)는 화면을 바꾸지 않고 그 자리에서 펼치기·접기(줄 어디를 눌러도). 그 폴더만 보기는 ⋯ [이 폴더로 들어가기].
    // UI-폴더이름펼치기(명진 11/24 18:09): 빈 폴더도 그 자리에서 펼친다(안에 '빈 폴더' 한 줄). 들어가기는 ⋯ 첫 줄 [이 폴더로 들어가기]만
    //  (전의 OPS-빠진일2차 1 '하위 없는 폴더 = 한 번에 열기'는 없앴다).
    if (!wideList.matches && id !== RECENT && !(pick.active && id !== OUTSIDE)) { if (openSet.has(id)) openSet.delete(id); else openSet.add(id); renderList(); return; }
    // S69-68 UI-오른쪽목록펼치기(명진 11/24 20:09, 전의 S69-38 '오른쪽 하위 폴더 줄 = 들어가기'를 대신함): PC·폴드 오른쪽 칸의 폴더 줄 = 그 자리 펼치기·접기만
    // (왼쪽 나무는 그대로). 들어가기는 왼쪽 나무 누르기·⋯ 첫 줄 [이 폴더로 들어가기].
    if (wideList.matches && !pick.active && folderById(id)) {
      if (paneOpen.has(id)) paneOpen.delete(id); else paneOpen.add(id);
      renderList(); host.querySelector(`#noteRows [data-nx-open="${CSS.escape(id)}"]`)?.focus({preventScroll:true}); return;
    }
    if (id === OUTSIDE) { enter(OUTSIDE); return; }
    if (id === RECENT) { enter(null); return; }
    if (pick.active) { togglePick('f:' + id); }
  }
  // 그 폴더 열기(PC·폴드 나무 이름 누르기 ftExplorePress): 같은 길(PC·폴드 = 들어가기, 폰 첫 화면 = 돌아올 자리를 기억하고 그 폴더만, 폰 그 폴더만 안 = 그 안으로).
  function pressEnter(id) {
    if (!id || !folderById(id)) return;
    if (wideList.matches) enter(id); else if (at === null) focusFolder(id); else enter(id);
  }
  // 들어가기(10:34 ②): 그 폴더만 보이고 위에 '이름 · 장수'(2단 이상이면 위치 줄도). 폴더 위쪽은 왼쪽 나무에서 열어 둔다.
  // NAV-PC뒤로직전: on PC·the unfolded Fold (folder tree | notes) a folder the person entered is a back step of its own (router pick):
  // ‹ = the folder before, then '최근' (the first screen, kept as one step), then the screen before. picked:false for the folder
  // entered by itself (a reload's ?folder=). The phone keeps its own folder layer (syncFolderLayer).
  function enter(id, {focus = true, picked = true} = {}) {
    // S69-27: 두 칸에서 노트를 연 채 다른 칸('최근'·폴더 들어가기·휴지통 등)으로 가면 노트를 먼저 닫는다(오른쪽 칸 하나에 하나만).
    if (splitOpen() && !close({focus:false})) return;
    const from = at;
    at = id === OUTSIDE || isPaneAt(id) ? id : id && folderById(id) ? id : null;
    for (const f of at && at !== OUTSIDE ? folderPath(folders, at) : []) openSet.add(f.id);
    renderList();
    // NAV-새로고침제자리: the folder entered is written to the address (?folder=, no entry of its own) after the list is drawn, so on a
    // phone it lands on the folder screen's own layer entry and Back to the folder list leaves it out. A reload enters it again.
    window.KPTURouter?.setPlace?.('basket', {folder:at});
    if (picked && wideList.matches && from !== at) window.KPTURouter?.pick?.record?.('basket', at === null ? {} : {folder:at}, {fromNone:from === null});
    if (focus) (at !== null ? host.querySelector('#noteRows [data-note-row], #noteRows [data-nx-open]') || host.querySelector('[data-nx-back]') : host.querySelector('#noteRows [data-nx-open]') || host.querySelector('[data-note-search]'))?.focus({preventScroll:true});
    if (!wideList.matches) window.scrollTo({top:0, behavior:'instant'});
  }
  // ‹ › over an entered folder enters it again; a folder no longer there (deleted) shows '최근' (the list only).
  window.KPTURouter?.pick?.on?.('basket', ({folder = null} = {}) => {
    if (!wideList.matches || selected || !loaded || view !== 'folder') return true;
    const id = folder === OUTSIDE || isPaneAt(folder) || (folder && folderById(folder)) ? folder : null;
    if (id !== at) enter(id, {focus:false, picked:false});
    return true;
  });
  // 폰 '그 폴더만' 보기 → 나무(FOLDER-나무새기준 ④): [‹]·뒤로 키 모두 첫 화면 나무로, 펼친 폴더와 화면 위치 그대로.
  // 그 폴더는 펼친 채로 둔다(벌리기 전 접혀 있었어도 돌아오면 그 자리에서 보인다).
  function focusFolder(id) {
    if (wideList.matches || at !== null || !id || (id !== OUTSIDE && !folderById(id))) return;
    treeScroll = {y:window.scrollY, id};
    openSet.add(id);
    // S51-24 ④: 그 줄 자리에서 상자 머리로 올라오는 0.2초(folder-focus-motion.js).
    const from = topOf(host.querySelector(id === OUTSIDE ? '#noteRows [data-nx-outside]' : `#noteRows [data-nx-folder="${CSS.escape(id)}"]`));
    enter(id);
    riseFromRow(from, host.querySelector('#noteRows .ft-focus'));
  }
  // LIB-최근폴더로가기(S61-12, 요청함 V28 11/13 04:40 명진 ㅇ): '최근' 노트 줄 [폴더로 가기] = 그 노트가 든 폴더(없으면 '폴더 없음')로 들어가 그 줄을 잠깐 강조.
  // 폰 첫 화면 = 두 손가락 '그 폴더만'과 같은 길(뒤로 = 펼친 나무 자리 그대로), PC = 폴더 들어가기(뒤로 = 앞 화면 '최근'). 줄 그냥 누르기(노트 열기)는 그대로.
  function gotoFolder(note) {
    if (!note) return;
    const id = folderOf(note) || OUTSIDE;
    if (!wideList.matches && at === null) focusFolder(id); else enter(id);
    flashRow(host.querySelector(`#noteRows [data-nx-note="${CSS.escape(note.id)}"]`), {cls:'nx-flash', ms:1300});
  }
  const focusHeadTop = () => topOf(host.querySelector('#noteRows .ft-focus-head'));
  function up() {
    if (wideList.matches) { enter(at && at !== OUTSIDE && !isPaneAt(at) ? folderById(at)?.parent_id || null : null); return; }
    const back = treeScroll || {y:null, id:at}, from = focusHeadTop(); treeScroll = null;
    enter(null, {focus:false});
    restoreTree(back, from);
  }
  // 나무로 돌아온 자리: 두 손가락으로 들어왔으면 그때 화면 위치, 다른 길이면 그 폴더 줄을 화면 가운데로(S51-24). from: 상자 머리가 있던 곳(내려오는 움직임).
  function restoreTree(back, from = null) {
    if (!back) return;
    const sel = back.id === OUTSIDE ? '#noteRows [data-nx-outside]' : isTrashAt(back.id) ? '#noteRows .ft-trash' : isNewsAt(back.id) ? `#noteRows [data-nx-news-item="${back.id}"]` : `#noteRows [data-nx-folder="${CSS.escape(back.id)}"]`;
    const row = host.querySelector(sel);
    settleGestureAreas();
    if (typeof back.y === 'number') window.scrollTo({top:back.y, behavior:'instant'});
    else row?.scrollIntoView({block:'center', behavior:'instant'});
    row?.querySelector('.ft-main')?.focus({preventScroll:true});
    sinkToRow(from, row, host.querySelectorAll('[data-nx-recent] .ft-box, #noteRows > .ft-box'));
  }
  // 폰 폴더 화면은 라우터 한 겹: 갤럭시 뒤로가기 = 첫 화면 폴더 목록(선택 모드·열린 노트 겹이 있으면 그것부터 닫힘).
  function syncFolderLayer() {
    if (at !== null && !folderLayer) { const folderId = at; folderLayer = window.KPTURouter?.layer?.open('basket-note-folder', {close: () => { folderLayer = null; endSelect(); const back = treeScroll || (wideList.matches ? null : {y:null, id:at}), from = focusHeadTop(); treeScroll = null; at = null; renderList(); restoreTree(back, from); return true; }, reopen: () => enter(folderId)}) || null; }
    else if (at === null && folderLayer) { const l = folderLayer; folderLayer = null; l.close(); }
  }
  host.addEventListener('keydown', e => {
    if (e.key === 'F2' && (!selected || splitOpen()) && !editing && !e.target.closest('input,textarea,[contenteditable]')) { const row = e.target.closest('[data-nx-folder]'); if (row) { e.preventDefault(); void renameFolder(row.dataset.nxFolder); return; } }
    if (e.key !== 'Escape') return;
    if (menu) { e.preventDefault(); e.stopPropagation(); closeMenu({focus:true}); return; }
    if (pick.active && !selected) { e.preventDefault(); e.stopPropagation(); endSelect(); return; }
    if (!selected || busy) return;
    e.preventDefault(); e.stopPropagation();
    if (manual.isOpen()) void manual.cancel({anchor:e.target instanceof Element ? e.target : null});
    else if (editing) void finishEdit({anchor:e.target instanceof Element ? e.target : null});
    else void askClose(e.target instanceof Element ? e.target : null);
  });
  // NOTE-보기3가지 ①: 폰은 좌우로 밀어 보기 전환(왼쪽으로 밀면 폴더 → 목록 → 보드). 보드 판 위는 판 이동이라 빼고(판이 먼저, data-nb-scroll),
  // 보드에서는 위쪽 줄(검색 칸 줄·보드 칸 줄)에서 밀거나 전환 단추를 누른다. 꾹 눌러 잡은 줄·선택 모드·열린 노트·글 칸에서는 밀기를 보지 않는다.
  // UI-칩줄두줄: 보드 칸 줄(data-nbb)은 이제 옆으로 밀지 않으므로(두 줄 + [더보기]) 밀기 예외에서 뺐다.
  let swipe = null;
  list.addEventListener('touchstart', e => {
    swipe = null;
    if (e.touches.length !== 1 || wideList.matches || selected || pick.active || e.target.closest('[data-nb-scroll],[data-nbb-side],input,textarea,[contenteditable]')) return;
    const p = e.touches[0]; swipe = {x:p.clientX, y:p.clientY, t:Date.now()};
  }, {passive:true});
  list.addEventListener('touchend', e => {
    const s = swipe; swipe = null;
    if (!s || dragging || Date.now() < suppressUntil || !e.changedTouches.length || claimedSince(s.t)) return; // UI-목록밀기: 줄 위에서 민 것은 줄 밀기(보기 전환 아님)
    const p = e.changedTouches[0], dx = p.clientX - s.x, dy = p.clientY - s.y;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2 || Date.now() - s.t > 800) return;
    const i = ALL_VIEWS.indexOf(view) + (dx < 0 ? 1 : -1);
    if (i >= 0 && i < ALL_VIEWS.length) { suppressUntil = Date.now() + 400; setView(ALL_VIEWS[i]); }
  }, {passive:true});
  list.addEventListener('touchcancel', () => { swipe = null; }, {passive:true});
  // UI-목록밀기 → UI-줄밀기 Raindrop식(S68-26): 폰 노트 줄 — 왼쪽으로 밀기 [고정]/[고정 풀기]·[옮기기](폴더 고르기, ⋯ [폴더로 옮기기]와 같은 길)·[삭제]
  // (휴지통 + 위쪽 '지웠어요 [되돌리기]', 묻지 않음 — 끝까지 밀어도 삭제는 칸만 열림). 오른쪽으로 밀기 [선택] = 노트에 이미 있는 선택 모드(그 줄이 골라진 채).
  // 선택 모드·열린 노트·포스트잇 보드에서는 밀지 않는다(보드는 칸 옮기기). 노트에는 공유 길이 없어 [공유] 칸은 없다.
  bindRowSwipe(list, {row:'[data-nx-note]', enabled:() => !selected && !pick.active && !busy && !editing && view !== 'board',
    actions:el => { const note = notes.find(n => n.id === el.dataset.nxNote); return note ? {start:PICK, end:[{key:'pin', label:notePinnedAt(note) ? '고정 풀기' : '고정', tone:'muted'}, ...(canEditFolders() ? [{key:'move', label:'옮기기', tone:'move'}] : []), {key:'delete', label:'삭제', tone:'danger'}]} : null; },
    run:(key, el) => { const note = notes.find(n => n.id === el.dataset.nxNote); if (!note || busy || selected) return; if (key === 'delete') void remove(note.id, {confirmed:true}); else if (key === 'move') openMovePicker(el.querySelector('[data-note-row-more]') || el, {notes:[note.id], folders:[]}); else void pin(note); },
    select:{attr:'data-nx-note', open:el => { if (!selected && !busy) startSelect('n:' + el.dataset.nxNote); }}});
  // UI-폴더줄크기(S69-99): 폴더·목록 보기에서 두 손가락 벌리기·오므리기(PC Ctrl+휠) = 줄 크기 한 단계(row-size.js, 모든 폴더 화면 같은 값).
  // 그 폴더만 보기(들어가기)는 ⋯ [이 폴더로 들어가기]로만, 돌아오기는 [‹]·뒤로·왼쪽 끝 밀기. 포스트잇 보드는 보드 확대(note-board.js) 그대로.
  // S51-24 UI-빈칸손짓: 노트가 짧아도 아래 빈 곳까지 손짓 칸(두 손가락·좌우 밀기 보기 전환, gesture-fill.js).
  fillGestureArea(host.querySelector('[data-nx-body]'));
  bindFolderPinch(host.querySelector('[data-nx-body]'), {enabled:() => view !== 'board' && !selected && !pick.active && !busy});
  // FILES-폰폴더위로 ④⑤: 폰 '그 폴더만'에서 화면 왼쪽 끝에서 오른쪽으로 밀기 = [‹]와 같은 곳(노트 '그 폴더만'은 한 단계라 늘 펼친 자리 그대로 나무).
  bindEdgeBack(host.closest('.view-panel') || host, {enabled:() => !wideList.matches && at !== null && !selected && !pick.active && !busy, onBack:() => up()});
  // Leaving the menu by keyboard, or pressing anywhere outside it and its ⋯, closes it.
  host.addEventListener('focusout', e => { const el = menuEl(); if (menu && e.relatedTarget && !el.contains(e.relatedTarget) && e.relatedTarget !== menu.trigger) closeMenu(); });
  // composedPath: [색 고르기…]가 메뉴 안 내용을 바꾸면 눌린 단추는 이미 떼어져 있어도 "메뉴 안에서 누름"으로 본다.
  document.addEventListener('click', e => { if (menu && !e.composedPath().includes(menuEl()) && !menu.trigger.contains(e.target)) closeMenu(); });

  return {
    // openId: a note just moved here from the basket opens once the list is read.
    // 휴지통에서 되돌린 노트를 목록에 다시 올린다(열어 둔 노트·편집 중이면 건드리지 않는다).
    reload() { if (loaded && !selected && !busy) void refresh(); },
    show({openId = null, folder = null} = {}) { void preloadMarkdown(); pendingOpen = openId; pendingFolder = folder; if (!folder && at) window.KPTURouter?.setPlace?.('basket', {folder:at}); if (!selected) void refresh(); },
    close,
    reset() { closeMenu(); boards.reset(); boardLinks.reset(); board?.closeMenu(); newsMarks.reset(); if (folderSheetOpen()) closeFolderSheet(); addPick = null; endSelect(); at = null; openSet = new Set(); paneOpen = new Set(); moreSet = new Set(); recentAll = false; treeScroll = null; { const l = folderLayer; folderLayer = null; l?.close(); } folders = []; foldersReady = false; folderSay(''); const openedLayer = layer; layer = null; openedLayer?.close(); ++epoch; bigWriter?.close({silent:true}); bigWriter = null; dropField(); selected = null; sendWhere(null); editing = false; busy = false; manual.reset(); noteComments.reset(); resetMemos(); tagSel = []; tagTouched = false; readPick = null; editPick = null; memoGroup = ''; calMonth = monthNow(); calDay = ''; notes = []; links = []; loaded = false; query = ''; noteTrash.reset(); detail.replaceChildren(); placeDetail(); host.querySelector('[data-note-search]').value = ''; host.querySelector('[data-note-rows]').replaceChildren(); status.textContent = ''; onOpenChange(false); },
    isBusy: () => busy,
    isUploading: () => fileQueue.any(), // 뒤에서 노트 첨부를 올리는 중(최신화 전에 막는 데 쓴다)
    hasDraft: () => textDirty() || (!!selected && (manual.hasDraft() || noteComments.hasDraft())),
    isOpen: () => !!selected,
  };
}
