/* --------------------
* Copyright (C) Matthias Behr, 2020 - 2022
*/

import * as vscode from 'vscode';
import TelemetryReporter from 'vscode-extension-telemetry';
import { extensionId, dltScheme, adltScheme, GlobalState } from './constants';
import * as dltDocument from './dltDocumentProvider';
import { exportDlt } from './dltExport';
import { ADltDocumentProvider, AdltDocument } from './adltDocumentProvider';
import { FilterNode } from './dltTreeViewNodes';
import { TreeviewAbleDocument } from './dltReport';
import { TreeViewNode } from './dltTreeViewNodes';
import { DltDocument } from './dltDocument';
import { DltFilter } from './dltFilter';
import * as util from './util';

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

	let _treeRootNodes: TreeViewNode[] = []; // one root node per document.
	let _onDidChangeTreeData: vscode.EventEmitter<TreeViewNode | null> = new vscode.EventEmitter<TreeViewNode | null>();



	let _onDidChangeActiveRestQueryDoc: vscode.EventEmitter<vscode.Uri | undefined> = new vscode.EventEmitter<vscode.Uri | undefined>();
	/**
	 * event that we'll trigger once the active rest query doc
	 * (aka the one on top of the tree or with the fallback within restquery) changes
	 */
	const onDidChangeActiveRestQueryDoc: vscode.Event<vscode.Uri | undefined> = _onDidChangeActiveRestQueryDoc.event;

	let _lastActiveQueryDocUri: vscode.Uri | undefined = undefined;
	const checkActiveRestQueryDocChanged = (): boolean => {
		const newDoc0Uri = getRestQueryDocById('0')?.uri;
		if (newDoc0Uri !== _lastActiveQueryDocUri) {
			_lastActiveQueryDocUri = newDoc0Uri;
			_onDidChangeActiveRestQueryDoc.fire(newDoc0Uri);
			return true;
		}
		return false;
	};


	// register our document provider that knows how to handle "dlt-logs"
	let dltProvider = new dltDocument.DltDocumentProvider(context, _treeRootNodes, _onDidChangeTreeData, checkActiveRestQueryDocChanged, reporter);
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
	let adltProvider = new ADltDocumentProvider(context, _treeRootNodes, _onDidChangeTreeData, checkActiveRestQueryDocChanged, reporter);
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

	context.subscriptions.push(vscode.commands.registerCommand('dlt-logs.openReport', async (...args: any[]) => {
		const filterNode = <FilterNode>args[0];
		const parentUri = filterNode.parent?.uri;
		if (parentUri) {
			const doc = dltProvider._documents.get(parentUri.toString());
			if (doc) {
				console.log(`openReport(${filterNode.label}) called for doc=${parentUri}`);
				doc.onOpenReport(context, filterNode.filter);
			} else {
				const doc = adltProvider._documents.get(parentUri.toString());
				if (doc) {
					console.log(`openReport(${filterNode.label}) called for adlt doc=${parentUri}`);
					doc.onOpenReport(context, filterNode.filter);
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

	// maintain list of visible(aka opened) documents for the treeview and maintenance of
	// the last used one (for restQuery)


	context.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors((editors: vscode.TextEditor[]) => {
		//console.log(`DltDocumentProvider.onDidChangeVisibleTextEditors= ${editors.length}`);
		const visibleDocs: TreeviewAbleDocument[] = [];
		for (const editor of editors) {
			//console.log(` DltDocumentProvider.onDidChangeVisibleTextEditors editor.document.uri=${editor.document.uri} editor.viewColumn=${editor.viewColumn} editor.document.isClosed=${editor.document.isClosed}`);
			let data = dltProvider._documents.get(editor.document.uri.toString()) || adltProvider._documents.get(editor.document.uri.toString());
			if (data) {
				//console.log(` DltDocumentProvider.onDidChangeVisibleTextEditors got doc!`);
				if (!editor.document.isClosed) { visibleDocs.push(data); }
			}
		}

		// show/hide the status bar if no doc is visible
		/* todo adlt move to here
		if (this._statusBarItem) {
			if (visibleDocs.length === 0) {
				this._statusBarItem.hide();
			} else {
				this._statusBarItem.show();
			}
		}*/

		// now close all but the visibleDocs:
		const notVisibleDocs: TreeviewAbleDocument[] = [];
		dltProvider._documents.forEach(doc => {
			if (!visibleDocs.includes(doc)) { notVisibleDocs.push(doc); }
		});
		adltProvider._documents.forEach(doc => {
			if (!visibleDocs.includes(doc)) { notVisibleDocs.push(doc); }
		});

		let doFire = false;
		notVisibleDocs.forEach(doc => {
			if (doc) {
				if (doc.textDocument) {
					//console.log(` dlt-logs.onDidChangeVisibleTextEditors: hiding doc uri=${doc.textDocument.uri.toString()}`);
					let childNode: TreeViewNode = doc.treeNode;
					let idx = _treeRootNodes.indexOf(childNode);
					if (idx >= 0) {
						_treeRootNodes.splice(idx, 1);
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
					if (!_treeRootNodes.includes(childNode)) {
						_treeRootNodes.push(childNode);
						doFire = true;
					}
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
				/* todo adlt statusbar
				if (this._documents.size === 0 && this._statusBarItem) {
					this._statusBarItem.hide();
				}*/
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
			if (!doc) { // fallback to prev. method. which is ok for one doc, but not for mult....
				// if (this._documents.size > 1) { console.warn(`DltDocumentProvider.restQuery: you're using a deprecated method to access documents! Please only refer to visible documents!`); }
				let documents = [...dltProvider._documents.values(), ...adltProvider._documents.values()];
				if (docIdx >= 0 && docIdx < documents.length) {
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
