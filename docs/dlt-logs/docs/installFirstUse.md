---
id: installFirstUse
title: Installation and first use
sidebar_label: Install and first use
slug: /
---
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
import ImageSwitcher from './ImageSwitcher';
import useBaseUrl from '@docusaurus/useBaseUrl';

DLT-Logs is a Visual Studio Code(tm) extension available at the marketplace: [![Version](https://vsmarketplacebadge.apphb.com/version/mbehr1.dlt-logs.svg)](https://marketplace.visualstudio.com/items?itemName=mbehr1.dlt-logs).

## Install

At first you do need to have Visual Studio Code installed. It's available for [free](https://code.visualstudio.com/docs/supporting/faq#_is-vs-code-free) from here: https://code.visualstudio.com . It works well under Windows, macOS and Linux.

Then you can install DLT-Logs like any other extension for Visual Studio Code, e.g. via command "Extensions: Install Extensions" and then enter DLT-Logs and click "Install".

(todo add picture)

## First use

After installation you can open DLT files via

<Tabs
    groupId="operating-systems"
    defaultValue="win"
    values={[
        {label: 'Windows', value: 'win'},
        {label: 'macOS', value: 'mac'},
        {label: 'Linux', value: 'linux'}
    ]
}>
<TabItem value="win">Use F1 or Ctrl+Shift+P and enter/select command "Open DLT file...".</TabItem>
<TabItem value="mac">Use &#8679;&#8984;P and enter/select command "Open DLT file...".</TabItem>
<TabItem value="linux">Use Ctrl+Shift+P and enter/select command "Open DLT file...".</TabItem>
</Tabs>
and select the DLT file to open from the opened file selection dialog.

#### Opening multiple files
:::tip
You can open multiple DLT files one after the other and they will appear in different views.

If you want to open multiple DLT files into the same view you can simply select multiple files in the "Open DLT file..." dialog. They will be sorted by the first valid DLT message recorded time and then opened.
:::

### Search function

To use the search panel 'DLT-LOGS SEARCH' if not visible yet use the command:

<Tabs
    groupId="operating-systems"
    defaultValue="win"
    values={[
        {label: 'Windows', value: 'win'},
        {label: 'macOS', value: 'mac'},
        {label: 'Linux', value: 'linux'}
    ]
}>
<TabItem value="win">Use F1 or Ctrl+Shift+P and enter/select command "search dlt logs".</TabItem>
<TabItem value="mac">Use &#8679;&#8984;P and enter/select command "search dlt logs".</TabItem>
<TabItem value="linux">Use Ctrl+Shift+P and enter/select command "search dlt logs".</TabItem>
</Tabs>

<ImageSwitcher 
lightImageSrc={useBaseUrl("/img/searchPanel_light.png")}
darkImageSrc={useBaseUrl("/img/searchPanel.png")}/>

For details on how to use the search panel see [Search function](searchPanel).

### Adding filters

To add filters you can use the 'add new filter...' button from the tree view:

<ImageSwitcher 
lightImageSrc={useBaseUrl("/img/treeView_addFilter_light.png")}
darkImageSrc={useBaseUrl("/img/treeView_addFilter_dark.png")}/>

or add a [filter config](filterReference#filter-match-attributes) to the `dlt-logs.filters:[...]` json array in your [preferences](genericSettings) via

<Tabs
    groupId="operating-systems"
    defaultValue="win"
    values={[
        {label: 'Windows', value: 'win'},
        {label: 'macOS', value: 'mac'},
        {label: 'Linux', value: 'linux'}
    ]
    }>
<TabItem value="win">Use F1 or Ctrl+Shift+P and enter/select command "Preferences: Open User Settings (JSON)".</TabItem>
<TabItem value="mac">Use &#8679;&#8984;P and enter/select command "Preferences: Open User Settings (JSON)".</TabItem>
<TabItem value="linux">Use Ctrl+Shift+P and enter/select command "Preferences: Open User Settings (JSON)".</TabItem>
</Tabs>

You can add filters from the [search panel](searchPanel#set-filters-directly-from-search) as well.
