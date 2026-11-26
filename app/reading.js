// S68-09 READ-읽을거리함 화면(?view=reading, 메뉴 '읽을 거리'). #readingView의 유일한 그리기 주인. 명진 11/22 13:28 "Raindrop 가져올 것 ㄱ", 13:42 "B: 메뉴에 새 칸".
// - 목록(시안 ②): 줄마다 안 읽음 점 · 제목 · 사이트 · 날짜 한 줄, 사업영역 꼬리표. 보기 탭 [안 읽음 n][전체][밑줄](공용 ⑤, 폰은 하단바 위 가운데 · 좌우로 밀어 옆 탭 — S68-48). [+ 추가]는 주소 한 칸.
// - 보기(시안 ③): 받아 둔 원문 사본 + 고른 글 [밑줄 저장]·메모(공용 text-select-bar.js·text-highlights.js, 밑줄 표 app_news_highlights 종류 'reading')
//   + [밑줄을 노트로](밑줄 문장 + 출처 → 기존 노트 만들기 길) · [사업에 연결](공용 사업영역 고르기 창) · [읽음]. 폰은 목록 대신(뒤로 = 목록), 761px~는 오른쪽 칸.
// - 원래 페이지 링크는 늘 보인다. 저장·원문 받기 실패는 한 줄 상태로. 원문은 글자로만 그린다(textContent — HTML·스크립트 실행 없음).
// - 서버 저장만(reading-data.js, owner RLS). 기기 저장 없음.
// - S68-27 READ-보관기록일원화(명진 11/22 "2. A" → 21:37 "저장된 기록도 일원화 하지 왜?"): 보관의 원본은 이 표(app_reading_items) 하나다.
//   News에서 보관한 글도 이 표의 줄(원래 글 연결 칸 news_article_id·outside_article_id, DB 20261122230000)이라 목록은 이 표만 읽는다(두 곳 합치기 없음).
// - S68-29(명진 11/23 02:23 "news 란을 만들라는 게 아니라 뉴스에서 보관하면 그냥 여기로 오는 개념"): News에서 보낸 줄도 평범한 읽을 거리 한 줄이다 —
//   'News' 꼬리표·[News] 칩 없음, 줄 모양·⋯·밀기·고르기 단추가 직접 넣은 줄과 같다. 다른 점은 화면 밖 두 가지뿐:
//   ① (한 칸 폭에서만 — S70-58 두 칸에서는 오른쪽 칸에 연다) News 기능 키 'outside'가 있는 사람이 그런 줄을 누르면 News 지금 글 보기(원문·News에서 그은 밑줄)를 라우터 openFrom으로 연다(뒤로 한 번 = 읽을 거리).
//      글을 먼저 읽어 두고(ready) 옮기는 순간 글 보기를 바로 그린다 — 읽을 거리 목록이 먼저 보이지 않는다(S68-54).
//   ② [삭제]는 News 줄 ★ 끄기와 같은 dropSaved(서버 함수 app_reading_keep — 이 줄을 지우고 News 쪽 표시도 끔, 5초 [되돌리기]). 이름은 똑같이 '삭제'.
//   키가 없거나 답을 모르면 News 쪽 길은 부르지 않는다(연결된 줄도 이 화면 보기로 열고, 삭제는 읽을 거리 지우기).
// - S68-33 READ-글자크기(명진 11/23 02:30 "+ - 버튼 텍스트 크기"): 글 보기 머리 단추줄 끝 [−][+] — 공용 text-size.js(News 글 상세와 같은 다섯 단계·서버 값 news_font).
import {DEFAULT_FILTER, keepFilter, filterEntries, filterOptions, nextFilter, entriesOf, linkOf, emptyText, lineOf, stateLine, canRetry, requestLine, paragraphs, sourceOf, readingUrl, isId, refetchBatches, stopsAuto, readingNote} from './reading-model.mjs';
import {CHANGED, listItems, getItem, addItem, removeItem, setRead, setArea, setTitle, fixLinkedTitles, fetchBody, fetching, folderColumn, readFolders, createFolder, renameFolder, deleteFolder, moveItems} from './reading-data.js';
import {OUTSIDE, OUTSIDE_NAME, NAME_MAX, keepFolder, folderOfRow, inFolder, folderRows, sortFolders, nextSort, folderName, nameTaken} from './reading-folders-model.mjs';
import {ftBoxHtml, ftFolderRowHtml} from './folder-tree-ui.mjs';
import {setDragGhostImage} from './drag-ghost.js';
import {loadHighlights, highlightsNow, sourceHighlights, highlightById, onHighlights, paintMarks, bindMarks, saveFromSelection, noteFromSelection, noteWithNotice, revealMark, openMarkMenu} from './text-highlights.js';
import {highlightRowHtml} from './now-highlights.js';
import {sourceTag} from './text-highlights-model.mjs';
import {visibleMarks, marksNewsOn} from './note-news-marks-model.mjs';
import {requestNewsOpen} from './news-request.mjs';
import {openOnScreen} from './source-open.js';
import {requestBasketNote, requestNoteDocOpen} from './basket-note-tasks.js';
import {createNoteDoc} from './basket-data.js';
import {bindSelectZone} from './text-select-bar.js';
import {renderFilterChips} from './filter-chips.js';
import {createAnchoredMenu} from './anchored-menu.js';
import {openAreaOrgPicker, usedKeysNow, catalogAreas, areaTree, areaChipText} from './area-org-picker.js';
import {waitHtml, failHtml, emptyEl} from './wait-state.js';
import {notify, askConfirm, askText} from './small-notice.js';
import {word, APP_NAME} from './brand/brand.mjs';
import {myFeaturesOrNull} from './my-features.js';
import {bindRowSwipe, claimedSince, PICK, EDIT} from './row-swipe.js';
import {textSizeHtml, paintTextSize} from './text-size.js';
import {copyText} from './copy-text.js';
import {isPhoneApp} from './phone-push-model.mjs';
import {bookmarkletLine, saveAddress} from './save-bookmarklet-model.mjs';
import {createMemoThread, memoRowHtml} from './memo-thread.js';
import {memoRows} from './memo-model.mjs';
import {memosNow, memoState, loadMemos, onMemos, memoExists} from './memo-store.js';
import {openMemoSource} from './memo-open.js';
import {SPLIT_QUERY} from './screen-width.mjs';
import {mountSplitResize} from './split-resize.js';
import {followPane} from './follow-pane.js';
import {registerScreenFind, refreshScreenFind, finderOf, toolsBox} from './screen-find.js';

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const btn = (cls, text, data) => { const b = el('button', cls, text); b.type = 'button'; for (const [k, v] of Object.entries(data || {})) b.dataset[k] = v; return b; };
const view = () => document.getElementById('readingView');
const wide = () => window.matchMedia?.('(min-width: 761px)').matches;
// S70-58 READ-두칸보기(명진 11/26 06:12 "읽을 거리랑 저장한 글 왼쪽 목록 오른쪽 본문 형태로 개편 드래그 폭 조절 가능하게 / 폴드 펼침 이야기임"):
// 칸 나누기 폭(screen-width.mjs 600px~ — 조직 관리·자료실과 같은 값)이면 왼쪽 목록 | 오른쪽 글 보기 두 칸. 목록은 그대로 남고, 처음 들어오면 맨 위 글을 오른쪽에 연다
// (저절로 연 글은 읽음으로 치지 않음 — 읽을 거리와 같은 규칙). 가운데 경계는 공용 split-resize.js(서버 view_prefs.split_ratio.reading).
// News에서 온 줄도 두 칸에서는 오른쪽 칸에 연다(목록이 남아야 하므로). 그 글의 News 쪽 밑줄도 같이 칠한다. 그 아래 폭(폰·접은 폴드)은 지금처럼 목록 → 글(뒤로 = 목록).
const SPLIT = window.matchMedia?.(SPLIT_QUERY);
const split = () => !!SPLIT?.matches;
const here = () => window.KPTURouter?.current === 'reading' && !document.hidden;
// S69-BM: PC 크롬 즐겨찾기 막대용 저장 버튼(북마클릿) 줄은 마우스로 쓰는 넓은 화면에서만 그린다(폰·펼친 폴드·폰 앱에서는 만들지 않음).
const pcBrowser = () => wide() && !!window.matchMedia?.('(pointer: fine)').matches && !isPhoneApp(navigator.userAgent);
const bookmarklet = () => bookmarkletLine(saveAddress(window.KPTUAuth?.APP_ROOT || new URL('./', location.href).href));

function install() {
  if (document.getElementById('readingView')) return;
  document.getElementById('appView')?.insertAdjacentHTML('beforeend', '<section id="readingView" class="view-panel hidden" aria-label="저장한 글"><div class="rd-wrap"><div class="rd-list" data-rd-list></div><div class="rd-detail" data-rd-detail hidden></div></div></section>');
}

const state = {rows: [], loaded: false, failed: false, filter: DEFAULT_FILTER, open: null, body: null, bodyFor: null, adding: false, addError: '', lines: new Map(), scope: '',
  newsOn: false, marksNewsOn: true, editing: null, editBusy: false, editNote: '', noteBusy: null,
  // S70-83 폴더: folders(서버 app_reading_folders), foldersReady(표·칸이 있는 서버 — 아니면 '폴더 없음' 한 줄만), folder(고른 곳: ''·OUTSIDE·폴더 id), boxOpen(폴더 상자 접기 — 화면 메모리만).
  folders: [], foldersReady: false, folder: '', boxOpen: true};
