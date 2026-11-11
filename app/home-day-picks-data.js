// HOME-하루채우기 PR-C: 홈 [하루] ② 읽을 만한 글·③ 이런 기록은 어때요?의 서버 읽기·부탁·쓰기(설계 docs/design/home-day-picks.md).
// - 고르기는 서버(ai-assist kind=home_day_picks, 사용자 로그인)가 한다. 여기서는 오늘 날짜·이 화면이 이미 읽은 그 주 구글 일정·끝낸 할 일 제목만 보낸다.
//   서버가 '아침 한 번·저녁 한 번(새 글 있을 때만)·기록 제안 저녁 한 번'을 지키므로, 여기서는 같은 날·같은 때(아침/저녁)에 10분 안 다시 묻지 않을 뿐이다.
// - 결과는 서버 표 app_home_day_picks(owner RLS, 작업공간·날짜 한 줄). 이 기기에 저장하지 않는다(탭 메모리만).
// - 일기를 쓴 제안은 표의 suggests_done에 id를 더한다(다른 기기에서도 사라짐).
import {callAiAssist} from './basket-ai-summary.js';
import {picksState, newsIdOf, handledNewsIds} from './home-day-picks-model.mjs';

const enc = encodeURIComponent;
const ctx = rt => rt?.context?.read?.();
const scopeOf = rt => { const c = ctx(rt); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
const COLS = 'day,reads,reads_at,suggests,suggests_at,suggests_done';
export const ASK_AGAIN_MS = 10 * 60 * 1000;
export const DAY_PICKS_TIMEOUT_MS = 90000; // 서버가 AI를 두 번(읽을 글·기록 제안)까지 부를 수 있다.

// 그 날 줄 읽기 → {ok:true, state} | {ok:true, missing:true}(표가 없음 — DB 적용 전) | {ok:false}.
export async function readDayPicks(day, rt = window.KPTURuntime) {
  const ws = ctx(rt)?.workspace?.id;
  if (!ws) return {ok:false};
  try {
    const rows = await rt.api(`/rest/v1/app_home_day_picks?workspace_id=eq.${enc(ws)}&day=eq.${enc(day)}&select=${COLS}&limit=1`);
    return {ok:true, state:picksState(Array.isArray(rows) ? rows[0] : null)};
  } catch (error) {
    if (error?.status === 404) return {ok:true, missing:true, state:picksState(null)};
    return {ok:false};
  }
}

// HOME-읽을글밀기: 고른 글(뉴스 기사) 가운데 이미 숨기거나 보관(별표)한 글의 id 모음. 뉴스 표(owner RLS)의 표시를 읽기만 한다 — 홈이 따로 저장하는 것은 없다.
// → {ok:true, handled:Set<id>} | {ok:false}(읽지 못함 — 화면은 거르지 않고 그대로 보인다).
export async function readReadMarks(ids, rt = window.KPTURuntime) {
  const ws = ctx(rt)?.workspace?.id;
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(newsIdOf).filter(Boolean))];
  if (!ws) return {ok:false};
  if (!list.length) return {ok:true, handled:new Set()};
  try {
    const rows = await rt.api(`/rest/v1/app_news_items?workspace_id=eq.${enc(ws)}&id=in.(${list.map(enc).join(',')})&select=id,hidden_at,starred_at&limit=${list.length}`);
    return {ok:true, handled:handledNewsIds(rows)};
  } catch { return {ok:false}; }
}

// 서버에 고르기를 부탁한다. 돌려줌: {state}(새로 받은 줄) | {limit:'monthly_limit'|'daily_limit'} | {skipped:true} | null(실패·건너뜀).
const asked = new Map(); // `${scope}:${day}:${am|pm}` → 물은 시각
export async function askDayPicks({day, slot, events, done}, rt = window.KPTURuntime, {now = Date.now(), call = callAiAssist} = {}) {
  const key = `${scopeOf(rt)}:${day}:${slot}`;
  if (asked.has(key) && now - asked.get(key) < ASK_AGAIN_MS) return {skipped:true};
  asked.set(key, now);
  try {
    const r = await call({kind:'home_day_picks', day, events, done}, {rt, timeoutMs:DAY_PICKS_TIMEOUT_MS});
    if (r?.ok && r.data?.picks) return {state:picksState(r.data.picks)};
    if (r?.code === 'monthly_limit' || r?.code === 'daily_limit') return {limit:r.code};
    return null;
  } catch { return null; }
}
export const forgetAsked = () => asked.clear();

// 일기를 쓴 제안 id를 더한다(같은 id는 한 번). 실패해도 화면에서는 뺀다(다음 열기에 서버 값으로 다시 맞춤).
export async function markSuggestDone(day, id, rt = window.KPTURuntime) {
  const ws = ctx(rt)?.workspace?.id;
  if (!ws || !/^s[1-9]$/.test(String(id))) return false;
  try {
    const rows = await rt.api(`/rest/v1/app_home_day_picks?workspace_id=eq.${enc(ws)}&day=eq.${enc(day)}&select=suggests_done&limit=1`);
    const now = Array.isArray(rows?.[0]?.suggests_done) ? rows[0].suggests_done.filter(x => /^s[1-9]$/.test(x)) : [];
    if (now.includes(id)) return true;
    await rt.api(`/rest/v1/app_home_day_picks?workspace_id=eq.${enc(ws)}&day=eq.${enc(day)}`, {method:'PATCH', prefer:'return=minimal', body:{suggests_done:[...now, id].slice(-10)}});
    return true;
  } catch { return false; }
}
