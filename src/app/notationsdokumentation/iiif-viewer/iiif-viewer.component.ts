import {
  Component, Input, Output, EventEmitter, OnChanges, SimpleChanges,
  ViewChild, ElementRef, NgZone, OnDestroy, OnInit
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Source } from '../../api.service';
import * as VM from '../../types/model';
import { v4 as UUID } from 'uuid';
import { NavigationService } from '../navigation.service';
import { AnalyzedPattern } from '../../transcription-analyzer.service';

const manifestCache = new Map<string, any>();

export interface GalleryItem {
  item: VM.AnnotationItem;
  region: VM.AnnotationRegion | undefined;
  canvasIdx: number;
  imageUrl: string;
  rect: { x: number; y: number; w: number; h: number };   // padded viewBox rect
  rawRect: { x: number; y: number; w: number; h: number }; // tight annotation rect
  linked: AnalyzedPattern | undefined;
}

@Component({
  selector: 'app-iiif-viewer',
  templateUrl: './iiif-viewer.component.html',
  styleUrls: ['./iiif-viewer.component.css']
})
export class IiifViewerComponent implements OnInit, OnChanges, OnDestroy {
  @Input() source: Source | null = null;
  @Input() documentPatterns: string[] = [];
  @Input() allPatterns: AnalyzedPattern[] = [];
  @Input() jumpToPattern = '';
  @Input() simpleMode = false;

  /** An array of folio strings (e.g. ['3r', '3v']) that exist within the current document. 
   *  Used in simpleMode to filter the canvas sidebar down to just the document's folios. */
  @Input() documentFolios: string[] = [];

  @Input() initialCanvasIndex?: number;
  @Input() activeRegionName?: string;
  /** UUID of the line-change that was last clicked in the transcription. The IIIF viewer
   *  navigates to the canvas containing the region linked to this UUID and highlights it. */
  @Input() highlightedLineUUID = '';
  @Output() sourceChanged = new EventEmitter<void>();
  @Output() regionClicked = new EventEmitter<{ name: string, folio: string, lineUUID?: string }>();
  /** Emitted when the user presses the "Link to line" button for a region.
   *  The document component should enter link-mode so the next line-change click links the line. */
  @Output() requestLineLink = new EventEmitter<{ regionId: string; regionName: string }>();

  private save() { this.sourceChanged.emit(); }

  // ViewChild via setter — attaches wheel listener the moment *ngIf renders the element
  private _viewportRef?: ElementRef<HTMLDivElement>;
  @ViewChild('viewportRef')
  set viewportRef(el: ElementRef<HTMLDivElement> | undefined) {
    if (this._viewportRef?.nativeElement)
      this._viewportRef.nativeElement.removeEventListener('wheel', this.wheelFn);
    this._viewportRef = el;
    if (el?.nativeElement)
      this.zone.runOutsideAngular(() =>
        el.nativeElement.addEventListener('wheel', this.wheelFn, { passive: false }));
  }
  get viewportRef(): ElementRef<HTMLDivElement> { return this._viewportRef!; }
  @ViewChild('contentRef') contentRef!: ElementRef<HTMLDivElement>;

  // ── manifest / canvas ─────────────────────────────────────────────────────
  manifest: any = null;
  canvases: any[] = [];
  currentCanvasIndex = 0;
  imageError = false;
  imageLoading = false;

  // ── zoom / pan ────────────────────────────────────────────────────────────
  scale = 1;
  leftSidebarCollapsed = false;
  translateX = 0;
  translateY = 0;
  private isPanning = false;
  private panStartX = 0;
  private panStartY = 0;
  private readonly wheelFn = (e: WheelEvent) => {
    e.preventDefault();
    this.zone.run(() => this.onWheel(e));
  };

  // ── box drawing ───────────────────────────────────────────────────────────
  isDraggingBox = false;
  dragStartPct: { x: number; y: number } | null = null;
  dragCurrentPct: { x: number; y: number } | null = null;

  // ── annotation mode ───────────────────────────────────────────────────────
  viewMode: 'regions' | 'items' = 'regions';
  activeRegion: VM.AnnotationRegion | null = null;

