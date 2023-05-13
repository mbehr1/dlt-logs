import type { WebviewApi } from "vscode-webview";

type msgListener = (msg: any) => void;

/**
 * A utility wrapper around the acquireVsCodeApi() function, which enables
 * message passing and state management between the webview and extension
 * contexts.
 *
 * This utility also enables webview code to be run in a web browser-based
 * dev server by using native web browser features that mock the functionality
 * enabled by acquireVsCodeApi.
 */
class VSCodeAPIWrapper {
    private readonly vsCodeApi: WebviewApi<unknown> | undefined;

    constructor() {
        // Check if the acquireVsCodeApi function exists in the current development
        // context (i.e. VS Code development window or web browser)
        if (typeof acquireVsCodeApi === "function") {
            this.vsCodeApi = acquireVsCodeApi();
        }

        window.addEventListener('message', event => {
            const message = event.data; // The JSON data our extension sent

            switch (message.type) {
                case 'sAr':
                    receivedResponse(message);
                    break;
                default:
                    const listeners = this.msgListeners.get(message.type);
                    if (listeners) {
                        for (const l of listeners) {
                            l(message);
                        }
                    } else {
                        console.warn(`SearchPanel.event message.type=${message.type} not handled`, message);
                    }
                    break;
            }
        });
    }


    private msgListeners: Map<string, msgListener[]> = new Map();

    public addMessageListener(type: string, fn: msgListener) {
        const curListeners = this.msgListeners.get(type);
        if (curListeners) {
            // already contained?
            if (!curListeners.includes(fn)) {
                curListeners.push(fn);
                console.info(`VSCodeApiWrapper.addMessageListeners listener for type '${type}' added.`);
            } else {
                console.warn(`VSCodeApiWrapper.addMessageListeners duplicated request for type '${type}' ignored!`);
            }
        } else {
            this.msgListeners.set(type, [fn]);
            console.info(`VSCodeApiWrapper.addMessageListeners listener for type '${type}' set.`);
        }
    }

    public removeMessageListener(type: string, fn: msgListener) {
        const curListeners = this.msgListeners.get(type);
        if (curListeners) {
            // contained?
            const idx = curListeners.findIndex(fn);
            if (idx >= 0) {
                curListeners.splice(idx, 1);
                console.info(`VSCodeApiWrapper.removeMessageListeners listener for type '${type}' removed.`);
            } else {
                console.warn(`VSCodeApiWrapper.removeMessageListeners fn not found for type '${type}'!`);
            }
        } else {
            console.warn(`VSCodeApiWrapper.removeMessageListeners no listeners for type '${type}'!`);
        }
    }

    /**
     * Post a message (i.e. send arbitrary data) to the owner of the webview.
     *
     * @remarks When running webview code inside a web browser, postMessage will instead
     * log the given message to the console.
     *
     * @param message Abitrary data (must be JSON serializable) to send to the extension context.
     */
    public postMessage(message: unknown) {
        if (this.vsCodeApi) {
            this.vsCodeApi.postMessage(message);
        } else {
            console.log(message);
            window.postMessage({ type: 'sAr', id: 'id' in (message as any) ? (message as any).id : 0, res: null });
        }
    }

    /**
     * Get the persistent state stored for this webview.
     *
     * @remarks When running webview source code inside a web browser, getState will retrieve state
     * from local storage (https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage).
     *
     * @return The current state or `undefined` if no state has been set.
     */
    public getState(): unknown | undefined {
        if (this.vsCodeApi) {
            return this.vsCodeApi.getState();
        } else {
            const state = localStorage.getItem("vscodeState");
            return state ? JSON.parse(state) : undefined;
        }
    }

    /**
     * Set the persistent state stored for this webview.
     *
     * @remarks When running webview source code inside a web browser, setState will set the given
     * state using local storage (https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage).
     *
     * @param newState New persisted state. This must be a JSON serializable object. Can be retrieved
     * using {@link getState}.
     *
     * @return The new state.
     */
    public setState<T extends unknown | undefined>(newState: T): T {
        if (this.vsCodeApi) {
            return this.vsCodeApi.setState(newState);
        } else {
            localStorage.setItem("vscodeState", JSON.stringify(newState));
            return newState;
        }
    }
}

// Exports class singleton to prevent multiple invocations of acquireVsCodeApi.
export const vscode = new VSCodeAPIWrapper();

let lastReqId = 0;
let reqCallbacks = new Map();

export function sendAndReceiveMsg(req: { cmd: string, data: any }): Promise<any> {
    const reqId = ++lastReqId;
    const prom = new Promise(resolve => {
        //console.log(`added reqId=${reqId} to callbacks`);
        reqCallbacks.set(reqId, (response: any) => { resolve(response); })
    });
    vscode.postMessage({ type: 'sAr', req: req, id: reqId });
    return prom;
}

function receivedResponse(response: any) {
    try {
        //console.log('receivedResponse id:' + response.id);
        const cb = reqCallbacks.get(response.id);
        if (cb) {
            reqCallbacks.delete(response.id);
            cb(response.res);
        }
    } catch (err) {
        console.log('receivedResponse err:' + err, JSON.stringify(response));
    }
}
