/* --------------------
 * Copyright(C) Matthias Behr.
 */


import * as vscode from 'vscode';
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as util from './util';
import { DltDocument } from './dltDocument';
import TelemetryReporter from 'vscode-extension-telemetry';
import { DltFilter } from './dltFilter';
import { DltFileTransfer } from './dltFileTransfer';
import { pathToFileURL } from 'url';

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

export interface TreeViewNode {
    label: string;
    uri: vscode.Uri | null; // index provided as fragment #<index>
    parent: TreeViewNode | null;
    children: TreeViewNode[];
    contextValue?: string;
    command?: vscode.Command;
};

export class FilterNode implements TreeViewNode {
    label: string;
    //uri: vscode.Uri | null; // index provided as fragment #<index>
    //parent: TreeViewNode | null;
    children: TreeViewNode[];
    contextValue: string;
    constructor(public uri: vscode.Uri | null, public parent: TreeViewNode | null, public filter: DltFilter) {
        this.children = [];
        this.label = filter.name;
        if (filter.atLoadTime) {
            this.contextValue = 'filterLoadTime';
        } else {
            if (filter.enabled) { this.contextValue = 'filterEnabled'; } else { this.contextValue = 'filterDisabled'; };
        }
    }
};

export class DltDocumentProvider implements vscode.TreeDataProvider<TreeViewNode>, vscode.FileSystemProvider,
    vscode.DocumentSymbolProvider, vscode.Disposable {
    private _reporter?: TelemetryReporter;
    private _subscriptions: Array<vscode.Disposable> = new Array<vscode.Disposable>();

    private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    private _documents = new Map<string, DltDocument>();
    get onDidChangeFile() {
        return this._onDidChangeFile.event;
    }

    private _dltLifecycleTreeView: vscode.TreeView<TreeViewNode> | undefined = undefined;
    private _dltLifecycleRootNode: TreeViewNode = { label: "Detected lifecycles", uri: null, parent: null, children: [] };
    private _dltFilterRootNode: TreeViewNode = { label: "Filters", uri: null, parent: null, children: [] };
    private _dltPluginRootNode: TreeViewNode = { label: "Plugins", uri: null, parent: null, children: [] };
    private _onDidChangeTreeData: vscode.EventEmitter<TreeViewNode | null> = new vscode.EventEmitter<TreeViewNode | null>();
    readonly onDidChangeTreeData: vscode.Event<TreeViewNode | null> = this._onDidChangeTreeData.event;

    private _didChangeSelectedTimeSubscriptions: Array<vscode.Disposable> = new Array<vscode.Disposable>();
    private _onDidChangeSelectedTime: vscode.EventEmitter<SelectedTimeData> = new vscode.EventEmitter<SelectedTimeData>();
    readonly onDidChangeSelectedTime: vscode.Event<SelectedTimeData> = this._onDidChangeSelectedTime.event;

    private _autoTimeSync = false; // todo config

    constructor(context: vscode.ExtensionContext, reporter?: TelemetryReporter) {
        console.log(`dlt-logs.DltDocumentProvider()...`);
        this._reporter = reporter;
        this._subscriptions.push(vscode.workspace.onDidOpenTextDocument((event: vscode.TextDocument) => {
            const uriStr = event.uri.toString();
            console.log(`DltDocumentProvider onDidOpenTextDocument uri=${uriStr}`);
            // is it one of our documents?
            const doc = this._documents.get(uriStr);
            if (doc) {
                const newlyOpened: boolean = (doc.textDocument) ? false : true;
                console.log(` found document with uri=${uriStr} newlyOpened=${newlyOpened}`);
                if (newlyOpened) {
                    doc.textDocument = event;
                    if (!this._dltLifecycleTreeView) {
                        // treeView support for log files
                        this._dltLifecycleTreeView = vscode.window.createTreeView('dltLifecycleExplorer', {
                            treeDataProvider: this
                        });
                        this._subscriptions.push(this._dltLifecycleTreeView.onDidChangeSelection(event => {
                            console.log(`dltLifecycleTreeView.onDidChangeSelection(${event.selection.length} ${event.selection[0].uri})`);
                            if (event.selection.length && event.selection[0].uri) {
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
                    this._onDidChangeTreeData.fire();
                    this._dltLifecycleTreeView.reveal(doc.lifecycleTreeNode, { focus: true, select: false, expand: true }); // { label: "", uri: null, parent: null, children: [] });
                }
            }
        }));

        this._subscriptions.push(vscode.workspace.onDidCloseTextDocument((event: vscode.TextDocument) => {
            // todo investigate why we sometimes dont get a onDidClose for our documents??? (its the garbage collector, ...we get a didOpen and didChange...)
            const uriStr = event.uri.toString();
            console.log(`DltDocumentProvider onDidCloseTextDocument uri=${uriStr}`);
            // is it one of our documents?
            const doc = this._documents.get(uriStr);
            if (doc) {
                console.log(` found document with uri=${uriStr}`);
                if (doc.textDocument) {
                    console.log(`  deleting document with uri=${doc.textDocument.uri.toString()}`);
                    doc.textDocument = undefined;
                    let childNode: TreeViewNode = doc.lifecycleTreeNode;
                    for (let i = 0; i < this._dltLifecycleRootNode.children.length; ++i) {
                        if (this._dltLifecycleRootNode.children[i] === childNode) {
                            this._dltLifecycleRootNode.children.splice(i, 1);
                            console.log(`  deleting rootNode with #${i}`);
                            break;
                        }
                    }
                    childNode = doc.filterTreeNode;
                    for (let i = 0; i < this._dltFilterRootNode.children.length; ++i) {
                        if (this._dltFilterRootNode.children[i] === childNode) {
                            this._dltFilterRootNode.children.splice(i, 1);
                            console.log(`  deleting filter rootNode with #${i}`);
                            break;
                        }
                    }

                    let childNodes = doc.pluginNodes;
                    for (let i = 0; i < this._dltPluginRootNode.children.length; ++i) {
                        for (let j = 0; j < childNodes.length; ++j) {
                            if (this._dltPluginRootNode.children[i] === childNodes[j]) {
                                this._dltPluginRootNode.children.splice(i, 1);
                                console.log(`  deleting plugin rootNode with #${i}`);
                                i--; // we modified dltPluginRootNode and need to continue from next one
                                break;
                            }
                        }
                    }
                    this._documents.delete(uriStr);
                    this._onDidChangeTreeData.fire(this._dltLifecycleRootNode);
                    this._onDidChangeTreeData.fire(this._dltFilterRootNode);
                    this._onDidChangeTreeData.fire(this._dltPluginRootNode);
                }
            }
        }));
        // check for changes of the documents
        this._subscriptions.push(vscode.workspace.onDidChangeTextDocument(async (event) => {
            let uriStr = event.document.uri.toString();
            console.log(`DltDocumentProvider onDidChangeTextDocument uri=${uriStr}`);
            let data = this._documents.get(uriStr);
            if (data) {
                this._onDidChangeTreeData.fire(data.lifecycleTreeNode);
                this._dltLifecycleTreeView?.reveal(data.lifecycleTreeNode, { select: false, focus: false, expand: true });
                this.updateDecorations(data);
                // time sync events?
                if (data.timeSyncs.length) {
                    console.log(`dlt-logs.onDidChangeTextDocument broadcasting ${data.timeSyncs.length} time-syncs.`);
                    this._onDidChangeSelectedTime.fire({ time: new Date(0), uri: data.uri, timeSyncs: data.timeSyncs });
                }
            }
        }));

        // on change of active text editor update calculated decorations:
        this._subscriptions.push(vscode.window.onDidChangeActiveTextEditor(async (event: vscode.TextEditor | undefined) => {
            let activeTextEditor = event;
            if (activeTextEditor) {
                console.log(`DltDocumentProvider.onDidChangeActiveTextEditor ${activeTextEditor.document.uri.toString()} column=${activeTextEditor.viewColumn}`);
                if (this._documents.has(activeTextEditor.document.uri.toString())) {
                    const data = this._documents.get(activeTextEditor.document.uri.toString())!;
                    if (!data.textEditors.includes(activeTextEditor)) {
                        data.textEditors.push(activeTextEditor);
                    } // todo remove?
                    // or fire as well if the active one is not supported?
                    this._onDidChangeTreeData.fire(data.lifecycleTreeNode.parent); // or parent and this child?
                    this._dltLifecycleTreeView?.reveal(data.lifecycleTreeNode, { select: false, focus: true, expand: true });
                    //this.checkActiveTextEditor(data);
                    this.updateDecorations(data);
                }
            }
        }));

        /* this._subscriptions.push(vscode.window.onDidChangeVisibleTextEditors((editors: vscode.TextEditor[]) => {
            // console.log(`DltDocumentProvider.onDidChangeVisibleTextEditors= ${editors.length}`);
            // todo update tree view to only contain the visible ones...
        })); */

        // todo doesn't work with skipped msgs... this._subscriptions.push(vscode.languages.registerDocumentSymbolProvider('dlt-log', this, { label: "DLT Lifecycles" }));

        // announce time updates on selection of lines:
        // counterpart to handleDidChangeSelectedTime... 
        this._subscriptions.push(vscode.window.onDidChangeTextEditorSelection(util.throttle((ev) => {
            if (this._autoTimeSync) {
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
                                // post time update...
                                console.log(` dlt-log posting time update ${time.toLocaleTimeString()}.${String(time.valueOf() % 1000).padStart(3, "0")}`);
                                this._onDidChangeSelectedTime.fire({ time: time, uri: data.uri });
                            }
                        }
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

        context.subscriptions.push(vscode.commands.registerTextEditorCommand('dlt-logs.configureColumns', async (textEditor: vscode.TextEditor) => {
            // console.log(`dlt-logs.configureColumns(textEditor.uri = ${textEditor.document.uri.toString()}) called...`);
            const doc = this._documents.get(textEditor.document.uri.toString());
            if (doc) {
                return doc.configureColumns();
            }
        }));

        context.subscriptions.push(vscode.commands.registerCommand('dlt-logs.enableFilter', async (...args: any[]) => {
            const filterNode = <FilterNode>args[0];
            const parentUri = filterNode.parent?.uri;
            if (parentUri) {
                const doc = this._documents.get(parentUri.toString());
                if (doc) {
                    console.log(`enableFilter(${filterNode.label}) called for doc=${parentUri}`);
                    filterNode.filter.enabled = true;
                    filterNode.label = filterNode.filter.name; // dirty. add to FilterNode class!
                    if (filterNode.filter.enabled) { filterNode.contextValue = 'filterEnabled'; } else { filterNode.contextValue = 'filterDisabled'; };
                    doc.onFilterChange(filterNode.filter);
                    this._onDidChangeTreeData.fire(filterNode); // or parent and this child?
                }
            }
        }));

        context.subscriptions.push(vscode.commands.registerCommand('dlt-logs.disableFilter', async (...args: any[]) => {
            const filterNode = <FilterNode>args[0];
            const parentUri = filterNode.parent?.uri;
            if (parentUri) {
                const doc = this._documents.get(parentUri.toString());
                if (doc) {
                    console.log(`disableFilter(${filterNode.label}) called for doc=${parentUri}`);
                    filterNode.filter.enabled = false;
                    filterNode.label = filterNode.filter.name;
                    if (filterNode.filter.enabled) { filterNode.contextValue = 'filterEnabled'; } else { filterNode.contextValue = 'filterDisabled'; };
                    doc.onFilterChange(filterNode.filter);
                    this._onDidChangeTreeData.fire(filterNode); // or parent and this child?
                }
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
            console.log(`dlt-log.extensions.onDidChange #ext=${vscode.extensions.all.length}`);
            this.checkActiveExtensions();
        }));
        setTimeout(() => {
            this.checkActiveExtensions();
        }, 2000);
    };

    updateDecorations(data: DltDocument) {
        // console.log('updateDecorations...');
        if (data.decorations && data.textEditors) {
            // set decorations // todo check that it's really on the already updated content...
            data.textEditors.forEach((editor) => {
                data?.decorations?.forEach((value, key) => {
                    editor.setDecorations(key, value);
                });
            });
        }
        // console.log(' updateDecorations done');
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
        if (this._dltLifecycleTreeView) {
            this._dltLifecycleTreeView.dispose();
            this._dltLifecycleTreeView = undefined;
        }
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

    // lifecycle tree view support:
    public getTreeItem(element: TreeViewNode): vscode.TreeItem {
        // console.log(`smart-log.getTreeItem(${element.label}, ${element.uri?.toString()}) called.`);
        return {
            label: element.label.length ? element.label : "Detected lifecycles",
            contextValue: element.contextValue,
            command: element.command,
            collapsibleState: element.children.length ? vscode.TreeItemCollapsibleState.Collapsed : void 0,
            iconPath: /* (element.children.length === 0 && element.label.startsWith("xy")) ? path.join(__filename, '..', '..', 'media', 'root-folder.svg') : */ undefined // todo!
        };
    }

    public getChildren(element?: TreeViewNode): TreeViewNode[] | Thenable<TreeViewNode[]> {
        // console.log(`smart-log.getChildren(${element?.label}, ${element?.uri?.toString()}) this=${this} called.`);
        if (!element) { // if no element we have to return the root element.
            return [this._dltLifecycleRootNode, this._dltFilterRootNode, this._dltPluginRootNode];
        } else {
            return element.children;
        }
    }

    public getParent(element: TreeViewNode): vscode.ProviderResult<TreeViewNode> {
        // console.log(`smart-log.getParent(${element.label}, ${element.uri?.toString()}) called.`);
        return element.parent;
    }

    handleDidChangeSelectedTime(ev: SelectedTimeData) {
        this._documents.forEach((doc) => {
            if (doc.uri.toString() !== ev.uri.toString()) { // avoid reacting on our own events...
                console.log(`dlt-log.handleDidChangeSelectedTime got ev from uri=${ev.uri.toString()}`);
                if (ev.time.valueOf() > 0) {
                    console.log(` trying to reveal ${ev.time.toLocaleTimeString()} at doc ${doc.uri.toString()}`);
                    let line = doc.lineCloseToDate(ev.time);
                    if (line >= 0 && doc.textEditors) {
                        const posRange = new vscode.Range(line, 0, line, 0);
                        doc.textEditors.forEach((value) => {
                            value.revealRange(posRange, vscode.TextEditorRevealType.AtTop);
                            // todo add/update decoration as well
                        });
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
        this._didChangeSelectedTimeSubscriptions.forEach((value) => {
            if (value !== undefined) {
                value.dispose();
            }
        });
        this._didChangeSelectedTimeSubscriptions = new Array<vscode.Disposable>();

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
                            console.log(` got onDidChangeSelectedTime api from ${value.id}`);
                            this._didChangeSelectedTimeSubscriptions.push(subscr);
                        }
                    }
                } catch (error) {
                    console.log(`dlt-log:extension ${value.id} throws: ${error}`);
                }
            }
        });
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
                document = new DltDocument(uri, this._onDidChangeFile, this._onDidChangeTreeData, this._dltLifecycleRootNode, this._dltFilterRootNode, this._dltPluginRootNode, this._reporter);
                this._documents.set(uri.toString(), document);
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
            doc = new DltDocument(uri, this._onDidChangeFile, this._onDidChangeTreeData, this._dltLifecycleRootNode, this._dltFilterRootNode, this._dltPluginRootNode, this._reporter);
            this._documents.set(uri.toString(), doc);
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
