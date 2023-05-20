import { Disposable, Webview, Event, Uri, WebviewViewProvider, WebviewView, CancellationToken, WebviewViewResolveContext, window as vscodeWindow, commands, TextEditor, TextEditorEdit, ExtensionContext } from "vscode";
import { getNonce, getUri } from "../util";
import { ADltDocumentProvider, AdltDocument, StreamMsgData } from "../adltDocumentProvider";
import { DltFilter, DltFilterType } from "../dltFilter";
import { FilterableDltMsg, ViewableDltMsg } from "../dltParser";

/**
 * Provide a Search Dialog webview
 *
 */

export class SearchPanelProvider implements WebviewViewProvider {

    public static readonly viewType = "mbehr1DltLogsSearch";

    private readonly _extensionUri: Uri;
    public _view?: WebviewView;

    private _disposables: Disposable[] = [];

    private _activeDoc?: AdltDocument;
    private _onApplyFilterDisp?: Disposable;

    constructor(context: ExtensionContext, private _adltDocProvider: ADltDocumentProvider, private _onDidChangeActiveRestQueryDoc: Event<Uri | undefined>) {
        console.log(`SearchPanel()...`);
        this._extensionUri = context.extensionUri;
        context.subscriptions.push(vscodeWindow.registerWebviewViewProvider(SearchPanelProvider.viewType, this));
        context.subscriptions.push(commands.registerTextEditorCommand('dlt-logs.search', (textEditor, edit, ...args) => { this.commandSearch(textEditor, edit, args); }, this));

        _onDidChangeActiveRestQueryDoc((uri) => {

            //console.log(`SearchPanel. activeDocument:${uri?.toString()}`);
            const doc = uri ? this._adltDocProvider._documents.get(uri.toString()) : undefined;
            if (doc !== this._activeDoc) {
                console.log(`SearchPanel. new activeDocument:${doc?.uri.toString()}`);
                // stop pending searches
                if (this.curStreamLoader) {
                    this.curStreamLoader.dispose();
                    this.curStreamLoader = undefined;
                }
                // store last search for doc?
                this._activeDoc = doc;
                // inform webview
                this._view?.webview.postMessage({
                    type: 'docUpdate',
                    docUri: doc ? doc.uri.toString() : null,
                });

                if (this._onApplyFilterDisp) {
                    this._onApplyFilterDisp.dispose();
                    this._onApplyFilterDisp = undefined;
                }
                if (doc) {
                    this._onApplyFilterDisp = doc.onApplyFilter(() => {
                        console.log(`SearchPanel. onApplyFilter event`);
                        this._view?.webview.postMessage({
                            type: 'docUpdate',
                            onApplyFilter: true,
                        });
                    });
                }
            }
        }, this._disposables);
    }

    public resolveWebviewView(webviewView: WebviewView, context: WebviewViewResolveContext<unknown>, token: CancellationToken): void | Thenable<void> {
        console.log(`SearchPanel.resolveWebviewView()...`);
        this._view = webviewView;
        webviewView.webview.options = {
            // Enable JavaScript in the webview
            enableScripts: true,
            // Restrict the webview to only load resources from the `out` and `webview-ui/build` directories
            localResourceRoots: [Uri.joinPath(this._extensionUri, "out"), Uri.joinPath(this._extensionUri, "webviews/search/build"), Uri.joinPath(this._extensionUri, "node_modules/@vscode/codicons/dist")]
        };

        webviewView.webview.html = this._getWebviewContent(webviewView.webview);
        webviewView.onDidDispose(() => {
            console.log(`SearchPanelProvider.webview.onDidDispose()...`);
            this._view = undefined;
        }, this, this._disposables);
        this._setWebviewMessageListener(webviewView.webview);
        webviewView.onDidChangeVisibility(() => {
            console.log(`SearchPanelProvider.webview.onDidChangeVisibility()...visible=${this._view?.visible}`);
        });
    }

    public async commandSearch(textEditor: TextEditor, edit: TextEditorEdit, ...args: any[]) {
        console.log(`SearchPanel.commandSearch(#args=${args.length})...`);
        if (!this._view) {
            await commands.executeCommand('workbench.view.extension.mbehr1DltLogsSearch');
            // dirty hack:
            setTimeout(() => {
                if (this._view) {
                    this._view.webview.postMessage({ type: 'focus' });
                } else {
                    console.warn(`SearchPanel.commandSearch after 1s no view...`);
                }
            }, 1000);
        } else {
            // for now simply reveal the panel
            this._view.show(false);
            this._view.webview.postMessage({ type: 'focus' });
        }
    }

