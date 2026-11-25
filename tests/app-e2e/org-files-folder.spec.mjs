import {test,expect} from '@playwright/test';
import {bootLibrary,libFolder,SB} from './helpers/library-folder-server.mjs';
// ORG-기록자료폴더(명진 11/24 "앞으로 조직관리에서 각 조직 기록 자료 추가하면 … 각 조직 폴더에 저장"):
// 담당조직 자료로 올린 자료는 자료실 '모으는 폴더 › 그 조직 폴더'에 하나 들어간다(복사 아님). 첫 사용 때 한 줄로 묻고([예]·[다른 폴더]), 폴더가 없으면 만들고,
// 조직 이름이 바뀌어도 짝지은 폴더(id)를 쓴다. 남의 작업공간 조직(공유로 보이는 조직)은 내 자료실 폴더에 넣지 않는다. 지난 자료 모으기는 모으는 폴더를 처음 정할 때 저절로(S70-29 — 조직 관리 ⋯ 메뉴 줄은 지움), 되돌리기 있음.
// 가짜 서버만 쓴다. 이름은 지어낸 것.
const FOLDERS=[
  libFolder('pp',null,{name:'가상 부모',sort_order:1024}),
  libFolder('c1',null,{name:'가상 조직 1',parent_id:'pp',sort_order:1024}),
  libFolder('c2',null,{name:'가상·조직 2',parent_id:'pp',sort_order:2048}),
  libFolder('other',null,{name:'가상 다른',sort_order:2048}),
];
const ORGS=[{id:'00000000-0000-4000-8000-000000000101',name:'가상 조직 1'},{id:'00000000-0000-4000-8000-000000000102',name:'가상조직 2'},{id:'00000000-0000-4000-8000-000000000103',name:'가상 조직 3'}];
const FOREIGN='00000000-0000-4000-8000-000000000999';
const UUIDS={'upload-1':'upload-1','upload-2':'upload-2'}; // 가짜 서버가 준 올린 자료 id

async function boot(page,init){
  const r=await bootLibrary(page,1440,{folders:FOLDERS,items:[],group:'폴더',init:{viewPrefs:null,orgOwned:ORGS.map(o=>o.id),...init}});
  r.s.orgs=ORGS.map(o=>({...o}));
  // 내 작업공간 조직 표(남의 조직은 이 표에 없다).
  await page.route(`${SB}/rest/v1/app_suborganizations*`,route=>{const url=new URL(route.request().url()),inn=(url.searchParams.get('id')||'').match(/^in\.\((.*)\)$/),ids=inn?inn[1].split(','):null;return route.fulfill({json:r.s.orgs.filter(o=>!ids||ids.includes(o.id)).map(o=>({...o,workspace_id:'workspace-1',active:true}))})});
  // 자료 AI 채우기(document-actions)는 이 시험과 무관 — 가짜 서버의 지우기 흉내로 가지 않게 빈 답.
  await page.route(`${SB}/functions/v1/document-actions*`,route=>route.fulfill({json:{ok:true}}));
  return r;
}
async function uploadFor(page,org,name){
  await page.evaluate(o=>window.KPTULibrary.startUploadForOrganization(o),org);
  await expect(page.locator('#documentModal')).toBeVisible();
  await page.locator('#libraryFileInput').setInputFiles({name,mimeType:'application/pdf',buffer:Buffer.from('%PDF synthetic')});
  await page.locator('#saveDocumentBtn').click();
  await expect(page.locator('#documentModal')).toBeHidden();
}
const itemOf=(s,id)=>s.items.find(x=>x.document_id===id)?.folder_id;

