import * as vscode from 'vscode';
import { DiagnosticSeverity, EmbeddedRuleConfig, PplLinterConfig, StandaloneConfig } from '../types';

export function getPplConfig(): PplLinterConfig {
  const config = vscode.workspace.getConfiguration('pplLinter');

  const enabled = config.get<boolean>('enabled', true);

  const standalone = config.get<StandaloneConfig>('standalone', {
    fileExtensions: ['.ppl', '.pplquery', '.query'],
    languageIds: ['ppl'],
  });

  const defaultEmbedded: EmbeddedRuleConfig[] = [
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

  const embedded = config.get<EmbeddedRuleConfig[]>('embedded', defaultEmbedded);

  const defaultRules: Record<string, DiagnosticSeverity> = {
    PPL001: 'error',
    PPL002: 'error',
    PPL003: 'error',
    PPL004: 'error',
    PPL005: 'warning',
    PPL006: 'warning',
    PPL007: 'warning',
  };

  const rules = config.get<Record<string, DiagnosticSeverity>>('rules', defaultRules);
  const lintOnType = config.get<boolean>('lintOnType', true);
  const debounceMs = config.get<number>('debounceMs', 350);

  return {
    enabled,
    standalone,
    embedded,
    rules,
    lintOnType,
    debounceMs,
  };
}
