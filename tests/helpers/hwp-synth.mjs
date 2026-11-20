// S67-33 시험 도구: 합성 HWP(구형 한글 5.0, OLE 복합 문서) 만들기. 네트워크·외부 라이브러리 없음.
// - FileHeader(압축·암호 플래그), DocInfo, BodyText/Section0…N(문단 레코드: PARA_HEADER·PARA_TEXT·CHAR_SHAPE), 큰 그림 자리(BinData)까지.
// - 작은 스트림(< 4096바이트)은 미니 스트림에, 큰 스트림은 일반 섹터에 둔다. FAT 섹터가 109개를 넘으면 DIFAT 사슬을 만든다.
// - S67-37: 실제 한글 파일처럼 압축 스트림 끝에 8바이트 꼬리(CRC32 + 풀린 크기)를 붙인다(trailer, 기본 켬).
//   운영 Deno의 DecompressionStream은 이 꼬리를 오류로 버려 실제 HWP를 모두 못 읽었다(공개 표본 58개로 확인, 표본 파일은 저장소에 넣지 않음).
//   미리보기 글자(PrvText, UTF-16LE·압축 없음)·압축 세기(level 0 = 저장 블록)도 고를 수 있다.
import { crc32, deflateRawSync } from 'node:zlib';

/** 한글 프로그램 모양의 압축: raw deflate + CRC32(LE) + 풀린 크기(LE). */
export function hwpDeflate(raw, { trailer = true, level = 6 } = {}) {
  const data = deflateRawSync(raw, { level });
  if (!trailer) return data;
  const t = Buffer.alloc(8); t.writeUInt32LE(crc32(raw) >>> 0, 0); t.writeUInt32LE(raw.length >>> 0, 4);
  return Buffer.concat([data, t]);
}

const SEC = 512, END = 0xfffffffe, FREE = 0xffffffff, FATSECT = 0xfffffffd, DIFSECT = 0xfffffffc, NOSTREAM = 0xffffffff;

function record(tag, data, level = 0) {
  const size = data.length;
  if (size < 0xfff) {
    const h = Buffer.alloc(4); h.writeUInt32LE(((tag & 0x3ff) | ((level & 0x3ff) << 10) | (size << 20)) >>> 0, 0);
    return Buffer.concat([h, data]);
  }
  const h = Buffer.alloc(8); h.writeUInt32LE(((tag & 0x3ff) | ((level & 0x3ff) << 10) | (0xfff << 20)) >>> 0, 0); h.writeUInt32LE(size, 4);
  return Buffer.concat([h, data]);
}
/** 문단 글자 레코드 데이터: 글자(UTF-16LE) + 컨트롤 + 문단 끝(13). ctrl: 'table'이면 앞에 8칸짜리 확장 컨트롤(11)을 넣는다. */
export function paraTextData(text, { ctrl = null } = {}) {
  const units = [];
  if (ctrl === 'table') { units.push(11, 0x6274, 0x6c20, 0, 0, 0, 0, 11); }
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c === 9) units.push(9, 0, 0, 0, 0, 0, 0, 9);
    else if (c > 0xffff) { const v = c - 0x10000; units.push(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff)); }
    else units.push(c);
  }
  units.push(13);
  const b = Buffer.alloc(units.length * 2);
  units.forEach((u, i) => b.writeUInt16LE(u, i * 2));
  return b;
}
/** 섹션 스트림(풀린 상태) 하나: 문단마다 PARA_HEADER(66) + PARA_TEXT(67) + PARA_CHAR_SHAPE(68). */
export function sectionBytes(paras) {
  const parts = [];
  for (const p of paras) {
    const t = typeof p === 'string' ? { text: p } : p;
    parts.push(record(66, Buffer.alloc(22)), record(67, paraTextData(t.text, t)), record(68, Buffer.alloc(8)));
  }
  return Buffer.concat(parts);
}

function fileHeader({ compressed = true, password = false, distribution = false } = {}) {
  const h = Buffer.alloc(256);
  h.write('HWP Document File', 0, 'latin1');
  h.writeUInt32LE(0x05010100, 32);
  h.writeUInt32LE((compressed ? 1 : 0) | (password ? 2 : 0) | (distribution ? 4 : 0), 36);
  return h;
}

/**
 * 합성 HWP 파일.
 * @param {{sections: (string|{text:string,ctrl?:string})[][], compressed?: boolean, password?: boolean, distribution?: boolean, binBytes?: number,
 *   trailer?: boolean, level?: number, prvText?: string|null, brokenSection?: boolean}} o
 */
