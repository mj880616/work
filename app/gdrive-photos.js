// S46-24 ④ 사진 출처 구글 드라이브: 화면 쪽 길(Edge gdrive-photos). 설계 docs/design/photo-gdrive-permission.md 0·6절.
// - 서버가 네 겹(로그인·owner·운영자 기능 gdrive_photos·Drive 연결 주인)을 본다. 이 파일은 칩을 보일지 정하려고 app_my_features()만 읽는다(화면 숨김은 보안이 아님).
// - 쓰기(이름 바꾸기·옮기기·휴지통으로·폴더 만들기·이름·휴지통으로)는 사용자가 누르고 확인한 뒤에만 confirm:true로 보낸다. 자동·일괄 실행 없음.
// - 그림(썸네일·원본·동영상)은 서버를 거쳐 받아 이 탭 메모리(blob: 주소, 상한 300장)에만 둔다. 기기 저장 없음(od-thumb-cache.js 사본도 쓰지 않음).
// - 썸네일은 한 번에 4장까지만 받는다(요청마다 서버가 Drive 열쇠를 새로 받으므로 몰아치지 않게). 화면 밖으로 나간 차례 안 된 요청은 거둔다.
import {slotBox, slotLoading, slotShown, slotFailed} from './img-slot.js';

export const GD_FN = '/functions/v1/gdrive-photos';
export const GD_TIMEOUT_MS = 45000;
const PARALLEL = 4, KEEP = 300;

export const gdCall = (rt, body) => rt.api(GD_FN, {method:'POST', body, singleFlight:false, timeoutMs:GD_TIMEOUT_MS});
// 운영자 기능 목록(서버 app_my_features, 로그인 토큰으로). 실패하면 빈 목록(칩 안 보임).
export async function myFeatures(rt) {
  try { const v = await rt.api('/rest/v1/rpc/app_my_features', {method:'POST', body:{}, singleFlight:false}); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []; }
  catch { return []; }
}
export const gdStatus = rt => gdCall(rt, {action:'status'});
export const gdFolders = (rt, parent = 'root') => gdCall(rt, {action:'folders', parent});
export const gdFolderToggle = (rt, id, enabled) => gdCall(rt, {action:'folder-toggle', id, enabled});
export const gdSync = rt => gdCall(rt, {action:'sync'});
export const gdList = (rt, {before = null, limit = 120} = {}) => gdCall(rt, {action:'list', limit, ...(before ? {before} : {})});
export const gdRename = (rt, id, name) => gdCall(rt, {action:'rename', id, name, confirm:true});
export const gdMove = (rt, ids, to) => gdCall(rt, {action:'move', ids, to, confirm:true});
export const gdTrash = (rt, ids) => gdCall(rt, {action:'trash', ids, confirm:true});
export const gdFolderCreate = (rt, parent, name) => gdCall(rt, {action:'folder-create', parent, name, confirm:true});
export const gdFolderRename = (rt, id, name) => gdCall(rt, {action:'folder-rename', id, name, confirm:true});
export const gdFolderTrash = (rt, id) => gdCall(rt, {action:'folder-trash', id, confirm:true});
// 자료실과 같은 [Drive 다시 연결](public-policy-drive drive-start → Google 동의 화면으로).
export async function gdReconnect(rt) {
  const d = await rt.api('/functions/v1/public-policy-drive', {method:'POST', body:{action:'drive-start'}, singleFlight:false});
  const url = d?.url || d?.auth_url;
  if (!url) throw new Error('Google Drive 연결 주소를 받지 못했습니다.');
  location.href = url;
}

// 그림 바이트(썸네일 thumb 또는 원본 media). 오류는 서버 코드(message)와 상태(status)를 가진다.
async function bytes(rt, body, {range = ''} = {}) {
  if (!(await rt.session.ensure())) throw Object.assign(new Error('session_required'), {status:401});
  const token = rt.session.read()?.access_token;
  if (!token) throw Object.assign(new Error('session_required'), {status:401});
  const headers = {apikey:rt.config.key, Authorization:'Bearer ' + token, 'Content-Type':'application/json'};
  if (range) headers.Range = range;
  const r = await fetch(rt.config.url + GD_FN, {method:'POST', cache:'no-store', headers, body:JSON.stringify(body)});
  const type = (r.headers.get('content-type') || '').split(';')[0].trim();
  if (!r.ok || /json/.test(type)) {
    let code = ''; try { code = (await r.json())?.error || ''; } catch { /* 본문 없음 */ }
    throw Object.assign(new Error(code || `http_${r.status}`), {status:r.status});
  }
  return r.blob();
}
export const gdThumbBlob = (rt, driveId, size = 'small') => bytes(rt, {action:'thumb', id:driveId, size:size === 'large' ? 'large' : 'small'});
// 원본(사진 원본 받기·동영상 재생). 동영상은 서버가 Range를 그대로 넘기지만, 화면의 <video>는 POST를 못 하므로 통째로 받아 메모리 주소로 튼다.
export const gdMediaBlob = (rt, driveId) => bytes(rt, {action:'media', id:driveId});

