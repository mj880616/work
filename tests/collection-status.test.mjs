import test from 'node:test';
import assert from 'node:assert/strict';

// OPS-수집점검: the home "마지막 수집 시각" card (app/collection-status.js). Synthetic values only.
const mod = await import('../app/collection-status.js');
const now = Date.parse('2026-10-21T09:00:00Z');
const H = 3600000, iso = ms => new Date(ms).toISOString();

function fakeRt({copy, radar, role = 'owner', slug = 'kptu-work'} = {}) {
  const calls = [];
  return {calls, rt:{
    context:{read:() => ({user:{id:'u'}, workspace:{id:'w', slug}, membership:{role}})},
    session:{read:() => ({access_token:'token-fixture', user:{id:'u'}})},
    api:async (path, opts = {}) => {
      calls.push({path, opts});
      const value = path.startsWith('/functions/v1/drive-summary') ? copy : radar;
      if (value instanceof Error) throw value;
      return value;
    },
  }};
}
const missing = Object.assign(new Error('relation does not exist'), {status:404});

test('judge: fresh, stale per source, failure newer than success, never', () => {
  assert.deepEqual(mod.judge('copy', {at:iso(now - 2 * H)}, now), {state:'ok', at:now - 2 * H});
  assert.equal(mod.judge('copy', {at:iso(now - 25 * H)}, now).state, 'stale');
  assert.equal(mod.judge('radar', {at:iso(now - 25 * H)}, now).state, 'ok', 'radar runs on the first home open of the day');
  assert.equal(mod.judge('radar', {at:iso(now - 49 * H)}, now).state, 'stale');
  assert.equal(mod.judge('copy', {at:iso(now - 5 * H), failedAt:iso(now - H)}, now).state, 'failed');
  assert.equal(mod.judge('copy', {at:iso(now - H), failedAt:iso(now - 5 * H)}, now).state, 'ok');
  assert.equal(mod.judge('copy', {at:null, failedAt:null, none:true}, now).state, 'never');
  assert.equal(mod.judge('copy', {at:'내용 같은 값'}, now), null, 'malformed time hides the line');
  assert.equal(mod.judge('copy', null, now), null);
});

test('copyFromStatus accepts only the ok shape', () => {
  assert.deepEqual(mod.copyFromStatus({ok:true, copy:{state:'found', last_success_at:'2026-10-21T04:17:00.000Z', last_failure_at:null}}),
    {at:'2026-10-21T04:17:00.000Z', failedAt:null, none:false});
  for (const bad of [null, [], {}, {ok:false, error:'X'}, {ok:true}, {ok:true, copy:{state:'weird'}}]) assert.equal(mod.copyFromStatus(bad), null);
});

