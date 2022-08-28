import { PageDecorator, IPageDecorator, BasePage, WebView } from 'wdio-vscode-service';
import { reportWebView as ReportWebViewLocators } from './locators';
import * as locatorMap from './locators';

export interface ReportWebView extends IPageDecorator<typeof ReportWebViewLocators> { }
@PageDecorator(ReportWebViewLocators)
export class ReportWebView extends BasePage<typeof ReportWebViewLocators, typeof locatorMap> {
    /**
     * @private locator key to identify locator map (see locators.ts)
     */
    public locatorKey = 'reportWebView' as const;
    private _isOpen = false;

    constructor(private _webview: WebView) {
        super(locatorMap);
    }

    private async _checkIfOpened() {
        if (!this._isOpen) {
            await this.open();
        }
    }

    /**
     * move scope to webview so that further locators/queries are inside the webview
     * 
     * Is called automatically from e.g. resetZoom via _checkIfOpened().
     */
    public async open() {
        this._isOpen = true;
        await this._webview.close();
        return this._webview.open();
    }

    /**
     * move scope back to regular browser. Has to be called after actions with the webview have been performed.
     */
    public close() {
        this._isOpen = false;
        return this._webview.close();
    }

    /**
     * Click/execute the reset zoom button/function in the report.
     * @see `close()` needs to be called once ready with webview/report interactions.
     * @returns Promise to be awaited
     */
    public async resetZoom() {
        await this._checkIfOpened();
        return (await this.resetZoomBtn$).click();
    }

    /**
     * Click/execute the `toggle lifecycle start` checkbox/function in the report.
     * @see `close()` needs to be called once ready with webview/report interactions.
     * @returns Promise to be awaited
     */
    public async toggleLifecycleStartCheckbox() {
        await this._checkIfOpened();
        return this.toggleLifecycleStartCheckbox$.click();
    }
}
