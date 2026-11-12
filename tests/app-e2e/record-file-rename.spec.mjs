import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
// ORG-기록첨부이름반영(S60-14): 조직 기록 줄 아래 사진·파일에서 바로 이름 고치기(공용 file-rename.js), 고치면 자동 줄 글('그림 1장 · 이름')도
// 요약 쓰기 한 길(app_basket_update_link_summary, 같은지 확인 뒤 씀)로 새 이름 — 창을 다시 열지 않아도 그 자리에서 바뀐다.
// 사람이 쓴 줄 글은 그대로. ✎는 이름과 떨어진 테두리 없는 흐린 연필. 자료는 모두 가짜.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAPAAAAC0CAIAAAAl/ja/AAACVUlEQVR4Xu3csU3DABRFUYIQEzAA4zBBakajZgImSY1SewKqiAVi5OjH4uqcHiJLV9Zvng+n8/IAFY+VB4FfgiZF0KQImhRBkyJoUgRNiqBJETQpgiZF0KQImhRBkyJoUgRNiqBJETQpgiZF0KQImhRBkyJoUgRNiqBJETQpgiZF0KQImhRBk/I09zSvL89z/5z/7nv5mXgEb2hSBE2KoEkRNCmCJkXQpAiaFEGTImhSBE2KoEkRNCmCJkXQpAiaFEGTImhSBE2KoEkRNCmCJkXQpAialMHvctzi4/Prlj/nPt6Pb/f5ob/zhiZF0KQImpTD6bwMPZBv23GFb9vBOicHKYImRdCkCJoUQZMiaFIETYqgSRE0KYImRdCkCJoUixW2s1iBWU4OUgRNisUK+7BYgXVODlIETYqgSRE0KYImRdCkCJoUQZMiaFIETYqgSRE0KRYrbGexArOcHKQImhSLFfZhsQLrnBykCJoUQZMiaFIETYqgSRE0KYImRdCkCJoUQZMiaFIsVtjOYgVmOTlIETQpFivsw2IF1jk5SBE0KYImRdCkCJoUQZMiaFIETYqgSRE0KYImRdCkWKywncUKzHJykCJoUixW2IfFCqxzcpAiaFIETYqgSRE0KYImRdCkCJoUQZMiaFIETYqgSRE0KYImRdCkCJoUQZMiaFIETcrgh2aGVpBwhTc0KYImRdCkCJoUQZMiaFIETYqgSRE0KYImRdCkCJoUQZMiaFIETYqgSRE0KYImRdCkCJoUQZMiaFIETYqgSRE0KYImRdCkCJqUC4j6NQ80dYyPAAAAAElFTkSuQmCC','base64');
const OLD='photo_2026-11-11_15-28-09.jpg';
const N1='22222222-0000-4000-8000-000000000001',N2='22222222-0000-4000-8000-000000000002';