    /**
     * Cleans up and disposes of webview resources when the webview panel is closed.
     */
    public dispose() {
        console.log(`SearchPanel.dispose()...`);
        if (this._onApplyFilterDisp) {
            this._onApplyFilterDisp.dispose();
            this._onApplyFilterDisp = undefined;
        }
        if (this.curStreamLoader) {
            this.curStreamLoader.dispose();
            this.curStreamLoader = undefined;
        }

        // Dispose of all disposables (i.e. commands) for the current webview panel
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }

    /**
     * Defines and returns the HTML that should be rendered within the webview panel.
     *
     * @remarks This is also the place where references to the React webview build files
     * are created and inserted into the webview HTML.
     *
     * @param webview A reference to the extension webview
     * @param extensionUri The URI of the directory containing the extension
     * @returns A template string literal containing the HTML that should be
     * rendered within the webview panel
     */
    private _getWebviewContent(webview: Webview) {
        console.log(`SearchPanel._getWebviewContent()...`);
        // The CSS file from the React build output
        const stylesUri = getUri(webview, this._extensionUri, ["webviews", "search", "build", "assets", "index.css"]);
        // The JS file from the React build output
        const scriptUri = getUri(webview, this._extensionUri, ["webviews", "search", "build", "assets", "index.js"]);

        // todo: loading icons as fonts codicon.ttf in vite bundle seems to fail. try:
        // added unsafe-inline already
        // https://github.com/cssninjaStudio/unplugin-fonts
        // or some vite options/plugins?

        // for now load here as well so that css is known:
        // once that's resolved it should be enough to load from the panel...
        // currently we always get a 401 from the once from the panel...

        const codiconsUri = getUri(webview, this._extensionUri, ['node_modules', '@vscode/codicons', 'dist', 'codicon.css']);

        const nonce = getNonce();

        // Tip: Install the es6-string-html VS Code extension to enable code highlighting below
        return /*html*/ `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
          <link rel="stylesheet" type="text/css" href="${stylesUri}">
          <link rel="stylesheet" href="${codiconsUri}">
          <title>DLT-Logs Search Window</title>
        </head>
        <body>
          <div id="root"></div>
          <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
        </body>
      </html>
    `;
    }

    private curStreamLoader?: DocStreamLoader;
    private lastMsgId = -1;

