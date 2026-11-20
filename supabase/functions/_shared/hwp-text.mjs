// S67-33: HWP(구형 한글 5.0)·HWPX 본문 글자를 적은 메모리로 읽는 한 곳. 외부 라이브러리 없음(Node 시험·Deno 배포 양쪽에서 읽으므로 .mjs).
// 왜: 브리핑 read 단계가 npm:@ssabrojs/hwpxjs hwpToText로 작은 보도자료 HWP를 읽다가 Edge 메모리 한도(256MB)를 넘겨 함수가 죽었다(2026-11-20 운영 로그).
// 방식:
// - HWP: 파일(OLE 복합 문서)의 목차·FAT만 읽고, BodyText/Section0, Section1 … 스트림을 하나씩 '흘려서' 푼다
//   (S67-37부터 자체 rawInflate: 한글이 섹션 끝에 붙이는 8바이트 꼬리를 Deno DecompressionStream이 오류로 버려서).
//   푼 바이트는 레코드 단위로 보고 문단 글자(HWPTAG_PARA_TEXT)만 남기고 바로 버린다. 그림(BinData)·다른 스트림은 건드리지 않는다.
//   메모리는 내려받은 파일 바이트 + 작은 버퍼(레코드 하나 크기) + 뽑은 글자뿐이다.
// - HWPX: zip 안 Contents/section*.xml을 하나씩 흘려서 풀고, </hp:p> 문단 단위로 글자만 남긴다(XML 전체를 한 번에 문자열로 만들지 않음).
// - 나눠 읽기: from {sec, para}(그 섹션의 몇 번째 문단부터)에서 시작해, 이번 부름에서 압축 바이트 sliceIn만큼(또는 글자 maxChars만큼) 읽으면
//   멈추고 next {sec, para}를 돌려준다. 다음 부름이 거기서 잇는다(앞부분은 다시 풀되 글자는 버림 — 메모리는 늘지 않는다).
// - 암호 걸린 문서·배포용 문서는 본문이 암호화되어 있어 읽지 않는다(HWP_LOCKED). 모양이 이상하면 HWP_BAD.

export const HWP_SLICE_IN = 4 * 1024 * 1024;      // 한 번 부를 때 풀어 볼 압축 바이트(섹션 스트림 기준)
export const HWP_SLICE_OUT = 48 * 1024 * 1024;    // 한 번 부를 때 풀린 바이트 상한(압축이 아주 잘 된 경우의 안전장치)
const HWPX_PARA_BUFFER = 8 * 1024 * 1024;         // 문단 하나가 이보다 길면(</hp:p> 없이) 읽지 않는다

const FREE = 0xffffffff, END = 0xfffffffe;
const TAG_PARA_TEXT = 67;                          // HWPTAG_BEGIN(16) + 51

// stage(S67-37): 어느 단계에서 멈췄는지(로그에는 이 코드만 남긴다, 글 내용 없음).
// header·difat·fat·dir·minifat·stream·fileheader·bodytext·section_inflate·record
export class HwpTextError extends Error {
  constructor(code, stage = '') { super(code); this.name = 'HwpTextError'; this.code = code; this.stage = stage; }
}
const bad = (stage = '') => new HwpTextError('HWP_BAD', stage);

