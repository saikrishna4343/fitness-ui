import { useRef, useState, type DragEvent } from 'react'

/**
 * Drag-to-reorder for a flat list of ids, on the browser's own drag events.
 *
 * No dependency: a sortable-list library would bring a peer-dependency graph for
 * what is a dozen lines of drag handlers here.
 *
 * Only the HANDLE is draggable, never the row. These rows hold number inputs, and
 * a draggable ancestor makes selecting text inside them unreliable. The drag image
 * is then set back to the whole row, so what follows the cursor is the exercise
 * rather than a lone grip icon.
 *
 * Touch does not fire HTML5 drag events at all -- that is what the up/down buttons
 * beside the handle are for, and they stay the keyboard path too.
 */
export function useDragReorder(ids: string[], onReorder: (next: string[]) => void) {
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const rows = useRef(new Map<string, HTMLElement>())

  function reset() {
    setDragging(null)
    setOver(null)
  }

  return {
    dragging,
    over,

    /** Ref for the row element, so the drag image can be the row and not the grip. */
    rowRef: (id: string) => (element: HTMLElement | null) => {
      if (element) rows.current.set(id, element)
      else rows.current.delete(id)
    },

    handleProps: (id: string) => ({
      draggable: true,
      onDragStart: (event: DragEvent) => {
        setDragging(id)
        event.dataTransfer.effectAllowed = 'move'
        // Firefox refuses to start a drag unless the transfer carries data.
        event.dataTransfer.setData('text/plain', id)
        const row = rows.current.get(id)
        if (row) event.dataTransfer.setDragImage(row, 16, row.offsetHeight / 2)
      },
      onDragEnd: reset,
    }),

    rowProps: (id: string) => ({
      onDragOver: (event: DragEvent) => {
        if (dragging === null || dragging === id) return
        // Without preventDefault the browser treats the row as a non-drop target
        // and the drop never fires.
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setOver(id)
      },
      onDragLeave: () => setOver((current) => (current === id ? null : current)),
      onDrop: (event: DragEvent) => {
        event.preventDefault()
        if (dragging === null || dragging === id) return reset()

        const next = ids.filter((candidate) => candidate !== dragging)
        const target = next.indexOf(id)
        // Dropping onto a row BELOW the dragged one lands after it, above lands
        // before it -- so the row ends up where the cursor is, not one off.
        const insertAt = ids.indexOf(dragging) < ids.indexOf(id) ? target + 1 : target
        next.splice(insertAt, 0, dragging)

        reset()
        onReorder(next)
      },
    }),
  }
}
