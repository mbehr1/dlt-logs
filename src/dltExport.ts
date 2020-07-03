/* --------------------
 * Copyright(C) Matthias Behr, 2020.
 */

import * as vscode from 'vscode';
import { MultiStepInput, PickItem } from './quickPick';
import { DltFilter, DltFilterType } from './dltFilter';
import { DltDocument } from './dltDocument';
import { DltLifecycleInfo } from './dltLifecycle';
import * as util from './util';
import * as fs from 'fs';
import { DltMsg, MSTP, MTIN_CTRL } from './dltParser';
import { basename } from 'path';
import { assert } from 'console';

/* features to support:
[x] merge multiple files into one
[x] multiple files (src) are sorted by the first msg times (w.o. considering lifecycles) if reorder msgs by timestamp is not used
[x] rewrite timestamps
[x] reorder msgs by calculated time/timestamp
[ ] select/filter on lifecycles (might be indirectly by time from...to)
[ ] include xx secs from prev lifecycle
[ ] choose from existing filters
[ ] exclude apids
[ ] select ECUids
[ ] exclude file transfers
[ ] export file transfers into sep. files...
[ ] adjust time per srcFile
[ ] allow to open src files directly as zip/gzip/... archives.
*/

interface ExportDltOptions {
    srcUris: vscode.Uri[];
    dstUri: vscode.Uri;
    reorderMsgsByTime: boolean;
    rewriteMsgTimes: boolean
}

const srcUriMap = new Map<string, number>();
const getReadFd = (fsPath: string): number => {
    let curEntry = srcUriMap.get(fsPath);
    if (curEntry === undefined) {
        curEntry = fs.openSync(fsPath, "r");
        srcUriMap.set(fsPath, curEntry);
    }
    return curEntry;
};
const closeAllReadFds = () => {
    srcUriMap.forEach(fd => fs.closeSync(fd));
    srcUriMap.clear();
};

const getFirstMsg = (fileUri: vscode.Uri) => {
    const fd = getReadFd(fileUri.fsPath);
    let data = Buffer.allocUnsafe(1 * 1024 * 1024); // we do only scan first MB
    let read = fs.readSync(fd, data, 0, data.byteLength, 0);
    const msgs: DltMsg[] = [];
    const parseInfo = DltDocument.dltP.parseDltFromBuffer(data.slice(0, read), 0, msgs, [], [], []);
    if (msgs.length) { return msgs[0]; } else { return undefined; };
};

