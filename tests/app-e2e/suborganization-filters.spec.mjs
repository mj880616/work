import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const canonical='http://127.0.0.1:8123/tests/app-e2e/suborganization-filters-canonical-fixture.html';

async function openAssigned(page,suffix=''){
  await page.goto(canonical+suffix);
  await page.evaluate(()=>window.__KPTU_SUBORGANIZATIONS_READY__);
  await expect(page.locator('#soOrganizationList')).toBeVisible();
}
const visibleNames=page=>page.locator('.so-card h4').allTextContents();

test('담당조직 탭은 검색·협의회·유형 필터 없이 내 담당조직 목록부터 바로 표시한다',async({page})=>{
  await openAssigned(page);
  expect(await visibleNames(page)).toEqual(['전국철도노동조합']);
  await expect(page.locator('[data-so-org="org-consumer"]')).toHaveCount(0);
  await expect(page.locator('#sofToolbar,#sofSearch,#sofCouncil,#sofType,#sofReset')).toHaveCount(0);
  await expect(page.locator('#soOrgCount')).toHaveText('1개 담당조직');
  await expect(page.locator('#soTeamSection h3')).toHaveCount(0);
  const rail=page.locator('[data-so-org="org-rail"]');
  await expect(rail.locator('.sof-type')).toHaveText('철도·도시철도');
  await expect(rail.locator('.so-chevron')).toHaveText('›');
  await expect(rail).not.toContainText('김명진');
});

test('필터 모듈은 active asset graph에서 제거되고 담당조직 단일 렌더러만 사용한다',async()=>{
  const loader=readFileSync('app/loader-v2.js','utf8');
  const views=readFileSync('app/view-loader.js','utf8');
  const styles=readFileSync('app/styles.css','utf8');
  expect(views).toContain("suborganizations.js?v=8");
  expect(views).toContain("workplace-detail.js?v=8");
  expect(loader).not.toContain('suborganization-filters.js');
  expect(views).not.toContain('suborganization-filters.js');
  expect(styles).toContain("suborganizations.css?v=5");
  expect(styles).toContain("workplace-detail.css?v=4");
  expect(styles).not.toContain('suborganization-filters.css');
});

async function openRail(page,suffix=''){
  await openAssigned(page,suffix);
  await page.locator('[data-so-org="org-rail"]').click();
  await expect(page.locator('#wdModal')).toBeVisible();
  await expect(page.locator('#wdUpdates')).toContainText('지난주 지부장 통화');
}

test('담당조직 상세 맨 위는 조직명과 입력칸 하나, 저장 버튼이고 예전 입력 경로는 없다',async({page})=>{
  await openRail(page);
  await expect(page.locator('#wdTitle')).toHaveText('전국철도노동조합');
  await expect(page.locator('#wdInboxText')).toBeVisible();
  await expect(page.locator('#wdInboxText')).toHaveAttribute('placeholder','통화·회의·교섭 내용을 그냥 적으세요');
  await expect(page.locator('#wdInboxSave')).toHaveText('저장');
  await expect(page.locator('#wdModal textarea:visible, #wdModal input:visible')).toHaveCount(1);
  await expect(page.locator('#wdUpdateCurrent,#wdCurrentModal,#wdAddItem,#wdItemModal,#warRaw,#warSaveRaw')).toHaveCount(0);
  await expect(page.locator('#wdDeleteOrg')).toHaveCount(0);
  const order=await page.locator('#wdModal .wd-card').evaluate(card=>[...card.querySelectorAll(':scope > .wd-sec')].map(sec=>sec.querySelector('h3')?.textContent?.trim()));
  expect(order).toEqual(['기록','연도별 타임라인','기본 정보 · 소속 · 이전 요약']);
  const pos=await page.locator('#wdModal .wd-card').evaluate(card=>({
    title:card.querySelector('#wdTitle').getBoundingClientRect().top,
    input:card.querySelector('#wdInboxText').getBoundingClientRect().top,
    log:card.querySelector('#wdLog').getBoundingClientRect().top
  }));
  expect(pos.title).toBeLessThan(pos.input);
  expect(pos.input).toBeLessThan(pos.log);
  await expect(page.locator('#wdMore')).not.toHaveAttribute('open','');
});

