export interface EmbedRequest {
  type: 'embed'
  jobId: string
  texts: string[]
  isQuery: boolean // true → prepend bge query prefix
}

export interface EmbedReadyResponse {
  type: 'ready'
}

export interface EmbedResultResponse {
  type: 'result'
  jobId: string
  embeddings: number[][] // shape [texts.length][384]
}

export interface EmbedErrorResponse {
  type: 'error'
  jobId: string
  message: string
}

export interface EmbedDisposeRequest {
  type: 'dispose'
}

export type EmbedIncoming = EmbedRequest | EmbedDisposeRequest
export type EmbedOutgoing = EmbedReadyResponse | EmbedResultResponse | EmbedErrorResponse