export async function exportDlt(srcUris: vscode.Uri[], allFilters: DltFilter[] | undefined = undefined) {
    // todo have to avoid reentrant call (as srcUriMap is global/static...)
    console.log(`export dlt called...(#allFilters=${allFilters?.length})`);
    if (srcUris.length === 0) { return; }
    return new Promise((resolveAssistant, cancelAssistant) => {

        if (srcUris.length > 1) {
            // let's sort the srcUris by first msg time. eases lifecycle calculation (assumes ascending recording times)
            const minSrcMsgTimes = new Map<string, number>();
            for (let i = 0; i < srcUris.length; ++i) {
                const firstMsg = getFirstMsg(srcUris[i]);
                if (firstMsg !== undefined) {
                    minSrcMsgTimes.set(srcUris[i].toString(), firstMsg.timeAsNumber);
                } else {
                    console.log(`no msg from ${srcUris[i].toString()}`); // todo might consider to remove it...
                }
            }
            console.log(`sorting srcUris from: ${srcUris.map(u => u.toString()).join(',')}`);
            srcUris.sort((a, b) => {
                const timeA = minSrcMsgTimes.get(a.toString());
                const timeB = minSrcMsgTimes.get(b.toString());
                return ((timeA !== undefined) ? timeA : 0) - ((timeB !== undefined) ? timeB : 0);
            });
            console.log(`sorted srcUris to   : ${srcUris.map(u => u.toString()).join(',')}`);
        }

        const exportOptions: ExportDltOptions = {
            srcUris: srcUris,
            dstUri: srcUris[0].with({ path: `${srcUris[0].path}_exported.dlt` }),
            reorderMsgsByTime: true,
            rewriteMsgTimes: true,
        };
        const yesNoItems: PickItem[] = [new PickItem('yes'), new PickItem('no')];

        let stepInput = new MultiStepInput(`Export/filter dlt file assistant...`, [
            // { title: `select all APIDs that can be removed`, items: apids, onValues: (v) => { if (Array.isArray(v)) { removeApids = v.map(v => v.name); } else { removeApids = v.length ? [<string>v] : []; } }, onMoreItems: loadMoreApids }
            { title: `reorder msgs by calculated time?`, initialValue: () => exportOptions.reorderMsgsByTime ? 'yes' : 'no', items: yesNoItems, onValue: (v) => { exportOptions.reorderMsgsByTime = v === 'yes'; }, canSelectMany: false },
            { title: `rewrite msg times by calculated times?`, initialValue: () => exportOptions.rewriteMsgTimes ? 'yes' : 'no', items: yesNoItems, onValue: (v) => { exportOptions.rewriteMsgTimes = v === 'yes'; }, canSelectMany: false }
        ], { canSelectMany: true });
        stepInput.run().then(async () => {
            // insert them as loadTimeFilters (negBeforePos...?)
            /*
            if (removeApids?.length) {
                console.log(`adding neg. load filters for APIDs: ${removeApids.join(',')}`);
                for (let i = 0; i < removeApids.length; ++i) {
                    const newFilter = new DltFilter({ type: DltFilterType.NEGATIVE, atLoadTime: true, apid: removeApids[i], beforePositive: true }, false);
                    //allFilters.push(newFilter);
                }
            }*/

            // saveAs ... todo
            let doRetry;
            do {
                doRetry = false;
                await vscode.window.showSaveDialog({ defaultUri: exportOptions.dstUri, saveLabel: 'save filtered dlt as ...' }).then(async saveUri => {
                    if (saveUri) {
                        console.log(`save as uri=${saveUri?.toString()}`);
                        if (exportOptions.srcUris.map(u => u.toString()).includes(saveUri.toString())) {
                            await vscode.window.showErrorMessage('Exporting/filtering into same file not possible. Please choose a different one.', { modal: true });
                            doRetry = true;
                        } else {
                            exportOptions.dstUri = saveUri;
                            doExport(exportOptions).then(() => {
                                resolveAssistant(exportOptions);
                            }).catch(err => {
                                console.log(`dlt-log.exportDlt doExport err=${err}`);
                                closeAllReadFds();
                                cancelAssistant();
                            });
                        }
                    }
                });
            } while (doRetry);

        }).catch(err => {
            console.log(`dlt-log.exportDlt cancelled...`);
            closeAllReadFds();
            cancelAssistant();
        });
    });
}

