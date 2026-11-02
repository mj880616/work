// S48-18 저녁 '새 성명 n건'(설계 docs/design/outside-statements.md 3.4·4절 '알림', 요청함 10/31 12:45 할 것 4): 맨 위 알림 줄의 손님 하나.
// 자리·높이는 notice-bar.js가 맡고, 이 파일은 이 줄의 상태 주인이자 유일한 렌더러다.
// - 언제: 서울 18:10(18:07 예약 수집 뒤)부터 자정 전까지, 사회운동 Now [새로 온 것]을 마지막으로 본 시각(app_outside_seen, 서버) 뒤에 받은 글이 있을 때.
//   재료는 이미 있는 두 표를 owner RLS로 읽기만 한다(새 서버 함수·새 표 없음). 폰 알림 한 줄(phone-push evening 묶음)은 phone-push N5 뒤 몫.
// - [보기]: 사회운동 Now [새로 온 것]으로(들어가면 화면이 본 시각을 지금으로 바꿔 줄이 저절로 사라진다).
// - ✕: '확인함' — 본 시각을 지금으로 서버에 둔다(폰·PC 같게, 이 기기에는 아무것도 저장하지 않음). 그 뒤 새 글이 들어오면 다시 뜬다.
// - 다시 묻기: 시작할 때, 화면이 다시 보일 때·화면을 옮길 때 10분에 한 번까지. 로그인한 사람이 바뀌면 멈춘다. 로그에 글 제목을 남기지 않는다.
import {putNotice, removeNotice} from './notice-bar.js';
import {eveningOpen, outsideNoticeText, COUNT_CAP} from './notice-outside-model.mjs';

const ICON = '<svg class="kptu-notice-line-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5h12M4 10h12M4 15h8"/></svg>';
const KEY = 'outside-new';
const PRIORITY = 35; // 4절 표: 연결 끊김 10 · 수집 멈춤 20 · 뒤에서 끝난 일 30 · (새 성명 35) · 업데이트 40
const AGAIN_MS = 10 * 60 * 1000;

export function startOutsideNotice({rt = window.KPTURuntime, win = window, now = () => Date.now()} = {}) {
  if (!rt?.api) return null;
  const q = v => encodeURIComponent(v);
  const workspace = () => rt?.context?.read?.()?.workspace?.id || '';
  let el = null, run = 0, lastAsk = 0, stopped = false;

  function drop() { if (el) { removeNotice(KEY); el = null; } }
  async function markSeen() {
    const w = workspace(), at = new Date(now()).toISOString();
    if (!w) return;
    // 사회운동 Now와 같은 쓰기: 줄이 있으면 고치고(seen_at·updated_at), 없으면 넣는다(workspace_id·seen_at).
    const rows = await rt.api(`/rest/v1/app_outside_seen?workspace_id=eq.${q(w)}&select=seen_at`, {method: 'PATCH', body: {seen_at: at, updated_at: at}, prefer: 'return=representation', singleFlight: false});
    if (!Array.isArray(rows) || !rows.length) await rt.api('/rest/v1/app_outside_seen', {method: 'POST', body: {workspace_id: w, seen_at: at}, prefer: 'return=minimal', singleFlight: false});
  }
  function show(text) {
    if (!el) {
      el = win.document.createElement('aside');
      el.className = 'kptu-notice-line'; el.dataset.notice = KEY; el.setAttribute('aria-label', '새 성명 안내');
      el.innerHTML = `${ICON}<span role="status"></span><button type="button" class="kptu-notice-line-action" data-notice-act>보기</button><button type="button" class="kptu-notice-line-close" data-notice-close aria-label="닫기">✕</button>`;
      el.querySelector('[data-notice-act]').onclick = () => { run++; drop(); win.KPTUOutside?.showNew?.(); win.KPTURouter?.go?.('outside', {source: 'delegated'}); };
      el.querySelector('[data-notice-close]').onclick = () => { run++; drop(); void markSeen().catch(() => {}); };
    }
    el.querySelector('[role="status"]').textContent = text;
    putNotice(KEY, {priority: PRIORITY, element: el});
  }
  async function refresh({force = false} = {}) {
    if (stopped) return;
    if (!force && Date.now() - lastAsk < AGAIN_MS) return;
    const mine = ++run;
    if (!eveningOpen(now()) || win.KPTURouter?.current === 'outside') { drop(); return; }
    const w = workspace();
    if (!w) return;
    lastAsk = Date.now();
    try {
      const seen = await rt.api(`/rest/v1/app_outside_seen?workspace_id=eq.${q(w)}&select=seen_at&limit=1`, {singleFlight: false});
      const at = Array.isArray(seen) ? seen[0]?.seen_at : null;
      if (mine !== run || stopped) return;
      // 한 번도 연 적이 없으면 기준 시각이 없어 띄우지 않는다(처음 켠 날 옛 글이 '새 글'로 쏟아지지 않게).
      if (!at) { drop(); return; }
      const rows = await rt.api(`/rest/v1/app_outside_posts?workspace_id=eq.${q(w)}&fetched_at=gt.${q(at)}&select=id&limit=${COUNT_CAP + 1}`, {singleFlight: false});
      if (mine !== run || stopped) return;
      const text = outsideNoticeText(Array.isArray(rows) ? rows.length : 0);
      if (text && win.KPTURouter?.current !== 'outside') show(text); else drop();
    } catch { /* 못 읽으면 줄을 바꾸지 않는다(아는 것만 보인다) */ }
  }

  const onVisible = () => { if (win.document.visibilityState === 'visible') void refresh(); };
  // 사회운동 Now에 들어가면 줄을 내리고(화면이 본 시각을 바꾼다), 나오면 다음 묻기 때 다시 본다.
  const onView = event => { if (event.detail?.view === 'outside') { run++; drop(); lastAsk = 0; } else void refresh(); };
  win.document.addEventListener('visibilitychange', onVisible);
  win.addEventListener('kptu:view-changed', onView);
  const owner = rt?.session?.read?.()?.user?.id;
  function sessionChanged(event) {
    if (owner && event.detail?.session?.user?.id === owner) return;
    stopped = true; run++; drop();
    win.document.removeEventListener('visibilitychange', onVisible);
    win.removeEventListener('kptu:view-changed', onView);
    win.removeEventListener('kptu:session-changed', sessionChanged);
  }
  win.addEventListener('kptu:session-changed', sessionChanged);
  void refresh({force: true});
  return {refresh};
}
