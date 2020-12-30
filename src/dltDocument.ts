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
import { TreeViewNode, FilterNode, TimeSyncData, createUniqueId, ConfigNode } from './dltDocumentProvider';
import { DltFilter, DltFilterType } from './dltFilter';
import TelemetryReporter from 'vscode-extension-telemetry';
import { DltFileTransferPlugin } from './dltFileTransfer';
import { DltReport } from './dltReport';
import { loadTimeFilterAssistant } from './dltLoadTimeAssistant';
import { v4 as uuidv4 } from 'uuid';

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
    configTreeNode: TreeViewNode;
    pluginTreeNode: TreeViewNode; // this is from the parent = DltDocumentProvider
    pluginNodes: TreeViewNode[] = [];

    private _treeEventEmitter: vscode.EventEmitter<TreeViewNode | null>;

    private _didAutoEnableConfigs: boolean; // we do enable once we do know the lifecycles

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

        this.lifecycleTreeNode = { id: createUniqueId(), label: "Detected lifecycles", uri: this.uri, parent: null, children: [], tooltip: undefined, iconPath: new vscode.ThemeIcon('list-selection') };
        this.filterTreeNode = { id: createUniqueId(), label: "Filters", uri: this.uri, parent: null, children: [], tooltip: undefined, iconPath: new vscode.ThemeIcon('filter') };
        this.configTreeNode = { id: createUniqueId(), label: "Configs", uri: this.uri, parent: null, children: [], tooltip: undefined, iconPath: new vscode.ThemeIcon('references') };
        this.pluginTreeNode = { id: createUniqueId(), label: "Plugins", uri: this.uri, parent: null, children: [], tooltip: undefined, iconPath: new vscode.ThemeIcon('package') };
        this.treeNode = {
            id: createUniqueId(),
            label: `${path.basename(this._fileUri.fsPath)}`, uri: this.uri, parent: null, children: [
                this.lifecycleTreeNode,
                this.filterTreeNode,
                this.configTreeNode,
                this.pluginTreeNode,
            ],
            tooltip: undefined,
            iconPath: new vscode.ThemeIcon('file')
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
            const filterSection = "dlt-logs.filters";
            let filterObjs = vscode.workspace.getConfiguration().get<Array<object>>(filterSection);

            // we add here some migration logic for <0.30 to >=0.30 as we introduced "id" (uuid) for identifying
            // filter configs:
            if (filterObjs) {
                let migrated = false;
                try {
                    for (let i = 0; i < filterObjs.length; ++i) {
                        let filterConf: any = filterObjs[i];
                        if (!('id' in filterConf)) {
                            const newId = uuidv4();
                            console.log(` got filter: type=${filterConf?.type} without id. Assigning new one: ${newId}`);
                            filterConf.id = newId;
                            migrated = true;
                        }
                    }
                    if (migrated) {
                        // update config:
                        util.updateConfiguration(filterSection, filterObjs);
                        // sadly we can't wait here...
                        vscode.window.showInformationMessage('Migration to new version: added ids to your existing filters.');
                    }
                } catch (error) {
                    console.log(`dlt-logs migrate 0.30 add id/uuid error:${error}`);
                    vscode.window.showErrorMessage('Migration to new version: failed to add ids to your existing filters. Please add manually (id fields with uuids.). Modification of filters via UI not possible until this is resolve.');
                }
            }
            this.parseFilterConfigs(filterObjs);
        }
        {
            // plugins:
            const pluginObjs = vscode.workspace.getConfiguration().get<Array<object>>("dlt-logs.plugins");
            this.parsePluginConfigs(pluginObjs);
        }
        { // configs (we might decide to load those before the filters but filters can add configs as well)
            // here we mainly parse the "autoEnableIf":
            const configObjs = vscode.workspace.getConfiguration().get<Array<object>>('dlt-logs.configs');
            this.parseConfigs(configObjs);
            // now disable by default all filters in all configs and recheck once we do know the lifecycles:
            // so we do keep the filters that are not part of a config with there current values.
            {
                // iterate through all config nodes:
                this.configTreeNode.children.forEach(node => {
                    if (node instanceof ConfigNode) {
                        node.updateAllFilter('disable');
                    }
                });
            }
            this._didAutoEnableConfigs = false;
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

    getConfigNode(name: string, create = true): TreeViewNode | undefined {
        if (name.length === 0) { return undefined; }
        const confStr = name.split('/');
        let parentNode: TreeViewNode | undefined = this.configTreeNode;
        for (let l = 0; l < confStr.length; ++l) {
            const confPart = confStr[l];
            if (confPart.length === 0) { return undefined; }
            let child: ConfigNode | undefined = undefined;
            // search for confPart within parentNode/children
            for (let n = 0; n < parentNode.children.length; ++n) {
                if (parentNode.children[n].label === confPart) { child = parentNode.children[n] as ConfigNode; break; }
            }
            if (create && (child === undefined)) {
                // create new child
                child = new ConfigNode(parentNode.uri, parentNode, confPart);
                const filterChild = new ConfigNode(child.uri, child, '');
                filterChild.iconPath = new vscode.ThemeIcon('list-flat');
                filterChild.description = "list of assigned filters";
                child.children.push(filterChild);
                parentNode.children.push(child);
                console.log(`getConfigNode created child ${child.label}`);
                this._treeEventEmitter.fire(this.configTreeNode);
            }
            parentNode = child;
            if (parentNode === undefined) { break; }
        }
        return parentNode;
    }

    updateConfigs(filter: DltFilter) {
        // we do need to handle a few use-cases:
        // 1. adding a new filter
        // 2. editing a filter that has changed configs
        // 3. editing a filter that has now no configs any more

        const configContainsFilterDirectly = function (node: ConfigNode, filter: DltFilter) {
            // see whether "filterChild" contains the filter:
            if (node.children.length < 1) { return false; }
            const filterChild = node.children[0];
            if (filterChild instanceof ConfigNode) {
                for (let f = 0; f < filterChild.children.length; ++f) {
                    const filterNode = filterChild.children[f];
                    if (filterNode instanceof FilterNode) {
                        if (filterNode.filter === filter) { return true; }
                    }
                }
            }
            return false;
        };

        const confCopy = filter.configs;
        console.log(`updateConfigs for filter '${filter.name}' with configs='${confCopy.join(',')}'`);

        const shouldBeInConfigNodes: ConfigNode[] = [];

        for (let c = 0; c < confCopy.length; ++c) {
            const configNode = this.getConfigNode(confCopy[c], true); // allow create
            if (configNode !== undefined) {
                if (configNode instanceof ConfigNode) {
                    shouldBeInConfigNodes.push(configNode);
                    if (!configContainsFilterDirectly(configNode, filter)) {
                        console.log(`updateConfigs adding filter '${filter.name}' to '${configNode.label}'`);
                        if (configNode.tooltip) {
                            configNode.tooltip += `\n${filter.name}`;
                        } else {
                            configNode.tooltip = `filter:\n${filter.name}`;
                        }
                        // and add this filter as a child to the filters:
                        let filterNode = new FilterNode(configNode.uri, configNode.children[0], filter);
                        configNode.children[0].children.push(filterNode);
                    } else {
                        console.log(`filter already in configNode ${configNode.label}`);
                    }
                }
            }
        }
        // do we need to remove this filter from configs?
        // remove from all ConfigNodes not part of shouldBeInConfigNodes:
        const checkAndRemoveNode = function (node: ConfigNode, shouldBeInConfigNodes: readonly ConfigNode[]) {
            if (shouldBeInConfigNodes.includes(node)) {
                //assert(configContainsFilterDirectly(node, filter));
            } else {
                if (configContainsFilterDirectly(node, filter)) {
                    // remove
                    for (let i = 0; i < node.children[0].children.length; ++i) {
                        const filterNode = node.children[0].children[i];
                        if (filterNode instanceof FilterNode) {
                            if (filterNode.filter === filter) {
                                console.log(`removing FilterNode(id=${filterNode.id}, label=${filterNode.label}) with ${filterNode.children.length} children`);
                                node.children[0].children.splice(i, 1);
                                break; // we add filters only once
                            }
                        }
                    }
                    // we keep nodes with empty filters as well
                }
            }

            // now check for all children:
            node.children.forEach(c => {
                if (c instanceof ConfigNode) {
                    if (c.label.length > 0) {
                        checkAndRemoveNode(c, shouldBeInConfigNodes);
                    }
                }
            });
        };

        this.configTreeNode.children.forEach(node => {
            if (node instanceof ConfigNode) { checkAndRemoveNode(node, shouldBeInConfigNodes); }
        });

    }

    parseConfigs(configObjs: Object[] | undefined) {
        console.log(`parseConfigs: have ${configObjs?.length} configs to parse...`);
        if (configObjs) {
            for (let i = 0; i < configObjs.length; ++i) {
                try {
                    const conf: any = configObjs[i];
                    const configNode = this.getConfigNode(conf.name);
                    if (configNode !== undefined && configNode instanceof ConfigNode) {
                        configNode.autoEnableIf = conf.autoEnableIf;
                        if (configNode.tooltip) {
                            configNode.tooltip += `\nAutoEnableIf:${configNode.autoEnableIf}`;
                        } else {
                            configNode.tooltip = `AutoEnableIf:${configNode.autoEnableIf}`;
                        }
                    }
                } catch (error) {
                    console.warn(`dlt-logs.parseConfigs error:${error}`);
                }
            }
        }
    }

    autoEnableConfigs() {
        if (!this._didAutoEnableConfigs && this.lifecycles.size > 0) {
            let ecus: string[] = [];
            this.lifecycles.forEach((lci, ecu) => ecus.push(ecu));
            console.log(`autoEnableConfigs with ${ecus.length} ECUs: ${ecus.join(',')}`);

            // now iterate through all configs and autoEnable if it matches a regex:
            let enabled: number = 0;

            const checkNode = (node: TreeViewNode) => {
                if (node instanceof ConfigNode) {
                    let didEnable: boolean = false;
                    if (node.autoEnableIf !== undefined) {
                        try {
                            let regEx = new RegExp(node.autoEnableIf);
                            for (let e = 0; e < ecus.length; ++e) {
                                const ecu = ecus[e];
                                if (regEx.test(ecu)) {
                                    didEnable = true;
                                    enabled++;
                                    console.log(`autoEnableConfigs enabling ${node.label} due to ECU:${ecu} `);
                                    node.updateAllFilter('enable');
                                    break;
                                }
                            }
                        } catch (error) {
                            console.warn(`autoEnableConfigs got error:${error}`);
                        }
                    }
                    // if we didn't enable it we have to check the children:
                    // otherwise we dont have to as the 'enable' enabled the children already anyhow
                    if (!didEnable) {
                        node.children.forEach(n => checkNode(n));
                    }
                }
            };

            this.configTreeNode.children.forEach(node => {
                checkNode(node);
            });

            console.log(`autoEnableConfigs enabled ${enabled} configs.`);
            if (enabled > 0) {
                // we don't need this as applyFilter will be called anyhow (might better add a parameter) 
                // this.onFilterChange(undefined);
            }
            this._didAutoEnableConfigs = true;
        }
    }

    parseFilterConfigs(filterObjs: Object[] | undefined) {
        console.log(`parseFilterConfigs: have ${filterObjs?.length} filters to parse...`);
        if (filterObjs) {
            for (let i = 0; i < filterObjs.length; ++i) {
                try {
                    let filterConf = filterObjs[i];
                    let newFilter = new DltFilter(filterConf);
                    if (newFilter.configs.length > 0) {
                        this.updateConfigs(newFilter);
                    }
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
                                let treeNode = { id: createUniqueId(), label: `File transfers`, uri: this.uri, parent: this.pluginTreeNode, children: [], tooltip: undefined, iconPath: new vscode.ThemeIcon('files') };
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

    onFilterChange(filter: DltFilter | undefined) { // the filter might not be part of allFilters anylonger (e.g. after deleteFilter)
        console.log(`onFilterChange filter.name=${filter?.name}`);
        return vscode.window.withProgress({ cancellable: false, location: vscode.ProgressLocation.Notification, title: "applying filter..." },
            (progress) => this.applyFilter(progress));
    }

    onFilterAdd(filter: DltFilter, callonFilterChange: boolean = true) {
        this.filterTreeNode.children.push(new FilterNode(null, this.filterTreeNode, filter));
        if (filter.configs.length > 0) {
            this.updateConfigs(filter);
            this._treeEventEmitter.fire(this.configTreeNode);
        }

        this.allFilters.push(filter);
        if (!callonFilterChange) { return; }
        this._treeEventEmitter.fire(this.filterTreeNode);
        return this.onFilterChange(filter);
    }

    onFilterEdit(filter: DltFilter) {
        // update filterNode needs to be done by caller. a bit messy...

        // we dont know whether configs have changed so lets recheck/update:
        this.updateConfigs(filter);
        //dont call this or a strange warning occurs. not really clear why. this._treeEventEmitter.fire(this.configTreeNode);

        return this.onFilterChange(filter);
    }

    onFilterDelete(filter: DltFilter, callonFilterChange: boolean = true) {
        filter.enabled = false; // just in case

        // remove from list of allFilters and from filterTreeNode
        let found = false;
        for (let i = 0; i < this.allFilters.length; ++i) {
            if (this.allFilters[i] === filter) {
                this.allFilters.splice(i, 1);
                found = true;
                break;
            }
        }
        if (found) {
            found = false;
            for (let i = 0; i < this.filterTreeNode.children.length; ++i) {
                let node = this.filterTreeNode.children[i];
                if (node instanceof FilterNode && node.filter === filter) {
                    this.filterTreeNode.children.splice(i, 1);
                    found = true;
                    break;
                }
            }

        }
        if (!found) {
            vscode.window.showErrorMessage(`didn't found nodes to delete filter ${filter.name}`);
        }
        if (!callonFilterChange) { return; }
        this._treeEventEmitter.fire(this.filterTreeNode);
        return this.onFilterChange(filter);
    }

    /* todo clearFilter() {
        this.filteredMsgs = undefined;
        this._docEventEmitter.fire([{ type: vscode.FileChangeType.Changed, uri: this.uri }]); // todo needs renderLines first!
    } */

    static getFilter(allFilters: readonly DltFilter[], enabled: boolean, atLoadTime: boolean, negBeforePos: boolean = false) {
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

    /**
     * calculate and return the matching messages. Does not modify the current content/view.
     * @param filters list of filters to use. Should only be pos and neg filters. Others will be ignored.
     * @param maxMsgsToReturn maximum number of messages to return. As this is no async function the caller
     * needs to be careful!
     * @returns list of matching messages (as Promise)
     */
    static getMatchingMessages(allMsgs: DltMsg[], filters: DltFilter[], maxMsgsToReturn: number): DltMsg[] {
        const matchingMsgs: DltMsg[] = [];
        // sort the filters here into the enabled pos and neg:
        try {
            const [posFilters, negFilters, decFilters, eventFilters] = DltDocument.getFilter(filters, true, false);
            const nrMsgs = allMsgs.length;
            for (let i = 0; i < nrMsgs; ++i) {
                const msg = allMsgs[i];
                // todo refactor into standalone function
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
                    matchingMsgs.push(msg);
                    if (matchingMsgs.length >= maxMsgsToReturn) { break; }
                }
            }
        } catch (e) {
            throw new Error(`getMatchingMessages failed due to error '${e}'`);
        }
        return matchingMsgs;
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
                                } else {
                                    // decrease by one as lineCloseTo usually selects the next one (>=) if the end is not visible and we better make it one smaller than one too large
                                    if (endLine > startLine) { endLine--; }
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

    updateStatusBarItem(item: vscode.StatusBarItem) {
        item.text = this.filteredMsgs !== undefined ? `${this.filteredMsgs.length}/${this.msgs.length} msgs` : `${this.msgs.length} msgs`;
        let nrEnabledFilters: number = 0;
        this.allFilters.forEach(filter => {
            if (!filter.atLoadTime && filter.enabled && (filter.type === DltFilterType.POSITIVE || filter.type === DltFilterType.NEGATIVE)) { nrEnabledFilters++; }
        });
        const nrAllFilters = this.allFilters.length;
        item.tooltip = `DLT: ${this._fileUri.fsPath}, showing max ${this._maxNrMsgs} msgs, ${this._timeAdjustMs / 1000}s time-adjust, ${this.timeSyncs.length} time-sync events, ${nrEnabledFilters}/${nrAllFilters} enabled filters`;
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
                const startDate = logMsg.lifecycle ? logMsg.lifecycle.lifecycleStart.valueOf() : logMsg.timeAsNumber;
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
        return new Date(this._timeAdjustMs + msg.timeAsNumber + (msg.timeStamp / 10));
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
        if (position.character > 21) { return; } // we show hovers only at the begin of the line.
        const msg = this.msgByLine(position.line);
        if (!msg) {
            return;
        }
        const posTime = this.provideTimeByMsg(msg);
        if (posTime) {
            let mdString = new vscode.MarkdownString(`${posTime.toLocaleTimeString()}.${String(posTime.valueOf() % 1000).padStart(3, "0")} index#=${msg.index} timestamp=${msg.timeStamp} reception time=${msg.timeAsDate.toLocaleTimeString()} mtin=${msg.mtin}`, true);
            mdString.appendMarkdown(`\n\n---\n\n`);
            let apidDesc = '';
            let ctidDesc = '';
            if (msg.lifecycle !== undefined) {
                const apidInfos = msg.lifecycle.apidInfos.get(msg.apid); // todo might get this from all lifecycles...
                if (apidInfos !== undefined) {
                    apidDesc = `: ${apidInfos.desc.replace(/\|/g, '\\|')}`;
                    const ctidInfo = apidInfos.ctids.get(msg.ctid);
                    if (ctidInfo !== undefined) { ctidDesc = `: ${ctidInfo}`; }
                }
            }
            mdString.appendMarkdown(`| calculated time | ${posTime.toLocaleTimeString()}.${String(posTime.valueOf() % 1000).padStart(3, "0")}|\n |: ---|: ---|
            | lifecycle | ${ msg.lifecycle?.getTreeNodeLabel()}|
            | ecu session id | ${msg.ecu} ${msg.sessionId} |
            | timestamp | ${ msg.timeStamp / 10000} s |
            | reception time | ${ msg.timeAsDate.toLocaleTimeString()}.${String(Number(msg.timeAsNumber % 1000).toFixed(0)).padStart(3, '0')} |
            | apid | ${msg.apid}${apidDesc} |
            | ctid | ${msg.ctid}${ctidDesc} |
            | index# | ${ msg.index}|\n`);
            mdString.appendMarkdown(`\n\n-- -\n\n`);
            const args = [{ uri: this.uri }, { mstp: msg.mstp, ecu: msg.ecu, apid: msg.apid, ctid: msg.ctid, payload: msg.payloadString }];
            const addCommandUri = vscode.Uri.parse(`command:dlt-logs.addFilter?${encodeURIComponent(JSON.stringify(args))}`);

            mdString.appendMarkdown(`[$(filter) add filter...](${addCommandUri})`);
            mdString.isTrusted = true;
            return new vscode.Hover(mdString);
        } else {
            return new vscode.Hover({ language: "dlt-log", value: `calculated time: <none> index#=${msg.index} timestamp=${msg.timeStamp} reception time=${msg.timeAsDate.toLocaleTimeString()}` });
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
                if (showTime) { toRet += msg.timeAsDate.toLocaleTimeString() + ' '; } // todo pad to one len?
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

        this._text = Buffer.from(toRet).toString(); // to reduce number of strings/sliced strings
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

            const LOAD_TIME_ASSIST_TRIGGER_SIZE = 512 * 1024 * 1024; // 512mb todo config
            if (this._parsedFileLen === 0 && stats.size > LOAD_TIME_ASSIST_TRIGGER_SIZE) {
                await vscode.window.showWarningMessage(`The file is quite large (${Number(stats.size / 1000000).toFixed(0)}MB). Do you want to check load time filters?`,
                    { modal: true }, 'Check').then(async (value) => {
                        if (value === 'Check') {
                            await loadTimeFilterAssistant(this._fileUri, this.allFilters).then((removedApids) => {
                                console.log(`loadTimeFilterAssistant resolved ${removedApids}`);
                                if (Array.isArray(removedApids) && removedApids.length > 0) {
                                    // add the filterTreeNode for the newly added ones... ( a bit dirty... todo should move inside loadTimeFilterAssistant?)
                                    // for now we assume it's the last ones...
                                    for (let i = 0; i < removedApids.length; ++i) {
                                        this.filterTreeNode.children.push(new FilterNode(null, this.filterTreeNode, this.allFilters[this.allFilters.length - removedApids.length + i]));
                                    }
                                    this._treeEventEmitter.fire(this.filterTreeNode);
                                }
                            }).catch(err => {
                                console.log(`cancelled loadTimeFilterAssistant. todo cancel loading?`);
                            });
                        }
                    });
            }

            const fd = fs.openSync(this._fileUri.fsPath, "r");
            let read: number = 0;
            let chunkSize = 40 * 1024 * 1024; // todo config
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
                            const copiedBuf = Buffer.from(data.slice(0, read)); // have to create a copy of Buffer here!
                            // parse data:
                            const parseInfo = DltDocument.dltP.parseDltFromBuffer(copiedBuf, 0, this.msgs, posFilters, negFilters, negBeforePosFilters);
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
                                    progress.report({ message: `processed ${Number(100 * this._parsedFileLen / stats.size).toFixed(1)}%: ${Number(this._parsedFileLen / 1000000).toFixed(1)}/${Number(stats.size / 1000000).toFixed(1)}MB` });
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
            // determine SW names:
            let sw: string[] = [];
            lcInfo.forEach(lc => lc.swVersions.forEach(lsw => { if (!sw.includes(lsw)) { sw.push(lsw); } }));
            let ecuNode: TreeViewNode = { id: createUniqueId(), label: `ECU: ${ecu}, SW${sw.length > 1 ? `(${sw.length}):` : `:`} ${sw.join(' and ')}`, parent: this.lifecycleTreeNode, children: [], uri: this.uri, tooltip: undefined };
            this.lifecycleTreeNode.children.push(ecuNode);
            //console.log(`${ecuNode.label}`);
            // we do add one node with the APIDs/CTIDs:
            {
                // collect all APIDs for that ecu:
                let apidSet = new Map<string, { desc: string, ctids: Map<string, { desc: string }> }>();
                lcInfo.forEach((l => {
                    l.apidInfos.forEach((v, k) => {
                        let apidInfo = apidSet.get(k);
                        if (apidInfo === undefined) {
                            apidInfo = { desc: v.desc, ctids: new Map<string, { desc: string }>() };
                            // console.log(`updateLifecycleTreeNode apidSet.set(${k},${JSON.stringify(apidInfo)}) `);
                            apidSet.set(k, apidInfo);
                        } else {
                            if (apidInfo.desc.length === 0 && v.desc.length > 0) { apidInfo.desc = v.desc; }
                        }
                        v.ctids.forEach((desc, ctid) => {
                            let ctidInfo = apidInfo!.ctids.get(ctid);
                            if (ctidInfo === undefined) {
                                ctidInfo = { desc: desc };
                                apidInfo!.ctids.set(ctid, ctidInfo);
                            } else {
                                if (ctidInfo.desc.length === 0 && desc.length > 0) { ctidInfo.desc = desc; }
                            }
                        });
                    });
                }));

                const apidsNode: TreeViewNode = { iconPath: new vscode.ThemeIcon(`symbol-misc`), id: createUniqueId(), label: `APIDs (${apidSet.size}) / CTIDs`, uri: null, parent: ecuNode, children: [], tooltip: undefined };
                apidSet.forEach((info, key) => {
                    const apidNode: TreeViewNode = { id: createUniqueId(), label: `'${key}'(${info.ctids.size})${info.desc.length ? `: ${info.desc}` : ''}`, uri: null, parent: apidsNode, children: [], tooltip: `desc='${info.desc}', apid = 0x${Buffer.from(key).toString("hex")}` };
                    info.ctids.forEach((ctidInfo, ctid) => {
                        const ctidNode: TreeViewNode = { id: createUniqueId(), label: `'${ctid}'${ctidInfo.desc.length ? `: ${ctidInfo.desc} ` : ''}`, uri: null, parent: apidNode, children: [], tooltip: `desc='${ctidInfo.desc}', ctid = 0x${Buffer.from(ctid).toString("hex")}` };
                        apidNode.children.push(ctidNode);
                    });
                    apidNode.children.sort((a, b) => { return a.label.localeCompare(b.label); });
                    apidsNode.children.push(apidNode);
                });
                apidsNode.children.sort((a, b) => { return a.label.localeCompare(b.label); });
                ecuNode.children.push(apidsNode);
            }
            // add lifecycles
            for (let i = 0; i < lcInfo.length; ++i) {
                const lc = lcInfo[i];
                let lcNode: TreeViewNode = {
                    id: createUniqueId(),
                    label: lc.getTreeNodeLabel(),
                    tooltip: lc.tooltip,
                    parent: ecuNode, children: [], uri: this.uri.with({ fragment: lc.startIndex.toString() })
                };
                ecuNode.children.push(lcNode);
            }
        });
        this.autoEnableConfigs();
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

    /**
     * 
     * @param context ExtensionContext (needed for report generation -> access to settings,...)
     * @param cmd get|patch|delete
     * @param paths docs/<id>/filters[...]
     * @param options e.g. here we do allow the following commands:
     *  - enableAll|disableAll=pos|neg|view(pos&neg)|marker|all
     *  - patch={id:{..attributes to match the ones to patch...}, attributes: {...attrs to change with new value...}}
     *  - add={attributes:{... new attrs...}}
     *  - delete={id:...}
     *  - deleteAllWith={attributes: {... if all attrs match, the filter will be deleted...}}
     *  - query=[... array of filter attributes {} ] returns the msgs matching! Does not modify any filters.
     *  The commands are executed in sequence.
     * @param doc DltDocument identified by <id>
     * @param retObj output: key errors or data has to be filled
     */
    restQueryDocsFilters(context: vscode.ExtensionContext, cmd: string, paths: string[], options: string, retObj: { error?: object[], data?: object[] | object }) {
        if (paths.length === 3) { // .../filters

            let didModifyAnyFilter = false;

            const optionArr = options ? options.split('&') : []; // todo how to ensure that & is not part of it? need to percent encode.... need to uridecode/encode the options...
            for (const commandStr of optionArr) {
                const eqIdx = commandStr.indexOf('=');
                const command = commandStr.slice(0, eqIdx);
                const commandParams = commandStr.slice(eqIdx + 1);
                console.log(`restQueryDocsFilters: executing command = '${command}' with params='${commandParams}'`);

                switch (command) {
                    case 'enableAll':
                    case 'disableAll': {
                        const enable = command === 'enableAll';
                        let disablePos = false;
                        let disableNeg = false;
                        let disableMarker = false;

                        switch (commandParams) {
                            case 'pos': disablePos = true; break;
                            case 'neg': disableNeg = true; break;
                            case 'view': disablePos = true; disableNeg = true; break;
                            case 'marker': disableMarker = true; break;
                            case 'all': disablePos = true; disableNeg = true; disableMarker = true; break;
                            default:
                                console.warn(`restQueryDocsFilters ${command}=${commandParams} unknown!`);
                                break;
                        }

                        this.allFilters.forEach((filter) => {
                            if (!filter.atLoadTime) {
                                if (
                                    (filter.type === DltFilterType.POSITIVE && disablePos) ||
                                    (filter.type === DltFilterType.NEGATIVE && disableNeg) ||
                                    (filter.type === DltFilterType.MARKER && disableMarker)
                                ) {
                                    if (filter.enabled && !enable) {
                                        filter.enabled = false;
                                        didModifyAnyFilter = true;
                                    }
                                    if ((!filter.enabled) && enable) {
                                        filter.enabled = true;
                                        didModifyAnyFilter = true;
                                    }
                                }
                            }
                        });
                    }
                        break;
                    case 'report': {
                        try {
                            const reportFilters = JSON.parse(commandParams);
                            console.log(`report filters=`, reportFilters);
                            if (Array.isArray(reportFilters) && reportFilters.length > 0) {
                                const filters: DltFilter[] = [];
                                for (let i = 0; i < reportFilters.length; ++i) {
                                    const filterAttribs = reportFilters[i];
                                    const filter = new DltFilter(filterAttribs, false);
                                    filters.push(filter);
                                }
                                // now open the report:
                                if (filters.length > 0) {
                                    this.onOpenReport(context, filters[0], true);
                                    // add the others:
                                    for (let i = 1; i < filters.length; ++i) {
                                        this.onOpenReport(context, filters[i], false);
                                    }
                                } else {
                                    if (!Array.isArray(retObj.error)) { retObj.error = []; }
                                    retObj.error?.push({ title: `report failed as no filters defined` });
                                }
                            } else {
                                if (!Array.isArray(retObj.error)) { retObj.error = []; }
                                retObj.error?.push({ title: `report failed as commandParams wasn't an array` });
                            }
                        } catch (e) {
                            if (!Array.isArray(retObj.error)) { retObj.error = []; }
                            retObj.error?.push({ title: `report failed due to error e=${e}` });
                        }
                    }
                        break;
                    case 'query': {
                        try {
                            const queryFilters = JSON.parse(commandParams);
                            console.log(`filters=`, queryFilters);
                            if (Array.isArray(queryFilters) && queryFilters.length > 0) {
                                const filters: DltFilter[] = [];
                                for (let i = 0; i < queryFilters.length; ++i) {
                                    const filterAttribs = queryFilters[i];
                                    const filter = new DltFilter(filterAttribs, false);
                                    filters.push(filter);
                                }
                                // now get the matching message:
                                if (filters.length > 0) {
                                    const matches = DltDocument.getMatchingMessages(this.msgs, filters, 1000); // max 1000 messages for now
                                    retObj.data = util.createRestArray(matches, (obj: object, i: number) => { const msg = obj as DltMsg; return msg.asRestObject(i); });
                                } else {
                                    if (!Array.isArray(retObj.error)) { retObj.error = []; }
                                    retObj.error?.push({ title: `query failed as no filters defined` });
                                }
                            } else {
                                if (!Array.isArray(retObj.error)) { retObj.error = []; }
                                retObj.error?.push({ title: `query failed as commandParams wasn't an array` });
                            }
                        } catch (e) {
                            if (!Array.isArray(retObj.error)) { retObj.error = []; }
                            retObj.error?.push({ title: `query failed due to error e=${e}` });
                        }
                    }
                        break;
                    case 'add': { // todo add support for persistent storage!
                        try {
                            const filterAttribs = JSON.parse(commandParams);
                            console.log(`filterAttribs=`, filterAttribs);

                            const filter = new DltFilter(filterAttribs, false); // don't allow edit for now as we keep them temp.
                            this.onFilterAdd(filter, false);
                            didModifyAnyFilter = true;
                        } catch (e) {
                            // todo set error!
                            if (!Array.isArray(retObj.error)) { retObj.error = []; }
                            retObj.error?.push({ title: `add failed due to error e=${e}` });
                        }
                    }
                        break;
                    case 'delete': {
                        try {
                            const filterAttribs = JSON.parse(commandParams);
                            console.log(`filterAttribs=`, filterAttribs);

                            if (Object.keys(filterAttribs).length > 0) {
                                // all filters that match all criteria will be deleted:
                                const filtersToDelete: DltFilter[] = [];
                                this.allFilters.forEach((filter) => {

                                    let allMatch = true;
                                    const filterParams = filter.configOptions !== undefined ? filter.configOptions : filter;
                                    Object.keys(filterAttribs).forEach((key) => {
                                        // does the keys exist in filterParams?
                                        if (!(key in filterParams && filterParams[key] === filterAttribs[key])) {
                                            allMatch = false; // could break here... but not possible...
                                        }
                                    });
                                    if (allMatch) {
                                        console.log(`restQueryDocsFilters ${command}=${commandParams} delete filter ${filter.name}`);
                                        filtersToDelete.push(filter);
                                    }
                                });
                                filtersToDelete.forEach((filter) => {
                                    this.onFilterDelete(filter, false);
                                    didModifyAnyFilter = true;
                                });
                            } else {
                                if (!Array.isArray(retObj.error)) { retObj.error = []; }
                                retObj.error?.push({ title: `delete failed as no keys provided!` });
                            }
                        } catch (e) {
                            if (!Array.isArray(retObj.error)) { retObj.error = []; }
                            retObj.error?.push({ title: `add failed due to error e=${e}` });
                        }
                    }
                        break;
                    case 'patch': {
                        try {
                            const patchAttribs = JSON.parse(commandParams);
                            const filterAttribs = patchAttribs.id;
                            const newAttribs = patchAttribs.attributes;
                            console.log(`patch filterAttribs=`, filterAttribs);
                            console.log(`patch newAttribs=`, newAttribs);

                            if (Object.keys(filterAttribs).length > 0 && Object.keys(newAttribs).length > 0) {
                                // all filters that match all criteria will be deleted:
                                const filtersToDelete: DltFilter[] = [];
                                this.allFilters.forEach((filter) => {

                                    let allMatch = true;
                                    const filterParams = filter.configOptions !== undefined ? filter.configOptions : filter;
                                    Object.keys(filterAttribs).forEach((key) => {
                                        // does the keys exist in filterParams?
                                        if (!(key in filterParams && filterParams[key] === filterAttribs[key])) {
                                            allMatch = false; // could break here... but not possible...
                                        }
                                    });
                                    if (allMatch) {
                                        console.log(`restQueryDocsFilters ${command}=${commandParams} updating filter ${filter.name}`);
                                        Object.keys(newAttribs).forEach((key) => {
                                            console.log(`restQueryDocsFilters updating '${key}' from '${filter.configOptions[key]}' to '${newAttribs[key]}'`);
                                            filter.configOptions[key] = newAttribs[key];
                                        });
                                        filter.reInitFromConfiguration();
                                        didModifyAnyFilter = true;
                                    }
                                });
                            } else {
                                if (!Array.isArray(retObj.error)) { retObj.error = []; }
                                retObj.error?.push({ title: `patch failed as no keys provided!` });
                            }
                        } catch (e) {
                            if (!Array.isArray(retObj.error)) { retObj.error = []; }
                            retObj.error?.push({ title: `patch failed due to error e=${e}` });
                        }
                    }
                        break;
                    default:
                        console.warn(`restQueryDocsFilters: unknown command = '${command}' with params='${commandParams}'`);
                }
            }
            if (didModifyAnyFilter) {
                this._treeEventEmitter.fire(this.filterTreeNode);
                this.onFilterChange(undefined);
            }
            if (!('data' in retObj)) { // we add the filters only if no other data existing yet (e.g. from query)
                retObj.data = util.createRestArray(this.allFilters, (obj: object, i: number) => { const filter = obj as DltFilter; return filter.asRestObject(i); });
            }
        } else { // .../filters/...
            retObj.error = [{ title: `${cmd}/${paths[0]}/${paths[1]}/${paths[2]}/${paths[3]} not yet implemented.` }];
        }
    }

};