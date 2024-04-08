/* --------------------
 * Copyright (C) Matthias Behr, 2020
 */

import * as vscode from 'vscode'
import { stringify } from 'safe-stable-stringify'

let _nextUniqueId: number = 1

export function createUniqueId(): string {
  const toRet = _nextUniqueId.toString()
  _nextUniqueId++
  return toRet
}

// adapted from https://stackoverflow.com/questions/20070158/string-format-not-work-in-typescript
export function stringFormat(str: string, args: RegExpExecArray): string {
  return str.replace(/{(\d+)}/g, function (match, number) {
    return typeof args[number] !== 'undefined' ? args[number] : match
  })
}

/* return a printable string. unprintable chars get replace by replaceChar 
   we do need to avoid string += operator here as this leads to lots of small strings
   that get referenced as sliced strings... */
export function printableAscii(buf: Buffer, replaceChar: number = 45 /*'-'*/): string {
  let res = Buffer.allocUnsafe(buf.length)
  for (let i = 0; i < buf.length; ++i) {
    if (buf[i] >= 0x20 /* space */ && buf[i] <= 0x7e) {
      res[i] = buf[i] // access as UInt8Array
    } else {
      res[i] = replaceChar
    }
  }
  return res.toString()
}

function precalcHexArray(): string[] {
  const toRet = []
  for (let i = 0; i <= 0xff; ++i) {
    toRet.push(i.toString(16).padStart(2, '0'))
  }
  return toRet
}
const hexArray = precalcHexArray()

/*
 output as hexdump in the simplest form: xx xx xx ...
*/
export function toHexString(buf: Buffer): string {
  const tempHex: string[] = []

  for (let i = 0; i < buf.length; ++i) {
    tempHex.push(hexArray[buf[i]])
  }

  return tempHex.join(' ')
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

// from https://gist.github.com/ca0v/73a31f57b397606c9813472f7493a940
// with MIT license
// slightly adapted
export const debounce = <F extends (...args: any[]) => any>(func: F, waitFor: number) => {
  let timeout: NodeJS.Timeout

  return (...args: Parameters<F>): Promise<ReturnType<F>> =>
    new Promise((resolve) => {
      if (timeout) {
        clearTimeout(timeout)
      }

      timeout = setTimeout(() => resolve(func(...args)), waitFor)
    })
}

export const throttle = <F extends (...args: any[]) => any>(func: F, waitFor: number) => {
  const now = () => new Date().getTime()
  const resetStartTime = () => (startTime = now())
  let timeout: NodeJS.Timeout
  let startTime: number = now() - waitFor

  return (...args: Parameters<F>): Promise<ReturnType<F>> =>
    new Promise((resolve) => {
      const timeLeft = startTime + waitFor - now()
      if (timeout) {
        clearTimeout(timeout)
      }
      if (startTime + waitFor <= now()) {
        resetStartTime()
        resolve(func(...args))
      } else {
        timeout = setTimeout(() => {
          resetStartTime()
          resolve(func(...args))
        }, timeLeft)
      }
    })
}

// taken from https://stackoverflow.com/questions/38213668/promise-retry-design-patterns
// slightly adapted to TS

export function retryOperation<T>(operation: (retries_left: number) => Promise<T>, delay: number, retries: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    return operation(retries)
      .then(resolve)
      .catch((reason) => {
        if (retries > 0) {
          return sleep(delay)
            .then(retryOperation.bind(null, operation, delay, retries - 1))
            .then((value) => resolve(value as T))
            .catch(reject)
        }
        return reject(reason)
      })
  })
}

export function updateConfiguration(section: string, newValue: any) {
  // we should try to update first:
  // workspaceFolderValue
  // workspaceValue
  // globalValue

  try {
    const config = vscode.workspace.getConfiguration()
    const curSet = config.inspect(section)
    //console.log(`curSet.workspaceFolderValue = ${curSet?.workspaceFolderValue}`);
    //console.log(`curSet.workspaceValue = ${curSet?.workspaceValue}`);
    //console.log(`curSet.globalValue = ${curSet?.globalValue}`);
    // check which one exist and add there
    // order (highest first): workspaceFolder, workspace, global (, default)
    // we don't merge the object (as getConfiguration does)
    const target: vscode.ConfigurationTarget =
      curSet?.workspaceFolderValue !== undefined
        ? vscode.ConfigurationTarget.WorkspaceFolder
        : curSet?.workspaceValue !== undefined
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global
    console.log(`util.updateConfiguration(section=${section}) updating target=${target}`)
    return config.update(section, newValue, target)
  } catch (err) {
    console.error(`err ${err} at updating configuration '${section}'`)
  }
}

