// REC-긴녹음나눠전사(S60-7): 긴 소리를 시간 구간으로 나눠 따로 전사하기 위한 순수 규칙. Node 시험·Deno 배포 양쪽에서 읽는다.
// 왜: 전사 모델(gemini-3.5-transcribe)은 한 번 답의 출력이 32,768토큰까지라, 11/12 41분 녹음이 63,381자에서 잘렸다(status incomplete,
//   out_tokens 32768). 요청에 구간(시작·끝 시각)을 지정하는 칸은 없다(공식 전사 안내: transcription_config = language_codes·custom_vocabulary·mode)
//   → 파일을 잘라 조각마다 따로 올린다. 소리는 풀지 않고(다시 인코딩 없음) 묶음·블록·표본을 그대로 옮겨 새 파일로 짠다.
// 형식별:
//   - Ogg/Opus(폰 녹음, 크롬 밖 [녹음]): ogg.mjs sliceOggOpus — 소리 묶음 단위.
//   - WebM/Matroska(노트북 크롬 [녹음]): 클러스터 단위. 머리(EBML·Info·Tracks)를 앞에 붙이고 클러스터 시각을 0부터로 고친다.
//   - MP4/M4A: 조각난 mp4(moof, 사파리 [녹음])는 moof+mdat 단위, 보통 m4a(삼성 음성 녹음 등)는 표본 표(stbl)를 새로 짜 한 파일로.
//   - 그 밖(mp3·wav·aac·amr·Vorbis·여러 트랙 등)은 '나눌 수 없음'(null) — 지금처럼 통째로 보낸다(30분 넘는 글이 길면 잘릴 수 있음).
import { oggOpusIndex, sliceOggOpus } from './ogg.mjs';

// 한 조각 길이. 근거(PR 본문): 11/12 실패 답 = 63,381자 / 32,768토큰 = 1토큰 1.93자. 41분을 다 옮기지 못하고 끊겼으니 그 녹음은
// 분당 1,546자(800토큰) 넘게 나온 셈이다(보통 한국어 회의 말은 분당 400~600자). 15분이면 분당 2,180토큰(4,200자, 그 녹음 하한의 2.7배)까지
// 출력 상한 안이다. 그래도 잘리면 그 조각만 반으로 다시 나눈다(MIN_CHUNK_SECONDS까지).
export const CHUNK_SECONDS = 15 * 60;
export const MIN_CHUNK_SECONDS = 4 * 60;
// 나누려면 파일을 메모리에 담아야 한다. 이보다 크면 지금처럼 흘려 보낸다(나누지 않음). 크롬 [녹음] 128kbps면 약 70분.
export const SPLIT_MAX_BYTES = 64 * 1024 * 1024;

// ---- 구간 계산 ----
// 길이(초) → 고른 길이의 구간들. 마지막 구간은 to=null(파일 끝까지). CHUNK_SECONDS 이하면 [](나누지 않음).
export function chunkRanges(seconds, chunk = CHUNK_SECONDS) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= chunk) return [];
  const n = Math.ceil(s / chunk), len = s / n;
  return Array.from({ length: n }, (_, i) => ({
    from: Math.round(i * len), to: i === n - 1 ? null : Math.round((i + 1) * len),
    seconds: i === n - 1 ? Math.max(1, Math.round(s - Math.round(i * len))) : Math.round((i + 1) * len) - Math.round(i * len),
  }));
}
// 잘린 조각(또는 통째)을 반으로. range가 없으면 [0, total). 너무 짧으면(MIN_CHUNK_SECONDS × 2 미만) [].
export function halveRange(range, total) {
  const from = Number(range?.from) || 0;
  const end = range && range.to !== null && range.to !== undefined ? Number(range.to) : Number(total);
  if (!Number.isFinite(end) || end - from < MIN_CHUNK_SECONDS * 2) return [];
  const mid = Math.round((from + end) / 2);
  const last = !range || range.to === null || range.to === undefined;
  return [
    { from, to: mid, seconds: mid - from },
    { from: mid, to: last ? null : end, seconds: Math.max(1, Math.round(end - mid)) },
  ];
}
// 구간 모양 검사(parts jsonb에서 읽은 값). 맞으면 {from,to}, 아니면 null.
export function readRange(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const from = Number(r.from);
  if (!Number.isSafeInteger(from) || from < 0 || from > 36000) return null;
  if (r.to === null || r.to === undefined) return { from, to: null };
  const to = Number(r.to);
  if (!Number.isSafeInteger(to) || to <= from || to > 36000) return null;
  return { from, to };
}

