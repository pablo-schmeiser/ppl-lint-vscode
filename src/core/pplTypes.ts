export const PPL_TYPES = [
  'boolean',
  'tinyint',
  'smallint',
  'int',
  'bigint',
  'float',
  'double',
  'string',
  'timestamp',
  'date',
  'time',
  'interval',
  'ip',
  'geo_point',
  'binary',
  'struct',
  'array',
] as const;

export type PplType = (typeof PPL_TYPES)[number];

const OPENSEARCH_TO_PPL_TYPE: Record<string, PplType> = {
  boolean: 'boolean',
  byte: 'tinyint',
  short: 'smallint',
  integer: 'int',
  long: 'bigint',
  float: 'float',
  half_float: 'float',
  scaled_float: 'float',
  double: 'double',
  keyword: 'string',
  constant_keyword: 'string',
  text: 'string',
  match_only_text: 'string',
  wildcard: 'string',
  date: 'timestamp',
  ip: 'ip',
  geo_point: 'geo_point',
  binary: 'binary',
  object: 'struct',
  nested: 'array',
};

export function normalizeOpenSearchType(type: string): PplType | undefined {
  return OPENSEARCH_TO_PPL_TYPE[type.toLowerCase()];
}

export function normalizeOpenSearchTypes(types: readonly string[]): PplType[] {
  return [...new Set(types.flatMap((type) => {
    const normalized = normalizeOpenSearchType(type);
    return normalized ? [normalized] : [];
  }))];
}

export function normalizePplTypeName(type: string): PplType | undefined {
  const normalized = type.toLowerCase();
  const aliases: Record<string, PplType> = {
    bool: 'boolean',
    byte: 'tinyint',
    short: 'smallint',
    integer: 'int',
    long: 'bigint',
    real: 'float',
    varchar: 'string',
  };
  return aliases[normalized] || (PPL_TYPES as readonly string[]).includes(normalized)
    ? (aliases[normalized] || normalized) as PplType
    : undefined;
}