test('render: checkable rows with time, uncheckable rows say 확인 불가, nothing shown when nothing can be checked', () => {
  const html = mod.renderRows({copy:{at:iso(now - 30 * H)}, radar:null}, now);
  assert.match(html, /data-collect="telegram" data-collect-state="unknown"/);
  assert.match(html, /data-collect="call" data-collect-state="unknown"/);
  assert.match(html, /확인 불가/);
  assert.match(html, /data-collect="copy" data-collect-state="stale"/);
  assert.match(html, /collect-warn">주의 · 오래됨/);
  assert.doesNotMatch(html, /data-collect="radar"/, 'missing radar table → line hidden');
  assert.equal(mod.renderRows({copy:null, radar:null}, now), '');
});

test('readStatus: owner GET status without session refresh; 404 table and failed function hide quietly', async () => {
  const {rt, calls} = fakeRt({copy:new Error('Failed to fetch'), radar:missing});
  assert.deepEqual(await mod.readStatus(rt), {copy:null, radar:null, collectors:null});
  assert.equal(calls[0].path, '/functions/v1/drive-summary?action=status');
  assert.equal(calls[0].opts.refreshSession, false, 'a 401 must never log the owner out');
  assert.ok(!calls[0].opts.method || calls[0].opts.method === 'GET', 'never the POST that rebuilds the copy');
  assert.match(calls[1].path, /^\/rest\/v1\/app_todo_radar_state\?workspace_id=eq\.w&select=last_success_at&limit=1$/);
});

function host() { return {hidden:false, innerHTML:''}; }
test('mount: hidden for non-owner and when nothing can be checked; cached for 10 minutes', async () => {
  mod.resetCollectionCache();
  const other = fakeRt({role:'admin', copy:{ok:true, copy:{state:'none'}}});
  const h1 = host(); await mod.mountCollectionStatus(h1, {rt:other.rt, now:() => now}).refresh();
  assert.equal(h1.hidden, true); assert.equal(other.calls.length, 0);

  const none = fakeRt({copy:{ok:false, error:'METHOD_NOT_ALLOWED'}, radar:missing});
  const h2 = host(); await mod.mountCollectionStatus(h2, {rt:none.rt, now:() => now}).refresh();
  assert.equal(h2.hidden, true); assert.equal(h2.innerHTML, '');

  mod.resetCollectionCache();
  const ok = fakeRt({copy:{ok:true, copy:{state:'found', last_success_at:iso(now - H), last_failure_at:null}}, radar:[{last_success_at:iso(now - 2 * H)}]});
  const h3 = host(), m = mod.mountCollectionStatus(h3, {rt:ok.rt, now:() => now});
  await m.refresh();
  assert.equal(h3.hidden, false);
  assert.match(h3.innerHTML, /마지막 수집 시각/);
  assert.match(h3.innerHTML, /data-collect="copy" data-collect-state="ok"/);
  assert.match(h3.innerHTML, /data-collect="radar" data-collect-state="ok"/);
  await m.refresh();
  assert.equal(ok.calls.length, 2, 'second refresh within 10 minutes uses the tab cache');
});

test('radar state: no row or no time yet hides the line', () => {
  assert.equal(mod.radarFromRows([]), null);
  assert.equal(mod.radarFromRows([{last_success_at:null}]), null);
  assert.equal(mod.radarFromRows({}), null);
  assert.deepEqual(mod.radarFromRows([{last_success_at:'2026-10-21T01:00:00Z'}]), {at:'2026-10-21T01:00:00Z', failedAt:null});
});

// OPS-수집점검 2단계: telegram·transcript lines from the heartbeat values in the same status answer.
const beat = (atH, reportedH = 0.5, count) => ({last_at:iso(now - atH * H), reported_at:iso(now - reportedH * H), ...(count === undefined ? {} : {count})});
test('collectorsFromStatus: only the ok shape; missing field (old function) is null; bad entries are no signal', () => {
  assert.equal(mod.collectorsFromStatus({ok:true, copy:{state:'none'}}), null);
  assert.equal(mod.collectorsFromStatus({ok:false, collectors:{}}), null);
  assert.equal(mod.collectorsFromStatus(null), null);
  assert.deepEqual(mod.collectorsFromStatus({ok:true, collectors:{telegram:beat(1), transcript:{last_at:'파일 이름', reported_at:iso(now)}}}),
    {telegram:{at:iso(now - H), reportedAt:iso(now - 0.5 * H), count:null}, transcript:null});
  assert.equal(mod.collectorsFromStatus({ok:true, collectors:{transcript:beat(1, 0.5, -3)}}).transcript.count, null);
});
test('judgeCollector: telegram 6h, call 72h, signal older than 3h is silent, nothing yet is never', () => {
  const j = (key, raw) => mod.judgeCollector(key, raw && {at:raw.last_at, reportedAt:raw.reported_at, count:raw.count}, now).state;
  assert.equal(j('telegram', beat(5)), 'ok');
  assert.equal(j('telegram', beat(7)), 'stale');
  assert.equal(j('call', beat(60)), 'ok', 'a weekend without calls is not a warning');
  assert.equal(j('call', beat(73)), 'stale');
  assert.equal(j('telegram', beat(1, 4)), 'silent', 'the script itself stopped');
  assert.equal(j('call', null), 'never');
  assert.deepEqual(mod.STALE_HOURS, {copy:24, radar:48, telegram:6, call:72});
});
test('render: collector lines show time, 24h count for calls, and warnings; old function keeps 확인 불가', () => {
  const collectors = mod.collectorsFromStatus({ok:true, collectors:{telegram:beat(8), transcript:beat(2, 0.5, 5)}});
  const html = mod.renderRows({copy:null, radar:null, collectors}, now);
  assert.match(html, /data-collect="telegram" data-collect-state="stale"/);
  assert.match(html, /collect-warn">주의 · 오래됨/);
  assert.match(html, /data-collect="call" data-collect-state="ok"><span class="collect-label">통화 녹음 전사<\/span><span class="collect-value">마지막 [^<]+ · 24시간 5건<\/span>/);
  assert.doesNotMatch(html, /확인 불가/);
  const silent = mod.renderRows({copy:null, radar:null, collectors:{telegram:null, transcript:mod.collectorsFromStatus({ok:true, collectors:{transcript:beat(1, 5)}}).transcript}}, now);
  assert.match(silent, /data-collect="telegram" data-collect-state="never"[^]*점검 신호 없음/);
  assert.match(silent, /data-collect="call" data-collect-state="silent"[^]*collect-warn">주의 · 점검 신호 끊김/);
  assert.match(mod.renderRows({copy:{at:iso(now - H)}, radar:null, collectors:null}, now), /data-collect="call" data-collect-state="unknown"[^]*확인 불가/);
});
test('readStatus: one status call feeds both copy and collectors', async () => {
  const {rt, calls} = fakeRt({copy:{ok:true, copy:{state:'found', last_success_at:iso(now - H), last_failure_at:null}, collectors:{telegram:beat(1), transcript:null}}, radar:[]});
  const raw = await mod.readStatus(rt);
  assert.equal(calls.filter(c => c.path.startsWith('/functions/v1/drive-summary')).length, 1);
  assert.equal(raw.copy.at, iso(now - H));
  assert.deepEqual(raw.collectors, {telegram:{at:iso(now - H), reportedAt:iso(now - 0.5 * H), count:null}, transcript:null});
});
