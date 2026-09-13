(()=>{
  const leaf=document.querySelector('.brand .leaf');
  if(!leaf)return;
  const iconUrl='./app-icon.svg?v=20260913-3';
  leaf.innerHTML=`<img src="${iconUrl}" alt="공공기관사업팀 Workspace"><span class="kptu-brand-fallback" aria-hidden="true">공공</span>`;
  leaf.classList.add('kptu-brand-mark');
  const img=leaf.querySelector('img');
  if(img){
    img.addEventListener('load',()=>leaf.classList.remove('is-icon-error'));
    img.addEventListener('error',()=>leaf.classList.add('is-icon-error'));
  }
  const s=document.createElement('style');
  s.textContent='.brand .kptu-brand-mark{width:40px;height:36px;display:grid;place-items:center;background:transparent;border:0;padding:0;overflow:visible;position:relative}.brand .kptu-brand-mark img{display:block;width:36px;height:36px;border-radius:8px;object-fit:contain}.brand .kptu-brand-fallback{display:none;width:34px;height:34px;border-radius:8px;background:#fff;border:1px solid #e4e8ed;color:#0c376f;place-items:center;font-size:9px;font-weight:900;letter-spacing:-.06em}.brand .kptu-brand-mark.is-icon-error img{display:none}.brand .kptu-brand-mark.is-icon-error .kptu-brand-fallback{display:grid}.brand:hover .kptu-brand-mark{border-color:transparent}@media(max-width:760px){.brand .kptu-brand-mark{width:38px;height:34px}.brand .kptu-brand-mark img{width:34px;height:34px}.brand .kptu-brand-fallback{width:32px;height:32px}}';
  document.head.appendChild(s);
})();
