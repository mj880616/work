// NOTE-주소로 가져오기 2단계(화면, 설계 docs/design/note-import-by-url.md 2절·9절). 'UX-먼저묻고뒤에처리'(docs/design-decisions.md)를 따른다:
//   ① [가져오기]를 누르면 '주소만' 든 노트를 바로 만든다(기존 노트 저장 길 createNoteDoc — 새 저장 길 없음). 노트 줄이 목록에 바로 생긴다.
//   ② 글 읽기는 뒤에서 한다: 서버 입구(Edge note-import, 읽기 전용)에 {url} 하나만 보낸다(작업공간·사용자 값은 보내지 않는다 — 서버가 정한다).
//      일은 그 노트 id로 하므로 창을 닫거나 다른 화면으로 옮겨도 끝까지 한다. 처리 중에 또 누르면 거절하지 않고 줄 세운다(한 번에 하나).
//   ③ 끝나면 제목·본문·원문 정보를 한 번에 넣고(saveImportedNote), 실패하면 노트는 '주소만' 남기고 이유만 적는다(setNoteSource).
//      끝·실패는 공용 작은 알림(small-notice.js). 멈추는 것은 로그인이 바뀔 때뿐이다.
// 지키는 것: 서버가 준 글은 글자로만 넣는다(note-import-model.mjs blocksToDoc — HTML로 넣지 않음). 가져온 글을 AI·공유·발송으로 잇지 않는다
// (AI 요약 제목을 부르지 않고, 노트는 AI 재료에서 뺀 채 만든다 ai_export_allowed=false). 기기에 아무것도 저장하지 않는다(메모리뿐).
import {createNoteDoc, saveImportedNote, setNoteSource} from './basket-data.js';
import {notify} from './small-notice.js';
import {requestNoteDocOpen} from './basket-note-tasks.js';
import {readImportUrl, safeHttps, makeSource, noteSource, isUrlOnly, urlOnlyDoc, urlOnlyTitle, importedNote, failInfo, requestFailReason, resultOutcome, doneText, createImportQueue} from './note-import-model.mjs';

const FN = '/functions/v1/note-import';
// 서버의 가져오기 한 번 전체 상한이 25초라(설계 9절 '상한') 그보다 조금 길게 기다린다.
const REQUEST_TIMEOUT_MS = 40000;
export const NOTE_IMPORT_EVENT = 'kptu:note-import';

// 이번 접속에서 끝난 일의 이유(서버에 표시를 남기지 못했을 때도 화면이 알맞은 안내를 고르게). 메모리뿐.
const lastFail = new Map();
let queue = null;

const emit = (id, phase, extra = {}) => { try { globalThis.window?.dispatchEvent?.(new CustomEvent(NOTE_IMPORT_EVENT, {detail: {id, phase, ...extra}})); } catch { /* 듣는 화면이 일을 막지 않는다 */ } };
const sameUser = job => job.rt.session.read()?.user?.id === job.owner;

// 실패: 노트는 그대로('주소만') 두고 원문 정보에 이유만 적는다. 적지 못해도(연결 끊김·로그인 만료) 노트는 남고, 다음에 열면 [다시 시도]가 보인다.
async function markFailed(job, reason, result = null) {
  lastFail.set(job.id, reason);
  // 다른 기기·탭이 그사이 글을 넣었으면(이미 ok) 실패로 되돌리지 않는다.
  let already = false;
  const change = old => {
    if (old?.state === 'ok') { already = true; return null; }
    return makeSource({...(old || {}), url: old?.url || job.url, site: old?.site || result?.site, state: 'failed', reason, fetched_at: new Date().toISOString(), kept: false});
  };
  for (let i = 0; i < 2; i++) {
    if (!sameUser(job)) break;
    try { await setNoteSource({id: job.id}, change, job.rt); break; }
    catch (error) { if (error?.code !== 'note_changed') break; } // 그사이 다른 metadata 쓰기(고정·폴더)와 겹쳤으면 한 번 더
  }
  if (already) { lastFail.delete(job.id); return {state: 'ok', reason: null, quiet: true}; }
  return {state: 'failed', reason};
}

async function runJob(job) {
  if (!sameUser(job)) return {state: 'skipped'};
  let result;
  try { result = await job.rt.api(FN, {method: 'POST', body: {url: job.url}, singleFlight: false, timeoutMs: REQUEST_TIMEOUT_MS}); }
  catch (error) {
    const reason = requestFailReason(error);
    // 로그인이 풀렸으면 서버에 실패 표시를 남길 수 없다: 알리기만 한다(노트는 '주소만' 남아 있고, 다시 로그인해 열면 [다시 시도]가 보인다).
    if (reason === 'login' && !job.rt.session.read()?.user?.id) { lastFail.set(job.id, 'login'); return {state: 'failed', reason: 'login'}; }
    return sameUser(job) ? markFailed(job, reason) : {state: 'skipped'};
  }
  if (!sameUser(job)) return {state: 'skipped'};
  const outcome = resultOutcome(result);
  if (outcome.state !== 'ok') return markFailed(job, outcome.reason, result);
  const made = importedNote(result, job.url);
  if (!made) return markFailed(job, 'no_body', result);
  const source = makeSource({url: safeHttps(result.url) || job.url, site: result.site, author: result.author, published_at: result.published_at,
    fetched_at: new Date().toISOString(), state: 'ok', reason: outcome.reason});
  for (let i = 0; i < 2; i++) {
    try {
      await saveImportedNote(job.id, {title: made.title, raw_text: made.text, doc: made.doc, source, check: row => isUrlOnly(row)}, job.rt);
      lastFail.delete(job.id);
      return {state: 'ok', reason: outcome.reason};
    } catch (error) {
      if (!sameUser(job)) return {state: 'skipped'};
      if (error?.code === 'note_missing') return {state: 'gone'}; // 그사이 노트를 삭제함: 알릴 것 없음
      // 본문이 이미 주소만이 아니다: 다른 기기·탭이 먼저 넣었으면 끝난 것이고, 사람이 수정했으면 덮지 않고 그렇게 알린다.
      if (error?.code === 'note_edited') return noteSource(error.row)?.state === 'ok' ? {state: 'ok', reason: null, quiet: true} : markFailed(job, 'changed', result);
      if (error?.code !== 'note_changed' || i) return markFailed(job, requestFailReason(error), result);
    }
  }
  return markFailed(job, 'busy', result);
}

