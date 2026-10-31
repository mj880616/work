import {test,expect} from '@playwright/test';
import {bootLibrary,libDoc,SB} from './helpers/library-folder-server.mjs';
// S46-25 묶음으로올리기 (2026-10-31 명진 결정): 사업영역·담당조직·분류 묶기에서 PC 파일을 그 묶음 머리에 놓으면 그 값을 달아 올린다.
// 사업영역·분류는 [+ 자료 등록]과 같은 library-files 요청 칸(project_id·category), 담당조직은 담당조직 상세 [+]와 같은 자료 연결(PATCH organization_id).
// 월별 묶기와 '값 없음' 묶음(사업영역 없음·조직 없음)은 지금처럼 화면 끌어놓기. 가짜 서버만 쓴다(실제 Supabase·Drive·AI 없음).
const ORGS=[{id:'org-1',name:'공공기관사업본부',active:true},{id:'org-2',name:'철도본부',active:true}];
const DOCS=[libDoc('a-1','top-a',{organization_id:'org-1'}),libDoc('a-2','top-a',{organization_id:'org-2',category:'교섭'}),libDoc('n-1',null)];
const head=key=>`#documentList details[data-lu-node="${key}"] > summary`;
const dropFiles=(page,to,names,{wait=0}={})=>page.evaluate(async({to,names,wait})=>{
  const dst=document.querySelector(to),dt=new DataTransfer(),r=dst.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
  for(const name of names)dt.items.add(new File(['PK synthetic'],name,{type:'application/octet-stream'}));
  const fire=type=>{const ev=new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:dt,clientX:x,clientY:y});dst.dispatchEvent(ev);return ev};
  fire('dragenter');const over=fire('dragover');
  if(wait){await new Promise(res=>setTimeout(res,wait));fire('dragover')}
  const node=dst.closest('details[data-lu-node]');
  const out={allowed:over.defaultPrevented,into:dst.classList.contains('lu-drop-into'),group:!!node?.classList.contains('lu-drop-group'),open:!!node?.open,hint:document.querySelector('#libraryDropOverlay')?.textContent||''};
  fire('drop');return out;
},{to,names,wait});

