import { Buffer } from 'node:buffer';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { minimatch } from 'minimatch';
import { PplLinter } from './core/linter';
import {
  IndexTemplate,
  parseIndexTemplates,
  parseOpenSearchIndexMappings,
  parseOpenSearchIndexTemplates,
} from './core/indexTemplates';
import { extractQueries, resolveKeyPatterns } from './extractors/extractor';
import { findAbsoluteFiles } from './vscode/templateFiles';
import {
  createDefaultPplConfig,
  DEFAULT_PPL_CONFIG_FILE,
  mergePplConfigFile,
  parsePplConfigFile,
  ResolvedPplConfigFile,
} from './projectConfig';
import {
  OpenSearchFetchOptions,
  OpenSearchFetcher,
  openSearchIndexMappingUrl,
  openSearchIndexTemplateUrl,
  validateOpenSearchDomain,
} from './vscode/openSearchTemplates';
import { CoreDiagnostic, Position, PplLinterConfig } from './types';

type InputFormat = 'ppl' | 'yaml' | 'toml' | 'json';
type OutputFormat = 'text' | 'json';

interface CliOptions {
  queries: string[];
  paths: string[];
  corpusPaths: string[];
  templatePaths: string[];
  configPath?: string;
  saveOpenSearchCache?: string;
  openSearchUrl?: string;
  openSearchUsername?: string;
  templateNames: string[];
  mappingIndexes: string[];
  includedIndexes: string[];
  customCommands: string[];
  customFunctions: string[];
  openSearchVersion: string;
  inputFormat: InputFormat;
  outputFormat: OutputFormat;
  explicitOptions: Set<string>;
  help: boolean;
}

export interface CliRuntime {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  stdin?: AsyncIterable<string | Uint8Array>;
  stdinIsTty?: boolean;
  env?: NodeJS.ProcessEnv;
  fetcher?: OpenSearchFetcher;
}

interface CliSource {
  label: string;
  filePath?: string;
  text: string;
  format: InputFormat;
  keyPath?: string;
  corpusId?: string;
  family?: string;
}

interface CliLintResult {
  diagnostics: CliDiagnostic[];
  queryCount: number;
}

export interface CliDiagnostic {
  file: string;
  keyPath?: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  severity: CoreDiagnostic['severity'];
  code: string;
  message: string;
  corpusId?: string;
  family?: string;
}

interface RemoteTemplateOptions {
  url: string;
  username?: string;
  password?: string;
  templateNames: string[];
  mappingIndexes: string[];
}

interface SavedOpenSearchMapping {
  selector: string;
  response: unknown;
}

const SOURCE_FORMATS = new Map<string, InputFormat>([
  ['.ppl', 'ppl'],
  ['.pplquery', 'ppl'],
  ['.query', 'ppl'],
  ['.yaml', 'yaml'],
  ['.yml', 'yaml'],
  ['.toml', 'toml'],
  ['.json', 'json'],
]);
const TEMPLATE_EXTENSIONS = new Set(['.yaml', '.yml', '.json']);
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'out', 'coverage']);
const DEFAULT_FETCHER: OpenSearchFetcher = (url, options) => fetch(url, options);
const DEFAULT_CONFIG = createDefaultPplConfig();