// --- OLE 복합 문서(CFB) ---------------------------------------------------------
/** 목차와 FAT만 읽는다. 스트림 내용은 stream()이 조각(subarray, 복사 없음)으로 흘려 준다. */
export function openCfb(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1024) throw bad('header');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint32(0, true) !== 0xe011cfd0 || v.getUint32(4, true) !== 0xe11ab1a1) throw bad('header');
  const shift = v.getUint16(30, true), miniShift = v.getUint16(32, true);
  if ((shift !== 9 && shift !== 12) || miniShift !== 6) throw bad('header');
  const size = 1 << shift, miniSize = 1 << miniShift;
  const sectors = Math.floor((bytes.byteLength - size) / size) + 1; // 마지막 조각 섹터도 센다
  const fatCount = v.getUint32(44, true), dirStart = v.getUint32(48, true), cutoff = v.getUint32(56, true);
  const miniFatStart = v.getUint32(60, true), miniFatCount = v.getUint32(64, true);
  let difat = v.getUint32(68, true); const difatCount = v.getUint32(72, true);
  if (fatCount > sectors || miniFatCount > sectors || difatCount > sectors) throw bad('header');
  const off = s => (s + 1) * size;
  const okSector = s => s < sectors && off(s) < bytes.byteLength;

  // FAT 섹터 번호 목록(머리 109개 + DIFAT 사슬)
  const fatSecs = [];
  for (let i = 0; i < 109 && fatSecs.length < fatCount; i++) fatSecs.push(v.getUint32(76 + i * 4, true));
  for (let k = 0; k < difatCount && fatSecs.length < fatCount; k++) {
    if (!okSector(difat)) throw bad('difat');
    const per = size / 4 - 1;
    for (let i = 0; i < per && fatSecs.length < fatCount; i++) fatSecs.push(v.getUint32(off(difat) + i * 4, true));
    difat = v.getUint32(off(difat) + per * 4, true);
  }
  const fat = new Uint32Array(fatSecs.length * (size / 4));
  fatSecs.forEach((s, i) => {
    if (!okSector(s)) throw bad('fat');
    for (let j = 0; j < size / 4; j++) fat[i * (size / 4) + j] = off(s) + j * 4 + 4 <= bytes.byteLength ? v.getUint32(off(s) + j * 4, true) : FREE;
  });
  /** 사슬 따라가기(고리·범위 밖이면 HWP_BAD). */
  const chain = (start, table, limit, stage) => {
    const out = [];
    for (let s = start; s !== END; s = table[s]) {
      if (s === FREE || s >= table.length || out.length > limit) throw bad(stage);
      out.push(s);
    }
    return out;
  };

  const dirChain = chain(dirStart, fat, sectors, 'dir');
  const entries = [];
  const dec = new TextDecoder('utf-16le');
  for (const s of dirChain) {
    if (!okSector(s)) throw bad('dir');
    for (let j = 0; j < size / 128; j++) {
      const at = off(s) + j * 128;
      if (at + 128 > bytes.byteLength) break;
      const nameLen = Math.min(64, v.getUint16(at + 64, true));
      entries.push({
        name: dec.decode(bytes.subarray(at, at + Math.max(0, nameLen - 2))),
        type: bytes[at + 66], left: v.getUint32(at + 68, true), right: v.getUint32(at + 72, true), child: v.getUint32(at + 76, true),
        start: v.getUint32(at + 116, true), size: v.getUint32(at + 120, true),
      });
    }
  }
  const root = entries[0];
  if (!root || root.type !== 5) throw bad('dir');
  const miniFat = (() => {
    if (!miniFatCount || miniFatStart === END) return new Uint32Array(0);
    const secs = chain(miniFatStart, fat, sectors, 'minifat');
    const t = new Uint32Array(secs.length * (size / 4));
    secs.forEach((s, i) => { if (!okSector(s)) throw bad('minifat'); for (let j = 0; j < size / 4; j++) t[i * (size / 4) + j] = off(s) + j * 4 + 4 <= bytes.byteLength ? v.getUint32(off(s) + j * 4, true) : FREE; });
    return t;
  })();
  const rootChain = root.start === END ? [] : chain(root.start, fat, sectors, 'minifat');

  /** 한 저장소(storage)의 자식 항목들(이름 → 항목). */
  function children(entry) {
    const out = new Map(), seen = new Set(), stack = [entry.child];
    while (stack.length) {
      const i = stack.pop();
      if (i === FREE || i >= entries.length || seen.has(i)) continue;
      seen.add(i);
      const e = entries[i];
      out.set(e.name, e);
      stack.push(e.left, e.right);
    }
    return out;
  }

  /** 스트림 내용을 조각으로(복사 없음). 이웃 섹터는 한 조각으로 붙인다. */
  function* stream(entry) {
    let left = entry.size;
    if (left === 0) return;
    if (left < cutoff) {
      for (const m of chain(entry.start, miniFat, miniFat.length, 'stream')) {
        const pos = m * miniSize, big = rootChain[Math.floor(pos / size)];
        if (big === undefined || !okSector(big)) throw bad('stream');
        const at = off(big) + (pos % size), n = Math.min(miniSize, left);
        if (at + n > bytes.byteLength) throw bad('stream');
        yield bytes.subarray(at, at + n);
        left -= n;
        if (left <= 0) return;
      }
      if (left > 0) throw bad('stream');
      return;
    }
    let runStart = -1, runLen = 0;
    for (const s of chain(entry.start, fat, sectors, 'stream')) {
      if (!okSector(s)) throw bad('stream');
      if (runStart >= 0 && s === runStart + runLen && runLen < 256) { runLen++; continue; }
      if (runStart >= 0) { const n = Math.min(runLen * size, left); yield bytes.subarray(off(runStart), off(runStart) + n); left -= n; if (left <= 0) return; }
      runStart = s; runLen = 1;
    }
    if (runStart >= 0 && left > 0) { const n = Math.min(runLen * size, left, bytes.byteLength - off(runStart)); yield bytes.subarray(off(runStart), off(runStart) + n); left -= n; }
    if (left > 0) throw bad('stream');
  }

  return { root, children, stream };
}

