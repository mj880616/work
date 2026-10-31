// OD-크게보기 공용 부품(PHOTO-사진메뉴 1차, 2026-10-28): 원드라이브 사진 크게 보기 하나. 일기(diary.js)와 사진 메뉴(photos.js)가 함께 쓴다.
// 일기에 있던 크게 보기를 그대로 옮겨 왔다(모양·손동작·버튼줄 같음). 상태(목록·별표·지우기)는 부르는 화면이 갖고, 여기는 그리기와 손동작만 한다.
// 위 줄 [✕] '6 / 256' … 찍은 날짜·시각, 아래 버튼줄 [☆ 별표] [⇪ 공유] [🗑 지우기] [ⓘ 정보](명진 결정 2026-10-28 07:45).
// 손동작: 좌우 넘기기 = 앞뒤 사진, 위로 밀기 = 별표 토글, 아래로 밀기 = 닫기(× 버튼·뒤로가기도 닫기, router layer). S 키 = 별표.
// PHOTO-스와이프안내(2026-10-30 명진 결정 "스와이프 모션 좋아"): 세로로 밀면 사진이 손가락을 따라 움직이고, 위로 정해진 거리(STAR_DIST)를 넘기면
// 가운데 별이 차오른다. 덜 밀고 놓으면 제자리(별표 안 됨). 별표 순간 큰 노란 별이 '톡' 커졌다가 아래 [별표] 버튼으로 들어가고(폰은 짧은 진동),
// 풀기는 빈 별이 흐려지며 사라진다. 아래로 밀어 닫기도 사진이 따라 내려가다 닫힌다. prefers-reduced-motion이면 움직임 없이 버튼 별만 바뀐다.
// 처음 HINT_TIMES번(기본 3번) 열 때 손가락 동그라미가 아래에서 위로 두 번 올라가는 시늉 + 사진 아래 작은 회색 한 줄. 본 횟수는 서버(view_prefs.photo_hint).
// PHOTO-전체화면확대(요청함 10/31): 두 손가락 벌리기·오므리기, 두 번 톡(다시 두 번 톡 = 원래 크기), PC는 휠·더블클릭으로 사진 안을 확대·축소한다.
// 확대 중에는 한 손가락(마우스 끌기)으로 사진 안을 움직이고 좌우 넘기기·세로 밀기는 쉰다. 다른 장으로 넘기면 원래 크기. 처음 확대할 때 부르는 화면이 준
// hires(item)로 원본 해상도를 받아 같은 칸 위에 겹쳐 띄운다(썸네일을 키우지 않음, 못 받으면 큰 그림 그대로). 배율은 메모리에만 둔다.
// [ⓘ 정보] 맨 아래 '불러오기 1.4초 (주소 0.5 · 사진 0.9)'(PHOTO-크게보기빨리): 그 칸이 메모리에 잰 시간(img-slot.js slotTiming), 기록·전송 없음.
// 🗑(원드라이브 사진만)은 묻지 않고 목록에서 바로 빼고 '휴지통으로 옮겼어요 · 되돌리기'를 몇 초 보여 준다. 그 시간이 지나거나 닫거나 화면을 떠나면
// 원드라이브 휴지통으로 보낸다(영구 삭제 아님). 되돌리기는 보내기 전이라 같은 자리로 그대로 돌아온다. 기기 저장 없음.
import {swipeKind, shareFileName, UNDO_MS, dragAxis, dragEnd, dragOffset, starFill, hintDue, hintNext, hintSeen, HINT_TEXT, loadTimeText,
  ZOOM_ONE, isZoomed, clampPan, zoomAt, pinchTo, panBy, zoomToggle, wheelScale, isTap, isDoubleTap, settleZoom, zoomTransform} from './photo-viewer-model.mjs';
import {slotTimingOf} from './img-slot.js';
import {viewPrefs} from './view-prefs.js';
import {preparePhotoBlob, sharePhotoElement, photoFilesFor, paintPhotoNote, PHOTO_WAIT} from './photo-share.js';
import {shareFrom} from './share-menu.js';

let viewer = null, pending = null;

