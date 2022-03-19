/* --------------------
 * Copyright(C) Matthias Behr.
 */


import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as util from './util';
import { extensionId } from './constants';
import { DltDocument, ColumnConfig } from './dltDocument';
import TelemetryReporter from 'vscode-extension-telemetry';
import { DltFilter } from './dltFilter';
import { DltFileTransfer } from './dltFileTransfer';
import { TreeViewNode, FilterNode } from './dltTreeViewNodes';

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

export interface TimeSyncData {
    time: Date,
    id: string,
    value: string,
    prio: number
};

export interface SelectedTimeData {
    time: Date;
    uri: vscode.Uri;
    timeSyncs?: Array<TimeSyncData>; // these are not specific to a selected line. Time will be 0 then.
};

export class DltDocumentProvider implements vscode.FileSystemProvider,
    vscode.DocumentSymbolProvider, vscode.Disposable {
    private _reporter?: TelemetryReporter;
    private _subscriptions: Array<vscode.Disposable> = new Array<vscode.Disposable>();

    private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    public _documents = new Map<string, DltDocument>();
    get onDidChangeFile() {
        return this._onDidChangeFile.event;
    }

    private _didSubscribeLifecycleTreeView = false;

    private _didChangeSelectedTimeSubscriptions: Array<vscode.Disposable> = new Array<vscode.Disposable>();
    private _onDidChangeSelectedTime: vscode.EventEmitter<SelectedTimeData> = new vscode.EventEmitter<SelectedTimeData>();
    readonly onDidChangeSelectedTime: vscode.Event<SelectedTimeData> = this._onDidChangeSelectedTime.event;
    private _autoTimeSync = false; // todo config

    constructor(context: vscode.ExtensionContext, private _dltLifecycleTreeView: vscode.TreeView<TreeViewNode>, private _treeRootNodes: TreeViewNode[], private _onDidChangeTreeData: vscode.EventEmitter<TreeViewNode | null>,
        private checkActiveRestQueryDocChanged: () => boolean, private _columns: ColumnConfig[], reporter?: TelemetryReporter) {
        console.log(`dlt-logs.DltDocumentProvider()...`);
        this._reporter = reporter;
        this._subscriptions.push(vscode.workspace.onDidOpenTextDocument((event: vscode.TextDocument) => {
            const uriStr = event.uri.toString();
            //console.log(`DltDocumentProvider onDidOpenTextDocument uri=${uriStr}`);
            // is it one of our documents?
            const doc = this._documents.get(uriStr);
            if (doc) {
                const newlyOpened: boolean = (doc.textDocument) ? false : true;
                console.log(` dlt.logs.onDidOpenTextDocument: found document with uri=${uriStr} newlyOpened=${newlyOpened}`);
                if (newlyOpened) {
                    doc.textDocument = event;
                    if (!this._didSubscribeLifecycleTreeView) {
                        this._didSubscribeLifecycleTreeView = true;
                        this._subscriptions.push(this._dltLifecycleTreeView.onDidChangeSelection(event => {
                            if (event.selection.length && event.selection[0].uri && event.selection[0].uri.fragment.length) {
                                console.log(`dltLifecycleTreeView.onDidChangeSelection(${event.selection.length} ${event.selection[0].uri} fragment='${event.selection[0].uri ? event.selection[0].uri.fragment : ''}')`);
                                // find the editor for this uri in active docs:
                                let uriWoFrag = event.selection[0].uri.with({ fragment: "" }).toString();
                                const activeTextEditors = vscode.window.visibleTextEditors;
                                for (let ind = 0; ind < activeTextEditors.length; ++ind) {
                                    const editor = activeTextEditors[ind];
                                    const editorUri = editor.document.uri.toString();
                                    if (editor && uriWoFrag === editorUri) {
                                        let doc = this._documents.get(editorUri);
                                        if (doc) {
                                            const index = +(event.selection[0].uri.fragment);
                                            console.log(`  revealing ${event.selection[0].uri} index ${index}`);
                                            let willBeLine = doc.revealIndex(index);
                                            console.log(`   revealIndex returned willBeLine=${willBeLine}`);
                                            if (willBeLine >= 0) {
                                                editor.revealRange(new vscode.Range(willBeLine, 0, willBeLine + 1, 0), vscode.TextEditorRevealType.AtTop);
                                            }
                                        }
                                    }
                                }

                            }
                        }));
                    }
                    this._onDidChangeTreeData.fire(null);
                }
            }
        }));

        // check for changes of the documents
        this._subscriptions.push(vscode.workspace.onDidChangeTextDocument(async (event) => {
            let uriStr = event.document.uri.toString();
            // console.log(`DltDocumentProvider onDidChangeTextDocument uri=${uriStr}`);
            let data = this._documents.get(uriStr);
            if (data) {
                this._onDidChangeTreeData.fire(data.treeNode);
                /*
                    console.log(`dltDocProv.onDidChangeTextDocument reveal called for treeNode=${data.treeNode.label}`);
                    this._dltLifecycleTreeView.reveal(data.treeNode, { select: false, focus: false, expand: true }).then(() => {
                        console.log(`dltDocProv.onDidChangeTextDocument reveal done.`);
                    });*/
                // this.updateDecorations(data);
                // time sync events?
                if (data.timeSyncs.length) {
                    console.log(`dlt-logs.onDidChangeTextDocument broadcasting ${data.timeSyncs.length} time-syncs.`);
                    this._onDidChangeSelectedTime.fire({ time: new Date(0), uri: data.uri, timeSyncs: data.timeSyncs });
                }
                /* todo if (this._statusBarItem) {
                    data.updateStatusBarItem(this._statusBarItem);
                }*/
            }
        }));

        // todo doesn't work with skipped msgs... this._subscriptions.push(vscode.languages.registerDocumentSymbolProvider('dlt-log', this, { label: "DLT Lifecycles" }));

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
                            if (this._autoTimeSync) {
                                // post time update...
                                console.log(` dlt-log posting time update ${time.toLocaleTimeString()}.${String(time.valueOf() % 1000).padStart(3, "0")}`);
                                this._onDidChangeSelectedTime.fire({ time: time, uri: data.uri });
                            }
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

        this._subscriptions.push(vscode.commands.registerTextEditorCommand("dlt-logs.sendTime", async (textEditor) => {
            console.log(`dlt-log.sendTime for ${textEditor.document.uri.toString()} called...`);
            let data = this._documents.get(textEditor.document.uri.toString());
            if (data) {
                // ev.kind: 1: Keyboard, 2: Mouse, 3: Command
                //console.log(`smart-log.onDidChangeTextEditorSelection doc=${data.doc.uri.toString()} ev.kind=${ev.kind} #selections=${ev.selections.length}`);
                // we do only take single selections.
                if (textEditor.selections.length === 1) {
                    const line = textEditor.selections[0].active.line; // 0-based
                    const time = data.provideTimeByLine(line);
                    if (time) {
                        // post time update...
                        console.log(` dlt-log posting time update ${time.toLocaleTimeString()}.${String(time.valueOf() % 1000).padStart(3, "0")}`);
                        this._onDidChangeSelectedTime.fire({ time: time, uri: data.uri });
                    }
                }
            }
        }));

        this._subscriptions.push(vscode.commands.registerCommand("dlt-logs.toggleTimeSync", () => {
            console.log(`dlt-log.toggleTimeSync called...`);
            this._autoTimeSync = !this._autoTimeSync;
            vscode.window.showInformationMessage(`Auto time-sync turned ${this._autoTimeSync ? "on. Selecting a line will send the corresponding time." : "off. To send the time use the context menu 'send selected time' command."}`);
        }));

        this._subscriptions.push(vscode.commands.registerTextEditorCommand("dlt-logs.sendTimeSyncEvents", async (textEditor) => {
            let data = this._documents.get(textEditor.document.uri.toString());
            if (data) {
                console.log(`dlt-log.sendTimeSyncEvents for ${textEditor.document.uri.toString()} sending ${data.timeSyncs.length} events`);
                this._onDidChangeSelectedTime.fire({ time: new Date(0), uri: data.uri, timeSyncs: data.timeSyncs });
            }
        }));

        // register command for adjustTime
        this._subscriptions.push(vscode.commands.registerTextEditorCommand("dlt-logs.adjustTime", async (textEditor) => {
            console.log(`dlt-logs.adjustTime for ${textEditor.document.uri.toString()} called...`);
            let doc = this._documents.get(textEditor.document.uri.toString());
            if (doc) {
                let curAdjustMs: number = doc.timeAdjustMs;

                // check first whether we shall use the last received time event?
                // we do this only if we didn't receive any timeSyncs (assuming that the next one will auto update anyhow so it makes no sense to change man.)
                let doManualPrompt = true;
                if (!doc.gotTimeSyncEvents && doc.lastSelectedTimeEv) {
                    // determine current selected time:
                    if (textEditor.selections.length === 1) {
                        const line = textEditor.selections[0].active.line; // 0-based
                        const time = doc.provideTimeByLine(line);
                        if (time) {
                            // calc adjust value:
                            let selTimeAdjustValue = doc.lastSelectedTimeEv.valueOf() - time.valueOf();
                            let response: string | undefined =
                                await vscode.window.showInformationMessage(`Adjust based on last received time event (adjust by ${selTimeAdjustValue / 1000} secs)?`,
                                    { modal: true }, "yes", "no");
                            if (response === "yes") {
                                doManualPrompt = false;
                                doc.adjustTime(selTimeAdjustValue);
                                if (doc.timeSyncs.length) {
                                    this._onDidChangeSelectedTime.fire({ time: new Date(0), uri: doc.uri, timeSyncs: doc.timeSyncs });
                                }
                            } else if (!response) {
                                doManualPrompt = false;
                            }
                        }
                    }
                }
                if (doManualPrompt) {
                    vscode.window.showInputBox({ prompt: `Enter new time adjust in secs (cur = ${curAdjustMs / 1000}):`, value: (curAdjustMs / 1000).toString() }).then(async (value: string | undefined) => {
                        if (value && doc) {
                            let newAdjustMs: number = (+value) * 1000;
                            doc.adjustTime(newAdjustMs - curAdjustMs);
                            if (doc.timeSyncs.length) {
                                this._onDidChangeSelectedTime.fire({ time: new Date(0), uri: doc.uri, timeSyncs: doc.timeSyncs });
                            }
                        }
                    });
                }
            }
        }));

        // visible range
        this._subscriptions.push(vscode.window.onDidChangeTextEditorVisibleRanges(util.throttle((e) => {
            if (e.visibleRanges.length === 1) {
                const doc = this._documents.get(e.textEditor.document.uri.toString());
                if (doc) {
                    // console.log(`dlt-log.onDidChangeTextEditorVisibleRanges(${e.visibleRanges[0].start.line}-${e.visibleRanges[0].end.line})`);
                    doc.notifyVisibleRange(e.visibleRanges[0]);
                }
            }
        }, 200)));

        // hover provider:
        this._subscriptions.push(vscode.languages.registerHoverProvider({ scheme: "dlt-log" }, this));

        // config changes
        context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('dlt-logs')) {
                //console.warn(`dlt-logs.onDidChangeConfiguration(e.affects('dlt-logs')) called...`);
                // pass it to all documents:
                this._documents.forEach(doc => doc.onDidChangeConfiguration(e));
            }
        }));

        context.subscriptions.push(vscode.commands.registerCommand('dlt-logs.fileTransferSave', async (...args: any[]) => {
            const fileTransfer = <DltFileTransfer>args[0];
            if (fileTransfer && fileTransfer.isComplete) {
                let newFileUri = fileTransfer.uri.with({ path: path.join(path.dirname(fileTransfer.uri.fsPath), fileTransfer.fileName) });
                return vscode.window.showSaveDialog({ defaultUri: newFileUri, filters: { 'all': ['*'] }, saveLabel: 'Save file as' }).then( // todo defaultUri from config?
                    async (uri: vscode.Uri | undefined) => {
                        if (uri) {
                            try {
                                fileTransfer.saveAs(uri);
                            } catch (err) {
                                return vscode.window.showErrorMessage(`Save file failed with error:'${err}'`);
                            }
                        }
                    }
                );
            }
        }));

        // time-sync feature: check other extensions for api onDidChangeSelectedTime and connect to them.
        // we do have to connect to ourself as well (in case of multiple smart-logs docs)
        this._subscriptions.push(vscode.extensions.onDidChange(() => {
            setTimeout(() => {
                console.log(`dlt-log.extensions.onDidChange #ext=${vscode.extensions.all.length}`);
                this.checkActiveExtensions();
            }, 1500); // delay a bit. introduces a possible race on time-sync event reception. todo
        }));
        setTimeout(() => {
            this.checkActiveExtensions();
        }, 2000);
    };



    private async modifyNode(node: TreeViewNode, command: string) {
        const treeviewNode = node;
        const parentUri = treeviewNode.parent?.uri; // why from parent?
        if (parentUri) {
            const doc = this._documents.get(parentUri.toString());
            if (doc) {
                console.log(`${command} Filter(${treeviewNode.label}) called for doc=${parentUri}`);
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
                console.error(`dlt.onTreeNodeCommand unknown command '${command}'`); break;
        }
    }

    public provideHover(doc: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.Hover> {
        const data = this._documents.get(doc.uri.toString());
        if (!data) {
            return;
        }
        return data.provideHover(position);
    }

    // document symbols are shown in "outline" and provide the goto feature. currently vscode supports no context menus yet for outline (https://github.com/microsoft/vscode/issues/49925)
    provideDocumentSymbols(doc: vscode.TextDocument): vscode.ProviderResult<vscode.SymbolInformation[] | vscode.DocumentSymbol[]> {
        console.log(`DltDocumentProvider.provideDocumentSymbols= ${doc.uri.toString()}`);
        const dltDoc = this._documents.get(doc.uri.toString());
        if (!dltDoc) {
            return [];
        } else {
            try {
                // add the lifecycles to the outline:
                const lifecycleInfos = dltDoc.lifecycles;

                let ecus: vscode.DocumentSymbol = new vscode.DocumentSymbol("ECUs", "Detected ECUs within that dlt-log", vscode.SymbolKind.Null, new vscode.Range(0, 0, 0, 0), new vscode.Range(0, 0, 0, 0));
                lifecycleInfos.forEach((lcInfos, strEcu) => {
                    let ecu: vscode.DocumentSymbol = new vscode.DocumentSymbol(strEcu, `Lifecycles for ${strEcu}`, vscode.SymbolKind.Enum, new vscode.Range(0, 0, 0, 0), new vscode.Range(0, 0, 0, 0)); // todo could use first and last line here

                    ecus.children.push(ecu);
                    lcInfos.forEach((lcInfo) => { // todo change into for loop
                        let startLine = dltDoc.lineCloseTo(lcInfo.startIndex); // todo needs to be adapted for skippedMsgs...
                        let lc: vscode.DocumentSymbol = new vscode.DocumentSymbol(`${lcInfo.lifecycleStart.toTimeString()}-${lcInfo.lifecycleEnd.toTimeString()}}`,
                            `${lcInfo.logMessages.length} msgs, start index=${lcInfo.startIndex}`, vscode.SymbolKind.EnumMember, new vscode.Range(startLine, 0, startLine, 0), new vscode.Range(startLine, 0, startLine, 0)); // todo could use first and last line here
                        ecu.children.push(lc);
                    });
                });

                let lifecycles: vscode.DocumentSymbol = new vscode.DocumentSymbol("lifecycle 1", "detail bla fooo", vscode.SymbolKind.Event, new vscode.Range(5, 0, 20, 0), new vscode.Range(5, 0, 6, 0));
                /*
                // todo impl errors.
                let errors: vscode.DocumentSymbol = new vscode.DocumentSymbol("errors", "list of error msgs", vscode.SymbolKind.Event, new vscode.Range(5, 0, 20, 0), new vscode.Range(5, 0, 6, 0));
                let di2a: vscode.DocumentSymbol = new vscode.DocumentSymbol("todo! bla foo failed!", "detail bla fooo", vscode.SymbolKind.Event, new vscode.Range(5, 0, 20, 0), new vscode.Range(5, 0, 6, 0));
                errors.children.push(di2a); */
                return [ecus.children.length === 1 ? ecus.children[0] : ecus]; // , errors];
            } catch (error) {
                console.log(`provideDocumentSymbols err ${error}`);
                return [];
            }
        }
    }



    dispose() {
        console.log("DltDocumentProvider dispose() called");
        this._documents.clear(); // todo have to dispose more? check in detail...
        this._didChangeSelectedTimeSubscriptions.forEach((value) => {
            if (value !== undefined) {
                value.dispose();
            }
        });

        this._subscriptions.forEach((value) => {
            if (value !== undefined) {
                value.dispose();
            }
        });
    }

    handleDidChangeSelectedTime(ev: SelectedTimeData) {
        this._documents.forEach((doc) => {
            if (doc.uri.toString() !== ev.uri.toString()) { // avoid reacting on our own events...
                console.log(`dlt-log.handleDidChangeSelectedTime got ev from uri=${ev.uri.toString()}`);
                if (ev.time.valueOf() > 0) {
                    console.log(` trying to reveal ${ev.time.toLocaleTimeString()} at doc ${doc.uri.toString()}`);
                    // store the last received time to be able to us this for the adjustTime command as reference:
                    doc.lastSelectedTimeEv = ev.time;

                    let line = doc.lineCloseToDate(ev.time);
                    if (line >= 0 && doc.textEditors.length > 0) {
                        const posRange = new vscode.Range(line, 0, line, 0);
                        doc.textEditors.forEach((value) => {
                            value.revealRange(posRange, vscode.TextEditorRevealType.AtTop);
                            // todo add/update decoration as well
                        });
                    } else {
                        if (line >= 0) {
                            console.log(`dlt-log.handleDidChangeSelectedTime got no textEditors (${doc.textEditors.length}) for reveal of line ${line}. hidden?`);
                        }
                    }
                }
                if (ev.timeSyncs?.length && doc.timeSyncs.length) {
                    console.log(` got ${ev.timeSyncs.length} timeSyncs from ${ev.uri.toString()}`);
                    // todo auto timesync... 
                    let adjustTimeBy: number[] = [];
                    let reBroadcastEvents: TimeSyncData[] = [];
                    // compare with our known timesyncs.
                    for (let i = 0; i < ev.timeSyncs.length; ++i) {
                        const remoteSyncEv = ev.timeSyncs[i];
                        console.log(`  got id='${remoteSyncEv.id}' with value='${remoteSyncEv.value} at ${remoteSyncEv.time.toLocaleTimeString()}`);
                        // do we have this id? (optimize with maps... for now linear (search))
                        for (let j = 0; j < doc.timeSyncs.length; ++j) {
                            const localSyncEv = doc.timeSyncs[j];
                            if (remoteSyncEv.id === localSyncEv.id) {
                                console.log(`  got id='${remoteSyncEv.id}' match. Checking value='${remoteSyncEv.value} at ${remoteSyncEv.time.toLocaleTimeString()}`);
                                if (remoteSyncEv.value === localSyncEv.value) {
                                    console.log(`   got id='${remoteSyncEv.id}',prio=${remoteSyncEv.prio} and value='${remoteSyncEv.value} match at ${remoteSyncEv.time.toLocaleTimeString()}, prio=${localSyncEv.prio}`);
                                    // if the received prio is lower we adjust our time... // todo consider 3 documents...
                                    // otherwise we broadcast all values with a lower prio than the current received ones...
                                    if (remoteSyncEv.prio < localSyncEv.prio) {
                                        adjustTimeBy.push(remoteSyncEv.time.valueOf() - localSyncEv.time.valueOf());
                                    } else if (remoteSyncEv.prio > localSyncEv.prio) {
                                        reBroadcastEvents.push(localSyncEv);
                                    }
                                }
                            }
                        }
                    }
                    if (adjustTimeBy.length) {
                        const minAdjust = Math.min(...adjustTimeBy);
                        const maxAdjust = Math.max(...adjustTimeBy);
                        const avgAdjust = adjustTimeBy.reduce((a, b) => a + b, 0) / adjustTimeBy.length;
                        console.log(`have ${adjustTimeBy.length} time adjustments with min=${minAdjust}, max=${maxAdjust}, avg=${avgAdjust} ms.`);
                        if (Math.abs(avgAdjust) > 100) {
                            doc.gotTimeSyncEvents = true;
                            doc.adjustTime(avgAdjust);
                        }
                    } else
                        if (reBroadcastEvents.length) {
                            console.log(`re-broadcasting ${reBroadcastEvents.length} time syncs via onDidChangeSelectedTime`);
                            this._onDidChangeSelectedTime.fire({ time: new Date(0), uri: doc.uri, timeSyncs: reBroadcastEvents });
                        }

                }
            }
        });
    }

    checkActiveExtensions() {
        this._didChangeSelectedTimeSubscriptions.forEach(v => v?.dispose());
        this._didChangeSelectedTimeSubscriptions = [];
        let newSubs = new Array<vscode.Disposable>();

        vscode.extensions.all.forEach((value) => {
            if (value.isActive) {
                // console.log(`dlt-log:found active extension: id=${value.id}`);// with #exports=${value.exports.length}`);
                try {
                    let importedApi = value.exports;
                    if (importedApi !== undefined) {
                        let subscr = importedApi.onDidChangeSelectedTime(async (ev: SelectedTimeData) => {
                            this.handleDidChangeSelectedTime(ev);
                        });
                        if (subscr !== undefined) {
                            console.log(`dlt-log.got onDidChangeSelectedTime api from ${value.id}`);
                            newSubs.push(subscr);
                        }
                    }
                } catch (error) {
                    console.log(`dlt-log:extension ${value.id} throws: ${error}`);
                }
            }
        });
        this._didChangeSelectedTimeSubscriptions = newSubs;
        console.log(`dlt-log.checkActiveExtensions: got ${this._didChangeSelectedTimeSubscriptions.length} subscriptions.`);
    }

    // filesystem provider api:
    stat(uri: vscode.Uri): vscode.FileStat {

        let document = this._documents.get(uri.toString());
        const fileUri = uri.with({ scheme: 'file' });
        const realStat = fs.statSync(uri.fsPath);
        console.log(`dlt-logs.stat(uri=${uri.toString()})... isDirectory=${realStat.isDirectory()}}`);
        if (!document && realStat.isFile() && (true /* todo dlt extension */)) {
            try {
                document = new DltDocument(uri, this._onDidChangeFile, this._onDidChangeTreeData, this._treeRootNodes, this._columns, this._reporter);
                this._documents.set(uri.toString(), document);
                if (this._documents.size === 1) {
                    this.checkActiveRestQueryDocChanged();
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
        console.log(`dlt-logs.readFile(uri=${uri.toString()})...`);
        if (!doc) {
            doc = new DltDocument(uri, this._onDidChangeFile, this._onDidChangeTreeData, this._treeRootNodes, this._columns, this._reporter);
            this._documents.set(uri.toString(), doc);
            if (this._documents.size === 1) {
                this.checkActiveRestQueryDocChanged();
            }
        }
        return Buffer.from(doc.text);
    }

    watch(uri: vscode.Uri): vscode.Disposable {
        console.log(`dlt-logs.watch(uri=${uri.toString()}...`);
        return new vscode.Disposable(() => {
            console.log(`dlt-logs.watch.Dispose ${uri}`);
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
            console.log(` dlt-logs.readDirectory found ${dirEnts[i].name}`);
            if (dirEnts[i].isDirectory()) {
                entries.push([dirEnts[i].name, vscode.FileType.Directory]);
            } else {
                if (dirEnts[i].isFile() && (dirEnts[i].name.endsWith(".dlt") /* todo config */)) {
                    entries.push([dirEnts[i].name, vscode.FileType.File]);
                }
            }
        }
        console.log(` dlt-logs.readDirectory(uri=${uri.toString()}) returning ${entries.length} entries.`);
        return entries;
    }

    writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }): void {
        console.log(`dlt-logs.writeFile(uri=${uri.toString()}...`);
        throw vscode.FileSystemError.NoPermissions();
    }

    rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): void {
        console.log(`dlt-logs.rename(oldUri=${oldUri.toString()}...`);
        throw vscode.FileSystemError.NoPermissions();
    }

    delete(uri: vscode.Uri): void {
        console.log(`dlt-logs.delete(uri=${uri.toString()}...`);
        throw vscode.FileSystemError.NoPermissions();
    }

    createDirectory(uri: vscode.Uri): void {
        console.log(`dlt-logs.createDirectory(uri=${uri.toString()}...`);
        throw vscode.FileSystemError.NoPermissions();
    }

}
