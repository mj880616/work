// S48-60 PHOTO-정보고치기(요청함 11/03 00:29, 명진 결정 E1·E2): 사진 ⋯ [정보 고치기…] 창 하나(고른 사진 모두, 아니면 그 한 장).
// - 고칠 칸은 찍은 날·시각과 위치 둘만(카메라·렌즈는 보기만). 방법 하나를 고른다: 시각 밀기 · 이 날짜로 · 이 장소로 · 위치 지우기.
// - 저장 전 '앞 → 뒤' 미리 보기 표. [저장] = 폰 앱(0.4.15+)이 수정 허락 창 한 번 뒤 파일 EXIF + 사진첩 목록 DATE_TAKEN을 고친다(갤러리 순서도 바뀐다).
// - 고치기 전 값은 서버 표 app_photo_info_edits(작업공간 주인만)에 적고, 알림 [되돌리기]·창 맨 아래 '지난번 고친 n장 [되돌리기]'로 묶음 통째 되돌린다.
//   표가 아직 없으면(DB 적용 전) 고치기는 하고 '이번 화면에서만 되돌릴 수 있어요'.
// - 원드라이브·구글 드라이브 사진은 이번 판에서 빼고 알린다(다음 단계: 원본 새 판 올리기, docs/design/photo-info-edit.md 5절).
// 계산은 photo-info-model.mjs. 사진·EXIF는 서버로 보내지 않는다(서버에는 시각·위치 앞뒤 값만).
import {INFO_MAX, infoRows, cameraLine, planRows, writeItems, undoItems, recordRows, writeErrorText, doneText, takenText, placeText, parsePlace,
  localValue, fromLocalValue, shiftMs} from './photo-info-model.mjs';
import {notify} from './small-notice.js';
import {waitInlineHtml} from './wait-state.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const TABLE = '/rest/v1/app_photo_info_edits';
let dialog = null, state = null, seq = 0, layer = null;
const $ = sel => dialog.querySelector(sel);

function workspaceOf(rt) { return rt?.context?.read?.()?.workspace?.id || ''; }
const uuid = () => (globalThis.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)));

function ensureDialog() {
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'photoInfoDialog'; dialog.className = 'photo-info-dialog'; dialog.setAttribute('aria-labelledby', 'photoInfoTitle');
  dialog.innerHTML = `<header class="pi-head"><h2 id="photoInfoTitle">정보 고치기 <span data-pi-count></span></h2><button type="button" class="icon-btn" data-pi-close aria-label="닫기">×</button></header>
<div class="pi-body"><p class="pi-cam" data-pi-cam></p>
<fieldset class="pi-how" data-pi-how><legend class="sr-only">고치는 방법</legend>
<label class="pi-opt"><input type="radio" name="piHow" value="shift" checked> 모두 <select data-pi-sign aria-label="앞으로 또는 뒤로"><option value="-1">−</option><option value="1">+</option></select>
<input type="number" inputmode="numeric" min="0" max="87840" value="0" data-pi-h aria-label="시간"> 시간 <input type="number" inputmode="numeric" min="0" max="59" value="0" data-pi-m aria-label="분"> 분 밀기</label>
<label class="pi-opt"><input type="radio" name="piHow" value="date"> 모두 이 날짜로 <input type="datetime-local" data-pi-date aria-label="찍은 날·시각"></label>
<label class="pi-opt"><input type="radio" name="piHow" value="place"> 모두 이 장소로 <input type="text" data-pi-place placeholder="위도, 경도 또는 지도 주소" aria-label="장소(위도, 경도)" autocomplete="off"> <a data-pi-map target="_blank" rel="noopener noreferrer" hidden>지도</a></label>
<label class="pi-opt"><input type="radio" name="piHow" value="clear"> 위치 지우기</label>
</fieldset>
<div class="pi-table-wrap"><table class="pi-table"><thead><tr><th scope="col">사진</th><th scope="col">앞</th><th scope="col">뒤</th></tr></thead><tbody data-pi-rows></tbody></table></div>
<p class="pi-last" data-pi-last hidden></p></div>
<footer class="pi-foot"><p class="status" data-pi-status role="status" aria-live="polite"></p><button type="button" class="primary" data-pi-save disabled>저장</button></footer>`;
  document.body.append(dialog);
  dialog.addEventListener('cancel', e => { e.preventDefault(); if (!state?.saving) close(); });
  dialog.addEventListener('click', e => {
    if (e.target === dialog || e.target.closest('[data-pi-close]')) { if (!state?.saving) close(); return; }
    if (e.target.closest('[data-pi-save]')) return void save();
    if (e.target.closest('[data-pi-undo]')) return void undoLast();
  });
  dialog.addEventListener('input', e => {
    // 칸을 고치면 그 방법을 고른 것으로 본다.
    const opt = e.target.closest?.('.pi-opt')?.querySelector('input[type=radio]');
    if (opt && e.target !== opt) opt.checked = true;
    paint();
  });
  dialog.addEventListener('change', () => paint());
  return dialog;
}
const say = (text, error = false) => { const el = $('[data-pi-status]'); el.textContent = text || ''; el.className = 'status' + (error ? ' error' : ''); };
function close() {
  const l = layer; layer = null; l?.close();
  if (dialog?.open) dialog.close();
  const t = state?.trigger; state = null;
  if (t?.isConnected) t.focus({preventScroll: true});
}
function how() {
  const kind = dialog.querySelector('input[name=piHow]:checked')?.value || 'shift';
  if (kind === 'shift') return {kind, ms: shiftMs({sign: Number($('[data-pi-sign]').value), hours: $('[data-pi-h]').value, minutes: $('[data-pi-m]').value})};
  if (kind === 'date') return {kind, ms: fromLocalValue($('[data-pi-date]').value)};
  if (kind === 'place') return {kind, loc: parsePlace($('[data-pi-place]').value)};
  return {kind};
}
const cell = (taken, loc) => `${esc(takenText(taken))}${loc ? `<br><small>${esc(placeText(loc))}</small>` : ''}`;
function paint() {
  if (!state?.rows) return;
  const h = how();
  const map = $('[data-pi-map]');
  if (h.kind === 'place' && h.loc) { map.hidden = false; map.href = `https://www.google.com/maps?q=${h.loc.lat},${h.loc.lon}`; } else map.hidden = true;
  state.plan = planRows(state.rows, h);
  $('[data-pi-rows]').innerHTML = state.plan.map(r => `<tr${r.changed ? ' class="pi-changed"' : ''}><th scope="row">${esc(r.name || '사진')}</th><td>${cell(r.taken, r.loc)}</td><td>${r.can && !r.why ? (r.changed ? cell(r.after.taken, r.after.loc) : '그대로') : `<span class="pi-no">${esc(r.why || '못 고침')}</span>`}</td></tr>`).join('');
  const n = state.plan.filter(r => r.changed).length;
  $('[data-pi-save]').disabled = !n || state.saving;
  if (!state.saving) say(n ? `${n}장을 고쳐요` : '바꿀 값을 넣어 주세요');
}

