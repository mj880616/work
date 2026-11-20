// S67-33: HWP(구형 한글 5.0)·HWPX 본문 글자를 적은 메모리로 읽는 한 곳. 외부 라이브러리 없음(Node 시험·Deno 배포 양쪽에서 읽으므로 .mjs).
// 왜: 브리핑 read 단계가 npm:@ssabrojs/hwpxjs hwpToText로 작은 보도자료 HWP를 읽다가 Edge 메모리 한도(256MB)를 넘겨 함수가 죽었다(2026-11-20 운영 로그).
// 방식:
// - HWP: 파일(OLE 복합 문서)의 목차·FAT만 읽고, BodyText/Section0, Section1 … 스트림을 하나씩 '흘려서' 푼다(DecompressionStream).
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

export class HwpTextError extends Error {
  constructor(code) { super(code); this.name = 'HwpTextError'; this.code = code; }
}
const bad = () => new HwpTextError('HWP_BAD');

// --- OLE 복합 문서(CFB) ---------------------------------------------------------
/** 목차와 FAT만 읽는다. 스트림 내용은 stream()이 조각(subarray, 복사 없음)으로 흘려 준다. */
export function openCfb(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1024) throw bad();
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint32(0, true) !== 0xe011cfd0 || v.getUint32(4, true) !== 0xe11ab1a1) throw bad();
  const shift = v.getUint16(30, true), miniShift = v.getUint16(32, true);
  if ((shift !== 9 && shift !== 12) || miniShift !== 6) throw bad();
  const size = 1 << shift, miniSize = 1 << miniShift;
  const sectors = Math.floor((bytes.byteLength - size) / size) + 1; // 마지막 조각 섹터도 센다
  const fatCount = v.getUint32(44, true), dirStart = v.getUint32(48, true), cutoff = v.getUint32(56, true);
  const miniFatStart = v.getUint32(60, true), miniFatCount = v.getUint32(64, true);
  let difat = v.getUint32(68, true); const difatCount = v.getUint32(72, true);
  if (fatCount > sectors || miniFatCount > sectors || difatCount > sectors) throw bad();
  const off = s => (s + 1) * size;
  const okSector = s => s < sectors && off(s) < bytes.byteLength;

  // FAT 섹터 번호 목록(머리 109개 + DIFAT 사슬)
  const fatSecs = [];
  for (let i = 0; i < 109 && fatSecs.length < fatCount; i++) fatSecs.push(v.getUint32(76 + i * 4, true));
  for (let k = 0; k < difatCount && fatSecs.length < fatCount; k++) {
    if (!okSector(difat)) throw bad();
    const per = size / 4 - 1;
    for (let i = 0; i < per && fatSecs.length < fatCount; i++) fatSecs.push(v.getUint32(off(difat) + i * 4, true));
    difat = v.getUint32(off(difat) + per * 4, true);
  }
  const fat = new Uint32Array(fatSecs.length * (size / 4));
  fatSecs.forEach((s, i) => {
    if (!okSector(s)) throw bad();
    for (let j = 0; j < size / 4; j++) fat[i * (size / 4) + j] = off(s) + j * 4 + 4 <= bytes.byteLength ? v.getUint32(off(s) + j * 4, true) : FREE;
  });
  /** 사슬 따라가기(고리·범위 밖이면 HWP_BAD). */
  const chain = (start, table, limit) => {
    const out = [];
    for (let s = start; s !== END; s = table[s]) {
      if (s === FREE || s >= table.length || out.length > limit) throw bad();
      out.push(s);
    }
    return out;
  };

  const dirChain = chain(dirStart, fat, sectors);
  const entries = [];
  const dec = new TextDecoder('utf-16le');
  for (const s of dirChain) {
    if (!okSector(s)) throw bad();
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
  if (!root || root.type !== 5) throw bad();
  const miniFat = (() => {
    if (!miniFatCount || miniFatStart === END) return new Uint32Array(0);
    const secs = chain(miniFatStart, fat, sectors);
    const t = new Uint32Array(secs.length * (size / 4));
    secs.forEach((s, i) => { if (!okSector(s)) throw bad(); for (let j = 0; j < size / 4; j++) t[i * (size / 4) + j] = off(s) + j * 4 + 4 <= bytes.byteLength ? v.getUint32(off(s) + j * 4, true) : FREE; });
    return t;
  })();
  const rootChain = root.start === END ? [] : chain(root.start, fat, sectors);

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
      for (const m of chain(entry.start, miniFat, miniFat.length)) {
        const pos = m * miniSize, big = rootChain[Math.floor(pos / size)];
        if (big === undefined || !okSector(big)) throw bad();
        const at = off(big) + (pos % size), n = Math.min(miniSize, left);
        if (at + n > bytes.byteLength) throw bad();
        yield bytes.subarray(at, at + n);
        left -= n;
        if (left <= 0) return;
      }
      if (left > 0) throw bad();
      return;
    }
    let runStart = -1, runLen = 0;
    for (const s of chain(entry.start, fat, sectors)) {
      if (!okSector(s)) throw bad();
      if (runStart >= 0 && s === runStart + runLen && runLen < 256) { runLen++; continue; }
      if (runStart >= 0) { const n = Math.min(runLen * size, left); yield bytes.subarray(off(runStart), off(runStart) + n); left -= n; if (left <= 0) return; }
      runStart = s; runLen = 1;
    }
    if (runStart >= 0 && left > 0) { const n = Math.min(runLen * size, left, bytes.byteLength - off(runStart)); yield bytes.subarray(off(runStart), off(runStart) + n); left -= n; }
    if (left > 0) throw bad();
  }

  return { root, children, stream };
}

