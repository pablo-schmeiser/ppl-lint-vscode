import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { PplLinter } from '../core/linter';
import {
  createDefaultPplConfig,
  DEFAULT_PPL_CONFIG_FILE,
  mergePplConfigFile,
  parsePplConfigFile,
  ResolvedPplConfigFile,
} from '../projectConfig';
import { parseCommandLine, resolveOptions } from './args';
import { formatDiagnostics, formatTextSummary } from './format';
import { lintSources } from './lint';
import { readInputSources } from './sources';
import { DEFAULT_FETCHER, fetchRemoteTemplates, loadLocalTemplates, resolveRemoteOptions } from './templates';
import { CliOptions, CliRuntime } from './types';
import { errorMessage, isNodeError } from './utils';

export type { CliDiagnostic, CliRuntime } from './types';

interface LoadedConfig {
  projectConfig: ResolvedPplConfigFile;
  configDirectory: string;
}

async function loadProjectConfig(requestedConfig: string | undefined): Promise<LoadedConfig> {
  const configPath = requestedConfig !== undefined
    ? path.resolve(requestedConfig)
    : path.resolve(DEFAULT_PPL_CONFIG_FILE);
  const configDirectory = path.dirname(configPath);
  try {
    const text = await readFile(configPath, 'utf8');
    return { projectConfig: mergePplConfigFile(parsePplConfigFile(text, configPath)), configDirectory };
  } catch (error) {
    const missingDefaultConfig = requestedConfig === undefined && isNodeError(error) && error.code === 'ENOENT';
    if (!missingDefaultConfig) throw error;
    return { projectConfig: createDefaultPplConfig(), configDirectory };
  }
}

export async function runCli(args: readonly string[], runtime: CliRuntime = {}): Promise<number> {
  const stdout = runtime.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = runtime.stderr ?? ((text: string) => process.stderr.write(text));

  let options: CliOptions;
  let projectConfig: ResolvedPplConfigFile;
  try {
    const commandLine = parseCommandLine(args, stdout);
    if (commandLine.help) return 0;
    const loaded = await loadProjectConfig(commandLine.raw.config);
    projectConfig = loaded.projectConfig;
    options = resolveOptions(commandLine, projectConfig, loaded.configDirectory);
  } catch (error) {
    stderr(`ppl-lint: ${errorMessage(error)}\nUse --help for usage.\n`);
    return 2;
  }

  const hasExplicitInput = options.paths.length > 0 || options.corpusPaths.length > 0 || options.queries.length > 0;
  const fetchOnly = options.saveOpenSearchCache !== undefined && !hasExplicitInput;
  const stdinImplicit = !fetchOnly && !hasExplicitInput && runtime.stdinIsTty === false;
  if (!hasExplicitInput && !stdinImplicit && !fetchOnly) {
    stderr('ppl-lint: provide a file, directory, --query, or stdin input.\nUse --help for usage.\n');
    return 2;
  }

  try {
    const remote = resolveRemoteOptions(options, runtime.env ?? process.env);
    if (fetchOnly) {
      if (!remote || !options.saveOpenSearchCache) {
        throw new Error('Fetch-only mode requires an OpenSearch URL and --save-opensearch-cache.');
      }
      await fetchRemoteTemplates(remote, runtime.fetcher ?? DEFAULT_FETCHER, stderr, options.saveOpenSearchCache);
      if (options.outputFormat === 'json') stdout('[]\n');
      else stdout(`Saved OpenSearch cache to ${path.resolve(options.saveOpenSearchCache)}.\n`);
      return 0;
    }

    const config = projectConfig.pplLinter;
    const sources = await readInputSources(options, runtime, stdinImplicit, config.standalone.fileExtensions);
    if (sources.length === 0) {
      if (options.outputFormat === 'json') stdout('[]\n');
      else stdout('No supported input files were found.\n');
      return 0;
    }

    const localTemplates = await loadLocalTemplates(options.templatePaths);
    const remoteTemplates = remote
      ? await fetchRemoteTemplates(remote, runtime.fetcher ?? DEFAULT_FETCHER, stderr, options.saveOpenSearchCache)
      : [];
    const templates = [...localTemplates, ...remoteTemplates];
    const schemaEnabled = options.templatePaths.length > 0 || remote !== undefined || templates.length > 0;
    const linter = new PplLinter({
      openSearchVersion: options.openSearchVersion,
      includedIndexes: options.includedIndexes,
      rules: config.rules,
      customCommands: options.customCommands,
      customFunctions: options.customFunctions,
    });
    const result = lintSources(sources, linter, templates, schemaEnabled, config);
    stdout(formatDiagnostics(result.diagnostics, options.outputFormat));
    if (options.outputFormat === 'text') {
      stdout(formatTextSummary(result.queryCount, result.diagnostics));
    }
    return result.diagnostics.some((diagnostic) => diagnostic.severity === 'error') ? 1 : 0;
  } catch (error) {
    stderr(`ppl-lint: ${errorMessage(error)}\n`);
    return 2;
  }
}
