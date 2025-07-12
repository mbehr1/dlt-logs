/* --------------------
 * Copyright(C) Matthias Behr, 2020.
 */

// todos
// - mstp
// -loglevelmin/max
// - report?
// - timesync...?

import * as vscode from 'vscode'
import { MultiStepInput, PickItem } from './quickPick'
import { DltFilter, DltFilterType } from './dltFilter'
import { DltDocument } from './dltDocument'
import { ConfigNode, FilterableDocument } from './dltTreeViewNodes'
import * as util from './util'
import { ReportDocument } from './dltReport'

const confSection = 'dlt-logs.filters'

export function deleteFilter(doc: FilterableDocument, filter: DltFilter) {
  console.log(`dlt-log.deleteFilter(${filter.name}) called...`)
  return new Promise<boolean>((resolveDelete) => {
    // delete config:
    const curFilter = vscode.workspace.getConfiguration().get(confSection)
    if (curFilter && Array.isArray(curFilter)) {
      let deletedConf = false
      for (let c = 0; c < curFilter.length; ++c) {
        const curOpt = curFilter[c]
        if (curOpt.id === filter.id) {
          console.log(`found conf option to delete (${JSON.stringify(curOpt)})`)
          curFilter.splice(c, 1)
          util.updateConfiguration(confSection, curFilter)
          deletedConf = true
          break
        }
      }
      if (!deletedConf) {
        console.log(`can't find current config for filter '${filter.name}'. Not deleted/found from config.`)
        // this is no error. can happen e.g. if non persisted filters are deleted from tree view
        // vscode.window.showErrorMessage(`can't find current config for filter '${filter.name}'`)
      }
    } else {
      vscode.window.showErrorMessage(`can't read current config '${confSection}'`)
    }
    const res = doc.onFilterDelete(filter)
    resolveDelete(res)
  })
}

export function addFilter(doc: FilterableDocument & ReportDocument, arg: any) {
  console.log(`dlt-log.addFilter called...${JSON.stringify(arg)}`)
  let newFilter = new DltFilter({ type: DltFilterType.POSITIVE, ecu: arg['ecu'], apid: arg['apid'], ctid: arg['ctid'] })
  return editFilter(doc, newFilter, { isAdd: true, payload: arg['payload'] })
}

