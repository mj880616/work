// FORGET-소식합치기(요청함 11/08 21:02~21:19, 시안 docs/design/mockups/forget-news-link.html, 명진 'ㅇㅋ'·'넣어'):
// 업무일지 '기억할 통화·텔레그램' 묶음(옛 journal-memorable.js)을 없애고, 같은 줄(AI가 고른 그날 업무 통화·텔레그램 소식)을 잊지 말기 한 목록에
// 출처 '소식'으로 넣는다. 이 파일은 그 줄의 읽기·쓰기만 한다(그리기는 forget-list.js 한 곳).
// - 저장은 그대로 서버 표 app_journal_memorable(owner RLS + 운영자 기능 restrictive 정책, 새 표·새 칸 없음). 상태: suggested = 처리 전,
//   kept = 조직·사업에 넣음(연결 완료), dropped = 무시. 쓰는 칸은 표가 허락한 status·final_line·drop_reason·decided_at뿐이다.
// - [조직]·[사업]은 기존 기록 길을 그대로 쓴다: 담당조직 기록 = quick-save.js saveOrganizationUpdate(app_suborganization_updates,
//   그 주 조직보고 창에 바로 보임), 사업 기록 = business-now-data.js saveBusinessRecord(app_business_records, BIZ-기록하나로 B-3).
// - 운영자 기능(통화·텔레그램)은 서버가 판정한다(app_my_features·표 정책·ai-assist). 여기서 app_my_features를 읽는 것은 줄을 읽을지 정하는 편의일 뿐.
// - AI 고르기: 정리함·홈을 열 때 오늘 날짜로 ai-assist(kind=journal_memorable)를 부른다. 서버가 '마지막 실행 1시간 뒤 + 새 기록'일 때만 AI를 부른다.
//   이 탭도 같은 날은 1시간 안에 다시 묻지 않는다(탭 메모리만).
// - 가족 줄은 이 길에 없다(서버가 업무 통화함·업무 텔레그램만 고름). 기기 저장 없음.
// FORGET-소식바로잡기 ②⑤(요청함 11/09 01:45): 서버가 줄마다 AI가 정한 종류(task·event·note·org·area)와 이유 한 줄을 새 표
// app_journal_memorable_picks에 남긴다. 읽을 때 같은 요청에 붙여 읽고(PostgREST 연결 읽기), 처리 전·빨간 숫자는 종류가 있는 줄(새 기준)만 센다.
// 그 표가 아직 없으면(DB 적용 전) 예전처럼 처리 전 줄을 모두 센다(picks: false).
import {callAiAssist} from './basket-ai-summary.js';
import {seoulDateKey} from './meeting-time.js';
import {myFeatures} from './my-features.js';
import {flashRecord} from './record-flash.js';

