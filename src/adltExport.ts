/*
 * TODOs:
 * [] - add "rewrite msg times by calculated times" option
 * [] - add "sort msgs by calculated time" option
 */

import * as vscode from 'vscode'
import * as WebSocket from 'ws'

import { DltFilter } from './dltFilter'
import { ADltDocumentProvider, char4U32LeToString } from './adltDocumentProvider'
import * as remote_types from './remote_types'
import { MultiStepInput, PickItem } from './quickPick'
import { safeStableStringify } from './util'

interface AdltExportOptions {
  srcUris: vscode.Uri[]
  dstUri: vscode.Uri
  filters: DltFilter[]
  lcsToKeep: remote_types.BinLifecycle[] // empty = all
  recordedTimeFrom?: number
  recordedTimeTo?: number
  sortMsgs: boolean
}

interface AdltExportResult {
  nrExportedMsgs: number
  nrProcessedMsgs: number
  lifecyclesExported: remote_types.BinLifecycle[]
}

const resultCountFormat = new Intl.NumberFormat(undefined, { notation: 'compact', compactDisplay: 'short' })

export async function exportDlt(
  log: vscode.LogOutputChannel,
  adltProvider: ADltDocumentProvider,
  srcUris: vscode.Uri[],
  allFilters?: DltFilter[],
) {
  log.info(`exportDlt: Exporting DLT files: ${srcUris.map((uri) => uri.fsPath).join(', ')}`)

  if (!srcUris.length) {
    return
  }

  // we use the first uri to determine local or remote attribs:
  const uri = srcUris[0]

  const isLocalAddress = uri.authority === undefined || uri.authority === ''
  const address = isLocalAddress
    ? adltProvider.getAdltProcessAndPort().then((port) => `ws://localhost:${port}`)
    : Promise.resolve(uri.authority)

  return new Promise((resolveAssistant, cancelAssistant) => {
    address.then((address) => {
      try {
        log.info(`exportDlt: using ${isLocalAddress ? 'local' : 'remote'} address: ${address}`)

        const exportOptions: AdltExportOptions = {
          srcUris,
          dstUri: srcUris[0].with({ path: srcUris[0].path + '_exported.dlt' }),
          lcsToKeep: [] as remote_types.BinLifecycle[],
          filters: allFilters || [], // as DltFilter[],
          sortMsgs: false,
        }

        const onMoreLcsItems: vscode.EventEmitter<PickItem[] | undefined> = new vscode.EventEmitter<PickItem[] | undefined>()
        const lcs: PickItem[] = []
        const lcsPerEcu: Map<number, remote_types.BinLifecycle[]> = new Map()

        let last_nr_msgs = 0

        let pass1_lcs_finished = false

        const onBinaryMessage = (msg: remote_types.BinType) => {
          switch (msg.tag) {
            case 'FileInfo':
              {
                // twice the same nr_msgs indicates that processing is done:
                let fileInfo: remote_types.BinFileInfo = msg.value
                // log.info(`exportDlt: got fileInfo nr_msgs: ${fileInfo.nr_msgs}`)
                if (last_nr_msgs === fileInfo.nr_msgs) {
                  // processing the file is done (now eac and lifecycles are up-to-date as well)
                  log.info(`exportDlt: processing done, got ${fileInfo.nr_msgs} msgs`)
                  pass1_lcs_finished = true
                  onMoreLcsItems.fire(undefined)
                }
                last_nr_msgs = fileInfo.nr_msgs
              }
              break
            case 'Lifecycles':
              {
                let lifecycles: Array<remote_types.BinLifecycle> = msg.value
                // log.info(`exportDlt: got ${lifecycles.length} lifecycle updates`)

                const getLcHumanReadableNr = (lc: remote_types.BinLifecycle): number => {
                  // we assume the lcs in lcs are sorted by start_time (per ecu)
                  const lcsForThatEcu = lcsPerEcu.get(lc.ecu)
                  if (lcsForThatEcu === undefined) {
                    lcsPerEcu.set(lc.ecu, [lc])
                    return 1
                  } else {
                    const lcIdx = lcsForThatEcu.findIndex((curLc) => curLc.id === lc.id)
                    if (lcIdx === -1) {
                      lcsForThatEcu.push(lc)
                      return lcsForThatEcu.length
                    } else {
                      return lcIdx + 1
                    }
                  }
                }

                lifecycles.forEach((lc) => {
                  // is it know already?
                  const humanReadableNumber = getLcHumanReadableNr(lc)
                  const name = `${char4U32LeToString(lc.ecu)} LC#${humanReadableNumber}: ${
                    lc.resume_time !== undefined
                      ? `${new Date(Number(lc.resume_time / 1000n)).toLocaleString()} RESUME `
                      : new Date(Number(lc.start_time / 1000n)).toLocaleString()
                  }-${new Date(Number(lc.end_time / 1000n)).toLocaleTimeString()} #${resultCountFormat.format(lc.nr_msgs)}`
                  // do we have this lc yet?
                  const curLc = lcs.find((curLc) => curLc.data.id === lc.id)
                  if (curLc !== undefined) {
                    // update data:
                    curLc.name = name
                    curLc.data = lc
                  } else {
                    const lcI = new PickItem(name)
                    lcI.data = lc
                    lcs.push(lcI)
                  }
                })
                onMoreLcsItems.fire(lcs)
              }
              break
            case 'PluginState':
              {
                let states = msg.value
                log.info(`exportDlt: got ${states.length} plugin states: ${states.join(',')}`)
                for (const state of states) {
                  let stateObj = JSON.parse(state)
                  if (stateObj?.name === 'Export') {
                    log.info(`exportDlt: export state: ${safeStableStringify(stateObj)}`)
                  }
                }
              }
              break
            case 'EacInfo':
              break
            default:
              log.info(`exportDlt: export got binary message type=${msg.tag}`)
              break
          }
        }

        const adltClient = new AdltClient(log, address, onBinaryMessage)
        adltClient.onOpen().then(() => {
          // open the files and get info:
          const openParam = {
            collect: false,
            files: exportOptions.srcUris.map((uri) => uri.fsPath),
            filter: exportOptions.filters,
          }
          adltClient
            .sendAndRecvReq(`open ${safeStableStringify(openParam)}`)
            .then((resp) => {
              log.info(`exportDlt: open pass 1(lcs) succeeded with: ${resp}`)

              const onLcsValues = (v: string | readonly PickItem[]) => {
                exportOptions.lcsToKeep = []
                if (Array.isArray(v)) {
                  console.log(`lcs onValue(${v.map((v) => v.name).join(',')})`)
                  // now add the lifecycles:
                  ;(<readonly PickItem[]>v).forEach((pi) => {
                    if (pi.data !== undefined) {
                      exportOptions.lcsToKeep.push(pi.data)
                    }
                  })
                } else {
                  log.warn(`lcs onValue(str '${v}') todo!`)
                }
                log.info(`exportDlt: onLcsValues() got ${exportOptions.lcsToKeep.length} lcsToKeep`)
              }

              const recordedTimePI = new PickItem('')
              const timeRestrictRecordedTimeMoreItemsEvent = new vscode.EventEmitter<PickItem[] | undefined>()
              // min date is from the selected lifecycles the earliest start date
              const calcMinDate = (): number => {
                return exportOptions.lcsToKeep.length
                  ? exportOptions.lcsToKeep.reduce((prevValue, curValue) => {
                      const curTime = Number(curValue.start_time / 1000n)
                      return curTime < prevValue ? curTime : prevValue
                    }, Date.now())
                  : lcs.reduce((prevValue, curValue) => {
                      const curTime = Number(curValue.data.start_time / 1000n)
                      return curTime < prevValue ? curTime : prevValue
                    }, Date.now())
              }
              let minDate = calcMinDate()
              const yesNoItems: PickItem[] = [
                (() => {
                  const i = new PickItem('yes')
                  i.iconPath = new vscode.ThemeIcon('check')
                  return i
                })(),
                (() => {
                  const i = new PickItem('no')
                  i.iconPath = new vscode.ThemeIcon('close')
                  return i
                })(),
              ]

              let stepInput = new MultiStepInput(
                `Export/filter dlt file assistant...`,
                [
                  {
                    title: `select all lifecycles to keep (none=keep all)`,
                    items: lcs,
                    onValues: onLcsValues,
                    onMoreItems: (cancelToken) => {
                      log.info(`exportDlt: onMoreItems lcs...`)
                      adltClient.sendAndRecvReq('resume').then((resp) => {
                        log.info(`exportDlt: resume pass 1(lcs) succeeded with: ${resp}`)
                      })
                      if (pass1_lcs_finished) {
                        // fire event to indicate that no more items will come
                        setTimeout(() => onMoreLcsItems.fire(undefined), 10)
                      }
                      cancelToken.onCancellationRequested((e) => {
                        adltClient.sendAndRecvReq('pause').then((resp) => {
                          log.info(`exportDlt: pause pass 1(lcs) succeeded with: ${resp}`)
                        })
                      })
                      return onMoreLcsItems.event
                    },
                  },
                  {
                    // by recorded time (or by calc time if rewriteMsgTimes is set)
                    title: `restrict export by recorded time (from-to)`,
                    initialValue: () => {
                      minDate = calcMinDate()
                      log.info(`exportDlt: minDate used = ${new Date(minDate).toLocaleString()}`)
                      return timeRestrictInitialValue(exportOptions.recordedTimeFrom, exportOptions.recordedTimeTo)
                    },
                    items: () =>
                      timeRestrictItems(
                        exportOptions.recordedTimeFrom,
                        exportOptions.recordedTimeTo,
                        recordedTimePI,
                        timeRestrictRecordedTimeMoreItemsEvent,
                      ),
                    isValid: (v: string) => timeRestrictIsValid(recordedTimePI, timeRestrictRecordedTimeMoreItemsEvent, minDate, v),
                    onValue: (v: string) => {
                      timeRestrictIsValid(
                        recordedTimePI,
                        timeRestrictRecordedTimeMoreItemsEvent,
                        minDate,
                        v,
                        (timeFrom: number | undefined, timeTo: number | undefined) => {
                          exportOptions.recordedTimeFrom = timeFrom
                          exportOptions.recordedTimeTo = timeTo
                        },
                      )
                    },
                    onMoreItems: (cancel: vscode.CancellationToken) => {
                      // we do this to get an event to trigger the items update at timeRestrictIsValid...
                      setTimeout(() => timeRestrictRecordedTimeMoreItemsEvent.fire(undefined), 10)
                      return timeRestrictRecordedTimeMoreItemsEvent.event
                    },
                    canSelectMany: false,
                  },
                  /* not working as the export plugin is called before the sorting... {
                    title: `reorder msgs by calculated time?`,
                    initialValue: () => (exportOptions.sortMsgs ? 'yes' : 'no'),
                    items: yesNoItems,
                    onValue: (v) => {
                      exportOptions.sortMsgs = v === 'yes'
                    },
                    canSelectMany: false,
                  },*/
                ],
                { canSelectMany: true },
              )
              stepInput
                .run()
                .then(async () => {
                  log.info(`exportDlt: MultiStepInput.run succeeded. exportOptions=${safeStableStringify(exportOptions)}`)
                  adltClient
                    .sendAndRecvReq(`close`)
                    .then(async (resp) => {
                      log.info(`exportDlt: close succeeded with: ${resp}`)
                      let doRetry
                      do {
                        doRetry = false
                        // todo this needs a different dialog for remote uris!
                        await vscode.window
                          .showSaveDialog({
                            defaultUri: exportOptions.dstUri,
                            saveLabel: 'save filtered dlt as ...',
                            filters: {
                              DLT: ['dlt'],
                            },
                          })
                          .then(async (saveUri) => {
                            if (saveUri) {
                              if (exportOptions.srcUris.map((u) => u.toString()).includes(saveUri.toString())) {
                                await vscode.window.showErrorMessage(
                                  'Exporting/filtering into same file not possible. Please choose a different one.',
                                  {
                                    modal: true,
                                  },
                                )
                                doRetry = true
                              } else {
                                exportOptions.dstUri = saveUri
                                performExport(exportOptions, adltClient, log).then(resolveAssistant, cancelAssistant)
                              }
                            } else {
                              cancelAssistant('save dialog cancelled')
                            }
                          })
                      } while (doRetry)
                    })
                    .catch((err) => {
                      log.error(`exportDlt: close(pass1) failed with: ${err}`)
                      cancelAssistant(err)
                    })
                })
                .catch((err) => {
                  log.error(`exportDlt: MultiStepInput.run failed with: ${err}`)
                  cancelAssistant(err)
                })
            })
            .catch((e) => {
              log.error(`exportDlt: open failed with: ${e}`)
              cancelAssistant(e)
            })
        })
      } catch (e) {
        log.error(`exportDlt: failed with: ${e}`)
        cancelAssistant(e)
      }
    })
  })
}

