/* --------------------
 * Copyright(C) Matthias Behr.
 */

// import * as vscode from 'vscode';
import * as assert from 'assert';
import { DltParser, DltMsg, MSTP, MTIN_CTRL, CTRL_SERVICE_ID } from './dltParser';

let _nextLcUniqueId = 1;

export class DltLifecycleInfo {
    uniqueId: number;
    private _startTime: number; // in ms / within log
    readonly startIndex: number;
    adjustTimeMs: number;
    private _lifecycleStart: number; // in ms including timestamp calc. e.g. _startTime - timestamp
    private _maxTimeStamp: number; // so _lifecycleStart + maxTimestamp defines the "end"
    readonly logMessages: DltMsg[]; // todo should be sorted... by timestamp? (without ctrl requests timestamps)
    allCtrlRequests: boolean = true; // this lifecycle consists of only ctrl requests.
    private _swVersions: string[] = [];

    apidInfos: Map<string, { apid: string, desc: string, ctids: Map<string, string> }> = new Map(); // map with apids/ctid infos

    constructor(logMsg: DltMsg) {
        this.uniqueId = _nextLcUniqueId++;
        // if its a control message from logger we ignore the timestamp:
        let timeStamp = logMsg.timeStamp;
        if (logMsg.mstp === MSTP.TYPE_CONTROL && logMsg.mtin === MTIN_CTRL.CONTROL_REQUEST) {
            timeStamp = 0;
        } else {
            this.allCtrlRequests = false;
        }
        this._startTime = logMsg.timeAsNumber;
        this.adjustTimeMs = 0;
        this.startIndex = logMsg.index;
        this._lifecycleStart = this._startTime - (timeStamp / 10);
        this._maxTimeStamp = timeStamp;
        this.logMessages = [logMsg];
        logMsg.lifecycle = this;
        this.parseMessage(logMsg);
        // will be set later by _updateLines based on current filter
        console.log(`DltLifecycleInfo() startTime=${this._startTime} lifecycleStart=${this._lifecycleStart}`);
    }

    get lifecycleStart(): Date {
        return new Date(this.adjustTimeMs + this._lifecycleStart);
    }

    get lifecycleEnd(): Date {
        return new Date(this.adjustTimeMs + this._lifecycleStart + (this._maxTimeStamp / 10));
    }

    get endIndex(): number {
        if (this.logMessages.length) {
            return this.logMessages[this.logMessages.length - 1].index; // todo take care if sort by time... use maxIndex then?
        } else {
            return this.startIndex;
        }
    }

    public getTreeNodeLabel(): string {
        return `${this.lifecycleStart.toLocaleTimeString()}-${this.lifecycleEnd.toLocaleTimeString()} #${this.logMessages.length}`;
    }

    get tooltip(): string {
        return `SW:${this._swVersions.join(',')}`;
    }

    get swVersions() {
        return this._swVersions;
    }

    public update(logMsg: DltMsg): boolean {
        if (this.adjustTimeMs !== 0) {
            console.error(`DltLifecycle.update adjustTimeMs<>0`); // todo implement
        }
        /* this function has the tough part to decide whether the startTime, timestamp
        seem to extend this lifecycle or seem part of a new one (return false then)*/

        // if its a control message from logger we ignore it:
        if (logMsg.mstp === MSTP.TYPE_CONTROL && logMsg.mtin === MTIN_CTRL.CONTROL_REQUEST) {
            this.logMessages.push(logMsg); // todo we might check the time and add it as a new lifecycle as well!
            logMsg.lifecycle = this;
            return true;
        }

        // if timestamp info is missing, we do ignore (aka treat as part of this lifecycle):
        if (logMsg.timeStamp === 0) {
            this.allCtrlRequests = false;
            this.logMessages.push(logMsg);
            logMsg.lifecycle = this;
            return true;
        }


        // calc _lifecycleStart for this one:
        let newLifecycleStart: number = logMsg.timeAsNumber - (logMsg.timeStamp / 10);
        // if newLifecycleStart is later than current end _lifecycleStart+_maxTimestamp
        if ((newLifecycleStart - ((this.adjustTimeMs + this._lifecycleStart) + (this._maxTimeStamp / 10)) > 1000)) {
            // todo 1s, after a longer lifecycle we can reduce this to e.g. 50ms... but for short (~4s) lifecycles not (10773, 11244)
            // we could as well afterwards in a 2nd step merge the lifecycles again (visible with roughly same lifecycleStart...)
            console.log(`DltLifecycleInfo:update (logMsg(index=${logMsg.index} at ${logMsg.timeAsDate}:${logMsg.timeStamp}) not part of this lifecycle(startIndex=${this.startIndex} end=${this.lifecycleEnd} ) `);
            return false; // treat as new lifecycle
        }
        if (logMsg.timeAsNumber < this._startTime) {
            console.log("DltLifecycleInfo:update new starttime earlier? ", this._startTime, logMsg.timeAsNumber);
        }
        if (newLifecycleStart < (this.adjustTimeMs + this._lifecycleStart)) {
            // update new lifecycle start:
            if ((this.adjustTimeMs + this._lifecycleStart) - newLifecycleStart > 1000) { // only inform about jumps >1s
                console.log(`DltLifecycleInfo:update new lifecycleStart from ${this.lifecycleStart} to ${newLifecycleStart} due to ${logMsg.index}`);
            }
            this._lifecycleStart = newLifecycleStart;
        }
        if (logMsg.timeStamp > this._maxTimeStamp) {
            this._maxTimeStamp = logMsg.timeStamp;
        }
        // todo we might have to update startIndex based on current index. currently we assume they are strong monotonically increasing

        this.logMessages.push(logMsg);
        logMsg.lifecycle = this;
        this.allCtrlRequests = false;
        this.parseMessage(logMsg);

        return true; // part of this one
    }

