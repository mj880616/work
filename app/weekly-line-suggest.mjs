// WEEKLY-환류입력창 ② (docs/design/weekly-draft-feedback.md 18절): 한글 파일 상자에서 칸을 고치는 동안 줄 옆 '이렇게 바꾸면?' 한 줄 제안의 화면 없는 부분.
// 같은 코드를 node 시험이 그대로 부른다. 화면·네트워크 없음. 줄 글은 업무 글이므로 로그·오류 보고에 넣지 않는다.
//
//   caretLine(글, 커서 위치)          → 커서가 있는 줄 {index, text}
//   askTargets(칸 줄, 커서 줄, 이미 받은 것) → 물을 줄(보이는 칸 한 개의 줄만, 커서 줄 먼저, 8줄까지, 이미 받은 줄은 다시 묻지 않음)
//   lineRequest(...)                 → ai-assist kind=weekly_line 몸통(그 칸 지금 줄·그 칸 옆 이번 주 기록만 — 이번 주 개인본·다른 칸은 보내지 않음)
//   replaceLine(글, 줄 번호, 새 줄)     → 그 줄만 바꾼 글(줄이 그새 바뀌었으면 null — 엉뚱한 줄을 바꾸지 않음)
//   suggestKey(칸, 줄)                → 받은 제안을 기억하는 열쇠(같은 줄은 한 번만 묻는다)
// 언제 묻나: 줄을 고르거나(초점·누름·화살표) PICK_MS, 고치다 PAUSE_MS 멈췄을 때만(타자마다 아님). 상자를 한 번 열 때 PER_OPEN 번까지.
// 서버 하루 상한(ai-assist 전체 80회)을 이 기능이 다 쓰지 않게 하는 화면 쪽 상한이다.

export const LINE_ASK_MAX = 8;
export const LINE_CHARS = 300;
export const CONTEXT_MAX = 20;
export const MATERIAL_MAX = 20;
export const MATERIAL_CHARS = 400;
export const MIN_CHARS = 4;          // 이보다 짧은 줄은 묻지 않는다('- ' 같은 빈 줄)
export const PICK_MS = 700;
export const PAUSE_MS = 1500;
export const PER_OPEN = 12;
export const BODY_BYTES = 16 * 1024;

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2028\u2029\u2060-\u2069]+/g;
export const sendLine = (v, max = LINE_CHARS) => [...String(v ?? '').replace(CONTROL, ' ').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim()].slice(0, max).join('');
const squash = s => sendLine(s).replace(/\s+/g, '');
export const suggestKey = (cell, text) => `${cell}\u0000${squash(text)}`;

export function caretLine(value, pos) {
  const v = String(value ?? ''), p = Math.max(0, Math.min(Number.isInteger(pos) ? pos : v.length, v.length));
  const index = v.slice(0, p).split('\n').length - 1;
  return {index, text:v.split('\n')[index] ?? ''};
}

// lines: 칸 줄 배열, caret: 커서 줄 번호, known: 이미 받은(또는 묻는 중인) 열쇠 Set/Map, cell: 칸 열쇠.
export function askTargets(lines, caret, known, cell) {
  const ok = i => { const t = sendLine(lines[i]); return [...t].length >= MIN_CHARS && !known.has(suggestKey(cell, t)); };
  const order = [caret, ...lines.map((_, i) => i).filter(i => i !== caret)].filter(i => i >= 0 && i < lines.length);
  const out = [], seen = new Set();
  for (const i of order) {
    if (out.length >= LINE_ASK_MAX) break;
    const k = squash(lines[i]);
    if (!ok(i) || seen.has(k)) continue;
    seen.add(k); out.push(i);
  }
  return out;
}

// week: 월요일, where: 칸 이름, lines: 칸 줄, targets: 물을 줄 번호, material: 그 칸 옆 이번 주 기록 줄.
// 반환 {request, refs: Map(ref → 줄 번호)}. 몸통이 크면 기록 줄 → 맥락 줄 순으로 뒤에서 덜어 낸다(물을 줄은 그대로).
export function lineRequest({week, where, lines, targets, material = []}) {
  const refs = new Map(), asks = [];
  for (const i of targets.slice(0, LINE_ASK_MAX)) { const ref = `l${asks.length + 1}`; refs.set(ref, i); asks.push({ref, text:sendLine(lines[i])}); }
  const request = {kind:'weekly_line', week_start:week, where:sendLine(where, 120) || '칸', lines:asks,
    cell:lines.map(l => sendLine(l)).filter(Boolean).slice(0, CONTEXT_MAX), material:material.map(m => sendLine(m, MATERIAL_CHARS)).filter(Boolean).slice(0, MATERIAL_MAX)};
  const size = () => new TextEncoder().encode(JSON.stringify(request)).length;
  while (size() > BODY_BYTES && request.material.length) request.material.pop();
  while (size() > BODY_BYTES && request.cell.length) request.cell.pop();
  return {request, refs};
}

// 답 {lines:[{ref, text|null}]} → Map(열쇠 → 제안 글 또는 null). 묻고 답이 없는 줄도 null(다시 묻지 않음).
export function readAnswer(data, refs, lines, cell) {
  const out = new Map();
  for (const i of refs.values()) out.set(suggestKey(cell, lines[i]), null);
  for (const l of Array.isArray(data?.lines) ? data.lines : []) {
    const i = refs.get(l?.ref);
    if (i === undefined) continue;
    const t = typeof l.text === 'string' ? sendLine(l.text) : '';
    out.set(suggestKey(cell, lines[i]), t && squash(t) !== squash(lines[i]) ? t : null);
  }
  return out;
}

export function replaceLine(value, index, expected, text) {
  const lines = String(value ?? '').split('\n');
  if (index < 0 || index >= lines.length || squash(lines[index]) !== squash(expected)) return null;
  lines[index] = text;
  return lines.join('\n');
}
