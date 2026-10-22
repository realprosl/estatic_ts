import { make, reader } from "./api";

function main(): void {
  let owner = make(3);
  const snapshot = reader(owner.value);
  {
    let loan = ref(owner);
    print(loan.add(2));
  }
  const next = move(owner);
  print(next.value);
  print(snapshot());
}
main();
