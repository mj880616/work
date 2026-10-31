import { test } from 'node:test';
import assert from 'node:assert/strict';
// OD-미리받기(2026-10-28): 앱을 켠 뒤 뒤에서 원드라이브 연결 확인·이번 달 목록·작은 그림 몇 장을 받아 두고, 일기를 열 때 그것을 쓴다.
// 지어낸 runtime만 쓴다(네트워크 없음). 받아 둔 것은 메모리뿐이라 기기 저장소를 흉내 내지 않는다.
const mod = await import('../app/diary-onedrive.js');
const {installOdWarm, WARM_START_MS, WARM_AGAIN_MS} = await import('../app/od-warm.js');

const TODAY = '2026-10-28';
const month = {days:{
  '2026-10-28':[{id:'T1'}, {id:'T2'}, {id:'T3'}, {id:'T4'}, {id:'T5'}],
  '2026-10-27':[{id:'Y1'}, {id:'Y2'}],
  '2026-10-25':[{id:'W1'}],
  '2026-10-20':[{id:'V1'}], '2026-10-19':[{id:'U1'}], '2026-10-18':[{id:'S1'}],
  '2026-10-30':[{id:'LATER'}],
}};
function runtime({connected = true, folder = true, user = 'u', fail = {}} = {}) {
  const calls = [];
  let ctx = {user:{id:user}, workspace:{id:'w'}};
  const rt = {calls, config:{url:'https://x.invalid', key:'k'}, context:{read:() => ctx}, setUser:id => { ctx = {user:{id}, workspace:{id:'w'}}; },
    session:{ensure:async () => true, read:() => ({access_token:'t'})},
    api:async (path, options = {}) => {
      const action = options.body?.action; calls.push(action);
      if (fail[action]) throw Object.assign(new Error(fail[action]), {status:502});
      if (action === 'status') return {configured:true, connected, folder:folder ? {name:'카메라'} : null, whole:folder, can_delete:true};
      // PHOTO-폴더스위치: 폴더 없는 새 연결이면 화면이 전체 보기로 바꾸기를 한 번 부탁한다(여기서는 실패로 답해 지금 모양 그대로).
      if (action === 'whole-drive') throw Object.assign(new Error('onedrive_unavailable'), {status:503});
      if (action === 'photos') return {days:Object.fromEntries(Object.entries(month.days).map(([d, l]) => [d, l.map(p => ({...p, name:p.id + '.jpg', taken_at:d + 'T01:00:00Z'}))]))};
      if (action === 'photo-urls') return {urls:Object.fromEntries(options.body.ids.map(id => [id, 'https://thumbs.example.test/' + id]))};
      throw new Error('unexpected ' + action);
    }};
  return rt;
}
const fresh = () => mod.clearOdPhotoCache();

test('not connected: one status check and nothing else (no list, no pictures)', async () => {
  fresh();
  for (const opts of [{connected:false}, {folder:false}]) {
    fresh(); const rt = runtime(opts);
    assert.deepEqual(await mod.odWarm(rt, {today:TODAY}), {done:false, why:'not-connected'});
    assert.deepEqual(rt.calls, opts.connected === false ? ['status'] : ['status', 'whole-drive']);
  }
  fresh(); const broken = runtime({fail:{status:'onedrive_unavailable'}});
  assert.deepEqual(await mod.odWarm(broken, {today:TODAY}), {done:false, why:'status'});
});

