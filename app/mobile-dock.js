(() => {
  if (document.querySelector('#ccMobileDock')) return;
  const dock = document.createElement('nav');
  dock.id = 'ccMobileDock';
  dock.className = 'cc-mobile-dock';
  dock.setAttribute('aria-label', '모바일 바로가기');
  dock.innerHTML = '<button data-cc-view="home" type="button"><span class="cc-dock-icon" aria-hidden="true">⌂</span><span>홈</span></button><button data-cc-view="profile" type="button"><span class="cc-dock-icon" aria-hidden="true">○</span><span>프로필</span></button>';
  document.body.appendChild(dock);
  const current = window.KPTURouter?.current;
  if (current) {
    dock.querySelector(`[data-cc-view="${current}"]`)?.classList.add('active');
    window.KPTURouter.keepActiveNavigationVisible(current, {behavior: 'auto'});
  }
})();
