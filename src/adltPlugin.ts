// copyright(c) Matthias Behr, 2022

import * as vscode from 'vscode';
import * as util from './util';
import { TreeViewNode } from "./dltTreeViewNodes";

// let treeNode = { , label: `SOME/IP Decoder`, uri: this.uri, parent: this.pluginTreeNode, children: [], tooltip: undefined, iconPath: new vscode.ThemeIcon('group-by-ref-type') }; // or symbol-interface?

export class AdltPlugin implements TreeViewNode {

    readonly id: string;
    public enabled: boolean;
    public options: any; // those will be send to adlt
    public children: TreeViewNode[] = [];
    public active: boolean; // will be set based on open status from adlt

    constructor(private origLabel: string, public iconPath: vscode.ThemeIcon | undefined, public uri: vscode.Uri, public parent: TreeViewNode, private treeEventEmitter: vscode.EventEmitter<TreeViewNode | null>, options: any) {

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

        let iconPath = undefined;
        if (childObj.iconPath) {
            let iconColor = undefined;
            switch (childObj.iconPath) {
                case 'warning': iconColor = new vscode.ThemeColor("list.warningForeground");
                    break;
                case 'error': iconColor = new vscode.ThemeColor("list.errorForeground");
                    break;
                default: break;
            }
            iconPath = new vscode.ThemeIcon(childObj.iconPath, iconColor);
        }

        let newNode: TreeViewNode = {
            id: util.createUniqueId(),
            label: childObj.label || '<no label>',
            description: childObj.description || false,
            contextValue: childObj.contextValue,
            tooltip: childObj.tooltip, // or as MarkDownString?
            parent: parent,
            uri: this.uri,
            children: [], // todo
            // todo: use all parameter from newChild object???
            iconPath,
        };
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