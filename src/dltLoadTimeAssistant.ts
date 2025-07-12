/* --------------------
 * Copyright(C) Matthias Behr, 2020.
 */

import * as vscode from 'vscode'
import { MultiStepInput, PickItem } from './quickPick'
import { DltFilter, DltFilterType } from './dltFilter'
import { DltDocument } from './dltDocument'
import * as util from './util'
import * as fs from 'fs'
import { DltMsg } from './dltParser'

export async function loadTimeFilterAssistant(fileUri: vscode.Uri, allFilters: DltFilter[]) {
  console.log(`check load time filters wanted...`)
  return new Promise((resolveAssistant, cancelAssistant) => {
    // create a quickPick with apids to multiselect to remove:

    // determine current filters:
    const [posFilters, negFilters, decFilters, eventFilters, negBeforePosFilters] = DltDocument.getFilter(allFilters, true, true)

    let apids: PickItem[] = []
    let apidCntMap: Map<string, number> = new Map() // for each apid the number of messages as we do want to sort them

    const onMoreItems: vscode.EventEmitter<PickItem[] | undefined> = new vscode.EventEmitter<PickItem[] | undefined>()
    const loadMoreApids = (cancel: vscode.CancellationToken) => {
      setTimeout(async () => {
        console.log(`loadMoreApids background ... called...`)

        // open the dlt file and just read the apids:
        const fd = fs.openSync(fileUri.fsPath, 'r')
        let read: number = 0
        let chunkSize = 2 * 1024 * 1024 // todo config. smaller chunk size here as we want faster feedback
        let parsedFileLen = 0
        let data = Buffer.allocUnsafe(chunkSize)
        let startTime = process.hrtime()
        let lastUpdateTime = startTime
        let msgs: DltMsg[] = []
        const calcAndFireApids = () => {
          apids = []
          apidCntMap.forEach((v, k) => {
            const item = new PickItem(k)
            item.description = `${v} messages with APID:${k}`
            apids.push(item)
          })
          // now sort:
          apids.sort((a, b) => {
            return apidCntMap.get(b.name)! - apidCntMap.get(a.name)!
          })
          onMoreItems.fire(apids)
        }

        do {
          read = fs.readSync(fd, data, 0, chunkSize, parsedFileLen)
          if (read) {
            //const copiedBuf = Buffer.from(data.slice(0, read)); // have to create a copy of Buffer here! not necessary to access apid
            // parse data:
            const parseInfo = DltDocument.dltP.parseDltFromBuffer(
              data.slice(0, read),
              0,
              msgs,
              undefined,
              posFilters,
              negFilters,
              negBeforePosFilters,
            )
            if (parseInfo[0] > 0) {
            }
            if (parseInfo[1] > 0) {
              //console.log(`checkFileChanges read=${read} remaining=${parseInfo[1]} bytes. Parse ${parseInfo[2]} msgs.`);
            }
            if (msgs.length > 0) {
              // check all apids:
              for (let i = 0; i < msgs.length; ++i) {
                const msg = msgs[i]
                const apid = msg.apid
                if (apid.length) {
                  // we ignore empty
                  let apidCnt = apidCntMap.get(apid)
                  if (apidCnt === undefined) {
                    apidCnt = 1
                  } else {
                    apidCnt = apidCnt + 1
                  }
                  apidCntMap.set(apid, apidCnt)
                }
              }
              msgs = [] // keep mem load low

              // update only every 1s:
              let curTime = process.hrtime(lastUpdateTime)
              if (curTime[0] > 1) {
                // 1000ms passed
                lastUpdateTime = process.hrtime()
                calcAndFireApids()
              }
            }

            if (read !== parseInfo[1]) {
              parsedFileLen += read - parseInfo[1]
              let curTime = process.hrtime(startTime)
              if (curTime[1] / 1000000 > 100) {
                // 100ms passed
                await util.sleep(10) // 10ms each 100ms
                startTime = process.hrtime()
              }
            } else {
              console.log(
                `checkFileChanges read=${read} remaining=${parseInfo[1]} bytes. Parse ${parseInfo[2]} msgs. Stop parsing to avoid endless loop.`,
              )
              read = 0
            }
          }
        } while (read > 0 && !cancel.isCancellationRequested)
        fs.closeSync(fd)
        // once done fire with undefined:
        if (!cancel.isCancellationRequested) {
          calcAndFireApids()
          onMoreItems.fire(undefined)
        }
        console.log(`loadMoreApids background ... finished.`)
      }, 10)
      return onMoreItems.event
    }

    let removeApids: string[] | undefined = undefined
    let disabledLoadTimeFilters = allFilters
      .filter((f) => f.atLoadTime && !f.enabled)
      .map((f) => {
        let pi = new PickItem(f.name)
        pi.data = f
        return pi
      })
    let tempEnableLoadTimeFilters: DltFilter[] = []
    const onLoadTimeFiltersValues = (v: string | readonly PickItem[]) => {
      tempEnableLoadTimeFilters = []
      if (Array.isArray(v)) {
        //console.log(` onValue(${v.map(v => v.name).join(',')})`);
        const piv: PickItem[] = v as PickItem[]
        piv.forEach((pi) => {
          if (pi.data !== undefined) {
            tempEnableLoadTimeFilters.push(pi.data)
          }
        })
      } else {
        console.log(` onLoadTimeFiltersValues(str '${v}') todo!`)
        // search all PickItems that contain v in their name (and/or descrip?)
      }
      console.log(` onLoadTimeFiltersValues() got ${tempEnableLoadTimeFilters.length} load time filters to temp enable`)
    }
    let stepInput = new MultiStepInput(
      `Load time filter assistant...`,
      [
        disabledLoadTimeFilters.length
          ? {
              title: `select all load time filters that should be temp. enabled`,
              items: disabledLoadTimeFilters,
              onValues: onLoadTimeFiltersValues,
            }
          : undefined,
        {
          title: `select all APIDs that can be removed`,
          items: apids,
          onValues: (v) => {
            if (Array.isArray(v)) {
              removeApids = v.map((v) => v.name)
            } else {
              removeApids = v.length ? [<string>v] : []
            }
          },
          onMoreItems: loadMoreApids,
        },
      ],
      { canSelectMany: true },
    )
    stepInput
      .run()
      .then(() => {
        // temp enable the load time filters:
        tempEnableLoadTimeFilters.forEach((f) => (f.enabled = true))
        // insert them as loadTimeFilters (negBeforePos...?)
        if (removeApids?.length) {
          console.log(`adding neg. load filters for APIDs: ${removeApids.join(',')}`)
          for (let i = 0; i < removeApids.length; ++i) {
            const newFilter = new DltFilter(
              { type: DltFilterType.NEGATIVE, atLoadTime: true, apid: removeApids[i], beforePositive: true },
              false,
            )
            allFilters.push(newFilter)
          }
        }
        resolveAssistant(removeApids)
      })
      .catch((err) => {
        console.log(`dlt-log.loadTimeFilterAssistant cancelled...`)
        cancelAssistant()
      })
  })
}
