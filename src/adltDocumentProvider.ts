/* --------------------
 * Copyright(C) Matthias Behr.
 */


import * as vscode from 'vscode';
import TelemetryReporter from 'vscode-extension-telemetry';
import * as fs from 'fs';
import * as WebSocket from 'ws';
import * as util from './util';
import * as path from 'path';
import { DltFilter } from './dltFilter';
import { TreeViewNode, FilterNode, LifecycleRootNode, LifecycleNode, FilterRootNode } from './dltTreeViewNodes';

import * as remote_types from './remote_types';

class AdltDocument {
    private realStat: fs.Stats;
    private webSocket: WebSocket;
    private streamId: number; // 0 none

    private editPending: boolean = false;
    private pendingTextUpdate: string = "";
    private timerId: NodeJS.Timeout;

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


    constructor(public uri: vscode.Uri, private emitDocChanges: vscode.EventEmitter<vscode.FileChangeEvent[]>, treeEventEmitter: vscode.EventEmitter<TreeViewNode | null>,
        parentTreeNode: TreeViewNode[], reporter?: TelemetryReporter) {

        this._treeEventEmitter = treeEventEmitter;

        this.text = "loading...\n";
        this.streamId = 0;

        // todo add support for multiple uris encoded...
        const fileUri = uri.with({ scheme: "file" });

        if (!fs.existsSync(fileUri.fsPath)) {
            throw Error(`AdltDocument file ${fileUri.fsPath} doesn't exist!`);
        }
        this.realStat = fs.statSync(fileUri.fsPath);

        // connect to adlt via websocket:
        const url = "ws://localhost:6665";
        this.webSocket = new WebSocket(url, [], { perMessageDeflate: false, origin: "adlt-logs" }); // todo maxPayload
        console.warn(`adlt.webSocket.binaryType=`, this.webSocket.binaryType);
        //this.webSocket.binaryType = "nodebuffer"; // or Arraybuffer?
        this.webSocket.binaryType = "arraybuffer"; // ArrayBuffer needed for sink?
        console.warn(`adlt.webSocket.binaryType=`, this.webSocket.binaryType);
        this.webSocket.on("message", (data: ArrayBuffer, isBinary) => {
            try {
                if (isBinary) {
                    console.warn(`dlt-logs.AdltDocumentProvider.on(message)`, data.byteLength, isBinary);
                    try {
                        let bin_type = remote_types.readBinType(data);
                        console.warn(`adlt.on(binary):`, bin_type.tag);
                        switch (bin_type.tag) {
                            case 'Lifecycles': {
                                let lifecycles: Array<remote_types.BinLifecycle> = bin_type.value;
                                this.processLifecycleUpdates(lifecycles);
                            }
                                break;
                            default:
                                console.warn(`adlt.on(binary): unhandled: `, bin_type.tag);
                                break;
                        }
                        //                        console.warn(`adlt.on(binary): value=${JSON.stringify(bin_type.value)}`);
                    } catch (e) {
                        console.warn(`adlt got err=${e}`);
                    }
                } else { // !isBinary
                    const text = data.toString();
                    if (text.startsWith("stream:")) {
                        let firstSpace = text.indexOf(" ");
                        const id = Number.parseInt(text.substring(7, firstSpace));
                        if (id === this.streamId) {
                            this.addText(text.substring(firstSpace + 1) + '\n');

                        } else {
                            console.warn(`dlt-logs.AdltDocumentProvider.on(message) stream for id {} exp {}`, id, this.streamId);
                        }
                    } else if (text.startsWith("ok: open ")) {
                        // start stream:
                        this.webSocket.send(`stream {"window":[0,1000000]}`); // set filters: todo
                    } else if (text.startsWith("ok: stream {")) {
                        // expect ok: stream {obj with id, number_filters:...}
                        const streamObj = JSON.parse(text.substring(11));
                        console.log(`dlt-logs.AdltDocumentProvider ok:stream`, JSON.stringify(streamObj));
                        this.streamId = streamObj.id;
                        this.text = "";
                    } else if (text.startsWith("ok: stop stream")) {
                        console.log(`dlt-logs.AdltDocumentProvider ${text}`);
                        // todo verify streamId?
                        this.streamId = 0;
                    } else {
                        console.warn(`dlt-logs.AdltDocumentProvider.on(message) unknown text=`, text);
                    }
                }
            } catch (e) {
                console.warn(`dlt-logs.AdltDocumentProvider.on(message) catch error:`, e);
            }
        });
        this.webSocket.on('open', () => {
            this.webSocket.send(`open ${fileUri.fsPath}`);
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

        this.timerId = setInterval(() => { // todo cancel on dispose!
            this.checkTextUpdates();
        }, 1000);
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
            //this.pendingTextUpdate += text;
            console.error(`adlt.clearText() unhandled case!`);
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

    stopStream() {
        if (this.streamId > 0) {
            this.webSocket.send(`stop ${this.streamId}`);
            this.streamId = -this.streamId;
        }
    }

    startStream() {
        // start stream:
        let filterStr = this.allFilters.map(f => JSON.stringify(f.asConfiguration())).join(',');
        this.webSocket.send(`stream {"window":[0,1000000], "filters":[${filterStr}]}`);
    }

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
        this.stopStream();
        this.clearText();
        // start new stream with current allFilters:
        this.startStream();
        this._applyFilterRunning = false;
    }

    static ecuChar2String(ecuChar: Uint8Array): string {
        return String.fromCharCode(ecuChar[0], ecuChar[1], ecuChar[2], ecuChar[3]);
    }

    // process lifecycle updates from adlt:
    processLifecycleUpdates(lifecycles: Array<remote_types.BinLifecycle>) {
        // todo check for changes compared to last update

        this.lifecycleTreeNode.children = [];// .reset();

        // determine ECUs:
        let ecus: string[] = [];
        lifecycles.forEach(lc => { let ecuStr = AdltDocument.ecuChar2String(lc.ecu); if (!ecus.includes(ecuStr)) { ecus.push(ecuStr); } });

        ecus.forEach(ecu => {
            let sw: string[] = [];
            let ecuNode: TreeViewNode = { id: util.createUniqueId(), label: `ECU: ${ecu}, SW${sw.length > 1 ? `(${sw.length}):` : `:`} ${sw.join(' and ')}`, parent: this.lifecycleTreeNode, children: [], uri: this.uri, tooltip: undefined };
            this.lifecycleTreeNode.children.push(ecuNode);

            // add lifecycles for this ECU:
            lifecycles.filter(l => AdltDocument.ecuChar2String(l.ecu) === ecu).forEach((lc, i) => {
                let lcNode: TreeViewNode = { id: util.createUniqueId(), label: `LC:#${lc.id} #${lc.nr_msgs} `, parent: ecuNode, children: [], uri: this.uri, tooltip: undefined };
                ecuNode.children.push(new LifecycleNode(this.uri.with({ fragment: "0" /*lc.startIndex.toString()*/ }), ecuNode, this.lifecycleTreeNode, { persistentId: lc.id, tooltip: "", getTreeNodeLabel: () => "a tree node label" }, i + 1));
            });
        });
        this._treeEventEmitter.fire(this.lifecycleTreeNode);
        /*
                lifecycles.forEach(l => {
                    console.log(`id=${l.id} ecu=${String.fromCharCode(l.ecu[0], l.ecu[1], l.ecu[2], l.ecu[3])} nr_msgs=${l.nr_msgs}`);
                });*/

    }

    stat(): vscode.FileStat {
        console.warn(`dlt-logs.AdltDocumentProvider.stat()...`);

        return {
            size: this.text.length,
            ctime: this.realStat.ctime.valueOf(),
            mtime: this.realStat.mtime.valueOf(),
            type: vscode.FileType.File
        };
    }

    public text: String;

}

export class ADltDocumentProvider implements vscode.TreeDataProvider<TreeViewNode>, vscode.FileSystemProvider,
    /*vscode.DocumentSymbolProvider,*/ vscode.Disposable {
    private _documents = new Map<string, AdltDocument>();
    private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    private _subscriptions: Array<vscode.Disposable> = new Array<vscode.Disposable>();

    // tree view support:
    private _dltLifecycleTreeView: vscode.TreeView<TreeViewNode> | undefined = undefined;
    private _onDidChangeTreeData: vscode.EventEmitter<TreeViewNode | null> = new vscode.EventEmitter<TreeViewNode | null>();
    readonly onDidChangeTreeData: vscode.Event<TreeViewNode | null> = this._onDidChangeTreeData.event;
    private _treeRootNodes: TreeViewNode[] = []; // one root node per document.


    constructor(context: vscode.ExtensionContext, private _reporter?: TelemetryReporter) {
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
                    if (!this._dltLifecycleTreeView) {
                        // treeView support for log files
                        this._dltLifecycleTreeView = vscode.window.createTreeView('dltLifecycleExplorer', {
                            treeDataProvider: this
                        });
                    }
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
    }

    dispose() {
        console.log("AdltDocumentProvider dispose() called");
        this._documents.clear();

        this._subscriptions.forEach((value) => {
            if (value !== undefined) {
                value.dispose();
            }
        });
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


    // tree view support:
    // lifecycle tree view support:
    public getTreeItem(element: TreeViewNode): vscode.TreeItem {
        console.log(`adlt.getTreeItem(${element.label}, ${element.uri?.toString()}) called.`);
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
        console.log(`adlt.getChildren(${element?.label}, ${element?.uri?.toString()}) this=${this} called (#treeRootNode=${this._treeRootNodes.length}).`);
        if (!element) { // if no element we have to return the root element.
            // console.log(`dlt-logs.getChildren(undefined), returning treeRootNodes`);
            return this._treeRootNodes;
        } else {
            // console.log(`dlt-logs.getChildren(${element?.label}, returning children = ${element.children.length}`);
            return element.children;
        }
    }

    public getParent(element: TreeViewNode): vscode.ProviderResult<TreeViewNode> {
        console.log(`adlt.getParent(${element.label}, ${element.uri?.toString()}) = ${element.parent?.label} called.`);
        return element.parent;
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
                document = new AdltDocument(uri, this._onDidChangeFile, this._onDidChangeTreeData, this._treeRootNodes, this._reporter);
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
            doc = new AdltDocument(uri, this._onDidChangeFile, this._onDidChangeTreeData, this._treeRootNodes, this._reporter);
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
