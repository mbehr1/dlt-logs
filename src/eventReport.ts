import * as vscode from 'vscode'
import { DataSet, SingleReportIF } from './dltReport'
import { DltFilter } from './dltFilter'
import * as uv0 from 'dlt-logs-utils'
import { DltLifecycleInfoMinIF } from './dltLifecycle'
import { FbEvent, FbSeqOccurrence, FbSequenceResult, FbStepRes } from 'dlt-logs-utils/sequence'

interface ReportEventIF {
  lifecycle: DltLifecycleInfoMinIF
  timeInMs: number
  msgIndex?: number
  color?: string
  name: string
}

// the event data:
// we can represent a list of:
// - a single event (shown as point in time)
// - a range of events (shown as lines: start time, via ... , end time)
type EventType = ReportEventIF | ReportEventIF[]

type EventReportData = {
  eventsType: string // Used as lane name
  events: EventType[]
}[]

/**
 * convert a sequence result to a list of events
   each occurrence is represented by two events: start and end
  if the end event is missing, we only return the start event
 * @param seqRes 
 * @returns array of events
 */
export const reportEventsFromSeq = (seqRes: FbSequenceResult) => {
  return [
    {
      eventsType: 'occ.',
      events: seqRes.occurrences.map((occ, idx) => {
        const firstEvent = occ.startEvent
        const lastEvent = lastEventForOccurrence(occ)
        if (lastEvent && lastEvent.timeInMs) {
          // we return two events
          const color = resAsColor(occ.result)
          return [
            {
              lifecycle: firstEvent.lifecycle!, // todo!
              timeInMs: firstEvent.timeInMs || 0,
              color,
              name: `occ. #${idx + 1}`,
            },
            {
              lifecycle: lastEvent.lifecycle!, // todo!
              timeInMs: lastEvent.timeInMs,
              color,
              name: `occ. #${idx + 1} end`,
            },
          ]
        } else {
          // we return one event
          return {
            lifecycle: firstEvent.lifecycle!, // todo!
            timeInMs: firstEvent.timeInMs || 0,
            color: resAsColor(occ.result),
            name: `occ. #${idx + 1}`,
          }
        }
      }),
    },
  ]
}

export class EventReport implements SingleReportIF {
  // the data for the report / in DltReport format:
  public dataSets: Map<string, DataSet> = new Map<string, DataSet>()
  public minDataPointTime?: number | undefined
  public warnings: string[] = []
  public reportTitles: string[]
  public filters: DltFilter[] = []
  public dataSetsGroupPrios: Record<string, number> = {}

  constructor(
    private log: vscode.LogOutputChannel,
    title: string,
    eventsData: EventReportData,
    private callOnDispose: (r: EventReport) => void,
  ) {
    this.reportTitles = [title]
    this.update(eventsData)
  }

  dispose() {
    this.log.info('EventReport.dispose')
    this.callOnDispose(this)
  }

  public update(eventsData: EventReportData) {
    const log = this.log
    // update the dataSets based on the events
    this.dataSets.clear()
    this.minDataPointTime = undefined
    for (const { eventsType, events } of eventsData) {
      log.trace(`EventReport.update: eventsType='${eventsType}' #events=${events.length}`)
      for (const event of events) {
        if (Array.isArray(event)) {
          if (event.length > 1) {
            // range of events // TODO impl it for all events and not just first and last and refactor with single event
            const startEvent = event[0]
            const endEvent = event[event.length - 1]
            const tl = new uv0.TL(this.reportTitles[0], eventsType, startEvent.name, { tlEnds: false, color: startEvent.color })
            const tl2 = new uv0.TL(this.reportTitles[0], eventsType, endEvent.name, { tlEnds: true, color: endEvent.color })
            Object.keys(tl).forEach((valueName) => {
              const dataPointS = { x: startEvent.timeInMs, y: tl[valueName], lcId: startEvent.lifecycle.persistentId }
              const dataPointE = { x: endEvent.timeInMs, y: tl2[valueName], lcId: endEvent.lifecycle.persistentId }
              if (dataPointE.x <= dataPointS.x) {
                dataPointE.x = dataPointS.x + 0.1 // 0.1ms
              }
              // log.info(`EventReport.update: valueName=${valueName} #dataPoint=2 x1=${dataPointS.x} x2=${dataPointE.x}`)
              const dataSet = this.dataSets.get(valueName)
              if (!dataSet) {
                this.dataSets.set(valueName, { data: [dataPointS, dataPointE] })
              } else {
                dataSet.data.push(dataPointS)
                dataSet.data.push(dataPointE)
              }
              if (this.minDataPointTime === undefined || this.minDataPointTime > startEvent.timeInMs) {
                this.minDataPointTime = startEvent.timeInMs
              }
            })
          }
        } else {
          // single event
          const tl = new uv0.TL(this.reportTitles[0], eventsType, event.name, { tlEnds: true, color: event.color })
          Object.keys(tl).forEach((valueName) => {
            const dataPoint = { x: event.timeInMs, y: tl[valueName], lcId: event.lifecycle.persistentId }
            // log.info(`EventReport.update: valueName=${valueName} dataPoint=${JSON.stringify(dataPoint)}`)
            const dataSet = this.dataSets.get(valueName)
            if (!dataSet) {
              this.dataSets.set(valueName, { data: [dataPoint] })
            } else {
              dataSet.data.push(dataPoint)
            }
            if (this.minDataPointTime === undefined || this.minDataPointTime > event.timeInMs) {
              this.minDataPointTime = event.timeInMs
            }
          })
        }
      }
    }
  }
}

// TODO: move to dlt-logs-utils
function resAsColor(res: string): string {
  if (res.startsWith('ok')) {
    return 'green'
  } else if (res.startsWith('warn')) {
    return 'yellow'
  } else if (res.startsWith('error')) {
    return 'red'
  }
  return 'gray'
}

function lastEventForFbStepRes(stepRes: FbStepRes): FbEvent | undefined {
  switch (stepRes.stepType) {
    case 'filter':
      return stepRes.res
      break
    case 'alt':
      return lastEventForFbStepRes(stepRes.res)
      break
    case 'sequence':
      return lastEventForOccurrence(stepRes.res)
      break
    case 'par':
      {
        let lastEvent = undefined
        let lastTimeInMs = 0
        for (const resArray of stepRes.res) {
          for (const res of resArray) {
            const event = lastEventForFbStepRes(res)
            if (event) {
              const timeInMs = event.timeInMs || 0
              if (timeInMs > lastTimeInMs) {
                lastTimeInMs = timeInMs
                lastEvent = event
              }
            }
          }
        }
      }
      break
  }
}

function lastEventForOccurrence(occ: FbSeqOccurrence): FbEvent {
  let lastEvent = occ.startEvent
  let lastTimeInMs = lastEvent.timeInMs || 0
  for (const stepsRes of occ.stepsResult) {
    for (const stepRes of stepsRes) {
      const event = lastEventForFbStepRes(stepRes)
      if (event) {
        const timeInMs = event.timeInMs || 0
        if (timeInMs > lastTimeInMs) {
          lastTimeInMs = timeInMs
          lastEvent = event
        }
      }
    }
  }
  return lastEvent
}
