// MTG-폰녹음전사(요청함 10/30 15:29): Ogg/Opus 녹음 파일을 규격(RFC 3533·RFC 7845)대로 고쳐 쓴다. 소리는 풀지 않는다(머리 칸만).
// Node 시험·Deno 배포 양쪽에서 읽는다.
// 왜: 안드로이드 MediaRecorder(OutputFormat.OGG, AOSP OggWriter)는 파일 뒤에 이어 쓰기만 하지만(앞부분을 다시 쓰지 않음),
//   - 쪽마다 granule(누적 표본 수)을 "그 소리 묶음이 시작한 시각"(녹음기 시계, 0에서 시작한다는 보장 없음, 일시정지 시간 포함)으로 적고
//   - 마지막 쪽에 끝 표시(EOS)를 남기지 않는다.
//   그래서 길이·시작 시각을 granule로 읽는 해독기는 엉뚱한 길이로 보거나 파일을 거절할 수 있다.
//   여기서는 쪽 머리의 granule·쪽 번호·처음/끝 표시·검사합(CRC)만 다시 계산한다. 소리 바이트·쪽 수·파일 크기는 그대로다
//   (끝이 잘린 쪽·쪽 사이 찌꺼기가 있으면 그것만 뺀다).
// 소리 내용은 다루지 않는다. 결과 보고(stats)에는 수만 담는다.

const CAPTURE = [0x4f, 0x67, 0x67, 0x53]; // 'OggS'
const HEADER = 27;

let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  CRC_TABLE = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let k = 0; k < 8; k++) r = (r & 0x80000000) ? ((r << 1) ^ 0x04c11db7) : (r << 1);
    CRC_TABLE[i] = r >>> 0;
  }
  return CRC_TABLE;
}
// Ogg 검사합(다항식 0x04c11db7, 시작값 0, 뒤집지 않음). 검사합 칸(22..25)은 0으로 보고 계산한다.
export function oggCrc(bytes, start, end) {
  const t = crcTable();
  let crc = 0;
  for (let i = start; i < end; i++) {
    const b = (i - start >= 22 && i - start < 26) ? 0 : bytes[i];
    crc = ((crc << 8) ^ t[((crc >>> 24) ^ b) & 0xff]) >>> 0;
  }
  return crc >>> 0;
}

const isCapture = (b, i) => i + 4 <= b.length && b[i] === CAPTURE[0] && b[i + 1] === CAPTURE[1] && b[i + 2] === CAPTURE[2] && b[i + 3] === CAPTURE[3];
const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
function setU32(b, i, v) { b[i] = v & 0xff; b[i + 1] = (v >>> 8) & 0xff; b[i + 2] = (v >>> 16) & 0xff; b[i + 3] = (v >>> 24) & 0xff; }
function getGranule(b, i) { const lo = u32(b, i), hi = u32(b, i + 4); return hi === 0xffffffff && lo === 0xffffffff ? -1n : (BigInt(hi) << 32n) | BigInt(lo); }
function setGranule(b, i, g) {
  const v = g < 0n ? 0xffffffffffffffffn : g;
  for (let k = 0; k < 8; k++) b[i + k] = Number((v >> BigInt(8 * k)) & 0xffn);
}