/** 스트림 하나를 한 덩어리로(작은 스트림 전용: FileHeader 등). */
function readSmall(cfb, entry, max) {
  if (entry.size > max) throw bad('stream');
  const out = new Uint8Array(entry.size); let at = 0;
  for (const p of cfb.stream(entry)) { out.set(p, at); at += p.byteLength; }
  return out;
}

// --- 순수 JS raw deflate 풀기(HWP 본문 섹션 전용) -------------------------------------
// 왜(S67-37): 한글 프로그램이 만든 HWP는 섹션 압축 끝에 8바이트(CRC32 + 원래 크기)를 덧붙인다.
// Node의 DecompressionStream은 이 꼬리를 조용히 넘기지만, 운영(Supabase Edge = Deno)의 DecompressionStream('deflate-raw')은
// "failed to write whole buffer" 오류로 결과 전체를 버린다 → 실제 HWP가 모두 '읽기 실패'였다(합성 시험은 꼬리가 없어 통과).
// 그래서 런타임 도구에 기대지 않고 직접 푼다: 마지막 블록에서 멈추고 뒤 바이트는 보지 않는다. Node·Deno가 같은 코드로 같은 결과.
// 메모리: 출력 창 32KB + 조각 OUT_CHUNK(풀린 조각은 복사본으로 내보낸다).
const OUT_CHUNK = 64 * 1024, WINDOW = 32768;
const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CLORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
const inflateBad = () => new HwpTextError('HWP_BAD', 'section_inflate');

/** 정규 허프만 표: 항목 = (기호 << 4) | 길이. 길이 0 = 없는 부호. */
function huffTable(lengths) {
  let max = 0;
  for (const l of lengths) if (l > max) max = l;
  if (!max) return { table: new Int32Array(1), bits: 0 };
  const count = new Uint16Array(16);
  for (const l of lengths) count[l]++;
  count[0] = 0;
  const next = new Uint16Array(16);
  let code = 0, left = 1;
  for (let b = 1; b <= 15; b++) {
    left <<= 1; left -= count[b];
    if (left < 0) throw inflateBad(); // 부호가 넘침(깨진 압축)
    code = (code + count[b - 1]) << 1; next[b] = code;
  }
  const size = 1 << max, table = new Int32Array(size);
  for (let sym = 0; sym < lengths.length; sym++) {
    const len = lengths[sym];
    if (!len) continue;
    let c = next[len]++, r = 0;
    for (let i = 0; i < len; i++) { r = (r << 1) | (c & 1); c >>= 1; }
    for (let j = r; j < size; j += 1 << len) table[j] = (sym << 4) | len;
  }
  return { table, bits: max };
}
let FIXED = null;
function fixedTables() {
  if (FIXED) return FIXED;
  const l = new Uint8Array(288);
  l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288);
  FIXED = { lit: huffTable(l), dist: huffTable(new Uint8Array(30).fill(5)) };
  return FIXED;
}

