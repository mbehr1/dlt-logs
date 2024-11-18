/* --------------------
 * Copyright(C) Matthias Behr.
 */

import * as vscode from 'vscode'
import { createUniqueId } from './util'
import { DltFilter, DltFilterType } from './dltFilter'

export interface TreeViewNode {
  id: string // unique id
  label: string
  tooltip: string | vscode.MarkdownString | undefined
  uri: vscode.Uri | null // index provided as fragment #<index>
  parent: TreeViewNode | null
  children: TreeViewNode[]
  contextValue?: string
  command?: vscode.Command
  description?: string
  iconPath?: vscode.ThemeIcon
  applyCommand?: (cmd: string) => void
}

/**
 * TreeViewNode representing the "Filters" root node
 * Has a specific icon and methods to disable all
 * filters
 */
export class FilterRootNode implements TreeViewNode {
  tooltip: string | undefined
  id: string
  children: FilterNode[] = []
  parent: TreeViewNode | null = null
  iconPath?: vscode.ThemeIcon

  get label(): string {
    return 'Filters'
  }

  constructor(public uri: vscode.Uri | null) {
    this.id = createUniqueId()
    this.iconPath = new vscode.ThemeIcon('filter')
  }

  /**
   * determine the context value used to determine which commands
   * are available
   */
  get contextValue() {
    let anyEnabled: boolean = this.anyFilterWith(true)
    let anyDisabled: boolean = this.anyFilterWith(false)

    // we do allow "zoom in" to provide more details.
    // this is if we can enable pos. or disable neg. filters
    let canZoomIn: boolean =
      this.anyFilterWith(false, { type: DltFilterType.POSITIVE }) || this.anyFilterWith(true, { type: DltFilterType.NEGATIVE })

    let canZoomOut: boolean =
      this.anyFilterWith(true, { type: DltFilterType.POSITIVE }) || this.anyFilterWith(false, { type: DltFilterType.NEGATIVE })

    return `${anyEnabled ? 'filterEnabled ' : ''}${anyDisabled ? 'filterDisabled ' : ''}${canZoomIn ? 'canZoomIn ' : ''}${
      canZoomOut ? 'canZoomOut ' : ''
    }`
  }

  anyFilterWith(enabled: boolean, options?: { type?: DltFilterType }): boolean {
    for (let i = 0; i < this.children.length; ++i) {
      const c = this.children[i]
      if (c instanceof FilterNode) {
        if (c.filter.atLoadTime) {
          continue
        }
        if (c.filter.isReport || c.filter.type === DltFilterType.EVENT) {
          continue
        }
        if (options !== undefined && options.type !== undefined) {
          if (c.filter.type !== options.type) {
            continue
          }
        }
        if (c.filter.enabled === enabled) {
          return true
        }
      }
    }
    return false
  }

  /**
   * perform a command usually trigger from context menu commands
   * @param cmd command to apply: 'enable', 'disable', 'zoomIn', 'zoomOut'
   */
  applyCommand(cmd: string) {
    this.children.forEach((c) => {
      if (c.filter.atLoadTime) {
        return
      }
      if (c.filter.isReport || c.filter.type === DltFilterType.EVENT) {
        return
      }
      // dont restict to allowEdit ones... if (!c.filter.allowEdit) { return; }
      switch (cmd) {
        case 'enable':
          c.filter.enabled = true
          break
        case 'disable':
          c.filter.enabled = false
          break
        case 'zoomIn':
          switch (c.filter.type) {
            case DltFilterType.POSITIVE:
              c.filter.enabled = true
              break
            case DltFilterType.NEGATIVE:
              c.filter.enabled = false
              break
          }
          break
        case 'zoomOut':
          switch (c.filter.type) {
            case DltFilterType.POSITIVE:
              c.filter.enabled = false
              break
            case DltFilterType.NEGATIVE:
              c.filter.enabled = true
              break
          }
          break
        case 'setPosFilter':
          if (c.filter.type === DltFilterType.POSITIVE) {
            c.filter.enabled = true
          }
          break
        case 'save':
          break // noop for FilterRootNode
        default:
          console.warn(`FilterRootNode.applyCommand: unknown command='${cmd}'`)
      }
    })
  }
}