//#region performExport
/**
 * Performs the export operation with the given export options, ADLT client, and log output channel.
 * Shows a progress dialog while the export is running.
 * @param exportOptions - The export options.
 * @param adltClient - The ADLT client. Expects that "open" can be performed on it.
 * @param log - The log output channel.
 * @returns A promise that resolves to the export result.
 */
function performExport(exportOptions: AdltExportOptions, adltClient: AdltClient, log: vscode.LogOutputChannel) {
  return new Promise<AdltExportResult>((resolve, reject) => {
    vscode.window
      .withProgress(
        { cancellable: true, location: vscode.ProgressLocation.Notification, title: `Export/filter dlt file...` },
        (progress, token) => {
          return new Promise<AdltExportResult>((resolve, reject) => {
            progress.report({ message: `starting export...` })
            let lastNrMsgs = 0
            let lastNrExportedMsgs = 0
            let lastNrProcessedMsgs = 0
            let lastLifecyclesExported: number[] = []
            let allExportLifecycles: remote_types.BinLifecycle[] = []
            adltClient.onBinaryMessage = (msg) => {
              switch (msg.tag) {
                case 'FileInfo':
                  {
                    // twice the same nr_msgs indicates that processing is done:
                    let fileInfo: remote_types.BinFileInfo = msg.value
                    // log.info(`exportDlt: export got fileInfo nr_msgs: ${fileInfo.nr_msgs}`)
                    if (lastNrMsgs === fileInfo.nr_msgs) {
                      // processing the file is done (now eac and lifecycles are up-to-date as well)
                      const exportedLifecycles: remote_types.BinLifecycle[] = lastLifecyclesExported
                        .map((lcId) => allExportLifecycles.find((lc) => lc.id === lcId))
                        .filter((n) => n !== undefined) as remote_types.BinLifecycle[]
                      log.info(
                        `exportDlt: export processing done, got ${
                          fileInfo.nr_msgs
                        } msgs, #exported=${lastNrExportedMsgs} #processed=${lastNrProcessedMsgs} exported lifecycles=${safeStableStringify(
                          exportedLifecycles,
                        )})}`,
                      )
                      resolve({
                        nrExportedMsgs: lastNrExportedMsgs,
                        nrProcessedMsgs: lastNrProcessedMsgs,
                        lifecyclesExported: exportedLifecycles,
                      })
                    }
                    lastNrMsgs = fileInfo.nr_msgs
                  }
                  break
                case 'PluginState':
                  {
                    let states = msg.value
                    for (const state of states) {
                      let stateObj = JSON.parse(state)
                      if (stateObj?.name === 'Export') {
                        let infos = stateObj.infos
                        if (infos !== undefined) {
                          lastNrExportedMsgs = infos.nrExportedMsgs
                          lastNrProcessedMsgs = infos.nrProcessedMsgs
                          lastLifecyclesExported = stateObj.infos.lifecyclesExported
                          const message = `exported ${resultCountFormat.format(lastNrExportedMsgs)} / ${resultCountFormat.format(
                            lastNrProcessedMsgs,
                          )}`
                          // log.info(`exportDlt: export progress: ${message}`)
                          progress.report({
                            message,
                          })
                        }
                      }
                    }
                  }
                  break
                case 'Lifecycles':
                  {
                    let lifecycles: Array<remote_types.BinLifecycle> = msg.value
                    // log.info(`exportDlt: got ${lifecycles.length} lifecycle updates`)
                    lifecycles.forEach((lc) => {
                      const curLcIdx = allExportLifecycles.findIndex((curLc) => curLc.id === lc.id)
                      if (curLcIdx > -1) {
                        allExportLifecycles.splice(curLcIdx, 1, lc)
                      } else {
                        allExportLifecycles.push(lc)
                      }
                    })
                  }
                  break
                case 'EacInfo':
                  break
                default:
                  log.info(`exportDlt: export got binary message type=${msg.tag}`)
                  break
              }
            }
            const openParam = {
              collect: false,
              files: exportOptions.srcUris.map((uri) => uri.fsPath),
              sort: exportOptions.sortMsgs,
              plugins: [
                {
                  name: 'Export',
                  exportFileName: exportOptions.dstUri.fsPath,
                  filters: exportOptions.filters,
                  lifecyclesToKeep: exportOptions.lcsToKeep.map((lc) => {
                    return {
                      ecu: char4U32LeToString(lc.ecu),
                      startTime: lc.start_time.toString() + 'n',
                      endTime: lc.end_time.toString() + 'n',
                      resumeTime: lc.resume_time ? lc.resume_time.toString() + 'n' : undefined,
                    }
                  }),
                  recordedTimeFromMs: exportOptions.recordedTimeFrom ? exportOptions.recordedTimeFrom : undefined,
                  recordedTimeToMs: exportOptions.recordedTimeTo ? exportOptions.recordedTimeTo : undefined,
                },
              ],
            }
            adltClient
              .sendAndRecvReq(`open ${safeStableStringify(openParam)}`)
              .then((resp) => {
                progress.report({ message: `opened files...` })
                token.onCancellationRequested(() => {
                  log.info(`exportDlt: export report  onCancellationRequested`)
                  adltClient.sendAndRecvReq(`close`).then((resp) => {
                    reject(`export cancelled...`)
                  })
                })
              })
              .catch((e) => {
                log.error(`exportDlt: export open failed with err:'${e}'`)
                reject(`export open failed with err:'${e}'`)
              })
          })
        },
      )
      .then(
        (value) => {
          log.info(`exportDlt: export succeeded with: ${safeStableStringify(value)}`)
          resolve(value)
        },
        (rejectReason) => {
          log.error(`exportDlt: export rejected with: ${rejectReason}`)
          reject(rejectReason)
        },
      )
  })
}

