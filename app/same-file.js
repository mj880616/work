// UX-이미있는파일알림(요청함 11/12 09:39 — "같은 사이즈 같은 이름으로 된 자료가 어디에라도 있으면 이미 있는 자료라고 알려줬으면. 모든 파일 넣는 곳 공통"):
// 모든 파일 넣는 곳이 같이 쓰는 판정·알림 부품 하나. 파일을 고르거나 끌어 놓은 직후, 올리기 전에 부른다.
// - 찾기: 내 작업공간 안만, 지금 있는 소유자 RLS 읽기 그대로(새 서버 함수·권한 없음). Web2가 아는 자료만 본다(Drive 전체 검색 안 함).
//     자료실·사업 보고 회의자료·사진·조직 기록 파일(app_documents.file_name·file_size), 정리함·노트·업데이트 첨부(app_notes.attachments의 file_name·size_bytes),
//     할 일 첨부(app_task_attachments.file_name·size_bytes). 휴지통 노트는 DB 정책이 이미 숨긴다. 일정 첨부는 Web2 표가 없어(구글 캘린더에만 있음) 찾는 대상이 아니다.
// - 묻기: 같은 것이 있는 파일만 모아 작은 확인창 하나(small-notice.js askActions) — '이미 있는 자료예요' + 위치 줄 + [그래도 올리기] [올리지 않기]
//     (그 자리가 있는 자료를 붙일 수 있으면 useExisting을 주어 [있는 것 쓰기]도). 같은 것이 없는 파일은 묻지 않고 그대로 올린다.
// - 찾기가 안 되면(로그인 없음·표 없음·인터넷·4초 넘음) 묻지 않고 그대로 올린다. 넣기를 막지 않는다. 기기에 아무것도 저장하지 않는다.
import {sameTargets, inList, noteContains, noteHas, docHit, noteHits, taskHit, matchFiles, askLines, splitByAnswer} from './same-file-model.mjs';
import {askActions} from './small-notice.js';

export const SAME_WAIT_MS = 4000;
const enc = encodeURIComponent;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rows = v => (Array.isArray(v) ? v : []);
const quiet = p => Promise.resolve(p).then(rows, () => []);

// 찾은 자료가 있는 폴더·사업 보고·담당조직 이름(위치 줄에 씀). 못 읽으면 이름 없이 '자료실'만.
async function placeNames(api, ws, docs) {
  const ids = docs.map(d => d.id).filter(id => UUID.test(id || ''));
  const meetings = [...new Set(docs.map(d => d.meeting_id).filter(id => UUID.test(id || '')))];
  const orgs = [...new Set(docs.map(d => d.organization_id).filter(id => UUID.test(id || '')))];
  const [items, folders, mrows, orows] = await Promise.all([
    ids.length ? quiet(api(`/rest/v1/app_library_folder_items?workspace_id=eq.${enc(ws)}&document_id=in.(${ids.join(',')})&select=document_id,folder_id`)) : [],
    ids.length ? quiet(api(`/rest/v1/app_library_folders?workspace_id=eq.${enc(ws)}&select=id,name`)) : [],
    meetings.length ? quiet(api(`/rest/v1/app_meetings?workspace_id=eq.${enc(ws)}&id=in.(${meetings.join(',')})&select=id,title`)) : [],
    orgs.length ? quiet(api(`/rest/v1/app_suborganizations?workspace_id=eq.${enc(ws)}&id=in.(${orgs.join(',')})&select=id,name`)) : [],
  ]);
  const folderName = new Map(folders.map(f => [f.id, f.name]));
  return {
    folders: new Map(items.filter(x => folderName.has(x.folder_id)).map(x => [x.document_id, folderName.get(x.folder_id)])),
    meetings: new Map(mrows.map(m => [m.id, m.title])),
    orgs: new Map(orows.map(o => [o.id, o.name])),
  };
}

