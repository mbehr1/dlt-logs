---
id: someIpPlugin
title: SOME/IP decoder plugin
sidebar_label: Plugin SOME/IP decoder
---
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

DLT-Logs extension version >= 1.10.0 come with a built-in SOME/IP decoder plugin.

## Example

SOME/IP messages will be decoded like this:
```
APID TC   ipc      > (632a:0005) ServiceName(0080).set_fieldName_field{"fieldName":field_value}[OK]
```

### Explanation:

symbol | description
------ | -----------
`>` | SOME/IP request. Other symbols here are `<` for response, `*` for notification or `!` for errors.
`(632a:0005)` | Client id (here 632a) and session id (here 5) as hex numbers.
`ServiceName` | Short name of the service decoded.
`(0080)` | Instance id in hex.
`set_fieldName_field` | Method or event short name. Here a `SETTER` for field `fieldName` is called.
`{...}` | Decoded payload of the method. Here `fieldName`is set to `field_value`.
`[OK]` | Return code of the SOME/IP message.

## Configuration

You have to configure the SOME/IP plugin. To configure the plugin call

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
            "name":"SomeIp",
            "enabled": true, // you can set it to false to disable the plugin
            "fibexDir": "/home/...", // or "c:\\...". Set it to the folder containing your FIBEX files.
            "ctid": "TC", // optional ctid. Defaults to "TC" if not set
            "mtin": 1 // optional MTIN. Defaults to MTIN_NW_TRACE (1) if not set
        },
        {
            "name": "FileTransfer", // config for file transfer plugin...
            ...
        },
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

In the tree-view you'll find more information about the loaded service and methods under
```
Plugins
|- SOME/IP Decoder
   |- Services (<number of services loaded>)
      | - <list of all loaded services with short name and version>
          | - <list of all methods for each service with short name >
   | - Datatypes (<number of datatypes loaded>)
   | - Codings (<number of (en-)codings for datatypes loaded>)
```
:::note
The tooltip of each item contains more info e.g. the description (if available in the FIBEX).
:::
(todo add picture)

## Encoding of SOME/IP messages in DLT log message

The decoder assumes that the message is encoded as type `NW_TRACE` with the configured `MTIN` and `CTID`.See [Configuration](#configuration). The SOME/IP message itself is encoded as two raw message payloads:
1. 4 bytes with the IPv4 address, 2 bytes with the udp/tcp, 1 byte protocol (0 = local, 1 = tcp, 2 = udp), 1 byte indicating incoming or outgoing message and 1,2 or 4 bytes encoded instance ID.
2. SOME/IP header (16 bytes) and payload

## Limitations

- Currently all payloads are expected to be big-endian even if the FIBEX files defines something else! If you need support for little-endian please raise an issue in github.
- Currently not supported are:
  - UNIONs are not supported yet.
  - Booleans as payload are not supported yet.
  - BIT-LENGTH parsing (types with e.g. 12 bit...)
  - Segmented messages are not supported.