/**
 * 조각들(압축 바이트)을 풀어 조각(Uint8Array 복사본)으로 내보낸다. 마지막 블록이 끝나면 멈춘다(뒤 바이트 무시).
 * onIn(n): 새로 꺼낸 입력 조각 크기. stop()이 참이면 다음 출력 조각을 내보낸 뒤 그만둔다.
 */
export function* rawInflate(parts, { onIn = () => {}, stop = () => false } = {}) {
  const it = parts[Symbol.iterator]();
  let cur = new Uint8Array(0), ci = 0, ended = false;
  let bitbuf = 0, bitcnt = 0;
  const fill = n => {
    while (bitcnt < n) {
      while (ci >= cur.byteLength) {
        if (ended) return;
        const r = it.next();
        if (r.done) { ended = true; return; }
        cur = r.value; ci = 0; onIn(cur.byteLength);
      }
      bitbuf |= cur[ci++] << bitcnt; bitcnt += 8;
    }
  };
  const bits = n => {
    if (!n) return 0;
    fill(n);
    if (bitcnt < n) throw inflateBad(); // 압축이 중간에 끊겼다
    const v = bitbuf & ((1 << n) - 1);
    bitbuf >>>= n; bitcnt -= n;
    return v;
  };
  const sym = t => {
    fill(t.bits);
    const e = t.table[bitbuf & ((1 << t.bits) - 1)], len = e & 15;
    if (!len || len > bitcnt) throw inflateBad();
    bitbuf >>>= len; bitcnt -= len;
    return e >>> 4;
  };
  const out = new Uint8Array(WINDOW + OUT_CHUNK);
  let pos = 0, flushed = 0, total = 0;
  // 출력 창이 차면 내보낼 조각을 돌려주고 최근 32KB만 앞으로 옮긴다.
  const rotate = () => {
    const piece = out.slice(flushed, pos);
    out.copyWithin(0, pos - WINDOW, pos); pos = WINDOW; flushed = WINDOW;
    return piece;
  };
  let last = 0;
  while (!last) {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitbuf >>>= bitcnt & 7; bitcnt -= bitcnt & 7;
      const len = bits(16), nlen = bits(16);
      if ((len ^ 0xffff) !== nlen) throw inflateBad();
      for (let i = 0; i < len; i++) {
        if (pos === out.byteLength) { yield rotate(); if (stop()) return; }
        out[pos++] = bits(8); total++;
      }
      continue;
    }
    let lit, dist;
    if (type === 1) ({ lit, dist } = fixedTables());
    else if (type === 2) {
      const hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
      const cl = new Uint8Array(19);
      for (let i = 0; i < hclen; i++) cl[CLORDER[i]] = bits(3);
      const clt = huffTable(cl);
      const lens = new Uint8Array(hlit + hdist);
      for (let i = 0; i < hlit + hdist;) {
        const s = sym(clt);
        if (s < 16) { lens[i++] = s; continue; }
        let rep, val = 0;
        if (s === 16) { if (!i) throw inflateBad(); val = lens[i - 1]; rep = 3 + bits(2); }
        else if (s === 17) rep = 3 + bits(3);
        else rep = 11 + bits(7);
        if (i + rep > lens.length) throw inflateBad();
        lens.fill(val, i, i + rep); i += rep;
      }
      if (!lens[256]) throw inflateBad(); // 블록 끝 부호가 없다
      lit = huffTable(lens.subarray(0, hlit)); dist = huffTable(lens.subarray(hlit));
    } else throw inflateBad();
    for (;;) {
      if (pos + 258 > out.byteLength) { yield rotate(); if (stop()) return; }
      const s = sym(lit);
      if (s < 256) { out[pos++] = s; total++; continue; }
      if (s === 256) break;
      const li = s - 257;
      if (li >= 29) throw inflateBad();
      const len = LBASE[li] + bits(LEXT[li]);
      const di = sym(dist);
      if (di >= 30) throw inflateBad();
      const d = DBASE[di] + bits(DEXT[di]);
      if (d > total || d > WINDOW) throw inflateBad();
      for (let k = 0; k < len; k++) { out[pos] = out[pos - d]; pos++; }
      total += len;
    }
  }
  if (pos > flushed) yield out.slice(flushed, pos);
}

