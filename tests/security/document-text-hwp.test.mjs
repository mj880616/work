// S67-28: 브리핑 룸이 HWP를 '브리핑할 수 없는 형식'으로 끝내던 문제.
// - HWP(구형): 부르는 쪽(document-actions)이 넘긴 HWP 글자 읽기(npm:@ssabrojs/hwpxjs hwpToText, 자료 AI 색인과 같은 것)로 읽는다.
//   Drive 변환(임시 Google 문서 사본)을 거치지 않는다. 글자 읽기를 넘기지 않는 곳(drive-summary 야간 채우기)은 지금까지처럼 Drive 변환 길.
// - HWPX: 브리핑 길(raw)은 끝까지 읽는다(전에는 앞 24,000자쯤에서 멈춰 긴 문서 뒷부분이 브리핑에서 빠졌다).
// 네트워크 없음: Drive·DB·AI는 메모리 가짜. HWP 라이브러리는 이 환경에서 받을 수 없어 가짜로 바꿔 끼우고, 원본 바이트가 그대로 넘어가는지 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import * as dt from '../../supabase/functions/_shared/document-text.ts';
import * as run from '../../supabase/functions/document-actions/brief-run.mjs';
import { makeHwp } from '../helpers/hwp-synth.mjs';

const SAMPLE_HWP = new Uint8Array(readFileSync(new URL('../fixtures/hwp-lab/sample.hwp', import.meta.url)));
const SAMPLE_HWPX = new Uint8Array(readFileSync(new URL('../fixtures/hwp-lab/sample.hwpx', import.meta.url)));

function zip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const raw = Buffer.from(text, 'utf8'), data = deflateRawSync(raw), n = Buffer.from(name, 'utf8');
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(8, 8); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(n.length, 26);
    local.push(h, n, data);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(entries.length, 8); e.writeUInt16LE(entries.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, cd, e]));
}
const section = paras => `<?xml version="1.0"?><hs:sec xmlns:hp="x">${paras.map(p => `<hp:p><hp:run><hp:t>${p}</hp:t></hp:run></hp:p>`).join('')}</hs:sec>`;

function drive(media) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(String(url)), method = init.method || 'GET';
    calls.push(method + ' ' + u.pathname + u.search);
    if (u.searchParams.get('alt') === 'media' && method === 'GET') return new Response(media);
    if (u.pathname.endsWith('/copy')) return Response.json({}, { status: 400 }); // Drive는 HWP를 Google 문서로 바꾸지 못한다
    throw Error('unexpected ' + method + ' ' + u.pathname);
  };
  return { calls, fetch };
}

// 보도자료 같은 HWP 본문(브리핑 최소 글자 300자를 넘게).
const RELEASE = ['보도자료 예시 기관 노동조합', '1. 철도 안전 인력 충원 요구', '예시 문단입니다. 현장 인력 부족으로 야간 점검이 줄었다. '.repeat(20), '2. 향후 계획', '11월 말까지 의견을 낸다.'].join('\n');

test('textKindOf: HWP(구형)는 따로 읽는다(확장자·Drive 형식); HWPX·PDF·DOCX는 그대로', () => {
  assert.equal(dt.textKindOf('261120 보도자료.hwp', ''), 'hwp');
  assert.equal(dt.textKindOf('a.HWP', 'application/pdf'), 'hwp');
  for (const mime of ['application/x-hwp', 'application/haansofthwp', 'application/vnd.hancom.hwp']) assert.equal(dt.textKindOf('이름없음', mime), 'hwp', mime);
  assert.equal(dt.textKindOf('a.hwpx', ''), 'hwpx');
  assert.equal(dt.textKindOf('이름없음', 'application/vnd.hancom.hwpx'), 'hwpx');
  assert.equal(dt.textKindOf('이름없음', 'application/hwp+zip'), 'hwpx');
  for (const name of ['a.pdf', 'a.docx', 'a.doc', 'a.odt', 'a.rtf']) assert.equal(dt.textKindOf(name, ''), 'convert', name);
  assert.equal(dt.HWP_MAX_BYTES, dt.HWPX_MAX_BYTES);
});

