import { ViewChild, ElementRef, Component, OnInit, HostListener } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { Location } from '@angular/common';
import { UserService, User } from '../user.service';
import { APIService, Document, ProjectSettings, Source } from '../api.service';
import { assertNever } from '../../utils';
import { ToolsService } from '../tools.service';
import { ToastrService } from 'ngx-toastr';
import { Subscription, combineLatest } from 'rxjs';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { parsers } from '../types/parser';
import * as VM from '../types/model';
import * as S from '../sselect/sselect.component';
import { UndoService } from '../undoService';
import { CommentComponent } from '../comment/comment.component';
import { DragStateService } from '../dragger/drag-state.service';
import { NavigationService } from '../notationsdokumentation/navigation.service';
import { PageTitleService } from '../page-title.service';
import { extractFolioFromString, extractDocumentFolios } from '../transcription-analyzer-core';

import { jsPDF } from 'jspdf';
import 'svg2pdf.js';
import autoTable from 'jspdf-autotable';

@Component({
  selector: 'app-document',
  templateUrl: './document.component.html',
  styleUrls: ['./document.component.css']
})
export class DocumentComponent implements OnInit {
  @ViewChild('textImport', { static: true }) textImportModal!: ElementRef;
  @ViewChild('globalComment', { static: true }) globalCommentModal!: ElementRef;
  subs: Subscription[] = [];
  document: Document | undefined = undefined;
  user: User | null = null;
  private _cont: VM.RootContainer | undefined;
  get cont(): VM.RootContainer | undefined { return this._cont; }
  set cont(v: VM.RootContainer | undefined) { this._cont = v; if (v) this.dragState.setRootData(v); }
  readOnly: boolean = false;
  collapseMetadata: boolean = true;
  sourceSigle: string | undefined;
  documentJsonClone: string | undefined = undefined;
  contJsonClone: string | undefined = undefined;
  textImportErrors: Array<string> = [];
  settings: ProjectSettings | null = null;
  sourceData: Source | null = null;
  viewMode: 'transcription' | 'split' | 'iiif' = 'transcription';
  get splitScreen(): boolean { return this.viewMode === 'split'; }
  splitLeftWidth = 45;
  isDraggingSplitter = false;
  isSaving = false;
  /** True if a save was requested while an HTTP request was already ongoing */
  private savePending = false;
  sidebarTab: 'metadata' | 'comments' = 'metadata';
  sidebarVisible = true;

  // ── IIIF split-screen two-way connection ──────────────────────────────────
  /** UUID of the line-change last clicked; passed to IIIF viewer to highlight the linked region. */
  highlightedLineUUID = '';
  /** When true the user just clicked a region's "Link" button — next line-change click links them. */
  isLinkingMode = false;
  linkModeRegionId = '';
  linkModeRegionName = '';
  
  /** Dynamic folio index to pass to IIIF viewer to snap to the correct page */
  currentFolioIndex: number | undefined;

  /** Folios present in the current document (extracted during line mapping) */
  documentFolios: string[] = [];

  /** Name of the region corresponding to the active line. */
  activeLineName?: string;
  /** Maps LineChange UUID to { folio, lineName } */
  lineMap: Map<string, { folio: string, lineName: string }> = new Map();
  /** Maps `${folio}_${lineName}` to LineChange UUID */
  regionToLineMap: Map<string, string> = new Map();

  /** Stable empty array — never pass `[]` literals as @Input to avoid a new reference every CD cycle. */
  readonly emptyArray: any[] = [];

  showPdfExportDialog = false;
  printIncludeMetadata = true;
  isPrinting = false;

  importText: string = '';
  importType: keyof typeof parsers = "Misc";
  importTypes = Object.keys(parsers);

  constructor(
    private api: APIService,
    private router: Router,
    private userService: UserService,
    private undoService: UndoService,
    private route: ActivatedRoute,
    private toastr: ToastrService,
    private modalService: NgbModal,
    private location: Location,
    private toolService: ToolsService,
    private dragState: DragStateService,
    private navService: NavigationService,
    private pageTitle: PageTitleService) {
  }

  test() {
    this.undoService.undo();
  }

  toggleReadOnly() {
    this.readOnly = !this.readOnly;
  }

