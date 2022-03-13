/* --------------------
 * Copyright(C) Matthias Behr. 2022
 */

/// todo: major issues before release:

/// [ ] auto load adlt binary
/// [ ] version comparison with adlt
/// [ ] decorations
/// [ ] add/edit filter

/// not mandatory for first release:
/// [ ] opening of multiple dlt files 
/// [ ] apid/ctid tree view
/// [ ] sw version info/support
/// [ ] cache strings for ecu/apid/ctid
/// [ ] someip support (in adlt)
/// [ ] filetransfer support (in adlt)
/// [ ] hover support
/// [ ] jump to time/log
/// [ ] onDidChangeConfiguration
/// [ ] timeSync support

/// [x] sort order support
/// by default logs are sorted by timestamp. If the sort order is toggled the file is closed and reopened.
/// this can be weird/confusing with real streams.
/// and one side effect is that any lifecycle filters are automatically disabled (as the lc.ids are not persisted across close/open)

import * as vscode from 'vscode';
import TelemetryReporter from 'vscode-extension-telemetry';
import * as fs from 'fs';
import * as WebSocket from 'ws';
import * as util from './util';
import * as path from 'path';
import { DltFilter, DltFilterType } from './dltFilter';
import { DltReport, NewMessageSink } from './dltReport';
import { FilterableDltMsg, ViewableDltMsg, MSTP, MTIN_CTRL } from './dltParser';
import { DltLifecycleInfoMinIF, DltLifecycleInfo } from './dltLifecycle';
import { TreeViewNode, FilterNode, LifecycleRootNode, LifecycleNode, FilterRootNode } from './dltTreeViewNodes';

import * as remote_types from './remote_types';
import { DltDocument, ColumnConfig } from './dltDocument';

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

    constructor(binLc: remote_types.BinLifecycle) {
        this.ecu = char4U32LeToString(binLc.ecu);
        this.id = binLc.id;
        this.nrMsgs = binLc.nr_msgs;
        this.startTime = Number(binLc.start_time / 1000n); // start time in ms
        this.endTime = Number(binLc.end_time / 1000n); // end time in ms
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
        return `SW:${/*this._swVersions.join(',')*/"nyi for adlt"}`;
    }

    get swVersions(): string[] {
        return []; // todo
    }

}

interface AdltMsg extends ViewableDltMsg {
}

interface StreamMsgData {
    msgs: AdltMsg[],
    sink: NewMessageSink
};


export class AdltDocument implements vscode.Disposable {
    private realStat: fs.Stats;
    private webSocket: WebSocket;
    private webSocketIsConnected = false;

    private streamId: number = 0; // 0 none, neg stop in progress. stream for the messages that reflect the main log/view
    private visibleMsgs?: AdltMsg[]; // the array with the msgs that should be shown. set on startStream and cleared on stopStream
    private _maxNrMsgs: number; //  setting 'dlt-logs.maxNumberLogs'. That many messages are displayed at once
    private _skipMsgs: number = 0; // that many messages are skipped from the top (here not loaded for cur streamId)

    private _sortOrderByTime = true; // we default to true // todo retrieve last from config?

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
    pluginTreeNode: TreeViewNode; // this is from the parent = DltDocumentProvider
    pluginNodes: TreeViewNode[] = [];

    private _treeEventEmitter: vscode.EventEmitter<TreeViewNode | null>;

