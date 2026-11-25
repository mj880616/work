// SEC-Web2CSP I-5 보고 받는 곳: Edge csp-report 입구(supabase/functions/csp-report/handler.mjs).
// - 허용 모양만 저장: Reporting API(csp-violation)·옛 report-uri 두 모양, Web2 허용 출처 문서의 보고만, 지시어는 정해진 목록만.
// - 개인정보 칸 없음: DB로 넘기는 것은 {directive, blocked(출처 또는 낱말), hits}뿐. 쿼리·경로·토큰·문서 주소·코드 조각·줄 번호는 넘기지 않는다.
// - 큰 요청·많은 보고·초당 횟수·틀린 형식·POST 아닌 방법은 거절. 같은 지시어·출처는 한 줄로 합쳐 개수를 센다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCspReportHandler, blockedOf, directiveOf, reportItems, BODY_MAX, DIRECTIVES} from '../../supabase/functions/csp-report/handler.mjs';

const ORIGINS = new Set(['https://workonplus.com', 'https://desk.bokdoong.com']);
const ENV = {SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'service-key-for-test'};
const URL_ = 'https://db.invalid/functions/v1/csp-report';

function setup(options = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({url, init, body: JSON.parse(init.body)}); return new Response('{}', {status: options.storeStatus || 200}); };
  let clock = 1_000_000;
  const handle = createCspReportHandler({env: k => ENV[k], origins: ORIGINS, fetchImpl, now: () => clock, ...options});
  return {handle, calls, tick: ms => { clock += ms; }};
}
const post = (body, type = 'application/reports+json', headers = {}) => new Request(URL_, {method: 'POST', headers: {'content-type': type, ...headers}, body: typeof body === 'string' ? body : JSON.stringify(body)});
const violation = (body, extra = {}) => ({type: 'csp-violation', age: 3, url: 'https://workonplus.com/work/app/?view=notes&t=secret', user_agent: 'UA', body: {
  documentURL: 'https://workonplus.com/work/app/?view=notes&token=abc#frag', referrer: 'https://workonplus.com/work/app/login/?code=zzz',
  disposition: 'report', statusCode: 200, sourceFile: 'https://workonplus.com/work/app/app.js', lineNumber: 12, columnNumber: 3,
  sample: 'private text from the page', originalPolicy: 'default-src', ...body}, ...extra});

test('Reporting API: 지시어·출처·개수만 넘기고, 같은 지시어·출처는 합친다', async () => {
  const {handle, calls} = setup();
  const res = await handle(post([
    violation({effectiveDirective: 'img-src', blockedURL: 'https://User:Pass@Images.Example.com:8443/a/b.png?sig=TOKEN#x'}),
    violation({effectiveDirective: 'img-src', blockedURL: 'https://images.example.com:8443/other?u=me@mail'}),
    violation({effectiveDirective: 'script-src-elem', blockedURL: 'inline'}),
    violation({effectiveDirective: 'connect-src', blockedURL: 'blob:https://workonplus.com/uuid-1234'}),
    violation({effectiveDirective: 'img-src', blockedURL: 'data'}),
    {type: 'deprecation', body: {id: 'x'}}
  ]));
  assert.equal(res.status, 204);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://db.invalid/rest/v1/rpc/app_csp_report_add');
  assert.deepEqual(calls[0].body, {p_items: [
    {directive: 'img-src', blocked: 'https://images.example.com:8443', hits: 2},
    {directive: 'script-src-elem', blocked: 'inline', hits: 1},
    {directive: 'connect-src', blocked: 'blob', hits: 1},
    {directive: 'img-src', blocked: 'data', hits: 1}
  ]});
  // 넘기는 몸통에 개인정보·주소 뒤쪽이 없다.
  const sent = calls[0].init.body;
  for (const bad of ['token', 'secret', 'TOKEN', 'sig=', 'Pass', 'User', '/a/b.png', 'mail', 'private text', 'app.js', 'view=', 'code=', 'UA', 'uuid-1234', 'lineNumber', 'documentURL'])
    assert.ok(!sent.includes(bad), bad);
  for (const item of calls[0].body.p_items) assert.deepEqual(Object.keys(item).sort(), ['blocked', 'directive', 'hits']);
});