test('저장하면 날짜·시간과 함께 기록 맨 위에 쌓이고 입력칸이 비워진다',async({page})=>{
  await openRail(page);
  await page.locator('#wdInboxText').fill('오늘 지부장 통화. 사측 12명, 노조 20명 요구.');
  await page.locator('#wdInboxSave').click();
  await expect(page.locator('#wdInboxText')).toHaveValue('');
  await expect(page.locator('#wdInboxState')).toHaveText('저장했습니다.');
  await page.locator('#wdInboxText').fill('다음주 화요일 교섭 예정');
  await page.locator('#wdInboxText').press('Control+Enter');
  await expect(page.locator('#wdInboxText')).toHaveValue('');
  const rows=page.locator('#wdUpdates .wd-log-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).locator('p')).toHaveText('다음주 화요일 교섭 예정');
  await expect(rows.nth(1).locator('p')).toHaveText('오늘 지부장 통화. 사측 12명, 노조 20명 요구.');
  await expect(rows.nth(2).locator('p')).toHaveText('지난주 지부장 통화: 인력 요구안 확정');
  await expect(rows.nth(0).locator('small')).toHaveText(/2026\. 9\. 26\..*\d{1,2}:\d{2}/);
  const posts=await page.evaluate(()=>window.__updatePosts);
  expect(posts).toEqual([
    {organization_id:'org-rail',raw_text:'오늘 지부장 통화. 사측 12명, 노조 20명 요구.',created_by:'user-me'},
    {organization_id:'org-rail',raw_text:'다음주 화요일 교섭 예정',created_by:'user-me'}
  ]);
  expect(await page.evaluate(()=>window.__patches.length)).toBe(0);
});

test('빈칸·공백만 있으면 저장하지 않고, 저장 실패 시 입력 내용을 지우지 않는다',async({page})=>{
  await openRail(page);
  await page.locator('#wdInboxSave').click();
  await expect(page.locator('#wdInboxState')).toHaveText('내용을 입력해 주세요.');
  await page.locator('#wdInboxText').fill('   \n  ');
  await page.locator('#wdInboxSave').click();
  await expect(page.locator('#wdInboxState')).toHaveText('내용을 입력해 주세요.');
  expect(await page.evaluate(()=>window.__updatePosts.length)).toBe(0);
  await expect(page.locator('#wdUpdates .wd-log-row')).toHaveCount(1);
  await page.evaluate(()=>{window.__failUpdateSave=true});
  await page.locator('#wdInboxText').fill('저장 실패 시험');
  await page.locator('#wdInboxSave').click();
  await expect(page.locator('#wdInboxState')).toHaveText('기록 저장 실패');
  await expect(page.locator('#wdInboxText')).toHaveValue('저장 실패 시험');
  await expect(page.locator('#wdUpdates .wd-log-row')).toHaveCount(1);
});

test('이미 저장된 요약·메모는 접힌 칸에서 읽기 전용으로 보이고 AI 초안 버튼도 그 안에 있다',async({page})=>{
  await openRail(page);
  await expect(page.locator('#wdMonthSummary')).toBeHidden();
  await expect(page.locator('#warGenerate')).toBeHidden();
  await page.locator('#wdMore > summary').click();
  await expect(page.locator('#wdMonthSummary')).toHaveText('9월 정책교섭과 인력대응 진행 중');
  await expect(page.locator('#wdYearSummary')).toHaveText('산별전환과 안전인력 사업 추진');
  await expect(page.locator('#wdItems')).toContainText('최근 교섭');
  await expect(page.locator('#wdItems')).toContainText('정책교섭 자료 취합 중');
  await expect(page.locator('#wdItems button')).toHaveCount(1);
  await expect(page.locator('#wdItems button')).toHaveText('삭제');
  await expect(page.locator('#wdRecent textarea,#wdRecent input')).toHaveCount(0);
  await expect(page.locator('#wdMore #warGenerate')).toBeVisible();
  await expect(page.locator('#wdMore #warTimeline')).toBeVisible();
  await expect(page.locator('#wdMore #wdBasicView')).toBeVisible();
  await expect(page.locator('#wdMore #wdAffChips')).toContainText('궤도협의회');
});

test('편집 권한이 없으면 입력칸과 저장 버튼이 보이지 않고 저장 요청도 없다',async({page})=>{
  await openAssigned(page,'?role=viewer');
  await page.evaluate(()=>{const b=document.createElement('button');b.id='openRailE2E';b.dataset.psWorkplaceOrg='org-rail';document.body.appendChild(b)});
  await page.locator('#openRailE2E').click();
  await expect(page.locator('#wdModal')).toBeVisible();
  await expect(page.locator('#wdUpdates')).toContainText('지난주 지부장 통화');
  await expect(page.locator('#wdInbox')).toBeHidden();
  await expect(page.locator('#wdInboxSave')).toBeHidden();
  await page.locator('#wdInboxSave').evaluate(b=>b.click());
  expect(await page.evaluate(()=>window.__updatePosts.length)).toBe(0);
});

test('기록 삭제는 확인 후 해당 항목만 지우고, 취소하면 요청 없이 그대로 둔다',async({page})=>{
  await openRail(page);
  await page.locator('#wdInboxText').fill('삭제할 기록');
  await page.locator('#wdInboxSave').click();
  const rows=page.locator('#wdUpdates .wd-log-row');
  await expect(rows).toHaveCount(2);
  let asked='';
  page.once('dialog',d=>{asked=d.message();d.dismiss()});
  await rows.nth(0).getByRole('button',{name:'기록 삭제'}).click();
  expect(asked).toBe('이 기록을 삭제할까요?');
  await expect(rows).toHaveCount(2);
  expect(await page.evaluate(()=>window.__deletes.length)).toBe(0);
  page.once('dialog',d=>d.accept());
  await rows.nth(0).getByRole('button',{name:'기록 삭제'}).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0).locator('p')).toHaveText('지난주 지부장 통화: 인력 요구안 확정');
  await expect(page.locator('#toast')).toHaveText('기록을 삭제했습니다.');
  const deletes=await page.evaluate(()=>window.__deletes);
  expect(deletes).toEqual([{path:'/rest/v1/app_suborganization_updates?id=eq.up-2&organization_id=eq.org-rail&select=id',prefer:'return=representation'}]);
});

