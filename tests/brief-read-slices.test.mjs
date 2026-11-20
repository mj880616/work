// S67-33: 브리핑 read 단계가 HWP를 읽다 Edge 메모리 한도로 죽고 줄이 '만드는 중'으로 남던 문제.
// - HWP·HWPX는 자체 읽기(_shared/hwp-text.mjs)로 섹션을 흘려 풀고, 큰 파일은 여러 번에 나눠 읽는다(진행 n/t가 read 단계에서도 움직임).
// - 자료실 AI 색인이 끝까지 읽어 둔 글자가 있으면 Drive에서 다시 읽지 않는다.
// - 함수가 같은 자리에서 거듭 죽으면(남은 lease) read_failed로 끝낸다.
// 네트워크 없음: Drive·DB·AI는 메모리 가짜, 자료는 합성.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import * as dt from '../supabase/functions/_shared/document-text.ts';
import * as ht from '../supabase/functions/_shared/hwp-text.mjs';
import * as r from '../supabase/functions/document-actions/brief-run.mjs';
import { rowState, errorLine } from '../app/brief-room-model.mjs';
import { makeHwp, pressParas } from './helpers/hwp-synth.mjs';

const WS = 'a0000000-0000-4000-8000-000000000001', USER = 'b0000000-0000-4000-8000-000000000002', DOC = 'c0000000-0000-4000-8000-000000000003';
const SAMPLE_HWP = new Uint8Array(readFileSync(new URL('./fixtures/hwp-lab/sample.hwp', import.meta.url)));

function fakeDb() {
  const rows = []; let n = 0;
  const match = (row, q) => q.every(([k, v]) => ['select', 'limit'].includes(k) || (v.startsWith('eq.') ? String(row[k]) === decodeURIComponent(v.slice(3)) : v.startsWith('in.(') ? v.slice(4, -1).split(',').includes(String(row[k])) : false));
  const db = async (path, opts = {}) => {
    const [, qs] = path.split('?'); const q = [...new URLSearchParams(qs)];
    const method = opts.method ?? 'GET';
    if (method === 'GET') return rows.filter(x => match(x, q)).slice(0, 1).map(x => structuredClone(x));
    if (method === 'POST') { const row = { id: `d0000000-0000-4000-8000-00000000000${++n}`, attempts: 0, parts: [], brief: null, source_text: null, lease_until: null, updated_at: new Date(0).toISOString(), ...opts.body }; rows.push(row); return [{ ...row }]; }
    if (method === 'PATCH') {
      const hit = rows.filter(x => match(x, q)); hit.forEach(x => Object.assign(x, structuredClone(opts.body)));
      for (const x of hit) {
        // DB 제약(20261113220000)과 같은 검사
        assert.ok(x.source_text == null || [...x.source_text].length <= 600000, 'source_text 600,000자 안');
        assert.ok(Array.isArray(x.parts) && JSON.stringify(x.parts).length <= 1000000, 'parts는 배열');
        assert.ok(x.step_no >= 0 && x.step_no <= 1000 && x.step_total >= 0 && x.step_total <= 1000, 'step 범위');
        assert.ok(x.error_code == null || /^[a-z_]{1,40}$/.test(x.error_code), 'error_code 모양');
      }
      return hit.map(x => ({ id: x.id }));
    }
    throw new Error(method);
  };
  return { db, rows };
}

function drive(media, { sized = true } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(String(url)), method = init.method || 'GET';
    calls.push(method + ' ' + u.pathname + (u.searchParams.get('alt') ? '?alt=' + u.searchParams.get('alt') : ''));
    if (u.searchParams.get('alt') === 'media' && method === 'GET') return new Response(media, { headers: sized ? { 'content-length': String(media.byteLength) } : {} });
    if (u.pathname.endsWith('/copy')) return Response.json({ id: 'temp-1', mimeType: 'application/vnd.google-apps.document' });
    if (u.pathname.endsWith('/export')) return new Response('PDF 본문 '.repeat(200));
    if (method === 'DELETE') return new Response(null, { status: 204 });
    throw Error('unexpected ' + method + ' ' + u.pathname);
  };
  return { calls, fetch };
}

const aiOk = () => {
  const seen = [];
  return { seen, ai: async name => { seen.push(name); return { ok: true, model: 'test-model', text: JSON.stringify(name === 'brief_chunk'
    ? { lead: '조각 요지', touches: [], todos: ['기한 확인'], conflicts: [], quotes: [] }
    : { lead: '정원 확대 계획 재제출 요구.', touches: [], todos: ['기한 확인'], conflicts: [], quotes: [] }) }; } };
};

