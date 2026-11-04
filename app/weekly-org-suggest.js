// WEEKLY-메뉴짝짓기 P4(설계 docs/design/weekly-menu-pairing.md 4.2): 주별 조직보고 '제안' 줄을 부르는 자리 한 곳.
// 담당조직 기록 저장·고침(quick-save.js·workplace-detail.js), 업데이트를 조직에 확정 연결(basket-classification.js confirmLinks),
// 조직 상세 [현황 표] 줄 넣기·고침(org-status-table.js)이 끝나면 화면은 기록 종류와 번호만 서버(ai-assist org_week_lines)에 보낸다.
// 서버가 내 로그인으로 그 기록을 다시 읽어 그 주 그 조직 칸에 제안 줄을 넣는다(화면이 보낸 글·조직·날짜를 믿지 않음).
// - 저장 흐름을 막지 않는다: 부르는 쪽은 기다리지 않고(void), 실패해도 저장은 그대로이며 다음에 표를 열 때 '빠진 것 채우기'가 다시 보낸다.
// - 한 번에 하나씩(차례 줄), 같은 기록이 줄에 이미 있으면 한 번만. 끝나면 같은 탭에 kptu:weekly-org-lines-changed.
// - 열 때 빠진 것 채우기: 주별 표를 열면 그 주 재료 중 어떤 줄의 출처에도 없는 기록 번호를 한 번에 10개까지 보낸다(화면·주마다 이번 접속에 한 번).
// - 브라우저 저장소에 아무것도 두지 않는다. 외부 발송·공유와 이어지지 않는다(표에 뜨기만).
import {callAiAssist} from './basket-ai-summary.js';

export const KINDS = Object.freeze(['org_update', 'note', 'status_row']);
export const FILL_MAX = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const enc = encodeURIComponent;
const queue = [], pending = new Set();
let running = false;

// 기록 하나를 제안 줄로 보내기(차례 줄에 넣고 바로 돌아옴). 반환 true = 줄에 넣음.
export function suggestOrgWeek(kind, id, {rt = globalThis.window?.KPTURuntime} = {}) {
  const sid = String(id ?? '').toLowerCase();
  if (!KINDS.includes(kind) || !UUID.test(sid) || !rt) return false;
  const k = `${kind}:${sid}`;
  if (pending.has(k)) return false;
  pending.add(k); queue.push({kind, id: sid, rt, k});
  void drain();
  return true;
}
async function drain() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const job = queue.shift();
      try {
        const r = await callAiAssist({kind: 'org_week_lines', source_kind: job.kind, source_id: job.id}, {rt: job.rt});
        const results = r.ok && Array.isArray(r.data?.results) ? r.data.results : [];
        const week = r.ok && typeof r.data?.week_start === 'string' ? r.data.week_start : null;
        for (const x of results) if (['added', 'merged', 'rewritten'].includes(x?.result)) window.dispatchEvent(new CustomEvent('kptu:weekly-org-lines-changed', {detail: {week, organization_id: x.organization_id, source: 'suggest'}}));
      } catch (e) { console.warn('weekly org suggest failed', e?.message || e); }
      finally { pending.delete(job.k); }
    }
  } finally { running = false; }
}

// 확정 연결 결과(app_basket_confirm_links)에 조직이 있으면 그 업데이트를 보낸다.
export function suggestFromLinks(noteId, targets, opts) {
  if ((targets ?? []).some(t => t?.kind === 'organization')) suggestOrgWeek('note', noteId, opts);
}

// 서울 기준 그 주(월~일) 시작·끝 시각.
const weekRange = week => ({from: new Date(`${week}T00:00:00+09:00`).toISOString(), to: new Date(Date.parse(`${week}T00:00:00+09:00`) + 7 * 86400000).toISOString()});
const done = new Set();
// 열 때 빠진 것 채우기. lines = Map(조직 id → 그 주 줄들). 그 주 재료(조직 기록·조직에 확정 연결된 업데이트·현황 표 줄) 중 출처에 없는 번호를 보낸다.
export async function fillMissing({rt, workspaceId, week, orgIds = [], lines = new Map()}) {
  const ids = [...new Set(orgIds.filter(Boolean))].slice(0, 50);
  const key = `${workspaceId}:${week}:${ids.join(',')}`;
  if (!rt || !workspaceId || !week || !ids.length || done.has(key)) return 0;
  done.add(key);
  const have = {org_update: new Set(), note: new Set(), status_row: new Set()};
  for (const list of lines.values()) for (const l of list) {
    (l.source_update_ids || []).forEach(x => have.org_update.add(String(x).toLowerCase()));
    (l.source_note_ids || []).forEach(x => have.note.add(String(x).toLowerCase()));
    (l.source_status_ids || []).forEach(x => have.status_row.add(String(x).toLowerCase()));
  }
  const {from, to} = weekRange(week), orgs = ids.map(enc).join(','), end = new Date(Date.parse(to) - 1).toISOString().slice(0, 10);
  const want = [];
  const read = async path => { try { const r = await rt.api(path, {singleFlight: false}); return Array.isArray(r) ? r : []; } catch { return []; } };
  const [ups, links, rows] = await Promise.all([
    read(`/rest/v1/app_suborganization_updates?organization_id=in.(${orgs})&occurred_at=gte.${enc(from)}&occurred_at=lt.${enc(to)}&select=id&order=occurred_at.desc&limit=${FILL_MAX}`),
    read(`/rest/v1/app_record_links?workspace_id=eq.${enc(workspaceId)}&organization_id=in.(${orgs})&status=eq.confirmed&note_id=not.is.null&select=note_id&order=created_at.desc&limit=200`),
    read(`/rest/v1/app_org_status_rows?workspace_id=eq.${enc(workspaceId)}&organization_id=in.(${orgs})&day=gte.${week}&day=lte.${end}&select=id&limit=${FILL_MAX}`),
  ]);
  for (const u of ups) if (!have.org_update.has(String(u.id).toLowerCase())) want.push(['org_update', u.id]);
  for (const r of rows) if (!have.status_row.has(String(r.id).toLowerCase())) want.push(['status_row', r.id]);
  const noteIds = [...new Set(links.map(l => String(l.note_id).toLowerCase()).filter(id => UUID.test(id) && !have.note.has(id)))].slice(0, 100);
  if (noteIds.length && want.length < FILL_MAX) {
    const notes = await read(`/rest/v1/app_notes?workspace_id=eq.${enc(workspaceId)}&id=in.(${noteIds.map(enc).join(',')})&kind=eq.basket&archived_at=is.null&occurred_at=gte.${enc(from)}&occurred_at=lt.${enc(to)}&select=id&limit=${FILL_MAX}`);
    for (const n of notes) want.push(['note', n.id]);
  }
  let sent = 0;
  for (const [kind, id] of want.slice(0, FILL_MAX)) if (suggestOrgWeek(kind, id, {rt})) sent++;
  return sent;
}
