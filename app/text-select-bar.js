import {copyText} from './copy-text.js';
import {notify} from './small-notice.js';
import {copyOf, draftOf, cleanQuote, tooLong, MARK_COLORS, MARK_COLOR_NAMES, markColor} from './text-highlights-model.mjs';
import {clearAnchored, followAnchor, bottomInset, isWide, keepInside, dragByTitle} from './anchored-popup.js';
import {pickBarSpot} from './select-bar-place-model.mjs';
import {swatchHtml, setSwatchOn} from './color-swatch.mjs';
// S53-5 NEWS-밑줄모으기 ①(시안 docs/design/mockups/news-highlights.html ①): 원문에서 글을 고르면(손가락으로 끌기·[모두 선택] 모두)
// 뜨는 Web2 줄 [형광펜 ●●●●●][밑줄 저장][메모][노트로][복사][공유] ✕. 폰 자체 선택 메뉴는 그대로 두고 덧붙인다.
// - [모두 선택](프로그램이 고른 글)에는 폰 메뉴가 뜨지 않아 복사·공유를 못 하던 문제(11/08 09:56)를 이 줄이 메운다.
// - 글 칸(zone)은 화면 주인이 bindSelectZone(container, {zone, source, onSave, onNote, marks})로 알린다. 고른 글의 처음과 끝이 같은 글 칸 안일 때만 뜬다.
// - 줄 버튼을 누르는 사이 폰이 고른 글을 풀어도, 줄이 뜰 때 받아 둔 글자·자리로 실행한다(이 탭 메모리만, 서버 저장은 onSave·marks가 맡는다).
// - 모양은 공용 고르기 줄(base-ui.css .kptu-actbar-text · .kptu-act, app/action-bar.mjs). 줄은 하나(문서에 한 번만 만든다).
// S70-16 UI-고른글메뉴·형광펜(명진 2026-11-25 09:51·09:54, 시안 docs/design/mockups/highlight-underline-options.html):
// - 자리: 고른 글과 앞뒤 줄을 가리지 않는 곳. PC(넓은 화면)는 글 칸 옆 여백 → 고른 글 위(한 줄 띄움) → 아래(한 줄 띄움), 순수 계산은 select-bar-place-model.mjs.
//   폰은 하단바 바로 위 고정 줄(base-ui.css .hl-bar 기본 자리). 마우스로 끌어 고르는 동안(누른 채)에는 뜨지 않고 뗀 뒤 뜬다.
// - 끌어 옮기기(PC 마우스 왼쪽): 줄의 빈 곳·'선택한 글' 글자를 잡고 끌면 따라 움직인다(공용 dragByTitle — 단추 위에서는 끌기 아님, 화면 밖으로 안 나감).
//   옮긴 자리는 같은 글 칸을 읽는 동안만 쓴다(다른 글·다른 화면이면 잊음, 어디에도 저장하지 않음).
// - 형광펜: marks(text-highlights.js markActions)를 준 글 칸에서만 [형광펜]과 색 점 다섯이 보인다. [형광펜] = 마지막 색, 점 = 그 색으로 칠함.
//   이미 칠한 곳을 고르면 점은 '색 바꾸기', [삭제]가 보인다.

const zones = []; // {container, zone, source, onSave, onNote, onReply, marks}
let bar = null, picked = null, hideTimer = 0, pressAt = 0, stopFollow = null, mouseHeld = false, movedSpot = null;
const canShare = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function';

