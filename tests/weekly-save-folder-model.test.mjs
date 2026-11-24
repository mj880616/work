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
  // 드라이브는 기존 맞추기(drive-mirror auto)만 부탁한다 — 새 옮기기 코드 없음.
  const mod = readFileSync(new URL('../app/weekly-save-folder.js', import.meta.url), 'utf8');
  assert.match(mod, /workspace-drive\?action=drive-mirror', \{method: 'POST', body: \{mode: 'auto'\}/);
  assert.doesNotMatch(mod, /googleapis/);
});
