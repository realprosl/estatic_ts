// Four independent evaluations, each below the instruction limit.
// They must not consume one shared program-wide budget.
@comptime
function count(): number {
  let total: number = 0;
  for (let i: number = 0; i < 350; i += 1) {
    total += 1;
  }
  return total;
}

const first: number = count();
const second: number = count();
const third: number = count();
const fourth: number = count();
print(first + second + third + fourth); // 1400