// ---- 형식 고르기 ----
const kindOf = (mime, name) => {
  const m = String(mime || '').toLowerCase().split(';')[0].trim();
  const ext = (String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
  if (m === 'audio/ogg' || m === 'audio/opus' || m === 'application/ogg' || ['ogg', 'oga', 'opus'].includes(ext)) return 'ogg';
  if (m === 'audio/webm' || m === 'video/webm' || m === 'audio/x-matroska' || ext === 'webm' || ext === 'mka') return 'webm';
  if (m === 'audio/mp4' || m === 'video/mp4' || m === 'audio/x-m4a' || m === 'audio/m4a' || ['m4a', 'mp4'].includes(ext)) return 'mp4';
  return '';
};
const magic = (b) => {
  if (b.length >= 4 && b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return 'ogg';
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm';
  if (b.length >= 8 && String.fromCharCode(b[4], b[5], b[6], b[7]) === 'ftyp') return 'mp4';
  return '';
};

/**
 * 소리 파일을 열어 길이와 자르기 함수를 돌려준다. 나눌 수 없으면 null.
 * 결과: { kind: 'ogg'|'webm'|'mp4', seconds, slice(from, to|null) → Uint8Array|null }. 이름·형식보다 파일 첫 바이트를 믿는다.
 */
export function openAudio(input, mime, name) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  const kind = magic(b) || kindOf(mime, name);
  try {
    if (kind === 'ogg') {
      const idx = oggOpusIndex(b);
      return idx ? { kind, seconds: idx.seconds, slice: (f, t) => sliceOggOpus(idx, f, t) } : null;
    }
    if (kind === 'webm') {
      const idx = webmIndex(b);
      return idx ? { kind, seconds: idx.seconds, slice: (f, t) => sliceWebm(idx, f, t) } : null;
    }
    if (kind === 'mp4') {
      const idx = mp4Index(b);
      return idx ? { kind, seconds: idx.seconds, slice: (f, t) => sliceMp4(idx, f, t) } : null;
    }
  } catch { return null; }
  return null;
}

// =====================================================================================
// WebM / Matroska(EBML). 크롬 MediaRecorder: Segment·Cluster 크기 '모름', Cues 없음, SimpleBlock, TimecodeScale 1ms.
// =====================================================================================
const ID = Object.freeze({
  EBML: 0x1a45dfa3, Segment: 0x18538067, SeekHead: 0x114d9b74, Info: 0x1549a966, Tracks: 0x1654ae6b, Cluster: 0x1f43b675,
  Cues: 0x1c53bb6b, Tags: 0x1254c367, Chapters: 0x1043a770, Attachments: 0x1941a469, Void: 0xec, Crc: 0xbf,
  TimecodeScale: 0x2ad7b1, Duration: 0x4489, Timecode: 0xe7, SimpleBlock: 0xa3, BlockGroup: 0xa0, Block: 0xa1, BlockDuration: 0x9b,
  Position: 0xa7, PrevSize: 0xab, SilentTracks: 0x5854, EncryptedBlock: 0xaf, TrackEntry: 0xae,
});
const CLUSTER_CHILD = new Set([ID.Timecode, ID.SimpleBlock, ID.BlockGroup, ID.Position, ID.PrevSize, ID.SilentTracks, ID.EncryptedBlock, ID.Void, ID.Crc]);
const SEGMENT_CHILD = new Set([ID.SeekHead, ID.Info, ID.Tracks, ID.Cluster, ID.Cues, ID.Tags, ID.Chapters, ID.Attachments, ID.Void, ID.Crc]);

function readId(b, i) {
  const first = b[i];
  if (first === undefined || first === 0) return null;
  let len = 1;
  while (len <= 4 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 4 || i + len > b.length) return null;
  let v = 0;
  for (let k = 0; k < len; k++) v = v * 256 + b[i + k];
  return { id: v, len };
}
function readSize(b, i) {
  const first = b[i];
  if (first === undefined || first === 0) return null;
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8 || i + len > b.length) return null;
  let v = first & (0xff >> len);
  let allOnes = v === (0xff >> len);
  for (let k = 1; k < len; k++) { v = v * 256 + b[i + k]; if (b[i + k] !== 0xff) allOnes = false; }
  return { size: allOnes ? -1 : v, len };
}
function readUint(b, s, e) { let v = 0; for (let i = s; i < e; i++) v = v * 256 + b[i]; return v; }
function element(b, i) {
  const id = readId(b, i);
  if (!id) return null;
  const sz = readSize(b, i + id.len);
  if (!sz) return null;
  const dataStart = i + id.len + sz.len;
  const end = sz.size < 0 ? -1 : dataStart + sz.size;
  if (end > b.length) return null;
  return { id: id.id, start: i, dataStart, end };
}
const idBytes = (id) => { const out = []; let v = id; while (v > 0) { out.unshift(v & 0xff); v = Math.floor(v / 256); } return out; };
const sizeBytes8 = (n) => { const out = [0x01]; for (let k = 6; k >= 0; k--) out.push(Math.floor(n / 2 ** (8 * k)) & 0xff); return out; };
const uintBytes = (n) => { const out = []; let v = Math.max(0, Math.floor(n)); do { out.unshift(v & 0xff); v = Math.floor(v / 256); } while (v > 0); return out; };
const concat = (list) => {
  const total = list.reduce((s, x) => s + x.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const x of list) { out.set(x, at); at += x.length; }
  return out;
};

