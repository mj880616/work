import { inflateSync } from 'node:zlib';

// S71-70 UI-머리아이콘높이: 화면 사진(PNG) 한 조각에서 '그려진 그림'의 세로 가운데를 잰다.
// 버튼 칸 가운데가 같아도 안쪽 그림이 치우치면 눈에는 높이가 다르다 — 칸이 아니라 그림 자체를 잰다.
// Chromium 스크린샷은 8비트·줄 걸러내기만 쓰는 PNG라 zlib만으로 푼다(별도 패키지 없음).
function decodePng(buf) {
  let pos = 8, width = 0, height = 0, channels = 4; const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); channels = {2: 3, 6: 4}[data[9]] ?? 4; }
    if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = width * channels, out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), o = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? out[o + i - channels] : 0, b = y ? out[o - stride + i] : 0, c = i >= channels && y ? out[o - stride + i - channels] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      out[o + i] = (row[i] + pred) & 255;
    }
  }
  return {width, height, channels, pixels: out};
}

// 상자(페이지 좌표) 안에서 바탕과 다른 점(화소)의 세로 가운데(페이지 좌표)를 돌려준다. 바탕색은 상자 모서리 점으로 정한다.
export async function inkCenterY(page, box) {
  const x = Math.floor(box.x), y = Math.floor(box.y), w = Math.ceil(box.width), h = Math.ceil(box.height);
  const png = decodePng(await page.screenshot({clip: {x, y, width: w, height: h}, scale: 'css', animations: 'disabled', caret: 'hide'}));
  const px = (cx, cy) => { const i = (cy * png.width + cx) * png.channels; return [png.pixels[i], png.pixels[i + 1], png.pixels[i + 2]]; };
  const bg = px(0, 0);
  let top = -1, bottom = -1;
  for (let cy = 0; cy < png.height; cy++) for (let cx = 0; cx < png.width; cx++) {
    const p = px(cx, cy);
    if (Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) > 90) { if (top < 0) top = cy; bottom = cy; }
  }
  if (top < 0) return null;
  return y + (top + bottom + 1) / 2;
}
