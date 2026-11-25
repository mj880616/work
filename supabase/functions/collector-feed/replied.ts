// FORGET-이미한일빼기(S70-20, 명진 11/25: "텔레그램에서 내가 답변을 했다거나 하면 제안 없애든지").
// 텔레그램 '나한테 온 요청' 뒤에 내가(작업공간 주인) 이미 답했는지 판정하는 규칙 한 곳. AI를 쓰지 않는 글자 없는 판정이다
// (메시지 글은 보지 않고 보낸 사람이 '나'인지·답장 대상·시각만 본다).
//
// 답한 것으로 보는 때(둘 중 하나):
//   1) 내가 그 요청 메시지에 '답장'(reply_to = 요청 메시지)을 보냈다 — 1:1 방·단체방 모두. 요청 뒤 REPLY_LOOKBACK_MS 안.
//   2) 1:1 방(chat_kind=user)에서 요청 뒤 ASK_REPLY_WINDOW_MS(6시간) 안에 내가 그 방에 메시지를 보냈다.
//      단체방은 내 메시지가 다른 사람에게 한 말일 수 있어 2)를 쓰지 않는다(답장 표시가 있을 때만).
// 그렇지 않으면 그대로(처리 전). 남이 답한 것·전달한 메시지(forwarded)는 내 답으로 치지 않는다.
// 가족 방은 이 길(action=telegram)에 오지 않는다(FAMILY_ROOM 400) — 가족 제안은 건드리지 않는다.
export const ASK_REPLY_WINDOW_MS = 6 * 3600_000;
export const REPLY_LOOKBACK_MS = 3 * 86400_000;
export const AUTO_DONE_REPLIED = "replied";

export type ReplyMsg = { ref: string; at: number; self: boolean; reply_to: string | null; forwarded?: boolean };
export type AskAnchor = { ref: string; at: number };

export function askReplied(ask: AskAnchor, messages: readonly ReplyMsg[], personal: boolean): typeof AUTO_DONE_REPLIED | null {
  if (!ask || typeof ask.ref !== "string" || !Number.isFinite(ask.at)) return null;
  for (const m of messages) {
    if (!m || m.self !== true || m.forwarded === true || !Number.isFinite(m.at) || m.ref === ask.ref) continue;
    const gap = m.at - ask.at;
    if (gap <= 0) continue;
    if (m.reply_to === ask.ref && gap <= REPLY_LOOKBACK_MS) return AUTO_DONE_REPLIED;
    if (personal && gap <= ASK_REPLY_WINDOW_MS) return AUTO_DONE_REPLIED;
  }
  return null;
}

// FORGET-기본이미함(S70-20b, 명진 11/25 12:39 "모두 추천대로" ③): 명진을 '직접 부른' 요청인지. 직접 부른 요청은 마감 있는 요청과 함께
// ★로 묶음 맨 위에 두고, 하루 지나 저절로 '이미 함(지남)'으로 옮기는 대상(DB 예약 app_forget_auto_expire)에서 뺀다.
// 직접 부름으로 보는 때(하나라도): 1:1 방이다 / 그 요청이 내 메시지에 단 답장이다 / 그 요청 글에 내 이름(이름표 이름, 2자 이상)이나 @내 이름이 있다.
// 이름은 비교에만 쓰고 어디에도 남기지 않는다.
export type DirectMsg = { ref: string; self: boolean; reply_to: string | null; text: string };
export function askDirect(ask: DirectMsg, messages: readonly DirectMsg[], personal: boolean, selfNames: readonly string[] = []): boolean {
  if (personal) return true;
  if (!ask) return false;
  if (ask.reply_to && messages.some((m) => m && m.self === true && m.ref === ask.reply_to)) return true;
  const text = typeof ask.text === "string" ? ask.text.normalize("NFC") : "";
  return selfNames.some((n) => typeof n === "string" && [...n.trim()].length >= 2 && text.includes(n.trim().normalize("NFC")));
}

// FORGET-기본이미함 ② 흔적 넓히기(다른 방 답): 단체방에서 그 사람이 한 요청 뒤, 그 사람과의 1:1 방에 내가 메시지를 보냈다면 답한 것.
// 1:1 방은 상대가 한 사람뿐이라 내 메시지 = 그 사람에게 한 말. 요청 뒤 REPLY_LOOKBACK_MS(3일) 안, 전달한 메시지는 치지 않는다.
export function messagedAfter(askAt: number, messages: readonly ReplyMsg[]): boolean {
  if (!Number.isFinite(askAt)) return false;
  return messages.some((m) => m && m.self === true && m.forwarded !== true && Number.isFinite(m.at) && m.at > askAt && m.at - askAt <= REPLY_LOOKBACK_MS);
}
