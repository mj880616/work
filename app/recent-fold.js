// S51-22 '최근' 상자 접기(요청함 11/06 19:50 "어디든 최신 접을 수 있게"): 파일·노트·자료실 맨 위 '최근' 상자의 접은 상태 한 곳.
// 머리 줄을 누르면 접기/펼치기(머리 줄 끝 ▴▾ — folder-tree-ui.mjs ftCaretHtml), 접으면 머리 줄 한 줄만.
// 화면마다 서버 view_prefs.recent_folded(접은 화면 이름 배열)에 기억한다 — 기기 저장 없음. DB 적용 전이면 이번 접속만 접힌다.
import {viewPrefs, RECENT_FOLD_SCREENS} from './view-prefs.js';

const list = () => { const v = viewPrefs.get?.('recent_folded'); return Array.isArray(v) ? v.filter(s => RECENT_FOLD_SCREENS.includes(s)) : []; };
export const recentFolded = screen => list().includes(screen);
// 접기 ↔ 펼치기. 돌려주는 값 = 이제 접혔는가.
export function toggleRecentFolded(screen) {
  if (!RECENT_FOLD_SCREENS.includes(screen)) return false;
  const was = list(), folded = !was.includes(screen);
  viewPrefs.set('recent_folded', folded ? [...was, screen] : was.filter(s => s !== screen), {rejectable: true});
  return folded;
}
