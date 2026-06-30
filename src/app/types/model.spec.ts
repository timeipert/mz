import { move, ContainerKind, RootContainer, FormteilContainer, ParatextContainer, ParatextType, DocumentType, applyCommentTreeEvent, emptyCommentTree, CommentTree, changeDocumentStructure, fixSyllableDashes, SyllableType, LinePartKind } from './model';

describe('Model Hierarchy (move logic)', () => {
    let root: RootContainer;
    let l1: FormteilContainer;
    let pt: ParatextContainer;

    beforeEach(() => {
        pt = {
            kind: ContainerKind.ParatextContainer,
            uuid: 'pt-1',
            text: 'Heading',
            retro: false,
            paratextType: ParatextType.Festtag
        };

        l1 = {
            kind: ContainerKind.FormteilContainer,
            uuid: 'l1-1',
            children: [],
            data: []
        };

        root = {
            kind: ContainerKind.RootContainer,
            uuid: 'root-1',
            documentType: DocumentType.Level1,
            comments: [],
            children: [pt as any, l1]
        };
    });

    it('should allow moving a FormteilContainer to another index in Root', () => {
        // move l1 after pt
        // movedZ: [1] (l1)
        // afterZ: [0] (pt)
        const err = move(root, [1], [0]);
        expect(err).toBeUndefined();
        expect(root.children[0].uuid).toBe('pt-1');
        expect(root.children[1].uuid).toBe('l1-1');
    });

    it('should NOT allow moving a RootContainer', () => {
        // Attempting to move root into l1
        const err = move(root, [], [0]);
        expect(err).toBe('The Edition unit cannot be moved.');
    });

    it('should allow moving a FormteilContainer after a Paratext on Root level', () => {
        const l1_second: FormteilContainer = {
            kind: ContainerKind.FormteilContainer,
            uuid: 'l1-2',
            children: [],
            data: []
        };
        root.children.unshift(l1_second); // root is now [l1-2, pt, l1-1]
        
        // move l1_second after pt
        // movedZ: [0] (l1-2)
        // afterZ: [1] (pt)
        const err = move(root, [0], [1]);
        expect(err).toBeUndefined();
        expect(root.children[0].uuid).toBe('pt-1');
        expect(root.children[1].uuid).toBe('l1-2');
        expect(root.children[2].uuid).toBe('l1-1');
    });
});

