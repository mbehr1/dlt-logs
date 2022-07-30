---
id: rewritePlugin
title: rewrite plugin
sidebar_label: Plugin Rewrite
---
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

DLT-Logs extension version >= 1.19.0 come with a plugin that supports "rewriting"/modification of messages.

## Example

The example configuration below shows one intended use-case:
Often e.g. SysLog based messages are piped into DLT. But as typically there are additional latencies the timestamp from the DLT message is the timestamp where the process piping the data into DLT was executed and not from when the original message was created.
E.g.
```sh
...
14043 5:43:24 PM  6.4859 ECU1 SYS  JOUR info 2020/03/24 17:18:19.118891 0.000000 kernel: Informational: Booting Linux on physical CPU 0x0
...
14188 5:43:24 PM  6.4897 ECU1 SYS  JOUR info 2020/03/24 17:18:19.121146 0.002251 kernel: Informational: Console: colour dummy device 80x25
...
```

using the config below this can be changed to:

```sh
...
14043 5:43:24 PM  0.0000 ECU1 SYS  JOUR info kernel: Informational: Booting Linux on physical CPU 0x0
...
14188 5:43:24 PM  0.0023 ECU1 SYS  JOUR info kernel: Informational: Console: colour dummy device 80x25
...
```
:::note
See here that the timestamp is now correctly set to 0 and 2.3ms as taken from the syslog time and not at 6.4s which is the time when the dlt-syslog-pipe process dumped it into DLT.
This makes the [toggle sort order](toggleSortOrder)! feature where DLT logs get sorted by timestamp really useful!
:::

## Configuration

You have to configure the 'rewrite' plugin. To configure the plugin call

<Tabs
    groupId="operating-systems"
    defaultValue="win"
    values={[
        {label: 'Windows', value: 'win'},
        {label: 'macOS', value: 'mac'},
        {label: 'Linux', value: 'linux'}
    ]
    }>
<TabItem value="win">Use F1 or Ctrl+Shift+P and enter/select command "Preferences: Open Settings (JSON)".</TabItem>
<TabItem value="mac">Use &#8679;&#8984;P and enter/select command "Preferences: Open Settings (JSON)".</TabItem>
<TabItem value="linux">Use Ctrl+Shift+P and enter/select command "Preferences: Open Settings (JSON)".</TabItem>
</Tabs>

```jsonc
"dlt-logs.plugins": [
        ...
        {
            "name":"NonVerbose",
            ...
        },{
            "name": "Rewrite", // config for 'rewrite' plugin
            "enabled":true, // default to true, set to `false`to disable
            "rewrites":[ // array with rewrite-configs
                {
                    "name":"SYS/JOUR timestamp", // name of the rewrite-config
                    "filter":{ // filter settings applied. Same as filter config.
                        "apid":"SYS",
                        "ctid":"JOUR"
                    },
                    "payloadRegex":"^.*? .*? (?<timeStamp>\\d+\\.\\d+) (?<text>.*)$", // regex applied on the payload. Rewrites are done based on two possible capture group names: 
                    // The captured value from group `text` will be used as the new text for the message.
                    // The value from group `timeStamp` is expected to be in seconds and will be used for the new timestamp of the message (so internally multiplied by 10000 to be in 0.1ms).
                }
            ]
        },
    ],
```

:::note
If you changed the config you do need to open a new file or use `Developer: Reload window` to reload the window incl. the extension host.
:::

## Treeview

In the tree-view you'll find more information about the loaded service and methods under
```
Plugins
|- 'Rewrite' plugin
   |- Rewrites (<number of rewrite configs loadedloaded>)
      | - <list of all loaded rewrite configs with name>
```
:::note
The tooltip of each rewrite config contains more info e.g. the filter settings and which fields will be rewritten/modified.
:::
(todo add picture)

## Limitations

- The plugin is not applied on exporting DLT logs. Only on viewing.
- Rewrite functions are only supported with the deprecated NodeJS based parser. So removed the documentation from here. If you have use-cases for it please raise an issue in github!
