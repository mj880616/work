// OD-속도(2026-10-28): 원드라이브 사진 받기 대기열. 화면에 보이는 칸부터, 정해진 개수만 동시에, 같은 사진은 한 번만 받는다.
// - 기억은 이 화면을 보는 동안의 메모리(Map)뿐이다. 기기에 남기지 않는다(브라우저 일반 HTTP 캐시는 주소 단위로 저절로 쓰인다).
// - 받는 길은 두 가지다. ① 'urls': 서버가 여러 장의 짧게 사는 썸네일 주소를 한 번에 준다(photo-urls). ② 'bytes': 서버가 한 장씩 그림을 넘긴다(photo).
//   서버가 photo-urls를 아직 모르면(배포 전) 그 뒤로는 ②만 쓴다. 주소로 그림을 못 띄운 사진은 그 사진만 ②로 다시 받는다.
// - 순서: 0 보이는 칸 → 1 곧 보일 칸(아래 몇 줄 앞) → 2 미리 받기(달 달력 등). 낮은 숫자가 먼저.
// - 요청이 많다(429)는 답을 받으면 retry_after초 동안 대기열 전체를 쉰다.

export const VISIBLE = 0, NEAR = 1, IDLE = 2;
export const LOADER_DEFAULTS = Object.freeze({limit: 4, batchMax: 20, memMax: 300, ttlMs: 20 * 60 * 1000});
const MISSING = new Set(['missing', 'outside']);

export class ThumbError extends Error {
  constructor(code, {retryAfter = 0} = {}) { super(code); this.code = code; this.retryAfter = retryAfter; }
}

