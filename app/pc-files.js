// FILES-내PC드라이브 ②(S50-27, 설계 docs/design/files-pc-drive.md 2·3·4절, 시안 A): [파일] '내 PC'의 바구니 PC 앱 문 다리. PC 브라우저에서만 쓴다(폰 앱·폰 브라우저는 부르지 않음).
// - 바구니 PC 앱(0.3.0+, basket-pc PcDoor.cs)이 트레이 [웹2에서 이 PC 보기]를 켜면 그 PC 안에서만 127.0.0.1:47620~47622 문을 연다.
//   문은 Origin(Web2 주소 3개)·Host·매 요청 Web2 로그인 토큰(같은 계정만)을 본다. 이 다리는 그 문을 그대로 부르고, 검사를 바꾸거나 건너뛰지 않는다.
// - 부르는 것: GET /v1/hello · /v1/drives · /v1/list?path= , POST /v1/open · /v1/reveal {path}.
// - FILES-내PC클라우드옮기기(S52-41, 바구니 PC 앱 0.4.0+ — hello의 can에 read·write·trash): 사람이 누른 복사·옮기기만
//   GET /v1/read?path=&at=&len=(4MB 조각) · POST /v1/write/start {dir,name,size} → /v1/write/piece?id=&at=(바이트) → /v1/write/finish {id,numbered}
//   (실패하면 /v1/write/cancel), 옮기기 뒤 원본은 POST /v1/trash {path}(윈도우 휴지통, 파일만). 덮어쓰기는 문이 하지 않는다(같은 이름은 화면이 묻고 '이름 (2)').
// - 토큰은 요청 머리에만 싣고 화면·로그에 남기지 않는다. PC 목록·이름은 이 화면 메모리에만 있고 서버·브라우저 저장소에 저장하지 않는다.
// - 실패는 Error('pc_<까닭>')(files-model errorText가 한 줄로 바꾼다).
import {PC_PORTS, PC_PIECE, pcDoorOrigin, pcDriveRows, pcListRows, pcNorm, pcHelloOk, pcCode, pcCanList, pcCanXfer} from './pc-files-model.mjs';

const HELLO_MS = 1500, CALL_MS = 15000;