    /**
     * Sets up an event listener to listen for messages passed from the webview context and
     * executes code based on the message that is recieved.
     *
     * @param webview A reference to the extension webview
     * @param context A reference to the extension context
     */
    private _setWebviewMessageListener(webview: Webview) {
        webview.onDidReceiveMessage(
            (message: any) => {
                const msgType = message.type;
                const req = message.req;
                const msgId = message.id;
                switch (msgType) {
                    case 'sAr':
                        if (msgId < this.lastMsgId) {
                            console.error(`SearchPanel: msgId ${msgId} < last ${this.lastMsgId}`);
                        }
                        // console.log(`SearchPanel: sAr cmd:${JSON.stringify(req)}`);
                        // need to send a response for that id:
                        let res: { err: string } | undefined = undefined;
                        switch (req.cmd) {
                            case 'search':
                                {
                                    const searchReq: { searchString: string, useRegex: boolean, useCaseSensitive: boolean, useFilter: boolean } = req.data;
                                    // trigger new one
                                    // todo check if searchReg is the same as last time (e.g. if webview gets hidden/reopened) and keep current one?

                                    if (this._activeDoc && searchReq.searchString.length > 0) {
                                        // cancel any existing search request
                                        if (this.curStreamLoader) {
                                            this.curStreamLoader.dispose();
                                            this.curStreamLoader = undefined;
                                        }
                                        res = undefined;
                                        //console.log(`SearchPanel filters=${JSON.stringify(filters.map(f => f.asConfiguration()))}`); <- reports enabled possibly wrong
                                        try {
                                        const doc = this._activeDoc;
                                        const searchFilter = new DltFilter({ 'type': DltFilterType.NEGATIVE, not: true, ignoreCasePayload: searchReq.useCaseSensitive ? undefined : true, payloadRegex: searchReq.useRegex ? searchReq.searchString : undefined, payload: searchReq.useRegex ? undefined : searchReq.searchString }, false);
                                            const filters = (searchReq.useFilter ? [...doc.allFilters.filter(f => (f.type === DltFilterType.POSITIVE || f.type === DltFilterType.NEGATIVE) && f.enabled), searchFilter] : [searchFilter]);
                                            this.curStreamLoader = new DocStreamLoader(doc, filters, () => {
                                                // console.warn(`SearchPanel: sAr cmd search got new DocStreamLoader`);
                                                webview.postMessage({
                                                    type: 'sAr',
                                                    id: msgId,
                                                    res: []
                                                });
                                            },
                                                (nrStreamMsgs, nrMsgsProcessed, nrMsgsTotal) => {
                                                    webview.postMessage({
                                                        type: 'streamInfo',
                                                        streamInfo: {
                                                            nrStreamMsgs,
                                                            nrMsgsProcessed,
                                                            nrMsgsTotal
                                                        }
                                                    });
                                                });
                                        } catch (e) {
                                            console.warn(`SearchPanel: sAr cmd search new DocStreamLoader failed with: ${e}`);
                                            res = { err: `search cmd failed with: ${e}` };
                                        }
                                    } else {
                                        // return an error
                                        res = { err: 'no active adlt document available! Select one first.' };
                                    }
                                }
                                break;
                            case 'load': // todo
                                // stop stream once webview visibility=false
                                const { startIdx, stopIdx } = req.data;
                                if (this._activeDoc && this.curStreamLoader) {
                                    const doc = this._activeDoc;
                                    let decFilters = doc.allFilters.filter(f => (f.type === DltFilterType.MARKER || ((f.type === DltFilterType.POSITIVE) && (f.decorationId !== undefined || f.filterColour !== undefined))) && f.enabled);
                                    const msgs = this.curStreamLoader.getMsgs(startIdx, stopIdx >= startIdx ? (stopIdx - startIdx) + 1 : 0);
                                    const processMsgs = (msgs: FilterableDltMsg[]) => {
                                        webview.postMessage({
                                            type: 'sAr',
                                            id: msgId,
                                            res: {
                                                msgs: msgs.map((fm) => {
                                                    const m = fm as ViewableDltMsg;
                                                    // gather decorations:
                                                    const decs = doc.getDecorationsTypeAndHoverMDForMsg(m, decFilters).map(([decInfo, hoverMd]) => {
                                                        return decInfo.decOptions;
                                                    });

                                                    return {
                                                        index: m.index,
                                                        receptionTimeInMs: m.receptionTimeInMs,
                                                        calculatedTimeInMs: doc.provideTimeByMsg(m)?.valueOf(),
                                                        timeStamp: m.timeStamp,
                                                        ecu: m.ecu,
                                                        mcnt: m.mcnt,
                                                        apid: m.apid,
                                                        ctid: m.ctid,
                                                        payloadString: m.payloadString,
                                                        lifecycle: m.lifecycle ? m.lifecycle.persistentId : undefined,
                                                        decs,
                                                    };
                                                })
                                            }
                                        });
                                    };
                                    if (Array.isArray(msgs)) {
                                        processMsgs(msgs);
                                        res = undefined;
                                    } else {
                                        msgs.then(msgs => {
                                            //console.log(`SearchPanel: promise resolved with #${msgs.length}`);
                                            processMsgs(msgs);
                                        }).catch(e => {
                                            console.warn(`SearchPanel: promise rejected with '${e}'`);
                                        });
                                        res = undefined;
                                    }
                                } else {
                                    res = { err: 'no active adlt document available! Select one first.' };
                                }
                                break;
                            default:
                                console.warn(`SearchPanel: unexpected sAr cmd:${JSON.stringify(message)}`);
                        }
                        if (res !== undefined) {
                            webview.postMessage({
                                type: 'sAr',
                                id: msgId,
                                res
                            });
                        }
                        break;
                    case 'click':
                        console.log(`SearchPanel: click:${JSON.stringify(req)}`);
                        if (req.timeInMs) {
                            // todo support revealByIndex(req.index) and only fallback to time... (or add to revealDate...)
                            this._activeDoc?.revealDate(new Date(req.timeInMs));
                        }
                        break;
                    case 'hello': // webview loaded/reloaded, send current doc if any (as the updates might have been missed)
                        console.log(`SearchPanel: webview send hello:${JSON.stringify(req)}`);
                        if (this._activeDoc) {
                            // inform webview about activeDoc
                            webview.postMessage({
                                type: 'docUpdate',
                                docUri: this._activeDoc.uri.toString(),
                            });
                        }
                        break;
                    default:
                        console.warn(`SearchPanel: unexpected msg:${JSON.stringify(message)}`);
                }
            },
            undefined,
            this._disposables
        );
    }
}

