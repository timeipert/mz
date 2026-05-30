import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
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
}

// ─── Melody-search result ─────────────────────────────────────────────────────

export interface MelodyResult {
  document: Document;
  sourceSigle: string;
  noteCount: number;
  matchingSyllables: VM.Syllable[];
  matchSylSet: Set<string>; // Set of matching syllable UUIDs
  distance?: number;     // Levenshtein distance for display
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

function toPitchNames(notes: VM.Note[], withOctave: boolean): string[] {
  return notes.map(n => {
    let name = n.base.toLowerCase();
    if (n.noteType === VM.NoteType.Flat) {
      name += 'b';
    } else if (n.noteType === VM.NoteType.Sharp) {
      name += '#';
    }
    return withOctave ? `${name}${n.octave}` : name;
  });
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

export interface SequenceMatch {
  start: number;
  end: number;
  distance: number;
}

function levenshteinDistance(s1: string, s2: string): number {
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
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
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

function parseMelodyPattern(raw: string, searchType: 'pitch' | 'contour', withOctave: boolean): string[] {
  const clean = raw.trim();
  if (searchType === 'contour') {
    if (clean.includes(' ')) {
      return clean.split(/\s+/).filter(Boolean).map(p => p.toLowerCase());
    } else {
      return clean.split('').filter(char => !/\s/.test(char)).map(p => p.toLowerCase());
    }
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
export class SearchComponent implements OnInit, OnDestroy {
  activeTab: 'quick' | 'sources' | 'documents' | 'melody' = 'quick';
  user: User | null = null;
  subs: Subscription[] = [];
  settings: ProjectSettings | null = null;

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

  // ── Melody search ─────────────────────────────────────────────────────────
  melodyPattern = '';
  melodySearchType: 'pitch' | 'contour' = 'pitch';
  melodyWithOctave = false;
  melodyResults: MelodyResult[] = [];
  melodySearched = false;
  melodySearching = false;
  melodyScanned = 0;
  melodyWithNotes = 0;
  melodyMaxDistance = 0;

  // ── Recent searches ───────────────────────────────────────────────────────
  recentSearches: string[] = [];

  constructor(
    private api: APIService,
    private router: Router,
    private userService: UserService,
    private pageTitle: PageTitleService,
    private sanitizer: DomSanitizer,
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

  matchText(text: string, query: string, mode: 'phrase' | 'words-and' | 'words-or' | 'fuzzy', spellingTolerance: boolean, maxDistance: number): { matched: boolean; snippet?: TextSnippet } {
    if (!text) return { matched: false };
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
          return { matched: true, snippet };
        }
        return { matched: false };
      } else {
        const idx = text.toLowerCase().indexOf(query.toLowerCase());
        if (idx !== -1) {
          return { matched: true, snippet: findTextSnippet(text, query) };
        }
        return { matched: false };
      }
    }

    if (mode === 'words-and' || mode === 'words-or') {
      const words = query.trim().split(/\s+/).filter(Boolean);
      if (words.length === 0) return { matched: false };

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
            return { matched: true, snippet: findTextSnippet(text, w) };
          }
        }
        return { matched: true, snippet: { before: '', match: text.substring(0, Math.min(text.length, 25)), after: '…' } };
      }
      return { matched: false };
    }

    if (mode === 'fuzzy') {
      const targetWords = text.toLowerCase().split(/\s+/).filter(Boolean);
      const queryWords = query.toLowerCase().split(/\s+/).filter(Boolean);
      if (queryWords.length === 0) return { matched: false };

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
        return { matched: bestDist <= maxDistance, word: matchedTargetWord };
      });

