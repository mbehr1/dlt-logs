/**
 * time-line / swimlanes alike chart based on TL_ states/events.
 * (c) Matthias Behr, 2021
 *
 * todo:
 * - investigate color from first partially shown are wrong
 * - after expand/collapse keep prev. time zoom
 * - once PR https://github.com/vasturiano/timelines-chart/pull/28 is supported/merged
 *  add text to the rectangles
 */

let onZoomCallback = undefined;
let onSelectTimeCallback = undefined;

const handleZoom = ([startDate, endDate], [startY, endY]) => {
    console.log(`handleZoom ${startDate}-${endDate}, ${startY}-${endY}`);
    if (onZoomCallback) {
        onZoomCallback(startDate, endDate);
    }
};

const colorScaleData = {
    colors: ['steelblue', 'lightblue'],
    domains: []
};
const colorScale = (a) => {
    const v = typeof a === 'string' ? a : a.v;
    const color = typeof a === 'object' ? a.c : undefined;
    if (color) { return color; } // dont add to domain?
    const index = colorScaleData.domains.indexOf(v);
    if (index >= 0) {
        return colorScaleData.colors[index % colorScaleData.colors.length];
    } else {
        // console.log(`colorScale`, a, v);
        colorScaleData.domains.push(v);
        return colorScaleData.colors[(colorScaleData.domains.length - 1) % colorScaleData.colors.length];
    }
};
colorScale.domain = (a) => {
    if (a !== undefined) {
        console.log(`colorScale.domain(...) nyi`, a);
    }
    return colorScaleData.domains; // todo if a then set/merge domains
};

const segmentTooltipContent = (seg) => {
    const startTime = seg.timeRange[0];
    const endTime = seg.timeRange[1];
    const toolTip = seg?.val.t;
    if (startTime === endTime) {
        return `'${seg.group}.${seg.label}' = '<strong>${seg.labelVal}</strong>'${toolTip ? `<br>${toolTip}<br>` : '<br>'}${moment(startTime).format('LTS.SSS [ms]')}`;
    } else {
        const durS = (endTime - startTime) / 1000;
        return `'${seg.group}.${seg.label}' = '<strong>${seg.labelVal}</strong>'${toolTip ? `<br>${toolTip}<br>` : '<br>'}${moment(startTime).format('LTS.SSS [ms]')}-${moment(endTime).format('LTS.SSS [ms]')}<br>duration ${durS.toFixed(3)}s`;
    }
};

const handleSegmentClick = (ev) => {
    console.log(`handleSegmentClick`, ev);
    if (onSelectTimeCallback) {
        onSelectTimeCallback([
            { label: `${ev.group}_${ev.label}=${ev.labelVal} start`, value: ev.timeRange[0] },
            { label: `${ev.group}_${ev.label}=${ev.labelVal} end`, value: ev.timeRange[1] }]);
    }
};

const copyVal = (val) => {
    const toRet = { ...val, isCopied: true };
    toRet.timeRange = [...val.timeRange];
    toRet.val = { ...val.val };
    return toRet;
};

