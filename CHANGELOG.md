# Change Log

All notable changes to the "dlt-logs" extension will be documented in this file.

<!-- Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file. -->

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