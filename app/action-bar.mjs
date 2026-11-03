// UI-고르기줄(S48-54, 요청함 11/03 07:43·07:44): 여러 개 고르기 줄·크게 보기 아래 줄의 공용 부품. 모양 규칙은 base-ui.css '.kptu-actbar' 한 곳.
// - 줄: class="kptu-actbar kptu-actbar-icon"(아이콘 + 글자, 사진 고르기·크게 보기) 또는 "kptu-actbar kptu-actbar-text"(글자만, 노트·자료실 위쪽 고르기 줄).
// - 버튼: class="kptu-act"(지우기는 + kptu-act-danger, 글자만 빨강). 버튼은 줄 폭을 같은 너비 칸으로 나눠 쓰고(칸 최대 120px), 칸 사이는 같은 간격.
// - 아이콘은 글자 모양(☆ ⇪ ⤓ # …)이거나 아래 선 아이콘(색 그림 이모지 대신, 글자와 같은 색·같은 굵기). 아이콘 칸은 화면 읽기에서 뺀다(aria-hidden).

const svg = body => `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

// 옮기기(폴더)·지우기(휴지통): 예전 📁·🗑 색 그림 대신 같은 선 아이콘.
export const ACT_ICON = Object.freeze({
  move: svg('<path d="M1.8 4.2a1 1 0 0 1 1-1h3.1l1.4 1.5h5.9a1 1 0 0 1 1 1v6.8a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1z"/>'),
  delete: svg('<path d="M2.5 4.2h11M6.2 4.2V2.8h3.6v1.4M3.8 4.2l.7 9h7l.7-9M6.6 6.6v4.6M9.4 6.6v4.6"/>'),
});

// 버튼 안쪽: 아이콘 칸 + 글자 칸. 둘 사이 빈칸은 글자로 읽을 때(textContent) '☆ 별표'처럼 띄우려는 것(화면 배치에는 영향 없음).
export function actInner(icon, text) {
  return `<span class="kptu-act-ic" aria-hidden="true">${icon}</span> <span class="kptu-act-tx">${text}</span>`;
}
