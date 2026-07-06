import {
  ContainerKind,
  DocumentType,
  LinePartKind,
  BaseNote,
  NoteType,
  emptyRootContainer,
  emptyFormteilContainer,
  emptyZeileContainer,
  emptySyllable,
  resolve,
  getContainerChildren,
  getAllCommentableUUIDs,
  getSyllables,
  getAllLineParts,
  getAllLineContainers,
  remove,
  comparePositions,
  nextNote,
  previousNote,
  isOfRootContainer
} from './model';

describe('Model Pure Functions Characterization Tests', () => {
  let root: any;
  let formteil: any;
  let zeile: any;
  let syllable: any;

  beforeEach(() => {
    root = emptyRootContainer();
    formteil = emptyFormteilContainer(DocumentType.Level1, [0]);
    zeile = emptyZeileContainer(1);
    syllable = emptySyllable(1);
    syllable.text = 'Ky-';
    
    // Setup nested structure: root -> formteil -> zeile -> syllable
    zeile.children = [syllable];
    formteil.children = [zeile];
    root.children = [formteil];
  });

  describe('resolve', () => {
    it('should resolve root when zipper path is empty', () => {
      expect(resolve(root, [])).toBe(root);
    });

    it('should resolve nested containers correctly', () => {
      expect(resolve(root, [0])).toBe(formteil);
      expect(resolve(root, [0, 0])).toBe(zeile);
    });

    it('should return undefined for invalid path indices', () => {
      expect(resolve(root, [99])).toBeUndefined();
      expect(resolve(root, [0, 99])).toBeUndefined();
    });
  });

  describe('getContainerChildren', () => {
    it('should return children array for RootContainer and FormteilContainer', () => {
      expect(getContainerChildren(root)).toEqual([formteil]);
      expect(getContainerChildren(formteil)).toEqual([zeile]);
    });

    it('should return empty array for ZeileContainer children in container tree definition', () => {
      // ZeileContainer has LinePart children (leaf items), so getContainerChildren returns []
      expect(getContainerChildren(zeile)).toEqual([]);
    });
  });

  describe('getAllCommentableUUIDs', () => {
    it('should collect UUIDs for all comments-ready elements in the tree', () => {
      const uuids = getAllCommentableUUIDs(root);
      expect(uuids).toContain(syllable.uuid);
      // It should also contain all note UUIDs inside the syllable
      expect(uuids.length).toBeGreaterThan(1);
    });

    it('should return empty list for empty/leaf containers', () => {
      const emptyRoot = emptyRootContainer();
      expect(getAllCommentableUUIDs(emptyRoot)).toEqual([]);
    });
  });

  describe('getSyllables', () => {
    it('should traverse and retrieve all Syllables in a container', () => {
      expect(getSyllables(root)).toEqual([syllable]);
    });

    it('should return empty list if no syllables are present', () => {
      const emptyRoot = emptyRootContainer();
      expect(getSyllables(emptyRoot)).toEqual([]);
    });
  });

  describe('getAllLineParts', () => {
    it('should retrieve all LinePart elements recursively', () => {
      expect(getAllLineParts(root)).toEqual([syllable]);
    });

    it('should return empty list for an empty RootContainer', () => {
      const emptyRoot = emptyRootContainer();
      expect(getAllLineParts(emptyRoot)).toEqual([]);
    });
  });

  describe('getAllLineContainers', () => {
    it('should retrieve all ZeileContainers recursively', () => {
      expect(getAllLineContainers(root)).toEqual([zeile]);
    });

    it('should return empty list for an empty RootContainer', () => {
      const emptyRoot = emptyRootContainer();
      expect(getAllLineContainers(emptyRoot)).toEqual([]);
    });
  });

  describe('remove', () => {
    it('should delete a direct child container in-place', () => {
      remove(root, formteil);
      expect(root.children).toEqual([]);
    });

    it('should delete a nested child container recursively in-place', () => {
      remove(root, zeile);
      expect(formteil.children).toEqual([]);
    });

    it('should do nothing if target container is not found in the hierarchy', () => {
      const dummy = emptyFormteilContainer(DocumentType.Level1, [99]);
      remove(root, dummy);
      expect(root.children).toEqual([formteil]);
      expect(formteil.children).toEqual([zeile]);
    });
  });

  describe('comparePositions', () => {
    it('should return negative value if first note is lower in pitch/octave than the second', () => {
      expect(comparePositions(4, BaseNote.C, 4, BaseNote.D)).toBe(-1);
      expect(comparePositions(3, BaseNote.C, 4, BaseNote.C)).toBe(-7);
    });

    it('should return 0 for identical note pitches and octaves', () => {
      expect(comparePositions(4, BaseNote.E, 4, BaseNote.E)).toBe(0);
    });

    it('should return positive value if first note is higher in pitch/octave than the second', () => {
      expect(comparePositions(4, BaseNote.D, 4, BaseNote.C)).toBe(1);
      expect(comparePositions(5, BaseNote.C, 4, BaseNote.C)).toBe(7);
    });
  });

  describe('nextNote and previousNote', () => {
    it('should calculate the next logical note step within the same octave', () => {
      const start = { octave: 4, base: BaseNote.C, noteType: NoteType.Normal } as any;
      const next = nextNote(start);
      expect(next.base).toBe(BaseNote.D);
      expect(next.octave).toBe(4);
    });

    it('should roll over to next octave when stepping past BaseNote.B', () => {
      const start = { octave: 4, base: BaseNote.B, noteType: NoteType.Normal } as any;
      const next = nextNote(start);
      expect(next.base).toBe(BaseNote.C);
      expect(next.octave).toBe(5);
    });

    it('should calculate the previous logical note step within the same octave', () => {
      const start = { octave: 4, base: BaseNote.D, noteType: NoteType.Normal } as any;
      const prev = previousNote(start);
      expect(prev.base).toBe(BaseNote.C);
      expect(prev.octave).toBe(4);
    });

    it('should roll back to previous octave when stepping below BaseNote.C', () => {
      const start = { octave: 4, base: BaseNote.C, noteType: NoteType.Normal } as any;
      const prev = previousNote(start);
      expect(prev.base).toBe(BaseNote.B);
      expect(prev.octave).toBe(3);
    });
  });

  describe('isOfRootContainer', () => {
    it('should return true for a valid RootContainer', () => {
      expect(isOfRootContainer(root)).toBeTrue();
    });

    it('should return false for valid containers of other types', () => {
      expect(isOfRootContainer(formteil)).toBeFalse();
    });

    it('should throw an error when null or undefined is passed', () => {
      // SURPRISE: isOfRootContainer(null) throws a TypeError because it attempts to read
      // the 'kind' property of null/undefined without checking truthiness first.
      expect(() => isOfRootContainer(null)).toThrow();
      expect(() => isOfRootContainer(undefined)).toThrow();
    });
  });
});
