/* --------------------
 * Copyright(C) Matthias Behr.
 */

import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import * as JSON5 from 'json5'
import * as uv0 from 'dlt-logs-utils'
import { DltLifecycleInfoMinIF } from './dltLifecycle'
import { DltFilter } from './dltFilter'
import { FilterableDltMsg } from './dltParser'
import { TreeViewNode } from './dltTreeViewNodes'

// make JSON5 and dlt-logs-utils available for conversionFunction by adding to globalThis
if (!(globalThis as any).JSON5) {
  ;(globalThis as any).JSON5 = JSON5
}
if (!(globalThis as any).uv0) {
  ;(globalThis as any).uv0 = uv0
}

enum DataPointType {
  Default = 0, // can be used but better to not set t_ then at all
  PrevStateEnd = 1,
  LifecycleEnd = 2,
}

export interface NewMessageSink {
  onNewMessages?: (nrNewMsgs: number) => void
  onDone?: () => void
  onStreamInfo?: (nrStreamMsgs: number, nrMsgsProcessed: number, nrMsgsTotal: number) => void
}

export interface ReportDocument {
  provideTimeByMsg(msg: FilterableDltMsg): Date | undefined
  revealDate(date: Date): void
  // not needed, revealDate introduced. lineCloseToDate(date: Date): Promise<number>;
  // not needed, revealDate introduced, textEditors: Array<vscode.TextEditor>;
  ecuApidInfosMap?: Map<string, Map<string, { apid: string; desc: string; nrMsgs: number; ctids: Map<string, [string, number]> }>>
  lifecycles: Map<string, DltLifecycleInfoMinIF[]>
  fileInfoNrMsgs: number
  fileNames: string[]
}

export interface TreeviewAbleDocument {
  textDocument: vscode.TextDocument | undefined
  treeNode: TreeViewNode
}
/**
 * Lifecycle infos that are passed over to the graphical report
 */
interface LCInfoForReport {
  ecu: string
  ecuLcNr: number // lifecycle number for that ecu as shown in the tree view
  label: string // the label as shown in the tree view
  isResume: boolean
  startDate: Date
  resumeDate?: Date
  endDate: Date
}

interface DataPoint {
  x: number // time in ms (was Date before)
  y: string | number | any
  lcId: number
  t_?: DataPointType
  idx_?: number
}

interface DataExtrema {
  min: number
  max: number
}

interface DataSet {
  data: DataPoint[]
  yExtrema?: DataExtrema // only available if DataPoint.y is a number (so not for string or objects/late eval.)
  yLabels?: string[]
  yAxis?: any
  group?: string
  valuesMap?: Map<string, string> // optional map of values from filter.reportOptions."valueMap"
}

/**
 * SingleReport represents a report generated from a set of filters.
 * It implements a NewMessageSink that processes the msgs for that report/set of filters.
 */
class SingleReport implements NewMessageSink {
  public msgs: Array<FilterableDltMsg> = []
  public pruneMsgsAfterProcessing: boolean = true
  public dataSets: Map<string, DataSet> = new Map<string, DataSet>()
  public minDataPointTime?: number // in ms

  public warnings: string[] = []
  public reportTitles: string[] = []
  public dataSetsGroupPrios: any = {}
  private _maxReportLogs: number
  convFunctionCache = new Map<DltFilter, [Function | undefined, Object]>()
  reportObj = {} // an object to store e.g. settings per report from a filter
  lateEvalDPs: Map<DataPoint, any> = new Map()

  msgsProcessed: number = 0
  msgsPruned: number = 0

  constructor(
    private dltReport: DltReport,
    private doc: ReportDocument,
    public filters: DltFilter[],
  ) {
    const maxReportLogs = vscode.workspace.getConfiguration().get<number>('dlt-logs.maxReportLogs')
    this._maxReportLogs = maxReportLogs && maxReportLogs > 0 ? maxReportLogs : 1_000_000 // 1mio default
    for (let f = 0; f < filters.length; ++f) {
      const filter = filters[f]
      if (filter.reportOptions) {
        try {
          if ('title' in filter.reportOptions) {
            let title = filter.reportOptions.title
            if (typeof title === 'string') {
              this.reportTitles.push(title)
            } else if (typeof title === 'boolean') {
              // with boolean we do use the filter.name from configOptions (not the auto gen one)
              if (title === true && 'name' in filter.configOptions && typeof filter.configOptions.name === 'string') {
                this.reportTitles.push(filter.configOptions.name)
              }
            } else {
              console.warn(`dltReport: unsupported type for reportOptions.title. expect string or boolean got ${typeof title}`)
            }
          }
          if ('groupPrio' in filter.reportOptions) {
            const groupPrio = filter.reportOptions.groupPrio
            Object.keys(groupPrio).forEach((groupName) => {
              this.dataSetsGroupPrios[groupName] = Number(groupPrio[groupName])
              console.log(`dltReport groupPrios=${JSON.stringify(this.dataSetsGroupPrios)}`)
            })
          }
        } catch (err) {
          console.log(`SingleReport(...) got error '${err}' processing reportOptions.`)
        }
      }
    }
  }

