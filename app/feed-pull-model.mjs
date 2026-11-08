// S52-46 FEED-최신화즉시수집 3/3: 통화·텔레그램 [최신화]의 순수 규칙(문구·끝 판정). 화면 부품은 feed-pull.js.
// 서버: drive-summary POST ?action=collector_pull(소유자 JWT, 운영자 기능·하루 20번·3분 간격은 서버가 셈).
// 끝 판정: drive-summary GET ?action=status의 collectors.<출처>_send.reported_at(보내기 실행이 끝날 때 앱 스크립트가 알린 시각)이 요청 시각 뒤로 바뀌면 끝.
export const PULL_PATH = '/functions/v1/drive-summary?action=collector_pull';
export const STATUS_PATH = '/functions/v1/drive-summary?action=status';
export const PULL_POLL_MS = 20000;   // 20초마다 다시 읽기
export const PULL_POLL_MAX = 9;      // 3분까지

const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;
const time = v => (typeof v === 'string' && v.length <= 40 && ISO.test(v) && Number.isFinite(Date.parse(v)) ? v : null);

export const PULL_TEXT = Object.freeze({
  busy: '수집 요청 중…',
  sent: '수집 요청함 · 1~3분 안에 새 줄이 보여요',
  late: '수집 요청은 들어갔지만 아직 응답이 없어요 · 다음 매시 수집에 반영돼요',
});
const FAIL = Object.freeze({
  PULL_COOLDOWN: '방금 눌렀어요 · 3분 뒤에 다시 누를 수 있어요',
  PULL_DAILY_LIMIT: '오늘은 더 누를 수 없어요(하루 20번) · 매시 수집은 그대로 돌아요',
  NOT_OPERATOR: '이 작업공간에서는 쓸 수 없어요',
  FORBIDDEN: '이 작업공간에서는 쓸 수 없어요',
  PULL_WAKE_FAILED: '수집기를 깨우지 못했어요 · 다음 매시 수집을 기다려 주세요',
  SERVER_CONFIG_MISSING: '아직 준비 중이에요 · 매시 수집을 기다려 주세요',
  PULL_NOT_READY: '아직 준비 중이에요 · 매시 수집을 기다려 주세요',
});
export function pullFailText(code) {
  return FAIL[code] || '수집 요청을 보내지 못했어요 · 잠시 뒤 다시 눌러 주세요';
}
// 오류 → 서버 단계 코드(대문자 짧은 말만). 런타임 오류는 message에 서버 error 코드를 싣는다.
// 403은 앱 공용 fetch(auth-bootstrap.js)가 몸통을 '권한 확인 실패' 문장으로 바꾸므로 상태 번호로 본다.
export function pullErrorCode(error) {
  const m = String(error?.message ?? '');
  if (/^[A-Z][A-Z0-9_]{0,63}$/.test(m)) return m;
  return Number(error?.status) === 403 ? 'NOT_OPERATOR' : '';
}
// 성공 응답 → 요청 시각(ISO) 또는 null(모양이 다름).
export function pullAccepted(data, source) {
  return data && data.ok === true && data.source === source ? time(data.requested_at) : null;
}
const SEND = {telegram: 'telegram_send', call: 'call_send'};
const UPSTREAM = {telegram: 'telegram', call: 'transcript'};
// 상태 응답 → 끝났으면 {upstreamAt}(앞단 수집기가 마지막으로 올린 시각 또는 null), 아니면 null.
export function pullFinished(status, source, requestedAt) {
  const c = status && status.ok === true && status.collectors && typeof status.collectors === 'object' ? status.collectors : null;
  const send = c && c[SEND[source]], at = time(send?.reported_at), req = time(requestedAt);
  if (!at || !req || Date.parse(at) < Date.parse(req)) return null;
  return {upstreamAt: time(c[UPSTREAM[source]]?.last_at)};
}
const hm = iso => { const d = new Date(Date.parse(iso) + 9 * 3600000); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
export function pullDoneText(source, upstreamAt) {
  const who = source === 'call' ? '전사가 마지막으로 끝난 시각' : '수집기가 마지막으로 올린 시각';
  return `수집 끝${upstreamAt ? ` · ${who} ${hm(upstreamAt)}` : ''}`;
}
