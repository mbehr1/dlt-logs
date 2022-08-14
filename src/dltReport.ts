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
    revealDate(date: Date): void;
    // not needed, revealDate introduced. lineCloseToDate(date: Date): Promise<number>;
    // not needed, revealDate introduced, textEditors: Array<vscode.TextEditor>;
    ecuApidInfosMap?: Map<string, Map<string, { apid: string, desc: string, nrMsgs: number, ctids: Map<string, [string, number]> }>>;
    lifecycles: Map<string, DltLifecycleInfoMinIF[]>;
    fileInfoNrMsgs: number;
    fileNames: string[];
}

export interface TreeviewAbleDocument {
    textDocument: vscode.TextDocument | undefined;
    treeNode: TreeViewNode;
}

interface DataPoint {
    x: Date,
    y: string | number | any,
    lcId: number,
    t_?: DataPointType,
    idx_?: number
}

interface DataSet {
    data: DataPoint[],
    yLabels?: string[],
    yAxis?: any,
    group?: string
}

/**
 * SingleReport represents a report generated from a set of filters.
 * It implements a NewMessageSink that processes the msgs for that report/set of filters.
 */
class SingleReport implements NewMessageSink {

    public msgs: Array<FilterableDltMsg> = [];
    public pruneMsgsAfterProcessing: boolean = true;
    public dataSets: Map<string, DataSet> = new Map<string, DataSet>();
    // we keep the last data point by each "label"/data source name:
    lastDataPoints: Map<string, DataPoint> = new Map<string, DataPoint>();
    public minDataPointTime?: Date;

    public warnings: string[] = [];
    public reportTitles: string[] = [];
    public dataSetsGroupPrios: any = {};
    convFunctionCache = new Map<DltFilter, [Function | undefined, Object]>();
    reportObj = {}; // an object to store e.g. settings per report from a filter


    constructor(private dltReport: DltReport, private doc: ReportDocument, public filters: DltFilter[]) { }

    onNewMessages(nrNewMsgs: number) {
        // todo
        console.warn(`SingleReport.onNewMessages(${nrNewMsgs}) nyi! msgs.length=${this.msgs.length}`);
        this.updateReport(); // todo... optimize
        this.dltReport.updateReport(); // todo adlt for now... (later on needs to be optimized to support streaming)
        // and to empty the msgs that have been processed already
        // todo if pruneMsgsAfterProcessing
    }

