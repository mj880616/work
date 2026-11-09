// 옛 담당조직 [현황 표](app_org_status_rows, migration 20261030234000) 읽기만 남은 자리.
// ORG-기록하나로 O-5(설계 docs/design/record-one.md 4절): 조직 상세의 [기록 | 현황 표] 소탭과 표 쓰기(넣기·고치기·빼기)는 지웠다 —
// 조직 상세는 '날짜 | 기록' 한 표(workplace-detail.js)이고, 옛 표 줄은 O-3에서 조직 기록으로 복사됐다(표 자료는 지우지 않음).
// 아직 옛 길 두 곳(주간 정리 4. 주별 줄 weekly-org-lines.js, 한글 파일 3. 2) journal-hwpx.js)이 읽는다 — O-6에서 창 결과로 바뀌면 이 파일도 지운다.
// 브라우저 저장소에 아무것도 두지 않는다.
import {missingTable} from './feed-model.mjs';

const TABLE = '/rest/v1/app_org_status_rows';
const COLS = 'id,organization_id,day,end_day,body,sort_order,source,evidence,updated_at';
const enc = encodeURIComponent;

// 여러 조직의 표 줄(주간보고가 씀). 표가 없으면 {missing:true}, 읽지 못하면 throw. 반환 Map(조직 id → 줄들).
export async function readStatusRows({rt = window.KPTURuntime, workspaceId, orgIds = []} = {}) {
  const ids = [...new Set(orgIds.filter(Boolean))];
  const out = new Map(ids.map(id => [id, []]));
  if (!ids.length || !workspaceId) return {rows: out};
  try {
    for (let i = 0; i < ids.length; i += 50) {
      const rows = await rt.api(`${TABLE}?workspace_id=eq.${enc(workspaceId)}&organization_id=in.(${ids.slice(i, i + 50).map(enc).join(',')})&select=${COLS}&order=day.asc,sort_order.asc&limit=1000`, {singleFlight: false});
      if (!Array.isArray(rows)) throw new Error('rows');
      for (const r of rows) if (out.has(r.organization_id)) out.get(r.organization_id).push(r);
    }
  } catch (e) { if (missingTable(e)) return {missing: true, rows: out}; throw e; }
  return {rows: out};
}
