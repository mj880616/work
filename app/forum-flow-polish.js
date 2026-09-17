(()=>{
  'use strict';
  if(location.pathname.includes('/p/private-rail-forum-0929-prep/')){
    const tools=document.querySelector('.print-tools');
    if(tools&&!document.querySelector('#privateRailStatusBackLink')){
      const a=document.createElement('a');
      a.id='privateRailStatusBackLink';
      a.className='print-btn back-link';
      a.href='/work/private-rail/';
      a.textContent='← 민자철도 사업현황';
      a.style.marginRight='auto';
      tools.prepend(a);
    }
  }
})();