describe('applyCommentTreeEvent', () => {
    it('should turn undecided node into grid via BecomeGrid', () => {
        let tree: CommentTree = emptyCommentTree();
        expect(tree.kind).toBe("CommentTreeUndecided");
        
        tree = applyCommentTreeEvent(tree, {
            source: [],
            intent: { kind: "BecomeGrid" }
        });
        
        expect(tree.kind).toBe("CommentTreeGrid");
        const grid = tree as any;
        expect(grid.items.length).toBe(1);
        expect(grid.items[0].length).toBe(1);
        expect(grid.items[0][0].kind).toBe("CommentTreeUndecided");
    });

    it('should turn undecided node into leaf text via BecomeLeaf', () => {
        let tree: CommentTree = emptyCommentTree();
        tree = applyCommentTreeEvent(tree, {
            source: [],
            intent: {
                kind: "BecomeLeaf",
                content: { kind: "Text", content: "original text commentary" }
            }
        });
        
        expect(tree.kind).toBe("CommentTreeLeaf");
        const leaf = tree as any;
        expect(leaf.content.kind).toBe("Text");
        expect(leaf.content.content).toBe("original text commentary");
    });

    it('should update leaf content text via UpdateContent', () => {
        let tree: CommentTree = emptyCommentTree();
        tree = applyCommentTreeEvent(tree, {
            source: [],
            intent: {
                kind: "BecomeLeaf",
                content: { kind: "Text", content: "original text" }
            }
        });
        
        tree = applyCommentTreeEvent(tree, {
            source: [],
            intent: {
                kind: "UpdateContent",
                content: { kind: "Text", content: "updated text" }
            }
        });
        
        const leaf = tree as any;
        expect(leaf.content.content).toBe("updated text");
    });

    it('should resize grid dimension via AddRow and AddColumn', () => {
        let tree: CommentTree = emptyCommentTree();
        tree = applyCommentTreeEvent(tree, { source: [], intent: { kind: "BecomeGrid" } }); // 1x1 grid
        
        tree = applyCommentTreeEvent(tree, { source: [], intent: { kind: "AddRow" } }); // 2x1 grid
        let grid = tree as any;
        expect(grid.items.length).toBe(2);
        expect(grid.items[0].length).toBe(1);
        
        tree = applyCommentTreeEvent(tree, { source: [], intent: { kind: "AddColumn" } }); // 2x2 grid
        grid = tree as any;
        expect(grid.items.length).toBe(2);
        expect(grid.items[0].length).toBe(2);
        expect(grid.items[1].length).toBe(2);
    });

    it('should delete rows and columns via DeleteRow and DeleteColumn', () => {
        let tree: CommentTree = emptyCommentTree();
        tree = applyCommentTreeEvent(tree, { source: [], intent: { kind: "BecomeGrid" } }); // 1x1 grid
        tree = applyCommentTreeEvent(tree, { source: [], intent: { kind: "AddRow" } }); // 2x1 grid
        
        tree = applyCommentTreeEvent(tree, { source: [], intent: { kind: "DeleteRow", index: 0 } });
        let grid = tree as any;
        expect(grid.items.length).toBe(1);
        
        tree = applyCommentTreeEvent(tree, { source: [], intent: { kind: "AddColumn" } }); // 1x2 grid
        tree = applyCommentTreeEvent(tree, { source: [], intent: { kind: "DeleteColumn", index: 0 } });
        grid = tree as any;
        expect(grid.items[0].length).toBe(1);
    });

    it('should set node justification via SetJustification', () => {
        let tree: CommentTree = emptyCommentTree();
        tree = applyCommentTreeEvent(tree, {
            source: [],
            intent: {
                kind: "BecomeLeaf",
                content: { kind: "Text", content: "lemma text" }
            }
        });
        
        tree = applyCommentTreeEvent(tree, {
            source: [],
            intent: { kind: "SetJustification", justification: { kind: "Right" } }
        });
        
        const leaf = tree as any;
        expect(leaf.justification).toEqual({ kind: "Right" });
    });

    it('should apply events recursively down nested paths inside a grid', () => {
        let tree: CommentTree = emptyCommentTree();
        tree = applyCommentTreeEvent(tree, { source: [], intent: { kind: "BecomeGrid" } }); // 1x1 grid
        
        // Mutate grid cell at [0,0] to a leaf
        tree = applyCommentTreeEvent(tree, {
            source: [[0, 0]],
            intent: {
                kind: "BecomeLeaf",
                content: { kind: "Text", content: "nested leaf text" }
            }
        });
        
        const grid = tree as any;
        expect(grid.items[0][0].kind).toBe("CommentTreeLeaf");
        expect(grid.items[0][0].content.content).toBe("nested leaf text");
    });

    it('should throw error when applying grid actions to non-grid nodes', () => {
        let tree: CommentTree = emptyCommentTree();
        // tree is Undecided, which is non-grid
        expect(() => {
            applyCommentTreeEvent(tree, { source: [], intent: { kind: "AddRow" } });
        }).toThrowError(/Cannot apply event.*to non-grid node/);
    });
});

