// MEET-파일로만들기 검사용: 글자 몇 줄만 든 아주 작은 PDF(Helvetica, 한 쪽)를 만든다. 외부 파일 없이 검사 안에서 쓴다.
export function tinyPdf(lines){
  const esc=s=>String(s).replace(/[\\()]/g,c=>'\\'+c);
  const stream=['BT','/F1 14 Tf','72 760 Td','18 TL',...lines.map((line,i)=>(i?'T* ':'')+`(${esc(line)}) Tj`),'ET'].join('\n');
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out='%PDF-1.4\n';const offsets=[];
  objects.forEach((body,i)=>{offsets.push(out.length);out+=`${i+1} 0 obj\n${body}\nendobj\n`});
  const xref=out.length;
  out+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('');
  out+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out,'latin1');
}
