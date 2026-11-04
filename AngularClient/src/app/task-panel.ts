import { Component, ElementRef, inject, input, output } from '@angular/core';
import { Repeat, TaskItem } from './api';

export type TaskChanges = Partial<Pick<TaskItem, 'title' | 'notes' | 'dueDate' | 'priority' | 'tags' | 'repeat'>>;

/** The right-hand detail panel of `/lists/{listId}/tasks/{taskId}`. */
@Component({
  selector: 'app-task-panel',
  templateUrl: './task-panel.html',
  host: {
    class: 'panel',
    'data-testid': 'task-panel',
    role: 'complementary',
    'aria-label': 'Task details',
  },
})
export class TaskPanel {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  readonly task = input.required<TaskItem>();
  readonly save = output<TaskChanges>();
  readonly closed = output<void>();

  protected readonly priorities = [
    { value: 0, label: 'None' },
    { value: 1, label: 'Low' },
    { value: 2, label: 'Medium' },
    { value: 3, label: 'High' },
  ];

  protected readonly repeats: { value: Repeat; label: string }[] = [
    { value: 'none', label: 'Does not repeat' },
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
  ];

  /** Closes the panel; a field that still has focus is blurred first so its blur save runs. */
  close(): void {
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.host.contains(active)) active.blur();
    this.closed.emit();
  }

  protected saveTitle(field: HTMLInputElement): void {
    const title = field.value.trim();
    if (!title) {
      field.value = this.task().title;
      return;
    }
    if (title !== this.task().title) this.save.emit({ title });
  }

  protected saveNotes(value: string): void {
    if (value !== this.task().notes) this.save.emit({ notes: value });
  }

  protected saveDue(value: string): void {
    const dueDate = value || null;
    if (dueDate !== this.task().dueDate) this.save.emit({ dueDate });
  }

  protected savePriority(value: string): void {
    this.save.emit({ priority: Number(value) });
  }

  protected saveRepeat(value: string): void {
    this.save.emit({ repeat: value as Repeat });
  }

  protected addTag(field: HTMLInputElement): void {
    const tag = field.value.trim().toLowerCase();
    field.value = '';
    const tags = this.task().tags;
    if (!tag || tags.includes(tag)) return;
    this.save.emit({ tags: [...tags, tag] });
  }

  protected removeLastTag(event: Event, field: HTMLInputElement): void {
    const tags = this.task().tags;
    if (field.value !== '' || tags.length === 0) return;
    event.preventDefault();
    this.save.emit({ tags: tags.slice(0, -1) });
  }

  protected removeTag(tag: string): void {
    this.save.emit({ tags: this.task().tags.filter((t) => t !== tag) });
  }
}
