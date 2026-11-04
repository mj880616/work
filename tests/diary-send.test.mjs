import { test } from 'node:test';
import assert from 'node:assert/strict';
// S48-56 노트·업데이트 → 일기로 보내기 / 사진 → 일기: diary-send.js (기존 일기 저장 길·노트 휴지통 길만 씀).
const mod = import('../app/diary-send.js');
function runtime(reply = () => []) {
  const calls = [];
  return {calls, context:{read:() => ({user:{id:'u'}, workspace:{id:'w'}})}, api:async (path, options = {}) => { calls.push({path, ...options}); return reply(path, options); }};
}
const photo = id => ({drive_file_id:id, file_name:id + '.jpg', mime_type:'image/jpeg', size_bytes:10});
const note = (extra = {}) => ({id:'n1', kind:'note', title:'회의 메모', raw_text:'본문 한 줄', attachments:[], occurred_at:'2026-10-31T16:30:00Z', updated_at:'2026-11-01T00:00:00Z', ...extra});

test('일기에 들어갈 글: 노트는 제목 + 본문(본문 첫 줄이 제목이면 한 번만), 업데이트는 본문 그대로', async () => {
  const m = await mod;
  assert.equal(m.diaryTextFrom(note()), '회의 메모\n본문 한 줄');
  assert.equal(m.diaryTextFrom(note({raw_text:'회의 메모\n둘째 줄'})), '회의 메모\n둘째 줄');
  assert.equal(m.diaryTextFrom(note({raw_text:''})), '회의 메모');
  assert.equal(m.diaryTextFrom({kind:'basket', raw_text:'\r\n업데이트 글\r\n'}), '업데이트 글');
  assert.equal(m.joinDiaryText('있던 글  ', '새 글'), '있던 글\n\n새 글');
  assert.equal(m.joinDiaryText(' ', '새 글'), '새 글', '사진만 든 날(빈칸 하나)은 글이 없는 것');
});

test('보낼 날 기본값 = 그 기록을 쓴 날(서울 날짜), 날짜를 못 읽으면 오늘', async () => {
  const m = await mod;
  assert.equal(m.recordDay(note()), '2026-11-01', 'UTC 10/31 16:30 = 서울 11/1 01:30');
  assert.equal(m.recordDay({}, '2026-11-03'), '2026-11-03');
  assert.equal(m.dayLabel('2026-11-01'), '11월 1일');
});

test('보내기 전에 막는 것: 사진이 아닌 첨부, 빈 기록, 하루 20장 넘김, 20,000자 넘김 — 아무것도 쓰기 전에', async () => {
  const m = await mod;
  assert.match(m.diarySendProblem(note({attachments:[photo('a'), {drive_file_id:'p', mime_type:'application/pdf'}]}), null), /다른 파일 1개/);
  assert.match(m.diarySendProblem(note({title:'', raw_text:''}), null), /글이나 사진이 없/);
  const many = Array.from({length:18}, (_, i) => photo('d' + i));
  assert.match(m.diarySendProblem(note({attachments:[photo('a'), photo('b'), photo('c')]}), {raw_text:'', attachments:many}), /20장까지.*18장/);
  assert.match(m.diarySendProblem(note({raw_text:'가'.repeat(15000)}), {raw_text:'나'.repeat(6000), attachments:[]}), /20,000자/);
  assert.equal(m.diarySendProblem(note({attachments:[photo('a')]}), null), '');
});

test('그날 일기가 없으면 새로 만들고, 다 들어간 뒤에만 원래 노트를 휴지통으로(알림 글 = M월 D일 일기로 보냈어요)', async () => {
  const m = await mod, trashed = [];
  let day = null;
  const rt = runtime((path, o) => {
    if (o.method === 'POST') { day = {id:'d1', journal_day:o.body.journal_day, raw_text:o.body.raw_text, attachments:[], updated_at:'t1'}; return [day]; }
    if (/kind=in\.\(note,basket\)/.test(path)) return [note()];
    if (/kind=eq\.diary/.test(path)) return day ? [day] : [];
    return [];
  });
  const result = await m.sendRecordToDiary('n1', {rt, trash:async (id, text) => { trashed.push([id, text]); return {status:'deleted'}; }});
  assert.deepEqual(result, {status:'sent', day:'2026-11-01', trash:'deleted'});
  const post = rt.calls.find(c => c.method === 'POST');
  assert.equal(post.path, '/rest/v1/app_notes');
  assert.deepEqual({kind:post.body.kind, day:post.body.journal_day, text:post.body.raw_text, ai:post.body.ai_export_allowed}, {kind:'diary', day:'2026-11-01', text:'회의 메모\n본문 한 줄', ai:false});
  assert.deepEqual(trashed, [['n1', '11월 1일 일기로 보냈어요']]);
  assert.ok(!rt.calls.some(c => c.method === 'DELETE'), '노트 지우기는 기존 휴지통 길(trash)로만');
});