export function makeHwp({ sections, compressed = true, password = false, distribution = false, binBytes = 0, trailer = true, level = 6, prvText = null, brokenSection = false }) {
  const z = raw => hwpDeflate(raw, { trailer, level });
  const streams = [
    { name: 'FileHeader', data: fileHeader({ compressed, password, distribution }), parent: 'root' },
    { name: 'DocInfo', data: compressed ? z(Buffer.alloc(64)) : Buffer.alloc(64), parent: 'root' },
  ];
  if (prvText !== null) streams.push({ name: 'PrvText', data: Buffer.from(prvText, 'utf16le'), parent: 'root' });
  sections.forEach((paras, i) => {
    const raw = sectionBytes(paras);
    let data = compressed ? z(raw) : raw;
    // 깨진 섹션: 압축 중간을 잘라 낸다(끝 블록 없음)
    if (brokenSection && compressed) data = data.subarray(0, Math.max(4, Math.floor(data.length / 2)));
    streams.push({ name: `Section${i}`, data, parent: 'BodyText' });
  });
  if (binBytes > 0) {
    // 그림 자리: 압축이 안 되는 바이트(파일만 크게 만든다, 글자 읽기는 건드리지 않아야 한다)
    const b = Buffer.alloc(binBytes); let x = 0x12345678;
    for (let i = 0; i < binBytes; i += 4) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; b.writeUInt32LE(x >>> 0, i < binBytes - 3 ? i : binBytes - 4); }
    streams.push({ name: 'BIN0001.jpg', data: b, parent: 'BinData' });
  }
  return cfb(streams);
}

