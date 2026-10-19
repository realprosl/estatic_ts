import {
  Box as Crate,
  add,
  snapshot,
  live,
  model,
} from "./index";

const box: Crate = new model.default(7);
print(add(box.value));
print(snapshot);
print(live);
