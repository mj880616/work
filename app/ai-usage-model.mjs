// AI-비용보기(6단계): 내 프로필 '사용 현황' 칸 'AI 비용' 줄의 글·숫자 만들기(그리기 전 순수 함수). 숫자는 서버(drive-summary 상태 답 ai_usage)가 셈한다.
// 화면은 받은 원 금액을 보여 주기만 하고 단가·상한을 따로 갖지 않는다(단가·상한은 서버 _shared/ai-prices.mjs 한 곳).
// - 월말 예상: 서버 forecast(최근 14일 하루 평균, 설계 docs/design/ai-cost-view.md 4절)가 있으면 그 값, 옛 서버 답이면 단순 비례(지금까지 ÷ 지난 날 × 그 달 날).
// - 기능별 표: OpenAI는 openai.by_feature(기능별 기록 표) + 그 전 사용 '기능 구분 전' 한 줄, Gemini는 gemini.by_kind(회의·통화 전사·통화 분석). 합은 두 공급자 추정 합과 같다.
// - 한도·자동 충전 금액(Gemini 월 한도 kind cap, OpenAI 자동 충전 kind reload)은 서버 표 app_ai_cost_entries에만 저장한다(화면은 입력값 검사만).
import {word} from './brand/brand.mjs';
export const WARN_RATIO = 0.8;
export const AMOUNT_MAX = 100000000; // 서버 검사(app_ai_cost_entries_amount_check)와 같음
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
  return `AI 비용 · ${range} (${p.current ? '이번 달, ' : ''}추정)`;
}
const forecastOf = (s, provider) => {
  const f = s?.forecast?.[provider];
  return f && typeof f === 'object' && Number.isFinite(f.month_end_krw) ? f : null;
};
// 공급자 하나의 월말 예상(원). 서버 forecast 우선, 없으면 단순 비례(10원 단위). 이번 달 답일 때만.
export function providerMonthEnd(s, provider, now = Date.now()) {
  const p = periodOf(s.month, now);
  if (!p.current) return null;
  const f = forecastOf(s, provider);
  if (f) return Math.max(num(f.month_end_krw), num(s[provider]?.krw));
  return Math.round(num(s[provider]?.krw) / p.end * p.days / 10) * 10;
}
export function monthEnd(s, now = Date.now()) {
  const o = providerMonthEnd(s, 'openai', now), g = providerMonthEnd(s, 'gemini', now);
  return o === null || g === null ? null : o + g;
}

// 경고 문장(노란 줄, 하나만): 서버 순서 그대로(Gemini 한도 도달 > 서버 상한 80% > OpenAI 충전 잦음). 잔액 코드는 쓰지 않는다.
export function warnText(s) {
  const list = Array.isArray(s?.warn) ? s.warn : [];
  const o = s.openai, fg = s?.forecast?.gemini, fo = s?.forecast?.openai;
  const pct = `${Math.round(WARN_RATIO * 100)}%`;
  const texts = list.map(code => {
    if (code === 'gemini_cap' && fg?.cap_day) return `이 속도면 ${dayText(fg.cap_day)}에 Gemini 한도 — 회의·통화 전사가 멈춰요`;
    if (code === 'openai_limit') return word`WORK ON+ AI 이번 달 상한 ${pct} 넘음 (${krw(o.assist_krw)} / ${krw(o.limit_assist_krw)})`;
    if (code === 'feed_limit') return `텔레그램·통화 판정 상한 ${pct} 넘음 (${krw(num(o.telegram_krw) + num(o.call_krw))} / ${krw(o.limit_feed_krw)})`;
    if (code === 'news_limit') return `뉴스·번역 상한 ${pct} 넘음 (${krw(o.news_krw)} / ${krw(o.limit_news_krw)})`;
    if (code === 'openai_reload_often' && fo?.reloads_per_month) return `OpenAI 자동 충전이 한 달 약 ${fo.reloads_per_month}번 — 충전 금액을 올려 보세요`;
    return '';
  }).filter(Boolean);
  if (!texts.length) return '';
  return texts.length > 1 ? `${texts[0]} 외 ${texts.length - 1}건` : texts[0];
}
export function dayText(day) { return `${Number(day.slice(5, 7))}월 ${Number(day.slice(8, 10))}일`; }

