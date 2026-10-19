// Dominio compartido por la aplicación CLI y el servidor HTTP.

export enum Priority { Low, Medium, High }

export class Todo {
  id: number;
  title: string;
  done: boolean;
  priority: Priority;

  constructor(id: number, title: string, done: boolean, priority: Priority) {
    this.id = id;
    this.title = title;
    this.done = done;
    this.priority = priority;
  }
}

export class TodoStats {
  total: number;
  pending: number;
  completed: number;

  constructor(total: number, pending: number, completed: number) {
    this.total = total;
    this.pending = pending;
    this.completed = completed;
  }
}
