// 옛 주별 조직보고 표(app_weekly_org_lines, WEEKLY-메뉴짝짓기 P3) 읽기만 남은 자리.
// ORG-기록하나로 O-6(설계 docs/design/record-one.md 3-1 '도입 전 주 보고 줄 보존'): 전환 주(11.9) 앞 주는 옛 표를 그대로 읽어 보여 주기만 한다(읽기 전용).
// 그 그리기는 조직보고 창(record-window-view.js 옛 주 모드)이 하고, 한글 파일 옛 주 길(journal-hwpx.js)도 이 읽기를 쓴다.
// 줄 넣기·고치기·빼기·제안·지난주 가져오기(옛 쓰기 길)는 지웠다. 표 자료는 지우지 않는다. 브라우저 저장소에 아무것도 두지 않는다. 표가 없으면(DB 적용 전) missing.
import {missingTable} from './feed-model.mjs';

const TABLE = '/rest/v1/app_weekly_org_lines';
const COLS = 'id,organization_id,week_start,day,end_day,body,sort_order,state,origin,edited,source_update_ids,source_note_ids,source_status_ids,updated_at';
const enc = encodeURIComponent;

// 여러 조직의 그 주 줄. 표가 없으면 {missing:true}, 읽지 못하면 throw. 반환 Map(조직 id → 줄들).
export async function readWeekLines({rt = window.KPTURuntime, workspaceId, week, orgIds = []} = {}) {
  const ids = [...new Set(orgIds.filter(Boolean))];
  const out = new Map(ids.map(id => [id, []]));
  if (!ids.length || !workspaceId || !week) return {rows: out};
  try {
    for (let i = 0; i < ids.length; i += 50) {
      const rows = await rt.api(`${TABLE}?workspace_id=eq.${enc(workspaceId)}&week_start=eq.${enc(week)}&organization_id=in.(${ids.slice(i, i + 50).map(enc).join(',')})&select=${COLS}&order=sort_order.asc&limit=2000`, {singleFlight: false});
      if (!Array.isArray(rows)) throw new Error('rows');
      for (const r of rows) if (out.has(r.organization_id)) out.get(r.organization_id).push(r);
    }
  } catch (e) { if (missingTable(e)) return {missing: true, rows: out}; throw e; }
  return {rows: out};
}
