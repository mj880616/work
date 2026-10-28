import {test,expect} from '@playwright/test';
import {expandLibraryTree} from './helpers/library-tree.mjs';
import {bootLibrary,libFolder,libDoc,SB,press} from './helpers/library-folder-server.mjs';
// LIB-폴더탐색기 화면 ③(docs/design/library-tree.md 12절): 선택 모드 일괄 수정 줄([프로젝트|담당조직|종류 바꾸기][폴더로 옮기기][삭제]),
// 바꾼 칸은 칸별 기록 'user', '… 바꿨어요 · 되돌리기', 일부 실패, PC Ctrl/Shift+클릭 선택.
const FOLDERS=[libFolder('fa','top-a',{name:'가상 A',sort_order:1024}),libFolder('fn',null,{name:'가상 N',sort_order:2048})];
const ORIGIN={project_id:'ai',category:'ai'};
const DOCS=[libDoc('a-1','top-a',{field_origin:{...ORIGIN}}),libDoc('a-2','top-a',{field_origin:{...ORIGIN}}),libDoc('a1-1','child-a1',{field_origin:{...ORIGIN}}),libDoc('n-1',null,{field_origin:{...ORIGIN}})];
const line=page=>page.locator('#libraryFolderStatusLine');
const bar=page=>page.locator('#librarySelectBar');
async function boot(page,width,{group='폴더',docs=DOCS}={}){
  const r=await bootLibrary(page,width,{folders:FOLDERS,items:[],docs:structuredClone(docs),group});
  const {s}=r;s.patches=[];
  await page.route(`${SB}/rest/v1/app_documents*`,route=>{
    const req=route.request();if(req.method()!=='PATCH')return route.fallback();
    const id=new URL(req.url()).searchParams.get('id').replace(/^eq\./,''),body=req.postDataJSON();
    s.patches.push({id,body});
    if(s.failPatch===id)return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'fail'})});
    const row=s.docs.find(d=>d.id===id);Object.assign(row,body);return route.fulfill({json:[row]});
  });
  await page.route(`${SB}/rest/v1/app_suborganizations*`,route=>route.fulfill({json:[{id:'org-1',name:'가상 조직',active:true}]}));
  await expandLibraryTree(page);
  return r;
}
async function pick(page,ids,width){
  await press(page,page.locator('#librarySelectBtn'),width);
  for(const id of ids)await page.locator(`[data-lu-pick="${id}"]`).check();
  await expect(page.locator('#librarySelectCount')).toHaveText(`${ids.length}개 골랐음`);
}
const menuItem=(page,name)=>page.locator('#luBulkMenu').getByRole('button',{name,exact:true});

