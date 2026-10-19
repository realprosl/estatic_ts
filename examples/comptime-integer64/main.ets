@comptime
function staticShift(a: i64, b: i64): i64 { return a << b; }
function liveShift(a: i64, b: i64): i64 { return a << b; }

@comptime
function staticDivide(a: i64, b: i64): i64 { return a / b; }
function liveDivide(a: i64, b: i64): i64 { return a / b; }

const foldedShift: i64 = staticShift(1, 40);
const expectedShift: i64 = 1099511627776;
if (foldedShift == liveShift(1, 40)) { print("shift"); } else { print("bad"); }
if (foldedShift == expectedShift) { print("exact"); } else { print("bad"); }
const foldedDivide: i64 = staticDivide(-7, 2);
print(foldedDivide); print(liveDivide(-7, 2));
