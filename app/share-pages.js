import {waitInlineHtml, waitEl, emptyEl} from './wait-state.js';
// SHARE-현장공유 PR 2(화면): the top of the "공유 페이지" menu (#sharePagesRoot). This module is the only renderer of that
// region: my share pages list + [새 공유 페이지], and the editor (title, blocks, 초안/게시, project link, links).
// SHARE-보관함·HTML공유: one folded '보관함 n' under the list holds the kept share pages (newest first) and, below them, the old
// Web1 cards (web1-board.js draws those into #web1BoardLegacy; this module only places that holder inside the 보관함 line).
// The old '이전 페이지' and '지나간 업무 · 사업' folds are gone; no record is removed. HTML file pages (share-html.js) are lines
// with an 'HTML' tag and their own ⋯ (링크 복사 · 새 파일로 바꾸기 · 링크 끄기/켜기 · 보관함으로 · 삭제); pressing one shows its preview.
// SHARE-전체편집: a page that is one 글(doc) block — every new page — opens as a full writing screen (renderFull): one thin
// line (‹ · 초안/게시 · 프로젝트 · 링크 · 저장), the editor's button row, a big title and the text, over the whole content area.
// A page with old blocks (한 줄 현황 …) keeps the block editor below (설계 4.2, [새 편집기로 바꾸기]).
// SHARE-페이지삭제: each list line has a ⋯ (right-click on a PC opens the same menu: context-menu.js) with [보관] and [삭제].
// 보관 = keep the record, status 'archived' (share-pages-archive.mjs): it leaves the list for the 보관함 and the public link stops
// (share-page-read shows only 'published'); links and photos stay. One confirmation, then 5 seconds of [되돌리기].
// 보관함 = one small folded line under the list ('보관함 n'); its lines have a ⋯ with [되살리기] (always back as a draft) and [삭제].
// TRASH-다른삭제: 삭제 = the 휴지통 (same flow as the other kinds: trash-actions.js deleteToTrash, DB deleted_at). 보관함 and 휴지통 are separate
// (like the Telegram feed): 보관 keeps status 'archived' as before; 삭제 hides the page and its link (the DB closes the status) and the page,
// links and photos stay; the 5-second [되돌리기] and the 휴지통 tab ([되돌리기] = same status as before, a published page's same link opens again)
// bring it back. The permanent delete is only in the 휴지통 tab (project-system-v3.js → share-page-media purge_page).
// A kept page is not opened in the editor (a save would bring it back unseen).
// Storage is the owner-RLS tables from PR 1 through the shared runtime (authenticated REST); no new RPC.
// A link value (token) is read from the DB only when [복사] is pressed and goes straight to the clipboard: it is never
// drawn, kept in this module, logged or stored in the browser. Lists read only id·label·expiry·off·created.
import {BLOCK_TYPES, ALL_TYPES, BLOCK_LABELS, ITEM_FIELDS, LIMITS, newBlock, newItem, moveBlock, normalizeBlocks, pageProblem,
  labelProblem, expiresAt, linkState, shareUrl, blockIsEmpty, blocksToDoc} from './share-pages-model.mjs';
import {renderBlock} from './sr-render.mjs';
import {copyText} from './copy-text.js';
import {flashDone} from './press-feedback.js';
import {createDocEditor} from './ed-editor.js';
import {createSharePhotos, shareIdOf, SHARE_PHOTO_MAX} from './share-photos.js';
import {createAnchoredMenu} from './anchored-menu.js';
import {offerUndoNotice} from './basket-record-delete.js';
import {archiveFilter, boxFilter, archiveConfirmText, archivePatch, undoPatch, restorePatch, shortTitle} from './share-pages-archive.mjs';
import {deleteToTrash} from './trash-actions.js';
import {createShareHtml} from './share-html.js';
import {htmlState, HTML_STATE_TEXT} from './share-html-model.mjs';

