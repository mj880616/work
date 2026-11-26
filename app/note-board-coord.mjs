// S71-52 NOTE-큰생각지도(사용자 2026-11-26 "광범위한 생각지도 … 무한정 뻗어나가는"): 보드 판 좌표 범위 한 곳.
// 판은 어느 방향으로나 뻗는다(음수 좌표 포함). 저장 범위는 서버 check와 같다:
// - 상자(app_note_board_texts x·y)·선 점 끝(app_note_board_links from_x·from_y·to_x·to_y): migration 20261127000000_note_board_wide_coords(-1,000,000~1,000,000).
// - 노트 카드 자리(노트 metadata.boards[보드].x·y): 화면 검사(note-board-model.mjs placeShape)만 — 같은 범위.
// 화면은 판 좌표 0을 따로 두지 않는다(보이는 자리 = translate + scale). 기기 저장 없음.
export const COORD_LIMIT = 1000000;
export const clampCoord = v => (Number.isFinite(v) ? Math.max(-COORD_LIMIT, Math.min(COORD_LIMIT, Math.round(v))) : 0);
export const okCoord = v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= COORD_LIMIT;
