import * as assert from 'assert'

import { generateRegex } from '../../generateRegex'
import { partitionPoint } from '../../util'

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
})
