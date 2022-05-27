---
id: reports
title: Report generation
---
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
import ImageSwitcher from './ImageSwitcher';
import useBaseUrl from '@docusaurus/useBaseUrl';

You can create **Graphical time series reports** based on event filters. E.g.:

<ImageSwitcher 
lightImageSrc={useBaseUrl("/img/timeSeriesReport2.png")}
darkImageSrc="https://github.com/mbehr1/dlt-logs/raw/master/images/timeSeriesReport1.png"/>

## Example

### Identify the log messages

Assuming you're having log messages like:
```
MON CPUS info CPU usage in interval : 42.1% cpu since boot : 21.0% Total thread cpu load : 15.5%
```
and you do want to create a graph of the three values.

### Define the filter

Open **Preferences: Open Settings (JSON)** and add a filter:
```json {3,6}
"dlt-logs.filters":[
  {
      "type": 3,
      "apid": "MON",
      "ctid": "CPUS",
      "payloadRegex": "CPU usage in interval : (?<cpu_usage>.*)% cpu since boot : (?<cpu_since_boot>.*)% Total thread cpu load : (<thread_cpu_load>*)%"
  }
]
```
:::note
The filter will be used on all messages independent whether the messages are hidden by other view-filters (positive or negative).

Exceptions are load-time filters that are already applied at load time of the DLT file and did remove the messages completely.
:::

### Open a dlt file and generate the report

To open a report simply open a DLT log file and press the report icon in the filter:

![open report icon](/img/timeSeriesReport4.png)

### Zooming in a report

To zoom in/out simply there are two different modes:

In default / non drag mode simply 
- use the mouse wheel (or e.g. two finger up/down gestures on macOS touchpads),
- click and drag the report to scroll left/right.

In "drag mode" - after pressing the `Enable drag mode` button - simply
- select the time range by press and hold the mouse button at start time and drag to end time and release there.

You can always press the `Reset zoom` button to get back to default view.

### Ignore lifecycle start range

The `Toggle lifecycle start` button allows you to hide the start of the report with no data points.
In general the report covers the timeframe from all [lifecycles](lifecycleDetection).
E.g. in the picture from the example above the first lifecycle starts at 5:41:05pm but the first logs start only at 5:42:29pm. The default view is useful to e.g. understood how the lifecycle was already running before the logs have been captured or exported.
With the `Toggle lifecycle start` button you can toggle the view to hide/show the timeframe where no logs are available for.

### Show the current selected time

The report highlights the selected time - i.e. the time that corresponds to the selected line in the DLT file with a vertical green dotted line, e.g. here at 5:42:41 PM and 22ms:

![report with selected time](/img/timeSeriesReport2.png)

If you move the cursor in the dlt log window the selected time will move accordingly.

:::note
Reports use your current selected theme colors, here e.g. `Light+`.
:::

### Show the times for all search results

You can as well select multiple lines e.g. from search results:
<Tabs
    groupId="operating-systems"
    defaultValue="win"
    values={[
        {label: 'Windows', value: 'win'},
        {label: 'macOS', value: 'mac'},
        {label: 'Linux', value: 'linux'}
    ]
}>
<TabItem value="win">Use Ctrl+f, enter your search text and use Ctrl+Shift+L</TabItem>
<TabItem value="mac">Use Cmd+f, enter your search text and use Cmd+Shift+L</TabItem>
<TabItem value="linux">Use Ctrl+f, enter your search text and use Ctrl+Shift+L</TabItem>
</Tabs>
to select all occurrences of the search text, e.g:

![report with multiple selections](/img/timeSeriesReport3.png)

The picture shows as well the tooltip window that appears on hovering over a data point.

### Jump to DLT log message around a selected data point

If you click on a data point in the report the DLT log window tries to scroll the top to the next message that occured around the time from the data point.

## Details

You can define event filters (type: 3), add normal filters like ecu, apid, ctid and use a payloadRegex that captures either one value or even multiple values with named capture groups (?\<series\_name\>.*). 

### Capture group names and types

By default all captures needs will be parsed as float numbers. You can change that behaviour by prefixing the capure name with STATE\_ or INT\_ (see below).

