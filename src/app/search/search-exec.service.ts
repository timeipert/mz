import { Injectable } from '@angular/core';
import { Subject, forkJoin, Subscription } from 'rxjs';
import { APIService, SourceQuery, DocumentQuery, Source, Document } from '../api.service';
import { UserService, User } from '../user.service';
import { PatternAnalysisService } from './pattern-analysis.service';
import { NotesStore } from '../notes-store';
import * as localforage from 'localforage';
import * as VM from '../types/model';
import {
  levenshteinDistance,
  toPitchNames,
  toContour,
  toIntervals
} from './pattern-algo';
import { textWidth } from '../../utils';

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
  snippet?: TextSnippet;
  score: number;
  matchedIn: string;
}

export interface MelodyResult {
  document: Document;
  sourceSigle: string;
  noteCount: number;
  matchingSyllables: VM.Syllable[];
  matchSylSet: Set<string>;
  matchNoteSet: Set<string>;
  distance?: number;
}

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

  const noteRegex = /(?:([bB])([b#♭♯]?)|([ac-ghAC-GH])([#♭♯]?))([0-9]?)/g;
  const matches: string[] = [];
  let match;
  
  while ((match = noteRegex.exec(clean)) !== null) {
    const isB = match[1] !== undefined;
    const base = (isB ? match[1] : match[3]).toLowerCase();
    const accidental = (isB ? match[2] : match[4]) || '';
    const octave = match[5] || '';

    let note = base;
    if (note === 'h') {
      note = 'b';
    } else if (note === 'b') {
      note = 'bb';
    }

    let accNorm = accidental.replace(/♭/g, 'b').replace(/♯/g, '#');

    if (accNorm) {
      if (note === 'bb' && accNorm === 'b') {
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

function findTextSnippet(text: string, query: string, window = 35): TextSnippet | undefined {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return undefined;

  let before = text.slice(Math.max(0, idx - window), idx);
  if (idx - window > 0) before = '…' + before.replace(/^\S+\s/, '');

  const match = text.slice(idx, idx + query.length);

  let after = text.slice(idx + query.length, idx + query.length + window);
  if (idx + query.length + window < text.length) after = after.replace(/\s\S+$/, '') + '…';

  return { before, match, after };
}

function walkZeilen(children: any[], cb: (zeile: any) => void) {
  if (!Array.isArray(children)) return;
  for (const child of children) {
    if (child?.kind === 'ZeileContainer') cb(child);
    else if (Array.isArray(child?.children)) walkZeilen(child.children, cb);
  }
}

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

@Injectable({
  providedIn: 'root'
})
export class SearchExecService {
  stateChanged$ = new Subject<void>();

  // Cached parameters
  cachedQuickText = '';
  cachedQuickResults: QuickResult[] = [];
  cachedQuickSearched = false;
  cachedQuickMode: 'phrase' | 'words-and' | 'words-or' | 'fuzzy' = 'phrase';
  cachedQuickTolerance = true;
  cachedQuickDistance = 2;

  // Search execution states
  searchProgress = { current: 0, total: 0, matched: 0 };
  searchCancelled = false;

  quickText = '';
  quickResults: QuickResult[] = [];
  quickSearched = false;
  quickSearching = false;
  quickSearchMode: 'phrase' | 'words-and' | 'words-or' | 'fuzzy' = 'phrase';
  quickMedievalTolerance = true;
  quickFuzzyDistance = 2;
  quickPage = 1;
  quickPageSize = 25;

  sourceQuery: SourceQuery = {};
  sourceResults: Source[] = [];
  sourceSearched = false;
  sourceSearching = false;
  sourcesPage = 1;
  sourcesPageSize = 25;

  documentQuery: DocumentQuery = {
    dokumenten_id: undefined, gattung1: undefined, gattung2: undefined,
    festtag: undefined, feier: undefined, textinitium: undefined,
    bibliographischerverweis: undefined, druckausgabe: undefined,
    zeilenstart: undefined, foliostart: undefined, kommentar: undefined,
  };
  documentResults: Document[] = [];
  documentSearched = false;
  documentSearching = false;
  documentsPage = 1;
  documentsPageSize = 25;

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
  melodyPage = 1;
  melodyPageSize = 10;

  user: User | null = null;
  private subs: Subscription[] = [];

  constructor(
    private api: APIService,
    private userService: UserService,
    private patternSvc: PatternAnalysisService
  ) {
    this.subs.push(this.userService.user.subscribe(user => {
      this.user = user;
    }));
  }

  notifyChange() {
    this.stateChanged$.next();
  }

  matchText(text: string, query: string, mode: 'phrase' | 'words-and' | 'words-or' | 'fuzzy', spellingTolerance: boolean, maxDistance: number): { matched: boolean; snippet?: TextSnippet; score: number } {
    return matchTextInternal(text, query, mode, spellingTolerance, maxDistance);
  }

  async searchQuick(
    addRecentSearch: (q: string) => void,
    onFilterReset: () => void
  ) {
    if (!this.user || !this.quickText.trim()) return;

    if (
      this.cachedQuickSearched &&
      this.cachedQuickText === this.quickText &&
      this.cachedQuickMode === this.quickSearchMode &&
      this.cachedQuickTolerance === this.quickMedievalTolerance &&
      this.cachedQuickDistance === this.quickFuzzyDistance
    ) {
      this.quickResults = this.cachedQuickResults.slice();
      this.quickSearched = true;
      this.searchProgress = { current: this.quickResults.length, total: this.quickResults.length, matched: this.quickResults.length };
      this.notifyChange();
      return;
    }

    this.quickSearching = true;
    this.quickSearched = false;
    this.searchCancelled = false;
    this.searchProgress = { current: 0, total: 0, matched: 0 };
    this.quickPage = 1;
    onFilterReset();
    addRecentSearch(this.quickText);
    this.notifyChange();

    try {
      const [sources, docs] = await Promise.all([
        this.api.listSources(this.user.token).toPromise(),
        this.api.listDocuments(this.user.token).toPromise(),
      ]);

      const results: QuickResult[] = [];

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
               const res = matchTextInternal(val, this.quickText, this.quickSearchMode, this.quickMedievalTolerance, this.quickFuzzyDistance);
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

      const allDocs = docs?.kind === 'DocumentsRetrieved' ? docs.documents : [];
      this.searchProgress = { current: 0, total: allDocs.length, matched: results.length };
      this.notifyChange();

      const BATCH_SIZE = 100;
      for (let i = 0; i < allDocs.length; i += BATCH_SIZE) {
        if (this.searchCancelled) { this.finishQuickSearch(results); return; }
        
        const batch = allDocs.slice(i, i + BATCH_SIZE);
        const promises = batch.map(async (d) => {
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
               const m = matchTextInternal(val, this.quickText, this.quickSearchMode, this.quickMedievalTolerance, this.quickFuzzyDistance);
               if (m.matched && (!bestMeta || m.score > bestMeta.score)) {
                  const finalScore = key === 'Incipit' ? Math.min(100, m.score + 5) : m.score;
                  bestMeta = { score: finalScore, matchedIn: key, snippet: m.snippet };
               }
            }
          }

          let bestSyl: {score: number, matchedIn: string, snippet?: TextSnippet} | null = null;
          try {
            const root = await NotesStore.get(d.id);
            if (root) {
              const sylsList = extractSyllables(root).map(s => s.text);
              const sylRaw    = sylsList.join('');
              const sylClean  = sylRaw.replace(/-/g, '');
              const sylSpaced = sylsList.join(' ').replace(/-/g, ' ');
              const ms1 = matchTextInternal(sylSpaced, this.quickText, this.quickSearchMode, this.quickMedievalTolerance, this.quickFuzzyDistance);
              const ms2 = !ms1.matched ? matchTextInternal(sylClean, this.quickText, this.quickSearchMode, this.quickMedievalTolerance, this.quickFuzzyDistance) : ms1;
              const ms3 = !ms2.matched ? matchTextInternal(sylRaw,    this.quickText, this.quickSearchMode, this.quickMedievalTolerance, this.quickFuzzyDistance) : ms2;
              
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
        this.quickResults = results.slice();
        this.notifyChange();
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      this.finishQuickSearch(results);
    } catch (err) {
      console.error('Quick search failed:', err);
      this.quickSearching = false;
      this.quickSearched = true;
      this.notifyChange();
    }
  }

  private finishQuickSearch(results: QuickResult[]): void {
    results.sort((a, b) => b.score - a.score);
    this.quickResults = results;
    this.quickSearched = true;
    this.quickSearching = false;

    this.cachedQuickText = this.quickText;
    this.cachedQuickMode = this.quickSearchMode;
    this.cachedQuickTolerance = this.quickMedievalTolerance;
    this.cachedQuickDistance = this.quickFuzzyDistance;
    this.cachedQuickResults = this.quickResults.slice();
    this.cachedQuickSearched = true;

    this.saveSearchStateToIndexedDB();
    this.notifyChange();
  }

  searchSources() {
    if (!this.user) return;
    this.sourceSearching = true;
    this.sourceSearched = false;
    this.sourcesPage = 1;
    this.api.querySources(this.user.token, this.sourceQuery).subscribe(res => {
      if (res.kind === 'SourcesRetrieved') this.sourceResults = res.sources;
      this.sourceSearched = true;
      this.sourceSearching = false;
      this.saveSearchStateToIndexedDB();
      this.notifyChange();
    });
  }

  searchDocuments() {
    if (!this.user) return;
    this.documentSearching = true;
    this.documentSearched = false;
    this.documentsPage = 1;
    this.api.queryDocuments(this.user.token, this.documentQuery).subscribe(res => {
      if (res.kind === 'DocumentsRetrieved') this.documentResults = res.documents;
      this.documentSearched = true;
      this.documentSearching = false;
      this.saveSearchStateToIndexedDB();
      this.notifyChange();
    });
  }

  async searchMelody() {
    if (!this.user || !this.melodyPattern.trim()) return;
    this.melodySearching  = true;
    this.melodySearched   = false;
    this.melodyScanned    = 0;
    this.melodyWithNotes  = 0;
    this.searchCancelled  = false;
    this.searchProgress = { current: 0, total: 0, matched: 0 };
    this.melodyPage = 1;

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
      this.notifyChange();

      const BATCH_SIZE = 100;
      for (let i = 0; i < allDocs.length; i += BATCH_SIZE) {
        if (this.searchCancelled) { this.finishMelodySearch(results); return; }
        
        const batch = allDocs.slice(i, i + BATCH_SIZE);
        const promises = batch.map(async (doc) => {
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
        this.melodyResults = results.slice().sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
        this.notifyChange();
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      this.finishMelodySearch(results);
    } catch (err) {
      console.error('Melody search failed:', err);
      this.melodySearching = false;
      this.melodySearched = true;
      this.notifyChange();
    }
  }

  private finishMelodySearch(results: MelodyResult[]): void {
    this.melodyResults  = results.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
    this.melodySearched = true;
    this.melodySearching = false;
    this.saveSearchStateToIndexedDB();
    this.notifyChange();
  }

  cancelSearch(): void {
    this.searchCancelled = true;
    this.notifyChange();
  }

  activeTab: 'quick' | 'sources' | 'documents' | 'melody' = 'quick';

  async saveSearchStateToIndexedDB(activeTab?: string) {
    try {
      const searchData = {
        activeTab: activeTab || this.activeTab,
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

  async loadFromIndexedDB(
    onRetriggerPatternGrouping: () => void,
    onSetActiveTab: (tab: any) => void
  ) {
    try {
      // 0. Load saved pattern sessions list
      try {
        const saved: any = await localforage.getItem('saved_pattern_sessions');
        if (Array.isArray(saved)) {
          this.patternSvc.savedPatternSessions = saved;
        } else {
          this.patternSvc.savedPatternSessions = [];
        }
      } catch (e) {
        console.warn('Failed to load saved pattern sessions:', e);
        this.patternSvc.savedPatternSessions = [];
      }

      // 1. Load pattern analysis state
      const staticCachePopulated = this.patternSvc.patternGroups.length > 0
                                || this.patternSvc.showPatternAnalysis;

      if (!staticCachePopulated) {
        let savedParams: any = null;
        try {
          const raw = localStorage.getItem('monodi_pattern_params');
          if (raw) savedParams = JSON.parse(raw);
        } catch { /* ignore */ }

        if (savedParams?.showPatternAnalysis) {
          this.patternSvc.patternLength           = savedParams.patternLength           ?? this.patternSvc.patternLength;
          this.patternSvc.patternType             = savedParams.patternType             ?? this.patternSvc.patternType;
          this.patternSvc.patternWithOctave       = !!savedParams.patternWithOctave;
          this.patternSvc.patternStrictness       = savedParams.patternStrictness       ?? this.patternSvc.patternStrictness;
          this.patternSvc.patternMergeEnabled     = !!savedParams.patternMergeEnabled;
          this.patternSvc.patternMinMergeOverlap  = savedParams.patternMinMergeOverlap  ?? this.patternSvc.patternMinMergeOverlap;
          this.patternSvc.patternDeduplicateEnabled = savedParams.patternDeduplicateEnabled !== false;
          this.patternSvc.patternViewMode         = savedParams.patternViewMode         ?? this.patternSvc.patternViewMode;
          this.patternSvc.patternPage             = savedParams.patternPage             ?? 1;
          this.patternSvc.showPatternAnalysis     = true;

          setTimeout(() => {
            if (this.patternSvc.showPatternAnalysis && this.patternSvc.patternGroups.length === 0) {
              onRetriggerPatternGrouping();
            }
          }, 0);
        }
      }

      // 2. Restore only lightweight VIEW PREFERENCES from the last session.
      const searchData: any = await localforage.getItem('search_state');
      if (searchData) {
        if (searchData.activeTab) {
          this.activeTab = searchData.activeTab;
          onSetActiveTab(searchData.activeTab);
        }

        if (searchData.quickSearchMode) this.quickSearchMode = searchData.quickSearchMode;
        this.quickMedievalTolerance = !!searchData.quickMedievalTolerance;
        if (searchData.quickFuzzyDistance !== undefined) this.quickFuzzyDistance = searchData.quickFuzzyDistance;

        if (searchData.melodySearchType) this.melodySearchType = searchData.melodySearchType;
        this.melodyWithOctave = !!searchData.melodyWithOctave;
        this.melodyOnlyWithinSyllables = !!searchData.melodyOnlyWithinSyllables;
        if (searchData.melodyWithNotes !== undefined) this.melodyWithNotes = searchData.melodyWithNotes;
        if (searchData.melodyMaxDistance !== undefined) this.melodyMaxDistance = searchData.melodyMaxDistance;
      }
      this.notifyChange();
    } catch (e) {
      console.warn('Error loading state from IndexedDB:', e);
    }
  }
}

function matchTextInternal(text: string, query: string, mode: 'phrase' | 'words-and' | 'words-or' | 'fuzzy', spellingTolerance: boolean, maxDistance: number): { matched: boolean; snippet?: TextSnippet; score: number } {
  if (!text) return { matched: false, score: 0 };
  const norm = (s: string) => {
    let res = s.toLowerCase();
    if (spellingTolerance) {
      res = res
        .replace(/[jv]/g, char => char === 'j' ? 'i' : 'u')
        .replace(/y/g, 'i')
        .replace(/ae/g, 'e')
        .replace(/(.)\1+/g, '$1');
    }
    return res;
  };

  const targetNorm = norm(text);
  const queryNorm = norm(query);

  if (mode === 'phrase') {
    if (spellingTolerance) {
      const idx = targetNorm.indexOf(queryNorm);
      if (idx !== -1) {
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
          const dist = levenshteinDistance(norm(res.matchedSub || ''), norm(qw));
          if (dist < bestDist) {
            bestDist = dist;
            matchedTargetWord = tw;
          }
        }
      }
      return { matched: bestDist <= maxDistance, word: matchedTargetWord, dist: bestDist };
    });

    const matched = queryWords.length > 0 && matchedWords.every(mw => mw.matched);
    if (matched) {
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
