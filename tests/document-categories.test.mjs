import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DOCUMENT_CATEGORIES, documentCategories, documentCategoriesLoaded, setDocumentCategories, resetDocumentCategories, loadDocumentCategories,
  categoryOf, categoryOptions, categoryTag, storedValuesOf, documentCountOf, categoryNameProblem, categoryErrorText,
  addDocumentCategory, renameDocumentCategory, deleteDocumentCategory,
} from '../app/document-categories.js';
import { notePlaces, noteState, visibleNotes, placeSubOptions, filedOrganizations } from '../app/basket-data.js';

globalThis.window ??= new EventTarget();
globalThis.CustomEvent ??= class extends Event { constructor(type, init) { super(type); this.detail = init?.detail; } };
const events = [];
window.addEventListener('kptu:document-categories-changed', () => events.push('categories'));
window.addEventListener('kptu:documents-changed', () => events.push('documents'));
const runtime = (handler, user = 'u') => {
  const calls = [];
  return { calls, rt: { context: { read: () => ({ user: { id: user }, workspace: { id: 'w' } }) }, api: async (path, options = {}) => { calls.push({ path, options }); return handler(path, options); } } };
};
const SEVEN = ['교섭', '투쟁', '교육', '선전', '정책', '회의', '기타'];

test('the list starts as the default 7 and only a well-formed list replaces it', () => {
  resetDocumentCategories(); events.length = 0;
  assert.deepEqual(documentCategories(), DEFAULT_DOCUMENT_CATEGORIES);
  for (const bad of [null, [], ['교섭'], ['기타', '기타'], ['기타', ' 홍보'], ['기타', ''], ['기타', 5], ['기타', '가'.repeat(21)], Array.from({ length: 31 }, (_, i) => i ? '분류' + i : '기타')])
    assert.equal(setDocumentCategories(bad), false, JSON.stringify(bad));
  assert.deepEqual(documentCategories(), SEVEN); assert.deepEqual(events, []);
  assert.equal(setDocumentCategories([...SEVEN, '홍보']), true);
  assert.deepEqual(documentCategories(), [...SEVEN, '홍보']); assert.deepEqual(events, ['categories']);
  assert.equal(setDocumentCategories([...SEVEN, '홍보']), false); assert.deepEqual(events, ['categories']);
  resetDocumentCategories();
});

test('stored values are shown by the current list: old names follow their match only while that name exists', () => {
  resetDocumentCategories();
  assert.equal(categoryOf('정부자료'), '정책');
  setDocumentCategories(['교섭', '투쟁', '교육', '선전', '정책·법령', '회의', '기타', '홍보']);
  // The old automatic name no longer has its category: it reads as 기타 until it is renamed with its stored values.
  assert.equal(categoryOf('정부자료'), '기타'); assert.equal(categoryOf('교섭자료'), '교섭'); assert.equal(categoryOf('홍보'), '홍보');
  assert.equal(categoryOf('정책·법령'), '정책·법령'); assert.equal(categoryOf('홍보물'), '홍보');
  // The longest listed name wins; 기타 never captures by prefix.
  setDocumentCategories([...documentCategories(), '홍보물']);
  assert.equal(categoryOf('홍보물 모음'), '홍보물'); assert.equal(categoryOf('기타 자료'), '기타');
  assert.match(categoryOptions('정부자료'), /<option value="기타" selected>기타<\/option>/);
  assert.equal((categoryOptions('').match(/<option /g) || []).length, 9);
  assert.equal(categoryTag('홍보'), '<span class="doc-category-tag" data-doc-category="홍보">홍보</span>');
  resetDocumentCategories();
});

test('the stored values a rename or delete must carry are the old names that read as that category and are not list names', () => {
  resetDocumentCategories();
  const docs = [{ category: '정부자료' }, { category: '국회자료' }, { category: '정책자료' }, { category: '정책' }, { category: '교섭자료' }, { category: null }, { category: '' }, { category: '정부자료' }, { category: '현장자료' }];
  assert.deepEqual(storedValuesOf('정책', docs), ['정부자료', '국회자료', '정책자료']);
  assert.deepEqual(storedValuesOf('교섭', docs), ['교섭자료']);
  assert.deepEqual(storedValuesOf('투쟁', docs), []);
  assert.equal(documentCountOf('정책', docs), 5); assert.equal(documentCountOf('기타', docs), 3);
  const many = Array.from({ length: 60 }, (_, i) => ({ category: '정책-' + i }));
  assert.equal(storedValuesOf('정책', many), null);
});

