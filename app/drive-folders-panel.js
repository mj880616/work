// S69-41(명진 11/24 "이 기능은 좋은데 이게 자료실에 있는게 좀 뜬금없는느낌임"): [앱 폴더 모으기]를 자료실 위 줄에서 이 칸으로 옮겼다.
// 내 프로필 '구글 드라이브' 칸 한 줄: '앱이 쓰는 드라이브 폴더: 내 드라이브 › (앱 폴더 이름) [열기 ↗] [한곳으로 모으기]' + 결과 한 줄.
// 이미 다 모았고 옛 이름도 없으면 버튼 대신 '모아 둠'. 이 칸(host) 안은 이 모듈만 그린다.
// 서버: workspace-drive POST ?action=gather-folders — 세기(dry_run)로 이름·주소·모을 수·바꿀 이름 수를 받고, 누르면 확인창 → 옮기기·이름 맞추기
// (S69-22 모으기 + S69-41 옛 이름 → 'WORK ON+ …'). 옮길 폴더·바꿀 이름은 서버가 표식으로 고른다(화면은 id를 보내지 않음). 지우기 없음, 자동으로는 돌지 않음.
import {askConfirm, notify as smallNotify} from './small-notice.js';

const GATHER = '/functions/v1/workspace-drive?action=gather-folders';
const GATHER_ROUNDS = 5;
const KIND_WORDS = {basket: '바구니', record_backup: '기록 백업', edit_backup: '편집 백업', copy: '읽기용 사본'};
const DRIVE_FOLDER_URL = /^https:\/\/drive\.google\.com\/drive\/folders\/[A-Za-z0-9_-]{10,200}$/;
const rootName = name => typeof name === 'string' && name.trim() ? name.trim().slice(0, 60) : '맨 위 앱 폴더';
const num = v => Math.max(0, Number(v) || 0);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

/** 세기 답 → 확인창 글. 모을 것도 바꿀 이름도 없으면 null. */
export function gatherAskText(plan) {
  const count = num(plan?.count), rename = num(plan?.rename);
  if (!count && !rename) return null;
  const where = rootName(plan?.root_name);
  const kinds = Object.entries(plan?.kinds || {}).filter(([k, n]) => KIND_WORDS[k] && n > 0).map(([k, n]) => n > 1 ? `${KIND_WORDS[k]} ${n}` : KIND_WORDS[k]);
  const text = count && rename ? `앱 폴더 ${count}개를 '${where}' 아래로 모으고, 옛 이름 ${rename}개를 새 이름으로 바꿀까요?`
    : count ? `앱 폴더 ${count}개를 '${where}' 아래로 모을까요?`
    : `앱 폴더의 옛 이름 ${rename}개를 새 이름으로 바꿀까요?`;
  return {
    text,
    note: (kinds.length ? kinds.join(' · ') + '. ' : '') + (plan?.root_new ? `'${where}' 폴더를 새로 만들어 넣습니다. ` : '')
      + '삭제하지 않고 자리·이름만 바꿔요. 링크는 그대로예요. 내가 만든 폴더와 직접 바꾼 이름은 그대로 둬요.',
  };
}

/** 끝난 숫자 → 결과 한 줄 {text, error}. */
export function gatherResultText({moved = 0, failed = 0, left = 0, renamed = 0, renameFailed = 0, renameLeft = 0, where = ''} = {}) {
  const done = [];
  if (moved) done.push(`앱 폴더 ${moved}개를 '${rootName(where)}' 아래로 모았어요`);
  if (renamed) done.push(`이름 ${renamed}개를 새 이름으로 바꿨어요`);
  const miss = failed + left + renameFailed + renameLeft;
  if (!done.length) return {text: miss ? '드라이브 폴더를 바꾸지 못했어요. 잠시 뒤 다시 눌러 주세요.' : '모을 폴더도, 바꿀 이름도 없어요.', error: !!miss};
  return {text: done.join(' · ') + (miss ? ` · ${miss}개는 하지 못했어요 — 다시 눌러 주세요.` : '.'), error: !!miss};
}

