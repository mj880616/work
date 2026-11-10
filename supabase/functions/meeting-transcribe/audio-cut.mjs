// REC-정리멈춤반복-긴구간(S56-47, 설계 docs/design/meeting-transcript-server.md 9절): 긴 녹음 구간을 약 15분 조각으로 자른다.
// 소리는 풀지 않는다. 그릇(container)의 단위만 본다: Ogg 쪽(page) · WebM Cluster · fMP4 moof+mdat.
// 조각 = (머리) + 단위 묶음. 자를 수 없는 파일은 null(부른 쪽이 통째로 한 번 전사). Node 시험·Deno 배포 양쪽에서 읽는다.
import { readPages } from './ogg.mjs';

export const CHUNK_SECONDS = 15 * 60;           // 조각 하나 길이(전사 한 번이 Edge 실행 시간 안에 넉넉히 끝나는 길이)
export const CUT_OVER_SECONDS = 20 * 60;        // 이보다 긴 구간만 나눈다(짧은 구간은 지금처럼 한 번, 화자 구분 유지)
export const CHUNK_BYTES = 4 * 1024 * 1024;     // 길이를 모를 때: 32kbps 녹음 15분 ≈ 3.6MB + 머리
export const MAX_CHUNKS = 8;                    // 59분 구간 = 4조각. 100MB 파일도 이 안에서 끝낸다.

// 이 구간을 몇 조각으로 나눌지(1 = 나누지 않음). seconds: 구간 길이(모르면 0), size: 바이트.
export function chunkCount(seconds, size) {
  const s = Number(seconds) || 0, b = Number(size) || 0;
  const bySec = s > CUT_OVER_SECONDS ? Math.ceil(s / CHUNK_SECONDS) : 1;
  const byBytes = b > CHUNK_BYTES * (CUT_OVER_SECONDS / CHUNK_SECONDS) ? Math.ceil(b / CHUNK_BYTES) : 1;
  return Math.max(1, Math.min(MAX_CHUNKS, Math.max(bySec, byBytes)));
}

const at = (b, i, arr) => arr.every((v, k) => b[i + k] === v);

// ---- Ogg/Opus: 머리 쪽(OpusHead·OpusTags) 뒤 소리 쪽. 묶음이 앞 쪽에서 이어지는 쪽(flags&1)에서는 자르지 않는다.
// 여러 줄기(이어 붙인 파일)는 줄기 시작(BOS) 쪽에서만 자르고 머리를 붙이지 않는다(줄기마다 제 머리가 있음).
function oggPlan(b) {
  const { pages } = readPages(b);
  if (!pages.length || pages[0].start !== 0) return null;
  const serials = new Set(pages.map((p) => p.serial));
  if (serials.size > 1) {
    const starts = pages.filter((p) => p.flags & 0x02).map((p) => p.start);
    if (starts[0] !== 0 || starts.length < 2) return null;
    return { headEnd: 0, starts, end: pages[pages.length - 1].end };
  }
  // 머리 = 첫 소리 묶음이 시작하기 전까지의 쪽. OpusTags가 여러 쪽일 수 있어 granule 0인 앞쪽 쪽들을 머리로 본다.
  let h = 0;
  while (h < pages.length && pages[h].granule === 0n) h++;
  if (h < 2) return null; // OpusHead 쪽 + OpusTags 쪽(규격상 각자 새 쪽에서 시작)
  const audio = pages.slice(h);
  if (audio.length < 2) return null;
  const starts = audio.filter((p) => !(p.flags & 0x01)).map((p) => p.start);
  if (starts[0] !== audio[0].start) return null;
  return { headEnd: audio[0].start, starts, end: pages[pages.length - 1].end };
}

// ---- EBML(WebM) 읽기: 크기를 모르는(live) Segment·Cluster도 다룬다.
const EBML_ID = 0x1a45dfa3, SEGMENT = 0x18538067, CLUSTER = 0x1f43b675;
const LEVEL1 = new Set([0x114d9b74, 0x1549a966, 0x1654ae6b, CLUSTER, 0x1c53bb6b, 0x1941a469, 0x1043a770, 0x1254c367, EBML_ID]);
function readId(b, i) {
  const f = b[i];
  if (f === undefined || f === 0) return null;
  const len = f >= 0x80 ? 1 : f >= 0x40 ? 2 : f >= 0x20 ? 3 : f >= 0x10 ? 4 : 0;
  if (!len || i + len > b.length) return null;
  let v = 0;
  for (let k = 0; k < len; k++) v = v * 256 + b[i + k];
  return { id: v, len };
}
function readSize(b, i) {
  const f = b[i];
  if (f === undefined || f === 0) return null;
  let len = 1;
  while (len <= 8 && !(f & (0x80 >> (len - 1)))) len++;
  if (len > 8 || i + len > b.length) return null;
  let v = f & (0xff >> len), unknown = v === (0xff >> len);
  for (let k = 1; k < len; k++) { v = v * 256 + b[i + k]; if (b[i + k] !== 0xff) unknown = false; }
  return { size: unknown ? -1 : v, len };
}
function webmPlan(b) {
  if (!at(b, 0, [0x1a, 0x45, 0xdf, 0xa3])) return null;
  const hdr = readSize(b, 4);
  if (!hdr || hdr.size < 0) return null;
  let i = 4 + hdr.len + hdr.size;
  const seg = readId(b, i);
  if (!seg || seg.id !== SEGMENT) return null;
  const segSize = readSize(b, i + seg.len);
  if (!segSize) return null;
  i += seg.len + segSize.len;
  const end = segSize.size < 0 ? b.length : Math.min(b.length, i + segSize.size);
  const starts = [];
  while (i < end) {
    const el = readId(b, i);
    if (!el) break;
    const sz = readSize(b, i + el.len);
    if (!sz) break;
    if (el.id === EBML_ID) return null; // 또 다른 줄기가 이어 붙음: 자르지 않는다
    const body = i + el.len + sz.len;
    if (el.id === CLUSTER) {
      starts.push(i);
      if (sz.size >= 0) { i = body + sz.size; continue; }
      // 크기를 모르는 Cluster: 자식을 하나씩 건너 다음 1단계 요소까지.
      let j = body;
      for (;;) {
        const c = readId(b, j);
        if (!c || LEVEL1.has(c.id)) break;
        const cs = readSize(b, j + c.len);
        if (!cs || cs.size < 0) return null;
        const next = j + c.len + cs.len + cs.size;
        if (next > b.length) { j = b.length; break; }
        j = next;
      }
      i = j;
      continue;
    }
    if (starts.length) { if (sz.size < 0) break; i = body + sz.size; continue; } // Cues·Tags 등(뒤쪽): 마지막 조각에 남음
    if (sz.size < 0) return null;
    i = body + sz.size;
  }
  if (starts.length < 2) return null;
  return { headEnd: starts[0], starts, end: b.length };
}

