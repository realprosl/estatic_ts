// Recursos libuv: conservar el handle y cerrarlo de forma explicita.
// cancelTimer es idempotente y libera el callback cuando uv_close termina.

let ticks: number = 0;
let timer: Timer = setInterval((): void => {
  ticks = ticks + 1;
  print("tick " + numberToString(ticks));
}, 25);

// La clausura se declara despues de `timer`, por lo que puede capturarlo.
let stopper: Timer = setTimeout((): void => {
  cancelTimer(timer);
  print("timer cerrado");
}, 90);
