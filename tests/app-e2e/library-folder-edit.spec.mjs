import { appOrigin } from './helpers/test-origin.mjs';
// LIB-토글트리 ③(docs/design/library-tree.md 6절): 자료실 전용 폴더 편집 — ⋯ 메뉴, 만들기·이름·위로/아래로·옮기기·지우기, 자료 폴더로/밖으로.
// 저장은 소유자 RLS 표(app_library_folders·_items) REST뿐. 아래 가짜 서버는 DB 트리거와 같은 규칙(3단, 같은 틀)과 휴지통(TRASH-다른삭제 3단계: 지우면 그 폴더와 아래 폴더가 함께 휴지통으로, 자료 연결은 그대로)을 흉내 낸다.
import {test,expect} from '@playwright/test';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {expandLibraryTree,libraryNode,libraryNodeHead} from './helpers/library-tree.mjs';
import {moveEnabledNames,moveFolder,openMove as openMoveWith} from './helpers/library-folder-server.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const eq=(url,k)=>String(url.searchParams.get(k)||'').replace(/^eq\./,'');
const doc=(id,project_id,extra={})=>({id,workspace_id:'workspace-1',project_id,title:'자료 '+id,file_name:id+'.pdf',category:'정책자료',tags:[],document_date:'2026-10-01',created_at:'2026-10-01T00:00:00Z',...extra});
let seq=0;
async function boot(page,width,{folders=[],items=[],trashMode='ready'}={}){
  await page.setViewportSize({width,height:900});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text())});
  const s=baseState();s.docs=[doc('a-1','top-a'),doc('a-2','top-a'),doc('a1-1','child-a1'),doc('n-1',null)];
  s.folders=folders.map(f=>({workspace_id:'workspace-1',parent_id:null,sort_order:1024,created_at:'2026-10-01T00:00:00Z',...f}));s.items=items.map(x=>({workspace_id:'workspace-1',...x}));s.writes=[];s.trash=[];s.trashMode=trashMode;s.rpc=[];
  await mockApp(page,s);
  const depth=id=>{let n=0,f=s.folders.find(x=>x.id===id);while(f){n++;f=f.parent_id?s.folders.find(x=>x.id===f.parent_id):null}return n};
  const height=id=>1+Math.max(0,...s.folders.filter(f=>f.parent_id===id).map(f=>height(f.id)));
  const reject=msg=>({status:400,contentType:'application/json',body:JSON.stringify({code:'23514',message:msg})});
  await page.route(`${SB}/rest/v1/app_library_folders*`,route=>{
    const req=route.request(),url=new URL(req.url()),m=req.method(),body=(()=>{try{return req.postDataJSON()}catch{return null}})();
    if(m!=='GET')s.writes.push({table:'folders',method:m,id:eq(url,'id')||null,body});
    if(m==='GET')return route.fulfill({json:s.folders});
    if(m==='POST'){if(body.parent_id&&depth(body.parent_id)>=3)return route.fulfill(reject('LIB_FOLDER_DEPTH: folders are limited to 3 levels'));const made={...body,id:'new-'+(++seq),created_at:new Date().toISOString()};s.folders.push(made);return route.fulfill(/return=representation/.test(req.headers()['prefer']||'')?{status:201,json:[made]}:{status:201,body:''})}
    const f=s.folders.find(x=>x.id===eq(url,'id'));
    if(m==='PATCH'){if('parent_id'in body&&body.parent_id&&depth(body.parent_id)+height(f.id)>3)return route.fulfill(reject('LIB_FOLDER_DEPTH: folders are limited to 3 levels'));Object.assign(f,body);return route.fulfill({status:204,body:''})}
    if(m==='DELETE'){const group=[f.id];for(let i=0;i<group.length;i++)for(const c of s.folders.filter(x=>x.parent_id===group[i]))group.push(c.id);s.trash.push({root:f.id,folders:s.folders.filter(x=>group.includes(x.id)),deleted_at:'2026-10-25T05:00:00Z'});s.folders=s.folders.filter(x=>!group.includes(x.id));return route.fulfill({status:204,body:''})}
  });
  // 휴지통 함수 흉내: trashMode 'missing'은 DB 적용 전(옛 함수가 이 종류를 모름), 'failed'는 일시 실패.
  await page.route(`${SB}/rest/v1/rpc/app_trash_*`,route=>{
    const req=route.request(),fn=new URL(req.url()).pathname.split('/').pop(),body=req.postDataJSON()||{};s.rpc.push({fn,kind:body.p_kind,id:body.p_id||null});
    if(s.trashMode==='missing')return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'22023',message:'TRASH_KIND_UNKNOWN'})});
    if(s.trashMode==='failed')return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'fail'})});
    if(fn==='app_trash_list')return route.fulfill({json:s.trash.map(t=>{const r=t.folders.find(x=>x.id===t.root);return {kind:'library_folder',id:t.root,workspace_id:'workspace-1',name:r.name,project_id:r.project_id,project_name:'',parent_id:r.parent_id,deleted_at:t.deleted_at,child_count:t.folders.length-1,file_count:s.items.filter(x=>t.folders.some(f=>f.id===x.folder_id)).length,parent_in_trash:false}})});
    const t=s.trash.find(x=>x.root===body.p_id);if(!t)return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'P0002',message:'TRASH_NOT_FOUND'})});
    s.trash=s.trash.filter(x=>x!==t);s.folders.push(...t.folders);return route.fulfill({json:{ok:true,kind:'library_folder',id:t.root,restored:t.folders.length}});
  });
  await page.route(`${SB}/rest/v1/app_library_folder_items*`,route=>{
    const req=route.request(),url=new URL(req.url()),m=req.method(),body=(()=>{try{return req.postDataJSON()}catch{return null}})();
    if(m!=='GET')s.writes.push({table:'items',method:m,id:eq(url,'document_id')||null,body});
    if(m==='GET')return route.fulfill({json:s.items});
    if(m==='POST'){s.items.push(body);return route.fulfill({status:201,body:''})}
    const it=s.items.find(x=>x.document_id===eq(url,'document_id'));
    if(m==='PATCH'){Object.assign(it,body);return route.fulfill({status:204,body:''})}
    if(m==='DELETE'){s.items=s.items.filter(x=>x!==it);return route.fulfill({status:204,body:''})}
  });
  await signIn(page,`${appOrigin}/app/?view=library`);
  await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('library'));
  await expect(libraryNode(page,'p:top-a')).toBeAttached();
  return {s,errors};
}
const menuOf=(page,key)=>libraryNodeHead(page,key).locator('[data-lu-node-menu]');
const action=(page,name)=>page.locator('#luFolderMenu').getByRole('button',{name,exact:true});
async function press(page,locator,width){if(width<761)await locator.tap();else await locator.click()}
const openMove=(page,docId,width)=>openMoveWith(page,docId,width);
const body=(page,key)=>page.locator(`#documentList details[data-lu-node="${key}"] > .lu-node-body > *`).evaluateAll(xs=>xs.map(x=>x.dataset.luNode||x.dataset.luDocument).filter(Boolean));
const noScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);

