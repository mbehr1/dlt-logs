/* --------------------
 * Copyright(C) Matthias Behr. 2022
 */

/// todo: major issues before release:

/// not mandatory for first release:
/// [ ] opening of a stream (and support within reports)
/// [ ] filetransfer support (in adlt)
/// [ ] onDidChangeConfiguration
/// [ ] timeSync support
/// [ ] move decorations parsing/mgmt to extension
/// [ ] think about atLoadTime filters (use them as regular ones)

/// bugs:
/// [ ] adding a 2nd report into an existing one doesn't seem to work (see todo requery in openReport)
/// [ ] apidInfos based on msg collection missing (currently only on control LOG_INFO... msgs)

/// [x] sort order support
/// by default logs are sorted by timestamp. If the sort order is toggled the file is closed and reopened.
/// this can be weird/confusing with real streams.
/// and one side effect is that any lifecycle filters are automatically disabled (as the lc.ids are not persisted across close/open)

/// [x] opening of multiple dlt files (needs more testing. seems to work even with breadcrumb selection)

import * as vscode from 'vscode';
import TelemetryReporter from 'vscode-extension-telemetry';
import * as fs from 'fs';
import * as WebSocket from 'ws';
import * as util from './util';
import * as path from 'path';
import * as semver from 'semver';
import { spawn, ChildProcess } from 'child_process';

import { DltFilter, DltFilterType } from './dltFilter';
import { DltReport, NewMessageSink, ReportDocument } from './dltReport';
import { FilterableDltMsg, ViewableDltMsg, MSTP, MTIN_CTRL, MTIN_LOG, EAC, getEACFromIdx, getIdxFromEAC } from './dltParser';
import { DltLifecycleInfoMinIF } from './dltLifecycle';
import { TreeViewNode, FilterNode, LifecycleRootNode, LifecycleNode, FilterRootNode, DynFilterNode } from './dltTreeViewNodes';

import * as remote_types from './remote_types';
import { DltDocument, ColumnConfig } from './dltDocument';
import { v4 as uuidv4 } from 'uuid';
import { AdltPlugin } from './adltPlugin';

/// minimum adlt version required
/// we do show a text if the version is not met.
/// see https://www.npmjs.com/package/semver#prerelease-identifiers
const MIN_ADLT_VERSION_SEMVER_RANGE = ">=0.12.0";

function char4U32LeToString(char4le: number): string {
    let codes = [char4le & 0xff, 0xff & (char4le >> 8), 0xff & (char4le >> 16), 0xff & (char4le >> 24)];
    while (codes.length > 0 && codes[codes.length - 1] === 0) {
        codes.splice(-1);
    }
    return String.fromCharCode(...codes);
}

class AdltLifecycleInfo implements DltLifecycleInfoMinIF {
    ecu: string;
    id: number;
    nrMsgs: number;
    // has bigints that dont serialize well, binLc: remote_types.BinLifecycle;
    adjustTimeMs: number = 0;
    startTime: number; // in ms
    endTime: number; // in ms
    swVersion?: string;

    constructor(binLc: remote_types.BinLifecycle) {
        this.ecu = char4U32LeToString(binLc.ecu);
        this.id = binLc.id;
        this.nrMsgs = binLc.nr_msgs;
        this.startTime = Number(binLc.start_time / 1000n); // start time in ms
        this.endTime = Number(binLc.end_time / 1000n); // end time in ms
        this.swVersion = binLc.sw_version;
        //this.binLc = binLc;
    }

    get persistentId(): number {
        return this.id;
    }

    get lifecycleStart(): Date {
        return new Date(this.adjustTimeMs + this.startTime);
    }

    get lifecycleEnd(): Date {
        return new Date(this.adjustTimeMs + this.endTime);
    }

    getTreeNodeLabel(): string {
        return `${this.lifecycleStart.toLocaleString()}-${this.lifecycleEnd.toLocaleTimeString()} #${this.nrMsgs}`;
    }

    get tooltip(): string {
        return `SW:${this.swVersion ? this.swVersion : "unknown"}`;
    }

    get swVersions(): string[] {
        return this.swVersion ? [this.swVersion] : [];
    }

}

interface AdltMsg extends ViewableDltMsg {
}

interface StreamMsgData {
    msgs: AdltMsg[],
    sink: NewMessageSink
};

function decodeAdltUri(uri: vscode.Uri): string[] {
    let fileNames;
    if (uri.query.length > 0) {
        // multiple ones encoded in query:
        // first filename is the path, the others part of the query
        fileNames = [uri.with({ query: "" }).fsPath];
        const basePath = path.parse(fileNames[0]).dir;
        let jsonObj = JSON.parse(decodeURIComponent(uri.query));
        if (!('lf' in jsonObj)) {
            throw Error(`AdltDocument wrongly encoded uri ${uri.toString()}. Expecting query = lf:[]`);
        } else {
            if (!Array.isArray(jsonObj.lf)) {
                throw Error(`AdltDocument wrongly encoded uri ${uri.toString()}. Expecting query = lf as array`);
            } else {
                // console.warn(`adlt got encoded jsonObj=${JSON.stringify(jsonObj)}`);
                // we use the multiple files only if the first entry is same as path
                // this is to prevent vscode automatic changes of uris e.g. on breadcrumb selecction
                let allFileNames = jsonObj.lf.filter((f: any) => typeof f === 'string').map((f: string) => path.resolve(basePath, f));
                if (allFileNames.length > 1 && allFileNames[0] === fileNames[0]) {
                    fileNames = allFileNames;
                } else {
                    // this is not a bug:
                    console.log(`adlt got encoded allFiles not matching first file`, allFileNames, fileNames[0]);
                }
                console.log(`adlt got encoded fileNames=`, fileNames);
                if (!fileNames.length) {
                    throw Error(`AdltDocument wrongly encoded uri ${uri.toString()}. No filenames.`);
                }
                //this.realStat = fs.statSync(this.fileNames[0]); // todo summarize all stats
            }
        }
    } else {
        const fileUri = uri.with({ scheme: "file" });
        fileNames = [fileUri.fsPath];
    }
    return fileNames;
}

export class AdltDocument implements vscode.Disposable {
    private fileNames: string[]; // the real local file names
    private realStat: fs.Stats;
    private webSocket?: WebSocket;
    private webSocketIsConnected = false;
    private webSocketErrors: string[] = [];
    private adltVersion?: string; // the version from last wss upgrade handshake

    private streamId: number = 0; // 0 none, neg stop in progress. stream for the messages that reflect the main log/view
    private visibleMsgs?: AdltMsg[]; // the array with the msgs that should be shown. set on startStream and cleared on stopStream
    private _maxNrMsgs: number; //  setting 'dlt-logs.maxNumberLogs'. That many messages are displayed at once
    private _skipMsgs: number = 0; // that many messages are skipped from the top (here not loaded for cur streamId)

    private _sortOrderByTime = true; // we default to true // todo retrieve last from config?

    // decorations: (should always reflect what we want to show in all textEditors showing this doc)
    decorations = new Map<vscode.TextEditorDecorationType, vscode.DecorationOptions[]>();

    // config options for decorations
    private decWarning?: vscode.TextEditorDecorationType;
    private mdWarning = new vscode.MarkdownString("$(warning) LOG_WARN", true);
    private decError?: vscode.TextEditorDecorationType;
    private mdError = new vscode.MarkdownString("$(error) LOG_ERROR", true);
    private decFatal?: vscode.TextEditorDecorationType;
    private mdFatal = new vscode.MarkdownString("$(error) LOG_FATAL", true);
    private _decorationTypes = new Map<string, vscode.TextEditorDecorationType>(); // map with id and settings. init from config in parseDecorationsConfigs

    private editPending: boolean = false;
    private pendingTextUpdate: string = "";
    private timerId: NodeJS.Timeout;

    // textEditors showing this document. Is updated from AdltDocumentProvider
    textEditors: Array<vscode.TextEditor> = [];

    // reference to the vscode.TextDocument for this AdltDocument:
    public textDocument: vscode.TextDocument | undefined = undefined;

    // filter support:
    allFilters: DltFilter[] = [];

    // tree view support:
    treeNode: TreeViewNode;
    lifecycleTreeNode: LifecycleRootNode;
    filterTreeNode: FilterRootNode;
    //configTreeNode: TreeViewNode;
    pluginTreeNode: TreeViewNode;

    private _treeEventEmitter: vscode.EventEmitter<TreeViewNode | null>;

    // lifecycles:
    lifecycles = new Map<string, DltLifecycleInfoMinIF[]>();
    lifecyclesByPersistentId = new Map<number, DltLifecycleInfoMinIF>();

    // apid/ctid infos:
    // map for ecu -> map apid -> {apid, desc, ctids...}
    /**
     * map with apidInfos (apid, desc, ctids <ctid, desc>) by ecu name
     * ecu -> map apid -> {apid, desc, ctids -> desc}
     */
    ecuApidInfosMap: Map<string, Map<string, { apid: string, desc: string, ctids: Map<string, string> }>> = new Map();
    apidsNodes: Map<string, DynFilterNode> = new Map();

    // messages of current files:
    fileInfoNrMsgs = 0;

    // messages for streams:
    private streamMsgs = new Map<number, StreamMsgData | remote_types.BinDltMsg[][]>();

    // event for being loaded
    isLoaded: boolean = false;
    private _onDidLoad = new vscode.EventEmitter<boolean>();
    get onDidLoad() { return this._onDidLoad.event; }

    processBinDltMsgs(msgs: remote_types.BinDltMsg[], streamId: number, streamData: StreamMsgData) {
        for (let i = 0; i < msgs.length; ++i) {
            let binMsg = msgs[i];

            // cached ECU, APID, CTID:
            const eac = getEACFromIdx(getIdxFromEAC({ e: char4U32LeToString(binMsg.ecu), a: char4U32LeToString(binMsg.apid), c: char4U32LeToString(binMsg.ctid) }))!;

            let msg = {
                _eac: eac,
                index: binMsg.index,
                receptionTimeInMs: Number(binMsg.reception_time / 1000n),
                timeStamp: binMsg.timestamp_dms,
                get ecu(): string { return this._eac.e; },
                get apid(): string { return this._eac.a; },
                get ctid(): string { return this._eac.c; },
                lifecycle: this.lifecycleInfoForPersistentId(binMsg.lifecycle_id),
                htyp: binMsg.htyp,
                mcnt: binMsg.mcnt,
                mstp: (binMsg.verb_mstp_mtin >> 1) & 0x7,
                mtin: (binMsg.verb_mstp_mtin >> 4) & 0xf,
                verbose: (binMsg.verb_mstp_mtin & 0x01) === 0x01,
                payloadString: binMsg.payload_as_text,
            };
            streamData.msgs.push(msg);
        }
        if (msgs.length === 0) { // indicates end of query:
            if (streamData.sink.onDone) { streamData.sink.onDone(); }
            this.streamMsgs.delete(streamId);
            // console.log(`adlt.processBinDltMsgs deleted stream #${streamId}`);
        } else {
            if (streamData.sink.onNewMessages) { streamData.sink.onNewMessages(msgs.length); }
        }
    }

