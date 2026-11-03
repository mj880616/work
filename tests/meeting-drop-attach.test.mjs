// HOTFIX-회의첨부칸 ②(S48-53): 사업 보고 창 끌어 놓기 — 놓은 자리·이름 규칙으로 결과/자료를 나누고, 결과 본문은 묻고 넣는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sortDropped,resultBodyFor,readResultText,dropZoneOf} from '../app/meeting-drop-attach.js';

const f=name=>({name,size:10});
const detail=readFileSync(new URL('../app/meeting-round-detail.js',import.meta.url),'utf8');

test('놓은 자리가 결과·자료면 그 자리를 따르고, 아니면 이름 규칙, 모르면 묻는다(닫으면 자료)',async()=>{
  const asked=[];const ask=async(_a,o)=>{asked.push(o.text);return null};
  let r=await sortDropped([f('안건.pdf'),f('x.pdf')],{zone:'result',ask});
  assert.deepEqual(r.results.map(x=>x.name),['안건.pdf','x.pdf']);assert.equal(asked.length,0);
  r=await sortDropped([f('제5차 회의결과.pdf'),f('x.pdf')],{zone:'material',ask});
  assert.deepEqual(r.materials.map(x=>x.name),['제5차 회의결과.pdf','x.pdf']);
  r=await sortDropped([f('제5차 회의결과.pdf'),f('제5차 회의자료.pdf'),f('그림.pdf')],{ask});
  assert.deepEqual(r.results.map(x=>x.name),['제5차 회의결과.pdf']);
  assert.deepEqual(r.materials.map(x=>x.name),['제5차 회의자료.pdf','그림.pdf']);
  assert.equal(asked.length,1);assert.match(asked[0],/그림\.pdf/);
  r=await sortDropped([f('그림.pdf')],{ask:async()=>'result'});
  assert.deepEqual(r.results.map(x=>x.name),['그림.pdf']);
});

test('결과 본문: PDF·HWP만 읽고, 넣을지 물어 [넣기]면 글, [파일만]이면 빈 글',async()=>{
  const read=async file=>({text:file.name.endsWith('.pdf')?'본문 '+file.name:'',error:''});
  assert.equal(await readResultText([f('a.pdf'),f('b.docx')],{read}),'본문 a.pdf');
  assert.equal(await readResultText([f('b.docx')],{read}),'');
  let asked=0;const confirm=async(_a,o)=>{asked++;assert.equal(o.text,'결과 파일 본문을 결과 칸에 넣을까요?');return true};
  assert.equal(await resultBodyFor([f('결과.pdf'),f('회의자료.pdf')],{read,askOk:confirm,ask:async()=>null}),'본문 결과.pdf');
  assert.equal(asked,1);
  assert.equal(await resultBodyFor([f('결과.pdf')],{read,askOk:async()=>false}),'');
  // 결과 파일이 없으면 묻지도 읽지도 않는다.
  assert.equal(await resultBodyFor([f('회의자료.pdf')],{read:()=>{throw new Error('읽으면 안 됨')},askOk:()=>{throw new Error('묻지 않음')}}),'');
});

test('놓은 자리: 가장 가까운 data-drop-zone',()=>{
  assert.equal(dropZoneOf({closest:()=>({dataset:{dropZone:'material'}})}),'material');
  assert.equal(dropZoneOf({closest:()=>null}),'');assert.equal(dropZoneOf(null),'');
});

test('사업 보고 창: 결과·자료·사진 자리 표시, 보기·수정 면 모두 끌어 놓기 받음, 올리기는 기존 [+] 길',()=>{
  assert.match(detail,/id="mrdResultSection" class="[^"]*" data-drop-zone="result"/);
  assert.match(detail,/<label data-drop-zone="result"><span><span id="mrdEditTextLabel">/);
  assert.match(detail,/class="mrd-material-section mtg-group" data-drop-zone="material"/);
  assert.match(detail,/id="mrdPhotoSection" data-drop-zone="photo"/);
  assert.match(detail,/bindDropTarget\(card,\(files,e\)=>void mrdDropFiles\(files,e\),\(\)=>!!mrdCurrent&&mrdCanEdit\(mrdCurrent\)\)/);
  assert.match(detail,/async function mrdDropFiles\(files,e\)\{[\s\S]*?await mrdAddFiles\(others\);/);
});