test('그날 일기가 있으면 그 글 끝에 빈 줄 하나 두고 붙인다(그 일기 판이 그대로일 때만 쓰는 PATCH), 고른 날로', async () => {
  const m = await mod;
  let day = {id:'d9', journal_day:'2026-11-02', raw_text:'아침에 쓴 일기', doc:null, attachments:[], updated_at:'2026-11-02T01:00:00Z'};
  const rt = runtime((path, o) => {
    if (o.method === 'PATCH') { day = {...day, ...o.body}; return [day]; }
    if (/kind=in\.\(note,basket\)/.test(path)) return [{...note(), kind:'basket', title:null, raw_text:'정리함 업데이트'}];
    if (/kind=eq\.diary/.test(path)) return [day];
    return [];
  });
  const result = await m.sendRecordToDiary('n1', {rt, day:'2026-11-02', trash:async () => ({status:'deleted'})});
  assert.equal(result.status, 'sent'); assert.equal(result.day, '2026-11-02');
  const patch = rt.calls.find(c => c.method === 'PATCH');
  assert.equal(patch.body.raw_text, '아침에 쓴 일기\n\n정리함 업데이트');
  assert.match(patch.path, /kind=eq\.diary&id=eq\.d9&updated_at=eq\.2026-11-02T01%3A00%3A00Z$/);
  assert.equal(patch.body.doc?.doc?.type, 'doc', '서식(doc)도 같은 글로 함께 써서 글과 서식이 어긋나지 않게');
  assert.ok(!rt.calls.some(c => c.method === 'POST'));
});

test('막히면 아무것도 쓰지 않고, 일기 저장이 실패하면 원래 노트를 지우지 않는다', async () => {
  const m = await mod;
  let trashed = 0;
  const blocked = runtime(path => /kind=in/.test(path) ? [note({attachments:[{drive_file_id:'x', mime_type:'application/pdf'}]})] : []);
  const r1 = await m.sendRecordToDiary('n1', {rt:blocked, trash:async () => { trashed++; return {status:'deleted'}; }});
  assert.equal(r1.status, 'blocked'); assert.ok(!blocked.calls.some(c => c.method)); assert.equal(trashed, 0);
  const failing = runtime((path, o) => { if (o.method === 'POST') throw Object.assign(new Error('저장 실패'), {status:503}); return /kind=in/.test(path) ? [note()] : []; });
  const r2 = await m.sendRecordToDiary('n1', {rt:failing, trash:async () => { trashed++; return {status:'deleted'}; }});
  assert.equal(r2.status, 'partial'); assert.match(r2.message, /원래 기록은 그대로/); assert.equal(trashed, 0);
  const missing = runtime(() => []);
  assert.equal((await m.sendRecordToDiary('n1', {rt:missing})).status, 'missing');
});

test('읽기는 이 업무 공간의 노트·업데이트만(일기·업무일지 행은 보내기 대상 아님)', async () => {
  const m = await mod, rt = runtime(() => []);
  await m.readSendRecord('n1', rt);
  const q = new URL(rt.calls[0].path, 'https://x.invalid').searchParams;
  assert.equal(q.get('workspace_id'), 'eq.w'); assert.equal(q.get('kind'), 'in.(note,basket)'); assert.equal(q.get('id'), 'eq.n1');
});

test('사진 화면 [일기로]: 찍은 날별로 묶고(날짜 없으면 오늘) 날짜 순', async () => {
  const m = await mod;
  const groups = m.diaryDayGroups([{id:'a', day:'2026-11-02'}, {id:'b', day:'2026-11-01'}, {id:'c', day:''}, {id:'d', day:'2026-11-02'}], '2026-11-03');
  assert.deepEqual(groups.map(g => [g.day, g.items.map(x => x.id)]), [['2026-11-01', ['b']], ['2026-11-02', ['a', 'd']], ['2026-11-03', ['c']]]);
});

test('같은 부품만 씀: 새 저장 경로·기기 저장 없음, 메뉴 세 곳이 같은 함수', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../app/diary-send.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, new RegExp(['local', 'session'].map(x => x + 'Storage').concat('indexed' + 'DB').join('|')), '기기 저장 없음');
  assert.doesNotMatch(src, /functions\/v1\//, 'Edge 주소를 직접 부르지 않고 일기·노트의 기존 부품을 부른다');
  const notes = fs.readFileSync(new URL('../app/basket-notes.js', import.meta.url), 'utf8');
  const basket = fs.readFileSync(new URL('../app/basket.js', import.meta.url), 'utf8');
  const photos = fs.readFileSync(new URL('../app/photos.js', import.meta.url), 'utf8');
  assert.match(notes, /askSendToDiary/); assert.match(basket, /askSendToDiary/); assert.match(photos, /putPhotosInDiary/);
});
