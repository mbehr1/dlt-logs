/* --------------------
 * Copyright(C) Matthias Behr.
 */


import * as vscode from 'vscode';

import { dltScheme } from './constants';

class DltLogCustomDocument implements vscode.CustomDocument {
    constructor(public uri: vscode.Uri) {
        console.log(`DltLogCustomDocument(uri=${uri.toString()})`);
    }
    dispose() {
        console.log(`DltLogCustomDocument.dispose()`);
    }
}

/*
 We want to be able to open the DLT files directly (via file open, drag+drop,...) but this is not supported for 
 non-webview based extensions.
 So as dirty hack we got two options:
 a) fail on opening: that leads to an error/warning but opens the document then anyhow ;-) or
 b) open and close automatically: a bit risky and not nicely/smooth looking...

 But both solutions have a negative impact: it tries to reopen the same file on moving into a different view.
 Tries to open them even though they start with "dlt-log:" schema. Would need to workaround that by changing the extension
 as well.
 */

export class DltLogCustomReadonlyEditorProvider implements vscode.CustomReadonlyEditorProvider<DltLogCustomDocument> {
    openCustomDocument(uri: vscode.Uri, openContext: vscode.CustomDocumentOpenContext, token: vscode.CancellationToken): Thenable<DltLogCustomDocument> | DltLogCustomDocument {
        console.log(`DltLogCustomReadonlyEditorProvider.openCustomDocument(uri=${uri.toString()})`);
        setTimeout(() => { // open slightly later the real document
            let dltUri = uri.with({ scheme: dltScheme });
            vscode.workspace.openTextDocument(dltUri).then((value) => { vscode.window.showTextDocument(value, { preview: false }); });
        }, 250);
        // for a)
        throw Error(`Please use 'Open DLT file...' command next time.`);
        return new DltLogCustomDocument(uri);
    }

    resolveCustomEditor(document: DltLogCustomDocument, webviewPanel: vscode.WebviewPanel, token: vscode.CancellationToken): Thenable<void> | void {
        console.log(`DltLogCustomReadonlyEditorProvider.resolveCustomEditor(document.uri=${document.uri.toString()})`);
        webviewPanel.webview.html = `Please use "Open DLT file..." command to open DLT documents.`;
        if (false) { // needed for b) only
            setTimeout(() => {
                console.log(`resolveCustomEditor timeout: ${vscode.window.activeTextEditor?.document.uri}`);
                // the api doesn't allow to specify a document. so its a bit risky.
                if (vscode.window.activeTextEditor === undefined || vscode.window.activeTextEditor.document.uri === document.uri) {
                    vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                }
            }, 100);
        }
    }
}