// adapted from here: https://stackoverflow.com/questions/30472556/how-to-find-all-overlapping-ranges-and-partition-them-into-chunks/30473019
const partitionIntoOverlappingRanges = (array) => {
    if (!array.length) { return array; }
    array.sort(function (a, b) {
        if (a.timeRange[0].valueOf() < b.timeRange[0].valueOf()) { return -1; }
        if (a.timeRange[0].valueOf() > b.timeRange[0].valueOf()) { return 1; }
        // equal start, sort by end:
        if (a.timeRange[1].valueOf() < b.timeRange[1].valueOf()) { return -1; }
        if (a.timeRange[1].valueOf() > b.timeRange[1].valueOf()) { return 1; }
        return 0;
    });
    var rarray = [];
    var g = 0;
    rarray[g] = array[0];

    for (var i = 1, l = array.length; i < l; i++) {
        const arrIStart = array[i].timeRange[0].valueOf();
        const arrIEnd = array[i].timeRange[1].valueOf();
        const rIStart = rarray[g].timeRange[0].valueOf();
        const rIEnd = rarray[g].timeRange[1].valueOf();
        //console.log(`collapse: rI=${rIStart}-${rIEnd} arrI=${arrIStart}-${arrIEnd}`);
        if (((arrIStart >= array[i - 1].timeRange[0].valueOf()) && (arrIStart < rIEnd))
            || (arrIStart === rIStart)
        ) { // do overlap -> merge with the first
            // need to do a copy first to not modify the orig object
            if (!rarray[g].isCopied) {
                rarray[g] = copyVal(rarray[g]);
            }

            // we do overlap so we have 3 new areas:
            // start, overlap, end
            const lastR = rarray[g];
            const r1 = [lastR.timeRange[0].valueOf(), arrIStart];
            const r2 = [arrIStart, Math.min(arrIEnd, lastR.timeRange[1].valueOf())];
            const r3 = [Math.min(arrIEnd, lastR.timeRange[1].valueOf()), Math.max(arrIEnd, lastR.timeRange[1].valueOf())];
            const hasR1 = r1[0] < r1[1];
            const hasR2 = true; // r len===0 r2[0] < r2[1];
            const hasR3 = r3[0] < r3[1];
            // const r3IsArrI = arrIEnd > lastR.timeRange[1].valueOf();
            // const newR3 = hasR3 ? copyVal(r3IsArrI ? array[i] : lastR) : undefined;
            if (hasR1) {
                // reduce rarray to this one, but keep params
                rarray[g].timeRange = r1.map(r => new Date(r));
                //console.log(` collapse:modified r1`);
            }
            if (hasR2) { // overlapping area
                if (hasR1) {
                    // need to insert a new one:
                    g++;
                    rarray[g] = copyVal(rarray[g - 1]);
                    // console.log(` collapse:appended r2`);
                } else {
                    // console.log(` collapse:modified r2`);
                }
                rarray[g].timeRange = r2.map(r => new Date(r));
                if (rarray[g].labelVal !== array[i].labelVal) {
                    rarray[g].labelVal = 'collapsed';
                }
                rarray[g].val.v = 'collapsed';
                rarray[g].val.t = undefined;

                if (rarray[g].val.c !== array[i].val.c) {
                    rarray[g].val.c = 'DimGray';
                }
            }
            if (hasR3) { // we cannot append as the next array item might have a smaller start then...
                rarray[g].timeRange[1] = new Date(r3[1]);
            }

        } else {
            if (arrIEnd === rIEnd) {
                // they might have len 0 and end===end:
                // console.log(` collapse:end===end ignored`);
            } else {
                g++;
                rarray[g] = array[i];
                // console.log(` collapse:appended non overlapping`);
            }
        }
    }
    return rarray;
};

const collapsedLabelText = 'collapsed';
const collapsedLabelCol = 'Tan'; // or 'Sienna'; //? a brown color (mix of colors...)

// from https://stackoverflow.com/questions/30304719/javascript-fastest-way-to-remove-object-from-array
const arrayRemoveIf = (array, pred) => {
    let i, j;

    for (i = 0, j = 0; i < array.length; ++i) {
        if (!pred(array[i])) {
            array[j] = array[i];
            ++j;
        }
    }

    while (j < array.length) {
        array.pop();
    }
};