// ---- 서버 기록(되돌리기) ----
async function saveRecords(rt, rows) {
  if (!rows.length) return 'none';
  try { await rt.api(TABLE, {method: 'POST', prefer: 'return=minimal', body: rows}); return 'ok'; }
  catch { return 'failed'; }
}
async function lastBatch(rt) {
  const ws = workspaceOf(rt); if (!ws) return null;
  try {
    const rows = await rt.api(`${TABLE}?workspace_id=eq.${encodeURIComponent(ws)}&undone_at=is.null&select=batch_id,item_key,before_taken,after_taken,loc_changed,before_lat,before_lon,created_at&order=created_at.desc&limit=${INFO_MAX}`);
    if (!Array.isArray(rows) || !rows.length) return null;
    const id = rows[0].batch_id;
    return {batchId: id, records: rows.filter(r => r.batch_id === id), at: rows[0].created_at};
  } catch { return null; }
}
async function markUndone(rt, batchId, keys) {
  const ws = workspaceOf(rt); if (!ws || !batchId || !keys.length) return;
  const list = `(${keys.map(k => `"${String(k).replace(/["\\]/g, '')}"`).join(',')})`;
  try { await rt.api(`${TABLE}?workspace_id=eq.${encodeURIComponent(ws)}&batch_id=eq.${encodeURIComponent(batchId)}&item_key=in.${encodeURIComponent(list)}`, {method: 'PATCH', prefer: 'return=minimal', body: {undone_at: new Date().toISOString()}}); }
  catch { /* 기록 표시만 못 함 — 사진은 이미 되돌렸다 */ }
}
// 묶음 되돌리기: 앞 값으로 다시 고친다(같은 허락 창). 성공한 것만 되돌린 표시.
export async function undoBatch({phone, rt, batchId, records, onDone}) {
  const items = undoItems(records);
  if (!items.length) return {status: 'ok'};
  const res = await phone.metaWrite(items);
  if (!res.ok) { notify(`되돌리지 못했어요: ${writeErrorText(res.error)}`, {error: true}); return {silent: true}; }
  const bad = new Set(res.failed);
  if (batchId) await markUndone(rt, batchId, items.filter(x => !bad.has(x.id)).map(x => `ms:${x.id}`));
  onDone?.();
  notify(doneText(res, '되돌렸어요'), {error: res.failed.length > 0, record: false});
  return {silent: true};
}
async function undoLast() {
  const s = state; if (!s?.last || s.saving) return;
  const {phone, rt, onDone} = s, last = s.last;
  close();
  await undoBatch({phone, rt, batchId: last.batchId, records: last.records, onDone});
}
async function paintLast() {
  const s = state; if (!s) return;
  const last = await lastBatch(s.rt);
  if (s !== state) return;
  s.last = last;
  const el = $('[data-pi-last]');
  if (!last) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false;
  el.innerHTML = `지난번 고친 ${last.records.length}장 · <button type="button" class="mini" data-pi-undo>되돌리기</button>`;
}

