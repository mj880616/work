import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sameFolderName, orgFolderName, guessParentFolder, liveParent, planOrgFolder, gatherPlan, gatherLine, ASK_TEXT} from '../app/org-files-folder-model.mjs';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P = id(1), Q = id(2);
const folders = [
  {id: P, parent_id: null, name: '부모'},
  {id: Q, parent_id: null, name: '다른'},
  {id: id(10), parent_id: P, name: 'A지부', sort_order: 1},
  {id: id(11), parent_id: P, name: 'B 노조', sort_order: 2},
  {id: id(12), parent_id: P, name: '선전·소식지', sort_order: 3},
  {id: id(13), parent_id: Q, name: 'A지부', sort_order: 1},
];
const orgs = [{id: id(100), name: 'A지부'}, {id: id(101), name: 'B노조'}, {id: id(102), name: 'C 지부'}];

test('이름 비교: 띄어쓰기·가운뎃점 차이는 같게 본다', () => {
  assert.ok(sameFolderName('B 노조', 'B노조'));
  assert.ok(sameFolderName('선전 소식지', '선전·소식지'));
  assert.ok(!sameFolderName('A지부', 'B노조'));
  assert.ok(!sameFolderName('', ''));
});

test('새 폴더 이름은 조직 이름 그대로, 40자까지', () => {
  assert.equal(orgFolderName('  C 지부 '), 'C 지부');
  assert.equal([...orgFolderName('가'.repeat(50))].length, 40);
  assert.equal(orgFolderName(''), '');
});

test('부모 추정: 조직 이름과 같은 하위 폴더가 가장 많은 폴더', () => {
  assert.equal(guessParentFolder(folders, orgs)?.id, P);
  assert.equal(guessParentFolder(folders, []), null);
  // 하나뿐이면(2개 미만) 추정하지 않는다
  assert.equal(guessParentFolder(folders.filter(f => f.parent_id !== P || f.name === 'A지부'), orgs), null);
});

test('저장된 부모는 보이는 폴더일 때만', () => {
  assert.equal(liveParent(P, folders)?.id, P);
  assert.equal(liveParent(id(999), folders), null);
  assert.equal(liveParent('x', folders), null);
});

test('폴더 정하기: 같은 이름 폴더를 짝짓고, 없으면 만들고, 짝이 있으면 이름이 바뀌어도 그 폴더', () => {
  const parent = folders[0];
  assert.deepEqual(planOrgFolder({folders, links: [], parent, org: orgs[1]}), {kind: 'match', folder: folders[3]});
  const made = planOrgFolder({folders, links: [], parent, org: orgs[2]});
  assert.equal(made.kind, 'create'); assert.equal(made.name, 'C 지부'); assert.equal(made.parent.id, P);
  // 짝: 조직 이름이 '새 이름'으로 바뀌어도 짝지은 폴더(부모 밖으로 옮겼어도)
  const renamed = {id: orgs[0].id, name: '새 이름'};
  assert.equal(planOrgFolder({folders, links: [{id: id(13), organization_id: renamed.id}], parent, org: renamed}).folder.id, id(13));
  // 다른 조직과 짝인 같은 이름 폴더는 빼앗지 않는다
  assert.equal(planOrgFolder({folders, links: [{id: id(10), organization_id: id(555)}], parent, org: orgs[0]}).kind, 'create');
  // 짝 폴더가 휴지통(보이지 않음)이면 부모 아래에서 다시 찾는다
  assert.equal(planOrgFolder({folders, links: [{id: id(999), organization_id: orgs[0].id}], parent, org: orgs[0]}).folder.id, id(10));
  // 부모 없음·짝 없음 → null(물어봐야 함)
  assert.equal(planOrgFolder({folders, links: [], parent: null, org: orgs[0]}), null);
});

