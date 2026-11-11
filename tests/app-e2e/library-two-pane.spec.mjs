import {test,expect} from '@playwright/test';
import {bootLibrary,libFolder,libDoc} from './helpers/library-folder-server.mjs';
import {libraryTopMenu} from './helpers/library-tree.mjs';
import {pinch} from './helpers/pinch.mjs';
// S55-11 LIB-두칸보기(시안 docs/design/mockups/library-two-pane.html, 명진 11/09 18:16 'ㅇ'): PC·펼친 폴드 폴더 묶기 = 양쪽 다 폴더 + 자료 두 칸.
// 칸마다 위치·폴더 들어가기, 칸 사이·같은 칸 폴더 줄 끌어 옮기기(실제 브라우저 끌기), 자기 안 막음, Tab·F6, [▥ 두 칸] 켬/끔(서버 기억),
// 경계 폭(split_ratio.library, 서버 기억), 폰은 한 칸. 흡수한 나무 접수(폴더 밖·나무로 끌기·나무 넘침·접기·폭)는 두 칸에서 같은 결과로 본다. 이름은 지어낸 것.
const FOLDERS=[
  libFolder('fa','top-a',{name:'가상 A',sort_order:1024}),
  libFolder('fc','child-a1',{name:'가상 C',parent_id:'fa',sort_order:0}),
  libFolder('fn',null,{name:'가상 N',sort_order:2048}),
  libFolder('fz',null,{name:'가상 Z',sort_order:3072})
];
const ITEMS=[{document_id:'a-1',folder_id:'fc'},{document_id:'n-1',folder_id:'fa'}];
const pane=i=>`#documentList [data-lu-pane-i="${i}"]`;
const folderIn=(i,id)=>`${pane(i)} [data-lu-nav="${id}"]`;
// S56-40 LIB-두칸폴더펼치기: 폴더 줄 누르기 = 그 칸 안 펼치기·접기. 그 폴더로 들어가기는 우클릭 [이 폴더로 들어가기].
const enterIn=async(page,i,id)=>{await page.locator(folderIn(i,id)).click({button:'right'});await page.locator('#luFolderMenu [data-lu-folder-action="enter"]').click()};
const docIn=(i,id)=>`${pane(i)} [data-lu-document="${id}"]`;
const line=page=>page.locator('#libraryFolderStatusLine');
const folderOf=(s,doc)=>s.items.find(x=>x.document_id===doc)?.folder_id||null;
const parentOf=(s,id)=>s.folders.find(f=>f.id===id)?.parent_id||null;
const boot=(page,width,init={})=>bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,group:'폴더',init:{viewPrefs:null,...init}});

