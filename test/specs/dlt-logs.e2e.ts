import * as chai from 'chai';
import { chaiImage } from 'chai-image';
import * as fs from 'fs';

import { browser, expect } from '@wdio/globals'

chai.use(chaiImage)

import { writeFileSync } from 'fs'
import { CustomTreeSection, InputBox, sleep, CustomTreeItem, ExtensionsViewItem } from 'wdio-vscode-service'

import { ReportWebView } from '../pageobjects/report.js'

const isDltFileOpen = async () => {
  const workbench = await browser.getWorkbench()
  const editorView = workbench.getEditorView()
  const openEditorTitles = await editorView.getOpenEditorTitles()
  return openEditorTitles.includes('01_cpu_mon.dlt')
}

const openDltFile = async () => {
  const workbench = await browser.getWorkbench()

  const editorView = workbench.getEditorView()
  expect(await isDltFileOpen()).toBe(false)

  await workbench.executeCommand('dlt-logs.dltOpenFile')

  const inputBox = new InputBox(workbench.locatorMap)
  await inputBox.wait()
  await sleep(1000)

  const __dirname = process.cwd() // url.fileURLToPath(new URL('.', import.meta.url))
  await inputBox.setText(__dirname + `/src/test/01_cpu_mon.dlt`)

  await sleep(1000)

  await inputBox.confirm()
  await sleep(1000)
  if (await inputBox.elem.isDisplayed()) {
    await inputBox.confirm()
    await sleep(1000)
  }

  {
    const openEditorTitles = await editorView.getOpenEditorTitles()
    expect(openEditorTitles).toContain('01_cpu_mon.dlt')
  }
}

const closeDltFile = async () => {
  const workbench = await browser.getWorkbench()
  if (await isDltFileOpen()) {
    await workbench.executeCommand('workbench.action.closeActiveEditor')
  }
  expect(await isDltFileOpen()).toBe(false)
}

const closeActiveEditor = async () => {
  browser.executeWorkbench(async (vscode, newConfigs: string[][]) => {
    vscode.commands.executeCommand('workbench.action.closeActiveEditor')
  })
}

const getLogsTreeViewItem = async (treeItemName: string) => {
  const workbench = await browser.getWorkbench()
  const sideBar = workbench.getSideBar()
  const sideBarContent = await sideBar.getContent()
  const sections = await sideBarContent.getSections()
  expect(sections.length).toBe(1)
  const logSection = sections[0] as CustomTreeSection
  expect(logSection).toBeInstanceOf(CustomTreeSection)
  const visibleItems = await logSection.getVisibleItems()
  expect(visibleItems.length).toBeGreaterThan(0)
  expect(await visibleItems[0].getLabel()).toEqual('01_cpu_mon.dlt')
  await visibleItems[0].expand()
  let item = (await visibleItems[0].findChildItem(treeItemName)) as CustomTreeItem
  // caller should check expect(item).toBeDefined()
  return item
}

const getFilterByCriteria = async (idxOrLabel: number | string) => {
  const filtersItem = await getLogsTreeViewItem('Filters')
  if (filtersItem !== undefined) {
    await filtersItem.wait()
    expect(await filtersItem.getLabel()).toEqual('Filters')
    if (!(await filtersItem.isExpanded())) {
      await filtersItem.expand()
    }
    expect(await filtersItem.isExpanded()).toEqual(true)
    expect(await filtersItem.hasChildren()).toEqual(true)
    const filters = (await filtersItem.getChildren()) as CustomTreeItem[]
    if (typeof idxOrLabel === 'number') {
      return filters[idxOrLabel]
    } else {
      return filters.find(async (filter) => (await filter.getLabel()).startsWith(idxOrLabel))
    }
  }
  return undefined
}

const isFilterEnabled = async (filter: CustomTreeItem) => {
  const label = await filter.elem.getAttribute('aria-label')
  return !label.startsWith('disabled:')
}

