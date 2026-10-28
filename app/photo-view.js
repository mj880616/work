// FILE-누르면동작: 사진 크게 보기의 유일한 구현(바구니 업데이트에서 옮겨 옴). 바구니·노트가 함께 쓴다.
// 화면 위를 덮는 전체 화면 보기에 ×, Esc, 폰 뒤로 가기(라우터 층 하나)가 있다. 사진은 basket-files photo(노트 번호 + 파일 번호)로 읽는다.
import {photoElement} from './diary-data.js';
import {attachmentName} from './attachment-name.mjs';
import {holdPhotoMaker, forgetPhotoBlob, imageElementBlob, sharePhotoElement} from './photo-share.js';
import {slotBox, slotLoading, slotShown, slotFailed} from './img-slot.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let current = null;

// 크게 보기 껍데기 하나(노트 사진·자료실 사진 공용). content는 .basket-photo-stage 안에 들어갈 요소.
function showPhotoBox(shown, content, trigger) {
  if (current) return false;
  const box = document.createElement('div');
  box.className = 'basket-photo-view'; box.dataset.basketPhotoView = '';
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', shown);
  box.innerHTML = `<div class="basket-photo-bar"><span class="basket-photo-name">${esc(shown)}</span><button type="button" class="basket-photo-close" data-basket-photo-close aria-label="크게 보기 닫기">×</button></div><div class="basket-photo-stage"></div>`;
  box.querySelector('.basket-photo-stage').append(content);
  box.addEventListener('click', e => { if (e.target.closest('[data-basket-photo-close]') || e.target === box.querySelector('.basket-photo-stage')) closePhotoView(); });
  box.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePhotoView(); } });
  document.body.append(box);
  current = {box, trigger, layer: window.KPTURouter?.layer?.open('basket-photo', {close: () => { closePhotoView({fromBack: true}); return true; }}) || null};
  box.querySelector('[data-basket-photo-close]').focus();
  return true;
}

// row: 사진이 붙은 노트(id 필요), file: 그 노트의 첨부 한 개.
export function openPhotoView({row, file, trigger = null, rt = window.KPTURuntime}) {
  if (!row?.id || !file || current) return false;
  const shown = attachmentName(file, '사진');
  return showPhotoBox(shown, photoElement(row, file, 'large', {label: shown, rt}), trigger);
}

// 자료실 자료 사진(노트가 없는 자료). getUrl()은 크게 보기 그림 주소를 준다.
// 그릴 수 없으면 Drive에서 열기 링크로 바꾼다(photoElement와 같은 대체).
// driveHref는 그릴 수 없을 때 보여 줄 Drive 보기 주소(file-actions.js가 계산해 넘긴다: 두 파일이 서로 부르지 않게).
function documentPhotoBox({file, getUrl, driveHref = ''}) {
  const shown = attachmentName({file_name: file.name}, '사진');
  const box = document.createElement('span');
  box.className = 'diary-photo'; box.dataset.state = 'loading'; slotBox(box);
  const img = document.createElement('img');
  img.alt = shown; img.decoding = 'async'; box.append(img);
  let a = null;
  // 못 받음: 공용 img-slot.js의 작은 ↻(누르면 다시) + Drive 보기 주소가 있으면 'Drive에서 열기'(photoElement와 같은 대체).
  const fallback = why => {
    img.onload = img.onerror = null; img.removeAttribute('src'); box.dataset.state = 'link';
    slotFailed(box, load, why);
    if (!driveHref || a) return;
    a = document.createElement('a');
    a.href = driveHref; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.className = 'diary-photo-link';
    a.textContent = 'Drive에서 열기'; a.setAttribute('aria-label', `${shown} Drive에서 열기`);
    box.append(a);
  };
  function load() {
    a?.remove(); a = null; box.dataset.state = 'loading'; slotLoading(box);
    // OD-공유고침: 뜬 그림(이 화면이 받은 blob: 주소)을 [공유]가 그대로 넘길 수 있게 칸에 걸어 둔다(photo-share.js).
    img.onload = () => { img.onload = img.onerror = null; holdPhotoMaker(box, () => imageElementBlob(img)); box.dataset.state = 'shown'; slotShown(box); };
    img.onerror = () => { forgetPhotoBlob(box); fallback('img'); };
    Promise.resolve().then(getUrl).then(url => { if (!url) throw new Error('url'); img.src = url; }, () => fallback('url'));
  }
  load();
  return {shown, box};
}