// 파일을 쪽 단위로 나눈다. 쪽 사이 찌꺼기는 건너뛰고(garbage), 끝이 잘린 쪽은 뺀다(truncated).
export function readPages(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const pages = [];
  let i = 0, garbage = 0, truncated = 0, badCrc = 0;
  while (i < b.length) {
    if (!isCapture(b, i)) {
      let j = i + 1;
      while (j < b.length && !isCapture(b, j)) j++;
      garbage += j - i; i = j; continue;
    }
    if (i + HEADER > b.length) { truncated += b.length - i; break; }
    const nseg = b[i + 26];
    if (i + HEADER + nseg > b.length) { truncated += b.length - i; break; }
    const lacing = b.subarray(i + HEADER, i + HEADER + nseg);
    let body = 0;
    for (const v of lacing) body += v;
    const end = i + HEADER + nseg + body;
    if (end > b.length) { truncated += b.length - i; break; }
    if (b[i + 4] !== 0) { garbage += 1; i += 1; continue; } // 판 번호가 0이 아니면 쪽이 아니다(우연히 'OggS'가 든 바이트)
    if (oggCrc(b, i, end) !== u32(b, i + 22)) badCrc++;
    pages.push({ start: i, end, flags: b[i + 5], granule: getGranule(b, i + 6), serial: u32(b, i + 14), seq: u32(b, i + 18), lacing: Array.from(lacing), bodyStart: i + HEADER + nseg });
    i = end;
  }
  return { pages, garbage, truncated, badCrc };
}

// 쪽들 → 소리 묶음(packet). 각 묶음이 끝나는 쪽 번호와 바이트 범위들.
function packetsOf(b, pages) {
  const out = [];
  let cur = null;
  pages.forEach((p, pi) => {
    let off = p.bodyStart, run = 0;
    for (const v of p.lacing) {
      if (!cur) cur = { parts: [], size: 0 };
      run += v;
      if (v < 255) {
        cur.parts.push([off, off + run]); cur.size += run; off += run; run = 0;
        cur.endPage = pi; out.push(cur); cur = null;
      }
    }
    if (run) { cur.parts.push([off, off + run]); cur.size += run; }
  });
  return { packets: out, open: !!cur };
}
function packetHead(b, pk, n) {
  const out = [];
  for (const [s, e] of pk.parts) for (let i = s; i < e && out.length < n; i++) out.push(b[i]);
  return out;
}

// Opus 묶음 하나가 내는 표본 수(48kHz). 첫 바이트(TOC)와 c=3일 때 둘째 바이트만 본다(RFC 6716 3.1·3.2). 읽을 수 없으면 0.
export function opusSamples(head) {
  if (!head?.length) return 0;
  const toc = head[0], config = toc >> 3, c = toc & 3;
  const size = config < 12 ? [480, 960, 1920, 2880][config & 3] : config < 16 ? [480, 960][config & 1] : [120, 240, 480, 960][config & 3];
  const frames = c === 0 ? 1 : c < 3 ? 2 : (head.length > 1 ? head[1] & 0x3f : 0);
  const total = size * frames;
  return total > 5760 ? 0 : total; // 한 묶음은 120ms(5760표본)까지
}

const ascii = (arr, n) => String.fromCharCode(...arr.slice(0, n));

/**
 * Ogg/Opus 파일을 규격대로 고친 새 바이트를 돌려준다.
 * 결과 kind: 'opus'(고침) | 'other'(Opus 한 줄기가 아님 — Vorbis·여러 줄기 등, 손대지 않고 원본 그대로) — 읽을 수 없는 파일은 throw('bad_format').
 * stats: 쪽·묶음 수, 길이(초), 고친 granule 수, 검사합 틀린 쪽 수, 뺀 바이트(찌꺼기·잘림). 소리 내용은 없다.
 */