test.describe('PC 1440',()=>{
  test.use({hasTouch:false});
  test('첫 사용: 한 줄로 묻고 [예] → 저장, 방금 올린 자료가 같은 이름 조직 폴더에 1개(짝은 폴더 id)',async({page})=>{
    const {s,errors}=await boot(page,{orgFilesFolder:null});
    await uploadFor(page,ORGS[0],'첫 자료.pdf');
    const notice=page.locator('#kptuNotice');
    await expect(notice.locator('.kptu-notice-text')).toHaveText('조직 기록 자료를 ‘가상 부모’ 폴더에 모을까요?');
    await expect(notice.getByRole('button',{name:'다른 폴더'})).toBeVisible();
    await notice.getByRole('button',{name:'예',exact:true}).click();
    await expect.poll(()=>s.orgFilesFolder).toBe('pp');
    await expect.poll(()=>itemOf(s,UUIDS['upload-1'])).toBe('c1');
    expect(s.items.filter(x=>x.document_id===UUIDS['upload-1'])).toHaveLength(1);
    expect(s.folders.find(f=>f.id==='c1').organization_id).toBe(ORGS[0].id);
    // 띄어쓰기·가운뎃점만 다른 폴더('가상·조직 2' ↔ '가상조직 2')도 같은 조직 폴더로 본다. 두 번째부터는 묻지 않는다.
    await uploadFor(page,ORGS[1],'둘째.pdf');
    await expect.poll(()=>itemOf(s,UUIDS['upload-2'])).toBe('c2');
    expect(s.orgFilesPatches).toEqual(['pp']);
    expect(errors).toEqual([]);
  });

  test('폴더가 없으면 부모 아래 새로 만들고, 조직 이름이 바뀌어도 같은 폴더',async({page})=>{
    const {s,errors}=await boot(page,{orgFilesFolder:'pp'});
    await uploadFor(page,ORGS[2],'셋째.pdf');
    await expect.poll(()=>s.folders.find(f=>f.name==='가상 조직 3')?.parent_id).toBe('pp');
    const made=s.folders.find(f=>f.name==='가상 조직 3');
    await expect.poll(()=>itemOf(s,UUIDS['upload-1'])).toBe(made.id);
    expect(made.organization_id).toBe(ORGS[2].id);
    s.orgs.find(o=>o.id===ORGS[2].id).name='가상 새 이름';
    await uploadFor(page,{id:ORGS[2].id,name:'가상 새 이름'},'넷째.pdf');
    await expect.poll(()=>itemOf(s,UUIDS['upload-2'])).toBe(made.id);
    expect(s.folders.filter(f=>f.parent_id==='pp')).toHaveLength(3); // 새 이름 폴더를 또 만들지 않는다
    expect(errors).toEqual([]);
  });

  test('남의 작업공간 조직(공유로 보이는 조직)의 자료는 내 자료실 조직 폴더에 넣지 않는다',async({page})=>{
    const {s,errors}=await boot(page,{orgFilesFolder:'pp'});
    await uploadFor(page,{id:FOREIGN,name:'가상 남의 조직'},'남.pdf');
    await expect.poll(()=>s.uploads.length).toBe(1);
    await page.waitForTimeout(500);
    expect(s.items.some(x=>x.document_id===UUIDS['upload-1'])).toBe(false);
    expect(s.orgCalls||[]).toEqual([]);
    expect(s.folders.some(f=>f.name==='가상 남의 조직')).toBe(false);
    expect(errors).toEqual([]);
  });

  // S70-29(2026-11-25 명진 '다 없애 1회용 기능'): 메뉴 줄 대신, 모으는 폴더를 처음 정할 때([예]) 지난 조직 기록 자료도 저절로 모은다.
  test('처음 정할 때 저절로: [예] → 지난 조직 기록 자료 중 폴더 밖 것만 조직 폴더로, 고른 폴더 자료는 그대로, [되돌리기]',async({page})=>{
    const D=n=>`00000000-0000-4000-8000-00000000b00${n}`;
    const {s,errors}=await boot(page,{orgFilesFolder:null});
    s.docs.push({id:D(1),workspace_id:'workspace-1',organization_id:ORGS[0].id,title:'가'},{id:D(2),workspace_id:'workspace-1',organization_id:ORGS[0].id,title:'나'},{id:D(3),workspace_id:'workspace-1',organization_id:ORGS[1].id,title:'다'});
    s.items.push({workspace_id:'workspace-1',document_id:D(2),folder_id:'other'});
    await uploadFor(page,ORGS[0],'첫 자료.pdf');
    const notice=page.locator('#kptuNotice');
    await expect(notice.locator('.kptu-notice-text')).toHaveText('조직 기록 자료를 ‘가상 부모’ 폴더에 모을까요?');
    await notice.getByRole('button',{name:'예',exact:true}).click();
    await expect.poll(()=>s.orgFilesFolder).toBe('pp');
    await expect.poll(()=>itemOf(s,D(1))).toBe('c1');
    await expect.poll(()=>itemOf(s,D(3))).toBe('c2');
    expect(itemOf(s,D(2))).toBe('other');
    await expect.poll(()=>itemOf(s,UUIDS['upload-1'])).toBe('c1');
    await expect(notice.locator('.kptu-notice-text')).toContainText('지난 조직 기록 자료');
    await notice.getByRole('button',{name:'되돌리기'}).click();
    await expect.poll(()=>itemOf(s,D(1))).toBeUndefined();
    await expect.poll(()=>itemOf(s,D(3))).toBeUndefined();expect(itemOf(s,D(2))).toBe('other');
    expect(errors).toEqual([]);
  });
  test('이미 정한 뒤에는 지난 자료를 다시 모으지 않는다(올린 자료만 넣음)',async({page})=>{
    const D=n=>`00000000-0000-4000-8000-00000000b00${n}`;
    const {s,errors}=await boot(page,{orgFilesFolder:'pp'});
    s.docs.push({id:D(1),workspace_id:'workspace-1',organization_id:ORGS[0].id,title:'가'});
    await uploadFor(page,ORGS[0],'새 자료.pdf');
    await expect.poll(()=>itemOf(s,UUIDS['upload-1'])).toBe('c1');
    await page.waitForTimeout(300);
    expect(itemOf(s,D(1))).toBeUndefined();
    expect(errors).toEqual([]);
  });

});
