import { Todo, TodoStats } from "./model.ets";
import { priorityLabel } from "./validation.ets";

export function formatTodo(todo: Todo): string {
  let status: string = "[ ]";
  if (todo.done) { status = "[x]"; }
  return numberToString(todo.id) + " " + status + " "
    + priorityLabel(todo.priority) + " " + todo.title;
}

export function formatStats(stats: TodoStats): string {
  return "total=" + numberToString(stats.total)
    + " pending=" + numberToString(stats.pending)
    + " completed=" + numberToString(stats.completed);
}
