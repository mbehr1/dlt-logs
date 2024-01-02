/* --------------------
 * Copyright(C) Matthias Behr. 2022
 */

var mocha = require('mocha')
var describe = mocha.describe
var it = mocha.it
import { expect } from 'chai'
import { generateRegex } from '../../generateRegex'

describe('generate regex', () => {
  it('should handle empty strings', () => {
    const r = generateRegex([])
    expect(r).to.be.empty
  })

  it('should handle single strings and add regex on numbers only', () => {
    const r = generateRegex(['foo 42.1 bar'])
    expect(r.length).to.equal(1)
    expect(r[0]).to.eql(/^foo (?<NR_1>-?\d+(?:\.\d+)?) bar$/) // deep equality and not obj eq. -> eql
    expect(r[0].test('foo 42.1 bar')).to.be.true
    expect(r[0].test('foo 1 bar')).to.be.true
    expect(r[0].test('foo -42 bar')).to.be.true
    expect(r[0].exec('foo -42.1 bar')).to.be.an('array').that.has.length(2) // only one value captured
    expect(r[0].exec('foo -42.1 bar')).to.be.an('array').that.includes('-42.1')
  })

  it('should handle single strings and add regex on numbers at start and with = or : in front', () => {
    const testStr = '42.1 bar=5 or:7.0'
    const r = generateRegex([testStr])
    expect(r.length).to.equal(1)
    expect(r[0].test(testStr)).to.be.true
    expect(r[0].exec(testStr)).to.be.an('array').that.includes.members(['42.1', '5', '7.0'])
  })

  it('should handle single strings and add regex on two numbers', () => {
    const r = generateRegex(['foo 42.1 -4711bar'])
    expect(r.length).to.equal(1)
    expect(r[0].test('foo 42.1 bar')).to.be.false
    expect(r[0].test('foo 1 2bar')).to.be.true
    expect(r[0].test('foo 1 2 bar')).to.be.false
    expect(r[0].test('foo -42 -5bar')).to.be.true
    expect(r[0].exec('foo -42.1 -5bar')).to.be.an('array').that.has.length(3) // exactly two values captured
    expect(r[0].exec('foo -42.1 -5bar')).to.be.an('array').that.include.members(['-42.1', '-5'])
  })

  it('should handle multiple strings and add regex capturing differences on word boundaries', () => {
    const r = generateRegex(['foo bar end', 'foo baz end']) // we want prefixes to autodetect word boundaries , 'foo nonbar end']);
    expect(r.length).to.equal(1)
    expect(r[0].test('foo bar end')).to.be.true
    expect(r[0].test('foo baz end')).to.be.true
    expect(r[0].test('foo2 bar end')).to.be.false
    expect(r[0].test('foo blabla end')).to.be.true
    expect(r[0].exec('foo blabla end')).to.be.an('array').that.has.length(2)
    expect(r[0].exec('foo blabla end')).to.be.an('array').that.include.members(['blabla'])
  })

  it('should handle multiple strings and add regex capturing differences on multiple word boundaries', () => {
    const r = generateRegex(['foo bar middle bar end', 'foo baz middle baz end']) // we want prefixes to autodetect word boundaries , 'foo nonbar end']);
    expect(r.length).to.equal(1)
    expect(r[0].test('foo bar middle bar end')).to.be.true
    expect(r[0].test('foo baz middle baz end')).to.be.true
    expect(r[0].test('foo2 bar middle bar end')).to.be.false
    expect(r[0].test('foo blabla middle f end')).to.be.true
    expect(r[0].exec('foo blabla middle f end')).to.be.an('array').that.has.length(3)
    expect(r[0].exec('foo blabla middle f end')).to.be.an('array').that.include.members(['blabla', 'f'])
  })

  it('should handle multiple strings and add regex capturing differences on multiple word boundaries ending', () => {
    const r = generateRegex(['foo bar middle bar', 'foo baz middle baz']) // we want prefixes to autodetect word boundaries , 'foo nonbar end']);
    expect(r.length).to.equal(1)
    expect(r[0].test('foo bar middle bar')).to.be.true
    expect(r[0].test('foo baz middle baz')).to.be.true
    expect(r[0].test('foo2 bar middle bar')).to.be.false
    expect(r[0].test('foo blabla middle f')).to.be.true
    expect(r[0].exec('foo blabla middle f')).to.be.an('array').that.has.length(3)
    expect(r[0].exec('foo blabla middle f')).to.be.an('array').that.include.members(['blabla', 'f'])
  })

  it('should handle multiple strings and add regex capturing differences on multiple word boundaries start', () => {
    const r = generateRegex(['bar middle bar', 'baz middle baz']) // we want prefixes to autodetect word boundaries , 'foo nonbar end']);
    expect(r.length).to.equal(1)
    expect(r[0].test('bar middle bar')).to.be.true
    expect(r[0].test('baz middle baz')).to.be.true
    expect(r[0].test('bar middle2 bar')).to.be.false
    expect(r[0].test('blabla middle funky')).to.be.true
    expect(r[0].exec('blabla middle funky')).to.be.an('array').that.has.length(3)
    expect(r[0].exec('blabla middle funky')).to.be.an('array').that.include.members(['blabla', 'funky'])
  })

  it('should handle multiple strings and add regex capturing differences on multiple word boundaries and numbers', () => {
    const r = generateRegex(['-42.1bar middle bar', '1704baz middle baz'])
    expect(r.length).to.equal(1)
    expect(r[0].test('-41.2bar middle bar')).to.be.true
    expect(r[0].test('1704baz middle baz')).to.be.true
    expect(r[0].test('-41.2bar middle2 bar')).to.be.false
    expect(r[0].test('-41.2blabla middle funky')).to.be.true
    expect(r[0].exec('-41.2blabla middle funky')).to.be.an('array').that.has.length(4)
    expect(r[0].exec('-41.2blabla middle funky')).to.be.an('array').that.include.members(['-41.2', 'blabla', 'funky'])
  })

  it('should handle multiple strings and add regex capturing multi word differences', () => {
    const r = generateRegex(['start one two end', 'start three end'])
    // we'd prefer this to be just 1? (capturing 'one two' and 'three' )?
    // but currently its not like that but returns two regexs
    expect(r.length).to.equal(2)
    expect(r[0].test('start one two end')).to.be.true
    expect(r[1].test('start three end')).to.be.true
    expect(r[1].test('start2 three end')).to.be.false
  })

  it('should handle multiple strings and add regex capturing multi word differences with same len', () => {
    const r = generateRegex(['start oneone twotwo end', 'start oneoneAtwotwo end'])
    // we'd prefer this to be just 1?
    // but currently its not like that but returns two regexs (one wrong)
    expect(r.length).to.equal(2)
    expect(r[0]).to.eql(/^start (?<STATE_1>\w+) (?<STATE_2>\w+) end$/)
    expect(r[1]).to.eql(/^start (?<STATE_1>\w+) (?<STATE_2>\w+)$/)
    expect(r[0].test('start one two end')).to.be.true
    expect(r[1].test('start three end')).to.be.true
    expect(r[1].test('start2 three end')).to.be.false
  })

  it('should handle multiple strings and add regex capturing multi word differences with diff types', () => {
    // todo interims test for regExWordFind to avoid replacing the replNumber...
    // put into smaller test case!
    const r2 = /(?<!##)(\w+)(?!§§)/
    expect(r2.test('foo bar')).to.be.true
    expect('##NR§§bar'.replace(r2, 'Q'), '## matches!').to.eql('##NR§§Q')

    const r = generateRegex(['start o-- twotwo end', 'start 1.5-oneone t end'])
    expect(r.length).to.equal(2) // this test can be changed! it's more to understand current behaviour
    expect(r[0], '1st').to.eql(/^start (?<STATE_1>\w+)-- (?<STATE_2>\w+) (?<STATE_3>\w+)$/)
    expect(r[1], '2nd').to.eql(/^start (?<NR_1>-?\d+(?:\.\d+)?)-(?<STATE_1>\w+) (?<STATE_2>\w+) (?<STATE_3>\w+)$/)
    expect(r[0].test('start o-- twotwo end'), 'first test failing').to.be.true
    expect(r[1].test('start 1.5-oneone t end'), '2nd test failing').to.be.true
  })

  it('should handle log from adlt-someip plugin', () => {
    // currently only fields with = or : in front of the nr gets passed
    // parsing json via regex is not really possible (except for a few cases)
    // and it makes no real sense as json provides more context infos
    // here some numbers (0345, 0083) are as well hex numbers but this is not visible...
    const testStr =
      '* (0000:0345) IOEnvironment(0083).changed_temperatureLevels_field{"temperatureLevels":[{"sensorID":"CPU_TEMP","value":0,"isValid":0},{"sensorID":"BOARD_TEMP","value":0,"isValid":0},{"sensorID":"OPTICAL_DRIVE_TEMP","value":0,"isValid":0},{"sensorID":"SOC_TEMP","value":43415,"isValid":1},{"sensorID":"UFS_TEMP","value":46075,"isValid":1},{"sensorID":"INTERNAL_AMBIENT_TEMP","value":43576,"isValid":1},{"sensorID":"EXTERNAL_AMBIENT_TEMP","value":0,"isValid":0},{"sensorID":"PADI_BACKLIGHT_TEMP","value":0,"isValid":0},{"sensorID":"SOC_INTERNAL_MAXIMUM_TEMP","value":47300,"isValid":1}]}[OK]'
    const r = generateRegex([testStr])
    expect(r.length).to.equal(1)
    expect(r[0].test(testStr)).to.be.true
    expect(r[0].exec(testStr)).to.be.an('array').that.has.length(20)
  })

  it('should handle multiple logs from adlt-someip plugin', () => {
    // doesn't make a lot of sense but shouldn't fail...
    const testStr =
      '* (0000:0345) IOEnvironment(0083).changed_temperatureLevels_field{"temperatureLevels":[{"sensorID":"CPU_TEMP","value":0,"isValid":0},{"sensorID":"BOARD_TEMP","value":0,"isValid":0},{"sensorID":"OPTICAL_DRIVE_TEMP","value":0,"isValid":0},{"sensorID":"SOC_TEMP","value":43415,"isValid":1},{"sensorID":"UFS_TEMP","value":46075,"isValid":1},{"sensorID":"INTERNAL_AMBIENT_TEMP","value":43576,"isValid":1},{"sensorID":"EXTERNAL_AMBIENT_TEMP","value":0,"isValid":0},{"sensorID":"PADI_BACKLIGHT_TEMP","value":0,"isValid":0},{"sensorID":"SOC_INTERNAL_MAXIMUM_TEMP","value":47300,"isValid":1}]}[OK]'
    const testStr2 =
      '* (0001:0346) IOEnvironment(0084).changed_temperatureLevels_field{"temperatureLevels":[{"sensorID":"CPU_TEMP","value":0,"isValid":0},{"sensorID":"BOARD_TEMP","value":0,"isValid":0},{"sensorID":"OPTICAL_DRIVE_TEMP","value":0,"isValid":0},{"sensorID":"SOC_TEMP","value":43415,"isValid":1},{"sensorID":"UFS_TEMP","value":46075,"isValid":1},{"sensorID":"INTERNAL_AMBIENT_TEMP","value":43576,"isValid":1},{"sensorID":"EXTERNAL_AMBIENT_TEMP","value":0,"isValid":0},{"sensorID":"PADI_BACKLIGHT_TEMP","value":0,"isValid":0},{"sensorID":"SOC_INTERNAL_MAXIMUM_TEMP","value":47300,"isValid":0}]}[OK]'
    const r = generateRegex([testStr, testStr2])
    expect(r.length).to.equal(1)
    expect(r[0].test(testStr)).to.be.true
    expect(r[0].test(testStr2)).to.be.true
    expect(r[0].exec(testStr)).to.be.an('array').that.has.length(23)
  })
})
