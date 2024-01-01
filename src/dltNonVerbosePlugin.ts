/* --------------------
 * Copyright(C) Matthias Behr. 2021
 *
 * todos:
 * - parse fx:ECUS, APID/CTID desc,...
 * - add sw version info
 * - support multiple sw version and pick the proper one...
 * - add header info to tooltip of message (non verbose id...)
 * - update docs
 */

import * as vscode from 'vscode'
import { TreeViewNode } from './dltTreeViewNodes'
import { DltMsg, MSTP, MTIN_LOG, MTIN_NW } from './dltParser'
import { createUniqueId } from './util'
import { DltTransformationPlugin } from './dltTransformationPlugin'
import { FibexLoader } from './fibexLoader'

export class DltNonVerbosePlugin extends DltTransformationPlugin {
  private static encodingMap = {
    S_STRG_ASCII: 'ascii' as BufferEncoding,
    S_STRG_UTF8: 'utf8' as BufferEncoding,
    S_RAWD: 'hex' as BufferEncoding,
    S_RAW: 'hex' as BufferEncoding,
  }

  private _servicesNode: TreeViewNode | undefined

  constructor(
    uri: vscode.Uri,
    public treeViewNode: TreeViewNode,
    treeEventEmitter: vscode.EventEmitter<TreeViewNode | null>,
    options: any,
  ) {
    super(uri, treeViewNode, treeEventEmitter, options)
    this._boundTransformCb = this.transformCb.bind(this)

    console.warn(`DltNonVerbosePlugin (enabled=${this.enabled}, fibexDir = ${JSON.stringify(options['fibexDir'])})`)

    if (!this.enabled) {
      this.treeViewNode.tooltip = `disabled`
    }

    // open xml files...
    if (this.enabled) {
      const ownFibexDir =
        'fibexDir' in options && typeof options['fibexDir'] === 'string' && options['fibexDir'].length ? options['fibexDir'] : undefined
      if (ownFibexDir) {
        FibexLoader.loadAllFibex(options['fibexDir']) // ignores any that are already loaded
        this.treeViewNode.tooltip = `loaded ${FibexLoader.loadedFibex.length} FIBEX files:\n${FibexLoader.loadedFibex.join('\n')}`
      } else {
        if (FibexLoader.loadedFibex.length >= 1) {
          this.treeViewNode.tooltip = `reusing loaded ${FibexLoader.loadedFibex.length} FIBEX files:\n${FibexLoader.loadedFibex.join('\n')}`
        } else {
          this.treeViewNode.tooltip = `no fibexDir set nether from here nor from SomeIP plugin!`
        }
      }
    }
    // we're only interested in frames starting with id "ID_":
    const idFrames = Array.from(FibexLoader.framesWithKey.keys()).filter((v) => v.startsWith('ID_'))
    this._servicesNode = {
      id: createUniqueId(),
      label: `Frames (${idFrames.length}/${FibexLoader.framesWithKey.size})`,
      children: [],
      parent: treeViewNode,
      tooltip: '',
      uri: uri,
    }
    treeViewNode.children.push(this._servicesNode)
    // add frames:
    idFrames.forEach((id) => {
      const frame = FibexLoader.framesWithKey.get(id)
      if (frame) {
        const pduTexts: string[] = frame.pdus.map(
          (p) => `${p.desc && p.desc.length > 0 ? `'${p.desc}'` : p.signalRefs?.map((s) => `<${s}>`).join(' ')}`,
        )

        const frameNode: TreeViewNode = {
          id: createUniqueId(),
          label: `${frame.id} apid:${frame.manufacturerExt?.APPLICATION_ID} ctid:${frame.manufacturerExt?.CONTEXT_ID} Len:${frame.byteLength} MT:${frame.manufacturerExt?.MESSAGE_TYPE} MI:${frame.manufacturerExt?.MESSAGE_INFO}`,
          tooltip: `Frame Id: ${frame.id} ${frame.shortName} ${frame.pdus.length} PDUs:\n${pduTexts.join('\n')}`,
          uri: uri,
          children: [],
          parent: this._servicesNode!,
        }
        this._servicesNode!.children.push(frameNode)
      }
    })

    this._treeEventEmitter.fire(this.treeViewNode)
  }

  get name(): string {
    return `${this.enabled ? '' : 'disabled: '}plugin non-verbose`
  }

  changesOnlyPayloadString(): boolean {
    return false
  }

