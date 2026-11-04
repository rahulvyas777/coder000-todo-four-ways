import { Injectable, signal } from '@angular/core';

export interface UndoToast {
  message: string;
  undo: () => Promise<void>;
}

const TOAST_MS = 5000;

/** The single undo toast of the shell; a new action replaces the one showing. */
@Injectable({ providedIn: 'root' })
export class UndoService {
  private timer: ReturnType<typeof setTimeout> | undefined;

  readonly toast = signal<UndoToast | null>(null);

  show(message: string, undo: () => Promise<void>): void {
    clearTimeout(this.timer);
    const toast = { message, undo };
    this.toast.set(toast);
    this.timer = setTimeout(() => {
      if (this.toast() === toast) this.toast.set(null);
    }, TOAST_MS);
  }

  async undo(): Promise<void> {
    const toast = this.toast();
    this.dismiss();
    if (toast) await toast.undo();
  }

  dismiss(): void {
    clearTimeout(this.timer);
    this.toast.set(null);
  }
}
