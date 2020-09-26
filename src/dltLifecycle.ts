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
    readonly ecu: string; // from first msg
    apidInfos: Map<string, { apid: string, desc: string, ctids: Map<string, string> }> = new Map(); // map with apids/ctid infos
    private _mergedIntoLc: DltLifecycleInfo | undefined = undefined;

    constructor(logMsg: DltMsg, storeMsg: boolean = true) {
        this.uniqueId = _nextLcUniqueId++;
        // if its a control message from logger we ignore the timestamp:
        let timeStamp = logMsg.timeStamp;
        if (logMsg.mstp === MSTP.TYPE_CONTROL && logMsg.mtin === MTIN_CTRL.CONTROL_REQUEST) {
            timeStamp = 0;
        } else {
            this.allCtrlRequests = false;
        }
        this.ecu = logMsg.ecu;
        this._startTime = logMsg.timeAsNumber;
        this.adjustTimeMs = 0;
        this.startIndex = logMsg.index;
        this._lifecycleStart = this._startTime - (timeStamp / 10);
        this._maxTimeStamp = timeStamp;
        this.logMessages = storeMsg ? [logMsg] : [];
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
        return `${this.lifecycleStart.toLocaleString()}-${this.lifecycleEnd.toLocaleTimeString()} #${this.logMessages.length}`;
    }

    get tooltip(): string {
        return `SW:${this._swVersions.join(',')}`;
    }

    get swVersions() {
        return this._swVersions;
    }

    get finalLifecycle(): DltLifecycleInfo {
        return (this._mergedIntoLc !== undefined) ? this._mergedIntoLc.finalLifecycle : this;
    }

    public merge(otherLc: DltLifecycleInfo) {
        assert(otherLc._mergedIntoLc === undefined);
        // if the otherLc has messages:
        if (otherLc.logMessages.length > 0) {
            for (let i = 0; i < otherLc.logMessages.length; ++i) {
                // todo this doesn't work for storeMsgs = false!
                const msgToMove = otherLc.logMessages[i];
                this.update(msgToMove, true, true);
            }
        } else {
            // storeMsgs = false was used, so we only update the
            // lifecycleStart and maxTimeStamp
            if (otherLc._lifecycleStart < this._lifecycleStart) { this._lifecycleStart = otherLc._lifecycleStart; }
            if (otherLc._maxTimeStamp > this._maxTimeStamp) { this._maxTimeStamp = otherLc._maxTimeStamp; }
            if (!otherLc.allCtrlRequests) { this.allCtrlRequests = false; }

            otherLc._swVersions.forEach(swV => {
                if (!this._swVersions.includes(swV)) {
                    this._swVersions.push(swV);
                }
            });

            // todo merge with oterhLc.apidInfos

            // as the otherLc doesn't know which messages are referring to it
            // we do need to store the info in otherLc that it has been merged
            // with this one.
            // later one the msgInfos need to query the finalLifecycle()
        }
        otherLc._mergedIntoLc = this;
    }

    public update(logMsg: DltMsg, storeMsg: boolean, forceAdd: boolean): boolean {
        if (this.adjustTimeMs !== 0) {
            console.error(`DltLifecycle.update adjustTimeMs<>0`); // todo implement
        }
        /* this function has the tough part to decide whether the startTime, timestamp
        seem to extend this lifecycle or seem part of a new one (return false then)*/

        // if its a control message from logger we ignore it:
        if (logMsg.mstp === MSTP.TYPE_CONTROL && logMsg.mtin === MTIN_CTRL.CONTROL_REQUEST) {
            if (storeMsg) { this.logMessages.push(logMsg); }
            logMsg.lifecycle = this;
            return true;
        }

        // if timestamp info is missing, we do ignore (aka treat as part of this lifecycle):
        if (logMsg.timeStamp === 0) {
            this.allCtrlRequests = false;
            if (storeMsg) { this.logMessages.push(logMsg); }
            logMsg.lifecycle = this;
            return true;
        }


        // current values of this lifecycle without the new msg:
        const lifecycleStartTime = (this.adjustTimeMs + this._lifecycleStart);
        const lifecycleEndTime = lifecycleStartTime + (this._maxTimeStamp / 10);

        // calc _lifecycleStart for the new msg:
        let newLifecycleStart: number = logMsg.timeAsNumber - (logMsg.timeStamp / 10); // - unknown bufferingDelay_msg

        const bufferingDelay_b = newLifecycleStart - lifecycleStartTime;

        const realTime_b = lifecycleStartTime + (logMsg.timeStamp / 10);
        const realTime_c = newLifecycleStart + (logMsg.timeStamp / 10); // same as logMsg.timeAsNumber

        const timeToTimeStr = (timeAsNumber: number) => {
            return `${new Date(timeAsNumber).toLocaleTimeString()}.${Number(timeAsNumber % 1000).toFixed(1).padStart(3, '0')}`;
        };


        if (newLifecycleStart > lifecycleEndTime) {
            //console.warn(`msg #${logMsg.index} bufferingDelay_b=${Number(bufferingDelay_b).toFixed(1)}ms, newStart-EndTime=${Number(newLifecycleStart - lifecycleEndTime).toFixed(1)}ms maxTimestamp=${(this._maxTimeStamp / 10)} newTimestamp=${logMsg.timeStamp / 10} realTime_b=${timeToTimeStr(realTime_b)} realTime_c=${timeToTimeStr(realTime_c)}`);
        }

        // if newLifecycleStart is later than current end _lifecycleStart+_maxTimestamp
            // todo 1s, after a longer lifecycle we can reduce this to e.g. 50ms... but for short (~4s) lifecycles not (10773, 11244)
        let newLifecycleDistanceMs = 1000; // default 1s
        if (this._maxTimeStamp > 100 * 1000 * 10) { newLifecycleDistanceMs = 10; } else // 10ms for lc >100s
            if (this._maxTimeStamp > 30 * 1000 * 10) { newLifecycleDistanceMs = 250; } else // 250ms for lc>30s
                if (this._maxTimeStamp > 10 * 1000 * 10) { newLifecycleDistanceMs = 500; } // 500ms for lc>10s

        if (!forceAdd && (newLifecycleStart - lifecycleEndTime > newLifecycleDistanceMs)) {
            // we could as well afterwards in a 2nd step merge the lifecycles again (visible with roughly same lifecycleStart...)
            console.log(`DltLifecycleInfo:update (logMsg(index=${logMsg.index} at ${logMsg.timeAsDate}:${logMsg.timeStamp}) not part of this lifecycle(startIndex=${this.startIndex} end=${this.lifecycleEnd} ) `);
            return false; // treat as new lifecycle
        }
        if (logMsg.timeAsNumber < this._startTime) {
            console.log("DltLifecycleInfo:update new starttime earlier? ", this._startTime, logMsg.timeAsNumber);
        }

        // if the timestamp is too high (+10min) we treat it as not plausible:
        const timeStampTooHigh = (logMsg.timeStamp > this._maxTimeStamp) && ((logMsg.timeStamp - this._maxTimeStamp) > (10 * 60 * 10000));
        if (timeStampTooHigh) {
            // we treat it as corrupted/weird if its >10mins diff.
            // otherwise this moves the lifecycle start to a lot earlier
            console.warn(`DltLifecycleInfo: timeStampTooHigh: ignoring maxTimeStamp ${logMsg.timeStamp}, keeping ${this._maxTimeStamp} and lifecycleStart`);
        }

        if (newLifecycleStart < lifecycleStartTime) { // this is (R1) from above.
            if (!timeStampTooHigh) {
            // update new lifecycle start:
            if (lifecycleStartTime - newLifecycleStart > 1000) { // only inform about jumps >1s
                console.log(`DltLifecycleInfo:update new lifecycleStart from ${this.lifecycleStart} to ${newLifecycleStart} due to ${logMsg.index}`);
            }
            this._lifecycleStart = newLifecycleStart; // todo or with adjustTimeMs? (well for now adjustTimeMs is anyhow 0 at start)
        }
        }
        if (logMsg.timeStamp > this._maxTimeStamp) {
            if (!timeStampTooHigh) {
            this._maxTimeStamp = logMsg.timeStamp;
        }
        }
        // todo we might have to update startIndex based on current index. currently we assume they are strong monotonically increasing

        if (storeMsg) { this.logMessages.push(logMsg); }
        logMsg.lifecycle = this;
        this.allCtrlRequests = false;
        this.parseMessage(logMsg);

        return true; // part of this one
    }

    private parseMessage(msg: DltMsg) {

        // add apid/ctid to apidInfos:
        {
            const apid = msg.apid;
            if (apid.length > 0) {
                const ctid = msg.ctid;
                let knownApidInfo = this.apidInfos.get(apid);
                if (knownApidInfo === undefined) {
                    const ctids = new Map<string, string>();
                    if (ctid.length > 0) {
                        ctids.set(ctid, '');
                    }
                    knownApidInfo = { apid: apid, desc: '', ctids: ctids };
                    //console.log(`get_log_info added apid = ${knownApidInfo.apid} wo desc=${knownApidInfo.desc}`);
                    this.apidInfos.set(apid, knownApidInfo);
                }
                // add ctid
                if (ctid.length > 0) {
                    const ctidInfo = knownApidInfo.ctids.get(ctid);
                    if (ctidInfo === undefined || ctidInfo.length === 0) {
                        knownApidInfo.ctids.set(ctid, '');
                    }
                }
            }
        }

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
                                    const aiObj = { apid: apidInfo.apid, desc: apidInfo.desc, ctids: new Map<string, string>() };
                                    this.apidInfos.set(apidInfo.apid, aiObj);
                                    //console.log(`get_log_info added apid = ${apidInfo.apid}, ${JSON.stringify(aiObj)}`);
                                }
                                const knownApidInfo = this.apidInfos.get(apidInfo.apid);
                                if (knownApidInfo !== undefined) {
                                    if (knownApidInfo.desc.length === 0 && apidInfo.desc.length > 0) {
                                        console.log(`overwriting apidInfo ${apidInfo.apid} ${knownApidInfo.desc} with ${apidInfo.desc}`);
                                        knownApidInfo.desc = apidInfo.desc;
                                    }
                                    for (let c = 0; c < apidInfo.ctids.length; ++c) {
                                        const ctidObj = apidInfo.ctids[c];
                                        // check whether ctid is known:
                                        const ctid = knownApidInfo.ctids.get(ctidObj.ctid);
                                        if (ctid === undefined || ctid.length === 0) {
                                            knownApidInfo.ctids.set(ctidObj.ctid, ctidObj.desc);
                                            //console.log(`get_log_info added apid/ctid = ${apidInfo.apid}/${ctidObj.ctid}`);
                                        }
                                    }
                                }
                            }
                        } else { console.warn(`GET_LOG_INFO with msg.noar=${msg.noar} <= msg.payloadArgs.length=${msg.payloadArgs.length}`); }
                    }
            }
        }
    }

    static updateLifecycles(msgs: DltMsg[], lifecycles: Map<string, DltLifecycleInfo[]>, storeMsgs: boolean = true) {
        // iterate over all ecus (not in parallel, only for each ecu in parallel possible)
        for (let i = 0; i < msgs.length; ++i) {
            const msg = msgs[i];
            const ecu = msg.withEID ? msg.ecu : `<SH>_${msg.ecu}`; // indicate whether ECU is only from storageheader. Dont mix msgs with storage header and without into same lifecylce
            let lcInfos = lifecycles.get(ecu)!;
            if (lcInfos === undefined) {
                console.log(`updateLifecycles: added ${ecu} from ${msg.index}:${msg.timeAsDate}`);
                lcInfos = [new DltLifecycleInfo(msg, storeMsgs)];
                lifecycles.set(ecu, lcInfos);
            } else {
                const prevLC = lcInfos.length > 1 ? lcInfos[lcInfos.length - 2] : undefined;
                let lastLc = lcInfos[lcInfos.length - 1]; // there is at least one
                if (!lastLc.update(msg, storeMsgs, false)) {
                    console.log(`updateLifecycles: added  ${ecu} from ${msg.index}:${msg.timeAsDate}`);
                    lcInfos.push(new DltLifecycleInfo(msg, storeMsgs));
                } else {
                    if (prevLC !== undefined) {
                        // need to check whether the lifecycle now moved to earlier and overlaps
                        // with the prev. one:
                        if (prevLC.lifecycleEnd > lastLc.lifecycleStart) {
                            console.log(`overlap detected! Merging this lifecycle with the prev one`);
                            prevLC.merge(lastLc);
                            // now delete lastLc
                            lcInfos.pop();
                        }
                    }
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
