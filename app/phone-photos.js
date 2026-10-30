// PHOTO-출처 ①(요청함 10/30 17:30): 사진 메뉴 '폰 사진'의 앱 다리. 폰 앱(웹2 앱 0.3.9+) 안에서만 쓴다(PC·폰 브라우저는 없음).
// - 다리(KPTUAppShell, 허용 Origin 최상위 화면에만 보임)에 'photos:hello'를 보내 접근 상태({access: full|partial|none, key, trash})를 받는다.
//   답이 오지 않으면(옛 앱) 폰 사진 아이콘을 그리지 않는다.
// - 목록·그림은 ./__phone/<열쇠>/… 를 fetch·<img src>로 받는다. 앱이 가로채 폰 사진첩에서 답하고 서버로 나가지 않는다(android-app PhoneMedia.kt).
//   열쇠는 메모리에만 있다(화면을 새로 열면 다시 받는다). 사진·목록은 이 화면 메모리에만 있고 기기·서버에 저장하지 않는다.
// - 처음 한 번 'photos:ask' = 안드로이드 사진 접근 허용 창(14+는 '고른 사진만'도). 지우기는 'photos:trash:<번호들>' = 폰 휴지통(시스템 확인 창).
import {phoneToItem} from './photo-sources-model.mjs';
import {slotImg} from './img-slot.js';

const BRIDGE = 'KPTUAppShell';
const HELLO_MS = 1500, TRASH_MS = 120000;

export function createPhonePhotos(win = globalThis.window) {
  const ua = /KPTUAndroid/i.test(win?.navigator?.userAgent || '');
  const bridge = win?.[BRIDGE];
  const usable = ua && !!bridge && typeof bridge.postMessage === 'function' && typeof bridge.addEventListener === 'function';
  let state = {known:false, access:'none', key:'', trash:false};
  let helloWait = null, trashWait = null;
  const listeners = new Set();
  const send = t => { try { bridge.postMessage(t); return true; } catch { return false; } };
  if (usable) {
    bridge.addEventListener('message', event => {
      const d = typeof event?.data === 'string' ? event.data : '';
      if (d.startsWith('photos:state:')) {
        let v = null; try { v = JSON.parse(d.slice('photos:state:'.length)); } catch { return; }
        const access = ['full', 'partial', 'none'].includes(v?.access) ? v.access : 'none';
        const key = access !== 'none' && /^[A-Za-z0-9_-]{22,64}$/.test(v?.key || '') ? v.key : '';
        const changed = !state.known || state.access !== access || state.key !== key;
        state = {known:true, access:key ? access : 'none', key, trash:v?.trash === true};
        helloWait?.(state); helloWait = null;
        if (changed) listeners.forEach(fn => { try { fn(state); } catch { /* 한 곳 실패가 다른 곳을 막지 않게 */ } });
      } else if (d.startsWith('photos:trashed:')) {
        let v = null; try { v = JSON.parse(d.slice('photos:trashed:'.length)); } catch { v = null; }
        const w = trashWait; trashWait = null;
        w?.({ok:v?.ok === true, count:Number.isInteger(v?.count) ? v.count : 0});
      }
    });
  }
  const base = () => win.document?.baseURI || win.location?.href;
  const url = path => new URL(`__phone/${state.key}/${path}`, base()).href;
  async function getJson(path) {
    if (!state.key) throw new Error('phone_no_access');
    const r = await win.fetch(url(path), {cache:'no-store', credentials:'omit'});
    if (!r.ok) throw new Error('phone_read_failed');
    return r.json();
  }
  const items = list => (Array.isArray(list) ? list : []).map(phoneToItem).filter(Boolean);
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
    async page({sort = 'taken_desc', filter = 'all', offset = 0, limit = 120, before = null} = {}) {
      const q = new URLSearchParams({sort, filter, offset:String(offset), limit:String(limit)});
      if (Number.isFinite(before) && before > 0) q.set('before', String(Math.floor(before)));
      const d = await getJson(`page?${q}`);
      return {items:items(d?.items), next:Number.isInteger(d?.next) ? d.next : null};
    },
    // 번호로(별표·앨범). 폰에서 지워졌거나 허용 밖이면 빠진다. 500개씩.
    async byIds(ids) {
      const out = [];
      const want = [...new Set((ids || []).map(String).filter(id => /^\d{1,18}$/.test(id)))];
      for (let i = 0; i < want.length; i += 500) out.push(...items((await getJson(`ids?ids=${want.slice(i, i + 500).join(',')}`))?.items));
      return out;
    },
    async months(filter = 'all') { const d = await getJson(`months?filter=${encodeURIComponent(filter)}`); return d?.months && typeof d.months === 'object' ? d.months : {}; },
    async days(month, {filter = 'all', prefer = []} = {}) {
      const q = new URLSearchParams({month, filter});
      const p = prefer.filter(id => /^\d{1,18}$/.test(String(id))).slice(0, 500);
      if (p.length) q.set('prefer', p.join(','));
      const d = await getJson(`days?${q}`);
      return d?.days && typeof d.days === 'object' ? d.days : {};
    },
    thumbUrl: (item, size = 'small') => (state.key ? url(`thumb/${item.phoneId}?s=${size === 'large' ? 'large' : 'small'}`) : ''),
    mediaUrl: item => (state.key ? url(`media/${item.phoneId}`) : ''),
    async blob(item, size = 'large') {
      const r = await win.fetch(api.thumbUrl(item, size), {cache:'no-store', credentials:'omit'});
      if (!r.ok) throw new Error('phone_read_failed');
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
      return box;
    },
  };
  return api;
}
let shared = null;
export const phonePhotos = () => (shared ||= createPhonePhotos());
