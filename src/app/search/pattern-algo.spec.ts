import {
  levenshteinDistance,
  arrayLevenshtein,
  getStringSimilarity,
  getSequenceSimilarity,
  buildShingleSet,
  jaccardSimilarity,
  toPitchNames,
  toContour,
  toIntervals
} from './pattern-algo';
import * as VM from '../types/model';

describe('PatternAlgo Characterization Tests', () => {
  describe('levenshteinDistance', () => {
    it('should return 0 for identical strings', () => {
      expect(levenshteinDistance('abc', 'abc')).toBe(0);
    });

    it('should return string length when compared with an empty string', () => {
      expect(levenshteinDistance('', 'abc')).toBe(3);
      expect(levenshteinDistance('abc', '')).toBe(3);
    });

    it('should return correct edit distance for standard strings', () => {
      expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
    });

    it('should return value > maxDist (early exit) when actual distance exceeds maxDist', () => {
      // With maxDist = 1, since the actual distance is 3, it should exit early and return maxDist + 1 = 2
      expect(levenshteinDistance('kitten', 'sitting', 1)).toBe(2);
    });
  });

  describe('arrayLevenshtein', () => {
    it('should return 0 for identical arrays', () => {
      expect(arrayLevenshtein(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(0);
    });

    it('should return 1 for a single substitution', () => {
      expect(arrayLevenshtein(['a', 'b', 'c'], ['a', 'x', 'c'])).toBe(1);
    });

    it('should calculate correct distance for length-difference-only cases', () => {
      expect(arrayLevenshtein(['a', 'b'], ['a', 'b', 'c'])).toBe(1);
      
      // SURPRISE: arrayLevenshtein(['a'], ['a', 'b', 'c']) returns 0 instead of 2.
      // This is because the function restricts the calculation band using the length of the shorter string,
      // which causes the loop to skip later iterations when length differences are larger, resulting in stale DP array values.
      // We lock in this actual behavior.
      expect(arrayLevenshtein(['a'], ['a', 'b', 'c'])).toBe(0);
    });
  });

  describe('getStringSimilarity and getSequenceSimilarity', () => {
    it('should return 1.0 for identical inputs', () => {
      expect(getStringSimilarity('abc', 'abc')).toBe(1.0);
      expect(getSequenceSimilarity(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(1.0);
    });

    it('should return 0 for completely different inputs of same length', () => {
      expect(getStringSimilarity('abc', 'xyz')).toBe(0.0);
      expect(getSequenceSimilarity(['a', 'b', 'c'], ['x', 'y', 'z'])).toBe(0.0);
    });

    it('should return 0 if the threshold parameter short-circuits due to length mismatch or low similarity', () => {
      // getStringSimilarity with high threshold should yield 0 for dissimilar strings
      expect(getStringSimilarity('abc', 'xyz', 0.5)).toBe(0.0);
      expect(getSequenceSimilarity(['a', 'b', 'c'], ['x', 'y', 'z'], 0.5)).toBe(0.0);
    });
  });

  describe('buildShingleSet', () => {
    it('should build correct shingles for string inputs', () => {
      const result = buildShingleSet('abcde', 3);
      expect(result.has('abc')).toBeTrue();
      expect(result.has('bcd')).toBeTrue();
      expect(result.has('cde')).toBeTrue();
      expect(result.size).toBe(3);
    });

    it('should return a set containing the input itself if string is shorter than k', () => {
      const result = buildShingleSet('ab', 3);
      expect(result.has('ab')).toBeTrue();
      expect(result.size).toBe(1);
    });

    it('should return a set containing the joined input if array is shorter than k', () => {
      const result = buildShingleSet(['a', 'b'], 3);
      expect(result.has('a|b')).toBeTrue();
      expect(result.size).toBe(1);
    });
  });

  describe('jaccardSimilarity', () => {
    it('should return 1.0 for identical sets', () => {
      expect(jaccardSimilarity(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1.0);
    });

    it('should return 0.0 for disjoint sets', () => {
      expect(jaccardSimilarity(new Set(['a', 'b']), new Set(['c', 'd']))).toBe(0.0);
    });

    it('should return the correct ratio for half-overlapping sets', () => {
      // intersection is {'b'} (size 1), union is {'a', 'b', 'c'} (size 3) => 1/3
      expect(jaccardSimilarity(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(0.3333, 4);
    });
  });

  describe('toPitchNames, toContour, and toIntervals', () => {
    const mockNotes: VM.Note[] = [
      { base: VM.BaseNote.C, octave: 4, noteType: VM.NoteType.Normal } as any as VM.Note,
      { base: VM.BaseNote.D, octave: 4, noteType: VM.NoteType.Normal } as any as VM.Note,
      { base: VM.BaseNote.C, octave: 4, noteType: VM.NoteType.Flat } as any as VM.Note,
      { base: VM.BaseNote.C, octave: 4, noteType: VM.NoteType.Sharp } as any as VM.Note
    ];

    it('should format pitch names with and without octave', () => {
      expect(toPitchNames(mockNotes, true)).toEqual(['c4', 'd4', 'cb4', 'c#4']);
      expect(toPitchNames(mockNotes, false)).toEqual(['c', 'd', 'cb', 'c#']);
    });

    it('should calculate pitch contour steps', () => {
      // notes: C4 (28) -> D4 (29) (up 'u') -> Cb4 (28) (down 'd') -> C#4 (28) (repeat/same index 'r')
      expect(toContour(mockNotes)).toEqual(['u', 'd', 'r']);
    });

    it('should calculate interval diff numbers', () => {
      // notes: C4 (28) -> D4 (29) (+1) -> Cb4 (28) (-1) -> C#4 (28) (0)
      expect(toIntervals(mockNotes)).toEqual(['+1', '-1', '0']);
    });
  });
});
