// Ownership exclusivo: crear, transferir y consumir un ptr<T>.
// No hay delete manual; std::unique_ptr libera Session al salir del scope.

class Session {
  id: number;
  constructor(id: number) { this.id = id; }
}

function createSession(id: number): ptr<Session> {
  return new Session(id);
}

function consumeSession(session: ptr<Session>): number {
  return session.id;
}

const owner: ptr<Session> = createSession(42);
const transferred: ptr<Session> = move(owner);
print(numberToString(consumeSession(move(transferred))));  // 42
