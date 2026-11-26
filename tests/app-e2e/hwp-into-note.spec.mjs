import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {openHome} from './helpers/home-entry.mjs';
import {OPERATOR_MENU_LAYOUT} from '../org-order-fixture.mjs';
import {accountButton} from './helpers/shell-navigation.mjs';
import {chooseBasketKind} from './helpers/basket-kind.mjs';
import {servePagesCors} from './helpers/hwp-editor.mjs';
// S71-61 HWP-노트안으로(2026-11-26 사용자 결정 "노트 안에서만 열게 하자"):
// - [HWP 편집]은 메뉴가 아니다: PC 왼쪽 메뉴·폰 하단바·[메뉴] 창·메뉴 수정 목록 어디에도 없다. 저장된 메뉴 설정에 'hwp'가 있어도(운영자 저장값처럼) 깨지지 않는다.
// - 노트 화면 ⋯ [HWP 편집] → 기존 HWP 편집 화면. 위치 줄 '노트 › HWP 편집', 뒤로가기 = 노트.
// - 노트 ⋯ [이 노트를 HWP로] → 기존 [노조 서식으로 만들기] 글 칸에 그 노트 글(가짜 AI로 만들기까지).
// - 자료실 한글 [수정]은 그대로 HWP 편집을 연다(노트 안 화면).
// 서버(Supabase)는 모두 흉내 낸다. 시험 자료는 가짜 글뿐.
test.use({hasTouch:true});
test.setTimeout(150000);
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-10-06T01:00:00.123456+00:00';
const HWP=readFileSync(new URL('../fixtures/hwp-lab/sample.hwp',import.meta.url));
const cors={'access-control-allow-origin':'*','access-control-expose-headers':'X-Web2-Hwp'};
const NOTE_TEXT='가상 회의를 진행했습니다.\n가상 협의를 마쳤습니다.';
const note={id:'n-1',workspace_id:'w',kind:'note',title:'가상 안내',raw_text:NOTE_TEXT,occurred_at:stamp,created_at:stamp,updated_at:stamp,archived_at:null,ai_export_allowed:true,attachments:[],metadata:{}};
const forms=[{id:'tpl-report',workspace_id:'w',title:'노조 보고서 양식',file_name:'보고서.hwp',category:'노조 서식',created_at:stamp}];
const answer={ok:true,kind:'hwp_convert',doc_type:'report',title:'가상 안내',dropped:0,blocks:[{kind:'l1',text:'추진 배경'},{kind:'l2',text:'가상 회의 진행.'}]};

async function fixture(page,width){
  await page.setViewportSize({width,height:width<761?844:900});
  await servePagesCors(page);
  const sent={ai:[]},errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  // 운영자처럼 메뉴 순서를 저장해 둔 사람: 저장값에 'hwp'가 들어 있다(OPERATOR_MENU_LAYOUT).
  const home=await openHome(page);
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',r=>{
    const q=new URL(r.request().url()).searchParams;
    if(r.request().method()!=='GET')return r.fulfill({status:500,json:{}});
    if(q.get('metadata'))return r.fulfill({json:[]});
    return r.fulfill({json:(!q.get('id')||q.get('id')==='eq.n-1')&&(!q.get('kind')||q.get('kind')==='eq.note')?[note]:[]});
  });
  await page.route(SB+'/rest/v1/app_documents?**',r=>r.fulfill({json:forms}));
  await page.route(SB+'/functions/v1/document-actions',route=>{
    if(route.request().method()==='OPTIONS')return route.fulfill({status:200,headers:cors});
    return route.fulfill({status:200,headers:{...cors,'content-type':'application/octet-stream','x-web2-hwp':encodeURIComponent(JSON.stringify({source:'library',file_name:'보고서.hwp',format:'hwp',size:HWP.length,revision:'rev-1',md5:'a'.repeat(32),can_overwrite:false,shared:false}))},body:HWP});
  });
  await page.route(SB+'/functions/v1/ai-assist',route=>{
    if(route.request().method()==='OPTIONS')return route.fulfill({status:200,headers:cors});
    const body=route.request().postDataJSON();sent.ai.push(body);
    return body?.kind==='hwp_convert'?route.fulfill({headers:cors,json:answer}):route.fulfill({status:500,headers:cors,json:{ok:false,code:'internal_error'}});
  });
  return {...home,sent,errors};
}
const press=async(page,l,width)=>{await expect(l).toBeVisible();if(width<761)await l.tap();else await l.click();};
async function openNote(page){
  await chooseBasketKind(page,'note');
  await expect(page.locator('[data-note-row="n-1"]')).toBeVisible();
}
const where=page=>page.locator('[data-topline-where] li').allTextContents();

