function pipeline(xs: i64[]): f32 {
  const ys: f32[] = xs.map<f32>((x: u8): f32 => x);
  return ys.reduce<f32>(0, (sum: f32, x: f32): f32 => sum + x);
}

const xs: i64[] = [257,258];
const folded: f32 = comptime((): f32 => pipeline(xs));
print(folded);
if (pipeline(xs) == folded) { print("runtime=comptime"); }

const rounded: f32 = comptime((): f32 => 16777217);
if (rounded == 16777216) { print("f32 rounding ok"); }

const promoted: boolean = comptime((): boolean => {
  const signed: i32 = -1;
  const unsigned: u32 = 1;
  return signed > unsigned;
});
if (promoted) { print("unsigned promotion ok"); }
