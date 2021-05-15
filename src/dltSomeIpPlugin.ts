/* --------------------
 * Copyright(C) Matthias Behr. 2021
 *
 * todos:
 * - reload files on config change
 * - support unions
 * - support fx:BIT-LENGTH parsing...
 *   - BIT-LENGTH 168 for a DATATYPE STRINGUTF8FIXED -> A_UNICODE2STRING
 * - prefer SIGNAL-REF over DATATYPE-REF? (e.g. for _587943632 )
 * - support Boolean
 * - tooltips for messages with details on data types,codings, ...
 * - parse unknown services with default schema
 * - add header info to tooltip (ip addr...)
 * - update docs
 */

import * as vscode from 'vscode';
import { TreeViewNode } from './dltTreeViewNodes';
import { DltMsg, MSTP, MTIN_NW } from './dltParser';
import { assert } from 'console';
import { createUniqueId } from './util';
import { DltTransformationPlugin } from './dltTransformationPlugin';
import { FibexLoader, Method, Parameter, Coding, Datatype, ArrayInfo } from './fibexLoader';

export class DltSomeIpPlugin extends DltTransformationPlugin {

    private _mtin: Number;
    private static _warningsShown: Map<string, boolean> = new Map();

    private _servicesNode: TreeViewNode | undefined;

    constructor(uri: vscode.Uri, public treeViewNode: TreeViewNode, treeEventEmitter: vscode.EventEmitter<TreeViewNode | null>, options: any) {
        super(uri, treeViewNode, treeEventEmitter, options);
        this._boundTransformCb = this.transformCb.bind(this);

        this.ctid = 'TC';
        if ('ctid' in options) {
            if (options.ctid.length) {
                this.ctid = options.ctid;
            }
        }

        this._mtin = MTIN_NW.TRACE_IPC;
        if ('mtin' in options) {
            this._mtin = options.mtin;
        }

        console.warn(`DltSomeIpPlugin (enabled=${this.enabled}, fibexDir = ${JSON.stringify(options['fibexDir'])})`);

        if (!this.enabled) {
            this.treeViewNode.tooltip = `disabled`;
        }

        // open xml files...
        if ('fibexDir' in options && typeof options['fibexDir'] === 'string' && options['fibexDir'].length) {
            if (this.enabled) {
                FibexLoader.loadAllFibex(options['fibexDir']);
                this.treeViewNode.tooltip = `loaded ${FibexLoader.loadedFibex.length} FIBEX files:\n${FibexLoader.loadedFibex.join('\n')}`;
            }
            this._servicesNode = { id: createUniqueId(), label: `Services (${FibexLoader.services.size})`, children: [], parent: treeViewNode, tooltip: '', uri: uri };
            treeViewNode.children.push(this._servicesNode);
            // add services:
            FibexLoader.services.forEach((service, sid) => {
                const serviceNode: TreeViewNode = {
                    id: createUniqueId(),
                    label: `${service.shortName}${service.version ? ` v${service.version['service:MAJOR']}.${service.version['service:MINOR']}` : ''}`,
                    tooltip: `Service Id: (${service.sid.toString(16).padStart(4, '0')})${service.desc ? '\n' + DltSomeIpPlugin.getDescAsText(service.desc) : ''}`,
                    uri: uri, children: [], parent: this._servicesNode!
                };
                this._servicesNode!.children.push(serviceNode);
                // add methods:
                service.methods.forEach((method, mid) => {
                    const methodNode = {
                        id: createUniqueId(),
                        label: `${method.shortName}`,
                        tooltip: `Method Id: (${method.mid.toString(16).padStart(4, '0')})${method.desc ? '\n' + DltSomeIpPlugin.getDescAsText(method.desc) : ''}`,
                        uri: uri, children: [], parent: serviceNode
                    };
                    serviceNode.children.push(methodNode);
                });
            });

            treeViewNode.children.push({ id: createUniqueId(), label: `Datatypes (${FibexLoader.datatypes.size})`, children: [], parent: treeViewNode, tooltip: '', uri: uri });
            treeViewNode.children.push({ id: createUniqueId(), label: `Codings (${FibexLoader.codings.size})`, children: [], parent: treeViewNode, tooltip: '', uri: uri });

            this._treeEventEmitter.fire(this.treeViewNode);
        } // else notify and disable? (or keep enabled without? to anyhow parse at least sid/mid?)
    }

    private static getDescAsText(desc: any): string {
        if (desc === undefined) { return ''; }
        if (typeof desc === 'string') { return desc; }
        const descArr = Array.isArray(desc) ? desc : [desc];
        return descArr.map(desc => { return desc['@_TYPE'] === 'Standard' ? desc['#text'] : `${desc['@_TYPE']}: ${desc['#text']}`; }).join('\n');
    }

    get name(): string {
        return `${this.enabled ? '' : "disabled: "}plugin SOME/IP`;
    }

