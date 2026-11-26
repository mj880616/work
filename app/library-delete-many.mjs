// S70 LIB-묶음삭제(사용자 11/24 18:07 "2300개 다 삭제했는데 왜 삭제가 안 되지?"): 자료실 여러 개 삭제 — 순수 규칙(DOM·네트워크 없음).
// 예전에는 자료마다 document-actions 'delete'를 하나씩 차례로 보내 2000개면 한 시간 넘게 걸렸고, 그 사이 화면이 꺼지거나 앱이 닫히면 멈췄다.
// 이제 서버 'delete-many'(한 요청 DELETE_CHUNK개, 서버 안에서 여러 개 함께)로 묶어 보낸다. 시험: tests/library-delete-many.test.mjs.

// 서버(document-actions index.ts LINKED_NOTES)와 같은 표식: [드라이브에서 가져오기]·'드라이브 정리 대기'에서 연결만 한 드라이브 원본.
export const LINKED_NOTES = Object.freeze(['드라이브에서 가져옴', '드라이브 정리 대기에서 등록']);
export const isLinkedOriginal = d => !!d?.file_id && LINKED_NOTES.some(p => String(d?.classification_note || '').startsWith(p));

export const DELETE_CHUNK = 40; // 서버 한 번 한도(DELETE_MANY_MAX 50)보다 작게.

export function chunks(ids, size = DELETE_CHUNK) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

// 묶음마다 send(ids) → 서버 답 {ok, stopped, results:[{id, ok, code?, reason?}]}. 답을 받지 못하면(시간 초과·연결 끊김) 그 묶음은 unknown —
// 서버가 지웠을 수도 있으므로 되살리지 말고 목록을 다시 읽어 확인한다. Drive 연결 문제(stopped)면 남은 묶음은 보내지 않는다.
// 반환: {done, failed, unknown, skipped, preserved, stopped}.
export async function deleteInChunks(ids, send, { isCurrent = () => true, onProgress = null, size = DELETE_CHUNK } = {}) {
  const done = [], failed = [], unknown = [], skipped = [];
  let preserved = 0, stopped = false;
  const parts = chunks(ids, size);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (stopped || !isCurrent()) { skipped.push(...part); continue; }
    let r = null;
    try { r = await send(part); } catch { r = null; }
    const rows = Array.isArray(r?.results) ? r.results : null;
    if (!r || r.ok !== true || !rows) { unknown.push(...part); }
    else {
      const seen = new Set();
      for (const x of rows) {
        if (!x || !part.includes(x.id) || seen.has(x.id)) continue;
        seen.add(x.id);
        if (x.ok === true) { done.push(x.id); if (x.reason === 'linked_original' || x.drive_preserved === true) preserved++; }
        else if (x.code === 'SKIPPED') skipped.push(x.id);
        else if (x.code === 'RESULT_UNKNOWN') unknown.push(x.id);
        else failed.push(x.id);
      }
      for (const id of part) if (!seen.has(id)) unknown.push(id);
      if (r.stopped === true) stopped = true;
    }
    onProgress?.({ index: Math.min(ids.length, (i + 1) * size), total: ids.length });
  }
  return { done, failed, unknown, skipped, preserved, stopped };
}

// 삭제 전 확인 창의 설명 한 줄. 연결만 한 원본은 드라이브에 그대로 둔다.
export function confirmNote(docs) {
  const list = Array.isArray(docs) ? docs : [];
  const linked = list.filter(isLinkedOriginal).length, other = list.filter(d => d?.file_id && !isLinkedOriginal(d)).length;
  if (linked && !other) return '드라이브 원본은 그대로 둬요. 자료실 목록에서만 빼요.';
  if (linked) return `드라이브에서 가져온 ${linked}개는 드라이브 원본을 그대로 둬요. 나머지 ${other}개는 드라이브 휴지통으로 가요.`;
  return other ? '드라이브 파일은 휴지통으로 가요(30일 뒤 사라짐).' : '';
}

export const progressText = ({ index, total }) => `삭제하는 중 ${index}/${total}`;

export function resultLine({ done = [], failed = [], unknown = [], skipped = [], preserved = 0 } = {}) {
  const left = failed.length + skipped.length;
  let s = left ? `${done.length}개를 삭제했고 ${left}개는 삭제하지 못했어요.` : `${done.length}개를 삭제했어요.`;
  if (unknown.length) s += ` ${unknown.length}개는 결과를 확인하지 못해 목록을 다시 읽었어요.`;
  return s;
}
export const preservedNote = n => (n > 0 ? `드라이브에서 가져온 ${n}개는 드라이브 원본을 그대로 뒀어요.` : '');
