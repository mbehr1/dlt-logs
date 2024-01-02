/* --------------------
 * Copyright(C) Matthias Behr.
 */

import * as vscode from 'vscode'
import * as assert from 'assert'
import { DltLifecycleInfo, DltLifecycleInfoMinIF } from './dltLifecycle'
import { DltFilter } from './dltFilter'
import { printableAscii, toHexString, RestObject } from './util'
import { DltTransformationPlugin } from './dltTransformationPlugin'

const DLT_STORAGE_HEADER_PATTERN: number = 0x01544c44 // DLT\01 0x444c5401
const DLT_STORAGE_HEADER_SIZE: number = 4 * 4
const MIN_STD_HEADER_SIZE: number = 1 + 1 + 2
const MIN_DLT_MSG_SIZE: number = DLT_STORAGE_HEADER_SIZE + MIN_STD_HEADER_SIZE
const DLT_EXT_HEADER_SIZE: number = 10
const MIN_PAYLOAD_ARG_LEN: number = 4

export enum MSTP {
  TYPE_LOG,
  TYPE_APP_TRACE,
  TYPE_NW_TRACE,
  TYPE_CONTROL,
}
export enum MTIN_LOG {
  LOG_FATAL = 1,
  LOG_ERROR,
  LOG_WARN,
  LOG_INFO,
  LOG_DEBUG,
  LOG_VERBOSE,
} // 7-15 reserved
export enum MTIN_TRACE {
  TRACE_VARIABLE = 1,
  TRACE_FUNCTION_IN,
  TRACE_FUNCTION_OUT,
  TRACE_STATE,
  TRACE_VFB,
}
export enum MTIN_NW {
  TRACE_IPC = 1,
  TRACE_CAN,
  TRACE_FLEXRAY,
  TRACE_MOST,
  TRACE_ETHERNET,
  TRACE_SOMEIP,
}
export enum MTIN_CTRL {
  CONTROL_REQUEST = 1,
  CONTROL_RESPONSE,
  CONTROL_TIME /* keep alive */,
}

// from dlt_viewer/dlt_common.c MPL2 license:
export const MSTP_strs: string[] = ['log', 'app_trace', 'nw_trace', 'control', '', '', '', '']
export const MTIN_LOG_strs: string[] = ['', 'fatal', 'error', 'warn', 'info', 'debug', 'verbose', '', '', '', '', '', '', '', '', '']
export const MTIN_TRACE_strs: string[] = ['', 'variable', 'func_in', 'func_out', 'state', 'vfb', '', '', '', '', '', '', '', '', '', '']
export const MTIN_NW_strs: string[] = ['', 'ipc', 'can', 'flexray', 'most', 'vfb', '', '', '', '', '', '', '', '', '', '']
export const MTIN_CTRL_strs: string[] = ['', 'request', 'response', 'time', '', '', '', '', '', '', '', '', '', '', '', '']
export const MTIN_CTRL_RESPONSE_strs: string[] = ['ok', 'not_supported', 'error', '', '', '', '', '', 'no_matching_context_id']

export enum CTRL_SERVICE_ID {
  GET_LOG_INFO = 0x03,
  GET_SW_VERSION = 0x13,
}
export const serviceIds: string[] = [
  '',
  'set_log_level',
  'set_trace_status',
  'get_log_info',
  'get_default_log_level',
  'store_config',
  'reset_to_factory_default',
  'set_com_interface_status',
  'set_com_interface_max_bandwidth',
  'set_verbose_mode',
  'set_message_filtering',
  'set_timing_packets',
  'get_local_time',
  'use_ecu_id',
  'use_session_id',
  'use_timestamp',
  'use_extended_header',
  'set_default_log_level',
  'set_default_trace_status',
  'get_software_version',
  'message_buffer_overflow',
]

// not covered:
/*
#define DLT_SERVICE_ID_UNREGISTER_CONTEXT             0xf01 < Service ID: Message unregister context
#define DLT_SERVICE_ID_CONNECTION_INFO                0xf02 < Service ID: Message connection info 
#define DLT_SERVICE_ID_TIMEZONE						  0xf03 < Service ID: Timezone
#define DLT_SERVICE_ID_MARKER						  0xf04 < Service ID: Timezone
#define DLT_SERVICE_ID_CALLSW_CINJECTION              0xFFF < Service ID: Message Injection (minimal ID)
*/

// map ecu/apid/ctids
export interface EAC {
  e: string
  a: string
  c: string
}

// we store it in one direction as a map idx -> EAC
// and in the other direction as a map(ECU) of map(APID) of map(CTID) -> idx
// so we store each combination exactly once.
// and allows us to store inside the DltMsg just one object reference
// we do so as we otherwise store lots of similar strings that use a high
// amount of memory... (3x24 bytes each vs. one reference)

const mapEAC: Map<number, EAC> = new Map()
const maprEAC: Map<string, Map<string, Map<string, number>>> = new Map()
let maxEAC: number = 0

