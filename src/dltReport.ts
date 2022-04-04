/* --------------------
 * Copyright(C) Matthias Behr.
 */

// todo before release:
// [ ] implement onNewMessages and reduce msg load by keeping only the data points but not the processed msgs

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DltLifecycleInfoMinIF } from './dltLifecycle';
import { DltFilter } from './dltFilter';
import { FilterableDltMsg } from './dltParser';
import { TreeViewNode } from './dltTreeViewNodes';

enum DataPointType {
    Default = 0, // can be used but better to not set t_ then at all
    PrevStateEnd = 1,
    LifecycleEnd = 2
}

export interface NewMessageSink {
    onNewMessages?: (nrNewMsgs: number) => void;
    onDone?: () => void;
};

export interface ReportDocument {
    provideTimeByMsg(msg: FilterableDltMsg): Date | undefined;
    lineCloseToDate(date: Date): Promise<number>;
    textEditors: Array<vscode.TextEditor>;
    ecuApidInfosMap?: Map<string, Map<string, { apid: string, desc: string, ctids: Map<string, string> }>>;
    lifecycles: Map<string, DltLifecycleInfoMinIF[]>;
    fileInfoNrMsgs: number;
}

export interface TreeviewAbleDocument {
    textDocument: vscode.TextDocument | undefined;
    treeNode: TreeViewNode;
}

export class DltReport implements vscode.Disposable, NewMessageSink {

    panel: vscode.WebviewPanel | undefined;
    private _gotAliveFromPanel: boolean = false;
    private _msgsToPost: any[] = []; // msgs queued to be send to panel once alive

    filter: DltFilter[] = [];

    lastChangeActive: Date | undefined;

    constructor(private context: vscode.ExtensionContext, private doc: ReportDocument, public msgs: Array<FilterableDltMsg>, private callOnDispose: (r: DltReport) => any) {

        this.panel = vscode.window.createWebviewPanel("dlt-logs.report", `dlt-logs report`, vscode.ViewColumn.Beside,
            {
                enableScripts: true, retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.file(path.join(context.extensionPath, 'media')),
                    vscode.Uri.file(path.join(context.extensionPath, 'node_modules'))]
            });
        //  for ${filter.name} todo think about nice naming title

        this.panel.onDidDispose(() => {
            console.log(`DltReport panel onDidDispose called.`);
            this.panel = undefined;
            this.dispose(); // we close now as well
        });

        this.panel.onDidChangeViewState((e) => {
            console.log(`DltReport panel onDidChangeViewState(${e.webviewPanel.active}) called.`);
            if (e.webviewPanel.active) {
                this.lastChangeActive = new Date(Date.now());
            }
        });

        this.panel.webview.onDidReceiveMessage((e) => {
            console.log(`report.onDidReceiveMessage e=${e.message}`, e);
            this._gotAliveFromPanel = true;
            // any messages to post?
            if (this._msgsToPost.length) {
                let msg: any;
                while (msg = this._msgsToPost.shift()) { // fifo order.
                    const msgCmd = msg.command;
                    this.panel?.webview.postMessage(msg).then((onFulFilled) => {
                        console.log(`webview.postMessage(${msgCmd}) queued ${onFulFilled}`);
                    });
                }
            }
            switch (e.message) {
                case 'clicked':
                    try {
                        const dateClicked: Date = new Date(e.dataPoint.x);
                        console.log(`report.onDidReceiveMessage clicked date e=${dateClicked}`);
                        this.doc.lineCloseToDate(dateClicked).then((line) => {
                            try {
                                if (line >= 0 && this.doc.textEditors) {
                                    const posRange = new vscode.Range(line, 0, line, 0);
                                    this.doc.textEditors.forEach((value) => {
                                        value.revealRange(posRange, vscode.TextEditorRevealType.AtTop);
                                    });
                                }   
                            } catch (err) {
                                console.warn(`report.onDidReceiveMessage.then clicked got err=${err}`, e);
                            }
                        });
                    } catch (err) {
                        console.warn(`report.onDidReceiveMessage clicked got err=${err}`, e);
                    }
                    break;
            }
        });