  onNewMessages(nrNewMsgs: number) {
    console.log(
      `SingleReport.onNewMessages(${nrNewMsgs}) msgsProcessed=${this.msgsProcessed} msgsPruned=${this.msgsPruned} msgs.length=${this.msgs.length}`,
    )
    try {
      try {
        this.updateReport()
        // and to empty the msgs that have been processed already
        if (this.pruneMsgsAfterProcessing) {
          this.msgsPruned += this.msgs.length
          this.msgs.length = 0
        }
      } catch (e) {
        console.warn(`SingleReport.onNewMessages updateReport got e='${e}'`)
      }
      this.dltReport.updateReport()
    } catch (e) {
      console.warn(`SingleReport.onNewMessages got e='${e}'`)
    }
  }

  // todo add a progress bar based on the stream info!

  onStreamInfo(nrStreamMsgs: number, nrMsgsProcessed: number, nrMsgsTotal: number) {
    // console.warn(`SingleReport.onStreamInfo(nrStreamMsgs=${nrStreamMsgs}, nrMsgsProcessed=${nrMsgsProcessed}, nrMsgsTotal=${nrMsgsTotal}) msgsProcessed=${this.msgsProcessed}`);
    if (nrStreamMsgs > this._maxReportLogs && this.msgsProcessed === this._maxReportLogs) {
      // todo this overwrites any existing warnings (and will be overwritten by other warnings!)
      this.dltReport.postMsgOnceAlive({
        command: 'update warnings',
        warnings: [
          `Report truncated to ${this.msgsProcessed} msgs out of available ${nrStreamMsgs}! Reduce amount of returned logs or increase config setting 'dlt-logs.maxReportLogs'!`,
        ],
      })
    }
  }

