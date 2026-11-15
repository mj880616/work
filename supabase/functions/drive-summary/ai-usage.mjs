// AI-사용량줄: 홈 수집 칸 아래 'AI 사용량(이번 달, 추정)' 한 줄의 서버 쪽.
// - POST ?action=ai_usage: 회사 PC 전사·분석 스크립트(Gemini)가 AI를 부를 때 돌려받은 사용량(토큰 숫자)을 보고한다.
//   수집 점검 신호(heartbeat)와 같은 비밀값 머리글만 받는다. 몸통은 숫자·모델 이름·보고 번호(ref)뿐이고 글·전사 내용은 받지 않는다.
//   같은 ref를 다시 보내면 한 번만 들어간다(app_ai_external_usage, 넣기만).
// - GET ?action=ai_usage: 소유자 JWT만. 이번 달 OpenAI(Web2 서버 AI: ai-assist의 app_ai_daily_usage + collector-feed의 app_feed_days.ai_*)·
//   + 뉴스·사회운동 [번역]의 app_news_days.ai_*(AI-비용보기 3단계)·Gemini(위 보고) 사용량을 단가(_shared/ai-prices.mjs)로 셈해 원으로 돌려주고, 명진이 넣은 충전·청구 금액(app_ai_cost_entries)으로
//   잔액과 보정 비율을 계산한다. 읽기는 호출한 사람의 토큰 + anon 키(소유자 RLS)로만 한다(서버 키로 읽지 않음).
// 금액은 모두 '추정'이다. OpenAI·Gemini 모두 잔액을 프로그램으로 주지 않으므로(관리자 키는 쓰지 않음) 충전 금액에서 쓴 만큼 뺀다.
import {
  AI_MONTHLY_LIMIT_ASSIST_KRW, AI_MONTHLY_LIMIT_FEED_KRW, AI_MONTHLY_LIMIT_NEWS_KRW, OPENAI_DEFAULT_IN_KRW, OPENAI_DEFAULT_OUT_KRW, geminiKrw, geminiPrice,
} from '../_shared/ai-prices.mjs';

export const AI_USAGE_BODY_BYTES = 1024;
export const WARN_RATIO = 0.8;          // 월 상한 80%(명진 결정 10/28 00:55)
export const WARN_BALANCE_KRW = 10000;  // 잔액 1만 원 아래
export const RATIO_RANGE = Object.freeze([0.25, 4]);
const KEYS = Object.freeze(['ref', 'provider', 'source', 'model', 'calls', 'input_tokens', 'audio_tokens', 'output_tokens']);
const SOURCES = Object.freeze(['transcript', 'analysis']);
const REF = /^[A-Za-z0-9_.:-]{8,80}$/;
// AI-비용보기 2단계: 보고 번호(ref) 앞머리로 어디서 쓴 것인지 나눈다.
// - mtg-·mtgfail-: 회의 녹음 전사(meeting-transcribe가 서버 안에서 직접 넣음). 수집 비밀값 보고로는 받지 않는다(회의 월 상한을 부풀리지 못하게).
// - call-: 통화 전사(source transcript), calla-: 통화 분석(source analysis). 명진 앱 스크립트가 docs/ops/ai-usage-report.gs로 보낸다.
// - 그 밖: 옛 보고(앞머리 없음) — source로만 나눈다.
export const REF_MEETING = Object.freeze(['mtg-', 'mtgfail-']);
export const REF_CALL_TRANSCRIPT = 'call-';
export const REF_CALL_ANALYSIS = 'calla-';
export function usageKind(ref, source) {
  const r = typeof ref === 'string' ? ref : '';
  if (REF_MEETING.some(p => r.startsWith(p))) return 'meeting';
  if (r.startsWith(REF_CALL_TRANSCRIPT)) return 'call_transcript';
  if (r.startsWith(REF_CALL_ANALYSIS)) return 'call_analysis';
  return source === 'analysis' ? 'other_analysis' : 'other_transcript';
}
const MODEL = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const PRICE = /^\d{1,6}(\.\d{1,4})?$/;
const TOKENS_MAX = 1_000_000_000, CALLS_MAX = 10000, KST = 9 * 3600000;
const int = (v, max) => Number.isSafeInteger(v) && v >= 0 && v <= max;

