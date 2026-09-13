(()=>{
  'use strict';

  function polish(){
    const milestone=document.querySelector('#pm2MilestoneModal');
    if(milestone){
      const type=document.querySelector('#pm2MilestoneType')?.closest('label');
      const at=document.querySelector('#pm2MilestoneAt')?.closest('label');
      const pair=type?.parentElement;
      if(pair?.classList.contains('two-col')&&at&&pair.firstElementChild!==at)pair.insertBefore(at,type);
      const ws=document.querySelector('#pm2MilestoneWs')?.closest('label');
      if(ws&&ws.firstChild?.nodeType===3)ws.firstChild.nodeValue='관련 진행 영역 (선택)';
      const title=document.querySelector('#pm2MilestoneTitle');
      if(title&&!title.placeholder)title.placeholder='예: 9.14 인력확충 기자회견';
      const notes=document.querySelector('#pm2MilestoneNotes');
      if(notes&&!notes.placeholder)notes.placeholder='준비사항·결과·특이사항 등 필요한 메모';
    }

    const decisionWs=document.querySelector('#pm2DecisionWs')?.closest('label');
    if(decisionWs&&decisionWs.firstChild?.nodeType===3)decisionWs.firstChild.nodeValue='관련 진행 영역 (선택)';
  }

  if(!document.querySelector('#pm2ModalPolishStyle')){
    const style=document.createElement('style');
    style.id='pm2ModalPolishStyle';
    style.textContent=`
      #pm2MilestoneModal .small-card,#pm2DecisionModal .small-card,#pm2ProgressModal .small-card{padding-bottom:28px!important}
      #pm2MilestoneModal label,#pm2DecisionModal label,#pm2ProgressModal label{margin:11px 0!important}
      #pm2MilestoneModal textarea,#pm2DecisionModal textarea,#pm2ProgressModal textarea{min-height:82px}
      @media(max-width:760px){
        #pm2MilestoneModal .two-col,#pm2DecisionModal .two-col,#pm2ProgressModal .two-col{grid-template-columns:1fr!important;gap:0!important}
        #pm2MilestoneModal input,#pm2MilestoneModal select,#pm2MilestoneModal textarea,
        #pm2DecisionModal input,#pm2DecisionModal select,#pm2DecisionModal textarea,
        #pm2ProgressModal input,#pm2ProgressModal select,#pm2ProgressModal textarea{font-size:16px!important}
        #pm2MilestoneModal .wide,#pm2DecisionModal .wide,#pm2ProgressModal .wide{margin-bottom:8px!important}
      }
    `;
    document.head.appendChild(style);
  }

  polish();
  let queued=false;
  const observer=new MutationObserver(()=>{
    if(queued)return;
    queued=true;
    requestAnimationFrame(()=>{queued=false;polish()});
  });
  observer.observe(document.body,{childList:true,subtree:true});
})();
