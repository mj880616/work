// UI-올리기진행표시(S52-15, 요청함 11/07 11:40, 시안 docs/design/mockups/upload-progress.html 명진 11:41 'ㅇ'): 올리는 중 표시 공용 부품 하나.
// 상태 주인은 이 모듈의 올리기 목록(jobs) 하나이고, 그리는 곳은 셋이다(모두 이 파일).
//   ① mountUploadRows(host, {has}) — 첨부 줄: 맨 위 합계 줄('올리는 중 n개 · 보낸 양/전체 · %'), 파일마다 얇은 막대 + % + ✕(취소),
//      실패는 '실패' + [다시], 완료는 '✓ 완료' 1초 뒤 사라지고 화면의 보통 첨부 줄이 그 자리를 맡는다.
//      preview(job)가 그림 주소를 주면 그 줄은 흐린 미리보기 위 막대 + %(② 글 안 사진).
//   ② paintUploadOverlay(tile, file) — 이미 있는 미리보기 칸(일기 고른 사진) 위에 막대 + %.
//   ③ 하단바 위 한 줄(#uploadDock) — 올리는 줄을 보이는 화면이 없을 때(다른 화면으로 갔거나 창을 닫음)만 '파일 3개 올리는 중 71%',
//      끝나면 'n개 올림 · [보기]'(올리기를 시작한 화면으로), 실패가 있으면 'n개 못 올림 · [보기]'.
// %는 upload-send.mjs가 알린 실제 보낸 양뿐이다. 다 보낸 뒤 서버 답을 기다리는 동안은 '마무리 중…'(%를 꾸며 올리지 않음).
// 끝없이 도는 표시는 없다: 보낸 양이 20초 동안 그대로이거나 마무리가 45초를 넘으면 '느려요 · [계속 기다리기] [취소]'(마무리 중에는
// 서버가 이미 받았을 수 있어 [취소] 없이 [계속 기다리기]만). 끝은 언제나 upload-budget.mjs의 시간 한도가 정한다.
// 기기에 아무것도 저장하지 않는다(메모리뿐, 로그인이 바뀌면 비움).
// BIZ-저장먼저닫기(S58-1): 뒤 줄에 선 한 묶음(사업 보고 저장 뒤 사진·자료)은 차례를 기다리는 파일도 처음부터 목록에 있다(phase 'waiting', '대기').
//   묶음(group)의 %는 이미 올린 양을 더해 끝까지 한 방향으로 오르고, 묶음이 끝나면 announceDock으로 ③ 한 줄에 그 묶음의 말
//   ('사진 n장·자료 n개 올렸어요', 못 올렸으면 [다시 올리기])을 띄운다.
// APP-뒤에서올리기 PR-2(S58-12): 폰 앱에 넘긴 파일은 phase 'handed'('앱이 올리는 중' — 화면은 보내지 않으므로 %·막대·✕가 없다). 앱이 끝을 알려 오면
//   부른 곳이 done()·fail()로 옮긴다. 앱이 멈췄으면 '멈춤'(까닭은 부른 곳이 한 줄로 알린다). 올리는 중 합계·하단 한 줄의 %에는 세지 않는다(보낸 양을 모른다).
import {amount, percent} from './upload-send.mjs';

export const SLOW_SENDING_MS = 20000;
export const SLOW_FINISH_MS = 45000;
export const DONE_SHOW_MS = 1000;
export const DOCK_DONE_MS = 6000;

const jobs = new Map();
const subs = new Set();
let seq = 0, ticker = null;