  updateReport() {
    const msgs = this.msgs
    const minIdx = this.msgsProcessed - this.msgsPruned
    const maxIdx = msgs.length
    const msgsToProcess = maxIdx - minIdx
    if (msgsToProcess > 0) {
      //console.log(` matching ${this.filters.length} filter on ${msgsToProcess}/${msgs.length} msgs:`);
      /*console.log(`msg[0]=${JSON.stringify(msgs[0], (key, value) =>
                typeof value === 'bigint'
                    ? value.toString()
                    : value
            )}`);*/

      for (let i = minIdx; i < maxIdx; ++i) {
        // todo make async and report progress...
        const msg = msgs[i]
        if (msg.lifecycle !== undefined) {
          for (let f = 0; f < this.filters.length; ++f) {
            const filter = this.filters[f]
            if (filter.matches(msg)) {
              const time = this.doc.provideTimeByMsg(msg)
              if (time) {
                // get the value:
                const matches = filter.payloadRegex?.exec(msg.payloadString)
                // if we have a conversion function we apply that:
                var convValuesFunction: Function | undefined = undefined
                var convValuesObj: Object
                if (this.convFunctionCache.has(filter)) {
                  ;[convValuesFunction, convValuesObj] = this.convFunctionCache.get(filter) || [undefined, {}]
                } else {
                  if (filter.reportOptions?.conversionFunction !== undefined) {
                    try {
                      convValuesFunction = Function('matches,params', filter.reportOptions.conversionFunction)
                      convValuesObj = {}
                      console.log(` using conversionFunction = '${convValuesFunction}'`)
                      this.convFunctionCache.set(filter, [convValuesFunction, convValuesObj])
                    } catch (e) {
                      convValuesObj = {}
                      let warning = `conversionFunction {\n${filter.reportOptions.conversionFunction}\n} failed parsing with:\n${e}`
                      this.addWarning(warning)
                    }
                  } else {
                    convValuesObj = {}
                    this.convFunctionCache.set(filter, [undefined, convValuesObj])
                  }
                }

                if (matches && matches.length > 0) {
                  let convertedMatches = undefined
                  if (convValuesFunction !== undefined) {
                    try {
                      convertedMatches = convValuesFunction(matches, { msg: msg, localObj: convValuesObj, reportObj: this.reportObj })
                    } catch (e) {
                      let warning = `conversionFunction {\n${filter.reportOptions.conversionFunction}\n} failed conversion with:\n${e}`
                      this.addWarning(warning)
                    }
                  }
                  if (convertedMatches !== undefined || matches.groups) {
                    const groups = convertedMatches !== undefined ? convertedMatches : matches.groups
                    Object.keys(groups).forEach((valueName) => {
                      // console.log(` found ${valueName}=${matches.groups[valueName]}`);
                      if (valueName.startsWith('TL_')) {
                        // for timelineChart
                        this.insertDataPoint(msg.lifecycle!, valueName, time, groups[valueName], false, false)
                      } else if (valueName.startsWith('STATE_')) {
                        // if value name starts with STATE_ we make this a non-numeric value aka "state handling"
                        // represented as string
                        // as we will later use a line diagram we model a state behaviour here:
                        //  we insert the current state value directly before:
                        this.insertDataPoint(msg.lifecycle!, valueName, time, groups[valueName], true)
                      } else if (valueName.startsWith('INT_')) {
                        const value: number = Number.parseInt(groups[valueName])
                        this.insertDataPoint(msg.lifecycle!, valueName, time, value)
                      } else {
                        const value: number = Number.parseFloat(groups[valueName])
                        this.insertDataPoint(msg.lifecycle!, valueName, time, value)
                      }
                    })
                  } else {
                    const value: number = Number.parseFloat(matches[matches.length - 1])
                    // console.log(` event filter '${filter.name}' matched at index ${i} with value '${value}'`);
                    this.insertDataPoint(msg.lifecycle, `values_${f}`, time, value) // todo f needs a start idx if not changed later in DltReport to non duplicate names
                  }
                }
              }
            }
          }
        }
      }
      this.msgsProcessed += msgsToProcess

      // late phase. From now on all operations need to be able to be called multiple times on same data

      // support "lazy"/late evaluation for all but STATE_ (mainly for TL_...)
      // if datapoint.y is an object with an entry 'y' we replace that with the entry.
      this.lateEvalDPs.forEach((value, dp) => {
        let newY = value.y
        if (newY !== undefined) {
          dp.y = newY
        }
      })

      console.log(`SingleReport.updateReport: have ${this.dataSets.size} data sets, processed ${this.lateEvalDPs.size} late evaluations`)
      //dataSets.forEach((data, key) => { console.log(`  ${key} with ${data.data.length} entries and ${data.yLabels?.length} yLabels`); });
    }
  }