/** HWP 섹션 조각(압축이면 rawInflate로 푼 것). */
function* hwpParts(parts, compressed, { onIn, stop }) {
  if (!compressed) {
    for (const p of parts) { if (stop()) return; onIn(p.byteLength); yield p; }
    return;
  }
  yield* rawInflate(parts, { onIn, stop });
}

// --- 흘려서 풀기(HWPX zip 항목: 꼬리 바이트가 없는 표준 deflate라 런타임 도구를 쓴다) ----------------------
/** 조각들을 압축 해제하며 흘려 보낸다. onIn(n): 넣은 압축 바이트. stop()이 참이면 그만 넣는다. */
async function* inflateParts(parts, compressed, { onIn, stop }) {
  if (!compressed) {
    for (const p of parts) { if (stop()) return; onIn(p.byteLength); yield p; }
    return;
  }
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter(), reader = ds.readable.getReader();
  let failed = null;
  const feeding = (async () => {
    try {
      for (const p of parts) {
        if (stop()) break;
        // 작은 조각으로 나눠 넣어 풀린 쪽이 한꺼번에 쌓이지 않게 한다.
        for (let i = 0; i < p.byteLength; i += 64 * 1024) {
          if (stop()) break;
          const piece = p.subarray(i, Math.min(p.byteLength, i + 64 * 1024));
          onIn(piece.byteLength);
          await writer.write(piece);
        }
      }
      await writer.close();
    } catch (e) { failed = e; }
  })();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield value;
    }
  } catch (e) {
    // 그만 넣다가 닫으면 끝이 덜 된 압축이라 오류가 날 수 있다 — 멈춘 경우는 정상으로 본다.
    if (!stop()) throw bad('section_inflate');
  } finally {
    await reader.cancel().catch(() => {});
    await writer.abort().catch(() => {});
    await feeding;
  }
  if (failed && !stop()) throw bad('section_inflate');
}

// --- HWP 레코드 ------------------------------------------------------------------
// 글자 컨트롤: 0~31. 8칸짜리(인라인·확장) 컨트롤은 뒤 7칸을 건너뛴다. 9=탭, 10=줄바꿈, 13=문단 끝, 24~31=특수 공백·하이픈.
const EIGHT = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
export function paraText(data) {
  const n = data.byteLength >> 1;
  let out = '', buf = [];
  const flush = () => { if (buf.length) { out += String.fromCharCode.apply(null, buf); buf = []; } };
  for (let i = 0; i < n; i++) {
    const c = data[i * 2] | (data[i * 2 + 1] << 8);
    if (c >= 32) { buf.push(c); if (buf.length >= 4096) flush(); continue; }
    if (c === 9) buf.push(32);
    else if (c === 10) buf.push(10);
    else if (c === 13) break;
    else if (c >= 24) buf.push(c === 24 ? 45 : 32);
    if (EIGHT.has(c)) i += 7;
  }
  flush();
  return out;
}

/**
 * 한 섹션의 문단 글자. skip개 문단은 글자를 버린다. 끝까지 읽으면 done=true.
 * @returns {Promise<{lines: string[], para: number, done: boolean}>}
 */