        // load template and set a html:
        const htmlFile = fs.readFileSync(path.join(this.context.extensionPath, 'media', 'timeSeriesReport.html'));
        if (htmlFile.length) {
            let htmlStr = htmlFile.toString();
            const mediaPart = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media')).toString();
            htmlStr = htmlStr.replace(/\${{media}}/g, mediaPart);
            const scriptsPart = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'node_modules')).toString();
            htmlStr = htmlStr.replace(/\${{scripts}}/g, scriptsPart);
            this.panel.webview.html = htmlStr;
        } else {
            vscode.window.showErrorMessage(`couldn't load timeSeriesReport.html`);
            // throw?
        }

    }

    dispose() {
        console.log(`DltReport dispose called.`);
        if (this.panel) {
            this.panel.dispose();
            this.panel = undefined;
        }
        this.callOnDispose(this);
    }

    postMsgOnceAlive(msg: any) {
        if (this._gotAliveFromPanel) { // send instantly
            const msgCmd = msg.command;
            this.panel?.webview.postMessage(msg).then((onFulFilled) => {
                //console.log(`webview.postMessage(${msgCmd}) direct ${onFulFilled}`);
            });
        } else {
            this._msgsToPost.push(msg);
        }
    };

    addFilter(filterOrArray: DltFilter | DltFilter[]) {
        if (!this.panel) { return; }

        let doUpdate = false;

        const filters = Array.isArray(filterOrArray) ? filterOrArray : [filterOrArray];
        for (let i = 0; i < filters.length; ++i) {
            const filter = filters[i];
            if (filter.isReport && (filter.payloadRegex !== undefined)) {
                if (!this.filter.includes(filter)) {
                    filter.enabled = true; // todo... rethink whether disabled report filter make sense!
                    this.filter.push(filter);
                    doUpdate = true;
                }
            }
        }
        if (doUpdate) {
            this.updateReport();
        }
    }

    onDidChangeSelectedTime(time: Date[] | Date | null) {
        if (!this.panel) { return; }
        this.postMsgOnceAlive({ command: "onDidChangeSelectedTime", selectedTime: time });
    }

    onNewMessages(nrNewMsgs: number) {
        // todo
        console.warn(`DltReport.onNewMessages(${nrNewMsgs}) nyi! msgs.length=${this.msgs.length}`);
        this.updateReport(); // todo adlt for now... (later on needs to be optimized to support streaming)
        // and to empty the msgs that have been processed already
    }

    updateReport() {
        if (!this.panel) { return; }
        // console.log(`webview.enableScripts=${this.panel.webview.options.enableScripts}`);

        // determine the lifecycle labels so that we can use the grid to highlight lifecycle
        // start/end
        let lcDates: Date[] = [];
        this.doc.lifecycles.forEach((lcInfos) => {
            lcInfos.forEach((lcInfo) => {
                lcDates.push(lcInfo.lifecycleStart);
                lcDates.push(lcInfo.lifecycleEnd);
            });
        });
        // sort them by ascending time
        lcDates.sort((a, b) => {
            const valA = a.valueOf();
            const valB = b.valueOf();
            if (valA < valB) { return -1; }
            if (valA > valB) { return 1; }
            return 0;
        });

        const lcStartDate: Date = lcDates[0];
        const lcEndDate: Date = lcDates[lcDates.length - 1];
        console.log(`updateReport lcStartDate=${lcStartDate}, lcEndDate=${lcEndDate}`);

        let dataSets = new Map<string, { data: { x: Date, y: string | number | any, lcId: number, t_?: DataPointType, idx_?: number }[], yLabels?: string[], yAxis?: any }>();

        let minDataPointTime: Date | undefined = undefined;

        // we keep the last data point by each "label"/data source name:
        let lastDataPoints = new Map<string, { x: Date, y: string | number | any, lcId: number }>();

        const insertDataPoint = function (lifecycle: DltLifecycleInfoMinIF, label: string, time: Date, value: number | string | any, insertPrevState = false, insertYLabels = true) {
            let dataSet = dataSets.get(label);

            if ((minDataPointTime === undefined) || minDataPointTime.valueOf() > time.valueOf()) {
                minDataPointTime = time;
            }

            const dataPoint = { x: time, y: value, lcId: lifecycle.persistentId };
            if (!dataSet) {
                dataSet = { data: [dataPoint] };
                dataSets.set(label, dataSet);
                lastDataPoints.set(label, dataPoint);
            } else {
                if (insertPrevState) {
                    // do we have a prev. state in same lifecycle?
                    const lastDP = lastDataPoints.get(label);
                    if (lastDP) {
                        const prevStateDP = { x: new Date(time.valueOf() - 1), y: lastDP.y, lcId: lastDP.lcId, t_: DataPointType.PrevStateEnd };
                        if (prevStateDP.y !== dataPoint.y && dataPoint.lcId === prevStateDP.lcId && prevStateDP.x.valueOf() > lastDP.x.valueOf()) {
                            // console.log(`inserting prev state datapoint with y=${prevStateDP.y}`);
                            dataSet.data.push(prevStateDP);
                        }
                    }
                }
                dataSet.data.push(dataPoint);
                lastDataPoints.set(label, dataPoint);
            }
            // yLabels?
            if (typeof value === 'string' && insertYLabels) {
                const label = `${value}`;
                if (dataSet.yLabels === undefined) {
                    dataSet.yLabels = ['', label];
                    //console.log(`adding yLabel '${label}'`);
                } else {
                    const yLabels = dataSet.yLabels;
                    if (!yLabels.includes(label)) { yLabels.push(label); /* console.log(`adding yLabel '${label}'`); */ }
                }


            }

        };

        const msgs = this.msgs;
        if (msgs.length) {
            console.log(` matching ${this.filter.length} filter on ${msgs.length} msgs:`);
            /*console.log(`msg[0]=${JSON.stringify(msgs[0], (key, value) =>
                typeof value === 'bigint'
                    ? value.toString()
                    : value
            )}`);*/

            const convFunctionCache = new Map<DltFilter, [Function | undefined, Object]>();
            const reportObj = {}; // an object to store e.g. settings per report from a filter

            for (let i = 0; i < msgs.length; ++i) { // todo make async and report progress...
                const msg = msgs[i];
                if (msg.lifecycle !== undefined) {
                    for (let f = 0; f < this.filter.length; ++f) {
                        const filter = this.filter[f];
                        if (filter.matches(msg)) {
                            const time = this.doc.provideTimeByMsg(msg);
                            if (time) {
                                // get the value:
                                const matches = filter.payloadRegex?.exec(msg.payloadString);
                                // if we have a conversion function we apply that:
                                var convValuesFunction: Function | undefined = undefined;
                                var convValuesObj: Object;
                                if (convFunctionCache.has(filter)) {
                                    [convValuesFunction, convValuesObj] = convFunctionCache.get(filter) || [undefined, {}];
                                } else {
                                    if (filter.reportOptions?.conversionFunction !== undefined) {
                                        convValuesFunction = Function("matches,params", filter.reportOptions.conversionFunction);
                                        convValuesObj = {};
                                        console.warn(` using conversionFunction = '${convValuesFunction}'`);
                                        convFunctionCache.set(filter, [convValuesFunction, convValuesObj]);
                                    } else {
                                        convValuesObj = {};
                                        convFunctionCache.set(filter, [undefined, convValuesObj]);
                                    }
                                }

                                if (matches && matches.length > 0) {
                                    let convertedMatches = undefined;
                                    if (convValuesFunction !== undefined) { convertedMatches = convValuesFunction(matches, { msg: msg, localObj: convValuesObj, reportObj: reportObj }); }
                                    if (convertedMatches !== undefined || matches.groups) {
                                        const groups = convertedMatches !== undefined ? convertedMatches : matches.groups;
                                        Object.keys(groups).forEach((valueName) => {
                                            // console.log(` found ${valueName}=${matches.groups[valueName]}`);
                                            if (valueName.startsWith("TL_")) {
                                                // for timelineChart
                                                insertDataPoint(msg.lifecycle!, valueName, time, groups[valueName], false, false);
                                            } else
                                                if (valueName.startsWith("STATE_")) {
                                                    // if value name starts with STATE_ we make this a non-numeric value aka "state handling"
                                                    // represented as string
                                                    // as we will later use a line diagram we model a state behaviour here:
                                                    //  we insert the current state value directly before:
                                                    insertDataPoint(msg.lifecycle!, valueName, time, groups[valueName], true);
                                                } else
                                                    if (valueName.startsWith("INT_")) {
                                                        const value: number = Number.parseInt(groups[valueName]);
                                                        insertDataPoint(msg.lifecycle!, valueName, time, value);
                                                    } else {
                                                        const value: number = Number.parseFloat(groups[valueName]);
                                                        insertDataPoint(msg.lifecycle!, valueName, time, value);
                                                    }
                                        });
                                    } else {
                                        const value: number = Number.parseFloat(matches[matches.length - 1]);
                                        // console.log(` event filter '${filter.name}' matched at index ${i} with value '${value}'`);
                                        insertDataPoint(msg.lifecycle, `values_${f}`, time, value);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // support "lazy" evaluation mainly for TL_...
        // if datapoint.y is an object with an entry 'y' we replace that with the entry.
        dataSets.forEach((data) => { data.data.forEach(dp => { if (typeof (dp.y) === 'object') { if (dp.y.y) { dp.y = dp.y.y; } } }); });

        console.log(` have ${dataSets.size} data sets`);
        //dataSets.forEach((data, key) => { console.log(`  ${key} with ${data.data.length} entries and ${data.yLabels?.length} yLabels`); });

        for (let f = 0; f < this.filter.length; ++f) {
            const filter = this.filter[f];
            if (filter.reportOptions) {
                try {
                    if ('valueMap' in filter.reportOptions) {
                        /*
                        For valueMap we do expect an object where the keys/properties match to the dataset name
                        and the property values are arrays with objects having one key/value property. E.g.
                        "valueMap":{
                            "STATE_a": [ // STATE_a is the name of the capture group from the regex capturing the value
                                {"value1":"mapped value 1"},
                                {"value2":"mapped value 2"}
                            ] // so a captured value "value" will be mapped to "mapped value 2".
                            // the y-axis will have the entries (from top): 
                            //  mapped value 1
                            //  mapped value 2
                            //
                        }
                         */
                        const valueMap = filter.reportOptions.valueMap;
                        Object.keys(valueMap).forEach((value) => {
                            console.log(` got valueMap.${value} : ${JSON.stringify(valueMap[value], null, 2)}`);
                            // do we have a dataSet with that label?
                            const dataSet = dataSets.get(value);
                            if (dataSet) {
                                const valueMapMap: Array<any> = valueMap[value];
                                console.log(`  got dataSet with matching label. Adjusting yLabels (name and order) and values`);
                                if (dataSet.yLabels) {
                                    let newYLabels: string[] = [];
                                    // we add all the defined ones and '' (in reverse order so that order in settings object is the same as in the report)
                                    let mapValues = new Map<string, string>();
                                    for (let i = 0; i < valueMapMap.length; ++i) {
                                        const mapping = valueMapMap[i]; // e.g. {"1" : "high"}
                                        const key = Object.keys(mapping)[0];
                                        const val = mapping[key];
                                        newYLabels.unshift(val);
                                        mapValues.set(key, val);
                                    }
                                    newYLabels.unshift('');
                                    // add the non-mapped labels as well:
                                    dataSet.yLabels.forEach((value) => {
                                        const newY = mapValues.get(value);
                                        if (!newY) {
                                            if (!newYLabels.includes(value)) { newYLabels.push(value); }
                                        }
                                    });
                                    // now change all dataPoint values:
                                    dataSet.data.forEach((data) => {
                                        const newY = mapValues.get(<string>data.y);
                                        if (newY) { data.y = newY; }
                                    });
                                    dataSet.yLabels = newYLabels;
                                } else {
                                    console.log(`   dataSet got no yLabels?`);
                                }
                            }
                        });
                    }
                    if ('yAxes' in filter.reportOptions) {
                        const yAxes = filter.reportOptions.yAxes;
                        Object.keys(yAxes).forEach((dataSetName) => {
                            console.log(` got yAxes.'${dataSetName}' : ${JSON.stringify(yAxes[dataSetName], null, 2)}`);
                            const dataSet = dataSets.get(dataSetName);
                            if (dataSet) {
                                dataSet.yAxis = yAxes[dataSetName];
                            } else {
                                const regEx = new RegExp(dataSetName);
                                let found = false;
                                for (const [name, dataSet] of dataSets.entries()) {
                                    if (name.match(regEx) && dataSet.yAxis === undefined) {
                                        dataSet.yAxis = yAxes[dataSetName];
                                        found = true;
                                        console.log(`  set yAxis for '${name}' from regex '${dataSetName}'`);
                                    }
                                }
                                if (!found) {
                                    console.warn(`  no dataSet found for '${dataSetName}'`);
                                }
                            }
                        });
                    }
                } catch (err) {
                    console.log(`got error '${err}' processing reportOptions.`);
                }
            }
        }

        if (dataSets.size) {
            this.postMsgOnceAlive({ command: "update labels", labels: lcDates, minDataPointTime: minDataPointTime });

            const leftNeighbor = function (data: any[], x: Date, lcId: number): any | undefined {
                // we assume data is sorted and contains x:Date and y: any
                let i = 0;
                for (i = 0; i < data.length; ++i) {
                    if (data[i].x.valueOf() >= x.valueOf()) {
                        break;
                    }
                }
                if (i > 0 && data[i - 1].lcId === lcId) {
                    return data[i - 1].y;
                } else {
                    return undefined;
                }

            };

            // convert into an array object {label, data}
            let datasetArray: any[] = [];
            dataSets.forEach((data, label) => {
                let dataNeedsSorting = false;

                // add some NaN data at the end of each lifecycle to get real gaps (and not interpolated line)
                this.doc.lifecycles.forEach((lcInfos) => {
                    lcInfos.forEach((lcInfo) => {
                        //console.log(`checking lifecycle ${lcInfo.uniqueId}`);
                        if (data.yLabels !== undefined) {
                            // for STATE_ or TL_ we want a different behaviour.
                            // we treat datapoints/events as state changes that persists
                            // until there is a new state.
                            // search the last value:
                            const lastState = leftNeighbor(data.data, lcInfo.lifecycleEnd, lcInfo.persistentId);
                            //console.log(`got lastState = ${lastState}`);
                            if (lastState !== undefined) {
                                data.data.push({ x: new Date(lcInfo.lifecycleEnd.valueOf() - 1), y: lastState, lcId: lcInfo.persistentId, t_: DataPointType.PrevStateEnd });
                                data.data.push({ x: lcInfo.lifecycleEnd, y: '_unus_lbl_', lcId: lcInfo.persistentId, t_: DataPointType.LifecycleEnd });
                                // need to sort already here as otherwise those data points are found...
                                data.data.forEach((d, index) => d.idx_ = index);
                                data.data.sort((a, b) => {
                                    const valA = a.x.valueOf();
                                    const valB = b.x.valueOf();
                                    if (valA < valB) { return -1; }
                                    if (valA > valB) { return 1; }
                                    return a.idx_! - b.idx_!; // if same time keep order!
                                });
                                data.data.forEach((d) => delete d.idx_);
                            }
                        } else {
                            data.data.push({ x: lcInfo.lifecycleEnd, y: NaN, lcId: lcInfo.persistentId, t_: DataPointType.LifecycleEnd }); // todo not quite might end at wrong lifecycle. rethink whether one dataset can come from multiple LCs
                            dataNeedsSorting = true;
                        }
                    });
                });
                if (dataNeedsSorting) {
                    // javascript sort is by definition not stable...
                    // so we add the index first to prevent a .indexOf(a), .indexOf(b) search...
                    data.data.forEach((d, index) => d.idx_ = index);
                    data.data.sort((a, b) => {
                        const valA = a.x.valueOf();
                        const valB = b.x.valueOf();
                        if (valA < valB) { return -1; }
                        if (valA > valB) { return 1; }
                        return a.idx_! - b.idx_!;
                    });
                    data.data.forEach((d) => delete d.idx_);
                }

                datasetArray.push({ label: label, dataYLabels: data, type: label.startsWith('EVENT_') ? 'scatter' : 'line', yAxis: data.yAxis });
            });

            this.postMsgOnceAlive({ command: "update", data: datasetArray });
        }

    }
}