class DocStreamLoader {
    static readonly windowSize = 1000; // initial / on re-load size

    private streamId: number = NaN;
    private streamIdUpdatePending = true;
    private streamData: StreamMsgData;
    private curWindow: [number, number]; // eg. [100-200)

    constructor(private doc: AdltDocument, private filters: DltFilter[],
        private onOk: () => void,
        private onStreamInfoChange?: (nrStreamMsgs: number, nrMsgsProcessed: number, nrMsgsTotal: number) => void) {
        this.streamData = {
            msgs: [],
            sink: {
                onDone: this.sinkOnDone.bind(this),
                onNewMessages: this.sinkOnNewMessages.bind(this),
                onStreamInfo: this.sinkOnStreamInfo.bind(this),
            }
        };
        this.curWindow = [0, DocStreamLoader.windowSize];
        doc.startMsgsStream(filters, this.curWindow, this.streamData).then(streamId => {
            this.streamId = streamId;
            this.streamIdUpdatePending = false;
            onOk();
        }).catch(e => {
            console.error(`SearchPanel DocStreamLoader() got error:${e}`);
            throw (e);
        });
    }

    requestNewWindow(newWindow: [number, number]) {
        if (!this.streamIdUpdatePending) {
            this.streamData.msgs = [];
            this.curWindow = [newWindow[0], newWindow[1]];
            console.info(`SearchPanel DocStreamLoader requestNewWindow([${newWindow[0]}-${newWindow[1]}))[${this.curWindow[0]}-${this.curWindow[1]})`);
            this.streamIdUpdatePending = true;
            this.doc.changeMsgsStreamWindow(this.streamId, newWindow).then(streamId => {
                //console.info(`SearchPanel DocStreamLoader requestNewWindow([${newWindow[0]}-${newWindow[1]})) got new streamId=${streamId}`);
                this.streamId = streamId;
                this.streamIdUpdatePending = false;
            });
        } else {
            console.warn(`SearchPanel DocStreamLoader requestNewWindow update pending, ignored!`);
        }
    }

    private sinkOnDone() {
        console.warn(`SearchPanel DocStreamLoader sink.onDone()...`);
    }

    private sinkOnNewMessages(nrNewMsgs: number) {
        console.info(`SearchPanel DocStreamLoader sink.onNewMessages(${nrNewMsgs}) queuedRequests=${this.queuedRequests.length}...`);
        // any pending requests that can be fulfilled?
        for (let i = 0; i < this.queuedRequests.length; ++i) {
            const [startIdx, maxNrMsgs, resolve, reject] = this.queuedRequests[i];
            const msgs = this.getAvailMsgs(startIdx, maxNrMsgs, false);
            if (msgs) {
                //console.warn(`SearchPanel DocStreamLoader sink.onNewMessages(${nrNewMsgs}) queuedRequest#${i}.resolve(#${msgs.length})`);
                resolve(msgs);
                this.queuedRequests.splice(i, 1);
                i -= 1;
            }
        }
        if (this.queuedRequests.length > 0) {
            // console.warn(`SearchPanel DocStreamLoader sink.onNewMessages(${nrNewMsgs}) queuedRequests ${this.queuedRequests.length} > 0!`);
            // as the prev requestNewWindow might have been ignored, see whether we do need to retry here:
            // we do this only for the first in the queue:
            const [startIdx, maxNrMsgs, resolve, reject] = this.queuedRequests[0];
            const inWindow = startIdx >= this.curWindow[0] && startIdx < this.curWindow[1];
            if (!inWindow) {
                console.log(`SearchPanel DocStreamLoader sink.onNewMessages(${nrNewMsgs}) queuedRequests ${this.queuedRequests.length} > 0: requesting new window with ${startIdx} ${maxNrMsgs}`);
                this.tryRequestNewWindow(startIdx, maxNrMsgs, true);
            }
        }
    }

    private sinkOnStreamInfo(nrStreamMsgs: number, nrMsgsProcessed: number, nrMsgsTotal: number) {
        // console.info(`SearchPanel DocStreamLoader sink.onStreamInfo(${nrStreamMsgs},${nrMsgsProcessed}, ${nrMsgsTotal} )...`);
        if (this.onStreamInfoChange) { this.onStreamInfoChange(nrStreamMsgs, nrMsgsProcessed, nrMsgsTotal); }
    }

