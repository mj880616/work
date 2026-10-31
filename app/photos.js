import {waitHtml, waitInlineHtml, failHtml, emptyHtml} from './wait-state.js';
// PHOTO-사진메뉴(docs/design/photo-menu.md, 시안 photo-menu-mock.html): '사진' 메뉴(?view=photos). #photosView의 유일한 그리기 주인.
// 원드라이브 사진·동영상 색인(Edge onedrive-photos, PR 1410: library·months·days·media-url·photo-delete·trash-*)을 읽어 갤러리처럼 보여 준다.
// - 위 칩 줄: [사진] [달력] [휴지통] · 오른쪽 끝 거르기(전체·★·동영상·스크린샷)·[－][＋]·원드라이브 아이콘(od-link.js).
//   거르기·칸 수는 서버 view_prefs.photo_view(명진 결정 6, 일기 칸 수와 따로). 칸 수는 폰 3~6·PC 5~12.
// - [사진]: 최신순 격자 120장씩(library cursor) + 날짜 머리줄. 오른쪽 끝 얇은 막대(months)를 끌면 달 말풍선 '2026.09', 놓으면 그 달로.
// - [달력]: 날마다 대표 사진·장수(days). 칸을 누르면 [사진]의 그날부터.
// - [휴지통](명진 결정 1): Web2에서 지운 사진('.Web2 휴지통' 폴더). 고르면 [되살리기]·[바로 지우기], 위 줄 [모두 비우기].
// - 크게 보기: 일기와 같은 공용 부품 photo-strip.js. 동영상은 ▶로 재생(media-url play, 주소는 메모리에만), [ⓘ] 판 [⤓ 원본 받기](media-url download).
// - 여러 장 고르기: 길게 누르기(0.5초)로 시작, 고른 뒤 좌우로 끌면 여러 칸(화면 끝 자동 스크롤). 아래 [☆ 별표] [⇪ 공유] [⤓ 받기] [🗑 지우기].
//   지우기는 묻지 않고 바로 빠지고 [되돌리기] 5초(명진 결정 7), 그 뒤 한 번에(ids ≤ 50) Web2 휴지통으로.
// - 원드라이브 설정 창(폴더 바꾸기·하위 폴더·연결 끊기)은 일기와 같은 공용 부품 od-settings.js로 이 화면 안에서 연다(결정 4). 연결 뒤에는 이 화면으로 돌아온다(결정 5).
// PHOTO-출처 ①(요청함 10/30 17:30): 위 줄 오른쪽 출처 아이콘 [원드라이브][구글 드라이브(운영자 기능이 있을 때만, S46-24 ④)][폰 사진(폰 앱에서만)]. 누르면 그 출처 켜기/끄기(서버 view_prefs.photo_sources).
//   원드라이브 아이콘은 연결 전·문제가 있으면 누를 때 지금처럼 연결 메뉴, 연결 뒤에는 켜기/끄기이고 꾹 누르기(PC 우클릭)가 연결 메뉴다.
//   켜진 출처는 [사진]·[달력]·빠른 이동 막대에 찍은 날 순서로 섞이고(photo-sources-model.mjs), 둘 이상 켜졌으면 칸 오른쪽 아래 작은 출처 표시.
//   폰 사진은 앱 다리(phone-photos.js)로 폰 안에서만 읽는다(서버로 올리지 않음). 같은 사진이 원드라이브에도 있으면 한 장만.
//   별표·앨범은 폰 사진도(source 'phone'), 지우기는 폰 휴지통(시스템 확인 창).
// PHOTO-출처모든칩(요청함 10/31 00:01): 출처 켜기/끄기가 모든 칩을 따른다. [폴더]는 원드라이브 폴더(켜졌을 때)와 폰 폴더(사진첩 relative_path,
//   보기 전용 — 만들기·이름 바꾸기·옮기기·⋯는 원드라이브만)를 '원드라이브'·'폰' 두 묶음으로, [휴지통]은 원드라이브가 켜졌을 때만(폰 휴지통은
//   갤러리 앱 안내 한 줄), [앨범]은 켜진 출처 사진만 세고 보인다(앨범 자체는 그대로). 모두 끄면 모든 칩이 '위 출처 아이콘을 켜 주세요' 한 줄.
//   출처 끄기는 보기에서만 빠진다(원드라이브 연결은 그대로).
// 별표는 app_diary_stars(일기 ★와 같은 것). 저장은 모두 서버(기기 저장 없음, 썸네일 사본은 기존 od-thumb-cache.js만).
// 사진 메뉴 ②(2026-10-29 08:07 요청): [폴더]·[앨범] 칩.
// - [폴더]: 원드라이브 폴더 그대로(서버 folders-tree·library folder_id). PC(761px~)는 왼쪽 폴더 나무(노트·자료실과 같은 모양: 노란 폴더·들여쓰기·▸/▾·
//   폴더마다 장수·맨 아래 + 새 폴더) + 오른쪽 위치 줄(folder-path.mjs 공용 부품)·고른 폴더 사진 격자. 폰은 노트처럼 한 화면씩 들어가고(위 하위 폴더 줄,
//   아래 그 폴더 사진) 위치 줄·뒤로가기로 올라간다. 폴더 ⋯(PC 우클릭 = 폰 꾹 누르기, context-menu.js 공용 부품) = 새 하위 폴더·이름 바꾸기·옮기기·지우기(빈 폴더만).
// - 여러 장 고른 뒤 [📁 옮기기] → 폴더 나무에서 고름(PC는 고른 사진을 왼쪽 폴더로 끌어 놓기도). 원드라이브에서도 실제 이동, 위쪽 '옮겼어요 · 되돌리기'.
// - 사진 우클릭(PC) = [선택] [폴더로 옮기기] [앨범에 넣기] [지우기]. 폰 꾹 누르기는 ①처럼 바로 여러 장 고르기.
// - [앨범]: #태그(app_photo_tags·app_photo_tag_items, owner RLS, 원드라이브 파일은 그대로). 카드(대표 사진·#이름·장수)·+ 새 앨범, 카드 ⋯ = 이름 바꾸기·지우기.
//   고른 사진 [# 앨범]으로 넣고, 앨범 안에서는 [앨범에서 빼기]. 앨범 사진 목록은 그 앨범 사진 id를 서버 library에 보내 색인에 있는 것만 그린다.
import {odStatusCached, odPhotoElement, odDelete, odDeleteMany, forgetOdPhoto, odErrorText, odSync, odSyncDelay, odLibrary, odMonths, odDays, odMediaUrl,
  odTrashList, odTrashRestore, odTrashPurge, odPhotoBlob, readOdStars, readPhoneStars, addStar, removeStar, starKey, takenLabel, takeOdReturn} from './diary-onedrive.js';
import {phonePhotos} from './phone-photos.js';
import {createPhotoTidy} from './photo-tidy.js';
import {typeFilter} from './photo-tidy-model.mjs';
import {parsePhoneOff, phoneOffValue, remapPhoneOff, cleanPhoneName, isPhoneMovable, isPhoneTrashable, newPhonePath, renamedPhonePath, movedPhonePath, phonePickRows, phoneOpText} from './phone-folders-model.mjs';
import {parseSources, sourcesValue, toggleSource, sourceButtons, activeSources, activeCount, mergeSources, mergeDays, mergeMonths, daysFromItems, phoneIdOfKey, phoneErrorText, SOURCE_TEXT,
  gdriveAllowed, gdriveToItem, gdriveBefore, gdriveFrom, gdriveKey, gdriveErrorText, gdriveCode, gdriveNeedsReconnect, gdriveState, GDRIVE_RECONNECT} from './photo-sources-model.mjs';
// S46-24 ④ 구글 드라이브 칸(운영자 기능 gdrive_photos가 있는 작업공간만, 서버가 네 겹으로 다시 막음). 같은 사진 한 장 규칙·출처 표시는 원드라이브·폰과 같다.
//   [사진]에 섞이고(거르기 '전체'·'동영상'만 — ★·스크린샷·달력·빠른 이동 막대·앨범은 아직 원드라이브·폰만), [폴더]는 '구글 드라이브' 묶음(맨 위부터 한 층씩, 스위치·⋯).
//   사진 이름 바꾸기·옮기기·지우기(드라이브 휴지통)는 사진 ⋯(PC 우클릭)·고른 사진 아래 줄에서, 지우기는 확인 창 한 번. 권한이 없으면 칩·목록 위에 '권한 없음 · [Drive 다시 연결]'.
import {myFeatures, gdStatus, gdFolders, gdFolderToggle, gdSync, gdList, gdRename, gdMove, gdTrash, gdFolderCreate, gdFolderRename, gdFolderTrash, gdReconnect,
  gdThumbBlob, gdMediaBlob, gdPhotoElement, gdForget, gdClear} from './gdrive-photos.js';
import {ownerScope} from './diary-data.js';
import {seoulParts, seoulDateKey} from './meeting-time.js';
import {SIZE_BUTTONS, WIDE_QUERY, createGridSizer, multiTouchActive, onMultiTouch} from './photo-grid-size.js';
import {openPhotoStrip, closePhotoStrip, photoStripOpen, photoStripNote, photoStripRefresh} from './photo-strip.js';
import {UNDO_MS, shareFileName} from './photo-viewer-model.mjs';
import {photoFile} from './photo-share.js';
import {shareFrom, wideShare} from './share-menu.js';
import {odLinkButtonHtml, paintOdLink, createOdLinkMenu} from './od-link.js';
import {createOdSettings} from './od-settings.js';
import {createSelectMode} from './select-mode.js';
import {createAnchoredMenu} from './anchored-menu.js';
import {folderPathHtml} from './folder-path.mjs';
import {odFolderTree, odFolderCreate, odFolderRename, odFolderMove, odFolderDelete, odPhotosMove, odFolderToggle} from './diary-onedrive.js';
import {readPhotoTags, createPhotoTag, renamePhotoTag, deletePhotoTag, addPhotoTagItems, removePhotoTagItems} from './photo-tags.js';
import {photoFolderRows, photoFolderTrail, photoSubfolders, photoFolderById, photoMoveTargets, cleanPhotoFolderName, moveUndoGroups, folderErrorText,
  cleanTagName, sameTag, albumCards, albumForSources, folderPlaceLabels, odFolderPlace, phoneFolderPlace,
  validAlbumView, stepAlbumView, albumPeriod, ALBUM_VIEW_TEXT} from './photos-model.mjs';
import {notify, askConfirm} from './small-notice.js';
import {viewPrefs} from './view-prefs.js';
import {followPane} from './follow-pane.js';
import {mountSplitResize} from './split-resize.js';
import {SELECT_MAX, PAGE_SIZE, STAR_CHUNK, FILTER_TEXT, DOWNLOAD_MAX, SHARE_MAX, validTab, validFilter, monthKey, prevMonth, nextMonth, groupByDay, dayHead, starPlan,
  colsFor, stepPhotoCols, parsePhotoView, toItem, appendItems, durationLabel, monthBar, monthAt, monthCursor, dayCursor, calendarFromDays, chunks, dragRange,
  takeItems, putItems, DEFAULT_SORT, SORT_TEXT, SORT_SHORT, sortCompare, sortByDay, sortChoices, photoViewValue} from './photos-model.mjs';