export function seoulDay(at) { return new Date(at.getTime() + KST).toISOString().slice(0, 10); }
export function monthOf(day) { return `${day.slice(0, 7)}-01`; }
function addMonths(first, n) {
  const [y, m] = first.split('-').map(Number), d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

// 보고 몸통 검사. 틀리면 null(400). provider는 지금 gemini만.
export function parseAiUsageReport(text) {
  if (typeof text !== 'string' || !text || new TextEncoder().encode(text).length > AI_USAGE_BODY_BYTES) return null;
  let body;
  try { body = JSON.parse(text); } catch { return null; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (Object.keys(body).some(key => !KEYS.includes(key))) return null;
  const provider = body.provider ?? 'gemini';
  if (provider !== 'gemini' || typeof body.ref !== 'string' || !REF.test(body.ref)) return null;
  if (!SOURCES.includes(body.source) || typeof body.model !== 'string') return null;
  if (REF_MEETING.some(p => body.ref.startsWith(p))) return null;
  if (body.ref.startsWith(REF_CALL_TRANSCRIPT) && body.source !== 'transcript') return null;
  if (body.ref.startsWith(REF_CALL_ANALYSIS) && body.source !== 'analysis') return null;
  const model = body.model.trim().toLowerCase().replace(/^models\//, '');
  if (!MODEL.test(model)) return null;
  const calls = body.calls ?? 1, audio = body.audio_tokens ?? 0;
  if (!int(calls, CALLS_MAX) || !int(body.input_tokens, TOKENS_MAX) || !int(audio, TOKENS_MAX) || !int(body.output_tokens, TOKENS_MAX)) return null;
  if (audio > body.input_tokens) return null;
  return { ref: body.ref, provider, source: body.source, model, calls, input_tokens: body.input_tokens, audio_tokens: audio, output_tokens: body.output_tokens };
}

// 운영 비밀값 WEB2_AI_PRICE_*가 있으면 ai-assist·collector-feed처럼 그 값을 쓴다(이상한 값이면 기본값).
export function openAiPrice(env = {}) {
  const pin = String(env.WEB2_AI_PRICE_IN_KRW_PER_MTOK ?? '').trim(), pout = String(env.WEB2_AI_PRICE_OUT_KRW_PER_MTOK ?? '').trim();
  const ok = v => v && PRICE.test(v) && Number(v) > 0;
  return { input: ok(pin) ? Number(pin) : OPENAI_DEFAULT_IN_KRW, output: ok(pout) ? Number(pout) : OPENAI_DEFAULT_OUT_KRW };
}
const tok = v => (Number.isSafeInteger(Number(v)) && Number(v) >= 0 ? Number(v) : 0);
const openAiKrw = (input, output, price) => (input * price.input + output * price.output) / 1_000_000;
const won = n => Math.round(n);
const isDay = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

function addDays(day, n) { return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10); }
function daysInMonth(first) { return Math.round((Date.parse(`${addMonths(first, 1)}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86400000); }
export const AVG_DAYS = 14, PEAK_DAYS = 7;

// 읽을 기간의 시작: 이번 달 1일, 하루 평균용 14일 전, 가장 최근 충전일, 가장 최근 청구 달 중 가장 이른 날(단, 12달 전보다 이르지 않게).
export function readStart(entries, today) {
  const month = monthOf(today), floor = addMonths(month, -12);
  let start = month;
  const avgFrom = addDays(today, -AVG_DAYS);
  if (avgFrom < start) start = avgFrom;
  for (const e of entries) {
    const d = e.kind === 'topup' ? seoulDay(new Date(e.created_at)) : e.month;
    if (isDay(d) && d < start) start = d;
  }
  return start < floor ? floor : start;
}

// 날짜별 원(추정). openai: {day: {assist, telegram, call, news}}, gemini: {day: krw}.
function byDay(rows, price) {
  const openai = new Map(), gemini = new Map(), unknown = new Set();
  const o = day => { if (!openai.has(day)) openai.set(day, { assist: 0, telegram: 0, call: 0, news: 0, requests: 0 }); return openai.get(day); };
  for (const r of rows.assist) if (isDay(r?.day)) { const d = o(r.day); d.assist += openAiKrw(tok(r.input_tokens), tok(r.output_tokens), price); d.requests += tok(r.requests); }
  for (const r of rows.feed) if (isDay(r?.day) && (r.source === 'telegram' || r.source === 'call')) {
    const d = o(r.day); d[r.source] += openAiKrw(tok(r.ai_input_tokens), tok(r.ai_output_tokens), price); d.requests += tok(r.ai_requests);
  }
  // 뉴스·사회운동 [번역]: news-feed·outside-feed가 하루 한 행에 더한다(서버 상한 계산과 같은 OpenAI 단가).
  for (const r of rows.news || []) if (isDay(r?.day)) { const d = o(r.day); d.news += openAiKrw(tok(r.ai_input_tokens), tok(r.ai_output_tokens), price); d.requests += tok(r.ai_requests); }
  for (const r of rows.external) if (isDay(r?.day) && typeof r.model === 'string') {
    const krw = geminiKrw(r.model, tok(r.input_tokens), tok(r.audio_tokens), tok(r.output_tokens));
    gemini.set(r.day, (gemini.get(r.day) || 0) + krw);
    if (!geminiPrice(r.model)) unknown.add(r.model);
    r.month = monthOf(r.day);
    r._krw = krw;
  }
  return { openai, gemini, unknown };
}
const sumRange = (map, from, to, pick) => { let s = 0; for (const [day, v] of map) if (day >= from && day < to) s += pick(v); return s; };
const openTotal = v => v.assist + v.telegram + v.call + v.news;

// 가장 최근 지난달 이전 청구 금액 ÷ 그 달 추정 = 보정 비율(0.25~4). 없거나 추정이 0이면 null.
function ratioFor(bills, estimateOf, month) {
  const past = bills.filter(b => isDay(b.month) && b.month < month).sort((a, b) => (a.month < b.month ? 1 : -1));
  for (const b of past) {
    const est = estimateOf(b.month);
    if (est > 0) return Math.min(RATIO_RANGE[1], Math.max(RATIO_RANGE[0], b.amount_krw / est));
  }
  return null;
}
const latest = list => list.reduce((a, b) => (!a || String(b.created_at) > String(a.created_at) ? b : a), null);

export function summarizeAiUsage({ assist = [], feed = [], news = [], external = [], entries = [] }, now, price) {
  const today = seoulDay(now), month = monthOf(today), next = addMonths(month, 1);
  const days = byDay({ assist, feed, news, external }, price);
  const cleanEntries = entries.filter(e => ['openai', 'gemini'].includes(e?.provider) && ['topup', 'bill'].includes(e?.kind) && Number.isSafeInteger(e.amount_krw));
  const out = { month: month.slice(0, 7), warn: [] };
  const monthEst = (provider, m) => provider === 'openai'
    ? sumRange(days.openai, m, addMonths(m, 1), openTotal)
    : sumRange(days.gemini, m, addMonths(m, 1), v => v);
  for (const provider of ['openai', 'gemini']) {
    const mine = cleanEntries.filter(e => e.provider === provider);
    const bills = mine.filter(e => e.kind === 'bill');
    // 같은 달 청구를 여러 번 넣으면 가장 최근 것.
    const billFor = m => latest(bills.filter(b => b.month === m));
    const ratio = ratioFor([...new Map(bills.map(b => [b.month, billFor(b.month)])).values()], m => monthEst(provider, m), month);
    const estimate = monthEst(provider, month), actual = billFor(month);
    const shown = actual ? actual.amount_krw : estimate * (ratio ?? 1);
    const topup = latest(mine.filter(e => e.kind === 'topup'));
    let balance = null;
    if (topup) {
      const since = seoulDay(new Date(topup.created_at));
      const spent = (provider === 'openai' ? sumRange(days.openai, since, next, openTotal) : sumRange(days.gemini, since, next, v => v)) * (ratio ?? 1);
      balance = { topup_krw: topup.amount_krw, topup_on: since, left_krw: won(topup.amount_krw - spent) };
      if (balance.left_krw < WARN_BALANCE_KRW) out.warn.push(`${provider}_balance`);
    }
    const lastBill = latest(bills.filter(b => b.month < month).sort((a, b) => (a.month < b.month ? 1 : -1)).slice(0, 1));
    out[provider] = {
      krw: won(shown), estimate_krw: won(estimate), ratio: ratio === null ? null : Math.round(ratio * 100) / 100,
      actual: !!actual, balance, last_bill: lastBill ? { month: lastBill.month.slice(0, 7), krw: lastBill.amount_krw } : null,
    };
  }
  const assistKrw = sumRange(days.openai, month, next, v => v.assist);
  const tgKrw = sumRange(days.openai, month, next, v => v.telegram), callKrw = sumRange(days.openai, month, next, v => v.call);
  const newsKrw = sumRange(days.openai, month, next, v => v.news);
  Object.assign(out.openai, {
    assist_krw: won(assistKrw), telegram_krw: won(tgKrw), call_krw: won(callKrw), news_krw: won(newsKrw),
    requests: sumRange(days.openai, month, next, v => v.requests),
    limit_assist_krw: AI_MONTHLY_LIMIT_ASSIST_KRW, limit_feed_krw: AI_MONTHLY_LIMIT_FEED_KRW, limit_news_krw: AI_MONTHLY_LIMIT_NEWS_KRW,
  });
  // 상한은 서버가 실제로 막는 기준(보정 전 추정)과 같게 본다.
  if (assistKrw >= AI_MONTHLY_LIMIT_ASSIST_KRW * WARN_RATIO) out.warn.unshift('openai_limit');
  else if (tgKrw + callKrw >= AI_MONTHLY_LIMIT_FEED_KRW * WARN_RATIO) out.warn.unshift('feed_limit');
  else if (newsKrw >= AI_MONTHLY_LIMIT_NEWS_KRW * WARN_RATIO) out.warn.unshift('news_limit');
  let gTranscript = 0, gAnalysis = 0, gCalls = 0;
  const kinds = { meeting: 0, call_transcript: 0, call_analysis: 0, other_transcript: 0, other_analysis: 0 };
  for (const r of external) if (r.month === month && isDay(r.day)) {
    if (r.source === 'transcript') gTranscript += r._krw || 0; else if (r.source === 'analysis') gAnalysis += r._krw || 0;
    kinds[usageKind(r.ref, r.source)] += r._krw || 0;
    gCalls += tok(r.calls);
  }
  // transcript_krw·analysis_krw는 지금 화면이 쓰는 칸이라 그대로 두고(회의+통화 합), 나눈 금액은 by_kind에 더한다(6단계 화면이 씀).
  const byKind = Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, won(v)]));
  Object.assign(out.gemini, { transcript_krw: won(gTranscript), analysis_krw: won(gAnalysis), by_kind: byKind, calls: gCalls, unknown_models: [...days.unknown].slice(0, 5) });
  out.forecast = forecastAiCost({ days, entries, today, month, next, out });
  // 경고 순서(설계 4절 5): Gemini 한도 도달 예상 > Web2 서버 상한 80% > OpenAI 충전 잦음.
  if (out.forecast.gemini.cap_day) out.warn.unshift('gemini_cap');
  if (out.forecast.openai.reloads_per_month !== null && out.forecast.openai.reloads_per_month > RELOAD_OFTEN) {
    const at = out.warn.findIndex(w => !['gemini_cap', 'openai_limit', 'feed_limit', 'news_limit'].includes(w));
    out.warn.splice(at < 0 ? out.warn.length : at, 0, 'openai_reload_often');
  }
  out.entries = [...cleanEntries].sort((a, b) => (String(a.created_at) < String(b.created_at) ? 1 : -1)).slice(0, 10)
    .map(e => ({ id: e.id, provider: e.provider, kind: e.kind, amount_krw: e.amount_krw, month: e.month ? e.month.slice(0, 7) : null, created_at: e.created_at }));
  return out;
}

export const EXTERNAL_PAGE_ROWS = 1000, EXTERNAL_MAX_PAGES = 20;
// AI-비용보기 3단계: '얼마를 언제 충전' 계산(설계 4절). 모두 원 단위, 추정에는 지난달 보정 비율을 곱한다.
// - 하루 평균: 오늘을 뺀 최근 14일(달을 넘어 이어 감) 합 ÷ 14.
// - 월말 예상: 이번 달 지금까지(실제 청구가 있으면 그 값) + 남은 날(오늘 뒤) × 하루 평균.
// - OpenAI(선불·자동 충전): 권장 자동 충전 = 월말 예상의 절반을 1만 원 단위 올림, 권장 잔액 기준 = 최근 7일 중 가장 많이 쓴 하루 × 3을 1천 원 단위 올림,
//   자동 충전 금액(kind reload, 4단계 DB 뒤 입력)이 있으면 한 달 충전 횟수 = 월말 예상 ÷ 그 금액.
// - Gemini(후불·월 한도): 한도(kind cap, 4단계 뒤 입력)가 있으면 한도까지 남은 날·도달 날짜(이번 달 안일 때만 cap_day),
//   권장 한도 = max(월말 예상 × 1.3, 지난 3달 실제 청구 최대 × 1.2)를 1천 원 단위 올림.
export const RELOAD_OFTEN = 4;
const ceilTo = (n, unit) => (n > 0 ? Math.ceil(n / unit) * unit : 0);
export function forecastAiCost({ days, entries, today, month, next, out }) {
  const avgFrom = addDays(today, -AVG_DAYS), peakFrom = addDays(today, -PEAK_DAYS);
  const remaining = daysInMonth(month) - Number(today.slice(8, 10));
  const amountOf = (provider, kind) => latest(entries.filter(e => e?.provider === provider && e?.kind === kind && Number.isSafeInteger(e.amount_krw) && e.amount_krw > 0))?.amount_krw ?? null;
  const pick = { openai: [days.openai, openTotal], gemini: [days.gemini, v => v] };
  const res = {};
  for (const provider of ['openai', 'gemini']) {
    const [map, f] = pick[provider], ratio = out[provider].ratio ?? 1;
    const daily = new Map();
    for (const [day, v] of map) if (day >= avgFrom && day < today) daily.set(day, f(v) * ratio);
    const avg = [...daily.values()].reduce((a, b) => a + b, 0) / AVG_DAYS;
    let peak = 0;
    for (const [day, v] of daily) if (day >= peakFrom && v > peak) peak = v;
    const soFar = out[provider].krw, monthEnd = soFar + remaining * avg;
    res[provider] = { daily_avg_krw: won(avg), month_end_krw: won(monthEnd), avg_days: AVG_DAYS, remaining_days: remaining, peak_day_krw: won(peak) };
    if (provider === 'openai') {
      const reload = amountOf('openai', 'reload');
      Object.assign(res.openai, {
        reload_krw: reload,
        reloads_per_month: reload ? Math.round((monthEnd / reload) * 10) / 10 : null,
        suggest_reload_krw: ceilTo(monthEnd / 2, 10000),
        suggest_threshold_krw: ceilTo(peak * 3, 1000),
      });
    } else {
      const cap = amountOf('gemini', 'cap');
      const pastBills = entries.filter(e => e?.provider === 'gemini' && e?.kind === 'bill' && isDay(e.month) && e.month < month && e.month >= addMonths(month, -3) && Number.isSafeInteger(e.amount_krw));
      const pastMax = pastBills.reduce((m, e) => Math.max(m, e.amount_krw), 0);
      let daysToCap = null, capDay = null;
      if (cap) {
        daysToCap = soFar >= cap ? 0 : avg > 0 ? Math.floor((cap - soFar) / avg) : null;
        if (daysToCap !== null) { const d = addDays(today, daysToCap); if (d < next) capDay = d; }
      }
      const suggest = ceilTo(Math.max(monthEnd * 1.3, pastMax * 1.2), 1000);
      Object.assign(res.gemini, {
        cap_krw: cap, days_to_cap: daysToCap, cap_day: capDay,
        suggest_cap_krw: suggest, raise_cap: cap !== null && cap < suggest,
      });
    }
  }
  return res;
}

// 소유자 토큰 + anon 키로 읽는다(소유자 RLS). 쪽마다 1000행 넘으면 잘린 숫자를 보여 주지 않고 실패한다.
// 외부(Gemini) 보고는 통화 전사·분석이 한 건마다 한 행이라 한 달 1000행을 넘을 수 있어 1000행씩 차례로 읽는다(최대 20쪽, 넘으면 실패).
export async function readAiUsage({ fetcher, baseUrl, anonKey, userAuthorization, workspaceId, now }) {
  const headers = { apikey: anonKey, Authorization: userAuthorization };
  const get = async path => {
    let r;
    try { r = await fetcher(`${baseUrl}/rest/v1/${path}`, { headers, signal: AbortSignal.timeout(30000) }); }
    catch { throw new Error('AI_USAGE_READ_FAILED'); }
    if (r.status === 404) throw new Error('AI_USAGE_TABLE_MISSING');
    if (!r.ok) throw new Error('AI_USAGE_READ_FAILED');
    const rows = await r.json().catch(() => null);
    if (!Array.isArray(rows) || rows.length >= 1000) throw new Error('AI_USAGE_READ_FAILED');
    return rows;
  };
  const getPages = async path => {
    const all = [];
    for (let page = 0; page < EXTERNAL_MAX_PAGES; page++) {
      let r;
      try { r = await fetcher(`${baseUrl}/rest/v1/${path}&limit=${EXTERNAL_PAGE_ROWS}&offset=${page * EXTERNAL_PAGE_ROWS}`, { headers, signal: AbortSignal.timeout(30000) }); }
      catch { throw new Error('AI_USAGE_READ_FAILED'); }
      if (r.status === 404) throw new Error('AI_USAGE_TABLE_MISSING');
      if (!r.ok) throw new Error('AI_USAGE_READ_FAILED');
      const rows = await r.json().catch(() => null);
      if (!Array.isArray(rows) || rows.length > EXTERNAL_PAGE_ROWS) throw new Error('AI_USAGE_READ_FAILED');
      all.push(...rows);
      if (rows.length < EXTERNAL_PAGE_ROWS) return all;
    }
    throw new Error('AI_USAGE_READ_FAILED');
  };
  const ws = encodeURIComponent(workspaceId);
  const entries = await get(`app_ai_cost_entries?workspace_id=eq.${ws}&select=id,provider,kind,amount_krw,month,created_at&order=created_at.desc&limit=200`);
  const start = readStart(entries, seoulDay(now));
  const [assist, feed, news, external] = await Promise.all([
    get(`app_ai_daily_usage?workspace_id=eq.${ws}&day=gte.${start}&select=day,requests,input_tokens,output_tokens&limit=1000`),
    get(`app_feed_days?workspace_id=eq.${ws}&day=gte.${start}&select=day,source,ai_requests,ai_input_tokens,ai_output_tokens&limit=1000`),
    get(`app_news_days?workspace_id=eq.${ws}&day=gte.${start}&select=day,ai_requests,ai_input_tokens,ai_output_tokens&limit=1000`),
    getPages(`app_ai_external_usage?workspace_id=eq.${ws}&day=gte.${start}&select=day,ref,source,model,calls,input_tokens,audio_tokens,output_tokens&order=day.asc,ref.asc`),
  ]);
  return { assist, feed, news, external, entries };
}
