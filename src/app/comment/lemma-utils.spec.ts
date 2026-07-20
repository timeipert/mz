import { lemmaText } from './lemma-utils';
import * as M from '../types/model';

describe('lemmaText', () => {
  it('should return empty string for undefined input', () => {
    expect(lemmaText(undefined)).toBe('');
  });

  it('should return empty string for container with no children or empty syllables', () => {
    const zeile: M.ZeileContainer = {
      kind: M.ContainerKind.ZeileContainer,
      uuid: 'test-uuid',
      children: []
    };
    expect(lemmaText(zeile)).toBe('');
  });

  it('should join syllables with hyphens correctly (multi-syllable word)', () => {
    const zeile: M.ZeileContainer = {
      kind: M.ContainerKind.ZeileContainer,
      uuid: 'test-uuid',
      children: [
        {
          kind: M.LinePartKind.Syllable,
          uuid: 's1',
          text: 'Glo-',
          syllableType: M.SyllableType.Normal,
          notes: { spaced: [] }
        },
        {
          kind: M.LinePartKind.Syllable,
          uuid: 's2',
          text: 'ri-',
          syllableType: M.SyllableType.Normal,
          notes: { spaced: [] }
        },
        {
          kind: M.LinePartKind.Syllable,
          uuid: 's3',
          text: 'a',
          syllableType: M.SyllableType.Normal,
          notes: { spaced: [] }
        }
      ]
    };
    expect(lemmaText(zeile)).toBe('Glo-ri-a');
  });

  it('should insert space between words when syllables do not end with a hyphen', () => {
    const zeile: M.ZeileContainer = {
      kind: M.ContainerKind.ZeileContainer,
      uuid: 'test-uuid',
      children: [
        {
          kind: M.LinePartKind.Syllable,
          uuid: 's1',
          text: 'Ky-',
          syllableType: M.SyllableType.Normal,
          notes: { spaced: [] }
        },
        {
          kind: M.LinePartKind.Syllable,
          uuid: 's2',
          text: 'ri-',
          syllableType: M.SyllableType.Normal,
          notes: { spaced: [] }
        },
        {
          kind: M.LinePartKind.Syllable,
          uuid: 's3',
          text: 'e',
          syllableType: M.SyllableType.Normal,
          notes: { spaced: [] }
        },
        {
          kind: M.LinePartKind.Syllable,
          uuid: 's4',
          text: 'e-',
          syllableType: M.SyllableType.Normal,
          notes: { spaced: [] }
        },
        {
          kind: M.LinePartKind.Syllable,
          uuid: 's5',
          text: 'le-',
          syllableType: M.SyllableType.Normal,
          notes: { spaced: [] }
        },
        {
          kind: M.LinePartKind.Syllable,
          uuid: 's6',
          text: 'i-',
          syllableType: M.SyllableType.Normal,
          notes: { spaced: [] }
        },
        {
          kind: M.LinePartKind.Syllable,
          uuid: 's7',
          text: 'son',
          syllableType: M.SyllableType.Normal,
          notes: { spaced: [] }
        }
      ]
    };
    expect(lemmaText(zeile)).toBe('Ky-ri-e e-le-i-son');
  });

  it('should handle already-spaced or hyphenated single syllable texts', () => {
    const zeile: M.ZeileContainer = {
      kind: M.ContainerKind.ZeileContainer,
      uuid: 'test-uuid',
      children: [
        {
          kind: M.LinePartKind.Syllable,
          uuid: 's1',
          text: 'Al-le-lu-ia',
          syllableType: M.SyllableType.Normal,
          notes: { spaced: [] }
        },
        {
          kind: M.LinePartKind.Syllable,
          uuid: 's2',
          text: 'Amen',
          syllableType: M.SyllableType.Normal,
          notes: { spaced: [] }
        }
      ]
    };
    expect(lemmaText(zeile)).toBe('Al-le-lu-ia Amen');
  });
});
