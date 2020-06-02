/* --------------------
 * Copyright(C) Matthias Behr.
 */

import * as vscode from 'vscode';
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { TreeViewNode, createUniqueId } from './dltDocumentProvider';
import { DltFilter, DltFilterType } from './dltFilter';
import { DltMsg, MSTP, MTIN_LOG, MTIN_CTRL } from './dltParser';
import { SSL_OP_DONT_INSERT_EMPTY_FRAGMENTS } from 'constants';

/*
https://github.com/GENIVI/dlt-daemon/blob/b5902c506e958933bbabe6bdab8d676e0aa0bbc5/src/lib/dlt_filetransfer.c
 for filetransfer:
 323716 ECU1 SYS  FILE FLST 4174298663 context.1584997735.processname.812.txt 61452 Mon Mar 23 21:08:55 2020  61 1024 FLST 
 323717 ECU1 SYS  FILE FLDA 4174298663 1 50726f634e616d653a617662636f6e74726f6c6c65720a5468726561644e616d653a617662636f6e74726f6c6c65720a5049443a3831320a5369676e616c3a360a0a3d3d3d3d2044756d70696e672066696c65203c2f6574632f6f732d72656c656173653e203d3d3d3d0a4e414d453d22424d57204d47553232220a56455253494f4e3d2232307731322e352d312d34220a49443d226d67753232220a56415249414e543d226d677532322d32307731322e352d312d34220a56415249414e545f49443d22424d57204d475532322d6d677532322d32307731322e352d312d34220a0a3d3d3d3d2044756d70696e672066696c65203c2f70726f632f3831322f636d646c696e653e203d3d3d3d0a2f7573722f62696e2f617662636f6e74726f6c6c65720a2d6f0a747849664e616d653d736f636e6574300a2d6f0a727849664e616d653d736f636e6574300a2d740a320a2d760a320a3d3d3d3d2044756d70696e672066696c65203c2f70726f632f3831322f6367726f75703e203d3d3d3d0a373a626c6b696f3a2f7374616e646172642e736c6963650a363a646576696365733a2f7374616e646172642e736c6963652f617662636f6e74726f6c6c65722e736572766963650a353a6370757365743a2f0a343a667265657a65723a2f0a333a6d656d6f72793a2f7374616e646172642e736c6963652f617662636f6e74726f6c6c65722e736572766963650a323a6370752c637075616363743a2f7374616e646172642e736c6963650a313a6e616d653d73797374656d643a2f7374616e646172642e736c6963652f617662636f6e74726f6c6c65722e736572766963650a303a3a2f7374616e646172642e736c6963652f617662636f6e74726f6c6c65722e736572766963650a0a3d3d3d3d2044756d70696e672066696c65203c2f70726f632f3831322f737461636b3e203d3d3d3d0a5b3c666666666666386132393638356436633e5d205f5f7377697463685f746f2b307863342f307864300a5b3c666666666666386132393836336363633e5d20706970655f776169742b307836632f307862300a5b3c666666666666386132393836346135343e5d20706970655f77726974652b30783235302f30783361380a5b3c666666666666386132393835386133633e5d205f5f7666735f77726974652b30783131632f30783134630a5b3c666666666666386132393835386165383e5d205f5f6b65726e656c5f77726974652b307837632f30783133630a5b3c666666666666386132393863353766303e5d2064756d705f656d69742b307837632f307864380a5b3c666666666666386132393863353863633e5d2064756d705f736b69702b307838302f307863380a5b3c666666666666386132393862666263633e5d20656c665f636f7265FLDA 
 ...
 325448 ECU1 SYS  FILE FLDA 4174298663 61 32444541364342443345430aFLDA 
 325449 ECU1 SYS  FILE FLFI 4174298663 FLFI 

 FLIF... 
 FLER...

 DLT_LOG(*fileContext, DLT_LOG_INFO,
                DLT_STRING("FLST"),
                DLT_UINT(fserialnumber),
                DLT_STRING(alias), // or filename
                DLT_UINT(fsize),
                DLT_STRING(fcreationdate);
                DLT_UINT(dlt_user_log_file_packagesCount(fileContext, filename)),
                DLT_UINT(BUFFER_SIZE),
                DLT_STRING("FLST")
                );

DLT_LOG(*fileContext, DLT_LOG_INFO,
                    DLT_STRING("FLDA"),
                    DLT_UINT(fserial),
                    DLT_UINT(packageToTransfer),
                    DLT_RAW(buffer, readBytes),
                    DLT_STRING("FLDA")
                    );
DLT_LOG(*fileContext, DLT_LOG_INFO,
                DLT_STRING("FLFI"),
                DLT_UINT(fserial),
                DLT_STRING("FLFI")
                );

    APID SYS <- might be different
    CTID FILE <- might be different 
*/

