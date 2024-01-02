// This file was auto-generated from Rust code by bincode-typescript v0.1.0
import { TextEncoder, TextDecoder } from 'util'

export type BinType =
  | { tag: 'FileInfo'; value: BinFileInfo }
  | { tag: 'Lifecycles'; value: Array<BinLifecycle> }
  | { tag: 'DltMsgs'; value: [number, Array<BinDltMsg>] }
  | { tag: 'EacInfo'; value: Array<BinEcuStats> }
  | { tag: 'PluginState'; value: Array<string> }
  | { tag: 'StreamInfo'; value: BinStreamInfo }

export module BinType {
  export const FileInfo = (value: BinFileInfo): BinType => ({ tag: 'FileInfo', value })
  export const Lifecycles = (value: Array<BinLifecycle>): BinType => ({ tag: 'Lifecycles', value })
  export const DltMsgs = (value: [number, Array<BinDltMsg>]): BinType => ({ tag: 'DltMsgs', value })
  export const EacInfo = (value: Array<BinEcuStats>): BinType => ({ tag: 'EacInfo', value })
  export const PluginState = (value: Array<string>): BinType => ({ tag: 'PluginState', value })
  export const StreamInfo = (value: BinStreamInfo): BinType => ({ tag: 'StreamInfo', value })
}

export function writeBinType(value: BinType, sinkOrBuf?: SinkOrBuf): Sink {
  const sink = Sink.create(sinkOrBuf)
  switch (value.tag) {
    case 'FileInfo':
      writeU32(0, sink)
      const val1 = value as { value: BinFileInfo }
      writeBinFileInfo(val1.value, sink)
      break
    case 'Lifecycles':
      writeU32(1, sink)
      const val2 = value as { value: Array<BinLifecycle> }
      writeSeq(writeBinLifecycle)(val2.value, sink)
      break
    case 'DltMsgs':
      writeU32(2, sink)
      const val3 = value as { value: [number, Array<BinDltMsg>] }
      writeTuple<[number, Array<BinDltMsg>]>(writeU32, writeSeq(writeBinDltMsg))(val3.value, sink)
      break
    case 'EacInfo':
      writeU32(3, sink)
      const val4 = value as { value: Array<BinEcuStats> }
      writeSeq(writeBinEcuStats)(val4.value, sink)
      break
    case 'PluginState':
      writeU32(4, sink)
      const val5 = value as { value: Array<string> }
      writeSeq(writeString)(val5.value, sink)
      break
    case 'StreamInfo':
      writeU32(5, sink)
      const val6 = value as { value: BinStreamInfo }
      writeBinStreamInfo(val6.value, sink)
      break
    default:
      throw new Error(`'${(value as any).tag}' is invalid tag for enum 'BinType'`)
  }

  return sink
}

export function readBinType(sinkOrBuf: SinkOrBuf): BinType {
  const sink = Sink.create(sinkOrBuf)
  const value = readU32(sink)
  switch (value) {
    case 0:
      return BinType.FileInfo(readBinFileInfo(sink))
    case 1:
      return BinType.Lifecycles(readSeq(readBinLifecycle)(sink))
    case 2:
      return BinType.DltMsgs(readTuple<[number, Array<BinDltMsg>]>(readU32, readSeq(readBinDltMsg))(sink))
    case 3:
      return BinType.EacInfo(readSeq(readBinEcuStats)(sink))
    case 4:
      return BinType.PluginState(readSeq(readString)(sink))
    case 5:
      return BinType.StreamInfo(readBinStreamInfo(sink))
    default:
      throw new Error(`'${value}' is invalid value for enum 'BinType'`)
  }
}

export interface BinLifecycle {
  id: number
  ecu: number
  nr_msgs: number
  start_time: bigint
  end_time: bigint
  sw_version: string | undefined
  resume_time: bigint | undefined
}

export function writeBinLifecycle(value: BinLifecycle, sinkOrBuf?: SinkOrBuf): Sink {
  const sink = Sink.create(sinkOrBuf)
  writeU32(value.id, sink)
  writeU32(value.ecu, sink)
  writeU32(value.nr_msgs, sink)
  writeU64(value.start_time, sink)
  writeU64(value.end_time, sink)
  writeOption(writeString)(value.sw_version, sink)
  writeOption(writeU64)(value.resume_time, sink)
  return sink
}