export const NEWS_DAYS = 14; // 처리 전 소식은 최근 2주 것만 목록에 둔다(그 전 줄은 표에 그대로 남음).
export const NEWS_REFRESH_MS = 60 * 60 * 1000;
export const NEWS_LINE_MAX = 160;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ctx = rt => rt?.context?.read?.() || {};
const scopeOf = rt => { const c = ctx(rt); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
const enc = encodeURIComponent;
export const NEWS_SOURCE_TAG = Object.freeze({telegram: '소식 · 텔레그램', call: '소식 · 통화'});

// 서버 줄 → 목록 줄. 모양이 틀린 줄은 버린다.
export const NEWS_KINDS = Object.freeze(['task', 'event', 'note', 'org', 'area']);
const PICK = 'app_journal_memorable_picks';
const pickOf = r => { const p = Array.isArray(r?.[PICK]) ? r[PICK][0] : r?.[PICK]; return p && NEWS_KINDS.includes(p.kind) ? p : null; };
// 서버 줄에 종류·이유 칸이 붙어 왔는가(연결 읽기가 된 응답은 줄마다 그 칸이 있다 — 없으면 null).
export const picksKnown = rows => Array.isArray(rows) && rows.some(r => r && Object.hasOwn(r, PICK));
export function newsRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter(r => r && typeof r.id === 'string' && typeof r.line === 'string' && r.line && DAY.test(r.day || '')
    && ['suggested', 'kept', 'dropped'].includes(r.status))
    .map(r => ({id: r.id, day: r.day, source: r.source === 'telegram' ? 'telegram' : 'call', feedItemId: r.feed_item_id || '',
      kind: pickOf(r)?.kind || '', reason: typeof pickOf(r)?.reason === 'string' ? pickOf(r).reason.slice(0, 60) : '',
      org: typeof r.org_name === 'string' ? r.org_name.trim() : '', status: r.status,
      line: r.status === 'kept' && typeof r.final_line === 'string' && r.final_line ? r.final_line : r.line,
      at: r.picked_at || `${r.day}T00:00:00+09:00`, decidedAt: r.decided_at || ''}));
}
// 목록에 넣을 글: 조직 이름이 있으면 앞에 붙인다(담당조직 기록·사업 기록에 남길 한 줄도 같은 글). 160자 안.
export const newsText = row => [...[row?.org, row?.line].filter(Boolean).join(' · ')].slice(0, 2000).join('');
// AI가 쓴 조직 이름이 내 담당조직 이름(또는 다른 이름)과 같으면 그 조직. 공백·대소문자만 무시하고, 비슷한 이름은 맞추지 않는다.
const norm = v => String(v ?? '').replace(/\s+/g, '').toLowerCase();
export function matchOrg(name, orgs, mine) {
  const key = norm(name);
  if (!key) return null;
  return (orgs || []).find(o => o?.id && o.active !== false && mine?.has?.(o.id) && [o.name, ...(Array.isArray(o.aliases) ? o.aliases : [])].some(n => norm(n) === key)) || null;
}
// 처리 전 소식. 종류·이유를 읽을 수 있으면(picks) 새 기준(종류가 있는) 줄만 — 옛 기준 줄은 셈·목록에 넣지 않는다(정리는 서버 쪽 한 번, PR 본문 ④).
export const openNews = (rows, picks = true) => (rows || []).filter(r => r.status === 'suggested' && (!picks || !!r.kind));

