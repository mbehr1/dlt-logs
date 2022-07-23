/* --------------------
 * Copyright(C) Matthias Behr, 2020.
 */

// todos
// - mstp
// -loglevelmin/max
// - report?
// - timesync...?

import * as vscode from 'vscode';
import { MultiStepInput, PickItem } from './quickPick';
import { DltFilter, DltFilterType } from './dltFilter';
import { DltDocument } from './dltDocument';
import { ConfigNode, FilterableDocument } from './dltTreeViewNodes';
import * as util from './util';
import { ReportDocument } from './dltReport';

const confSection = 'dlt-logs.filters';

export function deleteFilter(doc: FilterableDocument, filter: DltFilter) {
    console.log(`dlt-log.deleteFilter(${filter.name}) called...`);
    return new Promise<boolean>((resolveDelete) => {
        // delete config:
        const curFilter = vscode.workspace.getConfiguration().get(confSection);
        if (curFilter && Array.isArray(curFilter)) {
            let deletedConf = false;
            for (let c = 0; c < curFilter.length; ++c) {
                const curOpt = curFilter[c];
                if (curOpt.id === filter.id) {
                    console.log(`found conf option to delete (${JSON.stringify(curOpt)})`);
                    curFilter.splice(c, 1);
                    util.updateConfiguration(confSection, curFilter);
                    deletedConf = true;
                    break;
                }
            }
            if (!deletedConf) {
                console.log(`can't find current config for filter '${filter.name}'`);
                vscode.window.showErrorMessage(`can't find current config for filter '${filter.name}'`);
            }
        } else {
            vscode.window.showErrorMessage(`can't read current config '${confSection}'`);
        }
        const res = doc.onFilterDelete(filter);
        resolveDelete(res);
    });
}

export function addFilter(doc: FilterableDocument & ReportDocument, arg: any) {
    console.log(`dlt-log.addFilter called...${JSON.stringify(arg)}`);
    let newFilter = new DltFilter({ type: DltFilterType.POSITIVE, ecu: arg["ecu"], apid: arg["apid"], ctid: arg["ctid"] });
    return editFilter(doc, newFilter, { isAdd: true, payload: arg["payload"] });
}

