import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { APIService, SourceQuery, DocumentQuery, Source, Document, ProjectSettings } from '../api.service';
import { UserService, User } from '../user.service';
import { Subscription, forkJoin } from 'rxjs';
import { PageTitleService } from '../page-title.service';
import * as VM from '../types/model';

// ─── Column config ────────────────────────────────────────────────────────────

export interface ColDef<T> {
  key: keyof T | string;
  label: string;
  visible: boolean;
}

const DEFAULT_SRC_COLS: ColDef<Source>[] = [
  { key: 'quellensigle',         label: 'Source Siglum',     visible: true  },
  { key: 'datierung',            label: 'Dating',            visible: false },
  { key: 'herkunftsregion',      label: 'Region of Origin',  visible: false },
  { key: 'herkunftsort',         label: 'Place of Origin',   visible: true  },
  { key: 'herkunftsinstitution', label: 'Institution',       visible: true  },
  { key: 'ordenstradition',      label: 'Order Tradition',   visible: false },
  { key: 'quellentyp',           label: 'Source Type',       visible: true  },
  { key: 'bibliotheksort',       label: 'Library Location',  visible: false },
  { key: 'bibliothek',           label: 'Library',           visible: false },
  { key: 'bibliothekssignatur',  label: 'Library Signature', visible: false },
];

const DEFAULT_DOC_COLS: ColDef<Document>[] = [
  { key: 'dokumenten_id',            label: 'Document ID',        visible: true  },
  { key: 'textinitium',              label: 'Text Incipit',       visible: true  },
  { key: 'gattung1',                 label: 'Genre 1',            visible: true  },
  { key: 'gattung2',                 label: 'Genre 2',            visible: false },
  { key: 'festtag',                  label: 'Feast Day',          visible: true  },
  { key: 'feier',                    label: 'Celebration',        visible: false },
  { key: 'foliostart',               label: 'Folio Start',        visible: false },
  { key: 'zeilenstart',              label: 'Line Start',         visible: false },
  { key: 'druckausgabe',             label: 'Print Edition',      visible: false },
  { key: 'bibliographischerverweis', label: 'Bibliographic Ref.', visible: false },
  { key: 'editionsstatus',           label: 'Edition Status',     visible: false },
];

const SRC_RES_KEY  = 'monodi_search_src_cols';
const DOC_RES_KEY  = 'monodi_search_doc_cols';
const RECENT_KEY   = 'monodi_search_recent';

// ─── Quick-search result ──────────────────────────────────────────────────────

export interface QuickResult {
  kind: 'source' | 'document';
  id: string;
  sourceId?: string;
  title: string;
  subtitle: string;
  extra: string;
}

// ─── Melody-search result ─────────────────────────────────────────────────────

export interface MelodyResult {
  document: Document;
  sourceSigle: string;
  noteCount: number;
}

// ─── Transcription text + melody utilities ────────────────────────────────────

/** Walk every container recursively and call cb on each ZeileContainer. */
function walkZeilen(children: any[], cb: (zeile: any) => void) {
  if (!Array.isArray(children)) return;
  for (const child of children) {
    if (child?.kind === 'ZeileContainer') {
      cb(child);
    } else if (Array.isArray(child?.children)) {
      walkZeilen(child.children, cb);
    }
  }
}

/**
 * Extract all syllable texts and reconstruct words.
 * Syllables end with '-' for mid-word breaks; strip those to get full words.
 * Returns both the hyphenated and dehyphenated form so both match.
 */
function extractSyllableText(root: VM.RootContainer): string {
  const texts: string[] = [];
  walkZeilen(root.children, zeile => {
    for (const part of (zeile.children || [])) {
      if (part?.kind === 'Syllable' && part.text) {
        texts.push(part.text as string);
      }
    }
  });
  const joined = texts.join('');           // e.g. "Al-le-lu-ia"
  const clean  = joined.replace(/-/g, ''); // e.g. "Alleluia"
  return joined + ' ' + clean;
}

