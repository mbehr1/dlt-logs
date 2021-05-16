/* --------------------
 * Copyright(C) Matthias Behr. 2021
 *
 * loader for ASAM MCD-2 NET (aka Fibex) based files.
 *
 * todos:
 * - implement sequence-number checks/sorts
 */

import * as fastXmlParser from 'fast-xml-parser';
import * as fs from 'fs';
import * as path from 'path';

export type Service = {
    sid: number,
    shortName: string,
    desc?: any,
    version?: any,

    methods: Map<number, Method>
};

export type Coding = {
    id: string,
    shortName: string,
    codedType: any,
    orig?: any
};

type Enum = {
    synonym: string,
    desc?: string
};

export type Datatype = {
    id: string,
    shortName: string,
    codingRef?: string,
    enums?: Map<number, Enum>,
    complexStructMembers?: any[],
    complexUnionMembers?: any[],
    orig?: any
};

export type ArrayInfo = {
    dim: number,
    minSize?: number,
    maxSize?: number
};

export type Parameter = {
    pos?: number,
    shortName: string,
    datatype?: string,
    array?: ArrayInfo
};

export type Method = {
    mid: number,
    shortName: string,
    desc?: any,
    inputParams?: Parameter[],
    returnParams?: Parameter[],
    datatype?: string,
    array?: ArrayInfo,
    fieldName?: string,
    orig?: any
};

export type Frame = {
    id: string,
    type?: string,
    byteLength?: number,
    shortName: string,
    pdus: Pdu[],
    manufacturerExt?: any,
    orig?: any
};

export type Pdu = {
    id: string,
    shortName?: string,
    desc?: string,
    byteLength?: number,
    signalRefs?: string[],
    orig?: any
};

export class FibexLoader {
    private static _codings: Map<string, Coding> = new Map();
    private static _datatypes: Map<string, Datatype> = new Map();
    private static _services: Map<number, Service> = new Map();
    private static _frames: Map<string, Frame> = new Map();
    private static _framesWithKey: Map<string, Frame> = new Map();
    private static _pdus: Map<string, Pdu> = new Map();
    private static _loadedFibex: string[] = [];


    /**
     * Load all fibex files from a directory.
     * If options.clearFirst is not set the files will be added.
     * @param fibexDir directory where to load all fibex files from
     * @param options clearFirst: determines whether before loading the dir all current entries are removed.
     */
    static loadAllFibex(fibexDir: string, options?: { clearFirst: boolean }) {
        if (options && options.clearFirst) {
            FibexLoader._codings.clear();
            FibexLoader._datatypes.clear();
            FibexLoader._services.clear();
            FibexLoader._frames.clear();
            FibexLoader._framesWithKey.clear();
            FibexLoader._pdus.clear();
            FibexLoader._loadedFibex = [];
        }
        try {
            const dir = fs.readdirSync(fibexDir);
            // we sort the dir descending to have the latest file being processed first:
            dir.sort((a, b) => b.localeCompare(a));

            dir.forEach(file => {
                if (path.extname(file).toLowerCase() === ".xml") {
                    const fileName = path.join(fibexDir, file);
                    if (!this._loadedFibex.includes(fileName)) {
                        FibexLoader.loadFibex(fileName);
                    }
                }
            });
        }
        catch (e) {
            console.warn(`FibexLoader.loadAllFibex(${fibexDir}) for err=${e}`);
        }
    }

