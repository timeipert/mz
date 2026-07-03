import { Component, OnInit, OnDestroy, AfterViewChecked, ChangeDetectorRef } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { APIService, SourceQuery, DocumentQuery, Source, Document, ProjectSettings } from '../api.service';
import { UserService, User } from '../user.service';
import { Subscription, forkJoin, Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { PageTitleService } from '../page-title.service';
import { NotesStore } from '../notes-store';
import * as VM from '../types/model';
import { textWidth } from '../../utils';
import * as localforage from 'localforage';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import 'svg2pdf.js';
import {
  LoadedDoc,
  PatternOccurrence,
  PatternGroup,
  arrayLevenshtein,
  levenshteinDistance,
  computePatternGroups,
  toPitchNames,
  toContour,
  toIntervals
} from './pattern-algo';

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

const SYNOPSIS_COLS_KEY = 'monodi_synopsis_cols';
const DEFAULT_SYNOPSIS_COLS: ColDef<Document>[] = [
  { key: 'dokumenten_id',            label: 'Document ID / Siglum', visible: true  },
  { key: 'textinitium',              label: 'Text Incipit',         visible: true  },
  { key: 'festtag',                  label: 'Feast Day',            visible: true  },
  { key: 'feier',                    label: 'Celebration',          visible: true  },
  { key: 'bibliographischerverweis', label: 'Bibliographic Ref.',   visible: true  },
  { key: 'druckausgabe',             label: 'Print Edition',        visible: false },
  { key: 'gattung1',                 label: 'Genre 1',              visible: false },
  { key: 'gattung2',                 label: 'Genre 2',              visible: false },
  { key: 'foliostart',               label: 'Folio Start',          visible: false },
  { key: 'zeilenstart',              label: 'Line Start',           visible: false },
  { key: 'kommentar',                label: 'Commentary',           visible: false },
];

const SRC_RES_KEY  = 'monodi_search_src_cols';
const DOC_RES_KEY  = 'monodi_search_doc_cols';
const RECENT_KEY   = 'monodi_search_recent';

// ─── Quick-search result ──────────────────────────────────────────────────────

export interface TextSnippet {
  before: string;
  match: string;
  after: string;
}

export interface QuickResult {
  kind: 'source' | 'document';
  id: string;
  sourceId?: string;
  title: string;
  subtitle: string;
  extra: string;
  snippet?: TextSnippet;   // present when match was found in transcription text

  /** Relevance score 0–100. 100 = exact-substring match in the title.
   *  Lower scores reflect: match in a less-important field, or fuzzy match
   *  with edit distance > 0. Used to sort results and to render a small
   *  badge so the user can tell strong matches from weak ones at a glance. */
  score: number;
  /** Human-readable label for *where* the match was found, used as a
   *  tooltip on the relevance badge. */
  matchedIn: string;
}

// ─── Melody-search result ─────────────────────────────────────────────────────

export interface MelodyResult {
  document: Document;
  sourceSigle: string;
  noteCount: number;
  matchingSyllables: VM.Syllable[];
  matchSylSet: Set<string>; // Set of matching syllable UUIDs
  matchNoteSet: Set<string>; // Set of matching note UUIDs
  distance?: number;     // Levenshtein distance for display
}

// PatternOccurrence and PatternGroup interfaces are imported from pattern-algo.ts

export interface TimelineDocOccurrence {
  groupId: number;
  occurrence: PatternOccurrence;
  color: string;
  startPct: number;
  endPct: number;
  widthPct: number;
  length: number;
}

export interface TimelineDoc {
  doc: Document;
  sourceSigle: string;
  totalNotes: number;
  occurrences: TimelineDocOccurrence[];
}

// LoadedDoc interface is imported from pattern-algo.ts


// ─── Synoptic Alignment definitions ───────────────────────────────────────────

export interface AlignedLineElement {
  kind: 'clef' | 'syllable' | 'placeholder';
  element: VM.Syllable | VM.Clef | null;
}

export interface AlignedNode {
  kind: 'container' | 'leaf';
  level: number;
  signature: string;
  containers: (VM.FormteilContainer | null)[];
  children: AlignedNode[];
  items: (VM.FormteilChildren | null)[];
  alignedLineElements?: AlignedLineElement[][];
}


// ─── Transcription utilities ──────────────────────────────────────────────────

function walkZeilen(children: any[], cb: (zeile: any) => void) {
  if (!Array.isArray(children)) return;
  for (const child of children) {
    if (child?.kind === 'ZeileContainer') cb(child);
    else if (Array.isArray(child?.children)) walkZeilen(child.children, cb);
  }
}

/** Extract syllables with full neume-group structure preserved. */
function extractSyllables(root: VM.RootContainer): VM.Syllable[] {
  const result: VM.Syllable[] = [];
  walkZeilen(root.children, zeile => {
    for (const part of (zeile.children || [])) {
      if (part?.kind === 'Syllable') {
        result.push(part as VM.Syllable);
      }
    }
  });
  return result;
}

/** Flat note array for pattern matching. Also returns per-note syllable index. */
function flattenNotes(syllables: VM.Syllable[]): { notes: VM.Note[]; sylIdx: number[] } {
  const notes: VM.Note[] = [];
  const sylIdx: number[] = [];
  syllables.forEach((syl, si) => {
    const spaced = syl.notes?.spaced ?? [];
    spaced.forEach(ns => {
      const groups = ns.nonSpaced ?? [];
      groups.forEach(g => {
        const noteList = g.grouped ?? [];
        noteList.forEach(n => { notes.push(n); sylIdx.push(si); });
      });
    });
  });
  return { notes, sylIdx };
}

/**
 * Extract syllable text for full-text matching.
 * Returns both the raw hyphenated form ("Al-le-lu-ia") and the clean form ("Alleluia").
 */
function extractSyllableText(root: VM.RootContainer): string {
  const texts: string[] = [];
  walkZeilen(root.children, zeile => {
    for (const part of (zeile.children || [])) {
      if (part?.kind === 'Syllable' && part.text) texts.push(part.text as string);
    }
  });
  const joined = texts.join('');
  return joined + ' ' + joined.replace(/-/g, '');
}

export { arrayLevenshtein } from './pattern-algo';

export interface SequenceMatch {
  start: number;
  end: number;
  distance: number;
}


function isFuzzySubstring(target: string, query: string, maxDistance: number): { matched: boolean; matchedSub?: string } {
  const N = query.length;
  const M = target.length;
  if (N === 0) return { matched: false };
  if (M === 0) return { matched: false };

  if (N > M + maxDistance) return { matched: false };

  let bestDist = 999;
  let bestSub = '';

  for (let start = 0; start < M; start++) {
    const minLen = Math.max(1, N - maxDistance);
    const maxLen = N + maxDistance;

    for (let len = minLen; len <= maxLen; len++) {
      const end = start + len - 1;
      if (end >= M) break;

      const sub = target.substring(start, end + 1);
      const dist = levenshteinDistance(sub, query);
      if (dist < bestDist) {
        bestDist = dist;
        bestSub = sub;
      }
    }
  }

  return { matched: bestDist <= maxDistance, matchedSub: bestSub };
}

function sequenceDistance(s1: string[], s2: string[]): number {
  const m = s1.length;
  const n = s2.length;
  const dp: number[][] = [];

  for (let i = 0; i <= m; i++) {
    dp[i] = [i];
  }
  for (let j = 1; j <= n; j++) {
    dp[0][j] = j;
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1].toLowerCase() === s2[j - 1].toLowerCase() ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

function findSubsequenceMatches(sequence: string[], pattern: string[], maxDistance: number): SequenceMatch[] {
  const N = pattern.length;
  const M = sequence.length;
  if (N === 0 || M === 0) return [];

  const matches: SequenceMatch[] = [];

  // Iterate over all possible starting positions in the sequence
  for (let start = 0; start < M; start++) {
    const minLen = Math.max(1, N - maxDistance);
    const maxLen = N + maxDistance;

    for (let len = minLen; len <= maxLen; len++) {
      const end = start + len - 1;
      if (end >= M) break;

      const sub = sequence.slice(start, end + 1);
      const dist = sequenceDistance(sub, pattern);
      if (dist <= maxDistance) {
        matches.push({ start, end, distance: dist });
      }
    }
  }

  // Filter overlapping matches, keeping the best one
  matches.sort((a, b) => a.distance - b.distance || (a.end - a.start) - (b.end - b.start));
  const filteredMatches: SequenceMatch[] = [];

  for (const m of matches) {
    let isRedundant = false;
    for (const selected of filteredMatches) {
      if (Math.abs(selected.start - m.start) <= 2 && Math.abs(selected.end - m.end) <= 2) {
        isRedundant = true;
        break;
      }
    }
    if (!isRedundant) {
      filteredMatches.push(m);
    }
  }

  return filteredMatches.sort((a, b) => a.start - b.start);
}

function parseMelodyPattern(raw: string, searchType: 'pitch' | 'contour' | 'interval', withOctave: boolean): string[] {
  const clean = raw.trim();
  if (searchType === 'contour') {
    if (clean.includes(' ')) {
      return clean.split(/\s+/).filter(Boolean).map(p => p.toLowerCase());
    } else {
      return clean.split('').filter(char => !/\s/.test(char)).map(p => p.toLowerCase());
    }
  }

  if (searchType === 'interval') {
    const matches: string[] = [];
    const regex = /([+-]?\d+)/g;
    let match;
    while ((match = regex.exec(clean)) !== null) {
      const num = parseInt(match[1], 10);
      matches.push(num > 0 ? `+${num}` : `${num}`);
    }
    return matches;
  }

  // Pitch matching
  // Note base: A-G, H (case-insensitive)
  // We use a regex that restricts the flat accidental 'b' to only follow a B/b base.
  // Other notes (A, C, D, E, F, G, H) can only have #, ♭, ♯ as accidentals.
  // This prevents 'ab' from being parsed as A-flat instead of note A followed by note B.
  const noteRegex = /(?:([bB])([b#♭♯]?)|([ac-ghAC-GH])([#♭♯]?))([0-9]?)/g;
  const matches: string[] = [];
  let match;
  
  while ((match = noteRegex.exec(clean)) !== null) {
    const isB = match[1] !== undefined;
    const base = (isB ? match[1] : match[3]).toLowerCase();
    const accidental = (isB ? match[2] : match[4]) || '';
    const octave = match[5] || '';

    let note = base;
    // Normalize German notation:
    // H -> B (B-natural)
    // B -> Bb (B-flat)
    if (note === 'h') {
      note = 'b';
    } else if (note === 'b') {
      note = 'bb';
    }

    // Normalize accidental
    let accNorm = accidental.replace(/♭/g, 'b').replace(/♯/g, '#');

    // Combine base and accidental
    if (accNorm) {
      if (note === 'bb' && accNorm === 'b') {
        // already B-flat, do nothing
      } else {
        note += accNorm;
      }
    }

    if (withOctave && octave) {
      note += octave;
    }

    matches.push(note);
  }

  return matches;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// ─── Text snippet ─────────────────────────────────────────────────────────────

/** Find the query in text and return a { before, match, after } snippet. */
function findTextSnippet(text: string, query: string, window = 35): TextSnippet | undefined {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return undefined;

  // Walk back to a word boundary or window limit
  let before = text.slice(Math.max(0, idx - window), idx);
  if (idx - window > 0) before = '…' + before.replace(/^\S+\s/, ''); // trim partial word

  const match = text.slice(idx, idx + query.length);

  let after = text.slice(idx + query.length, idx + query.length + window);
  if (idx + query.length + window < text.length) after = after.replace(/\s\S+$/, '') + '…';

  return { before, match, after };
}

// ─── Melody SVG renderer ──────────────────────────────────────────────────────



// ─── Component ────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-search',
  templateUrl: './search.component.html',
  styleUrls: ['./search.component.css']
})
export class SearchComponent implements OnInit, OnDestroy, AfterViewChecked {
  activeTab: 'quick' | 'sources' | 'documents' | 'melody' = 'quick';
  user: User | null = null;
  subs: Subscription[] = [];
  settings: ProjectSettings | null = null;

  // ── Synoptic Comparison ───────────────────────────────────────────────────
  selectedDocs: Document[] = [];
  showSynopsis = false;
  synopsisLoading = false;
  alignedTree: AlignedNode[] = [];
  docSigles: { [docId: string]: string } = {};
  alignmentMode: 'structure' | 'sequential' | 'melody' | 'text' = 'melody';
  showConsensusText = false;
  showSingleLineSynopsis = false;
  chunkedMelodyRows: AlignedLineElement[][][] = [];
  cachedRootContainers: VM.RootContainer[] = [];
  cachedDocIds: string[] = [];

  // ── Quick / Full-text search ──────────────────────────────────────────────
  quickText = '';
  quickResults: QuickResult[] = [];
  quickSearched = false;
  quickSearching = false;
  quickSearchMode: 'phrase' | 'words-and' | 'words-or' | 'fuzzy' = 'phrase';
  quickMedievalTolerance = true;
  quickFuzzyDistance = 2;

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
    dokumenten_id: undefined, gattung1: undefined, gattung2: undefined,
    festtag: undefined, feier: undefined, textinitium: undefined,
    bibliographischerverweis: undefined, druckausgabe: undefined,
    zeilenstart: undefined, foliostart: undefined, kommentar: undefined,
  };
  documentResults: Document[] = [];
  documentSearched = false;
  documentSearching = false;
  docSortCol = '';
  docSortAsc = true;
  showDocColPicker = false;
  docResultCols: ColDef<Document>[] = [];
  synopsisMetadataCols: ColDef<Document>[] = [];
  showSynopsisColPicker = false;

  // ── Melody search ─────────────────────────────────────────────────────────
  melodyPattern = '';
  melodySearchType: 'pitch' | 'contour' | 'interval' = 'pitch';
  melodyWithOctave = false;
  melodyOnlyWithinSyllables = false;
  melodyResults: MelodyResult[] = [];
  melodySearched = false;
  melodySearching = false;
  melodyScanned = 0;
  melodyWithNotes = 0;
  melodyMaxDistance = 0;

  // ── Search results pagination ─────────────────────────────────────────────
  quickPage = 1;
  quickPageSize = 25;
  sourcesPage = 1;
  sourcesPageSize = 25;
  documentsPage = 1;
  documentsPageSize = 25;
  melodyPage = 1;
  melodyPageSize = 10;

  // ── Recent searches ───────────────────────────────────────────────────────
  recentSearches: string[] = [];

  // ── Pattern analysis state ────────────────────────────────────────────────
  showPatternAnalysis = false;
  patternLength = 8;
  patternType: 'pitch' | 'interval' | 'contour' = 'interval';
  patternWithOctave = false;
  patternStrictness: 'exact' | 'fuzzy' = 'exact';
  patternProgress = { phase: '', current: 0, total: 0, percent: 0 };
  patternSearching = false;
  patternCancelled = false;
  patternGroups: PatternGroup[] = [];
  /**
   * Pattern-list pagination.
   *
   * Pre-redesign we used an ever-growing `visiblePatternGroupsLimit` and a
   * "Show more" button — fine for sequential scanning, but it couldn't
   * support *jumping* to a specific pattern (e.g. clicking a coloured
   * rectangle in the timeline overview) without first having scrolled all
   * pages of cards into the DOM. With real pagination we can compute
   * which page a group lives on and navigate straight there.
   */
  patternPage = 1;
  patternPageSize = 20;
  /** Group ID we should auto-scroll to after the next render — set by the
   *  timeline-click handler. Consumed by `ngAfterViewChecked` so the scroll
   *  happens once the page's cards are actually in the DOM. */
  private pendingPatternScrollId: number | null = null;
  patternViewMode: 'list' | 'overview' = 'overview';
  patternTimelineDocs: TimelineDoc[] = [];
  patternDocTotalNotes = new Map<string, number>();
  patternMergeEnabled = false;
  patternMinMergeOverlap = 1;
  patternDeduplicateEnabled = true;
  detectedDuplicates: { doc1: LoadedDoc; doc2: LoadedDoc; similarity: number }[] = [];
  hoveredGroupId: number | null = null;
  patternWorker: Worker | null = null;
  hoveredOccurrence: any = null;
  tooltipX = 0;
  tooltipY = 0;
  showSavedSessionsPopover = false;
  showSaveSessionForm = false;
  newSessionName = '';
  savedPatternSessions: { id: string; name: string; date: number; data: any }[] = [];


  // ── Performance knobs ─────────────────────────────────────────────────────
  /** Documents processed per yield in the chunked search loops. ~50 keeps
   *  the progress bar smooth on a low-end laptop without amortising too
   *  many extra Promise scheduling steps. */
  private static readonly SEARCH_BATCH_SIZE = 50;

  /** Hard cap on how many results are *rendered* at once. Way over this and
   *  Angular spends all its time in change-detection / DOM updates on
   *  result rows the user can't even see. They can ask for more via the
   *  "Show more" buttons. */
  private static readonly INITIAL_RESULT_LIMIT = 100;

  /** Current visible-result caps; incremented by `showMore*()`. */
  visibleQuickLimit    = SearchComponent.INITIAL_RESULT_LIMIT;
  visibleSourceLimit   = SearchComponent.INITIAL_RESULT_LIMIT;
  visibleDocumentLimit = SearchComponent.INITIAL_RESULT_LIMIT;
  visibleMelodyLimit   = SearchComponent.INITIAL_RESULT_LIMIT;

  /** Live progress while a long search is running. */
  searchProgress: { current: number; total: number; matched: number; } = { current: 0, total: 0, matched: 0 };

  /** Set to true while a chunked loop is in flight; used so the user can
   *  cancel a long search without waiting for it to finish on its own. */
  searchCancelled = false;

  // ── Cache for quick search ────────────────────────────────────────────────
  static cachedQuickText = '';
  static cachedQuickResults: QuickResult[] = [];
  static cachedQuickSearched = false;
  static cachedQuickMode: 'phrase' | 'words-and' | 'words-or' | 'fuzzy' = 'phrase';
  static cachedQuickTolerance = true;
  static cachedQuickDistance = 2;

  // ── Cache for pattern grouping ─────────────────────────────────────────────
  static cachedPatternGroups: PatternGroup[] = [];
  static cachedPatternLength = 8;
  static cachedPatternType: 'pitch' | 'interval' | 'contour' = 'interval';
  static cachedPatternWithOctave = false;
  static cachedPatternStrictness: 'exact' | 'fuzzy' = 'exact';
  static cachedShowPatternAnalysis = false;
  static cachedPatternProgress = { phase: '', current: 0, total: 0, percent: 0 };
  static cachedPatternViewMode: 'list' | 'overview' = 'overview';
  static cachedPatternTimelineDocs: TimelineDoc[] = [];
  static cachedPatternDocTotalNotes = new Map<string, number>();
  static cachedPatternMergeEnabled = false;
  static cachedPatternMinMergeOverlap = 1;
  static cachedPatternDeduplicateEnabled = true;
  static cachedDetectedDuplicates: { doc1: LoadedDoc; doc2: LoadedDoc; similarity: number }[] = [];
  static cachedPatternPage = 1;


  // ── Cached sort results (avoid recomputing per CD pass) ──────────────────
  /** Precomputed sorted view; mirror of `sourceResults` / `documentResults`
   *  but recomputed only when the data or sort spec actually changes. The
   *  prior code used getters that ran the sort on *every* change detection
   *  pass, which is O(N log N) per CD on huge result sets. */
  private _sortedSources: Source[] = [];
  private _sortedDocs:    Document[] = [];
  private _srcSortKey = ''; // composite "col|asc" cache key
  private _docSortKey = '';
  private _srcResultsRef: Source[] | null = null;
  private _docResultsRef: Document[] | null = null;

  // ── Post-search filter ───────────────────────────────────────────────────
  /** Text typed into the in-result filter bars. Empty = no filter. Each
   *  search tab keeps its own filter so switching tabs doesn't lose state. */
  quickFilterText    = '';
  sourceFilterText   = '';
  documentFilterText = '';
  melodyFilterText   = '';

  /** Debounced values that actually drive the getter filters. */
  quickFilterValue    = '';
  sourceFilterValue   = '';
  documentFilterValue = '';
  melodyFilterValue   = '';

  private filterSubject = new Subject<'quick' | 'source' | 'document' | 'melody'>();

  /** Memoised filtered lists. Recomputed only when the underlying results
   *  array reference or filter string actually changes — otherwise the
   *  cached array is returned, so a CD-heavy parent component doesn't
   *  cause a substring scan on every tick. */
  private _filteredQuick:    QuickResult[]  = [];
  private _filteredSrc:      Source[]       = [];
  private _filteredDoc:      Document[]     = [];
  private _filteredMelody:   MelodyResult[] = [];
  private _quickFilterKey  = '__init__';
  private _srcFilterKey    = '__init__';
  private _docFilterKey    = '__init__';
  private _melodyFilterKey = '__init__';
  private _quickFilterRef:  QuickResult[]  | null = null;
  private _srcFilterRef:    Source[]       | null = null;
  private _docFilterRef:    Document[]     | null = null;
  private _melodyFilterRef: MelodyResult[] | null = null;

  constructor(
    private api: APIService,
    private router: Router,
    private route: ActivatedRoute,
    private userService: UserService,
    private pageTitle: PageTitleService,
    private sanitizer: DomSanitizer,
    private cdRef: ChangeDetectorRef,
    private toastr: ToastrService,
  ) {
    this.loadCols();
    this.loadRecentSearches();
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  ngOnInit() {
    this.pageTitle.set('Search');

    // Restore cached pattern analysis state
    this.showPatternAnalysis = SearchComponent.cachedShowPatternAnalysis;
    this.patternLength = SearchComponent.cachedPatternLength;
    this.patternType = SearchComponent.cachedPatternType;
    this.patternWithOctave = SearchComponent.cachedPatternWithOctave;
    this.patternStrictness = SearchComponent.cachedPatternStrictness;
    this.patternGroups = SearchComponent.cachedPatternGroups;
    this.patternProgress = SearchComponent.cachedPatternProgress;
    this.patternViewMode = SearchComponent.cachedPatternViewMode;
    this.patternTimelineDocs = SearchComponent.cachedPatternTimelineDocs;
    this.patternDocTotalNotes = SearchComponent.cachedPatternDocTotalNotes;
    this.patternMergeEnabled = SearchComponent.cachedPatternMergeEnabled;
    this.patternMinMergeOverlap = SearchComponent.cachedPatternMinMergeOverlap;
    this.patternDeduplicateEnabled = SearchComponent.cachedPatternDeduplicateEnabled;
    this.detectedDuplicates = SearchComponent.cachedDetectedDuplicates || [];
    this.patternPage = SearchComponent.cachedPatternPage || 1;

    this.subs.push(
      this.filterSubject.pipe(debounceTime(300)).subscribe(which => {
        switch (which) {
          case 'quick':    this.quickFilterValue = this.quickFilterText; break;
          case 'source':   this.sourceFilterValue = this.sourceFilterText; break;
          case 'document': this.documentFilterValue = this.documentFilterText; break;
          case 'melody':   this.melodyFilterValue = this.melodyFilterText; break;
        }
        this.applyFilterLimitReset(which);
      })
    );

    this.subs.push(this.userService.user.subscribe(async user => {
      this.user = user;
      if (this.user) {
        this.api.getSettings(this.user.token).subscribe(res => {
          if (res.kind === 'SettingsRetrieved') this.settings = res.settings;
        });
        await this.loadFromIndexedDB();
        this.restoreStateFromUrl();
        // If the page was opened with a URL fragment like
        // `#pattern-group-7`, jump directly to that pattern. We do this
        // after restoring state so the patternGroups list is populated.
        this.honourPatternHashIfPresent();
      }
    }));
  }

  /** If `location.hash` looks like `#pattern-group-<id>`, navigate to that
   *  pattern in the list view. Idempotent — safe to call multiple times. */
  private honourPatternHashIfPresent(): void {
    if (typeof location === 'undefined') return;
    const m = /^#pattern-group-(\d+)$/.exec(location.hash);
    if (!m) return;
    const id = parseInt(m[1], 10);
    if (!isFinite(id)) return;
    if (!this.showPatternAnalysis) this.showPatternAnalysis = true;
    this.openPatternGroupById(id);
  }

  /**
   * Honour any pending "scroll to pattern N" request once Angular has
   * actually flushed the DOM for the page change. Doing this in a setTimeout
   * inside the click handler raced with the page swap; AfterViewChecked
   * guarantees the target card is mounted.
   */
  ngAfterViewChecked(): void {
    if (this.pendingPatternScrollId === null) return;
    const id = this.pendingPatternScrollId;
    const el = document.getElementById('pattern-group-' + id);
    if (!el) return; // not yet — try again on the next CD cycle
    this.pendingPatternScrollId = null;
    // Defer the actual scroll to the next animation frame so the
    // post-render layout has settled (otherwise scrollIntoView can
    // sometimes calculate offsets against the pre-mount layout on
    // Chromium).
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('highlight-pulse');
      setTimeout(() => el.classList.remove('highlight-pulse'), 2000);
    });
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
    if (this.patternWorker) {
      this.patternWorker.terminate();
      this.patternWorker = null;
    }
    const styleEl = document.getElementById('dynamic-hover-styles');
    if (styleEl) {
      styleEl.remove();
    }
  }

  matchText(text: string, query: string, mode: 'phrase' | 'words-and' | 'words-or' | 'fuzzy', spellingTolerance: boolean, maxDistance: number): { matched: boolean; snippet?: TextSnippet; score: number } {
    if (!text) return { matched: false, score: 0 };
    const norm = (s: string) => {
      let res = s.toLowerCase();
      if (spellingTolerance) {
        res = res
          .replace(/[jv]/g, char => char === 'j' ? 'i' : 'u')
          .replace(/y/g, 'i')
          .replace(/ae/g, 'e')
          .replace(/(.)\1+/g, '$1'); // collapse double letters
      }
      return res;
    };

    const targetNorm = norm(text);
    const queryNorm = norm(query);

    if (mode === 'phrase') {
      if (spellingTolerance) {
        const idx = targetNorm.indexOf(queryNorm);
        if (idx !== -1) {
          // Approximate mapping back to original text range
          const matchStart = idx;
          const matchEnd = idx + queryNorm.length;
          const snippet = findTextSnippet(text, text.substring(Math.max(0, matchStart), Math.min(text.length, matchEnd))) || { before: '', match: query, after: '' };
          return { matched: true, snippet, score: 90 };
        }
        return { matched: false, score: 0 };
      } else {
        const idx = text.toLowerCase().indexOf(query.toLowerCase());
        if (idx !== -1) {
          return { matched: true, snippet: findTextSnippet(text, query), score: 100 };
        }
        return { matched: false, score: 0 };
      }
    }

    if (mode === 'words-and' || mode === 'words-or') {
      const words = query.trim().split(/\s+/).filter(Boolean);
      if (words.length === 0) return { matched: false, score: 0 };

      const wordMatches = words.map(w => {
        const wNorm = norm(w);
        return targetNorm.includes(wNorm) || text.toLowerCase().includes(w.toLowerCase());
      });

      const matched = mode === 'words-and' 
        ? wordMatches.every(m => m) 
        : wordMatches.some(m => m);

      if (matched) {
        // Find snippet around the first matching word
        for (const w of words) {
          const idx = text.toLowerCase().indexOf(w.toLowerCase());
          if (idx !== -1) {
            return { matched: true, snippet: findTextSnippet(text, w), score: mode === 'words-and' ? 80 : 70 };
          }
        }
        return { matched: true, snippet: { before: '', match: text.substring(0, Math.min(text.length, 25)), after: '…' }, score: mode === 'words-and' ? 80 : 70 };
      }
      return { matched: false, score: 0 };
    }

    if (mode === 'fuzzy') {
      const targetWords = text.toLowerCase().split(/\s+/).filter(Boolean);
      const queryWords = query.toLowerCase().split(/\s+/).filter(Boolean);
      if (queryWords.length === 0) return { matched: false, score: 0 };

      const matchedWords = queryWords.map(qw => {
        let bestDist = 999;
        let matchedTargetWord = '';
        for (const tw of targetWords) {
          const res = isFuzzySubstring(norm(tw), norm(qw), maxDistance);
          if (res.matched) {
            // Re-calculate the actual distance of this best matching substring
            const dist = levenshteinDistance(norm(res.matchedSub || ''), norm(qw));
            if (dist < bestDist) {
              bestDist = dist;
              matchedTargetWord = tw;
            }
          }
        }
        return { matched: bestDist <= maxDistance, word: matchedTargetWord, dist: bestDist };
      });

      const matched = matchedWords.every(mw => mw.matched);
      if (matched && matchedWords.length > 0) {
        const avgDist = matchedWords.reduce((sum, mw) => sum + mw.dist, 0) / matchedWords.length;
        const score = Math.max(10, 60 - avgDist * 10);
        
        const firstMatch = matchedWords[0].word;
        if (firstMatch) {
          const origIdx = text.toLowerCase().indexOf(firstMatch);
          const origWord = origIdx !== -1 ? text.substring(origIdx, origIdx + firstMatch.length) : firstMatch;
          const snippet = findTextSnippet(text, origWord);
          return { matched: true, snippet, score };
        }
        return { matched: true, score };
      }
      return { matched: false, score: 0 };
    }

    return { matched: false, score: 0 };
  }

  /**
   * Quick / full-text search across every source and document.
   *
   * Performance strategy on workspaces with thousands of documents:
   *   1. Sources are tiny; process them in one synchronous pass.
   *   2. Documents are processed in batches of `SEARCH_BATCH_SIZE`. Between
   *      batches we `await yieldToUI()` so the browser can paint progress
   *      updates and accept input events (including the Cancel button).
   *   3. Notes are fetched on demand per-document via `NotesStore.get(id)`
   *      rather than loading the whole `monodi_notes_*` set up front
   *      (`getAllDocumentNotes` allocates O(workspace size) before any
   *      matching can start — enough to lock up the tab on huge libraries).
   *   4. The result list is published incrementally so the user sees
   *      matches arrive instead of a frozen page.
   */
  async searchQuick() {
    if (!this.user || !this.quickText.trim()) return;
    this.updateUrl();

    if (
      SearchComponent.cachedQuickSearched &&
      SearchComponent.cachedQuickText === this.quickText &&
      SearchComponent.cachedQuickMode === this.quickSearchMode &&
      SearchComponent.cachedQuickTolerance === this.quickMedievalTolerance &&
      SearchComponent.cachedQuickDistance === this.quickFuzzyDistance
    ) {
      this.quickResults = SearchComponent.cachedQuickResults.slice();
      this.quickSearched = true;
      this.searchProgress = { current: this.quickResults.length, total: this.quickResults.length, matched: this.quickResults.length };
      this.cdRef.markForCheck();
      return;
    }

    this.quickSearching = true;
    this.quickSearched = false;
    this.searchCancelled = false;
    this.searchProgress = { current: 0, total: 0, matched: 0 };
    this.visibleQuickLimit = SearchComponent.INITIAL_RESULT_LIMIT;
    this.quickPage = 1;
    this.quickFilterText = '';
    this.addRecentSearch(this.quickText);

    try {
      const [sources, docs] = await Promise.all([
        this.api.listSources(this.user.token).toPromise(),
        this.api.listDocuments(this.user.token).toPromise(),
      ]);

      const results: QuickResult[] = [];

      // -------- sources --------
      if (sources?.kind === 'SourcesRetrieved') {
        for (const s of sources.sources) {
          if (this.searchCancelled) { this.finishQuickSearch(results); return; }
          let bestMatch: {score: number, matchedIn: string} | null = null;
          
          const metaMap: {[key: string]: string} = {
            'Siglum': s.quellensigle || s.bibliothekssignatur || '',
            'Institution': s.herkunftsinstitution || '',
            'Location': s.herkunftsort || '',
            'Type': s.quellentyp || '',
            'Dating': s.datierung || ''
          };

          for (const [key, val] of Object.entries(metaMap)) {
            if (typeof val === 'string' && val.trim() !== '') {
               const res = this.matchText(val, this.quickText, this.quickSearchMode, this.quickMedievalTolerance, this.quickFuzzyDistance);
               if (res.matched && (!bestMatch || res.score > bestMatch.score)) {
                 const finalScore = key === 'Siglum' ? Math.min(100, res.score + 5) : res.score;
                 bestMatch = { score: finalScore, matchedIn: key };
               }
            }
          }
          
          if (bestMatch) {
            results.push({
              kind: 'source', id: s.id!,
              title:    s.quellensigle || s.bibliothekssignatur || '(no siglum)',
              subtitle: [s.herkunftsinstitution, s.herkunftsort].filter(Boolean).join(', '),
              extra:    [s.quellentyp, s.datierung].filter(Boolean).join(' · '),
              score: bestMatch.score,
              matchedIn: `Metadata: ${bestMatch.matchedIn}`,
            });
          }
        }
      }

      // -------- documents (chunked + lazy notes) --------
      const allDocs = docs?.kind === 'DocumentsRetrieved' ? docs.documents : [];
      this.searchProgress = { current: 0, total: allDocs.length, matched: results.length };
      this.cdRef.markForCheck();

      const BATCH_SIZE = 100;
      for (let i = 0; i < allDocs.length; i += BATCH_SIZE) {
        if (this.searchCancelled) { this.finishQuickSearch(results); return; }
        
        const batch = allDocs.slice(i, i + BATCH_SIZE);
        const promises = batch.map(async (d) => {
          // Metadata pass first
          let bestMeta: {score: number, matchedIn: string, snippet?: TextSnippet} | null = null;
          const dMap: {[key: string]: string} = {
            'Incipit': d.textinitium || '',
            'Doc ID': d.dokumenten_id || '',
            'Genre': d.gattung1 || d.gattung2 || '',
            'Feast': d.festtag || '',
            'Celebration': d.feier || ''
          };
          for (const [key, val] of Object.entries(dMap)) {
            if (typeof val === 'string' && val.trim() !== '') {
               const m = this.matchText(val, this.quickText, this.quickSearchMode, this.quickMedievalTolerance, this.quickFuzzyDistance);
               if (m.matched && (!bestMeta || m.score > bestMeta.score)) {
                  const finalScore = key === 'Incipit' ? Math.min(100, m.score + 5) : m.score;
                  bestMeta = { score: finalScore, matchedIn: key, snippet: m.snippet };
               }
            }
          }

          // Syllable-text pass — load notes lazily for this single doc.
          let bestSyl: {score: number, matchedIn: string, snippet?: TextSnippet} | null = null;
          try {
            const root = await NotesStore.get(d.id);
            if (root) {
              const sylsList = extractSyllables(root).map(s => s.text);
              const sylRaw    = sylsList.join('');
              const sylClean  = sylRaw.replace(/-/g, '');
              const sylSpaced = sylsList.join(' ').replace(/-/g, ' ');
              const ms1 = this.matchText(sylSpaced, this.quickText, this.quickSearchMode, this.quickMedievalTolerance, this.quickFuzzyDistance);
              const ms2 = !ms1.matched ? this.matchText(sylClean, this.quickText, this.quickSearchMode, this.quickMedievalTolerance, this.quickFuzzyDistance) : ms1;
              const ms3 = !ms2.matched ? this.matchText(sylRaw,    this.quickText, this.quickSearchMode, this.quickMedievalTolerance, this.quickFuzzyDistance) : ms2;
              
              const bestM = ms1.matched ? ms1 : ms2.matched ? ms2 : ms3.matched ? ms3 : null;
              if (bestM) {
                 bestSyl = { score: bestM.score, matchedIn: 'Transcription', snippet: bestM.snippet };
              }
            }
          } catch (e) {
            console.warn(`Skipping notes for ${d.id}:`, e);
          }

          const bestOverall = (bestMeta && bestSyl) ? (bestMeta.score >= bestSyl.score ? bestMeta : bestSyl) : (bestMeta || bestSyl);

          if (bestOverall) {
            results.push({
              kind: 'document', id: d.id, sourceId: d.quelle_id,
              title:    d.textinitium || d.dokumenten_id || '(no incipit)',
              subtitle: [d.gattung1, d.gattung2].filter(Boolean).join(' / '),
              extra:    [d.festtag, d.feier].filter(Boolean).join(' · '),
              snippet:  bestOverall.snippet,
              score:    bestOverall.score,
              matchedIn: bestOverall.matchedIn === 'Transcription' ? 'Transcription' : `Metadata: ${bestOverall.matchedIn}`
            });
          }
        });

        await Promise.all(promises);

        const currentProgress = Math.min(i + BATCH_SIZE, allDocs.length);
        this.searchProgress.current = currentProgress;
        this.searchProgress.matched = results.length;
        this.quickResults = results.slice();   // publish streaming results
        this.cdRef.markForCheck();
        await this.yieldToUI();
      }

      this.finishQuickSearch(results);
    } catch (err) {
      console.error('Quick search failed:', err);
      this.quickSearching = false;
      this.quickSearched = true;
      this.cdRef.markForCheck();
    }
  }

  /** Final settle once the quick search finishes (or is cancelled). */
  private finishQuickSearch(results: QuickResult[]): void {
    results.sort((a, b) => b.score - a.score);
    this.quickResults = results;
    this.quickSearched = true;
    this.quickSearching = false;

    // Cache the results
    SearchComponent.cachedQuickText = this.quickText;
    SearchComponent.cachedQuickMode = this.quickSearchMode;
    SearchComponent.cachedQuickTolerance = this.quickMedievalTolerance;
    SearchComponent.cachedQuickDistance = this.quickFuzzyDistance;
    SearchComponent.cachedQuickResults = this.quickResults.slice();
    SearchComponent.cachedQuickSearched = true;

    this.saveSearchStateToIndexedDB();
    this.cdRef.markForCheck();
  }

  /** Asks the browser to repaint before resuming the loop. `setTimeout(0)`
   *  beats microtasks here because microtasks would drain before any paint
   *  and progress wouldn't visibly update. */
  private yieldToUI(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  /** Cancel button on the in-flight progress card. */
  cancelSearch(): void {
    this.searchCancelled = true;
  }

  /** "Show more" handlers for each result list. */
  showMoreQuick():     void { this.visibleQuickLimit    += SearchComponent.INITIAL_RESULT_LIMIT; this.cdRef.markForCheck(); }
  showMoreSources():   void { this.visibleSourceLimit   += SearchComponent.INITIAL_RESULT_LIMIT; this.cdRef.markForCheck(); }
  showMoreDocuments(): void { this.visibleDocumentLimit += SearchComponent.INITIAL_RESULT_LIMIT; this.cdRef.markForCheck(); }
  showMoreMelody():    void { this.visibleMelodyLimit   += SearchComponent.INITIAL_RESULT_LIMIT; this.cdRef.markForCheck(); }

  /** Stable trackBy fns so big lists don't re-create DOM nodes. */
  trackQuick   = (_: number, r: QuickResult)  => r.id;
  trackSource  = (_: number, s: Source)       => s.id ?? '';
  trackDoc     = (_: number, d: Document)     => d.id;
  trackMelody  = (_: number, r: MelodyResult) => r.document.id;

  // ── Source search ─────────────────────────────────────────────────────────

  searchSources() {
    if (!this.user) return;
    this.updateUrl();
    this.sourceSearching = true;
    this.sourceSearched = false;
    this.sourceFilterText = '';
    this.sourcesPage = 1;
    this.visibleSourceLimit = SearchComponent.INITIAL_RESULT_LIMIT;
    this.api.querySources(this.user.token, this.sourceQuery).subscribe(res => {
      if (res.kind === 'SourcesRetrieved') this.sourceResults = res.sources;
      this.sourceSearched = true;
      this.sourceSearching = false;
      this.saveSearchStateToIndexedDB();
    });
  }

  clearSourceQuery() {
    this.sourceQuery = {};
    this.sourceResults = [];
    this.sourceSearched = false;
    this.srcSortCol = '';
    this.saveSearchStateToIndexedDB();
  }

  // ── Document search ───────────────────────────────────────────────────────

  searchDocuments() {
    if (!this.user) return;
    this.updateUrl();
    this.documentSearching = true;
    this.documentSearched = false;
    this.documentFilterText = '';
    this.documentsPage = 1;
    this.visibleDocumentLimit = SearchComponent.INITIAL_RESULT_LIMIT;
    this.api.queryDocuments(this.user.token, this.documentQuery).subscribe(res => {
      if (res.kind === 'DocumentsRetrieved') this.documentResults = res.documents;
      this.documentSearched = true;
      this.documentSearching = false;
      this.saveSearchStateToIndexedDB();
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
    this.saveSearchStateToIndexedDB();
  }

  // ── Melody search ─────────────────────────────────────────────────────────

  /**
   * Melodic-pattern search. Same chunked + lazy-notes strategy as
   * `searchQuick`: each document's chant is fetched on demand from the
   * per-document NotesStore, the loop yields to the browser every
   * `SEARCH_BATCH_SIZE` docs, and progress (current / total / matched)
   * is published live so the user sees something happening.
   */
  async searchMelody() {
    if (!this.user || !this.melodyPattern.trim()) return;
    this.updateUrl();
    this.melodySearching  = true;
    this.melodySearched   = false;
    this.melodyScanned    = 0;
    this.melodyWithNotes  = 0;
    this.searchCancelled  = false;
    this.searchProgress = { current: 0, total: 0, matched: 0 };
    this.visibleMelodyLimit = SearchComponent.INITIAL_RESULT_LIMIT;
    this.melodyPage = 1;
    this.melodyFilterText = '';

    const pattern = parseMelodyPattern(this.melodyPattern, this.melodySearchType, this.melodyWithOctave);

    try {
      const [docsRes, sourcesRes] = await Promise.all([
        this.api.listDocuments(this.user.token).toPromise(),
        this.api.listSources(this.user.token).toPromise(),
      ]);
      const allDocs    = docsRes?.kind    === 'DocumentsRetrieved' ? docsRes.documents  : [];
      const allSources = sourcesRes?.kind === 'SourcesRetrieved'   ? sourcesRes.sources : [];
      const sourceMap  = new Map<string, Source>(allSources.map(s => [s.id ?? '', s]));
      const results: MelodyResult[] = [];

      this.melodyScanned = allDocs.length;
      this.searchProgress = { current: 0, total: allDocs.length, matched: 0 };
      this.cdRef.markForCheck();

      const BATCH_SIZE = 100;
      for (let i = 0; i < allDocs.length; i += BATCH_SIZE) {
        if (this.searchCancelled) { this.finishMelodySearch(results); return; }
        
        const batch = allDocs.slice(i, i + BATCH_SIZE);
        const promises = batch.map(async (doc) => {
          // Lazy-load notes for THIS document only.
          let root: VM.RootContainer | null = null;
          try { root = await NotesStore.get(doc.id); }
          catch (e) { console.warn(`Skipping ${doc.id}:`, e); }

          if (root) {
            const syllables = extractSyllables(root);
            const { notes, sylIdx } = flattenNotes(syllables);
            if (notes.length > 0) {
              this.melodyWithNotes++;

              const sequence = this.melodySearchType === 'pitch'
                ? toPitchNames(notes, this.melodyWithOctave)
                : this.melodySearchType === 'contour'
                ? toContour(notes)
                : toIntervals(notes);

              let matches = findSubsequenceMatches(sequence, pattern, this.melodyMaxDistance);
              if (this.melodyOnlyWithinSyllables) {
                matches = matches.filter(m => {
                  const startNote = m.start;
                  const endNote = (this.melodySearchType === 'contour' || this.melodySearchType === 'interval') ? m.end + 1 : m.end;
                  return sylIdx[startNote] === sylIdx[endNote];
                });
              }

              if (matches.length > 0) {
                const bestMatch = matches[0];
                const matchStart = bestMatch.start;
                const matchEndNote = (this.melodySearchType === 'contour' || this.melodySearchType === 'interval')
                  ? bestMatch.end + 1
                  : bestMatch.end;
                const distance = bestMatch.distance;

                const matchSylSet = new Set<string>();
                for (let ni = matchStart; ni <= matchEndNote && ni < sylIdx.length; ni++) {
                  const syl = syllables[sylIdx[ni]];
                  if (syl?.uuid) matchSylSet.add(syl.uuid);
                }

                const matchNoteSet = new Set<string>();
                for (let ni = matchStart; ni <= matchEndNote && ni < notes.length; ni++) {
                  const note = notes[ni];
                  if (note?.uuid) matchNoteSet.add(note.uuid);
                }

                const matchingSyllableIndices: number[] = [];
                for (let ni = matchStart; ni <= matchEndNote && ni < sylIdx.length; ni++) {
                  matchingSyllableIndices.push(sylIdx[ni]);
                }
                const matchSylMin = Math.min(...matchingSyllableIndices);
                const matchSylMax = Math.max(...matchingSyllableIndices);
                const ctxFirst = Math.max(0, matchSylMin - 3);
                const ctxLast  = Math.min(syllables.length - 1, matchSylMax + 3);
                const contextSyllables = syllables.slice(ctxFirst, ctxLast + 1);

                results.push({
                  document:   doc,
                  sourceSigle: sourceMap.get(doc.quelle_id)?.quellensigle ?? '',
                  noteCount:  notes.length,
                  matchingSyllables: contextSyllables,
                  matchSylSet,
                  matchNoteSet,
                  distance,
                });
              }
            }
          }
        });

        await Promise.all(promises);

        const currentProgress = Math.min(i + BATCH_SIZE, allDocs.length);
        this.searchProgress.current = currentProgress;
        this.searchProgress.matched = results.length;
        // Stream results so users see matches arrive (sorted by best-so-far).
        this.melodyResults = results.slice().sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
        this.cdRef.markForCheck();
        await this.yieldToUI();
      }

      this.finishMelodySearch(results);
    } catch (err) {
      console.error('Melody search failed:', err);
      this.melodySearching = false;
      this.melodySearched = true;
      this.cdRef.markForCheck();
    }
  }

  private finishMelodySearch(results: MelodyResult[]): void {
    this.melodyResults  = results.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
    this.melodySearched = true;
    this.melodySearching = false;
    this.saveSearchStateToIndexedDB();
    this.cdRef.markForCheck();
  }

  get melodyPatternHint(): string {
    if (this.melodySearchType === 'pitch') {
      return this.melodyWithOctave
        ? 'e.g. C4D4E4F4  (note names + octave, no spaces needed)'
        : 'e.g. CDEFG  (note names A–G, no spaces needed)';
    } else if (this.melodySearchType === 'contour') {
      return 'e.g. uudrud  (u=up, d=down, r=repeat)';
    }
    return 'e.g. +1-2+0  (signed step differences, spaces optional)';
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

  /**
   * Sorted-result accessors used by the template's `*ngFor`.
   *
   * These USED to be eager `sortArr(...)` getters which re-ran the entire
   * O(N log N) sort on every Angular change-detection pass — on big result
   * sets that meant the browser was doing thousands of comparisons per
   * scroll tick. The cached implementation keeps the previous output and
   * only re-sorts when either the underlying array reference or the sort
   * key/direction actually changes.
   */
  get sortedSourceResults(): Source[] {
    const key = this.srcSortCol + '|' + this.srcSortAsc;
    if (this._srcResultsRef !== this.sourceResults || this._srcSortKey !== key) {
      this._sortedSources = this.sortArr(this.sourceResults, this.srcSortCol, this.srcSortAsc);
      this._srcResultsRef = this.sourceResults;
      this._srcSortKey = key;
    }
    return this._sortedSources;
  }
  get sortedDocumentResults(): Document[] {
    const key = this.docSortCol + '|' + this.docSortAsc;
    if (this._docResultsRef !== this.documentResults || this._docSortKey !== key) {
      this._sortedDocs = this.sortArr(this.documentResults, this.docSortCol, this.docSortAsc);
      this._docResultsRef = this.documentResults;
      this._docSortKey = key;
    }
    return this._sortedDocs;
  }
  // ── Post-search filtering ──────────────────────────────────────────────
  /**
   * Generic substring filter. `keyFn` returns a string of all the text the
   * row should be matchable by (e.g. concatenated metadata). The filter
   * text is split on whitespace into AND-terms so the user can type
   * `Aa 13 Karolus` to narrow to rows containing *both* "Aa 13" and
   * "Karolus" — feels natural for refining a large result set.
   */
  private applyFilter<T>(arr: T[], filterText: string, keyFn: (row: T) => string): T[] {
    const trimmed = filterText.trim().toLowerCase();
    if (!trimmed) return arr;
    const terms = trimmed.split(/\s+/).filter(Boolean);
    return arr.filter(row => {
      const haystack = keyFn(row).toLowerCase();
      return terms.every(t => haystack.includes(t));
    });
  }

  /** Cached filtered views — keyed on (results ref, filter text) so a CD
   *  pass that didn't change either skips the substring scan entirely. */
  get filteredQuickResults(): QuickResult[] {
    const key = this.quickFilterValue;
    if (this._quickFilterRef !== this.quickResults || this._quickFilterKey !== key) {
      this._filteredQuick = this.applyFilter(this.quickResults, key,
        r => `${r.title} ${r.subtitle} ${r.extra} ${r.snippet?.before ?? ''} ${r.snippet?.match ?? ''} ${r.snippet?.after ?? ''}`);
      this._quickFilterRef = this.quickResults;
      this._quickFilterKey = key;
    }
    return this._filteredQuick;
  }
  get filteredSourceResults(): Source[] {
    const sorted = this.sortedSourceResults;
    const key = this.sourceFilterValue;
    if (this._srcFilterRef !== sorted || this._srcFilterKey !== key) {
      this._filteredSrc = this.applyFilter(sorted, key,
        s => Object.values(s).filter(v => typeof v === 'string').join(' '));
      this._srcFilterRef = sorted;
      this._srcFilterKey = key;
    }
    return this._filteredSrc;
  }
  get filteredDocumentResults(): Document[] {
    const sorted = this.sortedDocumentResults;
    const key = this.documentFilterValue;
    if (this._docFilterRef !== sorted || this._docFilterKey !== key) {
      this._filteredDoc = this.applyFilter(sorted, key,
        d => Object.values(d).filter(v => typeof v === 'string').join(' '));
      this._docFilterRef = sorted;
      this._docFilterKey = key;
    }
    return this._filteredDoc;
  }
  get filteredMelodyResults(): MelodyResult[] {
    const key = this.melodyFilterValue;
    if (this._melodyFilterRef !== this.melodyResults || this._melodyFilterKey !== key) {
      this._filteredMelody = this.applyFilter(this.melodyResults, key, r => {
        const d = r.document;
        return `${r.sourceSigle} ${d.textinitium ?? ''} ${d.dokumenten_id ?? ''} ${d.gattung1 ?? ''} ${d.gattung2 ?? ''} ${d.festtag ?? ''} ${d.feier ?? ''} ${d.foliostart ?? ''}`;
      });
      this._melodyFilterRef = this.melodyResults;
      this._melodyFilterKey = key;
    }
    return this._filteredMelody;
  }

  /** Visible-cap slicing — keeps the DOM small on huge result sets. Slices
   *  AFTER filtering so "Show more" pages through the filtered view. */
  get visibleQuickResults():    QuickResult[]  { return this.filteredQuickResults.slice(0, this.visibleQuickLimit); }
  get visibleSourceResults():   Source[]       { return this.filteredSourceResults.slice(0, this.visibleSourceLimit); }
  get visibleDocumentResults(): Document[]     { return this.filteredDocumentResults.slice(0, this.visibleDocumentLimit); }
  get visibleMelodyResults():   MelodyResult[] { return this.filteredMelodyResults.slice(0, this.visibleMelodyLimit); }

  // ── Search pagination helper and getters ──────────────────────────────────

  getPagerWindow(currentPage: number, totalPages: number): number[] {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const out: number[] = [1];
    const winStart = Math.max(2, currentPage - 2);
    const winEnd   = Math.min(totalPages - 1, currentPage + 2);
    if (winStart > 2) out.push(-1);
    for (let p = winStart; p <= winEnd; p++) out.push(p);
    if (winEnd < totalPages - 1) out.push(-1);
    out.push(totalPages);
    return out;
  }

  // Quick Search Pagination
  get quickTotalPages(): number {
    return Math.max(1, Math.ceil(this.filteredQuickResults.length / this.quickPageSize));
  }
  get pagedQuickResults(): QuickResult[] {
    const start = (this.quickPage - 1) * this.quickPageSize;
    return this.filteredQuickResults.slice(start, start + this.quickPageSize);
  }
  get quickPageFromIndex(): number {
    if (this.filteredQuickResults.length === 0) return 0;
    return (this.quickPage - 1) * this.quickPageSize + 1;
  }
  get quickPageToIndex(): number {
    return Math.min(this.filteredQuickResults.length, this.quickPage * this.quickPageSize);
  }
  get quickPagerWindow(): number[] {
    return this.getPagerWindow(this.quickPage, this.quickTotalPages);
  }
  goToQuickPage(p: number): void {
    if (this.filteredQuickResults.length === 0) return;
    this.quickPage = Math.max(1, Math.min(this.quickTotalPages, p));
    this.saveSearchStateToIndexedDB();
    this.cdRef.markForCheck();
  }
  goToFirstQuickPage(): void { this.goToQuickPage(1); }
  goToLastQuickPage():  void { this.goToQuickPage(this.quickTotalPages); }
  goToPrevQuickPage():  void { this.goToQuickPage(this.quickPage - 1); }
  goToNextQuickPage():  void { this.goToQuickPage(this.quickPage + 1); }

  // Sources Search Pagination
  get sourcesTotalPages(): number {
    return Math.max(1, Math.ceil(this.filteredSourceResults.length / this.sourcesPageSize));
  }
  get pagedSourceResults(): Source[] {
    const start = (this.sourcesPage - 1) * this.sourcesPageSize;
    return this.filteredSourceResults.slice(start, start + this.sourcesPageSize);
  }
  get sourcesPageFromIndex(): number {
    if (this.filteredSourceResults.length === 0) return 0;
    return (this.sourcesPage - 1) * this.sourcesPageSize + 1;
  }
  get sourcesPageToIndex(): number {
    return Math.min(this.filteredSourceResults.length, this.sourcesPage * this.sourcesPageSize);
  }
  get sourcesPagerWindow(): number[] {
    return this.getPagerWindow(this.sourcesPage, this.sourcesTotalPages);
  }
  goToSourcesPage(p: number): void {
    if (this.filteredSourceResults.length === 0) return;
    this.sourcesPage = Math.max(1, Math.min(this.sourcesTotalPages, p));
    this.saveSearchStateToIndexedDB();
    this.cdRef.markForCheck();
  }
  goToFirstSourcesPage(): void { this.goToSourcesPage(1); }
  goToLastSourcesPage():  void { this.goToSourcesPage(this.sourcesTotalPages); }
  goToPrevSourcesPage():  void { this.goToSourcesPage(this.sourcesPage - 1); }
  goToNextSourcesPage():  void { this.goToSourcesPage(this.sourcesPage + 1); }

  // Documents Search Pagination
  get documentsTotalPages(): number {
    return Math.max(1, Math.ceil(this.filteredDocumentResults.length / this.documentsPageSize));
  }
  get pagedDocumentResults(): Document[] {
    const start = (this.documentsPage - 1) * this.documentsPageSize;
    return this.filteredDocumentResults.slice(start, start + this.documentsPageSize);
  }
  get documentsPageFromIndex(): number {
    if (this.filteredDocumentResults.length === 0) return 0;
    return (this.documentsPage - 1) * this.documentsPageSize + 1;
  }
  get documentsPageToIndex(): number {
    return Math.min(this.filteredDocumentResults.length, this.documentsPage * this.documentsPageSize);
  }
  get documentsPagerWindow(): number[] {
    return this.getPagerWindow(this.documentsPage, this.documentsTotalPages);
  }
  goToDocumentsPage(p: number): void {
    if (this.filteredDocumentResults.length === 0) return;
    this.documentsPage = Math.max(1, Math.min(this.documentsTotalPages, p));
    this.saveSearchStateToIndexedDB();
    this.cdRef.markForCheck();
  }
  goToFirstDocumentsPage(): void { this.goToDocumentsPage(1); }
  goToLastDocumentsPage():  void { this.goToDocumentsPage(this.documentsTotalPages); }
  goToPrevDocumentsPage():  void { this.goToDocumentsPage(this.documentsPage - 1); }
  goToNextDocumentsPage():  void { this.goToDocumentsPage(this.documentsPage + 1); }

  // Melody Search Pagination
  get melodyTotalPages(): number {
    return Math.max(1, Math.ceil(this.filteredMelodyResults.length / this.melodyPageSize));
  }
  get pagedMelodyResults(): MelodyResult[] {
    const start = (this.melodyPage - 1) * this.melodyPageSize;
    return this.filteredMelodyResults.slice(start, start + this.melodyPageSize);
  }
  get melodyPageFromIndex(): number {
    if (this.filteredMelodyResults.length === 0) return 0;
    return (this.melodyPage - 1) * this.melodyPageSize + 1;
  }
  get melodyPageToIndex(): number {
    return Math.min(this.filteredMelodyResults.length, this.melodyPage * this.melodyPageSize);
  }
  get melodyPagerWindow(): number[] {
    return this.getPagerWindow(this.melodyPage, this.melodyTotalPages);
  }
  goToMelodyPage(p: number): void {
    if (this.filteredMelodyResults.length === 0) return;
    this.melodyPage = Math.max(1, Math.min(this.melodyTotalPages, p));
    this.saveSearchStateToIndexedDB();
    this.cdRef.markForCheck();
  }
  goToFirstMelodyPage(): void { this.goToMelodyPage(1); }
  goToLastMelodyPage():  void { this.goToMelodyPage(this.melodyTotalPages); }
  goToPrevMelodyPage():  void { this.goToMelodyPage(this.melodyPage - 1); }
  goToNextMelodyPage():  void { this.goToMelodyPage(this.melodyPage + 1); }

  /** Reset visible cap whenever the filter changes so users don't have to
   *  click "Show more" to discover that their narrower filter already fits. */
  onFilterChange(which: 'quick' | 'source' | 'document' | 'melody'): void {
    this.filterSubject.next(which);
  }

  applyFilterLimitReset(which: 'quick' | 'source' | 'document' | 'melody'): void {
    switch (which) {
      case 'quick':
        this.visibleQuickLimit    = SearchComponent.INITIAL_RESULT_LIMIT;
        this.quickPage = 1;
        break;
      case 'source':
        this.visibleSourceLimit   = SearchComponent.INITIAL_RESULT_LIMIT;
        this.sourcesPage = 1;
        break;
      case 'document':
        this.visibleDocumentLimit = SearchComponent.INITIAL_RESULT_LIMIT;
        this.documentsPage = 1;
        break;
      case 'melody':
        this.visibleMelodyLimit   = SearchComponent.INITIAL_RESULT_LIMIT;
        this.melodyPage = 1;
        break;
    }
    this.cdRef.markForCheck();
  }

  /** Clears the filter for the given tab. */
  clearFilter(which: 'quick' | 'source' | 'document' | 'melody'): void {
    switch (which) {
      case 'quick':    this.quickFilterText = ''; this.quickFilterValue = ''; break;
      case 'source':   this.sourceFilterText = ''; this.sourceFilterValue = ''; break;
      case 'document': this.documentFilterText = ''; this.documentFilterValue = ''; break;
      case 'melody':   this.melodyFilterText = ''; this.melodyFilterValue = ''; break;
    }
    this.applyFilterLimitReset(which);
  }

  get visibleSrcCols() { return this.srcResultCols.filter(c => c.visible); }
  get visibleDocCols() { return this.docResultCols.filter(c => c.visible); }

  sortIcon(col: string, which: 'src' | 'doc'): string {
    const activeCol = which === 'src' ? this.srcSortCol : this.docSortCol;
    const asc       = which === 'src' ? this.srcSortAsc : this.docSortAsc;
    if (activeCol !== col) return 'bi bi-chevron-expand text-muted opacity-50';
    return asc ? 'bi bi-chevron-up' : 'bi bi-chevron-down';
  }

  // ── CSV export ────────────────────────────────────────────────────────────

  exportSourcesCSV()   { this.exportCSV(this.sortedSourceResults, this.visibleSrcCols, 'sources.csv'); }
  exportDocumentsCSV() { this.exportCSV(this.sortedDocumentResults, this.visibleDocCols, 'documents.csv'); }

  exportMelodyCSV() {
    const rows = this.melodyResults.map(r => ({
      sourceSigle:  r.sourceSigle,
      dokumenten_id: r.document.dokumenten_id,
      textinitium:  r.document.textinitium,
      gattung1:     r.document.gattung1,
      festtag:      r.document.festtag,
      noteCount:    r.noteCount,
    }));
    this.exportCSV(rows, [
      { key: 'sourceSigle',  label: 'Source Siglum', visible: true },
      { key: 'dokumenten_id', label: 'Document ID',  visible: true },
      { key: 'textinitium',  label: 'Text Incipit',  visible: true },
      { key: 'gattung1',     label: 'Genre',         visible: true },
      { key: 'festtag',      label: 'Feast Day',     visible: true },
      { key: 'noteCount',    label: 'Note Count',    visible: true },
    ], 'melody-results.csv');
  }

  private exportCSV(data: any[], cols: ColDef<any>[], filename: string) {
    const visCols = cols.filter(c => c.visible);
    const header  = visCols.map(c => `"${c.label}"`).join(',');
    const rows    = data.map(row =>
      visCols.map(c => `"${String((row as any)[c.key] ?? '').replace(/"/g, '""')}"`).join(',')
    );
    const csv  = [header, ...rows].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  goToSource(id: string)                         { this.router.navigate(['/source', id]); }
  goToDocument(sourceId: string, docId: string)  { this.router.navigate(['/document', sourceId, docId]); }
  goToQuickResult(r: QuickResult) {
    if (r.kind === 'source') this.goToSource(r.id);
    else this.goToDocument(r.sourceId!, r.id);
  }

  // ── Column persistence ────────────────────────────────────────────────────

  loadCols() {
    this.srcResultCols = this.loadFromStorage<Source>(SRC_RES_KEY, DEFAULT_SRC_COLS);
    this.docResultCols = this.loadFromStorage<Document>(DOC_RES_KEY, DEFAULT_DOC_COLS);
    this.synopsisMetadataCols = this.loadFromStorage<Document>(SYNOPSIS_COLS_KEY, DEFAULT_SYNOPSIS_COLS);
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
  saveSynopsisCols() { localStorage.setItem(SYNOPSIS_COLS_KEY, JSON.stringify(this.synopsisMetadataCols)); }

  get visibleSynopsisCols() {
    return this.synopsisMetadataCols.filter(c => c.visible);
  }

  getDocFieldValue(doc: Document, key: string): string {
    const val = (doc as any)[key];
    if (val === undefined || val === null || val === '') return '—';
    return val;
  }

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

  applyRecent(q: string)  { this.quickText = q; this.searchQuick(); }
  clearRecent()           { this.recentSearches = []; localStorage.removeItem(RECENT_KEY); }
  countQuickResults(kind: 'source' | 'document'): number {
    return this.quickResults.filter(r => r.kind === kind).length;
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

  // ── Synoptic Comparison methods ───────────────────────────────────────────

  toggleDocSelection(doc: Document, event: Event) {
    event.stopPropagation();
    const idx = this.selectedDocs.findIndex(d => d.id === doc.id);
    if (idx > -1) {
      this.selectedDocs.splice(idx, 1);
    } else {
      this.selectedDocs.push(doc);
    }
    this.updateUrl();
  }

  toggleQuickResultSelection(r: QuickResult, event: Event) {
    event.stopPropagation();
    const doc: Document = {
      id: r.id,
      quelle_id: r.sourceId || '',
      dokumenten_id: r.title || r.id,
      textinitium: r.title || '',
      gattung1: '',
      gattung2: '',
      festtag: '',
      feier: '',
      bibliographischerverweis: '',
      druckausgabe: '',
      zeilenstart: '',
      foliostart: '',
      kommentar: '',
      editionsstatus: ''
    };
    this.toggleDocSelection(doc, event);
  }

  isDocSelected(id: string): boolean {
    return this.selectedDocs.some(d => d.id === id);
  }

  clearDocSelection() {
    this.selectedDocs = [];
    this.cachedRootContainers = [];
    this.cachedDocIds = [];
    this.updateUrl();
  }

  selectTab(tab: 'quick' | 'sources' | 'documents' | 'melody') {
    this.activeTab = tab;
    this.updateUrl();
    this.saveSearchStateToIndexedDB();
  }

  exitSynopsis() {
    this.showSynopsis = false;
    this.updateUrl();
  }

  updateUrl() {
    // NOTE: we intentionally no longer persist the search query/filters
    // (q_text, src_*, doc_*, mel_*) into the URL.  Doing so caused a refresh
    // to silently re-run the last search; searches must be explicit.  Only
    // view state that the user expects to be shareable/bookmarkable is kept:
    // the active tab and the synopsis-comparison selection.
    const queryParams: any = {
      tab: this.activeTab,

      // Synopsis comparison (explicit, shareable)
      compare: this.selectedDocs.length > 0 ? this.selectedDocs.map(d => d.id).join(',') : null,
      synopsis: this.showSynopsis ? 'true' : null,
      align: this.alignmentMode || null
    };

    // Clean up null/undefined values
    Object.keys(queryParams).forEach(key => {
      if (queryParams[key] === null || queryParams[key] === undefined) {
        delete queryParams[key];
      }
    });

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      replaceUrl: true
    });
  }

  restoreStateFromUrl() {
    const params = this.route.snapshot.queryParams;
    if (!params) return;

    // We deliberately DO NOT restore the search query (q_text / src_* / doc_* /
    // mel_*) from the URL, and we never auto-execute a search on load.  A
    // search must always be triggered explicitly by the user clicking
    // "Search" — opening or refreshing the page should show a clean form.
    // Only non-search view state is honoured below: the active tab and the
    // synopsis-comparison deep link (which is an explicit shareable action).

    if (params.tab) this.activeTab = params.tab;
    if (params.align) this.alignmentMode = params.align;

    // Restore selected documents and open synopsis comparison if requested
    if (params.compare) {
      const docIds = params.compare.split(',');
      const observables = docIds.map((id: string) => this.api.getDocument(this.user!.token, id));
      (forkJoin(observables) as any).subscribe({
        next: (results: any[]) => {
          const docs: Document[] = [];
          for (const res of results) {
            if (res.kind === 'DocumentRetrieved') {
              docs.push(res.document);
            }
          }
          this.selectedDocs = docs;
          
          if (params.synopsis === 'true' && this.selectedDocs.length >= 2) {
            this.enterSynopsis();
          }
        },
        error: (err: any) => {
          console.error('Error restoring compared documents:', err);
        }
      });
    }
  }

  getMatchedCount(node: AlignedNode): number {
    return (node.containers || []).filter(c => c !== null).length;
  }

  getElementWidth(item: AlignedLineElement): number {
    if (!item || item.kind === 'placeholder' || !item.element) {
      return 0;
    }
    if (item.kind === 'clef') {
      return 35; // app-clef width
    }
    const syl = item.element as VM.Syllable;
    const text = (syl.text || '').trim();
    // If consensus text is active, we hide individual syllable text, so we ignore its width!
    const textW = this.showConsensusText ? 0 : textWidth(text, 'Times', '15px');
    
    let noteCount = 0;
    const spaced = syl.notes?.spaced || [];
    spaced.forEach(ns => (ns.nonSpaced || []).forEach(g => (g.grouped || []).forEach(() => noteCount++)));
    const notesW = noteCount > 0 ? (noteCount * 14 + 10) : 0;
    
    const minW = this.showConsensusText ? 12 : 30;
    return Math.max(minW, textW, notesW) + 8;
  }

  getColumnWidth(col: AlignedLineElement[]): number {
    if (!col) return 0;
    const scale = this.settings?.pdfSynopsisScale || 1.0;
    let maxWidth = 0;
    let hasClef = false;
    for (const item of col) {
      if (!item) continue;
      if (item.kind === 'clef') {
        hasClef = true;
      }
      const w = this.getElementWidth(item);
      if (w > maxWidth) {
        maxWidth = w;
      }
    }

    // Also consider the consensus text length for this column!
    if (this.showConsensusText) {
      const consensusTexts = this.getConsensusSyllableTexts(col);
      let maxConsensusTextW = 0;
      consensusTexts.forEach(txt => {
        const w = textWidth(txt.trim(), 'Times', '15px');
        if (w > maxConsensusTextW) maxConsensusTextW = w;
      });
      // The column width should be at least large enough to fit the consensus text
      maxWidth = Math.max(maxWidth, maxConsensusTextW + 8);
    }

    if (hasClef) {
      return Math.max(35, maxWidth) * scale;
    }
    const minColW = this.showConsensusText ? 12 : 40;
    return Math.max(minColW, maxWidth) * scale;
  }

  hasParatext(items: any[]): boolean {
    return items && items.some(item => item && item.kind === 'ParatextContainer');
  }

  getParatextColumnWidth(node: AlignedNode): number {
    const scale = this.settings?.pdfSynopsisScale || 1.0;
    if (!node || !node.items) return 100 * scale;
    let maxWidth = 80;
    for (const item of node.items) {
      if (item && item.kind === 'ParatextContainer' && 'text' in item) {
        const typeStr = item.paratextType || 'Text';
        const textStr = item.text || '';
        const text = `[${typeStr}: ${textStr}]`;
        const w = textWidth(text.trim(), 'Times', '12px') + 20;
        if (w > maxWidth) maxWidth = w;
      }
    }
    return Math.min(400, maxWidth) * scale;
  }

  getPrintDate(): string {
    return new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  }

  getProjectTitle(): string {
    if (this.settings) {
      if (this.settings.bibliothek && this.settings.bibliothek.length > 0) {
        return this.settings.bibliothek[0];
      }
      if (this.settings.bibliothekssignatur && this.settings.bibliothekssignatur.length > 0) {
        return this.settings.bibliothekssignatur[0];
      }
    }
    return 'Monodi Light Archive';
  }

  hasLineElements(node: AlignedNode, docIdx: number): boolean {
    if (!node.alignedLineElements) return false;
    return node.alignedLineElements.some(col => col[docIdx] && col[docIdx].kind !== 'placeholder' && col[docIdx].element !== null);
  }

  getConsensusSyllableTexts(col: AlignedLineElement[]): string[] {
    if (!col) return [];
    const texts: string[] = [];
    for (const item of col) {
      if (item && item.kind === 'syllable' && item.element && 'text' in item.element) {
        texts.push(item.element.text || '');
      } else {
        texts.push('');
      }
    }

    const nonEmptyTexts = texts.filter(t => t.trim() !== '');
    if (nonEmptyTexts.length === 0) return [''];

    const allIdentical = nonEmptyTexts.every(t => t === nonEmptyTexts[0]);
    if (allIdentical) {
      return [nonEmptyTexts[0]];
    }

    return Array.from(new Set(nonEmptyTexts));
  }

  onSingleLineToggle() {
    this.runAlignment(this.cachedRootContainers);
  }

  /**
   * Fully vector PDF export.
   *
   * Instead of rasterising the DOM with html2canvas (blurry, huge files),
   * the PDF is drawn natively:
   *   - masthead / witness table / section headings: jsPDF text + autoTable
   *     in Times (the classic serif lives only in the PDF; the screen keeps
   *     the app font),
   *   - the notation: every staff <svg> is converted to true vector paths
   *     via svg2pdf, and every text node (sigla, syllable text, consensus,
   *     paratexts) is placed using the browser's own layout rectangles — so
   *     all on-screen alignments carry over exactly,
   *   - real pagination with a running head (pages 2+) and a footer with
   *     "Page X of Y" on every page.
   */
  async exportSynopsisPDF() {
    this.toastr.info('Generating PDF\u2026', 'Export');
    const root = document.querySelector('.synopsis-view') as HTMLElement;
    if (!root) {
      this.toastr.error('Synopsis element not found');
      return;
    }

    try {
      const s = this.settings;
      const showHeader    = !s || s.pdfSynopsisShowHeader !== false;
      const showFooter    = !s || s.pdfSynopsisShowFooter !== false;
      const showFooterIds = !s || s.pdfSynopsisShowFooterIds !== false;
      const showDate      = !s || s.pdfSynopsisShowDate !== false;
      const showMeta      = !s || s.pdfSynopsisShowHeaderMetadata !== false;

      const PXMM = 25.4 / 96; // CSS px -> mm at natural size

      // Reset horizontal scroll so sticky sigla report their resting position.
      root.querySelectorAll<HTMLElement>('.synopsis-scroll-wrapper').forEach(w => w.scrollLeft = 0);

      // Widest music row (px) decides the scale / custom page width.
      let maxRowPx = 0;
      root.querySelectorAll<HTMLElement>('.synopsis-stave-row, .synopsis-consensus-text-row')
        .forEach(row => { maxRowPx = Math.max(maxRowPx, row.scrollWidth); });

      const singleLine = this.showSingleLineSynopsis;
      const margin = 12;

      let pageW: number, pageH: number;
      if (singleLine) {
        pageW = Math.max(297, maxRowPx * PXMM + margin * 2 + 4);
        // Estimate needed height: masthead + table + all rows + slack.
        let rowsMm = 0;
        root.querySelectorAll<HTMLElement>('.synopsis-stave-row, .synopsis-consensus-text-row')
          .forEach(row => { rowsMm += row.offsetHeight * PXMM; });
        const tableMm = showMeta ? (this.selectedDocs.length + 1) * 5 + 14 : 0;
        pageH = Math.max(120, (showHeader ? 22 : 4) + tableMm + rowsMm + margin * 2 + 20);
      } else {
        pageW = 210; pageH = 297;
      }

      const doc = new jsPDF({
        unit: 'mm',
        format: singleLine ? [pageW, pageH] : 'a4',
        orientation: singleLine ? 'landscape' : 'portrait'
      });
      // jsPDF normalises format/orientation itself; read back actual size.
      pageW = doc.internal.pageSize.getWidth();
      pageH = doc.internal.pageSize.getHeight();

      const contentX = margin;
      const contentW = pageW - margin * 2;
      const topY = margin + 5;              // room for the running head
      const bottomLimit = pageH - margin - 5; // room for the footer

      // px -> mm for music rows: natural size, shrunk to fit the page.
      const scale = singleLine ? PXMM : Math.min(PXMM, contentW / Math.max(1, maxRowPx));
      const ptOf = (px: number) => Math.max(4, px * scale * (72 / 25.4));

      let y = topY;
      const ensureSpace = (needed: number) => {
        if (y + needed > bottomLimit && y > topY) { doc.addPage(); y = topY; }
      };

      // ------ 1. Masthead (page 1 title block) ------
      if (showHeader) {
        doc.setFont('times', 'bold');
        doc.setFontSize(16);
        doc.setTextColor(15, 23, 42);
        doc.text('Synoptic Comparison', pageW / 2, y + 2, { align: 'center' });
        doc.setFont('times', 'italic');
        doc.setFontSize(9);
        doc.setTextColor(80, 80, 80);
        const modeLabel = this.alignmentMode.charAt(0).toUpperCase() + this.alignmentMode.slice(1);
        const subParts = [
          `${modeLabel} alignment`,
          `${this.selectedDocs.length} witness${this.selectedDocs.length === 1 ? '' : 'es'}`
        ];
        if (showDate) subParts.push(this.getPrintDate());
        doc.text(subParts.join('   \u00b7   '), pageW / 2, y + 7, { align: 'center' });
        doc.setDrawColor(15, 23, 42);
        doc.setLineWidth(0.5);
        doc.line(contentX, y + 10, contentX + contentW, y + 10);
        doc.setLineWidth(0.2);
        doc.line(contentX, y + 11.2, contentX + contentW, y + 11.2);
        y += 17;
      }

      // ------ 2. Witness table (vector text via autoTable) ------
      if (showMeta && this.visibleSynopsisCols.length && this.selectedDocs.length) {
        doc.setFont('times', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(80, 80, 80);
        doc.text('WITNESSES', contentX, y);
        y += 1.5;
        autoTable(doc, {
          head: [this.visibleSynopsisCols.map(c => c.label)],
          body: this.selectedDocs.map(d => this.visibleSynopsisCols.map(c =>
            c.key === 'dokumenten_id'
              ? (this.docSigles[d.id] || d.dokumenten_id || '')
              : (this.getDocFieldValue(d, c.key as string) || '')
          )),
          startY: y,
          margin: { left: contentX, right: margin },
          theme: 'plain',
          tableWidth: Math.min(contentW, 190),
          styles: {
            font: 'times', fontSize: 9, textColor: [15, 23, 42],
            cellPadding: { top: 1, bottom: 1, left: 0, right: 3 },
            lineColor: [226, 232, 240], lineWidth: 0
          },
          headStyles: {
            fontStyle: 'bold', fontSize: 7, textColor: [51, 65, 85],
            lineColor: [15, 23, 42], lineWidth: { top: 0.4, bottom: 0.25 }
          },
          bodyStyles: { lineWidth: { bottom: 0.1 } },
          didParseCell: data => {
            if (data.section === 'body') {
              const key = this.visibleSynopsisCols[data.column.index]?.key;
              if (key === 'dokumenten_id') data.cell.styles.fontStyle = 'bold';
              if (key === 'textinitium') data.cell.styles.fontStyle = 'italic';
            }
          }
        });
        y = (doc as any).lastAutoTable.finalY + 7;
      }

      // ------ 3. Body: headings + aligned systems, in DOM order ------
      const indentOf = (el: HTMLElement): number =>
        el.closest('.syn-sec-3') ? 6 : el.closest('.syn-sec-2') ? 3 : 0;

      /** Transcribe one on-screen row (staves + all visible text) into the
       *  PDF at the current cursor, preserving the browser layout. */
      const renderRow = async (row: HTMLElement, x0: number) => {
        const rowRect = row.getBoundingClientRect();

        // Staff / clef / placeholder SVGs -> vector paths
        for (const svg of Array.from(row.querySelectorAll('svg'))) {
          const r = svg.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) continue;
          const hadViewBox = svg.getAttribute('viewBox');
          if (!hadViewBox) svg.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
          await doc.svg(svg as unknown as SVGElement, {
            x: x0 + (r.left - rowRect.left) * scale,
            y: y + (r.top - rowRect.top) * scale,
            width: r.width * scale,
            height: r.height * scale
          });
          if (!hadViewBox) svg.removeAttribute('viewBox');
        }

        // Every visible text node (sigla, syllable text, consensus,
        // paratexts, "empty stave") at its exact on-screen position.
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT, {
          acceptNode: n => {
            if (!(n.textContent || '').trim()) return NodeFilter.FILTER_REJECT;
            const p = n.parentElement;
            if (!p || p.closest('svg') || p.closest('.d-print-none')) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          }
        });
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const parent = node.parentElement as HTMLElement;
          const range = document.createRange();
          range.selectNodeContents(node);
          const r = range.getBoundingClientRect();
          if (r.width < 0.5 || r.height < 0.5) continue;

          const cs = getComputedStyle(parent);
          const fontPx = parseFloat(cs.fontSize) || 15;
          const italic = cs.fontStyle === 'italic';
          const bold = (parseInt(cs.fontWeight, 10) || 400) >= 600;
          doc.setFont('times', bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'normal');
          doc.setFontSize(ptOf(fontPx));
          const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(cs.color);
          if (m) doc.setTextColor(+m[1], +m[2], +m[3]); else doc.setTextColor(0, 0, 0);

          let text = (node.textContent || '').replace(/\s+/g, ' ').trim();
          // Respect CSS truncation (sigla columns)
          const maxWmm = r.width * scale + 1.5;
          while (text.length > 1 && doc.getTextWidth(text) > maxWmm) {
            text = text.slice(0, -1);
          }
          doc.text(text,
            x0 + (r.left - rowRect.left) * scale,
            y + (r.top - rowRect.top + r.height * 0.78) * scale);
        }
        y += row.offsetHeight * scale;
      };

      const blocks = Array.from(root.querySelectorAll<HTMLElement>('.syn-sec-head, .synopsis-leaf-container'));
      for (const block of blocks) {
        if (block.classList.contains('syn-sec-head')) {
          const indent = indentOf(block);
          const level = indent === 6 ? 3 : indent === 3 ? 2 : 1;
          const name = (block.querySelector('.syn-sec-name')?.textContent || '').trim();
          const match = (block.querySelector('.syn-sec-match')?.textContent || '').trim();
          ensureSpace(22); // heading + a bit of its content
          y += level === 1 ? 4 : 2.5;
          doc.setFont('times', level === 3 ? 'italic' : 'bold');
          doc.setFontSize(level === 1 ? 11 : level === 2 ? 10 : 9.5);
          doc.setTextColor(30, 41, 59);
          const nameX = contentX + indent;
          const shownName = level === 1 ? name.toUpperCase() : name;
          doc.text(shownName, nameX, y);
          const nameW = doc.getTextWidth(shownName);
          doc.setFont('times', 'normal');
          doc.setFontSize(7);
          doc.setTextColor(100, 116, 139);
          const matchW = doc.getTextWidth(match);
          doc.text(match, contentX + contentW - matchW, y);
          doc.setDrawColor(148, 163, 184);
          doc.setLineWidth(0.15);
          doc.line(nameX + nameW + 2, y - 1, contentX + contentW - matchW - 2, y - 1);
          y += 4;
        } else {
          const rows = Array.from(block.querySelectorAll<HTMLElement>('.synopsis-stave-row, .synopsis-consensus-text-row'));
          if (!rows.length) continue;
          const x0 = contentX + indentOf(block);
          const totalH = rows.reduce((a, r) => a + r.offsetHeight * scale, 0);
          // Keep an aligned system together when it fits on one page.
          if (totalH <= bottomLimit - topY) ensureSpace(totalH + 1);
          for (const row of rows) {
            ensureSpace(row.offsetHeight * scale + 0.5);
            await renderRow(row, x0);
          }
          y += 3.5;
        }
      }

      // ------ 4. Running head (pages 2+) and footer (all pages) ------
      const total = doc.getNumberOfPages();
      const dateStr = this.getPrintDate();
      const modeLbl = this.alignmentMode.charAt(0).toUpperCase() + this.alignmentMode.slice(1);
      const sigla = this.selectedDocs.map(d => this.docSigles[d.id] || d.dokumenten_id).join(' \u00b7 ');

      for (let i = 1; i <= total; i++) {
        doc.setPage(i);
        if (showHeader && i > 1) {
          doc.setFont('times', 'italic');
          doc.setFontSize(9);
          doc.setTextColor(80, 80, 80);
          doc.text(`Synoptic Comparison \u2014 ${modeLbl} alignment`, contentX, margin - 3);
          if (showDate) doc.text(dateStr, pageW - margin, margin - 3, { align: 'right' });
          doc.setDrawColor(90, 90, 90);
          doc.setLineWidth(0.2);
          doc.line(contentX, margin - 1, pageW - margin, margin - 1);
        }
        if (showFooter) {
          doc.setDrawColor(90, 90, 90);
          doc.setLineWidth(0.2);
          doc.line(contentX, pageH - margin + 1, pageW - margin, pageH - margin + 1);
          doc.setFont('times', 'normal');
          doc.setFontSize(8);
          doc.setTextColor(80, 80, 80);
          if (showFooterIds && sigla) {
            const maxW = contentW - 30;
            const firstLine = (doc.splitTextToSize(sigla, maxW) as string[])[0] || '';
            doc.text(firstLine, contentX, pageH - margin + 4.5);
          }
          doc.text(`Page ${i} of ${total}`, pageW - margin, pageH - margin + 4.5, { align: 'right' });
        }
      }

      const suffix = singleLine ? 'single-line-' : '';
      doc.save(`synopsis-${suffix}${new Date().toISOString().slice(0, 10)}.pdf`);
      this.toastr.success('Synopsis PDF exported successfully!');
    } catch (err) {
      console.error('Error generating PDF:', err);
      this.toastr.error('Failed to export PDF');
    }
  }

  onAlignmentModeChange(mode: 'structure' | 'sequential' | 'melody' | 'text') {
    this.alignmentMode = mode;
    this.enterSynopsis();
  }

  alignNodeChildren(parentNodes: (VM.FormteilContainer | VM.RootContainer | null)[], depth: number): AlignedNode[] {
    const K = parentNodes.length;

    // 1. Extract and flatten child lists for each document
    const childLists: VM.FormteilChildren[][] = parentNodes.map(node => {
      if (!node) return [];
      const result: VM.FormteilChildren[] = [];
      const rawChildren = node.children || [];
      for (const child of rawChildren) {
        if (!child) continue;
        if (child.kind === 'MiscContainer') {
          result.push(...(child.children || []).filter(c => c !== null && c !== undefined));
        } else {
          result.push(child as VM.FormteilChildren);
        }
      }
      return result;
    });

    // 2. Separate leafs (ZeileContainer, ParatextContainer) and containers (FormteilContainer) for each list
    const leafs: VM.FormteilChildren[][] = childLists.map(list => 
      list.filter(c => c && (c.kind === 'ZeileContainer' || c.kind === 'ParatextContainer'))
    );
    const containers: VM.FormteilContainer[][] = childLists.map(list => 
      list.filter(c => c && c.kind === 'FormteilContainer') as VM.FormteilContainer[]
    );

    const alignedNodes: AlignedNode[] = [];

    // 3. Align leaf elements sequentially by index
    const maxLeafCount = Math.max(...leafs.map(l => l.length));
    for (let idx = 0; idx < maxLeafCount; idx++) {
      const items = leafs.map(list => list[idx] || null);
      
      const leafNode: AlignedNode = {
        kind: 'leaf',
        level: depth,
        signature: '',
        containers: [],
        children: [],
        items: items
      };

      // If any of the matched items is a ZeileContainer, pre-align its syllables/clefs
      const lineElements: (VM.Syllable | VM.Clef)[][] = items.map(item => {
        if (item && item.kind === 'ZeileContainer') {
          return (item.children || []).filter(c => c && (c.kind === 'Syllable' || c.kind === 'Clef')) as (VM.Syllable | VM.Clef)[];
        }
        return [];
      });

      const maxLineElCount = Math.max(...lineElements.map(el => el.length));
      if (maxLineElCount > 0) {
        leafNode.alignedLineElements = [];
        for (let col = 0; col < maxLineElCount; col++) {
          const column: AlignedLineElement[] = [];
          for (let docIdx = 0; docIdx < K; docIdx++) {
            const el = lineElements[docIdx][col] || null;
            if (el) {
              column.push({
                kind: el.kind === 'Clef' ? 'clef' : 'syllable',
                element: el
              });
            } else {
              column.push({
                kind: 'placeholder',
                element: null
              });
            }
          }
          leafNode.alignedLineElements.push(column);
        }
      }

      alignedNodes.push(leafNode);
    }

    // 4. Align structural FormteilContainers by Level/Signature
    while (containers.some(list => list.length > 0)) {
      // Find the first available signature among the active container lists
      let sig = '';
      for (let docIdx = 0; docIdx < K; docIdx++) {
        if (containers[docIdx].length > 0) {
          const firstContainer = containers[docIdx][0];
          sig = (firstContainer && firstContainer.data || []).find((d: any) => d && d.name === 'Signatur')?.data || '';
          break;
        }
      }

      // Match and consume the first container with this signature in each document
      const matchedContainers: (VM.FormteilContainer | null)[] = [];
      for (let docIdx = 0; docIdx < K; docIdx++) {
        const list = containers[docIdx];
        const idx = list.findIndex(c => {
          const s = (c && c.data || []).find((d: any) => d && d.name === 'Signatur')?.data || '';
          return s === sig;
        });
        if (idx > -1) {
          matchedContainers.push(list[idx]);
          list.splice(idx, 1);
        } else {
          matchedContainers.push(null);
        }
      }

      // Recurse into the children of these matched containers
      const subChildren = this.alignNodeChildren(matchedContainers, depth + 1);

      alignedNodes.push({
        kind: 'container',
        level: depth,
        signature: sig,
        containers: matchedContainers,
        children: subChildren,
        items: []
      });
    }

    return alignedNodes;
  }

  alignSequential(rootContainers: VM.RootContainer[]): AlignedNode[] {
    const K = rootContainers.length;
    
    // For each document, extract all lines and paratexts
    const leafs: VM.FormteilChildren[][] = rootContainers.map(root => {
      const result: VM.FormteilChildren[] = [];
      const traverse = (node: any) => {
        if (!node) return;
        if (node.kind === 'ZeileContainer' || node.kind === 'ParatextContainer') {
          result.push(node);
        } else if (node.kind === 'MiscContainer') {
          (node.children || []).forEach((c: any) => traverse(c));
        } else if (node.children) {
          node.children.forEach((c: any) => traverse(c));
        }
      };
      traverse(root);
      return result;
    });

    const alignedNodes: AlignedNode[] = [];
    const maxLeafCount = Math.max(...leafs.map(l => l.length));

    for (let idx = 0; idx < maxLeafCount; idx++) {
      const items = leafs.map(list => list[idx] || null);
      
      const leafNode: AlignedNode = {
        kind: 'leaf',
        level: 1,
        signature: '',
        containers: [],
        children: [],
        items: items
      };

      const lineElements: (VM.Syllable | VM.Clef)[][] = items.map(item => {
        if (item && item.kind === 'ZeileContainer') {
          return (item.children || []).filter(c => c && (c.kind === 'Syllable' || c.kind === 'Clef')) as (VM.Syllable | VM.Clef)[];
        }
        return [];
      });

      const maxLineElCount = Math.max(...lineElements.map(el => el.length));
      if (maxLineElCount > 0) {
        leafNode.alignedLineElements = [];
        for (let col = 0; col < maxLineElCount; col++) {
          const column: AlignedLineElement[] = [];
          for (let docIdx = 0; docIdx < K; docIdx++) {
            const el = lineElements[docIdx][col] || null;
            if (el) {
              column.push({
                kind: el.kind === 'Clef' ? 'clef' as const : 'syllable' as const,
                element: el
              });
            } else {
              column.push({
                kind: 'placeholder',
                element: null
              });
            }
          }
          leafNode.alignedLineElements.push(column);
        }
      }

      alignedNodes.push(leafNode);
    }

    return alignedNodes;
  }

  alignMelody(rootContainers: VM.RootContainer[], mode: 'melody' | 'text' = 'melody'): AlignedLineElement[][] {
    const K = rootContainers.length;
    if (K === 0) return [];

    // Extract flat elements for each document
    const flatSeqs: (VM.Clef | VM.Syllable)[][] = rootContainers.map(r => extractFlatElements(r));
    const seq0 = flatSeqs[0];

    // Initialize aligned columns with just doc 0 elements
    let alignedCols: AlignedLineElement[][] = seq0.map(el => {
      const col: AlignedLineElement[] = Array(K).fill(null).map(() => ({ kind: 'placeholder', element: null }));
      col[0] = { kind: el.kind === 'Clef' ? 'clef' as const : 'syllable' as const, element: el };
      return col;
    });

    // Align each subsequent document to the profile accumulated so far and merge
    for (let docIdx = 1; docIdx < K; docIdx++) {
      const seqi = flatSeqs[docIdx];
      const { aligned1, aligned2 } = needlemanWunschProfile(alignedCols, seqi, docIdx, mode);

      const nextAlignedCols: AlignedLineElement[][] = [];
      for (let idx = 0; idx < aligned1.length; idx++) {
        const existingCol = aligned1[idx];
        const eli = aligned2[idx];

        if (existingCol !== null) {
          // Merge eli into the existing column
          if (eli) {
            existingCol[docIdx] = {
              kind: eli.kind === 'Clef' ? 'clef' as const : 'syllable' as const,
              element: eli
            };
          } else {
            existingCol[docIdx] = { kind: 'placeholder', element: null };
          }
          nextAlignedCols.push(existingCol);
        } else {
          // Insertion: create a new column with placeholders for docs 0..docIdx-1
          const newCol: AlignedLineElement[] = Array(K).fill(null).map(() => ({ kind: 'placeholder', element: null }));
          if (eli) {
            newCol[docIdx] = {
              kind: eli.kind === 'Clef' ? 'clef' as const : 'syllable' as const,
              element: eli
            };
          }
          nextAlignedCols.push(newCol);
        }
      }
      alignedCols = nextAlignedCols;
    }

    return alignedCols;
  }

  enterSynopsis() {
    if (!this.user || this.selectedDocs.length < 2) return;
    this.synopsisLoading = true;
    this.showSynopsis = false;

    const token = this.user.token;
    const currentDocIds = this.selectedDocs.map(d => d.id);
    
    // Check if cache matches current selection
    const isCached = currentDocIds.length === this.cachedDocIds.length && 
                     currentDocIds.every((id, idx) => id === this.cachedDocIds[idx]) &&
                     this.cachedRootContainers.length === this.selectedDocs.length;

    if (isCached) {
      this.runAlignment(this.cachedRootContainers);
      this.showSynopsis = true;
      this.updateUrl();
      this.synopsisLoading = false;
      return;
    }

    // Fetch notes and sigles
    const notesObservables = this.selectedDocs.map(d => this.api.getDocumentNotes(token, d.id));
    const sigleObservables = this.selectedDocs.map(d => this.api.getSigle(token, d.quelle_id));

    forkJoin({
      notes: forkJoin(notesObservables),
      sigles: forkJoin(sigleObservables)
    }).subscribe({
      next: (res: any) => {
        const rootContainers: VM.RootContainer[] = [];
        this.docSigles = {};
        
        for (let i = 0; i < this.selectedDocs.length; i++) {
          const doc = this.selectedDocs[i];
          const sigleRes = res.sigles[i];
          this.docSigles[doc.id] = (sigleRes.kind === 'SigleRetrieved') ? sigleRes.sigle : doc.dokumenten_id;
          
          const notesRes = res.notes[i];
          if (notesRes.kind === 'NotesRetrieved') {
            rootContainers.push(notesRes.data);
          } else {
            rootContainers.push({
              kind: VM.ContainerKind.RootContainer,
              uuid: doc.id,
              children: [],
              comments: [],
              documentType: VM.DocumentType.Level1
            });
          }
        }

        // Cache the loaded models
        this.cachedRootContainers = rootContainers;
        this.cachedDocIds = currentDocIds;

        this.runAlignment(rootContainers);
        this.showSynopsis = true;
        this.updateUrl();
        this.synopsisLoading = false;
      },
      error: (err) => {
        console.error('Error entering synopsis:', err);
        this.synopsisLoading = false;
      }
    });
  }

  runAlignment(rootContainers: VM.RootContainer[]) {
    if (this.alignmentMode === 'structure') {
      this.alignedTree = this.alignNodeChildren(rootContainers, 1);
    } else if (this.alignmentMode === 'sequential') {
      this.alignedTree = this.alignSequential(rootContainers);
    } else if (this.alignmentMode === 'melody' || this.alignmentMode === 'text') {
      const melodyCols = this.alignMelody(rootContainers, this.alignmentMode);
      this.chunkedMelodyRows = [];
      if (this.showSingleLineSynopsis) {
        this.chunkedMelodyRows.push(melodyCols);
      } else {
        const chunkSize = 8;
        for (let i = 0; i < melodyCols.length; i += chunkSize) {
          this.chunkedMelodyRows.push(melodyCols.slice(i, i + chunkSize));
        }
      }
    }
  }

  // ── Pattern Analysis Methods ──────────────────────────────────────────────

  get patternTargetDocsCount(): number {
    if (this.activeTab === 'quick') {
      return this.filteredQuickResults.filter(r => r.kind === 'document').length;
    } else if (this.activeTab === 'sources') {
      return this.filteredSourceResults.length;
    } else if (this.activeTab === 'documents') {
      return this.filteredDocumentResults.length;
    } else if (this.activeTab === 'melody') {
      return this.filteredMelodyResults.length;
    }
    return 0;
  }

  // Expanded pattern group IDs to paginate/collapse occurrences inside cards
  expandedGroupIds = new Set<number>();

  toggleGroupExpand(groupId: number) {
    if (this.expandedGroupIds.has(groupId)) {
      this.expandedGroupIds.delete(groupId);
    } else {
      this.expandedGroupIds.add(groupId);
    }
    this.cdRef.markForCheck();
  }

  visibleOccurrences(g: PatternGroup): PatternOccurrence[] {
    if (this.expandedGroupIds.has(g.id)) {
      return g.occurrences;
    }
    return g.occurrences.slice(0, 3);
  }

  async getCurrentSearchDocIds(): Promise<string[]> {
    if (!this.user) return [];
    try {
      const docsRes = await this.api.listDocuments(this.user.token).toPromise();
      const allDocs = docsRes?.kind === 'DocumentsRetrieved' ? docsRes.documents : [];
      
      const docIds: string[] = [];
      if (this.activeTab === 'quick') {
        const docResults = this.filteredQuickResults.filter(r => r.kind === 'document');
        docIds.push(...docResults.map(r => r.id));
      } else if (this.activeTab === 'sources') {
        const sourceIds = new Set(this.filteredSourceResults.map(s => s.id));
        for (const doc of allDocs) {
          if (sourceIds.has(doc.quelle_id)) {
            docIds.push(doc.id!);
          }
        }
      } else if (this.activeTab === 'documents') {
        docIds.push(...this.filteredDocumentResults.map(d => d.id!));
      } else if (this.activeTab === 'melody') {
        docIds.push(...this.filteredMelodyResults.map(mr => mr.document.id!));
      }
      return docIds;
    } catch (e) {
      console.warn('Failed to get current search doc IDs:', e);
      return [];
    }
  }

  async openPatternAnalysis() {
    this.showPatternAnalysis = true;
    this.patternSearching = false;
    this.patternCancelled = false;
    this.patternPage = 1;
    this.expandedGroupIds.clear();

    const currentDocIds = await this.getCurrentSearchDocIds();
    const analyzedDocIds = Array.from(this.patternDocTotalNotes.keys());

    currentDocIds.sort();
    analyzedDocIds.sort();

    const isSame = currentDocIds.length === analyzedDocIds.length &&
                   currentDocIds.every((id, idx) => id === analyzedDocIds[idx]);

    if (!isSame) {
      this.patternGroups = [];
      this.patternTimelineDocs = [];
      this.patternDocTotalNotes.clear();
      this.detectedDuplicates = [];
      this.patternProgress = { phase: '', current: 0, total: 0, percent: 0 };
      this.updatePatternCache();
    } else {
      this.updatePatternCache();
    }
    
    this.cdRef.markForCheck();
  }

  exitPatternAnalysis() {
    this.showPatternAnalysis = false;
    this.patternCancelled = true;
    this.updatePatternCache();
    this.cdRef.markForCheck();
  }

  cancelPatternGrouping() {
    this.patternCancelled = true;
    this.patternSearching = false;
    this.patternProgress.phase = 'Cancelled';
    if (this.patternWorker) {
      this.patternWorker.terminate();
      this.patternWorker = null;
    }
    this.updatePatternCache();
    this.cdRef.markForCheck();
  }

  // ── Pattern-list pagination ─────────────────────────────────────────────

  /** Total number of pages for the current pattern result set. */
  get patternTotalPages(): number {
    return Math.max(1, Math.ceil(this.patternGroups.length / this.patternPageSize));
  }

  /** The slice of pattern groups visible on the current page. The template
   *  iterates this rather than slicing inline so that page changes update
   *  cleanly with a single recompute. */
  get pagedPatternGroups(): PatternGroup[] {
    const start = (this.patternPage - 1) * this.patternPageSize;
    return this.patternGroups.slice(start, start + this.patternPageSize);
  }

  /** 1-based index of the first pattern shown on the current page. */
  get patternPageFromIndex(): number {
    if (this.patternGroups.length === 0) return 0;
    return (this.patternPage - 1) * this.patternPageSize + 1;
  }

  /** 1-based index of the last pattern shown on the current page. */
  get patternPageToIndex(): number {
    return Math.min(this.patternGroups.length, this.patternPage * this.patternPageSize);
  }

  /**
   * A compact list of page numbers to render in the pager. Always shows
   * the first and last page; in between we surround the current page with
   * a small window. Gaps are represented by `-1` so the template can
   * render an ellipsis. Yields something like
   *   1 … 4 5 [6] 7 8 … 42
   * for total=42, current=6.
   */
  get patternPagerWindow(): number[] {
    const total = this.patternTotalPages;
    const cur = this.patternPage;
    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }
    const out: number[] = [1];
    const winStart = Math.max(2, cur - 2);
    const winEnd   = Math.min(total - 1, cur + 2);
    if (winStart > 2) out.push(-1);
    for (let p = winStart; p <= winEnd; p++) out.push(p);
    if (winEnd < total - 1) out.push(-1);
    out.push(total);
    return out;
  }

  /** Jump to a specific page; clamps to valid range. */
  goToPatternPage(p: number): void {
    if (this.patternGroups.length === 0) return;
    const clamped = Math.max(1, Math.min(this.patternTotalPages, p));
    if (clamped === this.patternPage) return;
    this.patternPage = clamped;
    this.updatePatternCache();
    this.cdRef.markForCheck();
  }
  goToFirstPatternPage(): void { this.goToPatternPage(1); }
  goToLastPatternPage():  void { this.goToPatternPage(this.patternTotalPages); }
  goToPrevPatternPage():  void { this.goToPatternPage(this.patternPage - 1); }
  goToNextPatternPage():  void { this.goToPatternPage(this.patternPage + 1); }

  static computePatternGroups = computePatternGroups;

  updatePatternCache() {
    SearchComponent.cachedPatternGroups = this.patternGroups;
    SearchComponent.cachedPatternLength = this.patternLength;
    SearchComponent.cachedPatternType = this.patternType;
    SearchComponent.cachedPatternWithOctave = this.patternWithOctave;
    SearchComponent.cachedPatternStrictness = this.patternStrictness;
    SearchComponent.cachedShowPatternAnalysis = this.showPatternAnalysis;
    SearchComponent.cachedPatternProgress = this.patternProgress;
    SearchComponent.cachedPatternViewMode = this.patternViewMode;
    SearchComponent.cachedPatternTimelineDocs = this.patternTimelineDocs;
    SearchComponent.cachedPatternDocTotalNotes = this.patternDocTotalNotes;
    SearchComponent.cachedPatternMergeEnabled = this.patternMergeEnabled;
    SearchComponent.cachedPatternMinMergeOverlap = this.patternMinMergeOverlap;
    SearchComponent.cachedPatternDeduplicateEnabled = this.patternDeduplicateEnabled;
    SearchComponent.cachedDetectedDuplicates = this.detectedDuplicates;
    SearchComponent.cachedPatternPage = this.patternPage;
    this.savePatternStateToIndexedDB();
  }

  setPatternViewMode(mode: 'list' | 'overview') {
    this.patternViewMode = mode;
    this.updatePatternCache();
    this.cdRef.markForCheck();
  }

  getPatternColor(groupId: number): string {
    const colors = [
      '#3b82f6', // blue-500
      '#10b981', // emerald-500
      '#f59e0b', // amber-500
      '#8b5cf6', // violet-500
      '#ec4899', // pink-500
      '#06b6d4', // cyan-500
      '#ef4444', // red-500
      '#84cc16', // lime-500
      '#14b8a6', // teal-500
      '#f97316', // orange-500
      '#a855f7', // purple-500
      '#6366f1'  // indigo-500
    ];
    return colors[(groupId - 1) % colors.length];
  }

  getPatternGroupKey(groupId: number): string {
    const group = this.patternGroups.find(g => g.id === groupId);
    return group ? group.representativeKey : '';
  }

  updateHoverStyles(groupId: number | null) {
    let styleEl = document.getElementById('dynamic-hover-styles');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'dynamic-hover-styles';
      document.head.appendChild(styleEl);
    }
    if (groupId === null) {
      styleEl.innerHTML = '';
    } else {
      styleEl.innerHTML = `
        .pattern-marker {
          fill-opacity: 0.15 !important;
        }
        .group-marker-${groupId} {
          fill-opacity: 1.0 !important;
          stroke: #000000 !important;
          stroke-width: 1px !important;
        }
      `;
    }
  }

  onPatternFamilyHover(groupId: number | null) {
    this.hoveredGroupId = groupId;
    this.updateHoverStyles(groupId);
  }

  showTooltip(event: MouseEvent, occ: any, doc: any, groupId: number, repKey: string) {
    this.hoveredGroupId = groupId;
    this.updateHoverStyles(groupId);
    
    // Get matching syllables text
    const sylText = occ.matchingSyllables.map((s: any) => s.text).join(' ');
    
    // Calculate page coordinates
    this.hoveredOccurrence = {
      docTitle: doc.doc.textinitium || doc.doc.dokumenten_id,
      sourceSigle: doc.sourceSigle,
      groupId,
      repKey,
      start: occ.startNoteIdx,
      end: occ.endNoteIdx,
      syllables: sylText,
      pitches: occ.notes.map((n: any) => n.base + (n.octave !== undefined ? n.octave : '')).join(' - ')
    };
    this.updateTooltipPosition(event);
  }

  updateTooltipPosition(event: MouseEvent) {
    this.tooltipX = event.clientX + 15;
    this.tooltipY = event.clientY + 15;
  }

  hideTooltip() {
    this.hoveredGroupId = null;
    this.updateHoverStyles(null);
    this.hoveredOccurrence = null;
  }

  private hexToRgb(hex: string): { r: number, g: number, b: number } {
    const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
    const fullHex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(fullHex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 128, g: 128, b: 128 };
  }

  async exportPatternAnalysisPDF() {
    try {
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const pageHeight = 842;
      const pageWidth = 595;
      const margin = 40;
      let y = margin;

      // 1. Title
      doc.setFontSize(18);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(37, 99, 235);
      doc.text("Melodic Pattern Analysis Report", margin, y);
      y += 24;

      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100, 116, 139);
      doc.text(`Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}`, margin, y);
      y += 20;

      // 2. Settings & Stats Table
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(30, 41, 59);
      doc.text("Analysis Parameters & Statistics", margin, y);
      y += 10;

      const strictnessText = this.patternStrictness === 'exact' ? 'Exact Match' : 'Fuzzy Match (edit distance <= 1)';
      const mergeText = this.patternMergeEnabled ? `Enabled (min overlap ${this.patternMinMergeOverlap})` : 'Disabled';
      const dedupText = this.patternDeduplicateEnabled ? 'Enabled' : 'Disabled';
      
      const statsRows = [
        ['Parameter', 'Value', 'Metric', 'Value'],
        ['Pattern Type', this.patternType.toUpperCase(), 'Total Documents', this.patternTimelineDocs.length.toString()],
        ['Pattern Length', this.patternLength.toString(), 'Patterns Identified', this.patternGroups.length.toString()],
        ['Match Strictness', strictnessText, 'Total Occurrences', this.patternGroups.reduce((acc, g) => acc + g.occurrences.length, 0).toString()],
        ['Merge Overlaps', mergeText, 'Excluded Duplicates', this.detectedDuplicates.length.toString()],
        ['Deduplication', dedupText, '', '']
      ];

      autoTable(doc, {
        startY: y,
        head: [statsRows[0]],
        body: statsRows.slice(1),
        theme: 'striped',
        headStyles: { fillColor: [79, 70, 229] },
        margin: { left: margin, right: margin },
        styles: { fontSize: 8 },
        didDrawPage: (data) => {
          y = data.cursor ? data.cursor.y : y;
        }
      });
      y += 35;

      // 3. Timeline Overview
      if (this.patternTimelineDocs.length > 0) {
        doc.setFontSize(11);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(30, 41, 59);
        doc.text("Timeline Overview", margin, y);
        y += 10;

        const timelineBody = this.patternTimelineDocs.map((docRow) => {
          const title = docRow.doc.textinitium || docRow.doc.dokumenten_id || 'Untitled';
          const genre = docRow.doc.gattung1 ? ` (${docRow.doc.gattung1})` : '';
          return [`${docRow.sourceSigle} - ${title}${genre}`, ''];
        });

        autoTable(doc, {
          startY: y,
          head: [['Document Metadata', 'Pattern Timeline']],
          body: timelineBody,
          theme: 'grid',
          headStyles: { fillColor: [37, 99, 235] },
          margin: { left: margin, right: margin },
          styles: { fontSize: 8, valign: 'middle' },
          columnStyles: {
            0: { cellWidth: 220 },
            1: { cellWidth: 'auto' }
          },
          didDrawCell: (data) => {
            if (data.section === 'body' && data.column.index === 1) {
              const docRow = this.patternTimelineDocs[data.row.index];
              const cell = data.cell;
              
              // Draw light background line
              doc.setDrawColor(233, 236, 239);
              doc.setLineWidth(1.5);
              const lineY = cell.y + cell.height / 2;
              doc.line(cell.x + 5, lineY, cell.x + cell.width - 5, lineY);

              // Draw each pattern occurrence
              for (const occ of docRow.occurrences) {
                const startX = cell.x + 5 + (occ.startPct / 100) * (cell.width - 10);
                const width = (occ.widthPct / 100) * (cell.width - 10);
                const colorRgb = this.hexToRgb(occ.color);
                doc.setFillColor(colorRgb.r, colorRgb.g, colorRgb.b);
                doc.rect(startX, cell.y + 4, Math.max(width, 2), cell.height - 8, 'F');
              }
            }
          },
          didDrawPage: (data) => {
            y = data.cursor ? data.cursor.y : y;
          }
        });
        y += 35;
      }

      // Add a page break for the detailed list
      doc.addPage();
      y = margin;

      // 4. Detailed Patterns List (limit to first 100 patterns to avoid huge PDFs)
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(30, 41, 59);
      doc.text("Detailed Pattern List", margin, y);
      y += 10;

      const detailedBody = this.patternGroups.slice(0, 100).map((g) => {
        const occs = g.occurrences.map((occ) => {
          const syllablesText = occ.matchingSyllables
            ? occ.matchingSyllables.map((s: any) => s.text || '').join(' ').trim()
            : '';
          const cleanSylText = syllablesText.replace(/\s+/g, ' ');
          return `• [${occ.sourceSigle}] ${occ.doc.textinitium || 'Untitled'} (notes ${occ.startNoteIdx}-${occ.endNoteIdx}): "${cleanSylText}"`;
        }).join('\n');

        return [
          `Pattern #${g.id}\n(Freq: ${g.occurrences.length})`,
          `Key: ${g.representativeKey}\n\nPitches: ${g.representativePitches}${g.isCompound ? '\n[Compound]' : ''}`,
          occs
        ];
      });

      autoTable(doc, {
        startY: y,
        head: [['Pattern ID', 'Sequence Details', 'Occurrences List']],
        body: detailedBody,
        theme: 'striped',
        headStyles: { fillColor: [15, 23, 42] },
        margin: { left: margin, right: margin },
        styles: { fontSize: 8, cellPadding: 6, valign: 'top' },
        columnStyles: {
          0: { cellWidth: 70 },
          1: { cellWidth: 160 },
          2: { cellWidth: 'auto' }
        },
        didDrawPage: (data) => {
          y = data.cursor ? data.cursor.y : y;
        }
      });

      const filename = `pattern-analysis-report-${this.patternType}-${this.patternLength}.pdf`;
      doc.save(filename);
      this.toastr.success('PDF report exported successfully!');
    } catch (e) {
      console.error('Failed to export PDF:', e);
      this.toastr.error('Failed to export PDF report');
    }
  }

  async saveCurrentPatternSession() {
    if (!this.newSessionName.trim()) {
      this.toastr.error('Please enter a session name');
      return;
    }

    try {
      const sessionData = {
        patternGroups: this.patternGroups,
        patternLength: this.patternLength,
        patternType: this.patternType,
        patternStrictness: this.patternStrictness,
        patternViewMode: this.patternViewMode,
        patternTimelineDocs: this.patternTimelineDocs,
        patternDocTotalNotes: Array.from(this.patternDocTotalNotes.entries()),
        patternMergeEnabled: this.patternMergeEnabled,
        patternMinMergeOverlap: this.patternMinMergeOverlap,
        patternDeduplicateEnabled: this.patternDeduplicateEnabled,
        detectedDuplicates: this.detectedDuplicates,
        patternPage: this.patternPage
      };

      const newSession = {
        id: Math.random().toString(36).substring(2, 11) + '-' + Date.now(),
        name: this.newSessionName.trim(),
        date: Date.now(),
        data: sessionData
      };

      this.savedPatternSessions = [newSession, ...this.savedPatternSessions];
      await localforage.setItem('saved_pattern_sessions', this.savedPatternSessions);

      this.newSessionName = '';
      this.showSaveSessionForm = false;
      this.toastr.success('Session saved successfully');
      this.cdRef.markForCheck();
    } catch (e) {
      console.error('Failed to save session:', e);
      this.toastr.error('Failed to save session');
    }
  }

  async loadPatternSession(id: string) {
    const session = this.savedPatternSessions.find(s => s.id === id);
    if (!session) {
      this.toastr.error('Session not found');
      return;
    }

    try {
      const data = session.data;
      this.patternGroups = data.patternGroups || [];
      this.patternLength = data.patternLength ?? 8;
      this.patternType = data.patternType ?? 'interval';
      this.patternStrictness = data.patternStrictness ?? 'exact';
      this.patternViewMode = data.patternViewMode ?? 'overview';
      this.patternTimelineDocs = data.patternTimelineDocs || [];
      this.patternMergeEnabled = !!data.patternMergeEnabled;
      this.patternMinMergeOverlap = data.patternMinMergeOverlap ?? 1;
      this.patternDeduplicateEnabled = data.patternDeduplicateEnabled !== false;
      this.detectedDuplicates = data.detectedDuplicates || [];
      this.patternPage = data.patternPage || 1;
      
      if (data.patternDocTotalNotes) {
        this.patternDocTotalNotes = new Map<string, number>(data.patternDocTotalNotes);
      } else {
        this.patternDocTotalNotes = new Map<string, number>();
      }

      this.updatePatternCache();
      this.showSavedSessionsPopover = false;
      this.toastr.success(`Session "${session.name}" loaded`);
      this.cdRef.markForCheck();
    } catch (e) {
      console.error('Failed to load session:', e);
      this.toastr.error('Failed to load session');
    }
  }

  async deletePatternSession(id: string, event: MouseEvent) {
    event.stopPropagation();
    try {
      this.savedPatternSessions = this.savedPatternSessions.filter(s => s.id !== id);
      await localforage.setItem('saved_pattern_sessions', this.savedPatternSessions);
      this.toastr.success('Session deleted');
      this.cdRef.markForCheck();
    } catch (e) {
      console.error('Failed to delete session:', e);
      this.toastr.error('Failed to delete session');
    }
  }

  exportPatternSessionJSON() {
    try {
      const sessionData = {
        patternGroups: this.patternGroups,
        patternLength: this.patternLength,
        patternType: this.patternType,
        patternStrictness: this.patternStrictness,
        patternViewMode: this.patternViewMode,
        patternTimelineDocs: this.patternTimelineDocs,
        patternDocTotalNotes: Array.from(this.patternDocTotalNotes.entries()),
        patternMergeEnabled: this.patternMergeEnabled,
        patternMinMergeOverlap: this.patternMinMergeOverlap,
        patternDeduplicateEnabled: this.patternDeduplicateEnabled,
        detectedDuplicates: this.detectedDuplicates,
        patternPage: this.patternPage
      };

      const filename = `pattern-analysis-${this.patternType}-${this.patternLength}.json`;
      const blob = new Blob([JSON.stringify(sessionData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      this.toastr.success('JSON file exported');
    } catch (e) {
      console.error('Failed to export JSON:', e);
      this.toastr.error('Failed to export JSON file');
    }
  }

  triggerImportJSON() {
    const input = document.getElementById('patternImportJsonInput');
    if (input) {
      input.click();
    }
  }

  importPatternSessionJSON(event: any) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e: any) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data || !Array.isArray(data.patternGroups)) {
          this.toastr.error('Invalid pattern analysis session file');
          return;
        }

        this.patternGroups = data.patternGroups;
        this.patternLength = data.patternLength ?? 8;
        this.patternType = data.patternType ?? 'interval';
        this.patternStrictness = data.patternStrictness ?? 'exact';
        this.patternViewMode = data.patternViewMode ?? 'overview';
        this.patternTimelineDocs = data.patternTimelineDocs || [];
        this.patternMergeEnabled = !!data.patternMergeEnabled;
        this.patternMinMergeOverlap = data.patternMinMergeOverlap ?? 1;
        this.patternDeduplicateEnabled = data.patternDeduplicateEnabled !== false;
        this.detectedDuplicates = data.detectedDuplicates || [];
        this.patternPage = data.patternPage || 1;
        
        if (data.patternDocTotalNotes) {
          this.patternDocTotalNotes = new Map<string, number>(data.patternDocTotalNotes);
        } else {
          this.patternDocTotalNotes = new Map<string, number>();
        }

        this.updatePatternCache();
        this.showSavedSessionsPopover = false;
        this.toastr.success('Session imported successfully');
        this.cdRef.markForCheck();
      } catch (err) {
        console.error('Failed to parse JSON:', err);
        this.toastr.error('Failed to parse JSON file');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }



  async saveSearchStateToIndexedDB() {
    try {
      const searchData = {
        activeTab: this.activeTab,
        quickText: this.quickText,
        quickPage: this.quickPage,
        sourcesPage: this.sourcesPage,
        documentsPage: this.documentsPage,
        melodyPage: this.melodyPage,
        quickSearchMode: this.quickSearchMode,
        quickMedievalTolerance: this.quickMedievalTolerance,
        quickFuzzyDistance: this.quickFuzzyDistance,
        sourceQuery: this.sourceQuery,
        documentQuery: this.documentQuery,
        melodyPattern: this.melodyPattern,
        melodySearchType: this.melodySearchType,
        melodyWithOctave: this.melodyWithOctave,
        melodyOnlyWithinSyllables: this.melodyOnlyWithinSyllables,
        melodyMaxDistance: this.melodyMaxDistance
      };
      await localforage.setItem('search_state', searchData);
    } catch (e) {
      console.warn('Failed to save search state to IndexedDB:', e);
    }
  }

  async savePatternStateToIndexedDB() {
    // ─── What we persist ────────────────────────────────────────────────────
    //
    // patternGroups and patternTimelineDocs each embed full VM.Syllable[] /
    // VM.Note[] / Set<string> objects — potentially tens of MB — and silently
    // fail the structured-clone write when the workspace is large.  We
    // therefore do NOT try to persist the computed results; instead we save
    // only the small, plain-JSON settings needed to re-run the analysis.
    //
    // Two-track persistence:
    //   • localStorage  ("monodi_pattern_params") — synchronous, survives
    //     reload, holds just the params + a flag that analysis was active.
    //     Used on the next page load to auto-retrigger the worker.
    //   • IndexedDB ("pattern_state") — holds equally-small state that the
    //     in-session cache already covers but which is nice to restore on
    //     reload (view mode, current page, etc.).
    //
    // In-session navigation (navigate away → back) is handled entirely by the
    // static cache and does NOT go through this path.

    // 1. Small params → localStorage (synchronous, never fails on size)
    try {
      const params = {
        showPatternAnalysis: this.showPatternAnalysis,
        patternType: this.patternType,
        patternLength: this.patternLength,
        patternWithOctave: this.patternWithOctave,
        patternStrictness: this.patternStrictness,
        patternMergeEnabled: this.patternMergeEnabled,
        patternMinMergeOverlap: this.patternMinMergeOverlap,
        patternDeduplicateEnabled: this.patternDeduplicateEnabled,
        patternViewMode: this.patternViewMode,
        patternPage: this.patternPage,
        savedAt: new Date().toISOString(),
      };
      if (this.showPatternAnalysis && this.patternGroups.length > 0) {
        localStorage.setItem('monodi_pattern_params', JSON.stringify(params));
      } else if (!this.showPatternAnalysis) {
        // User explicitly closed the panel — don't auto-restore on next load.
        localStorage.removeItem('monodi_pattern_params');
      }
    } catch (e) {
      console.warn('Failed to save pattern params to localStorage:', e);
    }

    // 2. Small auxiliary state → IndexedDB (view mode, page, etc.)
    try {
      const patternData = {
        showPatternAnalysis: this.showPatternAnalysis,
        patternLength: this.patternLength,
        patternType: this.patternType,
        patternWithOctave: this.patternWithOctave,
        patternStrictness: this.patternStrictness,
        patternViewMode: this.patternViewMode,
        patternMergeEnabled: this.patternMergeEnabled,
        patternMinMergeOverlap: this.patternMinMergeOverlap,
        patternDeduplicateEnabled: this.patternDeduplicateEnabled,
        patternPage: this.patternPage,
        // NOTE: patternGroups / patternTimelineDocs / detectedDuplicates are
        // intentionally omitted — too large for a reliable structured-clone.
      };
      await localforage.setItem('pattern_state', patternData);
    } catch (e) {
      console.warn('Failed to save pattern state to IndexedDB:', e);
    }
  }

  async loadFromIndexedDB() {
    try {
      // 0. Load saved pattern sessions list
      try {
        const saved: any = await localforage.getItem('saved_pattern_sessions');
        if (Array.isArray(saved)) {
          this.savedPatternSessions = saved;
        } else {
          this.savedPatternSessions = [];
        }
      } catch (e) {
        console.warn('Failed to load saved pattern sessions:', e);
        this.savedPatternSessions = [];
      }

      // 1. Load pattern analysis state
      //
      // Two-track restore:
      //   a) In-session navigation  → static cache already populated; skip.
      //   b) Fresh page load        → static cache is empty; restore params
      //      from storage and auto-retrigger the analysis in the background.
      //
      // We detect "fresh load" by checking whether the static cache still
      // holds results from a prior navigation in this session.
      const staticCachePopulated = SearchComponent.cachedPatternGroups.length > 0
                                || SearchComponent.cachedShowPatternAnalysis;

      if (!staticCachePopulated) {
        // Fresh page load — read the small params snapshot we wrote to
        // localStorage.  (patternGroups / patternTimelineDocs are NOT stored
        // because they embed full note trees and silently fail the write.)
        let savedParams: any = null;
        try {
          const raw = localStorage.getItem('monodi_pattern_params');
          if (raw) savedParams = JSON.parse(raw);
        } catch { /* ignore */ }

        if (savedParams?.showPatternAnalysis) {
          // Restore UI settings so the panel looks right while the worker runs.
          this.patternLength           = savedParams.patternLength           ?? this.patternLength;
          this.patternType             = savedParams.patternType             ?? this.patternType;
          this.patternWithOctave       = !!savedParams.patternWithOctave;
          this.patternStrictness       = savedParams.patternStrictness       ?? this.patternStrictness;
          this.patternMergeEnabled     = !!savedParams.patternMergeEnabled;
          this.patternMinMergeOverlap  = savedParams.patternMinMergeOverlap  ?? this.patternMinMergeOverlap;
          this.patternDeduplicateEnabled = savedParams.patternDeduplicateEnabled !== false;
          this.patternViewMode         = savedParams.patternViewMode         ?? this.patternViewMode;
          this.patternPage             = savedParams.patternPage             ?? 1;
          this.showPatternAnalysis     = true;

          // Sync to static cache immediately so a quick in-session navigation
          // before the worker finishes still sees the right settings.
          SearchComponent.cachedPatternLength           = this.patternLength;
          SearchComponent.cachedPatternType             = this.patternType;
          SearchComponent.cachedPatternWithOctave       = this.patternWithOctave;
          SearchComponent.cachedPatternStrictness       = this.patternStrictness;
          SearchComponent.cachedPatternMergeEnabled     = this.patternMergeEnabled;
          SearchComponent.cachedPatternMinMergeOverlap  = this.patternMinMergeOverlap;
          SearchComponent.cachedPatternDeduplicateEnabled = this.patternDeduplicateEnabled;
          SearchComponent.cachedPatternViewMode         = this.patternViewMode;
          SearchComponent.cachedPatternPage             = this.patternPage;
          SearchComponent.cachedShowPatternAnalysis     = true;

          // Auto-retrigger the analysis.  We schedule it after the current
          // microtask queue drains so the component has finished initialising
          // (the user subscription and restoreStateFromUrl() come after us).
          setTimeout(() => {
            if (this.showPatternAnalysis && this.patternGroups.length === 0) {
              this.runPatternGrouping();
            }
          }, 0);
        }
      }

      // 2. Restore only lightweight VIEW PREFERENCES from the last session.
      //
      //    We deliberately DO NOT restore the query text, the filled-in
      //    metadata filters, the result lists, or the "searched" flags — a
      //    fresh page load must show an empty form and run nothing until the
      //    user explicitly clicks "Search".  What we DO keep are the
      //    non-destructive toggles (which tab was open, the search mode, the
      //    medieval-tolerance / fuzzy-distance, melody type/octave options),
      //    because those are user preferences rather than a "last search".
      const searchData: any = await localforage.getItem('search_state');
      if (searchData) {
        if (searchData.activeTab) this.activeTab = searchData.activeTab;

        // Quick-search MODE toggles (not the query, not the results)
        if (searchData.quickSearchMode) this.quickSearchMode = searchData.quickSearchMode;
        this.quickMedievalTolerance = !!searchData.quickMedievalTolerance;
        if (searchData.quickFuzzyDistance !== undefined) this.quickFuzzyDistance = searchData.quickFuzzyDistance;

        // Melody-search OPTION toggles (not the pattern, not the results)
        if (searchData.melodySearchType) this.melodySearchType = searchData.melodySearchType;
        this.melodyWithOctave = !!searchData.melodyWithOctave;
        this.melodyOnlyWithinSyllables = !!searchData.melodyOnlyWithinSyllables;
        if (searchData.melodyWithNotes !== undefined) this.melodyWithNotes = searchData.melodyWithNotes;
        if (searchData.melodyMaxDistance !== undefined) this.melodyMaxDistance = searchData.melodyMaxDistance;
      }

      this.cdRef.markForCheck();
    } catch (e) {
      console.warn('Error loading state from IndexedDB:', e);
    }
  }

  /**
   * Entry point from the overview timeline. Switches to the list view,
   * flips the page to the one that contains this pattern, expands the
   * card, and then scrolls the user to the matching anchor with a brief
   * pulse highlight so they don't lose context after the jump.
   */
  selectPatternGroupFromTimeline(groupId: number) {
    this.openPatternGroupById(groupId);
  }

  /**
   * Centralised "jump to a pattern by id" helper. Used by the timeline
   * click handler AND by URL-hash deep-linking (`#pattern-group-7`) so the
   * navigation behaviour stays consistent across both entry points.
   */
  openPatternGroupById(groupId: number): void {
    const idx = this.patternGroups.findIndex(g => g.id === groupId);
    if (idx < 0) return;

    this.patternViewMode = 'list';
    this.expandedGroupIds.add(groupId);
    this.patternPage = Math.floor(idx / this.patternPageSize) + 1;
    // The actual scroll happens in ngAfterViewChecked once the new page's
    // cards are in the DOM. Setting only the id avoids racing with the
    // page change above — *Timer would target a stale layout otherwise.
    this.pendingPatternScrollId = groupId;
    this.updatePatternCache();

    // Reflect the jump in the URL fragment so the user can bookmark or
    // share the specific pattern.
    try {
      if (typeof history !== 'undefined' && history.replaceState) {
        history.replaceState(null, '', '#pattern-group-' + groupId);
      }
    } catch { /* ignore — file:// origin etc. */ }

    this.cdRef.markForCheck();
  }

  async runPatternGrouping() {
    if (!this.user) return;
    this.patternSearching = true;
    this.patternCancelled = false;
    this.patternGroups = [];
    this.patternPage = 1;
    this.expandedGroupIds.clear();
    this.patternProgress = { phase: 'Initializing...', current: 0, total: 0, percent: 0 };
    this.cdRef.markForCheck();

    try {
      this.patternProgress.phase = 'Loading library metadata...';
      this.cdRef.markForCheck();
      
      const [docsRes, sourcesRes] = await Promise.all([
        this.api.listDocuments(this.user.token).toPromise(),
        this.api.listSources(this.user.token).toPromise()
      ]);

      if (this.patternCancelled) return;

      const allDocs = docsRes?.kind === 'DocumentsRetrieved' ? docsRes.documents : [];
      const allSources = sourcesRes?.kind === 'SourcesRetrieved' ? sourcesRes.sources : [];
      
      const docMap = new Map<string, Document>(allDocs.map(d => [d.id!, d]));
      const sourceMap = new Map<string, Source>(allSources.map(s => [s.id!, s]));

      let targetDocs: { doc: Document; sourceSigle: string }[] = [];

      if (this.activeTab === 'quick') {
        const docResults = this.filteredQuickResults.filter(r => r.kind === 'document');
        for (const qr of docResults) {
          const doc = docMap.get(qr.id);
          if (doc) {
            const sigle = sourceMap.get(doc.quelle_id)?.quellensigle ?? '';
            targetDocs.push({ doc, sourceSigle: sigle });
          }
        }
      } else if (this.activeTab === 'sources') {
        const sourceIds = new Set(this.filteredSourceResults.map(s => s.id));
        for (const doc of allDocs) {
          if (sourceIds.has(doc.quelle_id)) {
            const sigle = sourceMap.get(doc.quelle_id)?.quellensigle ?? '';
            targetDocs.push({ doc, sourceSigle: sigle });
          }
        }
      } else if (this.activeTab === 'documents') {
        for (const d of this.filteredDocumentResults) {
          const sigle = sourceMap.get(d.quelle_id)?.quellensigle ?? '';
          targetDocs.push({ doc: d, sourceSigle: sigle });
        }
      } else if (this.activeTab === 'melody') {
        for (const mr of this.filteredMelodyResults) {
          const sigle = mr.sourceSigle || (sourceMap.get(mr.document.quelle_id)?.quellensigle ?? '');
          targetDocs.push({ doc: mr.document, sourceSigle: sigle });
        }
      }

      if (targetDocs.length === 0) {
        this.patternProgress = { phase: 'No documents in results to analyze', current: 0, total: 0, percent: 100 };
        this.patternSearching = false;
        this.updatePatternCache();
        this.cdRef.markForCheck();
        return;
      }

      this.patternProgress = { phase: 'Loading document melodies...', current: 0, total: targetDocs.length, percent: 0 };
      this.cdRef.markForCheck();

      const loadedDocs: LoadedDoc[] = [];

      const BATCH_SIZE = 100;
      for (let i = 0; i < targetDocs.length; i += BATCH_SIZE) {
        if (this.patternCancelled) return;
        
        const batch = targetDocs.slice(i, i + BATCH_SIZE);
        const promises = batch.map(async (target) => {
          try {
            const root = await NotesStore.get(target.doc.id);
            if (root) {
              const syllables = extractSyllables(root);
              const { notes, sylIdx } = flattenNotes(syllables);
              if (notes.length > 0) {
                let sequence: string[] = [];
                if (this.patternType === 'pitch') {
                  sequence = toPitchNames(notes, this.patternWithOctave);
                } else if (this.patternType === 'contour') {
                  sequence = toContour(notes);
                } else if (this.patternType === 'interval') {
                  sequence = toIntervals(notes);
                }

                loadedDocs.push({
                  doc: target.doc,
                  sourceSigle: target.sourceSigle,
                  notes,
                  syllables,
                  sylIdx,
                  sequence
                });
              }
            }
          } catch (e) {
            console.warn(`Failed to fetch notes for ${target.doc.id}:`, e);
          }
        });

        await Promise.all(promises);

        const currentProgress = Math.min(i + BATCH_SIZE, targetDocs.length);
        this.patternProgress.current = currentProgress;
        this.patternProgress.percent = Math.round((currentProgress / targetDocs.length) * 100);
        this.cdRef.markForCheck();
        await this.yieldToUI();
      }

      if (this.patternCancelled) return;

      if (loadedDocs.length === 0) {
        this.patternProgress = { phase: 'No melodies with notes found', current: 0, total: 0, percent: 100 };
        this.patternSearching = false;
        this.updatePatternCache();
        this.cdRef.markForCheck();
        return;
      }

      this.patternProgress.phase = 'Handing analysis to background worker…';
      this.patternProgress.percent = 0;
      this.cdRef.markForCheck();
      await this.yieldToUI();

      // Reset prior dedup state — the worker reports a fresh set with the
      // success message. We pre-seed `patternDocTotalNotes` with every
      // doc's note count and prune it down once the worker tells us which
      // ones were dropped as duplicates.
      this.detectedDuplicates = [];
      this.patternDocTotalNotes.clear();
      for (const ld of loadedDocs) {
        this.patternDocTotalNotes.set(ld.doc.id!, ld.notes.length);
      }

      if (this.patternWorker) {
        this.patternWorker.terminate();
      }

      this.patternWorker = new Worker(new URL('./pattern.worker', import.meta.url), { type: 'module' });

      this.patternWorker.onmessage = ({ data }) => {
        if (this.patternCancelled) {
          if (this.patternWorker) {
            this.patternWorker.terminate();
            this.patternWorker = null;
          }
          return;
        }

        // Incremental progress message from the worker.
        if (data.kind === 'progress') {
          this.patternProgress = {
            phase:   data.phase,
            current: data.current,
            total:   data.total,
            percent: data.percent,
          };
          this.cdRef.markForCheck();
          return;
        }

        if (data.kind === 'success') {
          const groups = data.groups;
          this.patternGroups = groups;

          // Apply the worker's dedup decisions to the main-thread caches.
          // We have to do this before timeline construction so that any
          // dedup-excluded docs are removed from `patternDocTotalNotes`
          // (otherwise the timeline view would still show their lanes).
          this.detectedDuplicates = data.detectedDuplicates || [];
          if (this.patternDeduplicateEnabled && Array.isArray(data.excludedDocIds)) {
            for (const id of data.excludedDocIds as string[]) {
              this.patternDocTotalNotes.delete(id);
            }
          }

          this.patternTimelineDocs = data.patternTimelineDocs || [];

          this.patternSearching = false;
          this.patternProgress = { phase: 'Analysis completed successfully', current: groups.length, total: groups.length, percent: 100 };
          this.updatePatternCache();
          this.cdRef.markForCheck();
        } else {
          console.error('Worker reported error:', data.error);
          this.patternSearching = false;
          this.patternProgress.phase = 'Failed with error: ' + data.error;
          this.updatePatternCache();
          this.cdRef.markForCheck();
        }

        if (this.patternWorker) {
          this.patternWorker.terminate();
          this.patternWorker = null;
        }
      };

      this.patternWorker.onerror = (err) => {
        console.error('Worker error:', err);
        this.patternSearching = false;
        this.patternProgress.phase = 'Failed with worker error';
        this.updatePatternCache();
        this.cdRef.markForCheck();
        if (this.patternWorker) {
          this.patternWorker.terminate();
          this.patternWorker = null;
        }
      };

      // Hand the full list to the worker — duplicate detection happens
      // there too, so we no longer need a main-thread pre-filter.
      this.patternWorker.postMessage({
        loadedDocs,
        patternType: this.patternType,
        patternLength: this.patternLength,
        patternStrictness: this.patternStrictness,
        patternMergeEnabled: this.patternMergeEnabled,
        patternMinMergeOverlap: this.patternMinMergeOverlap,
        patternDeduplicateEnabled: this.patternDeduplicateEnabled,
      });
      this.updatePatternCache();
      this.cdRef.markForCheck();

    } catch (err) {
      console.error('Melodic Pattern Grouping failed:', err);
      this.patternSearching = false;
      this.patternProgress.phase = 'Failed with error: ' + (err as Error).message;
      this.updatePatternCache();
      this.cdRef.markForCheck();
    }
  }

  enableDeduplicationAndReRun() {
    this.patternDeduplicateEnabled = true;
    this.runPatternGrouping();
  }

  clearDetectedDuplicates() {
    this.detectedDuplicates = [];
    this.updatePatternCache();
    this.cdRef.markForCheck();
  }
}


// ─── Needleman-Wunsch Alignment & Extraction Utilities ────────────────────────

function extractFlatElements(root: VM.RootContainer): (VM.Clef | VM.Syllable)[] {
  const result: (VM.Clef | VM.Syllable)[] = [];
  
  const walk = (node: any) => {
    if (!node) return;
    if (node.kind === 'Clef' || node.kind === 'Syllable') {
      result.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item);
      }
    } else if (typeof node === 'object') {
      if (node.children && Array.isArray(node.children)) {
        walk(node.children);
      } else {
        for (const key of Object.keys(node)) {
          if (typeof node[key] === 'object') {
            walk(node[key]);
          }
        }
      }
    }
  };
  
  walk(root.children);
  return result;
}

