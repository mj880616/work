// FILES-통합 3단계(S49-51, 명진 결정 H-1·H-7): [파일] '이 폰' 저장 공간의 앱 다리. 폰 앱(웹2 앱 0.5.0+) 안에서만 쓴다(PC·폰 브라우저는 없음).
// - 다리(KPTUAppShell, 허용 Origin 최상위 화면에만 보임)에 'pfiles:hello'를 보내 {can, all, key}를 받는다. 답이 없으면(옛 앱) '이 폰'을 그리지 않는다.
// - 'pfiles:ask' = 안드로이드 설정 '모든 파일 접근 허용' 화면(명진이 한 번 켬). 앱이 돌아오면 상태를 다시 보낸다.
// - 목록·원본·작은 그림은 ./__phone/<열쇠>/files/{list|recent|raw|thumb} 를 fetch한다. 앱이 가로채 폰 안에서 답하고 서버로 나가지 않는다(android-app PhoneFiles.kt).
//   열쇠는 메모리에만(화면을 새로 열면 다시 받는다). 폰 파일 목록은 이 화면 메모리에만 있고 기기·서버에 저장하지 않는다.
// - 실패는 Error('phone_<종류>')(files-model errorText가 한 줄로 바꾼다). 로그에 파일 이름·경로를 남기지 않는다.
import {phoneState, phoneRows, phonePathOk, PHONE_RECENT_LIMIT} from './phone-files-model.mjs';

const BRIDGE = 'KPTUAppShell';
const HELLO_MS = 1500;

export function createPhoneFiles(win = globalThis.window) {
  const ua = /KPTUAndroid/i.test(win?.navigator?.userAgent || '');
  const bridge = win?.[BRIDGE];
  const usable = ua && !!bridge && typeof bridge.postMessage === 'function' && typeof bridge.addEventListener === 'function';
  let state = {known: false, can: false, all: false, key: ''};
  let helloWait = null;
  const listeners = new Set();
  const send = t => { try { bridge.postMessage(t); return true; } catch { return false; } };
  if (usable) {
    bridge.addEventListener('message', event => {
      const v = phoneState(typeof event?.data === 'string' ? event.data : '');
      if (!v) return;
      const changed = !state.known || state.all !== v.all || state.key !== v.key || state.can !== v.can;
      state = v;
      helloWait?.(state); helloWait = null;
      if (changed) listeners.forEach(fn => { try { fn(state); } catch { /* 한 곳 실패가 다른 곳을 막지 않게 */ } });
    });
  }
  const base = () => win.document?.baseURI || win.location?.href;
  const url = (what, q) => { const u = new URL(`__phone/${state.key}/files/${what}`, base()); for (const [k, v] of Object.entries(q || {})) u.searchParams.set(k, v); return u.href; };
  const fail = code => Object.assign(new Error('phone_' + code), {phone: code});
  async function get(what, q) {
    if (!state.all || !state.key) throw fail('permission');
    let r;
    try { r = await win.fetch(url(what, q), {cache: 'no-store', credentials: 'omit'}); } catch { throw fail('unreached'); }
    if (!r.ok) {
      let code = 'read';
      try { const b = await r.json(); if (typeof b?.error === 'string' && /^[a-z_]{1,20}$/.test(b.error)) code = b.error; } catch { /* 본문 없음 */ }
      if (code === 'key') send('pfiles:hello');
      throw fail(code);
    }
    return r;
  }
  return {
    usable,
    get state() { return state; },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    // 지금 상태(답이 없으면 옛 앱: known=false).
    hello() {
      if (!usable) return Promise.resolve(state);
      return new Promise(resolve => {
        const done = v => { clearTimeout(timer); resolve(v); };
        const timer = setTimeout(() => { if (helloWait === done) helloWait = null; resolve(state); }, HELLO_MS);
        helloWait = done;
        if (!send('pfiles:hello')) { helloWait = null; done(state); }
      });
    },
    ask() { return usable && send('pfiles:ask'); },
    // 폴더 안 목록(dir = 뿌리 기준 상대 경로, null = 맨 위).
    async list(dir) {
      if (dir && !phonePathOk(dir)) throw fail('blocked');
      const r = await get('list', dir ? {dir} : {});
      let body = null; try { body = await r.json(); } catch { throw fail('read'); }
      return phoneRows(body?.items);
    },
    async recent(limit = PHONE_RECENT_LIMIT) {
      const r = await get('recent', {limit: String(limit)});
      let body = null; try { body = await r.json(); } catch { throw fail('read'); }
      return phoneRows(body?.items);
    },
    // 원본 바이트(미리보기·받기·클라우드로 올리기). 폰 안에서만 읽힌다.
    async blob(path) {
      if (!phonePathOk(path)) throw fail('blocked');
      return (await get('raw', {path})).blob();
    },
    async thumb(path, large = false) {
      if (!phonePathOk(path)) throw fail('blocked');
      return (await get('thumb', {path, s: large ? 'large' : 'small'})).blob();
    },
  };
}
