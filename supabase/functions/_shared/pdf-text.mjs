// S69 READ-첨부본문(사용자 11/24 "제목이 점점 힘들어지는.. 이건데"): 기관 게시판 글(한국은행 등)의 본문은 페이지가 아니라 첨부 PDF에 있다.
// 이 파일은 PDF 바이트에서 글자만 뽑는 작은 자체 읽기다(외부 라이브러리·외부 서비스 없음, AI 없음). note-import·news-feed가 _shared/attach-text.ts로 부른다.
// - 읽는 것: 페이지 내용 스트림의 글자 그리기(Tj·TJ·'·")와 줄 바꿈(Td·TD·T*·Tm 세로 이동). 폼 XObject(Do) 안 글자도 3단까지.
// - 글꼴: ToUnicode 표(bfchar·bfrange)로 코드를 글자로 바꾼다(한글 PDF는 거의 Identity-H + ToUnicode). 표가 없는 단순 글꼴은 1바이트 = Latin-1.
//   표가 없는 2바이트 글꼴(Type0)은 읽지 못한다(빈 글자 — 지어내지 않음).
// - 압축: FlateDecode만(DecompressionStream 'deflate' — Deno·Node 모두 내장). 다른 필터의 스트림은 건너뛴다.
// - 객체 스트림(ObjStm, PDF 1.5+)도 푼다. 암호 걸린 PDF(/Encrypt)는 읽지 않는다('').
// - 상한: 풀린 바이트 합 PDF_LIMITS.inflated, 페이지 PDF_LIMITS.pages, 글자 maxChars. 넘으면 거기까지만. 실패는 던지지 않고 ''(잘못된 파일 포함).

export const PDF_LIMITS = Object.freeze({ objects: 50000, inflated: 48 * 1024 * 1024, pages: 120, depth: 3, chars: 60000, tokens: 2000000 });

const latin1 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return s;
};
const toBytes = (s) => { const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff; return out; };

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%']);
const isWs = (c) => WS.has(c.charCodeAt(0));

