// S69 STORE-계정삭제(구글 플레이 '앱 안에서 계정 삭제'): 내 프로필 '계정' 칸의 [계정 삭제] 버튼과 확인 창의 유일한 주인.
// - 창을 열면 서버(account-delete, action check)가 같은 삭제를 끝까지 해 본 뒤 되돌려 '지울 수 있는지'만 알려 준다(아무것도 안 지워짐).
// - 무엇이 삭제되는지·무엇이 남는지·되돌릴 수 없음을 한 줄로 늘 보이고, 자세한 목록은 접어 둔다.
// - 확인 글자 '삭제'를 넣어야 [계정 삭제]가 눌린다(서버도 같은 글자를 다시 본다). 누가·어느 작업공간인지는 서버가 로그인으로만 정한다.
// - 끝나면 서버가 모든 로그인을 끊고, 이 화면은 평소 로그아웃 길(KPTUTeamAuth.logout)로 로그인 화면에 간다.
// 기기 저장 없음. 창은 뒤로가기로 닫힌다(KPTURouter.layer).
import {waitInlineHtml} from './wait-state.js';
import {groupHtml, actionRow} from './settings-list.mjs';

const ENDPOINT = '/functions/v1/account-delete';
export const CONFIRM_WORD = '삭제';
export const REFUSAL_TEXT = {
  ACCOUNT_OPERATOR_KEEP: '운영자 계정은 여기서 삭제할 수 없어요.',
  ACCOUNT_GROUP_ADMIN_MOVE: "내가 관리자인 묶음에 다른 사람이 있어요. 조직 관리 '내 묶음'에서 관리자를 넘기거나 묶음을 나간 뒤 다시 해 주세요.",
  ACCOUNT_WORKSPACE_SHARED: '이 작업공간에 다른 관리자가 있어 여기서 삭제할 수 없어요. 운영자에게 문의해 주세요.',
  ACCOUNT_WORKSPACE_REQUIRED: '삭제할 작업공간이 없어요.',
  ACCOUNT_DELEGATED_REFUSED: '이 로그인으로는 삭제할 수 없어요. 앱에서 직접 로그인한 뒤 해 주세요.',
  NOT_READY: '아직 준비 중이에요. 잠시 뒤 다시 해 주세요.',
};
export const refusalText = code => REFUSAL_TEXT[code] || '삭제할 수 있는지 확인하지 못했어요. 잠시 뒤 다시 해 주세요.';
// 서버 답의 거절 이름(알려진 것만) → 없으면 함수가 아직 없음(404·503)을 '준비 중'으로.
const errCode = e => (REFUSAL_TEXT[e?.serverCode] ? e.serverCode : '') || (e?.status === 404 || e?.status === 503 ? 'NOT_READY' : '');

const DIALOG_HTML = `<header class="acd-head"><h2 id="accountDeleteTitle">계정 삭제</h2><button type="button" class="icon-btn" data-acd-close aria-label="닫기">×</button></header>
<div class="acd-body">
<p class="acd-lead">서버에 저장된 내 기록을 모두 삭제하고 로그아웃해요. <b>되돌릴 수 없어요.</b> 구글 드라이브·캘린더·할 일의 원본은 내 구글 계정에 그대로 남아요.</p>
<details class="acd-more"><summary>삭제되는 것 · 남는 것</summary>
<p class="acd-sub">삭제되는 것</p>
<ul><li>내 작업공간의 기록 전부: 노트·메모·하루 기록·보고와 회의 기록·원장·자료실 목록·저장한 글·공유 페이지와 사진·일정과 할 일 연결·화면 설정</li>
<li>프로필, 구글 드라이브·캘린더 연결 정보, 폰 알림 등록, 잠금 PIN, 보낸 의견</li>
<li>내 묶음 자리(나 혼자인 묶음은 묶음째). 다른 사람의 기록은 그대로예요.</li></ul>
<p class="acd-sub">남는 것</p>
<ul><li>구글 드라이브 파일, 구글 캘린더 일정, 구글 할 일 — 내 구글 계정에 그대로 있어요. 필요 없으면 구글에서 직접 삭제해요.</li>
<li>로그인에 쓰는 구글 계정. 같은 계정으로 다시 들어오면 빈 작업공간으로 새로 시작할 수 있어요.</li>
<li>서버 장애에 대비한 매일 백업에는 보관 기간(최대 약 1년) 동안 남았다가 저절로 없어져요. 백업은 장애 복구에만 쓰고 운영자는 열어 보지 않아요.</li></ul>
</details>
<div class="acd-confirm"><label for="accountDeleteWord">확인을 위해 '${CONFIRM_WORD}'를 입력해 주세요</label><input id="accountDeleteWord" type="text" data-acd-word autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="accountDeleteStatus"></div>
</div>
<footer class="acd-foot"><p class="status" id="accountDeleteStatus" data-acd-status role="status" aria-live="polite"></p><button type="button" class="ghost" data-acd-close>취소</button><button type="button" class="danger" data-acd-go disabled>계정 삭제</button></footer>`;