    static loadFibex(fibex: string) {
        if (!FibexLoader._loadedFibex.includes(fibex)) {
            try {
                console.log(`FibexLoader.loadFibex(${fibex})'`);
                const xmlData = fs.readFileSync(fibex, { encoding: 'utf8' });
                const fibexJson = fastXmlParser.parse(xmlData, {
                    ignoreAttributes: false, arrayMode: (m) => {
                        switch (m) {
                            case 'fx:PDU':
                            case 'fx:PDU-INSTANCE':
                            case 'fx:FRAME':
                            case 'fx:SERVICE-INTERFACE':
                            case 'fx:SIGNAL-INSTANCE':
                            case 'fx:SWITCHED-PDU-INSTANCE':
                            case 'fx:CODING':
                            case 'fx:CHANNEL':
                            case 'fx:FRAME-TRIGGERING':
                                return true;
                            default:
                                return false;
                        }
                    }
                });
                console.log(` got fibexJson[fx:FIBEX].keys='${Object.keys(fibexJson['fx:FIBEX'])}'`);
                // we do need "PROCESSING-INFORMATION"/UNIT_SPEC/UNITS /CODINGS /VARIANTS

                // list all service interfaces:
                console.log(` got fibexJson[fx:FIBEX][fx:ELEMENTS].keys='${Object.keys(fibexJson['fx:FIBEX']['fx:ELEMENTS'])}'`);
                try {
                    this.parseFibexCodings(fibexJson['fx:FIBEX']['fx:PROCESSING-INFORMATION']['fx:CODINGS']['fx:CODING']);
                    this.parseFibexDatatypes(fibexJson['fx:FIBEX']['fx:ELEMENTS']['fx:DATATYPES']['fx:DATATYPE']);
                } catch (err) {
                    console.warn(`FibexLoader parseCodings or Datatypes got err='${err}'`);
                }

                try {
                    this.parseFibexPdus(fibexJson['fx:FIBEX']['fx:ELEMENTS']['fx:PDUS']['fx:PDU']);
                } catch (err) {
                    console.warn(`FibexLoader loading pdus got err='${err}'`);
                }

                try {
                    const services = fibexJson['fx:FIBEX']['fx:ELEMENTS']['fx:SERVICE-INTERFACES']['fx:SERVICE-INTERFACE'];
                    this.parseFibexServices(services);
                } catch (err) {
                    console.warn(`FibexLoader.loadFibex(${fibex}) loading services got err='${err}'`);
                }

                try {
                    const frames = fibexJson['fx:FIBEX']['fx:ELEMENTS']['fx:FRAMES']['fx:FRAME'];
                    this.parseFibexFrames(frames);
                } catch (err) {
                    console.warn(`FibexLoader.loadFibex(${fibex}) loading frames got err='${err}'`);
                }

            } catch (err) {
                console.warn(`FibexLoader.loadFibex(${fibex}) got err='${err}'`);
            }
            // we add it in any case. even if errors occurred to avoid retrying constantly
            FibexLoader._loadedFibex.push(fibex);
        }
    }

    private static parseFibexCodings(codings: any) {
        const codingsArr = Array.isArray(codings) ? codings : [codings];
        for (let i = 0; i < codingsArr.length; ++i) {
            const codingObj = codingsArr[i];
            //console.warn(`FibexLoader.parseCodings got:'${JSON.stringify(codingObj)}'`);
            try {
                const coding: Coding = {
                    id: codingObj['@_ID'],
                    shortName: codingObj['ho:SHORT-NAME'],
                    codedType: codingObj['ho:CODED-TYPE'],
                    // orig: codingObj // todo only for debugging
                };
                if (FibexLoader._codings.has(coding.id)) {
                    // console.warn(`FibexLoader.parseFibexCodings have:'${JSON.stringify(codingObj)}' already`);
                    // todo any check whether it's similar?
                } else {
                    FibexLoader._codings.set(coding.id, coding);
                }
            } catch (e) {
                console.warn(`FibexLoader.parseFibexCodings got err '${e}' parsing '${JSON.stringify(codingObj)}'!`);
            }
        }
    }