  getDataSetProperties(forDataSetName: string): { yAxis?: any; group?: string; yLabels?: string[]; valuesMap?: Map<string, string> } {
    let yAxis: any | undefined = undefined
    let groupName: string | undefined = undefined
    let yLabels: string[] | undefined = undefined
    let valuesMap: Map<string, string> | undefined
    for (let f = 0; f < this.filters.length; ++f) {
      const filter = this.filters[f]
      if (filter.reportOptions) {
        try {
          if (yAxis === undefined && 'yAxes' in filter.reportOptions) {
            const yAxes = filter.reportOptions.yAxes
            for (let dataSetName of Object.keys(yAxes)) {
              //console.log(` got yAxes.'${dataSetName}' : ${JSON.stringify(yAxes[dataSetName], null, 2)}`);
              if (dataSetName === forDataSetName) {
                yAxis = migrateAxesV2V3(yAxes[dataSetName])
                break
              } else {
                const regEx = new RegExp(dataSetName)
                if (regEx.test(forDataSetName)) {
                  yAxis = migrateAxesV2V3(yAxes[dataSetName])
                  break
                  //console.log(`  set yAxis for '${name}' from regex '${dataSetName}'`);
                }
              }
            }
          }
          if (groupName === undefined && 'group' in filter.reportOptions) {
            const group = filter.reportOptions.group
            for (let dataSetName of Object.keys(group)) {
              //console.log(` got group.'${dataSetName}' : ${JSON.stringify(group[dataSetName], null, 2)}`);
              if (dataSetName === forDataSetName) {
                groupName = group[dataSetName] // todo map to string? (or allow numbers?)
                break
              } else {
                const regEx = new RegExp(dataSetName)
                if (forDataSetName.match(regEx)) {
                  // todo??? why that && dataSet.yAxis === undefined) {
                  groupName = group[dataSetName]
                  break
                  //console.log(`  set group for '${name}' from regex '${dataSetName}'`);
                }
              }
            }
          }
          if (yLabels === undefined && 'valueMap' in filter.reportOptions) {
            /*
                        For valueMap we do expect an object where the keys/properties match to the dataset name
                        and the property values are arrays with objects having one key/value property. E.g.
                        "valueMap":{
                            "STATE_a": [ // STATE_a is the name of the capture group from the regex capturing the value
                                {"value1":"mapped value 1"},
                                {"value2":"mapped value 2"}
                            ] // so a captured value "value" will be mapped to "mapped value 2".
                            // the y-axis will have the entries (from top): 
                            //  mapped value 1
                            //  mapped value 2
                            //
                        }
                        */
            const valueMap = filter.reportOptions.valueMap
            for (let dataSetName of Object.keys(valueMap)) {
              console.log(` got valueMap.${dataSetName} : ${JSON.stringify(valueMap[dataSetName], null, 2)}`)
              // do we have a dataSet with that label?
              if (dataSetName === forDataSetName) {
                const valueMapMap: Array<any> = valueMap[dataSetName]
                //console.log(`  got dataSet with matching label. Adjusting yLabels (name and order) and values`);
                //if (dataSet.yLabels) { if set we do always apply it
                yLabels = []
                // we add all the defined ones and '' (in reverse order so that order in settings object is the same as in the report)
                valuesMap = new Map<string, string>()
                for (let i = 0; i < valueMapMap.length; ++i) {
                  const mapping = valueMapMap[i] // e.g. {"1" : "high"}
                  const key = Object.keys(mapping)[0]
                  const val = mapping[key]
                  yLabels.unshift(val)
                  valuesMap.set(key, val)
                }
                yLabels.unshift('')
                /*} else {
                                    console.log(`   dataSet got no yLabels?`);
                                }*/
              }
            }
          }
        } catch (err) {
          console.log(`SingleReport.getDataSetProperties('${forDataSetName}') got error '${err}' processing reportOptions.`)
        }
      }
      if (yAxis !== undefined && groupName !== undefined && yLabels !== undefined) {
        break
      }
    }
    return {
      yAxis: yAxis,
      group: groupName,
      yLabels: yLabels,
      valuesMap: valuesMap,
    }
  }

