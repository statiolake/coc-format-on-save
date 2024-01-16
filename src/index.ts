import {
  CancellationTokenSource,
  Disposable,
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
type AutoFormatMode = 'auto' | 'always' | 'never';

export async function activate(context: ExtensionContext): Promise<void> {
  const config = getConfig();
  if (!config.get<boolean>('enabled')) {
    channel.appendLine('coc-format-on-save extension is disabled');
    return;
  }

  if (!disableCocFormatting()) {
    channel.appendLine('disabling coc formatting failed.');
    return;
  }

  context.subscriptions.push(
    workspace.registerAutocmd({
      event: 'BufWritePre',
      request: true,
      callback: onBufWritePre,
    })
  );

  const registerCommand = (id: string, fn: (...args: any[]) => Promise<void>): Disposable => {
    return commands.registerCommand(`format-on-save.${id}`, fn);
  };

  context.subscriptions.push(registerCommand('format', async () => await format(await workspace.document)));

  context.subscriptions.push(
    registerCommand('save', save),
    registerCommand('forceSave', saveWith('write!', 'auto')),
    registerCommand('saveAll', saveWith('wall', 'auto')),
    registerCommand('forceSaveAll', saveWith('wall!', 'auto'))
  );

  context.subscriptions.push(
    registerCommand('saveWithFormat', saveWith('write', 'always')),
    registerCommand('forceSaveWithFormat', saveWith('write!', 'always')),
    registerCommand('saveAllWithFormat', saveWith('wall', 'always')),
    registerCommand('forceSaveAllWithFormat', saveWith('wall!', 'always'))
  );

  context.subscriptions.push(
    registerCommand('saveWithoutFormat', saveWith('write', 'never')),
    registerCommand('forceSaveWithoutFormat', saveWith('write!', 'never')),
    registerCommand('saveAllWithoutFormat', saveWith('wall', 'never')),
    registerCommand('forceSaveAllWithoutFormat', saveWith('wall!', 'never'))
  );
}

function getConfig(): WorkspaceConfiguration {
  return workspace.getConfiguration('format-on-save');
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

  if (!hasFormatProvider(doc)) {
    void window.showWarningMessage('Format provider not found for current document');
    return;
  }

  try {
    if (config.get<boolean>('organizeImportWithFormat')) {
      if (await hasOrganizeImportProvider(doc)) {
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

function isCocConfigFile(doc: Document): boolean {
  return doc.uri.endsWith('coc-settings.json');
}

function hasFormatProvider(doc: Document): boolean {
  // Ignore TypeScript because hasFormatProvider() is a hidden API.
  // @ts-ignore
  return languages.hasFormatProvider(doc.textDocument);
}

async function hasOrganizeImportProvider(doc: Document): Promise<boolean> {
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

/**
 * Override formatOnSaveFiletypes to disable formatting by coc.nvim. Returns
 * false if `coc.preferences.formatOnSaveFiletypes` is set in coc.nvim config
 * file.
 */
function disableCocFormatting(): boolean {
  const config = workspace.getConfiguration('coc.preferences');
  if (config.get<any[]>('formatOnSaveFiletypes') !== undefined) {
    window.showErrorMessage(
      'You use `coc.preferences.formatOnSaveFiletypes` option ' +
        'in your coc.nvim config file. ' +
        'This prevents coc-format-on-save from working correctly. ' +
        'Also this property has been deprecated in coc.nvim side, ' +
        'please use scoped configuration instead.'
    );
  }

  // Ignore TypeScript because updateMemoryConfig() is a hidden API.
  // @ts-ignore
  workspace.configurations.updateMemoryConfig({
    'coc.preferences.formatOnSaveFiletypes': [],
  });

  return true;
}

function saveWith(vimSaveCommand: VimSaveCommand, mode: AutoFormatMode): () => Promise<void> {
  return async () => await save(vimSaveCommand, mode);
}

let autoFormatModeForCurrentSession: AutoFormatMode;
async function save(vimSaveCommand: VimSaveCommand = 'write', mode: AutoFormatMode = 'auto') {
  autoFormatModeForCurrentSession = mode;
  await workspace.nvim.command(vimSaveCommand);
  autoFormatModeForCurrentSession = 'auto';
}

async function onBufWritePre() {
  const doc = await workspace.document;
  const mode = autoFormatModeForCurrentSession;
  const config = workspace.getConfiguration('coc.preferences');
  if (mode === 'always' || (mode === 'auto' && config.get<boolean>('formatOnSave', false))) {
    doc.forceSync();
    await format(doc);
    doc.forceSync();
  }
}
