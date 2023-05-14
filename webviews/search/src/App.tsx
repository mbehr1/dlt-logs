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
 * [ ] update search results if useFilter is active and the filters in the doc are changed
 * [x] impl case-sensitive search for both regular and regex search
 * [ ] persist last searchStrings and offer as drop-down
 * [ ] search command should put focus to input box
 * [ ] verify regex strings
 * [ ] auto search on type or only on enter key / after timeout,...?
 * [ ] better status of "logs matching". check with adlt stream status
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
import { ChangeEvent, Component, MouseEventHandler, useEffect, useRef, useState } from "react";
import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react";
import { FixedSizeList, ListChildComponentProps } from 'react-window';
import AutoSizer from "react-virtualized-auto-sizer";
import InfiniteLoader from "react-window-infinite-loader";
import "./App.css";

// persisted state data (in vscode.set/getState...)
// defaults are provided in case they are not contained in getState...
interface PersistedState {
    useRegex: boolean,
    useCaseSensitive: boolean,
    useFilter: boolean,
    searchString: string,
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

const persistedState: PersistedState = { useRegex: true, useCaseSensitive: true, useFilter: true, searchString: '', ...vscode.getState() || {} };

function App() {
    const inputReference = useRef<Component>(null);

    const [useRegex, setUseRegex] = useState(persistedState.useRegex);
    const [useCaseSensitive, setUseCaseSensitive] = useState(persistedState.useCaseSensitive);
    const [useFilter, setUseFilter] = useState(persistedState.useFilter);
    const [searchString, setSearchString] = useState(persistedState.searchString);

    // non-persisted state:
    const [activeDoc, setActiveDoc] = useState<string | null>(null);
    const [itemCount, setItemCount] = useState(0);
    const [data, setData] = useState([] as ConsecutiveRows[]);
    const [loadPending, setLoadPending] = useState(false);

    // persist state on changes: (todo should we debounce a bit?)
    useEffect(() => {
        persistedState.useRegex = useRegex;
        persistedState.useCaseSensitive = useCaseSensitive;
        persistedState.useFilter = useFilter;
        persistedState.searchString = searchString;
        vscode.setState(persistedState);
    }, [useRegex, useCaseSensitive, useFilter, searchString]);

    useEffect(() => {
        // reset search results and related items
        setItemCount(0);
        setData(d => { console.log(`search useEffect setData(d.length=${d.length})->[]`); return []; });
        setLoadPending(false);
        if (activeDoc && searchString.length > 0) {
            sendAndReceiveMsg({ cmd: 'search', data: { searchString, useRegex, useCaseSensitive, useFilter } }).then((res: any) => {
                if (Array.isArray(res)) {
                    // const msgs = res;
                    // we don't know the length here yet...
                    // setItemCount(1); // will be set later
                    /*setItemCount(msgs.length);
                    setData([{ startIdx: 0, rows: msgs }]);*/
                    loadMoreItems(0, 50); // todo this seems needed to avoid list with 1 item ... loading how to reset? InfiniteLoader?
                }
                else {
                    console.log(`search res=${JSON.stringify(res)}`);
                }
            });
        }
    }, [useFilter, useCaseSensitive, useRegex, searchString, activeDoc]);

    useEffect(() => {
        const updateDocCb = (msg: any) => {
            console.log(`updateDocCb. msg=${JSON.stringify(msg)}`);
            if ('docUri' in msg) {
                setActiveDoc(msg.docUri);
                // todo: reset searchString or keep current one?
            }
        };
        vscode.addMessageListener('docUpdate', updateDocCb);

        const focusCb = (msg: any) => {
            console.log(`focusCb. msg=${JSON.stringify(msg)}`);
            if (inputReference.current) {
                (inputReference.current as any).focus();
            }

        };
        vscode.addMessageListener('focus', focusCb);

        const itemCountCb = (msg: any) => {
            console.log(`itemCountCb. msg=${JSON.stringify(msg)}`);
            if ('itemCount' in msg) {
                setItemCount(msg.itemCount);
            }
        };
        vscode.addMessageListener('itemCount', itemCountCb);

        // send a first hello/ping:
        vscode.postMessage({ type: 'hello', req: {} }); // no msgId needed

        return () => { vscode.removeMessageListener('itemCount', itemCountCb); vscode.removeMessageListener('focus', focusCb); vscode.removeMessageListener('docUpdate', updateDocCb); };
    }, []);

    const loadMoreItems = (startIndex: number, stopIndex: number): Promise<void> => {
        //console.log(`loadMoreItems(${startIndex}-${stopIndex})...`);
        setLoadPending(true);
        return new Promise<void>((resolve, reject) => {
            sendAndReceiveMsg({ cmd: 'load', data: { startIdx: startIndex, stopIdx: stopIndex } }).then((res: any) => {
                if (res && Array.isArray(res.msgs)) {
                    const msgs = res.msgs;
                    const totalNrMsgs = res.totalNrMsgs;
                    setItemCount(totalNrMsgs);
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
                setLoadPending(false);
                resolve();
            });
        });
    };

    // todo this might lead to the that "denied" data not being loaded or better only on next scroll
    const singleLoadMoreItems = loadPending ? () => { } : loadMoreItems;

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
            <VSCodeTextField ref={inputReference} id="inputSearch" placeholder="enter search" initialValue={searchString} onInput={(v) => { const iv = v as ChangeEvent<HTMLInputElement>; setSearchString(iv.target.value); }}>
                    <span slot="start" className="codicon codicon-search" ></span>
                <section slot="end" style={{ position: "absolute", top: "2px" /* weird monaco has 3px */, right: "2px" }}>
                    <Toggle icon="filter" active={useFilter} title="Use current document filter" onClick={() => setUseFilter(d => !d)} />
                    <Toggle icon="case-sensitive" active={useCaseSensitive} title="Use case sensitive" onClick={() => { setUseCaseSensitive(d => !d); }} />
                        {false && <VSCodeButton appearance="icon" aria-label="Match Whole Word">
                        {getCodicon('whole-word')}
                        </VSCodeButton>}
                    <Toggle icon="regex" active={useRegex} title="Use Regular Expression" onClick={() => setUseRegex(d => !d)} />
                    </section>
                </VSCodeTextField>
            <div style={{ flexGrow: 1 }}>
                <AutoSizer disableHeight={false}>
                        {({ height, width }) => (
                        <InfiniteLoader
                            isItemLoaded={isItemLoaded}
                            itemCount={itemCount}
                            loadMoreItems={singleLoadMoreItems}>
                            {({ onItemsRendered, ref }) => (
                                <FixedSizeList height={height || 400} width={width || 200} itemSize={18} itemCount={itemCount} overscanCount={20} ref={ref} onItemsRendered={onItemsRendered}>
                                    {renderListRow}
                                </FixedSizeList>
                            )}
                        </InfiniteLoader>
                        )}
                </AutoSizer>
                </div>
            <div style={{ padding: "4px 2px 2px 4px" }}>{itemCount > 0 ? `${itemCount} logs matching` : 'no logs'}</div>
        </div>
    );
}

export default App;