  // Pending region (drawn, waiting for a name)
  pendingRegionPoints: string | null = null;
  pendingRegionName = '';

  // Rename region
  renamingRegionId: string | null = null;
  renamingValue = '';

  // Item annotation
  activePattern = '';
  activeVariant = '';
  patternSearch = '';
  readonly VARIANTS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

  // Linker — null means closed; a string is the item ID being linked
  linkingItemId: string | null = null;
  linkCandidates: AnalyzedPattern[] = [];

  // Region↔Line linking
  /** ID of the region that is currently highlighted (driven by highlightedLineUUID input) */
  highlightedRegionId = '';
  /** ID of the region currently awaiting a line-link assignment (link mode) */
  linkModeRegionId: string | null = null;

  // Gallery
  showGallery = false;
  galleryFilterPattern = '';

  // Folio filter — setter snaps to first visible entry when toggled
  private _onlyDocumentFolios = true;
  get onlyDocumentFolios() { return this._onlyDocumentFolios; }
  set onlyDocumentFolios(v: boolean) {
    this._onlyDocumentFolios = v;
    // Snap to first visible canvas in the new filter state
    if (!this.userHasNavigated) this.selectFirstVisibleCanvas();
  }

  // True once the user explicitly clicks a canvas — prevents auto-snap from overriding
  private userHasNavigated = false;

  constructor(
    private http: HttpClient,
    private navService: NavigationService,
    private zone: NgZone
  ) {}

  ngOnInit(): void {
    // In simpleMode (document split-screen), keep the sidebar open so the user can navigate pages.
    // In full annotation mode (source view), start collapsed to give more space.
    this.leftSidebarCollapsed = false;
    this.navService.focusFolio$.subscribe(f => this.selectFolio(f));
  }

  ngOnChanges(c: SimpleChanges) {
    if (c['source'] && this.source?.iiifManifestUrl) {
      this.userHasNavigated = false;
      this.loadManifest(this.source.iiifManifestUrl);
    }
    // Patterns may arrive after the manifest — re-snap to first visible folio.
    // Skip in simpleMode: allPatterns is always [] there and we don't want to override the user's navigation.
    if (c['allPatterns'] && !this.simpleMode && this.canvases.length && !this.userHasNavigated) {
      this.selectFirstVisibleCanvas();
    }
    // Jump to gallery filtered to a pattern when requested from the notation overview
    if (c['jumpToPattern'] && this.jumpToPattern) {
      this.galleryFilterPattern = this.jumpToPattern;
      this.showGallery = true;
    }
    // Navigate to and highlight the region linked to the given line UUID
    if (c['highlightedLineUUID']) {
      if (this.highlightedLineUUID) {
        this.jumpToRegionByLineUUID(this.highlightedLineUUID);
      } else {
        this.highlightedRegionId = '';
      }
    }
    // Snap to folio index if passed programmatically (e.g. from document view line click)
    if (c['initialCanvasIndex'] && this.initialCanvasIndex !== undefined) {
      if (!this.userHasNavigated) {
        this.selectCanvas(this.initialCanvasIndex);
        this.userHasNavigated = false; // keep it false so it tracks programmatic changes
      }
    }
  }

  ngOnDestroy() {
    if (this._viewportRef?.nativeElement)
      this._viewportRef.nativeElement.removeEventListener('wheel', this.wheelFn);
  }

  // ── manifest ──────────────────────────────────────────────────────────────
  loadManifest(url: string) {
    if (manifestCache.has(url)) { this.manifest = manifestCache.get(url); this.parseCanvases(); return; }
    this.http.get<any>(url).subscribe(
      m => { manifestCache.set(url, m); this.manifest = m; this.parseCanvases(); },
      err => console.error('Failed to load IIIF manifest', err)
    );
  }

  parseCanvases() {
    if (this.manifest?.sequences?.length > 0) this.canvases = this.manifest.sequences[0].canvases || [];
    else if (this.manifest?.items) this.canvases = this.manifest.items;
    else this.canvases = [];
    this.imageError = false;
    
    if (this.initialCanvasIndex !== undefined && this.initialCanvasIndex >= 0 && this.initialCanvasIndex < this.canvases.length) {
      this.currentCanvasIndex = this.initialCanvasIndex;
      this.imageLoading = true;
    } else {
      this.selectFirstVisibleCanvas();
    }
    this.resetView();
    this.backToRegions();
  }

