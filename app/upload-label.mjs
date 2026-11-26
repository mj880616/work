// UI-업로드말(S70-41, 2026-11-25 사용자 "올리기는 업로드로 그리고 … 클립 그거 붙어있어야함"): 파일을 올리는 단추 글자는 '업로드',
// 앞에 클립 아이콘(노트·업데이트 [첨부] 단추와 같은 그림, 이모지 글자 아님). 기준표 docs/design/ui-words.md.
// 단추마다 그림을 따로 쓰지 않고 이 한 곳에서 꺼내 쓴다.
export const UPLOAD_WORD = '업로드';
export const CLIP_SVG = '<svg class="up-clip" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M13.2 7.6 8.1 12.7a3.3 3.3 0 0 1-4.7-4.7l5.4-5.4a2.2 2.2 0 0 1 3.1 3.1L6.6 11a1.1 1.1 0 0 1-1.6-1.6l4.8-4.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
// 단추 안 HTML: 클립 + 글자. text는 고정 글자('업로드'·'파일 업로드' 등)만 넘긴다.
export const uploadLabelHtml = (text = UPLOAD_WORD) => `${CLIP_SVG}<span class="up-clip-t">${esc(text)}</span>`;
// 이미 만든 단추에 클립 + 글자를 넣는다(DOM으로 만드는 화면용).
export function putUploadLabel(button, text = UPLOAD_WORD) {
  if (!button) return button;
  button.innerHTML = uploadLabelHtml(text);
  button.classList.add('up-clip-btn');
  return button;
}
