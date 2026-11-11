// LIB-두칸보기(S55-11, 시안 docs/design/mockups/library-two-pane.html, 명진 11/09 18:16 'ㅇ'): 자료실 두 칸 보기.
// [▥ 두 칸]을 켜면(서버 view_prefs.library_two, 없으면 켬) PC·펼친 폴드(600px~)의 폴더 묶기에서 왼쪽 나무 대신 두 칸이 같은 목록이다:
// 칸마다 위치 줄(‹ 자료실 › 궤도 › 회의)·정렬, 폴더 줄 + 자료 줄. 맨 위(자료실)는 맨 위 폴더 + 폴더 밖 자료.
// LIB-두칸폴더펼치기(S56-40, 명진 11/10 18:25): 폴더 줄을 누르면 들어가지 않고 그 칸 안에서 나무처럼 펼치기·접기(하위 폴더·자료가 들여 보임).
// 그 폴더만 보기(들어가기)는 PC = 우클릭 [이 폴더로 들어가기](library-folders.js), 손가락 화면 = 펼친 폴더 위 두 손가락 벌리기(folder-pinch.js).
// OPS-빠진일2차 1: 펼쳐 보일 것(하위 폴더·자료)이 없는 폴더는 한 번 누르면 그 칸에서 연다(folder-tree-press.mjs folderPressAction — 모든 나무·목록 같은 판정).
// 펼침 상태는 한 칸 목록과 같은 곳(library-upload.js luOpened·luFilterOpen — h.isOpen/h.toggle)에 적는다.
// 폰(600px 미만)·다른 묶기는 지금 한 칸 목록 그대로. 두 칸을 끄면 지금 한 칸(나무 | 목록).
// - 틀(칸 찾기·지금 칸 표시·Tab·F6)은 [파일]과 같은 공용 부품 two-pane.js, 경계 폭은 split-resize.js(split_ratio.library, 서버 저장).
// - 칸 위치: 오른쪽 칸 = 지금 자료실 위치(luInFolder — 주소·뒤로가기 그대로), 왼쪽 칸 = 이 부품의 화면 메모리. 정렬도 화면 메모리(기기 저장 없음).
// - 옮기기: 자료·폴더를 반대 칸(그 칸 빈 자리 = 그 칸의 지금 폴더, 폴더 줄 = 그 폴더)·같은 칸 폴더 줄에 끌어 놓기는 폴더 부품(library-folders.js)
//   끌기·놓기 그대로('옮겼어요 · 되돌리기'). 선택한 뒤 [→ 오른쪽 폴더로 옮기기]·F6도 같은 옮기기(moveDocsTo·moveFolderTo). 복사는 없다(자료는 폴더 하나에만).
//   LIB-펼친폴더안놓기(S59-9): 칸 안에서 펼친 폴더 안 자료 줄(과 그 묶음 안 빈 틈)에 놓으면 그 폴더(가장 가까운 펼친 폴더) — 자료 옮기기·PC 파일 올리기 모두
//   library-drop.js paneDropAt 하나가 아래 묶음 표시(data-lu-pane-sub = 그 묶음의 폴더 id)로 판정한다. 표시는 그 폴더 줄.
// - 그리기 주인은 library-upload.js luRenderLibrary 하나 — 이 부품은 #documentList 안에 넣을 HTML을 만들고, 그린 뒤 틀·폭을 붙인다.
import {twoPaneFrame} from './two-pane.js';
import {mountSplitResize} from './split-resize.js';
import {paneSide} from './files-panes-model.mjs';
import {ftFolderRowHtml} from './folder-tree-ui.mjs';
import {emptyHtml, waitHtml} from './wait-state.js';
import {folderPressAction, FOLDER_PRESS_ENTER} from './folder-tree-press.mjs';

const OUT_KEY = 'x:out';
const SORTS = Object.freeze([['date', '날짜순'], ['name', '이름순']]);
const byName = (a, b) => String(a).localeCompare(String(b), 'ko', {numeric: true});

