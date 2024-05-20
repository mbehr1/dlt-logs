import * as vscode from 'vscode'
import { AdltDocument, AdltMsg } from './adltDocumentProvider'
import { MSTP, MTIN_LOG } from './dltParser'

interface CommentMsgData {
  index: number // index of the msg in the document
  text: string
  mtin: number // MTIN_LOG.LOG_WARN/ERROR/FATAL or 0
}

// MARK: AdltCommentThread
export class AdltCommentThread {
  msgs: CommentMsgData[]
  public thread: vscode.CommentThread
  public minMsgIndex: number
  public minMsgTimeInMs: number

  constructor(
    private log: vscode.LogOutputChannel,
    msgs: CommentMsgData[],
    thread: vscode.CommentThread,
    minMsgIndex: number,
    minMsgTimeInMs: number,
  ) {
    this.msgs = msgs
    this.thread = thread
    this.minMsgIndex = minMsgIndex
    this.minMsgTimeInMs = minMsgTimeInMs
  }

  static newFromReply(log: vscode.LogOutputChannel, doc: AdltDocument, reply: vscode.CommentReply): AdltCommentThread {
    // gather all the msg indexes for the thread
    let msgs: CommentMsgData[] = []
    const thread = reply.thread
    let minMsgIndex: number = Number.MAX_SAFE_INTEGER
    let minMsgTimeInMs: number = Number.MAX_SAFE_INTEGER

    if (doc.textDocument === undefined) {
      log.error(`AdltDocument.commentCreate(reply) no textDocument!`)
      throw new Error(`AdltDocument.commentCreate(reply) no textDocument!`)
    }

    for (let i = thread.range.start.line; i <= thread.range.end.line; ++i) {
      let msg = doc.msgByLine(i)
      if (msg) {
        minMsgIndex = Math.min(minMsgIndex, msg.index)
        const msgTimeInMs = doc.provideTimeByMsgInMs(msg) || Date.now()
        minMsgTimeInMs = Math.min(minMsgTimeInMs, msgTimeInMs)
        const lineText = doc.textDocument.lineAt(i).text
        msgs.push({ index: msg.index, text: lineText, mtin: msg.mstp === MSTP.TYPE_LOG ? msg.mtin : 0 })
      } else {
        log.error(`AdltCommentThread()) no msg found for line ${i}!`)
      }
    }
    if (msgs.length === 0) {
      log.error(`AdltDocument.commentCreate(reply) no msgs found for thread!`)
      throw new Error(`AdltDocument.commentCreate(reply) no msgs found for thread!`)
    }
    // strip common leading spaces in text:
    while (msgs.every((msg) => msg.text.startsWith(' '))) {
      msgs.forEach((msg) => (msg.text = msg.text.slice(1)))
    }

    thread.canReply = false // for now
    const commentThread = new AdltCommentThread(log, msgs, thread, minMsgIndex, minMsgTimeInMs)
    const newComment = new AdltComment(
      reply.text /*new vscode.MarkdownString(reply.text, false)*/,
      vscode.CommentMode.Preview,
      { name: '' },
      commentThread,
    )
    // .Editing shows raw text, .Preview shows as markdown (if its markdown)
    // Editing shows the "cancel/save" buttons
    thread.comments = [newComment]
    thread.label = 'Comment'
    return commentThread
  }

  static newFromPersData(
    log: vscode.LogOutputChannel,
    doc: AdltDocument,
    data: CommentThreadData,
    commentController: vscode.CommentController,
  ): AdltCommentThread {
    let thread = commentController.createCommentThread(doc.uri, new vscode.Range(0, 0, 0, 1), [])
    thread.canReply = data.canReply
    if (data.label !== null) {
      thread.label = data.label
    }
    const commentThread = new AdltCommentThread(log, data.msgs, thread, data.minMsgIndex, data.minMsgTimeInMs)
    thread.comments = data.comments.map((commentData) => AdltComment.fromPersData(commentData, commentThread))
    return commentThread
  }