export function getIdxFromEAC(eac: EAC): number {
  let eMap = maprEAC.get(eac.e)
  if (eMap === undefined) {
    eMap = new Map<string, Map<string, number>>()
    maprEAC.set(eac.e, eMap)
  }
  let aMap = eMap.get(eac.a)
  if (aMap === undefined) {
    aMap = new Map<string, number>()
    eMap.set(eac.a, aMap)
  }
  let idx = aMap.get(eac.c)
  if (idx !== undefined) {
    return idx
  } else {
    idx = ++maxEAC
    aMap.set(eac.c, idx)
    mapEAC.set(idx, eac)
    return idx
  }
}
export function getEACFromIdx(idx: number): EAC | undefined {
  const eac = mapEAC.get(idx)
  return eac
}

export interface FilterableDltMsg {
  timeStamp: number // timestamp_dms [deci=0.1 ms]
  mstp: number
  mtin: number
  //readonly mcnt: number,
  ecu: string
  apid: string
  ctid: string
  verbose: boolean
  payloadString: string
  lifecycle?: DltLifecycleInfoMinIF

  asRestObject(idHint: number): RestObject
}

export interface ViewableDltMsg extends FilterableDltMsg {
  receptionTimeInMs: number
  index: number
  mcnt: number
}

export class DltMsg implements FilterableDltMsg {
  readonly index: number // index/nr of this msg inside orig file/stream/buffer
  readonly receptionTimeInMs: number // time in ms. Date uses more memory!
  get timeAsDate(): Date {
    return new Date(this.receptionTimeInMs)
  }
  // todo could add this if e.g. some fba queries use that. get timeAsNumber(): number { return this.recordedTimeInMs; }

  // parsed from data:
  readonly mcnt: number
  private _htyp: number
  //readonly ecu: string; // this leads to lots of same strings. thus pointing to one object that has the ECU/APID/CTID combination
  get ecu(): string {
    return this._eac.e
  }
  readonly sessionId: number
  /* readonly rewrite msg plugin might change it */ timeStamp: number
  readonly verbose: boolean
  /* readonly non-verb. might change */ mstp: MSTP // message type from MSIN (message info)
  /* readonly non-verb. might change */ mtin: number // message type info from MSIN
  /* readonly non-verb. might change */ noar: number // number of arguments
  get apid(): string {
    return this._eac.a
  }
  get ctid(): string {
    return this._eac.c
  }
  get withEID(): boolean {
    return this._htyp & 0x04 ? true : false
  }
  private _eac: EAC
  /* non-verbose plugin ... private */ _payloadData: Buffer
  public _payloadArgs: Array<any> | undefined = undefined
  public /* no friend class ... DltSomeIpPlugin private*/ _payloadText: string | undefined = undefined
  private _transformCb: ((msg: DltMsg) => void) | undefined = undefined
  lifecycle: DltLifecycleInfoMinIF | DltLifecycleInfo | undefined = undefined
  decorations: Array<[vscode.TextEditorDecorationType, Array<vscode.DecorationOptions>]> = []

  get isBigEndian(): boolean {
    return this._htyp & 0x02 ? true : false
  }

  constructor(storageHeaderEcu: string, stdHdr: any, index: number, receptionTimeInMs: number, data: Buffer) {
    this.index = index
    this.receptionTimeInMs = receptionTimeInMs

    // the following code could be moved into a function to allow parallel/delayed processing
    this.mcnt = stdHdr['mcnt']
    this._htyp = stdHdr['htyp']
    // htyp:
    // 0x01 _UEH use extended header
    // 0x02 _MSBF // todo MSBF sounds like little Endian (most sign. byte first... but seems not)
    // 0x04 _WEID with ECU ID (first 4 byte after standard header)
    // 0x08 _WSID with session ID (next 4 byte after standard header)
    // 0x10 _WTMS with timestamp // in 0.1mi (next 4 byte after standard header)
    const useExtHeader: boolean = this._htyp & 0x01 ? true : false
    // const isBigEndian: boolean = (this._htyp & 0x02) ? true : false;
    const withEID: boolean = this._htyp & 0x04 ? true : false
    const withSID: boolean = this._htyp & 0x08 ? true : false
    const withTMS: boolean = this._htyp & 0x10 ? true : false

    let stdHeaderSize = MIN_STD_HEADER_SIZE

    const eac: any = {}
    if (withEID) {
      eac.e = dltParseChar4(data, DLT_STORAGE_HEADER_SIZE + stdHeaderSize)
      stdHeaderSize += 4
    } else {
      eac.e = storageHeaderEcu
    }
    if (withSID) {
      this.sessionId = data.readUInt32BE(DLT_STORAGE_HEADER_SIZE + stdHeaderSize)
      stdHeaderSize += 4
    } else {
      this.sessionId = 0
    }
    if (withTMS) {
      this.timeStamp = data.readUInt32BE(DLT_STORAGE_HEADER_SIZE + stdHeaderSize)
      stdHeaderSize += 4
    } else {
      this.timeStamp = 0
    }
    if (useExtHeader) {
      const extHeaderOffset = DLT_STORAGE_HEADER_SIZE + stdHeaderSize
      const extHeader = dltParseExtHeader(data, extHeaderOffset)
      this.verbose = extHeader.verb
      this.mstp = extHeader.mstp
      this.mtin = extHeader.mtin
      this.noar = extHeader.noar
      eac.a = extHeader.apid
      eac.c = extHeader.ctid
    } else {
      this.verbose = false
      this.mstp = 0
      this.mtin = 0
      this.noar = 0
      eac.a = ''
      eac.c = ''
    }
    this._eac = getEACFromIdx(getIdxFromEAC(eac)) || eac

    const payloadOffset = DLT_STORAGE_HEADER_SIZE + stdHeaderSize + (useExtHeader ? DLT_EXT_HEADER_SIZE : 0)
    this._payloadData = data.slice(payloadOffset)
    assert.equal(this._payloadData.byteLength, stdHdr['len'] - (payloadOffset - DLT_STORAGE_HEADER_SIZE))
    // we parse the payload only on demand
  }

