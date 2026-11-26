// 폴더 위치 줄 공용 부품(NOTE-탐색기 후속 ⑧, 2026-10-28): 자료실(LIB-폴더100단 ②, #1379)과 노트(NOTE-탐색기)의 '들어가기' 위 위치 줄
// '자료실 › 조직 › 회의' / '노트 › 개발 › Web2'를 같은 줄 모양으로 그린다. 앞 칸은 누르면 그 단계로 가는 단추, 마지막 칸은 지금 위치(aria-current).
// 모양은 base-ui.css의 .fp-path 하나. 무엇을 누르는지는 화면마다 속성 이름(attr)으로 알아본다(자료실 data-lu-path, 노트 data-nx-at).
// 화면·네트워크 없음(순수). esc는 부르는 쪽의 글자 막기 함수.

// 폴더 id → 맨 위부터 그 폴더까지의 폴더들(고리·끊긴 부모는 거기서 멈춤).
export function folderTrail(folders, id, limit = 200) {
  const list = Array.isArray(folders) ? folders : [], out = [], seen = new Set();
  for (let f = list.find(x => x.id === id); f && !seen.has(f.id) && out.length < limit; f = f.parent_id ? list.find(x => x.id === f.parent_id) : null) { seen.add(f.id); out.unshift(f); }
  return out;
}
// 위치 줄 안쪽 HTML. rootLabel: 맨 앞 칸 이름('자료실'·'노트'), 누르면 attr="" (맨 위). trail: folderTrail 결과.
export function folderPathHtml({rootLabel, trail, attr, esc}) {
  const step = (id, name) => `<button type="button" class="fp-step" ${attr}="${esc(id)}">${esc(name)}</button>`;
  const sep = '<span class="fp-sep" aria-hidden="true">›</span>';
  const all = [{id: '', name: rootLabel}, ...(trail || []).map(f => ({id: f.id, name: f.name}))];
  const {head, hidden, tail} = collapseSteps(all);
  const last = all.length - 1;
  const one = (s, i) => (i === last && i > 0 ? `<span class="fp-here" aria-current="location">${esc(s.name)}</span>` : step(s.id, s.name));
  // 짧으면 예전과 같은 글자 그대로(가운데 줄이기 없음).
  const shown = hidden.length ? [...head.map((s, i) => one(s, i)), moreStepHtml(hidden, {cls: 'fp-step', attr, esc, sep: ''}), ...tail.map((s, k) => one(s, last - tail.length + 1 + k))] : all.map(one);
  return shown.join(sep);
}
// S69-19(사용자 11/24 '폴더 안에서 목록으로 돌아가기 쉽게'): 위치 줄이 길면 가운데를 '…' 한 칸으로 줄인다.
// steps = 맨 앞 칸부터 지금 칸까지 전부. 칸 수가 max를 넘으면 맨 앞 1칸 + '…' + 끝 tail칸만 보이고 나머지는 hidden.
// 화면 없음(순수) — 시험은 tests/select-mode-folder-path.test.mjs.
export function collapseSteps(steps, {max = 4, tail = 2} = {}) {
  const all = Array.isArray(steps) ? steps : [];
  if (all.length <= max || all.length < tail + 2) return {head: all.slice(0, Math.max(0, all.length - tail)), hidden: [], tail: all.slice(Math.max(0, all.length - tail))};
  return {head: all.slice(0, 1), hidden: all.slice(1, all.length - tail), tail: all.slice(all.length - tail)};
}
// '…' 단추(⑥ 아이콘 단추)와 가려진 단계 단추들(보이지 않는 ③ 글자 단추). 가려진 단추는 hidden(data-fp-hidden)으로 남겨 두고, '…'를 누르면 그 이름들의 작은 목록(folder-path-more.js)이
// 뜨고, 고르면 그 가려진 단추를 대신 눌러 화면마다의 원래 처리(자료실 data-lu-path·노트 data-nx-at 등)를 그대로 탄다.
export function moreStepHtml(hidden, {cls, attr, esc, sep}) {
  if (!hidden?.length) return '';
  return `<button type="button" class="icon-btn fp-more" data-fp-more aria-haspopup="menu" aria-expanded="false" aria-label="가려진 위치 ${hidden.length}개" title="${esc(hidden.map(h => h.name).join(' › '))}">…</button>`
    + hidden.map(h => `<button type="button" class="row-act ${cls}" ${attr}="${esc(h.id)}" data-fp-hidden hidden>${esc(h.name)}</button>`).join('') + sep;
}