test('measure: opening the diary waits for 2 Edge calls in a row without warm-up, 0 after it', async () => {
  // 미리 받기 없음: 일기는 status → (끝나야) photos 차례로 기다린다.
  fresh(); const cold = runtime();
  await mod.odStatusCached(cold); assert.equal(mod.odTakeWarmMonth(cold, 2026, 9), null); await mod.odPhotos(cold, 2026, 9);
  assert.deepEqual(cold.calls, ['status', 'photos']);
  // 미리 받기 뒤: 앱을 켤 때 status·photos·photo-urls(작은 그림 8장을 한 번에)를 받아 두고, 일기를 열 때는 새 요청이 없다.
  fresh(); const rt = runtime();
  const out = await mod.odWarm(rt, {today:TODAY});
  assert.deepEqual(out, {done:true, picks:8, kept:0});
  assert.deepEqual(rt.calls, ['status', 'photos', 'photo-urls']);
  const before = rt.calls.length;
  const st = await mod.odStatusCached(rt);
  const data = await mod.odTakeWarmMonth(rt, 2026, 9);
  assert.equal(st.connected, true); assert.deepEqual(Object.keys(data.days).length, 7);
  assert.equal(rt.calls.length, before, 'no Edge call when the diary opens');
  // 앞쪽 작은 그림 주소는 대기열 메모리에 있어 날짜를 열 때 photo-urls를 다시 부르지 않는다.
  assert.equal(await mod.odPhotoUrl('T1', 'small', {rt}), 'https://thumbs.example.test/T1');
  assert.equal(rt.calls.length, before);
});

test('the warm month is taken once and only for 10 minutes; reload (force) and other months ask the server', async () => {
  fresh(); const rt = runtime(), t0 = Date.now();
  await mod.odWarm(rt, {today:TODAY, now:() => t0});
  assert.ok(mod.odTakeWarmMonth(rt, 2026, 9, {now:t0 + 1000}));
  assert.equal(mod.odTakeWarmMonth(rt, 2026, 9, {now:t0 + 2000}), null, 'second take asks the server');
  assert.equal(mod.odTakeWarmMonth(rt, 2026, 8, {now:t0}), null, 'only this month is warmed');
  fresh(); await mod.odWarm(rt, {today:TODAY, now:() => t0});
  assert.equal(mod.odTakeWarmMonth(rt, 2026, 9, {now:t0 + mod.WARM.monthMs}), null, 'older than 10 minutes');
  // 상태 force: 서버에 다시 묻고 받아 둔 달도 버린다(연결·폴더가 바뀐 뒤).
  fresh(); await mod.odWarm(rt, {today:TODAY, now:() => t0});
  const n = rt.calls.length; await mod.odStatusCached(rt, {force:true});
  assert.equal(rt.calls.length, n + 1); assert.equal(mod.odTakeWarmMonth(rt, 2026, 9), null);
  // 상태는 30분까지 다시 쓴다.
  const m = rt.calls.length; await mod.odStatusCached(rt, {now:Date.now() + 60000}); assert.equal(rt.calls.length, m);
  await mod.odStatusCached(rt, {now:Date.now() + mod.WARM.statusMs + 1}); assert.equal(rt.calls.length, m + 1);
});

test('a failed warm list makes the diary ask again; another signed-in person never gets the warm data', async () => {
  fresh(); const rt = runtime({fail:{photos:'onedrive_unavailable'}});
  assert.deepEqual(await mod.odWarm(rt, {today:TODAY}), {done:false, why:'photos'});
  assert.equal(mod.odTakeWarmMonth(rt, 2026, 9), null);
  fresh(); const a = runtime();
  await mod.odWarm(a, {today:TODAY});
  a.setUser('someone-else');
  assert.equal(mod.odTakeWarmMonth(a, 2026, 9), null);
  const n = a.calls.length; await mod.odStatusCached(a); assert.equal(a.calls.length, n + 1, 'status asked again for the new person');
});

test('picks: today first (front 4 in shown order), then the first photo of earlier days, 8 at most, never future days', () => {
  assert.deepEqual(mod.warmPicks(month, TODAY).map(p => p.id), ['T1', 'T2', 'T3', 'T4', 'Y1', 'W1', 'V1', 'U1']);
  assert.deepEqual(mod.warmPicks(month, '2026-10-26').map(p => p.id), ['W1', 'V1', 'U1', 'S1']);
  assert.deepEqual(mod.warmPicks({days:{}}, TODAY), []);
  assert.deepEqual(mod.warmPicks(null, TODAY), []);
  const p = mod.warmPicks(month, TODAY)[0];
  assert.deepEqual({kind:p.kind, source:p.source, key:p.key, day:p.day}, {kind:'od', source:'onedrive', key:'T1', day:'2026-10-28'});
});