  /**
   * set ECU, APID, CTID at once.
   * As the 3 strings are stored differently this method is provided.
   * @param e ECU
   * @param a APID
   * @param c CTID
   */
  setEAC(e: string, a: string, c: string) {
    const eac: EAC = {
      e: e,
      a: a,
      c: c,
    }
    this._eac = getEACFromIdx(getIdxFromEAC(eac)) || eac
  }

  asRestObject(idHint: number): RestObject {
    return {
      id: this.index,
      type: 'msg',
      attributes: {
        timeStamp: this.timeStamp,
        ecu: this.ecu,
        mcnt: this.mcnt,
        apid: this.apid,
        ctid: this.ctid,
        mtin: MTIN_LOG_strs[this.mtin],
        payloadString: this.payloadString,
        lifecycle: this.lifecycle ? this.lifecycle.persistentId : undefined,
      },
    }
  }

  get payloadArgs(): Array<any> {
    if (this._payloadArgs) {
      return this._payloadArgs
    } else {
      this._payloadText = ''
      // parse the payload:
      const isBigEndian: boolean = this._htyp & 0x02 ? true : false
      if (this._payloadData.byteLength < MIN_PAYLOAD_ARG_LEN) {
        // not <= as for TYPE_CONTROL msgs we do have 4 bytes only sometimes.
        this._payloadArgs = []
      } else {
        switch (this.mstp) {
          case MSTP.TYPE_NW_TRACE:
          case MSTP.TYPE_LOG:
            {
              if (this.verbose) {
                this._payloadArgs = []
                let argOffset: number = 0
                while (argOffset + 4 < this._payloadData.byteLength) {
                  const typeInfo: number = this._payloadData.readUInt32LE(argOffset)
                  argOffset += 4
                  const tyle: number = typeInfo & 0x0f // 1 = 8-bit, 5 = 128-bit, 0 undefined, rest reserved
                  const scod: number = (typeInfo >> 15) & 0x07 // 0 = ASCII, 1 = UTF8, rest reserved
                  const vari: boolean = (typeInfo & 0x800) > 0
                  const fixp: boolean = (typeInfo & 0x1000) > 0

                  if (typeInfo & 0x10) {
                    // type bool
                    assert(tyle === 1 || tyle === 0, `wrong tyle=${tyle} for boolean`)
                    assert(!(typeInfo & 0x100), 'no array support for boolean')
                    let v = this._payloadData.readUInt8(argOffset) ? true : false
                    this._payloadArgs.push(v)
                    this._payloadText += `${v ? 'true ' : 'false '}`
                    argOffset += 1
                  } else if (typeInfo & 0x20) {
                    // type SINT
                    assert(tyle >= 1 && tyle <= 5, `type SINT has unsupported tyle=${tyle} vari=${vari} fixp=${fixp}`)
                    assert(!(typeInfo & 0x100), 'no aray support for SINT')
                    switch (tyle) {
                      case 1:
                        this._payloadArgs.push(this._payloadData.readInt8(argOffset))
                        break
                      case 2:
                        this._payloadArgs.push(this._payloadData.readInt16LE(argOffset))
                        break // todo endianess
                      case 3:
                        this._payloadArgs.push(this._payloadData.readInt32LE(argOffset))
                        break // todo endianess
                      case 4:
                        this._payloadArgs.push(this._payloadData.readBigInt64LE(argOffset))
                        break // todo end.
                      case 5:
                        break // this._payloadArgs.push({ type: BigInt, v: this._payloadData.readBigUInt128LE(argOffset) }); break; // todo end.
                    }
                    this._payloadText += `${this._payloadArgs[this._payloadArgs.length - 1]} `
                    argOffset += 1 << (tyle - 1)
                  } else if (typeInfo & 0x40) {
                    // type UINT
                    assert(tyle >= 1 && tyle <= 5, `type UINT has unsupported tyle=${tyle}`)
                    assert(!(typeInfo & 0x100), 'no aray support for UINT')
                    switch (tyle) {
                      case 1:
                        this._payloadArgs.push(this._payloadData.readUInt8(argOffset))
                        break
                      case 2:
                        this._payloadArgs.push(this._payloadData.readUInt16LE(argOffset))
                        break // todo endianess
                      case 3:
                        this._payloadArgs.push(this._payloadData.readUInt32LE(argOffset))
                        break // todo endianess
                      case 4:
                        this._payloadArgs.push(this._payloadData.readBigUInt64LE(argOffset))
                        break // todo end.
                      case 5:
                        break // this._payloadArgs.push({ type: BigInt, v: this._payloadData.readBigUInt128LE(argOffset) }); break; // todo end.
                    }
                    this._payloadText += `${this._payloadArgs[this._payloadArgs.length - 1]} `
                    argOffset += 1 << (tyle - 1)
                  } else if (typeInfo & 0x80) {
                    // type FLOA
                    assert(!(typeInfo & 0x100), 'no aray support for FLOA')
                    switch (tyle) {
                      case 3: // single 32bit
                        this._payloadArgs.push(this._payloadData.readFloatLE(argOffset)) // todo endianess
                        argOffset += 4
                        break
                      case 4: // double 64bit
                        this._payloadArgs.push(this._payloadData.readDoubleLE(argOffset)) // todo endianess
                        argOffset += 8
                        break
                      default:
                        console.log(`todo impl FLOA parsing for tyle=${tyle}`)
                        break
                    }
                    this._payloadText += `${this._payloadArgs[this._payloadArgs.length - 1]} `
                  } else if (typeInfo & 0x100) {
                    // type ARAY but it might be used with flags already...
                    /*                                    const nrDims: number = this._payloadData.readUInt16LE(argOffset);
                                                                        argOffset += 2;
                                                                        for (let i = 0; i < nrDims; ++i) {
                                                                            const nrEntries = this._payloadData.readUInt16LE(argOffset);
                                                                            argOffset += 2;*/
                    console.log(
                      `todo impl ARAY parsing typeInfo=${typeInfo.toString(16)} noar=${this.noar} apid=${this.apid} ctid=${this.ctid}`,
                    )

                    break
                  } else if (typeInfo & 0x200) {
                    // type STRG
                    const strLenInclTerm: number = this._payloadData.readUInt16LE(argOffset)
                    argOffset += 2
                    if (strLenInclTerm > 0 && strLenInclTerm < 2000) {
                      // some sanity check...
                      const gotTerm = this._payloadData[argOffset + strLenInclTerm - 1] === 0 ? 1 : 0
                      let strText = this._payloadData.toString(
                        scod === 1 ? 'utf8' : 'latin1',
                        argOffset,
                        argOffset + strLenInclTerm - gotTerm,
                      )
                      // replace CRLF with ' '
                      // todo assemble payloadAsText ... msgText += strText.replace(/(\r\n|\n|\r)/gm, " "); // this is slow...
                      const needStr = this.noar === 3 || this.noar === 5 || this.noar === 8 ? true : false
                      this._payloadArgs.push(needStr ? strText : null) // todo need to get rid of this to reduce mem load. dltFileTransfer plugin uses it...
                      this._payloadText += `${strText.replace(/\r?\n|\r/g, ' ')} `
                    } else {
                      console.log('ignored strlen due to sanity check!')
                    }
                    argOffset += strLenInclTerm
                  } else if (typeInfo & 0x400) {
                    // RAWD
                    const lenRaw: number = this._payloadData.readUInt16LE(argOffset)
                    argOffset += 2
                    const rawd = this._payloadData.slice(argOffset, argOffset + lenRaw)
                    this._payloadArgs.push(Buffer.from(rawd)) // we make a copy here to avoid referencing the payloadData that we want to release/gc afterwards
                    this._payloadText += rawd.toString('hex')
                    argOffset += lenRaw
                  } else {
                    break
                  } // todo VARI, FIXP, TRAI, STRU
                }
                assert.strictEqual(argOffset, this._payloadData.byteLength, "didn't process all payloadData") // all data processed
                assert.strictEqual(this.noar, this._payloadArgs.length, 'noars != payloadArgs.length')
                //this._payloadArgs = []; // todo to see how much faster it gets
              } else {
                // !verbose
                this._payloadArgs = []
                const payloadLen = this._payloadData.length
                if (payloadLen >= 4) {
                  const messageId: number = this.isBigEndian ? this._payloadData.readUInt32BE(0) : this._payloadData.readUInt32LE(0)
                  // store the orig data as well for the non-verbose plugin
                  // todo or let the non-verbose plugin process before?
                  this._payloadArgs.push(messageId)
                  const nvPayload = this._payloadData.slice(4)
                  this._payloadArgs.push(Buffer.from(nvPayload)) // create a copy here as the reference might be a huge mem block
                  // output in the same form as dlt viewer:
                  this._payloadText += `[${messageId}] ${printableAscii(nvPayload)}|${toHexString(nvPayload)}`
                }
                break
              }
            }
            break
          case MSTP.TYPE_CONTROL:
            {
              const serviceId = isBigEndian ? this._payloadData.readUInt32BE(0) : this._payloadData.readUInt32LE(0)
              this._payloadArgs = []
              if (this.noar >= 1) {
                this._payloadArgs.push(serviceId)
                if (serviceId > 0 && serviceId < serviceIds.length) {
                  this._payloadText += serviceIds[serviceId]
                } else {
                  this._payloadText += `service(${serviceId})`
                }
                if (this._payloadData.length > 4) {
                  // response code?
                  let remOffset = 4
                  if (this.mtin === MTIN_CTRL.CONTROL_RESPONSE) {
                    // 1 byte resp. code
                    const respCode = this._payloadData.readUInt8(remOffset)
                    if (respCode <= 3 || respCode === 8) {
                      this._payloadText += `, ${MTIN_CTRL_RESPONSE_strs[respCode]}`
                    } else {
                      this._payloadText += `, ${String(respCode.toString(16)).padStart(2, '0')}`
                    }
                    remOffset++
                    switch (serviceId) {
                      case CTRL_SERVICE_ID.GET_LOG_INFO:
                        {
                          // response status:uint8, applicationIds, reserved
                          switch (respCode) {
                            case 3:
                            case 4:
                            case 5:
                            case 6:
                            case 7: // info about reg. appids and ctids with log level and trace status info and all text. descr.
                              {
                                // todo could use few binaryparser here...
                                const hasLogLevel: boolean = respCode === 4 || respCode === 6 || respCode === 7
                                const hasTraceStatus: boolean = respCode === 5 || respCode === 6 || respCode === 7
                                const hasDescr: boolean = respCode === 7
                                if (this._payloadData.length - remOffset >= 2 + (hasDescr ? 2 : 0)) {
                                  const nrApids = isBigEndian
                                    ? this._payloadData.readUInt16BE(remOffset)
                                    : this._payloadData.readUInt16LE(remOffset)
                                  remOffset += 2
                                  const apids = []
                                  for (let a = 0; a < nrApids; ++a) {
                                    if (this._payloadData.length - remOffset < 6) {
                                      break
                                    }
                                    const apid = dltParseChar4(this._payloadData, remOffset)
                                    remOffset += 4
                                    const nrCtids = isBigEndian
                                      ? this._payloadData.readUInt16BE(remOffset)
                                      : this._payloadData.readUInt16LE(remOffset)
                                    remOffset += 2
                                    const ctids = []
                                    for (let c = 0; c < nrCtids; ++c) {
                                      if (
                                        this._payloadData.length - remOffset <
                                        4 + (hasLogLevel ? 1 : 0) + (hasTraceStatus ? 1 : 0) + (hasDescr ? 2 : 0)
                                      ) {
                                        break
                                      }
                                      const ctid = dltParseChar4(this._payloadData, remOffset)
                                      remOffset += 4
                                      let logLevel: number = 0xff
                                      if (hasLogLevel) {
                                        logLevel = this._payloadData.readUInt8(remOffset)
                                        remOffset += 1
                                      }
                                      let traceStatus: number = 0xff
                                      if (hasTraceStatus) {
                                        traceStatus = this._payloadData.readUInt8(remOffset)
                                        remOffset += 1
                                      }
                                      let ctDescLen: number = 0
                                      if (hasDescr) {
                                        ctDescLen = isBigEndian
                                          ? this._payloadData.readUInt16BE(remOffset)
                                          : this._payloadData.readUInt16LE(remOffset)
                                        remOffset += 2
                                      }
                                      this._payloadText += ` ctid:'${ctid}'(`
                                      let ctDesc = ''
                                      if (ctDescLen && this._payloadData.length - remOffset >= ctDescLen) {
                                        ctDesc = printableAscii(this._payloadData.slice(remOffset, remOffset + ctDescLen))
                                        this._payloadText += ctDesc
                                        remOffset += ctDescLen
                                      }
                                      ctids.push({ ctid: ctid, desc: ctDesc })
                                      this._payloadText += `)`
                                      if (hasLogLevel) {
                                        this._payloadText += ` log level=${logLevel.toString(16)}`
                                      }
                                      if (hasTraceStatus) {
                                        this._payloadText += ` trace status=${traceStatus.toString(16)}`
                                      }
                                    }
                                    let aDescLen: number = 0
                                    if (hasDescr) {
                                      aDescLen = isBigEndian
                                        ? this._payloadData.readUInt16BE(remOffset)
                                        : this._payloadData.readUInt16LE(remOffset)
                                      remOffset += 2
                                    }
                                    let aDesc = ''
                                    this._payloadText += ` apid:'${apid}'(`
                                    if (aDescLen && this._payloadData.length - remOffset >= aDescLen) {
                                      aDesc = printableAscii(this._payloadData.slice(remOffset, remOffset + aDescLen))
                                      this._payloadText += aDesc
                                      remOffset += aDescLen
                                    }
                                    this._payloadText += `) `
                                    apids.push({ apid: apid, ctids: ctids, desc: aDesc })
                                  }
                                  this._payloadArgs.push(apids)
                                }
                                remOffset += 4 // skip reserved (request handle alike)
                              }
                              break
                          }
                        }
                        break
                      case CTRL_SERVICE_ID.GET_SW_VERSION: // 2nd param uint32 len, 3, sw version
                        {
                          if (this._payloadData.length - remOffset >= 4) {
                            const swVersionLen = isBigEndian
                              ? this._payloadData.readUInt32BE(remOffset)
                              : this._payloadData.readUInt32LE(remOffset)
                            remOffset += 4
                            if (swVersionLen) {
                              this._payloadText += `,${printableAscii(this._payloadData.slice(remOffset, remOffset + swVersionLen))}`
                              remOffset += swVersionLen
                            }
                          }
                        }
                        break
                      default:
                        break
                    }
                  }
                  if (this._payloadData.length - remOffset > 0) {
                    const rawd = this._payloadData.slice(remOffset)
                    this._payloadText += ', ' + rawd.toString('hex') // todo dlt viewer writes them with , and sep. by space e.g. [get_software_version] 3a 00 ...
                  }
                }
              } else {
                console.log(
                  `CONTROL_MSG with noar=${this.noar} and serviceId=${serviceId}: payloadData=${toHexString(this._payloadData.slice(4))}`,
                )
              }
              // we dont really parse all args. so if noars < #payloadArgs ignore it for now.
              // e.g. some logger send CTRL REQ with no args equal to the params (e.g. serviceId=0x11, noar=2,  "04  00 00 00 00")
              // assert.ok(this.noar <= this._payloadArgs.length, "TYPE_CONTROL noars > payloadArgs.length"); // for some (e.g. get_log_info) we add more payloadArgs
            }
            break
          default:
            console.log(`payloadArgs for type ${this.mstp} not impl. yet. todo`)
            this._payloadArgs = []
        }
        if (this._payloadText.endsWith(' ')) {
          this._payloadText = this._payloadText.slice(0, -1)
        } // this is not quite right. if ' ' was part of the payload text...
      }
      this._payloadText = Buffer.from(this._payloadText).toString() // reduce the number of strings...
      this._payloadData = DltMsg.emptyBuffer // can only be called once
      return this._payloadArgs
    }
  }