(() => {
if (window.KPTUSharePages) return;
const root = document.querySelector('#sharePagesRoot');
const view = document.querySelector('#pagesView');
if (!root || !view) return;
const rt = window.KPTURuntime;
const PAGE_COLUMNS = 'id,title,blocks,status,project_id,updated_at';
const LINK_COLUMNS = 'id,label,expires_at,disabled_at,created_at';

const ownerScope = () => { const c = rt.context.read(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
function workspaceId() {
  const id = rt.context.read()?.workspace?.id;
  if (!id) throw new Error('업무 공간을 확인할 수 없어요.');
  return id;
}
const q = encodeURIComponent;
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'text') node.textContent = value;
    else if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key in node && typeof value !== 'string') node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.flat().filter(c => c !== null && c !== undefined && c !== false));
  return node;
}
const day = iso => { try { return new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul', year:'numeric', month:'numeric', day:'numeric'}).format(new Date(iso)); } catch { return ''; } };
const message = (e, fallback) => (e?.status === 401 || e?.code === 'session_required') ? '로그인이 끝났어요. 다시 로그인해 주세요.' : fallback;

let scope = ownerScope(), epoch = 0;
let pages = null, listState = 'idle';
let box = null, boxOpen = false; // 보관함: the kept pages (id·title·updated_at), read with the list; folded unless opened
// HTML file pages: the ids that have a file version, and each page's links (only off·expiry, never the link value).
let htmlIds = new Set(), linksByPage = new Map();
const isHtml = id => htmlIds.has(id);
const htmlLineState = page => htmlState(page, linksByPage.get(page.id));
let editing = null; // {id, title, status, project_id, blocks, updated_at, saved, links, linksState, mode:'full'|'blocks'}
let busy = false, layer = null;
// ED-통합편집기 ①b: the open 글(doc) block is edited with the new editor (ed-editor.js). One instance at a time, for the
// open block only; it writes each change into that block (block.doc), so a redraw (move, add) keeps the text.
let docEditor = null, docMount = 0;
function dropDocEditor() { docMount++; if (docEditor) { docEditor.destroy(); docEditor = null; } }

const listView = el('div', {class:'sp-list-view', dataset:{spList:''}});
const editorView = el('div', {class:'sp-editor', hidden:true, dataset:{spEditor:''}});
root.replaceChildren(listView, editorView);

// ── list ──
function renderList() {
  const status = el('p', {class:'sp-status', role:'status', 'aria-live':'polite', dataset:{spListStatus:''}});
  const head = el('div', {class:'sp-head'},
    // UI-전수디자인점검 F12: the phone head line and the PC top line already name the screen; the body title is the shared
    // .screen-title (screen readers only, every width). No count beside it (the list itself shows the rows).
    el('h2', {class:'screen-title'}, '공유 페이지'),
    el('div', {class:'sp-head-actions'},
      el('button', {type:'button', class:'secondary', 'aria-label':'새 HTML 공유 페이지', dataset:{spNewHtml:''}, text:'+ HTML'}),
      el('button', {type:'button', class:'primary', 'aria-label':'새 공유 페이지', dataset:{spNew:''}, text:'+ 새 공유 페이지'})));
  const body = [];
  if (listState === 'loading' && !pages) status.innerHTML = waitInlineHtml();
  else if (listState === 'error') {
    status.textContent = '공유 페이지 목록을 불러오지 못했어요.';
    body.push(el('button', {type:'button', class:'secondary', dataset:{spReload:''}, text:'다시 불러오기'}));
  } else if (pages && !pages.length) body.push(emptyEl());
  if (pages?.length) body.push(el('ul', {class:'sp-list', 'aria-label':'내 공유 페이지'}, pages.map(page => el('li', {},
    el('button', {type:'button', class:'sp-row', dataset:isHtml(page.id) ? {spPreview:page.id} : {spOpen:page.id}},
      el('span', {class:'sp-row-title', text:page.title || '제목 없음'}),
      el('span', {class:'sp-kind', text:isHtml(page.id) ? 'HTML' : '블록'}),
      isHtml(page.id)
        ? el('span', {class:`sp-pill ${htmlLineState(page) === 'on' ? 'is-on' : ''}`, dataset:{spHtmlState:htmlLineState(page)}, text:HTML_STATE_TEXT[htmlLineState(page)]})
        : el('span', {class:`sp-pill ${page.status === 'published' ? 'is-on' : ''}`, text:page.status === 'published' ? '게시' : '초안'})),
    el('button', {type:'button', class:'sp-row-more', dataset:{spRowMenu:page.id}, 'aria-label':`${shortTitle(page.title)} 더 보기`,
      'aria-haspopup':'true', 'aria-expanded':'false', 'aria-controls':'spRowMenu'}, el('span', {class:'more-dots', 'aria-hidden':'true', text:'⋯'}))))));
  // 보관함: kept share pages (newest first), then the old Web1 pages (fixed cards without a date, drawn by web1-board.js).
  const legacy = document.querySelector('#web1BoardLegacy');
  const legacyCount = legacy ? legacy.querySelectorAll('.w1b-card').length : 0;
  const kept = box || [];
  if (kept.length || legacy) {
    const details = el('details', {class:'sp-box', open:boxOpen, dataset:{spBox:''}},
      el('summary', {class:'sp-box-summary', text:`보관함 ${kept.length + legacyCount}`}),
      kept.length ? el('ul', {class:'sp-list sp-box-list', 'aria-label':'보관함'}, kept.map(page => el('li', {},
        el('div', {class:'sp-row sp-box-row'},
          el('span', {class:'sp-row-title', text:page.title || '제목 없음'}),
          el('span', {class:'sp-row-meta', text:day(page.updated_at)})),
        el('button', {type:'button', class:'sp-row-more', dataset:{spBoxMenu:page.id}, 'aria-label':`${shortTitle(page.title)} 더 보기`,
          'aria-haspopup':'true', 'aria-expanded':'false', 'aria-controls':'spRowMenu'}, el('span', {class:'more-dots', 'aria-hidden':'true', text:'⋯'}))))) : null);
    if (legacy) { legacy.hidden = false; details.append(legacy); }
    body.push(details);
  }
  listView.replaceChildren(head, status, ...body);
  view.dataset.sharePagesReady = '1';
}
async function loadList({force = false} = {}) {
  if (!force && (listState === 'loading' || (pages && listState === 'ready'))) { renderList(); return; }
  const run = ++epoch, owner = scope;
  listState = 'loading'; renderList();
  try {
    const ws = q(workspaceId());
    const [rows, kept] = await Promise.all([
      rt.api(`/rest/v1/app_share_pages?workspace_id=eq.${ws}&select=id,title,status,project_id,updated_at&${archiveFilter}&order=updated_at.desc`, {singleFlight:false}),
      rt.api(`/rest/v1/app_share_pages?workspace_id=eq.${ws}&select=id,title,updated_at&${boxFilter}&order=updated_at.desc`, {singleFlight:false})]);
    if (run !== epoch || owner !== scope) return;
    if (!Array.isArray(rows) || !Array.isArray(kept)) throw new Error('bad list');
    pages = rows; box = kept; listState = 'ready';
    // HTML file pages and their link states. Before the DB step these tables are missing: every page is then a block page.
    const [versions, links] = await Promise.all([
      rt.api(`/rest/v1/app_share_page_html?workspace_id=eq.${ws}&select=page_id`, {singleFlight:false}).catch(() => []),
      rt.api(`/rest/v1/app_share_page_links?workspace_id=eq.${ws}&select=page_id,expires_at,disabled_at`, {singleFlight:false}).catch(() => [])]);
    if (run !== epoch || owner !== scope) return;
    htmlIds = new Set((Array.isArray(versions) ? versions : []).map(v => v.page_id));
    linksByPage = new Map();
    for (const link of Array.isArray(links) ? links : []) linksByPage.set(link.page_id, [...(linksByPage.get(link.page_id) || []), link]);
  } catch (e) {
    if (run !== epoch || owner !== scope) return;
    listState = 'error';
  }
  renderList();
}

// ── 보관 · 보관함 · 삭제 (SHARE-페이지삭제) ──
let rowMenu = null, rowBusy = false;
const MENU_ITEMS = {
  list:'<button type="button" data-sp-row-action="archive">보관</button><button type="button" class="task-inline-danger" data-sp-row-action="trash">삭제</button>',
  box:'<button type="button" data-sp-row-action="restore">되살리기</button><button type="button" class="task-inline-danger" data-sp-row-action="trash">삭제</button>',
  html:on => `<button type="button" data-sp-row-action="copy">링크 복사</button><button type="button" data-sp-row-action="replace">새 파일로 바꾸기</button>${on
    ? '<button type="button" data-sp-row-action="link-off">링크 끄기</button>' : '<button type="button" data-sp-row-action="link-on">링크 켜기</button>'}<button type="button" data-sp-row-action="archive">보관함으로</button><button type="button" class="task-inline-danger" data-sp-row-action="trash">삭제</button>`,
};
function ensureRowMenu() {
  return rowMenu ||= createAnchoredMenu({id:'spRowMenu', className:'task-inline-menu sp-row-menu', label:'공유 페이지 관리', historyKey:'kptuSharePageMenu',
    key:t => t.dataset.spRowMenu ? `list:${t.dataset.spRowMenu}` : `box:${t.dataset.spBoxMenu}`, canOpen:() => !rowBusy && !editing,
    render:key => {
      if (key.startsWith('box:')) return MENU_ITEMS.box;
      const id = key.slice(5), page = pages?.find(p => p.id === id);
      return page && isHtml(id) ? MENU_ITEMS.html(htmlLineState(page) === 'on') : MENU_ITEMS.list;
    },
    onAction:(button, active) => {
      const id = active.id.slice(active.id.indexOf(':') + 1), action = button.dataset.spRowAction;
      const page = pages?.find(p => p.id === id);
      if (page && ['copy', 'replace', 'link-off', 'link-on'].includes(action)) { void htmlAction(action, page); return; }
      if (action === 'archive') void archivePage(id);
      else if (action === 'restore') void restorePage(id);
      else if (action === 'trash') void trashPage(id);
    }});
}
const listNote = text => { const node = listView.querySelector('[data-sp-list-status]'); if (node) node.textContent = text; };
const shareHtml = createShareHtml({rt, workspaceId, onChanged:() => { void loadList({force:true}); }});
async function htmlAction(action, page) {
  if (action === 'replace') { shareHtml.openReplace(page); return; }
  if (rowBusy) return;
  const owner = scope;
  rowBusy = true;
  listNote(action === 'copy' ? '링크를 복사하는 중…' : action === 'link-off' ? '링크를 끄는 중…' : '링크를 켜는 중…');
  try {
    const text = action === 'copy' ? await shareHtml.copyLink(page) : action === 'link-off' ? await shareHtml.linkOff(page) : await shareHtml.linkOn(page);
    if (owner === scope) listNote(text);
  } finally { rowBusy = false; }
}
async function archivePage(id) {
  const page = pages?.find(p => p.id === id);
  if (!page || rowBusy) return;
  if (!window.confirm(archiveConfirmText(page))) return;
  const owner = scope, wasStatus = page.status, wasUpdated = page.updated_at;
  rowBusy = true; listNote('보관하는 중…');
  try {
    const rows = await rt.api(`/rest/v1/app_share_pages?${archivePatch.where(id, workspaceId(), wasUpdated)}&select=id,updated_at`,
      {method:'PATCH', prefer:'return=representation', body:archivePatch.body(new Date().toISOString())});
    if (owner !== scope) return;
    if (!Array.isArray(rows) || rows.length !== 1) { listNote('다른 곳에서 바뀐 페이지예요. 목록을 다시 불러왔어요.'); void loadList({force:true}); return; }
    const archivedAt = rows[0].updated_at;
    pages = pages.filter(p => p.id !== id);
    box = [{id, title:page.title, updated_at:archivedAt}, ...(box || []).filter(p => p.id !== id)];
    renderList(); listNote('');
    offerUndoNotice({text:wasStatus === 'published' ? '보관함으로 옮겼어요. 링크도 열리지 않아요.' : '보관함으로 옮겼어요.', onUndo:async () => {
      if (owner !== scope) return {status:'stale'};
      try {
        const back = await rt.api(`/rest/v1/app_share_pages?${undoPatch.where(id, workspaceId(), archivedAt)}&select=id`,
          {method:'PATCH', prefer:'return=representation', body:undoPatch.body(wasStatus, wasUpdated)});
        if (owner !== scope) return {status:'stale'};
        if (!Array.isArray(back) || back.length !== 1) return {status:'failed', message:'되돌리지 못했어요. 목록을 다시 불러와 확인해 주세요.'};
        void loadList({force:true});
        return {status:'restored', message:'보관을 되돌렸어요.'};
      } catch (e) { return {status:'failed', message:message(e, '되돌리지 못했어요. 다시 시도해 주세요.')}; }
    }});
  } catch (e) {
    if (owner === scope) listNote(message(e, '보관하지 못했어요. 다시 시도해 주세요.'));
  } finally { rowBusy = false; }
}
// 되살리기: back to the list as a draft (설계: no column keeps the old status; a page that was published is shown again only after
// the owner presses 게시, so a link is never opened again without being seen). Conditional on the kept row as the screen read it.
async function restorePage(id) {
  const page = box?.find(p => p.id === id);
  if (!page || rowBusy) return;
  const owner = scope;
  rowBusy = true; listNote('되살리는 중…');
  try {
    const rows = await rt.api(`/rest/v1/app_share_pages?${restorePatch.where(id, workspaceId(), page.updated_at)}&select=id`,
      {method:'PATCH', prefer:'return=representation', body:restorePatch.body(new Date().toISOString())});
    if (owner !== scope) return;
    if (!Array.isArray(rows) || rows.length !== 1) { listNote('다른 곳에서 바뀐 페이지예요. 목록을 다시 불러왔어요.'); void loadList({force:true}); return; }
    await loadList({force:true});
    if (owner === scope) listNote('초안으로 되살렸어요. 다시 공개하려면 열어서 [게시]를 눌러 주세요.');
  } catch (e) {
    if (owner === scope) listNote(message(e, '되살리지 못했어요. 다시 시도해 주세요.'));
  } finally { rowBusy = false; }
}
// 삭제 = 휴지통: the DELETE below is turned into 'in the trash' by the DB (the page, its links and photos stay; the status closes so the public link
// stops). deleteToTrash asks once, then checks the result with app_trash_list before it says so; before the DB has the kind it says 'preparing' and sends nothing.
async function trashPage(id) {
  const page = pages?.find(p => p.id === id) || box?.find(p => p.id === id);
  if (!page || rowBusy) return;
  const owner = scope, status = pages?.some(p => p.id === id) ? page.status : 'archived';
  rowBusy = true; listNote('휴지통으로 옮기는 중…');
  try {
    const result = await deleteToTrash({kind:'share_page', id, name:page.title, detail:{status}, rt,
      remove:() => rt.api(`/rest/v1/app_share_pages?id=eq.${q(id)}&workspace_id=eq.${q(workspaceId())}`, {method:'DELETE', prefer:'return=minimal'}),
      afterChange:() => owner === scope ? loadList({force:true}) : Promise.resolve(),
      notify:text => { if (owner === scope) listNote(text); }});
    if (owner !== scope) return;
    if (result.status === 'failed') listNote(message(result.error, '삭제하지 못했어요. 다시 시도해 주세요.'));
    else if (result.status === 'moved' || result.status === 'cancelled') listNote('');
  } finally { rowBusy = false; }
}

// ── editor ──
// A page with no block or only one 글 block is written on the full screen.
const isFullPage = blocks => !blocks.length || (blocks.length === 1 && blocks[0]?.type === 'doc');
const snapshotOf = page => JSON.stringify({title:String(page.title || '').trim(), status:page.status, project_id:page.project_id || null, blocks:normalizeBlocks(page.blocks)});
const dirty = () => !!editing && snapshotOf(editing) !== editing.saved;
const editorStatus = text => { const node = editorView.querySelector('[data-sp-status-line]'); if (node) node.textContent = text; };
// '저장 안 됨' on the full screen's top line, painted once per frame while typing.
let dirtyFrame = 0;
function paintDirty() {
  const node = editorView.querySelector('[data-sp-dirty]');
  if (!node || !editing) return;
  const unsaved = dirty();
  node.hidden = !unsaved;
  if (unsaved && !busy) editorStatus('');
}
const queueDirty = () => { if (!dirtyFrame) dirtyFrame = requestAnimationFrame(() => { dirtyFrame = 0; paintDirty(); }); };
const linkStatus = text => { const node = editorView.querySelector('[data-sp-link-status]'); if (node) node.textContent = text; };

function itemRow(block, b, i) {
  const fields = ITEM_FIELDS[block.type], item = block.items[i], n = i + 1;
  const row = el('li', {class:`sp-item sp-item-${block.type}`});
  if (block.type === 'stages') row.append(el('label', {class:'sp-current'},
    el('input', {type:'radio', name:`sp-stage-${b}`, value:String(i), checked:block.current === i, dataset:{spCurrent:String(b)}}),
    el('span', {text:'지금'})));
  for (const [field, label, max, multiline] of fields) {
    const input = el(multiline ? 'textarea' : 'input', {
      class:'sp-input', rows:multiline ? 2 : undefined, type:multiline ? undefined : (field === 'url' ? 'url' : 'text'),
      maxLength:max, value:item[field] ?? '', placeholder:label,
      'aria-label':`${BLOCK_LABELS[block.type]} ${n}번째 줄 ${label}`, inputMode:field === 'url' ? 'url' : undefined,
      dataset:{spB:String(b), spI:String(i), spF:field}});
    if (multiline) input.value = item[field] ?? '';
    row.append(input);
  }
  row.append(el('button', {type:'button', class:'sp-tool', dataset:{spItemDel:`${b}:${i}`}, 'aria-label':`${BLOCK_LABELS[block.type]} ${n}번째 줄 지우기`, text:'줄 삭제'}));
  return row;
}
// SHARE-보이는편집: the blocks are shown exactly as the Web1 reader draws them (sr-render.mjs + sr-blocks.css, from the
// saved form normalizeBlocks gives). Pressing a block turns only that block into its input fields in place; [완료] shows
// it again as it will look, [취소] puts back what it was when opened. One block is open at a time (editing.open).
function blockTools(block, b, count) {
  const label = BLOCK_LABELS[block.type], n = b + 1;
  return [
    el('button', {type:'button', class:'sp-tool', disabled:b === 0, dataset:{spMove:`${b}:-1`}, 'aria-label':`${n}번째 블록 ${label} 위로`, text:'위로'}),
    el('button', {type:'button', class:'sp-tool', disabled:b === count - 1, dataset:{spMove:`${b}:1`}, 'aria-label':`${n}번째 블록 ${label} 아래로`, text:'아래로'}),
    el('button', {type:'button', class:'sp-tool sp-danger', dataset:{spBlockDel:String(b)}, 'aria-label':`${n}번째 블록 ${label} 지우기`, text:'삭제'})];
}
function editNode(block, b, count) {
  const label = BLOCK_LABELS[block.type], n = b + 1;
  const tools = el('div', {class:'sp-block-tools', role:'group', 'aria-label':`${n}번째 블록 (${label}) 옮기기·지우기`}, blockTools(block, b, count));
  const box = el('section', {class:`sp-block sp-block-${block.type} is-editing`, 'aria-label':`${n}번째 블록 ${label}`, dataset:{spBlock:String(b), spType:block.type}},
    el('div', {class:'sp-block-head'}, el('h3', {text:label}), tools));
  if (block.type === 'doc') {
    const host = el('div', {class:'sp-doc-host', dataset:{spDocHost:String(b)}}, waitEl({rows: 3}));
    box.append(host);
    const mount = ++docMount;
    createDocEditor({host, value:block.doc, label:`${n}번째 블록 글`, placeholder:'여기에 쓰세요', photos:photosFor(editing),
      onChange:value => { if (editing && editing.blocks[b] === block) block.doc = value; }}).then(ed => {
      if (mount !== docMount || !host.isConnected) { ed.destroy(); return; }
      host.querySelector('.sp-hint')?.remove();
      docEditor = ed;
      if (editing?.focusDoc) { editing.focusDoc = false; ed.focus(); }
    }).catch(() => { if (mount === docMount && host.isConnected) host.replaceChildren(el('p', {class:'sp-hint', role:'alert', text:'편집기를 열지 못했어요. [취소] 뒤 다시 눌러 주세요.'})); });
  } else if (block.type === 'summary') {
    box.append(el('textarea', {class:'sp-input', rows:2, maxLength:LIMITS.summary, placeholder:'예: 3차 교섭 결렬, 10월 말 조정 신청 예정',
      'aria-label':`${n}번째 블록 한 줄 현황 글`, value:block.text || '', dataset:{spB:String(b), spF:'text'}}));
    box.querySelector('textarea').value = block.text || '';
  } else {
    box.append(el('input', {type:'text', class:'sp-input sp-block-title', maxLength:LIMITS.blockTitle, value:block.title || '',
      placeholder:`블록 제목 (비우면 "${label}")`, 'aria-label':`${n}번째 블록 제목`, dataset:{spB:String(b), spF:'title'}}));
    box.append(el('ol', {class:'sp-items'}, block.items.map((_, i) => itemRow(block, b, i))));
    box.append(el('button', {type:'button', class:'sp-tool sp-add-item', dataset:{spItemAdd:String(b)}, disabled:block.items.length >= LIMITS.items,
      'aria-label':`${n}번째 블록 ${label}에 줄 추가`, text:'+ 줄 추가'}));
  }
  box.append(el('div', {class:'sp-block-done'},
    el('button', {type:'button', class:'sp-tool', dataset:{spCancel:String(b)}, 'aria-label':`${n}번째 블록 ${label} 고친 것 취소`, text:'취소'}),
    el('button', {type:'button', class:'sp-tool sp-done', dataset:{spDone:String(b)}, 'aria-label':`${n}번째 블록 ${label} 고치기 완료`, text:'완료'})));
  return box;
}
// ED-② share photos: asked from the Edge function with the saved page's id, never kept in this browser. The preview of a 글 block
// draws a photo once its short address is known (mediaNow), then paints that block again.
let photoApi = null, photoPage = null, mediaNow = {}, mediaAsk = 0;
function photosFor(page) {
  if (photoPage !== page) { photoPage = page; photoApi = createSharePhotos({rt, getPageId: () => page.id || null}); mediaNow = {}; }
  return {add: file => photoApi.add(file), url: src => photoApi.url(src), max: SHARE_PHOTO_MAX};
}
// The share:<id> photos in these blocks' 글 blocks.
function photoIdsIn(blocks) {
  const ids = [];
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node.type === 'image' && node.attrs && shareIdOf(node.attrs.src)) ids.push(shareIdOf(node.attrs.src));
    walk(node.content);
  };
  for (const block of Array.isArray(blocks) ? blocks : []) if (block && block.type === 'doc') walk(block.doc && block.doc.doc);
  return ids;
}
// SHARE-사진같이지우기: after a save, or when the editor closes, the photos taken out of the page are removed from the private bucket
// (file and record) by share-page-media, which reads the page as saved in the DB. Not waited for and never shown as an error:
// a failure leaves the record, and the next save or close of this page asks again.
function prunePhotos(page, keepNow) {
  if (!page || !page.id || photoPage !== page || !photoApi) return;
  void photoApi.prune(keepNow);
}
function primeMedia(page) {
  if (!page || !page.id) return;
  const ids = photoIdsIn(page.blocks);
  if (!ids.length || ids.every(id => id in mediaNow)) return;
  photosFor(page);
  const ask = ++mediaAsk;
  photoApi.urls(ids).then(map => {
    if (ask !== mediaAsk || editing !== page) return;
    // An id with no address now is marked (asked once), so a missing photo does not make this ask again and again.
    const next = {...mediaNow};
    for (const id of ids) next[id] = map[id] || '';
    mediaNow = next;
    if (page.open === -1 || page.open === undefined) renderBlocks();
  }).catch(() => {});
}
function viewNode(block, b, count) {
  const label = BLOCK_LABELS[block.type], n = b + 1;
  const shown = normalizeBlocks([block])[0];
  const drawn = renderBlock(shown, mediaNow) || el('p', {class:'sp-hint', text:'표시할 수 없는 블록이에요.'});
  drawn.setAttribute('inert', '');
  const empty = blockIsEmpty(shown);
  const box = el('div', {class:`sp-vblock${empty ? ' is-empty' : ''}`, role:'group', 'aria-label':`${n}번째 블록 ${label}`, dataset:{spBlock:String(b), spType:block.type}},
    drawn,
    empty ? el('p', {class:'sp-vblock-empty', 'aria-hidden':'true', text:'비어 있어요. 눌러서 채워 주세요.'}) : null,
    el('button', {type:'button', class:'sp-vblock-edit', dataset:{spEdit:String(b)}, 'aria-label':`${n}번째 블록 ${label} 고치기`},
      el('span', {class:'sp-vblock-hint', 'aria-hidden':'true', text:'고치기'})),
    el('details', {class:'sp-more', dataset:{spMore:String(b)}},
      el('summary', {class:'sp-more-button', 'aria-label':`${n}번째 블록 ${label} 메뉴`}, el('span', {class:'more-dots', 'aria-hidden':'true', text:'⋯'})),
      el('div', {class:'sp-more-panel', role:'group', 'aria-label':`${n}번째 블록 ${label} 옮기기·지우기`}, blockTools(block, b, count))));
  return box;
}
// [+ 블록] between two blocks: the picked kind goes in at that place and opens.
function insertSlot(at, count) {
  return el('details', {class:'sp-slot', dataset:{spSlot:String(at)}},
    el('summary', {class:'sp-slot-button', 'aria-label':`${at}번째와 ${at + 1}번째 블록 사이에 블록 넣기`}, el('span', {'aria-hidden':'true', text:'+ 블록'})),
    el('div', {class:'sp-slot-panel', role:'group', 'aria-label':`${at}번째 블록 다음에 넣을 블록`}, ['doc', ...BLOCK_TYPES].map(type =>
      el('button', {type:'button', class:'sp-tool', disabled:count >= LIMITS.blocks, dataset:{spInsert:`${at}:${type}`},
        'aria-label':`${at}번째 블록 다음에 ${BLOCK_LABELS[type]} 넣기`, text:BLOCK_LABELS[type]}))));
}
function renderBlocks() {
  const host = editorView.querySelector('[data-sp-blocks]');
  if (!host || !editing) return;
  dropDocEditor();
  const count = editing.blocks.length, nodes = [];
  editing.blocks.forEach((block, b) => {
    if (b > 0) nodes.push(insertSlot(b, count));
    nodes.push(b === editing.open ? editNode(block, b, count) : viewNode(block, b, count));
  });
  host.replaceChildren(...(count ? nodes
    : [el('p', {class:'sp-empty', text:'아래 [+ 글]로 시작해 보세요. 진행 단계·일정 같은 칸이 필요하면 옆 버튼으로 더해요.'})]));
  for (const button of editorView.querySelectorAll('[data-sp-add-block]')) button.disabled = count >= LIMITS.blocks;
  paintConvert();
  primeMedia(editing);
}
function openBlock(index) {
  if (!editing?.blocks[index]) return;
  editing.open = index; editing.openBefore = JSON.parse(JSON.stringify(editing.blocks[index]));
  editing.focusDoc = editing.blocks[index].type === 'doc';
  renderBlocks();
  if (!editing.focusDoc) editorView.querySelector(`[data-sp-block="${index}"]`)?.querySelector('input,textarea')?.focus();
}
function closeBlock({cancel = false} = {}) {
  const index = editing?.open ?? -1;
  if (index < 0) return;
  if (!cancel && docEditor && editing.blocks[index]?.type === 'doc') editing.blocks[index].doc = docEditor.getValue();
  if (cancel && editing.openBefore && editing.blocks[index]) editing.blocks[index] = editing.openBefore;
  editing.open = -1; editing.openBefore = null;
  renderBlocks();
  editorView.querySelector(`[data-sp-edit="${index}"]`)?.focus();
}
function addBlock(type, at) {
  if (!editing || editing.blocks.length >= LIMITS.blocks || !ALL_TYPES.includes(type)) return;
  editing.blocks.splice(at, 0, newBlock(type));
  openBlock(at);
}
function renderLinks() {
  const host = editorView.querySelector('[data-sp-links]');
  if (!host || !editing) return;
  if (!editing.id) { host.replaceChildren(el('p', {class:'sp-hint', text:'링크는 페이지를 한 번 저장한 뒤 만들 수 있어요.'})); return; }
  const form = el('div', {class:'sp-link-form'},
    el('label', {class:'sp-field'}, el('span', {text:'받는 사람 이름표 (선택)'}),
      el('input', {type:'text', class:'sp-input', maxLength:LIMITS.label, placeholder:'비워도 돼요 · 링크를 가진 누구나 봐요', dataset:{spLinkLabel:''}})),
    el('label', {class:'sp-field'}, el('span', {text:'기한 (선택, 비우면 없음)'}),
      el('input', {type:'date', class:'sp-input', dataset:{spLinkExpiry:''}})),
    el('button', {type:'button', class:'secondary', dataset:{spLinkCreate:''}, text:'링크 만들기'}));
  const items = [];
  if (editing.linksState === 'loading') items.push(waitEl({rows:2}));
  else if (editing.linksState === 'error') items.push(el('p', {class:'sp-hint', text:'링크 목록을 불러오지 못했어요.'}),
    el('button', {type:'button', class:'secondary', dataset:{spLinksReload:''}, text:'다시 불러오기'}));
  else if (!editing.links.length) items.push(emptyEl('링크 없음'));
  else items.push(el('ul', {class:'sp-link-list', 'aria-label':'만든 링크'}, editing.links.map(link => {
    const state = linkState(link), name = link.label || '이름표 없음';
    const stateText = state === 'off' ? '꺼짐' : state === 'expired' ? '기한 지남' : link.expires_at ? `${day(link.expires_at)}까지` : '기한 없음';
    return el('li', {class:`sp-link sp-link-${state}`, dataset:{spLink:link.id}},
      el('div', {class:'sp-link-main'}, el('span', {class:'sp-link-name', text:name}),
        el('span', {class:'sp-link-meta', text:`${stateText} · ${day(link.created_at)} 만듦`})),
      el('div', {class:'sp-link-actions'},
        el('button', {type:'button', class:'sp-tool', disabled:state !== 'on', dataset:{spLinkCopy:link.id}, 'aria-label':`${name} 링크 복사`, text:'복사'}),
        state === 'off' ? null : el('button', {type:'button', class:'sp-tool sp-danger', dataset:{spLinkOff:link.id}, 'aria-label':`${name} 링크 끄기`, text:'끄기'})));
  })));
  host.replaceChildren(form, el('p', {class:'sp-status', role:'status', 'aria-live':'polite', dataset:{spLinkStatus:''}}), ...items,
    el('p', {class:'sp-hint', text:'링크를 끄면 그 링크로는 바로 못 열어요. 이미 본 내용이나 캡처는 지울 수 없어요. 자료 칸의 Drive 파일은 Drive 공유 설정을 따로 확인하세요.'}));
}
function paintStatusButtons() {
  for (const button of editorView.querySelectorAll('[data-sp-set-status]')) button.setAttribute('aria-pressed', String(button.dataset.spSetStatus === editing.status));
}
async function paintProjects() {
  const select = editorView.querySelector('[data-sp-project]');
  if (!select || !editing) return;
  const catalog = window.KPTUProjectCatalog, ctx = rt.context.read();
  const fill = () => { select.innerHTML = catalog?.options ? catalog.options(editing.project_id || '') : '<option value="">사업영역 없음</option>'; select.value = editing.project_id || ''; };
  fill();
  try { if (catalog?.load && ctx?.workspace?.id && ctx?.user?.id) { await catalog.load({workspaceId:ctx.workspace.id, userId:ctx.user.id}); if (editorView.contains(select)) fill(); } } catch {}
}
function renderEditor() {
  if (!editing) return;
  const full = editing.mode === 'full';
  editorView.classList.toggle('is-full', full);
  view.toggleAttribute('data-sp-full', full);
  if (full) { renderFull(); return; }
  // The title sits where the reader shows it, in the reader's title look (sr-title).
  const title = el('input', {type:'text', class:'sr-title sp-title', maxLength:LIMITS.title, value:editing.title, placeholder:'제목 (예: ○○민자철도 교섭 현황)',
    'aria-label':'제목', dataset:{spTitle:''}});
  editorView.replaceChildren(
    el('div', {class:'sp-editor-head'},
      el('button', {type:'button', class:'sp-back', dataset:{spClose:''}, 'aria-label':'공유 페이지 목록으로'}, el('span', {'aria-hidden':'true', text:'‹'}), ' 공유 페이지'),
      el('h2', {class:'a11y-only', id:'spEditorTitle', text:editing.id ? '공유 페이지 고치기' : '새 공유 페이지'})),
    el('div', {class:'sp-settings'},
      el('div', {class:'sp-field'}, el('span', {id:'spStatusLabel', text:'상태'}),
        el('div', {class:'sp-seg', role:'group', 'aria-labelledby':'spStatusLabel'},
          el('button', {type:'button', dataset:{spSetStatus:'draft'}, text:'초안'}),
          el('button', {type:'button', dataset:{spSetStatus:'published'}, text:'게시'}))),
      el('label', {class:'sp-field'}, el('span', {text:'연결 사업영역 (선택)'}), el('select', {class:'sp-input', dataset:{spProject:''}}))),
    el('p', {class:'sp-hint', text:'게시 상태일 때만 링크를 받은 사람이 볼 수 있어요. 초안으로 바꾸면 모든 링크에서 바로 안 보여요.'}),
    el('section', {class:'sp-canvas', 'aria-labelledby':'spCanvasTitle'},
      el('p', {class:'sp-canvas-cap', id:'spCanvasTitle', text:'받는 사람에게 보이는 모양 · 블록을 누르면 그 자리에서 고쳐요'}),
      el('div', {class:'sr-wrap sp-canvas-page'}, title, el('div', {class:'sp-blocks', dataset:{spBlocks:''}})),
      el('div', {class:'sp-add', role:'group', 'aria-label':'블록 추가'}, ['doc', ...BLOCK_TYPES].map(type =>
        el('button', {type:'button', class:'sp-tool', dataset:{spAddBlock:type}, text:`+ ${BLOCK_LABELS[type]}`}))),
      el('div', {class:'sp-convert', hidden:true, dataset:{spConvertRow:''}},
        el('button', {type:'button', class:'sp-tool', dataset:{spConvert:''}, text:'새 편집기로 바꾸기'}),
        el('button', {type:'button', class:'sp-tool', hidden:true, dataset:{spConvertUndo:''}, text:'바꾸기 취소'}),
        el('p', {class:'sp-hint', dataset:{spConvertHint:''}}))),
    el('div', {class:'sp-save-row'},
      el('button', {type:'button', class:'primary', dataset:{spSave:''}, text:'저장'}),
      el('p', {class:'sp-status', role:'status', 'aria-live':'polite', dataset:{spStatusLine:''}})),
    el('section', {class:'sp-links', 'aria-labelledby':'spLinksTitle'}, el('h3', {id:'spLinksTitle', text:'링크'}), el('div', {dataset:{spLinks:''}})));
  title.value = editing.title;
  paintStatusButtons(); renderBlocks(); renderLinks(); void paintProjects();
}
// SHARE-전체편집: the full writing screen. The editor's own button row stays on top while scrolling, under the thin line.
function renderFull() {
  const page = editing;
  if (!page.blocks.length) page.blocks = [newBlock('doc')];
  const title = el('input', {type:'text', class:'sp-full-title', maxLength:LIMITS.title, value:page.title, placeholder:'제목',
    'aria-label':'제목', dataset:{spTitle:''}});
  title.value = page.title;
  const top = el('div', {class:'sp-topline', role:'group', 'aria-label':'페이지 설정'},
    el('button', {type:'button', class:'sp-back', dataset:{spClose:''}, 'aria-label':'공유 페이지 목록으로'},
      el('span', {'aria-hidden':'true', text:'‹'}), el('span', {class:'sp-back-text', 'aria-hidden':'true', text:'공유 페이지'})),
    el('h2', {class:'a11y-only', id:'spEditorTitle', text:page.id ? '공유 페이지 고치기' : '새 공유 페이지'}),
    el('div', {class:'sp-seg', role:'group', 'aria-label':'상태'},
      el('button', {type:'button', dataset:{spSetStatus:'draft'}, text:'초안'}),
      el('button', {type:'button', dataset:{spSetStatus:'published'}, text:'게시'})),
    el('button', {type:'button', class:'sp-tool sp-top-more', 'aria-label':'사업영역·링크', 'data-ctx':'off', 'aria-expanded':'false', 'aria-controls':'spTopExtra', dataset:{spTopMore:''}},
      el('span', {class:'more-dots', 'aria-hidden':'true', text:'⋯'})),
    el('div', {class:'sp-top-extra', id:'spTopExtra', dataset:{spTopExtra:''}},
      el('label', {class:'sp-top-project'}, el('span', {text:'사업영역'}), el('select', {class:'sp-top-select', dataset:{spProject:''}})),
      el('button', {type:'button', class:'sp-tool', 'aria-expanded':'false', 'aria-controls':'spLinksPanel', dataset:{spLinksOpen:''}, text:'링크'})),
    el('span', {class:'sp-top-gap', 'aria-hidden':'true'}),
    el('p', {class:'sp-status sp-top-status', role:'status', 'aria-live':'polite', dataset:{spStatusLine:''}}),
    el('span', {class:'sp-dirty', hidden:true, dataset:{spDirty:''}, text:'저장 안 됨'}),
    el('button', {type:'button', class:'sp-tool sp-top-save', 'aria-keyshortcuts':'Control+S Meta+S', dataset:{spSave:''}, text:'저장'}),
    el('section', {class:'sp-links-pop', id:'spLinksPanel', role:'dialog', 'aria-labelledby':'spLinksTitle', hidden:true, dataset:{spLinksPanel:''}},
      el('div', {class:'sp-links-pop-head'}, el('h3', {id:'spLinksTitle', text:'링크'}),
        el('button', {type:'button', class:'sp-tool', 'aria-label':'링크 창 닫기', dataset:{spLinksClose:''}, text:'닫기'})),
      el('p', {class:'sp-hint', text:'게시 상태일 때만 링크를 받은 사람이 볼 수 있어요. 초안으로 바꾸면 모든 링크에서 바로 안 보여요.'}),
      el('div', {dataset:{spLinks:''}})));
  const host = el('div', {class:'sp-full-doc', dataset:{spDocHost:'0'}}, waitEl({rows: 3}), title);
  dropDocEditor();
  editorView.replaceChildren(top, host);
  paintStatusButtons(); renderLinks(); void paintProjects();
  const mount = ++docMount, block = page.blocks[0];
  createDocEditor({host, value:block.doc, label:'본문', placeholder:'여기에 쓰세요', head:title, photos:photosFor(page),
    onChange:value => { if (editing === page && page.blocks[0] === block) { block.doc = value; queueDirty(); } }}).then(ed => {
    if (mount !== docMount || !host.isConnected) { ed.destroy(); return; }
    host.querySelector('.sp-hint')?.remove();
    docEditor = ed;
    const focus = page.focusOnOpen; page.focusOnOpen = null;
    // Not when a control on the top line (e.g. the 링크 window) took the focus while the editor was loading.
    const now = document.activeElement;
    if (now && editorView.contains(now) && !host.contains(now)) return;
    if (focus === 'title') title.focus(); else if (focus === 'doc') ed.focus();
  }).catch(() => {
    if (mount !== docMount || !host.isConnected) return;
    host.querySelector('.sp-hint')?.replaceWith(el('p', {class:'sp-hint', role:'alert', text:'편집기를 열지 못했어요. 목록으로 나갔다가 다시 열어 주세요.'}));
  });
}
function openTopPanel(which, open) {
  const button = editorView.querySelector(which === 'links' ? '[data-sp-links-open]' : '[data-sp-top-more]');
  const panel = editorView.querySelector(which === 'links' ? '[data-sp-links-panel]' : '[data-sp-top-extra]');
  if (!button || !panel) return;
  if (which === 'links') panel.hidden = !open; else panel.classList.toggle('is-open', !!open);
  button.setAttribute('aria-expanded', String(!!open));
}
const visible = node => !!node && node.getClientRects().length > 0;
function closeTopPanels({focus = false} = {}) {
  const links = editorView.querySelector('[data-sp-links-panel]');
  const wasLinks = links && !links.hidden;
  openTopPanel('links', false); openTopPanel('extra', false);
  if (!focus) return;
  const linksButton = editorView.querySelector('[data-sp-links-open]');
  (wasLinks && visible(linksButton) ? linksButton : editorView.querySelector('[data-sp-top-more]'))?.focus();
}
// UI-상단줄제목: the open page's title (as typed) goes to the PC top line's place (kptu:where-item, topbar-actions.js); null drops it.
const sendWhere = name => window.dispatchEvent(new CustomEvent('kptu:where-item', {detail:{view:'pages', name}}));
function showEditor(page) {
  editing = {id:page?.id || null, title:page?.title || '', status:page?.status === 'published' ? 'published' : 'draft', project_id:page?.project_id || null,
    blocks:Array.isArray(page?.blocks) ? structuredClone(page.blocks) : [], updated_at:page?.updated_at || null, links:[], linksState:page?.id ? 'loading' : 'none',
    open:-1, openBefore:null, converted:null, focusDoc:false, mode:'blocks', focusOnOpen:null};
  // ED-통합편집기 ①b (결정 6 가) · SHARE-전체편집: a new page (and a page that is one 글 block) opens on the full writing screen,
  // the cursor in the title for a new page and in the text otherwise.
  if (isFullPage(editing.blocks)) {
    editing.mode = 'full';
    if (!editing.blocks.length) editing.blocks = [newBlock('doc')];
    editing.focusOnOpen = page ? 'doc' : 'title';
  }
  editing.saved = snapshotOf(editing); sendWhere(editing.title.trim() || '제목 없음');
  if (editing.id) { photosFor(editing); photoApi.note(photoIdsIn(editing.blocks)); }
  listView.hidden = true; editorView.hidden = false; view.dataset.spEditing = '1';
  layer ||= window.KPTURouter?.layer?.open('share-page-editor', {close:() => closeEditor({fromBack:true})}) || null;
  const focusDoc = editing.focusDoc || editing.mode === 'full';
  renderEditor();
  if (!focusDoc) editorView.querySelector('[data-sp-title]')?.focus();
  if (editing.id) void loadLinks();
}
function closeEditor({fromBack = false, force = false} = {}) {
  if (!editing) return true;
  if (busy && !force) return false;
  if (!force && dirty() && !window.confirm('저장하지 않은 내용이 있어요. 버리고 목록으로 돌아갈까요?')) return false;
  const closing = editing;
  dropDocEditor();
  // Changes are dropped here, so only the photos in the saved page stay (a photo put in and not saved is removed).
  prunePhotos(closing, () => { try { return photoIdsIn(JSON.parse(closing.saved).blocks); } catch { return photoIdsIn(closing.blocks); } });
  const opened = layer; layer = null; editing = null; sendWhere(null);
  editorView.replaceChildren(); editorView.hidden = true; editorView.classList.remove('is-full'); listView.hidden = false;
  delete view.dataset.spEditing; view.removeAttribute('data-sp-full');
  if (!fromBack) opened?.close();
  void loadList({force:true});
  listView.querySelector('[data-sp-new]')?.focus({preventScroll:true});
  return true;
}
async function openPage(id) {
  if (busy) return;
  const run = ++epoch, owner = scope;
  const status = listView.querySelector('[data-sp-list-status]');
  if (status) status.innerHTML = waitInlineHtml();
  try {
    const rows = await rt.api(`/rest/v1/app_share_pages?id=eq.${q(id)}&workspace_id=eq.${q(workspaceId())}&select=${PAGE_COLUMNS}`, {singleFlight:false});
    if (run !== epoch || owner !== scope) return;
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error('missing');
    showEditor(rows[0]);
  } catch (e) {
    if (run !== epoch || owner !== scope) return;
    if (status) status.textContent = message(e, '이 공유 페이지를 열지 못했어요. 목록을 다시 불러와 주세요.');
  }
}
async function loadLinks() {
  if (!editing?.id) return;
  const page = editing, owner = scope;
  page.linksState = 'loading'; renderLinks();
  try {
    const rows = await rt.api(`/rest/v1/app_share_page_links?page_id=eq.${q(page.id)}&workspace_id=eq.${q(workspaceId())}&select=${LINK_COLUMNS}&order=created_at.asc`, {singleFlight:false});
    if (editing !== page || owner !== scope) return;
    if (!Array.isArray(rows)) throw new Error('bad links');
    page.links = rows; page.linksState = 'ready';
  } catch {
    if (editing !== page || owner !== scope) return;
    page.linksState = 'error';
  }
  renderLinks();
}