for(const width of [390,1280]){
  test(`S71-61 ${width}: 메뉴(왼쪽 메뉴·하단바·[메뉴] 창·메뉴 수정)에 HWP 편집이 없고, 저장된 메뉴 설정의 hwp는 건너뛴다`,async({page})=>{
    const f=await fixture(page,width);
    expect(OPERATOR_MENU_LAYOUT.rest).toContain('hwp');
    await expect(page.locator('#appView [data-view="hwp"]')).toHaveCount(0);
    await expect(page.locator('#mobileMenu [data-view="hwp"], .mobile-tabs [data-view="hwp"]')).toHaveCount(0);
    // 저장값의 다른 순서는 그대로(hwp 자리만 빠짐).
    const nav=await page.locator('#appView>.app-nav .nav-btn[data-view],#appView>.app-nav .nav-btn[data-basket-kind-nav]').evaluateAll(rows=>rows.map(r=>r.dataset.view||r.dataset.basketKindNav).filter(v=>v!=='home'));
    expect(nav.slice(0,10)).toEqual(['basket','calendar','meetings','team','note','library','files','brief','photos','outside']);
    await accountButton(page).click();
    const panel=page.locator(width<=760?'#mobileMenu':'#sidebarAccountPanel');
    await expect(panel).toBeVisible();
    if(width<=760)await expect(page.locator('#mobileMenu nav[aria-label="더 보기"]')).not.toContainText('HWP 편집');
    await panel.locator('[data-menu-edit-open]').click();
    await expect(page.locator('#menuEditModal')).toBeVisible();
    await expect(page.locator('#menuEditModal [data-reorder-id="brief"]')).toBeVisible();
    await expect(page.locator('#menuEditModal [data-reorder-id="hwp"]')).toHaveCount(0);
    await expect(page.locator('#menuEditModal')).not.toContainText('HWP 편집');
    expect(f.errors).toEqual([]);
  });

  test(`S71-61 ${width}: 노트 화면 ⋯ [HWP 편집] → HWP 편집(노트 › HWP 편집), 뒤로가기는 노트`,async({page})=>{
    const f=await fixture(page,width);
    await openNote(page);
    await press(page,page.locator('[data-note-folder-more]:visible'),width);
    const items=page.locator('#noteDocMenu:not([hidden]) button');
    await expect(items.last()).toHaveText('쓰는 법');
    await expect(items.nth(await items.count()-2)).toHaveText('HWP 편집');
    await press(page,page.locator('#noteDocMenu [data-nx-hwp]'),width);
    await expect(page.locator('#hwpView')).toBeVisible();
    expect(new URL(page.url()).searchParams.get('view')).toBe('hwp');
    if(width>760){
      await expect.poll(()=>where(page)).toEqual(['노트','HWP 편집']);
      // 그 화면에서 왼쪽 메뉴는 [노트] 칸이 켜진다(현재 쪽 표시는 아님).
      await expect(page.locator('#appView>.app-nav [data-basket-kind-nav="note"]')).toHaveClass(/active/);
    }
    await page.goBack();
    await expect(page.locator('#hwpView')).toBeHidden();
    await expect(page.locator('#basketView')).toHaveAttribute('data-kind','note');
    await expect(page.locator('[data-note-row="n-1"]')).toBeVisible();
    if(width>760){
      // 위치 줄의 [노트]로도 노트로 돌아간다.
      await page.goForward();
      await expect(page.locator('#hwpView')).toBeVisible();
      await page.locator('[data-topline-where] [data-topline-go="note"]').click();
      await expect(page.locator('#basketView')).toHaveAttribute('data-kind','note');
      await expect(page.locator('#hwpView')).toBeHidden();
    }
    expect(f.errors).toEqual([]);
  });

  test(`S71-61 ${width}: 노트 ⋯ [이 노트를 HWP로] → [노조 서식으로 만들기] 글 칸에 노트 글, 만들기(가짜 AI)까지`,async({page})=>{
    const f=await fixture(page,width);
    await openNote(page);
    await press(page,page.locator('[data-note-row-more="n-1"]'),width);
    await press(page,page.locator('#noteDocMenu [data-note-to-hwp]'),width);
    await expect(page.locator('#hwpView')).toBeVisible();
    const modal=page.locator('#hwpConvertModal');
    await expect(modal).toBeVisible({timeout:60000});
    await expect(modal.locator('#hwpConvertText')).toHaveValue(`가상 안내\n\n${NOTE_TEXT}`);
    await expect(page.locator('#hwpLabStatus')).toHaveText(/HWP 편집이 준비됐습니다/,{timeout:60000});
    await press(page,modal.locator('[data-hwp-convert-make]'),width);
    const made=()=>f.sent.ai.filter(b=>b?.kind==='hwp_convert');
    await expect.poll(()=>made().length,{timeout:30000}).toBe(1);
    expect(made()[0]).toMatchObject({kind:'hwp_convert',doc_type:'report',text:`가상 안내\n\n${NOTE_TEXT}`});
    await expect(modal).toBeHidden({timeout:60000});
    // 노트는 바뀌지 않는다(쓰기 요청 없음 — 위 흉내 서버는 GET 말고는 500).
    expect(f.errors).toEqual([]);
  });
}

test('S71-61 1280: 열린 노트 ⋯에도 [이 노트를 HWP로], 글이 없는 노트는 알림만',async({page})=>{
  await fixture(page,1280);
  note.raw_text='';note.title='노트';
  try{
    await openNote(page);
    await page.locator('[data-note-row="n-1"]').click();
    await page.locator('[data-note-detail] [data-note-more]').click();
    await page.locator('#noteDocMenu [data-note-to-hwp]').click();
    await expect(page.locator('#toast')).toContainText('글이 없는 노트예요.');
    await expect(page.locator('#hwpView')).toBeHidden();
  }finally{note.raw_text=NOTE_TEXT;note.title='가상 안내'}
});
