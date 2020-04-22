/* --------------------
 * Copyright(C) Matthias Behr.
 */

import * as vscode from 'vscode';
import * as assert from 'assert';
import { DltLifecycleInfo } from './dltLifecycle';
import { DltFilter } from './dltFilter';

const fs = require('fs');
var Parser = require("binary-parser").Parser;

const DLT_STORAGE_HEADER_PATTERN: number = 0x01544c44; // DLT\01 0x444c5401
const DLT_STORAGE_HEADER_SIZE: number = 4 * 4;
const MIN_STD_HEADER_SIZE: number = 1 + 1 + 2;
const MIN_DLT_MSG_SIZE: number = DLT_STORAGE_HEADER_SIZE + MIN_STD_HEADER_SIZE;
const DLT_EXT_HEADER_SIZE: number = 10;
const MIN_PAYLOAD_ARG_LEN: number = 4;


export enum MSTP { TYPE_LOG, TYPE_APP_TRACE, TYPE_NW_TRACE, TYPE_CONTROL };
export enum MTIN_LOG { LOG_FATAL = 1, LOG_ERROR, LOG_WARN, LOG_INFO, LOG_DEBUG, LOG_VERBOSE }; // 7-15 reserved
export enum MTIN_TRACE { TRACE_VARIABLE = 1, TRACE_FUNCTION_IN, TRACE_FUNCTION_OUT, TRACE_STATE, TRACE_VFB };
export enum MTIN_NW { TRACE_IPC = 1, TRACE_CAN, TRACE_FLEXRAY, TRACE_MOST, TRACE_ETHERNET, TRACE_SOMEIP };
export enum MTIN_CTRL { CONTROL_REQUEST = 1, CONTROL_RESPONSE, CONTROL_TIME /* keep alive */ };

// from dlt_viewer/dlt_common.c MPL2 license:
export const MSTP_strs: string[] = ["log", "app_trace", "nw_trace", "control", "", "", "", ""];
export const MTIN_LOG_strs: string[] = ["", "fatal", "error", "warn", "info", "debug", "verbose", "", "", "", "", "", "", "", "", ""];
export const MTIN_TRACE_strs: string[] = ["", "variable", "func_in", "func_out", "state", "vfb", "", "", "", "", "", "", "", "", "", ""];
export const MTIN_NW_strs: string[] = ["", "ipc", "can", "flexray", "most", "vfb", "", "", "", "", "", "", "", "", "", ""];
export const MTIN_CTRL_strs: string[] = ["", "request", "response", "time", "", "", "", "", "", "", "", "", "", "", "", ""];
export const MTIN_CTRL_RESPONSE_strs: string[] = ["ok", "not_supported", "error", "", "", "", "", "", "no_matching_context_id"];

export const serviceIds: string[] = ["", "set_log_level", "set_trace_status", "get_log_info", "get_default_log_level", "store_config", "reset_to_factory_default",
    "set_com_interface_status", "set_com_interface_max_bandwidth", "set_verbose_mode", "set_message_filtering", "set_timing_packets",
    "get_local_time", "use_ecu_id", "use_session_id", "use_timestamp", "use_extended_header", "set_default_log_level", "set_default_trace_status",
    "get_software_version", "message_buffer_overflow"];

// not covered:
/*
#define DLT_SERVICE_ID_UNREGISTER_CONTEXT             0xf01 < Service ID: Message unregister context
#define DLT_SERVICE_ID_CONNECTION_INFO                0xf02 < Service ID: Message connection info 
#define DLT_SERVICE_ID_TIMEZONE						  0xf03 < Service ID: Timezone
#define DLT_SERVICE_ID_MARKER						  0xf04 < Service ID: Timezone
#define DLT_SERVICE_ID_CALLSW_CINJECTION              0xFFF < Service ID: Message Injection (minimal ID)
*/

