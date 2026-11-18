// Date de TypeScript como librería del runtime (no es un builtin):
//
//   import Date from "estatic:date";
//   const d = new Date(2024, 0, 15, 10, 30);   // hora local
//   d.getFullYear(), d.toISOString(), Date.now(), Date.UTC(2024, 0, 15)
//
// Un Date guarda milisegundos desde 1970-01-01T00:00:00Z (NaN si no es válido).
// El calendario sigue la especificación de ECMAScript; solo el reloj y la zona
// horaria local salen de C++ (runtime/lib/date.hpp).

@include("runtime/lib/date.hpp")
@include("runtime/lib/numeric.hpp")
@cpp_native("ets_calendar::now") function clockNow(): number;
@cpp_native("ets_calendar::offset") function zoneOffset(t: number): number;
@cpp_native("ets_calendar::zoneName") function zoneName(t: number): string;
@cpp_native("ets_calendar::rangeError") function rangeError(message: string): void;
@cpp_native("ets_numeric::floor") function floor(x: number): number;
@cpp_native("ets_numeric::trunc") function trunc(x: number): number;
@cpp_native("ets_numeric::nan") function nan(): number;

const msPerDay: number = 86400000;
const dayNames: string[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const monthNames: string[] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function finite(x: number): boolean { return x == x && x - x == 0; }
function modulo(a: number, b: number): number { return a - floor(a / b) * b; }
// ToIntegerOrInfinity de los argumentos (NaN se queda en NaN para propagarlo).
function integer(x: number): number { return finite(x) ? trunc(x) : x; }

// Días desde 1970-01-01 de una fecha civil (mes 1-12) y al revés (H. Hinnant).
function daysFromCivil(year: number, month: number, day: number): number {
  const y: number = month <= 2 ? year - 1 : year;
  const era: number = floor(y / 400); const yoe: number = y - era * 400;
  const mp: number = month > 2 ? month - 3 : month + 9;
  const doy: number = floor((153 * mp + 2) / 5) + day - 1;
  const doe: number = yoe * 365 + floor(yoe / 4) - floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
function civilYear(days: number): number { return civil(days, 0); }
function civilMonth(days: number): number { return civil(days, 1); }
function civilDay(days: number): number { return civil(days, 2); }
function civil(days: number, part: number): number {
  const z: number = days + 719468;
  const era: number = floor(z / 146097); const doe: number = z - era * 146097;
  const yoe: number = floor((doe - floor(doe / 1460) + floor(doe / 36524) - floor(doe / 146096)) / 365);
  const doy: number = doe - (365 * yoe + floor(yoe / 4) - floor(yoe / 100));
  const mp: number = floor((5 * doy + 2) / 153);
  const day: number = doy - floor((153 * mp + 2) / 5) + 1;
  const month: number = mp < 10 ? mp + 3 : mp - 9;
  if (part == 2) return day;
  if (part == 1) return month - 1;
  return yoe + era * 400 + (month <= 2 ? 1 : 0);
}

// MakeDay, MakeTime, MakeDate y TimeClip de la especificación.
function makeDay(year: number, month: number, date: number): number {
  if (!finite(year) || !finite(month) || !finite(date)) return nan();
  const y: number = trunc(year) + floor(trunc(month) / 12); const m: number = modulo(trunc(month), 12);
  return daysFromCivil(y, m + 1, 1) + trunc(date) - 1;
}
function makeTime(hours: number, minutes: number, seconds: number, ms: number): number {
  if (!finite(hours) || !finite(minutes) || !finite(seconds) || !finite(ms)) return nan();
  return trunc(hours) * 3600000 + trunc(minutes) * 60000 + trunc(seconds) * 1000 + trunc(ms);
}
function makeDate(day: number, time: number): number { return finite(day) && finite(time) ? day * msPerDay + time : nan(); }
function timeClip(t: number): number { return finite(t) && t <= 8640000000000000 && t >= -8640000000000000 ? trunc(t) + 0 : nan(); }

// Hora local <-> UTC con el desfase de la zona en ese instante.
function localTime(t: number): number { return t - zoneOffset(t) * 60000; }
function utcFromLocal(t: number): number {
  if (!finite(t)) return nan();
  const guess: number = t + zoneOffset(t) * 60000;
  return t + zoneOffset(guess) * 60000;
}

function pad(value: number, width: number): string {
  let text: string = "" + value;
  while (text.length < width) text = "0" + text;
  return text;
}
function yearText(year: number): string {
  if (year >= 0 && year <= 9999) return pad(year, 4);
  return (year < 0 ? "-" : "+") + pad(year < 0 ? -year : year, 6);
}
function displayYear(year: number): string { return year < 0 ? "-" + pad(-year, 6) : pad(year, 4); }

function digitsAt(text: string, at: number, count: number): number {
  if (at + count > text.length) return -1;
  let value: number = 0;
  for (let k: number = 0; k < count; k = k + 1) {
    const code: number = text.charCodeAt(at + k);
    if (code < 48 || code > 57) return -1;
    value = value * 10 + code - 48;
  }
  return value;
}

// Date.parse: el formato de fecha y hora de ECMAScript (ISO 8601 simplificado):
// YYYY, YYYY-MM, YYYY-MM-DD, ±YYYYYY..., con THH:mm[:ss[.sss]] y Z o ±HH:mm.
// Solo fecha es UTC; fecha y hora sin zona es hora local.
export function parse(text: string): number {
  let at: number = 0; let sign: number = 1; let year: number = -1;
  if (text.charAt(0) == "+" || text.charAt(0) == "-") {
    sign = text.charAt(0) == "-" ? -1 : 1; year = digitsAt(text, 1, 6); at = 7;
    if (year == 0 && sign < 0) return nan();
  } else { year = digitsAt(text, 0, 4); at = 4; }
  if (year < 0) return nan();
  year = year * sign;
  let month: number = 1; let day: number = 1;
  if (text.charAt(at) == "-") { month = digitsAt(text, at + 1, 2); at = at + 3; if (month < 1 || month > 12) return nan(); }
  if (text.charAt(at) == "-") { day = digitsAt(text, at + 1, 2); at = at + 3; if (day < 1 || day > 31) return nan(); }
  let hours: number = 0; let minutes: number = 0; let seconds: number = 0; let ms: number = 0;
  let hasTime: boolean = false; let offset: number = 0; let hasZone: boolean = false;
  if (text.charAt(at) == "T") {
    hasTime = true;
    hours = digitsAt(text, at + 1, 2); minutes = text.charAt(at + 3) == ":" ? digitsAt(text, at + 4, 2) : -1; at = at + 6;
    if (hours < 0 || minutes < 0 || hours > 24 || minutes > 59) return nan();
    if (text.charAt(at) == ":") { seconds = digitsAt(text, at + 1, 2); at = at + 3; if (seconds < 0 || seconds > 59) return nan(); }
    if (text.charAt(at) == "." || text.charAt(at) == ",") {
      let digits: number = 0; let scale: number = 100; at = at + 1;
      while (at < text.length && digitsAt(text, at, 1) >= 0) { if (digits < 3) ms = ms + digitsAt(text, at, 1) * scale; scale = scale / 10; digits = digits + 1; at = at + 1; }
      if (digits == 0) return nan();
    }
    if (hours == 24 && (minutes != 0 || seconds != 0 || ms != 0)) return nan();
  }
  if (text.charAt(at) == "Z") { hasZone = true; at = at + 1; }
  else if (hasTime && (text.charAt(at) == "+" || text.charAt(at) == "-")) {
    const zoneHours: number = digitsAt(text, at + 1, 2); const zoneMinutes: number = text.charAt(at + 3) == ":" ? digitsAt(text, at + 4, 2) : -1;
    if (zoneHours < 0 || zoneMinutes < 0 || zoneHours > 23 || zoneMinutes > 59) return nan();
    offset = (zoneHours * 60 + zoneMinutes) * (text.charAt(at) == "-" ? -1 : 1); hasZone = true; at = at + 6;
  }
  if (at != text.length) return nan();
  const days: number = daysFromCivil(year, month, day);
  const t: number = makeDate(days, makeTime(hours, minutes, seconds, ms));
  if (hasZone) return timeClip(t - offset * 60000);
  return timeClip(hasTime ? utcFromLocal(t) : t);
}

// Date.UTC(year, month = 0, day = 1, ...): los años 0-99 son 1900-1999.
export function UTC(year: number, month?: number, date?: number, hours?: number, minutes?: number, seconds?: number, ms?: number): number {
  let y: number = integer(year);
  if (finite(y) && y >= 0 && y <= 99) y = 1900 + y;
  return timeClip(makeDate(makeDay(y, month ?? 0, date ?? 1), makeTime(hours ?? 0, minutes ?? 0, seconds ?? 0, ms ?? 0)));
}
export function now(): number { return clockNow(); }

export default class Date {
  time: number;
  // new Date(), new Date(ms), new Date("2024-01-15T10:30:00Z") y
  // new Date(año, mes, día?, horas?, minutos?, segundos?, ms?) en hora local.
  constructor(value?: number | string, month?: number, date?: number, hours?: number, minutes?: number, seconds?: number, ms?: number) {
    if (month !== undefined) {
      let year: number = nan();
      if (value !== undefined && typeof value == "number") year = integer(value);
      if (finite(year) && year >= 0 && year <= 99) year = 1900 + year;
      this.time = timeClip(utcFromLocal(makeDate(makeDay(year, month ?? 0, date ?? 1), makeTime(hours ?? 0, minutes ?? 0, seconds ?? 0, ms ?? 0))));
    } else if (value === undefined) this.time = clockNow();
    else if (typeof value == "number") this.time = timeClip(value);
    else this.time = parse(value);
  }
  static now(): number { return clockNow(); }
  static parse(text: string): number { return parse(text); }
  static UTC(year: number, month?: number, date?: number, hours?: number, minutes?: number, seconds?: number, ms?: number): number { return UTC(year, month, date, hours, minutes, seconds, ms); }

  getTime(): number { return this.time; }
  valueOf(): number { return this.time; }
  getTimezoneOffset(): number { return finite(this.time) ? zoneOffset(this.time) : nan(); }

  getUTCFullYear(): number { return finite(this.time) ? civilYear(floor(this.time / msPerDay)) : nan(); }
  getUTCMonth(): number { return finite(this.time) ? civilMonth(floor(this.time / msPerDay)) : nan(); }
  getUTCDate(): number { return finite(this.time) ? civilDay(floor(this.time / msPerDay)) : nan(); }
  getUTCDay(): number { return finite(this.time) ? modulo(floor(this.time / msPerDay) + 4, 7) : nan(); }
  getUTCHours(): number { return finite(this.time) ? floor(modulo(this.time, msPerDay) / 3600000) : nan(); }
  getUTCMinutes(): number { return finite(this.time) ? floor(modulo(this.time, 3600000) / 60000) : nan(); }
  getUTCSeconds(): number { return finite(this.time) ? floor(modulo(this.time, 60000) / 1000) : nan(); }
  getUTCMilliseconds(): number { return finite(this.time) ? modulo(this.time, 1000) : nan(); }

  getFullYear(): number { return finite(this.time) ? civilYear(floor(localTime(this.time) / msPerDay)) : nan(); }
  getMonth(): number { return finite(this.time) ? civilMonth(floor(localTime(this.time) / msPerDay)) : nan(); }
  getDate(): number { return finite(this.time) ? civilDay(floor(localTime(this.time) / msPerDay)) : nan(); }
  getDay(): number { return finite(this.time) ? modulo(floor(localTime(this.time) / msPerDay) + 4, 7) : nan(); }
  getHours(): number { return finite(this.time) ? floor(modulo(localTime(this.time), msPerDay) / 3600000) : nan(); }
  getMinutes(): number { return finite(this.time) ? floor(modulo(localTime(this.time), 3600000) / 60000) : nan(); }
  getSeconds(): number { return finite(this.time) ? floor(modulo(localTime(this.time), 60000) / 1000) : nan(); }
  getMilliseconds(): number { return finite(this.time) ? modulo(localTime(this.time), 1000) : nan(); }

  // Los setters devuelven el nuevo valor de tiempo, como en JavaScript.
  setTime(time: number): number { this.time = timeClip(time); return this.time; }
  setUTCFullYear(year: number, month?: number, date?: number): number {
    const t: number = finite(this.time) ? this.time : 0;
    this.time = timeClip(makeDate(makeDay(year, month ?? this.partUTC(1, t), date ?? this.partUTC(2, t)), modulo(t, msPerDay))); return this.time;
  }
  setUTCMonth(month: number, date?: number): number {
    if (!finite(this.time)) return this.time;
    this.time = timeClip(makeDate(makeDay(this.partUTC(0, this.time), month, date ?? this.partUTC(2, this.time)), modulo(this.time, msPerDay))); return this.time;
  }
  setUTCDate(date: number): number {
    if (!finite(this.time)) return this.time;
    this.time = timeClip(makeDate(makeDay(this.partUTC(0, this.time), this.partUTC(1, this.time), date), modulo(this.time, msPerDay))); return this.time;
  }
  setUTCHours(hours: number, minutes?: number, seconds?: number, ms?: number): number {
    if (!finite(this.time)) return this.time;
    const t: number = this.time;
    this.time = timeClip(makeDate(floor(t / msPerDay), makeTime(hours, minutes ?? floor(modulo(t, 3600000) / 60000), seconds ?? floor(modulo(t, 60000) / 1000), ms ?? modulo(t, 1000)))); return this.time;
  }
  setUTCMinutes(minutes: number, seconds?: number, ms?: number): number { return this.setUTCHours(this.getUTCHours(), minutes, seconds, ms); }
  setUTCSeconds(seconds: number, ms?: number): number { return this.setUTCHours(this.getUTCHours(), this.getUTCMinutes(), seconds, ms); }
  setUTCMilliseconds(ms: number): number { return this.setUTCHours(this.getUTCHours(), this.getUTCMinutes(), this.getUTCSeconds(), ms); }

  setFullYear(year: number, month?: number, date?: number): number {
    const t: number = finite(this.time) ? localTime(this.time) : 0;
    this.time = timeClip(utcFromLocal(makeDate(makeDay(year, month ?? this.partUTC(1, t), date ?? this.partUTC(2, t)), modulo(t, msPerDay)))); return this.time;
  }
  setMonth(month: number, date?: number): number {
    if (!finite(this.time)) return this.time;
    const t: number = localTime(this.time);
    this.time = timeClip(utcFromLocal(makeDate(makeDay(this.partUTC(0, t), month, date ?? this.partUTC(2, t)), modulo(t, msPerDay)))); return this.time;
  }
  setDate(date: number): number {
    if (!finite(this.time)) return this.time;
    const t: number = localTime(this.time);
    this.time = timeClip(utcFromLocal(makeDate(makeDay(this.partUTC(0, t), this.partUTC(1, t), date), modulo(t, msPerDay)))); return this.time;
  }
  setHours(hours: number, minutes?: number, seconds?: number, ms?: number): number {
    if (!finite(this.time)) return this.time;
    const t: number = localTime(this.time);
    this.time = timeClip(utcFromLocal(makeDate(floor(t / msPerDay), makeTime(hours, minutes ?? floor(modulo(t, 3600000) / 60000), seconds ?? floor(modulo(t, 60000) / 1000), ms ?? modulo(t, 1000))))); return this.time;
  }
  setMinutes(minutes: number, seconds?: number, ms?: number): number { return this.setHours(this.getHours(), minutes, seconds, ms); }
  setSeconds(seconds: number, ms?: number): number { return this.setHours(this.getHours(), this.getMinutes(), seconds, ms); }
  setMilliseconds(ms: number): number { return this.setHours(this.getHours(), this.getMinutes(), this.getSeconds(), ms); }

  // Año (0), mes (1) o día (2) del instante t tomado como UTC.
  partUTC(part: number, t: number): number { return civil(floor(t / msPerDay), part); }

  toISOString(): string {
    if (!finite(this.time)) rangeError("Invalid time value");
    return yearText(this.getUTCFullYear()) + "-" + pad(this.getUTCMonth() + 1, 2) + "-" + pad(this.getUTCDate(), 2) + "T" + pad(this.getUTCHours(), 2) + ":" + pad(this.getUTCMinutes(), 2) + ":" + pad(this.getUTCSeconds(), 2) + "." + pad(this.getUTCMilliseconds(), 3) + "Z";
  }
  toJSON(): string { return finite(this.time) ? this.toISOString() : "null"; }
  toDateString(): string {
    if (!finite(this.time)) return "Invalid Date";
    return dayNames[this.getDay()] + " " + monthNames[this.getMonth()] + " " + pad(this.getDate(), 2) + " " + displayYear(this.getFullYear());
  }
  toTimeString(): string {
    if (!finite(this.time)) return "Invalid Date";
    const offset: number = -this.getTimezoneOffset(); const size: number = offset < 0 ? -offset : offset;
    const zone: string = (offset < 0 ? "-" : "+") + pad(floor(size / 60), 2) + pad(modulo(size, 60), 2);
    const name: string = zoneName(this.time);
    return pad(this.getHours(), 2) + ":" + pad(this.getMinutes(), 2) + ":" + pad(this.getSeconds(), 2) + " GMT" + zone + (name == "" ? "" : " (" + name + ")");
  }
  // Como en JavaScript, salvo el nombre de la zona entre paréntesis: aquí es la
  // abreviatura del sistema ("CET") y no el nombre largo de Node.
  toString(): string { return finite(this.time) ? this.toDateString() + " " + this.toTimeString() : "Invalid Date"; }
  toUTCString(): string {
    if (!finite(this.time)) return "Invalid Date";
    return dayNames[this.getUTCDay()] + ", " + pad(this.getUTCDate(), 2) + " " + monthNames[this.getUTCMonth()] + " " + displayYear(this.getUTCFullYear()) + " " + pad(this.getUTCHours(), 2) + ":" + pad(this.getUTCMinutes(), 2) + ":" + pad(this.getUTCSeconds(), 2) + " GMT";
  }
}
