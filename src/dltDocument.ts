/* --------------------
 * Copyright(C) Matthias Behr.
 */

import * as vscode from 'vscode';
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as util from './util';
import { DltParser, DltMsg, MSTP, MTIN_LOG, MTIN_CTRL, MTIN_CTRL_strs, MTIN_LOG_strs, MTIN_TRACE_strs, MTIN_NW_strs } from './dltParser';
import { DltLifecycleInfo } from './dltLifecycle';
import { TreeViewNode, FilterNode, TimeSyncData, createUniqueId } from './dltDocumentProvider';
import { DltFilter, DltFilterType } from './dltFilter';
import TelemetryReporter from 'vscode-extension-telemetry';
import { DltFileTransferPlugin } from './dltFileTransfer';
import { DltReport } from './dltReport';

class ColumnConfig implements vscode.QuickPickItem {
    name: string;
    icon: string | undefined;
    visible: boolean = true;
    description: string | undefined;

    constructor(obj: any) {
        if ("name" in obj) { this.name = obj.name; } else {
            throw Error("name missing for ColumnConfig");
        }
        if ("icon" in obj) { this.icon = obj.icon; }
        if ("visible" in obj) { this.visible = obj.visible; }
        if ("description" in obj) { this.description = obj.description; }

    }

    get label() {
        if (this.icon) {
            return `${this.icon} ${this.name}`;
        } else {
            return this.name;
        }
    }
    get picked() {
        return this.visible;
    }
    get alwaysShow() { return true; }
};

export class DltDocument {
    static dltP: DltParser = new DltParser();

    uri: vscode.Uri;
    textDocument: vscode.TextDocument | undefined = undefined;
    private _reporter?: TelemetryReporter;

    private _fileUri: vscode.Uri;
    private _parsedFileLen: number = 0; // we parsed that much yet
    private _docEventEmitter: vscode.EventEmitter<vscode.FileChangeEvent[]>;

    msgs = new Array<DltMsg>();
    filteredMsgs: DltMsg[] | undefined = undefined;
    lifecycles = new Map<string, DltLifecycleInfo[]>();

    // configured columns:
    private _columns: ColumnConfig[] = [];
    // filters:
    allFilters: DltFilter[] = [];

    private _renderTriggered: boolean = false;
    private _renderPending: boolean = false;

    private _skipMsgs: number = 0; // that many messages get skipped from msgs/filteredMsgs
    staticLinesAbove: string[] = []; // number of static lines e.g. "...skipped ... msgs..."
    // todo private _staticLinesBelow: string[] = []; // e.g. "... msgs not shown yet..."

    //  gets updated e.g. by notifyVisibleRange
    private _maxNrMsgs: number; //  setting 'dlt-logs.maxNumberLogs'. That many messages are displayed at once

    private _text: string; // the rendered text todo change into Buffer
    get text() {
        console.log(`DltDocument.text() returning text with len ${this._text.length}`);
        if (!this._renderPending) { this._renderTriggered = false; }
        return this._text;
    }

    treeNode: TreeViewNode;
    lifecycleTreeNode: TreeViewNode;
    filterTreeNode: TreeViewNode;
    pluginTreeNode: TreeViewNode; // this is from the parent = DltDocumentProvider
    pluginNodes: TreeViewNode[] = [];

    private _treeEventEmitter: vscode.EventEmitter<TreeViewNode | null>;

    textEditors: Array<vscode.TextEditor> = []; // don't use in here!

    /* allDecorations contain a list of all decorations for the filteredMsgs. 
     * the ranges dont contain line numbers but the filteredMsg number.
     * during renderLines the visible decorations will be created and stored in 
     * decorations (with updated ranges)
     */
    private _allDecorations?: Map<vscode.TextEditorDecorationType, vscode.DecorationOptions[]>;
    decorations?: Map<vscode.TextEditorDecorationType, vscode.DecorationOptions[]>; // filtered ones

    identifiedFileConfig?: any;

    timeSyncs: TimeSyncData[] = [];
    // cachedTimes?: Array<Date>; // per line one date/time
    private _timeAdjustMs: number = 0; // adjust in ms
    lastSelectedTimeEv: Date | undefined; // the last received time event that might have been used to reveal our line. used for adjustTime on last event feature.
    gotTimeSyncEvents: boolean = false; // we've been at least once to sync time based on timeSync events

    get timeAdjustMs(): number { return this._timeAdjustMs; } // read only. use adustTime to change

    private _realStat: fs.Stats;

    constructor(uri: vscode.Uri, docEventEmitter: vscode.EventEmitter<vscode.FileChangeEvent[]>, treeEventEmitter: vscode.EventEmitter<TreeViewNode | null>,
        parentTreeNode: TreeViewNode[], reporter?: TelemetryReporter) {
        this.uri = uri;
        this._reporter = reporter;
        this._docEventEmitter = docEventEmitter;
        this._treeEventEmitter = treeEventEmitter;
        this._fileUri = uri.with({ scheme: "file" });
        if (!fs.existsSync(this._fileUri.fsPath)) {
            throw Error(`DltDocument file ${this._fileUri.fsPath} doesn't exist!`);
        }
        this._realStat = fs.statSync(uri.fsPath);

        // load column config:
        {
            const columnObjs = vscode.workspace.getConfiguration().get<Array<object>>("dlt-logs.columns");
            columnObjs?.forEach((obj) => {
                try {
                    this._columns.push(new ColumnConfig(obj));
                } catch (err) {
                    console.error(`error '${err} parsing '`, obj);
                }
            });
        }

        this.lifecycleTreeNode = { id: createUniqueId(), label: "Detected lifecycles", uri: this.uri, parent: null, children: [] };
        this.filterTreeNode = { id: createUniqueId(), label: "Filters", uri: this.uri, parent: null, children: [] };
        this.pluginTreeNode = { id: createUniqueId(), label: "Plugins", uri: this.uri, parent: null, children: [] };
        this.treeNode = {
            id: createUniqueId(),
            label: `${path.basename(this._fileUri.fsPath)}`, uri: this.uri, parent: null, children: [
                this.lifecycleTreeNode,
                this.filterTreeNode,
                this.pluginTreeNode,
            ]
        };
        this.treeNode.children.forEach((child) => { child.parent = this.treeNode; });
        parentTreeNode.push(this.treeNode);

        // load filters: 

        // todo add onDidChangeConfiguration handling to reflect filter changes at runtime
        {
            const decorationsObjs = vscode.workspace.getConfiguration().get<Array<object>>("dlt-logs.decorations");
            this.parseDecorationsConfigs(decorationsObjs);
        }
        {
            const filterObjs = vscode.workspace.getConfiguration().get<Array<object>>("dlt-logs.filters");
            this.parseFilterConfigs(filterObjs);
        }
        {
            // plugins:
            const pluginObjs = vscode.workspace.getConfiguration().get<Array<object>>("dlt-logs.plugins");
            this.parsePluginConfigs(pluginObjs);
        }


        const maxNrMsgsConf = vscode.workspace.getConfiguration().get<number>('dlt-logs.maxNumberLogs');
        this._maxNrMsgs = maxNrMsgsConf ? maxNrMsgsConf : 1000000; // 1mio default

        this._text = `Loading dlt document from uri=${this._fileUri.toString()} with max ${this._maxNrMsgs} msgs per page...`;

        const reReadTimeoutConf = vscode.workspace.getConfiguration().get<number>('dlt-logs.reReadTimeout');
        const reReadTimeout: number = reReadTimeoutConf ? reReadTimeoutConf : 1000; // 5s default

        setTimeout(() => {
            this.checkFileChanges();
        }, reReadTimeout);
    }