  matches(msg: DltMsg): boolean {
    if (!this.enabled) {
      return false
    }

    if (msg.verbose) {
      return false
    }
    if (msg.mstp === MSTP.TYPE_CONTROL) {
      return false
    } // todo later on TYPE_INFO... is still assumed

    // do we know the frame?
    // here the _payloadData still exists... todo refactor this. that's not nice.
    const id =
      msg._payloadData.length >= 4
        ? `ID_${msg.isBigEndian ? msg._payloadData.readUInt32BE(0) : msg._payloadData.readUInt32LE(0)}`
        : undefined
    if (id !== undefined) {
      const msgApid = msg.apid
      const msgCtid = msg.ctid
      const frame =
        msgApid.length > 0 && msgCtid.length > 0 ? FibexLoader.framesWithKey.get(`${id},${msgApid},${msgCtid}`) : FibexLoader.frames.get(id)
      return frame !== undefined
    }
    return false
  }

  transformCb(msg: DltMsg) {
    try {
      //console.warn(`DltNonVerbosePlugin transformCb: msg.apid/ctid='${msg.apid}'/'${msg.ctid}'`);
      // identify the message id:
      // and modify the msg._payloadText if we find the infos
      const isBigEndian = msg.isBigEndian
      if (msg._payloadArgs && msg._payloadArgs.length === 2) {
        const id = `ID_${msg._payloadArgs[0]}`
        const msgApid = msg.apid
        const msgCtid = msg.ctid
        const frame =
          msgApid.length > 0 && msgCtid.length > 0
            ? FibexLoader.framesWithKey.get(`${id},${msgApid},${msgCtid}`)
            : FibexLoader.frames.get(id)
        if (frame !== undefined) {
          //console.warn(`DltNonVerbosePlugin.transformCb found frame ${frame.id} '${frame.shortName}' ${JSON.stringify(frame)}`);
          const payload = msg._payloadArgs[1]
          let text = ''
          if (payload?.constructor === Buffer) {
            const buf: Buffer = payload
            if (buf.length !== frame.byteLength) {
              console.warn(`DltNonVerbosePlugin frame ${frame.id} '${frame.shortName} 'byteLength ${buf.length}!=${frame.byteLength}!`)
            } else {
              const manufExt = frame.manufacturerExt
              if (manufExt) {
                msg.noar = frame.pdus.length
                switch (manufExt.MESSAGE_TYPE) {
                  case 'DLT_TYPE_LOG':
                    msg.mstp = MSTP.TYPE_LOG
                    break
                  case 'DLT_TYPE_APP_TRACE':
                    msg.mstp = MSTP.TYPE_APP_TRACE
                    break
                  case 'DLT_TYPE_NW_TRACE':
                    msg.mstp = MSTP.TYPE_NW_TRACE
                    break
                  case 'DLT_TYPE_CONTROL':
                    msg.mstp = MSTP.TYPE_CONTROL
                    break
                  default:
                    break
                }
                const apid = manufExt.APPLICATION_ID
                const ctid = manufExt.CONTEXT_ID
                const level = manufExt.MESSAGE_INFO
                let doSet = false
                if (apid && msgApid.length === 0) {
                  doSet = true
                }
                if (ctid && msgCtid.length === 0) {
                  doSet = true
                }
                if (doSet) {
                  msg.setEAC(msg.ecu, apid ? apid : msgApid, ctid ? ctid : msgCtid)
                }
                if (msg.mstp === MSTP.TYPE_LOG) {
                  switch (level) {
                    case 'DLT_LOG_INFO':
                      msg.mtin = MTIN_LOG.LOG_INFO
                      break
                    case 'DLT_LOG_ERROR':
                      msg.mtin = MTIN_LOG.LOG_ERROR
                      break
                    case 'DLT_LOG_WARN':
                      msg.mtin = MTIN_LOG.LOG_WARN
                      break
                    case 'DLT_LOG_FATAL':
                      msg.mtin = MTIN_LOG.LOG_FATAL
                      break
                    case 'DLT_LOG_DEBUG':
                      msg.mtin = MTIN_LOG.LOG_DEBUG
                      break
                    case 'DLT_LOG_VERBOSE':
                      msg.mtin = MTIN_LOG.LOG_VERBOSE
                      break
                    case 'DLT_LOG_DEFAULT':
                    case 'DLT_LOG_OFF':
                    default:
                      console.warn(`DltNonVerbosePlugin frame ${frame.id} unknown level: '${level}'`)
                      break
                  }
                } else {
                  console.warn(`DltNonVerbosePlugin frame ${frame.id} unsupported mstp for level: '${msg.mstp}' '${level}'`)
                }
              }

              // process the pdus:
              // we construct directly the text. but we could as well just rewrite the payloadData and let it parse again
              const pdus = frame.pdus
              let bytesProcessed = 0
              for (let i = 0; i < pdus.length; ++i) {
                const pdu = pdus[i]
                if (pdu.desc && pdu.desc.length > 0) {
                  // use just the DESC
                  if (text.length) {
                    text += ' '
                  }
                  text += pdu.desc
                } else if (pdu.signalRefs) {
                  // use signals:
                  for (let s = 0; s < pdu.signalRefs.length; ++s) {
                    let signalRef = pdu.signalRefs[s]
                    switch (signalRef) {
                      case 'S_SINT8':
                        if (text.length) {
                          text += ' '
                        }
                        text += buf.readInt8(bytesProcessed).toString(10)
                        bytesProcessed += 1
                        break
                      case 'S_UINT8':
                        if (text.length) {
                          text += ' '
                        }
                        text += buf.readUInt8(bytesProcessed).toString(10)
                        bytesProcessed += 1
                        break
                      case 'S_SINT16':
                        if (text.length) {
                          text += ' '
                        }
                        text += (isBigEndian ? buf.readInt16BE(bytesProcessed) : buf.readInt16LE(bytesProcessed)).toString(10)
                        bytesProcessed += 2
                        break
                      case 'S_UINT16':
                        if (text.length) {
                          text += ' '
                        }
                        text += (isBigEndian ? buf.readUInt16BE(bytesProcessed) : buf.readUInt16LE(bytesProcessed)).toString(10)
                        bytesProcessed += 2
                        break
                      case 'S_SINT32':
                        if (text.length) {
                          text += ' '
                        }
                        text += (isBigEndian ? buf.readInt32BE(bytesProcessed) : buf.readInt32LE(bytesProcessed)).toString(10)
                        bytesProcessed += 4
                        break
                      case 'S_UINT32':
                        if (text.length) {
                          text += ' '
                        }
                        text += (isBigEndian ? buf.readUInt32BE(bytesProcessed) : buf.readUInt32LE(bytesProcessed)).toString(10)
                        bytesProcessed += 4
                        break
                      case 'S_FLOA32':
                        if (text.length) {
                          text += ' '
                        }
                        text += (isBigEndian ? buf.readFloatBE(bytesProcessed) : buf.readFloatLE(bytesProcessed)).toString()
                        bytesProcessed += 4
                        break
                      case 'S_FLOA64':
                        if (text.length) {
                          text += ' '
                        }
                        text += (isBigEndian ? buf.readDoubleBE(bytesProcessed) : buf.readDoubleLE(bytesProcessed)).toString()
                        bytesProcessed += 4
                        break
                      case 'S_UINT64':
                        if (text.length) {
                          text += ' '
                        }
                        text += (isBigEndian ? buf.readBigUInt64BE(bytesProcessed) : buf.readBigUInt64LE(bytesProcessed)).toString(10)
                        bytesProcessed += 8
                        break
                      case 'S_SINT64':
                        if (text.length) {
                          text += ' '
                        }
                        text += (isBigEndian ? buf.readBigInt64BE(bytesProcessed) : buf.readBigInt64LE(bytesProcessed)).toString(10)
                        bytesProcessed += 8
                        break

                      case 'S_STRG_UTF8':
                      case 'S_RAWD':
                      case 'S_RAW':
                      case 'S_STRG_ASCII':
                        const len = isBigEndian ? buf.readUInt16BE(bytesProcessed) : buf.readUInt16LE(bytesProcessed)
                        bytesProcessed += 2
                        if (text.length) {
                          text += ' '
                        }
                        const encoding = DltNonVerbosePlugin.encodingMap[signalRef] || 'ascii'
                        text += buf.slice(bytesProcessed, bytesProcessed + len).toString(encoding)
                        bytesProcessed += len
                        break
                      case 'S_BOOL':
                        if (text.length) {
                          text += ' '
                        }
                        text += buf.readUInt8(bytesProcessed) ? 'true' : 'false'
                        bytesProcessed += 1
                        break
                      case 'S_FLOA16': // how to support that
                      default:
                        console.warn(`DltNonVerbosePlugin frame ${frame.id} unknown signal #${s} ref: '${signalRef}'`)
                        break
                    }
                  }
                }
              }
              if (bytesProcessed !== frame.byteLength) {
                console.warn(
                  `DltNonVerbosePlugin frame ${frame.id} '${frame.shortName} 'processed only ${bytesProcessed}/${frame.byteLength} bytes payload!`,
                )
              } else {
                msg._payloadText = text
              }
            }
          }
        } else {
          // should not happen as match() checked that already
          console.warn(`DltNonVerbosePlugin.transformCb didn't found frame id '${id}'`)
        }
      }
    } catch (e) {
      console.warn(`DltNonVerbosePlugin.transformCb got '${e}'`)
    }
  }
}