export function readBinLifecycle(sinkOrBuf: SinkOrBuf): BinLifecycle {
  const sink = Sink.create(sinkOrBuf)
  return {
    id: readU32(sink),
    ecu: readU32(sink),
    nr_msgs: readU32(sink),
    start_time: readU64(sink),
    end_time: readU64(sink),
    sw_version: readOption(readString)(sink),
    resume_time: readOption(readU64)(sink),
  }
}

export interface BinDltMsg {
  index: number
  reception_time: bigint
  timestamp_dms: number
  ecu: number
  apid: number
  ctid: number
  lifecycle_id: number
  htyp: number
  mcnt: number
  verb_mstp_mtin: number
  noar: number
  payload_as_text: string
}

export function writeBinDltMsg(value: BinDltMsg, sinkOrBuf?: SinkOrBuf): Sink {
  const sink = Sink.create(sinkOrBuf)
  writeU32(value.index, sink)
  writeU64(value.reception_time, sink)
  writeU32(value.timestamp_dms, sink)
  writeU32(value.ecu, sink)
  writeU32(value.apid, sink)
  writeU32(value.ctid, sink)
  writeU32(value.lifecycle_id, sink)
  writeU8(value.htyp, sink)
  writeU8(value.mcnt, sink)
  writeU8(value.verb_mstp_mtin, sink)
  writeU8(value.noar, sink)
  writeString(value.payload_as_text, sink)
  return sink
}

export function readBinDltMsg(sinkOrBuf: SinkOrBuf): BinDltMsg {
  const sink = Sink.create(sinkOrBuf)
  return {
    index: readU32(sink),
    reception_time: readU64(sink),
    timestamp_dms: readU32(sink),
    ecu: readU32(sink),
    apid: readU32(sink),
    ctid: readU32(sink),
    lifecycle_id: readU32(sink),
    htyp: readU8(sink),
    mcnt: readU8(sink),
    verb_mstp_mtin: readU8(sink),
    noar: readU8(sink),
    payload_as_text: readString(sink),
  }
}

export interface BinFileInfo {
  nr_msgs: number
}

export function writeBinFileInfo(value: BinFileInfo, sinkOrBuf?: SinkOrBuf): Sink {
  const sink = Sink.create(sinkOrBuf)
  writeU32(value.nr_msgs, sink)
  return sink
}

export function readBinFileInfo(sinkOrBuf: SinkOrBuf): BinFileInfo {
  const sink = Sink.create(sinkOrBuf)
  return {
    nr_msgs: readU32(sink),
  }
}

export interface BinEcuStats {
  ecu: number
  nr_msgs: number
  apids: Array<BinApidInfo>
}

export function writeBinEcuStats(value: BinEcuStats, sinkOrBuf?: SinkOrBuf): Sink {
  const sink = Sink.create(sinkOrBuf)
  writeU32(value.ecu, sink)
  writeU32(value.nr_msgs, sink)
  writeSeq(writeBinApidInfo)(value.apids, sink)
  return sink
}

export function readBinEcuStats(sinkOrBuf: SinkOrBuf): BinEcuStats {
  const sink = Sink.create(sinkOrBuf)
  return {
    ecu: readU32(sink),
    nr_msgs: readU32(sink),
    apids: readSeq(readBinApidInfo)(sink),
  }
}

export interface BinApidInfo {
  apid: number
  desc: string | undefined
  ctids: Array<BinCtidInfo>
}

export function writeBinApidInfo(value: BinApidInfo, sinkOrBuf?: SinkOrBuf): Sink {
  const sink = Sink.create(sinkOrBuf)
  writeU32(value.apid, sink)
  writeOption(writeString)(value.desc, sink)
  writeSeq(writeBinCtidInfo)(value.ctids, sink)
  return sink
}