export interface RestObject {
  id: string | number
  type: string
  attributes?: object
  // relationsships
  // links
  meta?: object
}

/**
 * applies the objConvFunc on the objects.
 * @param objects array of the objects to convert
 * @param objConvFunc function that returns a RestObject for a single object
 */
export function createRestArray(objects: object[], objConvFunc: (o: object, i: number) => RestObject): RestObject[] {
  return objects.map((object, index) => {
    const restObj = objConvFunc(object, index)
    return restObj
  })
}

/**
 * escape a text to be use inside markdown.
 * E.g. the chars \,`, *, _, { }, ... need to be escape
 * for markdown syntax.
 * @param text raw text that should be escaped
 * @returns escaped text
 */
export function escapeMarkdown(text: string | undefined): string {
  if (!text) {
    return ''
  }
  let toRet = text.replace(/\\/g, '\\\\')
  toRet = toRet.replace(/\#/g, '\\#')
  toRet = toRet.replace(/\-/g, '\\-')
  toRet = toRet.replace(/\+/g, '\\+')
  toRet = toRet.replace(/\!/g, '\\!')
  toRet = toRet.replace(/\./g, '\\.')
  toRet = toRet.replace(/\*/g, '\\*')
  toRet = toRet.replace(/\(/g, '\\(')
  toRet = toRet.replace(/\)/g, '\\)')
  toRet = toRet.replace(/\>/g, '\\>')
  toRet = toRet.replace(/\</g, '\\<')
  toRet = toRet.replace(/\[/g, '\\[')
  toRet = toRet.replace(/\]/g, '\\]')
  toRet = toRet.replace(/\{/g, '\\{')
  toRet = toRet.replace(/\}/g, '\\}')
  toRet = toRet.replace(/\_/g, '\\_')
  toRet = toRet.replace(/\`/g, '\\`')

  // pipe should be escaped using &#124;
  toRet = toRet.replace(/\|/g, '&#124;')
  //console.log(`escapedMarkdown('${text}')='${toRet}'`);

  return toRet
}

// from https://github.com/microsoft/vscode-webview-ui-toolkit-samples/blob/main/frameworks/hello-world-react-vite/src/utilities/getNonce.ts
/**
 * A helper function that returns a unique alphanumeric identifier called a nonce.
 *
 * @remarks This function is primarily used to help enforce content security
 * policies for resources/scripts being executed in a webview context.
 *
 * @returns A nonce
 */
export function getNonce() {
  let text = ''
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length))
  }
  return text
}

/**
 * A helper function which will get the webview URI of a given file or resource.
 *
 * @remarks This URI can be used within a webview's HTML as a link to the
 * given file/resource.
 *
 * @param webview A reference to the extension webview
 * @param extensionUri The URI of the directory containing the extension
 * @param pathList An array of strings representing the path to a file/resource
 * @returns A URI pointing to the file/resource
 */
export function getUri(webview: vscode.Webview, extensionUri: vscode.Uri, pathList: string[]) {
  return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...pathList))
}

/**
 * check whether the given string contains any regex chars ^$*+?()[]{}|.-\=!<,
 * @param s string to search for regex chars
 * @returns whether the string contains any regex chars
 */
export function containsRegexChars(s: string): boolean {
  let pos = s.search(/[\^\$\*\+\?\(\)\[\]\{\}\|\.\-\\\=\!\<]/)
  // console.log(`containsRegexChars('${s}') pos=${pos}`);
  return pos >= 0
}

/**
 * Finds the partition point in an array based on a given predicate function.
 *
 * The array must be sorted in such a way that all values that match the predicate
 * are located before all values that do not match the predicate.
 *
 * @param {any[]} arr - The array to search in.
 * @param {(value: any) => boolean} predicate - The predicate function used to determine the partition point.
 * @returns {number} - The index of the partition point in the array.
 */
export function partitionPoint(arr: any[], predicate: (value: any) => boolean): number {
  let first = 0
  let count = arr.length

  while (count > 0) {
    const step = (count / 2) | 0
    let it = first + step
    if (predicate(arr[it])) {
      first = ++it
      count -= step + 1
    } else {
      count = step
    }
  }

  return first
}

/**
 * Safely converts an object to a string representation, including support for BigInts.
 *
 * @param obj - The object to stringify.
 * @returns The string representation of the object.
 */
export function safeStableStringify(obj: any): string | undefined {
  // safe-stable-stringify handles bigints but by representing as number strings that
  // later on cannot be parsed and where the info that it was a bigint got lost
  // so we convert bigints to strings with the number + 'n' here
  return stringify(obj, (_, v) => (typeof v === 'bigint' ? v.toString() + 'n' : v))
}
