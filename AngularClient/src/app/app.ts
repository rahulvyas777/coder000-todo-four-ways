import { ApplicationRef, Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { Autofocus } from './autofocus';
import { ListsStore } from './lists-store';
import { UndoService } from './undo';

@Component({
  imports: [RouterOutlet, RouterLink, Autofocus],
  selector: 'app-root',
  templateUrl: './app.html',
})
export class App {
  protected readonly store = inject(ListsStore);
  private readonly router = inject(Router);
  private readonly appRef = inject(ApplicationRef);
  protected readonly undo = inject(UndoService);

  /** The list in the URL; it is highlighted in the sidebar and survives a reload. */
  protected readonly activeListId = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => {
        const m = /^\/lists\/(\d+)/.exec(this.router.url);
        return m ? Number(m[1]) : null;
      }),
    ),
    { initialValue: null },
  );

  protected readonly adding = signal(false);
  protected readonly editingId = signal<number | null>(null);

  constructor() {
    void this.store.ensureLoaded();
  }

  protected startAdd(): void {
    this.adding.set(true);
    this.renderNow();
  }

  protected async commitAdd(input: HTMLInputElement): Promise<void> {
    const name = input.value.trim();
    if (!name) return;
    input.value = '';
    this.adding.set(false);
    const list = await this.store.create(name);
    await this.router.navigate(['/lists', list.id]);
  }

  protected startRename(id: number): void {
    this.editingId.set(id);
    this.renderNow();
  }

  /**
   * Renders the inline editor (and focuses it) inside the event handler, so keys typed right
   * after the click reach it instead of being lost before the scheduled change detection.
   */
  private renderNow(): void {
    this.appRef.tick();
  }

  protected cancelRename(): void {
    this.editingId.set(null);
  }

  protected async commitRename(id: number, value: string): Promise<void> {
    // Enter and the blur that follows both land here; only the first one saves.
    if (this.editingId() !== id) return;
    this.editingId.set(null);
    const name = value.trim();
    const current = this.store.lists().find((l) => l.id === id);
    if (!name || name === current?.name) return;
    await this.store.rename(id, name);
  }

  protected async deleteList(id: number, name: string): Promise<void> {
    if (!confirm(`Delete the list "${name}" and its tasks?`)) return;
    await this.store.remove(id);
    const wasActive = this.activeListId() === id;
    const url = this.router.url;
    this.undo.show(`Deleted list "${name}"`, async () => {
      await this.store.restore(id);
      if (wasActive) await this.router.navigateByUrl(url);
    });
    if (wasActive) {
      const first = this.store.lists()[0];
      await this.router.navigate(first ? ['/lists', first.id] : ['/']);
    }
  }
}
