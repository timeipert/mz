import { Component, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { Subscription } from 'rxjs';
import { DragStateService } from '../dragger/drag-state.service';

interface TreeItem {
  zipper: number[];
  label: string;
  kind: string;
  depth: number;
  isAncestor: boolean;
}

@Component({
  selector: 'app-drag-map',
  templateUrl: './drag-map.component.html',
  styleUrls: ['./drag-map.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DragMapComponent implements OnDestroy {
  treeItems: TreeItem[] = [];
  visible = false;
  insertAfterIndex = -1;
  insertAfterDepth = 0;
  mapHoveredZipper: number[] | null = null;

  private lastRootData: any = null;
  private lastDraggingZipper: number[] | null = null;
  private sub = new Subscription();

  constructor(public dragState: DragStateService, private cdr: ChangeDetectorRef) {
    this.sub.add(
      this.dragState.change$.subscribe(() => {
        const dragging = !!this.dragState.draggingZipper;
        this.visible = dragging;

        if (dragging) {
          // Rebuild only when rootData or dragging zipper changes
          if (this.dragState.rootData !== this.lastRootData ||
              !this.cacheZipperMatches(this.dragState.draggingZipper)) {
            this.lastRootData = this.dragState.rootData;
            this.lastDraggingZipper = this.dragState.draggingZipper ? [...this.dragState.draggingZipper] : null;
            this.treeItems = this.buildFilteredTree();
          }
          this.computeInsertAfter();
        } else {
          this.treeItems = [];
          this.lastRootData = null;
          this.lastDraggingZipper = null;
          this.insertAfterIndex = -1;
          this.mapHoveredZipper = null;
        }

        this.cdr.markForCheck();
      })
    );
  }

  ngOnDestroy() {
    this.sub.unsubscribe();
  }

  // ── Tree building ─────────────────────────────────────────────────────────

  private cacheZipperMatches(z: number[] | null): boolean {
    if (!z && !this.lastDraggingZipper) return true;
    if (!z || !this.lastDraggingZipper) return false;
    return this.dragState.zippersEqual(z, this.lastDraggingZipper);
  }

  private buildFilteredTree(): TreeItem[] {
    const dz = this.dragState.draggingZipper;
    if (!this.dragState.rootData || !dz) return [];
    const items: TreeItem[] = [];

    // Ancestors: one entry per step along the path (not including the item itself)
    for (let i = 0; i < dz.length - 1; i++) {
      const ancestorZipper = dz.slice(0, i + 1);
      const node = this.getNodeAt(ancestorZipper);
      if (node) {
        items.push({ zipper: ancestorZipper, label: this.getLabel(node), kind: node.kind, depth: i, isAncestor: true });
      }
    }

    // Siblings: all children of the parent at the dragged depth
    const parentZipper = dz.slice(0, -1);
    const parentNode = parentZipper.length === 0
      ? this.dragState.rootData
      : this.getNodeAt(parentZipper);
    if (parentNode && parentNode.children) {
      parentNode.children.forEach((child: any, i: number) => {
        items.push({
          zipper: [...parentZipper, i],
          label: this.getLabel(child),
          kind: child.kind,
          depth: dz.length - 1,
          isAncestor: false
        });
      });
    }

    return items;
  }

  private getNodeAt(zipper: number[]): any {
    let node = this.dragState.rootData;
    for (const idx of zipper) {
      if (!node || !node.children) return null;
      node = node.children[idx];
    }
    return node;
  }

  private getLabel(node: any): string {
    switch (node.kind) {
      case 'FormteilContainer': {
        const sig = (node.data || []).find((d: any) => d.name === 'Signatur')?.data;
        const ti  = (node.data || []).find((d: any) => d.name === 'LemmatisiertesTextInitium')?.data;
        return sig || (ti ? ti.slice(0, 18) : '') || 'Section';
      }
      case 'ZeileContainer':    return 'Line';
      case 'ParatextContainer': return (node.text || '').trim().slice(0, 22) || node.paratextType || 'Paratext';
      case 'MiscContainer':     return 'Misc';
      default:                  return node.kind;
    }
  }

  // ── Insertion indicator ───────────────────────────────────────────────────

  private computeInsertAfter(): void {
    const hz = this.mapHoveredZipper ?? this.dragState.hoveredZipper;
    const dz = this.dragState.draggingZipper;
    if (!hz || !dz) { this.insertAfterIndex = -1; return; }

    // Ancestors get a "move into" visual — no insertion line
    if (hz.length < dz.length) { this.insertAfterIndex = -1; return; }

    this.insertAfterDepth = hz.length - 1;
    for (let i = 0; i < this.treeItems.length; i++) {
      if (this.dragState.zippersEqual(this.treeItems[i].zipper, hz)) {
        this.insertAfterIndex = i;
        return;
      }
    }
    this.insertAfterIndex = -1;
  }

  // ── Drop target handling ──────────────────────────────────────────────────

  onMapDragEnter(zipper: number[], ev: DragEvent): void {
    ev.preventDefault();
    this.mapHoveredZipper = zipper;
    this.computeInsertAfter();
    this.cdr.markForCheck();
  }

  onPanelDragLeave(ev: DragEvent): void {
    // Only clear when leaving the panel entirely, not when moving between rows
    const panel = ev.currentTarget as HTMLElement;
    if (!panel.contains(ev.relatedTarget as Node)) {
      this.mapHoveredZipper = null;
      this.computeInsertAfter();
      this.cdr.markForCheck();
    }
  }

  onMapDragOver(ev: DragEvent): void {
    ev.preventDefault();
  }

  onMapDrop(zipper: number[], ev: DragEvent): void {
    ev.preventDefault();
    this.mapHoveredZipper = null;
    this.dragState.dropAtZipper(zipper);
    this.cdr.markForCheck();
  }

  // ── Row state helpers ─────────────────────────────────────────────────────

  kindIcon(kind: string): string {
    switch (kind) {
      case 'FormteilContainer': return '▸';
      case 'ZeileContainer':    return '♩';
      case 'ParatextContainer': return '¶';
      case 'MiscContainer':     return '…';
      default:                  return '·';
    }
  }

  isOrigin(item: TreeItem): boolean {
    const dz = this.dragState.draggingZipper;
    return !!dz && this.dragState.zippersEqual(item.zipper, dz);
  }

  isTarget(item: TreeItem): boolean {
    const hz = this.mapHoveredZipper ?? this.dragState.hoveredZipper;
    return !!hz && this.dragState.zippersEqual(item.zipper, hz);
  }

  isValidSibling(item: TreeItem): boolean {
    return !item.isAncestor && this.dragState.isValidTarget(item.zipper);
  }
}