for(const width of [390,1280])test.describe(`폴더 편집 ${width}`,()=>{
  test.use({hasTouch:width<761});
  test(`만들기·안에 만들기(3단까지)·이름 바꾸기·위로/아래로, 프로젝트 토글은 ⋯=폴더 만들기만 ${width}`,async({page},info)=>{
    const {s,errors}=await boot(page,width);
    // ⋯는 작은 버튼(28px, 누르는 범위 44px). 누르면 토글은 여닫히지 않고 메뉴만.
    const more=menuOf(page,'p:top-a');await expect(more).toHaveAttribute('aria-label','폴더 만들기: 공공기관 기능개혁 대응');
    expect(Math.round((await more.boundingBox()).height)).toBe(28);
    await press(page,more,width);await expect(page.locator('#luFolderMenu')).toBeVisible();await expect(libraryNode(page,'p:top-a')).not.toHaveAttribute('open','');
    await expect(page.locator('#luFolderMenu button')).toHaveText(['새 폴더']);
    await press(page,action(page,'새 폴더'),width);
    const modal=page.locator('#libraryFolderModal');await expect(modal).toBeVisible();await expect(page.locator('#libraryFolderName')).toBeFocused();
    await expect(page.locator('#libraryFolderHint')).toContainText('Drive 폴더는 바뀌지 않아요');
    // 빈 이름은 저장하지 않는다.
    await page.locator('#libraryFolderName').fill('   ');await page.keyboard.press('Enter');await expect(page.locator('#libraryFolderStatus')).toHaveText('폴더 이름은 1~40자로 써 주세요.');expect(s.writes).toEqual([]);
    await page.locator('#libraryFolderName').fill('  가상 회의록 ');await page.keyboard.press('Enter');await expect(modal).toBeHidden();
    expect(s.writes[0]).toEqual({table:'folders',method:'POST',id:null,body:{workspace_id:'workspace-1',project_id:'top-a',parent_id:null,name:'가상 회의록',sort_order:1024}});
    await expect(page.locator('#libraryFolderStatusLine')).toHaveText('폴더를 만들었어요.');
    const f1=s.folders[0].id;
    // 만든 뒤에는 그 자리(프로젝트 토글)가 펼쳐져 새 폴더가 보인다.
    await expect(libraryNode(page,'p:top-a')).toHaveAttribute('open','');await expect(libraryNode(page,'f:'+f1)).toBeVisible();
    // 두 번째 폴더는 맨 아래(+1024). 폴더는 하위 프로젝트 다음, 파일 앞.
    await press(page,menuOf(page,'p:top-a'),width);await press(page,action(page,'새 폴더'),width);await page.locator('#libraryFolderName').fill('가상 자료집');await press(page,page.locator('#libraryFolderSave'),width);await expect(page.locator('#libraryFolderModal')).toBeHidden();
    const f2=s.folders[1].id;expect(s.folders[1].sort_order).toBe(2048);
    expect(await body(page,'p:top-a')).toEqual(['p:child-a1','f:'+f1,'f:'+f2,'a-1','a-2']);
    // 위로: 두 폴더의 순서를 맞바꾼다(요청 2개). 메뉴에는 갈 수 있는 쪽만.
    await press(page,menuOf(page,'f:'+f2),width);await expect(page.locator('#luFolderMenu button')).toHaveText(['이름 바꾸기F2','안에 새 폴더','펼치기','위로','옮기기…','폴더 지우기']);
    await press(page,action(page,'위로'),width);await expect.poll(()=>body(page,'p:top-a')).toEqual(['p:child-a1','f:'+f2,'f:'+f1,'a-1','a-2']);
    expect(s.writes.slice(-2).map(w=>[w.method,w.id,w.body.sort_order])).toEqual([['PATCH',f2,1024],['PATCH',f1,2048]]);
    // 이름 바꾸기.
    // 이름 바꾸기: 창 없이 줄 안에서 바로(Enter 저장). 저장하면 줄 위 한 줄에 '이름을 바꿨어요 · 되돌리기'.
    await press(page,menuOf(page,'f:'+f1),width);await press(page,action(page,'이름 바꾸기'),width);
    const rename=libraryNodeHead(page,'f:'+f1).locator('input.lu-folder-rename');await expect(rename).toBeFocused();await expect(rename).toHaveValue('가상 회의록');await expect(page.locator('#libraryFolderModal')).toBeHidden();
    await rename.fill('가상 회의록(정리)');await page.keyboard.press('Enter');await expect(libraryNodeHead(page,'f:'+f1).locator('.lu-node-name')).toHaveText('가상 회의록(정리)');
    expect(s.writes.at(-1)).toEqual({table:'folders',method:'PATCH',id:f1,body:{name:'가상 회의록(정리)'}});
    await expect(page.locator('#libraryFolderStatusLine')).toContainText('이름을 바꿨어요');
    await page.locator('#libraryFolderStatusLine .lu-undo').click();await expect(libraryNodeHead(page,'f:'+f1).locator('.lu-node-name')).toHaveText('가상 회의록');
    expect(s.writes.at(-1)).toEqual({table:'folders',method:'PATCH',id:f1,body:{name:'가상 회의록'}});
    // 안에 새 폴더 → 3단까지. 3단 폴더 메뉴에는 '안에 새 폴더'가 없다.
    let parent=f1;
    for(const name of ['2단','3단']){await press(page,menuOf(page,'f:'+parent),width);await press(page,action(page,'안에 새 폴더'),width);await page.locator('#libraryFolderName').fill(name);await page.keyboard.press('Enter');await expect(page.locator('#libraryFolderModal')).toBeHidden();parent=s.folders.at(-1).id;expect(s.folders.at(-1).parent_id).not.toBeNull()}
    await page.locator('#libraryExpandAll').click();
    await press(page,menuOf(page,'f:'+parent),width);await expect(action(page,'안에 새 폴더')).toHaveCount(0);await page.keyboard.press('Escape');await expect(page.locator('#luFolderMenu')).toBeHidden();
    // '프로젝트 없음' 안에도 폴더를 만든다. 보관·확인 불가 토글에는 ⋯가 없다.
    await press(page,menuOf(page,'p:none'),width);await press(page,action(page,'새 폴더'),width);await page.locator('#libraryFolderName').fill('가상 정리함');await page.keyboard.press('Enter');await expect(page.locator('#libraryFolderModal')).toBeHidden();
    expect(s.folders.at(-1)).toMatchObject({project_id:null,parent_id:null,name:'가상 정리함'});
    await page.locator('#libraryExpandAll').click();await page.locator('#libraryExpandAll').click();
    await expect(page.locator('#documentList summary [data-lu-node-menu]')).not.toHaveCount(0);
    // 다른 묶기에서는 폴더 편집이 없다.
    await page.locator('#libraryGroupBy').getByRole('radio',{name:'월별'}).click();await expect(page.locator('#documentList [data-lu-node-menu]')).toHaveCount(0);
    await page.locator('#libraryGroupBy').getByRole('radio',{name:'프로젝트'}).click();
    if(width<761)await page.screenshot({path:info.outputPath('folders-390.png'),fullPage:true});
    // 쓰기는 폴더 표뿐이다.
    expect(new Set(s.writes.map(w=>w.table))).toEqual(new Set(['folders']));
    expect(await noScroll(page)).toBe(true);expect(errors).toEqual([]);
  });

  test(`옮기기(같은 틀만·자기 아래 안 됨)·지우기(휴지통으로)·되돌리기·자료를 폴더로/밖으로 ${width}`,async({page})=>{
    const folders=[{id:'fa',project_id:'top-a',name:'가상 A',sort_order:1024},{id:'fb',project_id:'top-a',name:'가상 B',sort_order:2048},{id:'fb1',project_id:'top-a',parent_id:'fb',name:'가상 B-1',sort_order:0},{id:'fn',project_id:null,name:'가상 없음 폴더',sort_order:0}];
    const {s,errors}=await boot(page,width,{folders,items:[{document_id:'a-2',folder_id:'fb1'}]});
    await page.locator('#libraryExpandAll').click();
    // 옮기기: 같은 프로젝트 틀의 폴더만, 자기·자기 아래는 없다. 다른 틀('프로젝트 없음'의 폴더)은 없다.
    await press(page,menuOf(page,'f:fb'),width);await press(page,action(page,'옮기기…'),width);
    const targets=page.locator('#libraryFolderTargets [data-lu-target]');await expect(targets).toHaveText(['가상 A']);
    await expect(page.locator('#libraryFolderSave')).toBeDisabled();
    // 키보드: 화살표로 고르고 Enter로 옮긴다.
    await targets.first().focus();await page.keyboard.press('ArrowDown');await expect(targets.first()).toHaveAttribute('aria-checked','true');
    await press(page,page.locator('#libraryFolderSave'),width);await expect(page.locator('#libraryFolderModal')).toBeHidden();
    expect(s.writes.at(-1)).toMatchObject({table:'folders',method:'PATCH',id:'fb',body:{parent_id:'fa'}});
    await expect(page.locator('#documentList details[data-lu-node="f:fa"] details[data-lu-node="f:fb"] details[data-lu-node="f:fb1"] [data-lu-document="a-2"]')).toBeAttached();
    // 3단을 넘는 옮기기는 고를 곳에 없다: fb1은 이제 3단이라 메뉴의 '안에 새 폴더'가 없다.
    await page.locator('#libraryExpandAll').click();await page.locator('#libraryExpandAll').click();
    await press(page,menuOf(page,'f:fb1'),width);await expect(action(page,'안에 새 폴더')).toHaveCount(0);await page.keyboard.press('Escape');
    // 지우기(휴지통으로): 확인 창이 아래 폴더·자료 수와 '함께 들어간다'를 알린다. 취소하면 아무것도 안 바뀐다.
    const before=s.writes.length;let message='';
    page.once('dialog',d=>{message=d.message();d.dismiss()});await press(page,menuOf(page,'f:fb'),width);await press(page,action(page,'폴더 지우기'),width);
    await expect.poll(()=>message).toContain('“가상 B” 폴더를 휴지통으로 옮길까요?');expect(message).toContain('아래 폴더 1개·자료 1개도 함께 들어가고');expect(message).toContain('자료와 Drive 파일은 지워지지 않고, 휴지통에서 되돌리면 원래대로');expect(message).not.toContain('한 단 위');expect(s.writes.length).toBe(before);
    page.once('dialog',d=>d.accept());await press(page,menuOf(page,'f:fb'),width);await press(page,action(page,'폴더 지우기'),width);
    await expect(libraryNode(page,'f:fb')).toHaveCount(0);
    expect(s.writes.at(-1)).toEqual({table:'folders',method:'DELETE',id:'fb',body:null});
    // 아래 폴더(fb1)도 함께 빠지고, 그 안의 자료(a-2)는 '폴더 없음' 자리에 나오지 않고 자료실 목록에서 함께 숨는다. 자료 연결은 그대로.
    await expect(libraryNode(page,'f:fb1')).toHaveCount(0);await expect(page.locator('#documentList [data-lu-document="a-2"]')).toHaveCount(0);
    expect(s.items).toEqual([{workspace_id:'workspace-1',document_id:'a-2',folder_id:'fb1'}]);
    expect(s.trash.map(t=>[t.root,t.folders.map(f=>f.id)])).toEqual([['fb',['fb','fb1']]]);
    // 안내 줄의 [되돌리기]: 서버가 묶음을 돌려놓고, 아래 폴더·자료가 원래 자리에 다시 보인다.
    const undo=page.locator('[data-undo-notice]');await expect(undo).toContainText('폴더를 휴지통으로 옮겼습니다.');
    await undo.locator('[data-undo-action]').click();
    await expect.poll(()=>s.trash.length).toBe(0);expect(s.rpc.at(-1)).toEqual({fn:'app_trash_restore',kind:'library_folder',id:'fb'});
    await expect(page.locator('#documentList details[data-lu-node="f:fa"] details[data-lu-node="f:fb"] details[data-lu-node="f:fb1"] [data-lu-document="a-2"]')).toBeAttached();
    // 자료 ⋯ → 폴더로 옮기기 ›(이름 바꾸기 바로 아래): 같은 프로젝트 틀의 폴더를 고를 수 있고, 하위는 들여쓴다.
    await page.locator('#libraryExpandAll').click();if(await page.locator('#libraryExpandAll').getAttribute('data-lu-expand')!=='close')await page.locator('#libraryExpandAll').click();
    await press(page,page.locator('[data-lu-menu="a-1"]'),width);
    expect(await page.locator('#luMorePanel button').evaluateAll(xs=>xs.slice(0,2).map(x=>x.textContent.trim()))).toEqual(['이름 바꾸기F2','폴더로 옮기기›']);
    await press(page,page.locator('#luMorePanel [data-lu-move-open="a-1"]'),width);await expect(page.locator('#luMovePicker')).toBeVisible();
    expect(await moveEnabledNames(page)).toEqual(['가상 A','가상 B','가상 B-1']);
    await expect(page.locator('#luMovePicker [data-lu-move-folder="fb1"]').last()).toHaveAttribute('style',/--lu-depth:\s*2/);
    await press(page,moveFolder(page,'fb1'),width);await expect(page.locator('#luMovePicker')).toBeHidden();await expect(page.locator('#luMorePanel')).toBeHidden();
    expect(s.writes.at(-1)).toEqual({table:'items',method:'POST',id:null,body:{document_id:'a-1',folder_id:'fb1',workspace_id:'workspace-1'}});
    await expect(page.locator('#documentList details[data-lu-node="f:fb1"] [data-lu-document="a-1"]')).toBeAttached();
    // 폴더 밖으로: 연결만 지운다(자료는 프로젝트 바로 아래).
    await page.locator('#libraryExpandAll').click();if(await page.locator('#libraryExpandAll').getAttribute('data-lu-expand')!=='close')await page.locator('#libraryExpandAll').click();
    await openMove(page,'a-1',width);
    // 방금 넣은 폴더가 '최근 넣은 폴더' 맨 위에 보이고, 지금 있는 폴더는 고를 수 없다.
    await expect(page.locator('#luMovePicker .lu-move-sec').first()).toHaveText('최근 넣은 폴더');
    await expect(page.locator('#luMovePicker .lu-move-item').first()).toHaveText(/가상 A › 가상 B › 가상 B-1/);await expect(page.locator('#luMovePicker .lu-move-item').first()).toHaveAttribute('aria-current','true');
    await press(page,page.locator('#luMovePicker [data-lu-move-out]'),width);
    await expect.poll(()=>s.writes.at(-1)).toEqual({table:'items',method:'DELETE',id:'a-1',body:null});
    await expect(page.locator('#documentList details[data-lu-node="p:top-a"] > .lu-node-body > [data-lu-document="a-1"]')).toBeAttached();
    // 하위 프로젝트 자료(child-a1)는 top-a 폴더에 넣을 수 없다(다른 틀): 폴더 줄은 흐리고 이유 한 줄이 보이며 눌러도 아무 일도 없다.
    await openMove(page,'a1-1',width);
    expect(await moveEnabledNames(page)).toEqual([]);await expect(page.locator('#luMovePicker .lu-move-note')).toContainText('프로젝트가 달라 넣을 수 없어요');
    const writesBefore=s.writes.length;await moveFolder(page,'fa').click({force:true});expect(s.writes.length).toBe(writesBefore);await expect(page.locator('#luMovePicker')).toBeVisible();
    await page.keyboard.press('Escape');await expect(page.locator('#luMovePicker')).toBeHidden();await expect(page.locator('#luMorePanel')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('#luMorePanel')).toBeHidden();
    // 자료(app_documents)는 한 번도 쓰지 않았다.
    expect(s.patches).toEqual([]);
    expect(await noScroll(page)).toBe(true);expect(errors).toEqual([]);
  });
  test(`휴지통이 아직 준비 중이면(DB 적용 전) 폴더 지우기는 '준비 중'만 알리고 확인 창도 삭제 요청도 없다 ${width}`,async({page})=>{
    const {s,errors}=await boot(page,width,{folders:[{id:'fa',project_id:'top-a',name:'가상 A',sort_order:1024}],items:[{document_id:'a-1',folder_id:'fa'}],trashMode:'missing'});
    let asked=0;page.on('dialog',d=>{asked++;d.dismiss()});await page.locator('#libraryExpandAll').click();
    await press(page,menuOf(page,'f:fa'),width);await press(page,action(page,'폴더 지우기'),width);
    await expect(page.locator('#libraryFolderStatusLine')).toContainText('자료실 폴더 휴지통은 준비 중입니다');
    expect(asked).toBe(0);expect(s.writes.filter(w=>w.method==='DELETE')).toEqual([]);expect(s.rpc.map(r=>r.fn)).toEqual(['app_trash_list']);
    await expect(libraryNode(page,'f:fa')).toBeAttached();expect(s.folders.map(f=>f.id)).toEqual(['fa']);
    expect(errors).toEqual([]);
  });
  test(`휴지통 상태를 읽지 못하면(일시 실패) 지우지 않고 다시 해 보라고 알린다 ${width}`,async({page})=>{
    const {s,errors}=await boot(page,width,{folders:[{id:'fa',project_id:'top-a',name:'가상 A',sort_order:1024}],trashMode:'failed'});
    let asked=0;page.on('dialog',d=>{asked++;d.dismiss()});await page.locator('#libraryExpandAll').click();
    await press(page,menuOf(page,'f:fa'),width);await press(page,action(page,'폴더 지우기'),width);
    await expect(page.locator('#libraryFolderStatusLine')).toContainText('휴지통 상태를 확인하지 못해 삭제하지 않았습니다');
    expect(asked).toBe(0);expect(s.writes.filter(w=>w.method==='DELETE')).toEqual([]);
    expect(errors.filter(e=>!/500/.test(e))).toEqual([]);
  });
});

