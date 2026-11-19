// ORG-기록첨부 옛줄바꾸기(S67-13, 명진 11/19 결정 '나'): [옛 사진 기록 채우기](조직 관리 ⋯)와 기록 줄 ⋯ [이전 줄로 되돌리기].
// - 대상: 사진·파일만 놓은 기록 가운데 줄이 화면이 대신 만든 '그림 N장 · 이름' 꼴인 것만(판정은 record-line-backfill.mjs 한 곳).
//   같은 대신 줄을 쓰는 곳 전수: 조직 기록 줄·사업(프로젝트) 기록 줄(app_record_links.summary)과 같은 저장에서 들어간
//   사업 기록 한 줄(app_business_records source_kind 'update' — update-places.js addBusinessRecord). 그 밖에는 대신 줄을 쓰지 않는다.
// - 바꾸기: 그 기록 사진의 설명('b1:')이 있으면 첫 줄로, 없으면 서버(library-files photo-brief — 한 번 4장·하루 30장·AI 한도)가 읽어
//   만든 뒤 바꾼다. 쓰는 길은 이미 있는 것만: 연결 줄은 app_basket_update_link_summary(읽은 옛 줄과 같을 때만 씀), 사업 기록은
//   owner RLS PATCH(body가 읽은 옛 줄과 같을 때만). 내 로그인으로 내 기록만 바꾼다(SQL·service_role 일괄 변경 없음).
// - 되돌리기: 옛 줄은 첨부만으로 똑같이 다시 만들어지므로 따로 보관하지 않는다(record-line-backfill.mjs).
// - 자동으로 돌지 않는다: 누른 사람이 개수를 보고 [바꾸기]를 눌러야 시작. 진행은 작은 알림 한 줄. 기기 저장 없음, 로그에 글 없음.
import { readRecordPages, updateLinkSummary } from './basket-link-records.js';
import { readFileBriefs } from './record-line-briefs.js';
import { requestPhotoBriefs, PHOTO_BRIEF_BATCH } from './photo-brief-request.js';
import { recordBody } from './business-now-model.mjs';
import { backfillTargets, backfilledLine, picturesWithoutBrief, progressText, finishText } from './record-line-backfill.mjs';

const enc = encodeURIComponent;
const UUID = /^[0-9a-f-]{36}$/i;
const RECS = '/rest/v1/app_business_records';
const ctxOf = rt => (typeof rt?.context?.read === 'function' ? rt.context.read() || {} : globalThis.window?.__KPTU_BOOT_CONTEXT__ || {});
const scopeOf = rt => { const c = ctxOf(rt); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
const LIKE = `(summary.like.${enc('그림*')},summary.like.${enc('파일*')})`;
const BODY_LIKE = `(body.like.${enc('그림*')},body.like.${enc('파일*')})`;
// 한 번에 0장 읽힌 묶음이 이만큼 이어지면 멈춘다(하루 상한·AI 한도·읽기 실패).
export const EMPTY_BATCH_STOP = 3;

// 대상 찾기: {links:[{kind:'link', id, line, note_id, attachments}], biz:[{kind:'biz', id, line, note_id, attachments}]}.
export async function findBackfill(rt = globalThis.window?.KPTURuntime) {
  const ws = ctxOf(rt)?.workspace?.id, owner = scopeOf(rt);
  if (!ws || !rt?.api) throw new Error('scope');
  const linkRows = await readRecordPages(`/rest/v1/app_record_links?workspace_id=eq.${enc(ws)}&note.workspace_id=eq.${enc(ws)}&note.kind=eq.basket&status=eq.confirmed&note_id=not.is.null&or=${LIKE}&select=id,workspace_id,summary,note_id,organization_id,project_id,note:app_notes!inner(id,workspace_id,attachments)&order=id.asc`, rt);
  const links = backfillTargets(linkRows.filter(r => r?.workspace_id === ws && r.note?.workspace_id === ws && r.note?.id === r.note_id && (r.organization_id || r.project_id))
    .map(r => ({ kind: 'link', id: r.id, line: r.summary, note_id: r.note_id, attachments: r.note.attachments })));
  let biz = [];
  try {
    const bizRows = (await readRecordPages(`${RECS}?workspace_id=eq.${enc(ws)}&source_kind=eq.update&or=${BODY_LIKE}&select=id,workspace_id,body,source_id&order=id.asc`, rt))
      .filter(r => r?.workspace_id === ws && UUID.test(String(r.source_id || '')));
    const noteIds = [...new Set(bizRows.map(r => r.source_id))], notes = new Map();
    for (let i = 0; i < noteIds.length; i += 50) {
      const part = noteIds.slice(i, i + 50);
      const rows = await rt.api(`/rest/v1/app_notes?workspace_id=eq.${enc(ws)}&kind=eq.basket&id=in.(${part.map(enc).join(',')})&select=id,workspace_id,attachments&limit=${part.length + 1}`);
      if (!Array.isArray(rows)) throw new Error('read');
      for (const n of rows) if (n?.workspace_id === ws && part.includes(n.id)) notes.set(n.id, n.attachments);
    }
    biz = backfillTargets(bizRows.filter(r => notes.has(r.source_id)).map(r => ({ kind: 'biz', id: r.id, line: r.body, note_id: r.source_id, attachments: notes.get(r.source_id) })));
  } catch (e) { if (owner !== scopeOf(rt)) throw e; biz = []; /* 사업 기록 표를 못 읽으면 연결 줄만 */ }
  if (owner !== scopeOf(rt)) throw new Error('scope');
  return { links, biz };
}

// 한 줄 쓰기(읽은 옛 줄과 같을 때만). 결과 true/false.
async function writeLine(item, next, rt) {
  if (item.kind === 'link') return (await updateLinkSummary(item.id, item.line, next, rt).catch(() => null))?.ok === true;
  const ws = ctxOf(rt)?.workspace?.id, body = recordBody(next);
  if (!ws || !body) return false;
  try {
    const rows = await rt.api(`${RECS}?id=eq.${enc(item.id)}&workspace_id=eq.${enc(ws)}&body=eq.${enc(item.line)}&select=id`, { method: 'PATCH', prefer: 'return=representation', singleFlight: false, body: { body } });
    return Array.isArray(rows) && rows.length === 1;
  } catch { return false; }
}
export const announce = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('kptu:basket-links-changed'));
  window.dispatchEvent(new CustomEvent('kptu:business-now-changed', { detail: { records: true } }));
};

