import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {openHome} from './helpers/home-entry.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
// HWP-편집기 1단계 시험판: ?view=hwp-lab only. The pinned rhwp editor runs from Web2's own files in a same-origin
// frame; files stay in the browser (no server, Drive or external request) and nothing is kept in device storage.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const sample=name=>new URL(`../fixtures/hwp-lab/${name}`,import.meta.url);
const HWP_MAGIC=[0xd0,0xcf,0x11,0xe0],ZIP_MAGIC=[0x50,0x4b,0x03,0x04];
test.setTimeout(120000);

function watch(page){
  const seen={external:[],editor:[],csp:[],errors:[]};
  page.on('request',request=>{
    const url=new URL(request.url());
    if(!['http:','https:'].includes(url.protocol))return;
    if(url.origin!==testOrigin&&url.origin!==SB)seen.external.push(request.url());
    if(url.pathname.includes('/hwp-lab/'))seen.editor.push(request.url());
    // Everything the editor frame asks for stays on Web2's own origin.
    if(request.frame()!==page.mainFrame()&&url.origin!==testOrigin)seen.external.push('frame '+request.url());
  });
  page.on('console',message=>{
    if(/Content Security Policy/i.test(message.text()))seen.csp.push(message.text());
  });
  page.on('pageerror',error=>seen.errors.push(error.message));
  return seen;
}

// Once the lab binds its editor, the frame ignores other senders. To read what a file shows, the test opens it in a
// second instance of the same self-hosted editor and reads the page text from its SVG.
const pageText=(page,bytes,name)=>page.evaluate(async({bytes,name})=>{
  const {createEditor}=await import('./hwp-lab/rhwp-0.8.7/sdk/index.js');
  const box=document.createElement('div');box.style.cssText='position:fixed;left:0;top:0;width:800px;height:600px;opacity:0;pointer-events:none';
  document.body.appendChild(box);
  try{
    const editor=await createEditor(box,{studioUrl:new URL('./hwp-lab/rhwp-0.8.7/studio/index.html',location.href).href});
    await editor.loadFile(new Uint8Array(bytes),name);
    const svg=new DOMParser().parseFromString(await editor.getPageSvg(0),'image/svg+xml');
    editor.destroy?.();
    return svg.documentElement.textContent.replace(/\s+/g,'');
  }finally{box.remove()}
},{bytes,name});

async function openLab(page,width){
  await page.setViewportSize({width,height:width<761?844:900});
  const seen=watch(page);
  await openHome(page,{query:'?view=hwp-lab'});
  await expect(page.locator('#hwp-labView')).toBeVisible();
  await expect(page.locator('#hwpLabStatus')).toHaveText(/편집기가 준비됐습니다/,{timeout:60000});
  await expect(page.locator('#hwpLabSave')).toBeDisabled();
  return seen;
}

async function download(page){
  const [file]=await Promise.all([page.waitForEvent('download'),page.locator('#hwpLabSave').click()]);
  const path=await file.path();
  return {name:file.suggestedFilename(),bytes:[...readFileSync(path)],path};
}