const scopeNow = () => { const c = window.KPTURuntime?.context?.read?.(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
const rowOf = id => state.rows.find(r => r.id === id) || null;
// S70-24 READ-저장한글기본전체(명진 11/25 "전체를 기본으로 / 탭 누르면 전체가 나오는"): 보기 탭 상태 주인은 state.filter 하나.
// 메뉴로 들어오면(라우터가 주소의 자리 값을 지움) 늘 [전체], 주소에 ?tab=이 적혀 들어오면(뒤로가기·새로고침·링크) 그 보기.
// 고른 보기는 주소에만 적는다(replaceState — 기록 칸을 늘리지 않음). 기기·서버에 '마지막 보기'를 따로 두지 않는다.
const filterFromUrl = () => keepFilter(window.KPTURouter?.place?.('reading')?.tab);
function setFilter(v) {
  state.filter = keepFilter(v);
  window.KPTURouter?.setPlace?.('reading', {tab: state.filter === DEFAULT_FILTER ? null : state.filter});
}
// S70-83 고른 폴더도 보기 탭과 같은 방식(주소 ?folder=에만, 기록 칸 늘리지 않음). 폴더 목록을 읽기 전에는 주소 값을 그대로 들고 있다가 읽은 뒤 맞춘다.
const folderFromUrl = () => String(window.KPTURouter?.place?.('reading')?.folder || '');
function setFolder(v) {
  state.folder = v || '';
  window.KPTURouter?.setPlace?.('reading', {folder: state.folder || null});
}
const folderNow = () => (state.foldersReady ? keepFolder(state.folder, state.folders) : '');
const folderById = id => state.folders.find(f => f.id === id) || null;
// S69-04 MARK-밑줄한목록(명진 11/24 "노트 밑줄에 있는 것들 저장한 글 밑줄에 없음 두개 동기화"): [밑줄] 탭은 글 줄 거르기가 아니라
// 내가 그은 밑줄 전부(저장한 글에 있든 없든) — 노트 › 밑줄과 같은 원본(text-highlights.js 목록)·같은 규칙(visibleMarks)이라 같은 목록·같은 개수.
// 잠근 노트 폴더가 있고 안 풀렸으면 노트 밑줄은 뺀다(이 화면은 노트 목록을 모른다 — 풀리면 노트 › 밑줄과 같아진다).
const marksNow = () => visibleMarks(highlightsNow(), {newsOn: state.marksNewsOn, noteHidden: () => !!window.KPTUFeatureLock?.notesHidden?.()});
const entriesNow = () => entriesOf(state.rows);
// S70-57(명진 11/26 "메뉴별 검색창은 '<메뉴>에서 찾기'로 통일 / 검색창은 하나로만"): 맨 위 칸이 '저장한 글에서 찾기' — 지금 탭 목록을
// 제목·매체(밑줄 탭은 밑줄 글·메모·글 제목, 메모 탭은 글 제목·메모)로 거른다. 이 화면 메모리만(서버 검색 없음).
let findText = '', findQuery = '';
// S70-67 SEARCH-비슷한것찾기: 공용 판정(띄어쓰기 무시·오타·초성·앞부분, 비슷한 말), 맞은 정도 순, 맞은 부분 굵게.
const finder = finderOf('reading', () => findText);
const ranked = (list, texts) => (findQuery ? finder().rank(list, texts) : list);
registerScreenFind('reading', {
  label: '저장한 글에서 찾기',
  active: () => window.KPTURouter?.current === 'reading' && !!view() && !view().classList.contains('hidden') && !view().querySelector('[data-rd-list]')?.hidden,
  value: () => (findQuery ? findText : ''),
  marks: '#readingView [data-rd-list]',
  apply: (raw, {again} = {}) => { findText = String(raw ?? ''); const next = findText.trim().toLowerCase(); if (next === findQuery && !again) return; findQuery = next; drawList(); },
});
// News에서 열 수 있는 줄의 원래 글({type,id}) — News 기능 키가 있을 때만.
const newsLinkOf = id => (state.newsOn ? linkOf(rowOf(id)) : null);
// S69 [수정](명진 11/24 "목록에서 ... 안에 수정 버튼도 있어야"): 어느 창으로 고치나 — 한 곳만.
// 'news': News에서 온 뉴스 기사(키가 있을 때) — 그 글 보기의 ⋯ [수정] 창(now-detail, 제목의 주인이 공용 기사라 거기서 고친다).
// 'own': 직접 넣은 줄·키가 없을 때 — 이 화면 글 보기 안의 제목·매체 칸(이 표가 제목의 주인).
// null: News에서 온 사회운동 글(키가 있을 때) — 제목은 수집한 그대로이고 News 글 보기에도 제목 수정이 없다.
const editKind = id => { const l = newsLinkOf(id); return !l ? 'own' : l.type === 'news' ? 'news' : null; };
let layer = null;

async function load() {
  if (state.scope !== scopeNow()) { state.scope = scopeNow(); state.rows = []; state.loaded = false; state.open = null; state.body = null; state.bodyFor = null; state.lines.clear(); state.newsOn = false; state.marksNewsOn = true; state.folders = []; state.foldersReady = false; autoTried.clear(); }
  const scope = state.scope;
  // newsOn: News 기능 키가 있다는 답일 때만 true(모르면 false — 그 사람에게 서버가 거절할 수 있는 길을 부르지 않는다).
  // marksNewsOn: [밑줄] 탭에 News·텔레그램 밑줄을 넣을지 — 노트 › 밑줄과 같은 규칙(marksNewsOn, 모르면 넣음).
  const news = myFeaturesOrNull().catch(() => null).then(features => { if (scope !== state.scope) return; state.newsOn = Array.isArray(features) && features.includes('outside'); state.marksNewsOn = marksNewsOn(features); });
  // S70-83: 폴더 표(app_reading_folders)는 목록과 함께 읽는다. 표나 글의 폴더 칸이 없는 서버(DB 적용 전)면 폴더 없이 지금처럼.
  const folders = readFolders().catch(() => ({ready: false, folders: []}));
  try { state.rows = await listItems(); state.failed = false; state.loaded = true; }
  catch { state.failed = true; }
  const got = await folders;
  if (scope === state.scope) { state.folders = sortFolders(got.folders); state.foldersReady = !!got.ready && folderColumn() === true; }
  await news;
  if (state.newsOn && state.loaded) void fixTitles(scope);
  void loadHighlights().then(() => draw()).catch(() => {});
  void loadMemos({force: true}); // S69-94: [메모 n]·[메모] 탭·글 아래 메모 칸(다 읽으면 onMemos가 다시 그린다)
}

// S69 READ-제목하나(명진 11/24 "목록에서 이상한 제목이 보임"): News에서 온 줄 중 사람이 글 보기에서 제목을 고친 기사(손으로 넣은 기사)는
// 그 제목이 주인이다. 목록을 읽을 때 사본이 다르면 사본을 고쳐(서버 저장) 목록·글 보기·검색·홈이 같은 제목을 보이게 한다.
async function fixTitles(scope) {
  let fixed = [];
  try { fixed = await fixLinkedTitles(state.rows); } catch { return; }
  if (scope !== state.scope || !fixed.length) return;
  for (const f of fixed) Object.assign(rowOf(f.id) || {}, f.row || {title: f.title});
  if (window.KPTURouter?.current === 'reading') draw();
}

// ---------- 사업영역 꼬리표 ----------
let areaNames = null;
async function loadAreas() {
  try {
    if (!window.KPTUProjectCatalog) await import('./project-catalog.js');
    const catalog = window.KPTUProjectCatalog, ctx = window.KPTURuntime?.context?.read?.();
    if (catalog?.load && ctx?.workspace?.id && ctx?.user?.id) await catalog.load({workspaceId: ctx.workspace.id, userId: ctx.user.id});
    return catalog?.snapshot?.().tree || [];
  } catch { return null; }
}
async function refreshAreaNames() {
  const rows = await loadAreas();
  if (!rows) return;
  const tree = areaTree(catalogAreas(rows));
  areaNames = id => areaChipText(tree, 'p:' + id) || '';
  draw();
}
const areaText = id => (id && areaNames ? areaNames(id) : '');

// ---------- 목록 ----------
let switchHost = null;
// S71-26: 화면 이름 줄의 ＋(글 추가). 그리기는 여기 한 번, 누르기는 bind()의 누르기 처리(상자에도 같은 처리를 붙인다).
const tools = toolsBox('reading', 'reading');
const addBtn = btn('rd-add icon-btn', '＋', {rdAdd: '1', ctxScreenItem: '글 추가'}); // S70-28: 빈 곳 우클릭 메뉴에도(context-menu.js — data-screen-tools-for로 찾음)
addBtn.setAttribute('aria-label', '글 추가'); addBtn.title = '글 추가';
tools.append(addBtn);
function rowEl(e) {
  const row = e.row, l = lineOf(row);
  const r = el('div', 'rd-row');
  r.dataset.rdOpen = row.id; r.dataset.rdPick = row.id; r.tabIndex = 0; r.setAttribute('role', 'button');
  if (state.foldersReady) r.draggable = true; // S70-83: PC 마우스로 끌어 왼쪽 위 폴더 줄에 놓기(손가락 꾹 누르기는 고르기 그대로 — 폰은 ⋯ [폴더로 옮기기])
  if (state.open === row.id) r.classList.add('is-open');
  if (l.unread) r.classList.add('is-unread');
  const dot = el('span', 'rd-dot'); dot.setAttribute('aria-hidden', 'true');
  const title = el('span', 'rd-nm', l.title);
  const meta = el('span', 'rd-meta', [l.site, l.day].filter(Boolean).join(' · '));
  const more = btn('rd-more icon-btn', '⋯', {rdMore: row.id}); more.setAttribute('aria-label', '저장한 글 메뉴: ' + l.title); more.setAttribute('aria-expanded', 'false');
  r.append(dot, title, meta, more);
  const tag = areaText(l.area);
  const line = state.lines.get(row.id) || (fetching(row.id) ? stateLine(row, {busy: true}) : '');
  if (tag || line) {
    const sub = el('span', 'rd-sub');
    if (tag) sub.append(el('span', 'rd-tag', tag));
    if (line) sub.append(el('span', 'rd-line', line));
    r.append(sub);
  }
  r.setAttribute('aria-label', `${l.unread ? '안 읽음 · ' : ''}${l.title}${l.site ? ' · ' + l.site : ''}`);
  return r;
}
function drawList() {
  const box = view()?.querySelector('[data-rd-list]');
  if (!box) return;
  // S71-26 SAVED-머리한줄(명진 11/26 "+ 를 돋보기 우측으로"): ＋는 목록 머리 줄이 아니라 화면 이름 줄 찾기 오른쪽(공용 단추 상자 screen-find.js toolsBox —
  // 폰·폴드 앱 머리 줄 [W 저장한 글 · 찾기 · ＋], PC 맨 위 줄 검색 칸 오른쪽). ＋ 하나만 있던 폰 목록 머리 줄(.rd-head)은 없앴다.
  // 목록 첫 줄은 보기 탭(.rd-switch)뿐 — 폰은 하단바 위 공용 전환 줄, PC 틀은 목록 맨 위. 화면 이름은 앱 머리 줄·PC 위 줄 한 곳(S70-40b·S70-57).
  addBtn.setAttribute('aria-expanded', String(state.adding));
  const parts = [];
  if (state.adding) {
    const form = el('form', 'rd-form');
    form.dataset.rdForm = '1';
    const input = el('input', 'rd-url');
    input.type = 'text'; input.inputMode = 'url'; input.name = 'url'; input.placeholder = 'https://… 읽을 글 주소'; input.setAttribute('aria-label', '읽을 글 주소'); input.autocomplete = 'off'; input.maxLength = 2000;
    // 다시 그려도(목록·칩이 늦게 와도) 쓰던 주소와 글자 칸 초점은 그대로.
    const was = box.querySelector('input.rd-url');
    if (was) { input.value = was.value; if (document.activeElement === was) queueMicrotask(() => { if (input.isConnected) { input.focus({preventScroll: true}); try { input.setSelectionRange(was.selectionStart, was.selectionEnd); } catch { /* 고를 수 없는 칸 */ } } }); }
    const save = btn('mini primary', '저장'); save.type = 'submit';
    form.append(input, save, btn('mini', '닫기', {rdAddClose: '1'}));
    parts.push(form);
    if (state.addError) parts.push(el('p', 'rd-line rd-bad', state.addError));
    if (pcBrowser()) {
      // 끌어 놓기용 링크 + [한 줄 복사]. 이 화면에서 링크를 누르면 실행하지 않는다(click에서 막음).
      const bm = el('p', 'rd-line rd-bm');
      bm.dataset.rdBm = '1';
      const a = el('a', 'rd-bm-link', `${APP_NAME} 저장`);
      a.href = bookmarklet(); a.dataset.rdBmLink = '1';
      bm.append('크롬 버튼: ', a, ' ', btn('mini', '한 줄 복사', {rdBmCopy: '1'}));
      parts.push(bm);
    }
    queueMicrotask(() => { if (input.isConnected && !input.value) input.focus({preventScroll: true}); });
  }
  if (state.failed && !state.rows.length) {
    box.replaceChildren(...parts);
    box.insertAdjacentHTML('beforeend', failHtml({retry: 'data-rd-retry'}));
    return;
  }
  if (!state.loaded) { box.replaceChildren(...parts); box.insertAdjacentHTML('beforeend', waitHtml({rows: 4})); return; }
  const entries = entriesNow(), marks = marksNow();
  // S68-48 READ-보기탭아래(명진 11/23 12:42 "안읽음 전체 밑줄도 다른 버튼 있는 메뉴처럼 하단 가운데 정렬"): [안 읽음 n][전체][밑줄]은
  // 위쪽 칩 줄이 아니라 공용 ⑤ 보기 바꾸기(renderFilterChips seg — .ds-seg) 한 줄. 자리는 노트 보기 탭과 같은 공용 규칙(ui-standard.css 폰 전환 줄):
  // 폰·펼친 폴드(~760px) 하단바 바로 위 가운데, PC 틀(761px~) 제목 줄 오른쪽([+ 추가] 앞). 따로 칩 줄은 없다.
  switchHost ||= el('div', 'rd-switch');
  renderFilterChips(switchHost, {options: filterOptions(entries, marks ? marks.length : null, memoState().ready ? myMemos().length : null), value: keepFilter(state.filter), label: '저장한 글 보기', seg: true,
    onChange: v => { setFilter(v); drawList(); }});
  parts.unshift(switchHost);
  if (keepFilter(state.filter) === 'marks') { parts.push(marksEl(marks && ranked(marks, h => [h.quote, h.memo, h.source_title]))); box.replaceChildren(...parts); return; }
  if (keepFilter(state.filter) === 'memos') { parts.push(memosEl()); box.replaceChildren(...parts); return; }
  parts.push(folderBoxEl(entries));
  const shown = ranked(shownEntries(), e => { const l = lineOf(e.row); return [l.title, l.site]; });
  const list = el('div', 'rd-rows');
  list.dataset.rdRows = '1';
  for (const e of shown) list.append(rowEl(e));
  if (!shown.length) list.append(emptyEl(folderNow() && entries.length ? '이 폴더에 글이 없어요 · 글 ⋯ [폴더로 옮기기]나 끌어 놓기로 넣어요' : emptyText(keepFilter(state.filter), entries.length)));
  parts.push(list);
  box.replaceChildren(...parts);
  if (!state.open && shown.length && split()) queueMicrotask(autoOpenTop);
}

// 지금 보기 탭 + 고른 폴더에 드는 글(keep: 열어 둔 줄은 [안 읽음]에서 그 자리에 남김 — filterEntries 규칙).
const shownEntries = (keep = state.open || '') => { const sel = folderNow(); return filterEntries(entriesNow(), state.filter, keep).filter(e => inFolder(e.row, sel, state.folders)); };

// ---------- S70-83 READ-저장한글폴더: 폴더 상자 ----------
// 왼쪽 목록 위 공용 폴더 상자([파일]·노트·자료실과 같은 folder-tree-ui.mjs 상자·줄 — 모양은 folder-tree.css 한 곳). 폴더(순서대로) + 맨 아래 '폴더 없음'.
// 이름 누르기 = 그 폴더 글만(다시 누르면 전체 — 표준 S1). 폴더는 한 단계라 펼치기 꺾쇠가 없다. ⋯ = [이름 바꾸기][삭제], 머리 ＋ = 새 폴더.
// 글 줄을 끌어(PC 마우스) 폴더 줄에 놓으면 그 폴더로 옮긴다(놓을 곳 강조 nx-drop — 표준 D2, Esc = 브라우저 끌기 취소 D4). 폰·손가락은 글 ⋯ [폴더로 옮기기](공용 옮길 곳 창 — 표준 F1).
// DB 적용 전(표·칸 없음)에는 '폴더 없음' 한 줄만(만들기·옮기기 없음). 접기는 화면 메모리만.
let folderHost = null;
function folderBoxEl(entries) {
  folderHost ||= el('div', 'rd-folders');
  folderHost.dataset.rdFolders = '1';
  const sel = folderNow(), rows = state.foldersReady ? folderRows(state.folders, entries.map(e => e.row)) : [{key: OUTSIDE, name: OUTSIDE_NAME, count: entries.length, folder: null}];
  const body = rows.map(r => ftFolderRowHtml({name: r.name, count: r.count, countLabel: `글 ${r.count}개`, depth: 0, hasContent: false, current: sel === r.key,
    className: r.folder ? '' : 'rd-folder-out', rowAttrs: {'data-rd-drop': state.foldersReady ? r.key : null},
    mainAttrs: {'data-rd-folder': r.key, title: sel === r.key ? '다시 누르면 전체' : null},
    more: r.folder ? {attrs: {'data-rd-folder-more': r.key}, label: `${r.name} 폴더 메뉴`} : null})).join('');
  const add = state.foldersReady ? `<button type="button" class="icon-btn ft-box-add rd-folder-add" data-rd-folder-add="1" data-ctx-screen-item="새 폴더" aria-label="새 폴더" title="새 폴더">＋</button>` : '';
  // 폴더 이름은 ftFolderRowHtml이 이스케이프한다(공용 부품). 상자는 통째로 다시 그린다.
  const boxHtml = ftBoxHtml({head: '폴더', collapsible: true, caret: true, open: state.boxOpen, toggleAttrs: {'data-rd-fbox': '1'}, tail: add, body,
    attrs: {'data-rd-fbox-wrap': ''}, label: '저장한 글 폴더'});
  folderHost.replaceChildren();
  folderHost.insertAdjacentHTML('beforeend', boxHtml);
  return folderHost;
}
function pickFolder(key) {
  const next = folderNow() === key ? '' : key;
  setFolder(next);
  drawList();
  // 두 칸에서 열린 글이 고른 폴더 밖이면 그 폴더 맨 위 글로 바꾼다(목록과 오른쪽 칸이 어긋나지 않게).
  if (split() && state.open && !shownEntries('').some(e => e.key === state.open)) { const first = shownEntries('')[0]; if (first) void openItem(first.key, {auto: true}); else closeDetail(); }
}
async function addFolder(anchor) {
  if (!state.foldersReady) return;
  const v = await askText(anchor, {text: `새 폴더 이름 (${NAME_MAX}자까지)`, value: '', ok: '만들기', max: NAME_MAX});
  if (v === null) return null;
  return makeFolder(v);
}
async function makeFolder(text) {
  const got = folderName(text);
  if (!got.ok) { notify(got.message, {error: true, record: false}); return null; }
  if (nameTaken(state.folders, got.name)) { notify('같은 이름 폴더가 있어요', {error: true, record: false}); return null; }
  try {
    const made = await createFolder({name: got.name, sort_order: nextSort(state.folders)});
    state.folders = sortFolders([...state.folders, made]);
    drawList();
    return made;
  } catch { notify('폴더를 만들지 못했어요 · 잠시 뒤 다시', {error: true, record: false}); return null; }
}
async function renameFolderAt(id, anchor) {
  const f = folderById(id);
  if (!f) return;
  const v = await askText(anchor, {text: `폴더 이름 (${NAME_MAX}자까지)`, value: f.name, ok: '저장', max: NAME_MAX});
  if (v === null) return;
  const got = folderName(v);
  if (!got.ok) { notify(got.message, {error: true, record: false}); return; }
  if (got.name === f.name) return;
  if (nameTaken(state.folders, got.name, id)) { notify('같은 이름 폴더가 있어요', {error: true, record: false}); return; }
  try { Object.assign(f, await renameFolder(id, got.name)); }
  catch { notify('이름을 바꾸지 못했어요 · 잠시 뒤 다시', {error: true, record: false}); return; }
  drawList();
}
// 폴더 삭제: 글은 지우지 않고 '폴더 없음'으로(서버가 칸만 비움). [되돌리기]가 있으니 묻지 않고 바로(표준 K1) — 같은 id로 다시 만들고 그 글들을 다시 넣는다.
async function removeFolder(id) {
  const f = folderById(id);
  if (!f) return;
  const inside = state.rows.filter(r => r.folder_id === id).map(r => r.id);
  try { await deleteFolder(id); }
  catch { notify('폴더를 삭제하지 못했어요 · 잠시 뒤 다시', {error: true, record: false}); return; }
  state.folders = state.folders.filter(x => x.id !== id);
  for (const r of state.rows) if (r.folder_id === id) r.folder_id = null;
  if (state.folder === id) setFolder('');
  drawList();
  notify(inside.length ? `폴더를 삭제했어요 · 글 ${inside.length}개는 폴더 없음으로` : '폴더를 삭제했어요', {record: false, undo: async () => {
    try {
      const back = await createFolder({id: f.id, name: f.name, sort_order: f.sort_order});
      state.folders = sortFolders([...state.folders.filter(x => x.id !== back.id), back]);
      if (inside.length) await placeRows(inside, back.id, {quiet: true});
    } catch { notify('되돌리지 못했어요 · 잠시 뒤 다시', {error: true, record: false}); }
    drawList();
  }});
}
// 글 옮기기(서버 한 번) → 화면 줄 맞춤. folderId null = 폴더 없음.
async function placeRows(ids, folderId, {quiet = false} = {}) {
  const list = ids.filter(id => rowOf(id) && (rowOf(id).folder_id || null) !== (folderId || null));
  if (!list.length) return 0;
  let got;
  try { got = await moveItems(list, folderId); }
  catch { notify('옮기지 못했어요 · 잠시 뒤 다시', {error: true, record: false}); return 0; }
  for (const r of got) Object.assign(rowOf(r.id) || {}, {folder_id: r.folder_id ?? null});
  if (!quiet) notify(`${got.length === 1 ? '' : got.length + '개 '}${folderId ? `'${folderById(folderId)?.name || '폴더'}'로 옮겼어요` : '폴더 없음으로 옮겼어요'}`, {record: false});
  draw();
  return got.length;
}
// 글 ⋯ [폴더로 옮기기]: 공용 '옮길 곳' 창(표준 F1). 맨 위(저장한 글) = 폴더 없음. [새 폴더]는 맨 위에 만든다(한 단계).
async function moveToSheet(id, anchor) {
  const row = rowOf(id);
  if (!row || !state.foldersReady) return;
  const {openFolderSheet} = await import('./folder-dest-sheet.js');
  const cur = folderOfRow(row, state.folders);
  openFolderSheet({anchor, title: '옮길 곳', rootName: '저장한 글', note: '맨 위 = 폴더 없음', folders: () => state.folders.map(f => ({...f, parent_id: null})),
    current: cur === OUTSIDE ? null : cur, start: cur === OUTSIDE ? null : cur,
    mkdir: async (_parent, name) => { const made = await makeFolder(name); if (!made) throw new Error('폴더를 만들지 못했어요.'); return {...made, parent_id: null}; },
    onGo: async to => { await placeRows([id], to); }});
}

// 끌어 놓기(PC 마우스): 글 줄 → 폴더 줄. 끄는 동안 반투명 조각(공용 drag-ghost.js), 놓을 줄 강조.
const DRAG_TYPE = 'application/x-kptu-reading';
let dragIds = null;
function bindFolderDrag(box) {
  const clearDrop = () => { for (const n of box.querySelectorAll('.nx-drop')) n.classList.remove('nx-drop'); };
  box.addEventListener('dragstart', e => {
    const row = e.target.closest?.('.rd-row[draggable="true"]');
    if (!row || !state.foldersReady) return;
    const id = row.dataset.rdPick;
    dragIds = [id];
    try { e.dataTransfer.setData(DRAG_TYPE, id); e.dataTransfer.setData('text/plain', lineOf(rowOf(id)).title); e.dataTransfer.effectAllowed = 'move'; } catch { /* 끌기 자료를 못 쓰는 브라우저 */ }
    setDragGhostImage(e.dataTransfer, lineOf(rowOf(id)).title);
  });
  box.addEventListener('dragover', e => {
    const drop = dragIds && e.target.closest?.('[data-rd-drop]');
    clearDrop();
    if (!drop) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'move'; } catch { /* 그대로 */ }
    drop.classList.add('nx-drop');
  });
  box.addEventListener('dragleave', e => { if (!box.contains(e.relatedTarget)) clearDrop(); });
  box.addEventListener('drop', e => {
    const drop = dragIds && e.target.closest?.('[data-rd-drop]');
    clearDrop();
    if (!drop) return;
    e.preventDefault();
    const ids = dragIds; dragIds = null;
    const key = drop.dataset.rdDrop;
    void placeRows(ids, key === OUTSIDE ? null : key);
  });
  box.addEventListener('dragend', () => { dragIds = null; clearDrop(); });
}

const folderMenu = createAnchoredMenu({id: 'rdFolderMenu', className: 'feed-menu', label: '폴더 메뉴', historyKey: 'kptuReadingFolderMenu',
  key: t => t.dataset.rdFolderMore || '',
  row: t => t.closest('.ft-row'),
  render: id => (folderById(id) ? '<button type="button" class="row-act" data-rd-fact="rename">이름 바꾸기</button><button type="button" class="row-act feed-menu-danger" data-rd-fact="delete">삭제</button>' : ''),
  onAction: (button, active) => {
    const id = active.id, at = (active.trigger?.isConnected ? active.trigger : null) || view()?.querySelector(`[data-rd-folder-more="${CSS.escape(id)}"]`) || null;
    if (button.dataset.rdFact === 'rename') void renameFolderAt(id, at);
    else if (button.dataset.rdFact === 'delete') void removeFolder(id);
  }});

// [밑줄] 탭 목록: 노트 › 밑줄과 같은 줄 부품(highlightRowHtml)·같은 출처 꼬리표(sourceTag). 밑줄 줄 ⋯ = 공용 밑줄 메뉴(지우면 두 화면 모두에서 사라짐).
function marksEl(marks) {
  const list = el('div', 'rd-rows rd-marks');
  list.dataset.rdMarks = '1';
  if (!marks) list.insertAdjacentHTML('beforeend', waitHtml({rows: 4, h: 56}));
  else if (!marks.length) list.append(emptyEl(emptyText('marks', 0)));
  else list.insertAdjacentHTML('beforeend', `<div class="nh-list">${marks.map(h => highlightRowHtml(h, {src: sourceTag(h)})).join('')}</div>`);
  return list;
}
// S69-94 NOTE-메모통일 [메모] 탭: 이 화면 글(저장한 글)에 남긴 메모 + 읽을 거리에서 저장한 글(연결된 기사·성명)에 남긴 메모. 노트 [메모]와 같은 줄 부품(memoRowHtml).
// 줄을 누르면 그 글을 열고 그 메모로 내려가 칠한다. 글이 이 목록에서 삭제됐으면 '원래 기록이 없어요'(메모는 그대로).
const linkedKeys = () => new Set(state.rows.map(linkOf).filter(Boolean).map(l => `${l.type}:${l.id}`));
function myMemos() {
  const linked = linkedKeys();
  return memoRows(memosNow().filter(m => m.target_type === 'reading' || linked.has(`${m.target_type}:${m.target_id}`)));
}
const readingMemoExists = m => (m.target_type === 'reading' ? (state.loaded ? !!rowOf(m.target_id) : undefined) : memoExists(m));
const readingMemoTitle = m => (m.target_type === 'reading' && rowOf(m.target_id) ? lineOf(rowOf(m.target_id)).title : m.target_title);
const memoThread = createMemoThread();
let memoHost = null;
onMemos(() => { if (window.KPTURouter?.current === 'reading') drawList(); });
function memosEl() {
  const list = el('div', 'rd-rows rd-memos-list');
  list.dataset.rdMemoList = '1';
  const st = memoState();
  if (!st.loaded) { void loadMemos(); list.insertAdjacentHTML('beforeend', waitHtml({rows: 3, h: 40})); return list; }
  if (!st.ready) { list.append(emptyEl(st.missing ? '메모는 준비 중이에요.' : '메모를 읽지 못했어요.')); return list; }
  const rows = ranked(myMemos(), m => [readingMemoTitle(m), m.quote, m.body]);
  if (!rows.length) list.append(emptyEl(emptyText('memos', 0)));
  else list.insertAdjacentHTML('beforeend', `<div class="memo-lines">${rows.map(m => memoRowHtml(m, {titleOf: readingMemoTitle, exists: readingMemoExists})).join('')}</div>`);
  return list;
}
function openMemoLine(id) {
  const m = memosNow().find(x => x.id === id);
  if (m) openMemoSource(m, {exists: readingMemoExists, inPlace: o => { if (o.type !== 'reading') return false; void openItem(o.id); return true; }});
}
// 밑줄 줄을 누르면 그 글 그 자리로(노트 › 밑줄과 같은 갈 곳): 저장한 글은 이 화면 보기, 노트 밑줄은 그 노트, News·텔레그램 밑줄은 News.
function openMark(h) {
  if (!h) return;
  if (h.source_type === 'reading') {
    if (rowOf(h.source_id)) void openItem(h.source_id, {highlight: h.id});
    else notify('원문 글을 찾을 수 없어요 · 저장한 글에서 삭제된 글', {record: false});
    return;
  }
  if (h.source_type === 'note') { requestBasketNote(h.source_id); void window.KPTURouter?.openFrom?.('basket')?.catch?.(() => {}); return; }
  if (h.source_type === 'brief') { window.KPTUBriefOpen = {id: h.source_id, highlight: h.id}; void openOnScreen('brief'); return; }
  if (requestNewsOpen({type: h.source_type, id: h.source_id, highlight: h.id})) void openOnScreen('outside');
}

// ---------- 보기 ----------
let detailBox = null;
function closeDetail({fromBack = false} = {}) {
  state.open = null; state.body = null; state.bodyFor = null; state.editing = null; state.editNote = ''; state.editBusy = false;
  if (!fromBack && layer) { const l = layer; layer = null; void l.close(); }
  layer = null;
  draw();
}
function openLayer(id) {
  if (split() || layer) return;
  layer = window.KPTURouter?.layer?.open?.('reading-detail', {reopen: () => openItem(id), close: () => { layer = null; closeDetail({fromBack: true}); return true; }}) || null;
}
async function openItem(id, {highlight = null, auto = false} = {}) {
  if (!isId(id)) return;
  if (state.editing !== id) { state.editing = null; state.editNote = ''; state.editBusy = false; }
  state.open = id; state.body = null; state.bodyFor = null;
  openLayer(id);
  draw();
  if (!auto) void markOpened(id);
  try { const full = await getItem(id); if (state.open !== id) return; state.body = full?.body || ''; state.bodyFor = id; if (full) Object.assign(rowOf(id) || {}, full); }
  catch { if (state.open === id) { state.body = null; state.bodyFor = 'failed:' + id; } }
  draw();
  const cur = rowOf(id);
  if (cur && cur.body_state === 'pending' && !fetching(id)) void startFetch(cur);
  if (highlight) queueMicrotask(() => revealMark(detailBox?.querySelector('[data-rd-prose]'), highlight));
}
function drawDetail() {
  detailBox ||= view()?.querySelector('[data-rd-detail]');
  const box = detailBox, listBox = view()?.querySelector('[data-rd-list]');
  if (!box) return;
  const row = state.open ? rowOf(state.open) : null;
  if (!row) { box.hidden = true; box.replaceChildren(); memoThread.detach(); if (listBox) listBox.hidden = false; view()?.classList.remove('rd-reading'); refreshScreenFind(); return; }
  view()?.classList.add('rd-reading');
  if (listBox) listBox.hidden = !split();
  refreshScreenFind(); // 폰은 글 보기가 목록 대신 — 그동안 맨 위 칸은 이 화면 찾기가 아니다
  const l = lineOf(row);
  // S70-40b READ-글보기머리(docs/design/reading-screens.md 4절·5절 ①③ (가)): 공용 '글 보기 머리'(ui-standard.css .ds-doc-*) —
  // 첫 줄 = [‹](폰) 출처 · 날짜 · 사업영역 꼬리표 + 오른쪽 작은 아이콘 줄 [↗ 원래 페이지][−][+][⋯], 둘째 줄 = 제목(두 줄까지 줄바꿈, 말줄임 없음).
  // 첫 줄은 왼쪽 목록 머리 줄과 같은 32px 줄이라 두 칸 위 끝이 맞는다. 테두리 단추 줄(.rd-acts)은 없앴고 동작은 모두 ⋯(목록 줄 ⋯과 같은 메뉴) 안.
  const parts0 = [];
  const bar = el('div', 'ds-doc-top rd-dhead');
  if (!split()) { const back = btn('rd-back icon-btn', '‹', {rdBack: '1'}); back.setAttribute('aria-label', '목록으로'); bar.append(back); }
  const meta = el('p', 'ds-doc-meta rd-meta-line', [l.site, l.day ? l.day + ' 저장' : ''].filter(Boolean).join(' · '));
  const tag = areaText(l.area);
  if (tag) meta.append(' · ', el('span', 'rd-tag', tag));
  const icons = el('span', 'ds-doc-icons');
  const src = el('a', 'ds-doc-icon rd-src', '↗');
  src.href = row.url; src.target = '_blank'; src.rel = 'noopener noreferrer'; src.title = '원래 페이지'; src.setAttribute('aria-label', '원래 페이지 (새 창)');
  icons.append(src);
  // S68-33 READ-글자크기: [−][+](공용 text-size.js — News 글 상세와 같은 단추·같은 서버 값). 본문 칸만 커지고 작아진다.
  icons.insertAdjacentHTML('beforeend', textSizeHtml());
  const more = btn('ds-doc-icon rd-head-more', '⋯', {rdMore: row.id, rdHeadMore: '1'});
  more.setAttribute('aria-label', '이 글 메뉴'); more.setAttribute('aria-haspopup', 'true'); more.setAttribute('aria-expanded', 'false');
  icons.append(more);
  bar.append(meta, icons);
  const title = el('h2', 'ds-doc-title rd-title rd-doc', l.title);
  if (state.editing === row.id) parts0.push(editForm(row));
  const parts = [bar, title, ...parts0];
  const busy = fetching(row.id);
  const line = state.lines.get(row.id) || stateLine(row, {busy});
  if (line) {
    const p = el('p', 'ds-doc-fail rd-line', line);
    p.setAttribute('role', 'status');
    if (!busy && canRetry(row)) p.append(' ', btn('row-act', '원문 다시 가져오기', {rdFetch: row.id}));
    parts.push(p);
  }
  // News에서 온 줄은 그 기사·성명에 News에서 그은 밑줄도 같이 칠한다(같은 원문 사본 — 글자로 찾아 칠함).
  const lk = linkOf(row);
  const marks = [...sourceHighlights('reading', row.id), ...(lk ? sourceHighlights(lk.type, lk.id) : [])];
  const prose = el('div', 'rd-prose');
  prose.dataset.rdProse = '1';
  prose.dataset.textSizeTarget = '';
  if (state.bodyFor === row.id) {
    for (const para of paragraphs(state.body)) prose.append(el('p', null, para));
    if (!prose.childNodes.length && !line) prose.append(el('p', 'rd-faint', '받아 둔 원문이 없어요. 원래 페이지에서 읽어 주세요.'));
  } else if (state.bodyFor === 'failed:' + row.id) {
    prose.append(el('p', 'rd-faint', '원문을 읽지 못했어요.'), btn('row-act', '다시', {rdReopen: row.id}));
  } else prose.insertAdjacentHTML('beforeend', waitHtml({rows: 3}));
  parts.push(prose);
  // S69-94: 글 아래 메모 칸(노트·읽을 거리와 같은 부품). 칸은 한 번 만들어 다시 그려도 그대로 붙인다(쓰던 글·초점 유지).
  if (!memoHost) { memoHost = el('section', 'memo-th rd-memos'); memoHost.dataset.rdMemos = '1'; memoHost.setAttribute('aria-label', '메모'); }
  parts.push(memoHost);
  box.replaceChildren(...parts);
  memoThread.attach(memoHost, {type: 'reading', id: row.id, title: l.title});
  box.hidden = false;
  if (split()) { followPane(box, {narrow: !wide(), reset: followed !== row.id}); followed = row.id; }
  paintTextSize(box);
  if (state.bodyFor === row.id) paintMarks(prose, marks);
}

// 직접 넣은 줄 [수정] 칸: 제목·매체(사이트) 두 칸 + [취소][저장]. 칸 글자는 다시 그려도 그대로(쓰던 값·초점 유지).
function editForm(row) {
  const was = detailBox?.querySelector('[data-rd-edit-form]');
  const form = el('form', 'rd-form rd-edit');
  form.dataset.rdEditForm = row.id;
  form.setAttribute('aria-label', '저장한 글 수정');
  const field = (name, label, value, max) => {
    const box = el('label', 'rd-edit-f');
    const input = el('input', 'rd-url');
    input.type = 'text'; input.name = name; input.maxLength = max; input.autocomplete = 'off'; input.disabled = state.editBusy;
    const old = was?.querySelector(`input[name="${name}"]`);
    input.value = old ? old.value : value;
    if (old && document.activeElement === old) queueMicrotask(() => { if (input.isConnected) input.focus({preventScroll: true}); });
    box.append(el('span', null, label), input);
    return box;
  };
  form.append(field('title', '제목', row.title || '', 500), field('site', '매체', row.site || '', 120));
  const end = el('div', 'rd-edit-end');
  if (state.editNote) { const n = el('span', 'rd-faint', state.editNote); n.setAttribute('role', 'status'); end.append(n); }
  const save = btn('mini primary', '저장'); save.type = 'submit'; save.disabled = state.editBusy;
  const cancel = btn('mini', '취소', {rdEditCancel: '1'}); cancel.disabled = state.editBusy;
  end.append(cancel, save);
  form.append(end);
  if (!was) queueMicrotask(() => form.querySelector('input')?.focus({preventScroll: true}));
  return form;
}

function draw() { drawList(); drawDetail(); mountSplit(); }
let followed = '';
// 두 칸 경계(공용 split-resize.js): 왼쪽 목록 1 : 오른쪽 글 2가 기본(칸 최소 200px · 320px — 펼친 폴드 약 690px에서도 기본 비율), 끌면 서버(view_prefs.split_ratio.reading)에 기억. 두 번 누르면 기본.
function mountSplit() {
  const wrap = view()?.querySelector('.rd-wrap');
  if (!wrap) return;
  mountSplitResize({container: wrap, name: 'reading', label: '목록과 글 칸 폭 조절', query: SPLIT_QUERY, columns: [
    {el: () => wrap.querySelector('[data-rd-list]'), varName: '--ds-split-list', minVar: '--ds-split-list-min', minFallback: 200, share: 1},
    {el: () => wrap.querySelector('[data-rd-detail]'), varName: '--ds-split-detail', minVar: '--ds-split-detail-min', minFallback: 320, share: 2},
  ], active: () => split() && !!view()?.classList.contains('rd-reading') && !view()?.classList.contains('hidden')});
}
// 두 칸에서 열린 글이 없으면 지금 보기(전체·안 읽음)의 맨 위 글을 오른쪽에 연다. [밑줄]·[메모] 보기는 줄이 글이 아니라 그대로 둔다.
function autoOpenTop() {
  if (!split() || !here() || !state.loaded || state.open) return;
  const f = keepFilter(state.filter);
  if (f === 'marks' || f === 'memos') return;
  const first = shownEntries('')[0];
  if (first) void openItem(first.key, {auto: true});
}

// ---------- 동작 ----------
async function startFetch(row) {
  state.lines.delete(row.id);
  draw();
  const out = await fetchBody(row);
  if (out.state === 'request') state.lines.set(row.id, out.reason === 'gone' ? '이미 삭제한 글이에요.' : requestLine(out.reason));
  if (out.row) Object.assign(rowOf(row.id) || {}, out.row);
  if (state.open === row.id && out.row) {
    try { const full = await getItem(row.id); if (state.open === row.id) { state.body = full?.body || ''; state.bodyFor = row.id; } } catch { /* 다음에 열 때 다시 읽는다 */ }
  }
  draw();
  return out;
}
// S68-32: 화면이 열릴 때 원문이 없거나 실패·robots로 남은 줄을 한 번씩 자동으로 다시 가져온다(기존 startFetch 그대로, 2개씩 묶어 차례로).
// 한 줄에 한 번: 이 탭에서 해 본 id(메모리)와 서버 칸 body_at(reading-model needsRefetch)으로 판단. 실패하면 [다시] 단추만 남는다.
// 하루 횟수·로그인·권한 실패면 남은 줄은 그만둔다. 기기 저장 없음.
const autoTried = new Set();
let autoRun = null;
function autoRefetch() {
  if (autoRun) return autoRun;
  const scope = state.scope;
  autoRun = (async () => {
    for (const batch of refetchBatches(state.rows, {tried: autoTried, busy: fetching})) {
      if (scope !== state.scope || !here()) return;
      for (const row of batch) autoTried.add(row.id);
      const outs = await Promise.all(batch.map(row => startFetch(row).catch(() => null)));
      if (outs.some(o => o?.state === 'request' && stopsAuto(o.reason))) return;
    }
  })().finally(() => { autoRun = null; });
  return autoRun;
}
async function addUrl(text) {
  const got = readingUrl(text);
  if (!got.ok) { state.addError = got.message; drawList(); return; }
  state.addError = '';
  let out;
  try { out = await addItem(got.url); }
  catch { state.addError = '저장하지 못했어요 · 잠시 뒤 다시'; drawList(); return; }
  state.adding = false;
  if (!out.dup) state.rows = [out.row, ...state.rows.filter(r => r.id !== out.row.id)];
  if (state.filter === 'marks') setFilter('all');
  notify(out.dup ? '이미 저장한 글에 있어요' : '저장한 글에 넣었어요', {record: false});
  draw();
  if (!out.dup) void startFetch(out.row);
}
// S68-45(명진 11/23 11:08 "안읽은 글 눌러서 읽었는데 읽음 처리 안됨"): 글 보기를 열면(이 화면 보기·읽을 거리 원문 보기 둘 다) 그 줄을 읽음으로 서버에 저장한다.
// [읽음]·[안 읽음으로] 단추와 같은 저장 길(setRead). 이미 읽은 줄은 다시 쓰지 않는다(안 읽음으로 되돌린 줄은 다음에 열 때 다시 읽음).
// 실패하면 점은 그대로 두고 알림 한 줄 — read_at이 비어 있으니 다음에 열 때 다시 저장한다. 같은 줄을 겹쳐 보내지 않는다.
const readSaving = new Set();
async function markOpened(id) {
  const row = rowOf(id);
  if (!row || row.read_at || readSaving.has(id)) return;
  const scope = state.scope;
  readSaving.add(id);
  try { const got = await setRead(id, true); if (scope === state.scope) Object.assign(row, got); }
  catch { if (scope === state.scope) notify('읽음으로 저장하지 못했어요 · 다음에 열 때 다시', {error: true, record: false}); }
  finally { readSaving.delete(id); }
  if (scope === state.scope && here()) draw();
}
async function toggleRead(id, read) {
  const row = rowOf(id);
  if (!row) return;
  try { Object.assign(row, await setRead(id, read)); }
  catch { notify('저장하지 못했어요 · 잠시 뒤 다시', {error: true, record: false}); }
  draw();
}
async function pickArea(button, id) {
  const row = rowOf(id);
  if (!row) return;
  const rows = await loadAreas();
  if (!rows) { notify(word('사업영역을 읽지 못했어요'), {error: true, record: false}); return; }
  const used = await usedKeysNow().catch(() => []);
  if (!button.isConnected) return;
  await openAreaOrgPicker({kind: 'area', trigger: button, areas: catalogAreas(rows), selected: row.business_area_id ? ['p:' + row.business_area_id] : [], used, multi: false, none: true,
    onCommit: async keys => {
      const k = [...keys][0] || '', areaId = k.startsWith('p:') ? k.slice(2) : null;
      if ((areaId || null) === (row.business_area_id || null)) return;
      try { Object.assign(row, await setArea(id, areaId)); await refreshAreaNames(); }
      catch { notify('연결하지 못했어요 · 잠시 뒤 다시', {error: true, record: false}); }
      draw();
    }});
}
// [수정]: 'news'면 News 글 보기의 ⋯ [수정] 창을 바로(openNews edit), 'own'이면 이 화면 글 보기를 열고 제목·매체 칸.
async function startEdit(id) {
  const kind = editKind(id);
  if (kind === 'news') { const link = newsLinkOf(id); void markOpened(id); await openNews(link, {edit: true}); return; }
  if (kind !== 'own') return;
  state.editNote = ''; state.editBusy = false;
  if (state.open !== id) await openItem(id);
  if (state.open !== id) return;
  state.editing = id;
  drawDetail();
}
async function saveEdit(form) {
  const id = form.dataset.rdEditForm, row = rowOf(id);
  if (!row || state.editBusy) return;
  const title = form.querySelector('input[name="title"]')?.value ?? '', site = form.querySelector('input[name="site"]')?.value ?? '';
  state.editBusy = true; state.editNote = ''; drawDetail();
  try { Object.assign(row, await setTitle(id, title, site)); }
  catch { state.editBusy = false; state.editNote = '저장하지 못했어요 · 잠시 뒤 다시'; drawDetail(); return; }
  state.editBusy = false; state.editing = null;
  notify('저장했어요', {record: false});
  draw();
}
// [노트로 만들기]: 받아 둔 원문(이미 연 글의 사본)으로 노트 한 장 — 기존 노트 만들기 길(owner RLS)만 쓴다. 두 번 눌러도 한 장(누르는 동안 잠금).
async function makeNote(id) {
  const row = rowOf(id);
  if (!row || state.noteBusy || state.bodyFor !== id) return;
  const made = readingNote(row, state.body);
  if (!made) { notify('이 글은 노트로 만들 수 없어요', {error: true, record: false}); return; }
  state.noteBusy = id; drawDetail();
  let note = null;
  try { note = await createNoteDoc({title: made.title, raw_text: made.raw_text, source: made.source}, window.KPTURuntime); }
  catch (e) { notify(e?.message && !e?.status ? e.message : '노트로 만들지 못했어요 · 잠시 뒤 다시', {error: true, record: false}); }
  finally { state.noteBusy = null; if (state.open === id) drawDetail(); }
  if (!note?.id) return;
  const router = window.KPTURouter;
  notify(made.cut ? '노트로 만들었어요 · 긴 글이라 앞부분만 넣었어요' : '노트로 만들었어요', {record: false,
    actions: [{label: '열기', run: ({close}) => { close(); requestNoteDocOpen(note.id); void openOnScreen('basket'); }}]});
}
async function marksToNote(id) {
  const marks = sourceHighlights('reading', id);
  if (!marks.length) { notify('밑줄이 없어요 · 글을 선택하고 [밑줄 저장]을 먼저 눌러 주세요', {record: false}); return; }
  await noteWithNotice([...marks].reverse());
}
async function remove(id, anchor) {
  const row = rowOf(id);
  if (!row) return;
  const marks = sourceHighlights('reading', id).length;
  if (!(await askConfirm(anchor, {text: '이 글을 삭제할까요?', note: marks ? `밑줄 ${marks}개는 노트 › 밑줄에 남아요` : '', ok: '삭제'}))) return;
  try { await removeItem(id); }
  catch { notify('삭제하지 못했어요 · 잠시 뒤 다시', {error: true, record: false}); return; }
  state.rows = state.rows.filter(r => r.id !== id);
  if (state.open === id) closeDetail();
  notify('삭제했어요', {record: false});
  draw();
}

// News에서 보낸 줄 열기: 라우터 openFrom(화면을 다 불러온 뒤 기록 1칸, News 상세가 같은 칸을 씀) → 뒤로가기 한 번 = 읽을 거리. 새 보기 없이 News 지금 글 보기 그대로.
// S68-54: 글은 화면을 옮기기 전에(ready) 읽어 두고, 옮기는 순간 바로 글 보기를 그린다 — 읽을 거리 목록이 먼저 보였다 바뀌지 않는다.
async function openNews(link, {edit = false} = {}) {
  const router = window.KPTURouter;
  if (!link || !router?.openFrom) return;
  const item = {type: link.type, id: link.id};
  const ok = await router.openFrom('outside', () => window.KPTUOutside?.openItem?.(item, {edit}) ?? false,
    {ready: () => window.KPTUOutside?.prepareItem?.(item) ?? false}).catch(() => false);
  if (ok === false) window.KPTUOutside?.dropItem?.();
  if (ok === false && window.KPTURouter?.current === 'reading') notify('읽을 거리에서 열지 못했어요 · 잠시 뒤 다시', {error: true, record: false});
}
// News에서 보낸 줄 [삭제]: News 줄 ★·밀기와 같은 dropSaved — 서버 함수가 이 줄을 지우고 News 쪽 표시도 끈다. 5초 [되돌리기]는 원래 저장 시각으로.
// 알림 글만 '삭제했어요'(사용자에게는 직접 넣은 줄 삭제와 같은 이름). 줄이 빠지고 되돌리면 다시 읽는다.
const DEL_TEXT = '삭제했어요', DEL_LABEL = '저장한 글 삭제';
const linkChanged = id => (it, kind, on) => {
  if (kind === 'release') { state.rows = state.rows.filter(r => r.id !== id); if (state.open === id) closeDetail(); }
  else if (kind === 'save' && on) void load().then(() => { if (here()) draw(); });
  if (window.KPTURouter?.current === 'reading') drawList();
};
async function releaseSaved(id) {
  const link = newsLinkOf(id);
  if (!link) return;
  try {
    const {dropSaved} = await import('./now-row-acts.js');
    await dropSaved(link, {saved: true, text: DEL_TEXT, label: DEL_LABEL, changed: linkChanged(id)});
  } catch { notify('삭제하지 못했어요 · 잠시 뒤 다시', {error: true, record: false}); }
}
// 한 줄 [삭제] — ⋯가 부른다. News에서 보낸 줄(키가 있을 때)은 되돌릴 수 있는 dropSaved, 그 밖은 묻고 지우기(기존 길).
const removeAny = (id, anchor) => (newsLinkOf(id) ? releaseSaved(id) : remove(id, anchor));
// 고른 줄 [삭제]: 직접 넣은 줄이 있으면 한 번만 묻고 지운다(되돌리기 없음, 한 줄 삭제와 같음). News에서 보낸 줄은 한 번에 빼고 알림 하나 'n개 삭제했어요 [되돌리기]'.
async function removeMany(ids) {
  const linked = ids.filter(id => newsLinkOf(id)), plain = ids.filter(id => !newsLinkOf(id) && rowOf(id));
  if (plain.length) {
    const anchor = document.querySelector('[data-row-pick-act="delete"]');
    const marks = plain.reduce((n, id) => n + sourceHighlights('reading', id).length, 0);
    if (!(await askConfirm(anchor, {text: `선택한 글 ${ids.length}개를 삭제할까요?`, note: marks ? `밑줄 ${marks}개는 노트 › 밑줄에 남아요` : '', ok: '삭제'}))) return;
    let gone = 0;
    for (const id of plain) {
      try { await removeItem(id); gone += 1; state.rows = state.rows.filter(r => r.id !== id); if (state.open === id) closeDetail(); }
      catch { notify('삭제하지 못했어요 · 잠시 뒤 다시', {error: true, record: false}); break; }
    }
    if (gone) notify(`${gone}개 삭제했어요`, {record: false});
    draw();
  }
  if (!linked.length) return;
  try {
    const {dropSavedMany} = await import('./now-row-acts.js');
    const items = linked.map(id => ({id, link: newsLinkOf(id)})).filter(x => x.link);
    const idOf = it => items.find(x => x.link.type === it.type && x.link.id === it.id)?.id;
    // 되돌리기는 News에서 보낸 줄만 되살리므로 그 개수만 센다(직접 넣은 줄은 위에서 묻고 지웠다).
    await dropSavedMany(items.map(x => x.link), {label: DEL_LABEL, text: n => `${n}개 삭제했어요`, changed: (it, kind, on) => { const id = idOf(it); if (id) linkChanged(id)(it, kind, on); }});
  } catch { notify('삭제하지 못했어요 · 잠시 뒤 다시', {error: true, record: false}); }
}

let headMenu = false; // 지금 여는 메뉴가 글 보기 머리 ⋯인지(목록 줄 ⋯이면 false)
const menu = createAnchoredMenu({id: 'rdRowMenu', className: 'feed-menu', label: '저장한 글 메뉴', historyKey: 'kptuReadingRowMenu',
  key: t => t.dataset.rdMore || '',
  row: t => t.closest('.rd-row'),
  render: id => {
    const row = rowOf(id);
    if (!row) return '';
    // S68-29: News에서 보낸 줄도 같은 단추. 한 칸 폭에서는 'News에서 열기'를 두지 않는다 — 줄을 누르면 이미 News 원문 보기로 열린다(키가 있을 때).
    // S69: 맨 앞 [수정](다른 화면 ⋯과 같은 순서 — 수정 … 삭제). 고칠 수 없는 줄(News에서 온 사회운동 글)은 없음.
    // S70-40b: 글 보기 머리 ⋯(data-rd-head-more)도 이 메뉴 — [수정] 다음에 [밑줄을 노트로 n]이 더 있다(옛 테두리 단추 줄의 동작).
    const n = headMenu ? sourceHighlights('reading', id).length : 0;
    // S69-98 NOTE-에버노트 ⑤: [노트로 만들기](원문 사본·출처 주소·저장 시각을 새 노트로) — 글 보기 머리 ⋯에만, 원문을 받은 뒤에만 누를 수 있다.
    const making = headMenu ? `<button type="button" class="row-act" data-rd-act="make"${state.noteBusy === id || state.bodyFor !== id ? ' disabled' : ''}>${state.noteBusy === id ? '만드는 중…' : '노트로 만들기'}</button>` : '';
    const note = headMenu ? `${making}<button type="button" class="row-act" data-rd-act="note">${n ? `밑줄을 노트로 ${n}` : '밑줄을 노트로'}</button>` : '';
    // S70-58: 두 칸에서는 News에서 온 줄도 오른쪽 칸에 열므로, 글 보기 머리 ⋯에 [읽을 거리에서 보기](요약·시사점·[저장됨 ✓]이 있는 읽을 거리 글 보기 — 뒤로 = 저장한 글).
    const toNews = headMenu && split() && newsLinkOf(id) ? '<button type="button" class="row-act" data-rd-act="news">읽을 거리에서 보기</button>' : '';
    return `${editKind(id) ? '<button type="button" class="row-act" data-rd-act="edit">수정</button>' : ''}${toNews}${note}<button type="button" class="row-act" data-rd-act="read">${row.read_at ? '안 읽음으로' : '읽음'}</button><button type="button" class="row-act" data-rd-act="area">${headMenu && areaText(lineOf(row).area) ? word('사업영역 바꾸기') : '사업에 연결'}</button>${state.foldersReady ? '<button type="button" class="row-act" data-rd-act="folder">폴더로 옮기기</button>' : ''}${canRetry(row) ? '<button type="button" class="row-act" data-rd-act="fetch">원문 다시 가져오기</button>' : ''}<button type="button" class="row-act feed-menu-danger" data-rd-act="delete">삭제</button>`;
  },
  onAction: (button, active) => {
    const id = active.id, act = button.dataset.rdAct, at = (active.trigger?.isConnected ? active.trigger : null) || view()?.querySelector(`[data-rd-more="${CSS.escape(id)}"]`) || null;
    const row = rowOf(id);
    if (!row) return;
    if (act === 'edit') void startEdit(id);
    else if (act === 'read') void toggleRead(id, !row.read_at);
    else if (act === 'area' && at) void pickArea(at, id);
    else if (act === 'folder') void moveToSheet(id, at);
    else if (act === 'fetch') void startFetch(row);
    else if (act === 'note') void marksToNote(id);
    else if (act === 'make' && state.open === id) void makeNote(id);
    else if (act === 'news') { const l = newsLinkOf(id); if (l) void openNews(l); }
    else if (act === 'delete') void removeAny(id, at);
  }});

// 좌우 밀기: 목록 칸에서 옆으로 밀면 옆 칩으로(세로 스크롤과 구분: 가로 이동이 세로의 2배 이상·60px 이상).
// UI-줄밀기 Raindrop식(S68-26 2/2): 줄 위에서 시작한 밀기는 줄 밀기가 먼저다(claimedSince) — 그때는 칩을 넘기지 않는다.
// S71-26: 줄 밖 밀기 자리였던 목록 머리 줄(＋만 있던 줄)이 없어져, 화면 칸 전체(목록 아래 빈 곳 포함)에서 받는다. 글 보기 칸에서 시작한 밀기는 넘기지 않는다.
function bindSwipe(box) {
  let x0 = null, y0 = 0, t0 = 0;
  box.addEventListener('touchstart', e => { if (e.touches.length !== 1 || e.target.closest?.('input,textarea,.rd-switch,[data-rd-detail]')) { x0 = null; return; } x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now(); }, {passive: true});
  box.addEventListener('touchend', e => {
    if (x0 === null) return;
    const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
    x0 = null;
    if (claimedSince(t0)) return;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 2) return;
    const next = nextFilter(state.filter, dx < 0 ? 1 : -1);
    if (next !== state.filter) { setFilter(next); drawList(); }
  }, {passive: true});
}

