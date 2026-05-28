import { move, ContainerKind, RootContainer, FormteilContainer, ParatextContainer, ParatextType, DocumentType } from './model';

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
