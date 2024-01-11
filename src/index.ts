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

type VimSaveCommand = 'write' | 'write!' | 'wall' | 'wall!';

export async function activate(context: ExtensionContext): Promise<void> {
  const config = getConfig();
  if (!config.get<boolean>('enabled')) return;

  context.subscriptions.push(
    workspace.registerAutocmd({
      event: 'BufWritePre',
      request: true,
      callback: onBufWritePre,
    }),

    commands.registerCommand('format-on-save.format', format),

    commands.registerCommand('format-on-save.saveWithoutFormat', () => save('write', false)),
    commands.registerCommand('format-on-save.forceSaveWithoutFormat', () => save('write!', false)),
    commands.registerCommand('format-on-save.saveAllWithoutFormat', () => save('wall', false)),
    commands.registerCommand('format-on-save.forceSaveAllWithoutFormat', () => save('wall!', false))
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

async function format(doc: Document) {
  const config = getConfig();
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
    if (config.get<boolean>('organizeImportWithFormat')) {
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

function getFormatOnSave(doc?: Document): boolean | undefined {
  // @ts-ignore
  const config = workspace.getConfiguration('coc.preferences', doc?.textDocument);
  return config.get('formatOnSave');
}

function setFormatOnSave(value: boolean | undefined): void {
  // @ts-ignore
  workspace.configurations.updateMemoryConfig({
    'coc.preferences.formatOnSave': value,
  });
}

async function save(vimSaveCommand: VimSaveCommand, withFormat: false) {
  setFormatOnSave(withFormat);
  await workspace.nvim.command(vimSaveCommand);
  setFormatOnSave(undefined);
}

async function onBufWritePre() {
  const doc = await workspace.document;
  if (getFormatOnSave(doc)) {
    doc.forceSync();
    await format(doc);
    doc.forceSync();
  }
}