(() => {
if (window.KPTUPhotos) return;
const rt = window.KPTURuntime;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const HOLD_MS = 500, HOLD_MOVE = 10, DRAG_START = 12, EDGE = 56;

function install() {
  if (document.getElementById('photosView')) return;
  document.getElementById('appView')?.insertAdjacentHTML('beforeend', '<section id="photosView" class="view-panel hidden" aria-label="사진"><div id="photosRoot" class="photos"></div></section>');
}
install();
const root = document.getElementById('photosRoot');
if (!root) return;
// 출처 아이콘(구글 드라이브는 공식 로고 대신 일반 삼각 모양, 폰 사진은 폴더). 색은 CSS(currentColor).
const GDRIVE_SVG = '<svg class="photos-src-ic" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M8.6 3.5h6.8l6.1 10.6-3.4 5.9H5.9L2.5 14.1z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8.6 3.5l6 10.6M15.4 3.5l-6.1 10.6M2.5 14.1h19" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".7"/></svg>';
const PHONE_SVG = '<svg class="photos-src-ic" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2h8.4A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
const MARK_SVG = {onedrive:'<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true" focusable="false"><path d="M4.5 12.5h7.2a2.8 2.8 0 0 0 .4-5.6A3.8 3.8 0 0 0 4.8 6a3.3 3.3 0 0 0-.3 6.5z" fill="currentColor"/></svg>',
  phone:'<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true" focusable="false"><path d="M2 4.5A1 1 0 0 1 3 3.5h3l1.3 1.3H13a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" fill="currentColor"/></svg>',
  gdrive:'<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true" focusable="false"><path d="M5.6 2.5h4.8l4.1 7.1-2.3 3.9H3.8L1.5 9.6z" fill="currentColor"/></svg>'};
const filterOptions = Object.entries(FILTER_TEXT).map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
root.innerHTML = `<div class="photos-bar" data-photos-bar><div class="photos-chips" role="group" aria-label="사진 보기"><button type="button" class="photos-chip" data-photos-tab="all" aria-pressed="true">사진</button><button type="button" class="photos-chip" data-photos-tab="calendar" aria-pressed="false">달력</button><button type="button" class="photos-chip" data-photos-tab="folders" aria-pressed="false">폴더</button><button type="button" class="photos-chip" data-photos-tab="albums" aria-pressed="false">앨범</button><button type="button" class="photos-chip" data-photos-tab="trash" aria-pressed="false">휴지통</button></div><div class="photos-tools" data-photos-tools><button type="button" class="photos-chip photos-tidy-chip" data-photos-tidy-chip aria-expanded="false" aria-controls="photosTidy" hidden>정리</button><select class="photos-filter" data-photos-filter aria-label="거르기">${filterOptions}</select><button type="button" class="photos-sort" data-photos-sort aria-haspopup="true" aria-expanded="false"></button>${SIZE_BUTTONS}<span class="photos-sp"></span><span class="photos-srcs" role="group" aria-label="사진 출처">${odLinkButtonHtml('data-photos-src="onedrive" aria-pressed="true"')}<button type="button" class="mini photos-src-btn" data-photos-src="gdrive" aria-pressed="false" aria-label="구글 드라이브" title="구글 드라이브" hidden>${GDRIVE_SVG}</button><button type="button" class="mini photos-src-btn" data-photos-src="phone" aria-pressed="true" aria-label="폰 사진" title="폰 사진" hidden>${PHONE_SVG}</button></span><button type="button" class="secondary photos-al-new" data-photos-al-new hidden>+ 새 앨범</button></div></div><div class="photos-sel" data-photos-sel hidden><button type="button" class="photos-sel-x" data-photos-sel-off aria-label="선택 끝내기">✕</button><span data-photos-sel-count>0개 골랐음</span></div><form class="photos-name" data-photos-name hidden><label><span data-photos-name-label></span><input type="text" data-photos-name-input autocomplete="off" enterkeyhint="done" maxlength="200"></label><button type="submit" class="mini">저장</button><button type="button" class="mini" data-photos-name-cancel>취소</button></form><p class="photos-note" data-photos-note role="status"></p><div class="photos-tidy" id="photosTidy" data-photos-tidy hidden></div><div class="photos-od" data-photos-od></div><div class="photos-body" data-photos-body></div><div class="photos-rail" data-photos-rail role="slider" tabindex="0" aria-label="달 빠른 이동" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0" aria-valuetext="" hidden><span class="photos-rail-thumb" data-photos-rail-thumb></span><span class="photos-rail-bubble" data-photos-rail-bubble hidden></span></div><div class="photos-act" data-photos-act role="group" aria-label="고른 사진" hidden><button type="button" data-photos-act-star><span aria-hidden="true">☆</span> 별표</button><button type="button" data-photos-act-share hidden><span aria-hidden="true">⇪</span> 공유</button><button type="button" data-photos-act-down><span aria-hidden="true">⤓</span> 받기</button><button type="button" data-photos-act-rename hidden><span aria-hidden="true">✎</span> 이름</button><button type="button" data-photos-act-move aria-haspopup="true" aria-expanded="false"><span aria-hidden="true">📁</span> 옮기기</button><button type="button" data-photos-act-tag aria-haspopup="true" aria-expanded="false"><span aria-hidden="true">#</span> 앨범</button><button type="button" data-photos-act-untag hidden><span aria-hidden="true">−</span> 앨범에서 빼기</button><button type="button" class="photos-danger" data-photos-act-delete><span aria-hidden="true">🗑</span> 지우기</button></div><div class="photos-act" data-photos-trash-act role="group" aria-label="고른 휴지통 사진" hidden><button type="button" data-photos-restore><span aria-hidden="true">↺</span> 되살리기</button><button type="button" class="photos-danger" data-photos-purge><span aria-hidden="true">🗑</span> 바로 지우기</button></div>`;
const $ = sel => root.querySelector(sel);
const body = $('[data-photos-body]'), noteEl = $('[data-photos-note]'), linkBtn = $('[data-od-link]'), odHost = $('[data-photos-od]');
const rail = $('[data-photos-rail]'), bubble = $('[data-photos-rail-bubble]'), thumb = $('[data-photos-rail-thumb]');

const OD_NONE = {configured:false, connected:false, folder:null, canDelete:false};
let owner = ownerScope(rt), run = 0;
let od = {...OD_NONE}, odFault = false, odReady = false, odMessage = '';
let tab = 'all', filter = 'all', colsSaved = null, prefsRead = false, sort = DEFAULT_SORT;
// [사진] 목록: items(최신순), next(다음 쪽 cursor), from(막대·달력으로 건너뛴 시작 {cursor, label} 또는 null = 최신부터).
let items = [], next = null, ended = false, loading = null, failed = '', from = null, rendered = 0, renderedIds = [];
// PHOTO-출처 ①: 출처마다 받은 것(odList·phList)을 섞은 것이 items다(mergeSources). hidden = 지우는 중(되돌리기 시간)이라 빼 둔 칸 id.
let odList = [], odEnded = false, phList = [], phNext = 0, phEnded = false;
const hidden = new Set();
let sources = parseSources(null), phStarItems = null;
// S46-24 ④ 구글 드라이브: gd(칩을 보일지·권한 문제·켠 폴더 수), [사진] 출처 목록 gdItems(gdCursor = 서버 다음 쪽 기준), [폴더] 층 gdLevels(부모 id → 그 안 폴더),
//   gdAt(들어간 구글 드라이브 폴더 id, null = 밖), gdTrail(위치 줄), 그 폴더 사진 gdFItems. 모두 이 화면 메모리만(서버가 원본).
let gd = {allowed:false, problem:'', foldersOn:0, checked:false}, gdItems = [], gdEnded = false, gdCursor = null, gdSyncAt = 0, gdSyncing = false, gdPlayUrl = '';
const gdLevels = new Map(), gdLevelLoading = new Map(), gdLevelFailed = new Map();
let gdAt = null, gdTrail = [], gdFFor = null, gdFItems = [], gdFLoading = null, gdFFailed = '';
// PHOTO-폴더스위치: 끈 폰 폴더(view_prefs.phone_folders_off, 서버). 앱 0.4.1+만 스위치·바꾸기(phone.state().hide·ops). 새 폴더(사진을 옮겨 넣기 전)는 이 화면 메모리에만.
let phoneOff = new Set(), pPending = [], manageAsked = false;
const phone = phonePhotos();
let bar = [], monthsFor = '', calCursor = null, calData = new Map(), tabLayer = null, syncing = false, syncAt = 0;
let trash = null, trashFailed = '', trashBusy = false;
// [폴더]: tree(서버 folders-tree), at(보는 폴더 id), openSet(PC 나무에서 펼친 폴더, 화면 기억만), 그 폴더 사진 fItems(fFor = 어느 폴더 것인지).
let tree = null, treeFailed = '', treeLoading = null, at = null, fFor = null, fItems = [], fNext = null, fEnded = false, fLoading = null, fFailed = '', folderLayer = null, busy = false;
const openSet = new Set();
// [폴더] 폰 묶음(PHOTO-출처모든칩): pFolders(앱 folders 읽기, null = 아직, false = 옛 앱이라 없음), pAt(보는 폰 폴더 relative_path 또는 null), 그 폴더 사진 pItems.
let pFolders = null, pFoldersFailed = '', pFoldersLoading = null, pAt = null, pFor = null, pItems = [], pNext = 0, pEnded = false, pLoading = null, pFailed = '';
// [앨범]: tags·links(서버), album(들어간 앨범 id 또는 null = 카드 목록), aItems(그 앨범 사진).
let tags = null, links = [], tagsFailed = '', tagsLoading = null, album = null, aFor = null, aItems = [], aLoading = null, aFailed = '', albumLayer = null;
const TREE_WIDE = globalThis.matchMedia?.('(min-width:761px)');
const treeWide = () => !!TREE_WIDE?.matches;
const starSet = new Set(), starDay = new Map(), starBusy = new Set();
let starsReady = null;
const isStarred = item => starSet.has(starKey(item.source, item.key));
const select = createSelectMode({layer:'photos-select', onBack:() => paintSelect()});
const thisMonth = () => { const p = seoulParts(new Date()); return {year:p.year, month:p.month}; };
const current = r => r === run && owner === ownerScope(rt);
const note = text => { noteEl.textContent = text || ''; };
const ready = () => odReady && od.connected && !!od.folder;
// 이번 [사진]·[달력]에서 실제로 읽는 출처(켜짐 + 쓸 수 있음).
const phoneUsable = () => phone.available() && !!phone.state().key;
const gdUsable = () => gd.allowed && !gd.problem;
// 구글 드라이브 출처가 켜졌나(칩이 보이는 작업공간에서만). 권한 문제가 있어도 켜진 것으로 본다(안내 한 줄을 보이려고).
const gdOn = () => sources.gdrive && gd.allowed;
const useSrc = () => activeSources(sources, {onedrive:ready(), phone:phoneUsable(), gdrive:gdUsable()});
const anyUse = () => { const u = useSrc(); return u.onedrive || u.phone || u.gdrive; };
const marks = () => activeCount(useSrc()) >= 2;
// [사진]에 구글 드라이브를 섞는 거르기(별표·스크린샷은 아직 원드라이브·폰만).
const gdFilterOk = () => filter === 'all' || filter === 'video';
// PHOTO-출처모든칩: 폰 사진 출처가 켜졌나(앱이 폰 사진을 지원할 때만, PC는 늘 꺼짐). 모두 꺼지면 모든 칩이 한 줄 안내.
const phoneOn = () => sources.phone && phone.available();
// 끈 폰 폴더를 읽기에 붙인다(옛 앱은 phone-photos.js가 붙이지 않음).
const hideArg = () => ({hide:[...phoneOff]});
const phoneSw = () => phone.state().hide === true;
const phoneOps = () => phone.state().ops === true;
const noSource = () => !sources.onedrive && !phoneOn() && !gdOn();
const NO_SOURCE_HTML = '<p class="photos-muted" data-photos-no-source>위 출처 아이콘을 켜 주세요.</p>';
// S46-20 사진 정리 제안 ①(photo-tidy.js): [정리 n] 칩(폰 앱에서 [사진]일 때만) → 접힌 칸. tidyView = [사진]에 정리 목록을 보이는 중('place:phone'·'junk:kakao', 이 화면 메모리만).
let tidyOpen = false, tidyView = null;
const tidyChip = $('[data-photos-tidy-chip]'), tidyBox = $('[data-photos-tidy]');
const tidy = createPhotoTidy({phone, odReady:() => ready(), odError:e => odErrorText(e), phoneError:e => phoneErrorText(e), phoneOff:() => phoneOff, onChange:() => paintTidy(), isStarred:it => isStarred(it),
  readOd:async (cursor, limit) => { const page = await odLibrary(rt, {filter:'all', cursor, limit}); return {items:page.items.map(toItem), next:page.next}; }});
const tidyPlace = () => (tidyView?.startsWith('place:') ? tidyView.slice(6) : 'all');
function paintTidy() {
  const show = tab === 'all' && phoneUsable();
  const n = tidy.count();
  tidyChip.hidden = !show; tidyChip.textContent = n ? `정리 ${n}` : '정리';
  tidyChip.setAttribute('aria-expanded', String(show && tidyOpen));
  tidyBox.hidden = !show || !tidyOpen;
  if (tidyBox.hidden) return;
  if (!tidy.state) tidy.open();
  const open = new Set([...tidyBox.querySelectorAll('details[open]')].map(d => d.dataset.k));
  tidyBox.innerHTML = tidy.html({place:tidyPlace(), canHide:phoneSw(), canTrash:phone.state().trash === true});
  tidyBox.querySelectorAll('details[data-k]').forEach(d => { if (open.has(d.dataset.k)) d.open = true; });
  // ④ 묶음 작은 그림(폰 앱에서만 읽음, 메모리만).
  tidyBox.querySelectorAll('[data-photos-tidy-th]').forEach(el => { const it = tidy.item(el.dataset.photosTidyTh); if (it) el.append(phone.element(it, 'small', {label:''})); });
}
// 정리 목록 보기 켜기/끄기([사진] 목록을 그 목록으로 바꾼다).
function setTidyView(key) {
  tidyView = key && tidy.list(key) ? key : null;
  select.stop(); resetList(); render(); window.scrollTo?.(0, 0);
}
// [사진]에 보일 정리 목록(지금 거르기·정렬·건너뛴 달 그대로). 목록이 없어졌으면(다시 확인 중 등) 끈다.
function tidyFill() {
  const list = tidy.list(tidyView);
  if (!list) { tidyView = null; return false; }
  const cut = from ? Date.parse(from.cursor.t) : null;
  items = typeFilter(list, filter, isStarred).filter(it => !hidden.has(it.id) && (!cut || Date.parse(it.taken_at) < cut)).sort(sortCompare(listSort()));
  ended = true;
  const m = {}; for (const it of items) m[it.day.slice(0, 7)] = (m[it.day.slice(0, 7)] || 0) + 1;
  bar = monthBar(m); monthsFor = filter;
  return true;
}
async function tidyTrash(b, kind) {
  const g = tidy.group(kind); if (!g || !g.items.length || !phone.state().trash) return;
  // ③ 공간 비우기: 원드라이브에 정말 있는지 — 읽은 지 오래됐으면 다시 확인부터.
  if (kind === 'space' && !tidy.fresh()) { notify('원드라이브에 있는지 다시 확인할게요. 확인이 끝나면 다시 눌러 주세요.'); tidyView = null; tidy.rescan(); return; }
  const n = g.items.length;
  const keepNote = kind === 'space' ? '원드라이브에는 그대로 남아요. ' : kind.startsWith('dup') ? '남길 사진은 그대로예요. ' : '';
  if (!await askConfirm(b, {text:`${g.label} ${n}장을 폰 휴지통으로 옮길까요?`, note:`${keepNote}폰이 한 번 더 확인 창을 띄워요(200장씩). 폰 갤러리 휴지통에서 30일 안에 되살릴 수 있어요.`, ok:'폰 휴지통으로', danger:true})) return;
  const gone = [];
  for (let i = 0; i < n; i += 200) {
    const part = g.items.slice(i, i + 200);
    const res = await phone.trash(part);
    if (!res.ok) break;
    gone.push(...part.map(x => x.id));
  }
  if (!gone.length) { notify('폰에서 지우지 않았어요.'); return; }
  tidy.forget(gone);
  calData.clear(); monthsFor = ''; phStarItems = null; aFor = null;
  notify(`${gone.length}장을 폰 휴지통으로 옮겼어요`);
  if (tab === 'all') { resetList(); render(); } else paintTidy();
}
function tidyHide(kind) {
  const g = tidy.group(kind); if (!g || !g.folders.length || !phoneSw()) return;
  const next = new Set(phoneOff), hide = !g.folders.every(f => phoneOff.has(f));
  for (const f of g.folders) { if (hide) next.add(f); else next.delete(f); }
  if (!savePhoneOff(next)) return;
  notify(hide ? `${g.label} 폴더를 사진에서 숨겼어요` : `${g.label} 폴더를 다시 보여요`);
  render();
}
function tidyClick(b) {
  if (b.matches('[data-photos-tidy-chip]')) { tidyOpen = !tidyOpen; paintTidy(); return true; }
  if (b.matches('[data-photos-place]')) { const p = b.dataset.photosPlace; setTidyView(p === 'all' ? null : 'place:' + p); return true; }
  if (b.matches('[data-photos-tidy-see]')) { const k = b.dataset.photosTidySee; setTidyView(k === 'space' ? 'space:' : 'junk:' + k); return true; }
  if (b.matches('[data-photos-tidy-keep]')) { const [g, id] = b.dataset.photosTidyKeep.split('|'); tidy.keep(g, id); paintTidy(); return true; }
  if (b.matches('[data-photos-tidy-end]')) { setTidyView(null); return true; }
  if (b.matches('[data-photos-tidy-rescan]')) { tidyView = null; tidy.rescan(); resetList(); render(); return true; }
  if (b.matches('[data-photos-tidy-hide]')) { tidyHide(b.dataset.photosTidyHide); return true; }
  if (b.matches('[data-photos-tidy-trash]')) { tidyTrash(b, b.dataset.photosTidyTrash); return true; }
  if (b.matches('[data-photos-tidy-folder]')) {
    if (!sources.phone) { notify('폰 사진 출처를 켜면 그 폴더를 볼 수 있어요.'); return true; }
    select.stop(); pAt = b.dataset.photosTidyFolder; setTab('folders'); window.scrollTo?.(0, 0); return true;
  }
  return false;
}

// ---- 칸 수(view_prefs.photo_view.cols, 일기와 따로) ----
function readPrefs() {
  if (prefsRead) return;
  prefsRead = true;
  const v = parsePhotoView(viewPrefs.get('photo_view'));
  filter = v.filter; colsSaved = v.cols; sort = v.sort;
  sources = parseSources(viewPrefs.get('photo_sources'));
  phoneOff = parsePhoneOff(viewPrefs.get('phone_folders_off'));
  $('[data-photos-filter]').value = filter; paintSortButton();
}
const savePrefs = () => viewPrefs.set('photo_view', photoViewValue({filter, cols:colsSaved, sort}), {rejectable:true});
// ---- 정렬(PHOTO-정렬, view_prefs.photo_view.sort 하나 — 사진·폴더·앨범 같은 기준) ----
// [사진]에서 달·날로 건너뛴 목록(from)은 찍은 날 최근 먼저로 본다(그 자리부터 이어 보는 기능이라).
const listSort = () => (from ? DEFAULT_SORT : sort);
function paintSortButton() {
  const b = $('[data-photos-sort]'); if (!b) return;
  b.textContent = `${SORT_SHORT[sort]} ▾`; b.setAttribute('aria-label', `정렬: ${SORT_TEXT[sort]}`);
}
const sizer = createGridSizer({current:wide => colsFor(wide, colsSaved), step:stepPhotoCols, save:(wide, n) => { colsSaved = n; savePrefs(); }});

// ---- 서버 읽기 ----
async function ensureOd(force = false) {
  try {
    od = {...OD_NONE, ...(await odStatusCached(rt, {force}))};
  } catch { od = {...OD_NONE, failed:true}; }
  odReady = true; paintOdLink(linkBtn, od, odFault);
  return od;
}
// S46-24 ④: 구글 드라이브 칩을 보일지(app_my_features에 gdrive_photos) + 권한·켠 폴더 수(status). 접속마다 한 번(force면 다시).
async function ensureGd(force = false) {
  if (gd.checked && !force) return gd;
  const o = owner;
  const allowed = gdriveAllowed(await myFeatures(rt));
  if (o !== ownerScope(rt)) return gd;
  if (!allowed) { gd = {allowed:false, problem:'', foldersOn:0, checked:true}; return gd; }
  try { gd = {allowed:true, ...gdriveState(await gdStatus(rt)), checked:true}; }
  catch (error) { gd = {allowed:true, problem:gdriveCode(error), foldersOn:0, checked:true}; }
  return gd;
}
// 구글 드라이브 요청이 권한·연결 문제로 실패하면 칩을 '권한 없음'으로 바꾼다.
function gdProblemFrom(error) {
  if (!gdriveNeedsReconnect(error)) return false;
  gd = {...gd, problem:gdriveCode(error)}; paintSources();
  return true;
}
const gdReconnectable = () => GDRIVE_RECONNECT.includes(gd.problem);
// 칩·목록 위 안내: '구글 드라이브 · 권한 없음 · [Drive 다시 연결]' + 작은 글자 이유. 연결 문제가 아니면 [다시].
function gdNoteHtml() {
  if (!gdOn() || !gd.problem) return '';
  const why = `<small class="photos-gd-why">${esc(gdriveErrorText({message:gd.problem}))}</small>`;
  return gdReconnectable()
    ? `<p class="photos-muted photos-top" data-photos-gd-note>구글 드라이브 · <span class="photos-gd-state">권한 없음</span> <button type="button" class="mini" data-photos-gd-reconnect>Drive 다시 연결</button> ${why}</p>`
    : `<p class="photos-muted photos-top" data-photos-gd-note>구글 드라이브를 읽지 못했어요 <button type="button" class="mini" data-photos-gd-retry>다시</button> ${why}</p>`;
}
async function gdReconnectGo() {
  try { await gdReconnect(rt); } catch (error) { notify(error?.message || 'Google Drive 연결을 시작하지 못했어요.', {error:true}); }
}
async function gdRetry() { await ensureGd(true); paintSources(); sourcesChanged(); }
// 켠 폴더를 Drive에서 다시 받는다(서버 sync, 10분에 한 번). 받은 뒤 [사진]을 새로 그린다.
async function startGdSync(r) {
  if (gdSyncing || !gdUsable() || !sources.gdrive || !gd.foldersOn || (gdSyncAt && Date.now() - gdSyncAt < SYNC_AGAIN_MS)) return;
  gdSyncing = true;
  try {
    const res = await gdSync(rt);
    gdSyncAt = Date.now();
    if (!res?.busy && current(r) && tab === 'all' && !select.active) { resetList(); render(); }
  } catch (error) { if (!gdProblemFrom(error) && current(r)) note(`구글 드라이브 사진 목록을 다 받지 못했어요: ${gdriveErrorText(error)}`); }
  finally { gdSyncing = false; }
}
// 원드라이브 별표 전체(★ 거르기·별표 표시). 접속마다 한 번.
function ensureStars(r) {
  starsReady ||= readOdStars(rt).then(rows => {
    if (!current(r)) return;
    for (const s of rows) { const k = starKey('onedrive', s.item_key); starSet.add(k); starDay.set(s.item_key, String(s.taken_day || '')); }
  }, () => {}).then(() => (phone.usable ? readPhoneStars(rt).then(rows => {
    if (!current(r)) return;
    for (const s of rows) { starSet.add(starKey('phone', s.item_key)); starDay.set(s.item_key, String(s.taken_day || '')); }
  }, () => {}) : null));
  return starsReady;
}
const starIds = () => [...starSet].filter(k => k.startsWith('onedrive:')).map(k => k.slice('onedrive:'.length));
const phoneStarIds = () => [...starSet].filter(k => k.startsWith('phone:')).map(k => phoneIdOfKey(k.slice('phone:'.length))).filter(Boolean);
// PHOTO-폰사진못읽음: 실패 이유 글. 폰 다리 실패(error.phone·폰 접근 없음)는 폰 이유, 나머지는 원드라이브 이유.
const readErrorText = error => (error?.phone || error?.message === 'phone_no_access' ? phoneErrorText(error) : odErrorText(error));
// 폰 사진 별표 칸(★ 거르기 목록·달력·막대). 별표가 바뀌면 버린다.
async function phoneStarList(r) {
  await ensureStars(r);
  if (!phStarItems) phStarItems = (await phone.byIds(phoneStarIds(), hideArg())).sort(sortCompare(listSort()));
  return phStarItems;
}
// 원드라이브에서 바뀐 것을 서버 색인에 이어 받는다(일기와 같은 서버 동작 'sync'). 새로 받은 것이 있으면 처음부터 다시 그린다.
// PHOTO-속도(2026-10-30): 목록 읽기(library·months)는 sync:false로 delta를 기다리지 않으므로, 새 사진을 들이는 길은 이것 하나다.
// 들어올 때마다 부르되 마지막으로 다 받은 지 10분(서버 SYNC_STALE_MS와 같은 값) 안이면 건너뛴다. 서버가 바뀐 수(changed)를 주면 그것으로 다시 그릴지 정한다.
const SYNC_AGAIN_MS = 10 * 60 * 1000;
async function startSync(r) {
  if (syncing || !ready() || !sources.onedrive || (syncAt && Date.now() - syncAt < SYNC_AGAIN_MS)) return;
  syncing = true;
  let saw = false, changed = 0;
  try {
    for (let i = 0; i < 500 && current(r); i++) {
      let step;
      try { step = await odSync(rt); }
      catch (error) { const wait = odSyncDelay(error); if (wait === null) throw error; saw = true; await new Promise(ok => setTimeout(ok, wait)); continue; }
      if (step.more || step.indexing) { if (!saw && current(r)) noteEl.innerHTML = waitInlineHtml(); saw = true; }
      changed += step.changed || 0;
      if (!step.more) { syncAt = Date.now(); break; }
    }
    if (current(r) && (saw || changed)) { note(''); resetList(); calData.clear(); render(); }
  } catch (error) { if (current(r)) note(`사진 목록을 다 받지 못했어요: ${odErrorText(error)}`); }
  finally { syncing = false; }
}
// 켜진 출처의 지금까지 받은 것을 섞는다(지우는 중인 칸은 뺌).
function streamsNow() {
  const u = useSrc(), out = [];
  if (u.onedrive) out.push({source:'onedrive', items:odList, ended:odEnded});
  if (u.phone) out.push({source:'phone', items:phList, ended:phEnded});
  if (u.gdrive && gdFilterOk()) out.push({source:'gdrive', items:gdItems, ended:gdEnded});
  return out;
}
function remerge() {
  const st = streamsNow();
  const m = mergeSources(st, listSort());
  items = m.items.filter(it => !hidden.has(it.id)); ended = m.ended;
  return {...m, streams:st};
}
// 한 출처의 다음 쪽.
async function loadStream(source, r) {
  if (source === 'onedrive') {
    const page = await odLibrary(rt, {filter, cursor:next || from?.cursor || null, limit:PAGE_SIZE, sort:listSort()});
    if (!current(r)) return;
    odList = appendItems(odList, page.items.map(toItem)); next = page.next; odEnded = !page.next;
    return;
  }
  if (source === 'gdrive') {
    // 서버는 찍은 날 최근 먼저만 준다. 다른 정렬이면 켠 폴더 사진을 모두(300장씩, 30쪽까지) 받아 이 화면에서 정렬한다.
    const all = listSort() !== DEFAULT_SORT;
    for (let guard = 0; guard < (all ? 30 : 1); guard++) {
      const page = await gdList(rt, {before:gdCursor || (from ? gdriveFrom(from.cursor.t) : null), limit:all ? 300 : PAGE_SIZE});
      if (!current(r)) return;
      const got = (Array.isArray(page?.items) ? page.items : []).map(gdriveToItem).filter(Boolean);
      if (got.length) gdCursor = gdriveBefore(got[got.length - 1]);
      gdItems = appendItems(gdItems, filter === 'video' ? got.filter(x => x.video) : got);
      gdEnded = page?.more !== true || !got.length;
      if (gdEnded) break;
    }
    if (all) { gdItems = gdItems.slice().sort(sortCompare(listSort())); gdEnded = true; }
    return;
  }
  const page = await phone.page({sort:listSort(), filter, offset:phNext, limit:PAGE_SIZE, before:from ? Date.parse(from.cursor.t) : null, ...hideArg()});
  if (!current(r)) return;
  phList = appendItems(phList, page.items); phNext = page.next ?? phNext; phEnded = page.next === null;
}
// 다음 쪽. ★는 별표 id(500개씩)로 모두 받아 최신순으로 합친다(별표는 많지 않다).
// 출처가 둘이면 앞을 막는 출처(아직 덜 받은 쪽)부터 한 쪽씩, 보일 칸이 늘 때까지(4쪽까지) 받는다.
function loadMore() {
  if (tidyView && !loading) { if (tidyFill()) { if (tab === 'all') paintList({full:true}); return null; } resetList(); }
  if (loading || ended || !anyUse()) return loading;
  const r = run;
  loading = (async () => {
    let src = 'onedrive';
    try {
      const u = useSrc();
      if (filter === 'star') {
        await ensureStars(r);
        if (u.onedrive && !odEnded) {
          const all = [];
          for (const ids of chunks(starIds(), STAR_CHUNK)) {
            let cursor = from?.cursor || null;
            for (let guard = 0; guard < 50; guard++) {
              const page = await odLibrary(rt, {filter:'star', starIds:ids, cursor, limit:200, sort:listSort()});
              if (!current(r)) return;
              all.push(...page.items); cursor = page.next;
              if (!cursor) break;
            }
          }
          odList = appendItems(odList, all.map(toItem).sort(sortCompare(listSort()))); odEnded = true;
        }
        if (u.phone && !phEnded) {
          src = 'phone';
          const list = await phoneStarList(r);
          if (!current(r)) return;
          const before = from ? Date.parse(from.cursor.t) : null;
          phList = list.filter(it => !before || Date.parse(it.taken_at) < before); phEnded = true;
        }
        remerge();
      } else {
        for (let guard = 0; guard < 4; guard++) {
          const shown = items.length, m = remerge();
          if (m.ended) break;
          src = m.streams[m.waiting[0]].source;
          await loadStream(src, r);
          if (!current(r)) return;
          if (remerge().items.length > shown) break;
        }
      }
      failed = '';
    } catch (error) {
      if (!current(r)) return;
      if (src === 'phone' || error?.phone) failed = phoneErrorText(error);
      else if (src === 'gdrive') { if (gdProblemFrom(error)) { remerge(); failed = ''; } else failed = gdriveErrorText(error); }
      else { failed = odErrorText(error); odFault = true; paintOdLink(linkBtn, od, odFault); }
    } finally { if (current(r)) loading = null; }
    if (current(r) && tab === 'all') { paintList(); loadBar(r); }
  })();
  return loading;
}
// 빠른 이동 막대의 달 눈금(거르기마다 한 번).
async function loadBar(r) {
  const want = filter, u = useSrc();
  if (monthsFor === want) return;
  monthsFor = want;
  try {
    if (want === 'star') await ensureStars(r);
    const parts = [];
    if (u.onedrive) {
      const ids = want === 'star' ? starIds() : null;
      if (ids && ids.length > STAR_CHUNK) { bar = []; paintRail(); return; }
      if (!ids || ids.length) parts.push((await odMonths(rt, {filter:want, starIds:ids})).months);
    }
    if (u.phone) {
      if (want === 'star') { const m = {}; for (const it of await phoneStarList(r)) m[it.day.slice(0, 7)] = (m[it.day.slice(0, 7)] || 0) + 1; parts.push(m); }
      else parts.push(await phone.months(want, hideArg()));
    }
    if (!current(r) || filter !== want) return;
    bar = monthBar(mergeMonths(...parts)); paintRail();
  } catch { if (current(r) && filter === want) { monthsFor = ''; bar = []; paintRail(); } }
}

// ---- 그리기 ----
function gate() {
  if (!odReady) return waitHtml({rows:4, h:72});
  if (od.failed) return '<p class="photos-muted">원드라이브 상태를 읽지 못했어요. <button type="button" class="mini" data-photos-retry>다시</button></p>';
  if (!od.configured || !od.connected) return `<p class="photos-muted">원드라이브 연결 뒤 쓸 수 있어요${od.configured ? ' <button type="button" class="mini" data-photos-connect>연결</button>' : ''}</p>`;
  if (!od.folder) return '<p class="photos-muted">사진을 읽을 폴더를 고른 뒤 쓸 수 있어요 <button type="button" class="mini" data-photos-folder>폴더 고르기</button></p>';
  return '';
}
// [사진]·[달력]: 켜진 출처 중 하나라도 읽을 수 있으면 막지 않는다.
const phoneAskHtml = () => '<p class="photos-muted">폰 사진을 보려면 처음 한 번 허용이 필요해요 <button type="button" class="mini" data-photos-phone-ask>사진 접근 허용</button></p>';
function listGate() {
  if (anyUse()) return '';
  if (noSource()) return NO_SOURCE_HTML;
  if (!odReady) return waitHtml({rows:4, h:72});
  const gdLine = gdNoteHtml();
  if (sources.phone && phone.available() && !phoneUsable() && (!sources.onedrive || !ready())) return gdLine + phoneAskHtml() + (sources.onedrive ? gate() : '');
  if (sources.onedrive) return gdLine + gate();
  return gdLine || NO_SOURCE_HTML;
}
// 목록 위 짧은 안내(한 출처만 못 읽을 때).
function srcNotes() {
  const out = [];
  if (sources.phone && phone.available() && !phoneUsable() && ready() && sources.onedrive) out.push(phoneAskHtml());
  else if (sources.phone && phoneUsable() && phone.state().access === 'partial') out.push('<p class="photos-muted photos-top">폰 사진은 고른 것만 보여요 <button type="button" class="mini" data-photos-phone-ask>더 고르기</button></p>');
  if (sources.onedrive && odReady && !ready() && (useSrc().phone || useSrc().gdrive)) out.push(gate());
  out.push(gdNoteHtml());
  return out.join('');
}
const cellLabel = (item, on) => `${dayHead(item.day)} ${item.video ? '동영상' : '사진'}${on ? ', 별표' : ''}${marks() && item.source !== 'onedrive' ? `, ${SOURCE_TEXT[item.source]}` : ''}`;
const photoEl = (item, size, opts = {}) => (item.kind === 'phone' ? phone.element(item, size, opts)
  : item.kind === 'gdrive' ? gdPhotoElement(item, size, {...opts, rt, owner}) : odPhotoElement(item, size, {...opts, rt}));
function cell(item, i) {
  const on = isStarred(item);
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'diary-grid-item'; b.dataset.photosOpen = String(i); b.dataset.photosId = item.id;
  b.setAttribute('aria-label', cellLabel(item, on));
  b.append(photoEl(item, 'small', {label:''}));
  const mark = document.createElement('span'); mark.className = 'diary-star-mark'; mark.setAttribute('aria-hidden', 'true'); mark.textContent = '★'; mark.hidden = !on;
  const pick = document.createElement('span'); pick.className = 'photos-pick'; pick.setAttribute('aria-hidden', 'true');
  b.append(mark, pick);
  if (item.video) b.append(Object.assign(document.createElement('span'), {className:'photos-dur', textContent:`▶${durationLabel(item.duration_ms) ? ' ' + durationLabel(item.duration_ms) : ''}`}));
  if (marks()) { const m = document.createElement('span'); m.className = 'photos-src-mark'; m.dataset.src = item.source; m.setAttribute('aria-hidden', 'true'); m.innerHTML = MARK_SVG[item.source] || ''; b.append(m); b.classList.add('has-src'); }
  return b;
}
function newGrid() {
  const grid = document.createElement('div');
  grid.className = 'diary-grid photos-grid'; grid.dataset.diaryGrid = '';
  sizer.paintGrid(grid); sizer.attachPinch(grid, sizeChanged);
  return grid;
}
function dayHeadEl(day, n) {
  const head = document.createElement('div');
  head.className = 'photos-day'; head.dataset.photosDay = day;
  head.innerHTML = `<b>${esc(dayHead(day))}</b><span data-photos-day-n>· ${n}장</span><button type="button" class="photos-day-pick" data-photos-day-pick="${esc(day)}" aria-label="${esc(dayHead(day))} 모두 고르기" hidden></button>`;
  return head;
}
// [사진] 목록 그리기. 처음이거나 목록이 줄었으면 통째로, 늘었으면 뒤에 이어 붙인다(받은 그림 그대로).
function paintList({full = false} = {}) {
  const g = listGate();
  if (g) { rendered = 0; renderedIds = []; body.innerHTML = g; paintRail(); return; }
  let list = body.querySelector('[data-photos-list]');
  // 앞에 그린 칸이 그대로인지(출처가 늦게 보낸 같은 사진을 빼면 앞이 바뀔 수 있다 → 통째로 다시).
  const same = rendered <= items.length && renderedIds.every((id, k) => items[k]?.id === id);
  if (full || !list || !same) {
    rendered = 0;
    const tv = tidyView ? `<p class="photos-muted photos-top" data-photos-tidy-top>정리 · ${esc(tidy.label(tidyView))} ${items.length}장 보는 중 · <button type="button" class="mini" data-photos-tidy-end>전체로</button></p>` : '';
    const top = srcNotes() + tv + (from ? `<p class="photos-muted photos-top">${esc(from.label)}부터 보는 중 · <button type="button" class="mini" data-photos-newest>최신으로</button></p>` : '');
    body.innerHTML = `${top}<div data-photos-list></div><p class="photos-muted photos-foot" data-photos-foot></p>`;
    list = body.querySelector('[data-photos-list]');
  }
  const counts = new Map();
  for (const it of items) counts.set(it.day, (counts.get(it.day) || 0) + 1);
  let i = rendered;
  if (sortByDay(listSort())) {
    for (const group of groupByDay(items.slice(rendered))) {
      const lastHead = list.lastElementChild?.previousElementSibling;
      let grid;
      if (lastHead?.dataset.photosDay === group.day) grid = list.lastElementChild;
      else { list.append(dayHeadEl(group.day, 0)); grid = newGrid(); list.append(grid); }
      for (const item of group.items) grid.append(cell(item, i++));
    }
  } else {
    // 찍은 날이 아닌 기준: 날짜 머리줄 없이 한 격자
    let grid = list.lastElementChild;
    if (!grid?.matches?.('[data-diary-grid]')) { grid = newGrid(); list.append(grid); }
    for (const item of items.slice(rendered)) grid.append(cell(item, i++));
  }
  rendered = items.length; renderedIds = items.map(x => x.id);
  list.querySelectorAll('[data-photos-day]').forEach(h => { const n = h.querySelector('[data-photos-day-n]'); if (n) n.textContent = `· ${counts.get(h.dataset.photosDay) || 0}장`; });
  const foot = body.querySelector('[data-photos-foot]');
  foot.innerHTML = failed ? failHtml({retry: 'data-photos-more', reason: failed})
    : ended ? (items.length ? '' : filter === 'all' ? '사진이 없어요.' : `${FILTER_TEXT[filter]} 사진이 없어요.`) : waitHtml({rows:2, h:72});
  paintSize(); paintSelect(); paintRail();
  watchFoot(foot);
}
let io = null;
function watchFoot(foot) {
  io?.disconnect();
  if (ended || failed || tab !== 'all') return;
  if (!('IntersectionObserver' in window)) { loadMore(); return; }
  io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) loadMore(); }, {rootMargin:'600px 0px'});
  io.observe(foot);
}
async function renderCalendar() {
  io?.disconnect();
  const g = listGate();
  if (g) { body.innerHTML = g; return; }
  calCursor ||= thisMonth();
  const ym = calCursor, r = run, key = monthKey(ym.year, ym.month), want = filter;
  const headHtml = `<div class="photos-cal-head"><button type="button" class="mini" data-photos-cal="-1" aria-label="이전 달">‹</button><b>${ym.year}년 ${ym.month + 1}월</b><button type="button" class="mini" data-photos-cal="1" aria-label="다음 달">›</button></div>`
    + (useSrc().gdrive ? '<p class="photos-muted photos-top" data-photos-gd-cal>구글 드라이브 사진은 달력에 아직 안 나와요</p>' : '');
  const u = useSrc(), cacheKey = `${want}:${key}:${u.onedrive ? 'o' : ''}${u.phone ? 'p' : ''}`;
  let days = calData.get(cacheKey);
  if (!days) {
    body.innerHTML = `${headHtml}${waitHtml({rows:4, h:72})}`;
    try {
      await ensureStars(r);
      // 대표 사진은 별표한 것 먼저: 그 달 별표 id만 보낸다(500개까지).
      let odD = {}, phD = {};
      if (u.onedrive) {
        const ids = starIds().filter(id => (starDay.get(id) || '').startsWith(key + '-')).slice(0, STAR_CHUNK);
        if (!(want === 'star' && !ids.length)) odD = (await odDays(rt, key, {filter:want, starIds:ids.length || want === 'star' ? ids : null})).days;
      }
      if (u.phone) {
        if (want === 'star') phD = daysFromItems(await phoneStarList(r), key);
        else phD = await phone.days(key, {filter:want, prefer:phoneStarIds(), ...hideArg()});
      }
      days = mergeDays(odD, phD);
      calData.set(cacheKey, days);
    } catch (error) { if (current(r) && tab === 'calendar' && calCursor === ym) body.innerHTML = `${headHtml}<p class="photos-muted">사진을 읽지 못했어요: ${esc(readErrorText(error))}</p>`; return; }
    if (!current(r) || tab !== 'calendar' || calCursor !== ym || filter !== want) return;
  }
  const {lead, cells} = calendarFromDays(ym, days), today = seoulDateKey(new Date());
  const grid = document.createElement('div');
  grid.className = 'photos-cal';
  for (const w of ['일', '월', '화', '수', '목', '금', '토']) grid.append(Object.assign(document.createElement('span'), {className:'photos-cal-w', textContent:w}));
  for (let k = 0; k < lead; k++) grid.append(Object.assign(document.createElement('span'), {className:'photos-cal-cell is-blank'}));
  for (const c of cells) {
    const el = document.createElement(c.count ? 'button' : 'span');
    el.className = c.day === today ? 'photos-cal-cell ds-today ds-today-sm' : 'photos-cal-cell';
    if (c.count) { el.type = 'button'; el.dataset.photosCalDay = c.day; el.setAttribute('aria-label', `${dayHead(c.day)}, 사진 ${c.count}장`); el.append(photoEl(c.rep, 'small', {label:'', retry:false})); }
    el.append(Object.assign(document.createElement('span'), {className:c.day === today ? 'photos-cal-n ds-today-num' : 'photos-cal-n', textContent:String(c.n)}));
    if (c.count) el.append(Object.assign(document.createElement('span'), {className:'photos-cal-c', textContent:String(c.count)}));
    grid.append(el);
  }
  body.innerHTML = headHtml; body.append(grid);
}
// [휴지통]: Web2에서 지운 사진. 열 때마다 서버가 30일 지난 것을 조금씩 원드라이브 휴지통으로 보낸다.
async function renderTrash({reload = false} = {}) {
  io?.disconnect();
  // PHOTO-출처모든칩: 원드라이브가 꺼지면 원드라이브 휴지통을 보이지 않는다. 폰 휴지통은 다루지 않고 안내 한 줄.
  if (noSource()) { body.innerHTML = NO_SOURCE_HTML; return; }
  const phoneLine = phoneOn() ? '<p class="photos-muted photos-top" data-photos-phone-trash>폰 휴지통은 갤러리 앱에서</p>' : '';
  if (!sources.onedrive) { body.innerHTML = phoneLine; paintSelect(); return; }
  const g = gate();
  if (g) { body.innerHTML = phoneLine + g; return; }
  const r = run;
  if (!trash || reload) {
    body.innerHTML = waitHtml({rows:4, h:72});
    try { trash = (await odTrashList(rt)).items.map(p => ({...toItem(p), trashed_at:p.trashed_at, purge_at:p.purge_at})); trashFailed = ''; }
    catch (error) { if (!current(r)) return; trash = null; trashFailed = odErrorText(error); }
    if (!current(r) || tab !== 'trash') return;
  }
  if (!trash) { body.innerHTML = `${phoneLine}<p class="photos-muted">휴지통을 읽지 못했어요: ${esc(trashFailed)} <button type="button" class="mini" data-photos-trash-retry>다시</button></p>`; return; }
  body.innerHTML = `${phoneLine}<p class="photos-muted photos-top">30일 뒤 원드라이브 휴지통으로 가요${trash.length ? ' · <button type="button" class="mini" data-photos-purge-all>모두 비우기</button>' : ''}</p>${trash.length ? '' : emptyHtml()}`;
  if (trash.length) { const grid = newGrid(); trash.forEach((item, i) => { const b = cell(item, i); b.dataset.photosTrash = ''; grid.append(b); }); body.append(grid); }
  paintSize(); paintSelect();
}
function render() {
  paintTidy();
  root.querySelectorAll('[data-photos-tab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.photosTab === tab)));
  paintTools(); paintSortButton();
  paintOd();
  if (tab === 'calendar') { select.stop(); paintSelect(); paintRail(); renderCalendar(); return; }
  if (tab === 'trash') { paintRail(); renderTrash(); return; }
  if (tab === 'folders') { paintRail(); renderFolders(); return; }
  if (tab === 'albums') { paintRail(); renderAlbums(); return; }
  paintList({full:true});
  if (!listGate() && !items.length && !ended) loadMore();
}
// PHOTO-위쪽두줄앨범보기(요청함 10/31 16:18): 위쪽 둘째 줄 = [정리][거르기][정렬][－＋] … 출처. [앨범] 탭(목록)은 정렬 [－＋] … [+ 새 앨범].
// 칸은 늘 같은 줄 하나에 있고 탭마다 보이기만 바꾼다(높이는 CSS가 고정). 앨범 목록에서 [－＋]는 사진 칸 수 대신 앨범 보기 크기 세 단계.
const albumSizing = () => tab === 'albums' && !album;
function paintTools() {
  $('[data-photos-filter]').hidden = tab !== 'all' && tab !== 'calendar';
  root.querySelector('.photo-size').hidden = tab === 'calendar';
  $('[data-photos-sort]').hidden = tab === 'calendar' || tab === 'trash';
  root.querySelector('.photos-srcs').hidden = tab === 'albums';
  $('[data-photos-al-new]').hidden = !albumSizing();
  paintSize();
}
const SIZE_LABEL = {'-1':['사진 작게(한 줄 칸 늘리기)', '앨범 작게 보기'], '1':['사진 크게(한 줄 칸 줄이기)', '앨범 크게 보기']};
function paintSize() {
  if (!albumSizing()) {
    root.querySelectorAll('[data-photo-size]').forEach(b => b.setAttribute('aria-label', SIZE_LABEL[b.dataset.photoSize]?.[0] || ''));
    sizer.paintButtons(root); return;
  }
  const v = albumView();
  root.querySelectorAll('[data-photo-size]').forEach(b => {
    b.disabled = stepAlbumView(v, Number(b.dataset.photoSize)) === v;
    b.title = `앨범 보기: ${ALBUM_VIEW_TEXT[v]}`;
    b.setAttribute('aria-label', SIZE_LABEL[b.dataset.photoSize]?.[1] || '');
  });
}
// 앨범 보기 단계: 서버 view_prefs.album_view(폰·컴퓨터 같음). 서버가 아직 칸을 모르면(DB 적용 전) 쓰기가 거절되어도 이번 접속 동안은 고른 단계(메모리만, 기기 저장 없음).
let albumViewChosen = null;
const albumView = () => albumViewChosen || validAlbumView(viewPrefs.get('album_view'));
function changeAlbumView(dir) {
  const v = albumView(), next = stepAlbumView(v, dir);
  if (next === v) return;
  albumViewChosen = next; viewPrefs.set('album_view', next, {rejectable:true});
  renderAlbums();
}
function sizeChanged() { root.querySelectorAll('[data-diary-grid]').forEach(sizer.paintGrid); paintSize(); }
globalThis.matchMedia?.(WIDE_QUERY)?.addEventListener?.('change', () => paintSize());
const listFor = t => (t === 'trash' ? trash || [] : t === 'folders' ? (gdAt !== null ? gdFItems : pAt !== null ? pItems : fItems) : t === 'albums' ? aItems : items);
const shownList = () => listFor(tab);
function setListFor(t, list) {
  if (t === 'folders') { if (gdAt !== null) gdFItems = list; else if (pAt !== null) pItems = list; else fItems = list; } else if (t === 'albums') aItems = list; else if (t === 'trash') trash = list;
  else {
    // [사진]: 빠진 칸은 hidden에 두어 다음 섞기에서도 빠지게, 돌아온 칸은 hidden에서 뺀다.
    const keep = new Set(list.map(x => x.id));
    for (const it of items) if (!keep.has(it.id)) hidden.add(it.id);
    for (const id of keep) hidden.delete(id);
    items = list;
  }
}
// 지금 보기의 사진 격자를 다시 그린다(지우기·옮기기·되돌리기 뒤).
function repaintShown() { if (tab === 'folders') { if (gdAt !== null) paintGdFolderGrid(); else paintFolderGrid(); } else if (tab === 'albums') renderAlbums(); else if (tab === 'trash') renderTrash(); else paintList({full:true}); }
function paintStars() {
  root.querySelectorAll('[data-photos-open]').forEach(b => {
    const item = shownList()[Number(b.dataset.photosOpen)]; if (!item) return;
    const on = isStarred(item), mark = b.querySelector('.diary-star-mark'); if (mark) mark.hidden = !on;
    b.setAttribute('aria-label', cellLabel(item, on));
  });
  photoStripRefresh();
}

// ---- 빠른 이동 막대(오른쪽 끝, [사진]에서 달이 둘 이상일 때) ----
function paintRail() {
  const on = tab === 'all' && anyUse() && bar.length > 1 && !select.active && listSort() === DEFAULT_SORT;
  rail.hidden = !on;
  if (!on) return;
  const top = items.length ? items[0].day.slice(0, 7) : (from ? from.cursor.t.slice(0, 7) : '');
  const at = bar.find(m => m.key === top) || bar[0];
  railAt(bar.indexOf(at));
}
// 막대 손잡이 자리와 읽어 주는 값(달 순서 0 = 최신 달).
function railAt(k) {
  const m = bar[k]; if (!m) return;
  thumb.style.top = `${Math.round(m.from * 1000) / 10}%`;
  rail.setAttribute('aria-valuemax', String(bar.length - 1)); rail.setAttribute('aria-valuenow', String(k)); rail.setAttribute('aria-valuetext', m.label);
}
let railDrag = null;
const railMonth = y => { const r = rail.getBoundingClientRect(); return monthAt(bar, (y - r.top) / Math.max(1, r.height)); };
function showBubble(m, y) {
  if (!m) return;
  const r = rail.getBoundingClientRect();
  bubble.hidden = false; bubble.textContent = m.label; bubble.style.top = `${Math.max(0, Math.min(r.height - 20, y - r.top - 10))}px`;
  rail.setAttribute('aria-valuetext', m.label);
}
rail.addEventListener('pointerdown', e => { e.preventDefault(); rail.setPointerCapture?.(e.pointerId); railDrag = railMonth(e.clientY); showBubble(railDrag, e.clientY); });
rail.addEventListener('pointermove', e => { if (!railDrag) return; railDrag = railMonth(e.clientY); showBubble(railDrag, e.clientY); });
const railEnd = () => { const m = railDrag; railDrag = null; bubble.hidden = true; if (m) jumpMonth(m.key); };
rail.addEventListener('pointerup', railEnd);
rail.addEventListener('pointercancel', () => { railDrag = null; bubble.hidden = true; });
rail.addEventListener('keydown', e => {
  if (!['ArrowUp', 'ArrowDown', 'Enter'].includes(e.key) || !bar.length) return;
  e.preventDefault();
  let k = Math.max(0, Math.min(bar.length - 1, Number(rail.getAttribute('aria-valuenow')) || 0));
  if (e.key === 'Enter') return jumpMonth(bar[k].key);
  k = Math.max(0, Math.min(bar.length - 1, k + (e.key === 'ArrowDown' ? 1 : -1)));
  railAt(k);
});
// 그 달(또는 그날)로: 이미 받은 목록에 있으면 거기로 스크롤, 없으면 그 자리부터 다시 받는다(위 줄 [최신으로]).
function jumpTo(prefix, cursor, label) {
  const find = () => body.querySelector(`[data-photos-day^="${CSS.escape(prefix)}"]`);
  const r = run;
  if (!find()) {
    select.stop(); from = {cursor, label}; clearLists(); failed = ''; rendered = 0;
    paintList({full:true});
    const p = loadMore();
    Promise.resolve(p).then(() => { if (current(r) && tab === 'all') requestAnimationFrame(() => (find() || body).scrollIntoView({block:'start'})); });
    return;
  }
  requestAnimationFrame(() => find()?.scrollIntoView({block:'start'}));
}
const jumpMonth = key => jumpTo(key, monthCursor(key), key.replace('-', '.'));

// ---- 별표 ----
async function setStar(item, on) {
  const k = starKey(item.source, item.key);
  if (starBusy.has(k) || isStarred(item) === on) return true;
  starBusy.add(k);
  if (on) { starSet.add(k); starDay.set(item.key, item.day); } else starSet.delete(k);
  try { if (on) await addStar({source:item.source, key:item.key, day:item.day}, rt); else await removeStar(item, rt); return true; }
  catch { if (on) starSet.delete(k); else starSet.add(k); return false; }
  finally { starBusy.delete(k); }
}
async function toggleStar(item) {
  if (!item) return;
  if (item.kind === 'gdrive') { photoStripNote('구글 드라이브 사진은 아직 별표를 못 해요.'); return; }
  const p = setStar(item, !isStarred(item));
  paintStars();
  if (!(await p)) { paintStars(); photoStripNote('별표를 저장하지 못했어요. 다시 눌러 주세요.'); }
}
const starsChanged = () => { if (filter === 'star') monthsFor = ''; calData.clear(); phStarItems = null; };

// ---- 크게 보기 ----
const whenText = item => `${dayHead(item.day)}${takenLabel(item) ? ' ' + takenLabel(item) : ''}`;
const takeOne = item => { const t0 = tab, t = takeItems(listFor(t0), [item.id]); if (!t.taken.length) return null; setListFor(t0, t.rest); repaintShown(); t.taken.tab = t0; return t.taken; };
const restoreTaken = taken => { const t0 = taken.tab || 'all'; setListFor(t0, putItems(listFor(t0), taken)); if (current(run) && tab === t0) repaintShown(); };
async function commitOne(taken, {keepalive = false} = {}) {
  const item = taken[0].item, id = item.id;
  // 폰 사진: 폰 휴지통으로(시스템 확인 창). 거절하면 칸이 돌아온다.
  if (item.kind === 'phone') { const res = await phone.trash([item]); if (!res.ok) throw new Error('phone_trash_refused'); return; }
  try { await odDelete(rt, id, {keepalive}); forgetOdPhoto(id); trash = null; }
  catch (error) { if (error?.message === 'onedrive_item_missing') { forgetOdPhoto(id); return; } throw error; }
}
// 원본 받기: 짧게 사는 주소로 브라우저가 바로 받는다(파일이 Web2 서버를 거치지 않음, 저장은 기기 받은 파일 폴더).
async function downloadOne(item) {
  if (item.kind === 'phone') { const text = '폰 사진은 이미 이 폰에 있어요.'; if (photoStripOpen()) photoStripNote(text); else notify(text); return true; }
  if (item.kind === 'gdrive') {
    // 서버를 거쳐 원본을 받아 메모리 주소로 내려받기(받은 뒤 바로 놓음).
    try {
      const url = URL.createObjectURL(await gdMediaBlob(rt, item.gdId));
      const a = Object.assign(document.createElement('a'), {href:url, download:item.name || 'photo'});
      a.hidden = true; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return true;
    } catch (error) {
      gdProblemFrom(error);
      const text = `원본을 받지 못했어요: ${gdriveErrorText(error)}`;
      if (photoStripOpen()) photoStripNote(text); else notify(text, {error:true});
      return false;
    }
  }
  try {
    const m = await odMediaUrl(rt, item.id, 'download');
    const a = Object.assign(document.createElement('a'), {href:m.url, rel:'noopener noreferrer', download:m.name || item.name || 'photo'});
    a.hidden = true; document.body.append(a); a.click(); a.remove();
    return true;
  } catch (error) {
    const text = `원본을 받지 못했어요: ${odErrorText(error)}`;
    if (photoStripOpen()) photoStripNote(text); else notify(text, {error:true});
    return false;
  }
}
function openViewer(index) {
  if (photoStripOpen()) return;
  const shown = tab;
  openPhotoStrip({host:root, list:() => listFor(shown), index, title:'사진', layerName:'photos-photo',
    element:(item, size, opts) => photoEl(item, size, opts), label:(item, i) => `${item.video ? '동영상' : '사진'} ${i + 1}`, when:whenText,
    info:item => [['찍은 때', whenText(item)], ['파일', item.name], ['크기', item.width && item.height ? `${item.width} × ${item.height}` : ''], ['길이', durationLabel(item.duration_ms)], ['출처', SOURCE_TEXT[item.source] || '원드라이브']],
    original:item => (item.kind === 'phone' ? {} : {download:true}), download:downloadOne,
    play:async item => (item.kind === 'phone' ? phone.mediaUrl(item) : item.kind === 'gdrive' ? gdPlay(item) : (await odMediaUrl(rt, item.id, 'play')).url), badge:item => durationLabel(item.duration_ms),
    isStarred, toggleStar:item => { starsChanged(); return toggleStar(item); },
    deletable:item => (item?.kind === 'phone' ? {ok:phone.state().trash, title:phone.state().trash ? '폰 휴지통으로' : '이 폰은 여기서 지우지 못해요'}
      : item?.kind === 'gdrive' ? {ok:false, title:'구글 드라이브 사진은 길게 눌러 고른 뒤 [지우기]로(확인 한 번)'}
      : {ok:od.canDelete, title:od.canDelete ? 'Web2 휴지통으로' : '지우려면 원드라이브를 다시 연결해 주세요'}),
    take:takeOne, restore:restoreTaken, commit:commitOne,
    errorText:error => (error?.message === 'phone_trash_refused' ? '폰에서 지우지 않았어요.' : `지우지 못했어요: ${odErrorText(error)}`), onError:note,
    onClose:({starChanged, restore}) => { if (starChanged && filter === 'star' && restore && shown === 'all') { setListFor('all', items.filter(isStarred)); paintList({full:true}); } }});
}

// 구글 드라이브 동영상: 서버를 거쳐 통째로 받아 메모리 주소로 튼다(앞 주소는 놓음, 기기 저장 없음).
async function gdPlay(item) {
  try {
    const url = URL.createObjectURL(await gdMediaBlob(rt, item.gdId));
    if (gdPlayUrl) URL.revokeObjectURL(gdPlayUrl);
    gdPlayUrl = url;
    return url;
  } catch (error) { gdProblemFrom(error); throw new Error(gdriveErrorText(error)); }
}

// ---- 여러 장 고르기 ----
const canShare = () => typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
function paintSelect() {
  const on = select.active && tab !== 'calendar', inTrash = tab === 'trash';
  $('[data-photos-sel]').hidden = !on; $('[data-photos-act]').hidden = !on || inTrash; $('[data-photos-trash-act]').hidden = !on || !inTrash;
  $('[data-photos-sel-count]').textContent = `${select.size}개 골랐음`;
  root.classList.toggle('is-selecting', on);
  const list = shownList();
  root.querySelectorAll('[data-photos-open]').forEach(b => {
    const item = list[Number(b.dataset.photosOpen)];
    const picked = on && !!item && select.has(item.id);
    b.classList.toggle('is-picked', picked);
    if (on) b.setAttribute('aria-pressed', String(picked)); else b.removeAttribute('aria-pressed');
  });
  root.querySelectorAll('[data-photos-day-pick]').forEach(b => {
    b.hidden = !on;
    const ids = items.filter(x => x.day === b.dataset.photosDayPick).map(x => x.id);
    b.setAttribute('aria-pressed', String(on && ids.length > 0 && ids.every(id => select.has(id))));
  });
  const none = !select.size;
  const canGd = x => x.kind === 'gdrive' && gdUsable();
  $('[data-photos-act-delete]').disabled = none || busy || !pickedItems().some(x => (x.kind === 'phone' ? phone.state().trash : x.kind === 'gdrive' ? canGd(x) : od.canDelete));
  const one = pickedItems(), ren = $('[data-photos-act-rename]');
  ren.hidden = !(on && one.length === 1 && one[0].kind === 'gdrive'); ren.disabled = busy || !gdUsable();
  $('[data-photos-act-star]').disabled = none; $('[data-photos-act-down]').disabled = none;
  // PC공유메뉴: 넓은 화면은 기기 공유 창이 없어도 [⇪ 공유] 메뉴(복사·정리함·다운로드)를 쓴다.
  const share = $('[data-photos-act-share]'); share.hidden = !canShare() && !wideShare(); share.disabled = none;
  $('[data-photos-act-move]').disabled = none || busy || !pickedItems().some(x => (x.kind === 'phone' ? phoneOps() : x.kind === 'gdrive' ? canGd(x) : od.canDelete)); $('[data-photos-act-tag]').disabled = none || busy;
  const untag = $('[data-photos-act-untag]'); untag.hidden = !(tab === 'albums' && album); untag.disabled = none || busy;
  $('[data-photos-restore]').disabled = none || !od.canDelete; $('[data-photos-purge]').disabled = none || !od.canDelete;
  if (rail) paintRail();
}
const pickedItems = () => shownList().filter(x => select.has(x.id));
function startSelect(item) { select.start([item.id], item.id); paintSelect(); }
async function starPicked() {
  const all = pickedItems(), can = all.filter(x => x.kind !== 'gdrive');
  if (!can.length) { notify('구글 드라이브 사진은 아직 별표를 못 해요.'); return; }
  if (can.length < all.length) notify('구글 드라이브 사진은 빼고 별표해요.');
  const plan = starPlan(can, isStarred);
  const results = await Promise.all(plan.items.map(item => setStar(item, plan.on)));
  paintStars(); starsChanged();
  const bad = results.filter(ok => !ok).length;
  notify(bad ? `별표를 ${bad}장 저장하지 못했어요.` : plan.on ? `${plan.items.length}장 별표했어요` : `${plan.items.length}장 별표를 풀었어요`, {error:!!bad});
  select.stop(); paintSelect();
  if (filter === 'star') { setListFor('all', items.filter(isStarred)); paintList({full:true}); }
}
// 여러 장 받기: 원본 주소를 하나씩 받아 차례로(한 번에 20장까지).
async function downloadPicked() {
  const picked = pickedItems(), list = picked.filter(x => x.kind !== 'phone'), some = list.slice(0, DOWNLOAD_MAX);
  if (!some.length) { if (picked.length) notify('폰 사진은 이미 이 폰에 있어요.'); return; }
  notify(`${some.length}장 받는 중…${list.length > some.length ? ` (한 번에 ${DOWNLOAD_MAX}장까지)` : ''}`);
  let bad = 0;
  for (const item of some) { if (!(await downloadOne(item))) bad++; await new Promise(ok => setTimeout(ok, 400)); }
  if (bad) notify(`${bad}장을 받지 못했어요.`, {error:true});
}
// 여러 장 공유: 큰 그림을 받아 기기 공유 창으로(동영상은 빼고, 20장까지). 받는 사이 누른 효력이 끝나면 한 번 더 누르게 한다(받은 것은 메모리에 그대로).
let shareReady = null;
// 고른 사진(동영상 빼고 20장까지)의 큰 그림 파일. 같은 묶음이면 받은 것을 다시 쓴다(메모리에만).
async function pickedFiles(list) {
  const key = list.map(x => x.id).join(',');
  if (shareReady?.key !== key) {
    notify('사진 받는 중…', {ms:30000});
    const files = [];
    for (const item of list) {
      try { const blob = item.kind === 'phone' ? await phone.blob(item, 'large') : item.kind === 'gdrive' ? await gdThumbBlob(rt, item.gdId, 'large') : await odPhotoBlob(rt, item.id, 'large'); const f = blob && photoFile(blob, shareFileName(item, blob.type)); if (f) files.push(f); } catch { /* 빠진 장은 아래에서 센다 */ }
    }
    shareReady = {key, files};
  }
  return shareReady.files;
}
// [⇪ 공유]: 넓은 화면은 누른 자리 작은 메뉴(share-menu.js — 한 장이면 [사진 복사]도), 좁은 화면은 지금처럼 기기 공유 창.
function shareButton(trigger) {
  const list = pickedItems().filter(x => !x.video).slice(0, SHARE_MAX);
  if (!list.length) { notify('공유할 사진이 없어요(동영상은 [⤓ 받기]로).'); return; }
  shareFrom(trigger, {count:list.length, getFiles:() => pickedFiles(list), native:canShare() ? sharePicked : null, download:downloadPicked});
}
async function sharePicked() {
  const list = pickedItems().filter(x => !x.video).slice(0, SHARE_MAX);
  if (!list.length) { notify('공유할 사진이 없어요(동영상은 [⤓ 받기]로).'); return; }
  const files = await pickedFiles(list);
  if (!files.length) { notify('사진을 받지 못했어요. 잠시 뒤 다시 해 주세요.', {error:true}); return; }
  if (!navigator.canShare?.({files})) { notify('이 기기는 여러 장 공유를 못 해요. [⤓ 받기]로 받아 주세요.'); return; }
  try { await navigator.share({files}); shareReady = null; notify(`${files.length}장을 넘겼어요`); }
  catch (error) {
    if (error?.name === 'NotAllowedError') notify('사진을 다 받았어요. [⇪ 공유]를 한 번 더 눌러 주세요.');
    else if (error?.name !== 'AbortError') notify('공유하지 못했어요.', {error:true});
  }
}
let batch = null;
async function commitBatch({keepalive = false} = {}) {
  const b = batch; if (!b) return;
  batch = null; clearTimeout(b.timer);
  const back = [];
  try {
    const res = await odDeleteMany(rt, b.taken.map(t => t.item.id), {keepalive});
    const bad = new Set(Object.keys(res.failed).filter(id => res.failed[id] !== 'missing'));
    for (const t of b.taken) { if (bad.has(t.item.id)) back.push(t); else forgetOdPhoto(t.item.id); }
    tidy.forget(b.taken.filter(t => !bad.has(t.item.id)).map(t => t.item.id));
  } catch { back.push(...b.taken); }
  trash = null;
  if (back.length) { setListFor(b.tab, putItems(listFor(b.tab), back)); if (current(b.run) && tab === b.tab) repaintShown(); notify(`${back.length}장을 지우지 못했어요.`, {error:true}); }
  else if (b.tab !== 'all') { resetList(); calData.clear(); tree = null; }
}
// 폰 사진: 바로 폰 휴지통 요청(시스템 확인 창이 확인 역할, 되돌리기 시간 없음). 허용하면 칸에서 뺀다.
async function trashPhonePicked(list) {
  const t0 = tab;
  const res = await phone.trash(list);
  if (!res.ok) { notify('폰에서 지우지 않았어요.', {error:!phone.state().trash}); return; }
  const t = takeItems(listFor(t0), list.map(x => x.id));
  setListFor(t0, t.rest); calData.clear(); monthsFor = '';
  tidy.forget(list.map(x => x.id));
  if (tab === t0) repaintShown();
  paintTidy();
  notify(`${t.taken.length}장을 폰 휴지통으로 옮겼어요`);
}
function deletePicked(anchor = null) {
  const all = pickedItems(), phonePart = all.filter(x => x.kind === 'phone'), gdPart = all.filter(x => x.kind === 'gdrive');
  if (gdPart.length) gdTrashPicked(anchor || $('[data-photos-act-delete]'), gdPart);
  if (phonePart.length) { select.stop(); paintSelect(); trashPhonePicked(phonePart.slice(0, SELECT_MAX)); }
  if (!od.canDelete) return;
  const picked = all.filter(x => x.kind !== 'phone' && x.kind !== 'gdrive'), ids = picked.slice(0, SELECT_MAX).map(x => x.id);
  if (!ids.length) return;
  if (batch) commitBatch();
  const t0 = tab, t = takeItems(listFor(t0), ids);
  setListFor(t0, t.rest);
  select.stop();
  repaintShown();
  const b = {taken:t.taken, run, tab:t0, timer:setTimeout(() => commitBatch(), UNDO_MS)};
  batch = b;
  const more = picked.length > ids.length ? ` (한 번에 ${SELECT_MAX}장까지)` : '';
  notify(`${t.taken.length}장을 휴지통으로 옮겼어요${more}`, {ms:UNDO_MS, record:false, undo:() => {
    if (batch !== b) return;
    batch = null; clearTimeout(b.timer); setListFor(b.tab, putItems(listFor(b.tab), b.taken)); if (current(b.run) && tab === b.tab) repaintShown();
  }});
}
window.addEventListener('pagehide', () => { if (batch) commitBatch({keepalive:true}); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && batch) commitBatch({keepalive:true}); });
// 휴지통: 되살리기·바로 지우기(원드라이브 휴지통으로, 작은 확인창 한 번).
async function trashRun(ids, act) {
  if (trashBusy || !ids.length) return;
  trashBusy = true;
  const done = [], bad = [];
  try {
    for (const part of chunks(ids, SELECT_MAX)) {
      try {
        const res = act === 'restore' ? await odTrashRestore(rt, part) : await odTrashPurge(rt, part);
        done.push(...(act === 'restore' ? res.restored : res.purged));
        bad.push(...Object.keys(res.failed));
      } catch { bad.push(...part); }
    }
  } finally { trashBusy = false; }
  const gone = new Set(done);
  if (trash) trash = trash.filter(x => !gone.has(x.id));
  if (act === 'restore' && done.length) { resetList(); calData.clear(); }
  else done.forEach(id => forgetOdPhoto(id));
  select.stop();
  if (tab === 'trash') renderTrash();
  notify(bad.length ? `${bad.length}장은 하지 못했어요.` : act === 'restore' ? `${done.length}장을 되살렸어요` : `${done.length}장을 원드라이브 휴지통으로 보냈어요`, {error:!!bad.length});
}
async function purgeAsk(anchor, ids) {
  if (!ids.length) return;
  if (!await askConfirm(anchor, {text:`${ids.length}장을 지금 원드라이브 휴지통으로 보낼까요?`, note:'원드라이브 휴지통에서 30일 더 꺼낼 수 있어요.', ok:'지우기', danger:true})) return;
  return trashRun(ids, 'purge');
}

