/* --------------------
 * Copyright(C) Matthias Behr, 2020.
 */

// todo export into module and unite/combine with the one from vsc.webshark

import * as vscode from 'vscode';

export class PickItem implements vscode.QuickPickItem {
    // name: string; // like label but icon will be added in front
    icon: string | undefined;
    description: string | undefined;
    detail: string | undefined;
    data: any;

    constructor(public name: string) { }
    get label() {
        if (this.icon) {
            return `${this.icon} ${this.name}`;
        } else {
            return this.name;
        }
    }

    get alwaysShow() { return true; }
};

class QuickButton implements vscode.QuickInputButton {
    constructor(public iconPath: vscode.Uri | { dark: vscode.Uri, light: vscode.Uri } | vscode.ThemeIcon) { }
}

export class QuickInputHelper {

    static createQuickPick<T extends vscode.QuickPickItem>(title: string, step: number | undefined, totalSteps: number | undefined, buttons?: vscode.QuickInputButton[]): vscode.QuickPick<T> {
        const quickPick = vscode.window.createQuickPick<T>();
        quickPick.title = title;
        quickPick.ignoreFocusOut = true; // todo add cancel button?
        quickPick.canSelectMany = true;
        quickPick.matchOnDescription = true;
        quickPick.step = step;
        quickPick.totalSteps = totalSteps;

        quickPick.buttons = [
            ...((step !== undefined && step > 1) ? [vscode.QuickInputButtons.Back] : []),
            ...(buttons || [])
        ];

        return quickPick;
    }

    static async show<T extends vscode.QuickPickItem>(quickPick: vscode.QuickPick<T>, isValid?: ((value: string) => boolean)) {
        const disposables: vscode.Disposable[] = [];
        try {

            return await new Promise<readonly T[] | string>((resolve, reject) => {
                let ignoreNextAccept: boolean = false;
                disposables.push(quickPick.onDidAccept(() => {
                    if (ignoreNextAccept) {
                        console.log(`show onDidAccept() ignoring`);
                        ignoreNextAccept = false;
                        return;
                    }
                    if (true || quickPick.canSelectMany) { // only via quickInputButton
                        quickPick.busy = true;
                        console.log(`show onDidAccept() got selectedItems.length=${quickPick.selectedItems.length} and value='${quickPick.value}'`);
                        quickPick.enabled = false; // no hide here. done by dispose
                        resolve(quickPick.selectedItems.length ? quickPick.selectedItems : quickPick.value);
                    } else { // todo need to find a way to allow arbitrary values and on selecting an item not sending accept!
                        // on accept we check whether 
                        console.log(`show onDidAccept() got selectedItems.length=${quickPick.selectedItems.length} and value='${quickPick.value}'`);
                    }
                }));
                disposables.push(quickPick.onDidChangeActive((actives) => {
                    // active on is the one highlighted (changing with cursor up down)
                    //console.log(`show onDidChangeActive() got actives.length=${actives.length} and value='${quickPick.value}'`);
                    //actives.forEach(a => console.log(` a=${a.label} picked=${a.picked}`));
                }));

                disposables.push(quickPick.onDidChangeValue((value) => {
                    //console.log(`show onDidChangeValue() got value='${value}'`);
                    if (isValid !== undefined) {
                        quickPick.enabled = isValid(value);
                    }
                }));

                disposables.push(quickPick.onDidChangeSelection((selections) => {
                    //console.log(`show onDidChangeSelection() got selections.length='${selections.length}'`);
                    //selections.forEach(a => console.log(` s=${a.label} picked=${a.picked}`));
                    if (!quickPick.canSelectMany) {
                        // we copy the value and unselect:
                        if (selections.length === 1) {
                            if (quickPick.value !== selections[0].label) {
                                quickPick.value = selections[0].label;
                                quickPick.selectedItems = [];
                                ignoreNextAccept = true;
                            }
                        }
                    }
                }));

                disposables.push(quickPick.onDidTriggerButton(button => {
                    if (button === vscode.QuickInputButtons.Back) {
                        reject(vscode.QuickInputButtons.Back);
                    } else
                        if (button instanceof QuickButton) {
                            console.log(`show onDidTrigger() QuickButton`);
                            quickPick.busy = true;
                            quickPick.enabled = false;
                            resolve(quickPick.value);
                        } else {
                            console.log(`show onDidTrigger() != known button`);
                        }
                }));

                disposables.push(quickPick.onDidHide(() => {
                    console.log(`show onDidHide()...`);
                    reject();
                }));

                quickPick.show();
            });

        } finally {
            disposables.forEach(d => d.dispose());
        }
    }
}