async function save() {
  if (!editing || busy) return;
  const page = editing, owner = scope;
  const full = page.mode === 'full';
  if (docEditor && full) page.blocks[0].doc = docEditor.getValue();
  else if (docEditor && page.blocks[page.open]?.type === 'doc') page.blocks[page.open].doc = docEditor.getValue();
  const blocks = normalizeBlocks(page.blocks), title = String(page.title || '').trim();
  const problem = pageProblem({title, blocks});
  if (problem) { editorStatus(problem); return; }
  busy = true; editorView.querySelector('[data-sp-save]').disabled = true; editorStatus('저장하는 중…');
  try {
    const body = {title, blocks, status:page.status, project_id:page.project_id || null};
    let rows;
    if (!page.id) rows = await rt.api(`/rest/v1/app_share_pages?select=${PAGE_COLUMNS}`, {method:'POST', prefer:'return=representation', body:{workspace_id:workspaceId(), ...body}});
    else rows = await rt.api(`/rest/v1/app_share_pages?id=eq.${q(page.id)}&workspace_id=eq.${q(workspaceId())}${page.updated_at ? `&updated_at=eq.${q(page.updated_at)}` : ''}&select=${PAGE_COLUMNS}`,
      {method:'PATCH', prefer:'return=representation', body:{...body, updated_at:new Date().toISOString()}});
    if (editing !== page || owner !== scope) return;
    if (!Array.isArray(rows) || rows.length !== 1) {
      editorStatus(page.id ? '다른 곳에서 먼저 바뀌어 저장하지 않았어요. 목록으로 나가 다시 열어 주세요.' : '저장 결과를 확인하지 못했어요.');
      return;
    }
    const row = rows[0], first = !page.id;
    if (full) {
      // The full screen stays as it is (cursor, undo): what is in it now may already be newer than what was sent.
      Object.assign(page, {id:row.id, status:row.status, project_id:row.project_id || null, updated_at:row.updated_at});
      page.saved = snapshotOf({title, status:row.status, project_id:row.project_id || null, blocks});
      if (first) { page.linksState = 'ready'; page.links = []; renderLinks(); }
      const heading = editorView.querySelector('#spEditorTitle'); if (heading) heading.textContent = '공유 페이지 고치기';
      paintStatusButtons(); paintDirty();
      editorStatus(page.status === 'published' ? '저장했어요. 게시 중이에요.' : '저장했어요. 아직 초안이라 링크로는 안 보여요.');
      // Keep what was saved and what the open editor has now (it may already be newer than what was sent).
      prunePhotos(page, () => photoIdsIn(blocks).concat(editing === page && docEditor ? photoIdsIn([{type:'doc', doc:docEditor.getValue()}]) : []));
      return;
    }
    Object.assign(page, {id:row.id, title:row.title, status:row.status, project_id:row.project_id || null,
      blocks:Array.isArray(row.blocks) ? structuredClone(row.blocks) : blocks, updated_at:row.updated_at});
    page.saved = snapshotOf(page);
    page.open = -1; page.openBefore = null; page.converted = null;
    if (first) { page.linksState = 'ready'; page.links = []; }
    // After [새 편집기로 바꾸기] (or deleting every old block) the saved page is one 글 block: the full screen from now on.
    if (isFullPage(page.blocks)) page.mode = 'full';
    renderEditor();
    editorStatus(page.status === 'published' ? '저장했어요. 게시 중이에요.' : '저장했어요. 아직 초안이라 링크로는 안 보여요.');
    editorView.querySelector('[data-sp-save]')?.focus({preventScroll:true});
    prunePhotos(page, () => photoIdsIn(page.blocks));
  } catch (e) {
    if (editing === page) editorStatus(message(e, '저장하지 못했어요. 글은 그대로 있으니 다시 눌러 주세요.'));
  } finally {
    busy = false;
    const button = editorView.querySelector('[data-sp-save]'); if (button) button.disabled = false;
  }
}
async function createLink() {
  if (!editing?.id || busy) return;
  const page = editing, owner = scope;
  const label = String(editorView.querySelector('[data-sp-link-label]')?.value || '').trim();
  const day = editorView.querySelector('[data-sp-link-expiry]')?.value || '';
  const problem = labelProblem(label);
  if (problem) { linkStatus(problem); return; }
  let expires_at;
  try { expires_at = expiresAt(day); } catch (e) { linkStatus(e.message); return; }
  busy = true; linkStatus('링크를 만드는 중…');
  try {
    const rows = await rt.api(`/rest/v1/app_share_page_links?select=${LINK_COLUMNS}`, {method:'POST', prefer:'return=representation', body:{workspace_id:workspaceId(), page_id:page.id, label, expires_at}});
    if (editing !== page || owner !== scope) return;
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error('no row');
    page.links = [...page.links, rows[0]]; page.linksState = 'ready';
    renderLinks();
    linkStatus(`${label ? `"${label}" ` : ''}링크를 만들었어요. [복사]를 눌러 보내세요.`);
    editorView.querySelector(`[data-sp-link-copy="${CSS.escape(rows[0].id)}"]`)?.focus();
  } catch (e) {
    if (editing === page) linkStatus(message(e, '링크를 만들지 못했어요.'));
  } finally { busy = false; }
}
async function copyLink(id, button = null) {
  if (!editing?.id) return;
  const page = editing;
  linkStatus('링크를 복사하는 중…');
  try {
    const rows = await rt.api(`/rest/v1/app_share_page_links?id=eq.${q(id)}&page_id=eq.${q(page.id)}&workspace_id=eq.${q(workspaceId())}&select=token`, {singleFlight:false});
    if (editing !== page) return;
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error('missing');
    const ok = await copyText(shareUrl(rows[0].token));
    if (ok && button) flashDone(button); // UI-눌림느낌: [복사] says '✓ 복사됨' for 1.5s
    linkStatus(ok ? '링크를 복사했어요. 메신저에 붙여 넣어 보내세요.' : '복사하지 못했어요. 다시 눌러 주세요.');
  } catch (e) {
    if (editing === page) linkStatus(message(e, '링크를 복사하지 못했어요.'));
  }
}
async function turnOff(id) {
  if (!editing?.id || busy) return;
  const page = editing, link = page.links.find(x => x.id === id);
  if (!link || !window.confirm(`"${link.label || '이름표 없음'}" 링크를 끌까요? 이 링크로는 바로 못 열게 돼요.`)) return;
  busy = true; linkStatus('링크를 끄는 중…');
  try {
    const rows = await rt.api(`/rest/v1/app_share_page_links?id=eq.${q(id)}&page_id=eq.${q(page.id)}&workspace_id=eq.${q(workspaceId())}&select=${LINK_COLUMNS}`,
      {method:'PATCH', prefer:'return=representation', body:{disabled_at:new Date().toISOString()}});
    if (editing !== page) return;
    if (!Array.isArray(rows) || rows.length !== 1 || !rows[0].disabled_at) throw new Error('not off');
    page.links = page.links.map(x => x.id === id ? rows[0] : x);
    renderLinks();
    linkStatus(`"${link.label || '이름표 없음'}" 링크를 껐어요.`);
  } catch (e) {
    if (editing === page) linkStatus(message(e, '링크를 끄지 못했어요. 다시 눌러 주세요.'));
  } finally { busy = false; }
}

