// S69-BM 저장 창(app/save/?u=글 주소&t=제목): PC 크롬 즐겨찾기 막대의 버튼(app/save-bookmarklet-model.mjs)이 작은 창으로 연다. 이 창의 유일한 그리기 주인.
// 순서: 다른 페이지 안(틀)이면 멈춤 → 주소 검사(http·https만) → 이 브라우저의 기존 로그인 확인(없으면 이 창에서 로그인 → 같은 주소로 돌아와 이어서 저장)
//   → 내 작업공간 확인(기존 시작 순서와 같은 owner 한 줄) → 기존 저장한 글 넣기 길(reading-data.js addItem: 표 app_reading_items, owner RLS·같은 주소는 한 줄)
//   → '저장됨 ✓'(이미 있으면 '이미 저장됨') 잠깐 보이고 창 닫기. 방금 넣은 줄만 [취소](같은 줄 지우기 — reading-data.js removeItem).
// 원문은 받지 않는다: 저장한 글 화면이 열릴 때 기존 note-import 길로 받는다(reading.js autoRefetch, 하루 횟수를 창 닫힘으로 버리지 않음).
// 이 창은 연 페이지(글 페이지)에 아무것도 돌려주지 않는다(opener 끊음, postMessage 없음). 새 저장 길·새 서버 권한 없음. 기기 저장 없음.
import {readSaveParams, reasonWord, SAVE_WORDS as W, CLOSE_MS, CANCEL_CLOSE_MS} from '../save-bookmarklet-model.mjs';
import {APP_NAME} from '../brand/brand.mjs';

try { window.opener = null; } catch { /* 끊지 못해도 이 창은 연 페이지에 아무것도 보내지 않는다 */ }
const $ = s => document.querySelector(s);
const msg = $('[data-sv-msg]'), titleEl = $('[data-sv-title]'), acts = $('[data-sv-acts]');
$('[data-sv-app]').textContent = APP_NAME;
let closeTimer = 0;
const show = (text, {bad = false} = {}) => { msg.textContent = text; msg.classList.toggle('is-bad', bad); };
const buttons = list => {
  acts.replaceChildren(...list.map(([label, run, key]) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.dataset.svAct = key; b.addEventListener('click', run); return b; }));
  acts.hidden = !list.length;
};
const closeSoon = ms => { clearTimeout(closeTimer); closeTimer = setTimeout(() => { try { window.close(); } catch { /* 스크립트가 연 창이 아니면 닫히지 않는다 — 글자는 그대로 */ } }, ms); };

async function workspaceOf(rt) {
  const user = rt.session.read()?.user;
  if (!user?.id) return null;
  const rows = await rt.api('/rest/v1/app_workspace_members?user_id=eq.' + encodeURIComponent(user.id) + '&select=workspace_id,role,workspace:app_workspaces(id,slug,name)&limit=1');
  const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  if (!row || row.role !== 'owner' || !row.workspace_id) return null;
  return rt.context.set({user, membership: row, workspace: row.workspace?.id ? row.workspace : {id: row.workspace_id}});
}

async function save(got) {
  show(W.busy); buttons([]);
  const rt = window.KPTURuntime;
  let ok = false;
  try { ok = !!(rt && await rt.session.ensure()); } catch { ok = false; }
  if (!ok) { show(W.login); location.replace(window.KPTUAuth.loginUrl(location.href)); return; }
  let ctx = null;
  try { ctx = await workspaceOf(rt); } catch { ctx = undefined; }
  if (ctx === null) { show(W.noWorkspace, {bad: true}); return; }
  let out = null;
  try { const {addItem} = await import('../reading-data.js'); if (ctx) out = await addItem(got.url, got.title); }
  catch { out = null; }
  if (!out?.row?.id) { show(W.fail, {bad: true}); buttons([[W.retry, () => void save(got), 'retry']]); return; }
  if (out.dup) { show(W.dup); buttons([]); closeSoon(CLOSE_MS); return; }
  show(W.done);
  buttons([[W.cancel, () => void cancel(out.row.id), 'cancel']]);
  closeSoon(CLOSE_MS);
}

async function cancel(id) {
  clearTimeout(closeTimer);
  buttons([]);
  try { const {removeItem} = await import('../reading-data.js'); await removeItem(id); show(W.canceled); closeSoon(CANCEL_CLOSE_MS); }
  catch { show(W.cancelFail, {bad: true}); }
}

function start() {
  if (window.top !== window.self) { show(W.framed, {bad: true}); return; }
  const got = readSaveParams(location.search);
  if (!got.ok) { show(reasonWord(got.reason), {bad: true}); return; }
  titleEl.textContent = got.title || got.url;
  void save(got);
}
// defer 스크립트(runtime·로그인)가 끝난 뒤 시작한다.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true}); else start();
