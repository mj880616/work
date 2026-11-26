// S69-62 폴더 고르기 창 하나(사용자 11/24 18:16·18:18 "파일 옮기는 UI ... 이거를 다른 데서도 사용할 수 있도록" / "이쪽을 모델로 해 가지고 다 통일"):
// [파일]의 '옮길 곳' 창과 같은 모양(folder-dest-sheet.mjs destSheetHtml, 모양 folder-dest-sheet.css)을 자료실·노트·사진·조직 기록·News 별표 폴더에서 연다.
// 대상 나무만 다르다(자료실 폴더 표·노트 폴더 표·사진 폴더·드라이브 층). 쓰는 일(옮기기·새 폴더)은 부른 쪽이 기존 서버 길로 한다.
//  - 줄 누르기 = 그 폴더 고르기 + 펼치기. 폴더 아이콘 = 펼치기·접기만. 옮기기는 아래 [여기에 옮기기]로만(S69-58 '누르면 들어가기·확인으로 옮기기').
//  - 위 '최근 넣은 곳' 칩(부른 쪽이 준 최근 폴더 id), 아래 줄 '자료실 › 가 › 나' 경로 + [새 폴더](고른 폴더 안에 만들고 그 폴더를 고름) + [여기에 옮기기].
//  - 폰은 아래에서 올라오는 창(하단바 위), PC는 가운데 아래 창. <dialog> showModal로 연다 — 노트 큰 창 같은 다른 창 위에도 뜨고,
//    [새 폴더] 이름 묻기(small-notice askText)는 열린 dialog 안에 붙어 그 위에 보인다.
//  - 닫기: ✕·Esc·바깥(어둡게 한 곳) 누르기·폰 뒤로가기(공용 router layer 한 칸). 닫으면 부른 단추로 초점을 돌려준다.
// 기기 저장 없음. 펼친 상태는 기억하지 않는다(열 때마다 맨 위 + 지금 폴더까지 펼침).
import {destSheetHtml, folderSheetRows, folderSheetPath, folderChain, ROOT} from './folder-dest-sheet.mjs';
import {ftFolderRowHtml, ftIconHtml} from './folder-tree-ui.mjs';
import {ftKeepPlace} from './folder-tree-press.mjs';
import {askText, notify} from './small-notice.js';
import {waitHtml} from './wait-state.js';
import {partStyles} from './part-styles.js';
await partStyles('folder-dest-sheet');

export {ROOT};
let box = null, state = null, layer = null;

function ensure() {
  if (box?.isConnected) return box;
  box = document.createElement('dialog');
  box.className = 'fx-dest fd-sheet';
  box.setAttribute('data-fd-sheet', '');
  box.setAttribute('aria-labelledby', 'fdSheetTitle');
  document.body.append(box);
  box.addEventListener('cancel', e => { e.preventDefault(); close(); });
  // 바깥(dialog 바탕 = ::backdrop) 누르기: 누른 곳이 창 사각형 밖이면 닫는다.
  box.addEventListener('pointerdown', e => {
    if (e.target !== box) return;
    const r = box.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) { e.preventDefault(); close(); }
  });
  box.addEventListener('click', onClick);
  return box;
}
const list = () => (typeof state?.folders === 'function' ? state.folders() : state?.folders) || [];
const byId = id => list().find(f => f.id === id) || null;
const nameOf = key => (key === ROOT ? state.rootName : byId(key)?.name || '');
// 고른 곳이 옮길 수 없는 곳이면 그 까닭(빈 글 = 옮길 수 있음).
function reasonOf(key) {
  if (key === undefined || key === null) return '';
  if (key === ROOT && state.allowRoot === false) return state.rootReason || '맨 위에는 옮길 수 없어요';
  const id = key === ROOT ? null : key;
  if (state.current !== undefined && (state.current ?? null) === id) return '지금 있는 곳이에요';
  return String(state.blocked?.(id) || '');
}

