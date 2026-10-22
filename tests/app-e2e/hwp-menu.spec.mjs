import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {openHome} from './helpers/home-entry.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {servePagesCors} from './helpers/hwp-editor.mjs';
// HWP-편집기 메뉴 입구: ☰ 메뉴(phone) and the sidebar (PC) open [HWP 편집]. The editor (about 20MB) loads only on this
// screen. A device file is downloaded as HWP or handed to the library's own [+ 자료 등록] dialog, where the person
// picks project and category; nothing else goes to the server. Leaving with unsaved edits asks first.
test.setTimeout(120000);
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const HWP_MAGIC=[0xd0,0xcf,0x11,0xe0];
const sample=name=>new URL(`../fixtures/hwp-lab/${name}`,import.meta.url).pathname;
const status=page=>page.locator('#hwpLabStatus');

// File name and first bytes of the multipart file part.
function uploadedFile(request){
  const boundary=(request.headers()['content-type']||'').split('boundary=')[1],text=request.postDataBuffer().toString('latin1');
  for(const chunk of text.split('--'+boundary).slice(1,-1)){
    const [head,...rest]=chunk.split('\r\n\r\n'),file=/filename="([^"]*)"/.exec(head)?.[1];
    if(file!==undefined)return {name:Buffer.from(file,'latin1').toString('utf8'),bytes:[...Buffer.from(rest.join('\r\n\r\n'),'latin1').subarray(0,4)]};
  }
  return null;
}

async function setup(page,width){
  await page.setViewportSize({width,height:width<761?844:900});
  await servePagesCors(page);
  const seen={external:[],editor:[],errors:[],dialogs:[],library:[]};
  page.on('request',request=>{
    const url=new URL(request.url());
    if(!['http:','https:'].includes(url.protocol))return;
    if(url.origin!==testOrigin&&url.origin!==SB)seen.external.push(request.url());
    if(url.pathname.includes('/hwp-lab/'))seen.editor.push(request.url());
  });
  page.on('pageerror',error=>seen.errors.push(error.message));
  await openHome(page);
  for(const t of ['app_suborganizations','app_suborganization_assignees','app_spaces','app_record_links','app_meetings','app_documents'])await page.route(SB+'/rest/v1/'+t+'?**',r=>r.fulfill({json:[]}));
  await page.route(SB+'/functions/v1/library-files',route=>{
    seen.library.push(uploadedFile(route.request()));
    return route.fulfill({headers:{'access-control-allow-origin':'*'},json:{ok:true,document:{id:'doc-new',title:'sample'}}});
  });
  return seen;
}
async function enterFromMenu(page,width,{ready=true}={}){
  if(width<761){
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav').getByRole('button',{name:'HWP 편집',exact:true}).click();
  }else await page.locator('.app-nav').getByRole('button',{name:'HWP 편집',exact:true}).click();
  await expect(page.locator('#hwpView')).toBeVisible();
  if(ready)await expect(status(page)).toHaveText(/편집기가 준비됐습니다/,{timeout:60000});
  expect(new URL(page.url()).searchParams.get('view')).toBe('hwp');
}
async function openAndType(page,width,name='sample.hwp'){
  await page.locator('#hwpLabFile').setInputFiles(sample(name));
  await expect(status(page)).toHaveText(new RegExp(`${name.replace('.','\\.')} · 1쪽을 열었습니다`),{timeout:30000});
  await page.frameLocator('#hwpLabEditor iframe').locator('#scroll-container').click({position:{x:width<761?60:200,y:width<761?60:120}});
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('메뉴입구');
  // The screen reads the editor's change counter every 2 seconds.
  await page.waitForTimeout(2500);
}
const box=locator=>locator.evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}});

