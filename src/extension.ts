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
      const activeEditor = vscode.window.activeTextEditor;
      let symbols = undefined;
      if (activeEditor !== undefined) {
        symbols = await vscode.commands
          .executeCommand<vscode.DocumentSymbol[]>(
            "vscode.executeDocumentSymbolProvider",
            activeEditor.document.uri
          )
          .then((symbol) => {
            if (symbol !== undefined) {
              const list: Record<number, Array<vscode.DocumentSymbol>> = {};
              for (const variable of findVars(symbol)) {
                // Retrieve all ranges in the document where the variable appears
                const regex = new RegExp(variable.name);
                for (let i = 0; i < activeEditor.document.lineCount; i++) {
                  const match = regex.exec(
                    activeEditor.document.lineAt(i).text
                  );
                  if (match === null) {
                    continue;
                  }
                  for (const m of match) {
                    if (list[i] === undefined) {
                      list[i] = [];
                    }
                    list[i].push({
                      name: variable.name,
                      kind: variable.kind,
                      range: variable.range,
                      selectionRange: variable.selectionRange,
                      children: variable.children,
                      detail: variable.detail,
                    });
                  }
                }
              }
              return list;
            }
          });
      }
      if (symbols === undefined) {
        return;
      }
      const symbolcache: Record<string, any> = {};
      for (const line of Object.keys(symbols || {}) as unknown as number[]) {
        const symbolinline = symbols[line];
        if (line > context.stoppedLocation.start.line) {
          break;
        }
        for (const symbol of symbolinline) {
          const symbolRange = new vscode.Range(
            new vscode.Position(Number(line), symbol.range.start.character),
            new vscode.Position(Number(line), symbol.range.end.character)
          );
          let stackFrame: any;
          if (symbolcache[symbol.name] !== undefined) {
            stackFrame = symbolcache[symbol.name];
          } else {
            stackFrame = context.frameId
              ? await debugSession
                  .customRequest("evaluate", {
                    frameId: context.frameId,
                    expression: symbol.name,
                    context: "variables",
                  })
                  .then((result) => result)
              : undefined;
            symbolcache[symbol.name] = stackFrame;
          }
          const hint = new vscode.InlineValueText(
            symbolRange,
            symbol.name + ": " + stackFrame.type + " = " + stackFrame.result
          );
          inlineValues.push(hint);
        }
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
