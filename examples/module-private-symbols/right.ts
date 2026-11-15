let count: number = 90;
function helper(value: number): number { return count + value; }
@comptime function calculate(): number { return helper(1); }
export const initialRight: number = calculate();
export function readRight(): number {
  const next = (): number => helper(2);
  count += 1;
  return next();
}