    private parseMessage(msg: DltMsg) {
        if (msg.mstp === MSTP.TYPE_CONTROL && msg.mtin === MTIN_CTRL.CONTROL_RESPONSE) {
            if (msg.noar === 1) {
                if (msg.payloadArgs[0].v === CTRL_SERVICE_ID.GET_SW_VERSION) {
                    const swVStr = msg.payloadString;
                    if (swVStr.startsWith("get_software_version, ok,")) { // hackish...
                        const swV = swVStr.slice(25);
                        if (!this._swVersions.includes(swV)) {
                            this._swVersions.push(swV);
                            console.log(`parseMessage swVersions='${this._swVersions.join(',')}'`);
                        }
                    }
                } else
                    if (msg.payloadArgs[0].v === CTRL_SERVICE_ID.GET_LOG_INFO) {
                        if (msg.payloadArgs.length > msg.noar) {
                            // the first one is the array of apid infos:
                            const apids = msg.payloadArgs[msg.noar];
                            for (let i = 0; i < apids.length; ++i) {
                                const apidInfo = apids[i];
                                if (!this.apidInfos.has(apidInfo.apid)) {
                                    this.apidInfos.set(apidInfo.apid, { apid: apids.apid, desc: apidInfo.desc, ctids: new Map<string, string>() });
                                    //console.log(`get_log_info added apid = ${apidInfo.apid}`);
                                }
                                const knownApidInfo = this.apidInfos.get(apidInfo.apid);
                                if (knownApidInfo !== undefined) {
                                    for (let c = 0; c < apidInfo.ctids.length; ++c) {
                                        const ctidObj = apidInfo.ctids[c];
                                        // check whether ctid is known:
                                        if (!knownApidInfo.ctids.has(ctidObj.ctid)) {
                                            knownApidInfo.ctids.set(ctidObj.ctid, ctidObj.desc);
                                            //console.log(`get_log_info added apid/ctid = ${apidInfo.apid}/${ctidObj.ctid}`);
                                        }
                                    }
                                }
                            }
                        }
                    }
            }
        }
    }

    static updateLifecycles(msgs: DltMsg[], lifecycles: Map<string, DltLifecycleInfo[]>) {
        // iterate over all ecus (not in parallel, only for each ecu in parallel possible)
        for (let i = 0; i < msgs.length; ++i) {
            const msg = msgs[i];
            const ecu = msg.ecu;
            if (!lifecycles.has(ecu)) {
                console.log(`updateLifecycles: added ${ecu} from ${msg.index}:${msg.timeAsDate}`);
                lifecycles.set(ecu, [new DltLifecycleInfo(msg)]);
            } else {
                let lcInfos = lifecycles.get(ecu)!;
                let lastLc = lcInfos[lcInfos?.length - 1]; // there is at least one
                if (!lastLc.update(msg)) {
                    console.log(`updateLifecycles: added  ${ecu} from ${msg.index}:${msg.timeAsDate}`);
                    lcInfos.push(new DltLifecycleInfo(msg));
                }
            }
        }
        // we remove all lifecycles that contain only CONTROL REQUEST messages:
        lifecycles.forEach((lcInfos, ecu) => {
            for (let i = 0; i < lcInfos.length; ++i) {
                const lcInfo = lcInfos[i];
                if (lcInfo.allCtrlRequests) {
                    console.log(`updateLifecycles: lifecycle for ecu '${ecu}' with only CTRL requests found. Deleting...`);
                    lcInfos.splice(i, 1);
                    i--;
                }
            }
            if (lcInfos.length === 0) {
                console.log(`updateLifecycles: ecu '${ecu}' now without lifecycles. Deleting...`);
                lifecycles.delete(ecu);
            }
        });
    }
}