// ---- fMP4(MediaRecorder audio/mp4): 머리(ftyp·moov) 뒤 moof(+앞의 styp)·mdat 묶음. moof가 없는(보통 m4a) 파일은 자르지 않는다.
const u32 = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const type4 = (b, i) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
function mp4Plan(b) {
  if (b.length < 8 || type4(b, 4) !== 'ftyp') return null;
  const boxes = [];
  let i = 0;
  while (i + 8 <= b.length) {
    let size = u32(b, i);
    const type = type4(b, i + 4);
    if (size === 1) {
      if (i + 16 > b.length) break;
      size = u32(b, i + 8) * 2 ** 32 + u32(b, i + 12);
    } else if (size === 0) size = b.length - i;
    if (size < 8) return null;
    boxes.push({ type, start: i });
    i += size;
  }
  if (boxes.filter((x) => x.type === 'moov').length !== 1 || boxes.filter((x) => x.type === 'ftyp').length !== 1) return null;
  const starts = [];
  boxes.forEach((x, k) => {
    if (x.type !== 'moof') return;
    const prev = boxes[k - 1];
    starts.push(prev && prev.type === 'styp' ? prev.start : x.start);
  });
  if (starts.length < 2) return null;
  const moov = boxes.find((x) => x.type === 'moov');
  if (moov.start > starts[0]) return null;
  return { headEnd: starts[0], starts, end: Math.min(i, b.length) };
}

// 자를 계획: {headEnd, starts:[단위 시작 바이트…], end} 또는 null.
export function cutPlan(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  try {
    if (at(b, 0, [0x4f, 0x67, 0x67, 0x53])) return oggPlan(b);
    if (at(b, 0, [0x1a, 0x45, 0xdf, 0xa3])) return webmPlan(b);
    if (b.length >= 8 && type4(b, 4) === 'ftyp') return mp4Plan(b);
  } catch { return null; }
  return null;
}

// n조각의 바이트 범위(단위 시작에 맞춤, 바이트 비율 ≈ 시간 비율). 단위가 n보다 적으면 단위 수만큼.
export function chunkRanges(plan, n) {
  if (!plan || !Array.isArray(plan.starts) || !plan.starts.length) return [];
  const { starts, end } = plan;
  const count = Math.max(1, Math.min(n, starts.length));
  const first = starts[0], span = end - first;
  const cuts = [0];
  for (let k = 1; k < count; k++) {
    const want = first + (span * k) / count;
    let best = -1;
    for (let u = cuts[cuts.length - 1] + 1; u < starts.length; u++) {
      if (best < 0 || Math.abs(starts[u] - want) < Math.abs(starts[best] - want)) best = u;
      if (starts[u] > want) break;
    }
    if (best < 0 || starts.length - best < count - k) best = Math.min(starts.length - (count - k), cuts[cuts.length - 1] + 1);
    if (best <= cuts[cuts.length - 1]) break;
    cuts.push(best);
  }
  return cuts.map((u, k) => [starts[u], k + 1 < cuts.length ? starts[cuts[k + 1]] : end]);
}

// 조각 k(0부터) 바이트 = 머리 + 범위. 범위가 없으면 null.
export function chunkBytes(bytes, plan, ranges, k) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const r = ranges?.[k];
  if (!plan || !r) return null;
  const head = plan.headEnd > 0 ? b.subarray(0, plan.headEnd) : new Uint8Array(0);
  const out = new Uint8Array(head.length + (r[1] - r[0]));
  out.set(head, 0);
  out.set(b.subarray(r[0], r[1]), head.length);
  return out;
}

// 조각 글들 → 구간 글. 조각 사이에는 빈 줄 하나(머리 줄은 구간 단위로만, joinParts).
export const joinChunks = (texts) => (Array.isArray(texts) ? texts : []).map((t) => String(t ?? '').trim()).filter(Boolean).join('\n\n');