// ---- 썸네일 대기열(메모리만) ----
const kept = new Map(); // `${size}:${id}` → blob: 주소(오래 안 쓴 것부터 놓음)
let queue = [], running = 0, scope = '';
function keep(k, url) {
  kept.delete(k); kept.set(k, url);
  while (kept.size > KEEP) { const [old, u] = kept.entries().next().value; kept.delete(old); URL.revokeObjectURL(u); }
}
export function gdForget(driveId) {
  for (const size of ['small', 'large']) { const k = `${size}:${driveId}`, u = kept.get(k); if (u) { kept.delete(k); URL.revokeObjectURL(u); } }
}
// 로그인한 사람이 바뀌면 모두 버린다.
export function gdClear() { for (const u of kept.values()) URL.revokeObjectURL(u); kept.clear(); queue.forEach(j => j.fail(Object.assign(new Error('dropped'), {dropped:true}))); queue = []; }
function pump(rt) {
  while (running < PARALLEL && queue.length) {
    const job = queue.shift();
    running++;
    gdThumbBlob(rt, job.id, job.size).then(blob => { const u = URL.createObjectURL(blob); keep(job.k, u); job.done(u); }, job.fail)
      .finally(() => { running--; pump(rt); });
  }
}
export function gdThumbUrl(rt, driveId, size = 'small', owner = '') {
  if (owner !== scope) { gdClear(); scope = owner; }
  const k = `${size}:${driveId}`, have = kept.get(k);
  if (have) { keep(k, have); return {promise:Promise.resolve(have), cancel:() => {}}; }
  let job;
  const promise = new Promise((done, fail) => { job = {id:driveId, size, k, done, fail}; });
  if (size === 'large') queue.unshift(job); else queue.push(job);
  pump(rt);
  return {promise, cancel:() => { const i = queue.indexOf(job); if (i >= 0) { queue.splice(i, 1); job.fail(Object.assign(new Error('dropped'), {dropped:true})); } }};
}

// 사진 한 칸(odPhotoElement·폰 사진 칸과 같은 모양: span.diary-photo > img, 회색 칸 → 그림 → 못 받으면 ↻). 보일 때 받는다.
export function gdPhotoElement(item, size, {label = '', rt = window.KPTURuntime, owner = '', retry = true} = {}) {
  const box = document.createElement('span');
  box.className = 'diary-photo'; box.dataset.diaryPhoto = 'gd:' + item.gdId;
  const img = document.createElement('img');
  img.alt = label || '사진'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
  box.append(img); slotBox(box);
  let job = null, state = 'idle';
  const load = () => {
    if (state === 'loading' || state === 'shown') return;
    state = 'loading'; slotLoading(box);
    job = gdThumbUrl(rt, item.gdId, size, owner);
    job.promise.then(url => {
      job = null;
      img.onload = () => { img.onload = img.onerror = null; state = 'shown'; slotShown(box); };
      img.onerror = () => { img.onload = img.onerror = null; img.removeAttribute('src'); gdForget(item.gdId); state = 'failed'; slotFailed(box, again, 'img', {passive:!retry}); };
      img.src = url;
    }, error => {
      job = null;
      if (error?.dropped) { state = 'idle'; return; }
      state = 'failed'; box.dataset.imgWhy = String(error?.message || 'error').slice(0, 30);
      slotFailed(box, again, String(error?.message || 'error').slice(0, 30), {passive:!retry});
    });
  };
  function again() { state = 'idle'; load(); }
  if (size === 'large' || typeof IntersectionObserver !== 'function') { load(); return box; }
  const io = new IntersectionObserver(entries => {
    const on = entries.some(e => e.isIntersecting);
    if (!box.isConnected && state !== 'loading') { io.disconnect(); return; }
    if (on) load(); else if (job && state === 'loading') { job.cancel(); }
    if (state === 'shown') io.disconnect();
  }, {rootMargin:'400px 0px'});
  io.observe(box);
  return box;
}
