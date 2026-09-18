(()=>{'use strict';if(window.KPTUWeb1Capabilities)return;
const PUBLIC_EDIT=new Set(['/work/2in1/','/work/workforce/joint-struggle-0921/']);
const PARENTS=[
  [/^\/work\/2in1\/field-testimony-1002\/?$/,'/work/2in1/'],
  [/^\/work\/workforce\/press-conference-0914\//,'/work/workforce/press-conference-0914/'],
  [/^\/work\/p\/(gimpo-publicization|line9-publicization)-[^/]+\/?$/,'/work/private-rail/'],
  [/^\/work\/rail-council\/[^/]+\/?$/,'/work/rail-council/']
];
function canonical(pathname){let p=String(pathname||location.pathname);if(!p.endsWith('/'))p+='/';return p}
function resolve(pathname){const path=canonical(pathname);let backHref='/work/';for(const [re,target] of PARENTS){if(re.test(path)){backHref=target;break}}return {path,publicEdit:PUBLIC_EDIT.has(path),backHref}}
window.KPTUWeb1Capabilities={resolve,publicEditPaths:[...PUBLIC_EDIT]};})();