  static emptyBuffer: Buffer = Buffer.alloc(0)

  get payloadString(): string {
    let toRet
    if (this._payloadText !== undefined) {
      // cached already?
      toRet = this._payloadText
    } else {
      this.payloadArgs // this updates payloadText as well

      if (this._payloadText === undefined) {
        this._payloadText = ''
      }
      toRet = this._payloadText
    }
    // is a transformCb set? if so call it so allow to change data (e.g. _payloadText)
    if (this._transformCb) {
      this._transformCb(this)
      this._transformCb = undefined
      toRet = this._payloadText
    }
    return toRet
  }

  set transformCb(cb: (msg: DltMsg) => void) {
    // .payloadArgs is called before (e.g. by filetransfer plugin) assert(this._payloadText === undefined, 'logical error. transformCb called too late!');
    // can always be called assert(this._payloadData !== DltMsg.emptyBuffer, 'logical error. transformCb called too late!');
    this._transformCb = cb
  }
}

/*
    some manual parser functions */

export function dltParseChar4(buffer: Buffer, offset: number = 0): string {
  let endIdx = offset + 4
  while (endIdx > offset && buffer[endIdx - 1] === 0x0) {
    endIdx--
  }
  return buffer.toString('ascii', offset, endIdx)
}

export function dltWriteChar4(buffer: Buffer, offset: number, char4: string) {
  buffer.write(char4.padEnd(4, '\0'), offset, 4, 'ascii')
}