export class FilterNode implements TreeViewNode {
  id: string
  tooltip: string | undefined
  //uri: vscode.Uri | null; // index provided as fragment #<index>
  //parent: TreeViewNode | null;
  children: TreeViewNode[]

  get label(): string {
    return this.filter.name
  }

  get contextValue() {
    let ctxV: string
    if (this.filter.isReport) {
      ctxV = 'filterReport'
    } else if (this.filter.atLoadTime) {
      ctxV = 'filterLoadTime'
    } else if (this.filter.enabled) {
      ctxV = 'filterEnabled'
    } else {
      ctxV = 'filterDisabled'
    }
    if (this.filter.allowEdit) {
      ctxV += ' filterAllowEdit'
    }
    return ctxV
  } // readonly

  constructor(
    public uri: vscode.Uri | null,
    public parent: TreeViewNode | null,
    public filter: DltFilter,
  ) {
    this.children = []
    this.id = createUniqueId()
  }

  /* we cannot use the filter id as we have multiple nodes for the same filter in the tree get id(): string { return this.filter.id; } */

  get iconPath(): vscode.ThemeIcon | undefined {
    return this.filter.iconPath
  }

  applyCommand(cmd: string) {
    switch (cmd) {
      case 'enable':
        this.filter.enabled = true
        break
      case 'disable':
        this.filter.enabled = false
        break
      default:
        console.warn(`FilterNode.applyCommand unknown cmd '${cmd}'`)
        break
    }
  }
}

export class ConfigNode implements TreeViewNode {
  id: string
  tooltip: string | undefined
  children: TreeViewNode[] = []
  description?: string
  iconPath?: vscode.ThemeIcon
  autoEnableIf?: string

  constructor(
    public uri: vscode.Uri | null,
    public parent: TreeViewNode | null,
    public label: string,
  ) {
    this.id = createUniqueId()
  }

  anyFilterWith(enabled: boolean, options?: { type?: DltFilterType }): boolean {
    for (let i = 0; i < this.children.length; ++i) {
      const c = this.children[i]
      if (c instanceof FilterNode) {
        if (options !== undefined && options.type !== undefined) {
          if (c.filter.type !== options.type) {
            continue
          }
        }
        if (c.filter.enabled === enabled) {
          return true
        }
      } else if (c instanceof ConfigNode) {
        let val = c.anyFilterWith(enabled, options)
        if (val) {
          return true
        }
      }
    }
    return false
  }

  get contextValue(): string {
    let anyEnabled: boolean = this.anyFilterWith(true)
    let anyDisabled: boolean = this.anyFilterWith(false)

    // we do allow "zoom in" to provide more details.
    // this is if we can enable pos. or disable neg. filters
    let canZoomIn: boolean =
      this.anyFilterWith(false, { type: DltFilterType.POSITIVE }) || this.anyFilterWith(true, { type: DltFilterType.NEGATIVE })

    let canZoomOut: boolean =
      this.anyFilterWith(true, { type: DltFilterType.POSITIVE }) || this.anyFilterWith(false, { type: DltFilterType.NEGATIVE })

    return `${anyEnabled ? 'filterEnabled ' : ''}${anyDisabled ? 'filterDisabled ' : ''}${canZoomIn ? 'canZoomIn ' : ''}${
      canZoomOut ? 'canZoomOut ' : ''
    }`
  }

  applyCommand(command: string) {
    this.children.forEach((c) => {
      if (c instanceof FilterNode) {
        switch (command) {
          case 'enable':
            c.filter.enabled = true
            break
          case 'disable':
            c.filter.enabled = false
            break
          case 'zoomIn':
            switch (c.filter.type) {
              case DltFilterType.POSITIVE:
                c.filter.enabled = true
                break
              case DltFilterType.NEGATIVE:
                c.filter.enabled = false
                break
            }
            break
          case 'zoomOut':
            switch (c.filter.type) {
              case DltFilterType.POSITIVE:
                c.filter.enabled = false
                break
              case DltFilterType.NEGATIVE:
                c.filter.enabled = true
                break
            }
            break
          case 'setPosFilter':
            if (c.filter.type === DltFilterType.POSITIVE) {
              c.filter.enabled = true
            }
            break
        }
      } else if (c instanceof ConfigNode) {
        c.applyCommand(command)
      }
    })
  }
}

