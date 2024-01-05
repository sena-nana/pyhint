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
          .then(async (symbol) => {
            if (symbol !== undefined) {
              const list: Record<number, Array<vscode.DocumentSymbol>> = {};
              for (const variable of findVars(symbol)) {
                const all_refer = await vscode.commands
                  .executeCommand<vscode.Location[]>(
                    "vscode.executeReferenceProvider",
                    activeEditor.document.uri,
                    variable.range.start
                  )
                  .then((result) => result);
                for (const position of all_refer) {
                  if (list[position.range.start.line] === undefined) {
                    list[position.range.start.line] = [];
                  }
                  if (
                    position.range.end.character <
                    document.lineAt(position.range.end.line).text.length
                  ) {
                    const lineText = document.lineAt(
                      position.range.end.line
                    ).text;
                    let endCharacter = position.range.end.character;
                    while (
                      endCharacter < lineText.length &&
                      /[a-zA-Z0-9_.]/.test(lineText[endCharacter])
                    ) {
                      endCharacter++;
                    }
                    variable.name = lineText.substring(
                      position.range.start.character,
                      endCharacter
                    );
                    // Do something with variableName, such as pushing it to the list
                    variable.range = new vscode.Range(
                      position.range.start,
                      new vscode.Position(position.range.end.line, endCharacter)
                    );
                  }
                  list[position.range.start.line].push({
                    name: variable.name,
                    kind: variable.kind,
                    range: position.range,
                    selectionRange: variable.selectionRange,
                    children: variable.children,
                    detail: variable.detail,
                  });
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
            stackFrame = await debugSession
              .customRequest("evaluate", {
                frameId: context.frameId,
                expression: symbol.name,
                context: "variables",
              })
              .then((result) => result);
            symbolcache[symbol.name] = stackFrame;
          }
          if (stackFrame.type === "NameError") {
            continue;
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
    (symbol) =>
      // [vscode.SymbolKind.Variable, vscode.SymbolKind.Function].includes(
      //   symbol.kind
      // )
      true
  );
  return vars.concat(
    symbols
      .map((symbol) => findVars(symbol.children))
      .reduce((a, b) => a.concat(b), [])
  );
}
