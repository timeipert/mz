import { 
  RootContainer, 
  ContainerKind, 
  LinePartKind, 
  ZeileContainer, 
  Syllable, 
  Clef, 
  Note, 
  FormteilContainer, 
  MiscContainer,
  NoteType
} from '../types/model';
import { Document as MonodiDocument } from '../api.service';
import { 
  MeiMappingProfileV2, 
  MeiEntityKey, 
  MeiEntityRule 
} from './mei-mapping.model';

export function resolveFormteilFields(formteil: FormteilContainer): Record<string, string> {
  const res: Record<string, string> = { uuid: formteil.uuid };
  if (formteil.data) {
    for (const d of formteil.data) {
      if (d.name === 'Signatur' && d.data) {
        res['signature'] = d.data;
      } else if (d.name === 'LemmatisiertesTextInitium' && d.data) {
        res['n'] = d.data;
      } else if (d.name === 'Status' && d.data) {
        res['status'] = d.data;
      }
    }
  }
  return res;
}

export function resolveClefFields(clef: Clef): Record<string, string> {
  return {
    uuid: clef.uuid,
    shape: clef.shape ? clef.shape.toUpperCase() : 'C'
  };
}

export function resolveNoteFields(note: Note, isConnectionGap: boolean, connectionGapValue: string = 'g'): Record<string, string> {
  const res: Record<string, string> = {
    uuid: note.uuid,
    base: note.base ? note.base.toLowerCase() : '',
    octave: note.octave !== undefined ? note.octave.toString() : ''
  };
  if (isConnectionGap) {
    res['connectionGap'] = connectionGapValue;
  }
  return res;
}

function generateCommentTreeDOM(
  tree: any, 
  doc: Document, 
  commentIndex: number, 
  noteCounter: { count: number }
): { element: Element | null, zeilen: { id: string, zeile: ZeileContainer }[] } {
  if (!tree) return { element: null, zeilen: [] };
  if (tree.kind === "CommentTreeUndecided") return { element: null, zeilen: [] };
  
  if (tree.kind === "CommentTreeGrid") {
    const table = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'table');
    let zeilen: { id: string, zeile: ZeileContainer }[] = [];
    if (tree.items) {
      for (const row of tree.items) {
        const tr = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'tr');
        for (const cell of row) {
          const td = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'td');
          const cellResult = generateCommentTreeDOM(cell, doc, commentIndex, noteCounter);
          if (cellResult.element) {
            td.appendChild(cellResult.element);
          }
          tr.appendChild(td);
          zeilen.push(...cellResult.zeilen);
        }
        table.appendChild(tr);
      }
    }
    return { element: table, zeilen };
  }
  
  if (tree.kind === "CommentTreeLeaf") {
    if (tree.content) {
      if (tree.content.kind === "Text") {
        const rend = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'rend');
        rend.textContent = tree.content.content;
        return { element: rend, zeilen: [] };
      } else if (tree.content.kind === "Bracket") {
        const rend = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'rend');
        rend.textContent = ']';
        return { element: rend, zeilen: [] };
      } else if (tree.content.kind === "Notes") {
        const id = `m-comment-${commentIndex}-notes-${noteCounter.count++}`;
        const ptr = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'ptr');
        ptr.setAttribute('target', '#' + id);
        return { 
          element: ptr, 
          zeilen: [{ id, zeile: tree.content.content }] 
        };
      }
    }
  }
  return { element: null, zeilen: [] };
}

function getOrCreateWrapper(parent: Element, wrapperTag: string, doc: Document): Element {
  let existing = parent.querySelector(`:scope > ${wrapperTag}`);
  if (!existing) {
    existing = doc.createElementNS('http://www.music-encoding.org/ns/mei', wrapperTag);
    if (wrapperTag === 'staff' || wrapperTag === 'layer') {
      existing.setAttribute('n', '1');
    }
    parent.appendChild(existing);
  }
  return existing;
}

