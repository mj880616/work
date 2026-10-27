// 디자인 전수 점검 항목: 화면을 띄우는 방법(view·pre)·자를 곳(clip)·미리 넣어 볼 CSS(css). 문구는 findings.json으로 옮긴다.
const close="document.querySelectorAll('.modal').forEach(m=>m.classList.add('hidden'))";
export const ITEMS=[
{key:'profile-rows',w:1280,view:'profile',clip:'#profileView',css:`label:has(> input[type=checkbox]),label:has(> input[type=radio]){flex-direction:row;align-items:center;font-weight:400;margin:0}
#profileView .ps-calref-row{flex-direction:row}`},
{key:'title-dup',w:1280,view:'library',clip:'#libraryView',css:`#appView :is(#basketView .basket-head h2,#teamView .so-team-title,#profileView .ps-head h2,#libraryView .add-list-head h2,#hwpView .hwp-lab-head h2,#ledgerView .lb-h,#pagesView .sp-head h2,#telegramView .feed-head-title){display:none!important}
#libraryView .add-list-head{justify-content:flex-end}`},
{key:'title-dup-phone',w:390,view:'profile',css:`#appView :is(#profileView .ps-head h2,#libraryView .add-list-head h2,#telegramView .feed-head-title){display:none!important}`},
{key:'add-btn',w:1280,view:'pages',clip:'#pagesView',css:`#appView :is(#pagesView .sp-head button.primary,#ledgerView .lb-add,#calendarView #newEventBtn){background:var(--kptu-primary)!important;color:var(--kptu-on-primary)!important;border-color:transparent!important;height:32px!important;min-height:32px!important}
#pagesView .sp-head button.primary::before{content:"+ "}`},
{key:'nav-cut',w:1280,view:'home',clip:'#appView>.app-nav',css:`#appView>.app-nav .nav-btn{min-height:32px!important;height:32px!important;padding-top:0!important;padding-bottom:0!important}
#appView>.app-nav .nav-sub-btn{min-height:28px!important;height:28px!important;padding-top:0!important;padding-bottom:0!important}`},
{key:'phone-bottom',w:390,view:'calendar',pre:"scrollTo(0,document.documentElement.scrollHeight)",css:`@media(max-width:760px){#appView .view-panel:not(.hidden){padding-bottom:calc(56px + 40px + 52px + 16px)}}`},
{key:'phone-switch',w:390,view:'calendar',css:`@media(max-width:760px){#calendarView{display:flex;flex-direction:column}#calendarView .schedule-switch{position:sticky!important;top:0;bottom:auto!important;order:-1;z-index:5;margin:0 0 8px}}`},
{key:'section-title',w:1280,view:'team',pre:"document.querySelector('#teamView .kptu-list-row')?.click()",clip:'#wdModal .modal-card, #teamView',css:`#appView :is(.ps3-section-head h3,#wdModal h3,#journalView .journal-heading,#journalView .journal-weekly-sub){font-size:var(--ds-text-section)!important;font-weight:500!important;color:var(--ds-section-ink)}`},
{key:'heavy-weight',w:1280,view:'library',pre:"document.querySelector('#libraryView summary.lu-node-head')?.click()",clip:'#libraryListCard, #libraryView',css:`#appView :is(.lu-node-head[data-lu-top],#documentList .lu-node>summary.lu-node-head,.lu-row-title,.wd-basic-grid dt,.wd-summary-card span,.wd-aff-chip,.journal-heading,.journal-weekly-sub,.basket-link-menu button,.nav-btn,.cal-day){font-weight:500!important}`},
{key:'tiny-font',w:1280,view:'diary',clip:'#diaryView',css:`#appView :is(#diaryView button.mini,#libraryView .lu-file-kind,.wd-basic-grid dt,.wd-summary-card span,.wd-aff-chip,.library-upload-state,.cal-head,.cal-day){font-size:var(--ds-text-meta)!important}
#diaryView button.primary{height:32px;min-height:32px;font-size:13px}`},
{key:'row-heights',w:1280,view:'team',pre:"document.querySelector('#teamView .kptu-list-row')?.click()",clip:'#wdModal .wd-stage',pad:60,css:`#wdModal .wd-stage{align-items:center}
#wdModal .wd-stage :is(select,input,button){height:32px!important;min-height:32px!important;font-size:13px}`},
{key:'modal-input',w:1280,view:'calendar',pre:"document.querySelector('#newEventBtn')?.click()",clip:'#eventModal .modal-card',css:`.modal .modal-card :is(input:not([type=checkbox]):not([type=radio]):not([type=color]),select){height:36px!important;min-height:36px!important}
.modal .modal-card label{margin:6px 0}
.calendar-color-swatch{width:22px!important;height:22px!important;min-width:22px!important;min-height:22px!important}`},
{key:'swatch-phone',w:390,view:'calendar',pre:"document.querySelector('#newEventBtn')?.click()",css:`.calendar-color-swatch{width:24px!important;height:24px!important;min-width:24px!important;min-height:24px!important}
.modal .modal-card :is(input:not([type=checkbox]):not([type=radio]),select){height:36px!important;min-height:36px!important}`},
{key:'hint-text',w:1280,view:'library',pre:"document.querySelector('#newDocumentBtn')?.click()",clip:'#documentModal .modal-card',css:`.library-file-block>p,.gt-scope-note,.gt-pick-hint,.gt-links-hint,.hwp-lab-note,.sp-hint,.sp-canvas-cap{display:none!important}`},
{key:'empty-pane',w:1280,view:'calls',css:`.feed-pane:has(> .feed-pane-empty:only-child),.gt-pane:has(> .gt-pane-empty:only-child){visibility:hidden}`},
{key:'check-circle',w:390,view:'home',clip:'#homeView',css:`#appView .gt-check::before{width:16px!important;height:16px!important;border-width:1.5px!important;border-color:var(--kptu-muted)!important}`},
{key:'more-btn',w:1280,view:'library',pre:"document.querySelector('#libraryView summary.lu-node-head')?.click()",clip:'#libraryListCard, #libraryView',css:`#appView button:is(.icon-btn,.sp-row-more,.lu-more-trigger,.lu-node-more,.gt-menu-trigger,.feed-more,.mcol-more),#appView summary.icon-btn{font-size:16px!important;color:var(--kptu-muted)!important;letter-spacing:0}`},
{key:'chip-style',w:1280,view:'team',pre:"document.querySelector('#teamView .kptu-list-row')?.click()",clip:'#wdModal .modal-card, #teamView',css:`html .doc-kind-chips button:not([aria-pressed=true]){background:var(--kptu-surface)!important;border:.5px solid var(--ds-line)!important;color:var(--kptu-muted)!important}
html .doc-kind-chips button[aria-pressed=true]{background:var(--kptu-primary-soft)!important;color:var(--kptu-primary-ink)!important;border-color:transparent!important}
#appView .feed-chip{border-radius:999px!important}`},
{key:'multi-chip',w:1280,view:'library',clip:'#libraryView',css:`#libraryView .lu-filter-row .quick-pill-button[aria-pressed=true]{background:var(--kptu-primary-soft)!important;color:var(--kptu-primary-ink)!important;border-color:transparent!important}
#libraryView .lu-filter-row .quick-pill-button[aria-pressed=mixed]{background:var(--kptu-surface)!important}`},
{key:'basket-rows',w:1280,view:'basket',clip:'#basketView',css:`#basketView .basket-row{grid-template-columns:1fr auto;column-gap:8px}
#basketView .basket-row>.basket-title{grid-column:1/-1}
#basketView .basket-row>time{grid-column:1;justify-self:start}
#basketView .basket-row>time+span{grid-column:2;grid-row:auto;justify-self:end}`},
{key:'wide-width',w:1920,view:'ledger',css:`@media(min-width:1024px){#appView .lg-root,#basketView,#profileView .ps-profile-grid,#profileView .ps-head{max-width:1100px!important}}`},
{key:'wide-gutter',w:1920,view:'basket',css:`@media(min-width:1024px){#appView #basketView{max-width:none!important}}`},
{key:'mobile-menu',w:390,view:'home',pre:"document.querySelector('#mobileMenuTab')?.click()",css:`#mobileMenu nav{grid-template-columns:repeat(3,1fr)!important;gap:4px!important}
#mobileMenu nav button{min-height:40px!important;height:40px!important;flex-direction:row!important;gap:6px!important;padding:0 8px!important;justify-content:flex-start!important}
#mobileMenu nav button svg{width:16px;height:16px}
#mobileMenu :focus-visible{outline:2px solid var(--kptu-primary-soft)!important;outline-offset:-2px}`},
{key:'menu-items',w:1280,view:'tasks',pre:"document.querySelector('.gt-menu-trigger')?.click()",css:`@media(min-width:1024px){:is(#gtTaskMenu,.basket-link-menu,.account-panel,.lu-more-panel,.ps3-more-panel) button{height:32px!important;min-height:32px!important;font-weight:400!important;font-size:13px!important}}`},
{key:'home-quick',w:1280,view:'home',clip:'#homeView',css:`#homeView .home-basket-link{min-height:24px!important;height:24px!important;width:auto!important;margin-left:auto}
#homeView .home-card > header,#homeView .home-card h3{min-height:0}`},
{key:'google-panel',w:1280,view:'calendar',clip:'#calendarView',css:`#calendarView .calendar-google-panel{display:none}`},
{key:'tasks-cards',w:1280,view:'tasks',clip:'#tasksView',css:`#tasksView .gt-row.gt-card{background:transparent!important;border-radius:0!important;border-bottom:.5px solid var(--kptu-border)}
#tasksView .gt-info{width:28px!important;height:28px!important;min-height:28px!important;font-size:14px!important}`},
{key:'meet-boxes',w:1280,view:'meetings',clip:'#meetingsView',css:`#meetingsView .meeting-columns{border:0!important;background:transparent!important;padding:0!important;box-shadow:none!important}
#meetingsView .mcol-layout.mcol-three{grid-template-columns:minmax(200px,1fr) minmax(200px,1fr) 3fr!important}`},
{key:'chip-cut',w:390,view:'library',clip:'#libraryView',css:`@media(max-width:760px){#appView :is(#libraryView .lu-filter-row,#meetingsView .filter-chips){-webkit-mask-image:linear-gradient(90deg,#000 88%,transparent);mask-image:linear-gradient(90deg,#000 88%,transparent)}}`},
{key:'journal-days',w:1280,view:'journal',clip:'#journalView',css:`#journalView .journal-date{height:40px!important;min-height:40px!important;padding:2px 0!important}`},
{key:'diary-cells',w:1920,view:'diary',css:`#diaryView .diary-cell{height:64px!important;min-height:0!important}`},
{key:'plus-btn',w:1280,view:'projects',clip:'#ps3DetailPane, #projectsView',css:`#appView .ps3-add-plus{width:28px!important;height:28px!important;min-width:28px!important;min-height:28px!important;font-size:16px!important}`},
{key:'sp-settings',w:1280,view:'pages',pre:"document.querySelector('#pagesView .sp-row')?.click()",clip:'#pagesView',css:`#pagesView .sp-settings{display:flex;align-items:flex-end;gap:8px}
#pagesView .sp-settings label{margin:0}
#pagesView .sp-input{height:32px!important;min-height:32px!important;padding-top:0!important;padding-bottom:0!important;line-height:30px!important}
#pagesView .sp-save-row{position:sticky;top:0;z-index:3}`},
{key:'meeting-modal',w:1280,view:'meetings',pre:"document.querySelector('#newMeetingBtn')?.click()",clip:'#meetingModal .modal-card',css:`#meetingModal .modal-card{max-width:720px!important}
#meetingModal :is(input:not([type=checkbox]),select){height:36px!important;min-height:36px!important}`},
{key:'meeting-delete',w:390,view:'meetings',pre:"document.querySelector('#meetingsView .meeting-list-row')?.click()",css:``},
{key:'ledger-phone',w:390,view:'ledger',clip:'#ledgerView',css:`@media(max-width:760px){#ledgerView .lb-cond-btn,#ledgerView .lb-add{padding:0 8px!important;white-space:nowrap}#ledgerView .lb-add{font-size:0!important;width:32px}#ledgerView .lb-add::before{content:"+";font-size:16px}}`},
{key:'basket-input',w:1280,view:'basket',clip:'#basketView',css:`#basketView textarea:not(:focus){height:36px!important;min-height:36px!important;resize:none}`},
{key:'trash',w:1280,view:'projects',pre:"(async()=>{const b=document.querySelector('#ps3ArchiveBtn');b&&(b.hidden=false,b.click());await new Promise(r=>setTimeout(r,700));document.querySelector('[data-ps3-archive-tab=trash]')?.click()})()",clip:'#ps3ArchiveModal .modal-card',css:`#ps3ArchiveModal [data-ps3-archive-hint]{display:none}
#ps3ArchiveModal .ps3-trash-line{min-height:36px;align-items:center}
#ps3ArchiveModal .ps3-trash-line .ps3-prow-main{flex:1;min-width:0}
#ps3ArchiveModal .ps3-trash-line .kptu-list-row-main{display:flex!important;flex-direction:column!important;align-items:flex-start!important;text-align:left!important;gap:0}
#ps3ArchiveModal .ps3-trash-line .ps3-prow-meta{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#ps3ArchiveModal .ps3-trash-line .ps3-prow-main{padding-left:12px}
#ps3ArchiveModal .ps3-trash-line .ps3-prow-name{font-size:13px!important;font-weight:500!important;width:auto!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#ps3ArchiveModal .ps3-trash-line .ps3-prow-meta{font-size:12px}
#ps3ArchiveModal .ps3-prow-restore{height:28px;min-height:28px;flex:none}`},
{key:'focus-ring',w:390,view:'home',pre:"document.querySelector('[aria-controls=themeModal]')?.click()",css:`:is(.modal,#mobileMenu,#ps3ArchiveModal,#themeModal) :focus-visible{outline:2px solid var(--kptu-primary-soft)!important;outline-offset:-2px;box-shadow:none!important}`},
{key:'home-summary',w:390,view:'home',clip:'#homeView',css:`@media(max-width:760px){#homeView .home-summary{display:none}}`},
];
