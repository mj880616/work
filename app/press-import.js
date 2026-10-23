// PRESS-자료실편입 2단계(docs/design/press-into-library.md §3.2-5): 자료실의 1회용 [옛 성명·보도자료 가져오기].
// - 목록은 같은 사이트 ../press/archive.json, 본문·첨부는 성명 메뉴(web1-press.js)와 같은 GitHub raw에서 받는다.
// - 올리기는 자료실 올리기와 같은 library-files 요청(upload, library-upload.js가 넘김)으로 한 건씩. 제목·날짜·발행·종류·꼬리표를
//   넘기므로 서버의 AI 제목 추정이 돌지 않고, 화면도 AI 채우기를 부르지 않는다.
// - 올린 뒤 제목·종류·발행·날짜 4칸을 'user'로 잠근다(수정 창 저장과 같은 owner REST PATCH, originAfterEdit). 연결(프로젝트·담당조직)은 열어 둔다(결정 Q4).
// - file_name으로 겹침을 판정한다. 이미 있으면 건너뛰고, 다시 눌러도 빠진 것만 올린다.
// - 새 서버 기능·새 저장소·브라우저 저장소 없음. 실제 실행(운영 자료 48행 추가)은 명진이 단추를 눌러야만 일어난다.
// 이 파일은 1회용이다. Contract PR(§5)에서 단추와 함께 지운다.
import {PRESS_CATEGORY, LOCK_FIELDS, PRESS_CSS_PATH, LOGO_PATH, buildPlan, rawUrl, splitByExisting, needsLock, transformPressHtml} from './press-import-model.mjs';
import {documentCategories, loadDocumentCategories, documentCategoriesLoaded} from './document-categories.js';
import {originAfterEdit} from './library-ai-fill.js';

export const PRESS_IMPORT_TEXT = Object.freeze({
  button: '옛 성명·보도자료 가져오기',
  noCategory: `종류 목록에 '${PRESS_CATEGORY}'가 없어 시작하지 않았어요. 자료 분류 칩 옆 [편집]에서 먼저 추가해 주세요.`,
  categoryUnknown: '종류 목록을 읽지 못해 시작하지 않았어요. 잠시 뒤 다시 눌러 주세요.',
  archiveFailed: '성명·보도자료 목록을 받지 못해 시작하지 않았어요.',
  listFailed: '자료실 목록을 읽지 못해 시작하지 않았어요.',
  sourceFailed: '원본 양식(스타일·로고)을 받지 못해 시작하지 않았어요.',
});

const enc = encodeURIComponent;

async function fetchOk(fetcher, url, as) {
  const r = await fetcher(url, {cache: 'no-store'});
  if (!r?.ok) throw new Error(`받지 못함 ${r?.status || 0}`);
  return as === 'blob' ? r.blob() : as === 'json' ? r.json() : r.text();
}

