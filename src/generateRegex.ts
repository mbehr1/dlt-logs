/* --------------------
 * Copyright(C) Matthias Behr. 2022
 */

/**
 * generate a regex from a set of strings.
 * Adds regex captures for
 *   - numbers (float with decimal '.' e.g. -42.1) with capture group name 'NR_1..'
 *   - words (single different words) with capture group name 'STATE_1..'
 * 
 * Example:
 * 
 *  ['-42.1bar middle baz', '17baz middle bar'] returns a regex with 3 capture groups:
 * 
 *  '^(?\<NR_1>)(?\<STATE_1>) middle (?\<STATE_2>)'.
 * 
 * Remark:
 *  - currently differences are determined on word boundaries and not on patterns.
 *   E.g. ['start one two end','start three end'] are not detected as
 *  '^start (?\<STATE_1>) end'
 *  - hex numbers are not detected/captured properly yet!
 * @param toMatchArr array of strings that should be matched with the regex generated
 * @returns array of regexp that do match the strings
 */

export function generateRegex(toMatchArr: string[]): RegExp[] {
    if (toMatchArr.length === 0) { return []; }

    // step 1: replace all numbers with special chars
    const replNumber = '##NR##'; // TODO search string for non existance and add more chars until not exist
    // must not contain parts that will be escaped!
    // same for
    const replWord = '##W##';

    // todo add support for hex numbers
    const regExNrFind = /(?<=^| )-?\d+(\.\d+)?/g; // nr at start of text or after a space ' '
    const regExNrInsert = /(?<NR__>-?\d+(?:\.\d+)?)/;

    const regExWordFind = /(\w+)/;
    const regExWordInsert = /(?<W__>\w+)/;

    // use a copy and dont modify orig strings
    let toMatchArrCopy: string[] = [];
    for (const toMatch of toMatchArr) {
        const cpy = toMatch.replace(regExNrFind, replNumber);
        toMatchArrCopy.push(cpy);
    }

    if (toMatchArrCopy.length > 1) {
        // now that numbers are removed/similar - search for communalities:
        let startIndex = 0;
        let minStrLength = toMatchArrCopy.reduce((prev, cur) => Math.min(prev, cur.length), toMatchArrCopy[0].length);
        while (startIndex < minStrLength) {
            let prefix = longestCommonPrefix(startIndex, toMatchArrCopy);
            console.log(`prefix(startIndex=${startIndex}, minStrLength=${minStrLength})='${prefix}'`);
            // as we want word boundaries have a prefix end at a ' ' (or end of string)
            let prefixLen = prefix.length;
            if (prefixLen + startIndex >= minStrLength) { break; }
            if (prefix.includes(' ')) {
                prefix = prefix.slice(0, prefix.lastIndexOf(' ') + 1);
                console.log(`prefix(startIndex=${startIndex}, minStrLength=${minStrLength}) using '${prefix}'`);
                prefixLen = prefix.length;
            } else {
                const idxReplNumber = prefix.lastIndexOf(replNumber);
                prefixLen = idxReplNumber < 0 ? 0 : idxReplNumber + replNumber.length;
                console.log(`prefix(startIndex=${startIndex}, minStrLength=${minStrLength}) ignoring '${prefix}' using '${prefix.slice(0, prefixLen)}'`);
            }
            // use that prefix and a word regex
            toMatchArrCopy = toMatchArrCopy.map((toMatch) => toMatch.slice(0, startIndex + prefixLen) +
                toMatch.slice(startIndex + prefixLen).replace(regExWordFind, replWord));
            console.log(`prefix(startIndex=${startIndex}, minStrLength=${minStrLength}) replaced '${toMatchArrCopy}'`);

            // determine new start index
            startIndex = startIndex + prefixLen + replWord.length;
            minStrLength = toMatchArrCopy.reduce((prev, cur) => Math.min(prev, cur.length), toMatchArrCopy[0].length);
        }
    }

    // now create a regex:
    // a) escape all remaining chars
    toMatchArrCopy = toMatchArrCopy.map((toMatch) => '^' + escapeRegExp(toMatch) + '$');

    // b) replace the placeholders
    toMatchArrCopy = toMatchArrCopy.map((toMatch) => {
        let next_nr = 1;
        let next_word = 1;
        let toRet = toMatch;
        while (toRet.includes(replNumber)) {
            toRet = toRet.replace(replNumber, regExNrInsert.source.replace('?<NR__>', `?<NR_${next_nr}>`));
            next_nr++;
        }
        while (toRet.includes(replWord)) {
            toRet = toRet.replace(replWord, regExWordInsert.source.replace('?<W__>', `?<STATE_${next_word}>`));
            next_word++;
        }
        return toRet;
    });

    return toMatchArrCopy.filter((v, i, a) => a.indexOf(v) === i).map((regExStr) => new RegExp(regExStr));
}

// from mdn web docs:
function escapeRegExp(aString: string) {
    return aString.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

function longestCommonPrefix(startIndex: number, words: string[]): string {
    if (!words[0] || words.length === 1) { return words[0] || ""; }
    let i = startIndex;
    // while all words have the same character at position i, increment i
    while (words[0][i] && words.every(w => w[i] === words[0][i])) { i++; }

    return words[0].slice(startIndex, i);
}
