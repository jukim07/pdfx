import type { EmbedIncoming, EmbedOutgoing } from './embed-protocol'

export interface EmbedClient {
  embed: (texts: string[], isQuery: boolean) => Promise<number[][]>
  dispose: () => void
}

export function createEmbedClient(): EmbedClient {
  const worker = new Worker(new URL('./embed.worker.ts', import.meta.url), { type: 'module' })
  const pending = new Map<
    string,
    {
      resolve: (v: number[][]) => void
      reject: (e: Error) => void
    }
  >()
  let jobSeq = 0

  worker.addEventListener('message', (event: MessageEvent<EmbedOutgoing>) => {
    const msg = event.data
    if (msg.type === 'ready') return // worker signals it's alive; no action needed
    const entry = pending.get(msg.jobId)
    if (!entry) return
    pending.delete(msg.jobId)
    if (msg.type === 'result') entry.resolve(msg.embeddings)
    else entry.reject(new Error(msg.message))
  })

  return {
    embed(texts, isQuery) {
      const jobId = String(++jobSeq)
      return new Promise<number[][]>((resolve, reject) => {
        pending.set(jobId, { resolve, reject })
        const req: EmbedIncoming = { type: 'embed', jobId, texts, isQuery }
        worker.postMessage(req)
      })
    },
    dispose() {
      for (const entry of pending.values()) entry.reject(new Error('disposed'))
      pending.clear()
      worker.postMessage({ type: 'dispose' } satisfies EmbedIncoming)
      worker.terminate()
    }
  }
}
