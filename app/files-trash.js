// S69-62 휴지통 보기(사용자 11/24 18:17 "파일에서 Google 드라이브 휴지통 볼 수가 없네" / "OneDrive도 마찬가지고 휴지통을 볼 수 있어야 돼. 지운파일 복구하려면"):
// [파일]의 구글 드라이브·원드라이브 상자 맨 아래 '휴지통' 줄을 누르면 여는 창. 모양은 폴더 고르기 창과 같은 아래 시트(folder-dest-sheet.css .fx-dest).
//  - 구글 드라이브: 서버 cloud-files trash_list(내 드라이브에서 내가 직접 지운 것, 100개씩 [더 보기]) → 줄마다 이름·지운 날·크기 + 선택 칸 →
//    [되살리기](untrash, confirm:true, 사람이 누른 것만) → 원래 폴더로 돌아오고 [파일] 목록을 다시 그린다.
//  - 원드라이브: 개인 계정 휴지통 목록을 주는 Graph API가 없어 목록 대신 [원드라이브 휴지통 열기](원드라이브 웹, 새 창) 한 줄.
//    사진에서 지운 사진은 원드라이브 '.WORK ON+ 휴지통' 폴더에 있으므로 그 폴더가 보이면 [그 폴더 열기].
//  - 영구 삭제·휴지통 비우기는 없다(서버 함수에 그 길이 없음 — 시험이 문자열로 막음). 기기 저장 없음.
import {sizeText, dayText} from './files-model.mjs';
import {notify} from './small-notice.js';
import {waitHtml, failHtml, emptyHtml} from './wait-state.js';
import {partStyles} from './part-styles.js';
await partStyles('folder-dest-sheet');

const FN = '/functions/v1/cloud-files';
const NAME = {gd: '구글 드라이브', od: '원드라이브'};
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
export const GD_TRASH_NOTE = '내 드라이브에서 직접 삭제한 것만 보여요. 폴더째 삭제한 파일은 그 폴더 줄 하나로 보여요.';
export const OD_TRASH_NOTE = '원드라이브 휴지통 목록은 원드라이브 웹에서만 볼 수 있어요.';
export const OD_PHOTO_TRASH = '.WORK ON+ 휴지통';

let box = null, st = null, layer = null;
const rt = () => window.KPTURuntime;
function ensure() {
  if (box?.isConnected) return box;
  box = document.createElement('dialog');
  box.className = 'fx-dest fd-sheet fx-trash';
  box.setAttribute('data-fx-trash-sheet', '');
  box.setAttribute('aria-labelledby', 'fxTrashTitle');
  document.body.append(box);
  box.addEventListener('cancel', e => { e.preventDefault(); close(); });
  box.addEventListener('pointerdown', e => {
    if (e.target !== box) return;
    const r = box.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) { e.preventDefault(); close(); }
  });
  box.addEventListener('click', onClick);
  box.addEventListener('change', e => {
    const c = e.target.closest?.('[data-fx-trash-pick]');
    if (!c || !st) return;
    if (c.checked) st.picked.add(c.dataset.fxTrashPick); else st.picked.delete(c.dataset.fxTrashPick);
    paintFoot();
  });
  return box;
}
function rowHtml(r) {
  const meta = [r.trashed_at ? `${dayText(r.trashed_at)} 삭제` : '', r.is_folder ? '폴더' : r.size_bytes === null || r.size_bytes === undefined ? '' : sizeText(r.size_bytes)].filter(Boolean).join(' · ');
  return `<label class="fx-trash-row"><input type="checkbox" data-fx-trash-pick="${esc(r.id)}"${st.picked.has(r.id) ? ' checked' : ''}${st.busy ? ' disabled' : ''}>`
    + `<span class="fx-trash-name">${esc(r.name)}</span><span class="fx-trash-meta">${esc(meta)}</span></label>`;
}
function footHtml() {
  if (st.source !== 'gd') return '';
  const n = st.picked.size;
  return `<span class="fx-dest-at">${n ? `${n}개 선택` : '되살릴 파일을 선택하세요'}</span>`
    + (st.next ? `<button type="button" class="fx-btn" data-fx-trash-more${st.loading ? ' disabled' : ''}>더 보기</button>` : '')
    + `<button type="button" class="fx-btn fx-pri" data-fx-trash-restore${n && !st.busy ? '' : ' disabled'}>되살리기</button>`;
}
function paintFoot() { const f = box?.querySelector('.fx-dest-f'); if (f) f.innerHTML = footHtml(); }
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
    : st.items.length ? st.items.map(rowHtml).join('') : emptyHtml('휴지통이 비어 있어요');
  box.innerHTML = head + `<p class="fx-dest-note">${esc(GD_TRASH_NOTE)}</p><div class="fx-dest-tree fx-trash-list" role="group" aria-label="휴지통 파일">${list}</div>`
    + `<div class="fx-dest-f">${footHtml()}</div>`;
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
async function restore() {
  const s = st;
  if (!s || s.busy || !s.picked.size) return;
  const ids = [...s.picked];
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
    for (const id of back) s.picked.delete(id);
    try { await s.onRestored?.(d); } catch { /* 목록 다시 그리기 실패는 다음 맞추기가 고친다 */ }
    notify(`${back.size}개를 되살렸어요${bad + left ? ` · ${bad + left}개는 못 했어요` : ''} · 원래 폴더에 있어요`, {error: !!(bad + left), record: false});
  } else if (d) notify('되살리지 못했어요. 휴지통에서 이미 빠졌을 수 있어요.', {error: true, record: false});
  paint();
}
function onClick(e) {
  const b = e.target.closest?.('button,a');
  if (!b || !st) return;
  if (b.disabled) return;
  if (b.matches('[data-fx-trash-close]')) { close(); return; }
  if (b.matches('[data-fx-trash-retry]')) { void load(); return; }
  if (b.matches('[data-fx-trash-more]')) { void load(true); return; }
  if (b.matches('[data-fx-trash-restore]')) { void restore(); return; }
  if (b.matches('[data-fx-trash-odfolder]')) { const s = st; close({keepFocus: true}); s.openFolder?.(s.odPhotoTrash); }
}

// 창 열기. source: 'gd' | 'od', anchor: 누른 줄(닫을 때 초점), onRestored(d): 되살린 뒤 [파일] 목록을 다시 그리기, errorText(error): 오류 글,
// odPhotoTrash: 원드라이브 맨 위 '.WORK ON+ 휴지통' 폴더 id(있으면 [그 폴더 열기]), openFolder(id): 그 폴더 열기.
export function openCloudTrash({source, anchor = null, onRestored = null, errorText = null, odPhotoTrash = null, openFolder = null}) {
  if (source !== 'gd' && source !== 'od') return;
  if (st) close({silent: true});
  ensure();
  st = {source, anchor, onRestored, errorText, odPhotoTrash, openFolder, items: null, next: null, picked: new Set(), busy: false, loading: false, failed: '', web: null};
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
  st = null;
  if (box) { try { box.close(); } catch { box.removeAttribute('open'); } box.innerHTML = ''; }
  const l = layer; layer = null;
  if (!fromBack) l?.close?.();
  if (!keepFocus && s.anchor?.isConnected) s.anchor.focus?.({preventScroll: true});
}