    stat(): vscode.FileStat {
        return {
            size: this._text.length, ctime: this._realStat.ctime.valueOf(), mtime: this._realStat.mtime.valueOf(),
            type: this._realStat.isDirectory() ? vscode.FileType.Directory : (this._realStat.isFile() ? vscode.FileType.File : vscode.FileType.Unknown)
        };
    }

    // config options for decorations
    private decWarning?: vscode.TextEditorDecorationType;
    private decError?: vscode.TextEditorDecorationType;
    private decFatal?: vscode.TextEditorDecorationType;
    private _decorationTypes = new Map<string, vscode.TextEditorDecorationType>(); // map with id and settings. init from config in parseDecorationsConfigs

    getDecorationFor(filter: DltFilter): vscode.TextEditorDecorationType | undefined {
        // for filter we use decorationId or filterColour:
        if (filter.decorationId) { return this._decorationTypes.get(filter.decorationId); };
        // now we assume at least a filterColour:
        const decFilterName = `filterColour_${filter.filterColour}`;
        let dec = this._decorationTypes.get(decFilterName);
        if (dec) { return dec; }
        // create this decoration:
        dec = vscode.window.createTextEditorDecorationType({ borderColor: filter.filterColour, borderWidth: "1px", borderStyle: "dotted", overviewRulerColor: filter.filterColour, overviewRulerLane: 2, isWholeLine: true });
        this._decorationTypes.set(decFilterName, dec);
        return dec;
    }

    parseDecorationsConfigs(decorationConfigs: Object[] | undefined) {
        console.log(`parseDecorationsConfigs: have ${decorationConfigs?.length} decorations to parse...`);
        if (this._decorationTypes.size) {

            // remove current ones from editor:
            this.textEditors.forEach((editor) => {
                this.decorations?.forEach((value, key) => {
                    editor.setDecorations(key, []);
                });
            });
            this.decorations = undefined; // todo allDecorations?
            this._decorationTypes.clear();
        }
        if (decorationConfigs && decorationConfigs.length) {
            for (let i = 0; i < decorationConfigs.length; ++i) {
                try {
                    const conf: any = decorationConfigs[i];
                    if (conf.id) {
                        console.log(` adding decoration id=${conf.id}`);
                        let decOpt = <vscode.DecorationRenderOptions>conf.renderOptions;
                        decOpt.isWholeLine = true;
                        let decType = vscode.window.createTextEditorDecorationType(decOpt);
                        this._decorationTypes.set(conf.id, decType);
                    }
                } catch (error) {
                    console.log(`dlt-logs.parseDecorationsConfig error:${error}`);
                }
            }
        }
        this.decWarning = this._decorationTypes.get("warning");
        this.decError = this._decorationTypes.get("error");
        this.decFatal = this._decorationTypes.get("fatal");

        console.log(`dlt-logs.parseDecorationsConfig got ${this._decorationTypes.size} decorations!`);
    }


    parseFilterConfigs(filterObjs: Object[] | undefined) {
        console.log(`parseFilterConfigs: have ${filterObjs?.length} filters to parse...`);
        if (filterObjs) {
            for (let i = 0; i < filterObjs.length; ++i) {
                try {
                    let filterConf = filterObjs[i];
                    let newFilter = new DltFilter(filterConf);
                    this.filterTreeNode.children.push(new FilterNode(null, this.filterTreeNode, newFilter));
                    this.allFilters.push(newFilter);
                    console.log(` got filter: type=${newFilter.type}, enabled=${newFilter.enabled}, atLoadTime=${newFilter.atLoadTime}`, newFilter);
                } catch (error) {
                    console.log(`dlt-logs.parseFilterConfigs error:${error}`);
                }
            }
        }
    }

    parsePluginConfigs(pluginObjs: Object[] | undefined) {
        console.log(`parsePluginConfigs: have ${pluginObjs?.length} plugins to parse...`);
        if (pluginObjs) {
            for (let i = 0; i < pluginObjs?.length; ++i) {
                try {
                    const pluginObj: any = pluginObjs[i];
                    const pluginName = pluginObj.name;
                    switch (pluginName) {
                        case 'FileTransfer':
                            {
                                let treeNode = { id: createUniqueId(), label: `File transfers`, uri: this.uri, parent: this.pluginTreeNode, children: [] };
                                const plugin = new DltFileTransferPlugin(this.uri, treeNode, this._treeEventEmitter, pluginObj);
                                this.pluginNodes.push(treeNode);
                                this.pluginTreeNode.children.push(treeNode);
                                this.allFilters.push(plugin);
                                this.filterTreeNode.children.push(new FilterNode(null, this.filterTreeNode, plugin)); // add to filter as well
                            }
                            break;
                    }

                } catch (error) {
                    console.log(`dlt-logs.parsePluginConfigs error:${error}`);
                }
            }
        }

    }

    adjustTime(relOffset: number) {
        this._timeAdjustMs += relOffset;
        console.log(`dlt-logs.adjustTime(${relOffset}) to new offset: ${this._timeAdjustMs}`);

        // adjust timeSyncs: as they contain pre-calculated times
        this.timeSyncs.forEach((syncData) => {
            syncData.time = new Date(syncData.time.valueOf() + relOffset);
        });
        // update lifecycle events
        this.lifecycles.forEach((lcInfos) => {
            lcInfos.forEach((lcInfo) => { lcInfo.adjustTimeMs = this._timeAdjustMs; });
        });
        this.updateLifecycleTreeNode(); // todo decorations are wrong till next apply filter...
        // fire events
        this._treeEventEmitter.fire(this.lifecycleTreeNode);

    }

