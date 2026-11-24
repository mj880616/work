// S69-45 LIB-같은내용정리: 화면 글·나눠 보내기 규칙(DOM·네트워크 없음). 시험: tests/library-same-content-model.test.mjs.
// 서버(library-files same-content-scan·apply·undo, same-content.mjs)가 준 묶음·숫자만 쓴다.
export const SAME_LABEL = '같은 내용 자료 정리';
export const APPLY_MAX = 300; // 서버 한 번 한도(same-content.mjs APPLY_MAX)와 같다
export const SAME_WAIT_MS = 90000;
const n = v => Number(v) || 0;

// 미리 보기 머리 한 줄.
export function previewLine(r) {
  const t = r?.totals || {};
  if (!n(t.groups)) return '같은 내용 자료 없음';
  const parts = [`같은 내용 묶음 ${n(t.groups)}개`, `휴지통으로 ${n(t.trash)}개`];
  if (n(t.skipped)) parts.push(`건너뜀 ${n(t.skipped)}묶음(기록 연결을 옮길 수 없음)`);
  return parts.join(' · ');
}
export function previewNote(r) {
  return [r?.more ? '묶음이 많아 앞쪽만 보여요(정리한 뒤 다시 열면 나머지)' : '', r?.partial ? '자료가 많아 일부만 견줬어요(정리한 뒤 다시 열면 나머지)' : ''].filter(Boolean).join(' · ');
}

// 정리할 묶음(건너뜀 빼고) → 서버에 보낼 묶음 목록, 한 번에 APPLY_MAX 자료까지.
export function applyBatches(groups, max = APPLY_MAX) {
  const out = [];
  let cur = [], size = 0;
  for (const g of Array.isArray(groups) ? groups : []) {
    if (g?.skip || !g?.keep?.id || !Array.isArray(g.drop) || !g.drop.length) continue;
    const one = { keep: g.keep.id, drop: g.drop.map(d => d.id) }, k = 1 + one.drop.length;
    if (k > max) continue;
    if (size + k > max) { out.push(cur); cur = []; size = 0; }
    cur.push(one); size += k;
  }
  if (cur.length) out.push(cur);
  return out;
}

// 결과 한 줄 '휴지통 N · 건너뜀 M'.
export function resultLine({ trashed = 0, skipped = 0, stopped = false } = {}) {
  return `휴지통 ${n(trashed)} · 건너뜀 ${n(skipped)}` + (stopped ? ' · 중간에 멈췄어요 — 다시 열면 남은 것만 보여요' : '');
}
export const undoLine = ({ restored = 0, missed = 0 } = {}) => `되돌렸어요 · ${n(restored)}개를 원래 폴더로` + (n(missed) ? ` · ${n(missed)}개는 그 사이 옮겨져 그대로 두었어요` : '');
