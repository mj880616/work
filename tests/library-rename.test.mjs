// LIB-줄안이름바꾸기: app/library-rename.js(저장 값) + library-upload.js 연결 구조(메뉴 순서·F2·저장 길). 브라우저 없이 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renameBody,undoSnapshot,undoBody,rowMatches,RENAME_NOTE} from '../app/library-rename.js';

const NOW='2026-10-26T01:00:00.000Z';
const doc=extra=>({id:'d1',title:'AI가 붙인 제목',file_name:'원본.hwp',auto_classified:true,classification_note:'자동 분류',field_origin:{title:'ai',category:'ai'},...extra});

test('이름 바꾸기 값: 제목만 새로, 제목 칸은 user, 다른 칸 기록은 그대로',()=>{
  const body=renameBody(doc(),'새 이름',NOW);
  assert.deepEqual(body,{title:'새 이름',updated_at:NOW,auto_classified:false,classification_note:RENAME_NOTE,field_origin:{category:'ai',title:'user'}});
  assert.equal(RENAME_NOTE,'사용자 수정');
  // Drive 원본 파일 이름 칸은 보내지 않는다.
  assert.ok(!('file_name' in body));
});

test('field_origin 칸이 없는 판이면 보내지 않는다',()=>{
  const old=doc();delete old.field_origin;
  assert.ok(!('field_origin' in renameBody(old,'새 이름',NOW)));
});

test('되돌리기: 바꾸기 전 제목·분류 표시·기록을 그대로, 제목이 비어 있던 자료는 파일 이름',()=>{
  const d=doc();
  assert.deepEqual(undoBody(undoSnapshot(d),NOW),{title:'AI가 붙인 제목',auto_classified:true,classification_note:'자동 분류',field_origin:{title:'ai',category:'ai'},updated_at:NOW});
  assert.equal(undoSnapshot(doc({title:null})).title,'원본.hwp');
  const old=doc();delete old.field_origin;assert.ok(!('field_origin' in undoSnapshot(old)));
});

test('저장 응답 확인: 보낸 값과 같을 때만 통과(updated_at 제외)',()=>{
  const body=renameBody(doc(),'새 이름',NOW);
  assert.equal(rowMatches({...doc(),...body,updated_at:'서버 시각'},body),true);
  assert.equal(rowMatches({...doc(),...body,title:'다른 이름'},body),false);
});

test('자료실 연결: 메뉴 맨 위 [이름 바꾸기 F2] → … → [수정…] → 구분선 → [삭제], 줄 F2, 같은 서버 길',()=>{
  const src=readFileSync(new URL('../app/library-upload.js',import.meta.url),'utf8');
  const menu=src.slice(src.indexOf('luMenuPanel.innerHTML=`'),src.indexOf('luMenuPanel.hidden=false'));
  const order=['data-lu-rename','data-lu-hwp-edit','data-lu-drive-open','data-lu-download','data-lu-edit','fileMenuHtml','lu-menu-sep','data-lu-delete'].map(k=>menu.indexOf(k));
  assert.ok(order.every(i=>i>=0),String(order));
  assert.deepEqual([...order].sort((a,b)=>a-b),order);
  assert.match(menu,/>이름 바꾸기<span class="lu-menu-key"[^>]*>F2<\/span>/);
  assert.match(menu,/data-lu-edit="[^"]*">수정…<\/button>/);
  assert.match(src,/e\.key!=='F2'/);
  // 저장은 [수정] 창과 같은 app_documents PATCH, 제목 값은 library-rename.js가 만든다.
  const block=src.slice(src.indexOf('function luStartRename'),src.indexOf('function luFolderStatus'));
  assert.match(block,/\/rest\/v1\/app_documents\?id=eq\./);assert.match(block,/method:'PATCH'/);assert.match(block,/renameBody\(d,value\)/);
  for(const bad of ['local'+'Storage','session'+'Storage','indexed'+'DB','file_name:'])assert.ok(!block.includes(bad),bad);
  // 한글 입력 중 Enter(조합 확정)는 저장하지 않는다.
  assert.match(block,/isComposing/);
});
