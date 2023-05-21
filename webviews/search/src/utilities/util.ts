// from https://github.com/microsoft/vscode-hexeditor/blob/main/media/editor/util.ts MIT license

/**
 * Wraps the object in another object that throws when accessing undefined properties.
 */
export const throwOnUndefinedAccessInDev = <T extends object>(value: T): T => {
    if (process.env.NODE_ENV === "production") {
        return value; // check that react does too, and esbuild defines
    }
    return new Proxy<T>(value, {
        get: (target, prop) => {
            if (prop in target) {
                return (target as any)[prop];
            }
            throw new Error(`Accessing undefined property ${String(prop)}`);
        }
    });
};

/**
 * Returns truthy classes passed in as parameters joined into a class string.
 */
export const clsx = (...classes: (string | false | undefined | null)[]): string | undefined => {
    let out: undefined | string;
    for (const cls of classes) {
        if (cls) {
            out = out ? `${out} ${cls}` : cls;
        }
    }

    return out;
};