test('옛 report-uri 모양(application/csp-report)도 같은 칸만', async () => {
  const {handle, calls} = setup();
  const res = await handle(post({'csp-report': {'document-uri': 'https://desk.bokdoong.com/work/app/login/?next=x', 'violated-directive': 'style-src-attr',
    'effective-directive': 'style-src-attr', 'blocked-uri': 'inline', 'script-sample': 'secret', 'source-file': 'https://desk.bokdoong.com/a.js'}}, 'application/csp-report'));
  assert.equal(res.status, 204);
  assert.deepEqual(calls[0].body, {p_items: [{directive: 'style-src-attr', blocked: 'inline', hits: 1}]});
  // effective-directive가 없으면 violated-directive의 첫 낱말만 본다.
  const second = setup();
  await second.handle(post({'csp-report': {'document-uri': 'https://workonplus.com/work/app/', 'violated-directive': "img-src 'self' data:", 'blocked-uri': 'https://x.example/p?q=1'}}, 'application/csp-report'));
  assert.deepEqual(second.calls[0].body, {p_items: [{directive: 'img-src', blocked: 'https://x.example', hits: 1}]});
});

test('Web2 허용 출처 밖 문서·모르는 지시어의 보고는 세지 않는다(저장 호출 없음)', async () => {
  const {handle, calls} = setup();
  for (const body of [
    [violation({documentURL: 'https://evil.example/work/app/', effectiveDirective: 'img-src', blockedURL: 'https://a.example'})],
    [violation({documentURL: 'not a url', effectiveDirective: 'img-src', blockedURL: 'https://a.example'})],
    [violation({effectiveDirective: 'made-up-src', blockedURL: 'https://a.example'})],
    [{type: 'intervention', body: {}}]
  ]) {
    const res = await handle(post(body));
    assert.equal(res.status, 204);
  }
  assert.equal(calls.length, 0);
});

test('틀린 모양·형식·방법은 거절한다', async () => {
  const {handle, calls} = setup();
  assert.equal((await handle(post('{', 'application/reports+json'))).status, 400);
  assert.equal((await handle(post({not: 'array'}))).status, 400);
  assert.equal((await handle(post([]))).status, 400);
  assert.equal((await handle(post(['x']))).status, 400);
  assert.equal((await handle(post([{type: 'csp-violation'}]))).status, 400);
  assert.equal((await handle(post({'csp-report': 'x'}, 'application/csp-report'))).status, 400);
  assert.equal((await handle(post([violation({})], 'text/plain'))).status, 415);
  assert.equal((await handle(post([violation({})], 'multipart/form-data'))).status, 415);
  assert.equal((await handle(new Request(URL_, {method: 'POST'}))).status, 415);
  assert.equal((await handle(new Request(URL_, {method: 'GET'}))).status, 405);
  assert.equal((await handle(new Request(URL_, {method: 'PUT', body: '[]', headers: {'content-type': 'application/json'}}))).status, 405);
  assert.equal(calls.length, 0);
});

test('큰 요청·보고 21개 이상은 거절한다', async () => {
  const {handle, calls} = setup();
  const big = JSON.stringify([violation({effectiveDirective: 'img-src', blockedURL: 'https://a.example', sample: 'x'.repeat(BODY_MAX)})]);
  // 길이 머리글이 정직할 때와, 머리글 없이 몸통만 클 때 모두.
  assert.equal((await handle(post(big, 'application/reports+json', {'content-length': String(big.length)}))).status, 413);
  const stream = new Request(URL_, {method: 'POST', headers: {'content-type': 'application/reports+json'}, body: new ReadableStream({start(c) { c.enqueue(new TextEncoder().encode(big)); c.close(); }}), duplex: 'half'});
  assert.equal((await handle(stream)).status, 413);
  const many = Array.from({length: 21}, () => violation({effectiveDirective: 'img-src', blockedURL: 'https://a.example'}));
  assert.equal((await handle(post(many))).status, 400);
  assert.equal(calls.length, 0);
  const twenty = many.slice(0, 20);
  assert.equal((await handle(post(twenty))).status, 204);
  assert.deepEqual(calls[0].body, {p_items: [{directive: 'img-src', blocked: 'https://a.example', hits: 20}]});
});

test('초당 횟수 상한: 넘으면 429, 다음 초에는 다시 받는다', async () => {
  const {handle, tick} = setup({perSecond: 3});
  const one = () => handle(post([violation({effectiveDirective: 'img-src', blockedURL: 'https://a.example'})]));
  assert.deepEqual([(await one()).status, (await one()).status, (await one()).status, (await one()).status], [204, 204, 204, 429]);
  tick(1000);
  assert.equal((await one()).status, 204);
});

