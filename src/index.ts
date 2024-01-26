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
    registerCommand('save', saveWith('auto', 'write')),
    registerCommand('forceSave', saveWith('auto', 'write!')),
    registerCommand('saveAll', saveWith('auto', 'wall')),
    registerCommand('forceSaveAll', saveWith('auto', 'wall!'))
  );

  context.subscriptions.push(
    registerCommand('saveWithFormat', saveWith('always', 'write')),
    registerCommand('forceSaveWithFormat', saveWith('always', 'write!')),
    registerCommand('saveAllWithFormat', saveWith('always', 'wall')),
    registerCommand('forceSaveAllWithFormat', saveWith('always', 'wall!'))
  );

  context.subscriptions.push(
    registerCommand('saveWithoutFormat', saveWith('never', 'write')),
    registerCommand('forceSaveWithoutFormat', saveWith('never', 'write!')),
    registerCommand('saveAllWithoutFormat', saveWith('never', 'wall')),
    registerCommand('forceSaveAllWithoutFormat', saveWith('never', 'wall!'))
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
      'You are using `coc.preferences.formatOnSaveFiletypes` option ' +
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

function saveWith(mode: AutoFormatMode, vimSaveCommand: VimSaveCommand): (fileName?: string) => Promise<void> {
  return async (fileName?: string) => await save(mode, vimSaveCommand, fileName);
}

let autoFormatModeForCurrentSession: AutoFormatMode;
async function save(mode: AutoFormatMode = 'auto', vimSaveCommand: VimSaveCommand = 'write', fileName?: string) {
  autoFormatModeForCurrentSession = mode;
  const saveCommand = `${vimSaveCommand}${fileName ? ' ' + fileName : ''}`;
  await workspace.nvim.command(saveCommand);
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
