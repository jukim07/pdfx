import { type FeatureExtractionPipeline } from '@huggingface/transformers'
import type { EmbedIncoming, EmbedOutgoing } from './embed-protocol'

const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: '
const MODEL_ID = 'Xenova/bge-small-en-v1.5'

const scope = self as unknown as {
  postMessage: (msg: EmbedOutgoing) => void
  addEventListener: (type: 'message', handler: (e: MessageEvent<EmbedIncoming>) => void) => void
}

// Import pipeline via a type-narrowed loader to avoid the tsc TS2590 "union type too complex"
// error that occurs when the generic overload resolves all 30+ PipelineType branches at once.
type PipelineLoader = (
  task: 'feature-extraction',
  model: string,
  opts: { dtype: string; progress_callback: undefined }
) => Promise<FeatureExtractionPipeline>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loadPipeline = (async (task: string, model: string, opts: Record<string, unknown>) => {
  const { pipeline } = await import('@huggingface/transformers')
  return pipeline(task as 'feature-extraction', model, opts as Parameters<typeof pipeline>[2])
}) as unknown as PipelineLoader

// Lazy-init pipeline on first embed request.
// dtype:'q8' selects quantized ONNX weights (~25 MB download on first use).
let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null

function ensurePipeline(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = loadPipeline('feature-extraction', MODEL_ID, {
      dtype: 'q8',
      progress_callback: undefined
    })
  }
  return pipelinePromise
}

async function embed(texts: string[], isQuery: boolean): Promise<number[][]> {
  const extractor = await ensurePipeline()
  const prefixed = isQuery ? texts.map((t) => QUERY_PREFIX + t) : texts
  // pooling:'mean' + normalize:true → unit-length 384-dim vectors
  // dot product of two unit vectors == cosine similarity
  const output = await extractor(prefixed, { pooling: 'mean', normalize: true })
  return output.tolist() as number[][]
}

scope.addEventListener('message', (event) => {
  const msg = event.data
  switch (msg.type) {
    case 'embed':
      void embed(msg.texts, msg.isQuery)
        .then((embeddings) => {
          scope.postMessage({ type: 'result', jobId: msg.jobId, embeddings })
        })
        .catch((error: unknown) => {
          scope.postMessage({
            type: 'error',
            jobId: msg.jobId,
            message: error instanceof Error ? error.message : String(error)
          })
        })
      break
    case 'dispose':
      // transformers.js v3: Worker.terminate() is the shutdown mechanism.
      // The pipeline has no explicit dispose() — terminate is handled by embed-client.ts.
      break
  }
})

// Signal ready immediately; pipeline loads lazily on first embed request
scope.postMessage({ type: 'ready' })
