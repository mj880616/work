// MCP-Claude읽기 M-5(설계 docs/design/mcp-claude-read.md 2판 6·7.1절, 3판 15.2 영역 스위치): 내 프로필 'Claude 연결' 칸(2026-11-28 사용자 결정: 쓰기가 생겨 '읽기'를 뺀 이름)의 화면 주인 하나.
// - 설정: app_mcp_settings(owner RLS, 화면이 고치는 칸은 enabled·revoked_before와 영역 칸 area_* 다섯 — 열 단위 권한). 행은 SQL로만 생긴다(설계 7.6):
//   행이 없으면(다른 사용자, 아직 연결 준비 전) 이 칸은 보이지 않는다. 표가 아직 없을 때(DB 적용 전)도 같다 — 화면은 깨지지 않고 칸만 없다.
//   칸을 숨기는 것은 편의다. 실제로 막는 것은 DB 문지기(private.app_mcp_gate: 행·허용 클라이언트·스위치·끊기 시각·상한)다.
// - 기록: app_mcp_read_log SELECT만(owner). 최근 10줄(언제·어떤 도구·결과)과 이번 달 호출 수. 검색어·내용은 기록에 없다.
// - MCP-Claude쓰기(설계 docs/design/mcp-claude-write.md 5.2): 서버 허용 표에 mcp_write가 있는 계정만 [Claude 쓰기] 스위치(write_enabled 하나만 저장)와
//   접힌 '최근 Claude가 수정한 것'(app_mcp_write_log, 읽기 줄 빼고 20줄: 언제·무엇·글자 수)을 그린다. 줄을 누르면 되돌리기(app_mcp_write_undo, 일반 로그인만 통과).
//   ③ 첨부 줄(파일 수·크기)의 되돌리기는 첨부 [삭제] 서버 길(document-actions trash-file) → app_mcp_attach_undone(일반 로그인만).
//   허용 확인은 DB 문지기가 한다 — 칸을 그리는 것은 편의다. 쓰기 칸 자료를 못 읽으면(DB 적용 전 등) 쓰기 칸만 없다.
// - 기기에는 아무것도 남기지 않는다(모두 서버 저장).
import {settingsState, toolLabel, statusLabel, monthStartIso, COUNT_CAP, countText, AREAS, AREA_COLUMNS, writeLabel, writeChars, undoError, isAttachRow, attachDone} from './mcp-read-model.mjs';
import {hasFeature} from './my-features.js';
import {formatSeoulTime} from './meeting-time.js';
import {waitHtml, failHtml} from './wait-state.js';
import {askConfirm} from './small-notice.js';
import {groupHtml, switchRow, infoRow, foldRow, actionRow, noteHtml} from './settings-list.mjs';

