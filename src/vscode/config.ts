import * as vscode from 'vscode';
import {
  DEFAULT_PPL_CONFIG_FILE,
  mergePplLinterConfig,
  parsePplConfigFile,
  PPL_LINTER_CONFIG_KEYS,
  PplLinterConfigOverrides,
} from '../projectConfig';
import { PplLinterConfig } from '../types';
import * as path from 'node:path';

let sharedConfig: PplLinterConfigOverrides = {};

export function getSharedConfigUri(): vscode.Uri | undefined {
  const config = vscode.workspace.getConfiguration('pplLinter');
  const configFile = config.get<string>('configFile', DEFAULT_PPL_CONFIG_FILE).trim();
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!configFile || !workspaceFolder) return undefined;
  return path.isAbsolute(configFile)
    ? vscode.Uri.file(configFile)
    : vscode.Uri.joinPath(workspaceFolder.uri, ...configFile.split(/[\\/]/));
}

export async function loadSharedConfig(): Promise<{ uri?: vscode.Uri; error?: string }> {
  const uri = getSharedConfigUri();
  sharedConfig = {};
  if (!uri) return {};

  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    sharedConfig = parsePplConfigFile(new TextDecoder().decode(bytes), uri.fsPath || uri.toString()).pplLinter;
    const templateGlob = sharedConfig.indexTemplateGlob;
    if (templateGlob && !path.isAbsolute(templateGlob)) {
      if (uri.scheme === 'file') {
        sharedConfig = { ...sharedConfig, indexTemplateGlob: path.resolve(path.dirname(uri.fsPath), templateGlob) };
      } else {
        const resolvedGlob = path.posix.resolve(path.posix.dirname(uri.path), templateGlob);
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (workspaceFolder?.scheme === uri.scheme && workspaceFolder.authority === uri.authority) {
          const relativeGlob = path.posix.relative(workspaceFolder.path, resolvedGlob);
          sharedConfig = {
            ...sharedConfig,
            indexTemplateGlob: relativeGlob === '..' || relativeGlob.startsWith('../')
              ? resolvedGlob
              : relativeGlob,
          };
        } else {
          sharedConfig = { ...sharedConfig, indexTemplateGlob: resolvedGlob };
        }
      }
    }
    return { uri };
  } catch (error) {
    const code = (error as vscode.FileSystemError | undefined)?.code;
    if (code === 'FileNotFound') return { uri };
    const message = error instanceof Error ? error.message : String(error);
    return { uri, error: message };
  }
}

export function getPplConfig(): PplLinterConfig {
  const config = vscode.workspace.getConfiguration('pplLinter');
  const vscodeOverrides: PplLinterConfigOverrides = {};
  for (const key of PPL_LINTER_CONFIG_KEYS) {
    const inspected = config.inspect<unknown>(key);
    const value = inspected?.workspaceFolderValue ?? inspected?.workspaceValue ?? inspected?.globalValue;
    if (value !== undefined) Object.assign(vscodeOverrides, { [key]: value });
  }
  return mergePplLinterConfig(sharedConfig, vscodeOverrides);
}