const getNrOfMsgs = async (): Promise<{ filtered: number; all: number }> => {
  const workbench = await browser.getWorkbench()
  const statusbar = workbench.getStatusBar()
  const items = await statusbar.getItems()
  // console.log('statusbar items:', items)
  const dltMsgs = items.find((item) => item.match(/^(.+?) msgs/) !== null)
  if (dltMsgs !== undefined) {
    //console.log('dltMsgs:', dltMsgs)
    const nrLogsText = dltMsgs.match(/^(.+?) msgs/)
    //console.log('nrLogsText:', nrLogsText)
    const nrLogs = nrLogsText !== null ? nrLogsText[1].split('/') : undefined
    //console.log('nrLogs:', nrLogs)
    const filtered = nrLogs !== undefined ? (nrLogs.length === 2 ? parseInt(nrLogs![0]) : parseInt(nrLogs![0])) : -1
    const all = nrLogs !== undefined ? (nrLogs.length === 2 ? parseInt(nrLogs![1]) : parseInt(nrLogs![0])) : -1
    console.log(`getNrOfMsgs filtered:${filtered}, all:${all}`)
    return { filtered, all }
  }
  return { filtered: -1, all: -1 }
}

describe('WDIO VSCode Service', () => {
  it('should be able to load VSCode', async () => {
    const workbench = await browser.getWorkbench()
    expect(await workbench.getTitleBar().getTitle()).toContain('[Extension Development Host]')
  })

  it('should use a specific window size for testing', async () => {
    const wbSize = await (await (await browser.getWorkbench()).elem).getSize()
    expect(wbSize.width).toBe(1728)
    expect(wbSize.height).toBe(1040)

    const size = await (await (await browser.getWorkbench()).getSideBar().elem).getSize()
    expect(size.width).toBe(300)
    expect(size.height).toBe(983)
  })

  it.skip('can open extension view and check that first installed extension is our DLT-Logs', async () => {
    const workbench = await browser.getWorkbench()
    const extensionView = await workbench.getActivityBar().getViewControl('Extensions')
    expect(extensionView).toBeDefined()
    await extensionView?.openView()

    const selectedView = await workbench.getActivityBar().getSelectedViewAction()
    expect(await selectedView.getTitle()).toBe('Extensions')

    const sidebar = workbench.getSideBar()
    const sidebarView = sidebar.getContent()
    const extensionViewSection = await sidebarView.getSection('INSTALLED')

    /**
     * for some reason the developed extension doesn't show up
     * in the installed extension section when running in a
     * prestine environmnet
     */
    const installedExtensions = (await extensionViewSection.getVisibleItems()) as ExtensionsViewItem[]
    expect(await installedExtensions[0].getTitle()).toBe('DLT-Logs')
  })
})

