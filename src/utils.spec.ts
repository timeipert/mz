import { flatten, flatMap, maxOf } from './utils';

describe('Utility Helpers (utils.ts)', () => {
    describe('flatten', () => {
        it('should return an empty array when given an empty nested array', () => {
            expect(flatten([])).toEqual([]);
        });

        it('should flatten a simple 2D array of numbers', () => {
            const nested = [[1, 2], [3], [4, 5]];
            expect(flatten(nested)).toEqual([1, 2, 3, 4, 5]);
        });

        it('should flatten a nested array of strings', () => {
            const nested = [['a', 'b'], ['c', 'd']];
            expect(flatten(nested)).toEqual(['a', 'b', 'c', 'd']);
        });
    });

    describe('flatMap', () => {
        it('should map and flatten values', () => {
            const input = [1, 2, 3];
            const duplicate = (n: number) => [n, n];
            expect(flatMap(input, duplicate)).toEqual([1, 1, 2, 2, 3, 3]);
        });

        it('should handle functions returning empty arrays', () => {
            const input = [1, 2, 3, 4];
            const filterEven = (n: number) => n % 2 === 0 ? [n] : [];
            expect(flatMap(input, filterEven)).toEqual([2, 4]);
        });
    });

    describe('maxOf', () => {
        it('should return undefined when given an empty array', () => {
            expect(maxOf([])).toBeUndefined();
        });

        it('should return the maximum value from a list of positive numbers', () => {
            expect(maxOf([1, 5, 3, 9, 2])).toBe(9);
        });

        it('should return the maximum value from a list containing negative numbers', () => {
            expect(maxOf([-10, -5, -2, -15])).toBe(-2);
        });

        it('should return the maximum value when list contains duplicates', () => {
            expect(maxOf([4, 7, 7, 1])).toBe(7);
        });
    });
});
