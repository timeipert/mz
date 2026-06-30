import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import * as Model from '../types/model';

export interface MapDropRequest { from: number[]; to: number[]; }

@Injectable({ providedIn: 'root' })
export class DragStateService {
  draggingZipper: number[] | null = null;
  hoveredZipper: number[] | null = null;
  rootData: any = null;

  private _change = new Subject<void>();
  readonly change$ = this._change.asObservable();

  private _dropFromMap = new Subject<MapDropRequest>();
  readonly dropFromMap$ = this._dropFromMap.asObservable();

  startDrag(zipper: number[]): void {
    this.draggingZipper = [...zipper];
    this.hoveredZipper = null;
    document.body.classList.add('is-dragging');
    this._change.next();
  }

  endDrag(): void {
    this.draggingZipper = null;
    this.hoveredZipper = null;
    document.body.classList.remove('is-dragging');
    this._change.next();
  }

  setHovered(zipper: number[] | null): void {
    this.hoveredZipper = zipper;
    this._change.next();
  }

  setRootData(data: any): void {
    this.rootData = data;
  }

  dropAtZipper(to: number[]): void {
    if (this.draggingZipper) {
      this._dropFromMap.next({ from: [...this.draggingZipper], to });
      this.endDrag();
    }
  }

  /** True if candidate is a valid drop target for the dragged item. */
  isValidTarget(candidate: number[]): boolean {
    const dz = this.draggingZipper;
    if (!dz) return false;
    if (this.zippersEqual(candidate, dz)) return false;

    const root = this.rootData;
    if (!root) return false;

    const moved = Model.resolve(root, dz);
    const target = Model.resolve(root, candidate);
    if (!moved || !target) return false;

    if (moved.kind === Model.ContainerKind.ZeileContainer) {
      if (target.kind === Model.ContainerKind.ZeileContainer) {
        return true;
      }
      if (target.kind === Model.ContainerKind.FormteilContainer) {
        const docStruct = Model.getStructure(root.documentType);
        const limit = docStruct[candidate.length - 1];
        return !!(limit && limit.canHaveLines);
      }
    }

    if (moved.kind === Model.ContainerKind.FormteilContainer) {
      if (target.kind === Model.ContainerKind.FormteilContainer) {
        return candidate.length === dz.length;
      }
    }

    if (moved.kind === Model.ContainerKind.ParatextContainer) {
      if (target.kind === Model.ContainerKind.ParatextContainer || target.kind === Model.ContainerKind.ZeileContainer) {
        return candidate.length === dz.length;
      }
      if (target.kind === Model.ContainerKind.FormteilContainer) {
        return true;
      }
    }

    if (candidate.length !== dz.length) return false;
    for (let i = 0; i < dz.length - 1; i++) {
      if (candidate[i] !== dz[i]) return false;
    }
    return true;
  }

  zippersEqual(a: number[], b: number[]): boolean {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
}