for(const width of [1440,884])test.describe(`자료실 ${width} 두 칸`,()=>{
  test('기본 두 칸: 양쪽 다 폴더 + 자료, 칸마다 따로 들어가기(나무 없음), 맨 위는 폴더 밖 자료도',async({page})=>{
    const {errors}=await boot(page,width);
    await expect(page.locator('#documentList [data-lu-two]')).toBeVisible();
    await expect(page.locator('#libraryFolderNav')).toHaveCount(0);
    await expect(page.locator('#libraryPath')).toHaveCount(0);
    await expect(page.locator('#libraryTwoBtn')).toHaveAttribute('aria-pressed','true');
    for(const i of [0,1]){
      for(const id of ['fa','fn','fz'])await expect(page.locator(folderIn(i,id))).toBeVisible();
      // LIB-나무폴더밖 흡수: 맨 위 칸에 폴더 밖 자료가 바로 보인다.
      for(const id of ['a-2','a1-1'])await expect(page.locator(docIn(i,id))).toBeVisible();
      await expect(page.locator(`${pane(i)} .lu-pane-here`)).toHaveText('자료실');
    }
    // 오른쪽 칸에서 가상 A로 들어간다 → 왼쪽은 그대로.
    await enterIn(page,1,'fa');
    await expect(page.locator(`${pane(1)} .lu-pane-here`)).toHaveText('가상 A');
    await expect(page.locator(folderIn(1,'fc'))).toBeVisible();
    await expect(page.locator(docIn(1,'n-1'))).toBeVisible();
    await expect(page.locator(docIn(1,'a-2'))).toHaveCount(0);
    await expect(page.locator(`${pane(0)} .lu-pane-here`)).toHaveText('자료실');
    await expect(page.locator(pane(1))).toHaveClass(/lu-pane-cur/);
    // 왼쪽 칸에서 가상 A › 가상 C로 들어갔다가 위치 줄로 맨 위.
    await enterIn(page,0,'fa');await enterIn(page,0,'fc');
    await expect(page.locator(`${pane(0)} .lu-pane-here`)).toHaveText('가상 C');
    await expect(page.locator(docIn(0,'a-1'))).toBeVisible();
    await expect(page.locator(pane(0))).toHaveClass(/lu-pane-cur/);
    await page.locator(`${pane(0)} [data-lu-pane-up]`).click();
    await expect(page.locator(`${pane(0)} .lu-pane-here`)).toHaveText('가상 A');
    await page.locator(`${pane(0)} [data-lu-pane-go=""]`).click();
    await expect(page.locator(`${pane(0)} .lu-pane-here`)).toHaveText('자료실');
    // 정렬: 이름순이면 가상 A·N·Z 폴더 다음 자료 이름순.
    await page.locator(`${pane(0)} [data-lu-pane-sort]`).selectOption('name');
    await expect(page.locator(`${pane(0)} [data-lu-prow]`).first()).toHaveAttribute('data-lu-prow','f:fa');
    expect(errors).toEqual([]);
  });

  test('끌어 옮기기: 왼쪽 자료 → 오른쪽 칸 빈 자리(그 칸 폴더), 폴더 → 반대 칸 폴더 줄, 같은 칸 폴더 줄, 자기 안 막음',async({page})=>{
    test.setTimeout(90000);
    const {s,errors}=await boot(page,width);
    await enterIn(page,1,'fa');
    await expect(page.locator(`${pane(1)} .lu-pane-here`)).toHaveText('가상 A');
    // 왼쪽(맨 위) 자료 → 오른쪽 칸 빈 자리 = 가상 A.
    await page.locator(docIn(0,'a-2')).dragTo(page.locator(`${pane(1)} .lu-pane-head`));
    await expect.poll(()=>folderOf(s,'a-2')).toBe('fa');
    await expect(line(page)).toContainText('가상 A 폴더');await expect(line(page).locator('.lu-undo')).toHaveText('되돌리기');
    await expect(page.locator(docIn(1,'a-2'))).toBeVisible();
    // 같은 칸 폴더 줄: 왼쪽 자료 a1-1 → 왼쪽 가상 Z.
    await page.locator(docIn(0,'a1-1')).dragTo(page.locator(folderIn(0,'fz')));
    await expect.poll(()=>folderOf(s,'a1-1')).toBe('fz');
    // 옮기기가 끝나 목록을 다시 읽은 뒤에 안내가 뜬다(그 전에 다음 끌기를 놓으면 폴더 부품이 바쁜 동안이라 받지 않는다).
    await expect(line(page)).toContainText('가상 Z 폴더');
    // 폴더 → 반대 칸 폴더 줄: 왼쪽 가상 N → 오른쪽 가상 C.
    await page.locator(folderIn(0,'fn')).dragTo(page.locator(folderIn(1,'fc')));
    await expect.poll(()=>parentOf(s,'fn')).toBe('fc');
    await expect(line(page)).toContainText('폴더를 옮겼어요 → 가상 C 폴더');
    // 자기 안 막음: 왼쪽 가상 A → 오른쪽 칸(가상 A 안) 빈 자리 — 쓰기 없음.
    await page.waitForLoadState('networkidle');const n=s.writes.length;
    await page.locator(folderIn(0,'fa')).dragTo(page.locator(`${pane(1)} .lu-pane-head`));
    await page.waitForLoadState('networkidle');expect(s.writes.length).toBe(n);
    expect(parentOf(s,'fa')).toBeNull();
    expect(errors).toEqual([]);
  });
});

