import { Component, EventEmitter, Input, Output } from '@angular/core';
import * as M from '../../../types/model';

@Component({
  selector: 'app-comment-tree-action-dot',
  templateUrl: './comment-tree-action-dot.component.html',
  styleUrls: ['./comment-tree-action-dot.component.scss']
})
export class CommentTreeActionDotComponent {
  @Input({ required: true }) path!: M.CommentTreePath;
  @Input({ required: true }) data!: M.CommentTree;
  @Input({ required: true }) supportsSettingContext!: boolean;
  @Output() treeEvent = new EventEmitter<M.CommentTreeEvent>();

  doDelete() {
    this.treeEvent.emit({ source: this.path, intent: { kind: 'Delete' } });
  }

  doSetJustificationLeft() {
    this.treeEvent.emit({ source: this.path, intent: { kind: 'SetJustification', justification: { kind: "Left" } } });
  }

  doSetJustificationRight() {
    this.treeEvent.emit({ source: this.path, intent: { kind: 'SetJustification', justification: { kind: "Right" } } });
  }

  doSetJustificationCenter() {
    this.treeEvent.emit({ source: this.path, intent: { kind: 'SetJustification', justification: { kind: "Center" } } });
  }

  doSetJustificationNone() {
    this.treeEvent.emit({ source: this.path, intent: { kind: 'SetJustification' } });
  }

  currentJustification(): M.Justification['kind'] | undefined {
    if (this.data.kind === 'CommentTreeLeaf' || this.data.kind === 'CommentTreeGrid') {
      return this.data.justification?.kind;
    }
  }

  doSetContext(enable: boolean) {
    this.treeEvent.emit({ source: this.path, intent: { kind: 'SetContext', context: enable } });
  }

  showContextSet(): boolean {
    return this.data.kind === 'CommentTreeLeaf' && this.data.content.kind === 'Notes' && this.data.content.context === true;
  }
}