    onFilterChange(filter: DltFilter) { // todo this is really dirty. need to reconsider these arrays...
        console.log(`onFilterChange filter.name=${filter.name}`);
        return vscode.window.withProgress({ cancellable: false, location: vscode.ProgressLocation.Notification, title: "applying filter..." },
            (progress) => this.applyFilter(progress));
    }

    /* todo clearFilter() {
        this.filteredMsgs = undefined;
        this._docEventEmitter.fire([{ type: vscode.FileChangeType.Changed, uri: this.uri }]); // todo needs renderLines first!
    } */

    static getFilter(allFilters: DltFilter[], enabled: boolean, atLoadTime: boolean, negBeforePos: boolean = false) {
        let toRet: DltFilter[][] = [];
        for (let i = DltFilterType.POSITIVE; i <= DltFilterType.EVENT + 1; ++i) { // +1 for NEGATIVE_BEFORE_POSITIVE
            toRet.push([]);
        }

        for (let i = 0; i < allFilters.length; ++i) {
            const filter = allFilters[i];
            if (filter.enabled === enabled && filter.atLoadTime === atLoadTime) {
                if (negBeforePos && filter.type === DltFilterType.NEGATIVE && filter.beforePositive) {
                    toRet[DltFilterType.EVENT + 1].push(filter);
                } else {
                    toRet[filter.type].push(filter);
                }
            }
        }
        return toRet;
    }

