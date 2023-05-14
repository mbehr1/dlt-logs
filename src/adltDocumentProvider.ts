/* --------------------
 * Copyright(C) Matthias Behr. 2022
 */

/// todo: major issues before release:

/// not mandatory for first release:
/// [ ] support configs (for filters). currently all filters that have a configs entry are auto disabled at start
/// [ ] opening of a stream (and support within reports)
/// [ ] onDidChangeConfiguration
/// [ ] timeSync, adjustTime support
/// [ ] change exportDlt to use adlt
/// [ ] move decorations parsing/mgmt to extension
/// [ ] think about atLoadTime filters (use them as regular ones)

/// bugs:

/// [ ] if during applyFilter no change is triggered, the decorations are not updated (e.g. if marker filters are enabled)
/// [x] sort order support
/// by default logs are sorted by timestamp. If the sort order is toggled the file is closed and reopened.
/// this can be weird/confusing with real streams.
/// and one side effect is that any lifecycle filters are automatically disabled (as the lc.ids are not persisted across close/open)

/// [x] opening of multiple dlt files (needs more testing. seems to work even with breadcrumb selection)

import * as vscode from 'vscode';
import TelemetryReporter from '@vscode/extension-telemetry';
import * as fs from 'fs';
import * as WebSocket from 'ws';
import * as util from './util';
import * as path from 'path';
import * as semver from 'semver';
import { spawn, ChildProcess } from 'child_process';

import { DltFilter, DltFilterType } from './dltFilter';
import { DltReport, NewMessageSink, ReportDocument } from './dltReport';
import { FilterableDltMsg, ViewableDltMsg, MSTP, MTIN_CTRL, MTIN_LOG, EAC, getEACFromIdx, getIdxFromEAC, MTIN_LOG_strs } from './dltParser';
import { DltLifecycleInfoMinIF } from './dltLifecycle';
import { TreeViewNode, FilterNode, LifecycleRootNode, LifecycleNode, EcuNode, FilterRootNode, DynFilterNode } from './dltTreeViewNodes';

import * as remote_types from './remote_types';
import { DltDocument, ColumnConfig } from './dltDocument';
import { v4 as uuidv4 } from 'uuid';
import { AdltPlugin, AdltPluginChildNode } from './adltPlugin';
import { assert } from 'console';
import { fileURLToPath } from 'node:url';
import { generateRegex } from './generateRegex';
import * as JSON5 from 'json5';

//import { adltPath } from 'node-adlt';
// with optionalDependency we use require to catch errors
let adltPath: string | undefined = undefined;
try {
    var adltModule = require('node-adlt');
    adltPath = adltModule ? adltModule.adltPath : undefined;
} catch (err) {
    console.warn("node-adlt not available!");
}

/// minimum adlt version required
/// we do show a text if the version is not met.
/// see https://www.npmjs.com/package/semver#prerelease-identifiers
//const MIN_ADLT_VERSION_SEMVER_RANGE = ">=0.16.0";
const MIN_ADLT_VERSION_SEMVER_RANGE = require("../package.json")?.optionalDependencies["node-adlt"];

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
    resumeTime?: number;
    endTime: number; // in ms
    swVersion?: string;
    node: LifecycleNode;
    ecuLcNr: number;
    decorationType?: vscode.TextEditorDecorationType;

    constructor(binLc: remote_types.BinLifecycle, uri: vscode.Uri, ecuNode: EcuNode, lcRootNode: LifecycleRootNode) {
        this.ecu = char4U32LeToString(binLc.ecu);
        this.id = binLc.id;
        this.nrMsgs = binLc.nr_msgs;
        this.startTime = Number(binLc.start_time / 1000n); // start time in ms for calc.
        this.resumeTime = binLc.resume_time !== undefined ? Number(binLc.resume_time / 1000n) : undefined;
        this.endTime = Number(binLc.end_time / 1000n); // end time in ms
        this.swVersion = binLc.sw_version;
        //this.binLc = binLc;
        this.ecuLcNr = ecuNode.children.length;
        this.node = new LifecycleNode(uri.with({ fragment: this.resumeTime !== undefined ? this.resumeTime.toString() : this.startTime.toString() }), ecuNode, lcRootNode, this, undefined);
        ecuNode.children.push(this.node);
        if (this.swVersion !== undefined) {
            if (!ecuNode.swVersions.includes(this.swVersion)) {
                ecuNode.swVersions.push(this.swVersion);
                ecuNode.label = `ECU: ${this.ecu}, SW${ecuNode.swVersions.length > 1 ? `(${ecuNode.swVersions.length}):` : `:`} ${ecuNode.swVersions.join(' and ')}`;
            }
        }
        if (ecuNode.lcDecorationTypes !== undefined) {
            this.decorationType = ecuNode.lcDecorationTypes[(this.ecuLcNr + 1) % 2];
        }
    }

    update(binLc: remote_types.BinLifecycle, eventEmitter: vscode.EventEmitter<TreeViewNode | null>) {
        this.nrMsgs = binLc.nr_msgs;
        this.startTime = Number(binLc.start_time / 1000n); // start time in ms
        this.resumeTime = binLc.resume_time !== undefined ? Number(binLc.resume_time / 1000n) : undefined;
        this.endTime = Number(binLc.end_time / 1000n); // end time in ms
        this.swVersion = binLc.sw_version; // todo update parent ecuNode if changed
        // update node (todo refactor)
        this.node.label = `LC${this.getTreeNodeLabel()}`;
        // fire if we did update
        eventEmitter.fire(this.node);
    }

    get persistentId(): number {
        return this.id;
    }

    get lifecycleStart(): Date {
        return new Date(this.adjustTimeMs + this.startTime);
    }

    get isResume(): boolean {
        return this.resumeTime !== undefined;
    }

    get lifecycleResume(): Date {
        if (this.resumeTime !== undefined) {
            return new Date(this.resumeTime);
        } else {
            return this.lifecycleStart;
        }
    }

    get lifecycleEnd(): Date {
        return new Date(this.adjustTimeMs + this.endTime);
    }

    getTreeNodeLabel(): string {
        return `#${this.ecuLcNr}: ${this.resumeTime !== undefined ? `${new Date(this.resumeTime).toLocaleString()} RESUME ` : this.lifecycleStart.toLocaleString()}-${this.lifecycleEnd.toLocaleTimeString()} #${this.nrMsgs}`;
    }

    get tooltip(): string {
        return `SW:${this.swVersion ? this.swVersion : "unknown"}`;
    }

    get swVersions(): string[] {
        return this.swVersion ? [this.swVersion] : [];
    }

}

class AdltMsg implements ViewableDltMsg {
    _eac: EAC;
    index: number;
    htyp: number;
    receptionTimeInMs: number;
    timeStamp: number;
    lifecycle?: DltLifecycleInfoMinIF | undefined;
    mcnt: number;
    mstp: number;
    mtin: number;
    verbose: boolean;
    payloadString: string;

    constructor(binMsg: remote_types.BinDltMsg, lifecycle?: DltLifecycleInfoMinIF) {
        // cached ECU, APID, CTID:
        this._eac = getEACFromIdx(getIdxFromEAC({ e: char4U32LeToString(binMsg.ecu), a: char4U32LeToString(binMsg.apid), c: char4U32LeToString(binMsg.ctid) }))!;

        this.index = binMsg.index;
        this.receptionTimeInMs = Number(binMsg.reception_time / 1000n);
        this.timeStamp = binMsg.timestamp_dms;
        this.lifecycle = lifecycle;
        this.htyp = binMsg.htyp;
        this.mcnt = binMsg.mcnt;
        this.mstp = (binMsg.verb_mstp_mtin >> 1) & 0x7;
        this.mtin = (binMsg.verb_mstp_mtin >> 4) & 0xf;
        this.verbose = (binMsg.verb_mstp_mtin & 0x01) === 0x01;
        this.payloadString = binMsg.payload_as_text;
    }
    get ecu(): string { return this._eac.e; }
    get apid(): string { return this._eac.a; }
    get ctid(): string { return this._eac.c; }

    asRestObject(idHint: number): util.RestObject {
        return {
            id: this.index,
            type: 'msg',
            attributes: {
                timeStamp: this.timeStamp,
                ecu: this.ecu,
                mcnt: this.mcnt,
                apid: this.apid,
                ctid: this.ctid,
                mtin: MTIN_LOG_strs[this.mtin],
                payloadString: this.payloadString,
                lifecycle: this.lifecycle ? this.lifecycle.persistentId : undefined
            }
        };
    };
}

