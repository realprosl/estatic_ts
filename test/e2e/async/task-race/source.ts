// task-race — `race([t1, t2])` devuelve la primera tarea que termina.
//
// El perdedor no se destruye mientras su timer conserva el coroutine_handle:
// el event loop adopta el frame y lo drena al completar. Todavía no hay
// cancelación cooperativa de la operación perdedora.

async function delay(ms: number, value: number): Promise<number> {
  await sleep(ms);
  return value;
}

async function firstWins(): Promise<number> {
  // El segundo elemento termina antes aunque aparezca después en el array.
  return race([delay(100, 1), delay(1, 999)]);
}

print(numberToString(await firstWins()));
