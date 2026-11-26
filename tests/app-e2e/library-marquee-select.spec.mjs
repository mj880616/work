import {test,expect} from '@playwright/test';
import {bootLibrary,libFolder,libDoc} from './helpers/library-folder-server.mjs';
// S69-17 UI-끌어고르기(사용자 11/24 08:30 "자료실에서 선택 말고 드래그해서 파일 선택 가능하게"): PC 1440 두 칸 보기에서
// 칸 목록 빈 곳(마지막 줄 아래)을 마우스로 끌면 사각형에 닿은 줄이 골라지고(기존 선택 모드·위 막대), Ctrl과 끌면 더하기,
// 줄 위(이름·가운데 빈칸)에서 끌면 지금처럼 폴더로 옮기기, Shift+클릭은 범위. 이름은 지어낸 것.
const FOLDERS=[libFolder('src',null,{name:'가상 시작',sort_order:1024}),libFolder('dst',null,{name:'가상 도착',sort_order:2048})];
const IDS=['d-1','d-2','d-3','d-4','d-5'];
const docs=IDS.map((id,i)=>libDoc(id,null,{title:'가상 자료 '+(i+1),document_date:'2026-10-0'+(i+1)}));
const ITEMS=IDS.map(id=>({document_id:id,folder_id:'src'}));
const folderOf=(s,doc)=>s.items.find(x=>x.document_id===doc)?.folder_id||null;
const pane=i=>`#documentList [data-lu-pane-i="${i}"]`;
const row=id=>`${pane(0)} [data-lu-document="${id}"]`;
const count=page=>page.locator('#librarySelectCount');
// 줄 가운데 높이·이름 글자 끝보다 오른쪽(줄 안 빈칸)의 점.
const midOf=(page,sel)=>page.locator(sel+' .lu-row-title').evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);const end=r.getBoundingClientRect().right,b=el.getBoundingClientRect();return {x:Math.min(b.right-6,end+60),y:b.top+b.height/2,end,right:b.right}});
// 칸 목록에서 마지막 자료 줄 아래 빈 곳(칸 안).
const belowOf=(page,i)=>page.locator(`${pane(i)} .lu-pane-list`).evaluate(list=>{const rows=[...list.querySelectorAll('.lu-row[data-lu-document]')],last=rows[rows.length-1].getBoundingClientRect(),b=list.getBoundingClientRect();return {x:last.left+last.width/2,y:Math.min(b.bottom-10,last.bottom+40),room:b.bottom-last.bottom}});
const yOf=(page,sel)=>page.locator(sel).evaluate(el=>{const b=el.getBoundingClientRect();return b.top+b.height/2});
// 보이는 차례(위 → 아래)의 자료 id.
const order=page=>page.locator(`${pane(0)} .lu-row[data-lu-document]`).evaluateAll(xs=>xs.map(x=>x.dataset.luDocument));
const checked=page=>page.locator(`${pane(0)} [data-lu-pick]`).evaluateAll(xs=>xs.filter(x=>x.checked).map(x=>x.dataset.luPick));
// to: 끝점(또는 끝점을 재는 함수 — 처음 고르면 위에 선택 막대가 나타나 줄이 조금 내려가므로, 사람처럼 그 뒤 화면을 보고 끝점을 잡는다).
async function marquee(page,from,to,mods=[]){
  for(const k of mods)await page.keyboard.down(k);
  await page.mouse.move(from.x,from.y);await page.mouse.down();
  await page.mouse.move(from.x+6,from.y-8,{steps:3});
  await expect(page.locator('.marquee-box')).toBeVisible();
  if(typeof to==='function'){
    // 먼저 마지막 줄까지 올려 하나를 고르면(선택 막대가 나타나 줄이 조금 내려감) 그 뒤 화면에서 끝점을 잰다.
    await page.mouse.move(from.x+6,from.y-50,{steps:3});
    await expect(page.locator('#librarySelectBar')).toBeVisible();
    await page.waitForTimeout(50);
    to=await to();
  }
  await page.mouse.move(to.x,to.y,{steps:6});
  await page.mouse.up();
  for(const k of mods)await page.keyboard.up(k);
  await expect(page.locator('.marquee-box')).toHaveCount(0);
}
async function boot(page){
  const r=await bootLibrary(page,1440,{folders:FOLDERS,items:ITEMS,docs,group:'폴더',init:{viewPrefs:null}});
  await page.locator(`${pane(0)} [data-lu-nav="src"]`).click({button:'right'});
  await page.locator('#luFolderMenu [data-lu-folder-action="enter"]').click();
  for(const id of IDS)await expect(page.locator(row(id))).toBeVisible();
  return r;
}