test('names are checked in plain words before anything is sent', () => {
  resetDocumentCategories();
  assert.equal(categoryNameProblem('  '), '분류 이름을 적어 주세요.');
  assert.equal(categoryNameProblem('가'.repeat(21)), '분류 이름은 20자까지 쓸 수 있어요.');
  assert.equal(categoryNameProblem('가,나'), '분류 이름에는 쉼표를 쓸 수 없어요.');
  assert.equal(categoryNameProblem('교섭'), '이미 있는 분류 이름이에요.');
  assert.equal(categoryNameProblem('교섭', { except: '교섭' }), '');
  assert.equal(categoryNameProblem(' 홍보 '), '');
  assert.match(categoryErrorText('CATEGORY_LOCKED'), /기타/); assert.match(categoryErrorText('???'), /바꾸지 못했어요/);
});

test('the list is read once per login, only a valid answer is kept, and a forced read that fails marks it unknown', async () => {
  resetDocumentCategories();
  let answer = [{ document_categories: [...SEVEN, '홍보'] }];
  const { rt, calls } = runtime(() => answer);
  assert.equal(documentCategoriesLoaded(), false);
  assert.deepEqual(await loadDocumentCategories({ rt }), [...SEVEN, '홍보']);
  assert.equal(documentCategoriesLoaded(), true);
  assert.equal(calls[0].path, '/rest/v1/app_profiles?user_id=eq.u&select=document_categories&limit=1');
  await loadDocumentCategories({ rt }); assert.equal(calls.length, 1);
  answer = [{ document_categories: ['no', 'kita'] }];
  await loadDocumentCategories({ rt, force: true });
  assert.deepEqual(documentCategories(), [...SEVEN, '홍보']); assert.equal(documentCategoriesLoaded(), false);
  const failing = runtime(() => { throw Object.assign(new Error('x'), { status: 500 }); });
  await loadDocumentCategories({ rt: failing.rt, force: true }); assert.deepEqual(documentCategories(), [...SEVEN, '홍보']);
  // Another login does not see this list.
  const other = runtime(() => [], 'v');
  resetDocumentCategories();
  assert.deepEqual(await loadDocumentCategories({ rt: other.rt }), SEVEN);
  resetDocumentCategories();
});

test('the three functions are called with their exact arguments; refusals are codes, a lost answer is UNKNOWN and never resent', async () => {
  resetDocumentCategories(); events.length = 0;
  const ok = runtime(() => ({ ok: true, categories: [...SEVEN, '홍보'] }));
  assert.deepEqual(await addDocumentCategory('홍보', { rt: ok.rt }), { ok: true, categories: [...SEVEN, '홍보'], documents: 0 });
  assert.deepEqual(ok.calls.map(c => [c.path, c.options.method, c.options.body]), [['/rest/v1/rpc/app_document_category_add', 'POST', { p_name: '홍보' }]]);
  assert.deepEqual(documentCategories(), [...SEVEN, '홍보']);
  const renamed = runtime(() => ({ ok: true, categories: ['교섭', '투쟁', '교육', '선전', '정책·법령', '회의', '기타', '홍보'], documents: 2 }));
  events.length = 0;
  const result = await renameDocumentCategory('정책', '정책·법령', ['정부자료'], { rt: renamed.rt });
  assert.equal(result.ok, true); assert.equal(result.documents, 2);
  assert.deepEqual(renamed.calls[0].options.body, { p_from: '정책', p_to: '정책·법령', p_stored: ['정부자료'] });
  assert.deepEqual(events, ['categories', 'documents']);
  const removed = runtime(() => ({ ok: true, categories: SEVEN, documents: 0 }));
  events.length = 0;
  await deleteDocumentCategory('홍보', undefined, { rt: removed.rt });
  assert.deepEqual(removed.calls[0].options.body, { p_name: '홍보', p_stored: [] }); assert.deepEqual(events, ['categories']);
  for (const code of ['CATEGORY_LOCKED', 'CATEGORY_EXISTS', 'CATEGORY_NOT_FOUND', 'INVALID_NAME', 'INVALID_INPUT', 'PERMISSION_DENIED'])
    assert.deepEqual(await deleteDocumentCategory('기타', [], { rt: runtime(() => ({ ok: false, error: code })).rt }), { ok: false, error: code });
  const status = s => runtime(() => { throw Object.assign(new Error('x'), { status: s }); });
  for (const [s, error] of [[500, 'UNKNOWN'], [0, 'UNKNOWN'], [502, 'UNKNOWN'], [403, 'PERMISSION_DENIED'], [401, 'PERMISSION_DENIED'], [404, 'FUNCTION_UNAVAILABLE'], [400, 'REFUSED'], [409, 'REFUSED']]) {
    const lost = status(s);
    assert.deepEqual(await addDocumentCategory('x', { rt: lost.rt }), { ok: false, error }, String(s)); assert.equal(lost.calls.length, 1);
  }
  assert.deepEqual(await addDocumentCategory('x', { rt: runtime(() => ({ ok: true, categories: ['잘못'] })).rt }), { ok: false, error: 'UNKNOWN' });
  assert.deepEqual(await addDocumentCategory('x', { rt: runtime(() => null).rt }), { ok: false, error: 'UNKNOWN' });
  resetDocumentCategories();
});

