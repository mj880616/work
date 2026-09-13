(()=>{
  const leaf=document.querySelector('.brand .leaf');
  if(!leaf)return;
  const iconUrl='./app-icon.svg?v=20260913-2';
  leaf.innerHTML=`<img src="${iconUrl}" alt="공공기관사업팀"><span class="kptu-brand-fallback" aria-hidden="true">공공</span>`;
  leaf.classList.add('kptu-brand-mark');
  const img=leaf.querySelector('img');
  if(img){
    img.addEventListener('load',()=>leaf.classList.remove('is-icon-error'));
    img.addEventListener('error',()=>leaf.classList.add('is-icon-error'));
  }
  const s=document.createElement('style');
  s.textContent='.brand .kptu-brand-mark{width:36px;height:30px;display:grid;place-items:center;background:transparent;border:0;padding:0;overflow:visible;position:relative}.brand .kptu-brand-mark img{display:block;width:30px;height:30px;border-radius:7px;object-fit:cover}.brand .kptu-brand-fallback{display:none;width:30px;height:30px;border-radius:7px;background:#1d3557;color:#fff;place-items:center;font-size:9px;font-weight:900;letter-spacing:-.06em}.brand .kptu-brand-mark.is-icon-error img{display:none}.brand .kptu-brand-mark.is-icon-error .kptu-brand-fallback{display:grid}.brand:hover .kptu-brand-mark{border-color:transparent}@media(max-width:760px){.brand .kptu-brand-mark{width:34px;height:28px}.brand .kptu-brand-mark img,.brand .kptu-brand-fallback{width:28px;height:28px}}';
  document.head.appendChild(s);
})();