    // lifecycles:
    lifecycles = new Map<string, DltLifecycleInfoMinIF[]>();
    lifecyclesByPersistentId = new Map<number, DltLifecycleInfoMinIF>();

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
            let msg = {
                index: binMsg.index,
                receptionTimeInMs: Number(binMsg.reception_time),
                timeStamp: binMsg.timestamp_dms,
                ecu: char4U32LeToString(binMsg.ecu), // todo from map...
                apid: char4U32LeToString(binMsg.apid),
                ctid: char4U32LeToString(binMsg.ctid),
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

    constructor(public uri: vscode.Uri, private emitDocChanges: vscode.EventEmitter<vscode.FileChangeEvent[]>, treeEventEmitter: vscode.EventEmitter<TreeViewNode | null>,
        parentTreeNode: TreeViewNode[], private _columns: ColumnConfig[], reporter?: TelemetryReporter) {

        this._treeEventEmitter = treeEventEmitter;

        // todo add support for multiple uris encoded...
        const fileUri = uri.with({ scheme: "file" });

        if (!fs.existsSync(fileUri.fsPath)) {
            throw Error(`AdltDocument file ${fileUri.fsPath} doesn't exist!`);
        }
        this.realStat = fs.statSync(fileUri.fsPath);

        // configuration:
        const maxNrMsgsConf = vscode.workspace.getConfiguration().get<number>('dlt-logs.maxNumberLogs');
        this._maxNrMsgs = maxNrMsgsConf ? maxNrMsgsConf : 400000; // 400k default
        this._maxNrMsgs = 1000; // todo for testing only

        this.text = `Loading adlt document from uri=${fileUri.toString()} with max ${this._maxNrMsgs} msgs per page...`;

        // connect to adlt via websocket:
        const url = "ws://localhost:6665";
        this.webSocket = new WebSocket(url, [], { perMessageDeflate: false, origin: "adlt-logs" }); // todo maxPayload
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
        this.webSocket.on('open', () => {
            this.webSocketIsConnected = true;
            this.openAdltFiles();
        });

        this.webSocket.on('close', () => {
            this.webSocketIsConnected = false;
            this.emitDocChanges.fire([{ type: vscode.FileChangeType.Changed, uri: this.uri }]);
        });
        this.webSocket.on('error', (err) => {
            console.warn(`dlt-logs.AdltDocumentProvider.on(error) wss got error:`, err);
            this.webSocketIsConnected = false;
            this.emitDocChanges.fire([{ type: vscode.FileChangeType.Changed, uri: this.uri }]);
        });

        // update tree view:
        this.lifecycleTreeNode = new LifecycleRootNode(this);
        this.filterTreeNode = new FilterRootNode(this.uri);
        //this.configTreeNode = { id: util.createUniqueId(), label: "Configs", uri: this.uri, parent: null, children: [], tooltip: undefined, iconPath: new vscode.ThemeIcon('references') };
        this.pluginTreeNode = { id: util.createUniqueId(), label: "Plugins", uri: this.uri, parent: null, children: [], tooltip: undefined, iconPath: new vscode.ThemeIcon('package') };

        this.treeNode = {
            id: util.createUniqueId(),
            label: `${path.basename(fileUri.fsPath)}`, uri: this.uri, parent: null, children: [
                this.lifecycleTreeNode,
                this.filterTreeNode,
                //      this.configTreeNode,
                this.pluginTreeNode,
            ],
            tooltip: undefined,
            iconPath: new vscode.ThemeIcon('file')
        };
        parentTreeNode.push(this.treeNode);

        this.timerId = setInterval(() => {
            this.checkTextUpdates(); // todo this might not be needed at all!
        }, 1000);

        // todo add a static report filter for testing:
        this.onFilterAdd(new DltFilter({ type: DltFilterType.EVENT, payloadRegex: "(?<STATE_error>error)", name: "test report" }, false), false);
    }

    dispose() {
        console.log(`AdltDocument.dispose()`);
        clearInterval(this.timerId);
        this.closeAdltFiles().catch((reason) => {
            console.log(`AdltDocument.dispose closeAdltFiles failed with '${reason}'`);
        });
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
        this.webSocket.send(req, (err) => {
            if (err) {
                console.warn(`dlt-logs.AdltDocumentProvider.sendAndRecvAdltMsg wss got error:`, err);
                this.webSocketIsConnected = false;
                this.emitDocChanges.fire([{ type: vscode.FileChangeType.Changed, uri: this.uri }]);
            }
        });
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

    openAdltFiles() {
        const fileUri = this.uri.with({ scheme: "file" });
        this.sendAndRecvAdltMsg(`open {"sort":${this._sortOrderByTime},"files":["${fileUri.fsPath}"]}`).then((response) => {
            console.log(`adlt.on open got response:'${response}'`);
            if (!this.isLoaded) {
                this.isLoaded = true;
                this._onDidLoad.fire(this.isLoaded);
            }
            this.startStream();
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
        let filterStr = this.allFilters.filter(f => !f.isReport).map(f => JSON.stringify(f.asConfiguration())).join(',');
        this.sendAndRecvAdltMsg(`stream {"window":[${this._skipMsgs},${this._skipMsgs + this._maxNrMsgs}], "binary":true, "filters":[${filterStr}]}`).then((response) => {
            console.log(`adlt.on startStream got response:'${response}'`);
            const streamObj = JSON.parse(response.substring(11));
            console.log(`adtl ok:stream`, JSON.stringify(streamObj));
            this.streamId = streamObj.id;
            this.text = "";
            this.visibleMsgs = [];
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
                    if (nrNewMsgs) {
                        DltDocument.textLinesForMsgs(doc._columns, viewMsgs, viewMsgs.length - nrNewMsgs, viewMsgs.length - 1, 8 /*todo*/, undefined).then((newTxt: string) => {
                            doc.text += newTxt;
                            doc.emitDocChanges.fire([{ type: vscode.FileChangeType.Changed, uri: doc.uri }]);
                            console.log(`adlt.onNewMessages(${nrNewMsgs}) triggered doc changes.`);
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
            let filterStr = filters.map(f => JSON.stringify(f.asConfiguration())).join(',');
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
    lineCloseToDate(date: Date): number {
        // ideas:
        // a) we recv already msgs incl the info for time, lifecycle from adlt
        return -1; // todo
    }

    msgByLine(line: number): AdltMsg | undefined {
        let msgs = this.visibleMsgs;
        if (msgs && line < msgs.length) {
            return msgs[line];
        }
        return undefined;
    }

    public provideHover(position: vscode.Position): vscode.ProviderResult<vscode.Hover> {
        if (position.character > 21) { return; } // we show hovers only at the begin of the line
        const msg = this.msgByLine(position.line);
        if (!msg) { return; }

        return new vscode.Hover(new vscode.MarkdownString(`todo impl provideHover\n- index: ${msg.index}\n- ecu: ${msg.ecu}`));
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
        item.tooltip = `DLT: ${this.uri.fsPath}, showing max ${this._maxNrMsgs} msgs, ${0/*this._timeAdjustMs / 1000*/}s time-adjust, ${0 /* todo this.timeSyncs.length*/} time-sync events, ${nrEnabledFilters}/${nrAllFilters} enabled filters, sorted by ${this._sortOrderByTime ? 'time' : 'index'}`;
        } else {
            item.text = "adlt not con!";
            item.tooltip = `DLT: ${this.uri.fsPath}, not connected to adlt via websocket!`;
        }
    }


    processFileInfoUpdates(fileInfo: remote_types.BinFileInfo) {
        console.log(`adlt fileInfo: nr_msgs=${fileInfo.nr_msgs}`);
        this.fileInfoNrMsgs = fileInfo.nr_msgs;
        // todo handle info e.g. with status bar
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
            let sw: string[] = [];
            let ecuNode: TreeViewNode = { id: util.createUniqueId(), label: `ECU: ${ecu}, SW${sw.length > 1 ? `(${sw.length}):` : `:`} ${sw.join(' and ')}`, parent: this.lifecycleTreeNode, children: [], uri: this.uri, tooltip: undefined };
            this.lifecycleTreeNode.children.push(ecuNode);

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
                ecuNode.children.push(new LifecycleNode(this.uri.with({ fragment: "0" /*todo lc.startIndex.toString()*/ }), ecuNode, this.lifecycleTreeNode, lcInfo, i + 1));
            });
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
                                                        msgs: 1 /* todo lc.logMessages.length*/,
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
                let filterStr = filters.map(f => JSON.stringify(f.asConfiguration())).join(',');
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

    constructor(context: vscode.ExtensionContext, private _dltLifecycleTreeView: vscode.TreeView<TreeViewNode>, private _treeRootNodes: TreeViewNode[], private _onDidChangeTreeData: vscode.EventEmitter<TreeViewNode | null>,
        private checkActiveRestQueryDocChanged: () => boolean, private _columns: ColumnConfig[], private _reporter?: TelemetryReporter) {
        console.log(`dlt-logs.AdltDocumentProvider()...`);

        this._subscriptions.push(vscode.workspace.onDidOpenTextDocument((event: vscode.TextDocument) => {
            const uriStr = event.uri.toString();
            console.log(`AdltDocumentProvider onDidOpenTextDocument uri=${uriStr}`);
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

        /*context.subscriptions.push(vscode.commands.registerTextEditorCommand('dlt-logs.toggleSortOrder', async (textEditor: vscode.TextEditor) => {
            console.log(`dlt-logs.adlDocumentProvider.toggleSortOrder(textEditor.uri = ${textEditor.document.uri.toString()}) called...`);
            const doc = this._documents.get(textEditor.document.uri.toString());
            if (doc) {
                console.log(`dlt-logs.adlDocumentProvider.toggleSortOrder for doc:`);
                //todo return doc.toggleSortOrder();
            }
        }));*/

        context.subscriptions.push(vscode.languages.registerHoverProvider({ scheme: "adlt-log" }, this));
    }

    dispose() {
        console.log("AdltDocumentProvider dispose() called");
        this._documents.forEach((doc) => doc.dispose());
        this._documents.clear();

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
            default:
                console.error(`adlt.onTreeNodeCommand unknown command '${command}'`); break;
        }
    }

    // filesystem provider api:
    get onDidChangeFile() {
        return this._onDidChangeFile.event;
    }
    stat(uri: vscode.Uri): vscode.FileStat {

        let document = this._documents.get(uri.toString());
        const fileUri = uri.with({ scheme: 'file' });
        const realStat = fs.statSync(uri.fsPath);
        console.log(`adlt-logs.stat(uri=${uri.toString()})... isDirectory=${realStat.isDirectory()}}`);
        if (!document && realStat.isFile() && (true /* todo dlt extension */)) {
            try {
                document = new AdltDocument(uri, this._onDidChangeFile, this._onDidChangeTreeData, this._treeRootNodes, this._columns, this._reporter);
                this._documents.set(uri.toString(), document);
                if (this._documents.size === 1) {
                    // this.checkActiveRestQueryDocChanged();
                }
            } catch (error) {
                console.log(` dlt-logs.stat(uri=${uri.toString()}) returning realStat ${realStat.size} size.`);
                return {
                    size: realStat.size, ctime: realStat.ctime.valueOf(), mtime: realStat.mtime.valueOf(),
                    type: realStat.isDirectory() ? vscode.FileType.Directory : (realStat.isFile() ? vscode.FileType.File : vscode.FileType.Unknown) // todo symlinks as file?
                };
            }
        }
        if (document) {
            return document.stat();
        } else {
            console.log(` dlt-logs.stat(uri=${uri.toString()}) returning realStat ${realStat.size} size.`);
            return {
                size: realStat.size, ctime: realStat.ctime.valueOf(), mtime: realStat.mtime.valueOf(),
                type: realStat.isDirectory() ? vscode.FileType.Directory : (realStat.isFile() ? vscode.FileType.File : vscode.FileType.Unknown) // todo symlinks as file?
            };
        }
    }

    readFile(uri: vscode.Uri): Uint8Array {
        let doc = this._documents.get(uri.toString());
        console.log(`adlt-logs.readFile(uri=${uri.toString()})...`);
        if (!doc) {
            doc = new AdltDocument(uri, this._onDidChangeFile, this._onDidChangeTreeData, this._treeRootNodes, this._columns, this._reporter);
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
        console.log(`dlt-logs.readDirectory(uri=${uri.toString()}...`);
        let entries: [string, vscode.FileType][] = [];
        // list all dirs and dlt files:
        const dirEnts = fs.readdirSync(uri.fsPath, { withFileTypes: true });
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
