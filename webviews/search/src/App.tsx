/**
 * todo:
 * [x] get rid of 400px issue and investigate how to fill always the full height
 * [x] impl use active filters or full document toggle
 * [x] use css font from vscode (added to App.css pre {...})
 * [x] decorations 
 * [x] click on a result -> scroll to in logs (or close to time if not visible)
 * [x] impl webview disappear/unload (by adding PersistentState getState/setState)
 * [x] impl first reveal behaviour (when to show the search) (added search command/icon)
 * [x] proper toggle button (active/non-active)
 * [?] persist toggle buttons (regex,...) (weird, seems to be already even though no WebviewPanelSerializer is used)
 * [x] implement window logic (and get est. number from load result) (est. number not yet, see below, lookahead impl)
------ MVP / first release possible --- 
 * [x] search panel doesn't open on press on search icon if terminal/panel area is not shown yet
 * [x] update search results if useFilter is active and the filters in the doc are changed
 * [x] impl case-sensitive search for both regular and regex search
 * [x] persist last searchStrings and offer as drop-down (last 50, icon and key down, delete key to del entries)
 * [ ] persist last scrollToItem/last scroll pos on reload?
 * [ ] search command should put focus to input box
 * [ ] verify regex strings
 * [x] optimize time/queries while typing: delay request until typing stops for 0.7 secs (done using useDebounceCallback for search string)
 * [ ] optimize time/queries while typing: add id to requests to ignore data from prev. requests(?) (reject prev. data updates but not yet for itemCount)
 * [ ] auto search on type or only on enter key / after timeout,...? (added debounce with flush on enter, lets see whether this good or whether autosearch should be disabled)
 * [x] better status of "logs matching". check with adlt stream status (via StreamInfo)
 * [ ] shortcut for search window? (alt/option+f?)
 * [ ] impl "match whole word" button (logic: space/starts with and ends/space after?)
 * [x] check theme changes / support reload on theme change
 * [ ] fix isLightTheme doesn't get updated on theme change
 * [ ] rerun search on pressing enter in the search list (?) (if the auto upd doesnt work)
 * [ ] get rid of fixed font size/height assumptions (16px...)
 * [ ] background color for lifecycle indication (or other lifecycle indication)
 * [ ] add all decoration options from https://code.visualstudio.com/api/references/vscode-api#DecorationRenderOptions
 * [ ] add an empty last line to avoid flickering on last line with horiz. scrollbar
 * [ ] optimize click on result to jump to exact index if available
 * [x] add search within search results (FindWidget)
 * [ ] add find button for FindWidget
 * [ ] refactor FindWidget and regular search to use same VSCodeUI (or own) elements
 * [ ] FindWidget load all results
 * [ ] update docs
 * [ ] expand copy to clipboard function to find results (within search results) (if there is no selection but find has results)
 */

import { sendAndReceiveMsg, vscode } from './utilities/vscode'
import React from 'react'
import { ChangeEvent, Component, MouseEventHandler, useEffect, useRef, useState, useCallback } from 'react'
import { VscodeButton, VscodeTextfield, VscodeOption, VscodeSingleSelect, VscodeLabel } from '@vscode-elements/react-elements'
import { FixedSizeList, ListChildComponentProps } from 'react-window'
import AutoSizer from 'react-virtualized-auto-sizer'
import InfiniteLoader from 'react-window-infinite-loader'
import { useDebouncedCallback } from 'use-debounce'
import './App.css'
import { FindWidget } from './FindWidget'

const VSCodeDropdown = React.forwardRef<HTMLInputElement, any>((props, ref) => {
  return (
    <VscodeSingleSelect style={{ width: 'auto', ...props.style }} {...props} ref={ref}>
      {props.children}
    </VscodeSingleSelect>
  )
})

const VSCodeTextField = React.forwardRef<HTMLInputElement, any>((props, ref) => {
  // works as well... if elements is used directly return <vscode-textfield />
  return (
    <VscodeTextfield style={{ width: 'auto', ...props.style }} {...props} ref={ref}>
      {props.children}
    </VscodeTextfield>
  )
})

// persisted state data (in vscode.set/getState...)
// defaults are provided in case they are not contained in getState...
interface PersistedState {
  useRegex: boolean
  useCaseSensitive: boolean
  useFilter: boolean
  searchString: string
  lastUsedSearchStrings: string[]
}

// needs to be in sync with SearchPanel.ts map ...
interface Msg {
  index: number
  receptionTimeInMs: number
  calculatedTimeInMs?: number
  timeStamp: number
  ecu: string
  mcnt: number
  apid: string
  ctid: string
  mtin: string
  payloadString: string
  lifecycle?: number
  decs?: any[] // decorations options, todo change to index to map...
}

interface ConsecutiveRows {
  startIdx: number
  rows: Msg[]
}

interface StreamInfo {
  nrStreamMsgs: number
  nrMsgsProcessed: number
  nrMsgsTotal: number
}

/**
 * Add rows to the ConsecutiveRows[] in a sorted manner by startIdx
 * @param consRows existing array of ConesectiveRows that will be modified
 * @param toAdd entry to add
 * @returns index where the item was added
 */
