// MCP-Claude읽기 M-5(설계 docs/design/mcp-claude-read.md 4.5·4.6절): Supabase Auth OAuth 2.1 서버가 보내는 동의 화면의 그리는 곳 하나.
// 흐름: claude.ai → Supabase /auth/v1/oauth/authorize → 이 화면(?authorization_id=…) → [허락]/[거절] → Supabase가 준 claude.ai 주소로.
// - 로그인 안 했으면 로그인 화면으로 갔다가 이 화면으로 돌아온다(auth-service.js loginUrl).
// - 화면이 먼저 거절: 다른 화면 안(iframe), 요청 번호 모양, 위임 열쇠로 연 화면, 작업공간 owner 아님, 설정 행 없음, 클라이언트가 등록된 Claude 아님,
//   되돌아갈 곳이 claude.ai 되돌아올 주소가 아님. 이 판정은 편의일 뿐이고 실제 차단은 DB 문지기(private.app_mcp_gate)다.
// - Supabase가 준 되돌아갈 주소도 claude.ai일 때만 따라간다. 기기에 아무것도 남기지 않는다.
import {waitInlineHtml} from '../wait-state.js';
import {authorizationPath, consentPath, validAuthorizationId, safeClaudeRedirect, isDelegatedToken, settingsState, readDetails, consentRefusal, REFUSE} from '../mcp-read-model.mjs';
import {word} from '../brand/brand.mjs';

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

function refuse(code) {
  $('#mcCard').innerHTML = `<h1>Claude 연결</h1><p class="mc-status is-error" role="alert">${esc(REFUSE[code] || REFUSE.failed)}</p>`;
}
function go(raw) {
  const url = safeClaudeRedirect(raw);
  if (!url) { refuse('redirect'); return; }
  location.replace(url);
}

async function readSettings(rt) {
  // 비교용으로 allowed_client_id를 읽어 본다. 열 단위 권한으로 막혀 있으면 그 칸 없이 다시 읽는다.
  try { return settingsState(await rt.api('/rest/v1/app_mcp_settings?select=workspace_id,enabled,revoked_before,allowed_client_id&limit=1', {singleFlight: false})); }
  catch { try { return settingsState(await rt.api('/rest/v1/app_mcp_settings?select=workspace_id,enabled,revoked_before&limit=1', {singleFlight: false})); } catch { return null; } }
}

function render(details, settings, id, rt) {
  const off = settings.enabled ? '' : word('<p class="mc-note">허락한 뒤 WORK ON+ 내 프로필 › Claude 연결을 켜야 읽기가 시작돼요.</p>');
  $('#mcCard').innerHTML = word`<h1>Claude 연결</h1>
<p class="mc-lead"><b>${esc(details.clientName || 'Claude')}</b>(claude.ai)가 내 WORK ON+ 기록을 <b>읽기만</b> 해요. 쓰기·삭제·보내기는 할 수 없어요.</p>
<div class="mc-list">
<div class="mc-row"><span class="mc-k">볼 수 있는 것</span><span class="mc-v">담당조직 현황·조직 기록 요지, 사업 보고, 프로젝트 현황, 원장(민감한 기록은 제목만), 노트 제목과 앞부분, 구글 캘린더·할 일 목록 이름. 내 프로필에서 켠 영역(하루 기록·통화·녹음·정리함 원문, 가족 방은 따로 켜야 해요)</span></div>
<div class="mc-row"><span class="mc-k">볼 수 없는 것</span><span class="mc-v">텔레그램·바깥 수집 원문, 첨부·사진 파일 내용, 꺼 둔 영역, 앱 잠금을 건 영역·잠근 폴더, AI 재료에서 뺀 정리함</span></div>
<div class="mc-row"><span class="mc-k">되돌아갈 곳</span><span class="mc-v">claude.ai</span></div>
</div>${off}
<p class="mc-note">언제든 내 프로필 › Claude 연결에서 끄거나 모든 연결을 끊을 수 있어요.</p>
<p class="mc-status" id="mcStatus" role="status"></p>
<div class="mc-actions"><button type="button" class="secondary" data-mc="deny">거절</button><button type="button" class="primary" data-mc="approve">허락</button></div>`;
  $('#mcCard').addEventListener('click', async e => {
    const btn = e.target.closest?.('[data-mc]');
    if (!btn) return;
    for (const b of document.querySelectorAll('[data-mc]')) b.disabled = true;
    $('#mcStatus').innerHTML = waitInlineHtml();
    try {
      const r = await rt.api(consentPath(id), {method: 'POST', body: {action: btn.dataset.mc}, singleFlight: false});
      go(r?.redirect_url);
    } catch { refuse('failed'); }
  });
}

async function start() {
  $('#mcStatus').innerHTML = waitInlineHtml();
  if (window.top !== window.self) { refuse('framed'); return; }
  const id = new URLSearchParams(location.search).get('authorization_id');
  if (!validAuthorizationId(id)) { refuse('bad_request'); return; }
  const rt = window.KPTURuntime;
  if (!(await rt.session.ensure())) { location.replace(window.KPTUAuth.loginUrl(location.href)); return; }
  const session = rt.session.read();
  if (isDelegatedToken(session?.access_token)) { refuse('delegated'); return; }
  const uid = session?.user?.id;
  let raw, owners, settings;
  try {
    [raw, owners, settings] = await Promise.all([
      rt.api(authorizationPath(id), {singleFlight: false}),
      rt.api(`/rest/v1/app_workspace_members?user_id=eq.${encodeURIComponent(uid)}&role=eq.owner&select=workspace_id&limit=2`, {singleFlight: false}),
      readSettings(rt),
    ]);
  } catch { refuse('failed'); return; }
  const details = readDetails(raw);
  if (details.kind === 'redirect') { go(details.url); return; }
  const owner = Array.isArray(owners) && owners.length === 1;
  const problem = consentRefusal({details, owner, settings});
  if (problem) { refuse(problem); return; }
  render(details, settings, id, rt);
}

start().catch(() => refuse('failed'));
