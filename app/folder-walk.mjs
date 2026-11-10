// FILES-폰폴더위로(요청함 11/06 01:10) ①·⑤: 폰 '그 폴더만'에서 한 단계 위로 가는 규칙 하나(파일·노트·사진·자료실이 같이 씀).
// walk = 이 화면에서 들어온 폴더부터 하위 폴더를 눌러 한 단계씩 내려온 길(폴더 열쇠 목록, 화면 메모리만).
// ‹·뒤로 키·화면 왼쪽 끝 밀기 = 길에서 한 단계 위, 길 처음(들어온 폴더)이면 펼친 자리 그대로 나무로(FOLDER-나무새기준 ④ 그대로).
// 오므리기는 이 규칙을 쓰지 않고 늘 나무로 간다. 위치 줄 누르기 = 고른 단계(길에 있으면 거기까지 줄이고, 없으면 그 폴더가 새 길 처음).

// key: 지금 보는 폴더 열쇠(없으면 길을 비움). down: 지금 폴더 안의 하위 폴더를 눌러 한 단계 내려옴.
export function walkTo(walk, key, {down = false} = {}) {
  const list = Array.isArray(walk) ? walk.filter(Boolean) : [];
  if (!key) return [];
  if (list.at(-1) === key) return list;
  if (down && list.length) return [...list, key];
  const i = list.indexOf(key);
  return i >= 0 ? list.slice(0, i + 1) : [key];
}

// 한 단계 위: to = 갈 폴더 열쇠(null이면 나무로), walk = 간 뒤의 길.
export function walkUp(walk) {
  const list = Array.isArray(walk) ? walk.filter(Boolean) : [];
  return list.length > 1 ? {to: list.at(-2), walk: list.slice(0, -1)} : {to: null, walk: []};
}

// ‹ 단추 이름(화면 읽기·길게 누르기 안내): 한 단계 위가 있으면 '위 폴더', 없으면 '폴더 나무'.
export const walkUpLabel = walk => (walkUp(walk).to ? '위 폴더' : '폴더 나무');
