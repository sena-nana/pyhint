import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  const provider = new InlineValuesProvider();

  context.subscriptions.push(
    vscode.languages.registerInlineValuesProvider(
      { pattern: "**/*.py", scheme: "file" },
      provider
    )
  );
}

class InlineValuesProvider implements vscode.InlineValuesProvider {
  async provideInlineValues(
    document: vscode.TextDocument,
    viewPort: vscode.Range,
    context: vscode.InlineValueContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineValue[] | null | undefined> {
    const inlineValues: vscode.InlineValue[] = [];
    const debugSession = vscode.debug.activeDebugSession;
    if (debugSession) {
      var activeEditor = vscode.window.activeTextEditor;
      var symbols = undefined;
      if (activeEditor !== undefined) {
        symbols = await vscode.commands
          .executeCommand<vscode.DocumentSymbol[]>(
            "vscode.executeDocumentSymbolProvider",
            activeEditor.document.uri
          )
          .then((symbols) => {
            if (symbols !== undefined) {
              const list: Record<number, vscode.DocumentSymbol> = {};
              for (const variable of findVars(symbols)) {
                console.log(variable.name);
                list[variable.range.start.line] = variable;
              }
              return list;
            }
          });
      }
      if (symbols === undefined) {
        return;
      }
      for (const line of Object.keys(symbols || {}) as unknown as number[]) {
        const symbol = symbols[line];
        if (line > context.stoppedLocation.start.line) {
          break;
        }
        const symbolRange = new vscode.Range(
          new vscode.Position(
            symbol.range.start.line,
            symbol.range.start.character
          ),
          new vscode.Position(symbol.range.end.line, symbol.range.end.character)
        );
        const stackFrame = context.frameId
          ? await debugSession
              .customRequest("evaluate", {
                frameId: context.frameId,
                expression: symbol.name,
                context: "repl",
              })
              .then((result) => result.result)
          : undefined;
        const hint = new vscode.InlineValueText(
          symbolRange,
          symbol.name + " = " + stackFrame
        );
        inlineValues.push(hint);
      }
    }

    return inlineValues;
  }
}
function findVars(symbols: vscode.DocumentSymbol[]): vscode.DocumentSymbol[] {
  var vars = symbols.filter(
    (symbol) => symbol.kind === vscode.SymbolKind.Variable
  );
  return vars.concat(
    symbols
      .map((symbol) => findVars(symbol.children))
      .reduce((a, b) => a.concat(b), [])
  );
}
