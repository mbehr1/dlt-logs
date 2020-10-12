---
id: lifecycleDetection
title: Lifecycle detection
sidebar_label: Lifecycle detection
---

DLT-Logs tries to detect the different **lifecycles** from the different OSs on the ECUs contained inside the DLT log file.

## Definition

A **lifecycle** is defined per ECU beginning with the timestamp 0 to the timestamp of the last message.

The **timestamp** by DLT definition is relative from boot/startup of the ECU/CPU (e.g. linux kernel) and expresses the time since boot in 0.1ms granularity.

If your ECU has multiple different OSs/CPUs running they should use one ECU identifier per OS/CPUs, e.g. one for the linux kernel running, one for the OSEK system as those systems might have different times on when they will be started/rebooted.
They might use different clocks as well and have slight clock-skews.

Even though lifecycles by this definition do only contain the relative timestamp based range and not the absolute **recording time** based time range DLT-Logs maps the lifecycles to absolute times. See How it works for details.

## Show the detected lifecycles

The detected lifecycles will be shown in the sidebar in the **DLT LOGS EXPLORER** window in the **Detected lifecycles** tree node.

todo picture.

If you select a lifecycle the log view window will scroll automatically to the first detected message of that lifecycle.

:::note
Every 2nd lifecycle in the log view windows will use a slightly different background color to help understanding where new lifecycle started.
todo picture
:::

## Lifecycle based features

Lifecycles become handy e.g. on [exporting](exportAndFilter) logs.

## How it works

todo...

### Buffering issues explained

todo...