(()=>{
  'use strict';

  const exact=(selector,from,to)=>{
    document.querySelectorAll(selector).forEach(el=>{
      if(el.textContent.trim()===from)el.textContent=to;
    });
  };

  const apply=()=>{
    const campaign=document.querySelector('[data-pm2-type="campaign"] strong');
    if(campaign&&campaign.textContent.trim()!=='의제 사업')campaign.textContent='의제 사업';

    const blankDesc=document.querySelector('[data-pm2-type="blank"] span');
    if(blankDesc&&blankDesc.textContent.includes('진행상황'))blankDesc.textContent=blankDesc.textContent.replace('진행상황','진행 기록');

    document.querySelectorAll('.pm2-card-type').forEach(el=>{
      if(el.textContent.trim()==='쟁점·캠페인')el.textContent='의제 사업';
    });
    const kicker=document.querySelector('#pm2DetailKicker');
    if(kicker&&kicker.textContent.includes('쟁점·캠페인'))kicker.textContent=kicker.textContent.replace('쟁점·캠페인','의제 사업');

    exact('[data-pm2-module="progress"] + span','진행상황 · 필수','진행 기록 · 필수');
    exact('[data-pm2-module="milestones"] + span','마일스톤','주요 일정');
    exact('[data-pm2-module="collaboration"] + span','협업','프로젝트 관련 의견');

    exact('[data-pm2-nav]','진행상황','진행 기록');
    exact('[data-pm2-nav]','마일스톤','주요 일정');
    exact('[data-pm2-nav]','협업','프로젝트 관련 의견');

    exact('.pm2-section-head h3','진행상황','진행 기록');
    exact('.pm2-section-head h3','마일스톤','주요 일정');
    exact('.pm2-section-head h3','협업','프로젝트 관련 의견');

    exact('[data-pm2-add-milestone]','+ 마일스톤','+ 일정');
    exact('#pm2MilestoneModal h2','마일스톤 추가','주요 일정 추가');
    exact('#pm2MilestoneModal .eyebrow','MILESTONE','주요 일정');
    exact('#pm2ProgressModal h2','진척상황 기록','진행 기록');
    exact('#pm2SaveProgress','진척상황 저장','진행 기록 저장');
    exact('.pm2-empty','마일스톤이 없습니다.','주요 일정이 없습니다.');

    document.querySelectorAll('.pm2-section-head p').forEach(el=>{
      if(el.textContent.trim()==='기자회견·집회·정부협의·토론회·성과 같은 중요한 지점을 관리합니다.'){
        el.textContent='기자회견·집회·정부협의·토론회·마감·성과 등 사업의 주요 일정과 분기점을 관리합니다.';
      }
      if(el.textContent.trim()==='영역별 상태를 덮어쓰지 않고 시간순으로 누적합니다.'){
        el.textContent='현재 상태와 다음 조치를 영역별로 시간순으로 누적합니다.';
      }
      if(el.textContent.trim()==='프로젝트 관련 의견과 검토 메모를 남깁니다.'){
        el.textContent='프로젝트 관련 의견과 검토 메모를 남깁니다.';
      }
    });

    document.querySelectorAll('[data-pm2-module-row] input[type="text"]').forEach(input=>{
      if(input.value==='진행상황')input.value='진행 기록';
      else if(input.value==='마일스톤')input.value='주요 일정';
      else if(input.value==='협업')input.value='프로젝트 관련 의견';
    });
  };

  let queued=false;
  const schedule=()=>{
    if(queued)return;
    queued=true;
    requestAnimationFrame(()=>{
      queued=false;
      apply();
    });
  };

  apply();
  const observer=new MutationObserver(schedule);
  observer.observe(document.body,{childList:true,subtree:true});
})();
