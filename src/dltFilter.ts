/* --------------------
 * Copyright(C) Matthias Behr.
 */

import { ThemeIcon } from 'vscode';
//import * as assert from 'assert';
import { FilterableDltMsg, MSTP, MTIN_LOG, MTIN_CTRL, MSTP_strs, MTIN_LOG_strs } from './dltParser';
import * as util from './util';
import { v4 as uuidv4 } from 'uuid';

export enum DltFilterType { POSITIVE, NEGATIVE, MARKER, EVENT };

export class DltFilter {
    filterName: string | undefined; // maps to "name" from config
    type: DltFilterType;
    enabled: boolean = true;
    atLoadTime: boolean = false; // this filter gets used a load/opening the dlt file already (thus can't be deactivated later). Not possible with MARKER.
    beforePositive: boolean = false; // for neg. (todo later for marker?): match this before the pos. filters. mainly used for plugins like FileTransfer
    negateMatch: boolean = false; // perform a "not"/! on the match result. As pos and neg. Filters are or'd this allows to create e.g. a pos filter that all messages have to match e.g. via NEGATIVE with NOT.

    // what to match for:
    mstp: number | undefined;
    ecu: string | undefined;
    apid: string | undefined;
    ctid: string | undefined;
    logLevelMin: number | undefined;
    logLevelMax: number | undefined;
    verbose: boolean | undefined;
    payload: string | undefined;
    payloadRegex: RegExp | undefined;
    lifecycles: number[] | undefined; // array with persistentIds from lifecycles

    // marker decorations:
    filterColour: string | undefined;
    decorationId: string | undefined;

    // time sync:
    timeSyncId: string | undefined;
    timeSyncPrio: number | undefined;

    // report options:
    reportOptions: any | undefined;

    // configs:
    private _configs: string[] = [];

    // the options used to create the object.
    // asConfiguration() modifies this one based on current values
    configOptions: any | undefined;

    constructor(options: any, readonly allowEdit = true) { // we do need at least the type
        if ('type' in options) {
            this.type = options["type"];
        } else {
            throw Error("type missing for DltFilter");
        }
        // we create a deep copy (ignoring functions....) and don't keep reference to the options
        // passed... otherwise changes on a filter in one document reflect the other as well.
        try {
            this.configOptions = JSON.parse(JSON.stringify(options));
        } catch (e) {
            throw Error(`can't JSON parse the options: ${e}`);
        }
        // and we assign a id/uuid if it's not there yet:
        // todo: check if id represents a valid uuid?
        if (!('id' in this.configOptions)) {
            this.configOptions.id = uuidv4();
            console.log(`DltFilter.constructor created id=${this.configOptions.id}`);
        }

        this.reInitFromConfiguration();
    }

    asConfiguration() { // to persist new Filters into configuration setting
        if (this.configOptions === undefined) { this.configOptions = { type: this.type, id: uuidv4() }; }
        const obj = this.configOptions;
        obj.type = this.type;
        // we don't store/change enabled. As we do use configs for runtime changes. 
        // obj.enabled = this.enabled ? undefined : false; // default to true. don't store to make the config small, readable
        obj.name = this.filterName;
        obj.atLoadTime = this.atLoadTime ? true : undefined; // default to false
        obj.not = this.negateMatch ? true : undefined; // default to false
        obj.mstp = this.mstp;
        obj.ecu = this.ecu;
        obj.apid = this.apid;
        obj.ctid = this.ctid;
        obj.logLevelMin = this.logLevelMin;
        obj.logLevelMax = this.logLevelMax;
        obj.verbose = this.verbose;
        obj.payload = this.payload;
        obj.payloadRegex = this.payloadRegex !== undefined ? this.payloadRegex.source : undefined;
        obj.lifecycles = this.lifecycles;
        obj.timeSyncId = this.timeSyncId;
        obj.timeSyncPrio = this.timeSyncPrio;
        obj.decorationId = this.decorationId;
        obj.filterColour = this.filterColour; // or remove blue?
        obj.reportOptions = this.reportOptions;
        obj.configs = this._configs.length > 0 ? this._configs : undefined; // we report it even if property later hides it

        return obj;
    }