function hasContent(block) {
  if (block.type === 'summary' || block.type === 'doc') return !blockIsEmpty(block);
  return !!String(block.title || '').trim() || (block.items || []).some(item => Object.values(item).some(v => String(v || '').trim()));
}
// [새 편집기로 바꾸기] (결정 6 가, 설계 4.2): all blocks become one 글 block, every letter kept (blocksToDoc). Until the
// page is saved, [바꾸기 취소] puts the old blocks back; after saving there is no history of the old shapes.
function paintConvert() {
  const row = editorView.querySelector('[data-sp-convert-row]');
  if (!row || !editing) return;
  const old = editing.blocks.some(b => b.type !== 'doc');
  row.hidden = !old && !editing.converted;
  row.querySelector('[data-sp-convert]').hidden = !old;
  row.querySelector('[data-sp-convert-undo]').hidden = !editing.converted;
  row.querySelector('[data-sp-convert-hint]').textContent = editing.converted
    ? '바꿨어요. 저장하기 전에는 [바꾸기 취소]로 옛 블록으로 돌아가요.'
    : '진행 단계 막대 같은 칸 모양은 번호 목록·표로 바뀌고 글은 모두 남아요.';
}
function convertBlocks() {
  if (!editing || !editing.blocks.some(b => b.type !== 'doc')) return;
  if (!window.confirm('모든 블록을 새 편집기 글 하나로 바꿀까요? 글은 모두 남고, 진행 단계 막대 같은 모양은 번호 목록·표로 바뀌어요. 저장하기 전에는 [바꾸기 취소]로 되돌릴 수 있어요.')) return;
  if (docEditor && editing.blocks[editing.open]?.type === 'doc') editing.blocks[editing.open].doc = docEditor.getValue();
  editing.converted = JSON.parse(JSON.stringify(editing.blocks));
  editing.blocks = [blocksToDoc(editing.blocks)];
  editing.open = -1; editing.openBefore = null;
  renderBlocks();
  editorStatus('새 편집기 글 하나로 바꿨어요. 확인한 뒤 [저장]을 눌러 주세요.');
  editorView.querySelector('[data-sp-convert-undo]')?.focus();
}
function undoConvert() {
  if (!editing?.converted) return;
  editing.blocks = editing.converted; editing.converted = null;
  editing.open = -1; editing.openBefore = null;
  renderBlocks();
  editorStatus('옛 블록으로 돌아갔어요.');
  editorView.querySelector('[data-sp-convert]')?.focus();
}
// After a move the same button keeps focus; in a shown block it is inside the ⋯ menu, which stays open for the next move.
function focusAfterMove(index, delta) {
  const node = editorView.querySelector(`[data-sp-block="${index}"]`);
  const menu = node?.querySelector('[data-sp-more]');
  if (menu) menu.open = true;
  const same = node?.querySelector(`[data-sp-move="${index}:${delta}"]`);
  (same && !same.disabled ? same : node?.querySelector(`[data-sp-move="${index}:${-delta}"]`))?.focus();
}
function closeMenus(except) {
  for (const menu of root.querySelectorAll('details.sp-more[open],details.sp-slot[open]')) if (menu !== except) menu.open = false;
}

