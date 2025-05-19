/* --------------------
 * Copyright(C) Matthias Behr. 2022
 */

/// todo: major issues before release:

/// not mandatory for first release:
/// [ ] opening of a stream (and support within reports)
/// [ ] onDidChangeConfiguration
/// [ ] timeSync, adjustTime support
/// [ ] move decorations parsing/mgmt to extension
/// [ ] think about atLoadTime filters (use them as regular ones)

/// bugs:

/// [ ] if during applyFilter no change is triggered, the decorations are not updated (e.g. if marker filters are enabled)
/// [x] sort order support
/// by default logs are sorted by timestamp. If the sort order is toggled the file is closed and reopened.
/// this can be weird/confusing with real streams.
/// and one side effect is that any lifecycle filters are automatically disabled (as the lc.ids are not persisted across close/open)

/// [x] opening of multiple dlt files (needs more testing. seems to work even with breadcrumb selection)

import * as vscode from 'vscode'
import TelemetryReporter from '@vscode/extension-telemetry'
import * as fs from 'fs'
//import * as WebSocket from 'ws' // fails with esbuild with TypeError: ... is not a constructor
import { WebSocket } from 'ws'
import * as util from './util'
import * as path from 'path'
import * as semver from 'semver'
import { spawn, ChildProcess } from 'child_process'

import { DltFilter, DltFilterType } from './dltFilter'
import { DltReport, NewMessageSink, ReportDocument } from './dltReport'
import { FilterableDltMsg, ViewableDltMsg, MSTP, MTIN_CTRL, MTIN_LOG, EAC, getEACFromIdx, getIdxFromEAC, MTIN_LOG_strs } from './dltParser'
import { DltLifecycleInfoMinIF } from './dltLifecycle'
import {
  TreeViewNode,
  FilterNode,
  LifecycleRootNode,
  LifecycleNode,
  EcuNode,
  FilterRootNode,
  DynFilterNode,
  ConfigNode,
} from './dltTreeViewNodes'

import * as remote_types from './remote_types'
import { DltDocument, ColumnConfig } from './dltDocument'
import { v4 as uuidv4 } from 'uuid'
import { AdltPlugin, AdltPluginChildNode } from './adltPlugin'
import { assert } from 'console'
import { fileURLToPath } from 'node:url'
import { generateRegex } from './generateRegex'
import * as JSON5 from 'json5'
import { AdltRemoteFSProvider } from './adltRemoteFsProvider'
import { AdltCommentThread, AdltComment, restoreComments, persistComments, purgeOldComments } from './adltComments'
import { normalizeArchivePaths } from './util'
import {
  FbEvent,
  FbSeqOccurrence,
  FbSequenceResult,
  FbStepRes,
  SeqChecker,
  nameFromStep,
  resAsEmoji,
  seqResultToMdAst,
  startEventForStepRes,
  summaryForStepRes,
} from 'dlt-logs-utils/sequence'
import { toMarkdown } from 'mdast-util-to-markdown'
import { gfmTableToMarkdown } from 'mdast-util-gfm-table'
import { EventReport, reportEventsFromSeq } from './eventReport'

//import { adltPath } from 'node-adlt';
// with optionalDependency we use require to catch errors
let adltPath: string | undefined = undefined
try {
  var adltModule = require('node-adlt')
  adltPath = adltModule ? adltModule.adltPath : undefined
  console.log(`node-adlt.adltPath=${adltPath}`)
} catch (err) {
  console.warn(`node-adlt not available! (err=${err}`)
}

/// minimum adlt version required
/// we do show a text if the version is not met.
/// see https://www.npmjs.com/package/semver#prerelease-identifiers
//const MIN_ADLT_VERSION_SEMVER_RANGE = ">=0.16.0";
const MIN_ADLT_VERSION_SEMVER_RANGE = require('../package.json')?.optionalDependencies['node-adlt']
console.log(`MIN_ADLT_VERSION_SEMVER_RANGE=${MIN_ADLT_VERSION_SEMVER_RANGE}`)

export function char4U32LeToString(char4le: number): string {
  let codes = [char4le & 0xff, 0xff & (char4le >> 8), 0xff & (char4le >> 16), 0xff & (char4le >> 24)]
  while (codes.length > 0 && codes[codes.length - 1] === 0) {
    codes.splice(-1)
  }
  return String.fromCharCode(...codes)
}

const createTreeNode = (label: string, uri: vscode.Uri, parent: TreeViewNode | null, iconName: string | undefined): TreeViewNode => {
  return {
    id: util.createUniqueId(),
    label: label,
    uri: uri,
    parent,
    children: [],
    tooltip: undefined,
    iconPath: iconName ? new vscode.ThemeIcon(iconName) : undefined,
  }
}

class AdltLifecycleInfo implements DltLifecycleInfoMinIF {
  ecu: string
  id: number
  nrMsgs: number
  // has bigints that dont serialize well, binLc: remote_types.BinLifecycle;
  adjustTimeMs: number = 0
  startTime: number // in ms
  resumeTime?: number
  endTime: number // in ms
  swVersion?: string
  node: LifecycleNode
  ecuLcNr: number
  decorationType?: vscode.TextEditorDecorationType

  constructor(binLc: remote_types.BinLifecycle, uri: vscode.Uri, ecuNode: EcuNode, lcRootNode: LifecycleRootNode) {
    this.ecu = char4U32LeToString(binLc.ecu)
    this.id = binLc.id
    this.nrMsgs = binLc.nr_msgs
    this.startTime = Number(binLc.start_time / 1000n) // start time in ms for calc.
    this.resumeTime = binLc.resume_time !== undefined ? Number(binLc.resume_time / 1000n) : undefined
    this.endTime = Number(binLc.end_time / 1000n) // end time in ms
    this.swVersion = binLc.sw_version
    //this.binLc = binLc;
    this.ecuLcNr = ecuNode.children.length
    this.node = new LifecycleNode(
      uri.with({ fragment: this.resumeTime !== undefined ? this.resumeTime.toString() : this.startTime.toString() }),
      ecuNode,
      lcRootNode,
      this,
      undefined,
    )
    ecuNode.children.push(this.node)
    if (this.swVersion !== undefined) {
      if (!ecuNode.swVersions.includes(this.swVersion)) {
        ecuNode.swVersions.push(this.swVersion)
        ecuNode.label = `ECU: ${this.ecu}, SW${
          ecuNode.swVersions.length > 1 ? `(${ecuNode.swVersions.length}):` : `:`
        } ${ecuNode.swVersions.join(' and ')}`
      }
    }
    if (ecuNode.lcDecorationTypes !== undefined) {
      this.decorationType = ecuNode.lcDecorationTypes[(this.ecuLcNr + 1) % 2]
    }
  }

  update(binLc: remote_types.BinLifecycle, eventEmitter: vscode.EventEmitter<TreeViewNode | null>) {
    this.nrMsgs = binLc.nr_msgs
    this.startTime = Number(binLc.start_time / 1000n) // start time in ms
    this.resumeTime = binLc.resume_time !== undefined ? Number(binLc.resume_time / 1000n) : undefined
    this.endTime = Number(binLc.end_time / 1000n) // end time in ms
    this.swVersion = binLc.sw_version // todo update parent ecuNode if changed
    // update node (todo refactor)
    this.node.label = `LC${this.getTreeNodeLabel()}`
    // fire if we did update
    eventEmitter.fire(this.node)
  }

  get persistentId(): number {
    return this.id
  }

  get lifecycleStart(): Date {
    return new Date(this.adjustTimeMs + this.startTime)
  }

  get isResume(): boolean {
    return this.resumeTime !== undefined
  }

  get lifecycleResume(): Date {
    if (this.resumeTime !== undefined) {
      return new Date(this.resumeTime)
    } else {
      return this.lifecycleStart
    }
  }

  get lifecycleEnd(): Date {
    return new Date(this.adjustTimeMs + this.endTime)
  }

  getTreeNodeLabel(): string {
    return `#${this.ecuLcNr}: ${
      this.resumeTime !== undefined ? `${new Date(this.resumeTime).toLocaleString()} RESUME ` : this.lifecycleStart.toLocaleString()
    }-${this.lifecycleEnd.toLocaleTimeString()} #${this.nrMsgs}`
  }

  get tooltip(): string {
    return `SW:${this.swVersion ? this.swVersion : 'unknown'}`
  }

  get swVersions(): string[] {
    return this.swVersion ? [this.swVersion] : []
  }
}

export class AdltMsg implements ViewableDltMsg {
  _eac: EAC
  index: number
  htyp: number
  receptionTimeInMs: number
  timeStamp: number
  lifecycle?: DltLifecycleInfoMinIF | undefined
  mcnt: number
  mstp: number
  mtin: number
  verbose: boolean
  payloadString: string

  constructor(binMsg: remote_types.BinDltMsg, lifecycle?: DltLifecycleInfoMinIF) {
    // cached ECU, APID, CTID:
    this._eac = getEACFromIdx(
      getIdxFromEAC({ e: char4U32LeToString(binMsg.ecu), a: char4U32LeToString(binMsg.apid), c: char4U32LeToString(binMsg.ctid) }),
    )!

    this.index = binMsg.index
    this.receptionTimeInMs = Number(binMsg.reception_time / 1000n)
    this.timeStamp = binMsg.timestamp_dms
    this.lifecycle = lifecycle
    this.htyp = binMsg.htyp
    this.mcnt = binMsg.mcnt
    this.mstp = (binMsg.verb_mstp_mtin >> 1) & 0x7
    this.mtin = (binMsg.verb_mstp_mtin >> 4) & 0xf
    this.verbose = (binMsg.verb_mstp_mtin & 0x01) === 0x01
    this.payloadString = binMsg.payload_as_text
  }
  get ecu(): string {
    return this._eac.e
  }
  get apid(): string {
    return this._eac.a
  }
  get ctid(): string {
    return this._eac.c
  }

  asRestObject(idHint: number): util.RestObject {
    return {
      id: this.index,
      type: 'msg',
      attributes: {
        timeStamp: this.timeStamp,
        ecu: this.ecu,
        mcnt: this.mcnt,
        apid: this.apid,
        ctid: this.ctid,
        mtin: MTIN_LOG_strs[this.mtin],
        payloadString: this.payloadString,
        lifecycle: this.lifecycle ? this.lifecycle.persistentId : undefined,
      },
    }
  }
}

export interface StreamMsgData {
  msgs: AdltMsg[]
  sink: NewMessageSink
}

export function decodeAdltUri(uri: vscode.Uri): string[] {
  const isLocalAddress = uri.authority === undefined || uri.authority === ''
  let fileNames
  if (uri.query.length > 0) {
    // multiple ones encoded in query:
    // first filename is the path, the others part of the query
    fileNames = isLocalAddress ? [uri.with({ query: '' }).fsPath] : [uri.path.startsWith('/fs') ? uri.path.slice(3) : uri.path]
    const basePath = path.parse(fileNames[0]).dir
    let jsonObj = JSON.parse(decodeURIComponent(uri.query))
    if (!('lf' in jsonObj)) {
      throw Error(`AdltDocument wrongly encoded uri ${uri.toString()}. Expecting query = lf:[]`)
    } else {
      if (!Array.isArray(jsonObj.lf)) {
        throw Error(`AdltDocument wrongly encoded uri ${uri.toString()}. Expecting query = lf as array`)
      } else {
        // console.warn(`adlt got encoded jsonObj=${JSON.stringify(jsonObj)}`);
        // we use the multiple files only if the first entry is same as path
        // this is to prevent vscode automatic changes of uris e.g. on breadcrumb selecction
        let allFileNames: string[] = jsonObj.lf.filter((f: any) => typeof f === 'string').map((f: string) => path.resolve(basePath, f))
        if (allFileNames.length > 1 && allFileNames[0] === fileNames[0]) {
          fileNames = allFileNames.map(normalizeArchivePaths)
        } else {
          // this is not a bug:
          //console.log(`adlt got encoded allFiles not matching first file`, allFileNames, fileNames[0])
        }
        // console.log(`adlt got encoded fileNames=`, fileNames);
        if (!fileNames.length) {
          throw Error(`AdltDocument wrongly encoded uri ${uri.toString()}. No filenames.`)
        }
        //this.realStat = fs.statSync(this.fileNames[0]); // todo summarize all stats
      }
    }
  } else {
    if (isLocalAddress) {
      const fileUri = uri.with({ scheme: 'file' })
      if (uri.path.includes('!/')) {
        // we want the first part as fsPath but the 2nd part with regular / (and not \ on windows)
        const parts = fileUri.path.split('!/')
        const firstPartUri = uri.with({ scheme: 'file', path: parts[0] })
        const otherParts = parts.slice(1).join('!/').replaceAll('\\', '/')
        fileNames = [firstPartUri.fsPath + '!/' + otherParts]
      } else {
        fileNames = [fileUri.fsPath]
      }
    } else {
      fileNames = [uri.path.startsWith('/fs') ? uri.path.slice(3) : uri.path]
    }
  }
  return fileNames
}

interface DecorationsInfo {
  decType: vscode.TextEditorDecorationType
  decOptions: any // the options used to create the type
}

/**
 * Represents a "message / time" highlight.
 *
 * Used to highlight e.g. from SearchPanel msgs or the timeRange from that message
 * if the message is currently not visible (filtered out).
 */
type MsgTimeHighlight = { msgIndex: number; calculatedTimeInMs?: number }

// MARK: AdltDocument
export class AdltDocument implements vscode.Disposable {
  private _fileNames: string[] // the real local file names
  private _ctime: number
  private _mtime: number // last modification time in ms we report as part of stat()
  private webSocket?: WebSocket
  private webSocketIsConnected = false
  private webSocketErrors: string[] = []
  private adltVersion?: string // the version from last wss upgrade handshake

  private streamId: number = 0 // 0 none, neg stop in progress. stream for the messages that reflect the main log/view
  private _startStreamPendingSince: number | undefined // startStream() should be called since that time
  private visibleMsgs?: AdltMsg[] // the array with the msgs that should be shown. set on startStream and cleared on stopStream
  private visibleLcs?: DltLifecycleInfoMinIF[] // array with the visible lc persistent ids
  private _maxNrMsgs: number //  setting 'dlt-logs.maxNumberLogs'. That many messages are displayed at once
  private _maxReportLogs: number // setting dlt-logs.maxReportLogs
  private _skipMsgs: number = 0 // that many messages are skipped from the top (here not loaded for cur streamId)

  private _sortOrderByTime = true // we default to true // todo retrieve last from config?

  // decorations: (should always reflect what we want to show in all textEditors showing this doc)
  decorations = new Map<vscode.TextEditorDecorationType, vscode.DecorationOptions[]>()

  // config options for decorations
  private decWarning?: DecorationsInfo
  private mdWarning = new vscode.MarkdownString('$(warning) LOG_WARN', true)
  private decError?: DecorationsInfo
  private mdError = new vscode.MarkdownString('$(error) LOG_ERROR', true)
  private decFatal?: DecorationsInfo
  private mdFatal = new vscode.MarkdownString('$(error) LOG_FATAL', true)
  private decMsgTimeHighlights?: DecorationsInfo

  private _decorationTypes = new Map<string, DecorationsInfo>() // map with id and settings. init from config in parseDecorationsConfigs
  // decorationOptionsMapByType = new Map<vscode.TextEditorDecorationType

  // textEditors showing this document. Is updated from AdltDocumentProvider
  textEditors: Array<vscode.TextEditor> = []

  // reference to the vscode.TextDocument for this AdltDocument:
  public textDocument: vscode.TextDocument | undefined = undefined

  // filter support:
  allFilters: DltFilter[] = []

  // event that fires when the filters are applied (after filters are changed)
  private _onApplyFilterEmitter = new vscode.EventEmitter<void>()
  get onApplyFilter() {
    return this._onApplyFilterEmitter.event
  }

  // tree view support:
  treeNode: TreeViewNode
  lifecycleTreeNode: LifecycleRootNode
  filterTreeNode: FilterRootNode
  configTreeNode?: TreeViewNode
  pluginTreeNode: TreeViewNode
  eventsTreeNode: TreeViewNode

  private _treeEventEmitter: vscode.EventEmitter<TreeViewNode | null>

  // lifecycles:
  lifecycles = new Map<string, DltLifecycleInfoMinIF[]>()
  lifecyclesByPersistentId = new Map<number, DltLifecycleInfoMinIF>()

  // apid/ctid infos:
  // map for ecu -> map apid -> {apid, desc, ctids...}
  /**
   * map with apidInfos (apid, desc, ctids <ctid, desc>) by ecu name
   * ecu -> map apid -> {apid, desc, ctids -> desc}
   */
  ecuApidInfosMap: Map<string, Map<string, { apid: string; desc: string; nrMsgs: number; ctids: Map<string, [string, number]> }>> =
    new Map()
  apidsNodes: Map<string, DynFilterNode> = new Map()

  // messages of current files:
  fileInfoNrMsgs = 0

  // progress for status bar
  private statusProgress: remote_types.BinProgress | undefined

  // messages for streams:
  private streamMsgs = new Map<number, StreamMsgData | remote_types.BinType[]>()

  // event for being loaded
  isLoaded: boolean = false
  private _onDidLoad = new vscode.EventEmitter<boolean>()
  get onDidLoad() {
    return this._onDidLoad.event
  }

  get fileNames(): string[] {
    return this._fileNames.map((fullName) => path.basename(fullName))
  }

  processBinStreamMsgs(bin_type: remote_types.BinType, streamData: StreamMsgData) {
    switch (bin_type.tag) {
      case 'DltMsgs':
        const [streamId, msgs] = bin_type.value
        if (msgs.length === 0) {
          // indicates end of query:
          if (streamData.sink.onDone) {
            streamData.sink.onDone()
          }
          this.streamMsgs.delete(streamId)
          // console.log(`adlt.processBinDltMsgs deleted stream #${streamId}`);
        } else {
          for (let i = 0; i < msgs.length; ++i) {
            let binMsg = msgs[i]

            let msg = new AdltMsg(binMsg, this.lifecycleInfoForPersistentId(binMsg.lifecycle_id))
            streamData.msgs.push(msg)
          }
          if (streamData.sink.onNewMessages) {
            streamData.sink.onNewMessages(msgs.length)
          }
        }
        break
      case 'StreamInfo':
        const si = bin_type.value
        // console.log(`adlt.processBinStreamMsgs: StreamInfo stream=${si.stream_id}, stream msgs=${si.nr_stream_msgs} processed=${si.nr_file_msgs_processed} total=${si.nr_file_msgs_total}`);
        if (streamData.sink.onStreamInfo) {
          streamData.sink.onStreamInfo(si.nr_stream_msgs, si.nr_file_msgs_processed, si.nr_file_msgs_total)
        }
        break
    }
  }

