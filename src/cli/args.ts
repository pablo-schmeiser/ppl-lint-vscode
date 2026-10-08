import * as path from 'node:path';
import { Command, CommanderError, Option } from 'commander';
import { createDefaultPplConfig, DEFAULT_PPL_CONFIG_FILE, ResolvedPplConfigFile } from '../projectConfig';
import { CliOptions, INPUT_FORMATS, InputFormat, OUTPUT_FORMATS, OutputFormat } from './types';

const DEFAULT_CONFIG = createDefaultPplConfig();

/** Raw option values exactly as given on the command line (no config defaults applied). */
interface RawOptions {
  config?: string;
  query?: string[];
  corpus?: string[];
  stdinFormat?: InputFormat;
  template?: string[];
  saveOpensearchCache?: string;
  opensearchUrl?: string;
  opensearchUsername?: string;
  opensearchTemplate?: string[];
  mappingIndex?: string[];
  includeIndex?: string[];
  customCommand?: string[];
  customFunction?: string[];
  opensearchVersion?: string;
  format?: OutputFormat;
}

interface OptionSpec {
  flags: string;
  description: string;
  repeatable?: boolean;
  choices?: readonly string[];
}

/** Single source of truth for the CLI options: drives both parsing and `--help`. */
const OPTION_SPECS: readonly OptionSpec[] = [
  {
    flags: '--query <text>',
    repeatable: true,
    description: 'Lint a PPL query directly (repeatable)',
  },
  {
    flags: '--corpus <path>',
    repeatable: true,
    description: 'Lint results[].query from corpus JSON; one file or a directory of corpus files (repeatable)',
  },
  {
    flags: '--stdin-format <format>',
    choices: INPUT_FORMATS,
    description: `stdin format (default: ${DEFAULT_CONFIG.cli.stdinFormat})`,
  },
  {
    flags: `--config <path>`,
    description: `Config file (default: ${DEFAULT_PPL_CONFIG_FILE} in the current directory)`,
  },
  {
    flags: '--template <path>',
    repeatable: true,
    description: 'Local YAML/JSON template file or directory (repeatable)',
  },
  {
    flags: '--opensearch-url <url>',
    description: 'Fetch templates and mappings from OpenSearch (env: PPL_OPENSEARCH_URL)',
  },
  {
    flags: '--opensearch-username <name>',
    description: 'Basic-auth username (env: PPL_OPENSEARCH_USERNAME; password: PPL_OPENSEARCH_PASSWORD only)',
  },
  {
    flags: '--opensearch-template <name>',
    repeatable: true,
    description: 'Template name/pattern (repeatable; default: all)',
  },
  {
    flags: '--mapping-index <pattern>',
    repeatable: true,
    description: 'Fetch live mappings for an index pattern (repeatable)',
  },
  {
    flags: '--save-opensearch-cache <dir>',
    description: 'Save fetched templates and mappings for reuse',
  },
  {
    flags: '--opensearch-version <version>',
    description: `Target version (default: ${DEFAULT_CONFIG.pplLinter.openSearchVersion})`,
  },
  {
    flags: '--include-index <pattern>',
    repeatable: true,
    description: 'Limit schema checks (repeatable; default: all)',
  },
  {
    flags: '--custom-command <name>',
    repeatable: true,
    description: 'Recognize an additional command (repeatable)',
  },
  {
    flags: '--custom-function <name>',
    repeatable: true,
    description: 'Recognize an additional function (repeatable)',
  },
  {
    flags: '--format <format>',
    choices: OUTPUT_FORMATS,
    description: `Output format (default: ${DEFAULT_CONFIG.cli.outputFormat})`,
  },
];

const HELP_DESCRIPTION = `Lint PPL queries from files, folders, stdin, a corpus, or --query text.
Requires Node.js 22.12 or newer. Folders are scanned recursively; .git,
node_modules, dist, out, and coverage are skipped.`;

