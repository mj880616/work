import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// PHOTO-스와이프안내·PHOTO-크게보기빨리·PHOTO-미리받기앱시작(2026-10-30 요청함 15:42·17:30, 명진 결정 확정).
// 손동작 판정·안내 횟수·불러오기 시간 글·대기열 peek·앱을 켠 뒤 미리 받기 순서(최근 100장 작은+큰 → 옛날 작은)를 지어낸 서버로 본다.
// 네트워크·브라우저 없음. Cache Storage는 지어낸 Map(od-thumb-cache.test.mjs와 같은 모양), 큰 그림은 메모리에만.

function fakeCaches() {
  const stores = new Map();
  const keyUrl = k => (typeof k === 'string' ? k : k.url);
  const make = () => {
    const rows = new Map();
    return {
      async match(k) { const r = rows.get(keyUrl(k)); return r ? r.clone() : undefined; },
      async put(k, res) { const u = keyUrl(k); rows.delete(u); rows.set(u, res.clone()); },
      async delete(k) { return rows.delete(keyUrl(k)); },
      async keys() { return [...rows.keys()].map(url => ({url})); },
    };
  };
  return {async open(name) { if (!stores.has(name)) stores.set(name, make()); return stores.get(name); }, async delete(name) { return stores.delete(name); }};
}
globalThis.caches = fakeCaches();
globalThis.requestIdleCallback = fn => setImmediate(fn);
const fetched = [];
globalThis.fetch = async url => { fetched.push(String(url)); return new Response(new Blob([new Uint8Array([1, 2, 3])], {type:'image/png'}), {status:200}); };

const model = await import('../app/photo-viewer-model.mjs');
const od = await import('../app/diary-onedrive.js');
const {createThumbLoader} = await import('../app/od-thumb-loader.js');
const {installOdWarm} = await import('../app/od-warm.js');
const {validValue} = await import('../app/view-prefs.js');

test('drag: direction after 10px, vertical only when clearly vertical; two fingers or zoom never move', () => {
  assert.equal(model.dragAxis({dx:3, dy:-6}), null);
  assert.equal(model.dragAxis({dx:4, dy:-40}), 'y');
  assert.equal(model.dragAxis({dx:40, dy:-10}), 'x');
  assert.equal(model.dragAxis({dx:20, dy:25}), 'x', 'diagonal is not a vertical drag');
  assert.equal(model.dragAxis({dx:0, dy:-80, fingers:2}), 'none');
  assert.equal(model.dragAxis({dx:0, dy:-80, zoomed:true}), 'none');
});
test('drag end: up past STAR_DIST stars, less goes back; down past CLOSE_DIST closes', () => {
  assert.equal(model.dragEnd(-(model.STAR_DIST - 1)), 'back');
  assert.equal(model.dragEnd(-model.STAR_DIST), 'star');
  assert.equal(model.dragEnd(model.CLOSE_DIST - 1), 'back');
  assert.equal(model.dragEnd(model.CLOSE_DIST), 'close');
  assert.equal(model.dragEnd(NaN), 'back');
  assert.equal(model.starFill(0), 0); assert.equal(model.starFill(-model.STAR_DIST / 2), 0.5); assert.equal(model.starFill(-500), 1); assert.equal(model.starFill(40), 0);
  assert.equal(model.dragOffset(50), 50); assert.equal(model.dragOffset(-50), -50);
  assert.ok(model.dragOffset(-400) > -400 && model.dragOffset(-400) < -model.STAR_DIST, 'past the star distance the photo follows more slowly');
});
test('hint: first three openings only, count kept on the server (0..9 integer, same as the DB check)', () => {
  assert.equal(model.HINT_TIMES, 3);
  for (const v of [undefined, null, 0, 1, 2, 'x', -1, 1.5]) assert.equal(model.hintDue(v), true, String(v));
  for (const v of [3, 4, 9]) assert.equal(model.hintDue(v), false, String(v));
  assert.equal(model.hintNext(undefined), 1); assert.equal(model.hintNext(2), 3); assert.equal(model.hintNext(9), 9);
  for (let v = 0; v <= 9; v++) assert.ok(validValue('photo_hint', model.hintNext(v - 1)));
  assert.equal(model.HINT_TEXT, '↑ 위로 밀면 별표 · 아래로 밀면 닫기');
});
test('load time line: total (address · picture) in seconds, nothing before the picture is shown', () => {
  assert.equal(model.loadTimeText({start:100, url:600, shown:1500}), '1.4초 (주소 0.5 · 사진 0.9)');
  assert.equal(model.loadTimeText({start:0, url:null, shown:300}), '0.3초');
  assert.equal(model.loadTimeText({start:0, url:200, shown:null}), '');
  assert.equal(model.loadTimeText(null), '');
});
test('loader peek: only what is already in memory, no request', async () => {
  let calls = 0;
  const l = createThumbLoader({fetchUrls:async ids => { calls++; return {urls:Object.fromEntries(ids.map(id => [id, 'https://t.example.test/' + id])), failed:{}}; }});
  assert.equal(l.peek('A'), null); assert.equal(calls, 0);
  await l.get('A', 'small');
  assert.equal(l.peek('A', 'small'), 'https://t.example.test/A'); assert.equal(l.peek('A', 'large'), null);
  assert.equal(calls, 1);
});

