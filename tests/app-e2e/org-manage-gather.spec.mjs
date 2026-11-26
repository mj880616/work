import { appOrigin } from './helpers/test-origin.mjs';
import {test,expect} from '@playwright/test';
// S71-35 ORG-조직관리로모으기(2026-11-26 사용자 "관련 대상 현황 이것도 걍 없애 / 조직관리에서 추가수정 삭제 보관 가능하게",
// "내 묶음도 여기서 삭제 조직 관리에서 처리 가능하게"):
// - 머리줄: [W] 조직 관리 · 찾기 · ⋯ — [+ 담당조직] 없음. ⋯ 맨 위 '새 담당조직' ─ 부서·노조 묶음 만들기 ─ 그다음 원래 항목.
// - 보관(옛 '담당 조직에서 제외', 같은 값 org_order.hidden): 상세 ⋯·폰 줄 밀기 → 목록 맨 아래 접힌 '보관한 조직 n곳' → 줄 [꺼내기].
// - 내 묶음(옛 내 프로필 칸): 목록 아래('연락 없는 조직' 줄 앞) 접힌 '내 묶음 n'. 만들기는 ⋯ 안, 초대 링크(?join=)로 오면 그 칸이 펼쳐진다. 서버 함수는 그대로(가짜 서버).
// 내 프로필에 두 칸이 없는 것은 profile-workplaces.spec.mjs가 본다. 이름은 모두 합성 값.
const base=`${appOrigin}/tests/app-e2e/suborganization-filters-canonical-fixture.html`;
const menuLabels=page=>page.locator('#soTeamMenu button').allTextContents().then(xs=>xs.map(x=>x.trim()));
const rowOf=(page,name)=>page.locator('#soOrganizationList .so-row').filter({has:page.locator('.kptu-list-name',{hasText:new RegExp(`^${name}$`)})});
// ?orgs=order 시험 자료의 조직은 id로 가리킨다(이름은 시험 자료 파일 한 곳에만 — 화면에서 읽어 비교).
const ARCH='ord-14',FIRST='ord-0',SECOND='ord-1';
const rowById=(page,id)=>page.locator(`#soOrganizationList [data-so-row="${id}"]`);
const nameById=(page,id)=>page.locator(`#soOrganizationList [data-so-org="${id}"] .kptu-list-name`).textContent();
const hidden=page=>page.evaluate(()=>window.__orgOrderPrefs.org_order.hidden);
async function openScreenMenu(page){await page.locator('#soTeamMore').click();const menu=page.locator('#soTeamMenu');await expect(menu).toBeVisible();return menu}
async function swipe(row,dx){
 await row.evaluate((el,dx)=>{const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
  const fire=(type,cx)=>el.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:9,pointerType:'touch',isPrimary:true,clientX:cx,clientY:y}));
  fire('pointerdown',x);for(let i=1;i<=12;i++)fire('pointermove',x+dx*i/12);fire('pointerup',x+dx);},dx);
}
const tap=async l=>{await l.dispatchEvent('pointerdown',{pointerType:'touch',isPrimary:true,bubbles:true});await l.dispatchEvent('click')};

for(const width of [390,1280])test(`머리줄에 [+ 담당조직] 없음 · ⋯ 맨 위 '새 담당조직'으로 추가 · 구분선 뒤 부서·노조 묶음 만들기 ${width}px`,async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width,height:860});await page.goto(base+'?orgs=none&collab');
 await expect(page.locator('#soTeamMore')).toBeVisible();
 await expect(page.locator('#soAddOrg,.so-team-add,#soAddOrgLink')).toHaveCount(0);
 await expect(page.locator('#soTeamTools button')).toHaveCount(1);
 const menu=await openScreenMenu(page);
 const labels=await menuLabels(page);
 expect(labels.slice(0,4)).toEqual(['새 담당조직','부서 묶음 만들기','노조 묶음 만들기','묶음 만들기']);
 // 구분선: '새 담당조직' ─ 묶음 만들기 둘 ─ 원래 항목
 const order=await menu.evaluate(m=>[...m.querySelectorAll('button,hr')].slice(0,6).map(x=>x.tagName==='HR'?'|':x.textContent.trim()));
 expect(order).toEqual(['새 담당조직','|','부서 묶음 만들기','노조 묶음 만들기','|','묶음 만들기']);
 await menu.getByRole('button',{name:'새 담당조직'}).click();
 await expect(page.locator('#soEditModal')).toBeVisible();await expect(page.locator('#soEditHeading')).toHaveText('담당조직 추가');
 await page.locator('#soEditName').fill('가상새지부');await page.locator('#soSaveOrg').click();await expect(page.locator('#soEditModal')).toBeHidden();
 await expect(rowOf(page,'가상새지부')).toHaveCount(1);
 expect(await page.evaluate(()=>window.__orgPosts.length)).toBe(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 expect(errors).toEqual([]);
});

