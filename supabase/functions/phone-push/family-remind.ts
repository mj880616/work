// FAMILY-기억알림 ②(요청함 11/12 10:40 4·5번, 명진 결정 11/12 10:56 "보이기"): 월요일 아침 주 1회 폰 알림 '가족 · 이번 주 기억할 것 3'.
// - 15분 예약(quarter)이 서울 월요일 08:00~24:00 사이 첫 실행에서 작업공간마다 한 번 보낸다. 기록 열쇠 rem:<그 월요일 날짜>(app_push_log kind family).
//   같은 열쇠로 이미 보냈거나(sent·failed·skipped_off) 하면 넘긴다 → 같은 주 두 번 안 감. 조용한 시간이면 held_quiet로 남기고 끝난 뒤 그날 안에 보낸다.
//   종류별 끄기(notify_prefs.kinds.family=false → skipped_off)·조용한 시간 규칙은 잊지 말기 새 제안 알림(handler.ts familyDecision)과 같다.
// - 줄 고르기는 홈 칸(app/family-remind.js)과 같은 규칙 한 곳: _shared/family-remind-model.mjs(app/family-remind-model.mjs 바이트 사본).
//   읽는 노트도 화면(family-note-send.js readRemindNote)과 같다: '잊지 말기' 노트(metadata.family_list) 가운데 가장 최근에 고친 것 하나.
//   서버는 service_role이라 RLS가 없으므로 휴지통(deleted_at)·AI 제외가 아닌 노트(ai_export_allowed)는 조건으로 직접 뺀다.
// - 보낸 뒤 그 노트의 metadata.remind(어느 줄을 언제 보였나)를 같은 규칙으로 갱신한다(서버 저장, 기기 저장 없음). 홈 칸은 그날 같은 3줄을 보인다.
//   쓰기는 읽은 판 그대로일 때만(updated_at·metadata 전체가 같을 때) — 그사이 바뀐 노트는 덮지 않고 넘긴다. updated_at은 건드리지 않는다.
// - 알림 글은 pushText(제목 '가족 · 이번 주 기억할 것 n', 본문 줄 앞부분 120자). 앱은 family 종류만 본문을 알림·잠금 화면에 보인다.
//   로그·기록·응답에는 줄 글을 싣지 않는다(종류·열쇠·상태만). 이 글은 AI·원장·주간보고 길로 가지 않는다.
import { pickToday, pushText, readRemind, remindLines } from "../_shared/family-remind-model.mjs";

// 누르면 '잊지 말기' 화면(맨 위 '가족 · 기억할 것' 칸). 잊지 말기 새 제안 알림(FAMILY_OPEN)과 여는 곳이 달라 폰 알림 번호도 따로다.
export const REMIND_OPEN = "/work/app/?view=basket";
export const REMIND_HOUR = 8;
const DAY_MS = 86400000;

// 서울 시각으로 이번 주 월요일 날짜와, 지금이 '월요일 08시 이후 그날 안'인지.
export function remindWeek(nowMs: number): { monday: string; due: boolean } {
  const kst = new Date(nowMs + 9 * 3600000);
  const dow = (kst.getUTCDay() + 6) % 7; // 월 0 … 일 6
  const monday = new Date(kst.getTime() - dow * DAY_MS).toISOString().slice(0, 10);
  return { monday, due: dow === 0 && kst.getUTCHours() >= REMIND_HOUR };
}
export const remindRef = (monday: string) => `rem:${monday}`;

export const REMIND_NOTE_SELECT = "id,doc,updated_at,metadata";
export const remindNotePath = (ws: string) =>
  `app_notes?workspace_id=eq.${ws}&kind=eq.note&metadata->>family_list=eq.true&ai_export_allowed=is.false&deleted_at=is.null`
  + `&select=${REMIND_NOTE_SELECT}&order=updated_at.desc&limit=1`;

type Row = Record<string, unknown>;
// 노트 한 행 → 이번 주 3줄과 저장할 remind. 줄이 없으면 null.
export function weekPicks(note: Row | undefined, today: string) {
  if (!note || typeof note.id !== "string") return null;
  const got = pickToday(remindLines(note.doc), readRemind(note.metadata), today);
  if (!got.picks.length) return null;
  return { text: pushText(got.picks) as { title: string; body: string }, next: got.next as Row | null };
}

// metadata.remind만 바꾼 새 metadata. 다른 칸은 그대로.
export function withRemind(metadata: unknown, next: Row) {
  const old = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as Row : {};
  if (old.family_list !== true) return null;
  return { ...old, remind: next };
}
// 읽은 판 그대로일 때만 쓰는 PATCH 조건(updated_at·metadata 전체).
export const remindPatchPath = (note: Row, ws: string) =>
  `app_notes?id=eq.${note.id}&workspace_id=eq.${ws}&kind=eq.note&ai_export_allowed=is.false&deleted_at=is.null`
  + `&updated_at=eq.${encodeURIComponent(String(note.updated_at ?? ""))}&metadata=eq.${encodeURIComponent(JSON.stringify(note.metadata ?? null))}`;
