// UI-화면정리(2026-10-28 명진 요청 20:03): 세 폭(폰 접은 412·펼친 884·PC 1440) 화면 사진. 가짜 서버(filter-chip-fixture)만 쓰고 운영 서버는 부르지 않는다.
// 사진은 test-results/ui-audit/에 남고 app-e2e-check.yml이 ui-audit-<shard> artifact로 올린다(전후 비교용). 사진만 찍으며 화면을 고치거나 판정하지 않는다.
import {test} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';

const WIDTHS=[[412,915],[884,1000],[1440,900]];
const VIEWS=['home','calendar','tasks','journal','diary','basket','library','team','projects','profile','telegram','calls','ledger','hwp'];
const DIR='test-results/ui-audit';

// 사진과 함께 잰 값(잘림·가림)을 한 줄로 남긴다: 스크롤 칸 왼쪽 밖으로 밀려 닿을 수 없는 것, 글자가 칸보다 긴 버튼, 화면 아래 고정 줄·둥근 [+]에 가린 누를 것.
// GitHub 화면의 알림(notice)으로도 보이게 '::notice' 형식으로 찍는다(판정 없음, 기록만).
async function measure(page){
  return page.evaluate(()=>{
    const out={leftCut:[],textCut:[],covered:[]};
    const name=el=>(el.getAttribute('aria-label')||el.textContent||el.id||el.className||el.tagName).replace(/\s+/g,' ').trim().slice(0,24);
    const shown=el=>{const r=el.getBoundingClientRect();if(r.width<1||r.height<1)return false;const cs=getComputedStyle(el);return cs.visibility!=='hidden'&&cs.display!=='none'&&!el.closest('[hidden],.hidden')};
    const view=document.querySelector('#appView .view-panel:not(.hidden)')||document.querySelector('#appView');
    for(const box of view.querySelectorAll('*')){
      const cs=getComputedStyle(box);if(!/(auto|scroll|hidden)/.test(cs.overflowX)||!shown(box)||box.scrollLeft>0)continue;
      const br=box.getBoundingClientRect();
      for(const kid of box.children){if(!shown(kid))continue;const r=kid.getBoundingClientRect();if(r.left<br.left-1&&r.right>br.left)out.leftCut.push(name(kid)+'@'+name(box).slice(0,12));}
    }
    for(const b of view.querySelectorAll('button,select,[role="button"],a.mini')){if(!shown(b))continue;if(b.scrollWidth>b.clientWidth+2&&b.clientWidth>0)out.textCut.push(name(b)+':'+b.clientWidth+'/'+b.scrollWidth);}
    const fixed=[...document.querySelectorAll('#appView *,.mobile-tabs,.mobile-tabs *')].filter(el=>{const p=getComputedStyle(el).position;return (p==='fixed'||p==='sticky')&&shown(el)&&el.getBoundingClientRect().top>innerHeight*0.6});
    for(const b of view.querySelectorAll('button,a[href],select,input:not([type=hidden])')){
      if(!shown(b)||fixed.some(f=>f.contains(b)))continue;const r=b.getBoundingClientRect();if(r.bottom<0||r.top>innerHeight)continue;
      const cx=r.left+r.width/2,cy=r.top+r.height/2,hit=document.elementFromPoint(Math.min(innerWidth-1,Math.max(0,cx)),Math.min(innerHeight-1,Math.max(0,cy)));
      if(hit&&!b.contains(hit)&&!hit.contains(b)){const cover=fixed.find(f=>f.contains(hit));if(cover)out.covered.push(name(b)+'<'+name(cover).slice(0,12));}
    }
    for(const k of Object.keys(out))out[k]=[...new Set(out[k])].slice(0,12);
    return out;
  });
}

for(const [width,height] of WIDTHS){
  test(`화면 사진 ${width}px`,async({page})=>{
    test.setTimeout(240000);
    mkdirSync(DIR,{recursive:true});
    await page.setViewportSize({width,height});
    const state=baseState();state.meetings=[];state.meetingWrites=[];state.downloads=[];state.deletes=[];
    await mockApp(page,state);
    await signIn(page);
    const lines=[];
    for(const view of VIEWS){
      try{
        await page.evaluate(v=>window.KPTURouter?.go?.(v),view);
        await page.waitForTimeout(1200);
        await page.evaluate(()=>window.scrollTo(0,0));
        await page.screenshot({path:`${DIR}/${view}-${width}.png`});
        const top=await measure(page);
        // 목록 끝(폰 [+]·아래 전환 줄이 가리는지)도 한 장.
        let end={covered:[]};
        if(width<=884){await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await page.waitForTimeout(300);await page.screenshot({path:`${DIR}/${view}-${width}-end.png`});end=await measure(page);}
        lines.push(`${view}: L=${top.leftCut.join('|')} T=${top.textCut.join('|')} C=${top.covered.join('|')} E=${end.covered.join('|')}`);
      }catch(error){lines.push(`${view}: error ${String(error?.message||error).slice(0,80)}`);}
    }
    const esc=t=>t.replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A');
    process.stdout.write(`::notice title=ui-audit ${width}::${esc(lines.join('\n'))}\n`);
  });
}