    private _applyFilterRunning: boolean = false;
    async applyFilter(progress: vscode.Progress<{ increment?: number | undefined, message?: string | undefined, }> | undefined, applyEventFilter: boolean = false) {
        if (this._applyFilterRunning) {
            console.warn(`applyFilter called while running already. ignoring for now. todo!`); // do proper fix queuing this request or some promise magic.
            return;
        }
        this._applyFilterRunning = true;
        try {
            this.filteredMsgs = [];
            // we can in parallel check criteria todo
            // but then add into filteredMsgs sequentially only

            // todo need to optimize speed here.
            // e.g. filter only until maxNrMsgs is there (and continue the rest in the background)
            // apply decorations in the background

            this._allDecorations = new Map<vscode.TextEditorDecorationType, vscode.DecorationOptions[]>();
            // remove current ones from editor:
            this.textEditors.forEach((editor) => {
                this.decorations?.forEach((value, key) => {
                    editor.setDecorations(key, []);
                });
            });
            this.decorations = undefined; // todo allDecorations?
            let numberDecorations: number = 0;
            const nrMsgs: number = this.msgs.length;
            let startTime = process.hrtime();

            if (applyEventFilter) {
                this.timeSyncs = [];
            }
            // sort the filters here into the enabled pos and neg:
            const [posFilters, negFilters, decFilters, eventFilters] = DltDocument.getFilter(this.allFilters, true, false);
            // todo we don't support negBeforePos yet... (not needed for FileTransferPlugin and as long as we dont support )
            for (let i = 0; i < nrMsgs; ++i) {
                if (i % 1000 === 0) { // provide process and responsiveness for UI:
                    let curTime = process.hrtime(startTime);
                    if (curTime[1] / 1000000 > 100) { // 100ms passed
                        if (progress) {
                            progress.report({ message: `filter processed ${i}/${nrMsgs} msgs.` });
                        }
                        await util.sleep(10); // 10ms each 100ms
                        startTime = process.hrtime();
                    }
                }
                const msg = this.msgs[i];

                if (applyEventFilter) {
                    // check for any events:
                    // currently timeSync only
                    if (eventFilters.length) {
                        for (let j = 0; j < eventFilters.length; ++j) {
                            const filter = eventFilters[j];
                            // remove report filter here:
                            if (!filter.isReport) {
                                if (filter.matches(msg) && filter.payloadRegex) {
                                    // get the value: // todo try to abstract that... create REPORT as sep. type?
                                    const timeSyncMatch = filter.payloadRegex.exec(msg.payloadString);
                                    if (timeSyncMatch && timeSyncMatch.length > 0) {
                                        const value = timeSyncMatch[timeSyncMatch.length - 1].toLowerCase();
                                        console.log(` timeSync filter '${filter.name}' matched at index ${i} with value '${value}'`);
                                        const time = this.provideTimeByMsg(msg);
                                        if (time && filter.timeSyncId && filter.timeSyncPrio) {
                                            this.timeSyncs.push({ time: time, id: filter.timeSyncId, prio: filter.timeSyncPrio, value: value });
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // check for visibility:
                // a msg is visible if:
                // no negative filter matches and
                // if any pos. filter exists: at least one positive filter matches (if no pos. filters exist -> treat as matching)
                let foundAfterPosFilters: boolean = posFilters.length ? false : true;
                if (posFilters.length) {
                    // check the pos filters, break on first match:
                    for (let j = 0; j < posFilters.length; ++j) {
                        if (posFilters[j].matches(msg)) {
                            foundAfterPosFilters = true;
                            break;
                        }
                    }
                }
                let foundAfterNegFilters: boolean = foundAfterPosFilters;
                if (foundAfterNegFilters && negFilters.length) {
                    // check the neg filters, break on first match:
                    for (let j = 0; j < negFilters.length; ++j) {
                        if (negFilters[j].matches(msg)) {
                            foundAfterNegFilters = false;
                            break;
                        }
                    }
                }

                if (foundAfterNegFilters) {
                    this.filteredMsgs.push(msg);
                    // any decorations? todo remove log-level ones once filter are extended to MSTP, MTIN.

                    msg.decorations = [];
                    let gotDeco: boolean = false;
                    if (this.decWarning && msg.mstp === MSTP.TYPE_LOG && msg.mtin === MTIN_LOG.LOG_WARN) {
                        msg.decorations.push([this.decWarning, [{ range: new vscode.Range(this.filteredMsgs.length - 1, 0, this.filteredMsgs.length - 1, 21), hoverMessage: new vscode.MarkdownString("$(warning) LOG_WARN", true) }]]);
                        gotDeco = true;
                    }
                    if (!gotDeco && this.decError && msg.mstp === MSTP.TYPE_LOG && msg.mtin === MTIN_LOG.LOG_ERROR) {
                        msg.decorations.push([this.decError, [{ range: new vscode.Range(this.filteredMsgs.length - 1, 0, this.filteredMsgs.length - 1, 21), hoverMessage: new vscode.MarkdownString("$(error) LOG_ERROR", true) }]]);
                    }
                    if (!gotDeco && this.decFatal && msg.mstp === MSTP.TYPE_LOG && msg.mtin === MTIN_LOG.LOG_FATAL) {
                        msg.decorations.push([this.decFatal, [{ range: new vscode.Range(this.filteredMsgs.length - 1, 0, this.filteredMsgs.length - 1, 21), hoverMessage: `LOG_FATAL` }]]);
                    }

                    if (!gotDeco) {
                        for (let d = 0; d < decFilters.length; ++d) {
                            let decFilter = decFilters[d];
                            if (decFilter.matches(msg)) {
                                // get decoration for this filter:
                                const decType = this.getDecorationFor(decFilter);
                                if (decType) {
                                    msg.decorations.push([decType, [{ range: new vscode.Range(this.filteredMsgs.length - 1, 0, this.filteredMsgs.length - 1, 21), hoverMessage: `MARKER ${decFilter.name}` }]]);
                                    gotDeco = true;
                                    break;
                                }
                            }
                        }
                    }

                    for (let m = 0; m < msg.decorations.length; ++m) {
                        const value = msg.decorations[m];
                        if (!this._allDecorations?.has(value[0])) {
                            this._allDecorations?.set(value[0], []);
                        }
                        // adapt line here?
                        for (let d = 0; d < value[1].length; ++d) {
                            this._allDecorations?.get(value[0])?.push(value[1][d]);
                            numberDecorations++;
                        }
                    }
                }
            }

            // create decorations for the lifecycles:
            let lcDecos = [this._decorationTypes.get("lifecycleEven"), this._decorationTypes.get("lifecycleOdd")];

            if (lcDecos[0] !== undefined) { this._allDecorations.set(lcDecos[0], []); }
            if (lcDecos[1] !== undefined) { this._allDecorations.set(lcDecos[1], []); }

            if (lcDecos[0] !== undefined || lcDecos[1] !== undefined) {
                // we only decorate the ECU with the most messages. (not taking filters into account...)
                // otherwise the decorations overlap too much
                let lcMsgCntMap = new Map<string, number>();
                this.lifecycles.forEach((lcs, ecu) => {
                    lcs.forEach((lcInfo) => {
                        let msgCnt = lcMsgCntMap.get(ecu);
                        if (!msgCnt) {
                            lcMsgCntMap.set(ecu, lcInfo.logMessages.length);
                        } else {
                            lcMsgCntMap.set(ecu, msgCnt + lcInfo.logMessages.length);
                        }
                    });
                });
                let maxCnt = 0;
                let maxEcu: string | undefined = undefined;
                lcMsgCntMap.forEach((msgCnt, ecu) => {
                    if (msgCnt > maxCnt) {
                        maxCnt = msgCnt;
                        maxEcu = ecu;
                    }
                });

                if (maxEcu) {
                    const lcs = this.lifecycles.get(maxEcu);
                    if (lcs) {
                        // console.log(` applyFilter decorating lifecycles for ecu:'${ecu}'`);
                        for (let lcCnt = 0; lcCnt < lcs.length; ++lcCnt) {
                            const lc = lcs[lcCnt];
                            console.log(` applyFilter decorating lifecycle ${maxEcu} #${lcCnt} '${lc.startIndex} - ${lc.endIndex}'`);
                            const lcDec = lcDecos[lcCnt % 2];
                            if (lcDec !== undefined) {
                                const startLine: number = this.lineCloseTo(lc.startIndex, true);
                                let endLine: number = this.lineCloseTo(lc.endIndex, true);
                                if (!endLine) {
                                    endLine = this.staticLinesAbove.length + (this.filteredMsgs?.length ? this.filteredMsgs.length - 1 : 0);
                                }
                                console.log(`  decorating lifecycle ${maxEcu} #${lcCnt} '${startLine} - ${endLine}'`);
                                const dec = { range: new vscode.Range(startLine, 0, endLine, 21), hoverMessage: `lifecycle: ${lc.lifecycleStart.toLocaleTimeString()}-${lc.lifecycleEnd.toLocaleTimeString()}` };
                                this._allDecorations?.get(lcDec)?.push(dec);
                            }
                        }
                    }
                }
            }

            console.log(`applyFilter got ${numberDecorations} decorations.`);
        } catch (err) {
            console.error(`applyFilter got err='${err}'`);
        }
        this._applyFilterRunning = false;
        return this.renderLines(this._skipMsgs, progress);
    }

    lineCloseTo(index: number, ignoreSkip = false): number {
        // provides the line number "close" to the index 
        // todo this causes problems once we do sort msgs (e.g. by timestamp)
        // that is the matching line or the next higher one
        // todo use binary search
        if (this.filteredMsgs) {
            for (let i = 0; i < this.filteredMsgs.length; ++i) {
                if (this.filteredMsgs[i].index >= index) {

                    // is i skipped?
                    if (!ignoreSkip && i < this._skipMsgs) {
                        console.log(`lineCloseTo(${index} not in range (<). todo needs to trigger reload.)`);
                        return this.staticLinesAbove.length; // go to first line
                    }
                    if (!ignoreSkip && i > this._skipMsgs + this._maxNrMsgs) {
                        console.log(`lineCloseTo(${index} not in range (>). todo needs to trigger reload.)`);
                        return this.staticLinesAbove.length + this._maxNrMsgs; // go to first line    
                    }
                    return i + (ignoreSkip ? 0 : this.staticLinesAbove.length);
                }
            }
            return 0;
        } else {
            // todo check that index is not smaller...
            if (index < (this._skipMsgs + this.staticLinesAbove.length)) {
                console.log(`lineCloseTo(${index} not in range (<). todo needs to trigger reload.)`);
                return this.staticLinesAbove.length; // go to first line
            }
            if (index > (this._skipMsgs + this._maxNrMsgs)) {
                console.log(`lineCloseTo(${index} not in range (>). todo needs to trigger reload.)`);
                return this.staticLinesAbove.length + this._maxNrMsgs;
            }
            return index - this._skipMsgs - this.staticLinesAbove.length; // unfiltered: index = line nr. both zero-based
        }
    }

    lineCloseToDate(date: Date): number {
        console.log(`DltDocument.lineCloseToDate(${date.toLocaleTimeString()})...`);
        const dateValueLC = date.valueOf();
        const dateValueNoLC = dateValueLC - this._timeAdjustMs;

        // todo optimize with binary/tree search. with filteredMsgs it gets tricky.
        // so for now do linear scan...

        const msgs = this.filteredMsgs ? this.filteredMsgs : this.msgs;
        for (let i = 0; i < msgs.length; ++i) {
            const logMsg = msgs[i];
            if (!(logMsg.mstp === MSTP.TYPE_CONTROL && logMsg.mtin === MTIN_CTRL.CONTROL_REQUEST)) {
                const startDate = logMsg.lifecycle ? logMsg.lifecycle.lifecycleStart.valueOf() : logMsg.time.valueOf();
                if (startDate + (logMsg.timeStamp / 10) >= (logMsg.lifecycle ? dateValueLC : dateValueNoLC)) {
                    console.log(`DltDocument.lineCloseToDate(${date.toLocaleTimeString()}) found line ${i}`);
                    return this.revealByMsgsIndex(i);
                }
            }
        }
        return -1;
    }

    msgByLine(line: number): DltMsg | undefined {
        const msgs = this.filteredMsgs ? this.filteredMsgs : this.msgs;
        // line = index
        if (line >= this.staticLinesAbove.length && line < (this._skipMsgs + msgs.length)) { // we don't have to check whether the msg is visible here
            return msgs[line + this._skipMsgs];
        } else {
            return;
        }
    }

    provideTimeByMsg(msg: DltMsg): Date | undefined {
        if ((msg.mstp === MSTP.TYPE_CONTROL && msg.mtin === MTIN_CTRL.CONTROL_REQUEST)) {
            return;
        }
        if (msg.lifecycle) {
            return new Date(msg.lifecycle.lifecycleStart.valueOf() + (msg.timeStamp / 10));
        }
        return new Date(this._timeAdjustMs + msg.time.valueOf() + (msg.timeStamp / 10));
    }

    provideTimeByLine(line: number): Date | undefined {
        // provide the time fitting to that line
        // todo take adjustTime into account
        const msg = this.msgByLine(line);
        if (msg) {
            return this.provideTimeByMsg(msg);
        } else {
            return;
        }
    }

    public provideHover(position: vscode.Position): vscode.ProviderResult<vscode.Hover> {
        const msg = this.msgByLine(position.line);
        if (!msg) {
            return;
        }
        const posTime = this.provideTimeByMsg(msg);
        if (posTime) {
            return new vscode.Hover({ language: "dlt-log", value: `calculated time: ${posTime.toLocaleTimeString()}.${String(posTime.valueOf() % 1000).padStart(3, "0")} index#=${msg.index} timestamp=${msg.timeStamp} reception time=${msg.time.toLocaleTimeString()} mtin=${msg.mtin}` });
        } else {
            return new vscode.Hover({ language: "dlt-log", value: `calculated time: <none> index#=${msg.index} timestamp=${msg.timeStamp} reception time=${msg.time.toLocaleTimeString()}` });
        }
    }

    notifyVisibleRange(range: vscode.Range) {

        // we do show max _maxNrMsgs from [_skipMsgs, _skipMsgs+_maxNrMsgs)
        // and trigger a reload if in the >4/5 or <1/5
        // and jump by 0.5 then

        const triggerAboveLine = range.start.line;
        const triggerBelowLine = range.end.line;

        // we ignore the ranges for the interims "loading..." docs.
        if (triggerBelowLine - triggerAboveLine < 10) {
            console.log(` notifyVisibleRange ignoring as range too small (visible: [${triggerAboveLine}-${triggerBelowLine}]) current: [${this._skipMsgs}-${this._skipMsgs + this._maxNrMsgs})`);
            return;
        }

        if (this._renderTriggered) {
            console.log(` notifyVisibleRange ignoring as render triggered (visible: [${triggerAboveLine}-${triggerBelowLine}]) current: [${this._skipMsgs}-${this._skipMsgs + this._maxNrMsgs})`);
        }
        if (triggerAboveLine <= (this._maxNrMsgs * 0.2)) {
            // can we scroll to the top?
            if (this._skipMsgs > 0) {
                if (!this._renderTriggered) {
                    console.log(` notifyVisibleRange(visible: [${triggerAboveLine}-${triggerBelowLine}]) current: [${this._skipMsgs}-${this._skipMsgs + this._maxNrMsgs}) triggerAbove`);
                    this._renderTriggered = true;

                    if (this.textEditors && this.textEditors.length > 0) {
                        this.textEditors.forEach((editor) => {
                            const shiftByLines = +this._maxNrMsgs * 0.5;
                            let newRange = new vscode.Range(triggerAboveLine + shiftByLines, range.start.character,
                                triggerBelowLine + shiftByLines, range.end.character);
                            editor.revealRange(newRange, vscode.TextEditorRevealType.AtTop);
                        });
                    }

                    this.renderLines(this._skipMsgs - (this._maxNrMsgs * 0.5));
                }
            }
        }

        if (triggerBelowLine >= (this._maxNrMsgs * 0.8)) {
            // can we load more msgs?
            const msgs = this.filteredMsgs ? this.filteredMsgs : this.msgs;
            if (this._skipMsgs + this._maxNrMsgs < msgs.length) {
                if (!this._renderTriggered) {
                    console.log(` notifyVisibleRange(visible: [${triggerAboveLine}-${triggerBelowLine}]) current: [${this._skipMsgs}-${this._skipMsgs + this._maxNrMsgs}) triggerBelow`);
                    this._renderTriggered = true;

                    if (this.textEditors.length > 0) {
                        this.textEditors.forEach((editor) => {
                            const shiftByLines = -this._maxNrMsgs * 0.5;
                            let newRange = new vscode.Range(triggerAboveLine + shiftByLines, range.start.character,
                                triggerBelowLine + shiftByLines, range.end.character);
                            editor.revealRange(newRange, vscode.TextEditorRevealType.AtTop);
                        });
                    }

                    this.renderLines(this._skipMsgs + (this._maxNrMsgs * 0.5));
                }
            }
        };
    }

    revealByMsgsIndex(i: number): number { // msgs Index = the i inside msgs/filteredMsgs[i]
        // return the line number that this msg will get
        // and trigger the reload if needed

        if (this._renderPending) {
            console.log('revealByMsgsIndex aborted due to renderPending!');
            return -1;
        }

        // currently visible?
        if (this._skipMsgs <= i && (this._skipMsgs + this._maxNrMsgs) > i) {
            return i - this._skipMsgs + this.staticLinesAbove.length;
        } else {
            // we do need to reveal it:
            // so that it ends up in the range 0.25-0.75
            const lowerLine = this._maxNrMsgs * 0.25;
            const upperLine = this._maxNrMsgs * 0.75;

            for (let newSkipMsgs = -this._maxNrMsgs; ; newSkipMsgs += this._maxNrMsgs / 2) { // todo might need special handling for upper bound!
                let newNr = i - newSkipMsgs;
                if (newNr >= lowerLine && newNr <= upperLine) {
                    // got it:
                    if (newSkipMsgs < 0) {
                        newNr = i;
                        newSkipMsgs = 0;
                    }
                    if (newSkipMsgs !== this._skipMsgs) {
                        this._renderTriggered = true;
                        this.renderLines(newSkipMsgs);
                    }
                    console.log(`revealByMsgsIndex(${i}) newSkipMsgs=${newSkipMsgs} newNr=${newNr}`);
                    return newNr; // todo staticLinesAbove?
                }
            }
            console.log(`revealByMsgsIndex(${i}) couldnt determine newSkipMsgs`);
            return -1;
        }
    }

    revealIndex(index: number): number { // return line nr that the msg with index will get:
        console.log(`revealIndex(${index})...`);
        if (this.filteredMsgs) { // todo renderTriggered needed?
            for (let i = 0; i < this.filteredMsgs.length; ++i) {
                if (this.filteredMsgs[i].index >= index) {
                    // we want line msg i:
                    return this.revealByMsgsIndex(i);
                }
            }
            console.log(` revealIndex(${index}) not found!`);
            return -1;
        } else {
            // here we can calc directly:
            // for now we assume index = i if not filtered.
            // todo recheck once the impl. for sorting by timestamp is available
            return this.revealByMsgsIndex(index);
        }

    }

    async configureColumns(): Promise<void> {
        console.log(`DltDocument.configureColumns()...`);
        let columns = this._columns;

        vscode.window.showQuickPick(columns, {
            canPickMany: true,
            placeHolder: "select all columns to show"
        }).then((selColumns: ColumnConfig[] | undefined) => {
            if (selColumns) {
                if (selColumns.length > 0) {
                    columns.forEach((column) => { column.visible = false; });
                    selColumns?.forEach((column) => { column.visible = true; });

                    if (true) { // store/update config:
                        const columnObjs = vscode.workspace.getConfiguration().get<Array<object>>("dlt-logs.columns");
                        columnObjs?.forEach((obj: any) => {
                            columns.forEach((column) => {
                                try {
                                    if (obj.name === column.name) {
                                        obj.visible = column.visible;
                                    }
                                } catch (err) {
                                    console.error(` err ${err} at updating config obj!`);
                                }
                            });
                            try {
                                vscode.workspace.getConfiguration().update("dlt-logs.columns", columnObjs, vscode.ConfigurationTarget.Global).then(() => {
                                    // todo might need a better solution if workspace config is used.
                                    // the changes wont be reflected at next startup. (default->global->workspace)
                                    // would need to inspect first.
                                    console.log("updated column config.");
                                });
                            } catch (err) {
                                console.error(` err ${err} at updating configuration!`);
                            }
                        });
                    }
                    return vscode.window.withProgress({ cancellable: false, location: vscode.ProgressLocation.Notification, title: "applying filter..." },
                        (progress) => this.applyFilter(progress)).then(() => console.log(`DltDocument.configureColumns() applyFilter() done`));
                } else { // we disallow unselecting all columns
                    vscode.window.showWarningMessage("At least one column need to be selected. Ignoring selection.");
                }
            } // else we don't change anything
            console.log(`DltDocument.configureColumns()... done`);
        });
    }

    async renderLines(skipMsgs: number, progress?: vscode.Progress<{ increment?: number | undefined, message?: string | undefined, }>): Promise<void> {
        const fnStart = process.hrtime();
        console.log(`DltDocument.renderLines(${skipMsgs}) with ${this.filteredMsgs?.length}/${this.msgs.length} msgs ...`);
        if (this._renderPending) {
            console.error(`DltDocument.renderLines called while already running! Investigate / todo`);
        }
        this._renderPending = true;
        if (this.msgs.length === 0) {
            this._text = `Loading dlt document from uri=${this._fileUri.toString()}...`;
            this._renderPending = false;
            this._docEventEmitter.fire([{ type: vscode.FileChangeType.Changed, uri: this.uri }]);
            return;
        }

        let toRet: string = "";

        let msgs = this.filteredMsgs ? this.filteredMsgs : this.msgs;

        if (msgs.length === 0) { // filter might lead to 0 msgs
            this._text = `<current filter leads to empty file>`;
            this._renderPending = false;
            this._docEventEmitter.fire([{ type: vscode.FileChangeType.Changed, uri: this.uri }]);
            return;
        }

        const nrMsgs = msgs.length > this._maxNrMsgs ? this._maxNrMsgs : msgs.length;
        const renderRangeStartLine = skipMsgs;
        const renderRangeEndLine = skipMsgs + nrMsgs;

        if (this._allDecorations?.size) {
            if (!this.decorations || this._skipMsgs !== skipMsgs) {

                if (progress) {
                    progress.report({ message: "renderLines: removing decorations" });
                    await util.sleep(10);
                }
                // remove decorations:
                this.textEditors.forEach((editor) => {
                    this.decorations?.forEach((value, key) => {
                        editor.setDecorations(key, []);
                    });
                });
                if (progress) {
                    progress.report({ message: "renderLines: adapting decorations" });
                    await util.sleep(10);
                }
                // need to adjust the visible decorations:
                this.decorations = new Map<vscode.TextEditorDecorationType, vscode.DecorationOptions[]>();
                // add all visible decorations:
                this._allDecorations.forEach((decOpts, decType) => {
                    let visibleDecOpts: vscode.DecorationOptions[] = [];
                    for (let i = 0; i < decOpts.length; ++i) {
                        const decOpt = decOpts[i];
                        if ((decOpt.range.start.line >= skipMsgs && decOpt.range.start.line < skipMsgs + this._maxNrMsgs) ||
                            (decOpt.range.end.line >= skipMsgs && decOpt.range.end.line < skipMsgs + this._maxNrMsgs)) {
                            let newStartLine = decOpt.range.start.line - skipMsgs - this.staticLinesAbove.length;
                            if (newStartLine < this.staticLinesAbove.length) {
                                newStartLine = this.staticLinesAbove.length;
                            }
                            let newEndLine = decOpt.range.end.line - skipMsgs - this.staticLinesAbove.length;
                            // is the newEnd still in range?
                            if (newEndLine > renderRangeEndLine) {
                                newEndLine = renderRangeEndLine;
                            }
                            let newDecOpt: vscode.DecorationOptions = {
                                renderOptions: decOpt.renderOptions, hoverMessage: decOpt.hoverMessage,
                                range: new vscode.Range(newStartLine,
                                    decOpt.range.start.character,
                                    newEndLine, decOpt.range.end.character)
                            };
                            /*if (newDecOpt.range.start.line !== newDecOpt.range.end.line) {
                                console.log(` updated decoration from [${decOpt.range.start.line}-${decOpt.range.end.line}] - [${newStartLine}-${newEndLine}]`);
                            }*/
                            visibleDecOpts.push(newDecOpt);
                        }
                    }
                    if (visibleDecOpts.length) {
                        this.decorations?.set(decType, visibleDecOpts);
                    }
                });
            } else {
                console.log(` renderLines !(!this.decorations(${this.decorations})|| this._skipMsgs(${this._skipMsgs}) !== skipMsgs(${skipMsgs}))`);
            }
        } else {
            console.log(' renderLines got no allDecorations.');
        }

        this._skipMsgs = skipMsgs;
        console.log(` processing msg ${renderRangeStartLine}-${renderRangeEndLine}...`);

        const numberStart = renderRangeStartLine;
        let numberEnd = renderRangeEndLine - 1;
        assert(numberEnd >= numberStart, "logical error: numberEnd>=numberStart");
        toRet = "";
        // mention skipped lines?
        if (false && renderRangeStartLine > 0) { // todo someparts are off by 1 then
            this.staticLinesAbove = [];
            this.staticLinesAbove.push(`...skipped ${renderRangeStartLine} msgs...\n`);
            toRet += this.staticLinesAbove[0];
        }
        // todo render some at the end?

        // which columns should be shown?
        let showIndex: boolean = true;
        let showTime: boolean = false;
        let showTimestamp: boolean = false;
        let showMcnt: boolean = false;
        let showEcu: boolean = true;
        let showApid: boolean = true;
        let showCtid: boolean = true;
        let showType: boolean = false;
        let showSubtype: boolean = false;
        let showMode: boolean = false;
        let showPayload: boolean = true;

        for (let c = 0; c < this._columns.length; ++c) {
            const column = this._columns[c];
            switch (column.name) {
                case 'index': showIndex = column.visible; break;
                case 'recorded time': showTime = column.visible; break;
                case 'timestamp': showTimestamp = column.visible; break;
                case 'ecu': showEcu = column.visible; break;
                case 'apid': showApid = column.visible; break;
                case 'ctid': showCtid = column.visible; break;
                case 'text': showPayload = column.visible; break;
                case 'mcnt': showMcnt = column.visible; break;
                case 'type': showType = column.visible; break;
                case 'subtype': showSubtype = column.visible; break;
                case 'mode': showMode = column.visible; break;
                default: {
                    console.warn(`unknown column name: '${column.name}'`);
                } break;
            }
        }
        // length of max index
        const maxIndexLength = Math.floor(Math.log10(msgs[msgs.length - 1].index)) + 1;

        let startTime = process.hrtime();
        for (let j = numberStart; j <= numberEnd && j < msgs.length; ++j) {
            const msg = msgs[j];
            try {
                if (showIndex) { toRet += String(msg.index).padStart(maxIndexLength) + ' '; }
                if (showTime) { toRet += msg.time.toLocaleTimeString() + ' '; } // todo pad to one len?
                if (showTimestamp) { toRet += String(msg.timeStamp).padStart(8) + ' '; }
                if (showMcnt) { toRet += String(msg.mcnt).padStart(3) + ' '; }
                if (showEcu) { toRet += String(msg.ecu).padEnd(5); } // 5 as we need a space anyhow
                if (showApid) { toRet += String(msg.apid).padEnd(5); }
                if (showCtid) { toRet += String(msg.ctid).padEnd(5); }
                if (showType) {
                    switch (msg.mstp) {
                        case MSTP.TYPE_LOG: toRet += "log "; break;
                        case MSTP.TYPE_CONTROL: toRet += "control "; break;
                        case MSTP.TYPE_NW_TRACE: toRet += "network "; break;
                        case MSTP.TYPE_APP_TRACE: toRet += "trace "; break;
                    }
                }
                if (showSubtype) {
                    let subStr;
                    switch (msg.mstp) {
                        case MSTP.TYPE_LOG:
                            subStr = MTIN_LOG_strs[msg.mtin];
                            break;
                        case MSTP.TYPE_CONTROL:
                            subStr = MTIN_CTRL_strs[msg.mtin] + ' ';
                            break;
                        case MSTP.TYPE_APP_TRACE:
                            subStr = MTIN_TRACE_strs[msg.mtin] + ' ';
                            break;
                        case MSTP.TYPE_NW_TRACE:
                            subStr = MTIN_NW_strs[msg.mtin] + ' ';
                            break;
                    }
                    toRet += subStr.padEnd(9); // 9 = min length = len(response)+1
                }
                if (showMode) { toRet += msg.verbose ? "verbose " : "non-verbose "; }
                if (showPayload) { toRet += msg.payloadString; }
                toRet += '\n';
            } catch (error) {
                console.error(`error ${error} at parsing msg ${j}`);
                await util.sleep(100); // avoid hard busy loops!
            }
            if (j % 1000 === 0) {
                let curTime = process.hrtime(startTime);
                if (curTime[1] / 1000000 > 100) { // 100ms passed
                    if (progress) {
                        progress.report({ message: `renderLines: processing msg ${j}` });
                        await util.sleep(10);
                    }
                    startTime = process.hrtime();
                }
            }
        }

        // need to remove current text in the editor and insert new one.
        // otherwise the editor tries to identify the changes. that
        // lasts long on big files...
        // tried using editor.edit(replace or remove/insert) but that leads to a 
        // doc marked with changes and then FileChange event gets ignored...
        // so we add empty text interims wise:
        this._text = "...revealing new range...";
        this._docEventEmitter.fire([{ type: vscode.FileChangeType.Changed, uri: this.uri }]);
        await util.sleep(100);

        this._text = toRet;
        const fnEnd = process.hrtime(fnStart);
        console.info('DltDocument.renderLines() took: %ds %dms', fnEnd[0], fnEnd[1] / 1000000);
        await util.sleep(10); // todo not needed anylonger?
        this._docEventEmitter.fire([{ type: vscode.FileChangeType.Changed, uri: this.uri }]);
        this._renderPending = false;

    }

    async checkFileChanges() {
        // we want this to be callable from file watcher as well
        // we will assume that only additional data has been written
        // so we parse from _parsedFileLen to the end:
        const fnStart = process.hrtime();
        const stats = fs.statSync(this._fileUri.fsPath);
        if (stats.size > this._parsedFileLen) {
            if (this._reporter && this._parsedFileLen === 0) {
                this._reporter.sendTelemetryEvent("open file", undefined, { 'fileSize': stats.size });
            }
            const fd = fs.openSync(this._fileUri.fsPath, "r");
            let read: number = 0;
            let chunkSize = 10 * 1024 * 1024; // todo config
            if ((stats.size - this._parsedFileLen) < chunkSize) {
                chunkSize = stats.size - this._parsedFileLen;
            }

            return vscode.window.withProgress({ cancellable: false, location: vscode.ProgressLocation.Notification, title: "loading dlt file..." },
                async (progress) => {
                    // do we have any filters to apply at load time?
                    const [posFilters, negFilters, decFilters, eventFilters, negBeforePosFilters] = DltDocument.getFilter(this.allFilters, true, true);
                    console.log(` have ${posFilters.length} pos. and ${negFilters.length} neg. filters at load time.`);

                    let data = Buffer.allocUnsafe(chunkSize);
                    let startTime = process.hrtime();
                    do {
                        read = fs.readSync(fd, data, 0, chunkSize, this._parsedFileLen);
                        if (read) {
                            // parse data:
                            let parseInfo = DltDocument.dltP.parseDltFromBuffer(Buffer.from(data.slice(0, read)), 0, this.msgs, posFilters, negFilters, negBeforePosFilters); // have to create a copy of Buffer here!
                            if (parseInfo[0] > 0) {
                                console.log(`checkFileChanges skipped ${parseInfo[0]} bytes.`);
                            }
                            if (parseInfo[1] > 0) {
                                console.log(`checkFileChanges read=${read} remaining=${parseInfo[1]} bytes. Parse ${parseInfo[2]} msgs.`);
                            }
                            if (read !== parseInfo[1]) {
                                this._parsedFileLen += read - parseInfo[1];
                                let curTime = process.hrtime(startTime);
                                if (curTime[1] / 1000000 > 100) { // 100ms passed
                                    progress.report({ message: `processed ${this._parsedFileLen} from ${stats.size} bytes` });
                                    await util.sleep(10); // 10ms each 100ms
                                    startTime = process.hrtime();
                                }
                            } else {
                                console.log(`checkFileChanges read=${read} remaining=${parseInfo[1]} bytes. Parse ${parseInfo[2]} msgs. Stop parsing to avoid endless loop.`);
                                read = 0;
                            }
                        }
                    } while (read > 0);
                    fs.closeSync(fd);
                    const readEnd = process.hrtime(fnStart);
                    console.info('checkFileChanges read took: %ds %dms', readEnd[0], readEnd[1] / 1000000);
                    progress.report({ message: `reading done. Determining lifecycles...` });
                    await util.sleep(50);
                    const lcStart = process.hrtime();
                    // update lifecycles:
                    // todo have to add an index here to updateLifecycles. for now clear the lifecycles:
                    this.lifecycles.clear();
                    DltLifecycleInfo.updateLifecycles(this.msgs, this.lifecycles);
                    // update the lifecycleNode:
                    this.updateLifecycleTreeNode();

                    const lcEnd = process.hrtime(lcStart);
                    console.info('checkFileChanges lcUpdate took: %ds %dms', lcEnd[0], lcEnd[1] / 1000000);
                    progress.report({ message: `Got ${this.lifecycles.size} ECUs. Applying filter...` });
                    await util.sleep(50);
                    const applyFilterStart = process.hrtime();
                    /* todo jft */ await this.applyFilter(progress, true); // await wouldn't be necessary but then we keep the progress info open
                    const applyFilterEnd = process.hrtime(applyFilterStart);
                    console.info('checkFileChanges applyFilter took: %ds %dms', applyFilterEnd[0], applyFilterEnd[1] / 1000000);
                    progress.report({ message: `Filter applied. Finish. (gc kicks in now frequently...)` });
                    await util.sleep(50);
                }
            ).then(() => {
                const fnEnd = process.hrtime(fnStart);
                console.info('checkFileChanges took: %ds %dms', fnEnd[0], fnEnd[1] / 1000000);
            });
        } else {
            console.log(`checkFileChanges no file size increase (size=${stats.size} vs ${this._parsedFileLen})`);
        }
    }

    private updateLifecycleTreeNode() {
        this.lifecycleTreeNode.children = [];
        this.lifecycles.forEach((lcInfo, ecu) => {
            let ecuNode: TreeViewNode = { id: createUniqueId(), label: `ECU: ${ecu}`, parent: this.lifecycleTreeNode, children: [], uri: this.uri };
            this.lifecycleTreeNode.children.push(ecuNode);
            console.log(`${ecuNode.label}`);
            // add lifecycles
            for (let i = 0; i < lcInfo.length; ++i) {
                const lc = lcInfo[i];
                let lcNode: TreeViewNode = {
                    id: createUniqueId(),
                    label: lc.getTreeNodeLabel(),
                    parent: ecuNode, children: [], uri: this.uri.with({ fragment: lc.startIndex.toString() })
                };
                ecuNode.children.push(lcNode);
            }
        });
    }

    private _reports: DltReport[] = [];
    onOpenReport(context: vscode.ExtensionContext, filter: DltFilter, newReport: boolean = false) {
        console.log(`onOpenReport called...`);

        if (!newReport && this._reports.length > 0) {
            // we do add to the report that was last active:
            let report = this._reports[0];
            let lastChangeActive = report.lastChangeActive;
            for (let i = 1; i < this._reports.length; ++i) {
                const r2 = this._reports[i];
                if (lastChangeActive === undefined || (r2.lastChangeActive && (r2.lastChangeActive.valueOf() > lastChangeActive.valueOf()))) {
                    report = r2;
                    lastChangeActive = r2.lastChangeActive;
                }
            }
            report.addFilter(filter);
        } else {
            let report = new DltReport(context, this, (r: DltReport) => {
                console.log(`onOpenReport onDispose called... #reports=${this._reports.length}`);
                const idx = this._reports.indexOf(r);
                if (idx >= 0) {
                    this._reports.splice(idx, 1);
                }
                console.log(`onOpenReport onDispose done #reports=${this._reports.length}`);
            });;
            this._reports.push(report); // todo implement Disposable for DltDocument as well so that closing a doc closes the report as well
            report.addFilter(filter);
        }
    }
};