export function readBinApidInfo(sinkOrBuf: SinkOrBuf): BinApidInfo {
  const sink = Sink.create(sinkOrBuf)
  return {
    apid: readU32(sink),
    desc: readOption(readString)(sink),
    ctids: readSeq(readBinCtidInfo)(sink),
  }
}

export interface BinCtidInfo {
  ctid: number
  nr_msgs: number
  desc: string | undefined
}

export function writeBinCtidInfo(value: BinCtidInfo, sinkOrBuf?: SinkOrBuf): Sink {
  const sink = Sink.create(sinkOrBuf)
  writeU32(value.ctid, sink)
  writeU32(value.nr_msgs, sink)
  writeOption(writeString)(value.desc, sink)
  return sink
}

export function readBinCtidInfo(sinkOrBuf: SinkOrBuf): BinCtidInfo {
  const sink = Sink.create(sinkOrBuf)
  return {
    ctid: readU32(sink),
    nr_msgs: readU32(sink),
    desc: readOption(readString)(sink),
  }
}

export interface BinStreamInfo {
  stream_id: number
  nr_stream_msgs: number
  nr_file_msgs_processed: number
  nr_file_msgs_total: number
}

export function writeBinStreamInfo(value: BinStreamInfo, sinkOrBuf?: SinkOrBuf): Sink {
  const sink = Sink.create(sinkOrBuf)
  writeU32(value.stream_id, sink)
  writeU32(value.nr_stream_msgs, sink)
  writeU32(value.nr_file_msgs_processed, sink)
  writeU32(value.nr_file_msgs_total, sink)
  return sink
}

export function readBinStreamInfo(sinkOrBuf: SinkOrBuf): BinStreamInfo {
  const sink = Sink.create(sinkOrBuf)
  return {
    stream_id: readU32(sink),
    nr_stream_msgs: readU32(sink),
    nr_file_msgs_processed: readU32(sink),
    nr_file_msgs_total: readU32(sink),
  }
}

type SinkOrBuf = Sink | ArrayBuffer | Uint8Array

export class Sink {
  public view: DataView
  public position: number

  private constructor(input: ArrayBuffer) {
    this.view = new DataView(input)
    this.position = 0
  }

  public reserve(extra: number): void {
    if (this.position + extra <= this.view.buffer.byteLength) {
      return
    }

    const newBuffer = new ArrayBuffer((this.view.buffer.byteLength + extra) * 2)
    new Uint8Array(newBuffer).set(new Uint8Array(this.view.buffer))
    this.view = new DataView(newBuffer)
  }

  public static create(input?: SinkOrBuf): Sink {
    if (input === undefined) {
      return new Sink(new ArrayBuffer(0))
    }

    if (input instanceof Sink) {
      return input
    }

    if (input instanceof ArrayBuffer) {
      return new Sink(input)
    }

    if (input instanceof Uint8Array) {
      return new Sink(input.buffer)
    }

    throw new Error(`'input' was of incorrect type. Expected 'Sink | ArrayBuffer | Uint8Array'`)
  }

  public getUint8Array(): Uint8Array {
    return new Uint8Array(this.view.buffer.slice(0, this.position))
  }
}

const BIG_32 = BigInt(32)
const BIG_64 = BigInt(64)
const BIG_32Fs = BigInt('4294967295')
const BIG_64Fs = BigInt('18446744073709551615')

const textEncoder: TextEncoder = new TextEncoder()
const textDecoder: TextDecoder = new TextDecoder()

function readU8(sink: Sink): number {
  const value = sink.view.getUint8(sink.position)
  sink.position += 1
  return value
}

function writeU8(value: number, sink: Sink): Sink {
  sink.reserve(1)
  sink.view.setUint8(sink.position, value)
  sink.position += 1
  return sink
}

function readI8(sink: Sink): number {
  const value = sink.view.getInt8(sink.position)
  sink.position += 1
  return value
}

function writeI8(value: number, sink: Sink): Sink {
  sink.reserve(1)
  sink.view.setInt8(sink.position, value)
  sink.position += 1
  return sink
}

function readU16(sink: Sink): number {
  const value = sink.view.getUint16(sink.position, true)
  sink.position += 2
  return value
}

