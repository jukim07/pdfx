import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..', '..')

export default function globalSetup(): void {
  if (process.env.PDFX_E2E_SKIP_BUILD !== '1') {
    // Explicit timeouts so a hung build fails loudly instead of hanging the suite forever.
    execSync('npx -y yarn@1.22.22 build:packages', { cwd: ROOT, stdio: 'inherit', timeout: 300_000 })
    execSync('npx -y yarn@1.22.22 build', { cwd: ROOT, stdio: 'inherit', timeout: 300_000 })
  }
  for (const rel of ['out/main/index.js', 'out/preload/index.js', 'packages/cli/dist/index.js']) {
    if (!existsSync(join(ROOT, rel))) {
      throw new Error(`missing build output ${rel} — rerun without PDFX_E2E_SKIP_BUILD`)
    }
  }
}
