// S69-98 NOTE-에버노트 ⑥ 문서 스캔(사용자 11/25 "좋아 모두 다 넣어!"): 종이를 찍은 사진의 네 모서리를 맞춰 반듯하게 펴고 밝기를 고르는 순수 계산.
// DOM·네트워크 없음(node --test). 화면은 doc-scan.js, 펴진 사진은 노트의 기존 [사진] 길(비공개 노트 첨부)로 올라가고 글자 읽기(④)가 뒤따른다.
// 점은 {x, y}(원본 사진 픽셀), 모서리 순서는 늘 왼쪽 위 → 오른쪽 위 → 오른쪽 아래 → 왼쪽 아래.

export const OUT_MAX = 2000; // 펴진 사진의 긴 변 상한(px) — 글자 읽기에 충분하고 올리기 부담이 적다
export const OUT_MIN = 40;
export const JPEG_QUALITY = 0.88;

const finite = v => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// 처음 모서리: 사진 가장자리에서 조금 안쪽(사람이 끌어 맞춘다).
export function defaultCorners(width, height, inset = 0.06) {
  const dx = Math.round(width * inset), dy = Math.round(height * inset);
  return [{x: dx, y: dy}, {x: width - dx, y: dy}, {x: width - dx, y: height - dy}, {x: dx, y: height - dy}];
}
// 모서리 하나를 사진 안으로(끌기·화살표 키).
export function clampPoint(p, width, height) {
  return {x: clamp(Math.round(p.x), 0, width), y: clamp(Math.round(p.y), 0, height)};
}
// 네 점이 볼록한 사각형(꼬이지 않음, 넓이가 있음)인가.
export function isConvexQuad(q) {
  if (!Array.isArray(q) || q.length !== 4 || q.some(p => !finite(p?.x) || !finite(p?.y))) return false;
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1) return false;
    const s = Math.sign(cross);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}
// 펴진 사진 크기: 마주 보는 변 중 긴 쪽, 긴 변은 OUT_MAX까지.
export function outputSize(q, max = OUT_MAX) {
  const w = Math.max(dist(q[0], q[1]), dist(q[3], q[2])), h = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  const k = Math.min(1, max / Math.max(w, h, 1));
  return {width: Math.max(OUT_MIN, Math.round(w * k)), height: Math.max(OUT_MIN, Math.round(h * k))};
}
// 8×8 연립방정식(가우스 소거, 부분 피벗). 풀 수 없으면 null.
function solve(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}
// src 네 점 → dst 네 점으로 보내는 원근 변환 [a,b,c,d,e,f,g,h](x' = (ax+by+c)/(gx+hy+1), y' = (dx+ey+f)/(gx+hy+1)).
export function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const {x, y} = src[i], {x: u, y: v} = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  return solve(A, b);
}
export function applyH(H, x, y) {
  const w = H[6] * x + H[7] * y + 1;
  return {x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w};
}
// 펴기: 결과 사진의 각 점이 원본 어디인지(결과 → 원본 변환)로 원본 픽셀을 가져온다(쌍선형 보간).
// src: {width, height, data(RGBA)}, quad: 원본의 네 모서리 → {width, height, data}. 꼬인 사각형이면 null.
export function warp(src, quad, size = outputSize(quad)) {
  if (!isConvexQuad(quad)) return null;
  const {width: W, height: H} = size;
  const back = homography([{x: 0, y: 0}, {x: W, y: 0}, {x: W, y: H}, {x: 0, y: H}], quad);
  if (!back) return null;
  const out = new Uint8ClampedArray(W * H * 4), sw = src.width, sh = src.height, s = src.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = applyH(back, x + 0.5, y + 0.5);
      const fx = clamp(p.x - 0.5, 0, sw - 1), fy = clamp(p.y - 0.5, 0, sh - 1);
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
      const o = (y * W + x) * 4, i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4, i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
      for (let c = 0; c < 3; c++) {
        const top = s[i00 + c] * (1 - tx) + s[i10 + c] * tx, bottom = s[i01 + c] * (1 - tx) + s[i11 + c] * tx;
        out[o + c] = top * (1 - ty) + bottom * ty;
      }
      out[o + 3] = 255;
    }
  }
  return {width: W, height: H, data: out};
}
// 밝기 보정: 밝기(휘도) 아래·위 1%를 검정·흰색으로 늘린다(종이 바탕은 하얗게, 글자는 진하게). 색은 그대로 같은 비율로.
export function levels(data, {low = 0.01, high = 0.01} = {}) {
  const hist = new Uint32Array(256), n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) hist[Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])]++;
  let lo = 0, hi = 255, seen = 0;
  for (; lo < 255; lo++) { seen += hist[lo]; if (seen > n * low) break; }
  seen = 0;
  for (; hi > 0; hi--) { seen += hist[hi]; if (seen > n * high) break; }
  if (hi - lo < 24) return {lo, hi, changed: false}; // 거의 한 색: 그대로
  const k = 255 / (hi - lo);
  for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) data[i + c] = (data[i + c] - lo) * k;
  return {lo, hi, changed: true};
}
// 화면 점(표시 크기) ↔ 원본 점.
export const toImage = (p, scale) => ({x: p.x / scale, y: p.y / scale});
export const toView = (p, scale) => ({x: p.x * scale, y: p.y * scale});
// 표시 배율: 사진 전체가 칸 안에 들어오게.
export function fitScale(width, height, boxW, boxH) {
  if (!(width > 0 && height > 0 && boxW > 0 && boxH > 0)) return 1;
  return Math.min(boxW / width, boxH / height, 1);
}
// 올릴 파일 이름: '스캔 YYYY-MM-DD HHmm.jpg'(서울).
export function scanName(now = new Date()) {
  const d = new Date(now.getTime() + 9 * 3600000), two = v => String(v).padStart(2, '0');
  return `스캔 ${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())} ${two(d.getUTCHours())}${two(d.getUTCMinutes())}.jpg`;
}
