// copyright(c) Matthias Behr, 2022

import * as vscode from 'vscode';
import * as util from './util';
import { TreeViewNode } from "./dltTreeViewNodes";
import * as path from 'path';
import { AdltDocument, decodeAdltUri } from './adltDocumentProvider';
import { DltFilter, DltFilterType } from './dltFilter';

// let treeNode = { , label: `SOME/IP Decoder`, uri: this.uri, parent: this.pluginTreeNode, children: [], tooltip: undefined, iconPath: new vscode.ThemeIcon('group-by-ref-type') }; // or symbol-interface?

export class AdltPluginChildNode implements TreeViewNode {
    readonly id: string; // unique id
    label: string;
    _tooltip: string | undefined;
    children: TreeViewNode[] = [];
    _contextValue?: string;
    command?: vscode.Command;
    description?: string;
    iconPath?: vscode.ThemeIcon;

    cmdCtx: any | undefined;

    // filter support: (zoomIn/Out/setPosF)
    _filterFragment: any | undefined;
    _doc: AdltDocument | undefined;

    constructor(childObj: any, public parent: TreeViewNode, public uri: vscode.Uri) {
        this.id = util.createUniqueId();
        this.label = childObj.label || '<no label>';
        this.description = childObj.description || false;
        this._contextValue = childObj.contextValue;

        this._tooltip = childObj.tooltip !== undefined && typeof childObj.tooltip === "string" ? childObj.tooltip : undefined; // or as MarkDownString?
        this.cmdCtx = childObj.cmdCtx;

        if ('filterFrag' in childObj && childObj['filterFrag'] !== null) {
            const doc_name = this.getAdltDocumentAndPluginName();
            // check that _doc is avail
            if (doc_name !== undefined) {
                const [doc, name] = doc_name;
                this._doc = doc;
                this._filterFragment = { ...childObj['filterFrag'] };
                // check that no key is null / delete all null keys
                Object.keys(this._filterFragment).forEach(key => !(this._filterFragment[key] === null) || delete this._filterFragment[key]);
            }
        }

        if (childObj.iconPath) {
            let iconColor = undefined;
            switch (childObj.iconPath) {
                case 'warning': iconColor = new vscode.ThemeColor("list.warningForeground");
                    break;
                case 'error': iconColor = new vscode.ThemeColor("list.errorForeground");
                    break;
                default: break;
            }
            this.iconPath = new vscode.ThemeIcon(childObj.iconPath, iconColor);
        }
    }

    get contextValue() {
        if (this._filterFragment) {
            // similar to DynFilterNode:
            // we determine whether this filter fragments are visible or not
            // it's visible if
            //  a) no pos filter exists or
            //  b) a pos filter includes this one
            //  and
            //  c) not removed with a neg. filter

            const filtersActive = this.getSimilarFilters(true);
            const posFiltersActive = filtersActive.reduce((p, f) => f.type === DltFilterType.POSITIVE ? p + 1 : p, 0);
            const negFiltersActive = filtersActive.reduce((p, f) => f.type === DltFilterType.NEGATIVE ? p + 1 : p, 0);
            let anyPosFilterActive = posFiltersActive;
            if (!anyPosFilterActive) {
                // any pos filter set?
                anyPosFilterActive = this._doc!.allFilters.filter(f => f.enabled && !f.atLoadTime && f.type === DltFilterType.POSITIVE).length;
            }
            let isCurrentlyVisible = (posFiltersActive || anyPosFilterActive === 0) && (negFiltersActive === 0);
            let canSetPosF = isCurrentlyVisible && (anyPosFilterActive === 0);
            return `${'reportOptions' in this._filterFragment ? 'filterReport ' : ''}${isCurrentlyVisible ? 'canZoomOut' : 'canZoomIn'}${canSetPosF ? ' canSetPosF ' : ' '}` + this._contextValue;
        } else {
            return this._contextValue;
        }
    }

    get tooltip(): string | undefined {
        if (this._filterFragment) {
            const activeFilters = this.getSimilarFilters(true);
            if (activeFilters.length) {
                return `${this._tooltip ? this._tooltip + '\n' : ''}Active filters:\n${activeFilters.map(f => f.name).join(',\n')}`;
            } else {
                return `${this._tooltip ? this._tooltip + '\n' : ''}Would set filter:\n${JSON.stringify({ ...this._filterFragment, reportOptions: undefined })}`;
            }
        } else {
            return this._tooltip;
        }
    }

