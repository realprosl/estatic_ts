type Scalar = number;
type Reader = () => number;

function makeReaders(value: number): Reader[][] {
  return [[(): number => value + 1]];
}
function sumMatrix(xs: Scalar[][]): number { return xs[0][0] + xs[1][0]; }

const matrix: Scalar[][] = [[1, 2], [3, 4]];
print(sumMatrix(matrix));
const readers: Reader[][] = makeReaders(7);
const callback: Reader = readers[0][0];
print(callback()); print(callback());
