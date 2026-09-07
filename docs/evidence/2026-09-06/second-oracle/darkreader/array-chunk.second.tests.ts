// Second hidden oracle for the chunk task. Written from task.md alone, blind to every produced
// patch, and never handed to the tool. Different lengths, sizes and rejected values from the
// first oracle, and the grouping property stated over many shapes rather than over four examples.
import {chunk} from '../../../src/utils/array';

describe('chunk (second hidden oracle)', () => {
    test('a size of one gives every element its own group', () => {
        expect(chunk(['x', 'y', 'z'], 1)).toEqual([['x'], ['y'], ['z']]);
    });

    test('a size at or above the length gives one group', () => {
        expect(chunk([1, 2, 3], 3)).toEqual([[1, 2, 3]]);
        expect(chunk([1, 2, 3], 4)).toEqual([[1, 2, 3]]);
        expect(chunk([1], 9)).toEqual([[1]]);
    });

    test('the groups concatenate back to the input, every group but the last full', () => {
        for (let length = 0; length <= 25; length++) {
            const input = Array.from({length}, (_, i) => i);
            for (const size of [1, 2, 3, 4, 7, 26]) {
                const groups = chunk(input, size);
                expect(groups.flat()).toEqual(input);
                for (const group of groups.slice(0, -1)) {
                    expect(group).toHaveLength(size);
                }
                const last = groups[groups.length - 1];
                if (last !== undefined) {
                    expect(last.length).toBeGreaterThan(0);
                    expect(last.length).toBeLessThanOrEqual(size);
                }
            }
        }
    });

    test('throws a RangeError naming sizes the first oracle never names', () => {
        for (const size of [-0.5, -100, 2.5, -Infinity]) {
            expect(() => chunk([1, 2], size)).toThrow(RangeError);
            expect(() => chunk([1, 2], size)).toThrow(String(size));
        }
    });

    test('hands back groups that do not alias the input', () => {
        const input = [1, 2, 3, 4];
        const groups = chunk(input, 2);
        groups[0][0] = 99;
        expect(input).toEqual([1, 2, 3, 4]);
    });
});