function addRows(consRows: ConsecutiveRows[], toAdd: ConsecutiveRows): number {
  const idx = consRows.findIndex((rows) => rows.startIdx >= toAdd.startIdx)
  if (idx >= 0) {
    const curStartIdx = consRows[idx].startIdx
    if (curStartIdx === toAdd.startIdx) {
      // replace existing item if the new item has more data
      if (toAdd.rows.length > consRows[idx].rows.length) {
        consRows[idx] = toAdd
      } // else keep the existing one
    } else {
      // curStartIdx > toAdd.startIdx
      // const nextRow = consRows[idx]
      // check whether the toAdd overlaps the curStartIdx
      const toAddEndIdx = toAdd.startIdx + toAdd.rows.length - 1
      if (toAddEndIdx >= curStartIdx) {
        // console.warn(`addRows(${toAdd.startIdx}-${toAddEndIdx}) overlaps with cur. item ${curStartIdx} #${consRows[idx].rows.length}`)
        // modify the existing one and add the new rows that are not yet contained in the existing one:
        consRows[idx].rows.unshift(...toAdd.rows.slice(0, curStartIdx - toAdd.startIdx))
        consRows[idx].startIdx = toAdd.startIdx
        return idx
      }
      // insert before the idx:
      consRows.splice(idx, 0, toAdd)
    }
    return idx
  } else {
    // no existing item has a startIdx>=toAdd => all (if any) are smaller
    // add to the end
    // check whether we do overlap with the prev one:
    if (consRows.length > 0) {
      const prevRow = consRows[consRows.length - 1]
      const prevRowEndIdx = prevRow.startIdx + prevRow.rows.length - 1
      if (prevRowEndIdx >= toAdd.startIdx) {
        //console.warn(`addRows(${toAdd.startIdx}) overlaps with prev. item ${prevRow.startIdx}-${prevRowEndIdx} #${prevRow.rows.length}`)
        // add only the new rows that are not yet contained in the prevRow:
        prevRow.rows.push(...toAdd.rows.slice(prevRowEndIdx - toAdd.startIdx + 1))
        return consRows.length - 1
      }
    }
    consRows.push(toAdd)
    return consRows.length - 1
  }
}

function isFullyAvailable(consRows: ConsecutiveRows[], startIdx: number, stopIdx: number): boolean {
  if (consRows.length === 0) {
    return false
  }
  let aStartIdx = startIdx
  for (const row of consRows) {
    if (row.startIdx > aStartIdx) {
      return false
    }
    const rowEndIdx = row.startIdx + row.rows.length - 1
    if (rowEndIdx >= aStartIdx) {
      aStartIdx = rowEndIdx + 1
      if (aStartIdx > stopIdx) {
        return true
      }
    }
  }
  return false
}

type InfLoaderRequest = {
  promiseResolveCb: () => void
  startIndex: number
  stopIndex: number
}

type DataFromExtension = {
  searchId: number // unique id for this search, used as handle for the load requests
  consRows: ConsecutiveRows[] // data we did receive, strictly ordered by startIdx
  pendingRequests: InfLoaderRequest[]
  ongoingRequests: InfLoaderRequest[] // those are sent to the extension (currently just one at a time)
}

function resetDataFromExtension(data: DataFromExtension) {
  data.searchId += 1
  data.consRows.length = 0
  data.pendingRequests.forEach((r) => r.promiseResolveCb())
  data.pendingRequests.length = 0
  data.ongoingRequests.length = 0 // we can ignore them as they will be ignored due to searchId mismatch
}

function checkPendingRequests(data: DataFromExtension) {
  if (data.ongoingRequests.length === 0 && data.pendingRequests.length > 0) {
    // send a new request:
    const req = data.pendingRequests.pop() as InfLoaderRequest

    // if this is fully available we can directly resolve it:
    if (isFullyAvailable(data.consRows, req.startIndex, req.stopIndex)) {
      req.promiseResolveCb()
      checkPendingRequests(data)
      return
    }

    data.ongoingRequests.push(req)
    const searchId = data.searchId
    const startIdx = req.startIndex
    const stopIdx = req.stopIndex
    sendAndReceiveMsg({ cmd: 'load', data: { startIdx, stopIdx, searchId } }).then((res: any) => {
      if (res && Array.isArray(res.msgs)) {
        if (res.searchId !== data.searchId) {
          console.warn(
            `checkPendingRequests(${req.startIndex}-${req.stopIndex})... ignored res.searchId=${res.searchId} !== data.searchId=${data.searchId}`,
          )
          req.promiseResolveCb()
          // not needed. any newly added will trigger that. checkPendingRequests(data)
          return
        }
        const ogReq = data.ongoingRequests.pop() as InfLoaderRequest // TODO or find by start/stopIdx and remove that? curently just one at a time
        const msgs = res.msgs
        if (msgs.length > 0) {
          const curData = data.consRows
          const addedIdx = addRows(curData, { startIdx: req.startIndex, rows: msgs })
          if (curData.length > 100) {
            // prune one with highest distance from the added one:
            if (addedIdx < curData.length / 2) {
              curData.pop()
            } else {
              curData.shift()
            }
          }
          if (msgs.length < stopIdx - startIdx + 1) {
            console.warn(
              `search checkPendingRequests(${startIdx}-${startIdx + msgs.length - 1}) setData(msg.length=${msgs.length})->#${
                curData.length
              } missed=${stopIdx - startIdx + 1 - msgs.length}`,
            )
            // we cannot fully resolve the request as we need to load more data
            // modify the request and add it back to the pendingRequests
            req.startIndex += msgs.length
            data.pendingRequests.push(req)
          } else {
            /*console.log(
              `search checkPendingRequests(${startIdx}-${startIdx + msgs.length - 1}) setData(msg.length=${msgs.length})->#${
                curData.length
              }`,
            )*/
            req.promiseResolveCb()
          }
        }
      } else {
        console.warn(`checkPendingRequests(${req.startIndex}-${req.stopIndex})... unexpected res=${JSON.stringify(res)}`)
        req.promiseResolveCb() // even though its an error? (or move back to pending?)
      }
      checkPendingRequests(data)
    })
  }
}