function needlemanWunschProfile(
  alignedCols: AlignedLineElement[][],
  seq2: (VM.Clef | VM.Syllable)[],
  docLimit: number,
  mode: 'melody' | 'text' = 'melody'
): { aligned1: (AlignedLineElement[] | null)[]; aligned2: (VM.Clef | VM.Syllable | null)[] } {
  const M = alignedCols.length;
  const N = seq2.length;
  const GAP_PENALTY = -1;

  const scoreFnSingle = (el1: VM.Clef | VM.Syllable, el2: VM.Clef | VM.Syllable): number => {
    if (el1.kind !== el2.kind) return -3;
    if (el1.kind === 'Clef') {
      const c1 = el1 as VM.Clef;
      const c2 = el2 as VM.Clef;
      return c1.shape === c2.shape ? 2 : 0;
    } else {
      const s1 = el1 as VM.Syllable;
      const s2 = el2 as VM.Syllable;
      const t1 = (s1.text || '').trim().toLowerCase();
      const t2 = (s2.text || '').trim().toLowerCase();

      // Pitch extraction
      const spaced1 = s1.notes?.spaced ?? [];
      const pitches1: string[] = [];
      spaced1.forEach(ns => (ns.nonSpaced ?? []).forEach(g => (g.grouped ?? []).forEach(n => pitches1.push(n.base))));
      
      const spaced2 = s2.notes?.spaced ?? [];
      const pitches2: string[] = [];
      spaced2.forEach(ns => (ns.nonSpaced ?? []).forEach(g => (g.grouped ?? []).forEach(n => pitches2.push(n.base))));
      
      const pitchString1 = pitches1.join(',');
      const pitchString2 = pitches2.join(',');

      if (mode === 'text') {
        if (t1 && t2) {
          if (t1 === t2) return 4;
          if (t1.length > 1 && t2.length > 1 && (t1.includes(t2) || t2.includes(t1))) return 3;
          let d = 0;
          let p1 = 0, p2 = 0;
          while (p1 < t1.length && p2 < t2.length) {
            if (t1[p1] !== t2[p2]) {
              d++;
              if (t1.length > t2.length) p1++;
              else if (t2.length > t1.length) p2++;
              else { p1++; p2++; }
            } else {
              p1++; p2++;
            }
          }
          d += (t1.length - p1) + (t2.length - p2);
          if (d <= 1) return 3;
        }
        if (pitchString1 && pitchString2 && pitchString1 === pitchString2) {
          return 1;
        }
        return 0;
      } else {
        if (pitchString1 && pitchString2 && pitchString1 === pitchString2) {
          return 4;
        }
        if (pitches1.length > 0 && pitches2.length > 0 && Math.abs(pitches1.length - pitches2.length) <= 1) {
          let matches = 0;
          for (const p of pitches1) {
            if (pitches2.includes(p)) matches++;
          }
          if (matches >= Math.max(pitches1.length, pitches2.length) - 1) {
            return 2;
          }
        }
        if (t1 && t2 && t1 === t2) {
          return 1;
        }
        return 0;
      }
    }
  };

  const scoreFnProfile = (col: AlignedLineElement[], el2: VM.Clef | VM.Syllable): number => {
    let maxScore = -999;
    let hasComparison = false;
    for (let d = 0; d < docLimit; d++) {
      const el1 = col[d]?.element;
      if (el1) {
        const s = scoreFnSingle(el1, el2);
        if (s > maxScore) {
          maxScore = s;
        }
        hasComparison = true;
      }
    }
    return hasComparison ? maxScore : GAP_PENALTY;
  };

  const dp: number[][] = Array.from({ length: M + 1 }, () => Array(N + 1).fill(0));
  for (let i = 0; i <= M; i++) dp[i][0] = i * GAP_PENALTY;
  for (let j = 0; j <= N; j++) dp[0][j] = j * GAP_PENALTY;

  for (let i = 1; i <= M; i++) {
    for (let j = 1; j <= N; j++) {
      const match = dp[i - 1][j - 1] + scoreFnProfile(alignedCols[i - 1], seq2[j - 1]);
      const deleteScore = dp[i - 1][j] + GAP_PENALTY;
      const insertScore = dp[i][j - 1] + GAP_PENALTY;
      dp[i][j] = Math.max(match, deleteScore, insertScore);
    }
  }

  const aligned1: (AlignedLineElement[] | null)[] = [];
  const aligned2: (VM.Clef | VM.Syllable | null)[] = [];
  let i = M;
  let j = N;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const score = scoreFnProfile(alignedCols[i - 1], seq2[j - 1]);
      if (dp[i][j] === dp[i - 1][j - 1] + score) {
        aligned1.unshift(alignedCols[i - 1]);
        aligned2.unshift(seq2[j - 1]);
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && (j === 0 || dp[i][j] === dp[i - 1][j] + GAP_PENALTY)) {
      aligned1.unshift(alignedCols[i - 1]);
      aligned2.unshift(null);
      i--;
    } else {
      aligned1.unshift(null);
      aligned2.unshift(seq2[j - 1]);
      j--;
    }
  }

  return { aligned1, aligned2 };
}