  /**
   * append a new data point for the dataset associated with the label
   * @param lifecycle lifecycle for the new data point
   * @param label data set name
   * @param time x-axis value = time
   * @param value y-axis value
   * @param insertPrevState used for STATE_ type values only (TL_ doesn't need it). default false
   * @param insertYLabels shall y-axis labels be added for the value (if the value is typeof string). Not used for TL_. default true
   *
   * Determines as well the `minDataPointTime` as the earliest time by any data point inserted.
   *
   * If the dataset contains a valuesMap the mapping is checked/applied.
   *
   * For STATE_ type values (insertPrevState) there are always two data points added to each lifecycle that contains values:
   *  - the prev. value at lifecycle end
   *  - a null value at lifecycle end
   *
   * to get "state" alike charts where the value is constant till the end of the lifecycle.
   *
   * For all other type values (!insertPrevState): there is one data point added at lifecycle end with "NaN" value.
   * This is to stop interpolation between values.
   *
   */
  insertDataPoint(
    lifecycle: DltLifecycleInfoMinIF,
    label: string,
    time: Date,
    value: number | string | any,
    insertPrevState = false,
    insertYLabels = true,
  ) {
    try {
      let dataSet = this.dataSets.get(label)
      const timeInMs = time.valueOf()

      if (this.minDataPointTime === undefined || this.minDataPointTime > timeInMs) {
        this.minDataPointTime = timeInMs
      }

      const lcId = lifecycle.persistentId
      const dataPoint = { x: timeInMs, y: value, lcId: lcId }
      if (!insertPrevState && typeof dataPoint.y === 'object') {
        // late eval is only supported for non STATE_... as otherwise the prev state logic becomes really complex!
        this.lateEvalDPs.set(dataPoint, dataPoint.y)
      }

      if (!dataSet) {
        const { yAxis, group, yLabels, valuesMap } = this.getDataSetProperties(label)

        if (valuesMap !== undefined) {
          const newY = valuesMap.get(<string>value)
          if (newY) {
            value = newY
            dataPoint.y = value
          }
        }

        const data: DataPoint[] = [dataPoint]
        if (insertPrevState) {
          // add the two ending data points:
          data.push({ x: lifecycle.lifecycleEnd.valueOf() - 1, y: value, lcId: lcId, t_: DataPointType.PrevStateEnd })
          data.push({ x: lifecycle.lifecycleEnd.valueOf(), y: null /*'_unus_lbl_'*/, lcId: lcId, t_: DataPointType.LifecycleEnd })
        } else {
          data.push({ x: lifecycle.lifecycleEnd.valueOf(), y: NaN, lcId: lcId, t_: DataPointType.LifecycleEnd }) // todo not quite might end at wrong lifecycle. rethink whether one dataset can come from multiple LCs
        }
        dataSet = {
          data: data,
          yAxis: yAxis,
          group: group,
          yLabels: yLabels,
          valuesMap: valuesMap,
          yExtrema: typeof value === 'number' && valuesMap === undefined ? { min: value, max: value } : undefined,
        }
        this.dataSets.set(label, dataSet)
      } else {
        if (dataSet.valuesMap !== undefined) {
          const newY = dataSet.valuesMap.get(<string>value)
          if (newY) {
            value = newY
            dataPoint.y = value
          }
        } else if (typeof value === 'number') {
          // update yExtrema only for numbers and datasets without valuesMap
          const yExtrema = dataSet.yExtrema
          if (yExtrema) {
            if (value < yExtrema.min) {
              yExtrema.min = value
            } else if (value > yExtrema.max) {
              yExtrema.max = value
            }
          }
        }

        if (insertPrevState) {
          const lcEndDP = dataSet.data.pop()
          const prevValueDP = dataSet.data.pop()
          if (lcEndDP && prevValueDP) {
            // do we have a prev. state in same lifecycle?
            if (lcId === prevValueDP.lcId) {
              // same lifecycle
              // update lifecycle end as it might have changed
              if (lcEndDP.x !== lifecycle.lifecycleEnd.valueOf()) {
                lcEndDP.x = lifecycle.lifecycleEnd.valueOf()
                prevValueDP.x = lcEndDP.x - 1
              }

              // two cases:
              // a) same value as prev value
              // b) different value as prev value
              if (prevValueDP.y === value) {
                // a) same value
                // simply insert new data point (could be without but we want to see single points)
                dataSet.data.push(dataPoint)
                dataSet.data.push(prevValueDP)
                dataSet.data.push(lcEndDP)
              } else {
                // b) different value
                const prevDP = dataSet.data.pop()
                if (prevDP) {
                  dataSet.data.push(prevDP)
                  // insert new prevDP
                  const prevStateDP = { x: timeInMs - 1, y: prevDP.y, lcId: prevDP.lcId, t_: DataPointType.PrevStateEnd }
                  if (prevStateDP.x > prevDP.x) {
                    dataSet.data.push(prevStateDP)
                  }
                }
                dataSet.data.push(dataPoint)
                // update prevValueDP
                prevValueDP.y = value
                dataSet.data.push(prevValueDP)
                dataSet.data.push(lcEndDP)
              }
            } else {
              // new lifecycle
              dataSet.data.push(prevValueDP)
              dataSet.data.push(lcEndDP)
              dataSet.data.push(dataPoint)
              // add the two ending data points for the new lifecycle:
              dataSet.data.push({ x: lifecycle.lifecycleEnd.valueOf() - 1, y: value, lcId: lcId, t_: DataPointType.PrevStateEnd })
              dataSet.data.push({
                x: lifecycle.lifecycleEnd.valueOf(),
                y: null /*'_unus_lbl_'*/,
                lcId: lcId,
                t_: DataPointType.LifecycleEnd,
              })
            }
          } else {
            // should not happen. anyhow insert the data point
            dataSet.data.push(dataPoint)
          }
        } else {
          // did we cross a lifecycle border?
          // compare with last element: (we do know there is always one as otherwise we're in the uppdate !dataSet case)
          let lcEndDP = dataSet.data.pop()
          if (lcEndDP && lcEndDP.lcId !== dataPoint.lcId) {
            // new lifecycle
            dataSet.data.push(lcEndDP)
            dataSet.data.push(dataPoint)
            dataSet.data.push({ x: lifecycle.lifecycleEnd.valueOf(), y: NaN, lcId: lcId, t_: DataPointType.LifecycleEnd }) // todo not quite might end at wrong lifecycle. rethink whether one dataset can come from multiple LCs
          } else {
            // same lifecycle:
            dataSet.data.push(dataPoint)
            // update lifecycle end as it might have changed
            if (lcEndDP !== undefined) {
              lcEndDP.x = lifecycle.lifecycleEnd.valueOf()
              dataSet.data.push(lcEndDP)
            }
          }
        }
      }
      // yLabels?
      if (typeof value === 'string' && insertYLabels) {
        const label = `${value}`
        if (dataSet.yLabels === undefined) {
          dataSet.yLabels = ['', label]
          //console.log(`adding yLabel '${label}'`);
        } else {
          const yLabels = dataSet.yLabels
          if (dataSet.valuesMap !== undefined) {
            // add it only if the mapped value doesn't exist
            const newY = dataSet.valuesMap.get(label)
            if (!newY) {
              if (!yLabels.includes(value)) {
                yLabels.push(value)
              }
            }
          } else {
            if (!yLabels.includes(label)) {
              yLabels.push(label)
            }
          }
        }
      }
    } catch (e) {
      console.warn(`SingleReport.insertDataPoint got e='${e}'`)
    }
  }