export function summaryLine(s, now = Date.now()) {
  const parts = [`OpenAI ${krw(s.openai.krw)}`, `Gemini ${krw(s.gemini.krw)}`];
  const end = monthEnd(s, now);
  if (end != null) parts.push(`월말 약 ${krw(end)}`);
  return parts.join(' · ');
}

// 기능 이름(화면 말). 키는 서버 _shared/ai-features.mjs·drive-summary by_kind와 같다.
export const OPENAI_FEATURE_LABELS = Object.freeze({
  ledger:'원장 자동 기록', journal:'업무일지·정리', ask:'AI에 묻기', todo:'챙길 것', library:'자료실', meeting:'회의 요약',
  org:'조직 요약', telegram:'텔레그램·통화 판정', call_judge:'통화 다시 채우기', news:'뉴스·번역', other:'그 밖',
});
export const GEMINI_KIND_LABELS = Object.freeze({
  meeting:'회의 녹음 전사', call_transcript:'통화 전사', call_analysis:'통화 분석', other:'그 밖 전사·분석',
});

// 기능별 줄 [{key, provider, label, krw}] 금액 큰 순, 0원 줄 뺌. 두 공급자 '추정'(보정 전) 합과 같게 나눈다.
export function featureRows(s) {
  const o = s.openai, g = s.gemini, rows = [];
  const add = (provider, key, label, value) => { const v = Math.round(num(value)); if (v > 0) rows.push({key:`${provider}:${key}`, provider, label, krw:v}); };
  const oTotal = num(o.estimate_krw ?? o.krw);
  if (o.by_feature && typeof o.by_feature === 'object') {
    let sum = 0;
    for (const [k, v] of Object.entries(o.by_feature)) { add('openai', k, OPENAI_FEATURE_LABELS[k] || OPENAI_FEATURE_LABELS.other, v); sum += Math.round(num(v)); }
    add('openai', 'before', o.features_from ? `기능 구분 전(${dayText(o.features_from)} 전)` : '기능 구분 전', oTotal - sum);
  } else {
    add('openai', 'assist', word`WORK ON+ AI 기능(기능 구분 전)`, o.assist_krw);
    add('openai', 'judge', '텔레그램·통화 판정', num(o.telegram_krw) + num(o.call_krw));
    add('openai', 'news', '뉴스·번역', o.news_krw);
  }
  const gTotal = num(g.estimate_krw ?? g.krw);
  if (g.by_kind && typeof g.by_kind === 'object') {
    const k = g.by_kind;
    add('gemini', 'meeting', GEMINI_KIND_LABELS.meeting, k.meeting);
    add('gemini', 'call_transcript', GEMINI_KIND_LABELS.call_transcript, k.call_transcript);
    add('gemini', 'call_analysis', GEMINI_KIND_LABELS.call_analysis, k.call_analysis);
    add('gemini', 'other', GEMINI_KIND_LABELS.other, num(k.other_transcript) + num(k.other_analysis));
  } else add('gemini', 'all', '전사·분석', gTotal);
  // 같은 이름 OpenAI 기능이 둘이면(모르는 키 → 그 밖) 한 줄로 합친다.
  const merged = new Map();
  for (const r of rows) { const id = `${r.provider}:${r.label}`; const m = merged.get(id); if (m) m.krw += r.krw; else merged.set(id, {...r}); }
  return [...merged.values()].sort((a, b) => b.krw - a.krw || a.label.localeCompare(b.label, 'ko'));
}
export const featureTotal = rows => rows.reduce((a, r) => a + r.krw, 0);
export function featureSummary(rows) {
  if (!rows.length) return '기능별 · 아직 없음';
  return `기능별 ${rows.length}개 · 가장 큰 곳 ${rows[0].label} ${krw(rows[0].krw)}`;
}

// 서버 상한(서버가 실제로 막는 기준) 한 줄.
export function limitLine(s) {
  const o = s.openai;
  const parts = [word`WORK ON+ AI ${krw(o.assist_krw)}/${krw(o.limit_assist_krw)}`, `판정 ${krw(num(o.telegram_krw) + num(o.call_krw))}/${krw(o.limit_feed_krw)}`];
  if (num(o.limit_news_krw)) parts.push(`번역 ${krw(o.news_krw)}/${krw(o.limit_news_krw)}`);
  return `서버 상한 · ${parts.join(' · ')}`;
}