// S59-9 LIB-펼친폴더안놓기(명진 11/11 14:16): 칸 안에서 펼친 폴더 안 자료 줄(과 그 묶음 안 빈 틈) 위에 놓아도 그 폴더(가장 가까운 펼친 폴더)로.
// 표시는 그 폴더 줄(칸 상자 아님), 이미 그 폴더에 든 자료만 끌면 놓을 수 없음, 펼친 폴더 밖 빈 자리·맨 위 자료 줄은 지금처럼 그 칸의 지금 폴더(맨 위 = 폴더 밖).
// 자료 옮기기·여러 개·폴더·손가락 길게 눌러 끌기가 같은 판정(PC 파일 올리기는 library-folder-upload-drop.spec.mjs). 이름은 지어낸 것.
const sub=(i,id)=>`${pane(i)} [data-lu-pane-sub="${id}"]`;
const subDoc=(i,id,doc)=>`${sub(i,id)} [data-lu-document="${doc}"]`;
const MORE_DOCS=[libDoc('a-1','top-a'),libDoc('a-2','top-a'),libDoc('a1-1','child-a1'),libDoc('n-1',null),libDoc('n-2',null),libDoc('z-1',null)];
const MORE_ITEMS=[...ITEMS,{document_id:'n-2',folder_id:'fa'}];
const bootMore=(page,width)=>bootLibrary(page,width,{folders:FOLDERS,items:MORE_ITEMS,docs:MORE_DOCS,group:'폴더',init:{viewPrefs:null}});
// 안에서 시작한 끌기를 DragEvent로: dragstart → (놓을 곳 안 점 at, 기본 가운데의 실제 맨 위 요소에) dragover → 표시 읽기 → drop → dragend.
// rows: 표시를 읽을 폴더 줄(data-lu-nav 단추 선택자 → 그 .ft-row class). paneCls: 놓은 칸 상자 class.
async function dropInside(page,from,to,{at=null,rows={}}={}){
  return page.evaluate(({from,to,at,rows})=>{
    const src=document.querySelector(from),dst=document.querySelector(to),dt=new DataTransfer(),r=dst.getBoundingClientRect();
    const x=at?r.left+at.x:r.left+r.width/2,y=at?r.top+at.y:r.top+r.height/2,el=document.elementFromPoint(x,y);
    src.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:dt}));
    const over=new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:x,clientY:y});el.dispatchEvent(over);
    const marks=Object.fromEntries(Object.entries(rows).map(([k,sel])=>[k,document.querySelector(sel)?.closest('.ft-row')?.className||'']));
    const out={allowed:over.defaultPrevented,hit:el.closest('[data-lu-pane-sub]')?.dataset.luPaneSub??null,marks,paneCls:dst.closest('[data-lu-pane-i]')?.className||''};
    el.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:x,clientY:y}));
    src.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));
    return out;
  },{from,to,at,rows});
}

for(const width of [1440,884])test(`자료실 ${width} 두 칸: 왼쪽 자료를 오른쪽 칸 펼친 폴더 안 자료 줄에 놓으면 그 폴더 · 표시는 그 폴더 줄 · 되돌리기`,async({page})=>{
  test.setTimeout(90000);
  const {s,errors}=await boot(page,width);
  // 오른쪽 칸(맨 위)에서 가상 A를 펼친다 — 위치는 그대로 '자료실'.
  await page.locator(folderIn(1,'fa')).click();
  await expect(page.locator(subDoc(1,'fa','n-1'))).toBeVisible();
  await expect(page.locator(`${pane(1)} .lu-pane-here`)).toHaveText('자료실');
  // 원인 확인(전): 이 자리는 칸 상자(맨 위 = 폴더 밖)로 잡혀 폴더 밖 자료는 놓을 수 없었다. 이제 가상 A 줄에 표시하고 가상 A로 넣는다.
  const r=await dropInside(page,docIn(0,'a-2'),subDoc(1,'fa','n-1'),{rows:{fa:folderIn(1,'fa')}});
  expect(r.hit).toBe('fa');expect(r.allowed).toBe(true);
  expect(r.marks.fa).toContain('lu-drop-into');expect(r.paneCls).not.toMatch(/lu-drop-/);
  await expect.poll(()=>folderOf(s,'a-2')).toBe('fa');
  await expect(line(page)).toContainText('옮겼어요 1개 → 가상 A 폴더');await expect(line(page).locator('.lu-undo')).toHaveText('되돌리기');
  await expect(page.locator(subDoc(1,'fa','a-2'))).toBeVisible();
  await expect(page.locator('#documentList .lu-drop-into,#documentList .lu-drop-no')).toHaveCount(0);
  await line(page).locator('.lu-undo').click();await expect(line(page)).toContainText('되돌렸어요');
  await expect.poll(()=>folderOf(s,'a-2')).toBeNull();
  // 실제 마우스 끌기(명진이 하는 그대로)로 한 번 더: 같은 자리 → 가상 A.
  await page.locator(docIn(0,'a1-1')).dragTo(page.locator(subDoc(1,'fa','n-1')));
  await expect.poll(()=>folderOf(s,'a1-1')).toBe('fa');
  await expect(line(page)).toContainText('가상 A 폴더');
  expect(errors).toEqual([]);
});

