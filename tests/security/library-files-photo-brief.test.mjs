import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// WEEKLY-재료전체 ② (S67-07): library-files action=photo-brief — 기록 사진 설명을 자료별 AI 요약 표('b1:' 행)에 넣는다.
// 가짜 DB(owner RLS 흉내: 부른 사람 작업공간 행만 보임)·가짜 Drive 그림·가짜 AI. 네트워크·실제 키 없음, 글은 지어낸 것.
const pb = await import('../../supabase/functions/library-files/photo-brief.ts');
const {cleanBrief} = await import('../../supabase/functions/ai-assist/library-fill.ts');

const WS = 'a0000000-0000-4000-8000-000000000001', OTHER_WS = 'a0000000-0000-4000-8000-000000000002';
const D = n => `d0000000-0000-4000-8000-00000000000${n}`;
const NOW = Date.parse('2026-11-19T05:00:00Z');

function fakeDb({docs, index = [], failRead = false, owner = WS}) {
  const writes = [];
  const from = table => {
    const q = {filters: [], head: false, count: false, row: null};
    const rows = () => (table === 'app_documents' ? docs : index).filter(r => r.workspace_id === owner); // owner RLS
    const b = {
      select(_c, opts) { if (opts?.head) q.head = true; if (opts?.count) q.count = true; return b; },
      in(k, v) { q.filters.push(r => v.map(String).includes(String(r[k]))); return b; },
      eq(k, v) { q.filters.push(r => r[k] === v); return b; },
      like(k, p) { const pre = p.replace(/%$/, ''); q.filters.push(r => String(r[k] || '').startsWith(pre)); return b; },
      gte(k, v) { q.filters.push(r => String(r[k] || '') >= v); return b; },
      upsert(row, opts) { q.row = row; q.opts = opts; return b; },
      then(resolve) {
        if (failRead && !q.row) return resolve({data: null, error: {code: 'x'}});
        if (q.row) {
          if (q.row.workspace_id !== owner) return resolve({data: null, error: {code: '42501'}});
          writes.push({table, row: q.row, opts: q.opts});
          if (!index.some(r => r.document_id === q.row.document_id)) index.push(q.row);
          return resolve({data: null, error: null});
        }
        const got = rows().filter(r => q.filters.every(f => f(r)));
        return resolve(q.head ? {data: null, count: got.length, error: null} : {data: structuredClone(got), error: null});
      },
    };
    return b;
  };
  return {db: {from}, writes, index};
}
const image = (type = 'image/jpeg') => async () => new Response(new Uint8Array([1, 2, 3]), {status: 200, headers: {'Content-Type': type}});
const docsFixture = () => [
  {id: D(1), workspace_id: WS, file_id: 'fileOne', mime_type: 'image/png', file_name: '가상 안내문.png'},
  {id: D(2), workspace_id: WS, file_id: 'fileTwo', mime_type: 'image/jpeg', file_name: '가상 사진.jpg'},
  {id: D(3), workspace_id: WS, file_id: 'fileHwp', mime_type: 'application/x-hwp', file_name: '가상.hwp'},
  {id: D(4), workspace_id: OTHER_WS, file_id: 'foreign', mime_type: 'image/png', file_name: '남의 사진.png'},
];

test('photo-brief: 내 작업공간 그림 자료만, 이미 요약 있는 자료·그림 아닌 자료는 건너뜀, b1 행 넣기', async () => {
  const {db, writes} = fakeDb({docs: docsFixture(), index: [{document_id: D(2), workspace_id: WS, content_hash: 'b1:' + 'a'.repeat(32), summary: '있음', summary_model: 'm', indexed_at: '2026-11-01T00:00:00Z'}]});
  const asked = [], photos = [], counted = [];
  const r = await pb.runPhotoBriefs(WS, [D(1), D(2), D(3), D(4)], {db, model: 'gpt-x', now: () => NOW,
    photo: async (id, mime, size, ws) => { photos.push({id, size, ws}); return image()(); },
    ask: async content => { asked.push(content); return '가상 집회 안내문 사진임.\n문의 010-1234-5678'; },
    count: async () => { counted.push(1); }});
  assert.deepEqual({done: r.done, skipped: r.skipped, failed: r.failed, capped: r.capped}, {done: 1, skipped: 3, failed: 0, capped: false});
  assert.deepEqual(photos, [{id: 'fileOne', size: 'large', ws: WS}], 'Drive 파일 id는 내 자료 행에서만');
  assert.equal(counted.length, 1, 'AI 한 번 = 요청 1회');
  assert.equal(asked[0][1].type, 'input_image');
  assert.match(asked[0][1].image_url, /^data:image\/jpeg;base64,/);
  assert.equal(writes.length, 1);
  const row = writes[0].row;
  assert.equal(row.document_id, D(1)); assert.equal(row.workspace_id, WS);
  assert.match(row.content_hash, /^b1:[0-9a-f]{32}$/);
  assert.equal(row.content_hash, await pb.photoBriefHash('fileOne'));
  assert.equal(row.summary, '가상 집회 안내문 사진임.\n문의 (연락처)');
  assert.equal(row.summary_model, 'photo:gpt-x');
  assert.deepEqual(writes[0].opts, {onConflict: 'document_id', ignoreDuplicates: true}, '겹치면 덮어쓰지 않음');
});