const reduceOverlapping = (array) => {
    if (!array.length) { return array; }
    array.sort(function (a, b) {
        if (a.timeRange[0].valueOf() < b.timeRange[0].valueOf()) { return -1; }
        if (a.timeRange[0].valueOf() > b.timeRange[0].valueOf()) { return 1; }
        // equal start, sort by end:
        if (a.timeRange[1].valueOf() < b.timeRange[1].valueOf()) { return -1; }
        if (a.timeRange[1].valueOf() > b.timeRange[1].valueOf()) { return 1; }
        return 0;
    });
    var rarray = [];
    var g = 0;
    let prevVal = undefined;

    const nextMinStartTime = (array, minTime) => {
        const elem = array.find(e => e.timeRange[0].valueOf() > minTime);
        if (elem) { return elem.timeRange[0].valueOf(); }
        return undefined;
    };
    const minEndTime = (array, startTime) => {
        // find the min end time from elems with startTime <= startTime
        const indexOfNextStartTime = array.findIndex(e => e.timeRange[0].valueOf() > startTime);
        if (indexOfNextStartTime >= 0) {
            let minTime = array[0].timeRange[1].valueOf();
            for (let i = 0; i < indexOfNextStartTime; ++i) {
                const e = array[i];
                if (e.timeRange[1].valueOf() < minTime) { minTime = e.timeRange[1].valueOf(); }
            }
            return minTime;
        } else {
            // they are sorted be endtime?
            let minTime = array[0].timeRange[1].valueOf();
            array.forEach((e) => { if (e.timeRange[1].valueOf() < minTime) { minTime = e.timeRange[1].valueOf(); } });
            return minTime;
        }
    };


    let startTime = array[0].timeRange[0].valueOf();
    while (array.length) {
        //console.log(`collapse: array[0]=${array[0].timeRange[0].valueOf()}-${array[0].timeRange[1].valueOf()} startTime=${startTime}`);
        // determine next startTime > startTime
        const minStartTime = nextMinStartTime(array, startTime);
        // determine min endTime from all with curr starttime
        const minEnd = minEndTime(array, startTime);

        const endTime = minStartTime === undefined ? minEnd : Math.min(minStartTime - 1, minEnd); // we'll end at next end or one before next start
        //console.log(`collapse: r=${startTime}-${endTime}, minStartTime=${minStartTime} minEnd=${minEnd}`);
        if (startTime === undefined || endTime === undefined) { break; }
        if (startTime > endTime) {
            console.warn(`logical error. endTime < startTime`);
            break;
        }
        // find all items that fall into that range:
        const indexOfFirstOutSideTmp = array.findIndex(e => e.timeRange[0].valueOf() > endTime);
        const indexOfFirstOutSide = indexOfFirstOutSideTmp < 0 ? array.length : indexOfFirstOutSideTmp;
        // determine common values...
        let newLabelVal = array[0].labelVal;
        let newColor = array[0].val.c;
        if (indexOfFirstOutSide > 1) {
            for (let i = 1; i < indexOfFirstOutSide; ++i) {
                const el = array[i];
                if (el.labelVal !== newLabelVal) {
                    newLabelVal = collapsedLabelText;
                    break;
                }
            }
            for (let i = 1; i < indexOfFirstOutSide; ++i) {
                const el = array[i];
                if (el.val.c !== newColor) {
                    newColor = collapsedLabelCol;
                    break;
                }
            }
        }

        // create item with startTime/endTime
        prevVal = copyVal(array[0]);
        prevVal.timeRange[0] = new Date(startTime);
        prevVal.timeRange[1] = new Date(endTime);
        prevVal.val.v = newLabelVal;
        prevVal.val.t = undefined; //`indexOfFirstOutSide=${indexOfFirstOutSide}`;
        prevVal.val.c = newColor;
        prevVal.labelVal = newLabelVal;
        rarray.push(prevVal);

        // erase all items that have endTime<=endTime
        // we cannot rely on sorting by endTime here as the startTimes are sorted first...
        // todo find a faster way to abort search... this one is at least O(n)! (but called often)
        // might better revert sort order from the array and access last elem instead of first...
        const arrLenBefore = array.length;
        arrayRemoveIf(array, e => e.timeRange[1].valueOf() <= endTime);
        let removed = arrLenBefore - array.length;
        if (array.length > 0) {
            const firstElemStart = array[0].timeRange[0].valueOf();
            const oldStart = startTime;
            startTime = firstElemStart > endTime ? firstElemStart : (endTime + 1);
            if (!removed && oldStart === startTime) {
                array = [];
                console.warn(`logical error. none removed and startTime same`);
            }
        }
    }

    return rarray;
};

