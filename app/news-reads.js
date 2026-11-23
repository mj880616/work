import {readReads, writeRead} from './feed-shared.js';
// S51-8 NEWS-전면개편 P4b(설계 docs/design/news-overhaul.md 6.3절): News 글 읽음 표시의 유일한 길.
// NEWS-모두에게열기 ③: 읽음은 사람별 표(app_news_reads·app_outside_reads, 작업공간 소유자 RLS)에 공용 글 id로 — 읽고 쓰는 길은 feed-shared.js.
// - 읽기: 목록 주인이 보이는 글 id를 넘기면(ensure) 아직 모르는 것만 한 번 묻는다. 결과가 오면 구독한 목록 주인이 자기 칸을 다시 그린다(onReads).
// - 넣기: 상세를 열 때(markRead) 한 줄 — 같은 글이 이미 있으면 서버가 그대로 둔다(on_conflict + ignore-duplicates = ON CONFLICT DO NOTHING).
//   넣는 칸은 workspace_id와 글 id 하나뿐(id·read_at은 서버 기본값). 실패해도 상세는 그대로 열린다.
//   S68-45: 저장이 실패하면 이 접속의 '읽음'을 거두고(굵기 되돌림) 다음에 열 때 다시 넣는다 — 조용히 읽음으로 보이게 두지 않는다.
// 기기 저장 없음(이번 접속 메모리만). 로그에 글 제목·주소를 남기지 않는다.
const rt = () => window.KPTURuntime;
const workspaceOf = () => rt()?.context?.read?.()?.workspace?.id || '';
const COL = {outside: true, news: true};
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
      const ids = want[type].slice(i, i + CHUNK);
      jobs.push(readReads(type, ids)
        .then(got => {
          if (mine !== scope) return;
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
  const w = checkScope();
  if (!w || !COL[item?.type] || !item.id) return;
  const k = keyOf(item);
  if (known.get(k) === true) return;
  const was = known.has(k) ? known.get(k) : undefined, mine = scope;
  known.set(k, true); notify();
  writeRead(item.type, item.id)
    .catch(() => {
      if (mine !== scope || known.get(k) !== true) return;
      if (was === undefined) known.delete(k); else known.set(k, was);
      notify();
    });
}
