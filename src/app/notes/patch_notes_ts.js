const fs = require('fs');
const path = '/Users/timeipert/Documents/Antigrav/monodi-light/src/app/notes/notes.component.ts';
let content = fs.readFileSync(path, 'utf8');

// ViewChild to ViewChildren
content = content.replace(
  "@ViewChild('noteText', { static: true }) noteTextElement!: ElementRef;",
  "@ViewChildren('noteText') noteTextElements!: QueryList<ElementRef>;"
);
content = content.replace(
  "@ViewChild('notesDiv', { static: true }) notesDiv!: ElementRef;",
  "@ViewChildren('notesDiv') notesDivElements!: QueryList<ElementRef>;"
);

// Import QueryList
content = content.replace(
  "ChangeDetectorRef, Component, OnInit,",
  "ChangeDetectorRef, Component, OnInit, QueryList,"
);

// Drawables cache and focus array
content = content.replace(
  "drawablesCache: Drawable[] = [];",
  "drawablesCache: Drawable[][] = [];"
);
content = content.replace(
  "hasFocus = false;",
  "hasFocus: boolean[] = [];\n  focusedVoiceIndex = 0;"
);
content = content.replace(
  "this.hasFocus = focus;",
  "// replaced later"
);

// getVoices
const getVoicesStr = `
  getVoices(): VM.Spaced[] {
    const voices = [this.model.notes];
    if (this.model.additionalMelodies) {
      voices.push(...this.model.additionalMelodies);
    }
    return voices;
  }
`;
content = content.replace(
  "getActiveComments(): VM.Comment[] {",
  getVoicesStr + "\n  getActiveComments(): VM.Comment[] {"
);

// getDrawables
content = content.replace(
  "getDrawables(): Drawable[] {\n    const newModelString = JSON.stringify([this.model, this.comments]);\n    if (this.lastModelString === newModelString) {\n      return this.drawablesCache;\n    } else {\n      this.lastModelString = newModelString;\n      this.drawablesCache = fromSpaced(this.model.notes, this.comments);\n      return this.drawablesCache;\n    }\n  }",
  `getDrawables(voiceIndex: number = 0): Drawable[] {
    const newModelString = JSON.stringify([this.model, this.comments]);
    if (this.lastModelString === newModelString) {
      return this.drawablesCache[voiceIndex] || [];
    } else {
      this.lastModelString = newModelString;
      import { fromSpaceds } from './Drawables'; // we already imported fromSpaced
      // let's do this at top level
    }
  }`
);
fs.writeFileSync(path, content, 'utf8');