function changed() {
  for (const fn of [...subs]) { try { fn(); } catch { /* 그리기 하나가 다른 것을 막지 않는다 */ } }
  try { paintDock(); } catch { /* 한 줄이 올리기를 막지 않는다 */ }
  const busy = [...jobs.values()].some(going);
  if (busy && !ticker) { ticker = setInterval(tick, 1000); ticker.unref?.(); }
  else if (!busy && ticker) { clearInterval(ticker); ticker = null; }
}
// going: 지금 보내는 중·마무리 중. live: 차례를 기다리는 것(waiting)까지 — 합계 줄·하단 한 줄이 세는 것.
const going = job => job.phase === 'sending' || job.phase === 'finishing';
const live = job => going(job) || job.phase === 'waiting';
// 하단 한 줄의 보낸 양·전체: 살아 있는 것 + 그 묶음이 이미 다 올린 양(묶음의 %가 파일이 끝날 때마다 0으로 돌아가지 않게).
export function uploadTotals(list = uploadJobs().filter(live)) { return sums(list); }
function sums(list) {
  let total = 0, loaded = 0; const groups = new Set();
  for (const job of list) { total += job.total || 0; loaded += job.phase === 'finishing' ? job.total : job.loaded; if (job.group) groups.add(job.group); }
  for (const group of groups) { total += group.sent || 0; loaded += group.sent || 0; }
  return {total, loaded};
}
export function watchUploads(fn) { subs.add(fn); return () => subs.delete(fn); }
export const uploadJobs = () => [...jobs.values()];
export const isUploading = file => [...jobs.values()].some(job => job.file === file);
// 걸린 시간은 단조 시계로 잰다(기기 시각을 바꿔도 '느려요'가 틀리지 않게). 시험은 setUploadClock으로 바꾼다.
let now = () => (globalThis.performance?.now?.() ?? Date.now());
export function setUploadClock(fn) { now = fn; }
export const checkSlow = () => tick();

function tick() {
  let moved = false;
  for (const job of jobs.values()) {
    const slow = job.phase === 'sending' ? now() - job.lastMove > job.waitSending : job.phase === 'finishing' ? now() - job.finishAt > job.waitFinish : false;
    if (slow !== job.slow) { job.slow = slow; moved = true; }
  }
  if (moved) changed(); else paintDock();
}

// 올리기 하나를 목록에 올린다. file: 화면이 들고 있는 원래 파일(같은 파일을 찾는 열쇠). back(): [보기]가 돌아갈 곳(없으면 시작한 화면).
// waiting: 뒤 줄에서 차례를 기다리는 파일('대기' — start()나 첫 progress()에서 보내는 중이 된다). group: 한 묶음이 함께 쓰는 물건({sent} — 다 올린 양).
export function trackUpload({file = null, name = '', size = 0, back = null, waiting = false, group = null} = {}) {
  const router = globalThis.window?.KPTURouter;
  const from = router?.current ? {view: router.current, sub: router.sub || null} : null;
  const controller = new AbortController();
  const job = {
    id: 'up' + (++seq), file, name: String(name || file?.name || '파일'), size: Number(size || file?.size) || 0,
    loaded: 0, total: Number(size || file?.size) || 0, phase: waiting ? 'waiting' : 'sending', group, message: '', retry: null, slow: false,
    startAt: now(), lastMove: now(), finishAt: 0, waitSending: SLOW_SENDING_MS, waitFinish: SLOW_FINISH_MS,
    signal: controller.signal,
    back: back || (from ? () => router.go(from.view, {sub: from.sub, source: 'upload'}) : null),
    start() {
      if (!jobs.has(job.id) || job.phase !== 'waiting') return;
      job.phase = 'sending'; job.startAt = job.lastMove = now(); changed();
    },
    progress({loaded = 0, total = 0, phase = 'sending'} = {}) {
      if (jobs.has(job.id) && job.phase === 'waiting') { job.phase = 'sending'; job.startAt = job.lastMove = now(); }
      if (!jobs.has(job.id) || (job.phase !== 'sending' && job.phase !== 'finishing')) return;
      if (total > 0) job.total = total;
      if (loaded > job.loaded) { job.loaded = loaded; job.lastMove = now(); }
      if (phase === 'finishing' && job.phase !== 'finishing') { job.phase = 'finishing'; job.finishAt = now(); job.slow = false; }
      changed();
    },
    done() {
      if (!jobs.has(job.id)) return;
      job.phase = 'done'; job.loaded = job.total; job.slow = false; dock.done++; if (job.group) job.group.sent = (job.group.sent || 0) + (job.total || 0); changed();
      setTimeout(() => { if (jobs.get(job.id) === job && job.phase === 'done') { jobs.delete(job.id); changed(); } }, DONE_SHOW_MS)?.unref?.();
    },
    fail(message = '') {
      if (!jobs.has(job.id) || job.phase === 'done') return;
      job.phase = 'failed'; job.slow = false; job.message = String(message || ''); dock.failed++; changed();
    },
    // ✕: 다 보내기 전만(upload-send.mjs가 끊음). 목록에서는 바로 빠진다. 차례를 기다리던 파일은 보내지 않는다.
    cancel() {
      if (job.phase === 'sending' || job.phase === 'waiting') { controller.abort(); jobs.delete(job.id); changed(); }
      else if (job.phase === 'failed' || job.phase === 'handed') { jobs.delete(job.id); changed(); }
    },
    // 폰 앱에 넘김: 이 화면은 보내지 않는다(앱이 뒤에서 올림). stopped = 앱이 멈춰 있음(앱을 열면 잇는다). 끝은 done()·fail()로 온다.
    hand({stopped = false} = {}) {
      if (!jobs.has(job.id) || job.phase === 'done' || job.phase === 'failed') return;
      job.phase = 'handed'; job.stopped = !!stopped; job.slow = false; job.loaded = 0; changed();
    },
    keepWaiting() {
      if (job.phase === 'sending') job.waitSending = now() - job.lastMove + SLOW_SENDING_MS * 2;
      if (job.phase === 'finishing') job.waitFinish = now() - job.finishAt + SLOW_FINISH_MS * 2;
      job.slow = false; changed();
    },
    cancelled: () => controller.signal.aborted,
  };
  // 새 묶음(올리는 것이 하나도 없을 때 시작)은 끝난 수를 새로 센다.
  if (!dock.shown && ![...jobs.values()].some(live)) { dock.done = 0; dock.failed = 0; }
  jobs.set(job.id, job);
  changed();
  return job;
}