//#region time restrict
// time restriction:
const timeRestrictInitialValue = (timeFrom: number | undefined, timeTo: number | undefined): string => {
  let v = ''
  if (timeFrom !== undefined) {
    const dateFrom = new Date(timeFrom)
    v = `${dateFrom.getHours().toString().padStart(2, '0')}:${dateFrom.getMinutes().toString().padStart(2, '0')}-`
  }
  if (timeTo !== undefined) {
    if (v.length === 0) {
      v = '-'
    }
    const dateTo = new Date(timeTo)
    v += `${dateTo.getHours().toString().padStart(2, '0')}:${dateTo.getMinutes().toString().padStart(2, '0')}`
  }
  return v
}

const timeRestrictItems = (
  timeFrom: number | undefined,
  timeTo: number | undefined,
  pi: PickItem,
  moreItemsEvent: vscode.EventEmitter<PickItem[] | undefined>,
): PickItem[] => {
  const val = timeRestrictInitialValue(timeFrom, timeTo)
  timeRestrictUpdateHint(
    pi,
    moreItemsEvent,
    val,
    timeFrom !== undefined ? new Date(timeFrom) : undefined,
    timeTo !== undefined ? new Date(timeTo) : undefined,
    val.length === 0 ? `enter time range like: from-to as 'hh:mm-hh:mm'. From or to can be empty.` : '',
  )
  return [pi]
}