export function editFilter(
  doc: FilterableDocument & ReportDocument,
  newFilter: DltFilter,
  optArgs?: { payload?: string; isAdd?: boolean },
) {
  return new Promise<boolean>((resolveEdit) => {
    const isAdd = optArgs !== undefined && optArgs.isAdd !== undefined ? optArgs.isAdd : false
    console.log(`dlt-log.editFilter(isEdit=${isAdd}) called...${newFilter.name}`)

    const updateFilterConfig = (doc: FilterableDocument, filter: DltFilter, isAdd: boolean) => {
      console.log(`updateFilterConfig(isAdd=${isAdd})...${filter.name}`)
      const curFilter = vscode.workspace.getConfiguration().get(confSection)
      if (curFilter && Array.isArray(curFilter)) {
        console.log(`updateFilterConfig(isAdd=${isAdd})...${filter.name} got ${curFilter.length} filter configs`)
        if (isAdd) {
          let confOptions = newFilter.asConfiguration()
          curFilter.push(confOptions)
          util.updateConfiguration(confSection, curFilter)?.then(() => {
            console.log(
              `isAdd updateConfiguration finished for new filter ${newFilter.name} as (${JSON.stringify(newFilter.configOptions)})`,
            )
          })
          doc.onFilterAdd(filter)
        } else {
          // check whether we find the orig config used to create this filter:
          let updatedConf = false
          for (let c = 0; c < curFilter.length; ++c) {
            const curOpt = curFilter[c]
            if (curOpt.id === filter.id) {
              // only assume that the uuid doesn't change
              console.log(`found conf option for edit (${JSON.stringify(curOpt)})`)
              let newOpt = filter.asConfiguration() // this updates the curOpt as its anyhow pointing to the same obj
              curFilter[c] = newOpt
              console.log(` updated to (${JSON.stringify(curFilter[c])})`)
              util.updateConfiguration(confSection, curFilter)
              updatedConf = true
              break
            }
          }
          if (!updatedConf) {
            console.log(`can't find current config for filter '${filter.name}'. Adding even though !isAdd`)
            //vscode.window.showErrorMessage(`can't find current config for filter '${filter.name}'`)
            let newOpt = filter.asConfiguration()
            curFilter.push(newOpt)
            util.updateConfiguration(confSection, curFilter)?.then(() => {
              console.log(`updateConfiguration finished for new filter ${filter.name}`)
            })
          }
          doc.onFilterEdit(filter)
        }
        resolveEdit(true)
      } else {
        vscode.window.showErrorMessage(`can't read current config '${confSection}'`)
      }
    }

    // step 1: ECUs:
    const ecuStrs: string[] = []
    let ecus: PickItem[] = []
    // pre-fill with info from lifecycles:
    doc.lifecycles.forEach((v, k) => {
      if (!ecuStrs.includes(k)) {
        ecuStrs.push(k)
      }
    })
    ecuStrs.forEach((s) => ecus.push(new PickItem(s)))

    // step 2: APIDs:
    let apidSet = new Map<string, string>()
    let ctidSet = new Map<string, { desc: string; apids: string[] }>()

    // prefill from document if available:
    if (doc.ecuApidInfosMap !== undefined) {
      for (let [ecu, apidInfos] of doc.ecuApidInfosMap) {
        apidInfos.forEach((v, apid) => {
          if (!apidSet.has(apid)) {
            apidSet.set(apid, v.desc)
          }
          // ctids we store as ctid, desc, apids[]
          v.ctids.forEach(([desc, nrMsgs], ctid) => {
            if (!ctidSet.has(ctid)) {
              ctidSet.set(ctid, { desc: desc, apids: [apid] })
            } else {
              // do we have this apid yet?
              const ctInfo = ctidSet.get(ctid)
              if (ctInfo && !ctInfo.apids.includes(apid)) {
                ctInfo.apids.push(apid)
              }
            }
          })
        })
      }
    } else {
      // prefill from the lifecycles
      doc.lifecycles.forEach((lI) =>
        lI.forEach((l) => {
          if (l.apidInfos !== undefined) {
            l.apidInfos.forEach((v, k) => {
              if (!apidSet.has(k)) {
                apidSet.set(k, v.desc)
              }
              // ctids we store as ctid, desc, apids[]
              v.ctids.forEach((desc, ctid) => {
                if (!ctidSet.has(ctid)) {
                  ctidSet.set(ctid, { desc: desc, apids: [k] })
                } else {
                  // do we have this apid yet?
                  const ctInfo = ctidSet.get(ctid)
                  if (ctInfo && !ctInfo.apids.includes(k)) {
                    ctInfo.apids.push(k)
                  }
                }
              })
            })
          }
        }),
      )
    }

    let apids: PickItem[] = []
    apidSet.forEach((desc, apid) => {
      let a = new PickItem(apid)
      a.description = desc
      apids.push(a)
    })
    apids.sort((a, b) => {
      return a.name.localeCompare(b.name)
    })

    // setp 3 ctids:
    let ctids: PickItem[] = []
    ctidSet.forEach((cI, ctid) => {
      let a = new PickItem(ctid)
      a.description = `${cI.desc} @${cI.apids.join(' and ')}`
      a.data = { apids: cI.apids }
      ctids.push(a)
    })
    ctids.sort((a, b) => {
      return a.name.localeCompare(b.name)
    })

    const filterTypesByNumber = new Map<number, string>([
      [0, 'POSITIVE'],
      [1, 'NEGATIVE'],
      [2, 'MARKER'],
      [3, 'EVENT'],
    ])
    const filterTypesByName = new Map<string, number>([
      ['POSITIVE', 0],
      ['NEGATIVE', 1],
      ['MARKER', 2],
    ])

    let colorItems: PickItem[] = []
    try {
      // colors is an objecct with e.g. "blue":[0,0,255]
      Object.keys(colors).forEach((value) => colorItems.push(new PickItem(value)))
    } catch (err) {
      console.error(`colors got err=${err}`)
    }

    let configItems: PickItem[] = []
    const addConfig = (node: ConfigNode, prefix: string) => {
      if (node.label.length > 0) {
        // skip the ones without label
        configItems.push(new PickItem(prefix + node.label))

        node.children.forEach((c) => {
          if (c instanceof ConfigNode) {
            addConfig(c, prefix + node.label + '/')
          }
        })
      }
    }

    if ('configTreeNode' in doc) {
      const dDoc: DltDocument = doc as DltDocument
      dDoc.configTreeNode.children.forEach((node) => {
        if (node instanceof ConfigNode) {
          addConfig(node, '')
        }
      })
    }

    let stepInput = new MultiStepInput(
      `${isAdd ? 'add' : 'edit'} filter...`,
      [
        {
          title: `filter on ECU?`,
          items: ecus,
          initialValue: () => {
            return newFilter.ecu instanceof RegExp ? newFilter.ecu.source : newFilter.ecu
          },
          placeholder: 'enter or select the ECU to filter (if any)',
          onValue: (v) => {
            newFilter.ecu = onValueChar4OrRegex(newFilter.ecu, v)
          },
          isValid: (v) => v.length <= 4 || util.containsRegexChars(v),
        },
        {
          title: `filter on APID?`,
          items: apids,
          initialValue: () => {
            return newFilter.apid instanceof RegExp ? newFilter.apid.source : newFilter.apid
          },
          onValue: (v) => {
            newFilter.apid = onValueChar4OrRegex(newFilter.apid, v)
          },
          isValid: (v) => v.length <= 4 || util.containsRegexChars(v),
        },
        {
          title: `filter on CTID?`,
          items: () =>
            ctids.filter((v) => {
              return ctidFilter(newFilter.apid, v.data.apids)
            }),
          initialValue: () => {
            return newFilter.ctid instanceof RegExp ? newFilter.ctid.source : newFilter.ctid
          },
          onValue: (v) => {
            newFilter.ctid = onValueChar4OrRegex(newFilter.ctid, v)
          },
          isValid: (v) => v.length <= 4 || util.containsRegexChars(v),
        },
        {
          title: `filter on payload?`,
          items: optArgs !== undefined && optArgs.payload !== undefined ? [new PickItem(optArgs.payload)] : [],
          initialValue: () => {
            return newFilter.payload
          },
          onValue: (v) => {
            newFilter.payload = v.length ? v : undefined
          },
        },
        {
          title: `filter on payloadRegex?`,
          items: optArgs !== undefined && optArgs.payload !== undefined ? [new PickItem(optArgs.payload)] : [],
          initialValue: () => {
            return newFilter.payloadRegex?.source
          },
          onValue: (v) => {
            newFilter.payloadRegex = v.length ? new RegExp(v) : undefined
          },
          isValid: (v) => {
            try {
              let r = new RegExp(v)
              return true
            } catch (err) {
              return false
            }
          },
        },
        {
          title: `filter type?`,
          items: [
            new PickItem(filterTypesByNumber.get(0)!),
            new PickItem(filterTypesByNumber.get(1)!),
            new PickItem(filterTypesByNumber.get(2)!),
          ],
          initialValue: () => {
            return filterTypesByNumber.get(newFilter.type)
          },
          onValue: (v) => {
            let t = filterTypesByName.get(v)
            if (t !== undefined) {
              newFilter.type = t
            }
          },
          isValid: (v) => filterTypesByName.has(v),
        },
        {
          title: `choose marker colour`,
          items: colorItems,
          initialValue: () => {
            return typeof newFilter.filterColour === 'object' ? JSON.stringify(newFilter.filterColour) : newFilter.filterColour
          },
          onValue: (v) => {
            /* can parse to Object? */ let o = undefined
            try {
              o = JSON.parse(v)
              if (typeof o !== 'object') {
                o = undefined
              }
            } catch (e) {}
            newFilter.filterColour = o !== undefined ? o : v.length ? v : 'blue'
          },
          isValid: (v) => {
            return (colors as any)[v] !== undefined
          },
          skipStep: () => newFilter.type !== DltFilterType.MARKER,
        }, // todo add hex codes support and proper support for filterColour as object!
        {
          title: `optional name?`,
          items: [],
          initialValue: () => {
            return newFilter.filterName
          },
          onValue: (v) => {
            newFilter.filterName = v.length ? v : undefined
          },
        },
        newFilter.atLoadTime
          ? undefined
          : {
              // statically skip this step
              iconPath: isAdd ? 'add' : 'edit',
              title: `select/enter configs (multiple separated by ',')`,
              items: configItems,
              initialValue: () => {
                return newFilter.configs.join(',')
              },
              onValue: (v) => {
                newFilter.configs = v.length > 0 ? v.split(',') : []
                console.log(`set configs to ${JSON.stringify(newFilter.configs)}`)
              },
              isValid: (v) => {
                if (v.length === 0) {
                  return true
                }
                return v
                  .split(',')
                  .map((v) => v.length > 0 && !v.endsWith('/') && !v.startsWith('/'))
                  .reduce((prev, cur) => (cur ? prev : false), true)
              },
            }, // todo add support for steps with canSelectMany:true...
      ],
      { canSelectMany: false },
    )
    stepInput
      .run()
      .then(() => {
        updateFilterConfig(doc, newFilter, isAdd)
      })
      .catch((err) => {
        console.log(`dlt-log.editFilter input cancelled...`)
      })
  })
}

