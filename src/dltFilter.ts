/* --------------------
 * Copyright(C) Matthias Behr.
 */

//import * as vscode from 'vscode';
//import * as assert from 'assert';
import { DltMsg, MSTP, MTIN_LOG, MTIN_CTRL, MSTP_strs, MTIN_LOG_strs } from './dltParser';

export enum DltFilterType { POSITIVE, NEGATIVE, MARKER, EVENT };

export class DltFilter {
    type: DltFilterType;
    enabled: boolean = true;
    atLoadTime: boolean = false; // this filter gets used a load/opening the dlt file already (thus can't be deactivated later). Not possible with MARKER.
    beforePositive: boolean = false; // for neg. (todo later for marker?): match this before the pos. filters. mainly used for plugins like FileTransfer

    // what to match for:
    mstp: number | undefined;
    ecu: string | undefined;
    apid: string | undefined;
    ctid: string | undefined;
    logLevelMin: number | undefined;
    logLevelMax: number | undefined;
    payload: string | undefined;
    payloadRegex: RegExp | undefined;

    // marker decorations:
    filterColour: string | undefined;
    decorationId: string | undefined;

    // time sync:
    timeSyncId: string | undefined;
    timeSyncPrio: number | undefined;

    // report options:
    reportOptions: any | undefined;

    // configs:
    configs: string[] = [];

    // the options used to create the object.
    // asConfiguration() modifies this one based on current values
    configOptions: any | undefined;

    constructor(options: any, readonly allowEdit = true) { // we do need at least the type
        if ('type' in options) {
            this.type = options["type"];
        } else {
            throw Error("type missing for DltFilter");
        }
        this.configOptions = options;
        if ('enabled' in options) {
            this.enabled = options.enabled;
        }
        if ('atLoadTime' in options) {
            this.atLoadTime = options.atLoadTime;
        }
        if ('mstp' in options) {
            this.mstp = options.mstp;
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
        if ('logLevelMin' in options) {
            this.mstp = 0;
            this.logLevelMin = options.logLevelMin;
        }
        if ('logLevelMax' in options) {
            this.mstp = 0;
            this.logLevelMax = options.logLevelMax;
        }
        if ('payload' in options) {
            this.payload = options.payload;
        }
        if ('payloadRegex' in options) {
            this.payload = undefined;
            this.payloadRegex = new RegExp(options.payloadRegex);

            // needs payloadRegex
            if ('timeSyncId' in options && 'timeSyncPrio' in options) {
                this.type = DltFilterType.EVENT;
                this.timeSyncId = options.timeSyncId;
                this.timeSyncPrio = options.timeSyncPrio;
            }
        }

        if (this.type === DltFilterType.MARKER) {
            if ('decorationId' in options) { // has preference wrt filterColour
                this.decorationId = options.decorationId;
            } else if ('filterColour' in options) {
                this.filterColour = options.filterColour;
            } else {
                this.filterColour = "blue"; // default to blue
            }
        }

        if (this.isReport) {
            if ('reportOptions' in options) {
                this.reportOptions = options.reportOptions;
            }
        }

        if ('configs' in options && Array.isArray(options.configs)) {
            this.configs.push(...options.configs);
        }

    }

    asConfiguration() { // to persist new Filters into configuration setting
        if (this.configOptions === undefined) { this.configOptions = { type: this.type }; }
        const obj = this.configOptions;
        obj.type = this.type;
        // we don't store/change enabled. As we do use configs for runtime changes. 
        // obj.enabled = this.enabled ? undefined : false; // default to true. don't store to make the config small, readable
        obj.atLoadTime = this.atLoadTime ? true : undefined; // default to false
        obj.mstp = this.mstp;
        obj.ecu = this.ecu;
        obj.apid = this.apid;
        obj.ctid = this.ctid;
        obj.logLevelMin = this.logLevelMin;
        obj.logLevelMax = this.logLevelMax;
        obj.payload = this.payload;
        obj.payloadRegex = this.payloadRegex !== undefined ? this.payloadRegex.source : undefined;
        obj.timeSyncId = this.timeSyncId;
        obj.timeSyncPrio = this.timeSyncPrio;
        obj.decorationId = this.decorationId;
        obj.filterColour = this.filterColour; // or remove blue?
        obj.reportOptions = this.reportOptions;
        obj.configs = this.configs.length > 0 ? this.configs : undefined;

        return obj;
    }

    matches(msg: DltMsg): boolean {
        if (!this.enabled) {
            return false;
        }

        if (this.mstp !== undefined && msg.mstp !== this.mstp) { return false; }
        if (this.logLevelMax && msg.mtin > this.logLevelMax) { return false; } // mstp already checked
        if (this.logLevelMin && msg.mtin < this.logLevelMin) { return false; } // mstp already checked
        if (this.ecu && msg.ecu !== this.ecu) { return false; }
        if (this.apid && msg.apid !== this.apid) { return false; }
        if (this.ctid && msg.ctid !== this.ctid) { return false; }
        if (this.payload && !msg.payloadString.includes(this.payload)) { return false; }
        if (this.payloadRegex !== undefined && !this.payloadRegex.test(msg.payloadString)) { return false; }

        // if we reach here all defined criteria match
        return true;
    }

    get name(): string {
        let enabled: string = this.enabled ? "" : "disabled: ";
        if (this.isReport) {
            enabled = "report "; // we ignore enabled for report
        }
        let type: string;
        switch (this.type) {
            case DltFilterType.POSITIVE: type = "+"; break;
            case DltFilterType.NEGATIVE: type = "-"; break;
            case DltFilterType.MARKER: type = "*"; break;
            case DltFilterType.EVENT: type = "@"; break;
        };
        if (this.atLoadTime) {
            type = "(load time) " + type;
        }
        let nameStr: string = "";
        if (this.mstp !== undefined) {
            nameStr += MSTP_strs[this.mstp];
            nameStr += ' ';
        }
        if (this.logLevelMin) { // we ignore 0 values here
            nameStr += `>=${MTIN_LOG_strs[this.logLevelMin]} `;
        }
        if (this.logLevelMax) { // we ignore 0 value here
            nameStr += `<=${MTIN_LOG_strs[this.logLevelMax]} `;
        }
        if (this.ecu) { nameStr += `ECU:${this.ecu} `; } // we ignore empty strings
        if (this.apid) { nameStr += `APID:${this.apid} `; }
        if (this.ctid) { nameStr += `CTID:${this.ctid} `; }
        if (this.payload) { nameStr += `payload contains '${this.payload}' `; }
        if (this.payloadRegex !== undefined) { nameStr += `payload matches '${this.payloadRegex.source}'`; }
        if (this.timeSyncId !== undefined) { nameStr += ` timeSyncId:${this.timeSyncId} prio:${this.timeSyncPrio}`; }

        return `${enabled}${type}${nameStr}`;
    }

    get isReport(): boolean {
        // a report filter is a type EVENT filter that has a payloadRegex and no timeSyncId
        return this.type === DltFilterType.EVENT && (this.payloadRegex !== undefined) && (this.timeSyncId === undefined);
    }
}