function host() { return document.getElementById('appView') || document.body; }
// 색 점은 공용 색 칸(color-swatch.mjs) — 칸 색은 형광 칠과 같은 토큰(base-ui.css --kptu-hl-mark-*).
const dotsHtml = () => MARK_COLORS.map(c => swatchHtml({color: `var(--kptu-hl-mark-${c})`, label: `형광펜 ${MARK_COLOR_NAMES[c]}`, attrs: {'data-hl-bar': 'color', 'data-hl-color': c}})).join('');
function ensureBar() {
  if (bar?.isConnected) return bar;
  bar = document.createElement('div');
  bar.className = 'hl-bar';
  bar.dataset.hlBar = '';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', '선택한 글');
  bar.hidden = true;
  bar.innerHTML = `<span class="hl-bar-label"><span class="hl-bar-grip" aria-hidden="true">⋮⋮</span>선택한 글</span><span class="hl-bar-marks"><button type="button" class="ghost kptu-act hl-bar-pen" data-hl-bar="mark">형광펜</button><span class="hl-dots ui-swatches" role="group" aria-label="형광펜 색">${dotsHtml()}</span><button type="button" class="ghost kptu-act" data-hl-bar="erase">삭제</button></span><span class="kptu-actbar kptu-actbar-text hl-bar-acts"><button type="button" class="ghost kptu-act" data-hl-bar="save">밑줄 저장</button><button type="button" class="ghost kptu-act" data-hl-bar="reply">메모</button><button type="button" class="ghost kptu-act" data-hl-bar="note">노트로</button><button type="button" class="ghost kptu-act" data-hl-bar="copy">복사</button><button type="button" class="ghost kptu-act" data-hl-bar="share">공유</button></span><button type="button" class="icon-btn hl-bar-close" data-hl-bar="close" aria-label="선택 끝내기">✕</button>`;
  // 줄을 누를 때 PC는 고른 글이 풀리지 않게(폰은 풀려도 받아 둔 글로 실행). 빈 곳을 잡고 끌 때도 고른 글이 풀리지 않게 mousedown은 늘 막는다.
  bar.addEventListener('pointerdown', e => { pressAt = Date.now(); if (e.target.closest('button')) e.preventDefault(); });
  bar.addEventListener('mousedown', e => { pressAt = Date.now(); e.preventDefault(); });
  bar.addEventListener('click', e => { const b = e.target.closest('[data-hl-bar]'); if (b && b !== bar) void act(b.dataset.hlBar, b); });
  dragByTitle(bar, '.hl-bar');
  // 끈 자리 기억(같은 글 칸을 읽는 동안만).
  const rememberMove = () => { if (bar.dataset.anchorMoved && picked) { const r = bar.getBoundingClientRect(); movedSpot = {zoneEl: picked.zoneEl, left: r.left, top: r.top}; } };
  bar.addEventListener('pointerup', rememberMove);
  bar.addEventListener('pointercancel', rememberMove);
  host().append(bar);
  return bar;
}
function paint() {
  const b = ensureBar(), z = picked?.z;
  b.querySelector('[data-hl-bar="save"]').hidden = !z?.onSave;
  b.querySelector('[data-hl-bar="note"]').hidden = !z?.onNote;
  b.querySelector('[data-hl-bar="reply"]').hidden = !z?.onReply;
  b.querySelector('[data-hl-bar="share"]').hidden = !canShare();
  const marks = z?.marks || null, on = picked?.mark || null;
  b.querySelector('.hl-bar-marks').hidden = !marks;
  b.querySelector('[data-hl-bar="mark"]').hidden = !!on;
  b.querySelector('[data-hl-bar="erase"]').hidden = !on;
  const now = on ? markColor(on.mark_color) : marks?.lastColor?.();
  for (const d of b.querySelectorAll('[data-hl-color]')) setSwatchOn(d, d.dataset.hlColor === now);
  b.dataset.hlOn = on ? '1' : '';
  b.hidden = !picked;
  if (picked) place(); else unfollow();
}
// 고른 글의 줄 상자들(빈 상자 뺌). 폰이 고른 글을 풀어도 받아 둔 range로 잰다.
function lineRects() {
  const r = picked?.range;
  if (!r || !r.startContainer?.isConnected) return [];
  return [...r.getClientRects()].filter(x => x.width > 0 && x.height > 0);
}
function selBox() {
  const rs = lineRects();
  if (!rs.length) return null;
  const top = Math.min(...rs.map(x => x.top)), bottom = Math.max(...rs.map(x => x.bottom));
  const left = Math.min(...rs.map(x => x.left)), right = Math.max(...rs.map(x => x.right));
  return {top, bottom, left, right, width: right - left, height: bottom - top};
}
function lineHeight(el) {
  const cs = el ? getComputedStyle(el) : null, lh = parseFloat(cs?.lineHeight);
  return Number.isFinite(lh) ? lh : (parseFloat(cs?.fontSize) || 14) * 1.5;
}
function fallback(b) { clearAnchored(b); }
// 줄 폭 = 글자 + 보이는 버튼 수 × 버튼 칸(공용 고르기 줄 칸 64px) + 색 점 + ✕ + 안쪽 여백. 버튼 칸은 grid auto-fit이라 max-content로 재면 접히므로 센다.
function barWidth(b) {
  const vw = document.documentElement.clientWidth;
  const acts = [...b.querySelectorAll('.kptu-act')].filter(x => !x.hidden && !x.closest('[hidden]')).length;
  const dots = b.querySelector('.hl-bar-marks')?.hidden ? 0 : (b.querySelector('.hl-dots')?.offsetWidth || MARK_COLORS.length * 32);
  const label = b.querySelector('.hl-bar-label')?.offsetWidth || 0, close = b.querySelector('.hl-bar-close')?.offsetWidth || 0;
  return Math.min(Math.ceil(label + close + acts * 64 + dots + 28), 640, vw - 16);
}
function place() {
  const b = bar;
  if (!b || b.hidden || !picked) return;
  // 사람이 끌어 옮긴 줄은 그 자리 그대로(창 크기가 바뀌면 화면 안으로만).
  if (b.dataset.anchorMoved) { keepInside(b, 8, bottomInset()); return; }
  clearAnchored(b);
  if (!isWide()) { phoneSpot(b); return; } // 폰: 하단바 바로 위 고정 줄(CSS 기본 자리) — 고른 글·다음 줄을 가리지 않는다
  const w = barWidth(b);
  b.style.width = w + 'px';
  const h = Math.ceil(b.offsetHeight) || 36;
  if (movedSpot && movedSpot.zoneEl === picked.zoneEl && movedSpot.zoneEl.isConnected) {
    Object.assign(b.style, {left: movedSpot.left + 'px', top: movedSpot.top + 'px', bottom: 'auto'});
    b.dataset.anchorSide = 'moved'; b.dataset.anchorMoved = '1';
    keepInside(b, 8, bottomInset());
    follow();
    return;
  }
  const sel = selBox();
  const col = picked.zoneEl?.getBoundingClientRect?.() || null;
  const spot = pickBarSpot({sel, col, bar: {w, h}, view: {w: document.documentElement.clientWidth, h: window.innerHeight - bottomInset()}, line: lineHeight(picked.zoneEl)});
  if (!spot) { fallback(b); follow(); return; } // 고른 글이 화면을 거의 다 덮음·화면 밖 — 화면 아래 가운데
  Object.assign(b.style, {left: spot.left + 'px', top: spot.top + 'px', bottom: 'auto', width: w + 'px'});
  b.dataset.anchorSide = spot.side;
  delete b.dataset.scrollBelow;
  follow();
}
// 폰: 하단바 위 고정 줄이 고른 글(앞뒤 한 줄 포함)을 덮으면 고른 글 위(한 줄 띄움)로 올린다. 위에도 자리가 없으면 고정 줄 그대로.
function phoneSpot(b) {
  const sel = selBox();
  if (sel) {
    const line = lineHeight(picked.zoneEl), r = b.getBoundingClientRect();
    if (r.top < sel.bottom + line && sel.top - line < r.bottom) {
      const top = sel.top - line - r.height;
      if (top >= 8) { Object.assign(b.style, {left: '8px', top: top + 'px', bottom: 'auto', width: (document.documentElement.clientWidth - 16) + 'px'}); b.dataset.anchorSide = 'top'; }
    }
  }
  follow();
}
function follow() {
  if (stopFollow || !bar) return;
  stopFollow = followAnchor(bar, {getBoundingClientRect: () => selBox() || picked?.zoneEl?.getBoundingClientRect?.() || {top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0}}, {place, lost: () => { if (bar && !bar.dataset.anchorMoved) fallback(bar); }});
}
function unfollow() { stopFollow?.(); stopFollow = null; }
function hide() { clearTimeout(hideTimer); picked = null; unfollow(); if (bar) { bar.hidden = true; clearAnchored(bar); } }
function forgetMove() { movedSpot = null; hide(); }
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
  // 이미 칠한 형광 위를 골랐는가(색 바꾸기·삭제).
  const mark = a.z.marks?.find?.(a.zoneEl, start, end) || null;
  return {...a, text, start, end, range: range.cloneRange(), mark};
}
function onSelection() {
  // 마우스로 끌어 고르는 중(누른 채)에는 띄우지 않는다 — 뗀 뒤(pointerup) 다시 본다.
  if (mouseHeld) { if (bar && !bar.hidden) { bar.hidden = true; unfollow(); } return; }
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
  const m = p.z.marks;
  if (kind === 'erase' || (kind === 'color' && p.mark)) {
    if (!m || !p.mark) return;
    window.getSelection?.()?.removeAllRanges();
    hide();
    if (kind === 'erase') await m.erase(p.mark); else await m.recolor(p.mark, button.dataset.hlColor);
    return;
  }
  if (tooLong(p.text) && (kind === 'save' || kind === 'note' || kind === 'reply' || kind === 'mark' || kind === 'color')) { notify('선택한 글이 너무 길어요 · 4000자까지', {error: true, record: false}); return; }
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
    globalThis.window?.KPTUFeatureLock?.stepOut?.(); // S67-23: 공유 창 동안은 '자리 비움'이 아니다
    try { await navigator.share({title: draft.source_title || '선택한 글', text}); hide(); }
    catch (e) { if (e?.name !== 'AbortError') notify('공유 창을 열지 못했어요', {error: true, record: false}); }
    return;
  }
  if (kind === 'mark' || kind === 'color') {
    if (!m) return;
    window.getSelection?.()?.removeAllRanges();
    hide();
    await m.save({zoneEl: p.zoneEl, source: src, quote: draft.quote, start: p.start, end: p.end, anchor: button}, kind === 'color' ? button.dataset.hlColor : m.lastColor());
    return;
  }
  const run = kind === 'save' ? p.z.onSave : kind === 'reply' ? p.z.onReply : p.z.onNote;
  if (!run) return;
  window.getSelection?.()?.removeAllRanges();
  hide();
  await run({zoneEl: p.zoneEl, source: src, quote: draft.quote, start: p.start, end: p.end, anchor: button});
}

