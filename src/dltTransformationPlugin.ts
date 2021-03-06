/* --------------------
 * Copyright(C) Matthias Behr. 2021
 */

import * as vscode from 'vscode';
import { TreeViewNode } from './dltTreeViewNodes';
import { DltFilter, DltFilterType } from './dltFilter';
import { DltMsg } from './dltParser';
import { assert } from 'console';

export class DltTransformationPlugin extends DltFilter {
    private _uri: vscode.Uri;
    protected _treeEventEmitter: vscode.EventEmitter<TreeViewNode | null>;
    protected _boundTransformCb: ((msg: DltMsg) => void) | undefined;

    constructor(uri: vscode.Uri, public treeViewNode: TreeViewNode, treeEventEmitter: vscode.EventEmitter<TreeViewNode | null>, options: any) {
        super({ type: DltFilterType.MARKER }, false); // don't allow Edit from treeViewExplorer for these
        if ('enabled' in options) {
            this.enabled = options.enabled;
        } else {
            this.enabled = true;
        }

        this.atLoadTime = true; // for now only supported at load time (afterwards filters might already apply...)
        this._uri = uri;
        this._treeEventEmitter = treeEventEmitter;
    }

    /**
     * return true if this plugin can transform the message.
     * The message itself is not transformed/modified yet.
     */
    matches(msg: DltMsg): boolean {
        if (!this.enabled) {
            return false;
        }
        return false; // needs to be overwritten
    }

    getTransformCb(): ((msg: DltMsg) => void) {
        assert(this._boundTransformCb);
        return this._boundTransformCb!;
    };
}