/**
 * Extract all notes from a RootContainer using the same traversal as
 * the model's allNotes() helper (spaced → nonSpaced → grouped).
 */
function extractNoteArray(root: VM.RootContainer): VM.Note[] {
  const result: VM.Note[] = [];
  walkZeilen(root.children, zeile => {
    for (const part of (zeile.children || [])) {
      if (part?.kind === 'Syllable') {
        const syl = part as VM.Syllable;
        for (const sp of (syl.notes?.spaced ?? [])) {
          for (const ns of (sp.nonSpaced ?? [])) {
            for (const n of (ns.grouped ?? [])) {
              result.push(n);
            }
          }
        }
      }
    }
  });
  return result;
}

function toPitchNames(notes: VM.Note[], withOctave: boolean): string[] {
  return notes.map(n => withOctave ? `${n.base}${n.octave}` : n.base);
}

function toContour(notes: VM.Note[]): string[] {
  const result: string[] = [];
  for (let i = 1; i < notes.length; i++) {
    const p = notes[i - 1].octave * 7 + VM.baseNoteIndexes[notes[i - 1].base];
    const c = notes[i].octave * 7 + VM.baseNoteIndexes[notes[i].base];
    result.push(c > p ? 'u' : c < p ? 'd' : 'r');
  }
  return result;
}

function sequenceMatches(sequence: string[], pattern: string[]): boolean {
  if (pattern.length === 0 || sequence.length < pattern.length) return false;
  outer: for (let i = 0; i <= sequence.length - pattern.length; i++) {
    for (let j = 0; j < pattern.length; j++) {
      if (sequence[i + j].toLowerCase() !== pattern[j].toLowerCase()) continue outer;
    }
    return true;
  }
  return false;
}

function parsePattern(raw: string): string[] {
  return raw.trim().split(/\s+/).filter(s => s.length > 0);
}

// ─── Component ────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-search',
  templateUrl: './search.component.html',
  styleUrls: ['./search.component.css']
})
export class SearchComponent implements OnInit, OnDestroy {
  activeTab: 'quick' | 'sources' | 'documents' | 'melody' = 'quick';
  user: User | null = null;
  subs: Subscription[] = [];
  settings: ProjectSettings | null = null;

  // ── Melody stats (shown in template) ─────────────────────────────────────
  melodyScanned = 0;
  melodyWithNotes = 0;

  // ── Quick / Full-text search ──────────────────────────────────────────────
  quickText = '';
  quickResults: QuickResult[] = [];
  quickSearched = false;
  quickSearching = false;

  // ── Source search ─────────────────────────────────────────────────────────
  sourceQuery: SourceQuery = {};
  sourceResults: Source[] = [];
  sourceSearched = false;
  sourceSearching = false;
  srcSortCol = '';
  srcSortAsc = true;
  showSrcColPicker = false;
  srcResultCols: ColDef<Source>[] = [];

  // ── Document search ───────────────────────────────────────────────────────
  documentQuery: DocumentQuery = {
    dokumenten_id: undefined,
    gattung1: undefined,
    gattung2: undefined,
    festtag: undefined,
    feier: undefined,
    textinitium: undefined,
    bibliographischerverweis: undefined,
    druckausgabe: undefined,
    zeilenstart: undefined,
    foliostart: undefined,
    kommentar: undefined,
  };
  documentResults: Document[] = [];
  documentSearched = false;
  documentSearching = false;
  docSortCol = '';
  docSortAsc = true;
  showDocColPicker = false;
  docResultCols: ColDef<Document>[] = [];

  // ── Melody search ─────────────────────────────────────────────────────────
  melodyPattern = '';
  melodySearchType: 'pitch' | 'contour' = 'pitch';
  melodyWithOctave = false;
  melodyResults: MelodyResult[] = [];
  melodySearched = false;
  melodySearching = false;

  // ── Recent searches ───────────────────────────────────────────────────────
  recentSearches: string[] = [];