// [다시]: 실패한 그 파일을 화면이 다시 올리는 길(나중에 붙인 것이 이긴다). 결과를 알 수 없는 실패(저장됐을 수 있음)에는 붙이지 않는다.
export function setUploadRetry(file, run) {
  const job = [...jobs.values()].reverse().find(item => item.file === file && item.phase === 'failed');
  if (job) { job.retry = typeof run === 'function' ? run : null; changed(); }
  return !!job;
}
// 로그인이 바뀌면 목록을 비운다(다른 사람 화면에 남지 않게). 보내는 중인 것은 서버 답과 상관없이 표시만 지운다.
globalThis.window?.addEventListener?.('kptu:session-changed', event => {
  const next = event?.detail?.session?.user?.id || '';
  if (next && next === sessionOwner) return;
  sessionOwner = next; jobs.clear(); for (const note of [...dock.notes]) endNote(note, 'session'); resetDock(); changed();
});
let sessionOwner = globalThis.window?.KPTURuntime?.session?.read?.()?.user?.id || '';

// ── 그리기 ──
const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = text; return node; };
const textButton = (label, act, aria) => { const b = el('button', 'row-act', label); b.type = 'button'; b.dataset.upAct = act; if (aria) b.setAttribute('aria-label', aria); return b; };
function bar(job) {
  const line = el('span', 'up-bar');
  line.setAttribute('role', 'progressbar'); line.setAttribute('aria-label', `${job.name} 보낸 양`);
  line.setAttribute('aria-valuemin', '0'); line.setAttribute('aria-valuemax', '100');
  const fill = el('i'); line.append(fill);
  return line;
}
function paintBar(line, job) {
  const p = job.phase === 'done' || job.phase === 'finishing' ? 100 : percent(job.loaded, job.total);
  line.setAttribute('aria-valuenow', String(p));
  line.firstChild.style.width = p + '%';
  line.classList.toggle('is-finishing', job.phase === 'finishing');
}
const stateText = job => job.phase === 'done' ? '✓ 완료' : job.phase === 'failed' ? '실패' : job.phase === 'finishing' ? '마무리 중…' : job.phase === 'waiting' ? '대기'
  : job.phase === 'handed' ? (job.stopped ? '멈춤' : '앱이 올리는 중') : percent(job.loaded, job.total) + '%';