export class DltMsg {
    readonly index: number; // index/nr of this msg inside orig file/stream/buffer
    readonly time: Date; // storage/reception time
    private _data: Buffer; // raw data incl. storageheader
    // parsed from data:
    readonly mcnt: number;
    private _htyp: number;
    readonly ecu: string;
    readonly sessionId: number = 0;
    readonly timeStamp: number = 0;
    readonly verbose: boolean = false;
    readonly mstp: MSTP = 0; // message type from MSIN (message info)
    readonly mtin: number = 0; // message type info from MSIN
    readonly noar: number = 0; // number of arguments
    readonly apid: string = "";
    readonly ctid: string = "";
    private _payloadData: Buffer;
    private _payloadArgs: Array<any> | undefined = undefined;
    private _payloadText: string | undefined = undefined;
    lifecycle: DltLifecycleInfo | undefined = undefined;
    decorations: Array<[vscode.TextEditorDecorationType, Array<vscode.DecorationOptions>]> = [];

    constructor(storageHeaderEcu: string, index: number, time: Date, data: Buffer) {
        this.index = index;
        this.time = time;
        this._data = data;

        // the following code could be moved into a function to allow parallel/delayed processing
        const stdHdr = DltParser.stdHeaderParser.parse(data.slice(DLT_STORAGE_HEADER_SIZE, DLT_STORAGE_HEADER_SIZE + MIN_STD_HEADER_SIZE));
        this.mcnt = stdHdr["mcnt"];
        this._htyp = stdHdr["htyp"];
        // htyp:
        // 0x01 _UEH use extended header
        // 0x02 _MSBF // todo MSBF sounds like little Endian (most sign. byte first... but seems not)
        // 0x04 _WEID with ECU ID (first 4 byte after standard header)
        // 0x08 _WSID with session ID (next 4 byte after standard header)
        // 0x10 _WTMS with timestamp // in 0.1mi (next 4 byte after standard header)
        const useExtHeader: boolean = (this._htyp & 0x01) ? true : false;
        const isBigEndian: boolean = (this._htyp & 0x02) ? true : false;
        const withEID: boolean = (this._htyp & 0x04) ? true : false;
        const withSID: boolean = (this._htyp & 0x08) ? true : false;
        const withTMS: boolean = (this._htyp & 0x10) ? true : false;

        let stdHeaderSize = MIN_STD_HEADER_SIZE;

        if (withEID) {
            this.ecu = data.slice(DLT_STORAGE_HEADER_SIZE + stdHeaderSize, DLT_STORAGE_HEADER_SIZE + stdHeaderSize + 4).toString();
            stdHeaderSize += 4;
        } else {
            this.ecu = storageHeaderEcu;
        }
        if (withSID) {
            this.sessionId = data.readUInt32BE(DLT_STORAGE_HEADER_SIZE + stdHeaderSize);
            stdHeaderSize += 4;
        }
        if (withTMS) {
            this.timeStamp = data.readUInt32BE(DLT_STORAGE_HEADER_SIZE + stdHeaderSize);
            stdHeaderSize += 4;
        }
        if (useExtHeader) {
            const extHeaderOffset = DLT_STORAGE_HEADER_SIZE + stdHeaderSize;
            let extHeader = DltParser.extHeaderParser.parse(data.slice(extHeaderOffset, extHeaderOffset + DLT_EXT_HEADER_SIZE));
            this.verbose = extHeader["verb"] ? true : false;
            this.mstp = extHeader["mstp"];
            this.mtin = extHeader["mtin"];
            this.noar = extHeader["noar"];
            this.apid = extHeader["apid"];
            this.ctid = extHeader["ctid"];
        }
        const payloadOffset = DLT_STORAGE_HEADER_SIZE + stdHeaderSize + (useExtHeader ? DLT_EXT_HEADER_SIZE : 0);
        this._payloadData = data.slice(payloadOffset);
        assert.equal(this._payloadData.byteLength, stdHdr["len"] - (payloadOffset - DLT_STORAGE_HEADER_SIZE));
        // we parse the payload only on demand
    }

