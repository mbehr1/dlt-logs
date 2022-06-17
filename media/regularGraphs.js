/**
 * regular graphs with time axis.
 * (c) Matthias Behr, 2022
 *
 * todo:
 * - chartArea left/right border need to be aligned
 * - annotations are positioned too low for graphs with high aspectRatio
 */

/**
 * map of all graphs graphId -> {chart: Chart, config: {}}
 */
const graphs = new Map();

/**
 * add a new graph/chart as child to element
 * @param {HTMLDomElement} element where to add the new report
 * @param {HTMLDomElement} existing child to insert before. if null appended as last child
 * @param {*} graphId id for the new graph. Dom id will be element.id + _ + graphId
 * @returns Chart or null if the id exists already
 */
const addNewGraph = (element, existing, graphId) => {
    if (graphs.has(graphId)) {
        return null;
    }
    let canvas = document.createElement('canvas');
    canvas.id = element.id + '_' + graphId;
    element.insertBefore(canvas, existing);
    const ctx = canvas.getContext('2d');
    // we takeover the common options but not:
    //  plugins.title
    //  plugins.legend
    //  options.aspectRation
    //
    // we cannot copy scales as the Chart overwrites that!
    const config = {
        ...graphConfigTemplate, options: {
            ...graphConfigTemplate.options,
            aspectRatio: graphs.size > 0 ? 5 : undefined,
            // toggleDrawMode currently relies on plugins.zoom being the same object!
            plugins: { ...graphConfigTemplate.options.plugins, title: { ...graphConfigTemplate.options.plugins.title }, legend: { ...graphConfigTemplate.options.plugins.legend } },
        },
        data: {
            xLabels: graphsCommonXLabels,
            datasets: []
        },
    };
    if (graphs.size > 0) {
        config.options.plugins.legend = {
            display: true,
            position: 'chartArea',
        };
        config.options.scales['x-axis-0'].title.display = false;
        config.options.scales['x-axis-0'].ticks.display = false;
        config.options.plugins.title.display = true;
        config.options.plugins.title.text = graphId;
        config.options.plugins.title.position = 'left';
        config.options.plugins.title.align = 'center';

        // disable the title from scale from main one as well to gain more space:
        // (not gaining more space just making the chartArea higher...)
        if (graphs.size === 1) {
            const mainGraph = graphs.get('main');
            if (mainGraph) {
                mainGraph.config.options.scales['x-axis-0'].title.display = false;
                /*mainGraph.config.options.plugins.title.display = true;
                mainGraph.config.options.plugins.title.text = graphId;
                mainGraph.config.options.plugins.title.position = 'left';
                mainGraph.config.options.plugins.title.align = 'center';*/
            }
        }
    };

    const newGraph = new Chart(ctx, config);
    graphs.set(graphId, { chart: newGraph, config: config });

    return newGraph;
};

const graphsGetOrCreate = (groupId) => {
    let graph = graphs.get(groupId);
    if (graph) {
        return graph;
    } else {
        return addNewGraph(document.getElementById('stacked-reports'), null, groupId);
    }
};

let chartAreaMaxLeft = 0;

/**
 * update all graphs/charts or a single specified one
 * @param {string?} graphId id of graph to be updated. if null/undefined all graphs will be updated
 */
const updateGraphs = (graphId) => {
    if (graphId) {
        graphs.get(graphId)?.chart.update();
    } else {
        graphs.forEach((graph, id) => {
            //console.warn(`updateGraphs: graph.id=${id} pan.enabled=${graph.config.options.plugins.zoom.pan.enabled} chart.scales=${Object.keys(graph.chart.options.scales).join(',')} config.scales=${Object.keys(graph.config.options.scales).join(',')}`);
            graph.chart.update();
            if (graph.chart.chartArea && graph.chart.chartArea.left > chartAreaMaxLeft) {
                chartAreaMaxLeft = graph.chart.chartArea.left;
            }
            //console.warn(`updateGraphs: graph.id=${id} pan.enabled=${graph.chart.options.plugins.zoom.pan.enabled} chart.scales=${Object.keys(graph.chart.options.scales).join(',')} config.scales=${Object.keys(graph.config.options.scales).join(',')}`);
        });
    }
};

const graphsSetStartEndDate = (startDate, endDate, graphId) => {
    if (graphId) {
        const graph = graphs.get(graphId);
        if (graph) {
            graph.config.options.scales['x-axis-0'].min = startDate.valueOf();
            graph.config.options.scales['x-axis-0'].max = endDate.valueOf();
            graph.chart.update();
        }
    } else {
        graphs.forEach((graph, graphId) => graphsSetStartEndDate(startDate, endDate, graphId)); // todo a bit slower as we're already iterating...
    }
};

const graphsUpdateTitle = (graphId, titles) => {
    const graph = graphs.get(graphId);
    if (graph) {
        graph.config.options.plugins.title.display = titles.length > 0;
        graph.config.options.plugins.title.text = titles;
    }
};

