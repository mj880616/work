// WEEKLY-요약표수기(S49-39, 요청함 11/04 16:38 · 명진 16:45 "아예 지우자"): 1) 요약 표('진행 상황 및 이후 계획'·'담당')를 명진이 직접 쓰는 값의 순수 규칙 한 곳.
// - 진행 칸 = 홈 [주간 정리] 1) 요약의 같은 칸(그 주 임시저장 draft.rows 의 'summary' 칸). 따로 저장 자리를 만들지 않는다 — 한 곳에 쓰면 두 곳에 같게 보인다.
// - 담당 칸 = draft.owners {칸 이름 → 한 줄}. 홈 [주간 정리]에는 담당 칸이 없고, 사업요약표 미리보기와 한글 파일 요약 표 담당 칸에만 쓰인다.
// 칸 이름(summaryKey) = '사업영역›세부 과제' (weekly-draft-store.js). 사업영역만 있는 줄은 '사업영역›'.
// 글은 로그에 쓰지 않는다. AI를 부르지 않는다.
import {nameKey, sameName} from './weekly-cell-names.mjs';
export const OWNER_MAX = 60; // 담당 한 칸 글자 수(한글 파일 담당 칸은 이름 몇 개)
export const OWNERS_COUNT_MAX = 200;

const oneLine = s => String(s ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
// 이름 비교는 띄어쓰기·부호 모양을 무시(S52-24: weekly-cell-names.mjs nameKey 한 곳 — weekly-hwpx/draft.mjs norm 과 같은 규칙).
export const norm = s => nameKey(s);

// 미리보기 표의 한 줄(사업영역 이름·세부 과제 이름) → 그 주 draft 의 summary 칸 이름.
// weekly-hwpx/draft.mjs weekMaterial 과 같은 규칙: 사업영역·세부 과제가 맞는 칸 → 없으면(세부 과제가 있을 때) 그 사업영역의 세부 과제 없는 칸 → 없으면 새 이름.
// keys: 지금 draft 에 있는 summary 칸 이름 목록('사업영역›세부 과제').
export function summaryCellKey(keys, area, task) {
  const a = oneLine(area), t = oneLine(task);
  const split = k => { const i = String(k).indexOf('›'); return i < 0 ? [String(k), ''] : [String(k).slice(0, i), String(k).slice(i + 1)]; };
  const list = (keys ?? []).map(k => ({k, p:split(k)}));
  const exact = list.find(x => norm(x.p[0]) === norm(a) && (t ? norm(x.p[1]) === norm(t) : !norm(x.p[1])));
  if (exact) return exact.k;
  const blank = t ? list.find(x => norm(x.p[0]) === norm(a) && !norm(x.p[1])) : null;
  if (blank) return blank.k;
  // S52-24: 사업영역만 있는 줄은 세부 과제 이름이 그 사업영역 이름인 칸(예: '의제 › 주제/A')이 그 주제 칸이다.
  const topic = !t ? list.find(x => sameName(x.p[1], a)) : null;
  return topic ? topic.k : `${a}›${t}`;
}

// ---- 담당(owners) ----
// 읽기: {칸 이름: 한 줄} 모양만(틀린 것은 버림).
export function readOwners(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (Object.keys(out).length >= OWNERS_COUNT_MAX) break;
    const k = oneLine(key), text = oneLine(value);
    if (!k || !k.includes('›') || !text || [...text].length > OWNER_MAX) continue;
    out[k] = text;
  }
  return out;
}