interface DltStorageHeader {
  pattern: number
  secs: number
  micros: number
  ecu: string
}

function dltParseStorageHeader(buffer: Buffer, offset: number): DltStorageHeader {
  return {
    pattern: buffer.readUInt32LE(offset),
    secs: buffer.readUInt32LE(offset + 4),
    micros: buffer.readInt32LE(offset + 8),
    ecu: dltParseChar4(buffer, offset + 12),
  }
}

function dltWriteStorageHeader(buffer: Buffer, offset: number, header: DltStorageHeader) {
  buffer.writeUInt32LE(header.pattern, offset)
  buffer.writeUInt32LE(header.secs, offset + 4)
  buffer.writeInt32LE(header.micros, offset + 8)
  dltWriteChar4(buffer, offset + 12, header.ecu)
}

interface DltStdHeader {
  htyp: number
  mcnt: number
  len: number
  ecu?: string
  timeStamp?: number
}
function dltParseStdHeader(buffer: Buffer, offset: number): DltStdHeader {
  return {
    htyp: buffer.readUInt8(offset),
    mcnt: buffer.readUInt8(offset + 1),
    len: buffer.readUInt16BE(offset + 2),
  }
}

function dltWriteStdHeader(buffer: Buffer, offset: number, stdH: DltStdHeader): number {
  buffer.writeUInt8(stdH.htyp, offset)
  buffer.writeUInt8(stdH.mcnt, offset + 1)
  buffer.writeUInt16BE(stdH.len, offset + 2)
  const withEID: boolean = stdH.htyp & 0x04 ? true : false
  const withSID: boolean = stdH.htyp & 0x08 ? true : false
  const withTMS: boolean = stdH.htyp & 0x10 ? true : false
  let nextOff = offset + 4
  if (withEID) {
    dltWriteChar4(buffer, nextOff, stdH.ecu !== undefined ? stdH.ecu : 'UNKN')
    nextOff += 4
  }
  if (withSID) {
    buffer.writeUInt32BE(0, nextOff) // todo
    nextOff += 4
  }
  if (withTMS) {
    buffer.writeUInt32BE(stdH.timeStamp !== undefined ? stdH.timeStamp : 0, nextOff)
    nextOff += 4
  }
  return nextOff - offset
}

