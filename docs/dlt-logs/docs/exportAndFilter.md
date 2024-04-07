---
id: exportAndFilter
title: Export and filter DLT files
sidebar_label: Export DLT files
---
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

DLT-Logs offers you a way to export and/or merge DLT logs from a set of DLT files.


## Export

You can export DLT logs from e.g. a huge log file by the following criteria:
...

To open the `Export and filter` assistant do:

<Tabs
    groupId="operating-systems"
    defaultValue="win"
    values={[
        {label: 'Windows', value: 'win'},
        {label: 'macOS', value: 'mac'},
        {label: 'Linux', value: 'linux'}
    ]
}>
<TabItem value="win">Use F1 or Ctrl+Shift+P and enter/select command "Export/filter DLT file...".</TabItem>
<TabItem value="mac">Use &#8679;&#8984;P and enter/select command "Export/filter DLT file...".</TabItem>
<TabItem value="linux">Use Ctrl+Shift+P and enter/select command "Export/filter DLT file...".</TabItem>
</Tabs>
and select the DLT file(s) to open from the opened file selection dialog.

:::note
The **Export/filter assistant** offers the possibility to open **multiple** input files at the same time. This allows to e.g. concat small files into one and then apply further filters (or none) before exporting.
:::

### Step 1: select lifecycles

In the first step you'll be asked which **lifecycles** you do want to keep into the export. If you select none all are assumed.

The lifecycle detection takes a while and runs in the background. As long as it runs you'll see a moving progress bar.

### Step 2: select time range

As 2nd step you can specify an additional **time range** you want the export to be restricted to. The time range can be entered as to-from in format `hh:mm-hh:mm` where both the to or the from can be empty indicating begin/end of logs.

### Step 3: reorder messages by calculated time

:::note
This step is only available in the deprecated Nodejs based implementation that can be called via the command "Export/filter dlt via deprecated Nodejs based implementation...". If you used this option please file an [issue](https://github.com/mbehr1/dlt-logs/issues/new/choose).
:::

DLT-Logs typically don't contain the single log messages in the order where they have been sent but where the logger has received them. Due to buffering effects there can be significant differences.
Only messages from a single ECU/APID/CTID should always be sorted properly as in general they should be send from a single thread only.
For details see [lifecycles](lifecycleDetection).

If you select the option **reorder messages by calculated time** the exported DLT file will be resorted based on the lifecycle/timestamp.

:::note
This eases understanding the timing behaviour of multi-process/threading/cpu/... systems significantly.
:::

If you think the resulting export files are wrong this might be due to problems detecting the lifecycles. Please feel free to open an [issue](https://github.com/mbehr1/dlt-logs/issues/new/choose).

### Step 4: rewrite msg times

:::note
This step is only available in the deprecated Nodejs based implementation that can be called via the command "Export/filter dlt via deprecated Nodejs based implementation...". If you used this option please file an [issue](https://github.com/mbehr1/dlt-logs/issues/new/choose).
:::

Similar to step 3 you can choose whether the **recorded time** should be rewritten to the calculated **created time**.

:::note
Especially at the begin of the lifecycle or directly after connecting a logger to the ECU due to buffering the differences are significant (e.g. >30s). Selecting this option/feature helps in mapping e.g. defect reports with times from the logs.
:::

### Step 5: select the file to export to

As last step you do need to choose the filename/location to where to export to.
