// 노트 큰 편집창의 [폴더 ▾]: 화면에 의존하지 않는 규칙. 고르는 창 부품은 note-folder-pick.js.
// 마지막으로 보던 폴더는 서버 화면 설정(view-prefs.js, note_folder: 'all' | 'none' | 'f:<이름>')에서만 읽고 기기 저장은 쓰지 않는다.

// 화면 설정 값 → 새 노트의 기본 폴더 이름(없으면 null = '폴더 없음'). names(폴더 목록)를 알면 목록에 없는 폴더는 null.
export function folderFromView(view, names = null) {
  if (typeof view !== 'string' || !view.startsWith('f:')) return null;
  const name = view.slice(2);
  if (!name) return null;
  return Array.isArray(names) && !names.includes(name) ? null : name;
}
export const folderLabel = name => (typeof name === 'string' && name ? name : '폴더 없음');
// 고르는 창에 보여 줄 줄: 폴더들 + '폴더 없음'. 지금 폴더가 목록에 없으면(다른 곳에서 지워진 경우 등) 그 이름도 한 줄로 남긴다.
export function folderChoices(names, current) {
  const list = [...names];
  if (current && !list.includes(current)) list.push(current);
  return {names: list, none: !current};
}
// 저장할 때 폴더를 따로 써야 하나(기존 노트: 지금 폴더와 고른 폴더가 다를 때만).
export const folderChanged = (before, after) => (before || null) !== (after || null);
