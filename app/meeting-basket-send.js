// MEET-기록보내기 1단계: 회의 결과(또는 길게 눌러 고른 부분)를 바구니 메모 하나로 담는다.
// 새 저장 경로 없음: basket-data.js 의 createNote(app_notes 삽입, owner RLS)를 그대로 쓴다.
// 서버에 회의 출처를 남기는 칸(source_meeting_id)과 기록(🗒) 연결은 후속 DB 단계다.
import { createNote } from './basket-data.js';
import { seoulDateKey } from './meeting-time.js';
export const MEMO_LIMIT = 20000;
const TRUNCATED = '\n…(뒷부분 잘림)';
const chars = text => [...String(text ?? '')];
// 회의 결과 읽기 칸 안에서 고른 글만 돌려준다(없으면 빈 글).
export function selectedResultText(root, selection) {
  if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) return '';
  const range = selection.getRangeAt(0);
  return root.contains(range.commonAncestorContainer) ? selection.toString().trim() : '';
}
// 출처 한 줄 + 본문. 전체가 20,000자를 넘으면 본문을 줄이고 잘림 표시를 붙인다(B7).
export function buildMeetingMemo({ name, roundNo, meetingAt, body, kind = 'meeting', limit = MEMO_LIMIT }) {
  const date = meetingAt && !Number.isNaN(new Date(meetingAt).getTime()) ? seoulDateKey(new Date(meetingAt)) : '';
  const label = [String(name || '').trim() || '회의', roundNo ? `${roundNo}차` : ''].filter(Boolean).join(' ');
  const head = `출처: ${label} ${kind && kind !== 'meeting' ? '사업 보고' : '회의'}${date ? ` (${date})` : ''}\n\n`;
  const text = String(body ?? '').trim();
  const all = chars(head + text);
  if (all.length <= limit) return { raw_text: head + text, truncated: false };
  const keep = limit - chars(TRUNCATED).length;
  return { raw_text: all.slice(0, keep).join('') + TRUNCATED, truncated: true };
}
export async function sendMeetingToBasket(meeting, body, rt = window.KPTURuntime) {
  if (!String(body ?? '').trim()) throw new Error('담을 글이 없습니다.');
  const { raw_text, truncated } = buildMeetingMemo({ name: meeting?.series_name || meeting?.title, roundNo: meeting?.round_no, meetingAt: meeting?.meeting_at, body, kind: meeting?.activity_kind });
  // B3: 바구니 메모 날짜는 보낸 날이 아니라 회의 날짜.
  const occurred_at = Number.isNaN(Date.parse(meeting?.meeting_at)) ? undefined : new Date(meeting.meeting_at).toISOString();
  const note = await createNote({ raw_text, occurred_at }, rt);
  window.dispatchEvent(new CustomEvent('kptu:basket-note-created'));
  return { note, truncated };
}