    matches(msg: DltMsg): boolean {
        if (!this.enabled) {
            return false;
        }

        if (msg.mstp !== MSTP.TYPE_NW_TRACE) { return false; }
        if (msg.mtin !== this._mtin) { return false; }
        if (msg.ctid !== this.ctid) { return false; }
        if (msg.noar < 2) { return false; }

        return true;
    }

    // return codes according to PRS_SOMEIP_00191
    private _returnCodeMap: Map<number, string> = new Map([
        [0, "OK"],
        [1, "NOT OK"],
        [2, "UNKNOWN SERVICE"],
        [3, "UNKNOWN METHOD"],
        [4, "NOT READY"],
        [5, "NOT REACHABLE"],
        [6, "TIMEOUT"],
        [7, "WRONG PROTOCOL VERSION"],
        [8, "WRONG INTERFACE VERSION"],
        [9, "MALFORMED MESSAGE"],
        [0xa, "WRONG MESSAGE TYPE"],
    ]);

    // message type indicator
    private _messageTypeStr: Map<number, string> = new Map([
        [0, ">"], // request
        [1, ">"], // request
        [2, "*"], // notif
        [0x80, "<"], // resp
        [0x81, "!"], // err
    ]);

    /**
     * like JSON.stringify except that strings are not enquoted in "..."
     * @param val object to JSON.stringify
     * @returns textual representation
     */
    static stringify(val: any): string {
        if (!val) { return '{}'; }
        // bigints can't be serialized naturally
        return JSON.stringify(val, (k, v) => typeof v === 'bigint' ? `${v}n` : v);

        /* lets encode ENUMs properly as well!
        return '{' + Object.entries(val).map(kv => { const [k, v] = kv; return `"${k}":${typeof v === 'object' ? DltSomeIpPlugin.stringify(v) : v}`; }).join(',') + '}';
        */
    }

    transformCb(msg: DltMsg) {
        try {
            // identify the service id:
            if (msg._payloadArgs && msg._payloadArgs.length >= 2) {
                const payload = msg._payloadArgs[1];
                if (payload.type === Buffer) {
                    const buf: Buffer = payload.v;
                    if (buf.length < 16) { return; }
                    const serviceId = buf.readUInt16BE(0);
                    const methodOrEventId = buf.readUInt16BE(2);
                    const isMethod = methodOrEventId < 0x8000;
                    const eventId = isMethod ? -1 : methodOrEventId & 0x7fff; // last 15 bits
                    const msgLength = buf.readUInt32BE(4);
                    const clientId = buf.readUInt16BE(8);
                    const sessionId = buf.readUInt16BE(10);
                    // protocolVersion // someip protocol version
                    // interfaceVersion // major version of the interface
                    const messageType = buf.readUInt8(14); // 0 request, 1 req no return, 2 notif, 0x80 resp, 0x81 error, 0x20 tp req, 0x21 tp req no ret, 0x22 tp notif, 0x23 tp resp, 0x24 tp err 
                    // (0x20 flag tp = segment)
                    // todo add support for TP (segmented) messages
                    const returnCode = buf.readUInt8(15);
                    const isReturn = messageType === 0x80 || messageType === 0x23;
                    const service: any = FibexLoader.services.get(serviceId);
                    if (service) {
                        let header: Buffer = msg._payloadArgs[0].v;
                        let instId: number = 0;
                        switch (header.length) {
                            case 9: instId = header.readUInt8(8); break;
                            case 10: instId = header.readUInt16BE(8); break;
                            case 12: instId = header.readUInt32BE(8); break;
                            default: console.warn(`DltSomeIpPlugin.transformCb unkown header.length:${header.length}`); break;
                        }
                        const method: Method | undefined = service.methods.get(methodOrEventId);
                        //console.warn(`transformCb: method=${JSON.stringify(method)}`);
                        //if (!method) { console.warn(`transformCb: no method!`); }

                        const datatype = method && method.datatype ? FibexLoader.datatypes.get(method.datatype) : undefined;
                        const arrayInfo = method?.array;

                        // console.warn(`transformCb: datatype=${method?.datatype} ${JSON.stringify(datatype)}`);
                        // parameter payload:
                        const parameters = buf.slice(16);
                        //console.warn(`transformCb: parameters=${parameters.length} ${parameters.toString('hex')}`);
                        let valueObj: any | undefined;
                        try {
                            if (datatype) {
                                const [parsedLen, parsedValueObj] = this.parseParameters(parameters, 0, undefined, datatype, arrayInfo);
                                if (method?.fieldName || datatype.shortName) {
                                    valueObj = { [method?.fieldName || datatype.shortName]: parsedValueObj };
                                } else {
                                    valueObj = parsedValueObj;
                                }
                                if ((parsedLen >> 3) !== parameters.length) {
                                    if (!DltSomeIpPlugin._warningsShown.has(`${serviceId}.${methodOrEventId}`)) {
                                        DltSomeIpPlugin._warningsShown.set(`${serviceId}.${methodOrEventId}`, true);
                                        console.warn(`transformCb: parseParameters parsed ${parsedLen} vs parameters=${8 * parameters.length} bits for service id ${serviceId} (${serviceId.toString(16).padStart(4, '0')}) and method=(${methodOrEventId.toString(16).padStart(4, '0')}). FIBEX not matching?`);
                                    }
                                }
                            } else {
                                if (isReturn && method?.returnParams || !isReturn && method?.inputParams) {
                                    // console.warn(`transformCb: no datatype but input/returnParams for service (${serviceId.toString(16).padStart(4, '0')}) method=(${methodOrEventId.toString(16).padStart(4, '0')})${JSON.stringify(method)} ${JSON.stringify(!isReturn ? method.inputParams : method.returnParams)} !`);
                                    const [parsedLen, parsedValueObj] = this.parseInputReturnParameters(parameters, isReturn ? method.returnParams! : method.inputParams!);
                                    valueObj = parsedValueObj;
                                    if ((parsedLen >> 3) !== parameters.length) {
                                        if (!DltSomeIpPlugin._warningsShown.has(`${serviceId}.${methodOrEventId}`)) {
                                            DltSomeIpPlugin._warningsShown.set(`${serviceId}.${methodOrEventId}`, true);
                                            console.warn(`transformCb: parseInputReturnParameters parsed ${parsedLen} vs parameters=${8 * parameters.length} bits for service (${serviceId.toString(16).padStart(4, '0')}) and method ${JSON.stringify(method)}`);
                                        }
                                    }
                                } else {
                                    if (buf.length > 16) { console.warn(`transformCb: no datatype for service (${serviceId.toString(16).padStart(4, '0')}) method=(${methodOrEventId.toString(16).padStart(4, '0')})${JSON.stringify(method)}!`); }
                                }
                            }
                        } catch (e) {
                            valueObj = { 'err': `SOME/IP decoding failed with '${e}'` };
                        }
                        msg._payloadText = `${this._messageTypeStr.get(messageType & ~0x20) || `?<${messageType}>`} (${clientId.toString(16).padStart(4, '0')}:${sessionId.toString(16).padStart(4, '0')}) ${service.shortName}(${instId.toString(16).padStart(4, '0')}).${method?.shortName || methodOrEventId.toString(16).padStart(4, '0')}${DltSomeIpPlugin.stringify(valueObj)}[${this._returnCodeMap.get(returnCode) || 'UNKNOWN'}]`;
                    } else {
                        msg._payloadText = `SOME/IP unknown service with id ${serviceId} (${serviceId.toString(16)}) ` + msg._payloadText;
                    }
                    // console.log(`DltSomeIpPlugin.transformCb: '${msg._payloadText}'`);
                }
            }
        } catch (e) {
            console.warn(`DltSomeIpPlugin.transformCb got '${e}'`);
        }
    }

