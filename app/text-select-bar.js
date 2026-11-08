import {copyText} from './copy-text.js';
import {notify} from './small-notice.js';
import {copyOf, draftOf, cleanQuote, tooLong} from './text-highlights-model.mjs';
// S53-5 NEWS-밑줄모으기 ①(시안 docs/design/mockups/news-highlights.html ①): 원문에서 글을 고르면(손가락으로 끌기·[모두 선택] 모두)
// 하단바 위에 뜨는 Web2 줄 [밑줄 저장][노트로][복사][공유] ✕. 폰 자체 선택 메뉴는 그대로 두고 덧붙인다.
// - [모두 선택](프로그램이 고른 글)에는 폰 메뉴가 뜨지 않아 복사·공유를 못 하던 문제(11/08 09:56)를 이 줄이 메운다.
// - 글 칸(zone)은 화면 주인이 bindSelectZone(container, {zone, source, onSave, onNote})로 알린다. 고른 글의 처음과 끝이 같은 글 칸 안일 때만 뜬다.
// - 줄 버튼을 누르는 사이 폰이 고른 글을 풀어도, 줄이 뜰 때 받아 둔 글자·자리로 실행한다(이 탭 메모리만, 서버 저장은 onSave가 맡는다).
// - 모양은 공용 고르기 줄(base-ui.css .kptu-actbar-text · .kptu-act, app/action-bar.mjs). 줄은 하나(문서에 한 번만 만든다).

const zones = []; // {container, zone, source, onSave, onNote}
let bar = null, picked = null, hideTimer = 0, pressAt = 0;
const canShare = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function';

function host() { return document.getElementById('appView') || document.body; }
function ensureBar() {
  if (bar?.isConnected) return bar;
  bar = document.createElement('div');
  bar.className = 'hl-bar';
  bar.dataset.hlBar = '';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', '고른 글');
  bar.hidden = true;
  bar.innerHTML = '<span class="hl-bar-label">고른 글</span><span class="kptu-actbar kptu-actbar-text hl-bar-acts"><button type="button" class="kptu-act" data-hl-bar="save">밑줄 저장</button><button type="button" class="kptu-act" data-hl-bar="note">노트로</button><button type="button" class="kptu-act" data-hl-bar="copy">복사</button><button type="button" class="kptu-act" data-hl-bar="share">공유</button></span><button type="button" class="hl-bar-close" data-hl-bar="close" aria-label="고르기 끝내기">✕</button>';
  // 줄을 누를 때 PC는 고른 글이 풀리지 않게(폰은 풀려도 받아 둔 글로 실행).
  const keep = e => { pressAt = Date.now(); if (e.target.closest('button')) e.preventDefault(); };
  bar.addEventListener('pointerdown', keep);
  bar.addEventListener('mousedown', keep);
  bar.addEventListener('click', e => { const b = e.target.closest('[data-hl-bar]'); if (b) void act(b.dataset.hlBar, b); });
  host().append(bar);
  return bar;
}
function paint() {
  const b = ensureBar(), z = picked?.z;
  b.querySelector('[data-hl-bar="save"]').hidden = !z?.onSave;
  b.querySelector('[data-hl-bar="note"]').hidden = !z?.onNote;
  b.querySelector('[data-hl-bar="share"]').hidden = !canShare();
  b.hidden = !picked;
}
function hide() { clearTimeout(hideTimer); picked = null; if (bar) bar.hidden = true; }
function zoneOf(node) {
  const el = node?.nodeType === 1 ? node : node?.parentElement;
  for (const z of zones) {
    if (!z.container?.isConnected) continue;
    const zoneEl = el?.closest?.(z.zone);
    if (zoneEl && z.container.contains(zoneEl)) return {z, zoneEl};
  }
  return null;
}
// 고른 글이 한 글 칸 안이면 {z, zoneEl, text, start, end}. 자리는 칸 글자(textContent) 기준.
function readSelection() {
  const sel = window.getSelection?.();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const a = zoneOf(sel.anchorNode), f = zoneOf(sel.focusNode);
  if (!a || !f || a.zoneEl !== f.zoneEl) return null;
  const range = sel.getRangeAt(0), text = sel.toString();
  if (!text.trim()) return null;
  const pre = document.createRange();
  pre.selectNodeContents(a.zoneEl);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length, end = start + range.toString().length;
  return {...a, text, start, end};
}
function onSelection() {
  const now = readSelection();
  if (now) { clearTimeout(hideTimer); picked = now; paint(); return; }
  if (!picked) return;
  // 줄을 막 누른 참이면(폰이 고른 글을 풀었음) 그대로 둔다. 아니면 잠깐 뒤 거둔다(다시 고르는 중일 수 있음).
  if (Date.now() - pressAt < 800) return;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { if (!readSelection() && Date.now() - pressAt >= 800) hide(); }, 300);
}
async function act(kind, button) {
  const p = picked;
  if (kind === 'close') { window.getSelection?.()?.removeAllRanges(); hide(); return; }
  if (!p) return;
  if (tooLong(p.text) && (kind === 'save' || kind === 'note')) { notify('고른 글이 너무 길어요 · 4000자까지', {error: true, record: false}); return; }
  const src = p.z.source?.(p.zoneEl) || null;
  const draft = draftOf(src, p.text);
  if (!draft.quote && kind !== 'copy' && kind !== 'share') return;
  if (kind === 'copy') {
    const ok = await copyText(copyOf({...draft, quote: cleanQuote(p.text) || p.text.trim()}));
    notify(ok ? '복사했어요' : '복사하지 못했어요. 다시 눌러 주세요.', {error: !ok, record: false});
    if (ok) { window.getSelection?.()?.removeAllRanges(); hide(); }
    return;
  }
  if (kind === 'share') {
    if (!canShare()) return;
    const text = copyOf({...draft, quote: cleanQuote(p.text) || p.text.trim()});
    try { await navigator.share({title: draft.source_title || '고른 글', text}); hide(); }
    catch (e) { if (e?.name !== 'AbortError') notify('공유 창을 열지 못했어요', {error: true, record: false}); }
    return;
  }
  const run = kind === 'save' ? p.z.onSave : p.z.onNote;
  if (!run) return;
  window.getSelection?.()?.removeAllRanges();
  hide();
  await run({zoneEl: p.zoneEl, source: src, quote: draft.quote, start: p.start, end: p.end, anchor: button});
}

let bound = false;
// container: 글 칸이 들어 있는 화면 칸(상세 칸 등). zone: 글 칸 선택자. source(zoneEl) → {type, id, title, media, date, url}.
// onSave·onNote(info): 없으면 그 버튼을 감춘다. info = {zoneEl, source, quote, start, end, anchor}.
export function bindSelectZone(container, {zone, source, onSave = null, onNote = null} = {}) {
  if (!container || !zone) return;
  zones.push({container, zone, source, onSave, onNote});
  if (!bound) {
    bound = true;
    document.addEventListener('selectionchange', onSelection);
    window.addEventListener('kptu:view-changed', hide);
  }
}
export const hideSelectBar = hide;