export interface FilterableDocument {
  uri: vscode.Uri
  allFilters: DltFilter[]
  onFilterEdit(filter: DltFilter): boolean
  onFilterDelete(filter: DltFilter, callTriggerApplyFilter?: boolean): boolean
  onFilterAdd(filter: DltFilter, callTriggerApplyFilter?: boolean): boolean
}

export interface FilterableLifecycleInfo {
  persistentId: number
  tooltip: string
  getTreeNodeLabel(): string
}

/**
 * TreeViewNode representing the "Detected lifecycles" root node
 * Has a specific icon and methods supporting lifecycle filters
 */
export class LifecycleRootNode implements TreeViewNode {
  tooltip: string | undefined
  id: string
  children: TreeViewNode[] = []
  parent: TreeViewNode | null = null
  iconPath?: vscode.ThemeIcon
  private lcFilter?: DltFilter
  private lcsFiltered: FilterableLifecycleInfo[] = []

  get label(): string {
    return 'Detected lifecycles'
  }
  get uri(): vscode.Uri | null {
    return this.doc.uri
  }

  constructor(private doc: FilterableDocument) {
    this.id = createUniqueId()
    this.iconPath = new vscode.ThemeIcon('list-selection')
  }

  reset() {
    // if we have set a lcFilter we do need to remove it:
    if (this.lcFilter) {
      // remove from allFilters:
      this.doc.onFilterDelete(this.lcFilter, false)
      this.lcFilter = undefined
    }

    this.children = []
  }

  /**
   * Return whether a lifecycle is currently filtered.
   * @param lc lifecycle to get the info for
   */
  hasLcFiltered(lc: FilterableLifecycleInfo): boolean {
    if (this.lcsFiltered.indexOf(lc) < 0) {
      return false
    }
    return this.lcFilter !== undefined && this.lcFilter.enabled
  }

  /**
   * Add/remove a lifecycle to the filter.
   * @param lc lifecycle so filter/remove from filter
   * @param doFilter indicate whether the lifecycle should be filtered or not
   */
  filterLc(lc: FilterableLifecycleInfo, doFilter: boolean) {
    let filtersChanged = false

    // if the filter is currently disabled and the filter should be set
    // we do remove all lcs first:
    if (this.lcFilter !== undefined && !this.lcFilter.enabled && doFilter) {
      this.lcFilter.enabled = true
      this.lcsFiltered = []
    }

    const idx = this.lcsFiltered.indexOf(lc)

    if (doFilter && idx < 0) {
      this.lcsFiltered.push(lc)
      filtersChanged = true
    }
    if (!doFilter && idx >= 0) {
      this.lcsFiltered.splice(idx, 1) // remove
      filtersChanged = true
    }
    if (filtersChanged) {
      if (this.lcsFiltered.length > 0) {
        if (!this.lcFilter) {
          this.lcFilter = new DltFilter({ type: DltFilterType.NEGATIVE, not: true, name: 'not selected lifecycles' }, false)
          // add to allFilters:
          this.doc.onFilterAdd(this.lcFilter, false)
        }
        this.lcFilter.lifecycles = this.lcsFiltered.map((lc) => lc.persistentId)
      } else {
        if (this.lcFilter) {
          this.doc.onFilterDelete(this.lcFilter, false)
          this.lcFilter = undefined
        }
      }
    }
  }
}

export interface EcuNode extends TreeViewNode {
  swVersions: string[]
  /// decorations for even/odd lifecycles (if any)
  lcDecorationTypes?: [vscode.TextEditorDecorationType | undefined, vscode.TextEditorDecorationType | undefined]
}

export class LifecycleNode implements TreeViewNode {
  id: string
  label: string
  tooltip: string | undefined
  get children(): TreeViewNode[] {
    return []
  } // no children
  constructor(
    public uri: vscode.Uri | null,
    public parent: EcuNode,
    private lcRootNode: LifecycleRootNode,
    private lc: FilterableLifecycleInfo,
    private lcNr: number | undefined,
  ) {
    this.id = createUniqueId()
    this.label = lcNr !== undefined ? `LC#${lcNr}: ${lc.getTreeNodeLabel()}` : `LC${lc.getTreeNodeLabel()}`
    this.tooltip = lc.tooltip
  }

