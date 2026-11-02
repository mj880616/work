// PHOTO-폰앱공유(요청함 11/01 21:26): 폰 앱(웹2 앱 0.4.7+) 안의 [공유] = 안드로이드 공유 창(카톡 등).
// 폰 앱 화면(WebView)에는 navigator.share가 없어 기기 공유 창이 뜨지 않는다. 그래서 앱 다리(KPTUAppShell, 허용 Origin 최상위 화면만)로 넘긴다.
// - 폰 사진(칸 data-diary-photo="ph:<번호>")은 번호만 넘긴다: 앱이 그 사진 파일을 그대로 공유 창에 넣는다(바이트를 웹으로 읽지 않음).
// - 원드라이브·구글 드라이브 사진은 이 화면이 이미 받은 그림 바이트를 조각(base64)으로 넘긴다: 앱이 앱 캐시에 써서 공유 창에 넣는다.
// 다리: out:hello → out:state:{"v":1} / out:start:{"count"} · out:phone:<번호> · out:begin:{"name","mime","size"} · out:part:<base64> · out:end
//   → 걸음마다 out:ack:{"ok","step","error"} / out:go → out:sent:{"ok","error"} / out:cancel. 규칙은 android-app ShareOutRules(JVM 시험).
// 옛 앱(0.4.6 이하)은 out:hello에 답하지 않는다 → 이 길 없음(known() false). PC·폰 브라우저에는 다리가 없다.
// 바이트는 이 화면 메모리에만, 기기 저장소에 두지 않는다. 사진 이름·내용은 로그에 쓰지 않는다.
const BRIDGE = 'KPTUAppShell';
export const OUT_HELLO_MS = 1500, OUT_STEP_MS = 30000, OUT_PART = 384 * 1024, OUT_MAX = 20;
const MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif'];

export function base64Of(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function createAppShare(win = globalThis.window, {helloMs = OUT_HELLO_MS, stepMs = OUT_STEP_MS} = {}) {
  const ua = /KPTUAndroid/i.test(win?.navigator?.userAgent || '');
  const bridge = win?.[BRIDGE];
  const usable = ua && !!bridge && typeof bridge.postMessage === 'function' && typeof bridge.addEventListener === 'function';
  let known = false, hello = null, wait = null, busy = false;
  const send = t => { try { bridge.postMessage(t); return true; } catch { return false; } };
  const parse = (d, head) => { try { return JSON.parse(d.slice(head.length)); } catch { return null; } };
  if (usable) {
    bridge.addEventListener('message', event => {
      const d = typeof event?.data === 'string' ? event.data : '';
      if (d.startsWith('out:state:')) { known = parse(d, 'out:state:')?.v >= 1; const h = hello; hello = null; h?.ok(known); }
      else if (d.startsWith('out:ack:') || d.startsWith('out:sent:')) {
        const sent = d.startsWith('out:sent:'), v = parse(d, sent ? 'out:sent:' : 'out:ack:');
        const r = {ok:v?.ok === true, step:sent ? 'sent' : String(v?.step || ''), error:typeof v?.error === 'string' ? v.error.slice(0, 20) : 'failed'};
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
    const timer = setTimeout(() => { if (wait === me) wait = null; finish({ok:false, step:'', error:'timeout'}); }, stepMs);
    wait = me;
    if (!send(text)) { wait = null; finish({ok:false, step:'', error:'failed'}); }
  });
  const api = {
    get usable() { return usable; },
    // 이 앱 판이 공유 창 길을 안다(out:hello에 답함).
    known: () => usable && known,
    // 처음 한 번 묻는다(옛 앱은 helloMs 뒤 false). 이미 알면 바로.
    ready() {
      if (!usable) return Promise.resolve(false);
      if (known) return Promise.resolve(true);
      if (hello) return hello.promise;
      let ok;
      const promise = new Promise(r => { ok = r; });
      hello = {ok, promise};
      setTimeout(() => { if (hello?.promise === promise) { hello = null; ok(false); } }, helloMs);
      if (!send('out:hello')) { hello = null; ok(false); }
      return promise;
    },
    // entries: [{phoneId:'123'} | {file: File|Blob(name 있음)}] (20장까지).
    // 돌려주는 값: 'shared'(공유 창을 띄움) · 'none'(넘길 것 없음·앱이 사진을 못 찾음) · 'busy'(앞 공유가 아직) · 'failed'.
    async share(entries, {alive = () => true} = {}) {
      if (!usable || !known) return 'failed';
      const list = (entries || []).filter(e => (e?.phoneId && /^\d{1,18}$/.test(String(e.phoneId))) || (e?.file && e.file.size > 0)).slice(0, OUT_MAX);
      if (!list.length) return 'none';
      if (busy) return 'busy';
      busy = true;
      try {
        const fail = r => { send('out:cancel'); return r?.error === 'none' ? 'none' : 'failed'; };
        let r = await step(`out:start:${JSON.stringify({count:list.length})}`, 'start');
        if (!r.ok) return fail(r);
        for (const e of list) {
          if (!alive()) { send('out:cancel'); return 'failed'; }
          if (e.phoneId) { r = await step(`out:phone:${e.phoneId}`, 'phone'); if (!r.ok) return fail(r); continue; }
          const file = e.file, mime = MIMES.includes(file.type) ? file.type : 'image/jpeg';
          r = await step(`out:begin:${JSON.stringify({name:String(file.name || 'photo.jpg').slice(0, 255), mime, size:file.size})}`, 'begin');
          if (!r.ok) return fail(r);
          for (let at = 0; at < file.size; at += OUT_PART) {
            let part = '';
            try { part = base64Of(new Uint8Array(await file.slice(at, at + OUT_PART).arrayBuffer())); } catch { part = ''; }
            if (!part) return fail();
            r = await step(`out:part:${part}`, 'part');
            if (!r.ok) return fail(r);
          }
          r = await step('out:end', 'end');
          if (!r.ok) return fail(r);
        }
        if (!alive()) { send('out:cancel'); return 'failed'; }
        r = await step('out:go', 'sent');
        return r.ok ? 'shared' : r.error === 'none' ? 'none' : 'failed';
      } finally { busy = false; }
    },
  };
  return api;
}
// 폰 사진 칸의 번호(phone-photos.js element: data-diary-photo="ph:<번호>"). 아니면 ''.
export function phoneIdOf(el) {
  const m = /^ph:(\d{1,18})$/.exec(String(el?.dataset?.diaryPhoto || ''));
  return m ? m[1] : '';
}
// 폰 앱 화면인가(다리 유무와 별개로 앱 이름표). 옛 앱에서 '파일로 저장했어요'처럼 틀린 말을 하지 않으려고 쓴다.
export const inPhoneApp = (win = globalThis.window) => /KPTUAndroid/i.test(win?.navigator?.userAgent || '');

let shared = null;
export const appShare = () => (shared ||= createAppShare());
// 화면이 뜰 때 미리 한 번 물어 둔다(앱 안에서만, 기다리지 않음).
if (typeof window !== 'undefined') queueMicrotask(() => { try { appShare().ready(); } catch { /* 다리 없음 */ } });