value name | expected type | comment
---------- | ------------- | -------
STATE_* | enum | Used to represent distinct states. Will use 2nd axix. Can be ints or strings. See reportOptions/valueMap on how to map to better readable names.
EVENT_* | float | will use scatter/event - dot based and not line based chart.
TL_* | enum | Used to create data for [timeline / swimlane charts](#timeline--swimlane-charts). Details see [TL format details](#tl_-format-details). If TL_ datapoints are used the timeline chart will appear as well.
INT_* | int | will use parseInt(). Can be used if e.g. hex values should be converted.
other | float | will use parseFloat().

:::note
STATE\_ and EVENT\_ logically exclude each other as you do either want to draw a state diagram or a scatter/point diagram.

INT\_ logically would fit as well for STATE\_ or EVENT˜_ but this can't be encoded using the value name. So e.g. if you need to convert hex values this is possible using a **conversionFunction** that converts the value already. E.g. 

```json
return { 'STATE_foo': Number.parseInt(matches[1])};
```
:::

Grid lines for lifecycle start/ends are automatically added. 

### Mapping values to names

It's often desirable to map values to names for to ease readability. E.g.

value | name
----- | ----
0 | low
1 | high
255 | unknown

An easy way is to define a `valueMap` by adding a it to the `reportOptions`object for the filter:

```json {7}
{
  "type": 3,
  "apid": "...",
  "ctid": "...",
  "payloadRegex": "^value = (?<STATE_a>.*)$",
  "reportOptions": {
      "valueMap": {
          "STATE_a": [
              {
                  "1": "high"
              },
              {
                  "0": "low"
              },
              {
                  "255": "unknown"
              }
          ]
      }
  }
}
```

### Using a function to calculate values

For more versatile changes a `conversionFunction` can be added to the `reportOptions`object:

#### conversionFunction example

```json
{
  ...
  "payloadRegex": "Idle0\\s+.*\\s(.*)%",
  "reportOptions": {
    "conversionFunction": "return { 'cpu_idle0': matches[1],'INT_limit':'0x64' }"
  }
}
```
in this example the `conversionFunction` is returning two values: cpu\_idle0 as the captured value and a 2nd value INT\_limit with const value 100.

#### conversionFunction prototype and parameters

The `conversionFunction` should accept two parameters `matches` and `params` and return an object. E.g. as typescript prototype:

```typescript
(matches: RegExpExecArray | null | undefined, params: {} ) : Object
```

it will be created as function like this

```javascript
convValuesFunction = Function("matches,params", filter.reportOptions.conversionFunction);                                        
```

`matches`is the return value from the corresponding RegExp.exec(...) (see ...).
`params`is an Object like

```javascript
params = {
  localObj : {}, // will be exclusive for this filter. Initially empty obj.
  reportObj : {} // will be shared between all filters for this report
  msg : { // message object that matched the filter.
    // currently as "stable api" only the following properties should be accessed:
    timeStamp : Number // timeStamp of the msg in 0.1ms resolution
    lifecycle : {} // Object per lifecycle detected (see ...)
  }
}
```

#### usage

The `conversionFunction`can be used to modify the captured values for that event or to add new values.

It can store values/properties in either the localObj to e.g. do calculations like "max" or even reportObj to exchange data between filters and their corresponding conversion functions.

It needs to be a JS function returning an array of objects { valueName: value } and gets the regex 'matches' as parameter. Additional parameter is "params" which is an object with msg, localObj and reportObj. E.g. "return {'limit':42};" for a static value. or "return {'timeStamp': params.msg.timeStamp/10000};". 

`localObj` is initially an empty Object {} that can be used to store properties for that filter (e.g. interims data for calculations).  `reportObj` is an Object similar to localObj but shared between all filters.

:::note
As `reportObj` is shared between all filters you do need to take care for property name clashes! Use reportObj only if you really want to share data between filters.
:::

:::note
Currently the conversionFunction is only called if the payloadRegEx matches the payload. This will be changed in a upcoming version.
:::

:::note
Via the params.msg.lifecycle object you can e.g. check whether the msg belongs to a new lifecycle and reset e.g. some variables inside the localObj.
E.g.
```javascript
let lastLc = params.localObj['lifecycle'];
if (lastLc !== params.msg.lifecycle) {
  params.localObj['lifecycle'] = params.msg.lifecycle;
  ... // do other stuff on new lifecycle...
}
```
:::

todo ... add liveeditor to convert a function into the json string repr.

### Specifying y-axis options

By default there are two different y-axes used. One for all numerical values and one for all **enums** or **strings** e.g. from a value map.
Both axes are shown on the left hand side.

Especially for numerical values if you use multiple datasets or even multiple reports (see below) you might want to specify different y-axis options.

For those cases a `yAxes` object can be added to the `reportOptions`object:

#### yAxes examples

```jsonc
{
  ...
  "payloadRegex": "Temp\\s+.*\\s(?<temp>.*) deg",
  "reportOptions": {
    "yAxes": {
      "temp":{ // either dataset/capture name or a regex as wildcard, e.g. "^(temp_0|temperature)$"
        "type": "linear", // or logarithmic or category, optional
        "position": "right", // or left, optional
        "min": -20,
        "max": 60,
        "title":{
          "display": true,
          "text": "temp in °C"
        }
      }
    }
  }
}
```
in this example a right hand side, linear axis with range [-20,60] and label "temp in °C" is used for the `temp` dataset.

```jsonc
{
  ...
  "payloadRegex": "State\\s+.*\\s(?<STATE_onOff>.*)",
  "reportOptions": {
    "yAxes": {
      "STATE_onOff":{
        "type": "category", // or logarithmic or category, optional
        "position": "right",
        "reverse": true // the default used y-axis for enums/strings uses reverse:true
      }
    }
  }
}
```
in this example a right hand side, category axis is used for the `STATE_onOff` dataset.

#### yAxes keys

The yAxes key names can either be the capture / data set names (e.g. temp in the upper example) or they can be a regular expression.
A regular expression might be usefull if you have multiple capture values, e.g. temp0 ... temp9. In those cases just one y-axis definition will be sufficient. Simply use `^temp.*` as yAxes key.

```jsonc
{
  ...
  "payloadRegex": "Temp\\s+(?<temp0>.*)\\s(?<temp1>.*) deg",
  "reportOptions": {
    "yAxes": {
      "^temp.*":{ // key name can be a regular expression as well
      ...
      }
    }
  }
}
```

:::note
The yAxes options are **global** for the full report. So if a different report is shown as well (see below) then all yAxes are known and might match!
:::

:::note
For a full list of options for each y-axis see the [chartjs doc](https://www.chartjs.org/docs/latest/axes/cartesian/) for cartesian axes. The format changed for chartjs v3 significantly. Please use v3 options.
:::

:::warning
Do not set the `id` key as this will be automatically set.
:::

### Opening one report or multiple reports in one graph

To open a report simply press on the "report" icon next to the filter.

![open report icon](/img/timeSeriesReport4.png)

You can visualize multiple reports in the same view by simply clicking the 2nd report while keeping the first report view open.

If you want to open the report as a new view you can hold the alt/options key before clicking the report icon.

:::note
Multiple reports share the same y-axis. So if you mix small values (e.g 0-1) with huge values (0-1000) you loose all details from the small values. See [y-axis options](#specifying-y-axis-options) above on how to avoid that.
:::

## Timeline / swimlane charts

By using `TL_` events you can generate "timeline/swimlane" charts like:
todo add picture

Each swimlane belongs to one group.

:::note
If you use it with a regular graphical report in one graph this helps e.g. to map CPU load and similar data to states from state machines like services active/not active, ports open/closed...
:::

### Collapsing/expanding groups

Groups can be collapsed, i.e. drawn as a single lane by clicking on the group name. To expand it click on the group name again.

:::note
If a group contains more than 10 lanes it's automatically *collapsed*.
Simply click on the group name to *expand* it.
:::

### Interaction

- The selected time from the dlt-log line is shown in the swimlane as a vertical line.
- The timeline / swimlane view adjusts automatically to the selected timerange in the graphical report on top.
- On selection of a swimlane event the start/end time gets shown in the graphical report.
- Clicking on the label hides the start/end time.
- The ruler below the swimlanes can be used to change zoom or move the selected time range.

### TL_ format details

The name for the `TL_` event/datapoint should follow a specific syntax:

`TL_<groupname>_<lanename>`.

:::note
`groupname` should contain only [a-zA-Z0-9.-] and not `_|,:;\/`.
 `lanename` can additionally contain `_`.
:::

The value can be single numbers or strings but it allows to provide some more information:

`<value>[|tooltip[|color][|,$]]`.

attribute | description
--------- | -----------
value | Number or string with the value. If no color is used the value added to the legend on top of the swimlanes.
tooltip | optional tooltip that gets shown on mouse hover. Keep empty if only color should be provided (e.g. <code>\|\|</code> )
color | optional color in html format (e.g. 'red' or #ff0000). If color is provided the value is not added to the legend.
<code>\|</code> | optional indicator that the value ends here. Usually swimlane events are like states and will be drawn until the lifecycle ends or the next value appears. The parser checks whether the pipe symbol  is at the end of the value.
<code>$</code> | optional indicator that the value persists lifecycle boundaries. So this value will be drawn until the next event in that lane occurs. The parser checks whether the dollar symbol is at the end of the value. To not make the `$` part of the value, tooltip or color it's best to prepend with a <code>\|</code>.

### Examples

TL_name:value | description
------------- | -----------
<code>TL_group1_lane1:"active\|\|green"</code> | lane1 in group1 showing value "active" and no specific tooltip in color green until the lifecycle end or the next event in lane1.
<code>TL_group1_lane2:"reset\|lane 2 had a reset\|red\|"</code> | lane2 in group1 showing value "reset" and tooltip "lane 2 had a reset" for that timepoint only in color red.
<code>TL_group1_lane2:"up\|startup done"</code> | lane2 in group1 showing value "up" and tooltip "startup done" in any of the default colors.
<code>TL_group1_lane2:"unavailable\|port not open\|\|$"</code> | lane2 in group1 showing value "unavailable" and tooltip "port not open" until next value even if in new lifecycle.