test('DB가 거절하면(3단 초과) 일상어 한 줄로 알리고 서버 값으로 다시 그린다',async({page})=>{
  const folders=[{id:'f1',project_id:'top-a',name:'1단',sort_order:0},{id:'f2',project_id:'top-a',parent_id:'f1',name:'2단',sort_order:0},{id:'f3',project_id:'top-a',parent_id:'f2',name:'3단',sort_order:0}];
  const {s,errors}=await boot(page,1280,{folders});
  // 화면이 모르는 사이 서버에서 3단이 이미 찼다고 하자: 2단 아래로 새 폴더를 시도 → 거절.
  s.folders.push({id:'x',workspace_id:'workspace-1',project_id:'top-a',parent_id:'f3',name:'숨은 4단',sort_order:0});
  await page.locator('#libraryExpandAll').click();
  await menuOf(page,'f:f2').click();await action(page,'안에 새 폴더').click();
  // 화면 규칙상 2단 아래는 허용이므로 요청은 가고, 가짜 서버가 3단 초과로 막는다(f3 아래 x가 생겨 f2의 깊이 판단과 무관하게 거절하게 함).
  await page.route(`${SB}/rest/v1/app_library_folders`,route=>route.request().method()==='POST'?route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'23514',message:'LIB_FOLDER_DEPTH: folders are limited to 3 levels'})}):route.fallback());
  await page.locator('#libraryFolderName').fill('새 폴더');await page.keyboard.press('Enter');
  await expect(page.locator('#libraryFolderStatusLine')).toHaveText('폴더는 3단까지만 만들 수 있어요.');await expect(page.locator('#libraryFolderStatusLine')).toHaveClass(/error/);
  await expect(libraryNode(page,'f:x')).toBeAttached();
  expect(errors).toEqual([]);
});