describe('DLT-Logs extension basic features', () => {
  it('can open a simple dlt file', async () => {
    const workbench = await browser.getWorkbench()
    await workbench.executeCommand('dlt-logs.dltOpenFile')

    const inputBox = new InputBox(workbench.locatorMap)
    await inputBox.wait()
    await sleep(1000)

    //await workbench.elem.saveScreenshot(`test/screenshots/log_s01.png`)
    // const inputTextDef = await inputBox.getText();
    // expect(inputTextDef).toEqual(`/Users/mbehr/`);
    /*const placeholderChars = (await inputBox.getPlaceHolder()).length;
    for (let index = 0; index < placeholderChars; index++) {
      await inputBox.clear();
    }*/

    // const inputTextDef = await inputBox.getText()
    //await inputBox.setText(inputTextDef + `develop/vscode/dlt-logs/src/test/01_cpu_mon.dlt`)
    const __dirname = process.cwd() // url.fileURLToPath(new URL('.', import.meta.url))
    await inputBox.setText(__dirname + `/src/test/01_cpu_mon.dlt`)
    // const inputText = await inputBox.getText();
    // expect(inputText).toEqual(`/Users/mbehr/develop/vscode/dlt-logs/src/test/01_cpu_mon.dlt`);

    await sleep(1000)
    //await workbench.elem.saveScreenshot(`test/screenshots/log_s02.png`)

    await inputBox.confirm()
    await sleep(1000)
    if (await inputBox.elem.isDisplayed()) {
      //await workbench.elem.saveScreenshot(`test/screenshots/log_s03a.png`)
      await inputBox.confirm()
      await sleep(1000)
    }
    //await workbench.elem.saveScreenshot(`test/screenshots/log_s03.png`)

    // check that text is there:
    const editorView = workbench.getEditorView()
    const openEditorTitles = await editorView.getOpenEditorTitles()
    expect(openEditorTitles).toContain('01_cpu_mon.dlt')
  })

  it('should be able to close notifications', async () => {
    const workbench = await browser.getWorkbench()
    const notifs = await workbench.getNotifications()
    for (const notif of notifs) {
      await notif.dismiss()
    }
    expect(await workbench.hasNotifications()).toBe(false)
  })

  it('has a treeview', async () => {
    const workbench = await browser.getWorkbench()
    const activityBar = workbench.getActivityBar()
    await sleep(500) // give some time to change to Logs... (todo retry for some time until it shows Logs)
    const selectedView = await activityBar.getSelectedViewAction()
    //await workbench.elem.saveScreenshot(`test/screenshots/log_s10.png`)
    expect(await selectedView.getTitle()).toEqual('Logs')

    const sideBar = workbench.getSideBar()
    const titlePart = sideBar.getTitlePart()
    expect(await titlePart.getTitle()).toEqual('LOGS (SMART-/DLT-LOGS): DLT-LOGS EXPLORER')
    //await workbench.elem.saveScreenshot(`test/screenshots/log_s11.png`)

    const logViewContent = await sideBar.getContent()
    if (false) {
      const html = await logViewContent.elem.getHTML()
      writeFileSync('test/test_sideBar_getContent.html', html)
    }
    const sections = await logViewContent.getSections()
    for (const section of sections) {
      expect(section).toBeInstanceOf(CustomTreeSection)
      const title = await section.getTitle()
      if (title !== null) {
        // expect(title).not.toBeNull()
        expect(title).toBe('DLT-Logs Explorer')
      }
    }

    expect(sections.length).toBe(1)

    const logSection = sections[0] as CustomTreeSection // todo issue #40? await (sideBar.getContent().getSection('DLT-Logs Explorer')) as CustomTreeSection;
    expect(logSection).toBeInstanceOf(CustomTreeSection)
    await sleep(500) // give some time to expand tree view (todo retry for some time until it has expanded)
    const visibleItems = await logSection.getVisibleItems()
    expect(visibleItems.length).toEqual(5)
    expect(await visibleItems[0].getLabel()).toEqual('01_cpu_mon.dlt')
    //await workbench.elem.saveScreenshot(`test/screenshots/log_s12.png`)
    await visibleItems[0].expand()
    let filterItem = (await visibleItems[0].findChildItem('Filters')) as CustomTreeItem
    expect(filterItem).toBeDefined()
    //await workbench.elem.saveScreenshot(`test/screenshots/log_s13.png`)
    expect(filterItem).toBeInstanceOf(CustomTreeItem)
    if (filterItem !== undefined) {
      expect(await filterItem.getLabel()).toEqual('Filters')
      await filterItem.wait()
      expect(await filterItem.getTooltip()).toEqual('Filters ')
      expect(await filterItem.isExpanded()).toEqual(false)
      expect(await filterItem.isExpandable()).toEqual(true)
      await filterItem.expand()
      expect(await filterItem.isExpanded()).toEqual(true)
      expect(await filterItem.hasChildren()).toEqual(true)
      const filters = (await filterItem.getChildren()) as CustomTreeItem[]
      expect(filters.length).toEqual(2)
      const filter = filters[0]
      expect(filter).toBeInstanceOf(CustomTreeItem)
      await filter.wait()
      await filter.select()
      //await workbench.elem.saveScreenshot(`test/screenshots/log_s14.png`)
      expect(await filter.getLabel()).toMatch(/^CPU load @/)
      //await workbench.elem.saveScreenshot(`test/screenshots/log_s15.png`)
      const buttons = await filter.getActionButtons()
      // console.log('buttons:', await buttons[0].elem.getAttribute('aria-label'))
      expect(buttons.length).toEqual(2)
      expect(await buttons[0].elem.getAttribute('aria-label')).toMatch(/^open report\n/)
      //await workbench.elem.saveScreenshot(`test/screenshots/log_s16.png`)
      await buttons[0].elem.click()

      const webviews = await workbench.getAllWebviews()
      expect(webviews.length).toEqual(1)
      const webview = webviews[0]
      await webview.wait()
      // wait for content...
      await sleep(1000)
      await (await webview.elem).saveScreenshot(`test/screenshots/webview_basic_1.png`)
      // compare report:
      {
        const expected = fs.readFileSync('test/specs/webview_basic_1.png')
        const current = fs.readFileSync('test/screenshots/webview_basic_1.png')
        chai.expect(current).to.matchImage(expected, { output: { name: 'webview_basic_1', dir: 'test/screenshots' } })
      }
      // can be used as ReportWebView
      const report = new ReportWebView(webview)
      await report.open()
      expect(await (await report.filenames$).getText()).toMatch(/ 01_cpu_mon\.dlt$/)
      // can toggle the lifecycle start checkbox
      await report.toggleLifecycleStartCheckbox()
      await report.close()
      await(await webview.elem).saveScreenshot(`test/screenshots/webview_basic_2.png`)
      // compare report:
      {
        const expected = fs.readFileSync('test/specs/webview_basic_2.png')
        const current = fs.readFileSync('test/screenshots/webview_basic_2.png')
        chai.expect(current).to.matchImage(expected, { output: { name: 'webview_basic_2', dir: 'test/screenshots' } })
      }
      await closeActiveEditor()
    }
  })
})

