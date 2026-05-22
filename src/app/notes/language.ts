import * as P from 'parsimmon'
import { v4 as UUID } from "uuid";
import { BaseNote, Grouped, Note, Spaced, NonSpaced, NoteType, noteTypeFromString } from '../types/model';

interface MusicLang {
    BaseNote: P.Parser<BaseNote>
    Octave: P.Parser<number>
    Liquescent: P.Parser<string>
    NoteType: P.Parser<NoteType>
    ModifierGroup: P.Parser<ModifierGroup>
    Note: P.Parser<Note>
    Group: P.Parser<Grouped>
    NonSpaced: P.Parser<NonSpaced>
    Spaced: P.Parser<Spaced>
}

const lang = {
    BaseNote: function (r: MusicLang) {
        return P.regexp(/[A-G]/).desc("Note erwartet") as P.Parser<BaseNote>;
    },
    Octave: function (r: MusicLang) {
        return P.regexp(/[0-9]/).map(Number).desc("Zahl erwartet");
    },
    NoteType: function (r: MusicLang) {
        return P.regexp(/[adoq,fsn-]/).desc("Ein Modifizierer adoq,-fsn").map(s => noteTypeFromString(s)!);
    },
    Liquescent: function (r: MusicLang) {
        return P.regexp(/[l]/).desc("Ein Modifizierer l") as P.Parser<string>;
    },
    ModifierGroup: function (r: MusicLang) {
        return P.seq(
                r.Octave.atMost(1),
                r.NoteType.atMost(1),
                r.Liquescent.atMost(1)
            ).wrap(P.string("["), P.string("]")).map((result): ModifierGroup => {
            return { octave: result[0][0], noteType: result[1][0], liquescent: result[2][0] !== undefined};
        });
    },
    Note: function (r: MusicLang) {
        return P.seq(r.BaseNote, r.ModifierGroup.atMost(1)).map((value): Note => {
            let groupOctave:   number | undefined = undefined;
            let groupNoteType: NoteType | undefined = undefined;

            if (value[1].length > 0) {
                groupOctave   = value[1][0].octave;
                groupNoteType = value[1][0].noteType;
            }

            return {
                uuid: UUID(),
                base: value[0],
                octave: (groupOctave !== undefined)? groupOctave : 4,
                noteType: (groupNoteType !== undefined)? groupNoteType : NoteType.Normal,
                focus: false,
                liquescent: (value[1].length > 0)? value[1][0].liquescent : false
            };
        });
    },
    Group: function (r: MusicLang) {
        return r.Note.atLeast(1).map((result): Grouped => {
            return {
                grouped: result
            };
        });
    },
    NonSpaced: function (r: MusicLang) {
        return r.Group.sepBy(P.regex(/\s/)).map((result): NonSpaced => {
          return {
            nonSpaced: result
          };
        });
    },

    Spaced: function (r: MusicLang) {
        return r.NonSpaced.sepBy(P.regex(/\s\s/)).trim(P.optWhitespace).map((result): Spaced => {
          return {
            spaced: result
          };
        });
    },
};

interface ModifierGroup {
    octave: number | undefined;
    noteType: NoteType | undefined;
    liquescent: boolean;
}

export const musicLanguage = P.createLanguage(lang);

