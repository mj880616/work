// AI-사용량줄: 홈 'AI 사용량(n월, 추정)' 줄의 글·숫자 만들기(그리기 전 순수 함수). 숫자는 서버(drive-summary GET ?action=ai_usage)가 셈한다.
// 화면은 받은 원 금액을 보여 주기만 하고 단가·상한을 따로 갖지 않는다(단가·상한은 서버 _shared/ai-model.ts 한 곳).
export const WARN_RATIO = 0.8;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const num = v => (Number.isFinite(v) ? v : 0);
export const krw = v => `${Math.round(num(v)).toLocaleString('ko-KR')}원`;
const PROVIDER = {openai:'OpenAI', gemini:'Gemini'};

// 서버 답 모양 검사. 틀리면 null(줄을 숨김).
export function readSummary(data) {
  if (!data || data.ok !== true || typeof data.month !== 'string' || !/^\d{4}-\d{2}$/.test(data.month)) return null;
  if (!data.openai || typeof data.openai !== 'object' || !data.gemini || typeof data.gemini !== 'object') return null;
  return data;
}
export function monthLabel(month) { return `${Number(month.slice(5, 7))}월`; }

// 경고 문장(노란 줄). 서버 warn 코드 순서대로 첫 번째 + 나머지 건수.
export function warnText(s) {
  const list = Array.isArray(s?.warn) ? s.warn : [];
  const texts = list.map(code => {
    if (code === 'openai_limit') return `Web2 AI 이번 달 상한 ${Math.round(WARN_RATIO * 100)}% 넘음 (${krw(s.openai.assist_krw)} / ${krw(s.openai.limit_assist_krw)})`;
    if (code === 'feed_limit') return `텔레그램·통화 판정 상한 ${Math.round(WARN_RATIO * 100)}% 넘음 (${krw(num(s.openai.telegram_krw) + num(s.openai.call_krw))} / ${krw(s.openai.limit_feed_krw)})`;
    const m = /^(openai|gemini)_balance$/.exec(code);
    if (m) return `${PROVIDER[m[1]]} 잔액 ${krw(s[m[1]]?.balance?.left_krw)} — 충전 필요`;
    return '';
  }).filter(Boolean);
  if (!texts.length) return '';
  return texts.length > 1 ? `${texts[0]} 외 ${texts.length - 1}건` : texts[0];
}

export function summaryLine(s) {
  const parts = [`OpenAI ${krw(s.openai.krw)}`, `Gemini ${krw(s.gemini.krw)}`];
  const bal = s.openai.balance;
  if (bal) parts.push(`잔액 ${krw(bal.left_krw)}`);
  return parts.join(' · ');
}

// 막대 비율(0~1). Web2 AI 전체 상한 기준(서버가 막는 기준과 같음).
export function barRatio(s) {
  const limit = num(s.openai.limit_assist_krw);
  return limit > 0 ? Math.min(1, Math.max(0, num(s.openai.assist_krw) / limit)) : 0;
}

const tag = p => (p.actual ? '실제' : p.ratio ? `보정 ×${p.ratio}` : '추정');
const row = (label, value, note = '') => `<li class="aiu-row"><span class="aiu-name">${esc(label)}${note ? ` <span class="aiu-note">${esc(note)}</span>` : ''}</span><span class="aiu-value">${esc(value)}</span></li>`;

export function detailRows(s) {
  const o = s.openai, g = s.gemini, rows = [];
  const pct = Math.round(barRatio(s) * 100);
  rows.push(`<li class="aiu-row aiu-main"><span class="aiu-name">Web2 AI(OpenAI) <span class="aiu-note">${esc(tag(o))}</span></span><span class="aiu-value">${esc(krw(o.krw))}</span><span class="aiu-bar" role="img" aria-label="Web2 AI 상한의 ${pct}%"><span style="width:${pct}%"${pct >= WARN_RATIO * 100 ? ' data-warn' : ''}></span></span></li>`);
  rows.push(row('· Web2 AI 기능', `${krw(o.assist_krw)} / ${krw(o.limit_assist_krw)}`));
  rows.push(row('· 텔레그램·통화 판정', `${krw(num(o.telegram_krw) + num(o.call_krw))} / ${krw(o.limit_feed_krw)}`, num(o.call_krw) ? `텔레그램 ${krw(o.telegram_krw)}` : '1시간마다 수집'));
  rows.push(row('전사·분석(Gemini)', krw(g.krw), [tag(g), Array.isArray(g.unknown_models) && g.unknown_models.length ? '단가 미확인 모델 있음' : ''].filter(Boolean).join(' · ')));
  if (num(g.transcript_krw) || num(g.analysis_krw)) rows.push(row('· 전사 / 분석', `${krw(g.transcript_krw)} / ${krw(g.analysis_krw)}`));
  for (const p of ['openai', 'gemini']) {
    const b = s[p].balance;
    if (b) rows.push(row(`${PROVIDER[p]} 충전 잔액`, krw(b.left_krw), `${b.topup_on.slice(5).replace('-', '/')} ${krw(b.topup_krw)} 충전 뒤`));
    else if (p === 'openai') rows.push(row('OpenAI 충전 잔액', '—', '충전 금액을 넣으면 보임'));
    if (s[p].last_bill) rows.push(row(`${PROVIDER[p]} ${monthLabel(s[p].last_bill.month)} 실제 청구`, krw(s[p].last_bill.krw)));
  }
  return rows.join('');
}

export function entryRows(s) {
  const list = Array.isArray(s.entries) ? s.entries : [];
  if (!list.length) return '';
  return list.map(e => `<li class="aiu-entry"><span>${esc(PROVIDER[e.provider] || '')} ${e.kind === 'bill' ? `${esc(monthLabel(e.month || '0000-00'))} 청구` : '충전'} ${esc(krw(e.amount_krw))}</span><button type="button" class="aiu-entry-del" data-aiu-delete="${esc(e.id)}" aria-label="이 입력 지우기">✕</button></li>`).join('');
}

// 입력 검사: 금액 0~1억 원 정수, 청구 달은 YYYY-MM.
export function parseEntry({provider, kind, amount, month}) {
  if (!['openai', 'gemini'].includes(provider) || !['topup', 'bill'].includes(kind)) return null;
  const n = Number(String(amount ?? '').replace(/[,\s원]/g, ''));
  if (!Number.isSafeInteger(n) || n < 0 || n > 100000000) return null;
  if (kind === 'bill') {
    if (!/^\d{4}-\d{2}$/.test(month || '') || month < '2026-01') return null;
    return {provider, kind, amount_krw:n, month:`${month}-01`};
  }
  return {provider, kind, amount_krw:n, month:null};
}
export function lastMonth(now = Date.now()) {
  const d = new Date(now + 9 * 3600000);
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  return m === 0 ? `${y - 1}-12` : `${y}-${String(m).padStart(2, '0')}`;
}