// 기다리던 지우기를 지금 보낸다. 실패하면 부르는 쪽이 사진을 제자리로 되돌리고(restore) 알린다.
async function commitPending({keepalive = false} = {}) {
  const p = pending; if (!p) return;
  pending = null; clearTimeout(p.timer);
  if (viewer) viewer.undoShown(false);
  try { await p.commit(p.token, {keepalive}); }
  catch (error) {
    p.restore(p.token);
    viewer?.reload(p.id);
    const text = p.errorText(error);
    if (viewer) viewer.note(text); else p.onError?.(text);
  }
}
function undoPending() {
  const p = pending; if (!p) return;
  pending = null; clearTimeout(p.timer);
  p.restore(p.token);
  viewer?.reload(p.id);
  viewer?.undoShown(false); viewer?.note('되돌렸어요.');
}
if (typeof document !== 'undefined') {
  window.addEventListener('pagehide', () => { if (pending) commitPending({keepalive:true}); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && pending) commitPending({keepalive:true}); });
}

const zoomed = () => (globalThis.visualViewport?.scale || 1) > 1.05;
const still = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
const buzz = () => { try { globalThis.navigator?.vibrate?.(12); } catch { /* 진동 없는 기기 */ } };
export const photoStripOpen = () => !!viewer;
export const photoStripNote = text => viewer?.note(text);
export const photoStripRefresh = () => viewer?.refresh();
export const photoStripReload = id => viewer?.reload(id);
export const photoStripCommit = () => commitPending();

