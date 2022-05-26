# dlt-logs README

[![Version](https://vsmarketplacebadge.apphb.com/version/mbehr1.dlt-logs.svg)](https://marketplace.visualstudio.com/items?itemName=mbehr1.dlt-logs)

This Visual Studio Code(tm) extension adds support to open DLT (diagnostic log and trace, see [GENIVI](https://at.projects.genivi.org/wiki/display/PROJ/Diagnostic+Log+and+Trace) or [AUTOSAR](https://www.autosar.org/fileadmin/user_upload/standards/foundation/1-0/AUTOSAR_PRS_DiagnosticLogAndTraceProtocol.pdf)) files.

![main view](https://github.com/mbehr1/dlt-logs/raw/master/images/dlt-logs-main1.png)

**Note:** It works well with [![Version](https://vsmarketplacebadge.apphb.com/version/mbehr1.smart-log.svg)](https://marketplace.visualstudio.com/items?itemName=mbehr1.smart-log) **smart-log** extension and supports the "time-sync" feature. (todo picture/animation...)

**Note:** It works well with [![Version](https://vsmarketplacebadge.apphb.com/version/mbehr1.fishbone.svg)](https://marketplace.visualstudio.com/items?itemName=mbehr1.fishbone) **fishbone** extension and provides a rest query and filter API that can be used for badges and "apply filter". (todo picture/animation...)

A more detailed documentation is available here: [Docs](https://mbehr1.github.io/dlt-logs/). 

## Features

- Open DLT files (Mac: &#8679;&#8984;P "Open DLT file...", Linux/Win: Ctrl+Shift+P "Open DLT file..." ) with size restriction due to v8 engine memory limits. (Tested with ~1500MB files). With files of approx 2GB you get out of memory problems. A "load time filter assistant..." helps you in reducing number of messages while opening files >512MB.

- Alternative solution is to use "Open DLT file via adlt..."  (Mac: &#8679;&#8984;P "Open DLT files via adlt...", Linux/Win: Ctrl+Shift+P "Open DLT file..." ) command that uses the provided adlt binary and is only limited by your virtual address space. Tested with 20GB DLT file.
  - supports opening multiple files at once
  - supports opening of CAN .asc files (simply choose the .asc file instead of .dlt files during "Open DLT file via adlt..." command)
  - supports all plugins except file-transfer. Additionally a 'CAN' plugin is available.
  - an adlt binary is provided with the extension and the path to it is available in VS code terminals or via command "New terminal with adlt in path".
- **Time sync** feature.
  - Calculates time for each line based on timestamp and reception/storage time.
  - An offset for the full time can be set via context menu item *adjust-time...*.
  - If a time was received already the *adjust-time...* will propose to adjust/sync that line to the selected one.
  - Posts events of the selected time to other documents/plugins. (See ... <todo>).
- Detects the lifecycles and shows them in a tree-view.
  - Lifecycles can be graphically decorated by defining *dlt-log.decorations* with id 'lifecycleEven' (for the lifecycles #0, #2,...) / 'lifecycleOdd' (for the lifecycles #1,#3,...). Default decorations contains light transparent green(dark)/gray(light) background for 'lifecycleOdd'. Only the ECU with the highest amount of messages will be decorated.
  - Lifecycles can be filtered for ( "enable"/"disable").
  - Message view can be **sorted by time** by using the icon in the document title bar. Messages are properly sorted by the **calculated time** and not the received times.
- **Export/filter DLT file...**
  - Merge multiple DLT files into on file.
  - Sort msgs within lifecycles by timestamp (**reorder msgs by calculated time? option**)
  - Rewrite received time with the calculated time (**rewrite msg times by calculated times? option**). For more details see [Docs/Export and filter DLT files](https://mbehr1.github.io/dlt-logs/docs/exportAndFilter).
  - Allows to export selected lifecycles only.
  - Allows to export by time range.

- Allows to filter for:
  - ECUID
  - APID
  - CTID
  - MSTP
  - log level min/max
  - payload (by "contains" simple string or regex match)
  - lifecycles.

- Filters can be *added* based on the hover text of a log line. The filter settings will be prefilled with ECU, APID, CTID.
- Filters can be *edited* and *deleted* (press option key at the edit icon) from the *filters* tree view.
- Adding or editing filters menu allows to select ECUs, APIDs, CTIDs from the descriptions found in the loaded log file.
- Filters can be added to **configs**. If a filter is part of a config it will be:
  - disabled by default on opening a file.
  - be enabled/disabled if the config is enabled/disabled
  - positive filters get enabled if the config "zoom in" button is used and vice versa on "zoom out"
  - negative filters will be disabled if the config "zoom in" button is used  and vice versa on "zoom out"
- **Configs** can be automatically enabled if lifecycles with a specific ECUs are detected. To enable this set the "autoEnableIf" regex for that config to e.g. "ecu1|ecu2". Configs allow to quickly configure different configurations or use-cases/scenes for that you want to use different filter configurations. E.g.
  - ECU1
    - generic (this config can be referred to as "ECU1/generic")
    - crashes
    - lifecycle
    - app1
    - app2
    - known defects
      - defect1
      - ...
  - ECU2
    - ...
- If you enable one config the whole tree below gets enabled as well. In the tree view you can:
  - enable: enable all filters assigned to this config and all configs below.
  - disable: disable all filters assigned to this config and all configs below.
  - zoom in: enable all positive filters and disable all neg. filters (so provide more details/logs)
  - zoom out: disable all positive filters and enable all neg. filters (so provide less details/logs)

- Support **DLT file transfer** file extraction (and automatic filtering of FLDA msgs). Shows the file transfers and allows to save any file. (Not supported with adlt yet.)
- **SOME/IP decoder** plugin supporting multiple FIBEX files. All known services and methods are listed in the treeview incl. description texts in the tooltips! Note: disabled by default. Need to add option "fibexDir" to use it.
- **Non-verbose** plugin supporting DLT non-verbose mode to readable text conversion using FIBEX files. Known IDs are listed in the treeview. Note: disabled by default. Need to add option "fibexDir" to use it or share with SOME/IP decoder.
- **Rewrite** plugin supporting rewriting/changing messages. E.g. timestamp of DLT logs with embedded syslog timestamps can be changed automatically.
- **Quickly configurable columns**. Simply press the "select columns..." button in upper right corner of the document and select which one to show. The changes get stored permanently as global settings `dlt-logs.columns`.
![Quickly configureable columns](https://github.com/mbehr1/dlt-logs/raw/master/images/selectColumns.png)
- **Graphical time series reports** based on event filters. You can define event filters (type: 3), add normal filters and use a payloadRegex that captures either one value or even multiple values with named capture groups (?<series_name>.*). All captures needs to represent numbers. Grid lines for lifecycle start/ends are automatically added. To open a report simply press on the "report" icon next to the filter.
![Graphical time series reports](https://github.com/mbehr1/dlt-logs/raw/master/images/timeSeriesReport1.png)

- **go/jump to entered time...** command that quickly jumps to the log lines around the time you entered. You can call it via command "go/jump to entered time..." or via the small time/history button in the upper right document button area.

The extension uses telemetry with two events (`activate` (no parameters) and `open file` (file size as parameter)) if telemetry is activated within your general configuration.

## Planned features

- Add button to edit configs.
- Allow filter add/edit for report, timesync, MSTP and log levels (currently only possible via JSON configuration)
- Check whether revealing the line on broadcasted time is possible if document is hidden/not visible.
- Support easier splitting of huge files into files per lifecycle. Currently only possible to restrict to lifecycles via Export/filter...
- Allow merging/opening of multiple DLT files. Currently only possible via Export/filter ...
- Check default colors on multiple color themes. Check color contrast to background.
- Support time synchronized split-view between e.g. two APIDs from within one DLT log file.
- Use the outline view for lifecycles, errors,...
- Add support for file changes (growing) and load/update automatically.
- Saving of logs/selections allowing e.g. to add comments as proper logs.
- Use custom editor interface to be able to support regular file open mechanism.
- support for: charts.red, charts.blue, charts.yellow, charts.orange, charts.green, charts.purple, charts.foreground, charts.lines: Colors intended to be used by data visualization extensions.
- add Treeview colored icons (1.51 vscode feature)

## Extension Settings

This extension contributes the following settings:

* `dlt-logs.fileExtensions`: Specifies the file extensions to use for file open dialog. Defaults to .dlt|.DLT.
* `dlt-logs.maxNumberLogs`: Specified the maximum number of DLT logs that get displayed in one page. If more logs exist - considering the active filters - a paging mechanism is in place that starts rendering a new page at 4/5th of the page boundary. Searching is limited to the visible page. Defaults to 0.4mio logs. Depending on your machines performance/RAM you might reduce/increase this. Best case is to find a limit/config where all logs fit into that range (use filter!).
* `dlt-logs.reReadTimeout`: Specified the timeout in ms after opening the file before starting to parse the dlt file. If the file doesn't open, increase this to e.g. 5s.
* `dlt-logs.columns`: Specifies which columns are visible. See example config. Usually doesn't need to be changed manually but by button "select columns".
* `dlt-logs.filters`: Configures the filter that are available.
   There are four type of filters:
   * **positive**: filter need to match to include the message in the view. If no positive filter exists all msgs are assumed matching.
   * **negative**: if filter matches the message will not be included in the view.
   * **marker**: if filter matches the messages will be "marked"/decorated.
   * **event**: used for time-sync event detection or for report generation. For reports the payloadRegex must be used and capture data. If the capture group name starts with "STATE_" distinct/"state"/"level" values are assumed. If the capture group name starts with "INT_" the value is parsed as integer and can e.g be in hex (0x...). Otherwise linear (float-)values. By default report filters are added into the last active report window. If you want to add another report window use the "alt/option".
   If the capture group name starts with "EVENT_" the data is drawn using scatter/dot-based charts and not using line-based ones.

   Currently filter can match for:
   * **ecu**: the ECU identifier.
   * **apid**: the APID (application identifier).
   * **ctid**: the CTID (context identifier).
   * **mstp**: the message type (log, control, trace, network).
   * **logLevelMin/Max**: min/max log level.
   * **payload**: payload text contained.
   * **payloadRegex**: regular expression to match payload text.

   Filter can be:
   * **enabled**: filter is enabled and will be applied.
   * **atLoadTime**: filter is used already at file load/opening time (only pos/neg filters). This reduces the memory-load with huge files significantly but the filter can't be turned off once the file is opened. Take care: this changes the index of the message and might impact the lifecycle detection as well (todo improve later).

   Marker filter can be highlighted / **decorated** either by
   * **filterColour**: css colour code to use (e.g. #f0f0f0 or 'red', etc.) or
   * **decorationId**: id of a defined **decoration** configured with dlt-logs.decorations.

   For time-sync feature event filter can be used:
   * **timeSyncId**: id of the event that will be broadcasted.
   * **timeSyncPrio**: prio of the event.
   (todo describe time-sync feature with an example)

   For report generation filter can contain:
   * **reportOptions**: object that can contain:
     * **conversionFunction**: can be used to modify the captured values for that event. Needs to be a JS function returning an array of objects { valueName: value } gets the regex 'matches' as parameter. Additional parameter is "params" which is an object with msg, localObj and reportObj. TODO create wiki with full example. E.g. "return {'limit':42};" for a static value. or "return {'timeStamp': params.msg.timeStamp/10000};". 'localObj' is initially an empty Object {} that can be used to store properties for that filter (e.g. interims data for calculations).  'reportObj' is an Object similar to localObj but shared between all filters. So take care here for name clashes!
     * **valueMap**: object that can contain keys matching to the captured data names and the property is an array with objects { capturedName : newName }. 
     E.g."reportOptions": { "valueMap": { "STATE_onOff": [ { "1": "on" }, { "0": "off" }, {"ff": "invalid" }]}}
     * **yAxes**: object that can contain for each dataset chartjs settings to determine the y-axis options. E.g. "reportOptions": { "yAxes": {"STATE_onOff": {"position": "right", type: "category", "display": "auto", "ticks": {"reverse": true}}}} for a right sided category y-axis. See chartjs cartesian axes config options. Do not specify the "id"! That will be automatically set. The dataset name can be a regular expression. E.g. "^STATE_.*$".

   Filter configuration changes and menu items *add filter...*, *edit filter...*, *delete filter...* actions will be applied instantly to the configuration/view.

   Details see (todo...).
* `dlt-logs.plugins`: Allows configuration of plugins. Currently two plugins are supported:
  * **name** : **"FileTransfer"** plugin
  * **enabled**: determines whether the plugin is enabled.
  * **allowSave**: can be used to disable saving capability. Can be used if you're not interested in the files but still want to see any transfers. Reduces memory consumption.
  * **keepFLDA**: if enabled the FLDA messages are visible in the logs (if no other filter removes them). Default is to not show the FLDA messages.
  * **apid**: restrict searching for file transfer messages to this APID. Can be empty (as by spec). If you know the APID providing this speeds up processing.
  * **ctid**: restrict searching for file transfer message to this CTID. Can be empty (as by spec). 
  
or
* SOME/IP plugin:
  * **name** : **"SomeIp"** plugin
  * **enabled**: determines whether the plugin is enabled.
  * **fibexDir**: directory containing the FIBEX files (all .xml files are processed!).
  For more options see the configuration help text or docs.

* `dlt-logs.decorations`: Definition of the decoration types supported for marker filters.
* `dlt-logs.configs`: Definition of **Configs**. A config consists of a:
  * **name**: Name of that config
  * **autoEnableIf**: Optional regex that gets matched against the ECUs from the detected lifecycles.
  * Filters can be added to configs by using the **configs** array of that filter (or by using **edit filter** assistant).

## Known Issues

Little testing especially on different endianess.

* Marker filters only partially implemented yet. 3 hard-coded filters are highlighting log levels warning, error and fatal if the decorationIds "warning", "error" and "fatal" do exist.
* Endianess is not tested/implemented! If you send me a DLT log with different endianess I'll implement it.

## Platform specific releases

Starting with v1.28.0 platform-specifc releases are generated as they include a binary version of [adlt](https://github.com/mbehr1/adlt).
This is done via usage of the [node-adlt](https://github.com/mbehr1/node-adlt) package that provides pre-compiled adlt binaries for a lot of platforms.

Currently the binaries are included for:
- macOS, x64, x86_64-apple-darwin
- macOS, arm64, aarch64-apple-darwin (e.g. M1 Macs)
- Windows, win32 x64 64bit, x86_64-pc-windows-msvc
- Windows, win32 ia32 32bit, i686-pc-windows-msvc
- Linux, x64,  (MUSL), x86_64-unknown-linux-musl
- Linux, arm64, aarch64-unknown-linux-gnu
- Alpine, x64, (MUSL), x86_64-unknown-linux-musl

So missing are:
- Windows, win32-arm64
- Linux, linux-armhf
- Alpine Linux, alpine-arm64.

If you have a different platform you do need to install [adlt](https://github.com/mbehr1/adlt) manually and set the **dlt-logs.adltPath** config setting to the path of the installed binary.
If you miss any platform please create an issue and I'll add it.

If you want to you can always use your locally compiled/installed adlt binary by setting the **dlt-logs.adltPath** config setting.

Background of this change is the introduction of the new **open with adlt...* feature that uses adlt as a backend.
It offers:
- higher performance
- memory usage only limited by your virtual address space
- can open multiple files simultaneously (file open order is determined by the first message recorded time of each file)
- does sort automatically by calculated time.

It currently offers all plugins but the Filetransfer plugin.


## Contributions

Any and all test, code or feedback contributions are welcome.
Open an [issue](https://github.com/mbehr1/dlt-logs/issues) or create a pull request to make this extension work better for all.

[![Donations](https://www.paypalobjects.com/en_US/DK/i/btn/btn_donateCC_LG.gif)](https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=2ZNMJP5P43QQN&source=url) Donations are welcome! (Contact me for commercial use or different [license](https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode)).

[GitHub ♥︎ Sponsors are welcome!](https://github.com/sponsors/mbehr1)

[![Open in Visual Studio Code](https://open.vscode.dev/badges/open-in-vscode.png)](https://open.vscode.dev/mbehr1/dlt-logs)

## Contributors

Thanks a lot to :
- [Jens Schmer](https://github.com/jschmer) for the first PR providing y-axis support to graphical reports!

## Release Notes

See [Changelog](./CHANGELOG.md)

## Third-party Content

This project leverages the following third party content.

momentjs.com (2.13.0)
 - License: MIT
 - Source: https://momentjs.com

chartjs.org (2.9.4)
 - License: MIT https://github.com/chartjs/Chart.js/blob/master/LICENSE.md
 - Source: https://github.com/chartjs/Chart.js

chartjs-plugin-colorschemes
  - License: MIT https://github.com/nagix/chartjs-plugin-colorschemes/blob/master/LICENSE.md
  - Source: https://github.com/nagix/chartjs-plugin-colorschemes

chartjs-plugin-zoom (0.7.7)
  - License: MIT https://github.com/chartjs/chartjs-plugin-zoom/blob/master/LICENSE.md
  - Source: https://github.com/chartjs/chartjs-plugin-zoom

chartjs-plugin-annotation (0.5.7)
  - License: MIT https://github.com/chartjs/chartjs-plugin-annotation/blob/master/LICENSE.md
  - Source: https://github.com/chartjs/chartjs-plugin-annotation

hammer.js (2.0.8)
  - License: MIT https://github.com/hammerjs/hammer.js/blob/master/LICENSE.md
  - Source: https://github.com/hammerjs/hammer.js

color-name (1.1.4)
 - Licence: MIT https://github.com/colorjs/color-name/blob/master/LICENSE
 - Source: https://github.com/colorjs/color-name

<!--
* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux)
* Toggle preview (`Shift+CMD+V` on macOS or `Shift+Ctrl+V` on Windows and Linux)
* Press `Ctrl+Space` (Windows, Linux) or `Cmd+Space` (macOS) to see a list of Markdown snippets

### For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
-->