    private static parseFibexServices(serviceInterfaces: any[]) {
        console.warn(`FibexLoader.parseFibexServices got ${serviceInterfaces.length} services`);
        for (let i = 0; i < serviceInterfaces.length; ++i) {
            const serviceInterface = serviceInterfaces[i];
            try {
                const methods = new Map<number, Method>();
                FibexLoader.parseFibexMethods(serviceInterface['service:METHODS'], methods);
                const fibexEvents = serviceInterface['service:EVENTS'];
                if (fibexEvents) {
                    let events = fibexEvents['service:EVENT'];
                    if (events) {
                        if (!Array.isArray(events)) { events = [events]; }
                        // parse service:EVENTS like methods
                        FibexLoader.parseFibexMethods(events, methods);
                    }
                }
                FibexLoader.parseFibexFields(serviceInterface['service:FIELDS'], methods);
                const service: Service = {
                    shortName: serviceInterface['ho:SHORT-NAME'],
                    sid: Number(serviceInterface['fx:SERVICE-IDENTIFIER']),
                    desc: serviceInterface['ho:DESC'],
                    version: serviceInterface['service:API-VERSION'],
                    methods: methods
                };
                if (FibexLoader._services.has(service.sid)) {
                    console.warn(` got sid already: ${service.sid.toString(16)}: ${JSON.stringify(service)} `);
                } else {
                    FibexLoader._services.set(service.sid, service);
                }
            } catch (e) {
                console.warn(`parseFibexService: couldn't parse '${JSON.stringify(serviceInterface)} ' due to '${e} '`);
            }
        }
    }

    private static parseFibexPdus(xmlPdus: any[]) {
        console.log(`FibexLoader.parseFibexPdus got ${xmlPdus.length} pdus`);
        for (let i = 0; i < xmlPdus.length; ++i) {
            const xmlPdu = xmlPdus[i];
            try {
                const signalRefs: undefined | string[] = xmlPdu?.['fx:SIGNAL-INSTANCES']?.['fx:SIGNAL-INSTANCE'].map((xSig: any) => {
                    const pduRef = xSig['fx:SIGNAL-REF']?.['@_ID-REF'];
                    // todo handle fx:SEQUENCE-NUMBER
                    return typeof pduRef === 'string' ? pduRef : 'unknown';
                });

                const pdu: Pdu = {
                    id: xmlPdu['@_ID'] || 'no id',
                    shortName: xmlPdu['ho:SHORT-NAME'],
                    byteLength: xmlPdu['fx:BYTE-LENGTH'],
                    desc: xmlPdu['ho:DESC'],
                    signalRefs: signalRefs,
                    orig: xmlPdu
                };
                if (FibexLoader._pdus.has(pdu.id)) {
                    console.warn(` got pdu already: ${pdu.id}: ${JSON.stringify(pdu)}`);
                } else {
                    FibexLoader._pdus.set(pdu.id, pdu);
                }
            } catch (e) {
                console.warn(`parseFibexPdu: couldn't parse '${JSON.stringify(xmlPdu)}' due to '${e} '`);
            }
        }
    }

    private static parseFibexFrames(xmlFrames: any[]) {
        console.log(`FibexLoader.parseFibexFrames got ${xmlFrames.length} frames`);
        for (let i = 0; i < xmlFrames.length; ++i) {
            const xmlFrame = xmlFrames[i];
            try {
                // todo sort by fx:SEQUENCE-NUMBER
                const pdus = xmlFrame?.['fx:PDU-INSTANCES']?.['fx:PDU-INSTANCE']?.map((xPdu: any) => {
                    const pduRef = xPdu['fx:PDU-REF']['@_ID-REF'];
                    // find the pdu
                    return FibexLoader._pdus.get(pduRef);
                }) || [];

                const frame: Frame = {
                    id: xmlFrame['@_ID'] || 'no id',
                    byteLength: xmlFrame['fx:BYTE-LENGTH'],
                    shortName: xmlFrame['ho:SHORT-NAME'],
                    pdus: pdus,
                    manufacturerExt: xmlFrame['fx:MANUFACTURER-EXTENSION'],
                    orig: xmlFrame
                };
                // this is not really generic... but maintain a 2nd map as well:
                const apid = frame.manufacturerExt ? frame.manufacturerExt.APPLICATION_ID : undefined;
                const ctid = frame.manufacturerExt ? frame.manufacturerExt.CONTEXT_ID : undefined;
                const key = `${frame.id},${apid},${ctid}`;

                if (FibexLoader._frames.has(frame.id)) {
                    if (FibexLoader._framesWithKey.has(key)) {
                        console.warn(` got frame already, skipping: ${frame.id}: ${JSON.stringify(frame)}`);
                    } else {
                        FibexLoader._framesWithKey.set(key, frame);
                        // logically we should set the _frames for the one which has no
                        // apid, ctid
                        // so that for multiple frames with same id frames contains the one
                        // without apid/ctid:
                        if (apid === undefined && ctid === undefined) {
                            FibexLoader._frames.set(frame.id, frame);
                        }
                    }
                } else {
                    FibexLoader._frames.set(frame.id, frame);
                    FibexLoader._framesWithKey.set(key, frame);
                }
            } catch (e) {
                console.warn(`parseFibexFrames: couldn't parse '${JSON.stringify(xmlFrame)}' due to '${e}'`);
            }
        }
    }