const HELP_TEXT = `Usage: ppl-lint [options] [file-or-directory ...]

Lint PPL queries from files, folders, stdin, a corpus, or --query text.
Requires Node.js 18 or newer. Folders are scanned recursively; .git,
node_modules, dist, out, and coverage are skipped.

Input:
  file-or-directory ...         Read .ppl, .pplquery, .query, .yaml, .yml,
                                .toml, and .json files. Structured files use
                                the default embedded-query key patterns.
  --query <text>                Lint a PPL query directly (repeatable)
  --corpus <path>               Lint results[].query from corpus JSON; accepts
                                one file or a directory of corpus files
  -                             Read one input from stdin
  --stdin-format <format>       stdin format: ppl, yaml, toml, or json (default: ${DEFAULT_CONFIG.cli.stdinFormat})

Templates and OpenSearch:
  --config <path>               Config file (default: ${DEFAULT_PPL_CONFIG_FILE} in the current directory)
  --template <path>             Local YAML/JSON template file or directory (repeatable)
  --opensearch-url <url>        Fetch templates and mappings from OpenSearch
  --opensearch-username <name>  Basic-auth username
  --opensearch-template <name>  Template name/pattern (repeatable; default: all)
  --mapping-index <pattern>     Fetch live mappings for an index pattern (repeatable)
  --save-opensearch-cache <dir> Save fetched templates and mappings for reuse
  With no query, file, or explicit stdin input, this performs a fetch-only run.
  PPL_OPENSEARCH_URL            Alternative to --opensearch-url
  PPL_OPENSEARCH_USERNAME       Alternative to --opensearch-username
  PPL_OPENSEARCH_PASSWORD       Basic-auth password; environment only

Lint settings:
  --opensearch-version <version> Target version (default: ${DEFAULT_CONFIG.pplLinter.openSearchVersion})
  --include-index <pattern>      Limit schema checks (repeatable; default: all)
  --custom-command <name>        Recognize an additional command (repeatable)
  --custom-function <name>       Recognize an additional function (repeatable)
  --format <format>              text or json (default: ${DEFAULT_CONFIG.cli.outputFormat})
  -h, --help                     Show this help

Output:
  text  One diagnostic per line, followed by a query and severity summary.
        A clean run reports that no diagnostics were found.
  json  A JSON array of diagnostics on stdout. An empty array means no findings.
        Locations are 1-based; records include file, line, column, severity,
        code, and message. Corpus results also include corpusId and family.

Exit status: 0 means no errors (warnings are allowed), 1 means lint errors,
and 2 means invalid input, file, or OpenSearch configuration/request.
`;

const OPTIONS_WITH_VALUES = new Set([
  '--config', '--query', '--corpus', '--stdin-format', '--template', '--save-opensearch-cache',
  '--opensearch-url', '--opensearch-username', '--opensearch-template', '--mapping-index',
  '--include-index', '--custom-command', '--custom-function', '--opensearch-version', '--format',
]);

function findConfigPath(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--') return undefined;
    if (argument === '--config') return args[index + 1];
    if (OPTIONS_WITH_VALUES.has(argument)) index++;
  }
  return undefined;
}

function hasExplicitInputArgs(args: readonly string[]): boolean {
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--') return index < args.length - 1;
    if (argument === '-' || argument === '--query' || argument === '--corpus') return true;
    if (argument.startsWith('-')) {
      if (OPTIONS_WITH_VALUES.has(argument)) index++;
      continue;
    }
    return true;
  }
  return false;
}

function configRelativePath(value: string, configDirectory: string): string {
  return path.isAbsolute(value) ? value : path.resolve(configDirectory, value);
}