let dialog = null, layer = null, state = null;
const $ = sel => dialog?.querySelector(sel);

function say(text, error = false) {
  const el = $('[data-acd-status]');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'status' + (error ? ' error' : '');
}
function paint() {
  if (!state) return;
  const go = $('[data-acd-go]'), word = $('[data-acd-word]');
  word.disabled = state.busy || state.check !== 'ok';
  go.disabled = state.busy || state.check !== 'ok' || word.value.trim() !== CONFIRM_WORD;
  go.textContent = state.busy ? '삭제하는 중…' : '계정 삭제';
}
function close() {
  if (state?.busy) return false;
  const l = layer; layer = null; l?.close();
  if (dialog?.open) dialog.close();
  const t = state?.trigger; state = null;
  if (t?.isConnected) t.focus({preventScroll: true});
  return true;
}
function ensureDialog() {
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'accountDeleteDialog'; dialog.className = 'account-delete-dialog'; dialog.setAttribute('aria-labelledby', 'accountDeleteTitle');
  dialog.innerHTML = DIALOG_HTML;
  document.body.append(dialog);
  dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
  dialog.addEventListener('click', e => {
    if (e.target === dialog || e.target.closest('[data-acd-close]')) { close(); return; }
    if (e.target.closest('[data-acd-go]')) void run();
  });
  dialog.addEventListener('input', paint);
  dialog.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('[data-acd-word]') && !$('[data-acd-go]').disabled) { e.preventDefault(); void run(); } });
  return dialog;
}

async function probe(rt, seq) {
  // 서버 미리 보기 동안은 공용 기다림 표시(wait-state.js) 한 칸.
  const el = $('[data-acd-status]');
  if (el) { el.className = 'status'; el.innerHTML = waitInlineHtml(); }
  let code = '';
  try {
    const r = await rt.api(ENDPOINT, {method: 'POST', body: {action: 'check'}, singleFlight: false, timeoutMs: 60000});
    if (r?.ok === true) code = 'ok'; else code = typeof r?.code === 'string' ? r.code : '';
  } catch (e) { code = errCode(e); }
  if (state?.seq !== seq) return;
  state.check = code === 'ok' ? 'ok' : 'no';
  if (code === 'ok') say(''); else say(refusalText(code), true);
  paint();
  if (code === 'ok') $('[data-acd-word]')?.focus({preventScroll: true});
}

async function run() {
  if (!state || state.busy || state.check !== 'ok' || $('[data-acd-word]').value.trim() !== CONFIRM_WORD) return;
  state.busy = true; paint(); say('삭제하는 중이에요. 창을 닫지 마세요.');
  try {
    const r = await state.rt.api(ENDPOINT, {method: 'POST', body: {action: 'delete', confirm: CONFIRM_WORD}, singleFlight: false, refreshSession: false, timeoutMs: 120000});
    if (r?.ok !== true) throw new Error('ACCOUNT_DELETE_BAD_ANSWER');
    say('삭제했어요. 로그아웃해요.');
    state.done = true;
    // 서버가 이미 모든 로그인을 끊었다. 이 기기의 로그인 정보는 평소 로그아웃 길로 비운다(로그인 화면으로 감).
    setTimeout(() => {
      const logout = window.KPTUTeamAuth?.logout;
      if (typeof logout === 'function') { void logout(); return; }
      state?.rt?.session?.write?.(null); location.reload();
    }, 1200);
  } catch (e) {
    if (!state) return;
    state.busy = false; paint();
    say(errCode(e) ? refusalText(errCode(e)) : '삭제하지 못했어요. 기록은 그대로예요. 잠시 뒤 다시 해 주세요.', true);
  }
}

export function openAccountDelete(trigger, {rt = window.KPTURuntime} = {}) {
  if (!rt?.api) return false;
  ensureDialog();
  const seq = (state?.seq || 0) + 1;
  state = {trigger, rt, seq, check: 'wait', busy: false};
  $('[data-acd-word]').value = '';
  $('.acd-more').open = false;
  paint();
  if (!dialog.open) dialog.showModal();
  if (!layer) layer = window.KPTURouter?.layer?.open('account-delete', {close: () => { if (state?.busy) return false; layer = null; return close(); }}) || null;
  void probe(rt, seq);
  return true;
}

/** 내 프로필 '계정' 장의 따로 떨어진 묶음에 [계정 삭제] 줄 하나(빨간 글자, 공용 설정 줄)를 그린다(한 번만). 누르면 위 확인 창. */
export function mountAccountDelete(host, opts = {}) {
  if (!host || host.querySelector('[data-account-delete]')) return;
  host.innerHTML = groupHtml([actionRow({label: '계정 삭제', desc: '내 기록이 모두 삭제돼요', danger: true, attrs: {'data-account-delete': true}})]);
  const button = host.querySelector('[data-account-delete]');
  button.addEventListener('click', () => openAccountDelete(button, opts));
}