      const matched = matchedWords.every(mw => mw.matched);
      if (matched && matchedWords.length > 0) {
        const firstMatch = matchedWords[0].word;
        if (firstMatch) {
          const origIdx = text.toLowerCase().indexOf(firstMatch);
          const origWord = origIdx !== -1 ? text.substring(origIdx, origIdx + firstMatch.length) : firstMatch;
          const snippet = findTextSnippet(text, origWord);
          return { matched: true, snippet };
        }
        return { matched: true };
      }
      return { matched: false };
    }

    return { matched: false };
  }

  searchQuick() {
    if (!this.user || !this.quickText.trim()) return;
    this.quickSearching = true;
    this.quickSearched = false;
    this.addRecentSearch(this.quickText);

    forkJoin({
      sources: this.api.listSources(this.user.token),
      docs:    this.api.listDocuments(this.user.token),
      notes:   this.api.getAllDocumentNotes(this.user.token),
    }).subscribe(({ sources, docs, notes }) => {
      const results: QuickResult[] = [];
      const allNotes = notes as unknown as { [id: string]: VM.RootContainer };

      if (sources.kind === 'SourcesRetrieved') {
        for (const s of sources.sources) {
          const metaFields = Object.values(s).filter(v => typeof v === 'string').map(v => v as string);
          let matched = false;
          for (const val of metaFields) {
            const matchRes = this.matchText(val, this.quickText, this.quickSearchMode, this.quickMedievalTolerance, this.quickFuzzyDistance);
            if (matchRes.matched) {
              matched = true;
              break;
            }
          }
          if (matched) {
            results.push({
              kind: 'source', id: s.id!,
              title:    s.quellensigle || s.bibliothekssignatur || '(no siglum)',
              subtitle: [s.herkunftsinstitution, s.herkunftsort].filter(Boolean).join(', '),
              extra:    [s.quellentyp, s.datierung].filter(Boolean).join(' · '),
            });
          }
        }
      }

      if (docs.kind === 'DocumentsRetrieved') {
        for (const d of docs.documents) {
          const metaFields = Object.values(d).filter(v => typeof v === 'string').map(v => v as string);
          const root    = allNotes[d.id];
          
          const sylsList = root ? extractSyllables(root).map(s => s.text) : [];
          const sylRaw  = sylsList.join('');
          const sylClean = sylRaw.replace(/-/g, '');
          const sylSpaced = sylsList.join(' ').replace(/-/g, ' ');

          let matchMeta = false;
          let metaSnippet: TextSnippet | undefined;
          for (const val of metaFields) {
            const matchRes = this.matchText(val, this.quickText, this.quickSearchMode, this.quickMedievalTolerance, this.quickFuzzyDistance);
            if (matchRes.matched) {
              matchMeta = true;
              metaSnippet = matchRes.snippet;
              break;
            }
          }

          const matchSylRaw = this.matchText(sylRaw, this.quickText, this.quickSearchMode, this.quickMedievalTolerance, this.quickFuzzyDistance);
          const matchSylClean = this.matchText(sylClean, this.quickText, this.quickSearchMode, this.quickMedievalTolerance, this.quickFuzzyDistance);
          const matchSylSpaced = this.matchText(sylSpaced, this.quickText, this.quickSearchMode, this.quickMedievalTolerance, this.quickFuzzyDistance);

          const matchSyl = matchSylRaw.matched || matchSylClean.matched || matchSylSpaced.matched;

          if (matchMeta || matchSyl) {
            let snippet = metaSnippet;
            if (matchSyl && !matchMeta) {
              snippet = matchSylSpaced.snippet ?? matchSylClean.snippet ?? matchSylRaw.snippet;
            } else if (matchSyl && matchMeta && !snippet) {
              snippet = matchSylSpaced.snippet ?? matchSylClean.snippet ?? matchSylRaw.snippet;
            }

            results.push({
              kind: 'document', id: d.id, sourceId: d.quelle_id,
              title:    d.textinitium || d.dokumenten_id || '(no incipit)',
              subtitle: [d.gattung1, d.gattung2].filter(Boolean).join(' / '),
              extra:    [d.festtag, d.feier].filter(Boolean).join(' · '),
              snippet,
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
    this.melodySearching  = true;
    this.melodySearched   = false;
    this.melodyScanned    = 0;
    this.melodyWithNotes  = 0;
    const pattern = parseMelodyPattern(this.melodyPattern, this.melodySearchType, this.melodyWithOctave);

    forkJoin({
      docsRes:    this.api.listDocuments(this.user.token),
      notesRes:   this.api.getAllDocumentNotes(this.user.token),
      sourcesRes: this.api.listSources(this.user.token),
    }).subscribe(({ docsRes, notesRes, sourcesRes }) => {
      const allDocs    = docsRes.kind    === 'DocumentsRetrieved' ? docsRes.documents  : [];
      const allNotes   = notesRes as unknown as { [id: string]: VM.RootContainer };
      const allSources = sourcesRes.kind === 'SourcesRetrieved'  ? sourcesRes.sources  : [];
      const results: MelodyResult[] = [];

      this.melodyScanned = allDocs.length;

      for (const doc of allDocs) {
        const root = allNotes[doc.id];
        if (!root) continue;

        const syllables = extractSyllables(root);
        const { notes, sylIdx } = flattenNotes(syllables);
        if (notes.length === 0) continue;
        this.melodyWithNotes++;

        // Build the sequence to search
        const sequence = this.melodySearchType === 'pitch'
          ? toPitchNames(notes, this.melodyWithOctave)
          : toContour(notes);

        const matches = findSubsequenceMatches(sequence, pattern, this.melodyMaxDistance);
        if (matches.length === 0) continue;

        // Take the best match (minimum distance)
        const bestMatch = matches[0];
        const matchStart = bestMatch.start;
        const matchEndNote = bestMatch.end;
        const distance = bestMatch.distance;

        // Determine which syllables are "in the match"
        const matchSylSet = new Set<string>();
        for (let ni = matchStart; ni <= matchEndNote && ni < sylIdx.length; ni++) {
          const syl = syllables[sylIdx[ni]];
          if (syl?.uuid) {
            matchSylSet.add(syl.uuid);
          }
        }

        // Context window: 3 syllables of padding before and after the match
        const matchingSyllableIndices = [];
        for (let ni = matchStart; ni <= matchEndNote && ni < sylIdx.length; ni++) {
          matchingSyllableIndices.push(sylIdx[ni]);
        }
        const matchSylMin = Math.min(...matchingSyllableIndices);
        const matchSylMax = Math.max(...matchingSyllableIndices);
        const ctxFirst = Math.max(0, matchSylMin - 3);
        const ctxLast  = Math.min(syllables.length - 1, matchSylMax + 3);

        const contextSyllables = syllables.slice(ctxFirst, ctxLast + 1);

        const source = allSources.find(s => s.id === doc.quelle_id);
        results.push({
          document:   doc,
          sourceSigle: source?.quellensigle ?? '',
          noteCount:  notes.length,
          matchingSyllables: contextSyllables,
          matchSylSet,
          distance,
        });
      }

      // Sort results: exact matches first, then sorted by distance, then by document metadata
      this.melodyResults  = results.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
      this.melodySearched = true;
      this.melodySearching = false;
    });
  }

  get melodyPatternHint(): string {
    if (this.melodySearchType === 'pitch') {
      return this.melodyWithOctave
        ? 'e.g. C4D4E4F4  (note names + octave, no spaces needed)'
        : 'e.g. CDEFG  (note names A–G, no spaces needed)';
    }
    return 'e.g. uudrud  (u=up, d=down, r=repeat)';
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

  get sortedSourceResults(): Source[]   { return this.sortArr(this.sourceResults,   this.srcSortCol, this.srcSortAsc); }
  get sortedDocumentResults(): Document[] { return this.sortArr(this.documentResults, this.docSortCol, this.docSortAsc); }
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
}