// 130장(한 달), 최신순 P000…P129. 하루 10장, 그날 목록은 찍은 시각 순(서버 photos와 같은 모양).
const PER = 10, N = 130;
const pad = n => String(n).padStart(3, '0');
const monthDays = Object.fromEntries(Array.from({length:N / PER}, (_, d) => [`2026-10-${String(30 - d).padStart(2, '0')}`,
  Array.from({length:PER}, (_, k) => ({id:'P' + pad(d * PER + (PER - 1 - k)), name:'p.jpg', taken_at:`2026-10-${String(30 - d).padStart(2, '0')}T0${k}:00:00Z`}))]));
function runtime({connected = true} = {}) {
  const calls = [];
  const rt = {calls, config:{url:'https://x.invalid', key:'k'}, context:{read:() => ({user:{id:'u'}, workspace:{id:'w'}})},
    session:{ensure:async () => true, read:() => ({access_token:'t'})},
    api:async (path, options = {}) => {
      const b = options.body || {}; calls.push({action:b.action, size:b.size, ids:b.ids?.slice(), month:b.month});
      if (b.action === 'status') return {configured:true, connected, folder:{name:'카메라'}, can_delete:true};
      if (b.action === 'photos') return {days:b.month === '2026-10' ? monthDays : {}};
      if (b.action === 'photo-urls') return {urls:Object.fromEntries(b.ids.map(id => [id, `https://thumbs.example.test/${b.size}/${id}`]))};
      throw new Error('unexpected ' + b.action);
    }};
  return rt;
}
const until = async (fn, ms = 20000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 5)); } };