// 공급자 두 줄(시안 A): 이름·이번 달 / 아래 작은 줄(월말·충전·한도).
export function providerRows(s, now = Date.now()) {
  const fo = s?.forecast?.openai, fg = s?.forecast?.gemini;
  const oEnd = providerMonthEnd(s, 'openai', now), gEnd = providerMonthEnd(s, 'gemini', now);
  const oSub = [];
  if (oEnd !== null) oSub.push(`월말 약 ${krw(oEnd)}`);
  if (fo?.reload_krw) oSub.push(`자동 충전 ${krw(fo.reload_krw)}씩 → 한 달 약 ${fo.reloads_per_month ?? 0}번`);
  else if (fo?.suggest_reload_krw) oSub.push(`권장 자동 충전 ${krw(fo.suggest_reload_krw)}`);
  const gSub = [];
  let bar = '';
  if (fg?.cap_krw) {
    const pct = Math.min(100, Math.round(num(s.gemini.krw) / fg.cap_krw * 100));
    gSub.push(`한도 ${krw(fg.cap_krw)} 중 ${pct}%`);
    bar = `<span class="aiu-bar" role="img" aria-label="Gemini 한도의 ${pct}%"><span style="width:${pct}%"${pct >= WARN_RATIO * 100 || fg.cap_day ? ' data-warn' : ''}></span></span>`;
  }
  if (gEnd !== null) gSub.push(`월말 약 ${krw(gEnd)}`);
  if (fg?.cap_day) gSub.push(`${dayText(fg.cap_day)} 한도`);
  else if (fg?.raise_cap && fg.suggest_cap_krw) gSub.push(`권장 한도 ${krw(fg.suggest_cap_krw)}`);
  const one = (key, name, pay, value, sub, extra = '') => `<li class="aiu-row aiu-prov" data-aiu-prov="${key}"><span class="aiu-name"><span class="aiu-dot" data-p="${key}" aria-hidden="true"></span>${esc(name)} <span class="aiu-note">${esc(pay)}</span></span><span class="aiu-value">${esc(value)}</span>${extra}${sub.length ? `<span class="aiu-sub">${esc(sub.join(' · '))}</span>` : ''}</li>`;
  return one('openai', 'OpenAI', '선불', krw(s.openai.krw), oSub) + one('gemini', 'Gemini', '후불', krw(s.gemini.krw), gSub, bar);
}

export function featureRowsHtml(rows) {
  return rows.map(r => `<li class="aiu-row" data-aiu-feature="${esc(r.key)}"><span class="aiu-name"><span class="aiu-dot" data-p="${r.provider}" aria-hidden="true"></span>${esc(r.label)}</span><span class="aiu-value">${esc(krw(r.krw))}</span></li>`).join('');
}

// 지금 넣어 둔 한도·자동 충전 금액(서버 forecast가 가장 최근 값을 돌려줌). 없으면 null.
export function savedAmounts(s) {
  const cap = s?.forecast?.gemini?.cap_krw, reload = s?.forecast?.openai?.reload_krw;
  return {cap: Number.isSafeInteger(cap) && cap > 0 ? cap : null, reload: Number.isSafeInteger(reload) && reload > 0 ? reload : null};
}
// 입력 글 → 원(정수). 쉼표·'원'·빈칸은 무시. 빈 칸은 '안 바꿈'(undefined), 틀리면 null.
export function parseAmount(text) {
  const t = String(text ?? '').replace(/[,\s원]/g, '');
  if (!t) return undefined;
  if (!/^\d{1,9}$/.test(t)) return null;
  const n = Number(t);
  return n >= 0 && n <= AMOUNT_MAX ? n : null;
}
// 저장할 행(바뀐 것만). 0원은 '지움'(서버 계산이 0원 행은 안 씀).
export function changedEntries(s, {cap, reload}) {
  const saved = savedAmounts(s), out = [];
  if (cap !== undefined && cap !== null && cap !== (saved.cap ?? 0)) out.push({provider:'gemini', kind:'cap', amount_krw:cap});
  if (reload !== undefined && reload !== null && reload !== (saved.reload ?? 0)) out.push({provider:'openai', kind:'reload', amount_krw:reload});
  return out;
}
export const amountText = n => (Number.isSafeInteger(n) && n > 0 ? n.toLocaleString('ko-KR') : '');