async function hwpSection(cfb, entry, compressed, { skip, budget }) {
  const lines = [];
  let para = 0, buf = new Uint8Array(0), want = 0, skipBytes = 0;
  // 이번 부름에서 새 문단을 하나라도 읽은 뒤에만 예산으로 멈춘다(같은 자리에서 맴돌지 않게).
  const stop = () => para > skip && budget.out();
  const take = data => {
    if (para >= skip) { const line = paraText(data); lines.push(line); budget.chars += line.length; }
    para++;
  };
  for (const piece of hwpParts(cfb.stream(entry), compressed, { onIn: n => { if (para >= skip) budget.in += n; }, stop })) {
    if (para >= skip) budget.outBytes += piece.byteLength;
    let p = piece;
    if (skipBytes) { const k = Math.min(skipBytes, p.byteLength); skipBytes -= k; p = p.subarray(k); }
    if (!p.byteLength) continue;
    if (buf.byteLength) { const m = new Uint8Array(buf.byteLength + p.byteLength); m.set(buf); m.set(p, buf.byteLength); p = m; }
    let at = 0;
    for (;;) {
      if (want) {
        if (p.byteLength - at < want) break;
        const data = p.subarray(at, at + want); at += want; want = 0;
        take(data);
        if (stop()) break;
        continue;
      }
      if (p.byteLength - at < 4) break;
      const h = (p[at] | (p[at + 1] << 8) | (p[at + 2] << 16) | (p[at + 3] << 24)) >>> 0;
      const tag = h & 0x3ff; let size = (h >>> 20) & 0xfff, head = 4;
      if (size === 0xfff) {
        if (p.byteLength - at < 8) break;
        size = (p[at + 4] | (p[at + 5] << 8) | (p[at + 6] << 16) | (p[at + 7] << 24)) >>> 0; head = 8;
      }
      at += head;
      if (tag === TAG_PARA_TEXT && para >= skip) {
        if (size > 64 * 1024 * 1024) throw bad('record');
        if (!size) { take(new Uint8Array(0)); if (stop()) break; continue; }
        want = size;
        continue;
      }
      if (tag === TAG_PARA_TEXT) para++; // 앞 부름에서 읽은 문단: 글자는 버린다
      const k = Math.min(size, p.byteLength - at); at += k; skipBytes = size - k;
      if (skipBytes) break;
    }
    buf = at < p.byteLength ? p.slice(at) : new Uint8Array(0);
    if (stop()) return { lines, para, done: false };
  }
  if (want) throw bad('record'); // 레코드가 중간에 끊겼다
  return { lines, para, done: !stop() };
}

/** HWP 첫 확인: 암호·배포용이면 HWP_LOCKED. 섹션 목록과 압축 여부. */
export function hwpInfo(bytes) {
  const cfb = openCfb(bytes);
  const top = cfb.children(cfb.root);
  const header = top.get('FileHeader');
  if (!header) throw bad('fileheader');
  const h = readSmall(cfb, header, 4096);
  if (h.byteLength < 40 || new TextDecoder('latin1').decode(h.subarray(0, 17)) !== 'HWP Document File') throw bad('fileheader');
  const flags = new DataView(h.buffer, h.byteOffset, h.byteLength).getUint32(36, true);
  if (flags & 0x2 || flags & 0x4) throw new HwpTextError('HWP_LOCKED');
  const body = top.get('BodyText');
  if (!body || body.type !== 1) throw bad('bodytext');
  const secs = [...cfb.children(body).entries()]
    .map(([name, e]) => ({ n: Number(name.match(/^Section(\d{1,4})$/)?.[1] ?? NaN), e }))
    .filter(s => Number.isInteger(s.n) && s.e.type === 2)
    .sort((a, b) => a.n - b.n);
  if (!secs.length) throw bad('bodytext');
  return { cfb, compressed: (flags & 0x1) === 1, sections: secs.map(s => s.e) };
}

function makeBudget(sliceIn, sliceOut, maxChars) {
  const b = { in: 0, outBytes: 0, chars: 0, out: () => b.in >= sliceIn || b.outBytes >= sliceOut || b.chars >= maxChars };
  return b;
}

