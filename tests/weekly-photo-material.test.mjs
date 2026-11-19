import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {attachmentLines, docsByFile, withFiles, photoBriefTargets, FILE_LINES_MAX} from '../app/weekly-photo-material.mjs';
import {requestPhotoBriefs, PHOTO_BRIEF_BATCH} from '../app/photo-brief-request.js';

// WEEKLY-재료전체 ② (S67-07): 기록에 붙은 사진·파일 → 주간보고 AI 재료 본문 끝 '사진: 이름 — 설명'. 글은 모두 지어낸 것.
const HASH = 'b1:' + '0'.repeat(32);
const ocrDone = (id, text) => ({state: 'done', attempt_id: '22222222-2222-4222-8222-222222222222', original_file_id: id, cleanup_state: 'deleted', temp_document_id: 'temp_' + id, text});
const memo = {id: 'n1', occurred_at: '2026-11-17T01:00:00Z', raw_text: '', attachments: [
  {drive_file_id: 'pic1', file_name: '가상 명령 4호.png', mime_type: 'image/png', size_bytes: 10},
  {drive_file_id: 'pic2', file_name: '가상 현수막.jpg', mime_type: 'image/jpeg', size_bytes: 10, ocr: ocrDone('pic2', '가상 요구 하나\n가상 요구 둘')},
  {drive_file_id: 'pic3', file_name: '가상 현장.jpg', mime_type: 'image/jpeg', size_bytes: 10},
  {drive_file_id: 'doc1', file_name: '가상 공문.hwp', mime_type: 'application/x-hwp', size_bytes: 10},
]};
const docs = [
  {id: 'a0000000-0000-4000-8000-000000000001', file_id: 'pic1', file_name: '가상 명령 4호.png', mime_type: 'image/png', created_at: '2026-11-17T01:00:01Z', brief: {summary: '가상 파업 지침 안내문 사진임', hash: HASH}},
  {id: 'a0000000-0000-4000-8000-000000000003', file_id: 'pic3', file_name: '가상 현장.jpg', mime_type: 'image/jpeg', created_at: '2026-11-17T01:00:03Z'},
  {id: 'a0000000-0000-4000-8000-000000000004', file_id: 'doc1', file_name: '가상 공문.hwp', mime_type: 'application/x-hwp', created_at: '2026-11-17T01:00:04Z', brief: {summary: '가상 공문 요약', hash: HASH}},
  {id: 'a0000000-0000-4000-8000-000000000005', file_id: 'loose', file_name: '기록에 안 붙은 사진.png', mime_type: 'image/png', created_at: '2026-11-17T02:00:00Z'},
];

test('첨부 줄: AI 사진 설명 → 사진 속 글자 → 파일 이름 순, 파일은 자료 요약', () => {
  assert.deepEqual(attachmentLines(memo, docsByFile(docs)), [
    '사진: 가상 명령 4호.png — 가상 파업 지침 안내문 사진임',
    '사진: 가상 현수막.jpg — 가상 요구 하나 가상 요구 둘',
    '사진: 가상 현장.jpg',
    '파일: 가상 공문.hwp — 가상 공문 요약',
  ]);
  assert.deepEqual(attachmentLines({attachments: []}), []);
  assert.deepEqual(attachmentLines({}), []);
  // 모양이 틀린 ocr 칸은 읽지 않고(던지지 않음) 이름만
  assert.deepEqual(attachmentLines({attachments: [{drive_file_id: 'x', file_name: 'x.png', mime_type: 'image/png', ocr: {state: 'weird'}}]}), ['사진: x.png']);
  assert.equal(attachmentLines({attachments: Array.from({length: 15}, (_, i) => ({drive_file_id: `f${i}`, file_name: `${i}.png`, mime_type: 'image/png'}))}).length, FILE_LINES_MAX);
  assert.equal(withFiles('', ['사진: a']), '사진: a');
  assert.equal(withFiles('본문', ['사진: a']), '본문\n사진: a');
  assert.equal(withFiles('', []), '');
});

