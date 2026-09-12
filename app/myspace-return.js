function patchMyWorkLink(){
  const root=document.querySelector('#mySpaceLinks');
  if(!root)return;
  const links=[...root.querySelectorAll('a.project-card')];
  const target=links.find(a=>a.querySelector('h3')?.textContent?.trim()==='내 업무 현황');
  if(target&&target.getAttribute('href')!=='./my-work.html')target.setAttribute('href','./my-work.html');
}
function install(){
  const root=document.querySelector('#mySpaceLinks');
  if(!root)return false;
  patchMyWorkLink();
  new MutationObserver(patchMyWorkLink).observe(root,{childList:true,subtree:true});
  return true;
}
if(!install()){
  const timer=setInterval(()=>{if(install())clearInterval(timer)},100);
  setTimeout(()=>clearInterval(timer),10000);
}
