// 빠짐10(LIB-정리보충 ⑤): 같은 글 원본 두 개(웹 + PDF/HWP)를 한 줄로 묶는 규칙 시험. 이름은 모두 합성 값.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {findTwins,twinPlan,withTwins,pickCountText,twinKey,isWebOriginal} from '../app/library-twins.mjs';

const doc=(id,title,file_name,extra={})=>({id,title,file_name,document_date:'2026-10-20',...extra});

test('웹 + PDF 같은 제목·같은 날짜는 묶고 대표는 웹이 아닌 원본',()=>{
  const files=[doc('w','가상 성명','a.html'),doc('p','가상 성명','a.pdf'),doc('x','다른 글','b.pdf')];
  const t=findTwins(files);
  assert.deepEqual([...t.keys()],['p']);
  assert.deepEqual(t.get('p').map(d=>d.id),['p','w']);
});
test('웹만 둘·PDF만 둘·날짜가 다르면 묶지 않는다',()=>{
  assert.equal(findTwins([doc('a','가상','a.html'),doc('b','가상','b.htm')]).size,0);
  assert.equal(findTwins([doc('a','가상','a.pdf'),doc('b','가상','b.hwp')]).size,0);
  assert.equal(findTwins([doc('a','가상','a.html'),doc('b','가상','b.pdf',{document_date:'2026-10-21'})]).size,0);
});
test('제목이 없으면 확장자 뺀 파일 이름, 띄어쓰기·대소문자 차이는 무시, 사진 묶음 줄은 제외',()=>{
  const t=findTwins([doc('w','','가상  Note.html'),doc('h','','가상 note.hwp'),{id:'s',photoset:true,title:'가상 note'}]);
  assert.deepEqual(t.get('h').map(d=>d.id),['h','w']);
  assert.equal(twinKey({title:'',file_name:''}),'');
  assert.equal(isWebOriginal({file_name:'x.pdf',mime_type:'text/html'}),true);
});
test('twinPlan은 토글마다 따로(다른 폴더의 같은 제목은 묶지 않음)',()=>{
  const nodes=[{files:[doc('w','가상','a.html')],children:[{files:[doc('p','가상','a.pdf')],children:[]}]}];
  assert.equal(twinPlan(nodes).size,0);
  const plan=twinPlan([{files:[doc('w','가상','a.html'),doc('p','가상','a.pdf')],children:[]}]);
  assert.deepEqual(plan.get('w'),{primary:'p',members:['p','w'],isPrimary:false});
  assert.equal(plan.get('p').isPrimary,true);
});
test('접힌 대표 줄을 고르면 같은 글도 함께, 펼친 묶음은 줄마다',()=>{
  const plan=twinPlan([{files:[doc('w','가상','a.html'),doc('p','가상','a.pdf'),doc('z','다른','z.pdf')],children:[]}]);
  assert.deepEqual(withTwins(['p','z'],plan),['p','w','z']);
  assert.deepEqual(withTwins(['p'],plan,id=>id==='p'),['p']);
  assert.deepEqual(withTwins(['w'],plan),['w']);
});
test('고른 개수 글자: 접힌 것이 있을 때만 "접힌 n개 포함"',()=>{
  assert.equal(pickCountText(3,0),'3개 골랐음');
  assert.equal(pickCountText(37,27),'37개 골랐음 — 접힌 27개 포함');
});
test('자료실 화면이 이 규칙을 쓰고 자료 행은 지우지 않는다(화면에서만 묶음)',()=>{
  const src=readFileSync(new URL('../app/library-upload.js',import.meta.url),'utf8');
  assert.match(src,/luTwins=twinPlan\(shown\)/);
  assert.match(src,/pickCountText\(/);
  assert.doesNotMatch(readFileSync(new URL('../app/library-twins.mjs',import.meta.url),'utf8'),/api\(|fetch\(|DELETE/);
});