  /** Jump to the first canvas in the current filtered list, or 0 if none. */
  private selectFirstVisibleCanvas() {
    const first = this.visibleCanvases[0];
    const idx = first ? first.originalIndex : 0;
    if (this.currentCanvasIndex !== idx) {
      this.currentCanvasIndex = idx;
      this.imageError = false;
      this.imageLoading = this.canvases.length > 0;
    } else if (this.canvases.length > 0) {
      this.imageLoading = true;
    }
  }

  selectFolio(s: string) {
    if (!this.canvases.length) return;
    const clean = s.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const i = this.canvases.findIndex(c => c.label?.toLowerCase().replace(/[^a-zA-Z0-9]/g,'') === clean);
    if (i !== -1) { this.currentCanvasIndex = i; this.resetView(); }
  }

  selectCanvas(i: number) {
    this.userHasNavigated = true;
    if (this.currentCanvasIndex !== i) {
      this.currentCanvasIndex = i; 
      this.imageError = false; 
      this.imageLoading = true;
    }
    this.resetView(); 
    this.cancelBoxDraw(); 
    this.backToRegions();
  }

  get currentCanvasImage(): string | null { return this.canvasImageAt(this.currentCanvasIndex); }

  canvasImageAt(i: number): string | null {
    const c = this.canvases[i]; if (!c) return null;
    let url: string | null = null;
    if (c.images?.length > 0) url = c.images[0].resource?.['@id'] || c.images[0].resource?.id || null;
    else if (c.items?.length > 0) url = c.items[0]?.items?.[0]?.body?.id || null;
    return url ? url.replace(/\/native\.(jpg|png|webp)$/i, '/default.$1') : null;
  }

  onImageError() { this.imageLoading = false; this.imageError = true; }
  onImageLoad()  { this.imageLoading = false; this.imageError = false; }
  retryImage()   { this.imageError = false; this.imageLoading = true; }

  // ── zoom / pan ────────────────────────────────────────────────────────────
  private resetView() { this.scale = 1; this.translateX = 0; this.translateY = 0; }

  get contentTransform() { return `translate(${this.translateX}px,${this.translateY}px) scale(${this.scale})`; }

  onWheel(e: WheelEvent) {
    const vp = this._viewportRef?.nativeElement; if (!vp) return;
    const r = vp.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const old = this.scale;
    const next = Math.min(50, Math.max(0.1, old * (e.deltaY > 0 ? 0.9 : 1.1)));
    this.translateX = mx - (mx - this.translateX) * (next / old);
    this.translateY = my - (my - this.translateY) * (next / old);
    this.scale = next;
  }

  onMouseDown(e: MouseEvent) {
    if (e.button === 1 || (e.button === 0 && e.altKey)) { this.startPan(e); return; }
    if (e.button === 0) this.startBoxDraw(e);
  }
  onMouseMove(e: MouseEvent) {
    if (this.isPanning) { this.doPan(e); return; }
    if (this.isDraggingBox) this.updateBoxDraw(e);
  }
  onMouseUp(e: MouseEvent)    { if (this.isPanning) { this.endPan(); return; } if (this.isDraggingBox) this.finishBoxDraw(); }
  onMouseLeave(e: MouseEvent) { if (this.isPanning) this.endPan(); if (this.isDraggingBox) this.finishBoxDraw(); }

  private startPan(e: MouseEvent) {
    this.isPanning = true; this.panStartX = e.clientX - this.translateX; this.panStartY = e.clientY - this.translateY; e.preventDefault();
  }
  private doPan(e: MouseEvent) { this.translateX = e.clientX - this.panStartX; this.translateY = e.clientY - this.panStartY; }
  private endPan() { this.isPanning = false; }