function parseArgs(
  args: readonly string[],
  projectConfig: ResolvedPplConfigFile = createDefaultPplConfig(),
  configDirectory = process.cwd()
): CliOptions {
  const hasCliInputs = hasExplicitInputArgs(args);
  const config = projectConfig.pplLinter;
  const cliConfig = projectConfig.cli;
  const options: CliOptions = {
    queries: hasCliInputs ? [] : [...cliConfig.queries],
    paths: hasCliInputs ? [] : cliConfig.inputs.map((input) => configRelativePath(input, configDirectory)),
    corpusPaths: hasCliInputs ? [] : cliConfig.corpusPaths.map((input) => configRelativePath(input, configDirectory)),
    templatePaths: [
      ...cliConfig.templatePaths.map((input) => configRelativePath(input, configDirectory)),
      ...(config.indexTemplateGlob ? [configRelativePath(config.indexTemplateGlob, configDirectory)] : []),
    ],
    configPath: findConfigPath(args),
    saveOpenSearchCache: cliConfig.saveOpenSearchCache
      ? configRelativePath(cliConfig.saveOpenSearchCache, configDirectory)
      : undefined,
    openSearchUrl: config.openSearchUrl,
    openSearchUsername: config.openSearchUsername,
    templateNames: [],
    mappingIndexes: [...config.openSearchMappingIndexes],
    includedIndexes: [...config.includedIndexes],
    customCommands: [...config.customCommands],
    customFunctions: [...config.customFunctions],
    openSearchVersion: config.openSearchVersion,
    inputFormat: cliConfig.stdinFormat,
    outputFormat: cliConfig.outputFormat,
    explicitOptions: new Set<string>(),
    help: args.includes('--help') || args.includes('-h'),
  };
  options.templateNames = [...config.openSearchTemplateNames];
  if (options.help) return options;

  let parsePaths = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (parsePaths || argument === '-' || !argument.startsWith('-')) {
      options.paths.push(argument);
      continue;
    }
    if (argument === '--') {
      parsePaths = true;
      continue;
    }

    const value = args[index + 1];
    if (value === undefined) throw new Error(`Option '${argument}' requires a value.`);
    index++;
    switch (argument) {
      case '--config': options.configPath = value; options.explicitOptions.add(argument); break;
      case '--query': options.queries.push(value); options.explicitOptions.add(argument); break;
      case '--corpus': options.corpusPaths.push(value); options.explicitOptions.add(argument); break;
      case '--stdin-format':
        if (!isInputFormat(value)) throw new Error(`Unsupported stdin format '${value}'.`);
        options.inputFormat = value;
        options.explicitOptions.add(argument);
        break;
      case '--template': options.templatePaths.push(value); options.explicitOptions.add(argument); break;
      case '--save-opensearch-cache':
        if (!value.trim()) throw new Error('--save-opensearch-cache requires a directory.');
        options.saveOpenSearchCache = value;
        options.explicitOptions.add(argument);
        break;
      case '--opensearch-url': options.openSearchUrl = value; options.explicitOptions.add(argument); break;
      case '--opensearch-username': options.openSearchUsername = value; options.explicitOptions.add(argument); break;
      case '--opensearch-template':
        if (!options.explicitOptions.has(argument)) options.templateNames = [];
        options.templateNames.push(value);
        options.explicitOptions.add(argument);
        break;
      case '--mapping-index':
        if (!options.explicitOptions.has(argument)) options.mappingIndexes = [];
        options.mappingIndexes.push(value);
        options.explicitOptions.add(argument);
        break;
      case '--include-index':
        if (!options.explicitOptions.has(argument)) options.includedIndexes = [];
        options.includedIndexes.push(value);
        options.explicitOptions.add(argument);
        break;
      case '--custom-command':
        if (!options.explicitOptions.has(argument)) options.customCommands = [];
        options.customCommands.push(value);
        options.explicitOptions.add(argument);
        break;
      case '--custom-function':
        if (!options.explicitOptions.has(argument)) options.customFunctions = [];
        options.customFunctions.push(value);
        options.explicitOptions.add(argument);
        break;
      case '--opensearch-version': options.openSearchVersion = value; options.explicitOptions.add(argument); break;
      case '--format':
        if (value !== 'text' && value !== 'json') throw new Error(`Unsupported output format '${value}'.`);
        options.outputFormat = value;
        options.explicitOptions.add(argument);
        break;
      default: throw new Error(`Unknown option '${argument}'.`);
    }
  }
  return options;
}

