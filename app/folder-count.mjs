// LIB-폴더개수(사용자 11/24 18:04 "폴더 몇 개 파일 몇 개 이렇게 보여 줘야"): 폴더 줄 회색 개수 글자 한 곳(순수 함수, node --test로 시험).
// 파일 화면(files-model.mjs folderCountText)과 자료실 나무·목록·두 칸(library-tree.js folderCountOf)이 같은 말을 쓴다.
//  하위 폴더가 있으면 '폴더 N · 파일 M'(파일 = 바로 안 파일 수, 0이면 빼고 '폴더 N'), 하위 폴더가 없으면 alone(파일 수) — 화면마다 '3'·'3개'.
export const countText = n => Number.isFinite(Number(n)) ? Number(n).toLocaleString('ko-KR') : '';

export function folderFileText(folders, files, {fileWord = '파일', alone = n => String(n)} = {}) {
  const f = Number(folders) || 0, n = Number(files) || 0;
  if (f > 0) return n > 0 ? `폴더 ${countText(f)} · ${fileWord} ${countText(n)}` : `폴더 ${countText(f)}`;
  return alone(n);
}

// 읽기 프로그램용 말(개수 글자의 aria-label). 자료실은 fileWord '자료'·unit '건'.
export function folderFileLabel(folders, files, {fileWord = '파일', unit = '개'} = {}) {
  const f = Number(folders) || 0, n = Number(files) || 0;
  if (f > 0) return n > 0 ? `폴더 ${f}개 · ${fileWord} ${n}${unit}` : `폴더 ${f}개`;
  return `${fileWord} ${n}${unit}`;
}
