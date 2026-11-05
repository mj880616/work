// FAMILY-잊지말기 4단계(설계 docs/design/tg-personal.md 5·6절, 명진 결정 11/05 시안 A): 홈 [하루]의 '잊지 말기' 작은 칸.
// - 운영자 기능 family가 있을 때만 보인다. 제안마다 [할 일로]·[일정으로]·[기억만]·[×], 같은 칸에서 [기억] 세 묶음.
// - 누르기 전에는 아무것도 만들지 않는다([할 일로]는 할 일 창에 제목만 채움, 저장해야 상태가 바뀜). [×]는 5초 되돌리기.
// - 상태 칸(status·decided_at·updated_at, done_at)만 고친다. 서버는 흉내, 글은 모두 지어낸 것.
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const id=n=>`f0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const NOTES=()=>[
  {id:id(1),kind:'plan',body:'토요일 저녁에 동네 산책 가자고 함',said_when:'토요일 저녁',firmness:'planned',origin:'telegram',origin_day:'2026-10-05',drive_url:null,status:'new',done_at:null,created_at:'2026-10-06T00:10:00Z'},
  {id:id(2),kind:'like',body:'<b>새로 생긴 빵집</b> 소금빵이 맛있었다고 함',said_when:null,firmness:'firm',origin:'call',origin_day:'2026-10-05',drive_url:'https://drive.google.com/file/d/fake1/view',status:'new',done_at:null,created_at:'2026-10-06T00:05:00Z'},
  {id:id(3),kind:'ask',body:'퇴근길에 우유 사 와 달라고 함',said_when:null,firmness:'firm',origin:'telegram',origin_day:'2026-10-04',drive_url:null,status:'kept',done_at:null,created_at:'2026-10-05T00:05:00Z'},
  {id:id(4),kind:'remind',body:'주말에 화분 물 주기',said_when:'주말',firmness:'firm',origin:'telegram',origin_day:'2026-10-03',drive_url:null,status:'kept',done_at:'2026-10-05T03:00:00Z',created_at:'2026-10-04T00:05:00Z'},
];

async function fixture(page,{features=['calls','telegram','family'],notes=NOTES(),width=390}={}){
  await page.setViewportSize({width,height:860});
  const patches=[],reads=[];
  await openHome(page,{beforeLoad:async()=>{
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/rpc/app_my_features',r=>r.fulfill({json:features}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_family_notes',async r=>{
      const req=r.request(),q=new URL(req.url()).searchParams;
      if(req.method()==='PATCH'){
        const nid=q.get('id').replace(/^eq\./,''),body=req.postDataJSON();patches.push({id:nid,body});
        const row=notes.find(n=>n.id===nid);Object.assign(row,body);return r.fulfill({json:[{id:nid}]});
      }
      reads.push(Object.fromEntries(q));
      return r.fulfill({json:notes.filter(n=>n.status!=='dismissed')});
    });
  }});
  await expect(page.locator('#homeView [data-home-summary]')).toBeVisible();
  return {patches,reads,notes};
}
const box=page=>page.locator('#homeView [data-home-family]');

test('운영자 기능 family가 없으면 칸도 표 읽기도 없다',async({page})=>{
  const {reads}=await fixture(page,{features:['calls','telegram']});
  await page.waitForTimeout(300);
  await expect(box(page)).toBeHidden();
  expect(reads).toEqual([]);
});

test('제안 칸: 접힌 한 줄에 새 제안 수, 펼치면 머리표·한 줄·말한 때, 글은 글자로만',async({page})=>{
  const {reads}=await fixture(page);
  await expect(box(page)).toBeVisible();
  await expect(box(page).locator('summary').first()).toHaveText('잊지 말기 2');
  expect(reads[0]).toMatchObject({status:'neq.dismissed',select:'id,kind,body,said_when,firmness,origin,origin_day,drive_url,status,done_at,created_at'});
  await box(page).locator('summary').first().click();
  const first=box(page).locator(`[data-family-note="${id(1)}"]`);
  await expect(first).toContainText('예정');await expect(first).toContainText('토요일 저녁에 동네 산책 가자고 함');
  await expect(first).toContainText('말한 때: 토요일 저녁 · 텔레그램 · 10/5');
  await expect(box(page).locator(`[data-family-note="${id(2)}"] b`)).toHaveCount(0);
  await expect(box(page).locator(`[data-family-note="${id(2)}"]`)).toContainText('<b>새로 생긴 빵집</b>');
  // 폰 폭에서 버튼 넷이 한 줄 안팎, 가로 넘침 없음.
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('[기억만]·[×](5초 되돌리기): 상태 칸만 고친다',async({page})=>{
  const {patches}=await fixture(page);
  await box(page).locator('summary').first().click();
  await box(page).locator(`[data-family-note="${id(2)}"] [data-family-act="kept"]`).click();
  await expect.poll(()=>patches.length).toBe(1);
  expect(Object.keys(patches[0].body).sort()).toEqual(['decided_at','status','updated_at']);
  expect(patches[0]).toMatchObject({id:id(2),body:{status:'kept'}});
  await box(page).locator(`[data-family-note="${id(1)}"] [data-family-act="dismissed"]`).click();
  await expect.poll(()=>patches.length).toBe(2);
  expect(patches[1]).toMatchObject({id:id(1),body:{status:'dismissed'}});
  await expect(box(page).locator(`[data-family-note="${id(1)}"]`)).toHaveCount(0);
  await box(page).locator('[data-family-undo]').click();
  await expect.poll(()=>patches.length).toBe(3);
  expect(patches[2]).toMatchObject({id:id(1),body:{status:'new',decided_at:null}});
  await expect(box(page).locator(`[data-family-note="${id(1)}"]`)).toBeVisible();
});

test('[할 일로]: 할 일 창에 제목만 채워 열고, 저장 전에는 상태를 바꾸지 않는다',async({page})=>{
  const {patches}=await fixture(page,{width:1280});
  await box(page).locator('summary').first().click();
  await box(page).locator(`[data-family-note="${id(1)}"] [data-family-act="task"]`).click();
  await expect(page.locator('#gtTaskModal')).toBeVisible();
  await expect(page.locator('#gtEditTitle')).toHaveValue('토요일 저녁에 동네 산책 가자고 함');
  await expect(page.locator('#gtEditNotes')).toHaveValue('말한 때: 토요일 저녁');
  await page.waitForTimeout(200);
  expect(patches).toEqual([]);
});

test('[기억] 세 묶음: 하자고 한 것은 동그라미로 했음 표시, 한 것은 접힘',async({page})=>{
  const {patches}=await fixture(page);
  await box(page).locator('summary').first().click();
  await box(page).locator('[data-family-tab="memory"]').click();
  await expect(box(page).locator('[data-family-group="todo"] h5')).toHaveText('하자고 한 것 · 부탁');
  await expect(box(page).locator('[data-family-group="todo"] .home-family-done summary')).toHaveText('한 것 1');
  await box(page).locator(`[data-family-done="${id(3)}"]`).click();
  await expect.poll(()=>patches.length).toBe(1);
  expect(Object.keys(patches[0].body).sort()).toEqual(['done_at','updated_at']);
  expect(patches[0].id).toBe(id(3));
});
