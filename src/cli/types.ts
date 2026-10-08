import { CoreDiagnostic } from '../types';
import { OpenSearchFetcher } from '../vscode/openSearchTemplates';

export type InputFormat = 'ppl' | 'yaml' | 'toml' | 'json';
export type OutputFormat = 'text' | 'json';

export const INPUT_FORMATS: readonly InputFormat[] = ['ppl', 'yaml', 'toml', 'json'];
export const OUTPUT_FORMATS: readonly OutputFormat[] = ['text', 'json'];

export interface CliOptions {
  queries: string[];
  paths: string[];
  corpusPaths: string[];
  templatePaths: string[];
  configPath?: string;
  saveOpenSearchCache?: string;
  openSearchUrl?: string;
  openSearchUsername?: string;
  /** Whether the value was given on the command line (and so beats the environment). */
  explicitOpenSearchUrl: boolean;
  explicitOpenSearchUsername: boolean;
  templateNames: string[];
  mappingIndexes: string[];
  includedIndexes: string[];
  customCommands: string[];
  customFunctions: string[];
  openSearchVersion: string;
  inputFormat: InputFormat;
  outputFormat: OutputFormat;
}

export interface CliRuntime {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  stdin?: AsyncIterable<string | Uint8Array>;
  stdinIsTty?: boolean;
  env?: NodeJS.ProcessEnv;
  fetcher?: OpenSearchFetcher;
}

export interface CliSource {
  label: string;
  filePath?: string;
  text: string;
  format: InputFormat;
  keyPath?: string;
  corpusId?: string;
  family?: string;
}

export interface CliLintResult {
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

export interface RemoteTemplateOptions {
  url: string;
  username?: string;
  password?: string;
  templateNames: string[];
  mappingIndexes: string[];
}

export interface SavedOpenSearchMapping {
  selector: string;
  response: unknown;
}