  constructor(
    private log: vscode.LogOutputChannel,
    private globalState: vscode.Memento,
    private commentController: vscode.CommentController,
    adltAddress: Promise<string>, // e.g. ws://localhost:<port>
    public uri: vscode.Uri,
    private emitDocChanges: vscode.EventEmitter<vscode.FileChangeEvent[]>,
    treeEventEmitter: vscode.EventEmitter<TreeViewNode | null>,
    parentTreeNode: TreeViewNode[],
    private emitStatusChanges: vscode.EventEmitter<vscode.Uri | undefined>,
    private checkActiveRestQueryDocChanged: () => boolean,
    private _columns: ColumnConfig[],
    private reporter?: TelemetryReporter,
  ) {
    this._treeEventEmitter = treeEventEmitter

    // support for multiple uris encoded...
    log.trace(`AdltDocument: uri=${JSON.stringify(uri.toJSON())}`)
    this._fileNames = decodeAdltUri(uri)
    const isLocalAddress = uri.authority === undefined || uri.authority === ''
    if (isLocalAddress) {
      const fileExists = this._fileNames.length > 0 && fs.existsSync(this._fileNames[0])
      const isLocalArchive = !fileExists && this._fileNames.length > 0 && this._fileNames[0].includes('!/')
      if (!(fileExists || isLocalArchive)) {
        log.warn(`AdltDocument file ${uri.toString()} ('${JSON.stringify(this._fileNames)}') doesn't exist!`)
        throw Error(`AdltDocument file ${uri.toString()} doesn't exist!`)
      }
      if (fileExists) {
        const realStat = fs.statSync(this._fileNames[0]) // todo summarize all stats
        this._ctime = realStat.ctimeMs.valueOf()
        this._mtime = realStat.mtimeMs.valueOf()
      } else {
        log.info(`AdltDocument file ${uri.toString()} is an archive`)
        this._ctime = Date.now()
        this._mtime = this._ctime
      }
    } else {
      this._ctime = Date.now()
      this._mtime = this._ctime
    }

    // configuration:
    const maxNrMsgsConf = vscode.workspace.getConfiguration().get<number>('dlt-logs.maxNumberLogs')
    this._maxNrMsgs = maxNrMsgsConf ? maxNrMsgsConf : 400000 // 400k default
    //this._maxNrMsgs = 1000; // todo for testing only

    const maxReportLogs = vscode.workspace.getConfiguration().get<number>('dlt-logs.maxReportLogs')
    this._maxReportLogs = maxReportLogs && maxReportLogs > 0 ? maxReportLogs : 1_000_000 // 1mio default

    // update tree view:
    this.lifecycleTreeNode = new LifecycleRootNode(this)
    this.filterTreeNode = new FilterRootNode(this.uri)
    //this.configTreeNode = { id: util.createUniqueId(), label: "Configs", uri: this.uri, parent: null, children: [], tooltip: undefined, iconPath: new vscode.ThemeIcon('references') };
    this.pluginTreeNode = createTreeNode('Plugins', this.uri, null, 'package')

    this.eventsTreeNode = createTreeNode('Events', this.uri, null, 'calendar')

    this.treeNode = {
      id: util.createUniqueId(),
      label: `${path.basename(this._fileNames[0]) + (this._fileNames.length > 1 ? `+${this._fileNames.length - 1}` : '')}`,
      uri: this.uri,
      parent: null,
      children: [
        this.lifecycleTreeNode,
        this.filterTreeNode,
        //      this.configTreeNode,
        this.pluginTreeNode,
        this.eventsTreeNode,
      ],
      tooltip: undefined,
      iconPath: new vscode.ThemeIcon('file'),
    }
    this.treeNode.children.forEach((child) => {
      child.parent = this.treeNode
    })
    parentTreeNode.push(this.treeNode)

    this.onDidChangeConfigConfigs() // load configs (we do it before filters) (autoEnableIf is anyhow done later)
    this.onDidChangeConfigFilters() // load filters

    {
      // load decorations:
      const decorationsObjs = vscode.workspace.getConfiguration().get<Array<object>>('dlt-logs.decorations')
      this.parseDecorationsConfigs(decorationsObjs)
    }

    {
      // load plugins:
      const pluginObjs = vscode.workspace.getConfiguration().get<Array<object>>('dlt-logs.plugins')
      this.parsePluginConfigs(pluginObjs)
    }

    this.text = `Loading logs via adlt from ${this._fileNames.join(', ')} with max ${this._maxNrMsgs} msgs per page...`

    // connect to adlt via websocket:
    adltAddress
      .then((address) => {
        log.info(`adlt.Document using websocket address '${address}'`)
        this.webSocket = new WebSocket(address, [], { perMessageDeflate: false, origin: 'adlt-logs', maxPayload: 1_000_000_000 })
        //log.info(`adlt.Document got the websocket`)
        //console.warn(`adlt.webSocket.binaryType=`, this.webSocket.binaryType);
        //this.webSocket.binaryType = "nodebuffer"; // or Arraybuffer?
        this.webSocket.binaryType = 'arraybuffer' // ArrayBuffer needed for sink?
        // console.warn(`adlt.webSocket.binaryType=`, this.webSocket.binaryType);
        this.webSocket.on('message', (data: ArrayBuffer, isBinary) => {
          try {
            if (isBinary) {
              //log.warn(`dlt-logs.AdltDocumentProvider.on(message) binary`, data.byteLength)
              try {
                let bin_type = remote_types.readBinType(data)
                // console.warn(`adlt.on(binary):`, bin_type.tag);
                switch (bin_type.tag) {
                  case 'DltMsgs':
                    {
                      // raw messages
                      let [streamId, msgs] = bin_type.value
                      //console.warn(`adlt.on(binary): DltMsgs stream=${streamId}, nr_msgs=${msgs.length}`);
                      let streamData = this.streamMsgs.get(streamId)
                      if (streamData && !Array.isArray(streamData)) {
                        this.processBinStreamMsgs(bin_type, streamData)
                      } else {
                        // we store the pure data for later processing:
                        if (!streamData) {
                          streamData = [bin_type]
                          this.streamMsgs.set(streamId, streamData)
                        } else {
                          streamData.push(bin_type)
                          if (streamData.length > 3) {
                            log.warn(
                              `adlt.on(binary): appended DltMsgs for yet unknown stream=${streamId}, nr_msgs=${msgs.length}, streamData.length=${streamData.length}`,
                            )
                          }
                          // todo this case should happen rarely. might indicate an error case where e.g.
                          // we get data for a really unknown stream. stop e.g. after an upper bound
                        }
                      }
                    }
                    break
                  case 'StreamInfo':
                    {
                      // todo could be refactored with DltMsgs switch case
                      let si = bin_type.value
                      const streamId = si.stream_id
                      let streamData = this.streamMsgs.get(streamId)
                      if (streamData && !Array.isArray(streamData)) {
                        this.processBinStreamMsgs(bin_type, streamData)
                      } else {
                        // we store the pure data for later processing:
                        // need to keep same chunk infos (e.g. msgs.length=0) -> array of array
                        if (!streamData) {
                          streamData = [bin_type]
                          this.streamMsgs.set(streamId, streamData)
                        } else {
                          streamData.push(bin_type)
                          if (streamData.length > 3) {
                            log.warn(
                              `adlt.on(binary): appended StreamInfo for yet unknown stream=${streamId}, streamData.length=${streamData.length}`,
                            )
                          }
                          // todo this case should happen rarely. might indicate an error case where e.g.
                          // we get data for a really unknown stream. stop e.g. after an upper bound
                        }
                      }
                    }
                    break
                  case 'Lifecycles':
                    {
                      let lifecycles: Array<remote_types.BinLifecycle> = bin_type.value
                      this.processLifecycleUpdates(lifecycles)
                    }
                    break
                  case 'FileInfo':
                    {
                      let fileInfo: remote_types.BinFileInfo = bin_type.value
                      this.processFileInfoUpdates(fileInfo)
                    }
                    break
                  case 'EacInfo':
                    {
                      let eacInfo: Array<remote_types.BinEcuStats> = bin_type.value
                      this.processEacInfo(eacInfo)
                    }
                    break
                  case 'PluginState':
                    {
                      let states: Array<string> = bin_type.value || []
                      this.processPluginStateUpdates(states)
                    }
                    break
                  case 'Progress':
                    {
                      let progress: remote_types.BinProgress = bin_type.value
                      this.processProgress(progress)
                    }
                    break
                  default:
                    log.warn(`adlt.on(binary): unhandled tag:'${JSON.stringify(bin_type)}'`)
                    break
                }
                //                        console.warn(`adlt.on(binary): value=${JSON.stringify(bin_type.value)}`);
              } catch (e) {
                log.warn(`adlt got err=${e}`)
              }
            } else {
              //log.warn(`dlt-logs.AdltDocumentProvider.on(message) text`, data.byteLength)
              // !isBinary
              const text = data.toString()
              if (text.startsWith('info:')) {
                // todo still used?
                log.info(`dlt-logs.AdltDocumentProvider.on(message) info:`, text)
              } else if (this._reqCallbacks.length > 0) {
                // response to a request:
                log.trace(`dlt-logs.AdltDocumentProvider.on(message) response for request:`, text)
                let cb = this._reqCallbacks.shift()
                if (cb) {
                  cb(text)
                }
              } else {
                log.warn(`dlt-logs.AdltDocumentProvider.on(message) unknown text=`, text)
              }
            }
          } catch (e) {
            log.warn(`dlt-logs.AdltDocumentProvider.on(message) catch error:`, e)
          }
        })
        this.webSocket.on('upgrade', (response) => {
          // log.info(`adlt.Document.on(upgrade) got response:`, response)
          let ah = response.headers['adlt-version']
          this.adltVersion = ah && !Array.isArray(ah) ? ah : ah && Array.isArray(ah) ? ah.join(',') : undefined
          if (this.adltVersion) {
            if (!semver.satisfies(this.adltVersion, MIN_ADLT_VERSION_SEMVER_RANGE)) {
              vscode.window.showErrorMessage(
                `Your adlt version is not matching the required version!\nPlease correct!\nDetected version is '${this.adltVersion}' vs required '${MIN_ADLT_VERSION_SEMVER_RANGE}.'`,
                { modal: true },
              )
            } else {
              log.info(`adlt.AdltDocumentProvider got matching adlt version ${this.adltVersion} vs ${MIN_ADLT_VERSION_SEMVER_RANGE}.`)
            }
          }
          let hdr_archives_supported = response.headers['adlt-archives-supported']
          let archives_supported =
            hdr_archives_supported && !Array.isArray(hdr_archives_supported)
              ? hdr_archives_supported.length > 0
                ? hdr_archives_supported.split(',')
                : []
              : []
          log.info(`adlt.AdltDocumentProvider got archives_supported=${JSON.stringify(archives_supported)}`)
        })
        this.webSocket.on('open', () => {
          //log.info(`adlt.Document.on(open)`)
          this.webSocketIsConnected = true
          this.webSocketErrors = []
          this.openAdltFiles()
        })

        this.webSocket.on('close', () => {
          this.webSocketIsConnected = false
          this.webSocketErrors.push('wss closed')
          log.warn(`dlt-logs.AdltDocumentProvider.on(close) wss got close`)
          this.emitStatusChanges.fire(this.uri)
        })
        this.webSocket.on('error', (err) => {
          log.warn(`dlt-logs.AdltDocumentProvider.on(error) wss got error:`, err)
          this.webSocketErrors.push(`error: ${err}`)
          this.emitStatusChanges.fire(this.uri)
          if (reporter) {
            reporter.sendTelemetryErrorEvent('adlt-wss-error', { error: `${err}` })
          }
        })
      })
      .catch((reason) => {
        this.text = `Couldn't start adlt due to reason: '${reason}'!\n\n` + this.text
        this.emitChanges()
      })

    // add a static report filter for testing:
    // this.onFilterAdd(new DltFilter({ type: DltFilterType.EVENT, payloadRegex: "(?<STATE_error>error)", name: "test report" }, false), false);
  }

  dispose() {
    const log = this.log
    // console.log(`AdltDocument.dispose()`);
    this.streamMsgs.clear()

    this.closeAdltFiles().then(
      () => {
        if (this.webSocket !== undefined) {
          // console.log(`AdltDocument.dispose closing webSocket`);
          this.webSocket.close()
          this.webSocket = undefined
        }
      },
      (reason) => {
        log.warn(`AdltDocument.dispose closeAdltFiles failed with '${reason}'`)
      },
    )
  }

  emitChanges() {
    this._mtime = Date.now()
    this.emitDocChanges.fire([{ type: vscode.FileChangeType.Changed, uri: this.uri }])
  }

  /**
   * return the tree node for the 'Configs' section
   * It's created only on demand (if doCreate is true) and inserted between filterTreeNode and pluginTreeNode
   * @param doCreate
   * @returns this.configTreeNode
   */
  getConfigTreeRootNode(doCreate: boolean): TreeViewNode | undefined {
    if (doCreate && !this.configTreeNode) {
      this.configTreeNode = {
        id: util.createUniqueId(),
        label: 'Configs',
        uri: this.uri,
        parent: this.treeNode,
        children: [],
        tooltip: undefined,
        iconPath: new vscode.ThemeIcon('references'),
      }
      // insert between filterTreeNode and pluginTreeNode
      const idx = this.treeNode.children.findIndex((child) => child === this.filterTreeNode)
      this.treeNode.children.splice(idx + 1, 0, this.configTreeNode)
      this._treeEventEmitter.fire(this.treeNode)
    }
    return this.configTreeNode
  }

  getConfigNode(name: string, create = true): TreeViewNode | undefined {
    if (name.length === 0) {
      return undefined
    }
    const confStr = name.split('/')
    let parentNode: TreeViewNode | undefined = this.configTreeNode
    for (let l = 0; l < confStr.length; ++l) {
      const confPart = confStr[l]
      if (confPart.length === 0) {
        return undefined
      }
      let child: ConfigNode | undefined = undefined
      // search for confPart within parentNode/children
      if (parentNode !== undefined) {
        for (let n = 0; n < parentNode.children.length; ++n) {
          if (parentNode.children[n].label === confPart) {
            child = parentNode.children[n] as ConfigNode
            break
          }
        }
      }
      if (create && child === undefined) {
        // create new child
        if (parentNode === undefined) {
          parentNode = this.getConfigTreeRootNode(true)!
        }
        child = new ConfigNode(parentNode.uri, parentNode, confPart)
        const filterChild = new ConfigNode(child.uri, child, '')
        filterChild.iconPath = new vscode.ThemeIcon('list-flat')
        filterChild.description = 'list of assigned filters'
        child.children.push(filterChild)
        parentNode.children.push(child)
        console.log(`getConfigNode created child ${child.label}`)
        this._treeEventEmitter.fire(this.configTreeNode!)
      }
      parentNode = child
      if (parentNode === undefined) {
        break
      }
    }
    return parentNode
  }

  updateConfigs(filter: DltFilter) {
    const configContainsFilterDirectly = function (node: ConfigNode, filter: DltFilter) {
      // see whether "filterChild" contains the filter:
      if (node.children.length < 1) {
        return false
      }
      const filterChild = node.children[0]
      if (filterChild instanceof ConfigNode) {
        for (let f = 0; f < filterChild.children.length; ++f) {
          const filterNode = filterChild.children[f]
          if (filterNode instanceof FilterNode) {
            if (filterNode.filter === filter) {
              return true
            }
          }
        }
      }
      return false
    }
    const confCopy = filter.configs // not a copy but ref to orig filter.configs
    const shouldBeInConfigNodes: ConfigNode[] = []
    for (let c = 0; c < confCopy.length; ++c) {
      const configNode = this.getConfigNode(confCopy[c], true) // allow create
      if (configNode !== undefined) {
        if (configNode instanceof ConfigNode) {
          shouldBeInConfigNodes.push(configNode)
          if (!configContainsFilterDirectly(configNode, filter)) {
            //console.log(`updateConfigs adding filter '${filter.name}' to '${configNode.label}'`)
            if (configNode.tooltip) {
              configNode.tooltip += `\n${filter.name}`
            } else {
              configNode.tooltip = `filter:\n${filter.name}`
            }
            // and add this filter as a child to the filters:
            let filterNode = new FilterNode(configNode.uri, configNode.children[0], filter)
            configNode.children[0].children.push(filterNode)
          } else {
            // console.log(`filter already in configNode ${configNode.label}`);
          }
        }
      }
    }
    const checkAndRemoveNode = function (node: ConfigNode, shouldBeInConfigNodes: readonly ConfigNode[]) {
      if (shouldBeInConfigNodes.includes(node)) {
        //assert(configContainsFilterDirectly(node, filter));
      } else {
        if (configContainsFilterDirectly(node, filter)) {
          // remove
          for (let i = 0; i < node.children[0].children.length; ++i) {
            const filterNode = node.children[0].children[i]
            if (filterNode instanceof FilterNode) {
              if (filterNode.filter === filter) {
                console.log(
                  `removing FilterNode(id=${filterNode.id}, label=${filterNode.label}) with ${filterNode.children.length} children`,
                )
                node.children[0].children.splice(i, 1)
                break // we add filters only once
              }
            }
          }
          // we keep nodes with empty filters as well
        }
      }

      // now check for all children:
      node.children.forEach((c) => {
        if (c instanceof ConfigNode) {
          if (c.label.length > 0) {
            checkAndRemoveNode(c, shouldBeInConfigNodes)
          }
        }
      })
    }
    if (this.configTreeNode) {
      this.configTreeNode.children.forEach((node) => {
        if (node instanceof ConfigNode) {
          checkAndRemoveNode(node, shouldBeInConfigNodes)
        }
      })
    }
  }

