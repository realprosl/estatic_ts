const summary: string = comptime((): string => {
  const maximum: u64 = 18446744073709551615;
  const negative: i64 = i64(maximum);
  const byte: u8 = u8(maximum);
  const fraction: f64 = -12.75;
  const truncated: i16 = i16(fraction);
  return `signed=${negative}, byte=${byte}, truncated=${truncated}`;
});
print(summary);