// 화면 없이 시험하는 계산: 칸의 위치(folderId 또는 null=맨 위) → {node, folders, files} (거른 뒤 나무에서).
export function paneContent(tree, folderId) {
  const list = Array.isArray(tree) ? tree : [];
  if (!folderId) return {found: true, folders: list.filter(n => n.kind === 'folder'), files: list.find(n => n.key === OUT_KEY)?.files || [], node: list.find(n => n.key === OUT_KEY) || null};
  let found = null;
  const walk = ns => { for (const n of ns || []) { if (found) return; if (n.key === 'f:' + folderId) { found = n; return; } walk(n.children); } };
  walk(list);
  return found ? {found: true, folders: (found.children || []).filter(n => n.kind === 'folder'), files: found.files || [], node: found} : {found: false, folders: [], files: [], node: null};
}
// 정렬: 'date' = 나무 순서 그대로(폴더는 정한 순서, 자료는 최신 먼저), 'name' = 이름 가나다순(폴더·자료 따로).
export function paneSorted({folders, files}, sort, titleOf = d => d.title || d.file_name || '') {
  if (sort !== 'name') return {folders, files};
  return {folders: [...folders].sort((a, b) => byName(a.label, b.label)), files: [...files].sort((a, b) => byName(titleOf(a), titleOf(b)))};
}
// 칸 안 나무 줄(화면 없이 시험): 폴더마다 {kind:'folder', node, depth, open, hasContent}, 펼친 폴더 안 자료 묶음은 {kind:'files', node, depth, files}.
// 칸의 바로 아래 자료(depth 0)도 {kind:'files'} 한 묶음. 정렬은 칸 정렬(sort) 그대로 단마다. 100단 안쪽에서만 내려간다.
export function paneRows(content, isOpen = () => false, sort = 'date', titleOf) {
  const out = [];
  const walk = (folders, files, node, depth) => {
    for (const f of folders) {
      const kids = paneSorted({folders: (f.children || []).filter(n => n.kind === 'folder'), files: f.files || []}, sort, titleOf);
      const hasContent = kids.folders.length + kids.files.length > 0, open = hasContent && !!isOpen(f.key);
      out.push({kind: 'folder', node: f, depth, open, hasContent});
      if (open && depth < 100) walk(kids.folders, kids.files, f, depth + 1);
    }
    if (files.length) out.push({kind: 'files', node, depth, files});
  };
  const top = paneSorted({folders: content.folders || [], files: content.files || []}, sort, titleOf);
  walk(top.folders, top.files, content.node, 0);
  return out;
}
// 위치 줄: 맨 위 '자료실' + 폴더 길(위 → 아래). 폴더가 없어졌으면 맨 위만.
export function paneTrail(folders, folderId) {
  const by = new Map((folders || []).map(f => [f.id, f])), out = [];
  for (let f = by.get(folderId), n = 0; f && n < 120; f = f.parent_id ? by.get(f.parent_id) : null, n++) out.unshift({id: f.id, name: String(f.name || '폴더')});
  return [{id: '', name: '자료실'}, ...out];
}
// 옮기기 막대 글자(시안 ④): 지금 칸이 왼쪽이면 '→ 오른쪽 폴더로 옮기기'.
export const sendText = cur => `${cur === 1 ? '←' : '→'} ${paneSide(cur === 1 ? 0 : 1)} 폴더로 옮기기`;

/**
 * @param {object} h 자료실(library-upload.js)이 넘기는 것
 *   on() 두 칸인가 · folders() 폴더 표 · rightFolder()/enterRight(id) 오른쪽 칸 위치(luInFolder) · render() 다시 그리기
 *   ready() 폴더·자료를 다 읽었는가(읽는 동안 '빈 폴더' 대신 기다림) · rowHtml(d,node) 자료 줄 · canDrag() · ui() 폴더 부품 · picked() 선택한 자료 id들 · busy() · esc
 */