    private parseInputReturnParameters(buf: Buffer, params: Parameter[]): [number, any] {
        if (params.length === 0) { return [0, undefined]; }
        const objToRet: any = {};
        let parsedBits: number = 0;

        for (let i = 0; i < params.length; ++i) {
            const param = params[i];
            // if (param.array) { console.warn(`DltSomeIpPlugin.parseInputReturnParameters datatype ${param.shortName}.${param.datatype} is array: ${JSON.stringify(param.array)}!`); }
            if (param.datatype) {
                const datatype = FibexLoader.datatypes.get(param.datatype);
                if (datatype) {
                    const [parsed, valueObj] = this.parseParameters(buf, parsedBits, undefined, datatype, param.array);
                    objToRet[param.shortName || i] = valueObj;
                    parsedBits += parsed;
                } else {
                    console.warn(`DltSomeIpPlugin.parseInputReturnParameters datatype ${param.shortName}.${param.datatype} not found!`);
                    break;
                }
            } else {
                console.warn(`DltSomeIpPlugin.parseInputReturnParameters got no datatype for ${param.shortName}`);
                break;
            }
        }
        return [parsedBits, objToRet];
    }

    private static readUIntBitOffset(buf: Buffer, bitOffset: number, bitLength: number, baseTypeBytes: number): number {
        let toRet: number;
        const mod = bitOffset & 7;
        const offset = bitOffset >> 3;
        const baseTypeBitSize = baseTypeBytes << 3;
        switch (baseTypeBytes) {
            case 1: toRet = buf.readUInt8(offset); break;
            case 2: toRet = buf.readUInt16BE(offset); break;
            case 4: toRet = buf.readUInt32BE(offset); break;
            default: toRet = 0; assert(false); break;
        }
        if (mod !== 0) {
            // all data contained?
            if (mod + bitLength <= baseTypeBitSize) {
                toRet = toRet >> (baseTypeBitSize - (mod + bitLength));
            } else {
                // need another byte:
                toRet = (toRet << 8) | (buf.readUInt8(offset + baseTypeBytes)); // todo unit test (mainly for endianess)
                toRet = toRet >> ((baseTypeBitSize + 8) - (mod + bitLength));
            }
        }
        // bitLength?
        if ((bitLength > baseTypeBitSize) || bitLength < 1) { // 0 is basically working but doesn't make sense!
            // todo mask out upper bits... that dont belong to here:
            console.warn(`DltSomeIpPlugin.readUIntBitOffset unsupported bitLength=${bitLength}`);
        } else if (bitLength < baseTypeBitSize) {
            toRet &= (1 << bitLength) - 1;
        }
        return toRet;
    }

