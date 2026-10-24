// LEDGER-자동기록 3단계(설계 docs/design/ledger-auto-record.md 3.4절): 업무일지 하루 카드의 "새로 기록된 약속 N" 한 줄 재료.
// 그 주에 자동 기록(변경 기록 route=auto, action=created)으로 원장에 들어온 약속(kind=commitment)을 기록된 날(KST)별로 센다.
// 읽기만, owner RLS REST 두 번(새 RPC 없음). 표가 아직 없거나(배포 전) 못 읽으면 빈 결과 → 줄이 없다.
// 화면은 journal.js(업무일지의 유일한 renderer)가 그린다.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const seoulDay = at => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date(at));
// KST 하루의 시작(UTC ISO). 2026-10-24 → 2026-10-23T15:00:00.000Z
export const kstDayStart = day => new Date(Date.parse(day + 'T00:00:00Z') - 9 * 3600000).toISOString();

// rows: 변경 기록 [{record_id, created_at}], commitments: Set(약속 기록 id) → Map(day → 수). 같은 기록은 한 번만.
export function countByDay(rows, commitments) {
  const seen = new Set(), out = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const id = String(r?.record_id || ''), at = Date.parse(r?.created_at);
    if (!UUID.test(id) || !commitments.has(id) || seen.has(id) || !Number.isFinite(at)) continue;
    seen.add(id);
    const d = seoulDay(at);
    out.set(d, (out.get(d) || 0) + 1);
  }
  return out;
}

export async function readAutoPromises(weekStartDay, rt = window.KPTURuntime) {
  const ws = rt?.context?.read?.()?.workspace?.id;
  if (!ws || !DAY.test(String(weekStartDay))) return new Map();
  const from = kstDayStart(weekStartDay), to = new Date(Date.parse(from) + 7 * 86400000).toISOString();
  const enc = encodeURIComponent;
  let rows;
  try {
    rows = await rt.api(`/rest/v1/app_ledger_record_changes?workspace_id=eq.${enc(ws)}&route=eq.auto&action=eq.created&created_at=gte.${enc(from)}&created_at=lt.${enc(to)}&select=record_id,created_at&order=created_at.asc&limit=500`);
  } catch { return new Map(); }
  const ids = [...new Set((Array.isArray(rows) ? rows : []).map(r => String(r?.record_id || '')).filter(id => UUID.test(id)))];
  if (!ids.length) return new Map();
  const commitments = new Set();
  try {
    for (let i = 0; i < ids.length; i += 100) {
      const part = await rt.api(`/rest/v1/app_ledger_records?workspace_id=eq.${enc(ws)}&kind=eq.commitment&id=in.(${ids.slice(i, i + 100).map(enc).join(',')})&select=id&limit=100`);
      for (const r of Array.isArray(part) ? part : []) if (UUID.test(String(r?.id))) commitments.add(String(r.id));
    }
  } catch { return new Map(); }
  return countByDay(rows, commitments);
}