function report(event) {
  const {job} = event;
  if (event.type === 'start') { emit(job.id, 'start'); return; }
  if (event.type !== 'done') return;
  const outcome = event.outcome || {state: 'failed', reason: 'busy'};
  if (outcome.state === 'skipped' || outcome.state === 'gone') { emit(job.id, 'gone'); return; }
  emit(job.id, outcome.state === 'ok' ? 'done' : 'failed', {reason: outcome.reason || null});
  // 다른 사람으로 바뀐 화면에는 알리지 않는다(로그인이 풀린 경우의 안내만 예외).
  if (outcome.quiet || (!sameUser(job) && !(outcome.reason === 'login' && !job.rt.session.read()?.user?.id))) return;
  // 노트 화면이 아니면 알림에 [보기]를 붙인다(노트 화면이면 그 줄이 이미 바뀌어 있다).
  const router = globalThis.window?.KPTURouter;
  const actions = router?.current && router.current !== 'basket' ? [{label: '보기', run: ({close}) => { close(); requestNoteDocOpen(job.id, job.rt); router.go('basket', {source: 'delegated'}); }}] : [];
  if (outcome.state === 'ok') notify(doneText(outcome.reason), {actions, record: false});
  else notify(failInfo(outcome.reason).text, {actions, record: false, ms: 5000});
}

function enqueue(job) {
  queue ||= createImportQueue({run: runJob, report});
  return queue.add(job);
}
// 로그인이 바뀌면 이번 접속의 기억을 비운다(줄에 선 일은 runJob이 스스로 건너뛴다).
globalThis.window?.addEventListener?.('kptu:session-changed', () => lastFail.clear());

// 지금 이 접속에서 그 노트를 가져오는 중인가(줄에 서 있거나 읽는 중).
export const isImporting = id => !!queue?.has(id);
// 이번 접속에서 그 노트가 마지막으로 실패한 이유(없으면 null).
export const importFailReason = id => lastFail.get(id) || null;
// 줄이 다 끝날 때(시험용).
export const importsIdle = () => queue?.idle() || Promise.resolve();

// [가져오기]: 주소를 확인하고 '주소만' 노트를 바로 만든 뒤 줄에 세운다. folder(선택) = 처음부터 넣을 폴더 {id, name}.
// 반환: 만든 노트 행. 주소가 맞지 않거나 노트를 만들지 못하면 던진다(message는 화면 글자).
export async function startNoteImport({url, folder = null, rt = globalThis.window?.KPTURuntime} = {}) {
  const checked = readImportUrl(url);
  if (!checked.ok) throw Object.assign(new Error(checked.message), {code: 'bad_url'});
  const owner = rt.session.read()?.user?.id;
  if (!owner) throw new Error('로그인 정보가 바뀌었어요. 다시 열어 주세요.');
  const note = await createNoteDoc({title: urlOnlyTitle(checked.url), raw_text: checked.url, markdown: false, doc: urlOnlyDoc(checked.url),
    ai_export_allowed: false, folder: folder?.id ? folder : undefined, source: makeSource({url: checked.url, state: 'fetching'})}, rt);
  lastFail.delete(note.id);
  enqueue({id: note.id, url: checked.url, rt, owner});
  emit(note.id, 'created');
  return note;
}
// [다시 시도]: 같은 노트를 다시 줄에 세운다(노트를 새로 만들지 않는다). 이미 가져오는 중이면 그대로 둔다.
export async function retryNoteImport(note, {rt = globalThis.window?.KPTURuntime} = {}) {
  const source = noteSource(note);
  if (!note?.id || !source) return false;
  if (isImporting(note.id)) return true;
  const owner = rt.session.read()?.user?.id;
  if (!owner) return false;
  lastFail.delete(note.id);
  enqueue({id: note.id, url: source.url, rt, owner});
  emit(note.id, 'queued');
  return true;
}
// [주소만 두기]: 안내 줄을 거둔다(노트·주소는 그대로). 표시는 서버(metadata.source.kept)에 남긴다.
export async function keepUrlOnly(note, {rt = globalThis.window?.KPTURuntime} = {}) {
  const source = noteSource(note);
  if (!note?.id || !source) return null;
  const reason = importFailReason(note.id) || source.reason || 'stopped';
  const saved = await setNoteSource({id: note.id}, old => {
    const now = old || source;
    if (now.state === 'ok') return null; // 그사이 글이 들어왔다: 거둘 안내가 없다
    return makeSource({...now, state: 'failed', reason: now.state === 'failed' && now.reason ? now.reason : reason, kept: true});
  }, rt);
  lastFail.delete(note.id);
  emit(note.id, 'kept');
  return saved;
}
