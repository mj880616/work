// UPD-그림붙여넣기: one shared part for "paste a picture (Ctrl+V) into an input that takes attachments".
// The clip button, the drop and this paste all end in the same add(files) of the input's own file part
// (basket-upload.js mountBasketPicker, task-files.js, meeting-compact.js bindDropTarget), so the limits (count, size) and the
// preview rows with × are the ones that part already has. Nothing is stored in the browser: a pasted picture is a File object held
// in memory until the part uploads it or the row is taken out.
const EXT = {'image/png':'png', 'image/jpeg':'jpg', 'image/gif':'gif', 'image/webp':'webp', 'image/bmp':'bmp', 'image/avif':'avif'};
const two = n => String(n).padStart(2, '0');

// The name a pasted picture gets: '붙여넣은 그림 11-04 16:18.png' (local time). A screenshot or a browser's "copy image" comes with a
// generic name ("image.png") or none; a file copied in a file manager keeps its own name.
export function pastedName(file, now = new Date(), taken = []) {
  const type = String(file?.type || '').toLowerCase();
  const ext = EXT[type] || (type.startsWith('image/') ? type.slice(6).replace(/[^a-z0-9]/g, '').slice(0, 5) || 'png' : '');
  const own = String(file?.name || '').trim();
  const generic = !own || /^image(\s*\(\d+\))?\.[a-z0-9]+$/i.test(own) || /^blob$/i.test(own);
  if (!generic) return own;
  if (!ext) return own || '붙여넣은 파일';
  const stamp = `붙여넣은 그림 ${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}:${two(now.getMinutes())}`;
  const names = new Set(taken);
  let name = `${stamp}.${ext}`, n = 1;
  while (names.has(name)) name = `${stamp} (${++n}).${ext}`;
  names.add(name);
  return name;
}

// The files a paste carries (pictures from a screenshot or "copy image", or files copied in a file manager). Letters are not files.
export function clipboardFiles(data) {
  if (!data) return [];
  let files = Array.from(data.files || []);
  if (!files.length) files = Array.from(data.items || []).filter(item => item.kind === 'file').map(item => item.getAsFile?.()).filter(Boolean);
  return files;
}

// Gives pasted pictures their names (several in one paste get "(2)", "(3)" after the same minute; `taken` are the names already
// chosen in this input so a second paste in the same minute does not repeat one).
export function namePasted(files, {now = new Date(), taken = []} = {}) {
  const seen = [...taken];
  return files.map(file => {
    const name = pastedName(file, now, seen);
    seen.push(name);
    return name === file.name ? file : new File([file], name, {type: file.type, lastModified: file.lastModified});
  });
}

// Listens for paste on `target` (the input where the cursor is, or a window that holds it). A paste with files calls onFiles(files).
// Letters pasted with the picture go in as before (the default paste is kept when text comes along); a picture alone is not put
// in as letters. A paste another part already handled (the format editor puts a picture into its text itself) is left alone.
// canTake(): false while the part is busy or hidden, then the paste is not touched at all.
// key: one listener per (target, key) — mounting the same part again on the same window replaces its listener instead of adding a second.
const bound = new WeakMap();
export function bindPaste(target, onFiles, {canTake = () => true, taken = () => [], now = () => new Date(), key = ''} = {}) {
  if (!target) return () => {};
  const keys = bound.get(target) || new Map();
  bound.set(target, keys);
  if (key && keys.has(key)) keys.get(key)();
  const handler = event => {
    if (event.defaultPrevented || !canTake()) return;
    const files = clipboardFiles(event.clipboardData);
    if (!files.length) return;
    const letters = event.clipboardData?.getData?.('text/plain') || '';
    if (!letters) event.preventDefault();
    onFiles(namePasted(files, {now: now(), taken: taken()}), event);
  };
  target.addEventListener('paste', handler);
  const off = () => { target.removeEventListener('paste', handler); if (key && keys.get(key) === off) keys.delete(key); };
  if (key) keys.set(key, off);
  return off;
}
