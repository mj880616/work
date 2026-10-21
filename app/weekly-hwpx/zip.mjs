// WEEKLY-한글초안 시제품: .hwpx(OWPML) 묶음을 만들고 읽는 최소 zip 도구. 외부 라이브러리 없이 Node와 브라우저 양쪽에서
// 쓰도록 압축 함수(deflateRaw/inflateRaw)는 부르는 쪽이 넘긴다(Node: node:zlib, 브라우저: CompressionStream 'deflate-raw').
// OWPML 규칙: 첫 항목은 'mimetype'(압축 없이 저장), 나머지는 deflate.

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();
export const toBytes = data => (typeof data === 'string' ? enc.encode(data) : new Uint8Array(data));

// entries: [{name, data(string|Uint8Array), store?:boolean, packed?:Uint8Array}] → Uint8Array. 날짜는 1980-01-01 고정(같은 입력 → 같은 파일).
// packed: 미리 deflate한 몸통(브라우저의 비동기 압축 — writeZipAsync). 있으면 deflateRaw를 부르지 않는다.
export function writeZip(entries, {deflateRaw} = {}) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = enc.encode(entry.name);
    const raw = toBytes(entry.data);
    const store = entry.store || raw.length === 0;
    const body = store ? raw : toBytes(entry.packed ?? deflateRaw(raw));
    const crc = crc32(raw);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 0x0800, true); // UTF-8 이름
    head.setUint16(8, store ? 0 : 8, true);
    head.setUint16(10, 0, true);
    head.setUint16(12, 0x21, true);
    head.setUint32(14, crc, true);
    head.setUint32(18, body.length, true);
    head.setUint32(22, raw.length, true);
    head.setUint16(26, name.length, true);
    head.setUint16(28, 0, true);
    local.push(new Uint8Array(head.buffer), name, body);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, store ? 0 : 8, true);
    dir.setUint16(12, 0, true);
    dir.setUint16(14, 0x21, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, body.length, true);
    dir.setUint32(24, raw.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const centralSize = central.reduce((n, part) => n + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const parts = [...local, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

// 브라우저용: 압축이 비동기(CompressionStream)라 항목마다 먼저 압축한 뒤 묶는다. 결과는 writeZip과 같다.
export async function writeZipAsync(entries, {deflateRawAsync}) {
  const ready = [];
  for (const entry of entries) {
    const raw = toBytes(entry.data);
    const store = entry.store || raw.length === 0;
    ready.push({...entry, data: raw, store, packed: store ? undefined : toBytes(await deflateRawAsync(raw))});
  }
  return writeZip(ready);
}

// → [{name, data:Uint8Array, method, localOrder}] (중앙 목록 순서). 손상되면 Error.
export function readZip(bytes, {inflateRaw}) {
  return listZip(bytes).map(entry => finish(entry, entry.method === 8 ? toBytes(inflateRaw(entry.packed)) : entry.packed));
}
export async function readZipAsync(bytes, {inflateRawAsync}) {
  const out = [];
  for (const entry of listZip(bytes)) out.push(finish(entry, entry.method === 8 ? toBytes(await inflateRawAsync(entry.packed)) : entry.packed));
  return out;
}
function finish({name, method, crc, size, localAt}, data) {
  if (data.length !== size) throw new Error(`zip: ${name} 크기 불일치`);
  if (crc32(data) !== crc) throw new Error(`zip: ${name} CRC 불일치`);
  return {name, data, method, localAt};
}
// 한 항목을 풀었을 때 크기 상한(.hwpx 본문·머리는 수 MB 안쪽 — 이상한 파일이 메모리를 다 쓰지 않게).
export const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
// 중앙 목록 읽기(압축 풀기 전). 지원하지 않는 압축이면 Error.
function listZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('zip: 끝 표시가 없음');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const dec = new TextDecoder();
  const out = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('zip: 중앙 목록 손상');
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const packedSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    if (view.getUint32(localAt, true) !== 0x04034b50) throw new Error(`zip: ${name} 머리 손상`);
    const dataAt = localAt + 30 + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
    if (dataAt + packedSize > bytes.length) throw new Error(`zip: ${name} 몸통이 잘림`);
    const packed = bytes.subarray(dataAt, dataAt + packedSize);
    if (method !== 0 && method !== 8) throw new Error(`zip: ${name} 지원하지 않는 압축(${method})`);
    if (size > MAX_ENTRY_BYTES) throw new Error(`zip: ${name} 너무 큼`);
    out.push({name, packed, method, crc, size, localAt});
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
