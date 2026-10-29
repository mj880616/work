import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {openHome} from './helpers/home-entry.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {servePagesCors,hwpPress,openHwpMenu} from './helpers/hwp-editor.mjs';
// HWP-서식변환: [HWP 편집] > [노조 서식으로 만들기]. 문서 종류 칩 + 글 칸 + 오른쪽 아래 [취소][만들기] → 자료실 "양식"의 그 종류 빈 양식을 받고
// (document-actions hwp-open) → AI(ai-assist hwp_convert) → 편집기 칸막이 안에서 양식에 채워 편집기에 열기 → 위 줄 [내려받기]·[자료실에 저장].
// 서버(Supabase)는 모두 흉내 낸다. 빈 양식은 저장소의 시험 샘플(tests/fixtures/hwp-lab/sample.hwp: 시험 문장 한 줄)이다.
test.use({hasTouch:true});
test.setTimeout(150000);
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-10-06T01:00:00.123456+00:00';
const HWP=readFileSync(new URL('../fixtures/hwp-lab/sample.hwp',import.meta.url));
const cors={'access-control-allow-origin':'*','access-control-expose-headers':'X-Web2-Hwp'};
const RHWP=`hwp-lab/rhwp-${JSON.parse(readFileSync(new URL('../../scripts/hwp-lab/rhwp-pin.json',import.meta.url),'utf8')).version}/`;
const forms=[
  {id:'tpl-report',workspace_id:'w',title:'노조 보고서 양식',file_name:'보고서.hwp',category:'양식',created_at:stamp},
  {id:'tpl-letter',workspace_id:'w',title:'노조 공문 양식',file_name:'공문.hwp',category:'양식',created_at:stamp},
  {id:'tpl-meeting',workspace_id:'w',title:'노조 회의자료 양식',file_name:'회의자료.hwp',category:'양식',created_at:stamp},
];
const PASTED='# 가상 안내\n\n## 배경\n- 가상 회의를 진행했습니다.\n- 가상 협의를 마쳤습니다.\n\n※ 가상 참고';
const answer={ok:true,kind:'hwp_convert',doc_type:'letter',title:'가상 안내',dropped:0,blocks:[
  {kind:'l1',text:'추진 배경'},{kind:'l2',text:'가상 회의 진행.'},{kind:'l2',text:'가상 협의 완료.'},{kind:'note',text:'가상 참고'}]};

// The editor frame is sandboxed; to read what a file shows, open it in a second instance of the same editor (as hwp-lab.spec does).
const pageText=(page,bytes,name)=>page.evaluate(async({bytes,name,RHWP})=>{
  const {createEditor}=await import('./'+RHWP+'sdk/index.js');
  const box=document.createElement('div');box.style.cssText='position:fixed;left:0;top:0;width:800px;height:600px;opacity:0;pointer-events:none';
  document.body.appendChild(box);
  try{
    const editor=await createEditor(box,{studioUrl:new URL('./'+RHWP+'studio/index.html',location.href).href});
    await editor.loadFile(new Uint8Array(bytes),name);
    const svg=new DOMParser().parseFromString(await editor.getPageSvg(0),'image/svg+xml');
    editor.destroy?.();
    return svg.documentElement.textContent.replace(/\s+/g,'');
  }finally{box.remove()}
},{bytes,name,RHWP});

function multipart(request){
  const type=request.headers()['content-type']||'',boundary=type.split('boundary=')[1],text=request.postDataBuffer().toString('latin1'),parts={};
  for(const chunk of text.split('--'+boundary).slice(1,-1)){
    const [head,...rest]=chunk.split('\r\n\r\n'),body=rest.join('\r\n\r\n').replace(/\r\n$/,'');
    const name=/name="([^"]+)"/.exec(head)?.[1],file=/filename="([^"]*)"/.exec(head)?.[1];
    parts[name]=file!==undefined?{file:Buffer.from(file,'latin1').toString('utf8'),bytes:[...Buffer.from(body,'latin1').subarray(0,4)]}:Buffer.from(body,'latin1').toString('utf8');
  }
  return parts;
}
async function fixture(page,width,{ai}={}){
  await page.setViewportSize({width,height:width<761?844:900});
  await servePagesCors(page);
  const sent={open:[],ai:[],library:[]},errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',request=>{const url=new URL(request.url());if(['http:','https:'].includes(url.protocol)&&url.origin!==testOrigin&&url.origin!==SB)external.push(request.url())});
  await openHome(page,{query:'?view=hwp'});
  for(const t of ['app_suborganizations','app_suborganization_assignees','app_spaces','app_record_links','app_meetings','app_notes'])await page.route(SB+'/rest/v1/'+t+'?**',r=>r.fulfill({json:[]}));
  await page.route(SB+'/rest/v1/app_documents?**',r=>r.fulfill({json:forms}));
  await page.route(SB+'/functions/v1/document-actions',route=>{
    const request=route.request();
    if(request.method()==='OPTIONS')return route.fulfill({status:200,headers:cors});
    const body=request.postDataJSON();sent.open.push(body);
    return route.fulfill({status:200,headers:{...cors,'content-type':'application/octet-stream','x-web2-hwp':encodeURIComponent(JSON.stringify({source:'library',file_name:'공문.hwp',format:'hwp',size:HWP.length,revision:'rev-1',md5:'a'.repeat(32),can_overwrite:true,shared:false}))},body:HWP});
  });
  await page.route(SB+'/functions/v1/ai-assist',route=>{
    const request=route.request();
    if(request.method()==='OPTIONS')return route.fulfill({status:200,headers:cors});
    sent.ai.push(request.postDataJSON());
    return ai?ai(route):route.fulfill({headers:cors,json:answer});
  });
  await page.route(SB+'/functions/v1/library-files',route=>{const body=multipart(route.request());sent.library.push(body);return route.fulfill({headers:cors,json:{ok:true,document:{id:'doc-new',title:body.title}}})});
  await expect(page.locator('#hwpView')).toBeVisible();
  await expect(page.locator('#hwpLabStatus')).toHaveText(/편집기가 준비됐습니다/,{timeout:60000});
  return {sent,errors,external};
}
// HWP-화면가득: 이름(문자열)으로 주면 HWP 편집 위 줄 메뉴 안의 버튼도 누른다(helpers/hwp-editor.mjs hwpPress).
const press=async(page,locator,width)=>{if(typeof locator==='string')return hwpPress(page,locator,{tap:width<761});await expect(locator).toBeVisible();if(width<761)await locator.tap();else await locator.click();};
const dialog=page=>page.locator('#hwpConvertModal');

