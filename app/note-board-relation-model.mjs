// S71-53 NOTE-관계선(사용자 결정 2026-11-26 19:58 "굉장히 광범위한 생각지도 … 무한정 뻗어나가는 / 서로의 관계성을 잇고",
// 21:10~21:11 "텍스트, 첨부한 사진, 심지어는 첨부한 파일 도 다 뻗을 수 있었으면 / 표도 넣을 수 있고 모든 것에서 / 관계망 형성이 되어야해"):
// 가지(부모-자식, 상자 표의 parent_id·parent_note) 선과 다른 '관계선' — 멀리 떨어진 칸(글자·도형·상자·노트 카드·사진 카드·파일 카드) 끼리 잇는 그물.
// - 저장은 연결선 표 app_note_board_links 그대로 + 종류 칸 kind('line' 지금 선 · 'relation' 관계선, migration 20261127020000). 이름 = label(1~40자),
//   방향 = ends(none 방향 없음 · end 한쪽 · both 양쪽). 관계선은 가지 나무(buildTree)에 끼지 않는다(선 표에만 있으므로).
// - 이 파일은 화면 없는 계산만(시험 가능): 관계선인가·새 관계선 칸·자주 쓴 이름·칸의 관계 목록·접힌 가지 끝으로 모으기·보드 안 칸 찾기·따라갈 끝.
// - 기기 저장 없음(자주 쓴 이름은 서버의 관계선 이름에서 센다).
import { endId } from './note-board-links-model.mjs';

export const LINK_KINDS = Object.freeze(['line', 'relation']);
export const RELATION = 'relation';
export const isRelation = l => l?.kind === RELATION;
// 새 관계선 기본 모양: 점선 · 부드러운 곡선 · 방향 없음(작은 화살표는 [한쪽]·[양쪽]으로).
export const RELATION_LOOK = Object.freeze({kind:RELATION, shape:'curve', dash:'dashed', ends:'none'});
export const RELATION_ENDS = Object.freeze(['none', 'end', 'both']);
export const RELATION_ENDS_NAMES = Object.freeze({none:'표시 안 함', end:'한쪽', both:'양쪽'});
export const NAME_PICKS = 6; // 고르기 목록에 보일 자주 쓴 이름 수

// 새 관계선 한 줄(서버에 보낼 칸): from·to = {kind:'note'|'text', id}.
export function relationSpec(boardId, from, to) {
  const end = (side, e) => (e.kind === 'note' ? {[`${side}_note`]:e.id, [`${side}_text`]:null} : {[`${side}_note`]:null, [`${side}_text`]:e.id});
  return {board_id:boardId, ...end('from', from), ...end('to', to), from_side:null, to_side:null, ...RELATION_LOOK};
}
// 두 칸 사이에 이미 선(어느 종류든, 어느 방향이든)이 있나 — 같은 두 칸은 한 줄(서버 unique는 방향마다, 화면은 관계선을 두 방향 모두 막는다).
export const linkedEither = (links, boardId, a, b) => !!a && !!b && links.some(l => l.board_id === boardId
  && ((endId(l, 'from') === a && endId(l, 'to') === b) || (endId(l, 'from') === b && endId(l, 'to') === a)));

// 자주 쓴 관계선 이름(많이 쓴 것부터, 같으면 최근 것 먼저). 작업공간 모든 보드의 관계선에서 센다.
export function relationNames(links, limit = NAME_PICKS) {
  const count = new Map();
  links.forEach((l, i) => { if (!isRelation(l) || !l.label) return; const c = count.get(l.label) || {n:0, last:-1}; c.n++; c.last = i; count.set(l.label, c); });
  return [...count].sort((a, b) => b[1].n - a[1].n || b[1].last - a[1].last).slice(0, limit).map(([name]) => name);
}
// 한 칸의 관계선 목록: {link, other(상대 칸 id), dir('out' 이 칸 → 상대 · 'in' 상대 → 이 칸 · 'both' · 'none')}.
export function relationsOf(links, boardId, id) {
  const out = [];
  for (const l of links) {
    if (!isRelation(l) || l.board_id !== boardId) continue;
    const a = endId(l, 'from'), b = endId(l, 'to');
    if (a !== id && b !== id) continue;
    const other = a === id ? b : a; if (!other) continue;
    const dir = l.ends === 'both' ? 'both' : l.ends === 'none' ? 'none' : a === id ? 'out' : 'in';
    out.push({link:l, other, dir});
  }
  return out;
}
export const DIR_MARK = Object.freeze({out:'→', in:'←', both:'↔', none:'—'});

// 접힌 가지 안 칸의 관계선 끝은 그 칸을 덮은(접힌) 가장 가까운 보이는 윗칸으로 모은다. parentOf: 칸 → 부모, hidden: 접혀 안 보이는 칸.
// 끝이 보이면 그대로. 위로 올라가도 보이는 칸이 없으면 null.
export function gatherEnd(id, parentOf, hidden) {
  let at = id, guard = 0;
  while (at && hidden.has(at) && guard++ < 10000) at = parentOf.get(at) || null;
  return at || null;
}

// 보드 안 칸 찾기(관계 잇기 상대 고르기): cells = [{id, text}] — 띄어쓰기·대소문자 무시하고 포함하는 칸, 앞에서 맞는 것 먼저.
const fold = s => String(s || '').toLowerCase().replace(/\s+/g, '');
export function findCells(cells, word, {skip = null, limit = 12} = {}) {
  const w = fold(word); if (!w) return [];
  const hits = [];
  for (const c of cells) { if (c.id === skip) continue; const t = fold(c.text), at = t.indexOf(w); if (at >= 0) hits.push({...c, at}); }
  return hits.sort((a, b) => a.at - b.at || fold(a.text).length - fold(b.text).length).slice(0, limit).map(({at:_a, ...c}) => c);
}

// 관계선을 누른 자리가 한쪽 끝 근처면 반대쪽 끝(따라갈 칸)을 돌려준다(그 끝이 화면에 다 보이면 null — 그때는 메뉴).
// p·q = 선의 시작·끝 점(판 좌표), at = 누른 점, near = 끝 근처로 볼 거리(판 px), seen(side) = 그 끝 칸이 화면에 다 보이나.
export function followSide(p, q, at, near, seen) {
  const dp = Math.hypot(at.x - p.x, at.y - p.y), dq = Math.hypot(at.x - q.x, at.y - q.y), len = Math.hypot(q.x - p.x, q.y - p.y);
  const reach = Math.max(near, len * 0.2);
  if (Math.min(dp, dq) > reach || len < near * 2) return null;
  const far = dp <= dq ? 'to' : 'from';
  return seen(far) ? null : far;
}
