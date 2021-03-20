/* --------------------
 * Copyright(C) Matthias Behr.
 */


import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as util from './util';
import { DltDocument } from './dltDocument';
import TelemetryReporter from 'vscode-extension-telemetry';
import { DltFilter } from './dltFilter';
import { DltFileTransfer } from './dltFileTransfer';
import { addFilter, editFilter, deleteFilter } from './dltAddEditFilter';
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
    private _treeRootNodes: TreeViewNode[] = []; // one root node per document.
    private _onDidChangeTreeData: vscode.EventEmitter<TreeViewNode | null> = new vscode.EventEmitter<TreeViewNode | null>();
    readonly onDidChangeTreeData: vscode.Event<TreeViewNode | null> = this._onDidChangeTreeData.event;

    private _didChangeSelectedTimeSubscriptions: Array<vscode.Disposable> = new Array<vscode.Disposable>();
    private _onDidChangeSelectedTime: vscode.EventEmitter<SelectedTimeData> = new vscode.EventEmitter<SelectedTimeData>();
    readonly onDidChangeSelectedTime: vscode.Event<SelectedTimeData> = this._onDidChangeSelectedTime.event;

    private _onDidChangeActiveRestQueryDoc: vscode.EventEmitter<vscode.Uri | undefined> = new vscode.EventEmitter<vscode.Uri | undefined>();
    /**
     * event that we'll trigger once the active rest query doc
     * (aka the one on top of the tree or with the fallback within restquery) changes
     */
    readonly onDidChangeActiveRestQueryDoc: vscode.Event<vscode.Uri | undefined> = this._onDidChangeActiveRestQueryDoc.event;

    private _lastActiveQueryDocUri: vscode.Uri | undefined = undefined;
    checkActiveRestQueryDocChanged(): boolean {
        const newDoc0Uri = this.getRestQueryDocById('0')?.uri;
        if (newDoc0Uri !== this._lastActiveQueryDocUri) {
            this._lastActiveQueryDocUri = newDoc0Uri;
            this._onDidChangeActiveRestQueryDoc.fire(newDoc0Uri);
            return true;
        }
        return false;
    }

    private _autoTimeSync = false; // todo config

    private _statusBarItem: vscode.StatusBarItem | undefined;

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
                console.log(` dlt.logs.onDidOpenTextDocument: found document with uri=${uriStr} newlyOpened=${newlyOpened}`);
                if (newlyOpened) {
                    doc.textDocument = event;
                    if (!this._dltLifecycleTreeView) {
                        // treeView support for log files
                        this._dltLifecycleTreeView = vscode.window.createTreeView('dltLifecycleExplorer', {
                            treeDataProvider: this
                        });
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
                    if (!this._statusBarItem) {
                        this._statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
                    }
                    doc.updateStatusBarItem(this._statusBarItem);
                    this._statusBarItem.show();
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
                console.log(` dlt-logs.onDidCloseTextDocument: found document with uri=${uriStr}`);
                if (doc.textDocument) {
                    console.log(`  deleting document with uri=${doc.textDocument.uri.toString()}`);
                    doc.textDocument = undefined;
                    let childNode: TreeViewNode = doc.treeNode;
                    for (let i = 0; i < this._treeRootNodes.length; ++i) {
                        if (this._treeRootNodes[i] === childNode) {
                            this._treeRootNodes.splice(i, 1);
                            //console.log(`  deleting rootNode with #${i}`);
                            break;
                        }
                    }
                    this._documents.delete(uriStr);
                    this._onDidChangeTreeData.fire(null);
                    if (this._documents.size === 0 && this._statusBarItem) {
                        this._statusBarItem.hide();
                    }
                    this.checkActiveRestQueryDocChanged();
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
                this._dltLifecycleTreeView?.reveal(data.treeNode, { select: false, focus: false, expand: true });
                this.updateDecorations(data);
                // time sync events?
                if (data.timeSyncs.length) {
                    console.log(`dlt-logs.onDidChangeTextDocument broadcasting ${data.timeSyncs.length} time-syncs.`);
                    this._onDidChangeSelectedTime.fire({ time: new Date(0), uri: data.uri, timeSyncs: data.timeSyncs });
                }
                if (this._statusBarItem) {
                    data.updateStatusBarItem(this._statusBarItem);
                }
            }
        }));

        // on change of active text editor update calculated decorations:
        this._subscriptions.push(vscode.window.onDidChangeActiveTextEditor(async (event: vscode.TextEditor | undefined) => {
            let activeTextEditor = event;
            let hideStatusBar = true;
            if (activeTextEditor) {
                console.log(`DltDocumentProvider.onDidChangeActiveTextEditor ${activeTextEditor.document.uri.toString()} column=${activeTextEditor.viewColumn}`);
                if (this._documents.has(activeTextEditor.document.uri.toString())) {
                    const data = this._documents.get(activeTextEditor.document.uri.toString())!;
                    if (!data.textEditors.includes(activeTextEditor)) {
                        data.textEditors.push(activeTextEditor);
                    } // todo remove?
                    // or fire as well if the active one is not supported?
                    this._onDidChangeTreeData.fire(data.treeNode);
                    this._dltLifecycleTreeView?.reveal(data.treeNode, { select: false, focus: true, expand: true });
                    //this.checkActiveTextEditor(data);
                    this.updateDecorations(data);

                    if (this._statusBarItem) {
                        hideStatusBar = false;
                        data.updateStatusBarItem(this._statusBarItem);
                        this._statusBarItem.show();
                    }
                }
            }
            if (hideStatusBar) {
                this._statusBarItem?.hide();
            }
        }));

        this._subscriptions.push(vscode.window.onDidChangeVisibleTextEditors((editors: vscode.TextEditor[]) => {
            //console.log(`DltDocumentProvider.onDidChangeVisibleTextEditors= ${editors.length}`);
            const visibleDocs: DltDocument[] = [];
            for (const editor of editors) {
                //console.log(` DltDocumentProvider.onDidChangeVisibleTextEditors editor.document.uri=${editor.document.uri} editor.viewColumn=${editor.viewColumn} editor.document.isClosed=${editor.document.isClosed}`);
                let data = this._documents.get(editor.document.uri.toString());
                if (data) {
                    //console.log(` DltDocumentProvider.onDidChangeVisibleTextEditors got doc!`);
                    if (!editor.document.isClosed) { visibleDocs.push(data); }
                }
            }

            // show/hide the status bar if no doc is visible
            if (this._statusBarItem) {
                if (visibleDocs.length === 0) {
                    this._statusBarItem.hide();
                } else {
                    this._statusBarItem.show();
                }
            }

            // now close all but the visibleDocs:
            const notVisibleDocs: DltDocument[] = [];
            this._documents.forEach(doc => {
                if (!visibleDocs.includes(doc)) { notVisibleDocs.push(doc); }
            });
            let doFire = false;
            notVisibleDocs.forEach(doc => {
                if (doc) {
                    if (doc.textDocument) {
                        //console.log(` dlt-logs.onDidChangeVisibleTextEditors: hiding doc uri=${doc.textDocument.uri.toString()}`);
                        let childNode: TreeViewNode = doc.treeNode;
                        // this._dltLifecycleTreeView?.reveal(childNode, { select: false, focus: false, expand: false });
                        // reveal:false to collapse doesn't work. so remove them completely from the tree:
                        let idx = this._treeRootNodes.indexOf(childNode);
                        if (idx >= 0) {
                            this._treeRootNodes.splice(idx, 1);
                        }
                        doFire = true;
                    }
                }
            });
            // and add the visible ones:
            visibleDocs.forEach(doc => {
                if (doc && doc.textDocument) {
                    //console.log(` dlt-logs.onDidChangeVisibleTextEditors: hiding doc uri=${doc.textDocument.uri.toString()}`);
                    let childNode: TreeViewNode = doc.treeNode;
                    if (childNode) {
                        if (!this._treeRootNodes.includes(childNode)) {
                            this._treeRootNodes.push(childNode);
                            doFire = true;
                        }
                    }
                }
            });

            if (doFire) { this._onDidChangeTreeData.fire(null); }
            this.checkActiveRestQueryDocChanged();
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

        context.subscriptions.push(vscode.commands.registerTextEditorCommand('dlt-logs.configureColumns', async (textEditor: vscode.TextEditor) => {
            // console.log(`dlt-logs.configureColumns(textEditor.uri = ${textEditor.document.uri.toString()}) called...`);
            const doc = this._documents.get(textEditor.document.uri.toString());
            if (doc) {
                return doc.configureColumns();
            }
        }));

        this._subscriptions.push(vscode.commands.registerCommand("dlt-logs.addFilter", async (...args) => {
            args.forEach(a => { console.log(` arg='${JSON.stringify(a)}'`); });
            if (args.length < 2) { return; }
            // first arg should contain uri
            const uri = args[0].uri;
            if (uri) {
                const doc = this._documents.get(uri.toString());
                if (doc) {
                    addFilter(doc, args[1]);
                }
            }
        }));

        context.subscriptions.push(vscode.commands.registerCommand('dlt-logs.editFilter', async (...args: any[]) => {
            const filterNode = <FilterNode>args[0];
            const parentUri = filterNode.parent?.uri;
            if (parentUri) {
                const doc = this._documents.get(parentUri.toString());
                if (doc) {
                    console.log(`editFilter(${filterNode.label}) called for doc=${parentUri}`);
                    editFilter(doc, filterNode.filter).then(() => {
                        console.log(`editFilter resolved...`);
                        this._onDidChangeTreeData.fire(filterNode);
                    });
                }
            }
        }));

        context.subscriptions.push(vscode.commands.registerCommand('dlt-logs.deleteFilter', async (...args: any[]) => {
            const filterNode = <FilterNode>args[0];
            const parentUri = filterNode.parent?.uri;
            if (parentUri) {
                const doc = this._documents.get(parentUri.toString());
                if (doc) {
                    console.log(`deleteFilter(${filterNode.label}) called for doc=${parentUri}`);
                    let parentNode = filterNode.parent;
                    vscode.window.showWarningMessage(`Do you want to delete the filter '${filterNode.filter.name}'? This cannot be undone!`,
                        { modal: true }, 'Delete').then((value) => {
                            if (value === 'Delete') {
                                deleteFilter(doc, filterNode.filter).then(() => {
                                    console.log(`deleteFilter resolved...`);
                                    this._onDidChangeTreeData.fire(parentNode);
                                });
                            }
                        });
                }
            }
        }));

        const modifyNode = async (node: TreeViewNode, command: string) => {
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

        context.subscriptions.push(vscode.commands.registerCommand('dlt-logs.enableFilter', async (...args: any[]) => {
            modifyNode(args[0], 'enable');
        }));

        context.subscriptions.push(vscode.commands.registerCommand('dlt-logs.disableFilter', async (...args: any[]) => {
            modifyNode(args[0], 'disable');
        }));

        context.subscriptions.push(vscode.commands.registerCommand('dlt-logs.zoomIn', async (...args: any[]) => {
            modifyNode(args[0], 'zoomIn');
        }));

        context.subscriptions.push(vscode.commands.registerCommand('dlt-logs.zoomOut', async (...args: any[]) => {
            modifyNode(args[0], 'zoomOut');
        }));

        context.subscriptions.push(vscode.commands.registerCommand('dlt-logs.openReport', async (...args: any[]) => {
            const filterNode = <FilterNode>args[0];
            const parentUri = filterNode.parent?.uri;
            if (parentUri) {
                const doc = this._documents.get(parentUri.toString());
                if (doc) {
                    console.log(`openReport(${filterNode.label}) called for doc=${parentUri}`);
                    doc.onOpenReport(context, filterNode.filter);
                }
            }
        }));

        context.subscriptions.push(vscode.commands.registerCommand('dlt-logs.openNewReport', async (...args: any[]) => {
            const filterNode = <FilterNode>args[0];
            const parentUri = filterNode.parent?.uri;
            if (parentUri) {
                const doc = this._documents.get(parentUri.toString());
                if (doc) {
                    console.log(`openNewReport(${filterNode.label}) called for doc=${parentUri}`);
                    doc.onOpenReport(context, filterNode.filter, true);
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
            setTimeout(() => {
                console.log(`dlt-log.extensions.onDidChange #ext=${vscode.extensions.all.length}`);
                this.checkActiveExtensions();
            }, 1500); // delay a bit. introduces a possible race on time-sync event reception. todo
        }));
        setTimeout(() => {
            this.checkActiveExtensions();
        }, 2000);
    };

    updateDecorations(data: DltDocument) {
        // console.log('updateDecorations...');
        if (data.decorations && data.textEditors) {
            if (data.textDocument && data.textDocument.lineCount && data.textDocument.lineCount > data.staticLinesAbove.length + 1) {
                // console.log(` setDecorations lineCount=${data.textDocument.lineCount}, staticLinesAbove=${data.staticLinesAbove.length}`);
                data.textEditors.forEach((editor) => {
                    data?.decorations?.forEach((value, key) => {
                        // console.log(` setDecorations ${value.length}`);
                        editor.setDecorations(key, value);
                    });
                });
            }
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

    private getRestQueryDocByIdDidLoadSub: vscode.Disposable | undefined;
    getRestQueryDocById(id: string): DltDocument | undefined {
        let doc = this._documents.get(id);
        // fallback to index:
        if (!doc) {
            const docIdx: number = Number(id);

            // take the docIdx th. dlt doc that is visible:
            if (this._treeRootNodes.length > docIdx) {
                const childNode = this._treeRootNodes[docIdx];
                // now find the document for that:
                this._documents.forEach(aDoc => {
                    if (aDoc.treeNode === childNode) { doc = aDoc; }
                });
            }
            if (!doc) { // fallback to prev. method. which is ok for one doc, but not for mult....
                // if (this._documents.size > 1) { console.warn(`DltDocumentProvider.restQuery: you're using a deprecated method to access documents! Please only refer to visible documents!`); }
                if (docIdx >= 0 && docIdx < this._documents.size) {
                    const iter = this._documents.entries();
                    for (let i = 0; i <= docIdx; ++i) {
                        const [, aDoc] = iter.next().value;
                        if (i === docIdx) { doc = aDoc; }
                    }
                }
            }
        }
        // if the doc is not yet fully loaded we'll return undefined as the restQuery will return wrong results otherwise:
        if (doc && !doc.isLoaded) {
            if (this.getRestQueryDocByIdDidLoadSub) { this.getRestQueryDocByIdDidLoadSub.dispose(); };
            this.getRestQueryDocByIdDidLoadSub = doc.onDidLoad(load => {
                console.warn(`DltDocumentProvider.getRestQueryDocById.onDidLoad called...`);
                if (this.getRestQueryDocByIdDidLoadSub) {
                    this.getRestQueryDocByIdDidLoadSub.dispose();
                    this.getRestQueryDocByIdDidLoadSub = undefined;
                }
                this.checkActiveRestQueryDocChanged();
            });
            return undefined;
        }
        return doc;
    }

    /**
     * support info query in JSON API format (e.g. used by fishbone ext.)
     * input: query : string, e.g. '/get/docs' or '/get/version'
     * output: JSON obj as string. e.g. '{"errors":[]}' or '{"data":[...]}'
     */
    /// support info query in JSON API format (e.g. used by fishbone ext.)
    restQuery(context: vscode.ExtensionContext, query: string): string {
        console.log(`restQuery(${query}))...`);
        const retObj: { error?: [Object], data?: [Object] | Object } = {};

        // parse as regex: ^\/(?<cmd>.*?)\/(?<path>.*?)($|\?(?<options>.+)$)
        var re = /^\/(?<cmd>.*?)\/(?<path>.*?)($|\?(?<options>.+)$)/;
        const regRes = re.exec(query);
        if (regRes?.length && regRes.groups) {
            //console.log(`got regRes.length=${regRes.length}`);
            //regRes.forEach(regR => console.log(JSON.stringify(regR)));
            const cmd = regRes.groups['cmd'];
            const path = regRes.groups['path'];
            const options = regRes.groups['options'];
            console.log(` restQuery cmd='${cmd}' path='${path}' options='${options}'`);
            switch (cmd) {
                case 'get':
                    {
                        // split path:
                        const paths = path.split('/');
                        switch (paths[0]) {
                            case 'version':
                                {
                                    const extension = vscode.extensions.getExtension('mbehr1.dlt-logs');
                                    if (extension) {
                                        const extensionVersion = extension.packageJSON.version;
                                        retObj.data = {
                                            "type": "version",
                                            "id": "1",
                                            "attributes": {
                                                version: extensionVersion,
                                                name: 'mbehr1.dlt-logs'
                                            }
                                        };
                                    } else {
                                        retObj.error = [{ title: `${cmd}/${paths[0]} extension object undefined.` }];
                                    }
                                }
                                break;
                            case 'docs':
                                {
                                    if (paths.length === 1) {
                                        // get info about available documents:
                                        const arrRes: Object[] = [];
                                        this._documents.forEach((doc) => {
                                            const resObj: { type: string, id: string, attributes?: Object } =
                                                { type: "docs", id: encodeURIComponent(doc.uri.toString()) };
                                            let ecusObj = { data: {} };
                                            this.restQueryDocsEcus(cmd, [paths[0], '', 'ecus'], options, doc, ecusObj);
                                            resObj.attributes = {
                                                name: doc.uri.fsPath,
                                                msgs: doc.msgs.length,
                                                ecus: ecusObj.data,
                                                filters: util.createRestArray(doc.allFilters, (obj: object, i: number) => { const filter = obj as DltFilter; return filter.asRestObject(i); })
                                            };
                                            arrRes.push(resObj);
                                        });
                                        retObj.data = arrRes;
                                    } else {
                                        // get info about one document:
                                        // e.g. get/docs/<id>/ecus/<ecuid>/lifecycles/<lifecycleid>
                                        // or   get/docs/<id>/filters
                                        if (paths.length >= 2) {
                                            const docId = decodeURIComponent(paths[1]);
                                            let doc = this.getRestQueryDocById(docId);
                                            if (doc) {
                                                if (paths.length === 2) { // get/docs/<id>
                                                    const resObj: { type: string, id: string, attributes?: Object } =
                                                        { type: "docs", id: encodeURIComponent(doc.uri.toString()) };
                                                    resObj.attributes = {
                                                        name: doc.uri.fsPath,
                                                        msgs: doc.msgs.length,
                                                        ecus: [...doc.lifecycles.keys()].map((ecu => {
                                                            return {
                                                                name: ecu, lifecycles: doc!.lifecycles.get(ecu)?.length
                                                            };
                                                        })),
                                                        filters: util.createRestArray(doc.allFilters, (obj: object, i: number) => { const filter = obj as DltFilter; return filter.asRestObject(i); })
                                                    };
                                                    retObj.data = resObj;
                                                } else { // get/docs/<id>/...
                                                    switch (paths[2]) {
                                                        case 'ecus': // get/docs/<id>/ecus
                                                            this.restQueryDocsEcus(cmd, paths, options, doc, retObj);
                                                            break;
                                                        case 'filters': // get/docs/<id>/filters
                                                            doc.restQueryDocsFilters(context, cmd, paths, options, retObj);
                                                            break;
                                                        default:
                                                            retObj.error = [{ title: `${cmd}/${paths[0]}/<docid>/${paths[2]} not supported:'${paths[2]}. Valid: 'ecus' or 'filters'.` }];
                                                            break;
                                                    }
                                                }
                                            } else {
                                                retObj.error = [{ title: `${cmd}/${paths[0]} unknown doc id:'${docId}'` }];
                                            }
                                        }

                                    }
                                }
                                break;
                            default:
                                retObj.error = [{ title: `${cmd}/${paths[0]} unknown/not supported.` }];
                                break;
                        }
                    }
                    break;
                default:
                    retObj.error = [{ title: `cmd ('${cmd}') unknown/not supported.` }];
                    break;
            }

        } else {
            retObj.error = [{ title: 'query failed regex parsing' }];
        }

        const retStr = JSON.stringify(retObj);
        console.log(`restQuery() returning : len=${retStr.length} errors=${retObj?.error?.length}`);
        return retStr;
    }

    /**
     * process /<cmd>/docs/<id>/ecus(paths[2])... restQuery requests
     * @param cmd get|patch|delete
     * @param paths docs/<id>/ecus[...]
     * @param options e.g. ecu=<name>
     * @param doc DltDocument identified by <id>
     * @param retObj output: key errors or data has to be filled
     */

    private restQueryDocsEcus(cmd: string, paths: string[], options: string, doc: DltDocument, retObj: { error?: object[], data?: object[] | object }) {
        const optionArr = options ? options.split('&') : [];
        let ecuNameFilter: string | undefined = undefined;
        optionArr.forEach((opt) => {
            console.log(`got opt=${opt}`);
            if (opt.startsWith('ecu=')) {
                ecuNameFilter = decodeURIComponent(opt.slice(opt.indexOf('=') + 1));
                // allow the string be placed in "":
                // we treat 'null' as undefined but "null" as ECU named null.
                if (ecuNameFilter === 'null') { ecuNameFilter = undefined; } else {
                    ecuNameFilter = ecuNameFilter.replace(/^"(.*?)"$/g, (match, p1, offset) => p1);
                    if (ecuNameFilter.length === 0) { ecuNameFilter = undefined; } else {
                        console.log(`restQueryDocsEcus got ecuNameFilter='${ecuNameFilter}'`);
                    }
                }
            }
        });
        if (paths.length === 3) { // .../ecus
            const arrRes: Object[] = [];
            doc.lifecycles.forEach((lcInfo, ecu) => {
                if (!ecuNameFilter || ecuNameFilter === ecu) {
                    const resObj: { type: string, id: string, attributes?: Object } =
                        { type: "ecus", id: encodeURIComponent(ecu) };

                    // determine SW names:
                    let sw: string[] = [];
                    lcInfo.forEach(lc => lc.swVersions.forEach(lsw => { if (!sw.includes(lsw)) { sw.push(lsw); } }));

                    resObj.attributes = {
                        name: ecu,
                        lifecycles: [...lcInfo.map((lc, idx) => {
                            return {
                                type: "lifecycles", id: lc.persistentId,
                                attributes: {
                                    index: idx + 1,
                                    id: lc.persistentId, // todo to ease parsing with jsonPath...
                                    label: lc.getTreeNodeLabel(),
                                    startTimeUtc: lc.lifecycleStart.toUTCString(),
                                    endTimeUtc: lc.lifecycleEnd.toUTCString(),
                                    sws: lc.swVersions,
                                    msgs: lc.logMessages.length,
                                    // todo apids/ctids
                                }
                            };
                        })],
                        sws: sw,
                        // todo collect APID infos and CTID infos...
                    };
                    arrRes.push(resObj);
                }
            });
            retObj.data = arrRes;
        } else { // .../ecus/
            retObj.error = [{ title: `${cmd}/${paths[0]}/${paths[1]}/${paths[2]}/${paths[3]} for ecus not yet implemented.` }];
        }
    }

    dispose() {
        console.log("DltDocumentProvider dispose() called");
        this._documents.clear(); // todo have to dispose more? check in detail...
        if (this._dltLifecycleTreeView) {
            this._dltLifecycleTreeView.dispose();
            this._dltLifecycleTreeView = undefined;
        }
        if (this._statusBarItem) {
            this._statusBarItem.hide();
            this._statusBarItem.dispose();
            this._statusBarItem = undefined;
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
        // console.log(`dlt-logs.getTreeItem(${element.label}, ${element.uri?.toString()}) called.`);
        return {
            id: element.id,
            label: element.label,
            tooltip: element.tooltip,
            contextValue: element.contextValue,
            command: element.command,
            collapsibleState: element.children.length ? vscode.TreeItemCollapsibleState.Collapsed : void 0,
            iconPath: element.iconPath,
            description: element.description
        };
    }

    public getChildren(element?: TreeViewNode): TreeViewNode[] | Thenable<TreeViewNode[]> {
        // console.log(`dlt-logs.getChildren(${element?.label}, ${element?.uri?.toString()}) this=${this} called (#treeRootNode=${this._treeRootNodes.length}).`);
        if (!element) { // if no element we have to return the root element.
            // console.log(`dlt-logs.getChildren(undefined), returning treeRootNodes`);
            return this._treeRootNodes;
        } else {
            // console.log(`dlt-logs.getChildren(${element?.label}, returning children = ${element.children.length}`);
            return element.children;
        }
    }

    public getParent(element: TreeViewNode): vscode.ProviderResult<TreeViewNode> {
        // console.log(`dlt-logs.getParent(${element.label}, ${element.uri?.toString()}) = ${element.parent?.label} called.`);
        return element.parent;
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
                document = new DltDocument(uri, this._onDidChangeFile, this._onDidChangeTreeData, this._treeRootNodes, this._reporter);
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
            doc = new DltDocument(uri, this._onDidChangeFile, this._onDidChangeTreeData, this._treeRootNodes, this._reporter);
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
