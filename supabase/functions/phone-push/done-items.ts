// phone-push '보낼 일' 목록 — 뒤에서 끝난 일(UI-앱안알림 4·5단계, 설계 docs/design/in-app-notices.md 4절 3·6절 A6).
// 폰 알림(예약 입구, N5·N6)과 맨 위 알림 줄(사용자 입구 `notices`)이 이 한 파일의 목록·열쇠·여는 주소를 함께 쓴다(중복 구현 금지).
// 기록은 app_push_log(migration 20261101210000_push_log_notices) 한 곳: 같은 (종류·기록 열쇠·날) 한 줄에 폰으로 보냄(status)·
// 알림 줄에 뜸(shown_at)·눌러 엶(opened_at)을 함께 적는다. 한 번 열면(opened_at) 폰 알림·알림 줄 어느 쪽에서도 다시 뜨지 않는다.
// 제목·본문·업무 내용은 기록하지 않는다. 화면에 보일 말은 종류에서 화면이 정한다(phone-push-model.mjs NOTICE_TEXT).
//
// 지금 목록에 있는 것:
// - next_week: 금요일 15시(서울) 뒤 ~ 일요일에 다음 주 준비 한 장이 아직 없으면 '다음 주 준비 한 장' 한 줄.
//   한 장은 [주간 정리]를 처음 열 때 만들어진다(journal.js shouldAutoMake). 있는지는 사용자 로그인(owner RLS)으로만 읽는다
//   (service_role은 그 표 권한이 없고, 이 작업에서 권한을 넓히지 않는다).
// 아직 없는 것(재료가 생기면 여기 한 곳에 더한다):
// - meeting_done: 회의 녹음 전사는 지금 화면이 기다렸다 받는 한 번의 요청이라(전사 글을 서버에 저장하지 않음) '뒤에서 끝난' 기록이 없다.
//   MTG-녹음초안의 서버 뒤 작업(폰 알림 설계 N6)이 생기면 그 작업 행을 여기서 읽는다.

export const NOTICE_LOG_KINDS = [
  "task_due", "commitment", "meeting_done", "collect_stall", "morning", "evening", "next_week", "quiet_digest", "test",
] as const; // app_push_log_kind_check와 같다
export const REF_KEY = /^[A-Za-z0-9_.:-]{1,80}$/;
export const RECENT_DAYS = 7;
export const RECENT_LIMIT = 50;
const DAY_MS = 86400000;
const APP = "/work/app/";

export type DoneItem = { kind: string; ref_key: string; day: string; open: string };
export type RecentRow = { kind: string; ref_key: string; at: string; opened: boolean; pushed: boolean; open: string };

// 서울 시각의 날짜·요일·시.
export function kstParts(ms: number) {
  const d = new Date(ms + 9 * 3600000);
  return { day: d.toISOString().slice(0, 10), dow: d.getUTCDay(), hour: d.getUTCHours() };
}
const addDays = (day: string, n: number) => new Date(Date.parse(day + "T00:00:00Z") + n * DAY_MS).toISOString().slice(0, 10);

// 다음 주 준비 한 장을 알릴 때인가: 금 15시 뒤·토·일. 맞으면 {week: 다음 주 월요일, day: 그 주 금요일(기록 날)}.
export function nextWeekDue(nowMs: number): { week: string; day: string } | null {
  const { day, dow, hour } = kstParts(nowMs);
  const ahead = dow === 5 && hour >= 15 ? 3 : dow === 6 ? 2 : dow === 0 ? 1 : 0;
  if (!ahead) return null;
  const week = addDays(day, ahead);
  return { week, day: addDays(week, -3) };
}

// 누르면 가는 자리. notice=종류.열쇠는 화면이 열자마자 `opened`로 알려 '열었음'을 남기고 주소에서 지운다(폰 알림·알림 줄 같은 길).
const PLACE: Record<string, string> = {
  next_week: "?view=home&mode=week",
  meeting_done: "?view=reports",
  task_due: "?view=tasks",
  collect_stall: "?view=profile",
  morning: "?view=basket&pane=todo",
  test: "?view=profile",
};
export function openPath(kind: string, refKey: string) {
  const place = PLACE[kind] ?? "";
  const notice = `notice=${kind}.${encodeURIComponent(refKey)}`;
  return `${APP}${place ? `${place}&${notice}` : `?${notice}`}`;
}

type Read = (path: string) => Promise<Record<string, unknown>[]>;

// 이 작업공간의 뒤에서 끝난 일. asUser = 사용자 로그인으로 읽기(owner RLS). 읽기에 실패한 재료는 건너뛴다(알림 줄이 없을 뿐).
export async function doneItems(asUser: Read, workspaceId: string, nowMs: number): Promise<DoneItem[]> {
  const out: DoneItem[] = [];
  const due = nextWeekDue(nowMs);
  if (due) {
    let rows: Record<string, unknown>[] | null = null;
    try {
      rows = await asUser(`app_journal_next_week_sheets?workspace_id=eq.${workspaceId}&week_start=eq.${due.week}&select=week_start&limit=1`);
    } catch { rows = null; }
    if (rows && !rows.length) {
      const ref = `w${due.week}`;
      out.push({ kind: "next_week", ref_key: ref, day: due.day, open: openPath("next_week", ref) });
    }
  }
  return out;
}

// 최근 알림 7일: 폰으로 보낸 것(sent)과 알림 줄에 뜬 것(shown_at)만, 새것부터. 시각은 처음 알린 때(sent_at).
export function recentRows(rows: Record<string, unknown>[]): RecentRow[] {
  const out: RecentRow[] = [];
  for (const r of rows) {
    const kind = String(r.kind ?? ""), ref = String(r.ref_key ?? "");
    if (!(NOTICE_LOG_KINDS as readonly string[]).includes(kind) || !REF_KEY.test(ref) || typeof r.sent_at !== "string") continue;
    const pushed = r.status === "sent";
    if (!pushed && !r.shown_at) continue;
    out.push({ kind, ref_key: ref, at: r.sent_at, opened: Boolean(r.opened_at), pushed, open: openPath(kind, ref) });
  }
  return out;
}
export const recentSince = (nowMs: number) => new Date(nowMs - RECENT_DAYS * DAY_MS).toISOString();