  /**
   * return filterEnabled/Disabled based on whether the lifecycle
   * filter contains our lifecycle.
   */
  get contextValue() {
    let isCurrentlyFiltered = this.lcRootNode.hasLcFiltered(this.lc)
    return `${isCurrentlyFiltered ? 'filterEnabled' : 'filterDisabled'}`
  }

  applyCommand(cmd: string) {
    console.log(`LifecycleNode.applyCommand('${cmd}')`)
    switch (cmd) {
      case 'enable':
      case 'disable':
        this.lcRootNode.filterLc(this.lc, cmd === 'enable')
        break
      default:
        console.warn(`LifecycleNode.applyCommand unsupported cmd:'${cmd}'`)
        break
    }
  }
}

/**
 * class representing dynamic filterable items (e.g. ecu/apid/ctid)
 * Supports the commands "pos", "neg", "disable"
 */
export class DynFilterNode implements TreeViewNode {
  id: string
  children: TreeViewNode[] = []
  iconPath?: vscode.ThemeIcon
  get uri(): vscode.Uri | null {
    return this.doc.uri
  }

  constructor(
    public label: string,
    private _tooltip: string | undefined,
    public parent: TreeViewNode,
    icon: string | undefined,
    private filterFragment: any,
    private doc: FilterableDocument,
  ) {
    this.id = createUniqueId()
    if (icon) {
      this.iconPath = new vscode.ThemeIcon(icon)
    }
    //console.log(`DynFilterNode constr. with filterFragment=${JSON.stringify(filterFragment)}`);
  }

  get contextValue() {
    // we determine whether this filter fragments are visible or not
    // it's visible if
    //  a) no pos filter exists or
    //  b) a pos filter includes this one
    //  and
    //  c) not removed with a neg. filter

    const filtersActive = this.getSimilarFilters(true)

    const posFiltersActive = filtersActive.filter((f) => f.type === DltFilterType.POSITIVE).length
    const negFiltersActive = filtersActive.filter((f) => f.type === DltFilterType.NEGATIVE).length
    let anyPosFilterActive = posFiltersActive
    if (!anyPosFilterActive) {
      // any pos filter set?
      anyPosFilterActive = this.doc.allFilters.filter((f) => f.enabled && !f.atLoadTime && f.type === DltFilterType.POSITIVE).length
    }

    let isCurrentlyVisible = (posFiltersActive || anyPosFilterActive === 0) && negFiltersActive === 0
    let canSetPosF = isCurrentlyVisible && anyPosFilterActive === 0
    return `${isCurrentlyVisible ? 'canZoomOut' : 'canZoomIn'}${canSetPosF ? ' canSetPosF' : ''}`
  }

  get tooltip(): string | undefined {
    const activeFilters = this.getSimilarFilters(true)
    if (activeFilters.length) {
      return `${this._tooltip ? this._tooltip + '\n' : ''}Active filters:\n${activeFilters.map((f) => f.name).join(',\n')}`
    } else {
      const filterFrag = { ...this.filterFragment }
      Object.keys(filterFrag).forEach((key) => !(filterFrag[key] === null) || delete filterFrag[key])
      return `${this._tooltip ? this._tooltip + '\n' : ''}Would set filter:\n${JSON.stringify(filterFrag)}`
    }
  }