    get payloadArgs(): Array<any> {
        if (this._payloadArgs) {
            return this._payloadArgs;
        } else {
            this._payloadText = "";
            // parse the payload:
            const isBigEndian: boolean = (this._htyp & 0x02) ? true : false;
            if (this._payloadData.byteLength < MIN_PAYLOAD_ARG_LEN) { // not <= as for TYPE_CONTROL msgs we do have 4 bytes only sometimes.
                this._payloadArgs = [];
            } else {
                switch (this.mstp) {
                    case MSTP.TYPE_NW_TRACE:
                    case MSTP.TYPE_LOG: {
                        if (this.verbose) {
                            this._payloadArgs = [];
                            let argOffset: number = 0;
                            while (argOffset + 4 < this._payloadData.byteLength) {
                                const typeInfo: number = this._payloadData.readUInt32LE(argOffset);
                                argOffset += 4;
                                const tyle: number = typeInfo & 0x0f; // 1 = 8-bit, 5 = 128-bit, 0 undefined, rest reserved
                                const scod: number = (typeInfo >> 15) & 0x07; // 0 = ASCII, 1 = UTF8, rest reserved
                                const vari: boolean = (typeInfo & 0x800) > 0;
                                const fixp: boolean = (typeInfo & 0x1000) > 0;

                                if (typeInfo & 0x10) { // type bool
                                    assert(tyle === 1 || tyle === 0, `wrong tyle=${tyle} for boolean`);
                                    assert(!(typeInfo & 0x100), "no array support for boolean");
                                    let v = this._payloadData.readUInt8(argOffset) ? true : false;
                                    this._payloadArgs.push({ type: Boolean, v: v });
                                    this._payloadText += `${v ? "true " : "false "}`;
                                    argOffset += 1;
                                } else if (typeInfo & 0x20) { // type SINT
                                    assert(tyle >= 1 && tyle <= 5, `type SINT has unsupported tyle=${tyle} vari=${vari} fixp=${fixp}`);
                                    assert(!(typeInfo & 0x100), "no aray support for SINT");
                                    switch (tyle) {
                                        case 1: this._payloadArgs.push({ type: Number, v: this._payloadData.readInt8(argOffset) }); break;
                                        case 2: this._payloadArgs.push({ type: Number, v: this._payloadData.readInt16LE(argOffset) }); break; // todo endianess
                                        case 3: this._payloadArgs.push({ type: Number, v: this._payloadData.readInt32LE(argOffset) }); break; // todo endianess
                                        case 4: this._payloadArgs.push({ type: BigInt, v: this._payloadData.readBigInt64LE(argOffset) }); break; // todo end.
                                        case 5: break; // this._payloadArgs.push({ type: BigInt, v: this._payloadData.readBigUInt128LE(argOffset) }); break; // todo end.
                                    }
                                    this._payloadText += `${this._payloadArgs[this._payloadArgs.length - 1].v} `;
                                    argOffset += (1 << (tyle - 1));
                                } else if (typeInfo & 0x40) { // type UINT
                                    assert(tyle >= 1 && tyle <= 5, `type UINT has unsupported tyle=${tyle}`);
                                    assert(!(typeInfo & 0x100), "no aray support for UINT");
                                    switch (tyle) {
                                        case 1: this._payloadArgs.push({ type: Number, v: this._payloadData.readUInt8(argOffset) }); break;
                                        case 2: this._payloadArgs.push({ type: Number, v: this._payloadData.readUInt16LE(argOffset) }); break; // todo endianess
                                        case 3: this._payloadArgs.push({ type: Number, v: this._payloadData.readUInt32LE(argOffset) }); break; // todo endianess
                                        case 4: this._payloadArgs.push({ type: BigInt, v: this._payloadData.readBigUInt64LE(argOffset) }); break; // todo end.
                                        case 5: break; // this._payloadArgs.push({ type: BigInt, v: this._payloadData.readBigUInt128LE(argOffset) }); break; // todo end.
                                    }
                                    this._payloadText += `${this._payloadArgs[this._payloadArgs.length - 1].v} `;
                                    argOffset += (1 << (tyle - 1));
                                } else if (typeInfo & 0x80) { // type FLOA
                                    assert(!(typeInfo & 0x100), "no aray support for FLOA");
                                    switch (tyle) {
                                        case 3: // single 32bit
                                            this.payloadArgs.push({ type: Number, v: this._payloadData.readFloatLE(argOffset) }); // todo endianess
                                            argOffset += 4;
                                            break;
                                        case 4: // double 64bit
                                            this.payloadArgs.push({ type: Number, v: this._payloadData.readDoubleLE(argOffset) }); // todo endianess
                                            argOffset += 8;
                                            break;
                                        default:
                                            console.log(`todo impl FLOA parsing for tyle=${tyle}`);
                                            break;
                                    }
                                    this._payloadText += `${this._payloadArgs[this._payloadArgs.length - 1].v} `;
                                } else if (typeInfo & 0x100) { // type ARAY but it might be used with flags already...
                                    /*                                    const nrDims: number = this._payloadData.readUInt16LE(argOffset);
                                                                        argOffset += 2;
                                                                        for (let i = 0; i < nrDims; ++i) {
                                                                            const nrEntries = this._payloadData.readUInt16LE(argOffset);
                                                                            argOffset += 2;*/
                                    console.log(`todo impl ARAY parsing typeInfo=${typeInfo.toString(16)} noar=${this.noar} apid=${this.apid} ctid=${this.ctid}`);

                                    break;
                                } else if (typeInfo & 0x200) { // type STRG
                                    const strLenInclTerm: number = this._payloadData.readUInt16LE(argOffset);
                                    argOffset += 2;
                                    if (strLenInclTerm > 0 && strLenInclTerm < 2000) { // some sanity check...
                                        let strText = this._payloadData.toString((scod === 1 ? "utf8" : "latin1"), argOffset, argOffset + strLenInclTerm - 1);
                                        // replace CRLF with ' '
                                        // todo assemble payloadAsText ... msgText += strText.replace(/(\r\n|\n|\r)/gm, " "); // this is slow...
                                        this.payloadArgs.push({ type: String, v: strText });
                                        this._payloadText += `${strText.replace(/\r?\n|\r/g, " ")} `;
                                    } else {
                                        console.log("ignored strlen due to sanity check!");
                                    }
                                    argOffset += strLenInclTerm;
                                } else if (typeInfo & 0x400) { // RAWD
                                    const lenRaw: number = this._payloadData.readUInt16LE(argOffset);
                                    argOffset += 2;
                                    const rawd = this._payloadData.slice(argOffset, argOffset + lenRaw);
                                    this.payloadArgs.push({ type: Buffer, v: rawd });
                                    this._payloadText += rawd.toString("hex");
                                    argOffset += lenRaw;
                                } else { break; } // todo VARI, FIXP, TRAI, STRU
                            }
                            assert.equal(argOffset, this._payloadData.byteLength, "didn't process all payloadData"); // all data processed
                            assert.equal(this.noar, this.payloadArgs.length, "noars != payloadArgs.length");
                            //this._payloadArgs = []; // todo to see how much faster it gets
                        } else {
                            console.log(`no non-verbose support yet for TYPE_LOG mstp=${this.mstp}! todo`);
                            this._payloadArgs = [];
                            break;
                        }
                    }
                        break;
                    case MSTP.TYPE_CONTROL: {
                        const serviceId = isBigEndian ? this._payloadData.readUInt32BE(0) : this._payloadData.readUInt32LE(0);
                        this._payloadArgs = [];
                        if (this.noar === 1) {
                            this._payloadArgs.push({ type: Number, v: serviceId });
                            if (serviceId > 0 && serviceId < serviceIds.length) {
                                this._payloadText += serviceIds[serviceId];
                            } else {
                                this._payloadText += `service(${serviceId})`;
                            }
                            if (this._payloadData.length > 4) {
                                // response code?
                                let remOffset = 4;
                                if (this.mtin === MTIN_CTRL.CONTROL_RESPONSE) {
                                    // 1 byte resp. code
                                    const respCode = this._payloadData.readUInt8(remOffset);
                                    if (respCode <= 3 || respCode === 8) {
                                        this._payloadText += `, ${MTIN_CTRL_RESPONSE_strs[respCode]}`;
                                    } else {
                                        this._payloadText += `, ${String(respCode.toString(16)).padStart(2, '0')}`;
                                    }
                                    remOffset++;
                                }
                                const rawd = this._payloadData.slice(remOffset);
                                this._payloadText += ', ' + rawd.toString("hex");
                            }
                        } else {
                            console.log(`CONTROL_MSG with noar=${this.noar} and serviceId=${serviceId}`);
                        }
                        assert.equal(this.noar, this.payloadArgs.length, "TYPE_CONTROL noars != payloadArgs.length");
                    }
                        break;
                    default:
                        console.log(`payloadArgs for type ${this.mstp} not impl. yet. todo`);
                        this._payloadArgs = [];
                }
                if (this._payloadText.endsWith(' ')) { this._payloadText = this._payloadText.slice(0, -1); } // this is not quite right. if ' ' was part of the payload text...
            }
            return this._payloadArgs;
        }
    }

