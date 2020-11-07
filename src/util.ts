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

/* return a printable string. unprintable chars get replace by replaceChar 
   we do need to avoid string += operator here as this leads to lots of small strings
   that get referenced as sliced strings... */
export function printableAscii(buf: Buffer, replaceChar: number = 45 /*'-'*/): string {
    let res = Buffer.allocUnsafe(buf.length);
    for (let i = 0; i < buf.length; ++i) {
        if (buf[i] >= 0x20 /* space */ && buf[i] <= 0x7e) {
            res[i] = buf[i]; // access as UInt8Array
        } else {
            res[i] = replaceChar;
        }
    }
    return res.toString();
}

function precalcHexArray(): string[] {
    const toRet = [];
    for (let i = 0; i <= 0xff; ++i) {
        toRet.push(i.toString(16).padStart(2, '0'));
    }
    return toRet;
}
const hexArray = precalcHexArray();

/*
 output as hexdump in the simplest form: xx xx xx ...
*/
export function toHexString(buf: Buffer): string {
    const tempHex: string[] = [];

    for (let i = 0; i < buf.length; ++i) {
        tempHex.push(hexArray[buf[i]]);
    }

    return tempHex.join(' ');
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


export function updateConfiguration(section: string, newValue: any) {
    // we should try to update first:
    // workspaceFolderValue
    // workspaceValue
    // globalValue

    try {
        console.log(`util.updateConfiguration(section=${section})...`);
        const config = vscode.workspace.getConfiguration();
        //const curSet = config.inspect(section);
        //console.log(`curSet.workspaceFolderValue = ${curSet?.workspaceFolderValue}`);
        //console.log(`curSet.workspaceValue = ${curSet?.workspaceValue}`);
        //console.log(`curSet.globalValue = ${curSet?.globalValue}`);
        // todo check which ones exist and add there
        // for now add only to globalValue...

        return config.update(section, newValue, true);
    } catch (err) {
        console.error(`err ${err} at updating configuration '${section}'`);
    }

}

export interface RestObject {
    id: string | number;
    type: string;
    attributes?: object;
    // relationsships
    // links
    meta?: object;
}

/**
 * applies the objConvFunc on the objects.
 * @param objects array of the objects to convert
 * @param objConvFunc function that returns a RestObject for a single object
 */
export function createRestArray(objects: object[], objConvFunc: ((o: object, i: number) => RestObject)): RestObject[] {
    return objects.map((object, index) => {
        const restObj = objConvFunc(object, index);
        return restObj;
    });
}