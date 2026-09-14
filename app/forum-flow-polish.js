(()=>{
  if(document.querySelector('#forumFlowPolishStyle'))return;
  const s=document.createElement('style');
  s.id='forumFlowPolishStyle';
  s.textContent=`
    .pd-flow-branch{align-items:stretch!important}
    .pd-flow-track{display:flex!important;flex-direction:column!important;height:100%!important}
    .pd-flow-problem{flex:1 1 auto!important;display:flex!important;flex-direction:column!important;justify-content:flex-start!important}
    .pd-flow-down{flex:0 0 auto!important}
    .pd-flow-solution{flex:0 0 76px!important;height:76px!important;display:flex!important;align-items:center!important;justify-content:center!important;box-sizing:border-box!important}
    .piv-actions .mini{display:inline-flex!important;align-items:center!important;justify-content:center!important;box-sizing:border-box!important;height:32px!important;min-width:58px!important;margin:0!important;padding:0 10px!important;border:1px solid #d7dfe5!important;border-radius:8px!important;background:#fff!important;color:#405161!important;text-decoration:none!important;font-size:12px!important;font-weight:800!important;line-height:1!important;font-family:inherit!important;appearance:none!important}
    .piv-actions .mini:hover{background:#f6f8fa!important;border-color:#c7d1da!important;color:#263b4d!important}
    @media(max-width:700px){
      .pd-flow-branch{grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important;gap:7px!important;align-items:stretch!important}
      .pd-flow-track{min-width:0!important}
      .pd-flow-problem,.pd-flow-solution{font-size:11.5px!important;line-height:1.38!important;padding-left:7px!important;padding-right:7px!important}
      .pd-flow-solution{flex-basis:88px!important;height:88px!important}
      .pd-flow-note{font-size:10px!important;line-height:1.4!important}
    }
  `;
  document.head.appendChild(s);
})();