const boot=()=>import('./team-member-overview.js?v=1').catch(console.error);
if(window.KPTURuntime)boot();else window.addEventListener('kptu:app-ui-ready',()=>setTimeout(boot,0),{once:true});
