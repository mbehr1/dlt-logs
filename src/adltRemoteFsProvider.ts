import * as vscode from 'vscode'
import * as WebSocket from 'ws'
import * as semver from 'semver'

const MIN_ADLT_VERSION_SEMVER_RANGE = '>= 0.51.0' // first version that supports the fs command
const WS_IDLE_TIMEOUT_MS = 60000 // after one min of inactivity we close the connection
type Callback = (response: string) => void

export class AdltRemoteFSProvider implements vscode.FileSystemProvider {
  private webSocket: WebSocket
  private adltVersion: string | undefined
  private webSocketConnectionPending: boolean = true
  private webSocketIsConnected: boolean = false
  private pendingSends: [string, Callback][] = []
  private reqCallbacks: Callback[] = []
  private idleTimer: NodeJS.Timeout

  constructor(
    private log: vscode.LogOutputChannel,
    private readonly address: string,
  ) {
    log.info(`AdltRemoteFSProvider(${address})...`)
    this.webSocket = new WebSocket(address, [], { perMessageDeflate: false, origin: 'adlt-logs', maxPayload: 1_000_000_000 })
    this.webSocket.binaryType = 'arraybuffer' // ArrayBuffer needed for sink?
    this.webSocket.on('message', (data: ArrayBuffer, isBinary) => {
      try {
        if (isBinary) {
          this.log.warn(`AdltRemoteFSProvider.on('message', binary) unexpected binary data!`)
        } else {
          const text = data.toString()
          if (this.reqCallbacks.length > 0) {
            // response to a request:
            log.trace(`AdltRemoteFSProvider.on(message) response for request:`, text)
            let cb = this.reqCallbacks.shift()
            if (cb) {
              cb(text)
            }
          } else {
            log.warn(`AdltRemoteFSProvider.on(message) unexpected response:'${text}'`)
          }
        }
      } catch (err) {
        this.log.error(`AdltRemoteFSProvider.on('message') got err='${err}'`)
      }
    })
    this.webSocket.on('upgrade', (response) => {
      let ah = response.headers['adlt-version']
      this.adltVersion = ah && !Array.isArray(ah) ? ah : ah && Array.isArray(ah) ? ah.join(',') : undefined
      if (this.adltVersion) {
        if (!semver.satisfies(this.adltVersion, MIN_ADLT_VERSION_SEMVER_RANGE)) {
          vscode.window.showErrorMessage(
            `The remote adlt version is not matching the required version!\nPlease correct!\nDetected version is '${this.adltVersion}' vs required '${MIN_ADLT_VERSION_SEMVER_RANGE}.'`,
            { modal: true },
          )
        } else {
          log.info(`AdltRemoteFSProvider got matching adlt version ${this.adltVersion} vs ${MIN_ADLT_VERSION_SEMVER_RANGE}.`)
        }
      }
    })
    this.webSocket.on('open', () => {
      log.info(`AdltRemoteFSProvider.on('open')`)
      this.webSocketIsConnected = true
      this.webSocketConnectionPending = false
      this.pendingSends.forEach(([req, cb]) => {
        this.reqCallbacks.push(cb)
        this.webSocket.send(req, (err) => {
          if (err) {
            log.warn(`AdltRemoteFSProvider.sendAndRecv('${req}') wss got error:`, err)
            // remove that callbacks entry:
            const cbIdx = this.reqCallbacks.indexOf(cb)
            if (cbIdx >= 0) {
              this.reqCallbacks.splice(cbIdx, 1)
            }
            if (cb) {
              cb(`nok: ${err}`)
            }
          }
        })
      })
      this.pendingSends = []
    })
    this.webSocket.on('close', () => {
      log.info(`AdltRemoteFSProvider.on('close')`)
      this.webSocketIsConnected = false
      this.webSocketConnectionPending = false
    })
    this.webSocket.on('error', (err) => {
      log.error(`AdltRemoteFSProvider.on('error') got err='${err}'`)
      this.pendingSends.forEach(([_req, cb]) => {
        if (cb) {
          cb(`nok: ${err}`)
        }
      })
      this.pendingSends = []
    })
    this.idleTimer = setTimeout(() => {
      if (this.webSocketIsConnected) {
        log.info(`AdltRemoteFSProvider.on('idleTimer') connected, closing...`)
        this.webSocket.close(1000, 'idle timeout') // 1000 = normal closure
      } else {
        log.info(`AdltRemoteFSProvider.on('idleTimer') not connected, not closing...`)
      }
    }, WS_IDLE_TIMEOUT_MS)
  }