// --- CFB 쓰기 --------------------------------------------------------------------
function cfb(streams) {
  const MINI = 64, CUTOFF = 4096;
  // 미니 스트림
  const minis = [], bigs = [];
  for (const s of streams) (s.data.length < CUTOFF ? minis : bigs).push(s);
  const miniFat = [];
  const miniParts = [];
  for (const s of minis) {
    const n = Math.max(1, Math.ceil(s.data.length / MINI));
    s.start = miniFat.length;
    for (let i = 0; i < n; i++) miniFat.push(i === n - 1 ? END : s.start + i + 1);
    const pad = Buffer.alloc(n * MINI); s.data.copy(pad); miniParts.push(pad);
  }
  const miniStream = Buffer.concat(miniParts);
  const miniFatBuf = Buffer.alloc(Math.max(SEC, Math.ceil(miniFat.length * 4 / SEC) * SEC), 0xff);
  miniFat.forEach((v, i) => miniFatBuf.writeUInt32LE(v >>> 0, i * 4));

  // 목차 항목
  const storages = ['BodyText', ...(streams.some(s => s.parent === 'BinData') ? ['BinData'] : [])];
  const entries = [{ name: 'Root Entry', type: 5 }];
  const idx = {};
  for (const st of storages) { idx[st] = entries.length; entries.push({ name: st, type: 1 }); }
  for (const s of streams) { s.dir = entries.length; entries.push({ name: s.name, type: 2, stream: s }); }
  const link = (parentIdx, kids) => { if (!kids.length) return; entries[parentIdx].child = kids[0]; for (let i = 0; i < kids.length - 1; i++) entries[kids[i]].right = kids[i + 1]; };
  link(0, [...storages.map(s => idx[s]), ...streams.filter(s => s.parent === 'root').map(s => s.dir)]);
  for (const st of storages) link(idx[st], streams.filter(s => s.parent === st).map(s => s.dir));
  const dirBuf = Buffer.alloc(Math.ceil(entries.length * 128 / SEC) * SEC);

  // 섹터 배치: [디렉터리][미니FAT][미니스트림][큰 스트림들] 뒤에 FAT·DIFAT
  const blobs = [
    { key: 'dir', len: dirBuf.length }, { key: 'minifat', len: miniFatBuf.length },
    { key: 'ministream', len: miniStream.length }, ...bigs.map(s => ({ key: s, len: s.data.length })),
  ];
  let next = 0;
  for (const b of blobs) { b.start = b.len ? next : END; b.count = Math.ceil(b.len / SEC); next += b.count; }
  const dataSectors = next;
  let fatCount = 1, difatCount = 0;
  for (;;) {
    const total = dataSectors + fatCount + difatCount;
    const needFat = Math.ceil(total / (SEC / 4));
    const needDifat = needFat > 109 ? Math.ceil((needFat - 109) / (SEC / 4 - 1)) : 0;
    if (needFat === fatCount && needDifat === difatCount) break;
    fatCount = needFat; difatCount = needDifat;
  }
  const fatStart = dataSectors, difatStart = dataSectors + fatCount;
  const total = dataSectors + fatCount + difatCount;
  const fat = new Uint32Array(fatCount * (SEC / 4)).fill(FREE);
  for (const b of blobs) for (let i = 0; i < b.count; i++) fat[b.start + i] = i === b.count - 1 ? END : b.start + i + 1;
  for (let i = 0; i < fatCount; i++) fat[fatStart + i] = FATSECT;
  for (let i = 0; i < difatCount; i++) fat[difatStart + i] = DIFSECT;

  const startOf = key => blobs.find(b => b.key === key).start;
  entries.forEach((e, i) => {
    const at = i * 128, name = Buffer.from(e.name + '\0', 'utf16le');
    name.copy(dirBuf, at); dirBuf.writeUInt16LE(name.length, at + 64); dirBuf[at + 66] = e.type; dirBuf[at + 67] = 1;
    dirBuf.writeUInt32LE(e.left ?? NOSTREAM, at + 68); dirBuf.writeUInt32LE(e.right ?? NOSTREAM, at + 72); dirBuf.writeUInt32LE(e.child ?? NOSTREAM, at + 76);
    if (e.type === 5) { dirBuf.writeUInt32LE(miniStream.length ? startOf('ministream') : END, at + 116); dirBuf.writeUInt32LE(miniStream.length, at + 120); }
    else if (e.type === 2) {
      const s = e.stream;
      dirBuf.writeUInt32LE(s.data.length < CUTOFF ? s.start : startOf(s), at + 116); dirBuf.writeUInt32LE(s.data.length, at + 120);
    } else { dirBuf.writeUInt32LE(0, at + 116); }
  });

  const out = Buffer.alloc((total + 1) * SEC);
  const h = out.subarray(0, SEC);
  Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(h, 0);
  h.writeUInt16LE(0x3e, 24); h.writeUInt16LE(3, 26); h.writeUInt16LE(0xfffe, 28); h.writeUInt16LE(9, 30); h.writeUInt16LE(6, 32);
  h.writeUInt32LE(fatCount, 44); h.writeUInt32LE(startOf('dir'), 48); h.writeUInt32LE(CUTOFF, 56);
  h.writeUInt32LE(miniFat.length ? startOf('minifat') : END, 60); h.writeUInt32LE(miniFat.length ? miniFatBuf.length / SEC : 0, 64);
  h.writeUInt32LE(difatCount ? difatStart : END, 68); h.writeUInt32LE(difatCount, 72);
  for (let i = 0; i < 109; i++) h.writeUInt32LE(i < fatCount ? fatStart + i : FREE, 76 + i * 4);
  const put = (sector, buf) => buf.copy(out, (sector + 1) * SEC);
  put(startOf('dir'), dirBuf); if (miniFat.length) put(startOf('minifat'), miniFatBuf); if (miniStream.length) put(startOf('ministream'), miniStream);
  for (const s of bigs) put(startOf(s), s.data);
  const fatBuf = Buffer.from(fat.buffer); put(fatStart, fatBuf);
  // DIFAT 사슬: 섹터마다 127개 FAT 섹터 번호 + 다음 DIFAT 섹터
  let rest = []; for (let i = 109; i < fatCount; i++) rest.push(fatStart + i);
  for (let k = 0; k < difatCount; k++) {
    const d = Buffer.alloc(SEC, 0xff), part = rest.slice(k * 127, (k + 1) * 127);
    part.forEach((v, i) => d.writeUInt32LE(v, i * 4));
    d.writeUInt32LE(k === difatCount - 1 ? END : difatStart + k + 1, 127 * 4);
    put(difatStart + k, d);
  }
  return new Uint8Array(out);
}

/** 보도자료 같은 문단 n개(한국어 문장, 표 컨트롤·탭 섞음). */
export function pressParas(n, seed = 1) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = `제${i + seed}항 공공기관 인력 충원과 노동조건 개선을 위한 협의 내용입니다.\t기한은 2026년 12월 ${(i % 28) + 1}일이며 담당 부서는 정원 확대 계획을 다시 제출한다.`;
    out.push(i % 7 === 3 ? { text: t, ctrl: 'table' } : t);
  }
  return out;
}