test('PC 1440 두 칸: 여러 겹(안쪽 폴더 자료 줄 = 안쪽 폴더) · 묶음 안 빈 틈 · 이미 든 폴더는 놓을 수 없음 · 칸 바로 아래 자료 줄은 그 칸의 지금 폴더',async({page})=>{
  test.setTimeout(90000);
  const {s,errors}=await bootMore(page,1440);
  await page.locator(folderIn(1,'fa')).click();await page.locator(folderIn(1,'fc')).click();
  await expect(page.locator(subDoc(1,'fc','a-1'))).toBeVisible();await expect(page.locator(subDoc(1,'fa','n-1'))).toBeVisible();
  // 안쪽 가상 C 안 자료 줄 → 가상 C(바깥 가상 A가 아님). 표시는 가상 C 줄에만.
  let r=await dropInside(page,docIn(0,'a1-1'),subDoc(1,'fc','a-1'),{rows:{fa:folderIn(1,'fa'),fc:folderIn(1,'fc')}});
  expect(r.hit).toBe('fc');expect(r.allowed).toBe(true);expect(r.marks.fc).toContain('lu-drop-into');expect(r.marks.fa).not.toMatch(/lu-drop-/);
  await expect.poll(()=>folderOf(s,'a1-1')).toBe('fc');
  await expect(line(page)).toContainText('옮겼어요 1개 → 가상 C 폴더');
  // 가상 A 묶음 안 빈 틈(줄 왼쪽 들여쓰기 칸) → 가상 A.
  await expect(page.locator(subDoc(1,'fa','n-1'))).toBeVisible();
  r=await dropInside(page,docIn(0,'z-1'),sub(1,'fa'),{at:{x:4,y:10},rows:{fa:folderIn(1,'fa')}});
  expect(r.hit).toBe('fa');expect(r.allowed).toBe(true);expect(r.marks.fa).toContain('lu-drop-into');
  await expect.poll(()=>folderOf(s,'z-1')).toBe('fa');
  await expect(line(page)).toContainText('옮겼어요 1개 → 가상 A 폴더');
  // 이미 가상 A에 든 자료를 가상 A 묶음 안 다른 줄에 → 놓을 수 없음(가상 A 줄에 표시), 쓰기 없음.
  await page.waitForLoadState('networkidle');const n=s.writes.length;
  r=await dropInside(page,subDoc(1,'fa','n-2'),subDoc(1,'fa','n-1'),{rows:{fa:folderIn(1,'fa')}});
  expect(r.allowed).toBe(false);expect(r.marks.fa).toContain('lu-drop-no');
  await page.waitForLoadState('networkidle');expect(s.writes.length).toBe(n);
  // 칸 바로 아래(펼친 폴더 밖) 자료 줄은 지금처럼 그 칸의 지금 폴더 — 맨 위면 폴더 밖. 표시는 칸 상자.
  r=await dropInside(page,subDoc(1,'fa','n-1'),docIn(0,'a-2'));
  expect(r.hit).toBeNull();expect(r.allowed).toBe(true);expect(r.paneCls).toContain('lu-drop-into');
  await expect.poll(()=>folderOf(s,'n-1')).toBeNull();
  await expect(line(page)).toContainText('→ 폴더 밖');
  expect(errors).toEqual([]);
});

