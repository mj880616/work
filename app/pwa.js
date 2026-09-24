if('serviceWorker' in navigator){
  const register=()=>navigator.serviceWorker.register('./sw.js?v=3',{scope:'./'}).catch(()=>{});
  if(document.readyState==='complete')register();
  else window.addEventListener('load',register,{once:true});
}
