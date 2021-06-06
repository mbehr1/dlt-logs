/**
 * time-line / swimlanes alike chart based on TL_ states/events.
 * (c) Matthias Behr, 2021
 */

//console.log(`timeLinesChart called...`);

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
    console.log(`segmentTooltipContent nyi`, seg);
    // we want time format LTS.sss [ms]
    return `${seg.group}.${seg.label}= <strong>${seg.val}</strong><br>${seg.timeRange[0]}-${seg.timeRange[1]}`;
};

const handleSegmentClick = (ev) => {
    console.log(`handleSegmentClick`, ev);
    if (onSelectTimeCallback) {
        onSelectTimeCallback([
            { label: `${ev.group}_${ev.label}=${ev.labelVal} start`, value: ev.timeRange[0] },
            { label: `${ev.group}_${ev.label}=${ev.labelVal} end`, value: ev.timeRange[1] }]);
    }
};

const handleLabelClick = (labelOrGroup, group) => {
    console.log(`handleLabelClick`, labelOrGroup, group);
    if (group === undefined) { // click on group... (but name in labelOrGroup)
        // collapse or extend the group
        const groupObjArr = timelineData.filter(a => a.group === labelOrGroup);
        if (groupObjArr.length === 1) {
            const groupObj = groupObjArr[0];
            const groupData = groupObj.data;
            const isCollapseable = groupData.length > 1;
            const isExtendable = groupData.length === 1 && groupObj.origData?.length > 1;
            console.log(` group '${groupObj.group}' isCollapseable=${isCollapseable} isExtendable=${isExtendable}`);
            let doUpdate = false;
            if (isCollapseable) { // collapse
                groupObj.origData = groupObj.data;
                const collapsedData = [];
                // flatten the data into a single label: (might not work if items overlap... todo check / merge into one then)
                groupObj.data.forEach(labelData => collapsedData.push(...(labelData.data)));

                groupObj.data = [
                    {
                        label: "collapsed",
                        /* to collapse into just a single item:
                        data:[{
                            timeRange:[
                                groupObj.data[0].data[0].timeRange[0], 
                                groupObj.data[groupObj.data.length-1].data[groupObj.data[groupObj.data.length-1].data.length-1].timeRange[1]], // todo proper min/max...
                            val:'collapsed'}] */
                        data: collapsedData
                    }];
                console.log(` collapsed data=`, groupObj.data);
                doUpdate = true;
            } else if (isExtendable) { // extend
                groupObj.data = groupObj.origData;
                // todo could remove key origData
                doUpdate = true;
            }
            if (doUpdate) {
                timelineChart.data(timelineData);
            }

        } else {
            console.log(` bug! filter returned != 1. length=${groupObjArr.length}`);
        }
    } else { // click on label
        // unselect any selected one
        // todo could be more sophisticated and allow e.g. one per label being selected
        // or all from label (e.g. then start only?)
        if (onSelectTimeCallback) {
            onSelectTimeCallback([]);
        }
    }
};

let timelineData = [];
let timelineChart = undefined; // TimelinesChart();

const MARKER_FINISH = '|';
const MARKER_PERSIST = '$';

const addTimeLineData = (groupName, labelName, valueName, time, options) => {
    // group.label.value
    // const [groupName, labelName, valueName] = event.split('.');
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
    if (!valueName) {
    } else {
        const isFinished = valueName.endsWith(MARKER_FINISH) ? true : undefined;
        label.data.push({
            timeRange: [time, isFinished ? time + 10 : time + (3600) * 1000], // todo determine better end
            val: { g: groupName, l: labelName, v: valueName },
            labelVal: valueName,
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
            console.log(`timelineChartUpdate got dataset.type=${dataset.type} .label='${dataset.label}' .data.length=${dataset.dataYLabels.data?.length}`);
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
                        const val = data.y || '<noval>';
                        addTimeLineData(groupName, labelName, val, new Date(data.x));
                    }
                }
            }
        }
    }

    if (timelineData.length) {
        if (datasets) {
            console.log(`timelineChartData got ${timelineData.length} groups with ${timelineData.map(g => g.data.length)} labels`);
            console.log(`timelineChartData group 0.label0.length=${timelineData[0]?.data?.[0]?.data?.length}`);
            console.log(`timelineChartData group 0.label0.slice(10)=${JSON.stringify(timelineData[0]?.data?.[0]?.data?.slice(0, 10))}`);
        }
        if (selectedTime) {
            console.log(`timelineChartData selectedTime=${JSON.stringify(selectedTime)}`);
        }

        if (timelineChart === undefined) {
            timelineChart = TimelinesChart();
            timelineChart
                .zScaleLabel('actions')
                .zQualitative(true)
                .zColorScale(colorScale)
                .enableAnimations(false)
                .useUtc(false)
                .data(timelineData)
                .dateMarker(selectedTime)
                .onSegmentClick(handleSegmentClick)
                .onLabelClick(handleLabelClick)
                .onZoom(handleZoom)
                //.segmentTooltipContent(segmentTooltipContent) todo use own, add group,label, no To: for |,...
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

// console.log(`timeLinesChart done`);