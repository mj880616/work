// PHOTO-출처 ①(요청함 10/30 17:30): 사진 메뉴 '폰 사진'의 앱 다리. 폰 앱(웹2 앱 0.3.9+) 안에서만 쓴다(PC·폰 브라우저는 없음).
// PHOTO-폰사진못읽음(10/30 23:58): 앱 0.4.0+는 실패 종류를 돌려준다(phoneFailure·phoneErrorText, photo-sources-model.mjs).
// - 다리(KPTUAppShell, 허용 Origin 최상위 화면에만 보임)에 'photos:hello'를 보내 접근 상태({access: full|partial|none, key, trash})를 받는다.
//   답이 오지 않으면(옛 앱) 폰 사진 아이콘을 그리지 않는다.
// - 목록·그림은 ./__phone/<열쇠>/… 를 fetch·<img src>로 받는다. 앱이 가로채 폰 사진첩에서 답하고 서버로 나가지 않는다(android-app PhoneMedia.kt).
//   열쇠는 메모리에만 있다(화면을 새로 열면 다시 받는다). 사진·목록은 이 화면 메모리에만 있고 기기·서버에 저장하지 않는다.
// - 처음 한 번 'photos:ask' = 안드로이드 사진 접근 허용 창(14+는 '고른 사진만'도). 지우기는 'photos:trash:<번호들>' = 폰 휴지통(시스템 확인 창).
// - PHOTO-폴더스위치(앱 0.4.1+, 상태에 hide·ops·manage): 목록·달·날·번호 읽기에 hide(끈 폰 폴더 JSON 배열)를 붙이면 앱이 그 폴더 사진을 뺀다.
//   폰 폴더 바꾸기는 'photos:op:{op,…}'(이름 바꾸기·폴더 옮기기·고른 사진 옮기기·폴더 지우기=폰 휴지통) → 'photos:done:{ok,count,error,path}'.
//   'photos:manage' = '미디어 관리 허용' 설정 화면(켜 두면 바꿀 때 매번 묻지 않음). 옛 앱(0.4.0 이하)은 hide를 모르므로 붙이지 않는다(400).
// - PHOTO-갤러리편집(앱 0.4.6+, 상태에 edit): 'photos:edit:{id}|{name,size,taken}' = 삼성 갤러리 편집기(없으면 고르기 창)로 넘김
//   → 'photos:edited:{ok,changed,error}'. 폰에 없는 사진은 'photos:save:begin|part|end'로 원본 바이트를 Pictures/웹2에 한 장 저장한 뒤 그 번호로 편집.
// - S48-17 [폰으로 되돌리기](앱 0.4.11+, 상태에 restore): 같은 save 길의 begin에 dir(원래 폰 폴더)·taken(원래 찍은 시각 ms)을 붙인다(동영상도).
import {phoneToItem, phoneFailure} from './photo-sources-model.mjs';
import {slotImg} from './img-slot.js';
import {holdPhotoMaker} from './photo-share.js';

const BRIDGE = 'KPTUAppShell';
const HELLO_MS = 1500, TRASH_MS = 120000, OP_MS = 180000, HIDE_MAX = 80;
// 편집기에 머무는 시간(넉넉히 2시간), 받기 한 걸음 대기, 한 조각 바이트(base64로 512KB — 앱 한도 안), 받는 사진 한도(앱과 같게).
const EDIT_MS = 2 * 60 * 60 * 1000, SAVE_STEP_MS = 30000, SAVE_PART = 384 * 1024, SAVE_MAX = 60 * 1024 * 1024;
const SAVE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif'];
// S48-17 [폰으로 되돌리기](앱 0.4.11+, 상태에 restore): 동영상도(앱과 같은 종류·한도).
const RESTORE_VIDEO = ['video/mp4', 'video/quicktime', 'video/3gpp', 'video/webm', 'video/x-matroska'], RESTORE_VIDEO_MAX = 500 * 1024 * 1024;

