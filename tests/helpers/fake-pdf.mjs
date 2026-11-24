// 시험용 가짜 PDF 만들기(네트워크 없음). 한글은 Type0 글꼴 + ToUnicode 표(2바이트 코드 → 글자)로 그린다 — 기관 보고서 PDF와 같은 모양.
// opts.objStm: 글꼴·페이지 사전을 객체 스트림(PDF 1.5)에 넣는다. opts.plain: 단순 글꼴(Helvetica, 표 없음) 영어 한 줄.
import {deflateSync} from 'node:zlib';

export function fakePdf(lines, {objStm = false, plain = false, encrypt = false} = {}) {
  const chars = [...new Set(lines.join(''))];
  const code = ch => chars.indexOf(ch) + 1; // 1부터
  const hex2 = n => n.toString(16).padStart(4, '0');
  const hexText = t => [...t].map(ch => hex2(code(ch))).join('');
  const content = plain
    ? `BT /F1 12 Tf 72 720 Td (${lines[0]}) Tj ET`
    : 'BT /F1 11 Tf 1 0 0 1 72 760 Tm ' + lines.map((l, i) => `${i ? '0 -16 Td ' : ''}[<${hexText(l.slice(0, 3))}> -400 <${hexText(l.slice(3))}>] TJ`).join(' ') + ' ET';
  const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${chars.length} beginbfchar\n${chars.map(ch => `<${hex2(code(ch))}> <${hex2(ch.charCodeAt(0))}>`).join('\n')}\nendbfchar\nendcmap\nend\nend`;
  const objs = [];
  const add = (body, stream = null) => { objs.push({body, stream}); return objs.length; };
  const catalog = add('<< /Type /Catalog /Pages 2 0 R >>');
  add('<< /Type /Pages /Kids [3 0 R] /Count 1 /Resources << /Font << /F1 4 0 R >> >> >>');
  add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 5 0 R >>');
  add(plain ? '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' : '<< /Type /Font /Subtype /Type0 /BaseFont /FakeGothic /Encoding /Identity-H /ToUnicode 6 0 R >>');
  add('', deflateSync(Buffer.from(content, 'latin1')));
  add('', deflateSync(Buffer.from(cmap, 'latin1')));
  const chunks = [Buffer.from('%PDF-1.5\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let size = chunks[0].length;
  const put = b => { chunks.push(b); size += b.length; };
  const inStm = objStm ? new Set([2, 3, 4]) : new Set();
  for (let i = 0; i < objs.length; i++) {
    const n = i + 1;
    if (inStm.has(n)) continue;
    const o = objs[i];
    if (o.stream) put(Buffer.concat([Buffer.from(`${n} 0 obj\n<< /Length ${o.stream.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), o.stream, Buffer.from('\nendstream\nendobj\n', 'latin1')]));
    else put(Buffer.from(`${n} 0 obj\n${o.body}\nendobj\n`, 'latin1'));
  }
  let last = objs.length;
  if (objStm) {
    const bodies = [...inStm].map(n => objs[n - 1].body);
    let off = 0;
    const head = [...inStm].map((n, k) => { const s = `${n} ${off}`; off += Buffer.byteLength(bodies[k], 'latin1') + 1; return s; }).join(' ') + ' ';
    const data = deflateSync(Buffer.from(head + bodies.join('\n') + '\n', 'latin1'));
    last += 1;
    put(Buffer.concat([Buffer.from(`${last} 0 obj\n<< /Type /ObjStm /N ${inStm.size} /First ${Buffer.byteLength(head, 'latin1')} /Length ${data.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream\nendobj\n', 'latin1')]));
  }
  put(Buffer.from(`trailer\n<< /Size ${last + 1} /Root ${catalog} 0 R${encrypt ? ' /Encrypt << /Filter /Standard >>' : ''} >>\nstartxref\n${size}\n%%EOF\n`, 'latin1'));
  return new Uint8Array(Buffer.concat(chunks));
}