    constructor(adltPort: Promise<number>, public uri: vscode.Uri, private emitDocChanges: vscode.EventEmitter<vscode.FileChangeEvent[]>, treeEventEmitter: vscode.EventEmitter<TreeViewNode | null>,
        parentTreeNode: TreeViewNode[], private emitStatusChanges: vscode.EventEmitter<vscode.Uri | undefined>, private _columns: ColumnConfig[], reporter?: TelemetryReporter) {

        this._treeEventEmitter = treeEventEmitter;

        // support for multiple uris encoded...
        this.fileNames = decodeAdltUri(uri);
        if (!this.fileNames.length || !fs.existsSync(this.fileNames[0])) {
            throw Error(`AdltDocument file ${uri.toString()} doesn't exist!`);
        }
        this.realStat = fs.statSync(this.fileNames[0]); // todo summarize all stats

        // configuration:
        const maxNrMsgsConf = vscode.workspace.getConfiguration().get<number>('dlt-logs.maxNumberLogs');
        this._maxNrMsgs = maxNrMsgsConf ? maxNrMsgsConf : 400000; // 400k default
        //this._maxNrMsgs = 1000; // todo for testing only

        // update tree view:
        this.lifecycleTreeNode = new LifecycleRootNode(this);
        this.filterTreeNode = new FilterRootNode(this.uri);
        //this.configTreeNode = { id: util.createUniqueId(), label: "Configs", uri: this.uri, parent: null, children: [], tooltip: undefined, iconPath: new vscode.ThemeIcon('references') };
        this.pluginTreeNode = { id: util.createUniqueId(), label: "Plugins", uri: this.uri, parent: null, children: [], tooltip: undefined, iconPath: new vscode.ThemeIcon('package') };

        this.treeNode = {
            id: util.createUniqueId(),
            label: `${path.basename(this.fileNames[0]) + (this.fileNames.length > 1 ? `+${this.fileNames.length - 1}` : '')}`, uri: this.uri, parent: null, children: [
                this.lifecycleTreeNode,
                this.filterTreeNode,
                //      this.configTreeNode,
                this.pluginTreeNode,
            ],
            tooltip: undefined,
            iconPath: new vscode.ThemeIcon('file')
        };
        this.treeNode.children.forEach((child) => { child.parent = this.treeNode; });
        parentTreeNode.push(this.treeNode);

        this.onDidChangeConfigFilters(); // load filters

        { // load decorations: 
            const decorationsObjs = vscode.workspace.getConfiguration().get<Array<object>>("dlt-logs.decorations");
            this.parseDecorationsConfigs(decorationsObjs);
        }

        { // load plugins:
            const pluginObjs = vscode.workspace.getConfiguration().get<Array<object>>("dlt-logs.plugins");
            this.parsePluginConfigs(pluginObjs);
        }

        this.text = `Loading logs via adlt from ${this.fileNames.join(', ')} with max ${this._maxNrMsgs} msgs per page...`;

        // connect to adlt via websocket:
        adltPort.then((port) => {
            console.log(`adlt.Document.got port=${port}`);
            const url = `ws://localhost:${port}`;
            this.webSocket = new WebSocket(url, [], { perMessageDeflate: false, origin: "adlt-logs", maxPayload: 1_000_000_000 });
            //console.warn(`adlt.webSocket.binaryType=`, this.webSocket.binaryType);
            //this.webSocket.binaryType = "nodebuffer"; // or Arraybuffer?
            this.webSocket.binaryType = "arraybuffer"; // ArrayBuffer needed for sink?
            // console.warn(`adlt.webSocket.binaryType=`, this.webSocket.binaryType);
            this.webSocket.on("message", (data: ArrayBuffer, isBinary) => {
                try {
                    if (isBinary) {
                        //console.warn(`dlt-logs.AdltDocumentProvider.on(message)`, data.byteLength, isBinary);
                        try {
                            let bin_type = remote_types.readBinType(data);
                            // console.warn(`adlt.on(binary):`, bin_type.tag);
                            switch (bin_type.tag) {
                                case 'DltMsgs': { // raw messages
                                    let [streamId, msgs] = bin_type.value;
                                    //console.warn(`adlt.on(binary): DltMsgs stream=${streamId}, nr_msgs=${msgs.length}`);
                                    let streamData = this.streamMsgs.get(streamId);
                                    if (streamData && !Array.isArray(streamData)) {
                                        this.processBinDltMsgs(msgs, streamId, streamData);
                                    } else {
                                        // we store the pure data for later processing:
                                        // need to keep same chunk infos (e.g. msgs.length=0) -> array of array
                                        if (!streamData) {
                                            streamData = [msgs];
                                            this.streamMsgs.set(streamId, streamData);
                                        } else {
                                            streamData.push(msgs);
                                            if (streamData.length > 2) { console.warn(`adlt.on(binary): appended DltMsgs for yet unknown stream=${streamId}, nr_msgs=${msgs.length}, streamData.length=${streamData.length}`); }
                                            // todo this case should happen rarely. might indicate an error case where e.g.
                                            // we get data for a really unknown stream. stop e.g. after an upper bound
                                        }
                                    }
                                }
                                    break;
                                case 'Lifecycles': {
                                    let lifecycles: Array<remote_types.BinLifecycle> = bin_type.value;
                                    this.processLifecycleUpdates(lifecycles);
                                }
                                    break;
                                case 'FileInfo': {
                                    let fileInfo: remote_types.BinFileInfo = bin_type.value;
                                    this.processFileInfoUpdates(fileInfo);
                                }
                                    break;
                                default:
                                    console.warn(`adlt.on(binary): unhandled tag:'${JSON.stringify(bin_type)}'`);
                                    break;
                            }
                            //                        console.warn(`adlt.on(binary): value=${JSON.stringify(bin_type.value)}`);
                        } catch (e) {
                            console.warn(`adlt got err=${e}`);
                        }
                    } else { // !isBinary
                        const text = data.toString();
                        if (text.startsWith("stream:")) { // todo change to binary
                            let firstSpace = text.indexOf(" ");
                            const id = Number.parseInt(text.substring(7, firstSpace));
                            if (id === 0 /*this.streamId*/) {
                                this.addText(text.substring(firstSpace + 1) + '\n');

                            } else {
                                console.warn(`dlt-logs.AdltDocumentProvider.on(message) stream for unexpected id ${id} exp ${0 /*this.streamId*/}`);
                            }
                        } else if (text.startsWith("info:")) { // todo change to binary and add status bar
                            console.info(`dlt-logs.AdltDocumentProvider.on(message) info:`, text);
                        } else if (this._reqCallbacks.length > 0) { // response to a request:
                            console.info(`dlt-logs.AdltDocumentProvider.on(message) response for request:`, text);
                            let cb = this._reqCallbacks.shift();
                            if (cb) { cb(text); }

                        } else {
                            console.warn(`dlt-logs.AdltDocumentProvider.on(message) unknown text=`, text);
                        }
                    }
                } catch (e) {
                    console.warn(`dlt-logs.AdltDocumentProvider.on(message) catch error:`, e);
                }
            });
            this.webSocket.on('upgrade', (response) => {
                console.log(`dlt-logs.AdltDocumentProvider.on(upgrade) got response:`, response);
                let ah = response.headers['adlt-version'];
                this.adltVersion = ah && !Array.isArray(ah) ? ah : (ah && Array.isArray(ah) ? ah.join(',') : undefined);
                if (this.adltVersion) {
                    if (!semver.satisfies(this.adltVersion, MIN_ADLT_VERSION_SEMVER_RANGE)) {
                        vscode.window.showErrorMessage(`Your adlt version is not matching the required version!\nPlease correct!\nDetected version is '${this.adltVersion}' vs required '${MIN_ADLT_VERSION_SEMVER_RANGE}.'`, { modal: true });
                    }
                }
            });
            this.webSocket.on('open', () => {
                this.webSocketIsConnected = true;
                this.webSocketErrors = [];
                this.openAdltFiles();
            });

            this.webSocket.on('close', () => {
                this.webSocketIsConnected = false;
                this.webSocketErrors.push('wss closed');
                console.warn(`dlt-logs.AdltDocumentProvider.on(close) wss got close`);
                this.emitStatusChanges.fire(this.uri);
            });
            this.webSocket.on('error', (err) => {
                console.warn(`dlt-logs.AdltDocumentProvider.on(error) wss got error:`, err);
                this.webSocketErrors.push(`error: ${err}`);
                this.emitStatusChanges.fire(this.uri);
            });
        }).catch((reason) => {
            this.text = `Couldn't start adlt due to reason: '${reason}'!\n\n` + this.text;
            this.emitDocChanges.fire([{ type: vscode.FileChangeType.Changed, uri: this.uri }]);
        });
        this.timerId = setInterval(() => {
            this.checkTextUpdates(); // todo this might not be needed at all!
        }, 1000);

        // add a static report filter for testing:
        // this.onFilterAdd(new DltFilter({ type: DltFilterType.EVENT, payloadRegex: "(?<STATE_error>error)", name: "test report" }, false), false);
    }

    dispose() {
        console.log(`AdltDocument.dispose()`);
        clearInterval(this.timerId);
        this.closeAdltFiles().catch((reason) => {
            console.log(`AdltDocument.dispose closeAdltFiles failed with '${reason}'`);
        });
    }

