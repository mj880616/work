// S68-09 READ-읽을거리함: 읽을 거리 서버 읽기·쓰기 한 곳(화면 reading.js·폰 공유 받기 basket-share.js가 함께 쓴다). DOM 없음.
// - 표 public.app_reading_items(DB 20261122100000): 작업공간 주인만(RLS). 넣기는 주소·제목·사이트·사업영역, 고치기는 제목·사이트·읽음·사업영역·원문 사본.
// - 원문 받아 오기(News에서 온 줄은 News 쪽 본문이 있으면 그것 먼저 — S68-32): 기존 Edge note-import(노트 '주소로 가져오기'와 같은 입구, 읽기 전용·로그인 owner만·내부 주소 차단·크기/시간/리다이렉트/robots 검사)에
//   주소 하나만 보낸다. 답의 글자 블록을 글자로만 원문 사본 칸에 넣는다(HTML 없음). AI·발송·공유로 잇지 않는다.
// - 한 번에 하나씩 차례로 받는다(같은 줄은 한 번). 바뀌면 'kptu:reading-changed'. 기기에 아무것도 저장하지 않는다(메모리뿐).
import {LIST_COLS, LIST_LIMIT, newRow, bodyPatch, keepOwn, isId, linkOf, copyPatch} from './reading-model.mjs';
import {requestFailReason} from './note-import-model.mjs';

export const CHANGED = 'kptu:reading-changed';
const FN = '/functions/v1/note-import';
const REQUEST_TIMEOUT_MS = 40000;
const T = '/rest/v1/app_reading_items';
const rt = () => window.KPTURuntime;
const ws = () => rt()?.context?.read?.()?.workspace?.id || '';
const me = () => rt()?.session?.read?.()?.user?.id || '';
const enc = encodeURIComponent;
const api = (path, opts = {}) => rt().api(path, {refreshSession: false, singleFlight: false, ...opts});
const first = v => (Array.isArray(v) ? v[0] : v) || null;
const emit = detail => { try { window.dispatchEvent(new CustomEvent(CHANGED, {detail})); } catch { /* 듣는 화면이 일을 막지 않는다 */ } };

export async function listItems() {
  const w = ws();
  if (!w) return [];
  const rows = await api(`${T}?workspace_id=eq.${enc(w)}&select=${LIST_COLS}&order=saved_at.desc&limit=${LIST_LIMIT}`);
  return Array.isArray(rows) ? rows : [];
}
export async function getItem(id) {
  if (!isId(id) || !ws()) return null;
  return first(await api(`${T}?id=eq.${enc(id)}&workspace_id=eq.${enc(ws())}&select=${LIST_COLS},body&limit=1`));
}
async function byUrl(url) {
  return first(await api(`${T}?workspace_id=eq.${enc(ws())}&url=eq.${enc(url)}&select=${LIST_COLS}&limit=1`));
}
// 넣기. 같은 주소가 이미 있으면 그 줄을 돌려준다({row, dup:true}).
export async function addItem(url, title = '') {
  const w = ws();
  if (!w) throw Object.assign(new Error('login'), {code: 'session_required'});
  try {
    const row = first(await api(T, {method: 'POST', prefer: 'return=representation', body: {workspace_id: w, ...newRow(url, title)}}));
    if (!row?.id) throw new Error('shape');
    emit({id: row.id, kind: 'add'});
    return {row, dup: false};
  } catch (e) {
    if (Number(e?.status) === 409 || /23505|duplicate/i.test(`${e?.code || ''} ${e?.message || ''}`)) {
      const row = await byUrl(url);
      if (row) return {row, dup: true};
    }
    throw e;
  }
}
export async function patchItem(id, body) {
  const row = first(await api(`${T}?id=eq.${enc(id)}&workspace_id=eq.${enc(ws())}&select=${LIST_COLS}`, {method: 'PATCH', prefer: 'return=representation', body: {...body, updated_at: new Date().toISOString()}}));
  if (!row?.id) throw Object.assign(new Error('gone'), {code: 'gone'});
  emit({id, kind: 'patch'});
  return row;
}
export async function removeItem(id) {
  await api(`${T}?id=eq.${enc(id)}&workspace_id=eq.${enc(ws())}`, {method: 'DELETE'});
  emit({id, kind: 'delete'});
}
export const setRead = (id, read) => patchItem(id, {read_at: read ? new Date().toISOString() : null});
export const setArea = (id, areaId) => patchItem(id, {business_area_id: areaId || null});

