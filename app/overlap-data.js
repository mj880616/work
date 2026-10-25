// MTG-기록겹침거르기 3단계(화면 ①): 저장 직후 겹침 확인의 읽기·호출·쓰기 한 곳(규칙은 overlap-model.mjs).
// - 모두 기존 경로다: 소유자 RLS 읽기(rt.api), ai-assist overlap_check(callAiAssist), 판정 저장 app_record_overlap_set, 연결 saveReportTargets.
// - 어떤 단계가 실패해도 던지지 않고 "물음 없음"으로 끝난다(저장은 이미 끝났다). 판정·결과를 브라우저 저장소에 두지 않는다.
import {callAiAssist} from './basket-ai-summary.js';
import {reportKindOf, reportKindLabel} from './report-kinds.mjs';
import {readReportTargets, saveReportTargets, reportRuntime} from './report-links.js';
import {seoulDateKey} from './meeting-time.js';
import {makeRef, windowOf, rankCandidates, buildRequest, sameCandidates, userVerdictPayload, linkPlan, mergeTarget, OVERLAP_WAIT_MS} from './overlap-model.mjs';

const enc = encodeURIComponent;
const PER_KIND = 80;
const TYPE = {project_update: '프로젝트 기록', org_update: '담당조직 기록', basket: '업데이트'};
const range = day => { const w = windowOf(day); return w && {from: enc(`${w.from}T00:00:00+09:00`), to: enc(`${w.to}T23:59:59+09:00`)}; };
const list = async (rt, path) => { try { const rows = await rt.api(path); return Array.isArray(rows) ? rows : []; } catch { return []; } };
const workspaceOf = rt => rt.context?.read?.()?.workspace?.id || '';

// 새 기록의 반대편 후보. 사업 보고 → 프로젝트 기록·담당조직 기록·프로젝트/조직에 연결된 업데이트. 프로젝트 기록 → 사업 보고.
export async function readCandidates(record, rt = reportRuntime()) {
  const r = range(record.day), ws = enc(workspaceOf(rt));
  if (!r || !ws) return [];
  if (record.kind === 'project_update') {
    const rows = await list(rt, `/rest/v1/app_meetings?workspace_id=eq.${ws}&meeting_at=gte.${r.from}&meeting_at=lte.${r.to}&select=id,title,series_name,meeting_at,activity_kind,project_id&order=meeting_at.desc&limit=${PER_KIND}`);
    const ids = rows.map(x => x.id).filter(Boolean);
    const links = ids.length ? await list(rt, `/rest/v1/app_record_links?workspace_id=eq.${ws}&source_meeting_id=in.(${ids.map(enc).join(',')})&status=eq.confirmed&select=source_meeting_id,project_id`) : [];
    return rows.filter(x => x.id && x.meeting_at).map(m => {
      const linked = links.some(l => l.source_meeting_id === m.id && l.project_id === record.target?.id) || m.project_id === record.target?.id;
      return {ref: makeRef('meeting', m.id), kind: 'meeting', day: seoulDateKey(m.meeting_at), title: m.series_name || m.title || '', text: '', typeLabel: reportKindLabel(reportKindOf(m)),
        target: linked && record.target ? record.target : null};
    });
  }
  const from = windowOf(record.day).from, to = windowOf(record.day).to;
  const [ups, orgs, baskets] = await Promise.all([
    list(rt, `/rest/v1/app_project_progress_updates?effective_on=gte.${from}&effective_on=lte.${to}&select=id,project_id,summary,effective_on&order=effective_on.desc&limit=${PER_KIND}`),
    list(rt, `/rest/v1/app_suborganization_updates?occurred_at=gte.${r.from}&occurred_at=lte.${r.to}&select=id,organization_id,raw_text,occurred_at&order=occurred_at.desc&limit=${PER_KIND}`),
    list(rt, `/rest/v1/app_notes?workspace_id=eq.${ws}&kind=eq.basket&archived_at=is.null&ai_export_allowed=is.true&occurred_at=gte.${r.from}&occurred_at=lte.${r.to}&select=id,title,raw_text,occurred_at&order=occurred_at.desc&limit=${PER_KIND}`),
  ]);
  const noteIds = baskets.map(x => x.id).filter(Boolean);
  const noteLinks = noteIds.length ? await list(rt, `/rest/v1/app_record_links?workspace_id=eq.${ws}&note_id=in.(${noteIds.map(enc).join(',')})&status=eq.confirmed&select=note_id,project_id,organization_id,meeting_id`) : [];
  const out = [];
  for (const u of ups) if (u.id && u.project_id && typeof u.summary === 'string') out.push({ref: makeRef('project_update', u.id), kind: 'project_update', day: u.effective_on, title: '', text: u.summary, typeLabel: TYPE.project_update, target: {kind: 'project', id: u.project_id}});
  for (const u of orgs) if (u.id && u.organization_id && typeof u.raw_text === 'string' && u.occurred_at) out.push({ref: makeRef('org_update', u.id), kind: 'org_update', day: seoulDateKey(u.occurred_at), title: '', text: u.raw_text, typeLabel: TYPE.org_update, target: {kind: 'organization', id: u.organization_id}});
  for (const n of baskets) {
    const mine = noteLinks.filter(l => l.note_id === n.id);
    // 이 사업 보고로 옮긴 업데이트는 이미 같은 기록으로 이어져 있으니 묻지 않는다(구조적 증거).
    if (!n.id || !n.occurred_at || !mine.length || mine.some(l => l.meeting_id === record.id)) continue;
    const l = mine.find(x => x.project_id || x.organization_id);
    out.push({ref: makeRef('basket', n.id), kind: 'basket', day: seoulDateKey(n.occurred_at), title: n.title || '', text: n.raw_text || '', typeLabel: TYPE.basket,
      target: l?.project_id ? {kind: 'project', id: l.project_id} : l?.organization_id ? {kind: 'organization', id: l.organization_id} : null});
  }
  return out;
}