export interface StreamMsgData {
    msgs: AdltMsg[],
    sink: NewMessageSink
};

export function decodeAdltUri(uri: vscode.Uri): string[] {
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
                // console.log(`adlt got encoded fileNames=`, fileNames);
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

interface DecorationsInfo {
    decType: vscode.TextEditorDecorationType,
    decOptions: any, // the options used to create the type
}

export class AdltDocument implements vscode.Disposable {
    private _fileNames: string[]; // the real local file names
    private realStat: fs.Stats;
    private webSocket?: WebSocket;
    private webSocketIsConnected = false;
    private webSocketErrors: string[] = [];
    private adltVersion?: string; // the version from last wss upgrade handshake

    private streamId: number = 0; // 0 none, neg stop in progress. stream for the messages that reflect the main log/view
    private _startStreamPendingSince: number | undefined; // startStream() should be called since that time
    private visibleMsgs?: AdltMsg[]; // the array with the msgs that should be shown. set on startStream and cleared on stopStream
    private visibleLcs?: DltLifecycleInfoMinIF[]; // array with the visible lc persistent ids
    private _maxNrMsgs: number; //  setting 'dlt-logs.maxNumberLogs'. That many messages are displayed at once
    private _skipMsgs: number = 0; // that many messages are skipped from the top (here not loaded for cur streamId)

    private _sortOrderByTime = true; // we default to true // todo retrieve last from config?

    // decorations: (should always reflect what we want to show in all textEditors showing this doc)
    decorations = new Map<vscode.TextEditorDecorationType, vscode.DecorationOptions[]>();

    // config options for decorations
    private decWarning?: DecorationsInfo;
    private mdWarning = new vscode.MarkdownString("$(warning) LOG_WARN", true);
    private decError?: DecorationsInfo;
    private mdError = new vscode.MarkdownString("$(error) LOG_ERROR", true);
    private decFatal?: DecorationsInfo;
    private mdFatal = new vscode.MarkdownString("$(error) LOG_FATAL", true);

    private _decorationTypes = new Map<string, DecorationsInfo>(); // map with id and settings. init from config in parseDecorationsConfigs
    // decorationOptionsMapByType = new Map<vscode.TextEditorDecorationType

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
    ecuApidInfosMap: Map<string, Map<string, { apid: string, desc: string, nrMsgs: number, ctids: Map<string, [string, number]> }>> = new Map();
    apidsNodes: Map<string, DynFilterNode> = new Map();

    // messages of current files:
    fileInfoNrMsgs = 0;

    // messages for streams:
    private streamMsgs = new Map<number, StreamMsgData | remote_types.BinDltMsg[][]>();

    // event for being loaded
    isLoaded: boolean = false;
    private _onDidLoad = new vscode.EventEmitter<boolean>();
    get onDidLoad() { return this._onDidLoad.event; }

    get fileNames(): string[] {
        return this._fileNames.map((fullName) => path.basename(fullName));
    }

    processBinDltMsgs(msgs: remote_types.BinDltMsg[], streamId: number, streamData: StreamMsgData) {
        if (msgs.length === 0) { // indicates end of query:
            if (streamData.sink.onDone) { streamData.sink.onDone(); }
            this.streamMsgs.delete(streamId);
            // console.log(`adlt.processBinDltMsgs deleted stream #${streamId}`);
        } else {
            for (let i = 0; i < msgs.length; ++i) {
                let binMsg = msgs[i];

                let msg = new AdltMsg(binMsg, this.lifecycleInfoForPersistentId(binMsg.lifecycle_id));
                streamData.msgs.push(msg);
            }
            if (streamData.sink.onNewMessages) { streamData.sink.onNewMessages(msgs.length); }
        }
    }

    constructor(adltPort: Promise<number>, public uri: vscode.Uri, private emitDocChanges: vscode.EventEmitter<vscode.FileChangeEvent[]>, treeEventEmitter: vscode.EventEmitter<TreeViewNode | null>,
        parentTreeNode: TreeViewNode[], private emitStatusChanges: vscode.EventEmitter<vscode.Uri | undefined>, private checkActiveRestQueryDocChanged: () => boolean, private _columns: ColumnConfig[], reporter?: TelemetryReporter) {

        this._treeEventEmitter = treeEventEmitter;

        // support for multiple uris encoded...
        this._fileNames = decodeAdltUri(uri);
        if (!this._fileNames.length || !fs.existsSync(this._fileNames[0])) {
            throw Error(`AdltDocument file ${uri.toString()} doesn't exist!`);
        }
        this.realStat = fs.statSync(this._fileNames[0]); // todo summarize all stats

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
            label: `${path.basename(this._fileNames[0]) + (this._fileNames.length > 1 ? `+${this._fileNames.length - 1}` : '')}`, uri: this.uri, parent: null, children: [
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

        this.text = `Loading logs via adlt from ${this._fileNames.join(', ')} with max ${this._maxNrMsgs} msgs per page...`;

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
                                case 'EacInfo': {
                                    let eacInfo: Array<remote_types.BinEcuStats> = bin_type.value;
                                    this.processEacInfo(eacInfo);
                                }
                                    break;
                                case 'PluginState': {
                                    let states: Array<string> = bin_type.value || [];
                                    this.processPluginStateUpdates(states);
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
                        if (text.startsWith("info:")) { // todo still used?
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
                    } else {
                        console.log(`adlt.AdltDocumentProvider got matching adlt version ${this.adltVersion} vs ${MIN_ADLT_VERSION_SEMVER_RANGE}.`);
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

        // add a static report filter for testing:
        // this.onFilterAdd(new DltFilter({ type: DltFilterType.EVENT, payloadRegex: "(?<STATE_error>error)", name: "test report" }, false), false);
    }

    dispose() {
        console.log(`AdltDocument.dispose()`);
        this.streamMsgs.clear();

        this.closeAdltFiles().then(() => {
            if (this.webSocket !== undefined) {
                console.log(`AdltDocument.dispose closing webSocket`);
                this.webSocket.close();
                this.webSocket = undefined;
            }
        }, (reason) => {
            console.log(`AdltDocument.dispose closeAdltFiles failed with '${reason}'`);
        });
    }

    /**
     * callback to handle any configuration change dynamically
     * 
     * will be called on each configuration change.
     * @param event 
     */
    onDidChangeConfiguration(event: vscode.ConfigurationChangeEvent) {
        if (event.affectsConfiguration('dlt-logs.filters')) {
            this.onDidChangeConfigFilters();
            this.triggerApplyFilter();
        }
        // todo add for plugins, decorations, maxNumberLogs, columns?
    }

    /**
     * read or reread config changes for filters
     * Will be called from constructor and on each config change for dlt-logs.filters
     */
    onDidChangeConfigFilters() {
        console.log(`dlt-logs.AdltDocument.onDidChangeConfigFilters()...`);
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
                            // for now (as no proper config support) we disable those filters:
                            newFilter.enabled = false;
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
                                const plugin = new AdltPlugin(`File transfers`, new vscode.ThemeIcon('files'), this.uri, this.pluginTreeNode, this._treeEventEmitter, pluginObj, this);
                                this.pluginTreeNode.children.push(plugin);
                                //this.allFilters.push(plugin);
                                //this.filterTreeNode.children.push(new FilterNode(null, this.filterTreeNode, plugin)); // add to filter as well
                            }
                            break;
                        case 'SomeIp':
                            {
                                const plugin = new AdltPlugin(`SOME/IP Decoder`, new vscode.ThemeIcon('group-by-ref-type'), this.uri, this.pluginTreeNode, this._treeEventEmitter, pluginObj, this);
                                this.pluginTreeNode.children.push(plugin);
                            }
                            break;
                        case 'NonVerbose':
                            {
                                // todo add merge of settings with fibexDir from SomeIp to match the docs...
                                const plugin = new AdltPlugin(`Non-Verbose`, new vscode.ThemeIcon('symbol-numeric'), this.uri, this.pluginTreeNode, this._treeEventEmitter, pluginObj, this);
                                this.pluginTreeNode.children.push(plugin);
                            }
                            break;
                        case 'Rewrite':
                            {
                                const plugin = new AdltPlugin(`'Rewrite' plugin`, new vscode.ThemeIcon('replace-all'), this.uri, this.pluginTreeNode, this._treeEventEmitter, pluginObj, this);
                                this.pluginTreeNode.children.push(plugin);
                            }
                            break;
                        case 'CAN':
                            {
                                const plugin = new AdltPlugin(`CAN Decoder`, new vscode.ThemeIcon('plug'), this.uri, this.pluginTreeNode, this._treeEventEmitter, pluginObj, this);
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
                        this._decorationTypes.set(conf.id, { decType, decOptions: { ...decOpt } });
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
    getDecorationFor(filter: DltFilter): [DecorationsInfo, vscode.MarkdownString] | undefined {
        // for filter we use decorationId or filterColour:
        let filterName = `MARKER_${filter.id}`;

        let mdHoverText = this._decorationsHoverTexts.get(filterName);
        if (!mdHoverText) {
            mdHoverText = new vscode.MarkdownString(`MARKER ${filter.name}`);
            this._decorationsHoverTexts.set(filterName, mdHoverText);
        }

        if (filter.decorationId) { let dec = this._decorationTypes.get(filter.decorationId); if (!dec) { return undefined; } else { return [dec, mdHoverText]; } };
        // now we assume at least a filterColour:
        if (typeof filter.filterColour === 'string') {
            if (!filter.filterColour.length) { return undefined; }
            const decFilterName = `filterColour_${filter.filterColour}`;
            let dec = this._decorationTypes.get(decFilterName);
            if (dec) { return [dec, mdHoverText]; }
            // create this decoration:
            const decOptions = { borderColor: filter.filterColour, borderWidth: "1px", borderStyle: "dotted", overviewRulerColor: filter.filterColour, overviewRulerLane: 2, isWholeLine: true };
            dec = { decType: vscode.window.createTextEditorDecorationType(decOptions), decOptions };
            this._decorationTypes.set(decFilterName, dec);
            return [dec, mdHoverText];
        } else if (typeof filter.filterColour === 'object') {
            // decorationType alike object.
            let dec = this._decorationTypes.get(filterName); // we use filter name here as well as decoration key
            if (dec) { return [dec, mdHoverText]; } else {
                // create
                const decOptions = { isWholeLine: true, ...filter.filterColour };
                dec = { decType: vscode.window.createTextEditorDecorationType(decOptions), decOptions };
                this._decorationTypes.set(filterName, dec);
                return [dec, mdHoverText];
            }
        }
        return undefined;
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

    openAdltFiles() {
        // plugin configs:
        const pluginCfgs = JSON.stringify(this.pluginTreeNode.children.map(tr => (tr as AdltPlugin).options));
        this.sendAndRecvAdltMsg(`open {"sort":${this._sortOrderByTime},"files":${JSON.stringify(this._fileNames)},"plugins":${pluginCfgs}}`).then((response) => {
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
            // wait with startStream until the first EAC infos are here to be able to use that for
            // configs (autoenabling of filters)
            this._startStreamPendingSince = Date.now();
            // fallback that if after 5s no EAC... -> start
            setTimeout(() => {
                if (this._startStreamPendingSince !== undefined && ((Date.now() - this._startStreamPendingSince) >= 5000)) {
                    this._startStreamPendingSince = undefined;
                    this.startStream();
                }
            }, 5000);
        });
    }

    closeAdltFiles(): Promise<void> {
        this._startStreamPendingSince = undefined;
        let p = new Promise<void>((resolve, reject) => {
            this.sendAndRecvAdltMsg(`close`).then(() => {
                this.processFileInfoUpdates({ nr_msgs: 0 });
                this.processLifecycleUpdates([]); // to remove any filters from lifecycles as they become invalid
                resolve();
            }).catch((r) => reject(r));
        });
        return p;
    }

    processEacInfo(eacInfo: Array<remote_types.BinEcuStats>) {
        for (let ecuStat of eacInfo) {
            let ecu = char4U32LeToString(ecuStat.ecu);
            let apidInfos = this.ecuApidInfosMap.get(ecu);
            if (apidInfos === undefined) {
                apidInfos = new Map();
                this.ecuApidInfosMap.set(ecu, apidInfos);
            }
            let did_modify_apidInfos = false;
            for (let newApidInfo of ecuStat.apids) {
                let apid = char4U32LeToString(newApidInfo.apid);
                let apidNrMsgs = newApidInfo.ctids.reduce((pv, cv) => pv + cv.nr_msgs, 0);
                let existingInfo = apidInfos.get(apid);
                if (existingInfo === undefined) {
                    let existingInfo = {
                        apid: apid,
                        nrMsgs: apidNrMsgs,
                        desc: newApidInfo.desc !== undefined ? newApidInfo.desc : '',
                        ctids: new Map<string, [string, number]>(newApidInfo.ctids.map((c: remote_types.BinCtidInfo) => [char4U32LeToString(c.ctid), [c.desc || '', c.nr_msgs]])),
                    };
                    apidInfos.set(apid, existingInfo);
                    did_modify_apidInfos = true;
                } else {
                    // update
                    if (existingInfo.desc.length === 0 && newApidInfo.desc !== undefined || existingInfo.nrMsgs !== apidNrMsgs) {
                        existingInfo.desc = newApidInfo.desc || '';
                        existingInfo.nrMsgs = apidNrMsgs;
                        did_modify_apidInfos = true;
                    }
                    // now iterate ctids:
                    for (let ctidInfo of newApidInfo.ctids) {
                        let ctid = char4U32LeToString(ctidInfo.ctid);
                        let existingCtid = existingInfo.ctids.get(ctid);
                        if (existingCtid === undefined) {
                            existingInfo.ctids.set(ctid, [ctidInfo.desc !== undefined ? ctidInfo.desc : '', ctidInfo.nr_msgs]);
                            did_modify_apidInfos = true;
                        } else {
                            if (existingCtid[0].length === 0 && ctidInfo.desc !== undefined || existingCtid[1] !== ctidInfo.nr_msgs) {
                                existingInfo.ctids.set(ctid, [ctidInfo.desc || '', ctidInfo.nr_msgs]);
                                did_modify_apidInfos = true;
                            }
                        }
                    }
                }
            }
            if (did_modify_apidInfos) {
                // console.log(`adlt.processEacInfo${eacInfo.length}) did_modify_apidInfos`);
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
                            const apidNode = new DynFilterNode(`'${apid}'(${apidI.ctids.size} #${apidI.nrMsgs})${apidI.desc ? `: ${apidI.desc}` : ''}`, `desc='${apidI.desc || ''}', apid = 0x${Buffer.from(apid).toString("hex")}, #msgs=${apidI.nrMsgs}`, ecuApidsNode, undefined, { ecu: ecu, apid: apid, ctid: null, payload: null, payloadRegex: null, not: null, mstp: null, logLevelMin: null, logLevelMax: null, lifecycles: null }, this);
                            ecuApidsNode.children.push(apidNode);
                            // add ctids:
                            for (let [ctid, [desc, nrMsgs]] of apidI.ctids) {
                                const ctidNode = new DynFilterNode(`'${ctid}'(#${nrMsgs})${desc ? `: ${desc} ` : ''}`, `desc='${desc}', ctid = 0x${Buffer.from(ctid).toString("hex")}, #msgs=${nrMsgs}`, apidNode, undefined, { ecu: ecu, apid: apid, ctid: ctid, payload: null, payloadRegex: null, not: null, mstp: null, logLevelMin: null, logLevelMax: null, lifecycles: null }, this);
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

        }
        if (this._startStreamPendingSince !== undefined) {
            // now we might have some ECUs and can determine the autoenabled configs/filters
            // autoEnableConfigs() todo!

            console.log(`adlt.processEacInfo starting stream after ${Date.now() - this._startStreamPendingSince}ms. #Ecus=${this.ecuApidInfosMap.size}`);
            this._startStreamPendingSince = undefined;
            this.startStream();
        }

    }

    processPluginStateUpdates(states: string[]) {
        for (let stateStr of states) {
            try {
                let state = JSON.parse(stateStr);
                let pluginName = state.name;
                // find proper plugin:
                for (let plugin of this.pluginTreeNode.children as AdltPlugin[]) {
                    if (plugin.name === pluginName) {
                        plugin.processStateUpdate(state);
                        break;
                    }
                }
            } catch (e) {
                console.error(`adlt.processPluginStateUpdates got err=${e}`);
            }
        }
    }

    stopStream() {
        this._startStreamPendingSince = undefined;
        if (this.streamId > 0) {
            // we do invalidate it already now:
            let oldStreamId = this.streamId;
            this.streamId = -this.streamId;
            this.visibleMsgs = undefined;
            this.visibleLcs = undefined;;
            return this.sendAndRecvAdltMsg(`stop ${oldStreamId}`).then((text) => {
                console.log(`adlt on stop resp: ${text}`);
                // todo verify streamId?
                this.streamId = 0;
            });
        }
        return Promise.reject("no active stream");
    }

    changeWindow() {
        if (this.streamId > 0) {
            let oldStreamId = this.streamId;
            this.streamId = -this.streamId;
            return this.sendAndRecvAdltMsg(`stream_change_window ${oldStreamId} ${this._skipMsgs},${this._skipMsgs + this._maxNrMsgs}`).then((response) => {
                //console.log(`adlt.changeWindow on stream_change_window resp: ${response}`); // e.g. ok stream_change_window <old_id>={"id":..., "windows":[]}
                const streamObj = JSON.parse(response.slice(response.indexOf("=") + 1));
                console.log(`adlt.changeWindow on stream_change_window streamObj: ${JSON.stringify(streamObj)}`);
                let curStreamMsgData = this.streamMsgs.get(streamObj.id);

                this.streamId = streamObj.id;

                this.visibleMsgs!.length = 0;
                this.visibleLcs!.length = 0;
                // empty all decorations
                this.clearDecorations();

                let streamData = this.streamMsgs.get(oldStreamId);
                assert(streamData !== undefined, "logical error! investigate!");

                this.streamMsgs.set(streamObj.id, streamData!);
                this.streamMsgs.delete(oldStreamId);
                // console.warn(`adlt.changeWindow streamMsgs #${this.streamMsgs.size}`);
                if (curStreamMsgData && Array.isArray(curStreamMsgData)) {
                    // process the data now:
                    curStreamMsgData.forEach((msgs) => this.processBinDltMsgs(msgs, streamObj.id, streamData as StreamMsgData));
                }

            });
        }
        return Promise.reject("no active stream");
    }

    startStream() {
        // start stream:
        let filterStr = this.allFilters.filter(f => (f.type === DltFilterType.POSITIVE || f.type === DltFilterType.NEGATIVE) && f.enabled).map(f => JSON.stringify({ ...f.asConfiguration(), enabled: true })).join(','); // enabled is not updated/stored in config. so have to overwrite here
        let decFilters = this.allFilters.filter(f => (f.type === DltFilterType.MARKER || ((f.type === DltFilterType.POSITIVE) && (f.decorationId !== undefined || f.filterColour !== undefined))) && f.enabled);
        console.log(`adlt.startStream have ${decFilters.length} decoration filters: ${decFilters.map((f) => f.name).join(',')}`);
        // todo optimize the window so that the start can do a binary search!
        this.sendAndRecvAdltMsg(`stream {"window":[${this._skipMsgs},${this._skipMsgs + this._maxNrMsgs}], "binary":true, "filters":[${filterStr}]}`).then((response) => {
            console.log(`adlt.on startStream got response:'${response}'`);
            const streamObj = JSON.parse(response.substring(11));
            console.log(`adlt ok:stream`, JSON.stringify(streamObj));
            this.streamId = streamObj.id;
            this.text = "";
            this.visibleMsgs = [];
            this.visibleLcs = [];
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
            let visibleLcs = this.visibleLcs;
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
                        let viewMsgsLength = viewMsgs.length;
                        DltDocument.textLinesForMsgs(doc._columns, viewMsgs, viewMsgsLength - nrNewMsgs, viewMsgsLength - 1, 8 /*todo*/, undefined).then((newTxt: string) => {
                            if (isFirst) { doc.text = newTxt; } else { doc.text += newTxt; }
                            doc.emitDocChanges.fire([{ type: vscode.FileChangeType.Changed, uri: doc.uri }]);
                            console.log(`adlt.onNewMessages(${nrNewMsgs}, isFirst=${isFirst}) triggered doc changes.`);
                            // determine the new decorations:
                            let lastLc: DltLifecycleInfoMinIF | undefined = undefined;
                            let newLcs: [DltLifecycleInfoMinIF, number][] = [];
                            let endOfLcs: Map<DltLifecycleInfoMinIF, number> = new Map();
                            let updatedLcs: Map<string, DltLifecycleInfoMinIF> = new Map(); // per ecu only one can be updated
                            for (let i = viewMsgsLength - nrNewMsgs; i <= viewMsgsLength - 1; ++i) {
                                let msg = viewMsgs[i];
                                if (msg.lifecycle !== lastLc) {
                                    let lc: DltLifecycleInfoMinIF | undefined = msg.lifecycle;
                                    if (lc) {
                                        // its either a new lc or an updated one:
                                        if (visibleLcs.includes(lc)) {
                                            // was already included
                                            if (!updatedLcs.has(msg.ecu)) { updatedLcs.set(msg.ecu, lc); }
                                        } else {
                                            // new one, will be included to visibleLcs later
                                            if (newLcs.findIndex(([a,]) => a === lc) < 0) { newLcs.push([lc, i]); }
                                        }
                                    }
                                    if (lastLc) { endOfLcs.set(lastLc, i - 1); }
                                    lastLc = lc;
                                }

                                const decs = doc.getDecorationsTypeAndHoverMDForMsg(msg, decFilters);

                                if (decs.length) {
                                    for (let dec of decs) {
                                        let options = doc.decorations.get(dec[0].decType);
                                        if (!options) {
                                            options = [];
                                            doc.decorations.set(dec[0].decType, options);
                                        }
                                        options.push({ range: new vscode.Range(i, 0, i, 21), hoverMessage: dec[1] });
                                    }
                                }
                            }
                            if (lastLc) { endOfLcs.set(lastLc, viewMsgsLength - 1); }
                            if (updatedLcs.size > 0) {
                                // update decoration end time
                                for (let lc of updatedLcs.values()) {
                                    //console.warn(`adlt.decorating updating lc ${lc.persistentId}`);
                                    // find dec
                                    if (lc.decorationType !== undefined) {
                                        let decs = doc.decorations.get(lc.decorationType) || [];
                                        for (let idx = decs.length - 1; idx >= 0; idx--) {
                                            let dec = decs[idx] as any; // todo vscode.DecorationOptions + DltLifecycleInfoMinIF;
                                            if (dec._lc === lc) {
                                                let endLine = endOfLcs.get(lc) || dec.range.start.line;
                                                let oldRange = dec.range;
                                                dec.range = new vscode.Range(dec.range.start.line, dec.range.start.character, endLine, dec.range.end.character);
                                                //console.warn(`adlt.decorating updating lc ${lc.persistentId} old=${oldRange.start.line}-${oldRange.end.line} new=${dec.range.start.line}-${dec.range.end.line}`);
                                                dec.hoverMessage = `LC${lc.getTreeNodeLabel()}`;
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                            if (newLcs.length > 0) {
                                // add new decoration for those lcs
                                for (let [newLc, startLine] of newLcs) {
                                    if (newLc.decorationType !== undefined) {
                                        let decs = doc.decorations.get(newLc.decorationType);
                                        if (decs === undefined) { decs = []; doc.decorations.set(newLc.decorationType, decs); }
                                        let endLine = endOfLcs.get(newLc) || startLine;
                                        if (endLine < startLine) { endLine = startLine; }
                                        //console.info(`adlt.decorating lc ${newLc.persistentId} ${startLine}-${endLine}`);
                                        const dec = { _lc: newLc, range: new vscode.Range(startLine, 0, endLine, 21), hoverMessage: `LC ${newLc.getTreeNodeLabel()}` };
                                        decs.push(dec);
                                    }
                                    visibleLcs.push(newLc);
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
        console.log(`adlt.clearDecorations()...`);
        this.textEditors.forEach((editor) => {
            this.decorations.forEach((value, key) => {
                value.length = 0; // seems a way to clear all elements
                // this is not needed as we modify the orig array. editor.setDecorations(key, value);
            });
        });
    }

    updateDecorations() {
        console.log(`adlt.updateDecorations()...`);
        this.textEditors.forEach((editor) => {
            this.decorations.forEach((value, key) => {
                editor.setDecorations(key, value);
            });
        });
    }

    getDecorationsTypeAndHoverMDForMsg(msg: FilterableDltMsg, decFilters: DltFilter[]) {
        let decs: [DecorationsInfo, vscode.MarkdownString][] = [];

        if (msg.mstp === MSTP.TYPE_LOG) {
            if (this.decWarning && msg.mtin === MTIN_LOG.LOG_WARN) {
                decs.push([this.decWarning, this.mdWarning]);
            } else if (this.decError && msg.mtin === MTIN_LOG.LOG_ERROR) {
                decs.push([this.decError, this.mdError]);
            } else if (this.decFatal && msg.mtin === MTIN_LOG.LOG_FATAL) {
                decs.push([this.decFatal, this.mdFatal]);
            }
        }
        if (decFilters.length > 0) {
            for (let d = 0; d < decFilters.length; ++d) {
                let decFilter = decFilters[d];
                if (decFilter.matches(msg)) {
                    const decType = this.getDecorationFor(decFilter);
                    if (decType) {
                        decs.push([decType[0], decType[1]]);
                        break;
                    }
                }
            }
        }
        return decs;
    }


    // window support:
    notifyVisibleRange(range: vscode.Range) {
        //console.warn(`adlt.notifyVisibleRange ${range.start.line}-${range.end.line} maxNrMsgs=${this._maxNrMsgs}`);

        // we do show max _maxNrMsgs from [_skipMsgs, _skipMsgs+_maxNrMsgs)
        // and trigger a reload if in the >4/5 or <1/5
        // and jump by 0.5 then

        const triggerAboveLine = range.start.line;
        const triggerBelowLine = range.end.line;

        // we ignore the ranges for the interims "loading..." docs.
        if (triggerBelowLine - triggerAboveLine < 10) {
            console.log(`adlt.notifyVisibleRange ignoring as range too small (visible: [${triggerAboveLine}-${triggerBelowLine}]) current: [${this._skipMsgs}-${this._skipMsgs + this._maxNrMsgs})`);
            return;
        }

        if (triggerAboveLine <= (this._maxNrMsgs * 0.2)) {
            // can we scroll to the top?
            if (this._skipMsgs > 0) {
                //console.log(`adlt.notifyVisibleRange(visible: [${triggerAboveLine}-${triggerBelowLine}]) current: [${this._skipMsgs}-${this._skipMsgs + this._maxNrMsgs}) triggerAbove`);

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
                this.changeWindow();
            }
        }

        if (triggerBelowLine >= (this._maxNrMsgs * 0.8)) {
            // can we load more msgs?
            const msgs = this.visibleMsgs;
            if (msgs && this._maxNrMsgs === msgs.length) { // we assume more msgs are there (might be none) (todo test that case)
                console.log(`adlt.notifyVisibleRange(visible: [${triggerAboveLine}-${triggerBelowLine}]) current: [${this._skipMsgs}-${this._skipMsgs + this._maxNrMsgs}) triggerBelow`);
                if (this.textEditors.length > 0) {
                    this.textEditors.forEach((editor) => {
                        const shiftByLines = -this._maxNrMsgs * 0.5;
                        let newRange = new vscode.Range(triggerAboveLine + shiftByLines, range.start.character,
                            triggerBelowLine + shiftByLines, range.end.character);
                        editor.revealRange(newRange, vscode.TextEditorRevealType.AtTop);
                    });
                }
                this._skipMsgs += (this._maxNrMsgs * 0.5);
                this.changeWindow();
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
        console.log(`adlt.triggerApplyFilter() called for '${this.uri.toString().slice(0, 100)}'`);
        if (this.debouncedApplyFilterTimeout) { clearTimeout(this.debouncedApplyFilterTimeout); }
        this.debouncedApplyFilterTimeout = setTimeout(() => {
            console.log(`adlt.triggerApplyFilter after debounce for '${this.uri.toString().slice(0, 100)}'`);
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
            console.warn(`adlt.applyFilter called while running already. ignoring for now. todo!`); // do proper fix queuing this request or some promise magic.
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
        this.closeAdltFiles().then(() => {
            this.clearLifecycleInfos();
            this.openAdltFiles();
        }).catch((reason) => {
            console.warn(`ADltDocument.toggleSortOrder() closeAdltFiles failed with '${reason}'`);
        });
    }

    private _reports: DltReport[] = [];

    onDidChangeSelectedTime(time: Date[] | Date | null) {
        this._reports.forEach(r => r.onDidChangeSelectedTime(time));
    }

    revealDate(time: Date): void {
        this.lineCloseToDate(time).then((line) => {
            try {
                if (line >= 0 && this.textEditors) {
                    const posRange = new vscode.Range(line, 0, line, 0);
                    this.textEditors.forEach((value) => {
                        value.revealRange(posRange, vscode.TextEditorRevealType.AtTop);
                    });
                }
            } catch (err) {
                console.warn(`adlt.revealDate(${time}) got err=${err}`);
            }
        });
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
            this.revealDate(new Date(index));
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
            let filters = Array.isArray(filter) ? filter : [filter];
            let filterStr = filters.filter(f => f.enabled).map(f => JSON.stringify({ ...f.asConfiguration(), enabled: true })).join(',');
            this.sendAndRecvAdltMsg(`stream {"window":[0,1000000], "binary":true, "filters":[${filterStr}]}`).then((response) => {
                console.log(`adlt.on startStream got response:'${response}'`);
                const streamObj = JSON.parse(response.substring(11));
                console.log(`adtl ok:stream`, JSON.stringify(streamObj));

                let singleReport = report.addFilter(filter);
                if (singleReport !== undefined) {
                    let streamMsgs: AdltMsg[] = singleReport.msgs as AdltMsg[];
                    report.disposables.push({
                        dispose: () => {
                            this.sendAndRecvAdltMsg(`stop ${streamObj.id}`).then(() => { });
                            console.log(`onOpenReport reportToAdd onDispose stopped stream`);
                        }
                    });

                    let curStreamMsgData = this.streamMsgs.get(streamObj.id);
                    let streamData = { msgs: streamMsgs, sink: singleReport };
                    this.streamMsgs.set(streamObj.id, streamData);
                    if (curStreamMsgData && Array.isArray(curStreamMsgData)) {
                        // process the data now:
                        curStreamMsgData.forEach((msgs) => this.processBinDltMsgs(msgs, streamObj.id, streamData));
                    }                
                    return report;
                } else {
                    return undefined;
                }
            });
        } else {
            // shall we query first the messages fitting to the filters or shall we 
            // open the report first and add the messages then?
            let filters = Array.isArray(filter) ? filter : [filter];
            let filterStr = filters.filter(f => f.enabled).map(f => JSON.stringify({ ...f.asConfiguration(), enabled: true })).join(',');
            this.sendAndRecvAdltMsg(`stream {"window":[0,1000000], "binary":true, "filters":[${filterStr}]}`).then((response) => {
                console.log(`adlt.on startStream got response:'${response}'`);
                const streamObj = JSON.parse(response.substring(11));
                // console.log(`adtl ok:stream`, JSON.stringify(streamObj));
                //let streamMsgs: AdltMsg[] = [];
                let report = new DltReport(context, this, (r: DltReport) => { // todo msgs
                    console.log(`onOpenReport onDispose called... #reports=${this._reports.length}`);
                    const idx = this._reports.indexOf(r);
                    if (idx >= 0) {
                        this._reports.splice(idx, 1);
                    }
                    this.sendAndRecvAdltMsg(`stop ${streamObj.id}`).then(() => { });
                    console.log(`onOpenReport onDispose done #reports=${this._reports.length}`);
                });
                let singleReport = report.addFilter(filter);
                if (singleReport !== undefined) {
                    let streamMsgs = singleReport.msgs as AdltMsg[];
                    // here some data might be already there for that stream.
                    // this can happen even though the wss data arrives sequentially but the processing
                    // here for wss data is a direct call vs. an asyn .then()...
                    let curStreamMsgData = this.streamMsgs.get(streamObj.id);
                    let streamData = { msgs: streamMsgs, sink: singleReport };
                    this.streamMsgs.set(streamObj.id, streamData);
                    if (curStreamMsgData && Array.isArray(curStreamMsgData)) {
                        // process the data now:
                        curStreamMsgData.forEach((msgs) => this.processBinDltMsgs(msgs, streamObj.id, streamData));
                    }

                    this._reports.push(report); // todo implement Disposable for DltDocument as well so that closing a doc closes the report as well

                    return report;
                } else {
                    return undefined;
                }
            });
        }
    }

    provideTimeByMsg(msg: FilterableDltMsg | ViewableDltMsg): Date | undefined {
        if ((msg.mstp === MSTP.TYPE_CONTROL && msg.mtin === MTIN_CTRL.CONTROL_REQUEST)) {
            return;
        }
        if (msg.lifecycle) {
            return new Date(msg.lifecycle.lifecycleStart.valueOf() + (msg.timeStamp / 10));
        }
        return new Date(/* todo this._timeAdjustMs + */ 'receptionTimeInMs' in msg ? msg.receptionTimeInMs : (msg.timeStamp / 10));
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

                        this.changeWindow();
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
            if (ctidInfo !== undefined) { ctidDesc = `: ${util.escapeMarkdown(ctidInfo[0])}`; }
        }
        mdString.appendMarkdown(`| calculated time | ${util.escapeMarkdown(posTime.toLocaleTimeString())}.${String(posTime.valueOf() % 1000).padStart(3, "0")}|\n| :--- | :--- |\n` +
            `| lifecycle | ${util.escapeMarkdown(msg.lifecycle?.getTreeNodeLabel())}|\n` +
            `| ecu session id | ${util.escapeMarkdown(msg.ecu)} nyi ${0/*msg.sessionId*/} |\n` +
            `| timestamp | ${msg.timeStamp / 10000} s |\n` +
            `| reception time | ${util.escapeMarkdown(receptionDate.toLocaleTimeString())}.${String(Number(msg.receptionTimeInMs % 1000).toFixed(0)).padStart(3, '0')} |\n` +
            `| apid | ${util.escapeMarkdown(msg.apid)}${apidDesc} |\n` +
            `| ctid | ${msg.ctid}${ctidDesc} |\n`);
        mdString.appendMarkdown(`\n\n-- -\n\n`);

        const args = [{ uri: this.uri.toString(), base64Uri: Buffer.from(this.uri.toString()).toString('base64') }, { mstp: msg.mstp, ecu: msg.ecu, apid: msg.apid, ctid: msg.ctid, payload: msg.payloadString }];
        const addCommandUri = vscode.Uri.parse(`command:dlt-logs.addFilter?${encodeURIComponent(JSON.stringify(args))}`);

        mdString.appendMarkdown(`[$(filter) add filter... ](${addCommandUri})`);

        // can we create a report from that log line?
        try {
            // do we have multiple selected lines?
            const selections = this.textEditors.length > 0 ? this.textEditors[0].selections : [];
            const payloads = [msg.payloadString];
            // limit to 10.000 selections for now (todo make full async?)
            // and max 100 different payloads
            selections.slice(0, 10000).forEach((selection) => {
                if (selection.isSingleLine) {
                    let selMsg = this.msgByLine(selection.start.line);
                    // todo think whether filter on ctid/apid is necessary for selections
                    if (selMsg && selMsg.ctid === msg.ctid && selMsg.apid === msg.apid) {
                        let payload = selMsg.payloadString;
                        if (payloads.length < 100 && !payloads.includes(payload)) { payloads.push(payload); }
                    }
                }
            });

            const regexs = generateRegex(payloads);
            console.log(`AdltDocument.provideHover regexs='${regexs.map((v) => '/' + v.source + '/').join(',')}'`);
            if (regexs.length === 1 && regexs[0].source.includes('(?<')) {
                // added encoding of the uri using base64 but the same problem can happen with payloadRegex as well...
                // filed https://github.com/microsoft/vscode/issues/179962 to have it fixed/analysed within vscode.
                const args = [{ uri: this.uri.toString(), base64Uri: Buffer.from(this.uri.toString()).toString('base64') }, { type: 3, mstp: msg.mstp, apid: msg.apid, ctid: msg.ctid, payloadRegex: regexs[0].source }];
                const addCommandUri = vscode.Uri.parse(`command:dlt-logs.openReport?${encodeURIComponent(JSON.stringify(args))}`);
                // console.warn(`quick report openReport with command uri:'${addCommandUri}' for doc uri:'${this.uri.toString()}'`);
                mdString.appendMarkdown(`[$(graph) open quick report... ](${addCommandUri})`);
                mdString.appendMarkdown(`[$(globe) open regex101.com with quick report...](https://regex101.com/?flavor=javascript&regex=${encodeURIComponent(args[1].payloadRegex || '')}&testString=${encodeURIComponent(payloads.slice(0, 20).join('\n'))})`);
                /*mdString.appendMarkdown(`\n\n-- -\n\n`);
                mdString.appendCodeblock('/' + args[1].payloadRegex + '/', 'javascript');*/
            }
        } catch (e) {
            console.error(`hover generateRegex got error='${e}'`);
        }
        mdString.isTrusted = true;

        return new vscode.Hover(mdString);
    }

    /// the last time updateStatusBar has been called.
    /// this is used as well to determine which document to use for restQuery if none is visible
    lastUpdatedStatusBar: number = 0;

    updateStatusBarItem(item: vscode.StatusBarItem) {
        this.lastUpdatedStatusBar = Date.now();
        if (this.webSocketIsConnected) {
            item.text = this.visibleMsgs !== undefined && this.visibleMsgs.length !== this.fileInfoNrMsgs ? `${this.visibleMsgs.length}/${this.fileInfoNrMsgs} msgs` : `${this.fileInfoNrMsgs} msgs`;
            let nrEnabledFilters: number = 0;
            this.allFilters.forEach(filter => {
                if (!filter.atLoadTime && filter.enabled && (filter.type === DltFilterType.POSITIVE || filter.type === DltFilterType.NEGATIVE)) { nrEnabledFilters++; }
            });
            const nrAllFilters = this.allFilters.length;
            // todo show wss connection status
            item.tooltip = `ADLT v${this.adltVersion || ":unknown!"}: ${this._fileNames.join(', ')}, showing max ${this._maxNrMsgs} msgs, ${0/*this._timeAdjustMs / 1000*/}s time-adjust, ${0 /* todo this.timeSyncs.length*/} time-sync events, ${nrEnabledFilters}/${nrAllFilters} enabled filters, sorted by ${this._sortOrderByTime ? 'time' : 'index'}`;
        } else {
            item.text = "$(alert) adlt not con!";
            item.tooltip = `ADLT: ${this._fileNames.join(', ')}, not connected to adlt via websocket!`;
        }
        if (this.webSocketErrors.length > 0) {
            item.text += ` $(alert) ${this.webSocketErrors.length} errors!`;
            item.tooltip += ` Errors:\n${this.webSocketErrors.join('\n')}`;
        }
    }


    processFileInfoUpdates(fileInfo: remote_types.BinFileInfo) {
        //console.log(`adlt fileInfo: nr_msgs=${fileInfo.nr_msgs}`);
        this.fileInfoNrMsgs = fileInfo.nr_msgs;
        this.emitStatusChanges.fire(this.uri);
        this.checkActiveRestQueryDocChanged();
    }

    clearLifecycleInfos() {
        console.log(`adlt.clearLifecycleInfos()...`);
        this.lifecycles.clear();
        this.lifecyclesByPersistentId.clear();
        this.lifecycleTreeNode.children.length = 0;
        this._treeEventEmitter.fire(this.lifecycleTreeNode);
    }

    /**
     * process lifecycles updates
     * we expect only updated lifecycles since last openFile
     * todo clear at closeFile...
     * @param lifecycles updated lifecycles from adlt
     */
    processLifecycleUpdates(lifecycles: Array<remote_types.BinLifecycle>) {
        // todo check for changes compared to last update
        // for now we check only whether some ecus or lifecycles are not needed anymore:

        // determine ecu to decorate if called the first time:
        let decorateEcu: string | undefined = undefined;

        if (this.lifecycles.size === 0) {
            let msgsByEcu: Map<string, number> = new Map();
            lifecycles.forEach(lc => {
                let ecuStr = char4U32LeToString(lc.ecu);
                let msgs = msgsByEcu.get(ecuStr);
                msgsByEcu.set(ecuStr, (msgs || 0) + lc.nr_msgs);
            });
            let maxNrMsgs = -1;
            for (let [ecu, nrMsgs] of msgsByEcu) {
                if (nrMsgs > maxNrMsgs) {
                    decorateEcu = ecu;
                    maxNrMsgs = nrMsgs;
                }
            }
        }

        // determine updated ones vs. new ones:
        let fireTreeNode = false;
        for (let lc of lifecycles) {
            let lcInfo = this.lifecyclesByPersistentId.get(lc.id);
            if (lcInfo !== undefined) {
                // update
                (lcInfo as AdltLifecycleInfo).update(lc, this._treeEventEmitter);
            } else { // new one
                let ecu = char4U32LeToString(lc.ecu);
                let isMaxNrMsgsEcu = false; // todo...

                let lcInfos = this.lifecycles.get(ecu);
                let ecuNode: EcuNode;
                if (lcInfos === undefined) {
                    lcInfos = [];
                    this.lifecycles.set(ecu, lcInfos);
                    let lcDecorationTypes: [vscode.TextEditorDecorationType | undefined, vscode.TextEditorDecorationType | undefined] | undefined = undefined;
                    if (decorateEcu !== undefined && decorateEcu === ecu) {
                        lcDecorationTypes = [this._decorationTypes.get("lifecycleEven")?.decType, this._decorationTypes.get("lifecycleOdd")?.decType];
                    }
                    ecuNode = { id: util.createUniqueId(), label: `ECU: ${ecu}`, swVersions: [], lcDecorationTypes, parent: this.lifecycleTreeNode, children: [], uri: this.uri, tooltip: undefined };
                    // get and or insert apidNode:
                    let apidNode = this.apidsNodes.get(ecu);
                    if (apidNode === undefined) {
                        apidNode = new DynFilterNode(`APIDs (unknown) / CTIDs`, undefined, ecuNode, `symbol-misc`, { ecu: ecu, apid: null, ctid: null, payload: null, payloadRegex: null, not: null, mstp: null, logLevelMin: null, logLevelMax: null, lifecycles: null }, this);
                        this.apidsNodes.set(ecu, apidNode);
                    }
                    ecuNode.children.push(apidNode);
                    this.lifecycleTreeNode.children.push(ecuNode);
                    fireTreeNode = true;
                } else {
                    if (lcInfos[0]?.node === undefined) {
                        console.warn(`adlt.processLifecycleUpdates got missing node! for ecu=${ecu}`, lcInfos[0]);
                    }
                    ecuNode = lcInfos[0]!.node!.parent;
                }


                lcInfo = new AdltLifecycleInfo(lc, this.uri, ecuNode, this.lifecycleTreeNode);
                this.lifecyclesByPersistentId.set(lc.id, lcInfo);
                lcInfos?.push(lcInfo);
                if (!fireTreeNode) {
                    this._treeEventEmitter.fire(ecuNode);
                }
            }
        }
        if (fireTreeNode) { this._treeEventEmitter.fire(this.lifecycleTreeNode); }
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
                            const reportFilters = JSON5.parse(commandParams);
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
                            const queryFilters = JSON5.parse(commandParams);
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
                                    retObj.data = util.createRestArray(matches, (obj: object, i: number) => { const msg = obj as FilterableDltMsg; return msg.asRestObject(i); });
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
                            const filterAttribs = JSON5.parse(commandParams);
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
                            const filterAttribs = JSON5.parse(commandParams);
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
                            const patchAttribs = JSON5.parse(commandParams);
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
                let filterStr = filters.filter(f => f.enabled).map(f => JSON.stringify({ ...f.asConfiguration(), enabled: true })).join(',');
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

    /**
     * start a stream of messages for a provided set of filters
     * @param filters - filters to apply
     * @param initialWindow - initial window. usually 0- e.g.1000
     * @param streamData contains the msgs and the sink with the `onNewMessages` and `onDone` callback
     * @returns the streamId. Must be used in a call to 
     * 
     * ```stopMsgsStream(streamId)```
     * 
     * to stop the stream!
     * Must be handed over to changeMsgsStreamWindow to change the window. Afterwards the newly returned streamId must be used!
     */
    startMsgsStream(filters: DltFilter[], initialWindow: [number, number], streamData: StreamMsgData): Promise<number> {
        return new Promise<number>((resolve, reject) => {
            try {
                let filterStr = filters.filter(f => f.enabled).map(f => JSON.stringify({ ...f.asConfiguration(), enabled: true })).join(',');
                this.sendAndRecvAdltMsg(`stream {"window":[${initialWindow[0]},${initialWindow[1]}],"binary":true,"filters": [${filterStr}]}`).then((response) => {
                    console.log(`adlt.streamMessages start stream got response:'${response}'`);
                    const streamObj = JSON.parse(response.substring(11)); // todo parse any better!
                    console.log(`adtl.streamMessages streamObj`, JSON.stringify(streamObj));
                    let curStreamMsgData = this.streamMsgs.get(streamObj.id);
                    this.streamMsgs.set(streamObj.id, streamData);
                    if (curStreamMsgData && Array.isArray(curStreamMsgData)) {
                        // process the data now:
                        curStreamMsgData.forEach((msgs) => this.processBinDltMsgs(msgs, streamObj.id, streamData));
                    }
                    resolve(streamObj.id);
                }).catch(reason => reject(reason));
            } catch (e) {
                reject(e);
            }
        });
    }

    stopMsgsStream(streamId: number): Promise<string> {
        this.streamMsgs.delete(streamId);
        return this.sendAndRecvAdltMsg(`stop ${streamId}`);
    }

    changeMsgsStreamWindow(streamId: number, newWindow: [number, number]): Promise<number> {
        return new Promise<number>((resolve, reject) => {
            let streamData = this.streamMsgs.get(streamId);
            if (!streamData) {
                reject('invalid streamId? no streamData found');
            } else {
                this.sendAndRecvAdltMsg(`stream_change_window ${streamId} ${newWindow[0]},${newWindow[1]}`).then((response) => {
                    const streamObj = JSON.parse(response.slice(response.indexOf("=") + 1));
                    console.log(`adlt.changeMsgsStreamWindow on stream_change_window streamObj: ${JSON.stringify(streamObj)}`);
                    let curStreamMsgData = this.streamMsgs.get(streamObj.id);
                    this.streamMsgs.set(streamObj.id, streamData!);
                    this.streamMsgs.delete(streamId);
                    if (curStreamMsgData && Array.isArray(curStreamMsgData)) {
                        curStreamMsgData.forEach((msgs) => this.processBinDltMsgs(msgs, streamObj.id, streamData as StreamMsgData));
                    }
                    resolve(streamObj.id);
                }).catch(e => reject(e));
            }
        });
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

        console.log("adlt.ADltDocumentProvider adltPath=", adltPath);
        this._adltCommand = vscode.workspace.getConfiguration().get<string>("dlt-logs.adltPath") || ((adltPath !== undefined && typeof adltPath === 'string') ? adltPath : "adlt");
        console.log(`adlt.ADltDocumentProvider using adltCommand='${this._adltCommand}'`);

        if (adltPath !== undefined) {
            // add it to env
            let envCol = context.environmentVariableCollection;
            const adltPathPath = path.dirname(adltPath);
            console.log(`adlt updating env PATH with :'${adltPathPath}'`);
            context.environmentVariableCollection.prepend('PATH', adltPathPath + path.delimiter);
        }

        // config changes
        context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('dlt-logs')) {

                // handle it for the next doc to be opened. Active connection will be interrupted (if non debug port)
                if (e.affectsConfiguration("dlt-logs.adltPath")) {
                    const newCmd = vscode.workspace.getConfiguration().get<string>("dlt-logs.adltPath") || ((adltPath !== undefined && typeof adltPath === 'string') ? adltPath : "adlt");
                    if (newCmd !== this._adltCommand) {
                        console.log(`adlt.ADltDocumentProvider using adltCommand='${this._adltCommand}'`);
                        this._adltCommand = newCmd;
                        this.closeAdltProcess();
                    }
                }

                this._documents.forEach(doc => doc.onDidChangeConfiguration(e));
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
                    const times: Date[] = [];
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

        /* this.timerId = setInterval(() => {
            // dump mem usage:
            const memUsage = process.memoryUsage();
            console.log(`memUsage=${JSON.stringify(memUsage)} adlt #docs=${this._documents.size}`);
        }, 10000);*/
    }
    // private timerId: NodeJS.Timeout;

    dispose() {
        console.log("AdltDocumentProvider dispose() called");
        this._documents.forEach((doc) => doc.dispose());
        this._documents.clear();
        // clearInterval(this.timerId);

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
            case 'setPosFilter': this.modifyNode(node, 'setPosFilter'); break;
            case 'save': if (node.uri !== null && this._documents.get(node.uri.toString()) !== undefined && node.applyCommand) { node.applyCommand(command); } break;
            // todo refactor to always call applyCommand... currently dltDocumentProvider handles it as well!
            default:
                console.error(`adlt.onTreeNodeCommand unknown command '${command}' for node '${node.label}' '${node.uri}'`); break;
        }
    }

    private onDropFilterFrags(node: TreeViewNode | undefined, filterFrags: any[]) {
        if (node !== undefined && node.uri) {
            const doc = this._documents.get(node.uri.toString());
            if (doc !== undefined) {
                const allFilters = doc.allFilters;
                let doApplyFilter = false;
                for (const filterFrag of filterFrags) {
                    // do we have a similar filter already?
                    const similarFilters = DltFilter.getSimilarFilters(false, true, filterFrag, allFilters);
                    if (!similarFilters.length) {
                        let filter = new DltFilter(filterFrag);
                        console.info(`adlt.onDropFilterFrags got a filter: '${filter.name}'`);
                        doc.onFilterAdd(filter, false);
                        doApplyFilter = true;
                    } else {
                        console.info(`adlt.onDropFilterFrags got similar filter: '${similarFilters.map((f) => f.name).join(',')}'`);
                        if (!('enabled' in filterFrag) || ('enabled' in filterFrag && filterFrag.enabled === true)) {
                            // any of the similarFilters enabled yet?
                            if (similarFilters.filter((f) => f.enabled).length === 0) {
                                // enable the first one:
                                similarFilters[0].enabled = true;
                                doApplyFilter = true;
                                console.info(`adlt.onDropFilterFrags enabling similar filter: '${similarFilters[0].name}'`);
                            }
                        }
                    }
                }
                if (doApplyFilter) {
                    doc.triggerApplyFilter();
                    this._onDidChangeTreeData.fire(doc.treeNode); // as filters in config might be impacted as well! 
                }
            } else {
                console.warn(`adlt.onDropFilterFrags found no doc for: '${node.uri.toString()}'`);
            }
        }
    }

    public async onDrop(node: TreeViewNode | undefined, sources: vscode.DataTransfer, token: vscode.CancellationToken) {
        try {
            console.info(`adlt.onDrop (node=${node?.label})`);
            let transferItem = sources.get('text/uri-list');
            if (transferItem !== undefined) {
                transferItem.asString().then((urisString) => {
                    try {
                        let uris = urisString.split(/\r?\n/);
                        console.log(`adlt.onDrop got uris(${uris.length}): '${uris.join(',')}'`);
                        let warnings: string[] = [];;
                        let filterFrags: any[] = [];
                        for (const uri of uris) {
                            if (uri.toLowerCase().endsWith('.dlf')) { // support for dlt-viewer .dlf files
                                console.info(`adlt.onDrop processing uri '${uri}' as dlt-viewer .dlf filter file`);
                                // open the file:
                                let fileContent = fs.readFileSync(fileURLToPath(uri), { encoding: 'utf-8' });
                                let filterFragsOrWarnings = DltFilter.filtersFromXmlDlf(fileContent);
                                console.log(`adlt.onDrop got ${filterFragsOrWarnings.length} filter frags`);
                                for (const filterFrag of filterFragsOrWarnings) {
                                    if (typeof filterFrag === 'string') {
                                        console.warn(`adlt.onDrop filterFrag got warning: '${filterFrag}'`);
                                        warnings.push(filterFrag);
                                    } else {
                                        filterFrags.push(filterFrag);
                                    }
                                }
                            } else {
                                const warning = `ignoring uri '${uri}'}`;
                                console.warn(`adlt.onDrop ${warning}`);
                                warnings.push(warning);
                            }
                        }
                        if (warnings.length) {
                            vscode.window.showWarningMessage(`opening as dlt-viewer filter files got warnings:\n${warnings.join('\n')}`);
                        }
                        if (filterFrags.length) {
                            this.onDropFilterFrags(node, filterFrags);
                        }
                    } catch (e) {
                        console.warn(`adlt.onDrop(urisString='${urisString}') got e='${e}'`);
                    }
                });
            }
        } catch (e) {
            console.warn(`adlt.onDrop got e='${e}'`);
        }
    }

    public onDrag(nodes: readonly TreeViewNode[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken) {
        console.info(`adlt.onDrag (nodes=${nodes.map((n) => n.label || '<no label>').join(',')})`);
        // 'application/vnd.dlt-logs+json'
        // return a json object with "filterFrags":[{frag1},{frag2},...] one frag for each node that reflects a filter
        const jsonObj = { filterFrags: [] as any[] };
        for (let node of nodes) {
            if (node instanceof AdltPluginChildNode) {
                let filters = node.filter;
                filters.forEach((f) => jsonObj.filterFrags.push(f.asConfiguration()));
            } else if (node instanceof FilterNode) {
                // we do remove the enabled:false... as we treat this temporary
                // todo keep id?
                jsonObj.filterFrags.push({ ...node.filter.asConfiguration(), enabled: undefined });
            } else if (node instanceof FilterRootNode) {
                // iterate over all active children:
                for (let child of node.children) {
                    if (child.filter.enabled) {
                        jsonObj.filterFrags.push(child.filter.asConfiguration());
                    }
                }
            } else {
                console.log(`adlt.onDrag: unhandled node=${node.label}`);
            }
        }
        // todo if filterFrags is empty, still set?
        console.info(`adlt.onDrag setting '${JSON.stringify(jsonObj)}' as 'application/vnd.dlt-logs+json')`);
        dataTransfer.set('application/vnd.dlt-logs+json', new vscode.DataTransferItem(jsonObj));
    }

    public onDidClose(doc: ReportDocument) { // doc has been removed already from this._documents!
        if (doc !== undefined && doc instanceof AdltDocument) {
            doc.dispose();
        }
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
                console.log(`adlt-logs.stat(uri=${uri.toString().slice(0, 100)})... isDirectory=${realStat.isDirectory()}}`);
                if (realStat.isFile() && (true /* todo dlt extension */)) {
                    try {
                        let port = this.getAdltProcessAndPort();
                        document = new AdltDocument(port, uri, this._onDidChangeFile, this._onDidChangeTreeData, this._treeRootNodes, this._onDidChangeStatus, this.checkActiveRestQueryDocChanged, this._columns, this._reporter);
                        this._documents.set(uri.toString(), document);
                    } catch (error) {
                        console.log(` adlt-logs.stat(uri=${uri.toString().slice(0, 100)}) returning realStat ${realStat.size} size.`);
                        return {
                            size: realStat.size, ctime: realStat.ctime.valueOf(), mtime: realStat.mtime.valueOf(),
                            type: realStat.isDirectory() ? vscode.FileType.Directory : (realStat.isFile() ? vscode.FileType.File : vscode.FileType.Unknown) // todo symlinks as file?
                        };
                    }
                }
                if (document) {
                    return document.stat();
                } else {
                    console.log(` adlt-logs.stat(uri=${uri.toString().slice(0, 100)}) returning realStat ${realStat.size} size.`);
                    return {
                        size: realStat.size, ctime: realStat.ctime.valueOf(), mtime: realStat.mtime.valueOf(),
                        type: realStat.isDirectory() ? vscode.FileType.Directory : (realStat.isFile() ? vscode.FileType.File : vscode.FileType.Unknown) // todo symlinks as file?
                    };
                }
            }
        } catch (err) {
            console.warn(`adlt-logs.stat(uri=${uri.toString().slice(0, 100)}) got err '${err}'!`);
        }
        return { size: 0, ctime: 0, mtime: 0, type: vscode.FileType.Unknown };
    }

    readFile(uri: vscode.Uri): Uint8Array {
        let doc = this._documents.get(uri.toString());
        console.log(`adlt-logs.readFile(uri=${uri.toString().slice(0, 100)})...`);
        if (!doc) {
            const port = this.getAdltProcessAndPort();
            doc = new AdltDocument(port, uri, this._onDidChangeFile, this._onDidChangeTreeData, this._treeRootNodes, this._onDidChangeStatus, this.checkActiveRestQueryDocChanged, this._columns, this._reporter);
            this._documents.set(uri.toString(), doc);
        }
        return Buffer.from(doc.text);
    }

    watch(uri: vscode.Uri): vscode.Disposable {
        console.log(`adlt-logs.watch(uri=${uri.toString().slice(0, 100)}...`);
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
        console.log(`adlt-logs.readDirectory(uri=${uri.toString().slice(0, 100)}...`);
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
        console.log(` adlt-logs.readDirectory(uri=${uri.toString().slice(0, 100)}) returning ${entries.length} entries.`);
        return entries;
    }

    writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }): void {
        console.log(`adlt-logs.writeFile(uri=${uri.toString().slice(0, 100)}...`);
        throw vscode.FileSystemError.NoPermissions();
    }

    rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): void {
        console.log(`adlt-logs.rename(oldUri=${oldUri.toString().slice(0, 100)}...`);
        throw vscode.FileSystemError.NoPermissions();
    }

    delete(uri: vscode.Uri): void {
        console.log(`adlt-logs.delete(uri=${uri.toString().slice(0, 100)}...`);
        throw vscode.FileSystemError.NoPermissions();
    }

    createDirectory(uri: vscode.Uri): void {
        console.log(`adlt-logs.createDirectory(uri=${uri.toString().slice(0, 100)}...`);
        throw vscode.FileSystemError.NoPermissions();
    }

}