  asPersData(): CommentThreadData {
    return {
      canReply: this.thread.canReply,
      label: this.thread.label || null,
      msgs: this.msgs,
      minMsgIndex: this.minMsgIndex,
      minMsgTimeInMs: this.minMsgTimeInMs,
      comments: (this.thread.comments as AdltComment[]).map((comment) => comment.asPersData()),
    }
  }

  dispose() {
    this.log.info(`AdltCommentThread.dispose`)
    this.thread.comments = [] // remove cyclic dependencies to be on the safe side (no dispose for comments?)
    this.thread.dispose()
    this.msgs = []
  }

  /**
   * Update the thread after e.g. msgs have been filtered in/out or changed their line position
   * @param doc
   */
  update(doc: AdltDocument) {
    // determine min/max consecutive lines for the msgs
    let minLine = Number.MAX_SAFE_INTEGER
    let maxLine = -1
    for (const msg of this.msgs) {
      let line = doc.lineByMsgIndex(msg.index)
      if (line >= 0) {
        minLine = Math.min(minLine, line)
        if (maxLine === -1 || line === maxLine + 1) {
          maxLine = line
        } else {
          break // no need to search any further as we have minLine and MaxLine
        }
      }
    }
    this.log.info(`AdltCommentThread.update minLine=${minLine} maxLine=${maxLine}`)
    if (maxLine >= 0) {
      this.thread.range = new vscode.Range(minLine, 0, maxLine, 0)
    } else {
      // disappeared!
      // todo determine whether to show at the top or bottom (or not at all?)
      this.thread.range = new vscode.Range(0, 0, 0, 1)
      this.thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed
    }
  }

  editComment(comment: AdltComment) {
    try {
      // for now we assume there is just one comment
      comment.mode = vscode.CommentMode.Editing
      // this.thread.comments[0].body = 'foo bar'
      comment.label = 'Edit comment...'
      this.thread.comments = [comment] // need to update the comments array
    } catch (e) {
      this.log.error(`AdltCommentThread.editComment got error:`, e)
    }
  }
  saveComment(comment: AdltComment) {
    try {
      // for now we assume there is just one comment
      comment.mode = vscode.CommentMode.Preview
      comment.label = undefined
      comment.savedBody = comment.body
      this.thread.comments = [comment] // need to update the comments array and not just the entries inside
    } catch (e) {
      this.log.error(`AdltCommentThread.saveComment got error:`, e)
    }
  }
  cancelEditComment(comment: AdltComment) {
    try {
      // for now we assume there is just one comment
      comment.mode = vscode.CommentMode.Preview
      comment.label = undefined
      comment.body = comment.savedBody
      this.thread.comments = [comment] // need to update the comments array
    } catch (e) {
      this.log.error(`AdltCommentThread.cancelEditComment got error:`, e)
    }
  }

  asMarkdownText(): string {
    let md = ''
    this.thread.comments.forEach((comment) => {
      md += `${typeof comment.body === 'string' ? comment.body : comment.body.value}\n`
    })
    md += '```\n'
    this.msgs.forEach((msg) => {
      // todo escape in ``sdasd`` ? (or use vscode.MarkdownString directly)
      md += `${msg.text}\n`
    })
    md += '```\n\n'
    return md
  }

  asMarkupText(): string {
    let md = ''
    this.thread.comments.forEach((comment) => {
      md += `${typeof comment.body === 'string' ? comment.body : comment.body.value}\n`
    })
    md += '{noformat}\n'
    this.msgs.forEach((msg) => {
      let levelSymbol
      switch (msg.mtin) {
        case MTIN_LOG.LOG_WARN:
          levelSymbol = '⚠️'
          break
        case MTIN_LOG.LOG_ERROR:
          levelSymbol = '❗'
        case MTIN_LOG.LOG_FATAL:
          levelSymbol = '🛑'
          break
        default:
          levelSymbol = ' '
          break
      }
      md += `${levelSymbol}${msg.text}\n`
    })
    md += '{noformat}\n\n'
    return md
  }
}

