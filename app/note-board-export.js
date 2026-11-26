// S70-32 ③(명진 2026-11-25 "보드 PDF·HTML 내보내기"): 노트 › 보드 메뉴 [PDF로 내보내기]·[HTML로 내보내기].
// - 무엇을: 보드 전체(맞추기와 같은 범위 — 모든 카드·상자·글자·도형·이미지·선) 그대로. 판이 그린 화면(note-board.js exportSnapshot)을
//   복사해 화면 모양(계산된 스타일)을 칸마다 붙이고, 사진은 그림 자료(data:)로 넣어 파일 하나로 만든다. 손잡이·메뉴 단추·맞춤선은 뺀다.
// - HTML: 그 한 장짜리 문서. PDF: 그 문서를 그림(JPEG) 한 장으로 그려 쪽 하나에 담는다(note-board-export-model.mjs pdfFromJpeg).
// - 어디로: 이 기기에서 내려받기만. 서버에 사본·공개 주소를 만들지 않고, 남의 연결로 읽지 않는다(사진은 이미 받은 내 사진 칸의 그림).
// 기기 저장 없음.
import {exportFileName, pdfFromJpeg, rasterScale} from './note-board-export-model.mjs';

// 내보내기에서 빼는 것: 손잡이·크기 손잡이·빼기(×)·⋯·맞춤선·끄는 선·숨은 칸.
const DROP = '[data-nb-handle],[data-nb-resize],.nb-x,.nb-more,[data-note-row-more],[data-nb-guides],[data-nb-temp],[data-nb-text-edit],[data-img-retry],.nb-node-bar,[hidden]';
const SKIP_PROPS = /^(cursor|pointer-events|user-select|-webkit-user-select|touch-action|-webkit-touch-callout|transition.*|animation.*|will-change|caret-color|outline.*)$/;

