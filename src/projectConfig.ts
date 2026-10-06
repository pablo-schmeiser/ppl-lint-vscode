import { parse as parseJsonc, ParseError, printParseErrorCode } from 'jsonc-parser';
import {
  DiagnosticSeverity,
  EmbeddedRuleConfig,
  PplLinterConfig,
  StandaloneConfig,
} from './types';

export type PplLinterConfigOverrides = Partial<Omit<PplLinterConfig, 'standalone' | 'rules'>> & {
  standalone?: Partial<StandaloneConfig>;
  rules?: Partial<Record<string, DiagnosticSeverity>>;
};

export interface PplCliConfig {
  inputs: string[];
  queries: string[];
  corpusPaths: string[];
  templatePaths: string[];
  stdinFormat: 'ppl' | 'yaml' | 'toml' | 'json';
  outputFormat: 'text' | 'json';
  saveOpenSearchCache?: string;
}

export type PplCliConfigOverrides = Partial<PplCliConfig>;

export interface PplConfigFile {
  version: 1;
  pplLinter: PplLinterConfigOverrides;
  cli: PplCliConfigOverrides;
}

export interface ResolvedPplConfigFile {
  version: 1;
  pplLinter: PplLinterConfig;
  cli: PplCliConfig;
}

export const DEFAULT_PPL_CONFIG_FILE = '.ppl-lint.jsonc';

const DEFAULT_EMBEDDED_RULES: EmbeddedRuleConfig[] = [
  {
    id: 'yaml-detection-rules',
    filePattern: '**/*.{yaml,yml}',
    format: 'yaml',
    keyPatterns: [
      'query',
      'ppl',
      'ppl_query',
      'rule.query',
      'detection.condition',
      '*.query',
      'detectors.*.query',
      'alerts.*.condition.ppl',
    ],
    heuristicDetection: true,
  },
  {
    id: 'toml-agent-configs',
    filePattern: '**/*.toml',
    format: 'toml',
    keyPatterns: ['query', 'ppl', '*.query', 'transforms.*.query'],
    heuristicDetection: true,
  },
  {
    id: 'json-dashboards',
    filePattern: '**/*.json',
    format: 'json',
    keyPatterns: ['ppl', 'query', 'ppl_query'],
    heuristicDetection: false,
  },
];

const DEFAULT_RULES: Record<string, DiagnosticSeverity> = {
  PPL001: 'error',
  PPL002: 'error',
  PPL003: 'error',
  PPL004: 'error',
  PPL005: 'warning',
  PPL006: 'warning',
  PPL008: 'error',
  PPL009: 'warning',
  PPL010: 'error',
  PPL011: 'error',
  PPL012: 'error',
  PPL013: 'error',
  PPL014: 'error',
  PPL015: 'warning',
};

export const PPL_LINTER_CONFIG_KEYS = [
  'enabled',
  'openSearchUrl',
  'openSearchUsername',
  'openSearchVersion',
  'indexTemplateGlob',
  'openSearchTemplateNames',
  'openSearchMappingIndexes',
  'includedIndexes',
  'standalone',
  'embedded',
  'customCommands',
  'customFunctions',
  'additionalKeyPatterns',
  'excludeKeyPatterns',
  'overrideDefaultKeyPatterns',
  'rules',
  'lintOnType',
  'debounceMs',
] as const satisfies readonly (keyof PplLinterConfig)[];

const PPL_LINTER_KEYS = new Set<string>(PPL_LINTER_CONFIG_KEYS);

const CLI_ARRAY_KEYS = new Set(['inputs', 'queries', 'corpusPaths', 'templatePaths']);
const CLI_KEYS = new Set([
  ...CLI_ARRAY_KEYS,
  'stdinFormat',
  'outputFormat',
  'saveOpenSearchCache',
]);
const STRING_KEYS = new Set(['openSearchUrl', 'openSearchUsername', 'openSearchVersion', 'indexTemplateGlob']);
const STRING_ARRAY_KEYS = new Set([
  'openSearchTemplateNames',
  'openSearchMappingIndexes',
  'includedIndexes',
  'customCommands',
  'customFunctions',
  'additionalKeyPatterns',
  'excludeKeyPatterns',
]);
const BOOLEAN_KEYS = new Set(['enabled', 'overrideDefaultKeyPatterns', 'lintOnType']);
const SEVERITIES = new Set<DiagnosticSeverity>(['error', 'warning', 'info', 'off']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${name} must be an object.`);
  return value;
}

function requireStringArray(value: unknown, name: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${name} must be an array of strings.`);
  }
}

