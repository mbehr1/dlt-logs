// findwidget mainly taken from https://github.com/microsoft/vscode-hexeditor/blob/main/media/editor/findWidget.css (MIT license)

/* todo list
[ ] show/highligh current line (selectedResult) via ? outline: 2px solid #282828 (editor seems to use highlight not for hover but the outline/border for hover)
[ ] add "capped" / load more...
[ ] handle alt-enter to highlight all searches?
*/

import { ReactComponent as ArrowDown } from '@vscode/codicons/src/icons/arrow-down.svg'
import { ReactComponent as ArrowUp } from '@vscode/codicons/src/icons/arrow-up.svg'
import { ReactComponent as CaseSensitive } from '@vscode/codicons/src/icons/case-sensitive.svg'
import { ReactComponent as Close } from '@vscode/codicons/src/icons/close.svg'
import { ReactComponent as RegexIcon } from '@vscode/codicons/src/icons/regex.svg'
import '@vscode/codicons/dist/codicon.css'

import styles from './FindWidget.module.css'

import React, { useRef, useEffect, useState, useCallback } from 'react'

import { usePersistedState } from './utilities/hooks'
import { clsx, throwOnUndefinedAccessInDev } from './utilities/util'
import { VsTextFieldGroup, VsIconCheckbox, VsIconButton } from './vscodeUi'

import { FindResults, FindParams } from './App'

const style = throwOnUndefinedAccessInDev(styles)

