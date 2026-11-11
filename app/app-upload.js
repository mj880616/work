// APP-뒤에서올리기 1단계(요청함 11/11 06:56, 설계 docs/design/phone-widget-auth.md 16절): 폰 앱 안에서 고른 사진·파일을 앱에 넘겨 뒤에서 올린다.
// 폰 앱 화면(WebView)은 앱이 뒤로 가면 화면 안 올리기가 끊긴다. 그래서 앱 다리(KPTUAppShell, 허용 Origin 최상위 화면만)로 파일을 넘기고,
// 앱이 앱 전용 임시 폴더 → WorkManager로 지금 서버 입구(library-files)에 올린다. 다른 앱으로 가도·앱을 닫아도·인터넷이 잠깐 끊겨도 이어진다.
// 다리: up:hello → up:state:{"v":1,"on","kinds":["meeting"],"jobs":[…]} / up:start:{"kind","meeting","project","count"} → up:ack(id)
//   · up:begin:{"name","mime","size","title","category","date"} · up:part:<base64> · up:end → 걸음마다 up:ack:{"ok","step","error"}
//   · up:go → up:ack(id) / up:cancel / up:seen:<묶음> / (앱 → 웹) up:job:{"id","kind","target","total","left","state","reason","docs","errors"}
//   규칙은 android-app BackUploadRules(JVM 시험).
// 이 모듈은 '다리가 있으면 넘긴다'만 한다: 넘기지 못하면 {ok:false}를 돌려주고, 부른 곳이 지금 길(화면 안 올리기)로 올린다.
// PC·폰 브라우저에는 다리가 없고, 옛 앱은 up:hello에 답하지 않으며, 위젯 로그인이 없는 앱은 on:false로 답한다 → 모두 지금 길.
// 넘기는 것은 파일 바이트·대상 id·사진 칸(제목·종류·날짜)뿐이다. 로그인 정보·토큰은 이 모듈이 읽지도 넘기지도 않는다.
// 바이트는 이 화면 메모리에만, 기기 저장소에 두지 않는다. 파일 이름·내용은 로그에 쓰지 않는다.
const BRIDGE = 'KPTUAppShell';
export const UP_HELLO_MS = 1500, UP_STEP_MS = 30000, UP_PART = 384 * 1024, UP_MAX = 20, UP_FILE_MAX = 100 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BATCH = /^[A-Za-z0-9_-]{16,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATES = ['run', 'done', 'stopped'];

function base64Of(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// 앱이 알려 준 묶음 하나를 화면이 쓰는 모양으로(모르는 값은 버린다). docs·errors는 넘긴 파일 순서 그대로다.
function readJob(v) {
  if (!v || typeof v !== 'object' || !BATCH.test(String(v.id || '')) || !STATES.includes(v.state)) return null;
  const list = a => (Array.isArray(a) ? a.slice(0, UP_MAX).map(x => (typeof x === 'string' ? x : '')) : []);
  const n = x => (Number.isInteger(x) && x >= 0 && x <= UP_MAX ? x : 0);
  return {
    id: v.id, kind: String(v.kind || ''), target: UUID.test(String(v.target || '')) ? String(v.target).toLowerCase() : '',
    total: n(v.total), left: n(v.left), state: v.state, reason: typeof v.reason === 'string' ? v.reason.slice(0, 20) : '',
    docs: list(v.docs).map(d => (UUID.test(d) ? d.toLowerCase() : '')), errors: list(v.errors).map(e => e.slice(0, 20)),
  };
}

// 사진 칸: 웹 photoUploadFields가 만든 것({title, category, document_date}) 그대로 받는다.
function beginText(file, fields) {
  const o = {name: String(file.name || '').slice(0, 255), mime: String(file.type || ''), size: file.size};
  const title = String(fields?.title || '').trim(), category = String(fields?.category || '').trim(), date = String(fields?.document_date || '');
  if (title) o.title = title.slice(0, 200);
  if (category) o.category = category.slice(0, 40);
  if (DATE.test(date)) o.date = date;
  return `up:begin:${JSON.stringify(o)}`;
}

export function createAppUpload(win = globalThis.window, {helloMs = UP_HELLO_MS, stepMs = UP_STEP_MS} = {}) {
  const ua = /KPTUAndroid/i.test(win?.navigator?.userAgent || '');
  const bridge = win?.[BRIDGE];
  const usable = ua && !!bridge && typeof bridge.postMessage === 'function' && typeof bridge.addEventListener === 'function';
  let known = false, on = false, kinds = [], hello = null, wait = null, busy = false, watching = false;
  const jobs = new Map(), listeners = new Set();
  const send = t => { try { bridge.postMessage(t); return true; } catch { return false; } };
  const parse = (d, head) => { try { return JSON.parse(d.slice(head.length)); } catch { return null; } };
  const tell = job => { for (const fn of [...listeners]) { try { fn(job); } catch {} } };
  const keep = raw => { const job = readJob(raw); if (!job) return; jobs.set(job.id, job); tell(job); };
  if (usable) {
    bridge.addEventListener('message', event => {
      const d = typeof event?.data === 'string' ? event.data : '';
      if (d.startsWith('up:state:')) {
        const v = parse(d, 'up:state:');
        known = v?.v >= 1; on = known && v?.on === true;
        kinds = known && Array.isArray(v?.kinds) ? v.kinds.filter(k => typeof k === 'string').slice(0, 20) : [];
        // 앱이 아는 묶음이 곧 전부다(화면이 닫혀 있던 동안 끝난 것 포함). 앱에 없는 것은 지운다.
        if (known && Array.isArray(v?.jobs)) { jobs.clear(); v.jobs.slice(0, 50).forEach(keep); }
        const h = hello; hello = null; h?.ok(known && on);
      } else if (d.startsWith('up:job:')) keep(parse(d, 'up:job:'));
      else if (d.startsWith('up:ack:')) {
        const v = parse(d, 'up:ack:');
        const r = {ok: v?.ok === true, step: String(v?.step || ''), error: typeof v?.error === 'string' ? v.error.slice(0, 20) : 'failed', id: BATCH.test(String(v?.id || '')) ? v.id : ''};
        // 늦게 온 앞 걸음의 답이 다음 걸음을 끝내지 않게, 기다리는 걸음 이름이 같을 때만(앱이 'bad'로 거절하면 그대로 실패).
        if (wait && (r.step === wait.want || r.step === 'bad')) { const w = wait; wait = null; w.finish(r); }
      }
    });
  }
  // 한 걸음 보내고 답을 기다린다(시간 제한). 답이 없으면 실패.
  const step = (text, want) => new Promise(ok => {
    let done = false;
    const finish = r => { if (done) return; done = true; clearTimeout(timer); ok(r); };
    const me = {want, finish};
    const timer = setTimeout(() => { if (wait === me) wait = null; finish({ok: false, step: '', error: 'timeout', id: ''}); }, stepMs);
    wait = me;
    if (!send(text)) { wait = null; finish({ok: false, step: '', error: 'failed', id: ''}); }
  });
  const ask = () => {
    if (!usable) return Promise.resolve(false);
    if (hello) return hello.promise;
    let ok;
    const promise = new Promise(r => { ok = r; });
    hello = {ok, promise};
    setTimeout(() => { if (hello?.promise === promise) { hello = null; ok(false); } }, helloMs);
    if (!send('up:hello')) { hello = null; ok(false); }
    return promise;
  };
  // 화면으로 돌아오면 앱에 다시 묻는다: 뒤에 있는 동안 끝난 묶음을 알고, 멈춰 있던 묶음은 앱이 이때 다시 건다.
  const watch = () => {
    if (watching || !usable || typeof win?.document?.addEventListener !== 'function') return;
    watching = true;
    win.document.addEventListener('visibilitychange', () => { if (win.document.visibilityState === 'visible' && known) void ask(); });
  };
  const api = {
    get usable() { return usable; },
    // 이 앱 판이 뒤에서 올리기를 안다(up:hello에 답함).
    known: () => usable && known,
    // 지금 뒤에서 올릴 수 있다(위젯 로그인 있음).
    on: () => usable && known && on,
    can: kind => api.on() && kinds.includes(kind),
    // 앱에 묻는다(옛 앱은 helloMs 뒤 false). 답: 이 앱이 지금 뒤에서 올릴 수 있는지. 부를 때마다 새로 묻는다(위젯 로그인이 그사이 바뀔 수 있음).
    ready() { watch(); return ask(); },
    // 앱이 알려 준 묶음들(올리는 중·끝남·멈춤). target을 주면 그 대상 것만.
    jobs: target => [...jobs.values()].filter(j => !target || j.target === String(target).toLowerCase()),
    // 묶음이 바뀔 때마다 부른다(올리는 중 → 끝). 돌려주는 함수를 부르면 그만 듣는다.
    onJob(fn) { if (typeof fn !== 'function') return () => {}; listeners.add(fn); return () => listeners.delete(fn); },
    // 끝난 묶음을 화면이 반영했으면(목록 새로 읽음) 앱의 기록을 지운다.
    seen(id) { if (!usable || !BATCH.test(String(id || ''))) return false; jobs.delete(id); return send(`up:seen:${id}`); },
    // target: {kind:'meeting', meeting:<사업 보고 id>, project:<사업영역 id 또는 ''>}
    // entries: [{file: File|Blob(name 있음), fields: {title, category, document_date}(사진만, 없어도 됨)}] (20개까지, 한 개 100MB까지)
    // 돌려주는 값: {ok:true, id, count}(앱이 받아 뒤에서 올리기 시작) 또는 {ok:false, error}.
    //   error: 'off'(다리 없음·옛 앱·위젯 로그인 없음·모르는 대상) · 'none' · 'too_many' · 'too_big' · 'busy' · 'space'(폰 빈 공간 모자람) · 'failed' · 'timeout'
    //   ok:false면 앱에 남는 것이 없다(받다 만 묶음은 버림). 부른 곳은 지금 길로 올리면 된다.
    async send(target, entries, {alive = () => true} = {}) {
      const kind = String(target?.kind || ''), meeting = String(target?.meeting || '').toLowerCase(), project = String(target?.project || '').toLowerCase();
      if (!api.can(kind) || kind !== 'meeting' || !UUID.test(meeting) || (project && !UUID.test(project))) return {ok: false, error: 'off'};
      const list = (entries || []).filter(e => e?.file);
      if (!list.length || list.some(e => !(e.file.size > 0))) return {ok: false, error: 'none'};
      if (list.length > UP_MAX) return {ok: false, error: 'too_many'};
      if (list.some(e => e.file.size > UP_FILE_MAX)) return {ok: false, error: 'too_big'};
      if (busy) return {ok: false, error: 'busy'};
      busy = true;
      try {
        const fail = r => { send('up:cancel'); return {ok: false, error: r?.error && r.error !== 'bad' ? r.error : 'failed'}; };
        let r = await step(`up:start:${JSON.stringify({kind, meeting, project, count: list.length})}`, 'start');
        if (!r.ok || !r.id) return fail(r);
        const id = r.id;
        for (const e of list) {
          if (!alive()) return fail();
          r = await step(beginText(e.file, e.fields), 'begin');
          if (!r.ok) return fail(r);
          for (let at = 0; at < e.file.size; at += UP_PART) {
            let part = '';
            try { part = base64Of(new Uint8Array(await e.file.slice(at, at + UP_PART).arrayBuffer())); } catch { part = ''; }
            if (!part) return fail();
            r = await step(`up:part:${part}`, 'part');
            if (!r.ok) return fail(r);
          }
          r = await step('up:end', 'end');
          if (!r.ok) return fail(r);
        }
        if (!alive()) return fail();
        r = await step('up:go', 'go');
        if (!r.ok) return fail(r);
        return {ok: true, id, count: list.length};
      } finally { busy = false; }
    },
  };
  return api;
}

// 화면 하나에 다리 하나.
let shared = null;
export function appUpload(win = globalThis.window) {
  if (!shared || shared.win !== win) shared = {win, api: createAppUpload(win)};
  return shared.api;
}

// 실패 까닭 코드(앱 BackUploadRules와 같음) → 화면에 보일 한 줄. 인터넷 탓이 아닐 때 '인터넷' 문구를 쓰지 않는다.
export function uploadReasonText(code) {
  switch (String(code || '')) {
    case 'network': return '인터넷이 끊겨 있어요';
    case 'server': return '서버가 잠시 답하지 않아요';
    case 'signed_out': return '위젯 로그인이 풀렸어요';
    case 'too_big': return '파일이 너무 커요(100MB까지)';
    case 'forbidden': return '올릴 권한을 확인하지 못했어요';
    case 'gone': return '사업 보고를 찾지 못했어요';
    case 'unknown': return '올렸는지 확인하지 못했어요';
    case 'missing': return '임시 파일이 사라졌어요';
    case 'internal': return '앱이 올리기를 잇지 못했어요';
    default: return '서버가 받지 않았어요';
  }
}