for(const width of [412,1280])test(`보관한 조직은 맨 아래 접힌 '보관한 조직 n곳' → 펼쳐 [꺼내기] · 상세 ⋯ [보관]·[꺼내기] · 값은 org_order.hidden 그대로 ${width}px`,async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width,height:900});await page.goto(base+'?orgs=order');
 const fold=page.locator('#soOrganizationList details.so-archived');
 await expect(fold).toHaveCount(1);await expect(fold).not.toHaveAttribute('open','');
 await expect(fold.locator('summary')).toHaveText('보관한 조직1곳');
 const arch=await nameById(page,ARCH);
 await expect(rowById(page,ARCH).locator('[data-so-org]')).toBeHidden();
 await fold.locator('summary').click();await expect(fold).toHaveAttribute('open','');
 const out=rowById(page,ARCH).getByRole('button',{name:`${arch} 꺼내기`});await expect(out).toBeVisible();await expect(out).toHaveText('꺼내기');
 await out.click();
 await expect(page.locator('#soOrganizationList details.so-archived')).toHaveCount(0);
 await expect(rowById(page,ARCH)).not.toHaveClass(/is-excluded/);
 expect(await page.evaluate(()=>window.__orgOrderPrefs.org_order.hidden)).toEqual([]);
 await expect(page.locator('#toast')).toContainText('꺼냈어요');
 // 상세 ⋯ [보관] → 다시 접힌 묶음 안으로(펼침은 기억: 사람이 펼쳐 둔 채)
 await rowById(page,ARCH).locator('[data-so-org]').click();
 const more=page.locator('#wdOrgMore');await expect(more).toBeVisible();await more.click();await expect(page.locator('#soTeamMenu')).toBeVisible();
 expect(await menuLabels(page)).toEqual(['이름 바꾸기','보관','삭제']);
 await page.locator('#soTeamMenu').getByRole('button',{name:'보관',exact:true}).click();
 expect(await hidden(page)).toEqual([arch]);
 await expect(page.locator('#soOrganizationList details.so-archived summary')).toHaveText('보관한 조직1곳');
 await expect(page.locator('#toast')).toContainText('보관했어요');
 expect(errors).toEqual([]);
});