  private zoomToRegion(region: VM.AnnotationRegion) {
    const vp = this._viewportRef?.nativeElement, ct = this.contentRef?.nativeElement;
    if (!vp || !ct) return;
    const rect = this.rectFromPoints(region.points);
    if (!rect || rect.w < 0.1 || rect.h < 0.1) return;
    const vpW = vp.clientWidth, vpH = vp.clientHeight;
    const imgW = ct.clientWidth, imgH = ct.clientHeight;
    const rW = rect.w / 100 * imgW, rH = rect.h / 100 * imgH;
    const rX = rect.x / 100 * imgW, rY = rect.y / 100 * imgH;
    const ns = Math.min(50, Math.max(0.1, Math.min(vpW * 0.88 / rW, vpH * 0.88 / rH)));
    this.scale = ns;
    this.translateX = vpW / 2 - (rX + rW / 2) * ns;
    this.translateY = vpH / 2 - (rY + rH / 2) * ns;
  }

  // ── box drawing ───────────────────────────────────────────────────────────
  private getPct(e: MouseEvent) {
    const el = this.contentRef?.nativeElement; if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(100, (e.clientX - r.left) / r.width * 100)),
      y: Math.max(0, Math.min(100, (e.clientY - r.top)  / r.height * 100))
    };
  }

  private startBoxDraw(e: MouseEvent) { const p = this.getPct(e); this.dragStartPct = p; this.dragCurrentPct = p; this.isDraggingBox = true; }
  private updateBoxDraw(e: MouseEvent) { this.dragCurrentPct = this.getPct(e); }

  private finishBoxDraw() {
    this.isDraggingBox = false;
    if (this.viewMode === 'regions') this.savePendingRegion();
    else this.saveItemAnnotation();
  }

  cancelBoxDraw() { this.isDraggingBox = false; this.dragStartPct = null; this.dragCurrentPct = null; }

  get currentBoxRect(): { x: number; y: number; w: number; h: number } | null {
    if (!this.dragStartPct || !this.dragCurrentPct) return null;
    return {
      x: Math.min(this.dragStartPct.x, this.dragCurrentPct.x),
      y: Math.min(this.dragStartPct.y, this.dragCurrentPct.y),
      w: Math.abs(this.dragCurrentPct.x - this.dragStartPct.x),
      h: Math.abs(this.dragCurrentPct.y - this.dragStartPct.y)
    };
  }

  private boxToPoints(r: { x: number; y: number; w: number; h: number }): string {
    const f = (v: number) => v.toFixed(2);
    return `${f(r.x)},${f(r.y)} ${f(r.x+r.w)},${f(r.y)} ${f(r.x+r.w)},${f(r.y+r.h)} ${f(r.x)},${f(r.y+r.h)}`;
  }

  rectFromPoints(pts: string): { x: number; y: number; w: number; h: number } | null {
    if (!pts) return null;
    let minX = 100, minY = 100, maxX = 0, maxY = 0;
    for (const p of pts.split(' ')) {
      if (!p.trim()) continue;
      const [x, y] = p.split(',').map(Number);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  /** SVG path that covers the full image MINUS the active region (for the dim overlay).
   *  Using fill-rule="evenodd", the inner rect cancels the outer one = transparent hole. */
  getDimPath(): string {
    if (!this.activeRegion) return '';
    const r = this.rectFromPoints(this.activeRegion.points);
    if (!r) return '';
    return `M 0,0 L 100,0 L 100,100 L 0,100 Z ` +
           `M ${r.x},${r.y} L ${r.x+r.w},${r.y} L ${r.x+r.w},${r.y+r.h} L ${r.x},${r.y+r.h} Z`;
  }

  // ── level 1: line regions ─────────────────────────────────────────────────
  private savePendingRegion() {
    const box = this.currentBoxRect; this.dragStartPct = null; this.dragCurrentPct = null;
    if (!box || box.w < 0.5 || box.h < 0.5) return;
    this.pendingRegionPoints = this.boxToPoints(box);
    this.pendingRegionName = this.suggestNextLineName();
  }

  private suggestNextLineName(): string {
    const nums = (this.source?.annotationRegions ?? [])
      .filter(r => r.folio === String(this.currentCanvasIndex))
      .map(r => { const m = r.name.match(/\d+/); return m ? +m[0] : 0; }).filter(n => n > 0);
    return `Line ${nums.length ? Math.max(...nums) + 1 : 1}`;
  }

  confirmRegion() {
    const name = this.pendingRegionName.trim();
    if (!name || !this.pendingRegionPoints || !this.source) return;
    if (!this.source.annotationRegions) this.source.annotationRegions = [];
    const r: VM.AnnotationRegion = { id: 'r_' + UUID(), name, points: this.pendingRegionPoints, folio: String(this.currentCanvasIndex) };
    this.source.annotationRegions.push(r);
    this.pendingRegionPoints = null; this.pendingRegionName = '';
    this.save();
    this.enterItemMode(r);
  }

  cancelPendingRegion() { this.pendingRegionPoints = null; this.pendingRegionName = ''; }

  enterItemMode(region: VM.AnnotationRegion) {
    if (this.simpleMode) {
      // Highlight the region locally as well
      this.highlightedRegionId = region.id;
      // Emit lineUUID so the document component can focus the linked line in the transcription
      this.regionClicked.emit({ name: region.name, folio: region.folio, lineUUID: region.lineUUID });
      return;
    }
    this.activeRegion = region; this.viewMode = 'items';
    this.cancelBoxDraw(); this.closeLinking();
    setTimeout(() => this.zoomToRegion(region), 60);
  }

  backToRegions() {
    this.viewMode = 'regions'; this.activeRegion = null;
    this.pendingRegionPoints = null; this.pendingRegionName = '';
    this.closeLinking(); this.cancelBoxDraw();
  }

  /** Find the region with lineUUID === uuid, navigate to its canvas, and highlight it. */
  jumpToRegionByLineUUID(uuid: string) {
    const region = (this.source?.annotationRegions ?? []).find(r => r.lineUUID === uuid);
    if (!region) { this.highlightedRegionId = ''; return; }
    const canvasIdx = parseInt(region.folio, 10);
    if (!isNaN(canvasIdx) && canvasIdx !== this.currentCanvasIndex) {
      this.currentCanvasIndex = canvasIdx;
      this.imageError = false;
      this.imageLoading = true;
      this.resetView();
    }
    this.highlightedRegionId = region.id;
    this.showGallery = false;
    if (this.viewMode !== 'regions') this.backToRegions();
  }

  /** Start link mode: the next line-UUID assignment from outside will link to this region. */
  startRegionLinkMode(region: VM.AnnotationRegion) {
    this.linkModeRegionId = region.id;
    this.requestLineLink.emit({ regionId: region.id, regionName: region.name });
  }

  /** Called by the document component when the user clicks a line-change while in link mode. */
  linkLineToRegion(lineUUID: string) {
    if (!this.linkModeRegionId || !this.source) { this.linkModeRegionId = null; return; }
    const region = (this.source.annotationRegions ?? []).find(r => r.id === this.linkModeRegionId);
    if (region) { region.lineUUID = lineUUID; this.save(); }
    this.linkModeRegionId = null;
  }

  clearRegionLink(region: VM.AnnotationRegion) {
    region.lineUUID = undefined;
    this.if_highlighted_clear(region.id);
    this.save();
  }

  private if_highlighted_clear(regionId: string) {
    if (this.highlightedRegionId === regionId) this.highlightedRegionId = '';
  }

  startRename(region: VM.AnnotationRegion) {
    this.renamingRegionId = region.id;
    this.renamingValue = region.name;
  }

  confirmRename() {
    const name = this.renamingValue.trim();
    if (!name || !this.source) return;
    const r = (this.source.annotationRegions ?? []).find(x => x.id === this.renamingRegionId);
    if (r) { r.name = name; this.save(); }
    this.renamingRegionId = null; this.renamingValue = '';
  }

  cancelRename() { this.renamingRegionId = null; this.renamingValue = ''; }

  deleteRegion(id: string) {
    if (!this.source) return;
    this.source.annotationRegions = (this.source.annotationRegions ?? []).filter(r => r.id !== id);
    this.source.annotationItems   = (this.source.annotationItems   ?? []).filter(i => i.regionId !== id);
    this.save();
    if (this.activeRegion?.id === id) this.backToRegions();
  }

  onDeleteRegionChip(e: MouseEvent, id: string) { e.stopPropagation(); this.deleteRegion(id); }

  regionItemCount(id: string) { return (this.source?.annotationItems ?? []).filter(i => i.regionId === id).length; }

  get currentRegions(): VM.AnnotationRegion[] {
    return (this.source?.annotationRegions ?? []).filter(r => r.folio === String(this.currentCanvasIndex));
  }

  get currentCanvasItems(): VM.AnnotationItem[] {
    const regionIds = new Set(this.currentRegions.map(r => r.id));
    return (this.source?.annotationItems ?? []).filter(i => regionIds.has(i.regionId));
  }

  /**
   * Normalize a folio string to a canonical form for comparison.
   * Handles:
   *   "fol. 1r", "f. 1r", "Bl. 1r", "folio 1r" → "1r"
   *   "1 recto", "1 Recto"                       → "1r"
   *   "1 verso",  "1v"                            → "1v"
   *   "1" (no suffix)                             → "1" (matches both "1" and "1r")
   */
  private normalizeFolio(raw: string): string {
    return String(raw)
      .toLowerCase()
      .replace(/\b(fol|folio|bl|blatt|page|pg|leaf)\b\.?\s*/g, '')  // strip common prefixes
      .replace(/\brecto\b/g, 'r')
      .replace(/\bverso\b/g, 'v')
      .replace(/[^a-z0-9]/g, '');  // remove remaining spaces / punctuation
  }

  /** True when two folio strings refer to the same leaf side.
   *  A bare number (no r/v) is treated as recto ("1" ~ "1r"). */
  private folioMatches(a: string, b: string): boolean {
    const na = this.normalizeFolio(a);
    const nb = this.normalizeFolio(b);
    if (na === nb) return true;
    // bare number ↔ explicit recto: "1" ~ "1r"
    if (/^\d+$/.test(na) && na + 'r' === nb) return true;
    if (/^\d+$/.test(nb) && nb + 'r' === na) return true;
    return false;
  }

  /** Set of canvas indices that have at least one document folio match */
  get documentCanvasIndices(): Set<number> {
    // Collect target folios either from pattern occurrences (global view) or explicit documentFolios (simpleMode)
    let targetFolios: string[] = [];
    if (this.documentFolios && this.documentFolios.length > 0) {
      targetFolios = this.documentFolios;
    } else {
      targetFolios = this.allPatterns.map(p => String(p.folio));
    }
    
    const s = new Set<number>();
    this.canvases.forEach((c, i) => {
      const label = String(c.label || '');
      if (targetFolios.some(f => this.folioMatches(f, label))) {
        s.add(i);
        // In simpleMode, text before a Folio marker belongs to the previous canvas.
        if (this.simpleMode && i > 0) s.add(i - 1);
      }
    });
    return s;
  }

  /** Canvases list, optionally filtered to document folios */
  get visibleCanvases(): { canvas: any; originalIndex: number }[] {
    const dci = this.documentCanvasIndices;
    return this.canvases
      .map((canvas, i) => ({ canvas, originalIndex: i }))
      .filter(entry => !this.onlyDocumentFolios || dci.size === 0 || dci.has(entry.originalIndex));
  }

  trackByOriginalIndex(index: number, entry: { canvas: any; originalIndex: number }): number {
    return entry.originalIndex;
  }

  // ── level 2: item annotation ──────────────────────────────────────────────
  private saveItemAnnotation() {
    const box = this.currentBoxRect; this.dragStartPct = null; this.dragCurrentPct = null;
    if (!box || box.w < 0.5 || box.h < 0.5 || !this.activePattern || !this.source || !this.activeRegion) return;
    if (!this.source.annotationItems) this.source.annotationItems = [];
    const newItem: VM.AnnotationItem = {
      id: 'item_' + UUID(),
      regionId: this.activeRegion.id,
      pattern: this.activePattern,
      variant: this.activeVariant || undefined,
      points: this.boxToPoints(box)
    };
    this.source.annotationItems.push(newItem);
    this.save();
    // Auto-open linker if there are candidates on this page
    this.openLinking(newItem.id);
  }

  openLinking(itemId: string) {
    this.linkingItemId = itemId;
    const item = (this.source?.annotationItems ?? []).find(i => i.id === itemId);
    if (!item) return;
    // Show ALL occurrences of this pattern across the whole source,
    // sorted by folio then line — let the user pick the right one.
    this.linkCandidates = this.allPatterns
      .filter(p => p.patternId === item.pattern)
      .sort((a, b) => a.folio.localeCompare(b.folio) || String(a.line).localeCompare(String(b.line)));
    if (this.linkCandidates.length === 0) this.linkingItemId = null;
  }

  doLink(cand: AnalyzedPattern) {
    const item = (this.source?.annotationItems ?? []).find(i => i.id === this.linkingItemId);
    if (item) { item.uuid = cand.uuid; this.save(); }
    this.closeLinking();
  }

  clearLink(itemId: string) {
    const item = (this.source?.annotationItems ?? []).find(i => i.id === itemId);
    if (item) { item.uuid = undefined; this.save(); }
  }

  closeLinking() { this.linkingItemId = null; this.linkCandidates = []; }

  deleteItem(id: string) {
    if (!this.source) return;
    this.source.annotationItems = (this.source.annotationItems ?? []).filter(i => i.id !== id);
    if (this.linkingItemId === id) this.closeLinking();
    this.save();
  }

  itemDisplayId(item: VM.AnnotationItem): string { return item.variant ? `${item.pattern} ${item.variant}` : item.pattern; }

  linkingItemDisplayId(): string {
    if (!this.linkingItemId || !this.source?.annotationItems) return '';
    const item = this.source.annotationItems.find(i => i.id === this.linkingItemId);
    return item ? this.itemDisplayId(item) : '';
  }

  getItemById(id: string): VM.AnnotationItem | undefined {
    return (this.source?.annotationItems ?? []).find(i => i.id === id);
  }

  get activeRegionItems(): VM.AnnotationItem[] {
    if (!this.activeRegion) return [];
    return (this.source?.annotationItems ?? []).filter(i => i.regionId === this.activeRegion!.id);
  }

  // ── pattern picker ────────────────────────────────────────────────────────
  get filteredPatterns(): string[] {
    const base = this.documentPatterns.length > 0
      ? this.documentPatterns
      : Array.from(new Set((this.source?.annotationItems ?? []).map(i => i.pattern)));
    const q = this.patternSearch.toLowerCase().trim();
    return q ? base.filter(p => p.toLowerCase().includes(q)) : base;
  }

  setVariant(v: string) { this.activeVariant = this.activeVariant === v ? '' : v; }

  // ── gallery ───────────────────────────────────────────────────────────────

  /** Expand a rect with padding (0–1 factor), clamped to 0–100 */
  private paddedRect(r: { x: number; y: number; w: number; h: number }, pad = 0.35) {
    const px = Math.max(r.w * pad, 1.5);
    const py = Math.max(r.h * pad, 1.5);
    const x = Math.max(0, r.x - px);
    const y = Math.max(0, r.y - py);
    const w = Math.min(100 - x, r.w + px * 2);
    const h = Math.min(100 - y, r.h + py * 2);
    return { x, y, w, h };
  }

  get galleryItems(): GalleryItem[] {
    if (!this.source) return [];
    const regions = this.source.annotationRegions ?? [];
    const uuidMap = new Map(this.allPatterns.map(p => [p.uuid, p]));
    return (this.source.annotationItems ?? [])
      .filter(item => !this.galleryFilterPattern ||
        item.pattern.toLowerCase().includes(this.galleryFilterPattern.toLowerCase()))
      .map(item => {
        const region = regions.find(r => r.id === item.regionId);
        const canvasIdx = parseInt(region?.folio ?? '0', 10);
        const imageUrl = this.canvasImageAt(canvasIdx);
        const raw = this.rectFromPoints(item.points) ?? { x: 0, y: 0, w: 10, h: 10 };
        const rect = this.paddedRect(raw);
        return { item, region, canvasIdx, imageUrl: imageUrl!, rect,
                 rawRect: raw,
                 linked: item.uuid ? uuidMap.get(item.uuid) : undefined };
      }).filter(g => !!g.imageUrl);
  }

  navigateToItem(g: GalleryItem) {
    this.showGallery = false;
    this.selectCanvas(g.canvasIdx);
    if (g.region) setTimeout(() => this.enterItemMode(g.region!), 80);
  }
}
