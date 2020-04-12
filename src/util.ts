/* --------------------
* Copyright (C) Matthias Behr, 2020
*/

import * as vscode from 'vscode';
import * as path from 'path';

// adapted from https://stackoverflow.com/questions/20070158/string-format-not-work-in-typescript
export function stringFormat(str: string, args: RegExpExecArray): string {
    return str.replace(/{(\d+)}/g, function (match, number) {
        return typeof args[number] !== 'undefined'
            ? args[number]
            : match
            ;
    });
}

export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

// from https://gist.github.com/ca0v/73a31f57b397606c9813472f7493a940
// with MIT license
// slightly adapted
export const debounce = <F extends (...args: any[]) => any>(func: F, waitFor: number) => {
    let timeout: NodeJS.Timeout;

    return (...args: Parameters<F>): Promise<ReturnType<F>> =>
        new Promise(resolve => {
            if (timeout) {
                clearTimeout(timeout);
            }

            timeout = setTimeout(() => resolve(func(...args)), waitFor);
        });
};

export const throttle = <F extends (...args: any[]) => any>(func: F, waitFor: number) => {
    const now = () => new Date().getTime();
    const resetStartTime = () => startTime = now();
    let timeout: NodeJS.Timeout;
    let startTime: number = now() - waitFor;

    return (...args: Parameters<F>): Promise<ReturnType<F>> =>
        new Promise((resolve) => {
            const timeLeft = (startTime + waitFor) - now();
            if (timeout) {
                clearTimeout(timeout);
            }
            if (startTime + waitFor <= now()) {
                resetStartTime();
                resolve(func(...args));
            } else {
                timeout = setTimeout(() => {
                    resetStartTime();
                    resolve(func(...args));
                }, timeLeft);
            }
        });
};