function writeU16(value: number, sink: Sink): Sink {
  sink.reserve(2)
  sink.view.setUint16(sink.position, value, true)
  sink.position += 2
  return sink
}

function readI16(sink: Sink): number {
  const value = sink.view.getInt16(sink.position, true)
  sink.position += 2
  return value
}

function writeI16(value: number, sink: Sink): Sink {
  sink.reserve(2)
  sink.view.setInt16(sink.position, value, true)
  sink.position += 2
  return sink
}

function readU32(sink: Sink): number {
  const value = sink.view.getUint32(sink.position, true)
  sink.position += 4
  return value
}

function writeU32(value: number, sink: Sink): Sink {
  sink.reserve(4)
  sink.view.setUint32(sink.position, value, true)
  sink.position += 4
  return sink
}

function readI32(sink: Sink): number {
  const value = sink.view.getInt32(sink.position, true)
  sink.position += 4
  return value
}

function writeI32(value: number, sink: Sink): Sink {
  sink.reserve(4)
  sink.view.setInt32(sink.position, value, true)
  sink.position += 4
  return sink
}

function readF32(sink: Sink): number {
  const value = sink.view.getFloat32(sink.position, true)
  sink.position += 4
  return value
}

function writeF32(value: number, sink: Sink): Sink {
  sink.reserve(4)
  sink.view.setFloat32(sink.position, value, true)
  sink.position += 4
  return sink
}

function readF64(sink: Sink): number {
  const value = sink.view.getFloat64(sink.position, true)
  sink.position += 8
  return value
}

function writeF64(value: number, sink: Sink): Sink {
  sink.reserve(8)
  sink.view.setFloat64(sink.position, value, true)
  sink.position += 8
  return sink
}

function readU64(sink: Sink): bigint {
  const high = readU32(sink)
  const low = readU32(sink)

  return (BigInt(low) << BIG_32) | BigInt(high)
}

function writeU64(value: bigint, sink: Sink): Sink {
  const low = value & BIG_32Fs
  const high = value >> BIG_32

  writeU32(Number(low), sink)
  writeU32(Number(high), sink)
  return sink
}

function readI64(sink: Sink): bigint {
  const high = readI32(sink)
  const low = readI32(sink)

  return (BigInt(low) << BIG_32) | BigInt(high)
}

function writeI64(value: bigint, sink: Sink): Sink {
  const low = value & BIG_32Fs
  const high = value >> BIG_32

  writeI32(Number(low), sink)
  writeI32(Number(high), sink)
  return sink
}

function readUSize(sink: Sink): bigint {
  return readU64(sink)
}

function writeUSize(value: bigint, sink: Sink): Sink {
  writeU64(value, sink)
  return sink
}

function readISize(sink: Sink): bigint {
  return readI64(sink)
}

function writeISize(value: bigint, sink: Sink): Sink {
  writeI64(value, sink)
  return sink
}

function readU128(sink: Sink): bigint {
  const high = readU64(sink)
  const low = readU64(sink)

  return (low << BIG_64) | high
}

function writeU128(value: bigint, sink: Sink): Sink {
  const low = value & BIG_64Fs
  const high = value >> BIG_64

  writeU64(low, sink)
  writeU64(high, sink)
  return sink
}

function readI128(sink: Sink): bigint {
  const high = readI64(sink)
  const low = readI64(sink)

  return (low << BIG_64) | high
}

function writeI128(value: bigint, sink: Sink): Sink {
  const low = value & BIG_64Fs
  const high = value >> BIG_64

  writeI64(low, sink)
  writeI64(high, sink)
  return sink
}

function readBool(sink: Sink): boolean {
  return readU8(sink) === 1
}

function writeBool(value: boolean, sink: Sink): Sink {
  writeU8(value ? 1 : 0, sink)
  return sink
}

function writeBytes(value: Uint8Array, sink: Sink): Sink {
  sink.reserve(value.length + 1)
  new Uint8Array(sink.view.buffer, sink.position).set(value)
  sink.position += value.length
  return sink
}

function readBytes(sink: Sink, length: number): Uint8Array {
  const bytes = sink.view.buffer.slice(sink.position, sink.position + length)
  sink.position += length
  return new Uint8Array(bytes)
}

