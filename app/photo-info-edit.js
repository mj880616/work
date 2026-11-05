// S48-60 PHOTO-정보고치기(요청함 11/03 00:29, 명진 결정 E1·E2): 사진 ⋯ [정보 고치기…] 창 하나(고른 사진 모두, 아니면 그 한 장).
// - 고칠 칸은 찍은 날·시각과 위치 둘만(카메라·렌즈는 보기만). 방법 하나를 고른다: 시각 밀기 · 이 날짜로 · 이 장소로 · 위치 지우기.
// - 저장 전 '앞 → 뒤' 미리 보기 표. [저장] = 폰 앱(0.4.15+)이 수정 허락 창 한 번 뒤 파일 EXIF + 사진첩 목록 DATE_TAKEN을 고친다(갤러리 순서도 바뀐다).
// - 고치기 전 값은 서버 표 app_photo_info_edits(작업공간 주인만)에 적고, 알림 [되돌리기]·창 맨 아래 '지난번 고친 n장 [되돌리기]'로 묶음 통째 되돌린다.
//   표가 아직 없으면(DB 적용 전) 고치기는 하고 '이번 화면에서만 되돌릴 수 있어요'.
// - S50-31 ②(명진 결정 E3 (가)·E4·E5): 원드라이브·구글 드라이브 사진(JPEG)도 같은 창에서 고친다. 서버(Edge photos-meta-read/write)가 원본을
//   메모리로만 받아 정보 칸만 바꾸고 같은 파일의 새 판으로 올린다. 섞어 고르면 저장 때 출처별로 나눠 보낸다(폰 = 앱, 클라우드 = 서버).
//   PC(폰 앱 없음)에서도 클라우드 사진은 고칠 수 있다(폰 사진은 '폰 앱에서만'으로 빠짐). 옛 판은 원드라이브·드라이브 '판 기록'에도 남는다.
// 계산은 photo-info-model.mjs. 폰 사진·EXIF는 서버로 보내지 않는다(서버에는 시각·위치 앞뒤 값만).
import {INFO_MAX, infoRows, cameraLine, planRows, writeItems, undoItems, recordRows, writeErrorText, doneText, takenText, placeText, parsePlace,
  localValue, fromLocalValue, shiftMs, sourceOf, cloudInfo, cloudWhyText, cloudWriteItems, splitBySource, chunked} from './photo-info-model.mjs';