export function createPhonePhotos(win = globalThis.window) {
  const ua = /KPTUAndroid/i.test(win?.navigator?.userAgent || '');
  const bridge = win?.[BRIDGE];
  const usable = ua && !!bridge && typeof bridge.postMessage === 'function' && typeof bridge.addEventListener === 'function';
  let state = {known:false, access:'none', key:'', trash:false, hide:false, ops:false, manage:false, edit:false, restore:false};
  let helloWait = null, trashWait = null, opWait = null, editWait = null, saveWait = null;
  const listeners = new Set();
  const send = t => { try { bridge.postMessage(t); return true; } catch { return false; } };
  if (usable) {
    bridge.addEventListener('message', event => {
      const d = typeof event?.data === 'string' ? event.data : '';
      if (d.startsWith('photos:state:')) {
        let v = null; try { v = JSON.parse(d.slice('photos:state:'.length)); } catch { return; }
        const access = ['full', 'partial', 'none'].includes(v?.access) ? v.access : 'none';
        const key = access !== 'none' && /^[A-Za-z0-9_-]{22,64}$/.test(v?.key || '') ? v.key : '';
        const changed = !state.known || state.access !== access || state.key !== key || state.manage !== (v?.manage === true);
        state = {known:true, access:key ? access : 'none', key, trash:v?.trash === true, hide:v?.hide === true, ops:v?.hide === true && v?.ops === true, manage:v?.manage === true, edit:v?.edit === true, restore:v?.restore === true};
        helloWait?.(state); helloWait = null;
        if (changed) listeners.forEach(fn => { try { fn(state); } catch { /* 한 곳 실패가 다른 곳을 막지 않게 */ } });
      } else if (d.startsWith('photos:trashed:')) {
        let v = null; try { v = JSON.parse(d.slice('photos:trashed:'.length)); } catch { v = null; }
        const w = trashWait; trashWait = null;
        w?.({ok:v?.ok === true, count:Number.isInteger(v?.count) ? v.count : 0});
      } else if (d.startsWith('photos:edited:')) {
        let v = null; try { v = JSON.parse(d.slice('photos:edited:'.length)); } catch { v = null; }
        const w = editWait; editWait = null;
        w?.({ok:v?.ok === true, changed:v?.changed === true, error:typeof v?.error === 'string' ? v.error.slice(0, 20) : 'failed'});
      } else if (d.startsWith('photos:save:')) {
        let v = null; try { v = JSON.parse(d.slice('photos:save:'.length)); } catch { v = null; }
        const w = saveWait; saveWait = null;
        w?.({ok:v?.ok === true, step:String(v?.step || ''), id:/^\d{1,18}$/.test(v?.id || '') ? v.id : '', error:typeof v?.error === 'string' ? v.error.slice(0, 20) : 'failed'});
      } else if (d.startsWith('photos:done:')) {
        let v = null; try { v = JSON.parse(d.slice('photos:done:'.length)); } catch { v = null; }
        const w = opWait; opWait = null;
        w?.({ok:v?.ok === true, count:Number.isInteger(v?.count) ? v.count : 0, error:typeof v?.error === 'string' ? v.error.slice(0, 20) : '',
          path:typeof v?.path === 'string' && v.path.length <= 255 ? v.path : null});
      }
    });
  }
  const base = () => win.document?.baseURI || win.location?.href;
  const url = path => new URL(`__phone/${state.key}/${path}`, base()).href;
  // PHOTO-폰사진못읽음: 실패하면 error.phone = {status, error(종류), detail(예외 클래스 이름)}. 화면 글은 phoneErrorText.
  const failure = info => Object.assign(new Error('phone_read_failed'), {phone:info});
  async function read(u) {
    try { return await win.fetch(u, {cache:'no-store', credentials:'omit'}); }
    catch (e) { throw failure(phoneFailure(0, '', {error:'unreached', detail:e?.name || ''})); }
  }
  async function refuse(r) {
    let body = ''; try { body = await r.text(); } catch { body = ''; }
    const info = phoneFailure(r.status, body.slice(0, 500));
    // 앱을 다시 켜 열쇠가 바뀌었으면 새 열쇠를 받아 둔다([다시]부터 맞는 열쇠).
    if (info.error === 'key') send('photos:hello');
    return failure(info);
  }
  async function getJson(path) {
    if (!state.key) throw new Error('phone_no_access');
    const r = await read(url(path));
    if (!r.ok) throw await refuse(r);
    try { return await r.json(); } catch { throw failure(phoneFailure(r.status, '', {error:'answer'})); }
  }
  const items = list => (Array.isArray(list) ? list : []).map(phoneToItem).filter(Boolean);
  // 끈 폰 폴더(앱 0.4.1+만). 빈 목록이면 붙이지 않는다.
  const hideOf = hide => (state.hide && Array.isArray(hide) ? hide.filter(x => typeof x === 'string' && x.length <= 255).slice(0, HIDE_MAX) : []);
  const withHide = (q, hide) => { const h = hideOf(hide); if (h.length) q.set('hide', JSON.stringify(h)); return q; };
  // 앱 다리로 한 장 넘기기: begin(모양) → part(384KB씩 base64) → end. 걸음마다 30초 안에 답이 없으면 실패.
  async function saveBytes(blob, head) {
    const step = text => new Promise(resolve => {
      let timer = null;
      const ok = v => { clearTimeout(timer); resolve(v); };
      saveWait?.({ok:false, step:'', id:'', error:'busy'});
      saveWait = ok;
      timer = setTimeout(() => { if (saveWait === ok) { saveWait = null; ok({ok:false, step:'', id:'', error:'failed'}); } }, SAVE_STEP_MS);
      if (!send(text)) { saveWait = null; ok({ok:false, step:'', id:'', error:'failed'}); }
    });
    let r = await step('photos:save:begin:' + JSON.stringify(head));
    if (!r.ok) return {ok:false, id:'', error:r.error || 'failed'};
    for (let at = 0; at < blob.size; at += SAVE_PART) {
      let part = '';
      try { part = base64(new Uint8Array(await blob.slice(at, at + SAVE_PART).arrayBuffer())); } catch { part = ''; }
      r = part ? await step('photos:save:part:' + part) : {ok:false, error:'failed'};
      if (!r.ok) { send('photos:save:cancel'); return {ok:false, id:'', error:r.error || 'failed'}; }
    }
    r = await step('photos:save:end');
    return r.ok && r.id ? {ok:true, id:r.id, error:''} : {ok:false, id:'', error:r.error || 'failed'};
  }
  const api = {
    get usable() { return usable; },
    // 앱이 답했다(0.3.9+) = 폰 사진 아이콘을 그린다.
    available: () => usable && state.known,
    state: () => state,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    hello() {
      if (!usable) return Promise.resolve(state);
      if (state.known) { send('photos:hello'); return Promise.resolve(state); }
      return new Promise(ok => {
        const prev = helloWait;
        helloWait = s => { prev?.(s); ok(s); };
        setTimeout(() => { if (helloWait) { const w = helloWait; helloWait = null; w(state); } }, HELLO_MS);
        if (!send('photos:hello')) { const w = helloWait; helloWait = null; w?.(state); }
      });
    },
    // 처음 한 번 '사진 접근 허용'(이미 허용했으면 시스템이 바로 돌려준다, 부분 허용이면 고른 사진을 다시 고르는 창).
    ask: () => (usable ? send('photos:ask') : false),
    // 한 쪽: {items, next(다음 offset 또는 null)}. before = 그 시각보다 앞에 찍은 것부터(찍은 날 최근 먼저만).
    // folder(PHOTO-출처모든칩) = 그 폰 폴더(relative_path) 바로 안 것만.
    async page({sort = 'taken_desc', filter = 'all', offset = 0, limit = 120, before = null, folder = null, hide = null} = {}) {
      const q = new URLSearchParams({sort, filter, offset:String(offset), limit:String(limit)});
      if (Number.isFinite(before) && before > 0) q.set('before', String(Math.floor(before)));
      if (typeof folder === 'string' && folder.length <= 255) q.set('folder', folder);
      withHide(q, hide);
      const d = await getJson(`page?${q}`);
      return {items:items(d?.items), next:Number.isInteger(d?.next) ? d.next : null};
    },
    // 번호로(별표·앨범). 폰에서 지워졌거나 허용 밖이면 빠진다. 500개씩.
    async byIds(ids, {hide = null} = {}) {
      const out = [];
      const want = [...new Set((ids || []).map(String).filter(id => /^\d{1,18}$/.test(id)))];
      for (let i = 0; i < want.length; i += 500) out.push(...items((await getJson(`ids?${withHide(new URLSearchParams({ids:want.slice(i, i + 500).join(',')}), hide)}`))?.items));
      return out;
    },
    // PHOTO-출처모든칩: 폰 폴더 목록 [{id(relative_path), name, count, cover(칸)}]. 옛 앱(0.3.9)은 이 읽기가 없어 null(폰 폴더 묶음만 안 보임).
    async folders() {
      let d;
      try { d = await getJson('folders'); }
      catch (err) { if (err?.phone && ((err.phone.status === 404 && !err.phone.error) || err.phone.error === 'bad_request')) return null; throw err; }
      return (Array.isArray(d?.folders) ? d.folders : []).map(f => {
        const cover = phoneToItem(f?.cover);
        return typeof f?.id === 'string' && f.id.length <= 255 && Number.isInteger(f?.count) && f.count > 0 && cover
          ? {id:f.id, name:String(f.name || '폰').slice(0, 255), count:f.count, cover} : null;
      }).filter(Boolean);
    },
    async months(filter = 'all', {hide = null} = {}) { const d = await getJson(`months?${withHide(new URLSearchParams({filter}), hide)}`); return d?.months && typeof d.months === 'object' ? d.months : {}; },
    async days(month, {filter = 'all', prefer = [], hide = null} = {}) {
      const q = withHide(new URLSearchParams({month, filter}), hide);
      const p = prefer.filter(id => /^\d{1,18}$/.test(String(id))).slice(0, 500);
      if (p.length) q.set('prefer', p.join(','));
      const d = await getJson(`days?${q}`);
      return d?.days && typeof d.days === 'object' ? d.days : {};
    },
    thumbUrl: (item, size = 'small') => (state.key ? url(`thumb/${item.phoneId}?s=${size === 'large' ? 'large' : 'small'}`) : ''),
    mediaUrl: item => (state.key ? url(`media/${item.phoneId}`) : ''),
    async blob(item, size = 'large') {
      if (!state.key) throw new Error('phone_no_access');
      const r = await read(api.thumbUrl(item, size));
      if (!r.ok) throw await refuse(r);
      return r.blob();
    },
    // 폰 휴지통으로(안드로이드 11+). 시스템 확인 창에서 [허용]하면 {ok:true, count}.
    trash(list) {
      const ids = (list || []).map(it => it.phoneId).filter(Boolean).slice(0, 200);
      if (!usable || !state.trash || !ids.length) return Promise.resolve({ok:false, count:0});
      trashWait?.({ok:false, count:0});
      return new Promise(ok => {
        trashWait = ok;
        setTimeout(() => { if (trashWait === ok) { trashWait = null; ok({ok:false, count:0}); } }, TRASH_MS);
        if (!send(`photos:trash:${ids.join(',')}`)) { trashWait = null; ok({ok:false, count:0}); }
      });
    },
    // PHOTO-폴더스위치: 폰 폴더 바꾸기 하나(앱 0.4.1+, 안드로이드 11+). op = {op:'rename', from, name} | {op:'movefolder', from, into}
    // | {op:'move', ids:[phoneId], to} | {op:'trashfolder', from}. 답 {ok, count, error(refused·none·failed·old·busy), path(새 폴더 경로)}.
    folderOp(op) {
      if (!usable || !state.ops || !op || typeof op !== 'object') return Promise.resolve({ok:false, count:0, error:'old', path:null});
      let text = ''; try { text = JSON.stringify(op); } catch { text = ''; }
      if (!text || text.length > 60000) return Promise.resolve({ok:false, count:0, error:'failed', path:null});
      opWait?.({ok:false, count:0, error:'busy', path:null});
      return new Promise(resolve => {
        let timer = null;
        const ok = v => { clearTimeout(timer); resolve(v); };
        opWait = ok;
        timer = setTimeout(() => { if (opWait === ok) { opWait = null; ok({ok:false, count:0, error:'failed', path:null}); } }, OP_MS);
        if (!send('photos:op:' + text)) { opWait = null; ok({ok:false, count:0, error:'failed', path:null}); }
      });
    },
    // PHOTO-갤러리편집: 이 앱이 [편집]을 안다(0.4.6+). PC·브라우저·옛 앱은 false.
    canEdit: () => usable && state.known && state.edit,
    // 편집기로 넘기기. item = 폰 사진({phoneId}) 또는 원드라이브·구글 드라이브 사진({name, size_bytes, taken_at} — 같은 사진이 폰에 있으면 그것).
    // 답 {ok, changed(사진첩이 바뀜), error: none(폰에 없음)·busy·noapp·failed·old}.
    edit(item) {
      if (!api.canEdit() || !item || item.video) return Promise.resolve({ok:false, changed:false, error:'old'});
      const taken = Date.parse(item.taken_at || '');
      const target = item.kind === 'phone' && /^\d{1,18}$/.test(String(item.phoneId || '')) ? {id:String(item.phoneId)}
        : {name:String(item.name || '').slice(0, 255), size:Number.isInteger(item.size_bytes) && item.size_bytes > 0 ? item.size_bytes : 0, taken:Number.isFinite(taken) && taken > 0 ? taken : 0};
      if (!target.id && !target.name && !target.size) return Promise.resolve({ok:false, changed:false, error:'none'});
      editWait?.({ok:false, changed:false, error:'busy'});
      return new Promise(resolve => {
        let timer = null;
        const ok = v => { clearTimeout(timer); resolve(v); };
        editWait = ok;
        timer = setTimeout(() => { if (editWait === ok) { editWait = null; ok({ok:false, changed:false, error:'failed'}); } }, EDIT_MS);
        if (!send('photos:edit:' + JSON.stringify(target))) { editWait = null; ok({ok:false, changed:false, error:'failed'}); }
      });
    },
    // 폰에 없는 사진의 원본(Blob)을 폰 사진첩 Pictures/웹2에 한 장 저장 → {ok, id(폰 사진 번호), error}. 바이트는 앱 다리로만(서버 안 거침).
    save(blob, name = '') {
      const type = saveType(blob?.type, name);
      if (!api.canEdit() || !blob || !SAVE_MIMES.includes(type) || !(blob.size > 0) || blob.size > SAVE_MAX) return Promise.resolve({ok:false, id:'', error:blob?.size > SAVE_MAX ? 'big' : 'type'});
      return saveBytes(blob, {name:String(name || '').slice(0, 255), mime:type, size:blob.size});
    },
    // S48-17: 이 앱이 [폰으로 되돌리기]를 안다(0.4.11+). PC·브라우저·옛 앱은 false.
    canRestore: () => usable && state.known && state.restore,
    // 원드라이브 원본(Blob)을 원래 폰 폴더(dir)·원래 찍은 시각(taken, ISO)으로 사진첩에 넣기 → {ok, id, error: type·big·failed·busy}.
    restore(blob, {name = '', dir = '', taken = ''} = {}) {
      const type = restoreType(blob?.type, name);
      const max = RESTORE_VIDEO.includes(type) ? RESTORE_VIDEO_MAX : SAVE_MAX;
      if (!api.canRestore() || !blob || !(SAVE_MIMES.includes(type) || RESTORE_VIDEO.includes(type)) || !(blob.size > 0)) return Promise.resolve({ok:false, id:'', error:'type'});
      if (blob.size > max) return Promise.resolve({ok:false, id:'', error:'big'});
      const t = Date.parse(taken || '');
      return saveBytes(blob, {name:String(name || '').slice(0, 255), mime:type, size:blob.size, dir:String(dir || '').slice(0, 255), ...(Number.isFinite(t) && t > 0 ? {taken:t} : {})});
    },
    // '미디어 관리 허용' 설정 화면 열기(돌아오면 앱이 상태를 다시 알린다).
    manage: () => (usable && state.ops ? send('photos:manage') : false),
    // 사진 칸 하나(odPhotoElement와 같은 모양: span.diary-photo > img, 회색 칸 → 그림 → 못 받으면 ↻).
    element(item, size = 'small', {label = ''} = {}) {
      const doc = win.document;
      const box = doc.createElement('span');
      box.className = 'diary-photo'; box.dataset.diaryPhoto = 'ph:' + item.phoneId;
      const img = doc.createElement('img');
      img.alt = label || '사진'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
      if (size !== 'large') img.loading = 'lazy';
      const load = () => slotImg(box, img, api.thumbUrl(item, size), {retry:load});
      load();
      // PHOTO-폰앱공유: 넓은 화면 메뉴([사진 복사]·[정리함에 넣기])·옛 앱이 쓸 그림 바이트. 필요할 때 한 번만 앱 가로채기(__phone)로 받는다(서버로 나가지 않음).
      // 폰 앱 [공유]는 바이트 없이 번호만 넘긴다(app-share.js).
      holdPhotoMaker(box, () => api.blob(item, size === 'large' ? 'large' : 'small'));
      return box;
    },
  };
  return api;
}
// 받을 그림 종류: Blob 종류가 그림이 아니면(서버 중계가 octet-stream 등) 이름 끝으로 고른다.
const EXT_MIME = {jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp', heic:'image/heic', heif:'image/heif', gif:'image/gif'};
export function saveType(type, name) {
  const t = String(type || '').toLowerCase().split(';')[0].trim();
  if (SAVE_MIMES.includes(t)) return t;
  return EXT_MIME[(/\.([A-Za-z0-9]{1,5})$/.exec(String(name || '')) || [])[1]?.toLowerCase()] || t;
}
// S48-17 되돌리기 종류: 그림 종류 판정 + 동영상(이름 끝으로도).
const VIDEO_EXT = {mp4:'video/mp4', mov:'video/quicktime', '3gp':'video/3gpp', webm:'video/webm', mkv:'video/x-matroska', m4v:'video/mp4'};
export function restoreType(type, name) {
  const t = String(type || '').toLowerCase().split(';')[0].trim();
  if (RESTORE_VIDEO.includes(t)) return t;
  const v = VIDEO_EXT[(/\.([A-Za-z0-9]{1,5})$/.exec(String(name || '')) || [])[1]?.toLowerCase()];
  return v && !SAVE_MIMES.includes(t) ? v : saveType(type, name);
}
// 바이트 → base64(32KB씩 글자로 바꿔 btoa).
export function base64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
let shared = null;
export const phonePhotos = () => (shared ||= createPhonePhotos());