// 클러스터 하나의 끝(크기 모름이면 다음 클러스터·세그먼트 단 요소가 나올 때까지)과 그 안의 시각·블록 끝 시각.
function readCluster(b, el) {
  let i = el.dataStart, timecode = null, maxRel = 0;
  const children = [];
  const limit = el.end < 0 ? b.length : el.end;
  while (i < limit) {
    const c = element(b, i);
    if (!c || c.end < 0) { if (el.end < 0) break; return null; }
    if (el.end < 0 && !CLUSTER_CHILD.has(c.id)) break;
    if (c.id === ID.Timecode) timecode = readUint(b, c.dataStart, c.end);
    if (c.id === ID.SimpleBlock || c.id === ID.BlockGroup) {
      let blk = c;
      if (c.id === ID.BlockGroup) {
        let j = c.dataStart; blk = null;
        while (j < c.end) { const g = element(b, j); if (!g || g.end < 0) break; if (g.id === ID.Block) { blk = g; break; } j = g.end; }
      }
      if (blk) {
        const track = readSize(b, blk.dataStart);
        if (track) {
          const at = blk.dataStart + track.len;
          if (at + 2 <= blk.end) { let rel = (b[at] << 8) | b[at + 1]; if (rel & 0x8000) rel -= 0x10000; if (rel > maxRel) maxRel = rel; }
        }
      }
    }
    children.push(c);
    i = c.end;
  }
  if (timecode === null) return null;
  return { start: el.start, end: i, timecode, maxRel, children };
}

/** WebM 파일 → 머리(EBML 머리·Info·Tracks)와 클러스터 목록. 나눌 수 없으면 null. */
export function webmIndex(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  const ebml = element(b, 0);
  if (!ebml || ebml.id !== ID.EBML || ebml.end < 0) return null;
  const seg = element(b, ebml.end);
  if (!seg || seg.id !== ID.Segment) return null;
  const segEnd = seg.end < 0 ? b.length : seg.end;
  let i = seg.dataStart, info = null, tracks = null, scale = 1000000;
  const clusters = [];
  while (i < segEnd) {
    const el = element(b, i);
    if (!el) break; // 끝이 잘린 꼬리
    if (!SEGMENT_CHILD.has(el.id)) {
      if (el.id === ID.EBML) return null; // 한 파일에 줄기가 둘(이어 붙인 녹음) — 나누지 않는다
      if (el.end < 0) break;
      i = el.end; continue;
    }
    if (el.id === ID.Cluster) {
      const c = readCluster(b, el);
      if (!c) break;
      clusters.push(c);
      i = c.end; continue;
    }
    if (el.end < 0) return null;
    if (el.id === ID.Info) {
      info = el;
      let j = el.dataStart;
      while (j < el.end) { const c = element(b, j); if (!c || c.end < 0) return null; if (c.id === ID.TimecodeScale) scale = readUint(b, c.dataStart, c.end) || 1000000; j = c.end; }
    }
    if (el.id === ID.Tracks) {
      if (tracks) return null;
      tracks = el;
      let n = 0, j = el.dataStart;
      while (j < el.end) { const c = element(b, j); if (!c || c.end < 0) return null; if (c.id === ID.TrackEntry) n++; j = c.end; }
      if (n !== 1) return null; // 소리 한 트랙만
    }
    i = el.end;
  }
  if (!tracks || !clusters.length) return null;
  const tickSec = scale / 1e9;
  const first = clusters[0].timecode;
  const last = clusters[clusters.length - 1];
  const seconds = (last.timecode - first + last.maxRel) * tickSec + 0.02;
  return { bytes: b, ebml, info, tracks, clusters, tickSec, first, seconds };
}

