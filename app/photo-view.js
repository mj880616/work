// FILE-누르면동작: 사진 크게 보기의 유일한 구현(바구니 업데이트에서 옮겨 옴). 바구니·노트가 함께 쓴다.
// 화면 위를 덮는 전체 화면 보기에 ×, Esc, 폰 뒤로 가기(라우터 층 하나)가 있다. 사진은 basket-files photo(노트 번호 + 파일 번호)로 읽는다.
import {photoElement} from './diary-data.js';
import {attachmentName} from './attachment-name.mjs';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let current = null;

// row: 사진이 붙은 노트(id 필요), file: 그 노트의 첨부 한 개.
export function openPhotoView({row, file, trigger = null, rt = window.KPTURuntime}) {
  if (!row?.id || !file || current) return false;
  const box = document.createElement('div');
  box.className = 'basket-photo-view'; box.dataset.basketPhotoView = '';
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
  const shown = attachmentName(file, '사진');
  box.setAttribute('aria-label', shown);
  box.innerHTML = `<div class="basket-photo-bar"><span class="basket-photo-name">${esc(shown)}</span><button type="button" class="basket-photo-close" data-basket-photo-close aria-label="크게 보기 닫기">×</button></div><div class="basket-photo-stage"></div>`;
  box.querySelector('.basket-photo-stage').append(photoElement(row, file, 'large', {label: shown, rt}));
  box.addEventListener('click', e => { if (e.target.closest('[data-basket-photo-close]') || e.target === box.querySelector('.basket-photo-stage')) closePhotoView(); });
  box.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePhotoView(); } });
  document.body.append(box);
  current = {box, trigger, layer: window.KPTURouter?.layer?.open('basket-photo', {close: () => { closePhotoView({fromBack: true}); return true; }}) || null};
  box.querySelector('[data-basket-photo-close]').focus();
  return true;
}
export function closePhotoView({fromBack = false, restore = true} = {}) {
  if (!current) return;
  const {box, trigger, layer} = current;
  current = null; box.remove();
  if (!fromBack) layer?.close();
  if (restore && trigger?.isConnected) trigger.focus();
}
