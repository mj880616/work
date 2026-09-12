(()=>{
  if(document.querySelector('#meetingButtonsCompactStyle'))return;
  const s=document.createElement('style');
  s.id='meetingButtonsCompactStyle';
  s.textContent=`
#meetingRoundDetailModal .meeting-round-detail-card button:not(.icon-btn),
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
@media(max-width:700px){
  #meetingRoundDetailModal .meeting-round-detail-card button:not(.icon-btn),
  #meetingRoundDetailModal .meeting-round-detail-card .mrd-upload-label{
    min-height:31px!important;
    padding:5px 8px!important;
    font-size:10.5px!important;
  }
}
`;
  document.head.appendChild(s);
})();
