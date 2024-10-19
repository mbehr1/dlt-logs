import * as assert from 'assert'
import * as vscode from 'vscode'
import { generateRegex } from '../../generateRegex'
import { partitionPoint, normalizeArchivePaths, recursiveFsSearch } from '../../util'

suite('Util Test Suite', () => {
  test('partitionPoint', () => {
    // similar to rust slice partition point example
    const arr = [1, 2, 3, 4, 5, 6, 7]
    const index = partitionPoint(arr, (x) => x < 5)
    assert.strictEqual(index, 4)
  })
  test('partitionPoint at start', () => {
    // similar to rust slice partition point example
    const arr = [1, 2, 3, 4, 5, 6, 7]
    const index = partitionPoint(arr, (x) => x < 1)
    assert.strictEqual(index, 0)
  })
  test('partitionPoint at end', () => {
    // similar to rust slice partition point example
    const arr = [1, 2, 3, 4, 5, 6, 7]
    const index = partitionPoint(arr, (x) => x < 8)
    assert.strictEqual(index, 7)
  })
  test('partitionPoint empty', () => {
    // similar to rust slice partition point example
    const arr: any[] = []
    const index = partitionPoint(arr, (x) => x < 8)
    assert.strictEqual(index, 0) // returns 0 for empty arrays
  })
  test('normalizearchivePaths', () => {
    assert.strictEqual(normalizeArchivePaths('foo'), 'foo')
    assert.strictEqual(normalizeArchivePaths('/mount/dir/filename'), '/mount/dir/filename')
    assert.strictEqual(normalizeArchivePaths('c:\\dir\\filename'), 'c:\\dir\\filename')
    assert.strictEqual(normalizeArchivePaths('c:\\dir\\filename!'), 'c:\\dir\\filename!')
    assert.strictEqual(normalizeArchivePaths('c:\\dir\\filename!\\path2'), 'c:\\dir\\filename!/path2')
    assert.strictEqual(normalizeArchivePaths('c:\\dir\\filename!\\path2\\path3'), 'c:\\dir\\filename!/path2/path3')
    assert.strictEqual(normalizeArchivePaths('c:\\dir\\filename!\\path2\\path3\\'), 'c:\\dir\\filename!/path2/path3/')
    assert.strictEqual(normalizeArchivePaths('c:\\dir\\filename!\\path2!\\path3'), 'c:\\dir\\filename!/path2!/path3')
  })

  test('recursiveFsSearch empty', async () => {
    const fsp = vscode.workspace.fs
    // get uri for tests folder based on current dir
    const testUri = vscode.Uri.parse(process.cwd() + '/src/test/recursive_dir')
    let matches = await recursiveFsSearch(fsp, testUri, (e) => false, 1)
    assert.strictEqual(matches.length, 0)

    // there are 3 e1 file in the recursive_dir
    matches = await recursiveFsSearch(fsp, testUri, ([name, type]) => type === vscode.FileType.File && name.endsWith('.e1'), undefined)
    assert.strictEqual(matches.length, 3, 'expected 3 got' + JSON.stringify(matches))
  })

  test('recursiveFsSearch limited', async () => {
    const fsp = vscode.workspace.fs
    // get uri for tests folder based on current dir
    const testUri = vscode.Uri.parse(process.cwd() + '/src/test/recursive_dir')

    // there is just 1 e2 file in the recursive_dir
    let matches = await recursiveFsSearch(fsp, testUri, ([name, type]) => type === vscode.FileType.File && name.endsWith('.e2'), 2)
    assert.strictEqual(matches.length, 1, 'expected 1 got' + JSON.stringify(matches))

    // there are 3 e1 file in the recursive_dir but we want just 2
    matches = await recursiveFsSearch(fsp, testUri, ([name, type]) => type === vscode.FileType.File && name.endsWith('.e1'), 2)
    assert.strictEqual(matches.length, 2, 'expected 2 got' + JSON.stringify(matches))
  })
})
