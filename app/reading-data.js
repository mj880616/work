// S68-09 READ-읽을거리함: 읽을 거리 서버 읽기·쓰기 한 곳(화면 reading.js·폰 공유 받기 basket-share.js가 함께 쓴다). DOM 없음.
// - 표 public.app_reading_items(DB 20261122100000): 작업공간 주인만(RLS). 넣기는 주소·제목·사이트·사업영역, 고치기는 제목·사이트·읽음·사업영역·원문 사본.
// - 원문 받아 오기(News에서 온 줄은 News 쪽 본문이 있으면 그것 먼저 — S68-32): 기존 Edge note-import(노트 '주소로 가져오기'와 같은 입구, 읽기 전용·로그인 owner만·내부 주소 차단·크기/시간/리다이렉트/robots 검사)에
//   주소 하나만 보낸다. 답의 글자 블록을 글자로만 원문 사본 칸에 넣는다(HTML 없음). AI·발송·공유로 잇지 않는다.
// - 한 번에 하나씩 차례로 받는다(같은 줄은 한 번). 바뀌면 'kptu:reading-changed'. 기기에 아무것도 저장하지 않는다(메모리뿐).
import {LIST_COLS, LIST_LIMIT, newRow, bodyPatch, keepOwn, isId, linkOf, copyPatch, titleFixes, ownTitle} from './reading-model.mjs';
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

// S70-83 READ-저장한글폴더: 목록은 폴더 칸(folder_id, DB 20261126123000)까지 읽는다. 그 칸이 아직 없는 서버(DB 적용 전)면 칸 이름 때문에
// 거절(400/42703)되므로 칸 없이 다시 읽고 folderColumn()이 false — 화면은 모든 글을 '폴더 없음'으로 보이고 폴더 만들기·옮기기를 두지 않는다.
let folderCol = null;
export const folderColumn = () => folderCol;
const colMissing = (e, col) => new RegExp(`(^|\\D)400(\\D|$)|42703|PGRST204|${col}`).test(`${e?.status || ''} ${e?.code || ''} ${e?.message || ''}`);
export async function listItems() {
  const w = ws();
  if (!w) return [];
  const url = cols => `${T}?workspace_id=eq.${enc(w)}&select=${cols}&order=saved_at.desc&limit=${LIST_LIMIT}`;
  let rows;
  if (folderCol !== false) {
    try { rows = await api(url(LIST_COLS + ',folder_id')); folderCol = true; }
    catch (e) { if (!colMissing(e, 'folder_id')) throw e; folderCol = false; }
  }
  if (folderCol === false) rows = await api(url(LIST_COLS));
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

// 제목 고치기(S69 [수정] 창 — 직접 넣은 줄·News 기능 키가 없을 때). 사이트 칸은 비우면 주소의 사이트 이름으로.
export const setTitle = (id, title, site) => patchItem(id, {title: ownTitle(title), ...(site === undefined ? {} : {site: ownTitle(site)})});

// ---- 제목 주인 하나(S69 READ-제목하나) ----
// News에서 온 줄 중 손으로 넣은 기사(manual_at)의 제목이 사본과 다르면 사본을 그 제목으로(reading-model titleFixes). 내 로그인으로 읽고(공용 기사 읽기 권한 그대로),
// 내 줄만 고친다(owner RLS). 고친 줄 [{id,title,row}]를 돌려준다. 못 읽으면 [](다음에 열 때 다시).
export async function fixLinkedTitles(rows) {
  const ids = [...new Set((Array.isArray(rows) ? rows : []).map(r => r?.news_article_id).filter(isId).map(v => v.toLowerCase()))];
  if (!ids.length || !ws()) return [];
  const arts = [];
  for (let i = 0; i < ids.length; i += 80) {
    const got = await api(`/rest/v1/app_news_articles?id=in.(${ids.slice(i, i + 80).join(',')})&manual_at=not.is.null&select=id,title,manual_at`);
    if (Array.isArray(got)) arts.push(...got);
  }
  const out = [];
  for (const f of titleFixes(rows, arts)) {
    try { out.push({...f, row: await patchItem(f.id, {title: f.title})}); } catch { /* 다음에 열 때 다시 */ }
  }
  return out;
}
// 글 보기 [직접 넣기]·⋯ [수정]으로 기사 제목을 저장한 직후(now-detail.js): 그 기사에 이어진 내 줄의 제목 사본을 같은 제목으로. 줄이 없으면 아무것도 안 함.
export async function syncNewsTitle(articleId, title) {
  const t = ownTitle(title);
  if (!isId(articleId) || !t || !ws()) return 0;
  const rows = await api(`${T}?workspace_id=eq.${enc(ws())}&news_article_id=eq.${enc(articleId.toLowerCase())}&select=${LIST_COLS}&limit=5`);
  let n = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r?.title === t) continue;
    try { await patchItem(r.id, {title: t}); n += 1; } catch { /* 목록을 열 때 fixLinkedTitles가 다시 맞춘다 */ }
  }
  return n;
}

