// Cada padre posee sus hijos; no hay un array global ni préstamos almacenados.
// ptr<T> conserva ownership exclusivo. move transfiere el hijo al padre.
class TreeNode {
  value: number;
  children: ptr<TreeNode>[];

  constructor(value: number) {
    this.value = value;
    this.children = [];
  }

  add(child: ptr<TreeNode>): void {
    this.children.push(move(child));
  }

  setValue(value: number): void {
    this.value = value;
  }
}

let root: ptr<TreeNode> = new TreeNode(0);
let child: ptr<TreeNode> = new TreeNode(1);
root.add(move(child));
root.add(new TreeNode(2));

// Leer y actualizar reutiliza los objetos que ya posee el árbol.
print(root.children[0].value); // 1
root.children[0].setValue(7);
print(root.children[0].value); // 7
print(root.children.length);  // 2

// child ya fue transferido: usarlo aquí sería un error E4102.
// Los unique_ptr del C++ generado liberan los hijos al destruir el padre.