test('OPTIONS는 204와 POST·content-type만 허용, 저장 실패는 502로 내용 없이', async () => {
  const {handle} = setup();
  const pre = await handle(new Request(URL_, {method: 'OPTIONS'}));
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
  assert.equal(pre.headers.get('Access-Control-Allow-Headers'), 'content-type');
  const failing = setup({storeStatus: 500});
  const res = await failing.handle(post([violation({effectiveDirective: 'img-src', blockedURL: 'https://a.example'})]));
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), {error: 'STORE_FAILED'});
  const notReady = createCspReportHandler({env: () => '', origins: ORIGINS, fetchImpl: async () => { throw new Error('no'); }});
  assert.equal((await notReady(post([violation({effectiveDirective: 'img-src', blockedURL: 'https://a.example'})]))).status, 500);
});

test('막힌 주소 줄이기: 출처나 정해진 낱말만', () => {
  assert.equal(blockedOf('https://A.Example.com/path?q=1#f'), 'https://a.example.com');
  assert.equal(blockedOf('http://127.0.0.1:47620/x'), 'http://127.0.0.1:47620');
  assert.equal(blockedOf('https://[::1]:8080/x'), 'other');
  assert.equal(blockedOf('wss://xmlkxfjeagycwttklxjw.supabase.co/realtime'), 'other');
  assert.equal(blockedOf('data:image/png;base64,AAAA'), 'data');
  assert.equal(blockedOf('blob:https://workonplus.com/abc'), 'blob');
  assert.equal(blockedOf('chrome-extension://abcdef/inject.js'), 'extension');
  assert.equal(blockedOf('moz-extension://abc/x'), 'extension');
  for (const w of ['inline', 'eval', 'wasm-eval', 'trusted-types-policy', 'trusted-types-sink']) assert.equal(blockedOf(w), w);
  for (const v of ['', null, undefined, 'about:blank', 'javascript:alert(1)', 'self', 'mailto:a@b.c', `https://${'a'.repeat(90)}.example`]) assert.equal(blockedOf(v), 'other', String(v));
  assert.equal(directiveOf("script-src-elem 'self'"), 'script-src-elem');
  assert.equal(directiveOf('IMG-SRC'), 'img-src');
  assert.equal(directiveOf('report-uri'), '');
  assert.equal(reportItems({}, 'application/csp-report', ORIGINS), null);
});

test('지시어 목록과 출처 모양은 DB 검사 제약과 같다(migration 원문 대조)', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20261125220000_csp_reports.sql', import.meta.url), 'utf8');
  const table = sql.match(/constraint app_csp_reports_directive check \(directive in \(([^)]*)\)\)/)[1];
  const listed = [...table.matchAll(/'([a-z-]+)'/g)].map(m => m[1]);
  assert.deepEqual(listed, [...DIRECTIVES]);
  const fnList = sql.match(/if v_directive not in \(([^)]*)\)/)[1];
  assert.deepEqual([...fnList.matchAll(/'([a-z-]+)'/g)].map(m => m[1]), [...DIRECTIVES]);
  // 표에는 날짜·지시어·출처·개수 칸만 있다(개인정보 칸 없음).
  const body = sql.match(/create table public\.app_csp_reports \(([\s\S]*?)\n\);/)[1];
  const columns = body.slice(0, body.indexOf('constraint')).split('\n').map(l => l.trim()).filter(Boolean).map(l => l.split(/\s+/)[0]);
  assert.deepEqual(columns, ['day', 'directive', 'blocked', 'hits']);
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /workspace_id|user_id|auth\.uid|document_uri|url text|sample|token/i);
});

test('index.ts: 공용 CORS 감싸기와 Web2 허용 출처를 쓰고, 로그를 남기지 않는다', () => {
  const index = readFileSync(new URL('../../supabase/functions/csp-report/index.ts', import.meta.url), 'utf8');
  const handler = readFileSync(new URL('../../supabase/functions/csp-report/handler.mjs', import.meta.url), 'utf8');
  assert.match(index, /origins: WEB2_ORIGINS/);
  assert.match(index, /verify_jwt=false/);
  for (const src of [index, handler]) assert.doesNotMatch(src, /console\./);
  const doc = readFileSync(new URL('../../docs/web2-env6b-edge-source.md', import.meta.url), 'utf8');
  const rows = doc.split('\n').filter(l => /^\| \d+ \| `csp-report` \|/.test(l));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].split('|')[6].trim(), 'false');
});
