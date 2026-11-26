// MCP-Claude읽기 M-5(설계 docs/design/mcp-claude-read.md 2판 6·7.1절): 내 프로필 'Claude 읽기 연결' 칸의 화면 주인 하나.
// - 설정: app_mcp_settings(owner RLS, 화면이 고치는 칸은 enabled·revoked_before 둘뿐 — 열 단위 권한). 행은 SQL로만 생긴다(설계 7.6):
//   행이 없으면(다른 사용자, 아직 연결 준비 전) 이 칸은 보이지 않는다. 표가 아직 없을 때(DB 적용 전)도 같다 — 화면은 깨지지 않고 칸만 없다.
//   칸을 숨기는 것은 편의다. 실제로 막는 것은 DB 문지기(private.app_mcp_gate: 행·허용 클라이언트·스위치·끊기 시각·상한)다.
// - 기록: app_mcp_read_log SELECT만(owner). 최근 10줄(언제·어떤 도구·결과)과 이번 달 호출 수. 검색어·내용은 기록에 없다.
// - 기기에는 아무것도 남기지 않는다(모두 서버 저장).
import {settingsState, toolLabel, statusLabel, monthStartIso, COUNT_CAP, countText} from './mcp-read-model.mjs';
import {formatSeoulTime} from './meeting-time.js';
import {waitHtml, failHtml, emptyHtml} from './wait-state.js';
import {askConfirm} from './small-notice.js';
import {groupHtml, switchRow, infoRow, foldRow, actionRow, noteHtml} from './settings-list.mjs';

const SETTINGS = '/rest/v1/app_mcp_settings';
const LOG = '/rest/v1/app_mcp_read_log';
const RECENT = 10;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const when = at => formatSeoulTime(at, {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'});

/** host 안을 이 함수만 그린다. 설정 행이 없으면 장이 비고 첫 화면 줄도 없다(onSummary show:false). */
export function mountMcpReadSettings(host, {rt = window.KPTURuntime, now = () => new Date(), onSummary} = {}) {
  let settings = null, recent = null, month = null, logFailed = false, busy = false, error = '', loading = null, loaded = false;

  // 장 안: 연결 켜기 스위치 / 이번 달 읽은 횟수 / 읽지 않는 것 한 줄 / 최근 읽은 기록 ›(접기) / 따로 떨어진 묶음의 모든 연결 끊기(빨간 글자).
  function render() {
    if (!settings) { host.innerHTML = ''; if (loaded) onSummary?.({show: false}); return; }
    const s = settings;
    onSummary?.({text: s.enabled ? '켜짐' : '꺼짐'});
    let log;
    if (logFailed) log = failHtml({retry: 'data-mr-retry'});
    else if (!recent) log = waitHtml({rows: 2});
    else if (!recent.length) log = emptyHtml();
    else log = `<ol class="mr-log">${recent.map(r => infoRow({label: toolLabel(r.tool), desc: when(r.called_at), sum: `${statusLabel(r.status)}${Number(r.result_count) > 0 ? ` · ${Number(r.result_count).toLocaleString('ko-KR')}건` : ''}`, sumAttrs: {class: `mr-r mr-${r.status}`}})).map(row => `<li>${row}</li>`).join('')}</ol>`;
    const wasOpen = !!host.querySelector('[data-mr-log][open]');
    host.innerHTML = groupHtml([
      switchRow({label: '연결 켜기', desc: 'claude.ai의 Claude가 내 기록을 읽기만 해요', checked: s.enabled, disabled: busy, attrs: {'data-mr-enabled': true}, ariaLabel: 'Claude 읽기 연결 켜기'}),
      infoRow({label: '이번 달 읽은 횟수', sum: month == null ? '' : countText(month), sumAttrs: {'data-mr-month': true}}),
    ]) + noteHtml('하루 기록·통화·녹음·정리함 원문·가족 방은 읽지 않아요')
      + (error ? `<p class="sl-status sl-error mr-error" role="alert">${esc(error)}</p>` : '')
      + groupHtml([
        foldRow({label: '최근 읽은 기록', sum: recent ? (recent.length ? `${recent.length}줄` : '없음') : '', body: log, attrs: {'data-mr-log': true}, open: wasOpen}),
        actionRow({label: '모든 연결 끊기', desc: s.revokedBefore ? `마지막으로 모두 끊은 때 ${when(s.revokedBefore)}` : '', danger: true, disabled: busy, attrs: {'data-mr-revoke': true}}),
      ]);
  }

  async function patch(body) {
    const rows = await rt.api(`${SETTINGS}?workspace_id=eq.${encodeURIComponent(settings.workspaceId)}`, {method: 'PATCH', body, prefer: 'return=representation', singleFlight: false});
    const next = settingsState(rows);
    if (!next) throw new Error('not_saved');
    settings = next;
  }

  host.addEventListener('change', async e => {
    if (!e.target.matches?.('[data-mr-enabled]') || busy || !settings) return;
    const want = e.target.checked;
    busy = true; error = ''; render();
    try { await patch({enabled: want}); } catch { error = '저장하지 못했어요. 잠시 뒤 다시 해 주세요.'; }
    busy = false; render();
  });
  host.addEventListener('click', async e => {
    if (e.target.closest?.('[data-mr-retry]')) { void loadLog(); return; }
    const btn = e.target.closest?.('[data-mr-revoke]');
    if (!btn || busy || !settings) return;
    if (!(await askConfirm(btn, {text: '지금까지 맺은 Claude 연결을 모두 끊을까요?', note: '다시 쓰려면 claude.ai에서 다시 연결해야 해요.', ok: '끊기', danger: true}))) return;
    busy = true; error = ''; render();
    try { await patch({revoked_before: now().toISOString()}); } catch { error = '끊지 못했어요. 잠시 뒤 다시 해 주세요.'; }
    busy = false; render();
  });

  async function loadLog() {
    logFailed = false; recent = null; render();
    try {
      const [rows, ids] = await Promise.all([
        rt.api(`${LOG}?select=called_at,tool,status,result_count&order=called_at.desc&limit=${RECENT}`, {singleFlight: false}),
        rt.api(`${LOG}?select=id&called_at=gte.${encodeURIComponent(monthStartIso(now()))}&limit=${COUNT_CAP}`, {singleFlight: false}),
      ]);
      recent = Array.isArray(rows) ? rows : [];
      month = Array.isArray(ids) ? ids.length : 0;
    } catch { logFailed = true; }
    render();
  }

  async function load() {
    if (loading) return loading;
    loading = (async () => {
      try {
        // 이 칸은 allowed_client_id를 읽지도 고치지도 않는다(동의 화면만 비교용으로 읽어 본다).
        settings = settingsState(await rt.api(`${SETTINGS}?select=workspace_id,enabled,revoked_before&limit=1`, {singleFlight: false}));
      } catch { settings = null; } // 표가 아직 없거나(적용 전) 읽기 실패 → 첫 화면 줄 없음
      loaded = true;
      render();
      if (settings) await loadLog();
    })().finally(() => { loading = null; });
    return loading;
  }
  render();
  return {load};
}
