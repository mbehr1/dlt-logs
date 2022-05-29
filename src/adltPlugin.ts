// copyright(c) Matthias Behr, 2022

import * as vscode from 'vscode';
import * as util from './util';
import { TreeViewNode } from "./dltTreeViewNodes";
import * as path from 'path';
import { AdltDocument, decodeAdltUri } from './adltDocumentProvider';

// let treeNode = { , label: `SOME/IP Decoder`, uri: this.uri, parent: this.pluginTreeNode, children: [], tooltip: undefined, iconPath: new vscode.ThemeIcon('group-by-ref-type') }; // or symbol-interface?

export class AdltPluginChildNode implements TreeViewNode {
    readonly id: string; // unique id
    label: string;
    tooltip: string | undefined;
    children: TreeViewNode[] = [];
    contextValue?: string;
    command?: vscode.Command;
    description?: string;
    iconPath?: vscode.ThemeIcon;

    cmdCtx: any | undefined;

    constructor(childObj: any, public parent: TreeViewNode, public uri: vscode.Uri) {
        this.id = util.createUniqueId();
        this.label = childObj.label || '<no label>';
        this.description = childObj.description || false;
        this.contextValue = childObj.contextValue;

        this.tooltip = childObj.tooltip !== undefined && typeof childObj.tooltip === "string" ? childObj.tooltip : undefined; // or as MarkDownString?
        this.cmdCtx = childObj.cmdCtx;

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

    applyCommand(cmd: string): void {
        console.log(`adlt plugin child node got command '${cmd}'`);
        if (this.cmdCtx !== undefined && cmd in this.cmdCtx) {
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
                    console.error(`adlt.pluginnode got unknown command '${cmd}'!`);
                    break;
            }
        }
    }

    getAdltDocumentAndPluginName(): [AdltDocument, string] | undefined {
        let parent: TreeViewNode | null = this.parent;
        do {
            if ('_doc' in parent) {
                return [parent['_doc'], parent['name']];
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