function rowNode(job, preview) {
  const row = el('div', 'up-row' + (preview ? ' up-tile' : ''));
  row.dataset.upJob = job.id;
  if (preview) {
    const img = el('img', 'up-tile-img'); img.alt = ''; img.src = preview; img.decoding = 'async';
    const over = el('span', 'up-tile-over'); over.append(bar(job), el('span', 'up-pc'));
    row.append(img, over);
  } else {
    const main = el('span', 'up-main'); main.append(el('span', 'up-name', job.name), bar(job));
    row.append(main, el('span', 'up-pc'));
  }
  row.append(el('span', 'up-acts'));
  return row;
}
function paintRow(row, job) {
  row.dataset.phase = job.phase;
  row.classList.toggle('is-slow', job.slow);
  paintBar(row.querySelector('.up-bar'), job);
  // 앱에 넘긴 줄은 보낸 양을 모른다: 막대를 그리지 않는다(가짜로 움직이는 값을 만들지 않음).
  row.querySelector('.up-bar').style.visibility = job.phase === 'handed' ? 'hidden' : '';
  const pc = row.querySelector('.up-pc');
  pc.textContent = row.classList.contains('up-tile') ? (job.phase === 'sending' ? `사진 올리는 중 ${stateText(job)}` : stateText(job)) : stateText(job);
  const acts = row.querySelector('.up-acts'), want = job.phase === 'sending' || job.phase === 'waiting' ? 'x' : job.phase === 'failed' ? 'f' + (job.retry ? 'r' : '') : '';
  if (acts.dataset.kind !== want + (job.slow ? 's' : '')) {
    acts.dataset.kind = want + (job.slow ? 's' : '');
    acts.replaceChildren();
    if (job.slow) {
      acts.append(el('span', 'up-slow', '느려요'), textButton('계속 기다리기', 'wait'));
      if (job.phase === 'sending') acts.append(textButton('취소', 'cancel', `${job.name} 올리기 취소`));
    } else if (job.phase === 'sending' || job.phase === 'waiting') {
      const x = el('button', 'icon-btn up-x', '✕'); x.type = 'button'; x.dataset.upAct = 'cancel'; x.setAttribute('aria-label', `${job.name} 올리기 취소`); acts.append(x);
    } else if (job.phase === 'failed') {
      if (job.retry) acts.append(textButton('다시', 'retry', `${job.name} 다시 올리기`));
      const x = el('button', 'icon-btn up-x', '✕'); x.type = 'button'; x.dataset.upAct = 'cancel'; x.setAttribute('aria-label', `${job.name} 실패 표시 닫기`); acts.append(x);
    }
  }
  row.title = job.phase === 'failed' && job.message ? job.message : '';
}
// 합계 줄: 보내는 중·마무리 중·차례를 기다리는 것만 센다(그 칸에 남은 것의 양 — 묶음 전체의 %는 하단 한 줄이 맡는다).
export function summaryText(list) {
  const open = list.filter(live);
  // 화면이 보내는 것이 없고 앱이 맡은 것만 남았으면 그 수를 알린다(멈춘 것이 있으면 멈춤).
  if (!open.length) { const app = list.filter(job => job.phase === 'handed'); return app.length ? `${app.some(job => job.stopped) ? '앱이 멈춤' : '앱이 뒤에서 올리는 중'} ${app.length}개` : ''; }
  const total = open.reduce((sum, job) => sum + (job.total || 0), 0), loaded = open.reduce((sum, job) => sum + (job.phase === 'finishing' ? job.total : job.loaded), 0);
  const all = open.every(job => job.phase === 'finishing');
  return `올리는 중 ${open.length}개 · ${amount(loaded)} / ${amount(total)} · ${all ? '마무리 중…' : percent(loaded, total) + '%'}`;
}