function paint() {
  if (!state || !box) return;
  ftKeepPlace(box, () => paintNow());
}
function paintNow() {
  const s = state, folders = list();
  const rows = folderSheetRows({folders, open: s.open, rootName: s.rootName, maybeKids: s.maybeKids});
  const cur = s.pick;
  const tree = rows.map(r => {
    const here = s.current !== undefined && (s.current ?? null) === (r.root ? null : r.id);
    const blocked = !r.root && !!s.blocked?.(r.id);
    return ftFolderRowHtml({name: r.name, depth: r.depth, open: r.open, hasContent: r.hasKids, current: r.key === cur, off: false,
      className: [r.root ? 'fx-root' : '', blocked ? 'fd-blocked' : ''].filter(Boolean).join(' '), color: r.root ? null : r.color,
      icon: r.root ? (s.rootIcon || ftIconHtml({open: r.open && r.hasKids})) : null, tag: [here ? '지금 여기' : '', r.root ? '' : String(s.tag?.(r.id) || '')].filter(Boolean).join(' · '),
      mainAttrs: {'data-fx-dest-pick': r.key, 'data-fx-dest-name': r.name},
      toggle: {attrs: {'data-fx-dest-twist': r.key}, label: `${r.name} ${r.open && r.hasKids ? '접기' : '펼치기'}`}});
  }).join('');
  const chips = (s.recent || []).map(id => byId(id)).filter(Boolean).slice(0, 3).map(f => ({key: f.id, name: f.name, on: f.id === cur, icon: ftIconHtml({color: f.color ?? null, className: 'ft-ico fd-chip-ico'})}));
  const why = cur === undefined ? '' : reasonOf(cur);
  const at = cur === undefined ? '' : folderSheetPath(folders, cur, s.rootName) + (why ? ` — ${why}` : '');
  const canMk = typeof s.mkdir === 'function' && cur !== undefined && !(cur !== ROOT && s.blocked?.(cur)) && !s.busy && !(cur === ROOT && s.rootMk === false);
  box.innerHTML = destSheetHtml({title: s.title, titleId: 'fdSheetTitle', chips, chipsLabel: s.recentLabel || '최근 넣은 곳', tree, wait: waitHtml({rows: 3}),
    at, canMk, mk: typeof s.mkdir === 'function', canGo: cur !== undefined && !why && !s.busy, goLabel: s.goLabel || '여기에 옮기기', note: s.note || '', treeLabel: s.treeLabel || '옮길 폴더', extra: s.extra?.label || ''});
}

async function loadKids(id) {
  if (typeof state?.load !== 'function') return;
  const s = state;
  try { await s.load(id); } catch { /* 못 읽은 층은 비어 보인다(부른 쪽이 알림) */ }
  if (state === s) paint();
}
function pick(key) {
  const s = state;
  if (!s || s.busy) return;
  s.pick = key;
  s.open.add(key);
  void loadKids(key === ROOT ? null : key);
  paint();
}
function twist(key) {
  const s = state;
  if (!s) return;
  if (s.open.has(key)) s.open.delete(key); else { s.open.add(key); void loadKids(key === ROOT ? null : key); }
  paint();
  box.querySelector(`[data-fx-dest-twist="${CSS.escape(key)}"]`)?.focus({preventScroll: true});
}
async function mkdir(anchor) {
  const s = state;
  if (!s || s.pick === undefined || typeof s.mkdir !== 'function' || s.busy) return;
  const v = await askText(anchor, {text: `새 폴더 이름 (${s.nameMax || 40}자까지)`, value: '', ok: '만들기', max: s.nameMax || 40});
  if (v === null || state !== s) return;
  const parent = s.pick === ROOT ? null : s.pick;
  s.busy = true; paint();
  let made = null;
  try { made = await s.mkdir(parent, String(v)); } catch (error) { notify(error?.message || '폴더를 만들지 못했어요.', {error: true}); }
  finally { s.busy = false; }
  if (state !== s) return;
  if (made?.id) {
    if (!list().some(f => f.id === made.id) && Array.isArray(s.folders)) s.folders.push({parent_id: parent, ...made});
    s.open.add(parent === null ? ROOT : parent);
    s.pick = made.id;
  }
  paint();
  box.querySelector('[data-fx-dest-go]')?.focus({preventScroll: true});
}
async function go() {
  const s = state;
  if (!s || s.pick === undefined || reasonOf(s.pick) || s.busy) return;
  const key = s.pick, id = key === ROOT ? null : key, folder = id ? byId(id) : null;
  close({keepFocus: true});
  await s.onGo?.(id, folder);
}
function onClick(e) {
  const b = e.target.closest?.('button');
  if (!b || !box.contains(b) || !state) return;
  if (b.disabled) return;
  if (b.matches('[data-fx-dest-close]')) { close(); return; }
  if (b.matches('[data-fx-dest-pick]')) { pick(b.dataset.fxDestPick); return; }
  if (b.matches('[data-fx-dest-twist]')) { twist(b.dataset.fxDestTwist); return; }
  if (b.matches('[data-fx-dest-mkdir]')) { void mkdir(b); return; }
  if (b.matches('[data-fx-dest-go]')) { void go(); return; }
  if (b.matches('[data-fd-extra]')) { const s = state; close({keepFocus: true}); void s.extra?.run?.(); }
}

