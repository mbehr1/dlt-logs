---
id: searchPanel
title: Search function
sidebar_label: Search function
---
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

To open the search panel use the command "search dlt logs".

(todo add picture)

The function searches for matching logs with the text in the payload text.
See [Search for ecu/apid/ctid](#search-for-ecuapidctid) on how to restrict/extend the search to ECU/APID/CTID.

### Search modes

The search function has the following modes:

mode name | description
--------- | -----------
`Use current document filter` | The search will be limited to the logs matching the filters set in the current document.
`Use case sensitive` | If set the search considers the case (upper/lower). If not set the search is case-insensitive.
`Use regular expression` | If set the search text is a **regular expression**. E.g. `^error\|^warning` finds only logs starting with `error` or `warning`. <br/>If not set any logs containing the **whole search text** within the payload is found. E.g. `err #2` matches all logs containing exactly `err #2` in the payload.

## Search for ecu/apid/ctid

You can search for / restrict the search text to ECU/APID/CTID logs as well. This is similar to the DLT-Viewer "search header" option.

In general the syntax for ECU/APID/CTID is similar to `adlt convert --eac` cmd line option:
```
ECU:APID:CTID,ECU2:APID2:CTID2[,...]
```

Ecu, apid, ctid are separated by `:`. Empty ones are ignored. E.g. `:apid:` filters for apid only not for ecu. Entries can contain regex chars e.g.
```
ECU1|ECU2::
```
filters for ECU1 or ECU2.

Separate multiple filter by `,`.

### ECU/APID/CTID search in non regular expression mode

In normal / non regular expression search mode a ECU/APID/CTID search can be performed adding the following expression to the start of the search text.

The ECU/APID/CTID expression must be prepended with an `@` and the normal search string needs to be separated with a space. E.g.
```
@ECU1 needle
```
searches for `needle` within all logs from `ECU1`.

The ECU/APID/CTID syntax is only evaluated if it's directly at the start of the search string after the `@`.

:::tip
If you want dont want to search for ECU/APID/CTID but you first search word starts with `@` add a space in front.
:::

#### Examples:

Search string | description
------------- | -----------
`@ECU1:APID needle` | searches for `needle` in the payload text of all logs from ecu `ECU1` with apid `APID`.
` @ needle` | searches for `@ needle`in the payload text of all logs. (see the space at the front, which is not searched for)
`@ECU1::CTID,ECU2 error` | searches for `error` in the payload text of all logs from ecu `ECU1` with ctid `CTID` or from ecu `ECU2`.

### ECU/APID/CTID search in regular expression mode

In regular expression mode...

```
@ECU1 ^foo|@ECU2:API2 bar|error
```

searches for logs from `ECU1` starting with `foo` or logs from `ECU1:API2` containing bar or any log containing `error`

:::note
If the ECU/APID/CTID expression contains a regular expression with the `\|` symbol the whole expression needs to be put in round brackets! E.g. `@(ECU1|ECU2) ...`.
:::

:::tip
Same logic applies as for non regular expression mode: if you want to search for a regex starting with `@` prefix it with a space.
If you want to search for a regex starting with a space and a `@` use `\ @`.
:::

#### Examples:

Search&nbsp;string&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | description
------------- | -----------
`@ECU1:APID needle\|error`| searches for logs from `ECU1:APID` containing `needle` or for any logs with `error` in the payload.
`@ECU1 (foo\|bar)` | searches for logs from `ECU1` containing `foo` or `bar`
` @ECU1 foo\|bar` | searches for any logs containing `@ECU1 foo` or `bar` (see the space at the start)
`@ECU1 (foo\|@ECU2 bar)` | searches for logs from `ECU1` containing `for` or `@ECU2 bar` (the @ECU2 is not an outer disjunction alternative!)
`@ECU1 foo\|@ECU2 bar` | searches for logs from `ECU1` containing `for` or from `ECU2` containing `bar`
`@:APID foo\|@::CTID bar` | searches for logs with apid `APID` containing `for` or with ctid `CTID` containing `bar`
`@(:AP1\|AP2) foo\|@::CTID (bar\| @foo)`| searches for logs with -- apid `AP1` or apid `AP2` containing `for` -- or with ctid `CTID` containing `bar` or ` @foo` (space @foo).<br/>**Take care: here the ECU/APID/CTID expression must be surrounded by brackets as it contains a `\|`!**
`@:APID`| searches for all logs with apid `APID`
`@:APID,::CTID foo`| searches for `foo` in all logs with apid `APID` or ctid `CTID`

:::note implementation detail
The search string is first parsed as a regular expression and for all disjunction alternatives (the parts splitted by `|`) it's checked whether a part starts with `@` followed by a ECU/APID/CTID search syntax followed by a space. So the upper example is divided into:
```
@ECU1 ^foo
```
```
@ECU2:API2 bar
```
and
```
error
```

Those are transformed into 3 separate filters:

1. ecu `ECU1`, payloadRegex `^foo`
2. ecu `ECU2`, apid: `API2`, payloadRegex `bar`
3. payloadRegex `error`
:::
