#!/usr/bin/env node
// MD-표시: 마크다운 표시 라이브러리 반입. 버전은 scripts/markdown/md-pin.json 한 곳에서만 정한다.
// 실행: node scripts/markdown/vendor-markdown.mjs (저장소 루트에서). npm 공개 저장소에서 tarball을 받아
// pin의 sha512와 같은지 확인한 뒤 필요한 파일만 app/markdown-lib/<이름>-<버전>/에 복사하고
// SHA256SUMS·SOURCE.md를 다시 쓴다. 반입 파일은 직접 고치지 않는다.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cpSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,posix} from 'node:path';

const pin=JSON.parse(readFileSync('scripts/markdown/md-pin.json','utf8'));
const out=pin.folder;
if(out!=='app/markdown-lib')throw new Error('unexpected vendor folder: '+out);
const work=mkdtempSync(join(tmpdir(),'md-vendor-'));
rmSync(out,{recursive:true,force:true});
mkdirSync(out,{recursive:true});

for(const [name,spec] of Object.entries(pin.packages)){
  const packed=JSON.parse(execFileSync('npm',['pack',`${name}@${spec.version}`,'--json','--pack-destination',work],{encoding:'utf8'}))[0];
  const tgz=join(work,packed.filename);
  const integrity='sha512-'+createHash('sha512').update(readFileSync(tgz)).digest('base64');
  if(integrity!==spec.integrity)throw new Error(`${name}@${spec.version} integrity mismatch: ${integrity}`);
  const unpack=join(work,name.replace(/\W/g,'_'));
  mkdirSync(unpack,{recursive:true});
  execFileSync('tar',['-xzf',tgz,'-C',unpack]);
  const base=join(unpack,'package'),dest=join(out,`${name}-${spec.version}`);
  mkdirSync(dest,{recursive:true});
  for(const [from,to] of Object.entries(spec.files)){
    if(from.includes('*')){
      const dir=posix.dirname(from),ext=posix.basename(from).replace('*','');
      mkdirSync(join(dest,to),{recursive:true});
      for(const file of readdirSync(join(base,dir)).filter(file=>file.endsWith(ext)).sort())cpSync(join(base,dir,file),join(dest,to,file));
    }else cpSync(join(base,from),join(dest,to));
  }
}
rmSync(work,{recursive:true,force:true});

const files=[];
const walk=dir=>{for(const entry of readdirSync(dir).sort()){const path=join(dir,entry);if(statSync(path).isDirectory())walk(path);else if(!['SHA256SUMS','SOURCE.md'].includes(posix.relative(out,path)))files.push(path);}};
walk(out);
const rows=files.map(path=>{const data=readFileSync(path);return {path:posix.relative(out,path),hash:createHash('sha256').update(data).digest('hex'),size:data.length};});
writeFileSync(join(out,'SHA256SUMS'),rows.map(row=>`${row.hash}  ${row.path}`).join('\n')+'\n');
const total=rows.reduce((sum,row)=>sum+row.size,0);
const mib=bytes=>(bytes/1048576).toFixed(2)+' MiB';
const table=Object.entries(pin.packages).map(([name,spec])=>{
  const own=rows.filter(row=>row.path.startsWith(`${name}-${spec.version}/`));
  return `| ${name} | ${spec.version} | ${spec.license} | \`${spec.integrity}\` | ${own.length} | ${mib(own.reduce((sum,row)=>sum+row.size,0))} |`;
}).join('\n');
writeFileSync(join(out,'SOURCE.md'),`# 마크다운 표시 라이브러리 반입 기록

MD-표시용. \`node scripts/markdown/vendor-markdown.mjs\`로 다시 만들 수 있다. 직접 고치지 않는다. 버전은 \`scripts/markdown/md-pin.json\` 한 곳에서 관리한다.

| 패키지 | 버전 | 라이선스 | npm sha512 | 파일 수 | 크기 |
| --- | --- | --- | --- | --- | --- |
${table}

- 넣은 파일: 브라우저에서 쓰는 빌드 파일 1개(KaTeX는 CSS와 woff2 글꼴 포함)와 각 패키지의 \`LICENSE\`. 나머지(소스맵·타입·다른 형식 글꼴)는 넣지 않는다.
- 총 ${rows.length}개 · ${mib(total)} (\`SHA256SUMS\` 참고, 이 기록 제외).
- 불러오는 시점: markdown-it·DOMPurify는 바구니 메모 읽기 화면을 열 때, Mermaid는 도식이 있는 글, KaTeX는 수식이 있는 글을 열 때만(\`app/markdown-view.js\`).
`);
console.log(`vendored ${rows.length} files, ${mib(total)}`);
