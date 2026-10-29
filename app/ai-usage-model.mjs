// AI-사용량줄: 홈 'AI 사용량 · n월 1일~d일 (이번 달, 추정)' 줄의 글·숫자 만들기(그리기 전 순수 함수). 숫자는 서버(drive-summary 상태 답 ai_usage)가 셈한다.
// 화면은 받은 원 금액을 보여 주기만 하고 단가·상한을 따로 갖지 않는다(단가·상한은 서버 _shared/ai-model.ts 한 곳).
// 기간·월말 예상만 화면에서 셈한다(서울 날짜 기준, 매달 1일부터 다시 셈 — 서버도 같은 달만 더한다).
// 충전 잔액·실제 청구 입력은 없앴다(10/28 요청함). 이미 넣은 값은 서버 표에 그대로 남는다.
export const WARN_RATIO = 0.8;
const KST = 9 * 3600000;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const num = v => (Number.isFinite(v) ? v : 0);
export const krw = v => `${Math.round(num(v)).toLocaleString('ko-KR')}원`;

// 서버 답 모양 검사. 틀리면 null(줄을 숨김).
export function readSummary(data) {
  if (!data || data.ok !== true || typeof data.month !== 'string' || !/^\d{4}-\d{2}$/.test(data.month)) return null;
  if (!data.openai || typeof data.openai !== 'object' || !data.gemini || typeof data.gemini !== 'object') return null;
  return data;
}
export function monthLabel(month) { return `${Number(month.slice(5, 7))}월`; }

// 서울 날짜로 이번 달 셈 기간. 답의 달이 오늘 달이면 1일~오늘, 지난 달 답이면 그 달 전체.
export function periodOf(month, now = Date.now()) {
  const today = new Date(now + KST).toISOString().slice(0, 10);
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const current = today.slice(0, 7) === month;
  const end = current ? Number(today.slice(8, 10)) : month < today.slice(0, 7) ? days : 1;
  return {month:m, end, days, current};
}
export function titleText(s, now = Date.now()) {
  const p = periodOf(s.month, now);
  const range = p.end > 1 ? `${p.month}월 1일~${p.end}일` : `${p.month}월 1일`;
  return `AI 사용량 · ${range} (${p.current ? '이번 달, ' : ''}추정)`;
}
// 이 속도면 월말 약 ○원: 지금까지 합 ÷ 지난 날 수 × 그 달 날 수, 10원 단위. 이번 달 답일 때만.
export function monthEnd(s, now = Date.now()) {
  const p = periodOf(s.month, now);
  if (!p.current) return null;
  const total = num(s.openai.krw) + num(s.gemini.krw);
  return Math.round(total / p.end * p.days / 10) * 10;
}

// 경고 문장(노란 줄): 월 상한 80%만. 서버가 잔액 코드를 보내도 화면에 쓰지 않는다.
export function warnText(s) {
  const list = Array.isArray(s?.warn) ? s.warn : [];
  const texts = list.map(code => {
    if (code === 'openai_limit') return `Web2 AI 이번 달 상한 ${Math.round(WARN_RATIO * 100)}% 넘음 (${krw(s.openai.assist_krw)} / ${krw(s.openai.limit_assist_krw)})`;
    if (code === 'feed_limit') return `텔레그램·통화 판정 상한 ${Math.round(WARN_RATIO * 100)}% 넘음 (${krw(num(s.openai.telegram_krw) + num(s.openai.call_krw))} / ${krw(s.openai.limit_feed_krw)})`;
    return '';
  }).filter(Boolean);
  if (!texts.length) return '';
  return texts.length > 1 ? `${texts[0]} 외 ${texts.length - 1}건` : texts[0];
}

export function summaryLine(s, now = Date.now()) {
  const parts = [`OpenAI ${krw(s.openai.krw)}`, `Gemini ${krw(s.gemini.krw)}`];
  const end = monthEnd(s, now);
  if (end != null) parts.push(`이 속도면 월말 약 ${krw(end)}`);
  return parts.join(' · ');
}

// 막대 비율(0~1). Web2 AI 기능 상한 기준(서버가 막는 기준과 같음).
export function barRatio(s) {
  const limit = num(s.openai.limit_assist_krw);
  return limit > 0 ? Math.min(1, Math.max(0, num(s.openai.assist_krw) / limit)) : 0;
}

const row = (label, value, note = '') => `<li class="aiu-row"><span class="aiu-name">${esc(label)}${note ? ` <span class="aiu-note">${esc(note)}</span>` : ''}</span><span class="aiu-value">${esc(value)}</span></li>`;

export function detailRows(s) {
  const o = s.openai, g = s.gemini, rows = [];
  const pct = Math.round(barRatio(s) * 100);
  rows.push(`<li class="aiu-row"><span class="aiu-name">Web2 AI 기능</span><span class="aiu-value">${esc(`${krw(o.assist_krw)} / 한 달 상한 ${krw(o.limit_assist_krw)}`)}</span><span class="aiu-bar" role="img" aria-label="Web2 AI 기능 상한의 ${pct}%"><span style="width:${pct}%"${pct >= WARN_RATIO * 100 ? ' data-warn' : ''}></span></span></li>`);
  rows.push(row('텔레그램·통화 판정', `${krw(num(o.telegram_krw) + num(o.call_krw))} / 한 달 상한 ${krw(o.limit_feed_krw)}`, num(o.call_krw) ? `텔레그램 ${krw(o.telegram_krw)}` : ''));
  rows.push(row('전사·분석(Gemini)', krw(g.krw), Array.isArray(g.unknown_models) && g.unknown_models.length ? '단가 미확인 모델 있음' : ''));
  if (num(g.transcript_krw) || num(g.analysis_krw)) rows.push(row('· 전사 / 분석', `${krw(g.transcript_krw)} / ${krw(g.analysis_krw)}`));
  return rows.join('');
}
