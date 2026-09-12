(()=>{
  if(document.querySelector('#globalActionButtonsStyle'))return;
  const s=document.createElement('style');
  s.id='globalActionButtonsStyle';
  s.textContent=`
/* 보조 액션 버튼 공통 규격: 회의자료 '+ 파일 추가' 크기를 기준으로 통일 */
#appView .mini,
#appView .section-head button:not(.nav-btn),
#appView .panel-head button:not(.nav-btn),
#appView .workspace-head .head-actions button,
#appView .card-actions button,
#appView .so-card-actions button,
#appView button.secondary:not(.wide),
#appView label.secondary,
.modal .mini,
.modal .card-actions button,
.modal .so-card-actions button,
.modal label.secondary:not(.wide){
  width:auto!important;
  min-width:0!important;
  min-height:32px!important;
  height:auto!important;
  padding:5px 9px!important;
  border-radius:9px!important;
  font-size:11px!important;
  line-height:1.15!important;
  white-space:nowrap!important;
  flex:0 0 auto!important;
}

/* 제목 옆 추가 버튼도 같은 크기 */
#appView .section-head button.primary:not(.wide),
#appView .panel-head button.primary:not(.wide),
#appView .workspace-head .head-actions button.primary:not(.wide){
  width:auto!important;
  min-width:0!important;
  min-height:32px!important;
  padding:5px 9px!important;
  font-size:11px!important;
  line-height:1.15!important;
  flex:0 0 auto!important;
}

/* 목록 안 수정·삭제·열기·다운로드 등은 한 줄에 자연스럽게 */
#appView .card-actions,
#appView .so-card-actions,
#appView .head-actions,
.modal .card-actions,
.modal .so-card-actions{
  align-items:center!important;
  gap:6px!important;
  flex-wrap:wrap!important;
}

/* 폼의 핵심 실행 버튼은 기존 큰 크기 유지 */
#appView button.wide,
.modal button.wide,
#appView .modal-foot button,
.modal .modal-foot button{
  min-height:unset;
}

@media(max-width:700px){
  #appView .mini,
  #appView .section-head button:not(.nav-btn),
  #appView .panel-head button:not(.nav-btn),
  #appView .workspace-head .head-actions button,
  #appView .card-actions button,
  #appView .so-card-actions button,
  #appView button.secondary:not(.wide),
  #appView label.secondary,
  .modal .mini,
  .modal .card-actions button,
  .modal .so-card-actions button,
  .modal label.secondary:not(.wide){
    min-height:31px!important;
    padding:5px 8px!important;
    font-size:10.5px!important;
  }
  #appView .section-head,
  #appView .panel-head{
    align-items:center!important;
  }
}
`;
  document.head.appendChild(s);
})();
