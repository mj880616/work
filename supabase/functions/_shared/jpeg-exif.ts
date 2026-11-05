// S50-31 PHOTO-정보고치기 ②(설계 docs/design/photo-info-edit.md 5-2절, 명진 결정 E3 (가)·E5): JPEG 사진의 EXIF 찍은 시각·위치만 읽고 고치는 작은 부품.
// 원드라이브(onedrive-photos)·구글 드라이브(gdrive-photos)가 함께 쓴다. 외부 라이브러리 없음, Deno·Node 둘 다에서 돈다(파일·네트워크 없음, 메모리만).
// 원칙:
//  - 그림 바이트는 그대로다. 바꾸는 곳은 EXIF 조각(APP1 "Exif") 하나뿐이고, 그 앞뒤 JPEG 조각은 한 바이트도 바꾸지 않는다.
//  - EXIF 안에서는 칸 값만 그 자리에서 덮어쓴다. 칸을 더하거나 빼야 할 때만 그 IFD(칸 목록)를 EXIF 끝에 새로 적고 가리키는 곳 하나만 고친다.
//    기존 값의 자리(제조사 메모 MakerNote·썸네일 등)는 옮기지 않으므로 다른 칸이 깨지지 않는다.
//  - 찍은 시각은 서울 벽시계(UTC+9)로 적는다. 웹2 색인(원드라이브 graph.ts cameraClockToUtc, 드라이브 takenOf)이 시간대 없는 EXIF 시각을 서울로 읽는 규칙과 같다.
//    시간대 칸(OffsetTime*)이 이미 있으면 "+09:00"으로 맞춘다(없으면 더하지 않음).
//  - 위치 지우기는 GPS 칸 목록과 그 값을 0으로 덮고 가리키는 칸을 뺀다(파일 안에 옛 위치가 남지 않게). XMP에도 위치가 있으면 못 고침(xmp_location).
//  - 결과는 다시 읽어 요청한 값과 같은지 확인한 뒤에만 돌려준다(다르면 못 고침).
// 처음 판은 JPEG만(E5). PNG·WebP·HEIC·동영상은 부르는 쪽이 "못 고침"으로 뺀다.

export type JpegMeta = { taken: string | null; lat: number | null; lon: number | null; make: string | null; model: string | null };
export type MetaChange = { taken?: string; loc?: { lat: number; lon: number } | null };
export type ExifFail =
  | "not_jpeg" | "no_exif" | "exif_invalid" | "exif_too_big" | "xmp_location" | "change_invalid" | "verify_failed";

export const SEOUL_OFFSET = "+09:00";
const SEOUL_MS = 9 * 3600 * 1000;
const EXIF_HEAD = [0x45, 0x78, 0x69, 0x66, 0, 0]; // "Exif\0\0"
const SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 };
const T = { DATETIME: 0x0132, MAKE: 0x010f, MODEL: 0x0110, EXIF_PTR: 0x8769, GPS_PTR: 0x8825, ORIGINAL: 0x9003, DIGITIZED: 0x9004, OFFSET: 0x9010, OFFSET_ORIGINAL: 0x9011, OFFSET_DIGITIZED: 0x9012 };
const MAX_ENTRIES = 1000;

class Bad extends Error {
  reason: ExifFail;
  constructor(reason: ExifFail) {
    super(reason);
    this.reason = reason;
  }
}

