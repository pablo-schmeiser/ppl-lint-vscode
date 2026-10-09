import type { DocumentedFunction } from './documentedFunction';
import type { FunctionSignature, ReturnTypeRule, TypeConstraint } from './functionSignatures';

function entry(
  name: string,
  description: string,
  arguments_: TypeConstraint[],
  returnType: ReturnTypeRule,
  example: string,
  syntax: string[],
  minArgs = arguments_.length,
  restrictions: Partial<FunctionSignature> = {},
): DocumentedFunction {
  return {
    name, category: 'Date and time', path: 'datetime', description,
    signatures: [{ name, minArgs, maxArgs: arguments_.length, arguments: arguments_, returnType, ...restrictions }],
    syntax,
    examples: [`| eval result = ${example}`],
  };
}

export const ADDITIONAL_DATETIME_FUNCTIONS: DocumentedFunction[] = [
  entry('addtime', 'Adds the time component of the second expression to the first. Returns TIME for a TIME first argument, otherwise TIMESTAMP. DATE values use midnight; TIME values use today\'s date when a date is needed.', ['temporal', 'temporal'], 'timeArithmetic', "addtime(time('10:20:30'), time('00:05:42'))", ['addtime(expr1, expr2)']),
  ...([
    ['curdate', 'Returns the current UTC date at statement execution.'],
    ['current_date', 'Alias of curdate; returns the current UTC date at statement execution.'],
    ['utc_date', 'Returns the current UTC date.'],
  ] as const).map(([name, description]) => entry(name, description, [], 'date', `${name}()`, [`${name}()`])),
  ...([
    ['curtime', 'Returns the UTC time at which the statement began executing.'],
    ['current_time', 'Alias of curtime; returns the UTC time at which the statement began executing.'],
    ['utc_time', 'Returns the current UTC time.'],
  ] as const).map(([name, description]) => entry(name, description, [], 'time', `${name}()`, [`${name}()`])),
  entry('datetime', 'Converts a timestamp or datetime string to a timestamp, optionally in the target time zone. Time zone offsets must be between -13:59 and +14:00; invalid offsets return null.', ['temporal', 'string'], 'timestamp', "datetime('2004-02-28 23:00:00-10:00', '+10:00')", ['datetime(timestamp)', 'datetime(timestamp, to_timezone)'], 1),
  entry('datediff', 'Returns the first date minus the second date in whole days as a long. Uses only the date parts; TIME values use today\'s date.', ['temporal', 'temporal'], 'bigint', "datediff(timestamp('2000-01-02 00:00:00'), timestamp('2000-01-01 23:59:59'))", ['datediff(date1, date2)']),
  ...([
    ['dayofmonth', 'Alias of day; returns the day of the month, from 1 to 31.'],
    ['day_of_month', 'Alias of day; returns the day of the month, from 1 to 31.'],
    ['dayofweek', 'Returns the weekday index, with Sunday = 1 and Saturday = 7.'],
    ['day_of_week', 'Alias of dayofweek; returns the weekday index, with Sunday = 1 and Saturday = 7.'],
    ['dayofyear', 'Returns the day of the year, from 1 to 366.'],
    ['day_of_year', 'Alias of dayofyear; returns the day of the year, from 1 to 366.'],
  ] as const).map(([name, description]) => entry(name, description, ['temporal'], 'int', `${name}(date('2020-08-26'))`, [`${name}(date)`])),
  entry('from_days', 'Converts a day number counted from year 0 to a date.', ['integer'], 'date', 'from_days(733687)', ['from_days(day_number)']),
  entry('get_format', 'Returns date or time format specifiers for the unquoted DATE, TIME, or TIMESTAMP token and the USA, JIS, ISO, EUR, or INTERNAL convention.', ['any', 'string'], 'string', "get_format(DATE, 'USA')", ['get_format(type, format)'], 2, {
    constantArguments: [0],
    allowedValues: { 0: ['DATE', 'TIME', 'TIMESTAMP'], 1: ['USA', 'JIS', 'ISO', 'EUR', 'INTERNAL'] },
  }),
  entry('hour_of_day', 'Alias of hour; extracts the hour component. The documented duration-like time range can produce values greater than 23.', ['temporal'], 'int', "hour_of_day(time('01:02:03'))", ['hour_of_day(time)']),
  entry('last_day', 'Returns the last date of the month containing the input date or timestamp. Also accepts strings and TIME values.', ['temporal'], 'date', "last_day('2023-02-06')", ['last_day(date)']),
  ...([
    ['localtime', 'Alias of now; returns the UTC timestamp at which the statement began executing, not a TIME value.'],
    ['localtimestamp', 'Alias of now; returns the UTC timestamp at which the statement began executing.'],
    ['utc_timestamp', 'Returns the current UTC timestamp.'],
  ] as const).map(([name, description]) => entry(name, description, [], 'timestamp', `${name}()`, [`${name}()`])),
  entry('makedate', 'Constructs a date from a year and day of year, rounding both numeric arguments to integers. Day numbers can roll into later years; nonpositive days, negative years, or null inputs return null. Year 0 is interpreted as 2000.', ['numeric', 'numeric'], 'date', 'makedate(1945, 5.9)', ['makedate(year, dayofyear)']),
  entry('maketime', 'Constructs a 24-hour time from numeric hour, minute, and second values. Hours and minutes are rounded to integers; seconds retain up to nine fractional digits. Null inputs return null.', ['numeric', 'numeric', 'numeric'], 'time', 'maketime(20.2, 49.5, 42.100502)', ['maketime(hour, minute, second)']),
  entry('microsecond', 'Extracts the microsecond component of a time or timestamp, from 0 to 999999. Accepts temporal strings.', ['temporal'], 'int', "microsecond(time('01:02:03.123456'))", ['microsecond(expr)']),
  entry('minute_of_hour', 'Alias of minute; returns the minute component, from 0 to 59.', ['temporal'], 'int', "minute_of_hour(time('01:02:03'))", ['minute_of_hour(time)']),
  entry('month_of_year', 'Alias of month; returns the month number, from 1 for January to 12 for December.', ['temporal'], 'int', "month_of_year(date('2020-08-26'))", ['month_of_year(date)']),
  entry('monthname', 'Returns the full name of the month for a date, timestamp, or temporal string.', ['temporal'], 'string', "monthname(date('2020-08-26'))", ['monthname(date)']),
  entry('period_add', 'Adds an integer number of months to a YYMM or YYYYMM period and returns the resulting YYYYMM integer.', ['integer', 'integer'], 'int', 'period_add(200801, 2)', ['period_add(period, months)']),
  entry('period_diff', 'Returns the first period minus the second period in months. Both periods are integers in YYMM or YYYYMM format.', ['integer', 'integer'], 'int', 'period_diff(200802, 200703)', ['period_diff(period1, period2)']),
  entry('quarter', 'Returns the quarter of the year for a date, timestamp, or temporal string, from 1 to 4.', ['temporal'], 'int', "quarter(date('2020-08-26'))", ['quarter(date)']),
  entry('sec_to_time', 'Converts numeric seconds to a time, retaining fractional seconds. Values outside the 24-hour range wrap around, including negative values.', ['numeric'], 'time', 'sec_to_time(1234.123)', ['sec_to_time(seconds)']),
  entry('second_of_minute', 'Alias of second; returns the second component, from 0 to 59.', ['temporal'], 'int', "second_of_minute(time('01:02:03'))", ['second_of_minute(time)']),
  entry('strftime', 'Formats numeric Unix seconds or a DATE/TIMESTAMP value using POSIX-style format specifiers in UTC. Numeric values greater than 100000000000 are treated as milliseconds. Strings and TIME values are not supported. Requires OpenSearch 3.3 or later with Calcite enabled; month and weekday names use Locale.ROOT.', ['strftimeInput', 'string'], 'string', "strftime(1521467703, '%Y-%m-%dT%H:%M:%S')", ['strftime(time, format)']),
  entry('str_to_date', 'Parses a string with DATE_FORMAT-style specifiers and returns a timestamp, filling unspecified components with defaults. Invalid input/format pairs or zero date components return null.', ['string', 'string'], 'timestamp', "str_to_date('01,5,2013', '%d,%m,%Y')", ['str_to_date(string, format)']),
  entry('subdate', 'Subtracts an interval or integer number of days. The interval form returns TIMESTAMP; the days form preserves DATE input and returns TIMESTAMP for TIME or TIMESTAMP input. TIME values use today\'s date; DATE values use midnight when needed.', ['temporal', 'numericOrInterval'], 'addDate', "subdate(date('2020-08-26'), 1)", ['subdate(date, days)', 'subdate(date, INTERVAL expr unit)']),
  entry('subtime', 'Subtracts the time component of the second expression from the first. Returns TIME for a TIME first argument, otherwise TIMESTAMP. DATE values use midnight; TIME values use today\'s date when a date is needed.', ['temporal', 'temporal'], 'timeArithmetic', "subtime(time('10:20:30'), time('00:05:42'))", ['subtime(expr1, expr2)']),
  entry('sysdate', 'Returns the UTC timestamp at the instant the function executes, unlike now, which uses statement start time. Optional fractional-second precision is an integer from 0 to 6.', ['integer'], 'timestamp', 'sysdate(6)', ['sysdate()', 'sysdate(precision)'], 0, { integerRanges: { 0: [0, 6] } }),
  entry('time', 'Constructs a TIME from a string or extracts the time component of a DATE, TIME, or TIMESTAMP value.', ['temporal'], 'time', "time('2020-08-26 13:49:00')", ['time(expr)']),
  entry('time_format', 'Formats a temporal value using the time specifiers supported by DATE_FORMAT. DATE input uses midnight; date-only specifiers return 0 or null.', ['temporal', 'string'], 'string', "time_format('1998-01-31 13:14:15.012345', '%T.%f')", ['time_format(time, format)']),
  entry('time_to_sec', 'Converts the time component of a time, timestamp, or temporal string to seconds as a long.', ['temporal'], 'bigint', "time_to_sec(time('22:23:00'))", ['time_to_sec(time)']),
  entry('timediff', 'Returns the first time expression minus the second as a TIME value. Temporal strings are coerced to time expressions.', ['temporal', 'temporal'], 'time', "timediff('23:59:59', '13:00:00')", ['timediff(time1, time2)']),
  entry('to_days', 'Returns the date\'s day number counted from year 0 as a long, or null for an invalid date. Accepts temporal strings.', ['temporal'], 'bigint', "to_days(date('2008-10-07'))", ['to_days(date)']),
  entry('to_seconds', 'Returns seconds counted from year 0 as a long, or null for invalid input. Accepts temporal values, strings, and numeric dates encoded as YMMDD, YYMMDD, YYYMMDD, or YYYYMMDD; numeric literals must not have leading zeros.', ['temporalOrNumeric'], 'bigint', 'to_seconds(950228)', ['to_seconds(date)']),
  ...([
    ['week', 'Returns the week number for a date. Mode 0 is the default; modes 0 to 7 control Sunday/Monday week starts, a 0/1 lower bound, and the first-week rule.'],
    ['week_of_year', 'Alias of week, including default mode 0. Optional modes 0 to 7 control the week start, numbering range, and first-week rule.'],
    ['yearweek', 'Returns the year and week together as an integer. Optional modes 0 to 7 follow WEEK conventions; the week year can differ from the calendar year near year boundaries.'],
  ] as const).map(([name, description]) => entry(name, description, ['temporal', 'integer'], 'int', `${name}(date('2008-02-20'), 1)`, [`${name}(date)`, `${name}(date, mode)`], 1, { integerRanges: { 1: [0, 7] } })),
  entry('weekday', 'Returns the weekday index, with Monday = 0 and Sunday = 6. Unlike dayofweek, numbering starts at Monday and zero.', ['temporal'], 'int', "weekday(date('2020-08-26'))", ['weekday(date)']),
];