// 창 열기. opts:
//  title('1개 옮길 곳'), rootName('자료실'), rootIcon(HTML, 없으면 폴더 그림), folders(납작한 목록 또는 그 목록을 돌려주는 함수:
//  id·name·parent_id·sort_order·color), recent(최근 폴더 id 배열), current(지금 든 곳: id, null = 맨 위, undefined = 모름),
//  tag(id) → 줄 끝 작은 글(같은 이름 폴더의 위치·'꺼짐' 등, 없으면 빈 글),
//  start(처음 고른 곳: id·null(맨 위)·undefined(고르지 않음)), blocked(id → 까닭 글, 옮길 수 없는 폴더), allowRoot(기본 true), rootReason,
//  goLabel(기본 '여기에 옮기기'), note(나무 위 한 줄), mkdir(parentId|null, name) → 만든 폴더 {id,name,...}(없으면 [새 폴더] 없음), rootMk(false = 맨 위에 못 만듦),
//  load(parentId) → Promise(한 층씩 읽는 나무), maybeKids(id) → 아직 안 읽은 층이면 true, onGo(id|null, folder) — 고른 뒤 창을 닫고 부른다,
//  extra({label, run}) = [새 폴더] 옆 단추 하나(창을 닫고 run), onClosed(), anchor(닫을 때 초점 돌려줄 단추).
export function openFolderSheet(opts) {
  if (state) close({silent: true});
  ensure();
  const start = opts.start === undefined ? undefined : opts.start === null ? ROOT : opts.start;
  const open = new Set([ROOT]);
  const folders = (typeof opts.folders === 'function' ? opts.folders() : opts.folders) || [];
  for (const id of [opts.current, opts.start]) if (id) for (const f of folderChain(folders, id).slice(0, -1)) open.add(f.id);
  state = {...opts, rootName: opts.rootName || '맨 위', open, pick: start, busy: false};
  paintNow();
  try { if (!box.open) box.showModal(); } catch { box.setAttribute('open', ''); }
  document.documentElement.classList.add('fd-sheet-open');
  layer ||= window.KPTURouter?.layer?.open('folder-sheet', {reopen: () => paint(), close: () => { layer = null; close({fromBack: true}); return true; }}) || null;
  void loadKids(null);
  box.querySelector('[data-fx-dest-close]')?.focus({preventScroll: true});
  return {close: () => close(), get open() { return !!state; }};
}
export function closeFolderSheet() { close(); }
export const folderSheetOpen = () => !!state;
export const folderSheetContains = node => !!box && !!node && box.contains(node);

function close({fromBack = false, keepFocus = false, silent = false} = {}) {
  const s = state;
  if (!s) return;
  state = null;
  if (box) { try { box.close(); } catch { box.removeAttribute('open'); } box.innerHTML = ''; }
  document.documentElement.classList.remove('fd-sheet-open');
  const l = layer; layer = null;
  if (!fromBack) l?.close?.();
  if (!keepFocus && s.anchor?.isConnected) s.anchor.focus?.({preventScroll: true});
  if (!silent) s.onClosed?.();
}
