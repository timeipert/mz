import { Injectable } from '@angular/core';
import { debounce } from 'lodash';

@Injectable({
    providedIn: 'root'
})

export class UndoService {
    private getJson: (() => string | undefined) | undefined = undefined;
    private onUndo: ((jsonString: string) => void) | undefined = undefined;
    private history: string[] = [];
    private notesCallback: Map<string, (() => void)> = new Map();
    private HISTORY_SIZE: number = 10;
    private throttledFunc: (() => void) | undefined

    //register call to get JsonString for document
    registerUnDo(getCallback: () => string | undefined, setCallback: (jsonString: string) => void): void {
        this.history = [];
        this.notesCallback = new Map<string, (() => void)>();
        this.getJson = getCallback;
        this.onUndo = setCallback
        this.throttledFunc = debounce(this.setHistory, 950, { 'leading': true, 'trailing': false })
    }

    hasHistory = (): boolean => {
        if (this.history.length > 0) {
            return true;
        }
        return false;
    }

    setHistory = (): void => {
        if (this.getJson) {
            console.log("add new History")
            if (this.history.length === this.HISTORY_SIZE) {
                this.history.shift();
            }
            const data = this.getJson();
            if (data) {
                this.history.push(data);
            }
        } else {
            console.error("UndoService probably not registered")
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
    beforeChange(): void {
        if (this.throttledFunc)
            this.throttledFunc()
    }

    //call to set last change
    undo(): void {
        if (this.onUndo) {
            if (this.history.length > 0) {
                const lastChange = this.history.pop();
                let size = this.history.length;
                if (lastChange) {
                    console.log("undo called");
                    console.log("history: " + this.history.length)
                    this.onUndo(lastChange);
                    this.notesCallback.forEach((k) => {
                        k();
                    })
                }
            }
        } else {
            console.error("UndoService probably not registered")
        }
    }

}