test('HWP: 내려받아 자체 읽기(섹션을 흘려 풀기)로 뽑는다 — 실제 표본·합성 보도자료, Drive 사본 없음, 원본 쓰기 없음', async () => {
  const d = drive(SAMPLE_HWP);
  const reader = dt.createDocumentText({ fetch: d.fetch, driveToken: async () => 't' });
  const raw = await reader.extract({ fileId: 'hwp-1', name: '261120 보도자료.hwp', mime: 'application/x-hwp', size: SAMPLE_HWP.byteLength }, { raw: true });
  assert.equal(raw.source, 'content'); assert.equal(raw.reason, 'ok'); assert.equal(raw.next, null);
  assert.equal(raw.text, 'HWP 편집기 시험 문서입니다. 이 문장을 고쳐 보세요.');
  assert.deepEqual(d.calls, ['GET /drive/v3/files/hwp-1?alt=media']);
  const release = makeHwp({ sections: [RELEASE.split('\n')] });
  const r2 = await dt.createDocumentText({ fetch: drive(release).fetch, driveToken: async () => 't' }).extract({ fileId: 'h', name: 'a.hwp', mime: '', size: release.byteLength }, { raw: true });
  assert.equal(r2.text, RELEASE);
  // 자료실 글자 칸 길(raw 아님)도 같은 읽기를 쓰고 정리·자르기를 한다.
  const tidy = await dt.createDocumentText({ fetch: drive(release).fetch, driveToken: async () => 't' }).extract({ fileId: 'h', name: '261120 보도자료.hwp', mime: '', size: 10 });
  assert.equal(tidy.source, 'content'); assert.ok(tidy.text.startsWith('보도자료 예시 기관 노동조합'));
});

test('HWP: 크기 상한·깨진 파일·암호 문서·빈 글자; Drive 변환 길로 보내지 않는다', async () => {
  { const d = drive(SAMPLE_HWP);
    const r = await dt.createDocumentText({ fetch: d.fetch, driveToken: async () => 't' }).extract({ fileId: 'h', name: 'a.hwp', mime: '', size: dt.HWP_MAX_BYTES + 1 }, { raw: true });
    assert.equal(r.reason, 'too_large'); assert.equal(d.calls.length, 0); }
  { const d = drive(new Uint8Array(4096).fill(7)); const logs = [];
    const r = await dt.createDocumentText({ fetch: d.fetch, driveToken: async () => 't', log: c => logs.push(c) }).extract({ fileId: 'h', name: 'a.hwp', mime: '', size: 4096 }, { raw: true });
    assert.equal(r.reason, 'read_failed'); assert.equal(r.text, ''); assert.deepEqual(logs, ['document_text_hwp_read_failed:stage=header'], 'S67-37: 실패 단계 코드만(글 내용 없음)');
    assert.ok(!d.calls.some(c => c.includes('/copy')), '깨진 HWP는 Drive 사본을 만들지 않는다'); }
  for (const lock of [{ password: true }, { distribution: true }]) {
    const d = drive(makeHwp({ sections: [['비밀']], ...lock })); const logs = [];
    const r = await dt.createDocumentText({ fetch: d.fetch, driveToken: async () => 't', log: c => logs.push(c) }).extract({ fileId: 'h', name: 'a.hwp', mime: '', size: 10 }, { raw: true });
    assert.equal(r.reason, 'locked'); assert.deepEqual(logs, ['document_text_hwp_locked']); }
  { const r = await dt.createDocumentText({ fetch: drive(makeHwp({ sections: [['  ', '']] })).fetch, driveToken: async () => 't' }).extract({ fileId: 'h', name: 'a.hwp', mime: '', size: 10 }, { raw: true });
    assert.equal(r.reason, 'empty'); }
  { const d = drive(SAMPLE_HWP);
    const r = await dt.createDocumentText({ fetch: d.fetch, driveToken: async () => 't' }).extract({ fileId: 'h', name: 'a.hwp', mime: '', size: 10 });
    assert.equal(r.source, 'content', '야간 채우기(drive-summary)도 자체 읽기로 읽는다'); assert.deepEqual(d.calls.map(c => c.split('?')[0]), ['GET /drive/v3/files/h']); }
});

test('HWPX 표본(실제 파일)에서 글자가 나오고, 브리핑 길(raw)은 긴 문서를 끝까지 읽는다', async () => {
  const d = drive(SAMPLE_HWPX);
  const r = await dt.createDocumentText({ fetch: d.fetch, driveToken: async () => 't' }).extract({ fileId: 'x', name: '시험.hwpx', mime: '', size: SAMPLE_HWPX.byteLength }, { raw: true });
  assert.equal(r.source, 'content'); assert.match(r.text, /HWP 편집기 시험 문서입니다/);
  assert.deepEqual(d.calls, ['GET /drive/v3/files/x?alt=media']);
  const long = zip(Array.from({ length: 6 }, (_, i) => [`Contents/section${i}.xml`, section([`${i + 1}장 시작`, '가'.repeat(9000)])]));
  assert.ok(!(await dt.hwpxText(long)).includes('6장 시작'), '자료실 저장 길은 앞부분만 읽고 멈춘다(지금까지와 같음)');
  const all = await dt.hwpxText(long, { all: true });
  assert.ok(all.includes('1장 시작') && all.includes('6장 시작'));
  const viaRaw = await dt.createDocumentText({ fetch: drive(long).fetch, driveToken: async () => 't' }).extract({ fileId: 'x', name: '긴.hwpx', mime: '', size: long.byteLength }, { raw: true });
  assert.ok(viaRaw.text.includes('6장 시작'));
});