export function emitMei(root: RootContainer, profile: MeiMappingProfileV2, documentMeta?: MonodiDocument): string {
  const doc = document.implementation.createDocument('http://www.music-encoding.org/ns/mei', 'mei', null);
  const mei = doc.documentElement;
  mei.setAttribute('meiversion', '5.0');

  // 1. Emit Header (Verbatim)
  if (profile.emitHeader) {
    const meiHead = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'meiHead');
    const fileDesc = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'fileDesc');
    const titleStmt = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'titleStmt');
    const title = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'title');
    title.textContent = documentMeta?.dokumenten_id || 'Exported from Monodi+';
    titleStmt.appendChild(title);
    fileDesc.appendChild(titleStmt);
    
    const pubStmt = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'pubStmt');
    fileDesc.appendChild(pubStmt);
    
    if (documentMeta && documentMeta.kommentar) {
        const notesStmt = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'notesStmt');
        const annot = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'annot');
        annot.textContent = documentMeta.kommentar;
        notesStmt.appendChild(annot);
        fileDesc.appendChild(notesStmt);
    } else if (root.comments && root.comments.length > 0) {
        const notesStmt = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'notesStmt');
        fileDesc.appendChild(notesStmt);
    }
    
    if (root.comments && root.comments.length > 0) {
        let notesStmt = fileDesc.getElementsByTagNameNS('http://www.music-encoding.org/ns/mei', 'notesStmt')[0];
        if (!notesStmt) {
            notesStmt = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'notesStmt');
            fileDesc.appendChild(notesStmt);
        }
        for (let i = 0; i < root.comments.length; i++) {
            const comment = root.comments[i];
            const annot = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'annot');
            annot.setAttribute('startid', '#m-' + comment.startUUID);
            annot.setAttribute('endid', '#m-' + comment.endUUID);
            if (comment.emendation) {
                annot.setAttribute('type', 'emendation');
            }
            let treeResult = { element: null as Element | null, zeilen: [] as { id: string, zeile: ZeileContainer }[] };
            if (comment.tree) {
                const noteCounter = { count: 0 };
                treeResult = generateCommentTreeDOM(comment.tree, doc, i, noteCounter);
            }
            
            const hasMusicalStructure = (comment.lines && comment.lines.length > 0) || treeResult.zeilen.length > 0;
            if (hasMusicalStructure) {
                annot.setAttribute('corresp', '#m-comment-' + i);
            }
            
            if (treeResult.element) {
                annot.appendChild(treeResult.element);
            } else if (comment.text) {
                annot.textContent = comment.text;
            }
            
            notesStmt.appendChild(annot);
        }
    }
    
    meiHead.appendChild(fileDesc);
    
    if (documentMeta && (documentMeta.textinitium || documentMeta.gattung1 || documentMeta.gattung2 || documentMeta.festtag || documentMeta.feier)) {
        const workList = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'workList');
        const work = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'work');
        
        if (documentMeta.textinitium) {
            const workTitle = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'title');
            workTitle.textContent = documentMeta.textinitium;
            work.appendChild(workTitle);
        }
        
        if (documentMeta.gattung1 || documentMeta.gattung2 || documentMeta.festtag || documentMeta.feier) {
            const classification = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'classification');
            const termList = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'termList');
            
            const addTerm = (termText: string, type: string) => {
                if (termText) {
                    const term = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'term');
                    term.setAttribute('type', type);
                    term.textContent = termText;
                    termList.appendChild(term);
                }
            };
            
            addTerm(documentMeta.gattung1, 'gattung1');
            addTerm(documentMeta.gattung2, 'gattung2');
            addTerm(documentMeta.festtag, 'festtag');
            addTerm(documentMeta.feier, 'feier');
            
            classification.appendChild(termList);
            work.appendChild(classification);
        }
        
        workList.appendChild(work);
        meiHead.appendChild(workList);
    }
    mei.appendChild(meiHead);
  }

  // 2. Build Skeleton
  let skeletonEnd: Element = mei;
  let bodyElement: Element | null = null;
  for (const tag of profile.skeleton) {
    const el = doc.createElementNS('http://www.music-encoding.org/ns/mei', tag);
    if (tag === 'mdiv') {
      el.setAttribute('type', 'main');
    }
    skeletonEnd.appendChild(el);
    skeletonEnd = el;
    if (tag === 'body') {
      bodyElement = el;
    }
  }

  // Score level scoreDef (must append before content)
  const scoreDef = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'scoreDef');
  skeletonEnd.appendChild(scoreDef);

  // 3. Emit Root Container Element (acting as top-level formteil)
  const rootRule = profile.entities.formteil;
  const rootEl = doc.createElementNS('http://www.music-encoding.org/ns/mei', rootRule.tag);
  rootEl.setAttribute('xml:id', 'm-' + root.uuid);
  skeletonEnd.appendChild(rootEl);

  // Walk Root Container
  if (root.children) {
    for (const child of root.children) {
      if (child.kind === ContainerKind.FormteilContainer) {
        walkFormteil(child, rootEl, doc, profile);
      } else if (child.kind === ContainerKind.MiscContainer) {
        walkMisc(child, rootEl, doc, profile);
      }
    }
  }

  // 4. Process structural comments into appendixed mdivs (Verbatim)
  if (bodyElement && root.comments && root.comments.length > 0) {
    for (let i = 0; i < root.comments.length; i++) {
        const comment = root.comments[i];
        let treeResult = { element: null as Element | null, zeilen: [] as { id: string, zeile: ZeileContainer }[] };
        if (comment.tree) {
            const noteCounter = { count: 0 };
            treeResult = generateCommentTreeDOM(comment.tree, doc, i, noteCounter);
        }
        
        const hasMusicalStructure = (comment.lines && comment.lines.length > 0) || treeResult.zeilen.length > 0;
        
        if (hasMusicalStructure) {
            const commentMdiv = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'mdiv');
            commentMdiv.setAttribute('type', 'commentary');
            commentMdiv.setAttribute('xml:id', 'm-comment-' + i);
            
            const commentScore = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'score');
            const commentScoreDef = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'scoreDef');
            commentScore.appendChild(commentScoreDef);
            
            if (comment.lines && comment.lines.length > 0) {
                const commentSection = doc.createElementNS('http://www.music-encoding.org/ns/mei', profile.entities.formteil.tag);
                let currentStaff: Element | null = null;
                let currentLayer: Element | null = null;
                for (const child of comment.lines) {
                    if (child.kind === ContainerKind.FormteilContainer) {
                        walkFormteil(child, commentSection, doc, profile);
                    } else if (child.kind === ContainerKind.ZeileContainer) {
                        if (!currentStaff) {
                          currentStaff = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'staff');
                          currentStaff.setAttribute('n', '1');
                          currentLayer = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'layer');
                          currentLayer.setAttribute('n', '1');
                          currentStaff.appendChild(currentLayer);
                          commentSection.appendChild(currentStaff);
                        }
                        walkZeile(child, currentLayer!, doc, profile);
                    }
                }
                commentScore.appendChild(commentSection);
            }
            
            if (treeResult.zeilen.length > 0) {
                for (const zItem of treeResult.zeilen) {
                    const ptrSection = doc.createElementNS('http://www.music-encoding.org/ns/mei', profile.entities.formteil.tag);
                    ptrSection.setAttribute('xml:id', zItem.id);
                    const currentStaff = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'staff');
                    currentStaff.setAttribute('n', '1');
                    const currentLayer = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'layer');
                    currentLayer.setAttribute('n', '1');
                    currentStaff.appendChild(currentLayer);
                    ptrSection.appendChild(currentStaff);
                    
                    walkZeile(zItem.zeile, currentLayer, doc, profile);
                    commentScore.appendChild(ptrSection);
                }
            }
            
            commentMdiv.appendChild(commentScore);
            bodyElement.appendChild(commentMdiv);
        }
    }
  }

  const serializer = new XMLSerializer();
  let xmlString = serializer.serializeToString(mei);
  
  const header = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<?xml-model href="https://music-encoding.org/schema/dev/mei-Neumes.rng" type="application/xml" schematypens="http://relaxng.org/ns/structure/1.0"?>\n` +
    `<?xml-model href="https://music-encoding.org/schema/dev/mei-Neumes.rng" type="application/xml" schematypens="http://purl.oclc.org/dsdl/schematron"?>\n`;
  
  return header + xmlString;
}

function applyAttributes(
  element: Element, 
  rule: MeiEntityRule, 
  resolvedFields: Record<string, string>, 
  customHandler?: (ruleName: string) => string | null
) {
  for (const attrRule of rule.attributes) {
    let val = '';
    if (attrRule.source === 'field') {
      val = resolvedFields[attrRule.value] || '';
    } else {
      val = attrRule.value;
    }

    if (customHandler) {
      const handlerVal = customHandler(attrRule.name);
      if (handlerVal !== null) {
        val = handlerVal;
      }
    }

    if (val !== '' || !attrRule.omitIfEmpty) {
      element.setAttribute(attrRule.name, val);
    }
  }
}

function walkMisc(misc: MiscContainer, parentElement: Element, doc: Document, profile: MeiMappingProfileV2) {
  if (!misc.children) return;
  for (const child of misc.children) {
    if (child.kind === ContainerKind.ZeileContainer) {
      walkZeile(child, parentElement, doc, profile);
    }
  }
}

function walkFormteil(formteil: FormteilContainer, parentElement: Element, doc: Document, profile: MeiMappingProfileV2) {
  const rule = profile.entities.formteil;
  if (!rule.enabled) {
    // Flatten children
    if (formteil.children) {
      for (const child of formteil.children) {
        if (child.kind === ContainerKind.FormteilContainer) {
          walkFormteil(child, parentElement, doc, profile);
        } else if (child.kind === ContainerKind.ZeileContainer) {
          walkZeile(child, parentElement, doc, profile);
        }
      }
    }
    return;
  }

  const section = doc.createElementNS('http://www.music-encoding.org/ns/mei', rule.tag);
  section.setAttribute('xml:id', 'm-' + formteil.uuid);

  const fields = resolveFormteilFields(formteil);
  applyAttributes(section, rule, fields);

  // Verbatim Signatur annotations, Verweis, etc.
  if (formteil.data) {
    for (const d of formteil.data) {
      if (d.name === 'Verweis' && d.data) {
        const annot = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'annot');
        annot.setAttribute('type', 'verweis');
        annot.textContent = d.data;
        section.appendChild(annot);
      }
    }
  }

  // Resolve wrappers outermost-first
  let targetParent = parentElement;
  for (const w of rule.wrappers) {
    targetParent = getOrCreateWrapper(targetParent, w, doc);
  }
  targetParent.appendChild(section);

  if (formteil.children) {
    for (const child of formteil.children) {
      if (child.kind === ContainerKind.FormteilContainer) {
        walkFormteil(child, section, doc, profile);
      } else if (child.kind === ContainerKind.ZeileContainer) {
        walkZeile(child, section, doc, profile);
      }
    }
  }
}

function walkZeile(zeile: ZeileContainer, parentElement: Element, doc: Document, profile: MeiMappingProfileV2) {
  const rule = profile.entities.zeile;
  if (!rule.enabled) {
    // Flatten children
    if (zeile.children) {
      for (const part of zeile.children) {
        walkLinePart(part, parentElement, doc, profile);
      }
    }
    return;
  }

  // Resolve wrappers outermost-first
  let targetParent = parentElement;
  for (const w of rule.wrappers) {
    targetParent = getOrCreateWrapper(targetParent, w, doc);
  }

  const sb = doc.createElementNS('http://www.music-encoding.org/ns/mei', rule.tag);
  sb.setAttribute('xml:id', 'm-' + zeile.uuid);
  applyAttributes(sb, rule, { uuid: zeile.uuid });
  targetParent.appendChild(sb);

  if (zeile.children) {
    for (const part of zeile.children) {
      walkLinePart(part, targetParent, doc, profile);
    }
  }
}

function walkLinePart(part: any, parentElement: Element, doc: Document, profile: MeiMappingProfileV2) {
  if (part.kind === LinePartKind.Clef) {
    const rule = profile.entities.clef;
    if (!rule.enabled) return;

    // Resolve wrappers outermost-first
    let targetParent = parentElement;
    for (const w of rule.wrappers) {
      targetParent = getOrCreateWrapper(targetParent, w, doc);
    }

    const clef = doc.createElementNS('http://www.music-encoding.org/ns/mei', rule.tag);
    clef.setAttribute('xml:id', 'm-' + part.uuid);
    const fields = resolveClefFields(part);
    applyAttributes(clef, rule, fields);
    targetParent.appendChild(clef);

  } else if (part.kind === LinePartKind.Syllable) {
    const rule = profile.entities.syllable;
    if (!rule.enabled) {
      // Walk notes directly under parentElement
      walkSyllableNotes(part, parentElement, doc, profile);
      return;
    }

    // Resolve wrappers outermost-first
    let targetParent = parentElement;
    for (const w of rule.wrappers) {
      targetParent = getOrCreateWrapper(targetParent, w, doc);
    }

    const syllable = doc.createElementNS('http://www.music-encoding.org/ns/mei', rule.tag);
    syllable.setAttribute('xml:id', 'm-' + part.uuid);
    applyAttributes(syllable, rule, { uuid: part.uuid });

    // syllableText inner tag
    const textRule = profile.entities.syllableText;
    if (textRule.enabled && part.text) {
      const syl = doc.createElementNS('http://www.music-encoding.org/ns/mei', textRule.tag);
      syl.textContent = part.text;
      applyAttributes(syl, textRule, { text: part.text, uuid: part.uuid });
      syllable.appendChild(syl);
    }

    // Walk notes under the syllable element
    walkSyllableNotes(part, syllable, doc, profile);

    targetParent.appendChild(syllable);

  } else if (part.kind === ContainerKind.ParatextContainer || (part.text !== undefined && part.paratextType !== undefined)) {
    // ParatextContainer
    const rule = profile.entities.paratext;
    if (!rule.enabled) return;

    // Resolve wrappers outermost-first
    let targetParent = parentElement;
    for (const w of rule.wrappers) {
      targetParent = getOrCreateWrapper(targetParent, w, doc);
    }

    const dir = doc.createElementNS('http://www.music-encoding.org/ns/mei', rule.tag);
    dir.setAttribute('xml:id', 'm-' + part.uuid);
    applyAttributes(dir, rule, { text: part.text || '', paratextType: part.paratextType || '', uuid: part.uuid });
    if (rule.textFrom === 'text') {
      dir.textContent = part.text || '';
    }
    targetParent.appendChild(dir);
  }
}

function walkSyllableNotes(syllable: Syllable, parentElement: Element, doc: Document, profile: MeiMappingProfileV2) {
  if (!syllable.notes || !syllable.notes.spaced) return;

  for (const neumeData of syllable.notes.spaced) {
    if (!neumeData.nonSpaced || neumeData.nonSpaced.length === 0) continue;

    const neumeRule = profile.entities.neume;
    let targetParent = parentElement;

    if (neumeRule.enabled) {
      // Resolve wrappers outermost-first
      for (const w of neumeRule.wrappers) {
        targetParent = getOrCreateWrapper(targetParent, w, doc);
      }
      const neume = doc.createElementNS('http://www.music-encoding.org/ns/mei', neumeRule.tag);
      applyAttributes(neume, neumeRule, {});
      parentElement.appendChild(neume);
      targetParent = neume;
    }

    for (let gIndex = 0; gIndex < neumeData.nonSpaced.length; gIndex++) {
      const groupedData = neumeData.nonSpaced[gIndex];
      if (!groupedData.grouped || groupedData.grouped.length === 0) continue;

      for (let nIndex = 0; nIndex < groupedData.grouped.length; nIndex++) {
        const note = groupedData.grouped[nIndex];

        let entityKey: MeiEntityKey = 'note';
        if (note.noteType === NoteType.Oriscus) {
          entityKey = 'oriscus';
        } else if (note.noteType === NoteType.Quilisma) {
          entityKey = 'quilisma';
        } else if (note.noteType === NoteType.Strophicus) {
          entityKey = 'strophicus';
        } else if (note.noteType === NoteType.Liquescent || note.liquescent) {
          entityKey = 'liquescent';
        }

        const noteRule = profile.entities[entityKey];
        if (!noteRule.enabled) continue;

        // Resolve wrappers outermost-first
        let noteTargetParent = targetParent;
        for (const w of noteRule.wrappers) {
          noteTargetParent = getOrCreateWrapper(noteTargetParent, w, doc);
        }

        const nc = doc.createElementNS('http://www.music-encoding.org/ns/mei', noteRule.tag);
        nc.setAttribute('xml:id', 'm-' + note.uuid);

        const isConnectionGap = (nIndex === groupedData.grouped.length - 1 && gIndex < neumeData.nonSpaced.length - 1);
        
        // Find custom attribute name mappings for curve/con rules to perform proper conditional checks
        const liquescentRule = noteRule.attributes[2];
        const connectionRule = noteRule.attributes[3];
        const liquescentAttrName = liquescentRule?.name || 'curve';
        const connectionAttrName = connectionRule?.name || 'con';
        const connectionGapValue = connectionRule?.value || 'g';

        const fields = resolveNoteFields(note, isConnectionGap, connectionGapValue);

        applyAttributes(nc, noteRule, fields, (ruleName) => {
          if (ruleName === liquescentAttrName && (!note.liquescent || nc.tagName === profile.entities.liquescent.tag)) {
            return ''; // Omit liquescent attribute if not liquescent or tag is liquescent
          }
          if (ruleName === connectionAttrName && !isConnectionGap) {
            return ''; // Omit connection attribute if not at connection gap
          }
          return null; // Keep resolved default
        });

        noteTargetParent.appendChild(nc);
      }
    }
  }
}