const collapseOrExtendGroup = (groupName) => {
    let doUpdate = false;
    try {
        const groupObjArr = timelineData.filter(a => a.group === groupName);
        if (groupObjArr.length === 1) {
            const groupObj = groupObjArr[0];
            const groupData = groupObj.data;
            const isCollapseable = groupData.length > 1;
            const isExtendable = groupData.length === 1 && groupObj.origData?.length > 1;
            console.log(` group '${groupObj.group}' isCollapseable=${isCollapseable} isExtendable=${isExtendable}`);
            if (isCollapseable) { // collapse
                const t0 = performance.now();
                groupObj.origData = groupObj.data;
                if (groupObj.collapsedData !== undefined) {
                    groupObj.data = groupObj.collapsedData;
                } else {
                    const collapsedData = [];
                    groupObj.data.forEach(labelData => collapsedData.push(...(labelData.data)));

                    groupObj.data = [
                        {
                            label: "collapsed",
                            data: reduceOverlapping(collapsedData) // partitionIntoOverlappingRanges(collapsedData)
                        }];
                    groupObj.collapsedData = groupObj.data;
                }
                const t1 = performance.now();
                console.log(` collapsing ${groupName} took ${t1 - t0}ms`);
                //console.log(` collapsed data=`, groupObj.data);
                doUpdate = true;
            } else if (isExtendable) { // extend
                groupObj.data = groupObj.origData;
                // todo could remove key origData
                doUpdate = true;
            }
        } else {
            console.log(` bug! filter returned != 1. length=${groupObjArr.length}`);
        }
    } catch (e) {
        console.log(`collapseOrExtendGroup got e=${e}`);
    }
    return doUpdate;
};

const handleLabelClick = (labelOrGroup, group) => {
    console.log(`handleLabelClick`, labelOrGroup, group);
    try {
        if (group === undefined) { // click on group... (but name in labelOrGroup)
            // collapse or extend the group
            const doUpdate = collapseOrExtendGroup(labelOrGroup);
            if (doUpdate) {
                timelineChart.data(timelineData);
            }
    } else { // click on label
        // unselect any selected one
        // todo could be more sophisticated and allow e.g. one per label being selected
        // or all from label (e.g. then start only?)
        if (onSelectTimeCallback) {
            onSelectTimeCallback([]);
        }
    }
    } catch (e) {
        console.log(`handleLabelClick got e=${e}`);
    }
};

let timelineData = [];
let timelineChart = undefined; // TimelinesChart();

const MARKER_FINISH = '|';
const MARKER_PERSIST = '$';

const addTimeLineData = (groupName, labelName, valueName, time, options) => {
    // valueName can contain tooltip desc. and color as well.
    // valueName [|tooltip[|color]][MARKER]
    let group = timelineData.find(g => g.group === groupName);
    if (!group) {
        group = { group: groupName, data: [] };
        timelineData.push(group);
    }
    let label = group.data.find(l => l.label === labelName);
    if (!label) {
        label = { label: labelName, data: [] };
        group.data.push(label);
    }
    // let the prev end here:
    if (label.data.length > 0) {
        const prevValue = label.data[label.data.length - 1];
        // if the prev one is not finished yet and
        // its not a lifecycle end for a persisted one
        if (!prevValue.isFinished &&
            !(options && options.lcEnd && prevValue.isPersisted)) {
            prevValue.timeRange[1] = time; // no need to use earlier time
            // if we wont add a data point need to set finished here
            if (!valueName) { prevValue.isFinished = true; }
        }
    }
    if (!valueName || valueName.length === 0) {
    } else {
        const isFinished = valueName.endsWith(MARKER_FINISH) ? true : undefined;
        const valueParts = valueName.split('|');
        const labelVal = valueParts[0];
        const valueTooltip = valueParts[1]; // works for isFinished as well -> ''
        const valueColor = valueParts[2]; // could be undef.
        label.data.push({
            timeRange: [time, isFinished ? new Date(time.valueOf() + 1) : new Date(time.valueOf() + (3600) * 1000)], // todo determine better end
            val: { g: groupName, l: labelName, v: labelVal, c: valueColor, t: valueTooltip?.length ? valueTooltip : undefined },
            labelVal: labelVal,
            isFinished: isFinished,
            isPersisted: valueName.endsWith(MARKER_PERSIST) ? true : undefined,
        });
    }
};

let widthOffset = null;

const resizeObserver = new ResizeObserver((entries) => {
    //console.log(`resizeObserver`, entries);
    if (entries.length) {
        const rect = entries[0].contentRect;
        //console.log(` w cur=${timelineChart.width()} new=${rect.width} widthOffset=${widthOffset}`);
        if (widthOffset !== null) {
            if (timelineChart.width() - widthOffset !== rect.width) {
                timelineChart.width(rect.width + widthOffset);
            }
        } else {
            widthOffset = timelineChart.width() - rect.width;
        }
    }
});

