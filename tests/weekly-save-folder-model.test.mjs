// S69-67 WEEKLY-저장폴더: 주간보고 저장 폴더 규칙(app/weekly-save-folder-model.mjs)과 붙는 곳(journal-hwpx.js [확정]·② [올리기]).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {guessWeeklyFolder, liveWeeklyFolder, folderPath, planWeeklyFolder, WEEKLY_FOLDER_TEXT} from '../app/weekly-save-folder-model.mjs';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TEAM = id(1), WEEK = id(2), OTHER = id(3);
const folders = [
  {id: TEAM, parent_id: null, name: '가상 팀'},
  {id: WEEK, parent_id: TEAM, name: '가상 보고'},
  {id: OTHER, parent_id: null, name: '다른'},
];
const D = n => id(100 + n);

test('권할 폴더: 지난 주간보고 자료가 가장 많이 든 폴더(2개 이상, 1등이 하나일 때만)', () => {
  const items = [{document_id: D(1), folder_id: WEEK}, {document_id: D(2), folder_id: WEEK}, {document_id: D(3), folder_id: OTHER}, {document_id: D(9), folder_id: OTHER}];
  assert.equal(guessWeeklyFolder({folders, items, docIds: [D(1), D(2), D(3)]})?.id, WEEK);
  // 주간보고가 아닌 자료(D9)는 세지 않는다, 방금 저장한 자료(skip)도 빼고 센다.
  assert.equal(guessWeeklyFolder({folders, items, docIds: [D(1), D(2), D(3)], skip: D(1)}), null);
  // 같은 수 1등이 둘이면 권하지 않는다.
  assert.equal(guessWeeklyFolder({folders, items: [...items, {document_id: D(4), folder_id: OTHER}], docIds: [D(1), D(2), D(3), D(4)]}), null);
  // 휴지통에 간 폴더(보이는 목록에 없음)는 권하지 않는다.
  assert.equal(guessWeeklyFolder({folders: folders.filter(f => f.id !== WEEK), items, docIds: [D(1), D(2)]}), null);
  assert.equal(guessWeeklyFolder({}), null);
});

test('폴더 길: 부모부터 › 로 잇고, 고리·없는 부모에서 멈춘다', () => {
  assert.equal(folderPath(folders[1], folders), '가상 팀 › 가상 보고');
  assert.equal(folderPath(folders[2], folders), '다른');
  const loop = [{id: 'a', parent_id: 'b', name: 'A'}, {id: 'b', parent_id: 'a', name: 'B'}];
  assert.equal(folderPath(loop[0], loop), 'B › A');
});

test('어디에 넣을지: 칸 없음 → 지금처럼, 저장된 폴더 → 그 폴더, 없거나 휴지통 → 처음 한 번 묻기', () => {
  assert.deepEqual(planWeeklyFolder({off: true, saved: WEEK, folders}), {kind: 'off'});
  assert.equal(planWeeklyFolder({saved: WEEK, folders}).folder.id, WEEK);
  assert.deepEqual(planWeeklyFolder({saved: null, folders, guess: folders[1]}), {kind: 'ask', guess: folders[1]});
  assert.deepEqual(planWeeklyFolder({saved: WEEK, folders: [folders[0]], guess: null}), {kind: 'ask', guess: null});
  assert.equal(planWeeklyFolder({saved: null, folders: [folders[0]], guess: folders[1]}).guess, null);
  assert.equal(liveWeeklyFolder('잘못된 id!', folders), null);
});

test('안내 글: 폴더 길을 그대로 보이고, 화면 글 기준의 금지 낱말을 쓰지 않는다', () => {
  assert.equal(WEEKLY_FOLDER_TEXT.ask('가상 팀 › 가상 보고'), '주간 보고 파일을 ‘가상 팀 › 가상 보고’ 폴더에 모을까요?');
  for (const v of Object.values(WEEKLY_FOLDER_TEXT)) assert.doesNotMatch(typeof v === 'function' ? v('x') : v, /고쳤어요/);
});

