import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { Router } from '@angular/router';

@Injectable({
  providedIn: 'root'
})
export class NavigationService {
  private focusFolioSource = new Subject<string>();
  focusFolio$ = this.focusFolioSource.asObservable();

  private focusPatternSource = new Subject<{documentId: string, uuid?: string}>();
  focusPattern$ = this.focusPatternSource.asObservable();

  constructor(private router: Router) { }

  openIiifViewerForFolio(sourceId: string, folio: string) {
    this.router.navigate(['/notation'], { queryParams: { source: sourceId, tab: 'iiif' } });
    setTimeout(() => {
      this.focusFolioSource.next(folio);
    }, 500); // Give it time to load the route and worker
  }

  openEditorForPattern(sourceId: string, documentId: string, uuid?: string) {
    this.router.navigate(['/document', sourceId, documentId], { queryParams: { focus: uuid } });
  }
}
