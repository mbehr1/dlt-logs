---
id: fileTransfer
title: File transfer plugin
sidebar_label: Plugin File Transfer
---

The file transfer plugin is enabled by default.

The following options can be configured:

```jsonc
"dlt-logs.plugins": [
    {
        "name": "FileTransfer",
        "enabled": true, // whether the plugin is enabled. Defaults to true.
        "allowSave": true, // whether the plugin shall allow saving the files. If you set this to false less memory will be used. You'll still be able to see the files and but not save them.
        "keepFLDA": false, // whether the FLDA messages shall be kept in the log. By default they are removed.
        "apid": "SYS", // the APID to search for file transfer messages
        "ctid": "FILE" // the CTID to search for file transfer messages
    },
    {
        "name":"SomeIp", // configuration for SOME/IP plugin...
        ...
    }
]
```