  /**
   * called when the config/settings for dlt-logs.configs have changed (or at startup)
   */
  onDidChangeConfigConfigs() {
    type ConfigObj = { name: string; autoEnableIf?: string }
    const configObjs = vscode.workspace.getConfiguration().get<Array<ConfigObj>>('dlt-logs.configs')
    if (configObjs && Array.isArray(configObjs) && configObjs.length > 0) {
      for (const configObj of configObjs) {
        try {
          if ('name' in configObj) {
            const configNode = this.getConfigNode(configObj.name, true)
            if (configNode && configNode instanceof ConfigNode) {
              if ('autoEnableIf' in configObj) {
                configNode.autoEnableIf = configObj.autoEnableIf
              }
              if (configNode.tooltip) {
                // might be an update so we need to replace:
                configNode.tooltip = configNode.tooltip.replace(/\n?AutoEnableIf\:\'.*\'/g, '')
                configNode.tooltip += `\nAutoEnableIf:'${configNode.autoEnableIf}'`
              } else {
                configNode.tooltip = `AutoEnableIf:'${configNode.autoEnableIf}'`
              }
            }
          }
        } catch (error) {
          this.log.warn(`dlt-logs.AdltDocument.onDidChangeConfigConfigs() got error:${error}`)
        }
      }
      if (this.configTreeNode) {
        this._treeEventEmitter.fire(this.configTreeNode)
        // iterate through all known ecus:
        let didUpdateFilters = false
        for (const ecu of this.ecuApidInfosMap.keys()) {
          if (this.checkConfigAutoEnable(ecu)) {
            didUpdateFilters = true
          }
        }
        if (didUpdateFilters) {
          this.triggerApplyFilter() // at startup none are known yet so this wont be called (which is good)
        }
      }
    }
  }

  /**
   * check whether a config should be enabled as it matches the autoEnableIf regex
   *
   * This is expected to be called just one time for each ecu.
   * Currently called from processEacInfo on the first time we get the eacInfo for an ecu.
   *
   * @param ecu - ecu to check for auto enable
   *
   * @returns true if any config was enabled
   *
   * @note treeView will be udpated automatically. But new filters are not applied yet. To be done by the caller.
   */
  checkConfigAutoEnable(ecu: string): boolean {
    const log = this.log
    // log.info(`checkConfigAutoEnable for ecu='${ecu}'`)

    const checkNode = (node: ConfigNode) => {
      let didEnable: boolean = false
      if (node.autoEnableIf !== undefined) {
        try {
          let regEx = new RegExp(node.autoEnableIf)
          if (regEx.test(ecu)) {
            if (node.anyFilterWith(false)) {
              didEnable = true
              log.info(`checkConfigAutoEnable(${ecu}): enabling config '${node.label}'`)
              node.applyCommand('enable')
            }
          }
        } catch (error) {
          log.warn(`checkConfigAutoEnable(${ecu}): got error:${error}`)
        }
      }
      // if we didn't enable it we have to check the children:
      // otherwise we dont have to as the 'enable' enabled the children already anyhow
      if (!didEnable) {
        node.children.forEach((n) => {
          if (n instanceof ConfigNode) {
            if (checkNode(n)) {
              didEnable = true // we any how check the other children
            }
          }
        })
      }
      return didEnable
    }

    // iterate through all configs:
    let didEnable = false
    this.configTreeNode?.children.forEach((configNode) => {
      if (configNode instanceof ConfigNode) {
        if (checkNode(configNode)) {
          didEnable = true
        }
      }
    })
    if (didEnable) {
      this._treeEventEmitter.fire(this.configTreeNode!)
    }
    return didEnable
  }

  /**
   * callback to handle any configuration change dynamically
   *
   * will be called on each configuration change.
   * @param event
   */
  onDidChangeConfiguration(event: vscode.ConfigurationChangeEvent) {
    if (event.affectsConfiguration('dlt-logs.configs')) {
      this.onDidChangeConfigConfigs()
    }
    if (event.affectsConfiguration('dlt-logs.filters')) {
      this.onDidChangeConfigFilters()
      this.triggerApplyFilter()
    }
    if (event.affectsConfiguration('dlt-logs.maxReportLogs')) {
      const maxReportLogs = vscode.workspace.getConfiguration().get<number>('dlt-logs.maxReportLogs')
      this._maxReportLogs = maxReportLogs && maxReportLogs > 0 ? maxReportLogs : 1_000_000 // 1mio default
    }
    // todo add for plugins, decorations, maxNumberLogs, columns?
  }

  /**
   * read or reread config changes for filters
   * Will be called from constructor and on each config change for dlt-logs.filters
   */
  onDidChangeConfigFilters() {
    this.log.trace(`dlt-logs.AdltDocument.onDidChangeConfigFilters()...`)
    const filterSection = 'dlt-logs.filters'
    let filterObjs = vscode.workspace.getConfiguration().get<Array<object>>(filterSection)

    // we add here some migration logic for <0.30 to >=0.30 as we introduced "id" (uuid) for identifying
    // filter configs:
    if (filterObjs) {
      let migrated = false
      try {
        for (let i = 0; i < filterObjs.length; ++i) {
          let filterConf: any = filterObjs[i]
          if (!('id' in filterConf)) {
            const newId = uuidv4()
            // console.log(` got filter: type=${filterConf?.type} without id. Assigning new one: ${newId}`);
            filterConf.id = newId
            migrated = true
          }
        }
        if (migrated) {
          // update config:
          util.updateConfiguration(filterSection, filterObjs)
          // sadly we can't wait here...
          vscode.window.showInformationMessage('Migration to new version: added ids to your existing filters.')
        }
      } catch (error) {
        this.log.error(`dlt-logs migrate 0.30 add id/uuid error:${error}`)
        vscode.window.showErrorMessage(
          'Migration to new version: failed to add ids to your existing filters. Please add manually (id fields with uuids.). Modification of filters via UI not possible until this is resolve.',
        )
      }
    }
    this.parseFilterConfigs(filterObjs)
  }

  /**
   * Parse the configuration filter parameters and update the list of filters
   * (allFilters) and the filterTreeNode accordingly.
   *
   * Can be called multiple times.
   * Filters with same id will be updated.
   * Filters that are not inside the current list will be added.
   * Filters that are not contained anylonger will be removed.
   * "undefined" will be ignored. Pass an empty array to remove all.
   * Order changes are applied.
   *
   * @param filterObjs array of filter objects as received from the configuration
   */ // todo move to extension
  parseFilterConfigs(filterObjs: Object[] | undefined) {
    /*console.error(
      `AdltDocument.parseFilterConfigs: have ${filterObjs?.length} filters to parse. Currently have ${this.allFilters.length} filters...`,
    )*/
    if (filterObjs) {
      let skipped = 0
      for (let i = 0; i < filterObjs.length; ++i) {
        try {
          let filterConf: any = filterObjs[i]
          const targetIdx = i - skipped

          // is this one contained?
          const containedIdx = this.allFilters.findIndex((filter) => filter.id === filterConf?.id)
          if (containedIdx < 0) {
            // not contained yet:
            let newFilter = new DltFilter(filterConf)
            /*console.error(
              `AdltDocument.parseFilterConfigs: filter configs=${JSON.stringify(newFilter.configs)} from filterConf=${JSON.stringify(
                newFilter.configOptions,
              )}!`,
            )*/
            if (newFilter.configs.length > 0) {
              this.updateConfigs(newFilter)
              // for now (as no proper config support) we disable those filters:
              newFilter.enabled = false
            }
            // insert at targetIdx:
            //this.filterTreeNode.children.push(new FilterNode(null, this.filterTreeNode, newFilter));
            //                        this.allFilters.push(newFilter);
            this.filterTreeNode.children.splice(targetIdx, 0, new FilterNode(null, this.filterTreeNode, newFilter))
            this.allFilters.splice(i - skipped, 0, newFilter)
            // console.log(`AdltDocument.parseFilterConfigs adding filter: name='${newFilter.name}' type=${newFilter.type}, enabled=${newFilter.enabled}, atLoadTime=${newFilter.atLoadTime}`);
          } else {
            // its contained already. so lets first update the settings:
            const existingFilter = this.allFilters[containedIdx]
            if ('type' in filterConf && 'id' in filterConf) {
              const newHasConf = Array.isArray(filterConf.configs) && filterConf.configs.length
              const oldHasConf = existingFilter.configs.length
              let updateConfigsNeeded = false
              if (
                (oldHasConf && !newHasConf) ||
                (newHasConf && !oldHasConf) ||
                (newHasConf &&
                  !(
                    filterConf.configs.length === existingFilter.configs.length &&
                    existingFilter.configs.every((v, i) => v === filterConf.configs[i])
                  ))
              ) {
                updateConfigsNeeded = true
              }
              existingFilter.configOptions = JSON.parse(JSON.stringify(filterConf)) // create a new object
              existingFilter.reInitFromConfiguration()
              if (updateConfigsNeeded) {
                this.updateConfigs(existingFilter)
                // for now (as no proper config support) we disable those filters:
                existingFilter.enabled = false
              }
            } else {
              this.log.warn(
                `AdltDocument skipped update of existingFilter=${existingFilter.id} due to wrong config: '${JSON.stringify(filterConf)}'`,
              )
            }
            // now check whether the order has changed:
            if (targetIdx !== containedIdx) {
              // order seems changed!
              // duplicates will be detected here automatically! (and removed/skipped)
              if (targetIdx > containedIdx) {
                // duplicate! the same idx is already there. skip this one
                this.log.warn(`AdltDocument.parseFilterConfigs: skipped filterConf.id='${filterConf.id}' as duplicate!`)
                skipped++
              } else {
                // containedIdx > targetIdx
                //console.warn(`parseFilterConfigs: detected order change for existingFilter.name='${existingFilter.name} from ${containedIdx} to ${targetIdx}'`);
                // reorder:
                const removed = this.allFilters.splice(containedIdx, 1)
                this.allFilters.splice(targetIdx, 0, ...removed)
                const removedNode = this.filterTreeNode.children.splice(containedIdx, 1)
                this.filterTreeNode.children.splice(targetIdx, 0, ...removedNode)
              }
            }
          }
        } catch (error) {
          this.log.error(`AdltDocument.parseFilterConfigs error:${error}`)
          skipped++
        }
      }
      // lets remove the ones not inside filterConf:
      // that are regular DltFilter (so skip plugins...)
      // should be the ones with pos >= filterObj.length-skipped as we ensured sort order
      // already above
      // we might stop at first plugin as well.
      // currently we do e.g. delete the filters from loadTimeAssistant now as well.
      // (but it doesn't harm as load time filters are anyhow wrong in that case)
      // todo think about it
      for (let i = filterObjs.length - skipped; i < this.allFilters.length; ++i) {
        const existingFilter = this.allFilters[i]
        if (existingFilter.constructor === DltFilter) {
          // not instanceof as this covers inheritance
          //console.log(`AdltDocument.parseFilterConfigs deleting existingFilter: name '${existingFilter.name}' ${existingFilter instanceof DltFileTransferPlugin} ${existingFilter instanceof DltFilter} ${existingFilter.constructor === DltFileTransferPlugin} ${existingFilter.constructor === DltFilter}`);
          this.allFilters.splice(i, 1)
          this.filterTreeNode.children.splice(i, 1)
          i--
        }
      }
    }
  }

  parsePluginConfigs(pluginObjs: Object[] | undefined) {
    const log = this.log
    // console.log(`adlt.parsePluginConfigs: have ${pluginObjs?.length} plugins to parse...`);
    if (pluginObjs) {
      for (let i = 0; i < pluginObjs?.length; ++i) {
        try {
          const pluginObj: any = pluginObjs[i]
          const pluginName = pluginObj.name
          switch (pluginName) {
            case 'FileTransfer':
              {
                const plugin = new AdltPlugin(
                  log,
                  `File transfers`,
                  new vscode.ThemeIcon('files'),
                  this.uri,
                  this.pluginTreeNode,
                  this._treeEventEmitter,
                  pluginObj,
                  this,
                )
                this.pluginTreeNode.children.push(plugin)
                //this.allFilters.push(plugin);
                //this.filterTreeNode.children.push(new FilterNode(null, this.filterTreeNode, plugin)); // add to filter as well
              }
              break
            case 'SomeIp':
              {
                const plugin = new AdltPlugin(
                  log,
                  `SOME/IP Decoder`,
                  new vscode.ThemeIcon('group-by-ref-type'),
                  this.uri,
                  this.pluginTreeNode,
                  this._treeEventEmitter,
                  pluginObj,
                  this,
                )
                this.pluginTreeNode.children.push(plugin)
              }
              break
            case 'NonVerbose':
              {
                // todo add merge of settings with fibexDir from SomeIp to match the docs...
                const plugin = new AdltPlugin(
                  log,
                  `Non-Verbose`,
                  new vscode.ThemeIcon('symbol-numeric'),
                  this.uri,
                  this.pluginTreeNode,
                  this._treeEventEmitter,
                  pluginObj,
                  this,
                )
                this.pluginTreeNode.children.push(plugin)
              }
              break
            case 'Rewrite':
              {
                const plugin = new AdltPlugin(
                  log,
                  `'Rewrite' plugin`,
                  new vscode.ThemeIcon('replace-all'),
                  this.uri,
                  this.pluginTreeNode,
                  this._treeEventEmitter,
                  pluginObj,
                  this,
                )
                this.pluginTreeNode.children.push(plugin)
              }
              break
            case 'CAN':
              {
                const plugin = new AdltPlugin(
                  log,
                  `CAN Decoder`,
                  new vscode.ThemeIcon('plug'),
                  this.uri,
                  this.pluginTreeNode,
                  this._treeEventEmitter,
                  pluginObj,
                  this,
                )
                this.pluginTreeNode.children.push(plugin)
              }
              break
            case 'Muniic':
              {
                const plugin = new AdltPlugin(
                  log,
                  `Muniic Decoder`,
                  new vscode.ThemeIcon('clock'),
                  this.uri,
                  this.pluginTreeNode,
                  this._treeEventEmitter,
                  pluginObj,
                  this,
                )
                this.pluginTreeNode.children.push(plugin)
              }
              break
          }
        } catch (error) {
          log.error(`dlt-logs.parsePluginConfigs error:${error}`)
        }
      }
    }
  }

  parseDecorationsConfigs(decorationConfigs: Object[] | undefined) {
    // console.log(`parseDecorationsConfigs: have ${decorationConfigs?.length} decorations to parse...`);
    if (this._decorationTypes.size) {
      // remove current ones from editor:
      this.textEditors.forEach((editor) => {
        this.decorations?.forEach((value, key) => {
          editor.setDecorations(key, [])
        })
      })
      // todo clear... this.decorations = undefined; // todo allDecorations?
      this._decorationTypes.clear()
    }
    if (decorationConfigs && decorationConfigs.length) {
      for (let i = 0; i < decorationConfigs.length; ++i) {
        try {
          const conf: any = decorationConfigs[i]
          if (conf.id) {
            // console.log(` adding decoration id=${conf.id}`);
            let decOpt = <vscode.DecorationRenderOptions>conf.renderOptions
            decOpt.isWholeLine = true
            let decType = vscode.window.createTextEditorDecorationType(decOpt)
            this._decorationTypes.set(conf.id, { decType, decOptions: { ...decOpt } })
          }
        } catch (error) {
          this.log.error(`dlt-logs.parseDecorationsConfig error:${error}`)
        }
      }
    }
    this.decWarning = this._decorationTypes.get('warning')
    this.decError = this._decorationTypes.get('error')
    this.decFatal = this._decorationTypes.get('fatal')

    if (this._decorationTypes.has('msgTimeHighlights')) {
      this.decMsgTimeHighlights = this._decorationTypes.get('msgTimeHighlights')
    } else {
      // create a new/static one based on the current vscode theme settings
      const decOptions = {
        backgroundColor: new vscode.ThemeColor(
          /* this is the one vscode uses. which is good in light scences but a bit too weak in dark ones: 'editor.rangeHighlightBackground' */ /* 'editor.findRangeHighlightBackground' */ 'editor.findMatchBackground',
        ), // todo or highlight the exact matches with findMatchBackground?
        // editor.findMatchBackground is not visible in high contract themes!
        isWholeLine: true,
      }
      const decType = vscode.window.createTextEditorDecorationType(decOptions)
      const decInfo = { decType, decOptions: { ...decOptions } }
      this._decorationTypes.set('msgTimeHighlights', decInfo)
      this.decMsgTimeHighlights = decInfo
    }

    // console.log(`dlt-logs.parseDecorationsConfig got ${this._decorationTypes.size} decorations!`);
  }

  private _decorationsHoverTexts = new Map<string, vscode.MarkdownString>()
  getDecorationFor(filter: DltFilter): [DecorationsInfo, vscode.MarkdownString] | undefined {
    // for filter we use decorationId or filterColour:
    let filterName = `MARKER_${filter.id}`

    let mdHoverText = this._decorationsHoverTexts.get(filterName)
    if (!mdHoverText) {
      mdHoverText = new vscode.MarkdownString(`MARKER ${filter.name}`)
      this._decorationsHoverTexts.set(filterName, mdHoverText)
    }

    if (filter.decorationId) {
      let dec = this._decorationTypes.get(filter.decorationId)
      if (!dec) {
        return undefined
      } else {
        return [dec, mdHoverText]
      }
    }
    // now we assume at least a filterColour:
    if (typeof filter.filterColour === 'string') {
      if (!filter.filterColour.length) {
        return undefined
      }
      const decFilterName = `filterColour_${filter.filterColour}`
      let dec = this._decorationTypes.get(decFilterName)
      if (dec) {
        return [dec, mdHoverText]
      }
      // create this decoration:
      const decOptions = {
        borderColor: filter.filterColour,
        borderWidth: '1px',
        borderStyle: 'dotted',
        overviewRulerColor: filter.filterColour,
        overviewRulerLane: 2,
        isWholeLine: true,
      }
      dec = { decType: vscode.window.createTextEditorDecorationType(decOptions), decOptions }
      this._decorationTypes.set(decFilterName, dec)
      return [dec, mdHoverText]
    } else if (typeof filter.filterColour === 'object') {
      // decorationType alike object.
      let dec = this._decorationTypes.get(filterName) // we use filter name here as well as decoration key
      if (dec) {
        return [dec, mdHoverText]
      } else {
        // create
        const decOptions = { isWholeLine: true, ...filter.filterColour }
        dec = { decType: vscode.window.createTextEditorDecorationType(decOptions), decOptions }
        this._decorationTypes.set(filterName, dec)
        return [dec, mdHoverText]
      }
    }
    return undefined
  }

  private _reqCallbacks: ((resp: string) => void)[] = [] // could change to a map. but for now we get responses in fifo order
  sendAndRecvAdltMsg(req: string): Promise<string> {
    const log = this.log
    const prom = new Promise<string>((resolve, reject) => {
      this._reqCallbacks.push((response: string) => {
        // if we get an error/n ok we do reject as well:
        if (response.startsWith('ok:')) {
          resolve(response)
        } else {
          log.warn(`adlt.sendAndRecvAdltMsg got nok ('${response}') for request '${req}'`)
          reject(response)
        }
      })
    })
    if (this.webSocket) {
      this.webSocket.send(req, (err) => {
        if (err) {
          log.warn(`dlt-logs.AdltDocumentProvider.sendAndRecvAdltMsg wss got error:`, err)
          this.webSocketErrors.push(`wss send failed with:${err}`)
          this.emitStatusChanges.fire(this.uri)
        }
      })
    } else {
      log.error(`dlt-logs.AdltDocumentProvider.sendAndRecvAdltMsg got no webSocket yet!`)
    }
    return prom
  }

  openAdltFiles() {
    const log = this.log
    // plugin configs:
    const pluginCfgs = JSON.stringify(this.pluginTreeNode.children.map((tr) => (tr as AdltPlugin).options))
    this.sendAndRecvAdltMsg(
      `open {"sort":${this._sortOrderByTime},"files":${JSON.stringify(this._fileNames)},"plugins":${pluginCfgs}}`,
    ).then((response) => {
      // console.log(`adlt.on open got response:'${response}'`);
      // parse plugins_active from response:
      try {
        let json_resp = JSON.parse(response.slice(response.indexOf('{')))
        if ('plugins_active' in json_resp) {
          // console.log(`adlt.on open plugins_active:'${json_resp.plugins_active}'`);
          // go through all plugin nodes and update the status:
          this.pluginTreeNode.children.forEach((pluginNode) => {
            let plugin = pluginNode as AdltPlugin
            plugin.setActive(json_resp.plugins_active.includes(plugin.options.name))
          })
        }
      } catch (err) {
        log.error(`adlt.on open response could not be parsed as json due to:'${err}'`)
      }
      if (!this.isLoaded) {
        this.isLoaded = true
        this._onDidLoad.fire(this.isLoaded)
      }
      // wait with startStream until the first EAC infos are here to be able to use that for
      // configs (autoenabling of filters)
      this._startStreamPendingSince = Date.now()
      // fallback that if after 5s no EAC... -> start
      setTimeout(() => {
        if (this._startStreamPendingSince !== undefined && Date.now() - this._startStreamPendingSince >= 5000) {
          this._startStreamPendingSince = undefined
          this.startStream()
        }
      }, 5000)
      // trigger loading of comments:
      setTimeout(() => {
        if (this.commentThreads.length === 0) {
          this.loadComments()
        }
      }, 5100)
    })
  }

  closeAdltFiles(): Promise<void> {
    this._startStreamPendingSince = undefined
    let p = new Promise<void>((resolve, reject) => {
      this.sendAndRecvAdltMsg(`close`)
        .then(() => {
          this.statusProgress = undefined
          const lastFileInfoNrMsgs = this.fileInfoNrMsgs
          this.processFileInfoUpdates({ nr_msgs: 0 })
          this.processLifecycleUpdates([]) // to remove any filters from lifecycles as they become invalid
          if (this.reporter) {
            this.reporter.sendTelemetryEvent('closeAdltFiles', undefined, { fileInfoNrMsgs: lastFileInfoNrMsgs })
          }
          resolve()
        })
        .catch((r) => reject(r))
    })
    return p
  }

  processEacInfo(eacInfo: Array<remote_types.BinEcuStats>) {
    let didChangeFilters = false
    for (let ecuStat of eacInfo) {
      let ecu = char4U32LeToString(ecuStat.ecu)
      let apidInfos = this.ecuApidInfosMap.get(ecu)
      if (apidInfos === undefined) {
        apidInfos = new Map()
        this.ecuApidInfosMap.set(ecu, apidInfos)
        didChangeFilters = this.checkConfigAutoEnable(ecu)
      }
      let did_modify_apidInfos = false
      for (let newApidInfo of ecuStat.apids) {
        let apid = char4U32LeToString(newApidInfo.apid)
        let apidNrMsgs = newApidInfo.ctids.reduce((pv, cv) => pv + cv.nr_msgs, 0)
        let existingInfo = apidInfos.get(apid)
        if (existingInfo === undefined) {
          let existingInfo = {
            apid: apid,
            nrMsgs: apidNrMsgs,
            desc: newApidInfo.desc !== undefined ? newApidInfo.desc : '',
            ctids: new Map<string, [string, number]>(
              newApidInfo.ctids.map((c: remote_types.BinCtidInfo) => [char4U32LeToString(c.ctid), [c.desc || '', c.nr_msgs]]),
            ),
          }
          apidInfos.set(apid, existingInfo)
          did_modify_apidInfos = true
        } else {
          // update
          if ((existingInfo.desc.length === 0 && newApidInfo.desc !== undefined) || existingInfo.nrMsgs !== apidNrMsgs) {
            existingInfo.desc = newApidInfo.desc || ''
            existingInfo.nrMsgs = apidNrMsgs
            did_modify_apidInfos = true
          }
          // now iterate ctids:
          for (let ctidInfo of newApidInfo.ctids) {
            let ctid = char4U32LeToString(ctidInfo.ctid)
            let existingCtid = existingInfo.ctids.get(ctid)
            if (existingCtid === undefined) {
              existingInfo.ctids.set(ctid, [ctidInfo.desc !== undefined ? ctidInfo.desc : '', ctidInfo.nr_msgs])
              did_modify_apidInfos = true
            } else {
              if ((existingCtid[0].length === 0 && ctidInfo.desc !== undefined) || existingCtid[1] !== ctidInfo.nr_msgs) {
                existingInfo.ctids.set(ctid, [ctidInfo.desc || '', ctidInfo.nr_msgs])
                did_modify_apidInfos = true
              }
            }
          }
        }
      }
      if (did_modify_apidInfos) {
        // console.log(`adlt.processEacInfo${eacInfo.length}) did_modify_apidInfos`);
        // update apidsNodes...
        for (let [ecu, ecuApidsNode] of this.apidsNodes) {
          let apidInfo = this.ecuApidInfosMap.get(ecu)
          if (apidInfo !== undefined) {
            ecuApidsNode.label = `APIDs (${apidInfo.size}) / CTIDs`
            // update children:
            // for now simply delete the existing ones:
            ecuApidsNode.children.length = 0
            // add new ones:
            for (let [apid, apidI] of apidInfo) {
              const apidNode = new DynFilterNode(
                `'${apid}'(${apidI.ctids.size} #${apidI.nrMsgs})${apidI.desc ? `: ${apidI.desc}` : ''}`,
                `desc='${apidI.desc || ''}', apid = 0x${Buffer.from(apid).toString('hex')}, #msgs=${apidI.nrMsgs}`,
                ecuApidsNode,
                undefined,
                {
                  ecu: ecu,
                  apid: apid,
                  ctid: null,
                  payload: null,
                  payloadRegex: null,
                  not: null,
                  mstp: null,
                  logLevelMin: null,
                  logLevelMax: null,
                  lifecycles: null,
                },
                this,
              )
              ecuApidsNode.children.push(apidNode)
              // add ctids:
              for (let [ctid, [desc, nrMsgs]] of apidI.ctids) {
                const ctidNode = new DynFilterNode(
                  `'${ctid}'(#${nrMsgs})${desc ? `: ${desc} ` : ''}`,
                  `desc='${desc}', ctid = 0x${Buffer.from(ctid).toString('hex')}, #msgs=${nrMsgs}`,
                  apidNode,
                  undefined,
                  {
                    ecu: ecu,
                    apid: apid,
                    ctid: ctid,
                    payload: null,
                    payloadRegex: null,
                    not: null,
                    mstp: null,
                    logLevelMin: null,
                    logLevelMax: null,
                    lifecycles: null,
                  },
                  this,
                )
                apidNode.children.push(ctidNode)
              }
              apidNode.children.sort((a, b) => {
                return a.label.localeCompare(b.label)
              })
            }
            // sort children alpha
            ecuApidsNode.children.sort((a, b) => {
              return a.label.localeCompare(b.label)
            })
          }
        }

        this._treeEventEmitter.fire(null)
      }
    }
    if (this._startStreamPendingSince !== undefined) {
      // we did determine the configs.autoEnableIf filters already upfront (didChangeFilters)
      // no need here to apply filters are this is part of startStream

      this.log.info(
        `adlt.processEacInfo starting stream after ${Date.now() - this._startStreamPendingSince}ms. #Ecus=${this.ecuApidInfosMap.size}`,
      )
      this._startStreamPendingSince = undefined
      this.startStream()
      // if we did change filters we need to fire the onApplyFilter event here as we dont trigger the full apply filter:
      this._onApplyFilterEmitter.fire()
    } else if (didChangeFilters) {
      this.triggerApplyFilter()
    }
  }

  processPluginStateUpdates(states: string[]) {
    for (let stateStr of states) {
      try {
        let state = JSON.parse(stateStr)
        let pluginName = state.name
        // find proper plugin:
        for (let plugin of this.pluginTreeNode.children as AdltPlugin[]) {
          if (plugin.name === pluginName) {
            plugin.processStateUpdate(state)
            break
          }
        }
      } catch (e) {
        this.log.error(`adlt.processPluginStateUpdates got err=${e}`)
      }
    }
  }

  stopStream() {
    this._startStreamPendingSince = undefined
    if (this.streamId > 0) {
      // we do invalidate it already now:
      let oldStreamId = this.streamId
      this.streamId = -this.streamId
      this.visibleMsgs = undefined
      this.visibleLcs = undefined
      return this.sendAndRecvAdltMsg(`stop ${oldStreamId}`).then((text) => {
        // console.log(`adlt on stop resp: ${text}`);
        // todo verify streamId?
        this.streamId = 0
      })
    }
    return Promise.reject('no active stream')
  }

  changeWindow() {
    if (this.streamId > 0) {
      let oldStreamId = this.streamId
      this.streamId = -this.streamId
      return this.sendAndRecvAdltMsg(`stream_change_window ${oldStreamId} ${this._skipMsgs},${this._skipMsgs + this._maxNrMsgs}`).then(
        (response) => {
          //console.log(`adlt.changeWindow on stream_change_window resp: ${response}`); // e.g. ok stream_change_window <old_id>={"id":..., "windows":[]}
          const streamObj = JSON.parse(response.slice(response.indexOf('=') + 1))
          // console.log(`adlt.changeWindow on stream_change_window streamObj: ${JSON.stringify(streamObj)}`);
          let curStreamMsgData = this.streamMsgs.get(streamObj.id)

          this.streamId = streamObj.id

          this.visibleMsgs!.length = 0
          this.visibleLcs!.length = 0
          // empty all decorations
          this.clearDecorations()

          let streamData = this.streamMsgs.get(oldStreamId)
          assert(streamData !== undefined, 'logical error! investigate!')

          this.streamMsgs.set(streamObj.id, streamData!)
          this.streamMsgs.delete(oldStreamId)
          // console.warn(`adlt.changeWindow streamMsgs #${this.streamMsgs.size}`);
          if (curStreamMsgData && Array.isArray(curStreamMsgData)) {
            // process the data now:
            curStreamMsgData.forEach((msgs) => this.processBinStreamMsgs(msgs, streamData as StreamMsgData))
          }
        },
      )
    }
    return Promise.reject('no active stream')
  }

  startStream() {
    const log = this.log
    // start stream:
    let filterStr = this.allFilters
      .filter((f) => (f.type === DltFilterType.POSITIVE || f.type === DltFilterType.NEGATIVE) && f.enabled)
      .map((f) => JSON.stringify({ ...f.asConfiguration(), enabled: true }))
      .join(',') // enabled is not updated/stored in config. so have to overwrite here
    let decFilters = this.allFilters.filter(
      (f) =>
        (f.type === DltFilterType.MARKER ||
          (f.type === DltFilterType.POSITIVE && (f.decorationId !== undefined || f.filterColour !== undefined))) &&
        f.enabled,
    )
    // console.log(`adlt.startStream have ${decFilters.length} decoration filters: ${decFilters.map((f) => f.name).join(',')}`);
    // todo optimize the window so that the start can do a binary search!
    this.sendAndRecvAdltMsg(
      `stream {"window":[${this._skipMsgs},${this._skipMsgs + this._maxNrMsgs}], "binary":true, "filters":[${filterStr}]}`,
    ).then((response) => {
      // console.log(`adlt.on startStream got response:'${response}'`);
      const streamObj = JSON.parse(response.substring(11))
      // console.log(`adlt ok:stream`, JSON.stringify(streamObj));
      this.streamId = streamObj.id
      this.text = ''
      this.visibleMsgs = []
      this.visibleLcs = []
      // empty all decorations
      this.clearDecorations()

      // a timer that updates the text if no messages arrive (e.g. empty filter result)
      let noMessagesTimer: NodeJS.Timeout | undefined = setTimeout(() => {
        if (this.text.length === 0) {
          this.text = `<current filter (${
            this.allFilters.filter((f) => (f.type === DltFilterType.POSITIVE || f.type === DltFilterType.NEGATIVE) && f.enabled).length
          }) lead to empty file>`
          this.emitChanges()
        }
      }, 1000)

      let viewMsgs = this.visibleMsgs
      let visibleLcs = this.visibleLcs
      let doc = this
      let sink: NewMessageSink = {
        onDone() {
          log.trace(`adlt.startStream onDone() nyi!`)
        },
        onNewMessages(nrNewMsgs: number) {
          // console.warn(`adlt.startStream onNewMessages(${nrNewMsgs}) viewMsgs.length=${viewMsgs.length}`);
          // process the nrNewMsgs
          // calc the new text
          // append text and trigger file changes
          if (noMessagesTimer) {
            clearTimeout(noMessagesTimer)
            noMessagesTimer = undefined
          }

          if (nrNewMsgs) {
            // todo depending on the amount of msgs add a progress!
            let isFirst = nrNewMsgs === viewMsgs.length
            let viewMsgsLength = viewMsgs.length
            DltDocument.textLinesForMsgs(
              doc._columns,
              viewMsgs,
              viewMsgsLength - nrNewMsgs,
              viewMsgsLength - 1,
              8 /*todo*/,
              undefined,
            ).then((newTxt: string) => {
              if (isFirst) {
                doc.text = newTxt
              } else {
                doc.text += newTxt
              }
              doc.emitChanges()
              log.info(`adlt.onNewMessages(${nrNewMsgs}, isFirst=${isFirst}) triggered doc changes.`)
              // determine the new decorations:
              let lastLc: DltLifecycleInfoMinIF | undefined = undefined
              let newLcs: [DltLifecycleInfoMinIF, number][] = []
              let endOfLcs: Map<DltLifecycleInfoMinIF, number> = new Map()
              let updatedLcs: Map<string, DltLifecycleInfoMinIF> = new Map() // per ecu only one can be updated
              for (let i = viewMsgsLength - nrNewMsgs; i <= viewMsgsLength - 1; ++i) {
                let msg = viewMsgs[i]
                if (msg.lifecycle !== lastLc) {
                  let lc: DltLifecycleInfoMinIF | undefined = msg.lifecycle
                  if (lc) {
                    // its either a new lc or an updated one:
                    if (visibleLcs.includes(lc)) {
                      // was already included
                      if (!updatedLcs.has(msg.ecu)) {
                        updatedLcs.set(msg.ecu, lc)
                      }
                    } else {
                      // new one, will be included to visibleLcs later
                      if (newLcs.findIndex(([a]) => a === lc) < 0) {
                        newLcs.push([lc, i])
                      }
                    }
                  }
                  if (lastLc) {
                    endOfLcs.set(lastLc, i - 1)
                  }
                  lastLc = lc
                }

                const decs = doc.getDecorationsTypeAndHoverMDForMsg(msg, decFilters)

                if (decs.length) {
                  for (let dec of decs) {
                    let options = doc.decorations.get(dec[0].decType)
                    if (!options) {
                      options = []
                      doc.decorations.set(dec[0].decType, options)
                    }
                    options.push({ range: new vscode.Range(i, 0, i, 21), hoverMessage: dec[1] })
                  }
                }
              }
              if (lastLc) {
                endOfLcs.set(lastLc, viewMsgsLength - 1)
              }
              if (updatedLcs.size > 0) {
                // update decoration end time
                for (let lc of updatedLcs.values()) {
                  //console.warn(`adlt.decorating updating lc ${lc.persistentId}`);
                  // find dec
                  if (lc.decorationType !== undefined) {
                    let decs = doc.decorations.get(lc.decorationType) || []
                    for (let idx = decs.length - 1; idx >= 0; idx--) {
                      let dec = decs[idx] as any // todo vscode.DecorationOptions + DltLifecycleInfoMinIF;
                      if (dec._lc === lc) {
                        let endLine = endOfLcs.get(lc) || dec.range.start.line
                        let oldRange = dec.range
                        dec.range = new vscode.Range(dec.range.start.line, dec.range.start.character, endLine, dec.range.end.character)
                        //console.warn(`adlt.decorating updating lc ${lc.persistentId} old=${oldRange.start.line}-${oldRange.end.line} new=${dec.range.start.line}-${dec.range.end.line}`);
                        dec.hoverMessage = `LC${lc.getTreeNodeLabel()}`
                        break
                      }
                    }
                  }
                }
              }
              if (newLcs.length > 0) {
                // add new decoration for those lcs
                for (let [newLc, startLine] of newLcs) {
                  if (newLc.decorationType !== undefined) {
                    let decs = doc.decorations.get(newLc.decorationType)
                    if (decs === undefined) {
                      decs = []
                      doc.decorations.set(newLc.decorationType, decs)
                    }
                    let endLine = endOfLcs.get(newLc) || startLine
                    if (endLine < startLine) {
                      endLine = startLine
                    }
                    //console.info(`adlt.decorating lc ${newLc.persistentId} ${startLine}-${endLine}`);
                    const dec = {
                      _lc: newLc,
                      range: new vscode.Range(startLine, 0, endLine, 21),
                      hoverMessage: `LC ${newLc.getTreeNodeLabel()}`,
                    }
                    decs.push(dec)
                  }
                  visibleLcs.push(newLc)
                }
              }
              const _ = doc.processMsgTimeHighlights() // we ignore the result as updateDecorations will be called anyhow
            })
          }
        },
      }
      // here some data might be already there for that stream.
      // this can happen even though the wss data arrives sequentially but the processing
      // here for wss data is a direct call vs. an asyn .then()...
      let curStreamMsgData = this.streamMsgs.get(streamObj.id)
      let streamData = { msgs: viewMsgs, sink: sink }
      this.streamMsgs.set(streamObj.id, streamData)
      if (curStreamMsgData && Array.isArray(curStreamMsgData)) {
        // process the data now:
        curStreamMsgData.forEach((msgs) => this.processBinStreamMsgs(msgs, streamData))
      }
    })
  }

  // todo what to do on toggle sortOrder?
  commentThreads: AdltCommentThread[] = []

  /**
   * Comments support
   */

  loadComments() {
    // for now only when commentThreads is empty:
    if (this.commentThreads.length > 0) {
      return
    } else {
      // purge old comments:
      purgeOldComments(this.log, this.globalState)

      this.commentThreads = restoreComments(this.log, this, this.globalState, this.commentController)
      this.updateCommentThreads()
    }
  }

  updateCommentThreads() {
    for (let thread of this.commentThreads) {
      thread.update(this)
    }
  }

  commentsCreate(reply: vscode.CommentReply) {
    try {
      const thread = AdltCommentThread.newFromReply(this.log, this, reply) // can throw
      this.commentThreads.push(thread)

      // sort them so that commentsExport will have the correct order
      // we usually have a few entries only so we can sort them here
      if (this._sortOrderByTime) {
        this.commentThreads.sort((a, b) => {
          return a.minMsgTimeInMs - b.minMsgTimeInMs
        })
      } else {
        // msgs are sorted by index
        this.commentThreads.sort((a, b) => {
          return a.minMsgIndex - b.minMsgIndex
        })
      }
      persistComments(this.log, this.commentThreads, this, this.globalState) // todo after edit/delete as well!
    } catch (e) {
      this.log.error(`AdltDocument.commentCreate(reply) got error: ${e}!`)
    }
    // no update needed for comments here
  }

  commentUpdated(comment: AdltComment) {
    comment.parent?.saveComment(comment)
    persistComments(this.log, this.commentThreads, this, this.globalState)
  }

  commentsDelete(thread: vscode.CommentThread) {
    this.log.warn(`AdltDocument.commentsDelete(thread)`)
    let idx = this.commentThreads.findIndex((t) => t.thread === thread)
    if (idx >= 0) {
      const delThreads = this.commentThreads.splice(idx, 1)
      for (let delThread of delThreads) {
        delThread.dispose()
      }
    }
    persistComments(this.log, this.commentThreads, this, this.globalState)
  }

  /**
   * Export the comments to the clipboard
   * @param thread the thread to export or the commentThreads to export or if undefined all threads will be exported
   */
  commentsExport(thread: vscode.CommentThread | AdltCommentThread[] | undefined) {
    let threads =
      thread !== undefined ? (Array.isArray(thread) ? thread : [this.commentThreads.find((t) => t.thread === thread)]) : this.commentThreads
    threads = threads.filter((t) => t !== undefined)
    if (threads.length === 0) {
      vscode.window.showInformationMessage('No comments to export')
      return
    }
    let exportStr = ''
    for (const thread of threads) {
      if (thread !== undefined) {
        exportStr += thread.asMarkupText() // asMarkdownText()
      }
    }
    vscode.env.clipboard.writeText(exportStr)
    vscode.window.showInformationMessage(
      `Exported ${threads.length} comment ${threads.length > 1 ? 'threads' : 'thread'} to clipboard as markup text`,
    )
  }

  /**
   * Show a quick pick to select which threads/comments to export and export them to the clipboard
   * @param thread the thread that should be pre-selected
   */
  commentsExportMulti(thread: vscode.CommentThread) {
    const threads = this.commentThreads
    const items = threads.map((t) => ({
      label: t.summary().slice(0, 60),
      description:
        t.msgs.length > 1
          ? `${t.msgs.length} logs #${t.minMsgIndex}..${t.msgs[t.msgs.length - 1].index} ${new Date(
              t.minMsgTimeInMs,
            ).toLocaleTimeString()}..`
          : `log #${t.minMsgIndex} ${new Date(t.minMsgTimeInMs).toLocaleTimeString()} (calc.time)`,
      picked: t.thread === thread, // determines whether it's pre-selected only
      _thread: t,
    }))
    vscode.window.showQuickPick(items, { canPickMany: true, placeHolder: 'Select the comment threads to export' }).then((selected) => {
      if (selected) {
        const selectedThreads = selected.map((s) => s._thread)
        this.log.info(`AdltDocument.commentsExportMulti() selected ${selectedThreads.length} threads`)
        this.commentsExport(selectedThreads)
      }
    })
  }

  /**
   * Clears all decorations from the text editors.
   *
   * Called after changeWindow and startStream.
   */
  clearDecorations() {
    // console.log(`adlt.clearDecorations()...`);
    this.textEditors.forEach((editor) => {
      this.decorations.forEach((value, key) => {
        value.length = 0 // seems a way to clear all elements
        // this is not needed as we modify the orig array. editor.setDecorations(key, value);
      })
    })
  }

  /**
   * Updates the decorations in the text editors based on all the stored decorations.
   *
   * This is called whenever the active text editor changes (unclear why... todo) or
   * when the text document changed.
   */
  updateDecorations() {
    // console.log(`adlt.updateDecorations()...`);
    this.textEditors.forEach((editor) => {
      this.decorations.forEach((value, key) => {
        editor.setDecorations(key, value)
      })
    })

    // update all commentThreads: (todo not needed on active text editor change)
    this.updateCommentThreads()
  }

  /**
   * Updates a single decoration for all text editors.
   * @param decType The decoration type to update.
   */
  updateDecoration(decType: vscode.TextEditorDecorationType) {
    //console.log(`adlt.updateDecoration(${decType.key})...`)
    const rangesOrOptions = this.decorations.get(decType) || []
    this.textEditors.forEach((editor) => {
      editor.setDecorations(decType, rangesOrOptions)
    })
  }

  getDecorationsTypeAndHoverMDForMsg(msg: FilterableDltMsg, decFilters: DltFilter[]) {
    let decs: [DecorationsInfo, vscode.MarkdownString][] = []

    if (msg.mstp === MSTP.TYPE_LOG) {
      if (this.decWarning && msg.mtin === MTIN_LOG.LOG_WARN) {
        decs.push([this.decWarning, this.mdWarning])
      } else if (this.decError && msg.mtin === MTIN_LOG.LOG_ERROR) {
        decs.push([this.decError, this.mdError])
      } else if (this.decFatal && msg.mtin === MTIN_LOG.LOG_FATAL) {
        decs.push([this.decFatal, this.mdFatal])
      }
    }
    if (decFilters.length > 0) {
      for (let d = 0; d < decFilters.length; ++d) {
        let decFilter = decFilters[d]
        if (decFilter.matches(msg)) {
          const decType = this.getDecorationFor(decFilter)
          if (decType) {
            decs.push([decType[0], decType[1]])
            break
          }
        }
      }
    }
    return decs
  }

  // message/time highlighting support (used from SearchPanel)
  // to highlight a clicked/selected search result in the editor
  private msgTimeHighlights = new Map<string, MsgTimeHighlight[]>()

  /**
   * Sets the message time highlights for a specific provider.
   *
   * @param provider - The provider for which to set the highlights.
   * @param highlights - An array of objects containing the message index to highlight. Use empty array to unset.
   */
  public setMsgTimeHighlights(provider: string, highlights: MsgTimeHighlight[]) {
    this.log.info(`adlt.setMsgTimeHighlights(${provider}, ${highlights.length})...`)
    let didChange = true
    if (highlights.length === 0) {
      didChange = this.msgTimeHighlights.delete(provider)
    } else {
      this.msgTimeHighlights.set(provider, highlights)
    }
    if (didChange) {
      this.processMsgTimeHighlights().forEach((decType) => this.updateDecoration(decType))
    }
  }

  public getMsgTimeHighlights(provider: string): MsgTimeHighlight[] | undefined {
    return this.msgTimeHighlights.get(provider)
  }

  /**
   * Processes the message time highlights.
   *
   * Will be called once the msgTimeHighlights have been updated or when the document changes. (todo)
   *
   * @returns An array of decoration types that have been updated.
   */
  processMsgTimeHighlights(): vscode.TextEditorDecorationType[] {
    const log = this.log
    // console.log(`adlt.processMsgTimeHighlights()...`)
    if (!this.visibleMsgs) {
      log.info(`adlt.processMsgTimeHighlights() no visibleMsgs yet! Ignoring.`)
      return []
    }

    const decType = this.decMsgTimeHighlights?.decType
    if (decType === undefined) {
      return []
    }
    let decOptions = this.decorations.get(decType)
    if (!decOptions) {
      decOptions = []
      this.decorations.set(decType, decOptions)
    } else {
      decOptions.length = 0
    }
    for (const highlights of this.msgTimeHighlights.values()) {
      for (const highlight of highlights) {
        // todo: this is slow O(n). we could do the calculatedTimeInMs search always first and then check whether the msg is included!
        const msgVisIdx = this.visibleMsgs.findIndex((msg) => msg.index === highlight.msgIndex)
        if (msgVisIdx >= 0) {
          log.info(`adlt.processMsgTimeHighlights() msgIndex=${highlight.msgIndex} visible at ${msgVisIdx}`)
          decOptions.push({ range: new vscode.Range(msgVisIdx, 0, msgVisIdx, 21), hoverMessage: undefined })
        } else {
          // the exact msg is currently not visible, so we need to find the closest one:
          // two cases: a) sorted by time and b) sorted by index
          // todo impl for !this._sortOrderByTime
          log.info(
            `adlt.processMsgTimeHighlights() msgIndex=${highlight.msgIndex} not visible, sortOrderByTime=${this._sortOrderByTime} req. time=${highlight.calculatedTimeInMs}`,
          )
          if (highlight.calculatedTimeInMs !== undefined) {
            // find the closest ones by time (e.g. one before and one after)
            // do a binary search in the visibleMsgs:
            let point = this._sortOrderByTime
              ? util.partitionPoint(this.visibleMsgs, (msg: AdltMsg) => {
                  const msgTimeInMs = this.provideTimeByMsgInMs(msg) || msg.receptionTimeInMs // fallback to that same as adlt.buffer_sort_messages does
                  if (msgTimeInMs === undefined) {
                    log.warn(`adlt.processMsgTimeHighlights() msgIndex=${highlight.msgIndex} msgTimeInMs=undefined!`)
                  }
                  return msgTimeInMs === undefined || msgTimeInMs < highlight.calculatedTimeInMs!
                }) // undefined case can break the binary search (non partitioned, but it should never happen as each msg has a receptionTimeInMs)
              : util.partitionPoint(this.visibleMsgs, (msg: AdltMsg) => {
                  return msg.index < highlight.msgIndex
                })
            log.info(`adlt.processMsgTimeHighlights() partitionPoint=${point}`)
            // we highlight only if there is a msg before and after (otherwise it gets misleading)
            if (point > 0 && point < this.visibleMsgs.length) {
              decOptions.push({ range: new vscode.Range(point - 1, 0, point, 21), hoverMessage: undefined })
            }
          }
        }
      }
    }
    return [decType]
  }

  // window support:
  notifyVisibleRange(range: vscode.Range) {
    //console.warn(`adlt.notifyVisibleRange ${range.start.line}-${range.end.line} maxNrMsgs=${this._maxNrMsgs}`);

    // we do show max _maxNrMsgs from [_skipMsgs, _skipMsgs+_maxNrMsgs)
    // and trigger a reload if in the >4/5 or <1/5
    // and jump by 0.5 then

    const triggerAboveLine = range.start.line
    const triggerBelowLine = range.end.line

    // we ignore the ranges for the interims "loading..." docs.
    if (triggerBelowLine - triggerAboveLine < 10) {
      this.log.trace(
        `adlt.notifyVisibleRange ignoring as range too small (visible: [${triggerAboveLine}-${triggerBelowLine}]) current: [${
          this._skipMsgs
        }-${this._skipMsgs + this._maxNrMsgs})`,
      )
      return
    }

    if (triggerAboveLine <= this._maxNrMsgs * 0.2) {
      // can we scroll to the top?
      if (this._skipMsgs > 0) {
        //console.log(`adlt.notifyVisibleRange(visible: [${triggerAboveLine}-${triggerBelowLine}]) current: [${this._skipMsgs}-${this._skipMsgs + this._maxNrMsgs}) triggerAbove`);

        if (this.textEditors && this.textEditors.length > 0) {
          this.textEditors.forEach((editor) => {
            const shiftByLines = +this._maxNrMsgs * 0.5
            // todo check for <0
            let newRange = new vscode.Range(
              triggerAboveLine + shiftByLines,
              range.start.character,
              triggerBelowLine + shiftByLines,
              range.end.character,
            )
            editor.revealRange(newRange, vscode.TextEditorRevealType.AtTop)
          })
        }
        this._skipMsgs -= this._maxNrMsgs * 0.5
        if (this._skipMsgs < 0) {
          this._skipMsgs = 0
        }
        this.changeWindow()
      }
    }

    if (triggerBelowLine >= this._maxNrMsgs * 0.8) {
      // can we load more msgs?
      const msgs = this.visibleMsgs
      if (msgs && this._maxNrMsgs === msgs.length) {
        // we assume more msgs are there (might be none) (todo test that case)
        // console.log(`adlt.notifyVisibleRange(visible: [${triggerAboveLine}-${triggerBelowLine}]) current: [${this._skipMsgs}-${this._skipMsgs + this._maxNrMsgs}) triggerBelow`);
        if (this.textEditors.length > 0) {
          this.textEditors.forEach((editor) => {
            const shiftByLines = -this._maxNrMsgs * 0.5
            let newRange = new vscode.Range(
              triggerAboveLine + shiftByLines,
              range.start.character,
              triggerBelowLine + shiftByLines,
              range.end.character,
            )
            editor.revealRange(newRange, vscode.TextEditorRevealType.AtTop)
          })
        }
        this._skipMsgs += this._maxNrMsgs * 0.5
        this.changeWindow()
      }
    }
  }

  // filter change support:

  onFilterAdd(filter: DltFilter, callTriggerApplyFilter: boolean = true): boolean {
    this.filterTreeNode.children.push(new FilterNode(null, this.filterTreeNode, filter))
    if (filter.configs.length > 0) {
      this.updateConfigs(filter)
      if (this.configTreeNode) {
        this._treeEventEmitter.fire(this.configTreeNode)
      }
    }

    this.allFilters.push(filter)
    if (!callTriggerApplyFilter) {
      return true
    }
    this.triggerApplyFilter(true)
    return true
  }

  onFilterEdit(filter: DltFilter): boolean {
    // update filterNode needs to be done by caller. a bit messy...

    // we dont know whether configs have changed so lets recheck/update:
    this.updateConfigs(filter)
    // TODO! dont call this or a strange warning occurs. not really clear why. this._treeEventEmitter.fire(this.configTreeNode);

    this.triggerApplyFilter()
    return true
  }

  onFilterDelete(filter: DltFilter, callTriggerApplyFilter: boolean = true): boolean {
    filter.enabled = false // just in case

    // remove from list of allFilters and from filterTreeNode
    let found = false
    for (let i = 0; i < this.allFilters.length; ++i) {
      if (this.allFilters[i] === filter) {
        this.allFilters.splice(i, 1)
        found = true
        break
      }
    }
    if (found) {
      found = false
      for (let i = 0; i < this.filterTreeNode.children.length; ++i) {
        let node = this.filterTreeNode.children[i]
        if (node instanceof FilterNode && node.filter === filter) {
          this.filterTreeNode.children.splice(i, 1)
          found = true
          break
        }
      }
    }
    if (!found) {
      vscode.window.showErrorMessage(`didn't found nodes to delete filter ${filter.name}`)
      return false
    }
    if (!callTriggerApplyFilter) {
      return true
    }
    this.triggerApplyFilter(true)
    return true
  }

  private debouncedApplyFilterTimeout: NodeJS.Timeout | undefined
  /**
   * Trigger applyFilter and show progress
   * This is debounced/delayed a bit (500ms) to avoid too frequent
   * apply filter operation that is longlasting.
   */
  triggerApplyFilter(fireTreeEvent: boolean = false) {
    const log = this.log

    if (fireTreeEvent) {
      this._treeEventEmitter.fire(this.filterTreeNode)
    }

    // console.log(`adlt.triggerApplyFilter() called for '${this.uri.toString().slice(0, 100)}'`);
    if (this.debouncedApplyFilterTimeout) {
      clearTimeout(this.debouncedApplyFilterTimeout)
    }
    this.debouncedApplyFilterTimeout = setTimeout(() => {
      // console.log(`adlt.triggerApplyFilter after debounce for '${this.uri.toString().slice(0, 100)}'`);
      if (this._applyFilterRunning) {
        log.warn(`adlt.triggerApplyFilter currently running, Retriggering.`)
        this.triggerApplyFilter()
      } else {
        this._onApplyFilterEmitter.fire()
        return vscode.window.withProgress(
          { cancellable: false, location: vscode.ProgressLocation.Notification, title: 'applying filter...' },
          (progress) => this.applyFilter(progress),
        )
      }
    }, 500)
  }

  private _applyFilterRunning: boolean = false
  async applyFilter(
    progress: vscode.Progress<{ increment?: number | undefined; message?: string | undefined }> | undefined,
    applyEventFilter: boolean = false,
  ) {
    const log = this.log
    if (this._applyFilterRunning) {
      log.warn(`adlt.applyFilter called while running already. ignoring for now. todo!`) // do proper fix queuing this request or some promise magic.
      return
    } else {
      log.trace(`adlt.applyFilter called...`)
    }
    this._applyFilterRunning = true
    // stop current stream:
    this.stopStream()
      .then(() => {
        //this.clearText(); (done by startStream)
      })
      .catch(() => {}) // errors are ok
    // start new stream with current allFilters: (no need to chain it)
    this._skipMsgs = 0 // todo or determine the time to scroll to or scroll to top?
    this.startStream()
    this._applyFilterRunning = false
  }

  async toggleSortOrder() {
    const log = this.log
    this._sortOrderByTime = !this._sortOrderByTime
    log.info(`ADltDocument.toggleSortOrder() new sortOrderByTime=${this._sortOrderByTime}`)
    this.stopStream()
    // a change of sort order needs a new file open!
    this.closeAdltFiles()
      .then(() => {
        this.clearLifecycleInfos()
        this.openAdltFiles()
      })
      .catch((reason) => {
        log.warn(`ADltDocument.toggleSortOrder() closeAdltFiles failed with '${reason}'`)
      })
  }

  private _reports: DltReport[] = []

  onDidChangeSelectedTime(time: Date[] | Date | null) {
    this._reports.forEach((r) => r.onDidChangeSelectedTime(time))
  }

  revealMsgIndex(index: number): void {
    const log = this.log
    log.info(`adlt.revealMsgIndex(${index})`)
    this.lineCloseTo(index).then((line) => {
      log.info(`adlt.revealMsgIndex(${index}) line=${line}`)
      this.revealLine(line)
    })
  }

  revealDate(time: Date): void {
    this.log.info(`adlt.revealDate(${time})`)
    this.lineCloseTo(time).then((line) => {
      this.revealLine(line)
    })
  }

  revealLine(line: number): void {
    try {
      if (line >= 0 && this.textEditors) {
        const posRange = new vscode.Range(line, 0, line, 0)
        this.textEditors.forEach((value) => {
          value.revealRange(posRange, vscode.TextEditorRevealType.AtTop)
        })
      }
    } catch (err) {
      this.log.warn(`adlt.revealLine(${line}) got err=${err}`)
    }
  }

  /**
   * handler called if the (lifecycle) treeview selection did change towards one of our items
   * Wont be called if the item is deselected or another docs item is selected!
   * @param event
   */
  onTreeViewDidChangeSelection(event: vscode.TreeViewSelectionChangeEvent<TreeViewNode>) {
    if (event.selection.length && event.selection[0].uri && event.selection[0].uri.fragment.length) {
      const firstFrag = event.selection[0].uri.fragment
      if (firstFrag.startsWith('msgIndex:')) {
        const index = +firstFrag.substring(9)
        this.log.info(`adlt.onTreeViewDidChangeSelection() msgIndex=${index}`)
        this.revealMsgIndex(index)
      } else {
        const index = +event.selection[0].uri.fragment
        this.revealDate(new Date(index))
      }
    }
  }

  getLastActiveReport(): DltReport | undefined {
    let lastChangeActive = -1
    let lastReport: DltReport | undefined = undefined
    for (const r of this._reports) {
      if (r.lastChangeActive && r.lastChangeActive.valueOf() > lastChangeActive) {
        lastReport = r
        lastChangeActive = r.lastChangeActive.valueOf()
      }
    }
    return lastReport
  }

  getNewReport(context: vscode.ExtensionContext): DltReport {
    const log = this.log
    const docThis = this
    const report = new DltReport(log, context, this, (r: DltReport) => {
      log.trace(`getNewReport... onDispose called... #reports=${docThis._reports.length}`)
      const idx = docThis._reports.indexOf(r)
      if (idx >= 0) {
        docThis._reports.splice(idx, 1)
      }
    })
    this._reports.push(report)
    return report
  }

  onOpenReport(
    context: vscode.ExtensionContext,
    filter: DltFilter | DltFilter[],
    newReport: boolean = false,
    reportToAdd: DltReport | undefined = undefined,
  ) {
    const log = this.log
    // console.log(`onOpenReport called...`);
    if (this.reporter) {
      this.reporter.sendTelemetryEvent(
        'onOpenReport',
        { newReport: newReport ? 'true' : 'false' },
        { nrFilters: Array.isArray(filter) ? filter.length : 1 },
      )
    }

    if (!newReport && (this._reports.length > 0 || reportToAdd !== undefined)) {
      // we do add to the report that was last active or to the provided one
      let report = reportToAdd ? reportToAdd : this.getLastActiveReport() || this._reports[0]
      let filters = Array.isArray(filter) ? filter : [filter]
      let filterStr = filters
        .filter((f) => f.enabled)
        .map((f) => JSON.stringify({ ...f.asConfiguration(), enabled: true }))
        .join(',')
      this.sendAndRecvAdltMsg(`stream {"window":[0,${this._maxReportLogs}], "binary":true, "filters":[${filterStr}]}`).then((response) => {
        // console.log(`adlt.on startStream got response:'${response}'`);
        const streamObj = JSON.parse(response.substring(11))
        // console.log(`adtl ok:stream`, JSON.stringify(streamObj));

        let singleReport = report.addFilter(filter)
        if (singleReport !== undefined) {
          let streamMsgs: AdltMsg[] = singleReport.msgs as AdltMsg[]
          report.disposables.push({
            // TODO should refactor to use Disposable from SingleReport
            dispose: () => {
              this.sendAndRecvAdltMsg(`stop ${streamObj.id}`).then(() => {})
              log.trace(`onOpenReport reportToAdd onDispose stopped stream`)
            },
          })

          let curStreamMsgData = this.streamMsgs.get(streamObj.id)
          let streamData = { msgs: streamMsgs, sink: singleReport }
          this.streamMsgs.set(streamObj.id, streamData)
          if (curStreamMsgData && Array.isArray(curStreamMsgData)) {
            // process the data now:
            curStreamMsgData.forEach((msgs) => this.processBinStreamMsgs(msgs, streamData))
          }
          return report
        } else {
          return undefined
        }
      })
    } else {
      // shall we query first the messages fitting to the filters or shall we
      // open the report first and add the messages then?
      let filters = Array.isArray(filter) ? filter : [filter]
      let filterStr = filters
        .filter((f) => f.enabled)
        .map((f) => JSON.stringify({ ...f.asConfiguration(), enabled: true }))
        .join(',')
      this.sendAndRecvAdltMsg(`stream {"window":[0,${this._maxReportLogs}], "binary":true, "filters":[${filterStr}]}`).then((response) => {
        // console.log(`adlt.on startStream got response:'${response}'`);
        const streamObj = JSON.parse(response.substring(11))
        // console.log(`adtl ok:stream`, JSON.stringify(streamObj));
        //let streamMsgs: AdltMsg[] = [];
        // TODO refactor to use getNewReport
        let report = new DltReport(log, context, this, (r: DltReport) => {
          // todo msgs
          log.trace(`onOpenReport onDispose called... #reports=${this._reports.length}`)
          const idx = this._reports.indexOf(r)
          if (idx >= 0) {
            this._reports.splice(idx, 1)
          }
          this.sendAndRecvAdltMsg(`stop ${streamObj.id}`).then(() => {})
          log.trace(`onOpenReport onDispose done #reports=${this._reports.length}`)
        })
        let singleReport = report.addFilter(filter)
        if (singleReport !== undefined) {
          let streamMsgs = singleReport.msgs as AdltMsg[]
          // here some data might be already there for that stream.
          // this can happen even though the wss data arrives sequentially but the processing
          // here for wss data is a direct call vs. an asyn .then()...
          let curStreamMsgData = this.streamMsgs.get(streamObj.id)
          let streamData = { msgs: streamMsgs, sink: singleReport }
          this.streamMsgs.set(streamObj.id, streamData)
          if (curStreamMsgData && Array.isArray(curStreamMsgData)) {
            // process the data now:
            curStreamMsgData.forEach((msgs) => this.processBinStreamMsgs(msgs, streamData))
          }

          this._reports.push(report) // todo implement Disposable for DltDocument as well so that closing a doc closes the report as well

          return report
        } else {
          return undefined
        }
      })
    }
  }

  provideTimeByMsg(msg: FilterableDltMsg | ViewableDltMsg): Date | undefined {
    const timeInMs = this.provideTimeByMsgInMs(msg)
    if (timeInMs === undefined) {
      return
    } else {
      return new Date(timeInMs)
    }
  }

  provideTimeByMsgInMs(msg: FilterableDltMsg | ViewableDltMsg): number | undefined {
    if (msg.mstp === MSTP.TYPE_CONTROL && msg.mtin === MTIN_CTRL.CONTROL_REQUEST) {
      return
    }
    if (msg.lifecycle) {
      return msg.lifecycle.lifecycleStart.valueOf() + msg.timeStamp / 10
    }
    return 'receptionTimeInMs' in msg ? msg.receptionTimeInMs : msg.timeStamp / 10
  }

  /**
   * Finds the line number closest to the given message index or date.
   * If the line is not in the visible range or too close to the edge, it requeries and returns the new line number.
   * @param msgIndexOrDate The message index or date to search for.
   * @returns A promise that resolves to the line number.
   */
  async lineCloseTo(msgIndexOrDate: number | Date): Promise<number> {
    const log = this.log
    // ideas:
    // we query adlt here for the line (could as well scan/binsearch the visibleMsgs and query adlt only if before first or last)
    // then if not in range (or too close to edge) -> requery
    // and return the new line
    if (this.streamId > 0) {
      const searchParam = typeof msgIndexOrDate === 'number' ? `index=${msgIndexOrDate}` : `time_ms=${msgIndexOrDate.valueOf()}`
      return this.sendAndRecvAdltMsg(`stream_binary_search ${this.streamId} ${searchParam}`)
        .then((response) => {
          log.trace(`adlt on search_stream(${searchParam}) resp: ${response}`)
          const responseObj = JSON.parse(response.substring(response.indexOf('=') + 1))
          //console.warn(`adlt on seach_stream resp: ${JSON.stringify(responseObj)}`);
          let index = responseObj.filtered_msg_index
          if (index !== undefined) {
            if (index < this._skipMsgs || index >= this._skipMsgs + (this.visibleMsgs?.length || 0)) {
              log.trace(
                `adlt on search_stream ${index} not in range: ${this._skipMsgs}..${this._skipMsgs + (this.visibleMsgs?.length || 0)}`,
              )
              // we want it so that the new line is skipMsgs..25%..line..75%.
              let offset = Math.min(Math.round(this._maxNrMsgs * 0.25), index)
              this._skipMsgs = index - offset

              this.changeWindow()
              //console.log(`adlt on seach_stream ${index} -> ${offset}`);
              return offset // this is the new one
            } else {
              // visible (might still be in the upper or lower bound where a scroll will happen.... )
              log.trace(
                `adlt on search_stream ${index} in range: ${this._skipMsgs}..${this._skipMsgs + (this.visibleMsgs?.length || 0)} -> ${
                  index - this._skipMsgs
                }`,
              )
              return index - this._skipMsgs
            }
          } else {
            return -1
          }
        })
        .catch((reason) => {
          log.warn(`adlt on seach_stream resp err: ${reason}`)
          return -1
        })
    }
    return -1
  }

  /**
   * Return the line number of the given message index (not the index in visibleMsgs but the orig msg index).
   *
   * This is currently really slow! (O(n))
   * @param msg
   * @returns line number (0-based) or -1/-2 if not found
   */
  public lineByMsgIndex(msgIndex: number): number {
    if (this.visibleMsgs) {
      // todo might optimize by binary search (if sorted by index)
      // or by time based binary search (or by asking adlt)
      return this.visibleMsgs.findIndex((m) => m.index === msgIndex)
    }
    return -2
  }

  msgByLine(line: number): AdltMsg | undefined {
    let msgs = this.visibleMsgs
    if (msgs && line < msgs.length) {
      return msgs[line]
    }
    return undefined
  }

  provideTimeByLine(line: number): Date | undefined {
    const msg = this.msgByLine(line)
    if (msg) {
      return this.provideTimeByMsg(msg)
    }
    return
  }

  public provideHover(position: vscode.Position): vscode.ProviderResult<vscode.Hover> {
    const log = this.log
    if (position.character > 21) {
      return
    } // we show hovers only at the begin of the line
    const msg = this.msgByLine(position.line)
    if (!msg) {
      return
    }

    const receptionDate = new Date(msg.receptionTimeInMs)
    const posTime = this.provideTimeByMsg(msg) || receptionDate
    let mdString = new vscode.MarkdownString(
      util.escapeMarkdown(
        `${posTime.toLocaleTimeString()}.${String(posTime.valueOf() % 1000).padStart(3, '0')} index#=${msg.index} timestamp=${
          msg.timeStamp
        } reception time=${receptionDate.toLocaleTimeString()} mtin=${msg.mtin}`,
      ),
      true,
    )
    mdString.appendMarkdown(`\n\n---\n\n`)

    let apidDesc = ''
    let ctidDesc = ''
    const apidInfos = this.ecuApidInfosMap.get(msg.ecu)?.get(msg.apid)
    if (apidInfos !== undefined) {
      apidDesc = `: ${util.escapeMarkdown(apidInfos.desc)}`
      const ctidInfo = apidInfos.ctids.get(msg.ctid)
      if (ctidInfo !== undefined) {
        ctidDesc = `: ${util.escapeMarkdown(ctidInfo[0])}`
      }
    }
    mdString.appendMarkdown(
      `| calculated time | ${util.escapeMarkdown(posTime.toLocaleTimeString())}.${String(posTime.valueOf() % 1000).padStart(
        3,
        '0',
      )}|\n| :--- | :--- |\n` +
        `| lifecycle | ${util.escapeMarkdown(msg.lifecycle?.getTreeNodeLabel())}|\n` +
        `| ecu session id | ${util.escapeMarkdown(msg.ecu)} nyi ${0 /*msg.sessionId*/} |\n` +
        `| timestamp | ${msg.timeStamp / 10000} s |\n` +
        `| reception time | ${util.escapeMarkdown(receptionDate.toLocaleTimeString())}.${String(
          Number(msg.receptionTimeInMs % 1000).toFixed(0),
        ).padStart(3, '0')} |\n` +
        `| apid | ${util.escapeMarkdown(msg.apid)}${apidDesc} |\n` +
        `| ctid | ${msg.ctid}${ctidDesc} |\n`,
    )
    mdString.appendMarkdown(`\n\n-- -\n\n`)

    const args = [
      { uri: this.uri.toString(), base64Uri: Buffer.from(this.uri.toString()).toString('base64') },
      { mstp: msg.mstp, ecu: msg.ecu, apid: msg.apid, ctid: msg.ctid, payload: msg.payloadString },
    ]
    const addCommandUri = vscode.Uri.parse(`command:dlt-logs.addFilter?${encodeURIComponent(JSON.stringify(args))}`)

    mdString.appendMarkdown(`[$(filter) add filter... ](${addCommandUri})`)

    // can we create a report from that log line?
    try {
      // do we have multiple selected lines?
      const selections = this.textEditors.length > 0 ? this.textEditors[0].selections : []
      const payloads = [msg.payloadString]
      // limit to 10.000 selections for now (todo make full async?)
      // and max 100 different payloads
      selections.slice(0, 10000).forEach((selection) => {
        if (selection.isSingleLine) {
          let selMsg = this.msgByLine(selection.start.line)
          // todo think whether filter on ctid/apid is necessary for selections
          if (selMsg && selMsg.ctid === msg.ctid && selMsg.apid === msg.apid) {
            let payload = selMsg.payloadString
            if (payloads.length < 100 && !payloads.includes(payload)) {
              payloads.push(payload)
            }
          }
        }
      })

      const regexs = generateRegex(payloads)
      log.trace(`AdltDocument.provideHover regexs='${regexs.map((v) => '/' + v.source + '/').join(',')}'`)
      if (regexs.length === 1 && regexs[0].source.includes('(?<')) {
        // added encoding of the uri using base64 but the same problem can happen with payloadRegex as well...
        // filed https://github.com/microsoft/vscode/issues/179962 to have it fixed/analysed within vscode.
        const args = [
          { uri: this.uri.toString(), base64Uri: Buffer.from(this.uri.toString()).toString('base64') },
          { type: 3, mstp: msg.mstp, apid: msg.apid, ctid: msg.ctid, payloadRegex: regexs[0].source },
        ]
        const addCommandUri = vscode.Uri.parse(`command:dlt-logs.openReport?${encodeURIComponent(JSON.stringify(args))}`)
        // console.warn(`quick report openReport with command uri:'${addCommandUri}' for doc uri:'${this.uri.toString()}'`);
        mdString.appendMarkdown(`[$(graph) open quick report... ](${addCommandUri})`)
        mdString.appendMarkdown(
          `[$(globe) open regex101.com with quick report...](https://regex101.com/?flavor=javascript&regex=${encodeURIComponent(
            args[1].payloadRegex || '',
          )}&testString=${encodeURIComponent(payloads.slice(0, 20).join('\n'))})`,
        )
        /*mdString.appendMarkdown(`\n\n-- -\n\n`);
                mdString.appendCodeblock('/' + args[1].payloadRegex + '/', 'javascript');*/
      }
    } catch (e) {
      log.error(`hover generateRegex got error='${e}'`)
    }
    mdString.isTrusted = true

    return new vscode.Hover(mdString)
  }

  /// the last time updateStatusBar has been called.
  /// this is used as well to determine which document to use for restQuery if none is visible
  lastUpdatedStatusBar: number = 0

  updateStatusBarItem(item: vscode.StatusBarItem) {
    this.lastUpdatedStatusBar = Date.now()
    if (this.webSocketIsConnected) {
      if (this.statusProgress !== undefined) {
        item.text = `$(sync~spin) ${this.statusProgress.action}:${this.statusProgress.cur_progress}/${this.statusProgress.max_progress}`
        if (this.statusProgress.cur_progress === this.statusProgress.max_progress) {
          // remove in 1s
          setTimeout(() => {
            if (this.statusProgress && this.statusProgress.cur_progress === this.statusProgress.max_progress) {
              this.statusProgress = undefined
              this.emitStatusChanges.fire(this.uri)
            }
          }, 1000)
        }
        this.statusProgress = undefined // we let any other msg overwrite it
      } else {
        item.text =
          this.visibleMsgs !== undefined && this.visibleMsgs.length !== this.fileInfoNrMsgs
            ? `${this.visibleMsgs.length}/${this.fileInfoNrMsgs} msgs`
            : `${this.fileInfoNrMsgs} msgs`
        let nrEnabledFilters: number = 0
        this.allFilters.forEach((filter) => {
          if (!filter.atLoadTime && filter.enabled && (filter.type === DltFilterType.POSITIVE || filter.type === DltFilterType.NEGATIVE)) {
            nrEnabledFilters++
          }
        })
        const nrAllFilters = this.allFilters.length
        // todo show wss connection status
        item.tooltip = `ADLT v${this.adltVersion || ':unknown!'}: ${this._fileNames.join(', ')}, showing max ${this._maxNrMsgs} msgs, ${
          0 /*this._timeAdjustMs / 1000*/
        }s time-adjust, ${
          0 /* todo this.timeSyncs.length*/
        } time-sync events, ${nrEnabledFilters}/${nrAllFilters} enabled filters, sorted by ${this._sortOrderByTime ? 'time' : 'index'}`
      }
    } else {
      item.text = '$(alert) adlt not con!'
      item.tooltip = `ADLT: ${this._fileNames.join(', ')}, not connected to adlt via websocket!`
    }
    if (this.webSocketErrors.length > 0) {
      item.text += ` $(alert) ${this.webSocketErrors.length} errors!`
      item.tooltip += ` Errors:\n${this.webSocketErrors.join('\n')}`
    }
  }

  processFileInfoUpdates(fileInfo: remote_types.BinFileInfo) {
    //console.log(`adlt fileInfo: nr_msgs=${fileInfo.nr_msgs}`);
    this.fileInfoNrMsgs = fileInfo.nr_msgs
    this.emitStatusChanges.fire(this.uri)
    this.checkActiveRestQueryDocChanged()
  }

  processProgress(progress: remote_types.BinProgress) {
    this.log.info(`adlt progress: ${progress.cur_progress}/${progress.max_progress} '${progress.action}'`)
    this.statusProgress = progress
    this.emitStatusChanges.fire(this.uri)
  }

  clearLifecycleInfos() {
    this.log.info(`adlt.clearLifecycleInfos()...`)
    this.lifecycles.clear()
    this.lifecyclesByPersistentId.clear()
    this.lifecycleTreeNode.children.length = 0
    this._treeEventEmitter.fire(this.lifecycleTreeNode)
  }

  /**
   * process lifecycles updates
   * we expect only updated lifecycles since last openFile
   * todo clear at closeFile...
   * @param lifecycles updated lifecycles from adlt
   */
  processLifecycleUpdates(lifecycles: Array<remote_types.BinLifecycle>) {
    const log = this.log
    // todo check for changes compared to last update
    // for now we check only whether some ecus or lifecycles are not needed anymore:

    // determine ecu to decorate if called the first time:
    let decorateEcu: string | undefined = undefined

    if (this.lifecycles.size === 0) {
      let msgsByEcu: Map<string, number> = new Map()
      lifecycles.forEach((lc) => {
        let ecuStr = char4U32LeToString(lc.ecu)
        let msgs = msgsByEcu.get(ecuStr)
        msgsByEcu.set(ecuStr, (msgs || 0) + lc.nr_msgs)
      })
      let maxNrMsgs = -1
      for (let [ecu, nrMsgs] of msgsByEcu) {
        if (nrMsgs > maxNrMsgs) {
          decorateEcu = ecu
          maxNrMsgs = nrMsgs
        }
      }
    }

    // determine updated ones vs. new ones:
    let fireTreeNode = false
    for (let lc of lifecycles) {
      let lcInfo = this.lifecyclesByPersistentId.get(lc.id)
      if (lcInfo !== undefined) {
        // update
        ;(lcInfo as AdltLifecycleInfo).update(lc, this._treeEventEmitter)
      } else {
        // new one
        let ecu = char4U32LeToString(lc.ecu)
        let isMaxNrMsgsEcu = false // todo...

        let lcInfos = this.lifecycles.get(ecu)
        let ecuNode: EcuNode
        if (lcInfos === undefined) {
          lcInfos = []
          this.lifecycles.set(ecu, lcInfos)
          let lcDecorationTypes: [vscode.TextEditorDecorationType | undefined, vscode.TextEditorDecorationType | undefined] | undefined =
            undefined
          if (decorateEcu !== undefined && decorateEcu === ecu) {
            lcDecorationTypes = [this._decorationTypes.get('lifecycleEven')?.decType, this._decorationTypes.get('lifecycleOdd')?.decType]
          }
          ecuNode = {
            id: util.createUniqueId(),
            label: `ECU: ${ecu}`,
            swVersions: [],
            lcDecorationTypes,
            parent: this.lifecycleTreeNode,
            children: [],
            uri: this.uri,
            tooltip: undefined,
          }
          // get and or insert apidNode:
          let apidNode = this.apidsNodes.get(ecu)
          if (apidNode === undefined) {
            apidNode = new DynFilterNode(
              `APIDs (unknown) / CTIDs`,
              undefined,
              ecuNode,
              `symbol-misc`,
              {
                ecu: ecu,
                apid: null,
                ctid: null,
                payload: null,
                payloadRegex: null,
                not: null,
                mstp: null,
                logLevelMin: null,
                logLevelMax: null,
                lifecycles: null,
              },
              this,
            )
            this.apidsNodes.set(ecu, apidNode)
          }
          ecuNode.children.push(apidNode)
          this.lifecycleTreeNode.children.push(ecuNode)
          fireTreeNode = true
        } else {
          if (lcInfos[0]?.node === undefined) {
            log.warn(`adlt.processLifecycleUpdates got missing node! for ecu=${ecu}`, lcInfos[0])
          }
          ecuNode = lcInfos[0]!.node!.parent
        }

        lcInfo = new AdltLifecycleInfo(lc, this.uri, ecuNode, this.lifecycleTreeNode)
        this.lifecyclesByPersistentId.set(lc.id, lcInfo)
        lcInfos?.push(lcInfo)
        if (!fireTreeNode) {
          this._treeEventEmitter.fire(ecuNode)
        }
      }
    }
    if (fireTreeNode) {
      this._treeEventEmitter.fire(this.lifecycleTreeNode)
    }
  }

  lifecycleInfoForPersistentId(persistentId: number): DltLifecycleInfoMinIF | undefined {
    return this.lifecyclesByPersistentId.get(persistentId)
  }

  /**
   *
   * @param context ExtensionContext (needed for report generation -> access to settings,...)
   * @param cmd get|patch|delete
   * @param paths docs/<id>/filters[...]
   * @param options e.g. here we do allow the following commands:
   *  - enableAll|disableAll=pos|neg|view(pos&neg)|marker|all
   *  - patch={id:{..attributes to match the ones to patch...}, attributes: {...attrs to change with new value...}}
   *  - add={attributes:{... new attrs...}}
   *  - delete={id:...}
   *  - deleteAllWith={attributes: {... if all attrs match, the filter will be deleted...}}
   *  - query=[... array of filter attributes {} ] returns the msgs matching! Does not modify any filters.
   *  The commands are executed in sequence.
   * @param doc DltDocument identified by <id>
   * @param retObj output: key errors or data has to be filled
   */
  async restQueryDocsFilters(
    context: vscode.ExtensionContext,
    cmd: string,
    paths: string[],
    options: string,
    retObj: { error?: object[]; data?: object[] | object },
  ) {
    const log = this.log
    if (paths.length === 3) {
      // .../filters

      let didModifyAnyFilter = false

      const optionArr = options ? options.split('&') : []
      for (const commandStr of optionArr) {
        const eqIdx = commandStr.indexOf('=')
        const command = commandStr.slice(0, eqIdx)
        const commandParams = decodeURIComponent(commandStr.slice(eqIdx + 1))
        // console.log(`restQueryDocsFilters: executing command = '${command}' with params='${commandParams}'`);

        switch (command) {
          case 'enableAll':
          case 'disableAll':
            {
              const enable = command === 'enableAll'
              let disablePos = false
              let disableNeg = false
              let disableMarker = false

              switch (commandParams) {
                case 'pos':
                  disablePos = true
                  break
                case 'neg':
                  disableNeg = true
                  break
                case 'view':
                  disablePos = true
                  disableNeg = true
                  break
                case 'marker':
                  disableMarker = true
                  break
                case 'all':
                  disablePos = true
                  disableNeg = true
                  disableMarker = true
                  break
                default:
                  log.warn(`restQueryDocsFilters ${command}=${commandParams} unknown!`)
                  break
              }

              this.allFilters.forEach((filter) => {
                if (!filter.atLoadTime) {
                  if (
                    (filter.type === DltFilterType.POSITIVE && disablePos) ||
                    (filter.type === DltFilterType.NEGATIVE && disableNeg) ||
                    (filter.type === DltFilterType.MARKER && disableMarker)
                  ) {
                    if (filter.enabled && !enable) {
                      filter.enabled = false
                      didModifyAnyFilter = true
                    }
                    if (!filter.enabled && enable) {
                      filter.enabled = true
                      didModifyAnyFilter = true
                    }
                  }
                }
              })
            }
            break
          case 'report':
            {
              try {
                const reportFilters = JSON5.parse(commandParams)
                // console.log(`report filters=`, reportFilters);
                if (Array.isArray(reportFilters) && reportFilters.length > 0) {
                  const filters: DltFilter[] = []
                  for (let i = 0; i < reportFilters.length; ++i) {
                    const filterAttribs = reportFilters[i]
                    const filter = new DltFilter(filterAttribs, false)
                    filters.push(filter)
                  }
                  // now open the report:
                  if (filters.length > 0) {
                    const newReport = this.onOpenReport(context, filters, true)
                  } else {
                    if (!Array.isArray(retObj.error)) {
                      retObj.error = []
                    }
                    retObj.error?.push({ title: `report failed as no filters defined` })
                  }
                } else {
                  if (!Array.isArray(retObj.error)) {
                    retObj.error = []
                  }
                  retObj.error?.push({ title: `report failed as commandParams wasn't an array` })
                }
              } catch (e) {
                if (!Array.isArray(retObj.error)) {
                  retObj.error = []
                }
                retObj.error?.push({ title: `report failed due to error e=${e}` })
              }
            }
            break
          case 'query':
            {
              try {
                const queryFilters = JSON5.parse(commandParams)
                // console.log(`filters=`, queryFilters);
                if (Array.isArray(queryFilters) && queryFilters.length > 0) {
                  let addLifecycles = false
                  let maxNrMsgs = 1000 // default to 1000 msgs to report as result
                  // todo bug not working to set maxNrMsgs to <1000!
                  const filters: DltFilter[] = []
                  for (let i = 0; i < queryFilters.length; ++i) {
                    const filterAttribs = queryFilters[i]
                    if ('maxNrMsgs' in filterAttribs) {
                      const fMaxNrMsgs = filterAttribs['maxNrMsgs']
                      if (fMaxNrMsgs === 0) {
                        maxNrMsgs = this.fileInfoNrMsgs
                      } else if (fMaxNrMsgs > maxNrMsgs) {
                        maxNrMsgs = fMaxNrMsgs
                      }
                      delete filterAttribs['maxNrMsgs']
                    }
                    if ('addLifecycles' in filterAttribs) {
                      addLifecycles = true
                    }
                    const filter = new DltFilter(filterAttribs, false)
                    filters.push(filter)
                  }
                  // now get the matching message:
                  if (filters.length > 0) {
                    const matches = await this.getMatchingMessages(filters, maxNrMsgs)
                    // console.log(`adlt.restQueryDocsFilters got matches.length=${matches.length}`);
                    //const matches: util.RestObject[] = [];
                    retObj.data = util.createRestArray(matches, (obj: object, i: number) => {
                      const msg = obj as FilterableDltMsg
                      return msg.asRestObject(i)
                    })
                    if (addLifecycles) {
                      // add lifecycle infos to the result:
                      this.lifecycles.forEach((lcInfo, ecu) => {
                        const lifecycles = [
                          ...lcInfo.map((lc, idx) => {
                            return {
                              type: 'lifecycles',
                              id: lc.persistentId,
                              attributes: {
                                index: idx + 1,
                                id: lc.persistentId, // todo to ease parsing with jsonPath...
                                ecu: ecu, // todo or without <SH>_ ?
                                label: lc.getTreeNodeLabel(),
                                startTimeUtc: lc.lifecycleStart.toUTCString(),
                                isResume: lc.isResume,
                                resumeTimeUtc: lc.isResume ? lc.lifecycleResume?.toUTCString() : undefined,
                                endTimeUtc: lc.lifecycleEnd.toUTCString(),
                                sws: lc.swVersions,
                                msgs: lc.nrMsgs,
                              },
                            }
                          }),
                        ]
                        if (Array.isArray(retObj.data)) {
                          retObj.data.unshift(...lifecycles)
                        }
                      })
                    }
                  } else {
                    if (!Array.isArray(retObj.error)) {
                      retObj.error = []
                    }
                    retObj.error?.push({ title: `query failed as no filters defined` })
                  }
                } else {
                  if (!Array.isArray(retObj.error)) {
                    retObj.error = []
                  }
                  retObj.error?.push({ title: `query failed as commandParams wasn't an array` })
                }
              } catch (e) {
                if (!Array.isArray(retObj.error)) {
                  retObj.error = []
                }
                retObj.error?.push({ title: `query failed due to error e=${e}` })
              }
            }
            break
          case 'sequences':
            {
              try {
                const sequences = JSON5.parse(commandParams)
                if (Array.isArray(sequences) && sequences.length > 0) {
                  log.info(`restQueryDocsFilters.sequences #=${sequences.length}`)
                  // process the sequences and return for each sequence the summary (nr of err, warn, undefined, ok)
                  const sumArr: util.RestObject[] = []
                  retObj.data = sumArr
                  for (const jsonSeq of sequences) {
                    const seqResult: FbSequenceResult = {
                      sequence: jsonSeq,
                      occurrences: [],
                      logs: [],
                    }
                    const seqChecker = new SeqChecker(jsonSeq, seqResult, DltFilter)
                    const allFilters = seqChecker.getAllFilters()
                    if (allFilters.length === 0) {
                      seqResult.logs.push(`no filters found for sequence '${seqChecker.name}'`)
                    } else {
                      const dltFilters = allFilters.map((f) => new DltFilter({ type: 3, ...f }, false))
                      const maxNrMsgs = 1_000_000
                      const matches = (await this.getMatchingMessages(dltFilters, maxNrMsgs)) as ViewableDltMsg[]
                      if (matches.length > 0) {
                        log.info(
                          `restQueryDocsFilters.sequences got ${matches.length} matches for sequence '${
                            seqChecker.name
                          }'msg#0 = ${util.safeStableStringify(Object.keys(matches[0]))}`,
                        )
                      }
                      seqChecker.processMsgs(matches)
                    }

                    const summary = Array.from(
                      seqResult.occurrences
                        .reduce(
                          (acc, cur) => {
                            const curVal = acc.get(cur.result)
                            return curVal ? acc.set(cur.result, curVal + 1) : acc.set(cur.result, 1), acc
                          },
                          new Map<string, number>([
                            ['error', 0],
                            ['warning', 0],
                            ['undefined', 0],
                            ['ok', 0],
                          ]),
                        )
                        .entries(),
                    )
                      .filter((entry) => entry[1] > 0)
                      .map((entry) => `${resAsEmoji(entry[0])}: ${entry[1]}`)
                      .join(', ')

                    // update tree view event/sequences/<name> with the summary
                    // do we have a event/sequences node yet?
                    let seqNode = this.eventsTreeNode.children.find((n) => n.label === 'Sequences')
                    if (seqNode === undefined) {
                      seqNode = createTreeNode('Sequences', this.uri, this.eventsTreeNode, 'checklist')
                      this.eventsTreeNode.children.push(seqNode)
                      this._treeEventEmitter.fire(this.eventsTreeNode)
                    }
                    let thisSequenceNode = seqNode.children.find((n) => n.label === seqChecker.name)
                    if (thisSequenceNode === undefined) {
                      thisSequenceNode = createTreeNode(seqChecker.name, this.uri, seqNode, undefined)
                      seqNode.children.push(thisSequenceNode)
                      this._treeEventEmitter.fire(seqNode)
                      thisSequenceNode.privData = {}
                    }
                    // get the full md from the sequence result:
                    try {
                      const resAsMd = seqResultToMdAst(seqResult)
                      const resAsMarkdown = toMarkdown(
                        { type: 'root', children: resAsMd },
                        { extensions: [gfmTableToMarkdown({ tablePipeAlign: false })] },
                      )
                      thisSequenceNode.contextValue = 'canCopyToClipboard canTreeItemToDocument'
                      if (seqResult.occurrences.length > 0) {
                        thisSequenceNode.contextValue += ' canTreeItemGenReport'
                      }

                      thisSequenceNode.privData.seqResult = seqResult
                      const docThis = this
                      // if we have an active eventReport, we have to update it
                      if (thisSequenceNode.privData?.eventReport) {
                        thisSequenceNode.privData.eventReport.update(reportEventsFromSeq(seqResult))
                        thisSequenceNode.privData.report?.updateReport()
                      }

                      thisSequenceNode.applyCommand = (command) => {
                        switch (command) {
                          case 'copyToClipboard':
                            vscode.env.clipboard.writeText(resAsMarkdown) // todo could generate only here on a need basis from privData = seqResult
                            vscode.window.showInformationMessage(`Exported sequence ${thisSequenceNode.label} to clipboard as markup text`)
                            break
                          case 'treeItemToDocument':
                            vscode.workspace.openTextDocument({ content: resAsMarkdown, language: 'markdown' }).then((doc) => {
                              vscode.window.showTextDocument(doc).then((editor) => {
                                // id taken from here: https://github.com/microsoft/vscode/blob/6d6cfdc3a6a1836a29a7034d88958c0b91df5def/extensions/markdown-language-features/src/preview/preview.ts#L459
                                vscode.commands
                                  .executeCommand('vscode.openWith', doc.uri, 'vscode.markdown.preview.editor', editor.viewColumn)
                                  .then((success) => {
                                    if (!success) {
                                      vscode.window.showInformationMessage(
                                        `Failed to open markdown preview for sequence ${thisSequenceNode.label}`,
                                      )
                                    }
                                  })
                              })
                            })
                            break
                          case 'treeItemGenReport':
                            if (thisSequenceNode.privData?.seqResult) {
                              const seqResult = thisSequenceNode.privData.seqResult as FbSequenceResult
                              const events = reportEventsFromSeq(seqResult)
                              if (thisSequenceNode.privData?.eventReport) {
                                thisSequenceNode.privData?.eventReport.update(events)
                                thisSequenceNode.privData?.report?.updateReport() // TODO shall we support more than 1?
                              } else {
                                const newReport = new EventReport(log, thisSequenceNode.label, events, (_r) => {
                                  log.info(`treeItemGenReport EventReport onDispose...`)
                                  delete thisSequenceNode.privData.eventReport
                                  delete thisSequenceNode.privData.report
                                })
                                let report = docThis.getLastActiveReport() || docThis.getNewReport(context)
                                report.addReport(newReport)
                                report.updateReport()
                                thisSequenceNode.privData.eventReport = newReport
                                thisSequenceNode.privData.report = report
                              }
                            }
                            break
                        }
                      }
                    } catch (e) {
                      log.warn(`restQueryDocsFilters failed toMarkdown due to: ${e}`)
                    }
                    thisSequenceNode.description = summary

                    // fill children with the occurrences:
                    thisSequenceNode.children.length = 0
                    // todo skip long rows of "ok"

                    // todo limit to 1000 occurrences and add a '... skipped ...' node if more
                    seqResult.occurrences.slice(0, 1000).forEach((occ, idx) => {
                      if (idx < 1000) {
                        thisSequenceNode.children.push(this.createOccNode(thisSequenceNode, occ, idx))
                      }
                    })

                    this._treeEventEmitter.fire(thisSequenceNode)

                    sumArr.push({
                      type: 'seqSummary',
                      id: thisSequenceNode.id,
                      attributes: {
                        name: jsonSeq.name,
                        summary,
                        logs: seqResult.logs,
                      },
                    })
                  }
                } else {
                  if (!Array.isArray(retObj.error)) {
                    retObj.error = []
                  }
                  retObj.error?.push({ title: `query failed as commandParams wasn't an array` })
                }
              } catch (e) {
                if (!Array.isArray(retObj.error)) {
                  retObj.error = []
                }
                retObj.error?.push({ title: `query failed due to error e=${e}` })
              }
            }
            break
          case 'add':
            {
              // todo add support for persistent storage!
              try {
                const filterAttribs = JSON5.parse(commandParams)
                // console.log(`filterAttribs=`, filterAttribs);

                const filter = new DltFilter(filterAttribs, false) // don't allow edit for now as we keep them temp.
                this.onFilterAdd(filter, false)
                didModifyAnyFilter = true
              } catch (e) {
                // todo set error!
                if (!Array.isArray(retObj.error)) {
                  retObj.error = []
                }
                retObj.error?.push({ title: `add failed due to error e=${e}` })
              }
            }
            break
          case 'delete':
            {
              try {
                const filterAttribs = JSON5.parse(commandParams)
                // console.log(`filterAttribs=`, filterAttribs);

                if (Object.keys(filterAttribs).length > 0) {
                  // all filters that match all criteria will be deleted:
                  const filtersToDelete: DltFilter[] = []
                  this.allFilters.forEach((filter) => {
                    let allMatch = true
                    const filterParams = filter.configOptions !== undefined ? filter.configOptions : filter
                    Object.keys(filterAttribs).forEach((key) => {
                      // does the keys exist in filterParams?
                      if (!(key in filterParams && filterParams[key] === filterAttribs[key])) {
                        allMatch = false // could break here... but not possible...
                      }
                    })
                    if (allMatch) {
                      log.info(`restQueryDocsFilters ${command}=${commandParams} delete filter ${filter.name}`)
                      filtersToDelete.push(filter)
                    }
                  })
                  filtersToDelete.forEach((filter) => {
                    this.onFilterDelete(filter, false)
                    didModifyAnyFilter = true
                  })
                } else {
                  if (!Array.isArray(retObj.error)) {
                    retObj.error = []
                  }
                  retObj.error?.push({ title: `delete failed as no keys provided!` })
                }
              } catch (e) {
                if (!Array.isArray(retObj.error)) {
                  retObj.error = []
                }
                retObj.error?.push({ title: `add failed due to error e=${e}` })
              }
            }
            break
          case 'patch':
            {
              try {
                const patchAttribs = JSON5.parse(commandParams)
                const filterAttribs = patchAttribs.id
                const newAttribs = patchAttribs.attributes
                //console.log(`patch filterAttribs=`, filterAttribs);
                // console.log(`patch newAttribs=`, newAttribs);

                if (Object.keys(filterAttribs).length > 0 && Object.keys(newAttribs).length > 0) {
                  // all filters that match all criteria will be deleted:
                  const filtersToDelete: DltFilter[] = []
                  this.allFilters.forEach((filter) => {
                    let allMatch = true
                    const filterParams = filter.configOptions !== undefined ? filter.configOptions : filter
                    Object.keys(filterAttribs).forEach((key) => {
                      // does the keys exist in filterParams?
                      if (!(key in filterParams && filterParams[key] === filterAttribs[key])) {
                        allMatch = false // could break here... but not possible...
                      }
                    })
                    if (allMatch) {
                      log.info(`restQueryDocsFilters ${command}=${commandParams} updating filter ${filter.name}`)
                      Object.keys(newAttribs).forEach((key) => {
                        log.info(`restQueryDocsFilters updating '${key}' from '${filter.configOptions[key]}' to '${newAttribs[key]}'`)
                        filter.configOptions[key] = newAttribs[key]
                      })
                      filter.reInitFromConfiguration()
                      didModifyAnyFilter = true
                    }
                  })
                } else {
                  if (!Array.isArray(retObj.error)) {
                    retObj.error = []
                  }
                  retObj.error?.push({ title: `patch failed as no keys provided!` })
                }
              } catch (e) {
                if (!Array.isArray(retObj.error)) {
                  retObj.error = []
                }
                retObj.error?.push({ title: `patch failed due to error e=${e}` })
              }
            }
            break
          default:
            log.warn(`restQueryDocsFilters: unknown command = '${command}' with params='${commandParams}'`)
        }
      }
      if (didModifyAnyFilter) {
        this.triggerApplyFilter(true)
      }
      if (!('data' in retObj)) {
        // we add the filters only if no other data existing yet (e.g. from query)
        retObj.data = util.createRestArray(this.allFilters, (obj: object, i: number) => {
          const filter = obj as DltFilter
          return filter.asRestObject(i)
        })
      }
    } else {
      // .../filters/...
      retObj.error = [{ title: `${cmd}/${paths[0]}/${paths[1]}/${paths[2]}/${paths[3]} not yet implemented.` }]
    }
  }

  // #region sequence support:
  static resAsCodicon(res: string): string | undefined {
    if (res.startsWith('ok')) {
      return 'check'
    } else if (res.startsWith('warn')) {
      return 'warning'
    } else if (res.startsWith('error')) {
      return 'error'
    }
    return undefined
  }

  createSubStepNode(parentNode: TreeViewNode, stepPrefix: string, subStepName: string, stepResults: FbStepRes[]): TreeViewNode {
    let stepNode: TreeViewNode
    if (stepResults && stepResults.length > 0) {
      const events = stepResults.map((e) => startEventForStepRes(e)).filter((e) => e !== undefined)
      const firstEvent = events.length > 0 ? events[0] : undefined
      const msgIndex = firstEvent ? AdltDocument.getMsgIndexForStepRes(firstEvent) : undefined

      const stepLabel =
        stepResults.length === 1
          ? resAsEmoji(summaryForStepRes(stepResults[0])) || (firstEvent ? firstEvent.title : '')
          : `${stepResults.length}*: ${stepResults
              .map((e) => resAsEmoji(summaryForStepRes(e)) || (e.stepType === 'filter' ? e.res.title : ''))
              .join('')}`
      stepNode = createTreeNode(
        `${stepPrefix} '${subStepName}': ${stepLabel}`,
        this.uri.with({
          fragment: msgIndex ? `msgIndex:${msgIndex}` : firstEvent && firstEvent.timeInMs ? firstEvent.timeInMs.toString() : '',
        }),
        parentNode,
        undefined, // todo icon for step result (summary)
      )
      stepNode.tooltip = firstEvent ? firstEvent.msgText || firstEvent.title || '' : ''
      // already part of label subStepNode.description = stepResults.map((e) => resAsEmoji(summaryForStepRes(e))).join('')
      // add childs for each occurrence that reflects a sequence or par:
      stepResults.forEach((stepRes, occIdx) => {
        if (occIdx < 1000) {
          if (stepRes.stepType === 'sequence') {
            stepNode.children.push(this.createOccNode(stepNode, stepRes.res, occIdx))
          } else if (stepRes.stepType === 'par') {
            for (const [idx, parStepResults] of stepRes.res.entries()) {
              stepNode.children.push(
                this.createSubStepNode(
                  stepNode,
                  `par. step #${idx + 1}`,
                  stepRes.step.par?.[idx]?.name || stepRes.step.name || '',
                  parStepResults,
                ),
              )
            }
          }
        }
      })
    } else {
      // no results/occurrences for this subStep:
      stepNode = createTreeNode(`${stepPrefix} '${subStepName}': no occ.`, this.uri, parentNode, undefined)
      stepNode.description = 'no occurrences'
    }

    return stepNode
  }

  /**
   * create a tree node for the occurrence of a sequence and add the steps as children
   * @param parentNode
   * @param sequence - sequence data
   * @param occ - occurrence data
   * @param idx - idx of the occurrence (0-based)
   * @returns the created node
   *
   * Calls itself recursively for each step that is a sub-sequence.
   */
  createOccNode(parentNode: TreeViewNode, occ: FbSeqOccurrence, idx: number): TreeViewNode {
    const msgIndex = occ.startEvent.msgText?.match(/^#(\d+) /)
    const occNode = createTreeNode(
      `occ. #${idx + 1}:${occ.result} ${occ.stepsResult.filter((sr) => sr.length > 0).length} steps`,
      this.uri.with({
        fragment: msgIndex ? `msgIndex:${msgIndex[1]}` : occ.startEvent.timeInMs ? occ.startEvent.timeInMs.toString() : '',
      }), // todo change to proper msg index! from startEvent...
      parentNode,
      AdltDocument.resAsCodicon(occ.result),
    )
    // summary of each step as description for the occurrence node:
    occNode.description = occ.stepsResult
      .map((step) => {
        if (step.length === 0) {
          return ''
        }
        return step.map((e) => resAsEmoji(summaryForStepRes(e))).join('')
      })
      .join(',')
    let tooltipText = ''
    if (occ.context.length > 0) {
      tooltipText = occ.context.map(([key, value]) => `${key}: ${value}`).join('\n')
    }
    if (occ.kpis.length > 0) {
      if (tooltipText.length > 0) {
        tooltipText += '\n'
      }
      tooltipText += `KPIs:\n` + occ.kpis.map((kpi) => `${kpi.name}: ${kpi.values.join(', ')}`).join('\n')
    }
    if (tooltipText.length > 0) {
      occNode.tooltip = tooltipText
    }
    // add step details as children:
    // occ.stepsResult: StepResult[] <- step result for each step
    // type StepResult = FbStepRes[] <- results for each occurrence of this step
    // type FbStepRes = FbFilterStepRes | FbAltStepRes | FbSeqStepRes

    occ.stepsResult.forEach((stepResult, stepIdx) => {
      if (stepResult.length > 0) {
        occNode.children.push(this.createSubStepNode(occNode, `step #${stepIdx + 1}`, nameFromStep(stepResult[0].step, ''), stepResult))
      }
    })
    return occNode
  }

  static getMsgIndexForStepRes(event: FbEvent): number | undefined {
    let msgIndex: RegExpMatchArray | null | undefined = undefined
    msgIndex = event?.msgText?.match(/^#(\d+) /)
    return msgIndex ? Number(msgIndex[1]) : undefined
  }

  /**
   * calculate and return the matching messages. Does not modify the current content/view.
   * @param filters list of filters to use. Should only be pos and neg filters. Others will be ignored.
   * @param maxMsgsToReturn maximum number of messages to return. As this is no async function the caller
   * needs to be careful!
   * @returns list of matching messages (as Promise)
   */
  getMatchingMessages(filters: DltFilter[], maxMsgsToReturn: number): Promise<FilterableDltMsg[]> {
    const log = this.log
    let p = new Promise<FilterableDltMsg[]>((resolve, reject) => {
      const matchingMsgs: AdltMsg[] = []
      // sort the filters here into the enabled pos and neg:
      try {
        let filterStr = filters
          .filter((f) => f.enabled)
          .map((f) => JSON.stringify({ ...f.asConfiguration(), enabled: true }))
          .join(',')
        this.sendAndRecvAdltMsg(`query {"window":[0,${maxMsgsToReturn}], "filters":[${filterStr}]}`)
          .then((response) => {
            // console.log(`adlt.getMatchingMessages startQuery got response:'${response}'`);
            const streamObj = JSON.parse(response.substring(10))
            // console.log(`adtl.getMatchingMessages streamObj`, JSON.stringify(streamObj));

            let sink: NewMessageSink = {
              onDone() {
                log.trace(`adlt.getMatchingMessages done matchingMsgs.length=${matchingMsgs.length}`)
                resolve(matchingMsgs)
              },
            }
            // here some data might be already there for that stream.
            // this can happen even though the wss data arrives sequentially but the processing
            // here for wss data is a direct call vs. an asyn .then()...
            let curStreamMsgData = this.streamMsgs.get(streamObj.id)
            let streamData = { msgs: matchingMsgs, sink: sink }
            this.streamMsgs.set(streamObj.id, streamData)
            if (curStreamMsgData && Array.isArray(curStreamMsgData)) {
              // process the data now:
              curStreamMsgData.forEach((msgs) => this.processBinStreamMsgs(msgs, streamData))
            }
          })
          .catch((reason) => {
            reject(reason)
          })
      } catch (e) {
        throw new Error(`getMatchingMessages failed due to error '${e}'`)
        reject(e)
      }
    })
    return p
  }

  /**
   * start a stream of messages for a provided set of filters
   * @param filters - filters to apply
   * @param initialWindow - initial window. usually 0- e.g.1000
   * @param streamData contains the msgs and the sink with the `onNewMessages` and `onDone` callback
   * @returns the streamId. Must be used in a call to
   *
   * ```stopMsgsStream(streamId)```
   *
   * to stop the stream!
   * Must be handed over to changeMsgsStreamWindow to change the window. Afterwards the newly returned streamId must be used!
   */
  startMsgsStream(filters: DltFilter[], initialWindow: [number, number], streamData: StreamMsgData): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      try {
        let filterStr = filters
          .filter((f) => f.enabled)
          .map((f) => JSON.stringify({ ...f.asConfiguration(), enabled: true }))
          .join(',')
        this.sendAndRecvAdltMsg(`stream {"window":[${initialWindow[0]},${initialWindow[1]}],"binary":true,"filters": [${filterStr}]}`)
          .then((response) => {
            // console.log(`adlt.streamMessages start stream got response:'${response}'`);
            const streamObj = JSON.parse(response.substring(11)) // todo parse any better!
            // console.log(`adtl.streamMessages streamObj`, JSON.stringify(streamObj));
            let curStreamMsgData = this.streamMsgs.get(streamObj.id)
            this.streamMsgs.set(streamObj.id, streamData)
            // this.log.warn(`AdltDocument.startMsgsStream(streamId=${streamObj.id})...`)
            if (curStreamMsgData && Array.isArray(curStreamMsgData)) {
              // process the data now:
              curStreamMsgData.forEach((msgs) => this.processBinStreamMsgs(msgs, streamData))
            }
            resolve(streamObj.id)
          })
          .catch((reason) => reject(reason))
      } catch (e) {
        reject(e)
      }
    })
  }

