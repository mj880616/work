import {expect} from '@playwright/test';
import {appOrigin} from './test-origin.mjs';
import {baseState,mockApp,signIn} from './filter-chip-fixture.mjs';
import {libraryNode} from './library-tree.mjs';
// LIB-폴더탐색기 시험용 가짜 서버: 자료실 폴더·자료 연결 표(소유자 RLS REST)를 DB 규칙대로 흉내 낸다.
// dbFree=false는 DB 적용 전(같은 프로젝트 틀만: 폴더 위치 LIB_FOLDER_SCOPE, 자료 연결 RLS 42501), true는 적용 뒤(틀 제한 없음).
// 깊이 3단·순환 금지는 둘 다 DB가 지킨다. 쓰기는 s.writes에 쌓고, 자료(app_documents) PATCH는 s.patches(필드 모양은 fixture 그대로).
export const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const eq=(url,k)=>String(url.searchParams.get(k)||'').replace(/^eq\./,'');
export const libDoc=(id,project_id,extra={})=>({id,workspace_id:'workspace-1',project_id,title:'자료 '+id,file_name:id+'.pdf',category:'정책자료',tags:[],document_date:'2026-10-01',created_at:'2026-10-01T00:00:00Z',...extra});
export const libFolder=(id,project_id,extra={})=>({id,project_id,parent_id:null,name:'폴더 '+id,sort_order:1024,...extra});
let seq=0;
export async function bootLibrary(page,width,{folders=[],items=[],docs=null,dbFree=true,group=null,scheme='light'}={}){
  await page.setViewportSize({width,height:900});
  await page.emulateMedia({colorScheme:scheme});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text())});
  const s=baseState();s.docs=docs||[libDoc('a-1','top-a'),libDoc('a-2','top-a'),libDoc('a1-1','child-a1'),libDoc('n-1',null)];
  s.folders=folders.map(f=>({workspace_id:'workspace-1',parent_id:null,sort_order:1024,created_at:'2026-10-01T00:00:00Z',...f}));s.items=items.map(x=>({workspace_id:'workspace-1',...x}));s.writes=[];s.trash=[];s.rpc=[];s.dbFree=dbFree;
  await mockApp(page,s);
  const byId=id=>s.folders.find(x=>x.id===id);
  const depth=id=>{let n=0,f=byId(id);while(f&&n<10){n++;f=f.parent_id?byId(f.parent_id):null}return n};
  const height=id=>1+Math.max(0,...s.folders.filter(f=>f.parent_id===id).map(f=>height(f.id)));
  const inside=(id,ancestor)=>{for(let f=byId(id),n=0;f&&n<10;n++,f=f.parent_id?byId(f.parent_id):null)if(f.id===ancestor)return true;return false};
  const reject=(code,msg)=>({status:400,contentType:'application/json',body:JSON.stringify({code,message:msg})});
  const rls={status:403,contentType:'application/json',body:JSON.stringify({code:'42501',message:'new row violates row-level security policy for table "app_library_folder_items"'})};
  const scope=reject('23514','LIB_FOLDER_SCOPE: a folder must stay in the same workspace and project as its parent');
  const bodyOf=req=>{try{return req.postDataJSON()}catch{return null}};
  await page.route(`${SB}/rest/v1/app_library_folders*`,route=>{
    const req=route.request(),url=new URL(req.url()),m=req.method(),body=bodyOf(req);
    if(m!=='GET')s.writes.push({table:'folders',method:m,id:eq(url,'id')||null,body});
    if(m==='GET')return route.fulfill({json:s.folders});
    if(m==='POST'){
      if(body.parent_id&&depth(body.parent_id)>=3)return route.fulfill(reject('23514','LIB_FOLDER_DEPTH: folders are limited to 3 levels'));
      if(body.parent_id&&!s.dbFree&&(byId(body.parent_id)?.project_id||null)!==(body.project_id||null))return route.fulfill(scope);
      s.folders.push({...body,id:'new-'+(++seq),created_at:new Date().toISOString()});return route.fulfill({status:201,body:''});
    }
    const f=byId(eq(url,'id'));
    if(m==='PATCH'){
      if(f&&'parent_id'in body&&body.parent_id){
        if(inside(body.parent_id,f.id))return route.fulfill(reject('23514','LIB_FOLDER_CYCLE: a folder cannot be placed under itself or a folder below it'));
        if(depth(body.parent_id)+height(f.id)>3)return route.fulfill(reject('23514','LIB_FOLDER_DEPTH: folders are limited to 3 levels'));
        if(!s.dbFree&&(byId(body.parent_id)?.project_id||null)!==(f.project_id||null))return route.fulfill(scope);
      }
      if(f)Object.assign(f,body);return route.fulfill({status:204,body:''});
    }
    if(m==='DELETE'){
      if(!f)return route.fulfill({status:204,body:''});
      const group=[f.id];for(let i=0;i<group.length;i++)for(const c of s.folders.filter(x=>x.parent_id===group[i]))group.push(c.id);
      s.trash.push({root:f.id,folders:s.folders.filter(x=>group.includes(x.id)),deleted_at:'2026-10-25T05:00:00Z'});s.folders=s.folders.filter(x=>!group.includes(x.id));return route.fulfill({status:204,body:''});
    }
  });
  await page.route(`${SB}/rest/v1/rpc/app_trash_*`,route=>{
    const req=route.request(),fn=new URL(req.url()).pathname.split('/').pop(),body=req.postDataJSON()||{};s.rpc.push({fn,kind:body.p_kind,id:body.p_id||null});
    if(fn==='app_trash_list')return route.fulfill({json:s.trash.map(t=>{const r=t.folders.find(x=>x.id===t.root);return {kind:'library_folder',id:t.root,workspace_id:'workspace-1',name:r.name,project_id:r.project_id,project_name:'',parent_id:r.parent_id,deleted_at:t.deleted_at,child_count:t.folders.length-1,file_count:s.items.filter(x=>t.folders.some(f=>f.id===x.folder_id)).length,parent_in_trash:false}})});
    const t=s.trash.find(x=>x.root===body.p_id);if(!t)return route.fulfill(reject('P0002','TRASH_NOT_FOUND'));
    s.trash=s.trash.filter(x=>x!==t);s.folders.push(...t.folders);return route.fulfill({json:{ok:true,kind:'library_folder',id:t.root,restored:t.folders.length}});
  });
  const docOf=id=>s.docs.find(d=>d.id===id);
  await page.route(`${SB}/rest/v1/app_library_folder_items*`,route=>{
    const req=route.request(),url=new URL(req.url()),m=req.method(),body=bodyOf(req);
    if(m!=='GET')s.writes.push({table:'items',method:m,id:eq(url,'document_id')||null,body});
    if(m==='GET')return route.fulfill({json:s.items});
    const frameOk=(docId,folderId)=>s.dbFree||(docOf(docId)?.project_id||null)===(byId(folderId)?.project_id||null);
    if(m==='POST'){if(!byId(body.folder_id)||!frameOk(body.document_id,body.folder_id))return route.fulfill(rls);s.items.push(body);return route.fulfill({status:201,body:''})}
    const it=s.items.find(x=>x.document_id===eq(url,'document_id'));
    if(m==='PATCH'){if(!it||!byId(body.folder_id)||!frameOk(it.document_id,body.folder_id))return route.fulfill(rls);Object.assign(it,body);return route.fulfill({status:204,body:''})}
    if(m==='DELETE'){s.items=s.items.filter(x=>x!==it);return route.fulfill({status:204,body:''})}
  });
  await signIn(page,`${appOrigin}/app/?view=library`);
  await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('library'));
  await expect(libraryNode(page,'p:top-a')).toBeAttached();
  if(group)await page.locator('#libraryGroupBy').getByRole('radio',{name:group}).click();
  return {s,errors};
}
export const treeKeys=page=>page.locator('#documentList details[data-lu-node]').evaluateAll(xs=>xs.map(x=>x.dataset.luNode));
export const childrenOf=(page,key)=>page.locator(`#documentList details[data-lu-node="${key}"] > .lu-node-body > *`).evaluateAll(xs=>xs.map(x=>x.dataset.luNode||x.dataset.luDocument).filter(Boolean));
export const menuButton=(page,key)=>page.locator(`#documentList details[data-lu-node="${key}"] > summary [data-lu-node-menu]`);
export const folderMenuItem=(page,name)=>page.locator('#luFolderMenu').getByRole('button',{name,exact:true});
export async function press(page,locator,width){if(width<761)await locator.tap();else await locator.click()}
