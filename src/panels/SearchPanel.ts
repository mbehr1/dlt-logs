import { Disposable, Webview, Event, Uri, WebviewViewProvider, WebviewView, CancellationToken, WebviewViewResolveContext, window as vscodeWindow, commands, TextEditor, TextEditorEdit, ExtensionContext } from "vscode";
import { getNonce, getUri } from "../util";
import { ADltDocumentProvider, AdltDocument } from "../adltDocumentProvider";
import { DltFilter, DltFilterType } from "../dltFilter";
import { ViewableDltMsg } from "../dltParser";

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
                // todo inform webview, stop pending searches?
                // store last search for doc?
                this._activeDoc = doc;
                this._view?.webview.postMessage({
                    type: 'docUpdate',
                    docUri: doc ? doc.uri.toString() : null,
                });
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

    public commandSearch(textEditor: TextEditor, edit: TextEditorEdit, ...args: any[]) {
        console.log(`SearchPanel.commandSearch(#args=${args.length})...`);
        // for now simply reveal the panel
        this._view?.show(false);
        this._view?.webview.postMessage({ type: 'focus' });
    }

    /**
     * Cleans up and disposes of webview resources when the webview panel is closed.
     */
    public dispose() {
        console.log(`SearchPanel.dispose()...`);
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

    private _CurSearchId = 0;
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
                        console.warn(`SearchPanel: sAr cmd:${JSON.stringify(message.req)}`);
                        // need to send a response for that id:
                        let res = null;
                        switch (req.cmd) {
                            case 'search':
                                {
                                    const searchReq: { searchString: string, useRegex: boolean, useCaseSensitive: boolean, useFilter: boolean } = req.data;
                                    // cancel any existing search request
                                    // trigger new one
                                    if (this._activeDoc && searchReq.searchString.length > 0) {
                                        res = undefined;
                                        // todo impl useCaseSensitive...
                                        const doc = this._activeDoc;
                                        const searchFilter = new DltFilter({ 'type': DltFilterType.NEGATIVE, not: true, payloadRegex: searchReq.useRegex ? searchReq.searchString : undefined, payload: searchReq.useRegex ? undefined : searchReq.searchString }, false);
                                        const filters = (searchReq.useFilter ? [...doc.allFilters.filter(f => (f.type === DltFilterType.POSITIVE || f.type === DltFilterType.NEGATIVE) && f.enabled), searchFilter] : [searchFilter]);
                                        //console.log(`SearchPanel filters=${JSON.stringify(filters.map(f => f.asConfiguration()))}`); <- reports enabled possibly wrong
                                        let decFilters = doc.allFilters.filter(f => (f.type === DltFilterType.MARKER || ((f.type === DltFilterType.POSITIVE) && (f.decorationId !== undefined || f.filterColour !== undefined))) && f.enabled);
                                        doc.getMatchingMessages(filters, 1000).then((msgs) => {
                                            // use DltDocument.textLinesForMsgs(doc._columns, viewMsgs, viewMsgsLength - nrNewMsgs, viewMsgsLength - 1, 8 /*todo*/, undefined).then((newTxt: string) => {?
                                            // post here only the number? and msgs at 'load' only?
                                            webview.postMessage({
                                                type: 'sAr',
                                                id: msgId,
                                                res: msgs.map((fm) => {
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
                                            });
                                        });
                                    } else {
                                        // return an error
                                        res = { err: 'no active adlt document available! Select one first.' };
                                    }
                                }
                                break;
                            case 'load': // todo
                            // stop stream once webview visibility=false
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