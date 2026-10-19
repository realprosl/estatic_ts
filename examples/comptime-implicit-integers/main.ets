@comptime function narrow(x: u8): i8 {
  return x;
}

const wide: i64 = 511;
const result: i8 = narrow(wide);
const summary: string = comptime((): string => {
  const source: i64 = 257;
  let byte: u8 = source;
  byte += 255;
  return `byte=${byte}`;
});
if (result == -1) { print("signed=-1"); }
print(summary);
