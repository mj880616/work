import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const sourceUrl = new URL('../../scripts/diag/library-upload-diag.js', import.meta.url);
const bookmarkUrl = new URL('../../scripts/diag/library-upload-diag.bookmarklet.txt', import.meta.url);
const source = existsSync(sourceUrl) ? readFileSync(sourceUrl, 'utf8') : '';

test('reviewable diagnostic source and executable one-line bookmark are present and identical', () => {
  assert.ok(source.length > 0, 'diagnostic source is missing');
  const bookmark = readFileSync(bookmarkUrl, 'utf8').trim();
  assert.match(bookmark, /^javascript:/);
  assert.equal(bookmark.includes('\n'), false);
  assert.equal(decodeURIComponent(bookmark.slice('javascript:'.length)), source.trim());
  new vm.Script(source);
});

function assertStaticBoundary(source) {
  assert.ok(source, 'diagnostic source is missing');
  new vm.Script(source);
  // This workflow runs without npm install. Literal/source constraints plus
  // native-API behavioral tests below require no optional parser dependency.
  const code = source.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
  const strings = code.match(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g) || [];
  const tokens = code.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''");
  for (const literal of strings) assert.doesNotMatch(literal, /\\(?:x|u|[0-7])/, 'encoded identifiers/URLs are forbidden');
  assert.doesNotMatch(tokens, /\bimport\b|`/, 'imports and executable templates are forbidden');
  const forbidden = ['console', 'alert', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'eval', 'Function', 'local' + 'Storage', 'session' + 'Storage', 'indexed' + 'DB', 'importScripts'];
  // Function.prototype.toString is a read-only fingerprint, not construction.
  const inspected = tokens.replace('Function.prototype.toString.call(window.fetch)', '');
  for (const name of forbidden) assert.doesNotMatch(inspected, new RegExp('\\b' + name + '\\b'), `forbidden API: ${name}`);
  for (const property of ['cookie', 'innerHTML', 'outerHTML', 'src', 'href', 'sendBeacon', 'open', 'send', 'setItem', 'removeItem', 'clear']) {
    assert.doesNotMatch(tokens, new RegExp('\\.\\s*' + property + '\\b'), `forbidden sink: ${property}`);
    assert.ok(!strings.includes("'" + property + "'") && !strings.includes('"' + property + '"'), `computed sink: ${property}`);
  }
  const paths = strings.filter(value => /^['"]\/functions\//.test(value)).map(value => value.slice(1, -1));
  assert.equal((tokens.match(/\bfetch\s*\(/g) || []).length, 1);
  assert.equal((tokens.match(/window\.fetch\s*\(/g) || []).length, 1);
  // No aliases or computed window network access. The only computed window
  // property is the explicit non-secret diagnostic flight marker.
  assert.equal((tokens.match(/\bfetch\b/g) || []).length, 2);
  for (const property of tokens.matchAll(/window\s*\[([^\]]+)\]/g)) assert.equal(property[1], 'flightKey');
  for (const property of tokens.matchAll(/window\.([A-Za-z_$][\w$]*)/g)) assert.ok(['fetch', 'crypto', 'KPTURuntime'].includes(property[1]));
  assert.equal((tokens.match(/\bcreateElement\b/g) || []).length, 1);
  assert.match(code, /const node = document\.createElement\(tag\);/);
  assert.doesNotMatch(tokens, /\bdocument\s*\[/);
  assert.ok(!strings.includes("'createElement'") && !strings.includes('"createElement"'));
  for (const tag of code.matchAll(/element\('([^']+)'/g)) assert.ok(['section', 'h2', 'div', 'button', 'input', 'p', 'table', 'tr', 'thead', 'th', 'tbody', 'textarea', 'td'].includes(tag[1]), 'no external resource elements');
  assert.deepEqual(paths.sort(), ['/functions/v1/library-files', '/functions/v1/meeting-files']);
  assert.match(source, /body\.append\(idField, window\.crypto\.randomUUID\(\)\)/);
  assert.match(source, /window\.fetch\(url, \{ method: 'POST', headers, body, signal: controller\.signal, redirect: 'error' \}\)/);
  assert.match(source, /const url = baseOrigin \+ paths\[endpoint\]/);
  assert.match(source, /if \(!Object\.hasOwn\(paths, endpoint\)\) throw/);
  assert.match(source, /const idField = endpoint === 'library' \? 'project_id' : 'meeting_id'/);
  assert.match(source, /if \(name === undefined\) body\.append\('file', file\)/);
  assert.match(source, /else body\.append\('file', file, name\)/);
  assert.equal((tokens.match(/(?<![.\w])body\.append\s*\(/g) || []).length, 3);
  assert.match(source, /Object\.keys\(headers\)/);
  assert.doesNotMatch(source, /JSON\.stringify\((?:headers|session|runtime|config)\)/);
  assert.doesNotMatch(source, /https?:\/\//);
  assert.doesNotMatch(source, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
}

test('static boundary rejects alternate resource loads, escaped sinks and ID-less upload paths', () => {
  assertStaticBoundary(source);
  const mutants = [
    source + "\nconst resource=document.createElement('script');resource['\\x73rc']=window.KPTURuntime.config.url+'/diagnostic.js';document.body.append(resource);",
    source + "\nconst resource=element('div');resource['\\u0073rc']=window.KPTURuntime.config.url;",
    source.replace('document.createElement(tag)', "document.createElement('script')"),
    source.replace('body.append(idField, window.crypto.randomUUID());', '')
  ];
  for (const mutant of mutants) assert.throws(() => assertStaticBoundary(mutant), 'static guard must reject dangerous edits');
});

// Browser adapters only: run the actual unmodified bookmark with native Node
// File/FormData/Response. The fake transport captures its outbound contract.
function harness({ transport, session = { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' }, url = 'https:' + '//runtime.invalid', fastTimeout = false, clipboardFails = false } = {}) {
  const nodes = [];
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this.listeners = {}; this.textContent = ''; nodes.push(this); }
    append(child) { this.children.push(child); }
    setAttribute() {}
    addEventListener(name, handler) { this.listeners[name] = handler; }
    replaceChildren() { this.children = []; }
    focus() {}
    select() { this.selected = true; }
    click() { this.clicked = true; return this.listeners.click?.(); }
    remove() { this.removed = true; }
  }
  const requests = [];
  const copied = [];
  let inFlight = 0;
  let peak = 0;
  const key = 'synthetic-api-key';
  const rawFetch = async (target, options) => {
    requests.push({ target, ...options });
    peak = Math.max(peak, ++inFlight);
    try {
      if (transport) return await transport(target, options, requests.length);
      await new Promise(resolve => setTimeout(resolve, 1));
      const meeting = target.endsWith('meeting-files');
      const missing = !options.body.has('file');
      return new Response(JSON.stringify({ code: missing ? 'file_missing' : meeting ? 'RESOURCE_FORBIDDEN' : 'project_not_found' }), { status: missing ? 400 : meeting ? 403 : 404 });
    } finally { inFlight--; }
  };
  const window = {
    crypto: webcrypto,
    KPTURuntime: { config: { url, key }, session: { read: () => session } },
    // Match the actual auth-bootstrap wrapper fingerprint without printing it.
    fetch: async function(input, init) {
      const response = await rawFetch(input, init);
      if (input.includes('/auth/v1/user')) return response;
      return response;
    }
  };
  const document = { body: new Node('body'), createElement: tag => new Node(tag), getElementById: id => nodes.find(node => node.id === id && !node.removed) };
  const context = vm.createContext({ window, document, navigator: { clipboard: { writeText: async text => {
    if (clipboardFails) throw new Error('blocked');
    copied.push(text);
  } } }, URL, File, Blob, FormData, Response, AbortController, performance, setTimeout: (fn, delay) => setTimeout(fn, fastTimeout ? 15 : delay), clearTimeout });
  vm.runInContext(source, context);
  const button = text => nodes.find(node => node.tag === 'button' && node.textContent === text);
  const input = nodes.find(node => node.tag === 'input');
  const tbody = nodes.find(node => node.tag === 'tbody');
  return {
    nodes, requests, copied, key, window, context, button, input,
    peak: () => peak,
    results: () => tbody.children.map(tr => tr.children.map(td => td.textContent)),
    select: selected => { input.files = selected; input.listeners.change(); },
    start: () => button('진단 시작').click(),
    output: () => nodes.map(node => node.textContent + (node.value || '')).join('\n')
  };
}

test('multiple file selection runs T0–T7 sequentially with correct payloads, IDs, headers and UTC evidence', async () => {
  const h = harness();
  const files = [new File(['123456789012345'], '한글 name.pdf', { type: 'application/pdf', lastModified: 1234 }), new File(['abc'], 'two.txt', { type: 'text/plain', lastModified: 5678 })];
  assert.equal(h.requests.length, 0);
  assert.equal(h.input.multiple, true);
  h.button('파일 고르기').click();
  assert.equal(h.input.clicked, true);
  h.select(files);
  const running = h.start();
  await h.start(); // Double tap cannot issue another run.
  await running;
  assert.equal(h.peak(), 1);
  assert.equal(h.requests.length, 14);
  const ids = [];
  for (let i = 0; i < files.length; i++) {
    const batch = h.requests.slice(i * 7, i * 7 + 7);
    for (const [j, request] of batch.entries()) {
      assert.equal(request.target, h.window.KPTURuntime.config.url + '/functions/v1/' + (j === 6 ? 'meeting-files' : 'library-files'));
      assert.equal(request.method, 'POST');
      assert.equal(request.redirect, 'error');
      assert.deepEqual(Object.keys(request.headers), ['apikey', 'Authorization']);
      assert.equal(request.headers.apikey, h.key);
      assert.equal(request.headers.Authorization, 'Bearer synthetic-access');
      const idField = j === 6 ? 'meeting_id' : 'project_id';
      assert.deepEqual([...request.body.keys()], j === 0 ? [idField] : ['file', idField]);
      const id = request.body.get(idField);
      assert.match(id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
      ids.push(id);
    }
    const payloads = batch.map(request => request.body.get('file'));
    assert.equal(payloads[1].size, 10);
    assert.equal(payloads[2].size, files[i].size);
    assert.ok([...new Uint8Array(await payloads[2].arrayBuffer())].every(byte => byte === 0));
    for (const j of [3, 4, 5, 6]) assert.equal(await payloads[j].text(), await files[i].text());
    for (const j of [3, 4, 6]) assert.equal(payloads[j].name, files[i].name);
    for (const j of [3, 6]) assert.strictEqual(payloads[j], files[i], 'original File must be appended without wrapping/renaming');
    for (const j of [1, 2, 5]) assert.equal(payloads[j].name, 'diag.pdf');
    assert.equal(payloads[4].type, files[i].type);
  }
  assert.equal(new Set(ids).size, 14);
  const results = h.results();
  assert.equal(results.length, 16);
  assert.match(results[0][7], /로그인 세션: 예[\s\S]*앱 fetch 래퍼: 예[\s\S]*첫 1바이트 읽기: 성공/);
  for (const row of results) {
    assert.match(row[1], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.match(row[2], /^\d+$/);
  }
  assert.deepEqual(results.slice(1, 8).map(row => row[4]), ['400', '404', '404', '404', '404', '404', '403']);
  assert.equal(results[1][5], 'file_missing');
  assert.equal(results.filter(row => row[7].includes('헤더 이름:')).length, 2);
  await h.button('결과 복사').click();
  assert.equal(h.copied.length, 1);
  assert.ok(!h.copied[0].includes(h.key));
  assert.ok(!h.copied[0].includes('synthetic-access'));
  vm.runInContext(source, h.context);
  assert.equal(h.nodes.filter(node => node.id === 'library-upload-diag-panel').length, 1);
  h.button('닫기').click();
  assert.ok(h.nodes.find(node => node.id === 'library-upload-diag-panel').removed);
});

test('network errors preserve cause, mask credentials in all outputs, continue without retry, and copy fallback is selectable', async () => {
  const h = harness({ clipboardFails: true, transport: async (_, options, count) => {
    if (count === 4) {
      const error = new Error('failed synthetic-access synthetic-api-key synthetic-refresh');
      error.name = 'TypeError';
      error.cause = { name: 'Cause', message: 'synthetic-access', code: 'SYNTHETIC_NET' };
      throw error;
    }
    return new Response(JSON.stringify({ code: 'synthetic-api-key' }), { status: 404 });
  } });
  h.select([new File(['file'], 'x.pdf')]);
  await h.start();
  assert.equal(h.requests.length, 7);
  assert.match(h.results()[4][6], /TypeError[\s\S]*Cause[\s\S]*SYNTHETIC_NET/);
  assert.equal(h.results()[4][3], '아니오');
  await h.button('결과 복사').click();
  const textarea = h.nodes.find(node => node.tag === 'textarea');
  assert.equal(textarea.hidden, false);
  assert.equal(textarea.selected, true);
  for (const secret of ['synthetic-access', 'synthetic-api-key', 'synthetic-refresh']) assert.ok(!h.output().includes(secret));
});

test('file read failure is recorded for T0 and T5, T6 is skipped, T4 and T7 still use original File', async () => {
  const h = harness();
  const file = new File(['readable multipart'], 'x.pdf');
  file.arrayBuffer = async () => { throw new Error('file provider read failure'); };
  file.slice = () => ({ arrayBuffer: file.arrayBuffer });
  h.select([file]);
  await h.start();
  assert.equal(h.requests.length, 5);
  assert.match(h.results()[0][7], /첫 1바이트 읽기: 실패/);
  assert.match(h.results()[5][6], /file provider read failure/);
  assert.equal(h.results()[6][3], '미실행');
  assert.equal(h.results()[7][4], '403');
});

test('60-second boundary aborts and stops later trials even if fetch ignores cancellation', async () => {
  let release;
  const h = harness({ fastTimeout: true, transport: () => new Promise(resolve => { release = resolve; }) });
  h.select([new File(['file'], 'x.pdf')]);
  await h.start();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].signal.aborted, true);
  assert.match(h.results()[1][6], /TimeoutError/);
  release(new Response('{}', { status: 404 }));
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(h.requests.length, 1);
  assert.equal(h.results()[1][3], '아니오');
});

test('unsettled request blocks reselection and a reopened bookmark after timeout', async () => {
  const h = harness({ fastTimeout: true, transport: () => new Promise(() => {}) });
  const file = new File(['file'], 'x.pdf');
  h.select([file]);
  await h.start();
  h.select([file]);
  await h.start();
  assert.equal(h.requests.length, 1, 'timeout cannot unlock an unsettled request');
  h.button('닫기').click();
  vm.runInContext(source, h.context);
  const newInput = h.nodes.filter(node => node.tag === 'input').at(-1);
  newInput.files = [file];
  newInput.listeners.change();
  const newStart = h.nodes.filter(node => node.tag === 'button' && node.textContent === '진단 시작').at(-1);
  await newStart.click();
  assert.equal(h.requests.length, 1, 'close/reopen cannot bypass the pending-flight lock');
});

test('same-size generated payload uses bounded allocation for a multi-megabyte file', async () => {
  const h = harness();
  const file = new File([new Uint8Array(2700000)], 'large.pdf');
  const allocations = [];
  vm.runInContext('globalThis.originalUint8Array = Uint8Array', h.context);
  h.context.Uint8Array = class extends Uint8Array {
    constructor(size) { allocations.push(size); super(size); }
  };
  h.select([file]);
  await h.start();
  assert.equal(h.requests[2].body.get('file').size, file.size);
  // The actual constructor receives the sizes; this catches contiguous
  // file-sized allocations without asserting implementation helpers.
  assert.ok(allocations.every(size => size <= 65536), 'diagnostic allocations must stay at most 64KiB');
});

test('timeout while reading T5 cannot send a late request or run T6/T7', async () => {
  let release;
  const h = harness({ fastTimeout: true });
  const file = new File(['file'], 'x.pdf');
  file.arrayBuffer = () => new Promise(resolve => { release = resolve; });
  h.select([file]);
  await h.start();
  assert.equal(h.requests.length, 4);
  assert.match(h.results()[5][6], /TimeoutError/);
  release(new ArrayBuffer(4));
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(h.requests.length, 4);
});

test('close aborts active request and prevents subsequent requests', async () => {
  const h = harness({ transport: (_, options) => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason))) });
  h.select([new File(['file'], 'x.pdf')]);
  const run = h.start();
  while (!h.requests.length) await new Promise(resolve => setTimeout(resolve, 1));
  h.button('닫기').click();
  await run;
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].signal.aborted, true);
});

test('missing login never transmits; malformed runtime origin fails closed', async () => {
  for (const options of [{ session: null }, { url: 'https:' + '//runtime.invalid/other' }, { url: 'https:' + '//user:pass@runtime.invalid' }]) {
    const h = harness(options);
    h.select([new File(['file'], 'x.pdf')]);
    await h.start();
    assert.equal(h.requests.length, 0);
    assert.ok(h.results().some(row => row[6]));
    if (options.session === null) assert.match(h.results()[0][7], /로그인 세션: 아니오/);
  }
});