let sandbox = null;
const defaults = new Map();
function defaultStyle(el) {
  const key = `${el.namespaceURI}|${el.localName}`;
  if (defaults.has(key)) return defaults.get(key);
  if (!sandbox) { sandbox = document.createElement('div'); sandbox.style.cssText = 'all:initial;position:fixed;left:-9999px;top:0;visibility:hidden'; sandbox.setAttribute('aria-hidden', 'true'); }
  if (!sandbox.isConnected) document.body.append(sandbox);
  const probe = el.namespaceURI === 'http://www.w3.org/2000/svg' && el.localName !== 'svg'
    ? (() => { const s = document.createElementNS(el.namespaceURI, 'svg'); s.append(document.createElementNS(el.namespaceURI, el.localName)); sandbox.append(s); return s.firstChild; })()
    : (() => { const n = document.createElementNS(el.namespaceURI, el.localName); sandbox.append(n); return n; })();
  const cs = getComputedStyle(probe), out = {};
  for (let i = 0; i < cs.length; i++) out[cs[i]] = cs.getPropertyValue(cs[i]);
  sandbox.replaceChildren();
  defaults.set(key, out);
  return out;
}
// 원본 칸의 화면 모양 중 기본값과 다른 것만 style 글로.
function styleText(el) {
  const cs = getComputedStyle(el), base = defaultStyle(el), out = [];
  for (let i = 0; i < cs.length; i++) {
    const p = cs[i]; if (p.startsWith('--') || SKIP_PROPS.test(p)) continue; // 테마 변수는 이미 값으로 풀려 있다
    const v = cs.getPropertyValue(p); if (v !== base[p]) out.push(`${p}:${v}`);
  }
  return out.join(';');
}
async function asDataUrl(url) {
  if (!url || url.startsWith('data:')) return url || '';
  try {
    const blob = await (await fetch(url)).blob();
    return await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(blob); });
  } catch { return ''; }
}
// 원본 나무 → 복사본(화면 모양을 칸마다 붙임). 사진은 data: 주소로.
async function cloneStyled(src, jobs) {
  if (src.nodeType === Node.TEXT_NODE) return document.createTextNode(src.data);
  if (src.nodeType !== Node.ELEMENT_NODE || src.matches(DROP)) return null;
  const cs = getComputedStyle(src); if (cs.display === 'none') return null;
  const el = src.cloneNode(false);
  for (const a of ['tabindex', 'aria-haspopup', 'aria-expanded', 'aria-controls', 'draggable', 'title']) el.removeAttribute(a);
  el.setAttribute('style', styleText(src));
  if (src.localName === 'img') { el.removeAttribute('srcset'); jobs.push(asDataUrl(src.currentSrc || src.src).then(u => { if (u) el.setAttribute('src', u); else el.remove(); })); }
  for (const child of src.childNodes) { const c = await cloneStyled(child, jobs); if (c) el.append(c); }
  return el;
}
// snapshot: note-board.js exportSnapshot() 답 {board, bounds, background}. 한 장짜리 보드 칸(div)을 만든다.
async function frameOf(snapshot) {
  const {board, bounds, background} = snapshot, jobs = [];
  const copy = await cloneStyled(board, jobs); await Promise.all(jobs);
  for (const p of ['inset', 'inset-block', 'inset-inline', 'inset-block-start', 'inset-block-end', 'inset-inline-start', 'inset-inline-end', 'right', 'bottom', 'left', 'top', 'transform', 'translate', 'scale']) copy.style.removeProperty(p);
  copy.style.position = 'absolute'; copy.style.left = `${-bounds.x}px`; copy.style.top = `${-bounds.y}px`; copy.style.margin = '0';
  const frame = document.createElement('div');
  frame.setAttribute('data-nb-export', '');
  frame.setAttribute('style', `position:relative;overflow:hidden;width:${bounds.w}px;height:${bounds.h}px;background:${background}`);
  frame.append(copy);
  return frame;
}
const htmlEsc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[c]));
export async function boardHtml(snapshot, name) {
  const frame = await frameOf(snapshot);
  return `<!doctype html>\n<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${htmlEsc(name || '보드')}</title>`
    + `<style>html,body{margin:0;background:${snapshot.background}}body{overflow:auto}</style></head><body>${frame.outerHTML}</body></html>\n`;
}
export async function boardPdf(snapshot) {
  const frame = await frameOf(snapshot), {w, h} = snapshot.bounds;
  const xhtml = new XMLSerializer().serializeToString(frame);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject x="0" y="0" width="${w}" height="${h}">${xhtml}</foreignObject></svg>`;
  const img = new Image();
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('보드를 그림으로 만들지 못했어요.')); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
  const k = rasterScale(w, h), canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * k)); canvas.height = Math.max(1, Math.round(h * k));
  const ctx = canvas.getContext('2d'); ctx.fillStyle = snapshot.background; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(resolve => { try { canvas.toBlob(resolve, 'image/jpeg', 0.92); } catch { resolve(null); } });
  if (!blob?.size) throw new Error('보드를 그림으로 만들지 못했어요.');
  return pdfFromJpeg(new Uint8Array(await blob.arrayBuffer()), canvas.width, canvas.height, w, h);
}
// S71-69 SHARE-글공유 ②: 보드가 아닌 칸 하나(노트 읽기 본문)도 같은 길로 — 그 칸 크기 그대로 한 장. 사진은 이미 뜬 그림을 data:로.
export function elementSnapshot(el, background = '') {
  const r = el.getBoundingClientRect();
  const w = Math.max(1, Math.ceil(Math.max(r.width, el.scrollWidth))), h = Math.max(1, Math.ceil(Math.max(r.height, el.scrollHeight)));
  let bg = background;
  for (let n = el; !bg && n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (c && c !== 'transparent' && !c.replace(/\s/g, '').endsWith(',0)')) bg = c; }
  return {board: el, bounds: {x: 0, y: 0, w, h}, background: bg || 'white'};
}
// kind 'pdf' | 'html' → 파일 하나(File). 내려받기·공유는 부르는 쪽이 정한다.
export async function snapshotFile(kind, snapshot, fileName) {
  if (kind === 'html') return new File([await boardHtml(snapshot, fileName.replace(/\.html$/, ''))], fileName, {type: 'text/html'});
  return new File([await boardPdf(snapshot)], fileName, {type: 'application/pdf'});
}
export function download(data, name, type) {
  const url = URL.createObjectURL(new Blob([data], {type}));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.hidden = true;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
// kind 'pdf' | 'html'. getSnapshot: () => Promise<snapshot|null>. 끝나면 알림 글을 돌려준다.
export async function exportBoard(kind, {getSnapshot, name}) {
  const snapshot = await getSnapshot();
  if (!snapshot?.bounds) return '보드가 비어 있어 내보낼 것이 없어요.';
  if (kind === 'html') { download(await boardHtml(snapshot, name), exportFileName(name, 'html'), 'text/html;charset=utf-8'); return 'HTML 파일을 내려받았어요.'; }
  download(await boardPdf(snapshot), exportFileName(name, 'pdf'), 'application/pdf');
  return 'PDF 파일을 내려받았어요.';
}