test('붙는 곳: [확정] 저장과 ② [올리기] 저장 두 곳 모두 저장 폴더로 보내고, 폴더 이름을 코드에 두지 않는다', () => {
  const src = readFileSync(new URL('../app/journal-hwpx.js', import.meta.url), 'utf8');
  assert.equal((src.match(/toWeeklyFolder\(result\.document\?\.id/g) || []).length, 2);
  assert.match(src, /import\('\.\/weekly-save-folder\.js'\)\.then\(m => m\.fileWeeklyReport\(/);
  for (const f of ['../app/weekly-save-folder.js', '../app/weekly-save-folder-model.mjs']) {
    const s = readFileSync(new URL(f, import.meta.url), 'utf8').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    assert.doesNotMatch(s, /공공팀/); // 기기 저장 금지는 Browser storage audit 작업이 본다
  }
  // 드라이브는 공용 부탁 길(drive-follow.mjs → drive-mirror auto)만 쓴다 — 새 옮기기 코드 없음(S70-76).
  const mod = readFileSync(new URL('../app/weekly-save-folder.js', import.meta.url), 'utf8');
  assert.match(mod, /import \{askDriveFollow\} from '\.\/drive-follow\.mjs'/);
  assert.doesNotMatch(mod, /action=drive-mirror/);
  assert.doesNotMatch(mod, /googleapis/);
});

// ---- S70-11 WEEKLY-저장폴더나누기: 종류별 두 저장 폴더(내 주간 보고 = weekly_folder, 팀 보고 취합 = weekly_team_folder) ----
import {planWeeklySave, guessTeamByName, isInside, hasChildFolders, lastFolderOf, WEEKLY_FOLDER_COLUMNS} from '../app/weekly-save-folder-model.mjs';
// 가상 나무: 위 › 보고(지금 저장 폴더) › 해(하위) › {내 것, 팀 모음}. 이름은 지어낸 것(진짜 폴더 이름을 쓰지 않는다).
const TOP = id(10), REP = id(11), YEAR = id(12), MINE = id(13), TEAMF = id(14), ELSE = id(15);
const tree = [
  {id: TOP, parent_id: null, name: '가상 위'},
  {id: REP, parent_id: TOP, name: '가상 보고'},
  {id: YEAR, parent_id: REP, name: '가상 해'},
  {id: MINE, parent_id: YEAR, name: '가상 내 보고'},
  {id: TEAMF, parent_id: YEAR, name: '가상 팀 보고 취합'},
  {id: ELSE, parent_id: null, name: '가상 다른'},
];
const P = n => id(200 + n), C = n => id(300 + n);

test('S70-11 칸 이름: 종류마다 내 프로필 칸 하나', () => {
  assert.deepEqual(WEEKLY_FOLDER_COLUMNS, {personal: 'weekly_folder', confirmed: 'weekly_team_folder'});
});

test('S70-11 나무 도우미: 아래에 있나·하위 폴더 있나·바로 앞 자료의 폴더', () => {
  assert.equal(isInside(MINE, REP, tree), true);
  assert.equal(isInside(REP, REP, tree), false);
  assert.equal(isInside(ELSE, REP, tree), false);
  assert.equal(hasChildFolders(YEAR, tree), true);
  assert.equal(hasChildFolders(MINE, tree), false);
  assert.equal(lastFolderOf({items: [{document_id: P(2), folder_id: MINE}, {document_id: P(1), folder_id: REP}], docIds: [P(3), P(2), P(1)], skip: P(3)}), MINE);
});

test('S70-11 종류별 폴더 고르기: 정해 둔 칸이 그 종류만의 폴더(하위 폴더 없음)면 묻지 않고 넣는다', () => {
  assert.equal(planWeeklySave({kind: 'personal', saved: MINE, folders: tree}).folder.id, MINE);
  assert.equal(planWeeklySave({kind: 'confirmed', saved: TEAMF, personal: MINE, folders: tree}).folder.id, TEAMF);
  assert.deepEqual(planWeeklySave({kind: '다른', folders: tree}), {kind: 'off'});
});

test('S70-11 하위 폴더 생긴 뒤 다시 묻기: 정해 둔 폴더 아래로 지난 자료를 옮겨 두었으면 한 번 다시 묻고 그 하위 폴더를 권한다', () => {
  const items = [{document_id: P(1), folder_id: MINE}, {document_id: P(2), folder_id: MINE}, {document_id: C(1), folder_id: TEAMF}];
  const plan = planWeeklySave({kind: 'personal', saved: REP, folders: tree, items, docIds: [P(9), P(2), P(1)], skip: P(9)});
  assert.equal(plan.kind, 'ask'); assert.equal(plan.again, true); assert.equal(plan.guess.id, MINE);
  // [다른 폴더]로 원래 폴더를 다시 골랐으면(바로 앞 자료가 원래 폴더) 다시 묻지 않는다.
  const kept = planWeeklySave({kind: 'personal', saved: REP, folders: tree, items: [...items, {document_id: P(3), folder_id: REP}], docIds: [P(9), P(3), P(2), P(1)], skip: P(9)});
  assert.equal(kept.kind, 'put'); assert.equal(kept.folder.id, REP);
  // 하위 폴더는 있지만 지난 자료가 아직 원래 폴더에 있으면(옮기지 않음) 묻지 않는다.
  assert.equal(planWeeklySave({kind: 'personal', saved: REP, folders: tree, items: [{document_id: P(1), folder_id: REP}], docIds: [P(1)]}).kind, 'put');
  // [예]로 하위 폴더를 정한 뒤에는 묻지 않는다.
  assert.equal(planWeeklySave({kind: 'personal', saved: MINE, folders: tree, items, docIds: [P(2), P(1)]}).kind, 'put');
});

test('S70-11 지난 자료 많은 하위 폴더 권하기: 처음 정할 때 그 종류의 자료만 센다', () => {
  const items = [{document_id: P(1), folder_id: MINE}, {document_id: P(2), folder_id: MINE}, {document_id: C(1), folder_id: TEAMF}, {document_id: C(2), folder_id: TEAMF}, {document_id: C(3), folder_id: TEAMF}];
  assert.equal(planWeeklySave({kind: 'personal', folders: tree, items, docIds: [P(2), P(1)]}).guess.id, MINE);
  assert.equal(planWeeklySave({kind: 'confirmed', personal: MINE, folders: tree, items, docIds: [C(3), C(2), C(1)]}).guess.id, TEAMF);
  // 자료가 모인 폴더가 하위 폴더를 가진 상위 폴더면 그 아래에서 다시 고른다.
  const up = [{document_id: P(1), folder_id: YEAR}, {document_id: P(2), folder_id: YEAR}, {document_id: P(3), folder_id: MINE}];
  assert.equal(planWeeklySave({kind: 'personal', folders: tree, items: up, docIds: [P(3), P(2), P(1)]}).guess.id, MINE);
});

test("S70-11 이름 '취합' 형제 권하기: 팀 자료가 폴더에 없으면 내 주간 보고 폴더 곁의 이름 든 폴더", () => {
  assert.equal(guessTeamByName({folders: tree, personal: MINE})?.id, TEAMF);       // 형제
  assert.equal(guessTeamByName({folders: tree, personal: YEAR})?.id, TEAMF);       // 아직 상위 폴더를 정해 둔 경우 그 아래
  assert.equal(guessTeamByName({folders: tree, personal: null}), null);
  assert.equal(planWeeklySave({kind: 'confirmed', personal: MINE, folders: tree, items: [], docIds: []}).guess.id, TEAMF);
  // '취합'이 둘이면 권하지 않는다(사람이 고름). '취합'이 없으면 '팀'이 든 하나.
  const two = [...tree, {id: id(16), parent_id: YEAR, name: '가상 취합 옛'}];
  assert.equal(guessTeamByName({folders: two, personal: MINE}), null);
  const teamOnly = tree.map(f => f.id === TEAMF ? {...f, name: '가상 팀 모음'} : f);
  assert.equal(guessTeamByName({folders: teamOnly, personal: MINE})?.id, TEAMF);
  assert.equal(planWeeklySave({kind: 'confirmed', personal: ELSE, folders: tree}).guess, null);
});

test('S70-11 칸 없음(팀 칸이 아직 없는 서버) → 지금처럼: 개인은 한 폴더 그대로(다시 묻지 않음), 팀은 아무것도 안 함', () => {
  const items = [{document_id: P(1), folder_id: MINE}, {document_id: P(2), folder_id: MINE}];
  const plan = planWeeklySave({kind: 'personal', saved: REP, legacy: true, folders: tree, items, docIds: [P(2), P(1)]});
  assert.equal(plan.kind, 'put'); assert.equal(plan.folder.id, REP);
  assert.deepEqual(planWeeklySave({kind: 'confirmed', saved: TEAMF, legacy: true, folders: tree}), {kind: 'off'});
  assert.equal(planWeeklySave({kind: 'personal', legacy: true, folders: tree, items, docIds: [P(2), P(1)]}).guess.id, MINE);
});

test('S70-11 안내 글: 종류 이름과 받침에 맞는 조사, 띄어 쓴 주간 보고', () => {
  assert.equal(WEEKLY_FOLDER_TEXT.askKind('personal', '가상 해 › 가상 내 보고'), '앞으로 내 주간 보고는 ‘가상 해 › 가상 내 보고’ 폴더에 넣을까요?');
  assert.equal(WEEKLY_FOLDER_TEXT.askKind('confirmed', 'x'), '앞으로 팀 보고 취합은 ‘x’ 폴더에 넣을까요?');
  assert.equal(WEEKLY_FOLDER_TEXT.putKind('confirmed', 'x'), '팀 보고 취합을 ‘x’ 폴더에 넣었어요.');
  assert.equal(WEEKLY_FOLDER_TEXT.menu('personal'), '내 주간 보고 저장 폴더');
  for (const k of ['personal', 'confirmed']) for (const f of ['askKind', 'askPickKind', 'putKind', 'chosenKind', 'menu', 'menuOn', 'menuOff'])
    assert.doesNotMatch(WEEKLY_FOLDER_TEXT[f](k, 'x', 'x'), /주간보고|고쳤어요/);
});

test('S70-11 붙는 곳: 자료실 [+ 자료 등록]으로 주간보고 분류를 골라 올리면 그 종류 저장 폴더로, 폴더 ⋯ 메뉴 두 줄', () => {
  const up = readFileSync(new URL('../app/library-upload.js', import.meta.url), 'utf8');
  assert.match(up, /if\(succeeded&&!org&&!meeting&&\(!folder\|\|folder\.receive\)&&okDocIds\.length\)\{const kind=weeklyRoleOf\(String\(fields\.category\|\|''\)\);if\(kind\)void import\('\.\/weekly-save-folder\.js'\)/);
  assert.match(up, /weekly:\{show:luWeeklyShow,get:luWeeklyGet,set:luWeeklySet\}/);
  const fo = readFileSync(new URL('../app/library-folders.js', import.meta.url), 'utf8');
  assert.match(fo, /toggleLine\('weekly-'\+kind,weekly\.get\(kind\)===f\.id,/);
  const mod = readFileSync(new URL('../app/weekly-save-folder.js', import.meta.url), 'utf8');
  assert.match(mod, /one\(`\$\{COL\.personal\},\$\{COL\.confirmed\}`\)/);
});