const HELP_FOOTER = `
Input details:
  file-or-directory ...         Read .ppl, .pplquery, .query, .yaml, .yml,
                                .toml, and .json files. Structured files use
                                the default embedded-query key patterns.
  -                             Read one input from stdin

OpenSearch details:
  With no query, file, or explicit stdin input, this performs a fetch-only run.

Output:
  text  One diagnostic per line, followed by a query and severity summary.
        A clean run reports that no diagnostics were found.
  json  A JSON array of diagnostics on stdout. An empty array means no findings.
        Locations are 1-based; records include file, line, column, severity,
        code, and message. Corpus results also include corpusId and family.

Exit status: 0 means no errors (warnings are allowed), 1 means lint errors,
and 2 means invalid input, file, or OpenSearch configuration/request.
`;

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function buildProgram(out: (text: string) => void): Command {
  const program = new Command('ppl-lint')
    .usage('[options] [file-or-directory ...]')
    .description(HELP_DESCRIPTION)
    .argument('[file-or-directory...]', 'Files or directories to lint')
    .helpOption('-h, --help', 'Show this help')
    .configureHelp({ helpWidth: 100 })
    .configureOutput({ writeOut: out, writeErr: () => undefined, outputError: () => undefined })
    .exitOverride()
    .addHelpText('after', HELP_FOOTER);

  for (const spec of OPTION_SPECS) {
    const option = new Option(spec.flags, spec.description);
    if (spec.repeatable) option.argParser(collect);
    if (spec.choices) option.choices(spec.choices);
    program.addOption(option);
  }
  return program;
}

export type CommandLine =
  | { help: true }
  | { help: false; raw: RawOptions; paths: string[] };

/**
 * Parses argv with commander. Throws an `Error` with a user-facing message on invalid usage;
 * help output is written through `stdout` and reported as `{ help: true }`.
 */
export function parseCommandLine(args: readonly string[], stdout: (text: string) => void): CommandLine {
  const program = buildProgram(stdout);
  try {
    program.parse(args, { from: 'user' });
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code === 'commander.helpDisplayed') return { help: true };
      throw new Error(error.message.replace(/^error: /, ''));
    }
    throw error;
  }
  return { help: false, raw: program.opts<RawOptions>(), paths: [...program.args] };
}

function configRelativePath(value: string, configDirectory: string): string {
  return path.isAbsolute(value) ? value : path.resolve(configDirectory, value);
}

/**
 * Merges config-file values with the command line. Repeatable lint settings given on the
 * command line replace the config values; template paths are additive; explicit inputs replace
 * the config's inputs.
 */
export function resolveOptions(
  commandLine: Extract<CommandLine, { help: false }>,
  projectConfig: ResolvedPplConfigFile,
  configDirectory: string
): CliOptions {
  const { raw, paths } = commandLine;
  const config = projectConfig.pplLinter;
  const cli = projectConfig.cli;
  const fromConfig = (input: string): string => configRelativePath(input, configDirectory);

  const hasCliInputs = paths.length > 0 || (raw.query?.length ?? 0) > 0 || (raw.corpus?.length ?? 0) > 0;
  if (raw.saveOpensearchCache !== undefined && !raw.saveOpensearchCache.trim()) {
    throw new Error('--save-opensearch-cache requires a directory.');
  }

  return {
    queries: hasCliInputs ? raw.query ?? [] : [...cli.queries],
    paths: hasCliInputs ? paths : cli.inputs.map(fromConfig),
    corpusPaths: hasCliInputs ? raw.corpus ?? [] : cli.corpusPaths.map(fromConfig),
    templatePaths: [
      ...cli.templatePaths.map(fromConfig),
      ...(config.indexTemplateGlob ? [fromConfig(config.indexTemplateGlob)] : []),
      ...(raw.template ?? []),
    ],
    configPath: raw.config,
    saveOpenSearchCache: raw.saveOpensearchCache
      ?? (cli.saveOpenSearchCache ? fromConfig(cli.saveOpenSearchCache) : undefined),
    openSearchUrl: raw.opensearchUrl ?? config.openSearchUrl,
    openSearchUsername: raw.opensearchUsername ?? config.openSearchUsername,
    explicitOpenSearchUrl: raw.opensearchUrl !== undefined,
    explicitOpenSearchUsername: raw.opensearchUsername !== undefined,
    templateNames: raw.opensearchTemplate ?? [...config.openSearchTemplateNames],
    mappingIndexes: raw.mappingIndex ?? [...config.openSearchMappingIndexes],
    includedIndexes: raw.includeIndex ?? [...config.includedIndexes],
    customCommands: raw.customCommand ?? [...config.customCommands],
    customFunctions: raw.customFunction ?? [...config.customFunctions],
    openSearchVersion: raw.opensearchVersion ?? config.openSearchVersion,
    inputFormat: raw.stdinFormat ?? cli.stdinFormat,
    outputFormat: raw.format ?? cli.outputFormat,
  };
}