    private static parseFibexDatatypes(datatypes: any) {
        const datatypesArr = Array.isArray(datatypes) ? datatypes : [datatypes];
        const typedefs: [string, string][] = [];
        for (let i = 0; i < datatypesArr.length; ++i) {
            const datatypeObj = datatypesArr[i];
            //console.warn(`FibexLoader.parseFibexDatatypes got:'${JSON.stringify(datatypeObj)}'`);
            try {
                // complex datatype?
                let members = undefined;
                let isUnion = false;
                if ("fx:COMPLEX-DATATYPE-CLASS" in datatypeObj) {
                    switch (datatypeObj["fx:COMPLEX-DATATYPE-CLASS"]) {
                        case 'UNION':
                            isUnion = true;
                        // fallthrough
                        case 'TYPEDEF':
                            // if the typedef consists just of one member we do use that.
                            // if the single member is an array or
                            // if it consist of multiple we treat it like a structure:
                            members = datatypeObj['fx:MEMBERS']['fx:MEMBER'];
                            if (!Array.isArray(members) || members.length === 1) {
                                // if it's an array declaration we can't link:
                                const member = Array.isArray(members) ? members[0] : members;
                                const isArrayDecl = ('fx:ARRAY-DECLARATION' in member);
                                if (!isArrayDecl) {
                                    typedefs.push([datatypeObj['@_ID'], member['fx:DATATYPE-REF']['@_ID-REF']]);
                                    // will be created now but then overwritten as a link...
                                } else {
                                    if (!Array.isArray(members)) {
                                        members = [members]; // ensure that members is always an array
                                    }
                                }
                                break;
                            } // else fallthrough
                        case 'STRUCTURE':
                            // "fx:MEMBERS":{"fx:MEMBER"
                            members = datatypeObj['fx:MEMBERS']['fx:MEMBER'];
                            if (Array.isArray(members)) {
                                members.sort((a, b) => (a['fx:POSITION'] || -1) - (b['fx:POSITION'] || -1)); // should keep the order if fx:POSITION not available
                            } else { members = [members]; }
                            break;
                        default:
                            console.warn(`FibexLoader.parseFibexDatatypes unknown complex-datatype-class:'${datatypeObj["fx:COMPLEX-DATATYPE-CLASS"]}: ${JSON.stringify(datatypeObj, undefined, 2)}`);
                            break;
                    }
                }

                let enums: Map<number, Enum> | undefined;
                if ('fx:ENUMERATION-ELEMENTS' in datatypeObj) {
                    let enumsObj = datatypeObj['fx:ENUMERATION-ELEMENTS']['fx:ENUM-ELEMENT'];
                    //console.warn(`FibexLoader.parseFibexDatatypes got enumsObj = ${JSON.stringify(enumsObj)}`);
                    if (!Array.isArray(enumsObj) && 'fx:VALUE' in enumsObj) {
                        enumsObj = [enumsObj]; // single element
                    }
                    if (Array.isArray(enumsObj)) {
                        // fx:VALUE, fx:SYNONYM, ho:DESC
                        enums = new Map(enumsObj.map(e => [e['fx:VALUE'], { synonym: e['fx:SYNONYM'] || `SYNONYM missing for ${e['fx:VALUE']}`, desc: e['fx:DESC'] }]));
                    } else {
                        console.warn(`FibexLoader.parseFibexDatatypes got no Array enumsObj = ${JSON.stringify(enumsObj)}`);
                    }
                }

                const datatype: Datatype = {
                    id: datatypeObj['@_ID'],
                    shortName: datatypeObj['ho:SHORT-NAME'],
                    complexStructMembers: !isUnion ? members : undefined,
                    complexUnionMembers: isUnion ? members : undefined,
                    codingRef: 'fx:CODING-REF' in datatypeObj ? datatypeObj['fx:CODING-REF']['@_ID-REF'] : undefined,
                    enums: enums,
                    // orig: datatypeObj
                };
                if (FibexLoader._datatypes.has(datatype.id)) {
                    //console.warn(`FibexLoader.parseFibexDatatypes have '${datatype.id}' already!`);
                    // todo any check whether it's similar?
                } else {
                    FibexLoader._datatypes.set(datatype.id, datatype);
                }
            } catch (e) {
                console.warn(`FibexLoader.parseFibexDatatypes got err '${e}' parsing '${JSON.stringify(datatypeObj)}'!`);
            }
        }
        // process typedefs:
        for (let i = 0; i < typedefs.length; ++i) {
            const [id, typeId] = typedefs[i];
            const typeObj = FibexLoader._datatypes.get(typeId);
            if (!typeObj) {
                console.warn(`FibexLoader.parseFibexDatatypes can't find DATATYPE-REF ${typeId} for ${id}`);
            } else {
                const datatype = { ...typeObj };
                // shall we change id and or shortName?
                // for now just link directly: (overwriting the prev. one)
                FibexLoader._datatypes.set(id, datatype);
            }
        }
    }

