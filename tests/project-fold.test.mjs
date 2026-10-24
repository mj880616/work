import test from 'node:test';
import assert from 'node:assert/strict';
import {foldedSet,partitionTree,blocks,foldedMetadata,foldSummary,isFoldedOwn,sameGroup} from '../app/project-fold.mjs';
// PRJ-목록접어두기: 접힘 규칙(합성 값만). 화면·서버 저장은 tests/app-e2e/project-fold.spec.mjs.
const P=(id,parent_id,folded)=>({id,parent_id:parent_id||null,metadata:{project_system:'v2',...(folded?{folded:true}:{})}});
const rows=[P('a'),P('b',null,true),P('c','b'),P('d','c'),P('e','a',true),P('f','a')];
test('접힌 상위의 하위는 같이 접히고, 하위 하나만 접을 수도 있다',()=>{
 assert.deepEqual([...foldedSet(rows)].sort(),['b','c','d','e']);
 assert.equal(isFoldedOwn(rows[2]),false);
});
test('펼친 것과 접은 것으로 나누어도 각자 순서가 그대로이고 아무것도 빠지지 않는다',()=>{
 const tree=[{project:rows[0],depth:0},{project:rows[4],depth:1},{project:rows[5],depth:1},{project:rows[1],depth:0},{project:rows[2],depth:1},{project:rows[3],depth:2}];
 const parts=partitionTree(tree,foldedSet(rows));
 assert.deepEqual(parts.open.map(r=>r.project.id),['a','f']);
 assert.deepEqual(parts.folded.map(r=>r.project.id),['e','b','c','d']);
 assert.equal(parts.open.length+parts.folded.length,tree.length);
 const b=blocks(parts.folded);
 assert.deepEqual(b.map(x=>x.head.id),['e','b']);
 assert.deepEqual(b[1].below.map(x=>[x.project.id,x.depth]),[['c',1],['d',2]]);
});
test('접기·다시 위로는 다른 metadata를 건드리지 않는다',()=>{
 assert.deepEqual(foldedMetadata({color:'blue',project_system:'v2'},true),{color:'blue',project_system:'v2',folded:true});
 assert.deepEqual(foldedMetadata({color:'blue',folded:true},false),{color:'blue'});
 assert.deepEqual(foldedMetadata(null,true),{folded:true});
});
test('한 줄 요약과 순서 바꾸기 칸',()=>{
 assert.deepEqual(foldSummary(['가','','나']),{count:3,names:'가, 이름 없는 프로젝트, 나'});
 const f=foldedSet(rows);
 assert.equal(sameGroup(f,rows[0],rows[5]),true);
 assert.equal(sameGroup(f,rows[0],rows[4]),false);
});