  applyCommand(cmd: string) {
    console.log(`DynFilterNode.applyCommand('${cmd}')`)
    const nonRestFiltersActive = this.getSimilarFilters(false, true)
    console.log(` non less restrictive filters='${nonRestFiltersActive.map((f) => f.name).join(',')}'`)
    const filtersActive = this.getSimilarFilters(true, true)
    console.log(` less restrictive filters='${filtersActive.map((f) => f.name).join(',')}'`)

    switch (cmd) {
      case 'zoomIn': // aka 'make visible': either if any neg: "disable all neg filters" and "add a pos filter"
        const negFilters = filtersActive.filter((f) => f.enabled && f.type === DltFilterType.NEGATIVE)
        if (negFilters.length > 0) {
          console.log(` disabled ${negFilters.length} neg`)
          negFilters.forEach((f) => (f.enabled = false))
        }
        // add a pos filter:
        // do we have any less restr. pos. filter? (if so no need to add another one)
        const posLessRestF = filtersActive.filter((f) => f.enabled && f.type === DltFilterType.POSITIVE)
        if (posLessRestF.length === 0) {
          // do we have any one that is currently disabled? if so, enable it
          const disPosF = nonRestFiltersActive.filter((f) => !f.enabled && f.type === DltFilterType.POSITIVE)
          if (disPosF.length > 0) {
            console.log(` enabled 1 pos`)
            disPosF[0].enabled = true
          } else {
            // else do add a new one
            const filterFrag = { type: DltFilterType.POSITIVE, ...this.filterFragment }
            Object.keys(filterFrag).forEach((key) => !(filterFrag[key] === null) || delete filterFrag[key])
            console.log(` adding new pos ${JSON.stringify(filterFrag)}`)
            const newFilter = new DltFilter(filterFrag, true)
            this.doc.onFilterAdd(newFilter, false)
          }
        }
        break
      case 'zoomOut': // aka 'make non visible':  if pos filter is fitting non less restrictive: disable else "add a neg filter"
        const posNonRestF = nonRestFiltersActive.filter((f) => f.enabled && f.type === DltFilterType.POSITIVE)
        if (posNonRestF.length > 0) {
          console.log(`disabled ${posNonRestF.length} pos`)
          posNonRestF.forEach((f) => (f.enabled = false))
        }
        // if any less restr. pos. filter meets, add a neg filter:
        const posLessRestF2 = filtersActive.filter((f) => f.enabled && f.type === DltFilterType.POSITIVE)
        const anyPosFilterActive = this.doc.allFilters.filter((f) => f.enabled && !f.atLoadTime && f.type === DltFilterType.POSITIVE).length
        if (posLessRestF2.length > 0 || !anyPosFilterActive) {
          // add a neg filter:
          // do we have any one that is currently disabled? if so, enable it
          const disNegF = nonRestFiltersActive.filter((f) => !f.enabled && f.type === DltFilterType.NEGATIVE)
          if (disNegF.length > 0) {
            console.log(`enabled 1 neg`)
            disNegF[0].enabled = true
          } else {
            // add new neg one will all but null keys:
            const filterFrag = { type: DltFilterType.NEGATIVE, ...this.filterFragment }
            Object.keys(filterFrag).forEach((key) => !(filterFrag[key] === null) || delete filterFrag[key])
            console.log(` adding new neg ${JSON.stringify(filterFrag)}`)
            const newFilter = new DltFilter(filterFrag, true)
            this.doc.onFilterAdd(newFilter, false)
          }
        }
        break
      case 'setPosFilter':
        // for now we assume we're called if canSetPosF is available, so the data is seen
        // which is the case if no pos filter at all is visible. In this case the current logic allows only to remove the entry/add neg filter
        // but not to add a filter only for that one

        // check that no pos filter is active:
        if (this.doc.allFilters.filter((f) => f.enabled && !f.atLoadTime && f.type === DltFilterType.POSITIVE).length === 0) {
          const filterFrag = { type: DltFilterType.POSITIVE, ...this.filterFragment }
          Object.keys(filterFrag).forEach((key) => !(filterFrag[key] === null) || delete filterFrag[key])
          //console.log(` setPosFilter adding new pos ${JSON.stringify(filterFrag)}`);
          const newFilter = new DltFilter(filterFrag, true)
          this.doc.onFilterAdd(newFilter, false)
        } else {
          console.warn(`dlt-logs.DynFilterNode.setPosFilter logical error!`)
        }
        break
      default:
        console.warn(`DynFilterNode.applyCommand unsupported cmd:'${cmd}'`)
        break
    }
  }

  getSimilarFilters(lessRestrictive: boolean, includeDisabled: boolean = false): DltFilter[] {
    return DltFilter.getSimilarFilters(lessRestrictive, includeDisabled, this.filterFragment, this.doc.allFilters)
  }
}