function ctidFilter(apid: string | RegExp | undefined, apids: string[]): boolean {
  if (apid === undefined) {
    return true // no apid -> all ctids
  }
  if (apid instanceof RegExp) {
    return apids.some((a) => apid.test(a))
  } else {
    return apids.includes(apid)
  }
}

function onValueChar4OrRegex(oldValue: string | RegExp | undefined, newValue: string): string | RegExp | undefined {
  if (newValue.length) {
    const oldWasRegEx = oldValue instanceof RegExp
    const lastValue = oldWasRegEx ? (oldValue as RegExp).source : oldValue
    if (newValue === lastValue) {
      return oldValue // we keep the type
    } else {
      return util.containsRegexChars(newValue) ? new RegExp(newValue) : newValue
    }
  } else {
    return undefined
  }
}

// from npm color-names: (import of 2.0 module does export as single elements and not as one object with all keys)
const colors = {
  aliceblue: [240, 248, 255],
  antiquewhite: [250, 235, 215],
  aqua: [0, 255, 255],
  aquamarine: [127, 255, 212],
  azure: [240, 255, 255],
  beige: [245, 245, 220],
  bisque: [255, 228, 196],
  black: [0, 0, 0],
  blanchedalmond: [255, 235, 205],
  blue: [0, 0, 255],
  blueviolet: [138, 43, 226],
  brown: [165, 42, 42],
  burlywood: [222, 184, 135],
  cadetblue: [95, 158, 160],
  chartreuse: [127, 255, 0],
  chocolate: [210, 105, 30],
  coral: [255, 127, 80],
  cornflowerblue: [100, 149, 237],
  cornsilk: [255, 248, 220],
  crimson: [220, 20, 60],
  cyan: [0, 255, 255],
  darkblue: [0, 0, 139],
  darkcyan: [0, 139, 139],
  darkgoldenrod: [184, 134, 11],
  darkgray: [169, 169, 169],
  darkgreen: [0, 100, 0],
  darkgrey: [169, 169, 169],
  darkkhaki: [189, 183, 107],
  darkmagenta: [139, 0, 139],
  darkolivegreen: [85, 107, 47],
  darkorange: [255, 140, 0],
  darkorchid: [153, 50, 204],
  darkred: [139, 0, 0],
  darksalmon: [233, 150, 122],
  darkseagreen: [143, 188, 143],
  darkslateblue: [72, 61, 139],
  darkslategray: [47, 79, 79],
  darkslategrey: [47, 79, 79],
  darkturquoise: [0, 206, 209],
  darkviolet: [148, 0, 211],
  deeppink: [255, 20, 147],
  deepskyblue: [0, 191, 255],
  dimgray: [105, 105, 105],
  dimgrey: [105, 105, 105],
  dodgerblue: [30, 144, 255],
  firebrick: [178, 34, 34],
  floralwhite: [255, 250, 240],
  forestgreen: [34, 139, 34],
  fuchsia: [255, 0, 255],
  gainsboro: [220, 220, 220],
  ghostwhite: [248, 248, 255],
  gold: [255, 215, 0],
  goldenrod: [218, 165, 32],
  gray: [128, 128, 128],
  green: [0, 128, 0],
  greenyellow: [173, 255, 47],
  grey: [128, 128, 128],
  honeydew: [240, 255, 240],
  hotpink: [255, 105, 180],
  indianred: [205, 92, 92],
  indigo: [75, 0, 130],
  ivory: [255, 255, 240],
  khaki: [240, 230, 140],
  lavender: [230, 230, 250],
  lavenderblush: [255, 240, 245],
  lawngreen: [124, 252, 0],
  lemonchiffon: [255, 250, 205],
  lightblue: [173, 216, 230],
  lightcoral: [240, 128, 128],
  lightcyan: [224, 255, 255],
  lightgoldenrodyellow: [250, 250, 210],
  lightgray: [211, 211, 211],
  lightgreen: [144, 238, 144],
  lightgrey: [211, 211, 211],
  lightpink: [255, 182, 193],
  lightsalmon: [255, 160, 122],
  lightseagreen: [32, 178, 170],
  lightskyblue: [135, 206, 250],
  lightslategray: [119, 136, 153],
  lightslategrey: [119, 136, 153],
  lightsteelblue: [176, 196, 222],
  lightyellow: [255, 255, 224],
  lime: [0, 255, 0],
  limegreen: [50, 205, 50],
  linen: [250, 240, 230],
  magenta: [255, 0, 255],
  maroon: [128, 0, 0],
  mediumaquamarine: [102, 205, 170],
  mediumblue: [0, 0, 205],
  mediumorchid: [186, 85, 211],
  mediumpurple: [147, 112, 219],
  mediumseagreen: [60, 179, 113],
  mediumslateblue: [123, 104, 238],
  mediumspringgreen: [0, 250, 154],
  mediumturquoise: [72, 209, 204],
  mediumvioletred: [199, 21, 133],
  midnightblue: [25, 25, 112],
  mintcream: [245, 255, 250],
  mistyrose: [255, 228, 225],
  moccasin: [255, 228, 181],
  navajowhite: [255, 222, 173],
  navy: [0, 0, 128],
  oldlace: [253, 245, 230],
  olive: [128, 128, 0],
  olivedrab: [107, 142, 35],
  orange: [255, 165, 0],
  orangered: [255, 69, 0],
  orchid: [218, 112, 214],
  palegoldenrod: [238, 232, 170],
  palegreen: [152, 251, 152],
  paleturquoise: [175, 238, 238],
  palevioletred: [219, 112, 147],
  papayawhip: [255, 239, 213],
  peachpuff: [255, 218, 185],
  peru: [205, 133, 63],
  pink: [255, 192, 203],
  plum: [221, 160, 221],
  powderblue: [176, 224, 230],
  purple: [128, 0, 128],
  rebeccapurple: [102, 51, 153],
  red: [255, 0, 0],
  rosybrown: [188, 143, 143],
  royalblue: [65, 105, 225],
  saddlebrown: [139, 69, 19],
  salmon: [250, 128, 114],
  sandybrown: [244, 164, 96],
  seagreen: [46, 139, 87],
  seashell: [255, 245, 238],
  sienna: [160, 82, 45],
  silver: [192, 192, 192],
  skyblue: [135, 206, 235],
  slateblue: [106, 90, 205],
  slategray: [112, 128, 144],
  slategrey: [112, 128, 144],
  snow: [255, 250, 250],
  springgreen: [0, 255, 127],
  steelblue: [70, 130, 180],
  tan: [210, 180, 140],
  teal: [0, 128, 128],
  thistle: [216, 191, 216],
  tomato: [255, 99, 71],
  turquoise: [64, 224, 208],
  violet: [238, 130, 238],
  wheat: [245, 222, 179],
  white: [255, 255, 255],
  whitesmoke: [245, 245, 245],
  yellow: [255, 255, 0],
  yellowgreen: [154, 205, 50],
}