// 브리핑 작업(brief-run.mjs)의 읽기 단계까지: HWP·HWPX 모두 'unsupported'로 끝나지 않고 조각 나누기 단계로 간다.
function fakeDb() {
  const rows = []; let n = 0;
  const match = (row, q) => q.every(([k, v]) => ['select', 'limit'].includes(k) || (v.startsWith('eq.') ? String(row[k]) === decodeURIComponent(v.slice(3)) : v.startsWith('in.(') ? v.slice(4, -1).split(',').includes(String(row[k])) : false));
  const db = async (path, opts = {}) => {
    const [, qs] = path.split('?'); const q = [...new URLSearchParams(qs)];
    const method = opts.method ?? 'GET';
    if (method === 'GET') return rows.filter(x => match(x, q)).slice(0, 1).map(x => ({ ...x }));
    if (method === 'POST') { const row = { id: `d0000000-0000-4000-8000-00000000000${++n}`, attempts: 0, parts: [], brief: null, source_text: null, lease_until: null, updated_at: new Date(0).toISOString(), ...opts.body }; rows.push(row); return [{ ...row }]; }
    if (method === 'PATCH') { const hit = rows.filter(x => match(x, q)); hit.forEach(x => Object.assign(x, structuredClone(opts.body))); return hit.map(x => ({ id: x.id })); }
    throw new Error(method);
  };
  return { db, rows };
}
const WS = 'a0000000-0000-4000-8000-000000000001', USER = 'b0000000-0000-4000-8000-000000000002';

for (const [label, file, media] of [
  ['HWP', { file_name: '261120 보도자료 국가철도공단.hwp', mime_type: 'application/x-hwp' }, makeHwp({ sections: [RELEASE.split('\n')] })],
  ['HWPX', { file_name: '261120 보도자료.hwpx', mime_type: '' }, zip([['Contents/section0.xml', section(RELEASE.split('\n'))]])],
]) {
  test(`브리핑: ${label} 자료가 글자 읽기 → 조각 나누기 단계로 간다(형식 아님으로 끝나지 않음)`, async () => {
    const f = fakeDb(); const d = drive(media); let t = 1_700_000_000_000; const stages = [];
    const reader = dt.createDocumentText({ fetch: d.fetch, driveToken: async () => 't' });
    const doc = { id: 'c0000000-0000-4000-8000-000000000003', workspace_id: WS, file_id: 'FILE_abcdefghij', file_size: media.byteLength, title: '보도자료', ...file };
    const runner = run.createBriefRunner({
      db: async (path, opts) => { if (opts?.method === 'PATCH' && opts.body?.stage) stages.push(opts.body.stage); return f.db(path, opts); },
      extract: x => reader.extract({ fileId: x.file_id, name: x.file_name, mime: x.mime_type, size: x.file_size }, { raw: true }),
      ai: async () => ({ ok: false, code: 'ai_not_configured' }), // AI 단계 앞까지만 본다
      capCheck: async () => ({ ok: true }), scope: async () => ({ orgs: [], areas: [] }), now: () => (t += 1000), budgetMs: 1e9,
    });
    const { row } = await runner.start({ userId: USER, doc });
    await runner.run(row.id, doc).catch(() => {});
    const saved = f.rows[0];
    assert.notEqual(saved.error_code, 'unsupported');
    assert.notEqual(saved.error_code, 'no_text');
    assert.ok(stages.includes('chunk'), `읽기 다음 단계(chunk)로 갔다: ${stages.join(',')}`);
    assert.ok(saved.step_total >= 1);
    assert.ok(!d.calls.some(c => c.includes('/copy')), 'Drive 사본 없이 읽었다');
  });
}