// ---- 값 읽기(객체 본문·사전) ----------------------------------------------------------------------------------------
// 값 모양: 수 · {n: 이름} · {s: 바이트 글자} · 배열 · {d: {이름: 값}} · {r: 번호} · true/false/null.
class Lexer {
  constructor(s, i = 0, end = s.length) { this.s = s; this.i = i; this.end = end; }
  skip() {
    const s = this.s;
    while (this.i < this.end) {
      const c = s[this.i];
      if (isWs(c)) { this.i++; continue; }
      if (c === '%') { while (this.i < this.end && s[this.i] !== '\n' && s[this.i] !== '\r') this.i++; continue; }
      break;
    }
  }
  word() {
    const s = this.s, st = this.i;
    while (this.i < this.end && !isWs(s[this.i]) && !DELIM.has(s[this.i])) this.i++;
    return s.slice(st, this.i);
  }
  literal() {
    const s = this.s;
    let depth = 1, out = '';
    this.i++;
    while (this.i < this.end) {
      const c = s[this.i++];
      if (c === '\\') {
        const n = s[this.i++];
        if (n === undefined) break;
        if (n === 'n') out += '\n'; else if (n === 'r') out += '\r'; else if (n === 't') out += '\t'; else if (n === 'b') out += '\b'; else if (n === 'f') out += '\f';
        else if (n >= '0' && n <= '7') {
          let oct = n;
          for (let k = 0; k < 2 && this.i < this.end && s[this.i] >= '0' && s[this.i] <= '7'; k++) oct += s[this.i++];
          out += String.fromCharCode(parseInt(oct, 8) & 0xff);
        } else if (n === '\r') { if (s[this.i] === '\n') this.i++; }
        else if (n === '\n') { /* 줄 이음 */ }
        else out += n;
        continue;
      }
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (!depth) break; }
      out += c;
    }
    return { s: out };
  }
  hex() {
    const s = this.s;
    this.i++;
    let h = '';
    while (this.i < this.end && s[this.i] !== '>') { const c = s[this.i++]; if (/[0-9a-fA-F]/.test(c)) h += c; }
    this.i++;
    if (h.length % 2) h += '0';
    let out = '';
    for (let k = 0; k < h.length; k += 2) out += String.fromCharCode(parseInt(h.slice(k, k + 2), 16));
    return { s: out };
  }
  name() {
    this.i++;
    const raw = this.word();
    return { n: raw.replace(/#([0-9a-fA-F]{2})/g, (_, x) => String.fromCharCode(parseInt(x, 16))) };
  }
  // 값 하나. 객체 본문 안의 'n g R'은 참조로 묶는다. 못 읽으면 undefined.
  value(depth = 0) {
    if (depth > 40) return undefined;
    this.skip();
    if (this.i >= this.end) return undefined;
    const s = this.s, c = s[this.i];
    if (c === '/') return this.name();
    if (c === '(') return this.literal();
    if (c === '<') {
      if (s[this.i + 1] === '<') {
        this.i += 2;
        const d = {};
        while (true) {
          this.skip();
          if (this.i >= this.end) break;
          if (s[this.i] === '>' && s[this.i + 1] === '>') { this.i += 2; break; }
          const k = this.value(depth + 1);
          if (!k || typeof k !== 'object' || !('n' in k)) { if (k === undefined) break; continue; }
          d[k.n] = this.value(depth + 1);
        }
        return { d };
      }
      return this.hex();
    }
    if (c === '[') {
      this.i++;
      const arr = [];
      while (true) {
        this.skip();
        if (this.i >= this.end) break;
        if (s[this.i] === ']') { this.i++; break; }
        const v = this.value(depth + 1);
        if (v === undefined) break;
        arr.push(v);
      }
      return arr;
    }
    if (c === ']' || c === '>' || c === ')' || c === '{' || c === '}') { this.i++; return undefined; }
    const w = this.word();
    if (!w) { this.i++; return undefined; }
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) {
      // 'n g R' 참조 보기
      if (/^\d+$/.test(w)) {
        const save = this.i;
        this.skip();
        const g = this.word();
        if (/^\d+$/.test(g)) {
          this.skip();
          if (s[this.i] === 'R' && (this.i + 1 >= this.end || isWs(s[this.i + 1]) || DELIM.has(s[this.i + 1]))) { this.i++; return { r: Number(w) }; }
        }
        this.i = save;
      }
      return Number(w);
    }
    if (w === 'true') return true;
    if (w === 'false') return false;
    if (w === 'null') return null;
    return { op: w };
  }
}

// ---- 객체 모으기 ----------------------------------------------------------------------------------------------------
async function inflate(bytes, budget) {
  if (typeof DecompressionStream !== 'function') return null;
  try {
    const ds = new DecompressionStream('deflate');
    const writer = ds.writable.getWriter();
    writer.write(bytes).catch(() => {});
    writer.close().catch(() => {});
    const reader = ds.readable.getReader();
    const parts = [];
    let n = 0;
    while (true) {
      let r;
      try { r = await reader.read(); } catch { break; } // 끝이 잘린 스트림: 풀린 데까지
      if (r.done) break;
      n += r.value.byteLength;
      budget.used += r.value.byteLength;
      if (budget.used > PDF_LIMITS.inflated) { try { await reader.cancel(); } catch { /* ignore */ } budget.over = true; break; }
      parts.push(r.value);
    }
    const out = new Uint8Array(n);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.byteLength; }
    return out;
  } catch { return null; }
}
const nameOf = (v) => (v && typeof v === 'object' && 'n' in v ? v.n : null);

