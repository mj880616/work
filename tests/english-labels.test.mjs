import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';

const read=path=>readFileSync(path,'utf8');
// Preserve each existing title while removing only the redundant English heading.
const inventory=[
  ['app/index.html','WEB2','업무 공간을 확인하고 있습니다.'],
  ['app/index.html','LIBRARY','자료 등록'],
  ['app/index.html','MEETING RESULT','회의 결과'],
  ['app/library-upload.js','LIBRARY','자료 분류 수정'],
  ['app/library-upload.js','EDIT METADATA','자료 정보 수정'],
  ['app/meeting-round-detail.js','MEETING RESULT','회의 결과'],
  ['app/project-system-v3.js','PROJECT','프로젝트 만들기'],
  ['app/project-system-v3.js','DELETE PROJECT','프로젝트 삭제'],
  ['app/project-system-v3.js','ARCHIVED PROJECTS','보관한 프로젝트'],
  ['app/suborganizations.js','SUB ORGANIZATION','담당조직 추가'],
  ['app/suborganizations.js','ASSIGNEES','담당자 지정'],
  ['app/workflow-ai-v3.js','AI MEETING DRAFT','회의 결과 초안 만들기'],
  ['app/workplace-detail.js','AFFILIATIONS','협의회·사업단 소속'],
  ['app/login/index.html','KPTU PUBLIC INSTITUTIONS TEAM','Workspace 로그인']
];
for(const [file,label,title] of inventory)test(`${file}: remove ${label}, keep ${title}`,()=>{
  const source=read(file);
  assert.ok(!source.includes(`<div class="eyebrow">${label}</div>`));
  assert.ok(source.includes(title));
});
test('all app headings contain no English uppercase eyebrow text',()=>{
  for(const entry of readdirSync('app',{recursive:true})){
    if(!/\.(js|html)$/.test(entry))continue;
    const source=read('app/'+entry);
    for(const heading of source.matchAll(/class=["'][^"']*\beyebrow\b[^"']*["'][^>]*>([^<]*)</g)){
      assert.ok(!/[A-Z]{2}/.test(heading[1]),`${entry}: ${heading[1]}`);
    }
  }
});
