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
        if ('enabled' in options) {
            this.enabled = options.enabled;
        }
        if ('atLoadTime' in options) {
            this.atLoadTime = options.atLoadTime;
        }
        if ('ecu' in options) {
            this.ecu = options.ecu;
        }
        if ('apid' in options) {
            this.apid = options.apid;
        }
        if ('ctid' in options) {
            this.ctid = options.ctid;
        }
    }

    matches(msg: DltMsg): boolean {
        if (!this.enabled) {
            return false;
        }

        if (this.ecu && msg.ecu !== this.ecu) {
            return false;
        }
        if (this.apid && msg.apid !== this.apid) {
            return false;
        }
        if (this.ctid && msg.ctid !== this.ctid) {
            return false;
        }

        // if we reach here all defined criteria match
        return true;
    }

    get name(): string {
        const enabled: string = this.enabled ? "" : "disabled: ";
        let type: string = this.type === DltFilterType.POSITIVE ? "+" : (this.type === DltFilterType.NEGATIVE ? "-" : "*");
        if (this.atLoadTime) {
            type = "(load time) " + type;
        }
        let nameStr: string = "";
        if (this.ecu) { nameStr += `ECU:${this.ecu} `; };
        if (this.apid) { nameStr += `APID:${this.apid} `; };
        if (this.ctid) { nameStr += `CTID:${this.ctid}`; };

        return `${enabled}${type}${nameStr}`;
    }
}