    /**
     * read or reread config changes for filters
     * Will be called from constructor and on each config change for dlt-logs.filters
     */
    onDidChangeConfigFilters() {
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

    /**
     * Parse the configuration filter parameters and update the list of filters
     * (allFilters) and the filterTreeNode accordingly.
     *
     * Can be called multiple times.
     * Filters with same id will be updated.
     * Filters that are not inside the current list will be added.
     * Filters that are not contained anylonger will be removed.
     * "undefined" will be ignored. Pass an empty array to remove all.
     * Order changes are applied.
     *
     * @param filterObjs array of filter objects as received from the configuration
     */ // todo move to extension
    parseFilterConfigs(filterObjs: Object[] | undefined) {
        console.log(`AdltDocument.parseFilterConfigs: have ${filterObjs?.length} filters to parse. Currently have ${this.allFilters.length} filters...`);
        if (filterObjs) {

            let skipped = 0;
            for (let i = 0; i < filterObjs.length; ++i) {
                try {
                    let filterConf: any = filterObjs[i];
                    const targetIdx = i - skipped;

                    // is this one contained?
                    const containedIdx = this.allFilters.findIndex((filter) => filter.id === filterConf?.id);
                    if (containedIdx < 0) {
                        // not contained yet:
                        let newFilter = new DltFilter(filterConf);
                        if (newFilter.configs.length > 0) {
                            // todo adlt this.updateConfigs(newFilter);
                        }
                        // insert at targetIdx:
                        //this.filterTreeNode.children.push(new FilterNode(null, this.filterTreeNode, newFilter));
                        //                        this.allFilters.push(newFilter);
                        this.filterTreeNode.children.splice(targetIdx, 0, new FilterNode(null, this.filterTreeNode, newFilter));
                        this.allFilters.splice(i - skipped, 0, newFilter);
                        console.log(`AdltDocument.parseFilterConfigs adding filter: name='${newFilter.name}' type=${newFilter.type}, enabled=${newFilter.enabled}, atLoadTime=${newFilter.atLoadTime}`);
                    } else {
                        // its contained already. so lets first update the settings:
                        const existingFilter = this.allFilters[containedIdx];
                        if ('type' in filterConf && 'id' in filterConf) {
                            existingFilter.configOptions = JSON.parse(JSON.stringify(filterConf)); // create a new object
                            existingFilter.reInitFromConfiguration();
                        } else {
                            console.warn(`AdltDocument skipped update of existingFilter=${existingFilter.id} due to wrong config: '${JSON.stringify(filterConf)}'`);
                        }
                        // now check whether the order has changed:
                        if (targetIdx !== containedIdx) {
                            // order seems changed!
                            // duplicates will be detected here automatically! (and removed/skipped)
                            if (targetIdx > containedIdx) {
                                // duplicate! the same idx is already there. skip this one
                                console.warn(`AdltDocument.parseFilterConfigs: skipped filterConf.id='${filterConf.id}' as duplicate!`);
                                skipped++;
                            } else { // containedIdx > targetIdx
                                //console.warn(`parseFilterConfigs: detected order change for existingFilter.name='${existingFilter.name} from ${containedIdx} to ${targetIdx}'`);
                                // reorder:
                                const removed = this.allFilters.splice(containedIdx, 1);
                                this.allFilters.splice(targetIdx, 0, ...removed);
                                const removedNode = this.filterTreeNode.children.splice(containedIdx, 1);
                                this.filterTreeNode.children.splice(targetIdx, 0, ...removedNode);
                            }
                        }
                    }
                } catch (error) {
                    console.log(`AdltDocument.parseFilterConfigs error:${error}`);
                    skipped++;
                }
            }
            // lets remove the ones not inside filterConf:
            // that are regular DltFilter (so skip plugins...)
            // should be the ones with pos >= filterObj.length-skipped as we ensured sort order
            // already above
            // we might stop at first plugin as well.
            // currently we do e.g. delete the filters from loadTimeAssistant now as well.
            // (but it doesn't harm as load time filters are anyhow wrong in that case)
            // todo think about it
            for (let i = filterObjs.length - skipped; i < this.allFilters.length; ++i) {
                const existingFilter = this.allFilters[i];
                if (existingFilter.constructor === DltFilter) { // not instanceof as this covers inheritance
                    //console.log(`AdltDocument.parseFilterConfigs deleting existingFilter: name '${existingFilter.name}' ${existingFilter instanceof DltFileTransferPlugin} ${existingFilter instanceof DltFilter} ${existingFilter.constructor === DltFileTransferPlugin} ${existingFilter.constructor === DltFilter}`);
                    this.allFilters.splice(i, 1);
                    this.filterTreeNode.children.splice(i, 1);
                    i--;
                }
            }
        }
    }

    parsePluginConfigs(pluginObjs: Object[] | undefined) {
        console.log(`adlt.parsePluginConfigs: have ${pluginObjs?.length} plugins to parse...`);
        if (pluginObjs) {
            for (let i = 0; i < pluginObjs?.length; ++i) {
                try {
                    const pluginObj: any = pluginObjs[i];
                    const pluginName = pluginObj.name;
                    switch (pluginName) {
                        case 'FileTransfer':
                            {
                                const plugin = new AdltPlugin(`File transfers`, new vscode.ThemeIcon('files'), this.uri, this.pluginTreeNode, this._treeEventEmitter, pluginObj);
                                this.pluginTreeNode.children.push(plugin);
                                //this.allFilters.push(plugin);
                                //this.filterTreeNode.children.push(new FilterNode(null, this.filterTreeNode, plugin)); // add to filter as well
                            }
                            break;
                        case 'SomeIp':
                            {
                                const plugin = new AdltPlugin(`SOME/IP Decoder`, new vscode.ThemeIcon('group-by-ref-type'), this.uri, this.pluginTreeNode, this._treeEventEmitter, pluginObj);
                                this.pluginTreeNode.children.push(plugin);
                            }
                            break;
                        case 'NonVerbose':
                            {
                                const plugin = new AdltPlugin(`Non-Verbose`, new vscode.ThemeIcon('symbol-numeric'), this.uri, this.pluginTreeNode, this._treeEventEmitter, pluginObj);
                                this.pluginTreeNode.children.push(plugin);
                            }
                            break;
                        case 'Rewrite':
                            {
                                const plugin = new AdltPlugin(`'Rewrite' plugin`, new vscode.ThemeIcon('replace-all'), this.uri, this.pluginTreeNode, this._treeEventEmitter, pluginObj);
                                this.pluginTreeNode.children.push(plugin);
                            }
                            break;
                    }

                } catch (error) {
                    console.log(`dlt-logs.parsePluginConfigs error:${error}`);
                }
            }
        }

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
            // todo clear... this.decorations = undefined; // todo allDecorations?
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

    private _decorationsHoverTexts = new Map<string, vscode.MarkdownString>();
    getDecorationFor(filter: DltFilter): [vscode.TextEditorDecorationType, vscode.MarkdownString] | undefined {
        // for filter we use decorationId or filterColour:
        let filterName = `MARKER_${filter.id}`;

        let mdHoverText = this._decorationsHoverTexts.get(filterName);
        if (!mdHoverText) {
            mdHoverText = new vscode.MarkdownString(`MARKER ${filter.name}`);
            this._decorationsHoverTexts.set(filterName, mdHoverText);
        }

        if (filter.decorationId) { let dec = this._decorationTypes.get(filter.decorationId); if (!dec) { return undefined; } else { [dec, mdHoverText]; } };
        // now we assume at least a filterColour:
        const decFilterName = `filterColour_${filter.filterColour}`;
        let dec = this._decorationTypes.get(decFilterName);
        if (dec) { return [dec, mdHoverText]; }
        // create this decoration:
        dec = vscode.window.createTextEditorDecorationType({ borderColor: filter.filterColour, borderWidth: "1px", borderStyle: "dotted", overviewRulerColor: filter.filterColour, overviewRulerLane: 2, isWholeLine: true });
        this._decorationTypes.set(decFilterName, dec);
        return [dec, mdHoverText];
    }

    private _reqCallbacks: ((resp: string) => void)[] = []; // could change to a map. but for now we get responses in fifo order
    sendAndRecvAdltMsg(req: string): Promise<string> {
        const prom = new Promise<string>((resolve, reject) => {
            this._reqCallbacks.push(
                (response: string) => {
                    // if we get an error/n ok we do reject as well:
                    if (response.startsWith("ok:")) {
                        resolve(response);
                    } else {
                        console.warn(`adlt.sendAndRecvAdltMsg got nok ('${response}') for request '${req}'`);
                        reject(response);
                    }
                });
        });
        if (this.webSocket) {
        this.webSocket.send(req, (err) => {
            if (err) {
                console.warn(`dlt-logs.AdltDocumentProvider.sendAndRecvAdltMsg wss got error:`, err);
                this.webSocketErrors.push(`wss send failed with:${err}`);
                this.emitStatusChanges.fire(this.uri);
            }
        });
        } else {
            console.error(`dlt-logs.AdltDocumentProvider.sendAndRecvAdltMsg got no webSocket yet!`);
        }
        return prom;
    }


    addText(text: string) {
        // todo debounce
        // this.emitDocChanges.fire([{ type: vscode.FileChangeType.Changed, uri: this.uri }]);
        const editor = vscode.window.activeTextEditor;
        //console.warn(`dlt-logs.AdltDocumentProvider.addText() ...editPending=${this.editPending} editor?${editor !== undefined}`,);
        if (this.editPending || !editor) {
            this.pendingTextUpdate += text;
        } else {
            const lineCount = editor.document.lineCount;
            const nextEditText = this.pendingTextUpdate + text;
            this.pendingTextUpdate = "";
            this.editPending = true;
            editor.edit((editBuilder: vscode.TextEditorEdit) => {
                editBuilder.insert(new vscode.Position(lineCount, 0), nextEditText);
            }, { undoStopAfter: false, undoStopBefore: false }).then(() => {
                this.editPending = false;
                this.text += nextEditText;
                // console.warn(`dlt-logs.AdltDocumentProvider.on(message) stream edited ok`);
            }, () => {
                this.editPending = false;
                this.pendingTextUpdate = nextEditText + this.pendingTextUpdate;
                // trigger new... todo
                console.warn(`dlt-logs.AdltDocumentProvider.on(message) stream edited failed`);
            });
        }
    }

    checkTextUpdates() {
        const editor = vscode.window.activeTextEditor;
        if (editor && !this.editPending && this.pendingTextUpdate.length > 0) {
            const lineCount = editor.document.lineCount;
            const nextEditText = this.pendingTextUpdate;
            this.pendingTextUpdate = "";
            editor.edit((editBuilder: vscode.TextEditorEdit) => {
                editBuilder.insert(new vscode.Position(lineCount, 0), nextEditText);
            }, { undoStopAfter: false, undoStopBefore: false }).then(() => {
                this.editPending = false;
                this.text += nextEditText;
                //console.warn(`dlt-logs.AdltDocumentProvider.on(message) stream edited ok`);
            }, () => {
                this.editPending = false;
                this.pendingTextUpdate = nextEditText + this.pendingTextUpdate;
                // trigger new... todo
                console.warn(`dlt-logs.AdltDocumentProvider.on(message) stream edited failed`);
            });

        }
    }

    clearText() {
        const editor = vscode.window.activeTextEditor;
        if (this.editPending || !editor) {
            this.pendingTextUpdate = "";
            this.text = "";
            console.error(`adlt.clearText() unhandled case! (editPending=${this.editPending})`);
        } else {
            const lineCount = editor.document.lineCount;
            this.pendingTextUpdate = "";
            this.editPending = true;
            editor.edit((editBuilder: vscode.TextEditorEdit) => {
                editBuilder.delete(new vscode.Range(new vscode.Position(0, 0), new vscode.Position(lineCount, 0)));
            }, { undoStopAfter: false, undoStopBefore: false }).then(() => {
                this.editPending = false;
                this.text = "";
            }, () => {
                this.editPending = false;
                this.pendingTextUpdate = ""; // todo nextEditText + this.pendingTextUpdate;
                // trigger new... todo
                console.warn(`adlt.clearText() edited failed`);
            });
        }
    }

    requestLogInfosTimer?: NodeJS.Timer;
    openAdltFiles() {
        // plugin configs:
        const pluginCfgs = JSON.stringify(this.pluginTreeNode.children.map(tr => (tr as AdltPlugin).options));
        this.sendAndRecvAdltMsg(`open {"sort":${this._sortOrderByTime},"files":${JSON.stringify(this.fileNames)},"plugins":${pluginCfgs}}`).then((response) => {
            console.log(`adlt.on open got response:'${response}'`);
            // parse plugins_active from response:
            try {
                let json_resp = JSON.parse(response.slice(response.indexOf('{')));
                if ('plugins_active' in json_resp) {
                    console.log(`adlt.on open plugins_active:'${json_resp.plugins_active}'`);
                    // go through all plugin nodes and update the status:
                    this.pluginTreeNode.children.forEach((pluginNode) => {
                        let plugin = pluginNode as AdltPlugin;
                        plugin.setActive(json_resp.plugins_active.includes(plugin.options.name));
                    });
                }
            } catch (err) {
                console.error(`adlt.on open response could not be parsed as json due to:'${err}'`);
            }
            if (!this.isLoaded) {
                this.isLoaded = true;
                this._onDidLoad.fire(this.isLoaded);
            }
            this.startStream();
            if (this.requestLogInfosTimer) { clearTimeout(this.requestLogInfosTimer); }
            this.requestLogInfosTimer = setTimeout(() => this.requestLogInfos(), 1000);
        });
    }

    closeAdltFiles(): Promise<void> {
        let p = new Promise<void>((resolve, reject) => {
            this.sendAndRecvAdltMsg(`close`).then(() => {
                this.processFileInfoUpdates({ nr_msgs: 0 });
                this.processLifecycleUpdates([]); // to remove any filters from lifecycles as they become invalid
                resolve();
            }).catch((r) => reject(r));
        });
        return p;
    }

    /**
     * request all CTRL_MSGS respnse LOG_INFO to gather apid/ctids
     */
    requestLogInfos() {
        let filters: DltFilter[] = [new DltFilter({ type: DltFilterType.POSITIVE, mstp: MSTP.TYPE_CONTROL, mtin: MTIN_CTRL.CONTROL_RESPONSE, verb_mstp_mtin: (MSTP.TYPE_CONTROL << 1) | (MTIN_CTRL.CONTROL_RESPONSE << 4) })];
        // todo mtin, verb_mstp_mtin not supported yet... but adlt supports mstp and verb_mstp_mtin already and prefers this over mstp
        let filterStr = filters.filter(f => f.enabled).map(f => JSON.stringify(f.asConfiguration())).join(',');

        this.sendAndRecvAdltMsg(`stream {"window":[0,1000000], "binary":true, "filters":[${filterStr}]}`).then((response) => {
            console.log(`adlt.on requestLogInfos(filterStr=${filterStr}) got response:'${response}'`);
            const streamObj = JSON.parse(response.substring(11));
            //console.log(`adtl ok:stream`, JSON.stringify(streamObj));
            let streamMsgs: AdltMsg[] = [];

            // here some data might be already there for that stream.
            // this can happen even though the wss data arrives sequentially but the processing
            // here for wss data is a direct call vs. an asyn .then()...

            let curStreamMsgData = this.streamMsgs.get(streamObj.id);
            const msg_regex = /\[get_log_info .*?\] (.*)/;
            let streamData: StreamMsgData = {
                msgs: streamMsgs, sink: {
                    onNewMessages: (nrNewMsgs) => {
                        // process nrNewMsgs in streamMsgs
                        // and delete them then
                        console.log(`adlt.requestLogInfos onNewMessages(${nrNewMsgs}) streamMsgs.length=${streamMsgs.length}`);
                        let did_modify_apidInfos = false;
                        for (let msg of streamMsgs) {
                            let ecu = msg.ecu;
                            let apidInfos = this.ecuApidInfosMap.get(ecu);
                            if (apidInfos === undefined) {
                                apidInfos = new Map();
                                this.ecuApidInfosMap.set(ecu, apidInfos);
                            }
                            let matches = msg_regex.exec(msg.payloadString);
                            if (matches && matches.length === 2) {

                                let jsonApids = JSON.parse(matches[1]);
                                if (jsonApids && Array.isArray(jsonApids) && jsonApids.length > 0) {
                                    //console.warn(`adlt.requestLogInfos jsonApids=${JSON.stringify(jsonApids)}`);
                                    // check apids/ctids for that ecu
                                    for (let newApidInfo of jsonApids) {
                                        let apid = newApidInfo.apid as string;
                                        let existingInfo = apidInfos.get(apid);
                                        if (existingInfo === undefined) {
                                            let existingInfo = {
                                                apid: apid,
                                                desc: newApidInfo.desc || '',
                                                ctids: new Map<string, string>(newApidInfo.ctids.map((c: { ctid: string, desc: string }) => [c.ctid, c.desc])),
                                            };
                                            apidInfos.set(apid, existingInfo);
                                            did_modify_apidInfos = true;
                                        } else {
                                            // update
                                            if (existingInfo.desc.length === 0 && newApidInfo.desc?.length > 0) {
                                                existingInfo.desc = newApidInfo.desc;
                                                did_modify_apidInfos = true;
                                            }
                                            // now iterate ctids:
                                            for (let ctid of (newApidInfo.ctids as { ctid: string, desc: string }[])) {
                                                let existingCtid = existingInfo.ctids.get(ctid.ctid);
                                                if (existingCtid === undefined) {
                                                    existingInfo.ctids.set(ctid.ctid, ctid.desc);
                                                    did_modify_apidInfos = true;
                                                } else {
                                                    if (existingCtid.length === 0 && ctid.desc.length > 0) {
                                                        existingInfo.ctids.set(ctid.ctid, ctid.desc);
                                                        did_modify_apidInfos = true;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                        }
                        if (did_modify_apidInfos) {

                            // update apidsNodes...
                            for (let [ecu, ecuApidsNode] of this.apidsNodes) {
                                let apidInfo = this.ecuApidInfosMap.get(ecu);
                                if (apidInfo !== undefined) {
                                    ecuApidsNode.label = `APIDs (${apidInfo.size}) / CTIDs`;
                                    // update children:
                                    // for now simply delete the existing ones:
                                    ecuApidsNode.children.length = 0;
                                    // add new ones:
                                    for (let [apid, apidI] of apidInfo) {
                                        const apidNode = new DynFilterNode(`'${apid}'(${apidI.ctids.size})${apidI.desc ? `: ${apidI.desc}` : ''}`, `desc='${apidI.desc || ''}', apid = 0x${Buffer.from(apid).toString("hex")}`, ecuApidsNode, undefined, { ecu: ecu, apid: apid, ctid: null, payload: null, payloadRegex: null, not: null, mstp: null, logLevelMin: null, logLevelMax: null, lifecycles: null }, this);
                                        ecuApidsNode.children.push(apidNode);
                                        // add ctids:
                                        for (let [ctid, desc] of apidI.ctids) {
                                            const ctidNode = new DynFilterNode(`'${ctid}'${desc ? `: ${desc} ` : ''}`, `desc='${desc}', ctid = 0x${Buffer.from(ctid).toString("hex")}`, apidNode, undefined, { ecu: ecu, apid: apid, ctid: ctid, payload: null, payloadRegex: null, not: null, mstp: null, logLevelMin: null, logLevelMax: null, lifecycles: null }, this);
                                            apidNode.children.push(ctidNode);
                                        }
                                        apidNode.children.sort((a, b) => { return a.label.localeCompare(b.label); });
                                    }
                                    // sort children alpha
                                    ecuApidsNode.children.sort((a, b) => { return a.label.localeCompare(b.label); });
                                }
                            }

                            this._treeEventEmitter.fire(null);
                        }
                        streamMsgs.length = 0; // clear
                    }
                }
            };
            this.streamMsgs.set(streamObj.id, streamData);
            if (curStreamMsgData && Array.isArray(curStreamMsgData)) {
                // process the data now:
                curStreamMsgData.forEach((msgs) => this.processBinDltMsgs(msgs, streamObj.id, streamData));
            }
        });
    }


    stopStream() {
        if (this.streamId > 0) {
            // we do invalidate it already now:
            let oldStreamId = this.streamId;
            this.streamId = -this.streamId;
            this.visibleMsgs = undefined;
            return this.sendAndRecvAdltMsg(`stop ${oldStreamId}`).then((text) => {
                console.log(`adlt on stop resp: ${text}`);
                // todo verify streamId?
                this.streamId = 0;
            });
        }
        return Promise.reject("no active stream");
    }

    startStream() {
        // start stream:
        let filterStr = this.allFilters.filter(f => (f.type === DltFilterType.POSITIVE || f.type === DltFilterType.NEGATIVE) && f.enabled).map(f => JSON.stringify({ ...f.asConfiguration(), enabled: true })).join(','); // enabled is not updated/stored in config. so have to overwrite here
        let decFilters = this.allFilters.filter(f => f.type === DltFilterType.MARKER && f.enabled);
        this.sendAndRecvAdltMsg(`stream {"window":[${this._skipMsgs},${this._skipMsgs + this._maxNrMsgs}], "binary":true, "filters":[${filterStr}]}`).then((response) => {
            console.log(`adlt.on startStream got response:'${response}'`);
            const streamObj = JSON.parse(response.substring(11));
            console.log(`adtl ok:stream`, JSON.stringify(streamObj));
            this.streamId = streamObj.id;
            this.text = "";
            this.visibleMsgs = [];
            // empty all decorations
            this.clearDecorations();

            // a timer that updates the text if no messages arrive (e.g. empty filter result)
            let noMessagesTimer: NodeJS.Timeout | undefined = setTimeout(() => {
                if (this.text.length === 0) {
                    this.text = `<current filter (${this.allFilters.filter(f => (f.type === DltFilterType.POSITIVE || f.type === DltFilterType.NEGATIVE) && f.enabled).length}) lead to empty file>`;
                    this.emitDocChanges.fire([{ type: vscode.FileChangeType.Changed, uri: doc.uri }]);
                }
            }, 1000);

            let viewMsgs = this.visibleMsgs;
            let doc = this;
            let sink: NewMessageSink = {
                onDone() {
                    console.log(`adlt.startStream onDone() nyi!`);
                },
                onNewMessages(nrNewMsgs: number) {
                    // console.warn(`adlt.startStream onNewMessages(${nrNewMsgs}) viewMsgs.length=${viewMsgs.length}`);
                    // process the nrNewMsgs
                    // calc the new text
                    // append text and trigger file changes
                    if (noMessagesTimer) { clearTimeout(noMessagesTimer); noMessagesTimer = undefined; }

                    if (nrNewMsgs) { // todo depending on the amount of msgs add a progress!
                        let isFirst = nrNewMsgs === viewMsgs.length;
                        DltDocument.textLinesForMsgs(doc._columns, viewMsgs, viewMsgs.length - nrNewMsgs, viewMsgs.length - 1, 8 /*todo*/, undefined).then((newTxt: string) => {
                            if (isFirst) { doc.text = newTxt; } else { doc.text += newTxt; }
                            doc.emitDocChanges.fire([{ type: vscode.FileChangeType.Changed, uri: doc.uri }]);
                            console.log(`adlt.onNewMessages(${nrNewMsgs}, isFirst=${isFirst}) triggered doc changes.`);
                            // determine the new decorations:
                            for (let i = viewMsgs.length - nrNewMsgs; i < viewMsgs.length - 1; ++i) {
                                let msg = viewMsgs[i];
                                let decs: [vscode.TextEditorDecorationType, vscode.MarkdownString][] = [];

                                if (msg.mstp === MSTP.TYPE_LOG) {
                                    if (doc.decWarning && msg.mtin === MTIN_LOG.LOG_WARN) {
                                        decs.push([doc.decWarning, doc.mdWarning]);
                                    } else if (doc.decError && msg.mtin === MTIN_LOG.LOG_ERROR) {
                                        decs.push([doc.decError, doc.mdError]);
                                    } else if (doc.decFatal && msg.mtin === MTIN_LOG.LOG_ERROR) {
                                        decs.push([doc.decFatal, doc.mdFatal]);
                                    }
                                }
                                if (decFilters.length > 0) {
                                    for (let d = 0; d < decFilters.length; ++d) {
                                        let decFilter = decFilters[d];
                                        if (decFilter.matches(msg)) {
                                            const decType = doc.getDecorationFor(decFilter);
                                            if (decType) {
                                                decs.push([decType[0], decType[1]]);
                                                break;
                                            }
                                        }
                                    }
                                }

                                if (decs.length) {
                                    for (let dec of decs) {
                                        let options = doc.decorations.get(dec[0]);
                                        if (!options) {
                                            options = [];
                                            doc.decorations.set(dec[0], options);
                                        }
                                        options.push({ range: new vscode.Range(i, 0, i, 21), hoverMessage: dec[1] });
                                    }
                                }
                            }
                        });
                    }
                }
            };
            // here some data might be already there for that stream.
            // this can happen even though the wss data arrives sequentially but the processing
            // here for wss data is a direct call vs. an asyn .then()...
            let curStreamMsgData = this.streamMsgs.get(streamObj.id);
            let streamData = { msgs: viewMsgs, sink: sink };
            this.streamMsgs.set(streamObj.id, streamData);
            if (curStreamMsgData && Array.isArray(curStreamMsgData)) {
                // process the data now:
                curStreamMsgData.forEach((msgs) => this.processBinDltMsgs(msgs, streamObj.id, streamData));
            }
        });
    }

    clearDecorations() {
        this.textEditors.forEach((editor) => {
            this.decorations.forEach((value, key) => {
                value.length = 0; // seems a way to clear all elements
                // this is not needed as we modify the orig array. editor.setDecorations(key, value);
            });
        });
    }

    updateDecorations() {
        this.textEditors.forEach((editor) => {
            this.decorations.forEach((value, key) => {
                editor.setDecorations(key, value);
            });
        });
    }

    // window support:
    notifyVisibleRange(range: vscode.Range) {
        //console.warn(`adlt.notifyVisibleRange ${range.start.line}-${range.end.line} maxNrMsgs=${this._maxNrMsgs}`);

        // we do show max _maxNrMsgs from [_skipMsgs, _skipMsgs+_maxNrMsgs)
        // and trigger a reload if in the >4/5 or <1/5
        // and jump by 0.5 then

        const triggerAboveLine = range.start.line;
        const triggerBelowLine = range.end.line;

        if (triggerAboveLine <= (this._maxNrMsgs * 0.2)) {
            // can we scroll to the top?
            if (this._skipMsgs > 0) {
                console.log(` notifyVisibleRange(visible: [${triggerAboveLine}-${triggerBelowLine}]) current: [${this._skipMsgs}-${this._skipMsgs + this._maxNrMsgs}) triggerAbove`);

                if (this.textEditors && this.textEditors.length > 0) {
                    this.textEditors.forEach((editor) => {
                        const shiftByLines = +this._maxNrMsgs * 0.5;
                        // todo check for <0
                        let newRange = new vscode.Range(triggerAboveLine + shiftByLines, range.start.character,
                            triggerBelowLine + shiftByLines, range.end.character);
                        editor.revealRange(newRange, vscode.TextEditorRevealType.AtTop);
                    });
                }
                this._skipMsgs -= (this._maxNrMsgs * 0.5);
                if (this._skipMsgs < 0) { this._skipMsgs = 0; }
                this.stopStream();
                this.startStream();
            }
        }

        if (triggerBelowLine >= (this._maxNrMsgs * 0.8)) {
            // can we load more msgs?
            const msgs = this.visibleMsgs;
            if (msgs && this._maxNrMsgs === msgs.length) { // we assume more msgs are there (might be none) (todo test that case)
                console.log(` notifyVisibleRange(visible: [${triggerAboveLine}-${triggerBelowLine}]) current: [${this._skipMsgs}-${this._skipMsgs + this._maxNrMsgs}) triggerBelow`);
                if (this.textEditors.length > 0) {
                    this.textEditors.forEach((editor) => {
                        const shiftByLines = -this._maxNrMsgs * 0.5;
                        let newRange = new vscode.Range(triggerAboveLine + shiftByLines, range.start.character,
                            triggerBelowLine + shiftByLines, range.end.character);
                        editor.revealRange(newRange, vscode.TextEditorRevealType.AtTop);
                    });
                }
                this._skipMsgs += (this._maxNrMsgs * 0.5);
                this.stopStream();
                this.startStream(); // todo if (as usual) the windows overlap we could optimize and query only the new ones on top, splice the visibleMsgs...
            }
        }
    };


    // filter change support:

    onFilterAdd(filter: DltFilter, callTriggerApplyFilter: boolean = true): boolean {
        this.filterTreeNode.children.push(new FilterNode(null, this.filterTreeNode, filter));
        /*if (filter.configs.length > 0) {
            this.updateConfigs(filter);
            this._treeEventEmitter.fire(this.configTreeNode);
        }*/

        this.allFilters.push(filter);
        if (!callTriggerApplyFilter) { return true; }
        this._treeEventEmitter.fire(this.filterTreeNode);
        this.triggerApplyFilter();
        return true;
    }

    onFilterEdit(filter: DltFilter): boolean {
        // update filterNode needs to be done by caller. a bit messy...

        // we dont know whether configs have changed so lets recheck/update:
        // this.updateConfigs(filter);
        //dont call this or a strange warning occurs. not really clear why. this._treeEventEmitter.fire(this.configTreeNode);

        this.triggerApplyFilter();
        return true;
    }

    onFilterDelete(filter: DltFilter, callTriggerApplyFilter: boolean = true): boolean {
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
            return false;
        }
        if (!callTriggerApplyFilter) { return true; }
        this._treeEventEmitter.fire(this.filterTreeNode);
        this.triggerApplyFilter();
        return true;
    }

    private debouncedApplyFilterTimeout: NodeJS.Timeout | undefined;
    /**
     * Trigger applyFilter and show progress
     * This is debounced/delayed a bit (500ms) to avoid too frequent 
     * apply filter operation that is longlasting.
     */
    triggerApplyFilter() {
        console.log(`adlt.triggerApplyFilter() called for '${this.uri.toString()}'`);
        if (this.debouncedApplyFilterTimeout) { clearTimeout(this.debouncedApplyFilterTimeout); }
        this.debouncedApplyFilterTimeout = setTimeout(() => {
            console.log(`adlt.triggerApplyFilter after debounce for '${this.uri.toString()}'`);
            if (this._applyFilterRunning) {
                console.warn(`adlt.triggerApplyFilter currently running, Retriggering.`);
                this.triggerApplyFilter();
            } else {
                return vscode.window.withProgress({ cancellable: false, location: vscode.ProgressLocation.Notification, title: "applying filter..." },
                    (progress) => this.applyFilter(progress));
            }
        }, 500);
    }

    private _applyFilterRunning: boolean = false;
    async applyFilter(progress: vscode.Progress<{ increment?: number | undefined, message?: string | undefined, }> | undefined, applyEventFilter: boolean = false) {
        if (this._applyFilterRunning) {
            console.warn(`applyFilter called while running already. ignoring for now. todo!`); // do proper fix queuing this request or some promise magic.
            return;
        } else {
            console.info(`adlt.applyFilter called...`);
        }
        this._applyFilterRunning = true;
        // stop current stream:
        this.stopStream().then(() => {
            //this.clearText(); (done by startStream)
        }).catch(() => { }); // errors are ok
        // start new stream with current allFilters: (no need to chain it)
        this._skipMsgs = 0; // todo or determine the time to scroll to or scroll to top?
        this.startStream();
        this._applyFilterRunning = false;
    }

    async toggleSortOrder() {
        this._sortOrderByTime = !this._sortOrderByTime;
        console.log(`ADltDocument.toggleSortOrder() sortOrderByTime=${this._sortOrderByTime}`);
        this.stopStream();
        // a change of sort order needs a new file open!
        this.closeAdltFiles().then(() => this.openAdltFiles()).catch((reason) => {
            console.warn(`ADltDocument.toggleSortOrder() closeAdltFiles failed with '${reason}'`);
        });
    }

    private _reports: DltReport[] = [];

    onDidChangeSelectedTime(time: Date[] | Date | null) {
        this._reports.forEach(r => r.onDidChangeSelectedTime(time));
    }

    /**
     * handler called if the (lifecycle) treeview selection did change towards one of our items
     * Wont be called if the item is deselected or another docs item is selected!
     * @param event 
     */
    onTreeViewDidChangeSelection(event: vscode.TreeViewSelectionChangeEvent<TreeViewNode>) {
        if (event.selection.length && event.selection[0].uri && event.selection[0].uri.fragment.length) {
            console.log(`adlt.onTreeViewDidChangeSelection(${event.selection.length} ${event.selection[0].uri} fragment='${event.selection[0].uri ? event.selection[0].uri.fragment : ''}')`);
            const index = +(event.selection[0].uri.fragment);
            let willBeLine = this.lineCloseToDate(new Date(index)).then((line) => {
                try {
                    if (line >= 0 && this.textEditors) {
                        const posRange = new vscode.Range(line, 0, line, 0);
                        this.textEditors.forEach((value) => {
                            value.revealRange(posRange, vscode.TextEditorRevealType.AtTop);
                        });
                    }
                } catch (err) {
                    console.warn(`adlt.onTreeViewDidChangeSelection.then got err=${err}`);
                }
            });
        }
    }

    onOpenReport(context: vscode.ExtensionContext, filter: DltFilter | DltFilter[], newReport: boolean = false, reportToAdd: DltReport | undefined = undefined) {
        console.log(`onOpenReport called...`);

        if (!newReport && (this._reports.length > 0 || reportToAdd !== undefined)) {
            // we do add to the report that was last active or to the provided one
            let report = reportToAdd ? reportToAdd : this._reports[0];
            if (reportToAdd === undefined) {
                let lastChangeActive = report.lastChangeActive;
                for (let i = 1; i < this._reports.length; ++i) {
                    const r2 = this._reports[i];
                    if (lastChangeActive === undefined || (r2.lastChangeActive && (r2.lastChangeActive.valueOf() > lastChangeActive.valueOf()))) {
                        report = r2;
                        lastChangeActive = r2.lastChangeActive;
                    }
                }
            }
            report.addFilter(filter); // todo requery the msgs so that they include the new filter
            return report;
        } else {
            // shall we query first the messages fitting to the filters or shall we 
            // open the report first and add the messages then?
            let filters = Array.isArray(filter) ? filter : [filter];
            let filterStr = filters.filter(f => f.enabled).map(f => JSON.stringify(f.asConfiguration())).join(',');
            this.sendAndRecvAdltMsg(`stream {"window":[0,1000000], "binary":true, "filters":[${filterStr}]}`).then((response) => {
                console.log(`adlt.on startStream got response:'${response}'`);
                const streamObj = JSON.parse(response.substring(11));
                console.log(`adtl ok:stream`, JSON.stringify(streamObj));
                let streamMsgs: AdltMsg[] = [];
                let report = new DltReport(context, this, streamMsgs, (r: DltReport) => { // todo msgs
                    console.log(`onOpenReport onDispose called... #reports=${this._reports.length}`);
                    const idx = this._reports.indexOf(r);
                    if (idx >= 0) {
                        this._reports.splice(idx, 1);
                    }
                    this.sendAndRecvAdltMsg(`stop ${streamObj.id}`).then(() => { });
                    console.log(`onOpenReport onDispose done #reports=${this._reports.length}`);
                });

                // here some data might be already there for that stream.
                // this can happen even though the wss data arrives sequentially but the processing
                // here for wss data is a direct call vs. an asyn .then()...
                let curStreamMsgData = this.streamMsgs.get(streamObj.id);
                let streamData = { msgs: streamMsgs, sink: report };
                this.streamMsgs.set(streamObj.id, streamData);
                if (curStreamMsgData && Array.isArray(curStreamMsgData)) {
                    // process the data now:
                    curStreamMsgData.forEach((msgs) => this.processBinDltMsgs(msgs, streamObj.id, streamData));
                }

                this._reports.push(report); // todo implement Disposable for DltDocument as well so that closing a doc closes the report as well
                report.addFilter(filter);
                return report;

            });
        }
    }

    provideTimeByMsg(msg: FilterableDltMsg): Date | undefined {
        if ((msg.mstp === MSTP.TYPE_CONTROL && msg.mtin === MTIN_CTRL.CONTROL_REQUEST)) {
            return;
        }
        if (msg.lifecycle) {
            return new Date(msg.lifecycle.lifecycleStart.valueOf() + (msg.timeStamp / 10));
        }
        return new Date(/* todo this._timeAdjustMs + */ /* todo msg.receptionTimeInMs +*/(msg.timeStamp / 10));
    }
    async lineCloseToDate(date: Date): Promise<number> {
        // ideas:
        // we query adlt here for the line (could as well scan/binsearch the visibleMsgs and query adlt only if before first or last)
        // then if not in range (or too close to edge) -> requery
        // and return the new line
        if (this.streamId > 0) {
            return this.sendAndRecvAdltMsg(`stream_binary_search ${this.streamId} time_ms=${date.valueOf()}`).then((response) => {
                console.log(`adlt on seach_stream resp: ${response}`);
                const responseObj = JSON.parse(response.substring(response.indexOf('=') + 1));
                //console.warn(`adlt on seach_stream resp: ${JSON.stringify(responseObj)}`);
                let index = responseObj.filtered_msg_index;
                if (index !== undefined) {

                    if (index < this._skipMsgs || index >= this._skipMsgs + (this.visibleMsgs?.length || 0)) {
                        console.log(`adlt on seach_stream ${index} not in range: ${this._skipMsgs}..${this._skipMsgs + (this.visibleMsgs?.length || 0)}`);
                        // we want it so that the new line is skipMsgs..25%..line..75%.
                        let offset = Math.min(Math.round(this._maxNrMsgs * 0.25), index);
                        this._skipMsgs = index - offset;

                        this.stopStream();
                        this.startStream();
                        //console.log(`adlt on seach_stream ${index} -> ${offset}`);
                        return offset; // this is the new one
                    } else {
                        // visible (might still be in the upper or lower bound where a scroll will happen.... )
                        console.log(`adlt on seach_stream ${index} in range: ${this._skipMsgs}..${this._skipMsgs + (this.visibleMsgs?.length || 0)} -> ${index - this._skipMsgs}`);
                        return index - this._skipMsgs;
                    }
                } else {
                    return -1;
                }
            }).catch((reason) => {
                console.warn(`adlt on seach_stream resp err: ${reason}`);
                return -1;
            });
        }
        return -1;
    }

    msgByLine(line: number): AdltMsg | undefined {
        let msgs = this.visibleMsgs;
        if (msgs && line < msgs.length) {
            return msgs[line];
        }
        return undefined;
    }

    provideTimeByLine(line: number): Date | undefined {
        const msg = this.msgByLine(line);
        if (msg) {
            return this.provideTimeByMsg(msg);
        }
        return;
    }

    public provideHover(position: vscode.Position): vscode.ProviderResult<vscode.Hover> {
        if (position.character > 21) { return; } // we show hovers only at the begin of the line
        const msg = this.msgByLine(position.line);
        if (!msg) { return; }

        const receptionDate = new Date(msg.receptionTimeInMs);
        const posTime = this.provideTimeByMsg(msg) || receptionDate;
        let mdString = new vscode.MarkdownString(util.escapeMarkdown(`${posTime.toLocaleTimeString()}.${String(posTime.valueOf() % 1000).padStart(3, "0")} index#=${msg.index} timestamp=${msg.timeStamp} reception time=${receptionDate.toLocaleTimeString()} mtin=${msg.mtin}`), true);
        mdString.appendMarkdown(`\n\n---\n\n`);

        let apidDesc = '';
        let ctidDesc = '';
        const apidInfos = this.ecuApidInfosMap.get(msg.ecu)?.get(msg.apid);
        if (apidInfos !== undefined) {
            apidDesc = `: ${util.escapeMarkdown(apidInfos.desc)}`;
            const ctidInfo = apidInfos.ctids.get(msg.ctid);
            if (ctidInfo !== undefined) { ctidDesc = `: ${util.escapeMarkdown(ctidInfo)}`; }
        }
        mdString.appendMarkdown(`| calculated time | ${util.escapeMarkdown(posTime.toLocaleTimeString())}.${String(posTime.valueOf() % 1000).padStart(3, "0")}|\n| :--- | :--- |\n` +
            `| lifecycle | ${util.escapeMarkdown(msg.lifecycle?.getTreeNodeLabel())}|\n` +
            `| ecu session id | ${util.escapeMarkdown(msg.ecu)} nyi ${0/*msg.sessionId*/} |\n` +
            `| timestamp | ${msg.timeStamp / 10000} s |\n` +
            `| reception time | ${util.escapeMarkdown(receptionDate.toLocaleTimeString())}.${String(Number(msg.receptionTimeInMs % 1000).toFixed(0)).padStart(3, '0')} |\n` +
            `| apid | ${util.escapeMarkdown(msg.apid)}${apidDesc} |\n` +
            `| ctid | ${msg.ctid}${ctidDesc} |\n`);
        mdString.appendMarkdown(`\n\n-- -\n\n`);

        const args = [{ uri: this.uri }, { mstp: msg.mstp, ecu: msg.ecu, apid: msg.apid, ctid: msg.ctid, payload: msg.payloadString }];
        const addCommandUri = vscode.Uri.parse(`command:dlt-logs.addFilter?${encodeURIComponent(JSON.stringify(args))}`);

        mdString.appendMarkdown(`[$(filter) add filter...](${addCommandUri})`);
        mdString.isTrusted = true;

        return new vscode.Hover(mdString);
    }

    updateStatusBarItem(item: vscode.StatusBarItem) {
        if (this.webSocketIsConnected) {
            item.text = this.visibleMsgs !== undefined && this.visibleMsgs.length !== this.fileInfoNrMsgs ? `${this.visibleMsgs.length}/${this.fileInfoNrMsgs} msgs` : `${this.fileInfoNrMsgs} msgs`;
            let nrEnabledFilters: number = 0;
            this.allFilters.forEach(filter => {
                if (!filter.atLoadTime && filter.enabled && (filter.type === DltFilterType.POSITIVE || filter.type === DltFilterType.NEGATIVE)) { nrEnabledFilters++; }
            });
            const nrAllFilters = this.allFilters.length;
            // todo show wss connection status
            item.tooltip = `ADLT v${this.adltVersion || ":unknown!"}: ${this.fileNames.join(', ')}, showing max ${this._maxNrMsgs} msgs, ${0/*this._timeAdjustMs / 1000*/}s time-adjust, ${0 /* todo this.timeSyncs.length*/} time-sync events, ${nrEnabledFilters}/${nrAllFilters} enabled filters, sorted by ${this._sortOrderByTime ? 'time' : 'index'}`;
        } else {
            item.text = "$(alert) adlt not con!";
            item.tooltip = `ADLT: ${this.fileNames.join(', ')}, not connected to adlt via websocket!`;
        }
        if (this.webSocketErrors.length > 0) {
            item.text += ` $(alert) ${this.webSocketErrors.length} errors!`;
            item.tooltip += ` Errors:\n${this.webSocketErrors.join('\n')}`;
        }
    }


    processFileInfoUpdates(fileInfo: remote_types.BinFileInfo) {
        console.log(`adlt fileInfo: nr_msgs=${fileInfo.nr_msgs}`);
        this.fileInfoNrMsgs = fileInfo.nr_msgs;
        this.emitStatusChanges.fire(this.uri);
    }

    // process lifecycle updates from adlt:
    processLifecycleUpdates(lifecycles: Array<remote_types.BinLifecycle>) {
        // todo check for changes compared to last update
        // for now we check only whether some ecus or lifecycles are not needed anymore:

        this.lifecycleTreeNode.children = [];// .reset();

        // determine ECUs:
        let ecus: string[] = [];
        lifecycles.forEach(lc => {
            let ecuStr = char4U32LeToString(lc.ecu);
            if (!ecus.includes(ecuStr)) { ecus.push(ecuStr); }
            if (!this.lifecycles.has(ecuStr)) { this.lifecycles.set(ecuStr, []); }
        });
        // remove the ones that dont exist any more
        let ecusRemoved: string[] = [];
        this.lifecycles.forEach((lcInfo, ecu) => {
            if (!ecus.includes(ecu)) { ecusRemoved.push(ecu); }
        });

        let usedLcIds: number[] = [];

        ecus.forEach(ecu => {
            let ecuNode: TreeViewNode = { id: util.createUniqueId(), label: `ECU: ${ecu}`, parent: this.lifecycleTreeNode, children: [], uri: this.uri, tooltip: undefined };
            this.lifecycleTreeNode.children.push(ecuNode);

            // get and or insert apidNode:
            let apidNode = this.apidsNodes.get(ecu);
            if (apidNode === undefined) {
                apidNode = new DynFilterNode(`APIDs (unknown) / CTIDs`, undefined, ecuNode, `symbol-misc`, { ecu: ecu, apid: null, ctid: null, payload: null, payloadRegex: null, not: null, mstp: null, logLevelMin: null, logLevelMax: null, lifecycles: null }, this);
                this.apidsNodes.set(ecu, apidNode);
            }
            ecuNode.children.push(apidNode);

            let sw: string[] = [];
            // add lifecycles for this ECU:
            lifecycles.filter(l => char4U32LeToString(l.ecu) === ecu).forEach((lc, i) => {
                let persistentId = lc.id;
                usedLcIds.push(lc.id);
                let lcInfo = this.lifecyclesByPersistentId.get(persistentId);
                let lcInfos = this.lifecycles.get(ecu);
                if (lcInfo === undefined) {
                    lcInfo = new AdltLifecycleInfo(lc);
                    this.lifecyclesByPersistentId.set(persistentId, lcInfo);
                    lcInfos?.push(lcInfo);
                }// todo else update?

                let lcNode: TreeViewNode = { id: util.createUniqueId(), label: `LC:#${lc.id} #${lc.nr_msgs} `, parent: ecuNode, children: [], uri: this.uri, tooltip: undefined };
                ecuNode.children.push(new LifecycleNode(this.uri.with({ fragment: Number(lc.start_time / 1000n).toString() }), ecuNode, this.lifecycleTreeNode, lcInfo, i + 1));
                if (lc.sw_version && !sw.includes(lc.sw_version)) { sw.push(lc.sw_version); }
            });
            ecuNode.label = `ECU: ${ecu}, SW${sw.length > 1 ? `(${sw.length}): ` : `: `} ${sw.join(' and ')}`;
        });
        this._treeEventEmitter.fire(this.lifecycleTreeNode);

        // remove the lifecycles that are not needed anymore:
        let lcIdsRemoved: number[] = [];
        this.lifecyclesByPersistentId.forEach((lcInfo, id) => { if (!usedLcIds.includes(id)) { lcIdsRemoved.push(id); } });
        lcIdsRemoved.forEach((lcId) => {
            let lcInfo = this.lifecyclesByPersistentId.get(lcId);
            if (lcInfo) {
                // if there is a filter active deactivate/remove it:
                // node.applyCommand("disable")
                if (this.lifecycleTreeNode.hasLcFiltered(lcInfo)) {
                    //console.warn(`Adlt.processLifecycleUpdates disabling lc filter`, lcInfo);
                    this.lifecycleTreeNode.filterLc(lcInfo, false);
                }

                let lcs = this.lifecycles.get(lcInfo.ecu);
                if (lcs) {
                    let idx = lcs.findIndex(l => l === lcInfo);
                    if (idx >= 0) {
                        lcs.splice(idx, 1);
                    }
                }
                this.lifecyclesByPersistentId.delete(lcId);
            }
        });

        // remove the ecus that are not needed anymore: (all lcInfo should be empty now)
        ecusRemoved.forEach((ecu) => {
            let lcInfos = this.lifecycles.get(ecu);
            if (lcInfos) {
                if (lcInfos.length > 0) {
                    console.error(`Adlt.processLifecycleUpdates logical error! lcInfos >0!`);
                }
                this.lifecycles.delete(ecu);
            }
        });

    }

    lifecycleInfoForPersistentId(persistentId: number): DltLifecycleInfoMinIF | undefined {
        return this.lifecyclesByPersistentId.get(persistentId);
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
    async restQueryDocsFilters(context: vscode.ExtensionContext, cmd: string, paths: string[], options: string, retObj: { error?: object[], data?: object[] | object }) {
        if (paths.length === 3) { // .../filters

            let didModifyAnyFilter = false;

            const optionArr = options ? options.split('&') : [];
            for (const commandStr of optionArr) {
                const eqIdx = commandStr.indexOf('=');
                const command = commandStr.slice(0, eqIdx);
                const commandParams = decodeURIComponent(commandStr.slice(eqIdx + 1));
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
                                    const newReport = this.onOpenReport(context, filters, true);
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
                                let addLifecycles = false;
                                let maxNrMsgs = 1000; // default to 1000 msgs to report as result
                                const filters: DltFilter[] = [];
                                for (let i = 0; i < queryFilters.length; ++i) {
                                    const filterAttribs = queryFilters[i];
                                    if ('maxNrMsgs' in filterAttribs) {
                                        const fMaxNrMsgs = filterAttribs['maxNrMsgs'];
                                        if (fMaxNrMsgs === 0) { maxNrMsgs = this.fileInfoNrMsgs; } else
                                            if (fMaxNrMsgs > maxNrMsgs) { maxNrMsgs = fMaxNrMsgs; }
                                        delete filterAttribs['maxNrMsgs'];
                                    }
                                    if ('addLifecycles' in filterAttribs) { addLifecycles = true; }
                                    const filter = new DltFilter(filterAttribs, false);
                                    filters.push(filter);
                                }
                                // now get the matching message:
                                if (filters.length > 0) {
                                    const matches = await this.getMatchingMessages(filters, maxNrMsgs);
                                    console.log(`adlt.restQueryDocsFilters got matches.length=${matches.length}`);
                                    //const matches: util.RestObject[] = [];
                                    retObj.data = util.createRestArray(matches, (obj: object, i: number) => { return obj as util.RestObject; });// todo const msg = obj as DltMsg; return msg.asRestObject(i); });
                                    if (addLifecycles) {
                                        // add lifecycle infos to the result:
                                        this.lifecycles.forEach((lcInfo, ecu) => {
                                            const lifecycles = [...lcInfo.map((lc, idx) => {
                                                return {
                                                    type: "lifecycles", id: lc.persistentId,
                                                    attributes: {
                                                        index: idx + 1,
                                                        id: lc.persistentId, // todo to ease parsing with jsonPath...
                                                        ecu: ecu, // todo or without <SH>_ ?
                                                        label: lc.getTreeNodeLabel(),
                                                        startTimeUtc: lc.lifecycleStart.toUTCString(),
                                                        endTimeUtc: lc.lifecycleEnd.toUTCString(),
                                                        sws: lc.swVersions,
                                                        msgs: lc.nrMsgs,
                                                    }
                                                };
                                            })];
                                            if (Array.isArray(retObj.data)) { retObj.data.unshift(...lifecycles); }
                                        });
                                    }
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
                this.triggerApplyFilter();
            }
            if (!('data' in retObj)) { // we add the filters only if no other data existing yet (e.g. from query)
                retObj.data = util.createRestArray(this.allFilters, (obj: object, i: number) => { const filter = obj as DltFilter; return filter.asRestObject(i); });
            }
        } else { // .../filters/...
            retObj.error = [{ title: `${cmd}/${paths[0]}/${paths[1]}/${paths[2]}/${paths[3]} not yet implemented.` }];
        }
    }
    /**
         * calculate and return the matching messages. Does not modify the current content/view.
         * @param filters list of filters to use. Should only be pos and neg filters. Others will be ignored.
         * @param maxMsgsToReturn maximum number of messages to return. As this is no async function the caller
         * needs to be careful!
         * @returns list of matching messages (as Promise)
         */
    getMatchingMessages(filters: DltFilter[], maxMsgsToReturn: number): Promise<FilterableDltMsg[]> {
        let p = new Promise<FilterableDltMsg[]>((resolve, reject) => {

            const matchingMsgs: AdltMsg[] = [];
            // sort the filters here into the enabled pos and neg:
            try {
                let filterStr = filters.filter(f => f.enabled).map(f => JSON.stringify(f.asConfiguration())).join(',');
                this.sendAndRecvAdltMsg(`query {"window":[0,${maxMsgsToReturn}], "filters":[${filterStr}]}`).then((response) => {
                    console.log(`adlt.getMatchingMessages startQuery got response:'${response}'`);
                    const streamObj = JSON.parse(response.substring(10));
                    console.log(`adtl.getMatchingMessages streamObj`, JSON.stringify(streamObj));

                    let sink: NewMessageSink = {
                        onDone() {
                            console.log(`adlt.getMatchingMessages done matchingMsgs.length=${matchingMsgs.length}`);
                            resolve(matchingMsgs);
                        }
                    };
                    // here some data might be already there for that stream.
                    // this can happen even though the wss data arrives sequentially but the processing
                    // here for wss data is a direct call vs. an asyn .then()...
                    let curStreamMsgData = this.streamMsgs.get(streamObj.id);
                    let streamData = { msgs: matchingMsgs, sink: sink };
                    this.streamMsgs.set(streamObj.id, streamData);
                    if (curStreamMsgData && Array.isArray(curStreamMsgData)) {
                        // process the data now:
                        curStreamMsgData.forEach((msgs) => this.processBinDltMsgs(msgs, streamObj.id, streamData));
                    }

                }).catch((reason) => {
                    reject(reason);
                });
            } catch (e) {
                throw new Error(`getMatchingMessages failed due to error '${e}'`);
                reject(e);
            }
        });
        return p;
    }



    stat(): vscode.FileStat {
        //console.warn(`dlt-logs.AdltDocumentProvider.stat()...`);

        return {
            size: this.text.length,
            ctime: this.realStat.ctime.valueOf(),
            mtime: this.realStat.mtime.valueOf(),
            type: vscode.FileType.File
        };
    }

    public text: String;

}

export class ADltDocumentProvider implements vscode.FileSystemProvider,
    /*vscode.DocumentSymbolProvider,*/ vscode.Disposable {
    public _documents = new Map<string, AdltDocument>();
    private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    private _subscriptions: Array<vscode.Disposable> = new Array<vscode.Disposable>();
    private _adltPort: number = 0;
    private _adltProcess?: ChildProcess;
    private _adltCommand: string;

    constructor(context: vscode.ExtensionContext, private _dltLifecycleTreeView: vscode.TreeView<TreeViewNode>, private _treeRootNodes: TreeViewNode[], private _onDidChangeTreeData: vscode.EventEmitter<TreeViewNode | null>,
        private checkActiveRestQueryDocChanged: () => boolean, private _onDidChangeStatus: vscode.EventEmitter<vscode.Uri | undefined>, private _columns: ColumnConfig[], private _reporter?: TelemetryReporter) {
        console.log(`dlt-logs.AdltDocumentProvider()...`);
        if (!semver.validRange(MIN_ADLT_VERSION_SEMVER_RANGE)) {
            throw Error(`MIN_ADLT_VERSION_SEMVER_RANGE is not valied!`);
        }

        this._adltCommand = vscode.workspace.getConfiguration().get<string>("dlt-logs.adltPath") || "adlt";

        // config changes
        context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('dlt-logs')) {

                // handle it for the next doc to be opened. Active connection will be interrupted (if non debug port)
                if (e.affectsConfiguration("dlt-logs.adltPath")) {
                    const newCmd = vscode.workspace.getConfiguration().get<string>("dlt-logs.adltPath") || "adlt";
                    if (newCmd !== this._adltCommand) {
                        this._adltCommand = newCmd;
                        this.closeAdltProcess();
                    }
                }

                // todo move to ext? this._documents.forEach(doc => doc.onDidChangeConfiguration(e));
            }
        }));


        this._subscriptions.push(vscode.workspace.onDidOpenTextDocument((event: vscode.TextDocument) => {
            const uriStr = event.uri.toString();
            //console.log(`AdltDocumentProvider onDidOpenTextDocument uri=${uriStr}`);
            // is it one of our documents?
            const doc = this._documents.get(uriStr);
            if (doc) {
                const newlyOpened: boolean = (doc.textDocument) ? false : true;
                console.log(` Adlt.onDidOpenTextDocument: found document with uri=${uriStr} newlyOpened=${newlyOpened}`);
                if (newlyOpened) {
                    doc.textDocument = event;
                    this._onDidChangeTreeData.fire(null);
                }
            }
        }));

        // announce time updates on selection of lines:
        // counterpart to handleDidChangeSelectedTime... 
        this._subscriptions.push(vscode.window.onDidChangeTextEditorSelection(util.throttle((ev) => {
            let data = this._documents.get(ev.textEditor.document.uri.toString());
            if (data) {
                // ev.kind: 1: Keyboard, 2: Mouse, 3: Command
                // we do only take single selections.
                if (ev.selections.length === 1) {
                    if (ev.selections[0].isSingleLine) {
                        const line = ev.selections[0].active.line; // 0-based
                        // determine time:
                        const time = data.provideTimeByLine(line);
                        if (time) {
                            /*if (this._autoTimeSync) {
                                // post time update...
                                console.log(` dlt-log posting time update ${time.toLocaleTimeString()}.${String(time.valueOf() % 1000).padStart(3, "0")}`);
                                this._onDidChangeSelectedTime.fire({ time: time, uri: data.uri });
                            } todo */
                            // notify document itself (to e.g. forward to open reports)
                            data.onDidChangeSelectedTime(time);
                        }
                    }
                } else if (ev.selections.length > 1) {
                    // console.warn(`DltDocumentProvider.onDidChangeTextEditorSelection have ${ev.selections.length} selections`);
                    // we add all selections:
                    const times = [];
                    for (let i = 0; i < ev.selections.length; ++i) {
                        const selection = ev.selections[i];
                        if (selection.isSingleLine) {
                            const line = selection.active.line;
                            const time = data.provideTimeByLine(line);
                            if (time) { times.push(time); }
                        }
                    }
                    if (times.length > 0) { // notify document itself (to e.g. forward to open reports)
                        data.onDidChangeSelectedTime(times);
                    }
                }
            }
        }, 500)));

        context.subscriptions.push(vscode.languages.registerHoverProvider({ scheme: "adlt-log" }, this));
    }

    dispose() {
        console.log("AdltDocumentProvider dispose() called");
        this._documents.forEach((doc) => doc.dispose());
        this._documents.clear();

        this.closeAdltProcess();

        this._subscriptions.forEach((value) => {
            if (value !== undefined) {
                value.dispose();
            }
        });
    }

    public provideHover(doc: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.Hover> {
        const data = this._documents.get(doc.uri.toString());
        if (!data) {
            return;
        }
        return data.provideHover(position);
    }

    private async modifyNode(node: TreeViewNode, command: string) {
        const treeviewNode = node;
        const parentUri = treeviewNode.parent?.uri; // why from parent?
        if (parentUri) {
            const doc = this._documents.get(parentUri.toString());
            if (doc) {
                console.log(`${command} Filter(${treeviewNode.label}) called for adlt doc=${parentUri}`);
                let doApplyFilter = false;
                if (node.applyCommand) {
                    node.applyCommand(command);
                    doApplyFilter = true;
                }
                if (doApplyFilter) {
                    doc.triggerApplyFilter();
                    this._onDidChangeTreeData.fire(doc.treeNode); // as filters in config might be impacted as well! 
                }
            }
        }
    };

    public onTreeNodeCommand(command: string, node: TreeViewNode) {
        switch (command) {
            case 'enableFilter': this.modifyNode(node, 'enable'); break;
            case 'disableFilter': this.modifyNode(node, 'disable'); break;
            case 'zoomOut': this.modifyNode(node, 'zoomOut'); break;
            case 'zoomIn': this.modifyNode(node, 'zoomIn'); break;
            default:
                console.error(`adlt.onTreeNodeCommand unknown command '${command}'`); break;
        }
    }

    public onDidClose(doc: ReportDocument) { // doc has been removed already from this._documents!
        if (this._documents.size === 0) {
            this.closeAdltProcess();
        }
    }

    closeAdltProcess() {
        console.log(`adlt.closeAdltProcess()...`);
        if (this._adltProcess) {
            try {
                this._adltProcess.kill();
                this._adltProcess = undefined;
            } catch (err) {
                console.error(`adlt.closeAdltProcess(port=${this._adltPort}) got err=${err}`);
            }
        }
        this._adltPort = 0;
    }

    /**
     * spawn an adlt process at specified port.
     * 
     * Checks whether the process could be started sucessfully and
     * whether its listening on the port.
     * 
     * Uses this._adltCommand to start the process and the params 'remote -p<port>'.
     * 
     * It listens on stdout and stderr (and on 'close' and 'error' events).
     * This could be improved/changed to listen only until a successful start is detected.
     * 
     * Rejects with 'ENOENT' or 'AddrInUse' or 'did close unexpectedly' in case of errors.
     * 
     * @param port number of port to use for remote websocket
     * @returns pair of ChildProcess started and the port number
     */
    spawnAdltProcess(port: number): Promise<[ChildProcess, number]> {
        console.log(`adlt.spawnAdltProcess(port=${port})...`);
        // debug feature: if adltCommand contains only a number we do return just the port:
        if (+this._adltCommand > 0) {
            return new Promise<[ChildProcess, number]>((resolve, reject) => resolve([spawn("/bin/false", [], { detached: false, windowsHide: true }), +this._adltCommand]));
        }

        let p = new Promise<[ChildProcess, number]>((resolve, reject) => {
            let obj = [false];
            let childProc = spawn(this._adltCommand, ['remote', `-p=${port}`], { detached: false, windowsHide: true });
            console.log(`adlt.spawnAdltProcess(port=${port}) spawned adlt with pid=${childProc.pid}`);
            childProc.on('error', (err) => {
                console.error(`adlt.spawnAdltProcess process got err='${err}'`);
                if (!obj[0] && err.message.includes("ENOENT")) {
                    obj[0] = true;
                    reject("ENOENT please check configuration setting dlt-logs.adltPath");
                }
            });
            childProc.on('close', (code, signal) => {
                console.error(`adlt.spawnAdltProcess(port=${port}) process got close code='${code}' signal='${signal}'`);
                if (!obj[0]) {
                    obj[0] = true;
                    reject("did close unexpectedly");
                }
            });
            childProc?.stdout?.on('data', (data) => { // todo or use 'spawn' event?
                console.info(`adlt.spawnAdltProcess(port=${port}) process got stdout='${data}' typeof data=${typeof data}`);
                try {
                    if (!obj[0] && `${data}`.includes('remote server listening on')) {
                        obj[0] = true; // todo stop searching for ... (might as well stop listening completely for stdout)
                        console.info(`adlt.spawnAdltProcess(port=${port}) process got stdout resolving promise for port ${port}`);
                        resolve([childProc, port]);
                    }
                } catch (err) {
                    console.error(`adlt.spawnAdltProcess(port=${port}) process stdout got err='${err}, typeof data=${typeof data}'`);
                }
            });
            childProc?.stderr?.on('data', (data) => {
                console.warn(`adlt.spawnAdltProcess(port=${port}) process got stderr='${data}'`);
                if (!obj[0] && `${data}`.includes("AddrInUse")) {
                    obj[0] = true;
                    reject("AddrInUse");
                }
            });
        });
        return p;
    }

    /**
     * get the port of adlt process.
     * Starts adlt if needed and tries to find an open port in range
     * 6779-6789.
     * 
     * Sets internal variables _adltProcess and _adltPort as well.
     * @returns a promise for the port
     */
    getAdltProcessAndPort(): Promise<number> {
        let p = new Promise<number>((resolve, reject) => {
            if (!this._adltPort || !this._adltProcess) {
                // start it
                // currently it retries 10 times even if spawnAdltProcess rejects with ENOENT! todo
                util.retryOperation((retries_left: number) => this.spawnAdltProcess(6789 - retries_left), 10, 10).then(([childProc, port]) => {
                    this._adltProcess = childProc;
                    this._adltPort = port;
                    resolve(port);
                }).catch((reason) => {
                    this._adltPort = 0;
                    this._adltProcess = undefined;
                    reject(reason);
                });

            } else {
                resolve(this._adltPort);
            }
        });

        return p;
    }

    // filesystem provider api:
    get onDidChangeFile() {
        return this._onDidChangeFile.event;
    }
    stat(uri: vscode.Uri): vscode.FileStat {

        let document = this._documents.get(uri.toString());
        if (document) { return document.stat(); }
        try {
            let fileNames = decodeAdltUri(uri);
            if (fileNames.length > 0) {
                const realStat = fs.statSync(fileNames[0]);
                console.log(`adlt-logs.stat(uri=${uri.toString()})... isDirectory=${realStat.isDirectory()}}`);
                if (realStat.isFile() && (true /* todo dlt extension */)) {
                    try {
                        let port = this.getAdltProcessAndPort();
                        document = new AdltDocument(port, uri, this._onDidChangeFile, this._onDidChangeTreeData, this._treeRootNodes, this._onDidChangeStatus, this._columns, this._reporter);
                        this._documents.set(uri.toString(), document);
                        if (this._documents.size === 1) {
                            // this.checkActiveRestQueryDocChanged();
                        }
                    } catch (error) {
                        console.log(` adlt-logs.stat(uri=${uri.toString()}) returning realStat ${realStat.size} size.`);
                        return {
                            size: realStat.size, ctime: realStat.ctime.valueOf(), mtime: realStat.mtime.valueOf(),
                            type: realStat.isDirectory() ? vscode.FileType.Directory : (realStat.isFile() ? vscode.FileType.File : vscode.FileType.Unknown) // todo symlinks as file?
                        };
                    }
                }
                if (document) {
                    return document.stat();
                } else {
                    console.log(` adlt-logs.stat(uri=${uri.toString()}) returning realStat ${realStat.size} size.`);
                    return {
                        size: realStat.size, ctime: realStat.ctime.valueOf(), mtime: realStat.mtime.valueOf(),
                        type: realStat.isDirectory() ? vscode.FileType.Directory : (realStat.isFile() ? vscode.FileType.File : vscode.FileType.Unknown) // todo symlinks as file?
                    };
                }
            }
        } catch (err) {
            console.warn(`adlt-logs.stat(uri=${uri.toString()}) got err '${err}'!`);
        }
        return { size: 0, ctime: 0, mtime: 0, type: vscode.FileType.Unknown };
    }

    readFile(uri: vscode.Uri): Uint8Array {
        let doc = this._documents.get(uri.toString());
        console.log(`adlt-logs.readFile(uri=${uri.toString()})...`);
        if (!doc) {
            const port = this.getAdltProcessAndPort();
            doc = new AdltDocument(port, uri, this._onDidChangeFile, this._onDidChangeTreeData, this._treeRootNodes, this._onDidChangeStatus, this._columns, this._reporter);
            this._documents.set(uri.toString(), doc);
            if (this._documents.size === 1) {
                // todo this.checkActiveRestQueryDocChanged();
            }
        }
        return Buffer.from(doc.text);
    }

    watch(uri: vscode.Uri): vscode.Disposable {
        console.log(`adlt-logs.watch(uri=${uri.toString()}...`);
        return new vscode.Disposable(() => {
            console.log(`adlt-logs.watch.Dispose ${uri}`);
            // const fileUri = uri.with({ scheme: 'file' });
            let doc = this._documents.get(uri.toString());
            if (doc) {
                // we could delete the key as well
                // todo some dispose here?
                // we seem to get this already on switching tabs... investigate todo
                // this._documents.delete(uri.toString());
            }
        });
    }

    readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
        console.log(`adlt-logs.readDirectory(uri=${uri.toString()}...`);
        let entries: [string, vscode.FileType][] = [];
        // list all dirs and dlt files:
        let dirPath = uri.with({ query: "" }).fsPath; // for multiple files we take the first one as reference
        const dirEnts = fs.readdirSync(dirPath, { withFileTypes: true });
        for (var i = 0; i < dirEnts.length; ++i) {
            console.log(` adlt-logs.readDirectory found ${dirEnts[i].name}`);
            if (dirEnts[i].isDirectory()) {
                entries.push([dirEnts[i].name, vscode.FileType.Directory]);
            } else {
                if (dirEnts[i].isFile() && (dirEnts[i].name.endsWith(".dlt") /* todo config */)) {
                    entries.push([dirEnts[i].name, vscode.FileType.File]);
                }
            }
        }
        console.log(` adlt-logs.readDirectory(uri=${uri.toString()}) returning ${entries.length} entries.`);
        return entries;
    }

    writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }): void {
        console.log(`adlt-logs.writeFile(uri=${uri.toString()}...`);
        throw vscode.FileSystemError.NoPermissions();
    }

    rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): void {
        console.log(`adlt-logs.rename(oldUri=${oldUri.toString()}...`);
        throw vscode.FileSystemError.NoPermissions();
    }

    delete(uri: vscode.Uri): void {
        console.log(`adlt-logs.delete(uri=${uri.toString()}...`);
        throw vscode.FileSystemError.NoPermissions();
    }

    createDirectory(uri: vscode.Uri): void {
        console.log(`adlt-logs.createDirectory(uri=${uri.toString()}...`);
        throw vscode.FileSystemError.NoPermissions();
    }

}
