#!/usr/bin/env node
/**
 * CLI — raw D1 dump → FK-safe ordered dump (SPEC.md §6)
 *
 * Exit codes: 0 สำเร็จ · 1 ล้ม (PARSE/UNSUPPORTED/INVALID/CYCLE/PARITY/INVARIANT/VERIFY/IO)
 * · 2 usage ผิด/ไฟล์ input ไม่มี — ล้มแล้ว "ไม่เขียนไฟล์ output" เสมอ
 *
 * ตัวอย่าง:
 *   node --import tsx scripts/reorder-dump/reorder-dump.ts \
 *     --input dump.sql --output dump.ordered.sql --report manifest.json --verify
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { reorderDump } from './lib/reorder';
import { SqlParseError } from './lib/split-statements';
import { UnsupportedStatementError } from './lib/classify';
import { InvalidDumpError, ParityError, ReorderCycleError } from './lib/reorder';
import { replay } from './lib/verify';

export class VerifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VerifyError';
  }
}

interface CliArgs {
  input?: string;
  output?: string;
  report?: string;
  verify: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { verify: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const takeValue = (): string => {
      const v = argv[i + 1];
      if (v === undefined) {
        throw new Error(`flag ${a} requires a value`);
      }
      i++;
      return v;
    };
    switch (a) {
      case '--input':
      case '-i':
        args.input = takeValue();
        break;
      case '--output':
      case '-o':
        args.output = takeValue();
        break;
      case '--report':
        args.report = takeValue();
        break;
      case '--verify':
        args.verify = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        throw new Error(`unknown flag: ${a}`);
    }
  }
  return args;
}

const USAGE = `reorder-dump — convert a raw d1 export into an FK-safe ordered dump

Usage:
  node --import tsx scripts/reorder-dump/reorder-dump.ts --input <raw.sql> --output <ordered.sql>
       [--report <report.json>] [--verify]

Options:
  --input,  -i    path to the raw dump (wrangler d1 export output)
  --output, -o    path to write the FK-safe ordered dump
  --report        write a JSON report (manifest facts for the backup pipeline)
  --verify        replay the ordered dump in-memory (better-sqlite3) with
                  foreign_keys=ON + parity-check row counts against the raw dump
  --help,   -h    show this help

Exit codes: 0 ok · 1 reorder/verify failure (no output written) · 2 usage error
See scripts/reorder-dump/SPEC.md for the full contract.`;

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function errorCode(err: unknown): string {
  if (err instanceof Error) {
    switch (err.name) {
      case 'SqlParseError':
        return 'PARSE';
      case 'UnsupportedStatementError':
        return 'UNSUPPORTED';
      case 'InvalidDumpError':
        return 'INVALID';
      case 'ReorderCycleError':
        return 'CYCLE';
      case 'ParityError':
        return 'PARITY';
      case 'InvariantError':
        return 'INVARIANT';
      case 'VerifyError':
        return 'VERIFY';
    }
  }
  return 'ERROR';
}

function main(): number {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`reorder-dump: ${(e as Error).message}\n\n${USAGE}`);
    return 2;
  }
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (!args.input || !args.output) {
    console.error('reorder-dump: --input and --output are required\n\n' + USAGE);
    return 2;
  }

  const inputPath = resolve(args.input);
  const outputPath = resolve(args.output);
  const reportPath = args.report ? resolve(args.report) : null;

  if (!existsSync(inputPath)) {
    console.error(`reorder-dump: input file not found: ${inputPath}`);
    return 2;
  }

  let inputSql: string;
  try {
    inputSql = readFileSync(inputPath, 'utf8');
  } catch (e) {
    console.error(`reorder-dump: cannot read input: ${(e as Error).message}`);
    return 1;
  }

  const writeFailureReport = (err: unknown) => {
    if (reportPath) {
      try {
        writeFileSync(
          reportPath,
          JSON.stringify(
            {
              tool: 'reorder-dump',
              ok: false,
              input: inputPath,
              error: { code: errorCode(err), message: (err as Error).message },
            },
            null,
            2,
          ) + '\n',
        );
      } catch {
        // รายงานเขียนไม่ได้ — อย่าทำให้ error หลักเลือนหาย
      }
    }
  };

  const fail = (err: unknown, code: string): number => {
    writeFailureReport(err);
    console.error(`reorder-dump: FAILED [${code}] ${(err as Error).message}`);
    return 1;
  };

  let reordered: ReturnType<typeof reorderDump>;
  try {
    reordered = reorderDump(inputSql);
  } catch (e) {
    return fail(e, errorCode(e));
  }

  let verifyBlock: Record<string, unknown> | null = null;
  if (args.verify) {
    try {
      const orderedOn = replay(reordered.outputSql, 'on');
      if (orderedOn.foreignKeysSetting !== 1) {
        throw new VerifyError('foreign_keys did not stay ON during ordered replay');
      }
      if (orderedOn.foreignKeyCheckRows > 0) {
        throw new VerifyError(
          `foreign_key_check reported ${orderedOn.foreignKeyCheckRows} violation(s)`,
        );
      }
      const rawOff = replay(inputSql, 'off');
      const mismatched = Object.keys(rawOff.counts)
        .filter((t) => rawOff.counts[t] !== (orderedOn.counts[t] ?? 0))
        .concat(
          Object.keys(orderedOn.counts).filter(
            (t) => orderedOn.counts[t] !== (rawOff.counts[t] ?? 0),
          ),
        );
      if (mismatched.length > 0) {
        throw new VerifyError(
          `row counts differ between raw (FK-OFF) and ordered: ${mismatched.join(', ')}`,
        );
      }
      verifyBlock = {
        replayed: true,
        orderedFkOn: true,
        foreignKeyCheckRows: 0,
        rawFkOffCountMatch: true,
        rowCounts: orderedOn.counts,
      };
    } catch (e) {
      if (e instanceof VerifyError) return fail(e, 'VERIFY');
      return fail(new VerifyError(`replay crashed: ${(e as Error).message}`), 'VERIFY');
    }
  }

  try {
    writeFileSync(outputPath, reordered.outputSql, 'utf8');
  } catch (e) {
    return fail(new Error(`cannot write output: ${(e as Error).message}`), 'IO');
  }

  const inputSha = sha256(inputSql);
  const outputSha = sha256(reordered.outputSql);
  if (reportPath) {
    try {
      writeFileSync(
        reportPath,
        JSON.stringify(
          {
            tool: 'reorder-dump',
            ok: true,
            input: inputPath,
            output: outputPath,
            inputSha256: inputSha,
            outputSha256: outputSha,
            inputBytes: Buffer.byteLength(inputSql, 'utf8'),
            outputBytes: Buffer.byteLength(reordered.outputSql, 'utf8'),
            ...reordered.report,
            verify: verifyBlock ?? { replayed: false },
          },
          null,
          2,
        ) + '\n',
      );
    } catch (e) {
      return fail(new Error(`cannot write report: ${(e as Error).message}`), 'IO');
    }
  }

  const c = reordered.report.statementCounts;
  console.log('reorder-dump: OK');
  console.log(`  input:  ${inputPath} (${Buffer.byteLength(inputSql, 'utf8')} bytes, sha256 ${inputSha.slice(0, 12)}…)`);
  console.log(`  output: ${outputPath} (${Buffer.byteLength(reordered.outputSql, 'utf8')} bytes, sha256 ${outputSha.slice(0, 12)}…)`);
  console.log(
    `  statements: ${c.input} (pragma ${c.pragma}, tables ${c.table}, indexes ${c.index}, views ${c.view}, dml ${c.dml})`,
  );
  console.log(`  table order: ${reordered.report.tableOrder.join(', ')}`);
  console.log('  multiset parity: OK · invariants: OK');
  if (reordered.report.warnings.length > 0) {
    for (const w of reordered.report.warnings) console.log(`  warning: ${w}`);
  }
  console.log(
    `  verify: ${verifyBlock
      ? `OK (FK-ON replay passed, foreign_key_check clean, raw-vs-ordered counts match)`
      : 'skipped'}`,
  );
  return 0;
}

process.exit(main());