for(const width of [390,1280])test.describe(`일괄 수정 ${width}`,()=>{
  test.use({hasTouch:width<761});
  test(`한 줄 도구줄: 고른 것이 없으면 꺼져 있고, 고르면 켜진다 ${width}`,async({page})=>{
    const {errors}=await boot(page,width);
    await press(page,page.locator('#librarySelectBtn'),width);
    const labels=['프로젝트 바꾸기','담당조직 바꾸기','분류 바꾸기','폴더로 옮기기','삭제'];
    for(const name of labels){await expect(bar(page).getByRole('button',{name,exact:true})).toBeVisible();await expect(bar(page).getByRole('button',{name,exact:true})).toBeDisabled()}
    await page.locator('[data-lu-pick="a-2"]').check();
    for(const name of labels)await expect(bar(page).getByRole('button',{name,exact:true})).toBeEnabled();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });

  test(`프로젝트 바꾸기: 고른 자료 모두, 사용자 수정 표시, 칸 기록 user, 되돌리기 ${width}`,async({page})=>{
    const {s,errors}=await boot(page,width);
    await pick(page,['a-2','a1-1'],width);
    await press(page,bar(page).getByRole('button',{name:'프로젝트 바꾸기',exact:true}),width);
    await expect(page.locator('#luBulkMenu')).toBeVisible();
    await expect(menuItem(page,'프로젝트 없음')).toBeVisible();
    await press(page,menuItem(page,'민자철도 정책 대응'),width);
    await expect.poll(()=>s.patches.length).toBe(2);
    expect(s.patches.map(p=>p.id)).toEqual(['a-2','a1-1']);
    for(const p of s.patches){
      expect(p.body.project_id).toBe('top-b');expect(p.body.auto_classified).toBe(false);expect(p.body.classification_note).toBe('사용자 수정');
      expect(p.body.field_origin).toEqual({project_id:'user',category:'ai'});expect(Object.keys(p.body).sort()).toEqual(['auto_classified','classification_note','field_origin','project_id','updated_at']);
    }
    await expect(line(page)).toContainText('2개의 프로젝트을(를) 바꿨어요');
    expect(s.docs.find(d=>d.id==='a1-1').project_id).toBe('top-b');
    expect(s.docs.find(d=>d.id==='a-1').project_id).toBe('top-a');
    // LIB-후속1 ③: 일괄 작업이 끝나면 선택 모드는 저절로 풀린다.
    await expect(bar(page)).toBeHidden();await expect(page.locator('[data-lu-pick]')).toHaveCount(0);
    await press(page,line(page).locator('.lu-undo'),width);
    await expect.poll(()=>s.docs.find(d=>d.id==='a1-1').project_id).toBe('child-a1');
    expect(s.docs.find(d=>d.id==='a-2').project_id).toBe('top-a');
    expect(s.docs.find(d=>d.id==='a-2').field_origin).toEqual(ORIGIN);
    expect(errors).toEqual([]);
  });

  test(`종류 바꾸기·담당조직 바꾸기 ${width}`,async({page})=>{
    const {s,errors}=await boot(page,width);
    await pick(page,['a-1','n-1'],width);
    await press(page,bar(page).getByRole('button',{name:'분류 바꾸기',exact:true}),width);
    await expect(menuItem(page,'기타')).toBeVisible();
    await press(page,menuItem(page,'기타'),width);
    await expect.poll(()=>s.patches.length).toBe(2);
    for(const p of s.patches){expect(p.body.category).toBe('기타');expect(p.body.field_origin.category).toBe('user');expect(p.body.field_origin.project_id).toBe('ai')}
    await expect(line(page)).toContainText('2개의 분류을(를) 바꿨어요');
    // 일괄 작업 뒤 선택 모드는 저절로 풀린다(LIB-후속1 ③). 다시 골라 담당조직을 바꾼다.
    await expect(bar(page)).toBeHidden();
    s.patches.length=0;
    await pick(page,['a-1','n-1'],width);
    await press(page,bar(page).getByRole('button',{name:'담당조직 바꾸기',exact:true}),width);
    await expect(menuItem(page,'가상 조직')).toBeVisible();await expect(menuItem(page,'담당조직 없음')).toBeVisible();
    await press(page,menuItem(page,'가상 조직'),width);
    await expect.poll(()=>s.patches.length).toBe(2);
    for(const p of s.patches){expect(p.body.organization_id).toBe('org-1');expect(p.body.classification_note).toBe('사용자 수정')}
    expect(errors).toEqual([]);
  });

  test(`일부만 실패하면 성공한 만큼만 바꾸고 알려 주며, 실패한 자료는 그대로 골라 둔다 ${width}`,async({page})=>{
    const {s,errors}=await boot(page,width);s.failPatch='a1-1';
    await pick(page,['a-2','a1-1'],width);
    await press(page,bar(page).getByRole('button',{name:'분류 바꾸기',exact:true}),width);
    await press(page,menuItem(page,'기타'),width);
    await expect(line(page)).toContainText('1개의 분류을(를) 바꿨고 1개는 바꾸지 못했어요');await expect(line(page)).toHaveClass(/error/);
    expect(s.docs.find(d=>d.id==='a-2').category).toBe('기타');expect(s.docs.find(d=>d.id==='a1-1').category).toBe('정책자료');
    // 실패한 것만 고른 채로 남는다.
    await expect(page.locator('#librarySelectCount')).toHaveText('1개 골랐음');await expect(page.locator('[data-lu-pick="a1-1"]')).toBeChecked();await expect(page.locator('[data-lu-pick="a-2"]')).not.toBeChecked();
    expect(errors.filter(e=>!/500|fail/i.test(e))).toEqual([]);
  });

  test(`폴더로 옮기기: 고른 자료를 한 폴더로(프로젝트는 그대로), 되돌리기 ${width}`,async({page})=>{
    const {s,errors}=await boot(page,width);
    await pick(page,['a-2','a1-1'],width);
    await press(page,bar(page).getByRole('button',{name:'폴더로 옮기기',exact:true}),width);
    await expect(page.locator('#luMovePicker')).toBeVisible();
    await press(page,page.locator('#luMovePicker [data-lu-move-folder="fn"]').last(),width);
    await expect(page.locator('#luMovePicker')).toBeHidden();
    await expect.poll(()=>s.items.filter(x=>x.folder_id==='fn').map(x=>x.document_id).sort()).toEqual(['a-2','a1-1']);
    expect(s.docs.find(d=>d.id==='a1-1').project_id).toBe('child-a1');
    await expect(line(page)).toContainText('옮겼어요 2개 → 📁 가상 N');await expect(bar(page)).toBeHidden();
    await press(page,line(page).locator('.lu-undo'),width);
    await expect.poll(()=>s.items.length).toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe('PC Ctrl/Shift+클릭',()=>{
  test('선택 모드가 아니어도 Ctrl+클릭으로 시작하고, Shift+클릭으로 범위를 더한다. 그냥 클릭은 자료를 연다',async({page})=>{
    const {errors}=await boot(page,1280);
    const row=id=>page.locator(`[data-lu-document="${id}"]`);
    await row('a-2').click({modifiers:['Control']});
    await expect(bar(page)).toBeVisible();await expect(page.locator('[data-lu-pick="a-2"]')).toBeChecked();await expect(page.locator('#librarySelectCount')).toHaveText('1개 골랐음');
    await expect(page.locator('#documentModal')).toBeHidden();
    await row('n-1').click({modifiers:['Shift']});
    // 폴더 밖(a-2, a1-1) 다음의 줄들 중 a-2부터 n-1까지 보이는 줄 모두.
    const order=await page.locator('#documentList [data-lu-document]').evaluateAll(xs=>xs.filter(x=>x.checkVisibility()).map(x=>x.dataset.luDocument));
    const want=order.slice(order.indexOf('a-2'),order.indexOf('n-1')+1);
    await expect(page.locator('#librarySelectCount')).toHaveText(`${want.length}개 골랐음`);
    for(const id of want)await expect(page.locator(`[data-lu-pick="${id}"]`)).toBeChecked();
    // Ctrl+클릭은 그 줄만 뺀다.
    await row('a-2').click({modifiers:['Control']});
    await expect(page.locator('[data-lu-pick="a-2"]')).not.toBeChecked();await expect(page.locator('#librarySelectCount')).toHaveText(`${want.length-1}개 골랐음`);
    expect(errors).toEqual([]);
  });
});

// LIB-후속1 ①: PC 선택 모드에서 네모 칸 왼쪽·가운데·오른쪽, 줄 왼쪽 여백·제목·종류 칩·빈 곳 어디를 눌러도 고르기·풀기, 자료는 열리지 않는다.
// 원인: 줄(role=button)이 누르는 동안 공용 눌림 규칙으로 작아지며 왼쪽 끝이 밀려, 손을 뗄 때 포인터가 줄 밖이라 클릭이 줄에 닿지 않았다.
test.describe('LIB-후속1 PC 선택',()=>{
  test('네모 칸·줄 어디를 눌러도 고르기·풀기, 열리지 않음',async({page})=>{
    const {errors}=await boot(page,1280);
    await page.locator('#librarySelectBtn').click();
    const row=page.locator('[data-lu-document="a-2"]'),pick=page.locator('[data-lu-pick="a-2"]');
    const box=await pick.boundingBox(),rb=await row.boundingBox();
    const spots=[[box.x+1,box.y+box.height/2],[box.x+box.width/2,box.y+box.height/2],[box.x+box.width-1,box.y+box.height/2],[rb.x+1,rb.y+rb.height/2],[rb.x+rb.width*0.6,rb.y+rb.height/2]];
    // 누르는 자리마다 맨 위 요소가 그 줄 안이어야 한다(덮는 것이 있으면 그 이름이 실패 글에 나온다).
    for(const [x,y] of spots){
      const hit=await page.evaluate(([x,y])=>{const el=document.elementFromPoint(x,y);return el?.closest('[data-lu-document]')?.dataset.luDocument||`${el?.tagName}.${el?.className}`},[x,y]);
      expect(hit).toBe('a-2');
    }
    let want=false;
    for(const [x,y] of spots){
      want=!want;
      await page.mouse.move(x,y);await page.mouse.down();await page.waitForTimeout(120);await page.mouse.up();
      if(want)await expect(pick).toBeChecked();else await expect(pick).not.toBeChecked();
    }
    await expect(page.locator('#documentModal')).toBeHidden();
    // 다섯 번 눌러 지금은 골라진 상태. 제목·종류 칩을 눌러도 풀기·고르기(열리지 않음).
    await expect(pick).toBeChecked();
    await row.locator('.lu-row-title').click();await expect(pick).not.toBeChecked();
    await row.locator('.lu-file-kind').click();await expect(pick).toBeChecked();
    // Esc = 선택 모드 풀기.
    await page.keyboard.press('Escape');await expect(bar(page)).toBeHidden();
    expect(errors).toEqual([]);
  });
  test('우클릭 메뉴: 맨 위 [선택]·[분류 바꾸기 ›]·정보 수정…, 선택 모드면 고른 것 모두 메뉴',async({page})=>{
    const {s,errors}=await boot(page,1280);
    const panel=page.locator('#luMorePanel');
    await page.locator('[data-lu-document="a-2"] .lu-row-title').click({button:'right'});
    await expect(panel).toBeVisible();
    const names=await panel.locator('button').evaluateAll(xs=>xs.map(x=>x.textContent.replace(/[›F2]/g,'').trim()));
    expect(names[0]).toBe('선택');expect(names).toContain('분류 바꾸기');expect(names).toContain('정보 수정…');expect(names).not.toContain('수정…');
    await panel.getByRole('button',{name:'선택',exact:true}).click();
    await expect(bar(page)).toBeVisible();await expect(page.locator('[data-lu-pick="a-2"]')).toBeChecked();
    await page.locator('[data-lu-document="n-1"]').click();
    await page.locator('[data-lu-document="n-1"] .lu-row-title').click({button:'right'});
    await expect(panel.locator('.lu-menu-head')).toHaveText('2개 골랐음');
    await panel.getByRole('button',{name:/^분류 바꾸기/}).click();
    await expect(page.locator('#luBulkMenu')).toBeVisible();
    await page.locator('#luBulkMenu').getByRole('button',{name:'기타',exact:true}).click();
    await expect.poll(()=>s.patches.length).toBe(2);
    for(const p of s.patches){expect(p.body.category).toBe('기타');expect(p.body.field_origin.category).toBe('user')}
    await expect(bar(page)).toBeHidden();
    // 선택 모드 밖 한 자료의 [분류 바꾸기 ›]는 그 자료 하나만.
    s.patches.length=0;
    await page.locator('[data-lu-document="a-1"] .lu-row-title').click({button:'right'});
    await panel.getByRole('button',{name:/^분류 바꾸기/}).click();
    await page.locator('#luBulkMenu').getByRole('button',{name:'기타',exact:true}).click();
    await expect.poll(()=>s.patches.map(p=>p.id)).toEqual(['a-1']);
    await expect(bar(page)).toBeHidden();
    expect(errors).toEqual([]);
  });
});

// LIB-후속1 ⑤: 분류로 묶은 화면에서 자료를 다른 분류 머리(또는 그 분류의 열린 자료 줄) 위에 놓으면 분류가 바뀐다(칸 기록 user). 왼쪽 폴더 팝업은 그대로.
test('분류 묶기에서 끌어 분류 바꾸기, 놓일 묶음 전체 칠함, 왼쪽 폴더 팝업 유지',async({page})=>{
  const docs=[...DOCS.slice(0,3),libDoc('n-1',null,{category:'기타',field_origin:{...ORIGIN}})];
  const {s,errors}=await boot(page,1280,{group:'분류',docs});
  await expect(page.locator('#documentList details[data-lu-node="c:기타"]')).toHaveCount(1);
  const r=await page.evaluate(()=>{
    const src=document.querySelector('[data-lu-document="a-2"]'),dst=document.querySelector('#documentList details[data-lu-node="c:기타"] > summary'),dt=new DataTransfer(),b=dst.getBoundingClientRect();
    src.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:dt}));
    const over=new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:b.left+b.width/2,clientY:b.top+b.height/2});dst.dispatchEvent(over);
    const out={allowed:over.defaultPrevented,group:dst.parentElement.classList.contains('lu-drop-group')};
    dst.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:b.left+b.width/2,clientY:b.top+b.height/2}));
    src.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));
    return out;
  });
  expect(r).toEqual({allowed:true,group:true});
  await expect.poll(()=>s.patches.map(p=>p.id)).toEqual(['a-2']);
  expect(s.patches[0].body.category).toBe('기타');expect(s.patches[0].body.field_origin.category).toBe('user');
  await expect(line(page)).toContainText('1개의 분류을(를) 바꿨어요');
  await expect(page.locator('#documentList .lu-drop-group')).toHaveCount(0);
  // 같은 분류에는 놓을 수 없고, 끄는 동안 왼쪽 폴더 팝업이 뜬다.
  const again=await page.evaluate(async()=>{
    const src=document.querySelector('[data-lu-document="a-2"]'),dst=document.querySelector('#documentList details[data-lu-node="c:기타"] > summary'),dt=new DataTransfer();
    src.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:dt}));
    await new Promise(r=>setTimeout(r,30));
    const over=new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:10,clientY:10});dst.dispatchEvent(over);
    const panel=document.querySelector('.lu-drop-panel');const out={allowed:over.defaultPrevented,panel:!!panel&&!panel.hidden};
    src.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));
    return out;
  });
  expect(again).toEqual({allowed:false,panel:true});
  expect(errors).toEqual([]);
});
