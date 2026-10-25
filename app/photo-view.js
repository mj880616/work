// FILE-누르면동작: 사진 크게 보기의 유일한 구현(바구니 업데이트에서 옮겨 옴). 바구니·노트가 함께 쓴다.
// 화면 위를 덮는 전체 화면 보기에 ×, Esc, 폰 뒤로 가기(라우터 층 하나)가 있다. 사진은 basket-files photo(노트 번호 + 파일 번호)로 읽는다.
import {photoElement} from './diary-data.js';
import {attachmentName} from './attachment-name.mjs';

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

// 자료실 자료 사진(노트가 없는 자료). getUrl()은 5분짜리 한 번 쓰는 내려받기 주소(workspace-drive download-token)를 준다.
// 그릴 수 없으면 Drive에서 열기 링크로 바꾼다(photoElement와 같은 대체).
// driveHref는 그릴 수 없을 때 보여 줄 Drive 보기 주소(file-actions.js가 계산해 넘긴다: 두 파일이 서로 부르지 않게).
export function openDocumentPhotoView({file, getUrl, driveHref = '', trigger = null}) {
  if (!file || typeof getUrl !== 'function' || current) return false;
  const shown = attachmentName({file_name: file.name}, '사진');
  const box = document.createElement('span');
  box.className = 'diary-photo'; box.dataset.state = 'loading';
  const img = document.createElement('img');
  img.alt = shown; img.decoding = 'async'; img.hidden = true; box.append(img);
  const fallback = () => {
    img.onload = img.onerror = null; img.remove(); box.dataset.state = 'link';
    const href = driveHref;
    if (!href) { const mark = document.createElement('span'); mark.className = 'diary-photo-mark'; mark.textContent = '사진'; box.append(mark); return; }
    const a = document.createElement('a');
    a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.className = 'diary-photo-link';
    a.textContent = 'Drive에서 열기'; a.setAttribute('aria-label', `${shown} Drive에서 열기`);
    box.append(a);
  };
  img.onload = () => { img.onload = img.onerror = null; box.dataset.state = 'shown'; };
  img.onerror = fallback;
  Promise.resolve().then(getUrl).then(url => { if (!url) throw new Error('url'); img.src = url; img.hidden = false; }, fallback);
  return showPhotoBox(shown, box, trigger);
}
export function closePhotoView({fromBack = false, restore = true} = {}) {
  if (!current) return;
  const {box, trigger, layer} = current;
  current = null; box.remove();
  if (!fromBack) layer?.close();
  if (restore && trigger?.isConnected) trigger.focus();
}