const timeRestrictUpdateHint = (
  pi: PickItem,
  moreItemsEvent: vscode.EventEmitter<PickItem[] | undefined>,
  v: string,
  timeFrom: Date | undefined,
  timeTo: Date | undefined,
  hint?: string,
  error: boolean = false,
) => {
  pi.name = v
  pi.description = `${hint !== undefined ? `${error ? 'Error: ' : ''}${hint} ` : ''}${
    timeFrom !== undefined ? timeFrom.toLocaleString() : ''
  }-${timeTo !== undefined ? timeTo.toLocaleString() : ''}`
  moreItemsEvent.fire([pi])
}

const timeRestrictRegExp = new RegExp(/^([0-2]\d:[0-5]\d)?\-([0-2]\d:[0-5]\d)?$/)

const timeRestrictIsValid = (
  pi: PickItem,
  moreItemsEvent: vscode.EventEmitter<PickItem[] | undefined>,
  minDate: number,
  v: string,
  storeValueFn?: (timeFrom: number | undefined, timeTo: number | undefined) => void,
): boolean => {
  //console.log(`got timeRestrict value='${v}'`);
  if (!v.length) {
    if (storeValueFn) {
      storeValueFn(undefined, undefined)
    } else {
      timeRestrictUpdateHint(
        pi,
        moreItemsEvent,
        v,
        undefined,
        undefined,
        `enter time range like: from-to as 'hh:mm-hh:mm'. From or to can be empty.`,
      )
    }
    return true
  }
  const rTest = timeRestrictRegExp.test(v)
  //console.log(`got timeRestrict value='${v}' tests ${rTest}`);
  if (!rTest) {
    timeRestrictUpdateHint(pi, moreItemsEvent, '', undefined, undefined, `not matching 'hh:mm-hh-mm'`, true)
    return false
  }
  // parse the two times:
  const timeR = timeRestrictRegExp.exec(v)
  if (timeR !== null) {
    //console.log(`got timeRestrict value='${v}' exec 0 = '${timeR[0]}'`);
    //console.log(`got timeRestrict value='${v}' exec 1 = '${timeR[1]}'`);
    //console.log(`got timeRestrict value='${v}' exec 2 = '${timeR[2]}'`);
    const gotTimeFrom = timeR[1] !== undefined
    const gotTimeTo = timeR[2] !== undefined
    if (!gotTimeFrom && !gotTimeTo) {
      timeRestrictUpdateHint(pi, moreItemsEvent, '', undefined, undefined, `at least 'from' or 'to' needed`, true)
      return false
    }

    const timeFrom = new Date(minDate)
    if (gotTimeFrom) {
      timeFrom.setHours(Number(timeR[1].split(':')[0]), Number(timeR[1].split(':')[1]), 0, 0)
      if (timeFrom.valueOf() < minDate) {
        timeFrom.setTime(timeFrom.valueOf() + 1000 * 60 * 60 * 24) // advance by one day
      }
    }
    const timeTo = new Date(timeFrom.valueOf())
    if (gotTimeTo) {
      timeTo.setHours(Number(timeR[2].split(':')[0]), Number(timeR[2].split(':')[1]), 0, 0)
      if (timeTo.valueOf() < timeFrom.valueOf()) {
        timeTo.setTime(timeTo.valueOf() + 1000 * 60 * 60 * 24) // advance by one day
      }
    }
    //console.log(`got timeFrom=${gotTimeFrom ? timeFrom.toLocaleString() : '<none>'} timeTo=${gotTimeTo ? timeTo.toLocaleString() : '<none>'}`);
    if (gotTimeTo && gotTimeFrom) {
      if (timeFrom.valueOf() > timeTo.valueOf()) {
        timeRestrictUpdateHint(pi, moreItemsEvent, '', undefined, undefined, `'from' later than 'to'`, true)
        return false
      }
    }
    if (storeValueFn) {
      storeValueFn(gotTimeFrom ? timeFrom.valueOf() : undefined, gotTimeTo ? timeTo.valueOf() : undefined)
    } else {
      timeRestrictUpdateHint(pi, moreItemsEvent, v, gotTimeFrom ? timeFrom : undefined, gotTimeTo ? timeTo : undefined)
    }
    return true
  } else {
    return false
  }
}