// 길게 누르기(0.5초, 손가락이 10px 넘게 움직이면 취소)로 선택 모드를 켠다. 켠 뒤 바로 오는 누르기는 먹는다.
// 선택 모드에서 칸을 누른 채 좌우로 끌면 처음 칸부터 지금 칸까지 함께 고른다(위아래로 가면 화면 끝에서 저절로 넘어감).
// 두 번째 손가락이 닿으면(핀치) 꾹 누르기·끌어 고르기를 바로 취소하고, 손가락을 모두 뗄 때까지 다시 걸지 않는다(공용 지킴이 photo-grid-size.js).
let hold = null, ateClick = false, drag = null, rowHold = null; // rowHold: 폴더 줄·앨범 카드 꾹 누르기(아래)
const itemOf = b => shownList()[Number(b?.dataset.photosOpen)];
body.addEventListener('pointerdown', e => {
  ateClick = false;
  if (multiTouchActive()) return cancelGestures();
  const b = e.target.closest('[data-photos-open]'); if (!b || e.button > 0) return;
  const item = itemOf(b); if (!item) return;
  // [폴더] PC: 고른 사진을 잡으면 끌어 놓기(옮기기)이고 여러 칸 고르기 끌기가 아니다(dragstart가 맡음).
  if (select.active && tab === 'folders' && treeWide() && b.draggable && select.has(item.id)) return;
  if (select.active) { drag = {anchor:item.id, x:e.clientX, y:e.clientY, base:new Set(select.items), add:!select.has(item.id), on:false, id:e.pointerId}; return; }
  hold = {b, x:e.clientX, y:e.clientY, timer:setTimeout(() => { hold = null; ateClick = true; navigator.vibrate?.(15); startSelect(item); }, HOLD_MS)};
});
const cancelHold = () => { if (hold) { clearTimeout(hold.timer); hold = null; } };
// 핀치: 꾹 누르기·폴더 줄 꾹 누르기를 끄고, 이미 끌어 고르던 중이면 끌기 전 선택으로 되돌린다.
function cancelGestures() {
  cancelHold();
  if (rowHold) { clearTimeout(rowHold.timer); rowHold = null; }
  if (drag) { const was = drag; drag = null; stopAuto(); if (was.on) { select.items = new Set(was.base); paintSelect(); } }
}
onMultiTouch(cancelGestures);
let scrollTimer = null, lastY = 0;
const stopAuto = () => { clearInterval(scrollTimer); scrollTimer = null; };
function dragTo(x, y) {
  const el = document.elementFromPoint(x, y)?.closest?.('[data-photos-open]');
  const item = el && root.contains(el) ? itemOf(el) : null;
  if (!item) return;
  const span = dragRange(shownList().map(i => i.id), drag.anchor, item.id), next = new Set(drag.base);
  for (const id of span) { if (drag.add) next.add(id); else next.delete(id); }
  select.items = next; paintSelect();
}
body.addEventListener('pointermove', e => {
  if (drag && e.pointerId !== drag.id) return; // 끌어 고르기는 처음 손가락만 따라간다
  if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > HOLD_MOVE) cancelHold();
  if (!drag) return;
  if (!drag.on) {
    const dx = Math.abs(e.clientX - drag.x), dy = Math.abs(e.clientY - drag.y);
    if (dy > DRAG_START && dy > dx && e.pointerType !== 'mouse') { drag = null; return; } // 세로 = 넘기기
    if (Math.max(dx, dy) < DRAG_START) return;
    drag.on = true; body.setPointerCapture?.(e.pointerId);
  }
  e.preventDefault(); ateClick = true; lastY = e.clientY;
  dragTo(e.clientX, e.clientY);
  const h = window.innerHeight, dir = e.clientY < EDGE ? -1 : e.clientY > h - EDGE ? 1 : 0;
  if (dir && !scrollTimer) { const x = e.clientX; scrollTimer = setInterval(() => { if (!drag) return stopAuto(); window.scrollBy(0, dir * 24); dragTo(x, lastY); }, 50); }
  else if (!dir) stopAuto();
});
const endDrag = () => { drag = null; stopAuto(); cancelHold(); };
for (const t of ['pointerup', 'pointercancel']) body.addEventListener(t, endDrag);
body.addEventListener('pointerleave', cancelHold);
body.addEventListener('contextmenu', e => {
  const b = e.target.closest('[data-photos-open]'); if (!b) return;
  e.preventDefault();
  // PC 우클릭 = 사진 메뉴(맨 위 [선택]). 폰 꾹 누르기는 위의 길게 누르기(여러 장 고르기)가 맡는다. 휴지통 사진은 메뉴 없음.
  if (e.pointerType === 'touch' || hold || tab === 'trash' || !globalThis.matchMedia?.(WIDE_QUERY)?.matches) return;
  window.KPTUContextMenu?.pinAt?.(b, e.clientX, e.clientY);
  photoMenu.open(b);
});