// ④ PC 끌어 놓기: 같은 프로젝트 틀 안에서만. 폴더를 다른 폴더 안으로·형제 앞뒤로·맨 위로, 파일을 폴더로·폴더 밖으로.
// 다른 틀 위에서는 놓을 수 없음 표시. 폰(터치)은 끌기가 없고 ⋯ 메뉴만.
async function dragTo(page,from,to,{edge='middle'}={}){
  await page.evaluate(({from,to,edge})=>{
    const src=document.querySelector(from),dst=document.querySelector(to),dt=new DataTransfer(),r=dst.getBoundingClientRect();
    const y=edge==='top'?r.top+2:edge==='bottom'?r.bottom-2:r.top+r.height/2,x=r.left+r.width/2;
    src.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:dt}));
    const over=new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:x,clientY:y});dst.dispatchEvent(over);
    window.__luDropAllowed=over.defaultPrevented;window.__luDropClass=dst.className;
    dst.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:x,clientY:y}));
    src.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));
  },{from,to,edge});
  return page.evaluate(()=>({allowed:window.__luDropAllowed,cls:window.__luDropClass}));
}
const head=key=>`#documentList details[data-lu-node="${key}"] > summary`;
test('PC 1280 끌어 놓기: 같은 틀 안 폴더 안으로·앞뒤로·맨 위로, 파일 폴더로·밖으로, 다른 틀은 놓을 수 없음',async({page})=>{
  const folders=[{id:'fa',project_id:'top-a',name:'가상 A',sort_order:1024},{id:'fb',project_id:'top-a',name:'가상 B',sort_order:2048},{id:'fc',project_id:'top-a',name:'가상 C',sort_order:3072},{id:'fn',project_id:null,name:'가상 없음',sort_order:0}];
  const {s,errors}=await boot(page,1280,{folders});
  await page.locator('#libraryExpandAll').click();
  await expect(page.locator(head('f:fa'))).toHaveAttribute('draggable','true');await expect(page.locator('[data-lu-document="a-1"]')).toHaveAttribute('draggable','true');
  // child-a1 틀에는 폴더가 없어 그 자료는 끌 수 없다. 프로젝트 토글은 끌 수 없다.
  await expect(page.locator('[data-lu-document="a1-1"]')).not.toHaveAttribute('draggable','true');await expect(page.locator(head('p:top-a'))).not.toHaveAttribute('draggable','true');
  // 폴더 C를 A 앞(위 끝)으로: 형제만 다시 매김.
  let r=await dragTo(page,head('f:fc'),head('f:fa'),{edge:'top'});expect(r.allowed).toBe(true);expect(r.cls).toContain('lu-drop-before');
  await expect.poll(()=>body(page,'p:top-a')).toEqual(['p:child-a1','f:fc','f:fa','f:fb','a-1','a-2']);
  // 폴더 B를 A 안으로(가운데).
  r=await dragTo(page,head('f:fb'),head('f:fa'));expect(r.allowed).toBe(true);expect(r.cls).toContain('lu-drop-into');
  await expect.poll(()=>s.folders.find(f=>f.id==='fb').parent_id).toBe('fa');
  // 가짜 서버 값이 바뀐 것과 화면이 폴더를 다시 읽어 그린 것은 다른 때다. 화면에 B가 A 안에 그려진 뒤에 다음 끌기를 한다
  // (그 전에 끌면 옛 트리에서 B가 A의 형제라 놓을 수 있게 보인다 — CI에서 두 번 실패한 원인).
  await expect(page.locator('#documentList details[data-lu-node="f:fa"] details[data-lu-node="f:fb"]')).toHaveCount(1);
  // 자기 아래(B)로 A를 넣을 수는 없다.
  await expandLibraryTree(page);
  const n=s.writes.length;r=await dragTo(page,head('f:fa'),head('f:fb'));expect(r.allowed).toBe(false);expect(r.cls).toContain('lu-drop-no');expect(s.writes.length).toBe(n);
  // 다른 틀('프로젝트 없음'의 폴더, 다른 프로젝트 토글)에는 놓을 수 없다.
  r=await dragTo(page,head('f:fc'),head('f:fn'));expect(r.allowed).toBe(false);
  r=await dragTo(page,'[data-lu-document="a-1"]',head('p:top-b'));expect(r.allowed).toBe(false);expect(s.writes.length).toBe(n);
  // 파일을 폴더로, 그다음 프로젝트 머리에 놓아 폴더 밖으로.
  r=await dragTo(page,'[data-lu-document="a-1"]',head('f:fc'));expect(r.allowed).toBe(true);
  await expect.poll(()=>s.items).toEqual([{document_id:'a-1',folder_id:'fc',workspace_id:'workspace-1'}]);
  await expect(page.locator('#documentList details[data-lu-node="f:fc"] [data-lu-document="a-1"]')).toHaveCount(1);
  await expandLibraryTree(page);
  r=await dragTo(page,'[data-lu-document="a-1"]',head('p:top-a'));expect(r.allowed).toBe(true);
  await expect.poll(()=>s.items).toEqual([]);
  await expect(page.locator('#documentList details[data-lu-node="f:fc"] [data-lu-document="a-1"]')).toHaveCount(0);
  // B(A 안)를 프로젝트 머리에 놓으면 맨 위로.
  await expandLibraryTree(page);r=await dragTo(page,head('f:fb'),head('p:top-a'));expect(r.allowed).toBe(true);await expect.poll(()=>s.folders.find(f=>f.id==='fb').parent_id).toBeNull();
  // 놓은 뒤 표시가 남지 않는다. 자료는 쓰지 않았다.
  await expect(page.locator('#documentList .lu-drop-into,#documentList .lu-drop-no,#documentList .lu-dragging')).toHaveCount(0);
  expect(s.patches).toEqual([]);expect(errors).toEqual([]);
});
test.describe('폰 390 끌기 없음',()=>{
  test.use({hasTouch:true,isMobile:true});
  test('폰 390: 끌 수 있는 줄이 없고 ⋯ 메뉴의 위로·아래로가 같은 일을 한다',async({page})=>{
    const {s,errors}=await boot(page,390,{folders:[{id:'fa',project_id:'top-a',name:'가상 A',sort_order:1024},{id:'fb',project_id:'top-a',name:'가상 B',sort_order:2048}]});
    await page.locator('#libraryExpandAll').tap();
    await expect(page.locator('#documentList [draggable="true"]')).toHaveCount(0);
    await menuOf(page,'f:fb').tap();await action(page,'위로').tap();
    await expect.poll(()=>body(page,'p:top-a')).toEqual(['p:child-a1','f:fb','f:fa','a-1','a-2']);
    expect(s.writes.every(w=>w.table==='folders'&&w.method==='PATCH')).toBe(true);expect(errors).toEqual([]);
  });
});
