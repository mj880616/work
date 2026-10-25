// ED③ 1단계: 노트 폴더 ⋯ 의 1회용 [옛 마크다운 노트 변환](owner 로그인만). 계산은 note-convert-model.mjs, 이 파일은 읽기·저장만 한다.
// PRESS 가져오기 단추(press-import.js, PR 1099)와 같은 모양: 시작 전 확인 → 한 건씩 → 다시 눌러도 빠진 것만 → 진행 n/N → 다음 PR에서 삭제.
// - 저장은 노트 화면과 같은 owner RLS REST PATCH(app_notes, kind=note) 한 건씩. 새 서버 기능·서버 키·권한 확대 없음.
// - 백업(app_ed3_text_backups, 20261024190000)이 있어야만 시작하고, 백업에 그 노트가 있고 백업 뒤 고치지 않은 노트만 바꾼다.
//   백업 표의 글 내용은 화면이 읽을 수 없다(번호·시각만 읽음). 대조는 바꾼 노트의 화면 글과 지금 원문을 나란히 본다(아래 compare).
// - 저장 조건: updated_at=백업 때 값 + doc 비어 있음 + kind=note. 그사이 다른 기기에서 고쳤거나 이미 바뀐 노트는 0행 → 건너뜀.
//   고친 시각은 바꾸지 않는다(PATCH 본문에 updated_at 없음; app_notes에는 고친 시각을 바꾸는 트리거가 없다 — 사실, 저장소 migration).
// - 실제 실행(운영 노트 변경)은 명진이 메뉴를 눌러야만 일어난다. 이 세션·CI는 누르지 않는다.
import {CONVERT_TEXT, buildConvertPlan, convertNote, sample} from './note-convert-model.mjs';

