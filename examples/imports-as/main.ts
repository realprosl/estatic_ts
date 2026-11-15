import { generate as emit } from "./generator";
import { Box as Crate } from "./model";
import * as model from "./model";

const box: Crate = new model.Box(7);
print(model.increment(box.value));
emit();