for(const width of [390,1280])test(`paste a text, make it in the union form, check it in the editor, download and save to the library ${width}`,async({page},info)=>{
  const f=await fixture(page,width);
  await expect(page.locator('#hwpConvBar')).toBeHidden();
  await press(page,'hwpLabConvert',width);
  await expect(dialog(page)).toBeVisible();
  // Small window: three type chips, a text box, [취소][만들기] at the bottom right; [만들기] waits for a text.
  await expect(dialog(page).locator('[data-doc-type]')).toHaveText(['보고서','공문','회의자료']);
  await expect(dialog(page).locator('[data-doc-type="report"]')).toHaveAttribute('aria-pressed','true');
  await expect(dialog(page).locator('.hwp-convert-foot button')).toHaveText(['취소','만들기']);
  await expect(dialog(page).locator('[data-hwp-convert-make]')).toBeDisabled();
  const foot=await dialog(page).locator('.hwp-convert-foot').boundingBox(),card=await dialog(page).locator('.hwp-convert-card').boundingBox();
  expect(foot.x+foot.width).toBeGreaterThan(card.x+card.width-40);
  await page.screenshot({path:info.outputPath(`hwp-convert-dialog-${width}.png`)});
  await press(page,dialog(page).locator('[data-doc-type="letter"]'),width);
  await expect(dialog(page).locator('[data-doc-type="letter"]')).toHaveAttribute('aria-pressed','true');
  await dialog(page).locator('#hwpConvertText').fill(PASTED);
  await expect(dialog(page).locator('#hwpConvertCount')).toHaveText(/^\d+ \/ 20,000자$/);
  await press(page,dialog(page).locator('[data-hwp-convert-make]'),width);
  await expect(dialog(page)).toBeHidden({timeout:90000});
  // The server got the type and the pasted text only, and the form for 공문 was opened by its document ID.
  expect(f.sent.ai).toEqual([{kind:'hwp_convert',doc_type:'letter',text:PASTED.trim()}]);
  expect(f.sent.open).toEqual([{action:'hwp-open',document_id:'tpl-letter'}]);
  await expect(page.locator('#hwpLabStatus')).toHaveText(/^공문_\d{4}\.hwp · \d+쪽 · 5문단을 넣었어요\. 확인하고 고친 뒤 \[내려받기\] 또는 \[자료실에 저장\]을 누르세요\./,{timeout:60000});
  // Top line: the file name and, on the right, [내려받기] [자료실에 저장].
  if(width<1024){
    // 폰: 만든 문서 이름은 위 얇은 줄에, [내려받기]·[자료실에 저장]은 [저장 ▾] 안에.
    await expect(page.locator('#hwpConvBar')).toBeHidden();
    await expect(page.locator('#hwpLabName')).toHaveText(/^공문_\d{4}\.hwp$/);
    await openHwpMenu(page,'hwpConvDownload',{tap:true});
    await expect(page.locator('#hwpBarMenu button')).toHaveText(['내려받기','자료실에 저장']);
    await page.keyboard.press('Escape');
    await expect(page.locator('#hwpBarMenu')).toBeHidden();
  }else{
    await expect(page.locator('#hwpConvBar')).toBeVisible();
    await expect(page.locator('#hwpConvName')).toHaveText(/^공문_\d{4}\.hwp$/);
    await expect(page.locator('#hwpConvBar button')).toHaveText(['내려받기','자료실에 저장']);
  }
  await expect(page.locator('#hwpLabSave')).toBeHidden();
  await expect(page.locator('#hwpLabUpload')).toBeHidden();
  await page.screenshot({path:info.outputPath(`hwp-convert-done-${width}.png`)});

  const [file]=await Promise.all([page.waitForEvent('download'),press(page,'hwpConvDownload',width)]);
  expect(file.suggestedFilename()).toMatch(/^공문_\d{4}\.hwp$/);
  const bytes=[...readFileSync(await file.path())];
  expect(bytes.slice(0,4)).toEqual([0xd0,0xcf,0x11,0xe0]);
  // The downloaded file keeps the template's own sentence and carries the title and the numbered paragraphs after it.
  const text=await pageText(page,bytes,file.suggestedFilename());
  expect(text).toContain('HWP편집기시험문서');
  for(const part of ['가상안내','1.추진배경','1)가상회의진행.','2)가상협의완료.','*가상참고'])expect(text).toContain(part);
  expect(text.indexOf('1.추진배경')).toBeLessThan(text.indexOf('1)가상회의진행.'));
  expect(text.indexOf('1)가상회의진행.')).toBeLessThan(text.indexOf('2)가상협의완료.'));

  await press(page,'hwpConvLibrary',width);
  await expect(page.locator('#hwpLabStatus')).toHaveText('자료실에 새 문서로 저장했어요. 분류·사업영역은 자료실에서 정해 주세요.',{timeout:30000});
  expect(f.sent.library).toHaveLength(1);
  expect(Object.keys(f.sent.library[0]).sort()).toEqual(['file','title']);
  expect(f.sent.library[0].file.file).toMatch(/^공문_\d{4}\.hwp$/);
  expect(f.sent.library[0].file.bytes).toEqual([0xd0,0xcf,0x11,0xe0]);
  expect(f.sent.library[0].title).toBe('가상 안내');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(f.external).toEqual([]);
  expect(f.errors).toEqual([]);
});

