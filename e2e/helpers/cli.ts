import { execFileSync } from 'child_process'
import { join } from 'path'
import { ROOT } from './launch'

const CLI = join(ROOT, 'packages', 'cli', 'dist', 'index.js')

export interface CliResult {
  code: number
  stdout: string
  json?: unknown
}

export function runCli(args: string[]): CliResult {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })
    let json: unknown
    try {
      json = JSON.parse(stdout)
    } catch {
      // non-JSON output is legitimate for some verbs
    }
    return { code: 0, stdout, json }
  } catch (error) {
    const e = error as { status?: number | null; stdout?: string | Buffer }
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? '' }
  }
}