/**
 * HWP 글자(나눠 읽기). from={sec, para}. 다 읽으면 next=null.
 * @returns {Promise<{text: string, next: {sec:number, para:number}|null, sections: number, sizes: number[]}>}
 */
export async function hwpRead(bytes, { from = { sec: 0, para: 0 }, sliceIn = HWP_SLICE_IN, sliceOut = HWP_SLICE_OUT, maxChars = Infinity } = {}) {
  const { cfb, compressed, sections } = hwpInfo(bytes);
  const budget = makeBudget(sliceIn, sliceOut, maxChars);
  const out = [];
  let sec = Math.max(0, from.sec | 0), skip = Math.max(0, from.para | 0);
  for (; sec < sections.length; sec++, skip = 0) {
    const r = await hwpSection(cfb, sections[sec], compressed, { skip, budget });
    for (const l of r.lines) if (l.trim()) out.push(l);
    if (!r.done) return { text: out.join('\n'), next: { sec, para: r.para }, sections: sections.length, sizes: sections.map(e => e.size) };
    if (budget.out() && sec + 1 < sections.length) return { text: out.join('\n'), next: { sec: sec + 1, para: 0 }, sections: sections.length, sizes: sections.map(e => e.size) };
  }
  return { text: out.join('\n'), next: null, sections: sections.length, sizes: sections.map(e => e.size) };
}

/**
 * 안전망(S67-37): 본문(BodyText)을 못 읽을 때 쓰는 미리보기 글자(PrvText 스트림, 압축 없는 UTF-16LE, 보통 첫 쪽 앞부분).
 * 한글이 파일을 저장할 때 탐색기 미리보기용으로 넣는다. 표 칸은 <칸> 꺾쇠로 감싸 있어 꺾쇠만 벗긴다.
 * 암호 걸린 문서는 돌려주지 않는다(''). 배포용 문서는 본문만 암호화되고 미리보기는 그대로라 돌려준다. 못 읽으면 ''(던지지 않음).
 */
export function hwpPreview(bytes) {
  try {
    const cfb = openCfb(bytes);
    const top = cfb.children(cfb.root);
    const header = top.get('FileHeader');
    if (!header) return '';
    const h = readSmall(cfb, header, 4096);
    if (h.byteLength < 40 || new TextDecoder('latin1').decode(h.subarray(0, 17)) !== 'HWP Document File') return '';
    if (new DataView(h.buffer, h.byteOffset, h.byteLength).getUint32(36, true) & 0x2) return '';
    const e = top.get('PrvText');
    if (!e || e.type !== 2 || !e.size) return '';
    const data = readSmall(cfb, e, 1024 * 1024);
    return new TextDecoder('utf-16le').decode(data.subarray(0, data.byteLength & ~1))
      .replace(/\u0000/g, '').replace(/\r\n?/g, '\n')
      .replace(/<([^<>\n]{0,400})>/g, '$1 ').replace(/[ \t]+\n/g, '\n').trim();
  } catch {
    return '';
  }
}

// --- HWPX(zip) -----------------------------------------------------------------
const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);/gi, (all, v) => {
    if (v[0] !== '#') return ENTITY[v.toLowerCase()] ?? all;
    const n = v[1] === 'x' || v[1] === 'X' ? parseInt(v.slice(2), 16) : parseInt(v.slice(1), 10);
    return Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
  });
}
/** 문단 조각 하나(</hp:p> 앞까지)의 글자. */
export function hwpxParaText(seg) {
  let line = '';
  for (const m of seg.matchAll(/<hp:t(?:\s[^>]*)?>([\s\S]*?)<\/hp:t>/g)) {
    line += decodeEntities(m[1].replace(/<hp:tab\b[^>]*\/>/g, ' ').replace(/<[^>]*>/g, ''));
  }
  return line;
}

