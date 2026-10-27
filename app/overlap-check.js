// MTG-기록겹침거르기 3단계(화면 ①, docs/design/record-overlap.md 4.1절): 프로젝트 기록·사업 보고를 저장한 직후 "비슷한 기록이 있어요"를 작게 묻는다.
// - 저장 경로는 저장이 끝나면 kptu:record-saved {kind: project_update|org_update|basket|meeting, id, day, text, title?, project_id?, organization_id?, targets?}를 알리기만 한다. 이 모듈이 받아 확인하고, 저장 결과는 바꾸지 못한다.
// - 같은 일로 판정된 후보가 있을 때만 알림 한 줄([연결로 바꾸기] [그대로 두기])이 뜬다. 오류·시간 초과·한도·서버 미배포는 아무것도 보이지 않는다.
// - 알림은 기존 되돌리기 알림(.kptu-undo-notice, base-ui.css)과 같은 모양이고 한 번에 하나만 뜬다. 상태는 이 탭 메모리에만 있다(브라우저 저장소 없음).
import {findSame, saveUserVerdict, linkAndMark} from './overlap-data.js';
import {makeRef, candidateLine, linkPlan, NOTICE_TEXT as T} from './overlap-model.mjs';

let box = null, timer = 0, epoch = 0;
export function closeNotice() { clearTimeout(timer); timer = 0; box?.remove(); box = null; }
window.addEventListener('kptu:session-changed', () => { epoch++; closeNotice(); });

function show(record, candidate, rt) {
  closeNotice();
  const host = [...document.querySelectorAll('.modal:not(.hidden)')].at(-1) || document.body;
  const el = document.createElement('div');
  el.className = 'kptu-undo-notice'; el.dataset.overlapNotice = '';
  const canLink = !!linkPlan(record, candidate);
  el.innerHTML = '<span role="status" aria-live="polite" data-overlap-text></span><button type="button" data-undo-action data-overlap-act="link"></button><button type="button" data-undo-action data-overlap-act="keep"></button>';
  const line = el.querySelector('[data-overlap-text]'), link = el.querySelector('[data-overlap-act="link"]'), keep = el.querySelector('[data-overlap-act="keep"]');
  line.textContent = `${T.ask} · ${candidateLine(candidate)}`;
  link.textContent = canLink ? T.link : T.markSame; keep.textContent = T.keep;
  const mine = epoch;
  const finish = text => { if (box !== el) return; link.remove(); keep.remove(); line.textContent = text; clearTimeout(timer); timer = setTimeout(() => { if (box === el) closeNotice(); }, 2400); };
  const run = async work => {
    if (box !== el || link.disabled) return;
    link.disabled = keep.disabled = true; line.textContent = T.working;
    const text = await work();
    if (mine === epoch) finish(text); else closeNotice();
  };
  link.addEventListener('click', () => run(async () => {
    const r = await linkAndMark(record, candidate, rt);
    if (!r.ok) return canLink ? T.linkFailed : T.markFailed;
    return !canLink ? T.marked : r.memo === 'new' ? T.linkedMemo : r.memo === 'kept' ? T.linkedKeepMemo : T.linked;
  }));
  keep.addEventListener('click', () => run(async () => { await saveUserVerdict(record, candidate, 'different', rt); return T.kept; }));
  host.append(el); box = el;
  timer = setTimeout(() => { if (box === el) closeNotice(); }, 30000); // 고르지 않고 두면 닫힌다(판정은 서버에 AI 판정으로 남아 있다).
}

async function onSaved(detail) {
  const rt = window.KPTURuntime;
  const c = rt?.context?.read?.(), s = rt?.session?.read?.();
  if (!s?.access_token || c?.user?.id !== s?.user?.id || c?.membership?.role !== 'owner') return;
  const d = detail || {};
  if (!['project_update', 'org_update', 'basket', 'meeting'].includes(d.kind) || typeof d.id !== 'string' || !d.id || typeof d.text !== 'string' || !d.text.trim()) return;
  // 곳: 프로젝트 한 곳, 담당조직 한 곳, 또는(업데이트만) 여러 곳 {kind, id}[]. 형식이 틀린 곳은 버린다.
  const places = [...(d.project_id ? [{kind: 'project', id: d.project_id}] : []), ...(d.organization_id ? [{kind: 'organization', id: d.organization_id}] : []), ...(d.kind === 'basket' && Array.isArray(d.targets) ? d.targets : [])]
    .filter((t, i, all) => t && ['project', 'organization'].includes(t.kind) && typeof t.id === 'string' && t.id && all.findIndex(o => o?.kind === t.kind && o?.id === t.id) === i);
  const record = {ref: makeRef(d.kind, d.id), id: d.id, kind: d.kind, day: d.day, text: d.text, title: d.title || '', target: places[0] || null, ...(d.kind === 'basket' ? {targets: places} : {})};
  const mine = epoch;
  const found = await findSame(record, {});
  if (mine !== epoch || !found.length) return;
  show(record, found[0], rt);
}
window.addEventListener('kptu:record-saved', e => { void onSaved(e.detail); });
