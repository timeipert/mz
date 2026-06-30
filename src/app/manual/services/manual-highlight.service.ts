import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ManualHighlightService {
  private activeHighlightSubject = new BehaviorSubject<string | null>(null);
  activeHighlight$ = this.activeHighlightSubject.asObservable();

  setHighlight(id: string | null) {
    this.activeHighlightSubject.next(id);
  }
}