test('폰 390 줄 밀기: 왼쪽 [보관][이름 바꾸기][삭제](밀기만으로는 저장 없음), [보관]을 눌러야 보관 · 보관한 줄은 [꺼내기] · 오른쪽 밀기 = 여러 개 선택',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:390,height:860});await page.goto(base+'?orgs=order');
 const row=rowById(page,FIRST).locator('[data-so-org]'),ends=page.locator('#soOrganizationList [data-row-swipe-act="end"]');
 await expect(row).toBeVisible();
 const arch=await nameById(page,ARCH),first=await nameById(page,FIRST);
 await expect(async()=>{await swipe(row,-430);await expect(ends.first()).toBeVisible({timeout:1000})}).toPass({timeout:10000});
 await expect(ends.locator('.row-swipe-tx')).toHaveText(['보관','이름 바꾸기','삭제']);
 await page.waitForTimeout(400);expect(await hidden(page)).toEqual([arch]);
 await tap(page.locator('#soOrganizationList [data-row-swipe-key="archive"]'));
 await expect.poll(()=>hidden(page)).toEqual([arch,first]);
 const fold=page.locator('#soOrganizationList details.so-archived');await expect(fold.locator('summary')).toHaveText('보관한 조직2곳');
 await fold.locator('summary').click();
 const out=rowById(page,FIRST).locator('[data-so-org]');await expect(out).toBeVisible();
 await expect(async()=>{await swipe(out,-430);await expect(ends.first()).toBeVisible({timeout:1000})}).toPass({timeout:10000});
 await expect(ends.locator('.row-swipe-tx')).toHaveText(['꺼내기','이름 바꾸기','삭제']);
 await tap(page.locator('#soOrganizationList [data-row-swipe-key="restore"]'));
 await expect.poll(()=>hidden(page)).toEqual([arch]);
 // [이름 바꾸기] = 상세 ⋯ [이름 바꾸기]와 같은 창
 const r2=rowById(page,SECOND).locator('[data-so-org]'),second=await nameById(page,SECOND);
 await expect(async()=>{await swipe(r2,-430);await expect(ends.first()).toBeVisible({timeout:1000})}).toPass({timeout:10000});
 await tap(page.locator('#soOrganizationList [data-row-swipe-key="rename"]'));
 await expect(page.locator('#soEditHeading')).toHaveText('이름 바꾸기');await expect(page.locator('#soEditName')).toHaveValue(second);
 await page.locator('[data-so-close="soEditModal"]').click();await expect(page.locator('#soEditModal')).toBeHidden();
 // 오른쪽 밀기 = 이 화면의 '여러 개 선택해 삭제'를 그 줄로 연다(선택만, 서버 쓰기 없음)
 await expect(async()=>{await swipe(r2,200);await expect(page.locator('#soOrganizationList .so-pick-bar')).toBeVisible({timeout:1000})}).toPass({timeout:10000});
 await expect(page.locator('#soOrganizationList [data-so-pick="ord-1"]')).toBeChecked();
 expect(await page.evaluate(()=>window.__orgDeletes)).toEqual([]);
 expect(errors).toEqual([]);
});

test('밀기 [삭제]는 지금 [삭제]와 같은 길(휴지통 + 확인 그대로)',async({page})=>{
 await page.setViewportSize({width:390,height:860});await page.goto(base+'?orgs=order');
 const row=rowById(page,FIRST).locator('[data-so-org]'),ends=page.locator('#soOrganizationList [data-row-swipe-act="end"]');
 await expect(async()=>{await swipe(row,-430);await expect(ends.first()).toBeVisible({timeout:1000})}).toPass({timeout:10000});
 await tap(page.locator('#soOrganizationList [data-row-swipe-key="delete"]'));
 // 확인 한 번 그대로(묻기 전에는 지우지 않는다)
 const ok=page.getByRole('button',{name:'휴지통으로'});await expect(ok).toBeVisible();expect(await page.evaluate(()=>window.__orgDeletes)).toEqual([]);
 await ok.click();
 await expect.poll(()=>page.evaluate(()=>window.__orgDeletes)).toEqual(['ord-0']);
 await expect(rowById(page,FIRST)).toHaveCount(0);
});