    /**
     * Re-initializes the internal variables from the configOptions object.
     * Allows to update the filter from outside e.g. via filter.configOptions[key] = ...
     * and then reflect those values as well.
     * Take care: some values can't be changed! (e.g. type)
     */
    reInitFromConfiguration() {
        const options = this.configOptions;
        if (!options) { return; }

        this.filterName = 'name' in options ? options.name : undefined;

        this.enabled = 'enabled' in options ? options.enabled : true;

        this.atLoadTime = 'atLoadTime' in options ? options.atLoadTime : false;

        if ('not' in options) {
            this.negateMatch = options.not ? true : false;
        } else { this.negateMatch = false; }

        this.mstp = 'mstp' in options ? options.mstp : undefined;

        this.ecu = 'ecu' in options ? options.ecu : undefined;

        this.apid = 'apid' in options ? options.apid : undefined;

        this.ctid = 'ctid' in options ? options.ctid : undefined;

        if ('logLevelMin' in options) {
            this.mstp = 0;
            this.logLevelMin = options.logLevelMin;
        } else { this.logLevelMin = undefined; }

        if ('logLevelMax' in options) {
            this.mstp = 0;
            this.logLevelMax = options.logLevelMax;
        } else { this.logLevelMax = undefined; }

        this.verbose = 'verbose' in options ? options.verbose : undefined;

        this.payload = 'payload' in options ? options.payload : undefined;

        if ('payloadRegex' in options) {
            this.payload = undefined;
            this.payloadRegex = new RegExp(options.payloadRegex);

            // needs payloadRegex
            if ('timeSyncId' in options && 'timeSyncPrio' in options) {
                this.type = DltFilterType.EVENT;
                this.timeSyncId = options.timeSyncId;
                this.timeSyncPrio = options.timeSyncPrio;
            }
        } else { // on update those might have been set prev.
            this.payloadRegex = undefined;
            this.timeSyncId = undefined;
            this.timeSyncPrio = undefined;
        }

        this.lifecycles = 'lifecycles' in options && Array.isArray(options.lifecycles) ? options.lifecycles : undefined;

        this.decorationId = undefined;
        this.filterColour = undefined;
        if (this.type === DltFilterType.MARKER) {
            if ('decorationId' in options) { // has preference wrt filterColour
                this.decorationId = options.decorationId;
            } else if ('filterColour' in options) {
                this.filterColour = options.filterColour;
            } else {
                this.filterColour = "blue"; // default to blue
            }
        }

        this.reportOptions = undefined;
        if (this.isReport) {
            if ('reportOptions' in options) {
                this.reportOptions = options.reportOptions;
            }
        }

        this._configs = [];
        if ('configs' in options && Array.isArray(options.configs)) {
            this._configs.push(...options.configs);
        }


    }

    matches(msg: FilterableDltMsg): boolean {
        if (!this.enabled) {
            return false; // negateMatch doesn't negate this!
        }

        const negated = this.negateMatch;

        if (this.mstp !== undefined && msg.mstp !== this.mstp) { return negated; }
        if (this.logLevelMax && msg.mtin > this.logLevelMax) { return negated; } // mstp already checked
        if (this.logLevelMin && msg.mtin < this.logLevelMin) { return negated; } // mstp already checked
        if (this.ecu && msg.ecu !== this.ecu) { return negated; }
        if (this.apid && msg.apid !== this.apid) { return negated; }
        if (this.ctid && msg.ctid !== this.ctid) { return negated; }
        if (this.verbose !== undefined && msg.verbose !== this.verbose) { return negated; }
        if (this.payload && !msg.payloadString.includes(this.payload)) { return negated; }
        if (this.payloadRegex !== undefined && !this.payloadRegex.test(msg.payloadString)) { return negated; }
        if (this.lifecycles !== undefined && this.lifecycles.length > 0) {
            // we treat an empty array as always matching (that's why we skip this check if length<=0)
            // otherwise the msg lifecycle needs to be within the array:
            // msgs without lifecycle are not matched
            const lc = msg.lifecycle;
            if (!lc) { return negated; }
            const msgLcPeristentId = lc.persistentId;
            let foundLc: boolean = false;
            const lcArray = this.lifecycles;
            const lcLength = lcArray.length;
            for (let i = 0; i < lcLength; ++i) {
                if (msgLcPeristentId === lcArray[i]) { foundLc = true; break; }
            }
            if (!foundLc) { return negated; }
        }

        // if we reach here all defined criteria match
        return !negated;
    }

    get iconPath(): ThemeIcon | undefined {
        if (this.isReport) {
            return new ThemeIcon('graph');
        } else if (!this.enabled) {
            return new ThemeIcon('stop-circle');
        } else {
            return new ThemeIcon('play');
        }
        return undefined;
    }

    get id(): string {
        return this.configOptions.id;
    }

    get name(): string {
        let enabled: string = this.enabled ? "" : "disabled: ";
        if (this.filterName) {
            enabled += this.filterName + ' ';
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
        if (this.negateMatch) {
            type += '!';
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
        if (this.verbose !== undefined) { nameStr += this.verbose ? 'VERB ' : 'NON-VERB '; }
        if (this.payload) { nameStr += `payload contains '${this.payload}' `; }
        if (this.payloadRegex !== undefined) { nameStr += `payload matches '${this.payloadRegex.source}'`; }
        if (this.lifecycles !== undefined) { nameStr += ` in ${this.lifecycles.length} LCs`; }
        if (this.timeSyncId !== undefined) { nameStr += ` timeSyncId:${this.timeSyncId} prio:${this.timeSyncPrio}`; }

        return `${enabled}${type}${nameStr}`;
    }

    get isReport(): boolean {
        // a report filter is a type EVENT filter that has a payloadRegex and no timeSyncId
        return this.type === DltFilterType.EVENT && (this.payloadRegex !== undefined) && (this.timeSyncId === undefined);
    }

    /**
     * array of config names/paths this filter belongs to.
     * The property returns empty if the filter is a load time filter
     * as configs don't make sense then.
     */
    get configs(): string[] {
        return this.atLoadTime ? [] : this._configs;
    }

    set configs(newCfgs: string[]) {
        // we do allow setting it even for load time filters
        this._configs = newCfgs;
    }

    asRestObject(idHint: number): util.RestObject {
        return {
            id: this.id,
            type: 'filter',
            attributes: this.asConfiguration() // inludes id again...
        };
    }
}