export function createPcFiles(win = globalThis.window, {enabled = true, token = async () => ''} = {}) {
  const usable = !!enabled && typeof win?.fetch === 'function';
  // known = 한 번 두드려 봄, ok = 문이 같은 계정으로 답함, why = 안 될 때 까닭('off'·'other_user'·…).
  let state = {known: false, ok: false, why: '', port: 0, version: '', can: []};
  let knocking = null;
  const listeners = new Set();
  const fail = code => Object.assign(new Error('pc_' + code), {pc: code});
  const set = next => {
    const changed = state.ok !== next.ok || state.why !== next.why || state.port !== next.port || !state.known;
    state = next;
    if (changed) listeners.forEach(fn => { try { fn(state); } catch { /* 한 곳 실패가 다른 곳을 막지 않게 */ } });
  };
  // raw = 바이트로 받기(읽기 조각) / bytes = 바이트로 보내기(쓰기 조각). 그 밖은 JSON.
  async function call(port, path, {method = 'GET', body = null, bytes = null, raw = false, ms = CALL_MS} = {}) {
    const t = await token();
    if (!t) throw fail('no_token');
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), ms) : 0;
    let r;
    try {
      r = await win.fetch(pcDoorOrigin(port) + path, {
        method, cache: 'no-store', credentials: 'omit', mode: 'cors', referrerPolicy: 'no-referrer', signal: ctl?.signal,
        headers: {Authorization: 'Bearer ' + t, ...(bytes ? {'Content-Type': 'application/octet-stream'} : body ? {'Content-Type': 'application/json'} : {})},
        ...(bytes ? {body: bytes} : body ? {body: JSON.stringify(body)} : {}),
      });
      if (raw && r.ok) return {bytes: await r.arrayBuffer(), size: Number(r.headers.get('X-Pc-Size'))};
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
    if (!usable) { set({known: true, ok: false, why: 'off', port: 0, version: '', can: []}); return state; }
    const perm = await permission();
    if (perm === 'denied') { set({known: true, ok: false, why: 'denied', port: 0, version: '', can: []}); return state; }
    if (auto && perm === 'prompt') { set({known: true, ok: false, why: 'ask', port: 0, version: '', can: []}); return state; }
    let why = 'off';
    for (const port of PC_PORTS) {
      try {
        const d = await call(port, '/v1/hello', {ms: HELLO_MS});
        if (pcHelloOk(d)) { set({known: true, ok: true, why: '', port, version: typeof d.version === 'string' ? d.version.slice(0, 20) : '', can: pcCanList(d)}); return state; }
        why = 'old_app';
      } catch (e) {
        const c = e?.pc || 'read';
        if (c === 'no_token') { why = c; break; }
        if (c !== 'unreached') { why = c; break; } // 문은 있다(그 번호가 바구니 앱). 다른 번호는 두드리지 않는다.
      }
    }
    set({known: true, ok: false, why, port: 0, version: '', can: []});
    return state;
  }
  const door = () => { if (!state.ok || !state.port) throw fail('off'); return state.port; };
  // 문이 사라지면(트레이에서 끔·앱 끔) 상태를 바꾼다.
  const guard = async run => {
    try { return await run(); } catch (e) {
      if (e?.pc === 'unreached' || e?.pc === 'other_user' || e?.pc === 'pc_signed_out') set({known: true, ok: false, why: e.pc === 'unreached' ? 'off' : e.pc, port: 0, version: '', can: []});
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
    // 내 PC ↔ 클라우드 복사·옮기기를 할 수 있는 문인가(0.4.0+).
    get canXfer() { return state.ok && pcCanXfer(state.can); },
    // 파일 하나를 4MB 조각으로 읽어 Blob으로(화면 메모리만). onProgress(받은 양, 전체). 읽는 동안 크기가 바뀌면 멈춘다.
    async read(path, {size = null, type = '', onProgress = null, signal = null} = {}) {
      const port = door(), at = pcNorm(path);
      if (!at) throw fail('bad_path');
      return guard(async () => {
        const parts = [];
        let off = 0, total = Number.isFinite(Number(size)) && size !== null ? Number(size) : -1;
        for (;;) {
          if (signal?.aborted) throw fail('stopped');
          const d = await call(port, `/v1/read?path=${encodeURIComponent(at)}&at=${off}&len=${PC_PIECE}`, {raw: true, ms: 60000});
          const n = d?.bytes?.byteLength || 0, whole = Number(d?.size);
          if (!Number.isFinite(whole) || whole < 0 || (total >= 0 && whole !== total)) throw fail('bad_range');
          total = whole;
          if (n) parts.push(d.bytes);
          off += n;
          onProgress?.(off, total);
          if (off >= total) break;
          if (!n) throw fail('bad_range');
        }
        return new Blob(parts, {type: type || ''});
      });
    },
    // 클라우드에서 받은 파일(Blob)을 그 PC 폴더에 새 파일로 쓴다. numbered = 같은 이름이면 '이름 (2)'. 답 = 실제 붙은 이름.
    //   실패하면 문이 숨긴 조각 파일을 지우게 cancel을 부른다(있던 파일은 건드리지 않음).
    async save(dir, name, blob, {numbered = false, onProgress = null} = {}) {
      const port = door(), at = pcNorm(dir);
      if (!at || typeof name !== 'string' || !name) throw fail('bad_path');
      return guard(async () => {
        const size = blob.size;
        const st = await call(port, '/v1/write/start', {method: 'POST', body: {dir: at, name, size}});
        const id = typeof st?.id === 'string' ? st.id : '';
        if (!id) throw fail('write_failed');
        try {
          for (let off = 0; off < size;) {
            const end = Math.min(size, off + PC_PIECE);
            await call(port, `/v1/write/piece?id=${encodeURIComponent(id)}&at=${off}`, {method: 'POST', bytes: blob.slice(off, end), ms: 60000});
            off = end;
            onProgress?.(off, size);
          }
          const d = await call(port, '/v1/write/finish', {method: 'POST', body: {id, ...(numbered ? {numbered: true} : {})}});
          return typeof d?.name === 'string' ? d.name : name;
        } catch (e) {
          try { await call(port, '/v1/write/cancel', {method: 'POST', body: {id}}); } catch { /* 문이 10분 뒤 스스로 지운다 */ }
          throw e;
        }
      });
    },
    // S52-41 ④ FILES-폴더고정: 이 PC의 고정한 폴더(경로는 그 PC 바구니 앱 안에만, 서버·브라우저 저장소에 넣지 않음). 문이 'pins'를 알 때만.
    get canPins() { return state.ok && state.can.includes('pins'); },
    async pins() {
      const port = door();
      const d = await guard(() => call(port, '/v1/pins'));
      return (Array.isArray(d?.pins) ? d.pins : []).map(pcNorm).filter(Boolean);
    },
    async setPins(list) {
      const port = door(), pins = (list || []).map(pcNorm);
      if (pins.some(p => !p)) throw fail('bad_path');
      const d = await guard(() => call(port, '/v1/pins', {method: 'POST', body: {pins}}));
      return (Array.isArray(d?.pins) ? d.pins : []).map(pcNorm).filter(Boolean);
    },
    // 옮기기 뒤 원본 파일 하나를 윈도우 휴지통으로(문이 파일만 받음).
    async trash(path) {
      const port = door(), at = pcNorm(path);
      if (!at) throw fail('bad_path');
      await guard(() => call(port, '/v1/trash', {method: 'POST', body: {path: at}}));
      return true;
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
