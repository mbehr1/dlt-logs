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
 * [ ] search command should put focus to input box
 * [ ] verify regex strings
 * [x] optimize time/queries while typing: delay request until typing stops for 0.7 secs (done using useDebounceCallback for search string)
 * [ ] optimize time/queries while typing: add id to requests to ignore data from prev. requests(?) (reject prev. data updates but not yet for itemCount)
 * [ ] auto search on type or only on enter key / after timeout,...? (added debounce with flush on enter, lets see whether this good or whether autosearch should be disabled)
 * [x] better status of "logs matching". check with adlt stream status (via StreamInfo)
 * [ ] shortcut for search window? (alt/option+f?)
 * [ ] impl "match whole word" button (logic: space/starts with and ends/space after?)
 * [ ] check theme changes / support reload on theme change (isLightTheme doesn't get updated)
 * [ ] rerun search on pressing enter in the search list (?) (if the auto upd doesnt work)
 * [ ] get rid of fixed font size/height assumptions (16px...)
 * [ ] background color for lifecycle indication (or other lifecycle indication)
 * [ ] add all decoration options from https://code.visualstudio.com/api/references/vscode-api#DecorationRenderOptions
 * [ ] add an empty last line to avoid flickering on last line with horiz. scrollbar
 * [ ] optimize click on result to jump to exact index if available
 * [ ] add search within search results
 * [ ] update docs
 */

import { sendAndReceiveMsg, vscode } from "./utilities/vscode";
import React from "react";
import { ChangeEvent, Component, MouseEventHandler, useEffect, useRef, useState, useCallback } from "react";
import { VSCodeButton, VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react";
import { FixedSizeList, ListChildComponentProps } from 'react-window';
import AutoSizer from "react-virtualized-auto-sizer";
import InfiniteLoader from "react-window-infinite-loader";
import { useDebouncedCallback } from 'use-debounce';
import "./App.css";

// persisted state data (in vscode.set/getState...)
// defaults are provided in case they are not contained in getState...
interface PersistedState {
    useRegex: boolean,
    useCaseSensitive: boolean,
    useFilter: boolean,
    searchString: string,
    lastUsedSearchStrings: string[],
}

// needs to be in sync with SearchPanel.ts map ...
interface Msg {
    index: number,
    receptionTimeInMs: number,
    calculatedTimeInMs?: number,
    timeStamp: number,
    ecu: string,
    mcnt: number,
    apid: string,
    ctid: string,
    mtin: string,
    payloadString: string,
    lifecycle?: number,
    decs?: any[], // decorations options, todo change to index to map...
}

interface ConsecutiveRows {
    startIdx: number;
    rows: Msg[];
}

interface StreamInfo {
    nrStreamMsgs: number,
    nrMsgsProcessed: number,
    nrMsgsTotal: number
}

/**
 * Add rows to the ConsecutiveRows[] in a sorted manner by startIdx
 * @param consRows existing array of ConesectiveRows that will be modified
 * @param toAdd entry to add
 * @returns index where the item was added
 */
function addRows(consRows: ConsecutiveRows[], toAdd: ConsecutiveRows): number {
    const idx = consRows.findIndex((rows) => rows.startIdx > toAdd.startIdx);
    if (idx >= 0) {
        // insert before the idx:
        consRows.splice(idx, 0, toAdd);
        return idx;
    } else { // no existing item has a startIdx<=toAdd
        // add to the end
        consRows.push(toAdd);
        return consRows.length - 1;
    }
}

const isLightTheme = document.body.classList.contains('vscode-light'); // else 'vscode-dark', 'vscode-high-contrast' we assume dark

// we could assign a click handler to every single sitem element but lets use just one function:
document.addEventListener('click', (e) => {
    const et = e.target;
    if (et instanceof Element) {
        //console.log(`document.onClick className=${et.className} ${et.classList}`);
        let textContent: string | null | undefined;
        let timeInMs: string | null | undefined;

        if (et.classList.contains('sitem')) {
            textContent = et.children.item(0)?.textContent;
            timeInMs = et.getAttribute('data-time');
        }
        if (et.className === '' && et.parentElement?.classList.contains('sitem')) {
            //console.log(`document.onClick parent`, et);
            textContent = et.parentElement.innerText;
            timeInMs = et.parentElement.getAttribute('data-time');
        }
        if (textContent) {
            const textContentTrimmed = textContent.trimStart();
            const index = Number.parseInt(textContentTrimmed.slice(0, textContentTrimmed.indexOf(' ')));
            //console.log(`search document.click index=${index}`);
            vscode.postMessage({ type: 'click', req: { index, timeInMs: timeInMs ? Number(timeInMs) : undefined } }); // no msgId needed
            // preventDefault?
        }
    }
});

type ToggleProps = {
    icon: string,
    title: string,
    active: boolean,
    onClick?: MouseEventHandler<HTMLElement>
};

// <div title="Match Whole Word (⌥⌘W)" class="monaco-custom-toggle codicon codicon-whole-word" tabindex="0" role="checkbox" aria-checked="false" aria-label="Match Whole Word (⌥⌘W)" aria-disabled="false" style="color: inherit;"></div>
// <div title="Use Regular Expression (⌥⌘R)" class="monaco-custom-toggle codicon codicon-regex checked" tabindex="0" role="checkbox" aria-checked="true" aria-label="Use Regular Expression (⌥⌘R)" aria-disabled="false" style="color: var(--vscode-inputOption-activeForeground); border-color: var(--vscode-inputOption-activeBorder); background-color: var(--vscode-inputOption-activeBackground);"></div>
// todo add onKeyDown logic as well? https://github.com/microsoft/vscode/blob/dc897c6c4fa6e9eecc98c70e4931dbdc16a4027c/src/vs/base/browser/ui/toggle/toggle.ts

const Toggle = (props: ToggleProps) => {
    const { icon, active } = props;
    // todo tabindex?
    return (<div onClick={props.onClick} title={props.title} className={`monaco-custom-toggle codicon codicon-${icon}${active ? ' checked' : ''}`} role="checkbox" aria-checked={active} aria-disabled={false} aria-label={props.title} />);
};

const getCodicon = (name: string, disabled?: boolean) => {
    // uses the same logic from https://github.com/microsoft/vscode/blob/dc897c6c4fa6e9eecc98c70e4931dbdc16a4027c/src/vs/base/browser/ui/codicons/codicon/codicon-modifiers.css#L16
    // not officially documented. add e2e test to check that it keeps on working todo!

    return (<span className={`codicon codicon-${name}${disabled ? ' codicon-modifier-disabled' : ''}`}></span>);
};

const persistedState: PersistedState = { useRegex: true, useCaseSensitive: true, useFilter: true, searchString: '', lastUsedSearchStrings: [], ...vscode.getState() || {} };
const MAX_LAST_USED_LIST_ITEMS = 50; // we persist max 50 last used search strings

function App() {
    // console.log(`search app (render)...`);
    const inputReference = useRef<Component>(null);
    const infiniteLoaderRef = useRef<null | InfiniteLoader>(null);

    const [useRegex, setUseRegex] = useState(persistedState.useRegex);
    const [useCaseSensitive, setUseCaseSensitive] = useState(persistedState.useCaseSensitive);
    const [useFilter, setUseFilter] = useState(persistedState.useFilter);
    const [searchString, setSearchString] = useState(persistedState.searchString);
    const [lastUsedList, setLastUsedList] = useState(persistedState.lastUsedSearchStrings);

    // non-persisted state:
    const [errorText, setErrorText] = useState<string | null>(null);
    const [activeDoc, setActiveDoc] = useState<{ uri: string | null, filterGen: number }>({ uri: null, filterGen: 0 });
    const [streamInfo, setStreamInfo] = useState({ nrStreamMsgs: 0, nrMsgsProcessed: 0, nrMsgsTotal: 0 } as StreamInfo);
    const [data, setData] = useState([] as ConsecutiveRows[]);
    const [lastLoad, setLastLoad] = useState<[number, number] | undefined>(undefined);
    const [searchDropDownOpen, setSearchDropDownOpen] = useState(false);

    const debouncedSetSearchString = useDebouncedCallback(
        (value) => { setSearchString(value); },
        700 // 700ms delay till automatic search
    );


    const loadMoreItems = useCallback((startIndex: number, stopIndex: number, noLastLoadStoring?: boolean): Promise<void> => {
        // console.log(`search loadMoreItems(${startIndex}-${stopIndex})...`);
        if (!noLastLoadStoring) { setLastLoad([startIndex, stopIndex]); }
        return new Promise<void>((resolve, reject) => {
            sendAndReceiveMsg({ cmd: 'load', data: { startIdx: startIndex, stopIdx: stopIndex } }).then((res: any) => {
                if (res && Array.isArray(res.msgs)) {
                    const msgs = res.msgs;
                    if (msgs.length > 0) {
                        setData(d => {
                            const curData = d.slice();
                            const addedIdx = addRows(curData, { startIdx: startIndex, rows: msgs });
                            if (curData.length > 50) { // todo constant! use a lot higher value, this one only for testing
                                // prune one with highest distance from the added one:
                                if (addedIdx < curData.length / 2) {
                                    curData.pop();
                                } else {
                                    curData.shift();
                                }
                            }
                            //console.log(`search loadMoreItems setData(d.length=${d.length})->#${curData.length}`);
                            return curData;
                        });
                    }
                } else {
                    console.warn(`loadMoreItems(${startIndex}-${stopIndex})... unexpected res=${JSON.stringify(res)}`);
                }
                resolve();
            });
        });
    }, []);


    // persist state on changes: (todo should we debounce a bit? use debouncedSetSearchString.isPending() .flush()?
    useEffect(() => {
        persistedState.useRegex = useRegex;
        persistedState.useCaseSensitive = useCaseSensitive;
        persistedState.useFilter = useFilter;
        persistedState.searchString = searchString;
        persistedState.lastUsedSearchStrings = lastUsedList.slice(0, MAX_LAST_USED_LIST_ITEMS);
        vscode.setState(persistedState);
    }, [useRegex, useCaseSensitive, useFilter, searchString, lastUsedList]);

    useEffect(() => {
        let active = true;    
        // reset search results and related items
        setStreamInfo({ nrStreamMsgs: 0, nrMsgsProcessed: 0, nrMsgsTotal: 0 });
        setData(d => []);
        setErrorText(null);
        if (activeDoc.uri && !debouncedSetSearchString.isPending() && searchString.length > 0) {
            sendAndReceiveMsg({ cmd: 'search', data: { searchString, useRegex, useCaseSensitive, useFilter } }).then((res: any) => {
                if (active) {
                    if (Array.isArray(res)) {
                        if (infiniteLoaderRef.current) {
                            //console.log(`search lastRenderedStartIndex=${(infiniteLoaderRef.current as any)._lastRenderedStartIndex} ${(infiniteLoaderRef.current as any)._lastRenderedStopIndex}`);
                            infiniteLoaderRef.current?.resetloadMoreItemsCache(true);
                        }
                        loadMoreItems(0, 100, true); // todo this seems needed to avoid list with item ... loading how to reset? InfiniteLoader? on itemCountCb? (resetloadMoreItemsCache doesn't seem to be enough)
                        if (lastLoad !== undefined && (lastLoad[1] > 100)) {
                            // see https://github.com/bvaughn/react-virtualized/blob/master/docs/InfiniteLoader.md#memoization-and-rowcount-changes
                            loadMoreItems(lastLoad[0], lastLoad[1], true);
                        }
                        setLastUsedList(l => {
                            const curIdx = l.indexOf(searchString);
                            if (curIdx === 0) { return l; } // no update needed
                            // remove if duplicate else remove last if list too long
                            const newL = l.slice();
                            if (curIdx > 0) {
                                newL.splice(curIdx, 1);
                            } else {
                                if (newL.length > MAX_LAST_USED_LIST_ITEMS) { newL.pop(); }
                            }
                            newL.unshift(searchString); // add to front
                            return newL;
                        });
                    }
                    else {
                        console.log(`search res=${JSON.stringify(res)}`);
                        if ('err' in res) {
                            setErrorText('' + res.err);
                        }
                    }
                } else {
                    //console.warn(`search useEffect ignored result due to !active!`);
                }
            });
        }
        return () => { active = false; };
    }, [useFilter, useCaseSensitive, useRegex, searchString, activeDoc, loadMoreItems]); // we want it to trigger if activeDoc.filterGen changes as well

    useEffect(() => {
        const focusCb = (msg: any) => {
            console.log(`search focusCb. msg=${JSON.stringify(msg)}`);
            if (inputReference.current) {
                (inputReference.current as any).focus();
            }

        };
        vscode.addMessageListener('focus', focusCb);

        const streamInfoCb = (msg: any) => {
            console.log(`search streamInfoCb. msg=${JSON.stringify(msg)}`);
            if ('streamInfo' in msg) {
                setStreamInfo(d => { return { ...d, ...msg.streamInfo }; });
            }
        };
        vscode.addMessageListener('streamInfo', streamInfoCb);

        // send a first hello/ping:
        vscode.postMessage({ type: 'hello', req: {} }); // no msgId needed

        return () => { vscode.removeMessageListener('streamInfo', streamInfoCb); vscode.removeMessageListener('focus', focusCb); };
    }, []);

    useEffect(() => {
        const docUpdateCb = (msg: any) => {
            console.log(`search docUpdateCb. msg=${JSON.stringify(msg)}`);
            if ('docUri' in msg) { setActiveDoc(d => { return { ...d, uri: msg.docUri as string }; }); }
            if ('onApplyFilter' in msg) { if (useFilter) { setActiveDoc(d => { return { ...d, filterGen: d.filterGen + 1 }; }) } }
        };
        vscode.addMessageListener('docUpdate', docUpdateCb);
        return () => { vscode.removeMessageListener('docUpdate', docUpdateCb); };
    }, [useFilter]);

    // todo this might lead to the that "denied" data not being loaded or better only on next scroll
    // const singleLoadMoreItems = loadPending ? (startIndex: number, stopIndex: number) => { console.log(`search ignored load [${startIndex}-${stopIndex})`); } : loadMoreItems;

    const isItemLoaded = (index: number): boolean => {
        //console.log(`isItemLoaded(${index})...`);
        // check whether we do have this item... this is kind of slow...
        for (const rows of data) {
            if (rows.startIdx <= index && index < (rows.startIdx + rows.rows.length)) {
                return true;
            }
        }
        return false;
    };

    const getItem = (index: number): Msg | undefined => {
        //console.log(`isItemLoaded(${index})...`);
        // check whether we do have this item... this is kind of slow...
        for (const rows of data) {
            if (rows.startIdx <= index && index < (rows.startIdx + rows.rows.length)) {
                return rows.rows[index - rows.startIdx];
            }
        }
        return undefined;
    };

    const renderListRow = (props: ListChildComponentProps) => {
        const { index, style } = props;
        const msg = getItem(index);
        if (msg) {
            const str = `${String(Number(msg.index)).padStart(6, ' ')} ${new Date(msg.receptionTimeInMs).toLocaleTimeString()} ${(msg.timeStamp / 10000).toFixed(4).padStart(9)} ${msg.ecu.padEnd(4)} ${msg.apid.padEnd(4)} ${msg.ctid.padEnd(4)} ${msg.payloadString}`;
            const strLen = str.length;

            // todo what's the width of this font? it will be monospace but what's the char width?
            // use https://stackoverflow.com/questions/118241/calculate-text-width-with-javascript ?
            const textWidthInPx = strLen * 8; // todo!

            // decorations?
            let backgroundColor: string | undefined;
            let borderWidth: string | undefined;
            let borderColor: string | undefined;
            let borderStyle: string | undefined;
            let color: string | undefined;

            // for multiple decs the last one determines/overwrites:
            if (msg.decs && msg.decs.length) {
                const evalDec = (dec: any) => {
                    for (const [key, value] of Object.entries(dec)) {
                        updMsgDec(key, value, dec);
                    }
                };

                const updMsgDec = (key: string, value: unknown, obj: any) => {
                    switch (key) {
                        case 'backgroundColor': backgroundColor = value as string; break;
                        case 'borderWidth': borderWidth = value as string; break;
                        case 'borderColor': borderColor = value as string; break;
                        case 'borderStyle': borderStyle = value as string; break;
                        case 'color': color = value as string; break;
                        case 'light':
                            if (isLightTheme) { evalDec(value); }
                            break;
                        case 'dark':
                            if (!isLightTheme) { evalDec(value); }
                            break;
                        case 'overviewRulerColor': // fallthrough
                        case 'overviewRulerLane': // fallthrough
                        case 'isWholeLine': break; // ignore
                        default:
                            console.warn(`renderListRow ignored key '${key}' from dec=${JSON.stringify(obj)}`);
                    }
                };

                msg.decs.forEach(d => evalDec(d));
            }

            // we do use outline instead of border to have the border drawn within and not around our item
            return (
                <div style={style}>
                    <div className="sitem" data-time={msg.calculatedTimeInMs} style={{ color: color, backgroundColor: backgroundColor, outlineWidth: borderWidth, outlineColor: borderColor, outlineStyle: borderStyle, outlineOffset: borderWidth ? '-' + borderWidth : undefined, width: textWidthInPx }}>
                        <pre>{str}</pre>
                    </div>
                </div >
            );
        } else {
            return (<div className="sitem" style={style}><pre>{`${index} ...`}</pre></div>);
        }
    };

    return (
        <div style={{ display: 'flex', flexFlow: 'column', width: '100%', /*border: '1px solid gray',*/ height: '100%' }} >
            {!searchDropDownOpen && <VSCodeTextField ref={inputReference} id="inputSearch" placeholder="enter search" autoFocus
                initialValue={searchString} onInput={(v) => { const iv = v as ChangeEvent<HTMLInputElement>; const str = iv.target.value; debouncedSetSearchString(str); if (str.length === 0) { debouncedSetSearchString.flush(); } }}
                onKeyDown={(e) => {
                    switch (e.key) {
                        case 'ArrowDown':
                            setSearchDropDownOpen(true);
                        // fallthrough
                        case 'Enter':
                            debouncedSetSearchString.flush();
                            break;
                    }
                }}>
                <span slot="start" className="codicon codicon-search" ></span>
                <section slot="end" style={{ position: "absolute", top: "2px" /* weird monaco has 3px */, right: "2px" }}>
                    <span style={{ margin: '2px 4px' }} className="codicon codicon-chevron-down" onClick={() => setSearchDropDownOpen(d => !d)} />
                    <Toggle icon="filter" active={useFilter} title="Use current document filter" onClick={() => setUseFilter(d => !d)} />
                    <Toggle icon="case-sensitive" active={useCaseSensitive} title="Use case sensitive" onClick={() => { setUseCaseSensitive(d => !d); }} />
                        {false && <VSCodeButton appearance="icon" aria-label="Match Whole Word">
                        {getCodicon('whole-word')}
                        </VSCodeButton>}
                    <Toggle icon="regex" active={useRegex} title="Use Regular Expression" onClick={() => setUseRegex(d => !d)} />
                    </section>
            </VSCodeTextField>}
            {searchDropDownOpen && <VSCodeDropdown id="searchDropDown" open={true} onChange={(e) => {
                //console.log(`search dropdown onChange`, e);
                if (e.target && 'value' in e.target) { setSearchString(e.target.value as string); }
                setSearchDropDownOpen(false);
                window.postMessage({ type: 'focus' });
            }} onKeyDown={(e) => {
                switch (e.key) {
                    case 'Delete': // delete the current entry from the list
                        if (e.target && 'value' in e.target) {
                            const toDel = e.target.value as string;
                            //console.log(`search dropdown onKeyDown Delete: '${toDel}'`);
                            setLastUsedList(l => {
                                const idx = l.indexOf(toDel);
                                if (idx >= 0) {
                                    const newL = l.slice();
                                    newL.splice(idx, 1);
                                    return newL;
                                } else {
                                    return l;
                                }
                            });
                            e.preventDefault();
                        }
                        break;
                }
            }}>
                {!lastUsedList.includes(searchString) && <VSCodeOption>{searchString}</VSCodeOption>}
                {lastUsedList.map(l => <VSCodeOption>{l}</VSCodeOption>)}
            </VSCodeDropdown>}
            {errorText !== null && <div className="inputValidation" >{errorText}</div>}
            <div style={{ flexGrow: 1 }}>
                <AutoSizer disableHeight={false}>
                        {({ height, width }) => (
                        <InfiniteLoader ref={infiniteLoaderRef}
                            minimumBatchSize={20}
                            isItemLoaded={isItemLoaded}
                            itemCount={streamInfo.nrStreamMsgs}
                            loadMoreItems={loadMoreItems}>
                            {({ onItemsRendered, ref }) => (
                                <FixedSizeList height={height || 400} width={width || 200} itemSize={18} itemCount={streamInfo.nrStreamMsgs} overscanCount={40} ref={ref} onItemsRendered={onItemsRendered}>
                                    {renderListRow}
                                </FixedSizeList>
                            )}
                        </InfiniteLoader>
                        )}
                </AutoSizer>
            </div>
            <div style={{ padding: "4px 2px 2px 4px" }}>
                <span>{streamInfo.nrStreamMsgs > 0 ? `${streamInfo.nrStreamMsgs.toLocaleString()} out of ${streamInfo.nrMsgsTotal.toLocaleString()} logs matching` : `no logs matching out of ${streamInfo.nrMsgsTotal.toLocaleString()}`}</span>
                {(streamInfo.nrMsgsProcessed != streamInfo.nrMsgsTotal) && <progress style={{ position: "absolute", bottom: "2px", right: "1rem" }} value={streamInfo.nrMsgsProcessed} max={streamInfo.nrMsgsTotal} />}
            </div>
        </div>
    );
}

export default App;