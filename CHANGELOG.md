# Change Log

All notable changes to the "dlt-logs" extension will be documented in this file.

<!-- Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file. -->
## [0.29.2]
- Removed some wrong package dependencies that lead to a big install package.

## [0.29.1]
- Update outdated packages. 

## [0.29.0]
- Added "EVENT_" / event/scatter reports using single dots and not lines in the reports. See issue/feature request #3.

## [0.28.1]
- Updated readme to point to the new [Docs](https://mbehr1.github.io/dlt-logs/) containing more info for reports (currently).

## [0.28.0]
- Added icons for filter in tree view.
- Filters now support the config option "name" to provide an optional name to ease readability.

## [0.27.0]
- added "params" to conversionFunction for report filters. Keys are "msg", "localObj" and "reportObj".

## [0.26.2]
- timeStamp jumps should be > 10 mins not just a few secs.

## [0.26.1]
- Ignoring timeStamp jumps > 10mins for lifecycle detection.
- Print lifecycle start time with date.

## [0.26.0]
- Lifecycle detection now doesn't mix lifecycles where the ECU id is coming from storageheader and msg header. Lifecycles with ECU from storageheader are prepended with a \<SH\_\>.

## [0.25.1]
- For export logs: removed assumption to lifecycle only grow to start/end for updating the description.

## [0.25.0]
- Added reportOptions.conversionFunction to map or calclate more complex values or add constants to the reports.

## [0.24.1]
- Added INT_ to report capture name to convert directly with parseInt. This needs to be used e.g. for hex values.

## [0.24.0]
- Improved lifecycle detection (mergeing overlapping LCs from same ecu)

## [0.23.1]
- Updated dependencies (after github security advisory)

## [0.23.0]
- Added APID/CTID list into lifecycle tree view. (Next version will add filtering directly on those.)

## [0.22.1]
- Allow TYPE_CONTROL messages with noar>=1.

## [0.22.0]
- Export/filter: Add function to filter export by time range: from-to.

## [0.21.0]
- Export/filter: Add function to export only selected lifecycles.
- Export/filter: Write filter settings used as log msgs into the generated log file. Apid: "VsDl", Ctid: "Info".
- Export/filter: Fix command not activating the extension.

## [0.20.0]
- Added export/filter dlt assistant that allows to: merge dlt files and reorder msgs by calculated time.
- Provide more info in msg hover incl. description of APID/CTID (if available)

## [0.19.0]
- Added load time filter assistant that helps removing messages via APID filters at opening of files >512MB.

## [0.18.1]
- More memory optimization (ECU/APID/CTID strings)

## [0.18.0]
- Memory load/usage optimizations.
- Removed binary-parser.
- Format timestamp in secs in hover.

## [0.17.1]
- Hotfix to improve load performance (and running out of memory). Seems caused by newer binary-parser version. Rolled that back to 1.5.0.
- Improved progress output on loading to better readable values.

## [0.17.0]
- added "configs" feature.
- added icons for dlt logs explorer for files, lifecycles, filter, configs, plugins.

## [0.16.1]
- made parser more robust towards wrong (too small) len info in standard header.
- updated dependencies to newer versions.

## [0.16.0]
- add filter..., edit filter and delete filter features.
- enhanced hover text to provide "add filter..." command and tabluar view.

## [0.15.0]
- Show status bar with number of msgs with current filter / all messages and tooltip with more info.

## [0.14.1]
- Added list of SW versions to the detected lifecycles ECU line and as tooltip for the lifecycles.
- Made lifecycle decoration one line smaller. As usually if filters are active otherwise the first line from next one is decorated.

## [0.14.0]
- Added parsing of control response get_sw_version and get_log_info

## [0.13.1]
- Remove trailing zeros from ECU.

## [0.13.0]
- Added basic non-verbose support.

## [0.12.1]
- Delayed checkActiveExtensions a bit.

## [0.12.0]
- Fix lifecycle times not adjusted on "adjust time..."
- Avoid reentrance problem with applyFilter. For now will just ignore it. If you change filters quickly the last one will be ignored/not-visible! Proper fix to come.

## [0.11.0]
- Report-filter are now added by default into the same (last active) view. So you can show multiple filter in same report.
- Added alt/option command to add report-filter into a new report.

## [0.10.0]
- 'Toggle lifecycle start' now considers overlapping lifecycles.
- Added support for "state" reports. Capture name must start with "STATE_". "reportOptions.valueMap" can be added to the filter to map captured values to shown state names.
- Report: click on a data point in a report reveals the traces close to it.
- Report: Add zoom, drag and pan feature.

## [0.9.8]
- Sort the Dlt logs explorer tree view by files on first level and then by lifecycles, filters, plugins.
- Fix the bug of multiple entries of same type in Dlt logs tree view.

## [0.9.7]
- Moved activity view into "Logs" (added new "logo") (so that it will appear with smart-logs in one view-container)

## [0.9.6]
- Add "adjustTime" implementation including a "sync to last received time event".

## [0.9.5]
- Add "toggle lifecycle start" button to reports that allow to remove the first part of the lifecycle that contains no log messages.

## [0.9.4]
- Synchronize messages to the report webview.

## [0.9.3]
- Fixed timeSeriesReport not part of package.

## [0.9.2]
- Added time-series report feature

## [0.9.1]
- Add decoration for lifecycles.
- Smaller fixes regarding decorations in case of skipped msgs.
- Small optimizations for decoration rendering.

## [0.9.0]
- Auto time-sync (sending time events on selection of a line) can be turned on/off now with the sync button in the editor title. Default off.
- If turned off the time can be send manually by selecting the "send selected time" context button.
- Detected time-sync events can be resend by using "alt/option" on the sync button in the editor title.

## [0.8.0]

- First implementation of **time-sync** feature.

## [0.7.2]

- Prepared for new time-sync events from smart-log 1.2.0. Currently ignoring them.

## [0.7.1]

- Add filter for payload.

## [0.7.0]

- Add filter for mstp, logLevelMin, logLevelMax.
- Improved output for control messages.

## [0.6.0]

- Add configurable columns (button: select columns... in the upper right corner of each dlt-log document).

## [0.5.3]

- Selecting a file transfer reveals the log line (close to it).

## [0.5.2]

- Announce time updates only every 500ms.
- Debounce visible range / scrolling with 200ms.

## [0.5.1]

- Fix cleanup handling on close document (plugin remained in the list).

## [0.5.0]

- Add FileTransfer plugin. Shows file transfers inside the DLT explorer view and allows to save the files.

## [0.4.1]

- Add icons for LOG_WARN, LOG_ERROR and enable/disable filter commands.

## [0.4.0]

- Add marker support. Still with hard coded log level markers (if decorationIds warning, error, fatal do exist).
- Fix automatic reload of dlt-logs on editor startup.

## [0.3.1]

- Fixed filters with multiple matches using "and" and not "or". So all criteria have to match.

## [0.3.0]

 - Added filter view with enabling/disabling of non load time filters (non persistent)

## [0.2.0]

- Added basic filter support (no marker support yet)

## [0.1.0]

- Initial release without filter support.