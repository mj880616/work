// S71-54 NOTE-주제재료잇기: 주제 ⋯(폰 막대 […] 줄)·우클릭(PC) [재료 잇기] → 작은 고르기 창 하나(이 파일이 그 창의 유일한 그리기 주인).
// 탭 셋: [노트](찾기·최근 고친 순) · [자료실](찾기·[최근]/[폴더]) · [링크](주소 붙여넣기 + 제목 — 비우면 주소 그대로). 여러 개를 골라 한 번에 [잇기 n개].
// - 노트 목록은 부르는 쪽이 이미 읽은 내 노트(잠긴 노트는 넣지 않음), 자료실은 열 때 owner RLS로 읽는다(기기 저장 없음).
// - 링크 제목을 남의 누리집에서 읽어 오는 서버 길은 아직 없다(새 외부 호출 함수는 만들지 않음 — PR 본문 제안). 그래서 제목은 사람이 적거나 주소 그대로.
// - 주소는 http/https만(note-board-material-model.mjs safeUrl). javascript:·data: 등은 '이을 수 없는 주소' 한 줄로 거절, 서버에도 보내지 않는다.
// - PC(761px~)는 누른 자리 옆 작은 창(placeAnchored), 폰은 아래에서 올라오는 판(하단바 위). Esc·바깥 누르기·[취소]로 닫고 부른 자리로 초점.
import {placeAnchored, clearAnchored, bottomInset} from './anchored-popup.js';
import {iconSvg} from './tree-icons.js';
import {waitInlineHtml, emptyHtml} from './wait-state.js';
import {pickNotes, pickDocs, safeUrl, cleanTitle, urlLabel, KIND_NAMES} from './note-board-material-model.mjs';

const TABS = [['note', '노트'], ['doc', '자료실'], ['link', '링크']];
const wide = () => !!globalThis.matchMedia?.('(min-width:761px)')?.matches;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const ICON = {note:'doc', doc:'clip', link:'link', att:'clip'};

/**
 * notes(): 내 노트 목록, titleOf(note), hidden(note) = 잠긴 노트, loadDocs() → {docs, folders, itemFolder, siblings} (자료실 — 처음 [자료실]을 누를 때 한 번),
 * have(kind, ref) = 이 주제에 이미 이은 것, onPick(list) = 고른 것 [{kind, ref, title}] (잇기는 부르는 쪽).
 */
