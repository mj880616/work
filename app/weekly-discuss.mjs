// S46-27 주간보고 '1. 요청사항 › 3) 상집 논의 요청' 줄(요청함 10/31 00:24, 시안 확정 10/31 21:15): 화면 없는 부분.
// - 자료: 그 주 주간보고 행(app_weekly_exec_requests, 주마다 1행)의 임시저장 칸 draft.discuss [{id, title, note?, org?}] (순서 = 화면 순서).
//   2) 주요 일정 줄(draft.hq)과 같은 자리·같은 쓰기(weekly-draft-store.js changeWeekDocs)라 DB 모양은 바뀌지 않는다(draft 안쪽 모양은 화면이 검사).
//   title = 안건 한 줄(필수), note = 짧은 설명, org = 관련 조직 이름(고른 것, 없으면 비움).
// - [주간 정리]와 한글 파일 상자가 같은 줄을 읽고 쓴다(weekly-discuss-table.js 하나가 두 자리를 그림).
// - 한글 파일·복사 줄: '- 안건 — 설명 (관련 조직)'(여러 줄이면 이어지는 줄은 두 칸 들여 다음 줄). 줄이 없으면 한글 파일에는 제목만 두고 내용은 빈 칸(10/31 21:15 결정, '없음' 글자 안 넣음).
// 브라우저 저장소에 아무것도 두지 않는다. 내용은 업무 글이라 로그에 쓰지 않는다.
import {newId} from './weekly-exec-requests.js';

export const DISCUSS_MAX = 20;
// WEEKLY-요청사항버튼정리(11/01 01:09 명진: 상집 논의 요청은 글이 많고 복붙이 많음): 안건·설명은 여러 줄 글(줄바꿈 그대로), 길이도 늘림.
export const DISCUSS_LIMITS = Object.freeze({title:200, note:1000, org:120});
export const DISCUSS_TITLE = '3) 상집 논의 요청';
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const one = s => String(s ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
// 여러 줄: 줄마다 한 줄처럼 다듬고(앞뒤 빈칸·제어 문자), 빈 줄은 두 개 이상 잇지 않으며 맨 앞·끝 빈 줄은 뺀다.
const multi = s => String(s ?? '').replace(/\r\n?|[\u2028\u2029]/g, '\n').split('\n').map(one).join('\n').replace(/\n{3,}/g, '\n\n').trim();
const cutTo = (text, n) => [...text].slice(0, n).join('').trim();
const cut = (s, n) => cutTo(one(s), n);
const cutLines = (s, n) => cutTo(multi(s), n);

// 줄 하나를 모양대로(모르는 칸은 버림). 안건이 없거나 id가 틀리면 null.
export function cleanDiscussRow(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  if (typeof r.id !== 'string' || !ID.test(r.id)) return null;
  const title = cutLines(r.title, DISCUSS_LIMITS.title);
  if (!title) return null;
  const out = {id:r.id, title};
  const note = cutLines(r.note, DISCUSS_LIMITS.note), org = cut(r.org, DISCUSS_LIMITS.org);
  if (note) out.note = note;
  if (org) out.org = org;
  return out;
}
export function readDiscuss(list) {
  const seen = new Set(), out = [];
  for (const r of Array.isArray(list) ? list : []) { const c = cleanDiscussRow(r); if (c && !seen.has(c.id) && out.length < DISCUSS_MAX) { seen.add(c.id); out.push(c); } }
  return out;
}
const makeId = () => newId().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || `d${Date.now().toString(36)}`;
// 줄 더하기·바꾸기(순수). 안건이 비면 null, 넘치면 null.
export function withDiscussRow(list, row) {
  const rows = readDiscuss(list), c = cleanDiscussRow({...row, id:row?.id || makeId()});
  if (!c) return null;
  const at = rows.findIndex(r => r.id === c.id);
  if (at >= 0) { rows[at] = c; return rows; }
  if (rows.length >= DISCUSS_MAX) return null;
  return [...rows, c];
}
export const withoutDiscussRow = (list, id) => readDiscuss(list).filter(r => r.id !== id);
export function movedDiscussRow(list, id, index) {
  const rows = readDiscuss(list), from = rows.findIndex(r => r.id === id);
  if (from < 0) return rows;
  const [row] = rows.splice(from, 1);
  rows.splice(Math.max(0, Math.min(index, rows.length)), 0, row);
  return rows;
}
// 화면 한 줄·한글 파일 줄.
export const discussText = r => `${r.title}${r.note ? ` — ${r.note}` : ''}${r.org ? ` (${r.org})` : ''}`;
export const discussLine = r => `- ${discussText(r)}`;
// 한글 파일·복사: 줄 하나가 여러 줄이면 이어지는 줄은 두 칸 들여 같은 차례에 둔다(빈 줄은 빈 문단).
export const discussLines = list => readDiscuss(list).flatMap(r => discussLine(r).split('\n').map((line, i) => (i && line ? `  ${line}` : line)));
