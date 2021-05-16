---
id: toggleSortOrder
title: Toggle sort order time vs index
sidebar_label: Toggle sort order
---
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

In the DLT log message view logs are by default shown in the **index** order, i.e. in the order they appear in the DLT file. This usually matches the **received time** order.

If you want to get a better understanding of the **realtime** behaviour of the system it's better to change to **calculated time** order.

Then all messages are sorted by the **calculated time** and not by the **received time** / **index**.

In the message view you can quickly toggle between the sort order by using the left-most button in the upper right corner of each document.

(todo add picture)

:::note
This is especially useful with the [rewrite plugin](rewritePlugin)!
:::
