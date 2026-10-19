let count: number = 10;
function helper(value: number): number { return count + value; }
@comptime function calculate(): number { return helper(1); }
export const initialLeft: number = calculate();
export function readLeft(): number {
  const next = (): number => helper(2);
  count += 1;
  return next();
}