function isInputFormat(value: string): value is InputFormat {
  return value === 'ppl' || value === 'yaml' || value === 'toml' || value === 'json';
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function resolveRemoteOptions(options: CliOptions, env: NodeJS.ProcessEnv): RemoteTemplateOptions | undefined {
  const url = options.explicitOptions.has('--opensearch-url')
    ? options.openSearchUrl
    : env.PPL_OPENSEARCH_URL ?? options.openSearchUrl;
  const username = options.explicitOptions.has('--opensearch-username')
    ? options.openSearchUsername
    : env.PPL_OPENSEARCH_USERNAME ?? options.openSearchUsername;
  const password = env.PPL_OPENSEARCH_PASSWORD;
  const hasRemoteSelection = options.templateNames.length > 0 || options.mappingIndexes.length > 0;

  if (!url) {
    if (options.saveOpenSearchCache) {
      throw new Error('Saving an OpenSearch cache requires --opensearch-url or PPL_OPENSEARCH_URL.');
    }
    if (hasRemoteSelection) throw new Error('Remote template or mapping options require --opensearch-url.');
    return undefined;
  }

  const validationError = validateOpenSearchDomain(url);
  if (validationError) throw new Error(validationError);
  if (username && !password) throw new Error('Set PPL_OPENSEARCH_PASSWORD when using --opensearch-username.');
  if (password && !username) throw new Error('Set --opensearch-username or PPL_OPENSEARCH_USERNAME when using PPL_OPENSEARCH_PASSWORD.');

  return {
    url,
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    templateNames: options.templateNames,
    mappingIndexes: options.mappingIndexes,
  };
}

async function readStream(stream: AsyncIterable<string | Uint8Array>): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
  }
  return chunks.join('');
}

async function collectFiles(input: string, extensions: ReadonlySet<string>, description: string): Promise<string[]> {
  const absolutePath = path.resolve(input);
  let details;
  try {
    details = await stat(absolutePath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not access ${description} '${input}': ${reason}`);
  }

  if (details.isFile()) {
    const extension = path.extname(absolutePath).toLowerCase();
    if (!extensions.has(extension)) {
      throw new Error(`Unsupported ${description} file type '${extension || path.basename(absolutePath)}'.`);
    }
    return [absolutePath];
  }
  if (!details.isDirectory()) throw new Error(`'${input}' is not a file or directory.`);

  const matches: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await visit(entryPath);
      } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
        matches.push(entryPath);
      }
    }
  }
  await visit(absolutePath);
  return matches.sort();
}

async function collectTemplateFiles(input: string): Promise<string[]> {
  if (input.includes('*') || input.includes('?') || input.includes('{') || input.includes('[')) {
    return (await findAbsoluteFiles(path.resolve(input)))
      .filter((filePath) => TEMPLATE_EXTENSIONS.has(path.extname(filePath).toLowerCase()));
  }
  return collectFiles(input, TEMPLATE_EXTENSIONS, 'template');
}

function displayPath(filePath: string): string {
  return path.relative(process.cwd(), filePath) || path.basename(filePath);
}

async function readCorpusSources(corpusPaths: string[]): Promise<CliSource[]> {
  const sources: CliSource[] = [];
  for (const corpusPath of corpusPaths) {
    const files = await collectFiles(corpusPath, new Set(['.json']), 'corpus');
    for (const filePath of files) {
      let corpus: unknown;
      try {
        corpus = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not parse corpus file '${filePath}': ${reason}`);
      }
      if (!isRecord(corpus) || !Array.isArray(corpus.results)) {
        throw new Error(`Corpus file '${filePath}' must contain a results array.`);
      }

      for (const [index, result] of corpus.results.entries()) {
        if (!isRecord(result) || typeof result.query !== 'string') {
          throw new Error(`Corpus record results[${index}] in '${filePath}' must contain a query string.`);
        }
        sources.push({
          label: displayPath(filePath),
          filePath,
          text: result.query,
          format: 'ppl',
          keyPath: `results.${index}.query`,
          ...(typeof result.id === 'string' ? { corpusId: result.id } : {}),
          ...(typeof result.family === 'string' ? { family: result.family } : {}),
        });
      }
    }
  }
  return sources;
}

