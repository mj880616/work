// S69-23 LIB-폴더째올리기 (2026-11-24 사용자 요청 "자료실에 폴더째로도 업로드 가능하게"): 탐색기 폴더를 끌어 놓거나 [폴더 올리기]로 고르면
// 그 폴더 이름으로 앱 폴더를 만들고, 안쪽 하위 폴더 구조를 그대로 만든 뒤 파일을 각 폴더에 올린다.
// 이 파일은 화면 없는 규칙만 맡는다: ① 놓은 폴더·고른 폴더 읽기(webkitGetAsEntry / webkitRelativePath) ② 건너뛸 파일 가르기·크기 세기
// ③ 같은 이름 폴더 찾기·앱 폴더 만들 순서. 실제 폴더 만들기(소유자 RLS REST)와 올리기(library-files 한 파일씩)는 library-upload.js가 넘겨 주는 함수다.
// 드라이브는 S69-20 규칙(앱 폴더마다 짝 드라이브 폴더, 바뀐 뒤 auto)이 따라 맞춘다 — 여기서 드라이브를 따로 부르지 않는다.
// 기기에 아무것도 저장하지 않는다(메모리뿐).

// 숨김 파일: 운영체제가 만드는 것(.DS_Store·Thumbs.db·desktop.ini)과 이름이 '.'으로 시작하는 것. 숨김 폴더('.git' 등)는 안을 읽지 않는다.
const SKIP_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);
export const isHiddenName = name => { const n = String(name ?? '').trim().toLowerCase(); return !n || n.startsWith('.') || SKIP_NAMES.has(n); };
// 너무 큰 폴더는 시작 전에 한 번 묻는다(올리기 한도·서버 검사는 그대로 — 이것은 사람에게 확인만).
export const BIG_FOLDER = Object.freeze({files: 500, bytes: 2 * 1024 ** 3});
export const FOLDER_NAME_MAX = 40; // DB 검사 app_library_folders_name_check(1~40자, 앞뒤 빈칸·제어 문자 없음)와 같은 규칙

// 앱 폴더 이름으로 쓸 수 있게: 제어 문자 빼고, 앞뒤 빈칸 없애고, 40자까지. 비면 '폴더'.
export function cleanFolderName(name) {
  const s = String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return [...s].slice(0, FOLDER_NAME_MAX).join('').trim() || '폴더';
}
const key = path => path.join('\u0001');

// 놓은 것 읽기. entries: drop 순간에 DataTransferItem.webkitGetAsEntry()로 받아 둔 것들(놓은 뒤에는 dataTransfer를 다시 읽을 수 없다).
// 돌려줌: {dirs:[['교섭'],['교섭','2026']], files:[{dir:['교섭','2026'], file}], hidden:n}. 맨 위에 같이 놓은 파일은 dir [].
export async function readDroppedEntries(entries) {
  const out = {dirs: [], files: [], hidden: 0};
  const fileOf = entry => new Promise((resolve, reject) => entry.file(resolve, reject));
  // readEntries는 한 번에 일부만(크롬 100개) 준다 — 빈 배열이 올 때까지 다시 부른다.
  const listOf = async dir => {
    const reader = dir.createReader(), all = [];
    for (;;) { const part = await new Promise((resolve, reject) => reader.readEntries(resolve, reject)); if (!part.length) break; all.push(...part); }
    return all;
  };
  async function walk(entry, path) {
    if (entry.isDirectory) {
      if (isHiddenName(entry.name)) return; // 숨김 폴더는 열지 않는다
      const here = [...path, entry.name]; out.dirs.push(here);
      for (const child of await listOf(entry)) await walk(child, here);
    } else if (entry.isFile) {
      if (isHiddenName(entry.name)) { out.hidden++; return; }
      out.files.push({dir: path, file: await fileOf(entry)});
    }
  }
  for (const entry of entries || []) if (entry) await walk(entry, []);
  return out;
}
// <input type="file" webkitdirectory>로 고른 파일들: webkitRelativePath('교섭/2026/안.hwp')로 폴더 길을 안다. 빈 하위 폴더는 브라우저가 주지 않는다.
export function readPickedFiles(fileList) {
  const out = {dirs: [], files: [], hidden: 0}, seen = new Set();
  for (const file of Array.from(fileList || [])) {
    const parts = String(file?.webkitRelativePath || file?.name || '').split('/').filter(Boolean), dir = parts.slice(0, -1);
    if (dir.some(isHiddenName)) continue; // 숨김 폴더 안
    if (isHiddenName(parts[parts.length - 1] || file?.name)) { out.hidden++; continue; }
    for (let i = 1; i <= dir.length; i++) { const p = dir.slice(0, i), k = key(p); if (!seen.has(k)) { seen.add(k); out.dirs.push(p); } }
    out.files.push({dir, file});
  }
  return out;
}
export const hasDirectory = entries => (entries || []).some(entry => entry?.isDirectory);

