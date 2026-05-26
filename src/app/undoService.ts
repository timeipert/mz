import { Injectable } from '@angular/core';
import { debounce } from 'lodash';
import * as localforage from 'localforage';

export interface UndoState {
    state: string;
    name: string;
}

@Injectable({
    providedIn: 'root'
})
export class UndoService {
    private getJson: (() => string | undefined) | undefined = undefined;
    private onUndo: ((jsonString: string) => void) | undefined = undefined;
    private history: UndoState[] = [];
    private redoStack: UndoState[] = [];
    private notesCallback: Map<string, (() => void)> = new Map();
    private HISTORY_SIZE: number = 10;
    private throttledFunc: (() => void) | undefined;
    private nextActionName: string = 'Edit';

    //register call to get JsonString for document
    async registerUnDo(getCallback: () => string | undefined, setCallback: (jsonString: string) => void): Promise<void> {
        this.history = [];
        this.redoStack = [];
        this.notesCallback = new Map<string, (() => void)>();
        this.getJson = getCallback;
        this.onUndo = setCallback;
        this.throttledFunc = debounce(this.setHistory, 950, { 'leading': true, 'trailing': false });

        try {
            const settings: any = await localforage.getItem('monodi_settings');
            if (settings && settings.undoHistorySize) {
                this.HISTORY_SIZE = settings.undoHistorySize;
            } else {
                this.HISTORY_SIZE = 10;
            }
        } catch (e) {
            console.error(e);
        }
    }

    hasHistory = (): boolean => {
        return this.history.length > 0;
    }

    setHistory = (): void => {
        if (this.getJson) {
            if (this.history.length >= this.HISTORY_SIZE) {
                this.history.shift();
            }
            const data = this.getJson();
            if (data) {
                this.history.push({ state: data, name: this.nextActionName });
                this.redoStack = []; // Clear redo stack on new action
            }
            this.nextActionName = 'Edit'; // reset for the next action
        } else {
            console.error("UndoService probably not registered");
        }
    }

    //register Notes component before change
    registerNotesCallbacks = (uuid: string, callback: () => void) => {
        if (!this.notesCallback.has(uuid)) {
            this.notesCallback.set(uuid, callback);
        }
    }

    //should be callee on destroy to deregister notes component
    deregisterNotesCallbacks = (uuid: string) => {
        this.notesCallback.delete(uuid);
    }

    //call before change is made to save current state
    beforeChange(actionName: string = 'Edit'): void {
        this.nextActionName = actionName;
        if (this.throttledFunc)
            this.throttledFunc();
    }

    //call to set last change
    undo(): void {
        if (!this.onUndo || !this.getJson) return;
        if (this.history.length > 0) {
            const currentState = this.getJson();
            const lastChange = this.history.pop();
            if (currentState && lastChange) {
                this.redoStack.push({ state: currentState, name: lastChange.name });
            }
            if (lastChange) {
                this.onUndo(lastChange.state);
                this.notesCallback.forEach((k) => k());
            }
        }
    }

    redo(): void {
        if (!this.onUndo || !this.getJson) return;
        if (this.redoStack.length > 0) {
            const currentState = this.getJson();
            const nextChange = this.redoStack.pop();
            if (currentState && nextChange) {
                this.history.push({ state: currentState, name: nextChange.name });
            }
            if (nextChange) {
                this.onUndo(nextChange.state);
                this.notesCallback.forEach((k) => k());
            }
        }
    }

    getHistoryCount(): number {
        return this.history.length;
    }

    getRedoCount(): number {
        return this.redoStack.length;
    }

    getHistoryNames(): string[] {
        return this.history.map(h => h.name).reverse();
    }

    jumpToHistory(stepsBack: number): void {
        if (!this.onUndo || !this.getJson || stepsBack <= 0 || stepsBack > this.history.length) return;
        
        const currentState = this.getJson();

        let targetState: UndoState | undefined;
        let originalRedoName = '';
        
        // Pop the required number of steps
        for (let i = 0; i < stepsBack; i++) {
            const state = this.history.pop();
            if (i === 0 && state) {
                originalRedoName = state.name;
            }
            if (i === stepsBack - 1) {
                targetState = state;
            } else if (state) {
                // intermediate states go into redo
                this.redoStack.push({ state: state.state, name: state.name });
            }
        }

        if (currentState && targetState) {
            // Push the current state to the redo stack with the name of the first action we undid
            this.redoStack.push({ state: currentState, name: originalRedoName });
        }

        if (targetState) {
            this.onUndo(targetState.state);
            this.notesCallback.forEach((k) => k());
        }
    }

}