export async function pdfText(input, { maxChars = PDF_LIMITS.chars, maxPages = PDF_LIMITS.pages } = {}) {
  try {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const s = latin1(bytes);
    const at = s.indexOf('%PDF-');
    if (at === -1 || at > 1024) return '';
    const objs = new Map(); // 번호 → {v, stream: [st, en] | null}
    const re = /(\d+)\s+(\d+)\s+obj\b/g;
    let m, count = 0;
    while ((m = re.exec(s))) {
      if (++count > PDF_LIMITS.objects) break;
      const lx = new Lexer(s, m.index + m[0].length);
      const v = lx.value();
      lx.skip();
      let stream = null;
      if (s.startsWith('stream', lx.i)) {
        let st = lx.i + 6;
        if (s[st] === '\r') st++;
        if (s[st] === '\n') st++;
        const len = v && v.d && typeof v.d.Length === 'number' ? v.d.Length : -1;
        let en = -1;
        if (len >= 0 && st + len <= s.length && /^\s*endstream/.test(s.slice(st + len, st + len + 20))) en = st + len;
        else {
          // 길이를 모르면(간접 참조 등) endstream 앞까지 — 끝 줄바꿈은 뗀다(Deno 풀기는 압축 뒤 남는 바이트를 오류로 본다).
          const k = s.indexOf('endstream', st);
          en = k === -1 ? s.length : k;
          if (s[en - 1] === '\n') en--;
          if (s[en - 1] === '\r') en--;
        }
        stream = [st, en];
        re.lastIndex = en;
      } else re.lastIndex = lx.i;
      objs.set(Number(m[1]), { v, stream });
    }
    // 암호 걸린 PDF는 읽지 않는다(trailer 또는 xref 스트림 사전의 /Encrypt).
    if (/\/Encrypt\s*(\d+\s+\d+\s+R|<<)/.test(s.slice(Math.max(0, s.length - 4096))) || [...objs.values()].some((o) => o.v?.d?.Type?.n === 'XRef' && o.v.d.Encrypt)) return '';
    const budget = { used: 0, over: false };
    const decoded = new Map();
    async function streamOf(o) {
      if (!o?.stream) return null;
      if (decoded.has(o)) return decoded.get(o);
      const raw = toBytes(s.slice(o.stream[0], o.stream[1]));
      const f = o.v?.d?.Filter;
      const filters = Array.isArray(f) ? f.map(nameOf) : f ? [nameOf(f)] : [];
      let out = raw;
      for (const name of filters) {
        if (name === 'FlateDecode' || name === 'Fl') { out = await inflate(out, budget); if (!out) break; }
        else { out = null; break; }
      }
      const text = out ? latin1(out) : null;
      decoded.set(o, text);
      return text;
    }
    // 객체 스트림 풀기(이미 따로 있는 번호는 그대로 — 나중 판이 이긴다).
    for (const o of [...objs.values()]) {
      if (nameOf(o.v?.d?.Type) !== 'ObjStm' || budget.over) continue;
      const text = await streamOf(o);
      if (!text) continue;
      const n = Number(o.v.d.N) || 0, first = Number(o.v.d.First) || 0;
      const head = new Lexer(text, 0, first);
      const pairs = [];
      for (let k = 0; k < n; k++) { const a = head.value(), b = head.value(); if (typeof a !== 'number' || typeof b !== 'number') break; pairs.push([a, b]); }
      for (const [num, off] of pairs) {
        if (objs.has(num)) continue;
        const lx = new Lexer(text, first + off);
        objs.set(num, { v: lx.value(), stream: null });
      }
    }
    const get = (v, depth = 0) => {
      while (v && typeof v === 'object' && 'r' in v && depth++ < 20) v = objs.get(v.r)?.v;
      return v;
    };
    const objOf = (v) => (v && typeof v === 'object' && 'r' in v ? objs.get(v.r) : null);
    // 페이지 차례: Catalog → Pages 나무(Resources 물려받기). 못 찾으면 번호 순 Page들.
    const pages = [];
    const seen = new Set();
    const walk = (ref, inherited, depth) => {
      if (pages.length >= maxPages || depth > 30) return;
      const node = get(ref);
      if (!node?.d || seen.has(node)) return;
      seen.add(node);
      const res = node.d.Resources !== undefined ? node.d.Resources : inherited;
      const type = nameOf(node.d.Type);
      if (type === 'Pages' || Array.isArray(get(node.d.Kids))) { for (const kid of get(node.d.Kids) || []) walk(kid, res, depth + 1); return; }
      pages.push({ d: node.d, res });
    };
    const catalog = [...objs.values()].find((o) => nameOf(o.v?.d?.Type) === 'Catalog');
    if (catalog) walk(catalog.v.d.Pages, undefined, 0);
    if (!pages.length) {
      for (const [, o] of [...objs.entries()].sort((a, b) => a[0] - b[0])) {
        if (nameOf(o.v?.d?.Type) === 'Page') pages.push({ d: o.v.d, res: o.v.d.Resources });
        if (pages.length >= maxPages) break;
      }
    }
    const cmaps = new Map();
    async function fontOf(ref) {
      const key = ref && typeof ref === 'object' && 'r' in ref ? ref.r : null;
      if (key !== null && cmaps.has(key)) return cmaps.get(key);
      const d = get(ref)?.d;
      let font = { two: false, map: null, ranges: null };
      if (d) {
        font.two = nameOf(d.Subtype) === 'Type0';
        const tu = objOf(d.ToUnicode);
        const text = tu ? await streamOf(tu) : null;
        if (text) Object.assign(font, parseCmap(text));
      }
      if (key !== null) cmaps.set(key, font);
      return font;
    }
    const lines = [];
    let chars = 0;
    const out = { line: '', push(t) { this.line += t; }, br() { const l = this.line.replace(/[ \t ]+/g, ' ').trim(); if (l) { lines.push(l); chars += l.length; } this.line = ''; } };
    async function run(content, res, depth) {
      if (depth > PDF_LIMITS.depth || chars >= maxChars) return;
      const r = get(res)?.d || {};
      const fonts = get(r.Font)?.d || {};
      const xobjs = get(r.XObject)?.d || {};
      const lx = new Lexer(content);
      const ops = [];
      let font = null, lastY = null, tokens = 0;
      while (lx.i < lx.end && chars < maxChars) {
        if (++tokens > PDF_LIMITS.tokens) break;
        const v = lx.value();
        if (v === undefined) { if (lx.i >= lx.end) break; continue; }
        if (!(v && typeof v === 'object' && 'op' in v)) { ops.push(v); if (ops.length > 64) ops.shift(); continue; }
        const op = v.op;
        if (op === 'BI') { // 안쪽 그림: ID 다음 바이트를 건너 EI까지
          const k = content.indexOf('ID', lx.i);
          const e = k === -1 ? -1 : content.slice(k + 2).search(/\sEI(?=\s|$)/);
          lx.i = k === -1 || e === -1 ? lx.end : k + 2 + e + 3;
        } else if (op === 'Tf') { font = await fontOf(fonts[nameOf(ops[ops.length - 2])]); }
        else if (op === 'Tj' || op === "'" || op === '"') { if (op !== 'Tj') out.br(); const t = ops[ops.length - 1]; if (t && typeof t === 'object' && 's' in t) out.push(decode(t.s, font)); }
        else if (op === 'TJ') {
          const arr = ops[ops.length - 1];
          if (Array.isArray(arr)) for (const it of arr) {
            if (it && typeof it === 'object' && 's' in it) out.push(decode(it.s, font));
            else if (typeof it === 'number' && it < -250 && !/\s$/.test(out.line)) out.push(' ');
          }
        } else if (op === 'Td' || op === 'TD') { const ty = ops[ops.length - 1]; if (typeof ty === 'number' && Math.abs(ty) > 0.5) out.br(); }
        else if (op === 'T*') out.br();
        else if (op === 'Tm') { const y = ops[ops.length - 1]; if (typeof y === 'number') { if (lastY !== null && Math.abs(y - lastY) > 0.5) out.br(); lastY = y; } }
        else if (op === 'ET') { /* 줄은 다음 이동에서 */ }
        else if (op === 'Do') {
          const x = objOf(xobjs[nameOf(ops[ops.length - 1])]);
          if (x && nameOf(x.v?.d?.Subtype) === 'Form') { const text = await streamOf(x); if (text) { out.br(); await run(text, x.v.d.Resources ?? res, depth + 1); out.br(); } }
        }
        ops.length = 0;
      }
    }
    for (const p of pages) {
      if (chars >= maxChars || budget.over) break;
      const c = get(p.d.Contents);
      const list = Array.isArray(c) ? c : [p.d.Contents];
      const parts = [];
      for (const ref of list) { const o = objOf(ref); const t = o ? await streamOf(o) : null; if (t) parts.push(t); }
      if (!parts.length) continue;
      await run(parts.join('\n'), p.res, 0);
      out.br();
    }
    out.br();
    const text = lines.join('\n');
    return [...text].slice(0, maxChars).join('');
  } catch { return ''; }
}