  connectedOrPending(): boolean {
    return this.webSocketIsConnected || this.webSocketConnectionPending
  }

  dispose() {
    this.log.info(`AdltRemoteFSProvider.dispose()`)
    try {
      clearTimeout(this.idleTimer)
      if (this.webSocketIsConnected) {
        // racy to pending?
        this.webSocket.close()
      }
    } catch (err) {
      this.log.error(`AdltRemoteFSProvider.dispose() got err='${err}'`)
    }
  }

  sendAndRecv(req: string): Promise<string> {
    const log = this.log
    if (!(this.webSocketIsConnected || this.webSocketConnectionPending)) {
      log.info(`AdltRemoteFSProvider.sendAndRecv('${req}') wss not connected, not pending...`)
      return Promise.reject('nok: wss not connected, not pending...')
    }
    this.idleTimer.refresh()
    const prom = new Promise<string>((resolve, reject) => {
      const callback: Callback = (response: string) => {
        // if we get an error/n ok we do reject as well:
        if (response.startsWith('ok:')) {
          resolve(response)
        } else {
          log.warn(`AdltRemoteFSProvider.sendAndRecv got nok ('${response}') for request '${req}'`)
          reject(response)
        }
      }
      if (this.webSocketIsConnected) {
        this.reqCallbacks.push(callback)
        this.webSocket.send(req, (err) => {
          if (err) {
            log.warn(`AdltRemoteFSProvider.sendAndRecv('${req}') wss got error:`, err)
            // remove that callbacks entry:
            const cbIdx = this.reqCallbacks.indexOf(callback)
            if (cbIdx >= 0) {
              this.reqCallbacks.splice(cbIdx, 1)
            }
            if (callback) {
              callback(`nok: ${err}`) // calls reject
            }
          }
        })
      } else {
        log.warn(`AdltRemoteFSProvider.sendAndRecv('${req}') wss not connected, adding to pendingSends`)
        this.pendingSends.push([req, callback])
      }
    })
    return prom
  }

  stat(uri: vscode.Uri): vscode.FileStat | Thenable<vscode.FileStat> {
    const log = this.log
    log.trace(`AdltRemoteFSProvider.stat(uri=${uri.toString().slice(0, 100)})...`)
    // this is a weird hack as the openFileDialog has issues if the path is only /
    // so we add /fs/ to the path and remove it towards adlt then
    if (!uri.path.startsWith('/fs')) {
      throw vscode.FileSystemError.FileNotFound()
    }

    const path = uri.path.startsWith('/fs') ? uri.path.slice(3) : uri.path
    return this.sendAndRecv(`fs ${JSON.stringify({ cmd: 'stat', path })}`).then(
      (resp) => {
        log.info(`AdltRemoteFSProvider.stat(uri=${uri.toString().slice(0, 100)})... got resp='${resp.slice(0, 100)}...'`)
        if (resp.startsWith('ok: fs:')) {
          const respObj = JSON.parse(resp.slice(7))
          // log.info(`AdltRemoteFSProvider.stat(${uri.path}) respObj=${JSON.stringify(respObj)}`)
          // expect an object with stat or err property
          const stat = respObj.stat
          if (stat) {
            const toRet: vscode.FileStat = {
              size: stat.size || 0,
              ctime: stat.ctime || 0,
              mtime: stat.mtime || 0,
              type: AdltRemoteFSProvider.convertAdltFileTypeToVscodeFileType(stat.type),
            }
            log.info(`AdltRemoteFSProvider.stat(${uri.path})=${JSON.stringify(toRet)}`)
            return toRet
          }
        } else {
          log.warn(`AdltRemoteFSProvider.stat(uri=${uri.toString().slice(0, 100)}... got nok resp='${resp.slice(0, 100)}...'`)
        }
        return { size: 0, ctime: 0, mtime: 0, type: vscode.FileType.Unknown }
      },
      (reason) => {
        log.error(`AdltRemoteFSProvider.stat(uri=${uri.toString().slice(0, 100)}... got err='${reason}'`)
        return { size: 0, ctime: 0, mtime: 0, type: vscode.FileType.Unknown }
      },
    )
  }

