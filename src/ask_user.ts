/* --------------------
 * Copyright(C) Matthias Behr, 2022.
 */

import * as vscode from 'vscode'
import { MultiStepInput, PickItem } from './quickPick'
/**
 * ask the user for a time (indirectly a date/time)
 *
 * The user is only asked to enter a time with [+xd]hh:mm[:ss] but the value returned is
 * including a full date.
 * @param refTime : start date/time used as reference and as minimum value
 * @param maxTime : opt. maximum date/time
 * @returns Promise with a Date
 */
export async function askSingleTime(refTime: Date, maxTime: Date | undefined): Promise<Date> {
  //console.log(`dlt-logs.askSingleTime(${refTime}-${maxTime})...`)

  let results = {
    refTime: refTime.valueOf(),
    maxTime: maxTime?.valueOf(),
    time: undefined as Date | undefined,
  }

  const timeInitialValue = (): string => {
    const v = `${refTime.getHours().toString().padStart(2, '0')}:${refTime.getMinutes().toString().padStart(2, '0')}:${refTime
      .getSeconds()
      .toString()
      .padStart(2, '0')}`
    return v
  }
  const timeRestrictPIs: PickItem[] = [new PickItem('')]
  const timeRestrictItems = (): PickItem[] => {
    const val = timeInitialValue()
    timeUpdateHintOrError(val, refTime, val.length === 0 ? `enter time like: '[+xd]hh:mm[:ss]' (xd as additional days (e.g. +2d)).` : '')
    return timeRestrictPIs
  }
  const timeRestrictRegExp = new RegExp(/^(\+\d+d)?([0-2]\d:[0-5]\d(:[0-5]\d)?)?$/)
  const timeRestrictMoreItemsEvent: vscode.EventEmitter<PickItem[] | undefined> = new vscode.EventEmitter<PickItem[] | undefined>()

  const timeIsValid = (v: string, storeValue: boolean = false): boolean => {
    if (!v.length) {
      if (storeValue) {
        results.time = undefined
      } else {
        timeUpdateHintOrError(v, undefined, `enter time like: '[+xd]hh:mm[:ss]' (xd as additional days (e.g. +2d)).`)
      }
      return true
    }
    const rTest = timeRestrictRegExp.test(v)
    if (!rTest) {
      timeUpdateHintOrError('', undefined, `not matching '[+xd]hh:mm[:ss]'`, true)
      return false
    }
    // parse the times:
    const timeR = timeRestrictRegExp.exec(v)
    if (timeR !== null) {
      const gotDays = timeR[1] !== undefined
      const gotTimeFrom = timeR[2] !== undefined
      if (!gotTimeFrom) {
        timeUpdateHintOrError('', undefined, `invalid time`, true)
        return false
      }

      const timeFrom = new Date(refTime.valueOf())
      if (gotTimeFrom) {
        const dayPart = timeR[1]
        const timeParts = timeR[2].split(':')
        timeFrom.setHours(Number(timeParts[0]), Number(timeParts[1]), timeParts.length >= 3 ? Number(timeParts[2]) : 0, 0)
        if (gotDays) {
          const days = Number(dayPart.slice(1, -1))
          // console.log(`dlt-logs.askSingleTime.timeIsValid gotDays: ${days} from '${dayPart}'`);
          timeFrom.setTime(timeFrom.valueOf() + days * (1000 * 60 * 60 * 24)) // advance by days
        }
        if (timeFrom.valueOf() < refTime.valueOf() - refTime.getMilliseconds()) {
          //console.log(`dlt-logs.askSingleTime.timeIsValid autoadvances a day`);
          timeFrom.setTime(timeFrom.valueOf() + 1000 * 60 * 60 * 24) // advance by one day
        }
      }
      if (maxTime !== undefined && maxTime.valueOf() < timeFrom.valueOf()) {
        timeUpdateHintOrError(v, timeFrom, `too late! Max: ${maxTime.toLocaleString()}, got:`, true)
        return false
      }
      if (storeValue) {
        results.time = timeFrom
      } else {
        timeUpdateHintOrError(v, gotTimeFrom ? timeFrom : undefined)
      }
      return true
    } else {
      return false
    }
  }

  const timeOnMoreItems = (cancel: vscode.CancellationToken) => {
    // we do this to get an event to trigger the items update at timeRestrictIsValid...
    setTimeout(() => timeRestrictMoreItemsEvent.fire(undefined), 10)
    return timeRestrictMoreItemsEvent.event
  }

  const timeUpdateHintOrError = (v: string, time: Date | undefined, hintOrErrorText?: string, error: boolean = false) => {
    const newDesc = `${hintOrErrorText !== undefined ? `${error ? 'Error: ' : ''}${hintOrErrorText} ` : ''}${
      time !== undefined ? time.toLocaleString() : ''
    }`
    // we must send the same value only once to avoid endless updates!
    if (timeRestrictPIs[0].name !== v || timeRestrictPIs[0].description !== newDesc) {
      timeRestrictPIs[0].name = v
      timeRestrictPIs[0].description = newDesc
      timeRestrictMoreItemsEvent.fire(timeRestrictPIs)
    }
  }

  const timeOnValue = (v: string) => {
    timeIsValid(v, true)
  }

  let toRet = new Promise<Date>((resolve, reject) => {
    let stepInput = new MultiStepInput(
      `Enter `,
      [
        {
          title: `time [${refTime.toLocaleTimeString()}${maxTime ? `- ${maxTime.toLocaleString()}` : `...`}]`,
          initialValue: timeInitialValue,
          items: timeRestrictItems,
          isValid: timeIsValid,
          onValue: timeOnValue,
          onMoreItems: timeOnMoreItems,
          canSelectMany: false,
        },
      ],
      { canSelectMany: false },
    )
    stepInput.run().then(
      async () => {
        if (results.time !== undefined) {
          resolve(results.time)
        } else {
          reject(`no time entered`)
        }
      },
      (reason) => reject(reason),
    )
  })
  return toRet
}