// 읽은 것 → 올릴 계획. 이름은 앱 폴더 이름 규칙으로 고치고(같아진 이름은 한 폴더), 빈 파일은 건너뛴다.
// 돌려줌: {roots:['교섭'], dirs:[[…]](위 폴더부터), files:[{dir,file}], skipped:{hidden,empty}, count, bytes, depth}
export function planFolderUpload(read) {
  const dirs = [], seen = new Set(), add = path => { for (let i = 1; i <= path.length; i++) { const p = path.slice(0, i), k = key(p); if (!seen.has(k)) { seen.add(k); dirs.push(p); } } };
  for (const d of read?.dirs || []) add(d.map(cleanFolderName));
  const files = [], skipped = {hidden: Number(read?.hidden) || 0, empty: 0};
  let bytes = 0;
  for (const {dir, file} of read?.files || []) {
    if (!file || !(Number(file.size) > 0)) { skipped.empty++; continue; }
    const d = (dir || []).map(cleanFolderName); add(d);
    files.push({dir: d, file}); bytes += Number(file.size) || 0;
  }
  dirs.sort((a, b) => a.length - b.length);
  const roots = dirs.filter(d => d.length === 1).map(d => d[0]);
  return {roots, dirs, files, skipped, count: files.length, bytes, depth: dirs.reduce((m, d) => Math.max(m, d.length), 0)};
}
export const isBigFolder = plan => (plan?.count || 0) > BIG_FOLDER.files || (plan?.bytes || 0) > BIG_FOLDER.bytes;
export const skippedCount = plan => (plan?.skipped?.hidden || 0) + (plan?.skipped?.empty || 0);
export const skippedText = plan => { const n = skippedCount(plan); return n ? `숨김·빈 파일 ${n}개는 건너뛰었어요` : ''; };

// 같은 이름 폴더가 놓을 곳(parentId, 맨 위면 null) 바로 아래에 이미 있는 맨 위 폴더 이름들.
export function takenRoots(plan, folders, parentId = null) {
  const names = new Set((folders || []).filter(f => (f.parent_id || null) === (parentId || null)).map(f => String(f.name || '')));
  return (plan?.roots || []).filter(name => names.has(name));
}
// '새로 만들기'를 고르면 겹치지 않는 이름('교섭 (2)'). 40자를 넘지 않게 앞을 줄인다.
export function freeName(name, taken) {
  const used = new Set(taken || []);
  if (!used.has(name)) return name;
  for (let n = 2; ; n++) { const tail = ` (${n})`, head = [...name].slice(0, FOLDER_NAME_MAX - tail.length).join('').trim(); const next = head + tail; if (!used.has(next)) return next; }
}

// 앱 폴더 만들기: 위 폴더부터 하나씩. mode 'merge' = 같은 자리 같은 이름 폴더가 있으면 그 폴더를 쓴다(안쪽도 같게), 'new' = 맨 위 폴더는 새 이름.
// create({parentId, projectId, name, siblings}) → 만든 폴더 줄({id,...}). folders: 지금 앱 폴더 목록(만든 것은 여기에 더해 다음 자리에서 본다).
// 돌려줌: {ids: Map(길 → 폴더 id), made: 만든 수, failed: 만들지 못한 길(그 아래 파일은 올리지 않는다)}.
export async function buildFolders(plan, {folders = [], parentId = null, projectId = null, mode = 'merge', create}) {
  const list = [...folders], ids = new Map(), failed = [];
  let made = 0;
  const kids = pid => list.filter(f => (f.parent_id || null) === (pid || null));
  for (const path of plan?.dirs || []) {
    const up = path.length > 1 ? ids.get(key(path.slice(0, -1))) : (parentId || null);
    if (up === undefined) { failed.push(path); continue; } // 위 폴더를 만들지 못함
    const siblings = kids(up), name = path[path.length - 1];
    const top = path.length === 1;
    const same = mode === 'merge' || !top ? siblings.find(f => String(f.name || '') === name) : null;
    if (same) { ids.set(key(path), same.id); continue; }
    const pick = top && mode === 'new' ? freeName(name, siblings.map(f => String(f.name || ''))) : name;
    const pid = up ? (list.find(f => f.id === up)?.project_id ?? null) : (projectId || null);
    let row = null;
    try { row = await create({parentId: up, projectId: pid, name: pick, siblings}); } catch { row = null; }
    if (!row?.id) { failed.push(path); continue; }
    list.push({...row, parent_id: up, project_id: pid, name: pick}); ids.set(key(path), row.id); made++;
  }
  return {ids, made, failed};
}
export const folderIdOf = (ids, dir, parentId = null) => dir?.length ? ids.get(key(dir)) : (parentId || null);
// 진행 표시 글: '교섭 · 3/12'(맨 위 폴더가 여럿이면 첫 이름 외 n).
export function progressLabel(plan, index) {
  const roots = plan?.roots || [], name = roots.length > 1 ? `${roots[0]} 외 ${roots.length - 1}` : roots[0] || '폴더';
  return `${name} · ${index}/${plan?.count || 0}`;
}
