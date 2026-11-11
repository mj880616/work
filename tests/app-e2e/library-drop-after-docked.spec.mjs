import {test,expect} from '@playwright/test';
import {bootLibrary,libFolder} from './helpers/library-folder-server.mjs';
import {openFirstMeetingResult} from './helpers/meeting-open.mjs';
// ★LIB-바깥파일놓기안됨(요청함 11/09 18:08): PC에서 사업 보고 결과(칸에 붙은 회의 창)를 본 뒤 자료실로 오면 바탕화면 파일을 놓아도 🚫였다.
// 칸에 붙은 창(role=region, 사업 보고·사업영역·담당조직·할 일)은 떠 있는 창이 아니다 — 자료실 놓기는 진짜 떠 있는 창이 있을 때만 쉰다.
// 가짜 서버만(실제 Supabase·Drive 없음), 이름은 지어낸 것.
const FOLDERS=[libFolder('fa',null,{name:'가상 A',sort_order:1024})];
const ITEMS=[{document_id:'n-1',folder_id:'fa'}];
const go=async(page,view)=>{await page.locator(`.app-nav [data-view="${view}"]`).first().click();await expect.poll(()=>page.evaluate(()=>window.KPTURouter?.current)).toBe(view)};
// 파일을 실은 끌기를 그 자리에 보낸다(dragenter → dragover → drop). 놓기 직전의 허락·안내를 돌려준다.
const dropAt=(page,sel,names)=>page.evaluate(({sel,names})=>{
  const el=document.querySelector(sel),r=el.getBoundingClientRect(),dt=new DataTransfer();
  for(const name of names)dt.items.add(new File(['PK synthetic'],name,{type:'application/octet-stream'}));
  const fire=type=>{const ev=new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:dt,clientX:r.left+r.width/2,clientY:r.top+Math.min(r.height/2,40)});el.dispatchEvent(ev);return ev};
  fire('dragenter');const over=fire('dragover'),overlay=document.querySelector('#libraryDropOverlay');
  const out={allowed:over.defaultPrevented,shown:!!overlay&&!overlay.hidden,hint:overlay?.textContent||''};
  fire('drop');return out;
},{sel,names});

for(const width of [1440,884])test(`자료실 ${width}: 사업 보고 결과 칸을 본 뒤 자료실에 와도 바깥 파일이 올라간다`,async({page})=>{
  test.setTimeout(90000);
  const {s,errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,group:'폴더'});
  await go(page,'meetings');
  await openFirstMeetingResult(page);
  // 사업 보고 결과는 세 번째 칸에 붙은 창(떠 있는 창 아님)으로 남는다.
  await expect(page.locator('#meetingList #meetingRoundDetailModal.mrd-docked')).toHaveAttribute('role','region');
  await go(page,'library');
  await expect(page.locator('#documentList')).toBeVisible();
  // 사업 보고 결과 칸은 그대로 남아 있다(다른 화면 안에 숨어서).
  await expect(page.locator('#meetingRoundDetailModal.mrd-docked:not(.hidden)')).toHaveCount(1);
  let r=await dropAt(page,'#documentList',['a.pdf']);
  expect(r).toMatchObject({allowed:true,shown:true,hint:'놓으면 바로 올려요'});
  await expect(page.locator('#uploadDock:not([hidden]) .up-dock-text')).toHaveText('1개 올렸어요');
  expect(s.uploads.length).toBe(1);
  // 폴더 줄 위에 놓으면 그 폴더로.
  const row=await page.locator('#libraryFolderNav [data-lu-nav="fa"]').count()?'#libraryFolderNav [data-lu-nav="fa"]':'#documentList details[data-lu-node="f:fa"] > summary';
  r=await dropAt(page,row,['b.pdf']);
  expect(r).toMatchObject({allowed:true,hint:'놓으면 ‘가상 A’ 폴더로 올려요'});
  await expect(page.locator('#uploadDock:not([hidden]) .up-dock-text')).toHaveText('가상 A에 1개 올렸어요');
  expect(s.uploads.length).toBe(2);
  expect(errors).toEqual([]);
});

test('자료실 1440: 진짜 떠 있는 창이 있으면 화면 놓기는 쉬고 그 창이 먼저다',async({page})=>{
  test.setTimeout(90000);
  const {s,errors}=await bootLibrary(page,1440,{folders:FOLDERS,items:ITEMS,group:'폴더'});
  await expect(page.locator('#documentList')).toBeVisible();
  // 떠 있는 창 하나(시험용으로 문서에 붙인 보통 창: .modal, role=dialog).
  await page.evaluate(()=>{const m=document.createElement('div');m.id='qaFloatModal';m.className='modal';m.setAttribute('role','dialog');m.setAttribute('aria-modal','true');m.innerHTML='<div class="modal-card">가상 창</div>';document.body.append(m)});
  const r=await dropAt(page,'#documentList',['c.pdf']);
  expect(r).toMatchObject({allowed:false,shown:false});
  expect(s.uploads.length).toBe(0);
  await page.evaluate(()=>document.querySelector('#qaFloatModal').classList.add('hidden'));
  const again=await dropAt(page,'#documentList',['d.pdf']);
  expect(again).toMatchObject({allowed:true,shown:true});
  await expect(page.locator('#uploadDock:not([hidden]) .up-dock-text')).toHaveText('1개 올렸어요');
  expect(errors).toEqual([]);
});