root.addEventListener('click', event => {
  const target = event.target.closest?.('button');
  if (!target || !root.contains(target)) return;
  const d = target.dataset;
  if ('spNew' in d) { if (!busy) showEditor(null); return; }
  if ('spNewHtml' in d) { shareHtml.openNew(); return; }
  if (d.spPreview) { const page = pages?.find(p => p.id === d.spPreview); if (page) void shareHtml.openPreview(page); return; }
  if ('spReload' in d) { void loadList({force:true}); return; }
  if (d.spRowMenu || d.spBoxMenu) { ensureRowMenu().open(target); return; }
  if (d.spOpen) { void openPage(d.spOpen); return; }
  if (!editing) return;
  if ('spClose' in d) { closeEditor(); return; }
  if ('spSave' in d) { void save(); return; }
  if (d.spSetStatus) { editing.status = d.spSetStatus === 'published' ? 'published' : 'draft'; paintStatusButtons(); paintDirty(); return; }
  if ('spTopMore' in d) { const open = target.getAttribute('aria-expanded') !== 'true'; closeTopPanels(); openTopPanel('extra', open); return; }
  if ('spLinksOpen' in d) {
    const open = target.getAttribute('aria-expanded') !== 'true';
    closeTopPanels(); openTopPanel('links', open);
    if (open) editorView.querySelector('[data-sp-links-panel]')?.querySelector('input,button:not([data-sp-links-close])')?.focus();
    return;
  }
  if ('spLinksClose' in d) { closeTopPanels({focus:true}); return; }
  if (d.spAddBlock) { addBlock(d.spAddBlock, editing.blocks.length); return; }
  if (d.spInsert) { const [at, type] = d.spInsert.split(':'); addBlock(type, Number(at)); return; }
  if (d.spEdit !== undefined) { openBlock(Number(d.spEdit)); return; }
  if (d.spDone !== undefined) { closeBlock(); return; }
  if (d.spCancel !== undefined) { closeBlock({cancel:true}); return; }
  if (d.spMove) {
    const [index, delta] = d.spMove.split(':').map(Number), to = index + delta;
    if (to < 0 || to >= editing.blocks.length) return;
    editing.blocks = moveBlock(editing.blocks, index, delta);
    if (editing.open === index) editing.open = to; else if (editing.open === to) editing.open = index;
    renderBlocks(); focusAfterMove(to, delta);
    return;
  }
  if (d.spBlockDel !== undefined) {
    const index = Number(d.spBlockDel), block = editing.blocks[index];
    if (!block || (hasContent(block) && !window.confirm(`${BLOCK_LABELS[block.type]} 블록을 지울까요?`))) return;
    editing.blocks.splice(index, 1);
    if (editing.open === index) { editing.open = -1; editing.openBefore = null; } else if (editing.open > index) editing.open--;
    renderBlocks();
    const near = editorView.querySelector(`[data-sp-block="${Math.min(index, editing.blocks.length - 1)}"]`);
    (near?.querySelector('[data-sp-edit]') || near?.querySelector('[data-sp-block-del]') || editorView.querySelector('[data-sp-add-block]'))?.focus();
    return;
  }
  if (d.spItemAdd !== undefined) {
    const b = Number(d.spItemAdd), block = editing.blocks[b];
    if (!block?.items || block.items.length >= LIMITS.items) return;
    block.items.push(newItem(block.type)); renderBlocks();
    editorView.querySelector(`[data-sp-b="${b}"][data-sp-i="${block.items.length - 1}"]`)?.focus();
    return;
  }
  if (d.spItemDel) {
    const [b, i] = d.spItemDel.split(':').map(Number), block = editing.blocks[b];
    if (!block?.items) return;
    block.items.splice(i, 1);
    if (block.type === 'stages' && block.current >= block.items.length) block.current = Math.max(0, block.items.length - 1);
    renderBlocks();
    editorView.querySelector(`[data-sp-item-add="${b}"]`)?.focus();
    return;
  }
  if ('spConvert' in d) { convertBlocks(); return; }
  if ('spConvertUndo' in d) { undoConvert(); return; }
  if ('spLinkCreate' in d) { void createLink(); return; }
  if ('spLinksReload' in d) { void loadLinks(); return; }
  if (d.spLinkCopy) { void copyLink(d.spLinkCopy, target); return; }
  if (d.spLinkOff) { void turnOff(d.spLinkOff); return; }
});
root.addEventListener('input', event => {
  if (!editing) return;
  const t = event.target;
  if ('spTitle' in t.dataset) { editing.title = t.value; sendWhere(t.value.trim() || '제목 없음'); queueDirty(); return; }
  if (t.dataset.spB === undefined || !t.dataset.spF) return;
  const block = editing.blocks[Number(t.dataset.spB)];
  if (!block) return;
  if (t.dataset.spI === undefined) block[t.dataset.spF] = t.value;
  else { const item = block.items?.[Number(t.dataset.spI)]; if (item) item[t.dataset.spF] = t.value; }
});
root.addEventListener('change', event => {
  if (!editing) return;
  const t = event.target;
  if ('spProject' in t.dataset) { editing.project_id = t.value || null; paintDirty(); return; }
  if (t.dataset.spCurrent !== undefined) { const block = editing.blocks[Number(t.dataset.spCurrent)]; if (block) block.current = Number(t.value); }
});
root.addEventListener('keydown', event => {
  if (event.key === 'Enter' && 'spLinkLabel' in (event.target.dataset || {})) { event.preventDefault(); void createLink(); }
  // Full screen: Enter in the title goes on to the text (not during a 한글 composition).
  if (event.key === 'Enter' && !event.isComposing && editing?.mode === 'full' && 'spTitle' in (event.target.dataset || {})) { event.preventDefault(); docEditor?.focus(); return; }
  if (event.key !== 'Escape' || !editing || event.defaultPrevented) return;
  const panelOpen = editorView.querySelector('[data-sp-links-panel]:not([hidden]),[data-sp-top-extra].is-open');
  if (panelOpen && event.target.closest?.('.sp-topline')) { event.preventDefault(); closeTopPanels({focus:true}); return; }
  // Esc closes an open ⋯ / [+ 블록] menu (focus back on its button), otherwise finishes the open block keeping what was typed.
  const menu = event.target.closest?.('details[open]');
  if (menu && root.contains(menu)) { event.preventDefault(); menu.open = false; menu.querySelector('summary')?.focus(); return; }
  if (editing.open >= 0 && event.target.closest?.('.sp-block.is-editing')) { event.preventDefault(); closeBlock(); }
});
// One menu open at a time; a press outside closes them.
root.addEventListener('toggle', event => { if (event.target.matches?.('details.sp-box')) boxOpen = event.target.open; }, true);
root.addEventListener('toggle', event => { if (event.target.open && event.target.matches?.('details.sp-more,details.sp-slot')) closeMenus(event.target); }, true);
document.addEventListener('click', event => {
  if (!editing) return;
  if (!event.target.closest?.('details.sp-more,details.sp-slot')) closeMenus(null);
  if (event.target.isConnected && !event.target.closest?.('[data-sp-links-panel],[data-sp-top-extra],[data-sp-top-more],[data-sp-links-open]')) closeTopPanels();
});
// Saving: [저장] or Ctrl/Cmd+S while the editor is on screen; leaving the app with unsaved changes asks first.
const editorOnScreen = () => !!editing && !editorView.hidden && !view.classList.contains('hidden');
document.addEventListener('keydown', event => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || String(event.key).toLowerCase() !== 's' || !editorOnScreen()) return;
  event.preventDefault();
  void save();
});
window.addEventListener('beforeunload', event => { if (editing && dirty()) { event.preventDefault(); event.returnValue = ''; } });
// Leaving the menu keeps the editor as it is (nothing is lost); the router forgets our history entry.
window.addEventListener('kptu:view-changed', event => {
  if (event.detail?.view !== 'pages') { layer = null; shareHtml.close(); return; }
  if (!editing) { void loadList(); return; }
  // Back in the menu with the editor still open: one history entry again so Back closes it first (not while traversing).
  if (event.detail?.source !== 'popstate') layer ||= window.KPTURouter?.layer?.open('share-page-editor', {close:() => closeEditor({fromBack:true})}) || null;
});
window.addEventListener('kptu:session-changed', () => {
  const next = ownerScope();
  if (next === scope) return;
  dropDocEditor();
  scope = next; epoch++; pages = null; box = null; boxOpen = false; listState = 'idle'; editing = null; layer = null; busy = false;
  htmlIds = new Set(); linksByPage = new Map(); shareHtml.close();
  editorView.replaceChildren(); editorView.hidden = true; editorView.classList.remove('is-full'); listView.hidden = false;
  delete view.dataset.spEditing; view.removeAttribute('data-sp-full');
  renderList();
});

// Restored (or permanently deleted) from the 휴지통 tab elsewhere: read the list again.
window.addEventListener('kptu:share-pages-changed', () => { void loadList({force:true}); });

// The old Web1 cards were drawn (web1-board.js): the 보관함 count includes them.
window.addEventListener('kptu:web1-board-rendered', () => { if (!editing) renderList(); });
window.KPTUSharePages = {reload:() => loadList({force:true})};
renderList();
void loadList();
})();