/** zip 목차에서 Contents/sectionN.xml 항목들. */
export function hwpxSections(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = bytes.byteLength;
  let eocd = -1;
  for (let i = len - 22; i >= Math.max(0, len - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new HwpTextError('HWPX_NOT_ZIP');
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const sections = [];
  const decoder = new TextDecoder('utf-8');
  for (let k = 0; k < count; k++) {
    if (at + 46 > len || view.getUint32(at, true) !== 0x02014b50) throw new HwpTextError('HWPX_NOT_ZIP');
    const method = view.getUint16(at + 10, true), size = view.getUint32(at + 20, true), usize = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true), extraLen = view.getUint16(at + 30, true), commentLen = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    const m = name.match(/^Contents\/section(\d{1,4})\.xml$/i);
    if (m) {
      if (offset + 30 > len || view.getUint32(offset, true) !== 0x04034b50) throw new HwpTextError('HWPX_NOT_ZIP');
      const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
      if (start + size > len) throw new HwpTextError('HWPX_NOT_ZIP');
      sections.push({ n: Number(m[1]), method, size, usize, start });
    }
    at += 46 + nameLen + extraLen + commentLen;
  }
  return sections.filter(s => s.method === 0 || s.method === 8).sort((a, b) => a.n - b.n);
}

/**
 * HWPX 글자(나눠 읽기). maxXmlBytes: 한 섹션 XML(풀린 크기) 상한.
 * @returns {Promise<{text: string, next: {sec:number, para:number}|null, sections: number, sizes: number[]}>}
 */
export async function hwpxRead(bytes, { from = { sec: 0, para: 0 }, sliceIn = HWP_SLICE_IN, sliceOut = HWP_SLICE_OUT, maxChars = Infinity, maxXmlBytes = Infinity } = {}) {
  const sections = hwpxSections(bytes);
  const sizes = sections.map(s => s.size);
  const budget = makeBudget(sliceIn, sliceOut, maxChars);
  const out = [];
  let sec = Math.max(0, from.sec | 0), skip = Math.max(0, from.para | 0);
  for (; sec < sections.length; sec++, skip = 0) {
    const s = sections[sec];
    const decoder = new TextDecoder('utf-8');
    let para = 0, rest = '', xml = 0, stopped = false;
    const raw = bytes.subarray(s.start, s.start + s.size);
    for await (const piece of inflateParts([raw], s.method === 8, { onIn: n => { if (para >= skip) budget.in += n; }, stop: () => para > skip && budget.out() })) {
      xml += piece.byteLength;
      if (xml > maxXmlBytes) throw new HwpTextError('HWPX_TOO_LARGE');
      if (para >= skip) budget.outBytes += piece.byteLength;
      rest += decoder.decode(piece, { stream: true });
      const cut = rest.lastIndexOf('</hp:p>');
      if (cut === -1) { if (rest.length > HWPX_PARA_BUFFER) throw new HwpTextError('HWPX_TOO_LARGE'); continue; }
      const segs = rest.slice(0, cut).split('</hp:p>');
      rest = rest.slice(cut + 7);
      for (const seg of segs) {
        if (para >= skip) { const line = hwpxParaText(seg); if (line.trim()) { out.push(line); budget.chars += line.length; } }
        para++;
      }
      if (para > skip && budget.out()) { stopped = true; break; }
    }
    if (para > skip && budget.out()) stopped = true;
    if (stopped) return { text: out.join('\n'), next: { sec, para }, sections: sections.length, sizes };
    const tail = hwpxParaText(rest);
    if (tail.trim() && para >= skip) out.push(tail);
    if (budget.out() && sec + 1 < sections.length) return { text: out.join('\n'), next: { sec: sec + 1, para: 0 }, sections: sections.length, sizes };
  }
  return { text: out.join('\n'), next: null, sections: sections.length, sizes };
}

/** 진행 표시용: 읽은 압축 바이트 비율로 n/t(t = 섹션 압축 크기 합 ÷ sliceIn, 최소 1). */
export function sliceTotal(sizes, sliceIn = HWP_SLICE_IN) {
  const sum = (Array.isArray(sizes) ? sizes : []).reduce((a, b) => a + (Number(b) || 0), 0);
  return Math.max(1, Math.min(200, Math.ceil(sum / sliceIn)));
}
