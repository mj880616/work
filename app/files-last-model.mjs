// S52-44 ② FILES-관리자마무리(요청함 11/08 "칸마다 마지막으로 보던 폴더 서버 기억(다시 열면 그 자리)"): [파일] 칸마다 마지막 폴더 계산. DOM·네트워크 없음(node --test).
// - 서버 view_prefs.files_last = [{od?, gd?}, {od?, gd?}] — 칸 차례(0 = 첫 칸·한 칸 보기, 1 = 둘째 칸)마다 저장소별 마지막 폴더 id(맨 위면 칸 없음). 모든 기기 같게.
// - 원드라이브·구글 드라이브 폴더만. 묶음(별표·큰 파일)·찾기·이 폰·내 PC 위치는 넣지 않는다(이 폰·내 PC 경로는 서버에 두지 않음, 다시 열면 맨 위).
// - 폰 한 칸 첫 화면은 그대로 나무(S50-33 결정). 그 밖(PC·폴드 첫 칸, 두 칸의 각 칸)은 그 칸에 처음 여는 저장소의 마지막 폴더로 연다.
export const LAST_PANES = 2;
export const LAST_SOURCES = Object.freeze(['od', 'gd']);
// eslint-disable-next-line no-control-regex
const idOk = id => typeof id === 'string' && id.length > 0 && [...id].length <= 200 && !/[\u0000-\u001f\u007f]/.test(id);
// 서버 값 → 쓸 수 있는 모양만(칸 2개까지, 칸마다 od·gd 글자 id만).
export function lastClean(value) {
  const out = [];
  for (const o of (Array.isArray(value) ? value : []).slice(0, LAST_PANES)) {
    const one = {};
    if (o && typeof o === 'object' && !Array.isArray(o)) for (const s of LAST_SOURCES) if (idOk(o[s])) one[s] = o[s];
    out.push(one);
  }
  return out;
}
// 칸 i에서 저장소 source의 마지막 폴더 id(없으면 null).
export function lastOf(value, i, source) {
  if (!LAST_SOURCES.includes(source) || !(i === 0 || i === 1)) return null;
  return lastClean(value)[i]?.[source] || null;
}
// 칸 i가 where로 옮겼을 때 새 값. 기억할 자리가 아니거나 바뀐 것이 없으면 null(저장하지 않음).
// 맨 위(parent 없음)면 그 저장소 칸을 지운다. 끝의 빈 칸은 떼어 낸다(값이 작게 유지되게).
export function lastPut(value, i, where) {
  if (!(i === 0 || i === 1) || !where || where.shelf || !LAST_SOURCES.includes(where.source)) return null;
  const id = where.parent ? String(where.parent) : '';
  if (id && !idOk(id)) return null;
  const cur = lastClean(value);
  if ((cur[i]?.[where.source] || '') === id) return null;
  const next = cur.map(o => ({...o}));
  while (next.length <= i) next.push({});
  if (id) next[i][where.source] = id; else delete next[i][where.source];
  while (next.length && !Object.keys(next[next.length - 1]).length) next.pop();
  return next;
}
// 칸의 첫 자리(맨 위)를 마지막 폴더로 바꾼다. 기억이 없거나 묶음·이 폰·내 PC면 그대로.
export function lastStart(start, value, i) {
  if (!start || start.shelf || start.parent || !LAST_SOURCES.includes(start.source)) return start;
  const id = lastOf(value, i, start.source);
  return id ? {source: start.source, parent: id} : start;
}
