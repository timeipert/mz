import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { RouterTestingModule } from '@angular/router/testing';
import { of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { SearchComponent, arrayLevenshtein } from './search.component';
import { HelpButtonComponent } from '../help-button/help-button.component';
import { APIService } from '../api.service';
import { UserService } from '../user.service';
import { PageTitleService } from '../page-title.service';

describe('SearchComponent', () => {
  let component: SearchComponent;
  let fixture: ComponentFixture<SearchComponent>;

  const mockUserService = {
    user: of({ token: 'mock-token', name: 'Mock User' })
  };

  const mockAPIService = {
    getSettings: () => of({ kind: 'SettingsRetrieved', settings: {} }),
    listSources: () => of({ kind: 'SourcesRetrieved', sources: [] }),
    listDocuments: () => of({ kind: 'DocumentsRetrieved', documents: [] }),
    getAllDocumentNotes: () => of({}),
    querySources: () => of({ kind: 'SourcesRetrieved', sources: [] }),
    queryDocuments: () => of({ kind: 'DocumentsRetrieved', documents: [] }),
  };

  const mockPageTitleService = {
    set: () => {}
  };

  const mockToastrService = {
    success: () => {},
    error: () => {},
    info: () => {},
    warning: () => {}
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [SearchComponent, HelpButtonComponent],
      imports: [FormsModule, RouterTestingModule],
      providers: [
        { provide: UserService, useValue: mockUserService },
        { provide: APIService, useValue: mockAPIService },
        { provide: PageTitleService, useValue: mockPageTitleService },
        { provide: ToastrService, useValue: mockToastrService }
      ]
    });
    fixture = TestBed.createComponent(SearchComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('Synopsis Metadata and Staff Scaling', () => {
    it('should initialize synopsis columns definitions on loadCols', () => {
      component.loadCols();
      expect(component.synopsisMetadataCols).toBeDefined();
      expect(component.synopsisMetadataCols.length).toBeGreaterThan(0);
      
      const visibleCols = component.visibleSynopsisCols;
      expect(visibleCols.length).toBeGreaterThan(0);
    });

    it('should correctly retrieve document field values with fallbacks', () => {
      const doc: any = {
        dokumenten_id: 'doc-123',
        textinitium: 'In principio',
        festtag: 'Christmas'
      };
      
      expect(component.getDocFieldValue(doc, 'dokumenten_id')).toBe('doc-123');
      expect(component.getDocFieldValue(doc, 'textinitium')).toBe('In principio');
      expect(component.getDocFieldValue(doc, 'feier')).toBe('—');
    });

    it('should save synopsis columns to local storage', () => {
      spyOn(localStorage, 'setItem');
      component.saveSynopsisCols();
      expect(localStorage.setItem).toHaveBeenCalled();
    });

    it('should calculate scaled column widths properly', () => {
      component.settings = {
        pdfSynopsisScale: 1.2
      } as any;

      const col: any[] = [];
      const width = component.getColumnWidth(col);
      // Min column width is 40. Scaled by 1.2, it should be 48
      expect(width).toBe(48);
    });
  });
});

describe('arrayLevenshtein', () => {
  it('should return 0 for identical arrays', () => {
    expect(arrayLevenshtein(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(0);
  });

  it('should compute distance for single replacement', () => {
    expect(arrayLevenshtein(['a', 'b', 'c'], ['a', 'x', 'c'])).toBe(1);
  });

  it('should compute distance for insertions/deletions', () => {
    expect(arrayLevenshtein(['a', 'b', 'c'], ['a', 'c'])).toBe(1);
    expect(arrayLevenshtein(['a', 'c'], ['a', 'b', 'c'])).toBe(1);
  });

  it('should handle completely different arrays', () => {
    expect(arrayLevenshtein(['a', 'b'], ['x', 'y', 'z'])).toBe(3);
  });
});

describe('computePatternGroups', () => {
  it('should extract and group exact pitch patterns', () => {
    const dummyDocs: any[] = [
      {
        doc: { id: 'doc-1', textinitium: 'Chant 1' },
        sourceSigle: 'Sigle-1',
        notes: [
          { uuid: 'n1', base: 'C', octave: 4 },
          { uuid: 'n2', base: 'D', octave: 4 },
          { uuid: 'n3', base: 'E', octave: 4 },
          { uuid: 'n4', base: 'F', octave: 4 },
          { uuid: 'n5', base: 'G', octave: 4 }
        ],
        syllables: [
          { uuid: 's1', text: 'Al-le-lu-ia' }
        ],
        sylIdx: [0, 0, 0, 0, 0],
        sequence: ['c4', 'd4', 'e4', 'f4', 'g4']
      },
      {
        doc: { id: 'doc-2', textinitium: 'Chant 2' },
        sourceSigle: 'Sigle-2',
        notes: [
          { uuid: 'm1', base: 'C', octave: 4 },
          { uuid: 'm2', base: 'D', octave: 4 },
          { uuid: 'm3', base: 'E', octave: 4 },
          { uuid: 'm4', base: 'F', octave: 4 },
          { uuid: 'm5', base: 'G', octave: 4 }
        ],
        syllables: [
          { uuid: 's2', text: 'A-men' }
        ],
        sylIdx: [0, 0, 0, 0, 0],
        sequence: ['c4', 'd4', 'e4', 'f4', 'g4']
      }
    ];

    const groups = SearchComponent.computePatternGroups(dummyDocs, 'pitch', 5, 'exact', true, 1);
    expect(groups.length).toBe(1);
    const g = groups[0];
    expect(g.uniqueDocCount).toBe(2);
    expect(g.occurrences.length).toBe(2);
    expect(g.isCompound).toBeFalse();
    expect(g.occurrences[0].notes.length).toBe(5);
  });

  it('should extract and merge contiguous interval patterns and mark them as compound', () => {
    const dummyDocs: any[] = [
      {
        doc: { id: 'doc-1', textinitium: 'Chant 1' },
        sourceSigle: 'Sigle-1',
        notes: [
          { uuid: 'n1', base: 'C', octave: 4 },
          { uuid: 'n2', base: 'D', octave: 4 },
          { uuid: 'n3', base: 'E', octave: 4 },
          { uuid: 'n4', base: 'F', octave: 4 },
          { uuid: 'n5', base: 'G', octave: 4 },
          { uuid: 'n6', base: 'A', octave: 4 }
        ],
        syllables: [
          { uuid: 's1', text: 'Text 1' }
        ],
        sylIdx: [0, 0, 0, 0, 0, 0],
        sequence: ['+1', '+1', '+1', '+1', '+1']
      },
      {
        doc: { id: 'doc-2', textinitium: 'Chant 2' },
        sourceSigle: 'Sigle-2',
        notes: [
          { uuid: 'm1', base: 'C', octave: 4 },
          { uuid: 'm2', base: 'D', octave: 4 },
          { uuid: 'm3', base: 'E', octave: 4 },
          { uuid: 'm4', base: 'F', octave: 4 },
          { uuid: 'm5', base: 'G', octave: 4 },
          { uuid: 'm6', base: 'A', octave: 4 }
        ],
        syllables: [
          { uuid: 's2', text: 'Text 2' }
        ],
        sylIdx: [0, 0, 0, 0, 0, 0],
        sequence: ['+1', '+1', '+1', '+1', '+1']
      }
    ];

    const groups = SearchComponent.computePatternGroups(dummyDocs, 'interval', 5, 'exact', true, 1);
    expect(groups.length).toBe(1);
    const g = groups[0];
    expect(g.uniqueDocCount).toBe(2);
    expect(g.occurrences.length).toBe(2);
    expect(g.isCompound).toBeTrue();
    // Notes count for 5 merged intervals (6 notes) should be 6
    expect(g.occurrences[0].notes.length).toBe(6);
    // Boundary check: the last note at index 5 ('A') must be included in the notes slice
    expect(g.occurrences[0].notes[5].base).toBe('A');
  });

  it('should extract and not merge pattern occurrences when mergeEnabled is false', () => {
    const dummyDocs: any[] = [
      {
        doc: { id: 'doc-1', textinitium: 'Chant 1' },
        sourceSigle: 'Sigle-1',
        notes: [
          { uuid: 'n1', base: 'C', octave: 4 },
          { uuid: 'n2', base: 'D', octave: 4 },
          { uuid: 'n3', base: 'E', octave: 4 },
          { uuid: 'n4', base: 'F', octave: 4 },
          { uuid: 'n5', base: 'G', octave: 4 },
          { uuid: 'n6', base: 'A', octave: 4 }
        ],
        syllables: [
          { uuid: 's1', text: 'Text 1' }
        ],
        sylIdx: [0, 0, 0, 0, 0, 0],
        sequence: ['+1', '+1', '+1', '+1', '+1']
      },
      {
        doc: { id: 'doc-2', textinitium: 'Chant 2' },
        sourceSigle: 'Sigle-2',
        notes: [
          { uuid: 'm1', base: 'C', octave: 4 },
          { uuid: 'm2', base: 'D', octave: 4 },
          { uuid: 'm3', base: 'E', octave: 4 },
          { uuid: 'm4', base: 'F', octave: 4 },
          { uuid: 'm5', base: 'G', octave: 4 },
          { uuid: 'm6', base: 'A', octave: 4 }
        ],
        syllables: [
          { uuid: 's2', text: 'Text 2' }
        ],
        sylIdx: [0, 0, 0, 0, 0, 0],
        sequence: ['+1', '+1', '+1', '+1', '+1']
      }
    ];

    const groups = SearchComponent.computePatternGroups(dummyDocs, 'interval', 5, 'exact', false, 1);
    expect(groups.length).toBe(1);
    const g = groups[0];
    expect(g.isCompound).toBeFalse();
    expect(g.occurrences[0].notes.length).toBe(5);
  });

  it('should enforce minMergeOverlap when merging contiguous patterns', () => {
    const dummyDocs: any[] = [
      {
        doc: { id: 'doc-1', textinitium: 'Chant 1' },
        sourceSigle: 'Sigle-1',
        notes: [
          { uuid: 'n1', base: 'C', octave: 4 },
          { uuid: 'n2', base: 'D', octave: 4 },
          { uuid: 'n3', base: 'E', octave: 4 },
          { uuid: 'n4', base: 'F', octave: 4 },
          { uuid: 'n5', base: 'G', octave: 4 },
          { uuid: 'n6', base: 'A', octave: 4 }
        ],
        syllables: [
          { uuid: 's1', text: 'Text 1' }
        ],
        sylIdx: [0, 0, 0, 0, 0, 0],
        sequence: ['c4', 'd4', 'e4', 'f4', 'g4', 'a4']
      },
      {
        doc: { id: 'doc-2', textinitium: 'Chant 2' },
        sourceSigle: 'Sigle-2',
        notes: [
          { uuid: 'm1', base: 'C', octave: 4 },
          { uuid: 'm2', base: 'D', octave: 4 },
          { uuid: 'm3', base: 'E', octave: 4 },
          { uuid: 'm4', base: 'F', octave: 4 },
          { uuid: 'm5', base: 'G', octave: 4 },
          { uuid: 'm6', base: 'A', octave: 4 }
        ],
        syllables: [
          { uuid: 's2', text: 'Text 2' }
        ],
        sylIdx: [0, 0, 0, 0, 0, 0],
        sequence: ['c4', 'd4', 'e4', 'f4', 'g4', 'a4']
      }
    ];

    // With minMergeOverlap = 4 notes (which is <= actual overlap of 4 shared notes), they should merge
    const groupsMerge1 = SearchComponent.computePatternGroups(dummyDocs, 'pitch', 5, 'exact', true, 4);
    expect(groupsMerge1.length).toBe(1);
    expect(groupsMerge1[0].isCompound).toBeTrue();
    expect(groupsMerge1[0].occurrences[0].notes.length).toBe(6);

    // With minMergeOverlap = 6 notes (which is > actual overlap of 4 shared notes), they should not merge
    const groupsMerge2 = SearchComponent.computePatternGroups(dummyDocs, 'pitch', 5, 'exact', true, 6);
    expect(groupsMerge2.length).toBe(2);
    expect(groupsMerge2[0].isCompound).toBeFalse();
    expect(groupsMerge2[0].occurrences[0].notes.length).toBe(5);
  });
});
