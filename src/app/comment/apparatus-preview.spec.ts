import { apparatusPreviewLine } from './apparatus-preview';
import * as M from '../types/model';

describe('apparatusPreviewLine', () => {
  let mockOriginal: M.ZeileContainer;

  beforeEach(() => {
    mockOriginal = {
      kind: M.ContainerKind.ZeileContainer,
      uuid: 'orig-uuid',
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
  });

  it('should format a text comment with lemma, content, and category', () => {
    const comment: M.Comment = {
      startUUID: 'u1',
      endUUID: 'u2',
      commentType: 'text',
      text: 'Simple comment text description.',
      category: 'variant'
    };

    const expected = '[Variant reading] Glo-ri-a] Simple comment text description.';
    expect(apparatusPreviewLine(comment, mockOriginal)).toBe(expected);
  });

  it('should truncate a text comment to 80 chars with ellipsis', () => {
    const comment: M.Comment = {
      startUUID: 'u1',
      endUUID: 'u2',
      commentType: 'text',
      text: 'This is a very long comment that will definitely exceed the eighty character limit for the preview line formatting.',
    };

    const expected = 'Glo-ri-a] This is a very long comment that will definitely exceed the eighty character lim...';
    expect(apparatusPreviewLine(comment, mockOriginal)).toBe(expected);
  });

  it('should format a tree comment with the structured comparison placeholder', () => {
    const comment: M.Comment = {
      startUUID: 'u1',
      endUUID: 'u2',
      commentType: 'tree',
      text: '',
      emendation: true
    };

    const expected = 'Glo-ri-a] (structured comparison) ⟨em.⟩';
    expect(apparatusPreviewLine(comment, mockOriginal)).toBe(expected);
  });

  it('should format lines comments with labelled and unlabelled readings', () => {
    const comment: M.Comment = {
      startUUID: 'u1',
      endUUID: 'u2',
      commentType: 'lines',
      text: '',
      lines: [
        {
          kind: M.ContainerKind.ZeileContainer,
          uuid: 'r1',
          children: [
            {
              kind: M.LinePartKind.Syllable,
              uuid: 'rs1',
              text: 'Glo-ri-a-test',
              syllableType: M.SyllableType.Normal,
              notes: { spaced: [] }
            }
          ]
        } as M.ZeileContainer,
        {
          kind: M.ContainerKind.ParatextContainer,
          uuid: 'r2',
          text: 'Feier: text',
          paratextType: M.ParatextType.Feier,
          retro: false
        } as M.ParatextContainer
      ],
      readingWitnesses: ['siglaA'] // only first is labelled
    };

    const expected = 'Glo-ri-a] siglaA: Glo-ri-a-test; reading 2: Feier: text';
    expect(apparatusPreviewLine(comment, mockOriginal)).toBe(expected);
  });
});
