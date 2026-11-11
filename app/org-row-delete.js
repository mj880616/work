// ORG-뺀줄지난줄메뉴: 조직 한 줄 삭제의 서버 길 하나.
// 조직 창(workplace-detail.js wdDelRow — 기록 ⋯ [삭제]·메모 [삭제])과 조직보고 창(record-window-view.js 줄 ⋯ [기록 삭제])이 이 함수를 같이 쓴다.
// 새 삭제 길·권한을 만들지 않는다: 기존 owner RLS REST DELETE 그대로(그 조직 id를 함께 걸고, 돌려받은 줄이 있어야 성공).
// 묻기·알림 글·화면 다시 그리기는 부르는 화면이 한다. 브라우저 저장소 없음.
const enc = encodeURIComponent;

export const orgRowDeletePath = (table, id, orgId) => `/rest/v1/${table}?id=eq.${enc(id)}&organization_id=eq.${enc(orgId)}&select=id`;

// api = (path, options) => Promise (rt.api 모양). 못 지웠으면(권한 없음·이미 없음) 던진다.
export async function deleteOrgRow(api, table, id, orgId) {
  const rows = await api(orgRowDeletePath(table, id, orgId), {method: 'DELETE', prefer: 'return=representation'});
  if (!Array.isArray(rows) || !rows.length) throw new Error('권한이 없거나 이미 없는 항목입니다.');
}

export const deleteOrgUpdate = (api, id, orgId) => deleteOrgRow(api, 'app_suborganization_updates', id, orgId);