test('지난 자료 모으기: 폴더 밖·받는 폴더 자료만, 사람이 고른 폴더·휴지통 폴더 자료는 그대로', () => {
  const R = id(50), docs = [
    {id: id(200), organization_id: orgs[0].id}, // 폴더 밖
    {id: id(201), organization_id: orgs[0].id}, // 받는 폴더
    {id: id(202), organization_id: orgs[0].id}, // 사람이 고른 폴더
    {id: id(203), organization_id: orgs[1].id}, // 휴지통 폴더
    {id: id(204), organization_id: null},
    {id: id(205), organization_id: id(777)}, // 내 조직 목록 밖
  ];
  const items = [{document_id: id(201), folder_id: R}, {document_id: id(202), folder_id: Q}, {document_id: id(203), folder_id: id(888)}];
  const plan = gatherPlan({docs, items, visibleIds: new Set([P, Q, R]), receiveId: R, orgIds: orgs.map(o => o.id)});
  assert.deepEqual(plan.get(orgs[0].id), [{id: id(200), from: null}, {id: id(201), from: R}]);
  assert.equal(plan.has(orgs[1].id), false);
  assert.equal(plan.has(id(777)), false);
  assert.match(gatherLine(3), /^지난 .*기록 자료 3개를 .*폴더로 모았어요$/);
  assert.match(gatherLine(3, 1), / · 못 옮김 1$/);
  assert.match(ASK_TEXT('조직'), /조직 기록 자료를 ‘조직’ 폴더에 모을까요\?/);
});

test('폴더 이름·경로를 코드에 박지 않는다(기기 저장 금지는 저장소 audit가 본다)', () => {
  for (const f of ['app/org-files-folder-model.mjs', 'app/org-files-folder.js']) {
    const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/ [^'\n]*$/gm, '');
    assert.doesNotMatch(src, /궤도|03\.|철도|지하철/);
  }
});

test('공유 조직(남의 작업공간)은 내 조직 표에서만 찾고 서버 함수가 같은 작업공간 조직만 받는다', () => {
  const src = readFileSync(new URL('../app/org-files-folder.js', import.meta.url), 'utf8');
  assert.match(src, /app_suborganizations\?workspace_id=eq\./);
  assert.match(src, /if \(!mine\) return \{status: 'off'\}/);
  const sql = readFileSync(new URL('../supabase/migrations/20261124160000_library_org_folder.sql', import.meta.url), 'utf8');
  assert.match(sql, /private\.app_is_workspace_owner\(ws\)/);
  assert.match(sql, /org_ws is null or org_ws <> ws/);
  assert.match(sql, /revoke all on function public\.app_library_folder_set_org\(uuid, uuid\) from public, anon, authenticated, service_role;\ngrant execute on function public\.app_library_folder_set_org\(uuid, uuid\) to authenticated;/);
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /to anon|to public|disable row level security|rtw_/i);
});

// S70-29(2026-11-25 명진 '다 없애 1회용 기능'): 조직 관리 ⋯ [지난 조직 기록 자료도 조직 폴더로 모으기] 메뉴 줄은 없고, 모으는 폴더를 처음 정할 때 저절로 모은다.
test('지난 자료 모으기: 메뉴 줄 없음, 처음 정할 때(askParent [예]·처음 고르기) 저절로', async () => {
  const {readFileSync} = await import('node:fs');
  const so = readFileSync(new URL('../app/suborganizations.js', import.meta.url), 'utf8');
  assert.doesNotMatch(so, /data-so-files-gather|지난 조직 기록 자료도 조직 폴더로 모으기|gatherPastOrgFiles/);
  const mod = readFileSync(new URL('../app/org-files-folder.js', import.meta.url), 'utf8');
  assert.match(mod, /then\(\);\n\s*void gatherPastOrgFiles\(\{rt\}\);/, 'first choice in the ask line gathers past files');
  assert.match(mod, /if \(saved && !liveParent\(st\.parentId, st\.folders\)\) void gatherPastOrgFiles\(\{rt\}\);/, 'first choice from the menu picker gathers too');
  assert.doesNotMatch(mod, /askParent\(st, rt, \(\) => void gatherPastOrgFiles/, 'gather never asks by itself');
});
