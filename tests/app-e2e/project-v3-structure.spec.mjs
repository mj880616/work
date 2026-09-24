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
  expect(views).toContain("project-system-v3.js?v=21");
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
  expect(src).toContain('ps3-child-menu');
  expect(src).toContain("$('#ps3Hierarchy').innerHTML");
  expect(src).not.toContain('<div class="ps3-actions">${!par?childMenu');
  expect(src).toContain('data-ps3-doc-filter');
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
  expect(topbarCss).toContain('.top-actions #logoutBtn');
  expect(topbarCss).toContain('display:none!important');
  expect(topbar).toContain("logout.addEventListener");
  expect(topbar).not.toContain('ccMessageTop');
  const topbarImport=loader.indexOf("import('./topbar-actions.js");
  const teamImport=loader.indexOf("import('./team.js");
  expect(topbarImport).toBeGreaterThan(-1);
  expect(topbarImport).toBeLessThan(teamImport);
  expect(projectCss).toContain('app-icon.svg');
  expect(projectCss).toContain('#projectGrid[data-ps3-ready="1"]{display:grid}');
  expect(projectCss).not.toContain('#projectGrid>[data-project]');
});