    private parseSingleCoding(buf: Buffer, bitOffset: number, bitLengthPar: number | undefined, coding: Coding): [number, any | string | number | undefined] {
        let objToRet: any | string | number | undefined;
        let parsedBits = 0;
        if (coding.codedType) {
            const codedBaseType = coding.codedType['@_ho:BASE-DATA-TYPE'];
            const bitLength = bitLengthPar || coding.codedType['ho:BIT-LENGTH']; // we prefer the parent bit length
            const offset = bitOffset >> 3;
            const bitMod = bitOffset & 7;
            switch (codedBaseType) {
                case 'A_UINT8':
                    //objToRet = buf.readUInt8(offset);
                    objToRet = DltSomeIpPlugin.readUIntBitOffset(buf, bitOffset, bitLength || 8, 1);
                    parsedBits += bitLength ? bitLength : 8;
                    break;
                case 'A_INT8':
                    if ((bitLength !== undefined && bitLength !== 8) || (bitMod !== 0)) {
                        console.error(`parseSingleCodingBits A_INT8 with bitMod=${bitMod} bitLength=${bitLength}`);
                    }
                    objToRet = buf.readInt8(offset);
                    parsedBits = 8; break;
                case 'A_INT16':
                    if ((bitLength !== undefined && bitLength !== 16) || (bitMod !== 0)) {
                        console.error(`parseSingleCodingBits A_INT16 with bitMod=${bitMod} bitLength=${bitLength}`);
                    }
                    objToRet = buf.readInt16BE(offset);
                    parsedBits = 16; break;
                case 'A_UINT16':
                    objToRet = DltSomeIpPlugin.readUIntBitOffset(buf, bitOffset, bitLength || 16, 2);
                    parsedBits = bitLength ? bitLength : 16; break;
                case 'A_INT32':
                    if ((bitLength !== undefined && bitLength !== 32) || (bitMod !== 0)) {
                        console.error(`parseSingleCodingBits A_INT32 with bitMod=${bitMod} bitLength=${bitLength}`);
                    }
                    objToRet = buf.readInt32BE(offset);
                    parsedBits = 32;
                    break;
                case 'A_UINT32':
                    objToRet = DltSomeIpPlugin.readUIntBitOffset(buf, bitOffset, bitLength || 32, 4);
                    parsedBits = bitLength ? bitLength : 32;
                    break;
                case 'A_INT64':
                    if ((bitLength !== undefined && bitLength !== 64) || (bitMod !== 0)) {
                        console.error(`parseSingleCodingBits A_INT64 with bitMod=${bitMod} bitLength=${bitLength}`);
                    }
                    objToRet = buf.readBigInt64BE(offset);
                    parsedBits = 64;
                    console.warn(`DltSomeIpPlugin.parseSingleCoding untested A_INT64 returning '${objToRet}' from '${buf.slice(offset, offset + (parsedBits / 8)).toString('hex')}'`);
                    break;
                case 'A_UINT64':
                    if ((bitLength !== undefined && bitLength !== 64) || (bitMod !== 0)) {
                        console.error(`parseSingleCodingBits A_INT64 with bitMod=${bitMod} bitLength=${bitLength}`);
                    }
                    objToRet = buf.readBigUInt64BE(offset);
                    parsedBits = 64;
                    break;
                case 'A_FLOAT32':
                    if ((bitLength !== undefined && bitLength !== 32) || (bitMod !== 0)) {
                        console.error(`parseSingleCodingBits A_FLOAT32 with bitMod=${bitMod} bitLength=${bitLength}`);
                    }
                    objToRet = buf.readFloatBE(offset);
                    parsedBits = 32;
                    console.warn(`DltSomeIpPlugin.parseSingleCoding untested A_FLOAT32 returning '${objToRet}' from '${buf.slice(offset, offset + (parsedBits / 8)).toString('hex')}'`);
                    break;
                case 'A_FLOAT64':
                    if ((bitLength !== undefined && bitLength !== 64) || (bitMod !== 0)) {
                        console.error(`parseSingleCodingBits A_FLOAT64 with bitMod=${bitMod} bitLength=${bitLength}`);
                    }
                    objToRet = buf.readDoubleBE(offset);
                    parsedBits = 64;
                    console.warn(`DltSomeIpPlugin.parseSingleCoding untested A_FLOAT64 returning '${objToRet}' from '${buf.slice(offset, offset + (parsedBits / 8)).toString('hex')}'`);
                    break;
                case 'A_UNICODE2STRING':
                    // console.log(`A_UNICODE2STRING: ${JSON.stringify(coding.codedType)}`);
                    // check for ENCODING UTF-8 and TERMINATION="ZERO" todo
                    // assert(bitLength === undefined || bitLength === 16);
                    if (bitMod !== 0) {
                        console.error(`parseSingleCodingBits A_UNICODE2STRING with bitMod=${bitMod} bitLength=${bitLength}`);
                    }
                    let encoding: BufferEncoding | undefined;
                    switch (coding.codedType['@_ENCODING']) {
                        case 'UCS-2': encoding = 'ucs2'; break;
                        case undefined:
                        case 'UTF-8':
                            encoding = 'utf8';
                            break;
                        default:
                            console.warn(`A_UNICODE2STRING: unknown encoding (${coding.codedType['@_ENCODING']}) ${JSON.stringify(coding.codedType)}`);
                            break;
                    }
                    // assume: 32bit length covering: BOM field, string, terminating zero.
                    let strLenBomZero = buf.readUInt32BE(offset);
                    let parsedBytes = 4;
                    switch (strLenBomZero) {
                        case 0: objToRet = ''; break;
                        case 4022058752: // bug in encoding? (was bug in array parsing :). this is the BOM
                            objToRet = 'error: BOM as str len!';
                            console.warn(`A_UNICODE2STRING: BOM as str len? strLenBomZero=${strLenBomZero} buf=${buf.slice(offset, offset + 4 + strLenBomZero).toString('hex')} returning '${objToRet}'`);
                            break;
                        default:
                            switch (encoding) {
                                case 'utf8': // check and remove BOM:
                                    if (buf[offset + parsedBytes] === 0xef && buf[offset + parsedBytes + 1] === 0xbb && buf[offset + parsedBytes + 2] === 0xBF) {
                                        // skip BOM UTF-8
                                        parsedBytes += 3;
                                        strLenBomZero -= 3;
                                    } else {
                                        console.warn(`A_UNICODE2STRING: strLenBomZero=${strLenBomZero} unexpected utf8 BOM! buf=${buf.slice(offset, offset + 4 + strLenBomZero).toString('hex')} coding=${JSON.stringify(coding)}`);
                                    }
                                    break;
                                case 'ucs2':
                                    if (buf[offset + parsedBytes] === 0xfe && buf[offset + parsedBytes + 1] === 0xff) {
                                        // skip BOM UTF-16 BE (fe ff)
                                        parsedBytes += 2;
                                        strLenBomZero -= 2;
                                    } else {
                                        console.warn(`A_UNICODE2STRING: strLenBomZero=${strLenBomZero} unexpected ucs2 BOM! buf=${buf.slice(offset, offset + 4 + strLenBomZero).toString('hex')}`);
                                    }
                                    break;
                            }
                            objToRet = strLenBomZero > 1 ? buf.toString(encoding, offset + parsedBytes, offset + parsedBytes + strLenBomZero - 1) : '';
                            parsedBytes += strLenBomZero;
                        // console.log(`A_UNICODE2STRING: strLenZero=${strLenBomZero} buf=${buf.slice(offset, offset + 4 + strLenBomZero).toString('hex')} returning len=${objToRet.length} '${objToRet}'`);
                    }
                    parsedBits += parsedBytes * 8;
                    break;
                    // todo A_BOOLEAN?
                default:
                    console.error(`parseParameters unknown/nyi codedBaseType ='${codedBaseType}'`);
                    break;
            }
        } else {
            console.warn(`DltSomeIpPlugin.parseParameters no codedType for coding=${JSON.stringify(coding)}`);
        }
        return [parsedBits, objToRet];
    }

