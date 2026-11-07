// S52-24 WEEKLY-칸합치기(요청함 11/07 19:03): 주간보고 칸 이름·줄 글 맞추기 한 곳(화면·네트워크 없음, AI 안 부름).
// - 칸 이름: 띄어쓰기·부호('/'·'·'·','…)·대소문자만 다른 이름은 같은 이름(nameKey). 사업 목록 사업영역 이름이 이미 있는 칸의
//   사업영역 이름이나 세부 과제 이름(예: '의제 › 주제/A' 칸)과 같으면 그 칸이 그 주제 칸이다 — 새 칸을 만들지 않는다.
// - 이미 둘로 나뉜 칸(전에 사업영역 이름이 달라 보여 뒤에 더해진 '주제·A › —' 칸)은 저장된 값을 고쳐 쓰지 않고, 읽을 때 앞의 같은 주제 칸에
//   묶어 보인다(foldCells). 사람이 그 칸을 다음에 저장하면 한 칸으로 저장된다(weekly-draft-store.js putCellLines).
// - 줄 글: 부호·띄어쓰기만 다른 거의 같은 글은 같은 글(lineIn). 제안을 넣은 뒤·[이미 있음] 뒤 비슷한 제안을 거르는 데 쓴다.
// 쓰는 곳: weekly-draft-store.js(weekCells·placeDraft), weekly-flow-cells.js, weekly-hwpx/draft.mjs(missingAreas·weekMaterial), weekly-summary-hand.mjs.
// 글은 업무 글이므로 로그·오류 보고에 넣지 않는다.
import {squashLine} from './weekly-lines.mjs';

export const nameKey = s => squashLine(s);
export const sameName = (a, b) => { const x = nameKey(a); return !!x && x === nameKey(b); };
// 예전 규칙(띄어쓰기·가운뎃점 모양만 무시). 예전 규칙으로 같은 이름이면 원래 한 표 묶음이라 접지 않는다.
const oldKey = s => String(s ?? '').replace(/\s+/g, '').replace(/[‧·․]/g, '·');

// summary 칸 이름 '사업영역›세부 과제' → [사업영역, 세부 과제].
export const splitSummaryKey = k => { const s = String(k ?? ''), i = s.indexOf('›'); return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)]; };
// 사업영역 이름 name 의 칸이 이미 있나: 칸의 사업영역 이름이나 세부 과제 이름이 같은 이름.
export const areaInKeys = (name, keys) => (keys ?? []).some(k => { const [a, t] = splitSummaryKey(k); return sameName(a, name) || sameName(t, name); });

// 세부 과제가 빈 summary 칸(key)을 묶을 앞의 같은 주제 칸 이름. 없으면 null.
//   1) 세부 과제 이름이 그 사업영역 이름과 같은 칸('의제 › 주제/A' — 위 칸 우선)
//   2) 사업영역 이름이 부호만 다른 칸(예전 규칙으로는 다른 이름이던 칸 — 원래 같은 표 묶음의 빈 세부 과제 줄은 접지 않음). 세부 과제가 빈 칸끼리는 앞의 것으로만.
export function foldTargetKey(key, keys) {
  const [a, t] = splitSummaryKey(key);
  if (String(t).trim() || !nameKey(a)) return null;
  const list = (keys ?? []).filter(k => k !== key), at = (keys ?? []).indexOf(key);
  const byTask = list.find(k => { const [, kt] = splitSummaryKey(k); return sameName(kt, a); });
  if (byTask != null) return byTask;
  const byArea = list.find(k => {
    const [ka, kt] = splitSummaryKey(k);
    if (!sameName(ka, a) || oldKey(ka) === oldKey(a)) return false;
    return String(kt).trim() ? true : at < 0 || (keys ?? []).indexOf(k) < at;
  });
  return byArea ?? null;
}

// 줄 글 맞추기: 앞 '- '·부호·띄어쓰기 무시. lineIn: text 가 lines 가운데 하나와 같거나(부호만 다름), 6자 넘게 그 줄 안에 그대로 들어 있음
// (예: 넣은 줄 '- 세부 과제: 글.' 안의 제안 '글').
export const lineKeyOf = s => squashLine(s);
export const sameLine = (a, b) => { const x = lineKeyOf(a); return !!x && x === lineKeyOf(b); };
export function lineIn(lines, text) {
  const k = lineKeyOf(text);
  if (!k) return false;
  return (lines ?? []).some(l => { const x = lineKeyOf(l); return x === k || (k.length >= 6 && x.includes(k)); });
}

// cells: [[id, lines]] 또는 Map, parse(id) → {section, key, n}. summary 칸 가운데 foldTargetKey 가 있는 칸은 그 칸 줄 뒤에(이미 든 비슷한 줄은 빼고)
// 붙이고 지운다. 반환 {cells: Map(id → 줄), into: Map(묶인 칸 id → 묶은 칸 id)}. 원본은 건드리지 않는다.
export function foldCells(cells, parse, idOf) {
  const list = [...(cells instanceof Map ? cells : new Map(cells))];
  const summary = list.filter(([id]) => parse(id).section === 'summary');
  const keys = summary.map(([id]) => parse(id).key), idByKey = new Map();
  for (const [id] of summary) { const c = parse(id); if (!idByKey.has(c.key)) idByKey.set(c.key, id); }
  const into = new Map();
  for (const [id] of summary) {
    const c = parse(id); if (c.n) continue;
    const target = foldTargetKey(c.key, keys);
    if (target != null) into.set(id, idByKey.get(target) ?? idOf(target));
  }
  // 묶은 칸이 또 묶이는 일은 없다(1)은 세부 과제가 있는 칸, 2)는 앞의 칸) — 그래도 한 번 더 따라가 끝 칸에 모은다.
  const end = id => { let x = id, guard = 0; while (into.has(x) && guard++ < 8) x = into.get(x); return x; };
  for (const [from] of into) into.set(from, end(from));
  const out = new Map();
  for (const [id, lines] of list) if (!into.has(id)) out.set(id, [...lines]);
  for (const [id, lines] of list) {
    const to = into.get(id); if (!to) continue;
    const have = out.get(to) ?? [];
    const add = lines.filter(l => String(l ?? '').trim() && !lineIn(have.filter(x => String(x ?? '').trim()), l));
    out.set(to, [...have, ...add]);
  }
  return {cells:out, into};
}

// S52-25 WEEKLY-투쟁사업장참고(요청함 11/07 19:26): '3. 투쟁 사업장 현황'에 들어간 조직은 '4. 산하 조직 현황'의 그 조직 칸을 이 한 줄로(화면·한글 파일 같게).
// 조직 이름 맞추기는 칸 이름과 같은 기준(부호·띄어쓰기만 다르면 같은 조직 — sameName). 4장 칸에 쓴 줄은 지우지 않고 그대로 둔다(화면에서 접어 보임).
export const SITE_REF_LINE = '- 투쟁 사업장 보고 참고';
export const inSites = (siteNames, name) => (siteNames ?? []).some(n => sameName(n, name));
