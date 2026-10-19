import { Priority, Todo, TodoStats } from "./model.ets";
import { allTodos, resetRepository } from "./repository.ets";
import { OperationResult, completeTodo, createTodo, deleteTodo, getStats } from "./service.ets";
import { formatStats, formatTodo } from "./formatter.ets";

let checks: number = 0;
let failures: number = 0;

function check(label: string, condition: boolean): void {
  checks = checks + 1;
  if (condition) {
    print("PASS " + label);
  } else {
    failures = failures + 1;
    print("FAIL " + label);
  }
}

resetRepository();

const invalid: OperationResult = createTodo("x", Priority.Low);
check("rejects short titles", !invalid.ok);

const first: OperationResult = createTodo("review memory ownership", Priority.High);
const second: OperationResult = createTodo("benchmark drogon backend", Priority.Medium);
const third: OperationResult = createTodo("write dialect documentation", Priority.Low);
check("assigns sequential ids", first.id == 1 && second.id == 2 && third.id == 3);

const completed: OperationResult = completeTodo(second.id);
check("completes an existing todo", completed.ok);

const missing: OperationResult = completeTodo(99);
check("reports missing ids", !missing.ok);

const deleted: OperationResult = deleteTodo(first.id);
check("deletes an existing todo", deleted.ok);

const todos: Array<Todo> = allTodos();
check("repository contains two records", length(todos) == 2);
check("completed state survives modules", todos[0].done);

let index: number = 0;
while (index < length(todos)) {
  print(formatTodo(todos[index]));
  index = index + 1;
}

const stats: TodoStats = getStats();
check("statistics are consistent", stats.total == 2 && stats.pending == 1 && stats.completed == 1);
print(formatStats(stats));
print("SUMMARY checks=" + numberToString(checks) + " failures=" + numberToString(failures));
