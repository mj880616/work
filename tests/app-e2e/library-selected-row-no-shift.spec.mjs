import {test,expect} from '@playwright/test';
import {bootLibrary,libFolder,libDoc} from './helpers/library-folder-server.mjs';
import {libraryTopMenu} from './helpers/library-tree.mjs';
// S70-07 LIB-고른줄칩넘침(명진 11/25 09:37 "자료실쪽 파일 드래그한 결과인데 여기 파일유형 버튼이 삐져나온거 이거 수정해야할듯"):
// 고른 줄의 종류 칩(PDF·HWP)·분류 칩이 칸 왼쪽 경계 밖으로 밀려 나갔다. 원인: 줄 끝 ⋯의 44px 누르는 자리(base-ui.css 공용 ::after)가
// 단추 오른쪽으로 6px 나와 칸 목록(overflow:auto)에 가로 넘침이 생기고, 고르는 동안 목록이 그만큼 옆으로 밀렸다(고른 줄 바탕이 경계에 걸려 보임).
// 지키는 것: 끌어서·눌러서 고른 뒤에도 모든 줄의 종류 칩 왼쪽 끝이 고르기 전과 같고(±0.5px), 고른 줄 = 안 고른 줄, 칸 왼쪽 경계 안쪽. 이름은 지어낸 것.
const IDS=['d-1','d-2','d-3','d-4','d-5'];
const docsOf=folder=>IDS.map((id,i)=>libDoc(id,null,{title:'가상 자료 '+(i+1),file_name:id+(i%2?'.hwp':'.pdf'),document_date:'2026-10-0'+(i+1)}));
const FOLDERS=[libFolder('src',null,{name:'가상 시작',sort_order:1024}),libFolder('dst',null,{name:'가상 도착',sort_order:2048})];
const ITEMS=IDS.map(id=>({document_id:id,folder_id:'src'}));
const count=page=>page.locator('#librarySelectCount');
// 목록 칸(scope)의 왼쪽 경계(테두리 안쪽)와 줄마다 종류 칩 왼쪽 끝.
const measure=(page,scope)=>page.evaluate(sel=>{
  const box=document.querySelector(sel),b=box.getBoundingClientRect(),edge=b.left+(parseFloat(getComputedStyle(box).borderLeftWidth)||0);
  const rows=[...box.querySelectorAll('.lu-row[data-lu-document]')].map(r=>({id:r.dataset.luDocument,picked:r.classList.contains('lu-picked'),kind:r.querySelector('.lu-file-kind').getBoundingClientRect().left,row:r.getBoundingClientRect().left}));
  return {edge,rows};
},scope);
// 누름 반응(press-feedback) 같은 짧은 움직임이 끝나 두 번 잰 값이 같아질 때까지 기다린 뒤의 자리.
async function settled(page,scope){
  let prev=await measure(page,scope);
  for(let n=0;n<20;n++){await page.waitForTimeout(80);const cur=await measure(page,scope);if(JSON.stringify(cur)===JSON.stringify(prev))return cur;prev=cur}
  return prev;
}
function expectSame(before,after,label){
  const at=new Map(before.rows.map(r=>[r.id,r.kind]));
  expect(after.rows.some(r=>r.picked),label+': 고른 줄이 있다').toBe(true);
  expect(after.rows.some(r=>!r.picked),label+': 안 고른 줄도 있다').toBe(true);
  const plain=after.rows.find(r=>!r.picked).kind;
  for(const r of after.rows){
    expect(Math.abs(r.kind-at.get(r.id)),`${label}: ${r.id} 종류 칩이 고르기 전 자리 그대로`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(r.kind-plain),`${label}: ${r.id} 고른 줄 = 안 고른 줄`).toBeLessThanOrEqual(0.5);
    expect(r.row,`${label}: ${r.id} 줄이 칸 왼쪽 경계 안쪽`).toBeGreaterThanOrEqual(after.edge-0.5);
    expect(r.kind,`${label}: ${r.id} 칩이 칸 왼쪽 경계 안쪽`).toBeGreaterThanOrEqual(after.edge-0.5);
  }
}
// 칸 목록 마지막 줄 아래 빈 곳에서 위로 끌기(S69-17 끌어 고르기).
async function marqueeUp(page,listSel,toSel){
  const from=await page.locator(listSel).evaluate(list=>{const rows=[...list.querySelectorAll('.lu-row[data-lu-document]')],last=rows[rows.length-1].getBoundingClientRect(),b=list.getBoundingClientRect();return {x:last.left+last.width/2,y:Math.min(b.bottom-10,last.bottom+40)}});
  await page.keyboard.down('Control');
  await page.mouse.move(from.x,from.y);await page.mouse.down();
  await page.mouse.move(from.x+6,from.y-8,{steps:3});
  await expect(page.locator('.marquee-box')).toBeVisible();
  const y=await page.locator(toSel).evaluate(el=>{const b=el.getBoundingClientRect();return b.top+b.height/2});
  await page.mouse.move(from.x+30,y,{steps:6});
  await page.mouse.up();
  await page.keyboard.up('Control');
  await expect(page.locator('.marquee-box')).toHaveCount(0);
}

