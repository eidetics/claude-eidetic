export interface SymbolInfo {
  name: string;
  kind: string;
  signature: string;
}

type AstNode = {
  type: string;
  startIndex: number;
  endIndex: number;
  children: AstNode[];
  text?: string;
};

const CONTAINER_TYPES = new Set([
  'class_declaration',
  'class_definition',
  'interface_declaration',
]);

const KIND_MAP: Record<string, string> = {
  function_declaration: 'function',
  arrow_function: 'function',
  async_function_definition: 'function',
  function_definition: 'function',
  class_declaration: 'class',
  class_definition: 'class',
  interface_declaration: 'interface',
  method_definition: 'method',
  method_declaration: 'method',
  type_alias_declaration: 'type',
  enum_declaration: 'enum',
  // Java
  constructor_declaration: 'constructor',
  // Rust
  function_item: 'function',
  impl_item: 'impl',
  struct_item: 'struct',
  enum_item: 'enum',
  trait_item: 'trait',
  // C#
  struct_declaration: 'struct',
};

function getIdentifier(node: AstNode, code: string): string | undefined {
  const identChild = node.children.find(c =>
    c.type === 'identifier' || c.type === 'type_identifier' || c.type === 'name',
  );
  if (identChild) return code.slice(identChild.startIndex, identChild.endIndex);
  return undefined;
}

function extractSignature(node: AstNode, code: string): string {
  const text = code.slice(node.startIndex, node.endIndex);
  // Take first line up to opening brace or end of line
  const firstLine = text.split('\n')[0];
  const upToBrace = firstLine.split('{')[0].trimEnd();
  const sig = upToBrace || firstLine;
  return sig.length > 200 ? sig.slice(0, 200) + '…' : sig;
}

export function extractSymbolInfo(
  node: AstNode,
  code: string,
  parentName?: string,
): SymbolInfo | undefined {
  const nodeType = node.type;

  // Handle export_statement: recurse into declaration child
  if (nodeType === 'export_statement') {
    const declChild = node.children.find(c =>
      c.type !== 'export' && c.type !== 'default' && c.type !== ';' && c.type !== 'identifier',
    );
    if (declChild) return extractSymbolInfo(declChild, code, parentName);
    return undefined;
  }

  const kind = KIND_MAP[nodeType];
  if (!kind) return undefined;

  const name = getIdentifier(node, code);
  if (!name) return undefined;

  const signature = extractSignature(node, code);

  void parentName; // consumed by caller to set chunk.parentSymbol
  return { name, kind, signature };
}

export function isContainerType(nodeType: string): boolean {
  return CONTAINER_TYPES.has(nodeType);
}
