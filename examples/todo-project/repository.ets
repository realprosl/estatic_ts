import { Todo, TodoStats } from "./model.ets";

let records: Array<Todo> = [];

export function resetRepository(): void {
  records = [];
}

export function allTodos(): Array<Todo> {
  return records;
}

export function nextTodoId(): number {
  let highest: number = 0;
  let index: number = 0;
  while (index < length(records)) {
    if (records[index].id > highest) { highest = records[index].id; }
    index = index + 1;
  }
  return highest + 1;
}

export function insertTodo(todo: Todo): void {
  records.push(todo);
}

export function findTodoIndex(id: number): number {
  let index: number = 0;
  while (index < length(records)) {
    if (records[index].id == id) { return index; }
    index = index + 1;
  }
  return -1;
}

export function markTodoDone(index: number): void {
  records[index].done = true;
}

export function removeTodoAt(removeIndex: number): void {
  let remaining: Array<Todo> = [];
  let index: number = 0;
  while (index < length(records)) {
    if (index != removeIndex) { remaining.push(records[index]); }
    index = index + 1;
  }
  records = remaining;
}

export function repositoryStats(): TodoStats {
  let completed: number = 0;
  let index: number = 0;
  while (index < length(records)) {
    if (records[index].done) { completed = completed + 1; }
    index = index + 1;
  }
  return new TodoStats(length(records), length(records) - completed, completed);
}