function validateEmbeddedRules(value: unknown): EmbeddedRuleConfig[] {
  if (!Array.isArray(value)) throw new Error('pplLinter.embedded must be an array.');
  const rules: EmbeddedRuleConfig[] = [];
  for (const [index, item] of value.entries()) {
    const rule = requireRecord(item, `pplLinter.embedded[${index}]`);
    if (typeof rule.id !== 'string' || typeof rule.filePattern !== 'string') {
      throw new Error(`pplLinter.embedded[${index}] requires string id and filePattern values.`);
    }
    if (rule.format !== 'yaml' && rule.format !== 'toml' && rule.format !== 'json') {
      throw new Error(`pplLinter.embedded[${index}].format must be yaml, toml, or json.`);
    }
    requireStringArray(rule.keyPatterns, `pplLinter.embedded[${index}].keyPatterns`);
    if (rule.heuristicDetection !== undefined && typeof rule.heuristicDetection !== 'boolean') {
      throw new Error(`pplLinter.embedded[${index}].heuristicDetection must be a boolean.`);
    }
    rules.push({
      id: rule.id,
      filePattern: rule.filePattern,
      format: rule.format,
      keyPatterns: rule.keyPatterns,
      heuristicDetection: rule.heuristicDetection ?? true,
    });
  }
  return rules;
}

function validatePplLinterConfig(value: unknown): PplLinterConfigOverrides {
  const config = requireRecord(value, 'pplLinter');
  for (const key of Object.keys(config)) {
    if (!PPL_LINTER_KEYS.has(key)) throw new Error(`Unknown pplLinter config property '${key}'.`);
  }

  for (const key of STRING_KEYS) {
    if (config[key] !== undefined && typeof config[key] !== 'string') {
      throw new Error(`pplLinter.${key} must be a string.`);
    }
  }
  for (const key of STRING_ARRAY_KEYS) {
    if (config[key] !== undefined) requireStringArray(config[key], `pplLinter.${key}`);
  }
  for (const key of BOOLEAN_KEYS) {
    if (config[key] !== undefined && typeof config[key] !== 'boolean') {
      throw new Error(`pplLinter.${key} must be a boolean.`);
    }
  }
  if (config.debounceMs !== undefined &&
    (typeof config.debounceMs !== 'number' || !Number.isInteger(config.debounceMs) || config.debounceMs < 0)) {
    throw new Error('pplLinter.debounceMs must be a non-negative integer.');
  }
  if (config.standalone !== undefined) {
    const standalone = requireRecord(config.standalone, 'pplLinter.standalone');
    for (const key of Object.keys(standalone)) {
      if (key !== 'fileExtensions' && key !== 'languageIds') {
        throw new Error(`Unknown pplLinter.standalone property '${key}'.`);
      }
      requireStringArray(standalone[key], `pplLinter.standalone.${key}`);
    }
  }
  const embedded = config.embedded === undefined ? undefined : validateEmbeddedRules(config.embedded);
  if (config.rules !== undefined) {
    const rules = requireRecord(config.rules, 'pplLinter.rules');
    for (const [rule, severity] of Object.entries(rules)) {
      if (!SEVERITIES.has(severity as DiagnosticSeverity)) {
        throw new Error(`pplLinter.rules.${rule} must be error, warning, info, or off.`);
      }
    }
  }
  return {
    ...config,
    ...(embedded ? { embedded } : {}),
  } as PplLinterConfigOverrides;
}