import {notify} from './small-notice.js';
import {waitInlineHtml} from './wait-state.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const TABLE = '/rest/v1/app_photo_info_edits';
// 서버 함수(출처별). 한 번 부를 때 읽기 10장·고치기 4장(원본을 받고 올리므로 오래 기다리지 않게 작게).
const CLOUD_FN = {onedrive: '/functions/v1/onedrive-photos', gdrive: '/functions/v1/gdrive-photos'};
const READ_STEP = 10, WRITE_STEP = 4, CLOUD_TIMEOUT_MS = 150000;
const cloudCall = (rt, src, body) => rt.api(CLOUD_FN[src], {method: 'POST', body, singleFlight: false, timeoutMs: CLOUD_TIMEOUT_MS});
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
<p class="pi-last" data-pi-cloud hidden>원드라이브·구글 드라이브 사진은 파일의 새 판으로 올라가요. 옛 판은 각 서비스의 '판 기록'에도 남아요.</p>
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
// 클라우드 고치기(출처 하나, 여러 번 나눠 부름). 답: {ok, done:[{id, before, after}], failed:[id], error}.
async function cloudWrite(rt, src, items) {
  const done = [], failed = [];
  let error = '';
  for (const part of chunked(items, WRITE_STEP)) {
    try {
      const r = await cloudCall(rt, src, {action: 'photos-meta-write', confirm: true, items: cloudWriteItems(part)});
      for (const d of Array.isArray(r?.done) ? r.done : []) done.push(d);
      const bad = r?.failed && typeof r.failed === 'object' ? r.failed : {};
      for (const o of part) if (!done.some(d => d.id === o.id)) { failed.push(o.id); error ||= cloudWhyText(bad[o.id]); }
    } catch {
      for (const o of part) failed.push(o.id);
      error ||= '서버에 닿지 못했어요';
    }
  }
  return {ok: true, count: done.length, done, failed, error};
}
// 출처별로 나눠 고친다. phone이 없으면(PC) 폰 몫은 못 고친 것으로. 답: {count, failed:[열쇠], phoneError}.
async function writeAll({phone, rt}, items) {
  const parts = splitBySource(items);
  let count = 0, phoneError = '';
  const failed = [];
  if (parts.phone.length) {
    const res = phone?.canMeta?.() ? await phone.metaWrite(parts.phone) : {ok: false, error: 'old'};
    if (!res.ok) { phoneError = writeErrorText(res.error); for (const o of parts.phone) failed.push(`ms:${o.id}`); }
    else { count += res.count ?? (parts.phone.length - res.failed.length); for (const id of res.failed) failed.push(`ms:${id}`); }
  }
  let cloudError = '';
  for (const src of ['onedrive', 'gdrive']) {
    if (!parts[src].length) continue;
    const res = await cloudWrite(rt, src, parts[src]);
    count += res.count;
    cloudError ||= res.error;
    for (const id of res.failed) failed.push(`${src === 'onedrive' ? 'od' : 'gd'}:${id}`);
  }
  return {count, failed, phoneError, cloudError};
}
const doneLine = (res, verb) => doneText({count: res.count, failed: res.failed}, verb) + (res.failed.length && (res.phoneError || res.cloudError) ? ` (${res.phoneError || res.cloudError})` : '');
// 묶음 되돌리기: 앞 값으로 다시 고친다(폰은 같은 허락 창, 클라우드는 또 하나의 새 판). 성공한 것만 되돌린 표시.
export async function undoBatch({phone, rt, batchId, records, onDone}) {
  const items = undoItems(records);
  if (!items.length) return {status: 'ok'};
  const res = await writeAll({phone, rt}, items);
  if (!res.count && res.failed.length) { notify(`되돌리지 못했어요: ${res.phoneError || res.cloudError || '고치지 못했어요'}`, {error: true}); return {silent: true}; }
  const bad = new Set(res.failed);
  const keyOf = o => (o.src === 'onedrive' ? `od:${o.id}` : o.src === 'gdrive' ? `gd:${o.id}` : `ms:${o.id}`);
  if (batchId) await markUndone(rt, batchId, items.map(keyOf).filter(k => !bad.has(k)));
  onDone?.();
  notify(doneLine(res, '되돌렸어요'), {error: res.failed.length > 0, record: false});
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
  const hasPhone = items.some(o => !o.src);
  s.saving = true; $('[data-pi-save]').disabled = true; say(hasPhone ? '폰에서 허락을 눌러 주세요…' : '고치는 중이에요…');
  const res = await writeAll(s, items);
  if (s !== state) return;
  s.saving = false;
  if (!res.count) { say(res.phoneError || res.cloudError || '고치지 못했어요', true); paint(); return; }
  const batchId = uuid(), plan = s.plan;
  const rows = recordRows(plan, {workspaceId: workspaceOf(s.rt), batchId, failed: res.failed});
  const kept = workspaceOf(s.rt) ? await saveRecords(s.rt, rows) : 'failed';
  const {phone, rt, onDone} = s;
  close();
  onDone?.();
  // 되돌리기: 서버 기록이 있으면 그 묶음, 없으면 이 화면 메모리의 앞 값으로.
  const records = rows;
  notify(doneLine(res) + (kept === 'ok' ? '' : ' · 이번 화면에서만 되돌릴 수 있어요'), {
    label: `사진 정보 고치기 ${rows.length}장`, error: res.failed.length > 0, ms: 8000,
    undo: () => undoBatch({phone, rt, batchId: kept === 'ok' ? batchId : '', records, onDone}),
  });
}

