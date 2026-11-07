// UPLOAD-올리기안됨: is a picked file a picture? One rule for every "사진 넣기" path (notes·updates editor, diary).
// The Web2 phone app (Android WebView) can hand over a gallery or cloud photo with an empty File.type,
// sometimes also with a name that has no extension. Judging by File.type alone dropped those photos silently.
// Order: a real image/* type → the name's extension → the first bytes of the file.
const EXT = {jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', jpe: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', bmp: 'image/bmp'};
const unknownType = t => !t || t === 'application/octet-stream';

// The picture type known without reading the file: '' when not a picture or not known yet.
export function pictureTypeOf(file) {
  const t = String(file?.type || '').toLowerCase();
  if (/^image\//.test(t)) return t;
  if (!unknownType(t)) return '';
  const m = /\.([a-z0-9]{2,5})$/i.exec(String(file?.name || ''));
  return m ? EXT[m[1].toLowerCase()] || '' : '';
}

// The picture type from the first 12 bytes: JPEG, PNG, GIF, WEBP, HEIC/HEIF/AVIF, BMP. '' otherwise.
export function sniffPictureType(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const at = (i, ...v) => v.every((x, k) => b[i + k] === x);
  const text = (i, n) => String.fromCharCode(...b.slice(i, i + n));
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (text(0, 4) === 'GIF8') return 'image/gif';
  if (text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') return 'image/webp';
  if (text(4, 4) === 'ftyp') {
    const brand = text(8, 4);
    if (/^avi[fs]$/.test(brand)) return 'image/avif';
    if (/^(heic|heix|hevc|hevx|heim|heis)$/.test(brand)) return 'image/heic';
    if (/^(mif1|msf1|heif)$/.test(brand)) return 'image/heif';
  }
  if (at(0, 0x42, 0x4d)) return 'image/bmp';
  return '';
}

// The file as a picture with a proper type (a new File only when the type had to be filled in), or null.
export async function asPicture(file) {
  if (!file || typeof file.size !== 'number') return null;
  let type = pictureTypeOf(file);
  if (!type && unknownType(String(file.type || '').toLowerCase()) && file.size > 0) {
    try { type = sniffPictureType(new Uint8Array(await file.slice(0, 12).arrayBuffer())); } catch { type = ''; }
  }
  if (!type) return null;
  if (String(file.type || '').toLowerCase() === type) return file;
  const name = String(file.name || '') || 'photo';
  return new File([file], /\.[a-z0-9]{2,5}$/i.test(name) ? name : `${name}.${type.split('/')[1].replace('jpeg', 'jpg')}`, {type, lastModified: file.lastModified || Date.now()});
}

// Picked files → {pictures (typed), others (as picked)}, in the order picked.
export async function splitPictures(list) {
  const all = [...(list || [])], pictures = [], others = [];
  for (const file of all) { const p = await asPicture(file); if (p) pictures.push(p); else others.push(file); }
  return {pictures, others};
}