test('다시 읽을 사진: 기록에 붙은 사진 자료 중 설명 없는 것만, 최근 것부터', () => {
  assert.deepEqual(photoBriefTargets([memo], docs), ['a0000000-0000-4000-8000-000000000003']);
  assert.deepEqual(photoBriefTargets([], docs), []);
  const many = Array.from({length: 6}, (_, i) => ({id: `b0000000-0000-4000-8000-00000000000${i}`, file_id: `p${i}`, file_name: `${i}.png`, mime_type: 'image/png', created_at: `2026-11-17T0${i}:00:00Z`}));
  const m2 = {attachments: many.map(d => ({drive_file_id: d.file_id, file_name: d.file_name, mime_type: 'image/png'}))};
  assert.deepEqual(photoBriefTargets([m2], many, 4), ['5', '4', '3', '2'].map(i => `b0000000-0000-4000-8000-00000000000${i}`));
});

test('주간 정리 모델: 사진 기록의 화면 줄은 그대로, AI 재료 body 에 사진 줄', async () => {
  const w = await import('../app/journal-weekly.js');
  const basket = {notes: [{...memo, raw_text: '', occurred_at: '2026-11-17T01:00:00Z'}],
    links: [{id: 'L1', note_id: 'n1', status: 'confirmed', organization_id: 'o1', organization: {name: '가 조직'}, summary: '그림 3장 · 파일 1개 · 가상 명령 4호.png 외 3'}], docs: []};
  const model = w.weeklySummary({start: '2026-11-16', lines: new Map(), materials: {catalog: {status: 'ok', items: []}, upcoming: {status: 'ok', items: []},
    basket: {status: 'ok', items: basket}, orgUpdates: {status: 'ok', items: []}, documents: {status: 'ok', items: docs}}});
  const items = model.orgs.sections.flatMap(s => s.items).filter(i => !i.file);
  const rec = items.find(i => i.text.startsWith('그림 3장'));
  assert.ok(rec, JSON.stringify(items));
  assert.equal(rec.text, '그림 3장 · 파일 1개 · 가상 명령 4호.png 외 3');
  assert.match(rec.body, /^사진: 가상 명령 4호\.png — 가상 파업 지침 안내문 사진임\n사진: 가상 현수막\.jpg — /);
});

test('사진 다시 읽기 요청: 로그인 토큰으로 library-files 에, 숫자만 받음, 실패는 0', async () => {
  const calls = [];
  const rt = {config: {url: 'https://synthetic.test', key: 'anon'}, session: {ensure: async () => true, read: () => ({access_token: 'tok'})}};
  const fetcher = async (url, opts) => { calls.push({url, opts}); return new Response(JSON.stringify({ok: true, done: 2, summary: '보내면 안 됨'}), {status: 200}); };
  const ids = Array.from({length: 6}, (_, i) => `c0000000-0000-4000-8000-00000000000${i}`);
  assert.deepEqual(await requestPhotoBriefs([...ids, 'bad'], rt, {fetcher}), {done: 2});
  assert.equal(calls[0].url, 'https://synthetic.test/functions/v1/library-files');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(calls[0].opts.body), {action: 'photo-brief', document_ids: ids.slice(0, PHOTO_BRIEF_BATCH)});
  assert.deepEqual(await requestPhotoBriefs([], rt, {fetcher}), {done: 0});
  assert.deepEqual(await requestPhotoBriefs(ids, rt, {fetcher: async () => new Response('{}', {status: 503})}), {done: 0});
  assert.deepEqual(await requestPhotoBriefs(ids, rt, {fetcher: async () => { throw new Error('x'); }}), {done: 0});
  assert.deepEqual(await requestPhotoBriefs(ids, {...rt, session: {ensure: async () => false}}, {fetcher}), {done: 0});
});

test('화면: [주간 정리]가 그 주에 한 번 묻고, 채워지면 자료만 조용히 다시 읽는다', () => {
  const src = readFileSync(new URL('../app/journal.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('async function maybePhotoBriefs'), src.indexOf('async function maybePhotoBriefs') + 900);
  assert.match(fn, /mode !== 'week'/);
  assert.match(fn, /photoAsked\.has\(key\)/);
  assert.match(fn, /loadGroup\('documents', run, scope, true\)/);
});