for(const width of [390,1280])test(`open, edit and download an HWP file inside the browser ${width}`,async({page},info)=>{
  const seen=await openLab(page,width);
  await page.locator('#hwpLabFile').setInputFiles(sample('sample.hwp').pathname);
  await expect(page.locator('#hwpLabStatus')).toHaveText('sample.hwp · 1쪽을 열었습니다. 고친 뒤 [내 기기에 저장(다운로드)]을 누르세요.',{timeout:30000});
  expect(await pageText(page,[...readFileSync(sample('sample.hwp'))],'sample.hwp')).toContain('HWP편집기시험문서');
  await page.screenshot({path:info.outputPath(`hwp-lab-${width}.png`)});

  // Type into the document body: the editor keeps focus inside its own frame.
  const editor=page.frameLocator('#hwpLabEditor iframe');
  await editor.locator('#scroll-container').click({position:{x:width<761?60:200,y:width<761?60:120}});
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('추가문장');

  const saved=await download(page);
  expect(saved.name).toBe('sample-수정.hwp');
  expect(saved.bytes.slice(0,4)).toEqual(HWP_MAGIC);
  await expect(page.locator('#hwpLabStatus')).toHaveText(/sample-수정\.hwp\(\d+KB\)을 내려받았습니다/);

  // The downloaded copy carries the typed text and still opens in the lab.
  expect(await pageText(page,saved.bytes,saved.name)).toContain('추가문장HWP편집기시험문서');
  await page.locator('#hwpLabFile').setInputFiles({name:saved.name,mimeType:'application/x-hwp',buffer:Buffer.from(saved.bytes)});
  await expect(page.locator('#hwpLabStatus')).toHaveText(/sample-수정\.hwp · 1쪽을 열었습니다/,{timeout:30000});

  expect(seen.external).toEqual([]);
  expect(seen.csp).toEqual([]);
  expect(seen.errors).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  // No document copy, recent list or editor setting is left in this origin's storage.
  const stored=await page.evaluate(async()=>({
    databases:(await indexedDB.databases()).map(db=>db.name),
    local:Object.keys(localStorage).filter(key=>/rhwp/i.test(key)),
    session:Object.keys(sessionStorage).filter(key=>/rhwp/i.test(key))
  }));
  expect(stored).toEqual({databases:[],local:[],session:[]});
});

test('HWPX opens and saves back as HWPX; other files are refused before the editor sees them',async({page})=>{
  const seen=await openLab(page,1280);
  await page.locator('#hwpLabFile').setInputFiles({name:'메모.txt',mimeType:'text/plain',buffer:Buffer.from('not a document')});
  await expect(page.locator('#hwpLabStatus')).toHaveText('HWP(.hwp) 또는 HWPX(.hwpx) 파일만 열 수 있습니다.');
  await page.locator('#hwpLabFile').setInputFiles({name:'가짜.hwp',mimeType:'application/octet-stream',buffer:Buffer.from('PK not hwp')});
  await expect(page.locator('#hwpLabStatus')).toHaveText('HWP(.hwp) 또는 HWPX(.hwpx) 파일만 열 수 있습니다.');
  await expect(page.locator('#hwpLabSave')).toBeDisabled();

  await page.locator('#hwpLabFile').setInputFiles(sample('sample.hwpx').pathname);
  await expect(page.locator('#hwpLabStatus')).toHaveText(/sample\.hwpx · 1쪽을 열었습니다/,{timeout:30000});
  const saved=await download(page);
  expect(saved.name).toBe('sample-수정.hwpx');
  expect(saved.bytes.slice(0,4)).toEqual(ZIP_MAGIC);
  expect(await pageText(page,saved.bytes,saved.name)).toContain('HWP편집기시험문서');
  expect(seen.external).toEqual([]);
  expect(seen.csp).toEqual([]);
});

test('the editor frame cannot read Web2 session storage and is never loaded by other views',async({page})=>{
  const seen=watch(page);
  await openHome(page);
  await page.evaluate(()=>window.KPTURouter.go('basket'));
  await page.waitForTimeout(500);
  expect(seen.editor).toEqual([]);
  expect(await page.locator('#hwpLabEditor iframe').count()).toBe(0);

  await page.evaluate(()=>window.KPTURouter.go('hwp-lab'));
  await expect(page.locator('#hwpLabStatus')).toHaveText(/편집기가 준비됐습니다/,{timeout:60000});
  expect(new URL(page.url()).searchParams.get('view')).toBe('hwp-lab');
  const frame=page.frames().find(item=>item.url().includes('/hwp-lab/rhwp-0.8.7/studio/'));
  const web2Keys=await page.evaluate(()=>Object.keys(localStorage));
  expect(web2Keys.length).toBeGreaterThan(0);
  // The frame gets memory-only stand-ins: none of Web2's keys (session included) are visible there.
  expect(await frame.evaluate(keys=>({visible:keys.filter(key=>localStorage.getItem(key)!==null),idb:typeof indexedDB,caches:typeof caches}),web2Keys)).toEqual({visible:[],idb:'undefined',caches:'undefined'});
  expect(seen.external).toEqual([]);
});