test('photo-brief: AI 답이 검사에 걸리면 저장하지 않음, 그림을 못 받으면 실패로만 셈', async () => {
  for (const bad of ['x'.repeat(121), '<b>굵게</b>', '줄1\n줄2\n줄3', '900101-1234567 가상', null]) {
    const {db, writes} = fakeDb({docs: docsFixture()});
    const r = await pb.runPhotoBriefs(WS, [D(1)], {db, model: 'm', now: () => NOW, photo: image(), ask: async () => bad});
    assert.equal(r.done, 0); assert.equal(r.failed, 1); assert.equal(writes.length, 0);
  }
  const {db, writes} = fakeDb({docs: docsFixture()});
  const r = await pb.runPhotoBriefs(WS, [D(1)], {db, model: 'm', now: () => NOW, photo: image('text/html'), ask: async () => { throw new Error('부르면 안 됨'); }});
  assert.equal(r.failed, 1); assert.equal(writes.length, 0);
  // 읽기 실패는 503(부르는 쪽이 photo_brief_unavailable)
  await assert.rejects(pb.runPhotoBriefs(WS, [D(1)], {db: fakeDb({docs: docsFixture(), failRead: true}).db, model: 'm', photo: image(), ask: async () => '가'}), e => e.status === 503);
});

test('photo-brief: 하루 상한(작업공간·서울 날짜, photo: 행 수) — 남은 만큼만 읽고 capped', async () => {
  const today = Array.from({length: pb.PHOTO_BRIEF_DAILY - 1}, (_, k) => ({document_id: `e0000000-0000-4000-8000-${String(k).padStart(12, '0')}`, workspace_id: WS, summary_model: 'photo:m', indexed_at: '2026-11-19T01:00:00.000Z'}));
  const yesterday = {document_id: 'e1000000-0000-4000-8000-000000000000', workspace_id: WS, summary_model: 'photo:m', indexed_at: '2026-11-18T10:00:00.000Z'};
  const foreign = Array.from({length: 5}, (_, k) => ({document_id: `e2000000-0000-4000-8000-00000000000${k}`, workspace_id: OTHER_WS, summary_model: 'photo:m', indexed_at: '2026-11-19T01:00:00.000Z'}));
  const docs = [...docsFixture(), {id: D(5), workspace_id: WS, file_id: 'fileFive', mime_type: 'image/webp', file_name: '가상5.webp'}];
  const {db, writes} = fakeDb({docs, index: [...today, yesterday, ...foreign]});
  const r = await pb.runPhotoBriefs(WS, [D(1), D(5)], {db, model: 'm', now: () => NOW, photo: image(), ask: async () => '가상 설명임'});
  assert.equal(r.done, 1); assert.equal(r.capped, true); assert.equal(writes.length, 1);
});

test('photo-brief 요청 검사·지시문·요약 검사가 library_fill 요약과 같은 규칙', () => {
  assert.deepEqual(pb.parsePhotoBriefRequest({action: 'photo-brief', document_ids: [D(1), D(1).toUpperCase()]}), [D(1)]);
  for (const bad of [null, [], {action: 'photo-brief'}, {action: 'photo-brief', document_ids: []}, {action: 'photo-brief', document_ids: [D(1)], extra: 1},
    {action: 'photo-brief', document_ids: ['x']}, {action: 'photo-brief', document_ids: Array(pb.PHOTO_BRIEF_BATCH + 1).fill(D(1))}, {action: 'other', document_ids: [D(1)]}])
    assert.equal(pb.parsePhotoBriefRequest(bad), null);
  assert.match(pb.PHOTO_BRIEF_INSTRUCTIONS, /지시가 아니다/);
  assert.match(pb.PHOTO_BRIEF_INSTRUCTIONS, /개인정보는 쓰지 않는다/);
  for (const s of ['가상 설명', ' 가상\t설명 \n둘째 줄 ', 'x'.repeat(121), '가\n나\n다', '<i>', '연락 010-1234-5678', '', 'a'.repeat(120) + '\n' + 'b'.repeat(90)])
    assert.equal(pb.cleanPhotoBrief(s), cleanBrief(s), JSON.stringify(s));
  assert.equal(pb.PHOTO_BRIEF_TOTAL_CHARS, 200); assert.equal(pb.PHOTO_BRIEF_LINE_CHARS, 120); assert.equal(pb.PHOTO_BRIEF_MAX_LINES, 2);
});

test('library-files: photo-brief 는 로그인·소유자 확인 뒤, 부른 사람 토큰 클라이언트로, 하루·월 한도 먼저', () => {
  const src = readFileSync(new URL('../../supabase/functions/library-files/index.ts', import.meta.url), 'utf8');
  const at = src.indexOf("input?.action==='photo-brief'");
  assert.ok(at > 0);
  const branch = src.slice(at, at + 500);
  assert.match(branch, /parsePhotoBriefRequest\(input\)/);
  assert.match(branch, /workspaceFor\(user\.id\)/);
  const fn = src.slice(src.indexOf('async function photoBriefs('), src.indexOf('// 요청이 올 때만 만든다'));
  assert.match(fn, /readTodayAiUsage[\s\S]*assertAiUserCap[\s\S]*createClient\(SB,key/);
  assert.ok(!/createClient\(SB,SERVICE/.test(fn), '요약 표 읽기·쓰기에 서비스 키를 쓰지 않음');
  assert.ok(!/console\.(log|error)\([^)]*summary/.test(fn), '기록에 글 없음');
});