  stopMsgsStream(streamId: number): Promise<string> {
    // this.log.warn(`AdltDocument.stopMsgsStream(streamId=${streamId})...`)
    this.streamMsgs.delete(streamId)
    return this.sendAndRecvAdltMsg(`stop ${streamId}`)
  }

  changeMsgsStreamWindow(streamId: number, newWindow: [number, number]): Promise<number> {
    const log = this.log
    return new Promise<number>((resolve, reject) => {
      let streamData = this.streamMsgs.get(streamId)
      if (!streamData) {
        reject('invalid streamId? no streamData found')
      } else {
        this.sendAndRecvAdltMsg(`stream_change_window ${streamId} ${newWindow[0]},${newWindow[1]}`)
          .then((response) => {
            const streamObj = JSON.parse(response.slice(response.indexOf('=') + 1))
            log.trace(`adlt.changeMsgsStreamWindow on stream_change_window streamObj: ${JSON.stringify(streamObj)}`)
            let curStreamMsgData = this.streamMsgs.get(streamObj.id)
            this.streamMsgs.set(streamObj.id, streamData!)
            this.streamMsgs.delete(streamId)
            if (curStreamMsgData && Array.isArray(curStreamMsgData)) {
              curStreamMsgData.forEach((msgs) => this.processBinStreamMsgs(msgs, streamData as StreamMsgData))
            }
            resolve(streamObj.id)
          })
          .catch((e) => reject(e))
      }
    })
  }

