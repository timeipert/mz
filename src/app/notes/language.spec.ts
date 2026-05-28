import { musicLanguage } from './language';
import { NoteType } from '../types/model';

describe('MusicLanguage Parser', () => {
    it('should parse simple notes', () => {
        const parsed = musicLanguage.Spaced.tryParse('A');
        expect(parsed.spaced.length).toBe(1);
        expect(parsed.spaced[0].nonSpaced[0].grouped[0].base).toBe('A');
        expect(parsed.spaced[0].nonSpaced[0].grouped[0].octave).toBe(3);
    });

    it('should parse lowercase notes with correct default octaves', () => {
        const parsedA = musicLanguage.Spaced.tryParse('a');
        expect(parsedA.spaced[0].nonSpaced[0].grouped[0].base).toBe('A');
        expect(parsedA.spaced[0].nonSpaced[0].grouped[0].octave).toBe(4);

        const parsedC = musicLanguage.Spaced.tryParse('c');
        expect(parsedC.spaced[0].nonSpaced[0].grouped[0].base).toBe('C');
        expect(parsedC.spaced[0].nonSpaced[0].grouped[0].octave).toBe(5);
    });

    it('should parse modifiers correctly', () => {
        const parsed = musicLanguage.Spaced.tryParse('C[f] A[ol]');
        
        expect(parsed.spaced[0].nonSpaced.length).toBe(2);
        
        const note1 = parsed.spaced[0].nonSpaced[0].grouped[0];
        expect(note1.base).toBe('C');
        expect(note1.noteType).toBe(NoteType.Flat);
        expect(note1.liquescent).toBeFalse();

        const note2 = parsed.spaced[0].nonSpaced[1].grouped[0];
        expect(note2.base).toBe('A');
        expect(note2.noteType).toBe(NoteType.Oriscus);
        expect(note2.liquescent).toBeTrue();
    });

    it('should parse spacing groups correctly', () => {
        const parsed = musicLanguage.Spaced.tryParse('A B  C');
        // 'A B' is one Spaced group with 2 NonSpaced groups
        // 'C' is a second Spaced group
        expect(parsed.spaced.length).toBe(2);
        expect(parsed.spaced[0].nonSpaced.length).toBe(2);
        expect(parsed.spaced[1].nonSpaced.length).toBe(1);
        
        expect(parsed.spaced[0].nonSpaced[0].grouped[0].base).toBe('A');
        expect(parsed.spaced[0].nonSpaced[1].grouped[0].base).toBe('B');
        expect(parsed.spaced[1].nonSpaced[0].grouped[0].base).toBe('C');
    });
});