  // add a warnning text just once
  addWarning(warning: string) {
    if (!this.warnings.includes(warning)) {
      this.warnings.push(warning)
    }
  }

  getLifecycleById(lcId: number): DltLifecycleInfoMinIF | undefined {
    for (let [ecu, lcInfos] of this.doc.lifecycles) {
      let lc = lcInfos.find((l) => l.persistentId === lcId)
      if (lc !== undefined) {
        return lc
      }
    }
    return undefined
  }
}

export class DltReport implements vscode.Disposable {
  panel: vscode.WebviewPanel | undefined
  private _gotAliveFromPanel: boolean = false
  private _msgsToPost: any[] = [] // msgs queued to be send to panel once alive
  public disposables: vscode.Disposable[]

  private _reportTitles: string[] = []

  singleReports: SingleReport[] = []

  lastChangeActive: Date | undefined

  constructor(
    private context: vscode.ExtensionContext,
    private doc: ReportDocument,
    private callOnDispose: (r: DltReport) => any,
  ) {
    this.disposables = [{ dispose: () => callOnDispose(this) }]
    this.panel = vscode.window.createWebviewPanel('dlt-logs.report', `dlt-logs report`, vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(context.extensionPath, 'media')),
        vscode.Uri.file(path.join(context.extensionPath, 'node_modules')),
      ],
    })
    //  for ${filter.name} todo think about nice naming title

    this.panel.onDidDispose(() => {
      console.log(`DltReport panel onDidDispose called.`)
      this.panel = undefined
      this.dispose() // we close now as well
    })

    this.panel.onDidChangeViewState((e) => {
      console.log(`DltReport panel onDidChangeViewState(${e.webviewPanel.active}) called.`)
      if (e.webviewPanel.active) {
        this.lastChangeActive = new Date(Date.now())
      }
    })

    this.panel.webview.onDidReceiveMessage((e) => {
      // console.log(`report.onDidReceiveMessage e=${e.message}`, e);
      this._gotAliveFromPanel = true
      // any messages to post?
      if (this._msgsToPost.length) {
        let msg: any
        while ((msg = this._msgsToPost.shift())) {
          // fifo order.
          const msgCmd = msg.command
          this.panel?.webview.postMessage(msg).then((onFulFilled) => {
            // console.log(`webview.postMessage(${msgCmd}) queued ${onFulFilled}`);
          })
        }
      }
      switch (e.message) {
        case 'clicked':
          try {
            const dateClicked: Date = new Date(e.dataPoint.x)
            console.log(`report.onDidReceiveMessage clicked date e=${dateClicked}`)
            this.doc.revealDate(dateClicked)
          } catch (err) {
            console.warn(`report.onDidReceiveMessage clicked got err=${err}`, e)
          }
          break
      }
    })

    // load template and set a html:
    const htmlFile = fs.readFileSync(path.join(this.context.extensionPath, 'media', 'timeSeriesReport.html'))
    if (htmlFile.length) {
      let htmlStr = htmlFile.toString()
      const mediaPart = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media')).toString()
      htmlStr = htmlStr.replace(/\${{media}}/g, mediaPart)
      const scriptsPart = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'node_modules')).toString()
      htmlStr = htmlStr.replace(/\${{scripts}}/g, scriptsPart)
      this.panel.webview.html = htmlStr
    } else {
      vscode.window.showErrorMessage(`couldn't load timeSeriesReport.html`)
      // throw?
    }
  }

  dispose() {
    console.log(`DltReport dispose called.`)
    if (this.panel) {
      this.panel.dispose()
      this.panel = undefined
    }
    for (let disposable of this.disposables) {
      disposable.dispose()
    }
    this.disposables.length = 0
  }

  postMsgOnceAlive(msg: any) {
    if (this._gotAliveFromPanel) {
      // send instantly
      const msgCmd = msg.command
      this.panel?.webview.postMessage(msg).then((onFulFilled) => {
        //console.log(`webview.postMessage(${msgCmd}) direct ${onFulFilled}`);
      })
    } else {
      this._msgsToPost.push(msg)
    }
  }

  addFilter(filterOrArray: DltFilter | DltFilter[]): SingleReport | undefined {
    if (!this.panel) {
      return undefined
    }

    let filters = Array.isArray(filterOrArray) ? filterOrArray : [filterOrArray]
    // filter on report ones with payloadRegex only
    filters = filters.filter((f) => f.isReport && f.payloadRegex !== undefined)
    if (!filters.length) {
      return undefined
    }

    // do we have a SingleReport with the same filters already?
    let reportToRet = undefined
    for (let singleReport of this.singleReports) {
      if (singleReport.filters.length === filters.length) {
        // all filters the same?
        let allTheSame = true
        for (let exFilter of singleReport.filters) {
          if (filters.find((f) => f.id === exFilter.id) === undefined) {
            allTheSame = false
            break
          }
        }
        if (allTheSame) {
          return undefined // could return the existing report as well but then the caller
          // can't see that it exists yet and nothing happened
        }
      }
    }
    // if we reach here this set of filters is new:
    // enable the filters: todo... rethink whether disabled report filter make sense!
    filters.forEach((f) => (f.enabled = true))

    reportToRet = new SingleReport(this, this.doc, filters)
    this.singleReports.push(reportToRet)
    return reportToRet
  }

  onDidChangeSelectedTime(time: Date[] | Date | null) {
    if (!this.panel) {
      return
    }
    this.postMsgOnceAlive({ command: 'onDidChangeSelectedTime', selectedTime: time })
  }

  updateReport() {
    if (!this.panel) {
      return
    }
    // console.log(`webview.enableScripts=${this.panel.webview.options.enableScripts}`);

    let lcInfosForReport: LCInfoForReport[] = []
    // determine the lifecycle labels so that we can use the grid to highlight lifecycle
    // start/end
    let lcDates: Date[] = []
    // sort by ecu with most msgs first (to reflect the background color encoding in logs view)
    let sortedEcus: [string, number][] = []
    this.doc.lifecycles.forEach((lcInfo, ecu) => {
      const nr = lcInfo.reduce((p, lcInfo) => p + lcInfo.nrMsgs, 0)
      sortedEcus.push([ecu, nr])
    })
    sortedEcus.sort((a, b) => {
      return b[1] - a[1]
    })
    sortedEcus.forEach(([ecu, nrMsgs]) => {
      let lcInfos = this.doc.lifecycles.get(ecu)
      if (lcInfos !== undefined) {
        lcInfos.forEach((lcInfo, idx) => {
          lcDates.push(lcInfo.isResume ? lcInfo.lifecycleResume! : lcInfo.lifecycleStart)
          lcDates.push(lcInfo.lifecycleEnd)
          lcInfosForReport.push({
            ecu: lcInfo.ecu,
            ecuLcNr: lcInfo.ecuLcNr !== undefined ? lcInfo.ecuLcNr : idx + 1,
            label: lcInfo.getTreeNodeLabel(),
            isResume: lcInfo.isResume || false,
            startDate: lcInfo.lifecycleStart,
            resumeDate: lcInfo.lifecycleResume,
            endDate: lcInfo.lifecycleEnd,
          })
        })
      }
    })
    // sort them by ascending time
    lcDates.sort((a, b) => {
      const valA = a.valueOf()
      const valB = b.valueOf()
      if (valA < valB) {
        return -1
      }
      if (valA > valB) {
        return 1
      }
      return 0
    })

    const lcStartDate: Date = lcDates[0]
    const lcEndDate: Date = lcDates[lcDates.length - 1]
    console.log(`updateReport lcStartDate=${lcStartDate}, lcEndDate=${lcEndDate}`)

    let dataSetsGroupPrios: any = {}

    let minDataPointTime: number | undefined = undefined

    // warnings that will be made visible for the customer as part of the report:
    let warnings: string[] = []

    // add a warnning text just once
    const addWarning = function (warning: string) {
      if (!warnings.includes(warning)) {
        warnings.push(warning)
      }
    }

    this._reportTitles.length = 0 // empty here

    for (let singleReport of this.singleReports) {
      this._reportTitles.push(...singleReport.reportTitles)
      warnings.push(...singleReport.warnings)
      if (
        minDataPointTime === undefined ||
        (singleReport.minDataPointTime !== undefined && minDataPointTime > singleReport.minDataPointTime)
      ) {
        minDataPointTime = singleReport.minDataPointTime
      }
      //dataSetsGroupPrios = { ...dataSetsGroupPrios, ...singleReport.dataSetsGroupPrios };
      Object.entries(singleReport.dataSetsGroupPrios).forEach((entry) => {
        dataSetsGroupPrios[entry[0]] = entry[1]
      })
    }

    this.postMsgOnceAlive({ command: 'update titles', titles: this._reportTitles, fileNames: this.doc.fileNames })

    if (warnings.length > 0) {
      this.postMsgOnceAlive({ command: 'update warnings', warnings: warnings })
    }

    // convert into an array object {label, data}
    let datasetArray: any[] = []
    this.singleReports.forEach((singleReport, index) => {
      singleReport.dataSets.forEach((data, label) => {
        // todo check if label exists already and add e.g :index ? (seems not to harm)
        datasetArray.push({
          label: label,
          dataYLabels: data,
          type: label.startsWith('EVENT_') ? 'scatter' : 'line',
          yAxis: data.yAxis,
          group: data.group,
          yExtrema: data.yExtrema,
        })
      })
    })
    if (datasetArray.length > 0) {
      this.postMsgOnceAlive({ command: 'update lcInfos', lcInfos: lcInfosForReport })
      this.postMsgOnceAlive({ command: 'update labels', labels: lcDates, minDataPointTime: minDataPointTime })
      this.postMsgOnceAlive({ command: 'update', data: datasetArray, groupPrios: dataSetsGroupPrios })
    }
  }
}

