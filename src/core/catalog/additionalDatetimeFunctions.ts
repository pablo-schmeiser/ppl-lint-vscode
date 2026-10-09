import type { DocumentedFunction } from './documentedFunction';
import type { FunctionSignature, ReturnTypeRule, TypeConstraint } from './functionSignatures';

function entry({
  name,
  description,
  arguments: arguments_,
  returnType,
  example,
  syntax,
  minArgs = arguments_.length,
  restrictions = {},
}: {
  name: string;
  description: string;
  arguments: TypeConstraint[];
  returnType: ReturnTypeRule;
  example: string;
  syntax: string[];
  minArgs?: number;
  restrictions?: Partial<FunctionSignature>;
}): DocumentedFunction {
  return {
    name,
    category: 'Date and time',
    path: 'datetime',
    description,
    signatures: [{
      name,
      minArgs,
      maxArgs: arguments_.length,
      arguments: arguments_,
      returnType,
      ...restrictions,
    }],
    syntax,
    examples: [`| eval result = ${example}`],
  };
}

export const ADDITIONAL_DATETIME_FUNCTIONS: DocumentedFunction[] = [
  entry({
    name: 'addtime',
    description: 'Adds the time component of the second expression to the first. Returns TIME for a TIME first argument, otherwise TIMESTAMP. DATE values use midnight; TIME values use today\'s date when a date is needed.',
    arguments: ['temporal', 'temporal'],
    returnType: 'timeArithmetic',
    example: "addtime(time('10:20:30'), time('00:05:42'))",
    syntax: ['addtime(expr1, expr2)'],
  }),
  ...([
    {
      name: 'curdate',
      description: 'Returns the current UTC date at statement execution.',
    },
    {
      name: 'current_date',
      description: 'Alias of curdate; returns the current UTC date at statement execution.',
    },
    {
      name: 'utc_date',
      description: 'Returns the current UTC date.',
    },
  ] as const).map(({ name, description }) => entry({
    name,
    description,
    arguments: [],
    returnType: 'date',
    example: `${name}()`,
    syntax: [`${name}()`],
  })),
  ...([
    {
      name: 'curtime',
      description: 'Returns the UTC time at which the statement began executing.',
    },
    {
      name: 'current_time',
      description: 'Alias of curtime; returns the UTC time at which the statement began executing.',
    },
    {
      name: 'utc_time',
      description: 'Returns the current UTC time.',
    },
  ] as const).map(({ name, description }) => entry({
    name,
    description,
    arguments: [],
    returnType: 'time',
    example: `${name}()`,
    syntax: [`${name}()`],
  })),
  entry({
    name: 'datetime',
    description: 'Converts a timestamp or datetime string to a timestamp, optionally in the target time zone. Time zone offsets must be between -13:59 and +14:00; invalid offsets return null.',
    arguments: ['temporal', 'string'],
    returnType: 'timestamp',
    example: "datetime('2004-02-28 23:00:00-10:00', '+10:00')",
    syntax: ['datetime(timestamp)', 'datetime(timestamp, to_timezone)'],
    minArgs: 1,
  }),
  entry({
    name: 'datediff',
    description: 'Returns the first date minus the second date in whole days as a long. Uses only the date parts; TIME values use today\'s date.',
    arguments: ['temporal', 'temporal'],
    returnType: 'bigint',
    example: "datediff(timestamp('2000-01-02 00:00:00'), timestamp('2000-01-01 23:59:59'))",
    syntax: ['datediff(date1, date2)'],
  }),
  ...([
    {
      name: 'dayofmonth',
      description: 'Alias of day; returns the day of the month, from 1 to 31.',
    },
    {
      name: 'day_of_month',
      description: 'Alias of day; returns the day of the month, from 1 to 31.',
    },
    {
      name: 'dayofweek',
      description: 'Returns the weekday index, with Sunday = 1 and Saturday = 7.',
    },
    {
      name: 'day_of_week',
      description: 'Alias of dayofweek; returns the weekday index, with Sunday = 1 and Saturday = 7.',
    },
    {
      name: 'dayofyear',
      description: 'Returns the day of the year, from 1 to 366.',
    },
    {
      name: 'day_of_year',
      description: 'Alias of dayofyear; returns the day of the year, from 1 to 366.',
    },
  ] as const).map(({ name, description }) => entry({
    name,
    description,
    arguments: ['temporal'],
    returnType: 'int',
    example: `${name}(date('2020-08-26'))`,
    syntax: [`${name}(date)`],
  })),
  entry({
    name: 'from_days',
    description: 'Converts a day number counted from year 0 to a date.',
    arguments: ['integer'],
    returnType: 'date',
    example: 'from_days(733687)',
    syntax: ['from_days(day_number)'],
  }),
  entry({
    name: 'get_format',
    description: 'Returns date or time format specifiers for the unquoted DATE, TIME, or TIMESTAMP token and the USA, JIS, ISO, EUR, or INTERNAL convention.',
    arguments: ['any', 'string'],
    returnType: 'string',
    example: "get_format(DATE, 'USA')",
    syntax: ['get_format(type, format)'],
    minArgs: 2,
    restrictions: {
      constantArguments: [0],
      allowedValues: {
        0: ['DATE', 'TIME', 'TIMESTAMP'],
        1: ['USA', 'JIS', 'ISO', 'EUR', 'INTERNAL'],
      },
    },
  }),
  entry({
    name: 'hour_of_day',
    description: 'Alias of hour; extracts the hour component. The documented duration-like time range can produce values greater than 23.',
    arguments: ['temporal'],
    returnType: 'int',
    example: "hour_of_day(time('01:02:03'))",
    syntax: ['hour_of_day(time)'],
  }),
  entry({
    name: 'last_day',
    description: 'Returns the last date of the month containing the input date or timestamp. Also accepts strings and TIME values.',
    arguments: ['temporal'],
    returnType: 'date',
    example: "last_day('2023-02-06')",
    syntax: ['last_day(date)'],
  }),
  ...([
    {
      name: 'localtime',
      description: 'Alias of now; returns the UTC timestamp at which the statement began executing, not a TIME value.',
    },
    {
      name: 'localtimestamp',
      description: 'Alias of now; returns the UTC timestamp at which the statement began executing.',
    },
    {
      name: 'utc_timestamp',
      description: 'Returns the current UTC timestamp.',
    },
  ] as const).map(({ name, description }) => entry({
    name,
    description,
    arguments: [],
    returnType: 'timestamp',
    example: `${name}()`,
    syntax: [`${name}()`],
  })),
  entry({
    name: 'makedate',
    description: 'Constructs a date from a year and day of year, rounding both numeric arguments to integers. Day numbers can roll into later years; nonpositive days, negative years, or null inputs return null. Year 0 is interpreted as 2000.',
    arguments: ['numeric', 'numeric'],
    returnType: 'date',
    example: 'makedate(1945, 5.9)',
    syntax: ['makedate(year, dayofyear)'],
  }),
  entry({
    name: 'maketime',
    description: 'Constructs a 24-hour time from numeric hour, minute, and second values. Hours and minutes are rounded to integers; seconds retain up to nine fractional digits. Null inputs return null.',
    arguments: ['numeric', 'numeric', 'numeric'],
    returnType: 'time',
    example: 'maketime(20.2, 49.5, 42.100502)',
    syntax: ['maketime(hour, minute, second)'],
  }),
  entry({
    name: 'microsecond',
    description: 'Extracts the microsecond component of a time or timestamp, from 0 to 999999. Accepts temporal strings.',
    arguments: ['temporal'],
    returnType: 'int',
    example: "microsecond(time('01:02:03.123456'))",
    syntax: ['microsecond(expr)'],
  }),
  entry({
    name: 'minute_of_hour',
    description: 'Alias of minute; returns the minute component, from 0 to 59.',
    arguments: ['temporal'],
    returnType: 'int',
    example: "minute_of_hour(time('01:02:03'))",
    syntax: ['minute_of_hour(time)'],
  }),
  entry({
    name: 'month_of_year',
    description: 'Alias of month; returns the month number, from 1 for January to 12 for December.',
    arguments: ['temporal'],
    returnType: 'int',
    example: "month_of_year(date('2020-08-26'))",
    syntax: ['month_of_year(date)'],
  }),
  entry({
    name: 'monthname',
    description: 'Returns the full name of the month for a date, timestamp, or temporal string.',
    arguments: ['temporal'],
    returnType: 'string',
    example: "monthname(date('2020-08-26'))",
    syntax: ['monthname(date)'],
  }),
  entry({
    name: 'period_add',
    description: 'Adds an integer number of months to a YYMM or YYYYMM period and returns the resulting YYYYMM integer.',
    arguments: ['integer', 'integer'],
    returnType: 'int',
    example: 'period_add(200801, 2)',
    syntax: ['period_add(period, months)'],
  }),
  entry({
    name: 'period_diff',
    description: 'Returns the first period minus the second period in months. Both periods are integers in YYMM or YYYYMM format.',
    arguments: ['integer', 'integer'],
    returnType: 'int',
    example: 'period_diff(200802, 200703)',
    syntax: ['period_diff(period1, period2)'],
  }),
  entry({
    name: 'quarter',
    description: 'Returns the quarter of the year for a date, timestamp, or temporal string, from 1 to 4.',
    arguments: ['temporal'],
    returnType: 'int',
    example: "quarter(date('2020-08-26'))",
    syntax: ['quarter(date)'],
  }),
  entry({
    name: 'sec_to_time',
    description: 'Converts numeric seconds to a time, retaining fractional seconds. Values outside the 24-hour range wrap around, including negative values.',
    arguments: ['numeric'],
    returnType: 'time',
    example: 'sec_to_time(1234.123)',
    syntax: ['sec_to_time(seconds)'],
  }),
  entry({
    name: 'second_of_minute',
    description: 'Alias of second; returns the second component, from 0 to 59.',
    arguments: ['temporal'],
    returnType: 'int',
    example: "second_of_minute(time('01:02:03'))",
    syntax: ['second_of_minute(time)'],
  }),
  entry({
    name: 'strftime',
    description: 'Formats numeric Unix seconds or a DATE/TIMESTAMP value using POSIX-style format specifiers in UTC. Numeric values greater than 100000000000 are treated as milliseconds. Strings and TIME values are not supported. Requires OpenSearch 3.3 or later with Calcite enabled; month and weekday names use Locale.ROOT.',
    arguments: ['strftimeInput', 'string'],
    returnType: 'string',
    example: "strftime(1521467703, '%Y-%m-%dT%H:%M:%S')",
    syntax: ['strftime(time, format)'],
  }),
  entry({
    name: 'str_to_date',
    description: 'Parses a string with DATE_FORMAT-style specifiers and returns a timestamp, filling unspecified components with defaults. Invalid input/format pairs or zero date components return null.',
    arguments: ['string', 'string'],
    returnType: 'timestamp',
    example: "str_to_date('01,5,2013', '%d,%m,%Y')",
    syntax: ['str_to_date(string, format)'],
  }),
  entry({
    name: 'subdate',
    description: 'Subtracts an interval or integer number of days. The interval form returns TIMESTAMP; the days form preserves DATE input and returns TIMESTAMP for TIME or TIMESTAMP input. TIME values use today\'s date; DATE values use midnight when needed.',
    arguments: ['temporal', 'numericOrInterval'],
    returnType: 'addDate',
    example: "subdate(date('2020-08-26'), 1)",
    syntax: ['subdate(date, days)', 'subdate(date, INTERVAL expr unit)'],
  }),
  entry({
    name: 'subtime',
    description: 'Subtracts the time component of the second expression from the first. Returns TIME for a TIME first argument, otherwise TIMESTAMP. DATE values use midnight; TIME values use today\'s date when a date is needed.',
    arguments: ['temporal', 'temporal'],
    returnType: 'timeArithmetic',
    example: "subtime(time('10:20:30'), time('00:05:42'))",
    syntax: ['subtime(expr1, expr2)'],
  }),
  entry({
    name: 'sysdate',
    description: 'Returns the UTC timestamp at the instant the function executes, unlike now, which uses statement start time. Optional fractional-second precision is an integer from 0 to 6.',
    arguments: ['integer'],
    returnType: 'timestamp',
    example: 'sysdate(6)',
    syntax: ['sysdate()', 'sysdate(precision)'],
    minArgs: 0,
    restrictions: {
      integerRanges: {
        0: [0, 6],
      },
    },
  }),
  entry({
    name: 'time',
    description: 'Constructs a TIME from a string or extracts the time component of a DATE, TIME, or TIMESTAMP value.',
    arguments: ['temporal'],
    returnType: 'time',
    example: "time('2020-08-26 13:49:00')",
    syntax: ['time(expr)'],
  }),
  entry({
    name: 'time_format',
    description: 'Formats a temporal value using the time specifiers supported by DATE_FORMAT. DATE input uses midnight; date-only specifiers return 0 or null.',
    arguments: ['temporal', 'string'],
    returnType: 'string',
    example: "time_format('1998-01-31 13:14:15.012345', '%T.%f')",
    syntax: ['time_format(time, format)'],
  }),
  entry({
    name: 'time_to_sec',
    description: 'Converts the time component of a time, timestamp, or temporal string to seconds as a long.',
    arguments: ['temporal'],
    returnType: 'bigint',
    example: "time_to_sec(time('22:23:00'))",
    syntax: ['time_to_sec(time)'],
  }),
  entry({
    name: 'timediff',
    description: 'Returns the first time expression minus the second as a TIME value. Temporal strings are coerced to time expressions.',
    arguments: ['temporal', 'temporal'],
    returnType: 'time',
    example: "timediff('23:59:59', '13:00:00')",
    syntax: ['timediff(time1, time2)'],
  }),
  entry({
    name: 'to_days',
    description: 'Returns the date\'s day number counted from year 0 as a long, or null for an invalid date. Accepts temporal strings.',
    arguments: ['temporal'],
    returnType: 'bigint',
    example: "to_days(date('2008-10-07'))",
    syntax: ['to_days(date)'],
  }),
  entry({
    name: 'to_seconds',
    description: 'Returns seconds counted from year 0 as a long, or null for invalid input. Accepts temporal values, strings, and numeric dates encoded as YMMDD, YYMMDD, YYYMMDD, or YYYYMMDD; numeric literals must not have leading zeros.',
    arguments: ['temporalOrNumeric'],
    returnType: 'bigint',
    example: 'to_seconds(950228)',
    syntax: ['to_seconds(date)'],
  }),
  ...([
    {
      name: 'week',
      description: 'Returns the week number for a date. Mode 0 is the default; modes 0 to 7 control Sunday/Monday week starts, a 0/1 lower bound, and the first-week rule.',
    },
    {
      name: 'week_of_year',
      description: 'Alias of week, including default mode 0. Optional modes 0 to 7 control the week start, numbering range, and first-week rule.',
    },
    {
      name: 'yearweek',
      description: 'Returns the year and week together as an integer. Optional modes 0 to 7 follow WEEK conventions; the week year can differ from the calendar year near year boundaries.',
    },
  ] as const).map(({ name, description }) => entry({
    name,
    description,
    arguments: ['temporal', 'integer'],
    returnType: 'int',
    example: `${name}(date('2008-02-20'), 1)`,
    syntax: [`${name}(date)`, `${name}(date, mode)`],
    minArgs: 1,
    restrictions: {
      integerRanges: {
        1: [0, 7],
      },
    },
  })),
  entry({
    name: 'weekday',
    description: 'Returns the weekday index, with Monday = 0 and Sunday = 6. Unlike dayofweek, numbering starts at Monday and zero.',
    arguments: ['temporal'],
    returnType: 'int',
    example: "weekday(date('2020-08-26'))",
    syntax: ['weekday(date)'],
  }),
];