// MARK: AdltComment
export class AdltComment implements vscode.Comment {
  // timestamp of comment. will be shown as "now", "2 hours ago",... public timestamp?: Date | undefined
  public label?: string | undefined
  public reactions?: vscode.CommentReaction[] | undefined
  savedBody: string | vscode.MarkdownString
  constructor(
    public body: string | vscode.MarkdownString,
    public mode: vscode.CommentMode,
    public author: vscode.CommentAuthorInformation,
    public parent?: AdltCommentThread,
  ) {
    this.savedBody = body
    // will be shown next to author if collapsed but not in comments panel this.label = 'comment label'
    // iconPath not working...  dont know how to get built-in icons this.reactions = [{ count: 42, label: 'label 👍', iconPath: 'globe', authorHasReacted: false }]
  }

  asPersData(): CommentPersData {
    return {
      body: typeof this.body === 'string' ? this.body : this.body.value,
      bodyIsMarkdown: typeof this.body !== 'string',
      mode: this.mode,
      authorName: this.author.name,
      label: this.label || null,
    }
  }

  static fromPersData(data: CommentPersData, parent?: AdltCommentThread): AdltComment {
    return new AdltComment(
      data.bodyIsMarkdown ? new vscode.MarkdownString(data.body) : data.body,
      data.mode,
      { name: data.authorName },
      parent,
    )
  }
}

// MARK: persist comments
// this is a temporary solution only

interface CommentPersData {
  body: string
  bodyIsMarkdown: boolean
  mode: vscode.CommentMode
  authorName: string
  label: string | null
}

// needs to be json serializable
interface CommentThreadData {
  canReply: boolean
  label: string | null
  msgs: CommentMsgData[]
  minMsgIndex: number
  minMsgTimeInMs: number
  comments: CommentPersData[]
}

interface PersistData {
  version: number // current 1
  persistedOn: number // Date.now()
  threads: CommentThreadData[]
}

export function persistComments(
  log: vscode.LogOutputChannel,
  commentThreads: AdltCommentThread[],
  doc: AdltDocument,
  storage: vscode.Memento,
) {
  try {
    let key = `adltcomments-${doc.uri.toString()}`
    if (commentThreads.length === 0) {
      storage.update(key, undefined) // this deletes
      log.info(`persistComments deleted persistency threads for:'${key}'`)
      return
    }
    let persThreads: CommentThreadData[] = []
    for (const thread of commentThreads) {
      persThreads.push(thread.asPersData())
    }
    storage.update(key, { version: 1, persistedOn: Date.now(), threads: persThreads })
    log.info(`persistComments persisted ${persThreads.length} thread(s) for:'${key}'`)
  } catch (e) {
    log.error(`error in persistComments: ${e}`)
  }
}

export function restoreComments(
  log: vscode.LogOutputChannel,
  doc: AdltDocument,
  storage: vscode.Memento,
  commentController: vscode.CommentController,
): AdltCommentThread[] {
  let threads: AdltCommentThread[] = []
  try {
    let key = `adltcomments-${doc.uri.toString()}`
    let data = storage.get<PersistData>(key)
    if (data !== undefined) {
      if (data.version !== 1) {
        log.error(`restoreComments() version mismatch for key:'${key}' got ${data.version} expected 1`)
      } else {
        for (const threadData of data.threads) {
          threads.push(AdltCommentThread.newFromPersData(log, doc, threadData, commentController))
        }
        log.info(`restored ${threads.length} comment thread(s) for:'${key}'`)
      }
    }
  } catch (e) {
    log.error(`error in restoreComments: ${e}`)
  }
  return threads
}

// purge old comments
export function purgeOldComments(log: vscode.LogOutputChannel, storage: vscode.Memento) {
  let keeping = 0
  for (const key of storage.keys()) {
    if (key.startsWith('adltcomments-')) {
      let data = storage.get<PersistData>(key)
      if (data !== undefined) {
        let now = Date.now()
        let ageInDays = (now - data.persistedOn) / (1000 * 60 * 60 * 24)
        if (ageInDays > 30) {
          storage.update(key, undefined)
          log.info(`purged old comments for key:'${key}' ageInDays=${ageInDays}`)
        } else {
          keeping += 1
        }
      }
    }
  }
  if (keeping > 0) {
    log.info(`purgeOldComments keeping ${keeping} keys/comments data for documents`)
  }
}