test('PC 1440 두 칸: 여러 개 골라 끌기·폴더 끌기도 펼친 폴더 안 자료 줄 = 그 폴더',async({page})=>{
  test.setTimeout(90000);
  const {s,errors}=await bootMore(page,1440);
  await page.locator(folderIn(1,'fa')).click();
  await expect(page.locator(subDoc(1,'fa','n-1'))).toBeVisible();
  // 고른 두 자료를 한꺼번에 → 가상 A.
  await libraryTopMenu(page,'select');
  await page.locator(`${pane(0)} [data-lu-pick="a-2"]`).check();await page.locator(`${pane(0)} [data-lu-pick="z-1"]`).check();
  const r=await dropInside(page,docIn(0,'a-2'),subDoc(1,'fa','n-1'),{rows:{fa:folderIn(1,'fa')}});
  expect(r.allowed).toBe(true);expect(r.marks.fa).toContain('lu-drop-into');
  await expect.poll(()=>['a-2','z-1'].map(id=>folderOf(s,id))).toEqual(['fa','fa']);
  await expect(line(page)).toContainText('옮겼어요 2개 → 가상 A 폴더');
  await page.keyboard.press('Escape');
  // 폴더 끌기: 왼쪽 가상 N(실제 마우스 끌기) → 오른쪽 가상 A 안 자료 줄 = 가상 A 안으로.
  await page.locator(folderIn(0,'fn')).dragTo(page.locator(subDoc(1,'fa','n-1')));
  await expect.poll(()=>parentOf(s,'fn')).toBe('fa');
  await expect(line(page)).toContainText('폴더를 옮겼어요 → 가상 A 폴더');
  // 자기 안 막음: 가상 A를 자기 묶음 안 자료 줄에 — 쓰기 없음.
  await page.waitForLoadState('networkidle');const n=s.writes.length;
  const self=await dropInside(page,folderIn(0,'fa'),subDoc(1,'fa','n-1'),{rows:{fa:folderIn(1,'fa')}});
  expect(self.allowed).toBe(false);
  await page.waitForLoadState('networkidle');expect(s.writes.length).toBe(n);expect(parentOf(s,'fa')).toBeNull();
  expect(errors).toEqual([]);
});

test.describe('펼친 폴드 884 손가락 두 칸 길게 눌러 끌기',()=>{
  test.use({hasTouch:true});
  const center=(page,sel)=>page.locator(sel).evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}});
  const touch=(cdp,type,pts)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:pts.map((p,i)=>({x:p.x,y:p.y,id:i}))});
  test('왼쪽 자료를 길게 눌러 오른쪽 칸 펼친 폴더 안 자료 줄에 놓으면 그 폴더',async({page})=>{
    const {s,errors}=await boot(page,884);
    await page.locator(folderIn(1,'fa')).click();
    await expect(page.locator(subDoc(1,'fa','n-1'))).toBeVisible();
    const cdp=await page.context().newCDPSession(page);
    const from=await center(page,docIn(0,'a-2')+' .lu-row-title');
    await touch(cdp,'touchStart',[from]);await page.waitForTimeout(700);
    await expect(page.locator(docIn(0,'a-2'))).toHaveClass(/lu-grabbed/);
    const to=await center(page,subDoc(1,'fa','n-1'));
    for(const f of [0.25,0.5,0.75,1])await touch(cdp,'touchMove',[{x:from.x+(to.x-from.x)*f,y:from.y+(to.y-from.y)*f}]);
    await expect(page.locator(folderIn(1,'fa')).locator('xpath=ancestor::div[contains(@class,"ft-row")][1]')).toHaveClass(/lu-drop-into/);
    await touch(cdp,'touchEnd',[]);
    await expect.poll(()=>folderOf(s,'a-2')).toBe('fa');
    await expect(line(page)).toContainText('가상 A 폴더');
    expect(errors).toEqual([]);
  });
});

