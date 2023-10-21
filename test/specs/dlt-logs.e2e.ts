import * as chai from 'chai';
import { chaiImage } from 'chai-image';
import * as fs from 'fs';

import { browser } from '@wdio/globals';

chai.use(chaiImage);

import { writeFileSync } from 'fs';
import { CustomTreeSection, InputBox, sleep, CustomTreeItem, ExtensionsViewItem } from 'wdio-vscode-service';

//import { ReportWebView } from '../pageobjects/report.js';
import { ReportWebView } from '../pageobjects/report.js';

describe('WDIO VSCode Service', () => {
  it('should be able to load VSCode', async () => {
    const workbench = await browser.getWorkbench();
    expect(await workbench.getTitleBar().getTitle()).toBe('[Extension Development Host] Visual Studio Code');
  });

  it('can open extension view and check that first installed extension is our DLT-Logs', async () => {
    const workbench = await browser.getWorkbench();
    const extensionView = await workbench.getActivityBar().getViewControl('Extensions');
    await extensionView?.openView();

    const selectedView = await workbench.getActivityBar().getSelectedViewAction();
    expect(await selectedView.getTitle()).toBe('Extensions');

    const sidebar = workbench.getSideBar();
    const sidebarView = sidebar.getContent();
    const extensionViewSection = await sidebarView.getSection('INSTALLED');

    /**
     * for some reason the developed extension doesn't show up
     * in the installed extension section when running in a
     * prestine environmnet
     */
    const installedExtensions = (await extensionViewSection.getVisibleItems()) as ExtensionsViewItem[];
    expect(await installedExtensions[0].getTitle()).toBe('DLT-Logs');
  });
});

describe('DLT-Logs extension basic features', () => {
  it('can open a simple dlt file', async () => {
    const workbench = await browser.getWorkbench();
    await workbench.executeCommand('Open dlt file...');

    const inputBox = new InputBox(workbench.locatorMap);
    await inputBox.wait();
    await sleep(1000);
    // const inputTextDef = await inputBox.getText();
    // expect(inputTextDef).toEqual(`/Users/mbehr/`);
    /*const placeholderChars = (await inputBox.getPlaceHolder()).length;
    for (let index = 0; index < placeholderChars; index++) {
      await inputBox.clear();
    }*/

    await inputBox.setText(`/develop/vscode/dlt-logs/src/test/01_cpu_mon.dlt`);
    // const inputText = await inputBox.getText();
    // expect(inputText).toEqual(`/Users/mbehr/develop/vscode/dlt-logs/src/test/01_cpu_mon.dlt`);

    await inputBox.confirm();
    await sleep(1000);

    // check that text is there:
    const editorView = workbench.getEditorView();
    const openEditorTitles = await editorView.getOpenEditorTitles();
    expect(openEditorTitles).toContain('01_cpu_mon.dlt');
  });

  it('should be able to close notifications', async () => {
    const workbench = await browser.getWorkbench();
    const notifs = await workbench.getNotifications();
    for (const notif of notifs) {
      await notif.dismiss();
    }
    expect(await workbench.hasNotifications()).toBe(false);
  });

  it('has a treeview', async () => {
    const workbench = await browser.getWorkbench();
    const activityBar = workbench.getActivityBar();
    await sleep(500); // give some time to change to Logs... (todo retry for some time until it shows Logs)
    const selectedView = await activityBar.getSelectedViewAction();
    expect(await selectedView.getTitle()).toEqual('Logs');

    const sideBar = workbench.getSideBar();
    const titlePart = sideBar.getTitlePart();
    expect(await titlePart.getTitle()).toEqual('LOGS (SMART-/DLT-LOGS): DLT-LOGS EXPLORER');

    const logViewContent = await sideBar.getContent();
    {
      const html = await logViewContent.elem.getHTML();
      writeFileSync('test/test_sideBar_getContent.html', html);
    }
    const sections = await logViewContent.getSections();
    for (const section of sections) {
      expect(section).toBeInstanceOf(CustomTreeSection);
      const title = await section.getTitle();
      expect(title).not.toBeNull();
      expect(title).toBe('DLT-Logs Explorer');
    }

    expect(sections.length).toBe(1);

    const logSection = sections[0] as CustomTreeSection; // todo issue #40? await (sideBar.getContent().getSection('DLT-Logs Explorer')) as CustomTreeSection;
    expect(logSection).toBeInstanceOf(CustomTreeSection);
    await sleep(500); // give some time to expand tree view (todo retry for some time until it has expanded)
    const visibleItems = await logSection.getVisibleItems();
    expect(visibleItems.length).toEqual(4);
    expect(await visibleItems[0].getLabel()).toEqual('01_cpu_mon.dlt');
    await visibleItems[0].expand();
    let filterItem = (await visibleItems[0].findChildItem('Filters')) as CustomTreeItem;
    expect(filterItem).toBeDefined();
    expect(filterItem).toBeInstanceOf(CustomTreeItem);
    if (filterItem !== undefined) {
      expect(await filterItem.getLabel()).toEqual('Filters');
      await filterItem.wait();
      expect(await filterItem.getTooltip()).toEqual('Filters ');
      expect(await filterItem.isExpanded()).toEqual(false);
      expect(await filterItem.isExpandable()).toEqual(true);
      await filterItem.expand();
      expect(await filterItem.isExpanded()).toEqual(true);
      expect(await filterItem.hasChildren()).toEqual(true);
      const filters = (await filterItem.getChildren()) as CustomTreeItem[];
      expect(filters.length).toEqual(1);
      const filter = filters[0];
      expect(filter).toBeInstanceOf(CustomTreeItem);
      await filters[0].wait();
      await filter.select();
      expect(await filter.getLabel()).toMatch(/^CPU load @/);

      const buttons = await filter.getActionButtons();
      expect(buttons.length).toEqual(2);
      expect(await buttons[0].getLabel()).toMatch(/^open report\n/);
      await buttons[0].elem.click();

      const webviews = await workbench.getAllWebviews();
      expect(webviews.length).toEqual(1);
      const webview = webviews[0];
      await webview.wait();
      // wait for content...
      await sleep(1000);
      await (await webview.elem).saveScreenshot(`test/screenshots/webview_basic_1.png`);
      // compare report:
      {
        const expected = fs.readFileSync('test/specs/webview_basic_1.png');
        const current = fs.readFileSync('test/screenshots/webview_basic_1.png');
        chai.expect(current).to.matchImage(expected, { output: { name: 'webview_basic_1', dir: 'test/screenshots' } });
      }
      // can be used as ReportWebView
      const report = new ReportWebView(webview);
      await report.open();
      expect(await (await report.filenames$).getText()).toMatch(/ 01_cpu_mon\.dlt$/);
      // can toggle the lifecycle start checkbox
      await report.toggleLifecycleStartCheckbox();
      await report.close();
      await (await webview.elem).saveScreenshot(`test/screenshots/webview_basic_2.png`);

      // compare report:
      {
        const expected = fs.readFileSync('test/specs/webview_basic_2.png');
        const current = fs.readFileSync('test/screenshots/webview_basic_2.png');
        chai.expect(current).to.matchImage(expected, { output: { name: 'webview_basic_2', dir: 'test/screenshots' } });
      }
    }
  });
});
