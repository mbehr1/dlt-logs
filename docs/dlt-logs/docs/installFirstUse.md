---
id: installFirstUse
title: Installation and first use
sidebar_label: Install and first use
slug: /
---
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

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

### Opening multiple files
:::note
You can open multiple DLT files one after the other and they will appear in different views.

If you want to open multiple DLT files into the same view you do need to use the [export](exportAndFilter) feature to merge/export them into one file. 
:::