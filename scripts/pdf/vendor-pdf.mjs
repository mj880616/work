#!/usr/bin/env node
// MEET-파일로만들기: PDF 글자 읽기 라이브러리(pdf.js) 반입. 버전은 scripts/pdf/pdf-pin.json 한 곳에서만 정한다.
// 실행: node scripts/pdf/vendor-pdf.mjs (저장소 루트에서). npm 공개 저장소에서 tarball을 받아 pin의 sha512와
// 같은지 확인한 뒤 브라우저용 legacy 빌드 2개·LICENSE·한국어 글자표(cmaps)만 app/pdf-lib/<이름>-<버전>/에 복사하고
// SHA256SUMS·SOURCE.md를 다시 쓴다. 반입 파일은 직접 고치지 않는다.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cpSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,posix} from 'node:path';

const pin=JSON.parse(readFileSync('scripts/pdf/pdf-pin.json','utf8'));
const out=pin.folder;
if(out!=='app/pdf-lib')throw new Error('unexpected vendor folder: '+out);
const work=mkdtempSync(join(tmpdir(),'pdf-vendor-'));
rmSync(out,{recursive:true,force:true});
mkdirSync(out,{recursive:true});

const packed=JSON.parse(execFileSync('npm',['pack',`${pin.package}@${pin.version}`,'--json','--pack-destination',work],{encoding:'utf8'}))[0];
const tgz=join(work,packed.filename);
const integrity='sha512-'+createHash('sha512').update(readFileSync(tgz)).digest('base64');
if(integrity!==pin.integrity)throw new Error(`${pin.package}@${pin.version} integrity mismatch: ${integrity}`);
execFileSync('tar',['-xzf',tgz,'-C',work]);
const base=join(work,'package'),dest=join(out,`${pin.package}-${pin.version}`);
mkdirSync(join(dest,'cmaps'),{recursive:true});
for(const [from,to] of Object.entries(pin.files))cpSync(join(base,from),join(dest,to));
const cmap=new RegExp(pin.cmaps);
for(const file of readdirSync(join(base,'cmaps')).filter(name=>cmap.test(name)).sort())cpSync(join(base,'cmaps',file),join(dest,'cmaps',file));
cpSync(join(base,'cmaps','LICENSE'),join(dest,'cmaps','LICENSE'));
rmSync(work,{recursive:true,force:true});

const files=[];
const walk=dir=>{for(const entry of readdirSync(dir).sort()){const path=join(dir,entry);if(statSync(path).isDirectory())walk(path);else if(!['SHA256SUMS','SOURCE.md'].includes(posix.relative(out,path)))files.push(path);}};
walk(out);
const rows=files.map(path=>{const data=readFileSync(path);return {path:posix.relative(out,path),hash:createHash('sha256').update(data).digest('hex'),size:data.length};});
writeFileSync(join(out,'SHA256SUMS'),rows.map(row=>`${row.hash}  ${row.path}`).join('\n')+'\n');
const total=rows.reduce((sum,row)=>sum+row.size,0);
writeFileSync(join(out,'SOURCE.md'),`# PDF 글자 읽기 라이브러리 반입 기록

MEET-파일로만들기용. \`node scripts/pdf/vendor-pdf.mjs\`로 다시 만들 수 있다. 직접 고치지 않는다. 버전은 \`scripts/pdf/pdf-pin.json\` 한 곳에서 관리한다.

| 패키지 | 버전 | 라이선스 | npm sha512 | 파일 수 | 크기 |
| --- | --- | --- | --- | --- | --- |
| ${pin.package} | ${pin.version} | ${pin.license} | \`${pin.integrity}\` | ${rows.length} | ${(total/1048576).toFixed(2)} MiB |

- 넣은 파일: 오래된 폰 브라우저도 쓰는 legacy 빌드(\`pdf.min.mjs\`·\`pdf.worker.min.mjs\`), \`LICENSE\`, 한국어 글자표(\`cmaps/\`의 Adobe-Korea1·KSC·UniKS와 그 \`LICENSE\`). 나머지(소스맵·뷰어·표준 글꼴·다른 언어 글자표)는 넣지 않는다.
- 불러오는 시점: 회의 [파일·글로 만들기]에서 PDF 결과 파일을 읽을 때만(\`app/meeting-file-text.js\`). 글자만 읽고 화면에 그리지 않는다.
`);
console.log(`vendored ${rows.length} files, ${(total/1048576).toFixed(2)} MiB`);
