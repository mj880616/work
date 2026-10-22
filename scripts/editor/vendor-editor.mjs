#!/usr/bin/env node
// ED-통합편집기 ①a: ProseMirror 반입. 버전은 scripts/editor/editor-pin.json 한 곳에서만 정한다.
// 실행: node scripts/editor/vendor-editor.mjs (저장소 루트에서). npm 공개 저장소에서 패키지마다 tarball을 받아 pin의 sha512와
// 같은지 확인한 뒤, 고정 버전 esbuild로 entry.mjs를 한 파일(ESM)로 묶어 app/editor-lib/<묶음>-<판>/에 둔다. 패키지가 여럿이라
// 브라우저가 따로 받으면 같은 패키지가 두 번 들어가 깨질 수 있어 반드시 묶는다. 묶음 파일·LICENSE를 직접 고치지 않는다.
// 작업 폴더는 저장소 안 .editor-vendor-tmp/이며 끝나면 지운다(저장소 밖에 파일을 만들지 않음).
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,readdirSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {join,posix,resolve} from 'node:path';

const pin=JSON.parse(readFileSync('scripts/editor/editor-pin.json','utf8'));
const out=pin.folder;
if(out!=='app/editor-lib')throw new Error('unexpected vendor folder: '+out);
const work=resolve('.editor-vendor-tmp');
rmSync(work,{recursive:true,force:true});
mkdirSync(join(work,'node_modules'),{recursive:true});
const env={...process.env,npm_config_cache:join(work,'npm-cache')};
const licenses=[];
try{
  for(const [name,spec] of Object.entries(pin.packages)){
    const packed=JSON.parse(execFileSync('npm',['pack',`${name}@${spec.version}`,'--json','--pack-destination',work],{encoding:'utf8',env}))[0];
    const tgz=join(work,packed.filename);
    const integrity='sha512-'+createHash('sha512').update(readFileSync(tgz)).digest('base64');
    if(integrity!==spec.integrity)throw new Error(`${name}@${spec.version} integrity mismatch: ${integrity}`);
    const dest=join(work,'node_modules',name);
    mkdirSync(dest,{recursive:true});
    execFileSync('tar',['-xzf',tgz,'-C',dest,'--strip-components=1']);
    const lic=readdirSync(dest).find(f=>/^LICEN[CS]E/i.test(f));
    if(!lic)throw new Error('no license file: '+name);
    licenses.push(`== ${name}@${spec.version} (${spec.license}) ==\n${readFileSync(join(dest,lic),'utf8').trim()}\n`);
  }
  // esbuild: fixed version, installed only into the work folder (no scripts run).
  execFileSync('npm',['install','--no-save','--no-package-lock','--ignore-scripts','--no-audit','--no-fund','--prefix',join(work,'tool'),`esbuild@${pin.esbuild}`],{stdio:'inherit',env});
  const {build}=await import(join(work,'tool','node_modules','esbuild','lib','main.js'));
  const dest=join(out,`${pin.bundle.name}-${pin.bundle.version}`);
  rmSync(out,{recursive:true,force:true});
  mkdirSync(dest,{recursive:true});
  await build({entryPoints:[resolve('scripts/editor/entry.mjs')],bundle:true,format:'esm',minify:true,target:'es2020',
    outfile:join(dest,pin.bundle.file),nodePaths:[join(work,'node_modules')],legalComments:'none',logLevel:'warning',
    banner:{js:`/* ${pin.bundle.name}-${pin.bundle.version}: ProseMirror (MIT) bundle — see LICENSE and ../SOURCE.md */`}});
  writeFileSync(join(dest,'LICENSE'),licenses.join('\n'));
}finally{rmSync(work,{recursive:true,force:true});}

const files=[];
const walk=dir=>{for(const entry of readdirSync(dir).sort()){const path=join(dir,entry);if(statSync(path).isDirectory())walk(path);else if(!['SHA256SUMS','SOURCE.md'].includes(posix.relative(out,path)))files.push(path);}};
walk(out);
const rows=files.map(path=>{const data=readFileSync(path);return {path:posix.relative(out,path),hash:createHash('sha256').update(data).digest('hex'),size:data.length};});
writeFileSync(join(out,'SHA256SUMS'),rows.map(row=>`${row.hash}  ${row.path}`).join('\n')+'\n');
const kib=bytes=>(bytes/1024).toFixed(1)+' KiB';
const table=Object.entries(pin.packages).map(([name,spec])=>`| ${name} | ${spec.version} | ${spec.license} | \`${spec.integrity}\` |`).join('\n');
writeFileSync(join(out,'SOURCE.md'),`# 편집기 라이브러리 반입 기록

ED-통합편집기용(설계 \`docs/design/unified-editor.md\` 2.2). \`node scripts/editor/vendor-editor.mjs\`로 다시 만들 수 있다. 직접 고치지 않는다.
버전은 \`scripts/editor/editor-pin.json\` 한 곳에서 관리한다. 패키지 하나라도 바꾸면 pin의 \`bundle.version\`을 올려 폴더 이름(=주소)을 바꾼다
(판 번호 폴더 안쪽은 빌드가 \`?v=\`를 붙이지 않으므로 같은 주소에 다른 내용을 두지 않는다).

| 패키지 | 버전 | 라이선스 | npm sha512 |
| --- | --- | --- | --- |
${table}

- 묶기: esbuild ${pin.esbuild}(고정)로 \`scripts/editor/entry.mjs\`를 한 파일 ESM(\`${pin.bundle.name}-${pin.bundle.version}/${pin.bundle.file}\`, ${kib(rows.find(r=>r.path.endsWith(pin.bundle.file)).size)})로 묶었다. 각 패키지 라이선스 전문은 같은 폴더 \`LICENSE\`.
- 불러오는 시점: 새 편집기를 열 때만(\`app/ed-editor.js\`). 읽기 화면(Web1 공유 페이지 포함)은 이 묶음을 받지 않는다(\`app/ed-render.mjs\`).
`);
console.log(`vendored ${rows.length} files`);
