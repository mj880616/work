// S69-62 휴지통 보기(명진 11/24 18:17 "파일에서 Google 드라이브 휴지통 볼 수가 없네" / "OneDrive도 마찬가지고 휴지통을 볼 수 있어야 돼. 지운파일 복구하려면"):
// [파일]의 구글 드라이브·원드라이브 상자 맨 아래 '휴지통' 줄을 누르면 여는 창. 모양은 폴더 고르기 창과 같은 아래 시트(folder-dest-sheet.css .fx-dest).
//  - 구글 드라이브: 서버 cloud-files trash_list(내 드라이브에서 내가 직접 지운 것, 100개씩 [더 보기]) → 줄마다 이름·지운 날·크기 + 그림 단추 ↶ [되살리기]
//    + 영구 삭제(TRASH-줄그림단추, 공용 trash-row.js 시안 '마'). 줄을 꾹 눌러 여럿을 고르면 아래 막대 'N개 선택 · 되살리기 · 영구 삭제'.
//    되살리기(untrash, confirm:true, 사람이 누른 것만) → 원래 폴더로 돌아오고 [파일] 목록을 다시 그린다.
//    영구 삭제(FILES-휴지통영구삭제, 사용자 결정 2026-11-28 "1 서버에 길을 둬요"): '되돌릴 수 없어요' 확인 뒤 서버 cloud-files purge(confirm:true, 100개씩).
//    서버가 줄마다 구글에 휴지통에 있는 내 파일인지·지울 수 있는지 다시 묻고 그것만 지운다. 못 지운 것은 개수로 알린다.
//  - 원드라이브: 개인 계정 휴지통 목록을 주는 Graph API가 없어 목록 대신 [원드라이브 휴지통 열기](원드라이브 웹, 새 창) 한 줄.
//    사진에서 지운 사진은 원드라이브 '.WORK ON+ 휴지통' 폴더에 있으므로 그 폴더가 보이면 [그 폴더 열기].
//  - 휴지통 비우기(통째로)와 원드라이브 영구 삭제는 없다(서버 함수에 그 길이 없음 — 시험이 문자열로 막음). 기기 저장 없음.
import {sizeText, dayText} from './files-model.mjs';
import {notify, askConfirm} from './small-notice.js';
import {waitHtml, failHtml, emptyHtml} from './wait-state.js';
import {partStyles} from './part-styles.js';
import {trashRowHtml, trashListOpen, trashPickHeadHtml, trashPickBarHtml, bindTrashPick} from './trash-row.js';
await partStyles('folder-dest-sheet');

const FN = '/functions/v1/cloud-files';
const NAME = {gd: '구글 드라이브', od: '원드라이브'};
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
export const GD_TRASH_NOTE = '내 드라이브에서 직접 삭제한 것만 보여요. 폴더째 삭제한 파일은 그 폴더 줄 하나로 보여요.';
export const OD_TRASH_NOTE = '원드라이브 휴지통 목록은 원드라이브 웹에서만 볼 수 있어요.';
export const OD_PHOTO_TRASH = '.WORK ON+ 휴지통';
// 서버 purge 한 번에 보내는 개수(서버 PURGE_MAX와 같음).
export const PURGE_CHUNK = 100;
export const PURGE_NOTE = '삭제하면 되돌릴 수 없어요.';
// 영구 삭제 확인 글. 한 줄이면 이름, 여럿이면 개수. 폴더가 섞이면 안쪽 파일도 함께 지워진다고 알린다.
export function purgeAskText(items) {
  const list = Array.isArray(items) ? items : [];
  const text = list.length === 1 ? `“${list[0].name || '이름 없음'}”을 영구 삭제할까요?` : `선택한 ${list.length}개를 영구 삭제할까요?`;
  return {text, note: list.some(x => x.is_folder) ? `폴더 안 파일도 함께 삭제돼요. ${PURGE_NOTE}` : PURGE_NOTE};
}

