---
id: genericSettings
title: DLT-Logs settings reference
sidebar_label: Generic settings
---
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

Most configuration options come with reasonable defaults.
You can to configure the following generic options.

<Tabs
    groupId="operating-systems"
    defaultValue="win"
    values={[
        {label: 'Windows', value: 'win'},
        {label: 'macOS', value: 'mac'},
        {label: 'Linux', value: 'linux'}
    ]
    }>
<TabItem value="win">Use F1 and enter/select command "Preferences: Open Settings (JSON)".</TabItem>
<TabItem value="mac">Use Cmd+P and enter/select command "Preferences: Open Settings (JSON)".</TabItem>
<TabItem value="linux">Use Ctrl+P and enter/select command "Preferences: Open Settings (JSON)".</TabItem>
</Tabs>

```jsonc
"dlt-logs.maxNumberLogs": 400000, // maximum number of DLT logs that are shown in one page. If more messages do exist a paging mechanism will reload at 4/5th the next chunk. You can only search within that page. Please consider using filter to stay within that limit. Defaults to 400'000.
"dlt-logs.reReadTimeout": 1000, // time out in ms until the first re-read happens. Defaults to 1s. If you do have a slow PC you might change this to a larger time.
"dlt-logs.fileExtensions": [ "dlt", "DLT" ], // default file extensions for DLT log files
"dlt-logs.columns": [...], // please use the icon in upper right corner of each opened DLT file to configure the columns shown
"dlt-logs.filters": [...], // filter configuration See below for details.
"dlt-logs.configs": [...], // configs. See below for details.
"dlt-logs.decoration": [...], // decorations, e.g. colors/border style to use for warnings, errors or any other marker filter. See todo for details.
```

:::note
Here mainly the `maxNumberLogs` setting is needed. If you want to open really large files you might set it to a larger value. If you prefer faster loading times e.g. after filter changes you can set it to smaller values. The main problem is that the search is restricted to the currently visible range with the max. number of logs configured.
:::

See [Filter](filterReference) for configuration of filters.

See [Configs](configsReference) for configuration of `configs`.

See [Plugin File Transfer](fileTransfer) for configuration of the file transfer plugin.

See [Plugin SOME/IP decoder](someIpPlugin) for configuration of the SOME/IP plugin.