    static addMethod(methods: Map<number, Method>, method: Method) {
        if (methods.has(method.mid)) {
            console.warn(` got mid already: ${method.mid.toString(16)}: ${JSON.stringify(method)} `);
        } else {
            //console.warn(` adding Method: ${ method.mid.toString(16) } '${method.shortName} ' with ${ method.inputParams?.length } inputParams and ${ method.returnParams?.length } return params`);
            methods.set(method.mid, method);
        }
    }

    static parseFibexParams(params: any): Parameter[] | undefined {
        const paramsArr = Array.isArray(params) ? params : [params];
        if (paramsArr.length) {
            const toRet: Parameter[] = [];
            let needsSort = false;
            try {
                for (let i = 0; i < paramsArr.length; ++i) {
                    const param = paramsArr[i];
                    // is it an array?
                    let arrayInfo = undefined;
                    if ('fx:ARRAY-DECLARATION' in param) {
                        const arrayDecl = param['fx:ARRAY-DECLARATION'];
                        const arrayDim = arrayDecl['fx:ARRAY-DIMENSION'];
                        arrayInfo = {
                            dim: arrayDim !== undefined ? arrayDim['fx:DIMENSION'] || 1 : 1,
                            minSize: arrayDim !== undefined ? arrayDim['fx:MINIMUM-SIZE'] : undefined,
                            maxSize: arrayDim !== undefined ? arrayDim['fx:MAXIMUM-SIZE'] : undefined
                        };
                    }
                    const newParam = {
                        shortName: param['ho:SHORT-NAME'],
                        pos: param['service:POSITION'],
                        datatype: param['fx:DATATYPE-REF']['@_ID-REF'],
                        array: arrayInfo /*, orig: param*/
                    };
                    if (newParam.pos && newParam.pos >= 0) { needsSort = true; }
                    toRet.push(newParam);
                }
            } catch (e) {
                console.warn(`FibexLoader.parseParams got '${e}' parsing ${JSON.stringify(params)} `);
            }
            if (needsSort) {
                toRet.sort((a, b) => (a.pos || -1) - (b.pos || -1));
            }
            return toRet;
        }
        return undefined;
    }


