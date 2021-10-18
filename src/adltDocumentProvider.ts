/* --------------------
 * Copyright(C) Matthias Behr.
 */


import * as vscode from 'vscode';
import TelemetryReporter from 'vscode-extension-telemetry';
import * as fs from 'fs';
import * as WebSocket from 'ws';
import { TreeViewNode, FilterNode } from './dltTreeViewNodes';

class AdltDocument {
    private realStat: fs.Stats;
    private webSocket: WebSocket;
    private streamId: number; // 0 none

    private editPending: boolean = false;
    private pendingTextUpdate: string = "";
    private timerId: NodeJS.Timeout;

    constructor(private uri: vscode.Uri, private emitDocChanges: vscode.EventEmitter<vscode.FileChangeEvent[]>) {
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
        this.webSocket.binaryType = "nodebuffer"; // or Arraybuffer?
        this.webSocket.on("message", (data: Buffer, isBinary) => {
            try {
                if (isBinary) {
                    console.warn(`dlt-logs.AdltDocumentProvider.on(message)`, data.byteLength, isBinary);
                } else { // !isBinary
                    const text = data.toString();
                    if (text.startsWith("stream:")) {
                        let firstSpace = text.indexOf(" ");
                        const id = Number.parseInt(text.substr(7, firstSpace - 7));
                        if (id === this.streamId) {
                            this.addText(text.substr(firstSpace + 1) + '\n');

                        } else {
                            console.warn(`dlt-logs.AdltDocumentProvider.on(message) stream for id {} exp {}`, id, this.streamId);
                        }
                    } else if (text.startsWith("ok: open ")) {
                        // start stream:
                        this.webSocket.send(`stream {"window":[0,1000000]}`); // set filters: todo
                    } else if (text.startsWith("ok: stream {")) {
                        // expect ok: stream {obj with id, number_filters:...}
                        const streamObj = JSON.parse(text.substr(11));
                        console.log(`dlt-logs.AdltDocumentProvider ok:stream`, JSON.stringify(streamObj));
                        this.streamId = streamObj.id;
                        this.text = "";
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

export class ADltDocumentProvider implements /*vscode.TreeDataProvider<TreeViewNode>,*/ vscode.FileSystemProvider,
    /*vscode.DocumentSymbolProvider,*/ vscode.Disposable {
    private _documents = new Map<string, AdltDocument>();
    private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    private _subscriptions: Array<vscode.Disposable> = new Array<vscode.Disposable>();

    constructor(context: vscode.ExtensionContext, private _reporter?: TelemetryReporter) {
        console.log(`dlt-logs.AdltDocumentProvider()...`);

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
                document = new AdltDocument(uri, this._onDidChangeFile);//, this._onDidChangeTreeData, this._treeRootNodes, this._reporter);
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
            doc = new AdltDocument(uri, this._onDidChangeFile);//, this._onDidChangeTreeData, this._treeRootNodes, this._reporter);
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