// S56-40 LIB-두칸폴더펼치기(명진 11/10 18:25): 폴더 줄 누르기 = 그 칸 안에서 나무처럼 펼치기·접기(들어가지 않음),
// 들어가기는 우클릭 [이 폴더로 들어가기](메뉴를 연 칸에서), 손가락 화면은 두 손가락 벌리기 = 그 폴더만, 오므리기 = 한 단계 위.
for(const width of [1440,884])test(`자료실 ${width} 두 칸: 폴더 누르기 = 그 칸 안 펼치기·접기, 우클릭 [이 폴더로 들어가기]`,async({page})=>{
  const {errors}=await boot(page,width);
  const fa=page.locator(folderIn(0,'fa'));
  await expect(fa).toHaveAttribute('aria-expanded','false');
  await expect(page.locator(folderIn(0,'fc'))).toHaveCount(0);
  await fa.click();
  // 들어가지 않는다: 위치 줄은 그대로 '자료실', 그 아래 하위 폴더·자료가 들여 보인다.
  await expect(page.locator(`${pane(0)} .lu-pane-here`)).toHaveText('자료실');
  await expect(fa).toHaveAttribute('aria-expanded','true');
  await expect(page.locator(folderIn(0,'fc'))).toBeVisible();
  await expect(page.locator(`${pane(0)} [data-lu-pane-sub="fa"] [data-lu-document="n-1"]`)).toBeVisible();
  const x=async sel=>(await page.locator(sel).boundingBox()).x;
  expect(await x(`${folderIn(0,'fc')} .ft-name`)).toBeGreaterThan(await x(`${folderIn(0,'fa')} .ft-name`)+10);
  expect(await x(`${pane(0)} [data-lu-pane-sub="fa"] [data-lu-document="n-1"]`)).toBeGreaterThan(await x(docIn(0,'a-2'))+10);
  await expect(fa).toBeFocused();
  // 한 단 더: 가상 C를 펼치면 그 안 자료.
  await page.locator(folderIn(0,'fc')).click();
  await expect(page.locator(`${pane(0)} [data-lu-pane-sub="fc"] [data-lu-document="a-1"]`)).toBeVisible();
  // 다시 누르면 접힌다(안쪽도 함께 안 보임).
  await fa.click();
  await expect(fa).toHaveAttribute('aria-expanded','false');
  await expect(page.locator(folderIn(0,'fc'))).toHaveCount(0);
  await expect(page.locator(`${pane(0)} [data-lu-document="n-1"]`)).toHaveCount(0);
  // 빈 폴더는 눌러도 그대로.
  await page.locator(folderIn(0,'fz')).click();
  await expect(page.locator(folderIn(0,'fz'))).toHaveAttribute('aria-expanded','false');
  // 오른쪽 칸은 왼쪽과 상관없이 그대로 맨 위.
  await expect(page.locator(`${pane(1)} .lu-pane-here`)).toHaveText('자료실');
  // 펼친 상태로 [이 폴더로 들어가기] → 그 칸만 그 폴더.
  await fa.click();
  await fa.click({button:'right'});
  await expect(page.locator('#luFolderMenu [data-lu-folder-action="toggle"]')).toHaveText('접기');
  await page.locator('#luFolderMenu [data-lu-folder-action="enter"]').click();
  await expect(page.locator(`${pane(0)} .lu-pane-here`)).toHaveText('가상 A');
  await expect(page.locator(`${pane(1)} .lu-pane-here`)).toHaveText('자료실');
  await expect(page.locator(folderIn(0,'fc'))).toBeVisible();
  // 펼침 기억은 한 칸 목록과 같은 곳: 앞에서 펼친 가상 C는 펼친 채. 메뉴 [접기]도 같은 펼침(칸 안).
  await expect(page.locator(`${pane(0)} [data-lu-pane-sub="fc"] [data-lu-document="a-1"]`)).toBeVisible();
  await page.locator(folderIn(0,'fc')).click({button:'right'});
  await expect(page.locator('#luFolderMenu [data-lu-folder-action="toggle"]')).toHaveText('접기');
  await page.locator('#luFolderMenu [data-lu-folder-action="toggle"]').click();
  await expect(page.locator(`${pane(0)} [data-lu-document="a-1"]`)).toHaveCount(0);
  await expect(page.locator(folderIn(0,'fc'))).toHaveAttribute('aria-expanded','false');
  await expect(page.locator(`${pane(0)} .lu-pane-here`)).toHaveText('가상 A');
  expect(errors).toEqual([]);
});