describe('changeDocumentStructure', () => {
    it('should restructure Level 1 -> Level 2 -> Level 3 and back to Level 1 losslessly', () => {
        const line1 = { kind: ContainerKind.ZeileContainer, uuid: 'line-1', children: [] };
        const line2 = { kind: ContainerKind.ZeileContainer, uuid: 'line-2', children: [] };
        const pt = { kind: ContainerKind.ParatextContainer, uuid: 'pt-1', text: 'Para text', retro: false, paratextType: ParatextType.Gesang };
        
        const l1_container: FormteilContainer = {
            kind: ContainerKind.FormteilContainer,
            uuid: 'l1-container',
            children: [line1 as any, line2 as any, pt as any],
            data: []
        };

        const root: RootContainer = {
            kind: ContainerKind.RootContainer,
            uuid: 'root',
            documentType: DocumentType.Level1,
            comments: [],
            children: [l1_container]
        };

        // Level 1 -> Level 2
        changeDocumentStructure(root, DocumentType.Level2);
        expect(root.children.length).toBe(1);
        const l1 = root.children[0] as FormteilContainer;
        expect(l1.uuid).toBe('l1-container');
        expect(l1.children.length).toBe(1);
        const l2 = l1.children[0] as FormteilContainer;
        expect(l2.kind).toBe(ContainerKind.FormteilContainer);
        expect(l2.children.length).toBe(3);
        expect(l2.children[0].uuid).toBe('line-1');
        expect(l2.children[1].uuid).toBe('line-2');
        expect(l2.children[2].uuid).toBe('pt-1');

        // Level 2 -> Level 3
        changeDocumentStructure(root, DocumentType.Level3);
        expect(l2.children.length).toBe(1);
        const l3 = l2.children[0] as FormteilContainer;
        expect(l3.kind).toBe(ContainerKind.FormteilContainer);
        expect(l3.children.length).toBe(3);
        expect(l3.children[0].uuid).toBe('line-1');

        // Level 3 -> Level 2
        changeDocumentStructure(root, DocumentType.Level2);
        expect(l2.children.length).toBe(3);
        expect(l2.children[0].uuid).toBe('line-1');
        expect(l2.children[1].uuid).toBe('line-2');
        expect(l2.children[2].uuid).toBe('pt-1');

        // Level 2 -> Level 1
        changeDocumentStructure(root, DocumentType.Level1);
        expect(root.children.length).toBe(1);
        expect(l1.children.length).toBe(3);
        expect(l1.children[0].uuid).toBe('line-1');
        expect(l1.children[1].uuid).toBe('line-2');
        expect(l1.children[2].uuid).toBe('pt-1');

        // Level 1 -> Level 0
        changeDocumentStructure(root, DocumentType.Level0);
        expect(root.children.length).toBe(3);
        expect(root.children[0].uuid).toBe('line-1');
        expect(root.children[1].uuid).toBe('line-2');
        expect(root.children[2].uuid).toBe('pt-1');

        // Level 0 -> Level 3
        changeDocumentStructure(root, DocumentType.Level3);
        expect(root.children.length).toBe(1);
        const newL1 = root.children[0] as FormteilContainer;
        expect(newL1.children.length).toBe(1);
        const newL2 = newL1.children[0] as FormteilContainer;
        expect(newL2.children.length).toBe(1);
        const newL3 = newL2.children[0] as FormteilContainer;
        expect(newL3.children.length).toBe(3);
        expect(newL3.children[0].uuid).toBe('line-1');
    });

    it('should shift syllable dashes from subsequent syllable to preceding syllable', () => {
        const syl1 = { uuid: 'syl-1', kind: LinePartKind.Syllable as const, text: 'ti', notes: { spaced: [] }, syllableType: SyllableType.Normal };
        const syl2 = { uuid: 'syl-2', kind: LinePartKind.Syllable as const, text: '-bi', notes: { spaced: [] }, syllableType: SyllableType.Normal };
        const syl3 = { uuid: 'syl-3', kind: LinePartKind.Syllable as const, text: 'do', notes: { spaced: [] }, syllableType: SyllableType.Normal };
        const syl4 = { uuid: 'syl-4', kind: LinePartKind.Syllable as const, text: '-mi', notes: { spaced: [] }, syllableType: SyllableType.Normal };
        const syl5 = { uuid: 'syl-5', kind: LinePartKind.Syllable as const, text: ' -nus', notes: { spaced: [] }, syllableType: SyllableType.Normal };
        const line = {
            uuid: 'line-1',
            kind: ContainerKind.ZeileContainer as const,
            children: [syl1, syl2, syl3, syl4, syl5]
        };
        const testRoot: RootContainer = {
            uuid: 'root-1',
            kind: ContainerKind.RootContainer,
            children: [line],
            documentType: DocumentType.Level0,
            comments: []
        };

        fixSyllableDashes(testRoot);

        expect(syl1.text).toBe('ti-');
        expect(syl2.text).toBe('bi');
        expect(syl3.text).toBe('do-');
        expect(syl4.text).toBe('mi-');
        expect(syl5.text).toBe('nus');
    });
});