test('document-actions: HWP는 무거운 라이브러리(hwpxjs) 없이 공용 글자 읽기(자체 읽기)로 읽는다', () => {
  const src = readFileSync(new URL('../../supabase/functions/document-actions/index.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /import\('npm:@ssabrojs\/hwpxjs'\)|from 'npm:@ssabrojs/, 'S67-33: 메모리 한도로 죽던 hwpToText를 이 함수에서 쓰지 않는다');
  assert.match(src, /createDocumentText\(\{ driveToken: driveTokenFor\(userId, workspaceId\), fetch, log:/);
  // 공용 글자 읽기 파일은 외부 라이브러리를 직접 부르지 않는다(drive-summary가 같이 묶는다).
  for (const f of ['document-text.ts', 'hwp-text.mjs']) assert.doesNotMatch(readFileSync(new URL(`../../supabase/functions/_shared/${f}`, import.meta.url), 'utf8'), /hwpxjs['"]\)|from ['"]npm:/, f);
});

// S67-37: 운영(Supabase Edge)은 Deno다. Node는 압축 끝 꼬리를 조용히 넘겨 시험이 실패를 놓쳤다.
// Deno가 있는 CI(authz-security-check: setup-deno)에서는 같은 모듈을 Deno로 직접 돌려 본다. Deno가 없으면 건너뛴다.
test('S67-37 Deno: 한글 모양 HWP(섹션 끝 8바이트 꼬리)를 운영과 같은 런타임에서 읽는다', t => {
  const probe = spawnSync('deno', ['--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) { t.skip('deno 없음(로컬)'); return; }
  const dir = mkdtempSync(join(tmpdir(), 'hwp-deno-'));
  const file = join(dir, 'a.hwp');
  writeFileSync(file, makeHwp({ sections: [RELEASE.split('\n'), ['둘째 섹션']], binBytes: 600 * 1024, prvText: '미리보기 글' }));
  const mod = new URL('../../supabase/functions/_shared/hwp-text.mjs', import.meta.url).href;
  const script = `const M = await import(${JSON.stringify(mod)}); const b = new Uint8Array(await Deno.readFile(Deno.args[0]));
    const r = await M.hwpRead(b, { sliceIn: Infinity, sliceOut: Infinity }); console.log(JSON.stringify({ text: r.text, next: r.next, prv: M.hwpPreview(b) }));`;
  const out = spawnSync('deno', ['eval', '--ext=js', script, file], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  assert.equal(out.status, 0, out.stderr);
  const got = JSON.parse(out.stdout.trim().split('\n').pop());
  assert.equal(got.text, RELEASE + '\n둘째 섹션'); assert.equal(got.next, null); assert.equal(got.prv, '미리보기 글');
});

test('S67-37 document-text: 브리핑 길 첫 몫에서 본문을 못 읽으면 미리보기 글자(partial=preview), 자료실 저장 길은 그대로 read_failed', async () => {
  const prv = '보도자료 미리보기 '.repeat(40);
  const media = makeHwp({ sections: [RELEASE.split('\n')], brokenSection: true, prvText: prv });
  const logs = [];
  const reader = dt.createDocumentText({ fetch: drive(media).fetch, driveToken: async () => 't', log: c => logs.push(c) });
  const raw = await reader.extract({ fileId: 'h', name: 'a.hwp', mime: '', size: 10 }, { raw: true });
  assert.equal(raw.partial, 'preview'); assert.equal(raw.reason, 'ok'); assert.equal(raw.next, null); assert.equal(raw.text, prv.trim());
  assert.deepEqual(logs, ['document_text_hwp_read_failed:stage=section_inflate', 'document_text_hwp_preview_used']);
  // 나눠 읽는 중간 몫에서는 미리보기를 쓰지 않는다(앞 몫과 이어지지 않으므로)
  const mid = await reader.extract({ fileId: 'h', name: 'a.hwp', mime: '', size: 10 }, { raw: true, from: { sec: 0, para: 3 } });
  assert.equal(mid.reason, 'read_failed'); assert.equal(mid.partial, undefined);
  // 자료실 저장 길(raw 아님): 미리보기를 '끝까지 읽은 글자'로 저장하지 않는다
  const store = await reader.extract({ fileId: 'h', name: 'a.hwp', mime: '', size: 10 });
  assert.equal(store.reason, 'read_failed'); assert.equal(store.text, '');
  // 암호 문서는 미리보기도 쓰지 않는다
  const locked = await dt.createDocumentText({ fetch: drive(makeHwp({ sections: [['x']], password: true, prvText: prv })).fetch, driveToken: async () => 't' })
    .extract({ fileId: 'h', name: 'a.hwp', mime: '', size: 10 }, { raw: true });
  assert.equal(locked.reason, 'locked');
});
