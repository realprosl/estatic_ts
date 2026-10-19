import identity, { Box as Crate, generated } from "./index";

const box: Crate = new generated.Box(7);
print(identity<number>(box.value));
print(generated.answer<string>("ok"));