for(const width of [390,1280])test(`내 묶음: 목록 맨 아래 접힌 '내 묶음 n' · 목록·관리(초대 링크·나가기) 그대로 · ⋯ [부서 묶음 만들기]로 만들기 ${width}px`,async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width,height:900});await page.goto(base+'?orgs=order&collab=one');
 const fold=page.locator('#soOrganizationList details.so-collab');
 await expect(fold).toHaveCount(1);await expect(fold.locator(':scope > summary')).toHaveText('내 묶음1');
 await expect(fold).not.toHaveAttribute('open','');
 // 자리: 목록(보관한 조직 묶음) 바로 다음, '연락 없는 조직' 줄(있으면 맨 아래) 앞
 expect(await page.evaluate(()=>{const c=document.querySelector('#soOrganizationList details.so-collab'),n=c.nextElementSibling;return {prev:c.previousElementSibling?.matches('.so-excluded-group'),next:n?n.matches('[data-team-quiet]'):null}})).toEqual({prev:true,next:true});
 await fold.locator(':scope > summary').click();
 const g=fold.locator('[data-cg-group="g-1"]');await expect(g).toBeVisible();await expect(g.locator('.cg-gname')).toHaveText('가상노조 가상사업 부서');
 await g.locator(':scope > summary').click();
 await g.getByRole('button',{name:'초대 링크 만들기'}).click();
 await expect(fold.locator('[data-cg-link]')).toContainText('view=team');
 await expect(fold.locator('[data-cg-link]')).toContainText('join='+'b'.repeat(64));
 // 옛 칸의 [+ 만들기] 단추·초대 안내 두 줄은 없다(만들기는 ⋯ 안)
 await expect(fold.locator('[data-cg="new"]')).toHaveCount(0);
 // ⋯ [부서 묶음 만들기] → 접힌 칸 안에 만들기 칸
 await page.locator('[data-cg="link-close"]').click();
 await fold.locator(':scope > summary').click();await expect(fold).not.toHaveAttribute('open','');
 const menu=await openScreenMenu(page);await menu.getByRole('button',{name:'부서 묶음 만들기'}).click();
 await expect(fold).toHaveAttribute('open','');
 const form=fold.locator('[data-cg-form]');await expect(form).toBeVisible();await expect(form.locator('.cg-form-title')).toHaveText('부서 묶음 만들기');
 await expect(form.locator('[data-cg-in="union"]')).toBeFocused();
 await form.locator('[data-cg-in="union"]').fill('가상노조');await form.locator('[data-cg-in="dept"]').fill('새부서');
 await form.locator('[data-cg="form-ok"]').click();
 await expect(fold.locator(':scope > summary')).toHaveText('내 묶음2');
 const made=(await page.evaluate(()=>window.__collabCalls)).filter(c=>c.name==='app_collab_group_create');
 expect(made).toEqual([{name:'app_collab_group_create',body:{p_kind:'dept',p_union_name:'가상노조',p_dept_name:'새부서',p_agree:true}}]);
 // 나가기 = 지금 확인 그대로 → 서버 함수
 const g2=fold.locator('[data-cg-group="g-2"]');await g2.locator(':scope > summary').click();
 await g2.getByRole('button',{name:'묶음 나가기'}).click();
 await page.getByRole('button',{name:'나가기',exact:true}).click();
 await expect(fold.locator(':scope > summary')).toHaveText('내 묶음1');
 expect((await page.evaluate(()=>window.__collabCalls)).some(c=>c.name==='app_collab_leave'&&c.body.p_group==='g-2')).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 expect(errors).toEqual([]);
});

test('⋯ [노조 묶음 만들기]는 부서명 칸 없이 노조 묶음 만들기 칸을 연다',async({page})=>{
 await page.setViewportSize({width:390,height:900});await page.goto(base+'?orgs=order&collab');
 await expect(page.locator('#soOrganizationList details.so-collab summary')).toHaveText('내 묶음0');
 const menu=await openScreenMenu(page);await menu.getByRole('button',{name:'노조 묶음 만들기'}).click();
 const form=page.locator('#soOrganizationList details.so-collab[open] [data-cg-form]');await expect(form).toBeVisible();
 await expect(form.locator('.cg-form-title')).toHaveText('노조 묶음 만들기');await expect(form.locator('[data-cg-in="dept"]')).toHaveCount(0);
 await page.locator('[data-cg="form-cancel"]').click();await expect(form).toHaveCount(0);
 // 빈 칸 안내는 한 줄
 await expect(page.locator('#soCollabPanel .cg-muted')).toHaveCount(1);
});

test('초대 링크(?view=team&join=…)로 오면 접힌 내 묶음이 펼쳐지고 초대 카드가 보인다, 링크 글자는 주소에서 바로 지운다',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const token='c'.repeat(64);
 await page.setViewportSize({width:390,height:900});await page.goto(base+'?orgs=order&collab&view=team&join='+token);
 const fold=page.locator('#soOrganizationList details.so-collab');
 await expect(fold).toHaveAttribute('open','');
 await expect(fold.locator('.cg-join-title')).toHaveText('묶음에 초대받았어요');
 expect(new URL(page.url()).searchParams.has('join')).toBe(false);
 const peek=(await page.evaluate(()=>window.__collabCalls)).find(c=>c.name==='app_collab_invite_peek');expect(peek.body).toEqual({p_token:token});
 await fold.getByRole('button',{name:'들어가기',exact:true}).click();
 await expect(fold.locator('[data-cg-group="g-in"]')).toBeVisible();
 await expect(fold.locator(':scope > summary')).toHaveText('내 묶음1');
 expect(errors).toEqual([]);
});
