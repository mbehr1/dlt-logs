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
14043 5:43:24 PM 64859 ECU1 SYS  JOUR info 2020/03/24 17:18:19.118891 0.000000 kernel: Informational: Booting Linux on physical CPU 0x0
...
14188 5:43:24 PM 64897 ECU1 SYS  JOUR info 2020/03/24 17:18:19.121146 0.002251 kernel: Informational: Console: colour dummy device 80x25
...
```

using the config below this can be changed to:

```sh
...
14043 5:43:24 PM     0 ECU1 SYS  JOUR info kernel: Informational: Booting Linux on physical CPU 0x0
...
14188 5:43:24 PM    23 ECU1 SYS  JOUR info kernel: Informational: Console: colour dummy device 80x25
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
<TabItem value="win">Use F1 and enter/select command "Preferences: Open Settings (JSON)".</TabItem>
<TabItem value="mac">Use Cmd+P and enter/select command "Preferences: Open Settings (JSON)".</TabItem>
<TabItem value="linux">Use Ctrl+P and enter/select command "Preferences: Open Settings (JSON)".</TabItem>
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
                    "payloadRegex":"^.*? .*? (?<timeStamp>\\d+\\.\\d+) (?<text>.*)$", // optional, for the payload a regex can be defined to avoid recalculating this for each rewrite function below. This will be evaluated after the message was matched towards the filter already!
                    "rewrite":{ // rewrite functions. `key`is the field to change for the msg. Currently only `timeStamp` and `payloadText` are supported. Each value is a javascript function that will be called with 2 parameters: the match from payloadRegex (if defined) and the message itself that matched. If the function returns a value !== undefined the attribute will be set to that value.
                        "timeStamp":"function(m,msg){ if (!m) {return undefined; } return Math.round(Number(m.groups?.['timeStamp']) * 10000)}",
                        "payloadText":"function(m,msg){ if (!m) {return undefined; } return m.groups?.['text']}"
                    }
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
- tbd... (be careful with what you change...)