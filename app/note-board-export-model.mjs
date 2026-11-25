// S70-32 ③(명진 2026-11-25 "보드 PDF·HTML 내보내기"): 노트 › 보드 내보내기 계산(화면 없음, 시험 가능). 화면 쪽은 note-board-export.js.
// - 내보내는 범위 = 보드 위 모든 칸(카드·상자·글자·도형·이미지·선)을 감싸는 사각형 + 둘레 여백(맞추기와 같은 '전체').
// - PDF = 그 범위를 그린 그림(JPEG) 한 장을 쪽 하나에 담은 파일. 쪽 크기는 그림 비율 그대로(1px = 0.75pt), 긴 변 14400pt 안.
// - 파일은 기기에서 내려받기만 한다(서버에 사본·공개 주소를 만들지 않음). 기기 저장 없음.
export const EXPORT_PAD = 24;
export const RASTER_MAX = 6000; // PDF 그림 긴 변(px) — 넘으면 줄여 그린다(기기 메모리 지킴)
const PT = 0.75, PAGE_MAX = 14400;

// rects: [{x, y, w, h}] (보드 좌표). 하나도 없으면 null.
export function unionBounds(rects, pad = EXPORT_PAD) {
  const ok = (rects || []).filter(r => r && [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w >= 0 && r.h >= 0);
  if (!ok.length) return null;
  const x0 = Math.min(...ok.map(r => r.x)), y0 = Math.min(...ok.map(r => r.y));
  const x1 = Math.max(...ok.map(r => r.x + r.w)), y1 = Math.max(...ok.map(r => r.y + r.h));
  return {x:Math.floor(x0 - pad), y:Math.floor(y0 - pad), w:Math.ceil(x1 - x0 + 2 * pad), h:Math.ceil(y1 - y0 + 2 * pad)};
}
// 그림 배율: 선명하게 2배, 긴 변이 RASTER_MAX를 넘으면 줄인다.
export const rasterScale = (w, h, want = 2) => Math.max(0.1, Math.min(want, RASTER_MAX / Math.max(1, w, h)));

// 내려받을 파일 이름: '보드이름 2026-11-25.pdf'. 파일 이름에 못 쓰는 글자는 뺀다.
export function exportFileName(name, ext, at = new Date()) {
  const base = String(name || '').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || '보드';
  const d = at instanceof Date && Number.isFinite(at.getTime()) ? at : new Date(), two = n => String(n).padStart(2, '0');
  return `${base} ${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}.${ext}`;
}

// JPEG 한 장 → PDF 한 쪽(그림 XObject DCTDecode). w·h = 그림 화소, showW·showH = 쪽에 보일 크기(px, 1px = 0.75pt).
export function pdfFromJpeg(jpeg, w, h, showW = w, showH = h) {
  const img = jpeg instanceof Uint8Array ? jpeg : new Uint8Array(jpeg || []);
  if (!(img.length > 3 && img[0] === 0xff && img[1] === 0xd8)) throw new Error('JPEG가 아니에요.');
  if (![w, h, showW, showH].every(v => Number.isFinite(v) && v > 0)) throw new Error('크기가 틀렸어요.');
  const fit = Math.min(1, PAGE_MAX / Math.max(showW * PT, showH * PT));
  const pw = +(showW * PT * fit).toFixed(2), ph = +(showH * PT * fit).toFixed(2);
  const enc = new TextEncoder(), parts = [], offsets = [];
  let size = 0;
  const push = chunk => { const b = typeof chunk === 'string' ? enc.encode(chunk) : chunk; parts.push(b); size += b.length; };
  const obj = (n, body) => { offsets[n] = size; push(`${n} 0 obj\n${body}\nendobj\n`); };
  push('%PDF-1.4\n'); push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // 이 파일은 글이 아니라는 표시 줄
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>`);
  offsets[4] = size;
  push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${Math.round(w)} /Height ${Math.round(h)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.length} >>\nstream\n`);
  push(img); push('\nendstream\nendobj\n');
  const draw = `q ${pw} 0 0 ${ph} 0 0 cm /Im1 Do Q`;
  obj(5, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
  const xref = size;
  push(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map(n => `${String(offsets[n]).padStart(10, '0')} 00000 n \n`).join('')}`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(size); let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
// PDF 바이트의 쪽 수(/Type /Page 개수, /Pages 제외) — 시험·확인용.
export function pdfPageCount(bytes) {
  const text = new TextDecoder('latin1').decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []));
  return (text.match(/\/Type\s*\/Page(?!s)/g) || []).length;
}