// files(File·{name,size}) → Map(file → [{line, kind, ref}]). 같은 것이 없거나 찾지 못하면 빈 Map.
export async function findSameFiles(files, {rt = globalThis.window?.KPTURuntime, waitMs = SAME_WAIT_MS} = {}) {
  const list = Array.from(files || []);
  const targets = sameTargets(list);
  const ws = rt?.context?.read?.()?.workspace?.id;
  if (!targets.length || !ws || typeof rt?.api !== 'function') return new Map();
  const api = (path) => rt.api(path, {singleFlight: false});
  const names = inList(targets.map(t => t.name)), sizes = `(${[...new Set(targets.map(t => t.size))].join(',')})`;
  const work = (async () => {
    const [docs, tasks, ...notes] = await Promise.all([
      quiet(api(`/rest/v1/app_documents?workspace_id=eq.${enc(ws)}&file_name=in.${enc(names)}&file_size=in.${sizes}&select=id,title,file_name,file_size,meeting_id,organization_id,file_id,drive_url,mime_type,created_at&order=created_at.desc&limit=60`)),
      quiet(api(`/rest/v1/app_task_attachments?workspace_id=eq.${enc(ws)}&file_name=in.${enc(names)}&size_bytes=in.${sizes}&select=google_task_id,drive_file_id,file_name,size_bytes,created_at&order=created_at.desc&limit=60`)),
      ...targets.map(t => quiet(api(`/rest/v1/app_notes?workspace_id=eq.${enc(ws)}&attachments=cs.${enc(noteContains(t))}&select=id,kind,title,occurred_at,created_at,attachments&order=created_at.desc&limit=5`))),
    ]);
    const hits = [];
    if (docs.length) { const n = await placeNames(api, ws, docs); docs.forEach(d => hits.push(docHit(d, n))); }
    // 돌아온 노트가 정말 그 첨부(이름·크기)를 가졌는지 한 번 더 본다(서버 거르기를 그대로 믿지 않음).
    notes.forEach((found, i) => found.filter(n => noteHas(n, targets[i])).forEach(n => hits.push(noteHits(n, targets[i]))));
    tasks.forEach(r => hits.push(taskHit(r)));
    return matchFiles(list, hits);
  })().catch(() => new Map());
  let timer = 0;
  const late = new Promise(ok => { timer = setTimeout(() => ok(new Map()), waitMs); });
  try { return await Promise.race([work, late]); } finally { clearTimeout(timer); }
}

// 넣기 전에 한 번: 같은 것이 있으면 묻고, 올릴 파일만 돌려준다.
// 돌려줌 {files: 올릴 파일, used: [{file, hit}](있는 것 쓰기), skipped: [File]}. 같은 것이 없거나 찾지 못하면 files = 받은 그대로.
// useExisting: 그 자리가 있는 자료를 붙일 수 있을 때만 준다(없으면 [있는 것 쓰기] 버튼이 없다). 부른 곳이 used를 받아 붙인다.
export async function screenSameFiles(files, {anchor = null, rt = globalThis.window?.KPTURuntime, useExisting = false, find = findSameFiles, ask = askActions} = {}) {
  const list = Array.from(files || []);
  const found = list.length ? await find(list, {rt}) : new Map();
  if (!found.size) return {files: list, used: [], skipped: []};
  const lines = askLines(found);
  const actions = [
    {value: 'skip', label: '올리지 않기', kind: 'row-act'},
    {value: 'upload', label: '그래도 올리기', kind: useExisting ? 'secondary' : 'primary'},
    ...(useExisting ? [{value: 'use', label: '있는 것 쓰기', kind: 'primary'}] : []),
  ];
  const rest = list.length - found.size;
  const answer = await ask(anchor, {
    text: found.size > 1 ? `이미 있는 자료예요 · ${found.size}개` : '이미 있는 자료예요',
    lines, note: rest > 0 ? `나머지 ${rest}개는 바로 올려요` : '', actions, className: 'same-file-ask',
  });
  return splitByAnswer(list, found, answer);
}

// 넣는 곳에 붙이는 짧은 길: 고른 파일을 거른 뒤 take(올릴 파일)를 부른다. 올릴 것이 하나도 없으면 부르지 않는다.
export async function takeAfterSameCheck(files, take, options = {}) {
  const list = Array.from(files || []);
  if (!list.length) return take(list);
  const r = await screenSameFiles(list, options);
  if (r.files.length) return take(r.files);
  return undefined;
}