const timelineChartUpdate = (options) => {
    if (!options) { return; }
    const { datasets = undefined, selectedTime = undefined, zoomX = undefined, onZoom = undefined, onSelectedTime = undefined } = options;
    if (onZoom) { onZoomCallback = onZoom; }
    if (onSelectedTime) { onSelectTimeCallback = onSelectedTime; }
    if (datasets) {
        timelineData = [];
        console.log(`timelineChartUpdate got data`);
        // todo cleanup into sep. functions/data
        for (let i = 0; i < datasets.length; ++i) {
            const dataset = datasets[i];
            //console.log(`timelineChartUpdate got dataset.type=${dataset.type} .label='${dataset.label}' .data.length=${dataset.dataYLabels.data?.length}`);
            if (dataset.label.startsWith('TL_')) {
                const label = dataset.label.slice(3);
                const first_ = label.indexOf('_');
                const groupName = first_ < 0 ? '<nogroup>' : label.slice(0, first_);
                const labelName = first_ < 0 ? label : label.slice(first_ + 1);
                // dataset.data contains x:Date, y:string|number, lcId: number
                for (let j = 0; j < dataset.dataYLabels.data.length; ++j) {
                    const data = dataset.dataYLabels.data[j];
                    if (data.t_ === 1) { continue; } // skip the PrevStateEnd helpers...
                    // but could use 2 for DataPointType.LifecycleEnd...
                    if (data.t_ === 2) {
                        addTimeLineData(groupName, labelName, null, new Date(data.x), { lcEnd: true });
                    } else {
                        const val = data.y; // empty value '' will be treated like null -> can be used to end prev. one.
                        addTimeLineData(groupName, labelName, val, new Date(data.x));
                    }
                }
            }
        }
        for (let index = 0; index < timelineData.length; ++index) {
            const group = timelineData[index];
            try {
                if (group.data.length > 10) {
                    collapseOrExtendGroup(group.group);
                }
            } catch (e) {
                console.warn(`auto collapse index=${index} got e=${e}`, group);
            }
        }
    }

    if (timelineData.length) {
        if (datasets) {
            console.log(`timelineChartData got ${timelineData.length} groups with ${timelineData.map(g => g.data.length)} labels`);
            //console.log(`timelineChartData group 0.label0.length=${timelineData[0]?.data?.[0]?.data?.length}`);
            //console.log(`timelineChartData group 0.label0.slice(10)=${JSON.stringify(timelineData[0]?.data?.[0]?.data?.slice(0, 10))}`);
        }
        if (selectedTime) {
            console.log(`timelineChartData selectedTime=${JSON.stringify(selectedTime)}`);
        }

        if (timelineChart === undefined) {
            timelineChart = TimelinesChart();
            timelineChart
                //.zScaleLabel('actions')
                .zQualitative(true)
                .zColorScale(colorScale)
                .maxHeight(50000) // avoid too small lines. prefer scrolling
                .rightMargin(200)
                .leftMargin(150)
                .maxLineHeight(12) // 12 is default anyhow... lets not make it smaller to keep space for texts inside rects
                .enableAnimations(false)
                .useUtc(false)
                .data(timelineData)
                .dateMarker(selectedTime)
                .onSegmentClick(handleSegmentClick)
                .onLabelClick(handleLabelClick)
                .onZoom(handleZoom)
                .segmentTooltipContent(segmentTooltipContent)
                .timeFormat('%I:%M:%S %p.%L [ms]')
                (document.getElementById('timeline'));
            resizeObserver.observe(document.getElementById('timeline'));
        } else {
            if (datasets) {
                timelineChart.data(timelineData);
            }
            if (selectedTime) {
                timelineChart.dateMarker(selectedTime);
                // todo need to debounce drawing here. seems quite slow...
                // e.g. check scale vs. delta to last
            } // todo could optimize perfo for both
            if (zoomX) {
                timelineChart.zoomX(zoomX);
            }
        }
    }
};

timelineChartUpdate(undefined);