// ---- 원문 받아 오기(차례로 하나씩) ----
// S68-32: News에서 온 줄(원래 글 연결 칸)은 먼저 News 쪽 본문(공용 본문 표 — News 화면과 같은 읽기 길 feed-shared.js readBody·readSentences)을 본다.
// 전문이 채워져 있으면 그 본문을 사본으로 넣고 끝(note-import 하루 횟수를 쓰지 않음). 없거나 못 읽거나 앞부분뿐이면 원래 글 주소로 note-import(기존 길).
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
    const saveCopy = async () => {
      try { const saved = await patchItem(row.id, copy); return {state: 'ok', row: saved}; }
      catch (e) { return {state: 'request', reason: e?.code === 'gone' ? 'gone' : requestFailReason(e)}; }
    };
    // S68-52: News 쪽 본문이 전문이면 그것으로 끝. 앞부분(리드)뿐이면 원래 주소로 한 번 더 읽어 보고, 전문을 못 받으면 그 앞부분을 넣는다
    // (조선일보처럼 News 수집 때 본문을 못 뽑아 리드만 남은 글 — 예전에는 다시 눌러도 늘 같은 리드만 다시 넣었다).
    if (copy && copy.body_state === 'ok') return saveCopy();
    let result;
    try { result = await rt().api(FN, {method: 'POST', body: {url: row.url}, singleFlight: false, timeoutMs: REQUEST_TIMEOUT_MS}); }
    catch (e) { return copy ? saveCopy() : {state: 'request', reason: requestFailReason(e)}; }
    if (me() !== owner) return {state: 'skipped'};
    const patch = keepOwn(row, bodyPatch(result));
    if (copy && patch.body_state !== 'ok') return saveCopy();
    try {
      const saved = await patchItem(row.id, patch);
      return {state: saved.body_state === 'ok' || saved.body_state === 'paywall' || saved.body_state === 'lead' ? 'ok' : 'failed', row: saved};
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

// ---------- S70-83 저장한 글 폴더(app_reading_folders, owner RLS REST 길만) ----------
// 표가 아직 없으면(DB 적용 전, 404/PGRST205/42P01) readFolders가 {ready:false} — 화면은 '폴더 없음' 한 줄만 보이고 만들기·옮기기를 두지 않는다.
// 기기 저장 없음. 글이 어느 폴더에 있나는 저장한 글 한 줄의 folder_id(moveItems)가 적는다. 폴더를 지우면 서버가 그 글들의 칸만 비운다.
const FT = '/rest/v1/app_reading_folders';
const F_COLS = 'id,name,sort_order,created_at';
const oneRow = rows => { if (!Array.isArray(rows) || rows.length !== 1) throw new Error('폴더를 저장하지 못했어요.'); return rows[0]; };
export async function readFolders() {
  const w = ws();
  if (!w) return {ready: false, folders: []};
  try {
    const rows = await api(`${FT}?workspace_id=eq.${enc(w)}&select=${F_COLS}&order=sort_order.asc,created_at.asc&limit=500`);
    return {ready: true, folders: Array.isArray(rows) ? rows : []};
  } catch (e) {
    const text = `${e?.status || ''} ${e?.code || ''} ${e?.message || ''}`;
    return {ready: false, folders: [], missing: /404|PGRST205|42P01|app_reading_folders/.test(text)};
  }
}
// id(선택): 지운 폴더 되돌리기에서 같은 id로 다시 만든다.
export async function createFolder({id, name, sort_order = 0}) {
  const body = {workspace_id: ws(), name, sort_order, ...(id ? {id} : {})};
  const row = oneRow(await api(`${FT}?select=${F_COLS}`, {method: 'POST', prefer: 'return=representation', body}));
  emit({id: row.id, kind: 'folder'});
  return row;
}
export async function renameFolder(id, name) {
  const row = oneRow(await api(`${FT}?id=eq.${enc(id)}&workspace_id=eq.${enc(ws())}&select=${F_COLS}`, {method: 'PATCH', prefer: 'return=representation', body: {name}}));
  emit({id, kind: 'folder'});
  return row;
}
export async function deleteFolder(id) {
  const rows = await api(`${FT}?id=eq.${enc(id)}&workspace_id=eq.${enc(ws())}&select=id`, {method: 'DELETE', prefer: 'return=representation'});
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('폴더를 삭제하지 못했어요.');
  emit({id, kind: 'folder'});
}
// 글 옮기기: folderId null = 폴더 없음. 한 번에 고친다(id in 목록). 돌려준 줄(id·folder_id)로 화면을 맞춘다.
export async function moveItems(ids, folderId) {
  const list = [...new Set(ids)].filter(isId);
  if (!list.length) return [];
  const rows = await api(`${T}?id=in.(${list.map(enc).join(',')})&workspace_id=eq.${enc(ws())}&select=id,folder_id`, {method: 'PATCH', prefer: 'return=representation', body: {folder_id: folderId || null, updated_at: new Date().toISOString()}});
  for (const id of list) emit({id, kind: 'patch'});
  return Array.isArray(rows) ? rows : [];
}