    updateReport() {
        this.dataSets.clear(); // todo optimize!
        const msgs = this.msgs;
        if (msgs.length) {
            console.log(` matching ${this.filters.length} filter on ${msgs.length} msgs:`);
            /*console.log(`msg[0]=${JSON.stringify(msgs[0], (key, value) =>
                typeof value === 'bigint'
                    ? value.toString()
                    : value
            )}`);*/


            for (let i = 0; i < msgs.length; ++i) { // todo make async and report progress...
                const msg = msgs[i];
                if (msg.lifecycle !== undefined) {
                    for (let f = 0; f < this.filters.length; ++f) {
                        const filter = this.filters[f];
                        if (filter.matches(msg)) {
                            const time = this.doc.provideTimeByMsg(msg);
                            if (time) {
                                // get the value:
                                const matches = filter.payloadRegex?.exec(msg.payloadString);
                                // if we have a conversion function we apply that:
                                var convValuesFunction: Function | undefined = undefined;
                                var convValuesObj: Object;
                                if (this.convFunctionCache.has(filter)) {
                                    [convValuesFunction, convValuesObj] = this.convFunctionCache.get(filter) || [undefined, {}];
                                } else {
                                    if (filter.reportOptions?.conversionFunction !== undefined) {
                                        try {
                                            convValuesFunction = Function("matches,params", filter.reportOptions.conversionFunction);
                                            convValuesObj = {};
                                            console.log(` using conversionFunction = '${convValuesFunction}'`);
                                            this.convFunctionCache.set(filter, [convValuesFunction, convValuesObj]);
                                        } catch (e) {
                                            convValuesObj = {};
                                            let warning = `conversionFunction {\n${filter.reportOptions.conversionFunction}\n} failed parsing with:\n${e}`;
                                            this.addWarning(warning);
                                        }
                                    } else {
                                        convValuesObj = {};
                                        this.convFunctionCache.set(filter, [undefined, convValuesObj]);
                                    }
                                }

                                if (matches && matches.length > 0) {
                                    let convertedMatches = undefined;
                                    if (convValuesFunction !== undefined) {
                                        try {
                                            convertedMatches = convValuesFunction(matches, { msg: msg, localObj: convValuesObj, reportObj: this.reportObj });
                                        } catch (e) {
                                            let warning = `conversionFunction {\n${filter.reportOptions.conversionFunction}\n} failed conversion with:\n${e}`;
                                            this.addWarning(warning);
                                        }
                                    }
                                    if (convertedMatches !== undefined || matches.groups) {
                                        const groups = convertedMatches !== undefined ? convertedMatches : matches.groups;
                                        Object.keys(groups).forEach((valueName) => {
                                            // console.log(` found ${valueName}=${matches.groups[valueName]}`);
                                            if (valueName.startsWith("TL_")) {
                                                // for timelineChart
                                                this.insertDataPoint(msg.lifecycle!, valueName, time, groups[valueName], false, false);
                                            } else
                                                if (valueName.startsWith("STATE_")) {
                                                    // if value name starts with STATE_ we make this a non-numeric value aka "state handling"
                                                    // represented as string
                                                    // as we will later use a line diagram we model a state behaviour here:
                                                    //  we insert the current state value directly before:
                                                    this.insertDataPoint(msg.lifecycle!, valueName, time, groups[valueName], true);
                                                } else
                                                    if (valueName.startsWith("INT_")) {
                                                        const value: number = Number.parseInt(groups[valueName]);
                                                        this.insertDataPoint(msg.lifecycle!, valueName, time, value);
                                                    } else {
                                                        const value: number = Number.parseFloat(groups[valueName]);
                                                        this.insertDataPoint(msg.lifecycle!, valueName, time, value);
                                                    }
                                        });
                                    } else {
                                        const value: number = Number.parseFloat(matches[matches.length - 1]);
                                        // console.log(` event filter '${filter.name}' matched at index ${i} with value '${value}'`);
                                        this.insertDataPoint(msg.lifecycle, `values_${f}`, time, value);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // support "lazy" evaluation mainly for TL_...
            // if datapoint.y is an object with an entry 'y' we replace that with the entry.
            this.dataSets.forEach((data) => { data.data.forEach(dp => { if (typeof (dp.y) === 'object') { if (dp.y.y) { dp.y = dp.y.y; } } }); });
            // todo: this needs to support "chunking" (e.g. objects changed from prev. call/update)

            console.log(` have ${this.dataSets.size} data sets`);
            //dataSets.forEach((data, key) => { console.log(`  ${key} with ${data.data.length} entries and ${data.yLabels?.length} yLabels`); });

            this.reportTitles.length = 0; // empty -> todo move to init phase
            for (let f = 0; f < this.filters.length; ++f) {
                const filter = this.filters[f];
                if (filter.reportOptions) {
                    try {
                        if ('title' in filter.reportOptions) {
                            let title = filter.reportOptions.title;
                            if (typeof title === 'string') {
                                this.reportTitles.push(title);
                            } else if (typeof title === 'boolean') { // with boolean we do use the filter.name from configOptions (not the auto gen one)
                                if (title === true && 'name' in filter.configOptions && typeof filter.configOptions.name === 'string') {
                                    this.reportTitles.push(filter.configOptions.name);
                                }
                            } else {
                                console.warn(`dltReport: unsupported type for reportOptions.title. expect string or boolean got ${typeof title}`);
                            }
                        }
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
                                const dataSet = this.dataSets.get(value);
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
                                const dataSet = this.dataSets.get(dataSetName);
                                if (dataSet) {
                                    dataSet.yAxis = migrateAxesV2V3(yAxes[dataSetName]);
                                } else {
                                    const regEx = new RegExp(dataSetName);
                                    let found = false;
                                    for (const [name, dataSet] of this.dataSets.entries()) {
                                        if (name.match(regEx) && dataSet.yAxis === undefined) {
                                            dataSet.yAxis = migrateAxesV2V3(yAxes[dataSetName]);
                                            found = true;
                                            console.log(`  set yAxis for '${name}' from regex '${dataSetName}'`);
                                        }
                                    }
                                    if (!found) {
                                        console.warn(`  no dataSet found for yAxis '${dataSetName}'`);
                                    }
                                }
                            });
                        }
                        if ('group' in filter.reportOptions) {
                            const group = filter.reportOptions.group;
                            Object.keys(group).forEach((dataSetName) => {
                                console.log(` got group.'${dataSetName}' : ${JSON.stringify(group[dataSetName], null, 2)}`);
                                const dataSet = this.dataSets.get(dataSetName);
                                if (dataSet) {
                                    dataSet.group = group[dataSetName];
                                } else {
                                    const regEx = new RegExp(dataSetName);
                                    let found = false;
                                    for (const [name, dataSet] of this.dataSets.entries()) {
                                        if (name.match(regEx) && dataSet.yAxis === undefined) {
                                            dataSet.group = group[dataSetName];
                                            found = true;
                                            console.log(`  set group for '${name}' from regex '${dataSetName}'`);
                                        }
                                    }
                                    if (!found) {
                                        console.warn(`  no dataSet found for group '${dataSetName}'`);
                                    }
                                }
                            });
                        }
                        if ('groupPrio' in filter.reportOptions) { // todo move to init phase
                            const groupPrio = filter.reportOptions.groupPrio;
                            Object.keys(groupPrio).forEach((groupName) => {
                                this.dataSetsGroupPrios[groupName] = Number(groupPrio[groupName]);
                                console.log(`dltReport groupPrios=${JSON.stringify(this.dataSetsGroupPrios)}`);
                            });
                        }
                    } catch (err) {
                        console.log(`got error '${err}' processing reportOptions.`);
                    }
                }
            }

            this.dataSets.forEach((data, label) => {
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
                            const lastState = this.leftNeighbor(data.data, lcInfo.lifecycleEnd, lcInfo.persistentId);
                            //console.log(`got lastState = ${lastState}`);
                            if (lastState !== undefined) {
                                data.data.push({ x: new Date(lcInfo.lifecycleEnd.valueOf() - 1), y: lastState, lcId: lcInfo.persistentId, t_: DataPointType.PrevStateEnd });
                                data.data.push({ x: lcInfo.lifecycleEnd, y: null /*'_unus_lbl_'*/, lcId: lcInfo.persistentId, t_: DataPointType.LifecycleEnd });
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
            });
        }

    }

    leftNeighbor(data: any[], x: Date, lcId: number): any | undefined {
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
    }


    insertDataPoint(lifecycle: DltLifecycleInfoMinIF, label: string, time: Date, value: number | string | any, insertPrevState = false, insertYLabels = true) {
        let dataSet = this.dataSets.get(label);

        if ((this.minDataPointTime === undefined) || this.minDataPointTime.valueOf() > time.valueOf()) {
            this.minDataPointTime = time;
        }

        const dataPoint = { x: time, y: value, lcId: lifecycle.persistentId };
        if (!dataSet) {
            dataSet = { data: [dataPoint] };
            this.dataSets.set(label, dataSet);
            this.lastDataPoints.set(label, dataPoint);
        } else {
            if (insertPrevState) {
                // do we have a prev. state in same lifecycle?
                const lastDP = this.lastDataPoints.get(label);
                if (lastDP) {
                    const prevStateDP = { x: new Date(time.valueOf() - 1), y: lastDP.y, lcId: lastDP.lcId, t_: DataPointType.PrevStateEnd };
                    if (prevStateDP.y !== dataPoint.y && dataPoint.lcId === prevStateDP.lcId && prevStateDP.x.valueOf() > lastDP.x.valueOf()) {
                        // console.log(`inserting prev state datapoint with y=${prevStateDP.y}`);
                        dataSet.data.push(prevStateDP);
                    }
                }
            }
            dataSet.data.push(dataPoint);
            this.lastDataPoints.set(label, dataPoint);
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
    }

    // add a warnning text just once
    addWarning(warning: string) {
        if (!this.warnings.includes(warning)) {
            this.warnings.push(warning);
        }
    };


}

export class DltReport implements vscode.Disposable {

    panel: vscode.WebviewPanel | undefined;
    private _gotAliveFromPanel: boolean = false;
    private _msgsToPost: any[] = []; // msgs queued to be send to panel once alive
    public disposables: vscode.Disposable[];

    private _reportTitles: string[] = [];

    singleReports: SingleReport[] = [];

    lastChangeActive: Date | undefined;

    constructor(private context: vscode.ExtensionContext, private doc: ReportDocument, private callOnDispose: (r: DltReport) => any) {
        this.disposables = [{ dispose: () => callOnDispose(this) }];
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
                        this.doc.revealDate(dateClicked);
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
        for (let disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables.length = 0;
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

    addFilter(filterOrArray: DltFilter | DltFilter[]): SingleReport | undefined {
        if (!this.panel) { return undefined; }

        let filters = Array.isArray(filterOrArray) ? filterOrArray : [filterOrArray];
        // filter on report ones with payloadRegex only
        filters = filters.filter((f) => f.isReport && (f.payloadRegex !== undefined));
        if (!filters.length) { return undefined; }

        // do we have a SingleReport with the same filters already?
        let reportToRet = undefined;
        for (let singleReport of this.singleReports) {
            if (singleReport.filters.length === filters.length) {
                // all filters the same?
                let allTheSame = true;
                for (let exFilter of singleReport.filters) {
                    if (filters.find((f) => f.id === exFilter.id) === undefined) {
                        allTheSame = false;
                        break;
                    }
                }
                if (allTheSame) {
                    return undefined; // could return the existing report as well but then the caller
                    // can't see that it exists yet and nothing happened
                }
            }
        }
        // if we reach here this set of filters is new:
        // enable the filters: todo... rethink whether disabled report filter make sense!
        filters.forEach((f) => f.enabled = true);

        reportToRet = new SingleReport(this, this.doc, filters);
        this.singleReports.push(reportToRet);
        return reportToRet;
    }

    onDidChangeSelectedTime(time: Date[] | Date | null) {
        if (!this.panel) { return; }
        this.postMsgOnceAlive({ command: "onDidChangeSelectedTime", selectedTime: time });
    }

    updateReport() {
        if (!this.panel) { return; }
        // console.log(`webview.enableScripts=${this.panel.webview.options.enableScripts}`);

        // determine the lifecycle labels so that we can use the grid to highlight lifecycle
        // start/end
        let lcDates: Date[] = [];
        this.doc.lifecycles.forEach((lcInfos) => {
            lcInfos.forEach((lcInfo) => {
                lcDates.push(lcInfo.isResume ? lcInfo.lifecycleResume! : lcInfo.lifecycleStart);
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

        let dataSetsGroupPrios: any = {};

        let minDataPointTime: Date | undefined = undefined;


        // warnings that will be made visible for the customer as part of the report:
        let warnings: string[] = [];

        // add a warnning text just once
        const addWarning = function (warning: string) {
            if (!warnings.includes(warning)) {
                warnings.push(warning);
            }
        };

        this._reportTitles.length = 0; // empty here

        for (let singleReport of this.singleReports) {
            this._reportTitles.push(...singleReport.reportTitles);
            warnings.push(...singleReport.warnings);
            if (minDataPointTime === undefined ||
                (singleReport.minDataPointTime !== undefined && (minDataPointTime.valueOf() > singleReport.minDataPointTime.valueOf()))) {
                minDataPointTime = singleReport.minDataPointTime;
            }
            //dataSetsGroupPrios = { ...dataSetsGroupPrios, ...singleReport.dataSetsGroupPrios };
            Object.entries(singleReport.dataSetsGroupPrios).forEach((entry) => { dataSetsGroupPrios[entry[0]] = entry[1]; });
        }

        this.postMsgOnceAlive({ command: "update titles", titles: this._reportTitles, fileNames: this.doc.fileNames });

        if (warnings.length > 0) {
            this.postMsgOnceAlive({ command: "update warnings", warnings: warnings });
        }

        // convert into an array object {label, data}
        let datasetArray: any[] = [];
        this.singleReports.forEach((singleReport, index) => {
            singleReport.dataSets.forEach((data, label) => {

                    // todo check if label exists already and add e.g :index ?
                datasetArray.push({ label: label, dataYLabels: data, type: label.startsWith('EVENT_') ? 'scatter' : 'line', yAxis: data.yAxis, group: data.group });
            });
        });
        if (datasetArray.length > 0) {
            this.postMsgOnceAlive({ command: "update labels", labels: lcDates, minDataPointTime: minDataPointTime });
            this.postMsgOnceAlive({ command: "update", data: datasetArray, groupPrios: dataSetsGroupPrios });
        }
    }
}

/**
 *  migrate axis from chartjs v2 to chartjs v3 format
 * 
 *  converts
 *  - scaleLabel to title incl. scaleLabel.labelString to title.text
 *  - ticks.min/max/reverse -> min/max/reverse
 *  */
const migrateAxesV2V3 = function (axis: any): any {
    // do we need to convert?
    if ('scaleLabel' in axis || 'ticks' in axis) {
        console.log(`migrateAxesV2V2: converting: ${JSON.stringify(axis)}`);
        let newAxis = JSON.parse(JSON.stringify(axis));
        // scaleLabel -> title
        if ('scaleLabel' in axis) {
            newAxis.title = { ...axis.scaleLabel, text: axis.scaleLabel.labelString, labelString: undefined };
            delete newAxis.scaleLabel;
        }
        // ticks -> min, max, reverse
        if ('ticks' in axis) {
            let tickObj = axis['ticks'];
            if ('min' in tickObj) { newAxis.min = tickObj['min']; }
            if ('max' in tickObj) { newAxis.max = tickObj['max']; }
            if ('reverse' in tickObj) { newAxis.reverse = tickObj['reverse']; }
            delete newAxis.ticks;
        }
        console.log(`migrateAxesV2V2: to: ${JSON.stringify(newAxis)}`);
        return newAxis;
    } else {
        return axis;
    }
};