    /**
     * return an array of filters. This is e.g. as we return 'filterReport' as part of context() and the user clicks openReport.
     * 
     * todo: add proper interface here (and not cast simply to FilterNode on registerCommand('...openReport'...))
     */
    get filter(): DltFilter[] {
        if ('reportOptions' in this._filterFragment) {
            return [new DltFilter({ type: 3, ...this._filterFragment }, false)];
        } else {
            return [];
        }
    }

    applyCommand(cmd: string): void {
        console.log(`adlt plugin child node got command '${cmd}'`);
        // context canSetPosF -> cmd setPosFilter
        // context canZoomOut (make msgs non visible) -> cmd zoomOut
        // context canZoomIn (make msgs visible) -> cmd zoomIn
        if (this._filterFragment && ['setPosFilter', 'zoomOut', 'zoomIn'].find((e) => e === cmd) !== undefined) {
            const filtersActive = this.getSimilarFilters(true, true);
            const nonRestFiltersActive = this.getSimilarFilters(false, true);
            switch (cmd) {
                case 'zoomIn': // aka 'make visible': either if any neg: "disable all neg filters" and "add a pos filter"
                    const negFilters = filtersActive.filter(f => f.enabled && f.type === DltFilterType.NEGATIVE);
                    if (negFilters.length > 0) { console.log(` disabled ${negFilters.length} neg`); negFilters.forEach(f => f.enabled = false); }
                    // add a pos filter:
                    // do we have any less restr. pos. filter? (if so no need to add another one)
                    const posLessRestF = filtersActive.filter(f => f.enabled && f.type === DltFilterType.POSITIVE);
                    if (posLessRestF.length === 0) {
                        // do we have any one that is currently disabled? if so, enable it
                        const disPosF = nonRestFiltersActive.filter(f => !f.enabled && f.type === DltFilterType.POSITIVE);
                        if (disPosF.length > 0) { console.log(` enabled 1 pos`); disPosF[0].enabled = true; } else {
                            // else do add a new one
                            const filterFrag = { type: DltFilterType.POSITIVE, ...this._filterFragment };
                            Object.keys(filterFrag).forEach(key => !(filterFrag[key] === null) || delete filterFrag[key]);
                            console.log(` adding new pos ${JSON.stringify(filterFrag)}`);
                            const newFilter = new DltFilter(filterFrag, true);
                            this._doc!.onFilterAdd(newFilter, false);
                        }
                    }

                    break;
                case 'zoomOut': // aka 'make non visible':  if pos filter is fitting non less restrictive: disable else "add a neg filter"
                    const posNonRestF = nonRestFiltersActive.filter(f => f.enabled && f.type === DltFilterType.POSITIVE);
                    if (posNonRestF.length > 0) { console.log(`disabled ${posNonRestF.length} pos`); posNonRestF.forEach(f => f.enabled = false); }
                    // if any less restr. pos. filter meets, add a neg filter:
                    const posLessRestF2 = filtersActive.filter(f => f.enabled && f.type === DltFilterType.POSITIVE);
                    const anyPosFilterActive = this._doc!.allFilters.filter(f => f.enabled && !f.atLoadTime && f.type === DltFilterType.POSITIVE).length;
                    if (posLessRestF2.length > 0 || !anyPosFilterActive) {
                        // add a neg filter:
                        // do we have any one that is currently disabled? if so, enable it
                        const disNegF = nonRestFiltersActive.filter(f => !f.enabled && f.type === DltFilterType.NEGATIVE);
                        if (disNegF.length > 0) { console.log(`enabled 1 neg`); disNegF[0].enabled = true; } else {
                            // add new neg one will all but null keys:
                            const filterFrag = { type: DltFilterType.NEGATIVE, ...this._filterFragment };
                            Object.keys(filterFrag).forEach(key => !(filterFrag[key] === null) || delete filterFrag[key]);
                            console.log(` adding new neg ${JSON.stringify(filterFrag)}`);
                            const newFilter = new DltFilter(filterFrag, true);
                            this._doc!.onFilterAdd(newFilter, false);
                        }
                    }
                    break;
                case 'setPosFilter':
                    const filterFrag = { type: DltFilterType.POSITIVE, ...this._filterFragment };
                    const newFilter = new DltFilter(filterFrag, true);
                    this._doc!.onFilterAdd(newFilter, false);
                    break;
            }
        } else if (this.cmdCtx !== undefined && cmd in this.cmdCtx) {
            switch (cmd) {
                case 'save':
                    let ctx = this.cmdCtx[cmd];
                    // get dir name from first file:
                    const filenames = decodeAdltUri(this.uri);
                    const dirname = filenames.length > 0 ? path.dirname(filenames[0]) : "";

                    let newFileUri = this.uri.with({ path: path.join(dirname, ctx.basename), scheme: "file" });
                    vscode.window.showSaveDialog({ defaultUri: newFileUri, filters: { 'all': ['*'] }, saveLabel: 'Save file as' }).then( // todo defaultUri from config?
                        async (uri: vscode.Uri | undefined) => {
                            if (uri) {
                                try {
                                    //fileTransfer.saveAs(uri);
                                    console.log(`adlt plugin child node should save '${uri.toString()}'`);
                                    const doc_name = this.getAdltDocumentAndPluginName();
                                    if (doc_name) {
                                        const [doc, name] = doc_name;
                                        doc.sendAndRecvAdltMsg(`plugin_cmd ${JSON.stringify({ name: name, cmd: cmd, params: { saveAs: uri.fsPath }, cmdCtx: this.cmdCtx })}`).then((response) => {
                                            console.log(`adlt.plugin_cmd save got response:'${response}'`);
                                        }).catch((reason) => {
                                            return vscode.window.showErrorMessage(`Save file failed with error:'${reason}'`);
                                        });
                                    } else {
                                        console.error(`adlt plugin child node got no doc!`);
                                    }
                                } catch (err) {
                                    return vscode.window.showErrorMessage(`Save file failed with error:'${err}'`);
                                }
                            }
                        }
                    );

                    break;
                default:
                    console.error(`adlt.plugin child node got not supported command '${cmd}'!`);
                    break;
            }
        } else {
            console.error(`adlt.plugin child node got unknown command '${cmd}'!`);
        }
    }

