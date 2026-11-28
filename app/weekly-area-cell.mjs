// WEEKLY-화면정돈 ② 0순위(2026-11-28 사용자 "파란색 표시부분 수정 삭제 안됨 거슬려"): 홈 [주간 정리] 2. 1) 묶음 표의 한 칸
// (사업영역 자기 칸 지금 상황 + '◦ 세부 과제' 칸들의 지금 상황) 줄 목록을 정하는 한 곳. 화면 표·칸 고치기 글상자·한글 파일 줄이 모두 이것을 쓴다
// (전에는 화면이 칸마다 따로 그리고 [수정]은 칸 하나만 열어, 자기 칸과 세부 과제 칸에 같은 글이 있으면 두 번 보이는데 한 벌만 고쳐졌다).
// - 같은 줄 한 번: 자기 칸 줄이 같은 사업영역의 세부 과제 칸에도 있으면(부호·띄어쓰기만 다른 것 포함) 자기 칸 줄은 보이지 않는다(세부 과제 아래 한 번).
//   저장된 값은 사람이 그 칸을 저장할 때 보이는 대로 저장된다(읽을 때 지우지 않음).
// - 칸 하나 = 글상자 하나: 자기 칸 줄 → '◦ 세부 과제 이름' 줄 → 그 칸 줄 … 로 펼치고, 저장하면 '◦ 이름' 줄로 다시 나눈다.
//   이름이 맞는 세부 과제가 없는 '◦' 줄은 글 그대로 자기 칸에 두고 '확인 필요'로 알린다(버리지 않음).
// 화면·네트워크 없음. 글은 업무 글이므로 로그·오류 보고에 넣지 않는다.
import {squashLine} from './weekly-lines.mjs';

const linesOf = body => String(body ?? '').replace(/\r\n?/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
const HEAD = /^\s*[◦○•]\s*(.+?)\s*$/u;
const same = (a, b) => { const x = squashLine(a); return !!x && x === squashLine(b); };

// own = {space, body}, subs = [{space, name, body}] (표 순서). 돌려주는 값: {own:{space, lines, hidden}, subs:[{space, name, lines}]}.
// hidden = 세부 과제 칸에도 있어 자기 칸에서 보이지 않게 된 줄 수.
export function areaCellParts({own = null, subs = []} = {}) {
  const list = (Array.isArray(subs) ? subs : []).map(s => ({space: String(s?.space ?? ''), name: String(s?.name ?? ''), lines: linesOf(s?.body)}));
  const inSubs = new Set(list.flatMap(s => s.lines.map(squashLine)).filter(Boolean));
  const all = linesOf(own?.body), lines = all.filter(l => !inSubs.has(squashLine(l)));
  return {own: {space: String(own?.space ?? ''), lines, hidden: all.length - lines.length}, subs: list};
}

// 보이는 줄(화면·한글 파일): 자기 칸 줄, 그다음 줄이 있는 세부 과제마다 '◦ 이름' + 줄.
export const cellLines = parts => [...(parts?.own?.lines ?? []), ...(parts?.subs ?? []).filter(s => s.lines.length).flatMap(s => [`◦ ${s.name}`, ...s.lines])];
// 글상자에 넣는 글(보이는 줄 그대로).
export const cellText = parts => cellLines(parts).join('\n');

// 글상자 글 → 칸마다 저장할 글. 돌려주는 값: {bodies: Map(space → 글), unknown:[찾지 못한 '◦' 이름]}.
// parts 의 모든 칸(자기 칸 + 세부 과제 칸)이 bodies 에 들어간다 — 글상자에서 지운 칸은 빈 글.
export function splitCellText(text, parts) {
  const own = parts?.own ?? {space: ''}, subs = parts?.subs ?? [];
  const out = new Map([[String(own.space), []], ...subs.map(s => [String(s.space), []])]), unknown = [];
  let cur = String(own.space);
  for (const line of linesOf(text)) {
    const m = HEAD.exec(line);
    if (m) {
      const hit = subs.find(s => same(s.name, m[1]));
      if (hit) { cur = String(hit.space); continue; }
      unknown.push(m[1]); cur = String(own.space);
    }
    out.get(cur).push(line);
  }
  return {bodies: new Map([...out].map(([k, v]) => [k, v.join('\n')])), unknown};
}
