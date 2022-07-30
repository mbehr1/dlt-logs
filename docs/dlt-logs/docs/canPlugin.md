---
id: canPlugin
title: CAN decoder plugin
sidebar_label: Plugin CAN decoder
---
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

DLT-Logs extension version >= 1.50.0 come with a built-in CAN decoder plugin based on configurable fibex files and the possibility to open CAN file in `.asc` format directly.

## Example

If a CAN `.asc` file is opened and the CAN plugin is configured with a FIBEX file the CAN messages will be decoded e.g. like this:
```
CAN1 CAN TC   can      > IuK_CAN 0x510 Networkmanagement3_Status [<orig can payload>]:{"Networkmanagement3":{"NM3ControlBitVector":..., "NM3SenderECUId":...,...}}
```

### Explanation

symbol | description
------ | -----------
`CAN1`| First CAN bus/channel. CAN channels/buses are mapped to ECU ids with name CANx.
`CAN`| static APID `CAN` is used for CAN frames,
`TC`| static CTID `TC` is used for decoded CAN frames 
`>` | RX/TX direction. `>` for a received msg (RX), `<` for a transmitted frame (TX).
`IuK_CAN` | Name of the CAN bus. Here `IuK_CAN`.
`0x510`| CAN frame identifier
`Networkmanagement3_Status` | Name of the frame identifier.
`{...}` | Decoded payload of the frame in JSON format

## Configuration

You have to configure the CAN plugin. To configure the plugin call

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
        {
            "name":"CAN",
            "enabled": true, // you can set it to false to disable the plugin
            "fibexDir": "/home/..." // or "c:\\...". Set it to the folder containing your FIBEX files.
        },
        {
            "name": "FileTransfer", // config for other plugins, here file transfer plugin...
            ...
        },
    ],
```

:::note
The `fibexDir` needs to point to a folder containing the FIBEX files with extension .xml.
Please keep the files uncompressed (no .zip, no .tgz) there.
:::
:::note
You can keep multiple files in the folder. If you have multiple files providing info for the same CAN bus the one with the most frames will be used.
:::

:::note
If you changed the content of the folder for now you do need to open a new file or use `Developer: Reload window` to reload the window incl. the extension host.
:::

## Treeview

In the tree-view you'll find more information about the loaded CAN channels and frames, PDUs, signals under
```
Plugins
|- CAN Decoder
   |- Channels #<number of channels loaded>
      | - <list of all loaded channels/busses
          | - <list of all frames for that channel with short name > sorted by frame id
            | - <list of all PDUs within that frame>
                | - <list of all signal-instances>
   | - Signals #<number of signals loaded>
   | - Codings #<number of (en-)codings for datatypes loaded>
```
:::note
The tooltip of each item contains more info e.g. the description (if available in the FIBEX).
:::
(todo add picture)

:::tip
From the tree view frames you can directly apply a filter with the `adjust filter to hide details` (if the frames are currently visible) or `adjust filter to show more details` icon button on the right hand side of the frame item.

Using the `open report` icon you can directly open a graphical report showing the frame data over time!
(todo add picture)
:::

## Encoding of CAN messages in DLT log message

The decoder assumes that the message is encoded as type `NW_TRACE/CAN` with the CTID `TC`. The CAN message itself is encoded as two raw message payloads:
1. 4 bytes with the frame identifier.
2. CAN frame payload

## Limitations

- Limited testing. Please raise an issue if you find unsupported CAN traces!