function runnerFor(media, file, { slice, index = {}, extractSpy } = {}) {
  const f = fakeDb(), d = drive(media), a = aiOk(); let t = 1_700_000_000_000;
  const reader = dt.createDocumentText({ fetch: d.fetch, driveToken: async () => 't', ...(slice ? { slice } : {}) });
  const doc = { id: DOC, workspace_id: WS, file_id: 'FILE_abcdefghij', file_size: media.byteLength, title: '합성 자료', ...file, ...index };
  const calls = [];
  const runner = r.createBriefRunner({
    db: f.db, ai: a.ai, capCheck: async () => ({ ok: true }), scope: async () => ({ orgs: [], areas: [] }), now: () => (t += 1000), budgetMs: 1e9,
    extract: async (x, opts) => { calls.push(opts?.from ?? null); extractSpy?.(opts); return reader.extract({ fileId: x.file_id, name: x.file_name, mime: x.mime_type, size: x.file_size }, { raw: true, ...opts }); },
  });
  return { f, d, a, doc, runner, calls, tick: ms => (t += ms) };
}

/** 'paused'가 나오면 다음 부름(continueLater)처럼 다시 run. 진행 표시를 모은다. */
async function runAll(x, max = 200) {
  const { row } = await x.runner.start({ userId: USER, doc: x.doc });
  const seen = [];
  for (let i = 0; i < max; i++) {
    const out = await x.runner.run(row.id, x.doc);
    const now = x.f.rows[0];
    seen.push({ stage: now.stage, step_no: now.step_no, step_total: now.step_total, text: rowState(now).text });
    if (out !== 'paused') return { out, seen, row: now };
  }
  throw new Error('끝나지 않음');
}

test('hwp-text: 실제 표본 HWP와 합성 HWP(미니 스트림·DIFAT·여러 섹션·표 컨트롤·탭)를 읽는다', async () => {
  assert.equal((await ht.hwpRead(SAMPLE_HWP)).text, 'HWP 편집기 시험 문서입니다. 이 문장을 고쳐 보세요.');
  const file = makeHwp({ sections: [['첫 문단', { text: '표 안 문단', ctrl: 'table' }], ['둘째\t섹션', '이모지 없는 끝 문단 😀']] });
  const got = await ht.hwpRead(file);
  assert.equal(got.text, '첫 문단\n표 안 문단\n둘째 섹션\n이모지 없는 끝 문단 😀');
  assert.equal(got.next, null); assert.equal(got.sections, 2);
  // 압축하지 않은 HWP
  assert.equal((await ht.hwpRead(makeHwp({ sections: [['압축 없음']], compressed: false }))).text, '압축 없음');
  // FAT 섹터가 109개를 넘는 파일(DIFAT 사슬, 약 7MB 이상)
  const big = makeHwp({ sections: [pressParas(30)], binBytes: 8 * 1024 * 1024 });
  assert.equal((await ht.hwpRead(big)).text.split('\n').length, 30);
  await assert.rejects(ht.hwpRead(new Uint8Array(2048)), e => e.code === 'HWP_BAD');
  await assert.rejects(ht.hwpRead(makeHwp({ sections: [['x']], password: true })), e => e.code === 'HWP_LOCKED');
});

test('hwp-text: 나눠 읽기(from → next)를 이어 붙이면 한 번에 읽은 것과 같다 — 같은 자리에서 맴돌지 않음', async () => {
  const file = makeHwp({ sections: [pressParas(3000), pressParas(1500, 3001)] });
  const whole = await ht.hwpRead(file);
  let from = { sec: 0, para: 0 }, parts = [], n = 0, last = null;
  while (from) {
    const got = await ht.hwpRead(file, { from, sliceOut: 24 * 1024 });
    if (last) assert.ok(got.next === null || got.next.sec > last.sec || (got.next.sec === last.sec && got.next.para > last.para), '앞으로만 간다');
    if (got.text) parts.push(got.text);
    last = from; from = got.next; n++;
    assert.ok(n < 500);
  }
  assert.ok(n > 3, `여러 번에 나눠 읽었다(${n}번)`);
  assert.equal(parts.join('\n'), whole.text);
  // 글자 수 상한(maxChars)에서도 멈추고 이어 읽는다
  const capped = await ht.hwpRead(file, { maxChars: 5000 });
  assert.ok(capped.next && capped.text.length >= 5000 && capped.text.length < 5300);
});

