/* --------------------
 * Copyright(C) Matthias Behr. 2021
 *
 * todos:
 * - tooltips with orig data, ...
 * - update docs
 */

import * as vscode from 'vscode';
import { TreeViewNode } from './dltTreeViewNodes';
import { DltMsg } from './dltParser';
import { createUniqueId } from './util';
import { DltFilter, DltFilterType } from './dltFilter';
import { DltTransformationPlugin } from './dltTransformationPlugin';

interface Rewrite {
    name: string,
    matchFilter: DltFilter,
    payloadRegex: RegExp | undefined,
    rewrite: { [key: string]: Function }
}

export class DltRewriteMsgPlugin extends DltTransformationPlugin {

    private _rewritesNode: TreeViewNode | undefined;
    private _rewrites: Rewrite[];

    constructor(uri: vscode.Uri, public treeViewNode: TreeViewNode, treeEventEmitter: vscode.EventEmitter<TreeViewNode | null>, options: any) {
        super(uri, treeViewNode, treeEventEmitter, options);
        this._boundTransformCb = this.transformCb.bind(this);

        this._rewrites = Array.isArray(options['rewrites']) ? (options['rewrites'].filter(r => typeof r.name === 'string' && r.name?.length > 0).map((r, index) => {
            return {
                name: r.name as string,
                matchFilter: new DltFilter({ type: DltFilterType.POSITIVE, ...r.filter, id: `rewrite_${index}` }, false),
                payloadRegex: typeof r.payloadRegex === 'string' ? new RegExp(r.payloadRegex) : undefined,
                rewrite: Object.fromEntries(
                    Object.entries(r.rewrite).map(([k, v], i) => [k.toLowerCase(), (new Function('"use strict";return ' + v))()])
                )
            };
        })) : [];

        console.warn(`DltRewriteMsgPlugin (enabled=${this.enabled}, rewrites = ${JSON.stringify(this._rewrites)})`);

        if (!this.enabled) {
            this.treeViewNode.tooltip = `disabled`;
        }

        if (this._rewrites.length) {
            if (this.enabled) {
                this.treeViewNode.tooltip = `loaded ${this._rewrites.length} configs:\n${this._rewrites.map(r => r.name).join('\n')}`;
            }
            this._rewritesNode = { id: createUniqueId(), label: `Rewrites ${this.enabled ? '' : 'disabled '}(${this._rewrites.length})`, children: [], parent: treeViewNode, tooltip: '', uri: uri };
            treeViewNode.children.push(this._rewritesNode);
            // add rewrites:
            this._rewrites.forEach((r) => {
                const serviceNode: TreeViewNode = {
                    id: createUniqueId(),
                    label: `${r.name}`,
                    tooltip: `for msgs matching ${JSON.stringify(r.matchFilter.name)} rewriting ${Object.keys(r.rewrite).join(' & ')}`,
                    uri: uri, children: [], parent: this._rewritesNode!
                };
                this._rewritesNode!.children.push(serviceNode);
            });

            this._treeEventEmitter.fire(this.treeViewNode);
        }
    }

    get name(): string {
        return `${this.enabled ? '' : "disabled: "} plugin 'rewrite'`;
    }

    changesOnlyPayloadString(): boolean { return false; };

    matches(msg: DltMsg): boolean {
        if (!this.enabled) {
            return false;
        }

        // check whether any rewrite filter matches:
        for (let i = 0; i < this._rewrites.length; ++i) {
            if (this._rewrites[i].matchFilter.matches(msg)) { return true; }
        }

        return false;
    }

    transformCb(msg: DltMsg) {
        try {
            // _payloadText is set already (and that's important as otherwise recursion might happen!)
            if (msg._payloadText) {
                // which rewrite did match? stop at first (if we only have one then use that one)
                for (let i = 0; i < this._rewrites.length; ++i) {
                    if ((i === this._rewrites.length - 1) || this._rewrites[i].matchFilter.matches(msg)) { // todo this might evaluate payloadText. Wont lead to recursive call but its a bit undeterministic whether the filter will get the initial or converted value
                        const rewrite = this._rewrites[i];
                        const match = rewrite.payloadRegex ? msg._payloadText.match(rewrite.payloadRegex) : undefined;
                        if (match === undefined || match !== null) {
                            // now apply all functions:
                            Object.entries(rewrite.rewrite).forEach(([k, v], i) => {
                                const newV = v(match, msg);
                                if (newV !== undefined) {
                                    switch (k) {
                                        case 'timestamp': if (typeof newV === 'number') { msg.timeStamp = newV; } break;
                                        case 'payloadtext': if (typeof newV === 'string') { msg._payloadText = newV; } break;
                                        // todo add useful cases (log level, apid, ctid, ecu, sessionId, ...) but consider impact on filters...
                                        default:
                                            console.warn(`unsupported key #${i} '${k}' in RewriteMsgPlugin rewrite entry!`);
                                            break;
                                    }
                                }
                            });
                        }
                        break;
                    }
                }
            }
        } catch (e) {
            console.warn(`DltRewriteMsgPlugin got error: '${e}'`);
        }
    }
}