const handlePanZoomComplete = ({ chart }) => {
    //console.log(`handlePanZoomComplete`, chart);
    const minDate = new Date(chart.scales['x-axis-0'].min);
    const maxDate = new Date(chart.scales['x-axis-0'].max);

    // apply to other graphs:
    graphs.forEach((graph, graphId) => {
        if (graph.chart !== chart) {
            console.log(`handlePanZoomComplete syncing id:${graphId} min=${chart.scales['x-axis-0'].min} max=${chart.scales['x-axis-0'].max}`);
            graphsSetStartEndDate(minDate, maxDate, graphId);
        }
    });

    // apply to timeline chart:
    timelineChartUpdate({ zoomX: [minDate, maxDate] });
};

const yAxisAfterSetDimensions = (axis) => {
    console.log(`yAxisAfterSetDimensions chartAreaMaxLeft=${chartAreaMaxLeft} id=${axis.ctx.canvas.id}.${axis.id} chartArea.Left=${axis.chart && axis.chart.chartArea ? axis.chart.chartArea.left : NaN} left=${axis.left} width=${axis.width}`, axis);
    if (axis.position === 'left' && axis.width > 0) {
        if (axis.chart.chartArea.left > chartAreaMaxLeft) {
            chartAreaMaxLeft = axis.chart.chartArea.left;
            console.warn(` new chartAreaMaxLeft=${chartAreaMaxLeft} determined by id=${axis.ctx.canvas.id}.${axis.id}`);
        }
        let chartAreaNeedsShiftRightBy = chartAreaMaxLeft - axis.right;
        if (chartAreaNeedsShiftRightBy > 0) {
            if (axis.ctx.canvas.id === 'stacked-reports_main') {
                console.warn(`yAxisAfterSetDimensions ${axis.ctx.canvas.id}.${axis.id} needs adjust by ${chartAreaNeedsShiftRightBy} to align at ${chartAreaMaxLeft}`);
                //axis.paddingLeft = newPadding;
                //axis.width = axis.width + chartAreaNeedsShiftRightBy;
                //axis.right = axis.right + chartAreaNeedsShiftRightBy;
            }
        }
    }
};

const axisAfterFit = (axis) => {
    console.log(`axisAfterFit  chartAreaMaxLeft=${chartAreaMaxLeft} id=${axis.ctx.canvas.id}.${axis.id} paddingLeft=${axis.paddingLeft} left=${axis.left} width=${axis.width}`, axis);
    if (axis.position === 'left' && axis.width > 0) {
        //axis.width = 100; works as well but padding looks nicer
        let chartAreaNeedsShiftRightBy = chartAreaMaxLeft - axis.right;
        if (chartAreaNeedsShiftRightBy > 0) {
            if (axis.ctx.canvas.id === 'stacked-reports_main') {
                console.warn(`axisAfterFit ${axis.ctx.canvas.id}.${axis.id} needs adjust by ${chartAreaNeedsShiftRightBy} to align at ${chartAreaMaxLeft}`);
                //axis.paddingLeft = newPadding;
                axis.width = axis.width + chartAreaNeedsShiftRightBy;
                //axis.right = axis.right + chartAreaNeedsShiftRightBy;
            }
        } else {
            //console.warn(`${axis.ctx.canvas.id}.${axis.id}  newWidth=${newWidth} < ${axis.width}`);
        }
    } else { // assume right

    }
};


const graphsResetZoom = () => {
    graphs.forEach((graph) => {
        // have to delete them as timelineChart zoom might have set them
        graph.config.options.scales['x-axis-0'].min = undefined;
        graph.config.options.scales['x-axis-0'].max = undefined;
        graph.chart.update();
        //graph.chart.resetZoom(); // this triggers a handlePanZoomComplete... that triggers graphsSetStartEndDate... seems not needed
    });

    // use from 1st/main graph, we assume this is always there
    const { chart } = graphs.get('main');
    const minDate = new Date(chart.scales['x-axis-0'].min);
    const maxDate = new Date(chart.scales['x-axis-0'].max);
    timelineChartUpdate({ zoomX: [minDate, maxDate] });
};

const graphsToggleDragMode = () => {
    // currently all graphs share the same options.plugins object!
    var zoomOptions = graphs.get('main').chart.options.plugins.zoom;
    // we toggle between pan and drag
    zoomOptions.zoom.drag.enabled = !zoomOptions.zoom.drag.enabled;
    zoomOptions.pan.enabled = !zoomOptions.zoom.drag.enabled;

    updateGraphs();
};

const selectedTimeAnnotations = [{
    id: 'selTime',
    drawTime: 'beforeDatasetsDraw',
    type: 'line',
    mode: 'vertical',
    scaleID: 'x-axis-0',
    borderColor: 'green',
    borderWidth: 1,
    borderDash: [2, 2],
    label: {
        content: 'selected',
        enabled: true,
        position: "start",
        backgroundColor: vscodeStyles.getPropertyValue('--vscode-editor-background'), // 'rgba(0,0,0,0)' todo or fully transparent?
        font: {
            size: 8, // todo could use font-size but then the yAdjust needs to take this into account as well
            family: vscodeStyles.getPropertyValue('--vscode-editor-font-family'),
        },
        color: vscodeStyles.getPropertyValue('--vscode-editor-foreground'),
        padding: 2
    },
    value: null, // wont be shown
    tag_: 'msg' // I hope tag_ is unused by the plugin. 'msg' used for cur. selected msg(s) and 'tl' for selected timeline element
    // pinned_: Number>0|undefined ... will be set by editAnnotations Pin/UnpinBtn
}];


