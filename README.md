# dlt-logs README

[![Version](https://vsmarketplacebadge.apphb.com/version/mbehr1.dlt-logs.svg)](https://marketplace.visualstudio.com/items?itemName=mbehr1.dlt-logs)

This Visual Studio Code(tm) extension adds support to open DLT (diagnostic log and trace) (todo see genivi/autosar...) files.

**Note:** It works well with [![Version](https://vsmarketplacebadge.apphb.com/version/mbehr1.smart-log.svg)](https://marketplace.visualstudio.com/items?itemName=mbehr1.smart-log) **smart-log** extension and supports the "time-sync" feature. (todo picture/animation...)

## Features

- Open DLT files without any size restriction. (Tested with ~500MB files)
- **Time sync** feature.
  - Calculates time for each line based on timestamp and reception/storage time.
  - An offset for the full time can be set via context menu item *adjust-time...*.
  - Posts events of the selected time to other documents/plugins. (See ... <todo>).
- Detects the lifecycles and shows them in a tree-view.
- Allows to filter for:
  - ECUID
  - APID
  - CTID
  - ...

<!-- \!\[feature X\]\(images/feature-x.png\)

> Tip: Many popular extensions utilize animations. This is an excellent way to show off your extension! We recommend short, focused animations that are easy to follow. -->

The extension uses telemetry with two events (`activate` (no parameters) and `open file` (file size as parameter)) if telemetry is activated within your general configuration.

## Planned features

- Add configurable columns
- Sort msgs within lifecycles by timestamp (maintaining orig index as e.g. hover info)
- Add status bar info with e.g. number of msgs with current filter/total.
- Support easier splitting of huge files into files per lifecycle and offer "assistant" at opening of huge files.
- Support DLT file transfer file extraction (and automatic filtering of those msgs).
- Support time synchronized split-view between e.g. two APIDs from within one DLT log file.
- Use the outline view for lifecycles, errors,...
- Add support for file changes (growing) and load/update automatically.
- Add editor for filter (e.g. via config extension) and allow changing filters at runtime.
- Saving of logs/selections allowing e.g. to add comments as proper logs.

## Extension Settings

This extension contributes the following settings:

* `dlt-logs.fileExtensions`: Specifies the file extensions to use for file open dialog. Defaults to .dlt|.DLT.
* `dlt-logs.maxNumberLogs`: Specified the maximum number of DLT logs that get displayed in one page. If more logs exist - considering the active filters - a paging mechanism is in place that starts rendering a new page at 4/5th of the page boundary. Searching is limited to the visible page. Defaults to 1mio logs. Depending on your machines performance/RAM you might reduce/increase this. Best case is to find a limit/config where all logs fit into that range (use filter!).
* `dlt-logs.reReadTimeout`: Specified the timeout in ms after opening the file before starting to parse the dlt file. If the file doesn't open, increase this to e.g. 5s.
* `dlt-logs.filters`: Configures the filter that are available.
   There are tree type of filters:
   * **positive**: filter need to match to include the message in the view. If no positive filter exists all msgs are assumed matching.
   * **negative**: if filter matches the message will not be included in the view.
   * **marker**: if filter matches the messages will be "marked"/decorated.

   Currently filter can match for:
   * **ecu**: the ECU identifier.
   * **apid**: the APID (application identifier).
   * **ctid**: the CTID (context identifier).

   Filter can be:
   * **enabled**: filter is enabled and will be applied.
   * **atLoadTime**: filter is used already at file load/opening time (only pos/neg filters). This reduces the memory-load with huge files significantly but the filter can't be turned off once the file is opened. Take care: this changes the index of the message and might impact the lifecycle detection as well (todo improve later).

   Filter configuration changes will be applied on next file open.
   Details see (todo...).

## Known Issues

Little testing especially on different endianess.

* Marker filters not implemented yet. 3 filters (to demo the feature are hard-configured (highlighting log levels warning, error and fatal))
* Time adjust is not possible yet. (If you use it with **smart-log** adjust the time there if needed!)
* Non-verbose support is missing yet.
* Endianess is not tested/implemented! If you send me a DLT log with different endianess I'll implement it.

## Contributions

Any and all test, code or feedback contributions are welcome.
Open an [issue](https://github.com/mbehr1/dlt-logs/issues) or create a pull request to make this extension work better for all.

[![Donations](https://www.paypalobjects.com/en_US/DK/i/btn/btn_donateCC_LG.gif)](https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=2ZNMJP5P43QQN&source=url) Donations are welcome! (Contact me for commercial use or different [license](https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode)).

## Release Notes

See [Changelog](./CHANGELOG.md)

<!--
* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux)
* Toggle preview (`Shift+CMD+V` on macOS or `Shift+Ctrl+V` on Windows and Linux)
* Press `Ctrl+Space` (Windows, Linux) or `Cmd+Space` (macOS) to see a list of Markdown snippets

### For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
-->