let box = null, st = null, layer = null, pick = null;
const rt = () => window.KPTURuntime;
function ensure() {
  if (box?.isConnected) return box;
  box = document.createElement('dialog');
  box.className = 'fx-dest fd-sheet fx-trash';
  box.setAttribute('data-fx-trash-sheet', '');
  box.setAttribute('aria-labelledby', 'fxTrashTitle');
  document.body.append(box);
  pick = bindTrashPick(box, {order: () => (st?.items || []).map(x => x.id), onChange: () => paint(), layer: 'files-trash-pick', enabled: () => !!st && !st.busy});
  box.addEventListener('cancel', e => { e.preventDefault(); if (pick?.select.active) { pick.select.stop(); paint(); return; } close(); });
  box.addEventListener('pointerdown', e => {
    if (e.target !== box) return;
    const r = box.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) { e.preventDefault(); close(); }
  });
  box.addEventListener('click', onClick);
  return box;
}
function rowHtml(r) {
  const when = [r.trashed_at ? dayText(r.trashed_at) : '', r.is_folder ? '폴더' : r.size_bytes === null || r.size_bytes === undefined ? '' : sizeText(r.size_bytes)].filter(Boolean).join(' · ');
  return trashRowHtml({id: r.id, name: r.name, whenText: when, whenIso: r.trashed_at || '', busy: st.busy, canPurge: true, picking: pick.select.active, picked: pick.select.has(r.id)});
}
// 아래 줄: [더 보기]만(되살리기·영구 삭제는 줄 그림 단추·고르기 막대). 원드라이브는 창 안 단추.
function footHtml() {
  if (st.source !== 'gd') return '';
  return st.next ? `<button type="button" class="fx-btn" data-fx-trash-more${st.loading ? ' disabled' : ''}>더 보기</button>` : '';
}
function paint() {
  if (!st || !box) return;
  const head = `<div class="fx-dest-h"><span id="fxTrashTitle">${esc(NAME[st.source])} 휴지통</span><button type="button" class="mini" data-fx-trash-close aria-label="닫기">✕</button></div>`;
  if (st.source === 'od') {
    const photo = st.odPhotoTrash ? `<button type="button" class="fx-btn" data-fx-trash-odfolder>${esc(OD_PHOTO_TRASH)} 폴더 열기</button>` : '';
    box.innerHTML = head + `<p class="fx-dest-note">${esc(OD_TRASH_NOTE)}${st.odPhotoTrash ? ` 사진에서 삭제한 사진은 '${esc(OD_PHOTO_TRASH)}' 폴더에 있어요.` : ''}</p>`
      + `<div class="fx-dest-f fx-trash-od">${photo}<a class="fx-btn fx-pri" href="${esc(st.web || 'https://onedrive.live.com/?v=recyclebin')}" target="_blank" rel="noopener noreferrer" data-fx-trash-web>원드라이브 휴지통 열기</a></div>`;
    return;
  }
  const list = st.failed ? failHtml({retry: 'data-fx-trash-retry', text: st.failed}) : !st.items ? waitHtml({rows: 3})
    : st.items.length ? trashListOpen('휴지통 파일', pick.select.active) + st.items.map(rowHtml).join('') + '</div>' : emptyHtml('휴지통이 비어 있어요');
  if (pick.select.active) { pick.select.prune(new Set((st.items || []).map(x => x.id))); if (!pick.select.size) pick.select.stop(); }
  const on = pick.select.active, n = pick.select.size;
  box.innerHTML = head + `<p class="fx-dest-note">${esc(GD_TRASH_NOTE)}</p>${on ? trashPickHeadHtml({total: st.items?.length || 0, picked: n}) : ''}<div class="fx-dest-tree fx-trash-list">${list}</div>`
    + (on ? trashPickBarHtml({picked: n, busy: st.busy, canPurge: true}) : '') + (st.next ? `<div class="fx-dest-f">${footHtml()}</div>` : '');
}
async function call(action, body) {
  return rt().api(FN, {method: 'POST', body: {action, ...body}, singleFlight: false, timeoutMs: 60000});
}
async function load(more = false) {
  const s = st;
  if (!s || s.loading) return;
  s.loading = true; s.failed = '';
  if (!more) { s.items = null; s.next = null; }
  paint();
  try {
    const d = await call('trash_list', {source: s.source, ...(more && s.next ? {page: s.next} : {})});
    if (st !== s) return;
    if (s.source === 'od') { s.web = typeof d?.web === 'string' && d.web.startsWith('https://onedrive.live.com/') ? d.web : null; return; }
    const got = Array.isArray(d?.items) ? d.items.filter(x => x && typeof x.id === 'string') : [];
    s.items = [...(more ? s.items || [] : []), ...got.filter(x => !(s.items || []).some(y => y.id === x.id))];
    s.next = typeof d?.next === 'string' ? d.next : null;
  } catch (e) {
    if (st === s) s.failed = s.errorText?.(e) || '휴지통을 읽지 못했어요';
  } finally {
    if (st === s) { s.loading = false; paint(); }
  }
}
async function restore(ids) {
  const s = st;
  if (!s || s.busy || !ids.length) return;
  s.busy = true; paint();
  let d = null;
  try { d = await call('untrash', {source: 'gd', ids, confirm: true}); }
  catch (e) { notify(`되살리지 못했어요: ${s.errorText?.(e) || '잠시 뒤 다시 해 주세요'}`, {error: true, record: false}); }
  if (st !== s) return;
  s.busy = false;
  const back = new Set((Array.isArray(d?.changed) ? d.changed : []).map(x => x.item_id));
  const bad = Array.isArray(d?.failed) ? d.failed.length : 0, left = Array.isArray(d?.left) ? d.left.length : 0;
  if (back.size) {
    s.items = (s.items || []).filter(x => !back.has(x.id));
    pick.select.stop();
    try { await s.onRestored?.(d); } catch { /* 목록 다시 그리기 실패는 다음 맞추기가 고친다 */ }
    notify(`${back.size}개를 되살렸어요${bad + left ? ` · ${bad + left}개는 못 했어요` : ''} · 원래 폴더에 있어요`, {error: !!(bad + left), record: false});
  } else if (d) notify('되살리지 못했어요. 휴지통에서 이미 빠졌을 수 있어요.', {error: true, record: false});
  paint();
}
// 영구 삭제: 확인('되돌릴 수 없어요')을 거친 뒤에만 서버 purge를 100개씩 부른다. 서버가 지운 것(removed)만 목록에서 뺀다.
async function purge(ids, anchor) {
  const s = st;
  if (!s || s.busy || !ids.length) return;
  const picked = ids.map(id => (s.items || []).find(x => x.id === id)).filter(Boolean);
  if (!picked.length) return;
  const ask = purgeAskText(picked);
  if (!(await askConfirm(anchor, {text: ask.text, note: ask.note, ok: '영구 삭제', danger: true})) || st !== s || s.busy) return;
  s.busy = true; paint();
  const gone = new Set();
  let bad = 0, error = '';
  const want = picked.map(x => x.id);
  for (let i = 0; i < want.length; i += PURGE_CHUNK) {
    const part = want.slice(i, i + PURGE_CHUNK);
    try {
      const d = await call('purge', {source: 'gd', ids: part, confirm: true});
      for (const x of Array.isArray(d?.removed) ? d.removed : []) if (typeof x?.id === 'string') gone.add(x.id);
      bad += part.filter(id => !gone.has(id)).length;
    } catch (e) { bad += part.length; error ||= s.errorText?.(e) || '잠시 뒤 다시 해 주세요'; }
    if (st !== s) return;
  }
  s.busy = false;
  if (gone.size) s.items = (s.items || []).filter(x => !gone.has(x.id));
  pick.select.stop();
  if (gone.size) notify(`${gone.size}개를 영구 삭제했어요${bad ? ` · ${bad}개는 못 했어요` : ''}`, {error: !!bad, record: false});
  else notify(`영구 삭제하지 못했어요: ${error || '휴지통에서 이미 빠졌거나 삭제할 수 없는 항목이에요'}`, {error: true, record: false});
  paint();
}
function onClick(e) {
  const b = e.target.closest?.('button,a');
  if (!b || !st) return;
  if (b.disabled) return;
  if (b.matches('[data-fx-trash-close]')) { close(); return; }
  if (b.matches('[data-fx-trash-retry]')) { void load(); return; }
  if (b.matches('[data-fx-trash-more]')) { void load(true); return; }
  if (b.matches('[data-tr-restore]')) { void restore([b.dataset.trRestore]); return; }
  if (b.matches('[data-tr-bulk-restore]')) { void restore(pick.ids()); return; }
  if (b.matches('[data-tr-purge]')) { void purge([b.dataset.trPurge], b); return; }
  if (b.matches('[data-tr-bulk-purge]')) { void purge(pick.ids(), b); return; }
  if (b.matches('[data-fx-trash-odfolder]')) { const s = st; close({keepFocus: true}); s.openFolder?.(s.odPhotoTrash); }
}