  searchStream(
    streamId: number,
    filters: DltFilter[],
    startIdx: number,
    maxMsgsToReturn: number,
  ): Promise<{ search_idxs: number[]; next_search_idx?: number }> {
    let p = new Promise<{ search_idxs: number[]; next_search_idx?: number }>((resolve, reject) => {
      const log = this.log
      let streamData = this.streamMsgs.get(streamId)
      if (!streamData) {
        reject('invalid streamId? no streamData found')
      } else {
        this.sendAndRecvAdltMsg(
          `stream_search ${streamId} ${JSON.stringify({
            start_idx: startIdx,
            max_results: maxMsgsToReturn,
            filters: filters
              .filter((f) => f.enabled)
              .map((f) => {
                return { ...f.asConfiguration(), enabled: true }
              }),
          })}`,
        )
          .then((response) => {
            const searchRes = JSON.parse(response.slice(response.indexOf('=') + 1))
            log.trace(
              `adlt.searchStream on stream_search returned: next_search_idx=${searchRes.next_search_idx} #search_idxs=${
                Array.isArray(searchRes.search_idxs) ? searchRes.search_idxs.length : 0
              }`,
            )
            resolve(searchRes)
          })
          .catch((e) => reject(e))
      }
    })
    return p
  }

  stat(): vscode.FileStat {
    //console.warn(`AdltDocument.stat()...(text.length=${this.text.length}, mtime=${this._mtime})`)

    return {
      size: this.text.length,
      ctime: this._ctime,
      mtime: this._mtime,
      type: vscode.FileType.File,
    }
  }