test('hwp-text: HWPX도 섹션을 흘려 풀고 나눠 읽는다(자료실 저장 길 hwpxText와 같은 글)', async () => {
  const sec = paras => `<?xml version="1.0"?><hs:sec xmlns:hp="x">${paras.map(p => `<hp:p><hp:run><hp:t>${p}</hp:t></hp:run></hp:p>`).join('')}</hs:sec>`;
  const zipOf = entries => {
    const local = [], central = []; let offset = 0;
    for (const [name, text] of entries) {
      const raw = Buffer.from(text, 'utf8'), data = deflateRawSync(raw), nm = Buffer.from(name, 'utf8');
      const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(8, 8); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(nm.length, 26);
      local.push(h, nm, data);
      const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(offset, 42);
      central.push(c, nm); offset += 30 + nm.length + data.length;
    }
    const cd = Buffer.concat(central), e = Buffer.alloc(22);
    e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(entries.length, 8); e.writeUInt16LE(entries.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(offset, 16);
    return new Uint8Array(Buffer.concat([...local, cd, e]));
  };
  const lines = n => Array.from({ length: n }, (_, i) => `${i + 1}번 문단 A &amp; B 인력 충원 ${i * 7919 % 10007}`);
  const file = zipOf([['Contents/section0.xml', sec(lines(4000))], ['Contents/section1.xml', sec(lines(2000))]]);
  const whole = await ht.hwpxRead(file);
  assert.equal(whole.text, await dt.hwpxText(file, { all: true }));
  let from = { sec: 0, para: 0 }, parts = [], n = 0;
  while (from) { const got = await ht.hwpxRead(file, { from, sliceOut: 24 * 1024 }); if (got.text) parts.push(got.text); from = got.next; assert.ok(++n < 500); }
  assert.ok(n > 3); assert.equal(parts.join('\n'), whole.text);
});

test('브리핑: 보통 크기 HWP(보도자료, 그림 포함 약 1MB)는 한 번에 읽고 끝까지 만든다', async () => {
  const media = makeHwp({ sections: [pressParas(40)], binBytes: 900 * 1024 });
  const x = runnerFor(media, { file_name: '261120 보도자료.hwp', mime_type: 'application/x-hwp' });
  const { out, row } = await runAll(x);
  assert.equal(out, 'done'); assert.equal(row.status, 'done'); assert.equal(row.error_code ?? null, null);
  assert.equal(x.calls.length, 1, '읽기는 한 번');
  assert.equal(row.brief.lead, '정원 확대 계획 재제출 요구.');
  assert.deepEqual(x.d.calls, ['GET /drive/v3/files/FILE_abcdefghij?alt=media'], 'Drive 사본 없이 내려받기만');
  assert.equal(row.source_text, null); assert.equal(row.lease_until, null);
});

test('브리핑: 큰 HWP는 read 단계를 여러 번에 나눠 읽고(진행 n/t가 움직임) 끝까지 만든다', async () => {
  const media = makeHwp({ sections: [pressParas(1500), pressParas(800, 1501)], binBytes: 3 * 1024 * 1024 });
  const x = runnerFor(media, { file_name: '큰 자료.hwp', mime_type: '' }, { slice: { in: 1e9, out: 48 * 1024 } });
  const { out, seen, row } = await runAll(x);
  assert.equal(out, 'done', JSON.stringify(row.error_code));
  const reads = seen.filter(s => s.stage === 'read');
  assert.ok(reads.length >= 3, `read 단계가 ${reads.length}번에 나뉨`);
  for (let i = 1; i < reads.length; i++) assert.ok(reads[i].step_no > reads[i - 1].step_no, '읽은 몫 수가 는다');
  assert.match(reads[0].text, /^파일 읽기 1\/\d+$/);
  assert.ok(reads.every(s => s.step_no <= s.step_total));
  assert.ok(x.calls[0] === null && x.calls.slice(1).every(c => c && Number.isInteger(c.sec) && Number.isInteger(c.para)), '다음 부름은 남은 위치부터');
  // 나눠 읽은 글 = 한 번에 읽은 글(빠짐·겹침 없음): 조각 수로 확인
  const once = await ht.hwpRead(media);
  const chunkTotal = row.step_total; // 조각 수 + 합치기 1
  const { splitChunks, tidyBriefText, BRIEF_CHUNK_CHARS } = await import('../supabase/functions/_shared/brief-room.mjs');
  assert.equal(chunkTotal, splitChunks(tidyBriefText(once.text).text, BRIEF_CHUNK_CHARS).length + 1);
  assert.equal(x.a.seen.filter(s => s === 'brief_chunk').length, chunkTotal - 1);
});

test('브리핑: 원문 상한(600,000자)에 닿으면 거기서 읽기를 멈추고 만든다(실패하지 않음)', async () => {
  const media = makeHwp({ sections: [pressParas(9000)] }); // 약 90만 자
  let asked = [];
  const x = runnerFor(media, { file_name: '아주 긴 자료.hwp', mime_type: '' }, { slice: { in: 1e9, out: 256 * 1024 }, extractSpy: o => asked.push(o.maxChars) });
  const { out, row } = await runAll(x);
  assert.equal(out, 'done');
  assert.ok(asked.every(n => n > 0 && n <= 600000));
  assert.ok(row.step_total - 1 <= 60);
});

test('브리핑: 큰 PDF는 Drive 변환 한 번(내려받지 않음, 내보내기 4MB 상한) — 메모리 위험 없음', async () => {
  const media = new Uint8Array(16);
  const x = runnerFor(media, { file_name: '큰 편람.pdf', mime_type: 'application/pdf', file_size: 45 * 1024 * 1024 });
  x.doc.file_size = 45 * 1024 * 1024;
  const { out } = await runAll(x);
  assert.equal(out, 'done');
  assert.ok(!x.d.calls.some(c => c.includes('alt=media')), 'PDF 원본은 함수로 내려받지 않는다');
  assert.equal(dt.RAW_EXPORT_MAX_BYTES, 4 * 1024 * 1024);
});

test('브리핑: 자료실 AI 색인이 끝까지 읽어 둔 글자가 있으면 Drive에서 다시 읽지 않는다', async () => {
  const text = pressParas(30).map(p => typeof p === 'string' ? p : p.text).join('\n');
  const media = makeHwp({ sections: [['다른 글']] });
  const x = runnerFor(media, { file_name: '보도자료.hwp', mime_type: '' }, { index: { extracted_text: text, extraction_status: 'ready' } });
  const { out, row } = await runAll(x);
  assert.equal(out, 'done'); assert.equal(x.calls.length, 0, 'extract를 부르지 않음'); assert.equal(x.d.calls.length, 0);
  assert.equal(row.step_total, 2);
});

test('브리핑: 잘린 색인 글자(12,000자·[이하 생략])·PDF 색인 글자·준비 안 된 글자는 쓰지 않고 파일을 읽는다', async () => {
  const cut12k = '가'.repeat(12000), cut50k = '나'.repeat(50000) + '\n…[이하 생략]';
  assert.equal(r.fullIndexText({ file_name: 'a.hwp', extraction_status: 'ready', extracted_text: cut12k }), '');
  assert.equal(r.fullIndexText({ file_name: 'a.hwp', extraction_status: 'ready', extracted_text: cut50k }), '');
  assert.equal(r.fullIndexText({ file_name: 'a.pdf', extraction_status: 'ready', extracted_text: '다'.repeat(5000) }), '', 'PDF는 AI가 옮긴 글일 수 있다');
  assert.equal(r.fullIndexText({ file_name: 'a.hwp', extraction_status: 'error', extracted_text: '다'.repeat(5000) }), '');
  assert.equal(r.fullIndexText({ file_name: 'a.hwpx', extraction_status: 'ready', extracted_text: '라'.repeat(20000) }).length, 20000, '12,000자와 50,000자 사이 = 색인이 자르지 않은 글');
  const media = makeHwp({ sections: [pressParas(40)] });
  const x = runnerFor(media, { file_name: '보도자료.hwp', mime_type: '' }, { index: { extracted_text: cut12k, extraction_status: 'ready' } });
  assert.equal((await runAll(x)).out, 'done'); assert.equal(x.calls.length, 1, '파일을 읽었다');
});

test('브리핑: 같은 자리에서 함수가 거듭 죽으면(남은 lease) read_failed로 끝나고, 한 번 죽은 뒤 살아나면 끝까지 만든다', async () => {
  const media = makeHwp({ sections: [pressParas(40)] });
  // ① 세 번 죽음: 잡기만 하고(lease 남김) 정리 없이 사라진 실행을 흉내 낸다
  { const x = runnerFor(media, { file_name: 'a.hwp', mime_type: '' });
    const { row } = await x.runner.start({ userId: USER, doc: x.doc });
    for (let i = 0; i < r.BRIEF_MAX_DEATHS; i++) { const got = await x.runner.claim(row.id, x.tick(0)); assert.ok(got, `${i + 1}번째 잡기`); x.tick(r.BRIEF_LEASE_MS + 1000); }
    assert.equal(await x.runner.run(row.id, x.doc), 'busy', '실패로 끝내고 더 돌리지 않는다');
    const saved = x.f.rows[0];
    assert.equal(saved.status, 'failed'); assert.equal(saved.error_code, 'read_failed'); assert.equal(saved.lease_until, null); assert.equal(saved.source_text, null);
    assert.equal(rowState(saved).text, '파일을 끝까지 읽지 못했어요');
    assert.equal(x.calls.length, 0); }
  // ② 지금 걸린 줄과 같은 모양(running·read·0/0·attempts 2·lease 남음) → 다음 시도에서 완성
  { const x = runnerFor(media, { file_name: 'a.hwp', mime_type: '' });
    const { row } = await x.runner.start({ userId: USER, doc: x.doc });
    Object.assign(x.f.rows[0], { status: 'running', stage: 'read', step_no: 0, step_total: 0, attempts: 2, lease_until: new Date(x.tick(0) - 60000).toISOString() });
    assert.equal(await x.runner.run(row.id, x.doc), 'done'); assert.equal(x.f.rows[0].status, 'done'); }
  // ③ 정상 멈춤(lease를 푼 pause)은 죽음으로 세지 않는다
  { const x = runnerFor(makeHwp({ sections: [pressParas(1500)] }), { file_name: 'a.hwp', mime_type: '' }, { slice: { in: 1e9, out: 24 * 1024 } });
    const { out } = await runAll(x);
    assert.equal(out, 'done'); }
});

test('브리핑: 나눠 읽는 도중 파일이 깨지면 read_failed, 암호 문서는 locked(화면 한 줄)', async () => {
  { const x = runnerFor(makeHwp({ sections: [['비밀 문서']], password: true }), { file_name: 'a.hwp', mime_type: '' });
    const { out, row } = await runAll(x);
    assert.equal(out, 'failed'); assert.equal(row.error_code, 'locked'); assert.equal(rowState(row).text, '암호가 걸린 파일이라 읽을 수 없어요'); }
  { const media = makeHwp({ sections: [pressParas(1500)] });
    const x = runnerFor(media, { file_name: 'a.hwp', mime_type: '' }, { slice: { in: 1e9, out: 24 * 1024 } });
    const { row } = await x.runner.start({ userId: USER, doc: x.doc });
    assert.equal(await x.runner.run(row.id, x.doc), 'paused');
    media.fill(0, 0, 512); // 다음 부름에서는 파일 머리가 깨졌다
    assert.equal(await x.runner.run(row.id, x.doc), 'failed');
    assert.equal(x.f.rows[0].error_code, 'read_failed'); }
});

test('내려받기: 크기를 아는 응답은 한 번에 받고(두 벌 없음), 모르면 옛 상한 30MB까지만', async () => {
  const media = makeHwp({ sections: [pressParas(10)] });
  const ok = await dt.createDocumentText({ fetch: drive(media, { sized: false }).fetch, driveToken: async () => 't' }).extract({ fileId: 'h', name: 'a.hwp', mime: '', size: null }, { raw: true });
  assert.equal(ok.source, 'content');
  assert.equal(dt.HWP_MAX_BYTES, 80 * 1024 * 1024); assert.equal(dt.UNSIZED_MAX_BYTES, 30 * 1024 * 1024);
  // 선언 크기보다 많이 오면 읽기 실패
  const liar = async () => new Response(media, { headers: { 'content-length': String(media.byteLength - 100) } });
  const bad = await dt.createDocumentText({ fetch: liar, driveToken: async () => 't' }).extract({ fileId: 'h', name: 'a.hwp', mime: '', size: null }, { raw: true });
  assert.equal(bad.reason, 'read_failed');
});

test('화면 모델: read 단계 진행은 "파일 읽기 n/t", 새 실패 한 줄', () => {
  assert.equal(rowState({ status: 'running', stage: 'read', step_no: 2, step_total: 5 }).text, '파일 읽기 2/5');
  assert.equal(rowState({ status: 'running', stage: 'read', step_no: 0, step_total: 0 }).text, '만드는 중');
  assert.equal(rowState({ status: 'running', stage: 'chunk', step_no: 1, step_total: 4 }).text, '만드는 중 1/4');
  assert.equal(errorLine('read_failed'), '파일을 끝까지 읽지 못했어요');
  assert.equal(errorLine('locked'), '암호가 걸린 파일이라 읽을 수 없어요');
});