/** 스트림 하나를 한 덩어리로(작은 스트림 전용: FileHeader 등). */
function readSmall(cfb, entry, max) {
  if (entry.size > max) throw bad();
  const out = new Uint8Array(entry.size); let at = 0;
  for (const p of cfb.stream(entry)) { out.set(p, at); at += p.byteLength; }
  return out;
}

// --- 흘려서 풀기 ----------------------------------------------------------------
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
    if (!stop()) throw bad();
  } finally {
    await reader.cancel().catch(() => {});
    await writer.abort().catch(() => {});
    await feeding;
  }
  if (failed && !stop()) throw bad();
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
  for await (const piece of inflateParts(cfb.stream(entry), compressed, { onIn: n => { if (para >= skip) budget.in += n; }, stop })) {
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
        if (size > 64 * 1024 * 1024) throw bad();
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
  if (want) throw bad(); // 레코드가 중간에 끊겼다
  return { lines, para, done: !stop() };
}

/** HWP 첫 확인: 암호·배포용이면 HWP_LOCKED. 섹션 목록과 압축 여부. */
export function hwpInfo(bytes) {
  const cfb = openCfb(bytes);
  const top = cfb.children(cfb.root);
  const header = top.get('FileHeader');
  if (!header) throw bad();
  const h = readSmall(cfb, header, 4096);
  if (h.byteLength < 40 || new TextDecoder('latin1').decode(h.subarray(0, 17)) !== 'HWP Document File') throw bad();
  const flags = new DataView(h.buffer, h.byteOffset, h.byteLength).getUint32(36, true);
  if (flags & 0x2 || flags & 0x4) throw new HwpTextError('HWP_LOCKED');
  const body = top.get('BodyText');
  if (!body || body.type !== 1) throw bad();
  const secs = [...cfb.children(body).entries()]
    .map(([name, e]) => ({ n: Number(name.match(/^Section(\d{1,4})$/)?.[1] ?? NaN), e }))
    .filter(s => Number.isInteger(s.n) && s.e.type === 2)
    .sort((a, b) => a.n - b.n);
  if (!secs.length) throw bad();
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