async function readInputSources(
  options: CliOptions,
  runtime: CliRuntime,
  stdinImplicit: boolean,
  standaloneExtensions: readonly string[]
): Promise<CliSource[]> {
  const sourceFormats = new Map(SOURCE_FORMATS);
  for (const extension of standaloneExtensions) {
    const normalized = extension.startsWith('.') ? extension : `.${extension}`;
    sourceFormats.set(normalized.toLowerCase(), 'ppl');
  }
  const sources: CliSource[] = options.queries.map((text, index) => ({
    label: `<query ${index + 1}>`,
    text,
    format: 'ppl',
  }));
  sources.push(...await readCorpusSources(options.corpusPaths));
  const inputPaths = stdinImplicit ? ['-', ...options.paths] : options.paths;
  let stdinRead = false;

  for (const input of inputPaths) {
    if (input === '-') {
      if (stdinRead) throw new Error('Stdin may only be specified once.');
      if (!runtime.stdin) throw new Error('No stdin stream is available.');
      sources.push({ label: '<stdin>', text: await readStream(runtime.stdin), format: options.inputFormat });
      stdinRead = true;
      continue;
    }

    const files = await collectFiles(input, new Set(sourceFormats.keys()), 'input');
    for (const filePath of files) {
      const text = await readFile(filePath, 'utf8');
      const format = sourceFormats.get(path.extname(filePath).toLowerCase());
      if (!format) continue;
      sources.push({ label: displayPath(filePath), filePath, text, format });
    }
  }
  return sources;
}