// ACT-사진 3단계: 사업 보고 사진 줄이 쓰는 같은 크게 보기. nav = {count, index, item(i) → {file, getUrl, driveHref}} 이 있으면 좌우 버튼과 ←/→ 키로 넘기고,
// actions(item) → [{label, href?} | {label, run}] 이 있으면 ⋯ 메뉴(Drive에서 열기·내려받기·지우기)가 생긴다. run()이 true를 주면(지웠다) 크게 보기를 닫는다.
export function openDocumentPhotoView({file, getUrl, driveHref = '', trigger = null, nav = null, actions = null}) {
  if (!file || typeof getUrl !== 'function' || current) return false;
  const first = documentPhotoBox({file, getUrl, driveHref});
  if (!showPhotoBox(first.shown, first.box, trigger)) return false;
  if (!nav && !actions) return true;
  const {box} = current, stage = box.querySelector('.basket-photo-stage'), bar = box.querySelector('.basket-photo-bar');
  const nameEl = box.querySelector('.basket-photo-name'), close = box.querySelector('[data-basket-photo-close]');
  let index = nav ? nav.index : 0, item = nav ? nav.item(index) : {file, getUrl, driveHref};
  const countEl = document.createElement('span'); countEl.className = 'basket-photo-count';
  const more = document.createElement('details'); more.className = 'basket-photo-more';
  const prev = document.createElement('button'), next = document.createElement('button');
  for (const [b, dir, label, text] of [[prev, -1, '이전 사진', '‹'], [next, 1, '다음 사진', '›']]) {
    b.type = 'button'; b.className = 'basket-photo-step'; b.dataset.dir = String(dir); b.setAttribute('aria-label', label); b.textContent = text;
  }
  const noteEl = document.createElement('p'); noteEl.className = 'basket-photo-note'; noteEl.setAttribute('role', 'status');
  let noteTimer = null;
  const note = (text, ms = 0) => { clearTimeout(noteTimer); noteEl.textContent = text; if (ms) noteTimer = setTimeout(() => { noteEl.textContent = ''; }, ms); };
  // [공유]: 화면에 뜬 그림을 바로 넘긴다(일기 크게 보기와 같은 photo-share.js). 아직 안 떴으면 '사진 받는 중…' 뒤에 넘긴다.
  const shareShown = () => {
    const el = stage.querySelector('.diary-photo'), shownItem = item, name = String(item?.file?.name || '');
    const nameOf = blob => (/\.(jpe?g|png|gif|webp)$/i.test(name) ? name : `사진.${/png/.test(blob.type) ? 'png' : /webp/.test(blob.type) ? 'webp' : /gif/.test(blob.type) ? 'gif' : 'jpg'}`);
    sharePhotoElement(el, nameOf, {alive: () => current?.box === box && item === shownItem, note});
  };
  const paintMenu = () => {
    if (!actions) return;
    more.innerHTML = '<summary class="basket-photo-more-btn" data-ctx="off" aria-label="사진 메뉴"><span class="more-dots" aria-hidden="true">⋯</span></summary><div class="basket-photo-more-panel" role="group" aria-label="사진 메뉴"></div>';
    const panel = more.querySelector('.basket-photo-more-panel');
    const share = document.createElement('button'); share.type = 'button'; share.dataset.photoShare = ''; share.textContent = '공유';
    share.addEventListener('click', () => { more.removeAttribute('open'); shareShown(); });
    panel.append(share);
    (actions(item) || []).forEach((action, i) => {
      let el;
      if (action.href) { el = document.createElement('a'); el.href = action.href; el.target = '_blank'; el.rel = 'noopener noreferrer'; }
      else { el = document.createElement('button'); el.type = 'button'; el.dataset.photoAction = String(i); }
      el.textContent = action.label; panel.append(el);
      if (!action.href) el.addEventListener('click', async () => {
        more.removeAttribute('open');
        const removed = await action.run(item);
        if (removed === true) closePhotoView();
      });
    });
  };
  const paint = (reuse = null) => {
    item = nav ? nav.item(index) : item;
    const made = reuse || documentPhotoBox(item);
    stage.querySelectorAll('.diary-photo').forEach(el => el.remove());
    stage.prepend(made.box); nameEl.textContent = made.shown; box.setAttribute('aria-label', made.shown);
    if (nav) { countEl.textContent = `${index + 1}/${nav.count}`; prev.disabled = index <= 0; next.disabled = index >= nav.count - 1; prev.hidden = next.hidden = nav.count <= 1; }
    paintMenu();
  };
  if (nav) { bar.insertBefore(countEl, close); stage.append(prev, next); }
  if (actions) { bar.insertBefore(more, close); stage.append(noteEl); }
  const step = dir => { if (!nav) return; const to = index + dir; if (to < 0 || to >= nav.count) return; index = to; note(''); paint(); };
  prev.addEventListener('click', () => step(-1)); next.addEventListener('click', () => step(1));
  box.addEventListener('keydown', e => { if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); } else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); } });
  paint(first);
  return true;
}
export function closePhotoView({fromBack = false, restore = true} = {}) {
  if (!current) return;
  const {box, trigger, layer} = current;
  current = null; box.remove();
  if (!fromBack) layer?.close();
  if (restore && trigger?.isConnected) trigger.focus();
}