function fakeWindow({view = 'home'} = {}) {
  const timers = [], listeners = {}, idles = [];
  const win = {
    KPTURuntime:{}, KPTURouter:{current:view},
    setTimeout:(fn, ms) => { timers.push({fn, ms}); return timers.length; },
    requestIdleCallback:(fn, opts) => { idles.push({fn, opts}); },
    document:{visibilityState:'visible', addEventListener:(name, fn) => { listeners[name] = fn; }},
  };
  return {win, timers, listeners, idles};
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('scheduler: waits for the first screen (timer + idle), once; skips on the diary and while hidden; again after 10 minutes away', async () => {
  let clock = 1000, loads = 0;
  const load = async () => { loads++; return {odWarm:async () => ({done:true})}; };
  const {win, timers, listeners, idles} = fakeWindow();
  const api = installOdWarm(win, {load, now:() => clock});
  assert.equal(installOdWarm(win, {load}), api, 'installed once');
  assert.equal(timers[0].ms, WARM_START_MS); assert.equal(loads, 0, 'nothing before the delay');
  timers[0].fn(); await flush();
  assert.equal(loads, 0, 'waits for an idle moment'); assert.equal(idles.length, 1); assert.equal(idles[0].opts.timeout, 3000);
  idles[0].fn(); await flush(); await flush();
  assert.equal(loads, 1);
  // 금방 다시 보이면 하지 않는다. 10분 넘게 가렸다가 보이면 한 번 더.
  clock += 60000; listeners.visibilitychange(); await flush(); assert.equal(idles.length, 1);
  clock += WARM_AGAIN_MS; listeners.visibilitychange(); await flush(); assert.equal(idles.length, 2);
  idles[1].fn(); await flush(); await flush(); assert.equal(loads, 2);
  // 일기 화면이 열려 있거나 앱이 가려져 있으면 하지 않는다(일기가 스스로 받는다).
  const d = fakeWindow({view:'diary'}); installOdWarm(d.win, {load}); d.timers[0].fn(); await flush(); assert.equal(d.idles.length, 0);
  const h = fakeWindow(); h.win.document.visibilityState = 'hidden'; installOdWarm(h.win, {load}); h.timers[0].fn(); await flush(); assert.equal(h.idles.length, 0);
  assert.equal(loads, 2);
});

test('the warm-up is loaded after the first screen is shown, not before', async () => {
  const {readFileSync} = await import('node:fs');
  const loader = readFileSync('app/loader-v2.js', 'utf8');
  const ready = loader.indexOf('__KPTU_MARK_APP_UI_READY__?.('), warmAt = loader.indexOf("import('./od-warm.js')");
  assert.ok(ready > 0 && warmAt > ready, 'od-warm.js comes after the UI-ready mark');
  // 기기 저장소를 쓰지 않는 것은 browser-storage-audit.yml이 저장소 전체에서 막는다.
});

test('only a connected status is reused; not connected / not configured is asked again each time (a connection made elsewhere shows up)', async () => {
  fresh(); const rt = runtime({connected:false});
  await mod.odWarm(rt, {today:TODAY});
  await mod.odStatusCached(rt);
  assert.deepEqual(rt.calls, ['status', 'status']);
  // 받는 중에는 함께 기다린다(같은 요청 하나).
  fresh(); const both = runtime({connected:false});
  const a = mod.odStatusCached(both), b = mod.odStatusCached(both);
  assert.equal(a, b); await a; assert.deepEqual(both.calls, ['status']);
});
