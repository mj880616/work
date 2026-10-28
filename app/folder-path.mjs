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
  return step('', rootLabel) + (trail || []).map((f, i, all) => sep + (i === all.length - 1 ? `<span class="fp-here" aria-current="location">${esc(f.name)}</span>` : step(f.id, f.name))).join('');
}