interface DltExtHeader {
  verb: boolean
  mstp: number
  mtin: number
  noar: number
  apid: string
  ctid: string
}
function dltParseExtHeader(buffer: Buffer, offset: number): DltExtHeader {
  const tmp = buffer.readUInt8(offset)
  return {
    verb: tmp & 1 ? true : false,
    mstp: (tmp >> 1) & 0x7,
    mtin: (tmp >> 4) & 0xf,
    noar: buffer.readUInt8(offset + 1),
    apid: dltParseChar4(buffer, offset + 2),
    ctid: dltParseChar4(buffer, offset + 6),
  }
}
function dltWriteExtHeader(buffer: Buffer, offset: number, extH: DltExtHeader) {
  buffer.writeUInt8((extH.verb ? 1 : 0) + (extH.mstp << 1) + (extH.mtin << 4), offset)
  buffer.writeUInt8(extH.noar, offset + 1)
  dltWriteChar4(buffer, offset + 2, extH.apid)
  dltWriteChar4(buffer, offset + 6, extH.ctid)
}

export class DltParser {
  /**
   * check whether a DLT storage header pattern is at that position:
   * @param buf Buffer with the payload
   * @param offset offset where to search for the DltStorageHeader. Needs to be >= 0.
   * @returns true if the DLT_STORAGE_HEADER_PATTERN is found at that position. False otherwise.
   * If the offset is >= end of buffer (-4) false is returned.
   */
  static validHeaderAt(buf: Buffer, offset: number): boolean {
    if (offset > buf.byteLength - 4) {
      return false
    }
    return buf.readUInt32LE(offset) === DLT_STORAGE_HEADER_PATTERN
  }

