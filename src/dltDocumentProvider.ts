/* --------------------
 * Copyright(C) Matthias Behr.
 */


import * as vscode from 'vscode';
import * as assert from 'assert';
import * as fs from 'fs';
import { DltDocument } from './dltDocument';

interface SelectedTimeData {
    time: Date;
    uri: vscode.Uri;
};

export interface DltLifecycleNode {
    label: string;
    uri: vscode.Uri | null; // index provided as fragment #<index>
    parent: DltLifecycleNode | null;
    children: DltLifecycleNode[];
};

export class DltDocumentProvider implements vscode.TreeDataProvider<DltLifecycleNode>, vscode.TextDocumentContentProvider,
    vscode.DocumentSymbolProvider, vscode.Disposable {
    private _subscriptions: Array<vscode.Disposable> = new Array<vscode.Disposable>();

    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    private _documents = new Map<string, DltDocument>();
    get onDidChange() {
        return this._onDidChange.event;
    }

    private _dltLifecycleTreeView: vscode.TreeView<DltLifecycleNode> | undefined = undefined;
    private _dltLifecycleRootNode: DltLifecycleNode = { label: "", uri: null, parent: null, children: [] };
    private _onDidChangeTreeData: vscode.EventEmitter<DltLifecycleNode | null> = new vscode.EventEmitter<DltLifecycleNode | null>();
    readonly onDidChangeTreeData: vscode.Event<DltLifecycleNode | null> = this._onDidChangeTreeData.event;

    private _didChangeSelectedTimeSubscriptions: Array<vscode.Disposable> = new Array<vscode.Disposable>();
    private _onDidChangeSelectedTime: vscode.EventEmitter<SelectedTimeData> = new vscode.EventEmitter<SelectedTimeData>();
    readonly onDidChangeSelectedTime: vscode.Event<SelectedTimeData> = this._onDidChangeSelectedTime.event;

    constructor(context: vscode.ExtensionContext) {
        console.log(`DltDocumentProvider()...`);

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
                                // console.log(`smartLogTreeView.onDidChangeSelection. finding editor for ${uriWoFrag}, activeTextEditors=${activeTextEditors.length}`);
                                for (let ind = 0; ind < activeTextEditors.length; ++ind) {
                                    const editor = activeTextEditors[ind];
                                    const editorUri = editor.document.uri.toString();
                                    // console.log(` comparing with ${editorUri}`);
                                    if (editor && uriWoFrag === editorUri) {
                                        let doc = this._documents.get(editorUri);
                                        if (doc) {
                                            const index = +(event.selection[0].uri.fragment);
                                            console.log(`  revealing ${event.selection[0].uri} index ${index}`);
                                            let willBeLine = doc.revealIndex(index);
                                            console.log(`   got willBeLine=${willBeLine}`);
                                            if (willBeLine >= 0) {
                                                editor.revealRange(new vscode.Range(willBeLine, 0, willBeLine + 1, 0), vscode.TextEditorRevealType.AtTop);
                                            }
                                        }
                                    }
                                }

                            }
                        }));
                        this._dltLifecycleTreeView.reveal(doc.lifecycleTreeNode, { focus: true, select: false, expand: true }); // { label: "", uri: null, parent: null, children: [] });
                    }
                }
            }
        }));

        this._subscriptions.push(vscode.workspace.onDidCloseTextDocument((event: vscode.TextDocument) => {
            // todo investigate why we sometimes dont get a onDidClose for our documents??? (we get a didOpen and didChange...)
            const uriStr = event.uri.toString();
            console.log(`DltDocumentProvider onDidCloseTextDocument uri=${uriStr}`);
            // is it one of our documents?
            const doc = this._documents.get(uriStr);
            if (doc) {
                console.log(` found document with uri=${uriStr}`);
                if (doc.textDocument) {
                    console.log(`  deleting document with uri=${doc.textDocument.uri.toString()}`);
                    doc.textDocument = undefined;
                    let childNode: DltLifecycleNode = doc.lifecycleTreeNode;
                    for (let i = 0; i < this._dltLifecycleRootNode.children.length; ++i) {
                        if (this._dltLifecycleRootNode.children[i] === childNode) {
                            this._dltLifecycleRootNode.children.splice(i, 1);
                            console.log(`  deleting rootNode with #${i}`);
                            break;
                        }
                    }
                    this._documents.delete(uriStr);
                    this._onDidChangeTreeData.fire(this._dltLifecycleRootNode);
                }
            }
        }));
        // check for changes of the documents
        this._subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
            let uriStr = event.document.uri.toString();
            console.log(`DltDocumentProvider onDidChangeTextDocument uri=${uriStr}`);
            let data = this._documents.get(uriStr);
            if (data) {
                this._onDidChangeTreeData.fire(data.lifecycleTreeNode); // can't use the node here yet. need to ensure first that its always part of the tree...
                this._dltLifecycleTreeView?.reveal(data.lifecycleTreeNode, { select: false, focus: false, expand: true });
                // e.g. by adding to the root node directly on opening the document. todo
                //this.updateData(data);
                // update decorations:

                if (data.decorations && data.textEditors) {
                    // set decorations // todo check that it's really on the already updated content...
                    data.textEditors.forEach((editor) => {
                        data?.decorations?.forEach((value, key) => {
                            editor.setDecorations(key, value);
                        });
                    });
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
                    this._onDidChangeTreeData.fire(data.lifecycleTreeNode);
                    this._dltLifecycleTreeView?.reveal(data.lifecycleTreeNode, { select: false, focus: true, expand: true });
                    //this.checkActiveTextEditor(data);
                    //this.updateDecorations(data);
                }
            }
        }));

        this._subscriptions.push(vscode.window.onDidChangeVisibleTextEditors((editors: vscode.TextEditor[]) => {
            // console.log(`DltDocumentProvider.onDidChangeVisibleTextEditors= ${editors.length}`);
            // todo update tree view to only contain the visible ones...
        }));

        // todo doesn't work with skipped msgs... this._subscriptions.push(vscode.languages.registerDocumentSymbolProvider('dlt-log', this, { label: "DLT Lifecycles" }));

        // announce time updates on selection of lines:
        // counterpart to handleDidChangeSelectedTime... 
        this._subscriptions.push(vscode.window.onDidChangeTextEditorSelection(async (ev) => {
            let data = this._documents.get(ev.textEditor.document.uri.toString());
            if (data) {
                // ev.kind: 1: Keyboard, 2: Mouse, 3: Command
                // we do only take single selections.
                if (ev.selections.length === 1) {
                    const line = ev.selections[0].active.line; // 0-based
                    // determine time:
                    const time = data.provideTimeByLine(line);
                    if (time) {
                        // post time update... todo consider debouncing the events by e.g. 100ms...
                        console.log(` dlt-log posting time update ${time.toLocaleTimeString()}.${String(time.valueOf() % 1000).padStart(3, "0")}`);
                        this._onDidChangeSelectedTime.fire({ time: time, uri: data.uri });
                    }
                }
            }
        }));

        // visible range
        this._subscriptions.push(vscode.window.onDidChangeTextEditorVisibleRanges(async (e) => {
            if (e.visibleRanges.length === 1) {
                const doc = this._documents.get(e.textEditor.document.uri.toString());
                if (doc) {
                    // console.log(`dlt-log.onDidChangeTextEditorVisibleRanges(${e.visibleRanges[0].start.line}-${e.visibleRanges[0].end.line})`);
                    doc.notifyVisibleRange(e.visibleRanges[0]);
                }
            }
        }));

        // hover provider:
        this._subscriptions.push(vscode.languages.registerHoverProvider({ scheme: "dlt-log" }, this));

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

    async provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): Promise<string | undefined> {
        // already loaded?
        let document = this._documents.get(uri.toString());
        if (document) {
            return document.text;
        }

        document = new DltDocument(uri, this._onDidChange, this._dltLifecycleRootNode);
        this._documents.set(uri.toString(), document);
        this._onDidChangeTreeData.fire();
        token.onCancellationRequested(() => {
            console.log(`cancellation requested for uri=${uri.toString()}`);
        });
        return document.text;
    }

    // lifecycle tree view support:
    public getTreeItem(element: DltLifecycleNode): vscode.TreeItem {
        // console.log(`smart-log.getTreeItem(${element.label}, ${element.uri?.toString()}) called.`);
        return {
            label: element.label.length ? element.label : "<no events>",
            collapsibleState: element.children.length ? vscode.TreeItemCollapsibleState.Collapsed : void 0,
            iconPath: /* (element.children.length === 0 && element.label.startsWith("xy")) ? path.join(__filename, '..', '..', 'media', 'root-folder.svg') : */ undefined // todo!
        };
    }

    public getChildren(element?: DltLifecycleNode): DltLifecycleNode[] | Thenable<DltLifecycleNode[]> {
        // console.log(`smart-log.getChildren(${element?.label}, ${element?.uri?.toString()}) this=${this} called.`);
        if (!element) { // if no element we have to return the root element.
            let toRet: DltLifecycleNode[] = [];
            this._documents.forEach((doc) => {
                toRet.push(doc.lifecycleTreeNode);
            });
            if (toRet.length) {
                return toRet;
            } else {
                return [{ label: "", uri: null, parent: null, children: [] }];
            }
            /*
            // check whether we have a EventNode for the current document:
            const doc = vscode.window.activeTextEditor?.document;
            if (doc && this) {
                const node = this._documents.get(doc.uri.toString())?.lifecycleTreeNode;
                if (node) {
                    // console.log(` eventTreeNode for doc ${doc.uri.toString()} found`);
                    return [node];
                }
                console.log(` no eventTreeNode for doc ${doc.uri.toString()} available`);
            }
            return [{ label: "", uri: null, parent: null, children: [] }]; */
        } else {
            return element.children;
        }
    }

    public getParent(element: DltLifecycleNode): vscode.ProviderResult<DltLifecycleNode> {
        // console.log(`smart-log.getParent(${element.label}, ${element.uri?.toString()}) called.`);
        return element.parent;
    }

    handleDidChangeSelectedTime(ev: SelectedTimeData) {
        console.log(`dlt-log.handleDidChangeSelectedTime got ev from uri=${ev.uri.toString()}`);
        this._documents.forEach((doc) => {
            if (doc.uri.toString() !== ev.uri.toString()) { // avoid reacting on our own events...
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

}
