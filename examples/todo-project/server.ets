// Backend alternativo: conserva el dominio y los servicios del CLI,
// pero expone una API HTTP con Drogon.

import { Priority, Todo, TodoStats } from "./model.ets";
import { allTodos, resetRepository } from "./repository.ets";
import { OperationResult, completeTodo, createTodo, getStats } from "./service.ets";
import { formatStats, formatTodo } from "./formatter.ets";

resetRepository();
createTodo("review memory ownership", Priority.High);
createTodo("benchmark drogon backend", Priority.Medium);

@cpp_drogon
let server: Server = http.createServer();

server.get("/health", (req: Request, res: Response): void => {
  res.status(200).json("{\"status\":\"ok\"}");
});

server.get("/todos", (req: Request, res: Response): void => {
  const todos: Array<Todo> = allTodos();
  let body: string = "";
  let index: number = 0;
  while (index < length(todos)) {
    body = body + formatTodo(todos[index]) + "\n";
    index = index + 1;
  }
  res.status(200).header("Content-Type", "text/plain").send(body);
});

server.get("/stats", (req: Request, res: Response): void => {
  const stats: TodoStats = getStats();
  res.status(200).header("Content-Type", "text/plain").send(formatStats(stats));
});

server.post("/todos", (req: Request, res: Response): void => {
  const result: OperationResult = createTodo(req.body, Priority.Medium);
  if (result.ok) {
    res.status(201).send("created id=" + numberToString(result.id));
  } else {
    res.status(400).send(result.message);
  }
});

server.listen(8080);