    static emptyBuffer: Buffer = Buffer.alloc(0);

    get payloadString(): string {
        if (this._payloadText) {
            // cached already?
            return this._payloadText;
        } else {
            this.payloadArgs; // this updates payloadText as well
            if (!this._payloadText) {
                this._payloadText = "";
            }
            this._payloadData = DltMsg.emptyBuffer; // todo...
            return this._payloadText;
        }
    }


}

export class DltParser {
    static storageHeaderParser = new Parser().endianess("little").uint32("pattern").uint32("secs").int32("micros").string("ecu", { encoding: "ascii", length: 4, stripNull: true });//.uint32("ecu");
    static stdHeaderParser = new Parser().endianess("little").uint8("htyp").uint8("mcnt").uint16be("len");
    static extHeaderParser = new Parser().endianess("little").bit1("verb").bit3("mstp").bit4("mtin").uint8("noar").string("apid", { encoding: "ascii", length: 4, stripNull: true }).string("ctid", { encoding: "ascii", length: 4, stripNull: true });

    parseDltFromBuffer(buf: Buffer, startOffset: number, msgs: Array<DltMsg>, posFilters?: DltFilter[], negFilters?: DltFilter[], negBeforePosFilters?: DltFilter[]) { // todo make async
        let skipped: number = 0;
        let remaining: number = buf.byteLength - startOffset;
        let nrMsgs: number = 0; let offset = startOffset;
        const startIndex: number = msgs.length ? (msgs[msgs.length - 1].index + 1) : 0; // our first index to use is either prev one +1 or 0 as start value
        while (remaining >= MIN_DLT_MSG_SIZE) {
            let storageHeader = DltParser.storageHeaderParser.parse(buf.slice(offset, offset + DLT_STORAGE_HEADER_SIZE));
            if (storageHeader["pattern"] === DLT_STORAGE_HEADER_PATTERN) {
                const msgOffset = offset;
                offset += DLT_STORAGE_HEADER_SIZE;
                let time = new Date((storageHeader["secs"] * 1000) + (storageHeader["micros"] / 1000));
                let stdHeader = DltParser.stdHeaderParser.parse(buf.slice(offset, offset + MIN_STD_HEADER_SIZE));
                // do we have the remaining data in buf?
                const len = stdHeader["len"];
                if (remaining - ((offset + len) - msgOffset) >= 0) {
                    offset += len;

                    let newMsg = new DltMsg(storageHeader["ecu"], startIndex + nrMsgs, time, buf.slice(msgOffset, offset));
                    // do we need to filter this one?
                    let keepAfterNegBeforePosFilters: boolean = true;
                    if (negBeforePosFilters?.length) {
                        for (let i = 0; i < negBeforePosFilters.length; ++i) {
                            if (negBeforePosFilters[i].matches(newMsg)) {
                                keepAfterNegBeforePosFilters = false;
                                break;
                            }
                        }
                    }

                    if (keepAfterNegBeforePosFilters) {
                        let foundAfterPosFilters: boolean = posFilters?.length ? false : true;
                        if (posFilters?.length) {
                            // check the pos filters, break on first match:
                            for (let i = 0; i < posFilters.length; ++i) {
                                if (posFilters[i].matches(newMsg)) {
                                    foundAfterPosFilters = true;
                                    break;
                                }
                            }
                        }
                        let foundAfterNegFilters: boolean = foundAfterPosFilters;
                        if (foundAfterNegFilters && negFilters?.length) {
                            // check the neg filters, break on first match:
                            for (let i = 0; i < negFilters.length; ++i) {
                                if (negFilters[i].matches(newMsg)) {
                                    foundAfterNegFilters = false;
                                    break;
                                }
                            }
                        }
                        if (foundAfterNegFilters) {
                            msgs.push(newMsg);
                            nrMsgs++; // todo or should we always keep the orig index here?
                        }
                    }
                    remaining -= (offset - msgOffset);
                } else {
                    break;
                }
            } else {
                offset++;
                skipped++;
                remaining--;
            }
        }
        return [skipped, remaining, nrMsgs];
    }
}