// S71-56: 같은 창을 보드 [파일] 고르기에도 쓴다 — tabs([['doc','자료실'],['att','노트 첨부']]), title('파일 넣기'), done('넣기'),
// extraRows(tab, query) = 그 밖 탭의 줄({kind, ref, title, date}) — 노트 첨부는 부르는 쪽이 이미 읽은 내 노트에서(잠긴 노트 빼고).
export function createMaterialPicker({notes, titleOf, hidden = () => false, loadDocs, have = () => false, onPick, toast = () => {}, tabs:tabList = TABS, title = '재료 잇기', done:doneWord = '잇기', extraRows = null}) {
  let panel = null, state = null;
  function ensure() {
    if (panel) return;
    panel = document.createElement('div');
    panel.className = 'nbm-pick'; panel.hidden = true; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'false'); panel.tabIndex = -1;
    panel.dataset.nbmPick = '';
    document.body.append(panel);
    panel.addEventListener('click', onClick);
    panel.addEventListener('input', e => { if (e.target.matches('[data-nbm-find]')) { state.query = e.target.value; paintList(); } else if (e.target.matches('[data-nbm-url]')) paintLinkError(false); });
    panel.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key === 'Enter' && e.target.matches('[data-nbm-url],[data-nbm-title]') && !e.isComposing) { e.preventDefault(); addLink(); }
    });
    document.addEventListener('pointerdown', e => { if (state && !panel.contains(e.target) && !e.target.closest?.('.kptu-ask,.kptu-toast')) close(); }, true);
    window.addEventListener('resize', () => { if (state) place(); });
  }
  const picked = () => state.picks;
  const pickedHas = (kind, ref) => state.picks.some(p => p.kind === kind && p.ref === ref);
  function html() {
    const tabs = tabList.map(([k, n]) => `<button type="button" class="ds-seg-btn" role="tab" data-nbm-tab="${k}" aria-selected="${state.tab === k}">${n}</button>`).join('');
    return `<div class="nbm-head"><span class="nbm-title">${esc(title)}<span class="nbm-topic">${esc(state.topic)}</span></span><button type="button" class="icon-btn nbm-x" data-nbm-close aria-label="닫기" title="닫기 (Esc)">✕</button></div>`
      + `<div class="ds-seg nbm-tabs" role="tablist" aria-label="${esc(title)} 종류">${tabs}</div>`
      + `<div class="nbm-body" data-nbm-body></div>`
      + `<div class="nbm-picked" data-nbm-picked hidden></div>`
      + `<div class="nbm-foot"><button type="button" class="secondary" data-nbm-close>취소</button><button type="button" class="primary" data-nbm-done disabled>${esc(doneWord)}</button></div>`;
  }
  function paintBody() {
    const body = panel.querySelector('[data-nbm-body]');
    if (state.tab === 'link') {
      body.innerHTML = `<label class="nbm-field">주소<input type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://" data-nbm-url enterkeyhint="done"></label>`
        + `<label class="nbm-field">제목<input type="text" autocomplete="off" maxlength="40" placeholder="비우면 주소 그대로" data-nbm-title enterkeyhint="done"></label>`
        + `<p class="nbm-err" data-nbm-err role="alert" hidden>http:// 또는 https:// 로 시작하는 주소만 이을 수 있어요.</p>`
        + `<div class="nbm-link-acts"><button type="button" class="secondary" data-nbm-add-link>더하기</button></div>`;
      return;
    }
    const doc = state.tab === 'doc', find = doc ? '자료 이름 찾기' : state.tab === 'att' ? '첨부 이름 찾기' : '노트 찾기';
    body.innerHTML = `<input type="search" class="nbm-find" data-nbm-find placeholder="${esc(find)}" aria-label="${esc(find)}" autocomplete="off" enterkeyhint="search" value="${esc(state.query)}">`
      + (doc ? `<div class="ds-seg nbm-views" role="group" aria-label="자료 보기"><button type="button" class="ds-seg-btn" data-nbm-view="recent" aria-pressed="${state.view === 'recent'}">최근</button><button type="button" class="ds-seg-btn" data-nbm-view="folder" aria-pressed="${state.view === 'folder'}">폴더</button></div>` : '')
      + `<div class="nbm-list" data-nbm-list role="group" aria-label="${doc ? '자료' : state.tab === 'att' ? '노트 첨부' : '노트'} 목록"></div>`;
    paintList();
  }
  function rowHtml(r) {
    const on = pickedHas(r.kind, r.ref), had = have(r.kind, r.ref);
    return `<button type="button" class="icon-btn nbm-row" data-nbm-pick-row="${esc(r.ref)}" data-kind="${r.kind}" aria-pressed="${on}"${had ? ' aria-disabled="true"' : ''}>${iconSvg(ICON[r.kind], {size:14})}<span class="nbm-row-name">${esc(r.title)}</span>${had ? '<small class="nbm-row-tag">이어 있음</small>' : r.date ? `<small class="nbm-row-date">${esc(r.date)}</small>` : ''}</button>`;
  }
  function paintList() {
    const list = panel.querySelector('[data-nbm-list]'); if (!list) return;
    if (state.tab !== 'note' && state.tab !== 'doc' && extraRows) { // S71-56 [노트 첨부]
      const rows = extraRows(state.tab, state.query) || [];
      list.innerHTML = rows.length ? rows.map(rowHtml).join('') : emptyHtml(state.query.trim() ? '찾는 첨부 없음' : '첨부한 파일 없음');
      state.rows = rows; return;
    }
    if (state.tab === 'note') {
      const rows = pickNotes(notes(), state.query, {titleOf, hidden});
      list.innerHTML = rows.length ? rows.map(rowHtml).join('') : emptyHtml(state.query.trim() ? '찾는 노트 없음' : '노트 없음');
      state.rows = rows; return;
    }
    if (!state.docs) { list.innerHTML = state.docsFailed ? emptyHtml('자료실을 읽지 못했어요. 탭을 다시 눌러 주세요.') : waitInlineHtml(); state.rows = []; return; }
    const got = pickDocs(state.docs.docs, state.query, {view:state.view, folder:state.folder, folders:state.docs.folders, itemFolder:state.docs.itemFolder, siblings:state.docs.siblings});
    const path = state.view === 'folder' && !state.query.trim() ? `<div class="nbm-path">${state.folder ? '<button type="button" class="icon-btn nbm-up" data-nbm-up aria-label="위 폴더로">‹</button>' : ''}<span>${esc(got.path.length ? got.path.map(p => p.name).join(' › ') : '자료실')}</span></div>` : '';
    const folders = got.folders.map(f => `<button type="button" class="icon-btn nbm-row nbm-folder" data-nbm-folder="${esc(f.id)}">${iconSvg('folder', {size:14})}<span class="nbm-row-name">${esc(f.name)}</span><span aria-hidden="true">›</span></button>`).join('');
    list.innerHTML = path + folders + (got.rows.length ? got.rows.map(rowHtml).join('') : got.folders.length ? '' : emptyHtml(state.query.trim() ? '찾는 자료 없음' : '자료 없음'));
    state.rows = got.rows;
  }
  function paintPicked() {
    const box = panel.querySelector('[data-nbm-picked]'), done = panel.querySelector('[data-nbm-done]'), n = picked().length;
    box.hidden = !n;
    box.innerHTML = picked().map((p, i) => `<span class="nbm-chip" data-kind="${p.kind}">${iconSvg(ICON[p.kind], {size:12})}<span>${esc(p.title || urlLabel(p.ref))}</span><button type="button" class="icon-btn nbm-chip-x" data-nbm-unpick="${i}" aria-label="${esc(`빼기: ${p.title || urlLabel(p.ref)}`)}">×</button></span>`).join('');
    done.disabled = !n; done.textContent = n ? doneWord + ' ' + n + '개' : doneWord;
  }
  function paintLinkError(on) { const p = panel.querySelector('[data-nbm-err]'); if (p) p.hidden = !on; }
  function toggleRow(ref) {
    const r = state.rows.find(x => x.ref === ref); if (!r || have(r.kind, r.ref)) return;
    const i = state.picks.findIndex(p => p.kind === r.kind && p.ref === r.ref);
    if (i >= 0) state.picks.splice(i, 1); else state.picks.push({kind:r.kind, ref:r.ref, title:cleanTitle(r.title)});
    paintList(); paintPicked();
    panel.querySelector(`[data-nbm-pick-row="${CSS.escape(ref)}"]`)?.focus({preventScroll:true});
  }
  // 링크 칸 → 고른 것에 더하기. 주소가 비면 false(아무것도 안 함), 틀리면 알림 줄.
  function addLink() {
    const urlBox = panel.querySelector('[data-nbm-url]'), titleBox = panel.querySelector('[data-nbm-title]'); if (!urlBox) return false;
    const raw = urlBox.value.trim(); if (!raw) return false;
    const url = safeUrl(raw);
    if (!url) { paintLinkError(true); urlBox.focus(); return null; }
    if (have('link', url) || pickedHas('link', url)) { toast('이미 이은 주소예요.'); urlBox.value = ''; return false; }
    const title = cleanTitle(titleBox.value) || null;
    state.picks.push({kind:'link', ref:url, title}); // 이름이 없으면 주소 그대로(화면이 주소를 줄여 보임)
    urlBox.value = ''; titleBox.value = ''; paintLinkError(false); paintPicked(); urlBox.focus();
    return true;
  }
  async function switchTab(tab) {
    if (state.tab === tab) return;
    state.tab = tab; state.query = '';
    panel.querySelectorAll('[data-nbm-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.nbmTab === tab)));
    paintBody(); paintPicked();
    if (tab === 'doc' && !state.docs) {
      state.docsFailed = false; paintList();
      const run = state.run;
      try { const got = await loadDocs(); if (state?.run !== run) return; state.docs = got; }
      catch { if (state?.run !== run) return; state.docsFailed = true; }
      if (state.tab === 'doc') paintList();
    }
    focusFirst();
  }
  function focusFirst() { const el = panel.querySelector(state.tab === 'link' ? '[data-nbm-url]' : '[data-nbm-find]'); if (el && wide()) el.focus({preventScroll:true}); else panel.focus({preventScroll:true}); }
  function finish() {
    const more = state.tab === 'link' ? addLink() : false;
    if (more === null) return; // 틀린 주소 — 창은 그대로
    const list = picked().map(({kind, ref, title}) => ({kind, ref, title}));
    if (!list.length) return;
    const go = state.onPick; close(); go(list);
  }
  function onClick(e) {
    const b = e.target.closest('button'); if (!b || !state) return;
    if (b.hasAttribute('data-nbm-close')) { close(); return; }
    if (b.dataset.nbmTab) { void switchTab(b.dataset.nbmTab); return; }
    if (b.dataset.nbmView) { state.view = b.dataset.nbmView; state.folder = null; panel.querySelectorAll('[data-nbm-view]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); paintList(); return; }
    if (b.dataset.nbmFolder) { state.folder = b.dataset.nbmFolder; paintList(); panel.querySelector('[data-nbm-list] button')?.focus({preventScroll:true}); return; }
    if (b.hasAttribute('data-nbm-up')) { const f = state.docs?.folders.find(x => x.id === state.folder); state.folder = f?.parent_id || null; paintList(); return; }
    if (b.dataset.nbmPickRow !== undefined) { toggleRow(b.dataset.nbmPickRow); return; }
    if (b.dataset.nbmUnpick !== undefined) { state.picks.splice(Number(b.dataset.nbmUnpick), 1); paintList(); paintPicked(); return; }
    if (b.hasAttribute('data-nbm-add-link')) { addLink(); return; }
    if (b.hasAttribute('data-nbm-done')) finish();
  }
  function place() {
    if (wide() && state.anchor?.isConnected) { panel.classList.remove('nbm-sheet'); placeAnchored(panel, state.anchor, {maxWidth:360, maxHeight:480, minHeight:260}); return; }
    clearAnchored(panel); panel.classList.add('nbm-sheet'); panel.style.bottom = `${bottomInset()}px`;
  }
  function open({anchor, topic = '', tab = tabList[0][0], onPick: pick = onPick} = {}) {
    ensure();
    state = {anchor, topic:topic ? ` · ${[...topic].slice(0, 16).join('')}${[...topic].length > 16 ? '…' : ''}` : '', tab, query:'', view:'recent', folder:null, picks:[], rows:[], docs:null, docsFailed:false, onPick:pick, run:Symbol('pick')};
    panel.setAttribute('aria-label', title);
    panel.innerHTML = html(); panel.hidden = false;
    paintBody(); paintPicked(); place();
    if (tab === 'doc') { state.tab = ''; void switchTab('doc'); } else focusFirst();
  }
  function close() {
    if (!state) return;
    const back = state.anchor; state = null; panel.hidden = true; panel.replaceChildren(); clearAnchored(panel); panel.classList.remove('nbm-sheet');
    if (back?.isConnected) back.focus?.({preventScroll:true});
  }
  return {open, close, isOpen:() => !!state, kindName:k => KIND_NAMES[k]};
}