  public text: String
}

export class ADltDocumentProvider implements vscode.FileSystemProvider, /*vscode.DocumentSymbolProvider,*/ vscode.Disposable {
  public _documents = new Map<string, AdltDocument>()
  private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>()
  private _subscriptions: Array<vscode.Disposable> = new Array<vscode.Disposable>()
  private _adltPort: number = 0
  private _adltProcess?: ChildProcess
  private _adltCommand: string
  private globalState: vscode.Memento
  private commentController: vscode.CommentController

  constructor(
    private log: vscode.LogOutputChannel,
    context: vscode.ExtensionContext,
    private _dltLifecycleTreeView: vscode.TreeView<TreeViewNode>,
    private _treeRootNodes: TreeViewNode[],
    private _onDidChangeTreeData: vscode.EventEmitter<TreeViewNode | null>,
    private checkActiveRestQueryDocChanged: () => boolean,
    private _onDidChangeStatus: vscode.EventEmitter<vscode.Uri | undefined>,
    private _columns: ColumnConfig[],
    private _reporter?: TelemetryReporter,
  ) {
    // console.log(`dlt-logs.AdltDocumentProvider()...`);
    if (!semver.validRange(MIN_ADLT_VERSION_SEMVER_RANGE)) {
      throw Error(`MIN_ADLT_VERSION_SEMVER_RANGE is not valied!`)
    }
    this.globalState = context.globalState
    this.commentController = vscode.comments.createCommentController('dlt-logs', 'dlt-logs')

    log.trace('adlt.ADltDocumentProvider adltPath=', adltPath)
    this._adltCommand =
      vscode.workspace.getConfiguration().get<string>('dlt-logs.adltPath') ||
      (adltPath !== undefined && typeof adltPath === 'string' ? adltPath : 'adlt')
    log.info(`adlt.ADltDocumentProvider using adltCommand='${this._adltCommand}'`)

    if (adltPath !== undefined) {
      // add it to env
      let envCol = context.environmentVariableCollection
      const adltPathPath = path.dirname(adltPath)
      log.info(`adlt updating env PATH with :'${adltPathPath}'`)
      context.environmentVariableCollection.prepend('PATH', adltPathPath + path.delimiter)
    }

    // config changes
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('dlt-logs')) {
          // handle it for the next doc to be opened. Active connection will be interrupted (if non debug port)
          if (e.affectsConfiguration('dlt-logs.adltPath')) {
            const newCmd =
              vscode.workspace.getConfiguration().get<string>('dlt-logs.adltPath') ||
              (adltPath !== undefined && typeof adltPath === 'string' ? adltPath : 'adlt')
            if (newCmd !== this._adltCommand) {
              log.info(`adlt.ADltDocumentProvider using adltCommand='${this._adltCommand}'`)
              this._adltCommand = newCmd
              this.closeAdltProcess()
            }
          }

          this._documents.forEach((doc) => doc.onDidChangeConfiguration(e))
        }
      }),
    )

    this._subscriptions.push(
      vscode.workspace.onDidOpenTextDocument((event: vscode.TextDocument) => {
        const uriStr = event.uri.toString()
        //console.log(`AdltDocumentProvider onDidOpenTextDocument uri=${uriStr}`);
        // is it one of our documents?
        const doc = this._documents.get(uriStr)
        if (doc) {
          const newlyOpened: boolean = doc.textDocument ? false : true
          log.debug(` Adlt.onDidOpenTextDocument: found document with uri=${uriStr} newlyOpened=${newlyOpened}`)
          if (newlyOpened) {
            doc.textDocument = event
            this._onDidChangeTreeData.fire(null)
          }
        }
      }),
    )

    // announce time updates on selection of lines:
    // counterpart to handleDidChangeSelectedTime...
    this._subscriptions.push(
      vscode.window.onDidChangeTextEditorSelection(
        util.throttle((ev) => {
          let data = this._documents.get(ev.textEditor.document.uri.toString())
          if (data) {
            // ev.kind: 1: Keyboard, 2: Mouse, 3: Command
            // we do only take single selections.
            if (ev.selections.length === 1) {
              if (ev.selections[0].isSingleLine) {
                const line = ev.selections[0].active.line // 0-based
                // determine time:
                const time = data.provideTimeByLine(line)
                if (time) {
                  /*if (this._autoTimeSync) {
                                // post time update...
                                console.log(` dlt-log posting time update ${time.toLocaleTimeString()}.${String(time.valueOf() % 1000).padStart(3, "0")}`);
                                this._onDidChangeSelectedTime.fire({ time: time, uri: data.uri });
                            } todo */
                  // notify document itself (to e.g. forward to open reports)
                  data.onDidChangeSelectedTime(time)
                }
              }
            } else if (ev.selections.length > 1) {
              // console.warn(`DltDocumentProvider.onDidChangeTextEditorSelection have ${ev.selections.length} selections`);
              // we add all selections:
              const times: Date[] = []
              for (let i = 0; i < ev.selections.length; ++i) {
                const selection = ev.selections[i]
                if (selection.isSingleLine) {
                  const line = selection.active.line
                  const time = data.provideTimeByLine(line)
                  if (time) {
                    times.push(time)
                  }
                }
              }
              if (times.length > 0) {
                // notify document itself (to e.g. forward to open reports)
                data.onDidChangeSelectedTime(times)
              }
            }
          }
        }, 500),
      ),
    )

    context.subscriptions.push(vscode.languages.registerHoverProvider({ scheme: 'adlt-log' }, this))

    this.commentController.options = {
      placeHolder: 'Comment on selected log:', // shown inside if not comment is typed yet
      prompt: 'Comment prompt',
    }
    this.commentController.commentingRangeProvider = {
      provideCommentingRanges: (document: vscode.TextDocument, token: vscode.CancellationToken) => {
        const data = this._documents.get(document.uri.toString())
        if (data) {
          // log.info(`AdltDocumentProvider provideCommentingRanges called for ${document.uri.toString()}`)
          const lineCount = document.lineCount
          if (lineCount > 1) {
            // last line is empty (not assigned to a msg)
            return [new vscode.Range(0, 0, lineCount - 2, 0)]
          }
        }
        return []
      },
    }
    this.commentController.reactionHandler = async (comment, reaction) => {
      log.warn(`AdltDocumentProvider reactionHandler called for ${comment} reaction=${reaction}`)
    }
    context.subscriptions.push(this.commentController)

    context.subscriptions.push(
      vscode.commands.registerCommand('dlt-logs.commentEdit', (comment: AdltComment) => {
        if (!comment.parent) {
          return
        }
        comment.parent.editComment(comment)
      }),
    )
    context.subscriptions.push(
      vscode.commands.registerCommand('dlt-logs.commentCancelEdit', (comment: AdltComment) => {
        if (!comment.parent) {
          return
        }
        return comment.parent.cancelEditComment(comment)
      }),
    )
    context.subscriptions.push(
      vscode.commands.registerCommand('dlt-logs.commentSave', (comment: AdltComment) => {
        if (!comment.parent) {
          return
        }
        const document = this._documents.get(comment.parent.thread.uri.toString())
        if (document) {
          document.commentUpdated(comment)
        }
      }),
    )
    context.subscriptions.push(
      vscode.commands.registerCommand('dlt-logs.commentCreate', (reply: vscode.CommentReply) => {
        const document = this._documents.get(reply.thread.uri.toString())
        if (document) {
          document.commentsCreate(reply)
        } else {
          log.warn(`AdltDocumentProvider commentCreate called but no document for reply`, reply)
        }
      }),
    )
    context.subscriptions.push(
      vscode.commands.registerCommand('dlt-logs.commentThreadDelete', (thread: vscode.CommentThread) => {
        const document = this._documents.get(thread.uri.toString())
        if (document) {
          // ask for confirmation
          vscode.window
            .showWarningMessage(
              'Do you want to delete this comment thread?',
              { modal: true, detail: 'This cannot be undone!' },
              { isCloseAffordance: true, title: 'Cancel' },
              { title: 'Delete' },
            )
            .then((value) => {
              if (value?.title === 'Delete') {
                document.commentsDelete(thread)
              }
            })
        } else {
          log.warn(`AdltDocumentProvider commentThreadDelete called but no document for thread`, thread)
          thread.dispose()
        }
      }),
    )
    context.subscriptions.push(
      vscode.commands.registerCommand('dlt-logs.commentThreadExport', (thread: vscode.CommentThread) => {
        const document = this._documents.get(thread.uri.toString())
        if (document) {
          document.commentsExport(thread)
        } else {
          log.warn(`AdltDocumentProvider commentThreadExport called but no document for thread`, thread)
        }
      }),
    )
    context.subscriptions.push(
      vscode.commands.registerCommand('dlt-logs.commentThreadExportAll', (thread: vscode.CommentThread) => {
        const document = this._documents.get(thread.uri.toString())
        if (document) {
          document.commentsExport(undefined)
        } else {
          log.warn(`AdltDocumentProvider commentThreadExportAll called but no document for thread`, thread)
        }
      }),
    )
    context.subscriptions.push(
      vscode.commands.registerCommand('dlt-logs.commentThreadExportMulti', (thread: vscode.CommentThread) => {
        const document = this._documents.get(thread.uri.toString())
        if (document) {
          document.commentsExportMulti(thread)
        } else {
          log.warn(`AdltDocumentProvider commentThreadExportMulti called but no document for thread`, thread)
        }
      }),
    )

    /* this.timerId = setInterval(() => {
            // dump mem usage:
            const memUsage = process.memoryUsage();
            console.log(`memUsage=${JSON.stringify(memUsage)} adlt #docs=${this._documents.size}`);
        }, 10000);*/
  }
  // private timerId: NodeJS.Timeout;

  dispose() {
    this.log.trace('AdltDocumentProvider dispose() called')
    this._documents.forEach((doc) => doc.dispose())
    this._documents.clear()
    // clearInterval(this.timerId);

    this.closeAdltProcess()

    this._subscriptions.forEach((value) => {
      if (value !== undefined) {
        value.dispose()
      }
    })
  }

  public provideHover(doc: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.Hover> {
    const data = this._documents.get(doc.uri.toString())
    if (!data) {
      return
    }
    return data.provideHover(position)
  }

  private async modifyNode(node: TreeViewNode, command: string) {
    const treeviewNode = node
    const parentUri = treeviewNode.parent?.uri // why from parent?
    if (parentUri) {
      const doc = this._documents.get(parentUri.toString())
      if (doc) {
        this.log.trace(`${command} Filter(${treeviewNode.label}) called for adlt doc=${parentUri}`)
        let doApplyFilter = false
        if (node.applyCommand) {
          node.applyCommand(command)
          doApplyFilter = true
        }
        if (doApplyFilter) {
          doc.triggerApplyFilter()
          this._onDidChangeTreeData.fire(doc.treeNode) // as filters in config might be impacted as well!
        }
      }
    }
  }

  public onTreeNodeCommand(command: string, node: TreeViewNode) {
    switch (command) {
      case 'enableFilter':
        this.modifyNode(node, 'enable')
        break
      case 'disableFilter':
        this.modifyNode(node, 'disable')
        break
      case 'zoomOut':
        this.modifyNode(node, 'zoomOut')
        break
      case 'zoomIn':
        this.modifyNode(node, 'zoomIn')
        break
      case 'setPosFilter':
        this.modifyNode(node, 'setPosFilter')
        break
      case 'copyToClipboard':
      case 'treeItemToDocument':
      case 'treeItemGenReport':
      case 'save':
        if (node.uri !== null && this._documents.get(node.uri.toString()) !== undefined && node.applyCommand) {
          node.applyCommand(command)
        }
        break
      // todo refactor to always call applyCommand... currently dltDocumentProvider handles it as well!
      default:
        this.log.error(`adlt.onTreeNodeCommand unknown command '${command}' for node '${node.label}' '${node.uri}'`)
        break
    }
  }

  private onDropFilterFrags(node: TreeViewNode | undefined, filterFrags: any[]) {
    if (node !== undefined && node.uri) {
      const doc = this._documents.get(node.uri.toString())
      if (doc !== undefined) {
        const allFilters = doc.allFilters
        let doApplyFilter = false
        for (const filterFrag of filterFrags) {
          // do we have a similar filter already?
          const similarFilters = DltFilter.getSimilarFilters(false, true, filterFrag, allFilters)
          if (!similarFilters.length) {
            let filter = new DltFilter(filterFrag)
            this.log.info(`adlt.onDropFilterFrags got a filter: '${filter.name}'`)
            doc.onFilterAdd(filter, false)
            doApplyFilter = true
          } else {
            this.log.info(`adlt.onDropFilterFrags got similar filter: '${similarFilters.map((f) => f.name).join(',')}'`)
            if (!('enabled' in filterFrag) || ('enabled' in filterFrag && filterFrag.enabled === true)) {
              // any of the similarFilters enabled yet?
              if (similarFilters.filter((f) => f.enabled).length === 0) {
                // enable the first one:
                similarFilters[0].enabled = true
                doApplyFilter = true
                this.log.info(`adlt.onDropFilterFrags enabling similar filter: '${similarFilters[0].name}'`)
              }
            }
          }
        }
        if (doApplyFilter) {
          doc.triggerApplyFilter()
          this._onDidChangeTreeData.fire(doc.treeNode) // as filters in config might be impacted as well!
        }
      } else {
        this.log.warn(`adlt.onDropFilterFrags found no doc for: '${node.uri.toString()}'`)
      }
    }
  }

  public async onDrop(node: TreeViewNode | undefined, sources: vscode.DataTransfer, token: vscode.CancellationToken) {
    const log = this.log
    try {
      log.info(`adlt.onDrop (node=${node?.label})`)
      let transferItem = sources.get('text/uri-list')
      if (transferItem !== undefined) {
        transferItem.asString().then((urisString) => {
          try {
            let uris = urisString.split(/\r?\n/)
            log.trace(`adlt.onDrop got uris(${uris.length}): '${uris.join(',')}'`)
            let warnings: string[] = []
            let filterFrags: any[] = []
            for (const uri of uris) {
              if (uri.toLowerCase().endsWith('.dlf')) {
                // support for dlt-viewer .dlf files
                log.info(`adlt.onDrop processing uri '${uri}' as dlt-viewer .dlf filter file`)
                // open the file:
                let fileContent = fs.readFileSync(fileURLToPath(uri), { encoding: 'utf-8' })
                let filterFragsOrWarnings = DltFilter.filtersFromXmlDlf(fileContent)
                log.trace(`adlt.onDrop got ${filterFragsOrWarnings.length} filter frags`)
                for (const filterFrag of filterFragsOrWarnings) {
                  if (typeof filterFrag === 'string') {
                    log.warn(`adlt.onDrop filterFrag got warning: '${filterFrag}'`)
                    warnings.push(filterFrag)
                  } else {
                    filterFrags.push(filterFrag)
                  }
                }
              } else {
                const warning = `ignoring uri '${uri}'}`
                log.warn(`adlt.onDrop ${warning}`)
                warnings.push(warning)
              }
            }
            if (warnings.length) {
              vscode.window.showWarningMessage(`opening as dlt-viewer filter files got warnings:\n${warnings.join('\n')}`)
            }
            if (filterFrags.length) {
              this.onDropFilterFrags(node, filterFrags)
            }
          } catch (e) {
            log.warn(`adlt.onDrop(urisString='${urisString}') got e='${e}'`)
          }
        })
      }
    } catch (e) {
      log.warn(`adlt.onDrop got e='${e}'`)
    }
  }

  public onDrag(nodes: readonly TreeViewNode[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken) {
    this.log.info(`adlt.onDrag (nodes=${nodes.map((n) => n.label || '<no label>').join(',')})`)
    // 'application/vnd.dlt-logs+json'
    // return a json object with "filterFrags":[{frag1},{frag2},...] one frag for each node that reflects a filter
    const jsonObj = { filterFrags: [] as any[] }
    for (let node of nodes) {
      if (node instanceof AdltPluginChildNode) {
        let filters = node.filter
        filters.forEach((f) => jsonObj.filterFrags.push(f.asConfiguration()))
      } else if (node instanceof FilterNode) {
        // we do remove the enabled:false... as we treat this temporary
        // todo keep id?
        jsonObj.filterFrags.push({ ...node.filter.asConfiguration(), enabled: undefined })
      } else if (node instanceof FilterRootNode) {
        // iterate over all active children:
        for (let child of node.children) {
          if (child.filter.enabled) {
            jsonObj.filterFrags.push(child.filter.asConfiguration())
          }
        }
      } else {
        this.log.info(`adlt.onDrag: unhandled node=${node.label}`)
      }
    }
    // todo if filterFrags is empty, still set?
    this.log.info(`adlt.onDrag setting '${JSON.stringify(jsonObj)}' as 'application/vnd.dlt-logs+json')`)
    dataTransfer.set('application/vnd.dlt-logs+json', new vscode.DataTransferItem(jsonObj))
  }

  /**
   * reload an opened document. This is e.g. helpful if the adlt process has been restarted/killed/...
   * Will reload all filters (so any temp filters will be lost).
   * @param uri 
   */
  public reloadDocument(uri: vscode.Uri) {
    const uriStr = uri.toString()
    this.log.info(`adltDocumentProvider.reloadDocument(${uriStr})...`)
    const doc = this._documents.get(uriStr)
    if (doc) {
      // remove treee view node:
      let childNode: TreeViewNode = doc.treeNode
      for (let i = 0; i < this._treeRootNodes.length; ++i) {
        if (this._treeRootNodes[i] === childNode) {
          this._treeRootNodes.splice(i, 1)
          break
        }
      }
      this._onDidChangeTreeData.fire(null)

      this._documents.delete(uriStr)
      this.onDidClose(doc)

      const _ = this.readFile(uri) // stat doesn't work with remotes. this creates a new document
      const newDoc = this._documents.get(uriStr)
      if (newDoc) {
        newDoc.textDocument = doc.textDocument // todo or copy before onDidClose/dispose...
        doc.textDocument = undefined
        newDoc.textEditors = [...doc.textEditors] // copy the text editors (see todo above)
        doc.textEditors = []
      } else {
        this.log.error(`adltDocumentProvider.reloadDocument(${uriStr}) failed to open document`)
      }
    }
  }

  public onDidClose(doc: ReportDocument) {
    // doc has been removed already from this._documents!
    if (doc !== undefined && doc instanceof AdltDocument) {
      doc.dispose()
    }
    if (this._documents.size === 0) {
      this.closeAdltProcess()
    }
  }

  closeAdltProcess() {
    this.log.info(`adlt.closeAdltProcess()...`)
    if (this._adltProcess) {
      try {
        const oldProc = this._adltProcess
        this._adltProcess = undefined
        oldProc.removeAllListeners('exit') // expected
        oldProc.kill()
      } catch (err) {
        this.log.error(`adlt.closeAdltProcess(port=${this._adltPort}) got err=${err}`)
      }
    }
    this._adltPort = 0
  }

  /**
   * spawn an adlt process at specified port.
   *
   * Checks whether the process could be started sucessfully and
   * whether its listening on the port.
   *
   * Uses this._adltCommand to start the process and the params 'remote -p<port>'.
   *
   * It listens on stdout and stderr (and on 'close' and 'error' events).
   * This could be improved/changed to listen only until a successful start is detected.
   *
   * Rejects with 'ENOENT' or 'AddrInUse' or 'did close unexpectedly' in case of errors.
   *
   * @param port number of port to use for remote websocket
   * @returns pair of ChildProcess started and the port number
   */
  spawnAdltProcess(port: number): Promise<[ChildProcess, number]> {
    const log = this.log
    log.trace(`adlt.spawnAdltProcess(port=${port})...`)
    // debug feature: if adltCommand contains only a number we do return just the port:
    if (+this._adltCommand > 0) {
      return new Promise<[ChildProcess, number]>((resolve, reject) =>
        resolve([spawn('/bin/false', [], { detached: false, windowsHide: true }), +this._adltCommand]),
      )
    }

    let p = new Promise<[ChildProcess, number]>((resolve, reject) => {
      let obj = [false]
      let childProc = spawn(this._adltCommand, ['remote', `-p=${port}`], { detached: false, windowsHide: true })
      log.trace(`adlt.spawnAdltProcess(port=${port}) spawned adlt with pid=${childProc.pid}`)
      childProc.on('error', (err) => {
        log.error(`adlt.spawnAdltProcess process got err='${err}'`)
        if (!obj[0] && err.message.includes('ENOENT')) {
          obj[0] = true
          reject('ENOENT please check configuration setting dlt-logs.adltPath')
        }
      })
      childProc.on('close', (code, signal) => {
        log.warn(`adlt.spawnAdltProcess(port=${port}) process got close code='${code}' signal='${signal}'`)
        if (!obj[0]) {
          obj[0] = true
          reject('did close unexpectedly')
        }
      })
      childProc?.stdout?.on('data', (data) => {
        // todo or use 'spawn' event?
        log.info(`adlt.spawnAdltProcess(port=${port}) stdout: ${data.toString().trim()}`)
        try {
          if (!obj[0] && `${data}`.includes('remote server listening on')) {
            obj[0] = true // todo stop searching for ... (might as well stop listening completely for stdout)
            log.trace(`adlt.spawnAdltProcess(port=${port}) process got stdout resolving promise for port ${port}`)
            resolve([childProc, port])
          }
        } catch (err) {
          log.error(`adlt.spawnAdltProcess(port=${port}) process stdout got err='${err}, typeof data=${typeof data}'`)
        }
      })
      childProc?.stderr?.on('data', (data) => {
        log.warn(`adlt.spawnAdltProcess(port=${port}) stderr: ${data}`)
        if (!obj[0] && `${data}`.includes('AddrInUse')) {
          obj[0] = true
          reject('AddrInUse')
        }
      })
    })
    return p
  }

  /**
   * get the port of adlt process.
   * Starts adlt if needed and tries to find an open port in range
   * 6779-6789.
   *
   * Sets internal variables _adltProcess and _adltPort as well.
   * @returns a promise for the port
   */
  getAdltProcessAndPort(): Promise<number> {
    let p = new Promise<number>((resolve, reject) => {
      if (!this._adltPort || !this._adltProcess) {
        // start it
        // currently it retries 10 times even if spawnAdltProcess rejects with ENOENT! todo
        util
          .retryOperation((retries_left: number) => this.spawnAdltProcess(6789 - retries_left), 10, 10)
          .then(([childProc, port]) => {
            this._adltProcess = childProc
            this._adltPort = port
            const aThis = this
            this._adltProcess.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
              if (aThis._adltProcess === childProc) {
                aThis.log.warn(`adlt.getAdltProcessAndPort() process exited with code='${code}' signal='${signal}'!`)
                aThis._adltProcess = undefined
                aThis._adltPort = 0
              } // else we ignore it as we have a new process already
            })
            resolve(port)
          })
          .catch((reason) => {
            this._adltPort = 0
            this._adltProcess = undefined
            reject(reason)
          })
      } else {
        resolve(this._adltPort)
      }
    })

    return p
  }

  // filesystem provider api:

  // todo close them automatically after inactivity
  private _remoteFsProvider: Map<string, AdltRemoteFSProvider> = new Map<string, AdltRemoteFSProvider>()

  get onDidChangeFile() {
    return this._onDidChangeFile.event
  }

  localADltInfo: Record<string, string | string[]> | undefined

  async getLocalADltInfo(): Promise<Record<string, string | string[]>> {
    const log = this.log
    if (this.localADltInfo !== undefined) {
      return this.localADltInfo
    } else {
      return new Promise(async (resolve, reject) => {
        try {
          let res: Record<string, string | string[]> = {}
          const address = await this.getAdltProcessAndPort().then((port) => `ws://localhost:${port}`)
          log.info(`getLocalADltInfo using:'${address}'`)
          const webSocket = new WebSocket(address, [], { perMessageDeflate: false, origin: 'adlt-logs', maxPayload: 1_000_000_000 })
          webSocket.on('upgrade', (response) => {
            const ah = response.headers['adlt-version']
            const adltVersion = ah && !Array.isArray(ah) ? ah : ah && Array.isArray(ah) ? ah.join(',') : undefined
            if (adltVersion) {
              res['adlt-version'] = adltVersion
            }
            let hdr_archives_supported = response.headers['adlt-archives-supported']
            let archives_supported =
              hdr_archives_supported && !Array.isArray(hdr_archives_supported)
                ? hdr_archives_supported.length > 0
                  ? hdr_archives_supported.split(',')
                  : []
                : []
            res['adlt-archives-supported'] = archives_supported
            webSocket.close()
            this.localADltInfo = res
            log.info(`getLocalADltInfo returning: ${JSON.stringify(res)}`)
            resolve(res)
          })
          // wait 3s (otherwise the webSocket gets closed instantly...)
          await util.sleep(3000)
          if (this.localADltInfo === undefined) {
            log.info(`getLocalADltInfo 3s timeout`)
            reject('timeout')
          }
          webSocket.close()
        } catch (e) {
          log.warn(`getLocalADltInfo got error: ${e}`)
          reject(e)
        }
      })
    }
  }

  stat(uri: vscode.Uri): vscode.FileStat | Thenable<vscode.FileStat> {
    const log = this.log
    // log.info(`adlt-logs.stat(uri=${uri.toString().slice(0, 100)})...`)
    let document = this._documents.get(uri.toString())
    if (document) {
      return document.stat()
    }
    try {
      const isLocalAddress = uri.authority === undefined || uri.authority === ''
      if (isLocalAddress) {
        let fileNames = decodeAdltUri(uri)
        if (fileNames.length > 0) {
          const realStat = fs.statSync(fileNames[0])
          // console.log(`adlt-logs.stat(uri=${uri.toString().slice(0, 100)})... isDirectory=${realStat.isDirectory()}}`);
          if (realStat.isFile()) {
            try {
              let address = this.getAdltProcessAndPort().then((port) => `ws://localhost:${port}`)
              document = new AdltDocument(
                this.log,
                this.globalState,
                this.commentController,
                address,
                uri,
                this._onDidChangeFile,
                this._onDidChangeTreeData,
                this._treeRootNodes,
                this._onDidChangeStatus,
                this.checkActiveRestQueryDocChanged,
                this._columns,
                this._reporter,
              )
              this._documents.set(uri.toString(), document)
            } catch (error) {
              log.info(` adlt-logs.stat(uri=${uri.toString().slice(0, 100)}) returning realStat ${realStat.size} size.`)
              return {
                size: realStat.size,
                ctime: realStat.ctime.valueOf(),
                mtime: realStat.mtime.valueOf(),
                type: realStat.isDirectory()
                  ? vscode.FileType.Directory
                  : realStat.isFile()
                    ? vscode.FileType.File
                    : vscode.FileType.Unknown, // todo symlinks as file?
              }
            }
          }
          if (document) {
            return document.stat()
          } else {
            log.info(` adlt-logs.stat(uri=${uri.toString().slice(0, 100)}) returning realStat ${realStat.size} size.`)
            return {
              size: realStat.size,
              ctime: realStat.ctime.valueOf(),
              mtime: realStat.mtime.valueOf(),
              type: realStat.isDirectory() ? vscode.FileType.Directory : realStat.isFile() ? vscode.FileType.File : vscode.FileType.Unknown, // todo symlinks as file?
            }
          }
        }
      } else {
        // !isLocalAddress
        let rfsProvider = this._remoteFsProvider.get(uri.authority)
        if (!rfsProvider || !rfsProvider.connectedOrPending()) {
          if (rfsProvider) {
            rfsProvider.dispose()
          }
          rfsProvider = new AdltRemoteFSProvider(this.log, uri.authority)
          this._remoteFsProvider.set(uri.authority, rfsProvider)
        }
        return rfsProvider.stat(uri)
      }
    } catch (err) {
      log.warn(`adlt-logs.stat(uri=${uri.toString().slice(0, 100)}) got err '${err}'!`)
      if (err instanceof vscode.FileSystemError) {
        throw err
      }
    }
    // log.warn(`adlt-logs.stat(uri=${uri.toString().slice(0, 100)}) returning unknown stat!`)
    return { size: 0, ctime: 0, mtime: 0, type: vscode.FileType.Unknown }
  }

  readFile(uri: vscode.Uri): Uint8Array {
    let doc = this._documents.get(uri.toString())
    // this.log.info(`ADltDocumentProvider.readFile(uri.authority='${uri.authority}' ${uri.toString().slice(0, 100)})...`)
    if (!doc) {
      const isLocalAddress = uri.authority === undefined || uri.authority === ''
      const address = isLocalAddress
        ? this.getAdltProcessAndPort().then((port) => `ws://localhost:${port}`)
        : Promise.resolve(uri.authority)
      doc = new AdltDocument(
        this.log,
        this.globalState,
        this.commentController,
        address,
        uri,
        this._onDidChangeFile,
        this._onDidChangeTreeData,
        this._treeRootNodes,
        this._onDidChangeStatus,
        this.checkActiveRestQueryDocChanged,
        this._columns,
        this._reporter,
      )
      this._documents.set(uri.toString(), doc)
    }
    return Buffer.from(doc.text)
  }

  watch(uri: vscode.Uri): vscode.Disposable {
    // this.log.info(`adlt-logs.watch(uri=${uri.toString().slice(0, 100)}...`)
    return new vscode.Disposable(() => {
      // console.log(`adlt-logs.watch.Dispose ${uri}`)
      // const fileUri = uri.with({ scheme: 'file' });
      let doc = this._documents.get(uri.toString())
      if (doc) {
        // we could delete the key as well
        // todo some dispose here?
        // we seem to get this already on switching tabs... investigate todo
        // this._documents.delete(uri.toString());
      }
    })
  }

  readDirectory(uri: vscode.Uri): [string, vscode.FileType][] | Thenable<[string, vscode.FileType][]> {
    // this.log.info(`adlt-logs.readDirectory(uri=${uri.toString().slice(0, 100)}...`)
    const isLocalAddress = uri.authority === undefined || uri.authority === ''
    if (isLocalAddress) {
      let entries: [string, vscode.FileType][] = []
      // list all dirs and dlt files:
      let dirPath = uri.with({ query: '' }).fsPath // for multiple files we take the first one as reference
      const dirEnts = fs.readdirSync(dirPath, { withFileTypes: true })
      for (var i = 0; i < dirEnts.length; ++i) {
        this.log.trace(` adlt-logs.readDirectory found ${dirEnts[i].name}`)
        if (dirEnts[i].isDirectory()) {
          entries.push([dirEnts[i].name, vscode.FileType.Directory])
        } else {
          if (dirEnts[i].isFile() && dirEnts[i].name.endsWith('.dlt') /* todo config */) {
            entries.push([dirEnts[i].name, vscode.FileType.File])
          }
        }
      }
      this.log.trace(` adlt-logs.readDirectory(uri=${uri.toString().slice(0, 100)}) returning ${entries.length} local entries.`)
      return entries
    } else {
      let rfsProvider = this._remoteFsProvider.get(uri.authority)
      if (!rfsProvider || !rfsProvider.connectedOrPending()) {
        if (rfsProvider) {
          rfsProvider.dispose()
        }
        rfsProvider = new AdltRemoteFSProvider(this.log, uri.authority)
        this._remoteFsProvider.set(uri.authority, rfsProvider)
      }
      return rfsProvider.readDirectory(uri)
    }
  }

  writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean }): void {
    this.log.warn(`adlt-logs.writeFile(uri=${uri.toString().slice(0, 100)}...`)
    throw vscode.FileSystemError.NoPermissions()
  }

  rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): void {
    this.log.warn(`adlt-logs.rename(oldUri=${oldUri.toString().slice(0, 100)}...`)
    throw vscode.FileSystemError.NoPermissions()
  }

  delete(uri: vscode.Uri): void {
    this.log.warn(`adlt-logs.delete(uri=${uri.toString().slice(0, 100)}...`)
    throw vscode.FileSystemError.NoPermissions()
  }

  createDirectory(uri: vscode.Uri): void {
    this.log.warn(`adlt-logs.createDirectory(uri=${uri.toString().slice(0, 100)}...`)
    throw vscode.FileSystemError.NoPermissions()
  }
}
