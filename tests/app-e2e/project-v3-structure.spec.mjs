import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here=dirname(fileURLToPath(import.meta.url));
const read=path=>readFileSync(resolve(here,'../..',path),'utf8');

test('project view has one active renderer and no legacy overlay chain', async () => {
  const loader=read('app/loader-v2.js');
  const views=read('app/view-loader.js');
  const html=read('app/index.html');
  const team=read('app/team.js');
  expect(views).toContain("project-system-v3.js?v=25");
  for(const legacy of [
    'project-system-v2.js','project-hide-legacy.js','project-files.js','project-delete.js',
    'project-modal-polish.js','project-modal-scroll-lock.js','project-access.js',
    'project-update-actions.js','project-task-link.js','project-v2.js','project-operating-model.js',
    'project-templates.js','project-deeplink.js','project-archive.js','project-suborganization-links.js'
  ]) {expect(loader).not.toContain(legacy);expect(views).not.toContain(legacy)}
  expect(html).not.toContain('id="projectModal"');
  expect(html).not.toContain('id="projectCreateModal"');
  expect(team).not.toContain('renderProjects');
  expect(team).not.toContain('openProject(');
  expect(team).not.toContain('app_project_updates');
  expect(team).not.toContain('app_project_checkitems');
});

test('project V3 includes the complete management actions in its own renderer', async () => {
  const src=read('app/project-system-v3.js');
  expect(src).toContain('data-ps3-delete-project');
  expect(src).toContain('data-ps3-edit-project');
  expect(src).toContain('data-ps3-archive-project');
  expect(src).toContain('data-ps3-restore');
  expect(src).toContain('data-ps3-edit-milestone');
  expect(src).toContain('ps3MilestoneDelete');
  expect(src).toContain('data-ps3-library');
  expect(src).toContain('ps3-parent-link');
  expect(src).toContain("$('#ps3Hierarchy').innerHTML");
  expect(src).toContain('id="ps3-children"');
  expect(src).toContain('data-ps3-child');
  expect(src).toContain('ps3-more');
  expect(src).toContain('data-ps3-quick-progress');
  expect(src).not.toContain('ps3-child-menu');
  expect(src).not.toContain('data-ps3-doc-filter');
  expect(src).not.toContain('data-ps3-nav');
  expect(src).not.toContain('ps3-child-section');
});

test('first paint uses final icon, topbar and direct project renderer styles', async () => {
  const html=read('app/index.html');
  const styles=read('app/styles.css');
  const loader=read('app/loader-v2.js');
  const topbar=read('app/topbar-actions.js');
  const topbarCss=read('app/topbar-actions.css');
  const projectCss=read('app/project-system-v3.css');
  expect(html).toMatch(/rel="icon" href="\.\/app-icon\.svg\?v=[\w-]+"/);
  expect(html).not.toContain('href="../favicon.svg"');
  expect(html).not.toContain('<span class="leaf">⌁</span>');
  expect(html).toContain('id="newProjectBtn"');
  expect(styles).toContain('topbar-actions.css');
  expect(styles).toContain('project-system-v3.css');
  expect(topbarCss).toContain('[data-kptu-logout]');
  expect(topbarCss).toContain('display:none!important');
  expect(topbar).toContain("logoutButtons.forEach");
  expect(topbar).not.toContain('ccMessageTop');
  const topbarImport=loader.indexOf("import('./topbar-actions.js");
  const teamImport=loader.indexOf("import('./team.js");
  expect(topbarImport).toBeGreaterThan(-1);
  expect(topbarImport).toBeLessThan(teamImport);
  expect(projectCss).toContain('app-icon.svg');
  expect(projectCss).toContain('#projectGrid[data-ps3-ready="1"]{display:grid}');
  expect(projectCss).not.toContain('#projectGrid>[data-project]');
});

test('project screen and library share one canonical project catalog', async () => {
  const views=read('app/view-loader.js');
  const catalog=read('app/project-catalog.js');
  const project=read('app/project-system-v3.js');
  const library=read('app/library-upload.js');
  const team=read('app/team.js');
  const projectsBlock=views.slice(views.indexOf('async function projects()'),views.indexOf('async function library()'));
  const libraryBlock=views.slice(views.indexOf('async function library()'),views.indexOf('async function meetings()'));
  for(const block of [projectsBlock,libraryBlock])expect(block.indexOf("module('./project-catalog.js?v=1')")).toBeGreaterThan(-1);
  expect(projectsBlock.indexOf('project-catalog.js')).toBeLessThan(projectsBlock.indexOf('project-system-v3.js'));
  expect(libraryBlock.indexOf('project-catalog.js')).toBeLessThan(libraryBlock.indexOf('library-upload.js'));
  expect(catalog).toContain("metadata?.project_system==='v2'");
  expect(catalog).toContain('owner_id=eq.');
  for(const source of [project,library]){
    expect(source).not.toContain("project_system==='v2'");
    expect(source).toContain('KPTUProjectCatalog');
  }
  expect(project).not.toContain('/rest/v1/app_spaces?workspace_id');
  expect(library).not.toContain('/rest/v1/app_spaces');
  expect(library).not.toContain('KPTUTeamData');
  // The library owns its project selectors and list; team.js must not compete as a second renderer.
  expect(team).not.toMatch(/\['eventProject','docProject'/);
  expect(team).not.toContain("$('#documentProject').innerHTML");
  expect(team).toContain('window.KPTULibrary?.render');
});
