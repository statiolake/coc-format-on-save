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

    commands.registerCommand('format-on-save.save', () => save('write', undefined)),
    commands.registerCommand('format-on-save.forceSave', () => save('write!', undefined)),
    commands.registerCommand('format-on-save.saveAll', () => save('wall', undefined)),
    commands.registerCommand('format-on-save.forceSaveAll', () => save('wall!', undefined)),

    commands.registerCommand('format-on-save.saveWithFormat', () => save('write', true)),
    commands.registerCommand('format-on-save.forceSaveWithFormat', () => save('write!', true)),
    commands.registerCommand('format-on-save.saveAllWithFormat', () => save('wall', true)),
    commands.registerCommand('format-on-save.forceSaveAllWithFormat', () => save('wall!', true)),

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

function getRealFormatOnSave(doc?: Document): boolean | undefined {
  // Reset memory overrides temporary to get actual formatOnSave value.
  const overrided = overrideFormatOnSaveOnMemory(undefined);
  const realFormatOnSave = workspace
    // @ts-ignore
    .getConfiguration('coc.preferences', doc?.textDocument)
    .get<boolean>('formatOnSave');
  overrideFormatOnSaveOnMemory(overrided);

  return realFormatOnSave;
}

function overrideFormatOnSaveOnMemory(value: boolean | undefined): boolean | undefined {
  const oldValue = workspace.getConfiguration('coc.preferences').get<boolean>('formatOnSave');
  // @ts-ignore
  workspace.configurations.updateMemoryConfig({
    'coc.preferences.formatOnSave': value,
  });
  // HACK: Memory configuration is sadly overwritten by workspace
  // (:CocLocalConfig) configuration.
  // To disable formatting by coc.nvim even when formatOnSave is overwritten
  // by workspace configuration, we also set formatOnSaveFiletypes to empty
  // array. Of course if formatOnSaveFiletypes is overwritten by workspace
  // configuration, this hack does not work, but it rarely happens I hope,
  // considering that now there is scoped configuration
  // (like "[python]": {...}).
  // @ts-ignore
  workspace.configurations.updateMemoryConfig({
    'coc.preferences.formatOnSaveFiletypes': value === false ? [] : undefined,
  });
  return oldValue;
}

function disableFormatOnSaveOnMemory(mode: 'start' | 'end'): void {
  overrideFormatOnSaveOnMemory(mode === 'start' ? false : undefined);
}

let formatOnSave: boolean | undefined;
async function save(vimSaveCommand: VimSaveCommand, withFormat: boolean | undefined) {
  formatOnSave = withFormat;
  // Prevent coc.nvim from formatting on save
  disableFormatOnSaveOnMemory('start');
  await workspace.nvim.command(vimSaveCommand);
  disableFormatOnSaveOnMemory('end');
  formatOnSave = undefined;
}

async function onBufWritePre() {
  const doc = await workspace.document;
  if (formatOnSave === true || (formatOnSave === undefined && getRealFormatOnSave(doc))) {
    doc.forceSync();
    await format(doc);
    doc.forceSync();
  }
}
