// UPDATE-운영자전용기록업데이트소식 PR3(시안 PR 2638 + 명진 11/15 13:37): '업데이트 소식' 계산(DOM·네트워크 없음).
// - 운영자가 개발 기록 줄을 골라(여러 기록 묶기 가능) 문구를 고쳐 보낸다. '폰에서 볼 것' 줄은 기본으로 빼고, 넣기를 고르면 붙인다.
// - 서버(app_update_news_*)가 쓰기는 운영자만, 읽기는 로그인 이용자(시작 날짜 이후·거두지 않은 것)로 막는다. 여기서는 모양만 다룬다.
export const LINES_MAX = 12, LINE_MAX = 200, TITLE_MAX = 80, SOURCES_MAX = 30;

/** 고른 기록들(최신 먼저 순서 그대로) → 보낼 줄. withChecks면 '폰에서 볼 것' 줄도 뒤에 붙인다. 같은 줄은 한 번만. */
export function draftLines(notes, {withChecks = false} = {}) {
  const out = [];
  for (const note of notes || []) {
    for (const line of note.changes || []) out.push(line);
    if (withChecks) for (const line of note.checks || []) out.push(line);
  }
  return [...new Set(out.map(line => String(line).trim()).filter(Boolean))].slice(0, LINES_MAX);
}

/** 글 칸(줄마다 한 줄) → 서버로 보낼 줄 목록. 빈 줄은 버리고 줄 앞 '· ', '- '는 뗀다. */
export function linesFromText(text) {
  return String(text ?? '').split(/\r?\n/).map(line => line.replace(/^\s*[·\-•*]\s+/, '').trim()).filter(Boolean);
}

/** 보내기 전 검사. 문제가 없으면 '' 아니면 한 줄 안내. */
export function draftProblem({title = '', lines = []} = {}) {
  if (!lines.length) return '보낼 글을 한 줄 이상 써 주세요';
  if (lines.length > LINES_MAX) return `줄은 ${LINES_MAX}줄까지예요`;
  if (lines.some(line => [...line].length > LINE_MAX)) return `한 줄은 ${LINE_MAX}자까지예요`;
  if ([...String(title).trim()].length > TITLE_MAX) return `제목은 ${TITLE_MAX}자까지예요`;
  return '';
}

/** 이미 보낸(거두지 않은) 소식에 들어간 기록 버전명 모음 → 기록 줄의 '보냄' 표시. */
export function sentVersions(items) {
  const out = new Set();
  for (const item of items || []) if (!item.withdrawn_at) for (const v of item.sources || []) out.add(v);
  return out;
}

/** 서울 날짜(YYYY-MM-DD) 그날 0시 이후에 보냈는가 — 서버와 같은 기준(시작 날짜 0시, 서울). */
export function afterStart(sentAt, startOn) {
  if (!startOn || !sentAt) return false;
  return Date.parse(sentAt) >= Date.parse(`${startOn}T00:00:00+09:00`);
}

/** 관리 목록에서 '여기부터 위만 이용자에게 보임' 줄이 들어갈 자리(그 앞까지가 보이는 것). 없으면 목록 길이. */
export function cutIndex(items, startOn) {
  const at = (items || []).findIndex(item => !afterStart(item.sent_at, startOn));
  return at < 0 ? (items || []).length : at;
}

/** 11/20 모양 날짜(서울). */
export function shortDay(value) {
  if (!value) return '';
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date(Date.parse(value) + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const [, mm, dd] = day.split('-');
  return `${Number(mm)}/${Number(dd)}`;
}

// ── UPDATE-소식안보임(요청함 11/16 09:21): 시작 날짜가 없거나 보낸 소식이 시작 날짜 앞이면 이용자 화면에 안 보인다(서버 app_update_news_list 규칙 그대로).
// 운영자 화면이 그 사실을 한 줄로 알려 주고, 처음 보낼 때는 시작 날짜를 오늘로 같이 정하게 한다.

/** 오늘 서울 날짜(YYYY-MM-DD). */
export function seoulToday(now = Date.now()) {
  return new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 보낸 소식 목록 위 안내 한 줄. 시작 날짜 없음 / 거두지 않은 소식 중 시작 날짜 앞인 것 n개 / 문제없음(''). */
export function startGapText(items, startOn) {
  if (!startOn) return '시작 날짜가 없어 이용자에게 아직 안 보여요';
  const hidden = (items || []).filter(item => !item.withdrawn_at && !afterStart(item.sent_at, startOn)).length;
  return hidden ? `보낸 소식 ${hidden}개는 시작 날짜 앞이라 이용자에게 안 보여요` : '';
}

/** 지금 보내는 새 소식이 이용자에게 보이는지 → 보내기 창 안내와 '시작 날짜도 정하기' 칸. 보이면 null.
 *  시작 날짜가 없으면 오늘로 정하기 칸을 기본으로 켜고(추천안, 명진 확인 대기), 시작 날짜가 오늘보다 뒤면 당기기 칸을 꺼 둔다(이미 정한 값이라). */
export function sendStartHint(startOn, today) {
  if (!startOn) return {text: '시작 날짜가 없어 이용자에게 아직 안 보여요', option: `오늘(${shortDay(today)})부터 보이게 시작 날짜도 정하기`, checked: true};
  if (startOn > today) return {text: `시작 날짜(${shortDay(startOn)}) 앞이라 이 소식은 이용자에게 아직 안 보여요`, option: `시작 날짜를 오늘(${shortDay(today)})로 당기기`, checked: false};
  return null;
}