// Info에서 Duration(전체 길이)을 뺀 새 Info(조각 길이와 어긋나지 않게).
function infoWithoutDuration(b, info) {
  if (!info) return new Uint8Array(0);
  const kids = [];
  let j = info.dataStart;
  while (j < info.end) { const c = element(b, j); if (!c || c.end < 0) break; if (c.id !== ID.Duration) kids.push(b.subarray(c.start, c.end)); j = c.end; }
  const body = concat(kids);
  return concat([Uint8Array.from(idBytes(ID.Info)), Uint8Array.from(sizeBytes8(body.length)), body]);
}

/** [from, to)초에 시작하는 클러스터만 담은 새 WebM. 클러스터 시각은 조각 처음이 0이 되게 고친다. 고른 것이 없으면 null. */
export function sliceWebm(index, from, to) {
  if (!index) return null;
  const { bytes: b, clusters, tickSec, first } = index;
  const start = Number(from) || 0, end = to === null || to === undefined ? Infinity : Number(to);
  const picked = clusters.filter((c) => { const t = (c.timecode - first) * tickSec; return t >= start && t < end; });
  if (!picked.length) return null;
  const base = picked[0].timecode;
  const parts = [b.subarray(index.ebml.start, index.ebml.end)];
  const segBody = [infoWithoutDuration(b, index.info), b.subarray(index.tracks.start, index.tracks.end)];
  for (const c of picked) {
    const kids = c.children.map((k) => (k.id === ID.Timecode
      ? Uint8Array.from([ID.Timecode, ...(() => { const v = uintBytes(c.timecode - base); return [0x80 | v.length, ...v]; })()])
      : b.subarray(k.start, k.end)));
    const body = concat(kids);
    segBody.push(Uint8Array.from(idBytes(ID.Cluster)), Uint8Array.from(sizeBytes8(body.length)), body);
  }
  const seg = concat(segBody);
  parts.push(Uint8Array.from(idBytes(ID.Segment)), Uint8Array.from(sizeBytes8(seg.length)), seg);
  return concat(parts);
}

// =====================================================================================
// MP4 / M4A(ISO BMFF). 소리 트랙 하나만.
// =====================================================================================
const u32 = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const u64 = (b, i) => u32(b, i) * 2 ** 32 + u32(b, i + 4);
const type4 = (b, i) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
function boxes(b, s, e) {
  const out = [];
  let i = s;
  while (i + 8 <= e) {
    let size = u32(b, i), head = 8;
    const type = type4(b, i + 4);
    if (size === 1) { if (i + 16 > e) return null; size = u64(b, i + 8); head = 16; }
    else if (size === 0) size = e - i;
    if (size < head || i + size > e) return null;
    out.push({ type, start: i, dataStart: i + head, end: i + size });
    i += size;
  }
  return out;
}
const child = (b, box, type) => (boxes(b, box.dataStart, box.end) || []).find((x) => x.type === type) || null;
const path = (b, box, ...types) => { let cur = box; for (const t of types) { cur = cur && child(b, cur, t); } return cur; };
const w32 = (out, i, v) => { out[i] = (v >>> 24) & 255; out[i + 1] = (v >>> 16) & 255; out[i + 2] = (v >>> 8) & 255; out[i + 3] = v & 255; };
const w64 = (out, i, v) => { w32(out, i, Math.floor(v / 2 ** 32)); w32(out, i + 4, v % 2 ** 32); };
const box = (type, ...bodies) => {
  const body = concat(bodies);
  const out = new Uint8Array(8 + body.length);
  w32(out, 0, out.length); for (let k = 0; k < 4; k++) out[4 + k] = type.charCodeAt(k);
  out.set(body, 8);
  return out;
};
const fullBox = (type, version, flags, body) => { const h = new Uint8Array(4); h[0] = version; h[1] = (flags >> 16) & 255; h[2] = (flags >> 8) & 255; h[3] = flags & 255; return box(type, h, body); };
// mvhd·tkhd·mdhd의 duration 칸 자리(버전별).
const durationAt = (b, x) => {
  const v = b[x.dataStart];
  if (x.type === 'tkhd') return v === 1 ? { at: x.dataStart + 4 + 24, wide: true } : { at: x.dataStart + 4 + 16, wide: false };
  return v === 1 ? { at: x.dataStart + 4 + 20, wide: true } : { at: x.dataStart + 4 + 12, wide: false };
};
const timescaleOf = (b, x) => u32(b, x.dataStart + 4 + (b[x.dataStart] === 1 ? 16 : 8));
function withDuration(b, x, value) {
  const out = b.slice(x.start, x.end);
  const d = durationAt(b, x), at = d.at - x.start;
  if (d.wide) w64(out, at, value); else w32(out, at, Math.min(value, 0xffffffff));
  return out;
}

