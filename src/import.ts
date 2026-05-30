import * as bufferModule from 'buffer';
const b = bufferModule.Buffer || (bufferModule as any).default?.Buffer || bufferModule;
if (typeof window !== 'undefined') {
  (window as any).Buffer = b;
}
if (typeof global !== 'undefined') {
  (global as any).Buffer = b;
}
