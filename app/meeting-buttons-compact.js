(()=>{
  if(document.querySelector('#meetingButtonsCompactStyle'))return;
  const s=document.createElement('style');
  s.id='meetingButtonsCompactStyle';
  s.textContent=`
#meetingRoundDetailModal .meeting-round-detail-card button:not(.icon-btn):not(.map-picker-btn),
#meetingRoundDetailModal .meeting-round-detail-card .mrd-upload-label{
  width:auto!important;
  min-width:0!important;
  min-height:32px!important;
  height:auto!important;
  padding:5px 9px!important;
  border-radius:9px!important;
  font-size:11px!important;
  line-height:1.15!important;
  white-space:nowrap!important;
  flex:none!important;
}
#meetingRoundDetailModal .meeting-round-detail-card .mrd-task-form-actions,
#meetingRoundDetailModal .meeting-round-detail-card .mrd-editor-actions{
  display:flex!important;
  gap:6px!important;
  justify-content:flex-end!important;
}
#meetingRoundDetailModal .meeting-round-detail-card .mrd-task-form-actions button,
#meetingRoundDetailModal .meeting-round-detail-card .mrd-editor-actions button{
  flex:none!important;
}
#meetingRoundDetailModal .meeting-round-detail-card .icon-btn{
  flex:none!important;
}
#meetingRoundDetailModal .mrd-followup-section .mrd-section-head{
  margin-bottom:11px!important;
}
#meetingRoundDetailModal #mrdTasks{
  margin-top:0!important;
}
#meetingRoundDetailModal .mrd-task-form>label:nth-of-type(2),
#meetingRoundDetailModal .mrd-task-form>label:nth-of-type(3){
  min-width:0!important;
  width:100%!important;
}
#meetingRoundDetailModal .mrd-task-form .map-picker,
#meetingRoundDetailModal .mrd-task-form .map-picker-btn,
#meetingRoundDetailModal .mrd-task-form input[type="date"]{
  width:100%!important;
  min-width:0!important;
}
#meetingRoundDetailModal .mrd-task-form .map-picker-btn,
#meetingRoundDetailModal .mrd-task-form input[type="date"]{
  min-height:42px!important;
  height:42px!important;
}
@media(max-width:700px){
  #meetingRoundDetailModal .meeting-round-detail-card button:not(.icon-btn):not(.map-picker-btn),
  #meetingRoundDetailModal .meeting-round-detail-card .mrd-upload-label{
    min-height:31px!important;
    padding:5px 8px!important;
    font-size:10.5px!important;
  }
  #meetingRoundDetailModal .meeting-round-detail-card{
    padding-bottom:calc(92px + env(safe-area-inset-bottom))!important;
    scroll-padding-bottom:calc(92px + env(safe-area-inset-bottom))!important;
  }
  #meetingRoundDetailModal .mrd-material-section{
    padding-bottom:14px!important;
  }
  #meetingRoundDetailModal .mrd-task-form{
    grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important;
    column-gap:8px!important;
    row-gap:8px!important;
  }
  #meetingRoundDetailModal .mrd-task-form>label:first-child{
    grid-column:1/-1!important;
  }
  #meetingRoundDetailModal .mrd-task-form>label:nth-of-type(2){
    grid-column:1/2!important;
  }
  #meetingRoundDetailModal .mrd-task-form>label:nth-of-type(3){
    grid-column:2/3!important;
  }
  #meetingRoundDetailModal .mrd-task-form .map-picker-btn,
  #meetingRoundDetailModal .mrd-task-form input[type="date"]{
    min-height:42px!important;
    height:42px!important;
    padding:0 10px!important;
    font-size:12px!important;
  }
}
`;
  document.head.appendChild(s);
})();