// deps: {api(path,options), upload(formData,file) → {document}, failure(err) → {stop,message}, workspace(), role(),
//        fetcher?, archiveUrl?, rt?, onProgress(state)}. 결과 {status:'done'|'stopped'|'refused', done, skipped, locked, failed:[{name,message}], total, message}
export async function runPressImport(deps) {
  const {api, upload, failure = () => ({stop: false, message: ''}), workspace, fetcher = fetch, onProgress = () => {}, rt = globalThis.window?.KPTURuntime} = deps;
  const archiveUrl = deps.archiveUrl || new URL('../press/archive.json', location.href).href;
  const refuse = message => ({status: 'refused', done: 0, skipped: 0, locked: 0, failed: [], total: 0, message});
  // 1) 내 종류 목록에 '성명·보도자료'가 있어야 시작한다(없으면 저장 값이 '기타'로 보이고 AI 정리 대상이 됨).
  await loadDocumentCategories({rt, force: true});
  if (!documentCategoriesLoaded()) return refuse(PRESS_IMPORT_TEXT.categoryUnknown);
  if (!documentCategories().includes(PRESS_CATEGORY)) return refuse(PRESS_IMPORT_TEXT.noCategory);
  const ws = workspace();
  if (!ws) return refuse(PRESS_IMPORT_TEXT.listFailed);
  // 2) 목록과 지금 자료실(파일 이름)을 새로 읽는다.
  let archive, docs;
  try { archive = await fetchOk(fetcher, archiveUrl, 'json'); } catch { return refuse(PRESS_IMPORT_TEXT.archiveFailed); }
  try { docs = await api(`/rest/v1/app_documents?workspace_id=eq.${enc(ws)}&select=id,file_name,category,field_origin,classification_note`); } catch { return refuse(PRESS_IMPORT_TEXT.listFailed); }
  if (!Array.isArray(docs)) return refuse(PRESS_IMPORT_TEXT.listFailed);
  const {plan, errors} = buildPlan(archive);
  const {todo, skipped} = splitByExisting(plan, docs);
  const state = {total: plan.length, index: 0, done: 0, skipped: skipped.length, locked: 0, failed: errors.map(name => ({name, message: '목록 줄 모양이 맞지 않음'}))};
  onProgress({...state});
  // 3) 원본 양식(스타일·로고)은 본문을 올릴 때만 한 번 받는다.
  let css = '', logoSvg = '';
  if (todo.some(row => row.kind === 'page')) {
    try { [css, logoSvg] = await Promise.all([fetchOk(fetcher, rawUrl(PRESS_CSS_PATH)), fetchOk(fetcher, rawUrl(LOGO_PATH))]); }
    catch { return {...refuse(PRESS_IMPORT_TEXT.sourceFailed), skipped: skipped.length, total: plan.length}; }
  }
  const lock = async doc => {
    const origin = originAfterEdit(doc, LOCK_FIELDS);
    if (!origin) return false; // field_origin 칸이 아직 없는 DB: 잠글 칸이 없다.
    await api(`/rest/v1/app_documents?id=eq.${enc(doc.id)}&workspace_id=eq.${enc(ws)}`, {method: 'PATCH', prefer: 'return=minimal', body: {field_origin: origin, auto_classified: false, updated_at: new Date().toISOString()}});
    return true;
  };
  let stopped = null;
  for (const row of todo) {
    state.index++;
    onProgress({...state, current: row.fileName});
    let file;
    try {
      if (row.kind === 'page') {
        const {html} = transformPressHtml(await fetchOk(fetcher, rawUrl(row.path)), {css, logoSvg});
        file = new File([html], row.fileName, {type: 'text/html'});
      } else {
        file = new File([await fetchOk(fetcher, rawUrl(row.path), 'blob')], row.fileName, {type: row.mime});
      }
    } catch (e) { state.failed.push({name: row.fileName, message: '원본을 받지 못함'}); continue; }
    const fd = new FormData();
    fd.append('file', file);
    fd.append('title', row.fields.title);
    fd.append('category', row.fields.category);
    if (row.fields.source) fd.append('source', row.fields.source);
    fd.append('document_date', row.fields.document_date);
    if (row.fields.tags.length) fd.append('tags', row.fields.tags.join(','));
    let doc;
    try {
      const d = await upload(fd, file);
      if (d?.error || !d?.document?.id) throw new Error(d?.error || '응답을 확인하지 못함');
      doc = d.document;
    } catch (e) {
      const f = failure(e) || {};
      state.failed.push({name: row.fileName, message: f.message || e?.message || '올리지 못함'});
      if (f.stop) { stopped = f.message || '멈춤'; break; }
      continue;
    }
    state.done++;
    try { if (await lock(doc)) state.locked++; } catch { state.failed.push({name: row.fileName, message: '올렸지만 잠그지 못함(다시 누르면 잠금)'}); }
    onProgress({...state});
  }
  // 4) 이전에 올렸지만 잠금이 빠진 가져온 자료(같은 file_name·같은 종류)는 다시 잠근다.
  if (!stopped) {
    const byName = new Map(docs.map(d => [String(d?.file_name || ''), d]));
    for (const row of skipped) {
      const doc = byName.get(row.fileName);
      if (doc?.category !== PRESS_CATEGORY || !needsLock(doc)) continue;
      try { if (await lock(doc)) state.locked++; } catch { state.failed.push({name: row.fileName, message: '잠그지 못함'}); }
    }
  }
  const result = {status: stopped ? 'stopped' : 'done', done: state.done, skipped: state.skipped, locked: state.locked, failed: state.failed, total: state.total, message: stopped || ''};
  onProgress({...state, finished: true});
  return result;
}

export function progressText(s) {
  if (s.finished) return `가져옴 ${s.done} · 건너뜀 ${s.skipped} · 실패 ${s.failed.length} (전체 ${s.total})`;
  return `가져오는 중 ${Math.min(s.skipped + s.index, s.total)}/${s.total} · 건너뜀 ${s.skipped}`;
}
export const resultText = r => r.status === 'refused' ? r.message
  : `${r.status === 'stopped' ? '멈춤: ' + r.message + ' · ' : ''}가져옴 ${r.done} · 건너뜀 ${r.skipped} · 실패 ${r.failed.length} (전체 ${r.total})`;
