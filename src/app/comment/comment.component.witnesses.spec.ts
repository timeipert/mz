import { CommentComponent } from './comment.component';
import * as M from '../types/model';

describe('CommentComponent Witnesses Helpers', () => {
  let mockComment: M.Comment;

  beforeEach(() => {
    mockComment = {
      startUUID: 'u1',
      endUUID: 'u2',
      text: 'Test comment',
      lines: [
        { kind: M.ContainerKind.ZeileContainer, uuid: 'line0', children: [] } as M.ZeileContainer,
        { kind: M.ContainerKind.ZeileContainer, uuid: 'line1', children: [] } as M.ZeileContainer
      ],
      readingWitnesses: ['sigla0', 'sigla1']
    };
  });

  it('inserting a line at index 1 shifts labels', () => {
    const newItem = { kind: M.ContainerKind.ZeileContainer, uuid: 'line-inserted', children: [] } as M.ZeileContainer;
    // Insert at index 0 (which inserts at index 1, i.e., index + 1)
    CommentComponent.insertAtHelper(mockComment, 0, newItem);

    expect(mockComment.lines?.length).toBe(3);
    expect(mockComment.lines?.[1].uuid).toBe('line-inserted');
    expect(mockComment.readingWitnesses).toEqual(['sigla0', '', 'sigla1']);
  });

  it('deleting removes the right label', () => {
    // Delete at index 1
    CommentComponent.deleteAtHelper(mockComment, 1);

    expect(mockComment.lines?.length).toBe(1);
    expect(mockComment.lines?.[0].uuid).toBe('line0');
    expect(mockComment.readingWitnesses).toEqual(['sigla0']);
  });

  it('comments without the field behave as before (no crash)', () => {
    const noWitnessComment: M.Comment = {
      startUUID: 'u1',
      endUUID: 'u2',
      text: 'Test comment',
      lines: [
        { kind: M.ContainerKind.ZeileContainer, uuid: 'line0', children: [] } as M.ZeileContainer,
        { kind: M.ContainerKind.ZeileContainer, uuid: 'line1', children: [] } as M.ZeileContainer
      ]
    };

    const newItem = { kind: M.ContainerKind.ZeileContainer, uuid: 'line-inserted', children: [] } as M.ZeileContainer;
    // Insert without crash
    expect(() => CommentComponent.insertAtHelper(noWitnessComment, 0, newItem)).not.toThrow();
    expect(noWitnessComment.lines?.length).toBe(3);
    expect(noWitnessComment.readingWitnesses).toBeUndefined();

    // Delete without crash
    expect(() => CommentComponent.deleteAtHelper(noWitnessComment, 1)).not.toThrow();
    expect(noWitnessComment.lines?.length).toBe(2);
    expect(noWitnessComment.readingWitnesses).toBeUndefined();
  });
});