test('PC 1440 두 칸: 빈 곳을 끌면 닿은 3줄이 골라지고, Ctrl과 끌면 더해진다',async({page})=>{
  test.setTimeout(60000);
  const {errors}=await boot(page);
  const o=await order(page);expect(o.slice().sort()).toEqual(IDS);
  const a=await belowOf(page,0);
  expect(a.room).toBeGreaterThan(40); // 마지막 줄 아래에 빈 곳이 있다
  await expect(page.locator('#librarySelectBar')).toBeHidden();
  // 마지막 줄 아래 빈 곳 → 셋째 줄(o[2])까지 위로 끌기 = 아래 세 줄.
  await marquee(page,a,async()=>({x:a.x+30,y:await yOf(page,row(o[2]))}));
  await expect(page.locator('#librarySelectBar')).toBeVisible();
  await expect(count(page)).toHaveText('3개 선택됨');
  expect((await checked(page)).sort()).toEqual(o.slice(2).sort());
  // 끈 뒤 떼어도 자료가 열리지 않는다(뗄 때 생기는 클릭은 먹는다).
  await expect(page.locator('#libraryPreviewModal:not(.hidden), .lu-viewer:visible')).toHaveCount(0);
  // Ctrl 없이 다시 끌면 닿은 것만(마지막 줄 하나).
  let b=await belowOf(page,0);
  await marquee(page,b,async()=>({x:b.x+20,y:await yOf(page,row(o[4]))}));
  await expect(count(page)).toHaveText('1개 선택됨');
  expect(await checked(page)).toEqual([o[4]]);
  // 맨 위 줄을 Ctrl+클릭으로 더한 뒤, Ctrl과 함께 아래에서 넷째 줄까지 끌면 맨 위 줄은 남고 넷째·다섯째가 더해져 3개(Ctrl 없으면 2개).
  await page.locator(row(o[0])+' .lu-row-title').click({modifiers:['Control']});
  await expect(count(page)).toHaveText('2개 선택됨');
  b=await belowOf(page,0);
  await marquee(page,b,async()=>({x:b.x+20,y:await yOf(page,row(o[3]))}),['Control']);
  await expect(count(page)).toHaveText('3개 선택됨');
  expect((await checked(page)).sort()).toEqual([o[0],o[3],o[4]].sort());
  // Esc로 선택을 끝낸다.
  await page.keyboard.press('Escape');
  await expect(page.locator('#librarySelectBar')).toBeHidden();
  expect(errors).toEqual([]);
});

test('PC 1440 두 칸: 줄 위(가운데 빈칸 포함)에서 끌면 사각형 없이 지금처럼 폴더로 옮긴다',async({page})=>{
  test.setTimeout(60000);
  const {s,errors}=await boot(page);
  const t=await midOf(page,row('d-2'));
  expect(t.right-t.end).toBeGreaterThan(40); // 이름 오른쪽 줄 안 빈칸을 잡는다
  const to=await page.locator(`${pane(1)} [data-lu-nav="dst"]`).boundingBox();
  await page.mouse.move(t.x,t.y);await page.mouse.down();
  await page.mouse.move(t.x,t.y+12,{steps:3});
  await expect(page.locator('.marquee-box')).toHaveCount(0);
  await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:10});
  await page.mouse.up();
  await expect.poll(()=>folderOf(s,'d-2')).toBe('dst');
  await expect(page.locator('#librarySelectBar')).toBeHidden();
  expect(errors).toEqual([]);
});

test('PC 1440 두 칸: Ctrl+클릭으로 하나 고른 뒤 Shift+클릭하면 그 사이가 모두 골라진다',async({page})=>{
  const {errors}=await boot(page);
  const o=await order(page);
  await page.locator(row(o[0])+' .lu-row-title').click({modifiers:['Control']});
  await expect(count(page)).toHaveText('1개 선택됨');
  await page.locator(row(o[3])+' .lu-row-title').click({modifiers:['Shift']});
  await expect(count(page)).toHaveText('4개 선택됨');
  expect((await checked(page)).sort()).toEqual(o.slice(0,4).sort());
  expect(errors).toEqual([]);
});

test('PC 1440 두 칸: 오른쪽 칸에서도 빈 곳을 끌면 그 칸 줄만 골라진다',async({page})=>{
  const OUT=['o-1','o-2','o-3'];
  // 오른쪽 칸은 '가상 도착'에 들어가 그 안 세 자료(맨 위 칸은 LIB-두칸폴더밖 '폴더 밖' 줄 아래에 폴더 줄이 있어 빈 곳이 없다).
  const {errors}=await bootLibrary(page,1440,{folders:FOLDERS,items:[...ITEMS,...OUT.map(id=>({document_id:id,folder_id:'dst'}))],docs:[...docs,...OUT.map((id,i)=>libDoc(id,null,{title:'가상 바깥 '+(i+1)}))],group:'폴더',init:{viewPrefs:null}});
  await page.locator(`${pane(0)} [data-lu-nav="src"]`).click({button:'right'});
  await page.locator('#luFolderMenu [data-lu-folder-action="enter"]').click();
  await page.locator(`${pane(1)} [data-lu-nav="dst"]`).click({button:'right'});
  await page.locator('#luFolderMenu [data-lu-folder-action="enter"]').click();
  const rows=`${pane(1)} .lu-row[data-lu-document]`;
  await expect(page.locator(rows)).toHaveCount(3);
  const ids=await page.locator(rows).evaluateAll(xs=>xs.map(x=>x.dataset.luDocument));
  const a=await belowOf(page,1);
  await marquee(page,a,async()=>({x:a.x+20,y:await yOf(page,`${pane(1)} [data-lu-document="${ids[1]}"]`)}));
  await expect(count(page)).toHaveText('2개 선택됨');
  const on=await page.locator('#documentList [data-lu-pick]').evaluateAll(xs=>xs.filter(x=>x.checked).map(x=>x.dataset.luPick));
  expect(on.sort()).toEqual(ids.slice(1).sort());
  expect(errors).toEqual([]);
});
