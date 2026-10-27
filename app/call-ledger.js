// CALL-원장재료 L-3 (docs/design/ledger-sources.md 6.5·2.4): 통화 메뉴에서 통화를 지울 때 "원장에 들어간 기록"을 알려 주고,
// 명진이 누르면 [원장에서도 틀림으로]로 그 통화만 근거인 자동 기록을 틀린 기록으로 표시한다(수정 요청 retire, 지우지 않음).
// 읽기는 owner RLS REST, 쓰기는 기존 수정 요청 함수 app_apply_ledger_fix 하나뿐(새 DB 함수·권한 없음). 브라우저 저장소 없음.
import {soleSourceRecords, sourceRetireRequest} from './ledger-browse-model.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const enc = encodeURIComponent;
const workspaceOf = rt => { const id = rt?.context?.read?.()?.workspace?.id; if (!id) throw Error('workspace'); return id; };
const list = async (rt, path) => { const rows = await rt.api(path, {singleFlight:false}); if (!Array.isArray(rows)) throw Error('shape'); return rows; };

// 이 통화에서 나온 활성 자동 기록: {ledgerIds: 그 통화만 근거인 것, total: 활성 기록 전부}. 못 읽으면 던진다(호출자가 조용히 넘김).
export async function callLedgerRecords(callId, rt = window.KPTURuntime) {
  if (!UUID.test(String(callId))) return {ledgerIds: [], total: 0};
  const ws = workspaceOf(rt);
  const sources = (await list(rt, `/rest/v1/app_ledger_sources?workspace_id=eq.${enc(ws)}&location=eq.${enc('web2:call:' + callId.toLowerCase())}&select=id&limit=20`)).filter(s => UUID.test(String(s?.id)));
  if (!sources.length) return {ledgerIds: [], total: 0};
  const sourceIds = sources.map(s => s.id);
  const links = (await list(rt, `/rest/v1/app_ledger_record_sources?source_id=in.(${sourceIds.map(enc).join(',')})&select=record_id,source_id&limit=200`)).filter(r => UUID.test(String(r?.record_id)));
  const recordIds = [...new Set(links.map(r => r.record_id))];
  if (!recordIds.length) return {ledgerIds: [], total: 0};
  const inList = recordIds.map(enc).join(',');
  const [records, all] = await Promise.all([
    list(rt, `/rest/v1/app_ledger_records?id=in.(${inList})&select=id,ledger_id,validity&limit=200`),
    list(rt, `/rest/v1/app_ledger_record_sources?record_id=in.(${inList})&select=record_id,source_id&limit=1000`),
  ]);
  const active = records.filter(r => ['current', 'needs_check'].includes(r?.validity));
  return {ledgerIds: soleSourceRecords(sourceIds, all, active), total: active.length};
}

// 틀림으로 표시: 수정 요청 한 번. 되돌리려면 원장의 수정 요청 [반영 취소]. 성공하면 원장 화면·Drive 사본에 바뀜을 알린다.
export async function retireCallRecords(ledgerIds, rt = window.KPTURuntime) {
  const body = sourceRetireRequest(ledgerIds);
  if (!body) throw Error('request');
  await rt.api('/rest/v1/rpc/app_apply_ledger_fix', {method: 'POST', body: {p_workspace_id: workspaceOf(rt), p_request: body, p_dry_run: false}, singleFlight: false});
  try { window.dispatchEvent(new CustomEvent('kptu:ledger-changed', {detail: {source: 'call'}})); } catch { /* 다음 열기에 */ }
  window.KPTULedgerExport?.changed?.();
  return body.items.length;
}
