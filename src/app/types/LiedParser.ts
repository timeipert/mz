import * as P from 'parsimmon'
import * as PP from './parsers'
import * as M from './model';
import { v4 as UUID } from "uuid";

export function liedParser(): P.Parser<M.RootContainer>{
  const rootContainer = M.emptyRootContainer();
  rootContainer.documentType = M.DocumentType.Level2;
  return partParser().sepBy(P.end.or(P.newline).trim(P.regexp(/ */))).map(lines => {
    rootContainer.children = lines;
    return rootContainer;
  })
}

function partParser(): P.Parser<M.FormteilContainer>{
  return P.alt(
    stropheParser().map(vg => makeStrophe(vg.prefix, vg.lines)),
    PP.paratextParser()
  );
}

function stropheParser(prefix?: string): P.Parser<Versgruppe> {
  return P.seqMap(
    prefix === undefined ? P.regex(/[IVXQCL]+/) : P.string(prefix),
    P.regex(/[1-9][0-9]\t*/).map(t => t.trim()),
    PP.lineContainerParser(),
    (pref, num, children) => ({ prefix: pref, lines: [makeVersgruppe(num, children)] })
  ).chain(head => P.alt(P.newline.then(stropheParser(head.prefix)), P.succeed(null)).map(tail => {
    if (tail === null) {
      return head;
    } else {
      return {
        prefix: head.prefix,
        lines: head.lines.concat(tail.lines)
      };
    }
  }));
}

interface Versgruppe {
  prefix: string;
  lines: M.FormteilContainer[];
}

function makeStrophe(prefix: string, children: M.FormteilContainer[]): M.FormteilContainer {
  return {
    kind: M.ContainerKind.FormteilContainer,
    data: [{
      name: M.FormteilDataName.Signatur,
      data: prefix,
    }],
    uuid: UUID(),
    children: children
  }
}

function makeVersgruppe(num: string, lines: M.ZeileContainer[]): M.FormteilContainer {
  return {
    kind: M.ContainerKind.FormteilContainer,
    data: [{
      name: M.FormteilDataName.Signatur,
      data: num,
    }],
    uuid: UUID(),
    children: lines
  }
}

