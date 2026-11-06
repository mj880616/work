// FILES-통합 3단계(S49-51, 명진 결정 H-1·H-7): [파일] '이 폰' 저장 공간의 앱 다리. 폰 앱(웹2 앱 0.5.0+) 안에서만 쓴다(PC·폰 브라우저는 없음).
// - 다리(KPTUAppShell, 허용 Origin 최상위 화면에만 보임)에 'pfiles:hello'를 보내 {can, all, key}를 받는다. 답이 없으면(옛 앱) '이 폰'을 그리지 않는다.
// - 'pfiles:ask' = 안드로이드 설정 '모든 파일 접근 허용' 화면(명진이 한 번 켬). 앱이 돌아오면 상태를 다시 보낸다.
// - 목록·원본·작은 그림은 ./__phone/<열쇠>/files/{list|raw|thumb} 를 fetch한다. 앱이 가로채 폰 안에서 답하고 서버로 나가지 않는다(android-app PhoneFiles.kt).
//   열쇠는 메모리에만(화면을 새로 열면 다시 받는다). 폰 파일 목록은 이 화면 메모리에만 있고 기기·서버에 저장하지 않는다.
// - 실패는 Error('phone_<종류>')(files-model errorText가 한 줄로 바꾼다). 로그에 파일 이름·경로를 남기지 않는다.
import {phoneState, phoneRows, phonePathOk, phoneDone, phoneSaved, PHONE_SAVE_MAX} from './phone-files-model.mjs';
import {within, isLoadTimeout} from './load-deadline.js';

const BRIDGE = 'KPTUAppShell';
const HELLO_MS = 1500;
// 쓰기 답 기다림: 새 폴더·이름 30초, 휴지통 3분(시스템 확인 창), 받기 한 걸음 30초. 한 조각 384KB(base64 512KB — 앱 한도 안).
const OP_MS = 30000, TRASH_MS = 180000, SAVE_STEP_MS = 30000, SAVE_PART = 384 * 1024;

const GET_MS = 25000;
export function createPhoneFiles(win = globalThis.window) {
  const ua = /KPTUAndroid/i.test(win?.navigator?.userAgent || '');
  const bridge = win?.[BRIDGE];
  const usable = ua && !!bridge && typeof bridge.postMessage === 'function' && typeof bridge.addEventListener === 'function';
  let state = {known: false, can: false, all: false, key: ''};
  let helloWait = null, opWait = null, saveWait = null;
  const listeners = new Set();
  const send = t => { try { bridge.postMessage(t); return true; } catch { return false; } };
  if (usable) {
    bridge.addEventListener('message', event => {
      const d = typeof event?.data === 'string' ? event.data : '';
      const done = phoneDone(d);
      if (done) { const w = opWait; opWait = null; w?.(done); return; }
      const saved = phoneSaved(d);
      if (saved) { const w = saveWait; saveWait = null; w?.(saved); return; }
      const v = phoneState(d);
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
    // LOAD-끝있는불러오기(S51-29): 앱이 답하지 않으면 끝없이 기다렸다. 머리 받기까지 GET_MS 안(넘으면 timeout).
    let r;
    try { r = await within(signal => win.fetch(url(what, q), {cache: 'no-store', credentials: 'omit', signal}), GET_MS); }
    catch (e) { throw fail(isLoadTimeout(e) ? 'timeout' : 'unreached'); }
    if (!r.ok) {
      let code = 'read';
      try { const b = await r.json(); if (typeof b?.error === 'string' && /^[a-z_]{1,20}$/.test(b.error)) code = b.error; } catch { /* 본문 없음 */ }
      if (code === 'key') send('pfiles:hello');
      throw fail(code);
    }
    return r;
  }
  // 앱에 한 줄 보내고 그 답 하나를 기다린다(늦으면 timeout).
  const ask1 = (slot, text, ms, fallback) => new Promise(resolve => {
    let timer = null;
    const ok = v => { clearTimeout(timer); resolve(v); };
    if (slot === 'op') { opWait?.({...fallback, error: 'busy'}); opWait = ok; } else { saveWait?.({...fallback, error: 'busy'}); saveWait = ok; }
    const clear = () => { if (slot === 'op' && opWait === ok) opWait = null; if (slot === 'save' && saveWait === ok) saveWait = null; };
    timer = setTimeout(() => { clear(); ok({...fallback, error: 'timeout'}); }, ms);
    if (!send(text)) { clear(); ok({...fallback, error: 'write'}); }
  });
  const b64 = async blob => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return win.btoa(bin);
  };
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
    // 원본 바이트(미리보기·받기·클라우드로 올리기). 폰 안에서만 읽힌다.
    async blob(path) {
      if (!phonePathOk(path)) throw fail('blocked');
      return (await get('raw', {path})).blob();
    },
    // 쓰기(앱 3-③ 판, state.write): 사람이 누른 것만 — 화면이 묻고 난 뒤 부른다. 답 {ok, op, path, count, error}.
    op(body) {
      const fallback = {ok: false, op: body?.op || '', path: '', count: 0, error: ''};
      if (!state.all || !state.write) return Promise.resolve({...fallback, error: 'permission'});
      return ask1('op', 'pfiles:op:' + JSON.stringify({...body, confirm: true}), body?.op === 'trash' ? TRASH_MS : OP_MS, fallback);
    },
    // 클라우드 → 폰 받기: blob을 dir 폴더에 name으로(같은 이름이면 앱이 번호를 붙임). onStep(받은 바이트). 답 {ok, path, error}.
    async save(dir, name, blob, onStep) {
      const fallback = {ok: false, step: '', got: 0, path: '', error: ''};
      if (!state.all || !state.write) return {...fallback, error: 'permission'};
      if (dir && !phonePathOk(dir)) return {...fallback, error: 'blocked'};
      if (blob.size > PHONE_SAVE_MAX) return {...fallback, error: 'too_large'};
      let r = await ask1('save', 'pfiles:save:begin:' + JSON.stringify({dir: dir || '', name, size: blob.size, confirm: true}), SAVE_STEP_MS, fallback);
      if (!r.ok) return r;
      for (let at = 0; at < blob.size; at += SAVE_PART) {
        r = await ask1('save', 'pfiles:save:part:' + await b64(blob.slice(at, at + SAVE_PART)), SAVE_STEP_MS, fallback);
        if (!r.ok) { send('pfiles:save:cancel'); return r; }
        onStep?.(r.got);
      }
      r = await ask1('save', 'pfiles:save:end', SAVE_STEP_MS, fallback);
      if (!r.ok) send('pfiles:save:cancel');
      return r;
    },
    async thumb(path, large = false) {
      if (!phonePathOk(path)) throw fail('blocked');
      return (await get('thumb', {path, s: large ? 'large' : 'small'})).blob();
    },
  };
}
