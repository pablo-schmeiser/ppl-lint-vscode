#!/usr/bin/env node
import { runCli } from './cli';

void runCli(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  stdin: process.stdin,
  stdinIsTty: process.stdin.isTTY === true,
}).then((exitCode) => {
  process.exitCode = exitCode;
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`ppl-lint: ${message}\n`);
  process.exitCode = 2;
});