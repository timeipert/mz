import { FocusShiftRequested } from './CommonEvent';
import { getCaret } from '../../utils';

export enum Focus {
  Notes = "Notes",
  Code = "Code",
  Text = "Text"
};

export interface FocusChange {
  preferredLevel?: Focus;
  focusLast: boolean;
}

export interface Focusable {
  focus(change: FocusChange): void;
  getData(): any;
}

export function handleTextInputMove(element: HTMLElement, event: KeyboardEvent, emitter: (r: FocusShiftRequested) => void): void {
  const text = element.textContent || '';
  const caretPos = getCaret(element);
  const moveLeft = event.key == "ArrowLeft" && caretPos === 0;
  const moveRight = event.key == "ArrowRight" && caretPos === text.length;
  if (moveLeft) { event.preventDefault(); emitter({ kind: 'FocusShiftRequested', change: { focusLast: true }, direction: -1 }); }
  else if (moveRight) { event.preventDefault(); emitter({ kind: 'FocusShiftRequested', change: { focusLast: false }, direction: +1 }); }
}