// S70-62부터 왼쪽 밀기 칸은 [수정][삭제](아래). 옛 설명 — UI-줄밀기 Raindrop식(S68-26 2/2, 명진 11/22 21:31): 폰 읽을 거리 줄 — 왼쪽으로 밀면 [사업에 연결]·[읽음]/[안 읽음으로],
// 오른쪽으로 밀면 여러 개 선택(막대 '[전체 선택][삭제]' 두 칸, S70-64b — 읽음은 줄 밀기·⋯로). News에서 보낸 줄도 같은 단추(S68-29).
// 단추는 ⋯ 메뉴와 같은 함수만 부른다(toggleRead·pickArea·removeAny). S68-31(명진 11/23 02:24 "삭제가 필요 가능한 경우 왼쪽으로 밀 때 삭제도"):
// 왼쪽 밀기 맨 끝에 [삭제] — ⋯ [삭제]와 같은 removeAny(직접 넣은 줄은 묻고 지우기, News에서 보낸 줄은 5초 [되돌리기]). 끝까지 밀어도 칸만 열린다.
function bindRows(box) {
  const keyOf = el => el?.dataset?.rdPick || '';
  bindRowSwipe(box, {row: '.rd-row[data-rd-pick]', enabled: () => state.loaded && !state.adding,
    actions: el => {
      const key = keyOf(el);
      const row = rowOf(key);
      if (!row) return null;
      // S70-62 READ-밀기메뉴(명진 11/26 07:41 "저장된 글에서는 수정 삭제로"): 칸은 [수정][삭제] 둘. 읽음·사업에 연결은 ⋯·글 보기에 그대로.
      // [수정]은 ⋯ [수정]과 같은 startEdit(고칠 수 없는 줄 — News에서 온 사회운동 글 — 은 [삭제]만).
      return {start: PICK, end: [...(editKind(key) ? [EDIT] : []), {key: 'delete', label: '삭제', tone: 'danger'}]};
    },
    run: (key, el) => {
      const id = keyOf(el);
      const row = rowOf(id);
      if (!row) return;
      if (key === 'edit') void startEdit(id);
      else if (key === 'delete') void removeAny(id, box.querySelector(`[data-rd-more="${CSS.escape(id)}"]`) || el);
    },
    // 고른 줄: [삭제]는 removeMany(⋯ 삭제와 같은 규칙, 묻기·알림은 한 번).
    select: {attr: 'data-rd-pick', label: '선택한 글', acts: () => [{key: 'delete', label: '삭제', danger: true}],
      run: async (key, ids) => { if (key === 'delete') await removeMany(ids); }}});
}

