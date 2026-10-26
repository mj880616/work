// MTG-기록겹침거르기 4단계(화면 ②): 주간 정리가 쓰는 겹침 표 읽기·판정 요청·사용자 판정 쓰기 한 곳(규칙은 overlap-weekly.mjs).
// - 모두 기존 경로다: 소유자 RLS 읽기(rt.api), ai-assist overlap_check(callAiAssist), 판정 저장 app_record_overlap_set(saveUserVerdict).
// - 읽기·판정이 어디서 실패해도 던지지 않고 "빼는 것 없음"으로 끝난다(보고서가 비지 않게). 판정·결과를 브라우저 저장소에 두지 않는다.
import {callAiAssist} from './basket-ai-summary.js';
import {reportRuntime} from './report-links.js';
import {saveUserVerdict} from './overlap-data.js';
import {isRef} from './overlap-model.mjs';
import {batches} from './overlap-weekly.mjs';

const enc = encodeURIComponent;
const CHUNK = 40, LIMIT = 1000, ASK_MS = 20000;
const workspaceOf = rt => rt.context?.read?.()?.workspace?.id || '';
const missing = e => Number(e?.status) === 404 || /42P01|does not exist|schema cache/i.test(String(e?.message ?? ''));

// 보이는 줄들(refs)이 한쪽 끝인 겹침 행. 반환 {missing, rows}: 표가 아직 없으면 missing(빼는 것 없음), 읽기 실패는 던진다(호출하는 쪽이 failed로 둔다).
export async function readOverlapRows(refs, rt = reportRuntime()) {
  const ws = enc(workspaceOf(rt)), list = [...new Set((refs || []).filter(isRef))];
  if (!ws || !list.length) return {missing: false, rows: []};
  const out = new Map();
  try {
    for (const column of ['a_ref', 'b_ref']) for (let i = 0; i < list.length; i += CHUNK) {
      const ids = list.slice(i, i + CHUNK).map(enc).join(',');
      const rows = await rt.api(`/rest/v1/app_record_overlaps?workspace_id=eq.${ws}&${column}=in.(${ids})&select=a_ref,b_ref,verdict,decided_by,reason&limit=${LIMIT}`);
      if (!Array.isArray(rows)) throw new Error('read');
      for (const r of rows) out.set(`${r.a_ref}|${r.b_ref}`, r);
    }
  } catch (e) {
    if (missing(e)) return {missing: true, rows: []};
    throw e;
  }
  return {missing: false, rows: [...out.values()]};
}

// 판정이 없는 짝을 서버 AI(overlap_check)에 물어 표에 저장하게 한다. 8쌍씩 차례로, 한 번이라도 실패·한도면 거기서 조용히 멈춘다. 반환: 판정이 저장된 짝 수.
export async function askPairs(pairs, {rt = reportRuntime(), fetcher} = {}) {
  let judged = 0;
  for (const part of batches(pairs)) {
    const reply = await callAiAssist({kind: 'overlap_check', pairs: part}, {rt, timeoutMs: ASK_MS, ...(fetcher ? {fetcher} : {})});
    if (!reply.ok) break;
    judged += (Array.isArray(reply.data?.results) ? reply.data.results : []).filter(r => r?.state === 'judged').length;
  }
  return judged;
}

// [되살리기]: 짝마다 사용자 판정 different를 쓴다. 하나라도 못 쓰면 false.
export async function reviveOverlaps(pairs, rt = reportRuntime()) {
  if (!pairs?.length) return false;
  for (const {a, b} of pairs) if (!await saveUserVerdict({ref: a}, {ref: b}, 'different', rt)) return false;
  return true;
}

