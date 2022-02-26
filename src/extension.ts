/* --------------------
* Copyright (C) Matthias Behr, 2020
*/

import * as vscode from 'vscode';
import TelemetryReporter from 'vscode-extension-telemetry';
import { extensionId, dltScheme, adltScheme, GlobalState } from './constants';
import * as dltDocument from './dltDocumentProvider';
import { exportDlt } from './dltExport';
import { ADltDocumentProvider } from './adltDocumentProvider';

// import { DltLogCustomReadonlyEditorProvider } from './dltCustomEditorProvider';

let reporter: TelemetryReporter;

export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated

	const extension = vscode.extensions.getExtension(extensionId);

	const prevVersion = context.globalState.get<string>(GlobalState.Version);
	let extensionVersion = '0.0.0'; // default value in case query ext fails...

	if (extension) {
		extensionVersion = extension.packageJSON.version;
		console.log(`${extensionId} v${extensionVersion} ${prevVersion !== extensionVersion ? `prevVersion: ${prevVersion} ` : ''}is now active!`);
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

	// register our document provider that knows how to handle "dlt-logs"
	let adltProvider = new ADltDocumentProvider(context, reporter);
	context.subscriptions.push(vscode.workspace.registerFileSystemProvider(adltScheme, adltProvider, { isReadonly: false, isCaseSensitive: true }));

	// register our command to open dlt files via adlt:
	context.subscriptions.push(vscode.commands.registerCommand('dlt-logs.dltOpenAdltFile', async () => {
		return vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: true, filters: { 'DLT Logs': <Array<string>>(vscode.workspace.getConfiguration().get("dlt-logs.fileExtensions")) }, openLabel: 'Select DLT file to open...' }).then(
			async (uris: vscode.Uri[] | undefined) => {
				if (uris) {
					console.log(`open dlt via adlt got URIs=${uris}`);
					let dltUri = uris[0].with({ scheme: adltScheme }); // todo encode all files
					vscode.workspace.openTextDocument(dltUri).then((value) => { vscode.window.showTextDocument(value, { preview: false }); });
				}
			}
		);
	}));

	// register common (adlt/dlt) commands:
	context.subscriptions.push(vscode.commands.registerCommand('dlt-logs.enableFilter', async (...args: any[]) => {
		dltProvider.onTreeNodeCommand('enableFilter', args[0]);
		adltProvider.onTreeNodeCommand('enableFilter', args[0]);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('dlt-logs.disableFilter', async (...args: any[]) => {
		dltProvider.onTreeNodeCommand('disableFilter', args[0]);
		adltProvider.onTreeNodeCommand('disableFilter', args[0]);
	}));

	// register our command to export dlt files:
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

	// register a command to test restQuery:
	context.subscriptions.push(vscode.commands.registerCommand('dlt-logs.testRestQuery', async () => {
		return vscode.window.showInputBox({
			prompt: 'enter query to execute, e.g. /get/docs or /get/version',
			value: '/get/docs',
			valueSelection: [5, 10]
		}).then(
			async (input: string | undefined) => {
				if (input?.length) {
					const res = dltProvider.restQuery(context, input);
					console.log(`restQuery returned: '${res}'`);
					vscode.window.showInformationMessage(res, 'ok');
				}
			}
		);
	}));

	void showWelcomeOrWhatsNew(context, extensionVersion, prevVersion);

	void context.globalState.update(GlobalState.Version, extensionVersion);

	// register custom editor to allow easier file open (hacking...)
	/* not working yet. see dltCustomEditorProvider.ts
	context.subscriptions.push(vscode.window.registerCustomEditorProvider('dlt-log', new DltLogCustomReadonlyEditorProvider));
	*/

	let smartLogApi = {
		onDidChangeSelectedTime(listener: any) { return dltProvider.onDidChangeSelectedTime(listener); },
		// restQuery should follow the principles from here: https://jsonapi.org/format/
		restQuery(query: string) { console.log(`dlt-logs.restQuery(${query}) called.`); return dltProvider.restQuery(context, query); },
		onDidChangeActiveRestQueryDoc(listener: any) { return dltProvider.onDidChangeActiveRestQueryDoc(listener); }
	};

	return smartLogApi;
}

// this method is called when your extension is deactivated
export function deactivate() {
	console.log(`${extensionId} is deactivated.`);
}

async function showWelcomeOrWhatsNew(context: vscode.ExtensionContext, version: string, prevVersion: string | undefined) {

	let showFunction: undefined | ((version: string) => Promise<void>) = undefined;

	if (!prevVersion) {
		// first time install... point to docs todo
		showFunction = showWelcomeMessage;
	} else if (prevVersion !== version) {
		const [major, minor] = version.split('.').map(v => parseInt(v, 10));
		const [prevMajor, prevMinor] = prevVersion.split('.').map(v => parseInt(v, 10));
		if ((major === prevMajor && minor === prevMinor) ||
			(major < prevMajor) || // ignore downgrades
			(major === prevMajor && minor < prevMinor)) {
			return;
		}
		// major/minor version is higher
		showFunction = showWhatsNewMessage;
	}
	if (showFunction) {
		if (vscode.window.state.focused) {
			await context.globalState.update(GlobalState.PendingWhatNewOnFocus, undefined);
			void showFunction(version);
		} else {
			await context.globalState.update(GlobalState.PendingWhatNewOnFocus, true);
			const disposable = vscode.window.onDidChangeWindowState(e => {
				if (!e.focused) { return; }
				disposable.dispose();

				if (context.globalState.get(GlobalState.PendingWhatNewOnFocus) === true) {
					void context.globalState.update(GlobalState.PendingWhatNewOnFocus, undefined);
					if (showFunction) {
						void showFunction(version);
					}
				}
			});
			context.subscriptions.push(disposable);
		}
	}
}

async function showWhatsNewMessage(version: string) {
	const message = `DLT-Logs has been updated to v${version} - check out what's new!`;
	const actions: vscode.MessageItem[] = [{ title: "What's New" }, { title: '❤ Sponsor' }];
	const result = await vscode.window.showInformationMessage(message, ...actions);
	if (result !== undefined) {
		if (result === actions[0]) {
			await vscode.env.openExternal(vscode.Uri.parse('https://github.com/mbehr1/dlt-logs/blob/master/CHANGELOG.md'));
		} else if (result === actions[1]) {
			await vscode.env.openExternal(vscode.Uri.parse('https://github.com/sponsors/mbehr1'));
		}
	}
}

async function showWelcomeMessage(version: string) {
	const message = `DLT-Logs v${version} has been installed - check out the docs!`;
	const actions: vscode.MessageItem[] = [{ title: "Docs" }, { title: '❤ Sponsor' }];
	const result = await vscode.window.showInformationMessage(message, ...actions);
	if (result !== undefined) {
		if (result === actions[0]) {
			await vscode.env.openExternal(vscode.Uri.parse('https://mbehr1.github.io/dlt-logs/docs/#first-use'));
		} else if (result === actions[1]) {
			await vscode.env.openExternal(vscode.Uri.parse('https://github.com/sponsors/mbehr1'));
		}
	}
}
