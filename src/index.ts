import {Document, ExtensionContext, WorkspaceConfiguration, commands, languages, window, workspace} from 'coc.nvim';

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

async function format() {
  const config = getConfig();
  if (!config.get<boolean>('formatOnSave')) return;

  const doc = await workspace.document;
  if (config.get<boolean>('sortCocSettingsJson') && isCocConfigFile(doc)) {
    try {
      await commands.executeCommand('formatJson', '--sort-keys');
    } catch (e) {
      window.showWarningMessage('Failed to sort coc-settings.json');
    }
  }

  // @ts-ignore
  if (!languages.hasFormatProvider(doc.textDocument)) {
    window.showWarningMessage('Format provider not found for current document');
    return;
  }

  try {
    if (config.get<boolean>('organizeImportOnFormat')) {
      await commands.executeCommand('editor.action.organizeImport');
    }
    await commands.executeCommand('editor.action.formatDocument');
  } catch (e) {
    window.showErrorMessage('Failed to format document');
  }
}

async function bufWritePreCallback() {
  const buffer = await workspace.nvim.buffer;
  const skip_once = await buffer.getVar('coc_format_on_save_skip_once');
  await buffer.setVar('coc_format_on_save_skip_once', false);
  if (skip_once) return;
  await format();
}
