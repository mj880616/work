// OD-크게보기 공용 부품(PHOTO-사진메뉴 1차, 2026-10-28): 원드라이브 사진 크게 보기 하나. 일기(diary.js)와 사진 메뉴(photos.js)가 함께 쓴다.
// 일기에 있던 크게 보기를 그대로 옮겨 왔다(모양·손동작·버튼줄 같음). 상태(목록·별표·지우기)는 부르는 화면이 갖고, 여기는 그리기와 손동작만 한다.
// 위 줄 [✕] '6 / 256' … 찍은 날짜·시각, 아래 버튼줄 [☆ 별표] [⇪ 공유] [🗑 지우기] [ⓘ 정보](명진 결정 2026-10-28 07:45).
// 손동작: 좌우 넘기기 = 앞뒤 사진, 위로 밀기 = 별표 토글, 아래로 밀기 = 닫기(× 버튼·뒤로가기도 닫기, router layer). S 키 = 별표.
// 🗑(원드라이브 사진만)은 묻지 않고 목록에서 바로 빼고 '휴지통으로 옮겼어요 · 되돌리기'를 몇 초 보여 준다. 그 시간이 지나거나 닫거나 화면을 떠나면
// 원드라이브 휴지통으로 보낸다(영구 삭제 아님). 되돌리기는 보내기 전이라 같은 자리로 그대로 돌아온다. 기기 저장 없음.
import {swipeKind, shareFileName, UNDO_MS} from './photo-viewer-model.mjs';
import {preparePhotoBlob, sharePhotoElement, paintPhotoNote, PHOTO_WAIT} from './photo-share.js';

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
//   original(item)이 {download:true}를 돌려주면 [ⓘ] 판 맨 아래가 [⤓ 원본 받기] 단추가 되고 download(item)을 부른다. badge(item): 칸 위 작은 글('▶ 0:42').
export function openPhotoStrip(opts) {
  const {host, list, index, title, layerName = 'diary-photo', element, label, when, caption = () => '', info, original, isStarred, toggleStar,
    deletable, take, restore, commit, errorText = () => '지우지 못했어요.', onError, onClose, play = null, download = null, badge = () => ''} = opts;
  const first = list();
  if (!first[index] || viewer) return null;
  let items = first.slice(), at = index, noteTimer = null;
  const trigger = document.activeElement, box = document.createElement('div');
  box.className = 'diary-viewer'; box.dataset.diaryViewer = '';
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', title);
  box.innerHTML = `<div class="diary-viewer-bar"><button type="button" class="diary-viewer-close" data-diary-viewer-close aria-label="크게 보기 닫기">✕</button><span class="diary-viewer-count" data-diary-viewer-count aria-live="polite"></span><span class="diary-viewer-when" data-diary-viewer-when></span></div><div class="diary-viewer-strip" data-diary-viewer-strip tabindex="0"></div><p class="diary-viewer-caption" data-diary-viewer-caption></p><dl class="diary-viewer-info" data-diary-viewer-info hidden></dl><p class="diary-viewer-note" data-diary-viewer-note role="status"><span data-diary-viewer-note-text></span><button type="button" class="diary-viewer-undo" data-diary-undo hidden>되돌리기</button></p><div class="diary-viewer-actions" role="group" aria-label="사진 동작"><button type="button" data-diary-star aria-pressed="false"><span aria-hidden="true">☆</span> 별표</button><button type="button" data-diary-share><span aria-hidden="true">⇪</span> 공유</button><button type="button" data-od-delete><span aria-hidden="true">🗑</span> 지우기</button><button type="button" data-diary-info aria-expanded="false"><span aria-hidden="true">ⓘ</span> 정보</button></div>`;
  const strip = box.querySelector('[data-diary-viewer-strip]'), count = box.querySelector('[data-diary-viewer-count]'), captionEl = box.querySelector('[data-diary-viewer-caption]');
  const whenEl = box.querySelector('[data-diary-viewer-when]'), infoEl = box.querySelector('[data-diary-viewer-info]'), infoBtn = box.querySelector('[data-diary-info]');
  const starBtn = box.querySelector('[data-diary-star]'), delBtn = box.querySelector('[data-od-delete]'), undoBtn = box.querySelector('[data-diary-undo]');
  const noteText = text => paintPhotoNote(box.querySelector('[data-diary-viewer-note-text]'), text);
  const fill = i => {
    const slide = strip.children[i];
    if (!slide || slide.dataset.filled) return;
    // 크게 보기는 화면 관찰 없이 바로 받는다: 보는 장이 먼저(VISIBLE), 앞뒤 2장은 그다음(NEAR).
    slide.dataset.filled = '1'; slide.append(element(items[i], 'large', {label:label(items[i], i), eager:true, prio:i === at ? 0 : 1}));
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
    for (const step of [0, 1, -1, 2, -2]) fill(at + step);
    strip.querySelectorAll('video').forEach(v => { if (v.parentElement !== strip.children[at]) v.pause?.(); });
    refresh(); paintInfo(); prepareShown();
  };
  const note = (text, ms = 0) => { clearTimeout(noteTimer); noteText(text); if (ms) noteTimer = setTimeout(() => { if (!pending) noteText(''); }, ms); };
  // 보는 장의 그림이 뜨면(load는 거품이 없어 잡기 단계로 듣는다) 그 그림의 바이트를 미리 준비해 [공유]를 바로 넘긴다.
  strip.addEventListener('load', () => setTimeout(prepareShown, 0), true);
  strip.addEventListener('scroll', () => { const next = Math.round(strip.scrollLeft / Math.max(1, strip.clientWidth)); if (next !== at && items[next]) { at = next; show(); } }, {passive:true});
  const step = dir => strip.scrollTo({left:Math.max(0, Math.min(items.length - 1, at + dir)) * strip.clientWidth, behavior:'smooth'});
  // 목록이 바뀐 뒤(지우기·되돌리기) 다시 짠다. id가 주어지면 그 사진으로 간다.
  const reload = id => {
    if (viewer?.box !== box) return;
    items = list().slice();
    if (!items.length) { closePhotoStrip(); return; }
    const found = id ? items.findIndex(x => x.kind === 'od' && x.id === id) : -1;
    at = found >= 0 ? found : Math.min(at, items.length - 1);
    buildSlides(); strip.scrollLeft = at * strip.clientWidth; show();
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
  function shareCurrent() {
    const item = items[at], el = slidePhoto(at); if (!item || !el) return;
    sharePhotoElement(el, blob => shareFileName(item, blob.type), {alive:() => viewer?.box === box && items[at] === item, note});
  }
  const star = item => { if (!item) return; if (viewer) viewer.starChanged = true; return toggleStar(item); };
  // 한 손가락 세로 밀기(사진 위): 위 = 별표, 아래 = 닫기. 가로 넘기기·확대(두 손가락)는 브라우저가 맡는다.
  let touch = null;
  strip.addEventListener('touchstart', event => { touch = event.touches.length === 1 ? {x:event.touches[0].clientX, y:event.touches[0].clientY, t:Date.now(), fingers:1} : null; }, {passive:true});
  strip.addEventListener('touchmove', event => { if (touch && event.touches.length > 1) touch.fingers = event.touches.length; }, {passive:true});
  strip.addEventListener('touchend', event => {
    const start = touch; touch = null;
    const end = event.changedTouches[0];
    if (!start || !end) return;
    const kind = swipeKind({dx:end.clientX - start.x, dy:end.clientY - start.y, dt:Date.now() - start.t, fingers:start.fingers, zoomed:zoomed()});
    if (kind === 'down') closePhotoStrip();
    else if (kind === 'up') { const item = items[at], was = isStarred(item); star(item); if (isStarred(item) !== was) note(was ? '별표를 풀었어요' : '별표했어요', 1500); }
  }, {passive:true});
  box.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closePhotoStrip(); }
    else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); step(event.key === 'ArrowRight' ? 1 : -1); }
    else if ((event.key === 's' || event.key === 'S') && !event.target.closest('input,textarea')) { event.preventDefault(); star(items[at]); }
  });
  box.addEventListener('click', event => {
    if (event.target.closest('[data-diary-viewer-close]')) closePhotoStrip();
    else if (event.target.closest('[data-diary-star]')) star(items[at]);
    else if (event.target.closest('[data-diary-share]')) shareCurrent();
    else if (event.target.closest('[data-diary-undo]')) undoPending();
    else if (event.target.closest('[data-od-delete]')) deleteCurrent();
    else if (event.target.closest('[data-strip-play]')) playAt(Number(event.target.closest('[data-strip-play]').dataset.stripPlay));
    else if (event.target.closest('[data-strip-original]')) download?.(items[at]);
    else if (event.target.closest('[data-diary-info]')) { infoEl.hidden = !infoEl.hidden; infoBtn.setAttribute('aria-expanded', String(!infoEl.hidden)); paintInfo(); }
  });
  buildSlides(); host.append(box);
  viewer = {box, trigger, refresh, reload, note, onClose, starChanged:false, undoShown:on => { undoBtn.hidden = !on; if (!on && !pending) noteText(''); },
    layer:window.KPTURouter?.layer?.open(layerName, {close:() => { closePhotoStrip({fromBack:true}); return true; }}) || null};
  document.documentElement.classList.add('diary-viewer-open');
  strip.scrollLeft = index * strip.clientWidth; show();
  box.querySelector('[data-diary-viewer-close]').focus();
  return viewer;
}
export function closePhotoStrip({fromBack = false, restore = true} = {}) {
  if (!viewer) return;
  const {box, trigger, layer, starChanged, onClose} = viewer; viewer = null;
  box.querySelectorAll('video').forEach(v => { v.pause?.(); v.removeAttribute('src'); });
  box.remove(); document.documentElement.classList.remove('diary-viewer-open');
  if (!fromBack) layer?.close();
  // 되돌리기 시간이 남았어도 닫으면 지금 휴지통으로 보낸다(되돌리기 버튼이 사라지므로).
  if (pending) commitPending();
  onClose?.({starChanged, restore});
  if (restore && trigger?.isConnected) trigger.focus();
}
