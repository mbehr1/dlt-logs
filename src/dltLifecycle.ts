/* --------------------
 * Copyright(C) Matthias Behr.
 */

// import * as vscode from 'vscode';
import * as assert from 'assert';
import { DltParser, DltMsg, MSTP, MTIN_CTRL } from './dltParser';

export class DltLifecycleInfo {
    private _startTime: Date; // within log
    readonly startIndex: number;
    lifecycleStart: Date; // including timestamp calc. e.g. _startTime - timestamp
    private _maxTimeStamp: number; // so _lifecycleStart + maxTimestamp defines the "end"
    readonly logMessages: DltMsg[]; // todo should be sorted... by timestamp? (without ctrl requests timestamps)
    allCtrlRequests: boolean = true; // this lifecycle consists of only ctrl requests.

    constructor(logMsg: DltMsg) {
        // if its a control message from logger we ignore the timestamp:
        let timeStamp = logMsg.timeStamp;
        if (logMsg.mstp === MSTP.TYPE_CONTROL && logMsg.mtin === MTIN_CTRL.CONTROL_REQUEST) {
            timeStamp = 0;
        } else {
            this.allCtrlRequests = false;
        }
        this._startTime = logMsg.time;
        this.startIndex = logMsg.index;
        this.lifecycleStart = new Date(this._startTime.valueOf() - (timeStamp / 10));
        this._maxTimeStamp = timeStamp;
        this.logMessages = [logMsg];
        logMsg.lifecycle = this;
        // will be set later by _updateLines based on current filter
        console.log(`DltLifecycleInfo() startTime=${this._startTime} lifecycleStart=${this.lifecycleStart}`);
    }

    get lifecycleEnd(): Date {
        return new Date(this.lifecycleStart.valueOf() + (this._maxTimeStamp / 10));
    }

    get endIndex(): number {
        if (this.logMessages.length) {
            return this.logMessages[this.logMessages.length - 1].index; // todo take care if sort by time... use maxIndex then?
        } else {
            return this.startIndex;
        }
    }

    public update(logMsg: DltMsg): boolean {
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
        let newLifecycleStart = new Date(logMsg.time.valueOf() - (logMsg.timeStamp / 10));
        // if newLifecycleStart is later than current end _lifecycleStart+_maxTimestamp
        if ((newLifecycleStart.valueOf() - (this.lifecycleStart.valueOf() + (this._maxTimeStamp / 10))) > 1000) {
            // todo 1s, after a longer lifecycle we can reduce this to e.g. 50ms... but for short (~4s) lifecycles not (10773, 11244)
            // we could as well afterwards in a 2nd step merge the lifecycles again (visible with roughly same lifecycleStart...)
            console.log(`DltLifecycleInfo:update (logMsg(index=${logMsg.index} at ${logMsg.time}:${logMsg.timeStamp}) not part of this lifecycle(startIndex=${this.startIndex} end=${this.lifecycleEnd} ) `);
            return false; // treat as new lifecycle
        }
        if (logMsg.time.valueOf() < this._startTime.valueOf()) {
            console.log("DltLifecycleInfo:update new starttime earlier? ", this._startTime, logMsg.time);
        }
        if (newLifecycleStart.valueOf() < this.lifecycleStart.valueOf()) {
            // update new lifecycle start:
            if (this.lifecycleStart.valueOf() - newLifecycleStart.valueOf() > 1000) { // only inform about jumps >1s
                console.log(`DltLifecycleInfo:update new lifecycleStart from ${this.lifecycleStart} to ${newLifecycleStart} due to ${logMsg.index}`);
            }
            this.lifecycleStart = newLifecycleStart;
        }
        if (logMsg.timeStamp > this._maxTimeStamp) {
            this._maxTimeStamp = logMsg.timeStamp;
        }
        // todo we might have to update startIndex based on current index. currently we assume they are strong monotonically increasing

        this.logMessages.push(logMsg);
        logMsg.lifecycle = this;
        this.allCtrlRequests = false;

        return true; // part of this one
    }

    static updateLifecycles(msgs: DltMsg[], lifecycles: Map<string, DltLifecycleInfo[]>) {
        // iterate over all ecus (not in parallel, only for each ecu in parallel possible)
        for (let i = 0; i < msgs.length; ++i) {
            const msg = msgs[i];
            const ecu = msg.ecu;
            if (!lifecycles.has(ecu)) {
                console.log(`updateLifecycles: added ${ecu} from ${msg.index}:${msg.time}`);
                lifecycles.set(ecu, [new DltLifecycleInfo(msg)]);
            } else {
                let lcInfos = lifecycles.get(ecu)!;
                let lastLc = lcInfos[lcInfos?.length - 1]; // there is at least one
                if (!lastLc.update(msg)) {
                    console.log(`updateLifecycles: added  ${ecu} from ${msg.index}:${msg.time}`);
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
