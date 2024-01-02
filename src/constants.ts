/* --------------------
 * Copyright (C) Matthias Behr, 2021
 */

export const extensionId = 'mbehr1.dlt-logs'
export const dltScheme = 'dlt-log'
export const adltScheme = 'adlt-log'

// same as approach as eamodio/vscode-gitlens:
export enum GlobalState {
  Version = 'dlt-logs:version',
  PendingWhatNewOnFocus = 'dlt-logs:pendingWhatsNewOnFocus',
}