export function createLibraryTwo(h) {
  let left = null, cur = 0, lastTree = [], isOpen = () => false;
  const sorts = ['date', 'date'];
  const root = () => document.querySelector('#documentList');
  const where = i => (i === 1 ? h.rightFolder() || null : left);
  const known = id => !id || h.folders().some(f => f.id === id);
  const frame = twoPaneFrame({root: document.querySelector('#libraryListCard'), attr: 'data-lu-pane-i', rowAttr: 'data-lu-prow', curClass: 'lu-pane-cur',
    on: () => h.on(), cur: () => cur, setCur: i => setCur(i), copy: false,
    visible: () => window.KPTURouter?.current === 'library' && document.visibilityState === 'visible',
    blocked: () => !!document.querySelector('.lu-folder-rename, #libraryEditModal:not(.hidden), #documentModal:not(.hidden)'),
    send: () => { void sendOpp(); }});
  function setCur(i) {
    if (i === cur || (i !== 0 && i !== 1)) return;
    cur = i; frame.mark(); paintBar();
  }
  function go(i, id) {
    if (!known(id)) id = null;
    if (i === 1) { h.enterRight(id); return; }
    left = id; h.render();
  }
  const rowAttr = (html, key) => html.replace(/^<article /, `<article data-lu-prow="${h.esc(key)}" `);
  function folderRow({node: n, depth, open, hasContent}) {
    const attrs = {'data-lu-nav': n.id, 'data-lu-prow': 'f:' + n.id};
    if (h.canDrag()) attrs.draggable = 'true';
    // LIB-받는폴더(S59-11): 받는 폴더 줄은 개수 뒤 작은 '받는 폴더'(나무 모델의 rc 표시 — library-tree.js buildTree).
    return ftFolderRowHtml({name: n.label, count: n.count, countLabel: `${n.count}건`, depth, open, hasContent, tree: true, color: n.fc, mainAttrs: attrs, className: 'lu-pane-folder', tag: n.rc ? '받는 폴더' : ''});
  }
  function filesHtml({node, depth, files}) {
    const rows = files.map(d => { const r = h.rowHtml(d, node); return r ? rowAttr(r, 'd:' + d.id) : ''; }).join('');
    // 펼친 폴더 안 자료는 그 폴더 줄 아래로 들여 보인다(공용 나무 들여쓰기 --ft-depth). data-lu-pane-sub(그 폴더 id)는 놓을 곳 판정(paneDropAt)도 읽는다.
    return !rows ? '' : depth ? `<div class="lu-pane-sub" data-lu-pane-sub="${h.esc(node?.id || '')}" style="--ft-depth:${depth}">${rows}</div>` : rows;
  }
  function paneHtml(i, tree) {
    if (!known(where(i))) { if (i === 0) left = null; }
    const id = where(i), side = paneSide(i), c = paneContent(tree, id);
    const trail = paneTrail(h.folders(), id);
    const steps = trail.map((t, k) => (k === trail.length - 1
      ? `<b class="lu-pane-here" aria-current="location">${h.esc(t.name)}</b>`
      : `<button type="button" class="row-act lu-pane-step" data-lu-pane-go="${h.esc(t.id)}">${h.esc(t.name)}</button><span class="lu-pane-sep" aria-hidden="true">›</span>`)).join('');
    const up = id ? `<button type="button" class="icon-btn lu-pane-up" data-lu-pane-up aria-label="${side} 칸 위 폴더로">‹</button>` : '';
    const sort = `<select class="lu-pane-sort" data-lu-pane-sort aria-label="${side} 칸 정렬">${SORTS.map(([v, l]) => `<option value="${v}"${v === sorts[i] ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    const node = c.node || {key: id ? 'f:' + id : OUT_KEY};
    const rows = paneRows({...c, node}, isOpen, sorts[i]).map(r => (r.kind === 'folder' ? folderRow(r) : filesHtml(r))).join('');
    return `<section class="lu-pane" data-lu-pane-i="${i}" data-lu-pane-folder="${h.esc(id || '')}" aria-label="${side} 칸">`
      + `<div class="lu-pane-head">${up}<nav class="lu-pane-path" aria-label="${side} 칸 위치">${steps}</nav>${sort}</div>`
      + `<div class="lu-pane-list" role="list">${rows || (h.ready() ? emptyHtml(c.found ? '빈 폴더' : '없음') : waitHtml({rows: 3}))}</div></section>`;
  }
  // #documentList 안에 넣을 두 칸 HTML. tree = 거르기까지 한 폴더 묶기 나무(폴더 밖 묶음 포함, 들어가기 전 전체).
  function html(tree) {
    lastTree = tree;
    return `<div class="lu-two" data-lu-two>${paneHtml(0, tree)}${paneHtml(1, tree)}</div><div class="lu-two-bar" data-lu-two-bar hidden></div>`;
  }
  // 이번 그리기에서 두 칸에 보이는 나무 조각(같은 글 원본 묶기·전체 고르기 계산용).
  // 펼친 폴더 안 자료도 그 폴더 묶음으로 넣는다. open: 이번 그리기의 펼침 판정(한 칸 목록과 같은 규칙).
  const shownNodes = (tree, open = isOpen) => { isOpen = open; return [0, 1].flatMap(i => paneRows(paneContent(tree, where(i)), isOpen, sorts[i]).filter(r => r.kind === 'files').map((r, k) => ({kind: 'folder', key: `pane:${i}:${k}`, files: r.files, children: []}))); };
  function paintBar() {
    const bar = root()?.querySelector('[data-lu-two-bar]');
    if (!bar) return;
    const n = h.picked().length;
    bar.hidden = !n;
    bar.innerHTML = n ? `<span class="lu-two-count">${n}개 선택됨</span><button type="button" class="row-act" data-lu-two-send>${sendText(cur)} (F6)</button>` : '';
  }
  // 그린 뒤: 지금 칸 표시·옮기기 막대·경계 폭.
  function after(splitQuery) {
    const box = root()?.querySelector('[data-lu-two]');
    if (!box) return;
    frame.mark(); paintBar();
    mountSplitResize({container: box, name: 'library', label: '왼쪽 칸과 오른쪽 칸 폭 조절', query: splitQuery, active: () => h.on(), columns: [
      {el: () => box.querySelector('[data-lu-pane-i="0"]'), varName: '--ds-split-library-a', minVar: '--ds-split-library-min', minFallback: 260, share: 50},
      {el: () => box.querySelector('[data-lu-pane-i="1"]'), varName: '--ds-split-library-b', minVar: '--ds-split-library-min', minFallback: 260, share: 50},
    ]});
  }
  // F6·[→ 오른쪽 폴더로 옮기기]: 선택한 자료(없으면 포커스 줄 하나 — 자료 또는 폴더)를 반대 칸의 지금 폴더로.
  async function sendOpp() {
    if (h.busy()) return;
    const to = where(cur ^ 1);
    if (!known(to)) return;
    const ids = h.picked();
    if (ids.length) { await h.ui().moveDocsTo(ids, to); return; }
    const row = document.activeElement?.closest?.('[data-lu-pane-i] [data-lu-prow]');
    const key = row?.getAttribute('data-lu-prow') || '';
    if (key.startsWith('d:')) await h.ui().moveDocsTo([key.slice(2)], to);
    else if (key.startsWith('f:')) {
      const id = key.slice(2), f = h.folders().find(x => x.id === id);
      if (!f || id === to || (f.parent_id || null) === (to || null)) return;
      // 자기 안으로는 못 옮긴다(옮길 폴더의 아래 폴더로도).
      if (to && paneTrail(h.folders(), to).some(t => t.id === id)) { h.say?.('자기 안으로는 옮길 수 없어요.'); return; }
      await h.ui().moveFolderTo(id, to);
    }
  }
  function bind() {
    const list = root();
    if (!list || list.dataset.luTwoBound) return;
    list.dataset.luTwoBound = '1';
    // 폴더 줄·위치 줄·‹·옮기기 막대. 자료 줄은 지금 목록 그대로(열기·⋯·고르기).
    list.addEventListener('click', e => {
      if (!h.on()) return;
      const pane = e.target.closest?.('[data-lu-pane-i]'), i = pane ? Number(pane.dataset.luPaneI) : -1;
      if (e.target.closest('[data-lu-two-send]')) { e.preventDefault(); void sendOpp(); return; }
      if (i < 0) return;
      setCur(i);
      const step = e.target.closest('[data-lu-pane-go]');
      if (step) { e.preventDefault(); go(i, step.dataset.luPaneGo || null); focusHead(i); return; }
      if (e.target.closest('[data-lu-pane-up]')) { e.preventDefault(); const f = h.folders().find(x => x.id === where(i)); go(i, f?.parent_id || null); focusHead(i); return; }
      // 폴더 줄 누르기 = 그 칸 안에서 펼치기·접기(들어가지 않음). 들어가기는 우클릭 메뉴·두 손가락.
      // OPS-빠진일2차 1(명진 11/11 14:55 '가'): 펼쳐 보일 것(하위 폴더·자료)이 없는 폴더는 한 번 누르면 그 칸에서 그 폴더를 연다(공용 판정 folderPressAction).
      //  자료만 든 폴더는 지금처럼 그 칸 안에 펼친다(펼친 폴더 안 놓기 #2408 그대로).
      const nav = e.target.closest('[data-lu-nav]');
      if (nav && !e.target.closest('input')) {
        e.preventDefault(); e.stopPropagation();
        const fid = nav.dataset.luNav || '';
        if (!fid) return;
        const c = paneContent(lastTree, fid);
        if (c.found && folderPressAction(c.folders.length, c.files.length) === FOLDER_PRESS_ENTER) { enter(fid, nav); return; }
        if (!paneHasContent(fid)) return;
        h.toggle('f:' + fid, nav.getAttribute('aria-expanded') !== 'true');
        root()?.querySelector(`[data-lu-pane-i="${i}"] [data-lu-nav="${CSS.escape(fid)}"]`)?.focus({preventScroll: true});
      }
    });
    list.addEventListener('change', e => {
      const s = e.target.closest?.('[data-lu-pane-sort]'), pane = s?.closest('[data-lu-pane-i]');
      if (!s || !pane) return;
      const i = Number(pane.dataset.luPaneI);
      sorts[i] = s.value === 'name' ? 'name' : 'date'; h.render();
      root()?.querySelector(`[data-lu-pane-i="${i}"] [data-lu-pane-sort]`)?.focus({preventScroll: true});
    });
    document.querySelector('#libraryListCard')?.addEventListener('pointerdown', e => { if (!h.on()) return; const i = frame.paneOf(e.target); if (i >= 0) setCur(i); }, true);
    list.addEventListener('focusin', e => { if (!h.on()) return; const i = frame.paneOf(e.target); if (i >= 0) setCur(i); });
    // 두 칸 키(Tab 칸 바꾸기 · F6 반대 칸 폴더로 옮기기). F5는 복사가 없어 가로채지 않음.
    document.addEventListener('keydown', e => { if (h.on()) frame.key(e); });
  }
  // 펼칠 것이 있는 폴더인가.
  function paneHasContent(fid) {
    const c = paneContent(lastTree, fid);
    return c.found && (c.folders.length + c.files.length > 0);
  }
  // 그 폴더만 보기(들어가기): 우클릭 [이 폴더로 들어가기]·두 손가락 벌리기. el이 있는 칸(없으면 지금 칸)에서 들어간다.
  function enter(id, el = null) {
    const p = el ? frame.paneOf(el) : -1, i = p >= 0 ? p : cur;
    setCur(i); go(i, id || null); focusHead(i);
  }
  // 두 손가락 오므리기: 그 칸의 한 단계 위로.
  function up(el = null) {
    const p = el ? frame.paneOf(el) : -1, i = p >= 0 ? p : cur, here = where(i);
    if (!here) return;
    const f = h.folders().find(x => x.id === here);
    setCur(i); go(i, f?.parent_id || null); focusHead(i);
  }
  // 폴더로 들어간 뒤 그 칸의 첫 줄(없으면 위치 줄)에 포커스.
  function focusHead(i) {
    const p = root()?.querySelector(`[data-lu-pane-i="${i}"]`);
    (p?.querySelector('[data-lu-prow]') || p?.querySelector('[data-lu-pane-sort]'))?.focus({preventScroll: true});
  }
  // 칸 i의 지금 폴더(우클릭 [새 폴더]·바깥 파일 놓기·[자료 등록]이 쓰는 곳). el이 칸 밖이면 지금 칸.
  const folderAt = el => { const i = frame.paneOf(el); return where(i >= 0 ? i : cur); };
  return {html, after, bind, shownNodes, folderAt, enter, up, paneOf: el => frame.paneOf(el), get cur() { return cur; }, get left() { return left; }};
}