    private parseSingleStruct(buf: Buffer, bitOffset: number, bitLengthPar: number | undefined, datatype: Datatype): [number, any | undefined] {
        const objToRet: any = {};
        let parsedBits = 0;
        //console.warn(` datatype.complexStructMembers=${JSON.stringify(datatype.complexStructMembers)})`);
        const members: any[] = datatype.complexStructMembers!;
        for (let i = 0; i < members.length; ++i) {
            const member = members[i];
            const memberShortName = member['ho:SHORT-NAME'] || i;
            const memberDatatype = FibexLoader.datatypes.get(member['fx:DATATYPE-REF']['@_ID-REF']);
            const bitLength = ('fx:UTILIZATION' in member) && ('fx:BIT-LENGTH' in member) ? Number(member['fx:UTILIZATION']['fx:BIT-LENGTH']) : bitLengthPar; // todo use parent at all here?

            // is it an array?
            let memberArrayInfo: ArrayInfo | undefined;
            if ('fx:ARRAY-DECLARATION' in member) {
                const memberArrayDim = member['fx:ARRAY-DECLARATION']['fx:ARRAY-DIMENSION'];
                memberArrayInfo = {
                    dim: memberArrayDim ? memberArrayDim['fx:DIMENSION'] : 1,
                    minSize: memberArrayDim ? memberArrayDim['fx:MINIMUM-SIZE'] : undefined,
                    maxSize: memberArrayDim ? memberArrayDim['fx:MAXIMUM-SIZE'] : undefined
                };
            }

            if (memberArrayInfo && memberArrayInfo.dim > 0) {
                if (bitLength && (bitLength % 8) !== 0) {
                    console.warn(` datatype.parseSingleStruct array with bitLength=${bitLength}: ${JSON.stringify(member)})`);
                }
                if (memberArrayInfo.dim !== 1) { console.warn(`DltSomeIpPlugin.parseSingleStruct array with dim ${memberArrayInfo.dim} not supported yet! member=${JSON.stringify(member)}`); }
                //if (memberArrayInfo.minSize) { console.warn(`DltSomeIpPlugin.parseSingleStruct array with minSize ${memberArrayInfo.minSize} ${memberArrayInfo.maxSize} not supported yet!`); }

                //console.warn(`DltSomeIpPlugin.parseParameters complexStruct nyi ARRAY ${JSON.stringify(member, undefined, 2)} ${JSON.stringify(datatype)} from size:${buf.length - (offset + parsedBytes)} '${buf.slice(offset + parsedBytes).toString('hex')}'`);
                let arrLen = 0;
                if (memberArrayInfo.minSize && memberArrayInfo.maxSize && memberArrayInfo.minSize === memberArrayInfo.maxSize) {
                    arrLen = memberArrayInfo.minSize;
                    //if (memberArrayInfo.minSize) { console.warn(`DltSomeIpPlugin.parseSingleStruct array assuming fixed size array with minSize ${memberArrayInfo.minSize} ${memberArrayInfo.maxSize}`); }
                } else {
                    // assume an array starts with a 4 byte len: (byte size of the full array)
                    const offset = (bitOffset + parsedBits) >> 3;
                    if (((bitOffset + parsedBits) & 7) !== 0) {
                        console.warn(`parseSingleStructBit array len start not at byte border: bitOffset=${bitOffset} parsedBits=${parsedBits}`);
                    }
                    arrLen = buf.readUInt32BE(offset);
                    parsedBits += 32;
                }
                // console.log(`DltSomeIpPlugin.parseParameters complexStruct ARRAY arrLen=${arrLen}'`);
                if (arrLen === 0) {
                    objToRet[memberShortName] = [];
                    continue;
                } // done in that case!
                if (!memberDatatype) {
                    // we dont' know the datatype but we can skip the whole array
                    objToRet[memberShortName] = [`err:unknown member datatype ${JSON.stringify(member['fx:DATATYPE-REF'])}`];
                    parsedBits += arrLen * 8;
                    continue;
                } else {
                    const offset = (bitOffset + parsedBits) >> 3;
                    if (((bitOffset + parsedBits) & 7) !== 0) {
                        console.warn(`parseSingleStructBit array start not at byte border: bitOffset=${bitOffset} parsedBits=${parsedBits}`);
                    }
                    const arrBuf = buf.slice(offset, offset + arrLen);
                    const valueArr: any[] = [];
                    let parsedArrBits = 0;
                    while ((parsedArrBits >> 3) < arrLen) {
                        const [parsed, valueObj] = this.parseParameters(arrBuf, parsedArrBits, bitLength, memberDatatype);
                        if (!parsed) {
                            if (!DltSomeIpPlugin._warningsShown.has(`${datatype.shortName}.${memberShortName}`)) {
                                DltSomeIpPlugin._warningsShown.set(`${datatype.shortName}.${memberShortName}`, true);
                                console.warn(`DltSomeIpPlugin.parseParameters parsing after ${parsedArrBits} / ${arrLen * 8} bits failed for array member ${i + 1}/${members.length}: ${datatype.shortName}.${memberShortName} bitLength=${bitLength} memberDatatype=${JSON.stringify(memberDatatype)} member=${JSON.stringify(member)}`);
                            }
                            parsedArrBits = arrLen * 8;
                        } else {
                            valueArr.push(valueObj);
                            parsedArrBits += parsed;
                        }
                    }
                    objToRet[memberShortName] = valueArr;
                    parsedBits += arrLen * 8;
                }
            } else { // member is no array
                //console.warn(`  memberDatatype ${i + 1}: ${memberShortName}: `);
                if (memberDatatype) {
                    const [parsed, valueObj] = this.parseParameters(buf, bitOffset + parsedBits, bitLength, memberDatatype);
                    if (!parsed) {
                        if (!DltSomeIpPlugin._warningsShown.has(`${datatype.shortName}.${memberShortName}`)) {
                            DltSomeIpPlugin._warningsShown.set(`${datatype.shortName}.${memberShortName}`, true);
                            console.warn(`DltSomeIpPlugin.parseParameters parsing failed for member ${i + 1}/${members.length} after parsing ${parsedBits}/${8 * (buf.length - (bitOffset / 8))} bits: ${datatype.shortName}.${memberShortName} datatype:${JSON.stringify(memberDatatype)}`);
                        }
                        break;
                    }
                    objToRet[memberShortName] = valueObj; // todo (ensure that memberShortName is no number) we want to keep the order. but the order of property keys is only kept if the memberShortName is not a number but a string...
                    parsedBits += parsed;
                    // todo check if fx:MANDATORY is true and throw on error parsing (here processed 0)
                } else {
                    console.warn(`  no memberDatatype for member = ${JSON.stringify(member)})`);
                }
            }
        }
        return [parsedBits, objToRet];
    }

