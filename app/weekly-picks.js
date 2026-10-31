// S46-22 주간보고 제안 [×] + 학습 — 서버 읽기·쓰기와 주마다 들고 있는 값. 모양·셈은 weekly-picks.mjs.
// - 읽기: 그 주 '앞' 주들(LEARN_PICK_WEEKS-1개)의 요청 표 행에서 draft->picks 한 칸만(owner RLS). 이번 주 picks 는 부르는 쪽이
//   이미 든 그 주 행(업무일지 materials.weekDraft·한글 파일 상자 store.extras)에서 넘긴다 — 고친 즉시 학습에 들어가게.
// - 쓰기: [주간 정리]는 changeWeekDocs(그 주 행을 다시 읽고 picks 만 바꿔 draft_saved_at 조건으로)로, 한글 파일 상자는 자기 임시저장으로.
//   다른 쪽이 그사이 썼으면 weekly-feedback.mjs mergeExtras 가 picks 를 열쇠마다 합친다.
// - 브라우저 저장소에 아무것도 두지 않는다. 글은 로그에 쓰지 않는다.
import {changeWeekDocs, missingDraft} from './weekly-draft-store.js';
import {readPicks, withPick, withRelease, learnPicks, LEARN_PICK_WEEKS} from './weekly-picks.mjs';

const TABLE = '/rest/v1/app_weekly_exec_requests';
const encode = encodeURIComponent;
const emptyDraft = () => ({v:1, base:null, me:'', me_from:'', date:'', rows:[], titles:[]});
export const CHANGED_EVENT = 'kptu:weekly-picks-changed';
const past = new Map(); // 주 → {status:'loading'|'ok'|'missing'|'failed', rows, flight, waiters:Set}

async function readPast(start, rt) {
  const ws = rt.context.read()?.workspace?.id;
  if (!ws) throw new Error('context');
  let rows;
  try { rows = await rt.api(`${TABLE}?workspace_id=eq.${encode(ws)}&week_start=lt.${start}&draft->picks=not.is.null&select=week_start,picks:draft->picks&order=week_start.desc&limit=${LEARN_PICK_WEEKS - 1}`, {singleFlight:false}); }
  catch (error) { if (missingDraft(error)) return null; throw error; }
  if (!Array.isArray(rows)) throw new Error('read');
  return rows.map(r => ({week_start:String(r.week_start ?? ''), picks:readPicks(r.picks)})).filter(r => r.picks);
}
// 지난 주들 picks(없으면 읽기 시작하고 []). redraw 는 읽기가 끝나면 한 번 부른다.
export function pastPicks(start, {rt = window.KPTURuntime, redraw = null} = {}) {
  let s = past.get(start);
  if (!s) {
    s = {status:'loading', rows:[], waiters:new Set()};
    past.set(start, s);
    s.flight = readPast(start, rt).then(rows => { s.status = rows ? 'ok' : 'missing'; s.rows = rows ?? []; }, () => { s.status = 'failed'; })
      .finally(() => { const list = [...s.waiters]; s.waiters.clear(); for (const f of list) { try { f(); } catch { /* 다시 그리기만 못 함 */ } } });
  }
  if (redraw && s.status === 'loading') s.waiters.add(redraw);
  return s;
}
// 학습: 지난 주들 + 이번 주(thisWeek = 그 주 draft.picks).
export function learnFor(start, thisWeek, opts = {}) {
  const s = pastPicks(start, opts);
  return {status:s.status, learn:learnPicks([...s.rows, {week_start:start, picks:thisWeek}])};
}
// [주간 정리]·[풀기] 쓰기. change(picks) → picks. known: 그 주 행. 반환 changeWeekDocs 결과.
export async function changePicks({start, known = null, change}, rt = window.KPTURuntime) {
  const r = await changeWeekDocs({start, known, change:d => ({...(d ?? emptyDraft()), picks:change(d?.picks ?? null)})}, rt);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CHANGED_EVENT, {detail:{week:start}}));
  return r;
}
export const markPick = ({start, known, item, act, at = new Date().toISOString()}, rt) => changePicks({start, known, change:p => withPick(p, item, act, at)}, rt);
export const releaseSig = ({start, known, sig, at = new Date().toISOString()}, rt) => changePicks({start, known, change:p => withRelease(p, sig, at)}, rt);
