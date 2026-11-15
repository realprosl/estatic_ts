// Expected stdout: 11, 99, 33, 77, 88 (one value per line).
function choose(value: number): number { return 11; }
function choose(value: string): number { return 99; }

@comptime
function decorated(value: number): number { return 33; }
@comptime
function decorated(value: string): number { return 44; }

@cppgen
function emitCpp(value: number): string { return "print(77.0);"; }
@cppgen
function emitCpp(value: string): string { return "print(777.0);"; }

@etsgen
function emitDialect(value: number): string { return "print(88);"; }
@etsgen
function emitDialect(value: string): string { return "print(888);"; }

const first: number = comptime((): number => choose(1));
const second: number = comptime((): number => choose("text"));
const third: number = decorated(1);
print(first);
print(second);
print(third);
emitCpp(1);
emitDialect(1);
