'use client';

import { ReactNode } from 'react';
import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';

/**
 * SectionFieldList
 * ----------------
 * A DndContext + SortableContext wrapper scoped to a single Section.
 *
 * The list is intentionally local — drag tracking only ever sees the ids of
 * fields inside this Section. When the user drops, we hand back the new
 * section-local order via `onReorder`; the parent is responsible for
 * mapping that order back onto the global fields array and re-normalizing
 * displayOrder (1..N) globally.
 *
 * Activation: 5px PointerSensor distance — short clicks on the ☰ handle
 * still toggle drag-handle listeners, but a quick tap won't start a drag.
 */
interface SectionFieldListProps {
  /** Section-local ids (e.g. fieldId strings) */
  items: string[];
  /** Called when drag ends with new section-local order */
  onReorder: (newSectionOrderIds: string[]) => void;
  /** Render each sortable item — typically a FieldSortableItem */
  children: (id: string) => ReactNode;
}

export function SectionFieldList({
  items,
  onReorder,
  children,
}: SectionFieldListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.indexOf(String(active.id));
    const newIndex = items.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(items, oldIndex, newIndex);
    onReorder(reordered);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        {items.map((id) => children(id))}
    </SortableContext>
    </DndContext>
  );
}