const hosts = new Set();
// ① 첨부 줄 칸. has(job): 이 칸이 보일 올리기. preview(job): 그림 주소(있으면 흐린 미리보기 칸). 돌려줌 {destroy()}.
// compact: 파일마다 막대는 화면의 미리보기 칸이 그리는 곳(일기 고른 사진, paintUploadOverlay) — 합계 줄은 하나여도 보이고,
// 줄은 버튼이 필요한 것(실패 [다시]·느려요)만.
export function mountUploadRows(host, {has = () => true, preview = null, summary = true, compact = false, failed = true} = {}) {
  if (typeof document === 'undefined' || typeof host?.setAttribute !== 'function') return {paint() {}, destroy() {}};
  host.classList.add('up-rows');
  host.setAttribute('aria-live', 'polite');
  const sum = el('div', 'up-sum'), list = el('div', 'up-list');
  host.replaceChildren(sum, list);
  const entry = {host, has};
  hosts.add(entry);
  function paint() {
    const all = uploadJobs().filter(job => { try { return has(job); } catch { return false; } });
    const mine = compact ? all.filter(job => (failed && job.phase === 'failed') || job.slow) : all;
    const text = summary && (compact ? all.length : all.length > 1) ? summaryText(all) : '';
    sum.textContent = text; sum.hidden = !text;
    const seen = new Set();
    for (const job of mine) {
      seen.add(job.id);
      let row = list.querySelector(`[data-up-job="${job.id}"]`);
      if (!row) { row = rowNode(job, preview?.(job) || null); list.append(row); }
      paintRow(row, job);
    }
    for (const row of [...list.children]) if (!seen.has(row.dataset.upJob)) row.remove();
    host.hidden = !mine.length && !text;
  }
  list.addEventListener('click', e => {
    const button = e.target.closest('[data-up-act]'); if (!button) return;
    const job = jobs.get(button.closest('[data-up-job]')?.dataset.upJob); if (!job) return;
    act(job, button.dataset.upAct);
  });
  const stop = watchUploads(paint);
  paint();
  return {paint, destroy() { stop(); hosts.delete(entry); host.replaceChildren(); host.hidden = true; }};
}
function act(job, what) {
  if (what === 'cancel') job.cancel();
  else if (what === 'wait') job.keepWaiting();
  else if (what === 'retry' && job.retry) { const run = job.retry; jobs.delete(job.id); changed(); void Promise.resolve().then(run).catch(() => {}); }
}

// ② 이미 있는 미리보기 칸 위 막대 + %(일기 고른 사진). 그 파일의 올리기가 없으면 겹친 것을 지운다.
export function paintUploadOverlay(tile, file) {
  const job = uploadJobs().find(item => item.file === file);
  let over = tile.querySelector(':scope > .up-tile-over');
  tile.classList.toggle('up-uploading', !!job && job.phase !== 'done');
  if (!job) { over?.remove(); return; }
  if (!over) {
    over = el('span', 'up-tile-over'); over.append(bar(job), el('span', 'up-pc'));
    const x = el('button', 'icon-btn up-x', '✕'); x.type = 'button'; x.setAttribute('aria-label', `${job.name} 올리기 취소`);
    x.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); uploadJobs().find(item => item.file === file)?.cancel(); });
    over.append(x); tile.append(over);
  }
  paintBar(over.querySelector('.up-bar'), job);
  over.querySelector('.up-pc').textContent = stateText(job);
  over.querySelector('.up-x').hidden = job.phase !== 'sending';
}

