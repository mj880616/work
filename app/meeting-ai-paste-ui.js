(()=>{
  'use strict';
  function apply(){
    const modal=document.querySelector('#wfMeetingAiModal');
    if(!modal)return false;
    const title=modal.querySelector('.modal-head h2');
    if(title)title.textContent='회의 결과 자동 분류';
    const lead=modal.querySelector('.modal-head p.muted');
    if(lead)lead.textContent='회의 결과·메모를 그대로 붙여넣으면 AI가 결정 사항, 역할 분담 및 후속 과제, 주요 정보 공유로 나눠 초안을 만듭니다.';
    const input=document.querySelector('#wfMeetingTranscript');
    if(input){
      const label=input.closest('label');
      if(label?.firstChild)label.firstChild.nodeValue='회의 결과·메모 원문 ';
      input.placeholder='회의 결과, 메모, 녹취 정리 내용을 형식 없이 그대로 붙여넣으세요.';
    }
    const button=document.querySelector('#wfMeetingGenerate');
    if(button)button.textContent='AI로 3가지로 분류';
    const decisions=document.querySelector('#wfDraftDecisions')?.closest('label');
    if(decisions?.firstChild)decisions.firstChild.nodeValue='1. 결정 사항 ';
    const actions=document.querySelector('#wfDraftActions')?.closest('label');
    if(actions?.firstChild)actions.firstChild.nodeValue='2. 역할 분담 및 후속 과제 ';
    const info=document.querySelector('#wfDraftInfo')?.closest('label');
    if(info?.firstChild)info.firstChild.nodeValue='3. 주요 정보 공유 ';
    return true;
  }
  function applySoon(){[0,60,160,350,700].forEach(ms=>setTimeout(apply,ms))}
  document.addEventListener('click',e=>{if(e.target.closest?.('#wfMeetingAiBtn,[data-mrd-meeting]'))applySoon()});
  window.addEventListener('kptu:meetings-changed',applySoon);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',applySoon);else applySoon();
})();