    static parseFibexMethods(serviceMethods: any[] | undefined, methods: Map<number, Method>) {
        if (serviceMethods !== undefined) {
            let methodsArray = Array.isArray(serviceMethods) ? serviceMethods : serviceMethods['service:METHOD'];
            if (methodsArray !== undefined && !Array.isArray(methodsArray)) {
                methodsArray = [methodsArray]; // single method...
            }
            if (methodsArray === undefined) {
                console.warn(`FibexLoader.parseServices got no methods from ${serviceMethods} `);
                return methods;
            }

            for (let i = 0; i < methodsArray.length; ++i) {
                const serviceMethod = methodsArray[i];
                //console.warn(` serviceMethod = ${ JSON.stringify(serviceMethod) } `);
                try {
                    let inputParams: Parameter[] | undefined = undefined;
                    if ('service:INPUT-PARAMETERS' in serviceMethod) {
                        inputParams = FibexLoader.parseFibexParams(serviceMethod['service:INPUT-PARAMETERS']['service:INPUT-PARAMETER']);
                    }
                    let returnParams: Parameter[] | undefined = undefined;
                    if ('service:RETURN-PARAMETERS' in serviceMethod) {
                        returnParams = FibexLoader.parseFibexParams(serviceMethod['service:RETURN-PARAMETERS']['service:RETURN-PARAMETER']);
                    }
                    // if (!inputParams && !returnParams) console.warn(` serviceMethod wo Params = ${ JSON.stringify(serviceMethod) } `);
                    FibexLoader.addMethod(methods, { mid: Number(serviceMethod['service:METHOD-IDENTIFIER']), shortName: serviceMethod['ho:SHORT-NAME'], desc: serviceMethod['ho:DESC'], inputParams: inputParams, returnParams: returnParams });
                } catch (e) {
                    console.warn(`FibexLoader.parseMethods got error parsing method from ${JSON.stringify(serviceMethod)} `);
                }
            }
        }

        // todo mid 0 VIP_SUBSCRIBE_TO_BROADCAST ???
    }