// ---- 원드라이브 아이콘·설정 창(공용 부품, 이 화면 안에서) ----
function paintOd() {
  odHost.innerHTML = settings.html();
  odHost.querySelectorAll('button').forEach(b => { b.disabled = settings.busy; });
  const modalNote = odHost.querySelector('[data-od-modal-note]');
  if (modalNote) modalNote.textContent = odMessage; else if (odMessage) note(odMessage);
}
function afterOdChange() { resetList(); trash = null; calData.clear(); syncAt = 0; tree = null; at = null; fFor = null; fItems = []; aFor = null; ensureOd(true).then(() => { render(); startSync(run); }); }
const settings = createOdSettings({rt, layerName:'photos-od', back:'photos', od:() => od, refresh:force => ensureOd(force), paint:paintOd,
  message:text => { odMessage = text; }, fault:() => { odFault = true; paintOdLink(linkBtn, od, odFault); }, reload:afterOdChange});
const linkMenu = createOdLinkMenu({id:'photosOdMenu', historyKey:'kptuPhotosOdMenu', label:'원드라이브',
  model:() => ({od, fault:odFault, message:odFault ? (failed || odMessage) : '', show:viewPrefs.get('diary_onedrive') !== false}), onAction:linkAct});
function linkAct(act) {
  if (act === 'connect' || act === 'reconnect') return settings.connect();
  if (act === 'retry') { odFault = false; return ensureOd(true).then(() => { resetList(); render(); }); }
  if (act === 'show') { viewPrefs.set('diary_onedrive', viewPrefs.get('diary_onedrive') === false, {rejectable:true}); return; }
  if (act === 'folder') return settings.run(settings.startBrowse);
  if (act === 'subfolders') return settings.open ? undefined : settings.run(settings.openTree);
  if (act === 'disconnect') return settings.disconnect();
}

// ---- 이름 넣기 줄(새 폴더·이름 바꾸기·새 앨범): 칩 줄 아래 한 줄. Enter = 저장, Esc·[취소] = 그만. ----
const nameForm = $('[data-photos-name]'), nameInput = $('[data-photos-name-input]');
let nameWait = null;
function askName(label, value = '') {
  nameDone(null);
  $('[data-photos-name-label]').textContent = label;
  nameInput.value = value; nameForm.hidden = false;
  requestAnimationFrame(() => { nameInput.focus(); nameInput.select(); });
  return new Promise(ok => { nameWait = ok; });
}
function nameDone(value) {
  const w = nameWait; nameWait = null; nameForm.hidden = true;
  if (w) w(value);
}
nameForm.addEventListener('submit', e => { e.preventDefault(); nameDone(nameInput.value); });
nameInput.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); nameDone(null); } });
const folderFail = (error, fallback) => notify(folderErrorText(error?.message) || `${fallback}: ${odErrorText(error)}`, {error:true});

// ---- [폴더] ----
function loadTree(force = false) {
  if (treeLoading) return treeLoading;
  if (tree && !force) return Promise.resolve(tree);
  const r = run;
  treeLoading = odFolderTree(rt).then(t => { if (current(r)) { tree = t; treeFailed = ''; } return t; },
    error => { if (current(r)) treeFailed = odErrorText(error); return null; }).finally(() => { treeLoading = null; });
  return treeLoading;
}
// 그 폴더 바로 안 사진(서버 library folder_id, 120장씩). 다른 폴더로 가면 받던 쪽은 버린다(token).
let fToken = null;
function loadFolder(id) {
  if (fFor === id && (fLoading || fEnded)) return fLoading;
  if (fFor !== id) { fFor = id; fItems = []; fNext = null; fEnded = false; fFailed = ''; }
  const r = run, token = {};
  fToken = token;
  fLoading = (async () => {
    try {
      const page = await odLibrary(rt, {folderId:id, cursor:fNext, limit:PAGE_SIZE, sort});
      if (!current(r) || fToken !== token) return;
      fItems = appendItems(fItems, page.items.map(toItem)); fNext = page.next; fEnded = !page.next; fFailed = '';
    } catch (error) { if (current(r) && fToken === token) fFailed = odErrorText(error); }
    finally { if (fToken === token) fLoading = null; }
    if (current(r) && fToken === token && tab === 'folders' && at === id) paintFolderGrid();
  })();
  return fLoading;
}
// PHOTO-폴더스위치(요청함 10/31 11:04, 시안 확정): 폴더 줄 [📁 이름 · (같은 이름이면 위치) | 장수 | 스위치]. 켜짐(색 칠함) = 그 폴더 사진이
// [사진]·[달력]·앨범·★ 어디에나 보임, 꺼짐(색 없음, 줄 흐림) = 어디에도 안 보임. 이름을 누르면 지금처럼 폴더 안으로. 상태는 서버(app_onedrive_folders.enabled).
// 스위치는 원드라이브 전체 보기(tree.whole, 서버 새 판)일 때만. 같은 이름 위치 이름은 renderFolders가 places에 둔다.
let places = new Map();
const placeHtml = id => (places.has(id) ? `<span class="photos-fx-place"> · ${esc(places.get(id))}</span>` : '');
const switchHtml = (id, name, on) => `<button type="button" role="switch" class="diary-od-switch photos-fx-sw" data-photos-fx-sw="${esc(id)}" aria-checked="${on ? 'true' : 'false'}" aria-label="${esc(name)} 사진에 보이기"></button>`;
function folderRowHtml(r, {wide}) {
  const cur = r.id === at, tog = wide && r.kids && !r.top, sw = !!tree?.whole, on = r.enabled !== false;
  return `<div class="nx-row nx-folder photos-fx-row${cur && wide ? ' nx-current' : ''}${sw && !on ? ' is-off' : ''}" data-photos-folder="${esc(r.id)}" style="--nx-indent:${r.indent}"${wide ? ' role="treeitem"' : ''}${wide && r.kids ? ` aria-expanded="${r.open}"` : ''}>`
    + (wide ? (tog ? `<button type="button" class="photos-fx-tog" data-photos-fx-tog="${esc(r.id)}" aria-label="${esc(r.name)} ${r.open ? '접기' : '펼치기'}">${r.open ? '▾' : '▸'}</button>` : '<span class="photos-fx-tog" aria-hidden="true"></span>') : '')
    + `<button type="button" class="nx-main" data-photos-fx-open="${esc(r.id)}"${cur && wide ? ' aria-current="true"' : ''}><span class="nx-ico" aria-hidden="true">${(r.open && r.kids) || (cur && wide) ? '\u{1F4C2}' : '\u{1F4C1}'}</span><span class="nx-name">${esc(r.name)}${placeHtml(r.id)}</span><span class="nx-num" aria-label="사진 ${r.total}장">${r.total}</span></button>`
    + (sw ? switchHtml(r.id, r.name, on) : '')
    + `<button type="button" class="nx-more photos-fx-more" data-photos-fx-more="${esc(r.id)}" aria-label="${esc(r.name)} 폴더 메뉴" aria-haspopup="true" aria-expanded="false"><span class="more-dots" aria-hidden="true">⋯</span></button></div>`;
}
const newFolderHtml = () => (od.canDelete ? '<button type="button" class="nx-new-folder photos-fx-new" data-photos-fx-new>+ 새 폴더</button>' : '');
// ---- [폴더] 폰 묶음(PHOTO-출처모든칩): 사진첩 폴더(relative_path) 목록과 그 폴더 사진. 보기 전용, 서버로 보내거나 기기에 저장하지 않음. ----
function loadPhoneFolders(force = false) {
  if (pFoldersLoading) return pFoldersLoading;
  if (pFolders !== null && !force) return Promise.resolve(pFolders);
  const r = run;
  pFoldersLoading = phone.folders().then(list => { if (current(r)) { pFolders = list === null ? false : list; pFoldersFailed = ''; if (list) pPending = pPending.filter(x => !list.some(f => f.id === x.id)); } return pFolders; },
    error => { if (current(r)) pFoldersFailed = phoneErrorText(error); return null; }).finally(() => { pFoldersLoading = null; });
  return pFoldersLoading;
}
let pToken = null;
function loadPhoneFolder(id) {
  if (pFor === id && (pLoading || pEnded)) return pLoading;
  if (pFor !== id) { pFor = id; pItems = []; pNext = 0; pEnded = false; pFailed = ''; }
  const r = run, token = {};
  pToken = token;
  pLoading = (async () => {
    try {
      const page = await phone.page({sort, filter:'all', offset:pNext, limit:PAGE_SIZE, folder:id});
      if (!current(r) || pToken !== token) return;
      pItems = appendItems(pItems, page.items); pNext = page.next ?? pNext; pEnded = page.next === null; pFailed = '';
    } catch (error) { if (current(r) && pToken === token) pFailed = phoneErrorText(error); }
    finally { if (pToken === token) pLoading = null; }
    if (current(r) && pToken === token && tab === 'folders' && pAt === id) paintPhoneFolderGrid();
  })();
  return pLoading;
}
// 폰 폴더 + 아직 사진을 옮겨 넣지 않은 새 폴더(이 화면 메모리만, 장수 0).
const phoneFolderList = () => [...(pFolders || []), ...pPending.filter(x => !(pFolders || []).some(f => f.id === x.id))];
const phoneFolderOf = id => phoneFolderList().find(f => f.id === id) || null;
// PHOTO-폴더스위치: 폰 폴더 줄도 원드라이브 줄과 같은 모양 [📁 이름 | 장수 | 스위치 | ⋯](스위치·⋯는 앱 0.4.1+).
const phoneSwHtml = f => switchHtml('ph:' + f.id, f.name, !phoneOff.has(f.id)).replace('data-photos-fx-sw=', 'data-photos-pf-sw=');
function phoneFolderRowHtml(f, {wide}) {
  const cur = wide && pAt === f.id, sw = phoneSw() && !f.pending, off = sw && phoneOff.has(f.id);
  return `<div class="nx-row nx-folder photos-fx-row${cur ? ' nx-current' : ''}${off ? ' is-off' : ''}" data-photos-pf="${esc(f.id)}" style="--nx-indent:0"${wide ? ' role="treeitem"' : ''}>`
    + (wide ? '<span class="photos-fx-tog" aria-hidden="true"></span>' : '')
    + `<button type="button" class="nx-main" data-photos-pf-open="${esc(f.id)}"${cur ? ' aria-current="true"' : ''}><span class="nx-ico" aria-hidden="true">${cur ? '\u{1F4C2}' : '\u{1F4C1}'}</span><span class="nx-name">${esc(f.name)}${placeHtml('ph:' + f.id)}${tidy.unbackedIds().has(f.id) ? '<span class="photos-fx-place photos-unbacked"> · 백업 안 됨</span>' : ''}${f.pending ? '<span class="photos-fx-place"> · 사진을 옮기면 생겨요</span>' : ''}</span><span class="nx-num" aria-label="사진 ${f.count}장">${f.count}</span></button>`
    + (sw ? phoneSwHtml(f) : '')
    + (phoneOps() ? `<button type="button" class="nx-more photos-fx-more" data-photos-pf-more="${esc(f.id)}" aria-label="${esc(f.name)} 폴더 메뉴" aria-haspopup="true" aria-expanded="false"><span class="more-dots" aria-hidden="true">⋯</span></button>` : '')
    + '</div>';
}
const phoneNewHtml = () => (phoneOps() ? '<button type="button" class="nx-new-folder photos-fx-new" data-photos-pf-new>+ 새 폴더</button>' : '');
// 폰 묶음 줄들. 옛 앱(folders 읽기 없음)이면 비운다(폰 폴더 묶음만 안 보임).
function phoneGroupHtml({wide, head}) {
  if (pFolders === false) return '';
  const title = head ? '<p class="photos-fx-group" data-photos-fx-group="phone">폰</p>' : '';
  if (!pFolders) {
    if (pFoldersFailed && !pFoldersLoading) return title + failHtml({retry:'data-photos-pf-retry', reason:pFoldersFailed});
    const r = run; loadPhoneFolders().then(() => { if (current(r) && tab === 'folders') renderFolders(); });
    return title + waitHtml({rows:2, h:36});
  }
  const list = phoneFolderList();
  const hint = phoneSw() && (!head || !tree?.whole) ? '<p class="photos-fx-hint">스위치 켜짐 = 사진에 보임</p>' : '';
  return title + hint + (list.length ? list.map(f => phoneFolderRowHtml(f, {wide})).join('') : emptyHtml('폰 폴더 없음')) + phoneNewHtml();
}
// 위치 줄 '사진 › 폰 › Camera'. 앞 두 칸은 폴더 목록으로(data-photos-pf-at).
const phonePathHtml = f => `<nav class="fp-path photos-fx-path" aria-label="지금 위치">${folderPathHtml({rootLabel:'사진', trail:[{id:'phone', name:'폰'}, {id:f.id, name:f.name}], attr:'data-photos-pf-at', esc})}</nav>`;
const phoneHeadHtml = f => (phoneSw() && !f.pending
  ? `<p class="photos-fx-here has-sw"><span><b>${esc(f.name)}</b> · ${f.count}장 · 폰${phoneOff.has(f.id) ? ' · 사진에 안 보임' : ''}</span>${phoneSwHtml(f)}</p>`
  : `<p class="photos-fx-here"><b>${esc(f.name)}</b> · ${f.count}장 · 폰</p>`);