for(const i of [0,1])test(`PC 1280 두 칸 ${i?'오른쪽':'왼쪽'} 칸: 끌어서·눌러서 고른 줄의 종류 칩이 제자리, 칸 경계 안쪽`,async({page})=>{
  test.setTimeout(60000);
  const {errors}=await bootLibrary(page,1280,{folders:FOLDERS,items:ITEMS,docs:docsOf('src'),group:'폴더',init:{viewPrefs:null}});
  const pane=`#documentList [data-lu-pane-i="${i}"]`,list=`${pane} .lu-pane-list`,row=id=>`${pane} [data-lu-document="${id}"]`;
  await page.locator(`${pane} [data-lu-nav="src"]`).click({button:'right'});
  await page.locator('#luFolderMenu [data-lu-folder-action="enter"]').click();
  for(const id of IDS)await expect(page.locator(row(id))).toBeVisible();
  const before=await settled(page,pane);
  // 끌어서: 아래 줄들(d-1부터 위로). 눌러서: Ctrl+클릭으로 맨 위 d-5 더하기.
  await marqueeUp(page,list,row('d-2'));
  await expect(page.locator(row('d-1'))).toHaveClass(/lu-picked/);
  await expect(page.locator(row('d-5'))).not.toHaveClass(/lu-picked/);
  await page.keyboard.down('Control');
  await page.locator(row('d-5')+' .lu-row-title').click();
  await page.keyboard.up('Control');
  await expect(page.locator(row('d-5'))).toHaveClass(/lu-picked/);
  // 터치패드로 목록을 굴릴 때처럼 옆으로도 조금 민다(가로 넘침이 있으면 여기서 칸 목록이 밀린다).
  const lb=await page.locator(list).boundingBox();
  await page.mouse.move(lb.x+lb.width/2,lb.y+lb.height/2);
  await page.mouse.wheel(40,0);
  const after=await settled(page,pane);
  if(i===1)await page.locator('#documentList .lu-two').screenshot({path:'test-results/ui-audit/s70-07-library-picked-1280.png'});
  expectSame(before,after,`두 칸 ${i}`);
  // 칸 목록은 옆으로 밀리지 않는다(가로 넘침 없음).
  const sx=await page.locator(list).evaluate(el=>({left:el.scrollLeft,over:el.scrollWidth-el.clientWidth}));
  expect(sx).toEqual({left:0,over:0});
  expect(errors).toEqual([]);
});

for(const width of [390,1280])test(`자료실 ${width} 한 칸: 눌러서 고른 줄의 종류 칩이 제자리, 목록 경계 안쪽`,async({page})=>{
  const {errors}=await bootLibrary(page,width,{folders:[libFolder('fa',null,{name:'가상 사업',sort_order:1024})],items:[],docs:docsOf(null),group:'폴더',init:{viewPrefs:{library_two:false}}});
  const row=id=>`#documentList .lu-row[data-lu-document="${id}"]`;
  if(!(await page.locator(row('d-1')).isVisible())){const head=page.locator('#documentList summary',{hasText:'폴더 밖'}).first();const b=await head.boundingBox();await page.mouse.click(b.x+90,b.y+b.height/2)}
  for(const id of IDS)await expect(page.locator(row(id))).toBeVisible();
  const before=await settled(page,'#documentList');
  await libraryTopMenu(page,'select');
  for(const id of ['d-2','d-4']){const b=await page.locator(row(id)+' .lu-row-title').boundingBox();await page.mouse.click(b.x+b.width/2,b.y+b.height/2)}
  await expect(count(page)).toHaveText('2개 선택됨');
  expectSame(before,await settled(page,'#documentList'),`한 칸 ${width}`);
  expect(errors).toEqual([]);
});
