import { 
  BaseNote,
  CommentTreeGrid,
  convertToBackwardsCompatibleComment,
  convertToBackwardsCompatibleConsecutiveLines,
  convertToBackwardsCompatibleMonodi, 
  convertToBackwardsCompatibleSplitDocuments,
  ContainerKind, 
  DocumentType, 
  LinePartKind, 
  NoteType,
  RootContainer, 
  Syllable, 
  SyllableType, 
  ZeileContainer 
} from './types/model';
import { v4 as UUID } from 'uuid';

describe('convertToBackwardsCompatibleMonodi Modes', () => {
  const note1Uuid = 'v1-n1';
  const note2Uuid = 'v1-n2';

  const testRoot: RootContainer = {
    kind: ContainerKind.RootContainer,
    uuid: UUID(),
    documentType: DocumentType.Level0,
    comments: [],
    children: [
      {
        kind: ContainerKind.ZeileContainer,
        uuid: 'zeile-1',
        voiceCount: 2,
        children: [
          {
            kind: LinePartKind.Syllable,
            uuid: 'syl-1',
            text: 'Glo-',
            syllableType: SyllableType.Normal,
            notes: {
              spaced: [
                { nonSpaced: [{ grouped: [{ uuid: note1Uuid, noteType: NoteType.Normal, base: BaseNote.C, liquescent: false, octave: 4, focus: false }] }] }
              ]
            },
            additionalMelodies: [
              {
                spaced: [
                  { nonSpaced: [{ grouped: [{ uuid: 'v2-n1', noteType: NoteType.Normal, base: BaseNote.E, liquescent: false, octave: 4, focus: false }] }] }
                ]
              }
            ]
          },
          {
            kind: LinePartKind.Syllable,
            uuid: 'syl-2',
            text: 'ri-a',
            syllableType: SyllableType.Normal,
            notes: {
              spaced: [
                { nonSpaced: [{ grouped: [{ uuid: note2Uuid, noteType: NoteType.Normal, base: BaseNote.D, liquescent: false, octave: 4, focus: false }] }] }
              ]
            },
            additionalMelodies: [
              {
                spaced: [
                  { nonSpaced: [{ grouped: [{ uuid: 'v2-n2', noteType: NoteType.Normal, base: BaseNote.F, liquescent: false, octave: 4, focus: false }] }] }
                ]
              }
            ]
          }
        ]
      }
    ]
  };

  it('Mode 1 (Comment): should extract voice 2 into a 2-row phrase comment grid', () => {
    const converted = convertToBackwardsCompatibleComment(testRoot);

    const zeile = converted.children[0] as ZeileContainer;
    expect(zeile.voiceCount).toBeUndefined();
    const syl1 = zeile.children[0] as Syllable;
    expect(syl1.additionalMelodies).toBeUndefined();

    expect(converted.comments.length).toBe(1);
    const comment = converted.comments[0];
    expect(comment.startUUID).toBe(note1Uuid);
    expect(comment.endUUID).toBe(note2Uuid);
    expect(comment.text).toBe('Second Voice');

    const grid = comment.tree as CommentTreeGrid;
    expect(grid.items.length).toBe(2);
    expect((grid.items[0][0] as any).content.content).toBe('Second Voice');
    expect((grid.items[1][0] as any).content.kind).toBe('Notes');
  });

  it('Mode 2 (Consecutive Lines): should create a second staff line directly below phrase 1', () => {
    const converted = convertToBackwardsCompatibleConsecutiveLines(testRoot);

    expect(converted.children.length).toBe(2);
    
    const line1 = converted.children[0] as ZeileContainer;
    const line2 = converted.children[1] as ZeileContainer;

    expect(line1.voiceCount).toBeUndefined();
    expect(line2.voiceCount).toBeUndefined();

    const line1Syl1 = line1.children[0] as Syllable;
    expect(line1Syl1.text).toBe('Glo-');
    expect(line1Syl1.notes.spaced[0].nonSpaced[0].grouped[0].base).toBe(BaseNote.C);

    const line2Syl1 = line2.children[0] as Syllable;
    expect(line2Syl1.text).toBe('Glo-');
    expect(line2Syl1.notes.spaced[0].nonSpaced[0].grouped[0].base).toBe(BaseNote.E);
  });

  it('Mode 3 (Split Documents): should split into two standalone documents -v1 and -v2', () => {
    const result = convertToBackwardsCompatibleSplitDocuments(testRoot, 'doc-123.json');

    expect(result.filename1).toBe('doc-123-v1.json');
    expect(result.filename2).toBe('doc-123-v2.json');

    // Doc 1 check (Voice 1 notes: C, D)
    const zeile1 = result.v1.children[0] as ZeileContainer;
    expect((zeile1.children[0] as Syllable).notes.spaced[0].nonSpaced[0].grouped[0].base).toBe(BaseNote.C);
    expect((zeile1.children[0] as Syllable).additionalMelodies).toBeUndefined();

    // Doc 2 check (Voice 2 notes: E, F)
    const zeile2 = result.v2.children[0] as ZeileContainer;
    expect((zeile2.children[0] as Syllable).notes.spaced[0].nonSpaced[0].grouped[0].base).toBe(BaseNote.E);
    expect((zeile2.children[0] as Syllable).additionalMelodies).toBeUndefined();
  });
});