async function fixture(page,width){
 await page.setViewportSize({width,height:width>900?800:915});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const home=await openHome(page),s={renames:[],rpc:[],syncReads:0};
 const notes={
  [N1]:{id:N1,workspace_id:'w',occurred_at:'2026-11-11T06:28:00Z',raw_text:'',kind:'basket',title:null,attachments:[{drive_file_id:'drvP',file_name:OLD,mime_type:'image/jpeg',size_bytes:6}]},
  [N2]:{id:N2,workspace_id:'w',occurred_at:'2026-11-10T02:00:00Z',raw_text:'합성 안내문 정리',kind:'basket',title:null,attachments:[{drive_file_id:'drvF',file_name:'scan_0001.pdf',mime_type:'application/pdf',size_bytes:6}]},
 };
 s.links=[
  {id:'11111111-0000-4000-8000-000000000001',workspace_id:'w',summary:'그림 1장 · '+OLD,note_id:N1,organization_id:'o',project_id:null,status:'confirmed'},
  {id:'11111111-0000-4000-8000-000000000002',workspace_id:'w',summary:'직접 쓴 합성 기록',note_id:N2,organization_id:'o',project_id:null,status:'confirmed'},
 ];
 const rows=()=>s.links.map(l=>({...l,note:structuredClone(notes[l.note_id])}));
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_record_links',r=>{if(r.request().method()!=='GET')return r.fallback();const q=new URL(r.request().url()).searchParams;if(q.get('note_id')?.startsWith('in.(')){s.syncReads++;const ids=q.get('note_id').slice(4,-1).split(',');return r.fulfill({json:rows().filter(x=>ids.includes(x.note_id)&&x.summary!=null)})}return r.fulfill({json:rows()})});
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/rpc/app_basket_update_link_summary',r=>{const b=r.request().postDataJSON();s.rpc.push(b);const l=s.links.find(x=>x.id===b.p_link_id);if(!l||l.summary!==b.p_expected_summary)return r.fulfill({json:{ok:false,error:'SUMMARY_CHANGED'}});l.summary=b.p_summary;return r.fulfill({json:{ok:true}})});
 await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/document-actions',r=>{const b=r.request().postDataJSON();if(b?.action!=='rename-file')return r.fallback();s.renames.push(b);const n=Object.values(notes).find(x=>x.id===b.id);const a=n.attachments.find(x=>x.drive_file_id===b.drive_file_id);const name=b.base+(a.file_name.match(/\.[^.]+$/)||[''])[0];a.file_name=name;return r.fulfill({json:{ok:true,drive_file_id:b.drive_file_id,name,unchanged:false,notes:[{id:n.id,updated_at:'2026-11-12T03:00:00Z'}],updated:{notes:1,tasks:0,documents:1}}})});
 await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/basket-files',r=>r.request().method()==='GET'?r.fulfill({status:200,contentType:'image/png',body:PNG}):r.fallback());
 await clickView(page,'team');await page.locator('[data-so-org="o"]').first().click();
 await expect(page.locator('#wdModal')).toBeVisible();
 return {...home,errors,s,row:n=>page.locator(`#wdUpdates [data-basket-link="11111111-0000-4000-8000-00000000000${n}"]`)};
}
const shot=async(page,name)=>{if(process.env.S60_14_SHOTS)await page.screenshot({path:`docs/design/screens/s60-14/${name}.png`})};

for(const width of [412,1280]){
 test(`사진 ⋯ [이름 수정]으로 바꾸면 기록 줄 글·띠가 그 자리에서 새 이름 ${width}`,async({page})=>{
  const f=await fixture(page,width),row=f.row(1);
  await expect(row.locator('[data-link-summary-text]')).toHaveText('그림 1장 · '+OLD);
  await row.locator('[data-record-photos] > summary').click();
  const tile=row.locator('[data-photo-tile="drvP"]');
  await expect(tile.locator('.record-file-thumb')).toBeVisible();
  await shot(page,`before-${width}`);
  await tile.locator('.record-photo-more > summary').click();
  await expect(tile.locator('.record-photo-panel')).toBeVisible();
  await shot(page,`menu-${width}`);
  await tile.locator('[data-fr-menu-edit]').click();
  const input=row.locator('.fr-input');
  await expect(input).toHaveValue('photo_2026-11-11_15-28-09');
  await expect(row.locator('[data-fr-ai]')).toBeVisible(); // [AI 이름] 그대로
  await input.fill('합성노조 2026 임협 찬반투표 결과');
  await shot(page,`editing-${width}`);
  await row.locator('[data-fr-save]').click();
  const NEW='합성노조 2026 임협 찬반투표 결과.jpg';
  await expect(f.row(1).locator('[data-link-summary-text]')).toHaveText('그림 1장 · '+NEW);
  expect(f.s.renames).toEqual([{action:'rename-file',target:'note',id:N1,drive_file_id:'drvP',base:'합성노조 2026 임협 찬반투표 결과'}]);
  expect(f.s.rpc).toEqual([{p_link_id:'11111111-0000-4000-8000-000000000001',p_expected_summary:'그림 1장 · '+OLD,p_summary:'그림 1장 · '+NEW}]);
  // 띠: [사진 1]은 펼친 채, 사진 이름도 새 이름. 사람이 쓴 다른 줄 글은 그대로.
  await expect(f.row(1).locator('details[data-record-photos]')).toHaveAttribute('open','');
  await expect(f.row(1).locator('[data-record-photo="drvP"]')).toHaveAttribute('title',NEW);
  await expect(f.row(2).locator('[data-link-summary-text]')).toHaveText('직접 쓴 합성 기록');
  await shot(page,`after-${width}`);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(f.errors).toEqual([]);
 });
}

test('파일 줄 ✎로 바꾸면 띠 이름만 새 이름, 사람이 쓴 줄 글은 그대로(요약 쓰기 없음) · ✎는 이름과 떨어진 테두리 없는 흐린 연필',async({page})=>{
 const f=await fixture(page,1280),row=f.row(2);
 const name=row.locator('[data-record-file="drvF"]'),pen=row.locator('.record-file .fr-edit');
 await expect(name).toContainText('scan_0001.pdf');
 const [a,b]=[await name.boundingBox(),await pen.boundingBox()];
 expect(b.x-(a.x+a.width)).toBeGreaterThanOrEqual(5);
 const look=await pen.evaluate(el=>{const c=getComputedStyle(el);return {border:c.borderTopWidth==='0px'||c.borderTopColor==='rgba(0, 0, 0, 0)',opacity:+c.opacity}});
 expect(look.border).toBe(true);expect(look.opacity).toBeLessThan(1);
 await pen.click();
 await row.locator('.fr-input').fill('합성 안내문 스캔');
 await row.locator('.fr-input').press('Enter');
 await expect(f.row(2).locator('[data-record-file="drvF"] .record-file-text')).toHaveText('합성 안내문 스캔.pdf');
 await expect.poll(()=>f.s.syncReads).toBe(1);
 expect(f.s.rpc).toEqual([]);
 await expect(f.row(2).locator('[data-link-summary-text]')).toHaveText('직접 쓴 합성 기록');
 expect(f.errors).toEqual([]);
});

test('PC 우클릭·폰 꾹 누르기로 사진 칸 ⋯ 메뉴([이름 수정])가 열린다',async({page})=>{
 const f=await fixture(page,1280),row=f.row(1);
 await row.locator('[data-record-photos] > summary').click();
 const thumb=row.locator('[data-photo-tile="drvP"] .record-file-thumb');
 await expect(thumb).toBeVisible();
 await thumb.click({button:'right'});
 await expect(row.locator('[data-photo-tile="drvP"] .record-photo-panel [data-fr-menu-edit]')).toBeVisible();
 await page.keyboard.press('Escape');
 await page.setViewportSize({width:412,height:915});
 await row.locator('[data-photo-tile="drvP"] details').evaluate(d=>d.removeAttribute('open'));
 await thumb.evaluate(el=>{const r=el.getBoundingClientRect();el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.x+10,clientY:r.y+10}))});
 await expect(row.locator('[data-photo-tile="drvP"] .record-photo-panel [data-fr-menu-edit]')).toBeVisible();
 expect(f.errors).toEqual([]);
});