/** MP4/M4A → 표본(조각난 파일은 moof 조각) 목록. 소리 트랙이 하나가 아니거나 읽을 수 없으면 null. */
export function mp4Index(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  const top = boxes(b, 0, b.length);
  if (!top || !top.length || top[0].type !== 'ftyp') return null;
  const ftyp = top[0];
  const moov = top.find((x) => x.type === 'moov');
  if (!moov) return null;
  const traks = (boxes(b, moov.dataStart, moov.end) || []).filter((x) => x.type === 'trak');
  if (traks.length !== 1) return null;
  const trak = traks[0];
  const mdhd = path(b, trak, 'mdia', 'mdhd'), hdlr = path(b, trak, 'mdia', 'hdlr');
  if (!mdhd || !hdlr || type4(b, hdlr.dataStart + 8) !== 'soun') return null;
  const timescale = timescaleOf(b, mdhd);
  if (!timescale) return null;
  const moofs = top.filter((x) => x.type === 'moof');
  if (moofs.length) return fragmentedIndex(b, top, ftyp, moov, timescale);
  return plainIndex(b, ftyp, moov, trak, timescale);
}

// 조각난 mp4: [moof, mdat] 쌍. 시각은 tfdt, 길이는 trun 표본 길이(없으면 tfhd·trex 기본값).
function fragmentedIndex(b, top, ftyp, moov, timescale) {
  const trex = path(b, moov, 'mvex', 'trex');
  const trexDur = trex ? u32(b, trex.dataStart + 12) : 0;
  const frags = [];
  for (let k = 0; k < top.length; k++) {
    const m = top[k];
    if (m.type !== 'moof') continue;
    const mdat = top[k + 1];
    if (!mdat || mdat.type !== 'mdat') return null;
    const traf = child(b, m, 'traf');
    const tfhd = traf && child(b, traf, 'tfhd'), tfdt = traf && child(b, traf, 'tfdt');
    if (!tfhd || !tfdt) return null;
    const tfFlags = (b[tfhd.dataStart + 1] << 16) | (b[tfhd.dataStart + 2] << 8) | b[tfhd.dataStart + 3];
    if (tfFlags & 0x01) return null; // 파일 기준 절대 위치(base-data-offset)는 자르면 어긋난다
    let p = tfhd.dataStart + 8, defDur = trexDur;
    if (tfFlags & 0x02) p += 4;
    if (tfFlags & 0x08) defDur = u32(b, p);
    const ver = b[tfdt.dataStart];
    const t = ver === 1 ? u64(b, tfdt.dataStart + 4) : u32(b, tfdt.dataStart + 4);
    let dur = 0;
    for (const tr of (boxes(b, traf.dataStart, traf.end) || []).filter((x) => x.type === 'trun')) {
      const fl = (b[tr.dataStart + 1] << 16) | (b[tr.dataStart + 2] << 8) | b[tr.dataStart + 3];
      const count = u32(b, tr.dataStart + 4);
      let q = tr.dataStart + 8;
      if (fl & 0x01) q += 4;
      if (fl & 0x04) q += 4;
      const per = ((fl & 0x100) ? 4 : 0) + ((fl & 0x200) ? 4 : 0) + ((fl & 0x400) ? 4 : 0) + ((fl & 0x800) ? 4 : 0);
      if (fl & 0x100) { for (let s = 0; s < count; s++) dur += u32(b, q + s * per); } else dur += defDur * count;
    }
    frags.push({ moof: m, mdat, tfdt, time: t, dur });
  }
  if (!frags.length) return null;
  const t0 = frags[0].time, lastF = frags[frags.length - 1];
  return { kind: 'fragmented', bytes: b, ftyp, moov, timescale, frags, t0, seconds: (lastF.time - t0 + lastF.dur) / timescale };
}