  /**
   *
   * @param buf Buffer with payload
   * @param startOffset offset to start searching
   * @param endOffset offset where to stop searching. not included
   */
  static patternWithin(buf: Buffer, startOffset: number, endOffset: number): boolean {
    for (let i = startOffset; i < endOffset; ++i) {
      if (DltParser.validHeaderAt(buf, i)) {
        return true
      }
    }
    return false
  }

  parseDltFromBuffer(
    buf: Buffer,
    startOffset: number,
    msgs: Array<DltMsg>,
    options: { transformPlugins?: DltTransformationPlugin[] } | undefined,
    posFilters?: DltFilter[],
    negFilters?: DltFilter[],
    negBeforePosFilters?: DltFilter[],
    msgOffsets?: number[],
    msgLengths?: number[],
  ) {
    // todo make async
    let skipped: number = 0
    let remaining: number = buf.byteLength - startOffset
    let nrMsgs: number = 0
    let offset = startOffset
    const startIndex: number = msgs.length ? msgs[msgs.length - 1].index + 1 : 0 // our first index to use is either prev one +1 or 0 as start value
    const transformPlugins: DltTransformationPlugin[] = options?.transformPlugins || []
    while (remaining >= MIN_DLT_MSG_SIZE) {
      const storageHeader = dltParseStorageHeader(buf, offset)
      if (storageHeader.pattern === DLT_STORAGE_HEADER_PATTERN) {
        const msgOffset = offset
        offset += DLT_STORAGE_HEADER_SIZE
        const receptionTimeInMs = storageHeader.secs * 1000 + storageHeader.micros / 1000
        const stdHeader = dltParseStdHeader(buf, offset)
        // do we have the remaining data in buf?
        const len: number = stdHeader.len
        // assert(len >= 0);
        if (remaining - (offset + len - msgOffset) >= 0) {
          // before treating this message as ok we do one more check/heuristic:
          // check 1: does the next message (storageHeader.pattern) start after this msg?
          //  if yes -> ok
          //  if no -> check whether there is a new storageHeader.pattern within the frame.
          //  if there is -> skip this msg as corrupt
          // todo could add more heuristics like times completely off,...
          // would be better if we could do these checks before the remaining - ... >= 0 (even at the end of the remaining...)
          let seemsInvalid = false

          // seems invalid check 1:
          if (
            !DltParser.validHeaderAt(buf, offset + len) &&
            DltParser.patternWithin(buf, offset - DLT_STORAGE_HEADER_SIZE + 1, offset + len)
          ) {
            seemsInvalid = true
          }

          if (seemsInvalid) {
            console.warn(
              `DltParser skipped a potential msg as it seemed invalid. Msg would have len=${len} storageHeader=${JSON.stringify(
                storageHeader,
              )} stdHeader=${JSON.stringify(stdHeader)} remaining=${remaining}`,
            )
            // skip by just one byte
            offset -= DLT_STORAGE_HEADER_SIZE
            offset++
            skipped++
            remaining--
            // todo incr. nrMsgs? dltviewer seems to do so
          } else {
            offset += len

            if (len >= MIN_STD_HEADER_SIZE) {
              try {
                const newMsg = new DltMsg(
                  storageHeader.ecu,
                  stdHeader,
                  startIndex + nrMsgs,
                  receptionTimeInMs,
                  buf.slice(msgOffset, offset),
                )
                // do we need to filter this one?
                let keepAfterNegBeforePosFilters: boolean = true
                if (negBeforePosFilters?.length) {
                  for (let i = 0; i < negBeforePosFilters.length; ++i) {
                    if (negBeforePosFilters[i].matches(newMsg)) {
                      keepAfterNegBeforePosFilters = false
                      break
                    }
                  }
                }

                if (keepAfterNegBeforePosFilters) {
                  // we apply transformation plugins only now (not before negBeforePosFilters)
                  for (let i = 0; i < transformPlugins.length; ++i) {
                    const transformPlugin = transformPlugins[i]
                    if (transformPlugin.matches(newMsg)) {
                      // add callback
                      newMsg.transformCb = transformPlugin.getTransformCb()
                      if (!transformPlugin.changesOnlyPayloadString()) {
                        // we apply it already here:
                        newMsg.payloadString // todo find a better way than the indirect payloadString...
                        // this removes the transformCb again...
                      }
                    }
                  }

                  let foundAfterPosFilters: boolean = posFilters?.length ? false : true
                  if (posFilters?.length) {
                    // check the pos filters, break on first match:
                    for (let i = 0; i < posFilters.length; ++i) {
                      if (posFilters[i].matches(newMsg)) {
                        foundAfterPosFilters = true
                        break
                      }
                    }
                  }
                  let foundAfterNegFilters: boolean = foundAfterPosFilters
                  if (foundAfterNegFilters && negFilters?.length) {
                    // check the neg filters, break on first match:
                    for (let i = 0; i < negFilters.length; ++i) {
                      if (negFilters[i].matches(newMsg)) {
                        foundAfterNegFilters = false
                        break
                      }
                    }
                  }
                  if (foundAfterNegFilters) {
                    msgs.push(newMsg)
                    if (msgOffsets) {
                      msgOffsets.push(msgOffset)
                    }
                    if (msgLengths) {
                      msgLengths.push(offset - msgOffset)
                    }
                    nrMsgs++ // todo or should we always keep the orig index here?
                  }
                }
              } catch (err) {
                // most likely not enough data for the DltMsg constructor
                console.log(`constructing DltMsg failed with: '${err}'`)
                skipped += len
              }
            } else {
              skipped += len
              console.log(
                `got a STORAGE_HEADER with len < MIN_STD_HEADER_SIZE! Skipped len=${len} storageHeader=${JSON.stringify(
                  storageHeader,
                )} stdHeader=${JSON.stringify(stdHeader)} remaining=${remaining}`,
              )
            }
            remaining -= offset - msgOffset
          }
        } else {
          break
        }
      } else {
        offset++
        skipped++
        remaining--
      }
    }
    return [skipped, remaining, nrMsgs]
  }
}