function bind() {
  const v = view();
  if (!v || v.dataset.rdBound) return;
  v.dataset.rdBound = '1';
  v.addEventListener('click', e => {
    const t = e.target;
    const hm = t.closest?.('[data-rd-marks] [data-nh-more]');
    if (hm?.dataset.hlId) { openMarkMenu(hm, {onSource: openMark}); return; }
    const ho = t.closest?.('[data-rd-marks] [data-nh-open]');
    if (ho) { openMark(highlightById(ho.dataset.nhOpen)); return; }
    const mo = t.closest?.('[data-rd-memo-list] [data-memo-open]');
    if (mo) { openMemoLine(mo.dataset.memoOpen); return; }
    const more = t.closest?.('[data-rd-more]');
    if (more) { headMenu = more.dataset.rdHeadMore === '1'; menu.open(more); return; }
    // S70-83 폴더 상자: 머리(접기)·＋(새 폴더)·폴더 ⋯·폴더 이름(그 폴더 글만, 다시 누르면 전체).
    const fmore = t.closest?.('[data-rd-folder-more]');
    if (fmore) { folderMenu.open(fmore); return; }
    const fadd = t.closest?.('[data-rd-folder-add]');
    if (fadd) { void addFolder(fadd); return; }
    if (t.closest?.('[data-rd-fbox]')) { state.boxOpen = !state.boxOpen; drawList(); view()?.querySelector('[data-rd-fbox]')?.focus({preventScroll: true}); return; }
    const fpick = t.closest?.('[data-rd-folder]');
    if (fpick) { pickFolder(fpick.dataset.rdFolder); view()?.querySelector(`[data-rd-folder="${CSS.escape(fpick.dataset.rdFolder)}"]`)?.focus({preventScroll: true}); return; }
    if (t.closest?.('[data-rd-add-close]')) { state.adding = false; state.addError = ''; drawList(); return; }
    if (t.closest?.('[data-rd-bm-link]')) { e.preventDefault(); notify('즐겨찾기 막대로 끌어 놓아 쓰세요', {record: false}); return; }
    if (t.closest?.('[data-rd-bm-copy]')) { void copyText(bookmarklet()).then(ok => notify(ok ? '한 줄 복사했어요 · 즐겨찾기 막대 오른쪽 클릭 → 페이지 추가 → URL에 붙여 넣기' : '복사하지 못했어요', {record: false, error: !ok})); return; }
    if (t.closest?.('[data-rd-retry]')) { void refresh(); return; }
    if (t.closest?.('[data-rd-back]')) { closeDetail(); return; }
    const f = t.closest?.('[data-rd-fetch]');
    if (f) { const row = rowOf(f.dataset.rdFetch); if (row) void startFetch(row); return; }
    const re = t.closest?.('[data-rd-reopen]');
    if (re) { void openItem(re.dataset.rdReopen); return; }
    if (t.closest?.('[data-rd-edit-cancel]')) { if (!state.editBusy) { state.editing = null; state.editNote = ''; drawDetail(); } return; }
    const open = t.closest?.('[data-rd-open]');
    if (open && !t.closest('a,button,input')) {
      const id = open.dataset.rdOpen, link = newsLinkOf(id);
      // 두 칸은 오른쪽 칸에 연다. 이 화면이 열 수 없는 줄(id 모양이 아님)은 전처럼 읽을 거리 글 보기로.
      if (link && (!split() || !isId(id))) { void markOpened(id); void openNews(link); } else void openItem(id);
      return;
    }
  });
  v.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[data-rd-open][role=button]')) { e.preventDefault(); e.target.click(); } });
  v.addEventListener('submit', e => {
    const edit = e.target.closest?.('[data-rd-edit-form]');
    if (edit) { e.preventDefault(); void saveEdit(edit); return; }
    const form = e.target.closest?.('[data-rd-form]');
    if (!form) return;
    e.preventDefault();
    void addUrl(form.querySelector('input')?.value || '');
  });
  // S71-26: ＋는 화면 이름 줄 상자(이 화면 칸 밖)에 있어 같은 동작을 상자에도 붙인다(목록 안 [닫기]와 같은 상태·같은 그리기).
  tools.addEventListener('click', e => { if (e.target.closest?.('[data-rd-add]')) { state.adding = !state.adding; state.addError = ''; drawList(); } });
  const listBox = v.querySelector('[data-rd-list]');
  if (listBox) { bindSwipe(v); bindRows(listBox); bindFolderDrag(listBox); }
  detailBox = v.querySelector('[data-rd-detail]');
  bindMarks(detailBox);
  bindSelectZone(detailBox, {zone: '[data-rd-prose]', source: () => sourceOf(rowOf(state.open)), onSave: saveFromSelection, onNote: noteFromSelection});
  onHighlights(() => { if (window.KPTURouter?.current === 'reading') draw(); });
  // 노트 폴더 잠금이 풀리거나 잠기면 [밑줄] 탭의 노트 밑줄이 바뀐다(노트 › 밑줄과 같게).
  window.addEventListener('kptu:feature-lock-changed', () => { if (window.KPTURouter?.current === 'reading') drawList(); });
  // 원문 받는 중·끝(폰 공유로 넣은 줄 포함)은 이 화면에 있을 때 다시 그린다. 다른 화면에서 넣은 줄은 이 화면에 들어올 때 다시 읽는다(refresh).
  window.addEventListener(CHANGED, e => {
    const k = e.detail?.kind;
    if ((k === 'fetching' || k === 'fetched') && window.KPTURouter?.current === 'reading') draw();
  });
  window.addEventListener('resize', () => { if (window.KPTURouter?.current === 'reading') drawDetail(); });
  // 폴드를 펼치거나 접으면(칸 나누기 폭을 넘나들면): 펼침 = 두 칸(열린 글이 없으면 맨 위 글), 접힘 = 한 칸(열린 글이 있으면 글 화면, 뒤로 = 목록).
  SPLIT?.addEventListener?.('change', () => {
    if (window.KPTURouter?.current !== 'reading') return;
    if (!split() && state.open) openLayer(state.open);
    draw();
  });
}

async function refresh() {
  if (!state.loaded) drawList();
  await load();
  draw();
  if (!areaNames) void refreshAreaNames();
  if (state.loaded && !state.failed) void autoRefetch();
}
// 다른 화면(전체 검색·노트 › 밑줄·폰 공유 알림 [열기])에서 이 화면의 한 줄을 열어 달라는 요청(한 번만).
function takeAsked() {
  const ask = window.KPTUReadingOpen;
  window.KPTUReadingOpen = null;
  if (ask && isId(ask.id)) void openItem(ask.id, {highlight: ask.highlight || null});
}

install(); bind();
state.filter = filterFromUrl(); state.folder = folderFromUrl();
window.KPTURouter?.on?.('reading', () => { state.filter = filterFromUrl(); state.folder = folderFromUrl(); if (state.loaded) drawList(); void refresh().then(takeAsked); });
void refresh().then(takeAsked);
window.KPTUReading = {refresh, open: (id, opts) => { window.KPTUReadingOpen = {id, ...(opts || {})}; if (window.KPTURouter?.current === 'reading') takeAsked(); else void openOnScreen('reading'); }};
