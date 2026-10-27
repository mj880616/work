import {test} from '@playwright/test';
const OUT=process.env.SWEEP_OUT;
const READ='https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/share-page-read';
const page1={title:'가상 민자철도 교섭 현황',blocks:[{type:'summary',text:'3차 교섭 결렬, 조정 신청 예정'},{type:'stages',title:'',items:[{name:'요구안'},{name:'교섭'},{name:'조정'},{name:'쟁의'}],current:1},{type:'schedule',title:'다가오는 일정',items:[{date:'10/31',text:'조정 신청'},{date:'11/05',text:'조합원 설명회'}]},{type:'issues',title:'',items:[{title:'인력 충원',body:'2인1조 보장 요구'},{title:'안전 예산',body:'예산 증액 요구'}]},{type:'links',title:'',items:[{label:'요구안 PDF',url:'https://drive.google.com/file/d/x/view'}]},{type:'updates',title:'',items:[{date:'10/19',text:'3차 교섭 결렬'},{date:'10/12',text:'2차 교섭'}]}]};
for(const w of [1920,390])test('share '+w,async({page})=>{
  await page.setViewportSize({width:w,height:w===390?844:1080});
  await page.route('https://xmlkxfjeagycwttklxjw.supabase.co/**',r=>r.request().url()===READ?r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,page:page1})}):r.abort());
  await page.goto('http://127.0.0.1:8123/share/#t='+'a'.repeat(32)+'b'.repeat(32));
  await page.waitForTimeout(1500);
  await page.screenshot({path:`${OUT}/raw/share-${w}-before.png`,fullPage:w===390});
  const m=await page.evaluate(()=>{const b=document.body.firstElementChild;const main=document.querySelector('main,article,.sr-page')||b;return {mw:getComputedStyle(main).maxWidth,w:Math.round(main.getBoundingClientRect().width),h1:getComputedStyle(document.querySelector('h1')).fontSize,fs:[...new Set([...document.querySelectorAll('p,li,span')].map(e=>getComputedStyle(e).fontSize))],cls:main.className}});
  console.log('SHARE',w,JSON.stringify(m));
});