// opts:
//  host: 붙일 곳, list(): 지금 목록(부르는 화면의 배열), index, title(aria 이름), layerName: 라우터 겹 이름
//  element(item, size, {label, eager, prio}): 사진 칸, label(item, i): 그림 이름, when(item): 위 줄 찍은 때, caption(item): 사진 밑 한 줄
//  info(item): [[이름, 값]], original(item): {href} | {text}  — [ⓘ 정보] 판 맨 아래 '원본' 줄
//  isStarred(item), toggleStar(item): 별표(서버 저장은 부르는 쪽)
//  deletable(item) → {ok, title}, take(item) → token|null(목록에서 빼고 다시 그림), restore(token), commit(token, {keepalive}) → Promise,
//  errorText(error), onError(text): 닫힌 뒤 실패 알림, onClose({starChanged, restore})
//  (PHOTO-사진메뉴 2차, 선택) play(item) → Promise<주소>: item.video면 칸 위 ▶를 누를 때 받아 <video>로 재생(주소는 메모리에만, 닫으면 버림).
//  (PHOTO-전체화면확대, 선택) hires(item) → Promise<주소 | {url, revoke}>: 확대할 때 받을 원본 해상도 그림 주소. revoke:true면 다 쓰고 놓는다(blob:).
//   original(item)이 {download:true}를 돌려주면 [ⓘ] 판 맨 아래가 [⤓ 원본 받기] 단추가 되고 download(item)을 부른다. badge(item): 칸 위 작은 글('▶ 0:42').
// 크게 보기 받는 순서(작을수록 먼저): 보는 장 -2, 바로 앞뒤 -1, 두 장 건너 0. 격자 칸은 보이는 것 0·곧 보일 것 1(od-thumb-loader.js)이라 크게 보기가 앞선다.
export const stripPrio = d => (d === 0 ? -2 : Math.abs(d) === 1 ? -1 : 0);
export function openPhotoStrip(opts) {
  const {host, list, index, title, layerName = 'diary-photo', element, label, when, caption = () => '', info, original, isStarred, toggleStar,
    deletable, take, restore, commit, errorText = () => '지우지 못했어요.', onError, onClose, play = null, download = null, badge = () => '', hires = null} = opts;
  const first = list();
  if (!first[index] || viewer) return null;
  let items = first.slice(), at = index, noteTimer = null;
  const trigger = document.activeElement, box = document.createElement('div');
  box.className = 'diary-viewer'; box.dataset.diaryViewer = '';
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', title);
  box.innerHTML = `<div class="diary-viewer-bar"><button type="button" class="diary-viewer-close" data-diary-viewer-close aria-label="크게 보기 닫기">✕</button><span class="diary-viewer-count" data-diary-viewer-count aria-live="polite"></span><span class="diary-viewer-when" data-diary-viewer-when></span></div><div class="diary-viewer-stage"><div class="diary-viewer-strip" data-diary-viewer-strip tabindex="0"></div><span class="diary-viewer-starfx" data-strip-starfx aria-hidden="true">★</span><span class="diary-viewer-finger" data-strip-finger aria-hidden="true" hidden></span></div><p class="diary-viewer-hint" data-diary-viewer-hint hidden>${HINT_TEXT}</p><p class="diary-viewer-caption" data-diary-viewer-caption></p><dl class="diary-viewer-info" data-diary-viewer-info hidden></dl><p class="diary-viewer-note" data-diary-viewer-note role="status"><span data-diary-viewer-note-text></span><button type="button" class="diary-viewer-undo" data-diary-undo hidden>되돌리기</button></p><div class="diary-viewer-actions" role="group" aria-label="사진 동작"><button type="button" data-diary-star aria-pressed="false"><span aria-hidden="true">☆</span> 별표</button><button type="button" data-diary-share><span aria-hidden="true">⇪</span> 공유</button><button type="button" data-od-delete><span aria-hidden="true">🗑</span> 지우기</button><button type="button" data-diary-info aria-expanded="false"><span aria-hidden="true">ⓘ</span> 정보</button></div>`;
  const strip = box.querySelector('[data-diary-viewer-strip]'), count = box.querySelector('[data-diary-viewer-count]'), captionEl = box.querySelector('[data-diary-viewer-caption]');
  const whenEl = box.querySelector('[data-diary-viewer-when]'), infoEl = box.querySelector('[data-diary-viewer-info]'), infoBtn = box.querySelector('[data-diary-info]');
  const starBtn = box.querySelector('[data-diary-star]'), delBtn = box.querySelector('[data-od-delete]'), undoBtn = box.querySelector('[data-diary-undo]');
  const noteText = text => paintPhotoNote(box.querySelector('[data-diary-viewer-note-text]'), text);
  const fx = box.querySelector('[data-strip-starfx]'), finger = box.querySelector('[data-strip-finger]'), hintEl = box.querySelector('[data-diary-viewer-hint]');
  const fill = i => {
    const slide = strip.children[i];
    if (!slide || slide.dataset.filled) return;
    // 크게 보기는 화면 관찰 없이 바로 받는다: 보는 장이 먼저, 바로 앞뒤 장, 그다음 두 장 건너(stripPrio). 뒤에 가려진 격자 칸보다 먼저다.
    slide.dataset.filled = '1'; slide.append(element(items[i], 'large', {label:label(items[i], i), eager:true, prio:stripPrio(i - at)}));
    if (items[i].video && play) {
      const b = Object.assign(document.createElement('button'), {type:'button', className:'diary-viewer-play', textContent:`▶${badge(items[i]) ? ' ' + badge(items[i]) : ''}`});
      b.dataset.stripPlay = String(i); b.setAttribute('aria-label', '동영상 재생'); slide.append(b);
    }
  };
  // 동영상 재생: 그 장의 썸네일 자리에 기기 기본 재생 막대(소리 켠 채). 다른 장으로 넘기면 멈춘다.
  async function playAt(i) {
    const item = items[i], slide = strip.children[i];
    if (!item || !slide || slide.querySelector('video')) return;
    note(PHOTO_WAIT);
    let url;
    try { url = await play(item); } catch (error) { note(errorText(error).replace(/^지우지 못했어요/, '재생하지 못했어요'), 4000); return; }
    if (viewer?.box !== box || items[i] !== item) return;
    const v = document.createElement('video');
    v.className = 'diary-viewer-video'; v.controls = true; v.playsInline = true; v.preload = 'metadata'; v.src = url;
    v.addEventListener('error', () => note('이 기기에서 재생 못 해요. [ⓘ 정보]의 원본 받기로 받아 주세요.', 5000), {once:true});
    slide.querySelector('[data-strip-play]')?.remove();
    slide.append(v); note('');
    v.play?.()?.catch?.(() => {});
  }
  const buildSlides = () => {
    strip.replaceChildren(...items.map(() => Object.assign(document.createElement('figure'), {className:'diary-slide'})));
    items.forEach((item, i) => { if (item.kind === 'upload') fill(i); });
  };
  const refresh = () => {
    const item = items[at]; if (!item) return;
    const on = isStarred(item);
    starBtn.firstElementChild.textContent = on ? '★' : '☆'; starBtn.setAttribute('aria-pressed', String(on)); starBtn.setAttribute('aria-label', on ? '별표 풀기' : '별표');
  };
  const paintInfo = () => {
    const item = items[at]; if (!item || infoEl.hidden) return;
    infoEl.replaceChildren(...info(item).filter(([, v]) => v).flatMap(([k, v]) => [Object.assign(document.createElement('dt'), {textContent:k}), Object.assign(document.createElement('dd'), {textContent:v})]));
    const o = original(item) || {}, dd = document.createElement('dd');
    if (o.download && download) {
      const b = Object.assign(document.createElement('button'), {type:'button', className:'diary-viewer-original', textContent:'⤓ 원본 받기'});
      b.dataset.stripOriginal = ''; dd.append(b);
    } else if (o.href) {
      const a = Object.assign(document.createElement('a'), {href:o.href, target:'_blank', rel:'noopener noreferrer', className:'diary-viewer-original', textContent:'원본 내려받기'});
      a.dataset.diaryOriginal = ''; dd.append(a);
    } else dd.textContent = o.text || '';
    infoEl.append(Object.assign(document.createElement('dt'), {textContent:'원본'}), dd);
    const took = loadTimeText(slotTimingOf(slidePhoto(at)));
    if (took) { const t = Object.assign(document.createElement('dd'), {textContent:took}); t.dataset.stripLoadTime = ''; infoEl.append(Object.assign(document.createElement('dt'), {textContent:'불러오기'}), t); }
  };
  const slidePhoto = i => strip.children[i]?.querySelector('.diary-photo') || null;
  const prepareShown = () => { const el = slidePhoto(at); if (el) preparePhotoBlob(el); };
  const show = () => {
    const item = items[at];
    count.textContent = `${at + 1} / ${items.length}`;
    whenEl.textContent = when(item);
    captionEl.textContent = caption(item) || '';
    const d = deletable(item);
    delBtn.disabled = !d.ok; delBtn.title = d.title;
    for (const step of [0, 1, -1, 2, -2]) {
      // 이미 받기 시작한 장(앞서 앞뒤 장으로 미리 받던 것)은 지금 자리에 맞게 순서만 당긴다(PHOTO-속도). 그림 칸이 'photo-prio'를 듣는다.
      if (strip.children[at + step]?.dataset.filled) slidePhoto(at + step)?.dispatchEvent(new CustomEvent('photo-prio', {detail:stripPrio(step)}));
      fill(at + step);
    }
    strip.querySelectorAll('video').forEach(v => { if (v.parentElement !== strip.children[at]) v.pause?.(); });
    refresh(); paintInfo(); prepareShown();
  };
  const note = (text, ms = 0) => { clearTimeout(noteTimer); noteText(text); if (ms) noteTimer = setTimeout(() => { if (!pending) noteText(''); }, ms); };
  // 보는 장의 그림이 뜨면(load는 거품이 없어 잡기 단계로 듣는다) 그 그림의 바이트를 미리 준비해 [공유]를 바로 넘긴다.
  strip.addEventListener('load', event => { setTimeout(prepareShown, 0); if (event.target?.closest?.('.diary-slide') === strip.children[at]) paintInfo(); }, true);
  strip.addEventListener('scroll', () => { const next = Math.round(strip.scrollLeft / Math.max(1, strip.clientWidth)); if (next !== at && items[next]) { resetZoom(); at = next; show(); } }, {passive:true});
  const step = dir => { resetZoom(); stepTo(dir); };
  const stepTo = dir => strip.scrollTo({left:Math.max(0, Math.min(items.length - 1, at + dir)) * strip.clientWidth, behavior:'smooth'});
  // 목록이 바뀐 뒤(지우기·되돌리기) 다시 짠다. id가 주어지면 그 사진으로 간다.
  const reload = id => {
    if (viewer?.box !== box) return;
    items = list().slice();
    if (!items.length) { closePhotoStrip(); return; }
    const found = id ? items.findIndex(x => x.kind === 'od' && x.id === id) : -1;
    at = found >= 0 ? found : Math.min(at, items.length - 1);
    resetZoom(); dropHires(); buildSlides(); strip.scrollLeft = at * strip.clientWidth; show();
  };
  function deleteCurrent() {
    const item = items[at];
    const d = item ? deletable(item) : {ok:false, title:''};
    if (!d.ok) { note(d.title, 3000); return; }
    if (pending) commitPending(); // 앞서 지운 사진은 지금 보낸다(되돌리기는 마지막 한 장만)
    const token = take(item);
    if (!token) return;
    pending = {token, id:item.id, commit, restore, errorText, onError, timer:setTimeout(() => commitPending(), UNDO_MS)};
    reload(null);
    if (viewer) { clearTimeout(noteTimer); noteText('휴지통으로 옮겼어요'); viewer.undoShown(true); }
  }
  // OD-공유고침: [공유]는 화면에 이미 뜬 그림의 바이트를 바로 넘긴다(photo-share.js). 아직 안 떴을 때만 '사진 받는 중…'을 띄우고 뜨면 넘긴다.
  // 원드라이브 그림 주소는 로그인 없이 열리는 임시 주소라 링크로 넘기지 않는다.
  // PC공유메뉴: 넓은 화면은 누른 자리 작은 메뉴(share-menu.js), 좁은 화면은 지금처럼 바로 기기 공유 창.
  function shareCurrent(trigger) {
    const item = items[at], el = slidePhoto(at); if (!item || !el) return;
    const nameOf = blob => shareFileName(item, blob.type), alive = () => viewer?.box === box && items[at] === item;
    shareFrom(trigger, {video:!!item.video, count:1, note,
      getFiles:() => photoFilesFor(el, nameOf, {alive, note}),
      native:() => sharePhotoElement(el, nameOf, {alive, note}),
      download:item.video && download ? () => download(item) : null});
  }
  const star = item => { if (!item) return; if (viewer) viewer.starChanged = true; return toggleStar(item); };
  // 별 움직임: on = 지금 별표됨. 큰 별이 '톡' 커졌다가 [별표] 버튼 자리로 날아가 작아지며 사라진다 / 풀면 빈 별이 흐려진다.
  let fxTimer = null;
  function starMotion(on) {
    buzz();
    clearTimeout(fxTimer); fx.style.removeProperty('--fill');
    if (still()) { delete fx.dataset.anim; return; }
    fx.textContent = on ? '★' : '☆';
    const b = starBtn.getBoundingClientRect(), f = fx.getBoundingClientRect();
    fx.style.setProperty('--fly-x', `${Math.round(b.left + b.width / 2 - (f.left + f.width / 2))}px`);
    fx.style.setProperty('--fly-y', `${Math.round(b.top + b.height / 2 - (f.top + f.height / 2))}px`);
    fx.dataset.anim = on ? 'pop' : 'fade';
    if (on) fxTimer = setTimeout(() => { fx.dataset.anim = 'fly'; fxTimer = setTimeout(() => { delete fx.dataset.anim; starBtn.dataset.stripPopped = ''; setTimeout(() => delete starBtn.dataset.stripPopped, 260); }, 280); }, 220);
    else fxTimer = setTimeout(() => { delete fx.dataset.anim; }, 320);
  }
  // swipe: 위로 밀기일 때만 '별표했어요' 한 줄(버튼·S 키는 버튼 별이 바뀌는 것으로 충분, 예전 그대로).
  const toggleHere = ({swipe = false} = {}) => {
    const item = items[at]; if (!item) return;
    const was = isStarred(item); star(item);
    const on = isStarred(item);
    if (on !== was) { starMotion(on); if (swipe) note(was ? '별표를 풀었어요' : '별표했어요', 1500); }
  };
  // 한 손가락 세로 밀기(사진 위): 사진이 손가락을 따라 움직인다. 위 = 별표, 아래 = 닫기. 가로 넘기기·확대(두 손가락)는 브라우저가 맡는다.
  let touch = null;
  const slideNow = () => strip.children[at] || null;
  const follow = dy => {
    const s = slideNow();
    if (!still() && s) { s.style.transition = 'none'; s.style.transform = dy ? `translateY(${Math.round(dragOffset(dy))}px)` : ''; }
    const fill = dy < 0 ? starFill(dy) : 0;
    if (!still() && fill > 0) { fx.textContent = isStarred(items[at]) ? '☆' : '★'; fx.dataset.anim = 'drag'; fx.style.setProperty('--fill', fill.toFixed(3)); }
    else if (fx.dataset.anim === 'drag') { delete fx.dataset.anim; fx.style.removeProperty('--fill'); }
    box.dataset.stripDrag = dy < 0 ? (fill >= 1 ? 'star-ready' : 'up') : dy > 0 ? 'down' : '';
  };
  const settle = () => {
    const s = slideNow(); delete box.dataset.stripDrag;
    if (fx.dataset.anim === 'drag') { delete fx.dataset.anim; fx.style.removeProperty('--fill'); }
    if (!s || !s.style.transform) return;
    s.style.transition = 'transform .18s ease-out'; s.style.transform = '';
    setTimeout(() => { s.style.transition = ''; }, 200);
  };
  const closeDown = () => {
    const s = slideNow(); delete box.dataset.stripDrag;
    if (still() || !s) { closePhotoStrip(); return; }
    s.style.transition = 'transform .16s ease-in, opacity .16s ease-in'; s.style.transform = `translateY(${Math.round(strip.clientHeight || 400)}px)`; s.style.opacity = '0';
    setTimeout(() => { if (viewer?.box === box) closePhotoStrip(); }, 160);
  };
  const finish = kind => {
    if (kind === 'close') { closeDown(); return; }
    settle();
    if (kind === 'star') toggleHere({swipe:true});
  };
  strip.addEventListener('touchstart', event => {
    touch = event.touches.length === 1 ? {x:event.touches[0].clientX, y:event.touches[0].clientY, t:Date.now(), fingers:1, axis:null} : null;
    if (!touch) settle();
  }, {passive:true});
  strip.addEventListener('touchmove', event => {
    if (!touch) return;
    if (event.touches.length > 1) { touch.fingers = event.touches.length; touch.axis = 'none'; settle(); return; }
    const p = event.touches[0], dx = p.clientX - touch.x, dy = p.clientY - touch.y;
    if (touch.axis === null) touch.axis = dragAxis({dx, dy, fingers:touch.fingers, zoomed:zoomedNow()});
    if (touch.axis === 'y') follow(dy);
  }, {passive:true});
  strip.addEventListener('touchend', event => {
    const start = touch; touch = null;
    const end = event.changedTouches[0];
    if (!start || !end) { settle(); return; }
    const dx = end.clientX - start.x, dy = end.clientY - start.y;
    if (start.axis === 'y') { finish(dragEnd(dy)); return; }
    // 움직임이 잡히기 전에 끝난 빠른 손짓은 예전 판정(swipeKind)으로 본다.
    if (start.axis === null) {
      const kind = swipeKind({dx, dy, dt:Date.now() - start.t, fingers:start.fingers, zoomed:zoomedNow()});
      if (kind) finish(kind === 'up' ? 'star' : 'close');
    }
  }, {passive:true});
  strip.addEventListener('touchcancel', () => { touch = null; settle(); }, {passive:true});
  // ---- PHOTO-전체화면확대: 사진 안 확대·축소 ----
  // zoom = 보는 장의 배율·옮긴 거리(메모리만). 변형은 그 장의 .diary-photo(그림 칸)에 건다(세로 밀기는 바깥 .diary-slide라 서로 겹치지 않음).
  let zoom = {...ZOOM_ONE}, zoomEl = null, pinch = null, pan = null, tapStart = null, lastTap = null, lastTouchAt = -Infinity, mouse = null;
  const zoomedNow = () => zoomed() || isZoomed(zoom) || !!pinch;
  const zoomable = () => !!items[at] && !items[at].video && !!slidePhoto(at);
  const centerOf = () => { const r = strip.getBoundingClientRect(); return {cx:r.left + r.width / 2, cy:r.top + r.height / 2}; };
  const focal = (x, y) => { const {cx, cy} = centerOf(); return {x:x - cx, y:y - cy}; };
  const zoomBox = () => {
    const el = slidePhoto(at), pic = el?.querySelector('img.diary-viewer-hires') || el?.querySelector('img:not(.img-slot-preview):not(.diary-viewer-hires)');
    return {W:strip.clientWidth, H:strip.clientHeight, nw:pic?.naturalWidth || 0, nh:pic?.naturalHeight || 0};
  };
  function applyZoom(z, animate = false) {
    const el = slidePhoto(at);
    if (zoomEl && zoomEl !== el) { zoomEl.style.transform = ''; zoomEl.style.transition = ''; }
    zoom = z; zoomEl = el;
    if (el) { el.style.transition = animate && !still() ? 'transform .2s ease-out' : 'none'; el.style.transform = zoomTransform(z); }
    if (isZoomed(z)) { box.dataset.stripZoom = ''; loadHires(); } else delete box.dataset.stripZoom;
  }
  function resetZoom() {
    pinch = pan = mouse = tapStart = lastTap = null;
    if (zoomEl) { zoomEl.style.transform = ''; zoomEl.style.transition = ''; }
    zoom = {...ZOOM_ONE}; zoomEl = null; delete box.dataset.stripZoom;
  }
  // 원본 해상도: 확대한 장마다 한 번 받아 칸 위에 겹친다. 메모리를 아끼려고 최근 HIRES_KEEP장만 둔다.
  const HIRES_KEEP = 2, held = [];
  const forget = h => { h.img.remove(); if (h.revoke) URL.revokeObjectURL(h.url); };
  function dropHires() { while (held.length) forget(held.shift()); }
  function loadHires() {
    const i = at, item = items[i], slide = strip.children[i];
    if (typeof hires !== 'function' || !item || item.video || !slide || slide.dataset.stripHires) return;
    slide.dataset.stripHires = 'loading';
    Promise.resolve().then(() => hires(item)).then(r => {
      const url = typeof r === 'string' ? r : r?.url, revoke = !!r?.revoke;
      if (!url) throw new Error('hires');
      const img = new Image();
      img.className = 'diary-viewer-hires'; img.alt = ''; img.setAttribute('aria-hidden', 'true'); img.decoding = 'async'; img.referrerPolicy = 'no-referrer'; img.draggable = false;
      const done = ok => {
        img.onload = img.onerror = null;
        const el = slide.querySelector('.diary-photo');
        if (!ok || viewer?.box !== box || !slide.isConnected || !el) { if (revoke) URL.revokeObjectURL(url); if (slide.isConnected) slide.dataset.stripHires = 'failed'; return; }
        el.append(img); slide.dataset.stripHires = 'shown';
        held.push({img, url, revoke});
        while (held.length > HIRES_KEEP) forget(held.shift());
        if (i === at) applyZoom(clampPan(zoom, zoomBox()));
      };
      img.onload = () => done(true); img.onerror = () => done(false);
      img.src = url;
    }).catch(() => { if (slide.isConnected) slide.dataset.stripHires = 'failed'; });
  }
  const onControl = target => !!target?.closest?.('button,a,video,[data-img-retry]');
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const mid = t => focal((t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2);
  strip.addEventListener('touchstart', event => {
    lastTouchAt = Date.now();
    const t = event.touches;
    if (t.length === 2 && zoomable() && !onControl(event.target)) { pinch = {z0:{...zoom}, d0:dist(t), m0:mid(t)}; pan = tapStart = null; }
    else if (t.length === 1 && zoomable() && !onControl(event.target)) {
      tapStart = {x:t[0].clientX, y:t[0].clientY, t:Date.now()};
      pan = isZoomed(zoom) ? {z0:{...zoom}, x:t[0].clientX, y:t[0].clientY} : null;
    } else { pinch = pan = tapStart = null; }
  }, {passive:true});
  strip.addEventListener('touchmove', event => {
    const t = event.touches;
    if (pinch && t.length === 2) { if (event.cancelable) event.preventDefault(); applyZoom(pinchTo(pinch.z0, pinch.d0, pinch.m0, dist(t), mid(t), zoomBox())); }
    else if (pan && t.length === 1) { if (event.cancelable) event.preventDefault(); applyZoom(panBy(pan.z0, t[0].clientX - pan.x, t[0].clientY - pan.y, zoomBox())); }
  }, {passive:false});
  strip.addEventListener('touchend', event => {
    lastTouchAt = Date.now();
    const t = event.touches;
    if (pinch) {
      if (t.length >= 2) return;
      pinch = null; tapStart = lastTap = null;
      applyZoom(settleZoom(zoom, zoomBox()), true);
      pan = t.length === 1 && isZoomed(zoom) ? {z0:{...zoom}, x:t[0].clientX, y:t[0].clientY} : null;
      return;
    }
    if (t.length) return;
    pan = null;
    const s = tapStart, p = event.changedTouches[0]; tapStart = null;
    if (!s || !p) return;
    const cur = {x:p.clientX, y:p.clientY, t:Date.now()};
    if (!isTap({dx:cur.x - s.x, dy:cur.y - s.y, dt:cur.t - s.t})) { lastTap = null; return; }
    if (isDoubleTap(lastTap, cur)) {
      lastTap = null;
      if (event.cancelable) event.preventDefault(); // 두 번째 톡이 누르기·더블클릭으로 또 오지 않게
      const f = focal(cur.x, cur.y);
      applyZoom(zoomToggle(zoom, f.x, f.y, zoomBox()), true);
    } else lastTap = cur;
  }, {passive:false});
  strip.addEventListener('touchcancel', () => { pinch = pan = tapStart = null; if (isZoomed(zoom)) applyZoom(settleZoom(zoom, zoomBox())); }, {passive:true});
  // PC: 휠 = 마우스 아래 점을 확대·축소(트랙패드 가로 밀기는 그대로 넘기기), 더블클릭 = 확대 ↔ 원래 크기, 확대 중 끌기 = 사진 안 움직이기.
  strip.addEventListener('wheel', event => {
    if (!zoomable() || (!event.ctrlKey && Math.abs(event.deltaX) > Math.abs(event.deltaY))) return;
    event.preventDefault();
    const f = focal(event.clientX, event.clientY), s = wheelScale(zoom.s, event.deltaY, event.deltaMode);
    applyZoom(s < 1.02 ? {...ZOOM_ONE} : zoomAt(zoom, s, f.x, f.y, zoomBox()));
  }, {passive:false});
  strip.addEventListener('dblclick', event => {
    if (Date.now() - lastTouchAt < 800 || !zoomable() || onControl(event.target)) return;
    event.preventDefault();
    const f = focal(event.clientX, event.clientY);
    applyZoom(zoomToggle(zoom, f.x, f.y, zoomBox()), true);
  });
  strip.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'mouse' || event.button !== 0 || !isZoomed(zoom) || onControl(event.target)) return;
    event.preventDefault();
    mouse = {z0:{...zoom}, x:event.clientX, y:event.clientY, id:event.pointerId};
    try { strip.setPointerCapture(event.pointerId); } catch { /* 잡지 못해도 끌기는 된다 */ }
  });
  strip.addEventListener('pointermove', event => { if (mouse && event.pointerId === mouse.id) applyZoom(panBy(mouse.z0, event.clientX - mouse.x, event.clientY - mouse.y, zoomBox())); });
  const mouseUp = event => { if (mouse && event.pointerId === mouse.id) mouse = null; };
  strip.addEventListener('pointerup', mouseUp); strip.addEventListener('pointercancel', mouseUp);
  strip.addEventListener('dragstart', event => { if (event.target?.tagName === 'IMG') event.preventDefault(); });
  box.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closePhotoStrip(); }
    else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); step(event.key === 'ArrowRight' ? 1 : -1); }
    else if ((event.key === 's' || event.key === 'S') && !event.target.closest('input,textarea')) { event.preventDefault(); toggleHere(); }
  });
  box.addEventListener('click', event => {
    if (event.target.closest('[data-diary-viewer-close]')) closePhotoStrip();
    else if (event.target.closest('[data-diary-star]')) toggleHere();
    else if (event.target.closest('[data-diary-share]')) shareCurrent(event.target.closest('[data-diary-share]'));
    else if (event.target.closest('[data-diary-undo]')) undoPending();
    else if (event.target.closest('[data-od-delete]')) deleteCurrent();
    else if (event.target.closest('[data-strip-play]')) playAt(Number(event.target.closest('[data-strip-play]').dataset.stripPlay));
    else if (event.target.closest('[data-strip-original]')) download?.(items[at]);
    else if (event.target.closest('[data-diary-info]')) { infoEl.hidden = !infoEl.hidden; infoBtn.setAttribute('aria-expanded', String(!infoEl.hidden)); paintInfo(); }
  });
  buildSlides(); host.append(box);
  viewer = {box, trigger, refresh, reload, note, onClose, dispose:() => { resetZoom(); dropHires(); }, starChanged:false, undoShown:on => { undoBtn.hidden = !on; if (!on && !pending) noteText(''); },
    layer:window.KPTURouter?.layer?.open(layerName, {close:() => { closePhotoStrip({fromBack:true}); return true; }}) || null};
  document.documentElement.classList.add('diary-viewer-open');
  strip.scrollLeft = index * strip.clientWidth; show();
  box.querySelector('[data-diary-viewer-close]').focus();
  showHint();
  return viewer;
  // 처음 몇 번만: 손가락 동그라미 시늉 2번(움직임 줄이기면 없음) + 한 줄 안내. 연 횟수를 하나 올려 서버에 둔다(적용 전 DB는 거절 → 이번만 기억 안 됨).
  function showHint() {
    const seen = viewPrefs.get('photo_hint');
    if (!hintDue(seen)) return;
    hintEl.hidden = false;
    if (!still()) { finger.hidden = false; finger.addEventListener('animationend', () => { finger.hidden = true; }, {once:true}); }
    viewPrefs.set('photo_hint', hintNext(seen), {rejectable:true});
    box.dataset.stripHint = String(hintSeen(seen) + 1);
  }
}
export function closePhotoStrip({fromBack = false, restore = true} = {}) {
  if (!viewer) return;
  const {box, trigger, layer, starChanged, onClose, dispose} = viewer; viewer = null;
  dispose?.();
  box.querySelectorAll('video').forEach(v => { v.pause?.(); v.removeAttribute('src'); });
  box.remove(); document.documentElement.classList.remove('diary-viewer-open');
  if (!fromBack) layer?.close();
  // 되돌리기 시간이 남았어도 닫으면 지금 휴지통으로 보낸다(되돌리기 버튼이 사라지므로).
  if (pending) commitPending();
  onClose?.({starChanged, restore});
  if (restore && trigger?.isConnected) trigger.focus();
}
