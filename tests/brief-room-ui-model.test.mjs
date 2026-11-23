// BRIEF-브리핑룸 ③: app/brief-room-model.mjs(화면 모델). DOM·네트워크 없음, 예시 자료만.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../app/brief-room-model.mjs';

test('rowState: start / making n/m / one-line lead / failed lines', () => {
  assert.equal(m.rowState(null).kind, 'start');
  assert.deepEqual(m.rowState({ status: 'running', step_no: 7, step_total: 12 }), { kind: 'making', text: '만드는 중 7/12', date: '' });
  const done = m.rowState({ status: 'done', brief: { lead: '인건비 배점이 늘어남.' }, finished_at: '2026-11-12T03:00:00Z' });
  assert.equal(done.text, '인건비 배점이 늘어남.');
  // S68-44: 다 된 줄 날짜는 진행 칸 수('만드는 중 17/22')와 헷갈리지 않게 노트 목록과 같은 '11.12'(다른 해 '25.11.12'), 'M/D' 아님.
  const now = new Date('2026-11-23T03:00:00Z');
  assert.equal(m.rowState({ status: 'done', brief: { lead: 'x' }, finished_at: '2026-11-12T03:00:00Z' }, now).date, '11.12');
  assert.equal(m.rowState({ status: 'done', brief: { lead: 'x' }, finished_at: '2026-11-19T16:00:00Z' }, now).date, '11.20'); // 한국 시각
  assert.equal(m.rowState({ status: 'done', brief: { lead: 'x' }, finished_at: '2025-03-02T01:00:00Z' }, now).date, '25.03.02');
  assert.equal(m.doneDate('', now), '');
  assert.doesNotMatch(done.date, /\//);
  assert.equal(m.rowState({ status: 'failed', error_code: 'no_text' }).text, '글자를 읽을 수 없는 파일이에요');
  assert.equal(m.rowState({ status: 'failed', error_code: 'weird' }).text, '브리핑을 만들지 못했어요');
});

test('listRows: folder docs and briefed docs only, newest first', () => {
  const docs = [{ id: 'a', created_at: '2026-11-10T00:00:00Z' }, { id: 'b', created_at: '2026-11-11T00:00:00Z' }, { id: 'c', created_at: '2026-11-12T00:00:00Z' }];
  const briefs = m.latestByDocument([{ document_id: 'c', status: 'done', brief: { lead: 'x' }, created_at: '2026-11-13T00:00:00Z' }, { document_id: 'c', status: 'failed', created_at: '2026-11-01T00:00:00Z' }]);
  const rows = m.listRows({ docs, folderIds: new Set(['a']), briefs });
  assert.deepEqual(rows.map(r => r.doc.id), ['c', 'a']);
  assert.equal(rows[0].state.kind, 'done');
});

// S68-45: 옛 형식(v1) 브리핑은 읽을 때 새 칸으로 옮겨 보인다(저장 행은 그대로). 빈 칸은 그리지 않는다.
// S68-55(명진 11/23 "주체가 국토교통부 철도국장인데 내가 챙길 일로 나옴"): 옛 형식은 주체를 모르니 할 일을 '내 챙길 일'로 옮기지 않는다.
test('briefView 옛 형식(v1): 한 줄 요지가 한눈에, touches→우리 조직 관련, todos→약속·계획(주체 불명), conflicts→대응할 것, 내 챙길 일 없음', () => {
  const v = m.briefView({ v: 1, lead: 'x', touches: ['가', 3], todos: [], conflicts: ['나'], quotes: [{ text: '원문', page: 12, heading: '3.', why: '왜' }, { text: '' }, { text: '쪽 모름', page: 0 }] });
  assert.equal(v.legacy, true);
  assert.deepEqual(v.glance, [{ who: '', text: 'x' }]);
  assert.deepEqual(v.sections.map(x => x.key), ['orgs', 'counters', 'quotes']);
  assert.deepEqual(v.sections[0].items, [{ name: '', who: '', text: '가' }]);
  assert.deepEqual(v.sections[1].items, [{ who: '', claim: '나', reply: '' }]);
  assert.equal(v.sections[2].items.length, 2); assert.equal(v.sections[2].items[1].page, null); assert.equal(v.sections[2].items[0].who, '');
  const old = m.briefView({ lead: 'y', todos: ['의견 제출 11/28까지'] });
  assert.equal(old.legacy, true);
  assert.deepEqual(old.sections.map(x => [x.key, x.title]), [['promises', '약속·계획(주체 불명)']]);
  assert.deepEqual(old.sections[0].items, [{ who: '', due: '', text: '의견 제출 11/28까지' }]);
  assert.ok(!old.sections.some(x => x.key === 'todos'), '옛 할 일은 내 챙길 일로 가지 않음');
});

test('briefView 옛 형식(v2, 주체 없음): 기한 있는 할 일도 약속·계획(주체 불명)으로, 순서는 서버 그대로', () => {
  const v = m.briefView({
    v: 2, lead: '요지', glance: ['하나', '둘', '셋', '넷'],
    todos: [{ due: '', text: '기한 없음' }, { due: '연내', text: '운영기준에 인력 의무 반영' }, { text: '' }, null],
    orgs: [{ name: '예시 가지부', text: '대상' }, { name: 'x', text: '' }],
    counters: [{ claim: '저쪽 주장', reply: '반박' }, { claim: '', reply: '빈' }],
    quotes: [],
  });
  assert.equal(v.legacy, true);
  assert.deepEqual(v.glance.map(g => g.text), ['하나', '둘', '셋']);
  assert.deepEqual(v.sections.map(s => [s.key, s.title]), [['promises', '약속·계획(주체 불명)'], ['orgs', '우리 조직 관련'], ['counters', '대응할 것']]);
  assert.deepEqual(v.sections[0].items, [{ who: '', due: '', text: '기한 없음' }, { who: '', due: '연내', text: '운영기준에 인력 의무 반영' }]);
  assert.deepEqual(v.sections[1].items, [{ name: '예시 가지부', who: '', text: '대상' }]);
  assert.deepEqual(m.briefView({ v: 2, lead: '요지', glance: [] }).glance, [{ who: '', text: '요지' }]);
});

test('briefView 새 형식(v3): 한눈에 누가 무엇, 내 챙길 일(기한 정렬)·약속·계획(서버 순서)·주체 꼬리표, 잘못된 줄은 뺌', () => {
  const now = new Date('2026-11-23T03:00:00Z');
  const v = m.briefView({
    v: 3, lead: '요지',
    glance: [{ subject: '○○부 국장', text: '하나' }, { subject: '주체 불명', text: '둘' }, { subject: '우리 조직', text: '셋' }, { subject: 'x', text: '넷' }],
    todos: [{ subject: '우리 조직', due: '', text: '기한 없음' }, { subject: '나', due: '연내', text: '연내 할 일' }, { subject: '나', due: '11/25', text: '곧' }, { text: '' }, null],
    promises: [{ subject: '○○부', speaker: '○○부 국장', due: '연내', text: '운영기준에 인력 의무 반영' }, { subject: '주체 불명', speaker: '', due: '', text: '누가인지 모름' }, { text: '' }],
    orgs: [{ name: '예시 가지부', subject: '○○공단', speaker: '', text: '대상' }],
    counters: [{ subject: '○○ 의원', speaker: '○○ 의원', claim: '저쪽 주장', reply: '반박' }],
    quotes: [{ text: '원문', page: 3, speaker: '○○부 국장' }, { text: '발언자 모름', speaker: '' }],
  }, now);
  assert.equal(v.legacy, false);
  assert.deepEqual(v.glance, [{ who: '○○부 국장', text: '하나' }, { who: '주체 불명', text: '둘' }, { who: '우리 조직', text: '셋' }]);
  assert.deepEqual(v.sections.map(s => [s.key, s.title]), [['todos', '내 챙길 일'], ['promises', '약속·계획'], ['orgs', '우리 조직 관련'], ['counters', '대응할 것'], ['quotes', '원문 인용']]);
  assert.deepEqual(v.sections[0].items.map(t => [t.text, t.who, t.urgent]), [['곧', '나', true], ['연내 할 일', '나', false], ['기한 없음', '우리 조직', false]]);
  assert.deepEqual(v.sections[1].items, [{ who: '○○부 국장', due: '연내', text: '운영기준에 인력 의무 반영' }, { who: '주체 불명', due: '', text: '누가인지 모름' }]);
  assert.deepEqual(v.sections[2].items, [{ name: '예시 가지부', who: '○○공단', text: '대상' }]);
  assert.deepEqual(v.sections[3].items, [{ who: '○○ 의원', claim: '저쪽 주장', reply: '반박' }]);
  assert.deepEqual(v.sections[4].items.map(q => q.who), ['○○부 국장', '주체 불명']);
  assert.equal(m.whoTag('○○부', '철도국장'), '○○부 철도국장');
  assert.equal(m.whoTag('', ''), '주체 불명');
  assert.equal(m.whoTag('주체 불명', '○○ 의원'), '○○ 의원');
});

test('dueUrgent·sortTodos·splitShown·moreLabel', () => {
  const now = new Date('2026-11-23T03:00:00Z');
  assert.equal(m.dueUrgent('11/28', false, now), true);
  assert.equal(m.dueUrgent('11월 30일', false, now), true);
  assert.equal(m.dueUrgent('12/15', false, now), false);
  assert.equal(m.dueUrgent('2026-11-20', false, now), true, '지난 날짜도 급함');
  assert.equal(m.dueUrgent('연내', false, now), false);
  assert.equal(m.dueUrgent('종합감사 전', true, now), true, '서버가 급하다고 하면 그대로');
  assert.equal(m.dueUrgent('', false, now), false);
  assert.equal(m.dueUrgent('1/5', false, new Date('2026-12-30T03:00:00Z')), true, '해 넘김');
  assert.equal(m.dueUrgent('1/5', false, new Date('2026-11-23T03:00:00Z')), false);
  const sorted = m.sortTodos([{ due: '', text: 'a' }, { due: '연내', text: 'b' }, { due: '', text: 'c', urgent: true }], now);
  assert.deepEqual(sorted.map(t => t.text), ['c', 'b', 'a']);
  assert.deepEqual(m.splitShown([1, 2, 3, 4, 5]), { shown: [1, 2, 3], rest: [4, 5] });
  assert.deepEqual(m.splitShown([1, 2]), { shown: [1, 2], rest: [] });
  assert.equal(m.moreLabel(2), '+ 2개 더 보기');
});

test('fileBadge / sourceUrl / isStalled', () => {
  assert.equal(m.fileBadge('a.hwpx'), 'HWP'); assert.equal(m.fileBadge('b.PDF'), 'PDF'); assert.equal(m.fileBadge('c.docx'), 'DOC');
  assert.equal(m.sourceUrl({ file_id: 'FILE_abcdefghij', file_name: 'x.pdf' }, 31), 'https://drive.google.com/file/d/FILE_abcdefghij/view#page=31');
  assert.equal(m.sourceUrl({ file_id: 'FILE_abcdefghij', file_name: 'x.hwp' }, 31), 'https://drive.google.com/file/d/FILE_abcdefghij/view');
  assert.equal(m.sourceUrl({ file_id: 'bad id', drive_url: 'https://evil.example/' }), '');
  const now = Date.parse('2026-11-13T10:00:00Z');
  assert.equal(m.isStalled({ status: 'queued', lease_until: null, updated_at: '2026-11-13T09:59:00Z' }, now), true);
  assert.equal(m.isStalled({ status: 'running', lease_until: '2026-11-13T10:02:00Z', updated_at: '2026-11-13T09:59:00Z' }, now), false);
});

// BRIEF-브리핑룸삭제(S63-08): 두 가지 삭제 이름·확인 글·결과 글.
test('delete kinds: brief only / with document, confirm and result lines', () => {
  assert.deepEqual({ ...m.DELETE_KINDS }, { brief: '브리핑만 삭제', doc: '자료까지 삭제' });
  assert.equal(m.deleteConfirm('brief', 1, '예시 자료').text, '“예시 자료” 브리핑만 삭제할까요?');
  assert.match(m.deleteConfirm('brief', 1, '예시 자료').note, /자료실에 그대로/);
  assert.equal(m.deleteConfirm('doc', 3).text, '3개 자료까지 삭제할까요?');
  assert.match(m.deleteConfirm('doc', 3).note, /휴지통/);
  assert.equal(m.deleteConfirm('doc', 1).ok, '삭제');
  assert.deepEqual(m.deleteResult('brief', { done: 1 }), { text: '브리핑을 삭제했어요', error: false });
  assert.deepEqual(m.deleteResult('doc', { done: 2 }), { text: '2개 자료를 삭제했어요', error: false });
  assert.deepEqual(m.deleteResult('doc', { done: 1, failed: 1 }), { text: '1개는 삭제했고 1개는 삭제하지 못했어요', error: true });
  assert.deepEqual(m.deleteResult('brief', { failed: 1 }), { text: '브리핑을 삭제하지 못했어요', error: true });
});

test('brief-room.js: delete paths use the owner RPC, folder item delete and the shared document delete', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../app/brief-room.js', import.meta.url), 'utf8');
  assert.match(src, /\/rest\/v1\/rpc\/app_document_brief_delete/);
  assert.match(src, /app_library_folder_items\?workspace_id=eq\.\$\{enc\(ws\(\)\)\}&folder_id=eq\.\$\{enc\(state\.folderId\)\}&document_id=eq\./);
  assert.match(src, /import\('\.\/document-delete\.js'\)/);
  assert.match(src, /deleteSequentially/);
  assert.match(src, /createSelectMode/);
  // 기기 저장 금지는 CI audit이 본다. 브리핑 표에 직접 DELETE 요청은 없다(서버 함수로만).
  assert.doesNotMatch(src, /app_document_briefs\?[^`]*method:'DELETE'/);
});

// BRIEF-자료실에서고르기(S64-10): 고르기 창 줄·넣은 뒤 한 줄.
test('libraryPickRows: 찾는 말 없으면 최근 자료, 이미 있는 자료는 흐리게 고를 수 없음', () => {
  const docs = Array.from({ length: 60 }, (_, i) => ({ id: `d${i}`, title: i === 3 ? '예시 편람 개정안' : `예시 자료 ${i}`, file_name: `f${i}.pdf` }));
  const r = m.libraryPickRows({ docs, inRoom: new Set(['d1']), query: '' });
  assert.equal(r.all.length, m.PICK_RECENT);
  assert.equal(r.total, 60);
  assert.deepEqual(r.recent, []);
  assert.deepEqual([r.all[1].enabled, r.all[1].current], [false, true]);
  assert.deepEqual([r.all[0].enabled, r.all[0].current, r.all[0].depth], [true, false, 0]);
});
test('libraryPickRows: 낱말이 모두 든 자료만(제목·파일 이름, 대소문자 무시)', () => {
  const docs = [{ id: 'a', title: '예시 편람 개정안', file_name: 'Plan.PDF' }, { id: 'b', title: '예시 보고서', file_name: 'x.hwp' }, { id: 'c', file_name: '예시 편람.hwp' }, { id: 1 }];
  assert.deepEqual(m.libraryPickRows({ docs, query: '편람' }).all.map(r => r.id), ['a', 'c']);
  assert.deepEqual(m.libraryPickRows({ docs, query: '예시 plan' }).all.map(r => r.id), ['a']);
  assert.deepEqual(m.libraryPickRows({ docs, query: '없는 말' }).all, []);
  assert.equal(m.libraryPickRows({ docs: [{ id: 'z' }] }).all[0].name, '이름 없는 자료');
});
test('pickResult: 넣은 수·원래 폴더에 둔 수·못 넣은 수', () => {
  assert.deepEqual(m.pickResult({ added: 2 }), { text: '2개 넣었어요', error: false });
  assert.equal(m.pickResult({ added: 1, kept: 1 }).text, '2개 넣었어요 · 1개는 원래 폴더에 그대로 두었어요(브리핑을 받으면 계속 보여요)');
  assert.deepEqual(m.pickResult({ added: 1, failed: 1 }), { text: '1개 넣었어요 · 1개는 넣지 못했어요', error: true });
  assert.equal(m.pickResult({ failed: 2 }).error, true);
});

test('S67-50 briefView: 등록한 담당이 없으면 우리 조직 관련 칸에 "등록한 담당이 없어요"만, 칸 이름은 단어표를 거침(노동조합+ 얼굴은 그대로)', () => {
  const none = m.briefView({ v: 2, lead: 'x', orgs: [], scope: 'none' });
  assert.deepEqual(none.sections.map(s => [s.key, s.title, s.empty]), [['orgs', '우리 조직 관련', '등록한 담당이 없어요']]);
  assert.deepEqual(m.briefView({ lead: 'x', touches: [], quotes: [] }).sections, []);
  assert.equal(m.briefView({ lead: 'x', touches: ['가'], scope: 'none' }).sections[0].empty, undefined);
});

// S67-41(명진 11/20 18:10 "폴더도 보여야할 것같고 먼가 찾기쉽게"): 형식 꼬리표·이름 한 줄·올린 날짜·[최근]·[폴더].
test('pickKind·pickDate·pickName: 사진 꼬리표, 숫자뿐인 사진 이름은 사진 · 날짜, 사람이 쓴 제목은 그대로', () => {
  const now = new Date('2026-11-20T00:00:00Z');
  assert.equal(m.pickKind({ file_name: 'a.JPG' }), '사진');
  assert.equal(m.pickKind({ file_name: 'x', mime_type: 'image/png' }), '사진');
  assert.equal(m.pickKind({ file_name: 'a.hwpx' }), 'HWP');
  assert.equal(m.pickKind({ file_name: 'a.pdf' }), 'PDF');
  assert.equal(m.pickDate('2026-11-05T16:00:00Z', now), '11/6'); // 한국 시각
  assert.equal(m.pickDate('2025-03-02T01:00:00Z', now), '25.3/2');
  assert.equal(m.pickDate('', now), '');
  assert.equal(m.pickName({ title: '20261105_123456.jpg', file_name: '20261105_123456.jpg', created_at: '2026-11-05T01:00:00Z' }, now), '사진 · 11/5');
  assert.equal(m.pickName({ file_name: 'IMG_1234.JPG', created_at: '2026-11-01T01:00:00Z' }, now), '사진 · 11/1');
  assert.equal(m.pickName({ file_name: 'KakaoTalk_20261101_0912.png' }, now), '사진');
  assert.equal(m.pickName({ title: '현장 사진', file_name: '1.jpg' }, now), '현장 사진');
  assert.equal(m.pickName({ title: '보고서 v1.2', file_name: 'a.hwp' }, now), '보고서 v1.2');
  assert.equal(m.pickName({ title: '예시 계획.pdf', file_name: '예시 계획.pdf' }, now), '예시 계획');
});
test('libraryPickRows [최근]: 줄마다 꼬리표·날짜', () => {
  const r = m.libraryPickRows({ docs: [{ id: 'a', title: '예시', file_name: 'a.pdf', created_at: '2026-11-05T01:00:00Z' }], now: new Date('2026-11-20T00:00:00Z') });
  assert.deepEqual([r.all[0].kind, r.all[0].meta, r.all[0].name], ['PDF', '11/5', '예시']);
});
test('libraryPickRows [폴더]: 맨 위는 폴더(들어가는 줄, 자료 수) → 폴더 밖 자료, 폴더 안은 위로 줄 → 하위 폴더 → 그 폴더 자료', () => {
  const folders = [{ id: 'f1', name: '교섭', parent_id: null }, { id: 'f2', name: '임금', parent_id: 'f1' }, { id: 'f3', name: '보도', parent_id: null }];
  const docs = [{ id: 'a', title: 'A', file_name: 'a.pdf' }, { id: 'b', title: 'B', file_name: 'b.hwp' }, { id: 'c', title: 'C', file_name: 'c.pdf' }];
  const itemFolder = new Map([['a', 'f1'], ['b', 'f2']]);
  const top = m.libraryPickRows({ docs, view: 'folder', folders, itemFolder, inRoom: new Set(['c']) });
  assert.equal(top.allLabel, '자료실');
  assert.deepEqual(top.all.map(r => r.nav ?? r.id), ['f1', 'f3', 'c']);
  assert.equal(top.all[0].meta, '1');
  assert.deepEqual([top.all[2].enabled, top.all[2].current], [false, true]);
  const inF1 = m.libraryPickRows({ docs, view: 'folder', folder: 'f1', folders, itemFolder });
  assert.equal(inF1.allLabel, '교섭');
  assert.deepEqual(inF1.all.map(r => r.back ? `back:${r.nav}` : r.nav ?? r.id), ['back:', 'f2', 'a']);
  const inF2 = m.libraryPickRows({ docs, view: 'folder', folder: 'f2', folders, itemFolder });
  assert.deepEqual(inF2.all.map(r => r.back ? `back:${r.nav}` : r.nav ?? r.id), ['back:f1', 'b']);
  // 찾는 말이 있으면 폴더와 상관없이 이름으로 찾는다.
  assert.deepEqual(m.libraryPickRows({ docs, view: 'folder', folder: 'f2', folders, itemFolder, query: 'a' }).all.map(r => r.id), ['a']);
});