export function normalizeOggOpus(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  const { pages, garbage, truncated, badCrc } = readPages(b);
  if (!pages.length || pages[0].start !== 0) throw new OggFail('bad_format');
  const serial = pages[0].serial;
  const { packets, open } = packetsOf(b, pages);
  const stats = { pages: pages.length, packets: packets.length, seconds: 0, first_granule_sec: null, fixed_granule: 0, bad_crc: badCrc, dropped_bytes: garbage + truncated, eos_added: false, kind: 'other' };
  if (!packets.length) throw new OggFail('bad_format');
  const head = packetHead(b, packets[0], 19);
  if (ascii(head, 8) !== 'OpusHead') {
    // Vorbis 등: 고칠 규칙이 없다. 'OggS'로 시작하면 원본 그대로 보낸다.
    return { bytes: b, stats };
  }
  if (pages.some(p => p.serial !== serial)) return { bytes: b, stats }; // 여러 줄기(이어 붙인 파일 등)는 손대지 않음
  if (packets.length < 2 || ascii(packetHead(b, packets[1], 8), 8) !== 'OpusTags') throw new OggFail('bad_format');
  if (head.length < 19 || head[8] < 1 || head[8] > 15) throw new OggFail('bad_format');
  const preSkip = head[10] | (head[11] << 8);
  stats.kind = 'opus';
  // 고치기 전 첫 소리 쪽의 granule(초). 안드로이드 녹음기 시계가 0에서 시작하지 않았는지 운영 로그로 보려고 남긴다(수만).
  const firstAudio = packets[2] ? pages[packets[2].endPage] : null;
  stats.first_granule_sec = firstAudio && firstAudio.granule >= 0n ? Math.round(Number(firstAudio.granule) / 48000) : null;

  // 쪽마다 그 쪽에서 끝나는 마지막 묶음까지의 누적 표본 수. 머리 두 묶음(OpusHead·OpusTags)은 0.
  const granules = pages.map(() => -1n);
  let total = 0n;
  packets.forEach((pk, k) => {
    if (k >= 2) total += BigInt(opusSamples(packetHead(b, pk, 2)));
    granules[pk.endPage] = k < 2 ? 0n : total;
  });
  // 끝나지 않은 마지막 묶음(파일 끝 잘림)만 든 꼬리 쪽은 뺀다.
  let keep = pages.length;
  if (open) { while (keep > 1 && granules[keep - 1] === -1n) keep--; }
  const kept = pages.slice(0, keep);
  const size = kept.reduce((s, p) => s + (p.end - p.start), 0);
  stats.dropped_bytes += pages.slice(keep).reduce((s, p) => s + (p.end - p.start), 0);
  const out = new Uint8Array(size);
  let at = 0;
  kept.forEach((p, i) => {
    out.set(b.subarray(p.start, p.end), at);
    const g = granules[i];
    if (g !== p.granule) stats.fixed_granule++;
    setGranule(out, at + 6, g);
    setU32(out, at + 18, i);                           // 쪽 번호 0부터 차례로
    let flags = out[at + 5] & 0x01;                    // 이어지는 묶음 표시만 남김
    if (i === 0) flags |= 0x02;                        // 처음
    if (i === kept.length - 1) flags |= 0x04;          // 끝
    out[at + 5] = flags;
    setU32(out, at + 22, oggCrc(out, at, at + (p.end - p.start)));
    at += p.end - p.start;
  });
  stats.eos_added = !(pages[keep - 1].flags & 0x04);
  stats.pages = kept.length;
  const last = granules[keep - 1] < 0n ? 0n : granules[keep - 1];
  stats.seconds = Math.max(0, Math.round(Number(last - BigInt(preSkip)) / 48000));
  return { bytes: out, stats };
}

export class OggFail extends Error {
  constructor(code) { super(code); this.code = code; }
}

// 전사 전에 고칠 파일인지(이름 확장자·형식). 큰 파일은 메모리에 담지 않으려 고치지 않는다(원본 그대로 흘려 보냄).
export const OGG_FIX_MAX_BYTES = 48 * 1024 * 1024; // 폰 59분 구간 ≈ 20MB(32kbps + 쪽 머리)
export function wantsOggFix(mime, fileName, size) {
  const m = String(mime || '').toLowerCase().split(';')[0].trim();
  const ext = String(fileName || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
  const ogg = m === 'audio/ogg' || m === 'audio/opus' || m === 'application/ogg' || ['ogg', 'oga', 'opus'].includes(ext);
  return ogg && Number(size) > 0 && Number(size) <= OGG_FIX_MAX_BYTES;
}