// fetchUrls(ids, size) → {urls:Map|object, failed:Map|object, retryAfter} (요청 실패는 throw, 서버가 이 동작을 모르면 ThumbError('unsupported'))
// fetchBytes(id, size) → object URL(문자열) (실패는 throw, 429는 ThumbError('throttled', {retryAfter}))
// revoke(url): bytes로 만든 object URL을 놓을 때 부른다.
export function createThumbLoader({fetchUrls, fetchBytes, revoke = () => {}, now = Date.now, setTimer = setTimeout, ...options} = {}) {
  const {limit, batchMax, memMax, ttlMs} = {...LOADER_DEFAULTS, ...options};
  const memo = new Map();      // key → {url, kind:'remote'|'blob', at}  (넣은 순서 = 오래된 순)
  const flights = new Map();   // key → {promise, resolve, reject, id, size, prio, queued}
  const bytesOnly = new Set(); // 주소로는 그림이 안 떠서 ②로만 받을 사진 key
  let mode = fetchUrls ? 'urls' : 'bytes', active = 0, pausedUntil = 0, wake = null, generation = 0;
  const stats = {requests: 0, maxActive: 0};
  const keyOf = (id, size) => `${id}:${size}`;

  function remember(key, url, kind) {
    memo.delete(key);
    memo.set(key, {url, kind, at: now()});
    while (memo.size > memMax) {
      const [oldKey, old] = memo.entries().next().value;
      memo.delete(oldKey);
      if (old.kind === 'blob') revoke(old.url);
    }
  }
  function cachedUrl(key) {
    const hit = memo.get(key);
    if (!hit) return null;
    if (hit.kind === 'remote' && now() - hit.at > ttlMs) { memo.delete(key); return null; }
    memo.delete(key); memo.set(key, hit); // 최근에 쓴 것을 뒤로(상한을 넘으면 오래 안 쓴 것부터 버린다)
    return hit.url;
  }

  function settle(key, error, url, kind) {
    const f = flights.get(key);
    if (!f) return;
    flights.delete(key);
    if (error) f.reject(error); else { remember(key, url, kind); f.resolve(url); }
  }
  function pause(seconds) {
    const s = Math.min(120, Math.max(1, Number.isFinite(Number(seconds)) ? Number(seconds) : 10));
    pausedUntil = Math.max(pausedUntil, now() + s * 1000);
  }
  function pending() {
    return [...flights.entries()].filter(([, f]) => f.queued).sort((a, b) => a[1].prio - b[1].prio || a[1].seq - b[1].seq);
  }
  function pump() {
    if (wake) return;
    const wait = pausedUntil - now();
    if (wait > 0) { wake = setTimer(() => { wake = null; pump(); }, wait); return; }
    while (active < limit) {
      const queue = pending();
      if (!queue.length) return;
      const [firstKey, first] = queue[0];
      const useUrls = mode === 'urls' && !bytesOnly.has(firstKey);
      // 한 장씩 받는 길에서는 미리 받기(IDLE)를 하지 않는다(요청 수를 늘리지 않게). 칸이 실제로 보이면 그때 받는다.
      if (!useUrls && first.prio >= IDLE) { settle(firstKey, new ThumbError('dropped')); continue; }
      const take = useUrls
        ? queue.filter(([k, f]) => f.size === first.size && !bytesOnly.has(k)).slice(0, batchMax)
        : [queue[0]];
      for (const [, f] of take) f.queued = false;
      active++; stats.requests++; stats.maxActive = Math.max(stats.maxActive, active);
      const gen = generation;
      const job = useUrls ? runUrls(take, first.size, gen) : runBytes(firstKey, first, gen);
      job.finally(() => { if (gen === generation) { active--; pump(); } });
    }
  }
  async function runUrls(take, size, gen) {
    let out;
    try { out = await fetchUrls(take.map(([, f]) => f.id), size); }
    catch (error) {
      if (gen !== generation) return;
      if (error?.code === 'unsupported') { mode = 'bytes'; for (const [, f] of take) f.queued = true; return; }
      if (error?.code === 'throttled') { pause(error.retryAfter); for (const [, f] of take) f.queued = true; return; }
      for (const [key] of take) settle(key, error);
      return;
    }
    if (gen !== generation) return;
    const urls = out?.urls instanceof Map ? out.urls : new Map(Object.entries(out?.urls || {}));
    const failed = out?.failed instanceof Map ? out.failed : new Map(Object.entries(out?.failed || {}));
    let throttled = false;
    for (const [key, f] of take) {
      const url = urls.get(f.id), why = failed.get(f.id);
      if (typeof url === 'string' && url) settle(key, null, url, 'remote');
      else if (why === 'throttled') { throttled = true; f.queued = true; }
      else if (MISSING.has(why)) settle(key, new ThumbError(why));
      else { bytesOnly.add(key); f.queued = true; } // 주소를 못 받은 사진은 그 사진만 한 장씩 받기로
    }
    if (throttled) pause(out?.retryAfter);
  }
  async function runBytes(key, f, gen) {
    try {
      const url = await fetchBytes(f.id, f.size);
      if (gen !== generation) { revoke(url); return; }
      settle(key, null, url, 'blob');
    } catch (error) {
      if (gen !== generation) return;
      if (error?.code === 'throttled') { pause(error.retryAfter); f.queued = true; return; }
      settle(key, error);
    }
  }

  // 같은 순간에 들어온 요청을 한 묶음으로 보내려고, 대기열 돌리기는 지금 하던 일이 끝난 직후(microtask)로 미룬다.
  let scheduled = false;
  const schedule = () => { if (scheduled) return; scheduled = true; queueMicrotask(() => { scheduled = false; pump(); }); };
  let seq = 0;
  // 사진 하나의 그림 주소. 이미 받았으면 바로, 받는 중이면 같은 약속을 돌려준다(중복 요청 합치기). prio가 더 급하면 앞으로 당긴다.
  function get(id, size = 'small', prio = VISIBLE) {
    const key = keyOf(id, size), hit = cachedUrl(key);
    if (hit) return Promise.resolve(hit);
    const f = flights.get(key);
    if (f) { f.wants++; if (prio < f.prio) f.prio = prio; schedule(); return f.promise; }
    let resolve, reject;
    const promise = new Promise((a, b) => { resolve = a; reject = b; });
    promise.catch(() => {});
    flights.set(key, {promise, resolve, reject, id, size, prio, queued: true, seq: seq++, wants: 1});
    schedule();
    return promise;
  }
  // 받는 중인 요청을 더 급하게(prio가 작을수록 먼저). 기다리는 칸 수는 늘리지 않는다.
  function bump(id, size = 'small', prio = VISIBLE) {
    const f = flights.get(keyOf(id, size));
    if (f && prio < f.prio) { f.prio = prio; schedule(); }
  }
  // 칸 하나가 더는 기다리지 않는다(화면에서 멀어짐). 기다리는 칸이 하나도 없고 아직 차례가 안 왔으면 요청을 거둔다. 이미 보낸 요청은 그대로 둔다.
  function drop(id, size = 'small') {
    const key = keyOf(id, size), f = flights.get(key);
    if (!f) return;
    f.wants--;
    if (f.wants <= 0 && f.queued) { flights.delete(key); f.reject(new ThumbError('dropped')); }
  }
  // 그림이 안 뜬 주소: 기억에서 지우고, 주소로 받은 것이었으면 다음에는 그 사진만 한 장씩 받는다.
  function bad(id, size, url) {
    const key = keyOf(id, size), hit = memo.get(key);
    if (hit && (!url || hit.url === url)) { memo.delete(key); if (hit.kind === 'blob') revoke(hit.url); else bytesOnly.add(key); }
  }
  function forget(id) {
    for (const key of [...memo.keys()]) if (key.startsWith(id + ':')) { const hit = memo.get(key); memo.delete(key); if (hit.kind === 'blob') revoke(hit.url); }
    for (const key of [...bytesOnly]) if (key.startsWith(id + ':')) bytesOnly.delete(key);
  }
  function clear() {
    generation++;
    for (const [, f] of flights) f.reject(new ThumbError('dropped'));
    flights.clear();
    for (const hit of memo.values()) if (hit.kind === 'blob') revoke(hit.url);
    memo.clear(); bytesOnly.clear(); active = 0; pausedUntil = 0;
  }
  return {get, bump, drop, bad, forget, clear, stats, get mode() { return mode; }, get size() { return memo.size; }, has: (id, size = 'small') => !!cachedUrl(keyOf(id, size))};
}

// 실패한 칸을 다시 받기까지 기다릴 밀리초: 3초에서 두 배씩, 60초까지. 4번 넘게 연달아 실패하면 null(그 칸이 화면에 다시 들어올 때까지 멈춤).
export function retryDelay(failures) {
  if (failures > 4) return null;
  return Math.min(60000, 3000 * 2 ** Math.max(0, failures - 1));
}
