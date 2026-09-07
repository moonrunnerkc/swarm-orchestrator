// Second hidden oracle for the List.partition task. Written from task.md alone, blind to every
// produced patch, and never handed to the tool. Different lists and predicates from the first
// oracle throughout, plus the third predicate argument the task text names and the first oracle
// never passes. Assertions go through `Tuple(...)` and `toEqual` only, which the first oracle
// already shows to work, so a failure here is about partition rather than about Tuple's API.
import { List } from './List.js'
import { Tuple } from './Tuple'
import { describe, expect, test } from 'vitest'

describe('List.partition (second hidden oracle)', () => {
  test('hands the predicate the whole array as its third argument', () => {
    const seen: number[][] = []
    List.partition(
      (_: number, __: number, arr: number[]) => {
        seen.push(arr)
        return true
      },
      [7, 8]
    )
    expect(seen).toEqual([
      [7, 8],
      [7, 8]
    ])
  })

  test('answers all-accepted and all-rejected', () => {
    expect(List.partition((x: number) => x > 0, [4, 5, 6])).toEqual(Tuple([4, 5, 6], []))
    expect(List.partition((x: number) => x > 100, [4, 5, 6])).toEqual(Tuple([], [4, 5, 6]))
  })

  test('keeps duplicates and relative order in both halves', () => {
    expect(List.partition((x: string) => x === 'a', ['a', 'b', 'a', 'b', 'a'])).toEqual(
      Tuple(['a', 'a', 'a'], ['b', 'b'])
    )
  })

  test('leaves its input alone', () => {
    const input = [1, 2, 3, 4]
    List.partition((x: number) => x % 2 === 0, input)
    expect(input).toEqual([1, 2, 3, 4])
  })

  test('is curried, on a different shape from the first oracle', () => {
    const long = List.partition((word: string) => word.length > 3)
    expect(long(['to', 'four', 'a', 'seven'])).toEqual(Tuple(['four', 'seven'], ['to', 'a']))
  })

  // The property the task states, over every length up to thirty rather than over one example.
  test('the two halves are the filtered input, for many shapes', () => {
    for (let n = 0; n <= 30; n++) {
      const list = Array.from({ length: n }, (_, i) => (i * 7) % 11)
      const accepted = list.filter((x) => x % 3 === 0)
      const rejected = list.filter((x) => x % 3 !== 0)
      expect(List.partition((x: number) => x % 3 === 0, list)).toEqual(Tuple(accepted, rejected))
    }
  })
})
