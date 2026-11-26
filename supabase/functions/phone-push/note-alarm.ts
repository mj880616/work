// S69-97 노트 알림 ②: 노트에 건 알림(정한 시각이 되면 폰 알림)을 phone-push 15분 예약(quarter)이 보낸다.
// - 노트 데이터 계약(화면이 쓴다): app_notes.metadata.alarm = {"at": "<ISO UTC, 분 단위>"}. 끄면 칸이 없다.
// - 대상: 살아 있는 기기가 있는 작업공간의 노트 중 kind=note·휴지통 아님·alarm.at이 (지금−36시간, 지금] 안.
//   service_role 읽기는 id·workspace_id·alarm(metadata->alarm) 세 칸만 — 제목·글(doc)·다른 metadata는 읽지 않는다
//   (AGENTS.md 3절 '남의 기록 안 보기': 서버도 내용을 열지 않는다). at 값은 서버에서 다시 검사한다(ISO 날짜로 읽히는지·창 안인지).
// - 중복 막기: app_push_log kind 'note', 열쇠 note:<노트 id>:<at(ISO 정규형)>. 같은 열쇠 기록(sent·failed·skipped_off)이 있으면 넘긴다.
//   알림 시각을 바꾸면 열쇠가 달라져 새 시각에 다시 한 번 간다.
// - 종류 끄기(notify_prefs.kinds.note=false) → skipped_off 기록. 조용한 시간은 적용하지 않는다 — 사람이 그 시각을 직접 골랐으므로
//   (밤 시각을 고른 것도 본인의 뜻이다. 다른 종류처럼 held_quiet로 미루면 고른 시각을 어긴다).
// - 노트에는 아무것도 쓰지 않는다(updated_at·metadata 그대로).
// - 보낼 글: 제목 '노트 다시 보기'(본문 없음 — 잠금 화면에 노트 내용이 뜨지 않게), 누르면 그 노트. 노트마다 하나, 한 작업공간에 한 실행 20개까지.
// - 로그·기록·응답에는 종류·개수·상태만(노트 id·제목 없음).

export const NOTE_KIND = "note";
export const NOTE_TITLE = "노트 다시 보기";
export const NOTE_WINDOW_MS = 36 * 3600000;
export const NOTE_PER_WORKSPACE = 20;
export const NOTE_READ_LIMIT = 1000;
// 읽는 칸: id·workspace_id·alarm(metadata 안 alarm 한 칸)만.
export const NOTE_SELECT = "id,workspace_id,alarm:metadata->alarm";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// ISO 날짜 모양(YYYY-MM-DDTHH:MM[:SS[.sss]](Z|±HH:MM)). 모양이 맞고 Date로 읽혀야 한다.
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

export const noteOpen = (id: string) => `/work/app/?view=basket&pane=note&doc=${id}`;
export const noteRef = (id: string, atIso: string) => `note:${id}:${atIso}`;

// 작업공간 목록 → 읽기 경로(한 번에). 창 거르기는 글자 비교라 대강이고, 정확한 판정은 alarmAt이 다시 한다.
export function noteAlarmPath(ids: string[], nowMs: number) {
  const since = new Date(nowMs - NOTE_WINDOW_MS).toISOString(), until = new Date(nowMs + 60000).toISOString();
  return `app_notes?workspace_id=in.(${ids.join(",")})&kind=eq.note&deleted_at=is.null`
    + `&metadata->alarm->>at=gte.${encodeURIComponent(since)}&metadata->alarm->>at=lte.${encodeURIComponent(until)}`
    + `&select=${NOTE_SELECT}&order=workspace_id.asc&limit=${NOTE_READ_LIMIT}`;
}

// alarm 칸 → 창 안이면 ISO 정규형 시각, 아니면 null.
export function alarmAt(alarm: unknown, nowMs: number): string | null {
  if (!alarm || typeof alarm !== "object" || Array.isArray(alarm)) return null;
  const at = (alarm as Record<string, unknown>).at;
  if (typeof at !== "string" || at.length > 40 || !ISO.test(at)) return null;
  const ms = Date.parse(at);
  if (!Number.isFinite(ms) || ms > nowMs || ms <= nowMs - NOTE_WINDOW_MS) return null;
  return new Date(ms).toISOString();
}

export type NoteDue = { id: string; ref: string; atMs: number };
// 읽은 줄 → 작업공간마다 보낼 노트(오래된 시각부터). 모양이 다르거나 창 밖이면 뺀다.
export function dueByWorkspace(rows: Record<string, unknown>[], ids: string[], nowMs: number) {
  const allowed = new Set(ids), out = new Map<string, NoteDue[]>();
  for (const r of rows) {
    const ws = r.workspace_id, id = r.id;
    if (typeof ws !== "string" || !allowed.has(ws) || typeof id !== "string" || !UUID.test(id)) continue;
    const at = alarmAt(r.alarm, nowMs);
    if (!at) continue;
    const list = out.get(ws) ?? [];
    list.push({ id, ref: noteRef(id, at), atMs: Date.parse(at) });
    out.set(ws, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.atMs - b.atMs || (a.id < b.id ? -1 : 1));
  return out;
}

// 끈 사람 = skipped_off, 그 밖 = send. 조용한 시간은 보지 않는다(위 머리말).
export function noteDecision(prefs: unknown): "send" | "skipped_off" {
  const p = prefs && typeof prefs === "object" && !Array.isArray(prefs) ? prefs as Record<string, unknown> : {};
  const kinds = p.kinds && typeof p.kinds === "object" && !Array.isArray(p.kinds) ? p.kinds as Record<string, unknown> : {};
  return kinds[NOTE_KIND] === false ? "skipped_off" : "send";
}