    static parseFibexFields(serviceFields: any | any[] | undefined, methods: Map<number, Method>) {
        if (serviceFields !== undefined) {
            let fieldsArray = Array.isArray(serviceFields) ? serviceFields : serviceFields['service:FIELD'];
            if (fieldsArray !== undefined && !Array.isArray(fieldsArray)) {
                //console.warn(`FibexLoader.parseFields got no array from ${ JSON.stringify(serviceFields) } `);
                fieldsArray = [fieldsArray];
            }
            if (Array.isArray(fieldsArray)) {
                if (!fieldsArray.length) { console.warn(`FibexLoader.parseFibexFields got no fields from ${JSON.stringify(serviceFields)} `); }
                for (let i = 0; i < fieldsArray.length; ++i) {
                    const fieldObj = fieldsArray[i];
                    try {
                        //console.warn(` fieldObj = ${ JSON.stringify(fieldObj) } `);
                        const shortName = fieldObj['ho:SHORT-NAME'];
                        const datatype = fieldObj['fx:DATATYPE-REF']["@_ID-REF"];
                        // isArray?
                        let arrayInfo = undefined;
                        if ('fx:ARRAY-DECLARATION' in fieldObj) {
                            const arrayDecl = fieldObj['fx:ARRAY-DECLARATION'];
                            const arrayDim = arrayDecl['fx:ARRAY-DIMENSION'];
                            arrayInfo = {
                                dim: arrayDim !== undefined ? arrayDim['fx:DIMENSION'] || 1 : 1,
                                minSize: arrayDim !== undefined ? arrayDim['fx:MINIMUM-SIZE'] : undefined,
                                maxSize: arrayDim !== undefined ? arrayDim['fx:MAXIMUM-SIZE'] : undefined
                            };
                        }
                        const desc = fieldObj['ho:DESC'];

                        if ('service:GETTER' in fieldObj) {
                            const serviceMethod = fieldObj['service:GETTER'];
                            let inputParams: Parameter[] | undefined = undefined;
                            if ('service:INPUT-PARAMETERS' in serviceMethod) {
                                inputParams = FibexLoader.parseFibexParams(serviceMethod['service:INPUT-PARAMETERS']['service:INPUT-PARAMETER']);
                            }
                            let returnParams: Parameter[] | undefined = undefined;
                            if ('service:RETURN-PARAMETERS' in serviceMethod) {
                                returnParams = FibexLoader.parseFibexParams(serviceMethod['service:RETURN-PARAMETERS']['service:RETURN-PARAMETER']);
                            }
                            FibexLoader.addMethod(methods, { datatype: datatype, array: arrayInfo, mid: Number(serviceMethod['service:METHOD-IDENTIFIER']), shortName: `get_${shortName}_field`, desc: desc, fieldName: shortName, inputParams: inputParams, returnParams: returnParams });
                        }
                        if ('service:SETTER' in fieldObj) {
                            const serviceMethod = fieldObj['service:SETTER'];
                            let inputParams: Parameter[] | undefined = undefined;
                            if ('service:INPUT-PARAMETERS' in serviceMethod) {
                                inputParams = FibexLoader.parseFibexParams(serviceMethod['service:INPUT-PARAMETERS']['service:INPUT-PARAMETER']);
                            }
                            let returnParams: Parameter[] | undefined = undefined;
                            if ('service:RETURN-PARAMETERS' in serviceMethod) {
                                returnParams = FibexLoader.parseFibexParams(serviceMethod['service:RETURN-PARAMETERS']['service:RETURN-PARAMETER']);
                            }
                            FibexLoader.addMethod(methods, { datatype: datatype, array: arrayInfo, mid: Number(serviceMethod['service:METHOD-IDENTIFIER']), shortName: `set_${shortName}_field`, desc: desc, fieldName: shortName, inputParams: inputParams, returnParams: returnParams });
                        }
                        if ('service:NOTIFIER' in fieldObj) {
                            const serviceMethod = fieldObj['service:NOTIFIER'];
                            let inputParams: Parameter[] | undefined = undefined;
                            if ('service:INPUT-PARAMETERS' in serviceMethod) {
                                inputParams = FibexLoader.parseFibexParams(serviceMethod['service:INPUT-PARAMETERS']['service:INPUT-PARAMETER']);
                            }
                            let returnParams: Parameter[] | undefined = undefined;
                            if ('service:RETURN-PARAMETERS' in serviceMethod) {
                                returnParams = FibexLoader.parseFibexParams(serviceMethod['service:RETURN-PARAMETERS']['service:RETURN-PARAMETER']);
                            }
                            FibexLoader.addMethod(methods, { datatype: datatype, array: arrayInfo, /*orig: fieldObj,*/ mid: Number(serviceMethod['service:NOTIFICATION-IDENTIFIER']), shortName: `changed_${shortName}_field`, desc: desc, fieldName: shortName, inputParams: inputParams, returnParams: returnParams });
                        }
                    } catch (e) {
                        console.warn(`FibexLoader.parseFibexFields got error parsing field from ${JSON.stringify(fieldObj)} `);
                    }
                }
            }
        }
    }

    static get loadedFibex() { return FibexLoader._loadedFibex; }
    static get codings() { return FibexLoader._codings; }
    static get datatypes() { return FibexLoader._datatypes; }
    static get services() { return FibexLoader._services; }
    static get frames() { return FibexLoader._frames; }
    static get framesWithKey() { return FibexLoader._framesWithKey; }

}