// Configs tests:
// + a filter can be added to configs via settings
// - a filter can be added to configs via ui
// - a filter can be removed from configs
// + a filter part of a config is by default disabled
// + all filters of a config can be enabled via the configitem
// + all filters of a config can be disabled via the configitem
// - a config can be autoEnabled

const setFilterConfigs = (newConfigs: string[][]) =>
  browser.executeWorkbench(async (vscode, newConfigs: string[][]) => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    try {
      const config = vscode.workspace.getConfiguration('dlt-logs')
      console.log('config.filters:', config.inspect('filters'))
      const cfgFilters = config.get('filters')
      cfgFilters.forEach((filter: any, idx: number) => {
        if (idx < newConfigs.length) {
          filter.configs = newConfigs[idx]
        }
      })
      //cfgFilters.push({ type: 0, name: 'filter2', apid: 'MON', ctid: 'MEMS' })
      await config.update('filters', cfgFilters, true)
      vscode.window.showInformationMessage(`Updated ${newConfigs.length} filter configs`)
      await sleep(1000)
    } catch (err) {
      console.error('config.filters... error:', err)
      vscode.window.showInformationMessage(`Have error: ${err}`)
      await sleep(2000)
    }
  }, newConfigs)

describe('DLT-Logs extension basic features', () => {
  it('adds Configs to the treeview of an open file if a filter setting is changed to contain a config', async () => {
    // we expect the file to be opened
    if (!(await isDltFileOpen())) {
      await openDltFile()
    }
    const configsItemInitial = await getLogsTreeViewItem('Configs')
    expect(configsItemInitial).toBeUndefined()
    {
      // check that filter 2 is enabled
      const filter2 = await getFilterByCriteria(1)
      expect(filter2).toBeDefined()
      expect(await isFilterEnabled(filter2!)).toBe(true)
    }

    await setFilterConfigs([[], ['cfgl1/cfgl2/cfgl3', 'cfg2_1']])
    // we might need to wait a bit for the tree to update
    const workbench = await browser.getWorkbench()
    await sleep(1000)
    await workbench.elem.saveScreenshot(`test/screenshots/log_s20.png`)
    const configsItem = await getLogsTreeViewItem('Configs')
    //console.log('configsItems:', configsItem)
    expect(configsItem).toBeDefined()
    configsItem.expand()
    await sleep(100)
    await workbench.elem.saveScreenshot(`test/screenshots/log_s21.png`)
    {
      // check that filter 2 is now disabled
      const filter2 = await getFilterByCriteria(1)
      expect(filter2).toBeDefined()
      expect(await isFilterEnabled(filter2!)).toBe(false)
    }
  })
})

