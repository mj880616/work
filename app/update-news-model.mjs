// UPDATE-운영자전용기록업데이트소식 PR3(시안 PR 2638 + 사용자 11/15 13:37): '업데이트 소식' 계산(DOM·네트워크 없음).
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
 *  시작 날짜가 없으면 오늘로 정하기 칸을 기본으로 켜고(추천안, 사용자 확인 대기), 시작 날짜가 오늘보다 뒤면 당기기 칸을 꺼 둔다(이미 정한 값이라). */
export function sendStartHint(startOn, today) {
  if (!startOn) return {text: '시작 날짜가 없어 이용자에게 아직 안 보여요', option: `오늘(${shortDay(today)})부터 보이게 시작 날짜도 정하기`, checked: true};
  if (startOn > today) return {text: `시작 날짜(${shortDay(startOn)}) 앞이라 이 소식은 이용자에게 아직 안 보여요`, option: `시작 날짜를 오늘(${shortDay(today)})로 당기기`, checked: false};
  return null;
}

// ── S68-14(사용자 11/22 "업데이트 기록 보낸 후 거둬들일 수가 없음"): 기록 줄의 [보냄]을 눌러 그 기록이 든 소식을 거둔다.
/** 기록 버전 v(또는 기록 {v,file})가 들어 있는 보낸(거두지 않은) 소식 id들과, 그 소식들에 같이 묶인 다른 기록 개수. 없으면 ids는 빈 배열. */
export function withdrawPlan(items, v) {
  return notePlan((items || []).filter(item => !item.withdrawn_at && newsHasNote(item, v)), v);
}

// ── S68-46 UPDATE-소식자동(사용자 11/23 12:37 "업데이트 기록 기본 자동으로 보내고 수동으로는 회수 가능하게"):
// 새 기록은 배포되면 서버가 자동으로 소식 하나씩 보낸다(app_release_notes_put → private.app_update_news_auto, 자동 소식은 auto·source_files를 가짐).
// 화면은 기록 줄 버튼 하나로 [보내기](아직 안 나감) · [보냄](눌러서 거두기) · [다시 보내기](거둔 것)를 보인다.

/** 소식 하나가 기록 note({v,file} 또는 버전명 문자열)를 담았나. 기록 파일 이름(source_files)이 있으면 그것으로 가리고
 *  (버전명 순번은 같은 날 기록이 늦게 들어오면 밀리므로), 없으면(손으로 보낸 소식) 버전명으로. */
export function newsHasNote(item, note) {
  const key = typeof note === 'string' ? {v: note} : (note || {});
  if (!item) return false;
  if (Array.isArray(item.source_files) && item.source_files.length) return !!key.file && item.source_files.includes(key.file);
  return !!key.v && (item.sources || []).includes(key.v);
}

function notePlan(hits, note) {
  const key = typeof note === 'string' ? {v: note} : (note || {});
  const others = new Set();
  for (const item of hits) {
    const byFile = Array.isArray(item.source_files) && item.source_files.length;
    for (const s of (byFile ? item.source_files : item.sources) || []) if (s !== (byFile ? key.file : key.v)) others.add(s);
  }
  return {ids: hits.map(item => item.id), others: others.size};
}

/** 기록 줄 버튼의 상태: 'sent'(거두지 않은 소식에 들어 있음) · 'withdrawn'(거둔 소식에만 있음) · ''(아직 안 나감). */
export function noteState(items, note) {
  const hits = (items || []).filter(item => newsHasNote(item, note));
  if (hits.some(item => !item.withdrawn_at)) return 'sent';
  return hits.length ? 'withdrawn' : '';
}

/** 거둔 기록을 다시 보낼 때: 그 기록이 든 거둔 소식 중 가장 최근 것 하나(목록은 최신 먼저)와 같이 묶인 다른 기록 개수. */
export function resendPlan(items, note) {
  const hit = (items || []).find(item => item.withdrawn_at && newsHasNote(item, note));
  return notePlan(hit ? [hit] : [], note);
}

/** 다시 보내기 확인 창 글과 아래 한 줄. */
export const RESEND_TEXT = '이 소식을 다시 보낼까요? 이용자 화면에 다시 보여요.';
export function resendNote(others) {
  return others > 0 ? `같이 보낸 기록 ${others}개도 함께 다시 보여요` : '';
}

/** 거두기 확인 창 글(기존 [거두기]와 같은 문구)과, 같이 묶인 기록이 있으면 아래 한 줄. */
export const WITHDRAW_TEXT = '이 소식을 거둘까요? 이용자 화면에서 사라져요.';
export function withdrawNote(others) {
  return others > 0 ? `같이 보낸 기록 ${others}개도 함께 거둬져요` : '';
}