// 창 열기. source: 'gd' | 'od', anchor: 누른 줄(닫을 때 초점), onRestored(d): 되살린 뒤 [파일] 목록을 다시 그리기, errorText(error): 오류 글,
// odPhotoTrash: 원드라이브 맨 위 '.WORK ON+ 휴지통' 폴더 id(있으면 [그 폴더 열기]), openFolder(id): 그 폴더 열기.
export function openCloudTrash({source, anchor = null, onRestored = null, errorText = null, odPhotoTrash = null, openFolder = null}) {
  if (source !== 'gd' && source !== 'od') return;
  if (st) close({silent: true});
  ensure();
  st = {source, anchor, onRestored, errorText, odPhotoTrash, openFolder, items: null, next: null, busy: false, loading: false, failed: '', web: null};
  paint();
  try { if (!box.open) box.showModal(); } catch { box.setAttribute('open', ''); }
  layer ||= window.KPTURouter?.layer?.open('files-trash', {reopen: () => paint(), close: () => { layer = null; close({fromBack: true}); return true; }}) || null;
  void load();
  box.querySelector('[data-fx-trash-close]')?.focus({preventScroll: true});
}
export const cloudTrashOpen = () => !!st;
function close({fromBack = false, keepFocus = false} = {}) {
  const s = st;
  if (!s) return;
  st = null; pick?.select.stop();
  if (box) { try { box.close(); } catch { box.removeAttribute('open'); } box.innerHTML = ''; }
  const l = layer; layer = null;
  if (!fromBack) l?.close?.();
  if (!keepFocus && s.anchor?.isConnected) s.anchor.focus?.({preventScroll: true});
}
