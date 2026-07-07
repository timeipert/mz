import { TestBed } from '@angular/core/testing';
import { MeiExportService } from './mei-export.service';
import { 
  emptyRootContainer, 
  emptyFormteilContainer, 
  emptyZeileContainer, 
  emptySyllable, 
  emptyClef, 
  DocumentType, 
  BaseNote, 
  NoteType 
} from './types/model';
import { ProjectSettings } from './api.service';

describe('MeiExportService', () => {
  let service: MeiExportService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(MeiExportService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should export a valid root container to MEI XML', () => {
    // 1. Build ONE small fixture
    const root = emptyRootContainer();
    const formteil = emptyFormteilContainer(DocumentType.Level1, []);
    const zeile = emptyZeileContainer(1);
    
    // Create the C-clef
    const clef = emptyClef();
    clef.shape = 'C';
    
    // Create two syllables: "Glo" and "ri"
    const syl1 = emptySyllable(1);
    syl1.text = 'Glo';
    syl1.notes = {
      spaced: [{
        nonSpaced: [{
          grouped: [
            {
              uuid: 'note-1',
              base: BaseNote.G,
              octave: 4,
              noteType: NoteType.Normal,
              liquescent: false,
              focus: false
            }
          ]
        }]
      }]
    };
    
    const syl2 = emptySyllable(1);
    syl2.text = 'ri';
    syl2.notes = {
      spaced: [{
        nonSpaced: [{
          grouped: [
            {
              uuid: 'note-2',
              base: BaseNote.A,
              octave: 4,
              noteType: NoteType.Normal,
              liquescent: false,
              focus: false
            },
            {
              uuid: 'note-3',
              base: BaseNote.B,
              octave: 4,
              noteType: NoteType.Normal,
              liquescent: false,
              focus: false
            }
          ]
        }]
      }]
    };
    
    zeile.children = [clef, syl1, syl2];
    formteil.children = [zeile];
    root.children = [formteil];

    // 2. Perform the export
    const xmlString = (service as any).legacyExport(root, null);
    
    // 3. (a) export produces a parseable XML string (use DOMParser, assert no parsererror element)
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, 'application/xml');
    const parserError = xmlDoc.querySelector('parsererror');
    expect(parserError).toBeNull();

    // 4. (b) the expected elements exist with expected counts (2 syllable elements, correct number of nc elements)
    const syllableElements = xmlDoc.getElementsByTagName('syllable');
    expect(syllableElements.length).toBe(2);

    const ncElements = xmlDoc.getElementsByTagName('nc');
    expect(ncElements.length).toBe(3); // 1 from "Glo" + 2 from "ri"

    // 5. (c) note pitch/octave attributes match the fixture
    // Note 1: G4
    expect(ncElements[0].getAttribute('pname')).toBe('g');
    expect(ncElements[0].getAttribute('oct')).toBe('4');

    // Note 2: A4
    expect(ncElements[1].getAttribute('pname')).toBe('a');
    expect(ncElements[1].getAttribute('oct')).toBe('4');

    // Note 3: B4
    expect(ncElements[2].getAttribute('pname')).toBe('b');
    expect(ncElements[2].getAttribute('oct')).toBe('4');

    // 6. (d) syllable text appears in the text tag (default textTag is 'syl')
    const sylElements = xmlDoc.getElementsByTagName('syl');
    expect(sylElements.length).toBe(2);
    expect(sylElements[0].textContent).toBe('Glo');
    expect(sylElements[1].textContent).toBe('ri');

    // 7. (e) changing one tag name in the mapping changes the emitted tag
    const customSettings: ProjectSettings = {
      meiMappings: {
        syllable: { tag: 'my-custom-syllable', textTag: 'my-custom-syl' }
      }
    } as any;

    const customXmlString = (service as any).legacyExport(root, customSettings);
    const customXmlDoc = parser.parseFromString(customXmlString, 'application/xml');
    
    const customSyllables = customXmlDoc.getElementsByTagName('my-custom-syllable');
    expect(customSyllables.length).toBe(2);

    const customSyls = customXmlDoc.getElementsByTagName('my-custom-syl');
    expect(customSyls.length).toBe(2);
    expect(customSyls[0].textContent).toBe('Glo');
    expect(customSyls[1].textContent).toBe('ri');
  });
});
