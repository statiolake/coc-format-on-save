import {
  CancellationTokenSource,
  Document,
  ExtensionContext,
  Range,
  WorkspaceConfiguration,
  commands,
  languages,
  window,
  workspace,
} from 'coc.nvim';

const channel = window.createOutputChannel('format-on-save');

export async function activate(context: ExtensionContext): Promise<void> {
  const config = getConfig();
  if (!config.get<boolean>('enabled')) return;

  context.subscriptions.push(
    commands.registerCommand('format-on-save.format', format),
    workspace.registerAutocmd({
      event: 'BufWritePre',
      request: true,
      callback: bufWritePreCallback,
    })
  );
}

function getConfig(): WorkspaceConfiguration {
  return workspace.getConfiguration('format-on-save');
}

function isCocConfigFile(doc: Document): boolean {
  return doc.uri.endsWith('coc-settings.json');
}

async function hasOrganizeImport(doc: Document): Promise<boolean> {
  const range = Range.create(0, 0, doc.lineCount, 0);
  const context = {
    diagnostics: [],
    only: ['source.organizeImports' /* CodeActionKind.SourceOrganizeImports */],
    triggerKind: 1 /* CodeActionTriggerKind.Invoked */,
  };
  const tokenSource = new CancellationTokenSource();
  // @ts-ignore
  const codeActions = await languages.getCodeActions(doc.textDocument, range, context, tokenSource.token);
  channel.appendLine(`codeActions: ${JSON.stringify(codeActions)}`);
  return codeActions && codeActions.length;
}

async function format() {
  const config = getConfig();
  if (!config.get<boolean>('formatOnSave')) return;

  const doc = await workspace.document;
  if (config.get<boolean>('sortCocSettingsJson') && isCocConfigFile(doc)) {
    try {
      await commands.executeCommand('formatJson', '--sort-keys');
    } catch (e) {
      void window.showWarningMessage(`Failed to sort coc-settings.json: ${e}`);
    }
  }

  // @ts-ignore
  if (!languages.hasFormatProvider(doc.textDocument)) {
    void window.showWarningMessage('Format provider not found for current document');
    return;
  }

  try {
    if (config.get<boolean>('organizeImportOnFormat')) {
      if (await hasOrganizeImport(doc)) {
        channel.appendLine('organize imports');
        await commands.executeCommand('editor.action.organizeImport');
      } else {
        channel.appendLine('organizeImport is not supported');
      }
    }
    channel.appendLine('format document');
    await commands.executeCommand('editor.action.formatDocument');
  } catch (e) {
    void window.showErrorMessage(`Failed to format document: ${e}`);
  }
}

async function bufWritePreCallback() {
  const doc = await workspace.document;
  doc.forceSync();
  const skip_once = await doc.buffer.getVar('coc_format_on_save_skip_once');
  await doc.buffer.setVar('coc_format_on_save_skip_once', false);
  if (skip_once) return;
  await format();
  doc.forceSync();
}
