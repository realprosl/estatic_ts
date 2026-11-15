interface Box { value: u8; }

const summary: string = comptime((): string => {
  const source: i64 = 257;
  const bytes: u8[] = [source];
  const matrix: u8[][] = [[source]];
  const pair: [u8,i16] = [source,source];
  const box: Box = {value:source};
  return `source=${source}, byte=${bytes[0]}, nested=${matrix[0][0]}, pair=${pair[1]}, field=${box.value}`;
});
print(summary);