function renderFolders() {
  io?.disconnect();
  const g = listGate();
  if (g) { body.innerHTML = g; return; }
  const u = useSrc(), wide = treeWide();
  if (!u.gdrive) { gdAt = null; gdTrail = []; }
  if (gdAt !== null) { renderGdFolder(); return; }
  const top = srcNotes();
  places = folderPlaceLabels([...(u.onedrive && tree ? [tree.top, ...tree.folders] : []), ...(u.phone && pFolders ? pFolders.map(f => ({...f, id:'ph:' + f.id, path:f.id})) : [])],
    f => (f.path ? phoneFolderPlace(f.path) : odFolderPlace(tree, f)));
  if (u.phone && pAt !== null && pFolders && !phoneFolderOf(pAt)) pAt = null;
  if (!u.phone) pAt = null;
  // 원드라이브가 꺼졌거나 못 읽으면 폰 묶음만.
  if (!u.onedrive) {
    if (u.phone && wide && pAt === null && pFolders && pFolders.length) pAt = pFolders[0].id;
    const f = u.phone && pAt !== null ? phoneFolderOf(pAt) : null;
    // 폰·구글 드라이브 묶음(둘 다 켜졌으면 묶음 이름을 붙인다).
    const groups = (u.phone ? phoneGroupHtml({wide, head:u.gdrive}) : '') + gdGroupHtml({wide, head:u.phone});
    if (wide) body.innerHTML = `${top}<div class="photos-fx is-wide"><div class="nx-tree photos-fx-tree" data-photos-fx-tree role="tree" aria-label="${u.phone && !u.gdrive ? '폰 폴더' : '사진 폴더'}">${groups}</div><div class="photos-fx-pane">${f ? `${phonePathHtml(f)}${phoneHeadHtml(f)}<div data-photos-fx-grid></div><p class="photos-muted photos-foot" data-photos-fx-foot></p>` : ''}</div></div>`;
    else body.innerHTML = f ? `<div class="photos-fx">${phonePathHtml(f)}${phoneHeadHtml(f)}<div data-photos-fx-grid></div><p class="photos-muted photos-foot" data-photos-fx-foot></p></div>`
      : `${top}<div class="photos-fx"><div class="photos-fx-list">${groups}</div></div>`;
    if (wide) { followPane(body.querySelector('[data-photos-fx-tree]'), {top:52}); fxSplit(); }
    syncFolderLayer();
    if (f) paintPhoneFolderGrid();
    return;
  }
  if (!tree) {
    if (treeFailed && !treeLoading) { body.innerHTML = `<p class="photos-muted">폴더를 읽지 못했어요: ${esc(treeFailed)} <button type="button" class="mini" data-photos-fx-retry>다시</button></p>`; return; }
    body.innerHTML = waitHtml({rows:4, h:40});
    const r = run; loadTree().then(() => { if (current(r) && tab === 'folders') renderFolders(); });
    return;
  }
  if (!at || !photoFolderById(tree, at)) at = tree.top.id;
  const here = photoFolderById(tree, at), both = u.phone, many = u.phone || u.gdrive;
  const pf = both && pAt !== null ? phoneFolderOf(pAt) : null;
  const odHead = (many ? '<p class="photos-fx-group" data-photos-fx-group="onedrive">원드라이브</p>' : '') + (tree.whole ? '<p class="photos-fx-hint">스위치 켜짐 = 사진에 보임</p>' : '');
  const path = `<nav class="fp-path photos-fx-path" aria-label="지금 위치">${folderPathHtml({rootLabel:'사진', trail:photoFolderTrail(tree, at), attr:'data-photos-fx-at', esc})}</nav>`;
  const head = `<p class="photos-fx-here${tree.whole ? ' has-sw' : ''}"><span><b>${esc(here.name)}</b>${placeHtml(here.id)} · ${here.count}장${here.enabled === false ? ' · 사진에 안 보임' : ''}</span>${tree.whole ? switchHtml(here.id, here.name, here.enabled !== false) : ''}</p>`;
  const grid = '<div data-photos-fx-grid></div><p class="photos-muted photos-foot" data-photos-fx-foot></p>';
  if (wide) {
    const rows = photoFolderRows(tree, id => openSet.has(id));
    body.innerHTML = `${top}<div class="photos-fx is-wide"><div class="nx-tree photos-fx-tree" data-photos-fx-tree role="tree" aria-label="${many ? '사진 폴더' : '원드라이브 폴더'}">${odHead}${rows.map(r => folderRowHtml(r, {wide})).join('')}${newFolderHtml()}${both ? phoneGroupHtml({wide, head:true}) : ''}${gdGroupHtml({wide, head:true})}</div><div class="photos-fx-pane">${pf ? phonePathHtml(pf) + phoneHeadHtml(pf) : path + head}${grid}</div></div>`;
  } else if (pf) {
    body.innerHTML = `<div class="photos-fx">${phonePathHtml(pf)}${phoneHeadHtml(pf)}${grid}</div>`;
  } else {
    const kids = photoSubfolders(tree, at).map(f => ({id:f.id, name:f.name, indent:0, count:f.count, total:f.total, enabled:f.enabled, kids:false, open:false, top:false}));
    // 두 출처면 맨 위 폴더에서만 '폰' 묶음을 원드라이브 하위 폴더 아래에 보인다.
    const phoneRows = many && at === tree.top.id ? `<div class="photos-fx-list">${both ? phoneGroupHtml({wide, head:true}) : ''}${gdGroupHtml({wide, head:true})}</div>` : '';
    body.innerHTML = `${top}<div class="photos-fx">${odHead}${path}<div class="photos-fx-list">${kids.map(r => folderRowHtml(r, {wide})).join('')}${newFolderHtml()}</div>${phoneRows}${head}${grid}</div>`;
  }
  if (wide) { followPane(body.querySelector('[data-photos-fx-tree]'), {top:52}); fxSplit(); } // UI-칸안스크롤하나로: 나무는 화면에 붙어 따라온다.
  syncFolderLayer();
  if (pf) { paintPhoneFolderGrid(); return; }
  paintFolderGrid();
  if (fFor !== at || (!fEnded && !fItems.length && !fFailed)) loadFolder(at);
}
// UI-칸폭끌기전수(요청함 10/30 10:29): PC [폴더]의 폴더 나무 | 사진 사이 경계를 끌어 폭을 바꾼다(공용 split-resize.js, 기본 24:76·나무 최소 180px).
// 고른 폭은 서버(view_prefs.split_ratio.photos)에 기억한다. 다시 그릴 때마다 불러도 된다(새 칸이면 새 경계).
function fxSplit() {
  const box = body.querySelector('.photos-fx.is-wide'); if (!box) return;
  mountSplitResize({container:box, name:'photos', label:'폴더와 사진 칸 폭 조절', columns:[
    {el:() => box.querySelector(':scope>.photos-fx-tree'), varName:'--ds-split-list', minVar:'--ds-split-list-min', minFallback:180, share:24},
    {el:() => box.querySelector(':scope>.photos-fx-pane'), varName:'--ds-split-detail', minVar:'--ds-split-detail-min', minFallback:360, share:76}],
    active:() => treeWide() && tab === 'folders' && box.isConnected && !document.getElementById('photosView')?.classList.contains('hidden')});
}
// 폰 폴더 사진 격자(보기 전용: 끌어 옮기기 없음).
function paintPhoneFolderGrid() {
  const box = body.querySelector('[data-photos-fx-grid]'), foot = body.querySelector('[data-photos-fx-foot]');
  if (!box || pAt === null) return;
  if (pFor !== pAt) loadPhoneFolder(pAt);
  box.replaceChildren();
  const list = pFor === pAt ? pItems : [];
  if (list.length) { const grid = newGrid(); list.forEach((item, i) => grid.append(cell(item, i))); box.append(grid); }
  foot.innerHTML = pFor === pAt && pFailed ? failHtml({retry:'data-photos-pf-again', reason:pFailed}) : pFor === pAt && pEnded ? (list.length ? '' : '이 폴더에 사진이 없어요.') : waitHtml({rows:2, h:72});
  paintSize(); paintSelect();
  io?.disconnect();
  if (pFor === pAt && !pEnded && !pFailed && !pLoading && 'IntersectionObserver' in window) {
    io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) loadPhoneFolder(pAt); }, {rootMargin:'600px 0px'});
    io.observe(foot);
  }
}
function goPhoneFolder(id) {
  if (!phoneFolderOf(id)) return;
  select.stop(); pAt = id; gdAt = null; gdTrail = [];
  renderFolders();
  window.scrollTo?.(0, 0);
}
function paintFolderGrid() {
  const box = body.querySelector('[data-photos-fx-grid]'), foot = body.querySelector('[data-photos-fx-foot]');
  if (!box) return;
  box.replaceChildren();
  const list = fFor === at ? fItems : [];
  if (list.length) { const grid = newGrid(); list.forEach((item, i) => { const c = cell(item, i); c.draggable = treeWide(); grid.append(c); }); box.append(grid); }
  foot.innerHTML = fFor === at && fFailed ? failHtml({retry:'data-photos-fx-again', reason:fFailed}) : fFor === at && fEnded ? (list.length ? '' : '이 폴더에 바로 든 사진이 없어요.') : waitHtml({rows:2, h:72});
  paintSize(); paintSelect();
  io?.disconnect();
  if (fFor === at && !fEnded && !fFailed && 'IntersectionObserver' in window) {
    io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) loadFolder(at); }, {rootMargin:'600px 0px'});
    io.observe(foot);
  }
}
// 폰: 폴더 안으로 들어가면 겹 하나(뒤로가기 = 한 단계 위, 맨 위 폴더에 닿으면 겹을 닫음). PC는 나무가 있으므로 겹 없음.
function syncFolderLayer() {
  const deep = tab === 'folders' && !treeWide() && (gdAt !== null || pAt !== null || (tree && at && at !== tree.top.id));
  if (deep && !folderLayer) folderLayer = window.KPTURouter?.layer?.open('photos-folder', {close:() => {
    // 구글 드라이브 폴더 안이면 한 단계 위(맨 위 묶음에 닿으면 겹을 닫음).
    if (gdAt !== null) { select.stop(); gdTrail = gdTrail.slice(0, -1); gdAt = gdTrail.at(-1)?.id ?? null; if (gdAt !== null) { renderFolders(); return false; } folderLayer = null; renderFolders(); return true; }
    // 폰 폴더 안이면 한 번에 폴더 목록으로.
    if (pAt !== null) { select.stop(); pAt = null; folderLayer = null; renderFolders(); return true; }
    const up = photoFolderById(tree, at)?.parent_id || tree?.top?.id || null;
    select.stop(); at = up;
    if (up && tree && up !== tree.top.id) { renderFolders(); return false; }
    folderLayer = null; renderFolders(); return true;
  }}) || null;
  if (!deep && folderLayer) { const l = folderLayer; folderLayer = null; l.close(); }
}
function goFolder(id) {
  if (!tree || !photoFolderById(tree, id)) return;
  select.stop(); at = id; pAt = null; gdAt = null; gdTrail = [];
  for (const f of photoFolderTrail(tree, id)) openSet.add(f.id);
  renderFolders();
  window.scrollTo?.(0, 0);
}
// 스위치 한 번 = 서버 folder-toggle 한 번. 바로 칠하고(실패하면 되돌림), 끝나면 [사진]·[달력]·앨범을 다시 받는다.
const swBusy = new Set();
function setTreeEnabled(id, on) {
  if (!tree) return;
  if (tree.top.id === id) tree.top.enabled = on;
  else { const f = tree.folders.find(x => x.id === id); if (f) f.enabled = on; }
}
async function toggleFolder(id) {
  const f = tree?.whole ? photoFolderById(tree, id) : null;
  if (!f || swBusy.has(id)) return;
  const next = f.enabled === false;
  setTreeEnabled(id, next); swBusy.add(id);
  if (tab === 'folders') renderFolders();
  try { await odFolderToggle(rt, id, next); resetList(); calData.clear(); aFor = null; }
  catch (error) { setTreeEnabled(id, !next); folderFail(error, '스위치를 바꾸지 못했어요'); }
  finally { swBusy.delete(id); if (tab === 'folders') renderFolders(); }
}
// PHOTO-폴더스위치 ②: 폰 폴더 스위치 = 끈 폴더 목록(view_prefs.phone_folders_off) 저장. 바로 칠하고, 서버가 거절하면 되돌리고 알린다.
function phoneOffChanged() { resetList(); calData.clear(); phStarItems = null; aFor = null; monthsFor = ''; tidy.offChanged(); }
function savePhoneOff(next) {
  const value = phoneOffValue(next);
  if (!value) { notify('끈 폰 폴더가 너무 많아요(80개까지).', {error:true}); return false; }
  phoneOff = next; viewPrefs.set('phone_folders_off', value, {rejectable:true});
  phoneOffChanged();
  return true;
}
function togglePhoneFolder(id) {
  if (!phoneSw() || !phoneFolderOf(id)) return;
  const next = new Set(phoneOff);
  if (next.has(id)) next.delete(id); else next.add(id);
  savePhoneOff(next);
  if (tab === 'folders') renderFolders();
}
// PHOTO-폴더스위치 ③: 폰 폴더 바꾸기(앱 0.4.1+). 처음 한 번 '미디어 관리 허용' 안내(켜 두면 매번 묻지 않음, 안 켜면 바꿀 때마다 폰이 확인 창).
async function phoneOpGo(anchor, op, done, after = null) {
  if (busy || !phoneOps()) return null;
  if (!phone.state().manage && !manageAsked) {
    manageAsked = true;
    if (await askConfirm(anchor, {text:"폰 폴더를 바꿀 때 매번 묻지 않게 '미디어 관리 허용'을 켤까요?", note:'설정에서 웹2의 미디어 관리 허용을 켜고 돌아와 다시 눌러 주세요. 안 켜면 바꿀 때마다 폰이 확인 창을 띄워요.', ok:'설정 열기'})) { phone.manage(); return null; }
  }
  busy = true; paintSelect();
  let res;
  try { res = await phone.folderOp(op); } finally { busy = false; }
  notify(phoneOpText(res, done(res)), {error:!res.ok});
  if (res.ok) after?.(res);
  if (res.ok) { pFolders = null; pFor = null; pItems = []; tidy.reset(); tidyView = null; resetList(); calData.clear(); phStarItems = null; aFor = null; await loadPhoneFolders(true); }
  if (tab === 'folders') renderFolders(); else render();
  return res;
}
async function newPhoneFolder(within = pAt) {
  if (!phoneOps()) return;
  const name = cleanPhoneName(await askName('새 폰 폴더 이름') || '');
  if (!name) return;
  const parent = within !== null && phoneFolderOf(within) ? within : 'Pictures/', path = newPhonePath(parent, name);
  if (!path) return notify('폴더 이름을 확인해 주세요(1~60자, / \\ 없이).', {error:true});
  if (phoneFolderOf(path)) return notify('같은 이름 폴더가 있어요.', {error:true});
  pPending = [...pPending, {id:path, name, count:0, pending:true}];
  notify(`'${name}' 폴더 — 사진을 골라 [옮기기]로 넣으면 폰에 생겨요`);
  if (tab === 'folders') renderFolders();
}
// 이름 바꾸기·옮기기·지우기 뒤: 보던 폴더와 끈 폴더 목록이 새 경로를 따라간다(지우기면 뺀다).
function followPhone(from, to) {
  if (pAt !== null && pAt.startsWith(from)) pAt = to ? to + pAt.slice(from.length) : null;
  if ([...phoneOff].some(p => p.startsWith(from))) savePhoneOff(remapPhoneOff(phoneOff, from, to));
}
async function renamePhoneFolder(anchor, id) {
  const f = phoneFolderOf(id); if (!f || !isPhoneMovable(id)) return notify('이 폴더는 이름을 바꿀 수 없어요(DCIM·Pictures 아래만).', {error:true});
  const raw = await askName('폰 폴더 이름', f.name); if (raw === null) return;
  const name = cleanPhoneName(raw), to = name ? renamedPhonePath(id, name) : '';
  if (!to) return notify('폴더 이름을 확인해 주세요(1~60자, / \\ 없이).', {error:true});
  if (name === f.name) return;
  if (f.pending) { pPending = pPending.map(x => (x.id === id ? {...x, id:to, name} : x)); if (pAt === id) pAt = to; return renderFolders(); }
  await phoneOpGo(anchor, {op:'rename', from:id, name}, r => `이름을 바꿨어요(${r.count}장)`, r => followPhone(id, r.path || to));
}
async function movePhoneFolder(anchor, id, into) {
  const to = movedPhonePath(id, into); if (!to || !isPhoneMovable(id)) return;
  await phoneOpGo(anchor, {op:'movefolder', from:id, into}, r => `폴더를 옮겼어요(${r.count}장)`, r => followPhone(id, r.path || to));
}
async function trashPhoneFolder(anchor, id) {
  const f = phoneFolderOf(id); if (!f) return;
  if (f.pending) { pPending = pPending.filter(x => x.id !== id); if (pAt === id) pAt = null; return renderFolders(); }
  if (!isPhoneTrashable(id)) return notify('이 폴더는 지울 수 없어요.', {error:true});
  if (!await askConfirm(anchor, {text:`'${f.name}' 폴더를 지울까요?`, note:`안의 사진 ${f.count}장(하위 폴더 포함)이 폰 휴지통으로 가요(갤러리 앱에서 30일 안에 되살림).`, ok:'지우기', danger:true})) return;
  await phoneOpGo(anchor, {op:'trashfolder', from:id}, r => `폴더를 지웠어요(${r.count}장 폰 휴지통)`, () => followPhone(id, null));
}
async function movePhonePhotos(anchor, list, to) {
  const ids = list.map(x => x.phoneId).filter(Boolean); if (!ids.length || !to) return;
  select.stop();
  await phoneOpGo(anchor, {op:'move', ids, to}, r => `${r.count}장을 옮겼어요`, () => { pPending = pPending.filter(x => x.id !== to); });
}
async function newFolder(parentId) {
  if (busy || !tree) return;
  const name = cleanPhotoFolderName(await askName('새 폴더 이름') || '');
  if (!name) return;
  busy = true;
  try { const f = await odFolderCreate(rt, parentId, name); openSet.add(parentId); await loadTree(true); notify(`'${f.name}' 폴더를 만들었어요`); }
  catch (error) { folderFail(error, '폴더를 만들지 못했어요'); }
  finally { busy = false; if (tab === 'folders') renderFolders(); }
}
async function renameFolder(id) {
  const f = photoFolderById(tree, id); if (busy || !f || id === tree.top.id) return;
  const raw = await askName('폴더 이름', f.name); if (raw === null) return;
  const name = cleanPhotoFolderName(raw);
  if (!name) return notify('폴더 이름을 확인해 주세요(1~200자, " * : < > ? / \\ | 없이).', {error:true});
  if (name === f.name) return;
  busy = true;
  try { await odFolderRename(rt, id, name); await loadTree(true); notify('이름을 바꿨어요'); }
  catch (error) { folderFail(error, '이름을 바꾸지 못했어요'); }
  finally { busy = false; if (tab === 'folders') renderFolders(); }
}
async function moveFolder(id, parentId) {
  const f = photoFolderById(tree, id); if (busy || !f || f.parent_id === parentId) return;
  const from = f.parent_id;
  busy = true;
  try {
    await odFolderMove(rt, id, parentId); await loadTree(true); openSet.add(parentId);
    notify(`'${f.name}' 폴더를 옮겼어요`, {ms:UNDO_MS, record:false, undo:async () => {
      try { await odFolderMove(rt, id, from); await loadTree(true); if (tab === 'folders') renderFolders(); } catch (error) { folderFail(error, '되돌리지 못했어요'); }
    }});
  } catch (error) { folderFail(error, '폴더를 옮기지 못했어요'); }
  finally { busy = false; if (tab === 'folders') renderFolders(); }
}
async function deleteFolder(anchor, id) {
  const f = photoFolderById(tree, id); if (busy || !f || id === tree.top.id) return;
  // PHOTO-폴더스위치 ②: 사진·하위 폴더가 든 폴더도 확인 한 번 뒤 폴더째 원드라이브 휴지통으로.
  const full = f.total > 0 || photoSubfolders(tree, id).length > 0;
  if (!await askConfirm(anchor, {text:`'${f.name}' 폴더를 지울까요?`, note:full ? `안의 사진 ${f.total}장과 하위 폴더까지 폴더째 원드라이브 휴지통으로 가요(원드라이브에서 30일 안에 되살림).` : '원드라이브 휴지통으로 가요(30일 보관).', ok:'지우기', danger:true})) return;
  busy = true;
  try {
    await odFolderDelete(rt, id, {contents:full});
    if (at && (at === id || photoFolderTrail(tree, at).some(x => x.id === id))) at = f.parent_id;
    await loadTree(true); if (full) { resetList(); calData.clear(); aFor = null; fFor = null; fItems = []; }
    notify('폴더를 지웠어요');
  }
  catch (error) { folderFail(error, '폴더를 지우지 못했어요'); }
  finally { busy = false; if (tab === 'folders') renderFolders(); }
}
// 여러 장 폴더로 옮기기(원드라이브에서도 실제 이동). 50장씩. 끝나면 위쪽 '옮겼어요 · 되돌리기'(원래 폴더로 같은 동작).
async function movePhotos(allIds, target) {
  const ids = allIds.filter(id => !/^(ph|gd):/.test(String(id)));
  if (ids.length < allIds.length) notify('폰·구글 드라이브 사진은 따로 골라 옮겨 주세요(원드라이브 사진만 옮겨요).');
  if (!ids.length) return;
  if (busy || !ids.length || !tree) return;
  const name = photoFolderById(tree, target)?.name || '';
  busy = true; paintSelect();
  const moved = [], bad = [];
  try {
    for (const part of chunks(ids, SELECT_MAX)) {
      try { const res = await odPhotosMove(rt, part, target); moved.push(...res.moved); bad.push(...Object.keys(res.failed)); }
      catch (error) { if (!moved.length && !bad.length) { busy = false; folderFail(error, '옮기지 못했어요'); return; } bad.push(...part); }
    }
  } finally { busy = false; }
  select.stop();
  afterMove(moved.map(m => m.id), target);
  const groups = moveUndoGroups(moved, target), done = moved.filter(m => m.from !== target).length;
  const text = bad.length ? `${done}장을 '${name}'(으)로 옮겼어요 · ${bad.length}장은 못 옮겼어요` : `${done}장을 '${name}'(으)로 옮겼어요`;
  notify(text, {error:!!bad.length, ms:UNDO_MS, record:false, undo:groups.size ? async () => {
    let fail = 0;
    for (const [from, list] of groups) { try { const r = await odPhotosMove(rt, list, from); fail += Object.keys(r.failed).length; } catch { fail += list.length; } }
    afterMove(null, null);
    notify(fail ? `${fail}장은 되돌리지 못했어요.` : '되돌렸어요', {error:!!fail});
  } : null});
}
// 옮긴 뒤: 지금 폴더 목록에서 뺀다(옮긴 곳이 지금 폴더가 아니면). 나무 장수·[사진]·달력·앨범은 다시 받는다.
function afterMove(ids, target) {
  if (ids && target !== at) { const gone = new Set(ids); fItems = fItems.filter(x => !gone.has(x.id)); }
  else { fFor = null; fItems = []; }
  resetList(); calData.clear(); aFor = null;
  loadTree(true).then(() => { if (tab === 'folders') renderFolders(); });
  if (tab === 'folders') renderFolders(); else if (tab === 'albums') renderAlbums(); else render();
}
function folderClick(b) {
  if (gdFolderClick(b)) return true;
  if (b.matches('[data-photos-fx-open]')) { const id = b.dataset.photosFxOpen; if (treeWide() && pAt === null && id === at && id !== tree?.top?.id && photoSubfolders(tree, id).length) { if (openSet.has(id)) openSet.delete(id); else openSet.add(id); renderFolders(); return true; } goFolder(id); return true; }
  if (b.matches('[data-photos-fx-sw]')) { toggleFolder(b.dataset.photosFxSw); return true; }
  if (b.matches('[data-photos-fx-tog]')) { const id = b.dataset.photosFxTog; if (openSet.has(id)) openSet.delete(id); else openSet.add(id); renderFolders(); return true; }
  if (b.matches('[data-photos-fx-at]')) { const id = b.dataset.photosFxAt || tree?.top?.id; if (id) goFolder(id); return true; }
  if (b.matches('[data-photos-fx-more]')) { folderMenu.open(b); return true; }
  if (b.matches('[data-photos-fx-new]')) { newFolder(treeWide() ? at || tree?.top?.id : at || tree?.top?.id); return true; }
  if (b.matches('[data-photos-fx-retry]')) { treeFailed = ''; renderFolders(); return true; }
  if (b.matches('[data-photos-fx-again]')) { fFailed = ''; paintFolderGrid(); loadFolder(at); return true; }
  if (b.matches('[data-photos-pf-open]')) { goPhoneFolder(b.dataset.photosPfOpen); return true; }
  if (b.matches('[data-photos-pf-sw]')) { togglePhoneFolder(b.dataset.photosPfSw.slice(3)); return true; }
  if (b.matches('[data-photos-pf-more]')) { phoneFolderMenu.open(b); return true; }
  if (b.matches('[data-photos-pf-new]')) { newPhoneFolder(); return true; }
  if (b.matches('[data-photos-pf-at]')) { select.stop(); pAt = null; renderFolders(); return true; }
  if (b.matches('[data-photos-pf-retry]')) { pFoldersFailed = ''; renderFolders(); return true; }
  if (b.matches('[data-photos-pf-again]')) { pFailed = ''; paintPhoneFolderGrid(); loadPhoneFolder(pAt); return true; }
  return false;
}

