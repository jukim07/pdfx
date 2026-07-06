import { describe, it, expect } from 'vitest'
import { createCommandStack } from './useCommandStack'
import type { DocEntry } from '../types'

const docA: DocEntry = { id: 'a', name: 'A', pages: [] }
const docB: DocEntry = { id: 'b', name: 'B', pages: [] }

describe('createCommandStack', () => {
  it('executes a command and records it', () => {
    let state = [docA]
    const stack = createCommandStack((next) => { state = next })
    stack.dispatch({
      do: () => [docA, docB],
      undo: () => [docA]
    })
    expect(state).toEqual([docA, docB])
    expect(stack.canUndo()).toBe(true)
    expect(stack.canRedo()).toBe(false)
  })

  it('undoes the last command', () => {
    let state = [docA]
    const stack = createCommandStack((next) => { state = next })
    stack.dispatch({ do: () => [docA, docB], undo: () => [docA] })
    stack.undo()
    expect(state).toEqual([docA])
    expect(stack.canUndo()).toBe(false)
    expect(stack.canRedo()).toBe(true)
  })

  it('redoes after undo', () => {
    let state = [docA]
    const stack = createCommandStack((next) => { state = next })
    stack.dispatch({ do: () => [docA, docB], undo: () => [docA] })
    stack.undo()
    stack.redo()
    expect(state).toEqual([docA, docB])
    expect(stack.canUndo()).toBe(true)
    expect(stack.canRedo()).toBe(false)
  })

  it('truncates redo stack on new dispatch', () => {
    const stack = createCommandStack(() => {})
    stack.dispatch({ do: () => [docA, docB], undo: () => [docA] })
    stack.undo()
    stack.dispatch({ do: () => [docA], undo: () => [docA] })
    expect(stack.canRedo()).toBe(false)
  })

  it('respects ring-buffer cap of 100', () => {
    const stack = createCommandStack(() => {})
    for (let i = 0; i < 110; i++) {
      const n = i
      stack.dispatch({ do: () => [{ id: String(n), name: String(n), pages: [] }], undo: () => [] })
    }
    // After 110 pushes with cap 100, should only hold 100
    let undoCount = 0
    while (stack.canUndo()) { stack.undo(); undoCount++ }
    expect(undoCount).toBe(100)
  })

  it('bulk rename dispatches inverse renames', () => {
    const pages = [{ id: 'p1', source: {} as never, pageIndex: 0, width: 612, height: 792 }]
    let state: DocEntry[] = [
      { id: 'a', name: 'OldA', pages },
      { id: 'b', name: 'OldB', pages }
    ]
    const stack = createCommandStack((next) => { state = next })
    stack.dispatchBulkRename(state, [{ docId: 'a', name: 'NewA' }, { docId: 'b', name: 'NewB' }])
    expect(state[0].name).toBe('NewA')
    expect(state[1].name).toBe('NewB')
    stack.undo()
    expect(state[0].name).toBe('OldA')
    expect(state[1].name).toBe('OldB')
  })
})
