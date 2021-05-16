---
id: nonVerbosePlugin
title: Non-verbose plugin
sidebar_label: Plugin Non-verbose mode
---
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

DLT-Logs extension version >= 1.20.0 come with a built-in DLT non-verbose decoder plugin.

## Example

Non verbose mode logs are typically presented as:
```
APID CTID      [...id...] <readable text if any> | <binary hex dump>
```

using a FIBEX file that contains the info how to decode log "id" this can be converted into a regular readable log.

## Configuration

You have to configure the Non-verbose plugin. To configure the plugin call

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
        {
            "name": "SomeIp", // config for SOME/IP plugin...
            ...
        },
        {
            "name":"NonVerbose",
            "enabled": true, // you can set it to false to disable the plugin
            "fibexDir": "/home/...", // or "c:\\...". Set it to the folder containing your FIBEX files. If you use the SOME/IP plugin as well you can use a shared dir and set it only at the SOME/IP plugin.
        }
    ],
```

:::note
The `fibexDir` needs to point to a folder containing the FIBEX files with extension .xml.
Please keep the files uncompressed (no .zip, no .tgz) there.
:::
:::note
You can keep multiple files in the folder. They will be sorted in descending order alphabetically first before loading. So if you have multiple files e.g. with a SW revision as part of the file name the one with the latest SW revision will be loaded first. This is important as on loading further files only new services/methods will be added. So the files loaded first determine the version used.
Anyhow please dont keep files from older versions as opening and parsing them takes CPU time!
:::

:::note
If you changed the content of the folder for now you do need to open a new file or use `Developer: Reload window` to reload the window incl. the extension host.
:::

## Treeview

In the tree-view you'll find more information about the loaded frames and pdus under
```
Plugins
|- Non-Verbose
   |- Frames (<number of frames with non-verbose info>/<number of frames in total from the fibex files loaded>)
      | - <list of all loaded frames with id, apid, ctid, byte-length, message-type, message-info>
```
:::note
The tooltip of each frame contains more info e.g. PDUs.
:::
(todo add picture)

## Supported "non-verbose" messages

The plugin decodes all "non-verbose", non control-request messages for which is finds a corresponding frame in any FIBEX file.
If the message has no APID and no CTID it's set with the info from the FIBEX.
The log-level is set as well with info from the FIBEX.

## Limitations

- The plugin is not applied on exporting DLT logs. Only on viewing.
- Endianess should be supported but I tested only little-endianess.
- Currently not supported are:
  - FLOAT16