function writeString(value: string, sink: Sink): Sink {
  const bytes = textEncoder.encode(value)
  writeU64(BigInt(bytes.length), sink)
  writeBytes(bytes, sink)
  return sink
}

function readString(sink: Sink): string {
  const length = readU64(sink)
  const bytes = readBytes(sink, Number(length))
  return textDecoder.decode(bytes)
}

function writeOption<T>(writeFunc: (value: T, sink: Sink) => Sink): (value: T | undefined, sink: Sink) => Sink {
  return (value: T | undefined, sink: Sink) => {
    writeBool(value !== undefined, sink)

    if (value !== undefined) {
      writeFunc(value, sink)
    }

    return sink
  }
}

function readOption<T>(readFunc: (sink: Sink) => T): (sink: Sink) => T | undefined {
  return (sink: Sink) => {
    const some = readBool(sink)
    if (!some) {
      return undefined
    }

    return readFunc(sink)
  }
}

function writeSeq<T>(writeFunc: (value: T, sink: Sink) => Sink): (value: Array<T>, sink: Sink) => Sink {
  return (value: Array<T>, sink: Sink) => {
    writeU64(BigInt(value.length), sink)

    for (const each of value) {
      writeFunc(each, sink)
    }

    return sink
  }
}

function readSeq<T>(readFunc: (sink: Sink) => T): (sink: Sink) => Array<T> {
  return (sink: Sink) => {
    const length = readU64(sink)
    const output = new Array()

    for (var i = 0; i < length; i++) {
      output.push(readFunc(sink))
    }

    return output
  }
}

type TypedArray = ArrayLike<any> & {
  BYTES_PER_ELEMENT: number
  readonly length: number
  readonly buffer: ArrayBuffer
  readonly byteLength: number
  readonly byteOffset: number
}

type TypedArrayConstructor<T> = {
  new (buffer: ArrayBuffer, offset?: number, length?: number): T
  BYTES_PER_ELEMENT: number
}

function writeTypedArray<T extends TypedArray>(value: T, sink: Sink): Sink {
  writeU64(BigInt(value.length), sink)

  writeBytes(new Uint8Array(value.buffer.slice(value.byteOffset, value.byteLength)), sink)

  return sink
}

function readTypedArray<T extends TypedArray>(array_type: TypedArrayConstructor<T>): (sink: Sink) => T {
  return (sink: Sink) => {
    const length = readU64(sink)
    const bytes = readBytes(sink, Number(length) * array_type.BYTES_PER_ELEMENT)
    return new array_type(bytes.buffer, 0, Number(length))
  }
}

function writeMap<TK, TV>(
  writeKeyFunc: (value: TK, sink: Sink) => Sink,
  writeValueFunc: (value: TV, sink: Sink) => Sink,
): (value: Map<TK, TV>, sink: Sink) => Sink {
  return (value: Map<TK, TV>, sink: Sink) => {
    writeU64(BigInt(value.size), sink)

    value.forEach((v, k) => {
      writeKeyFunc(k, sink)
      writeValueFunc(v, sink)
    })

    return sink
  }
}

function readMap<TK, TV>(readKeyFunc: (sink: Sink) => TK, readValueFunc: (sink: Sink) => TV): (sink: Sink) => Map<TK, TV> {
  return (sink: Sink) => {
    const length = readU64(sink)
    const output = new Map()

    for (var i = 0; i < length; i++) {
      output.set(readKeyFunc(sink), readValueFunc(sink))
    }

    return output
  }
}

function writeTuple<T extends any[]>(...writeFns: Array<(value: any, sink: Sink) => Sink>): (value: T, sink: Sink) => Sink {
  return (value: T, sink: Sink) => {
    for (let i = 0; i < writeFns.length; i++) {
      writeFns[i](value[i], sink)
    }

    return sink
  }
}

function readTuple<T extends any[]>(...readFns: Array<(sink: Sink) => any>): (sink: Sink) => T {
  return (sink: Sink) => {
    const out = new Array()

    for (const readFn of readFns) {
      out.push(readFn(sink))
    }

    return out as T
  }
}