let bound = false;
// container: 글 칸이 들어 있는 화면 칸(상세 칸 등). zone: 글 칸 선택자. source(zoneEl) → {type, id, title, media, date, url}.
// onSave·onNote·onReply(info): 없으면 그 버튼을 감춘다. info = {zoneEl, source, quote, start, end, anchor}.
// onReply(S69-86 BRIEF-밑줄노트): [답글] — 고른 글에 메모를 달아 노트로(지금은 브리핑 룸만 켠다).
// marks(S70-16): 형광펜 — text-highlights.js markActions {save(info, color), recolor(h, color), erase(h), lastColor(), find(zoneEl, start, end)}. 없으면 형광펜 칸을 감춘다.
export function bindSelectZone(container, {zone, source, onSave = null, onNote = null, onReply = null, marks = null} = {}) {
  if (!container || !zone) return;
  zones.push({container, zone, source, onSave, onNote, onReply, marks});
  if (!bound) {
    bound = true;
    document.addEventListener('selectionchange', onSelection);
    window.addEventListener('kptu:view-changed', forgetMove);
    window.addEventListener('popstate', forgetMove);
    // 마우스 왼쪽을 누른 채 글을 고르는 동안은 줄을 띄우지 않는다(S70-16). 뗀 뒤 고른 글을 다시 본다. 줄 위 누름은 끌기·단추라 셈하지 않는다.
    document.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.button === 0 && !bar?.contains(e.target)) mouseHeld = true; }, true);
    const release = e => { if (!mouseHeld || e.pointerType !== 'mouse') return; mouseHeld = false; setTimeout(onSelection, 0); };
    document.addEventListener('pointerup', release, true);
    document.addEventListener('pointercancel', release, true);
    // 줄·고른 글 칸 밖을 누르면 거둔다(고른 글이 남아 있어도 — 다른 일을 시작한 것). 칸 안을 누르면 고르기를 이어 가는 중일 수 있어 둔다.
    document.addEventListener('pointerdown', e => { if (picked && !bar?.contains(e.target) && !picked.zoneEl.contains(e.target)) hide(); }, true);
  }
}
export const hideSelectBar = hide;

