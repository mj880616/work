// LIB-폴더100단: 폴더 단 제한·들여쓰기 한도 한 곳 정의(app/folder-limits.mjs)와 서버 규칙·화면 사용처가 같은 숫자인지 본다. 네트워크·저장소 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FOLDER_DEPTH_LIMIT,FOLDER_INDENT_MAX,folderIndent,folderDepthLimitFrom} from '../app/folder-limits.mjs';
import * as tree from '../app/library-tree.js';
import {pickerRows} from '../app/library-move.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('한 곳 정의: 100단·들여쓰기 4단, 서버 규칙과 같은 숫자',()=>{
  assert.equal(FOLDER_DEPTH_LIMIT,100);assert.equal(FOLDER_INDENT_MAX,4);
  assert.equal(tree.FOLDER_DEPTH,FOLDER_DEPTH_LIMIT,'자료실 화면은 같은 숫자를 쓴다');
  const sql=read('supabase/migrations/20261028113000_library_folder_depth_100.sql').replace(/--.*$/gm,'');
  const limits=[...sql.matchAll(/limited to (\d+) levels/g)].map(m=>Number(m[1]));
  assert.ok(limits.length>=3);assert.ok(limits.every(n=>n===FOLDER_DEPTH_LIMIT),'서버 거절 글의 숫자 = 화면 한도');
  assert.match(sql,new RegExp(`if v_above >= ${FOLDER_DEPTH_LIMIT} then`));assert.match(sql,new RegExp(`if v_above \\+ v_height > ${FOLDER_DEPTH_LIMIT} then`));
  // 숫자는 이 파일 한 곳: 화면 파일에 3단 숫자를 따로 적지 않는다.
  for(const f of ['app/library-tree.js','app/library-folders.js','app/library-move.mjs'])assert.doesNotMatch(read(f),/FOLDER_DEPTH\s*=\s*\d|Math\.min\(n\.depth,\s*\d/,f);
});

test('들여쓰기는 4단까지만, 그보다 깊으면 더 밀지 않음',()=>{
  assert.deepEqual([-1,0,1,2,3,4,5,50,99,undefined,'3'].map(folderIndent),[0,0,1,2,3,4,4,4,4,0,3]);
  // 100단 사슬: 단 제한 안에서 끝까지 만들 수 있고, 들여쓰기는 4에서 멈춘다.
  const F=[];for(let i=1;i<=FOLDER_DEPTH_LIMIT;i++)F.push({id:'f'+i,project_id:null,parent_id:i>1?'f'+(i-1):null,name:'가상 '+i+'단',sort_order:0});
  assert.equal(tree.folderDepth(F,'f100'),100);
  assert.equal(tree.canAddChild(F,'f99'),true);assert.equal(tree.canAddChild(F,'f100'),false,'101단은 만들지 않는다');
  const html=tree.treeHtml([{kind:'folder',key:'f:x',label:'깊은',depth:37,files:[],children:[],count:0,kinds:[]}],{isOpen:()=>false,showAll:()=>false,fileHtml:()=>'',esc:s=>String(s),kindKey:k=>k});
  assert.match(html,/--lu-depth:4"/);
  const rows=pickerRows({folders:F,free:true}).all;
  assert.equal(rows.length,100);assert.deepEqual(rows.slice(0,6).map(r=>r.depth),[0,1,2,3,4,4],'옮길 곳 목록 들여쓰기도 4까지');
  // 깊은 폴더의 경로 이름은 가까운 6단만, 앞은 '…'로 줄인다.
  assert.equal(rows[99].label,'… › '+[95,96,97,98,99,100].map(i=>'가상 '+i+'단').join(' › '));
  assert.equal(rows[5].label,[1,2,3,4,5,6].map(i=>'가상 '+i+'단').join(' › '));
});

test('서버 거절 글의 숫자를 읽는다(DB 적용 전 3단 거절도 그대로 알림)',()=>{
  assert.equal(folderDepthLimitFrom('LIB_FOLDER_DEPTH: folders are limited to 3 levels'),3);
  assert.equal(folderDepthLimitFrom('LIB_FOLDER_DEPTH: folders are limited to 100 levels'),100);
  assert.equal(folderDepthLimitFrom('LIB_FOLDER_DEPTH: x'),FOLDER_DEPTH_LIMIT);assert.equal(folderDepthLimitFrom(null),FOLDER_DEPTH_LIMIT);
});
