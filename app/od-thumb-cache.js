// OD-폰보관(2026-10-28 명진 결정): 원드라이브 '작은 그림(썸네일)' 사본만 이 브라우저의 Cache Storage에 보관한다.
// - '기기 저장 금지' 원칙의 단 하나의 명시적 예외다(docs/design-decisions.md "OD-폰보관"). 이 파일만 Cache Storage를 쓴다
//   (Browser storage audit의 허용 목록도 이 파일 하나). 일기·별표·폴더 설정 등 기록은 계속 서버에만 둔다.
// - 보관하는 것은 그림 바이트뿐이다. 사전 인증 주소·토큰·파일 이름은 넣지 않는다. 키는 주인/크기/찍은 달/사진 id로 만든
//   이 사이트 안의 가짜 주소(/__od-thumb/v1/...)이며 실제로 불리지 않는다. 다시 받을 수 있는 캐시라 언제 지워져도 된다.
// - 상한: 장수(maxEntries)와 바이트(maxBytes). 넘으면 오래 안 쓴 것부터 지운다(쓸 때 하루에 한 번 다시 넣어 순서를 뒤로 보낸다).
// - 한 달 목록을 받으면 그 달에 없는 사진(원드라이브에서 지움·폴더를 끔)을 지운다(reconcileMonth).
// 이 파일은 화면(import)과 서비스 워커(importScripts) 양쪽에서 읽는다. 그래서 export 없이 self.ODThumbCache에 얹는다.
(function (root) {
  'use strict';
  const NAME = 'od-thumb-v1';
  const PREFIX = '/__od-thumb/v1/';
  const SIZES = new Set(['small']);
  const LIMITS = Object.freeze({maxEntries: 4000, maxBytes: 300 * 1024 * 1024, maxItemBytes: 2 * 1024 * 1024, touchMs: 24 * 3600 * 1000, pruneEvery: 25});
  const monthRe = /^\d{4}-(0[1-9]|1[0-2])$/;
  const idOk = id => typeof id === 'string' && id.length > 0 && id.length <= 200;
  const enc = encodeURIComponent, dec = decodeURIComponent;

  // 서비스 워커가 Background Fetch 결과를 어느 사진으로 넣을지 알 수 있게, 요청 주소의 # 뒤(서버로 가지 않는 부분)에 붙이는 표시.
  const TAG = 'od-thumb=';
  function tagUrl(url, {owner, id, size, month}) {
    const clean = String(url).split('#')[0];
    return `${clean}#${TAG}${enc(owner)}/${enc(size)}/${enc(month)}/${enc(id)}`;
  }
  function untag(url) {
    const hash = String(url || '').split('#')[1] || '';
    if (!hash.startsWith(TAG)) return null;
    const parts = hash.slice(TAG.length).split('/');
    if (parts.length !== 4) return null;
    let owner, size, month, id;
    try { [owner, size, month, id] = parts.map(dec); } catch { return null; }
    if (!owner || !SIZES.has(size) || !monthRe.test(month) || !idOk(id)) return null;
    return {owner, size, month, id};
  }

  function create({origin, now = () => Date.now(), limits = {}} = {}) {
    const L = {...LIMITS, ...limits};
    let puts = 0;
    const base = () => String(origin || root.location?.origin || 'https://od-thumb.invalid');
    const ownerPath = owner => `${PREFIX}${enc(owner)}/`;
    const keyOf = (owner, size, month, id) => `${base()}${ownerPath(owner)}${enc(size)}/${enc(month)}/${enc(id)}`;
    const valid = (owner, size, month, id) => typeof owner === 'string' && owner.length > 0 && SIZES.has(size) && monthRe.test(month || '') && idOk(id);
    function parse(url) {
      let path; try { path = new URL(url).pathname; } catch { return null; }
      if (!path.startsWith(PREFIX)) return null;
      const parts = path.slice(PREFIX.length).split('/');
      if (parts.length !== 4) return null;
      try { const [owner, size, month, id] = parts.map(dec); return {owner, size, month, id}; } catch { return null; }
    }
    const available = () => typeof caches !== 'undefined' && !!caches && typeof caches.open === 'function';
    async function open() { return available() ? caches.open(NAME) : null; }
    async function keysOf(cache) { return (await cache.keys()).map(r => ({url: typeof r === 'string' ? r : r.url, ...parse(typeof r === 'string' ? r : r.url)})); }
    function response(blob, at) {
      return new Response(blob, {headers: {'Content-Type': blob.type, 'X-OD-Bytes': String(blob.size), 'X-OD-At': String(at)}});
    }

    // 보관된 작은 그림(Blob) 또는 null. 네트워크는 쓰지 않는다.
    async function get(owner, id, size, month) {
      if (!valid(owner, size, month, id)) return null;
      try {
        const cache = await open(); if (!cache) return null;
        const key = keyOf(owner, size, month, id);
        const hit = await cache.match(key);
        if (!hit) return null;
        const blob = await hit.blob();
        const at = Number(hit.headers.get('X-OD-At')) || 0;
        // 하루에 한 번만 다시 넣어 '최근에 씀'으로 순서를 뒤로 보낸다(오래 안 쓴 것부터 지우기 위해).
        if (now() - at > L.touchMs) cache.put(key, response(blob, now())).catch(() => {});
        return blob;
      } catch { return null; }
    }
    // 그림 바이트만 넣는다. image/* 이고 크기 상한 안일 때만. 넣었으면 true.
    async function put(owner, id, size, month, blob) {
      if (!valid(owner, size, month, id)) return false;
      if (!blob || typeof blob.size !== 'number' || !/^image\//.test(blob.type || '') || blob.size <= 0 || blob.size > L.maxItemBytes) return false;
      try {
        const cache = await open(); if (!cache) return false;
        await cache.put(keyOf(owner, size, month, id), response(blob, now()));
        if (++puts % L.pruneEvery === 0) await prune(owner);
        return true;
      } catch { return false; }
    }
    // 그 달에 보관된 사진 id 묶음(크기별).
    async function monthIds(owner, size, month) {
      const out = new Set();
      try {
        const cache = await open(); if (!cache) return out;
        for (const k of await keysOf(cache)) if (k.owner === owner && k.size === size && k.month === month) out.add(k.id);
      } catch { /* 없는 것으로 */ }
      return out;
    }
    // 원드라이브에서 지운 사진: 모든 크기·달에서 지운다.
    async function remove(owner, id) {
      try {
        const cache = await open(); if (!cache) return 0;
        let n = 0;
        for (const k of await keysOf(cache)) if (k.owner === owner && k.id === id && await cache.delete(k.url)) n++;
        return n;
      } catch { return 0; }
    }
    // 한 달의 최신 목록(켠 폴더만)을 받았을 때: 그 달 보관분 중 목록에 없는 것(지움·폴더 끔)을 지운다.
    async function reconcileMonth(owner, month, ids) {
      if (!monthRe.test(month || '')) return 0;
      const keep = ids instanceof Set ? ids : new Set(ids || []);
      try {
        const cache = await open(); if (!cache) return 0;
        let n = 0;
        for (const k of await keysOf(cache)) if (k.owner === owner && k.month === month && !keep.has(k.id) && await cache.delete(k.url)) n++;
        return n;
      } catch { return 0; }
    }
    // 정리: 다른 주인(로그인한 사람이 바뀜)·알 수 없는 키를 지우고, 장수 상한을 넘으면 오래된 것부터 지운다.
    // full이면 바이트 합계도 본다(각 항목의 머리글만 읽는다).
    async function prune(owner, {full = false} = {}) {
      try {
        const cache = await open(); if (!cache) return 0;
        let n = 0;
        const mine = [];
        for (const k of await keysOf(cache)) {
          if (k.owner !== owner || !valid(k.owner, k.size, k.month, k.id)) { if (await cache.delete(k.url)) n++; }
          else mine.push(k);
        }
        // cache.keys()는 넣은 순서(다시 넣으면 뒤로) = 오래 안 쓴 것이 앞.
        while (mine.length > L.maxEntries) { const k = mine.shift(); if (await cache.delete(k.url)) n++; }
        if (full) {
          const sizes = [];
          let total = 0;
          for (const k of mine) { const hit = await cache.match(k.url); const b = Number(hit?.headers.get('X-OD-Bytes')) || 0; sizes.push(b); total += b; }
          let i = 0;
          while (total > L.maxBytes && i < mine.length) { if (await cache.delete(mine[i].url)) n++; total -= sizes[i]; i++; }
        }
        return n;
      } catch { return 0; }
    }
    async function count(owner) {
      try {
        const cache = await open(); if (!cache) return 0;
        return (await keysOf(cache)).filter(k => k.owner === owner).length;
      } catch { return 0; }
    }
    // [비우기]: 그림 사본만 통째로 지운다(서버 기록과는 무관).
    async function clear() {
      try { return available() ? await caches.delete(NAME) : false; } catch { return false; }
    }
    return Object.freeze({get, put, monthIds, remove, reconcileMonth, prune, count, clear, available, keyOf, limits: L});
  }

  root.ODThumbCache = Object.freeze({NAME, PREFIX, LIMITS, SIZES, create, tagUrl, untag});
})(typeof self !== 'undefined' ? self : globalThis);