// ---- S46-24 ④ 구글 드라이브: 사진 바꾸기(누를 때만, 서버 confirm:true) ----
const TRASH_NOTE_GD = '드라이브 휴지통에서 30일 안에 되살릴 수 있어요';
// 바꾼 뒤 모든 목록에서 그 칸을 빼거나(gone) 고친다(patch).
function gdDrop(gone) {
  if (!gone.size) return;
  gdItems = gdItems.filter(x => !gone.has(x.id)); gdFItems = gdFItems.filter(x => !gone.has(x.id));
  for (const id of gone) { hidden.add(id); gdForget(id.slice(3)); }
  items = items.filter(x => !gone.has(x.id));
}
function gdPatch(id, patch) {
  for (const list of [gdItems, gdFItems, items]) for (const it of list) if (it.id === id) Object.assign(it, patch);
}
async function gdTrashPicked(anchor, list) {
  if (!gdUsable() || busy || !list.length) return;
  const some = list.slice(0, SELECT_MAX), more = list.length > some.length ? ` (한 번에 ${SELECT_MAX}장까지)` : '';
  if (!await askConfirm(anchor, {text:`구글 드라이브 사진 ${some.length}장을 지울까요?${more}`, note:`${TRASH_NOTE_GD}.`, ok:'드라이브 휴지통으로', danger:true})) return;
  busy = true; paintSelect();
  let res;
  try { res = await gdTrash(rt, some.map(x => x.gdId)); }
  catch (error) { gdProblemFrom(error); notify(`지우지 못했어요: ${gdriveErrorText(error)}`, {error:true}); return; }
  finally { busy = false; paintSelect(); }
  const gone = new Set((Array.isArray(res?.trashed) ? res.trashed : []).map(gdriveKey)), bad = Array.isArray(res?.failed) ? res.failed.length : 0;
  gdDrop(gone); select.stop(); repaintShown();
  notify(bad ? `${gone.size}장을 드라이브 휴지통으로 옮겼어요 · ${bad}장은 못 했어요` : `${gone.size}장을 드라이브 휴지통으로 옮겼어요 · ${TRASH_NOTE_GD}`, {error:!!bad});
}
const gdName = raw => { const v = String(raw ?? '').normalize('NFC').trim(); return v && v.length <= 200 && !/[\u0000-\u001f\u007f]/.test(v) && v !== '.' && v !== '..' ? v : ''; };
async function gdRenamePhoto(item) {
  if (!item || item.kind !== 'gdrive' || !gdUsable() || busy) return;
  const raw = await askName('사진 이름', item.name); if (raw === null) return;
  const name = gdName(raw);
  if (!name) return notify('이름을 확인해 주세요(1~200자).', {error:true});
  if (name === item.name) return;
  busy = true; paintSelect();
  try { const res = await gdRename(rt, item.gdId, name); gdPatch(item.id, {name:res?.name || name}); select.stop(); notify('이름을 바꿨어요'); }
  catch (error) { gdProblemFrom(error); notify(`이름을 바꾸지 못했어요: ${gdriveErrorText(error)}`, {error:true}); }
  finally { busy = false; paintSelect(); }
}
// 옮길 곳: 맨 위(내 드라이브) + 지금까지 연 층의 폴더(나무 순서, 들여쓰기). 처음이면 맨 위 층을 먼저 읽는다.
function gdTargets() {
  const out = [{id:'root', name:'내 드라이브', indent:0}], seen = new Set(['root']);
  const walk = (parent, indent) => { for (const f of gdLevels.get(parent)?.folders || []) { if (seen.has(f.id)) continue; seen.add(f.id); out.push({id:f.id, name:f.name, indent, enabled:f.enabled}); walk(f.id, indent + 1); } };
  walk('root', 1);
  return out;
}
async function gdMovePicked(list, to) {
  if (!gdUsable() || busy || !list.length || !to) return;
  const some = list.slice(0, SELECT_MAX), target = gdTargets().find(t => t.id === to);
  busy = true; paintSelect();
  let res;
  try { res = await gdMove(rt, some.map(x => x.gdId), to); }
  catch (error) { gdProblemFrom(error); notify(`옮기지 못했어요: ${gdriveErrorText(error)}`, {error:true}); return; }
  finally { busy = false; paintSelect(); }
  const moved = Array.isArray(res?.moved) ? res.moved : [], bad = Array.isArray(res?.failed) ? res.failed.length : 0;
  if (target?.enabled) for (const id of moved) gdPatch(gdriveKey(id), {folder:to}); else gdDrop(new Set(moved.map(gdriveKey)));
  if (gdAt !== null && gdAt !== to) gdFItems = gdFItems.filter(x => !moved.includes(x.gdId));
  select.stop(); resetList(); gdFFor = null; repaintShown();
  const off = target?.enabled ? '' : ' · 그 폴더는 꺼져 있어 사진에 안 보여요';
  notify(bad ? `${moved.length}장을 옮겼어요 · ${bad}장은 못 옮겼어요` : `${moved.length}장을 '${target?.name || '폴더'}'(으)로 옮겼어요${off}`, {error:!!bad});
}

// ---- S46-24 ④ [폴더] 구글 드라이브 묶음: 맨 위부터 한 층씩(서버 folders), 폴더마다 스위치·⋯ ----
function gdLoadLevel(parent = 'root', force = false) {
  if (gdLevelLoading.has(parent)) return gdLevelLoading.get(parent);
  if (gdLevels.has(parent) && !force) return Promise.resolve(gdLevels.get(parent));
  const o = owner;
  const p = gdFolders(rt, parent).then(d => {
    if (o !== owner) return null;
    const lv = {name:String(d?.name || ''), up:typeof d?.up === 'string' ? d.up : null, complete:d?.complete !== false,
      folders:(Array.isArray(d?.folders) ? d.folders : []).filter(f => f && typeof f.id === 'string' && typeof f.name === 'string').map(f => ({id:f.id, name:f.name, enabled:f.enabled === true}))};
    gdLevels.set(parent, lv); gdLevelFailed.delete(parent);
    return lv;
  }, error => { if (o === owner) { gdLevelFailed.set(parent, gdriveErrorText(error)); gdProblemFrom(error); } return null; })
    .finally(() => gdLevelLoading.delete(parent));
  gdLevelLoading.set(parent, p);
  return p;
}
const gdFolderInfo = id => { for (const lv of gdLevels.values()) { const f = lv.folders.find(x => x.id === id); if (f) return f; } return null; };
const gdSetEnabled = (id, on) => { for (const lv of gdLevels.values()) for (const f of lv.folders) if (f.id === id) f.enabled = on; };
const gdSwHtml = f => switchHtml(f.id, f.name, f.enabled).replace('data-photos-fx-sw=', 'data-photos-gf-sw=');
function gdRowHtml(f, {wide}) {
  return `<div class="nx-row nx-folder photos-fx-row${f.enabled ? '' : ' is-off'}" data-photos-gf="${esc(f.id)}" style="--nx-indent:0"${wide ? ' role="treeitem"' : ''}>`
    + (wide ? '<span class="photos-fx-tog" aria-hidden="true"></span>' : '')
    + `<button type="button" class="nx-main" data-photos-gf-open="${esc(f.id)}"><span class="nx-ico" aria-hidden="true">\u{1F4C1}</span><span class="nx-name">${esc(f.name)}</span></button>`
    + gdSwHtml(f)
    + `<button type="button" class="nx-more photos-fx-more" data-photos-gf-more="${esc(f.id)}" aria-label="${esc(f.name)} 폴더 메뉴" aria-haspopup="true" aria-expanded="false"><span class="more-dots" aria-hidden="true">⋯</span></button></div>`;
}
// 한 층의 줄들(맨 위 'root' 또는 들어간 폴더 안). 아직이면 읽고 다시 그린다.
function gdLevelHtml(parent, {wide}) {
  const lv = gdLevels.get(parent);
  if (!lv) {
    if (gdLevelFailed.has(parent) && !gdLevelLoading.has(parent)) return failHtml({retry:'data-photos-gf-retry', reason:gdLevelFailed.get(parent)});
    gdLoadLevel(parent).then(() => { if (tab === 'folders') renderFolders(); });
    return waitHtml({rows:2, h:36});
  }
  return (lv.folders.length ? lv.folders.map(f => gdRowHtml(f, {wide})).join('') : emptyHtml(parent === 'root' ? '폴더 없음' : '하위 폴더 없음'))
    + (lv.complete ? '' : '<p class="photos-fx-hint">폴더가 많아 앞부분만 보여요</p>')
    + `<button type="button" class="nx-new-folder photos-fx-new" data-photos-gf-new="${esc(parent)}">+ 새 폴더</button>`;
}
function gdGroupHtml({wide, head}) {
  if (!gdOn()) return '';
  const title = head ? '<p class="photos-fx-group" data-photos-fx-group="gdrive">구글 드라이브</p>' : '';
  if (gd.problem) return title + gdNoteHtml();
  return title + '<p class="photos-fx-hint">스위치 켜짐 = 사진에 보임</p>' + gdLevelHtml('root', {wide});
}
// 들어간 구글 드라이브 폴더 하나(PC·폰 같은 한 칸 모양): 위치 줄 · 이름·스위치 · 하위 폴더 · 그 폴더 사진(켰을 때만).
function renderGdFolder() {
  const f = gdFolderInfo(gdAt) || {id:gdAt, name:gdTrail.at(-1)?.name || '', enabled:false};
  const path = `<nav class="fp-path photos-fx-path" aria-label="지금 위치">${folderPathHtml({rootLabel:'사진', trail:[{id:'gdrive', name:'구글 드라이브'}, ...gdTrail], attr:'data-photos-gf-at', esc})}</nav>`;
  const head = `<p class="photos-fx-here has-sw"><span><b>${esc(f.name)}</b> · 구글 드라이브${f.enabled ? '' : ' · 사진에 안 보임'}</span>${gdSwHtml(f)}</p>`;
  body.innerHTML = `${srcNotes()}<div class="photos-fx" data-photos-gd-folder>${path}${head}<div class="photos-fx-list">${gdLevelHtml(gdAt, {wide:false})}</div><div data-photos-fx-grid></div><p class="photos-muted photos-foot" data-photos-fx-foot></p></div>`;
  syncFolderLayer();
  paintGdFolderGrid();
}
// 그 폴더 사진: 켠 폴더 사진 목록(서버 list)에서 그 폴더 것만(300장씩, 20쪽까지).
function gdLoadFolderPhotos(id) {
  if (gdFFor === id && gdFLoading) return gdFLoading;
  gdFFor = id; gdFItems = []; gdFFailed = '';
  const o = owner, token = {};
  gdFLoading = token;
  const job = (async () => {
    try {
      const out = [];
      let before = null;
      for (let guard = 0; guard < 20; guard++) {
        const page = await gdList(rt, {before, limit:300});
        if (o !== owner || gdFLoading !== token) return;
        const got = (Array.isArray(page?.items) ? page.items : []).map(gdriveToItem).filter(Boolean);
        out.push(...got.filter(x => x.folder === id));
        if (page?.more !== true || !got.length) break;
        before = gdriveBefore(got[got.length - 1]);
      }
      gdFItems = out.sort(sortCompare(sort));
    } catch (error) { if (o === owner && gdFLoading === token) { gdFFailed = gdriveErrorText(error); gdProblemFrom(error); } }
    finally { if (gdFLoading === token) gdFLoading = null; }
    if (o === owner && tab === 'folders' && gdAt === id) paintGdFolderGrid();
  })();
  return job;
}
function paintGdFolderGrid() {
  const box = body.querySelector('[data-photos-fx-grid]'), foot = body.querySelector('[data-photos-fx-foot]');
  if (!box || gdAt === null) return;
  const f = gdFolderInfo(gdAt);
  box.replaceChildren();
  if (!f?.enabled) { foot.textContent = '스위치를 켜면 이 폴더 사진이 보여요.'; paintSelect(); return; }
  if (gdFFor !== gdAt) gdLoadFolderPhotos(gdAt);
  const list = gdFFor === gdAt ? gdFItems : [];
  if (list.length) { const grid = newGrid(); list.forEach((item, i) => grid.append(cell(item, i))); box.append(grid); }
  foot.innerHTML = gdFFor === gdAt && gdFFailed ? failHtml({retry:'data-photos-gf-again', reason:gdFFailed}) : gdFFor === gdAt && !gdFLoading ? (list.length ? '' : '이 폴더에 바로 든 사진이 없어요.') : waitHtml({rows:2, h:72});
  paintSize(); paintSelect();
}
function goGdFolder(id) {
  const f = gdFolderInfo(id); if (!f) return;
  select.stop();
  const k = gdTrail.findIndex(x => x.id === id);
  if (k >= 0) gdTrail = gdTrail.slice(0, k + 1);
  else if (gdAt !== null && (gdLevels.get(gdAt)?.folders || []).some(x => x.id === id)) gdTrail = [...gdTrail, {id, name:f.name}];
  else gdTrail = [{id, name:f.name}];
  gdAt = id; pAt = null;
  renderFolders(); window.scrollTo?.(0, 0);
}
function gdLeave() { select.stop(); gdAt = null; gdTrail = []; renderFolders(); }
const gdSwBusy = new Set();
async function gdToggleFolder(id) {
  const f = gdFolderInfo(id); if (!f || gdSwBusy.has(id) || !gdUsable()) return;
  const next = !f.enabled;
  gdSetEnabled(id, next); gdSwBusy.add(id);
  if (tab === 'folders') renderFolders();
  try {
    const res = await gdFolderToggle(rt, id, next);
    gd = {...gd, foldersOn:Math.max(0, gd.foldersOn + (next ? 1 : -1))};
    resetList(); gdFFor = null;
    notify(next ? `'${f.name}' 폴더 사진 ${Number.isInteger(res?.indexed) ? res.indexed : 0}장을 보여요` : `'${f.name}' 폴더를 사진에서 뺐어요(드라이브 파일은 그대로)`);
  } catch (error) { gdSetEnabled(id, !next); gdProblemFrom(error); notify(`스위치를 바꾸지 못했어요: ${gdriveErrorText(error)}`, {error:true}); }
  finally { gdSwBusy.delete(id); if (tab === 'folders') renderFolders(); }
}
async function gdNewFolder(parent) {
  if (busy || !gdUsable()) return;
  const raw = await askName('새 폴더 이름'); if (raw === null) return;
  const name = gdName(raw);
  if (!name) return notify('폴더 이름을 확인해 주세요(1~200자).', {error:true});
  busy = true;
  try { await gdFolderCreate(rt, parent, name); await gdLoadLevel(parent, true); notify(`'${name}' 폴더를 만들었어요`); }
  catch (error) { gdProblemFrom(error); notify(`폴더를 만들지 못했어요: ${gdriveErrorText(error)}`, {error:true}); }
  finally { busy = false; if (tab === 'folders') renderFolders(); }
}
async function gdRenameFolder(id) {
  const f = gdFolderInfo(id); if (busy || !f || !gdUsable()) return;
  const raw = await askName('폴더 이름', f.name); if (raw === null) return;
  const name = gdName(raw);
  if (!name) return notify('폴더 이름을 확인해 주세요(1~200자).', {error:true});
  if (name === f.name) return;
  busy = true;
  try {
    await gdFolderRename(rt, id, name);
    for (const lv of gdLevels.values()) for (const x of lv.folders) if (x.id === id) x.name = name;
    gdTrail = gdTrail.map(x => (x.id === id ? {...x, name} : x));
    notify('이름을 바꿨어요');
  } catch (error) { gdProblemFrom(error); notify(`이름을 바꾸지 못했어요: ${gdriveErrorText(error)}`, {error:true}); }
  finally { busy = false; if (tab === 'folders') renderFolders(); }
}
async function gdTrashFolder(anchor, id) {
  const f = gdFolderInfo(id); if (busy || !f || !gdUsable()) return;
  if (!await askConfirm(anchor, {text:`'${f.name}' 폴더를 지울까요?`, note:`안의 파일과 하위 폴더도 함께 드라이브 휴지통으로 가요. ${TRASH_NOTE_GD}.`, ok:'드라이브 휴지통으로', danger:true})) return;
  busy = true;
  try {
    await gdFolderTrash(rt, id);
    for (const lv of gdLevels.values()) lv.folders = lv.folders.filter(x => x.id !== id);
    gdLevels.delete(id);
    const k = gdTrail.findIndex(x => x.id === id);
    if (k >= 0) { gdTrail = gdTrail.slice(0, k); gdAt = gdTrail.at(-1)?.id ?? null; }
    if (f.enabled) { resetList(); gdFFor = null; gd = {...gd, foldersOn:Math.max(0, gd.foldersOn - 1)}; }
    notify(`폴더를 지웠어요 · ${TRASH_NOTE_GD}`);
  } catch (error) { gdProblemFrom(error); notify(`폴더를 지우지 못했어요: ${gdriveErrorText(error)}`, {error:true}); }
  finally { busy = false; if (tab === 'folders') renderFolders(); }
}
function gdFolderClick(b) {
  if (b.matches('[data-photos-gf-open]')) { goGdFolder(b.dataset.photosGfOpen); return true; }
  if (b.matches('[data-photos-gf-sw]')) { gdToggleFolder(b.dataset.photosGfSw); return true; }
  if (b.matches('[data-photos-gf-more]')) { gdFolderMenu.open(b); return true; }
  if (b.matches('[data-photos-gf-new]')) { gdNewFolder(b.dataset.photosGfNew || 'root'); return true; }
  if (b.matches('[data-photos-gf-at]')) { const id = b.dataset.photosGfAt; if (!id || id === 'gdrive') gdLeave(); else goGdFolder(id); return true; }
  if (b.matches('[data-photos-gf-retry]')) { gdLevelFailed.clear(); renderFolders(); return true; }
  if (b.matches('[data-photos-gf-again]')) { gdFFor = null; gdFFailed = ''; paintGdFolderGrid(); return true; }
  if (b.matches('[data-photos-gd-reconnect]')) { gdReconnectGo(); return true; }
  if (b.matches('[data-photos-gd-retry]')) { gdRetry(); return true; }
  return false;
}