// ---- 원문 받아 오기(차례로 하나씩) ----
// S68-32: News에서 온 줄(원래 글 연결 칸)은 먼저 News 쪽 본문(공용 본문 표 — News 화면과 같은 읽기 길 feed-shared.js readBody·readSentences)을 본다.
// 이미 채워져 있으면 그 본문을 사본으로 넣고 끝(note-import 하루 횟수를 쓰지 않음). 없거나 못 읽으면 원래 글 주소로 note-import(기존 길).
async function newsCopy(row) {
  const link = linkOf(row);
  if (!link) return null;
  try {
    const {readBody, readSentences} = await import('./feed-shared.js');
    const got = await readBody(link).catch(() => null);
    let patch = copyPatch(got, null);
    if (!patch && link.type === 'outside') patch = copyPatch(null, await readSentences(link.id).catch(() => null));
    return patch;
  } catch { return null; }
}
const running = new Map(); // id → promise
let chain = Promise.resolve();
export const fetching = id => running.has(id);
// row: {id, url, title, site}. 끝나면 {state:'ok'|'failed', row} 또는 요청 실패 {state:'request', reason}.
export function fetchBody(row) {
  if (!isId(row?.id) || !row?.url) return Promise.resolve({state: 'skipped'});
  if (running.has(row.id)) return running.get(row.id);
  const owner = me();
  const job = chain.then(async () => {
    if (me() !== owner) return {state: 'skipped'};
    emit({id: row.id, kind: 'fetching'});
    const copy = await newsCopy(row);
    if (me() !== owner) return {state: 'skipped'};
    if (copy) {
      try { const saved = await patchItem(row.id, copy); return {state: 'ok', row: saved}; }
      catch (e) { return {state: 'request', reason: e?.code === 'gone' ? 'gone' : requestFailReason(e)}; }
    }
    let result;
    try { result = await rt().api(FN, {method: 'POST', body: {url: row.url}, singleFlight: false, timeoutMs: REQUEST_TIMEOUT_MS}); }
    catch (e) { return {state: 'request', reason: requestFailReason(e)}; }
    if (me() !== owner) return {state: 'skipped'};
    try {
      const saved = await patchItem(row.id, keepOwn(row, bodyPatch(result)));
      return {state: saved.body_state === 'ok' || saved.body_state === 'paywall' ? 'ok' : 'failed', row: saved};
    } catch (e) { return {state: 'request', reason: e?.code === 'gone' ? 'gone' : requestFailReason(e)}; }
  }).finally(() => { running.delete(row.id); emit({id: row.id, kind: 'fetched'}); });
  chain = job.catch(() => {});
  running.set(row.id, job);
  return job;
}
window.addEventListener('kptu:session-changed', () => { running.clear(); chain = Promise.resolve(); });

// ---- 폰 공유 창 '읽을 거리'(basket-share.js가 부름) ----
// 주소 하나를 읽을 거리에 넣고(같은 주소면 그 줄), 원문은 뒤에서 받는다. 창 없이 위쪽 작은 알림: '읽을 거리에 넣었어요 [열기]'.
// 발송·공유·삭제로 이어지는 흐름은 없다. 기기 저장 없음.
export const SHARE_NOTE = Object.freeze({busy: '저장한 글에 넣는 중…', done: '저장한 글에 넣었어요', dup: '이미 저장한 글에 있어요', open: '열기',
  noUrl: '읽을 글 주소가 없어요', toBasket: '잊지 말기로 넣기', fail: '저장한 글에 넣지 못했어요', retry: '다시'});
export async function saveSharedReading(url, {title = '', isCurrent = () => true, notify} = {}) {
  const working = notify(SHARE_NOTE.busy, {ms: 60000, record: false});
  let out = null;
  try { out = await addItem(url, title); }
  catch { out = null; }
  working.close();
  if (!isCurrent()) return null;
  if (!out?.row?.id) {
    notify(SHARE_NOTE.fail, {error: true, ms: 20000, actions: [{label: SHARE_NOTE.retry, run: ({close}) => { close(); void saveSharedReading(url, {title, isCurrent, notify}); }}]});
    return null;
  }
  const id = out.row.id;
  notify(out.dup ? SHARE_NOTE.dup : SHARE_NOTE.done, {ms: 6000,
    actions: [{label: SHARE_NOTE.open, run: ({close}) => { close(); window.KPTUReadingOpen = {id}; window.KPTURouter?.go?.('reading', {source: 'delegated'}); }}]});
  window.KPTUReading?.refresh?.();
  if (!out.dup && out.row.body_state === 'pending') void fetchBody(out.row).then(() => window.KPTUReading?.refresh?.());
  return id;
}