async function loadLocalTemplates(templatePaths: string[]): Promise<IndexTemplate[]> {
  const templates: IndexTemplate[] = [];
  for (const templatePath of templatePaths) {
    const files = await collectTemplateFiles(templatePath);
    for (const filePath of files) {
      const text = await readFile(filePath, 'utf8');
      const parsed = parseIndexTemplates(text, filePath);
      if (parsed.length > 0) {
        templates.push(...parsed);
        continue;
      }
      if (path.extname(filePath).toLowerCase() === '.json') {
        try {
          const response = JSON.parse(text) as unknown;
          const savedTemplates = parseSavedOpenSearchCache(response);
          templates.push(...(savedTemplates ?? parseOpenSearchIndexTemplates(response)));
        } catch {
          // Invalid or non-template JSON files do not contribute schema data.
        }
      }
    }
  }
  return templates;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseSavedOpenSearchCache(value: unknown): IndexTemplate[] | undefined {
  if (!isRecord(value) || value.format !== 'ppl-lint-opensearch-cache' || value.version !== 1) {
    return undefined;
  }

  const templates = parseOpenSearchIndexTemplates(value.indexTemplates);
  if (!Array.isArray(value.mappings)) return templates;
  for (const mapping of value.mappings) {
    if (!isRecord(mapping) || typeof mapping.selector !== 'string') continue;
    templates.push(...parseOpenSearchIndexMappings(mapping.response, mapping.selector));
  }
  return templates;
}

async function writeOpenSearchCache(
  directory: string,
  indexTemplates: unknown,
  mappings: SavedOpenSearchMapping[]
): Promise<void> {
  const cacheDirectory = path.resolve(directory);
  await mkdir(cacheDirectory, { recursive: true });
  const cache = {
    format: 'ppl-lint-opensearch-cache',
    version: 1,
    indexTemplates,
    mappings,
  };
  await writeFile(
    path.join(cacheDirectory, 'ppl-lint-opensearch-cache.json'),
    `${JSON.stringify(cache, null, 2)}\n`,
    'utf8'
  );
}

async function fetchRemoteTemplates(
  remote: RemoteTemplateOptions,
  fetcher: OpenSearchFetcher,
  stderr: (text: string) => void,
  saveCacheDirectory?: string
): Promise<IndexTemplate[]> {
  const headers: Record<string, string> = {};
  if (remote.username && remote.password) {
    headers.Authorization = `Basic ${Buffer.from(`${remote.username}:${remote.password}`, 'utf8').toString('base64')}`;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const mappingResponses: SavedOpenSearchMapping[] = [];
  const requestOptions: OpenSearchFetchOptions = {
    headers,
    signal: controller.signal,
    redirect: 'error',
  };

  try {
    let templateResponse: unknown = { index_templates: [] };
    try {
      const names: Array<string | undefined> = remote.templateNames.length > 0
        ? remote.templateNames
        : [undefined];
      const templatesByName = new Map<string, unknown>();
      for (const name of names) {
        const response = await fetcher(openSearchIndexTemplateUrl(remote.url, name), requestOptions);
        if (!response.ok) {
          throw new Error(`OpenSearch returned HTTP ${response.status} for the index-template request${name ? ` '${name}'` : ''}.`);
        }
        const body = await response.json();
        if (!isRecord(body) || !Array.isArray(body.index_templates)) {
          throw new Error('OpenSearch response did not contain an index_templates array.');
        }
        for (const template of body.index_templates) {
          if (!isRecord(template)) continue;
          const name = typeof template.name === 'string' ? template.name : JSON.stringify(template);
          templatesByName.set(name, template);
        }
      }
      templateResponse = { index_templates: [...templatesByName.values()] };
    } catch (error) {
      if (remote.mappingIndexes.length === 0) throw error;
      const message = error instanceof Error ? error.message : 'Could not fetch index templates.';
      stderr(`warning: ${message} Continuing with live mappings.\n`);
    }

    const templates = parseOpenSearchIndexTemplates(templateResponse);
    for (const pattern of remote.mappingIndexes) {
      const response = await fetcher(openSearchIndexMappingUrl(remote.url, pattern), requestOptions);
      if (!response.ok) {
        throw new Error(`OpenSearch returned HTTP ${response.status} for mapping pattern '${pattern}'.`);
      }
      const body = await response.json();
      if (!isRecord(body)) throw new Error(`OpenSearch returned an invalid mapping response for '${pattern}'.`);
      mappingResponses.push({ selector: pattern, response: body });
      templates.push(...parseOpenSearchIndexMappings(body, pattern));
    }
    if (saveCacheDirectory) {
      await writeOpenSearchCache(saveCacheDirectory, templateResponse, mappingResponses);
    }
    return templates;
  } finally {
    clearTimeout(timeout);
  }
}

function makeDiagnostic(
  file: string,
  keyPath: string | undefined,
  diagnostic: CoreDiagnostic,
  start: Position,
  end: Position,
  corpusMetadata?: Pick<CliSource, 'corpusId' | 'family'>
): CliDiagnostic {
  return {
    file,
    ...(keyPath ? { keyPath } : {}),
    line: start.line + 1,
    column: start.col + 1,
    endLine: end.line + 1,
    endColumn: end.col + 1,
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    ...(corpusMetadata?.corpusId ? { corpusId: corpusMetadata.corpusId } : {}),
    ...(corpusMetadata?.family ? { family: corpusMetadata.family } : {}),
  };
}

function lintSources(
  sources: CliSource[],
  linter: PplLinter,
  templates: IndexTemplate[],
  schemaEnabled: boolean,
  config: PplLinterConfig
): CliLintResult {
  const diagnostics: CliDiagnostic[] = [];
  let queryCount = 0;
  const embeddedRules = config.embedded;

  for (const source of sources) {
    if (source.format === 'ppl') {
      queryCount++;
      for (const diagnostic of linter.lint(source.text, templates, schemaEnabled)) {
        diagnostics.push(makeDiagnostic(
          source.label,
          source.keyPath,
          diagnostic,
          diagnostic.span.start,
          diagnostic.span.end,
          source
        ));
      }
      continue;
    }

    const rule = embeddedRules.find((candidate) => candidate.format === source.format &&
      (!source.filePath || minimatch(source.filePath, candidate.filePattern, { dot: true, matchBase: true })));
    if (!rule) continue;
    const patterns = resolveKeyPatterns(rule.keyPatterns, {
      additional: config.additionalKeyPatterns,
      exclude: config.excludeKeyPatterns,
      overrideDefaults: config.overrideDefaultKeyPatterns,
    });
    const queries = extractQueries(source.text, source.format, patterns, rule.heuristicDetection);
    queryCount += queries.length;
    for (const query of queries) {
      for (const diagnostic of linter.lint(query.rawText, templates, schemaEnabled)) {
        const hostRange = query.sourceMap.translate(diagnostic.span);
        if (!hostRange) continue;
        diagnostics.push(makeDiagnostic(
          source.label,
          query.keyPath,
          diagnostic,
          { ...hostRange.start, offset: 0 },
          { ...hostRange.end, offset: 0 }
        ));
      }
    }
  }
  return { diagnostics, queryCount };
}

function formatDiagnostics(diagnostics: CliDiagnostic[], format: OutputFormat): string {
  if (format === 'json') return `${JSON.stringify(diagnostics, null, 2)}\n`;
  return diagnostics.map((diagnostic) => {
    const context = [
      diagnostic.keyPath,
      diagnostic.corpusId ? `id=${diagnostic.corpusId}` : undefined,
      diagnostic.family ? `family=${diagnostic.family}` : undefined,
    ].filter((item): item is string => item !== undefined);
    const keyPath = context.length > 0 ? ` [${context.join('; ')}]` : '';
    return `${diagnostic.file}${keyPath}:${diagnostic.line}:${diagnostic.column}: ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`;
  }).join('\n') + (diagnostics.length > 0 ? '\n' : '');
}

function formatTextSummary(queryCount: number, diagnostics: CliDiagnostic[]): string {
  if (queryCount === 0) return 'No PPL queries found in the input.\n';
  const queryLabel = queryCount === 1 ? 'PPL query' : 'PPL queries';
  if (diagnostics.length === 0) return `Checked ${queryCount} ${queryLabel}: no diagnostics.\n`;

  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length;
  const information = diagnostics.filter((diagnostic) => diagnostic.severity === 'info').length;
  const count = (value: number, singular: string, plural: string): string =>
    `${value} ${value === 1 ? singular : plural}`;
  return `Checked ${queryCount} ${queryLabel}: ${count(errors, 'error', 'errors')}, ` +
    `${count(warnings, 'warning', 'warnings')}, ` +
    `${count(information, 'informational diagnostic', 'informational diagnostics')}.\n`;
}

export async function runCli(args: readonly string[], runtime: CliRuntime = {}): Promise<number> {
  const stdout = runtime.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = runtime.stderr ?? ((text: string) => process.stderr.write(text));
  if (args.includes('--help') || args.includes('-h')) {
    stdout(HELP_TEXT);
    return 0;
  }

  let options: CliOptions;
  let projectConfig = createDefaultPplConfig();
  let configDirectory = process.cwd();
  try {
    const requestedConfig = findConfigPath(args);
    const configPath = requestedConfig !== undefined
      ? path.resolve(requestedConfig)
      : path.resolve(DEFAULT_PPL_CONFIG_FILE);
    configDirectory = path.dirname(configPath);
    try {
      const text = await readFile(configPath, 'utf8');
      projectConfig = mergePplConfigFile(parsePplConfigFile(text, configPath));
    } catch (error) {
      const missingDefaultConfig = !requestedConfig && isNodeError(error) && error.code === 'ENOENT';
      if (!missingDefaultConfig) throw error;
    }
    options = parseArgs(args, projectConfig, configDirectory);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr(`ppl-lint: ${message}\nUse --help for usage.\n`);
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
    const message = error instanceof Error ? error.message : String(error);
    stderr(`ppl-lint: ${message}\n`);
    return 2;
  }
}
