import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export const API_URL = 'http://localhost:16040';

export interface TaskList {
  id: number;
  name: string;
  position: number;
  createdAt: string;
  deletedAt: string | null;
  taskCount: number;
  openCount: number;
}

export interface Subtask {
  id: number;
  taskId: number;
  title: string;
  done: boolean;
  position: number;
}

export type Repeat = 'none' | 'daily' | 'weekly' | 'monthly';

export interface TaskItem {
  id: number;
  listId: number;
  title: string;
  notes: string;
  dueDate: string | null;
  priority: number;
  tags: string[];
  completed: boolean;
  completedAt: string | null;
  position: number;
  repeat: Repeat;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  subtasks: Subtask[];
}

@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);

  lists(): Observable<TaskList[]> {
    return this.http.get<TaskList[]>(`${API_URL}/api/lists`);
  }

  createList(name: string): Observable<TaskList> {
    return this.http.post<TaskList>(`${API_URL}/api/lists`, { name });
  }

  updateList(id: number, changes: { name?: string; position?: number }): Observable<TaskList> {
    return this.http.patch<TaskList>(`${API_URL}/api/lists/${id}`, changes);
  }

  deleteList(id: number): Observable<void> {
    return this.http.delete<void>(`${API_URL}/api/lists/${id}`);
  }

  tasks(listId: number): Observable<TaskItem[]> {
    return this.http.get<TaskItem[]>(`${API_URL}/api/lists/${listId}/tasks`);
  }
}
