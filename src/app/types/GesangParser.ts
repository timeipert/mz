import * as P from 'parsimmon'
import * as PP from './parsers'
import * as M from './model';
import { v4 as UUID } from "uuid";

export function gesangParser(): P.Parser<M.RootContainer>{
  const rootContainer = M.emptyRootContainer();
  rootContainer.documentType = M.DocumentType.Level1;
  return partParser().sepBy(P.end.or(P.newline).trim(P.regexp(/ */))).map(lines => {
    rootContainer.children = lines;
    return rootContainer;
  })
}

function partParser(): P.Parser<M.FormteilContainer>{
  return P.alt(
    lineParser(),
    PP.paratextParser()
  );
}

function lineParser(): P.Parser<M.FormteilContainer> {
  return P.seqMap(
    P.regex(/[a-zA-Z0-9]*\t*/).map(t => t.trim()),
    PP.lineContainerParser(),
    (pref, children) => makeLine(pref, children)
  );
}

function makeLine(prefix: string, children: M.ZeileContainer[]): M.FormteilContainer {
  return {
    kind: M.ContainerKind.FormteilContainer,
    data: [{
      name: M.FormteilDataName.Signatur,
      data: prefix
    }],
    uuid: UUID(),
    children: children
  }
}