test('예전 메모는 읽기 전용이고 확인 후 삭제만 할 수 있다',async({page})=>{
  await openRail(page);
  await page.locator('#wdMore > summary').click();
  const memo=page.locator('#wdItems .wd-row');
  await expect(memo).toHaveCount(1);
  page.once('dialog',d=>d.dismiss());
  await memo.getByRole('button',{name:'메모 삭제'}).click();
  await expect(memo).toHaveCount(1);
  expect(await page.evaluate(()=>window.__deletes.length)).toBe(0);
  let asked='';
  page.once('dialog',d=>{asked=d.message();d.accept()});
  await memo.getByRole('button',{name:'메모 삭제'}).click();
  expect(asked).toBe('이 메모를 삭제할까요?');
  await expect(page.locator('#wdItems')).toHaveText('이전 메모 없음');
  await expect(page.locator('#toast')).toHaveText('메모를 삭제했습니다.');
  const deletes=await page.evaluate(()=>window.__deletes);
  expect(deletes).toEqual([{path:'/rest/v1/app_suborganization_status_items?id=eq.memo-1&organization_id=eq.org-rail&select=id',prefer:'return=representation'}]);
  await expect(page.locator('#wdMonthSummary')).toHaveText('9월 정책교섭과 인력대응 진행 중');
  await expect(page.locator('#wdYearSummary')).toHaveText('산별전환과 안전인력 사업 추진');
  await expect(page.locator('#wdMonthSummary button,#wdYearSummary button')).toHaveCount(0);
});

test('삭제 요청이 실패하거나 지워진 행이 없으면 항목을 그대로 두고 안내한다',async({page})=>{
  await openRail(page);
  page.on('dialog',d=>d.accept());
  const row=page.locator('#wdUpdates .wd-log-row');
  const del=row.getByRole('button',{name:'기록 삭제'});
  await page.evaluate(()=>{window.__failDelete=true});
  await del.click();
  await expect(page.locator('#toast')).toHaveText('기록을 삭제하지 못했습니다. 네트워크 오류');
  await expect(row).toHaveCount(1);
  await expect(del).toBeEnabled();
  await page.evaluate(()=>{window.__failDelete=false;window.__deleteNoRows=true});
  await del.click();
  await expect(page.locator('#toast')).toHaveText('기록을 삭제하지 못했습니다. 권한이 없거나 이미 없는 항목입니다.');
  await expect(row).toHaveCount(1);
  await expect(row.locator('p')).toHaveText('지난주 지부장 통화: 인력 요구안 확정');
  await page.locator('#wdMore > summary').click();
  await page.locator('#wdItems').getByRole('button',{name:'메모 삭제'}).click();
  await expect(page.locator('#toast')).toHaveText('메모를 삭제하지 못했습니다. 권한이 없거나 이미 없는 항목입니다.');
  await expect(page.locator('#wdItems .wd-row')).toHaveCount(1);
  expect(await page.evaluate(()=>window.__deletes.length)).toBe(3);
});