  setViewMode(mode: 'transcription' | 'split' | 'iiif', updateRoute = true) {
    this.viewMode = mode;
    if (mode === 'split' || mode === 'iiif') {
      this.sidebarVisible = false;
      this.buildLineMap();
    }
    // Reset link state when changing views
    this.activeLineName = undefined;
    this.isLinkingMode = false;
    this.highlightedLineUUID = '';
    this.updateToolbar();

    if (updateRoute) {
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { view: mode },
        queryParamsHandling: 'merge'
      });
    }
  }

  /** Receives events bubbled up from app-root-section (via the Section base class onEvent output). */
  handleRootEvent(e: any): void {
    if (e.kind === 'HighlightRegionRequested') {
      if (this.isLinkingMode && this.linkModeRegionId && this.sourceData) {
        // Link mode: bind the clicked line UUID to the pending region
        const region = (this.sourceData.annotationRegions ?? []).find(r => r.id === this.linkModeRegionId);
        if (region) {
          region.lineUUID = e.uuid;
          this.saveSourceData();
          this.toastr.success(`"${this.linkModeRegionName}" linked to the selected line`);
        }
        this.isLinkingMode = false;
        this.linkModeRegionId = '';
        this.linkModeRegionName = '';
        // Also highlight the newly-linked region
        this.highlightedLineUUID = e.uuid;
      } else {
        // Normal mode: highlight the region linked to this line UUID
        this.highlightedLineUUID = e.uuid;
        
        // Implicit mapping: if the explicit UUID mapping in iiif-viewer fails, we provide activeLineName as fallback
        this.buildLineMap(); // Ensure map is up-to-date
        const mapped = this.lineMap.get(e.uuid);
        if (mapped) {
          this.activeLineName = mapped.lineName;
          
          if (mapped.folio !== undefined && !isNaN(parseInt(mapped.folio, 10))) {
            this.currentFolioIndex = parseInt(mapped.folio, 10);
          }
          
          // Optional: we can force the IIIF viewer to navigate to the folio if needed
          if (this.sourceData && this.sourceData.id) {
            // this.navService.openIiifViewerForFolio(this.sourceData.id, mapped.folio);
          }
        } else {
          this.activeLineName = undefined;
        }
      }
    }
  }

  /** Called right before a change in the IIIF viewer happens, to register an undo state */
  handleIiifBeforeChange(): void {
    this.undoService.beforeChange('IIIF Annotation Change');
  }

  /** Called when the IIIF viewer emits requestLineLink — user clicked "Link" on a region. */
  handleIiifRequestLineLink(data: { regionId: string; regionName: string }): void {
    this.isLinkingMode = true;
    this.linkModeRegionId = data.regionId;
    this.linkModeRegionName = data.regionName;
    this.toastr.info(`Now click a line-change in the transcription to link it to "${data.regionName}"`, '', { timeOut: 8000 });
  }

  /** Builds a map of line-changes to their implicit region names based on DOM order. */
  private buildLineMap(): void {
    this.lineMap.clear();
    this.regionToLineMap.clear();
    if (!this.cont) return;

    let currentFolio = this.document?.foliostart || "1";
    let currentLine = 1;

    const traverse = (node: any) => {
      if (!node || !node.kind) return;

      const oldFolio = currentFolio;

      if (node.kind === VM.LinePartKind.FolioChange) {
        currentFolio = node.text || currentFolio;
      } else if (node.kind === VM.ContainerKind.ParatextContainer) {
        if (node.text && node.text.includes('|')) {
          currentLine += (node.text.match(/\|/g) || []).length;
        }
        const extracted = extractFolioFromString(node.text || '');
        if (extracted) {
          currentFolio = extracted;
        }
      }

      if (node.kind === VM.LinePartKind.FolioChange || currentFolio !== oldFolio) {
        currentLine = 1;
      }

      if (node.kind === VM.LinePartKind.LineChange) {
        const lineName = currentLine.toString();
        this.lineMap.set(node.uuid, { folio: currentFolio, lineName });
        this.regionToLineMap.set(`${currentFolio}_${lineName}`, node.uuid);
        currentLine++;
      }

      if (node.children && Array.isArray(node.children)) {
        for (const child of node.children) {
          traverse(child);
        }
      }
      if (node.parts && Array.isArray(node.parts)) {
        for (const part of node.parts) {
          traverse(part);
        }
      }
    };

    traverse(this.cont);
    this.documentFolios = extractDocumentFolios(this.cont, this.document?.foliostart);
  }

  /** Called when the user clicks a region in the IIIF viewer (simpleMode).
   *  If the region has a lineUUID, try to scroll to that line in the DOM. */
  handleIiifRegionClicked(data: { name: string, folio: string, lineUUID?: string }): void {
    let targetUUID = data.lineUUID;

    // Implicit fallback: if not explicitly linked, try to map from region name
    if (!targetUUID) {
      this.buildLineMap();
      targetUUID = this.regionToLineMap.get(`${data.folio}_${data.name}`);
    }

    if (targetUUID) {
      // Try to scroll the transcription to the element with that UUID
      const el = document.querySelector(`[data-uuid="${targetUUID}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Optionally flash the element
        (el as HTMLElement).style.transition = 'background-color 0.5s';
        (el as HTMLElement).style.backgroundColor = '#fff3cd';
        setTimeout(() => (el as HTMLElement).style.backgroundColor = '', 1500);
      }
    }
  }

  get initialFolioIndex(): number | undefined {
    if (this.document && this.document.foliostart) {
      const idx = parseInt(this.document.foliostart, 10);
      return isNaN(idx) ? undefined : idx;
    }
    return undefined;
  }

  saveSourceData() {
    if (this.user && this.sourceData) {
      this.api.updateSource(this.user.token, this.sourceData).subscribe(res => {
        if (res.kind === 'Ok') {
          // this.toastr.success('Source annotations saved successfully');
        } else {
          this.toastr.error('Failed to save source annotations');
        }
      });
    }
  }

  @HostListener('window:mousemove', ['$event'])
  onMouseMove(event: MouseEvent) {
    if (!this.isDraggingSplitter) return;
    const container = document.getElementById('split-screen-container');
    if (container) {
      const rect = container.getBoundingClientRect();
      let newWidth = ((event.clientX - rect.left) / rect.width) * 100;
      if (newWidth < 20) newWidth = 20;
      if (newWidth > 80) newWidth = 80;
      this.splitLeftWidth = newWidth;
      // Prevent text selection while dragging
      event.preventDefault();
    }
  }

  @HostListener('window:mouseup')
  onMouseUp() {
    if (this.isDraggingSplitter) {
      this.isDraggingSplitter = false;
      document.body.style.cursor = 'default';
    }
  }

  startSplitDrag(event: MouseEvent) {
    this.isDraggingSplitter = true;
    document.body.style.cursor = 'col-resize';
    event.preventDefault();
  }

  openPdfExport() {
    this.showPdfExportDialog = true;
  }

  getMetadataFieldLabel(key: string): string {
    if (key === 'dokumenten_id') return 'ID';
    if (key === 'textinitium') return 'Initium';
    if (key === 'gattung1') return 'Genre 1';
    if (key === 'gattung2') return 'Genre 2';
    if (key === 'festtag') return 'Feast Day';
    if (key === 'feier') return 'Feast';
    const custom = this.settings?.customDocumentFields?.find(f => f.key === key);
    return custom ? custom.label : key;
  }

  getMetadataFieldValue(key: string): string {
    if (!this.document) return '';
    if (key === 'dokumenten_id') return this.document.dokumenten_id || '';
    if (key === 'textinitium') return this.document.textinitium || '';
    if (key === 'gattung1') return this.document.gattung1 || '';
    if (key === 'gattung2') return this.document.gattung2 || '';
    if (key === 'festtag') return this.document.festtag || '';
    if (key === 'feier') return this.document.feier || '';
    return this.document.custom?.[key] || '';
  }

  buildHeadlineText(fields: string[]): string {
    if (!fields || fields.length === 0) return '';
    const parts: string[] = [];
    for (const f of fields) {
      const val = this.getMetadataFieldValue(f);
      if (val) {
        if (f === 'dokumenten_id') {
          parts.push(val);
        } else {
          const label = this.getMetadataFieldLabel(f);
          parts.push(`${label}: ${val}`);
        }
      }
    }
    return parts.join('   •   ');
  }

  get currentLevelNames(): any {
    if (!this.settings || !this.settings.genreLevelProfiles || !this.document) return null;
    const g1 = this.document.gattung1 || '';
    const g2 = this.document.gattung2 || '';
    let profile = this.settings.genreLevelProfiles.find((p: any) => p.gattung1 === g1 && p.gattung2 === g2);
    if (!profile) profile = this.settings.genreLevelProfiles.find((p: any) => p.gattung1 === g1 && (!p.gattung2 || p.gattung2 === '*'));
    if (!profile) profile = this.settings.genreLevelProfiles.find((p: any) => (!p.gattung1 || p.gattung1 === '*') && (!p.gattung2 || p.gattung2 === '*'));
    return profile ? profile.names : null;
  }

  async confirmPdfExport() {
    this.showPdfExportDialog = false;
    this.isPrinting = true;
    
    // Force readOnly to render clean text without boxes
    const originalReadOnly = this.readOnly;
    this.readOnly = true;

    // Wait for Angular to re-render the DOM
    setTimeout(async () => {
      try {
        const doc = new jsPDF({ unit: 'pt', format: 'a4' });
        const fontFamily = this.settings?.pdfFontFamily || 'times';
        const pdfMarginLeft = this.settings?.pdfMarginLeft ?? 40;
        const pdfMarginRight = this.settings?.pdfMarginRight ?? 40;
        const pdfMarginTop = this.settings?.pdfMarginTop ?? 40;
        const pdfMarginBottom = this.settings?.pdfMarginBottom ?? 40;
        const pdfStaffSpacing = this.settings?.pdfStaffSpacing ?? 20;
        const pdfBracketGap = this.settings?.pdfBracketGap ?? 5;
        const pdfBracketTick = this.settings?.pdfBracketTick ?? 4;
        const pdfSyllableTextOffset = this.settings?.pdfSyllableTextOffset ?? 10;
        const pdfTextBlockGap = this.settings?.pdfTextBlockGap ?? 10;

        let cursorY = pdfMarginTop;
        const pageHeight = 842;
        const pageWidth = 595;
        const printWidth = pageWidth - pdfMarginLeft - pdfMarginRight;
        const maxContentY = pageHeight - pdfMarginBottom;

        const checkPageOverflow = (neededHeight: number) => {
          if (cursorY + neededHeight > maxContentY) {
            doc.addPage();
            cursorY = pdfMarginTop;
          }
        };

        // Title
        const titleFontSize = this.settings?.pdfTitleFontSize ?? 16;
        doc.setFontSize(titleFontSize);
        doc.setFont(fontFamily, "bold");
        const headerSource = this.settings?.pdfHeaderSource || 'textinitium';
        const headerText = this.getMetadataFieldValue(headerSource) || (this.document?.textinitium || "New Document");
        doc.text(headerText, pdfMarginLeft, cursorY);
        cursorY += (this.settings?.pdfTitleVerticalSpace ?? 20);
        checkPageOverflow(0);

        // Metadata inline, styled & dense
        if (this.printIncludeMetadata && this.document) {
          const metaFontSize = this.settings?.pdfMetadataFontSize ?? 9;
          doc.setFontSize(metaFontSize);
          
          const items = this.getInlineMetadataItems();
          let curX = pdfMarginLeft;
          let curY = cursorY;
          const bullet = "   •   ";
          
          for (let k = 0; k < items.length; k++) {
            const item = items[k];
            const labelText = item.label + ": ";
            const valText = item.val + (k < items.length - 1 ? bullet : "");
            
            doc.setFont(fontFamily, "bold");
            const labelWidth = doc.getTextWidth(labelText);
            doc.setFont(fontFamily, "normal");
            const valWidth = doc.getTextWidth(valText);
            
            if (curX + labelWidth + valWidth > pageWidth - pdfMarginRight) {
              curX = pdfMarginLeft;
              curY += metaFontSize * 1.4;
              checkPageOverflow(metaFontSize * 1.4);
            }
            
            doc.setFont(fontFamily, "bold");
            doc.text(labelText, curX, curY);
            curX += labelWidth;
            
            doc.setFont(fontFamily, "normal");
            doc.text(valText, curX, curY);
            curX += valWidth;
          }
          
          cursorY = curY + (this.settings?.pdfMetadataVerticalSpace ?? 15);
          checkPageOverflow(0);
        }

        // DOM Traversal for Structural Layout
        doc.setFontSize(12);
        
        const drawActiveBracket = (startX: number, endX: number, bY: number, label: string) => {
           doc.setLineWidth(this.settings?.pdfBracketThickness ?? 1.2);
           doc.setDrawColor(0, 0, 0);
           doc.line(startX, bY - pdfBracketTick, startX, bY);
           doc.line(startX, bY, endX, bY);
           doc.line(endX, bY - pdfBracketTick, endX, bY);
           
           if (label) {
               const cleanLabel = label.replace(/^\[|\]$/g, '');
               doc.setFontSize(this.settings?.pdfCommentTitleFontSize ?? 8);
               doc.setFont(fontFamily, "italic");
               const txtX = startX + (endX - startX) / 2 - (doc.getTextWidth(cleanLabel) / 2);
               doc.text(cleanLabel, txtX, bY + pdfBracketTick + 4);
           }
        };
        
        // Grab all app-containers in document order, only from the main document area
        const containers = document.querySelectorAll('app-root-section .app-container');
        
        // Track active comments for drawing brackets
        const activeBrackets: { [key: string]: { startX: number, startLineY: number, label: string } } = {};
        const documentComments = this.cont?.comments || [];
        
        // Build a map of Syllable/LinePart UUID to all its nested commentable UUIDs (including notes)
        const uuidMap: { [key: string]: string[] } = {};
        if (this.cont) {
            const allLineParts = VM.getAllLineParts(this.cont);
            for (const lp of allLineParts) {
                uuidMap[lp.uuid] = VM.getCommentableUUIDsOfLinePart(lp);
            }
        }
        
        // Track the current Signatures to print before the next Zeile
        let currentSignatures: string[] = [];
        let wasLastElementParatext = false;
        
        for (let i = 0; i < containers.length; i++) {
          const container = containers[i] as HTMLElement;
          
          // Calculate indentation based on left padding/margin of parent .child elements
          let paddingLeft = 0;
          let currentElement: HTMLElement | null = container;
          while (currentElement) {
              if (currentElement.classList && currentElement.classList.contains('child')) {
                  paddingLeft += 20;
              }
              currentElement = currentElement.parentElement;
          }
          
          // structural text xOffset
          const xOffset = pdfMarginLeft + paddingLeft;

          // Only look inside the immediate content-row, not inside nested .children
          const firstDiv = container.children[0];
          if (!firstDiv) continue;
          
          const contentRow = firstDiv.querySelector('.content-row') as HTMLElement;
          if (!contentRow) continue;
          
          // 1. Check for Signatur
          const formteilDivs = contentRow.querySelectorAll('.formteil-line > div');
          for (let k = 0; k < formteilDivs.length; k++) {
             const fDiv = formteilDivs[k] as HTMLElement;
             if (fDiv.innerText && fDiv.innerText.indexOf("Signatur") !== -1) {
                 const input = fDiv.querySelector('input');
                 if (input && input.value.trim()) {
                     currentSignatures.push(input.value.trim());
                 }
             }
          }

          // Add vertical space ONLY if this is a FormteilContainer (level section)
          if (contentRow.classList.contains('formteil-section')) {
            if (!wasLastElementParatext) {
              const pdfVerticalSpace = this.settings?.pdfVerticalSpace ?? 15;
              checkPageOverflow(pdfVerticalSpace);
              cursorY += pdfVerticalSpace;
            }
            wasLastElementParatext = false;
          }
          
          // Check if this row is a Zeile (contains musical notes)
          const parts = contentRow.querySelectorAll('app-notes, app-line-change, app-folio-change');
          
          if (parts.length > 0) {
            wasLastElementParatext = false;
            // Horizontal layout for notes and breaks
            const SCALE = this.settings?.pdfScale ?? 0.40;
            const extraSyllableSpacing = this.settings?.pdfSyllableSpacing ?? 10;
            const pdfFontSize = this.settings?.pdfFontSize ?? 10;
            const pdfSignaturSpace = this.settings?.pdfSignaturSpace ?? 60;
            
            const musicStartX = pdfMarginLeft + pdfSignaturSpace;
            
            let lineStartY = cursorY;
            let cursorX = musicStartX;
            let lineMaxHeight = 0;
            let lineHasLyrics = false;
            let lineHasBrackets = Object.keys(activeBrackets).length > 0;
            
            for (let j = 0; j < parts.length; j++) {
              const part = parts[j] as HTMLElement;
              const tagName = part.tagName.toLowerCase();
              
              if (tagName === 'app-line-change' || tagName === 'app-folio-change') {
                // Wrap on editorial break
                const bracketY = lineStartY + lineMaxHeight + (lineHasLyrics ? (pdfSyllableTextOffset + pdfFontSize + pdfBracketGap) : pdfBracketGap);
                for (const key in activeBrackets) {
                    const b = activeBrackets[key];
                    drawActiveBracket(b.startX, cursorX, bracketY, b.label);
                }
                
                let lineBottomY = lineStartY + lineMaxHeight;
                if (lineHasBrackets) {
                    lineBottomY = bracketY + pdfBracketTick + 8;
                } else if (lineHasLyrics) {
                    lineBottomY = lineStartY + lineMaxHeight + pdfSyllableTextOffset + pdfFontSize;
                }
                
                cursorY = lineBottomY + pdfStaffSpacing;
                checkPageOverflow(40); // check overflow for staff line height of at least 40pt
                
                lineStartY = cursorY;
                cursorX = musicStartX;
                lineMaxHeight = 0;
                lineHasLyrics = false;
                lineHasBrackets = Object.keys(activeBrackets).length > 0;
                
                for (const key in activeBrackets) {
                    const b = activeBrackets[key];
                    b.startX = musicStartX;
                    b.startLineY = lineStartY;
                }
                continue;
              }
              
              const sec = part.querySelector('.section') as HTMLElement;
              if (!sec) continue;
              
              const svg = sec.querySelector('svg');
              const textEl = sec.querySelector('.syllableText:not(.dnone)') as HTMLElement;
              
              const rawWidth = svg ? parseFloat(svg.getAttribute('width') || '50') : 50;
              const rawHeight = svg ? (svg.getBoundingClientRect().height || 80) : 80;
              
              const svgWidth = rawWidth * SCALE;
              const secHeight = rawHeight * SCALE;
              
              let txt = "";
              let textWidth = 0;
              if (textEl) {
                txt = textEl.innerText.trim();
                if (txt && txt !== "X" && txt !== "..." && txt !== "<...>") {
                  doc.setFontSize(pdfFontSize);
                  doc.setFont(fontFamily, "normal");
                  textWidth = doc.getTextWidth(txt);
                  lineHasLyrics = true;
                } else {
                  txt = "";
                }
              }

              // Calculate final section width
              let finalSecWidth = Math.max(svgWidth, textWidth + extraSyllableSpacing);
              
              // Detect if this syllable is the last one on the current visual line,
              // so we can extend staff lines to fill up to the right margin.
              let isLastOnLine = (j === parts.length - 1);
              if (!isLastOnLine && j + 1 < parts.length) {
                const nextPart = parts[j + 1] as HTMLElement;
                const nextTag = nextPart.tagName.toLowerCase();
                if (nextTag === 'app-line-change' || nextTag === 'app-folio-change') {
                  isLastOnLine = true;
                } else if (nextTag === 'app-notes') {
                  // Peek at the next syllable's width to see if it would trigger a wrap
                  const nextSec = nextPart.querySelector('.section') as HTMLElement;
                  if (nextSec) {
                    const nextSvgEl = nextSec.querySelector('svg');
                    const nextRawW = nextSvgEl ? parseFloat(nextSvgEl.getAttribute('width') || '50') : 50;
                    const nextSvgW = nextRawW * SCALE;
                    const nextTextEl = nextSec.querySelector('.syllableText:not(.dnone)') as HTMLElement;
                    let nextTxtW = 0;
                    if (nextTextEl) {
                      const nt = nextTextEl.innerText.trim();
                      if (nt && nt !== 'X' && nt !== '...' && nt !== '<...>') {
                        doc.setFontSize(pdfFontSize);
                        doc.setFont(fontFamily, 'normal');
                        nextTxtW = doc.getTextWidth(nt);
                      }
                    }
                    const nextW = Math.max(nextSvgW, nextTxtW + extraSyllableSpacing);
                    // After the current syllable, if next would overflow, current is last on line
                    if (cursorX + finalSecWidth + nextW > pageWidth - pdfMarginRight) {
                      isLastOnLine = true;
                    }
                  }
                }
              }
              
              // Extend the SVG width to fill up to the right margin for the last syllable on the line
              if (isLastOnLine) {
                const extendedWidth = pageWidth - pdfMarginRight - cursorX;
                if (extendedWidth > finalSecWidth) {
                  finalSecWidth = extendedWidth;
                }
              }
              
              const partUuid = part.getAttribute('data-uuid');
              const partUuids = partUuid ? (uuidMap[partUuid] || [partUuid]) : [];
              
              // 1. Check if any comments start here
              if (partUuids.length > 0) {
                  const startingComments = documentComments.filter((c: any) => partUuids.includes(c.startUUID));
                  if (startingComments.length > 0) {
                      lineHasBrackets = true;
                      for (let ci = 0; ci < startingComments.length; ci++) {
                          const c = startingComments[ci];
                          const key = `${c.startUUID}_${c.endUUID}`;
                          const idx = documentComments.indexOf(c) + 1;
                          activeBrackets[key] = { startX: cursorX, startLineY: lineStartY, label: `[${idx}]` };
                      }
                  }
              }
              
              // Print Signatur right-aligned before the first note of this line
              if (j === 0 && currentSignatures.length > 0) {
                  doc.setFontSize(pdfFontSize);
                  doc.setFont(fontFamily, "normal");
                  const sigText = currentSignatures.join(" ");
                  const sigWidth = doc.getTextWidth(sigText);
                  const sigX = musicStartX - sigWidth - 10;
                  doc.text(sigText, sigX, cursorY + (secHeight / 2) + (pdfFontSize * 0.35));
                  currentSignatures = [];
              }
              
              // Wrap to next line if it exceeds page width
              if (cursorX + finalSecWidth > pageWidth - pdfMarginRight) {
                 const bracketY = lineStartY + lineMaxHeight + (lineHasLyrics ? (pdfSyllableTextOffset + pdfFontSize + pdfBracketGap) : pdfBracketGap);
                 for (const key in activeBrackets) {
                     const b = activeBrackets[key];
                     drawActiveBracket(b.startX, cursorX, bracketY, b.label);
                 }
                 
                 let lineBottomY = lineStartY + lineMaxHeight;
                 if (lineHasBrackets) {
                     lineBottomY = bracketY + pdfBracketTick + 8;
                 } else if (lineHasLyrics) {
                     lineBottomY = lineStartY + lineMaxHeight + pdfSyllableTextOffset + pdfFontSize;
                 }
                 
                 cursorY = lineBottomY + pdfStaffSpacing;
                 checkPageOverflow(40);
                 
                 lineStartY = cursorY;
                 cursorX = musicStartX + 30; // auto-wrap with indentation
                 lineMaxHeight = 0;
                 lineHasLyrics = false;
                 lineHasBrackets = Object.keys(activeBrackets).length > 0;
                 
                 for (const key in activeBrackets) {
                     const b = activeBrackets[key];
                     b.startX = musicStartX + 30;
                     b.startLineY = lineStartY;
                 }
              }
              
              lineMaxHeight = Math.max(lineMaxHeight, secHeight);
              
              // Draw SVG
              if (svg) {
                const originalViewBox = svg.getAttribute('viewBox');
                if (!originalViewBox) {
                  // Use finalSecWidth (possibly extended to right margin) as the viewport width;
                  // the staff lines (x2="9999") will be naturally clipped to this viewBox
                  const finalRawWidth = finalSecWidth / SCALE;
                  svg.setAttribute('viewBox', `0 0 ${finalRawWidth} ${rawHeight}`);
                }
                
                await doc.svg(svg, { x: cursorX, y: cursorY, width: finalSecWidth, height: secHeight });
                
                if (!originalViewBox) {
                  svg.removeAttribute('viewBox');
                }
              }
              
              // Draw Syllable Text below the SVG
              if (txt) {
                const txtX = cursorX + (svgWidth / 2) - (textWidth / 2);
                doc.text(txt, Math.max(cursorX, txtX), cursorY + secHeight + pdfSyllableTextOffset);
              }
              
              // 2. Check if any comments end here
              if (partUuids.length > 0) {
                  const endingComments = documentComments.filter((c: any) => partUuids.includes(c.endUUID));
                  if (endingComments.length > 0) {
                      lineHasBrackets = true;
                      for (let ci = 0; ci < endingComments.length; ci++) {
                          const c = endingComments[ci];
                          const key = `${c.startUUID}_${c.endUUID}`;
                          if (activeBrackets[key]) {
                              const b = activeBrackets[key];
                              const bracketY = lineStartY + lineMaxHeight + (lineHasLyrics ? (pdfSyllableTextOffset + pdfFontSize + pdfBracketGap) : pdfBracketGap);
                              drawActiveBracket(b.startX, cursorX + finalSecWidth, bracketY, b.label);
                              delete activeBrackets[key];
                          }
                      }
                  }
              }
              
              cursorX += finalSecWidth;
            }
            
            // Close active brackets at the very end of the ZeileContainer
            const bracketY = lineStartY + lineMaxHeight + (lineHasLyrics ? (pdfSyllableTextOffset + pdfFontSize + pdfBracketGap) : pdfBracketGap);
            for (const key in activeBrackets) {
                const b = activeBrackets[key];
                drawActiveBracket(b.startX, cursorX, bracketY, b.label);
                delete activeBrackets[key];
            }
            
            let lineBottomY = lineStartY + lineMaxHeight;
            if (lineHasBrackets) {
                lineBottomY = bracketY + pdfBracketTick + 8;
            } else if (lineHasLyrics) {
                lineBottomY = lineStartY + lineMaxHeight + pdfSyllableTextOffset + pdfFontSize;
            }
            cursorY = lineBottomY + pdfStaffSpacing;
            checkPageOverflow(0);
            
          } else {
            // Normal Text / Paratext
            const contentDiv = contentRow.querySelector('.after-dragger > div:not(.type-identifier)');
            const textEl = contentDiv ? contentDiv.querySelector('textarea, span') : null;
            
            let txt = "";
            if (textEl && textEl.tagName.toLowerCase() === 'textarea') {
              txt = (textEl as HTMLTextAreaElement).value.trim();
            } else if (textEl) {
               txt = (textEl as HTMLElement).innerText.trim();
            }
            
            if (txt) {
              const paratextFontSize = this.settings?.pdfParatextFontSize ?? 10;
              const paratextSpacing = this.settings?.pdfParatextSpacing ?? 12;
              checkPageOverflow(paratextFontSize * 2);
              
              doc.setFontSize(paratextFontSize);
              doc.setFont(fontFamily, "normal");
              
              const splitText = doc.splitTextToSize(txt, printWidth - paddingLeft);
              doc.text(splitText, xOffset, cursorY);
              cursorY += (splitText.length * (paratextFontSize * 1.4)) + paratextSpacing;
              checkPageOverflow(0);
              wasLastElementParatext = true;
            }
          }
        }

        // Render Comment Trees on the final page (Critical Apparatus)
        const commentsArea = document.getElementById('pdf-comments-render-area');
        const hasComments = (this.cont?.comments && this.cont.comments.length > 0) || this.cont?.globalComment;
        if (commentsArea && hasComments) {
            doc.addPage();
            let cursorY = pdfMarginTop;
            const titleFontSize = this.settings?.pdfTitleFontSize ?? 16;
            doc.setFontSize(titleFontSize);
            doc.setFont(fontFamily, "bold");
            doc.text("Critical Apparatus", pdfMarginLeft, cursorY);
            cursorY += (this.settings?.pdfTitleVerticalSpace ?? 20);
            checkPageOverflow(0);

            const commentBlocks = commentsArea.querySelectorAll('.pdf-comment-block');
            for (let i = 0; i < commentBlocks.length; i++) {
                const block = commentBlocks[i] as HTMLElement;
                const blockRect = block.getBoundingClientRect();
                const blockWidth = blockRect.width > 0 ? blockRect.width : 1000;
                const maxScale = this.settings?.pdfCommentStaffScale ?? this.settings?.pdfScale ?? 0.40;
                const SCALE_C = Math.min(maxScale, (pageWidth - pdfMarginLeft - pdfMarginRight) / blockWidth);
                
                let bHeight = blockRect.height * SCALE_C;
                if (cursorY + bHeight > maxContentY) {
                    doc.addPage();
                    cursorY = pdfMarginTop;
                }

                // Draw each element relative to the block
                const elementsToDraw = block.querySelectorAll('textarea, svg, .bracket, h4, span.text, .syllableText:not(.dnone), .app-index');
                for (let j = 0; j < elementsToDraw.length; j++) {
                    const el = elementsToDraw[j] as HTMLElement;
                    const elRect = el.getBoundingClientRect();
                    
                    const relX = elRect.left - blockRect.left;
                    const relY = elRect.top - blockRect.top;
                    
                    const sRelX = relX * SCALE_C;
                    const sRelY = relY * SCALE_C;
                    const drawX = pdfMarginLeft + sRelX;
                    const drawY = cursorY + sRelY;
                    
                    if (el.tagName.toLowerCase() === 'svg') {
                        const rawWidth = parseFloat(el.getAttribute('width') || elRect.width.toString() || '50');
                        const rawHeight = elRect.height > 0 ? elRect.height : 100;
                        const svgWidth = rawWidth * SCALE_C;
                        const svgHeight = rawHeight * SCALE_C;
                        const originalViewBox = el.getAttribute('viewBox');
                        if (!originalViewBox) {
                            el.setAttribute('viewBox', `0 0 ${rawWidth} ${rawHeight}`);
                        }
                        await doc.svg(el as unknown as SVGElement, { x: drawX, y: drawY, width: svgWidth, height: svgHeight });
                        if (!originalViewBox) {
                            el.removeAttribute('viewBox');
                        }
                    } 
                    else if (el.classList.contains('syllableText')) {
                        const val = el.innerText.trim();
                        if (val && val !== "X" && val !== "..." && val !== "<...>") {
                            const commentFontSize = this.settings?.pdfCommentFontSize ?? 9;
                            doc.setFontSize(commentFontSize);
                            doc.setFont(fontFamily, "normal");
                            doc.text(val, drawX, drawY + commentFontSize);
                        }
                    }
                    else if (el.tagName.toLowerCase() === 'textarea' || el.tagName.toLowerCase() === 'span') {
                        let val = "";
                        if (el.tagName.toLowerCase() === 'textarea') {
                            val = (el as HTMLTextAreaElement).value.trim();
                        } else {
                            val = el.innerText.trim();
                        }
                        if (val) {
                            const commentFontSize = this.settings?.pdfCommentFontSize ?? 9;
                            const commentLineHeight = commentFontSize * 1.4;
                            const rightBoundary = pageWidth - pdfMarginRight;
                            let curX = drawX;
                            let textY = drawY + commentFontSize + 2;
                            const tokens = val.split(/(\(\(.*?\)\)|\{\{.*?\}\}|\[\[.*?\]\])/g);
                            
                            // Word-wrap helper: splits text into words and wraps at rightBoundary
                            const wrapAndDraw = (text: string, fontStyle: string, fontSize: number, isBoxed: boolean) => {
                              doc.setFontSize(fontSize);
                              doc.setFont(fontFamily, fontStyle);
                              // Split on whitespace, keeping the spaces as tokens
                              const words = text.split(/(\s+)/);
                              for (const word of words) {
                                if (!word) continue;
                                const wordWidth = doc.getTextWidth(word);
                                // Wrap if the word would overflow (but only if we've advanced past the left margin)
                                if (curX + wordWidth > rightBoundary && curX > drawX + 1) {
                                  curX = drawX;
                                  textY += commentLineHeight;
                                }
                                doc.text(word, curX, textY);
                                if (isBoxed) {
                                  doc.setLineWidth(0.2);
                                  doc.rect(curX - 1, textY - fontSize, wordWidth + 2, fontSize + 2);
                                }
                                curX += wordWidth;
                              }
                            };
                            
                            for (const token of tokens) {
                                if (!token) continue;
                                if (token.startsWith('((')) {
                                    const t = token.replace(/\(\(|\)\)/g, '');
                                    wrapAndDraw(t, 'normal', commentFontSize, false);
                                } else if (token.startsWith('[[')) {
                                    const t = token.replace(/\[\[|\]\]/g, '').toUpperCase();
                                    wrapAndDraw(t, 'bold', commentFontSize - 1, false);
                                } else if (token.startsWith('{{')) {
                                    const t = token.replace(/\{\{|\}\}/g, '');
                                    wrapAndDraw(t, 'normal', commentFontSize, true);
                                } else {
                                    wrapAndDraw(token, 'italic', commentFontSize, false);
                                }
                            }
                        }
                    }
                    else if (el.tagName.toLowerCase() === 'h4' || el.classList.contains('app-index')) {
                        const val = el.innerText.trim();
                        const commentTitleFontSize = this.settings?.pdfCommentTitleFontSize ?? 10;
                        doc.setFontSize(commentTitleFontSize);
                        doc.setFont(fontFamily, "bolditalic");
                        doc.text(val, drawX, drawY + commentTitleFontSize);
                    }
                    else if (el.classList.contains('bracket')) {
                        const bWidth = elRect.width * SCALE_C;
                        const bHeight = elRect.height * SCALE_C;
                        doc.setDrawColor(0,0,0);
                        doc.setLineWidth(this.settings?.pdfBracketThickness ?? 1.2);
                        doc.line(drawX, drawY, drawX + bWidth, drawY); // top
                        doc.line(drawX + bWidth, drawY, drawX + bWidth, drawY + bHeight); // right
                        doc.line(drawX + bWidth, drawY + bHeight, drawX, drawY + bHeight); // bottom
                    }
                }
                
                cursorY += bHeight + (this.settings?.pdfCommentBlockGap ?? 25);
            }
        }

        // Draw page numbers and running headlines on all pages
        const totalPages = doc.getNumberOfPages();
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
          doc.setPage(pageNum);
          
          // Page Numbers
          if (this.settings?.pdfShowPageNumbers) {
            const pageNumFontSize = this.settings?.pdfPageNumberFontSize ?? 8;
            doc.setFontSize(pageNumFontSize);
            doc.setFont(fontFamily, "normal");
            doc.setTextColor(120, 120, 120);
            const pageNumText = `Page ${pageNum} of ${totalPages}`;
            const pageNumWidth = doc.getTextWidth(pageNumText);
            const textY = pageHeight - (pdfMarginBottom / 2);
            doc.text(pageNumText, pdfMarginLeft + printWidth / 2 - pageNumWidth / 2, textY);
          }

          // Running Headline on page 2+
          if (pageNum > 1) {
            const headlineFields = this.settings?.pdfHeadlineMetadataFields || [];
            const headlineText = this.buildHeadlineText(headlineFields);
            if (headlineText) {
              const headlineFontSize = this.settings?.pdfHeadlineFontSize ?? 8;
              doc.setFontSize(headlineFontSize);
              doc.setFont(fontFamily, "italic");
              doc.setTextColor(80, 80, 80);
              
              const splitHeadline = doc.splitTextToSize(headlineText, printWidth);
              let headlineY = pdfMarginTop / 2;
              
              for (const line of splitHeadline) {
                const lineX = pdfMarginLeft + printWidth / 2 - doc.getTextWidth(line) / 2;
                doc.text(line, lineX, headlineY);
                headlineY += headlineFontSize * 1.2;
              }
              
              const lineUnderY = headlineY - (headlineFontSize * 1.2) + 6;
              doc.setLineWidth(0.5);
              doc.setDrawColor(200, 200, 200);
              doc.line(pdfMarginLeft, lineUnderY, pageWidth - pdfMarginRight, lineUnderY);
            }
          }
        }

        doc.save(`Document_${this.document?.dokumenten_id || 'Export'}.pdf`);

      } catch (err) {
        console.error("PDF Generation failed:", err);
        this.toastr.error("Failed to generate PDF.", "Error");
      } finally {
        this.isPrinting = false;
        this.readOnly = originalReadOnly;
      }
    }, 200);
  }

  getInlineMetadataItems(): { label: string, val: string }[] {
    const items: { label: string, val: string }[] = [];
    if (!this.document) return items;
    if (this.document.dokumenten_id) items.push({ label: 'ID', val: this.document.dokumenten_id });
    if (this.document.textinitium) items.push({ label: 'Initium', val: this.document.textinitium });
    const genres = [this.document.gattung1, this.document.gattung2].filter(x => x).join(' / ');
    if (genres) items.push({ label: 'Genre', val: genres });
    const feast = [this.document.festtag, this.document.feier ? `(${this.document.feier})` : ''].filter(x => x).join(' ');
    if (feast) items.push({ label: 'Feast', val: feast });
    if (this.document.foliostart || this.document.zeilenstart) {
      items.push({ label: 'Folio/Line', val: `F: ${this.document.foliostart || ''}, L: ${this.document.zeilenstart || ''}` });
    }
    if (this.document.druckausgabe) items.push({ label: 'Edition', val: this.document.druckausgabe });
    if (this.document.bibliographischerverweis) items.push({ label: 'Ref', val: this.document.bibliographischerverweis });
    if (this.document.kommentar) items.push({ label: 'Comment', val: this.document.kommentar });
    
    if (this.settings?.customDocumentFields) {
      for (const cf of this.settings.customDocumentFields) {
        const val = this.document.custom?.[cf.key];
        if (val) {
          items.push({ label: cf.label, val });
        }
      }
    }
    return items;
  }

  recalcId(): void {
    if (this.sourceSigle && this.document) {
      this.document.dokumenten_id = [this.sourceSigle, this.document.foliostart, this.document.zeilenstart].join('-');
    }
  }

  getJsonString = (): string | undefined => {
    if (this.cont) {
      return JSON.stringify({
        cont: this.cont,
        sourceAnnotations: this.sourceData ? {
          annotationRegions: this.sourceData.annotationRegions,
          annotationItems: this.sourceData.annotationItems,
          transcriptionAnnotations: this.sourceData.transcriptionAnnotations
        } : undefined
      });
    }
    return undefined;
  }

  undoChanges = (jsonString: string): void => {
    try {
      const parsed = JSON.parse(jsonString);
      if (parsed && parsed.cont) {
        this.cont = parsed.cont;
        if (this.sourceData && parsed.sourceAnnotations) {
          this.sourceData.annotationRegions = parsed.sourceAnnotations.annotationRegions;
          this.sourceData.annotationItems = parsed.sourceAnnotations.annotationItems;
          this.sourceData.transcriptionAnnotations = parsed.sourceAnnotations.transcriptionAnnotations;
          // Note: not saving to API immediately on undo, the user might save later or we can call saveSourceData
          this.saveSourceData();
        }
      } else if (parsed) {
        // Fallback for old history that only had the container object
        this.cont = parsed;
      }
    } catch (e) {
      console.error("Error parsing undo history", e);
    }
  }

  ngOnInit(): void {
    this.undoService.registerUnDo(this.getJsonString, this.undoChanges);
    this.subs.push(combineLatest([this.userService.user, this.route.paramMap]).subscribe(([user, params]) => {
      this.user = user;
      if (this.user) {
        this.api.getSettings(this.user.token).subscribe(res => {
          if (res.kind === 'SettingsRetrieved') {
            this.settings = res.settings;
          }
        });
      }
      const source = (params.get('source') as string);
      const id = params.get('id');
      this.setSourceSigle(source);
      
      if (this.user) {
        this.api.getSource(this.user.token, source).subscribe(res => {
          if (res.kind === 'SourceRetrieved') {
            this.sourceData = res.source;
            this.updateToolbar();
          }
        });
      }

      if (id !== null) {
        this.retrieveForId(id);
      } else {
        this.pageTitle.set('New Document', 'Editing');
        this.collapseMetadata = false;
        this.document = {
          id: '',
          quelle_id: source,
          dokumenten_id: '',
          gattung1: '',
          gattung2: '',
          festtag: '',
          feier: '',
          textinitium: '',
          bibliographischerverweis: '',
          druckausgabe: '',
          zeilenstart: '',
          foliostart: '',
          kommentar: '',
          editionsstatus: '',
          custom: {}
        };
        this.cont = VM.emptyRootContainer();
        this.currentFolioIndex = this.initialFolioIndex;
      }

      setTimeout(() => {
        this.updateToolbar();
      }, 0);
    }));
    
    // Subscribe to query params to restore view mode
    this.subs.push(this.route.queryParams.subscribe(params => {
      if (params['view'] && ['transcription', 'split', 'iiif'].includes(params['view'])) {
        this.setViewMode(params['view'] as any, false);
      }
    }));
  }

  updateToolbar() {
    const source = this.route.snapshot.paramMap.get('source') || '';
    
    // Tools logic
    const tools: any[] = [
      {
        callback: () => { this.goToSource(source); },
        icon: 'to-source',
        title: 'Back to Source'
      }
    ];

    // Add view buttons if IIIF exists
    if (this.sourceData?.iiifManifestUrl) {
      tools.push(
        {
          callback: () => { this.setViewMode('iiif'); },
          icon: 'image',
          title: 'Scan Only',
          active: this.viewMode === 'iiif'
        },
        {
          callback: () => { this.setViewMode('split'); },
          icon: 'layout-split',
          title: 'Split View',
          active: this.viewMode === 'split'
        },
        {
          callback: () => { this.setViewMode('transcription'); },
          icon: 'music-note-list',
          title: 'Transcription Only',
          active: this.viewMode === 'transcription'
        }
      );
    }

    // Standard buttons
    tools.push(
      {
        callback: () => { this.upload(); },
        icon: 'upload',
        title: 'Upload Document'
      },
      {
        callback: () => { this.download(); },
        icon: 'download',
        title: 'Export Document'
      },
      {
        callback: () => { this.openPdfExport(); },
        icon: 'file-pdf',
        title: 'Export as PDF'
      },
      {
        callback: () => { this.toggleReadOnly(); },
        icon: 'eye',
        title: 'Toggle Read-Only Mode'
      },
      {
        callback: () => { this.modalService.open(this.textImportModal); },
        icon: 'file-earmark-text',
        title: 'Import Text'
      },
      {
        callback: () => { this.modalService.open(this.globalCommentModal, { size: 'xl', fullscreen: true }); },
        icon: 'chat-left-text',
        title: 'Edit Global Comment'
      }
    );

    // Update stack
    this.toolService.remove(this);
    this.toolService.addStack({
      source: this,
      tools: tools
    });
  }

  goToSource(s_id: string) {
    this.router.navigate(['/source', s_id]);
  }

  retrieveForId(id: string): void {
    if (this.user) {
      this.api.getDocument(this.user.token, id).subscribe(res => {
        switch (res.kind) {
          case 'LoginRequired': this.userService.logout(); break;
          case 'InsufficientPermissions': this.userService.logout(); break;
          case 'DocumentNotFound': this.document = undefined; break;
          case 'DocumentRetrieved':
            this.document = res.document;
            if (!this.document.custom) this.document.custom = {};
            if (this.document) {
              this.documentJsonClone = JSON.stringify(this.document);
              this.currentFolioIndex = this.initialFolioIndex;
              this.pageTitle.set(
                this.document.textinitium || this.document.dokumenten_id || 'Document',
                this.sourceSigle || undefined,
                'Editing'
              );
            }
            break;
          default: assertNever(res);
        }
      });
      this.api.getDocumentNotes(this.user.token, id).subscribe(res => {
        switch (res.kind) {
          case 'LoginRequired': this.userService.logout(); break;
          case 'InsufficientPermissions': this.userService.logout(); break;
          case 'DocumentNotFound': this.document = undefined; break;
          case 'NotesRetrieved': this.cont = res.data; this.contJsonClone = JSON.stringify(this.cont); break;
          default: assertNever(res);
        }
      });
    }
  }

  setSourceSigle(sourceId: string): void {
    if (this.user) {
      this.api.getSigle(this.user.token, sourceId).subscribe(res => {
        switch (res.kind) {
          case 'LoginRequired': this.userService.logout(); break;
          case 'SourceNotFound': this.sourceSigle = ''; break;
          case 'SigleRetrieved': this.sourceSigle = res.sigle; break;
          default: assertNever(res);
        }
        this.recalcId();
      });
    }
  }

  addToSettings(category: keyof ProjectSettings, value: string | undefined) {
    if (!value || !value.trim() || !this.settings || !this.user) return;
    const val = value.trim();
    const arr = this.settings[category] as any;
    if (Array.isArray(arr) && !arr.includes(val)) {
      arr.push(val);
      this.api.updateSettings(this.user.token, this.settings).subscribe(() => {
        this.toastr.success(`${val} zu ${category} hinzugefügt`);
      });
    }
  }

  addToSettingsCustom(category: string, value: string | undefined) {
    if (!value || !value.trim() || !this.settings || !this.user) return;
    const val = value.trim();
    if (!this.settings.customLists) this.settings.customLists = {};
    if (!this.settings.customLists[category]) this.settings.customLists[category] = [];
    if (!this.settings.customLists[category].includes(val)) {
      this.settings.customLists[category].push(val);
      this.api.updateSettings(this.user.token, this.settings).subscribe(() => {
        this.toastr.success(`${val} zu ${category} hinzugefügt`);
      });
    }
  }

  save(): void {
    if (this.document) {
      if (this.document.id) {
        this.update();
      } else {
        this.create();
      }
    }
  }

  create(): void {
    const doc = this.document;
    const cont = this.cont;
    if (this.user && doc && cont) {
      if (this.isSaving) {
        this.savePending = true;
        return;
      }
      this.isSaving = true;
      this.api.createDocument(this.user.token, { document: doc, notes: cont }).subscribe(res => {
        this.isSaving = false;
        switch (res.kind) {
          case 'LoginRequired': this.userService.logout(); break;
          case 'DocumentCreated': 
            this.toastr.success("Erfolgreich gespeichert"); 
            this.document!.id = res.id;
            this.location.replaceState('/document/' + doc.quelle_id + '/' + res.id); 
            break;
          default: assertNever(res);
        }
        if (this.savePending) {
          this.savePending = false;
          this.save();
        }
      });
    }
  }

  update(): void {
    if (this.user && this.document && this.document.id && this.cont) {
      if (this.isSaving) {
        this.savePending = true;
        return;
      }
      this.isSaving = true;
      this.api.updateDocument(this.user.token, { document: this.document, notes: this.cont }).subscribe(res => {
        this.isSaving = false;
        switch (res.kind) {
          case 'LoginRequired': this.userService.logout(); break;
          case 'Ok': 
            // Removed toastr to prevent spamming on autosave
            this.resetClones(); 
            break;
          case 'DocumentNotFound': this.toastr.error("Es sieht so aus, als wäre das Dokument zwischenzeitlich gelöscht worden"); break;
          case 'InsufficientPermissions': this.toastr.error("Sie haben nicht genügend Rechte, um dieses Dokument zu speichern. Sie können das Dokument jedoch als JSON downloaden, um die Rechte bitten und es dann wieder hochladen um Datenverlust zu vermeiden.", "Fehler beim Speichern."); break;
          default: assertNever(res);
        }
        if (this.savePending) {
          this.savePending = false;
          this.save();
        }
      });
    }
  }

  download(): void {
    const pom = document.createElement('a');
    pom.setAttribute('href', 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(this.cont)));
    if (this.document && this.document.dokumenten_id) {
      pom.setAttribute('download', this.document.dokumenten_id + ".json");
    } else {
      pom.setAttribute('download', "document.json");
    }

    if (document.createEvent) {
      var event = document.createEvent('MouseEvents');
      event.initEvent('click', true, true);
      pom.dispatchEvent(event);
    }
    else {
      pom.click();
    }
  }

  upload(): void {
    document.getElementById("document-upload")!.click();
  }

  handleFile(): void {
    const that = this;
    const file = (document.getElementById("document-upload") as HTMLInputElement)!.files![0];
    const reader = new FileReader();
    reader.onload = (p: ProgressEvent) => {
      const newCont = (p.target as any).result;
      if (this.user) {
        this.api.verifyNotes(this.user.token, newCont).subscribe(res => {
          switch (res.kind) {
            case 'LoginRequired': this.userService.logout(); break;
            case 'Failed': this.toastr.error("Invalides Format", "Upload gescheitert!"); break;
            case 'NotesRetrieved':
              this.cont = res.data;
              this.contJsonClone = JSON.stringify(this.cont);
              this.toastr.success("Upload erfolgreich!");
              break;

            default: assertNever(res);
          }
        });
        (document.getElementById("document-upload") as HTMLInputElement)!.value = "";
      }
    }
    reader.readAsText(file);
  }

  @HostListener('window:unload', ['$event'])
  unloadHandler($event: any) {
    this.hasChanges();
  }

  @HostListener('window:beforeunload', ['$event'])
  beforeUnloadHander($event: any) {
    return !this.hasChanges();
  }

  @HostListener('window:keydown', ['$event'])
  keyEvent(event: KeyboardEvent) {
    if (event.ctrlKey && event.key === 'z') {
      this.undoService.undo();
    }
  }

  hasChanges(): boolean {
    if (this.contJsonClone)
      return !(this.contJsonClone.replace(/"focus":true/, '"focus":false') === JSON.stringify(this.cont).replace(/"focus":true/, '"focus":false')
        && this.documentJsonClone === JSON.stringify(this.document));
    return false;
  }

  resetClones(): void {
    this.documentJsonClone = JSON.stringify(this.document);
    this.contJsonClone = JSON.stringify(this.cont);
  }

  ngOnDestroy(): void {
    for (const s of this.subs) {
      s.unsubscribe();
    }
    this.toolService.remove(this);
  }

  doImport(): void {
    this.textImportErrors = [];
    if (this.validateTextImputAgainstCommonErrors(this.importText.trim())) {
      const result = parsers[this.importType]!.parse(this.importText.trim());
      if (result.status) {
        this.cont = result.value;
        this.modalService.dismissAll();
      } else {
        console.log(result);
        this.toastr.error("Technische details können in der Konsole gesehen werden", "Text konnte nicht geparst werden");
        this.modalService.dismissAll();
      }
    }
  }

  validateTextImputAgainstCommonErrors(importedText: string): boolean {
    // rule more then 2 tabstops regex(/\t\t+/)
    const rule1 = /\t\t\t+/;
    // rule more then 2 spaces regex(/\ \ +/)
    const rule2 = /\ \ +/;
    // rule no whitespace in first column
    const rule3 = /^\ +\t/;
    // rule if || then two tabs else only one allowed
    const rule4 = /\t.*\t(?!\|{2})/;

    const rules: RegExp[] = [rule1, rule2, rule3, rule4];
    const inputLines = importedText.split('\n');
    let result = true;
    const errors: Array<Array<string>> = new Array(4).fill(1).map(() => new Array());
    for (let i = 0; i < inputLines.length; i++) {
      rules.map((rule, index) => {
        if (inputLines[i].match(rule) != null) {
          errors[index].push('' + (i + 1));
          result = false;
        }
      }
      );
    }
    if (!result) {
      if (errors.length > 0) {
        if (errors[0].length > 0) {
          this.textImportErrors.push('Es wurden mehr als Zwei Tabstops in folgenden Zeilen erkannt: ' + errors[0]);
        }
        if (errors[1].length > 0) {
          this.textImportErrors.push('Es wurden Zwei oder mehr Leerzeichen hintereinander in folgenden Zeilen erkannt: ' + errors[1]);
        }
        if (errors[2].length > 0) {
          this.textImportErrors.push('Es wurden Leerzeichen in der ersten Spalte in folgenden Zeilen erkannt: ' + errors[2]);
        }
        if (errors[3].length > 0) {
          this.textImportErrors.push('Es wurden Zwei Tabs in Zeilen ohne Seitenumbruch in folgenden Zeilen erkannt: ' + errors[3]);
        }
      }
      this.toastr.error('Es wurden Fehler in der Eingabe erkannt.');
    }
    return result;
  }

  copyIdToClipboard(): void {
    const e = document.getElementById("document-id-input") as HTMLInputElement | null;
    if (e) {
      e.select();
      e.setSelectionRange(0, 99999)
      document.execCommand("copy");
      window.alert("copied");
    }
  }

  createGlobalComment(): void {
    if (this.cont) {
      this.cont.globalComment = VM.emptyCommentTree();
    }
  }

  handleGlobalCommentTreeEvent(e: VM.CommentTreeEvent): void {
    if (this.cont?.globalComment) {
      this.cont.globalComment = VM.applyCommentTreeEvent(this.cont.globalComment, e);
    }
  }

  createNewZeileContainerForTreeComment(): VM.ZeileContainer {
    return VM.emptyZeileContainer();
  }

  deleteGlobalComment(): void {
    if (this.cont) {
      this.cont.globalComment = undefined;
    }
  }

  openComment(comment: VM.Comment): void {
    if (!this.cont) return;
    this.undoService.beforeChange('Edit Comment');
    const original = VM.extractComment(this.cont, comment);
    
    const modalRef = this.modalService.open(CommentComponent, { size: 'xl', fullscreen: true });
    modalRef.componentInstance.comments = [JSON.parse(JSON.stringify(comment))];
    modalRef.componentInstance.originals = [JSON.parse(JSON.stringify(original))];
    modalRef.componentInstance.saveEvent.subscribe((newComments: (VM.Comment | null)[]) => {
      const nc = newComments[0];
      if (nc === null) {
        this.cont!.comments = this.cont!.comments.filter(c => c !== comment);
        VM.removeStaleComments(this.cont!);
      } else {
        comment.emendation = nc.emendation;
        comment.lines = nc.lines;
        comment.tree = nc.tree;
        comment.text = nc.text;
      }
      this.save();
    });
  }
  getCommentType(c: VM.Comment): string {
    if (c.commentType) return c.commentType;
    if (c.tree) return 'tree';
    if (c.lines) return 'lines';
    return 'text';
  }

  getCommentPreview(comment: VM.Comment): string {
    if (!this.cont) return '';
    const syllables = VM.getSyllables(this.cont);
    
    // Helper to find parent syllable by checking syllable UUID or note UUIDs inside
    const findSyllableIdx = (uuid: string): number => {
      return syllables.findIndex(s => {
        if (s.uuid === uuid) return true;
        if (s.notes && s.notes.spaced) {
          for (const ns of s.notes.spaced) {
            for (const g of ns.nonSpaced) {
              for (const n of g.grouped) {
                if (n.uuid === uuid) return true;
              }
            }
          }
        }
        return false;
      });
    };

    const startIdx = findSyllableIdx(comment.startUUID);
    const endIdx = findSyllableIdx(comment.endUUID);
    
    if (startIdx >= 0 && endIdx >= 0) {
      const minIdx = Math.min(startIdx, endIdx);
      const maxIdx = Math.max(startIdx, endIdx);
      const sliced = syllables.slice(minIdx, maxIdx + 1);
      
      const words = sliced.map(s => s.text).filter(t => !!t);
      if (words.length > 0) {
        return `"${words.join(' ')}"`;
      }
      
      // Fallback to note pitches when syllables have empty lyrics
      const notes: VM.Note[] = [];
      for (const s of sliced) {
        if (s.notes && s.notes.spaced) {
          for (const ns of s.notes.spaced) {
            for (const g of ns.nonSpaced) {
              for (const n of g.grouped) {
                notes.push(n);
              }
            }
          }
        }
      }
      if (notes.length > 0) {
        return `[${notes.map(n => n.base + n.octave).join('-')}]`;
      }
    }
    return '';
  }

  getCommentTreeText(tree: VM.CommentTree | undefined): string {
    if (!tree) return '';
    if (tree.kind === "CommentTreeLeaf") {
      if (tree.content.kind === "Text") {
        return tree.content.content;
      } else if (tree.content.kind === "Notes") {
        const syllables = VM.getSyllables(tree.content.content);
        const text = syllables.map(s => s.text).filter(t => !!t).join(' ');
        if (text) {
          return `[Notes: ${text}]`;
        } else {
          // Fall back to note pitches when lyrics are empty
          const notes: VM.Note[] = [];
          for (const s of syllables) {
            if (s.notes && s.notes.spaced) {
              for (const ns of s.notes.spaced) {
                for (const g of ns.nonSpaced) {
                  for (const n of g.grouped) {
                    notes.push(n);
                  }
                }
              }
            }
          }
          if (notes.length > 0) {
            const pitchStr = notes.map(n => n.base + n.octave).join('-');
            return `[Notes: ${pitchStr}]`;
          }
          return '[Notes]';
        }
      } else if (tree.content.kind === "Bracket") {
        return ']';
      }
    } else if (tree.kind === "CommentTreeGrid") {
      const parts: string[] = [];
      for (const row of tree.items) {
        for (const cell of row) {
          const cellText = this.getCommentTreeText(cell);
          if (cellText) parts.push(cellText);
        }
      }
      return parts.join(' / ');
    }
    return '';
  }

}