const graphsCommonXLabels = [];

const graphConfigTemplate = {
    type: 'line',
    data: {
        //labels: [], // not used later as xLabels is set via update labels
        xLabels: graphsCommonXLabels,
        datasets: []
    },
    options: {
        responsive: true,
        indexAxis: 'x-axis-0',
        scales: {
            'x-axis-0': {
                type: 'time',
                parsing: false, // we provide timestamps directly
                time: {
                    unit: 'second',
                    tooltipFormat: 'LTS.SSS [ms]'
                },
                display: true,
                title: {
                    display: true,
                    text: 'time'
                },
                grid: {
                    display: true,
                    color: 'rgba(0,200,0,0.5)'
                },
                ticks: {
                    source: 'labels',
                    minRotation: 30,
                }
            },
            'y-axis-0': {
                id: 'y-axis-0',
                display: 'auto',
                title: {
                    display: true,
                    text: 'values'
                },
                width: 100,
                //afterSetDimensions: yAxisAfterSetDimensions,
                //afterFit: axisAfterFit,
            },
            'y-axis-1': {
                id: 'y-axis-1',
                display: 'auto',
                type: 'category',
                reverse: true,
                width: 100,
                //afterSetDimensions: yAxisAfterSetDimensions,
                //afterFit: axisAfterFit,
            }
        },
        animation: { duration: 0, active: { duration: 0 }, resize: { duration: 0 } },
        plugins: {
            title: { display: false, text: 'report', color: vscodeStyles.getPropertyValue('--vscode-editor-foreground') },
            tooltip: {
                backgroundColor: vscodeStyles.getPropertyValue('--vscode-editorHoverWidget-background'),
                borderColor: vscodeStyles.getPropertyValue('--vscode-editorHoverWidget-border'),
                borderWidth: 1,
                titleColor: vscodeStyles.getPropertyValue('--vscode-editorHoverWidget-foreground'),
                bodyColor: vscodeStyles.getPropertyValue('--vscode-editorHoverWidget-foreground'),
                footerColor: vscodeStyles.getPropertyValue('--vscode-editorHoverWidget-foreground'),
                titleFont: { size: vscodeStyles.getPropertyValue('--vscode-editor-font-size'), weight: 'bold', family: vscodeStyles.getPropertyValue('--vscode-editor-font-family'), },
                bodyFont: { size: 10, family: vscodeStyles.getPropertyValue('--vscode-editor-font-family'), },
                usePointStyle: true,
                position: 'nearest',
                mode: 'nearest',
                callbacks: {
                    title: (items) => {
                        if (items.length > 0) {
                            const item = items[0];
                            return item.formattedValue; // weird that's the time/x-axis value
                        }
                        return "";
                    },
                    label: (item) => {
                        return (item.dataset.label || 'no dataset label') + ': ' + (item.label || 'no item label');
                    }

                }
            },
            colorschemes: {
                scheme: 'tableau.Tableau20'
            },
            zoom: {
                pan: {
                    enabled: true,
                    mode: 'x',
                    onPanComplete: handlePanZoomComplete
                },
                zoom: {
                    drag: {
                        enabled: false
                    },
                    wheel: {
                        enabled: true
                    },
                    pinch: {
                        enabled: false
                    },
                    mode: 'x',
                    speed: 0.05,
                    onZoomComplete: handlePanZoomComplete,
                }
            },
            annotation: {
                annotations: {},
                click: (context, event) => {
                    //console.log(`annotation click context=${Object.keys(context).join(',')}, event=${Object.keys(event).join(',')}`, context, event);
                    event.native.stopImmediatePropagation();
                    event.native.preventDefault();
                    let anDi = document.getElementById("editAnnotation");
                    editAnnotationObj = selectedTimeAnnotations.find(t => (t.id === context.element.options.id));
                    if (editAnnotationObj) {
                        anDi.style.display = "block";
                        anDi.style.top = event.native.y + "px";
                        anDi.style.left = event.native.x + "px";

                        let btnPin = document.getElementById("editAnnotationPinBtn");
                        let btnUnpin = document.getElementById("editAnnotationUnpinBtn");

                        let textDesc = document.getElementById("editAnnotationDesc");
                        const curDesc = editAnnotationObj.desc_;
                        textDesc.value = curDesc !== undefined ? curDesc : "";

                        if (editAnnotationObj.pinned_) {
                            btnPin.style.display = "none";
                            btnUnpin.style.display = "";
                        } else {
                            btnUnpin.style.display = "none";
                            btnPin.style.display = "";
                        }
                    }
                },
            },
        },
        // will be set later onClick: handleClick
    }
};

const graphsCommonOptions = graphConfigTemplate.options;
