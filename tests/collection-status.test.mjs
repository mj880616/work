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
  mod.resetCollectionCache();
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

// STAB-E2E(10/30): the profile view hook can call refresh() again while the card's first read is still on its way.
test('mount: a refresh while the first read is in flight shares it (one radar read), and the card still paints', async () => {
  mod.resetCollectionCache();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const ok = fakeRt({copy:{ok:true, copy:{state:'found', last_success_at:iso(now - H), last_failure_at:null}}, radar:[{last_success_at:iso(now - 2 * H)}]});
  const api = ok.rt.api;
  ok.rt.api = async (path, opts) => { await gate; return api(path, opts); };
  const h = host(), m = mod.mountCollectionStatus(h, {rt:ok.rt, now:() => now});
  const first = m.refresh(), second = m.refresh();
  release();
  await Promise.all([first, second]);
  assert.equal(ok.calls.filter(c => c.path.startsWith('/rest/v1/app_todo_radar_state')).length, 1, 'one radar read');
  assert.equal(ok.calls.filter(c => c.path.startsWith('/functions/v1/drive-summary')).length, 1, 'one status read');
  assert.equal(h.hidden, false);
  assert.match(h.innerHTML, /data-collect="radar" data-collect-state="ok"/);
  await m.refresh();
  assert.equal(ok.calls.length, 2, 'the shared answer fills the 10 minute cache');
});
test('mount: a failed shared read does not stick; the next refresh reads again', async () => {
  mod.resetCollectionCache();
  const ok = fakeRt({copy:{ok:true, copy:{state:'found', last_success_at:iso(now - H), last_failure_at:null}}, radar:[{last_success_at:iso(now - 2 * H)}]});
  const api = ok.rt.api; let fail = true;
  ok.rt.api = (path, opts) => { if (fail) { fail = false; throw new Error('not ready'); } return api(path, opts); };
  const h = host(), m = mod.mountCollectionStatus(h, {rt:ok.rt, now:() => now});
  await assert.rejects(m.refresh());
  await m.refresh();
  assert.match(h.innerHTML, /data-collect="copy" data-collect-state="ok"/);
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
    {telegram:{at:iso(now - H), reportedAt:iso(now - 0.5 * H), count:null}, transcript:null, telegram_send:null, call_send:null});
  assert.equal(mod.collectorsFromStatus({ok:true, collectors:{transcript:beat(1, 0.5, -3)}}).transcript.count, null);
});
test('judgeCollector: telegram 26h, call 72h, signal older than 3h is silent, nothing yet is never', () => {
  const j = (key, raw) => mod.judgeCollector(key, raw && {at:raw.last_at, reportedAt:raw.reported_at, count:raw.count}, now).state;
  assert.equal(j('telegram', beat(25)), 'ok', 'daily 07:30 collection is not a warning');
  assert.equal(j('telegram', beat(27)), 'quiet', 'old file + healthy signal is quiet, not a warning');
  assert.equal(j('call', beat(60)), 'ok', 'a weekend without calls is not a warning');
  assert.equal(j('call', beat(73)), 'quiet');
  assert.equal(j('telegram', beat(27, 4)), 'silent', 'old file + signal cut for 3h+ warns');
  assert.equal(j('call', beat(73, 3.5)), 'silent');
  assert.equal(j('telegram', beat(1, 4)), 'silent', 'the script itself stopped');
  assert.equal(j('call', null), 'never');
  assert.deepEqual(mod.STALE_HOURS, {copy:24, radar:48, telegram:26, call:72});
});
test('render: collector lines show time, 24h count for calls and telegram, and warnings; old function keeps 확인 불가', () => {
  const collectors = mod.collectorsFromStatus({ok:true, collectors:{telegram:beat(30, 0.5, 4), transcript:beat(2, 0.5, 5)}});
  const html = mod.renderRows({copy:null, radar:null, collectors}, now);
  assert.match(html, /data-collect="telegram" data-collect-state="quiet"[^]*조용함/);
  assert.doesNotMatch(html, /collect-warn/);
  assert.match(html, /data-collect="call" data-collect-state="ok"><span class="collect-name"><span class="collect-label">통화 녹음 전사<\/span><\/span><span class="collect-count">24시간 5건<\/span><span class="collect-value">마지막 [^<]+<\/span>/);
  assert.match(html, /data-collect="telegram" data-collect-state="quiet"[^]*<span class="collect-count">24시간 4건<\/span><span class="collect-value">마지막 /, 'telegram shows its 24h count, time stays last');
  const noCount = mod.renderRows({copy:null, radar:null, collectors:mod.collectorsFromStatus({ok:true, collectors:{telegram:beat(30), transcript:beat(2, 0.5, 5)}})}, now);
  assert.match(noCount, /data-collect="telegram" data-collect-state="quiet"[^]*<span class="collect-count"><\/span><span class="collect-value">마지막 /, 'no count from the signal leaves the cell empty');
  assert.doesNotMatch(html, /확인 불가/);
  const silent = mod.renderRows({copy:null, radar:null, collectors:{telegram:null, transcript:mod.collectorsFromStatus({ok:true, collectors:{transcript:beat(1, 5)}}).transcript}}, now);
  assert.match(silent, /data-collect="telegram" data-collect-state="never"[^]*점검 신호 없음/);
  assert.match(silent, /data-collect="call" data-collect-state="silent"[^]*collect-warn">주의 · 점검 신호 끊김/);
  assert.match(mod.renderRows({copy:{at:iso(now - H)}, radar:null, collectors:null}, now), /data-collect="call" data-collect-state="unknown"[^]*확인 불가/);
});
test('readStatus: one status call feeds both copy and collectors', async () => {
  mod.resetCollectionCache(); // the status answer is shared per tab and owner for 10 minutes (text-backfill-notice.js reads it too)
  const {rt, calls} = fakeRt({copy:{ok:true, copy:{state:'found', last_success_at:iso(now - H), last_failure_at:null}, collectors:{telegram:beat(1), transcript:null}}, radar:[]});
  const raw = await mod.readStatus(rt);
  assert.equal(calls.filter(c => c.path.startsWith('/functions/v1/drive-summary')).length, 1);
  assert.equal(raw.copy.at, iso(now - H));
  assert.deepEqual(raw.collectors, {telegram:{at:iso(now - H), reportedAt:iso(now - 0.5 * H), count:null}, transcript:null, telegram_send:null, call_send:null});
});
test('summarize: quiet collectors raise no attention and keep 수집 정상; silent one warns; other sources unchanged', () => {
  const quiet = mod.collectorsFromStatus({ok:true, collectors:{telegram:beat(30), transcript:beat(80)}});
  const a = mod.summarize({copy:null, radar:null, collectors:quiet}, now);
  assert.deepEqual(a.attention, []);
  assert.equal(a.ok, true);
  const cut = mod.collectorsFromStatus({ok:true, collectors:{telegram:beat(30, 4), transcript:beat(80)}});
  assert.deepEqual(mod.summarize({copy:null, radar:null, collectors:cut}, now).attention.map(x => x.key), ['telegram']);
  assert.equal(mod.summarize({copy:{at:iso(now - 25 * H)}, radar:null, collectors:quiet}, now).attention[0].key, 'copy');
});

// OPS-수집멈춤알림: 수집기 새 파일 멈춤 · 보내기 스크립트 멈춤/오류/상한. Synthetic values only.
const col = (atH, repH = 0.5) => ({at:iso(now - atH * H), reportedAt:iso(now - repH * H), count:0});
const send = (state, repH = 0.5, atH = 2) => ({at:iso(now - atH * H), reportedAt:iso(now - repH * H), state});

test('collector stall: only a long gap (telegram 72h, call 168h) becomes a warning; weekends stay quiet', () => {
  assert.equal(mod.judgeCollector('telegram', col(50), now).state, 'quiet');
  assert.equal(mod.judgeCollector('telegram', col(73), now).state, 'stalled');
  assert.equal(mod.judgeCollector('call', col(100), now).state, 'quiet');
  assert.equal(mod.judgeCollector('call', col(169), now).state, 'stalled');
  assert.equal(mod.judgeCollector('telegram', col(200, 4), now).state, 'silent', 'no signal wins over stall');
});

test('send source: judged by report time, then reported state; no report yet hides the line', () => {
  assert.equal(mod.judgeSend('callSend', null, now), null);
  assert.equal(mod.judgeSend('callSend', send('ok', 3.5), now).state, 'stopped');
  assert.equal(mod.judgeSend('callSend', send('ok', 2.5), now).state, 'ok', 'hourly trigger jitter');
  assert.equal(mod.judgeSend('telegramSend', send('ok', 9.5), now).state, 'ok', 'night rest 00-07 KST (TG-1시간수집)');
  assert.equal(mod.judgeSend('telegramSend', send('ok', 11), now).state, 'stopped', 'hourly trigger gone');
  for (const state of ['broken', 'failing', 'limit_ai', 'test', 'limit_day']) assert.equal(mod.judgeSend('callSend', send(state), now).state, state);
});

test('send gap: fresh raw files but nothing really sent for 72h is a warning; stale raw files are not', () => {
  const fresh = col(5), old = col(40);
  assert.equal(mod.judgeSend('telegramSend', send('ok', 1, 80), now, fresh).state, 'gap');
  assert.equal(mod.judgeSend('telegramSend', send('ok', 1, 70), now, fresh).state, 'ok');
  assert.equal(mod.judgeSend('telegramSend', send('ok', 1, 80), now, old).state, 'ok', 'collector quiet → empty days are expected');
  assert.equal(mod.judgeSend('callSend', send('ok', 1, 200), now, fresh).state, 'ok', 'gap rule is telegram only');
});

test('collectorsFromStatus keeps send sources with a listed state only', () => {
  const t = '2026-10-21T08:00:00.000Z';
  const c = mod.collectorsFromStatus({ok:true, collectors:{telegram:null, transcript:null, telegram_send:{last_at:t, reported_at:t, state:'limit_ai'}, call_send:{last_at:t, reported_at:t, state:'내용'}}});
  assert.deepEqual(c.telegram_send, {at:t, reportedAt:t, state:'limit_ai'});
  assert.equal(c.call_send, null);
  assert.equal(mod.collectorsFromStatus({ok:true, collectors:{telegram:null, transcript:null}}).telegram_send, null, 'old function without the field');
});

test('render and summary: send rows show notes, warn lines name the problem, old function hides the rows', () => {
  const raw = {copy:null, radar:null, collectors:{telegram:null, transcript:null, telegram_send:send('limit_ai'), call_send:send('limit_day')}};
  const html = mod.renderRows(raw, now);
  assert.match(html, /data-collect="telegramSend" data-collect-state="limit_ai"/);
  assert.match(html, /collect-warn">주의 · 이번 달 AI 상한/);
  assert.match(html, /data-collect="callSend" data-collect-state="limit_day"[^]*하루 상한 · 내일 이어서/);
  assert.doesNotMatch(html, /data-collect="callSend"[^]*collect-warn">하루/, 'daily cap is not a warning');
  const sum = mod.summarize(raw, now);
  assert.deepEqual(sum.attention.map(a => a.key), ['telegramSend']);
  assert.equal(mod.alertText(sum.attention), '텔레그램 보내기가 이번 달 AI 상한에 걸렸어요');
  const two = mod.summarize({copy:null, radar:null, collectors:{telegram:col(80), transcript:null, telegram_send:send('ok', 30), call_send:send('broken')}}, now);
  assert.equal(mod.alertText(two.attention), '텔레그램 수집이 10/18 오후 이후 멈췄어요 외 2건'.replace('10/18 오후', mod.alertText(two.attention).match(/\d+\/\d+ \S+/)[0]));
  const old = mod.renderRows({copy:{at:iso(now - H)}, radar:null, collectors:null}, now);
  assert.doesNotMatch(old, /telegramSend|callSend/);
  assert.equal(mod.alertText([{key:'callSend', label:'통화 보내기', state:'stopped', at:null}]), '통화 보내기가 멈췄어요');
});
