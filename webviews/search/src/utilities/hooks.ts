
import { useEffect, useRef, useState } from "react";
import { vscode } from "./vscode";

// from https://github.com/microsoft/vscode-hexeditor/blob/main/media/editor/hooks.ts under MIT license:
/**
 * Like useEffect, but only runs when its inputs change, not on the first render.
 */
export const useLazyEffect = (fn: () => void | (() => void), inputs: React.DependencyList): void => {
    const isFirst = useRef(true);
    useEffect(() => {
        if (!isFirst.current) {
            return fn();
        }

        isFirst.current = false;
    }, inputs);
};

/**
 * Like useState, but also persists changes to the VS Code webview API.
 */
export const usePersistedState = <T>(key: string, defaultValue: T): [T, React.Dispatch<React.SetStateAction<T>>] => {
    const [value, setValue] = useState<T>((vscode.getState() as any)?.[key] ?? defaultValue);

    useLazyEffect(() => {
        vscode.setState({ ...vscode.getState() as object, [key]: value });
    }, [value]);

    return [value, setValue];
};