test('편집 권한이 없으면 기록·메모 삭제 버튼이 없고 삭제 요청도 보내지 않는다',async({page})=>{
  await openAssigned(page,'?role=viewer');
  await page.evaluate(()=>{const b=document.createElement('button');b.id='openRailE2E';b.dataset.psWorkplaceOrg='org-rail';document.body.appendChild(b)});
  await page.locator('#openRailE2E').click();
  await expect(page.locator('#wdUpdates')).toContainText('지난주 지부장 통화');
  await page.locator('#wdMore > summary').click();
  await expect(page.locator('#wdItems')).toContainText('최근 교섭');
  await expect(page.locator('#wdUpdates button,#wdItems button')).toHaveCount(0);
  await expect(page.locator('[data-wd-up-del],[data-wd-memo-del]')).toHaveCount(0);
  let dialogs=0;
  page.on('dialog',d=>{dialogs++;d.accept()});
  await page.evaluate(async()=>{await wdDelUpdate('up-old');await wdDelMemo('memo-1')});
  expect(dialogs).toBe(0);
  expect(await page.evaluate(()=>window.__deletes.length)).toBe(0);
  await expect(page.locator('#wdUpdates .wd-log-row')).toHaveCount(1);
  await expect(page.locator('#wdItems .wd-row')).toHaveCount(1);
});

test('기본정보는 읽기전용으로 시작하고 수정 버튼을 눌러야 입력 폼이 열린다',async({page})=>{
  await openAssigned(page);
  await page.locator('[data-so-org="org-rail"]').click();
  await page.locator('#wdMore > summary').click();
  await expect(page.locator('#wdBasicView')).toBeVisible();
  await expect(page.locator('#wdBasicForm')).toBeHidden();
  await expect(page.locator('#wdBasicView')).toContainText('김철도');
  await expect(page.locator('#wdBasicView')).toContainText('12,000명');
  await page.locator('#wdEditBasic').click();
  await expect(page.locator('#wdBasicView')).toBeHidden();
  await expect(page.locator('#wdBasicForm')).toBeVisible();
  await expect(page.locator('#wdName')).toHaveValue('전국철도노동조합');
  await page.locator('#wdCancelBasic').click();
  await expect(page.locator('#wdBasicView')).toBeVisible();
  await expect(page.locator('#wdBasicForm')).toBeHidden();
});

test('일반 상세에서 조직 삭제 실행 경로가 제거되고 데이터 삭제는 수행하지 않는다',async()=>{
  const detail=readFileSync('app/workplace-detail.js','utf8');
  expect(detail).not.toContain('id="wdDeleteOrg"');
  expect(detail).not.toContain('function wdDeleteOrg');
  expect(detail).not.toContain("addEventListener('click',wdDeleteOrg)");
  expect(detail).toContain('id="wdInboxSave"');
  expect(detail).toContain('id="wdBasicView"');
});

test('viewer에게 담당조직 추가 컨트롤이 노출되거나 탭되지 않는다',async({page})=>{
  await openAssigned(page,'?role=viewer');
  await expect(page.locator('#soAddOrg')).toBeHidden();
  await expect(page.locator('.so-card')).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(page.locator('#soAddOrg')).not.toBeFocused();
});

test('360 390 412 430px에서 담당조직 목록과 상세가 가로 넘침 없이 표시된다',async({page})=>{
  for(const width of [360,390,412,430]){
    await page.setViewportSize({width,height:844});
    await openAssigned(page);
    let overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
    expect(overflow,`list overflow at ${width}px`).toBeLessThanOrEqual(1);
    await page.locator('[data-so-org="org-rail"]').click();
    await expect(page.locator('#wdModal')).toBeVisible();
    overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
    expect(overflow,`detail overflow at ${width}px`).toBeLessThanOrEqual(1);
    const card=await page.locator('#wdModal .wd-card').evaluate(el=>el.getBoundingClientRect().width);
    expect(card,`detail width at ${width}px`).toBeLessThanOrEqual(width);
  }
});
