import os

with open('src/app/search/search.component.html', 'r') as f:
    html = f.read()

# 1. Quick results header
old_quick_header = """<div class="d-flex align-items-center justify-content-between mb-2">
          <span class="fw-semibold small text-muted">{{quickResults.length}} result(s)</span>"""
new_quick_header = """<div class="d-flex align-items-center justify-content-between mb-2 flex-wrap gap-2">
          <div class="d-flex align-items-center gap-2">
            <span class="fw-semibold small text-muted">{{quickResults.length}} result(s)</span>
            <span class="text-primary small ms-2"><i class="bi bi-info-circle me-1"></i>Check multiple documents below to compare them side-by-side (Synopse).</span>
          </div>"""
html = html.replace(old_quick_header, new_quick_header)

# 2. Quick results list items
old_list_item = """<button *ngFor="let r of quickResults" type="button"
                  class="list-group-item list-group-item-action"
                  (click)="goToQuickResult(r)">
            <div class="d-flex align-items-start gap-3">"""
new_list_item = """<div *ngFor="let r of quickResults"
               class="list-group-item list-group-item-action cursor-pointer"
               (click)="goToQuickResult(r)">
            <div class="d-flex align-items-start gap-3">
              <!-- Selection Checkbox for Documents -->
              <div *ngIf="r.kind === 'document'" class="d-flex align-self-center me-1" (click)="$event.stopPropagation()">
                <input type="checkbox" class="form-check-input" style="transform: scale(1.15);"
                       [checked]="isDocSelected(r.id)"
                       (change)="toggleQuickResultSelection(r, $event)" />
              </div>
              
              <!-- Spacer for Sources to align list elements -->
              <div *ngIf="r.kind === 'source'" style="width: 20px; height: 20px; flex-shrink: 0;" class="me-1"></div>"""
html = html.replace(old_list_item, new_list_item)
html = html.replace("</button>\n        </div>\n      </div>\n    </div>\n  </div>", "</div>\n        </div>\n      </div>\n    </div>\n  </div>")

# 3. Source results pattern button
old_source_btn = """<div class="d-flex gap-2 align-items-center">
          <button class="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1"
                  (click)="exportSourcesCSV()">"""
new_source_btn = """<div class="d-flex gap-2 align-items-center">
          <button type="button" class="btn btn-sm btn-outline-primary d-flex align-items-center gap-1"
                  *ngIf="filteredSourceResults.length > 0"
                  (click)="openPatternAnalysis()"
                  title="Identify common melodic patterns within these sources">
            <i class="bi bi-diagram-3"></i> Identify Patterns
          </button>
          <button class="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1"
                  (click)="exportSourcesCSV()">"""
html = html.replace(old_source_btn, new_source_btn)

# 4. Document results pattern button
old_doc_btn = """<div class="d-flex gap-2 align-items-center">
          <button class="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1"
                  (click)="exportDocumentsCSV()">"""
new_doc_btn = """<div class="d-flex gap-2 align-items-center">
          <button type="button" class="btn btn-sm btn-outline-primary d-flex align-items-center gap-1"
                  *ngIf="filteredDocumentResults.length > 0"
                  (click)="openPatternAnalysis()"
                  title="Identify common melodic patterns within these documents">
            <i class="bi bi-diagram-3"></i> Identify Patterns
          </button>
          <button class="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1"
                  (click)="exportDocumentsCSV()">"""
html = html.replace(old_doc_btn, new_doc_btn)

# 5. Melody results sync
old_melody_res = """<div class="d-flex align-items-center justify-content-between mb-2">
          <span class="fw-semibold small text-muted">{{melodyResults.length}} match(es)</span>"""
new_melody_res = """<div class="d-flex align-items-center justify-content-between mb-2 flex-wrap gap-2">
          <div class="d-flex align-items-center gap-3">
            <span class="fw-semibold small text-muted">{{melodyResults.length}} match(es)</span>
            <span class="text-primary small"><i class="bi bi-info-circle me-1"></i>Select multiple chants below to compare them side-by-side.</span>
          </div>"""
html = html.replace(old_melody_res, new_melody_res)

# 6. Melody note highlights
old_note = """<app-notes [readOnly]="true" [model]="syl" [comments]="[]"></app-notes>"""
new_note = """<app-notes [readOnly]="true" [model]="syl" [comments]="[]" [highlightNoteUUIDs]="r.matchNoteSet"></app-notes>"""
html = html.replace(old_note, new_note)
html = html.replace('[class.matching-syllable]="r.matchSylSet.has(syl.uuid)"', '')

# Finally wrap the original UI
wrapped_html = f'<div *ngIf="!showPatternAnalysis">\n{html}\n</div>\n\n'

