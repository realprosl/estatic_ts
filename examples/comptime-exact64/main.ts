@comptime
function add(a: u64, b: u64): u64 { return a + b; }
function echo(value: u64): u64 { return value; }
function less(a: u64, b: u64): boolean { return a < b; }

const high: u64 = add(18446744073709551614, 1);
const low: i64 = comptime((): i64 => -9223372036854775808);
print(high); print(low); print(echo(high));
print("max=" + echo(high));
if (less(9007199254740992, 9007199254740993)) { print("distinct"); } else { print("bad"); }
