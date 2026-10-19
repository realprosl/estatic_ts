import { Priority, Todo, TodoStats } from "./model.ets";
import { validId, validTitle } from "./validation.ets";
import { findTodoIndex, insertTodo, markTodoDone, nextTodoId, removeTodoAt, repositoryStats } from "./repository.ets";

export class OperationResult {
  ok: boolean;
  message: string;
  id: number;

  constructor(ok: boolean, message: string, id: number) {
    this.ok = ok;
    this.message = message;
    this.id = id;
  }
}

export function createTodo(title: string, priority: Priority): OperationResult {
  if (!validTitle(title)) {
    return new OperationResult(false, "title must contain 3 to 80 characters", 0);
  }
  const id: number = nextTodoId();
  insertTodo(new Todo(id, title, false, priority));
  return new OperationResult(true, "created", id);
}

export function completeTodo(id: number): OperationResult {
  if (!validId(id)) { return new OperationResult(false, "invalid id", id); }
  const index: number = findTodoIndex(id);
  if (index < 0) { return new OperationResult(false, "todo not found", id); }
  markTodoDone(index);
  return new OperationResult(true, "completed", id);
}

export function deleteTodo(id: number): OperationResult {
  if (!validId(id)) { return new OperationResult(false, "invalid id", id); }
  const index: number = findTodoIndex(id);
  if (index < 0) { return new OperationResult(false, "todo not found", id); }
  removeTodoAt(index);
  return new OperationResult(true, "deleted", id);
}

export function getStats(): TodoStats {
  return repositoryStats();
}