pattern_ui = """
<div *ngIf="showPatternAnalysis" class="pattern-analysis-container py-3 container-fluid px-4" style="max-width: 1200px;">
  <!-- Header -->
  <div class="d-flex justify-content-between align-items-center mb-4">
    <h3 class="mb-0">Melodic Formula Analysis</h3>
    <button class="btn btn-outline-secondary btn-sm" (click)="exitPatternAnalysis()">
      <i class="bi bi-arrow-left me-1"></i> Back to Search
    </button>
  </div>

  <!-- Settings Card -->
  <div class="card shadow-sm mb-4">
    <div class="card-body py-3">
      <div class="row gx-3 gy-2 align-items-end">
        <div class="col-auto">
          <label class="form-label text-muted small mb-1">Type</label>
          <select class="form-select form-select-sm" [(ngModel)]="patternType">
            <option value="pitch">Pitch Names</option>
            <option value="interval">Intervals</option>
            <option value="contour">Contour</option>
          </select>
        </div>
        <div class="col-auto">
          <label class="form-label text-muted small mb-1">Length</label>
          <input type="number" class="form-control form-control-sm" style="width: 70px;" min="2" max="20" [(ngModel)]="patternLength">
        </div>
        <div class="col-auto">
          <label class="form-label text-muted small mb-1">Strictness</label>
          <select class="form-select form-select-sm" [(ngModel)]="patternStrictness">
            <option value="exact">Exact</option>
            <option value="fuzzy">Fuzzy (1 diff)</option>
          </select>
        </div>
        <div class="col-auto mb-1">
          <div class="form-check form-switch mb-0">
            <input type="checkbox" class="form-check-input" id="dedupPat" [(ngModel)]="patternDeduplicateEnabled">
            <label class="form-check-label small" for="dedupPat">Exclude Duplicates</label>
          </div>
        </div>
        <div class="col-auto mb-1">
          <div class="form-check form-switch mb-0">
            <input type="checkbox" class="form-check-input" id="mergePat" [(ngModel)]="patternMergeEnabled">
            <label class="form-check-label small" for="mergePat">Merge Patterns</label>
          </div>
        </div>
        <div class="col-auto">
          <button class="btn btn-primary btn-sm px-3" (click)="analyzePatterns()" [disabled]="patternSearching">
             <i class="bi bi-play-fill me-1"></i> Analyze
          </button>
        </div>
        <div class="col-auto" *ngIf="patternSearching">
           <button class="btn btn-outline-danger btn-sm" (click)="cancelPatternAnalysis()">Cancel</button>
        </div>
      </div>
      
      <!-- Progress Bar -->
      <div class="mt-3" *ngIf="patternSearching || patternProgress.phase">
        <div class="d-flex justify-content-between small text-muted mb-1">
          <span>{{patternProgress.phase}}</span>
          <span>{{patternProgress.percent}}%</span>
        </div>
        <div class="progress" style="height: 6px;">
          <div class="progress-bar progress-bar-striped progress-bar-animated" [style.width.%]="patternProgress.percent"></div>
        </div>
      </div>
    </div>
  </div>

  <div *ngIf="patternGroups.length > 0 && !patternSearching">
    <!-- Results View Mode Tabs -->
    <ul class="nav nav-tabs mb-4">
      <li class="nav-item">
        <button class="nav-link" [class.active]="patternViewMode === 'list'" (click)="setPatternViewMode('list')">Detailed List</button>
      </li>
      <li class="nav-item">
        <button class="nav-link" [class.active]="patternViewMode === 'overview'" (click)="setPatternViewMode('overview')">Abstract Overview</button>
      </li>
    </ul>

    <!-- List View -->
    <div *ngIf="patternViewMode === 'list'">
      <div *ngFor="let g of patternGroups.slice(0, visiblePatternGroupsLimit)" class="card mb-3 shadow-sm border-0" style="border-left: 4px solid #0d6efd !important;" (mouseenter)="onPatternFamilyHover(g.id)" (mouseleave)="onPatternFamilyHover(null)">
        <div class="card-header bg-white d-flex justify-content-between align-items-center py-2">
          <div>
            <span class="badge bg-primary rounded-pill me-2">Freq: {{g.frequency}}</span>
            <span class="fw-semibold font-monospace">{{g.key}}</span>
            <span *ngIf="g.isCompound" class="badge bg-warning-subtle text-warning border border-warning-subtle ms-2 rounded-pill small">Compound</span>
          </div>
        </div>
        <div class="list-group list-group-flush" *ngIf="expandedGroupIds.has(g.id)">
          <div class="list-group-item py-2" *ngFor="let occ of g.occurrences">
            <div class="small fw-semibold text-accent mb-1">{{occ.sourceSigle}} <span class="text-muted fw-normal">· {{occ.docTitle}}</span></div>
            <div class="d-flex flex-nowrap overflow-auto pb-1 align-items-center bg-light rounded px-2 pt-2" style="min-height: 60px;">
              <div *ngFor="let syl of occ.matchingSyllables" class="me-1 flex-shrink-0">
                <app-notes [readOnly]="true" [model]="syl" [comments]="[]"></app-notes>
              </div>
            </div>
          </div>
        </div>
        <div class="list-group list-group-flush" *ngIf="!expandedGroupIds.has(g.id)">
          <div class="list-group-item py-2" *ngFor="let occ of visibleOccurrences(g)">
            <div class="small fw-semibold text-accent mb-1">{{occ.sourceSigle}} <span class="text-muted fw-normal">· {{occ.docTitle}}</span></div>
            <div class="d-flex flex-nowrap overflow-auto pb-1 align-items-center bg-light rounded px-2 pt-2" style="min-height: 60px;">
              <div *ngFor="let syl of occ.matchingSyllables" class="me-1 flex-shrink-0">
                <app-notes [readOnly]="true" [model]="syl" [comments]="[]"></app-notes>
              </div>
            </div>
          </div>
          <div class="list-group-item text-center p-1 cursor-pointer bg-light small text-primary" *ngIf="g.occurrences.length > 3" (click)="toggleGroupExpand(g.id)">
            Show {{g.occurrences.length - 3}} more occurrences
          </div>
        </div>
        <div class="card-footer text-center p-1 cursor-pointer bg-light" *ngIf="expandedGroupIds.has(g.id)" (click)="toggleGroupExpand(g.id)">
          <small class="text-primary">Hide occurrences</small>
        </div>
      </div>
      <div class="text-center mt-4 mb-5" *ngIf="visiblePatternGroupsLimit < patternGroups.length">
        <button class="btn btn-outline-secondary px-4 rounded-pill" (click)="showMorePatternGroups()">Load More</button>
      </div>
    </div>

    <!-- Abstract Overview (Timeline View) -->
    <div *ngIf="patternViewMode === 'overview'" class="card shadow-sm border-0">
      <div class="card-body p-0 overflow-auto" style="max-height: 75vh;">
        <table class="table table-sm table-borderless mb-0 timeline-table" style="min-width: 900px; table-layout: fixed;">
          <tbody>
            <tr *ngFor="let docRow of patternTimelineDocs" style="border-bottom: 1px solid #f0f0f0;">
              <!-- Y-axis Metadata Column (260px) -->
              <td class="text-truncate align-middle pe-2 py-1" style="width: 260px; max-width: 260px; font-size: 0.75rem;" [title]="docRow.sourceSigle + ' ' + docRow.doc.textinitium + ' (' + docRow.doc.gattung1 + ')'">
                <span class="fw-semibold text-accent">{{docRow.sourceSigle}}</span> 
                {{docRow.doc.textinitium || docRow.doc.dokumenten_id}} 
                <span class="text-muted" *ngIf="docRow.doc.gattung1">({{docRow.doc.gattung1}})</span>
              </td>
              <!-- Timeline SVG Column -->
              <td class="align-middle position-relative p-0" style="height: 24px;">
                <svg width="100%" height="100%" style="display: block; position: absolute; top:0; left:0;">
                  <rect width="100%" height="1" fill="#e9ecef" y="11"></rect>
                  <rect *ngFor="let occ of docRow.occurrences"
                        [attr.x]="occ.startPct + '%'"
                        [attr.width]="occ.widthPct + '%'"
                        y="4" height="16"
                        [attr.fill]="occ.color"
                        class="pattern-marker group-marker-{{occ.groupId}}"
                        (mouseenter)="showTooltip($event, occ, docRow, occ.groupId, occ.sequenceKey)"
                        (mouseleave)="hideTooltip()">
                  </rect>
                </svg>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</div>

<!-- Floating Tooltip -->
<div *ngIf="hoveredOccurrence" class="position-fixed bg-white shadow border rounded p-2 z-3" 
     [style.left.px]="tooltipX" [style.top.px]="tooltipY" style="max-width: 320px; pointer-events: none;">
  <div class="small fw-bold font-monospace mb-1">{{hoveredOccurrence.repKey}}</div>
  <div class="small fw-semibold text-accent">{{hoveredOccurrence.sourceSigle}} <span class="fw-normal text-muted">· {{hoveredOccurrence.docTitle}}</span></div>
  <div class="small text-muted mb-1" style="font-size: 0.7rem;">Notes: {{hoveredOccurrence.start}} to {{hoveredOccurrence.end}}</div>
  <div class="small fst-italic text-truncate text-muted border-top pt-1 mt-1">{{hoveredOccurrence.syllables}}</div>
</div>
"""

with open('src/app/search/search.component.html', 'w') as f:
    f.write(wrapped_html + pattern_ui)