/**
 * check whether two requests are overlapping. The stopIndex is inclusive.
 * @param a - one request
 * @param b - request to compare with
 * @returns whether a and b do overlap
 */
function areOverlapping(a: InfLoaderRequest, b: InfLoaderRequest): boolean {
  return b.startIndex < a.startIndex ? b.stopIndex >= a.startIndex : b.startIndex <= a.stopIndex
}

function addNewRequest(data: DataFromExtension, startIndex: number, stopIndex: number, promiseResolveCb: () => void) {
  // we do need to fullfil the request in any case. but the order can be different
  // we try whether we can extend any previous pending request
  //  in that case we'd add it before the previous/extended one

  const newReq = { promiseResolveCb, startIndex, stopIndex }

  for (let i = data.pendingRequests.length - 1; i >= 0; i--) {
    const req = data.pendingRequests[i]
    // does it overlap?
    if (areOverlapping(req, newReq)) {
      // extend the previous one:
      req.startIndex = Math.min(req.startIndex, newReq.startIndex)
      req.stopIndex = Math.max(req.stopIndex, newReq.stopIndex)
      // insert the newReq anyhow before the req
      data.pendingRequests.splice(i, 0, newReq)
      return
    }
  }

  // if not we add it to the end (so that it gets processed first)
  data.pendingRequests.push(newReq)
}

const isLightTheme = document.body.classList.contains('vscode-light') // else 'vscode-dark', 'vscode-high-contrast' we assume dark

// we could assign a click handler to every single sitem element but lets use just one function:
document.addEventListener('click', (e) => {
  const et = e.target
  if (et instanceof Element) {
    //console.log(`document.onClick className=${et.className} ${et.classList}`);
    let textContent: string | null | undefined
    let timeInMs: string | null | undefined

    if (et.classList.contains('sitem')) {
      textContent = et.children.item(0)?.textContent
      timeInMs = et.getAttribute('data-time')
    }
    if (et.className === '' && et.parentElement?.classList.contains('sitem')) {
      //console.log(`document.onClick parent`, et);
      textContent = et.parentElement.innerText
      timeInMs = et.parentElement.getAttribute('data-time')
    }
    if (textContent) {
      const textContentTrimmed = textContent.trimStart()
      const index = Number.parseInt(textContentTrimmed.slice(0, textContentTrimmed.indexOf(' ')))
      //console.log(`search document.click index=${index}`);
      vscode.postMessage({ type: 'click', req: { index, timeInMs: timeInMs ? Number(timeInMs) : undefined } }) // no msgId needed
      // preventDefault?
    }
  }
})

type ToggleProps = {
  icon: string
  title: string
  active: boolean
  onClick?: MouseEventHandler<HTMLElement>
}

// <div title="Match Whole Word (⌥⌘W)" class="monaco-custom-toggle codicon codicon-whole-word" tabindex="0" role="checkbox" aria-checked="false" aria-label="Match Whole Word (⌥⌘W)" aria-disabled="false" style="color: inherit;"></div>
// <div title="Use Regular Expression (⌥⌘R)" class="monaco-custom-toggle codicon codicon-regex checked" tabindex="0" role="checkbox" aria-checked="true" aria-label="Use Regular Expression (⌥⌘R)" aria-disabled="false" style="color: var(--vscode-inputOption-activeForeground); border-color: var(--vscode-inputOption-activeBorder); background-color: var(--vscode-inputOption-activeBackground);"></div>
// todo add onKeyDown logic as well? https://github.com/microsoft/vscode/blob/dc897c6c4fa6e9eecc98c70e4931dbdc16a4027c/src/vs/base/browser/ui/toggle/toggle.ts

const Toggle = (props: ToggleProps) => {
  const { icon, active } = props
  // todo tabindex?
  return (
    <div
      onClick={props.onClick}
      title={props.title}
      className={`monaco-custom-toggle codicon codicon-${icon}${active ? ' checked' : ''}`}
      role='checkbox'
      aria-checked={active}
      aria-disabled={false}
      aria-label={props.title}
    />
  )
}

const getCodicon = (name: string, disabled?: boolean) => {
  // uses the same logic from https://github.com/microsoft/vscode/blob/dc897c6c4fa6e9eecc98c70e4931dbdc16a4027c/src/vs/base/browser/ui/codicons/codicon/codicon-modifiers.css#L16
  // not officially documented. add e2e test to check that it keeps on working todo!

  return <span className={`codicon codicon-${name}${disabled ? ' codicon-modifier-disabled' : ''}`}></span>
}

const persistedState: PersistedState = {
  useRegex: true,
  useCaseSensitive: true,
  useFilter: true,
  searchString: '',
  lastUsedSearchStrings: [],
  ...(vscode.getState() || {}),
}
const MAX_LAST_USED_LIST_ITEMS = 200 // we persist max 200 last used search strings

export interface FindParams {
  findString: string
  useCaseSensitive: boolean
  useRegex: boolean
  // startIdx?: number,
  // maxMsgsToReturn?: number
}

export interface FindResults {
  findString: string // the string used initially
  findRegex: RegExp // the regex used to highlight matches
  nextSearchIdx?: number
  searchIdxs: number[] // the relative results
}

