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
  svg: SafeHtml;         // pre-rendered SVG showing the matching context
}

// ─── Syllable data ────────────────────────────────────────────────────────────

/** A syllable with its note groups as they are stored (Spaced → NonSpaced → Grouped). */
interface SyllableData {
  text: string;
  // spaced[i][j][k] = k-th note of the j-th Grouped inside the i-th NonSpaced
  spaced: VM.Note[][][];
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
function extractSyllables(root: VM.RootContainer): SyllableData[] {
  const result: SyllableData[] = [];
  walkZeilen(root.children, zeile => {
    for (const part of (zeile.children || [])) {
      if (part?.kind === 'Syllable') {
        const syl = part as VM.Syllable;
        const spaced: VM.Note[][][] = (syl.notes?.spaced ?? []).map(
          ns => (ns.nonSpaced ?? []).map(g => g.grouped ?? [])
        );
        result.push({ text: syl.text ?? '', spaced });
      }
    }
  });
  return result;
}

/** Flat note array for pattern matching. Also returns per-note syllable index. */
function flattenNotes(syllables: SyllableData[]): { notes: VM.Note[]; sylIdx: number[] } {
  const notes: VM.Note[] = [];
  const sylIdx: number[] = [];
  syllables.forEach((syl, si) => {
    syl.spaced.forEach(ns => {
      ns.forEach(g => {
        g.forEach(n => { notes.push(n); sylIdx.push(si); });
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

/** Returns the first index in `sequence` where `pattern` starts, or -1. */
function findPatternStart(sequence: string[], pattern: string[]): number {
  if (pattern.length === 0 || sequence.length < pattern.length) return -1;
  outer: for (let i = 0; i <= sequence.length - pattern.length; i++) {
    for (let j = 0; j < pattern.length; j++) {
      if (sequence[i + j].toLowerCase() !== pattern[j].toLowerCase()) continue outer;
    }
    return i;
  }
  return -1;
}

function parsePattern(raw: string): string[] {
  return raw.trim().split(/\s+/).filter(s => s.length > 0);
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

/**
 * Render a window of syllables as an SVG staff snippet.
 *
 * Uses exactly the same coordinate formula as the app's own Drawables.ts:
 *   noteY = 60 − (octave − 4) × 35 − baseNoteIndex × 5
 * then scaled by SCALE and shifted to fit the preview canvas.
 *
 * @param syllables   full list extracted from the document
 * @param matchSylSet set of syllable indices that contain matching notes
 * @param firstSyl    index of the first syllable to display (context window start)
 * @param lastSyl     index of the last syllable to display (inclusive)
 */
function buildMelodySvg(
  syllables: SyllableData[],
  matchSylSet: Set<number>,
  firstSyl: number,
  lastSyl: number
): string {
  const SCALE      = 0.5;
  const NOTE_W     = 10;   // px (original 12 * 0.5 ≈ 6; a bit larger for readability)
  const NOTE_H     = 10;
  const N_SPACE    = 14;   // between notes in a Grouped
  const G_SPACE    = 16;   // between Grouped inside NonSpaced
  const NS_SPACE   = 30;   // between NonSpaced items (= "spaced" level)
  const SYL_GAP    = 18;   // extra gap between syllables
  const PAD_LEFT   = 6;
  const TEXT_Y     = 56;   // label row y
  const SVG_H      = 68;

  // Staff lines (original 40,50,60,70,80 × SCALE)
  const staffYs = [40, 50, 60, 70, 80].map(y => y * SCALE);

  // Y for a note (same formula as Drawables.ts, scaled)
  const noteY = (n: VM.Note) =>
    (60 - (n.octave - 4) * 35 - VM.baseNotes.indexOf(n.base) * 5) * SCALE;

  // Helper line threshold: y ≤ top-staff or y ≥ bottom-staff
  const TOP_STAFF    = staffYs[0];
  const BOTTOM_STAFF = staffYs[staffYs.length - 1];

  interface RendNote { x: number; y: number; isMatch: boolean; }
  interface RendHelper { x: number; y: number; }
  interface RendTie { x: number; y: number; width: number; }
  interface RendLabel { cx: number; text: string; isMatch: boolean; }
  interface RendHighlight { x: number; width: number; }

  const rendNotes:   RendNote[]      = [];
  const rendHelpers: RendHelper[]    = [];
  const rendTies:    RendTie[]       = [];
  const rendLabels:  RendLabel[]     = [];
  const rendHighs:   RendHighlight[] = [];

  let cx = PAD_LEFT;

  for (let si = firstSyl; si <= lastSyl && si < syllables.length; si++) {
    const syl     = syllables[si];
    const isMatch = matchSylSet.has(si);
    const sylX    = cx;
    let firstNoteX = cx;

    for (let nsi = 0; nsi < syl.spaced.length; nsi++) {
      const nonSpaced = syl.spaced[nsi];
      if (nsi > 0) cx += NS_SPACE;

      for (let gi = 0; gi < nonSpaced.length; gi++) {
        const group = nonSpaced[gi];
        if (gi > 0) cx += G_SPACE;
        const groupStartX = cx;

        for (let ni = 0; ni < group.length; ni++) {
          const n  = group[ni];
          const ny = noteY(n);
          if (ni > 0) cx += N_SPACE;

          rendNotes.push({ x: cx, y: ny - NOTE_H / 2, isMatch });

          // Ledger lines for notes outside the staff
          if (ny - NOTE_H / 2 < TOP_STAFF - 2) {
            rendHelpers.push({ x: cx - 2, y: TOP_STAFF - 5 });
          }
          if (ny + NOTE_H / 2 > BOTTOM_STAFF + 2) {
            rendHelpers.push({ x: cx - 2, y: BOTTOM_STAFF + 5 });
          }
          if (ni === 0) firstNoteX = cx;
        }

        // Tie arc over groups with >1 note
        if (group.length > 1) {
          const tieW = (group.length - 1) * N_SPACE + NOTE_W;
          const tieY = Math.min(...group.map(n => noteY(n) - NOTE_H / 2)) - 4;
          rendTies.push({ x: groupStartX, y: tieY, width: tieW });
        }

        cx += NOTE_W;
      }
    }

    const sylWidth = cx - sylX;
    const labelCX  = sylX + sylWidth / 2;
    rendLabels.push({ cx: labelCX, text: syl.text, isMatch });

    if (isMatch) {
      rendHighs.push({ x: sylX - 2, width: sylWidth + 4 });
    }

    cx += SYL_GAP;
  }

  const totalWidth = cx + PAD_LEFT;

  // ── Build SVG string ──────────────────────────────────────────────────────
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${SVG_H}" style="display:block;overflow:visible">`;

  // Highlight bands (behind everything)
  for (const h of rendHighs) {
    svg += `<rect x="${h.x.toFixed(1)}" y="${(staffYs[0] - 3).toFixed(1)}" `
         + `width="${h.width.toFixed(1)}" height="${(staffYs[4] - staffYs[0] + 6).toFixed(1)}" `
         + `fill="#fff3e0" rx="2"/>`;
  }

  // Staff lines
  for (const ly of staffYs) {
    svg += `<line x1="0" x2="${totalWidth}" y1="${ly.toFixed(1)}" y2="${ly.toFixed(1)}" `
         + `stroke="#bbb" stroke-width="0.7"/>`;
  }

  // Ledger (helper) lines
  for (const h of rendHelpers) {
    svg += `<line x1="${(h.x).toFixed(1)}" x2="${(h.x + NOTE_W + 4).toFixed(1)}" `
         + `y1="${h.y.toFixed(1)}" y2="${h.y.toFixed(1)}" stroke="#bbb" stroke-width="0.7"/>`;
  }

  // Tie arcs
  for (const t of rendTies) {
    const cx1 = (t.x + t.width * 0.2).toFixed(1);
    const cx2 = (t.x + t.width * 0.8).toFixed(1);
    const cy  = (t.y - 5).toFixed(1);
    const ex  = (t.x + t.width).toFixed(1);
    svg += `<path d="M${t.x.toFixed(1)},${t.y.toFixed(1)} C${cx1},${cy} ${cx2},${cy} ${ex},${t.y.toFixed(1)}" `
         + `stroke="#555" stroke-width="1" fill="none"/>`;
  }

  // Note rectangles
  for (const n of rendNotes) {
    const fill = n.isMatch ? '#e65100' : '#212529';
    svg += `<rect x="${n.x.toFixed(1)}" y="${n.y.toFixed(1)}" `
         + `width="${NOTE_W}" height="${NOTE_H}" fill="${fill}" rx="1"/>`;
  }

  // Syllable text labels
  for (const l of rendLabels) {
    const fill = l.isMatch ? '#e65100' : '#555';
    const text = escapeXml(l.text || '·');
    svg += `<text x="${l.cx.toFixed(1)}" y="${TEXT_Y}" `
         + `text-anchor="middle" font-size="7.5" font-family="serif" fill="${fill}">${text}</text>`;
  }

  svg += '</svg>';
  return svg;
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

  // ── Quick search ──────────────────────────────────────────────────────────

  searchQuick() {
    if (!this.user || !this.quickText.trim()) return;
    this.quickSearching = true;
    this.quickSearched = false;
    this.addRecentSearch(this.quickText);
    const q = this.quickText.toLowerCase();

    forkJoin({
      sources: this.api.listSources(this.user.token),
      docs:    this.api.listDocuments(this.user.token),
      notes:   this.api.getAllDocumentNotes(this.user.token),
    }).subscribe(({ sources, docs, notes }) => {
      const results: QuickResult[] = [];
      const allNotes = notes as unknown as { [id: string]: VM.RootContainer };

      if (sources.kind === 'SourcesRetrieved') {
        for (const s of sources.sources) {
          const txt = Object.values(s).filter(v => typeof v === 'string').join(' ');
          if (txt.toLowerCase().includes(q)) {
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
          const metaTxt = Object.values(d).filter(v => typeof v === 'string').join(' ');
          const root    = allNotes[d.id];
          // Syllable text: joined raw ("Al-le-lu-ia") + dehyphenated ("Alleluia")
          const sylRaw  = root ? (() => {
            const syls = extractSyllables(root);
            return syls.map(s => s.text).join('');
          })() : '';
          const sylClean = sylRaw.replace(/-/g, '');

          const matchMeta = metaTxt.toLowerCase().includes(q);
          const matchSyl  = sylRaw.toLowerCase().includes(q) || sylClean.toLowerCase().includes(q);

          if (matchMeta || matchSyl) {
            // Build snippet from the source that matched
            let snippet: TextSnippet | undefined;
            if (matchSyl && !matchMeta) {
              // Prefer the clean form for display (it reads as full words)
              snippet = findTextSnippet(sylClean, q) ?? findTextSnippet(sylRaw, q);
            } else if (matchSyl) {
              snippet = findTextSnippet(sylClean, q) ?? findTextSnippet(sylRaw, q);
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
    const pattern = parsePattern(this.melodyPattern);

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

        const matchStart = findPatternStart(sequence, pattern);
        if (matchStart === -1) continue;

        // For contour, matchEnd is in notes-space: pattern of N gives N+1 notes
        const matchEndNote = this.melodySearchType === 'contour'
          ? matchStart + pattern.length      // N intervals → N+1 notes, last is matchStart+len
          : matchStart + pattern.length - 1;

        // Determine which syllables are "in the match"
        const matchSylSet = new Set<number>();
        for (let ni = matchStart; ni <= matchEndNote && ni < sylIdx.length; ni++) {
          matchSylSet.add(sylIdx[ni]);
        }

        // Context window: 3 syllables of padding before and after the match
        const matchSylMin = Math.min(...Array.from(matchSylSet));
        const matchSylMax = Math.max(...Array.from(matchSylSet));
        const ctxFirst = Math.max(0, matchSylMin - 3);
        const ctxLast  = Math.min(syllables.length - 1, matchSylMax + 3);

        const svgStr = buildMelodySvg(syllables, matchSylSet, ctxFirst, ctxLast);
        const svg    = this.sanitizer.bypassSecurityTrustHtml(svgStr);

        const source = allSources.find(s => s.id === doc.quelle_id);
        results.push({
          document:   doc,
          sourceSigle: source?.quellensigle ?? '',
          noteCount:  notes.length,
          svg,
        });
      }

      this.melodyResults  = results;
      this.melodySearched = true;
      this.melodySearching = false;
    });
  }

  get melodyPatternHint(): string {
    if (this.melodySearchType === 'pitch') {
      return this.melodyWithOctave
        ? 'e.g. C4 D4 E4 F4  (space-separated pitch + octave)'
        : 'e.g. C D E F G  (space-separated note names A–G)';
    }
    return 'e.g. u u d u r d  (u=up, d=down, r=repeat)';
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