// 바꾸기. deps는 시험용(ask = 사진 설명 요청, read = 설명 읽기, write = 줄 쓰기).
export async function runBackfill(found, rt = globalThis.window?.KPTURuntime, { onProgress = () => {}, ask = requestPhotoBriefs, read = readFileBriefs, write = writeLine } = {}) {
  const owner = scopeOf(rt), same = () => owner === scopeOf(rt);
  const items = [...(found?.links || []), ...(found?.biz || [])];
  const total = items.length;
  let done = 0, capped = false;
  const left = new Set(items);
  const fileIds = items.flatMap(i => (Array.isArray(i.attachments) ? i.attachments : []).map(f => f?.drive_file_id));
  const pass = async briefs => {
    for (const item of [...left]) {
      if (!same()) return;
      const next = backfilledLine(item.attachments, briefs);
      if (!next) continue;
      left.delete(item);
      if (await write(item, next, rt)) done++;
      onProgress({ done, total });
    }
  };
  if (!total) return { done, total, left: 0, capped };
  let { briefs, docs } = await read(fileIds, rt);
  await pass(briefs);
  // 설명이 없는 사진: 서버가 읽어 만든다(상한 안에서 차례로).
  const queue = [...new Set([...left].flatMap(i => picturesWithoutBrief(i.attachments, briefs)).map(f => docs.get(f)).filter(d => d?.id && !d.indexed).map(d => d.id))];
  let empty = 0;
  while (queue.length && left.size && same()) {
    const batch = queue.splice(0, PHOTO_BRIEF_BATCH);
    onProgress({ done, total, reading: true });
    const r = await ask(batch, rt);
    if (!same()) break;
    if (!(r?.done > 0)) { if (++empty >= EMPTY_BATCH_STOP) { capped = true; break; } continue; }
    empty = 0;
    ({ briefs, docs } = await read(fileIds, rt));
    await pass(briefs);
  }
  if (done) announce();
  return { done, total, left: total - done, capped: capped || queue.length > 0 };
}

// [이전 줄로 되돌리기]는 record-line-briefs.js revertRecordLine(기록 목록 쪽에서 부름 — 이 파일을 거꾸로 부르면 순환 참조).

// 화면 한 번 누르기: 찾기 → 개수 묻기 → 뒤에서 차례로(진행 한 줄). 한 번에 하나만 돈다.
let running = null;
export async function openRecordBackfill(anchor, rt = globalThis.window?.KPTURuntime) {
  const { notify, askConfirm } = await import('./small-notice.js');
  if (running) { notify('옛 사진 기록을 채우고 있어요. 끝나면 알려 드려요.'); return; }
  let found;
  const looking = notify('옛 사진 기록을 살펴보고 있어요.', { ms: 20000 });
  try { found = await findBackfill(rt); }
  catch { notify('기록을 확인하지 못했어요. 다시 시도해 주세요.', { error: true }); return; }
  looking.close(); // 확인창을 가리지 않게
  const n = found.links.length + found.biz.length;
  if (!n) { notify('파일 이름으로 남은 기록 줄이 없어요.'); return; }
  const ok = await askConfirm(anchor, { text: `파일 이름으로 남은 기록 줄 ${n}개를 사진 설명으로 바꿀까요?`, ok: '바꾸기',
    note: '설명이 없는 사진은 AI가 읽어 만들어요(하루 30장까지). 바꾼 줄은 줄 ⋯ [이전 줄로 되돌리기]로 되돌릴 수 있어요.' });
  if (!ok) return;
  running = runBackfill(found, rt, { onProgress: p => notify(progressText(p), { ms: 60000 }) })
    .then(r => notify(finishText(r), { ms: 10000 }), () => notify('옛 사진 기록 채우기가 멈췄어요. 다시 누르면 이어서 해요.', { error: true }))
    .finally(() => { running = null; });
}