/**
 *  migrate axis from chartjs v2 to chartjs v3 format
 *
 *  converts
 *  - scaleLabel to title incl. scaleLabel.labelString to title.text
 *  - ticks.min/max/reverse -> min/max/reverse
 *  */
const migrateAxesV2V3 = function (axis: any): any {
  // do we need to convert?
  if ('scaleLabel' in axis || 'ticks' in axis) {
    console.log(`migrateAxesV2V2: converting: ${JSON.stringify(axis)}`)
    let newAxis = JSON.parse(JSON.stringify(axis))
    // scaleLabel -> title
    if ('scaleLabel' in axis) {
      newAxis.title = { ...axis.scaleLabel, text: axis.scaleLabel.labelString, labelString: undefined }
      delete newAxis.scaleLabel
    }
    // ticks -> min, max, reverse
    if ('ticks' in axis) {
      let tickObj = axis['ticks']
      if ('min' in tickObj) {
        newAxis.min = tickObj['min']
      }
      if ('max' in tickObj) {
        newAxis.max = tickObj['max']
      }
      if ('reverse' in tickObj) {
        newAxis.reverse = tickObj['reverse']
      }
      delete newAxis.ticks
    }
    console.log(`migrateAxesV2V2: to: ${JSON.stringify(newAxis)}`)
    return newAxis
  } else {
    return axis
  }
}
