import {
  CancellationTokenSource,
  Disposable,
  Document,
  ExtensionContext,
  Range,
  commands,
  languages,
  window,
  workspace,
} from 'coc.nvim';
import { z } from 'zod';

const channel = window.createOutputChannel('format-on-save');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  sortCocSettingsJson: z.boolean().default(true),
  organizeImportWithFormat: z.boolean().default(true),
  actions: z
    .record(
      z.object({
        command: z.string(),
        args: z.array(z.string()).default([]),
        commandType: z.union([z.literal('coc'), z.literal('vim')]).default('coc'),
      })
    )
    .default({}),
});
type Config = z.infer<typeof ConfigSchema>;

export async function activate(context: ExtensionContext): Promise<void> {
  const config = getConfig(undefined);
  if (!config.enabled) {
    channel.appendLine('coc-format-on-save extension is disabled');
    return;
  }

  if (!disableCocFormatting()) {
    channel.appendLine('disabling coc formatting failed.');
    return;
  }

  const registerCommand = (id: string, fn: (...args: any[]) => Promise<void>): Disposable => {
    return commands.registerCommand(`format-on-save.${id}`, fn);
  };

  context.subscriptions.push(registerCommand('format', async () => await format(await workspace.document)));
  context.subscriptions.push(
    registerCommand('formatOnDemand', async () => await formatOnDemand(await workspace.document))
  );
}

function getConfig(doc?: Document): Config {
  // @ts-ignore: type definition for workspace.getConfiguration() is old
  const config = workspace.getConfiguration('format-on-save', doc);
  return ConfigSchema.parse({
    enabled: config.get<boolean>('enabled'),
    sortCocSettingsJson: config.get<boolean>('sortCocSettingsJson'),
    organizeImportWithFormat: config.get<boolean>('organizeImportWithFormat'),
    actions: config.get<unknown>('actions'),
  });
}

async function doActionsBeforeFormat(doc: Document) {
  const config = getConfig(doc);

  await sortJsonIfNeeded(config, doc);
  await organizeImportIfNeeded(config, doc);
  await applyActions(config);
}

async function applyActions(config: Config) {
  const actions = config.actions;
  for (const action in actions) {
    const { command, args, commandType } = actions[action];
    channel.appendLine(
      `running action: ${action}, command: ${command}, args: ${JSON.stringify(args)}, commandType: ${commandType}`
    );
    switch (commandType) {
      case 'coc':
        await commands.executeCommand(command, ...args);
        // Wait for some time to ensure the command response is processed.
        // Some commands (like eslint.executeAutofix) does not fix by itself
        // but triggers a new command (eslint.applyAutoFix) to fix the
        // document. So awaiting the completion of above command is not
        // enough.
        await new Promise((resolve) => setTimeout(resolve, 500));
        break;
      case 'vim':
        await workspace.nvim.command(`${command} ${args.join(' ')}`);
        break;
      default:
        throw new Error(`Unknown commandType: ${commandType}`);
    }
  }
}

async function sortJsonIfNeeded(config: Config, doc: Document) {
  if (config.sortCocSettingsJson && isCocConfigFile(doc)) {
    try {
      await commands.executeCommand('formatJson', '--sort-keys');
    } catch (e) {
      void window.showWarningMessage(`Failed to sort coc-settings.json: ${e}`);
    }
  }
}

async function organizeImportIfNeeded(config: Config, doc: Document) {
  if (config.organizeImportWithFormat) {
    if (await hasOrganizeImportProvider(doc)) {
      channel.appendLine('organize imports');
      await commands.executeCommand('editor.action.organizeImport');
    } else {
      channel.appendLine('organizeImport is not supported');
    }
  }
}

async function format(doc: Document) {
  const config = getConfig(doc);

  if (config.sortCocSettingsJson && isCocConfigFile(doc)) {
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

  doc.forceSync();
  try {
    await doActionsBeforeFormat(doc);
    channel.appendLine('format document');
    await commands.executeCommand('editor.action.formatDocument');
  } catch (e) {
    void window.showErrorMessage(`Failed to format document: ${e}`);
  } finally {
    doc.forceSync();
  }
}

async function formatOnDemand(doc: Document) {
  const config = workspace.getConfiguration('coc.preferences');
  if (config.get<boolean>('formatOnSave', false)) {
    await format(doc);
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