// S70-27 BRIEF-우클릭: 글 칸 위 오른쪽 클릭 메뉴(PC)가 막대와 같은 항목·같은 실행을 쓰게 한다(항목을 따로 적지 않는다).
// selectBarActs(zoneEl) = 그 글 칸에서 막대에 보일 항목 [{id, label}](✕ 빼고, 막대 단추 그대로 — 막대에 단추가 더해지면 메뉴에도 더해진다).
// runSelectBarAct(kind) = 지금 고른 글로 막대 단추를 누른 것과 같다(고른 글이 그 칸 안이 아니면 아무것도 하지 않음).
export function selectBarActs(zoneEl) {
  const z = zoneEl ? zoneOf(zoneEl)?.z : picked?.z;
  if (!z) return [];
  // [형광펜](S70-16)은 칠할 수 있는 글 칸에서만, 마지막에 쓴 색으로(색 고르기·삭제는 막대에서).
  const off = {save: !z.onSave, note: !z.onNote, reply: !z.onReply, share: !canShare(), mark: !z.marks};
  return [...ensureBar().querySelectorAll('.hl-bar-marks button[data-hl-bar="mark"], .hl-bar-acts button[data-hl-bar]')]
    .filter(b => b.dataset.hlBar !== 'close' && !off[b.dataset.hlBar])
    .map(b => ({id: b.dataset.hlBar, label: b.textContent.trim()}))
    .filter(a => a.label);
}
export async function runSelectBarAct(kind, anchor = null) {
  const now = readSelection();
  if (!now) return;
  picked = now;
  await act(kind, anchor);
}