export const FindWidget: React.FC<{
  triggerFind(params: FindParams, findAll?: boolean): void
  results?: FindResults
  scrollToItem(itemIndex: number): void
}> = ({ triggerFind, results, scrollToItem }) => {
  const [visible, setVisible] = usePersistedState('find.visible', false)
  const [query, setQuery] = usePersistedState('find.query', '')
  const [isRegexp, setIsRegexp] = usePersistedState('find.isRegexp', false)
  const [isCaseSensitive, setIsCaseSensitive] = usePersistedState('find.isCaseSensitive', false)

  const textFieldRef = useRef<HTMLInputElement | null>(null)

  const [isUncapped, setUncapped] = useState(false)

  const [selectedResult, setSelectedResult] = useState<number>()

  const onQueryChange = useCallback((evt: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(evt.target.value)
    setUncapped(false)
    setSelectedResult(undefined)
  }, [])

  /** Element that was focused before the find widget was shown */
  // todo needed? const previouslyFocusedElement = useRef<FocusedElement>();

  useEffect(() => {
    const l = (evt: KeyboardEvent) => {
      if (evt.key === 'f' && (evt.metaKey || evt.ctrlKey)) {
        setVisible(true) // todo this seems to open the regular find as well. how to avoid?
        // previouslyFocusedElement.current = ctx.focusedElement;
        textFieldRef.current?.focus()
        evt.preventDefault()
        evt.stopImmediatePropagation() // needed to avoid the regular find window to popup
      }
    }

    window.addEventListener('keydown', l, { capture: true, passive: false })
    return () => window.removeEventListener('keydown', l)
  }, [])

  const queryDebounce = 700

  useEffect(() => {
    if (!query.length) {
      // return; // todo or remove find results!
    }
    let started = false
    const timeout = setTimeout(() => {
      triggerFind({ findString: visible ? query : '', useCaseSensitive: isCaseSensitive, useRegex: isRegexp }, false)
    }, queryDebounce)
    return () => {
      if (!started) {
        clearTimeout(timeout)
      }
    }
  }, [query, isCaseSensitive, isRegexp, visible])

  const closeWidget = () => {
    /*const prev = previouslyFocusedElement.current;
        if (prev !== undefined && select.isByteVisible(dimensions, columnWidth, offset, prev.byte)) {
            ctx.focusedElement = prev;
        } else {
            document.querySelector<HTMLElement>(`.${dataCellCls}`)?.focus();
        }*/

    // remove find done by useEffect above on visible change with delay
    setSelectedResult(undefined)
    setVisible(false)
  }

  const onFindKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeWidget()
    } else if (e.key === 'Enter') {
      if (e.shiftKey) {
        e.preventDefault()
        navigateResults(-1)
      } else if (e.ctrlKey || e.metaKey) {
        // no-op, enter in text area
      } else if (e.altKey /* todo && results.results.length*/) {
        e.preventDefault()
        // todo... ctx.setSelectionRanges(results.results.map(r => new Range(r.from, r.to)));
        console.warn(`search find alt enter not handled, yet!`)
      } else {
        e.preventDefault()
        navigateResults(1)
      }
    }
  }
  const navigateResults = (increment: number) => {
    console.log(`search find navigateResults(${increment})...`)

    if (!results || results.searchIdxs.length === 0) {
      return
    }

    let next: number
    if (selectedResult !== undefined) {
      next = selectedResult + increment
    } else {
      next = increment
    }
    let resultsLen = results.searchIdxs.length

    // regular wrap ignoring increment size
    if (next < 0) {
      next = resultsLen - 1
    } else if (next >= resultsLen) {
      next = 0
    }
    console.log(`search find navigateResults(${increment}) scrolling to item #${next}: ${results.searchIdxs[next]}`)
    scrollToItem(results.searchIdxs[next])
    setSelectedResult(next)
  }

  return (
    <div tabIndex={visible ? undefined : -1} className={clsx(style.wrapper, visible && style.visible)}>
      <div className={style.controlsContainer}>
        <div className={style.inputRow}>
          <VsTextFieldGroup
            buttons={3}
            ref={textFieldRef}
            outerClassName={style.textField}
            placeholder='Find Text'
            onKeyDown={onFindKeyDown}
            onChange={onQueryChange}
            value={query}
          >
            <VsIconCheckbox checked={isRegexp} onToggle={setIsRegexp} title='Regular Expression Search'>
              <RegexIcon />
            </VsIconCheckbox>
            <VsIconCheckbox checked={isCaseSensitive} onToggle={setIsCaseSensitive} title='Case Sensitive'>
              <CaseSensitive />
            </VsIconCheckbox>
          </VsTextFieldGroup>
          <ResultBadge
            onUncap={() => {
              /*todo*/
            }}
            results={results}
            selectedResult={selectedResult}
          />
          <VsIconButton
            disabled={results ? results.searchIdxs.length === 0 : true}
            onClick={() => navigateResults(-1)}
            title='Previous Match'
          >
            <ArrowUp />
          </VsIconButton>
          <VsIconButton disabled={results ? results.searchIdxs.length === 0 : true} onClick={() => navigateResults(1)} title='Next Match'>
            <ArrowDown />
          </VsIconButton>
          <VsIconButton title='Close Widget (Esc)' onClick={closeWidget}>
            <Close />
          </VsIconButton>
        </div>
      </div>
    </div>
  )
}

const resultCountFormat = new Intl.NumberFormat(undefined, { notation: 'compact' })
const selectedFormat = new Intl.NumberFormat()

const ResultBadge: React.FC<{
  results: FindResults | undefined
  selectedResult: number | undefined
  onUncap(): void
}> = ({ results, selectedResult, onUncap }) => {
  // console.log(`search find ResultBadge(${JSON.stringify(results)})`)
  const nrResults = results ? results.searchIdxs.length : 0
  const resultCountStr = resultCountFormat.format(nrResults)
  const capped = results ? results.nextSearchIdx !== undefined : false
  const resultCountComponent = capped ? (
    <a role='button' title={`More than ${nrResults} logs, click to find all`} onClick={onUncap}>
      {resultCountStr}+
    </a>
  ) : (
    <span title={`${results ? results.searchIdxs.length : 0} logs`}>{resultCountStr}</span>
  )

  return (
    <div className={style.resultBadge}>
      {
        /*results.progress*/ 1 < 1 ? (
          `Found ${resultCountStr}...`
        ) : nrResults === 0 ? (
          'No logs'
        ) : selectedResult !== undefined ? (
          <>
            {selectedFormat.format(selectedResult + 1)} of {resultCountComponent}
          </>
        ) : (
          <>{resultCountComponent} logs</>
        )
      }
    </div>
  )
}