const MARKDOWN_IT = './markdown-lib/markdown-it-15.0.2/markdown-it.esm.min.mjs';
const enc = encodeURIComponent;
const PAGE = 500;
// The same markdown-it settings as the editor's [서식으로 바꾸기] (ed-editor.js loadMarkdownIt).
export async function loadMarkdown(safeHref) {
  const {default: MarkdownIt} = await import(MARKDOWN_IT);
  const md = new MarkdownIt({html: false, linkify: true, breaks: true, typographer: false});
  md.linkify.set({fuzzyEmail: false});
  md.validateLink = url => !!safeHref(url);
  return md;
}
async function pages(api, path) {
  const out = [];
  for (let offset = 0;; offset += PAGE) {
    const rows = await api(`${path}&limit=${PAGE}&offset=${offset}`);
    if (!Array.isArray(rows)) throw new Error('목록 모양이 다름');
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

// deps: {api(path, options), workspace() → id, md (markdown-it), confirm({count, check:[{note, doc}]}) → Promise<boolean>, onProgress(state), random?}
// confirm gets up to 5 random notes of the plan with their converted form, so the person compares old and new side by side BEFORE anything
// is written (the backup text is not readable from the screen, so this is where the comparison happens).
// → {status:'done'|'stopped'|'refused'|'cancelled', done, skipped:[{id,title,reason,detail}], already, total, converted:[{id,title}], message}
export async function runNoteConvert(deps) {
  const {api, workspace, md, confirm = () => true, onProgress = () => {}} = deps;
  const refuse = message => ({status: 'refused', done: 0, skipped: [], already: 0, total: 0, converted: [], message});
  const ws = workspace();
  if (!ws) return refuse(CONVERT_TEXT.listFailed);
  // 1) 백업이 있어야 시작한다(표가 없으면 404/400 → 시작하지 않음).
  let backups;
  try { backups = await pages(api, `/rest/v1/app_ed3_text_backups?workspace_id=eq.${enc(ws)}&source=eq.note&select=row_id,row_updated_at&order=row_id.asc`); }
  catch (error) { return refuse(error?.status === 404 || error?.status === 400 ? CONVERT_TEXT.noBackup : CONVERT_TEXT.backupFailed); }
  if (!backups.length) return refuse(CONVERT_TEXT.noBackup);
  // 2) 지금 노트를 새로 읽는다(doc 칸 포함).
  let notes;
  try { notes = await pages(api, `/rest/v1/app_notes?workspace_id=eq.${enc(ws)}&kind=eq.note&select=id,title,raw_text,metadata,updated_at,doc&order=id.asc`); }
  catch { return refuse(CONVERT_TEXT.listFailed); }
  const plan = buildConvertPlan(notes, backups);
  const skipped = [...plan.changed.map(n => ({id: n.id, title: n.title, reason: 'changed'})), ...plan.noBackup.map(n => ({id: n.id, title: n.title, reason: 'no_backup'}))];
  const base = {done: 0, skipped, already: plan.already, total: plan.total, converted: []};
  if (!plan.todo.length) return {...base, status: 'done', message: plan.already ? '' : CONVERT_TEXT.nothing};
  const check = sample(plan.todo, 5, deps.random).map(note => ({note, result: convertNote(md, note)}));
  if (!(await confirm({count: plan.todo.length, check}))) return {...base, status: 'cancelled', message: ''};
  const state = {...base, index: 0, todo: plan.todo.length};
  onProgress({...state});
  for (const note of plan.todo) {
    state.index++;
    const result = convertNote(md, note);
    if (!result.ok) { skipped.push({id: note.id, title: note.title, reason: result.reason, detail: result.detail}); onProgress({...state}); continue; }
    const guard = `workspace_id=eq.${enc(ws)}&kind=eq.note&doc=is.null&updated_at=eq.${enc(note.updated_at)}`;
    try {
      const saved = await api(`/rest/v1/app_notes?id=eq.${enc(note.id)}&${guard}&select=id`, {method: 'PATCH', prefer: 'return=representation', body: {doc: result.doc, raw_text: result.text}});
      if (Array.isArray(saved) && saved.length === 1) { state.done++; state.converted.push({id: note.id, title: note.title}); }
      else skipped.push({id: note.id, title: note.title, reason: 'moved'});
    } catch (error) {
      skipped.push({id: note.id, title: note.title, reason: 'failed', detail: error?.status ? String(error.status) : ''});
      // A lost login or a server refusal stops the run: the rest are left as they are, and pressing again picks them up.
      if (error?.status === 401 || error?.status === 403 || error?.code === 'session_required') {
        onProgress({...state});
        return {...state, status: 'stopped', message: '로그인이 끊겨 멈췄어요. 다시 로그인한 뒤 누르면 남은 것만 바꿉니다.'};
      }
    }
    onProgress({...state});
  }
  return {...state, status: 'done', message: ''};
}

// The side-by-side check before anything is written: up to 5 random notes, the old letters next to the new look (ed-render).
// A native <dialog> (Esc and [취소] cancel). Resolves true only on [바꾸기 시작].
function ensureDocStyle() {
  const have = [...document.querySelectorAll('link[rel="stylesheet"]')].some(l => (l.getAttribute('href') || '').split('?')[0].endsWith('ed-doc.css'));
  if (have) return;
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = './ed-doc.css'; link.dataset.kptuViewStyle = '1'; document.head.append(link);
}
export async function confirmWithCheck({count, check}, {reasonText}) {
  const {renderDoc} = await import('./ed-render.mjs');
  ensureDocStyle();
  const dialog = document.createElement('dialog');
  dialog.className = 'note-convert-dialog'; dialog.id = 'noteConvertCheck'; dialog.setAttribute('aria-labelledby', 'noteConvertCheckTitle');
  const head = document.createElement('h3'); head.id = 'noteConvertCheckTitle'; head.textContent = `옛 마크다운 노트 ${count}개 바꾸기 — 미리 대조 ${check.length}개`;
  const help = document.createElement('p'); help.className = 'note-convert-help';
  help.textContent = '무작위로 고른 노트의 원문(왼쪽·위)과 바꾼 모양(오른쪽·아래)입니다. 글이 빠지거나 모양이 틀리면 [취소]를 누르고 알려 주세요. 아직 아무것도 저장하지 않았어요.';
  const list = document.createElement('div'); list.className = 'note-convert-list';
  for (const {note, result} of check) {
    const item = document.createElement('section'); item.className = 'note-convert-item';
    const name = document.createElement('h4'); name.textContent = note.title || '제목 없음';
    const old = document.createElement('pre'); old.className = 'note-convert-old'; old.textContent = note.raw_text || '';
    const now = result.ok ? renderDoc(result.doc) : Object.assign(document.createElement('p'), {className: 'note-convert-skip', textContent: '바꾸지 않음: ' + reasonText(result.reason, result.detail)});
    now.classList.add('note-convert-new');
    const pair = document.createElement('div'); pair.className = 'note-convert-pair'; pair.append(old, now);
    item.append(name, pair); list.append(item);
  }
  const actions = document.createElement('div'); actions.className = 'note-convert-actions';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '취소'; cancel.dataset.noteConvertCancel = '';
  const go = document.createElement('button'); go.type = 'button'; go.className = 'primary'; go.textContent = `바꾸기 시작 (${count}개)`; go.dataset.noteConvertStart = '';
  actions.append(cancel, go);
  dialog.append(head, help, list, actions);
  document.body.append(dialog);
  return new Promise(resolve => {
    let answer = false;
    cancel.onclick = () => dialog.close();
    go.onclick = () => { answer = true; dialog.close(); };
    dialog.addEventListener('close', () => { dialog.remove(); resolve(answer); }, {once: true});
    dialog.showModal(); cancel.focus();
  });
}
