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
```
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
INT_* | int | will use parseInt(). Can be used if e.g. hex values should be converted.
other | float | will use parseFloat().

Grid lines for lifecycle start/ends are automatically added. 

### Mapping values to names

It's often desirable to map values to names for to ease readability. E.g.

value | name
----- | ----
0 | low
1 | high
255 | unknown

An easy way is to define a `valueMap` by adding a it to the `reportOptions`object for the filter:

```
{
  "type": 3,
  "apid": "...",
  "ctid": "...",
  "payloadRegex": "^value =  (?<STATE_a>.*)$",
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

todo ... incl. liveeditor

### Opening one report or multiple reports in one graph

To open a report simply press on the "report" icon next to the filter.

todo picture

You can visualize multiple reports in the same view by simply clicking the 2nd report while keeping the first report view open.

If you want to open the report as a new view you can hold the alt/options key before clicking the report icon.

:::note
Multiple reports share the same y-axis. So if you mix small values (e.g 0-1) with huge values (0-1000) you loose all details from the small values.
:::
