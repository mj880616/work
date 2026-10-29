// JOURNAL-다음주준비: [다음 주] 칸의 읽기·만들기. 규칙은 next-week-sheet-model.mjs, 그리기는 journal-weekly.js renderNextWeekSheet.
// - 읽기: 저장된 장 한 행(app_journal_next_week_sheets, owner RLS, 읽기만). 표가 없으면(DB 적용 전) {missing:true} — 화면은 "준비 중" 한 줄.
// - 만들기: 이미 있는 읽기 경로로 다음 주 재료를 모아(업무 캘린더 일정·Google 할 일·원장 약속·챙길 것·지난 회의) 서버 ai-assist
//   kind=next_week_sheet에 보낸다. 서버가 AI '핵심 세 가지'를 붙여 저장한다. 원본에는 쓰지 않는다(이 파일에 쓰기 호출 없음 — 시험으로 고정).
// 기기에 저장하지 않는다(브라우저 저장소 없음).
import {readScheduleEvents} from './journal-data.js';
import {upcomingSchedule} from './journal-weekly.js';
import {callAiAssist, AI_SUMMARY_TEXT} from './basket-ai-summary.js';
import {buildItems, addDays} from './next-week-sheet-model.mjs';

const encode = encodeURIComponent;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const workspace = rt => { const id = rt.context.read()?.workspace?.id; if (!id) throw new Error('workspace'); return id; };
const SHEET_COLS = 'week_start,top_lines,groups,ai_status,made_by,created_at,updated_at';

// 그 주(다음 주 월요일)의 장. {missing:true} | {missing:false, sheet:행|null}.
export async function readNextWeekSheet(week, rt = window.KPTURuntime) {
  if (!DAY.test(week || '')) throw new Error('week');
  try {
    const rows = await rt.api(`/rest/v1/app_journal_next_week_sheets?workspace_id=eq.${encode(workspace(rt))}&week_start=eq.${week}&select=${SHEET_COLS}&limit=1`, {singleFlight:false});
    const row = Array.isArray(rows) ? rows[0] : null;
    return {missing:false, sheet:row && row.week_start === week ? row : null};
  } catch (error) {
    if (Number(error?.status) === 404) return {missing:true, sheet:null};
    throw error;
  }
}

// 재료 읽기(모두 읽기만). 하나가 실패하면 그 묶음만 빠진다(장은 만든다).
const settle = promise => promise.then(value => value, () => null);
async function readTasks(rt) {
  // 서버 기본 범위(기한 지남 + 오늘~6일)는 금요일에 보면 다음 주 금·토·일이 빠지므로 모든 기한을 받는다(설계 8절).
  const data = await rt.api('/functions/v1/google-tasks?action=tasks&pending_scope=all');
  if (!Array.isArray(data?.tasks) || data?.needs_reconnect || data?.error) throw new Error('tasks');
  return data.tasks;
}
const readLedger = (week, rt) => rt.api(`/rest/v1/app_ledger_records?workspace_id=eq.${encode(workspace(rt))}&kind=eq.commitment&commitment_status=eq.waiting&validity=in.(current,needs_check)&scope=eq.work&sensitivity=in.(S0,S1)&follow_up_on=gte.${week}&follow_up_on=lte.${addDays(week, 6)}&select=id,kind,title,validity,sensitivity,counterparty,commitment_status,follow_up_on&order=follow_up_on.asc&limit=50`, {singleFlight:false});
const readTodos = rt => rt.api(`/rest/v1/app_todo_candidates?workspace_id=eq.${encode(workspace(rt))}&status=eq.open&select=id,summary,due,source_kind,source_id,status,task_id&order=created_at.desc,id.asc&limit=100`, {singleFlight:false});
async function readMeetings(rt) {
  const path = fields => `/rest/v1/app_meetings?workspace_id=eq.${encode(workspace(rt))}&series_name=not.is.null&select=${fields}&order=meeting_at.desc,id.asc&limit=200`;
  // 다음 할 일(next_plan) 칸이 아직 없는 서버(400)는 그 칸 없이 읽는다.
  try { return await rt.api(path('id,series_name,round_no,meeting_at,next_plan'), {singleFlight:false}); }
  catch (error) { if (Number(error?.status) !== 400) throw error; return rt.api(path('id,series_name,round_no,meeting_at'), {singleFlight:false}); }
}
// 이번 주 월요일(thisMonday) 기준 다음 주 재료 ①~⑥ 줄.
export async function collectNextWeekItems(thisMonday, rt = window.KPTURuntime) {
  const week = addDays(thisMonday, 7);
  const [events, tasks, ledger, todos, meetings] = await Promise.all([
    settle(readScheduleEvents(thisMonday, rt)), settle(readTasks(rt)), settle(readLedger(week, rt)), settle(readTodos(rt)), settle(readMeetings(rt)),
  ]);
  const schedule = Array.isArray(events) ? upcomingSchedule(events, thisMonday) : null;
  return buildItems({week, schedule, tasks, ledger:Array.isArray(ledger) ? ledger : null, todos:Array.isArray(todos) ? todos : null, meetings:Array.isArray(meetings) ? meetings : null});
}

// 만들기(mode auto|user). {ok:true, sheet, skipped?} | {ok:false, message}.
export async function makeNextWeekSheet({week, thisMonday, mode}, rt = window.KPTURuntime) {
  const items = await collectNextWeekItems(thisMonday, rt);
  const result = await callAiAssist({kind:'next_week_sheet', week_start:week, mode, items}, {rt});
  if (result?.ok && result.data?.week_start === week) return {ok:true, sheet:result.data.sheet ?? null, skipped:result.data.skipped ?? null};
  const code = result?.code || 'internal_error';
  const message = code === 'not_ready' || code === 'next_week_sheet_not_ready' ? '다음 주 준비는 아직 준비 중이에요.' : AI_SUMMARY_TEXT[code] || '만들지 못했어요. 잠시 뒤 다시 시도해 주세요.';
  return {ok:false, code, message};
}