// ①' 화면이 이미 그린 파일 줄(첨부 고르기 줄) 안에 막대 + % + ✕. file이 없거나 그 파일이 보내는 중·마무리 중이 아니면 지운다.
export function paintUploadLine(row, file) {
  const job = file ? uploadJobs().find(item => item.file === file && (item.phase === 'sending' || item.phase === 'finishing')) : null;
  let line = row.querySelector(':scope > .up-inline');
  row.classList.toggle('up-uploading', !!job);
  if (!job) { line?.remove(); return; }
  if (!line) {
    line = el('span', 'up-inline'); line.append(bar(job), el('span', 'up-pc'));
    const x = el('button', 'icon-btn up-x', '✕'); x.type = 'button'; x.setAttribute('aria-label', `${job.name} 올리기 취소`);
    x.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); uploadJobs().find(item => item.file === file && item.phase === 'sending')?.cancel(); });
    line.append(x); row.append(line);
  }
  paintBar(line.querySelector('.up-bar'), job);
  line.querySelector('.up-pc').textContent = stateText(job);
  line.querySelector('.up-x').hidden = job.phase !== 'sending';
}

// ③ 하단바 위 한 줄.
const dock = {node: null, shown: false, done: 0, failed: 0, back: null, endTimer: null, notes: [], painted: null};
function resetDock() {
  dock.shown = false; dock.done = 0; dock.failed = 0; dock.back = null; clearTimeout(dock.endTimer); dock.endTimer = null; dock.painted = null;
  if (dock.node) { dock.node.hidden = true; dock.node.dataset.state = ''; }
}
const visible = node => !!node?.isConnected && node.getClientRects().length > 0 && !node.closest('[hidden],[inert]');
// 칸 자신은 올리기가 생긴 뒤에야 보이므로(위 paint) 칸이 든 자리(부모)가 보이는지로 판단한다.
// 뒤 줄 한 묶음(group)은 창이 닫힌 뒤에 올라가므로, 그 묶음의 올리는 줄이 지금 화면 안에 실제로 보일 때만 그 줄에 맡긴다
// (PC는 저장한 보고가 오른쪽 칸에 붙지만 사진·회의자료 칸은 화면 아래에 있어 안 보인다 — 그때는 이 한 줄이 진행을 알린다).
// 사진 칸·회의자료 칸처럼 줄이 두 곳으로 나뉘어도, 그 묶음의 줄이 한 곳이라도 화면에 보이면 묶음 전체를 그 줄에 맡긴다.
const inView = node => { const box = node.getBoundingClientRect(), tall = globalThis.window?.innerHeight || document.documentElement.clientHeight || 0; return box.height > 0 && box.bottom > 0 && box.top < tall; };
const shows = ({host, has}, job) => { try { return has(job) && host.isConnected && visible(host.parentElement); } catch { return false; } };
function covered(job) {
  if (![...hosts].some(entry => shows(entry, job))) return false;
  if (!job.group) return true;
  const peers = uploadJobs().filter(item => item.group === job.group);
  return [...hosts].some(entry => { try { return inView(entry.host) && peers.some(peer => shows(entry, peer)); } catch { return false; } });
}
function dockNode() {
  if (dock.node?.isConnected) return dock.node;
  const node = el('div', 'up-dock'); node.id = 'uploadDock'; node.hidden = true;
  node.setAttribute('role', 'status'); node.setAttribute('aria-live', 'polite');
  const head = el('div', 'up-dock-head'); head.append(el('span', 'up-dock-text'), el('span', 'up-dock-pc'));
  const line = el('span', 'up-bar'); line.append(el('i'));
  node.append(head, line);
  node.addEventListener('click', e => {
    const button = e.target.closest('[data-up-act]'); if (!button) return;
    const what = button.dataset.upAct, note = node.dataset.state === 'note' ? dock.painted : null;
    if (what === 'open') { const back = dock.back; resetDock(); try { back?.(); } catch { /* 돌아갈 화면이 없으면 그대로 */ } }
    else if (what === 'close') { if (note) endNote(note, 'closed'); else resetDock(); }
    else if (what === 'note-open' && note) { const back = note.back; endNote(note, 'open'); try { back?.(); } catch { /* 돌아갈 화면이 없으면 그대로 */ } }
    else if (what === 'note-act' && note) { const action = note.actions[Number(button.dataset.upNote)]; endNote(note, 'action'); void Promise.resolve().then(() => action?.run?.()).catch(() => {}); }
  });
  document.body.append(node);
  return (dock.node = node);
}
// 폰 홈·정리함·할 일의 아래 빠른 입력칸(하단 탭 바로 위에 붙은 칸)이 보이면 그 위로 올린다(입력칸을 가리지 않게).
function lift(node) {
  const quick = [...document.querySelectorAll('#appView .view-panel:not(.hidden) .home-quick[data-home-quick]')].find(box => getComputedStyle(box).position === 'fixed' && box.getClientRects().length);
  node.style.setProperty('--up-dock-lift', quick ? Math.ceil(quick.getBoundingClientRect().height) + 'px' : '0px');
}
// 묶음 끝 알림(BIZ-저장먼저닫기): 뒤 줄의 한 묶음이 끝났을 때 이 한 줄에 그 묶음의 말로 알린다 — '사진 7장·자료 1개 올렸어요', 못 올렸으면 [다시 올리기].
// 올리는 화면을 보고 있어도 뜬다(창은 이미 닫혔으므로 끝을 알 곳이 여기뿐). 다른 올리기가 아직 가는 중이면 그 진행 뒤에 보인다.
// text: 한 줄 · note: 작은 둘째 줄(까닭) · error · actions: [{label, aria, run}] · back(): [보기] · ms: 보이는 시간(0 = ✕나 단추를 누를 때까지) · onClose(why)
export function announceDock({text = '', note = '', error = false, actions = [], back = null, ms = DOCK_DONE_MS, onClose = null} = {}) {
  if (!text) return {close() {}};
  const mine = {text: String(text), note: String(note || ''), error: !!error, actions: (Array.isArray(actions) ? actions : []).filter(a => a?.label && typeof a.run === 'function'),
    back: typeof back === 'function' ? back : null, ms: Math.max(0, Number(ms) || 0), onClose, timer: null};
  dock.notes.push(mine);
  try { paintDock(); } catch { /* 한 줄이 올리기를 막지 않는다 */ }
  return {close() { endNote(mine, 'closed'); }};
}
function endNote(note, why) {
  const at = dock.notes.indexOf(note); if (at < 0) return;
  dock.notes.splice(at, 1); clearTimeout(note.timer); note.timer = null;
  if (dock.painted === note) resetDock();
  try { note.onClose?.(why); } catch { /* 알림 닫기가 다른 일을 막지 않는다 */ }
  try { paintDock(); } catch { /* 위와 같음 */ }
}
function paintNote(note) {
  const node = dockNode();
  clearTimeout(dock.endTimer); dock.endTimer = null; dock.done = 0; dock.failed = 0; dock.shown = true;
  if (dock.painted !== note || node.dataset.state !== 'note') {
    dock.painted = note; node.dataset.state = 'note';
    node.classList.toggle('is-error', note.error); node.setAttribute('role', note.error ? 'alert' : 'status');
    node.querySelector('.up-dock-text').textContent = note.text;
    node.querySelector('.up-dock-pc').textContent = '';
    node.querySelector('.up-bar').hidden = true;
    node.querySelector('.up-dock-acts')?.remove(); node.querySelector('.up-dock-note')?.remove();
    const acts = el('span', 'up-dock-acts');
    note.actions.forEach((action, index) => { const b = textButton(action.label, 'note-act', action.aria || ''); b.dataset.upNote = String(index); acts.append(b); });
    if (note.back) acts.append(textButton('보기', 'note-open', '올린 곳 보기'));
    const x = el('button', 'icon-btn up-x', '✕'); x.type = 'button'; x.dataset.upAct = 'close'; x.setAttribute('aria-label', '올리기 알림 닫기'); acts.append(x);
    node.querySelector('.up-dock-head').append(acts);
    if (note.note) node.append(el('div', 'up-dock-note', note.note));
  }
  lift(node); node.hidden = false;
  if (note.ms && !note.timer) { note.timer = setTimeout(() => endNote(note, 'timeout'), note.ms); note.timer?.unref?.(); }
}
function paintDock() {
  if (typeof document === 'undefined' || !document.body) return;
  const open = uploadJobs().filter(live);
  const away = open.filter(job => !covered(job));
  if (away.length) {
    clearTimeout(dock.endTimer); dock.endTimer = null;
    // 끝 알림이 떠 있었다면 진행 줄에 자리를 내주는 동안 보이는 시간을 세지 않는다(가려진 채 사라지지 않게 — 다시 보일 때 처음부터 센다).
    if (dock.painted) { clearTimeout(dock.painted.timer); dock.painted.timer = null; }
    const node = dockNode(); dock.shown = true; dock.painted = null; dock.back = away[0].back || dock.back;
    const {total, loaded} = sums(open);
    const finishing = open.every(job => job.phase === 'finishing'), slow = open.some(job => job.slow);
    node.dataset.state = 'live'; node.classList.remove('is-error'); node.setAttribute('role', 'status');
    node.querySelector('.up-dock-text').textContent = `${open.some(job => !/^image\//.test(job.file?.type || '')) ? '파일' : '사진'} ${open.length}개 올리는 중${slow ? ' · 느려요' : ''}`;
    node.querySelector('.up-dock-pc').textContent = finishing ? '마무리 중…' : percent(loaded, total) + '%';
    const line = node.querySelector('.up-bar'); line.hidden = false; line.firstChild.style.width = (finishing ? 100 : percent(loaded, total)) + '%';
    node.querySelector('.up-dock-acts')?.remove(); node.querySelector('.up-dock-note')?.remove();
    lift(node); node.hidden = false;
    return;
  }
  // 묶음 끝 알림이 기다리고 있으면 그것이 이 한 줄의 끝 글이다(아래 'n개 올림'을 대신한다).
  if (dock.notes.length) { paintNote(dock.notes[0]); return; }
  if (!dock.shown) return;
  if (open.length) { dock.node.hidden = true; dock.shown = false; dock.done = 0; dock.failed = 0; return; } // 올리는 화면으로 돌아옴: 그 화면이 보인다.
  if (dock.node.dataset.state === 'end') return;
  // 차례를 기다리던 파일을 모두 앱에 넘겼다(화면이 올린 것·못 올린 것이 없다): 끝 글 대신 접는다 — 부른 곳이 '앱이 뒤에서 올리는 중' 한 줄을 띄운다.
  if (!dock.done && !dock.failed && uploadJobs().some(job => job.phase === 'handed')) { resetDock(); return; }
  // 다른 화면에 있는 동안 끝남: 'n개 올림 · 보기'(실패가 있으면 'n개 못 올림').
  const node = dock.node; node.dataset.state = 'end'; node.classList.remove('is-error'); node.setAttribute('role', 'status');
  node.querySelector('.up-dock-text').textContent = dock.failed ? `${dock.failed}개 못 올림${dock.done ? ` · ${dock.done}개 올림` : ''}` : `${dock.done}개 올림`;
  node.querySelector('.up-dock-pc').textContent = '';
  node.querySelector('.up-bar').hidden = true;
  node.querySelector('.up-dock-acts')?.remove(); node.querySelector('.up-dock-note')?.remove();
  const acts = el('span', 'up-dock-acts');
  if (dock.back) acts.append(textButton('보기', 'open', '올린 화면 보기'));
  const x = el('button', 'icon-btn up-x', '✕'); x.type = 'button'; x.dataset.upAct = 'close'; x.setAttribute('aria-label', '올리기 알림 닫기'); acts.append(x);
  node.querySelector('.up-dock-head').append(acts);
  lift(node); node.hidden = false;
  dock.endTimer = setTimeout(resetDock, dock.failed ? DOCK_DONE_MS * 3 : DOCK_DONE_MS);
}
globalThis.window?.addEventListener?.('kptu:view-changed', () => setTimeout(paintDock, 0));