// 보통 m4a: stts·stsc·stsz·stco(co64)로 표본마다 위치·크기·길이를 푼다.
function plainIndex(b, ftyp, moov, trak, timescale) {
  const stbl = path(b, trak, 'mdia', 'minf', 'stbl');
  if (!stbl) return null;
  const kids = boxes(b, stbl.dataStart, stbl.end) || [];
  const get = (t) => kids.find((x) => x.type === t) || null;
  const stsd = get('stsd'), stts = get('stts'), stsc = get('stsc'), stsz = get('stsz'), stco = get('stco') || get('co64');
  if (!stsd || !stts || !stsc || !stsz || !stco || get('ctts')) return null; // stz2·ctts(순서 바뀐 표본)는 다루지 않음
  const count = u32(b, stsz.dataStart + 8), fixed = u32(b, stsz.dataStart + 4);
  if (!count || count > 2_000_000) return null;
  const sizes = new Uint32Array(count);
  for (let s = 0; s < count; s++) sizes[s] = fixed || u32(b, stsz.dataStart + 12 + 4 * s);
  const durs = new Uint32Array(count);
  { let s = 0; const n = u32(b, stts.dataStart + 4); for (let e = 0; e < n && s < count; e++) { const c = u32(b, stts.dataStart + 8 + 8 * e), d = u32(b, stts.dataStart + 12 + 8 * e); for (let k = 0; k < c && s < count; k++) durs[s++] = d; } if (s !== count) return null; }
  const wide = stco.type === 'co64';
  const chunks = u32(b, stco.dataStart + 4);
  const chunkOff = (c) => (wide ? u64(b, stco.dataStart + 8 + 8 * c) : u32(b, stco.dataStart + 8 + 4 * c));
  const offsets = new Float64Array(count);
  {
    const n = u32(b, stsc.dataStart + 4);
    const rows = Array.from({ length: n }, (_, e) => ({ first: u32(b, stsc.dataStart + 8 + 12 * e) - 1, per: u32(b, stsc.dataStart + 12 + 12 * e) }));
    let s = 0;
    for (let e = 0; e < rows.length; e++) {
      const endChunk = e + 1 < rows.length ? rows[e + 1].first : chunks;
      for (let c = rows[e].first; c < endChunk && s < count; c++) {
        let off = chunkOff(c);
        for (let k = 0; k < rows[e].per && s < count; k++) { offsets[s] = off; off += sizes[s]; s++; }
      }
    }
    if (s !== count) return null;
  }
  for (let s = 0; s < count; s++) if (offsets[s] + sizes[s] > b.length) return null;
  const starts = new Float64Array(count);
  let t = 0;
  for (let s = 0; s < count; s++) { starts[s] = t; t += durs[s]; }
  return { kind: 'plain', bytes: b, ftyp, moov, trak, stsd, timescale, sizes, durs, offsets, starts, seconds: t / timescale };
}

