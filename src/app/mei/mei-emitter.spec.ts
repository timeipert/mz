import { TestBed } from '@angular/core/testing';
import { MeiExportService } from '../mei-export.service';
import { emitMei } from './mei-emitter';
import { defaultMeiProfile } from './mei-mapping.model';
import { 
  emptyRootContainer, 
  emptyFormteilContainer, 
  emptyZeileContainer, 
  emptySyllable, 
  emptyClef, 
  emptyParatextContainer,
  DocumentType, 
  BaseNote, 
  NoteType,
  ContainerKind,
  LinePartKind
} from '../types/model';
import { Document as MonodiDocument } from '../api.service';

describe('MeiEmitter', () => {
  let oldExporter: MeiExportService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    oldExporter = TestBed.inject(MeiExportService);
  });

  // Helper to compare two DOM nodes recursively
  function compareDOM(el1: Element, el2: Element) {
    expect(el1.tagName).toBe(el2.tagName);
    expect(el1.namespaceURI).toBe(el2.namespaceURI);
    
    // Compare attributes
    const attrs1 = Array.from(el1.attributes).sort((a, b) => a.name.localeCompare(b.name));
    const attrs2 = Array.from(el2.attributes).sort((a, b) => a.name.localeCompare(b.name));
    
    expect(attrs1.length).toBe(attrs2.length);
    for (let i = 0; i < attrs1.length; i++) {
      expect(attrs1[i].name).toBe(attrs2[i].name);
      expect(attrs1[i].value).toBe(attrs2[i].value);
    }
    
    // Compare child element nodes
    const children1 = Array.from(el1.children);
    const children2 = Array.from(el2.children);
    
    if (children1.length === 0 && children2.length === 0) {
      expect(el1.textContent?.trim()).toBe(el2.textContent?.trim());
    }
    
    expect(children1.length).toBe(children2.length);
    for (let i = 0; i < children1.length; i++) {
      compareDOM(children1[i], children2[i]);
    }
  }

  it('should generate MEI XML that is deep-equal to the old exporter output', () => {
    // 1. Build a rich fixture
    const root = emptyRootContainer();
    const formteil = emptyFormteilContainer(DocumentType.Level1, []);
    const zeile = emptyZeileContainer(1);
    
    const clef = emptyClef();
    clef.shape = 'C';

    const paratext = emptyParatextContainer();
    paratext.text = 'Rubrica Test';
    
    // Syllable 1: "Glo" with 2 notes (1 liquescent, 1 connection gap)
    const syl1 = emptySyllable(1);
    syl1.text = 'Glo';
    syl1.notes = {
      spaced: [{
        nonSpaced: [
          {
            grouped: [
              {
                uuid: 'note-1',
                base: BaseNote.G,
                octave: 4,
                noteType: NoteType.Normal,
                liquescent: true, // liquescent
                focus: false
              }
            ]
          },
          {
            grouped: [
              {
                uuid: 'note-2',
                base: BaseNote.A,
                octave: 4,
                noteType: NoteType.Normal,
                liquescent: false,
                focus: false
              }
            ]
          }
        ]
      }]
    };

    // Note 1 (the first note in first nonSpaced group) should have connection gap isConnectionGap = true 
    // because gIndex (0) < nonSpaced.length - 1 (1).

    // Syllable 2: "ri" with 2 normal notes
    const syl2 = emptySyllable(1);
    syl2.text = 'ri';
    syl2.notes = {
      spaced: [{
        nonSpaced: [{
          grouped: [
            {
              uuid: 'note-3',
              base: BaseNote.B,
              octave: 4,
              noteType: NoteType.Normal,
              liquescent: false,
              focus: false
            },
            {
              uuid: 'note-4',
              base: BaseNote.C,
              octave: 5,
              noteType: NoteType.Normal,
              liquescent: false,
              focus: false
            }
          ]
        }]
      }]
    };
    
    zeile.children = [clef, syl1, syl2, paratext as any];
    formteil.children = [zeile];
    root.children = [formteil];

    const meta: MonodiDocument = {
      id: 'doc-123',
      dokumenten_id: 'Test-Doc',
      textinitium: 'Gloria in excelsis',
      kommentar: 'Main test document comments',
      gattung1: 'Antiphon',
      gattung2: 'Intro',
      festtag: 'Christmas',
      feier: 'Mass',
      quelle_id: 'q-1',
      version: 1
    } as any;

    // 2. Export via both methods
    const oldXml = (oldExporter as any).legacyExport(root, null, meta);
    const newXml = emitMei(root, defaultMeiProfile(), meta);

    // 3. Parse and assert deep-equality
    const parser = new DOMParser();
    const docOld = parser.parseFromString(oldXml, 'application/xml');
    const docNew = parser.parseFromString(newXml, 'application/xml');

    expect(docOld.querySelector('parsererror')).toBeNull();
    expect(docNew.querySelector('parsererror')).toBeNull();

    compareDOM(docOld.documentElement, docNew.documentElement);
  });

  it('should flatten ncs into syllable when neume entity is disabled', () => {
    const root = emptyRootContainer();
    const formteil = emptyFormteilContainer(DocumentType.Level1, []);
    const zeile = emptyZeileContainer(1);
    const syl = emptySyllable(1);
    syl.text = 'A';
    syl.notes = {
      spaced: [{
        nonSpaced: [{
          grouped: [{
            uuid: 'n-1',
            base: BaseNote.G,
            octave: 4,
            noteType: NoteType.Normal,
            liquescent: false,
            focus: false
          }]
        }]
      }]
    };
    zeile.children = [syl];
    formteil.children = [zeile];
    root.children = [formteil];

    const profile = defaultMeiProfile();
    profile.entities.neume.enabled = false;

    const xml = emitMei(root, profile);
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');

    expect(doc.querySelector('neume')).toBeNull();
    expect(doc.querySelector('syllable > nc')).not.toBeNull();
  });

  it('should add wrappers around syllable when configured', () => {
    const root = emptyRootContainer();
    const formteil = emptyFormteilContainer(DocumentType.Level1, []);
    const zeile = emptyZeileContainer(1);
    const syl = emptySyllable(1);
    zeile.children = [syl];
    formteil.children = [zeile];
    root.children = [formteil];

    const profile = defaultMeiProfile();
    profile.entities.syllable.wrappers = ['my-syl-wrapper'];

    const xml = emitMei(root, profile);
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');

    expect(doc.querySelector('my-syl-wrapper > syllable')).not.toBeNull();
  });

  it('should render static attribute rules and respect omitIfEmpty', () => {
    const root = emptyRootContainer();
    const formteil = emptyFormteilContainer(DocumentType.Level1, []);
    const zeile = emptyZeileContainer(1);
    const clef = emptyClef();
    clef.shape = 'C';
    zeile.children = [clef];
    formteil.children = [zeile];
    root.children = [formteil];

    const profile = defaultMeiProfile();
    
    // Add static attribute rule
    profile.entities.clef.attributes.push({
      name: 'custom-static',
      source: 'static',
      value: 'static-value'
    });

    // Add field attribute rule that will be empty and should be omitted
    profile.entities.clef.attributes.push({
      name: 'custom-empty',
      source: 'field',
      value: 'non-existent-field',
      omitIfEmpty: true
    });

    // Add field attribute rule that will be empty and should NOT be omitted (thus sets empty string)
    profile.entities.clef.attributes.push({
      name: 'custom-empty-present',
      source: 'field',
      value: 'non-existent-field',
      omitIfEmpty: false
    });

    const xml = emitMei(root, profile);
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');

    const clefEl = doc.querySelector('clef');
    expect(clefEl).not.toBeNull();
    expect(clefEl!.getAttribute('custom-static')).toBe('static-value');
    expect(clefEl!.hasAttribute('custom-empty')).toBe(false);
    expect(clefEl!.getAttribute('custom-empty-present')).toBe('');
  });

  it('should produce identical output for legacy comments without new fields', () => {
    const root = emptyRootContainer();
    const comment = {
      startUUID: 'u1',
      endUUID: 'u2',
      text: 'legacy note text',
      emendation: true
    };
    root.comments = [comment];
    const profile = defaultMeiProfile();
    profile.emitHeader = true;

    const xml = emitMei(root, profile);
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');

    const annot = doc.querySelector('annot');
    expect(annot).not.toBeNull();
    expect(annot!.getAttribute('type')).toBe('emendation');
    expect(annot!.hasAttribute('cert')).toBe(false);
    expect(doc.querySelector('sourceDesc')).toBeNull();
  });

  it('should enrich header with witnesses, certainty, type list, and nested annotations', () => {
    const root = emptyRootContainer();
    const comment = {
      startUUID: 'u1',
      endUUID: 'u2',
      text: 'enriched note text',
      emendation: true,
      category: 'variant' as any,
      intervention: 'correction' as any,
      certainty: 'high' as any,
      readingWitnesses: ['WitnessA', 'WitnessB'],
      lines: [
        { kind: 'ZeileContainer', id: 'z1', children: [] } as any,
        { kind: 'ZeileContainer', id: 'z2', children: [] } as any
      ]
    };
    root.comments = [comment];
    const profile = defaultMeiProfile();
    profile.emitHeader = true;

    const xml = emitMei(root, profile, undefined, 'MainSource');
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');

    // Test sourceDesc
    const sourceDesc = doc.querySelector('sourceDesc');
    expect(sourceDesc).not.toBeNull();
    const sources = sourceDesc!.querySelectorAll('source');
    expect(sources.length).toBe(3); // MainSource, WitnessA, WitnessB
    expect(sources[0].getAttribute('xml:id')).toBe('wit-mainsource');
    expect(sources[1].getAttribute('xml:id')).toBe('wit-witnessa');

    // Test annot
    const annot = doc.querySelector('notesStmt > annot');
    expect(annot).not.toBeNull();
    expect(annot!.getAttribute('type')).toBe('emendation correction cat:variant');
    expect(annot!.getAttribute('cert')).toBe('high');

    // Test nested annot readings
    const nestedAnnots = annot!.querySelectorAll('annot');
    expect(nestedAnnots.length).toBe(2);
    expect(nestedAnnots[0].getAttribute('source')).toBe('#wit-witnessa');
    expect(nestedAnnots[1].getAttribute('source')).toBe('#wit-witnessb');
    const nestedPtrs = annot!.querySelectorAll('ptr');
    expect(nestedPtrs.length).toBe(2);
    expect(nestedPtrs[0].getAttribute('target')).toBe('#m-comment-0-reading-0');
  });

  it('should not wrap notes inline if inlineInterventions is false', () => {
    const root = emptyRootContainer();
    const formteil = emptyFormteilContainer(DocumentType.Level1, []);
    const zeile = emptyZeileContainer(1);
    const syl = emptySyllable(1);
    syl.notes = {
      spaced: [
        {
          nonSpaced: [
            {
              grouped: [
                { uuid: 'note-1', base: BaseNote.C, noteType: NoteType.Normal } as any
              ]
            }
          ]
        }
      ]
    };
    zeile.children = [syl];
    formteil.children = [zeile];
    root.children = [formteil];

    const comment = {
      startUUID: 'note-1',
      endUUID: 'note-1',
      text: 'unclear comment',
      intervention: 'unclear' as any,
      certainty: 'high' as any
    };
    root.comments = [comment];

    const profile = defaultMeiProfile();
    profile.inlineInterventions = false;

    const xml = emitMei(root, profile);
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');

    const noteEl = doc.querySelector('nc');
    expect(noteEl).not.toBeNull();
    expect(doc.querySelector('unclear')).toBeNull();
  });

  it('should not wrap notes inline even when inlineInterventions is true (due to MEI 5 schema validity constraints at nc level)', () => {
    const root = emptyRootContainer();
    const formteil = emptyFormteilContainer(DocumentType.Level1, []);
    const zeile = emptyZeileContainer(1);
    const syl = emptySyllable(1);
    syl.notes = {
      spaced: [
        {
          nonSpaced: [
            {
              grouped: [
                { uuid: 'note-1', base: BaseNote.C, noteType: NoteType.Normal } as any
              ]
            }
          ]
        }
      ]
    };
    zeile.children = [syl];
    formteil.children = [zeile];
    root.children = [formteil];

    const comment = {
      startUUID: 'note-1',
      endUUID: 'note-1',
      text: 'unclear comment',
      intervention: 'unclear' as any,
      certainty: 'high' as any
    };
    root.comments = [comment];

    const profile = defaultMeiProfile();
    profile.inlineInterventions = true;

    const xml = emitMei(root, profile);
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');

    const noteEl = doc.querySelector('nc');
    expect(noteEl).not.toBeNull();
    expect(doc.querySelector('unclear')).toBeNull();
  });
});