  private static convertAdltFileTypeToVscodeFileType(adltType: string): vscode.FileType {
    // we expect: file, dir, symlink_file, symlink_dir or symlink
    let fileType = vscode.FileType.Unknown // init with 0
    if (adltType.includes('file')) {
      fileType |= vscode.FileType.File
    } else if (adltType.includes('dir')) {
      fileType |= vscode.FileType.Directory
    }
    if (adltType.includes('symlink')) {
      fileType |= vscode.FileType.SymbolicLink
    }
    return fileType
  }

  readDirectory(uri: vscode.Uri): [string, vscode.FileType][] | Thenable<[string, vscode.FileType][]> {
    const log = this.log
    log.trace(`AdltRemoteFSProvider.readDirectory(uri=${uri.toString().slice(0, 100)}...`)
    const path = uri.path.startsWith('/fs') ? uri.path.slice(3) : uri.path
    return this.sendAndRecv(`fs ${JSON.stringify({ cmd: 'readDirectory', path })}`).then(
      (resp) => {
        //log.info(`AdltRemoteFSProvider.readDirectory(uri=${uri.toString().slice(0, 100)}... got resp='${resp.slice(0, 100)}...'`)
        if (resp.startsWith('ok: fs:')) {
          const respObj = JSON.parse(resp.slice(7))
          // response should be an array of objects with name and type properties
          //log.info(`AdltRemoteFSProvider.readDirectory respObj=${JSON.stringify(respObj)}`)
          if (Array.isArray(respObj)) {
            let entries: [string, vscode.FileType][] = respObj.map((entry) => {
              return [entry.name, AdltRemoteFSProvider.convertAdltFileTypeToVscodeFileType(entry.type)]
            })
            entries = entries.filter((e) => !e[0].startsWith('.')) // we remove all hidden files
            log.info(`AdltRemoteFSProvider.readDirectory entries=${JSON.stringify(entries)}`)
            return entries
          }
        }
        log.warn(`AdltRemoteFSProvider.readDirectory(uri=${uri.toString().slice(0, 200)}... got nok resp='${resp.slice(0, 100)}...'`)
        return []
      },
      (reason) => {
        log.error(`AdltRemoteFSProvider.readDirectory(uri=${uri.toString().slice(0, 100)}... got err='${reason}'`)
        return []
      },
    )
  }

  readFile(uri: vscode.Uri): Uint8Array | Thenable<Uint8Array> {
    this.log.info(`AdltRemoteFSProvider.readFile(uri=${uri.toString().slice(0, 100)}...`)
    throw new Error('Method not implemented.')
  }

  watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[] }): vscode.Disposable {
    this.log.info(`AdltRemoteFSProvider.watch(uri=${uri.toString().slice(0, 100)}...`)
    return new vscode.Disposable(() => {
      this.log.info(`AdltRemoteFSProvider.watch(uri=${uri.toString().slice(0, 100)} dispose()`)
    })
  }
  private _onDidChangeFile: vscode.EventEmitter<vscode.FileChangeEvent[]> = new vscode.EventEmitter<vscode.FileChangeEvent[]>()
  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._onDidChangeFile.event

  // functions that we're not implementing:
  writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean }): void | Thenable<void> {
    this.log.warn(`AdltRemoteFSProvider.writeFile(uri=${uri.toString().slice(0, 100)}...`)
    throw vscode.FileSystemError.NoPermissions()
  }

  copy(source: vscode.Uri, destination: vscode.Uri, options: { overwrite: boolean }): void | Thenable<void> {
    this.log.warn(`AdltRemoteFSProvider.copy()...`)
    throw vscode.FileSystemError.NoPermissions()
  }

  rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): void | Thenable<void> {
    this.log.warn(`AdltRemoteFSProvider.rename(oldUri=${oldUri.toString().slice(0, 100)}...`)
    throw vscode.FileSystemError.NoPermissions()
  }

  delete(uri: vscode.Uri, options: { recursive: boolean }): void | Thenable<void> {
    this.log.warn(`AdltRemoteFSProvider.delete(uri=${uri.toString().slice(0, 100)}...`)
    throw vscode.FileSystemError.NoPermissions()
  }
  createDirectory(uri: vscode.Uri): void | Thenable<void> {
    this.log.warn(`AdltRemoteFSProvider.createDirectory(uri=${uri.toString().slice(0, 100)}...`)
    throw vscode.FileSystemError.NoPermissions()
  }
}