  constructor(
    private api: APIService,
    private router: Router,
    private userService: UserService,
    private pageTitle: PageTitleService
  ) {
    this.loadCols();
    this.loadRecentSearches();
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  ngOnInit() {
    this.pageTitle.set('Search');
    this.subs.push(this.userService.user.subscribe(user => {
      this.user = user;
      if (this.user) {
        this.api.getSettings(this.user.token).subscribe(res => {
          if (res.kind === 'SettingsRetrieved') this.settings = res.settings;
        });
      }
    }));
  }

  ngOnDestroy() { this.subs.forEach(s => s.unsubscribe()); }

  // ── Quick search ──────────────────────────────────────────────────────────

  searchQuick() {
    if (!this.user || !this.quickText.trim()) return;
    this.quickSearching = true;
    this.quickSearched = false;
    this.addRecentSearch(this.quickText);
    const q = this.quickText.toLowerCase();

    // Load everything at once; include transcription text in the document search
    forkJoin({
      sources: this.api.listSources(this.user.token),
      docs: this.api.listDocuments(this.user.token),
      notes: this.api.getAllDocumentNotes(this.user.token),
    }).subscribe(({ sources, docs, notes }) => {
      const results: QuickResult[] = [];
      const allNotes = notes as unknown as { [id: string]: VM.RootContainer };

      if (sources.kind === 'SourcesRetrieved') {
        for (const s of sources.sources) {
          const txt = Object.values(s).filter(v => typeof v === 'string').join(' ').toLowerCase();
          if (txt.includes(q)) {
            results.push({
              kind: 'source',
              id: s.id!,
              title: s.quellensigle || s.bibliothekssignatur || '(no siglum)',
              subtitle: [s.herkunftsinstitution, s.herkunftsort].filter(Boolean).join(', '),
              extra: [s.quellentyp, s.datierung].filter(Boolean).join(' · '),
            });
          }
        }
      }

      if (docs.kind === 'DocumentsRetrieved') {
        for (const d of docs.documents) {
          const metaTxt = Object.values(d).filter(v => typeof v === 'string').join(' ').toLowerCase();
          // Also search syllable text from the transcription
          const root = allNotes[d.id];
          const sylTxt = root ? extractSyllableText(root).toLowerCase() : '';
          if (metaTxt.includes(q) || sylTxt.includes(q)) {
            results.push({
              kind: 'document',
              id: d.id,
              sourceId: d.quelle_id,
              title: d.textinitium || d.dokumenten_id || '(no incipit)',
              subtitle: [d.gattung1, d.gattung2].filter(Boolean).join(' / '),
              extra: [d.festtag, d.feier].filter(Boolean).join(' · '),
            });
          }
        }
      }

      this.quickResults = results;
      this.quickSearched = true;
      this.quickSearching = false;
    });
  }

  // ── Source search ─────────────────────────────────────────────────────────

  searchSources() {
    if (!this.user) return;
    this.sourceSearching = true;
    this.sourceSearched = false;
    this.api.querySources(this.user.token, this.sourceQuery).subscribe(res => {
      if (res.kind === 'SourcesRetrieved') this.sourceResults = res.sources;
      this.sourceSearched = true;
      this.sourceSearching = false;
    });
  }

  clearSourceQuery() {
    this.sourceQuery = {};
    this.sourceResults = [];
    this.sourceSearched = false;
    this.srcSortCol = '';
  }

  // ── Document search ───────────────────────────────────────────────────────

  searchDocuments() {
    if (!this.user) return;
    this.documentSearching = true;
    this.documentSearched = false;
    this.api.queryDocuments(this.user.token, this.documentQuery).subscribe(res => {
      if (res.kind === 'DocumentsRetrieved') this.documentResults = res.documents;
      this.documentSearched = true;
      this.documentSearching = false;
    });
  }

  clearDocumentQuery() {
    this.documentQuery = {
      dokumenten_id: undefined, gattung1: undefined, gattung2: undefined,
      festtag: undefined, feier: undefined, textinitium: undefined,
      bibliographischerverweis: undefined, druckausgabe: undefined,
      zeilenstart: undefined, foliostart: undefined, kommentar: undefined,
    };
    this.documentResults = [];
    this.documentSearched = false;
    this.docSortCol = '';
  }

  // ── Melody search ─────────────────────────────────────────────────────────

  searchMelody() {
    if (!this.user || !this.melodyPattern.trim()) return;
    this.melodySearching = true;
    this.melodySearched = false;
    this.melodyScanned = 0;
    this.melodyWithNotes = 0;
    const pattern = parsePattern(this.melodyPattern);

    forkJoin({
      docsRes:    this.api.listDocuments(this.user.token),
      notesRes:   this.api.getAllDocumentNotes(this.user.token),
      sourcesRes: this.api.listSources(this.user.token),
    }).subscribe(({ docsRes, notesRes, sourcesRes }) => {
      const allDocs    = docsRes.kind    === 'DocumentsRetrieved' ? docsRes.documents    : [];
      const allNotes   = notesRes as unknown as { [id: string]: VM.RootContainer };
      const allSources = sourcesRes.kind === 'SourcesRetrieved'  ? sourcesRes.sources   : [];
      const results: MelodyResult[] = [];

      this.melodyScanned = allDocs.length;

      for (const doc of allDocs) {
        const root = allNotes[doc.id];
        if (!root) continue;

        const noteArr = extractNoteArray(root);
        if (noteArr.length === 0) continue;
        this.melodyWithNotes++;

        const sequence = this.melodySearchType === 'pitch'
          ? toPitchNames(noteArr, this.melodyWithOctave)
          : toContour(noteArr);

        if (sequenceMatches(sequence, pattern)) {
          const source = allSources.find(s => s.id === doc.quelle_id);
          results.push({
            document: doc,
            sourceSigle: source?.quellensigle ?? '',
            noteCount: noteArr.length,
          });
        }
      }

      this.melodyResults = results;
      this.melodySearched = true;
      this.melodySearching = false;
    });
  }

  get melodyPatternHint(): string {
    if (this.melodySearchType === 'pitch') {
      return this.melodyWithOctave
        ? 'e.g. C4 D4 E4 F4  (space-separated pitch+octave, case-insensitive)'
        : 'e.g. C D E F G  (space-separated note names, case-insensitive)';
    }
    return 'e.g. u u d u r d  (u=up, d=down, r=repeat, space-separated)';
  }

  // ── Sorting ───────────────────────────────────────────────────────────────

  sortBy(col: string, which: 'src' | 'doc') {
    if (which === 'src') {
      if (this.srcSortCol === col) this.srcSortAsc = !this.srcSortAsc;
      else { this.srcSortCol = col; this.srcSortAsc = true; }
    } else {
      if (this.docSortCol === col) this.docSortAsc = !this.docSortAsc;
      else { this.docSortCol = col; this.docSortAsc = true; }
    }
  }

  private sortArr<T>(arr: T[], col: string, asc: boolean): T[] {
    if (!col) return arr;
    return [...arr].sort((a, b) => {
      const av = String((a as any)[col] ?? '').toLowerCase();
      const bv = String((b as any)[col] ?? '').toLowerCase();
      return asc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }

  get sortedSourceResults(): Source[] {
    return this.sortArr(this.sourceResults, this.srcSortCol, this.srcSortAsc);
  }
  get sortedDocumentResults(): Document[] {
    return this.sortArr(this.documentResults, this.docSortCol, this.docSortAsc);
  }
  get visibleSrcCols() { return this.srcResultCols.filter(c => c.visible); }
  get visibleDocCols() { return this.docResultCols.filter(c => c.visible); }

  sortIcon(col: string, which: 'src' | 'doc'): string {
    const activeCol = which === 'src' ? this.srcSortCol : this.docSortCol;
    const asc = which === 'src' ? this.srcSortAsc : this.docSortAsc;
    if (activeCol !== col) return 'bi bi-chevron-expand text-muted opacity-50';
    return asc ? 'bi bi-chevron-up' : 'bi bi-chevron-down';
  }

  // ── CSV export ────────────────────────────────────────────────────────────

  exportSourcesCSV() {
    this.exportCSV(this.sortedSourceResults, this.visibleSrcCols, 'sources.csv');
  }

  exportDocumentsCSV() {
    this.exportCSV(this.sortedDocumentResults, this.visibleDocCols, 'documents.csv');
  }

  exportMelodyCSV() {
    const rows = this.melodyResults.map(r => ({
      sourceSigle: r.sourceSigle,
      dokumenten_id: r.document.dokumenten_id,
      textinitium: r.document.textinitium,
      gattung1: r.document.gattung1,
      festtag: r.document.festtag,
      noteCount: r.noteCount,
    }));
    const cols = [
      { key: 'sourceSigle', label: 'Source Siglum', visible: true },
      { key: 'dokumenten_id', label: 'Document ID', visible: true },
      { key: 'textinitium', label: 'Text Incipit', visible: true },
      { key: 'gattung1', label: 'Genre', visible: true },
      { key: 'festtag', label: 'Feast Day', visible: true },
      { key: 'noteCount', label: 'Note Count', visible: true },
    ];
    this.exportCSV(rows, cols, 'melody-results.csv');
  }

  private exportCSV(data: any[], cols: ColDef<any>[], filename: string) {
    const visCols = cols.filter(c => c.visible);
    const header = visCols.map(c => `"${c.label}"`).join(',');
    const rows = data.map(row =>
      visCols.map(c => `"${String((row as any)[c.key] ?? '').replace(/"/g, '""')}"`).join(',')
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  goToSource(id: string) { this.router.navigate(['/source', id]); }
  goToDocument(sourceId: string, docId: string) { this.router.navigate(['/document', sourceId, docId]); }

  goToQuickResult(r: QuickResult) {
    if (r.kind === 'source') this.goToSource(r.id);
    else this.goToDocument(r.sourceId!, r.id);
  }

  // ── Column persistence ────────────────────────────────────────────────────

  loadCols() {
    this.srcResultCols = this.loadFromStorage<Source>(SRC_RES_KEY, DEFAULT_SRC_COLS);
    this.docResultCols = this.loadFromStorage<Document>(DOC_RES_KEY, DEFAULT_DOC_COLS);
  }

  private loadFromStorage<T>(key: string, defaults: ColDef<T>[]): ColDef<T>[] {
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const parsed: ColDef<T>[] = JSON.parse(saved);
        return defaults.map(def => {
          const match = parsed.find(p => p.key === def.key);
          return match ? { ...def, visible: match.visible } : def;
        });
      }
    } catch {}
    return defaults.map(c => ({ ...c }));
  }

  saveSrcCols() { localStorage.setItem(SRC_RES_KEY, JSON.stringify(this.srcResultCols)); }
  saveDocCols() { localStorage.setItem(DOC_RES_KEY, JSON.stringify(this.docResultCols)); }

  // ── Recent searches ───────────────────────────────────────────────────────

  loadRecentSearches() {
    try { this.recentSearches = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); }
    catch { this.recentSearches = []; }
  }

  addRecentSearch(q: string) {
    if (!q.trim()) return;
    this.recentSearches = [q, ...this.recentSearches.filter(r => r !== q)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(this.recentSearches));
  }

  applyRecent(q: string) {
    this.quickText = q;
    this.searchQuick();
  }

  countQuickResults(kind: 'source' | 'document'): number {
    return this.quickResults.filter(r => r.kind === kind).length;
  }

  clearRecent() {
    this.recentSearches = [];
    localStorage.removeItem(RECENT_KEY);
  }

  // ── Settings helpers ──────────────────────────────────────────────────────

  addToSettings(category: keyof ProjectSettings, value: string | undefined) {
    if (!value || !value.trim() || !this.settings || !this.user) return;
    const val = value.trim();
    const arr = this.settings[category] as any;
    if (Array.isArray(arr) && !arr.includes(val)) {
      arr.push(val);
      this.api.updateSettings(this.user.token, this.settings).subscribe(() => {
        alert('Added to global options!');
      });
    }
  }
}