// todo refactor in standalone file
//#region AdltClient
class AdltClient {
  private webSocket: WebSocket
  private _reqCallbacks: ((resp: string) => void)[] = [] // could change to a map. but for now we get responses in fifo order
  public isConnected: boolean = false
  private pendingOpenPromises: ((connected: boolean) => void)[] = []

  constructor(
    private log: vscode.LogOutputChannel,
    address: string,
    public onBinaryMessage?: (msg: remote_types.BinType) => void,
  ) {
    this.webSocket = new WebSocket(address, [], { perMessageDeflate: false, origin: 'adlt-logs.adltClient', maxPayload: 1_000_000_000 })
    this.webSocket.binaryType = 'arraybuffer'

    this.webSocket.on('message', (data: ArrayBuffer, isBinary) => {
      try {
        if (isBinary) {
          let bin_type = remote_types.readBinType(data)
          //log.info(`adltClient.on(message) got binary type=${bin_type.tag} size=${data.byteLength}`)
          this.onBinaryMessage?.(bin_type)
        } else {
          // !isBinary
          const text = data.toString()
          if (text.startsWith('info:')) {
            // todo still used?
            log.warn(`adltClient.on(message) info:`, text)
          } else if (this._reqCallbacks.length > 0) {
            // response to a request:
            log.info(`adltClient.on(message) response for request:`, text)
            let cb = this._reqCallbacks.shift()
            if (cb) {
              cb(text)
            }
          } else {
            log.warn(`adltClient.on(message) unknown text=`, text)
          }
        }
      } catch (e) {
        log.warn(`adltClient.on(message) got err=${e}`)
      }
    })

    this.webSocket.on('upgrade', (response) => {
      // log.info(`adltClient.on(upgrade) got response:`, response)
      const ah = response.headers['adlt-version']
      const adltVersion = ah && !Array.isArray(ah) ? ah : ah && Array.isArray(ah) ? ah.join(',') : undefined
      if (adltVersion) {
        this.log.info(`adltClient got adlt version ${adltVersion}.`)
      }
    })

    this.webSocket.on('open', () => {
      log.info('adltClient.on(open)...')
      this.isConnected = true
      // resolve all pending open promises:
      this.pendingOpenPromises.forEach((cb) => {
        cb(true)
      })
      this.pendingOpenPromises = []
    })
    this.webSocket.on('close', () => {
      log.info('adltClient.on(close)')
      this.isConnected = false
    })
    this.webSocket.on('error', (err) => {
      log.warn(`adltClient.on(error): ${err}`)
    })
  }

  onOpen(): Promise<void> {
    if (this.isConnected) {
      return Promise.resolve()
    } else {
      // add a promise to the list of pending open promises:
      return new Promise<void>((resolve, reject) => {
        this.pendingOpenPromises.push((connected: boolean) => (connected ? resolve() : reject()))
      })
    }
  }

  sendAndRecvReq(req: string): Promise<string> {
    const log = this.log
    const prom = new Promise<string>((resolve, reject) => {
      this._reqCallbacks.push((response: string) => {
        // if we get an error/n ok we do reject as well:
        if (response.startsWith('ok:')) {
          resolve(response)
        } else {
          log.warn(`adltClient.sendAndRecvAdltMsg got nok ('${response}') for request '${req}'`)
          reject(response)
        }
      })
    })
    if (this.webSocket) {
      this.webSocket.send(req, (err) => {
        if (err) {
          log.warn(`adltClient.sendAndRecvAdltMsg wss got error:`, err)
          // this.webSocketErrors.push(`wss send failed with:${err}`)
        } else {
          log.info(`adltClient.sendAndRecvAdltMsg wss sent:`, req)
        }
      })
    } else {
      log.error(`adltClient.sendAndRecvAdltMsg got no webSocket yet!`)
    }
    return prom
  }
}