// 저장 직후 확인: 같은 일로 판정된 후보(점수 순) 목록. 후보가 없거나 어느 단계든 실패·시간 초과면 [].
export async function findSame(record, {rt = reportRuntime(), waitMs = OVERLAP_WAIT_MS} = {}) {
  try {
    const ranked = rankCandidates(record, await readCandidates(record, rt));
    const body = buildRequest(record, ranked);
    if (!body) return [];
    const reply = await callAiAssist(body, {rt, timeoutMs: waitMs});
    return reply.ok ? sameCandidates(record, ranked, reply.data) : [];
  } catch { return []; }
}

// 사용자 판정을 서버 표에 쓴다. 실패하면 false.
export async function saveUserVerdict(record, candidate, verdict, rt = reportRuntime()) {
  const body = userVerdictPayload(workspaceOf(rt), record.ref, candidate.ref, verdict);
  if (!body) return false;
  try { await rt.api('/rest/v1/rpc/app_record_overlap_set', {method: 'POST', body}); return true; } catch { return false; }
}

// [연결로 바꾸기]: 사업 보고에 곳을 잇고(필요하면 쓴 글을 연결 메모로) 같은 일(사용자 판정)로 표시. 반환 {ok, memo:'new'|'kept'|'none'}.
export async function linkAndMark(record, candidate, rt = reportRuntime()) {
  const plan = linkPlan(record, candidate);
  let memo = 'none';
  if (plan) {
    try {
      const row = (await rt.api(`/rest/v1/app_meetings?id=eq.${enc(plan.meetingId)}&workspace_id=eq.${enc(workspaceOf(rt))}&select=id,updated_at`))?.[0];
      if (!row) return {ok: false};
      const merged = mergeTarget(await readReportTargets(row, rt), plan);
      const summaries = merged.summary ? new Map([[`${plan.target.kind}:${plan.target.id}`, merged.summary]]) : null;
      if (merged.added || summaries) {
        const saved = await saveReportTargets(row, merged.targets, rt, summaries);
        if (!saved.ok) return {ok: false};
      }
      memo = merged.summary ? 'new' : merged.keptSummary ? 'kept' : 'none';
    } catch { return {ok: false}; }
    try { window.dispatchEvent(new CustomEvent('kptu:meetings-changed', {detail: {meeting_id: plan.meetingId}})); } catch { /* 화면 갱신은 다음 열기에 */ }
  }
  const marked = await saveUserVerdict(record, candidate, 'same', rt);
  return {ok: !!plan || marked, memo, marked};
}