export class MultiStepInput {

    constructor(private _title: string,
        private _steps: readonly {
            iconPath?: string,
            items: PickItem[] | (() => PickItem[]), title?: string,
            initialValue?: () => string | undefined, placeholder?: string,
            onValue?: ((v: string) => void),
            onValues?: ((v: readonly PickItem[] | string) => void),
            isValid?: ((v: string) => boolean),
            skipStep?: (() => boolean),
            onMoreItems?: ((cancel: vscode.CancellationToken) => vscode.Event<PickItem[] | undefined>),
            canSelectMany?: boolean
        }[],
        public options?: { canSelectMany: boolean }) {
    }

    public async run() {

        return new Promise<null>(async (resolve, reject) => {
            let doCancel = false;
            for (let s = 0; s < this._steps.length; ++s) {
                const stepData = this._steps[s];
                if (stepData.skipStep !== undefined && stepData.skipStep()) { continue; }
                let doBack = false;
                const buttons = [new QuickButton(new vscode.ThemeIcon(stepData.iconPath !== undefined ? stepData.iconPath : (s === this._steps.length - 1 ? 'menu-selection' : 'arrow-right')))];
                const quickPick = QuickInputHelper.createQuickPick<PickItem>(`${this._title} ${stepData.title ? stepData.title : ''}`, s + 1, this._steps.length, buttons);
                if (stepData.canSelectMany !== undefined) {
                    quickPick.canSelectMany = stepData.canSelectMany;
                } else
                    if (this.options !== undefined) {
                        quickPick.canSelectMany = this.options.canSelectMany;
                    }

                quickPick.items = stepData.items instanceof Array ? stepData.items : stepData.items();
                if (stepData.initialValue !== undefined) {
                    let t = stepData.initialValue();
                    if (t) { quickPick.value = t; }
                }
                if (stepData.placeholder) { quickPick.placeholder = stepData.placeholder; };

                let cancelMoreItems: vscode.CancellationTokenSource | undefined = undefined;
                if (stepData.onMoreItems !== undefined) {
                    cancelMoreItems = new vscode.CancellationTokenSource();
                    const onMoreItemsEvent = stepData.onMoreItems(cancelMoreItems.token);
                    quickPick.busy = true;
                    onMoreItemsEvent((items: PickItem[] | undefined) => {
                        if (items === undefined) {
                            // this indicates that no more data is there
                            quickPick.busy = false;
                        } else {
                            // we want to keep the selected ones:
                            const newSelItems: PickItem[] = [];
                            quickPick.selectedItems.forEach((selItem) => {
                                const itemIdx = items.findIndex((newVal) => {
                                    if (newVal.label === selItem.label) { return true; }
                                    return false;
                                });
                                if (itemIdx !== -1) { newSelItems.push(items[itemIdx]); }
                            });
                            quickPick.items = items;
                            quickPick.selectedItems = newSelItems;
                        }
                    });
                }

                await QuickInputHelper.show<PickItem>(quickPick, stepData.isValid).then((selectedItems) => {
                    if (stepData.onValues !== undefined) {
                        stepData.onValues(selectedItems);
                    } else {
                        if (stepData.onValue !== undefined) { stepData.onValue(quickPick.value); } else {
                            //assert(false, "neither onValue nor onValues defined");
                        }
                    }
                }).catch(err => {
                    if (err === vscode.QuickInputButtons.Back) {
                        doBack = true;
                    } else {
                        doCancel = true;
                    }
                });
                cancelMoreItems?.cancel();
                quickPick.dispose();
                if (doCancel) { break; }
                if (doBack) { s -= 2; }
            }
            if (doCancel) { reject(); } else { resolve(); }
        });
    }
}