test('app start prefetch: recent 100 small then large (memory only), then older small; already kept are not asked again', async () => {
  od.clearOdPhotoCache(); od.odStopPrefetch();
  const rt = runtime();
  od.odThumbLoader(rt, {fetchUrls:(ids, size) => od.odPhotoUrls(rt, ids, size), gatherMs:0});
  assert.equal(await od.odWarmPrefetch(rt, {today:'2026-10-30'}), true);
  await until(() => !od.prefetchState().active);
  const urls = rt.calls.filter(c => c.action === 'photo-urls');
  const sizes = urls.map(c => c.size), firstLarge = sizes.indexOf('large'), lastLarge = sizes.lastIndexOf('large');
  const smallBefore = urls.slice(0, firstLarge).flatMap(c => c.ids), large = urls.filter(c => c.size === 'large').flatMap(c => c.ids), smallAfter = urls.slice(lastLarge + 1).flatMap(c => c.ids);
  const ids = n => Array.from({length:n}, (_, i) => 'P' + pad(i));
  assert.deepEqual(smallBefore.sort(), ids(100), 'recent 100 small first');
  assert.deepEqual(large.sort(), ids(100), 'then the same 100 large');
  assert.ok(urls.slice(firstLarge, lastLarge + 1).every(c => c.size === 'large'));
  assert.deepEqual(smallAfter.sort(), ids(N).slice(100), 'then the older ones small only');
  assert.equal(od.prefetchState().big, 100, 'large pictures held in memory');
  assert.ok(od.odHeldLarge('P000') instanceof Blob); assert.equal(od.odHeldLarge('P100'), null);
  // 다시 시작해도 이미 받은 것(작은 그림 보관·큰 그림 메모리)은 다시 묻지 않는다.
  const before = rt.calls.filter(c => c.action === 'photo-urls').length;
  assert.equal(await od.odWarmPrefetch(rt, {today:'2026-10-30'}), true);
  await until(() => !od.prefetchState().active);
  assert.equal(rt.calls.filter(c => c.action === 'photo-urls').length, before);
  // 원드라이브에서 지운 사진은 보관 사본과 큰 그림 메모리에서 빠진다.
  od.forgetOdPhoto('P000', rt);
  assert.equal(od.odHeldLarge('P000'), null);
  od.clearOdPhotoCache();
  assert.equal(od.prefetchState().big, 0);
});
test('app start prefetch: not connected → nothing starts', async () => {
  od.clearOdPhotoCache(); od.odStopPrefetch();
  const rt = runtime({connected:false});
  assert.equal(await od.odWarmPrefetch(rt, {today:'2026-10-30'}), false);
  assert.deepEqual(rt.calls.map(c => c.action), ['status']);
});
test('od-warm starts the prefetch after the warm-up, only when it was done', async () => {
  const flush = () => new Promise(resolve => setImmediate(resolve));
  for (const done of [true, false]) {
    const timers = [], idles = []; let started = 0;
    const win = {KPTURuntime:{}, KPTURouter:{current:'home'}, setTimeout:(fn, ms) => { timers.push({fn, ms}); return 1; }, requestIdleCallback:fn => idles.push(fn),
      document:{visibilityState:'visible', addEventListener() {}}};
    installOdWarm(win, {load:async () => ({odWarm:async () => ({done}), odWarmPrefetch:async () => { started++; return true; }})});
    timers[0].fn(); await flush(); idles[0](); await flush(); await flush(); await flush();
    assert.equal(started, done ? 1 : 0);
  }
});
test('screens: the viewer uses the shared parts; the hint count and timing stay off the device', () => {
  const strip = readFileSync('app/photo-strip.js', 'utf8'), slot = readFileSync('app/img-slot.js', 'utf8');
  assert.match(strip, /viewPrefs\.set\('photo_hint', hintNext\(seen\), \{rejectable:true\}\)/);
  assert.match(strip, /loadTimeText\(slotTimingOf\(slidePhoto\(at\)\)\)/);
  assert.match(strip, /prefers-reduced-motion: reduce/);
  // 기기 저장소 이름은 저장소 감사(browser-storage-audit)가 글자로 찾으므로 조각을 이어 만든다.
  const deviceStores = new RegExp(['local' + 'Storage', 'session' + 'Storage', 'indexed' + 'DB', 'cach' + 'es\\s*\\.'].join('|'));
  for (const src of [strip, slot, readFileSync('app/photo-viewer-model.mjs', 'utf8')]) assert.doesNotMatch(src, deviceStores);
  // 큰 그림을 띄우는 곳마다 작은 그림을 먼저(사진 메뉴·일기 = odPhotoElement, 일기 올린 사진·노트 = photoElement, 자료실·사업 보고 = photo-view preview).
  assert.match(readFileSync('app/diary-onedrive.js', 'utf8'), /if \(big\) \{ slotTiming\(box\); previewSmall\(box, item, rt\); \}/);
  assert.match(readFileSync('app/diary-data.js', 'utf8'), /slotPreview\(box, readyDiaryPhotoUrl\(row\.id, file\.drive_file_id, 'small'\)\)/);
  assert.match(readFileSync('app/file-actions.js', 'utf8'), /preview: \(\) => documentPhotoPreview\(file\.documentId\)/);
  assert.match(readFileSync('app/file-actions.js', 'utf8'), /preview: \(\) => documentPhotoPreview\(list\[i\]\.documentId\)/);
});

// PHOTO-전체화면확대(요청함 10/31 19:23): 크게 보기 안 확대·축소의 순수 판정과 연결(소스) 검사.
const {ZOOM_ONE, ZOOM_MAX, ZOOM_TAP, clampScale, isZoomed, fitSize, clampPan, zoomAt, pinchTo, panBy, zoomToggle, wheelScale, isTap, isDoubleTap, settleZoom, zoomTransform,
  dragAxis, swipeKind} = model;
const readZ = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const BOX = {W:400, H:800, nw:4000, nh:3000}; // 가로 사진: 칸 안에서 400×300

test('배율은 1~5배, 1배 근처는 원래 크기', () => {
  assert.equal(clampScale(0.3), 1); assert.equal(clampScale(9), ZOOM_MAX); assert.equal(clampScale(NaN), 1);
  assert.equal(isZoomed(ZOOM_ONE), false); assert.equal(isZoomed({s:1.01}), false); assert.equal(isZoomed({s:1.5}), true);
  assert.deepEqual(settleZoom({s:1.04, x:30, y:5}, BOX), {s:1, x:0, y:0});
  assert.equal(zoomTransform(ZOOM_ONE), '');
  assert.equal(zoomTransform({s:2, x:-10, y:4}), 'translate(-10.0px, 4.0px) scale(2.000)');
});

test('칸 안 사진 크기(contain)와 옮기기 한계', () => {
  assert.deepEqual(fitSize(BOX), {cw:400, ch:300});
  assert.deepEqual(fitSize({W:400, H:800}), {cw:400, ch:800});
  // 2배: 가로 800 → 좌우 200씩 움직일 수 있고, 세로 600 < 800 → 가운데 고정.
  assert.deepEqual(clampPan({s:2, x:999, y:999}, BOX), {s:2, x:200, y:0});
  assert.deepEqual(clampPan({s:2, x:-999, y:-999}, BOX), {s:2, x:-200, y:0});
  assert.deepEqual(clampPan({s:1, x:50, y:50}, BOX), {s:1, x:0, y:0});
});