// ---- [앨범](#태그) ----
function loadTags(force = false) {
  if (tagsLoading) return tagsLoading;
  if (tags && !force) return Promise.resolve(tags);
  const r = run;
  tagsLoading = readPhotoTags(rt).then(d => { if (current(r)) { tags = d.tags; links = d.links; tagsFailed = ''; } return tags; },
    () => { if (current(r)) tagsFailed = '앨범을 읽지 못했어요.'; return null; }).finally(() => { tagsLoading = null; });
  return tagsLoading;
}
// PHOTO-출처모든칩: 켜진 출처 사진만 세고 보인다(앨범 이름·담긴 항목은 그대로).
const cards = () => albumCards(tags || [], links).map(c => albumForSources(c, useSrc()));
const cardOf = id => cards().find(c => c.id === id) || null;
// 앨범 사진: 그 앨범 사진 id를 서버 library(고른 id만, 500개씩)에 보내 색인에 있는 것만 최신순으로.
async function loadAlbum(id) {
  const c = cardOf(id); if (!c) return;
  const r = run; aFor = id; aItems = []; aFailed = '';
  aLoading = (async () => {
    try {
      const all = [];
      for (const ids of chunks(ready() ? c.keys : [], STAR_CHUNK)) {
        let cursor = null;
        for (let guard = 0; guard < 50; guard++) {
          const page = await odLibrary(rt, {filter:'star', starIds:ids, cursor, limit:200, sort});
          if (!current(r) || aFor !== id) return;
          all.push(...page.items); cursor = page.next;
          if (!cursor) break;
        }
      }
      // 폰 사진(이 폰에 있는 것만 — 다른 폰·지운 사진은 빠진다).
      const ph = phoneUsable() && c.phoneKeys.length ? await phone.byIds(c.phoneKeys.map(phoneIdOfKey), hideArg()) : [];
      if (!current(r) || aFor !== id) return;
      aItems = [...all.map(toItem), ...ph].sort(sortCompare(sort));
    } catch (error) { if (current(r) && aFor === id) aFailed = readErrorText(error); }
    finally { if (aFor === id) aLoading = null; }
    if (current(r) && tab === 'albums' && album === id) renderAlbums();
  })();
  return aLoading;
}
// 앨범 한 줄(보기 단계마다 모양만 다르고, 여는 버튼·⋯ 메뉴·길게 누르기는 같다).
// card = 대표 사진 큰 칸 + #이름 장수, thumb = 작은 대표 사진 + #이름 / n장 · 기간, line = #이름 … 장수(그림 없음).
function albumRowHtml(c, view) {
  const name = `<span class="photos-album-name">#${esc(c.name)}</span>`, n = `<span class="photos-album-n">${c.count}</span>`;
  const period = albumPeriod(c.from, c.to);
  const inner = view === 'line' ? name + n
    : view === 'thumb' ? `<span class="photos-album-cover" data-photos-al-cover></span><span class="photos-album-txt">${name}<span class="photos-album-meta">${n}장${period ? ` · <span class="photos-album-span">${esc(period)}</span>` : ''}</span></span>`
    : `<span class="photos-album-cover" data-photos-al-cover></span>${name}${n}`;
  return `<div class="photos-album" data-photos-album="${esc(c.id)}"><button type="button" class="photos-album-open" data-photos-al-open="${esc(c.id)}" aria-label="#${esc(c.name)} 앨범, 사진 ${c.count}장${view === 'thumb' && period ? `, ${esc(period)}` : ''}">${inner}</button><button type="button" class="photos-album-more" data-photos-al-more="${esc(c.id)}" aria-label="#${esc(c.name)} 앨범 메뉴" aria-haspopup="true" aria-expanded="false"><span class="more-dots" aria-hidden="true">⋯</span></button></div>`;
}
function renderAlbums() {
  io?.disconnect();
  const g = listGate();
  if (g) { body.innerHTML = g; return; }
  if (!tags) {
    if (tagsFailed && !tagsLoading) { body.innerHTML = `<p class="photos-muted">${esc(tagsFailed)} <button type="button" class="mini" data-photos-al-retry>다시</button></p>`; return; }
    body.innerHTML = waitHtml({rows:3, h:72});
    const r = run; loadTags().then(() => { if (current(r) && tab === 'albums') renderAlbums(); });
    return;
  }
  if (album && !cardOf(album)) album = null;
  syncAlbumLayer();
  if (!album) {
    const list = cards(), view = albumView();
    paintTools();
    body.innerHTML = `<div class="photos-albums" data-photos-albums data-view="${view}">${list.map(c => albumRowHtml(c, view)).join('')}</div>${list.length ? '' : '<p class="photos-muted">사진을 길게 눌러 고른 뒤 [# 앨범]으로 넣어요.</p>'}`;
    for (const c of list) {
      const slot = body.querySelector(`[data-photos-album="${CSS.escape(c.id)}"] [data-photos-al-cover]`);
      if (slot && c.cover) slot.append(odPhotoElement({kind:'od', source:'onedrive', key:c.cover, id:c.cover, day:''}, 'small', {label:'', rt, retry:false}));
      else if (slot && c.phoneCover && phoneUsable()) slot.append(phone.element({phoneId:phoneIdOfKey(c.phoneCover)}, 'small'));
    }
    paintSelect();
    return;
  }
  paintTools();
  const c = cardOf(album);
  if (aFor !== album) { body.innerHTML = waitHtml({rows:3, h:72}); loadAlbum(album); return; }
  body.innerHTML = `<p class="photos-fx-here photos-al-head"><button type="button" class="mini" data-photos-al-back aria-label="앨범 목록으로">‹ 앨범</button><b>#${esc(c.name)}</b> · ${aLoading ? c.count : aItems.length}장<button type="button" class="photos-album-more" data-photos-al-more="${esc(c.id)}" aria-label="#${esc(c.name)} 앨범 메뉴" aria-haspopup="true" aria-expanded="false"><span class="more-dots" aria-hidden="true">⋯</span></button></p>`;
  if (aLoading) { body.insertAdjacentHTML('beforeend', waitHtml({rows:2, h:72})); return; }
  if (aFailed) { body.insertAdjacentHTML('beforeend', `<p class="photos-muted">사진을 읽지 못했어요: ${esc(aFailed)}</p>`); return; }
  if (!aItems.length) { body.insertAdjacentHTML('beforeend', emptyHtml()); paintSelect(); return; }
  const grid = newGrid(); aItems.forEach((item, i) => grid.append(cell(item, i))); body.append(grid);
  paintSize(); paintSelect();
}
function syncAlbumLayer() {
  const inside = tab === 'albums' && !!album;
  // NAV-PC앞뒤통일: › (or the browser's forward) over an entry left by back opens the same album / chip again (reopen).
  const reopenId = album;
  if (inside && !albumLayer) albumLayer = window.KPTURouter?.layer?.open('photos-album', {reopen:() => openAlbum(reopenId), close:() => { albumLayer = null; select.stop(); album = null; renderAlbums(); return true; }}) || null;
  if (!inside && albumLayer) { const l = albumLayer; albumLayer = null; l.close(); }
}
function openAlbum(id) { select.stop(); album = id; aFor = null; renderAlbums(); window.scrollTo?.(0, 0); }
async function newAlbum(items = null) {
  if (busy) return null;
  const raw = await askName('새 앨범 이름(#태그)'); if (raw === null) return null;
  const name = cleanTagName(raw);
  if (!name) { notify('앨범 이름은 1~40자, 띄어쓰기·# 없이 써 주세요.', {error:true}); return null; }
  await loadTags();
  const same = (tags || []).find(t => sameTag(t.name, name));
  busy = true;
  try {
    const tag = same || await createPhotoTag(name, rt);
    if (!same) tags = [...(tags || []), tag];
    if (items?.length) await tagItems(tag, items, {quiet:true});
    if (!items) notify(`#${tag.name} 앨범을 만들었어요`);
    return tag;
  } catch { notify('앨범을 만들지 못했어요.', {error:true}); return null; }
  finally { busy = false; if (tab === 'albums') renderAlbums(); else paintSelect(); }
}
async function tagItems(tag, all, {quiet = false} = {}) {
  // 구글 드라이브 사진은 아직 앨범에 넣지 않는다(앨범 표는 원드라이브·폰 사진만 안다).
  const list = all.filter(it => it.kind !== 'gdrive');
  if (list.length < all.length) notify('구글 드라이브 사진은 아직 앨범에 못 넣어요.');
  if (!list.length) return;
  const fresh = list.filter(it => !links.some(l => l.tag_id === tag.id && l.item_key === it.key)).slice(0, 200);
  try {
    if (fresh.length) await addPhotoTagItems(tag.id, fresh, rt);
    links = [...links, ...fresh.map(it => ({tag_id:tag.id, source:it.source === 'phone' ? 'phone' : 'onedrive', item_key:it.key, taken_day:it.day || null}))];
    select.stop(); paintSelect(); aFor = null;
    notify(`${list.length}장을 #${tag.name} 앨범에 넣었어요${list.length > 200 ? ' (한 번에 200장까지)' : ''}`);
  } catch { notify('앨범에 넣지 못했어요.', {error:true}); }
  if (!quiet && tab === 'albums') renderAlbums();
}
async function untagPicked() {
  const c = cardOf(album), list = pickedItems(); if (!c || !list.length || busy) return;
  busy = true;
  try {
    const keys = list.map(x => x.key), phoneKeys = list.filter(x => x.kind === 'phone').map(x => x.key), odKeys = list.filter(x => x.kind !== 'phone').map(x => x.key);
    if (odKeys.length) await removePhotoTagItems(c.id, odKeys, rt);
    if (phoneKeys.length) await removePhotoTagItems(c.id, phoneKeys, rt, 'phone');
    const gone = new Set(keys);
    links = links.filter(l => !(l.tag_id === c.id && gone.has(l.item_key))); aItems = aItems.filter(x => !gone.has(x.key));
    select.stop();
    notify(`${keys.length}장을 #${c.name} 앨범에서 뺐어요`, {ms:UNDO_MS, record:false, undo:() => tagItems({id:c.id, name:c.name}, list)});
  } catch { notify('앨범에서 빼지 못했어요.', {error:true}); }
  finally { busy = false; renderAlbums(); }
}
async function renameAlbum(id) {
  const c = cardOf(id); if (!c || busy) return;
  const raw = await askName('앨범 이름', c.name); if (raw === null) return;
  const name = cleanTagName(raw);
  if (!name) return notify('앨범 이름은 1~40자, 띄어쓰기·# 없이 써 주세요.', {error:true});
  if ((tags || []).some(t => t.id !== id && sameTag(t.name, name))) return notify('같은 이름의 앨범이 이미 있어요.', {error:true});
  busy = true;
  try { await renamePhotoTag(id, name, rt); tags = tags.map(t => (t.id === id ? {...t, name} : t)); notify('이름을 바꿨어요'); }
  catch { notify('이름을 바꾸지 못했어요.', {error:true}); }
  finally { busy = false; renderAlbums(); }
}
async function deleteAlbum(anchor, id) {
  const c = cardOf(id); if (!c || busy) return;
  if (!await askConfirm(anchor, {text:`#${c.name} 앨범을 지울까요?`, note:'사진은 원드라이브에 그대로 남아요.', ok:'지우기', danger:true})) return;
  busy = true;
  try { await deletePhotoTag(id, rt); tags = tags.filter(t => t.id !== id); links = links.filter(l => l.tag_id !== id); if (album === id) album = null; notify('앨범을 지웠어요'); }
  catch { notify('앨범을 지우지 못했어요.', {error:true}); }
  finally { busy = false; renderAlbums(); }
}
function albumClick(b) {
  if (b.matches('[data-photos-al-open]')) { openAlbum(b.dataset.photosAlOpen); return true; }
  if (b.matches('[data-photos-al-more]')) { albumMenu.open(b); return true; }
  if (b.matches('[data-photos-al-new]')) { newAlbum(); return true; }
  if (b.matches('[data-photos-al-back]')) { if (albumLayer) { const l = albumLayer; albumLayer = null; l.close(); } select.stop(); album = null; renderAlbums(); return true; }
  if (b.matches('[data-photos-al-retry]')) { tagsFailed = ''; renderAlbums(); return true; }
  return false;
}

// ---- 메뉴(공용 anchored-menu.js, 모양은 원드라이브 아이콘 메뉴와 같은 od-link-menu). PC 우클릭은 context-menu.js가 ⋯를 눌러 누른 자리에 연다. ----
const menuBtn = (attr, label, cls = '') => `<button type="button" ${attr}${cls ? ` class="${cls}"` : ''}>${label}</button>`;
const folderMenu = createAnchoredMenu({id:'photosFolderMenu', className:'od-link-menu', label:'폴더 메뉴', historyKey:'kptuPhotosFolderMenu',
  key:t => t.dataset.photosFxMore || '',
  render:id => {
    const top = id === tree?.top?.id, can = od.canDelete;
    return [can ? menuBtn('data-fm-new', '새 하위 폴더') : '', !top && can ? menuBtn('data-fm-rename', '이름 바꾸기') : '', !top && can ? menuBtn('data-fm-move', '옮기기…') : '',
      !top && can ? menuBtn('data-fm-delete', '지우기', 'od-link-danger') : '', can ? '' : '<p class="od-link-status">바꾸려면 원드라이브를 다시 연결해 주세요</p>'].join('');
  },
  onAction:(b, {id, trigger}) => {
    if (b.matches('[data-fm-new]')) return newFolder(id);
    if (b.matches('[data-fm-rename]')) return renameFolder(id);
    if (b.matches('[data-fm-move]')) return openPick(trigger, {kind:'folder', id});
    if (b.matches('[data-fm-delete]')) return deleteFolder(trigger, id);
  }});
// PHOTO-폴더스위치 ③: 폰 폴더 ⋯ 메뉴(원드라이브 폴더 메뉴와 같은 모양·같은 항목 순서). 앱 0.4.1+만.
const phoneFolderMenu = createAnchoredMenu({id:'photosPhoneFolderMenu', className:'od-link-menu', label:'폰 폴더 메뉴', historyKey:'kptuPhotosPhoneFolderMenu',
  key:t => t.dataset.photosPfMore || '',
  render:id => {
    const f = phoneFolderOf(id), can = phoneOps() && !!f, mov = can && isPhoneMovable(id);
    return [can ? menuBtn('data-pfm-new', '새 하위 폴더') : '', mov ? menuBtn('data-pfm-rename', '이름 바꾸기') : '', mov && !f.pending ? menuBtn('data-pfm-move', '옮기기…') : '',
      can && (f.pending || isPhoneTrashable(id)) ? menuBtn('data-pfm-delete', '지우기', 'od-link-danger') : '', mov ? '' : '<p class="od-link-status">DCIM·Pictures 아래 폴더만 이름·위치를 바꿀 수 있어요</p>'].join('');
  },
  onAction:(b, {id, trigger}) => {
    if (b.matches('[data-pfm-new]')) return newPhoneFolder(id);
    if (b.matches('[data-pfm-rename]')) return renamePhoneFolder(trigger, id);
    if (b.matches('[data-pfm-move]')) return openPick(trigger, {kind:'phfolder', id});
    if (b.matches('[data-pfm-delete]')) return trashPhoneFolder(trigger, id);
  }});
// S46-24 ④: 구글 드라이브 폴더 ⋯ = 새 하위 폴더·이름 바꾸기·지우기(드라이브 휴지통, 확인 한 번).
const gdFolderMenu = createAnchoredMenu({id:'photosGdFolderMenu', className:'od-link-menu', label:'구글 드라이브 폴더 메뉴', historyKey:'kptuPhotosGdFolderMenu',
  key:t => t.dataset.photosGfMore || '',
  render:() => (gdUsable() ? [menuBtn('data-gfm-new', '새 하위 폴더'), menuBtn('data-gfm-rename', '이름 바꾸기'), menuBtn('data-gfm-delete', '지우기', 'od-link-danger')].join('') : '<p class="od-link-status">구글 드라이브 · <span class="photos-gd-state">권한 없음</span></p>'),
  onAction:(b, {id, trigger}) => {
    if (b.matches('[data-gfm-new]')) return gdNewFolder(id);
    if (b.matches('[data-gfm-rename]')) return gdRenameFolder(id);
    if (b.matches('[data-gfm-delete]')) return gdTrashFolder(trigger, id);
  }});
// 구글 드라이브 칩이 '권한 없음'일 때 누르면: 이유(작은 글자) + [Drive 다시 연결](자료실과 같은 연결) 또는 [다시].
const gdMenu = createAnchoredMenu({id:'photosGdMenu', className:'od-link-menu', label:'구글 드라이브', historyKey:'kptuPhotosGdMenu',
  key:() => 'gd',
  render:() => `<p class="od-link-status">구글 드라이브 · <span class="photos-gd-state">${gdReconnectable() ? '권한 없음' : '못 읽음'}</span><br><small class="photos-gd-why">${esc(gdriveErrorText({message:gd.problem}))}</small></p>`
    + (gdReconnectable() ? menuBtn('data-gdm-reconnect', 'Drive 다시 연결') : menuBtn('data-gdm-retry', '다시')) + menuBtn('data-gdm-off', sources.gdrive ? '구글 드라이브 끄기' : '구글 드라이브 켜기'),
  onAction:b => {
    if (b.matches('[data-gdm-reconnect]')) return gdReconnectGo();
    if (b.matches('[data-gdm-retry]')) return gdRetry();
    if (b.matches('[data-gdm-off]')) return toggleSourceName('gdrive');
  }});
const photoMenu = createAnchoredMenu({id:'photosPhotoMenu', className:'od-link-menu', label:'사진 메뉴', historyKey:'kptuPhotosPhotoMenu',
  key:t => t.dataset.photosId || '',
  render:id => String(id).startsWith('gd:') ? [menuBtn('data-pm-select', '선택'), gdUsable() && tab !== 'trash' ? [menuBtn('data-pm-rename', '이름 바꾸기…'), menuBtn('data-pm-move', '폴더로 옮기기…'), menuBtn('data-pm-delete', '지우기', 'od-link-danger')].join('') : '<p class="od-link-status">구글 드라이브 · <span class="photos-gd-state">권한 없음</span></p>'].join('') : [menuBtn('data-pm-select', '선택'), (String(id).startsWith('ph:') ? phoneOps() : od.canDelete) && tab !== 'trash' ? menuBtn('data-pm-move', '폴더로 옮기기…') : '', menuBtn('data-pm-tag', '앨범에 넣기…'),
    od.canDelete || phone.state().trash ? menuBtn('data-pm-delete', '지우기', 'od-link-danger') : ''].join(''),
  onAction:(b, {trigger}) => {
    const it = itemOf(trigger); if (!it) return;
    // 고른 사진 위에서 연 메뉴는 고른 것 모두, 아니면 그 사진 하나.
    const group = select.active && select.has(it.id) ? pickedItems() : [it];
    if (b.matches('[data-pm-select]')) { if (!select.active) startSelect(it); else { select.add(it.id); paintSelect(); } return; }
    if (b.matches('[data-pm-rename]')) return gdRenamePhoto(it);
    if (b.matches('[data-pm-move]')) return openPick(trigger, {kind:'photos', ids:group.map(x => x.id)});
    if (b.matches('[data-pm-tag]')) return openPick(trigger, {kind:'tag', items:group});
    if (b.matches('[data-pm-delete]')) { if (!select.active || !select.has(it.id)) { select.stop(); select.start([it.id], it.id); } return deletePicked(trigger); }
  }});
const albumMenu = createAnchoredMenu({id:'photosAlbumMenu', className:'od-link-menu', label:'앨범 메뉴', historyKey:'kptuPhotosAlbumMenu',
  key:t => t.dataset.photosAlMore || '',
  render:() => [menuBtn('data-am-rename', '이름 바꾸기'), menuBtn('data-am-delete', '지우기(사진은 그대로)', 'od-link-danger')].join(''),
  onAction:(b, {id, trigger}) => { if (b.matches('[data-am-rename]')) return renameAlbum(id); if (b.matches('[data-am-delete]')) return deleteAlbum(trigger, id); }});
// [정렬 ▾]: 누른 자리 작은 메뉴(공용 anchored-menu). 고른 줄에 ✓. 동영상 길이는 동영상이 있을 때만.
const sortMenu = createAnchoredMenu({id:'photosSortMenu', className:'od-link-menu photos-sort-menu', label:'정렬 기준', historyKey:'kptuPhotosSortMenu',
  key:() => 'sort',
  render:() => sortChoices(filter === 'video' || shownList().some(x => x.video), sort).map(v =>
    `<button type="button" data-sort-pick="${v}" aria-pressed="${v === sort}"><span class="photos-sort-ck" aria-hidden="true">${v === sort ? '✓' : ''}</span>${esc(SORT_TEXT[v])}</button>`).join(''),
  onAction:b => setSort(b.dataset.sortPick)});