export class DltFileTransfer implements TreeViewNode {
    id: string;
    label: string;
    tooltip: string | undefined;
    //uri: vscode.Uri | null; // index provided as fragment #<index>
    //parent: TreeViewNode | null;
    children: TreeViewNode[];
    contextValue: string;
    private _expectPackageNr: number = 1; // 1 based
    private _lastPackageNr: number = 0;
    isComplete: boolean = false;
    missingData: number = 0; // nr of the missing packet
    private _buffers: Buffer[] = []; // todo or use npm.tmp and store directly into temp to reduce mem footprint!

    constructor(public uri: vscode.Uri, public parent: TreeViewNode | null, public allowSave: boolean,
        public serial: number, public fileName: string, public fileSize: number | undefined, public fileCreationDate: string | undefined, public nrPackages: number | undefined, public bufferSize: number | undefined,
        public startMsg: DltMsg) {
        this.children = [];
        this.id = createUniqueId();
        if (this.fileSize) {
            this.label = `Incomplete (0/${this.nrPackages}) file transfer '${this.fileName}' ${Math.ceil(this.fileSize / 1024)}kb`;
        } else {
            this.label = `Partial file transfer '${this.fileName}' unknown size`;
        }
        this.uri = this.uri.with({ fragment: startMsg.index.toString() }); // selecting should select the first message.
        this.contextValue = 'fileTransferIncomplete';
        parent?.children.push(this);

        // todo verify fileSize ~nrPackages*bufferSize
    }
    addFLDA(packageToTransfer: number, buf: Buffer) {
        if (packageToTransfer === this._expectPackageNr) {
            if (this.allowSave) {
                this._buffers.push(buf);
            }
            this._lastPackageNr = packageToTransfer;
            if (packageToTransfer === this.nrPackages) {
                console.log(` addFLDA completed ${this.fileName}!`);
                this.checkFinished(false);
            } else {
                this._expectPackageNr++;
            }
        } else {
            console.log(` addFLDA expected ${this._expectPackageNr} but got ${packageToTransfer}`);
            this.missingData = this._expectPackageNr;
            this.checkFinished(false);
        }
    }

    checkFinished(onFLFI: boolean): void {
        let incomplete = false;
        let lastPackage = false;
        // any missing package?
        if (this.missingData) {
            incomplete = true;
            this._buffers = [];
        } else {
            // got last package
            if (this.nrPackages) {
                if (this.nrPackages === this._lastPackageNr) {
                    lastPackage = true;
                } else {
                    incomplete = true;
                }
            } else {
                // at least one package?
                if (this._lastPackageNr === 0) {
                    incomplete = true;
                }
            }
            if (this.fileSize) {
                // verify file size todo
            }
        }
        if (incomplete) {
            this.isComplete = false;
            this.label = `Incomplete file transfer '${this.fileName}', missing ${this.missingData}/${this.nrPackages})`;
        } else {
            this.isComplete = true;
            if (this.fileSize) {
                this.label = `Complete file transfer '${this.fileName}' ${Math.ceil(this.fileSize / 1024)}kb`;
            } else {
                this.label = `Recovered file transfer '${this.fileName}'`; // todo add size from buffers
            }
            this.contextValue = this.allowSave ? 'fileTransferComplete' : 'fileTransferCompleteNoBuffers';
        }
    }

    saveAs(uri: vscode.Uri) {
        console.log(`DltFileTransfer.saveAs(${uri.toString()}) for ${this.fileName}...`); // todo
        if (this.isComplete && this.allowSave && this._buffers.length) {
            const fd = fs.openSync(uri.fsPath, 'w');
            if (!fd) {
                console.log(`DltFileTransfer.saveAs() open failed with`);
                throw Error(`saveAs openSync(${uri.toString()}) failed!`);
            }
            for (let i = 0; i < this._buffers.length; ++i) {
                const buf = this._buffers[i];
                const written = fs.writeSync(fd, new Uint8Array(buf.buffer, buf.byteOffset, buf.length));
                if (written !== buf.length) {
                    fs.closeSync(fd);
                    throw Error(`saveAs writeSync has written ${written} instead of ${buf.length}`);
                }
            }
            fs.closeSync(fd);
            console.log(`DltFileTransfer.saveAs() done.`);
        } else {
            console.log(`DltFileTransfer.saveAs() got no data for ${this.fileName}!`);
        }
    }
};

export class DltFileTransferPlugin extends DltFilter {
    private _uri: vscode.Uri;
    private _transfers: Map<number, DltFileTransfer> = new Map<number, DltFileTransfer>();
    private _keepFLDA: boolean = false; // keep FLDA,..
    private _treeEventEmitter: vscode.EventEmitter<TreeViewNode | null>;
    public allowSave: boolean = true;

    constructor(uri: vscode.Uri, public treeViewNode: TreeViewNode, treeEventEmitter: vscode.EventEmitter<TreeViewNode | null>, options: any) {
        super({ type: DltFilterType.NEGATIVE }, false); // don't allow Edit from treeViewExplorer for these
        if ('enabled' in options) {
            this.enabled = options.enabled;
        } else {
            this.enabled = true;
        }
        if ('allowSave' in options) {
            this.allowSave = options.allowSave;
        }
        if ('keepFLDA' in options) {
            this._keepFLDA = options.keepFLDA;
        }
        if ('apid' in options) {
            if (options.apid.length) {
                this.apid = options.apid;
            }
        }
        if ('ctid' in options) {
            if (options.ctid.length) {
                this.ctid = options.ctid;
            }
        }

        this.atLoadTime = true; // for now only supported at load time (afterwards filters might already apply...)
        this.beforePositive = true;
        this._uri = uri;
        this._treeEventEmitter = treeEventEmitter;
    }

