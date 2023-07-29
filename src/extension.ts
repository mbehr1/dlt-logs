/* --------------------
* Copyright (C) Matthias Behr, 2020 - 2022
*/

// todo: fix major regressions:
// [ ] status line support

import * as vscode from 'vscode';
import TelemetryReporter from '@vscode/extension-telemetry';
import { extensionId, dltScheme, adltScheme, GlobalState } from './constants';
import * as dltDocument from './dltDocumentProvider';
import { exportDlt } from './dltExport';
import { ADltDocumentProvider, AdltDocument } from './adltDocumentProvider';
import { FilterNode } from './dltTreeViewNodes';
import { TreeviewAbleDocument } from './dltReport';
import { TreeViewNode } from './dltTreeViewNodes';
import { ColumnConfig, DltDocument } from './dltDocument';
import { DltFilter } from './dltFilter';
import { addFilter, editFilter, deleteFilter } from './dltAddEditFilter';
import * as util from './util';
import * as path from 'path';
import { DltLifecycleInfo, DltLifecycleInfoMinIF } from './dltLifecycle';
import { askSingleTime } from './ask_user';
import { SearchPanelProvider } from './panels/SearchPanel';

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

	const _treeRootNodes: TreeViewNode[] = []; // one root node per document.
	let _onDidChangeTreeData: vscode.EventEmitter<TreeViewNode | null> = new vscode.EventEmitter<TreeViewNode | null>();
	const _dltLifecycleTreeView = vscode.window.createTreeView('dltLifecycleExplorer', {
		treeDataProvider: {
			onDidChangeTreeData: _onDidChangeTreeData.event,
			getChildren(element?: TreeViewNode): TreeViewNode[] | Thenable<TreeViewNode[]> {
				//console.warn(`dlt-logs.getChildren(${element?.label}, ${element?.uri?.toString()}) called. parent=${element?.parent}`);
				if (!element) { // if no element we have to return the root element.
					return _treeRootNodes;
				} else {
					return element.children;
				}
			},
			getParent(element: TreeViewNode): vscode.ProviderResult<TreeViewNode> {
				//console.warn(`dlt-logs.getParent(${element.label}, ${element.uri?.toString()}) called. parent=${element.parent}`);
				return element.parent;
			},
			getTreeItem(element: TreeViewNode): vscode.TreeItem {
				//console.warn(`dlt-logs.getTreeItem(${element.id}:${element.label}, ${element.uri?.toString()}) called.`);
				return {
					id: element.id,
					label: element.label,
					tooltip: element.tooltip,
					contextValue: element.contextValue,
					command: element.command,
					collapsibleState: element.children.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
					iconPath: element.iconPath,
					description: element.description
				};
			}
		},
		dragAndDropController: {
			dragMimeTypes: ['application/vnd.dlt-logs+json'], // ['text/uri-list'],
			dropMimeTypes: ['text/uri-list'],
			async handleDrop(target: TreeViewNode | undefined, sources: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
				let srcs: string[] = [];
				sources.forEach((value, key) => srcs.push(`key:${key}=${value.asString()}`));
				console.log(`adlt.handleDrop sources: ${srcs.join(',')}`);
				//console.log(`adlt.handleDrop get: ${await (await sources.get('text/uri-list'))?.asString()}`);
				// use-cases:
				// drop Dlt-Viewer filter files -> adltProvider with .dlf files
				//  - activate
				//  - ask for storage? store as config?

				// drop dlt/asc files -> open
				// for now we do pass all to the adltProvide
				// but we might filter for .asc,... here already
				return adltProvider.onDrop(target, sources, token);
			},
			handleDrag(source, dataTransfer, token): void | Thenable<void> {
				console.log(`adlt.handleDrag #source=${source.length}...`);
				// add json frags for filters to dataTransfer
				return adltProvider.onDrag(source, dataTransfer, token);
			},
		}
	});

	context.subscriptions.push(_dltLifecycleTreeView.onDidChangeSelection((event) => {
		if (event.selection.length > 0 && event.selection[0].uri) {
			// console.log(`dltLifecycleTreeView.onDidChangeSelection(${event.selection.length} ${event.selection[0].uri} fragment='${event.selection[0].uri.fragment || ''}')`);
			let uriWoFrag = event.selection[0].uri.with({ fragment: "" }).toString();

			let { doc } = getDocAndProviderFor(uriWoFrag);
			if (doc) {
				doc.onTreeViewDidChangeSelection(event);
			}
		}

	}));

	let _statusBarItem: vscode.StatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
	let _onDidChangeStatus = new vscode.EventEmitter<vscode.Uri | undefined>();

	let _onDidChangeActiveRestQueryDoc: vscode.EventEmitter<vscode.Uri | undefined> = new vscode.EventEmitter<vscode.Uri | undefined>();
	/**
	 * event that we'll trigger once the active rest query doc
	 * (aka the one on top of the tree or with the fallback within restquery) changes
	 * or 3s after the number of messages in the last doc changed
	 */
	const onDidChangeActiveRestQueryDoc: vscode.Event<vscode.Uri | undefined> = _onDidChangeActiveRestQueryDoc.event;

	let _lastActiveQueryDocUri: vscode.Uri | undefined = undefined;
	let _lastActiveQueryDocNrMsgs: number | undefined = undefined;
	let _lastActiveQueryDocRetriggerTimer: NodeJS.Timeout | undefined = undefined;

	const checkActiveRestQueryDocChanged = (): boolean => {
		const newDoc0 = getRestQueryDocById('0');
		const newDoc0Uri = newDoc0?.uri;
		const newDoc0NrMsgs = newDoc0?.fileInfoNrMsgs;
		if (newDoc0Uri !== _lastActiveQueryDocUri) {
			_lastActiveQueryDocUri = newDoc0Uri;
			_lastActiveQueryDocNrMsgs = newDoc0NrMsgs;
			if (_lastActiveQueryDocRetriggerTimer) {
				clearTimeout(_lastActiveQueryDocRetriggerTimer);
				_lastActiveQueryDocRetriggerTimer = undefined;
			}
			_onDidChangeActiveRestQueryDoc.fire(newDoc0Uri);
			return true;
		} else if (newDoc0NrMsgs !== undefined && newDoc0NrMsgs !== _lastActiveQueryDocNrMsgs) {
			// the dlt doc changed (e.g. kept on loading)
			// we want to debounce this to a few sec after last update
			_lastActiveQueryDocNrMsgs = newDoc0NrMsgs;
			//console.log(`dlt-logs.checkActiveRestQueryDocChanged triggered delayed update`);
			if (_lastActiveQueryDocRetriggerTimer) {
				clearTimeout(_lastActiveQueryDocRetriggerTimer);
				_lastActiveQueryDocRetriggerTimer = undefined;
			}
			_lastActiveQueryDocRetriggerTimer = setTimeout(() => {
				//console.log(`dlt-logs.checkActiveRestQueryDocChanged fired delayed update`);
				_onDidChangeActiveRestQueryDoc.fire(newDoc0Uri);
				_lastActiveQueryDocRetriggerTimer = undefined;
			}, 3000);
			return true;
		}
		return false;
	};

	// we manage the columns to show here for all documents only once:
	let columns: ColumnConfig[] = [];
	// load column config:
	{
		const columnObjs = vscode.workspace.getConfiguration().get<Array<object>>("dlt-logs.columns");
		columnObjs?.forEach((obj) => {
			try {
				columns.push(new ColumnConfig(obj));
			} catch (err) {
				console.error(`error '${err} parsing '`, obj);
			}
		});
		// new column name 'calculated time', visible:false, ... included?
		let calcCol = columns.find((v) => v.name === 'calculated time');
		if (calcCol === undefined) {
			// insert (before timestamp)
			let recCol = columns.findIndex((v) => v.name === 'timestamp');
			columns.splice(recCol >= 0 ? recCol : 0, 0, new ColumnConfig({ name: "calculated time", visible: false, icon: "$(history)", description: "calculated time when the message was sent" }));
		}
	}

	// register our document provider that knows how to handle "dlt-logs"
	let dltProvider = new dltDocument.DltDocumentProvider(context, _dltLifecycleTreeView, _treeRootNodes, _onDidChangeTreeData, checkActiveRestQueryDocChanged, columns, reporter);
	context.subscriptions.push(vscode.workspace.registerFileSystemProvider(dltScheme, dltProvider, { isReadonly: false, isCaseSensitive: true }));

	// register our document provider that knows how to handle "dlt-logs"
	let adltProvider = new ADltDocumentProvider(context, _dltLifecycleTreeView, _treeRootNodes, _onDidChangeTreeData, checkActiveRestQueryDocChanged, _onDidChangeStatus, columns, reporter);
	context.subscriptions.push(adltProvider);
	context.subscriptions.push(vscode.workspace.registerFileSystemProvider(adltScheme, adltProvider, { isReadonly: false, isCaseSensitive: true }));

	const openADltFunction = async () => {
		let file_exts = <Array<string>>(vscode.workspace.getConfiguration().get("dlt-logs.fileExtensions")) || [];
		if (Array.isArray(file_exts)) {
			if (!file_exts.includes("dlt")) { file_exts.push("dlt"); }
			if (!file_exts.includes("asc")) { file_exts.push("asc"); }
			if (!file_exts.includes("txt")) { file_exts.push("txt"); }
		} else {
			file_exts = ["dlt", "asc", "txt"];
		}
		console.log(`open dlt via adlt file_exts=${JSON.stringify(file_exts)}`);
		return vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: true, filters: { 'DLT Logs': file_exts }, openLabel: 'Select DLT, CAN or Logcat file(s) to open...' }).then(
			async (uris: vscode.Uri[] | undefined) => {
				if (uris) {
					console.log(`open dlt via adlt got URIs=${uris}`);
					/*const fileUri = uri.with({ scheme: "file" });
					if (!fs.existsSync(fileUri.fsPath)*/
					if (uris.length === 1) {
						let dltUri = uris[0].with({ scheme: adltScheme });
						vscode.workspace.openTextDocument(dltUri).then((value) => { vscode.window.showTextDocument(value, { preview: false }); });
					} else {
						// we decode the file names with the pattern: path: (the common path and first file), query: json lf:[names of files]
						// we use the name of all file to detect later if vscode changed e.g. due to breadcrumb selection the file. then (path file not first in files) we do ignore the files
						// use path for common path of all files (to shorten uris)
						const basePath = path.parse(uris[0].fsPath).dir;
						let uri = vscode.Uri.file(uris[0].fsPath).with({ scheme: adltScheme, query: encodeURIComponent(JSON.stringify({ lf: uris.map(u => path.relative(basePath, u.fsPath)) })) });
						console.log(`open dlt via adlt encoded uris as=${uri.toString()}`);
						vscode.workspace.openTextDocument(uri).then((value) => { vscode.window.showTextDocument(value, { preview: false }); });
					}
				}
			}
		);
	};

	// register our command to open dlt files as "dlt-logs":
	context.subscriptions.push(vscode.commands.registerCommand('dlt-logs.dltOpenFileDeprecated', async () => {
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

	// register our command to open dlt files via adlt:
	context.subscriptions.push(vscode.commands.registerCommand('dlt-logs.dltOpenAdltFile', openADltFunction));
	context.subscriptions.push(vscode.commands.registerCommand('dlt-logs.dltOpenFile', openADltFunction));

	// register command to open a terminal with adlt:
	context.subscriptions.push(vscode.commands.registerCommand('dlt-logs.adltTerminal', async () => {
		// this is not really needed as the path of the shipped/contained adlt binary is anyhow added to env but
		// only after the extension has been loaded. So using this command loads the extension.
		vscode.window.createTerminal({ name: `adlt terminal`, message: `use e.g. 'adlt -h' to see help for adlt` }).show();
	}));

	/* todo use this as a good way to output warnings/status messages...
	const outputChannel = vscode.window.createOutputChannel('dlt-logs', 'dlt-logs');
	outputChannel.appendLine('foo');
	outputChannel.replace('bar');
	outputChannel.show(true);*/

	// register SearchPanel provider
	const searchPanelProvider = new SearchPanelProvider(context, adltProvider, onDidChangeActiveRestQueryDoc);

	// on change of active text editor update calculated decorations:
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(async (activeTextEditor: vscode.TextEditor | undefined) => {
		let hideStatusBar = true;
		if (activeTextEditor) {
			//console.log(`dlt-logs.onDidChangeActiveTextEditor ${activeTextEditor.document.uri.toString()} column=${activeTextEditor.viewColumn}`);
			let { doc, provider } = getDocAndProviderFor(activeTextEditor.document.uri.toString());
			if (doc) {
				if (!doc.textEditors.includes(activeTextEditor)) {
					doc.textEditors.push(activeTextEditor);
				} // todo remove?
				_onDidChangeTreeData.fire(doc.treeNode);
				//console.warn(`dlt-logs.onDidChangeActiveTextEditor revealing ${doc?.treeNode.id}:${doc?.treeNode.label}`);
				try {
					_dltLifecycleTreeView.reveal(doc.treeNode, { select: false, focus: false, expand: true }).then(() => {
						//console.warn(`dlt-logs.onDidChangeActiveTextEditor did reveal ${doc?.treeNode.id}`);
					});
				} catch (err) {
					console.warn(`dlt-logs.onDidChangeActiveTextEditor did reveal got err ${err}`);
				}
				//this.checkActiveTextEditor(data);
				doc.updateDecorations();

				hideStatusBar = false;
				doc.updateStatusBarItem(_statusBarItem);
				_statusBarItem.show();
			}
		}
		if (hideStatusBar) {
			_statusBarItem.hide();
		}
	}));

	context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(async (event) => {
		let { doc, provider } = getDocAndProviderFor(event.document.uri.toString());
		if (doc) {

			// update decorations:
			doc.updateDecorations();

			// update status bar only for the last used/active doc:
			let activeDoc = getRestQueryDocById("0");
			if (doc === activeDoc) {
				console.log(`dlt-logs.onDidChangeTextDocument for active document`);
				doc.updateStatusBarItem(_statusBarItem);
			}
		}
	}));


	/**
	 * docProviders can emit this if they updated status bar relevant info
	 */
	context.subscriptions.push(_onDidChangeStatus.event((uri) => {
		let activeDoc = getRestQueryDocById("0");
		if (!activeDoc) { return; }
		if (uri) {
			let { doc, provider } = getDocAndProviderFor(uri.toString());
			if (doc === activeDoc) {
				// update status bar only for the last used/active doc:
				console.log(`dlt-logs.onDidChangeStatus and doc is active document`);
				doc.updateStatusBarItem(_statusBarItem);
			}
		} else {
			console.log(`dlt-logs.onDidChangeStatus for active document`);
			activeDoc.updateStatusBarItem(_statusBarItem);
		}
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

	context.subscriptions.push(vscode.commands.registerCommand("dlt-logs.addFilter", async (...args) => {
		args.forEach(a => { console.log(` dlt-logs.addFilter arg='${JSON.stringify(a)}'`); });
		if (args.length < 2) { return; }
		// first arg should contain uri or preferrably base64Uri
		const uri = 'base64Uri' in args[0] ? vscode.Uri.parse(Buffer.from(args[0].base64Uri, 'base64').toString('utf8')) : (typeof args[0].uri === 'string' ? vscode.Uri.parse(args[0].uri) : args[0].uri);
		if (uri) {
			let { doc, provider } = getDocAndProviderFor(uri.toString());
			if (doc) {
				addFilter(doc, args[1]);
			}
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('dlt-logs.editFilter', async (...args: any[]) => {
		const filterNode = <FilterNode>args[0];
		const parentUri = filterNode.parent?.uri;
		if (parentUri) {
			let { doc, provider } = getDocAndProviderFor(parentUri.toString());
			if (doc) {
				console.log(`editFilter(${filterNode.label}) called for doc=${parentUri}`);
				editFilter(doc, filterNode.filter).then(() => {
					console.log(`editFilter resolved...`);
					_onDidChangeTreeData.fire(filterNode);
				});
			}
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('dlt-logs.deleteFilter', async (...args: any[]) => {
		const filterNode = <FilterNode>args[0];
		const parentUri = filterNode.parent?.uri;
		if (parentUri) {
			let { doc, provider } = getDocAndProviderFor(parentUri.toString());
			if (doc) {
				console.log(`deleteFilter(${filterNode.label}) called for doc=${parentUri}`);
				let parentNode = filterNode.parent;
				vscode.window.showWarningMessage(`Do you want to delete the filter '${filterNode.filter.name}'? This cannot be undone!`,
					{ modal: true }, 'Delete').then((value) => {
						if (value === 'Delete') {
							deleteFilter(doc!, filterNode.filter).then(() => {
								console.log(`deleteFilter resolved...`);
								_onDidChangeTreeData.fire(parentNode);
							});
						}
					});
			}
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('dlt-logs.zoomIn', async (...args: any[]) => {
		dltProvider.onTreeNodeCommand('zoomIn', args[0]);
		adltProvider.onTreeNodeCommand('zoomIn', args[0]);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('dlt-logs.zoomOut', async (...args: any[]) => {
		dltProvider.onTreeNodeCommand('zoomOut', args[0]);
		adltProvider.onTreeNodeCommand('zoomOut', args[0]);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('dlt-logs.setPosFilter', async (...args: any[]) => {
		dltProvider.onTreeNodeCommand('setPosFilter', args[0]);
		adltProvider.onTreeNodeCommand('setPosFilter', args[0]);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('dlt-logs.treeViewSave', async (...args: any[]) => {
		dltProvider.onTreeNodeCommand('save', args[0]);
		adltProvider.onTreeNodeCommand('save', args[0]);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('dlt-logs.openReport', async (...args: any[]) => {
		// we can be called with two types of args:
		// filterNode or
		// like addFilter: {uri: ...} and { filterFrag }
		let label: string;
		let filter: DltFilter;
		let uri: vscode.Uri | null | undefined;

		if (args[0] !== undefined && ((args[0] instanceof FilterNode) || ('filter' in args[0] && 'parent' in args[0]))) {
			console.log(`dlt-logs.openReport using single arg')`);
			const filterNode = <FilterNode>args[0];
			label = filterNode.label;
			filter = filterNode.filter;
			uri = filterNode.parent?.uri;
		} else {
			console.log(`dlt-logs.openReport using two args: '${JSON.stringify(args[0])}' and '${JSON.stringify(args[1])}')`);
			filter = new DltFilter(args[1]);
			label = filter.name;
			uri = vscode.Uri.parse('base64Uri' in args[0] ? Buffer.from(args[0].base64Uri, 'base64').toString('utf8') : args[0].uri);
		}
		if (uri) {
			const doc = dltProvider._documents.get(uri.toString());
			if (doc) {
				console.log(`openReport(${label}) called for doc=${uri}`);
				doc.onOpenReport(context, filter);
			} else {
				const doc = adltProvider._documents.get(uri.toString());
				if (doc) {
					console.log(`openReport(${label}) called for adlt doc=${uri}`);
					doc.onOpenReport(context, filter);
				} else {
                    console.warn(`dlt-logs.openReport didn't found uri '${uri.toString()}' in '${Array.from(adltProvider._documents.keys()).join(' , ')}'`);
                }
			}
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand('dlt-logs.openNewReport', async (...args: any[]) => {
		const filterNode = <FilterNode>args[0];
		const parentUri = filterNode.parent?.uri;
		if (parentUri) {
			const doc = dltProvider._documents.get(parentUri.toString());
			if (doc) {
				console.log(`openNewReport(${filterNode.label}) called for doc=${parentUri}`);
				doc.onOpenReport(context, filterNode.filter, true);
			} else {
				const doc = adltProvider._documents.get(parentUri.toString());
				if (doc) {
					console.log(`openNewReport(${filterNode.label}) called for adlt doc=${parentUri}`);
					doc.onOpenReport(context, filterNode.filter, true);
				}
			}
		}
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


	context.subscriptions.push(vscode.commands.registerTextEditorCommand('dlt-logs.toggleSortOrder', async (textEditor: vscode.TextEditor) => {
		console.log(`dlt-logs.toggleSortOrder(textEditor.uri = ${textEditor.document.uri.toString()}) called...`);
		const uriStr = textEditor.document.uri.toString();
		const doc = dltProvider._documents.get(uriStr) || adltProvider._documents.get(uriStr);
		if (doc) {
			return doc.toggleSortOrder();
		}
	}));

	context.subscriptions.push(vscode.commands.registerTextEditorCommand('dlt-logs.goToTime', async (textEditor: vscode.TextEditor) => {
		console.log(`dlt-logs.goToTime(textEditor.uri = ${textEditor.document.uri.toString()}) called...`);
		const uriStr = textEditor.document.uri.toString();
		const doc = dltProvider._documents.get(uriStr) || adltProvider._documents.get(uriStr);
		if (doc) {
			// prefill with earliest start time and latest end time
			let timeFrom: Date | undefined = undefined;
			let timeTo: Date | undefined = undefined;
			for (let [ecu, lcInfos] of doc.lifecycles) {
				for (let lc of lcInfos) {
					if (timeFrom === undefined || lc.lifecycleStart < timeFrom) {
						timeFrom = lc.lifecycleStart;
					}
					if (timeTo === undefined || lc.lifecycleEnd > timeTo) {
						timeTo = lc.lifecycleEnd;
					}
				}
			}
			if (timeFrom !== undefined) {
				askSingleTime(timeFrom, timeTo).then((time) => {
					console.log(`dlt-logs.goToTime()=${time}`);
					doc.revealDate(time);
				});
			}
		}
	}));



	context.subscriptions.push(vscode.commands.registerTextEditorCommand('dlt-logs.configureColumns', async (textEditor: vscode.TextEditor) => {
		// console.log(`dlt-logs.configureColumns(textEditor.uri = ${textEditor.document.uri.toString()}) called...`);
		vscode.window.showQuickPick(columns, {
			canPickMany: true,
			placeHolder: "select all columns to show"
		}).then((selColumns: ColumnConfig[] | undefined) => {
			if (selColumns) {
				if (selColumns.length > 0) {
					columns.forEach((column) => { column.visible = false; });
					selColumns?.forEach((column) => { column.visible = true; });

					if (true) { // store/update config:
						const columnObjs = vscode.workspace.getConfiguration().get<Array<any>>("dlt-logs.columns") || [];

						for (let [idx, column] of columns.entries()) {
							let found = false;
							for (let obj of columnObjs) {
								try {
									if ('name' in obj && obj.name === column.name) {
										obj.visible = column.visible;
										found = true;
										break;
									}
								} catch (err) {
									console.error(` err ${err} at updating config obj!`);
								}
							};
							if (!found) { // add it:
								columnObjs.splice(idx, 0, JSON.parse(JSON.stringify(column)));
							}
						};
						try {
							vscode.workspace.getConfiguration().update("dlt-logs.columns", columnObjs, vscode.ConfigurationTarget.Global).then(() => {
								// todo might need a better solution if workspace config is used.
								// the changes wont be reflected at next startup. (default->global->workspace)
								// would need to inspect first.
								console.log("updated column config.");
							});
						} catch (err) {
							console.error(` err ${err} at updating configuration!`);
						}
					}
					return true;
				} else { // we disallow unselecting all columns
					vscode.window.showWarningMessage("At least one column need to be selected. Ignoring selection.");
					return false;
				}
			} // else we don't change anything
			return false;
		}).then((ok) => {
			if (ok) {
				console.warn(`Dlt.configureColumns()... columns ok`);
				// retrigger drawing of all docs (and not just the active one?) (todo)
				const doc = dltProvider._documents.get(textEditor.document.uri.toString()) || adltProvider._documents.get(textEditor.document.uri.toString());
				if (doc) {
					return vscode.window.withProgress({ cancellable: false, location: vscode.ProgressLocation.Notification, title: "applying columns to active document..." },
						(progress) => doc.applyFilter(progress)).then(() => console.log(`Dlt.configureColumns() applyFilter() done`));
				}
			} else {
				console.warn(`Dlt.configureColumns()... not ok`);
			}
		});

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
					const res = await restQuery(context, input);
					console.log(`restQuery returned: '${res}'`);
					vscode.window.showInformationMessage(res, 'ok');
				}
			}
		);
	}));

	context.subscriptions.push(vscode.window.onDidChangeTextEditorVisibleRanges(util.throttle((e) => {
		if (e.visibleRanges.length === 1) {
			const uriStr = e.textEditor.document.uri.toString();
			const doc = dltProvider._documents.get(uriStr) || adltProvider._documents.get(uriStr);
			if (doc) {
				// console.log(`dlt-log.onDidChangeTextEditorVisibleRanges(${e.visibleRanges[0].start.line}-${e.visibleRanges[0].end.line})`);
				doc.notifyVisibleRange(e.visibleRanges[0]);
			}
		}
	}, 200)));


	// maintain list of visible(aka opened) documents for the treeview and maintenance of
	// the last used one (for restQuery)

	context.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors((editors: readonly vscode.TextEditor[]) => {
		//console.log(`DltDocumentProvider.onDidChangeVisibleTextEditors= ${editors.length}`);
		const visibleDocs: TreeviewAbleDocument[] = [];
		for (const editor of editors) {
			//console.log(` DltDocumentProvider.onDidChangeVisibleTextEditors editor.document.uri=${editor.document.uri} editor.viewColumn=${editor.viewColumn} editor.document.isClosed=${editor.document.isClosed}`);
			let doc = dltProvider._documents.get(editor.document.uri.toString()) || adltProvider._documents.get(editor.document.uri.toString());
			if (doc) {
				//console.log(` DltDocumentProvider.onDidChangeVisibleTextEditors got doc!`);
				if (!editor.document.isClosed) { visibleDocs.push(doc); }
			}
		}

		// show/hide the status bar if no doc is visible
		if (visibleDocs.length === 0) {
			_statusBarItem.hide();
		} else {
			_statusBarItem.show();
		}

		// now close all but the visibleDocs:
		const notVisibleDocs: TreeviewAbleDocument[] = [];
		dltProvider._documents.forEach(doc => {
			if (!visibleDocs.includes(doc)) { notVisibleDocs.push(doc); }
		});
		adltProvider._documents.forEach(doc => {
			if (!visibleDocs.includes(doc)) { notVisibleDocs.push(doc); }
		});

		//console.log(`dlt-logs.onDidChangeVisibleTextEditors visibleDocs=${visibleDocs.map(v => v?.treeNode.uri?.toString()).join(',')} notVisibleDocs=${notVisibleDocs.map(v => v?.treeNode.uri?.toString()).join(',')}`);

		let doFire = false;
		notVisibleDocs.forEach(doc => {
			if (doc) {
				if (doc.textDocument) {
					let childNode: TreeViewNode = doc.treeNode;
					let idx = _treeRootNodes.indexOf(childNode);
					if (idx >= 0) {
						// console.log(` dlt-logs.onDidChangeVisibleTextEditors: hiding childNode doc uri=${doc.textDocument.uri.toString()}`);
						_treeRootNodes.splice(idx, 1);
					}
					doFire = true;
				}
			}
		});
		// and add the visible ones:
		visibleDocs.forEach(doc => {
			if (doc && doc.textDocument) {
				let childNode: TreeViewNode = doc.treeNode;
				if (!_treeRootNodes.includes(childNode)) {
					// console.log(` dlt-logs.onDidChangeVisibleTextEditors: adding childNode doc uri=${doc.textDocument.uri.toString()}`);
					_treeRootNodes.push(childNode);
					doFire = true;
				}
			}
		});

		if (doFire) { _onDidChangeTreeData.fire(null); }
		checkActiveRestQueryDocChanged();
	}));

	const getDocAndProviderFor = (uri: string) => {
		let doc = dltProvider._documents.get(uri);
		if (doc) { return { doc: doc, provider: dltProvider }; } else {
			let doc = adltProvider._documents.get(uri);
			return { doc: doc, provider: doc ? adltProvider : undefined };
		}
	};

	context.subscriptions.push(vscode.workspace.onDidCloseTextDocument((event: vscode.TextDocument) => {
		// todo investigate why we sometimes dont get a onDidClose for our documents??? (its the garbage collector, ...we get a didOpen and didChange...)
		const uriStr = event.uri.toString();
		console.log(`dlt-logs onDidCloseTextDocument uri=${uriStr}`);
		// is it one of our documents?
		const { doc, provider } = getDocAndProviderFor(uriStr);
		if (doc) {
			console.log(` dlt-logs.onDidCloseTextDocument: found document with uri=${uriStr}`);
			if (doc.textDocument) {
				console.log(`  deleting document with uri=${doc.textDocument.uri.toString()}`);
				doc.textDocument = undefined;
				let childNode: TreeViewNode = doc.treeNode;
				for (let i = 0; i < _treeRootNodes.length; ++i) {
					if (_treeRootNodes[i] === childNode) {
						_treeRootNodes.splice(i, 1);
						//console.log(`  deleting rootNode with #${i}`);
						break;
					}
				}
				provider?._documents.delete(uriStr);
				_onDidChangeTreeData.fire(null);

				if (provider && ('onDidClose' in provider)) { provider.onDidClose(doc); };

				if ((dltProvider._documents.size + adltProvider._documents.size) === 0) {
					_statusBarItem.hide();
				}
				checkActiveRestQueryDocChanged();
			}
		}
	}));


	let getRestQueryDocByIdDidLoadSub: vscode.Disposable | undefined = undefined;
	const getRestQueryDocById = (id: string): DltDocument | AdltDocument | undefined => {
		let { doc, provider } = getDocAndProviderFor(id);
		// fallback to index:
		if (!doc) {
			const docIdx: number = Number(id);

			// take the docIdx th. dlt doc that is visible:
			if (_treeRootNodes.length > docIdx) {
				const childNode = _treeRootNodes[docIdx];
				// now find the document for that:
				dltProvider._documents.forEach(aDoc => {
					if (aDoc.treeNode === childNode) { doc = aDoc; }
				});
				if (!doc) {
					adltProvider._documents.forEach(aDoc => {
						if (aDoc.treeNode === childNode) { doc = aDoc; }
					});
				}
			}
			if (!doc) { // use the ones sorted by last used time
				let documents = [...dltProvider._documents.values(), ...adltProvider._documents.values()];
				if (docIdx >= 0 && docIdx < documents.length) {
					documents.sort((a, b) => b.lastUpdatedStatusBar - a.lastUpdatedStatusBar);
					doc = documents[docIdx];
				}
			}
		}
		// if the doc is not yet fully loaded we'll return undefined as the restQuery will return wrong results otherwise:
		if (doc && !doc.isLoaded) {
			if (getRestQueryDocByIdDidLoadSub) { getRestQueryDocByIdDidLoadSub.dispose(); };
			getRestQueryDocByIdDidLoadSub = doc.onDidLoad(load => {
				console.warn(`dlt-logs.getRestQueryDocById.onDidLoad called...`);
				if (getRestQueryDocByIdDidLoadSub) {
					getRestQueryDocByIdDidLoadSub.dispose();
					getRestQueryDocByIdDidLoadSub = undefined;
				}
				checkActiveRestQueryDocChanged();
			});
			return undefined;
		}
		return doc;
	};

	/**
	 * support info query in JSON API format (e.g. used by fishbone ext.)
	 * input: query : string, e.g. '/get/docs' or '/get/version'
	 * output: JSON obj as string. e.g. '{"errors":[]}' or '{"data":[...]}'
	 */
	/// support info query in JSON API format (e.g. used by fishbone ext.)
	const restQuery = async (context: vscode.ExtensionContext, query: string): Promise<string> => {
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
									retObj.data = {
										"type": "version",
										"id": "1",
										"attributes": {
											version: extensionVersion,
											name: extensionId
										}
									};
								}
								break;
							case 'docs':
								{
									if (paths.length === 1) {
										// get info about available documents:
										const arrRes: Object[] = [];
										dltProvider._documents.forEach((doc) => {
											const resObj: { type: string, id: string, attributes?: Object } =
												{ type: "docs", id: encodeURIComponent(doc.uri.toString()) };
											let ecusObj = { data: {} };
											restQueryDocsEcus(cmd, [paths[0], '', 'ecus'], options, doc, ecusObj);
											resObj.attributes = {
												name: doc.uri.fsPath,
												msgs: doc.msgs.length,
												ecus: ecusObj.data,
												filters: util.createRestArray(doc.allFilters, (obj: object, i: number) => { const filter = obj as DltFilter; return filter.asRestObject(i); })
											};
											arrRes.push(resObj);
										});
										adltProvider._documents.forEach((doc) => {
											const resObj: { type: string, id: string, attributes?: Object } =
												{ type: "docs", id: encodeURIComponent(doc.uri.toString()) };
											let ecusObj = { data: {} };
											//adltProvider.restQueryDocsEcus(cmd, [paths[0], '', 'ecus'], options, doc, ecusObj);
											/* todo adlt for adlt resObj.attributes = {
												name: doc.uri.fsPath,
												msgs: doc.msgs.length,
												ecus: ecusObj.data,
												filters: util.createRestArray(doc.allFilters, (obj: object, i: number) => { const filter = obj as DltFilter; return filter.asRestObject(i); })
											};*/
											arrRes.push(resObj);
										});
										retObj.data = arrRes;
									} else {
										// get info about one document:
										// e.g. get/docs/<id>/ecus/<ecuid>/lifecycles/<lifecycleid>
										// or   get/docs/<id>/filters
										if (paths.length >= 2) {
											const docId = decodeURIComponent(paths[1]);
											let doc = getRestQueryDocById(docId);
											if (doc) {
												if (paths.length === 2) { // get/docs/<id>
													const resObj: { type: string, id: string, attributes?: Object } =
														{ type: "docs", id: encodeURIComponent(doc.uri.toString()) };
													resObj.attributes = {
														name: doc.uri.fsPath,
														msgs: doc.fileInfoNrMsgs,
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
															restQueryDocsEcus(cmd, paths, options, doc, retObj);
															break;
														case 'filters': // get/docs/<id>/filters
															await doc.restQueryDocsFilters(context, cmd, paths, options, retObj);
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
	};

	/**
 * process /<cmd>/docs/<id>/ecus(paths[2])... restQuery requests
 * @param cmd get|patch|delete
 * @param paths docs/<id>/ecus[...]
 * @param options e.g. ecu=<name>
 * @param doc DltDocument identified by <id>
 * @param retObj output: key errors or data has to be filled
 */

	const restQueryDocsEcus = (cmd: string, paths: string[], options: string, doc: DltDocument | AdltDocument, retObj: { error?: object[], data?: object[] | object }) => {
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
			doc.lifecycles.forEach((lcInfo: DltLifecycleInfo[] | DltLifecycleInfoMinIF[], ecu: string) => {
				if (!ecuNameFilter || ecuNameFilter === ecu) {
					const resObj: { type: string, id: string, attributes?: Object } =
						{ type: "ecus", id: encodeURIComponent(ecu) };

					// determine SW names:
					let sw: string[] = [];
					lcInfo.forEach((lc: DltLifecycleInfo | DltLifecycleInfoMinIF) => lc.swVersions.forEach(lsw => { if (!sw.includes(lsw)) { sw.push(lsw); } }));

					resObj.attributes = {
						name: ecu,
						lifecycles: [...lcInfo.map((lc: DltLifecycleInfo | DltLifecycleInfoMinIF, idx: number) => {
							return {
								type: "lifecycles", id: lc.persistentId,
								attributes: {
									index: idx + 1,
									id: lc.persistentId, // todo to ease parsing with jsonPath...
									label: lc.getTreeNodeLabel(),
									startTimeUtc: lc.lifecycleStart.toUTCString(),
									endTimeUtc: lc.lifecycleEnd.toUTCString(),
									sws: lc.swVersions,
									msgs: lc.nrMsgs,
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
	};

	void showWelcomeOrWhatsNew(context, extensionVersion, prevVersion);

	void context.globalState.update(GlobalState.Version, extensionVersion);

	// register custom editor to allow easier file open (hacking...)
	/* not working yet. see dltCustomEditorProvider.ts
	context.subscriptions.push(vscode.window.registerCustomEditorProvider('dlt-log', new DltLogCustomReadonlyEditorProvider));
	*/

	let smartLogApi = {
		onDidChangeSelectedTime(listener: any) { return dltProvider.onDidChangeSelectedTime(listener); },
		// restQuery should follow the principles from here: https://jsonapi.org/format/
		restQuery(query: string) { console.log(`dlt-logs.restQuery(${query}) called.`); return restQuery(context, query); },
		onDidChangeActiveRestQueryDoc(listener: any) { return onDidChangeActiveRestQueryDoc(listener); }
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
