// S48-45 ⑦ 클라우드 사이 옮기기 검사용: 받는 대로 조금씩 넣어 계산하는 MD5·SHA-1(파일을 통째로 메모리에 두지 않으려고).
// Web Crypto digest는 한 번에 다 넣어야 해서 쓰지 않는다. 비밀 보호용이 아니라 "옮긴 바이트가 원본과 같은가" 확인용이다.
// 구글 드라이브는 md5Checksum, 개인 원드라이브는 sha1Hash를 준다(색인 hash 칸과 같은 값).

abstract class Block64 {
  protected buf = new Uint8Array(64);
  protected fill = 0;
  protected total = 0;
  protected abstract block(b: Uint8Array): void;
  update(data: Uint8Array) {
    let i = 0;
    this.total += data.length;
    if (this.fill) {
      const n = Math.min(64 - this.fill, data.length);
      this.buf.set(data.subarray(0, n), this.fill);
      this.fill += n;
      i = n;
      if (this.fill < 64) return this;
      this.block(this.buf);
      this.fill = 0;
    }
    for (; i + 64 <= data.length; i += 64) this.block(data.subarray(i, i + 64));
    if (i < data.length) {
      this.buf.set(data.subarray(i), 0);
      this.fill = data.length - i;
    }
    return this;
  }
  protected pad(bigEndian: boolean) {
    const bits = this.total * 8;
    const padLen = this.fill < 56 ? 56 - this.fill : 120 - this.fill;
    const tail = new Uint8Array(padLen + 8);
    tail[0] = 0x80;
    const lo = bits >>> 0, hi = Math.floor(bits / 0x100000000) >>> 0;
    const v = new DataView(tail.buffer);
    if (bigEndian) {
      v.setUint32(padLen, hi);
      v.setUint32(padLen + 4, lo);
    } else {
      v.setUint32(padLen, lo, true);
      v.setUint32(padLen + 4, hi, true);
    }
    const total = this.total;
    this.update(tail);
    this.total = total;
  }
}

const hex = (words: number[], little: boolean) =>
  words.map((w) => {
    const b = [w >>> 24, (w >>> 16) & 255, (w >>> 8) & 255, w & 255];
    return (little ? b.reverse() : b).map((x) => x.toString(16).padStart(2, "0")).join("");
  }).join("");

const MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0);

export class Md5 extends Block64 {
  private h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  protected block(b: Uint8Array) {
    const v = new DataView(b.buffer, b.byteOffset, 64);
    const m = Array.from({ length: 16 }, (_, i) => v.getUint32(i * 4, true));
    let [a, bb, c, d] = this.h;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) { f = (bb & c) | (~bb & d); g = i; }
      else if (i < 32) { f = (d & bb) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = bb ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (bb | ~d); g = (7 * i) % 16; }
      const s = MD5_S[(i >> 4) * 4 + (i % 4)];
      const t = (a + f + MD5_K[i] + m[g]) >>> 0;
      a = d; d = c; c = bb;
      bb = (bb + ((t << s) | (t >>> (32 - s)))) >>> 0;
    }
    this.h = [(this.h[0] + a) >>> 0, (this.h[1] + bb) >>> 0, (this.h[2] + c) >>> 0, (this.h[3] + d) >>> 0];
  }
  hex() {
    this.pad(false);
    return hex(this.h, true);
  }
}

export class Sha1 extends Block64 {
  private h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  private w = new Uint32Array(80);
  protected block(b: Uint8Array) {
    const v = new DataView(b.buffer, b.byteOffset, 64), w = this.w;
    for (let i = 0; i < 16; i++) w[i] = v.getUint32(i * 4);
    for (let i = 16; i < 80; i++) { const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]; w[i] = (x << 1) | (x >>> 31); }
    let [a, bb, c, d, e] = this.h;
    for (let i = 0; i < 80; i++) {
      const f = i < 20 ? (bb & c) | (~bb & d) : i < 40 ? bb ^ c ^ d : i < 60 ? (bb & c) | (bb & d) | (c & d) : bb ^ c ^ d;
      const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
      e = d; d = c; c = ((bb << 30) | (bb >>> 2)) >>> 0; bb = a; a = t;
    }
    this.h = [(this.h[0] + a) >>> 0, (this.h[1] + bb) >>> 0, (this.h[2] + c) >>> 0, (this.h[3] + d) >>> 0, (this.h[4] + e) >>> 0];
  }
  hex() {
    this.pad(true);
    return hex(this.h, false);
  }
}