// FORGET-소식바로잡기 ④: 옛 기준으로 골라 종류·이유가 없는 처리 전 소식(종류를 읽을 수 있을 때만 셈 — 표 적용 전이면 0).
export const oldNews = (rows, picks = true) => picks ? (rows || []).filter(r => r.status === 'suggested' && !r.kind) : [];
export const RECHECK_TIMEOUT_MS = 140000; // 서버가 AI를 세 번까지 부를 수 있어 일반 AI 요청보다 길게 기다린다.
// 쌓인 소식 한 번 다시 판정(서버 ai-assist journal_memorable_recheck). mode: 'preview'(바꾸지 않고 수만) | 'run'(실행).
// 대상 줄·원본은 서버가 로그인 토큰으로 읽고 소유자·운영자 기능을 다시 판정한다. 화면은 mode만 보낸다.
// 돌려줌: {ok:true, keep, drop, left} 또는 {ok:false}.
export async function recheckNews(rt, mode, opts = {}) {
  if (mode !== 'preview' && mode !== 'run') return {ok: false};
  try {
    const r = await callAiAssist({kind: 'journal_memorable_recheck', mode}, {rt, timeoutMs: RECHECK_TIMEOUT_MS, ...opts});
    const d = r?.ok ? r.data : null;
    const n = v => Number.isInteger(v) && v >= 0 ? v : null;
    if (!d || d.mode !== mode || [d.keep, d.drop, d.left].some(v => n(v) === null)) return {ok: false};
    return {ok: true, keep: d.keep, drop: d.drop, left: d.left};
  } catch { return {ok: false}; }
}
// 운영자 기능 calls·telegram 중 하나라도 있는가(서버 app_my_features — 공용 my-features.js 한 곳에서 GET으로 한 번만 묻는다).
// 못 읽으면 없음으로 본다(줄을 안 읽을 뿐, 보안은 서버).
export async function newsOn(rt = window.KPTURuntime) {
  const got = await myFeatures(rt);
  return got.includes('calls') || got.includes('telegram');
}
// 최근 NEWS_DAYS일 줄(처리 전·넣음·무시 모두). 표가 없으면(404) {missing:true}.
export async function readNews(rt = window.KPTURuntime, today = seoulDateKey()) {
  const ws = ctx(rt)?.workspace?.id;
  if (!ws) return {ok: false, rows: []};
  const from = seoulDateKey(new Date(Date.parse(`${today}T00:00:00+09:00`) - NEWS_DAYS * 86400000));
  try {
    const path = cols => `/rest/v1/app_journal_memorable?workspace_id=eq.${enc(ws)}&day=gte.${from}&select=${cols}&order=day.desc,picked_at.desc,id.asc&limit=300`;
    const base = 'id,day,source,feed_item_id,org_name,line,status,final_line,picked_at,decided_at';
    let rows;
    // 종류·이유 표가 아직 없으면(DB 적용 전) 연결 읽기가 400으로 거절된다 — 그때만 예전 칸으로 한 번 더 읽는다.
    try { rows = await rt.api(path(`${base},${PICK}(kind,reason)`)); }
    catch (error) { if (error?.status !== 400) throw error; rows = await rt.api(path(base)); }
    return {ok: true, rows: newsRows(rows), picks: picksKnown(rows)};
  } catch (error) {
    if (error?.status === 404 || error?.status === 403) return {ok: true, missing: true, rows: [], picks: false};
    return {ok: false, rows: [], picks: false};
  }
}
// 오늘 소식 고르기를 서버에 한 번 부탁한다. 새로 골랐으면 true(다시 읽을 때). 같은 날 1시간 안에는 다시 묻지 않는다.
const asked = new Map();
export async function pickTodayNews(rt = window.KPTURuntime, {now = Date.now(), today = seoulDateKey()} = {}) {
  const key = `${scopeOf(rt)}:${today}`;
  if (asked.has(key) && now - asked.get(key) < NEWS_REFRESH_MS) return false;
  asked.set(key, now);
  try { const r = await callAiAssist({kind: 'journal_memorable', day: today}, {rt}); return !!(r?.ok && !r.data?.skipped); } catch { return false; }
}
// 줄 하나의 결정(표가 허락한 칸만). status: 'kept'(final_line 함께) · 'dropped' · 'suggested'(되돌리기).
export async function decideNews(rt, id, status, finalLine = null) {
  const ws = ctx(rt)?.workspace?.id;
  if (!ws || !['kept', 'dropped', 'suggested'].includes(status)) return false;
  const body = {status, final_line: status === 'kept' ? finalLine : null, drop_reason: null, decided_at: status === 'suggested' ? null : new Date().toISOString()};
  const rows = await rt.api(`/rest/v1/app_journal_memorable?id=eq.${enc(id)}&workspace_id=eq.${enc(ws)}&select=id,status`, {method: 'PATCH', prefer: 'return=representation', body});
  return Array.isArray(rows) && rows.length === 1 && rows[0].status === status;
}
// 처리 전 소식 수(홈 '잊지 말기' 칩·메뉴 '홈' 표시). 운영자가 아니거나 못 읽으면 0.
export async function countOpenNews(rt = window.KPTURuntime) {
  if (!(await newsOn(rt).catch(() => false))) return 0;
  await pickTodayNews(rt);
  const r = await readNews(rt);
  return r.ok ? openNews(r.rows, r.picks).length : 0;
}
// 원본 열기: 통화는 통화 화면에서 그 통화를, 텔레그램은 그 방·날짜를 연다(방 구분값은 눌렀을 때 읽는다). 옛 업무일지 묶음과 같은 길.
// FORGET-원문열기·뒤로가기: 화면 이동은 라우터 openFrom 한 길(화면을 다 불러온 뒤 열고, 뒤로가기 한 번 = 잊지 말기 그 자리). 연 줄은 잠깐 밝힌다.
export async function openNewsSource(row, rt = window.KPTURuntime) {
  const router = window.KPTURouter;
  if (!row?.feedItemId || !router?.openFrom) return false;
  const id = row.feedItemId;
  if (row.source === 'call') {
    return router.openFrom('calls', async () => {
      if ((await window.KPTUCallFeed?.show?.(id)) === false) return false;
      void flashRecord(`#cfDetail [data-cf-detail="${CSS.escape(id)}"]`);
      return true;
    });
  }
  const found = await rt.api(`/rest/v1/app_feed_items?id=eq.${enc(id)}&select=room_key,day&limit=1`);
  const item = Array.isArray(found) ? found[0] : null;
  if (!item) return false;
  return router.openFrom('telegram', async () => {
    if ((await window.KPTUTelegramFeed?.show?.(item.room_key, item.day, id)) === false) return false;
    void flashRecord(`#tgDetail [data-tg-di="${CSS.escape(id)}"]`);
    return true;
  });
}