test('두 번 톡: 누른 점을 2.5배로, 다시 두 번 톡이면 원래 크기', () => {
  const z = zoomToggle(ZOOM_ONE, 100, 0, BOX);
  assert.equal(z.s, ZOOM_TAP);
  assert.equal(z.x, -150); // 누른 점(가운데에서 오른쪽 100)이 그 자리에 남는다
  assert.deepEqual(zoomToggle(z, 0, 0, BOX), {s:1, x:0, y:0});
});

test('두 손가락: 벌리면 커지고 오므리면 작아지며, 손가락 사이 점이 따라간다', () => {
  const big = pinchTo(ZOOM_ONE, 100, {x:0, y:0}, 250, {x:0, y:0}, BOX);
  assert.equal(big.s, 2.5);
  const small = pinchTo(big, 250, {x:0, y:0}, 100, {x:0, y:0}, BOX);
  assert.equal(small.s, 1);
  const moved = pinchTo(ZOOM_ONE, 100, {x:0, y:0}, 200, {x:40, y:0}, BOX);
  assert.deepEqual(moved, {s:2, x:40, y:0});
  assert.deepEqual(pinchTo({s:2, x:10, y:0}, 0, {x:0, y:0}, 50, {x:0, y:0}, BOX), {s:2, x:10, y:0});
  // 끝까지 벌려도 5배까지.
  assert.equal(pinchTo(ZOOM_ONE, 10, {x:0, y:0}, 1000, {x:0, y:0}, BOX).s, ZOOM_MAX);
});

test('확대 중 끌기와 휠', () => {
  assert.deepEqual(panBy({s:2, x:0, y:0}, 50, 30, BOX), {s:2, x:50, y:0});
  assert.ok(wheelScale(1, -100) > 1); // 위로 굴리면 크게
  assert.ok(wheelScale(2, 100) < 2); // 아래로 굴리면 작게
  assert.equal(wheelScale(1, 500), 1);
  assert.ok(wheelScale(1, -3, 1) > 1); // 줄 단위 휠
  const z = zoomAt(ZOOM_ONE, 2, -100, 0, BOX);
  assert.deepEqual(z, {s:2, x:100, y:0});
});

test('톡·두 번 톡 판정', () => {
  assert.equal(isTap({dx:3, dy:4, dt:120}), true);
  assert.equal(isTap({dx:30, dy:0, dt:120}), false);
  assert.equal(isTap({dx:0, dy:0, dt:600}), false);
  assert.equal(isDoubleTap({x:100, y:100, t:1000}, {x:110, y:105, t:1250}), true);
  assert.equal(isDoubleTap({x:100, y:100, t:1000}, {x:110, y:105, t:1500}), false);
  assert.equal(isDoubleTap({x:100, y:100, t:1000}, {x:200, y:100, t:1100}), false);
  assert.equal(isDoubleTap(null, {x:0, y:0, t:1}), false);
});

test('확대 중에는 세로 밀기(별표·닫기)가 쉰다', () => {
  assert.equal(dragAxis({dx:0, dy:-120, zoomed:true}), 'none');
  assert.equal(swipeKind({dx:0, dy:-150, dt:200, zoomed:true}), null);
});

test('연결: 크게 보기가 확대를 붙이고, 화면 전체 확대 대신 사진 안 확대, 원본 해상도 경로 재사용', () => {
  const strip = readZ('app/photo-strip.js'), css = readZ('app/diary.css'), photos = readZ('app/photos.js'), diary = readZ('app/diary.js');
  assert.match(strip, /addEventListener\('wheel'[\s\S]*passive:false/);
  assert.match(strip, /addEventListener\('dblclick'/);
  assert.match(strip, /zoomed:zoomedNow\(\)/);
  assert.match(strip, /resetZoom\(\); at = next; show\(\);/); // 다른 장으로 넘기면 원래 크기
  assert.match(css, /\.diary-viewer-strip\{[^}]*touch-action:pan-x; \}/);
  assert.doesNotMatch(css, /pinch-zoom/);
  assert.match(css, /\.diary-viewer\[data-strip-zoom\] \.diary-viewer-strip\{[^}]*overflow-x:hidden; touch-action:none/);
  assert.match(photos, /hires:hiresOf/);
  assert.match(photos, /phone\.mediaUrl\(item\)[\s\S]*gdMediaBlob\(rt, item\.gdId\)[\s\S]*odMediaUrl\(rt, item\.id, 'download'\)/);
  assert.match(diary, /hires:item => \(item\.kind === 'od'/);
  // 기기 저장 없음.
  for (const src of [strip, readZ('app/photo-viewer-model.mjs')]) assert.doesNotMatch(src, new RegExp(['local' + 'Storage', 'session' + 'Storage', 'indexed' + 'DB'].join('|')));
});