function App() {
  // console.log(`search app (render)...`);
  const inputReference = useRef<HTMLInputElement | null>(null)
  const infiniteLoaderRef = useRef<null | InfiniteLoader>(null)
  const listRef = useRef<FixedSizeList | null>(null)

  const [useRegex, setUseRegex] = useState(persistedState.useRegex)
  const [useCaseSensitive, setUseCaseSensitive] = useState(persistedState.useCaseSensitive)
  const [useFilter, setUseFilter] = useState(persistedState.useFilter)
  const [searchString, setSearchString] = useState(persistedState.searchString)
  const [lastUsedList, setLastUsedList] = useState(persistedState.lastUsedSearchStrings)

  // non-persisted state:
  const [errorText, setErrorText] = useState<string | null>(null)
  const [activeDoc, setActiveDoc] = useState<{ uri: string | null; filterGen: number }>({ uri: null, filterGen: 0 })
  const [streamInfo, setStreamInfo] = useState({ nrStreamMsgs: 0, nrMsgsProcessed: 0, nrMsgsTotal: 0 } as StreamInfo)
  const data = useRef<DataFromExtension>({ searchId: 0, consRows: [], pendingRequests: [], ongoingRequests: [] })
  const [searchDropDownOpen, setSearchDropDownOpen] = useState(false)
  const [findParams, setFindParams] = useState<[FindParams, boolean]>([{ findString: '', useCaseSensitive: false, useRegex: false }, false])
  const [findRes, setFindRes] = useState<FindResults | string | undefined>(undefined) // string for error message
  const isAllSelected = useRef<boolean>(false)

  const debouncedSetSearchString = useDebouncedCallback(
    (value) => {
      setSearchString(value)
    },
    700, // 700ms delay till automatic search
  )

  // loadMoreItesm will be called multiple times for the same range if the range is not yet loaded esp. on scrolling 0..20, 0..21, 0..22, ...
  // in case where the response comes for an older search string/params it will be ignored (detected via searchId comparison)

  const loadMoreItems = useCallback((startIndex: number, stopIndex: number): Promise<void> => {
    // console.log(`search loadMoreItems(${startIndex}-${stopIndex})...`)

    const searchId = data.current.searchId

    // we add it to the pendingRequests and return a promise that will be resolved once all the data is loaded/available
    // return null if already all data is loaded/available!
    /* TODO the types is ...Promise<void>. the code https://github.com/bvaughn/react-window-infinite-loader/blob/314f3c3125805b85ccd96cb5c110319fcf32572c/src/InfiniteLoader.js#L144
       checks for != null
    
    if (isFullyAvailable(data.current.consRows, startIndex, stopIndex)) {
      return null
    }*/

    return new Promise<void>((resolve, _reject) => {
      if (data.current.searchId != searchId || isFullyAvailable(data.current.consRows, startIndex, stopIndex)) {
        console.log(`search loadMoreItems(${startIndex}-${stopIndex}) resolving immediately as invalid or fully available`)
        resolve()
      } else {
        // we always add the last to the end of the queue (we use it as a stack)
        addNewRequest(data.current, startIndex, stopIndex, resolve)
        checkPendingRequests(data.current)
      }
    })
  }, [])

  // persist state on changes: (todo should we debounce a bit? use debouncedSetSearchString.isPending() .flush()?
  useEffect(() => {
    persistedState.useRegex = useRegex
    persistedState.useCaseSensitive = useCaseSensitive
    persistedState.useFilter = useFilter
    persistedState.searchString = searchString
    persistedState.lastUsedSearchStrings = lastUsedList.slice(0, MAX_LAST_USED_LIST_ITEMS)
    vscode.setState(persistedState)
  }, [useRegex, useCaseSensitive, useFilter, searchString, lastUsedList])

  useEffect(() => {
    let active = true
    // console.log(`search cleanup useEffect... active=true`)
    // reset search results and related items
    setStreamInfo({ nrStreamMsgs: 0, nrMsgsProcessed: 0, nrMsgsTotal: 0 })
    isAllSelected.current = false
    resetDataFromExtension(data.current)
    setErrorText(null)
    if (activeDoc.uri && !debouncedSetSearchString.isPending()) {
      vscode.postMessage({ type: 'click', req: { index: -1, timeInMs: undefined } }) // to unselect any msgTimeHighlights
      if (searchString.length > 0) {
        sendAndReceiveMsg({ cmd: 'search', data: { searchString, useRegex, useCaseSensitive, useFilter } }).then((res: any) => {
          if (active) {
            if (Array.isArray(res)) {
              if (infiniteLoaderRef.current) {
                if (data.current.consRows.length > 0) {
                  console.warn(`resetloadMoreItemsCache but data not empty! #${data.current.consRows.length}`)
                }
                /*console.log(
                  `search lastRenderedStartIndex=${(infiniteLoaderRef.current as any)._lastRenderedStartIndex} ${
                    (infiniteLoaderRef.current as any)._lastRenderedStopIndex
                  }`,
                )
                console.log(
                  `search props.itemCount=${(infiniteLoaderRef.current as any).props.itemCount} streamInfo.nrMsgsTotal=${
                    streamInfo.nrMsgsTotal
                  }`,
                )
                console.log(`search _memoizedUnloadedRanges=${(infiniteLoaderRef.current as any)._memoizedUnloadedRanges.length}`)*/
                infiniteLoaderRef.current.resetloadMoreItemsCache(true)
              }
              setLastUsedList((l) => {
                const curIdx = l.indexOf(searchString)
                if (curIdx === 0) {
                  return l
                } // no update needed
                // remove if duplicate else remove last if list too long
                const newL = l.slice()
                if (curIdx > 0) {
                  newL.splice(curIdx, 1)
                } else {
                  // new entry (searchString) not in the list yet
                  // we check whether it's similar to an existing one.
                  // similar by: an other entry is the start of the new one and the rest doesn't start with a |
                  // (we do want to keep entries before the | or in other word | starts a new entry)

                  let similarEntryIdx = newL.reduce((acc, curEntry, idx, arr) => {
                    if (
                      (acc < 0 || curEntry.length > arr[acc].length) &&
                      searchString.startsWith(curEntry) &&
                      searchString[curEntry.length] !== '|'
                    ) {
                      // we want the longest similar entry
                      return idx
                    }
                    return acc
                  }, -1)

                  if (similarEntryIdx >= 0) {
                    console.log(
                      `search similarEntryIdx=${similarEntryIdx} curEntry='${newL[similarEntryIdx]}' replaced by new searchString='${searchString}'`,
                    )
                    // remove the similar entry
                    newL.splice(similarEntryIdx, 1)
                  }

                  if (newL.length > MAX_LAST_USED_LIST_ITEMS) {
                    newL.pop()
                  }
                }
                newL.unshift(searchString) // add to front
                return newL
              })
            } else {
              console.log(`search res=${JSON.stringify(res)}`)
              if ('err' in res) {
                setErrorText('' + res.err)
              }
            }
          } else {
            //console.warn(`search useEffect ignored result due to !active!`);
          }
        })
      }
    }
    return () => {
      // console.log(`search cleanup useEffect... active=false`)
      active = false
    }
  }, [useFilter, useCaseSensitive, useRegex, searchString, activeDoc, loadMoreItems]) // we want it to trigger if activeDoc.filterGen changes as well

  useEffect(() => {
    const focusCb = (msg: any) => {
      console.log(`search focusCb. msg=${JSON.stringify(msg)}`)
      if (inputReference.current) {
        ;(inputReference.current as any).focus()
      } else {
        console.log(`search focusCb. but no inputReference`)
      }
    }
    vscode.addMessageListener('focus', focusCb)

    const streamInfoCb = (msg: any) => {
      console.log(`search streamInfoCb. msg=${JSON.stringify(msg)}`)
      if ('streamInfo' in msg) {
        setStreamInfo((d) => {
          return { ...d, ...msg.streamInfo }
        })
      }
    }
    vscode.addMessageListener('streamInfo', streamInfoCb)

    // send a first hello/ping:
    vscode.postMessage({ type: 'hello', req: {} }) // no msgId needed

    return () => {
      vscode.removeMessageListener('streamInfo', streamInfoCb)
      vscode.removeMessageListener('focus', focusCb)
    }
  }, [])

  const scrollToItem = useCallback(
    (itemIndex: number) => {
      if (listRef.current) {
        console.log(`search find scrolling to: ${itemIndex}`)
        listRef.current.scrollToItem(itemIndex)
      }
    },
    [listRef],
  )

  useEffect(() => {
    let active = true
    if (activeDoc.uri && findParams[0].findString.length > 0) {
      sendAndReceiveMsg({ cmd: 'find', data: findParams[0] }).then(
        (res) => {
          if (active) {
            try {
              if (res && res.err !== undefined) {
                console.log(`search find got err '${res.err}'`)
                setFindRes(res.err)
              } else {
                console.log(`search find got: #${res.search_idxs.length} find results`)
                // create regex for match highlighting:
                const findRegex = findParams[0].useRegex
                  ? new RegExp(findParams[0].findString, findParams[0].useCaseSensitive ? 'g' : 'gi')
                  : new RegExp(escapeRegExp(findParams[0].findString), findParams[0].useCaseSensitive ? 'g' : 'gi')

                setFindRes({
                  findString: findParams[0].findString,
                  findRegex,
                  nextSearchIdx: res.next_search_idx !== null ? res.next_search_idx : undefined,
                  searchIdxs: res.search_idxs,
                })
                if (res.search_idxs.length > 0) {
                  scrollToItem(res.search_idxs[0])
                }
              }
            } catch (e) {
              console.error(`search find got e=${e}`, res)
            }
          } else {
            console.log(`search find ignored results for (${findParams[0].findString}) due to not active!`)
          }
        },
        (errorString: string) => {
          console.error(`search find got e=${errorString}`)
        },
      )
    } else {
      setFindRes(undefined)
    }
    return () => {
      active = false
    }
  }, [findParams, useFilter, useCaseSensitive, useRegex, searchString, activeDoc])

  const triggerFind = (params: FindParams, findAll?: boolean) => {
    // todo impl. findAll...
    console.log(`search find triggerFind called ${params.findString}...`)
    setFindParams([params, !!findAll])
  }

  useEffect(() => {
    const docUpdateCb = (msg: any) => {
      console.log(`search docUpdateCb. msg=${JSON.stringify(msg)}`)
      if ('docUri' in msg) {
        setActiveDoc((d) => {
          return { ...d, uri: msg.docUri as string }
        })
      }
      if ('onApplyFilter' in msg) {
        if (useFilter) {
          setActiveDoc((d) => {
            return { ...d, filterGen: d.filterGen + 1 }
          })
        }
      }
    }
    vscode.addMessageListener('docUpdate', docUpdateCb)
    return () => {
      vscode.removeMessageListener('docUpdate', docUpdateCb)
    }
  }, [useFilter])

  // todo this might lead to the that "denied" data not being loaded or better only on next scroll
  // const singleLoadMoreItems = loadPending ? (startIndex: number, stopIndex: number) => { console.log(`search ignored load [${startIndex}-${stopIndex})`); } : loadMoreItems;

  const isItemLoaded = (index: number): boolean => {
    // check whether we do have this item... this is kind of slow...
    for (const rows of data.current.consRows) {
      if (rows.startIdx <= index && index < rows.startIdx + rows.rows.length) {
        // console.log(`isItemLoaded(${index})=true`)
        return true
      }
      if (rows.startIdx > index) {
        // console.log(`isItemLoaded(${index})= break false (startIdx=${rows.startIdx})`)
        return false
      }
    }
    // console.log(`isItemLoaded(${index})=false`)
    return false
  }

  const getItem = (index: number): Msg | undefined => {
    // console.log(`getItem(${index})...`)
    // check whether we do have this item... this is kind of slow...
    for (const rows of data.current.consRows) {
      if (rows.startIdx <= index && index < rows.startIdx + rows.rows.length) {
        // console.log(`getItem(${index}) true`)
        return rows.rows[index - rows.startIdx]
      }
      if (rows.startIdx > index) {
        // console.log(`getItem(${index})= break undefined (startIdx=${rows.startIdx})`)
        return undefined
      }
    }
    // console.log(`getItem(${index}) undefined`)
    return undefined
  }

  const renderListRow = (props: ListChildComponentProps) => {
    const { index, style } = props
    const msg = getItem(index)
    if (msg) {
      const str = `${String(Number(msg.index)).padStart(6, ' ')} ${new Date(msg.receptionTimeInMs).toLocaleTimeString()} ${(
        msg.timeStamp / 10000
      )
        .toFixed(4)
        .padStart(9)} ${msg.ecu.padEnd(4)} ${msg.apid.padEnd(4)} ${msg.ctid.padEnd(4)} ${msg.payloadString}`
      const strLen = str.length

      // todo what's the width of this font? it will be monospace but what's the char width?
      // use https://stackoverflow.com/questions/118241/calculate-text-width-with-javascript ?
      const textWidthInPx = strLen * 8 // todo!

      // decorations?
      let backgroundColor: string | undefined
      let borderWidth: string | undefined
      let borderColor: string | undefined
      let borderStyle: string | undefined
      let color: string | undefined

      // for multiple decs the last one determines/overwrites:
      if (msg.decs && msg.decs.length) {
        const evalDec = (dec: any) => {
          for (const [key, value] of Object.entries(dec)) {
            updMsgDec(key, value, dec)
          }
        }

        const updMsgDec = (key: string, value: unknown, obj: any) => {
          switch (key) {
            case 'backgroundColor':
              backgroundColor = value as string
              break
            case 'borderWidth':
              borderWidth = value as string
              break
            case 'borderColor':
              borderColor = value as string
              break
            case 'borderStyle':
              borderStyle = value as string
              break
            case 'color':
              color = value as string
              break
            case 'light':
              if (isLightTheme) {
                evalDec(value)
              }
              break
            case 'dark':
              if (!isLightTheme) {
                evalDec(value)
              }
              break
            case 'overviewRulerColor': // fallthrough
            case 'overviewRulerLane': // fallthrough
            case 'isWholeLine':
              break // ignore
            default:
              console.warn(`renderListRow ignored key '${key}' from dec=${JSON.stringify(obj)}`)
          }
        }

        msg.decs.forEach((d) => evalDec(d))
      }

      // we do use outline instead of border to have the border drawn within and not around our item

      const isFindMatch = findRes && typeof findRes === 'object' && findRes.searchIdxs.includes(index)
      let frag: JSX.Element
      if (isFindMatch) {
        // find all matches as there can be more than 1 within one log:
        let match
        let r = findRes.findRegex
        r.lastIndex = 0
        let prevLastIndex = r.lastIndex
        let idxToProcess = 0
        let frags: JSX.Element[] = []
        while ((match = r.exec(str)) != null) {
          const foundText = match[0]
          const foundIdxStart = match.index
          const foundIdxEnd = r.lastIndex
          // console.log(`search renderListRow index #${index} found match ${foundIdxStart}-${foundIdxEnd} idxToProcess=${idxToProcess}`);

          if (foundIdxStart > idxToProcess) {
            frags.push(<pre>{str.slice(idxToProcess, foundIdxStart)}</pre>)
          }
          frags.push(<pre className='sitemFindMatch'>{foundText}</pre>)
          idxToProcess = foundIdxEnd

          if (r.lastIndex === prevLastIndex) {
            r.lastIndex += 1
          } // see warnings on https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/exec
          prevLastIndex = r.lastIndex
        }
        // add end of str:
        if (str.length > idxToProcess) {
          frags.push(<pre>{str.slice(idxToProcess)}</pre>)
        }

        if (frags.length <= 0) {
          console.warn(`search renderListRow no match for '${str}'`)
          frag = <pre>{str}</pre>
        } else {
          frag = <>{frags}</>
        }
      } else {
        frag = <pre>{str}</pre>
      }
      return (
        <div style={style}>
          <div
            className={isAllSelected.current ? 'sitem sitemSelected' : 'sitem'}
            data-time={msg.calculatedTimeInMs}
            style={{
              color: color,
              backgroundColor: backgroundColor,
              outlineWidth: borderWidth,
              outlineColor: borderColor,
              outlineStyle: borderStyle,
              outlineOffset: borderWidth ? '-' + borderWidth : undefined,
              width: textWidthInPx,
            }}
          >
            {frag}
          </div>
        </div>
      )
    } else {
      return (
        <div className='sitem' style={style}>
          <pre>{`${index} ...`}</pre>
        </div>
      )
    }
  }

  // taken from https://github.com/jamiebuilds/tinykeys/blob/fcf253635231925d660fd6699c9a783ecd038faf/src/tinykeys.ts#L61
  const PLATFORM = typeof navigator === 'object' ? navigator.platform : ''
  const APPLE_DEVICE = /Mac|iPod|iPhone|iPad/.test(PLATFORM)

  // the outerref (div) that the FixedSizeList is using:
  const OuterElementFixedSizeList = React.useMemo(
    () =>
      React.forwardRef<HTMLDivElement>((props, ref) => (
        <div
          {...props}
          onKeyDown={(e) => {
            if (!e.shiftKey && ((APPLE_DEVICE && e.metaKey) || (!APPLE_DEVICE && e.ctrlKey))) {
              console.log(`OuterElementFixedSizeList onKeyDown ${e.key} ${e.ctrlKey} ${e.metaKey} ${e.shiftKey} ${e.altKey}`)
              if (e.key === 'a') {
                e.preventDefault()
                e.stopPropagation()
                isAllSelected.current = !isAllSelected.current
                listRef.current?.forceUpdate()
                return false
              } else if (e.key === 'c') {
                if (isAllSelected.current) {
                  vscode.postMessage({ type: 'copy', req: { isAllSelected: isAllSelected.current } })
                  e.preventDefault()
                  e.stopPropagation()
                  // TODO disable once the next selection turn off the all selection to reflect same behaviour as in other editor windows
                  isAllSelected.current = false
                  listRef.current?.forceUpdate()
                  return false
                } else {
                  // use default handling for now to copy text selections (below seems to work as well)
                  /*
                  e.preventDefault()
                  e.stopPropagation()
                  document.execCommand('copy')*/
                }
              }
            }
          }}
          tabIndex={-1} // not included by tab but focussable via code or mouse
          ref={ref}
        />
      )),
    [], // if allSelected would be a state we cant use that as that will re-render the outer element -> the list and thus the list will loose focus
  )

  // need to observe for closing the dropdown via 'open' attribute:
  // this is mainly as we use the dropdown input only with open/expanded. once it closes we want to focus back to the main input
  // if we dont observe e.g. if the user clicks escape or clicks outside the dropdown we dont get the focus back
  // would be nicer if the VSCodeDropdown would have an event for opening/closing the dropdown
  // the previous dropdown from vscode-webui-toolkit triggered a change event on close
  useEffect(() => {
    let observer: MutationObserver | undefined
    let timeoutHandle: NodeJS.Timeout | undefined
    if (searchDropDownOpen) {
      window.postMessage({ type: 'focus' })
      // console.log(`search useEffect open dropdown`)
      // need to observe for closing the dropdown via 'open' attribute:
      observer = new MutationObserver((mutations, observer) => {
        let didClose = false
        for (const [idx, m] of mutations.entries()) {
          const target = m?.target as HTMLInputElement
          /*console.log(
            `search dropdown mutation observed: ${idx}/${mutations.length} name=${
              m.attributeName
            }: type=${m?.type} oldV=${m?.oldValue} newV=${target.getAttribute(m.attributeName!)}`,
            target,
          )*/
          if (m.type === 'attributes' && m.attributeName === 'open' && target.getAttribute('open') === null) {
            didClose = true
            break
          }
        }
        if (didClose) {
          setSearchDropDownOpen(false)
          window.postMessage({ type: 'focus' })
          observer.disconnect()
          // console.log(`search dropdown mutation observer disconnected`)
        }
      })
      timeoutHandle = setTimeout(() => {
        observer?.observe(inputReference.current as Node, {
          attributes: true,
          attributeOldValue: true,
          attributeFilter: ['open'],
        })
        // console.log(`search dropdown mutation observer observing...`)
      }, 0)
    }
    return () => {
      if (observer) {
        observer.disconnect()
        if (timeoutHandle) {
          clearTimeout(timeoutHandle)
          timeoutHandle = undefined
        }
        // console.log(`search dropdown cleanup observer disconnected`)
      }
    }
  }, [searchDropDownOpen])

  // console.log(`render search with streamInfo.nrStreamMsgs=${streamInfo.nrStreamMsgs}...`)
  return (
    <div style={{ display: 'flex', flexFlow: 'column', width: '100%', /*border: '1px solid gray',*/ height: '100%' }}>
      {!searchDropDownOpen && (
        <VSCodeTextField
          ref={inputReference}
          id='inputSearch'
          placeholder='enter search'
          autoFocus
          value={searchString}
          onInput={(iv: ChangeEvent<HTMLInputElement>) => {
            const str = iv.target.value
            debouncedSetSearchString(str)
            if (str && str.length === 0) {
              debouncedSetSearchString.flush()
            }
          }}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
            switch (e.key) {
              case 'ArrowDown':
                setSearchDropDownOpen(true)
              // fallthrough
              case 'Enter':
                debouncedSetSearchString.flush()
                break
            }
          }}
        >
          <span slot='content-before' className='codicon codicon-search'></span>
          <section slot='content-after' style={{ position: 'absolute', top: '2px' /* weird monaco has 3px */, right: '2px' }}>
            <span style={{ margin: '2px 4px' }} className='codicon codicon-chevron-down' onClick={() => setSearchDropDownOpen((d) => !d)} />
            <Toggle icon='filter' active={useFilter} title='Use current document filter' onClick={() => setUseFilter((d) => !d)} />
            <Toggle
              icon='case-sensitive'
              active={useCaseSensitive}
              title='Use case sensitive'
              onClick={() => {
                setUseCaseSensitive((d) => !d)
              }}
            />
            {false && <VscodeButton /* appearance='icon'*/ aria-label='Match Whole Word'>{getCodicon('whole-word')}</VscodeButton>}
            <Toggle icon='regex' active={useRegex} title='Use Regular Expression' onClick={() => setUseRegex((d) => !d)} />
          </section>
        </VSCodeTextField>
      )}
      {searchDropDownOpen && (
        <VSCodeDropdown
          tabIndex={0}
          ref={inputReference}
          autoFocus
          open
          id='searchDropDown'
          // todo any way to show the default items selected? value={searchString} or defaultValue dont work!
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            console.log(`search dropdown onChange`, e)
            if (e.target && 'value' in e.target) {
              setSearchString(e.target.value as string)
            }
            setSearchDropDownOpen(false)
            window.postMessage({ type: 'focus' })
          }}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
            switch (e.key) {
              case 'Delete': // delete the current entry from the list
                if (e.target && 'value' in e.target) {
                  const target = e.target as HTMLInputElement & { options: { value: string; disabled?: boolean; selected?: boolean }[] }
                  const activeOption = target.shadowRoot?.querySelector('.options .active')
                  if (activeOption) {
                    const indexToDel = activeOption ? Number(activeOption.getAttribute('data-index')) : -1
                    let toDel: string = ''
                    if (indexToDel >= 0) {
                      toDel = target.options[indexToDel]?.value
                    }
                    console.log(`search dropdown onKeyDown Delete: '${toDel}' indexToDel=${indexToDel}`, activeOption)
                    setLastUsedList((l) => {
                      const idx = l.indexOf(toDel)
                      if (idx >= 0) {
                        const newL = l.slice()
                        newL.splice(idx, 1)
                        return newL
                      } else {
                        return l
                      }
                    })
                    // remove from target as well:
                    target.options[indexToDel].disabled = true
                    e.preventDefault()
                  }
                }
                break
            }
          }}
        >
          {!lastUsedList.includes(searchString) && (
            <VscodeOption value={searchString} selected={true}>
              {searchString}
            </VscodeOption>
          )}
          {lastUsedList.map(
            (
              l, // we provide value as it might end with a space... and the contained text gets trimmed
            ) => (
              <VscodeOption value={l} selected={l === searchString}>
                {l}
              </VscodeOption>
            ),
          )}
        </VSCodeDropdown>
      )}
      {errorText !== null && <div className='inputValidation'>{errorText}</div>}
      {typeof findRes === 'string' && <div className='inputValidation'>{findRes}</div>}
      <div style={{ flexGrow: 1 }}>
        <FindWidget triggerFind={triggerFind} results={findRes} scrollToItem={scrollToItem} />
        <AutoSizer
          disableHeight={false}
          onContextMenu={(e) => {
            e.preventDefault() // prevent the default behaviour when right clicked
            const clickX = e.pageX
            const clickY = e.pageY
            console.log(`AutoSizer/FixedSizeList right Click at (${clickX}, ${clickY})`, e)
            // todo add own context menu. for now we just disable it to prevent copy not working for the own "allSelected" logic
          }}
        >
          {({ height, width }: { height?: number | undefined; width?: number | undefined }) => {
            // console.log(`AutoSizer child height=${height} width=${width} itemCount=${streamInfo.nrStreamMsgs}`)
            return (
              <InfiniteLoader
                ref={infiniteLoaderRef}
                minimumBatchSize={20}
                isItemLoaded={isItemLoaded}
                itemCount={streamInfo.nrStreamMsgs}
                loadMoreItems={loadMoreItems}
              >
                {({ onItemsRendered, ref }) => {
                  // console.log(`InfiniteLoader child height=${height} width=${width} itemCount=${streamInfo.nrStreamMsgs}`)
                  // the key for the FixedSizeList is important as it will be re-created on every search string change
                  // otherwise the list will not be re-rendered and sometime ... items remain
                  return (
                    <FixedSizeList
                      key={'FixedSizeList_key_' + searchString + '#' + streamInfo.nrStreamMsgs}
                      height={height || 400}
                      width={width || 200}
                      itemSize={18}
                      itemCount={streamInfo.nrStreamMsgs}
                      overscanCount={40}
                      outerElementType={OuterElementFixedSizeList}
                      ref={(elem) => {
                        ref(elem)
                        listRef.current = elem
                      }}
                      onItemsRendered={onItemsRendered}
                    >
                      {renderListRow}
                    </FixedSizeList>
                  )
                }}
              </InfiniteLoader>
            )
          }}
        </AutoSizer>
      </div>
      <div style={{ padding: '4px 2px 2px 4px' }}>
        <span>
          {streamInfo.nrStreamMsgs > 0
            ? `${streamInfo.nrStreamMsgs.toLocaleString()} out of ${streamInfo.nrMsgsTotal.toLocaleString()} logs matching`
            : `no logs matching out of ${streamInfo.nrMsgsTotal.toLocaleString()}`}
        </span>
        {streamInfo.nrMsgsProcessed != streamInfo.nrMsgsTotal && (
          <progress
            style={{ position: 'absolute', bottom: '2px', right: '1rem' }}
            value={streamInfo.nrMsgsProcessed}
            max={streamInfo.nrMsgsTotal}
          />
        )}
      </div>
    </div>
  )
}

// from mdn web docs:
function escapeRegExp(aString: string) {
  return aString.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // $& means the whole matched string
}

export default App