// ---- ToUnicode 표 ---------------------------------------------------------------------------------------------------
const hexNum = (h) => parseInt(h || '0', 16);
function utf16(hex) {
  const codes = [];
  for (let k = 0; k + 4 <= hex.length; k += 4) codes.push(parseInt(hex.slice(k, k + 4), 16));
  if (hex.length % 4 === 2) codes.push(parseInt(hex.slice(-2), 16));
  try { return String.fromCharCode(...codes); } catch { return ''; }
}
export function parseCmap(text) {
  const map = new Map();
  const widths = new Set();
  for (const block of text.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) {
    for (const r of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) widths.add(Math.ceil(r[1].length / 2));
  }
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const r of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) { map.set(hexNum(r[1]), utf16(r[2])); widths.add(Math.ceil(r[1].length / 2)); }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const r of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
      const lo = hexNum(r[1]), hi = hexNum(r[2]);
      if (hi < lo || hi - lo > 65535) continue;
      widths.add(Math.ceil(r[1].length / 2));
      if (r[3].startsWith('[')) {
        const items = [...r[3].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => x[1]);
        for (let k = 0; k < items.length && lo + k <= hi; k++) map.set(lo + k, utf16(items[k]));
      } else {
        const base = r[3].slice(1, -1);
        const head = base.slice(0, -4), last = parseInt(base.slice(-4) || '0', 16);
        for (let c = lo; c <= hi; c++) map.set(c, utf16(head + (last + c - lo).toString(16).padStart(4, '0').slice(-4)));
      }
    }
  }
  const w = [...widths].filter((x) => x >= 1 && x <= 4).sort((a, b) => a - b);
  return { map, width: w.length === 1 ? w[0] : w.includes(2) ? 2 : (w[0] || null) };
}
// 바이트 글자 → 글자. 표가 있으면 표로(너비는 표의 코드 너비, 없으면 Type0이면 2·아니면 1). 표가 없으면 단순 글꼴만 Latin-1.
function decode(raw, font) {
  if (!font || !font.map) {
    if (font?.two) return '';
    return raw.replace(/[\x00-\x1f]/g, ' ');
  }
  const width = font.width || (font.two ? 2 : 1);
  let out = '';
  for (let k = 0; k + width <= raw.length; k += width) {
    let code = 0;
    for (let j = 0; j < width; j++) code = code * 256 + raw.charCodeAt(k + j);
    const t = font.map.get(code);
    if (t !== undefined) out += t;
    else if (width === 1 && code >= 0x20 && code < 0x7f) out += String.fromCharCode(code);
  }
  return out.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}