test.describe('펼친 폴드 884 손가락 두 칸',()=>{
  test.use({hasTouch:true});
  test('두 손가락 벌리기 = 그 칸에서 그 폴더만, 오므리기 = 한 단계 위',async({page})=>{
    const {errors}=await boot(page,884);
    await page.locator(folderIn(1,'fa')).click();
    await expect(page.locator(folderIn(1,'fc'))).toBeVisible();
    await pinch(page,page.locator(folderIn(1,'fa')),'out');
    await expect(page.locator(`${pane(1)} .lu-pane-here`)).toHaveText('가상 A');
    await expect(page.locator(`${pane(0)} .lu-pane-here`)).toHaveText('자료실');
    await pinch(page,page.locator(`${pane(1)} .lu-pane-list`),'in');
    await expect(page.locator(`${pane(1)} .lu-pane-here`)).toHaveText('자료실');
    expect(errors).toEqual([]);
  });
});

test('PC 1440: Tab 칸 바꾸기 · F6 = 포커스 자료를 반대 칸 폴더로 · 고르면 [→ 오른쪽 폴더로 옮기기]',async({page})=>{
  const {s,errors}=await boot(page,1440);
  await enterIn(page,1,'fz');
  await expect(page.locator(`${pane(1)} .lu-pane-here`)).toHaveText('가상 Z');
  await page.locator(docIn(0,'a-2')).focus();
  await expect(page.locator(pane(0))).toHaveClass(/lu-pane-cur/);
  await page.keyboard.press('F6');
  await expect.poll(()=>folderOf(s,'a-2')).toBe('fz');
  await expect(line(page)).toContainText('가상 Z 폴더');
  await page.locator(docIn(0,'a1-1')).focus();
  await page.keyboard.press('Tab');
  await expect(page.locator(pane(1))).toHaveClass(/lu-pane-cur/);
  await expect(page.locator(pane(0))).not.toHaveClass(/lu-pane-cur/);
  expect(errors).toEqual([]);
});

test('PC 1440: [▥ 두 칸] 끄면 지금 한 칸(나무 | 목록), 서버에 기억 · 다시 켜기',async({page})=>{
  const {s,errors}=await boot(page,1440);
  await expect(page.locator('#documentList [data-lu-two]')).toBeVisible();
  await page.locator('#libraryTwoBtn').click();
  await expect(page.locator('#libraryTwoBtn')).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('#documentList [data-lu-two]')).toHaveCount(0);
  await expect(page.locator('#libraryFolderNav')).toBeVisible();
  await expect.poll(()=>s.viewPrefs?.library_two).toBe(false);
  await page.locator('#libraryTwoBtn').click();
  await expect(page.locator('#documentList [data-lu-two]')).toBeVisible();
  await expect.poll(()=>s.viewPrefs?.library_two).toBe(true);
  expect(errors).toEqual([]);
});

test('PC 1440: 가운데 경계를 키보드로 옮기면 폭이 바뀌고 서버(split_ratio.library)에 기억',async({page})=>{
  const {s,errors}=await boot(page,1440);
  const handle=page.locator('#documentList [data-lu-two] > .split-resize-handle');
  await expect(handle).toBeVisible();
  const w0=await page.locator(pane(0)).evaluate(e=>e.getBoundingClientRect().width);
  await handle.focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
  await expect.poll(()=>page.locator(pane(0)).evaluate(e=>e.getBoundingClientRect().width)).toBeGreaterThan(w0+10);
  await expect.poll(()=>s.viewPrefs?.split_ratio?.library||0).toBeGreaterThan(0.5);
  expect(errors).toEqual([]);
});

test('PC 1440: 폭을 기억한 서버면 다시 열어도 그 폭(다른 PC에서도 같은 값)',async({page})=>{
  const {errors}=await boot(page,1440,{viewPrefs:{split_ratio:{library:0.3}}});
  const box=await page.locator('#documentList [data-lu-two]').evaluate(e=>e.getBoundingClientRect().width);
  const w0=await page.locator(pane(0)).evaluate(e=>e.getBoundingClientRect().width);
  expect(w0/box).toBeLessThan(0.36);expect(w0/box).toBeGreaterThan(0.24);
  expect(errors).toEqual([]);
});

test('폰 390: 두 칸 없음 · [▥ 두 칸] 단추 없음(지금 한 칸 목록)',async({page})=>{
  const {errors}=await boot(page,390);
  await expect(page.locator('#documentList summary.lu-node-head').first()).toBeVisible();
  await expect(page.locator('#documentList [data-lu-two]')).toHaveCount(0);
  await expect(page.locator('#libraryTwoBtn')).toHaveCount(0);
  expect(errors).toEqual([]);
});