function setSort(v) {
  if (!SORT_TEXT[v] || v === sort) return;
  sort = v; savePrefs(); paintSortButton();
  select.stop(); resetList();
  fFor = null; fItems = []; pFor = null; pItems = [];
  if (aItems.length) aItems = aItems.slice().sort(sortCompare(sort));
  render(); window.scrollTo?.(0, 0);
}
// 고르기 판: 옮길 폴더(나무 순서, 들여쓰기) 또는 넣을 앨범. 무엇을 할지는 pickFor에 둔다.
let pickFor = null;
const pickMenu = createAnchoredMenu({id:'photosPickMenu', className:'od-link-menu photos-pick-menu', label:'고르기', historyKey:'kptuPhotosPickMenu',
  key:() => pickFor?.kind || '',
  render:kind => {
    if (kind === 'gdphotos') {
      const here = tab === 'folders' ? gdAt : null;
      return '<p class="od-link-status">어느 구글 드라이브 폴더로 옮길까요?</p>' + gdTargets().map(r => `<button type="button" data-pick-gd="${esc(r.id)}" style="padding-left:${10 + r.indent * 12}px"${r.id === here ? ' disabled aria-disabled="true"' : ''}><span aria-hidden="true">\u{1F4C1}</span> ${esc(r.name)}${r.id !== 'root' && !r.enabled ? '<span class="photos-fx-place"> · 꺼짐</span>' : ''}</button>`).join('');
    }
    if (kind === 'phfolder' || kind === 'phphotos') {
      const rows = phonePickRows(phoneFolderList(), kind === 'phfolder' ? {moving:pickFor.id} : {here:tab === 'folders' ? pAt : null});
      return '<p class="od-link-status">어느 폰 폴더로 옮길까요?</p>' + rows.map(r => `<button type="button" data-pick-phone="${esc(r.id)}" style="padding-left:${10 + r.indent * 12}px"${r.current ? ' disabled aria-disabled="true"' : ''}><span aria-hidden="true">\u{1F4C1}</span> ${esc(r.name)}${places.has('ph:' + r.id) ? `<span class="photos-fx-place"> · ${esc(places.get('ph:' + r.id))}</span>` : ''}</button>`).join('');
    }
    if (kind === 'tag') return cards().map(c => menuBtn(`data-pick-tag="${esc(c.id)}"`, `#${esc(c.name)} <span class="photos-pick-n">${c.count}</span>`)).join('') + menuBtn('data-pick-newtag', '+ 새 앨범…');
    if (!tree) return '<p class="od-link-status">폴더를 읽지 못했어요</p>';
    const rows = photoMoveTargets(tree, kind === 'folder' ? {moving:pickFor.id} : {here:tab === 'folders' ? at : null});
    // 같은 이름 폴더는 위치 이름(폴더 줄과 같은 규칙).
    const here = folderPlaceLabels([tree.top, ...tree.folders], f => odFolderPlace(tree, f));
    return '<p class="od-link-status">어느 폴더로 옮길까요?</p>' + rows.map(r => `<button type="button" data-pick-folder="${esc(r.id)}" style="padding-left:${10 + r.indent * 12}px"${r.current ? ' disabled aria-disabled="true"' : ''}><span aria-hidden="true">\u{1F4C1}</span> ${esc(r.name)}${here.has(r.id) ? `<span class="photos-fx-place"> · ${esc(here.get(r.id))}</span>` : ''}</button>`).join('');
  },
  onAction:b => {
    const p = pickFor; pickFor = null; if (!p) return;
    if (b.dataset.pickGd) return gdMovePicked(p.items, b.dataset.pickGd);
    if (b.dataset.pickPhone) return p.kind === 'phfolder' ? movePhoneFolder(p.anchor, p.id, b.dataset.pickPhone) : movePhonePhotos(p.anchor, p.items, b.dataset.pickPhone);
    if (b.dataset.pickFolder) return p.kind === 'folder' ? moveFolder(p.id, b.dataset.pickFolder) : movePhotos(p.ids, b.dataset.pickFolder);
    if (b.dataset.pickTag) { const t = (tags || []).find(x => x.id === b.dataset.pickTag); if (t) tagItems(t, p.items); return; }
    if (b.matches('[data-pick-newtag]')) return newAlbum(p.items);
  }});
async function openPick(trigger, what) {
  if (busy) return;
  // PHOTO-폴더스위치 ③: 폰 사진만 고르면 폰 폴더로(앱 0.4.1+), 원드라이브 사진만이면 원드라이브 폴더로. 섞이면 원드라이브 사진만(다른 출처 사이 옮기기는 없음).
  if (what.kind === 'photos') {
    // S46-24 ④: 구글 드라이브 사진만 고르면 구글 드라이브 폴더로(맨 위 층을 먼저 읽음). 섞이면 구글 드라이브 사진은 뺀다.
    const gdIds = what.ids.filter(id => String(id).startsWith('gd:'));
    if (gdIds.length && gdIds.length === what.ids.length) {
      if (!gdUsable()) return notify('구글 드라이브 · 권한 없음');
      await gdLoadLevel('root');
      const byId = new Map([...shownList(), ...gdItems, ...gdFItems].map(x => [x.id, x]));
      const list = gdIds.map(id => byId.get(id)).filter(Boolean);
      if (!list.length || !trigger.isConnected) return;
      pickFor = {kind:'gdphotos', items:list, anchor:trigger}; pickMenu.open(trigger); return;
    }
    if (gdIds.length) { notify('구글 드라이브 사진은 따로 골라 옮겨 주세요.'); what = {...what, ids:what.ids.filter(id => !String(id).startsWith('gd:'))}; }
    const ph = what.ids.filter(id => String(id).startsWith('ph:')), odIds = what.ids.filter(id => !String(id).startsWith('ph:'));
    if (ph.length && !odIds.length) {
      if (!phoneOps()) return notify('폰 사진을 옮기려면 앱 새 판이 필요해요.');
      await loadPhoneFolders();
      const byId = new Map([...shownList(), ...pItems, ...aItems].map(x => [x.id, x]));
      what = {kind:'phphotos', items:ph.map(id => byId.get(id)).filter(Boolean)};
      if (!what.items.length || !trigger.isConnected) return;
      pickFor = {...what, anchor:trigger}; pickMenu.open(trigger); return;
    }
    if (ph.length) notify('폰 사진은 따로 골라 옮겨 주세요(원드라이브 사진만 옮겨요).');
    what = {...what, ids:odIds};
  }
  if (what.kind === 'phfolder') { await loadPhoneFolders(); if (!trigger.isConnected) return; pickFor = {...what, anchor:trigger}; pickMenu.open(trigger); return; }
  if (what.kind === 'tag') {
    const ok = what.items.filter(x => x.kind !== 'gdrive');
    if (ok.length < what.items.length) notify('구글 드라이브 사진은 아직 앨범에 못 넣어요.');
    what = {...what, items:ok};
  }
  if (what.kind === 'tag' && !what.items.length) return;
  if (what.kind === 'tag') await loadTags(); else await loadTree();
  if (what.kind === 'tag' && !tags) return notify('앨범을 읽지 못했어요.', {error:true});
  if (what.kind !== 'tag' && !tree) return notify(`폴더를 읽지 못했어요: ${treeFailed}`, {error:true});
  if (!trigger.isConnected) return;
  pickFor = what; pickMenu.open(trigger);
}

// ---- 끌어 놓기(PC): 고른 사진(또는 잡은 한 장)을 왼쪽 폴더 나무의 폴더 위에 놓으면 그 폴더로 옮긴다. ----
const DRAG_TYPE = 'application/x-kptu-photos';
body.addEventListener('dragstart', e => {
  const b = e.target.closest?.('[data-photos-open]');
  if (!b || tab !== 'folders' || !treeWide() || !od.canDelete) { if (b) e.preventDefault(); return; }
  const it = itemOf(b); if (!it) return;
  const ids = select.active && select.has(it.id) ? pickedItems().map(x => x.id) : [it.id];
  drag = null; cancelHold();
  e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids)); e.dataTransfer.setData('text/plain', `사진 ${ids.length}장`); e.dataTransfer.effectAllowed = 'move';
  b.classList.add('nx-dragging');
});
body.addEventListener('dragend', e => { e.target.closest?.('[data-photos-open]')?.classList.remove('nx-dragging'); body.querySelectorAll('.nx-drop').forEach(x => x.classList.remove('nx-drop')); });
const dropRow = e => (e.dataTransfer?.types || []).includes(DRAG_TYPE) ? e.target.closest?.('[data-photos-fx-tree] [data-photos-folder]') : null;
body.addEventListener('dragover', e => { const row = dropRow(e); if (!row) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; body.querySelectorAll('.nx-drop').forEach(x => { if (x !== row) x.classList.remove('nx-drop'); }); row.classList.add('nx-drop'); });
body.addEventListener('dragleave', e => { const row = dropRow(e); if (row && !row.contains(e.relatedTarget)) row.classList.remove('nx-drop'); });
body.addEventListener('drop', e => {
  const row = dropRow(e); if (!row) return;
  e.preventDefault(); row.classList.remove('nx-drop');
  let ids = [];
  try { ids = JSON.parse(e.dataTransfer.getData(DRAG_TYPE) || '[]').filter(x => typeof x === 'string'); } catch { /* 모양이 다르면 놓지 않음 */ }
  if (ids.length) movePhotos(ids, row.dataset.photosFolder);
});
// 폰: 폴더 줄·앨범 카드를 꾹 누르면 그 ⋯ 메뉴(PC 우클릭과 같은 메뉴).
body.addEventListener('pointerdown', e => {
  if (e.pointerType !== 'touch' || !e.isPrimary || multiTouchActive()) return;
  const row = e.target.closest?.('[data-photos-folder],[data-photos-pf],[data-photos-gf],[data-photos-album]'); if (!row || e.target.closest('.nx-more,.photos-album-more,.photos-fx-sw')) return;
  clearTimeout(rowHold?.timer);
  rowHold = {x:e.clientX, y:e.clientY, timer:setTimeout(() => {
    rowHold = null;
    const more = row.querySelector('.nx-more,.photos-album-more'); if (!more) return;
    ateClick = true; navigator.vibrate?.(12);
    const r = row.getBoundingClientRect(); window.KPTUContextMenu?.pinAt?.(more, r.left + Math.min(r.width / 2, 48), r.top + r.height / 2);
    (row.dataset.photosFolder ? folderMenu : row.dataset.photosPf !== undefined ? phoneFolderMenu : row.dataset.photosGf !== undefined ? gdFolderMenu : albumMenu).open(more);
  }, HOLD_MS)};
});
body.addEventListener('pointermove', e => { if (rowHold && Math.hypot(e.clientX - rowHold.x, e.clientY - rowHold.y) > HOLD_MOVE) { clearTimeout(rowHold.timer); rowHold = null; } });
for (const t of ['pointerup', 'pointercancel']) body.addEventListener(t, () => { if (rowHold) { clearTimeout(rowHold.timer); rowHold = null; } });
body.addEventListener('click', e => { if (ateClick && e.target.closest?.('[data-photos-folder],[data-photos-pf],[data-photos-gf],[data-photos-album]')) { ateClick = false; e.preventDefault(); e.stopPropagation(); } }, true);
TREE_WIDE?.addEventListener?.('change', () => { if (tab === 'folders') renderFolders(); });

// [폴더]·[앨범] 안의 겹(폰 뒤로가기 = 한 단계 위)을 닫는다(다른 칩으로 갈 때).
function closeSubLayers() {
  for (const l of [folderLayer, albumLayer]) l?.close();
  folderLayer = null; albumLayer = null;
}
function setTab(nextTab, {fromBack = false} = {}) {
  nextTab = validTab(nextTab);
  if (nextTab === tab) return;
  select.stop(); nameDone(null);
  if (!fromBack) closeSubLayers(); else { folderLayer = null; albumLayer = null; }
  tab = nextTab;
  window.KPTURouter?.setPlace?.('photos', tab === 'all' ? {} : {tab});
  // 뒤로가기 = 이전 칩: [달력]·[휴지통]은 라우터 겹 하나라 뒤로가면 [사진]으로 돌아온다.
  if (tab !== 'all' && !tabLayer) tabLayer = window.KPTURouter?.layer?.open('photos-tab', {reopen:() => setTab(nextTab), close:() => { tabLayer = null; setTab('all', {fromBack:true}); return true; }}) || null;
  if (tab === 'all' && tabLayer && !fromBack) { const l = tabLayer; tabLayer = null; l.close(); }
  render();
}
function goDay(day) {
  // [달력] 겹을 닫는 뒤로가기(popstate)가 스크롤을 되돌릴 수 있으므로, 그것이 끝난 뒤에 그날로 간다.
  const settled = tabLayer ? new Promise(ok => { const t = setTimeout(ok, 400); window.addEventListener('popstate', () => { clearTimeout(t); setTimeout(ok, 0); }, {once:true}); }) : Promise.resolve();
  setTab('all');
  settled.then(() => { if (tab === 'all') jumpTo(day, dayCursor(day), dayHead(day)); });
}
function setFilter(v) {
  filter = validFilter(v); savePrefs();
  select.stop(); resetList(); calData.clear(); render();
}

root.addEventListener('click', event => {
  const b = event.target.closest('button'); if (!b || !root.contains(b)) return;
  if (b.matches('[data-photos-open]')) {
    if (ateClick) { ateClick = false; return; }
    const item = itemOf(b); if (!item) return;
    if (select.active) { if (event.shiftKey) select.range(shownList().map(x => x.id), item.id); else select.toggle([item.id]); paintSelect(); return; }
    if (tab === 'trash') return startSelect(item);
    return openViewer(Number(b.dataset.photosOpen));
  }
  if (odHost.contains(b) && settings.click(b, odHost)) return;
  if (b.matches('[data-photos-tab]')) return setTab(b.dataset.photosTab);
  if (b.matches('[data-photo-size]')) { if (albumSizing()) { changeAlbumView(Number(b.dataset.photoSize)); return; } if (sizer.changeCols(Number(b.dataset.photoSize))) sizeChanged(); return; }
  if (b.matches('[data-photos-src]')) return sourceClick(b);
  if (b.matches('[data-photos-phone-ask]')) return phone.ask();
  if (b.matches('[data-od-link]')) return linkMenu.open(b);
  if (b.matches('[data-photos-sel-off]')) { select.stop(); return paintSelect(); }
  if (b.matches('[data-photos-day-pick]')) { select.toggle(items.filter(x => x.day === b.dataset.photosDayPick).map(x => x.id), {anchor:false}); return paintSelect(); }
  if (b.matches('[data-photos-act-star]')) return starPicked();
  if (b.matches('[data-photos-sort]')) return sortMenu.open(b);
  if (b.matches('[data-photos-act-share]')) return shareButton(b);
  if (b.matches('[data-photos-act-down]')) return downloadPicked();
  if (b.matches('[data-photos-act-delete]')) return deletePicked(b);
  if (b.matches('[data-photos-act-rename]')) { const one = pickedItems(); if (one.length === 1) gdRenamePhoto(one[0]); return; }
  if (b.matches('[data-photos-act-move]')) return openPick(b, {kind:'photos', ids:pickedItems().map(x => x.id)});
  if (b.matches('[data-photos-act-tag]')) return openPick(b, {kind:'tag', items:pickedItems()});
  if (b.matches('[data-photos-act-untag]')) return untagPicked();
  if (tidyClick(b)) return;
  if (folderClick(b)) return;
  if (albumClick(b)) return;
  if (b.matches('[data-photos-restore]')) return trashRun(pickedItems().map(x => x.id), 'restore');
  if (b.matches('[data-photos-purge]')) return purgeAsk(b, pickedItems().map(x => x.id));
  if (b.matches('[data-photos-purge-all]')) return purgeAsk(b, (trash || []).map(x => x.id));
  if (b.matches('[data-photos-trash-retry]')) return renderTrash({reload:true});
  if (b.matches('[data-photos-cal]')) { calCursor = Number(b.dataset.photosCal) < 0 ? prevMonth(calCursor) : nextMonth(calCursor); return renderCalendar(); }
  if (b.matches('[data-photos-cal-day]')) return goDay(b.dataset.photosCalDay);
  if (b.matches('[data-photos-name-cancel]')) return nameDone(null);
  if (b.matches('[data-photos-newest]')) { resetList(); render(); return window.scrollTo?.(0, 0); }
  if (b.matches('[data-photos-more]')) { failed = ''; paintList(); return loadMore(); }
  if (b.matches('[data-photos-connect]')) return settings.connect();
  if (b.matches('[data-photos-folder]')) return settings.run(settings.startBrowse);
  if (b.matches('[data-photos-retry]')) return ensureOd(true).then(render);
});
root.addEventListener('change', event => {
  if (event.target.matches('[data-photos-filter]')) setFilter(event.target.value);
});
root.addEventListener('keydown', event => {
  if (event.key === 'Escape' && select.active && !photoStripOpen()) { event.preventDefault(); select.stop(); paintSelect(); }
});

// [사진] 목록만 비운다(별표·연결은 그대로). 받는 중이던 쪽은 버린다.
function clearLists() {
  items = []; next = null; ended = false; renderedIds = []; odList = []; odEnded = false; phList = []; phNext = 0; phEnded = false; hidden.clear();
  gdItems = []; gdEnded = false; gdCursor = null;
}
function resetList() {
  run++; clearLists(); loading = null; failed = ''; from = null; rendered = 0; monthsFor = ''; bar = []; io?.disconnect();
}

// ---- 출처 아이콘(PHOTO-출처 ①) ----
function paintSources() {
  const btns = sourceButtons(sources, {phone:phone.available(), gdrive:gd.allowed, gdriveProblem:gd.problem});
  for (const b of root.querySelectorAll('[data-photos-src]')) {
    const m = btns.find(x => x.name === b.dataset.photosSrc);
    if (b.dataset.photosSrc === 'phone' || b.dataset.photosSrc === 'gdrive') b.hidden = !m;
    if (b.dataset.photosSrc === 'gdrive') { if (m?.problem) b.dataset.problem = m.problem; else delete b.dataset.problem; }
    if (!m) continue;
    b.setAttribute('aria-pressed', String(m.on));
    if (b.dataset.photosSrc === 'onedrive') { const base = b.getAttribute('aria-label') || '원드라이브'; const t = `${base.split(' · ')[0]} · ${m.on ? '켜짐' : '꺼짐'}`; b.title = t; b.setAttribute('aria-label', t); }
    else { b.title = m.label; b.setAttribute('aria-label', m.label); }
  }
}
function sourcesChanged() { select.stop(); resetList(); calData.clear(); phStarItems = null; aFor = null; pAt = null; gdAt = null; gdTrail = []; paintSources(); render(); }
function sourceClick(b) {
  const name = b.dataset.photosSrc;
  // 구글 드라이브: 칩은 운영자 기능이 있을 때만 보인다. 권한이 없거나 읽지 못했으면 이유 + [Drive 다시 연결] 작은 메뉴.
  if (name === 'gdrive') { if (!gd.allowed) return; if (gd.problem) return gdMenu.open(b); }
  // 원드라이브가 아직 연결 전이거나 문제가 있으면 지금처럼 연결 메뉴.
  if (name === 'onedrive' && (!ready() || odFault)) return linkMenu.open(b);
  toggleSourceName(name);
}
function toggleSourceName(name) {
  sources = toggleSource(sources, name);
  viewPrefs.set('photo_sources', sourcesValue(sources), {rejectable:true});
  if (name === 'phone' && sources.phone && !phoneUsable()) phone.ask();
  sourcesChanged();
  if (name === 'gdrive' && sources.gdrive) startGdSync(run);
}
// 원드라이브 아이콘 꾹 누르기(PC 우클릭) = 연결 메뉴(폴더 바꾸기·하위 폴더·연결 끊기). 꾹 누른 뒤 오는 누르기(켜기/끄기)는 먹는다.
let srcHold = null, srcAte = false;
root.addEventListener('contextmenu', e => {
  const b = e.target.closest?.('[data-photos-src="onedrive"]'); if (!b) return;
  e.preventDefault();
  if (srcAte) return;
  linkMenu.open(b);
});
root.addEventListener('pointerdown', e => {
  const b = e.target.closest?.('[data-photos-src="onedrive"]'); srcAte = false; if (!b || e.pointerType === 'mouse') return;
  clearTimeout(srcHold?.timer);
  srcHold = {x:e.clientX, y:e.clientY, timer:setTimeout(() => { srcHold = null; srcAte = true; navigator.vibrate?.(12); linkMenu.open(b); }, HOLD_MS)};
});
root.addEventListener('pointermove', e => { if (srcHold && Math.hypot(e.clientX - srcHold.x, e.clientY - srcHold.y) > HOLD_MOVE) { clearTimeout(srcHold.timer); srcHold = null; } });
for (const t of ['pointerup', 'pointercancel']) root.addEventListener(t, () => { if (srcHold) { clearTimeout(srcHold.timer); srcHold = null; } });
root.addEventListener('click', e => { if (srcAte && e.target.closest?.('[data-photos-src]')) { srcAte = false; e.preventDefault(); e.stopPropagation(); } }, true);
window.addEventListener('kptu:view-prefs-rejected', e => {
  if (!(e.detail?.paths || []).includes('photo_sources')) return;
  sources = parseSources(viewPrefs.get('photo_sources'));
  notify('출처 켜기/끄기를 저장하지 못했어요. 잠시 뒤 다시 해 주세요.', {error:true});
  if (window.KPTURouter?.current === 'photos') sourcesChanged();
});
window.addEventListener('kptu:view-prefs-rejected', e => {
  if (!(e.detail?.paths || []).includes('phone_folders_off')) return;
  phoneOff = parsePhoneOff(viewPrefs.get('phone_folders_off')); phoneOffChanged();
  notify('폰 폴더 스위치를 저장하지 못했어요. 잠시 뒤 다시 해 주세요.', {error:true});
  if (window.KPTURouter?.current === 'photos') { if (tab === 'folders') renderFolders(); else render(); }
});
// 폰 사진 접근이 바뀌면(처음 허용·설정에서 바꿈) 목록을 새로.
let entering = false;
phone.onChange(() => { pFolders = null; pFor = null; pItems = []; tidy.reset(); tidyView = null; if (entering || window.KPTURouter?.current !== 'photos') return; sourcesChanged(); });
async function enter() {
  readPrefs();
  const placed = window.KPTURouter?.place?.('photos')?.tab;
  if (placed && validTab(placed) !== tab) tab = validTab(placed);
  const back = takeOdReturn();
  if (!odReady) body.innerHTML = waitHtml({rows:4, h:72});
  paintSources();
  entering = true;
  try { await Promise.all([ensureOd(), phone.hello(), ensureGd()]); } finally { entering = false; }
  paintSources();
  ensureStars(run).then(() => { if (tab === 'all') paintStars(); });
  render();
  if (back) settings.finishReturn(back).then(render);
  startSync(run);
  startGdSync(run);
}
window.addEventListener('kptu:view-changed', event => {
  if (event.detail?.view === 'photos') return;
  closePhotoStrip({fromBack:true, restore:false});
  tabLayer = null; folderLayer = null; albumLayer = null; select.stop({fromBack:true}); settings.drop(); odHost.replaceChildren(); io?.disconnect(); nameDone(null);
  if (batch) commitBatch();
});
window.addEventListener('kptu:session-changed', () => {
  if (owner === ownerScope(rt)) return;
  owner = ownerScope(rt);
  closePhotoStrip({fromBack:true, restore:false});
  batch = null; resetList(); syncAt = 0; od = {...OD_NONE}; odReady = false; odFault = false; odMessage = ''; tab = 'all'; filter = 'all'; colsSaved = null; prefsRead = false; sort = DEFAULT_SORT; paintSortButton(); calCursor = null;
  trash = null; calData.clear(); starSet.clear(); starDay.clear(); starsReady = null; shareReady = null; settings.drop(); sources = parseSources(null); phStarItems = null;
  pFolders = null; pFoldersFailed = ''; pAt = null; pFor = null; pItems = []; phoneOff = new Set(); pPending = []; manageAsked = false;
  tidy.reset(); tidyOpen = false; tidyView = null;
  gd = {allowed:false, problem:'', foldersOn:0, checked:false}; gdItems = []; gdEnded = false; gdCursor = null; gdSyncAt = 0; gdLevels.clear(); gdLevelFailed.clear(); gdAt = null; gdTrail = []; gdFFor = null; gdFItems = []; gdClear();
  if (gdPlayUrl) { URL.revokeObjectURL(gdPlayUrl); gdPlayUrl = ''; }
  tree = null; treeFailed = ''; at = null; fFor = null; fItems = []; openSet.clear(); tags = null; links = []; tagsFailed = ''; album = null; aFor = null; aItems = []; albumViewChosen = null; folderLayer = null; albumLayer = null; nameDone(null);
  $('[data-photos-filter]').value = 'all'; body.replaceChildren(); odHost.replaceChildren();
});
window.KPTURouter?.on?.('photos', enter);
window.KPTUPhotos = {refresh:() => { resetList(); trash = null; calData.clear(); tree = null; fFor = null; pFolders = null; pFor = null; tags = null; aFor = null; gdLevels.clear(); gdFFor = null; return Promise.all([ensureOd(true), ensureGd(true)]).then(() => { paintSources(); render(); }); }};
if (window.KPTURouter?.current === 'photos') enter();
})();