for(const width of [390,1280])test(`menu entry opens a device HWP and hands the edited file to the library upload dialog ${width}`,async({page},info)=>{
  const seen=await setup(page,width);
  // Other screens never fetch the editor.
  await page.evaluate(()=>window.KPTURouter.go('library'));
  await expect(page.locator('#libraryView')).toBeVisible();
  await page.waitForTimeout(300);
  expect(seen.editor).toEqual([]);

  await enterFromMenu(page,width);
  expect(seen.editor.length).toBeGreaterThan(0);
  await expect(page.locator('#hwpLabTitle')).toHaveText('HWP 편집');
  await expect(page.locator('#hwpLabEditor iframe')).toHaveAttribute('sandbox','allow-scripts');
  for(const name of ['파일 선택','내 기기에 저장','자료실에 올리기'])await expect(page.locator('#hwpView').getByRole('button',{name,exact:true})).toBeVisible();
  await expect(page.locator('#hwpLabUpload')).toBeDisabled();
  const [pick,save,upload,editor]=await Promise.all(['#hwpLabPick','#hwpLabSave','#hwpLabUpload','#hwpLabEditor'].map(id=>box(page.locator(id))));
  for(const b of [pick,save,upload])expect(b.h).toBeGreaterThanOrEqual(44);
  if(width<761){
    await expect(page.locator('[data-mobile-view-name]')).toHaveText('HWP 편집');
    // [파일 선택] fills one row; the two save buttons share the next row in equal halves.
    expect(save.y).toBe(upload.y);
    expect(Math.abs(save.w-upload.w)).toBeLessThanOrEqual(1);
    expect(Math.abs(pick.x-save.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(pick.x+pick.w-(upload.x+upload.w))).toBeLessThanOrEqual(1);
  }else{
    // Title and buttons share one row; the editor takes the content width and most of the window height.
    const title=await box(page.locator('#hwpLabTitle'));
    expect(Math.abs((title.y+title.h/2)-(pick.y+pick.h/2))).toBeLessThanOrEqual(8);
    expect(new Set([pick.y,save.y,upload.y]).size).toBe(1);
    expect(editor.w).toBeGreaterThanOrEqual(900);
    // UI-상단줄: PC 상단 줄(40px + 간격 8px)만큼 편집기 높이가 줄었다(900 - 200 - 48). 편집기 아래가 창 안에 들어오는지도 본다.
    expect(editor.h).toBeGreaterThanOrEqual(680-48);
    expect(editor.y+editor.h).toBeLessThanOrEqual(900);
  }

  page.on('dialog',dialog=>{seen.dialogs.push(dialog.message());void dialog.dismiss()});
  await openAndType(page,width);
  await page.screenshot({path:info.outputPath(`hwp-menu-${width}.png`)});
  await page.locator('#hwpLabUpload').click();
  // The library's own dialog opens with the edited HWP selected; project and category stay for the person.
  await expect(page.locator('#libraryView')).toBeVisible();
  await expect(page.locator('#documentModal')).toBeVisible();
  await expect(page.locator('#librarySelectedFiles')).toContainText('sample-수정.hwp');
  await expect(page.locator('#documentStatus')).toHaveText('HWP 편집에서 고친 파일을 넣었어요. 프로젝트·분류를 고른 뒤 [등록]을 누르세요.');
  await expect(page.locator('#docProject')).toHaveValue('');
  await expect(page.locator('#docCategory')).toHaveValue('');
  expect(seen.library).toEqual([]);
  await page.screenshot({path:info.outputPath(`hwp-menu-library-${width}.png`)});
  await page.locator('#saveDocumentBtn').click();
  await expect.poll(()=>seen.library.length).toBe(1);
  expect(seen.library[0]).toEqual({name:'sample-수정.hwp',bytes:HWP_MAGIC});

  expect(seen.dialogs).toEqual([]);
  expect(seen.external).toEqual([]);
  expect(seen.errors).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('leaving with unsaved edits asks first; a downloaded file leaves without asking',async({page})=>{
  const seen=await setup(page,390);
  await enterFromMenu(page,390);
  await openAndType(page,390);
  const asked=[];
  page.once('dialog',dialog=>{asked.push(dialog.message());void dialog.dismiss()});
  await page.locator('.mobile-tabs [data-view="home"]').click();
  await expect.poll(()=>asked.length).toBe(1);
  expect(asked[0]).toContain('저장하지 않은 고친 내용');
  await expect(page.locator('#hwpView')).toBeVisible();

  const [file]=await Promise.all([page.waitForEvent('download'),page.locator('#hwpLabSave').click()]);
  expect(file.suggestedFilename()).toBe('sample-수정.hwp');
  await expect(status(page)).toHaveText(/sample-수정\.hwp\(\d+KB\)을 내려받았습니다/);
  page.on('dialog',dialog=>{asked.push(dialog.message());void dialog.dismiss()});
  await page.locator('.mobile-tabs [data-view="home"]').click();
  await expect(page.locator('#homeView')).toBeVisible();
  expect(asked).toHaveLength(1);

  // Edits after the download ask again; accepting leaves.
  // The device file stays open on return.
  await enterFromMenu(page,390,{ready:false});
  await expect(page.locator('#hwpLabSave')).toBeEnabled();
  await page.frameLocator('#hwpLabEditor iframe').locator('#scroll-container').click({position:{x:60,y:60}});
  await page.keyboard.type('또');
  await page.waitForTimeout(2500);
  page.removeAllListeners('dialog');
  page.once('dialog',dialog=>{asked.push(dialog.message());void dialog.accept()});
  await page.locator('.mobile-tabs [data-view="calendar"]').click();
  await expect(page.locator('#calendarView')).toBeVisible();
  expect(asked).toHaveLength(2);
  expect(seen.library).toEqual([]);
  expect(seen.external).toEqual([]);
  expect(seen.errors).toEqual([]);
});
