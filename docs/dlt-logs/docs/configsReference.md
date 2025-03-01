---
id: configsReference
title: dlt-logs.configs reference
sidebar_label: Configs
---

## Overview

Configs allow to bundle a set of filters to ease the analysis of specific problems.

E.g. you can bundle all filters related to flash problems and then enable/disable all those filters quickly together from the logs tree view.

## Details

### Config attributes

Configs consist of the following attributes:
 
 attribute name | expected type | default value | description
-------------- | ------------- | ------------- | ---
`name` | string | mandatory, so no default | Name for the config. Cannot contain the `/` character. Configs are automatically nested by the `/` character. E.g. a name/path of `foo/bar` defines a config named `foo` with a child config named `bar`.
`autoEnableIf`| string | - | Optional regular expression that is applied on the ECU name. E.g. `ECU1\|ECU2`. If a log file is opened the config is automatically enabled if the ECU name from contained logs matches this regex.

#### Example

E.g. the following settings define one config named `Linux` that gets automatically enabled i.e. all filters [assigned](#assignadd-filters-to-a-config) to it are automatically enabled.
And it defines a 2nd and 3rd config named `RTOS` with a child config named `Schedule` that are not automatically enabled.

```jsonc {1,3,4,7}
"dlt-logs.configs":[
  {
    "name":"Linux",
    "autoEnableIf":"LX1|ECU2" // auto enable for ecu LX1 or ECU2
  },
  {
    "name":"RTOS/Schedule",
  },
]
```

:::note Filters assigned are automatically disabled
After loading a file all filters assigned to a config get automatically disabled!
:::

:::note Configs in tree view
See the `Configs` section in the tree view to quickly enable/disable all filters assigned to that config.
:::

:::note Child configs
Child configs (those created by `/`) are enabled/disabled as well if their parent config gets enabled/disabled.
:::

### Assign/add filters to a config

To add a filter to a config you do need to add the config name/path to the `configs` array attribute of the filter. E.g. 

```jsonc {6}
"dlt-logs.filters":[
  {
    "type":0, // pos. filter
    "apid":"SYS",
    "ctid":"JOUR",
    "configs":["Linux/System"]
  },
  ... // other filters
]
```

This adds the filter with `apid/ctid: SYS/JOUR` to the config `System` which is a child of the linux `Linux` config. The `Linux` config from the upper example gets automatically enabled if logs from `ecu`: `LX1` or `ECU2` exist.
