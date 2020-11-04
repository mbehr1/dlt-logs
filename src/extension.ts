/* --------------------
* Copyright (C) Matthias Behr, 2020
*/

import * as vscode from 'vscode';
import TelemetryReporter from 'vscode-extension-telemetry';
import * as dltDocument from './dltDocumentProvider';
import { exportDlt } from './dltExport';
// import { DltLogCustomReadonlyEditorProvider } from './dltCustomEditorProvider';

const extensionId = 'mbehr1.dlt-logs';
const dltScheme = 'dlt-log';
let reporter: TelemetryReporter;

export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated

	console.log(`${extensionId} is now active!`);
	const extension = vscode.extensions.getExtension(extensionId);

	if (extension) {
		const extensionVersion = extension.packageJSON.version;

		// the aik is not really sec_ret. but lets avoid bo_ts finding it too easy:
		const strKE = 'ZjJlMDA4NTQtNmU5NC00ZDVlLTkxNDAtOGFiNmIzNTllODBi';
		const strK = Buffer.from(strKE, "base64").toString();
		reporter = new TelemetryReporter(extensionId, extensionVersion, strK);
		context.subscriptions.push(reporter);
		reporter?.sendTelemetryEvent('activate');
	} else {
		console.log(`${extensionId}: not found as extension!`);
	}

	// register our document provider that knows how to handle "dlt-logs"
	let dltProvider = new dltDocument.DltDocumentProvider(context, reporter);
	context.subscriptions.push(vscode.workspace.registerFileSystemProvider(dltScheme, dltProvider, { isReadonly: false, isCaseSensitive: true }));

	// register our command to open dlt files as "dlt-logs":
	context.subscriptions.push(vscode.commands.registerCommand('dlt-logs.dltOpenFile', async () => {
		return vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false, filters: { 'DLT Logs': <Array<string>>(vscode.workspace.getConfiguration().get("dlt-logs.fileExtensions")) }, openLabel: 'Select DLT file to open...' }).then(
			async (uris: vscode.Uri[] | undefined) => {
				if (uris) {
					uris.forEach((uri) => {
						console.log(`open dlt got URI=${uri.toString()}`);
						let dltUri = uri.with({ scheme: dltScheme });
						vscode.workspace.openTextDocument(dltUri).then((value) => { vscode.window.showTextDocument(value, { preview: false }); });
					});
				}
			}
		);
	}));

	// register our command to open dlt files as "dlt-logs":
	context.subscriptions.push(vscode.commands.registerCommand('dlt-logs.dltExportFile', async () => {
		return vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: true, filters: { 'DLT Logs': <Array<string>>(vscode.workspace.getConfiguration().get("dlt-logs.fileExtensions")) }, openLabel: 'Select DLT files to filter/export...' }).then(
			async (uris: vscode.Uri[] | undefined) => {
				if (uris && uris.length > 0) {
					exportDlt(uris).then(() => {
						console.log(`exportDlt finished`);
					}).catch((err) => {
						console.log(`exportDlt cancelled/error=${err}`);
					});
				}
			}
		);
	}));

	// register custom editor to allow easier file open (hacking...)
	/* not working yet. see dltCustomEditorProvider.ts
	context.subscriptions.push(vscode.window.registerCustomEditorProvider('dlt-log', new DltLogCustomReadonlyEditorProvider));
	*/

	let smartLogApi = {
		onDidChangeSelectedTime(listener: any) { return dltProvider.onDidChangeSelectedTime(listener); },
		restQuery(query: string) { console.log(`dlt-logs.restQuery(${query}) called. nyi`); return JSON.stringify({ 'errors': [{ 'title': 'not yet implemented' }] }); }
	};

	return smartLogApi;
}

// this method is called when your extension is deactivated
export function deactivate() {
	console.log(`${extensionId} is deactivated.`);
}