    /**
     * try to request a new window.
     * 
     * This might fail if an update is currently pending.
     * A request is only triggered if:
     * - currently no streamIdUpdatePending and
     * - ignoreCurMsgs set or streamData contain already msgs.
     * 
     * This is to avoid constantly triggering a window change without waiting for the onNewMsgs callback/data. 
     * @param startIdx 
     * @param maxNumberOfMsgs 
     * @param ignoreCurMsgs 
     */
    private tryRequestNewWindow(startIdx: number, maxNumberOfMsgs: number, ignoreCurMsgs?: boolean) {
        if (!this.streamIdUpdatePending && (ignoreCurMsgs || this.streamData.msgs.length > 0)) {
            // calc new window position: (for now simply [startIdx..)
            let newWindow: [number, number];
            if (startIdx >= this.curWindow[1]) {
                newWindow = [startIdx, startIdx + DocStreamLoader.windowSize];
            } else {
                // before current window, avoid overlapping loading but ensure all wanted are contained:
                const endIdxWanted = startIdx + maxNumberOfMsgs;
                const newStartIdx = Math.max(0, endIdxWanted - DocStreamLoader.windowSize);
                newWindow = [newStartIdx, newStartIdx + DocStreamLoader.windowSize];
            }

            // console.log(`SearchPanel DocStreamLoader.getMsgs(${startIdx}, #${maxNumberOfMsgs}) !inWindow [${this.curWindow[0]}-${this.curWindow[1]}). Changing window to [${newWindow[0]}-${newWindow[1]})`);
            this.requestNewWindow(newWindow);
        }
    }

    /**
     * return messages either directly from current data or after loading
     * 
     * It's intended for only one request at a time (until the promise is resolved).
     * 
     * If at least one message is directly available it's returned. Not the full requested amount is returned!
     * @param startIdx - abs. message index (not relative to window) to return
     * @param maxNumberOfMsgs - max number of msgs returned
     */
    getMsgs(startIdx: number, maxNumberOfMsgs: number): FilterableDltMsg[] | Promise<FilterableDltMsg[]> {
        // is the startIdx available?
        const inWindow = startIdx >= this.curWindow[0] && startIdx < this.curWindow[1];
        if (inWindow) {
            const msgs = this.getAvailMsgs(startIdx, maxNumberOfMsgs, true);
            if (msgs) {
                return msgs;
            } else {
                console.log(`SearchPanel DocStreamLoader.getMsgs inWindow but not avail. Added to queue.`);
                return new Promise<FilterableDltMsg[]>((resolve, reject) => {
                    this.queuedRequests.push([startIdx, maxNumberOfMsgs, resolve, reject]);
                });
            }
        } else { // need to request that window first
            this.tryRequestNewWindow(startIdx, maxNumberOfMsgs);
            // queue request
            return new Promise<FilterableDltMsg[]>((resolve, reject) => {
                this.queuedRequests.push([startIdx, maxNumberOfMsgs, resolve, reject]);
            });
        }
        return [];
    }
    private queuedRequests: [number, number, (msgs: FilterableDltMsg[] | PromiseLike<FilterableDltMsg[]>) => void, (reason?: any) => void][] = [];

    getAvailMsgs(startIdx: number, maxNumberOfMsgs: number, triggerExtend: boolean): FilterableDltMsg[] | undefined {
        const maxIndexAvail = this.curWindow[0] + this.streamData.msgs.length - 1;
        if (startIdx <= maxIndexAvail) {
            const startOffset = startIdx - this.curWindow[0];
            if (startOffset < 0) { return undefined; }
            const endOffsetWanted = startOffset + maxNumberOfMsgs;
            const msgs = this.streamData.msgs.slice(startOffset, endOffsetWanted);
            return msgs;
        } else {
            //console.warn(`SearchPanel DocStreamLoader.getAvailMsgs(${startIdx}) not avail > ${maxIndexAvail} [${this.curWindow[0]}-${this.curWindow[1]})`);
        }
        return undefined;
    }

    dispose() {
        if (!isNaN(this.streamId)) {
            this.doc.stopMsgsStream(this.streamId);
            this.streamId = NaN;
            this.streamData.msgs = [];
        }
    }
}