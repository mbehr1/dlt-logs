/* --------------------
 * Copyright(C) Matthias Behr. 2022
 */

var mocha = require('mocha');
var describe = mocha.describe;
var it = mocha.it;
import { expect } from 'chai';
import { generateRegex } from '../../generateRegex';

describe('generate regex', () => {
    it('should handle empty strings', () => {
        const r = generateRegex([]);
        expect(r).to.be.empty;
    });

    it('should handle single strings and add regex on numbers only', () => {
        const r = generateRegex(['foo 42.1 bar']);
        expect(r.length).to.equal(1);
        expect(r[0]).to.eql(/^foo (?<NR_1>-?\d+(?:\.\d+)?) bar$/); // deep equality and not obj eq. -> eql
        expect(r[0].test('foo 42.1 bar')).to.be.true;
        expect(r[0].test('foo 1 bar')).to.be.true;
        expect(r[0].test('foo -42 bar')).to.be.true;
        expect(r[0].exec('foo -42.1 bar')).to.be.an('array').that.has.length(2); // only one value captured
        expect(r[0].exec('foo -42.1 bar')).to.be.an('array').that.includes('-42.1');
    });

    it('should handle single strings and add regex on two numbers', () => {
        const r = generateRegex(['foo 42.1 -4711bar']);
        expect(r.length).to.equal(1);
        expect(r[0].test('foo 42.1 bar')).to.be.false;
        expect(r[0].test('foo 1 2bar')).to.be.true;
        expect(r[0].test('foo 1 2 bar')).to.be.false;
        expect(r[0].test('foo -42 -5bar')).to.be.true;
        expect(r[0].exec('foo -42.1 -5bar')).to.be.an('array').that.has.length(3); // exactly two values captured
        expect(r[0].exec('foo -42.1 -5bar')).to.be.an('array').that.include.members(['-42.1', '-5']);
    });

    it('should handle multiple strings and add regex capturing differences on word boundaries', () => {
        const r = generateRegex(['foo bar end', 'foo baz end']); // we want prefixes to autodetect word boundaries , 'foo nonbar end']);
        expect(r.length).to.equal(1);
        expect(r[0].test('foo bar end')).to.be.true;
        expect(r[0].test('foo baz end')).to.be.true;
        expect(r[0].test('foo2 bar end')).to.be.false;
        expect(r[0].test('foo blabla end')).to.be.true;
        expect(r[0].exec('foo blabla end')).to.be.an('array').that.has.length(2);
        expect(r[0].exec('foo blabla end')).to.be.an('array').that.include.members(['blabla']);
    });

    it('should handle multiple strings and add regex capturing differences on multiple word boundaries', () => {
        const r = generateRegex(['foo bar middle bar end', 'foo baz middle baz end']); // we want prefixes to autodetect word boundaries , 'foo nonbar end']);
        expect(r.length).to.equal(1);
        expect(r[0].test('foo bar middle bar end')).to.be.true;
        expect(r[0].test('foo baz middle baz end')).to.be.true;
        expect(r[0].test('foo2 bar middle bar end')).to.be.false;
        expect(r[0].test('foo blabla middle f end')).to.be.true;
        expect(r[0].exec('foo blabla middle f end')).to.be.an('array').that.has.length(3);
        expect(r[0].exec('foo blabla middle f end')).to.be.an('array').that.include.members(['blabla', 'f']);
    });

    it('should handle multiple strings and add regex capturing differences on multiple word boundaries ending', () => {
        const r = generateRegex(['foo bar middle bar', 'foo baz middle baz']); // we want prefixes to autodetect word boundaries , 'foo nonbar end']);
        expect(r.length).to.equal(1);
        expect(r[0].test('foo bar middle bar')).to.be.true;
        expect(r[0].test('foo baz middle baz')).to.be.true;
        expect(r[0].test('foo2 bar middle bar')).to.be.false;
        expect(r[0].test('foo blabla middle f')).to.be.true;
        expect(r[0].exec('foo blabla middle f')).to.be.an('array').that.has.length(3);
        expect(r[0].exec('foo blabla middle f')).to.be.an('array').that.include.members(['blabla', 'f']);
    });

    it('should handle multiple strings and add regex capturing differences on multiple word boundaries start', () => {
        const r = generateRegex(['bar middle bar', 'baz middle baz']); // we want prefixes to autodetect word boundaries , 'foo nonbar end']);
        expect(r.length).to.equal(1);
        expect(r[0].test('bar middle bar')).to.be.true;
        expect(r[0].test('baz middle baz')).to.be.true;
        expect(r[0].test('bar middle2 bar')).to.be.false;
        expect(r[0].test('blabla middle funky')).to.be.true;
        expect(r[0].exec('blabla middle funky')).to.be.an('array').that.has.length(3);
        expect(r[0].exec('blabla middle funky')).to.be.an('array').that.include.members(['blabla', 'funky']);
    });

    it('should handle multiple strings and add regex capturing differences on multiple word boundaries and numbers', () => {
        const r = generateRegex(['-42.1bar middle bar', '1704baz middle baz']);
        expect(r.length).to.equal(1);
        expect(r[0].test('-41.2bar middle bar')).to.be.true;
        expect(r[0].test('1704baz middle baz')).to.be.true;
        expect(r[0].test('-41.2bar middle2 bar')).to.be.false;
        expect(r[0].test('-41.2blabla middle funky')).to.be.true;
        expect(r[0].exec('-41.2blabla middle funky')).to.be.an('array').that.has.length(4);
        expect(r[0].exec('-41.2blabla middle funky')).to.be.an('array').that.include.members(['-41.2', 'blabla', 'funky']);
    });

    it('should handle multiple strings and add regex capturing multi word differences', () => {
        const r = generateRegex(['start one two end', 'start three end']);
        // we'd prefer this to be just 1? (capturing 'one two' and 'three' )?
        // but currently its not like that but returns two regexs
        expect(r.length).to.equal(2);
        expect(r[0].test('start one two end')).to.be.true;
        expect(r[1].test('start three end')).to.be.true;
        expect(r[1].test('start2 three end')).to.be.false;
    });

});