// 읽기: 폰(앱 다리)·클라우드(서버, 10장씩). 답: Map(열쇠 → 정보). 폰을 못 읽으면 phoneError.
async function readAll({phone, rt}, list) {
  const info = new Map();
  let phoneError = '';
  const by = {phone: [], onedrive: [], gdrive: []};
  for (const it of list) { const s = sourceOf(it); if (s) by[s.src].push(s); }
  if (by.phone.length && phone?.canMeta?.()) {
    const r = await phone.metaRead(by.phone.map(x => x.id));
    if (r.ok) for (const x of r.items) info.set(`ms:${x.id}`, x);
    else phoneError = r.error === 'none' ? '사진 접근 허용이 없어요' : '사진 정보를 읽지 못했어요';
  }
  for (const src of ['onedrive', 'gdrive']) {
    for (const part of chunked(by[src], READ_STEP)) {
      try {
        const r = await cloudCall(rt, src, {action: 'photos-meta-read', ids: part.map(x => x.id)});
        for (const x of Array.isArray(r?.items) ? r.items : []) { const v = cloudInfo(x); if (v) info.set(`${src === 'onedrive' ? 'od' : 'gd'}:${x.id}`, v); }
      } catch { /* 그 사진들은 '못 찾음'으로 빠진다 */ }
    }
  }
  return {info, phoneError};
}

// trigger: 누른 버튼(닫힌 뒤 초점). items: 고른 사진(화면 항목). phone: phonePhotos(). rt: KPTURuntime. onDone(): 고친 뒤 목록 다시 읽기.
// 고칠 수 있는 출처: 폰(앱 0.4.15+), 원드라이브, 구글 드라이브. 그 밖의 사진만 골랐으면 열지 않는다.
export async function openPhotoInfo(trigger, items, {phone, rt = window.KPTURuntime, onDone = null} = {}) {
  const all = (items || []).filter(it => sourceOf(it));
  const canPhone = !!phone?.canMeta?.();
  const usable = all.filter(it => it.kind !== 'phone' || canPhone);
  if (!usable.length) { notify(all.length ? '폰 사진 정보는 폰 앱 새 판(0.4.15)에서 고쳐요.' : '이 사진은 정보를 고칠 수 없어요.'); return; }
  if (all.length > INFO_MAX) notify(`한 번에 ${INFO_MAX}장까지 고쳐요. 앞 ${INFO_MAX}장만 열어요.`);
  ensureDialog();
  const list = all.slice(0, INFO_MAX);
  state = {trigger, phone, rt, onDone, run: ++seq, saving: false, rows: null, plan: null, last: null};
  $('[data-pi-count]').textContent = `${list.length}장`;
  $('[data-pi-cam]').textContent = '';
  $('[data-pi-cloud]').hidden = !list.some(it => it.kind !== 'phone');
  $('[data-pi-rows]').innerHTML = `<tr><td colspan="3">${waitInlineHtml()}</td></tr>`;
  $('[data-pi-h]').value = '0'; $('[data-pi-m]').value = '0'; $('[data-pi-place]').value = '';
  dialog.querySelector('input[name=piHow][value=shift]').checked = true;
  $('[data-pi-save]').disabled = true; say('');
  if (!dialog.open) dialog.showModal();
  if (!layer) layer = window.KPTURouter?.layer?.open('photo-info', {close: () => { if (state?.saving) return false; layer = null; close(); return true; }}) || null;
  void paintLast();
  const run = state.run;
  const r = await readAll(state, list);
  if (!state || state.run !== run) return;
  state.rows = infoRows(list, r.info, {noPhone: canPhone ? '' : '폰 앱에서만'});
  if (!state.rows.some(x => x.can)) { paint(); say(r.phoneError || '고칠 수 있는 사진이 없어요', true); return; }
  $('[data-pi-cam]').textContent = cameraLine(state.rows);
  const first = state.rows.find(x => Number.isFinite(x.taken));
  $('[data-pi-date]').value = first ? localValue(first.taken) : '';
  const loc = state.rows.find(x => x.loc)?.loc;
  $('[data-pi-place]').placeholder = loc ? placeText(loc) : '위도, 경도 또는 지도 주소';
  paint();
  if (r.phoneError) say(r.phoneError, true);
}
