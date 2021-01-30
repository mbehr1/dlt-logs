---
id: reports
title: Report generation
---
You can create **Graphical time series reports** based on event filters. E.g.:

![Graphical time series reports](https://github.com/mbehr1/dlt-logs/raw/master/images/timeSeriesReport1.png)

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

todo add picture.

### Zooming in a report

todo

### Ignore lifecycle start range

todo

## Details

You can define event filters (type: 3), add normal filters like ecu, apid, ctid and use a payloadRegex that captures either one value or even multiple values with named capture groups (?\<series\_name\>.*). 

### Capture group names and types

By default all captures needs will be parsed as float numbers. You can change that behaviour by prefixing the capure name with STATE\_ or INT\_ (see below).

value name | excected type | comment
---------- | ------------- | -------
STATE_* | enum | Used to represent distinct states. Will use 2nd axix. Can be ints or strings. See reportOptions/valueMap on how to map to better readable names.
EVENT_* | float | will use scatter/event - dot based and not line based chart.
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

### using a function to calculate values

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
        "ticks": {
          "min": -20,
          "max": 60
        },
        "scaleLabel":{
          "display": true,
          "labelString": "temp in °C"
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
        "ticks": {
          "reverse": true // the default used y-axis for enums/strings uses reverse:true
        }
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
For a full list of options for each y-axis see the [chartjs doc](https://www.chartjs.org/docs/latest/axes/cartesian/) for cartesian axes.
:::

:::warning
Do not set the `id` key as this will be automatically set.
:::

### Opening one report or multiple reports in one graph

To open a report simply press on the "report" icon next to the filter.

todo picture

You can visualize multiple reports in the same view by simply clicking the 2nd report while keeping the first report view open.

If you want to open the report as a new view you can hold the alt/options key before clicking the report icon.

:::note
Multiple reports share the same y-axis. So if you mix small values (e.g 0-1) with huge values (0-1000) you loose all details from the small values.
:::