async function save() {
  const s = state; if (!s || s.saving || !s.plan) return;
  const items = writeItems(s.plan);
  if (!items.length) return;
  s.saving = true; $('[data-pi-save]').disabled = true; say('폰에서 허락을 눌러 주세요…');
  const res = await s.phone.metaWrite(items);
  if (s !== state) return;
  s.saving = false;
  if (!res.ok) { say(writeErrorText(res.error), true); paint(); return; }
  const batchId = uuid(), plan = s.plan;
  const rows = recordRows(plan, {workspaceId: workspaceOf(s.rt), batchId, failed: res.failed});
  const kept = workspaceOf(s.rt) ? await saveRecords(s.rt, rows) : 'failed';
  const {phone, rt, onDone} = s;
  close();
  onDone?.();
  // 되돌리기: 서버 기록이 있으면 그 묶음, 없으면 이 화면 메모리의 앞 값으로.
  const records = rows;
  notify(doneText(res) + (kept === 'ok' ? '' : ' · 이번 화면에서만 되돌릴 수 있어요'), {
    label: `사진 정보 고치기 ${rows.length}장`, error: res.failed.length > 0, ms: 8000,
    undo: () => undoBatch({phone, rt, batchId: kept === 'ok' ? batchId : '', records, onDone}),
  });
}

// trigger: 누른 버튼(닫힌 뒤 초점). items: 고른 사진(화면 항목). phone: phonePhotos(). rt: KPTURuntime. onDone(): 고친 뒤 목록 다시 읽기.
export async function openPhotoInfo(trigger, items, {phone, rt = window.KPTURuntime, onDone = null} = {}) {
  if (!phone?.canMeta?.()) { notify('사진 정보를 고치려면 폰 앱 새 판(0.4.15)이 필요해요.'); return; }
  const phoneItems = (items || []).filter(it => it?.kind === 'phone' && it.phoneId);
  if (phoneItems.length < (items || []).length) notify('폰 사진만 고쳐요(원드라이브·구글 드라이브 사진은 다음 판).');
  if (!phoneItems.length) return;
  if (phoneItems.length > INFO_MAX) notify(`한 번에 ${INFO_MAX}장까지 고쳐요. 앞 ${INFO_MAX}장만 열어요.`);
  ensureDialog();
  const list = phoneItems.slice(0, INFO_MAX);
  state = {trigger, phone, rt, onDone, run: ++seq, saving: false, rows: null, plan: null, last: null};
  $('[data-pi-count]').textContent = `${list.length}장`;
  $('[data-pi-cam]').textContent = '';
  $('[data-pi-rows]').innerHTML = `<tr><td colspan="3">${waitInlineHtml()}</td></tr>`;
  $('[data-pi-h]').value = '0'; $('[data-pi-m]').value = '0'; $('[data-pi-place]').value = '';
  dialog.querySelector('input[name=piHow][value=shift]').checked = true;
  $('[data-pi-save]').disabled = true; say('');
  if (!dialog.open) dialog.showModal();
  if (!layer) layer = window.KPTURouter?.layer?.open('photo-info', {close: () => { if (state?.saving) return false; layer = null; close(); return true; }}) || null;
  void paintLast();
  const run = state.run;
  const r = await phone.metaRead(list.map(it => it.phoneId));
  if (!state || state.run !== run) return;
  if (!r.ok) { $('[data-pi-rows]').innerHTML = ''; say(r.error === 'none' ? '사진 접근 허용이 없어요' : '사진 정보를 읽지 못했어요', true); return; }
  state.rows = infoRows(list, new Map(r.items.map(x => [x.id, x])));
  $('[data-pi-cam]').textContent = cameraLine(state.rows);
  const first = state.rows.find(x => Number.isFinite(x.taken));
  $('[data-pi-date]').value = first ? localValue(first.taken) : '';
  const loc = state.rows.find(x => x.loc)?.loc;
  $('[data-pi-place]').placeholder = loc ? placeText(loc) : '위도, 경도 또는 지도 주소';
  paint();
}
