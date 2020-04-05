/* --------------------
 * Copyright(C) Matthias Behr.
 */

import * as vscode from 'vscode';
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { DltMsg, MSTP, MTIN_LOG, MTIN_CTRL } from './dltParser';
// import { DltLifecycleInfo } from './dltLifecycle';

export enum DltFilterType { POSITIVE, NEGATIVE, MARKER };

export class DltFilter {
    readonly type: DltFilterType;
    enabled: boolean = true;
    atLoadTime: boolean = false; // this filter gets used a load/opening the dlt file already (thus can't be deactivated later). Not possible with MARKER.

    // what to match for:
    ecu: string | undefined;
    apid: string | undefined;
    ctid: string | undefined;

    constructor(options: any) { // we do need at least the type
        if ('type' in options) {
            this.type = options["type"];
        } else {
            throw Error("type missing for DltFilter");
        }
        if (options.enabled) {
            this.enabled = options.enabled;
        }
        if (options.atLoadTime) {
            this.atLoadTime = options.atLoadTime;
        }
        if (options.ecu) {
            this.ecu = options.ecu;
        }
        if (options.apid) {
            this.apid = options.apid;
        }
        if (options.ctid) {
            this.ctid = options.ctid;
        }
    }

    matches(msg: DltMsg): boolean {
        if (!this.enabled) {
            return false;
        }

        if (this.ecu && msg.ecu === this.ecu) {
            return true;
        }
        if (this.apid && msg.apid === this.apid) {
            return true;
        }
        if (this.ctid && msg.ctid === this.ctid) {
            return true;
        }

        return false;
    }
}