// 찍은 시각(UTC ISO) → 서울 벽시계 EXIF 글자 "YYYY:MM:DD HH:MM:SS". 1990~2099년만.
export function seoulExifTime(iso: unknown): string | null {
  if (typeof iso !== "string" || iso.length > 40) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const s = new Date(Math.floor(ms / 1000) * 1000 + SEOUL_MS).toISOString();
  const y = Number(s.slice(0, 4));
  if (y < 1990 || y > 2099) return null;
  return `${s.slice(0, 4)}:${s.slice(5, 7)}:${s.slice(8, 10)} ${s.slice(11, 19)}`;
}
// EXIF 시각 글자(+시간대 칸) → UTC ISO. 시간대가 없거나 이상하면 서울로 본다.
export function exifTimeToIso(v: string | null, offset: string | null): string | null {
  const m = v ? /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(v) : null;
  if (!m || Number(m[1]) < 1900) return null;
  const zone = offset && /^[+-](0\d|1[0-4]):[0-5]\d$/.test(offset) ? offset : SEOUL_OFFSET;
  const ms = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${zone}`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
export function validLoc(v: unknown): v is { lat: number; lon: number } {
  if (!v || typeof v !== "object") return false;
  const { lat, lon } = v as { lat?: unknown; lon?: unknown };
  return typeof lat === "number" && typeof lon === "number" && Number.isFinite(lat) && Number.isFinite(lon) &&
    lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

// ---- JPEG 조각 찾기 ----
type App1 = { start: number; end: number; tiff: Uint8Array };
// partial: 파일 앞부분만 받은 경우(읽기 전용). 잘린 조각에서 멈추고 그때까지 찾은 것만 돌려준다.
function findSegments(b: Uint8Array, partial = false): { exif: App1 | null; xmpGps: boolean } {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) throw new Bad("not_jpeg");
  let i = 2, exif: App1 | null = null, xmpGps = false;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) throw new Bad("not_jpeg");
    const marker = b[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xd9 || marker === 0xda) break; // 그림 자료 시작(SOS)·끝: 그 뒤는 보지 않는다
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2) throw new Bad("not_jpeg");
    if (i + 2 + len > b.length) {
      if (partial) break;
      throw new Bad("not_jpeg");
    }
    const body = b.subarray(i + 4, i + 2 + len);
    if (marker === 0xe1) {
      if (!exif && body.length >= 14 && EXIF_HEAD.every((c, k) => body[k] === c)) {
        exif = { start: i, end: i + 2 + len, tiff: body.subarray(6) };
      } else if (startsWithText(body, "http://ns.adobe.com/xap/1.0/\0") && /GPS(Latitude|Longitude)/.test(latin1(body))) {
        xmpGps = true;
      }
    }
    i += 2 + len;
  }
  return { exif, xmpGps };
}
function startsWithText(b: Uint8Array, s: string) {
  if (b.length < s.length) return false;
  for (let k = 0; k < s.length; k++) if (b[k] !== s.charCodeAt(k)) return false;
  return true;
}
function latin1(b: Uint8Array) {
  let s = "";
  for (let k = 0; k < b.length; k += 8192) s += String.fromCharCode(...b.subarray(k, Math.min(b.length, k + 8192)));
  return s;
}

// ---- TIFF(EXIF 본문) 읽고 쓰기 ----
type Entry = { tag: number; type: number; count: number; at: number; dataAt: number; size: number };
class Tiff {
  buf: Uint8Array;
  len: number;
  le: boolean;
  constructor(src: Uint8Array) {
    this.buf = new Uint8Array(Math.max(64, src.length * 2 + 1024));
    this.buf.set(src);
    this.len = src.length;
    if (this.len < 8) throw new Bad("exif_invalid");
    const bo = String.fromCharCode(src[0], src[1]);
    if (bo !== "II" && bo !== "MM") throw new Bad("exif_invalid");
    this.le = bo === "II";
    if (this.u16(2) !== 42) throw new Bad("exif_invalid");
  }
  check(at: number, n: number) {
    if (at < 0 || n < 0 || at + n > this.len) throw new Bad("exif_invalid");
  }
  u16(at: number) {
    this.check(at, 2);
    return this.le ? this.buf[at] | (this.buf[at + 1] << 8) : (this.buf[at] << 8) | this.buf[at + 1];
  }
  u32(at: number) {
    this.check(at, 4);
    const b = this.buf;
    return (this.le ? (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) : ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3])) >>> 0;
  }
  put16(at: number, v: number) {
    if (this.le) { this.buf[at] = v & 255; this.buf[at + 1] = (v >> 8) & 255; } else { this.buf[at] = (v >> 8) & 255; this.buf[at + 1] = v & 255; }
  }
  put32(at: number, v: number) {
    for (let k = 0; k < 4; k++) this.buf[at + (this.le ? k : 3 - k)] = (v >>> (8 * k)) & 255;
  }
  // 끝에 붙이기(짝수 자리로 맞춤). 붙인 자리를 돌려준다.
  append(n: number) {
    if (this.len % 2) this.buf[this.len++] = 0;
    const at = this.len;
    if (at + n > this.buf.length) {
      const grown = new Uint8Array(Math.max(this.buf.length * 2, at + n + 1024));
      grown.set(this.buf.subarray(0, this.len));
      this.buf = grown;
    }
    this.buf.fill(0, at, at + n);
    this.len = at + n;
    return at;
  }
  ifd(at: number): { entries: Entry[]; next: number } {
    if (at < 8) throw new Bad("exif_invalid");
    const n = this.u16(at);
    if (n > MAX_ENTRIES) throw new Bad("exif_invalid");
    this.check(at + 2, n * 12 + 4);
    const entries: Entry[] = [];
    for (let k = 0; k < n; k++) {
      const e = at + 2 + k * 12, type = this.u16(e + 2), count = this.u32(e + 4), unit = SIZE[type];
      if (!unit) continue; // 모르는 종류는 읽지 않는다(그대로 둔다)
      const size = unit * count;
      const dataAt = size <= 4 ? e + 8 : this.u32(e + 8);
      if (size > 4) this.check(dataAt, size);
      entries.push({ tag: this.u16(e), type, count, at: e, dataAt, size });
    }
    return { entries, next: this.u32(at + 2 + n * 12) };
  }
  ascii(e: Entry | undefined): string | null {
    if (!e || e.type !== 2 || !e.count || e.size > 256) return null;
    let s = "";
    for (let k = 0; k < e.count; k++) {
      const c = this.buf[e.dataAt + k];
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s;
  }
  rationals(e: Entry | undefined): number[] | null {
    if (!e || (e.type !== 5 && e.type !== 10) || e.count !== 3) return null;
    const out: number[] = [];
    for (let k = 0; k < 3; k++) {
      const n = this.u32(e.dataAt + k * 8), d = this.u32(e.dataAt + k * 8 + 4);
      if (!d) return null;
      out.push(n / d);
    }
    return out;
  }
}

type Value = { type: number; count: number; bytes: (t: Tiff, at: number) => void };
const asciiValue = (s: string): Value => ({
  type: 2, count: s.length + 1, bytes: (t, at) => { for (let k = 0; k < s.length; k++) t.buf[at + k] = s.charCodeAt(k); t.buf[at + s.length] = 0; },
});
const longValue = (v: number): Value => ({ type: 4, count: 1, bytes: (t, at) => t.put32(at, v) });
const byteValue = (list: number[]): Value => ({ type: 1, count: list.length, bytes: (t, at) => list.forEach((v, k) => (t.buf[at + k] = v)) });
// 도·분·초(초는 1/10000 단위). 음수는 방향 칸(N/S·E/W)으로 따로 적는다.
function dmsValue(v: number): Value {
  const a = Math.abs(v);
  let deg = Math.floor(a), min = Math.floor((a - deg) * 60), sec = Math.round(((a - deg) * 60 - min) * 60 * 10000);
  if (sec >= 600000) { sec -= 600000; min++; }
  if (min >= 60) { min -= 60; deg++; }
  const parts = [[deg, 1], [min, 1], [sec, 10000]];
  return { type: 5, count: 3, bytes: (t, at) => parts.forEach(([n, d], k) => { t.put32(at + k * 8, n); t.put32(at + k * 8 + 4, d); }) };
}

// IFD 하나 고치기. 같은 종류·같은 개수면 그 자리에서 덮어쓰고, 칸을 더하거나 빼거나 모양이 다르면 IFD를 끝에 새로 적는다.
// changes: tag → 새 값(null = 빼기). onlyIfExists에 든 tag는 이미 있을 때만 고친다. 돌려주는 값: IFD 자리(그대로거나 새 자리).
function editIfd(t: Tiff, at: number, changes: Map<number, Value | null>, onlyIfExists: Set<number> = new Set()): number {
  const { entries, next } = t.ifd(at);
  const byTag = new Map(entries.map((e) => [e.tag, e]));
  let rebuild = false;
  for (const [tag, v] of changes) {
    const e = byTag.get(tag);
    if (!e) {
      if (v && !onlyIfExists.has(tag)) rebuild = true;
      continue;
    }
    if (!v || e.type !== v.type || e.count !== v.count) rebuild = true;
  }
  if (!rebuild) {
    for (const [tag, v] of changes) {
      const e = byTag.get(tag);
      if (e && v) {
        if (e.size <= 4) t.buf.fill(0, e.dataAt, e.dataAt + 4);
        v.bytes(t, e.dataAt);
      }
    }
    return at;
  }
  // 새 IFD: 기존 칸(빼는 칸 제외, 바꾸는 칸은 새 값) + 더하는 칸, tag 순서. 바꾸지 않는 칸은 값 자리를 그대로 가리킨다.
  const n = t.u16(at);
  type Row = { tag: number; raw?: Uint8Array; value?: Value };
  const rows: Row[] = [];
  for (let k = 0; k < n; k++) {
    const e = at + 2 + k * 12, tag = t.u16(e);
    if (changes.has(tag)) {
      const v = changes.get(tag);
      if (v) rows.push({ tag, value: v });
      continue;
    }
    rows.push({ tag, raw: t.buf.slice(e, e + 12) });
  }
  for (const [tag, v] of changes) if (v && !byTag.has(tag) && !onlyIfExists.has(tag) && !rows.some((r) => r.tag === tag)) rows.push({ tag, value: v });
  rows.sort((a, b) => a.tag - b.tag);
  // 값이 4바이트를 넘으면 먼저 끝에 적는다.
  const placed = rows.map((r) => {
    if (!r.value) return null;
    const size = SIZE[r.value.type] * r.value.count;
    if (size <= 4) return -1;
    const where = t.append(size);
    r.value.bytes(t, where);
    return where;
  });
  const out = t.append(2 + rows.length * 12 + 4);
  t.put16(out, rows.length);
  rows.forEach((r, k) => {
    const e = out + 2 + k * 12;
    if (r.raw) return void t.buf.set(r.raw, e);
    const v = r.value!;
    t.put16(e, r.tag);
    t.put16(e + 2, v.type);
    t.put32(e + 4, v.count);
    if (placed[k] === -1) v.bytes(t, e + 8);
    else t.put32(e + 8, placed[k]!);
  });
  t.put32(out + 2 + rows.length * 12, next);
  return out;
}

// IFD를 그 값까지 0으로 덮는다(위치 지우기 — 옛 위치가 파일에 남지 않게).
function wipeIfd(t: Tiff, at: number) {
  const { entries } = t.ifd(at);
  for (const e of entries) if (e.size > 4) t.buf.fill(0, e.dataAt, e.dataAt + e.size);
  const n = t.u16(at);
  t.buf.fill(0, at, at + 2 + n * 12 + 4);
}

function readTiff(t: Tiff): JpegMeta {
  const ifd0 = t.ifd(t.u32(4));
  const get = (list: Entry[], tag: number) => list.find((e) => e.tag === tag);
  const exifPtr = get(ifd0.entries, T.EXIF_PTR), gpsPtr = get(ifd0.entries, T.GPS_PTR);
  const exif = exifPtr && exifPtr.size === 4 ? t.ifd(t.u32(exifPtr.dataAt)).entries : [];
  const original = t.ascii(get(exif, T.ORIGINAL)) || t.ascii(get(ifd0.entries, T.DATETIME));
  const offset = t.ascii(get(exif, T.OFFSET_ORIGINAL)) || t.ascii(get(exif, T.OFFSET));
  let lat: number | null = null, lon: number | null = null;
  if (gpsPtr && gpsPtr.size === 4) {
    const g = t.ifd(t.u32(gpsPtr.dataAt)).entries;
    const la = t.rationals(get(g, 2)), lo = t.rationals(get(g, 4));
    const laRef = t.ascii(get(g, 1)), loRef = t.ascii(get(g, 3));
    if (la && lo) {
      const dec = (x: number[]) => x[0] + x[1] / 60 + x[2] / 3600;
      const a = dec(la) * (laRef === "S" ? -1 : 1), o = dec(lo) * (loRef === "W" ? -1 : 1);
      if (Number.isFinite(a) && Number.isFinite(o) && Math.abs(a) <= 90 && Math.abs(o) <= 180 && !(a === 0 && o === 0)) {
        lat = Math.round(a * 1e6) / 1e6;
        lon = Math.round(o * 1e6) / 1e6;
      }
    }
  }
  const text = (e: Entry | undefined) => {
    const s = t.ascii(e);
    return s ? s.trim().slice(0, 80) || null : null;
  };
  return { taken: exifTimeToIso(original, offset), lat, lon, make: text(get(ifd0.entries, T.MAKE)), model: text(get(ifd0.entries, T.MODEL)) };
}

// 사진 정보 읽기(찍은 시각·위치·카메라). EXIF가 없으면 모두 null(실패 아님).
// partial = 앞부분만 받은 바이트(EXIF는 파일 맨 앞 64KB 조각 안에 있다).
export function readJpegMeta(bytes: Uint8Array, partial = false): { ok: true; meta: JpegMeta } | { ok: false; reason: ExifFail } {
  try {
    const { exif } = findSegments(bytes, partial);
    if (!exif) return { ok: true, meta: { taken: null, lat: null, lon: null, make: null, model: null } };
    return { ok: true, meta: readTiff(new Tiff(exif.tiff)) };
  } catch (e) {
    return { ok: false, reason: e instanceof Bad ? e.reason : "exif_invalid" };
  }
}

// 사진 정보 고치기. 그림·다른 조각은 그대로 두고 EXIF 조각만 바꾼 새 바이트를 돌려준다.
export function writeJpegMeta(bytes: Uint8Array, change: MetaChange):
  { ok: true; bytes: Uint8Array<ArrayBuffer>; before: JpegMeta; after: JpegMeta } | { ok: false; reason: ExifFail } {
  try {
    const wall = change.taken === undefined ? null : seoulExifTime(change.taken);
    if ((change.taken !== undefined && !wall) || (change.loc !== undefined && change.loc !== null && !validLoc(change.loc)) ||
      (change.taken === undefined && change.loc === undefined)) throw new Bad("change_invalid");
    const { exif, xmpGps } = findSegments(bytes);
    if (!exif) throw new Bad("no_exif");
    if (change.loc !== undefined && xmpGps) throw new Bad("xmp_location");
    const t = new Tiff(exif.tiff);
    const before = readTiff(t);
    let ifd0 = t.u32(4);
    const ifd0Changes = new Map<number, Value | null>();
    const ifd0Only = new Set<number>();
    const first = t.ifd(ifd0).entries;
    const ptr = (tag: number) => {
      const e = first.find((x) => x.tag === tag);
      return e && e.size === 4 ? t.u32(e.dataAt) : null;
    };
    if (wall) {
      const exifAt = ptr(T.EXIF_PTR);
      const exifChanges = new Map<number, Value | null>([
        [T.ORIGINAL, asciiValue(wall)], [T.DIGITIZED, asciiValue(wall)],
        [T.OFFSET, asciiValue(SEOUL_OFFSET)], [T.OFFSET_ORIGINAL, asciiValue(SEOUL_OFFSET)], [T.OFFSET_DIGITIZED, asciiValue(SEOUL_OFFSET)],
      ]);
      const only = new Set([T.DIGITIZED, T.OFFSET, T.OFFSET_ORIGINAL, T.OFFSET_DIGITIZED]);
      let newExif: number;
      if (exifAt === null) {
        // Exif 칸 목록이 없으면 찍은 시각 칸 하나만 든 목록을 새로 만든다.
        const empty = t.append(6);
        t.put16(empty, 0);
        t.put32(empty + 2, 0);
        newExif = editIfd(t, empty, exifChanges, only);
      } else newExif = editIfd(t, exifAt, exifChanges, only);
      ifd0Changes.set(T.EXIF_PTR, longValue(newExif));
      ifd0Changes.set(T.DATETIME, asciiValue(wall));
      ifd0Only.add(T.DATETIME);
    }
    if (change.loc !== undefined) {
      const gpsAt = ptr(T.GPS_PTR);
      if (change.loc === null) {
        if (gpsAt !== null) {
          wipeIfd(t, gpsAt);
          ifd0Changes.set(T.GPS_PTR, null);
        }
      } else {
        const { lat, lon } = change.loc;
        const gpsChanges = new Map<number, Value | null>([
          [1, asciiValue(lat < 0 ? "S" : "N")], [2, dmsValue(lat)], [3, asciiValue(lon < 0 ? "W" : "E")], [4, dmsValue(lon)],
        ]);
        let at: number;
        if (gpsAt === null) {
          const empty = t.append(6);
          t.put16(empty, 0);
          t.put32(empty + 2, 0);
          gpsChanges.set(0, byteValue([2, 2, 0, 0]));
          at = editIfd(t, empty, gpsChanges);
        } else at = editIfd(t, gpsAt, gpsChanges);
        ifd0Changes.set(T.GPS_PTR, longValue(at));
      }
    }
    if (ifd0Changes.size) {
      const moved = editIfd(t, ifd0, ifd0Changes, ifd0Only);
      if (moved !== ifd0) t.put32(4, (ifd0 = moved));
    }
    const payload = 6 + t.len;
    if (payload + 2 > 0xffff) throw new Bad("exif_too_big");
    const out = new Uint8Array(bytes.length - (exif.end - exif.start) + 4 + payload);
    out.set(bytes.subarray(0, exif.start), 0);
    let p = exif.start;
    out[p++] = 0xff;
    out[p++] = 0xe1;
    out[p++] = ((payload + 2) >> 8) & 255;
    out[p++] = (payload + 2) & 255;
    out.set(EXIF_HEAD, p);
    out.set(t.buf.subarray(0, t.len), p + 6);
    out.set(bytes.subarray(exif.end), p + payload);
    // 다시 읽어 확인: 요청한 값이 그대로 읽히고, 바꾸지 않은 쪽은 그대로여야 한다.
    const check = readJpegMeta(out);
    if (!check.ok) throw new Bad("verify_failed");
    const after = check.meta;
    const near = (a: number | null, b: number | null) => a !== null && b !== null && Math.abs(a - b) < 1e-5;
    const sameTime = (a: string | null, b: string | null) => a === b;
    const want = change.taken === undefined ? before.taken : new Date(Math.floor(Date.parse(change.taken) / 1000) * 1000).toISOString();
    if (!sameTime(after.taken, want)) throw new Bad("verify_failed");
    if (change.loc === undefined) {
      if (after.lat !== before.lat || after.lon !== before.lon) throw new Bad("verify_failed");
    } else if (change.loc === null) {
      if (after.lat !== null || after.lon !== null) throw new Bad("verify_failed");
    } else if (!near(after.lat, change.loc.lat) || !near(after.lon, change.loc.lon)) throw new Bad("verify_failed");
    return { ok: true, bytes: out, before, after };
  } catch (e) {
    return { ok: false, reason: e instanceof Bad ? e.reason : "exif_invalid" };
  }
}

// 바꾼 것은 EXIF 조각뿐인가(그림 바이트 그대로) — 시험·서버 확인용.
export function sameOutsideExif(a: Uint8Array, b: Uint8Array): boolean {
  try {
    const x = findSegments(a).exif, y = findSegments(b).exif;
    if (!x || !y || x.start !== y.start) return false;
    const tailA = a.subarray(x.end), tailB = b.subarray(y.end);
    if (tailA.length !== tailB.length) return false;
    for (let k = 0; k < tailA.length; k++) if (tailA[k] !== tailB[k]) return false;
    for (let k = 0; k < x.start; k++) if (a[k] !== b[k]) return false;
    return true;
  } catch {
    return false;
  }
}
