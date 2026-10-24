const label: string = comptime((): string => {
  return "España 🙂";
});

const count: number = comptime((): number => {
  let values: number[] = [];
  for (let i: number = 0; i < 100; i += 1) {
    values.push(i);
  }
  return values.length;
});

print(label);
print(count);
