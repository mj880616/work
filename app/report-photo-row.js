// ACT-사진 3단계: 사업 보고 상세·입력 창의 '사진 줄' 그리기(보여 주기와 크게 보기만. 올리기는 library-upload.js의 uploadFileForMeeting 한 길).
// 작은 그림은 자료실·담당조직·프로젝트와 같은 함수(library-photo.js libraryPhotoUrl, 소유자 로그인으로 Drive 섬네일)를 쓰고 어디에도 저장하지 않는다.
// 사진 줄: [작은 정사각 그림 …] 한 줄에 넘치면 다음 줄. 누르면 크게 보기(좌우 넘기기, Esc·뒤로가기 닫기, ⋯ Drive에서 열기·내려받기·지우기).
import {mountReportPhotos} from './report-photos.js';
import {meetingFileFile} from './meeting-columns.js';
import {viewDocumentPhotos} from './file-actions.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const extOf = name => (String(name || '').includes('.') ? String(name).split('.').pop() : '').toUpperCase().slice(0, 4);

// 올라온 사진 자료들 → 그림 칸 단추들. mountPhotoGrid가 그림을 채운다(못 받는 형식은 확장자 글자만 남는다).
export function photoGridHtml(photos) {
  return (photos || []).map(d => {
    const name = d.file_name || d.title || '사진';
    return `<button type="button" class="act-photo-thumb" data-act-photo="${esc(d.id)}" data-report-photo="${esc(d.id)}" data-ext="${esc(extOf(name))}" aria-label="사진 크게 보기: ${esc(name)}"></button>`;
  }).join('');
}

// box 안에 사진 줄을 그리고 누르면 크게 보기를 연다. extraActions(file, doc)는 크게 보기 ⋯ 에 더할 메뉴(예: 지우기).
export function mountPhotoGrid(box, photos, {api, extraActions = null, onError = () => {}} = {}) {
  if (!box) return;
  const list = photos || [];
  box.innerHTML = photoGridHtml(list);
  box.hidden = !list.length;
  mountReportPhotos(box, {isCurrent: () => box.isConnected});
  const files = list.map(meetingFileFile);
  box.onclick = e => {
    const b = e.target.closest?.('[data-act-photo]');
    if (!b) return;
    const index = list.findIndex(d => d.id === b.dataset.actPhoto);
    if (index >= 0) void viewDocumentPhotos(files, index, {api, trigger: b, onError, extraActions: extraActions ? file => extraActions(file, list.find(d => d.id === file.documentId)) : null});
  };
}

// 입력 창(저장 전): 고른 사진 파일의 작은 미리보기. 이 브라우저 화면 안에서만 쓰고(Blob 주소) 파일을 줄이거나 저장하지 않는다. 뺀 파일의 주소는 바로 거둔다.
const previews = new Map(); // File → blob 주소
export function localPreviewUrl(file) {
  if (!previews.has(file)) previews.set(file, URL.createObjectURL(file));
  return previews.get(file);
}
export function releasePreviews(keep = []) {
  const live = new Set(keep);
  for (const [file, url] of previews) if (!live.has(file)) { URL.revokeObjectURL(url); previews.delete(file); }
}
// entries = [{file, kind, label, index}] (index = 입력 창 전체 목록의 자리, 빼기 단추가 쓴다)
export function localPhotoGridHtml(entries, {busy = false} = {}) {
  releasePreviews((entries || []).map(e => e.file));
  return (entries || []).map(e => {
    const state = e.kind || 'pending', name = e.file?.name || '사진';
    return `<span class="act-photo-thumb act-photo-local" data-state-kind="${esc(state)}" data-ext="${esc(extOf(name))}" title="${esc(name)}${e.label ? ' · ' + esc(e.label) : ''}"><img src="${esc(localPreviewUrl(e.file))}" alt="${esc(name)}" decoding="async">`
      + (state === 'success' ? '<span class="act-photo-badge" aria-hidden="true">✓</span>' : state === 'uploading' ? '<span class="act-photo-badge" aria-hidden="true">…</span>' : state === 'error' ? '<span class="act-photo-badge err" aria-hidden="true">!</span>' : '')
      + (state === 'success' ? '' : `<button class="act-photo-x" type="button" data-meeting-remove-file="${e.index}" aria-label="${esc(name)} 선택 취소"${busy ? ' disabled' : ''}>×</button>`)
      + '</span>';
  }).join('');
}
// box 안에 고른 사진 미리보기를 그린다. 그릴 수 없는 파일(HEIC 등)은 그림이 빠지고 확장자 글자만 남는다.
export function paintLocalPhotos(box, entries, opts = {}) {
  if (!box) return;
  box.innerHTML = localPhotoGridHtml(entries, opts);
  box.hidden = !(entries || []).length;
  box.querySelectorAll('img').forEach(img => img.addEventListener('error', () => img.remove(), {once: true}));
}
