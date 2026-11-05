// FILES-내PC드라이브 ②(S50-27, 설계 docs/design/files-pc-drive.md 2·3·4절, 시안 A): [파일] '내 PC'의 바구니 PC 앱 문 다리. PC 브라우저에서만 쓴다(폰 앱·폰 브라우저는 부르지 않음).
// - 바구니 PC 앱(0.3.0+, basket-pc PcDoor.cs)이 트레이 [웹2에서 이 PC 보기]를 켜면 그 PC 안에서만 127.0.0.1:47620~47622 문을 연다.
//   문은 Origin(Web2 주소 3개)·Host·매 요청 Web2 로그인 토큰(같은 계정만)을 본다. 이 다리는 그 문을 그대로 부르고, 검사를 바꾸거나 건너뛰지 않는다.
// - 부르는 것: GET /v1/hello · /v1/drives · /v1/list?path= , POST /v1/open · /v1/reveal {path}. 이 단계는 보기·열기만(쓰기 없음).
// - 토큰은 요청 머리에만 싣고 화면·로그에 남기지 않는다. PC 목록·이름은 이 화면 메모리에만 있고 서버·브라우저 저장소에 저장하지 않는다.
// - 실패는 Error('pc_<까닭>')(files-model errorText가 한 줄로 바꾼다).
import {PC_PORTS, pcDoorOrigin, pcDriveRows, pcListRows, pcNorm, pcHelloOk, pcCode} from './pc-files-model.mjs';

const HELLO_MS = 1500, CALL_MS = 15000;

export function createPcFiles(win = globalThis.window, {enabled = true, token = async () => ''} = {}) {
  const usable = !!enabled && typeof win?.fetch === 'function';
  // known = 한 번 두드려 봄, ok = 문이 같은 계정으로 답함, why = 안 될 때 까닭('off'·'other_user'·…).
  let state = {known: false, ok: false, why: '', port: 0, version: ''};
  let knocking = null;
  const listeners = new Set();
  const fail = code => Object.assign(new Error('pc_' + code), {pc: code});
  const set = next => {
    const changed = state.ok !== next.ok || state.why !== next.why || state.port !== next.port || !state.known;
    state = next;
    if (changed) listeners.forEach(fn => { try { fn(state); } catch { /* 한 곳 실패가 다른 곳을 막지 않게 */ } });
  };
  async function call(port, path, {method = 'GET', body = null, ms = CALL_MS} = {}) {
    const t = await token();
    if (!t) throw fail('no_token');
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), ms) : 0;
    let r;
    try {
      r = await win.fetch(pcDoorOrigin(port) + path, {
        method, cache: 'no-store', credentials: 'omit', mode: 'cors', referrerPolicy: 'no-referrer', signal: ctl?.signal,
        headers: {Authorization: 'Bearer ' + t, ...(body ? {'Content-Type': 'application/json'} : {})},
        ...(body ? {body: JSON.stringify(body)} : {}),
      });
    } catch { throw fail('unreached'); } finally { clearTimeout(timer); }
    let data = null;
    try { data = await r.json(); } catch { /* 본문 없음 */ }
    if (!r.ok) throw Object.assign(fail(pcCode(r.status, data?.error)), {status: r.status});
    return data;
  }
  // 크롬 '로컬 네트워크 접근' 허락 상태. 'prompt'면 저절로 두드리지 않는다(바구니 앱이 없는 PC에서 [파일]만 열어도 허락 창이 뜨지 않게).
  //   이름은 크롬 판마다 다르다(loopback-network · local-network-access). 둘 다 모르면 허락 창이 없는 브라우저로 본다.
  async function permission() {
    const q = win?.navigator?.permissions?.query;
    if (typeof q !== 'function') return 'unknown';
    const seen = [];
    for (const name of ['loopback-network', 'local-network-access']) {
      try { const r = await q.call(win.navigator.permissions, {name}); if (r?.state) seen.push(r.state); } catch { /* 이 판은 모르는 이름 */ }
    }
    // 두 이름 중 하나라도 허락됐으면 허락(판이 바뀌며 이름이 옮겨 감), 막혔으면 막힘, 남은 것이 물음이면 물음.
    return ['granted', 'denied', 'prompt'].find(v => seen.includes(v)) || 'unknown';
  }
  // 문 찾기: 후보 번호를 차례로 두드린다. 문이 답했지만 거절(다른 계정·로그아웃)이면 그 까닭을 남긴다.
  // auto = 화면을 열 때 저절로(허락 창을 띄울 수 있으면 두드리지 않음) / 아니면 사람이 누름.
  async function knock(auto) {
    if (!usable) { set({known: true, ok: false, why: 'off', port: 0, version: ''}); return state; }
    const perm = await permission();
    if (perm === 'denied') { set({known: true, ok: false, why: 'denied', port: 0, version: ''}); return state; }
    if (auto && perm === 'prompt') { set({known: true, ok: false, why: 'ask', port: 0, version: ''}); return state; }
    let why = 'off';
    for (const port of PC_PORTS) {
      try {
        const d = await call(port, '/v1/hello', {ms: HELLO_MS});
        if (pcHelloOk(d)) { set({known: true, ok: true, why: '', port, version: typeof d.version === 'string' ? d.version.slice(0, 20) : ''}); return state; }
        why = 'old_app';
      } catch (e) {
        const c = e?.pc || 'read';
        if (c === 'no_token') { why = c; break; }
        if (c !== 'unreached') { why = c; break; } // 문은 있다(그 번호가 바구니 앱). 다른 번호는 두드리지 않는다.
      }
    }
    set({known: true, ok: false, why, port: 0, version: ''});
    return state;
  }
  const door = () => { if (!state.ok || !state.port) throw fail('off'); return state.port; };
  // 문이 사라지면(트레이에서 끔·앱 끔) 상태를 바꾼다.
  const guard = async run => {
    try { return await run(); } catch (e) {
      if (e?.pc === 'unreached' || e?.pc === 'other_user' || e?.pc === 'pc_signed_out') set({known: true, ok: false, why: e.pc === 'unreached' ? 'off' : e.pc, port: 0, version: ''});
      throw e;
    }
  };
  return {
    usable,
    get state() { return state; },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    // 두드려 보기(여러 곳에서 불러도 한 번만).
    hello({auto = false} = {}) {
      if (!knocking) knocking = knock(auto).finally(() => { knocking = null; });
      return knocking;
    },
    // 폴더 안 목록. dir = null이면 드라이브 목록(C:·D: …).
    async list(dir) {
      const port = door();
      if (!dir) return guard(async () => pcDriveRows(await call(port, '/v1/drives')));
      const at = pcNorm(dir);
      if (!at) throw fail('bad_path');
      return guard(async () => {
        const rows = pcListRows(await call(port, '/v1/list?path=' + encodeURIComponent(at)), at);
        if (!rows) throw fail('read');
        return rows;
      });
    },
    // 그 PC의 기본 프로그램으로 열기(실행 파일·모르는 종류는 앱이 탐색기 위치만 연다). 답 'opened' | 'revealed'.
    async open(path, {reveal = false} = {}) {
      const port = door(), at = pcNorm(path);
      if (!at) throw fail('bad_path');
      const d = await guard(() => call(port, reveal ? '/v1/reveal' : '/v1/open', {method: 'POST', body: {path: at}}));
      return d?.done === 'revealed' ? 'revealed' : 'opened';
    },
  };
}
