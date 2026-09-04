// Copied to src/List.partition.hidden.test.ts in a scratch copy of the produced tree.
import { List } from './List.js'
import { Tuple } from './Tuple'
import { describe, expect, test } from 'vitest'

describe('List.partition (hidden acceptance)', () => {
  test('splits by the predicate, keeping order in both halves', () => {
    expect(List.partition((x: number) => x > 1, [1, 2, 3])).toEqual(Tuple([2, 3], [1]))
    expect(List.partition((x: number) => x % 2 === 0, [5, 2, 7, 4, 6, 1])).toEqual(
      Tuple([2, 4, 6], [5, 7, 1])
    )
  })

  test('answers two empty arrays for an empty list', () => {
    expect(List.partition((x: number) => x > 1, [])).toEqual(Tuple([], []))
  })

  test('is curried like List.find', () => {
    const evens = List.partition((x: number) => x % 2 === 0)
    expect(evens([1, 2, 3, 4])).toEqual(Tuple([2, 4], [1, 3]))
  })

  test('hands the predicate the index', () => {
    expect(List.partition((_: string, i: number) => i < 2, ['a', 'b', 'c'])).toEqual(
      Tuple(['a', 'b'], ['c'])
    )
  })
})
