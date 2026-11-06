// S51-8 NEWS-전면개편 P4b(설계 docs/design/news-overhaul.md 6.3절): News 글 읽음 표시의 유일한 길. 서버 표 public.app_feed_reads(작업공간 소유자 RLS, DB 20261106080000)만 쓴다.
// - 읽기: 목록 주인이 보이는 글 id를 넘기면(ensure) 아직 모르는 것만 한 번 묻는다. 결과가 오면 구독한 목록 주인이 자기 칸을 다시 그린다(onReads).
// - 넣기: 상세를 열 때(markRead) 한 줄 — 같은 글이 이미 있으면 서버가 그대로 둔다(on_conflict + ignore-duplicates = ON CONFLICT DO NOTHING).
//   넣는 칸은 workspace_id와 글 id 하나뿐(id·read_at은 서버 기본값). 실패해도 상세는 그대로 열린다.
// 기기 저장 없음(이번 접속 메모리만). 로그에 글 제목·주소를 남기지 않는다.
const q = v => encodeURIComponent(v);
const rt = () => window.KPTURuntime;
const workspaceOf = () => rt()?.context?.read?.()?.workspace?.id || '';
const COL = {outside: 'outside_post_id', news: 'news_item_id'};
const CHUNK = 80;
let scope = '';
const known = new Map(); // 'outside:<id>' → true(읽음) | false(안 읽음)
const asking = new Set();
const listeners = new Set();
const keyOf = item => `${item?.type}:${item?.id}`;
function checkScope() {
  const w = workspaceOf();
  if (w !== scope) { scope = w; known.clear(); asking.clear(); }
  return w;
}
const notify = () => { for (const fn of listeners) { try { fn(); } catch { /* 한 목록 실패가 다른 목록을 막지 않게 */ } } };
export const onReads = fn => { listeners.add(fn); return () => listeners.delete(fn); };
// true(읽음) · false(안 읽음) · null(아직 모름 — 굵기 없이 보통 글자)
export function readState(item) {
  checkScope();
  const v = known.get(keyOf(item));
  return v === undefined ? null : v;
}
export async function ensureReads(items) {
  const w = checkScope();
  if (!w) return;
  const mine = scope;
  const want = {outside: [], news: []};
  for (const it of items || []) {
    const k = keyOf(it);
    if (!COL[it?.type] || !it.id || known.has(k) || asking.has(k)) continue;
    asking.add(k); want[it.type].push(it.id);
  }
  const jobs = [];
  for (const type of ['outside', 'news']) {
    for (let i = 0; i < want[type].length; i += CHUNK) {
      const ids = want[type].slice(i, i + CHUNK), col = COL[type];
      jobs.push(rt().api(`/rest/v1/app_feed_reads?workspace_id=eq.${q(w)}&${col}=in.(${ids.map(q).join(',')})&select=${col}&limit=${ids.length}`, {singleFlight: false})
        .then(rows => {
          if (mine !== scope) return;
          const got = new Set((Array.isArray(rows) ? rows : []).map(r => String(r?.[col] || '')));
          for (const id of ids) { const k = `${type}:${id}`; if (known.get(k) !== true) known.set(k, got.has(id)); asking.delete(k); }
        })
        .catch(() => { for (const id of ids) asking.delete(`${type}:${id}`); }));
    }
  }
  if (!jobs.length) return;
  await Promise.all(jobs);
  if (mine === scope) notify();
}
export function markRead(item) {
  const w = checkScope(), col = COL[item?.type];
  if (!w || !col || !item.id) return;
  const k = keyOf(item);
  if (known.get(k) === true) return;
  known.set(k, true); notify();
  rt().api(`/rest/v1/app_feed_reads?on_conflict=${col}`, {method: 'POST', body: {workspace_id: w, [col]: item.id}, prefer: 'resolution=ignore-duplicates,return=minimal', singleFlight: false})
    .catch(() => { /* 못 넣어도 이번 접속에서는 읽음으로 보인다. 다음에 들어오면 서버 값대로 */ });
}