function validateCliConfig(value: unknown): PplCliConfigOverrides {
  const config = requireRecord(value, 'cli');
  for (const key of Object.keys(config)) {
    if (!CLI_KEYS.has(key)) throw new Error(`Unknown cli config property '${key}'.`);
  }
  for (const key of CLI_ARRAY_KEYS) {
    if (config[key] !== undefined) requireStringArray(config[key], `cli.${key}`);
  }
  if (config.stdinFormat !== undefined &&
    config.stdinFormat !== 'ppl' && config.stdinFormat !== 'yaml' &&
    config.stdinFormat !== 'toml' && config.stdinFormat !== 'json') {
    throw new Error('cli.stdinFormat must be ppl, yaml, toml, or json.');
  }
  if (config.outputFormat !== undefined && config.outputFormat !== 'text' && config.outputFormat !== 'json') {
    throw new Error('cli.outputFormat must be text or json.');
  }
  for (const key of ['saveOpenSearchCache'] as const) {
    if (config[key] !== undefined && typeof config[key] !== 'string') {
      throw new Error(`cli.${key} must be a string.`);
    }
  }
  return config as PplCliConfigOverrides;
}

export function parsePplConfigFile(text: string, source = 'PPL config'): PplConfigFile {
  const errors: ParseError[] = [];
  const parsed = parseJsonc(text, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    const first = errors[0];
    throw new Error(`${source}: ${printParseErrorCode(first.error)} at offset ${first.offset}.`);
  }
  const document = requireRecord(parsed, source);
  for (const key of Object.keys(document)) {
    if (key !== 'version' && key !== 'pplLinter' && key !== 'cli') {
      throw new Error(`${source}: unknown config property '${key}'.`);
    }
  }
  if (document.version !== undefined && document.version !== 1) {
    throw new Error(`${source}: version must be 1.`);
  }
  return {
    version: 1,
    pplLinter: document.pplLinter === undefined
      ? {}
      : validatePplLinterConfig(document.pplLinter),
    cli: document.cli === undefined ? {} : validateCliConfig(document.cli),
  };
}

export function createDefaultPplLinterConfig(): PplLinterConfig {
  return {
    enabled: true,
    openSearchVersion: '3.5',
    indexTemplateGlob: '',
    openSearchTemplateNames: [],
    openSearchMappingIndexes: [],
    includedIndexes: [],
    standalone: {
      fileExtensions: ['.ppl', '.pplquery', '.query'],
      languageIds: ['ppl'],
    },
    embedded: getDefaultEmbeddedRules(),
    customCommands: [],
    customFunctions: [],
    additionalKeyPatterns: [],
    excludeKeyPatterns: [],
    overrideDefaultKeyPatterns: false,
    rules: { ...DEFAULT_RULES },
    lintOnType: true,
    debounceMs: 350,
  };
}

export function getDefaultEmbeddedRules(): EmbeddedRuleConfig[] {
  return DEFAULT_EMBEDDED_RULES.map((rule) => ({ ...rule, keyPatterns: [...rule.keyPatterns] }));
}

export function createDefaultPplConfig(): ResolvedPplConfigFile {
  return {
    version: 1,
    pplLinter: createDefaultPplLinterConfig(),
    cli: {
      inputs: [],
      queries: [],
      corpusPaths: [],
      templatePaths: [],
      stdinFormat: 'ppl',
      outputFormat: 'text',
    },
  };
}

export function mergePplLinterConfig(...overrides: PplLinterConfigOverrides[]): PplLinterConfig {
  let config = createDefaultPplLinterConfig();
  for (const override of overrides) {
    const { standalone, rules, ...values } = override;
    const mergedRules = { ...config.rules };
    for (const [rule, severity] of Object.entries(rules ?? {})) {
      if (severity !== undefined) mergedRules[rule] = severity;
    }
    config = {
      ...config,
      ...values,
      standalone: { ...config.standalone, ...standalone },
      rules: mergedRules,
    };
  }
  return config;
}

export function mergePplConfigFile(overrides: PplConfigFile): ResolvedPplConfigFile {
  const defaults = createDefaultPplConfig();
  return {
    version: 1,
    pplLinter: mergePplLinterConfig(overrides.pplLinter),
    cli: { ...defaults.cli, ...overrides.cli },
  };
}