/** [한곳으로 모으기] 한 번: 세기 → 확인 → 옮기기·이름 맞추기(남으면 이어서). 답: 숫자 묶음 또는 null(취소·없음·실패). */
export async function gatherAppFolders({api, anchor = null, ask = askConfirm, say = smallNotify, plan = null}) {
  if (!plan) {
    try { plan = await api(GATHER, {method: 'POST', body: {dry_run: true}}); }
    catch { say('드라이브 폴더를 확인하지 못했어요. 잠시 뒤 다시 눌러 주세요.', {error: true}); return null; }
  }
  const q = gatherAskText(plan);
  if (!q) { say('모을 폴더도, 바꿀 이름도 없어요. 이미 모아 뒀어요.'); return null; }
  if (!(await ask(anchor, {text: q.text, note: q.note, ok: '모으기'}))) return null;
  const sum = {moved: 0, failed: 0, left: 0, renamed: 0, renameFailed: 0, renameLeft: 0, where: plan.root_name};
  for (let round = 0; round < GATHER_ROUNDS; round++) {
    let r;
    try { r = await api(GATHER, {method: 'POST', body: {}}); }
    catch { sum.failed += Math.max(0, num(plan.count) - sum.moved - sum.failed); break; }
    sum.moved += num(r?.moved); sum.failed += num(r?.failed); sum.left = num(r?.left);
    sum.renamed += num(r?.renamed); sum.renameFailed = num(r?.rename_failed); sum.renameLeft = num(r?.rename_left);
    sum.where = r?.root_name || sum.where;
    // 이름 맞추기 실패는 다음 부름에서 또 후보로 잡히므로 마지막 부름의 실패 수만 남긴다(부풀리지 않음).
    const progressed = num(r?.moved) > 0 || num(r?.renamed) > 0;
    if ((!sum.left && !sum.renameLeft) || !progressed) break;
  }
  const r = gatherResultText(sum);
  say(r.text, {error: r.error});
  return sum;
}

/** 세기 답 → 그릴 값. 모양이 어긋나면 null(칸을 감춤). */
export function cleanPlan(plan) {
  if (!plan || typeof plan !== 'object' || plan.ok !== true) return null; // 서버 답 모양(ok:true)일 때만 그린다
  const url = typeof plan.root_url === 'string' && DRIVE_FOLDER_URL.test(plan.root_url) ? plan.root_url : null;
  return {name: rootName(plan.root_name), url, isNew: plan.root_new === true, count: num(plan.count), rename: num(plan.rename), raw: plan};
}

/** 칸 HTML. result: 결과 한 줄 {text, error} 또는 null. */
export function driveFoldersHtml(p, {busy = false, result = null} = {}) {
  if (!p) return '';
  const where = `내 드라이브 › ${esc(p.name)}${p.isNew ? ' (아직 없음)' : ''}`;
  const open = p.url ? `<a class="dfp-open" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer" aria-label="구글 드라이브에서 ${esc(p.name)} 열기">열기 ↗</a>` : '';
  const todo = p.count || p.rename;
  const act = todo
    ? `<button type="button" class="row-act dfp-gather" data-dfp-gather${busy ? ' disabled aria-busy="true"' : ''} title="앱이 쓰는 드라이브 폴더를 한곳으로 모으고 옛 이름을 새 이름으로">${busy ? '모으는 중…' : '한곳으로 모으기'}</button>`
    : '<span class="dfp-done">모아 둠</span>';
  const line = result ? `<p class="dfp-result${result.error ? ' dfp-error' : ''}" role="status">${esc(result.text)}</p>` : '';
  return `<h3>구글 드라이브</h3><div class="dfp-line"><span class="dfp-label">앱이 쓰는 드라이브 폴더:</span><span class="dfp-where">${where}</span>${open}${act}</div>${line}`;
}

/** 내 프로필 '구글 드라이브' 칸. 드라이브 연결이 없거나 읽기가 실패하면 칸을 감춘다(안내문을 따로 두지 않음). */
export function mountDriveFolders(host, {rt = globalThis.window?.KPTURuntime, ask = askConfirm} = {}) {
  let plan = null, busy = false, result = null, owner = 0;
  const api = (path, init) => rt.api(path, init);
  function render() {
    const html = driveFoldersHtml(plan, {busy, result});
    if (host.innerHTML !== html) host.innerHTML = html;
    host.hidden = !html;
  }
  async function load() {
    const mine = ++owner;
    let next = null;
    try { next = cleanPlan(await api(GATHER, {method: 'POST', body: {dry_run: true}})); } catch { next = null; }
    if (mine !== owner) return;
    plan = next; render();
  }
  host.addEventListener('click', async e => {
    const btn = e.target.closest?.('[data-dfp-gather]');
    if (!btn || busy || !plan) return;
    busy = true; result = null; render();
    const anchor = host.querySelector('[data-dfp-gather]');
    let said = null;
    try { await gatherAppFolders({api, anchor, ask, plan: plan.raw, say: (text, o) => { said = {text, error: !!o?.error}; }}); }
    finally { busy = false; result = said; }
    await load();
  });
  render();
  return {load, plan: () => plan, busy: () => busy};
}