/** [from, to)초에 시작하는 표본(조각)만 담은 새 MP4. 고른 것이 없으면 null. */
export function sliceMp4(index, from, to) {
  if (!index) return null;
  const a = (Number(from) || 0), z = to === null || to === undefined ? Infinity : Number(to);
  const b = index.bytes;
  if (index.kind === 'fragmented') {
    const picked = index.frags.filter((f) => { const t = (f.time - index.t0) / index.timescale; return t >= a && t < z; });
    if (!picked.length) return null;
    const base = picked[0].time;
    const out = [b.subarray(index.ftyp.start, index.ftyp.end), b.subarray(index.moov.start, index.moov.end)];
    for (const f of picked) {
      const moof = b.slice(f.moof.start, f.moof.end);
      const at = f.tfdt.dataStart - f.moof.start;
      if (moof[at] === 1) w64(moof, at + 4, f.time - base); else w32(moof, at + 4, f.time - base);
      out.push(moof, b.subarray(f.mdat.start, f.mdat.end));
    }
    return concat(out);
  }
  const ts = index.timescale;
  let s0 = -1, s1 = -1;
  for (let s = 0; s < index.starts.length; s++) {
    const t = index.starts[s] / ts;
    if (t >= a && t < z) { if (s0 < 0) s0 = s; s1 = s; }
  }
  if (s0 < 0) return null;
  const n = s1 - s0 + 1;
  let dataLen = 0, dur = 0;
  for (let s = s0; s <= s1; s++) { dataLen += index.sizes[s]; dur += index.durs[s]; }
  // stts: 같은 길이끼리 묶음
  const runs = [];
  for (let s = s0; s <= s1; s++) { const d = index.durs[s]; const r = runs[runs.length - 1]; if (r && r[1] === d) r[0]++; else runs.push([1, d]); }
  const sttsBody = new Uint8Array(4 + 8 * runs.length); w32(sttsBody, 0, runs.length); runs.forEach(([c, d], k) => { w32(sttsBody, 4 + 8 * k, c); w32(sttsBody, 8 + 8 * k, d); });
  const stscBody = new Uint8Array(4 + 12); w32(stscBody, 0, 1); w32(stscBody, 4, 1); w32(stscBody, 8, n); w32(stscBody, 12, 1);
  const stszBody = new Uint8Array(8 + 4 * n); w32(stszBody, 0, 0); w32(stszBody, 4, n); for (let k = 0; k < n; k++) w32(stszBody, 8 + 4 * k, index.sizes[s0 + k]);
  const co64Body = new Uint8Array(4 + 8); w32(co64Body, 0, 1); // 위치는 아래에서 채움
  const co64 = fullBox('co64', 0, 0, co64Body);
  const stbl = box('stbl', b.subarray(index.stsd.start, index.stsd.end), fullBox('stts', 0, 0, sttsBody), fullBox('stsc', 0, 0, stscBody), fullBox('stsz', 0, 0, stszBody), co64);
  const trak = index.trak;
  const mdia = child(b, trak, 'mdia'), minf = child(b, mdia, 'minf');
  const minfKids = (boxes(b, minf.dataStart, minf.end) || []).filter((x) => x.type !== 'stbl').map((x) => b.subarray(x.start, x.end));
  const mdiaKids = (boxes(b, mdia.dataStart, mdia.end) || []).filter((x) => x.type !== 'minf').map((x) => (x.type === 'mdhd' ? withDuration(b, x, dur) : b.subarray(x.start, x.end)));
  const mvhd = child(b, index.moov, 'mvhd');
  if (!mvhd) return null;
  const movieDur = Math.round(dur * timescaleOf(b, mvhd) / ts);
  const tkhd = child(b, trak, 'tkhd');
  if (!tkhd) return null;
  // edts(편집 목록)·udta·meta는 뺀다(전체 길이 기준이라 조각과 어긋난다).
  const newTrak = box('trak', withDuration(b, tkhd, movieDur), box('mdia', ...mdiaKids, box('minf', ...minfKids, stbl)));
  const moov = box('moov', withDuration(b, mvhd, movieDur), newTrak);
  const ftyp = b.subarray(index.ftyp.start, index.ftyp.end);
  const mdatHead = new Uint8Array(16); w32(mdatHead, 0, 1); mdatHead.set([0x6d, 0x64, 0x61, 0x74], 4); w64(mdatHead, 8, 16 + dataLen);
  const dataAt = ftyp.length + moov.length + 16;
  // co64 칸(moov 안 마지막 8바이트)에 표본 시작 위치를 쓴다.
  w64(moov, moov.length - 8, dataAt);
  const out = new Uint8Array(dataAt + dataLen);
  out.set(ftyp, 0); out.set(moov, ftyp.length); out.set(mdatHead, ftyp.length + moov.length);
  let at = dataAt;
  for (let s = s0; s <= s1; s++) { out.set(b.subarray(index.offsets[s], index.offsets[s] + index.sizes[s]), at); at += index.sizes[s]; }
  return out;
}