async function doExport(exportOptions: ExportDltOptions) {
    console.log(`doExport(${JSON.stringify(exportOptions)})...`);

    // we do the export in a two pass approach:
    // 1st pass:
    //  read all src files
    //   apply to be used filters (todo)
    //   maintain a list of calculated time, srcUri, msgIdx (or directly msgOffset/len)
    //   maintain lifecycles
    // if wanted: sort list by time

    // 2nd pass: export msgs
    //  ordered by list
    //  if wanted with rewritten times
    //  apply lifecycle filters (or from...to times)

    interface MinMsgInfo {
        uri: vscode.Uri;
        readonly msgOffset: number; // offset in src file
        readonly msgLen: number; // len of message in src file
        readonly timeAsNumber: number; // time in ms.
        readonly timeStamp: number;
        lifecycle: DltLifecycleInfo | undefined;
    }

    const pass1ReadUri = async (
        fileUri: vscode.Uri,
        allFilters: readonly DltFilter[],
        lifecycles: Map<string, DltLifecycleInfo[]>,
        minMsgInfos: MinMsgInfo[],
        progress: vscode.Progress<{
            message?: string | undefined;
            increment?: number | undefined;
        }>,
        expectedIncrement: number,
        cancel: vscode.CancellationToken) => {
        if (cancel.isCancellationRequested) { return; }
        const fd = getReadFd(fileUri.fsPath);
        const stats = fs.statSync(fileUri.fsPath);
        let read: number = 0;
        let chunkSize = 10 * 1024 * 1024;
        let parsedFileLen = 0;
        let data = Buffer.allocUnsafe(chunkSize);
        let startTime = process.hrtime();
        let lastUpdateTime = startTime;
        let msgs: DltMsg[] = [];
        // determine current filters:
        const [posFilters, negFilters, decFilters, eventFilters, negBeforePosFilters] = DltDocument.getFilter(allFilters, true, true);
        progress.report({ message: `pass 1: processing file '${basename(fileUri.fsPath)}'` });
        let index = 0;
        let lastIncrement = 0;
        do {
            read = fs.readSync(fd, data, 0, chunkSize, parsedFileLen);
            if (read) {
                //const copiedBuf = Buffer.from(data.slice(0, read)); // have to create a copy of Buffer here! not necessary to access apid
                // parse data:
                const msgOffsets: number[] = [];
                const msgLengths: number[] = [];
                const parseInfo = DltDocument.dltP.parseDltFromBuffer(data.slice(0, read), 0, msgs, posFilters, negFilters, negBeforePosFilters, msgOffsets, msgLengths);
                if (parseInfo[0] > 0) {
                }
                if (parseInfo[1] > 0) {
                    //console.log(`checkFileChanges read=${read} remaining=${parseInfo[1]} bytes. Parse ${parseInfo[2]} msgs.`);
                }
                if (msgs.length > 0) {
                    DltLifecycleInfo.updateLifecycles(msgs, lifecycles, false);

                    for (let m = 0; m < msgs.length; ++m) {
                        const msg = msgs[m];
                        // we treat CTRL_REQUEST separately: we dont store a lifecycle. so later one the reception time is used an not the calc. time
                        minMsgInfos.push({ uri: fileUri, msgOffset: parsedFileLen + msgOffsets[m], msgLen: msgLengths[m], timeStamp: msg.timeStamp, lifecycle: (msg.mstp === MSTP.TYPE_CONTROL && msg.mtin === MTIN_CTRL.CONTROL_REQUEST) ? undefined : msg.lifecycle, timeAsNumber: msg.timeAsNumber });
                        index++;
                    }
                    msgs = []; // keep mem load low. we copied relevant info to minMsgInfos
                }

                if (read !== parseInfo[1]) {
                    parsedFileLen += read - parseInfo[1];
                    let curTime = process.hrtime(startTime);
                    if (curTime[1] / 1000000 > 100) { // 100ms passed
                        await util.sleep(10); // 10ms each 100ms
                        startTime = process.hrtime();
                    }
                } else {
                    console.log(`checkFileChanges read=${read} remaining=${parseInfo[1]} bytes. Parsed ${parseInfo[2]} msgs. Stop parsing to avoid endless loop.`);
                    read = 0;
                }
                // update every 100ms:
                let curTime = process.hrtime(lastUpdateTime);
                if (curTime[1] / 1000000 > 100) { // 100ms passed
                    lastUpdateTime = process.hrtime();
                    const increment = Math.round(expectedIncrement * (parsedFileLen / stats.size));
                    progress.report({ increment: increment - lastIncrement, message: `pass 1: processing file '${basename(fileUri.fsPath)}' got ${lifecycles.size} ECU and ${Number(minMsgInfos.length / 1000).toFixed(0)}k msgs` });
                    lastIncrement = increment;
                }

            }
        } while (read > 0 && !cancel.isCancellationRequested);
        console.log(`pass1ReadUri(uri=${fileUri.toString()}) finished.`);
    };

    const tempBuffer = Buffer.allocUnsafe(0xffff + 0x1000); // Dlt max message is limited by uint16
    const pass2GetData = (msgInfo: MinMsgInfo): Buffer => {
        const readFd = getReadFd(msgInfo.uri.fsPath);
        const read = fs.readSync(readFd, tempBuffer, 0, msgInfo.msgLen, msgInfo.msgOffset);
        if (read !== msgInfo.msgLen) {
            throw Error(`read from ${msgInfo.uri.fsPath} returned ${read} vs. expected ${msgInfo.msgLen}`);
        }
        return tempBuffer.slice(0, read);
    };

    await vscode.window.withProgress({ cancellable: true, location: vscode.ProgressLocation.Notification, title: `Export/filter dlt file...` },
        async (progress, cancelToken) => {
            // pass 1:
            const lifecycles = new Map<string, DltLifecycleInfo[]>();
            const minMsgInfos: MinMsgInfo[] = [];

            // srcUris are already sorted by first msg time

            for (let i = 0; i < exportOptions.srcUris.length; ++i) {
                await pass1ReadUri(exportOptions.srcUris[i], [], lifecycles, minMsgInfos, progress, 50 / exportOptions.srcUris.length, cancelToken); // todo filter
            }
            console.log(`after pass1: got ${minMsgInfos.length} msgs and ${lifecycles.size} ECUs:`);
            lifecycles.forEach((lcInfos, ecu) => {
                console.log(` ${ecu} has ${lcInfos.length} lifecycles:`);
                lcInfos.forEach(lcInfo => {
                    console.log(`  ${lcInfo.lifecycleStart.toUTCString()}-${lcInfo.lifecycleEnd.toUTCString()} with ${lcInfo.logMessages.length} msgs, ${lcInfo.apidInfos.size} APID infos`);
                });
            });
            // sort list by time?
            if (exportOptions.reorderMsgsByTime && !cancelToken.isCancellationRequested) {
                progress.report({ message: `sorting ${minMsgInfos.length} messages` });
                await util.sleep(50);
                minMsgInfos.sort((a, b) => {
                    const timeA = (a.lifecycle === undefined ? a.timeAsNumber : (a.lifecycle.lifecycleStart.valueOf() + (a.timeStamp / 10)));
                    const timeB = (b.lifecycle === undefined ? b.timeAsNumber : (b.lifecycle.lifecycleStart.valueOf() + (b.timeStamp / 10)));
                    return timeA - timeB;
                });
                console.log(`sorted msgs`);
                progress.report({ message: `sorted ${minMsgInfos.length} messages` });
                await util.sleep(10); // 10ms each 100ms    
            }

            // pass 2:
            if (!cancelToken.isCancellationRequested) {
                let pass2StartTime = process.hrtime();
                try {
                    console.log(`pass2: creating ${exportOptions.dstUri.fsPath}`);
                    const saveFileFd = fs.openSync(exportOptions.dstUri.fsPath, "w");
                    //console.log(`created ${exportOptions.dstUri.fsPath}`);
                    try {
                        let lastIncrement = 50;
                        for (let m = 0; m < minMsgInfos.length; ++m) {
                            const minMsgInfo = minMsgInfos[m];
                            const data = pass2GetData(minMsgInfo);
                            if (exportOptions.rewriteMsgTimes) {
                                // replace storage header secs/micros with the lifecycleStart + timeStamp calculated time:
                                // we can only do so if we do know the lifecycle
                                if (minMsgInfo.lifecycle) {
                                    const ms: number = Math.floor(minMsgInfo.lifecycle.lifecycleStart.valueOf() + (minMsgInfo.timeStamp / 10));
                                    const secs: number = Math.floor(ms / 1000);
                                    const micros: number = Math.round(((ms % 1000) * 1000) + ((minMsgInfo.timeStamp % 10) * 100));

                                    const msCalc = (secs * 1000) + (micros / 1000);
                                    // we should be off by +[0,1)ms
                                    assert(msCalc < (ms + 1) && msCalc >= ms, `new time calc wrong: ${msCalc}!==${ms} by ${msCalc - ms}`);
                                    data.writeUInt32LE(secs, 4);
                                    data.writeInt32LE(micros, 8);
                                }
                            }
                            const written = fs.writeSync(saveFileFd, data);
                            if (written !== data.byteLength) {
                                throw Error(`couldn't write ${data.byteLength} bytes. Wrote ${written}.`);
                            }
                            let curTime = process.hrtime(pass2StartTime);
                            if (curTime[1] / 1000000 > 100) { // 100ms passed
                                pass2StartTime = process.hrtime();
                                const increment = 50 + Math.round(50 * (m / minMsgInfos.length));
                                progress.report({ increment: increment - lastIncrement, message: `pass 2: processed ${Number(100 * m / minMsgInfos.length).toFixed(0)}%: ${Number(m / 1000).toFixed(0)}/${Number(minMsgInfos.length / 1000).toFixed(0)}k msgs` });
                                lastIncrement = increment;
                                await util.sleep(10); // 10ms each 100ms
                                if (cancelToken.isCancellationRequested) { break; }
                            }
                        }
                    } catch (err) {
                        console.log(`pass 2: got error: '${err}'`);
                        progress.report({ message: `pass 2: got error: '${err}'` });
                    }
                    fs.closeSync(saveFileFd);
                } catch (err) {
                    console.log(`pass 2: create file got error: '${err}'`);
                    progress.report({ message: `pass 2: create file got error: '${err}'` });
                }
                console.log(`pass2: finished writing to ${exportOptions.dstUri.fsPath}`);
            }
            closeAllReadFds();
        }
    );
}