export function createStorageMsgAsBuffer(msgParams: {
  time: number
  timeStamp: number
  mstp: MSTP
  mtin: number
  serviceId?: number
  ecu: string
  apid: string
  ctid: string
  text: string
}): Buffer {
  // todo dirty function to create a msg...
  const buf = Buffer.alloc(0xffff) // we are lazy and use a big enough buffer instead of calc. the proper size
  const storageHeader: DltStorageHeader = {
    pattern: DLT_STORAGE_HEADER_PATTERN,
    ecu: msgParams.ecu,
    secs: Math.floor(msgParams.time / 1000),
    micros: Math.floor((msgParams.time % 1000) * 1000),
  }
  const stdHeader: DltStdHeader = {
    htyp: 0x01 + 0x04 + 0x10, // useExtHeader|withEID|withTMS
    mcnt: 0,
    len: 0, // will be updated later
    ecu: msgParams.ecu,
    timeStamp: msgParams.timeStamp,
  }
  const extH: DltExtHeader = {
    verb: true,
    mstp: msgParams.mstp,
    mtin: msgParams.mtin,
    noar: 1,
    apid: msgParams.apid,
    ctid: msgParams.ctid,
  }

  dltWriteStorageHeader(buf, 0, storageHeader)
  const stdHeaderSize = dltWriteStdHeader(buf, DLT_STORAGE_HEADER_SIZE, stdHeader)
  dltWriteExtHeader(buf, DLT_STORAGE_HEADER_SIZE + stdHeaderSize, extH)

  let nextOff = DLT_STORAGE_HEADER_SIZE + stdHeaderSize + DLT_EXT_HEADER_SIZE
  // write payload...
  if (extH.mstp === MSTP.TYPE_LOG) {
    buf.writeUInt32LE(0x200 + (1 << 15), nextOff) // type info STRG scod UTF8
    nextOff += 4
    buf.writeUInt16LE(msgParams.text.length + 1, nextOff) // strLenInclTerm
    nextOff += 2
    nextOff += buf.write(msgParams.text, nextOff, 'utf8')
    buf.writeUInt8(0, nextOff)
    nextOff += 1
  } else if (extH.mstp === MSTP.TYPE_CONTROL) {
    const serviceId = msgParams.serviceId !== undefined ? msgParams.serviceId : 0xff42ff42
    buf.writeUInt32LE(serviceId, nextOff)
    nextOff += 4
    buf.writeUInt32LE(msgParams.text.length + 1, nextOff) // data length
    nextOff += 4
    nextOff += buf.write(msgParams.text, nextOff, 'ascii')
    buf.writeUInt8(0, nextOff)
    nextOff += 1
  }
  // need to update the len in stdHeader...
  stdHeader.len = nextOff - DLT_STORAGE_HEADER_SIZE
  dltWriteStdHeader(buf, DLT_STORAGE_HEADER_SIZE, stdHeader)

  return buf.slice(0, nextOff)
}
