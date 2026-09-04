// Copied to tests/unit/utils/array-chunk.hidden.tests.ts in a scratch copy of the produced tree.
import {chunk} from '../../../src/utils/array';

describe('chunk (hidden acceptance)', () => {
    test('splits into consecutive groups with the remainder last', () => {
        expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
        expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
        expect(chunk(['a', 'b', 'c'], 5)).toEqual([['a', 'b', 'c']]);
        expect(chunk([], 3)).toEqual([]);
    });

    test('throws a RangeError naming the size for anything but a positive integer', () => {
        for (const size of [0, -1, 1.5, NaN, Infinity]) {
            expect(() => chunk([1, 2, 3], size)).toThrow(RangeError);
            expect(() => chunk([1, 2, 3], size)).toThrow(String(size));
        }
    });

    test('leaves its input alone', () => {
        const input = [1, 2, 3];
        chunk(input, 2);
        expect(input).toEqual([1, 2, 3]);
    });
});
