import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';
import { v4 as UUID } from 'uuid';

import { APIService, ProjectSettings } from '../api.service';
import { UserService } from '../user.service';
import * as M from '../types/model';
import { SavedCommentTemplate, stripTemplateTree } from './comment-templates';

/**
 * Persists user comment templates in ProjectSettings (via APIService, which in
 * this build is backed by local storage — so it works logged-out too).
 */
@Injectable({ providedIn: 'root' })
export class CommentTemplateService {
  // Persistence for saved comment templates.
  constructor(private api: APIService, private userService: UserService) { }

  private token(): string {
    let t = '';
    this.userService.user.pipe(take(1)).subscribe(u => { t = u?.token ?? ''; });
    return t;
  }

  /** Load the saved templates. */
  list(): Observable<SavedCommentTemplate[]> {
    return this.api.getSettings(this.token()).pipe(
      map(res => res.kind === 'SettingsRetrieved' ? (res.settings.commentTemplates ?? []) : [])
    );
  }

  /** Save a new template built from the given tree; resolves to the new list. */
  save(name: string, tree: M.CommentTree): Observable<SavedCommentTemplate[]> {
    return this.mutate(settings => {
      const templates = settings.commentTemplates ?? [];
      const tpl: SavedCommentTemplate = { id: UUID(), name, tree: stripTemplateTree(tree) };
      settings.commentTemplates = [...templates, tpl];
      return settings.commentTemplates;
    });
  }

  /** Remove a template by id; resolves to the new list. */
  remove(id: string): Observable<SavedCommentTemplate[]> {
    return this.mutate(settings => {
      settings.commentTemplates = (settings.commentTemplates ?? []).filter(t => t.id !== id);
      return settings.commentTemplates;
    });
  }

  private mutate(fn: (s: ProjectSettings) => SavedCommentTemplate[]): Observable<SavedCommentTemplate[]> {
    const token = this.token();
    return this.api.getSettings(token).pipe(
      switchMap(res => {
        if (res.kind !== 'SettingsRetrieved') return of([] as SavedCommentTemplate[]);
        const settings = res.settings;
        const next = fn(settings);
        return this.api.updateSettings(token, settings).pipe(map(() => next));
      })
    );
  }
}
