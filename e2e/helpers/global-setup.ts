import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..', '..')

export default function globalSetup(): void {
  if (process.env.PDFX_E2E_SKIP_BUILD !== '1') {
    execSync('npx -y yarn@1.22.22 build:packages', { cwd: ROOT, stdio: 'inherit' })
    execSync('npx -y yarn@1.22.22 build', { cwd: ROOT, stdio: 'inherit' })
  }
  for (const rel of ['out/main/index.js', 'out/preload/index.js', 'packages/cli/dist/index.js']) {
    if (!existsSync(join(ROOT, rel))) {
      throw new Error(`missing build output ${rel} — rerun without PDFX_E2E_SKIP_BUILD`)
    }
  }
}
