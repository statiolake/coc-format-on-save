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
  formatterTimeout: z.number().default(5000),
  actionTimeout: z.number().default(5000),
  waitAfterAction: z.number().default(500),
  actions: z
    .record(
      z.union([
        z.object({
          commandType: z.literal('none').default('none'),
        }),
        z.object({
          command: z.string(),
          args: z.array(z.string()).default([]),
          commandType: z.union([z.literal('coc'), z.literal('vim')]).default('coc'),
        }),
      ])
    )
    .default({}),
});
type Config = z.infer<typeof ConfigSchema>;

function log(message: string) {
  channel.appendLine(`${Date.now()}: ${message}`);
}

export async function activate(context: ExtensionContext): Promise<void> {
  const config = getConfig(undefined);
  if (!config.enabled) {
    log('coc-format-on-save extension is disabled');
    return;
  }

  if (!disableCocFormatting()) {
    log('disabling coc formatting failed.');
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
  return ConfigSchema.parse(config.get(''));
}

async function sortJsonIfNeeded(config: Config, doc: Document) {
  if (config.sortCocSettingsJson && isCocConfigFile(doc)) {
    log('- sort coc-settings.json');
    try {
      await withTimeout(config.actionTimeout, 'sorting json', commands.executeCommand('formatJson', '--sort-keys'));
    } catch (e) {
      log(`  ! Failed to sort coc-settings.json: ${e}`);
    }
  }
}

async function organizeImportIfNeeded(config: Config, doc: Document) {
  if (config.organizeImportWithFormat) {
    if (await hasOrganizeImportProvider(doc)) {
      log('- organize imports');
      await withTimeout(
        config.actionTimeout,
        'organizing import',
        commands.executeCommand('editor.action.organizeImport')
      );
    } else {
      log('  ! organizeImport is not supported');
    }
  }
}

async function applyConfiguredActions(config: Config) {
  const actions = config.actions;
  for (const actionName in actions) {
    const action = actions[actionName];

    log(`- execute configured action: ${JSON.stringify(action)}`);

    switch (action.commandType) {
      case 'coc': {
        const { command, args } = action;
        await withTimeout(
          config.actionTimeout,
          `executing coc action: ${action.command}`,
          commands.executeCommand(command, ...args)
        );

        // Wait for some time to ensure the command response is processed.
        // Some commands (like eslint.executeAutofix) does not fix by itself
        // but triggers a new command (eslint.applyAutoFix) to fix the
        // document. So awaiting the completion of above command is not
        // enough.
        await new Promise((resolve) => setTimeout(resolve, config.waitAfterAction));
        break;
      }
      case 'vim': {
        const { command, args } = action;
        await withTimeout(
          config.actionTimeout,
          `executing Vim command: ${command}`,
          workspace.nvim.command(`${command} ${args.join(' ')}`)
        );
        break;
      }
      case 'none':
        log(`  ! action ${actionName} is disabled. Skipping`);
        break;
    }
  }
}

async function doLSPFormattingIfAvailable(config: Config, doc: Document) {
  log('- execute LSP formatting');
  if (!hasFormatProvider(doc)) {
    log('  ! Format provider not found for current document');
    return;
  }

  await withTimeout(
    config.formatterTimeout,
    'formatting by LSP',
    commands.executeCommand('editor.action.formatDocument')
  );
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
  log(`- codeActions: ${JSON.stringify(codeActions)}`);
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

async function withTimeout(timeout: number, duringWhat: string, promise: Promise<void>) {
  let timer: number | null = null;
  const timerPromise = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`timeout reached during ${duringWhat}`));
    }, timeout);
  });

  await Promise.race([promise, timerPromise]);
  if (timer != null) clearTimeout(timer);
}

async function format(doc: Document) {
  try {
    doc.forceSync();

    const config = getConfig(doc);

    log('start formatting document');
    await sortJsonIfNeeded(config, doc);
    await organizeImportIfNeeded(config, doc);
    await applyConfiguredActions(config);
    await doLSPFormattingIfAvailable(config, doc);
  } catch (e) {
    void window.showErrorMessage(`Failed to format document: ${e}`);
  } finally {
    doc.forceSync();
    log('finish formatting document');
  }
}

async function formatOnDemand(doc: Document) {
  const config = workspace.getConfiguration('coc.preferences');
  if (config.get<boolean>('formatOnSave', false)) {
    await format(doc);
  }
}