    /**
     * Parse a SOMEIP payload for a datatype
     * @param buf buffer with payload of parameters
     * @param bitOffset offset in buffer to start in bits
     * @param bitLength if specified: bit length of this parameter
     * @param datatype expected datatype to parse
     * @returns parsed bit number and object with the data
     */
    private parseParameters(buf: Buffer, bitOffset: number, bitLength: number | undefined, datatype: Datatype, arrayInfo?: ArrayInfo): [number, any | string | number | undefined] {
        //console.warn(`DltSomeIpPlugin.parseParameters(offset=${offset}, datatype.shortName=${datatype.shortName})`);
        if ((bitOffset >> 3) >= buf.length) {
            //console.warn(`DltSomeIpPlugin.parseParameters out of range for: datatype ${JSON.stringify(datatype)})`);
            return [0, undefined];
        }
        let parsedBits: number = 0;
        let objToRet: any | string | number | undefined;
        if (datatype.codingRef) {
            assert(!datatype.complexStructMembers);
            assert(!datatype.complexUnionMembers);
            const coding = FibexLoader.codings.get(datatype.codingRef);
            const isArray = arrayInfo; // todo add parsing from ARRAY-DECLARATION here as well?

            if (isArray && isArray.dim > 0) { // todo currently only 1 supported!
                if (isArray.dim !== 1) { console.warn(`DltSomeIpPlugin.parseParameters array with dim ${isArray.dim} not supported yet!`); }
                let arrLen = 0;
                if (isArray.minSize && isArray.maxSize && isArray.minSize === isArray.maxSize) {
                    arrLen = isArray.minSize;
                    if (isArray.minSize) { console.warn(`DltSomeIpPlugin.parseParameters array assuming fixed size array with const size ${isArray.minSize}`); }
                } else {
                    const offset = (bitOffset + parsedBits) >> 3;
                    if (((bitOffset + parsedBits) & 7) !== 0) {
                        console.error(`parseParametersBit array start not at byte border: bitOffset=${bitOffset} parsedBits=${parsedBits}`);
                    }
                    arrLen = buf.readUInt32BE(offset);
                    parsedBits += 4 * 8;
                }
                // console.log(`DltSomeIpPlugin.parseParameters coding ARRAY arrLen=${arrLen}'`);
                if (arrLen) {
                    if (coding) {
                        const offset = (bitOffset + parsedBits) >> 3;
                        if (((bitOffset + parsedBits) & 7) !== 0) {
                            console.error(`parseParametersBit array not at byte border: bitOffset=${bitOffset} parsedBits=${parsedBits}`);
                        }
                        const arrBuf = buf.slice(offset, offset + arrLen);
                        const valueArr: any[] = [];
                        let parsedArrBits = 0;
                        while ((parsedArrBits >> 3) < arrLen) {
                            let [parsed, valueObj] = this.parseSingleCoding(arrBuf, parsedArrBits, bitLength, coding);
                            if (!parsed) {
                                console.warn(`DltSomeIpPlugin.parseParameters parsing after ${parsedArrBits} / ${arrLen * 8} bits failed for coding ${coding.shortName} from ${datatype.shortName}`);
                                parsedArrBits = arrLen * 8;
                            } else {
                                if (datatype.enums && valueObj !== undefined) { // value an enum?
                                    const enumObj = datatype.enums.get(valueObj);
                                    if (enumObj) { valueObj = enumObj.synonym; }
                                }
                                valueArr.push(valueObj);
                                parsedArrBits += parsed;
                            }
                        }
                        objToRet = valueArr;
                    } else {
                        objToRet = [`err:no coding for ${JSON.stringify(datatype)}`];
                    }
                    parsedBits += (arrLen * 8); // todo check for max size?
                } else {
                    objToRet = [];
                }
            } else {
                //console.warn(` datatype.codingRef=${JSON.stringify(datatype.codingRef)}`);
                //console.warn(` datatype.coding=${JSON.stringify(coding)})`);
                if (coding) {
                    let [parsed, valueObj] = this.parseSingleCoding(buf, bitOffset, bitLength, coding);
                    if (datatype.enums && valueObj !== undefined) { // value an enum?
                        const enumObj = datatype.enums.get(valueObj);
                        if (enumObj) { valueObj = enumObj.synonym; }
                    }
                    objToRet = valueObj;
                    parsedBits = parsed;
                } else {
                    console.warn(`DltSomeIpPlugin.parseParameters no coding for datatype=${JSON.stringify(datatype)}`);
                }
            }
        }

        if (datatype.complexStructMembers) {
            if (arrayInfo) {
                if (arrayInfo.dim !== 1) { console.warn(`DltSomeIpPlugin.parseParameters struct with dim ${arrayInfo.dim} not supported yet!`); }
                // if (arrayInfo.minSize) { console.warn(`DltSomeIpPlugin.parseParameters struct with minSize ${arrayInfo.minSize} ${arrayInfo.maxSize} not supported yet!`); }
                let arrLen = 0;
                if (arrayInfo.minSize && arrayInfo.maxSize && arrayInfo.minSize === arrayInfo.maxSize) {
                    arrLen = arrayInfo.minSize;
                    if (arrayInfo.minSize) { console.warn(`DltSomeIpPlugin.parseParameters struct assuming fixed size array with const size ${arrayInfo.minSize}`); }
                } else {
                    const offset = (bitOffset + parsedBits) >> 3;
                    if (((bitOffset + parsedBits) & 7) !== 0) {
                        console.error(`parseParametersBit struct array start not at byte border: bitOffset=${bitOffset} parsedBits=${parsedBits}`);
                    }
                    arrLen = buf.readUInt32BE(offset);
                    parsedBits += 32;
                }
                if (arrLen) {
                    const offset = (bitOffset + parsedBits) >> 3;
                    if (((bitOffset + parsedBits) & 7) !== 0) {
                        console.error(`parseParametersBit array not at byte border: bitOffset=${bitOffset} parsedBits=${parsedBits}`);
                    }
                    const arrBuf = buf.slice(offset, offset + arrLen);
                    const valueArr: any[] = [];
                    let parsedArrBits = 0;
                    while ((parsedArrBits >> 3) < arrLen) {
                        let [parsed, valueObj] = this.parseSingleStruct(arrBuf, parsedArrBits, bitLength, datatype);
                        if (!parsed) {
                            console.warn(`DltSomeIpPlugin.parseParameters parsing after ${parsedArrBits} / ${arrLen * 8} bits failed for array of struct from ${datatype.shortName}`);
                            parsedArrBits = arrLen * 8;
                        } else {
                            parsedArrBits += parsed;
                            valueArr.push(valueObj);
                        }
                    }
                    objToRet = valueArr;
                    parsedBits += arrLen * 8;
                } else {
                    objToRet = [];
                }
            } else {
                const [parsed, valueObj] = this.parseSingleStruct(buf, bitOffset, bitLength, datatype);
                parsedBits += parsed;
                objToRet = valueObj;
            }
        } else if (datatype.complexUnionMembers) {
            // todo arrayInfo...
            if (arrayInfo) { console.warn(`DltSomeIpPlugin.parseParameters array of UNION`); }
            //console.warn(`DltSomeIpPlugin.parseParameters(bitOffset=${bitOffset}, datatype.shortName=${datatype.shortName})`);
            //console.warn(` datatype.complexUnionMembers=${JSON.stringify(datatype.complexUnionMembers)}, arrayInfo=${JSON.stringify(arrayInfo)})`);
            // todo nyi. parse length 32bit, type 32bit, data...
            const offset = (bitOffset + parsedBits) >> 3;
            if (((bitOffset + parsedBits) & 7) !== 0) {
                console.error(`parseParametersBit union start not at byte border: bitOffset=${bitOffset} parsedBits=${parsedBits}`);
            }
            const length = buf.readUInt32BE(offset);
            let parsedBytes = 4;
            const unionType = buf.readUInt32BE(offset + parsedBytes);
            parsedBytes += 4;
            // iterate through all members with fx:INDEX === unionType?
            let found = false;
            for (let i = 0; i < datatype.complexUnionMembers.length; ++i) {
                const unionInfo = datatype.complexUnionMembers[i];
                const fxIndex = unionInfo['fx:INDEX'];
                if (fxIndex === unionType) {
                    found = true;
                    const unionDatatype = FibexLoader.datatypes.get(unionInfo['fx:DATATYPE-REF']['@_ID-REF']);
                    if (unionDatatype) {
                        const [parsed, valueObj] = this.parseParameters(buf, offset + (parsedBytes * 8), undefined /*todo get from fx:UTIL...*/, unionDatatype, undefined);
                        objToRet = valueObj;
                        if (parsed !== (length << 3)) {
                            console.warn(` datatype.complexUnion=${JSON.stringify(unionInfo)} parsed ${parsed} expected ${length << 3}`);
                        }
                    } else {
                        console.warn(` datatype.complexUnion=${JSON.stringify(unionInfo)} without datatype!`);
                    }
                    break;
                }
            }
            if (!found) {
                console.warn(` datatype.complexUnion found no union member for unionType=${unionType} of : ${JSON.stringify(datatype)})`);
            }
            parsedBytes += length;
            parsedBits += parsedBytes * 8;
        }
        //console.warn(` parseParameters returning ${parsedBytes} ${JSON.stringify(objToRet)}`);
        return [parsedBits, objToRet];
    }


}
