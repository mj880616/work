import {test,expect} from '@playwright/test';
import {openEmphasisFixture} from './helpers/calendar-task-emphasis.mjs';
import {openHome} from './helpers/home-entry.mjs';
import {chooseBasketKind} from './helpers/basket-kind.mjs';
import {screenFind} from './helpers/screen-find.mjs';
// S70-67 SEARCH-비슷한것찾기(사용자 11/26 08:22~08:24 "아주 똑같은 글자를 입력 안 해도 비슷한 게 있으면 보여준다" · "추천대로"):
// 모든 '<메뉴>에서 찾기'가 공용 부품(app/find-match-model.mjs + screen-find.js findFor)을 쓴다. 폰 390에서
//  ① 일정: '국토 부'(띄어쓰기)·'ㄱㅌㅂ'(초성)으로 국토부 일정을 찾고, 지금 보기 밖(다른 달) 일정도 '다른 날 일정' 줄에 나오며 누르면 그 날로 간다.
//  ② 노트: 같은 부품 — 초성·치는 중(국톱)·오타, 맞은 정도 순, 맞은 부분 칠하기(CSS Custom Highlight).
//  ③ 뜻 비슷 찾기: 결과가 적으면 서버 AI(ai-assist find_expand)에 친 글 하나만 보내고, 받은 비슷한 말로 다시 거르며 '비슷한 말로도 찾았어요' 한 줄.
//     한도를 넘으면(429) 글자 비슷 찾기 결과만. 서버는 흉내, 이름·글은 지어낸 것.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const EVENTS=[
  {id:'ev-a',calendarId:'qa-cal',source:'google',title:'가상 국토부 협의',start:'2026-10-21',end:'2026-10-22',allDay:true,color:'#4285f4'},
  {id:'ev-b',calendarId:'qa-cal',source:'google',title:'가상 노조 회의',start:'2026-10-22',end:'2026-10-23',allDay:true,color:'#4285f4'},
  {id:'ev-c',calendarId:'qa-cal',source:'google',title:'가상 국토부 간담회',start:'2026-12-03',end:'2026-12-04',allDay:true,color:'#4285f4'},
];
const marked=page=>page.evaluate(()=>{const h=CSS.highlights?.get('kptu-find');return h?[...h].map(r=>r.toString()):[]});