export function editFilter(doc: FilterableDocument & ReportDocument, newFilter: DltFilter, optArgs?: { payload?: string, isAdd?: boolean }) {
    return new Promise<boolean>((resolveEdit) => {
        const isAdd = optArgs !== undefined && optArgs.isAdd !== undefined ? optArgs.isAdd : false;
        console.log(`dlt-log.editFilter(isEdit=${isAdd}) called...${newFilter.name}`);

        const updateFilterConfig = (doc: FilterableDocument, filter: DltFilter, isAdd: boolean) => {
            console.log(`updateFilterConfig(isAdd=${isAdd})...${filter.name}`);
            const curFilter = vscode.workspace.getConfiguration().get(confSection);
            if (curFilter && Array.isArray(curFilter)) {
                console.log(`updateFilterConfig(isAdd=${isAdd})...${filter.name} got ${curFilter.length} filter configs`);
                if (isAdd) {
                    let confOptions = newFilter.asConfiguration();
                    curFilter.push(confOptions);
                    util.updateConfiguration(confSection, curFilter)?.then(() => {
                        console.log(`isAdd updateConfiguration finished for new filter ${newFilter.name} as (${JSON.stringify(newFilter.configOptions)})`);
                    });
                    doc.onFilterAdd(filter);
                } else {
                    // check whether we find the orig config used to create this filter:
                    let updatedConf = false;
                    for (let c = 0; c < curFilter.length; ++c) {
                        const curOpt = curFilter[c];
                        if (curOpt.id === filter.id) { // only assume that the uuid doesn't change
                            console.log(`found conf option for edit (${JSON.stringify(curOpt)})`);
                            let newOpt = filter.asConfiguration(); // this updates the curOpt as its anyhow pointing to the same obj
                            curFilter[c] = newOpt;
                            console.log(` updated to (${JSON.stringify(curFilter[c])})`);
                            util.updateConfiguration(confSection, curFilter);
                            updatedConf = true;
                            break;
                        }
                    }
                    if (!updatedConf) {
                        console.log(`can't find current config for filter '${filter.name}'`);
                        vscode.window.showErrorMessage(`can't find current config for filter '${filter.name}'`);
                    }
                    doc.onFilterEdit(filter);
                }
                resolveEdit(true);
            } else {
                vscode.window.showErrorMessage(`can't read current config '${confSection}'`);
            }
        };

        // step 1: ECUs:
        const ecuStrs: string[] = [];
        let ecus: PickItem[] = [];
        // pre-fill with info from lifecycles:
        doc.lifecycles.forEach((v, k) => { if (!ecuStrs.includes(k)) { ecuStrs.push(k); } });
        ecuStrs.forEach(s => ecus.push(new PickItem(s)));

        // step 2: APIDs:
        let apidSet = new Map<string, string>();
        let ctidSet = new Map<string, { desc: string, apids: string[] }>();

        // prefill from document if available:
        if (doc.ecuApidInfosMap !== undefined) {
            for (let [ecu, apidInfos] of doc.ecuApidInfosMap) {
                apidInfos.forEach((v, apid) => {
                    if (!apidSet.has(apid)) { apidSet.set(apid, v.desc); }
                    // ctids we store as ctid, desc, apids[]
                    v.ctids.forEach(([desc, nrMsgs], ctid) => {
                        if (!ctidSet.has(ctid)) { ctidSet.set(ctid, { desc: desc, apids: [apid] }); } else {
                            // do we have this apid yet?
                            const ctInfo = ctidSet.get(ctid);
                            if (ctInfo && !ctInfo.apids.includes(apid)) { ctInfo.apids.push(apid); }
                        }
                    });
                });
            }
        } else { // prefill from the lifecycles
            doc.lifecycles.forEach(lI => lI.forEach(l => {
                if (l.apidInfos !== undefined) {
                    l.apidInfos.forEach((v, k) => {
                        if (!apidSet.has(k)) { apidSet.set(k, v.desc); }
                        // ctids we store as ctid, desc, apids[]
                        v.ctids.forEach((desc, ctid) => {
                            if (!ctidSet.has(ctid)) { ctidSet.set(ctid, { desc: desc, apids: [k] }); } else {
                                // do we have this apid yet?
                                const ctInfo = ctidSet.get(ctid);
                                if (ctInfo && !ctInfo.apids.includes(k)) { ctInfo.apids.push(k); }
                            }
                        });
                    });
                }
            }));
        }

        let apids: PickItem[] = [];
        apidSet.forEach((desc, apid) => {
            let a = new PickItem(apid);
            a.description = desc;
            apids.push(a);
        });
        apids.sort((a, b) => { return a.name.localeCompare(b.name); });

        // setp 3 ctids:
        let ctids: PickItem[] = [];
        ctidSet.forEach((cI, ctid) => {
            let a = new PickItem(ctid);
            a.description = `${cI.desc} @${cI.apids.join(' and ')}`;
            a.data = { apids: cI.apids };
            ctids.push(a);
        });
        ctids.sort((a, b) => { return a.name.localeCompare(b.name); });

        const filterTypesByNumber = new Map<number, string>([[0, 'POSITIVE'], [1, 'NEGATIVE'], [2, 'MARKER'], [3, 'EVENT']]);
        const filterTypesByName = new Map<string, number>([['POSITIVE', 0], ['NEGATIVE', 1], ['MARKER', 2]]);

        let colorItems: PickItem[] = [];
        const colors: any = require('color-name'); // object with e.g. "blue":[0,0,255]
        try {
            Object.keys(colors).forEach(value => colorItems.push(new PickItem(value)));
        } catch (err) { console.error(`colors got err=${err}`); }

        let configItems: PickItem[] = [];
        const addConfig = (node: ConfigNode, prefix: string) => {
            if (node.label.length > 0) { // skip the ones without label
                configItems.push(new PickItem(prefix + node.label));

                node.children.forEach(c => {
                    if (c instanceof ConfigNode) {
                        addConfig(c, prefix + node.label + '/');
                    }
                });
            }
        };

        if ('configTreeNode' in doc) {
            (doc as DltDocument /* todo! */).configTreeNode.children.forEach(node => {
            if (node instanceof ConfigNode) {
                addConfig(node, '');
            }
        });
        }

        let stepInput = new MultiStepInput(`${isAdd ? 'add' : 'edit'} filter...`, [
            { title: `filter on ECU?`, items: ecus, initialValue: () => { return newFilter.ecu; }, placeholder: 'enter or select the ECU to filter (if any)', onValue: (v) => { newFilter.ecu = v.length ? v : undefined; }, isValid: (v => (v.length <= 4)) },
            { title: `filter on APID?`, items: apids, initialValue: () => { return newFilter.apid; }, onValue: (v) => { newFilter.apid = v.length ? v : undefined; }, isValid: (v => (v.length <= 4)) },
            { title: `filter on CTID?`, items: () => ctids.filter(v => { return newFilter.apid !== undefined ? v.data.apids.includes(newFilter.apid) : true; }), initialValue: () => { return newFilter.ctid; }, onValue: (v) => { newFilter.ctid = v.length ? v : undefined; }, isValid: (v => (v.length <= 4)) },
            { title: `filter on payload?`, items: optArgs !== undefined && optArgs.payload !== undefined ? [new PickItem(optArgs.payload)] : [], initialValue: () => { return newFilter.payload; }, onValue: (v) => { newFilter.payload = v.length ? v : undefined; } },
            { title: `filter on payloadRegex?`, items: optArgs !== undefined && optArgs.payload !== undefined ? [new PickItem(optArgs.payload)] : [], initialValue: () => { return newFilter.payloadRegex?.source; }, onValue: (v) => { newFilter.payloadRegex = v.length ? new RegExp(v) : undefined; }, isValid: (v => { try { let r = new RegExp(v); return true; } catch (err) { return false; } }) },
            { title: `filter type?`, items: [new PickItem(filterTypesByNumber.get(0)!), new PickItem(filterTypesByNumber.get(1)!), new PickItem(filterTypesByNumber.get(2)!)], initialValue: () => { return filterTypesByNumber.get(newFilter.type); }, onValue: (v) => { let t = filterTypesByName.get(v); if (t !== undefined) { newFilter.type = t; } }, isValid: (v => (filterTypesByName.has(v))) },
            { title: `choose marker colour`, items: colorItems, initialValue: () => { return typeof newFilter.filterColour === 'object' ? JSON.stringify(newFilter.filterColour) : newFilter.filterColour; }, onValue: (v) => { /* can parse to Object? */let o = undefined; try { o = JSON.parse(v); if (typeof (o) !== 'object') { o = undefined; } } catch (e) { }; newFilter.filterColour = o !== undefined ? o : (v.length ? v : "blue"); }, isValid: (v => { return colors[v] !== undefined; }), skipStep: () => newFilter.type !== DltFilterType.MARKER }, // todo add hex codes support and proper support for filterColour as object!
            { title: `optional name?`, items: [], initialValue: () => { return newFilter.filterName; }, onValue: (v) => { newFilter.filterName = v.length ? v : undefined; } },
            newFilter.atLoadTime ? undefined : { // statically skip this step
                iconPath: isAdd ? 'add' : 'edit', title: `select/enter configs (multiple separated by ',')`, items: configItems, initialValue: () => { return newFilter.configs.join(','); }, onValue: (v) => {
                    newFilter.configs = v.length > 0 ? v.split(',') : []; console.log(`set configs to ${JSON.stringify(newFilter.configs)}`);
                }, isValid: (v => { if (v.length === 0) { return true; } return v.split(',').map(v => (v.length > 0) && (!v.endsWith('/') && (!v.startsWith('/')))).reduce((prev, cur) => cur ? prev : false, true); })
            } // todo add support for steps with canSelectMany:true...
        ], { canSelectMany: false });
        stepInput.run().then(() => {
            updateFilterConfig(doc, newFilter, isAdd);
        }).catch(err => {
            console.log(`dlt-log.editFilter input cancelled...`);
        });
    });
}

