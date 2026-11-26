// S69-94 NOTE-메모통일 ★원문 연결: 메모 줄을 누르면 그 원문 기록을 열고 그 메모 자리로 내려가 잠깐 칠한다.
// 여는 방법은 memo-model.mjs MEMO_OPEN 표(한 곳)를 따른다. 여기는 그 표의 request 이름마다 그 화면에 "이 기록을 열어 줘"를 남기는 일만 한다.
// 메모 자리 찾기는 그 원문의 메모 칸(memo-thread.js)이 붙을 때 takeMemoReveal로 꺼내 한다(화면 메모리만, 기기 저장 없음).
import {memoLink, memoKey, memoFeature, GONE_LINE} from './memo-model.mjs';
import {requestNoteDocOpen} from './basket-note-tasks.js';
import {requestNewsOpen} from './news-request.mjs';
import {requestLibraryDocument} from './basket-library-send.js';
import {noteExists} from './memo-store.js';
import {notify} from './small-notice.js';

export {requestMemoReveal, takeMemoReveal, pendingMemoTarget} from './memo-reveal.js';
import {requestMemoReveal} from './memo-reveal.js';
// S69-95: 운영자 기능에 달린 메모(텔레그램)는 그 기능이 잠겨 있으면 모아 보기에서 글·제목을 가린다(밑줄 모아 보기와 같은 판정, feature-lock.js).
export function memoLocked(memo) {
  const f = memoFeature(memo), lock = window.KPTUFeatureLock;
  return !!f && !!lock?.hides?.(f) && !!lock?.settings?.();
}

const go = view => window.KPTURouter?.go?.(view, {source: 'delegated'});
const rt = () => window.KPTURuntime;
const wsId = () => rt()?.context?.read?.()?.workspace?.id || '';
// 열어 보니 원문이 없으면: 링크를 끄고(모아 보기 줄이 '원래 기록이 없어요'로) 한 줄 알린다. 메모는 그대로.
function gone(o) { noteExists(o.type, o.id, false); notify(`${GONE_LINE} · 메모는 그대로 있어요`, {record: false}); return false; }
// 열기 일(request 이름 → 그 화면에 요청 남기기). 새 종류는 MEMO_OPEN 한 줄 + 여기 한 줄.
const OPENERS = {
  note: o => { requestNoteDocOpen(o.id); go('basket'); },
  news: o => { if (requestNewsOpen({type: o.type, id: o.id})) go('news'); },
  reading: o => { if (window.KPTUReading?.open) window.KPTUReading.open(o.id); else { window.KPTUReadingOpen = {id: o.id}; go('reading'); } },
  // S69-95 자료실 파일: 자료실에서 그 줄을 보이고(기존 '자료실에서 보기' 길) 그 자료 창(이름·종류·날짜·설명 + 메모 칸)을 연다.
  document: async o => {
    requestLibraryDocument(o.id);
    const ok = await window.KPTURouter?.openFrom?.('library', async () => (await import('./library-memo.js')).openDocumentMemo(o.id));
    return ok === false ? gone(o) : true;
  },
  // 사업 보고: 보고 창(지금 화면 위, 사업 관리 PC 칸이 떠 있으면 그 칸)을 열면 맨 아래 메모 칸이 그 메모로 내려간다.
  meeting: async o => {
    const rows = await rt().api(`/rest/v1/app_meetings?id=eq.${encodeURIComponent(o.id)}&workspace_id=eq.${encodeURIComponent(wsId())}&deleted_at=is.null&select=id&limit=1`, {singleFlight: false});
    if (!Array.isArray(rows) || rows[0]?.id !== o.id) return gone(o);
    const {openReport} = await import('./report-open.js');
    await openReport(o.id);
    return true;
  },
  // 담당조직 기록: 그 기록의 조직을 조직 관리에서 열고, 그 기록 창(기록 글 + 메모 칸)을 띄운다. 조직은 기록 줄에서 읽는다(소유자 RLS 그대로).
  org_record: async o => {
    const rows = await rt().api(`/rest/v1/app_suborganization_updates?id=eq.${encodeURIComponent(o.id)}&select=id,organization_id&limit=1`, {singleFlight: false});
    const org = Array.isArray(rows) && rows[0]?.id === o.id ? rows[0].organization_id : '';
    if (!org) return gone(o);
    const ok = await window.KPTURouter?.openFrom?.('team', async () => {
      if (!window.KPTUWorkplace?.openMemo) await window.KPTUWorkplace?.load?.(); // 조직 상세는 처음 열 때 받는다(suborganizations.js)
      return window.KPTUWorkplace?.openMemo?.(org, o.id);
    });
    return ok === false ? gone(o) : true;
  },
  // S71-71 연결 기록: 그 기록이 있는 조직(조직 관리)이나 사업(사업 관리)을 연다. 연결 줄은 내 작업공간 것만 읽는다(소유자 RLS 그대로).
  record_link: async o => {
    const rows = await rt().api(`/rest/v1/app_record_links?id=eq.${encodeURIComponent(o.id)}&workspace_id=eq.${encodeURIComponent(wsId())}&status=eq.confirmed&select=id,organization_id,project_id&limit=1`, {singleFlight: false});
    const r = Array.isArray(rows) && rows[0]?.id === o.id ? rows[0] : null;
    if (!r || (!r.organization_id && !r.project_id)) return gone(o);
    const ok = r.organization_id
      ? await window.KPTURouter?.openFrom?.('team', async () => { if (!window.KPTUWorkplace?.open) await window.KPTUWorkplace?.load?.(); return window.KPTUWorkplace?.open?.(r.organization_id); })
      : await window.KPTURouter?.openFrom?.('projects', async () => window.KPTUProjects?.open?.(r.project_id));
    return ok === false ? gone(o) : true;
  },
  // 텔레그램 소식: 그 방·날을 열고 그 소식 원문을 펼친다(원문 아래 메모 칸). 운영자 기능 검사·소유자 RLS는 그 화면 길 그대로.
  telegram: async o => {
    const {openTelegramItem} = await import('./source-open.js');
    return (await openTelegramItem(o.id)) ? true : gone(o);
  },
};

// 메모 하나의 원문 열기. inPlace(o) = 지금 화면이 스스로 열 수 있으면 true를 돌려준다(노트 화면 안의 노트 메모 등).
// 돌려줌: 열었으면 true, 원문이 없거나 여는 곳이 없으면 false(줄은 '원래 기록이 없어요'로 링크가 꺼져 있다).
export function openMemoSource(memo, {exists = () => undefined, inPlace = null} = {}) {
  const {open} = memoLink(memo, exists);
  if (!open) return false;
  requestMemoReveal(open.type, open.id, open.memo);
  if (inPlace?.(open)) return true;
  const run = OPENERS[open.request];
  if (!run) return false;
  Promise.resolve().then(() => run(open)).catch(() => notify('원래 기록을 열지 못했어요. 다시 눌러 주세요.', {error: true, record: false}));
  return true;
}