test.describe('비슷한 것 찾기 폰 390',()=>{
  test.use({viewport:{width:390,height:860}});

  test('일정: 띄어쓰기·초성으로 국토부 일정 · 다른 달 일정도 찾고 누르면 그 날로',async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await openEmphasisFixture(page,{view:'list',events:EVENTS});
    const rows=page.locator('#calendarList .clv-event[data-google-event]');
    await expect(rows).toHaveCount(2);
    const find=await screenFind(page);
    await expect(find).toHaveAttribute('placeholder','일정에서 찾기');
    for(const q of ['국토 부','ㄱㅌㅂ','국톱']){
      await find.fill(q);
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText('가상 국토부 협의');
      await expect.poll(()=>marked(page)).toContain('국토부');
    }
    // 지금 보기(10월 15일부터 14일) 밖의 12월 일정
    const more=page.locator('#calendarFindMore');
    await expect(more).toBeVisible();
    await expect(more.locator('.cfm-row')).toHaveCount(1);
    await expect(more.locator('.cfm-row')).toContainText('12월 3일');
    await expect(more.locator('.cfm-row')).toContainText('가상 국토부 간담회');
    await more.locator('.cfm-row').click();
    await expect(rows.filter({hasText:'가상 국토부 간담회'})).toHaveCount(1);
    await expect(more.locator('.cfm-row')).toContainText('가상 국토부 협의'); // 이제 10월 것이 다른 날
    await find.fill('');
    await expect(more).toBeHidden();
    expect(await marked(page)).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });

  async function openNotes(page,{ai=null}={}){
    const at=(d)=>`2026-10-0${d}T01:00:00Z`;
    const note=(id,title,raw_text,d)=>({id,workspace_id:'w',kind:'note',title,raw_text,occurred_at:at(d),created_at:at(d),updated_at:at(d),archived_at:null,metadata:{}});
    const rows=[note('n1','가상 국토부 회의 메모','민자철도 협의 준비',1),note('n2','가상 임금 정리','기본급 인상',2),note('n3','국토부','짧은 메모',3),note('n4','가상 협의 일정','다음 주',4)];
    const asked=[];
    await openHome(page);
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',r=>{const q=new URL(r.request().url()).searchParams;
      if(r.request().method()!=='GET')return r.fallback();if(q.get('metadata'))return r.fulfill({json:[]});
      return r.fulfill({json:rows.filter(x=>!q.get('kind')||'eq.'+x.kind===q.get('kind'))})});
    await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/ai-assist',r=>{
      const body=r.request().postDataJSON?.()||{};
      if(body.kind!=='find_expand')return r.fallback();
      asked.push(body);
      return ai?ai(r,body):r.fulfill({status:429,json:{error:'daily_limit'}});
    });
    await chooseBasketKind(page,'note');
    return {asked};
  }

  test('노트: 같은 부품 — 초성·치는 중·오타, 맞은 정도 순, 맞은 부분 칠하기',async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const {asked}=await openNotes(page);
    const rows=page.locator('#noteRows [data-note-row]');
    await expect(rows).toHaveCount(4);
    const find=await screenFind(page);
    await expect(find).toHaveAttribute('placeholder','노트에서 찾기');
    await find.fill('ㄱㅌㅂ');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('국토부'); // 제목이 '국토부'로 시작하는 줄이 먼저(맞은 정도 순)
    await expect(rows.nth(1)).toContainText('가상 국토부 회의 메모');
    await expect.poll(()=>marked(page)).toContain('국토부');
    await find.fill('국토 부');
    await expect(rows).toHaveCount(2);
    await find.fill('민자철드'); // 본문 오타 한 글자
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('가상 국토부 회의 메모');
    await find.fill('');
    await expect(rows).toHaveCount(4);
    expect(asked).toEqual([],'결과가 충분하거나 초성만이면 AI 풀이를 부르지 않는다');
    expect(errors).toEqual([]);
  });

  test('뜻 비슷 찾기: 친 글 하나만 서버에 보내고 비슷한 말로 다시 거름 · 한도를 넘으면 글자 찾기 결과만',async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    let limit=true;
    const {asked}=await openNotes(page,{ai:(r)=>limit?r.fulfill({status:429,json:{error:'daily_limit'}}):r.fulfill({json:{ok:true,kind:'find_expand',words:['교섭','협의','간담회'],from:'',to:''}})});
    const rows=page.locator('#noteRows [data-note-row]');
    await expect(rows).toHaveCount(4);
    const find=await screenFind(page);
    // 한도 초과: 한 번 묻고(429) 더 묻지 않으며, 결과는 글자 비슷 찾기 그대로(0개), 한 줄 없음
    await find.fill('교섭');
    await expect.poll(()=>asked.length).toBe(1);
    expect(asked[0]).toEqual({kind:'find_expand',text:'교섭'});
    await expect(page.locator('#sfAlso')).toHaveCount(0);
    await expect(rows).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('뜻 비슷 찾기: 받은 비슷한 말로 다시 거르고 한 줄을 보임',async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const {asked}=await openNotes(page,{ai:r=>r.fulfill({json:{ok:true,kind:'find_expand',words:['교섭','협의','간담회'],from:'',to:''}})});
    const rows=page.locator('#noteRows [data-note-row]');
    await expect(rows).toHaveCount(4);
    const find=await screenFind(page);
    await find.fill('교섭');
    await expect.poll(()=>asked.length).toBe(1);
    expect(asked[0]).toEqual({kind:'find_expand',text:'교섭'},'친 글 하나만(노트 글·목록은 보내지 않음)');
    await expect(page.locator('#sfAlso')).toHaveText('비슷한 말로도 찾았어요: 협의 · 간담회');
    await expect(rows).toHaveCount(2); // '협의'가 든 노트 두 개
    await expect.poll(()=>marked(page)).toContain('협의');
    await find.fill('');
    await expect(page.locator('#sfAlso')).toBeHidden();
    await expect(rows).toHaveCount(4);
    expect(errors).toEqual([]);
  });
});