// 조직 자료(UI-바구니첨부메모 PR 3): 바구니는 첨부 파일이 붙은 조직을 같은 방식으로 읽는다.
test('a memo whose files are an organization document is classified under 담당조직 and 자료실, without a record link', () => {
  const note = { id: 'n', attachments: [{ drive_file_id: 'a' }, { drive_file_id: 'b' }] };
  const docs = [{ id: 'd1', file_id: 'a', project_id: null, organization_id: 'o', organization: { name: '한빛지부' }, category: '교섭자료' }, { id: 'd2', file_id: 'b', project_id: null, organization_id: 'o', organization: { name: '한빛지부' }, category: null }];
  assert.deepEqual(filedOrganizations(note, docs), [{ organization_id: 'o', name: '한빛지부' }]);
  assert.deepEqual([...notePlaces(note, [], docs)].sort(), ['library', 'organization']);
  assert.deepEqual(noteState(note, [], docs), { status: '확정', destinations: ['담당조직 자료: 한빛지부'] });
  assert.deepEqual(visibleNotes([note], [], 'classified', docs, 'organization').map(n => n.id), ['n']);
  assert.deepEqual(visibleNotes([note], [], 'classified', docs, 'project'), []);
  assert.deepEqual(visibleNotes([note], [], 'classified', docs, 'organization', 'o').map(n => n.id), ['n']);
  assert.deepEqual(visibleNotes([note], [], 'classified', docs, 'library', '교섭').map(n => n.id), ['n']);
  assert.deepEqual(placeSubOptions([note], [], docs, 'organization'), [{ value: 'all', label: '모든 조직 1' }, { value: 'o', label: '한빛지부' }]);
  assert.deepEqual(visibleNotes([note], [], 'unclassified', docs), []);
  // Taken off the organization: unclassified again; a document with both a project and an organization counts for both.
  assert.deepEqual(visibleNotes([note], [], 'unclassified', [{ file_id: 'a', project_id: null, organization_id: null }]).map(n => n.id), ['n']);
  const both = [{ id: 'd1', file_id: 'a', project_id: 'p', project: { name: '민자철도' }, organization_id: 'o', organization: { name: '한빛지부' } }];
  assert.deepEqual([...notePlaces({ id: 'm', attachments: [{ drive_file_id: 'a' }] }, [], both)].sort(), ['library', 'organization', 'project']);
});

test('the basket library chips follow the current list', () => {
  resetDocumentCategories(); setDocumentCategories([...SEVEN, '홍보']);
  const note = { id: 'n', attachments: [{ drive_file_id: 'a' }] };
  const docs = [{ id: 'd1', file_id: 'a', organization_id: 'o', organization: { name: '한빛지부' }, category: '홍보' }];
  assert.deepEqual(placeSubOptions([note], [], docs, 'library').map(o => o.value), ['all', ...SEVEN, '홍보']);
  assert.deepEqual(visibleNotes([note], [], 'classified', docs, 'library', '홍보').map(n => n.id), ['n']);
  resetDocumentCategories();
});