const SETTINGS = '/rest/v1/app_mcp_settings';
const LOG = '/rest/v1/app_mcp_read_log';
const WLOG = '/rest/v1/app_mcp_write_log';
const UNDO = '/rest/v1/rpc/app_mcp_write_undo';
// ③ 첨부 되돌리기: 기존 첨부 [삭제] 서버 길(document-actions trash-file — 그 노트에서 떼고 이 앱 파일이면 Drive 휴지통)을 부른 뒤 되돌림 표시.
const FILE_TRASH = '/functions/v1/document-actions';
const ATTACH_UNDONE = '/rest/v1/rpc/app_mcp_attach_undone';
const WFIELDS = 'id,called_at,kind,action,chars_before,chars_after,undone_at';
const WRECENT = 20;
const RECENT = 10;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const when = at => formatSeoulTime(at, {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'});

/** host 안을 이 함수만 그린다. 설정 행이 없으면 장이 비고 첫 화면 줄도 없다(onSummary show:false). */
export function mountMcpReadSettings(host, {rt = window.KPTURuntime, now = () => new Date(), onSummary} = {}) {
  let settings = null, recent = null, month = null, logFailed = false, busy = false, error = '', loading = null, loaded = false;
  // write: null = 쓰기 칸 없음(허용 안 된 계정·못 읽음), {on} = 쓰기 스위치 값. writes: 최근 고친 것(null = 읽는 중).
  let write = null, writes = null, writesFailed = false;

  // 장 안: 연결 켜기 스위치 / 이번 달 읽은 횟수 / 읽을 영역 스위치 다섯 / 읽지 않는 것 한 줄 / 최근 읽은 기록 ›(접기) / 따로 떨어진 묶음의 모든 연결 끊기(빨간 글자).
  function render() {
    if (!settings) { host.innerHTML = ''; if (loaded) onSummary?.({show: false}); return; }
    const s = settings;
    onSummary?.({text: s.enabled ? '켜짐' : '꺼짐'});
    let log;
    if (logFailed) log = failHtml({retry: 'data-mr-retry'});
    else if (!recent) log = waitHtml({rows: 2});
    else if (!recent.length) log = ''; // 비었으면 접는 줄 대신 '최근 읽은 기록 · 없음' 한 줄(settings-list foldRow)
    else log = `<ol class="mr-log">${recent.map(r => infoRow({label: toolLabel(r.tool), desc: when(r.called_at), sum: `${statusLabel(r.status)}${Number(r.result_count) > 0 ? ` · ${Number(r.result_count).toLocaleString('ko-KR')}건` : ''}`, sumAttrs: {class: `mr-r mr-${r.status}`}})).map(row => `<li>${row}</li>`).join('')}</ol>`;
    const wasOpen = !!host.querySelector('[data-mr-log][open]');
    const wroteOpen = !!host.querySelector('[data-mw-log][open]');
    let wlog = '';
    if (write) {
      if (writesFailed) wlog = failHtml({retry: 'data-mw-retry'});
      else if (!writes) wlog = waitHtml({rows: 2});
      else if (!writes.length) wlog = ''; // 비었으면 '최근 Claude가 수정한 것 · 없음' 한 줄(펼치기 없음)
      else wlog = `<ol class="mr-log">${writes.map(r => r.undone_at || (isAttachRow(r) && !attachDone(r))
        ? infoRow({label: writeLabel(r), desc: `${when(r.called_at)} · ${writeChars(r)}`, sum: r.undone_at ? '되돌림' : ''})
        : actionRow({label: writeLabel(r), desc: `${when(r.called_at)} · ${writeChars(r)}`, sum: '되돌리기', disabled: busy, attrs: {'data-mw-undo': r.id}})).map(row => `<li>${row}</li>`).join('')}</ol>`;
    }
    host.innerHTML = groupHtml([
      switchRow({label: '연결 켜기', desc: write ? 'claude.ai의 Claude가 내 기록을 읽어요(쓰기는 아래 스위치)' : 'claude.ai의 Claude가 내 기록을 읽기만 해요', checked: s.enabled, disabled: busy, attrs: {'data-mr-enabled': true}, ariaLabel: 'Claude 연결 켜기'}),
      infoRow({label: '이번 달 읽은 횟수', sum: month == null ? '' : countText(month), sumAttrs: {'data-mr-month': true}}),
    ]) + groupHtml(AREAS.map(a => switchRow({label: a.label, desc: a.desc, checked: s.areas[a.key], disabled: busy,
        attrs: {'data-mr-area': a.key}, ariaLabel: `Claude가 ${a.label} 읽기`})), {title: '읽을 영역'})
      + noteHtml('앱 잠금을 건 영역·잠근 폴더는 읽지 않아요')
      + (write ? groupHtml([
        switchRow({label: 'Claude 쓰기 켜기', desc: '내가 대화에서 시킨 것만 써요 · 삭제는 휴지통으로', checked: write.on, disabled: busy, attrs: {'data-mw-enabled': true}, ariaLabel: 'Claude 쓰기 켜기'}),
        foldRow({label: '최근 Claude가 수정한 것', sum: writes ? (writes.length ? `${writes.length}줄` : '없음') : '', body: wlog, attrs: {'data-mw-log': true}, open: wroteOpen}),
      ], {title: '쓰기'}) : '')
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
    if (e.target.matches?.('[data-mw-enabled]')) {
      if (busy || !settings || !write) return;
      const want = e.target.checked;
      busy = true; error = ''; render();
      try {
        const rows = await rt.api(`${SETTINGS}?workspace_id=eq.${encodeURIComponent(settings.workspaceId)}&select=write_enabled`, {method: 'PATCH', body: {write_enabled: want}, prefer: 'return=representation', singleFlight: false});
        if (!Array.isArray(rows) || rows.length !== 1) throw new Error('not_saved');
        write = {on: rows[0].write_enabled === true};
      } catch { error = '저장하지 못했어요. 잠시 뒤 다시 해 주세요.'; }
      busy = false; render();
      return;
    }
    const area = e.target.closest?.('[data-mr-area]')?.getAttribute('data-mr-area');
    if ((!area && !e.target.matches?.('[data-mr-enabled]')) || busy || !settings) return;
    if (area && !AREAS.some(a => a.key === area)) return;
    const want = e.target.checked;
    busy = true; error = ''; render();
    try { await patch(area ? {[`area_${area}`]: want} : {enabled: want}); } catch { error = '저장하지 못했어요. 잠시 뒤 다시 해 주세요.'; }
    busy = false; render();
  });
  host.addEventListener('click', async e => {
    if (e.target.closest?.('[data-mr-retry]')) { void loadLog(); return; }
    if (e.target.closest?.('[data-mw-retry]')) { void loadWrites(); return; }
    const undoBtn = e.target.closest?.('[data-mw-undo]');
    if (undoBtn) {
      const id = undoBtn.getAttribute('data-mw-undo');
      if (busy || !write || !id) return;
      const row = (writes || []).find(r => r.id === id);
      const attach = isAttachRow(row);
      if (attach && !attachDone(row)) return;
      if (!(await askConfirm(undoBtn, attach
        ? {text: 'Claude가 붙인 파일을 뺄까요?', note: '노트에서 떼고 파일은 Drive 휴지통으로 가요(30일 안에 되살릴 수 있어요).', ok: '되돌리기'}
        : {text: 'Claude가 한 이 일을 되돌릴까요?', note: '새로 쓴 노트·업데이트는 휴지통으로, 수정한 글은 수정 전으로 돌아가요.', ok: '되돌리기'}))) return;
      busy = true; error = ''; render();
      try {
        if (attach) {
          // 파일마다 첨부 [삭제] 길로 떼기(이미 빠졌으면 그 거절은 넘어감) → 서버가 '더는 안 붙어 있음'을 확인하고 되돌림 표시.
          for (const f of row.files) {
            try { await rt.api(FILE_TRASH, {method: 'POST', body: {action: 'trash-file', target: 'note', id: row.target_id, drive_file_id: f.drive_file_id}, refreshSession: false, singleFlight: false}); }
            catch { /* 이미 뗀 파일 — 아래 확인이 판정한다 */ }
          }
          await rt.api(ATTACH_UNDONE, {method: 'POST', body: {p_log_id: id}, singleFlight: false});
        } else await rt.api(UNDO, {method: 'POST', body: {p_log_id: id}, singleFlight: false});
      } catch (err) { error = undoError(err); }
      busy = false;
      await loadWrites();
      return;
    }
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

  async function loadWrites() {
    writesFailed = false; writes = null; render();
    try {
      const list = fields => rt.api(`${WLOG}?select=${fields}&action=neq.read&order=called_at.desc&limit=${WRECENT}`, {singleFlight: false});
      // ③ 첨부 칸(files·file_bytes·target_id)이 아직 없으면(DB 적용 전) 1판 칸만 읽는다.
      let rows;
      try { rows = await list(`${WFIELDS},target_id,files,file_bytes`); } catch { rows = await list(WFIELDS); }
      writes = Array.isArray(rows) ? rows : [];
    } catch { writesFailed = true; }
    render();
  }

  // 쓰기 칸: 허용 표에 mcp_write가 있을 때만 스위치 값을 읽는다. 못 읽으면 쓰기 칸 없음(읽기 칸은 그대로).
  async function loadWrite() {
    try {
      if (!(await hasFeature(rt, 'mcp_write'))) return null;
      const rows = await rt.api(`${SETTINGS}?select=write_enabled&limit=1`, {singleFlight: false});
      return Array.isArray(rows) && rows.length === 1 ? {on: rows[0].write_enabled === true} : null;
    } catch { return null; }
  }

  async function load() {
    if (loading) return loading;
    loading = (async () => {
      try {
        // 이 칸은 allowed_client_id를 읽지도 고치지도 않는다(동의 화면만 비교용으로 읽어 본다).
        const [rows, w] = await Promise.all([
          rt.api(`${SETTINGS}?select=workspace_id,enabled,revoked_before,${AREA_COLUMNS.join(',')}&limit=1`, {singleFlight: false}),
          loadWrite(),
        ]);
        settings = settingsState(rows);
        write = settings ? w : null;
      } catch { settings = null; write = null; } // 표가 아직 없거나(적용 전) 읽기 실패 → 첫 화면 줄 없음
      loaded = true;
      render();
      if (settings) await Promise.all([loadLog(), write ? loadWrites() : null]);
    })().finally(() => { loading = null; });
    return loading;
  }
  render();
  return {load};
}