    matches(msg: DltMsg): boolean {
        if (!this.enabled) {
            return false;
        }

        if (this.apid && msg.apid !== this.apid) {
            return false;
        }
        if (this.ctid && msg.ctid !== this.ctid) {
            return false;
        }

        // we process here the info and return true if we want to remove the msg
        if (msg.mstp === MSTP.TYPE_LOG && msg.mtin === MTIN_LOG.LOG_INFO) {
            if (msg.noar === 8) { // FLST?
                if (DltFileTransferPlugin.isType(msg, "FLST")) {
                    const serial: number = msg.payloadArgs[1].v;
                    const fileName: string = msg.payloadArgs[2].v;
                    const fileSize: number = msg.payloadArgs[3].v;
                    const fileCreationDate: string = msg.payloadArgs[4].v;
                    const nrPackages: number = msg.payloadArgs[5].v;
                    const bufferSize: number = msg.payloadArgs[6].v;

                    console.log(`DltFileTransferPlugin got FLST: serial = ${serial} name = '${fileName}'`);
                    let actTransfer = this._transfers.get(serial);
                    if (actTransfer) {
                        console.log(`DltFileTransferPlugin got FLST for already known one serial = ${serial}.Aborting current!`);
                    } // todo make FileTransfer disposable so that we can remove the node!
                    // todo add fragment to line?
                    actTransfer = new DltFileTransfer(this._uri, this.treeViewNode, this.allowSave, serial, fileName, fileSize, fileCreationDate, nrPackages, bufferSize, msg);
                    this._transfers.set(serial, actTransfer);
                    this._treeEventEmitter.fire(this.treeViewNode);
                }
            } else if (msg.noar === 5) { // FLDA?
                if (DltFileTransferPlugin.isType(msg, "FLDA")) {
                    const serial: number = msg.payloadArgs[1].v;
                    const packageToTransfer: number = msg.payloadArgs[2].v;
                    //console.log(`DltFileTransferPlugin got FLDA ${packageToTransfer} for serial = ${serial}`);
                    let actTransfer = this._transfers.get(serial);
                    if (actTransfer) {
                        actTransfer.addFLDA(packageToTransfer, msg.payloadArgs[3].v);
                    } else {
                        // incomplete // we might handle/recover it if this is the first package!
                        actTransfer = new DltFileTransfer(this._uri, this.treeViewNode, this.allowSave, serial, "<unknown>", undefined, undefined, undefined, undefined, msg);
                        this._transfers.set(serial, actTransfer);
                        this._treeEventEmitter.fire(this.treeViewNode);
                        // we might handle it if this is the first package!
                        if (!packageToTransfer) {
                            actTransfer.addFLDA(packageToTransfer, msg.payloadArgs[3].v);
                        }
                    }
                    if (actTransfer && actTransfer.isComplete) {
                        this._treeEventEmitter.fire(this.treeViewNode);
                    }
                    if (!this._keepFLDA) {
                        return true;
                    }
                }
            } else if (msg.noar === 3) { // FLFI
                if (DltFileTransferPlugin.isType(msg, "FLFI")) {
                    try {
                        const serial: number = msg.payloadArgs[1].v;
                        console.log(`DltFileTransferPlugin got FLFI for serial = ${serial}`);
                        const actTransfer = this._transfers.get(serial);
                        if (actTransfer) {
                            actTransfer.checkFinished(true);
                            this._treeEventEmitter.fire(actTransfer);
                        }
                    } catch (error) {
                        console.log(`DltFileTransferPlugin.isType(FLFI) but error: ${error} `);
                    }
                }
            }
        }
        return false; // by default keep all msgs.
    }

    get name(): string {
        const enabled: string = this.enabled ? "" : "disabled: ";
        let type: string = !this._keepFLDA ? "- FLDA " : " ";
        if (this.atLoadTime) {
            type = "(load time) " + type;
        }
        let nameStr: string = "plugin FileTransfer";
        if (this.apid) { nameStr += ` APID:${this.apid} `; };
        if (this.ctid) { nameStr += ` CTID:${this.ctid}`; };
        return `${enabled} ${type} ${nameStr} `;
    }

    static isType(msg: DltMsg, typeStr: string): boolean {
        // the msg for a type starts and ends with that string
        try {
            const payloadArgs = msg.payloadArgs;
            const str0: string = payloadArgs[0].v;
            const str1: string = payloadArgs[msg.noar - 1].v;
            if (str0 === typeStr && str1 === typeStr) {
                return true;
            }
        } catch (error) {
            // normal if payload is of different type console.log(`DltFileTransferPlugin.isType error: ${ error } `);
        }
        return false;
    }
}