// 기본 가짜 서버 위에 덧씌운다(뒤에 등록한 route가 먼저): 올리기 칸 기록, 조직 목록, 자료 조직 연결(돌려받는 줄).
async function boot(page,group){
  const {s,errors}=await bootLibrary(page,1440,{docs:DOCS.map(d=>({...d}))});
  s.fields=[];
  await page.route(`${SB}/functions/v1/library-files`,route=>{
    const raw=(route.request().postDataBuffer()||Buffer.from('')).toString('utf8');
    const field=name=>raw.match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`))?.[1]??null;
    s.fields.push({project_id:field('project_id'),category:field('category'),organization_id:field('organization_id')});
    const row={id:`upload-${s.uploads.length+1}`,workspace_id:'workspace-1',project_id:field('project_id'),organization_id:null,title:'업로드',file_name:'up.pdf',category:field('category')||'기타',tags:[],created_at:new Date().toISOString()};
    s.uploads.push(row);s.docs.push(row);
    return route.fulfill({json:{ok:true,document:row}});
  });
  // AI 채우기 앞의 글자 읽기(document-actions document-text)는 아무것도 바꾸지 않는 응답.
  await page.route(`${SB}/functions/v1/document-actions`,route=>route.fulfill({json:{ok:true}}));
  await page.route(`${SB}/rest/v1/app_suborganizations*`,route=>route.fulfill({json:ORGS}));
  await page.route(`${SB}/rest/v1/app_documents*`,route=>{
    const req=route.request();if(req.method()!=='PATCH')return route.fallback();
    const url=new URL(req.url()),id=String(url.searchParams.get('id')||'').replace(/^eq\./,''),body=req.postDataJSON()||{};
    s.patches.push({id,body});const row=s.docs.find(d=>d.id===id);if(row)Object.assign(row,body);
    return route.fulfill({json:row?[{id:row.id,organization_id:row.organization_id??null}]:[]});
  });
  await page.locator('#libraryGroupBy').getByRole('radio',{name:group}).click();
  await expect(page.locator('#documentList details[data-lu-node]').first()).toBeAttached();
  return {s,errors};
}

test.describe('PC 1440 PC 파일을 묶음 머리에 놓아 그 값으로 올리기',()=>{
  test('담당조직: 닫힌 공공기관사업본부 머리에 2개 → 표시·머물면 열림 뒤 그 조직으로, 조직 없음에 놓으면 지금처럼',async({page})=>{
    const {s,errors}=await boot(page,'담당조직');
    await expect(page.locator(head('o:org-1'))).toBeVisible();
    await expect(page.locator('#documentList details[data-lu-node="o:org-1"]')).not.toHaveAttribute('open','');
    const r=await dropFiles(page,head('o:org-1'),['a.hwpx','b.pdf'],{wait:1300});
    expect(r).toEqual({allowed:true,into:true,group:true,open:true,hint:'놓으면 ‘공공기관사업본부’로 올려요'});
    await expect(page.locator('#libraryDropStatus')).toHaveText('공공기관사업본부로 2개 올렸어요');
    expect(s.uploads.map(u=>u.id)).toEqual(['upload-1','upload-2']);
    // 조직은 올리기 요청 칸이 아니라 올린 뒤 자료 연결(담당조직 상세 [+]와 같은 길).
    expect(s.fields.every(f=>f.organization_id===null)).toBe(true);
    expect(s.patches.filter(p=>p.body?.organization_id).map(p=>[p.id,p.body.organization_id])).toEqual([['upload-1','org-1'],['upload-2','org-1']]);
    await expect(page.locator('#documentList details[data-lu-node="o:org-1"] [data-lu-document="upload-2"]')).toHaveCount(1);
    await expect(page.locator('#documentList .lu-drop-into,#documentList .lu-drop-group')).toHaveCount(0);
    const out=await dropFiles(page,head('o:none'),['c.pdf']);
    expect(out.hint).toBe('놓으면 바로 올려요');expect(out.group).toBe(false);
    await expect(page.locator('#libraryDropStatus')).toHaveText('1개 올렸어요');
    expect(s.uploads.length).toBe(3);expect(s.patches.filter(p=>p.body?.organization_id).length).toBe(2);
    expect(errors).toEqual([]);
  });

  test('사업영역: 머리에 놓으면 project_id를 실어 올림, 사업영역 없음은 지금처럼',async({page})=>{
    const {s,errors}=await boot(page,'사업영역');
    const r=await dropFiles(page,head('p:top-a'),['a.pdf','b.pdf']);
    expect(r.hint).toBe('놓으면 ‘공공기관 기능개혁 대응’으로 올려요');expect(r.into).toBe(true);expect(r.group).toBe(true);
    await expect(page.locator('#libraryDropStatus')).toHaveText('공공기관 기능개혁 대응으로 2개 올렸어요');
    expect(s.fields.map(f=>f.project_id)).toEqual(['top-a','top-a']);
    const out=await dropFiles(page,head('p:none'),['c.pdf']);
    expect(out.hint).toBe('놓으면 바로 올려요');
    await expect(page.locator('#libraryDropStatus')).toHaveText('1개 올렸어요');
    expect(s.fields.at(-1).project_id).toBe(null);
    expect(errors).toEqual([]);
  });

  test('분류: 교섭 머리에 놓으면 category를 실어 올림(AI가 덮지 않게 keep), 월별은 지금처럼',async({page})=>{
    const {s,errors}=await boot(page,'분류');
    const ai=[];await page.route(`${SB}/functions/v1/ai-assist`,route=>{ai.push(route.request().postDataJSON());return route.fulfill({json:{ok:true,updated:0}})});
    const r=await dropFiles(page,head('c:교섭'),['a.pdf']);
    expect(r.hint).toBe('놓으면 ‘교섭’으로 올려요');expect(r.group).toBe(true);
    await expect(page.locator('#libraryDropStatus')).toHaveText('교섭으로 1개 올렸어요');
    expect(s.fields.map(f=>f.category)).toEqual(['교섭']);
    await expect.poll(()=>ai.length).toBeGreaterThan(0);
    expect(ai[0].keep).toContain('category');
    await page.locator('#libraryGroupBy').getByRole('radio',{name:'월별'}).click();
    const month=await page.locator('#documentList details[data-lu-node^="m:"]').first().getAttribute('data-lu-node');
    const out=await dropFiles(page,head(month),['b.pdf']);
    expect(out.hint).toBe('놓으면 바로 올려요');expect(out.group).toBe(false);
    await expect(page.locator('#libraryDropStatus')).toHaveText('1개 올렸어요');
    expect(s.fields.at(-1)).toEqual({project_id:null,category:null,organization_id:null});
    expect(errors).toEqual([]);
  });
});