test('an AI refusal keeps the window and the text, shows a plain message, and changes nothing in the editor; cancel closes and forgets the text',async({page})=>{
  const f=await fixture(page,1280,{ai:route=>route.fulfill({status:429,headers:cors,json:{ok:false,error:'daily_limit'}})});
  await page.locator('#hwpLabConvert').click();
  await dialog(page).locator('#hwpConvertText').fill(PASTED);
  await dialog(page).locator('[data-hwp-convert-make]').click();
  await expect(dialog(page).locator('#hwpConvertStatus')).toHaveText('오늘 AI를 쓸 수 있는 횟수를 다 썼어요. 내일 다시 시도해 주세요.',{timeout:60000});
  await expect(dialog(page).locator('#hwpConvertText')).toHaveValue(PASTED);
  await expect(dialog(page).locator('[data-hwp-convert-make]')).toBeEnabled();
  await expect(page.locator('#hwpConvBar')).toBeHidden();
  await dialog(page).locator('[data-hwp-convert-cancel]').click();
  await expect(dialog(page)).toBeHidden();
  await page.locator('#hwpLabConvert').click();
  await expect(dialog(page).locator('#hwpConvertText')).toHaveValue('');
  expect(f.sent.library).toEqual([]);
  expect(f.errors).toEqual([]);
});

test('a missing form for the type says what to register; no AI call is made',async({page})=>{
  const f=await fixture(page,1280);
  await page.route(SB+'/rest/v1/app_documents?**',r=>r.fulfill({json:[forms[0]]}));
  await page.locator('#hwpLabConvert').click();
  await dialog(page).locator('[data-doc-type="letter"]').click();
  await dialog(page).locator('#hwpConvertText').fill(PASTED);
  await dialog(page).locator('[data-hwp-convert-make]').click();
  await expect(dialog(page).locator('#hwpConvertStatus')).toContainText('공문 빈 양식 HWP가 없어요');
  expect(f.sent.ai).toEqual([]);
  expect(f.sent.open).toEqual([]);
});

test('a dropped text file fills the box; another file type is refused',async({page})=>{
  await fixture(page,1280);
  await page.locator('#hwpLabConvert').click();
  const drop=async(name,type,content)=>{
    const data=await page.evaluateHandle(({name,type,content})=>{const dt=new DataTransfer();dt.items.add(new File([content],name,{type}));return dt},{name,type,content});
    await dialog(page).locator('#hwpConvertText').dispatchEvent('drop',{dataTransfer:data});
  };
  await drop('메모.md','','# 가상 제목\n\n본문');
  await expect(dialog(page).locator('#hwpConvertText')).toHaveValue('# 가상 제목\n\n본문');
  await expect(dialog(page).locator('#hwpConvertStatus')).toHaveText('메모.md에서 글을 가져왔어요.');
  await drop('양식.hwp','application/x-hwp','x');
  await expect(dialog(page).locator('#hwpConvertStatus')).toContainText('글 파일(.md·.txt)만');
  await expect(dialog(page).locator('#hwpConvertText')).toHaveValue('# 가상 제목\n\n본문');
});