    getSimilarFilters(lessRestrictive: boolean, includeDisabled: boolean = false): DltFilter[] {
        if (!this._doc) { return []; }
        return DltFilter.getSimilarFilters(lessRestrictive, includeDisabled, this._filterFragment, this._doc.allFilters);
    }

    getAdltDocumentAndPluginName(): [AdltDocument, string] | undefined {
        let parent: TreeViewNode | null = this.parent;
        do {
            if ('_doc' in parent) {
                let adltPar = parent as unknown as AdltPlugin;
                return [adltPar['_doc'] as AdltDocument, adltPar['name'] as string];
            } else {
                parent = parent.parent;
            }
        } while (parent !== null);
        return undefined;
    }
}

export class AdltPlugin implements TreeViewNode {

    readonly id: string;
    public enabled: boolean;
    public options: any; // those will be send to adlt
    public children: TreeViewNode[] = [];
    public active: boolean; // will be set based on open status from adlt

    constructor(private origLabel: string, public iconPath: vscode.ThemeIcon | undefined, public uri: vscode.Uri, public parent: TreeViewNode, private treeEventEmitter: vscode.EventEmitter<TreeViewNode | null>, options: any, private _doc: AdltDocument) {

        this.id = util.createUniqueId();

        this.options = JSON.parse(JSON.stringify(options));
        if ('enabled' in options) {
            this.enabled = options.enabled;
        } else {
            this.enabled = true;
        }
        this.active = false;
    }

    get label(): string {
        return this.active ? this.origLabel : `not active: ${this.origLabel}`;
    }

    get tooltip(): string | undefined {
        return this.label + '\n' + "\nConfig:\n" + JSON.stringify(this.options, undefined, 2);
    }

    get name(): string {
        return this.options.name;
    }

    setActive(newActive: boolean) {
        if (newActive !== this.active) {
            this.active = newActive;
            this.treeEventEmitter.fire(this);
        }
    }

    applyCommand(cmd: string): void {
        console.warn(`AdltPlugin(${this.options.name}).applyCommand(cmd=${cmd})... nyi`);
    }

    createChildNode(childObj: any, parent: TreeViewNode): TreeViewNode {

        let newNode = new AdltPluginChildNode(childObj, parent, this.uri);
        // children:
        if ('children' in childObj && Array.isArray(childObj.children)) {
            for (let aChild of childObj.children) {
                if (aChild && typeof aChild === 'object') {
                    let aNode = this.createChildNode(aChild, newNode);
                    newNode.children.push(aNode);
                }
            }
        }

        return newNode;
    }

    // state updates from adlt for that plugin
    processStateUpdate(state: any): void {
        console.log(`AdltPlugin(${this.options.name}).processStateUpdate(${JSON.stringify(state)})...`);
        if ('treeItems' in state && Array.isArray(state.treeItems)) {
            this.children.length = 0; // for now no updates but delete, add
            // add our child nodes:
            for (let newChild of state.treeItems) {
                if (newChild && typeof newChild === 'object') {
                    let newNode = this.createChildNode(newChild, this);
                    this.children.push(newNode);
                }
            }
            this.treeEventEmitter.fire(this);
        }
    }
}