describe('DLT-Logs extension basic features', () => {
  it('adds Configs to the treeview at file open if settings contains a filter with a config', async () => {
    // we expect the file to be opened
    if (await isDltFileOpen()) {
      await closeDltFile()
    }

    await setFilterConfigs([[], ['cfgl1/cfgl2/cfgl3', 'cfg2_1']])
    // we might need to wait a bit for the tree to update
    const workbench = await browser.getWorkbench()
    if (!(await isDltFileOpen())) {
      await openDltFile()
    }
    await sleep(1000)
    await workbench.elem.saveScreenshot(`test/screenshots/log_s30.png`)
    const configsItem = await getLogsTreeViewItem('Configs')
    //console.log('configsItems:', configsItem)
    expect(configsItem).toBeDefined()
    configsItem.expand()
    await sleep(1000)
    await workbench.elem.saveScreenshot(`test/screenshots/log_s31.png`)
    {
      // check that filter 2 is now disabled
      const filter2 = await getFilterByCriteria(1)
      expect(filter2).toBeDefined()
      expect(await isFilterEnabled(filter2!)).toBe(false)
    }

    // now enable the a config:
    const cfgL1 = await configsItem.findChildItem('cfgl1')
    expect(cfgL1).toBeDefined()
    const cfgL2 = await cfgL1!.findChildItem('cfgl2')
    expect(cfgL2).toBeDefined()
    expect(cfgL2).toBeInstanceOf(CustomTreeItem)
    await cfgL2!.wait()
    await cfgL2!.select()
    const buttons = await cfgL2!.getActionButtons()
    expect(buttons.length).toEqual(2)
    expect(await buttons[0].elem.getAttribute('aria-label')).toMatch(/^adjust filter to provide more details/)

    // check nr of msgs shown from status bar
    // before click:
    await workbench.elem.saveScreenshot(`test/screenshots/log_s32.png`)
    const { filtered, all } = await getNrOfMsgs()
    await buttons[0].elem.click()
    await sleep(2000)
    const { filtered: filtered2, all: all2 } = await getNrOfMsgs()
    await workbench.elem.saveScreenshot(`test/screenshots/log_s33.png`)
    expect(all).toEqual(all2)
    expect(filtered2).toBeLessThan(filtered)
    await sleep(2000)

    // now disable the config:
    {
      const configsItem = await getLogsTreeViewItem('Configs')
      expect(configsItem).toBeDefined()
      await workbench.elem.saveScreenshot(`test/screenshots/log_s33a.png`)
      configsItem.expand()
      const cfgL1 = await configsItem.findChildItem('cfgl1')
      await cfgL1!.wait()
      await cfgL1!.select()
      await workbench.elem.saveScreenshot(`test/screenshots/log_s33b.png`)
      const buttonsL1 = await cfgL1!.getActionButtons()
      expect(buttonsL1.length).toEqual(2)
      const buttonL1Pause = buttonsL1[1]
      expect(buttonL1Pause).toBeDefined()
      await workbench.elem.saveScreenshot(`test/screenshots/log_s33c.png`)
      const buttonL1Label = await buttonL1Pause.elem.getAttribute('aria-label')
      console.log('buttonL1Label:', buttonL1Label)
      expect(buttonL1Label).toMatch(/^disable/)
      await workbench.elem.saveScreenshot(`test/screenshots/log_s33d.png`)
      await buttonL1Pause.elem.click()
      await sleep(2000)
      await workbench.elem.saveScreenshot(`test/screenshots/log_s33e.png`)
      const { filtered: filtered3, all: all3 } = await getNrOfMsgs()
      await workbench.elem.saveScreenshot(`test/screenshots/log_s34.png`)
      expect(all).toEqual(all3)
      expect(filtered3).toEqual(filtered)
    }
    await sleep(100)
    await workbench.elem.saveScreenshot(`test/screenshots/log_s35.png`)
  })
})
